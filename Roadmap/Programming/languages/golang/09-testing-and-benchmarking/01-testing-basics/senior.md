---
layout: default
title: Testing Basics — Senior
parent: Testing Basics
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/01-testing-basics/senior/
---

# Testing Basics — Senior

[← Back](../)

By now you can write Go tests fluently. The senior page is about *design*: how the structure of your code shapes the tests you can write, how to draw the line between unit and integration, how to manage shared fixtures, and how to keep a test suite of fifty thousand cases sustainable. None of this requires a framework beyond `testing.T` — Go's testing philosophy is that good tests come from good code, not from clever assertion DSLs.

## 1. Designing testable code without a DI framework

Go has no `@Inject`, no Spring container, no Guice. Dependency injection happens through interface arguments and constructors. The cost of testability is paid at the design layer.

### The interface boundary

A function that calls `time.Now()`, `os.Getenv`, or `http.Get` directly is hard to test because you cannot substitute the dependency. The remedy:

- Identify the moving part — the thing the test wants to control.
- Define a small interface that describes its contract.
- Take that interface as a parameter (constructor argument or function argument).
- In production, pass the standard implementation. In tests, pass a fake.

```go
// instead of calling time.Now() directly
type clock interface {
    Now() time.Time
}

type Service struct {
    clk clock
}

func New(clk clock) *Service { return &Service{clk: clk} }

func (s *Service) IsBusinessHour() bool {
    h := s.clk.Now().Hour()
    return h >= 9 && h < 17
}
```

In tests:

```go
type fakeClock struct{ t time.Time }
func (f fakeClock) Now() time.Time { return f.t }

func TestIsBusinessHour(t *testing.T) {
    cases := []struct {
        hour int
        want bool
    }{
        {9, true}, {12, true}, {17, false}, {3, false},
    }
    for _, tc := range cases {
        clk := fakeClock{t: time.Date(2024, 1, 1, tc.hour, 0, 0, 0, time.UTC)}
        s := New(clk)
        if got := s.IsBusinessHour(); got != tc.want {
            t.Errorf("hour=%d: got %v, want %v", tc.hour, got, tc.want)
        }
    }
}
```

The interface stays small — just `Now() time.Time`. Bigger interfaces invite test-only methods that complicate production code. The Go convention is "the interface lives where it is used", so this `clock` interface goes in the package that uses it, not in some shared abstractions package.

### Accepting concrete types behind interfaces

When the standard library already provides a concrete type that suits production but is hard to fake — `*http.Client`, `*sql.DB`, `*os.File` — wrap it behind an interface in your own package:

```go
type HTTPDoer interface {
    Do(req *http.Request) (*http.Response, error)
}

type Client struct {
    http HTTPDoer
}

func New(http HTTPDoer) *Client { return &Client{http: http} }
```

In production:

```go
c := New(http.DefaultClient)
```

In tests:

```go
type fakeHTTP struct{ resp *http.Response; err error }
func (f *fakeHTTP) Do(*http.Request) (*http.Response, error) { return f.resp, f.err }
```

The interface should be as narrow as the code under test actually needs. `*http.Client` has a dozen methods; if your code uses only `Do`, the interface should be `Do`.

### When dependency injection is overkill

Not everything needs an interface. If the cost of the interface (an extra parameter, a new abstraction) outweighs the testing benefit, just call the thing directly. Tests of pure functions, simple data transformations, parsers, and formatters need no injection at all.

A useful rule of thumb: introduce a dependency interface when the dependency has *side effects* (time, network, file system, randomness) or when faking it makes the test 10x faster. Otherwise let the test be a black-box test of the public API.

## 2. White-box vs black-box trade-offs

The internal/external test package choice covered in `middle.md` reflects a deeper design question: should the test know about implementation details?

### Arguments for black-box (`package foo_test`)

- The test exercises only the public API, which is what real users see.
- Refactoring internals does not break tests.
- The test serves as a usage example.
- The test is portable: if you decided to rewrite `foo` in another package, the test moves with the public contract.

### Arguments for white-box (`package foo`)

- Unexported helpers may have subtle invariants that the public API does not exercise.
- A complex unexported state machine may be more economically tested directly.
- Internal regression tests can pin invariants that the public API only obliquely depends on.

### A pragmatic split

Most production Go packages have both:

- `foo_test.go` (`package foo_test`) — black-box tests for every public function and method.
- `foo_internal_test.go` (`package foo`) — white-box tests for tricky unexported logic.
- `export_test.go` (`package foo`) — exposes unexported state for the external test to manipulate in specific cases.

The split makes the *intent* of each test obvious: black-box tests check the contract; white-box tests check the implementation; export_test sits between them.

### A concrete example

Consider a cache package with an LRU eviction policy:

```go
// public API
type Cache struct{ ... }
func New(capacity int) *Cache
func (c *Cache) Get(key string) (any, bool)
func (c *Cache) Put(key string, val any)
func (c *Cache) Len() int
```

Black-box tests:

```go
// cache_test.go
package cache_test

func TestPutGet(t *testing.T) { ... }
func TestEvictsOldest(t *testing.T) {
    c := cache.New(2)
    c.Put("a", 1); c.Put("b", 2); c.Put("c", 3) // a evicted
    if _, ok := c.Get("a"); ok {
        t.Error("expected a evicted")
    }
}
```

The eviction test is observable through `Get` so it stays black-box.

White-box test:

```go
// cache_internal_test.go
package cache

func TestListInvariant(t *testing.T) {
    c := New(3)
    c.Put("a", 1); c.Put("b", 2); c.Put("c", 3)
    if got := c.list.Len(); got != 3 {
        t.Errorf("list.Len = %d, want 3", got)
    }
    if c.list.Front().Value.(*entry).key != "c" {
        t.Error("most recent should be at front")
    }
}
```

The list invariant is not directly observable through the public API; a white-box test pins it. If someone later changes the implementation to a hash table, this test breaks, and that is correct — the test pinned an implementation choice, not a contract.

## 3. Test suites with `TestMain`

A *test suite* is the set of tests in a package's test binary. `TestMain` lets you control the suite's lifecycle.

### Shared expensive setup

```go
package store_test

import (
    "database/sql"
    "log"
    "os"
    "testing"

    _ "github.com/lib/pq"
)

var testDB *sql.DB

func TestMain(m *testing.M) {
    db, err := sql.Open("postgres", os.Getenv("TEST_DATABASE_URL"))
    if err != nil {
        log.Fatal(err)
    }
    if err := db.Ping(); err != nil {
        log.Fatal(err)
    }
    if err := migrate(db); err != nil {
        log.Fatal(err)
    }
    testDB = db

    code := m.Run()

    if err := db.Close(); err != nil {
        log.Printf("close db: %v", err)
    }
    os.Exit(code)
}

func TestX(t *testing.T) {
    // use testDB
}
```

This setup:

- Opens the database connection once for the whole binary.
- Runs migrations once.
- Tests share the connection (and must not corrupt each other).
- Closes the connection at exit.

### Lazy initialisation with `sync.Once`

If only some tests need the expensive resource, defer its creation:

```go
var (
    dbOnce sync.Once
    db     *sql.DB
    dbErr  error
)

func getDB(t *testing.T) *sql.DB {
    t.Helper()
    dbOnce.Do(func() {
        db, dbErr = openTestDB()
    })
    if dbErr != nil {
        t.Fatalf("db init: %v", dbErr)
    }
    return db
}
```

Tests that call `getDB(t)` pay the setup cost once; tests that don't pay nothing. The `sync.Once` is captured by the package, so it amortises across the whole binary.

### Suite-wide cleanup

`TestMain` runs setup before `m.Run` and teardown after. If a panic occurs anywhere, `m.Run` returns a non-zero code but the teardown still runs because it is after the `m.Run()` call (not in a `defer`). However, if `TestMain` itself panics before `m.Run`, the teardown never executes — guard with a `defer`:

```go
func TestMain(m *testing.M) {
    setUp()
    defer tearDown() // runs even if a later step panics
    code := m.Run()
    tearDown()       // explicit normal-path teardown
    os.Exit(code)
}
```

Be careful with `os.Exit` — it does not run deferred functions. The convention is to call `tearDown` explicitly before `os.Exit`. Some teams move teardown into `TestMain`'s deferred body and use `os.Exit` with a captured code.

### Per-package state vs per-test state

`TestMain`-managed state is shared across the package's tests. Per-test state (a fresh transaction, a temp directory, an isolated cache) should be created in each test via helpers and `t.Cleanup`. The pattern:

```go
func newStore(t *testing.T) *Store {
    t.Helper()
    tx, err := testDB.Begin()
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { tx.Rollback() })
    return NewStore(tx)
}

func TestUserCreate(t *testing.T) {
    s := newStore(t)
    if err := s.CreateUser("alice"); err != nil {
        t.Fatal(err)
    }
}
```

`testDB` is shared (cheap, immutable post-migration); `tx` is per-test (cheap, mutable, rolled back automatically). The combination scales to thousands of tests against one database.

## 4. Fixture management

A *fixture* is reusable test data: a sample input, a golden output, a baseline state. Go's tooling for fixtures is minimal but principled.

### Inline fixtures

Small, self-explanatory inputs belong in the test source:

```go
func TestParseJSON(t *testing.T) {
    in := `{"name":"alice","age":30}`
    got, err := Parse(in)
    if err != nil {
        t.Fatal(err)
    }
    if got.Name != "alice" || got.Age != 30 {
        t.Errorf("got %+v", got)
    }
}
```

Use inline data when the input is under ~20 lines and reading it does not distract from the test's point.

### `testdata/` directory

For larger fixtures, put them in a `testdata/` directory next to the test file. The Go toolchain ignores `testdata/` entirely — it is not packaged, not compiled, not influenced by build tags.

```
foo/
    foo.go
    foo_test.go
    testdata/
        sample.json
        large_payload.bin
```

Tests load fixtures via `os.ReadFile`:

```go
data, err := os.ReadFile("testdata/sample.json")
if err != nil {
    t.Fatal(err)
}
```

The working directory of a Go test is the package directory, so the relative path works reliably across operating systems and CI environments.

### Golden files

When the expected output is large or generated, store it in `testdata/` and compare bytes:

```go
got := generateReport(input)
want, err := os.ReadFile("testdata/report.golden")
if err != nil {
    t.Fatal(err)
}
if !bytes.Equal(got, want) {
    t.Errorf("report mismatch (use -update to refresh)")
}
```

With a `-update` flag, the test rewrites the golden file:

```go
var update = flag.Bool("update", false, "rewrite testdata/*.golden")

func TestReport(t *testing.T) {
    got := generateReport(input)
    if *update {
        if err := os.WriteFile("testdata/report.golden", got, 0o644); err != nil {
            t.Fatal(err)
        }
        return
    }
    // compare as above
}
```

The full pattern with diffs is covered in `11-golden-files`. The lesson here is that `testdata/` plus a small protocol gives you a maintainable fixture system without a framework.

### Reusable fixture builders

For complex objects, write builders that return reasonable defaults and let tests override fields:

```go
func newUser(t *testing.T, overrides ...func(*User)) *User {
    t.Helper()
    u := &User{
        ID:        "user-123",
        Email:     "test@example.com",
        CreatedAt: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
    }
    for _, o := range overrides {
        o(u)
    }
    return u
}

func TestX(t *testing.T) {
    u := newUser(t, func(u *User) { u.Email = "alice@example.com" })
    // ...
}
```

This pattern (functional options for test data) reduces boilerplate without introducing a fixture DSL. It also reads top-to-bottom — the defaults are obvious, the overrides are explicit.

## 5. The unit/integration boundary

A *unit test* exercises code in isolation. An *integration test* exercises code together with its real dependencies (database, network, file system, time). The boundary is squishy; the discipline is:

- A unit test must not require a process started by `docker-compose`.
- A unit test must run in under 50 ms.
- A unit test must produce no I/O outside `t.TempDir`.
- A unit test must not depend on `time.Sleep` for synchronisation.

If any of these fails, the test is no longer a unit test — relabel it.

### Marking integration tests

Three common techniques:

1. **Build tags**: `//go:build integration` at the top of the file. Run with `go test -tags=integration`.
2. **`testing.Short()`**: skip slow tests when `-short` is passed.
3. **Separate package**: integration tests live in `foo/integration/`, run with `go test ./foo/integration/`.

Each has trade-offs:

- Build tags are clean but require remembering the tag in CI.
- `-short` is friendly locally but a stray slow test in unit mode is invisible.
- Separate package costs duplication but isolates dependencies (you can use `testcontainers-go` only in the integration package).

The most maintainable approach is build tags for "needs Docker" and `-short` for "needs over 100 ms". CI runs both phases.

