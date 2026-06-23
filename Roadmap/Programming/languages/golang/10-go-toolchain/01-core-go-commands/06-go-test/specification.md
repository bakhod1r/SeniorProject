# go test — Specification

> **Focus:** Precise reference for `go test` — synopsis, flags, caching, exit codes, environment, and guarantees.
>
> **Sources:**
> - `go help test`, `go help testflag`
> - `testing`: https://pkg.go.dev/testing
> - cmd/go: https://pkg.go.dev/cmd/go

---

## 1. Synopsis

```
go test [build/test flags] [packages] [test binary flags]
```

Compiles each package's test files (`*_test.go`), runs the resulting test binary, and reports results. Functions: `TestXxx(*testing.T)`, `BenchmarkXxx(*testing.B)`, `FuzzXxx(*testing.F)`, `ExampleXxx()`.

---

## 2. Selection flags

| Flag | Effect |
|------|--------|
| `-run regexp` | Run tests/subtests matching `regexp` (per `/`-separated element) |
| `-bench regexp` | Run benchmarks matching `regexp` (off by default) |
| `-fuzz regexp` | Run the matching fuzz target |
| `-skip regexp` | Skip tests matching `regexp` |
| `-list regexp` | List matching tests/benchmarks without running |

`-run='^$'` runs no tests (used to run only benchmarks).

---

## 3. Execution and reporting flags

| Flag | Effect |
|------|--------|
| `-v` | Verbose per-test output |
| `-count n` | Run each test/benchmark `n` times; `-count=1` disables caching |
| `-failfast` | Stop after the first test failure |
| `-shuffle on\|off\|N` | Randomize order; `N` reproduces a seed |
| `-timeout d` | Panic (with goroutine dump) if a test runs longer than `d` (default 10m) |
| `-parallel n` | Max parallel tests within a package (default GOMAXPROCS) |
| `-p n` | Max packages built/tested in parallel |
| `-json` | Emit machine-readable JSON events |

---

## 4. Race, coverage, and benchmark flags

| Flag | Effect |
|------|--------|
| `-race` | Build and run with the data race detector |
| `-cover` | Report statement coverage of the package under test |
| `-covermode set\|count\|atomic` | Coverage counting mode (`atomic` for race/parallel) |
| `-coverprofile file` | Write a coverage profile |
| `-coverpkg pat,...` | Measure coverage of the listed packages |
| `-benchmem` | Report `B/op` and `allocs/op` |
| `-benchtime d\|Nx` | Run each benchmark for duration `d` or `N` iterations |
| `-cpuprofile`, `-memprofile`, `-blockprofile`, `-mutexprofile`, `-trace` | Write profiles/traces |

---

## 5. The test cache

A passing test result is cached keyed on a hash of the test binary, the test flags, and the environment/files the toolchain can track that the test reads. A matching run prints `(cached)`.

- Only cacheable flag sets are cached; `-count=1` is non-cacheable (forces a re-run).
- `go clean -testcache` invalidates all cached results.
- Tests reading untracked state (network/time/DB) may be incorrectly cached.

---

## 6. Special functions

| Function | Role |
|----------|------|
| `func TestMain(m *testing.M)` | Package-level setup/teardown; must call `os.Exit(m.Run())` |
| `func TestXxx(t *testing.T)` | A test; `t.Run` creates subtests; `t.Parallel()` marks parallel |
| `func BenchmarkXxx(b *testing.B)` | A benchmark; loop `b.N` times |
| `func FuzzXxx(f *testing.F)` | A fuzz target |
| `func ExampleXxx()` | Compiled, and run if it has an `// Output:` comment |

---

## 7. Environment variables

| Variable | Role |
|----------|------|
| `GOFLAGS` | Default flags (e.g., `-count=1`) |
| `GOCACHE` | Build cache (test binaries) |
| `GOMODCACHE` | Module cache |
| `GOMAXPROCS` | Default for `-parallel`/`-p` |
| `GOCOVERDIR` | Directory for integration coverage data (`-cover` binaries) |
| `CGO_ENABLED` | Must be on for `-race` on most platforms |

---

## 8. Exit codes

| Situation | Exit |
|-----------|------|
| All tests pass | 0 |
| A test fails | 1 |
| Build/compile error | 2 |
| Timeout | non-zero (with goroutine dump) |

---

## 9. Behavioral guarantees

- **Deterministic selection** via `-run`/`-bench` regexes.
- **Passing results cached** unless caching is disabled.
- **Failures yield non-zero exit** for CI gating.
- **`-race` reports are real bugs**, not nondeterministic noise.
- **`TestMain` must propagate** `m.Run()`'s code via `os.Exit`.

---

## 10. Related references
- `go help testflag`: https://pkg.go.dev/cmd/go#hdr-Testing_flags
- Integration coverage: https://go.dev/doc/build-cover
- `go tool cover`: https://pkg.go.dev/cmd/cover
- `testing`: https://pkg.go.dev/testing
