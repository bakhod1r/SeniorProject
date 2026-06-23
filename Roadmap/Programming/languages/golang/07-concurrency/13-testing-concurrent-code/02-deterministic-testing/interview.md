# Deterministic Testing — Interview Questions

A grouped list of questions you should be ready to answer. Junior questions are five-minute warm-ups; senior questions test architectural thinking.

---

## Junior Questions

### Q1. What makes a test flaky?

A flaky test gives different outcomes — pass or fail — across runs on the same code and same input. The cause is a hidden dependency on scheduler order, wall-clock time, environment state, or external systems. In concurrent Go code, the most common cause is asserting on shared state without synchronising the assertion with the goroutine that produces the state.

### Q2. Why is `time.Sleep` a problem in tests?

`time.Sleep` is a guess about how long an operation takes. On a fast machine the guess works; on a slow CI runner under contention it does not. Sleep does not synchronise; it merely makes the bug less frequent. Replace with a channel barrier, a `WaitGroup`, or a fake-clock advance.

### Q3. How do you wait for a single goroutine to finish in a test?

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
<-done
```

The receive blocks until the goroutine closes `done`. No timing involved.

### Q4. How do you wait for N goroutines?

```go
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

`wg.Wait()` blocks until every `wg.Done()` has been called.

### Q5. What does `go test -count=100` do?

Runs each test 100 consecutive times in the same binary. Useful for catching tests that fail one time in many. Combined with `-race`, it is the standard flake-hunting command.

### Q6. Is `GOMAXPROCS=1` a fix for flakes?

No. It reduces parallelism but the scheduler still preempts. A test that "passes only on `-cpu 1`" still has a non-determinism bug; you have hidden the symptom by removing concurrency.

### Q7. What happens if you `<-` from a nil channel?

The receive blocks forever. The test hangs and CI eventually times out. Always initialise channels with `make(chan T)`.

### Q8. What happens if you close a channel twice?

Panic: "close of closed channel." Close exactly once, from the sender side.

---

## Middle Questions

### Q9. What does `testing/synctest.Run` do?

`Run(f)` creates a *bubble*: f and any goroutines it starts run inside the bubble. Inside, `time.Now`, `time.Sleep`, timers, tickers, and context deadlines all use a virtual clock that advances only when every bubble goroutine is blocked. When `Run` returns, all bubble goroutines must have exited; otherwise the runtime panics. The result is deterministic, virtual-time concurrent testing.

### Q10. What does `synctest.Wait` do?

Blocks the caller until every other bubble goroutine is blocked on a bubble-aware operation. While waiting, the runtime advances the virtual clock and fires timers to make further progress possible. When `Wait` returns, the system is quiescent — a safe moment for assertions.

### Q11. Why is `synctest` Go 1.24+ only?

It requires a runtime-level scheduler change: the runtime needs to track which goroutines belong to which bubble and increment/decrement an "active" counter at every blocking operation. This is not implementable as a normal library.

### Q12. When would you use a fake clock instead of `synctest`?

When your project does not run on Go 1.24+. Or when your code interacts with parts of the standard library that `synctest` does not yet virtualise (real I/O). A fake `Clock` interface gives you control over `time.Now`, `time.Sleep`, and timers without the runtime support.

### Q13. Show how you would test a cache with TTL deterministically.

Inject a `Clock` interface. In production, wire a real clock. In tests, wire a fake clock (e.g., `clockwork.NewFakeClock()`). Set a value with a 10-second TTL, assert it is present, advance the fake clock 5 seconds, assert still present, advance 6 more, assert expired. Total wall-clock duration: microseconds.

### Q14. What is a quiescent state?

A moment when every goroutine in the test is blocked or has exited — no goroutine is making progress. It is the right moment for the test to read state and assert. `synctest.Wait` is the runtime-backed way to detect quiescence.

### Q15. Why is `BlockUntilContext` (or similar) needed in `clockwork`?

To prevent the test from advancing the clock before the goroutine has subscribed to a timer. If the test advances first, the goroutine's subsequent `clock.After` returns a timer that the test will never advance further, so the goroutine hangs.

### Q16. How do you make a property test reproducible?

Seed the random source with a fixed value, log the seed, and provide a `-seed=N` flag to replay. On failure, the test prints the seed; you re-run with that seed to deterministically reproduce.

### Q17. What does `-cpu 1,2,4,8` do?

Runs each test four times, once with `GOMAXPROCS` set to 1, 2, 4, 8. Catches tests that pass at one parallelism but fail at another. A nightly CI job that runs the concurrent suite with `-race -count=20 -cpu 1,2,4,8` is a strong flake gate.

### Q18. Can `synctest` virtualise `net.Dial`?

No. Real I/O is opaque to the bubble. Use a fake `net.Conn` or, better, an interface that abstracts the I/O so a test double can replace it.

---

## Senior Questions

### Q19. You join a team where flaky tests are common. What is your plan?

1. Inventory: list every flaky test. Triage by impact.
2. For each, find the root cause: sleep, scheduler assumption, real-time assertion, leaked goroutine, shared global. Fix or quarantine.
3. Add `goleak.VerifyTestMain` to every package.
4. Add a CI gate: `-race` on every PR, no exceptions.
5. Add a nightly stress job: `-race -count=50 -cpu 1,2,4,8`.
6. Add a flake-rate dashboard with per-test history.
7. Add a linter rule banning `time.Sleep` in `_test.go`.
8. Educate: deterministic patterns become the team norm.

### Q20. Design a `Clock` interface for production use.

