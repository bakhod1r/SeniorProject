---
layout: default
title: WaitGroup in Tests — Interview
parent: WaitGroup in Tests
grand_parent: Testing Concurrent Code
nav_order: 6
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/03-waitgroup-in-tests/interview/
---

# WaitGroup in Tests — Interview

[← Back to WaitGroup in Tests](./)

A curated set of interview questions on synchronising tests, with short and full answers. Use the short answers as a memory aid before the interview; read the full answers to make sure you can defend each one.

---

## 1. Why does a test that spawns goroutines need synchronisation?

**Short:** Because the test function returns before the goroutines finish, and the test framework does not wait for spawned goroutines.

**Full:** A `Test...` function is a normal Go function from the framework's perspective. It runs in one goroutine. When it returns, the framework records the result and moves to the next test. Goroutines spawned inside the test body are not registered with `*testing.T`; they continue to run after the test ends. If the test asserts on shared state before the goroutines have written it, the assertion runs on stale data. Worse, goroutines that survive into the next test can race with that test's setup. The cure is an explicit barrier inside the test body — `sync.WaitGroup`, a `done` channel with `select`, or `t.Cleanup` — that blocks until the spawned goroutines have finished.

---

## 2. Write the canonical fan-out test pattern.

**Short:**

```go
var wg sync.WaitGroup
wg.Add(N)
for i := 0; i < N; i++ {
    i := i
    go func() {
        defer wg.Done()
        results[i] = work(i)
    }()
}
wg.Wait()
```

**Full:** Pre-allocate a result slice so each goroutine writes to its own index (no mutex needed). Call `Add(N)` once, in the test goroutine, before spawning anything. Capture `i` to avoid the loop-variable closure problem on Go < 1.22. Use `defer wg.Done()` as the first line in the goroutine so it runs even if the body panics or returns early. `wg.Wait` is the only barrier — after it returns, the test can read the slice safely.

---

## 3. What does `wg.Wait` synchronise, beyond just blocking?

**Short:** It establishes a happens-before edge from every `Done` to the code following `Wait`. Memory written before `Done` is visible after `Wait`.

**Full:** The Go memory model declares: "A call to Done synchronizes before the return of any Wait call that it unblocks." Translation: any non-atomic memory write a goroutine performs *before* its `wg.Done()` is guaranteed to be visible to the goroutine returning from `wg.Wait()`. This is what makes the fan-out test pattern work — the test reads `results[i]` without a mutex because `wg.Wait` already provides the necessary memory ordering.

---

## 4. What happens if you call `Wait` before `Add`?

**Short:** `Wait` sees counter = 0 and returns immediately. The goroutines may not have started.

**Full:** `Wait` reads the counter atomically; if it is zero, the function returns. If you launch goroutines that call `Add(1)` inside themselves, the test goroutine may reach `Wait` before any of them has added — counter is still zero, `Wait` returns, the assertion runs on uninitialised state. The race detector reports a data race between the `Add` and `Wait` because the spec requires `Add(positive)` to happen-before the corresponding `Wait`. The fix is to call `Add(N)` in the test goroutine, before the `go` statement.

---

## 5. Why can't you call `t.Fatal` from a spawned goroutine?

**Short:** `t.Fatal` calls `runtime.Goexit`, which terminates only the calling goroutine. The test continues.

**Full:** `runtime.Goexit` walks up the deferred-function chain of the current goroutine and exits it. It does not affect other goroutines, including the test goroutine. So `t.Fatal` from a worker terminates the worker but leaves the test running. The test framework explicitly documents that `Fatal`, `FailNow`, `SkipNow`, `Parallel` may only be called from the test goroutine. Inside spawned goroutines, use `t.Errorf` — it just sets a failure flag, which the test goroutine observes when it returns.

---

## 6. Why is `time.Sleep` never a valid barrier?

**Short:** Sleeps are either too short (flaky) or too long (slow). They depend on system load, not on the actual event you want to wait for.

**Full:** A `time.Sleep(N)` assumes the work completes within N. On the developer's laptop with no load, N may be reliably long enough. On a CI runner under load, with race detector enabled, the same work takes 10x longer. The sleep becomes too short → test flakes. Doubling the sleep makes the test slower for everyone without fundamentally fixing the problem; eventually the slowdown is hit again. The right answer is to wait on the *event* (a channel close, a WaitGroup reaching zero, a polled condition) and put a *timeout* on that wait. The timeout has a clear failure mode; the sleep has a silent one.

---

## 7. Implement a `WaitTimeout` helper.

**Short:**