### Integration tests in Go's standard library

`net/http` has both kinds. The internal tests use `httptest.NewServer` (in-process, no docker), so they qualify as unit tests despite touching the network stack. The external tests in `net/http_test` use the real `*http.Client` against in-process servers — integration of HTTP client and server, but not against a remote network. This is "small i" integration testing, common in Go.

"Big I" integration — against PostgreSQL, Redis, Kafka, S3 — should live behind a build tag and run in a dedicated CI job.

## 6. Build tags for tests

Build tags partition test files. The syntax:

```go
//go:build integration
// +build integration

package foo

import "testing"

func TestIntegration(t *testing.T) { ... }
```

The two-line form (modern `//go:build` and legacy `// +build`) is required by Go 1.17+ tooling. The second comment is generated by `gofmt`.

Combine tags:

```go
//go:build integration && linux
// +build integration,linux
```

This file is compiled only when `-tags=integration` is passed *and* the target OS is Linux.

A common pattern is to put expensive setup behind a tag:

```go
//go:build needs_aws

package storage

import (
    "os"
    "testing"
)

func TestMain(m *testing.M) {
    if os.Getenv("AWS_REGION") == "" {
        // skip the whole package
        os.Exit(0)
    }
    os.Exit(m.Run())
}
```

`go test ./...` without `-tags=needs_aws` compiles and runs the package's other tests; with the tag, `TestMain` runs and gates execution on the env var.

## 7. Test parallelism strategy at scale

A package may have hundreds of tests. The parallelism question becomes:

- Which tests can run in parallel within the package? — those that touch only their own state.
- How many packages can run in parallel? — controlled by `go test -p N`, default `GOMAXPROCS`.
- What about CI shards?

The default of `GOMAXPROCS` for both `-p` and `-parallel` is fine for laptops. CI runners with high core counts may want higher values; resource-constrained runners may want lower (to avoid OOM).

### Detecting parallel-unsafe code

