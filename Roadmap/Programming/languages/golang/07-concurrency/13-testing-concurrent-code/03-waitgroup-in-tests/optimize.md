---
layout: default
title: WaitGroup in Tests — Optimize
parent: WaitGroup in Tests
grand_parent: Testing Concurrent Code
nav_order: 9
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/03-waitgroup-in-tests/optimize/
---

# WaitGroup in Tests — Optimize

[← Back to WaitGroup in Tests](./)

Tests pay a real cost in CI minutes, developer wait, and feedback latency. Concurrent tests pay extra because the race detector slows execution 5–10x and because barrier-based waits are bounded by real time. This page covers the levers that reduce test latency without reducing coverage: tighter timeouts, fewer goroutines, parallel subtests, virtual time, inlined helpers, and harness reuse.

---

## 1. Tight timeouts beat loose ones

A 30-second `WaitTimeout` on a test that normally finishes in 10 ms is "safe" but wasteful. When the goroutine hangs, you wait 30 seconds to learn about it. Multiply by 100 flaky CI runs and you have lost hours.

Pick a timeout that is **one order of magnitude above the normal completion time**. If the test usually finishes in 10 ms, use 100 ms. If it usually takes 1 s, use 10 s.

```go
WaitTimeout(t, &wg, 100*time.Millisecond)        // fast test
WaitTimeout(t, &wg, 5*time.Second)               // server test
WaitTimeout(t, &wg, 30*time.Second)              // integration test
```

The trade-off: a CI runner under exceptional load may hit a tight timeout falsely. Mitigate by:

- Using `assert.Eventually`-style polling (the test takes only as long as it needs).
- Setting `t.Parallel` only for tests that are CPU-isolated (a busy CI runner can starve a single-threaded test).
- Re-running flaky tests with `t.Skip("flaky in CI; retry")` *only* as a temporary measure while you fix the timeout.

---

## 2. Choose N goroutines for the workload, not for "more is better"

Stress tests scale roughly:

- N goroutines × M iterations = work units.
- Race detector slowdown ~ 5–10x.
- Schedule overhead ~ constant + ε × N for moderate N.

Doubling N from 100 to 200 in a race test usually does not find more bugs but doubles the test's wall time. Stick to:

- **Sanity test:** 4–8 goroutines, 100 iterations.
- **Race test:** 50–100 goroutines, 1000 iterations, with start barrier.
- **Soak test:** 100 goroutines, 100,000 iterations — for the nightly suite, not the per-PR suite.

The race detector finds races based on memory access patterns, not goroutine count. The start barrier matters more than raw N.

---

## 3. Use `t.Parallel` aggressively, but correctly

`t.Parallel` runs subtests concurrently. The wall time becomes `max(subtest time)`, not `sum(subtest time)`. On a project with 100 fast tests, this drops CI time from 100 seconds to 1 second.

Two rules:

- **Capture loop variables** (or use Go 1.22+).
- **Don't share state** across parallel subtests.

```go
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // ... use tc
    })
}
```

For concurrent tests *within* a parallel subtest, the WaitGroup pattern works as usual. The parent's `TestX` function returns before the subtests' bodies run — that's the testing framework's responsibility.

### When NOT to parallelise

- Tests that bind to a fixed port (parallel runs race on the port).
- Tests that touch a shared file system path.
- Tests that depend on a singleton process.
- Tests that share a database fixture.

For these, serialise via build tags, separate `*_test.go` files, or `-p 1`.

---

## 4. Replace real time with virtual time

`testing/synctest` (Go 1.24+) replaces real clock advancement with virtual time inside a "bubble." A test that uses `time.Sleep` or `time.After` for legitimate reasons (testing a timeout, a retry interval) now runs in microseconds instead of seconds.

```go
import "testing/synctest"

func TestRetryBackoff(t *testing.T) {
    synctest.Run(func() {
        client := New(retryInterval = 100 * time.Millisecond)
        client.Send(req)
        synctest.Wait()                  // settles all goroutines
        if client.Attempts() != 3 { t.Errorf(...) }
    })
}
```

Without `synctest`, the test sleeps 300 ms. With `synctest`, near-instant.

For pre-1.24 codebases, the alternative is dependency injection of `clock` interfaces (see `04-mocking-time`).

---

## 5. Inline simple helpers

A short helper is a function call away — fast, but slightly more allocation than inlined code. For a `WaitTimeout` called once per test, this doesn't matter. For a tight stress-test inner loop, it might:

```go
// inline form
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done:
case <-time.After(d):
    t.Fatal(...)
}
```

Versus:

```go
testutil.WaitTimeout(t, &wg, d)
```

The helper costs: one closure allocation, one channel allocation, one timer allocation. The inline form costs the same. There is no real difference. Readability wins — use the helper.

Where inlining *does* help: inside a goroutine body that you spawn 10,000 times. A closure that captures `t` and `wg` is bigger and slower to schedule than a direct call.

---

## 6. Reuse expensive setup with `TestMain` or `sync.Once`

A test suite that boots a database per test is slow. Boot once per *package*:

```go
var (
    db *sql.DB
    setupOnce sync.Once
)

func setup() {
    setupOnce.Do(func() {
        db = openTestDB()
    })
}

func TestX(t *testing.T) {
    setup()
    // ... use db
}
```

Or in `TestMain`:

```go
func TestMain(m *testing.M) {
    db = openTestDB()
    code := m.Run()
    db.Close()
    os.Exit(code)
}
```

With `t.Parallel`, tests share the DB. They must be careful to use independent rows / schemas. The setup cost is paid once instead of per test.

---

## 7. Cut barrier overhead in microbenchmarks

For benchmarks, `b.RunParallel` handles the WaitGroup setup internally. Outside of benchmarks, hand-rolled fan-out has measurable startup cost:

```
BenchmarkFanOut10        50000     32000 ns/op
BenchmarkFanOut100        5000    280000 ns/op
BenchmarkFanOut1000        500   2900000 ns/op
```

(Approximate numbers from a typical Go 1.22 machine.)

The cost is goroutine spawn + scheduler overhead, not the WaitGroup itself. To reduce:

- Pre-spawn a worker pool that the benchmark feeds.
- Use `RunParallel` so the framework's internal pool is reused.
- Increase per-goroutine work so the spawn cost amortises.

For tests, this never matters. For benchmarks, choose the level that reveals what you want to measure.

---

## 8. Bound retries in `goleak`

`goleak`'s default retry budget is 20 attempts × 100 ms = 2 seconds. For a clean test, this is wasted time:

```go
goleak.VerifyNone(t,
    goleak.WithRetryAttempts(5),
    goleak.WithRetryInterval(50 * time.Millisecond),
)
```

5 × 50 ms = 250 ms in the worst case. For a package with 100 tests, that saves 175 seconds per CI run.

The risk: tests with truly slow shutdown (TCP listeners with `SO_LINGER`) need the longer retry. Profile your shutdown path before tightening.

---

## 9. Avoid recreating WaitGroups in loops

A loop that creates a fresh WaitGroup per iteration is fine — `WaitGroup` is cheap. But re-using one across waves avoids the allocation entirely:

```go
var wg sync.WaitGroup
for wave := 0; wave < 100; wave++ {
    wg.Add(N)
    spawnWave(wave, &wg)
    wg.Wait()
}
```

The savings are nanoseconds per wave; not meaningful for tests. Don't optimise here unless a profiler shows it.

---

## 10. Skip race detector for fast iteration

Locally, run without `-race` for tight inner loops:

```
go test -run TestX -count=10
```

Use `-race` for the final pre-PR check:

```
go test -race -run TestX -count=10
```

The 5–10x slowdown of `-race` is fine in CI; locally, it slows the feedback loop unnecessarily for tests that aren't focused on concurrency.

---

## 11. Reduce per-test setup with subtests

A common pattern: each `TestX` builds a fresh service. With subtests sharing the parent's setup, you build once and run many cases:

```go
func TestService(t *testing.T) {
    svc := buildService(t)
    t.Run("case1", func(t *testing.T) { ... })
    t.Run("case2", func(t *testing.T) { ... })
    t.Run("case3", func(t *testing.T) { ... })
}
```

If cases are independent and idempotent, add `t.Parallel`. Setup cost amortises across all cases.

---

## 12. Use `b.ReportAllocs` and `-race` together for diagnostic

When optimising a test or helper, enable both:

```
go test -race -bench=. -benchmem -count=3
```

`-benchmem` reports allocations per operation. Allocations correlate with garbage collector load, which affects concurrent test timing. A helper that allocates a closure per call may slow stress tests perceptibly.

For pure tests (not benchmarks), profile with:

```
go test -cpuprofile cpu.out -memprofile mem.out -run TestX
go tool pprof cpu.out
```

The profile usually shows the WaitGroup is the cheapest thing in the test. The bottleneck is the work the goroutines do.