```go
func WaitTimeout(t *testing.T, wg *sync.WaitGroup, d time.Duration) {
    t.Helper()
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(d):
        t.Fatalf("WaitGroup did not finish within %v", d)
    }
}
```

**Full:** The helper launches its own goroutine to wait on the group and signal via a `done` channel. The outer `select` races that signal against a `time.After` timeout. `t.Helper()` ensures failure attribution points at the calling test. If the timeout fires, the inner goroutine is left blocked on `wg.Wait` — accepted, because `t.Fatal` is about to end the test (and likely the whole process). Variant designs add a stop channel, but in practice the simple version is fine.

---

## 8. What is the start-barrier pattern and why does it help the race detector?

**Short:** N goroutines park on `<-start`; the test goroutine `close(start)` to release them all simultaneously. Maximum contention finds races.

**Full:** The race detector reports races by observing memory accesses; if two accesses are temporally far apart (because goroutines spawn one at a time over hundreds of microseconds), the detector may miss a race that exists in theory. The start barrier collects all goroutines at a single point — `<-start` — and releases them with one `close(start)`. Every goroutine wakes within microseconds of the others. They race into the contended operation on multiple cores at once. The detector now has every chance to observe a conflicting pair of accesses. Combined with `-count=100`, this pattern finds races reliably.

---

## 9. How do you cleanly stop a long-running goroutine in a test?

**Short:**

```go
ctx, cancel := context.WithCancel(context.Background())
var wg sync.WaitGroup
wg.Add(1)
go func() { defer wg.Done(); run(ctx) }()
t.Cleanup(func() { cancel(); wg.Wait() })
```

**Full:** A context provides the cancellation signal. The goroutine selects on `ctx.Done()` and exits when triggered. The `t.Cleanup` callback runs at the end of the test (including after `t.Fatal`). The cleanup cancels first, then waits — this order is what guarantees no deadlock. Combining both into one cleanup makes the order obvious; registering them as two separate cleanups risks misordering, because cleanups run in LIFO.

---

## 10. What does `goleak.VerifyNone(t)` do?

**Short:** It checks at test teardown whether any goroutines other than the test runner are still alive, and fails the test if so.

**Full:** The library walks every goroutine's stack via `runtime.Stack`, filters out known-runtime goroutines (the GC, the test framework, signal handlers), and reports the rest as leaks. It retries a few times to allow legitimate shutdown to finish. The failure message includes the stack trace of each leaked goroutine, which usually pinpoints the goroutine's spawn site. To use it per-test, `defer goleak.VerifyNone(t)` at the start (run as a `Cleanup` if you have other Cleanups that need to run first). To use it package-wide, `func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }`.

---

## 11. Why is `defer goleak.VerifyNone(t)` sometimes wrong?

**Short:** Defers run before `t.Cleanup` callbacks. If your cleanup contains the shutdown logic, `goleak` runs while goroutines are still alive.

**Full:** The order at test teardown is: (a) deferred functions in the test body, (b) `t.Cleanup` callbacks in LIFO order, (c) framework records the result. A `defer goleak.VerifyNone(t)` therefore runs before any `t.Cleanup(cancel)` and `t.Cleanup(wg.Wait)`. The goroutines you registered to shut down via Cleanup are still running when `goleak` inspects them. The fix is to register the verifier itself as a `Cleanup`, placed *first* so it pops *last*:

```go
t.Cleanup(func() { goleak.VerifyNone(t) })   // registered first → runs last
t.Cleanup(cancel)
t.Cleanup(wg.Wait)
```

---

## 12. Compare `WaitGroup` and `errgroup.Group`.

**Short:** `errgroup` is a WaitGroup plus first-error capture and optional context cancellation.

**Full:** `WaitGroup` is a counter — it knows nothing about errors. `errgroup.Group` wraps a WaitGroup. Its `Go(func() error)` method handles `Add` and `Done` internally and stores the first non-nil error. `g.Wait()` returns that error (or nil). With `errgroup.WithContext`, the group also creates a derived context that is cancelled when the first error appears, propagating short-circuit cancellation to the other workers. Use `errgroup` when "all must succeed and the first failure should stop the rest." Use `WaitGroup` when you have no error semantics or when the goroutines self-report via `t.Errorf`.

---

## 13. What happens if you copy a `WaitGroup` by value?

**Short:** You get two unrelated counters. The test almost always breaks. `go vet` catches it.

