---
layout: default
title: Testing Basics — Interview
parent: Testing Basics
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/01-testing-basics/interview/
---

# Testing Basics — Interview

[← Back](../)

Twenty-five questions ranging from first-day-on-the-job through staff-level. Each has a model answer of one or two paragraphs and, where useful, a code sketch. You should be able to answer the first dozen verbally; the senior and staff ones are good whiteboard prompts.

## Junior (warm-up)

### 1. How does `go test` find tests?

It compiles every `_test.go` file in the package directory into an ephemeral binary. Inside those files it picks up any top-level function matching the signature `func TestXxx(t *testing.T)` where `Xxx` starts with an uppercase letter. Discovery is purely by name and signature — no registration call, no tag.

### 2. What is the difference between `t.Error` and `t.Fatal`?

`t.Error` marks the test as failed but lets it continue running. `t.Fatal` marks the test as failed and then calls `runtime.Goexit`, terminating the test goroutine immediately. Use `Fatal` when continuing would produce noise or a nil-pointer dereference; use `Error` when you want to report multiple independent assertions in a single run.

### 3. Why does Go not ship with an `assert` function?

The standard library deliberately keeps the test API minimal: an `assert(cond)` that aborts on first failure encourages tests that stop reporting after one assertion, hides the actual versus expected values, and produces opaque "assertion failed at line 42" messages. Idiomatic Go writes `if got != want { t.Errorf("got %v, want %v", got, want) }`. The verbosity is deliberate — it forces you to include diagnostic context in every check.

### 4. Why must `_test.go` files be named that way?

The Go toolchain treats `_test.go` as a magic suffix: such files are compiled only by `go test` and ignored by `go build`. This guarantees that test helpers and dependencies never bloat your production binary or leak into the public API.

### 5. What happens if a test function panics?

The `testing` framework recovers the panic in the goroutine running the test, marks the test failed, prints the panic value and stack trace, and continues to the next test. If a panic happens in a *separate* goroutine spawned by the test, however, it crashes the whole test binary — there is no per-goroutine recovery.

## Middle

### 6. Internal vs external test package — when do you choose which?

Internal (`package foo`) tests can touch unexported state, so they are appropriate for white-box unit tests of complex algorithms with awkward private invariants. External (`package foo_test`) tests can import only the public API and therefore double as compile-time checks that the public API is sufficient. The convention is: write external tests by default, drop into internal tests only when the public API genuinely cannot reach the case (e.g. testing an unexported invariant after a private mutation).

### 7. What does `t.Parallel()` actually do?

It marks the current test as parallel and immediately blocks until the test framework decides it can resume. The framework runs all non-parallel tests sequentially first; then it resumes parallel tests concurrently, up to `-parallel` at a time (default `GOMAXPROCS`). Subtests inside a `t.Run` follow the same rule scoped to their parent. A subtle consequence: if a parent test calls `t.Parallel`, the parent's `Cleanup` runs only after all its parallel subtests complete.

### 8. Why does this loop only test the last case?

```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        check(tc)
    })
}
```

In Go versions before 1.22 the loop variable `tc` is shared across iterations. Each parallel subtest closes over the same variable and observes its final value. Fix: introduce a fresh binding `tc := tc` inside the loop, or upgrade to Go 1.22+ where the loop-variable scoping change makes this safe.

### 9. What does `t.Helper()` do?

`t.Helper()` marks the calling function as a helper. When the test framework reports a failure, it walks up the stack and reports the line of the first frame that is *not* a helper. So if your `assertEqual` helper calls `t.Errorf`, the error line shows up in the caller of `assertEqual`, not inside it. Helpers must call `t.Helper()` at the top.

### 10. What is the ordering of `t.Cleanup` calls?

Cleanups run in LIFO order: the last registered runs first. They run after the test (or subtest) and all its subtests complete — including subtests marked parallel. Cleanups themselves can register further cleanups, which run within the same LIFO ordering before the parent's earlier-registered cleanups.

### 11. Why is `t.Setenv` incompatible with `t.Parallel`?

Environment variables are process-global. If one parallel test sets `FOO=a` and another sets `FOO=b`, they race and the loser sees corrupted state. `t.Setenv` defends against this by panicking if called from a test that previously called `t.Parallel`, and by refusing to mark the test parallel afterwards. Use `t.Setenv` only in serial tests.

### 12. What does `-count=1` do?

It forces `go test` to skip the build cache for this invocation. Without it, `go test ./...` may print `(cached)` and return instantly. `-count=1` is the conventional way to say "re-run even if nothing has changed" — for example after fixing a flaky network test where the bug was environmental.

## Senior

### 13. When would you write `TestMain`?

When the test binary needs setup or teardown that cannot be expressed per-test: bringing up an in-memory database, applying schema migrations, starting an HTTP fixture server, initialising a CGO library, or installing a custom logger. The pattern:

```go
func TestMain(m *testing.M) {
    db := startTestDB()
    code := m.Run()
    db.Close()
    os.Exit(code)
}
```

Avoid `TestMain` when `t.Cleanup` plus a sync.Once initialiser will do — `TestMain` makes parallel test design harder because every test sees the same global state.

### 14. How would you separate unit from integration tests in one repository?

Three common approaches:

1. Build tags: integration tests live in files with `//go:build integration`, run via `go test -tags=integration`.
2. `testing.Short()`: every integration test starts with `if testing.Short() { t.Skip() }`, and CI fast-loop runs `go test -short ./...`.
3. Directory split: `pkg/foo` has unit tests, `pkg/foo/it` has integration tests with their own `TestMain`.