A test that passes serially but fails under `t.Parallel()` is telling you about shared mutable state. The race detector (`-race`) catches the data race; even without races, behavioural flakes (one test's writes visible to another) signal a design issue. Fix the package, not the test.

### When parallel helps least

Parallelism does not help when:

- Every test takes 1 ms — the overhead of scheduling dominates.
- Tests share a global lock (everyone serializes anyway).
- The CI runner has only two cores.

Measure with `-cpuprofile` (covered in `07-benchmarking-basics` and `08-go-test-tool`) before assuming `t.Parallel` everywhere helps.

## 8. Coverage as a design tool

Coverage measurement is covered in depth in `06-coverage`. From the senior perspective, two ideas matter:

1. **Coverage as a discovery tool**: lines you did not realise existed often need tests. Run `go test -coverprofile=cover.out`, `go tool cover -html=cover.out`, and look at red lines.
2. **Coverage as a *limit*, not a quota**: a 95% covered package may still have a fragile design; a 70% covered package may be perfectly well-designed if the uncovered code is generated, defensive, or platform-specific.

Avoid coverage targets in CI for libraries you do not own. For code you do own, a trend (does coverage go down on this PR?) is a better signal than an absolute threshold.

## 9. Tests as compile-time documentation

The signatures and bodies of `_test.go` files double as living documentation:

- `Example` functions render in `pkg.go.dev`.
- Test names appear in CI dashboards.
- Test file structure mirrors the public API.

Treat the test file as part of the documentation surface. A reviewer should be able to read `foo_test.go` and understand what `foo` does without reading `foo.go`.

## 10. Test naming at scale

When a package has 200 tests, naming becomes critical for `-run` selectivity and CI failure messages. Conventions that work:

- `TestSubject_Action_Outcome`: `TestPaymentService_RefundPartial_ReturnsRemainingBalance`.
- For table-driven cases inside such a test, name each `tc.name` similarly: `refund_amount_exceeds_charge`.

Readability beats brevity. A name 60 characters long is fine if the failure is unambiguous in CI output.

## 11. Test helper libraries

You will encounter many. The Go ecosystem has:

- `github.com/stretchr/testify` — large assertion DSL plus mock builder. Popular, but adopts a different style than the standard library.
- `gotest.tools/v3` or `gotestyourself/assert` — small assertion helpers that align with `testing.T` idioms.
- `github.com/google/go-cmp/cmp` — structural diff for complex values. Recommended.
- `github.com/golang/mock` (gomock) — mock generation from interfaces.

The recommended baseline:

- Always use stdlib `testing` as the leaf.
- Use `go-cmp/cmp` for deep equality with readable diffs.
- Avoid testify in new code unless your team already uses it; the assertion DSL hides the `if got != want` pattern that the rest of the ecosystem expects.
- Avoid gomock for trivial mocks — hand-written mocks of small interfaces are usually clearer.

See `05-test-helpers-libraries` for the full discussion.

## 12. CI considerations

Test design intersects CI design:

- Tests must be **reproducible**: same code, same result, on any platform. Network, randomness, time, and locale are the usual culprits.
- Tests must be **fast enough**: a 30-minute test suite is a productivity blocker. Parallelise, shard, and gate slow tests with `-short` or build tags.
- Tests must be **observable**: a CI failure should give enough information to reproduce locally without re-running the test. `t.Log` strategically, capture artefacts on failure.
- Tests must **fail loudly**: a flaky test is a bug. Track and fix; do not skip without an issue.

The `professional.md` page elaborates the CI angle.

## 13. Reviewing a Go test PR

A senior code review of `_test.go` changes should look for:

1. **Naming**: are subjects, actions, and outcomes clear?
2. **Setup discipline**: fatal vs error, `t.Cleanup` vs `defer`, `t.TempDir` vs hardcoded paths.
3. **Parallelism**: where appropriate, used; where unsafe, avoided.
4. **Assertions**: do failure messages include both got and want?
5. **Fixtures**: small ones inline, large ones in `testdata/`.
6. **Coverage**: does the PR exercise the new branches?
7. **Flakes**: any `time.Sleep`, any test-only globals, any goroutines leaking?

A test PR that passes all seven checks rarely produces flakes downstream.

## 14. The `testing.TB` interface

`testing.TB` is a small interface implemented by `*testing.T`, `*testing.B`, and `*testing.F`:

```go
type TB interface {
    Cleanup(func())
    Error(args ...any)
    Errorf(format string, args ...any)
    Fail()
    FailNow()
    Failed() bool
    Fatal(args ...any)
    Fatalf(format string, args ...any)
    Helper()
    Log(args ...any)
    Logf(format string, args ...any)
    Name() string
    Setenv(key, value string)
    Skip(args ...any)
    SkipNow()
    Skipf(format string, args ...any)
    Skipped() bool
    TempDir() string
    private()
}
```

Helpers that work in both tests and benchmarks take `testing.TB`:

```go
func openFixture(tb testing.TB, name string) *os.File {
    tb.Helper()
    f, err := os.Open(filepath.Join("testdata", name))
    if err != nil {
        tb.Fatal(err)
    }
    tb.Cleanup(func() { f.Close() })
    return f
}

func TestX(t *testing.T) {
    f := openFixture(t, "sample.json")
    _ = f
}

func BenchmarkX(b *testing.B) {
    f := openFixture(b, "sample.json")
    _ = f
}
```

The `private()` method prevents users outside the standard library from implementing `TB`, which is a defence against custom testing frameworks that diverge from the official semantics.

## 15. Subtests and resource lifetimes

A subtle interaction: `t.Cleanup` on a parent runs *after* parallel subtests complete, but `t.Cleanup` on a subtest runs when the subtest finishes — which for a parallel subtest is some indeterminate moment.

If a subtest's cleanup releases a resource that other subtests use, the cleanup may run before they finish. The fix is to put shared resource cleanup on the parent and per-subtest cleanup on the child:

```go
func TestX(t *testing.T) {
    db := openDB()
    t.Cleanup(db.Close) // shared, runs after all subtests

    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            tx := db.Begin()
            t.Cleanup(tx.Rollback) // per-subtest, runs when this subtest ends
            // assertions
        })
    }
}
```

`db.Close` waits for every subtest's `tx.Rollback` to complete, because the parent's cleanup is later in the timeline.

## 16. Time and tests

The most common source of flakes in Go tests is `time.Now`, `time.After`, and `time.Sleep`. Strategies:

- Inject a clock via interface (see section 1).
- Use channels with explicit signalling instead of `Sleep`-then-check.
- Use `t.Deadline` to bound polling loops.
- Avoid `time.Sleep` shorter than 50 ms — it is rarely reliable on shared CI runners.

The `time` package's `time.NewTicker` and `time.NewTimer` are difficult to fake. Libraries like `github.com/benbjohnson/clock` provide a fake clock that supports tickers and timers; for serious time-sensitive code, this is worth the dependency. We will revisit time in `10-deterministic-tests`.

## 17. A senior-level test layout

Putting design choices together. Suppose you build `pkg/billing`:

```
pkg/billing/
    billing.go             # public API
    billing_internal.go    # private helpers
    
    billing_test.go        # package billing_test (black-box)
    billing_white_test.go  # package billing (white-box)
    export_test.go         # package billing (test-only exports)
    
    integration_test.go    # package billing_test, //go:build integration
    
    testdata/
        valid_invoice.json
        invalid_invoice.json
        report.golden
```

In `billing_test.go` you might have:

```go
package billing_test

import (
    "testing"
    "time"

    "example.com/pkg/billing"
    "github.com/google/go-cmp/cmp"
)

type fakeClock struct{ t time.Time }
func (f fakeClock) Now() time.Time { return f.t }

func newService(t *testing.T, opts ...func(*billing.Service)) *billing.Service {
    t.Helper()
    s := billing.New(billing.Config{
        Clock: fakeClock{t: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)},
    })
    for _, o := range opts {
        o(s)
    }
    return s
}

func TestService_CalculateInvoice(t *testing.T) {
    t.Parallel()
    cases := []struct {
        name    string
        input   billing.Invoice
        want    billing.Total
    }{
        {"single_item", billing.Invoice{...}, billing.Total{...}},
        {"with_discount", billing.Invoice{...}, billing.Total{...}},
        {"with_tax", billing.Invoice{...}, billing.Total{...}},
    }
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            s := newService(t)
            got, err := s.Calculate(tc.input)
            if err != nil {
                t.Fatalf("Calculate: %v", err)
            }
            if diff := cmp.Diff(tc.want, got); diff != "" {
                t.Errorf("Calculate mismatch (-want +got):\n%s", diff)
            }
        })
    }
}
```

The structure makes the test self-explanatory: external package, builder for the service, table-driven cases, parallel subtests, structural diff. Once a team adopts this layout, new tests slot in with minimal cognitive overhead.

## 18. Common senior-level mistakes

- **Too many interfaces**: every concrete type wrapped in a one-method interface for "testability". The result is unreadable production code. Introduce interfaces only when faking is required.
- **`TestMain` that does too much**: bringing up a Kubernetes cluster in `TestMain` makes the whole suite hostage to one cluster's health. Push such setup into the integration test job, not `TestMain`.
- **Helpers that hide assertions**: an `assertOk(t, err)` that swallows the error and prints "not ok" is worse than the explicit form. Helpers should add structure, not obscure intent.
- **Subtests where simple tests suffice**: `t.Run("happy_path", func(t *testing.T) { ... })` with no siblings is just noise. Use subtests when there are multiple cases.
- **Mocks that mirror implementation**: a mock that asserts the exact sequence of method calls couples the test to internals. Prefer fakes that implement the contract and let the test assert on observable behaviour.

## 19. Where the standard library shines

Read `src/encoding/json/decode_test.go`, `src/net/http/serve_test.go`, and `src/sync/once_test.go`. They are written by the people who designed the framework, and they show the canonical idioms at scale:

- Tightly named tests.
- Table-driven cases with descriptive names.
- Inline fakes (no third-party mock libraries).
- `httptest` for HTTP, `iotest` for `io.Reader`, `synctest` (Go 1.24+) for synchronisation primitives.
- Sparing use of `Helper`, prudent use of `Cleanup`.

The aesthetic is "no surprises". Adopt it in your own code.

## 20. What's next

The next sections of `09-testing-and-benchmarking` build on this foundation:

- `02-table-driven-tests` — deeper on the canonical pattern.
- `03-subtests-tdir-cleanup` — the lifecycle helpers up close.
- `04-test-helpers-and-fixtures` — fixtures, builders, golden files.
- `05-test-helpers-libraries` — testify, go-cmp, gomock, when to use which.
- `06-coverage` — coverage measurement and interpretation.
- `07-benchmarking-basics` — `*testing.B` and microbenchmarks.

Read them in order if you can. Each subsection assumes everything before it.
