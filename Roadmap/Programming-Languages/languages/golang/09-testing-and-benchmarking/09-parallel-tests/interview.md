---
layout: default
title: Parallel Tests — Interview
parent: Parallel Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/09-parallel-tests/interview/
---

# Parallel Tests — Interview

[← Back](../)

Interviewers love `t.Parallel` because a single ten-line snippet can probe knowledge of the runtime scheduler, the race detector, the Go memory model, and the pre-1.22 loop-variable gotcha simultaneously. The questions below are grouped from warm-up to staff-engineer depth.

## Warm-up

**Q1. What does `t.Parallel()` actually do?**
A. It signals the testing framework that the current test is safe to run in parallel with other tests that also called `t.Parallel`. It pauses the test until the parent has finished its serial work, then resumes it concurrently with other parallel siblings, subject to `-parallel`.

**Q2. What is the default value of the `-parallel` flag?**
A. `GOMAXPROCS` of the test binary at startup. On a typical 16-core developer laptop, that's 16.

**Q3. Do all tests in a package run in parallel by default?**
A. No. Tests run serially unless they explicitly call `t.Parallel`. The default is conservative because most tests share package state.

**Q4. Can a test call `t.Parallel` twice?**
A. No. The second call panics: `testing: t.Parallel called multiple times`.

## Core mechanics

**Q5. Describe the pre-1.22 loop-variable capture bug in parallel subtests.**
A. In Go ≤1.21, the loop variable in `for _, tc := range cases` had one address per loop. When a closure inside `t.Run` called `t.Parallel`, the goroutine was paused and resumed *after* the loop had advanced. All paused goroutines then saw the final `tc`. The fix was `tc := tc` to shadow per iteration. Go 1.22 changed for-loop semantics so each iteration declares a fresh variable, eliminating the bug.

**Q6. Why does `t.Setenv` panic if `t.Parallel` was already called?**
A. `os.Setenv` mutates process-global state. Parallel tests run concurrently in the same process, so a per-test env change would race with sibling tests. `t.Setenv` therefore forbids being called from a parallel test or a test with a parallel ancestor.

**Q7. What is the relationship between `-parallel` and `GOMAXPROCS`?**
A. `-parallel` is the max number of *test functions* allowed to run concurrently. `GOMAXPROCS` is the max number of *OS threads* the runtime uses. Setting `-parallel 32` on a `GOMAXPROCS=2` machine still bottlenecks CPU-bound tests at 2x speedup, though I/O-bound tests can benefit.

**Q8. What happens to subtests when the parent test returns?**
A. The parent's `t.Run` call returns only after the subtest has finished — *unless* the subtest called `t.Parallel`, in which case `t.Run` returns once the subtest is paused. The framework then runs the parallel subtests after all serial siblings of the parent have completed.

**Q9. How do you wait for a group of parallel subtests to all finish before doing something next?**
A. Wrap them in another `t.Run`:

```go
t.Run("group", func(t *testing.T) {
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            // ...
        })
    }
})
// After "group" returns, all its parallel children are done.
```

## Isolation and shared state

**Q10. List four kinds of shared state that defeat `t.Parallel`.**
A. Environment variables, the working directory, package-level mutable variables, and external resources (files at fixed paths, ports, shared DB rows).

**Q11. How does `t.TempDir` help?**
A. It creates a unique temp directory per test, registered for cleanup. Parallel tests can each call it without colliding.

**Q12. You discover two tests write to `/tmp/output.json`. Both call `t.Parallel`. Are they safe?**
A. No. They race on the file. Either use `t.TempDir` or serialize them by removing `t.Parallel` from at least one.

**Q13. A test calls `os.Setenv("FOO", "bar")` directly (not `t.Setenv`) and `t.Parallel`. What's wrong?**
A. The env mutation leaks into sibling parallel tests and persists after the test. `t.Setenv` would refuse this combo at runtime, but a raw `os.Setenv` silently corrupts state.

## Race detector

**Q14. When should you run `-race`?**
A. In CI on every PR if budget allows; otherwise on a nightly job. Locally, run `-race` whenever you change shared state or add `t.Parallel` to a test that previously was serial.

**Q15. Why is `-race` not on by default?**
A. It adds 5–10x runtime and ~10x memory overhead and is unavailable on some platforms (e.g., 32-bit). It also can change scheduling and mask Heisenbugs.

**Q16. What does the race detector *not* catch?**
A. Deadlocks, missed updates due to logic bugs, races on the file system or other processes, and races on memory written through `unsafe.Pointer` in some patterns.

## TestMain interaction

**Q17. Does `m.Run()` return before parallel tests finish?**
A. No. `m.Run` blocks until all tests (serial and parallel) and their cleanups complete. This is why `TestMain` teardown after `m.Run` is safe.

