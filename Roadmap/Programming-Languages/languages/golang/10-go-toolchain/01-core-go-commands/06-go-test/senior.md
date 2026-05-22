# go test — Senior

## 1. The test cache, precisely

`go test` caches a passing result keyed on a hash of: the test binary (its source + dependencies + build flags), the **test flags**, and the **environment variables and files the test accesses** that the toolchain can track. A subsequent identical run returns the cached result instantly with `(cached)`.

Crucial subtleties:
- Only **cacheable** flag sets are cached. Flags like `-count=1` are explicitly non-cacheable; passing `-count=1` is the canonical way to force a re-run.
- Tests that read **untracked** external state (network, time, a database) can be wrongly cached — the cache cannot see that the world changed. Such tests should not rely on caching; `-count=1` in CI for integration suites avoids stale passes.
- `go clean -testcache` invalidates all cached test results.

```bash
go test ./...            # may print (cached)
go test -count=1 ./...   # always re-run
go clean -testcache      # wipe the test cache
```

---

## 2. `-race` cost model and CI placement

`-race` builds a separate instrumented binary (a different build cache key) and runs ~2–10x slower with higher memory. Senior practice:

- Run `-race` in CI on the full suite (or at least concurrency-touching packages).
- Keep a fast non-race local loop; opt into `-race` when touching concurrency.
- A `DATA RACE` is never a flake — it is a real bug; do not retry past it.
- `-race` requires cgo on most platforms; ensure `CGO_ENABLED=1` (it is by default) in race CI jobs.

Combine with atomic coverage to avoid coverage-counter races:

```bash
go test -race -covermode=atomic -coverprofile=c.out ./...
```

---

## 3. Coverage semantics and pitfalls

- Default `-cover` measures the **package under test** only. `-coverpkg` widens it (e.g., integration tests covering many packages), but inflates the denominator and can mislead.
- `-covermode`: `set` (default, did/didn't run), `count` (hit counts), `atomic` (race-safe counts). Use `atomic` with `-race` or parallel tests.
- Coverage of generated code or trivial getters dilutes the number; coverage is a **signal, not a target** — gaming it (e.g., asserting-nothing tests) is worse than honest gaps.
- Go 1.20+ can collect coverage for **integration binaries** built with `-cover` (`GOCOVERDIR`), letting you measure coverage of a running program, not just unit tests.

```bash
go build -cover -o app ./cmd/app
GOCOVERDIR=cov ./app    # run scenarios
go tool covdata percent -i=cov
```

---

## 4. Benchmark methodology

Naive single-run benchmarks are noise. Senior workflow:

```bash
go test -bench=. -benchmem -count=10 -run='^$' ./pkg | tee new.txt
# compare to a baseline:
go install golang.org/x/perf/cmd/benchstat@latest
benchstat old.txt new.txt
```

- Use `-count=N` (≥10) so `benchstat` can compute variance and significance.
- Use `b.ReportAllocs()`/`-benchmem` to track allocations, often the real story.
- Use `b.ResetTimer()`/`b.StopTimer()` to exclude setup.
- Pin CPU frequency/affinity and run on a quiet machine; CI benchmark numbers are noisy and should be treated as trends, not absolutes.

---

## 5. Parallelism and isolation

- `t.Parallel()` tests run concurrently *after* their parent's non-parallel portion finishes; shared mutable state across them is a race waiting to happen.
- The classic loop-variable capture bug in parallel subtests is fixed by Go 1.22's per-iteration loop variables, but older code needs `tc := tc` shadowing.
- `-shuffle=on` randomizes order to expose hidden inter-test dependencies; record the seed it prints to reproduce a failure (`-shuffle=<seed>`).
- `-parallel n` caps within-package parallel tests; `-p n` caps cross-package parallelism. In constrained CI, set both to the CPU quota to avoid oversubscription.

---

## 6. Where it surprises people

- **`(cached)` hiding real changes** in tests that read untracked external state.
- **`-bench` not running tests** (and vice versa) — they are separate selectors.
- **Coverage with `-coverpkg=./...`** inflating/deflating numbers unexpectedly.
- **`t.Parallel()` reordering** so cleanup/`defer` and shared fixtures interleave.
- **Timeout default (10m)** killing a hung test with a stack dump — read it, do not just bump `-timeout`.
- **`TestMain`** controlling setup/teardown for the whole package; forgetting `m.Run()`'s exit code propagation breaks the suite silently.
- **GOFLAGS leakage** — a global `-mod=vendor` or `-count=1` changing test behavior repo-wide.

---

## 7. `TestMain` for package-level setup

```go
func TestMain(m *testing.M) {
	// setup: spin up a test DB, etc.
	code := m.Run()
	// teardown
	os.Exit(code)
}
```

Use it for expensive shared setup. The `os.Exit(m.Run())` pattern is required — returning without exiting with the code loses the failure status.

---

## 8. CI usage

```bash
go test -race -covermode=atomic -coverprofile=cover.out -shuffle=on ./... \
  -timeout 5m
go tool cover -func=cover.out | tail -1   # total coverage line
```

CI rules:
- `-race` on the full suite.
- `-shuffle=on` to catch ordering deps (log the seed).
- `-count=1` for integration suites that touch untracked state.
- A sane `-timeout` so hangs fail fast with a goroutine dump.
- Cache `GOCACHE`/`GOMODCACHE`; the test cache helps locally but is usually cold in CI.

---

## 9. Summary

`go test` caches passing results by tracked inputs — bypass with `-count=1`, wipe with `go clean -testcache`, and beware tests reading untracked external state. Run `-race` (a real bug detector, not a flake source) and `-covermode=atomic` in CI; treat coverage as a signal and use `-coverpkg`/`GOCOVERDIR` deliberately. Benchmark with `-count=N` + `benchstat`, manage parallelism with `t.Parallel()`/`-parallel`/`-p`, expose ordering bugs with `-shuffle`, and use `TestMain` (with `os.Exit(m.Run())`) for package setup.

---

## Further reading
- `go help testflag`, `go help test`
- Coverage for integration tests: https://go.dev/doc/build-cover
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
