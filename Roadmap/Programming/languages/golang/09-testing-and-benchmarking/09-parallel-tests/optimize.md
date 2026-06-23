---
layout: default
title: Parallel Tests — Optimize
parent: Parallel Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/09-parallel-tests/optimize/
---

# Parallel Tests — Optimize

[← Back](../)

A parallel test suite is only as fast as its slowest serial bottleneck and only as reliable as its weakest race condition. The optimisations on this page are ordered from highest-leverage to lowest. Most teams get an order-of-magnitude wall-clock improvement from items 1–4; the rest are useful when CI minutes start to dominate the cloud bill.

## 1. Mark CPU-light tests parallel by default

The cheapest speedup is also the most common to forget. If a test does not touch package-level state, env vars, working directory, or external services, it should call `t.Parallel`. Add a lint check (`go vet -vettool=...`) or a custom `analysistest` to enforce.

```go
func TestFastPureFunction(t *testing.T) {
    t.Parallel()
    if got := pure.Compute(7); got != 49 {
        t.Fatalf("got %d, want 49", got)
    }
}
```

A suite of 200 such tests at 10 ms each runs in 2 s serial, 0.13 s on 16 cores.

## 2. Tune `-parallel` for I/O-bound suites

`-parallel` defaults to `GOMAXPROCS`, which is conservative for tests that mostly block on I/O (database, HTTP, file). Push it higher and measure:

```bash
go test -parallel 32 -timeout 5m ./...
go test -parallel 64 -timeout 5m ./...
```

A network-bound integration suite on an 8-core CI box often saturates at `-parallel 32` to `-parallel 64`. The wall-clock curve flattens once the external service or the kernel becomes the bottleneck.

## 3. Combine `-race` with `-parallel`, but on a separate job

`-race` adds 5–10x CPU and ~10x RAM. A `-race` suite at the same `-parallel` value as the regular suite can OOM. Strategies:

- Run `-race` as a dedicated CI job: `go test -race -parallel $(nproc) ./...`.
- Drop `-parallel` to half of `GOMAXPROCS` under `-race` to stay within memory budgets.
- Skip `-race` for benchmarks; pair it with `-count=10` for thoroughness on integration suites.

## 4. Shard at the `go test` level with `-p`

For repos with many packages, the bottleneck shifts from intra-package parallelism (`-parallel`) to inter-package parallelism (`-p`):

```bash
go test -p 8 -parallel 16 ./...
```

Up to 8 test binaries run simultaneously, each running up to 16 parallel tests. Peak concurrency is 128 goroutines under test control. On large monorepos, increasing `-p` from the default to `2 * num_cores` cuts CI by 30–50%.

## 5. Cache effectively: avoid `-count=1` unless needed

`go test` caches successful runs based on inputs (source files, env vars listed in `GOFLAGS`, etc.). The first run is full; subsequent runs without changes finish in milliseconds:

```bash
go test ./...           # cold, runs everything
go test ./...           # warm, prints "(cached)"
```

`-count=1` invalidates the cache and is the canonical way to force a re-run, but only when you actually need to (e.g., flake hunting). Defaulting CI to `-count=1` throws away the cache benefit.

## 6. Use `t.Cleanup` instead of `defer` for parallel-friendly teardown

`defer` runs when the test function returns — which for a parallel test is *before* the parallel section actually finishes. `t.Cleanup` runs after the test (and all its subtests) complete, in LIFO order, on the test's own goroutine. Cleanups are also exception-safe with `t.FailNow`.

```go
func TestWithDB(t *testing.T) {
    t.Parallel()
    db := openDB(t)
    t.Cleanup(func() { db.Close() })
    // ...
}
```

## 7. Reuse expensive fixtures across parallel tests via `sync.Once`

If many parallel tests need the same read-only fixture (a parsed config, a compiled regex, a seeded RNG), build it once and share:

```go
var (
    fixtureOnce sync.Once
    fixture     *bigFixture
)

func getFixture(t *testing.T) *bigFixture {
    t.Helper()
    fixtureOnce.Do(func() { fixture = loadBigFixture() })
    return fixture
}
```

The fixture must be effectively immutable. Anything mutable should be cloned per test or guarded by a mutex.

## 8. Batch-allocated ports and DB connections

A naive parallel suite opens a fresh TCP listener or DB connection per test, hitting OS limits (`ulimit -n`, Postgres `max_connections`). Pool the resources:

```go
var dbPool = make(chan *sql.DB, 8)

func acquireDB(t *testing.T) *sql.DB {
    t.Helper()
    db := <-dbPool
    t.Cleanup(func() {
        truncateAll(db)
        dbPool <- db
    })
    return db
}
```

The pool size becomes a deliberate budget: 8 connections × `-parallel 16` = at most 8 tests blocked at any time, well within Postgres's 100 default.

## 9. Skip slow tests in fast feedback loops

```go
func TestExpensive(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping in -short mode")
    }
    t.Parallel()
    // ...
}
```

Local development: `go test -short ./...`. CI nightly: `go test ./...`. Pre-commit hooks favour `-short` for sub-second feedback.

## 10. Profile the test binary itself

Tests are programs. They can be profiled like any other:

```bash
go test -cpuprofile cpu.out -parallel 16 ./bigpkg
go tool pprof cpu.out
```

Common findings:

- A `sync.Mutex` in a logging helper serializing all parallel tests.
- A `runtime.GC()` call left over from a benchmark.
- A `time.Sleep` masquerading as a "wait for the server".

Replace `time.Sleep` with a polling loop bounded by `t.Context().Done()` (Go 1.24+) or a deadline channel.

## 11. Detect goroutine leaks early

Slow suites are often suites that leak goroutines and time out. `go.uber.org/goleak` in `TestMain` catches leaks at process exit; for per-test detection, use `goleak.VerifyNone(t)` in a `t.Cleanup`.

## 12. Watch for the GOMAXPROCS × parallel ceiling

Tests calling `t.Parallel` run concurrently up to `-parallel`, but the Go runtime schedules them onto `GOMAXPROCS` OS threads. On a CI runner with `GOMAXPROCS=2`, `-parallel 32` does *not* yield 32x speedup for CPU-bound code — at best you get 2x. Match `-parallel` to workload type (CPU-bound: `≈GOMAXPROCS`; I/O-bound: `2–8× GOMAXPROCS`).

## 13. Avoid per-test heap allocations in hot loops

A 5000-test suite where each test allocates a 1 MB buffer creates 5 GB of garbage. `-race`'s mark phase scales with live heap. Pool buffers:

```go
var bufPool = sync.Pool{New: func() any { return make([]byte, 0, 4096) }}
```

## 14. Measure before optimising

`go test -json` writes machine-readable per-test timings. Pipe it to `tparse` or a custom script to find the top 20 slowest tests. Optimising the bottom 100 saves nothing; optimising the top 5 often halves wall-clock.

```bash
go test -json -parallel 16 ./... | tparse -all -slow 20
```

## 15. Build cache and `-count=1`

`go test` caches per-package results keyed on source + environment. Two non-obvious cache traps that surface in parallel suites:

- **Time-dependent tests** that pass-once-cached-forever. Bake `time.Now()` into the test only via injected clocks; never let the test's behaviour depend on wall-clock that the cache can't see.
- **External resources** (Postgres, S3) the cache can't model. The first run passes, the second is silently cached even after the external state changed. For integration suites, default to `-count=1` and accept the slower feedback.

For pure unit tests, the cache is gold. A common pattern: alias `gotest := go test ./...` (cache on), `gotest1 := go test -count=1 ./...` (cache bypass) and use the right one explicitly.

## 16. The `-failfast` flag

`-failfast` stops the test binary on the first failure. With parallel tests, the semantics are:

