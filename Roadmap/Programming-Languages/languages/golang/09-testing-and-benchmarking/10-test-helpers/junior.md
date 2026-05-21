---
layout: default
title: Test Helpers — Junior
parent: Test Helpers
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/10-test-helpers/junior/
---

# Test Helpers — Junior

[← Back](../)

A test helper is a function that you call from a test to remove
repetition. The simplest helpers check a condition and call `t.Fatalf`
or `t.Errorf` when it fails. Without helpers, the same three lines that
decode a JSON response and compare it to an expected value appear in
every test, and the file grows beyond the point where anyone can read
it. With helpers, the test reads as a sentence that names what you are
checking, and the machinery of comparing values and reporting failures
moves out of sight.

This page introduces helpers from the ground up. The audience is a
developer who has written tests with `testing.T` already, who knows how
to call `t.Errorf` and `t.Fatalf`, but who has never built a helper of
their own. By the end of the page you will know what `t.Helper` does,
when to choose `Errorf` over `Fatalf`, why the Go community avoids
assertion libraries, how to write a `mustParse` helper, how to register
cleanup with `t.Cleanup`, and how to keep helpers small so they stay
readable.

The material covers nothing exotic. Every concept here is something you
will use the first day you write tests for a real project. The depth
comes from understanding why each pattern exists and what failure mode
it prevents.

## Why helpers exist

Take a test that does not use a helper. It checks that an HTTP handler
returns a 200 status and a particular body.

```go
func TestHelloHandler(t *testing.T) {
    req := httptest.NewRequest("GET", "/", nil)
    rr := httptest.NewRecorder()

    Hello(rr, req)

    if rr.Code != http.StatusOK {
        t.Fatalf("status: got %d, want 200", rr.Code)
    }
    if rr.Body.String() != "hello\n" {
        t.Fatalf("body: got %q, want %q", rr.Body.String(), "hello\n")
    }
}
```

Two assertions, six lines of plumbing. Now imagine the service has fifty
endpoints and each gets a test like this. Every test repeats the same
`rr.Code != http.StatusOK` check and the same body comparison. A reader
scanning the file looks at fifty almost-identical blocks to find the
one that differs. The signal is buried in the noise.

A helper turns the noise into a single call:

```go
func assertOK(t *testing.T, rr *httptest.ResponseRecorder, body string) {
    t.Helper()
    if rr.Code != http.StatusOK {
        t.Fatalf("status: got %d, want 200", rr.Code)
    }
    if rr.Body.String() != body {
        t.Fatalf("body: got %q, want %q", rr.Body.String(), body)
    }
}
```

The test now reads:

```go
func TestHelloHandler(t *testing.T) {
    req := httptest.NewRequest("GET", "/", nil)
    rr := httptest.NewRecorder()
    Hello(rr, req)
    assertOK(t, rr, "hello\n")
}
```

