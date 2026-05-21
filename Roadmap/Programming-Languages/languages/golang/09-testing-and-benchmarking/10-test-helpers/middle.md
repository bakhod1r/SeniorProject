---
layout: default
title: Test Helpers — Middle
parent: Test Helpers
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/10-test-helpers/middle/
---

# Test Helpers — Middle

[← Back](../)

The junior tier covered single-purpose helpers in a single test file.
As a test suite grows past a hundred files, the same helpers appear
in several packages, fixtures grow complex, and equality checks
become richer than `==` can express. This tier covers shared helper
packages, deep equality via `cmp.Diff`, fixture loaders, polling
helpers for asynchronous code, time freezing, random data, an HTTP
test server helper, building a small DSL, and testing the helpers
themselves.

By the end of the page you should be comfortable extracting helpers
into `internal/testutil`, writing comparison helpers backed by
`google/go-cmp`, building fixture loaders that read from `testdata/`,
testing helpers with a fake `testing.TB`, and reaching for testify
only when the project has a concrete reason to depend on it.

## Shared helper packages

When two packages need the same helper, copying it is wrong. Move it
to `internal/testutil`. The directory is special: only the module that
contains it may import it, so the helpers stay private. The package
can depend on `*testing.T`, but a more flexible signature accepts
`testing.TB`, which is the interface satisfied by both `*testing.T`
and `*testing.B`. The same helpers work in benchmarks.

```go
package testutil

import (
    "testing"

    "github.com/google/go-cmp/cmp"
)

func Equal[T comparable](tb testing.TB, got, want T) {
    tb.Helper()
    if got != want {
        tb.Errorf("got %v, want %v", got, want)
    }
}

func Diff[T any](tb testing.TB, got, want T, opts ...cmp.Option) {
    tb.Helper()
    if d := cmp.Diff(want, got, opts...); d != "" {
        tb.Errorf("unexpected diff (-want +got):\n%s", d)
    }
}
```

Tests in any package can now write:

```go
import "example.com/myapp/internal/testutil"

func TestThing(t *testing.T) {
    got := compute()
    testutil.Diff(t, got, Result{Status: "ok", Count: 3})
}
```

The package is small on purpose. Resist the temptation to grow it
into a framework: every helper added here is a contract that every
test in the project depends on. Once `testutil.Diff` is in use across
fifty test files, changing its behaviour means touching all of them.

### Why `testing.TB`

The `testing.TB` interface is the common ancestor of `*testing.T` and
`*testing.B`. It has the methods every helper actually uses:
`Helper`, `Errorf`, `Fatalf`, `Cleanup`, `Log`, `Logf`, `Name`,
`Skip`, `Skipf`, and a few others. Accepting `testing.TB` rather than
`*testing.T` makes the helper reusable in benchmarks without
modification. Benchmarks are tests that report timings; the same
fixture builders and assertion helpers work in both.

A helper that needs a method specific to `*testing.T` (like
`t.Parallel`) cannot accept `testing.TB`. In practice, helpers should
never call `t.Parallel`, so the constraint is theoretical for most
code.

### Naming the package

The directory `internal/testutil` is the canonical location. Some
projects prefer `internal/testhelpers` or `internal/qa`. The name
does not matter; the `internal/` prefix is the important part because
it constrains visibility.

For a project with many packages, you may have several test-only
packages: `internal/testutil` for assertion helpers,
`internal/fixtures` for fixture loaders, `internal/testserver` for
HTTP test infrastructure. The split is by purpose, not by package
that uses the helpers. Each test-only package has a single
responsibility and a clear set of consumers.

## Deep equality with `cmp.Diff`

`reflect.DeepEqual` returns a boolean. When it returns false, you
know something differs but not what. `google/go-cmp` gives you the
diff:

```go
got := Profile{Name: "Ada", Tags: []string{"go", "math"}}
want := Profile{Name: "Ada", Tags: []string{"math", "go"}}

if d := cmp.Diff(want, got); d != "" {
    t.Errorf("Profile mismatch (-want +got):\n%s", d)
}
```

Output:

```
Profile mismatch (-want +got):
  Profile{
    Name: "Ada",
    Tags: []string{
-     "math",
      "go",
+     "math",
    },
  }
```

The diff format is unambiguous: lines prefixed with `-` belong to the
want side, lines prefixed with `+` belong to the got side. A reader
looking at the failure understands the difference without rereading
the test.

