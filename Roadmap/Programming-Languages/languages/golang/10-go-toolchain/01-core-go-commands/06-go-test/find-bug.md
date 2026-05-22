# go test — Find the Bug

Each scenario looks fine but misbehaves. Find the defect, explain it, fix it.

---

## Bug 1 — Test never runs

```go
// in math_test.go
func testAdd(t *testing.T) { ... }   // lowercase 't'
```

```bash
$ go test
ok  ...  (no tests run)
```

**Bug:** the function is `testAdd`, not `TestAdd`; Go only runs exported `TestXxx` functions.
**Fix:** rename to `func TestAdd(t *testing.T)`.

---

## Bug 2 — Stale pass from the cache

```bash
$ go test ./integration/...
ok  ...  (cached)     # but the external DB schema changed!
```

**Bug:** the integration test reads untracked external state; the cache cannot see the DB changed, so it serves a stale pass.
**Fix:** run integration suites with `-count=1` so they always re-run.

---

## Bug 3 — Benchmarks "don't run"

```bash
$ go test -bench=BenchmarkAdd
# regular tests run, benchmark output missing or tests dominate
```

**Bug:** without `-run='^$'`, regular tests also run; and if the bench regex does not match, nothing benchmarks.
**Fix:** `go test -bench=BenchmarkAdd -run='^$'` (and verify the benchmark name matches the regex).

---

## Bug 4 — Race "flake" retried away

CI retries a test that occasionally reports `DATA RACE` and eventually passes, so the pipeline goes green.

**Bug:** a `DATA RACE` is a real bug, not a flake; retrying hides it and ships the bug.
**Fix:** fix the synchronization; never retry past a race. Keep `-race` in CI.

---

## Bug 5 — Parallel subtests share the loop variable (pre-1.22)

```go
for _, tc := range cases {
	t.Run(tc.name, func(t *testing.T) {
		t.Parallel()
		check(tc.input)   // tc captured by reference (Go < 1.22)
	})
}
```

**Bug:** before Go 1.22, all parallel subtests see the final `tc` because the loop variable is shared.
**Fix:** shadow it (`tc := tc`) before `t.Run`, or build with Go 1.22+ where per-iteration variables fix this.

---

## Bug 6 — Coverage looks suspiciously high

```bash
go test -coverpkg=./... ./somepkg
# reports 95% but somepkg is barely tested
```

**Bug:** `-coverpkg=./...` measures coverage of *all* packages from this one test run, mixing in coverage incidental to imports — the number does not reflect `somepkg`'s real coverage.
**Fix:** measure the package under test without `-coverpkg`, or use `-coverpkg` only deliberately for integration coverage and interpret it correctly.

---

## Bug 7 — `TestMain` swallows failures

```go
func TestMain(m *testing.M) {
	setup()
	m.Run()      // exit code ignored!
	teardown()
}
```

**Bug:** the result of `m.Run()` is discarded, so the process exits 0 even when tests fail.
**Fix:** `code := m.Run(); teardown(); os.Exit(code)`.

---

## Bug 8 — Hang "fixed" by raising the timeout

```bash
go test -timeout=60m ./...    # to stop the "timeout" failures
```

**Bug:** the test deadlocks; raising the timeout just makes CI hang longer before failing.
**Fix:** read the goroutine dump the timeout prints, find the deadlock, and fix it. Keep a sane `-timeout`.

---

## Bug 9 — Temp files leak between tests

```go
f, _ := os.Create("/tmp/test.out")   // fixed path, shared across tests
```

**Bug:** a fixed temp path collides across parallel tests and is not cleaned up.
**Fix:** use `dir := t.TempDir()` (auto-cleaned, unique per test) and write inside it.

---

## How to approach these
1. Test not running? → check the `TestXxx` name/signature.
2. `(cached)` on external-state tests? → `-count=1`.
3. Benchmarks/tests selection? → `-bench` and `-run` are separate.
4. Race "flake"? → it's a real bug; fix synchronization.
5. `TestMain` weirdness? → `os.Exit(m.Run())`.
6. Hang? → read the goroutine dump, don't bump the timeout.