Two visible things happened. The test became shorter. The intent ("call
the handler and assert the standard success response") moved to the
front of the function instead of being hidden inside two `if`
statements.

A helper is not a clever abstraction. It is the same code, named, with
the common parameters extracted. The simpler the helper, the more
useful it is. Helpers should never invent new vocabulary; they should
give shorter names to vocabulary the test already uses.

The principle generalises beyond tests. The same instinct that drives
you to extract a function in production code drives you to extract a
helper in test code. The difference is that in tests, the extracted
function almost always takes `*testing.T` as its first parameter and
calls `t.Helper` as its first statement. That single difference
generates a whole vocabulary of patterns that this page walks through.

## What does `t.Helper()` do

When a helper calls `t.Fatalf`, the test runner prints a stack location
next to the message. Without `t.Helper()`, that location points to the
line inside the helper where `t.Fatalf` was called. After `t.Helper()`,
the runner walks past the helper and reports the line in the test that
called the helper. The message itself is the same; only the file and
line number change.

The official documentation for `testing.T.Helper` says: "Helper marks
the calling function as a test helper function. When printing file and
line information, that function will be skipped." Three details flow
from this short sentence.

First, the marking is per-function. Each helper that should be hidden
from the trace must call `t.Helper()` itself. If a helper calls another
helper, both must do so independently. Forgetting `t.Helper` in an
inner helper makes the inner helper the reporting site, not the test.

Second, the call is cheap. The testing package records a program
counter in a per-test map; later, when a failure happens, the runner
walks the goroutine stack and skips frames that are in the map. There
is no reason to skip the call to save time.

Third, the marking does not change runtime behaviour. The test still
fails. The test still stops if you called `Fatalf`. Only the reported
location changes.

Try removing `t.Helper()` from `assertOK` and run the failing test. The
output will read something like:

```
--- FAIL: TestHelloHandler (0.00s)
    helpers_test.go:14: status: got 404, want 200
```

That `helpers_test.go:14` points inside the helper. Put `t.Helper()`
back and the same failure points to `hello_test.go:7`, which is the
line in the test that called `assertOK`. That is the line a reader
actually wants to see.

When you debug a failing test, the file:line annotation is the first
thing you read. A useful annotation points to the test. A useless one
points to a helper that you have read a hundred times and that has not
changed since last quarter. `t.Helper` is the single line that turns
the second case into the first.

### A more elaborate trace example

Consider a helper that calls another helper:

```go
func assertResponseCode(t *testing.T, rr *httptest.ResponseRecorder, code int) {
    t.Helper()
    assertEqual(t, rr.Code, code)
}

func assertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

A test that calls `assertResponseCode(t, rr, 200)` and fails because the
recorded code is 404 produces a failure message like:

```
my_test.go:42: got 404, want 200
```

Both helpers called `t.Helper`, so the runner walked past both frames
and landed on the test itself. Now remove `t.Helper` from
`assertResponseCode`. The same failure reads:

```
helpers.go:11: got 404, want 200
```

That points inside `assertResponseCode`. The reader has to open the
helper, find the call to `assertEqual`, and then trace back to the test.
The fix is one line: add `t.Helper` to `assertResponseCode`. Helpers
that call other helpers are common; missing `t.Helper` calls anywhere
in the chain breaks the trace.

## A rule of thumb

The first non-trivial statement of any helper that calls `t.Errorf` or
`t.Fatalf` should be `t.Helper()`. Some authors like to put it on the
very first line, before any local variables. Either way is fine. What
matters is that the call exists; without it, the failure trace blames
the helper.

A second rule of thumb: if a helper does not call `Errorf` or `Fatalf`
(say it just constructs a fixture and returns it without checking
anything), it does not need `t.Helper`. The call is harmless but adds
nothing. Save it for functions that actually report failures.

A third rule of thumb: helpers that produce log output through `t.Log`
or `t.Logf` should also call `t.Helper`, because the log line includes
the file:line and you want the same readable location for log lines as
for failures.

## `t.Errorf` versus `t.Fatalf`

Both report a failure. `t.Errorf` lets the test continue; `t.Fatalf`
stops it. Choose based on whether continuing makes sense.

```go
func TestUserProfile(t *testing.T) {
    u, err := loadUser(1)
    if err != nil {
        t.Fatalf("loadUser: %v", err) // cannot continue without a user
    }
    if u.Name != "Ada" {
        t.Errorf("name: got %q, want Ada", u.Name) // continue
    }
    if u.Age != 36 {
        t.Errorf("age: got %d, want 36", u.Age) // continue
    }
}
```

If `loadUser` failed, dereferencing `u` would panic, so the test stops.
The two field comparisons are independent: a wrong name does not change
whether the age is right, so both checks should run and report.

The same rule applies to helpers. A helper that returns a value the
test will dereference (`loadUser`, `openDB`, `parseJSON`) should call
`Fatalf` on error. A helper that compares fields (`assertNameEquals`,
`assertAgeEquals`) should call `Errorf`. Picking the wrong one is the
single most common mistake in test helper design: too many `Fatalf`
calls hide later failures, too many `Errorf` calls let the test
continue past a nil pointer and panic later.

A useful heuristic: ask whether running the next line after the
failure would produce meaningful information. If yes, use `Errorf`. If
no, use `Fatalf`. A nil result that the next line dereferences is a
clear `Fatalf` case. A field value that no later line depends on is a
clear `Errorf` case.

### Beyond Errorf and Fatalf

The `testing.T` type exposes several reporting methods. The complete
table:

- `t.Log(args...)`: print without failing. Output appears only with
  `-v` or when the test fails.
- `t.Logf(format, args...)`: same as `Log` with formatting.
- `t.Error(args...)`: log and mark the test as failed; continue.
- `t.Errorf(format, args...)`: same as `Error` with formatting.
- `t.Fatal(args...)`: log, mark failed, and stop the test.
- `t.Fatalf(format, args...)`: same as `Fatal` with formatting.
- `t.Skip(args...)`: log and skip the rest of the test.
- `t.Skipf(format, args...)`: same as `Skip` with formatting.
- `t.SkipNow()`: skip without a message.
- `t.FailNow()`: mark failed and stop without logging.

For helpers, you will use `Errorf` and `Fatalf` 90 percent of the time
and `Logf` occasionally. The rest exist for specific situations
(skipping a test on an unsupported platform, marking failure without
producing a message).

## Why not just use an assertion library

Other languages encourage libraries with hundreds of matchers:
`assertThat(x).hasSize(3).contains("a").isNotNull()`. Go discourages
this style for two reasons.

First, the language already gives you `if x != y { t.Errorf(...) }`.
There is no syntactic gain in `assert.Equal(t, x, y)` because the
explicit form is the same number of characters and the failure message
is identical. The library version adds a layer of reflection and a
dependency for no benefit.

Second, projects that adopt assertion libraries tend to develop
assertion fatigue: tests become long lists of `assert.X` calls that
say little about what the test is checking. Hand-rolled helpers are
written for the project's domain. `assertValidPayment(t, p)` is more
informative than twelve `assert.Equal` calls comparing fields, because
the helper name names the property being checked.

That said, you will see two libraries in real Go code:
`testify/assert` and `testify/require`. The first records failures and
continues, like `t.Errorf`. The second stops the test immediately,
like `t.Fatalf`. They are essentially `Errorf` and `Fatalf` with a
fluent API. If you find yourself reaching for them, write the helper
instead. Adding a dependency on a 3-megabyte library to save typing
`if got != want` is a bad trade.

The middle and senior tiers cover testify in more detail and explain
when a project might reasonably adopt it. For now, treat the standard
library plus a few hand-rolled helpers as the default.

The Go core team has expressed the same preference. The standard
library's own tests use plain `t.Errorf` calls and small per-package
helpers. If the language designers do not feel they need an assertion
library, the strong default for new projects should be the same.

### A concrete comparison

The same test, two styles. Hand-rolled:

```go
func TestUserAdmin(t *testing.T) {
    u := newAdminUser(t)
    if !u.IsAdmin {
        t.Error("expected IsAdmin to be true")
    }
    if u.Role != "admin" {
        t.Errorf("role: got %q, want admin", u.Role)
    }
    if got := u.Permissions; !contains(got, "write") {
        t.Errorf("permissions: %v missing 'write'", got)
    }
}
```

Testify style:

```go
func TestUserAdmin(t *testing.T) {
    u := newAdminUser(t)
    assert.True(t, u.IsAdmin, "IsAdmin should be true")
    assert.Equal(t, "admin", u.Role)
    assert.Contains(t, u.Permissions, "write")
}
```

The testify version is shorter. The hand-rolled version is direct and
has no external dependency. Both are reasonable. The choice depends on
the project's other constraints; for a new project, the hand-rolled
form is the default.

## A simple `assertEqual`

Generics make a one-size-fits-all equality helper easy:

```go
func assertEqual[T comparable](t *testing.T, got, want T) {
    t.Helper()
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}
```

`comparable` is a built-in constraint that admits any type usable with
`==`. The helper handles strings, integers, pointers, structs without
slice or map fields, and any other comparable type. For slices and
maps you need `reflect.DeepEqual` or, better, `cmp.Diff` from
`github.com/google/go-cmp`, which is covered in the middle tier.

A test that uses the helper:

```go
func TestAdd(t *testing.T) {
    assertEqual(t, Add(1, 2), 3)
    assertEqual(t, Add(0, 0), 0)
    assertEqual(t, Add(-1, 1), 0)
}
```

Three lines, three assertions. The intent of each line is clear. A
reader does not have to read the helper body to understand what each
call does.

A second, more useful variant takes a label so several `assertEqual`
calls in the same test produce distinguishable failure messages:

```go
func assertEqualf[T comparable](t *testing.T, got, want T, label string) {
    t.Helper()
    if got != want {
        t.Errorf("%s: got %v, want %v", label, got, want)
    }
}

func TestUser(t *testing.T) {
    u := loadUser(1)
    assertEqualf(t, u.Name, "Ada", "name")
    assertEqualf(t, u.Age, 36, "age")
    assertEqualf(t, u.City, "London", "city")
}
```

When a failure prints `age: got 0, want 36`, the reader knows
immediately which field is wrong without counting lines.

### Companions to assertEqual

A small family of related helpers is often useful:

```go
func assertNoError(t *testing.T, err error) {
    t.Helper()
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

func assertError(t *testing.T, err error) {
    t.Helper()
    if err == nil {
        t.Fatal("expected an error, got nil")
    }
}

func assertErrorIs(t *testing.T, got, want error) {
    t.Helper()
    if !errors.Is(got, want) {
        t.Errorf("error chain: got %v, want %v", got, want)
    }
}

func assertNotNil[T any](t *testing.T, got *T) {
    t.Helper()
    if got == nil {
        t.Fatal("expected non-nil pointer")
    }
}

func assertLen[T any](t *testing.T, got []T, want int) {
    t.Helper()
    if len(got) != want {
        t.Errorf("len: got %d, want %d (slice: %v)", len(got), want, got)
    }
}
```

Five helpers cover the bulk of single-field checks in any test file.
None is longer than five lines. The bodies are obvious; the names tell
the reader exactly what the call does.

## A `mustParse` helper

When a test needs a value parsed from a string, repeating the
`err != nil { t.Fatalf }` pattern hurts readability. A helper that
returns the parsed value or fails the test is cleaner:

```go
func mustParseTime(t *testing.T, value string) time.Time {
    t.Helper()
    ts, err := time.Parse(time.RFC3339, value)
    if err != nil {
        t.Fatalf("parse %q: %v", value, err)
    }
    return ts
}
```

The test becomes:

```go
func TestEventBefore(t *testing.T) {
    e := Event{At: mustParseTime(t, "2026-01-15T12:00:00Z")}
    if !e.Before(mustParseTime(t, "2026-02-01T00:00:00Z")) {
        t.Error("expected event to be before threshold")
    }
}
```

Naming the prefix `must` is a Go convention borrowed from
`regexp.MustCompile` and `template.Must`. It signals that the function
panics or fails the test on error and returns the value otherwise. Use
it only for cases where failure indicates a bug in the test itself or
in the fixture data, not where failure is part of what you are
testing.

Other useful `must` helpers in a typical test file:

```go
func mustReadFile(t *testing.T, path string) []byte {
    t.Helper()
    data, err := os.ReadFile(path)
    if err != nil {
        t.Fatalf("read %s: %v", path, err)
    }
    return data
}

func mustJSON(t *testing.T, v any) []byte {
    t.Helper()
    data, err := json.Marshal(v)
    if err != nil {
        t.Fatalf("marshal: %v", err)
    }
    return data
}

func mustHTTPRequest(t *testing.T, method, url string, body io.Reader) *http.Request {
    t.Helper()
    req, err := http.NewRequest(method, url, body)
    if err != nil {
        t.Fatalf("new request: %v", err)
    }
    return req
}

func mustUUID(t *testing.T, s string) uuid.UUID {
    t.Helper()
    u, err := uuid.Parse(s)
    if err != nil {
        t.Fatalf("parse uuid %q: %v", s, err)
    }
    return u
}

func mustURL(t *testing.T, raw string) *url.URL {
    t.Helper()
    u, err := url.Parse(raw)
    if err != nil {
        t.Fatalf("parse url %q: %v", raw, err)
    }
    return u
}
```

Each helper accepts the inputs the test cares about and hides the
error path. The test reads as a sequence of operations on values, not
as a sequence of error checks.

### When not to use `must`

A test that exists to check the parser itself should not call
`mustParseTime` on the input it is parsing. The whole point of the
test is to exercise the parser's error path, so the test must handle
the error directly. Use `must` only when a failure means the fixture
or the test is broken, not when the failure is the thing under test.

## Registering cleanup

Many helpers allocate resources: a temporary directory, a database
connection, an HTTP server. Returning the value alone is not enough;
the test must release the resource at the end. The naive solution is
to return a cleanup function and ask the caller to defer it:

```go
func openTestDB(t *testing.T) (*sql.DB, func()) {
    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("open: %v", err)
    }
    return db, func() { db.Close() }
}

func TestUserInsert(t *testing.T) {
    db, cleanup := openTestDB(t)
    defer cleanup()
    // ...
}
```

This works, but it leaks the cleanup detail into every test. Forget
the `defer` and the resource leaks. Worse, every test has two extra
lines of boilerplate: the cleanup capture and the defer.

Modern Go provides a better tool: `t.Cleanup`. The helper registers
cleanup with the test directly, and the caller never sees it.

```go
func openTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("open: %v", err)
    }
    t.Cleanup(func() { db.Close() })
    return db
}
```

The test becomes:

```go
func TestUserInsert(t *testing.T) {
    db := openTestDB(t)
    // ... use db; close is automatic
}
```

`t.Cleanup` runs registered functions after the test (and its
subtests) finish, in last-in-first-out order. It is the right tool for
any helper that owns a resource. The cleanup runs regardless of
whether the test passed or failed, so resources never leak.

Two more examples that follow the same pattern:

```go
func tempDir(t *testing.T) string {
    t.Helper()
    return t.TempDir() // built-in: returns a unique dir, cleaned up automatically
}