The `google/go-cmp` package documentation describes `cmp.Diff` as
returning "a human-readable report of the differences between two
values". The format is stable across versions, so test snapshots that
compare diff output continue to work after upgrades.

### Argument order

The signature is `cmp.Diff(want, got, opts...)`. The first argument
is the expected value; the second is what the test actually produced.
The diff is reported as `-want +got`. Reversing the order produces a
correctly-shaped diff with the wrong sign convention, and readers
will misinterpret which side is which. Pick one order and use it
project-wide.

A helper enforces the convention:

```go
func DiffWantGot[T any](tb testing.TB, want, got T, opts ...cmp.Option) {
    tb.Helper()
    if d := cmp.Diff(want, got, opts...); d != "" {
        tb.Errorf("(-want +got):\n%s", d)
    }
}
```

The parameter names tell the caller which is which. Now the call
reads `DiffWantGot(t, expected, actual)` and the labels in the
failure message match the names.

## Comparison options

Sometimes two values are equal for the test's purposes but unequal
under strict comparison. `cmp.Option` values customise the
comparison.

```go
import (
    "github.com/google/go-cmp/cmp"
    "github.com/google/go-cmp/cmp/cmpopts"
)

// Ignore one field.
testutil.Diff(t, got, want, cmpopts.IgnoreFields(Event{}, "ID", "CreatedAt"))

// Tolerate small floating point differences.
testutil.Diff(t, got, want, cmpopts.EquateApprox(0, 1e-9))

// Treat slices as sets.
testutil.Diff(t, gotTags, wantTags, cmpopts.SortSlices(func(a, b string) bool { return a < b }))
```

These options let the test express what equality means in its
domain. A payment with an auto-generated `ID` is equal to the
expected payment if every other field matches; the helper makes that
intent explicit.

### Useful options at a glance

The standard option set lives in `github.com/google/go-cmp/cmp/cmpopts`.
The most useful ones for everyday tests:

- `cmpopts.IgnoreFields(T{}, names...)`: ignore named fields on type
  `T`.
- `cmpopts.IgnoreTypes(T{})`: ignore any value of type `T` anywhere
  in the tree.
- `cmpopts.IgnoreUnexported(T{})`: skip unexported fields of `T`.
- `cmpopts.EquateEmpty()`: treat nil and empty slices/maps as equal.
- `cmpopts.EquateApprox(frac, abs)`: treat floats as equal within
  tolerance.
- `cmpopts.EquateErrors()`: compare errors with `errors.Is`.
- `cmpopts.SortSlices(less)`: sort slices before comparing.
- `cmpopts.SortMaps(less)`: sort map entries before formatting.

When a project needs a custom equality, a `cmp.Comparer` or
`cmp.Transformer` extends the system. The package documentation has
the full list.

### Allowing unexported fields

`cmp.Diff` refuses to inspect unexported fields by default. Calling
`cmp.AllowUnexported(MyType{})` permits it for that type:

```go
testutil.Diff(t, got, want, cmp.AllowUnexported(MyType{}))
```

The mechanism is opt-in because comparing unexported fields couples
the test to the internal layout of the type. When the type lives in a
package outside the test's package, prefer adding a public method
that exposes the relevant data and compare on that.

## Fixture loaders

A fixture is a precomputed test input or expected output stored on
disk, usually under `testdata/`. The Go toolchain ignores `testdata/`
when building, so fixtures do not appear in the binary. A loader
helper reads, parses, and returns the fixture:

```go
func loadJSON[T any](tb testing.TB, name string) T {
    tb.Helper()
    path := filepath.Join("testdata", name)
    data, err := os.ReadFile(path)
    if err != nil {
        tb.Fatalf("read %s: %v", path, err)
    }
    var out T
    if err := json.Unmarshal(data, &out); err != nil {
        tb.Fatalf("unmarshal %s: %v", path, err)
    }
    return out
}
```

The test:

```go
func TestParseInvoice(t *testing.T) {
    want := loadJSON[Invoice](t, "invoice_valid.json")
    got := ParseInvoice(loadJSON[Raw](t, "invoice_raw.json"))
    testutil.Diff(t, got, want)
}
```

Both inputs and expectations live in `testdata/`, so the test code
expresses logic only.

### Golden files

A golden file is an expected output stored on disk that the test
compares against. The pattern is the same as a fixture, but the
file's content is what the test produces, not what it consumes. A
helper:

```go
func assertGolden(tb testing.TB, name string, got []byte) {
    tb.Helper()
    path := filepath.Join("testdata", name)
    if *update {
        if err := os.WriteFile(path, got, 0o644); err != nil {
            tb.Fatalf("write golden: %v", err)
        }
        return
    }
    want, err := os.ReadFile(path)
    if err != nil {
        tb.Fatalf("read golden: %v", err)
    }
    if !bytes.Equal(got, want) {
        tb.Errorf("golden mismatch for %s", name)
    }
}
```

`update` is a `flag.Bool` defined in the test file:

```go
var update = flag.Bool("update", false, "update golden files")
```

Running `go test -update` rewrites the golden files with the current
output. Running `go test` compares against them. The pattern is the
standard way to test renderers, formatters, code generators, and
anything else that produces text or bytes.

## Random data helpers

Property-style tests need random inputs. `testing/quick.Value`
produces a random value of a given type and is enough for most
cases:

```go
func randomUser(tb testing.TB, seed int64) User {
    tb.Helper()
    r := rand.New(rand.NewSource(seed))
    v, ok := quick.Value(reflect.TypeOf(User{}), r)
    if !ok {
        tb.Fatalf("quick.Value did not produce a User")
    }
    return v.Interface().(User)
}
```

A seeded helper is reproducible. Failures print the seed so a
developer can rerun the exact case locally:

```go
func TestSerialiseUser(t *testing.T) {
    seed := time.Now().UnixNano()
    t.Logf("seed=%d", seed)
    u := randomUser(t, seed)
    data, _ := json.Marshal(u)
    var u2 User
    _ = json.Unmarshal(data, &u2)
    testutil.Diff(t, u2, u)
}
```

The `t.Logf` line prints only when the test fails or runs with `-v`,
so passing tests stay quiet. When a failure happens, the log shows
the seed, and the developer reruns the test with that exact seed by
overriding the line locally.

### A factory pattern

For complex structs, hand-written factories are more useful than
`quick.Value`. Factories give the test control over which fields
vary:

```go
func newTestUser(tb testing.TB, opts ...userOpt) User {
    tb.Helper()
    u := User{
        ID:    "user_test",
        Name:  "Test User",
        Email: "test@example.com",
        Role:  "user",
    }
    for _, opt := range opts {
        opt(&u)
    }
    return u
}

type userOpt func(*User)

func withName(n string) userOpt    { return func(u *User) { u.Name = n } }
func withRole(r string) userOpt    { return func(u *User) { u.Role = r } }
func withEmail(e string) userOpt   { return func(u *User) { u.Email = e } }
```

A test:

```go
u := newTestUser(t, withName("Ada"), withRole("admin"))
```

The factory provides sensible defaults. The test overrides only what
matters for the case. The reader scanning the test sees the
overrides, which are exactly the part of the input the test cares
about.

## Time freezing

Code that calls `time.Now` is hard to test. The conventional fix is
to inject a clock. The helper wraps the dependency:

```go
type clock interface {
    Now() time.Time
}

type fixedClock struct{ t time.Time }

func (c fixedClock) Now() time.Time { return c.t }

func freezeTime(tb testing.TB, layout, value string) clock {
    tb.Helper()
    t, err := time.Parse(layout, value)
    if err != nil {
        tb.Fatalf("parse %q: %v", value, err)
    }
    return fixedClock{t: t}
}
```

The test reads:

```go
func TestExpiry(t *testing.T) {
    c := freezeTime(t, time.RFC3339, "2026-05-21T00:00:00Z")
    if HasExpired(c, Event{Until: c.Now().Add(time.Hour)}) {
        t.Error("expected event not to be expired")
    }
}
```

The helper isolates the parsing and the construction of the clock
into one call.

### Advancing the clock

For tests that need to advance time, the clock interface grows a
method:

```go
type controlClock struct{ t time.Time }

func (c *controlClock) Now() time.Time      { return c.t }
func (c *controlClock) Advance(d time.Duration) { c.t = c.t.Add(d) }
```

The helper returns the concrete type so the test can advance:

```go
func startClock(tb testing.TB, at string) *controlClock {
    tb.Helper()
    t, err := time.Parse(time.RFC3339, at)
    if err != nil {
        tb.Fatalf("parse %q: %v", at, err)
    }
    return &controlClock{t: t}
}

func TestRateLimit(t *testing.T) {
    c := startClock(t, "2026-05-21T00:00:00Z")
    r := NewRateLimiter(c, 1, time.Second)
    if !r.Allow() {
        t.Fatal("first call should be allowed")
    }
    if r.Allow() {
        t.Fatal("second call within 1s should be denied")
    }
    c.Advance(time.Second)
    if !r.Allow() {
        t.Fatal("call after 1s should be allowed")
    }
}
```

The test reads as a sequence of events with explicit time control.
There is no `time.Sleep` and the test is deterministic.

## Polling helpers

Asynchronous code finishes at an indeterminate time. Sleeping a
fixed duration is unreliable: too short and the test flakes, too
long and the suite slows. A polling helper waits for a condition:

```go
func eventually(tb testing.TB, d time.Duration, cond func() bool) {
    tb.Helper()
    deadline := time.Now().Add(d)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(10 * time.Millisecond)
    }
    tb.Fatalf("condition not met within %s", d)
}
```

The test:

```go
func TestBackgroundWorker(t *testing.T) {
    w := startWorker()
    t.Cleanup(w.Stop)
    w.Enqueue(Job{ID: 1})
    eventually(t, time.Second, func() bool {
        return w.ProcessedCount() == 1
    })
}
```

The helper uses `t.Fatalf` because once it times out the test cannot
infer anything from later assertions.

### Tuning the poll interval

The 10 millisecond interval is a default that balances responsiveness
and CPU use. For tests that wait on a fast condition, a shorter
interval lets the test complete in microseconds. For tests that wait
on a slow external dependency (a database write to replicate),
a longer interval reduces wasted polls. A more configurable helper:

```go
type pollOpt struct {
    timeout  time.Duration
    interval time.Duration
}

func eventuallyOpts(tb testing.TB, o pollOpt, cond func() bool) {
    tb.Helper()
    if o.interval == 0 {
        o.interval = 10 * time.Millisecond
    }
    deadline := time.Now().Add(o.timeout)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(o.interval)
    }
    tb.Fatalf("condition not met within %s", o.timeout)
}
```

The simple `eventually` covers 90 percent of cases; the variant is
there for the 10 percent that need it.

## HTTP test server helper

`httptest.NewServer` returns a server that the caller must close. A
helper takes care of that:

```go
func newTestServer(tb testing.TB, h http.Handler) *httptest.Server {
    tb.Helper()
    srv := httptest.NewServer(h)
    tb.Cleanup(srv.Close)
    return srv
}
```

The test:

```go
func TestClientList(t *testing.T) {
    srv := newTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
        fmt.Fprintln(w, `["a","b"]`)
    }))
    got, err := List(srv.URL)
    testutil.Equal(t, err, nil)
    testutil.Diff(t, got, []string{"a", "b"})
}
```

The test never deals with `Close`. Adding more tests in the same file
does not add boilerplate.

### A more featured server helper

For tests that need to inspect requests, a small wrapper records
them:

```go
type recordedServer struct {
    *httptest.Server
    mu       sync.Mutex
    requests []*http.Request
}

func (r *recordedServer) Requests() []*http.Request {
    r.mu.Lock()
    defer r.mu.Unlock()
    out := make([]*http.Request, len(r.requests))
    copy(out, r.requests)
    return out
}

func newRecordedServer(tb testing.TB, h http.Handler) *recordedServer {
    tb.Helper()
    rs := &recordedServer{}
    rs.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        rs.mu.Lock()
        rs.requests = append(rs.requests, r.Clone(r.Context()))
        rs.mu.Unlock()
        h.ServeHTTP(w, r)
    }))
    tb.Cleanup(rs.Close)
    return rs
}
```

A test that checks the client sent the right headers:

```go
func TestClientSendsAuth(t *testing.T) {
    rs := newRecordedServer(t, http.NotFoundHandler())
    _ = CallAPI(rs.URL, "token-1")
    reqs := rs.Requests()
    testutil.Equal(t, len(reqs), 1)
    testutil.Equal(t, reqs[0].Header.Get("Authorization"), "Bearer token-1")
}
```

The helper does the bookkeeping; the test asks the questions the
domain cares about.

## Building a small DSL

When tests in one package share many helpers, a domain-specific
style emerges. A common shape is a builder around a `t` and a
fixture:

```go
type session struct {
    tb     testing.TB
    server *httptest.Server
    token  string
}

func newSession(tb testing.TB) *session {
    tb.Helper()
    srv := newTestServer(tb, apiHandler())
    return &session{tb: tb, server: srv}
}

func (s *session) login(user, pass string) *session {
    s.tb.Helper()
    s.token = doLogin(s.tb, s.server.URL, user, pass)
    return s
}

func (s *session) get(path string) *http.Response {
    s.tb.Helper()
    return doGet(s.tb, s.server.URL+path, s.token)
}
```

A test:

```go
func TestProfileEndpoint(t *testing.T) {
    resp := newSession(t).login("ada", "pw").get("/profile")
    testutil.Equal(t, resp.StatusCode, http.StatusOK)
}
```

The DSL is small. Avoid letting it grow into a framework that hides
the underlying HTTP calls. The point is to write the test once at the
level the domain cares about; if the abstraction makes failures
harder to diagnose, peel it back.

### When the DSL has grown too big

Three signs that a DSL has crossed the line:

- A method exists only to call another method with different
  arguments.
- The DSL has its own configuration object that the tests pass around.
- A failure message references the DSL rather than the system under
  test.

When you see these signs, deflate the DSL. Inline a few methods. Move
the configuration into the test. The DSL should be the smallest layer
that removes obvious noise; anything more is overhead.

## Testing the helpers themselves

Helpers are code too. A helper that quietly returns when it should
fail introduces silent bugs into every test. The `testing` package
supports testing helpers through a fake `T`:

```go
type fakeT struct {
    *testing.T
    failed bool
}

func (f *fakeT) Errorf(format string, args ...any) { f.failed = true }
func (f *fakeT) Helper()                             {}

func TestEqualReports(t *testing.T) {
    f := &fakeT{}
    Equal(f, 1, 2)
    if !f.failed {
        t.Error("Equal should have reported a failure on unequal arguments")
    }
}
```

The fake records the call and lets the outer test verify that the
helper behaved correctly.

### Embedding `testing.TB`

A fake that satisfies the entire `testing.TB` interface is verbose
but type-safe. Embedding the real `*testing.T` gives you the methods
you do not override for free:

```go
type fakeTB struct {
    testing.TB
    errors  []string
    fatal   bool
}

func (f *fakeTB) Helper()                             {}
func (f *fakeTB) Errorf(format string, args ...any)   { f.errors = append(f.errors, fmt.Sprintf(format, args...)) }
func (f *fakeTB) Fatalf(format string, args ...any)   { f.errors = append(f.errors, fmt.Sprintf(format, args...)); f.fatal = true; runtime.Goexit() }
```

`runtime.Goexit` simulates the early exit that `t.Fatalf` produces.
The test that exercises a `Fatalf` path runs it in a goroutine and
waits for the exit:

```go
func TestFatalHelper(t *testing.T) {
    f := &fakeTB{}
    done := make(chan struct{})
    go func() {
        defer close(done)
        helperThatFatals(f)
    }()
    <-done
    if !f.fatal {
        t.Error("expected helper to call Fatalf")
    }
}
```

The pattern is verbose but it is the only way to test a helper that
calls `Fatalf`.

## When to reach for testify

testify is appropriate when a team has many engineers who do not
write Go full time. The library standardises naming (`require.Equal`,
`assert.Equal`) and gives a uniform failure format across packages.
The cost is a dependency, an extra layer of error messages, and a
temptation to write suites of `assert` calls instead of writing
focused tests.

A pragmatic position: use `cmp.Diff` and hand-rolled helpers in pure
Go code, and tolerate testify in code that interfaces with other
ecosystems where its idioms already dominate. The senior tier covers
the trade-offs at depth; for now, the rule is to prefer the standard
library.

### A short testify example

```go
import (
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestPayment(t *testing.T) {
    p, err := Create(100, "USD")
    require.NoError(t, err)        // stop on error
    assert.Equal(t, 100, p.Amount) // continue on mismatch
    assert.Equal(t, "USD", p.Currency)
}
```

`require.NoError` plays the role of `t.Fatalf` on a nil check.
`assert.Equal` plays the role of `t.Errorf`. The functions internally
call `t.Helper`, so failure locations point at the test.

The same test in hand-rolled style:

