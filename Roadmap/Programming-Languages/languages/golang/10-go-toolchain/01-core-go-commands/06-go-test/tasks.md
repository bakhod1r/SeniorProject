# go test — Hands-on Tasks

Go 1.21+. Each task has explicit acceptance criteria.

---

## Task 1: Write and run a test

Create a function and a passing test.

**Acceptance criteria**
- [ ] A `_test.go` file with `func TestXxx(t *testing.T)` exists.
- [ ] `go test` prints `ok`.
- [ ] `go test -v` shows the test name and `PASS`.
- [ ] Introducing a bug makes it `FAIL` with a useful message and non-zero exit.

---

## Task 2: Table-driven subtests

Convert a test to table-driven form.

**Acceptance criteria**
- [ ] Multiple cases run via `t.Run(name, ...)`.
- [ ] `go test -run 'TestX/<casename>'` runs exactly one case.
- [ ] `go test -v` shows each subtest separately.

---

## Task 3: Observe and bypass the cache

See caching in action.

**Acceptance criteria**
- [ ] A second `go test` shows `(cached)`.
- [ ] `go test -count=1` re-runs (no `(cached)`).
- [ ] `go clean -testcache` then `go test` re-runs.

---

## Task 4: Catch a race

Write code with a data race and detect it.

**Acceptance criteria**
- [ ] Two goroutines write a shared variable without synchronization.
- [ ] `go test` may pass; `go test -race` reports `DATA RACE`.
- [ ] Adding a mutex/channel makes `-race` clean.

---

## Task 5: Coverage report

Generate and read coverage.

**Acceptance criteria**
- [ ] `go test -coverprofile=cover.out ./...` writes the profile.
- [ ] `go tool cover -func=cover.out` shows per-function coverage.
- [ ] `go tool cover -html=cover.out` opens an annotated view.

---

## Task 6: Benchmark and compare

Benchmark a function and compare two implementations.

**Acceptance criteria**
- [ ] `go test -bench=. -benchmem -run='^$'` runs only benchmarks with alloc stats.
- [ ] `-count=10` produces enough samples for `benchstat`.
- [ ] `benchstat old.txt new.txt` shows whether a change is a real improvement.

---

## Task 7: Shuffle to find ordering bugs

Create an inter-test dependency and expose it.

**Acceptance criteria**
- [ ] Two tests share package-level state so order matters.
- [ ] `go test -shuffle=on` sometimes fails and prints a seed.
- [ ] `go test -shuffle=<seed>` reproduces the failure.
- [ ] Removing the shared state makes shuffling safe.

---

## Task 8: Tag integration tests

Separate slow tests behind a build tag.

**Acceptance criteria**
- [ ] An integration test is gated with `//go:build integration`.
- [ ] `go test ./...` skips it; `go test -tags=integration ./...` runs it.
- [ ] You explain why this keeps the inner loop fast.