func newTestServer(t *testing.T, h http.Handler) *httptest.Server {
    t.Helper()
    srv := httptest.NewServer(h)
    t.Cleanup(srv.Close)
    return srv
}
```

`t.TempDir` already includes cleanup, so the helper is a thin wrapper
that exists only to make tests easier to scan. `newTestServer` wraps
`httptest.NewServer` and removes the universal `defer srv.Close()`
line from every test that uses an HTTP server.

Cleanup runs even when the test is skipped or fails, and even when the
goroutine running the test calls `runtime.Goexit` via `t.Fatalf`. The
guarantee is the same as `defer` inside the test function: the cleanup
will execute, period. You can rely on it for releasing files, closing
connections, removing temporary directories, and any other
deterministic release.

### Multiple cleanups

A helper that opens several resources can register multiple cleanups:

```go
func newTestFixture(t *testing.T) (*Server, *Client) {
    t.Helper()
    db := openTestDB(t)
    srv := startServer(t, db)
    t.Cleanup(srv.Close)
    client := newClient(srv.URL)
    t.Cleanup(client.Close)
    return srv, client
}
```

Cleanups run in reverse order (LIFO), so `client.Close` runs first,
then `srv.Close`, then the `db.Close` registered inside `openTestDB`.
The order matters when resources depend on each other: a client that
talks to a closed server might block on a network call. LIFO order
mirrors the natural construction order and prevents most ordering
bugs.

### A helper for table tests

Table tests are the workhorse of Go testing. A helper that runs a
table of cases removes the repetitive
`t.Run(name, func(t *testing.T) { ... })` wrapping for the simple
case where each case is a pure function call:

```go
type addCase struct {
    name    string
    a, b    int
    want    int
}

