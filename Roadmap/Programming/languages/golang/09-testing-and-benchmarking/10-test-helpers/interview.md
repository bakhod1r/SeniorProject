---
layout: default
title: Test Helpers — Interview
parent: Test Helpers
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/10-test-helpers/interview/
---

# Test Helpers — Interview

[← Back](../)

## Q1. What does `t.Helper()` do?

It marks the calling function so that the test runner skips it when
printing the file and line number of a failure. The reported
location becomes the first frame on the goroutine stack that has
not been marked. `t.Helper()` affects only the function that calls
it; helpers that call other helpers must each invoke `t.Helper()`.

Behind the scenes, the testing package records a program counter
into a per-test map. When a failure happens, the runner walks the
goroutine stack with `runtime.Callers` and skips frames whose
program counters are in the map. The first unmarked frame is the
file:line pair printed beside the message.

## Q2. When should a helper use `t.Fatalf` versus `t.Errorf`?

Use `t.Fatalf` when the test cannot meaningfully continue: a setup
step failed, a required handle is nil, the database returned an
error. Use `t.Errorf` when other independent assertions can still
produce useful information: comparing several fields of the same
response, verifying a list of headers.

A useful heuristic: if the next line of the test would panic or
produce nonsense after the failure, use `Fatalf`. Otherwise use
`Errorf` so the test reports as many failures as possible per run.

## Q3. Why does the Go community discourage assertion libraries?

Three reasons. First, assertion libraries hide control flow behind
a fluent API; readers have to learn that API on top of the
language. Second, `t.Errorf` already produces an excellent failure
message because the test author writes the comparison explicitly.
Third, libraries tend to encourage assertion fatigue: a test that
calls `assert.Equal` thirty times says nothing about intent.
Hand-rolled helpers stay in the same package and serve the test's
domain.

The Go standard library itself uses plain `t.Errorf` calls and
small per-package helpers. If the language designers do not feel
they need an assertion library, the default for new projects is the
same.

## Q4. Difference between `testify/require` and `testify/assert`?

`require` calls `t.FailNow` after the first failure, stopping the
test. `assert` records the failure and lets the test continue. The
semantic distinction is identical to `t.Fatalf` versus `t.Errorf`.
If a project does adopt testify, the rule of thumb is `require` for
preconditions (handles, errors) and `assert` for field-level
comparisons.

The two packages cannot be substituted for each other casually: a
test that depends on `assert.NoError` continuing through subsequent
checks behaves differently if rewritten with `require.NoError`.

## Q5. How do you register cleanup from inside a helper?

Call `t.Cleanup(fn)`. The runtime executes the function after the
test (and all of its subtests) finishes, in last-in-first-out
order. The caller does not need to `defer` anything; the helper
takes care of its own resources.

Cleanup also runs when the test fails or is skipped, so resources
never leak regardless of how the test ends. The guarantee is the
same as `defer` inside the test function.

## Q6. Why is `t.Helper()` the first statement of a helper?

So that any `t.Fatalf` or `t.Errorf` later in the function
attributes the failure to the caller. If the call is reached after
the failure, the runner has already captured the helper frame as
the reporting site.

In practice the difference is hard to observe because `t.Helper`
must be called before the failure happens. The convention of
calling it first is a defence against accidentally putting code
that might fail before the call.

## Q7. What does `cmp.Diff` give you that `reflect.DeepEqual` does not?

A readable diff string, custom comparison via `cmpopts`, support
for unexported fields with `cmp.AllowUnexported`, transformer
functions, and sort-then-compare for slices through
`cmpopts.SortSlices`. `reflect.DeepEqual` returns a boolean only.

`cmp.Diff` returns the empty string when values are equal, which
makes the helper pattern `if d := cmp.Diff(...); d != "" { ... }`
the canonical use.

## Q8. What is `testing/quick.Check` and when is it useful?

`quick.Check` runs a property function with randomly generated
arguments, typically 100 iterations. It is the standard library's
lightweight property based testing tool. Useful for checking
algebraic laws: serialise then deserialise yields the original,
sort is idempotent, reverse-reverse is the identity.

The tool's limitations are real: generators are uniform over the
type's domain, failing inputs are not shrunk, and complex types
need a `Generator` implementation. For richer property testing,
libraries like `gopter` or `rapid` offer shrinking and combinators.

## Q9. Where should helpers live?

Within the same package as the tests that use them, in a file
named `helpers_test.go`. When several packages share helpers, move
them to an `internal/testutil` package that is only importable from
the project itself. Avoid public test helper packages because they
pollute the public API.

The promotion path is one-way: a helper rarely demotes from
`internal/testutil` back to a single package. Be sure the helper is
genuinely shared before promoting.

## Q10. How do you test the helpers themselves?

Use a fake `testing.TB`. The interface is large but each helper
exercises only a small subset. A typical fake records calls to
`Errorf`, `Fatalf`, `Helper`, and `Cleanup`, then tests inspect the
recorded calls.

```go
type fakeTB struct {
    testing.TB
    errors []string
}

func (f *fakeTB) Helper() {}
func (f *fakeTB) Errorf(format string, args ...any) {
    f.errors = append(f.errors, fmt.Sprintf(format, args...))
}
```

The test calls the helper with inputs that should fail and checks
that the fake recorded an error.

## Q11. What is the right return shape for a helper that creates a resource?

The helper returns the resource and registers cleanup with
`t.Cleanup`. It does not return a cleanup function.