**Full:** `sync.WaitGroup` contains an internal counter that all participants must read and modify atomically. Copying the struct duplicates that counter. The `Add` you called on the original is invisible to the copy; the `Done` you called on the copy is invisible to the original. The result is undefined behaviour: `Wait` may return early, may panic with "negative counter," or may hang. The `noCopy` marker in the type causes `go vet` to flag any copy at the call site. Always pass `*sync.WaitGroup`.

---

## 14. Can you reuse a WaitGroup across multiple waves of work?

**Short:** Yes, as long as the test goroutine sequences the waves (Wait fully returns before the next Add).

**Full:** After `wg.Wait` returns, the counter is zero. Calling `Add(M)` in the test goroutine and spawning M new workers is safe — the test goroutine's program order provides the necessary happens-before. The hazard appears when a leftover goroutine from wave N could call `Add` or `Done` while the test goroutine is starting wave N+1; that is a race. In well-formed tests, every goroutine completes (calls `Done`) before `Wait` returns, so the hazard does not arise. Use a fresh WaitGroup per wave only if you cannot guarantee sequential phases.

---

## 15. Describe a complete teardown pattern for a server-style test.

**Short:**

```go
t.Cleanup(func() { goleak.VerifyNone(t) })
ctx, cancel := context.WithCancel(context.Background())
var wg sync.WaitGroup
wg.Add(1)
go func() { defer wg.Done(); s.Run(ctx) }()
t.Cleanup(func() { cancel(); WaitTimeout(t, &wg, 2*time.Second) })
```

**Full:** Three Cleanups, in registration order: `goleak`, `cancel+wait`. They pop in reverse: cancel-and-wait runs first (shuts down the goroutine), then `goleak` verifies there are no leaks. The `WaitTimeout` ensures a stuck shutdown becomes a clean test failure within 2 seconds, not a 10-minute hang. The pattern is mechanical — every server test in the codebase looks like this.

---

## 16. How do you assert "this goroutine should not produce more than N items"?

**Short:** Use `assert.Never` from testify, or polling with a hard cap and a counter.

**Full:** Negative assertions are tricky. You cannot prove "never" — only "not within some window." `assert.Never(t, cond, waitFor, tick)` polls `cond` and fails if it ever becomes true within `waitFor`. The hand-rolled version:

```go
deadline := time.Now().Add(2 * time.Second)
for time.Now().Before(deadline) {
    if items.Count() > N {
        t.Fatalf("produced %d items, want at most %d", items.Count(), N)
    }
    time.Sleep(5 * time.Millisecond)
}
```

The test takes the full window to pass. That is a price negative assertions pay.

---

## 17. Why does `t.Parallel` complicate WaitGroup-based tests?

**Short:** It doesn't, *if* each subtest owns its own WaitGroup. Sharing state across parallel subtests does cause races.

**Full:** `t.Parallel` runs subtests concurrently after the parent's body finishes. Each subtest has its own `*testing.T` and its own goroutine. A WaitGroup declared inside a parallel subtest's body works exactly as in any other test. The trap is when subtests share variables — e.g., a `counter int` declared in the parent and incremented by each parallel subtest. That is a race the race detector catches. Solution: each subtest declares its own state.

---

## 18. What is `synctest` and how does it interact with WaitGroup?

**Short:** A Go 1.24+ package that runs goroutines under a deterministic scheduler with virtual time. WaitGroups inside a `synctest.Run` work normally; `synctest.Wait` is a stronger barrier — it returns only when all goroutines in the bubble are blocked.

**Full:** `testing/synctest.Run(func())` executes its argument in a "bubble" where time is virtual (advances only when no goroutine can run) and the scheduler is deterministic. `sync.WaitGroup` works inside the bubble — `Add`/`Done`/`Wait` behave as in normal Go. The bonus is `synctest.Wait()`, which returns once every goroutine in the bubble is parked (in a channel receive, a mutex, a select, etc.). This is the "quiescent state" assertion many tests want: "has the system settled?" Combine with WaitGroups for hybrid tests where some events are barriers and some require quiescence.

---

## 19. What is the "missing `Add`" bug and how do you find it?

**Short:** Forgetting `wg.Add(1)` before `go func() { defer wg.Done(); ... }()`. Symptoms: counter goes negative on `Done`, `Wait` returns too early.

**Full:** If you forget `Add`, two things happen: `Done` (the deferred call) eventually decrements the counter below zero, triggering `panic: sync: negative WaitGroup counter`. Or, if `Wait` ran first while the counter was still zero (because no `Add` was ever called), `Wait` returns immediately and the test's assertion runs on uninitialised data. The race detector usually catches the latter pattern. Diagnosis: search the test for `wg.Done` and verify each is paired with a matching `Add` in the test goroutine. Tools like `staticcheck`'s `SA1019` family include checks for some WaitGroup patterns.