func runAddCases(t *testing.T, cases []addCase) {
    t.Helper()
    for _, c := range cases {
        c := c
        t.Run(c.name, func(t *testing.T) {
            t.Helper()
            got := Add(c.a, c.b)
            if got != c.want {
                t.Errorf("Add(%d, %d): got %d, want %d", c.a, c.b, got, c.want)
            }
        })
    }
}
```

The test:

```go
func TestAdd(t *testing.T) {
    runAddCases(t, []addCase{
        {"both zero", 0, 0, 0},
        {"positive", 1, 2, 3},
        {"negative cancel", -1, 1, 0},
    })
}
```

Each case is one line. Adding a new case is one line. The names show
up in `go test -v` output. This is the level at which helpers earn
their place: the test reads as data, and the looping code lives once.

The `c := c` line inside the loop is a Go quirk worth knowing about.
In Go versions before 1.22, the loop variable was reused across
iterations, so a goroutine or closure capturing it saw the last value.
Modern Go (1.22 and later) makes a fresh variable each iteration by
default. The explicit `c := c` was the conventional defensive shadow
that made the test correct regardless of Go version; you will still
see it in older code.

## Helper names and locations

Helpers used by one file go at the bottom of that file or in a file
with `_test.go` suffix. The Go toolchain compiles test files only when
running tests, so helpers do not bloat the production binary.

Names follow the project's convention. Inside a single test file,
lowercase unexported names are fine: `assertOK`, `mustParseTime`. When
a helper moves to a package shared across the project, it follows the
package's exported style: `testutil.AssertEqual`. The middle tier
covers shared packages.

A helper named `assert` is too generic. A helper named `assertOK`
says what the helper does. A helper named `expectGreaterEqualLength`
is too specific; the test should call `if got >= want { ... }` inline.
The useful range is the one that names a recurring pattern in the
test without being so narrow that it serves a single test.

Three naming conventions cover most cases:

- `assertX(t, got, want)`: continues on failure, used for field-level
  comparisons.
- `requireX(t, ...)` or `mustX(t, ...)`: stops on failure, used for
  preconditions.
- `newX(t, ...)`: constructs a fixture, registers cleanup via
  `t.Cleanup`, returns the fixture.

Pick the convention that matches the helper's behaviour and use it
consistently inside the package.

### Naming the file

For helpers that serve a single test file, putting them in the same
file (below the tests) is fine for short files but quickly gets
unwieldy. The Go convention is a file named after the helpers:
`helpers_test.go` if there are many, or `support_test.go` if you want
the file to suggest test support.

A typical layout for a package's test files:

```
billing/
  invoice.go
  invoice_test.go
  payment.go
  payment_test.go
  helpers_test.go    // shared between invoice_test.go and payment_test.go
  testdata/
    invoice_valid.json
    payment_raw.json