```go
// Wrong:
func openTestDB(t *testing.T) (*sql.DB, func()) { ... }

// Right:
func openTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db := openOrFail(t)
    t.Cleanup(func() { db.Close() })
    return db
}
```

The right shape means tests cannot forget to call cleanup, and it
removes one line of boilerplate per use.

## Q12. Can a helper call `t.Parallel`?

No. Parallelism is a property of the test, not the helper. A
helper that calls `t.Parallel` takes a decision away from the test
author; subsequent helpers do not know whether they are running
sequentially or concurrently. The convention is that the test
itself calls `t.Parallel` at the start; helpers are silent on the
matter.

## Q13. How does `t.Helper` interact with closures?

A closure created inside a helper has its own program counter. The
closure must call `t.Helper` itself, or failures inside it report
the closure's location, not the helper's caller.

```go
func eventually(tb testing.TB, d time.Duration, cond func() bool) {
    tb.Helper()
    // ... loop ...
    tb.Fatalf("...") // attributes to eventually's caller
}
```

In this example the closure passed as `cond` does not need to call
`t.Helper` because it does not call `tb.Fatalf`. A helper that
spawns a closure that calls `tb.Errorf` directly would need the
closure to call `t.Helper`.

## Q14. What happens to `t.Cleanup` if the test panics?

The cleanup runs. The testing package recovers from the panic,
runs the cleanups, then reports the panic as a test failure. The
guarantee is the same as `defer`: cleanups execute even when the
test exits unusually.

A cleanup that itself panics produces a stacked panic that the
runner reports. The test still fails, but the diagnostic is
noisier. Cleanups should be defensive: catch panics that might
escape into the runner.

## Q15. What is a `must` helper?

A helper that produces a value or stops the test. The naming follows
`regexp.MustCompile` and `template.Must`. Use `must` for parsers
and constructors whose failure means the fixture is broken, not
that the system under test misbehaves.

```go
func mustParseTime(t *testing.T, s string) time.Time {
    t.Helper()
    ts, err := time.Parse(time.RFC3339, s)
    if err != nil {
        t.Fatalf("parse %q: %v", s, err)
    }
    return ts
}
```

Avoid `must` for code paths that are part of the test's subject.
If the test exercises a parser, the parser's errors are the thing
under test and should be checked directly.

## Q16. How do you handle helpers that need a `context.Context`?

Either accept a context as a parameter or build one in the helper
with cleanup:

```go
func newTestContext(tb testing.TB) (context.Context, context.CancelFunc) {
    tb.Helper()
    ctx, cancel := context.WithCancel(context.Background())
    tb.Cleanup(cancel)
    return ctx, cancel
}
```

Returning both the context and the cancel function lets the test
cancel early when needed; the registered cleanup ensures cancellation
even when the test forgets.

## Q17. What is the difference between `t.Cleanup` and `defer`?

`t.Cleanup` registers a function with the test framework; the
framework runs it after the test and all its subtests complete.
`defer` queues a function call within the current function; it
runs when the function returns.

For a helper that allocates a resource the test uses, `t.Cleanup`
is correct because the resource should outlive the helper and be
cleaned up when the test ends. `defer` inside a helper would run
when the helper returns, before the test uses the resource.

## Q18. When would you use `t.TempDir` directly versus wrapping it?

For a single test, call `t.TempDir()` directly. It is short, clear,
and includes cleanup. For a project-wide helper, wrap it when you
want a consistent prefix, naming scheme, or behaviour layer (for
example, also creating a subdirectory structure). The wrapper is
an investment that pays off when the convention changes.

## Q19. Should helpers accept variadic options?

Sometimes. Variadic options are good for genuinely optional
parameters that most callers omit. They are bad when they hide
required behaviour or when most callers pass them.

The rule of thumb: if more than half of callers pass a particular
option, make it a named parameter on a new helper variant. If
fewer than half pass it, keep it as a variadic option.

## Q20. What is the relationship between helpers and integration tests?

Integration tests typically need more elaborate setup than unit
tests: real databases, containerised services, network namespaces.
Helpers at the integration boundary do double duty: they hide the
mechanics and document the test's dependencies.

A `requireDocker` helper skips the test on machines without Docker.
A `startPostgres` helper launches a container and registers cleanup.
The patterns are the same as for unit tests; the underlying
operations are heavier. The discipline (call `t.Helper`, register
cleanup, accept `testing.TB`) remains the rule.

## Q21. How do you debug a flaky helper?

Steps:

1. Run with `-race` to catch data races.
2. Add `t.Logf` calls to log inputs and intermediate state.
3. Run the suite with `-count=100` to reproduce the flake.
4. Look for shared state (globals, files, ports) that other tests
   might touch.

Most flakes in helpers come from shared state or from polling
helpers with tight timeouts. The fix is usually to isolate the
state or extend the timeout.

## Q22. What is wrong with returning a value AND failing the test?

A helper that calls `t.Errorf` and then returns a value puts the
caller in an ambiguous state. The test failed, but execution
continues, and the returned value may be the zero value of its
type. Subsequent code that uses the returned value sees something
that looks valid but is not.

If the helper detects a failure that makes its return value
meaningless, it should call `t.Fatalf` instead. If the helper
detects a failure that does not prevent it from returning a useful
value (an extra invariant violation that is independent of the
result), `t.Errorf` is fine. The two cases are distinct; mixing
them is a design smell.
