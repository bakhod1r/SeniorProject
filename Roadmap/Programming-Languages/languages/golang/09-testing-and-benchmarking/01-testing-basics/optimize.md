---
layout: default
title: Testing Basics — Optimize
parent: Testing Basics
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/01-testing-basics/optimize/
---

# Testing Basics — Optimize

[← Back](../)

A test suite is a program your team runs hundreds of times a day. Two minutes shaved off a CI run, multiplied by every commit, every developer, every branch, repays itself within a week. This page collects the optimisations that apply to *any* Go test suite without changing the assertions: flag use, parallelism, lifecycle, and caching.

## 1. Parallel subtests

Adding `t.Parallel()` to a slow test is the highest-leverage change you will make. The default `-parallel` is `GOMAXPROCS`. A suite of 10 tests at 1 s each takes 10 s serial; in parallel on an 8-core machine it takes ~1.3 s.

```go
func TestParallel(t *testing.T) {
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            run(tc)
        })
    }
}
```

Two cautions:

- The package under test must tolerate concurrent access. Tests that mutate package-level variables, the file system without `t.TempDir`, or shared external services will race.
- `go test ./...` runs *packages* in parallel by default (configurable via `-p`). Adding `t.Parallel` parallelises within a package on top of that.

## 2. `-short` for fast-feedback loops

Tests that take longer than a second should self-skip in short mode:

```go
func TestSlow(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping in short mode")
    }
    // 30-second integration test
}
```

Local pre-commit hooks run `go test -short ./...` for a sub-five-second loop. CI runs the full suite, possibly split across multiple jobs.

## 3. `t.Cleanup` versus `defer`

`defer` runs when the function returns. `t.Cleanup` runs after the test and all its parallel subtests complete. In a `TestX` that spawns parallel subtests, `defer pool.Close()` closes the pool while subtests are still running. Always prefer `t.Cleanup` in test bodies.

```go
func TestPool(t *testing.T) {
    p := newPool()
    t.Cleanup(p.Close) // safe with parallel subtests
    // ...
}
```

This is correctness *and* performance: a misordered cleanup can produce flakes that take hours to debug.

## 4. Test caching and `-count`

`go test ./...` will re-use cached results when sources, build tags, and observed env/file inputs are unchanged. The cache lives in `$GOCACHE` and is hashed per test binary. In CI, set a stable cache path and persist it across builds for a 5-10x speedup on incremental runs.

`-count=1` forces a re-run by salting the cache key. Use it when you want to confirm a passing run was not cached. Never set `GOFLAGS=-count=1` globally — it defeats the cache.

## 5. `-failfast` for tight loops

When you are iterating on a single bug, `-failfast` stops after the first failed test. Combined with `-run`:

```
$ go test -run TestX -failfast -v ./pkg
```

reproduces the failure in seconds. In CI, `-failfast` is usually undesirable because you want to see every failure in one run.

## 6. Trimming test binary build time

Each `go test` recompiles the package and its tests. Most of the wall time of a tiny test suite is the compiler. Reduce it by:

- Keeping `_test.go` imports narrow — every imported package is recompiled if its sources changed.
- Avoiding generic helpers that depend on heavy packages (don't import `net/http` for a string-builder helper).
- Splitting big packages — a package with 1000 lines tests in 0.2 s; one with 50 000 lines tests in 4 s, regardless of how many tests you wrote.

## 7. Skipping in CI vs locally

The flag pattern is:

| Loop | Command |
| ---- | ------- |
| Pre-commit | `go test -short -timeout=10s ./...` |
| Local full | `go test ./...` |
| CI fast | `go test -race -short ./...` |
| CI full | `go test -race -count=1 -timeout=5m ./...` |
| Flake hunt | `go test -race -count=100 -run TestFlaky ./...` |

## 8. Sharding tests across CI workers

Large suites should split across machines. `go test ./...` produces one test binary per package; CI runners can each handle a subset:

```
# worker 1
$ go test ./pkg/{a,b,c}/...
# worker 2
$ go test ./pkg/{d,e,f}/...
```

Tools like `gotestsum --packages='./...' --rerun-fails=2 --jsonfile=out.json` provide structured output and JSON reports useful for sharding.

## 9. Avoid heavy `TestMain` setup when unneeded

`TestMain` setup runs once and is amortised across all tests in the package. But if only two of fifty tests need a database, paying the cost for the other forty-eight is waste. Move setup into a `sync.Once` triggered by a helper:

```go
var (
    once sync.Once
    db   *sql.DB
)

func getDB(t *testing.T) *sql.DB {
    once.Do(func() { db = startDB() })
    return db
}
```

Tests that never call `getDB` never pay the cost.

## 10. Reuse `t.TempDir` across subtests

`t.TempDir` returns a path per `*testing.T`. If you call `t.TempDir` on a parent `T` it persists for the parent's lifetime — including all subtests. Use this for read-only fixtures:

```go
func TestX(t *testing.T) {
    dir := t.TempDir()
    writeFixtures(t, dir)
    t.Run("a", func(t *testing.T) { use(dir) })
    t.Run("b", func(t *testing.T) { use(dir) })
}
```

Per-subtest temp dirs are fine for write-heavy tests; reuse is fine for read-only ones.

## 11. Reduce log noise with `t.Log`

`t.Log` only prints when the test fails or `-v` is set. Replace `fmt.Println` in test helpers with `t.Logf` and let the framework decide whether to show it. Less noise in CI logs makes the actual failure stand out.

## 12. Bench-mode-style time budget

If a test sleeps for fixed durations, replace `time.Sleep(X)` with `time.Sleep(testTimeout / N)` keyed off `t.Deadline()`. The test then auto-shrinks under tighter timeouts:

```go
deadline, _ := t.Deadline()
budget := time.Until(deadline)
poll(budget / 10)
```

This also makes tests robust against shared CI runners under load.

## 13. Stop using `time.Sleep` for synchronisation

`time.Sleep` is the single biggest source of flake and slow tests. Replace with explicit waits:

```go
// bad
time.Sleep(100 * time.Millisecond)
if !server.Ready() { t.Fatal("not ready") }

// good
deadline := time.Now().Add(2 * time.Second)
for !server.Ready() {
    if time.Now().After(deadline) {
        t.Fatal("not ready")
    }
    time.Sleep(5 * time.Millisecond)
}
```

Or expose a channel `server.ReadyC() <-chan struct{}` and `select` on it.

## 14. CPU profiling tests

The same `-cpuprofile` and `-memprofile` flags that work for benchmarks also apply to tests. If a single test takes most of the suite's wall time:

```
$ go test -run TestX -cpuprofile cpu.out ./pkg
$ go tool pprof cpu.out
```

You may find the test itself is the bottleneck — slow assertion helpers, unnecessary cryptographic work in fixtures, allocations inside a hot loop in test code. We will return to profiling in `08-go-test-tool` and `07-benchmarking-basics`.

---

The shortest path to a fast test suite: parallelise subtests, gate slow tests behind `-short`, use `t.Cleanup` and `t.TempDir`, keep the cache warm in CI, and never use `time.Sleep` for synchronisation.