---

## 20. Why is `runtime.NumGoroutine()` a poor leak detector?

**Short:** It counts, but doesn't identify. Background goroutines (GC, signal handler) change the count for reasons unrelated to your code.

**Full:** `runtime.NumGoroutine()` returns the total number of goroutines, including framework and runtime internals. Comparing before/after counts is noisy: GC may spawn a finalizer goroutine, the timer wheel may add one, the `net` package may keep a pool. A "leak" of 1 may be benign or catastrophic — you cannot tell from the count. `goleak` walks the stacks and excludes known-good goroutines by top-function name, then reports the rest with full stack traces. Always prefer `goleak` for leak detection. Use `NumGoroutine` only for rough sanity checks during debugging.

---

## 21. How would you write a regression test for "this function used to leak"?

**Short:**

```go
func TestParserNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    _, err := Parse(brokenInput)
    if err == nil { t.Fatal("expected error") }
}
```

**Full:** First, write the test to reproduce the leak (it should fail under `goleak`). Confirm by running and seeing the leak's stack trace. Fix the leak in the production code (typically by closing a context or a channel on the error path). Confirm the test passes. Add the test to the package's regression suite. Future refactors that re-introduce the leak fail this test.

---

## 22. Walk me through writing a test for a concurrent map.

**Short:** Race-test pattern: start barrier, N goroutines, each performs reads/writes to a shared map, WaitGroup waits for all, run under `-race -count=100`.

**Full:**

```go
func TestConcurrentMap(t *testing.T) {
    m := NewMap()
    const N = 200
    start := make(chan struct{})
    var wg sync.WaitGroup
    wg.Add(N)
    for i := 0; i < N; i++ {
        i := i
        go func() {
            defer wg.Done()
            <-start
            if i%2 == 0 {
                m.Set(i, i)
            } else {
                _, _ = m.Get(i - 1)
            }
        }()
    }
    close(start)
    testutil.WaitTimeout(t, &wg, 5*time.Second)
}
```

Then `go test -race -run TestConcurrentMap -count=100`. The start barrier gives maximum contention. Reads and writes alternate, so any race between `Set` and `Get` is exercised. The race detector reports any unprotected access to internal map state.

---

## 23. What is the right way to test a publish-subscribe system?

**Short:** WaitGroup for "all subscribers ready," channel for the message, another WaitGroup for "all received."

**Full:** Two barriers, one message. Each subscriber registers, calls `readyWG.Done`, then blocks on its subscription. The test calls `readyWG.Wait` (all subscribed), publishes the message, and calls `recvWG.Wait` (all received). Without the first barrier, the publisher may send before some subscribers have subscribed, and the test silently passes only because the receivers happened to be ready. The two-barrier pattern is deterministic regardless of scheduling.

---

## 24. When is `defer wg.Wait()` at the top of a test wrong?

**Short:** Almost always. The defer runs after the assertions, so the assertions race the goroutines.

**Full:** `defer wg.Wait()` registers `Wait` to run when the test function returns — i.e., *after* the assertions in the test body have run. The order is: spawn goroutines → assertions → return → deferred Wait. The assertions see whatever the goroutines have done so far, which is unpredictable. Use `wg.Wait()` inline, between spawn and assertion. The only legitimate use of `defer wg.Wait()` is in helper functions whose entire body is "spawn goroutines that the caller will wait for" — and even there, the helper should expose the WaitGroup explicitly.

---

## 25. Bonus: What is the single most useful concurrent-testing habit?

**Short:** Banning `time.Sleep` in tests.

**Full:** Almost every concurrent-test bug — flake, false-negative, dropped assertion — traces to a sleep masquerading as a barrier. Banning `time.Sleep` forces every wait to be expressed as either a real event (WaitGroup, channel, polling deadline) or a deliberate negative-test window (`assert.Never`). The discipline costs little and pays back in CI stability for years. A lint rule (`forbidigo` with `time.Sleep` in the deny list) enforces it cheaply. Every senior Go codebase I have worked on has eventually adopted this rule.

---

## Summary

Twenty-five questions, one through-line: tests for concurrent code need *explicit* synchronisation barriers, never `time.Sleep`. The toolbox is small — `sync.WaitGroup`, channels with `select`, `t.Cleanup`, `goleak`, and the `WaitTimeout` helper — and combining them well distinguishes test code that ships from test code that flakes.