**Q18. You set a package var in `TestMain` before `m.Run`. Many parallel tests read it. Safe?**
A. Reads are safe because the var is set before any test starts (happens-before relationship). Writes from parallel tests would be unsafe without synchronization.

## Cleanup

**Q19. In a parallel test that calls `t.Cleanup(f1)` then `t.Cleanup(f2)`, what is the call order?**
A. `f2` first, then `f1` (LIFO). Both run on the test's own goroutine after the test (and all its subtests) finish.

**Q20. Should you use `defer` or `t.Cleanup` in a parallel test?**
A. Prefer `t.Cleanup`. `defer` runs when the test *function* returns; for a parallel test, that may be *before* the parallel section truly finishes if the test pauses subtests. `t.Cleanup` runs after the entire subtree completes and is robust against `t.FailNow`/`t.Skip`.

## Design and trade-offs

**Q21. When should you NOT add `t.Parallel`?**
A. When the test mutates global state, touches the env or `os.Chdir`, expects to observe side effects in a specific order, or is itself faster than the scheduling overhead.

**Q22. Why might enabling `t.Parallel` on every test slow the suite down?**
A. Goroutine scheduling overhead, contention on a shared mutex (e.g., a single log file), cache-line bouncing on shared atomics, or the race detector's per-allocation cost. A serial 50 ms suite can become 60 ms in parallel if every test contends on the same package-level slice.

**Q23. How do you control a budget of 8 DB connections across 100 parallel tests?**
A. Pool with a buffered channel: `var dbPool = make(chan *DB, 8)`. Tests acquire by receiving and release in `t.Cleanup`. The buffered channel is the natural semaphore.

**Q24. How do you debug a flake that only happens with `-parallel`?**
A. (1) Run with `-race`. (2) Reduce `-parallel` to 2, then to 1 — if 1 fixes it, you've confirmed it's a race. (3) Add `-count=100 -run=TestFlake` to reproduce. (4) Use `GODEBUG=schedtrace=1000` and `GORACE="halt_on_error=1"` to capture the first race. (5) Inspect `t.Cleanup` order and any `sync.Once` or package-level state shared by the tests in the failing group.

## Tricky edge cases

**Q25. What's the output order of these tests?**

```go
func TestA(t *testing.T) { t.Parallel(); t.Log("A") }
func TestB(t *testing.T)  { t.Log("B") }
func TestC(t *testing.T) { t.Parallel(); t.Log("C") }
```

A. Logs in registration order are deceptive. The Go test runner runs `TestA` (which calls `t.Parallel` and pauses), then `TestB` serially (logs "B"), then `TestC` (pauses), then resumes A and C in parallel. The actual print order is "B" first; "A" and "C" may interleave. Don't rely on test print order in parallel tests.

**Q26. A subtest calls `t.Parallel`. The parent does not. Does the parent return before the subtest finishes?**
A. Yes, `t.Run` returns when the subtest pauses. The framework runs the subtest later, but the parent's deferred logic must not assume the subtest is done. Use a wrapping `t.Run("group", ...)` to bracket.

**Q27. Two tests use `t.Setenv` for the same key. Are they parallel-safe?**
A. No. `t.Setenv` implicitly serializes by panicking on `t.Parallel`. They run serially. The framework restores the original value via `t.Cleanup`, so each test sees a clean baseline.

## Staff-level

**Q28. Design a `Test*` strategy for a 5000-test repo where 80% are CPU-light, 15% need a Postgres connection, and 5% need an external HTTP service.**
A. (1) CPU-light: all call `t.Parallel`. (2) DB-using: parallel, with a pooled-channel of 16 connections and `t.TempDir`-rooted schemas. (3) External HTTP: gated by a build tag `//go:build integration`, run serially in a dedicated CI job. (4) `-parallel` set to 32 in CI; `-race` job at `-parallel 8`. (5) `goleak.VerifyTestMain(m)` to catch goroutine leaks.

**Q29. How would you enforce "every new test calls `t.Parallel` unless it has a documented reason"?**
A. Write a custom `go/analysis` linter that flags `func Test*` without `t.Parallel`, with a `// nolint:noparallel` escape comment for legitimate cases. Wire it into `golangci-lint`.

**Q30. The CI suite times out at 10 minutes. Profiling shows tests sit idle on a single mutex. What now?**
A. Identify the mutex (likely a logger, a metrics registry, or a once-initialized singleton). Sharded counters, `sync.Pool` for buffers, or lazy per-test instances usually resolve it. If the mutex is in production code, document it as a known parallel-test scaling limit and consider an internal `_test.go` helper that bypasses it.

## Coding-question style

**Q31. Write a parallel-safe table-driven test for a function `Add(a, b int) int`.**