---

## 13. Watch out for the start barrier's hidden cost

Closing a channel with `N` receivers does *not* wake all of them simultaneously — the runtime wakes them in sequence, with a small per-wakeup cost. For N = 100, the wakeup phase takes maybe 50 microseconds. For N = 10,000, it takes ~5 ms.

If your race test relies on simultaneous start across thousands of goroutines, the start barrier's serialisation cost can mask the race. Mitigations:

- Reduce N to the smallest value that consistently finds races (usually 50–200).
- Run the test many times with `-count=N` rather than scaling N up.

---

## 14. Use `runtime.LockOSThread` carefully

Pinning a goroutine to an OS thread can be useful for testing thread-local state. The cost: that goroutine can no longer be scheduled on other threads, increasing contention.

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    work()
}()
```

For most tests, do *not* use `LockOSThread`. It is for cgo-heavy code and signal handlers.

---

## 15. Cache test-specific resources

A test that, in each subtest, parses the same large file and then forks goroutines wastes the parse time. Hoist:

```go
var parsedOnce sync.Once
var parsed *Doc

func loadDoc(t *testing.T) *Doc {
    parsedOnce.Do(func() {
        b, err := os.ReadFile("testdata/big.json")
        if err != nil { t.Fatal(err) }
        parsed, err = Parse(b)
        if err != nil { t.Fatal(err) }
    })
    return parsed
}
```

Subtests call `loadDoc(t)` and get the cached document. Parse cost is paid once.

---

## 16. Profile your test suite with `-test.timeout`

Set a global per-test timeout:

```
go test -timeout 30s ./...
```

Any test that takes longer than 30s gets killed and reports a goroutine dump. Use this to find slow tests:

```
go test -timeout 1s ./...
```

Anything that fails this is too slow for "small unit test" classification. Either optimise it or move it to an integration suite.

---

## 17. Parallel CI sharding

For repos with thousands of tests:

```
go test -p 4 ./...           # 4 packages at a time
```

Combined with `-shard k/N`:

```
go test -run "$(get_shard_test_pattern k N)" ./...
```

Splits the test load across N CI machines. Each runs a subset; the suite finishes in `(total time) / N`.

The shard helper isn't standard — projects roll their own or use a CI feature. The principle: tests are embarrassingly parallel at the package level, fully parallel at the subtest level. Use both axes.

---

## 18. Trade test count for test depth

A test that runs 1000 iterations of one scenario is one CI run. A test that runs 100 iterations of one scenario, plus runs `-count=10` in CI, is the same total work but distributed across separate runs. The second form gives you statistical evidence that the test is stable across runs, not just that it survives one long run.

A useful CI pattern:

- Per-PR: `go test -race -count=3`.
- Nightly: `go test -race -count=100`.
- Weekly: `go test -race -count=1000`.

The nightly run catches the once-in-100 flakes that the per-PR run misses. The weekly run catches the once-in-10000 flakes that betray deeper bugs.

---

## 19. Optimising means leaving tests alone first

The biggest "optimisation" of concurrent tests is *not breaking* them in pursuit of speed. A test that completes in 1 second but is flaky is worse than a test that takes 5 seconds and is rock-solid. Order of operations:

1. Eliminate `time.Sleep`.
2. Use `synctest` or polling deadlines.
3. Use parallel subtests where safe.
4. Tighten timeouts.
5. Cache fixtures.
6. Shard the suite.

Steps 1–2 also speed things up by removing dead waits. Steps 3–6 are pure throughput improvements. Never start with step 6 — fix the flakes first.

---

## 20. Summary

The optimisation toolkit, ordered by typical impact:

| Lever | Typical impact |
|---|---|
| Remove `time.Sleep` | Tests run as fast as the underlying work |
| `t.Parallel` everywhere safe | Wall-clock time falls by factor of `nproc` |
| `synctest` for time-based logic | Time-driven tests run in microseconds |
| Cache fixtures in `TestMain` | Eliminates per-test setup cost |
| Tighten `WaitTimeout` and `goleak` retries | Saves seconds per test on the failure path |
| Shard the suite across CI workers | Linear speedup in CI wall time |
| Trade `count=1000` per-test for `count=10` × 100 runs | Same coverage, parallelised |
| Pre-spawn worker pools (benchmarks only) | Eliminates spawn overhead |

Apply these in order. The first three give 90% of the speedup. The rest is fine-tuning for repos that already run their tests in 60 seconds and want them under 10.