```go
type Clock interface {
    Now() time.Time
    Since(time.Time) time.Duration
    Sleep(time.Duration)
    After(time.Duration) <-chan time.Time
    NewTimer(time.Duration) Timer
    NewTicker(time.Duration) Ticker
    AfterFunc(time.Duration, func()) Timer
}

type Timer interface {
    C() <-chan time.Time
    Stop() bool
    Reset(time.Duration) bool
}
```

Production: a real implementation backed by `time`. Tests: a fake with `Advance(d)` and `BlockUntilSubscribers(n)`. Enforce the boundary with a linter: no direct `time.X` calls outside this package.

### Q21. How do you test a leader election protocol deterministically?

Run the candidate nodes as goroutines in a single test. Inject a fake network with controllable delivery and ordering. Inject a fake clock for heartbeat timeouts. Drive scenarios — node A becomes leader, partition, node B takes over, healing, etc. — by advancing time and tweaking network reachability. The whole test runs in microseconds and is fully reproducible.

### Q22. When would you use scheduler shuffling (chaos)?

To find bugs that depend on unusual interleavings. After regular determinism work, a nightly chaos job sprinkles `runtime.Gosched` and yields throughout test code to explore more interleavings. Combined with `-race`, this catches races your deterministic harness might mask.

### Q23. A test passes on your laptop, fails in CI. How do you diagnose?

In order: (a) Look for `time.Sleep` or duration assertions — most likely cause. (b) Check `-cpu` settings — CI may be running parallelism your laptop isn't. (c) Examine for global state — CI runs more in parallel. (d) Run the test 100 times locally with `-race`; if it fails, you found it. (e) Add tracing or `-cpuprofile` to see what is happening. (f) Suspect external dependencies — CI sandbox may behave differently.

### Q24. Discuss the trade-offs of `synctest` vs `loom` (Rust).

`synctest` is fast (one interleaving, deterministic, virtual time) and easy to use. `loom` explores many interleavings (model checking) and finds bugs invisible to `synctest`. `loom` is slow and harder to write tests for. Choose `synctest` for everyday testing; reach for model-checking tools when correctness matters more than test cost.

### Q25. What is the relationship between `-race` and determinism?

Complementary. `-race` finds data races regardless of test determinism. Deterministic tests catch ordering and timing bugs `-race` cannot see. A test that passes `-race -count=1000` is strongly correct; one missing either is suspicious.

### Q26. How would you test a circuit breaker?

Inject a fake clock and an injectable downstream. Drive: trigger N failures, observe the breaker opens, advance the clock past the half-open window, send a probing call, observe behaviour, repeat. Inside `synctest.Run`, this is a 50-line test that runs in microseconds.

---

## Tricky / Trap Questions

### Q27. "If I sleep 10 seconds, my test definitely waits long enough."

Trap. CI runners under load can pause goroutines longer than 10 seconds. There is no "long enough." Use a barrier.

### Q28. "I added `runtime.Gosched()`; now my test is deterministic."

Trap. `Gosched` is a hint. The scheduler does not promise to switch goroutines. Even if it does, the order is not guaranteed.

### Q29. "Can `synctest` detect data races?"

No. `synctest` controls scheduling and time; the race detector (`-race`) finds racing memory accesses. Use both.

### Q30. "Can I nest `synctest.Run`?"

No. Nesting panics. Use one bubble per test.

### Q31. "Does `synctest.Wait` give me a sub-millisecond wait?"

It gives you the quiescent state instantly in wall-clock terms. It is not a delay; it is a condition wait.

### Q32. "If I `defer cancel()` inside a bubble, do I need to wait?"

Yes — wait for the goroutines that observed the cancellation to exit. `defer cancel()` does not wait for them.

### Q33. "Why does my test pass with `-count=1` but fail with `-count=100`?"

Either:
- A test leaves global state behind that the next iteration sees.
- A test depends on a particular goroutine scheduling that happens early in the binary.
- A goroutine leak accumulates over iterations.

Find the culprit by running with `-count=10`, `-count=20`, etc., and observing where it starts to fail. Use `goleak`.

### Q34. "My test asserts `elapsed > 100*time.Millisecond` and sometimes fails because `elapsed = 99ms`."

Wall-clock duration is not a stable test target. Use virtual time and assert exact equality, or remove the assertion.

### Q35. "Is `t.Parallel()` safe with `testing/synctest`?"

Yes. Each parallel test gets its own bubble. The bubbles are independent.

---

## Take-home Coding Prompt

**Prompt:** Given this flaky test, rewrite it to be deterministic. You may use `testing/synctest` if Go 1.24+, otherwise inject a clock. Explain your choices.

```go
func TestThrottle_Flaky(t *testing.T) {
    th := NewThrottle(100 * time.Millisecond)
    var hits int32
    for i := 0; i < 5; i++ {
        go func() {
            if th.Allow() {
                atomic.AddInt32(&hits, 1)
            }
        }()
    }
    time.Sleep(200 * time.Millisecond)
    if got := atomic.LoadInt32(&hits); got != 1 {
        t.Fatalf("got %d want 1", got)
    }
}
```

A passing rewrite using `synctest`:

```go
func TestThrottle_Deterministic(t *testing.T) {
    synctest.Run(func() {
        th := NewThrottle(100 * time.Millisecond)
        var hits int32
        var wg sync.WaitGroup
        for i := 0; i < 5; i++ {
            wg.Add(1)
            go func() {
                defer wg.Done()
                if th.Allow() {
                    atomic.AddInt32(&hits, 1)
                }
            }()
        }
        wg.Wait()
        if got := atomic.LoadInt32(&hits); got != 1 {
            t.Fatalf("got %d want 1", got)
        }
    })
}
```

Choices explained:
- `synctest.Run` removes wall-clock dependency.
- `WaitGroup.Wait` is a clean barrier.
- No `time.Sleep` anywhere.
- Test runs in microseconds.

End of interview prompts.