```go
func TestAdd(t *testing.T) {
    cases := []struct {
        name       string
        a, b, want int
    }{
        {"zero", 0, 0, 0},
        {"pos", 2, 3, 5},
        {"neg", -1, -1, -2},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            if got := Add(tc.a, tc.b); got != tc.want {
                t.Errorf("Add(%d,%d) = %d, want %d", tc.a, tc.b, got, tc.want)
            }
        })
    }
}
```

On Go 1.22+ no `tc := tc` is needed.

**Q32. Write a helper that returns a fresh `*httptest.Server` per test with automatic cleanup.**

```go
func newServer(t *testing.T) *httptest.Server {
    t.Helper()
    srv := httptest.NewServer(http.HandlerFunc(handle))
    t.Cleanup(srv.Close)
    return srv
}
```

The `t.Helper()` call moves failure-line reporting to the caller.

**Q33. Write a pooled-DB helper for parallel tests with a budget of 4 connections.**

```go
var dbPool = make(chan *sql.DB, 4)

func acquireDB(t *testing.T) *sql.DB {
    t.Helper()
    select {
    case db := <-dbPool:
        t.Cleanup(func() { dbPool <- db })
        return db
    case <-t.Context().Done():
        t.Fatal("timed out waiting for DB")
        return nil
    }
}
```

The `select` on `t.Context().Done()` prevents the test from hanging if no connection ever frees.

## Behavioural questions

**Q34. Tell me about a parallel-test bug you've debugged.**
A. Look for a specific story: which test, what symptom (flake / panic / hang), what protocol you used (`-race`, `-count`, `goleak`), what the root cause was, and what you changed to prevent it from recurring. Avoid generic answers; interviewers want a concrete narrative.

**Q35. When have you decided NOT to make a test parallel?**
A. Common honest answers: tests that exercise signal handlers, tests using `os.Setenv` for legacy code that can't easily be refactored, tests checking `init`-time behavior, integration tests against a single shared service where ordering matters.

**Q36. How would you convince a team to adopt parallel-by-default tests?**
A. (1) Pick the slowest CI job and measure how much time `t.Parallel` would save. (2) Run a one-package proof of concept; show the before/after wall time. (3) Pair-program the migration in a leaf package, document the patterns. (4) Add a linter that warns (not blocks) on missing `t.Parallel`; promote to error after 2 weeks. (5) Make `-race` mandatory on PRs so the new parallelism doesn't ship hidden races.

## Sanity checks

**Q37. Is `t.Parallel` safe to call from a goroutine spawned by a test?**
A. No. `t.Parallel` must be called from the test's own goroutine. Calling it from a spawned goroutine yields undefined behavior. Spawned goroutines share the test's failure state via `t.Errorf` etc., but parallel scheduling decisions belong to the test goroutine.

**Q38. Does `t.Parallel` work in benchmarks?**
A. No, benchmarks use `b.RunParallel` and `b.SetParallelism` instead. The model is different: one benchmark function distributed across goroutines, not many benchmarks running concurrently.

**Q39. Can you call `t.Parallel` in `Example` functions?**
A. No. Examples don't take a `*testing.T`; they have their own runner. Parallelism doesn't apply.

**Q40. Does `t.Parallel` affect the test's deadline?**
A. No. The `-timeout` is for the entire test binary. Individual tests have no per-test deadline unless they install one via `t.Context()` with a `context.WithDeadline`. The pause time before resuming is not "deadline time".

## Trick questions

**Q41. Two parallel tests call `t.Setenv` for different keys. Are they safe?**
A. Trick — they can't both call `t.Setenv` *and* `t.Parallel`. The framework panics. If one of them calls `t.Setenv` only and the other only `t.Parallel`, they're serialized at the framework level (the Setenv one runs serially), no race.

**Q42. A test calls `os.Setenv` (not `t.Setenv`) and `t.Parallel`. What happens?**
A. Nothing at the framework level — `os.Setenv` doesn't introspect the test. The env var leaks across tests and is set/unset in a racing pattern. `-race` may or may not catch it (env access is below the detector's view in some implementations). The test passes today, breaks tomorrow when CI scheduling changes. Don't do this.

**Q43. Can `t.Cleanup` register more cleanups during cleanup?**
A. Yes. Cleanups can call `t.Cleanup`, and the newly registered cleanups run after the current one finishes, still in LIFO order. Useful for cascading teardown, though usually a sign that the resources are mis-layered.

**Q44. After `t.Parallel`, does the test continue to share `t.TempDir` with sibling tests?**
A. No. Each `t.TempDir` call returns a unique directory, regardless of parallelism. Siblings each get their own.

