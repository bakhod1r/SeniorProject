---
layout: default
title: Test Helpers — Find Bug
parent: Test Helpers
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/10-test-helpers/find-bug/
---

# Test Helpers — Find Bug

[← Back](../)

The following helper package is used across a service test suite.
Reviewers complain that when a test fails, the line number in the
failure message always points inside `AssertOK`, not the test that
called it. Worse, when several assertions fail in the same test,
only the first is ever printed. A third reviewer notes that
resources leak between tests when they fail.

Find every bug in the package below before reading the solutions.

```go
package testutil

import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func AssertOK(t *testing.T, err error) {
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

func AssertEqual[T comparable](t *testing.T, got, want T) {
    if got != want {
        t.Fatalf("got %v, want %v", got, want)
    }
}

func AssertContains(t *testing.T, haystack, needle string) {
    if !contains(haystack, needle) {
        t.Fatalf("%q does not contain %q", haystack, needle)
    }
}

func NewTestServer(t *testing.T, h http.Handler) (*httptest.Server, func()) {
    srv := httptest.NewServer(h)
    return srv, func() { srv.Close() }
}

func RunInParallel(t *testing.T, fn func()) {
    t.Parallel()
    fn()
}
```

## Bugs

There are six bugs. Find each before reading on.

### Bug 1: missing `t.Helper()`

None of the helpers call `t.Helper()`. The stack frame reported by
`t.Fatalf` is the helper itself, not the test. Add `t.Helper()` as
the first statement of every helper that calls `Errorf` or
`Fatalf`. Without this, every failure message points inside the
helper file, defeating the purpose of having helpers.

### Bug 2: wrong failure mode for `AssertContains`

`AssertContains` uses `t.Fatalf`. A test that checks several
substrings of a response body will stop after the first miss.
`AssertContains` should use `t.Errorf` so subsequent checks still
run; reserve `t.Fatalf` for conditions that make further checks
meaningless (a nil pointer, a missing handle).

The same critique applies to `AssertEqual`: most field-level
equality checks are independent and should use `Errorf`. Keep one
`Fatalf` variant under a `Require` name for cases where stopping is
required.

### Bug 3: `NewTestServer` returns a cleanup function

`NewTestServer` returns `(*httptest.Server, func())`, which forces
the caller to remember a `defer cleanup()`. If the caller forgets,
the server leaks. The fix is to register cleanup with `t.Cleanup`
inside the helper:

```go
func NewTestServer(tb testing.TB, h http.Handler) *httptest.Server {
    tb.Helper()
    srv := httptest.NewServer(h)
    tb.Cleanup(srv.Close)
    return srv
}
```

The caller does not deal with cleanup at all.

### Bug 4: `RunInParallel` is wrong by design

Helpers must not call `t.Parallel`. Parallelism is a property of
the test, not the helper. `RunInParallel` takes a decision away
from the test author and complicates reasoning about which tests
share state. Delete the helper.

### Bug 5: parameter type is `*testing.T`, not `testing.TB`

All helpers accept `*testing.T`. The same helpers should accept
`testing.TB` so they work in benchmarks. The change is
non-breaking: tests still pass `*testing.T`, which satisfies
`testing.TB`. The new signature:

```go
func AssertEqual[T comparable](tb testing.TB, got, want T) {
    tb.Helper()
    if got != want {
        tb.Errorf("got %v, want %v", got, want)
    }
}
```

Now `BenchmarkX` can call `AssertEqual` without changes.

### Bug 6: no godoc comments

The exported helpers have no documentation. A consumer reading
`AssertOK` cannot tell whether it stops the test or continues, what
arguments it accepts, or what failure message it produces. Every
exported helper should have a godoc comment that names its failure
mode:

```go
// AssertOK reports a fatal error if err is non-nil. The test stops
// immediately. AssertOK calls tb.Helper() so failure messages
// point at the caller.
func AssertOK(tb testing.TB, err error) {
    tb.Helper()
    if err != nil {
        tb.Fatalf("unexpected error: %v", err)
    }
}
```

The comment makes the helper's behaviour obvious without reading
the body.

## Corrected helper package

Putting all the fixes together:

```go
package testutil

import (
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
)

// AssertOK reports a fatal error if err is non-nil and stops the
// test. Calls tb.Helper().
func AssertOK(tb testing.TB, err error) {
    tb.Helper()
    if err != nil {
        tb.Fatalf("unexpected error: %v", err)
    }
}

// AssertEqual reports an error if got != want and continues.
// Calls tb.Helper().
func AssertEqual[T comparable](tb testing.TB, got, want T) {
    tb.Helper()
    if got != want {
        tb.Errorf("got %v, want %v", got, want)
    }
}

// RequireEqual reports a fatal error if got != want and stops the
// test. Use for preconditions; for field-level checks prefer
// AssertEqual.
func RequireEqual[T comparable](tb testing.TB, got, want T) {
    tb.Helper()
    if got != want {
        tb.Fatalf("got %v, want %v", got, want)
    }
}

// AssertContains reports an error if haystack does not contain
// needle and continues. Calls tb.Helper().
func AssertContains(tb testing.TB, haystack, needle string) {
    tb.Helper()
    if !strings.Contains(haystack, needle) {
        tb.Errorf("%q does not contain %q", haystack, needle)
    }
}

// NewTestServer wraps httptest.NewServer and registers cleanup
// via tb.Cleanup. The caller does not need to close the server.
// Calls tb.Helper().
func NewTestServer(tb testing.TB, h http.Handler) *httptest.Server {
    tb.Helper()
    srv := httptest.NewServer(h)
    tb.Cleanup(srv.Close)
    return srv
}
```

Now failure messages point at the test, several failures can be
reported per run, resources clean up automatically, and the helpers
work for benchmarks as well as tests.

## A lesson

The bugs in the original package are individually small. Together
they make the helper package actively harmful: tests using it
produce confusing failure messages, leak resources, and force
authors to write more boilerplate than they would have without
helpers at all.

Helpers are an investment. The first time you write a helper file,
spend a few extra minutes getting these details right. The payoff
compounds over the lifetime of the test suite.

## Bonus: another helper to review

Here is one more helper. Find the bugs before reading on.

```go
func WaitForCondition(t *testing.T, cond func() bool) {
    t.Helper()
    for i := 0; i < 100; i++ {
        if cond() {
            return
        }
        time.Sleep(100 * time.Millisecond)
    }
}
```

Three bugs.

First, the helper does not fail when the condition never becomes
true. After 100 iterations it silently returns, and the test
continues as if the condition was met. Add a `tb.Fatalf` at the
end.

Second, the timeout is fixed at 10 seconds (100 × 100ms) and
hidden in magic numbers. Accept a `time.Duration` as a parameter.

Third, the helper accepts `*testing.T` instead of `testing.TB`,
preventing use in benchmarks. Use `testing.TB`.

Fixed:

```go
// WaitForCondition polls cond every 100ms until it returns true or
// the timeout elapses. Stops the test on timeout. Calls tb.Helper().
func WaitForCondition(tb testing.TB, timeout time.Duration, cond func() bool) {
    tb.Helper()
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(100 * time.Millisecond)
    }
    tb.Fatalf("condition not met within %s", timeout)
}
```

A few minutes of review prevents a class of silent test failures.

## Bonus 2: a helper that breaks parallelism

```go
var globalCounter int

func NextID(t *testing.T) int {
    t.Helper()
    globalCounter++
    return globalCounter
}
```

Two bugs.

First, `globalCounter` is shared across all tests. Parallel tests
race on the increment, producing duplicate IDs and a data race
under `-race`.

Second, the counter persists across the suite. A test that asserts
"the first ID is 1" passes when run in isolation and fails when
run as part of the suite.

Fix:

```go
func NextID(t *testing.T) int {
    t.Helper()
    return rand.Int63()
}
```

Or, better, return a UUID. Either way, the helper must not share
state across tests.

## Review checklist

When you review a helper file, scan for:

- Missing `t.Helper()` calls.
- Wrong choice of `Errorf` versus `Fatalf`.
- Cleanup returned to caller instead of registered via `t.Cleanup`.
- Helpers that mutate package globals.
- Helpers that call `t.Parallel`.
- Helpers that accept `*testing.T` instead of `testing.TB`.
- Helpers without godoc comments.

Each item takes seconds to check. Together they prevent the most
common test infrastructure bugs.