Build tags are the cleanest for CI but require remembering to pass `-tags`. `-short` is friendliest to local developers. Directory split scales best in monorepos where integration tests need their own dependencies.

### 15. How does Go's test cache decide a test is up to date?

The cache keys a test result by the SHA-256 of the test binary's inputs: compiled sources, build tags, compiler version, plus any files the test read via `os.Open` or environment variables it read via `os.Getenv` (tracked by `runtime/testdeps`). If all of these match a previous run, the previous PASS is reused. FAILures are never cached.

### 16. How do you write a deterministic test against time?

Inject a clock. Define a small interface `type clock interface { Now() time.Time }`, depend on it from the code under test, and substitute a fake in tests. The standard library hides this behind `time.Now` directly; production code that wants to be testable should avoid calling it unqualified. Beware sleeping in tests — use channels or `t.Deadline` to bound any wait.

### 17. What does `t.Deadline` return?

The time at which the test will be killed by `-timeout`, or `ok=false` if no deadline is set. Long-running tests can use it to bound their own work: stop polling, finish an in-progress integration test, write final diagnostics. The deadline is shared across subtests of the same `TestMain` invocation.

### 18. What is the difference between `_test.go` and `export_test.go`?

`export_test.go` is a convention, not a tool feature: the file lives in the package directory, declares `package foo` (internal), and re-exports unexported identifiers under capitalised aliases for use by external test packages. Example:

```go
// in foo/export_test.go
package foo
var InternalState = &internalState
func InternalReset() { internalState = nil }
```

External tests in `foo_test` can then use `foo.InternalState`, even though `internalState` is unexported.

### 19. Why might `go test ./...` pass locally but fail in CI?

Common causes: missing `-race` locally (CI catches a race), test depends on a process-wide environment variable that the developer set in their shell, test creates files in the working directory rather than `t.TempDir`, test relies on Unicode locale that differs between OSes, test parallelism uncovers a shared-state bug under `GOMAXPROCS=8`, or the test cache hides a failing test under `-count` mismatch.

### 20. How would you measure flakiness?

Run the test suite with `-count=100` (or `-count=1000` overnight) on a clean CI runner and record pass/fail per test. A flake budget — say, no test may fail more than 1 in 100 — is what you enforce in code review. Tools like `gotestsum` and `flaky` can split per-test statistics. Flakes are bugs; quarantine them but file an issue, do not just `t.Skip`.

## Staff

### 21. Why does Go forbid calling `t.FailNow` from a goroutine other than the test's own?

`FailNow` calls `runtime.Goexit`, which only exits the calling goroutine. If a spawned goroutine called `FailNow`, only that goroutine would exit; the test goroutine would keep running, see no failure indication, and report PASS. The framework therefore panics if you try, and the documentation explicitly requires routing assertions through a channel or `errgroup` back to the test goroutine.

### 22. What is the cost of `t.Parallel`?

Each call to `t.Parallel()` records the test on a queue and yields to a synchronization barrier. There is no per-test goroutine spawn overhead — the test is already running in its own goroutine. The real cost is the loss of test isolation: parallel tests share `os.Environ`, the file system, the current working directory, and global state in packages under test. Sometimes adding `t.Parallel` to every test creates flakes that did not exist serially, and the right answer is to add `t.Parallel` *plus* refactor the package to inject per-test state.

### 23. How would you build a custom test harness on top of `testing.T`?

`testing.T` is concrete, not an interface, but its useful methods can be expressed via a small interface:

```go
type TB interface {
    Helper()
    Errorf(format string, args ...any)
    Fatalf(format string, args ...any)
    Cleanup(func())
    TempDir() string
    Name() string
}
```

Helpers that accept `TB` (or the stdlib's `testing.TB`) work in tests, benchmarks, and fuzz targets. For more advanced harnesses — e.g. property-based testing — you keep `*testing.T` as the leaf and build your own driver above it, but you never re-implement what the framework provides.

### 24. Critique this snippet for a code review.

```go
func TestUser(t *testing.T) {
    db := startDB()
    defer db.Close()
    u := db.NewUser()
    if u.ID == 0 {
        t.Fatal("no id")
    }
}
```

Issues: `db` is a per-test resource and should be created via `t.Cleanup` so panic-safety and `Fatal` both clean up; the `Fatal` message gives no information about what `u.ID` actually was; the assertion is positive but does not check `u.Err` if such a field exists; the test is white-box-ish without justification; if `startDB` is slow it should be hoisted to a `TestMain` with a shared connection pool; the test does not call `t.Parallel`, blocking subsequent tests from running concurrently. A reviewer should suggest `t.Cleanup(db.Close)`, `t.Errorf("u.ID = %d, want non-zero", u.ID)`, and a discussion of fixture reuse.

### 25. Why is the `testing` package considered an anti-example by some test-framework designers, and why does Go keep it?

Critics say Go's testing has no fluent assertion DSL, no shared fixture model, no test discovery beyond name prefixes, and no annotation system — features that JUnit, pytest, and RSpec users take for granted. Go's design responds: every one of those features makes test code more magical and harder to reason about. The Go team prefers verbose, regular, mechanical tests over expressive ones because tests are read more often than written and they outlive frameworks. The package keeps its small surface deliberately; over fifteen years, the only meaningful additions have been `t.Run` (subtests), `t.Cleanup`, `t.TempDir`, `t.Setenv`, fuzzing, and `t.Deadline`. The economy of the API is the design.