```go
func TestPayment(t *testing.T) {
    p, err := Create(100, "USD")
    if err != nil {
        t.Fatalf("Create: %v", err)
    }
    if p.Amount != 100 {
        t.Errorf("Amount: got %d, want 100", p.Amount)
    }
    if p.Currency != "USD" {
        t.Errorf("Currency: got %s, want USD", p.Currency)
    }
}
```

Both versions are fine. Pick the one that fits the project.

## Composing helpers

Helpers compose by passing `testing.TB` to other helpers. A fixture
loader that uses an assertion helper internally is fine; both call
`tb.Helper` and the failure trace skips both:

```go
func loadAndValidate[T any](tb testing.TB, path string, validate func(T) error) T {
    tb.Helper()
    v := loadJSON[T](tb, path)
    if err := validate(v); err != nil {
        tb.Fatalf("validate %s: %v", path, err)
    }
    return v
}
```

The composed helper has the same shape as its parts: takes `tb`,
calls `Helper`, fails the test on the first detected problem. The
test that uses it gets a value or stops.

### Helper layering

In a mature project, helpers form layers:

- Primitive layer: `Equal`, `Diff`, `NoError`, `Cleanup` wrappers.
- Fixture layer: `loadJSON`, `loadGolden`, factory functions.
- Resource layer: `newTestDB`, `newTestServer`, `newTempDir`.
- Domain layer: `newTestUser`, `newTestPayment`, `runRouteCases`.
- DSL layer: `session`, `scenario`, builders that chain.

Layers above call layers below. Layers below never call layers
above. The rule keeps coupling acyclic and makes each layer testable
in isolation.

## Migrating a legacy test file

A common task in the middle tier is taking an old test file that has
grown organically and refactoring it to use the helpers described
here. The process is mechanical and worth doing slowly the first few
times.

Start with the file as-is. Identify every block that does one of:

- Opens and closes a resource: convert to a `new<Resource>` helper
  that registers `t.Cleanup`.
- Compares a complex struct: replace with `cmp.Diff` and an
  `assertX` helper.
- Decodes JSON, parses time, or reads a file: replace with a `must`
  helper.
- Repeats a setup that takes more than three lines: extract a
  factory.

After each extraction, run the suite. The tests should still pass.
If a test fails, the extraction missed something; revert and try
again.

A typical migration reduces a 200-line test file to 80 lines without
changing what is tested. The remaining 120 lines move into a
`helpers_test.go` file or `internal/testutil`. The compiled binary
size is the same; the readability is dramatically better.

### Before and after

A legacy test:

```go
func TestCreateInvoiceLegacy(t *testing.T) {
    db, err := sql.Open("sqlite3", ":memory:")
    if err != nil {
        t.Fatalf("open db: %v", err)
    }
    defer db.Close()

    if _, err := db.Exec("CREATE TABLE invoices (id TEXT, amount INT)"); err != nil {
        t.Fatalf("create table: %v", err)
    }

    raw, err := os.ReadFile("testdata/invoice_input.json")
    if err != nil {
        t.Fatalf("read input: %v", err)
    }
    var input Invoice
    if err := json.Unmarshal(raw, &input); err != nil {
        t.Fatalf("unmarshal input: %v", err)
    }

    expRaw, err := os.ReadFile("testdata/invoice_expected.json")
    if err != nil {
        t.Fatalf("read expected: %v", err)
    }
    var expected Invoice
    if err := json.Unmarshal(expRaw, &expected); err != nil {
        t.Fatalf("unmarshal expected: %v", err)
    }

    got, err := CreateInvoice(db, input)
    if err != nil {
        t.Fatalf("CreateInvoice: %v", err)
    }

    if got.ID != expected.ID {
        t.Errorf("ID: got %s, want %s", got.ID, expected.ID)
    }
    if got.Amount != expected.Amount {
        t.Errorf("Amount: got %d, want %d", got.Amount, expected.Amount)
    }
    if !got.IssuedAt.Equal(expected.IssuedAt) {
        t.Errorf("IssuedAt: got %v, want %v", got.IssuedAt, expected.IssuedAt)
    }
}
```

After refactoring with helpers:

```go
func TestCreateInvoice(t *testing.T) {
    db := newTestDB(t)
    input := loadJSON[Invoice](t, "invoice_input.json")
    want := loadJSON[Invoice](t, "invoice_expected.json")

    got, err := CreateInvoice(db, input)
    testutil.NoError(t, err)
    testutil.Diff(t, got, want, cmpopts.IgnoreFields(Invoice{}, "ID"))
}
```

