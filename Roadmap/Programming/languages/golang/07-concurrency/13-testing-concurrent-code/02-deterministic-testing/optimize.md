# Deterministic Testing — Optimisation Guide

A deterministic test does not need to be slow. Most of this guide is about making determinism cheap to operate. Sleep-free, virtual-time, parallel-safe tests can be the *fastest* tests in your suite.

---

## Table of Contents
1. [Baseline: How Slow Is "Slow"?](#baseline-how-slow-is-slow)
2. [Replace `time.Sleep` with Barriers — Speed Wins](#replace-timesleep-with-barriers-speed-wins)
3. [Virtual Time Wherever Possible](#virtual-time-wherever-possible)
4. [Parallel Bubbles with `t.Parallel`](#parallel-bubbles-with-tparallel)
5. [Reducing Goroutine Count in Tests](#reducing-goroutine-count-in-tests)
6. [Tuning `-count` for Stress Without Pain](#tuning--count-for-stress-without-pain)
7. [Per-CPU Test Sharding](#per-cpu-test-sharding)
8. [Caching Test Fixtures](#caching-test-fixtures)
9. [Profiling Test Execution](#profiling-test-execution)
10. [`-race` Overhead and Mitigations](#-race-overhead-and-mitigations)
11. [CI Pipeline Layout](#ci-pipeline-layout)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Baseline: How Slow Is "Slow"?

Before optimising, measure. Typical wall-clock budgets:

- **Unit test (single function):** under 10ms.
- **Unit test with one goroutine:** under 50ms.
- **Integration test with database:** under 1s.
- **Full suite (medium service):** under 60s.

Any test outside these envelopes is a candidate for optimisation. Use:

```
go test -v -run TestSpecific ./pkg
```

The `-v` flag shows per-test duration. Sort by duration and look at the top ten. Most of the time, a `time.Sleep` is hiding in one of them.

---

## Replace `time.Sleep` with Barriers — Speed Wins

The single biggest speedup is removing sleeps. A test that sleeps 100ms × 50 tests = 5 seconds of pure waste per CI run.

### Before

```go
go worker()
time.Sleep(100 * time.Millisecond)
assert(...)
```

### After

```go
done := make(chan struct{})
go func() {
    worker()
    close(done)
}()
<-done
assert(...)
```

Same correctness, microseconds instead of 100ms. Across a suite, this can cut total CI time by 30–60%.

---

## Virtual Time Wherever Possible

Wherever you currently use real `time.Sleep` (in production code under test) or `time.After`, consider:

- Inside `synctest.Run`, both return instantly in wall-clock terms.
- Outside `synctest`, an injected `Clock` with `Advance(d)` does the same.

A test that exercises a 30-minute backoff in `synctest` runs in microseconds. The same test with real sleeps would take 30 minutes (or be untestable).

### Quick wins

- Move any `time.Sleep`-based test inside `synctest.Run`.
- Refactor production code that calls `time.Now` to accept a `Clock`.
- Replace `time.After` in selects with `clock.After`.

---

## Parallel Bubbles with `t.Parallel`

Each `synctest.Run` creates an independent bubble. Two bubbles in two parallel tests share nothing — the runtime scheduler runs them concurrently on different cores.

```go
func TestThings(t *testing.T) {
    t.Run("a", func(t *testing.T) {
        t.Parallel()
        synctest.Run(func() { ... })
    })
    t.Run("b", func(t *testing.T) {
        t.Parallel()
        synctest.Run(func() { ... })
    })
}
```

On a 16-core machine, 16 bubbles run in parallel. The test suite scales linearly.

Caveats:

- Each subtest must own its fixtures. No shared mutable state.
- File system, network, database fixtures should be isolated (temp dirs, sandboxes).
- `t.Parallel()` runs *after* the surrounding test setup; structure accordingly.

---

## Reducing Goroutine Count in Tests

Some tests spawn far more goroutines than needed. Each goroutine has overhead — stack allocation, scheduler bookkeeping, race-detector tracking under `-race`.

### Anti-pattern

```go
for i := 0; i < 10000; i++ {
    go work(i)
}
```

In a test, 10,000 goroutines may be overkill. Twenty often demonstrates the same property.

### Heuristic

Use the smallest goroutine count that still exercises the behaviour:

- For concurrency correctness: 2–4 goroutines.
- For load-style behaviour: 8–32.
- For stress: 1000+, but as a separate `_stress_test.go` not in the default suite.

The race detector slows test by 5–20× per memory access. Fewer goroutines = fewer accesses = faster `-race` runs.

---

## Tuning `-count` for Stress Without Pain

`-count=N` runs each test N times. Useful for catching flakes, painful for CI duration.

### Tiers

- **PR gate:** `-count=1` or `-count=5`. Fast, catches obvious flakes.
- **Nightly:** `-count=50` or `-count=100`. Catches rare flakes.
- **Weekly stress:** `-count=1000` on critical concurrent packages only. Catches very rare flakes.

Split the suite:

- `./internal/concurrent/...` — high `-count` nightly.
- `./internal/utils/...` — `-count=1` is enough.

A `-count` budget per package makes the overall suite manageable.

---

## Per-CPU Test Sharding

`go test -cpu 1,2,4,8` runs each test once per `GOMAXPROCS` setting. Multiplies the suite cost by 4. To avoid CI delay, parallelise across CI runners:

- Runner 1: `-cpu 1`
- Runner 2: `-cpu 2`
- Runner 3: `-cpu 4`
- Runner 4: `-cpu 8`

Each runner takes the same time as the original suite. Total wall-clock cost: unchanged.

---

## Caching Test Fixtures

If your tests construct expensive fixtures (large maps, file system trees, mock objects), cache them across test runs in the same process:

```go
var bigFixture = sync.OnceValue(func() *Fixture { return makeBigFixture() })

func TestX(t *testing.T) {
    f := bigFixture()
    ...
}
```

`sync.OnceValue` (Go 1.21+) constructs once per process. Subsequent tests reuse. Speedup is proportional to fixture-build cost.

For per-test isolation, copy from the cached fixture:

```go
f := bigFixture().Clone()
```

`Clone` should be cheap relative to construction.

---

## Profiling Test Execution

When a test is slow, profile it:

```
go test -cpuprofile=cpu.out -run TestSlow ./pkg
go tool pprof -http=:8080 cpu.out
```

The flame graph shows where time goes. Common culprits:

- `time.Sleep` calls (visible as `runtime.gopark` from `time.Sleep`).
- Slow setup (allocations, JSON unmarshalling, regex compilation).
- Repeated work that could be cached.

For test runtime in CI, add JSON output and a custom analyser:

```
go test -json ./... > results.json
jq '.[] | select(.Action == "pass") | {test: .Test, elapsed: .Elapsed}' results.json
```

Sort by elapsed. Optimise the slowest ten.

---

## `-race` Overhead and Mitigations

The race detector adds 5–20× CPU overhead and ~10× memory overhead. Mitigations:

- Run `-race` on a smaller subset on PR (just changed packages), full `-race` nightly.
- Ensure tests are short so the overhead is acceptable.
- Reduce in-test goroutine counts (see above).
- Use `-race` with `-count=1`, not `-count=100`. For stress, `-count=100` without `-race`. Combine on nightly.

A balanced pipeline:

- PR: `go test ./...` (no race), `go test -race ./pkg/changed/...` (race on changed packages).
- Nightly: `go test -race -count=50 ./...`.
- Weekly: `go test -race -count=1000 ./internal/concurrent/...`.

---

## CI Pipeline Layout

A complete pipeline for a medium service:

```
PR (gate, fast):
    go vet ./...
    go test ./...                  # 60s budget
    go test -race ./pkg/changed/... # 90s budget

Main (post-merge):
    go test -race -count=10 ./...
    go test -race -cpu 1,4 -count=10 ./internal/concurrent/...

Nightly:
    go test -race -count=50 -cpu 1,2,4,8 ./...
    goleak suite (verify no leaks)

Weekly stress:
    go test -race -count=1000 ./internal/concurrent/...
    Chaos mode (random scheduler shuffles)
    Property tests with high N
```

Optimised: PR is fast (gating cost minimal); rare flakes caught nightly; very rare flakes caught weekly. Total cost manageable.

---

## Specific Optimisation Recipes

### Recipe 1: Cut a 5-second test to 5 milliseconds

A test with 50 `time.Sleep(100ms)` calls. Move into `synctest.Run`. Done.

### Recipe 2: Cut a 100-test package's CI time in half

Replace every `time.Sleep` with a barrier. Replace every long-duration assertion with virtual time. Run with `t.Parallel()` on every test.

### Recipe 3: Cut `-race` budget

Reduce goroutine counts in tests from 1000 to 32. The race detector tracks fewer accesses. Test should still demonstrate the property; concurrency at 32 is not visibly different from 1000 for correctness purposes.

### Recipe 4: Cut `-count=100 -race` time

Split critical concurrent tests into a separate package, run `-count=100` only there. Skip other packages.

### Recipe 5: Speed up integration tests

If integration tests construct database fixtures, share a single read-only fixture across all tests in a package. Each test wraps in a transaction and rolls back.

---

## Self-Assessment

- [ ] My suite has zero `time.Sleep` calls in `_test.go`.
- [ ] My time-dependent tests use `synctest.Run` or an injected `Clock`.
- [ ] My tests use `t.Parallel()` and pass `-race`.
- [ ] My CI separates PR gate from nightly stress.
- [ ] My nightly stress includes `-cpu 1,2,4,8 -count=50`.
- [ ] My slow tests have been profiled and optimised.
- [ ] My PR gate runs in under 2 minutes.
- [ ] My race-detector overhead is acceptable (tests still fast).

---

## Summary

Deterministic tests are the fastest tests when done right. Replace every `time.Sleep` with a barrier. Move every time-dependent test into `synctest` or a fake clock. Use `t.Parallel()` for independent tests. Tune `-count` and `-race` per pipeline tier: fast on PR, thorough nightly, exhaustive weekly. Profile slow tests and fix the cause. The result: a test suite that gives high-confidence signal in seconds, catches rare flakes in hours, and lets your team trust every green.
