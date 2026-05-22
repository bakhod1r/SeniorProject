# go test — Middle

## 1. The flags you actually use

| Flag | Effect |
|------|--------|
| `-v` | Verbose: print each test and its log output |
| `-run <regex>` | Run only matching tests/subtests |
| `-count=1` | Disable the test cache (force a re-run) |
| `-race` | Run with the data race detector |
| `-cover` | Report statement coverage |
| `-coverprofile=c.out` | Write a coverage profile |
| `-bench <regex>` | Run benchmarks matching the pattern |
| `-timeout 30s` | Fail the run if it hangs past the timeout |
| `-failfast` | Stop after the first failing test |
| `-shuffle=on` | Randomize test order to catch ordering deps |

---

## 2. The test cache

Go caches **passing** test results keyed on the test binary's inputs (source, env, args). Unchanged tests show `(cached)` and do not re-run:

```bash
go test ./...        # ok ... (cached)
go test -count=1 ./...   # force re-run, bypass cache
```

The cache only applies to runs with cacheable arguments. Tests that read the environment or files outside the package may behave as if cacheable when they should not — use `-count=1` to be sure, or mark such tests appropriately. To clear it entirely: `go clean -testcache`.

---

## 3. The race detector (`-race`)

`-race` instruments the binary to detect concurrent unsynchronized access:

```bash
go test -race ./...
```

It catches real concurrency bugs that are otherwise intermittent. Costs: ~2–10x slower and more memory, so run it in CI and on concurrency-heavy packages rather than every local run. A `DATA RACE` report is always a real bug — fix it.

---

## 4. Coverage

```bash
go test -cover ./...                       # prints % per package
go test -coverprofile=cover.out ./...      # write a profile
go tool cover -func=cover.out              # per-function coverage
go tool cover -html=cover.out              # open an annotated HTML view
go test -covermode=atomic -coverprofile=c.out ./...   # safe with -race
```

`-coverpkg` measures coverage of packages other than the one under test (e.g., integration tests covering many packages):

```bash
go test -coverpkg=./... -coverprofile=c.out ./...
```

Use `-covermode=atomic` whenever combining coverage with `-race` or parallel tests.

---

## 5. Benchmarks

```bash
go test -bench=.                       # run all benchmarks
go test -bench=BenchmarkAdd -benchmem  # one benchmark, with allocation stats
go test -bench=. -benchtime=2s         # run each for at least 2s
go test -bench=. -count=10             # 10 runs (for benchstat)
```

```go
func BenchmarkAdd(b *testing.B) {
	for i := 0; i < b.N; i++ {
		Add(2, 3)
	}
}
```

`-benchmem` adds `B/op` and `allocs/op`. Note `-bench` does not run regular tests unless `-run` also matches; use `-run=^$ -bench=.` to run only benchmarks.

---

## 6. Parallelism

Two distinct knobs:

- **`t.Parallel()`** inside a test marks it to run concurrently with other parallel tests in the same package.
- **`-p n`** sets how many *packages* are tested in parallel (default GOMAXPROCS).
- **`-parallel n`** sets the max number of parallel tests *within* a package (default GOMAXPROCS).

```bash
go test -p 4 -parallel 8 ./...
```

```go
func TestX(t *testing.T) {
	t.Parallel()
	// ...
}
```

---

## 7. Targeting tests and subtests

```bash
go test -run TestUser            # all tests with "TestUser" in the name
go test -run 'TestUser/admin'    # a subtest "admin" under TestUser
go test -run '^TestExact$'       # exact match
go test -bench=. -run='^$'       # benchmarks only, no tests
```

`-run` and `-bench` use regexes matched per path element for subtests/sub-benchmarks separated by `/`.

---

## 8. Build tags for slow/integration tests

Gate expensive tests behind a tag so the default run stays fast:

```go
//go:build integration

package db
```

```bash
go test ./...                    # unit tests only
go test -tags=integration ./...  # include integration tests
```

This keeps the inner loop quick while still exercising the full suite in CI.

---

## 9. How it fits the dev loop

- Inner loop: `go test ./pkg/...` or `go test -run TestThing -v` while iterating.
- Pre-commit: `go test ./...` (and `-race` for concurrency code).
- CI: `go test -race -covermode=atomic -coverprofile=c.out ./...` plus benchmarks where relevant.

---

## 10. Summary

`go test` runs tests with a result cache (bypass with `-count=1`), supports `-race` for concurrency bugs, `-cover`/`-coverprofile` for coverage (use `-covermode=atomic` with `-race`), and `-bench`/`-benchmem` for benchmarks (`-run=^$` to run benchmarks only). Control parallelism with `t.Parallel()`, `-p`, and `-parallel`, target tests with `-run`, and gate slow tests behind build tags. Lean on `-v` and `-run` while iterating, and run `-race` + coverage in CI.

---

## Further reading
- `go help testflag`
- `testing`: https://pkg.go.dev/testing
- `go tool cover`: https://pkg.go.dev/cmd/cover