Six lines instead of forty. Every line names a step the reader cares
about. The error-handling boilerplate, the schema setup, and the
field-by-field comparison live in the helpers, where they belong.

## Helper testing in depth

The fake `testing.TB` shown earlier handles `Errorf` and `Helper`.
For helpers that touch more of the interface, the fake needs to grow.
A practical pattern is a small library of fakes used by helper tests:

```go
package testutil

import (
    "fmt"
    "testing"
)

type FakeTB struct {
    testing.TB
    Logs    []string
    Errors  []string
    Failed  bool
    Cleanups []func()
}

func (f *FakeTB) Helper()                                 {}
func (f *FakeTB) Log(args ...any)                         { f.Logs = append(f.Logs, fmt.Sprint(args...)) }
func (f *FakeTB) Logf(format string, args ...any)         { f.Logs = append(f.Logs, fmt.Sprintf(format, args...)) }
func (f *FakeTB) Error(args ...any)                       { f.Errors = append(f.Errors, fmt.Sprint(args...)); f.Failed = true }
func (f *FakeTB) Errorf(format string, args ...any)       { f.Errors = append(f.Errors, fmt.Sprintf(format, args...)); f.Failed = true }
func (f *FakeTB) Cleanup(fn func())                       { f.Cleanups = append(f.Cleanups, fn) }
func (f *FakeTB) Name() string                            { return "fake" }
func (f *FakeTB) Fail()                                   { f.Failed = true }

func (f *FakeTB) RunCleanups() {
    for i := len(f.Cleanups) - 1; i >= 0; i-- {
        f.Cleanups[i]()
    }
}
```

The fake supports the methods most helpers actually call. Tests for
helpers use it like this:

```go
func TestNewTestServerRegistersCleanup(t *testing.T) {
    f := &FakeTB{TB: t}
    srv := newTestServer(f, http.NotFoundHandler())
    if len(f.Cleanups) != 1 {
        t.Errorf("expected 1 cleanup registered, got %d", len(f.Cleanups))
    }
    f.RunCleanups()
    // verify server is closed by trying to make a request and checking it fails
    _, err := http.Get(srv.URL)
    if err == nil {
        t.Error("expected server to be closed after cleanup")
    }
}
```

The test verifies the contract: the helper registers exactly one
cleanup, and running it closes the server. Without this verification,
a refactor that drops the `t.Cleanup` call would pass every test that
uses the helper, because tests do not normally inspect cleanup
registration.

## A note on the `t.TempDir` builtin

The standard library provides `t.TempDir()`, which is a built-in
helper that creates a unique directory and registers cleanup
automatically. Many projects wrap it for consistency:

```go
func TempDir(tb testing.TB) string {
    tb.Helper()
    return tb.TempDir()
}
```

The wrapper looks redundant. It earns its place when the project
later decides every temp dir should have a specific prefix or live
under a specific root. Changing the wrapper updates every test; if
each test called `t.TempDir()` directly, the change would touch every
file.

For most projects, calling `t.TempDir()` directly is fine. The
wrapper is a hedge against future requirements.

## When to write a `require` variant

A helper that calls `Errorf` is the default. A `require` variant that
calls `Fatalf` exists for cases where continuing would produce
nonsense:

```go
func RequireNoError(tb testing.TB, err error) {
    tb.Helper()
    if err != nil {
        tb.Fatalf("unexpected error: %v", err)
    }
}

func NoError(tb testing.TB, err error) {
    tb.Helper()
    if err != nil {
        tb.Errorf("unexpected error: %v", err)
    }
}
```

The naming follows testify: `Require` for fatal, plain name for
continue. Tests that need to stop on a nil return value call
`RequireNoError`. Tests that report several issues from a multi-error
collector call `NoError`. The two coexist; the test picks the right
one for the situation.

## A complete `internal/testutil` package

To pull the threads together, here is a small but complete
`internal/testutil` package that covers the common needs of a
service-style Go project:

```go
package testutil

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "net/http"
    "net/http/httptest"
    "os"
    "path/filepath"
    "testing"
    "time"

    "github.com/google/go-cmp/cmp"
)

// Equal reports an error if got != want. Continues on failure.
func Equal[T comparable](tb testing.TB, got, want T) {
    tb.Helper()
    if got != want {
        tb.Errorf("got %v, want %v", got, want)
    }
}

// Diff reports an error with a (-want +got) diff if got != want.
// Continues on failure. Accepts cmp.Option values for custom equality.
func Diff[T any](tb testing.TB, got, want T, opts ...cmp.Option) {
    tb.Helper()
    if d := cmp.Diff(want, got, opts...); d != "" {
        tb.Errorf("unexpected diff (-want +got):\n%s", d)
    }
}

// NoError reports an error if err != nil. Continues on failure.
func NoError(tb testing.TB, err error) {
    tb.Helper()
    if err != nil {
        tb.Errorf("unexpected error: %v", err)
    }
}

// RequireNoError stops the test if err != nil.
func RequireNoError(tb testing.TB, err error) {
    tb.Helper()
    if err != nil {
        tb.Fatalf("unexpected error: %v", err)
    }
}

// ErrorIs reports an error if errors.Is(got, want) is false.
func ErrorIs(tb testing.TB, got, want error) {
    tb.Helper()
    if !errors.Is(got, want) {
        tb.Errorf("error chain: got %v, want %v", got, want)
    }
}

// MustParseTime returns the parsed time or stops the test.
func MustParseTime(tb testing.TB, layout, value string) time.Time {
    tb.Helper()
    t, err := time.Parse(layout, value)
    if err != nil {
        tb.Fatalf("parse %q: %v", value, err)
    }
    return t
}

// LoadJSON reads and unmarshals a fixture from testdata/.
func LoadJSON[T any](tb testing.TB, name string) T {
    tb.Helper()
    path := filepath.Join("testdata", name)
    data, err := os.ReadFile(path)
    if err != nil {
        tb.Fatalf("read %s: %v", path, err)
    }
    var out T
    if err := json.Unmarshal(data, &out); err != nil {
        tb.Fatalf("unmarshal %s: %v", path, err)
    }
    return out
}

// NewTestServer wraps httptest.NewServer and registers cleanup.
func NewTestServer(tb testing.TB, h http.Handler) *httptest.Server {
    tb.Helper()
    srv := httptest.NewServer(h)
    tb.Cleanup(srv.Close)
    return srv
}

// Eventually polls cond until it returns true or the timeout elapses.
func Eventually(tb testing.TB, timeout time.Duration, cond func() bool) {
    tb.Helper()
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(10 * time.Millisecond)
    }
    tb.Fatalf("condition not met within %s", timeout)
}

// NewContext returns a context cancelled when the test ends.
func NewContext(tb testing.TB) context.Context {
    tb.Helper()
    ctx, cancel := context.WithCancel(context.Background())
    tb.Cleanup(cancel)
    return ctx
}

func mustString(s string, err error) string {
    if err != nil {
        panic(fmt.Errorf("internal: %w", err))
    }
    return s
}
```

Twelve helpers, fewer than 100 lines, covering the recurring patterns
in service-style tests. Adding a thirteenth helper is a one-line
addition that becomes available everywhere. The package is the
shared vocabulary of every test in the project.

A package this small is also easy to keep stable. Engineers do not
have to remember twenty different signatures. The cost of adopting
the package is reading it once.

## Wrapping up

This tier introduced shared helper packages, `cmp.Diff` and its
options, fixture loaders, time freezing, polling helpers, an HTTP
test server helper, a small DSL, and helper testing. The senior tier
goes deeper on `t.Helper` semantics, parallel tests, property tests
via `testing/quick.Check`, custom `cmp.Option` patterns, and when a
helper has crossed the line into framework territory.

The mental model to take from this page: helpers are layered tools
that turn a sequence of error-handling and comparison code into a
sequence of statements that name the property being checked. The
layering keeps each helper small; the typed signatures keep the
contracts clear; the use of `testing.TB` keeps benchmarks and tests
sharing the same code.

### Practice checklist

To validate that you have absorbed the middle-tier material:

- Move three helpers from a single test file into
  `internal/testutil`.
- Replace one struct comparison with `cmp.Diff` and at least one
  `cmpopts` option.
- Add `t.Cleanup`-based cleanup to a helper that currently returns
  `func()`.
- Write a `FakeTB` and use it to test one of your helpers.
- Write an `Eventually` call that replaces a fixed `time.Sleep`.

Once each item is done in real code, the senior tier covers the
deeper semantics: how `t.Helper` walks the stack, how parallel tests
interact with shared helpers, and how to keep a DSL from sliding
into a framework.