- The first failing test marks the binary as failed.
- Running tests continue to completion (they don't get cancelled).
- New tests are not started.

For tight feedback loops on a known-broken suite, `-failfast` saves minutes. For full validation, leave it off — you want every failure surfaced, not just the first.

## 17. JSON test output

`go test -json` emits structured events: `start`, `pause`, `cont`, `run`, `pass`, `fail`, `output`, with timestamps. Tools like `tparse`, `gotestsum`, and custom scripts consume it for slow-test analysis, flake tracking, and CI dashboards:

```bash
go test -json -parallel 16 ./... | tee output.json | tparse -all
go test -json ./... | gotestsum --format short-verbose
```

For senior teams, the JSON output is the foundation of test telemetry. Pipe it into a database, plot top-20 slowest per commit, alarm on regressions over time.

## 18. Avoiding accidentally serial tests

The most expensive parallel-test bug is a `t.Parallel` that doesn't actually parallelise because a mutex inside the test serialises everything:

```go
var logMu sync.Mutex

func TestX(t *testing.T) {
    t.Parallel()
    logMu.Lock()
    defer logMu.Unlock()
    // every parallel test waits on this mutex
}
```

The fix is to find the contention and remove it (per-test logger, lock-free queue, etc.). `-cpuprofile` reveals mutex hot-spots: `runtime.semacquire`, `sync.(*Mutex).Lock` near the top of the profile.

## 19. Sharding across CI runners

For very large repos, splitting the test suite across N CI runners further compresses wall time. Two approaches:

- **Package sharding**: assign packages to runners by hash. `go test ./pkg-a/... ./pkg-c/...` on runner 1, the rest on runner 2.
- **Test sharding**: split tests within a package via `-run` regex. Less common because it bypasses package-level setup.

Sharding interacts with `-parallel`: each runner has its own `-parallel` budget. A 4-runner sharded suite at `-parallel 8` peaks at 32 concurrent tests overall, same as `-parallel 32` on one runner — but with 4x the wall-clock saved (assuming work is balanced).

## 20. Long-tail-test triage

When the suite has 5000 tests and the median is fast but the 99th percentile is slow, you don't optimise the median — you optimise the tail.

```bash
go test -json ./... | jq -r '. | select(.Action=="pass") | "\(.Elapsed) \(.Test)"' | sort -n | tail -50
```

The 50 slowest tests usually share root causes: an `httptest.NewTLSServer` (slow TLS handshake), a `time.Sleep(N)`, a fixture rebuild that should be cached, or an external dependency on slow hardware.

## Quick checklist

1. Default-parallel for pure tests.
2. `-parallel` tuned per workload (I/O-bound suites go higher).
3. `-race` in a dedicated CI job.
4. `-p` >= cores for multi-package repos.
5. `t.Cleanup` instead of `defer`.
6. Shared immutable fixtures via `sync.Once`.
7. Pooled scarce resources (ports, DB conns).
8. `-short` for fast loops.
9. Profile, then optimise.
10. `goleak` to catch silent leaks.
11. `-json` output piped to a tool for visibility.
12. `-failfast` for tight loops, off for full validation.
13. Audit for accidentally-serial tests via mutex profile.
14. Shard at the runner level for very large suites.
15. Focus on the slow tail of tests, not the median.

## Diminishing returns

After the first round of optimisation, expect:

- 60–80% wall-time reduction from default-parallel + correct `-parallel` value.
- 10–20% from `-p` tuning and `t.Cleanup` discipline.
- 5–10% from fixture sharing via `sync.Once`.
- 1–5% from low-level tweaks (buffer pools, profile-guided micro-changes).

Past that point, the limiting factor is usually external (DB, network, image pull time). Optimising the test code further yields diminishing returns; investment shifts to the CI infrastructure (faster runners, persistent service containers, pre-warmed databases).

## When to stop optimising

Stop when:

- CI wall time is under the team's threshold (often 5 minutes for PR feedback).
- The flake rate is within budget.
- No single test in the top-20 list is obviously fixable.
- Engineers stop complaining about CI time.

Don't pursue further optimisation just because it's measurable. Engineer time on test infrastructure is engineer time off product features.

## A worked example: from 90 seconds to 8 seconds

A real-world walkthrough on a service with 300 tests and 60 packages:

1. Baseline: `go test ./...` = 90 seconds.
2. Add `t.Parallel` to all pure tests (≈80% of suite): drops to 25 seconds.
3. Tune `-parallel 32` for I/O-bound packages: drops to 14 seconds.
4. Pool the test DB (replaces per-test `sql.Open`): drops to 11 seconds.
5. Share an immutable parser fixture via `sync.Once`: drops to 9 seconds.
6. Remove `time.Sleep`s in async-test waits: drops to 8 seconds.

Total: 11x speedup. Each step took 1-3 hours. Total investment ~12 hours. Saves 75-80 seconds per CI run on every PR. With 30 PRs/day, saves ~40 minutes/day of engineer wait time.

Most teams could do something similar with their first dedicated test-optimisation sprint.

## Sustaining the gains

Optimisation is not one-time. Without monitoring, the suite slowly creeps back. Establish:

- A weekly review of the top-10 slowest tests.
- A CI alarm when wall-time grows >10% over a fortnight.
- A team norm that PRs introducing slow tests document the reason in the PR description.
- A quarterly audit of `-parallel`, `-p`, and CI sharding configuration.

The cost of the audit is hours per quarter; the cost of not auditing is creeping CI minutes that nobody owns.
