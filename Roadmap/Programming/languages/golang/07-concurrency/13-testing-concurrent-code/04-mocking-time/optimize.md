# Mocking Time — Optimize

How to drive your test suite from minutes to milliseconds when time is involved. Concrete techniques, before/after numbers, and how to spot regression.

## Table of Contents
1. [Measure First](#measure-first)
2. [Replace `time.Sleep` Aggressively](#replace-timesleep-aggressively)
3. [Inject `Clock` and Pay The Once-Off Refactor Cost](#inject-clock-and-pay-the-once-off-refactor-cost)
4. [Pick The Right Library](#pick-the-right-library)
5. [Use `synctest` For Goroutine-Tree Tests](#use-synctest-for-goroutine-tree-tests)
6. [Cut Sleeper-Count Overhead](#cut-sleeper-count-overhead)
7. [Stop Tickers and Timers](#stop-tickers-and-timers)
8. [Parallelism Wins, Until It Doesn't](#parallelism-wins-until-it-doesnt)
9. [CI-Level Tactics](#ci-level-tactics)
10. [Regression Detection](#regression-detection)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)

---

## Measure First

Optimization without measurement is folklore. Before refactoring, get a baseline.

```bash
go test ./... -count=1 -v 2>&1 | tee before.txt
```

Look at the slowest tests:

```bash
go test ./... -count=1 -v 2>&1 | grep -E '--- (PASS|FAIL)' | sort -k 3 -rn -t '(' | head -20
```

Annotate the test file you target with `-timeout` to confirm where the wall time is spent. If a test routinely takes 5 seconds, almost always one of:

- `time.Sleep` to "wait for the goroutine"
- `time.Tick` interacting with real time
- `time.NewTimer` not stopped
- A test that depends on `time.Now()` and is "trying" some duration

Each of these has a fix below.

---

## Replace `time.Sleep` Aggressively

The single biggest win in most projects is removing every real `time.Sleep` from tests.

### Before

```go
func TestX(t *testing.T) {
    go server.Start()
    time.Sleep(100 * time.Millisecond) // wait for server to bind
    callServer()
}
```

100 ms × 100 tests = 10 seconds of CI per suite. Replace with a synchronisation primitive.

### After

```go
func TestX(t *testing.T) {
    ready := make(chan struct{})
    go func() {
        server.Start(ready)
    }()
    <-ready
    callServer()
}
```

`server.Start` closes `ready` once it has bound the port. Wall time drops to a few microseconds and the test is no longer flaky on a loaded CI runner.

### When the production code does not signal ready

Add a callback or a function parameter that signals once the goroutine has done the prerequisite work. This is good design hygiene independent of testing.

---

## Inject `Clock` and Pay The Once-Off Refactor Cost

A test that drives 30 seconds of TTL or 24 hours of cron rules cannot run in wall time. The refactor to inject `Clock` is the largest one-off cost; the running savings are permanent.

### Before

```go
// production
deadline := time.Now().Add(c.ttl)

// test
time.Sleep(c.ttl + time.Second)
```

A 30-second TTL test takes 31 seconds.

### After

```go
// production
deadline := c.clock.Now().Add(c.ttl)

// test
fc.Advance(c.ttl + time.Second)
```

Same test now takes <1 ms.

### Refactor cost

For a 50-package project, maybe a day of work: define the interface, add `WithClock` options, update tests. The benefit accrues forever.

---

## Pick The Right Library

The performance differences between `clockwork`, `benbjohnson/clock`, and `synctest` are small for typical tests but real for outliers.

| Workload | Best choice |
|---|---|
| <100 timers per test | any |
| Hundreds of timers, exact-step assertions | `clockwork` |
| Many goroutines, complex coordination | `synctest` (Go 1.24+) |
| Existing project on Go 1.21 | `clockwork` |
| Library API is third-party `time.Now` | `synctest` |

If you have already paid the `Clock`-interface refactor cost, sticking with `clockwork` is almost always the right call. If you have not refactored and you can require Go 1.24+, jumping straight to `synctest` is cheaper.

---

## Use `synctest` For Goroutine-Tree Tests

A test that exercises 20 cooperating goroutines under `clockwork` requires every one of them to read from the injected clock and the test to track `BlockUntil(n)` counts carefully. `synctest` advances time exactly when the bubble is quiescent — no counting.

### Before (clockwork)

```go
fc.BlockUntil(20) // know exactly how many sleepers
fc.Advance(time.Second)
fc.BlockUntil(20)
fc.Advance(time.Second)
// ... 100 iterations
```

Counting sleepers in a 20-goroutine test is error-prone; one stray ticker and the count changes.

### After (synctest)

```go
synctest.Run(func() {
    startEverything()
    time.Sleep(100 * time.Second) // fake; the runtime advances as needed
    synctest.Wait()
    // assert
})
```

No counting; the runtime handles it. Time advancement is also more efficient — internally `synctest` uses a heap.

---

## Cut Sleeper-Count Overhead

In `clockwork`, every `clock.After`, `NewTimer`, and `NewTicker` adds to a slice. `Advance` is O(n). For thousands of sleepers this matters.

### Use `NewTimer` and `Stop`, not `After`

`After` leaks its sleeper until it fires (no `Stop` method). For a context-cancel-or-timeout idiom, use `NewTimer` and `Stop` on cancel:

```go
t := clock.NewTimer(d)
defer t.Stop()
select {
case <-t.Chan():
case <-ctx.Done():
}
```

This removes the sleeper from `clockwork`'s list immediately on cancel.

### Use `NewTicker` with `Stop`, not `time.Tick`

`time.Tick` cannot be stopped. The Go stdlib documentation says so. A test that uses `time.Tick` permanently inflates sleeper count.

### Consolidate timers

If your code has 100 goroutines each waiting on `clock.After(time.Second)`, consider a single ticker shared across them. Less sleeper bookkeeping, less production-time goroutine churn.

---

## Stop Tickers and Timers

Even on a fake clock, leaving tickers running across tests is sloppy. The next test may receive stale ticks if you reuse the clock.

### `t.Cleanup` pattern

```go
func TestX(t *testing.T) {
    fc := clockwork.NewFakeClock()
    ticker := fc.NewTicker(time.Second)
    t.Cleanup(ticker.Stop)
    // ...
}
```

`t.Cleanup` runs after the test even on failure.

### Stop on context cancel

Hard rule: every timer or ticker your production code creates is stopped on a code path that runs when the goroutine exits.

---

## Parallelism Wins, Until It Doesn't

`go test ./... -parallel N` runs N tests at once. With fake clocks, parallel tests do not interfere as long as each has its own clock. The CPU is the bottleneck.

### Default GOMAXPROCS

Go uses `runtime.NumCPU()` as the parallelism default. On a CI runner with 8 cores, 8 tests run at once. For pure CPU-bound tests this is ideal.

### Parallel tests sharing a clock = no

Already covered, repeat: each `t.Parallel` test owns its `FakeClock`.

### Subtests with `t.Run`

`t.Run` creates a subtest with its own scope. Subtests can also be parallel. Use one fake clock per subtest if their assertions don't overlap.

---

## CI-Level Tactics

### Run flaky tests in a budget

`go test -count=10` catches flakes that pass on `-count=1`. Schedule a daily job that runs `-count=100` and reports any test that fails at least once.

### Race detector on time-sensitive tests

`go test -race` is 5–10× slower but catches data-race bugs that fake clocks can mask (because the test runs fast enough to dodge the race). Run on every PR.

### Build-tag time-heavy tests

```go
//go:build slowtime
```

If a test really needs real time (e.g., integration with a third-party service), tag it and run only in the integration job. Keep the fast suite fast.

### Profile your suite

```bash
go test ./... -cpuprofile cpu.out -count=1
go tool pprof cpu.out
```

If `time.Sleep` shows up, you have low-hanging fruit.

---

## Regression Detection

How do you keep `time.Sleep` from sneaking back in?

### Lint rule

Add a `staticcheck` config or `golangci-lint` rule disallowing `time.Sleep` in test files. Pattern:

```yaml
linters-settings:
  forbidigo:
    forbid:
      - p: '^time\.Sleep$'
        msg: "use clock.Sleep or fc.Advance; no real sleeps in tests"
        pkg: '.*_test'
```

### CI step: measure test duration

Track the slowest test per PR. Fail the build if it grew by more than 50% without justification.

### Code review checklist

When reviewing a PR that touches a `*_test.go` file:

1. Does it call `time.Sleep`? Block.
2. Does it call `time.Now`? Investigate — maybe legitimate, maybe missed injection.
3. Does it use a fake clock without `BlockUntil`? Investigate for races.
4. Does it spawn a goroutine and not synchronise its exit? Test will be flaky.

---

## Cheat Sheet

```text
BIGGEST WINS:
  - Replace time.Sleep with channels and Advance
  - Inject Clock at every constructor that uses time
  - Use synctest (Go 1.24+) for goroutine-tree determinism

LIBRARY HOT PATHS:
  - Use NewTimer + Stop, not After (After leaks)
  - Use NewTicker + Stop, never time.Tick
  - t.Cleanup(ticker.Stop) in every test

SUITE HYGIENE:
  - One FakeClock per t.Parallel test
  - One Clock per process; pass it through the tree
  - synctest.Run for any test with >5 goroutines

CI:
  - go test -count=10 catches flakes
  - go test -race catches sneak-by data races
  - profile and watch for time.Sleep showing up

LINT:
  - forbid time.Sleep in *_test.go
  - track per-test duration; fail on >50% growth

RESULT:
  - 30-second TTL tests run in <1 ms
  - 24-hour cron tests run in <10 ms
  - flake rate drops to ~zero on time-dependent assertions
```

---

## Summary

The optimization curve for time-dependent tests is steep at first — refactor production to take a `Clock`, replace `time.Sleep` with channel synchronisation, choose between `clockwork` and `synctest`. After that, gains accrue forever: every new test in your suite is millisecond-fast and deterministic. The follow-up work is hygiene: stop tickers, use `NewTimer` over `After`, give each parallel test its own clock, and add a lint rule that forbids `time.Sleep` in tests so the wins do not erode. Profiling and `-count` runs in CI catch regression early. The end state is a suite where time is one of the boring, fast parts of the build, not the source of flakes and minutes-long delays.
