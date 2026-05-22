# go test — Interview Q&A

Labeled by level. Concise answers.

---

## Junior

**Q1. How does `go test` find tests?**
It compiles `_test.go` files and runs functions matching `func TestXxx(t *testing.T)`. `go test ./...` runs them across the module.

**Q2. How do you run only one test?**
`go test -run <regex>`, e.g., `go test -run '^TestAdd$'`. For a subtest: `-run TestAdd/case1`.

**Q3. What does a non-zero exit from `go test` mean?**
At least one test failed (or the build/test errored). CI uses this exit code to fail the pipeline.

**Q4. How do you see per-test output?**
`go test -v` prints each test name and its result and any `t.Log` output.

---

## Middle

**Q5. Why does `go test` sometimes print `(cached)`?**
Go caches passing test results keyed on the test's inputs. Unchanged tests are not re-run. Force a re-run with `-count=1` or clear with `go clean -testcache`.

**Q6. What does `-race` do and what does it cost?**
It instruments the binary to detect unsynchronized concurrent access. It runs ~2–10x slower with more memory. A `DATA RACE` report is always a real bug.

**Q7. How do you measure coverage, and why `-covermode=atomic`?**
`go test -cover` or `-coverprofile=c.out` then `go tool cover`. Use `-covermode=atomic` when combining with `-race` or parallel tests so coverage counters are race-safe.

**Q8. How do you run only benchmarks?**
`go test -bench=. -run='^$'` — `-run='^$'` matches no tests, so only benchmarks run. Add `-benchmem` for allocation stats.

---

## Senior

**Q9. When can the test cache give a wrong (stale) pass?**
When a test depends on untracked external state (network, time, a database) the cache cannot observe. Use `-count=1` for such suites so they always re-run.

**Q10. Difference between `-p`, `-parallel`, and `t.Parallel()`?**
`-p` caps packages tested concurrently; `-parallel` caps parallel tests within a package; `t.Parallel()` marks a test to run concurrently with other parallel tests. Tune `-p`/`-parallel` to the CPU quota.

**Q11. How do you benchmark reliably?**
Run with `-count=N` (≥10), `-benchmem`, `-run='^$'`, on a quiet machine, and compare with `benchstat` for statistical significance — single runs are noise.

**Q12. What does `-shuffle=on` catch, and how do you reproduce a failure?**
It randomizes test order to expose hidden inter-test dependencies. It prints a seed; re-run with `-shuffle=<seed>` to reproduce.

---

## Professional

**Q13. What is your CI test command and why?**
`go test -race -covermode=atomic -shuffle=on -timeout=5m ./...` — race detection, race-safe coverage, ordering-bug detection, and fail-fast on hangs. Documented and standardized across repos.

**Q14. How do you handle flaky tests?**
Fix the nondeterminism (inject clocks, seed RNG, control concurrency) rather than retrying. A `DATA RACE` is never a flake. Quarantine genuinely flaky tests with a tracking issue instead of blanket retries that hide real bugs.

---

## Common traps

- Test file not ending in `_test.go` or wrong `TestXxx` signature.
- Expecting `-bench` to run regular tests (or vice versa).
- Being fooled by `(cached)` on tests with external state.
- Coverage-as-a-target gaming (asserting nothing).
- Bumping `-timeout` instead of fixing a deadlock.
- Forgetting `os.Exit(m.Run())` in `TestMain`.
- Loop-variable capture in pre-1.22 parallel subtests (`tc := tc`).