```

The `_test.go` suffix tells the toolchain that the file is only
compiled when running tests. The `testdata/` directory is special:
its contents are not scanned for Go files but are accessible to tests
via relative paths.

## Common mistakes

Five mistakes appear in junior-written helpers more often than any
other.

First, forgetting `t.Helper()`. Failure messages point inside the
helper and readers waste minutes hunting for the test that triggered
the failure.

Second, using `t.Fatalf` for every assertion. The first failure stops
the test and the remaining assertions never run, even though they
would have produced useful diagnostics.

Third, returning a cleanup function instead of using `t.Cleanup`.
Tests develop a `cleanup := ...; defer cleanup()` shape that the
helper exists to remove.

Fourth, swallowing the error in the helper. A helper that returns
`(value, error)` for the caller to check duplicates work; either fail
the test inside the helper or do not handle the error at all.

Fifth, growing the helper into a framework. A helper that accepts a
configuration struct with twenty fields is no longer a helper. It is
a mini-framework that has become harder to understand than the tests
it serves. Keep helpers small, named, and obvious.

### Detecting these mistakes during review

When you review a teammate's tests, scan the helper definitions for
these signs:

- Does every helper that calls `Errorf`/`Fatalf` start with
  `t.Helper()`? If not, request the change.
- Does the helper use `Fatalf` for a comparison that the test could
  meaningfully continue past? If so, suggest `Errorf`.
- Does the helper return `(value, func())`? Suggest `t.Cleanup`.
- Does the helper take a config struct with optional fields? Suggest
  splitting into separate helpers, one per behaviour.

A few minutes of review for these patterns prevents weeks of confused
debugging later.

## A short cheat sheet

For your first week writing helpers, keep these rules nearby.

- Every helper that calls `t.Errorf` or `t.Fatalf` starts with
  `t.Helper()`.
- `t.Errorf` continues, `t.Fatalf` stops. Use `Fatalf` only when
  continuing would panic.
- Use `t.Cleanup` for resources. Never return a cleanup function from
  a helper.
- Helper names describe the property checked, not the implementation.
- One helper per behaviour. Resist the urge to combine several
  assertions into a single helper unless the combination is
  meaningful.
- Document helpers with a short godoc comment that names the failure
  mode: "Continues on failure" or "Stops the test on failure".

## A worked example

Putting the pieces together, a small but complete test file:

```go
package billing_test

