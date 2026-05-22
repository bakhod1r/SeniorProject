# go test — Professional

## 1. Standardize the CI test command

Define one canonical CI invocation so every repo tests the same way:

```bash
go test -race -covermode=atomic -coverprofile=cover.out -shuffle=on -timeout=5m ./...
```

Encode it in a Makefile/CI step and document the rationale:
- `-race` — catch concurrency bugs (a `DATA RACE` blocks merge).
- `-covermode=atomic` — race-safe coverage counters.
- `-shuffle=on` — surface hidden test-ordering dependencies (log the seed).
- `-timeout` — fail fast on hangs with a goroutine dump rather than a stuck job.

---

## 2. Coverage as a signal, not a gate-by-number

Reporting coverage is useful; hard-failing a PR on a coverage percentage often backfires (asserting-nothing tests game the metric). Professional policy:

- Track coverage trends and surface deltas in PRs (e.g., via a coverage bot).
- Require coverage for **new, risky** code in review judgment, not a blanket repo threshold.
- Use `go tool cover -html` in review when a change drops coverage to see *what* is untested.

```bash
go tool cover -func=cover.out | tail -1     # repo total
go tool cover -html=cover.out -o cover.html # artifact for the PR
```

---

## 3. Separate fast and slow tests

Keep the inner loop and PR gate fast; run heavy suites separately.

```go
//go:build integration
package payments
```

```bash
go test ./...                       # unit tests, fast (PR gate)
go test -tags=integration ./...     # integration, on a schedule or merge
```

Policy: unit tests must be hermetic (no network/DB), run in seconds, and never `t.Skip` silently in CI. Integration/e2e tests live behind tags and run on a slower cadence.

---

## 4. Flaky test policy

Flakes erode trust in CI. Establish a clear protocol:

- A `DATA RACE` is **never** a flake — fix it, never retry.
- Quarantine genuinely flaky tests (tag/skip with a tracking issue) rather than auto-retrying everything, which hides real intermittent bugs.
- Forbid blanket `--retry` on the whole suite; if a test needs retries, it is testing something nondeterministic that should be made deterministic (fake clock, seeded RNG, controlled concurrency).
- Use `-shuffle=on` and `-race` in CI to *find* nondeterminism early.

---

## 5. Determinism and test data

- Inject clocks, RNG seeds, and IDs so tests are reproducible (`-shuffle` seed, fixed `rand` seed).
- Use `t.TempDir()` and `t.Cleanup()` for filesystem isolation that auto-cleans.
- Use `testing.Short()` (`-short`) to let `go test -short` skip long tests in quick loops.
- Prefer golden files with an explicit `-update` flag for large expected outputs:

```go
var update = flag.Bool("update", false, "update golden files")
// compare against testdata/x.golden; rewrite when -update is set
```

---

## 6. Performance regression tracking

For performance-sensitive code, make benchmarks part of the process:

```bash
go test -bench=. -benchmem -count=10 -run='^$' ./pkg | tee new.txt
benchstat base.txt new.txt
```

Policy: store a baseline, run benchmarks with `-count` ≥ 10, and review `benchstat` deltas for significant regressions. Treat CI benchmark *absolutes* as noisy; compare relative deltas on the same runner.

---

## 7. Caching strategy in CI

- The test cache is usually cold per CI job; cache `GOCACHE` and `GOMODCACHE` to speed compilation, not test execution caching.
- For integration suites that touch untracked external state, run with `-count=1` so a stale `(cached)` pass cannot mask a regression.
- Do not rely on the test cache for correctness gates — rely on it for local speed.

---

## 8. Reviewing for misuse

| Smell | Why it's wrong | Fix |
|-------|----------------|-----|
| `t.Skip` with no reason in CI | silently disables coverage | require a reason + tracking issue |
| Retrying the whole suite on failure | hides real flakes/races | quarantine specific tests; fix nondeterminism |
| Unit tests hitting a real DB/network | slow, flaky, non-hermetic | tag as integration; fake the dependency |
| Coverage-gaming tests (assert nothing) | false confidence | review asserts, not just the % |
| No `-race` in CI | concurrency bugs ship | add `-race` to the gate |
| Bumping `-timeout` to "fix" a hang | masks a deadlock | read the goroutine dump; fix the hang |

---

## 9. Summary

Standardize one CI test command (`-race -covermode=atomic -shuffle=on -timeout=...`), treat coverage as a reviewed signal rather than a gamed number, and split fast hermetic unit tests from tag-gated integration tests. Enforce a flaky-test policy that fixes nondeterminism instead of retrying, make tests deterministic (clocks, seeds, `t.TempDir`, golden files with `-update`), track benchmark deltas with `benchstat`, and use `-count=1` for integration suites that touch untracked state. A `DATA RACE` always blocks merge.

---

## Further reading
- `go help testflag`
- Coverage for integration tests: https://go.dev/doc/build-cover
- `testing` (TempDir, Cleanup, Short): https://pkg.go.dev/testing