**Q45. Inside a parallel subtest, can `t.Logf` output interleave with another sibling's `t.Logf`?**
A. No. `t.Log` and `t.Logf` are buffered per test and flushed when the test finishes. The output is per-test contiguous, even when tests run in parallel.

## Rapid-fire round

**Q46. What does `-cpu=1,2,4` do?**
A. Runs every matched test three times with `GOMAXPROCS` set to 1, 2, then 4. Useful for verifying behavior on different core counts.

**Q47. Does `t.Parallel` work with `-fuzz`?**
A. Fuzz seed-corpus tests run in parallel honouring `-parallel`. Active fuzzing uses `-fuzz` and its own subprocess parallelism.

**Q48. How do you make a benchmark run in parallel?**
A. `b.RunParallel(func(pb *testing.PB) { for pb.Next() { ... } })`. Different model from `t.Parallel`.

**Q49. What does `-shuffle=on` do, and how does it interact with `t.Parallel`?**
A. Shuffles the order of top-level tests before running. Parallel tests still pause and resume in batches; only the visible ordering of serial tests differs.

**Q50. Name three things `t.Cleanup` does that `defer` doesn't.**
A. (1) Runs after all subtests, not just the test function. (2) Robust against `t.FailNow` semantics. (3) LIFO order across multiple registrations from different call sites, including helpers.

**Q51. How does `-count=N` interact with `-parallel`?**
A. Each matched test is run N times in the same binary. Multiple runs of the same test never run in parallel with each other (per godoc).

**Q52. What is the relationship between `runtime.GOMAXPROCS(0)` and the test's parallelism?**
A. `GOMAXPROCS` is the OS-thread parallelism for goroutines. `-parallel` is the test-level batching. They compose: `-parallel 16` on `GOMAXPROCS=2` parks lots of goroutines but only 2 run simultaneously for CPU work.

**Q53. Does `go test -p 1` disable test-level parallelism?**
A. No. `-p` controls how many *packages* test in parallel. To disable test-level parallelism within a package, use `-parallel 1`.

**Q54. If a test calls `t.Parallel`, does the production code it tests need to be thread-safe?**
A. Not necessarily — only if the test shares production-code state across siblings. A pure function tested in parallel needs no thread-safety in the function itself. A function holding shared state (e.g., a singleton registry) does.

**Q55. What's the smallest change that turns a serial suite parallel?**
A. Adding `t.Parallel()` as the first line of each test function. Sometimes that's all that's needed (for pure tests). Sometimes it surfaces a race; then more work follows.

**Q56. How would you fairly compare two implementations of `Compute(x)` under parallel testing?**
A. Use benchmarks (`b.RunParallel`), not regular tests. Tests check correctness; benchmarks measure performance. Different concerns, different tools.

**Q57. Suppose `t.Parallel` had never been added to Go. How would the language look different?**
A. Tests would either be slower (serial) or hand-rolled with goroutines, requiring explicit synchronization in every test. The framework's built-in batching, cleanup ordering, and serialisation rules make parallel testing accessible to any author. Without it, parallel testing would be a senior-only skill rather than a junior-level default.

## Closing questions

**Q58. Sketch the lifecycle of a parallel test from `=== RUN` to `--- PASS`.**
A. (1) Goroutine starts; (2) Serial setup; (3) `t.Parallel()` parks the goroutine; (4) Framework continues with serial siblings; (5) Framework wakes the goroutine; (6) Test body executes concurrently with peers; (7) Test function returns; (8) Cleanups run in LIFO order; (9) PASS/FAIL is reported. The whole sequence is logged by `-v`.

**Q59. If you had to teach `t.Parallel` to a new Go engineer in five minutes, what would you cover?**
A. (1) "Add `t.Parallel()` as the first line of every test." (2) "Don't touch globals, env vars, or the working directory." (3) "Use `t.TempDir` and `t.Cleanup`." (4) "Run with `-race` to catch mistakes." (5) "Look at how the standard library does it for examples."

**Q60. What's the most underrated `testing` package method?**
A. `t.Helper()`. Almost every test author writes helper functions; without `t.Helper`, failure-line attribution points inside the helper rather than the calling test, which makes debugging needlessly painful. One line per helper, big quality-of-life win.

## Interview prep advice

When preparing for a Go interview that touches parallel testing:

- Have a 30-second answer ready for "what does `t.Parallel()` do?"
- Be ready to write a parallel table-driven test on a whiteboard with no IDE.
- Know the pre-1.22 loop-variable bug well enough to spot it instantly.
- Know the difference between `-parallel` and `-p`.
- Know what `-race` does and roughly its cost.
- Have a war story about a parallel test bug you debugged.

Interviewers want signal that you've actually written and debugged parallel tests, not just read about them. Concrete examples from your own work are gold.