import (
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"
    "time"
)

func mustParseTime(t *testing.T, value string) time.Time {
    t.Helper()
    ts, err := time.Parse(time.RFC3339, value)
    if err != nil {
        t.Fatalf("parse %q: %v", value, err)
    }
    return ts
}

func newTestServer(t *testing.T, h http.Handler) *httptest.Server {
    t.Helper()
    srv := httptest.NewServer(h)
    t.Cleanup(srv.Close)
    return srv
}

func assertEqualf[T comparable](t *testing.T, got, want T, label string) {
    t.Helper()
    if got != want {
        t.Errorf("%s: got %v, want %v", label, got, want)
    }
}

func TestInvoiceFetch(t *testing.T) {
    inv := Invoice{
        ID:       "inv_1",
        Amount:   1000,
        IssuedAt: mustParseTime(t, "2026-05-21T00:00:00Z"),
    }
    srv := newTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
        _ = json.NewEncoder(w).Encode(inv)
    }))

    got, err := FetchInvoice(srv.URL)
    if err != nil {
        t.Fatalf("FetchInvoice: %v", err)
    }

    assertEqualf(t, got.ID, inv.ID, "ID")
    assertEqualf(t, got.Amount, inv.Amount, "Amount")
    assertEqualf(t, got.IssuedAt.Equal(inv.IssuedAt), true, "IssuedAt")
}
```

Three helpers do most of the work. The test body names what is being
checked. There are no `defer` calls and no error-handling
boilerplate. If `FetchInvoice` returns the wrong amount, the failure
message reads `Amount: got 0, want 1000` and the line number points
at the `assertEqualf` call, not inside the helper.

This is the shape every test in a Go project should approach. Helpers
push noise out of the test and let the test name properties; they do
not invent a new test framework on top of `testing.T`.

### Reading the failure

Suppose `FetchInvoice` returns the wrong amount. The test runner
prints:

```
--- FAIL: TestInvoiceFetch (0.01s)
    invoice_test.go:42: Amount: got 0, want 1000
```

The location is line 42, where `assertEqualf` was called. The label
says `Amount`. The values are 0 and 1000. The reader has everything
needed to diagnose the failure in one line: which field is wrong,
which test produced the failure, what the actual and expected values
were. Compare this to a generic `assert.Equal` call producing
`got 0, want 1000` and you have to count fields to find which one
failed.

## A second worked example: HTTP route table

A common test shape is a table of HTTP route assertions: GET a path,
expect a status, expect a body substring. Helpers turn this into
declarative data.

```go
type routeCase struct {
    name       string
    method     string
    path       string
    wantStatus int
    wantBody   string
}

func runRouteCases(t *testing.T, srv *httptest.Server, cases []routeCase) {
    t.Helper()
    for _, c := range cases {
        c := c
        t.Run(c.name, func(t *testing.T) {
            t.Helper()
            req, err := http.NewRequest(c.method, srv.URL+c.path, nil)
            if err != nil {
                t.Fatalf("new request: %v", err)
            }
            resp, err := http.DefaultClient.Do(req)
            if err != nil {
                t.Fatalf("do: %v", err)
            }
            t.Cleanup(func() { resp.Body.Close() })

            assertEqualf(t, resp.StatusCode, c.wantStatus, "status")
            body, _ := io.ReadAll(resp.Body)
            if !strings.Contains(string(body), c.wantBody) {
                t.Errorf("body: %q does not contain %q", body, c.wantBody)
            }
        })
    }
}
```

A test:

```go
func TestRoutes(t *testing.T) {
    srv := newTestServer(t, Router())
    runRouteCases(t, srv, []routeCase{
        {"home", "GET", "/", 200, "Welcome"},
        {"about", "GET", "/about", 200, "About"},
        {"missing", "GET", "/missing", 404, "Not Found"},
    })
}
```

Each route case is one line of data. The runner handles request
construction, response cleanup, and the basic assertions. Adding a
new route to the test is adding a row.

## A third worked example: form validation table

A handler that validates form input is a good fit for table tests with
a small helper. Each case sends a different body and expects a
different status and error message.

```go
type formCase struct {
    name    string
    form    url.Values
    status  int
    errKey  string
}

