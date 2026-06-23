# Mocking Time — Interview Questions

## Table of Contents
1. [Warm-Up](#warm-up)
2. [Design Questions](#design-questions)
3. [Library Questions](#library-questions)
4. [Pitfall Questions](#pitfall-questions)
5. [Code-Reading Questions](#code-reading-questions)
6. [Open-Ended / Architecture](#open-ended-architecture)

---

## Warm-Up

### Q1. Why is `time.Sleep` in a test a code smell?

**Answer.** It commits the test to real wall time. Five seconds in a single test multiplied across 1,000 tests is 1.4 hours of CI. It is also flaky: under CI load `time.Sleep(10*time.Millisecond)` is no guarantee that "the background job has had a chance to run." Replace with channels, `sync.WaitGroup`, or fake-clock primitives.

### Q2. What does it mean to "inject a clock"?

**Answer.** Instead of calling `time.Now()` directly, the function or type accepts a `Clock` interface value as a parameter (typically at construction). Production wires a real implementation that delegates to `time`; tests wire a fake implementation whose time only advances when the test calls `Advance(d)`.

### Q3. Name three libraries or stdlib packages used to mock time.

**Answer.** `github.com/jonboulle/clockwork`, `github.com/benbjohnson/clock`, and Go 1.24's `testing/synctest`.

### Q4. What does `clockwork.NewFakeClock` start at?

**Answer.** `time.Now()` captured once at construction. Use `NewFakeClockAt(t)` for a deterministic start.

### Q5. What is the difference between `clockwork.Advance` and `clock.Mock.Add`?

**Answer.** Functionally none; they are the same operation in two different libraries (`clockwork` and `benbjohnson/clock`).

---

## Design Questions

### Q6. You have a TTL cache. How would you design it for testability?

**Answer.** Take a `Clock` in the constructor, ideally as a functional option that defaults to a real clock. Every call to "now" in the implementation goes through that field. The background sweep goroutine, if any, uses `clock.NewTicker` rather than `time.Tick`. Tests construct the cache `WithClock(clockwork.NewFakeClock())`, advance the clock, and assert.

### Q7. Why is it bad to pass `now time.Time` as a function parameter instead of a Clock?

**Answer.** The function loses the ability to do its own time-driven work (`After`, `NewTimer`), every caller has to remember to pass a consistent `now`, and the API surface grows. A `Clock` is a long-lived dependency injected once.

### Q8. How do you make `context.WithTimeout` work with fake time?

**Answer.** `context.WithTimeout` uses `time.Now` and a real timer, so it is not affected by a fake clock you injected separately. Two options:

1. Use Go 1.24's `testing/synctest`: inside the bubble, `time.Now` is fake, so `context.WithTimeout` becomes fake automatically.
2. Provide a helper like `CancelOn(ctx, clock, d)` that uses your fake clock and cancels manually.

### Q9. Should every package define its own `Clock` interface?

**Answer.** For a small library, yes — it documents what the package actually depends on. For a large application, prefer a shared interface (or import `clockwork.Clock`) so a single fake works everywhere.

### Q10. How do you handle a third-party library that calls `time.Now` internally with no way to inject?

**Answer.** Either fork (last resort), wrap (use the library only behind your own interface that calls it on demand and use a real clock at that boundary), or use `testing/synctest` so the library's `time.Now` is faked at runtime.

---

## Library Questions

### Q11. What is `BlockUntil(n)`?

**Answer.** A `clockwork.FakeClock` method that blocks the calling goroutine until at least `n` sleepers (from `After`/`NewTimer`/`NewTicker`/`AfterFunc`/`Sleep`) are currently registered. It prevents the race where `Advance` fires nothing because the production code has not yet armed its timer.

### Q12. Does `benbjohnson/clock` have a `BlockUntil` equivalent?

**Answer.** Not in v1.3. Tests typically use a tiny real `time.Sleep` between arming and `Add` (fragile), or use a fork that adds the feature.

### Q13. What does `testing/synctest.Run(f)` do?

**Answer.** Runs `f` in an isolated "bubble" goroutine. All goroutines spawned inside (transitively) share a fake clock; `time.Now`, `time.Sleep`, etc. consult it. The runtime advances the fake clock automatically whenever every goroutine in the bubble is durably blocked.

### Q14. When can `synctest` not advance time?

**Answer.** When at least one goroutine in the bubble is *not* durably blocked — typically because it is performing real I/O (`net.Dial`, file reads, syscalls) or is in cgo. Time stalls until that goroutine durably blocks again.

### Q15. Compare `clockwork`, `benbjohnson/clock`, and `synctest` in one sentence each.

**Answer.**
- `clockwork`: most-used userland fake clock; exact `Advance`, `BlockUntil`, mature.
- `benbjohnson/clock`: older userland alternative; similar surface, no built-in `BlockUntil`.
- `testing/synctest`: Go 1.24+ stdlib; fakes the actual `time` package inside a bubble, no interface needed.

### Q16. Can `clockwork.Advance` accept a negative duration?

**Answer.** Yes. The clock moves backwards. No sleepers are *un-fired*; only forward-fires happen. Useful for testing NTP step-back behaviour.

### Q17. What is the cost of injecting `Clock` in production code?

**Answer.** One extra interface call per `Now`/`Sleep`/etc. The compiler often inlines monomorphic interface calls; even when it does not, the overhead is single-digit nanoseconds.

---

## Pitfall Questions

### Q18. A test passes locally but flakes 1% of the time on CI. The code uses `clockwork`. Where do you look first?

**Answer.** Missing `BlockUntil` before `Advance`. The production code arms its timer in a separate goroutine, and on a loaded CI runner the scheduler can let `Advance` run before the timer is armed, firing nothing.

### Q19. Why is the following test buggy?

```go
ran := false
fc.AfterFunc(time.Second, func() { ran = true })
fc.Advance(time.Second)
if !ran { t.Fatal("...") }
```

**Answer.** `AfterFunc`'s callback runs on the fake clock's internal goroutine. The test reads `ran` from the test goroutine. Two issues: (1) data race on `ran`; (2) the callback may not have completed by the time `Advance` returns. Fix with a channel:

```go
done := make(chan struct{})
fc.AfterFunc(time.Second, func() { close(done) })
fc.Advance(time.Second)
<-done
```

### Q20. The test below sometimes hangs. Why?

```go
go func() { _ = c.Get("k") }() // Get calls fc.Sleep(time.Second) internally
fc.Advance(time.Second)
```

**Answer.** `Get` may not have reached `fc.Sleep` by the time `Advance` runs. The goroutine is still scheduling. Add `fc.BlockUntil(1)` before `Advance`.

### Q21. What does `synctest.Run` do with a goroutine started *before* the `Run` call?

**Answer.** It is not in the bubble. It runs on real time. Any `time.Now` call returns real time, and the bubble cannot advance time while it makes progress.

### Q22. A test under `synctest` hangs at `time.Sleep`. The hung goroutine is doing `net.Dial`. Why?

**Answer.** `net.Dial` is a syscall and is not durably blocked from the bubble's perspective. The runtime cannot advance the fake clock while a goroutine might unblock at any moment. The test hangs because real-time progress is required for `net.Dial` to complete and the test's real-time budget expires.

### Q23. Why is monkey-patching `time.Now` (e.g., `gomonkey`) a poor choice?

**Answer.** Fragile across Go versions, architecture-specific, unsafe under `-race`, broken by inlining, process-wide so parallel tests fight, and may violate W^X on hardened platforms. Use a `Clock` interface or `synctest`.

---

## Code-Reading Questions

### Q24. Read this and identify the bug.

```go
type Cache struct { clock Clock; ttl time.Duration }
func (c *Cache) Set(k, v string) { /* ... uses c.clock.Now ... */ }
func (c *Cache) cleanupLoop() {
    for range time.Tick(time.Minute) {
        c.evictExpired()
    }
}
```

**Answer.** `cleanupLoop` uses `time.Tick`, not `c.clock.NewTicker`. The cache reads time from the injected clock, but the cleanup loop reads from real time. A fake-clock test never triggers `cleanupLoop`. Replace with `c.clock.NewTicker(time.Minute)`.

### Q25. Is this test deterministic? Why or why not?

```go
func TestRetry(t *testing.T) {
    fc := clockwork.NewFakeClock()
    go retry(fc, op)
    fc.Advance(time.Second)
    fc.Advance(time.Second)
    fc.Advance(time.Second)
    // assert
}
```

**Answer.** No. `retry` arms its first timer in the goroutine, and there is a race between arming and the first `Advance`. The test passes most of the time but flakes. Add `BlockUntil(1)` before each `Advance` and verify each iteration.

### Q26. What is wrong with this rate-limiter test?

```go
func TestLimiter(t *testing.T) {
    fc := clockwork.NewFakeClock()
    l := New(fc, 1, 5)
    for i := 0; i < 100; i++ {
        l.Allow()
        time.Sleep(10 * time.Millisecond) // small wait
    }
    // assert tokens
}
```

**Answer.** Real `time.Sleep` is being used in a fake-clock test. The limiter sees no fake-time passage, so no tokens refill. The test runs slowly and is essentially testing only the burst behaviour. Replace with `fc.Advance(10 * time.Millisecond)`.

### Q27. Read this and identify what is right and wrong.

```go
synctest.Run(func() {
    server := startServer()
    resp, _ := http.Get("http://" + server.Addr())
    _ = resp
})
```

**Answer.** Right idea (test inside a bubble), wrong setup. `http.Get` performs a real network call, which is not durably blocked from `synctest`'s view. The bubble cannot advance fake time while the call is in flight. Either run the server in-memory (via `httptest.Server`) inside the bubble, or use a `RoundTripper` that does in-memory transport.

### Q28. Spot the leak.

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-clock.After(time.Hour):
        process()
    }
}
```

**Answer.** Each iteration that picks `ctx.Done` leaks the `After`'s underlying timer until `time.Hour` elapses. Use `NewTimer` and `Stop` it on cancel:

```go
t := clock.NewTimer(time.Hour)
for {
    select {
    case <-ctx.Done():
        t.Stop()
        return
    case <-t.Chan():
        process()
        t.Reset(time.Hour)
    }
}
```

---

## Open-Ended / Architecture

### Q29. You are migrating a large codebase to be fake-clock-testable. How do you stage the work?

**Answer.** (Sample answer.)
1. Pick one library (`clockwork`) and put it in `go.mod`.
2. Define or import the `Clock` interface and add it as a functional option on every constructor that currently calls `time.Now`. Default to a real clock.
3. Add a project-wide `internal/testclock.New(t)` helper.
4. Migrate one subsystem per PR. Tests in that PR use `WithClock(testclock.New(t))`.
5. Add a `staticcheck` or custom analyzer rule that forbids `time.Now` outside `main` and the `internal/clock` package.
6. Once everything is migrated, consider opting selected end-to-end tests into `synctest` for goroutine-tree determinism.

### Q30. Design a fake clock that supports per-goroutine time skew, for testing a distributed system.

**Answer.** Sketch:

- A central registry of per-node `FakeClock` instances.
- Each `Clock` value carries a node ID.
- `Now()` returns `nodeOffset[nodeID] + sharedNow`.
- `Advance(d)` advances `sharedNow` and fires sleepers; node-specific offset is a static skew.
- For tests of NTP-correction protocols, provide `SetOffset(nodeID, d)` to apply discrete jumps.
- All sleepers carry their node's effective `now`; advancing fires only those whose `deadline ≤ effectiveNow`.

This is more complex than off-the-shelf clocks but is what large distributed-system test suites build internally.

### Q31. You are reviewing a PR that adds a new feature with a background goroutine using `time.Tick`. The author argues "the existing code uses `time.Now()` everywhere; one more is fine." Argue your position.

**Answer.** Today's PR adds a goroutine. A future test that wants to verify the new feature will block on real wall-time ticks. The author has paid the design cost; the test author will pay the runtime cost across every future CI run, every developer's local run, every flaky build. The marginal change is asymmetric: a small refactor now (inject a `Clock`) versus a permanent tax. Ask for the refactor or, if the codebase is genuinely not ready, for an issue tracking the migration.

### Q32. When is `testing/synctest` *not* the right answer?

**Answer.**
- When you must support Go 1.21 (synctest is 1.24+).
- When the system under test does real I/O that you cannot replace with an in-memory shim.
- When you need exact-boundary assertions and want to step the clock by precise increments rather than letting the runtime decide.
- When the test is dominated by code outside Go, e.g., cgo.
- When you are testing library code that does not own its goroutines and cannot be wrapped in `Run`.

For everything else `synctest` is excellent.