func runFormCases(t *testing.T, h http.Handler, cases []formCase) {
    t.Helper()
    for _, c := range cases {
        c := c
        t.Run(c.name, func(t *testing.T) {
            t.Helper()
            req := httptest.NewRequest("POST", "/", strings.NewReader(c.form.Encode()))
            req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
            rr := httptest.NewRecorder()
            h.ServeHTTP(rr, req)

            assertEqualf(t, rr.Code, c.status, "status")
            if c.errKey != "" {
                if !strings.Contains(rr.Body.String(), c.errKey) {
                    t.Errorf("body %q missing error key %q", rr.Body.String(), c.errKey)
                }
            }
        })
    }
}
```

A test:

```go
func TestSignupForm(t *testing.T) {
    runFormCases(t, SignupHandler(), []formCase{
        {"valid", url.Values{"email": {"a@b"}, "pw": {"long-enough"}}, 200, ""},
        {"missing email", url.Values{"pw": {"long-enough"}}, 400, "email"},
        {"short password", url.Values{"email": {"a@b"}, "pw": {"x"}}, 400, "password"},
    })
}
```

Adding a fourth validation rule is one row of data and one line of
expected behaviour. Diagnosing a failure is reading the row.

## Helpers and subtests

Most real test files use `t.Run` to create subtests. A subtest receives
a fresh `*testing.T`, and that `t` is what the helpers in the subtest
should receive. The pattern is straightforward but the indentation
encourages mistakes:

```go
func TestPaymentFlow(t *testing.T) {
    db := openTestDB(t) // helper at the parent level

    t.Run("create payment", func(t *testing.T) {
        // Inside the subtest, this t is the subtest's t.
        // Pass *this* t to helpers.
        p := newTestPayment(t, db)
        assertEqualf(t, p.Status, "pending", "status")
    })

    t.Run("authorise payment", func(t *testing.T) {
        p := newTestPayment(t, db)
        require.NoError(t, p.Authorise())
        assertEqualf(t, p.Status, "authorised", "status")
    })
}
```

The outer `t` and the subtest `t` are different values. Passing the
outer `t` to a helper inside the subtest produces wrong cleanup
ordering: cleanups registered with the outer `t` survive until the
parent test ends, not the subtest. The compiler does not catch this;
the test passes but resources accumulate during parallel runs.

The rule: inside `t.Run(...)`, the `t` you receive is the one to use.
Helpers called from a subtest receive the subtest's `t`. Helpers
called from the parent receive the parent's `t`. The two are not
interchangeable.

## A note on `t.Parallel`

If a test calls `t.Parallel()`, it tells the runner that the test may
run concurrently with other parallel tests. Helpers must not call
`t.Parallel` on the test's behalf. Parallelism is a property of the
test, not of any helper, because parallel tests share the same set of
resources only if their helpers were written to support that sharing.

A helper that allocates per-test resources (a temp dir, an in-memory
database) is safe to call from a parallel test. A helper that touches
a global file or a fixed port is not. When you write a helper, ask
whether two copies of it could run side by side without interfering;
if not, document the limitation.

## Wrapping up

The pattern is simple: write a small function that accepts
`*testing.T`, call `t.Helper()` as the first line, and report failure
with `t.Errorf` or `t.Fatalf`. Use `t.Cleanup` for resources. Avoid
assertion libraries until you have a concrete reason to add the
dependency. Prefer many small helpers named after the property they
check over one large helper that accepts options.

The next tier extends these patterns to deep equality with `cmp.Diff`,
fixture loaders, shared `internal/testutil` packages, polling helpers
for asynchronous code, and a small test DSL.

If you take one rule from this page, take this: every helper begins
with `t.Helper()`. Every other rule is recoverable; this one is the
foundation that makes tests readable when they fail. Without
`t.Helper`, every helper you write makes failure traces worse. With
it, every helper makes them better.

### One more helper pattern: ignoring fields

Sometimes you want to compare two structs but ignore a field that
varies between runs (an auto-generated ID, a timestamp). For the
junior tier the simplest approach is to copy the struct and zero the
volatile field before comparing:

```go
func assertPaymentEqual(t *testing.T, got, want Payment) {
    t.Helper()
    g := got
    g.ID = ""        // zero the auto-generated field
    g.CreatedAt = time.Time{}
    w := want
    w.ID = ""
    w.CreatedAt = time.Time{}
    if g != w {
        t.Errorf("payment mismatch\n got: %+v\nwant: %+v", g, w)
    }
}
```

The helper makes the equality definition explicit: two payments are
equal when every field except `ID` and `CreatedAt` matches. The
middle tier replaces this approach with `cmp.Diff` and
`cmpopts.IgnoreFields`, which scales to larger structs. The
hand-rolled version is fine for a struct with three or four fields.

### Debugging tip: `t.Logf` for context

When a test fails intermittently or with a confusing message, add
`t.Logf` calls to a helper to record the values it operated on. The
output appears only on failure (or with `-v`), so it does not clutter
passing runs.

```go
func newTestUser(t *testing.T, name string) *User {
    t.Helper()
    u := &User{Name: name, CreatedAt: time.Now()}
    t.Logf("created user %s at %s", u.Name, u.CreatedAt.Format(time.RFC3339))
    return u
}
```

When a test fails, the log shows exactly which user the helper made
and when. Five extra characters in the helper, no extra noise in
passing tests.

### A pattern for chained failures

Some checks naturally come in chains: parse a body, decode JSON,
check a field. A helper that does all three with `Fatalf` short-circuits
the chain on the first real failure:

```go
func decodeBody[T any](t *testing.T, body io.Reader) T {
    t.Helper()
    data, err := io.ReadAll(body)
    if err != nil {
        t.Fatalf("read body: %v", err)
    }
    var v T
    if err := json.Unmarshal(data, &v); err != nil {
        t.Fatalf("unmarshal: %v\nbody: %s", err, data)
    }
    return v
}

func TestProfileResponse(t *testing.T) {
    rr := httptest.NewRecorder()
    GetProfile(rr, httptest.NewRequest("GET", "/", nil))
    p := decodeBody[Profile](t, rr.Body)
    assertEqualf(t, p.Name, "Ada", "name")
}
```

The helper takes the body once, returns a typed value, and lets the
test focus on what to check about the decoded profile.

### Practice checklist

Before you call yourself comfortable with junior-level helpers, you
should be able to:

- Explain what `t.Helper()` does in one sentence.
- Pick between `t.Errorf` and `t.Fatalf` for any given assertion.
- Write `assertEqual`, `assertNoError`, `mustParseTime`, and
  `newTestServer` from memory.
- Identify five tests in a real project that could benefit from a
  helper, and write the helper.
- Convert a `(db, cleanup func())` return signature into one that uses
  `t.Cleanup`.
- Recognise the symptom of a missing `t.Helper`: failure line numbers
  point inside the helper.

Working through the Tasks page on this module will exercise each
item. The Find Bug page hides a missing `t.Helper` among other
issues; spotting it confirms that the concept is internalised.

### Anti-pattern gallery

A short list of helper shapes to avoid, with the reason:

```go
// Anti-pattern: ignores t.Helper, hides location.
func assertEqualBad(t *testing.T, got, want int) {
    if got != want {
        t.Errorf("got %d, want %d", got, want)
    }
}
```

The failure points inside the helper, not the caller.

```go
// Anti-pattern: returns cleanup, forces caller to defer.
func openBad(t *testing.T) (*Resource, func()) {
    r := acquire()
    return r, func() { r.Release() }
}
```

Forgetting `defer` leaks the resource; `t.Cleanup` removes the risk.

```go
// Anti-pattern: returns error, makes the caller check it.
func parseBad(t *testing.T, s string) (Value, error) {
    return parse(s)
}
```

Either the test cares about the error and the helper should not exist,
or the test does not and the helper should call `t.Fatalf` on error.

```go
// Anti-pattern: kitchen-sink configuration.
type AssertConfig struct {
    Got, Want any
    Diff      bool
    Tolerance float64
    IgnoreNil bool
    Label     string
}
func Assert(t *testing.T, cfg AssertConfig) { ... }
```

Each option doubles the helper's behaviour space. Split into focused
helpers (`assertEqual`, `assertEqualApprox`, `assertNotNil`).

```go
// Anti-pattern: helpers that call t.Parallel.
func newServer(t *testing.T) *httptest.Server {
    t.Parallel() // wrong place
    // ...
}
```

`t.Parallel` belongs at the start of the test, not in a helper. The
test author decides whether to run in parallel; the helper has no way
to know whether it is safe.

Recognising these shapes during code review is half the battle. The
other half is writing helpers that match the patterns from earlier in
this page.
