---
layout: default
title: Integration Tests — Find the Bug
parent: Integration Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/13-integration-tests/find-bug/
---

# Integration Tests — Find the Bug

[← Back](../)

Each snippet below is a small integration test with a real defect. Try to
spot it before reading the answer. The defects are drawn from production
Go codebases, not invented.

## Snippet A — Container leak

```go
func TestUserCreate(t *testing.T) {
    ctx := context.Background()
    pg, err := postgres.Run(ctx, "postgres:16-alpine",
        postgres.WithDatabase("app"))
    if err != nil { t.Fatal(err) }
    defer pg.Terminate(ctx)

    db := mustOpen(t, pg)
    if _, err := db.Exec(`INSERT INTO users(name) VALUES($1)`, "ann"); err != nil {
        t.Fatal(err)
    }
}
```

Defect: `defer pg.Terminate(ctx)` runs when `TestUserCreate` returns, but
`t.Fatal` exits the goroutine via `runtime.Goexit` — which still fires
deferred functions in the same goroutine, so the `defer` here actually
works. The real bug is subtler: if `postgres.Run` returns an error the
test fails before `defer` is registered. Also, when `t.Parallel()` is in
effect and a subtest fails, deferred cleanup of the parent runs while the
subtest still holds connections.

Fix: register cleanup via `t.Cleanup(func(){ _ = pg.Terminate(ctx) })`
immediately after the successful `postgres.Run`.

## Snippet B — Hard-coded port

```go
func TestServer(t *testing.T) {
    go http.ListenAndServe(":8081", handler)
    resp, _ := http.Get("http://localhost:8081/ping")
    if resp.StatusCode != 200 { t.Fatal("bad status") }
}
```

Defects:

1. Hard-coded port collides when run in parallel.
2. No readiness wait — the GET may race the server start.
3. The error from `http.Get` is discarded; a connection failure would
   panic on `resp.StatusCode` with a nil pointer.
4. `http.ListenAndServe` blocks forever; even after the test ends the
   goroutine keeps listening.

Fix: `httptest.NewServer(handler)` solves all four problems in one line.

## Snippet C — `time.Sleep` instead of poll

```go
func TestCacheExpiry(t *testing.T) {
    c.Set("k", "v", 100*time.Millisecond)
    time.Sleep(150 * time.Millisecond)
    if _, ok := c.Get("k"); ok {
        t.Fatal("expected expiry")
    }
}
```

Defect: brittle on slow CI. Either the timer drifts and the test flakes,
or the sleep is too long and the suite slows down. Better: inject a clock,
advance it deterministically. Or, if a real clock must be used, poll with
a deadline:

```go
deadline := time.Now().Add(2 * time.Second)
for time.Now().Before(deadline) {
    if _, ok := c.Get("k"); !ok { return }
    time.Sleep(20 * time.Millisecond)
}
t.Fatal("did not expire within deadline")
```

## Snippet D — Parallel race on shared schema

```go
func TestList(t *testing.T) {
    t.Parallel()
    db := pkgDB // shared package-level *sql.DB
    _, _ = db.Exec("INSERT INTO posts(title) VALUES($1)", t.Name())
    rows, _ := db.Query("SELECT title FROM posts")
    if !rows.Next() { t.Fatal("empty") }
    // expects exactly one row
}
```

Defect: tests share `pkgDB` and one test's writes are visible to others.
With `t.Parallel()` the count of rows depends on scheduling.

Fix: either open a transaction in `t.Cleanup` that rolls back, or
`CREATE DATABASE` per test. Discarded errors from `db.Exec` and
`db.Query` also hide real failures — never use bare `_` on database
calls.

## Snippet E — Missing wait strategy

```go
req := testcontainers.ContainerRequest{
    Image:        "postgres:16-alpine",
    ExposedPorts: []string{"5432/tcp"},
}
c, _ := testcontainers.GenericContainer(ctx, ...)
db := openSQL(t, c) // fails about 30% of the time on cold start
```

Defect: container is `Running` but Postgres has not finished
initialization. `openSQL` succeeds at `sql.Open` (lazy) but the first
query gets `connection refused`.

Fix: add `WaitingFor: wait.ForSQL("5432/tcp", "pgx", dsnFn)` or use
`postgres.Run` from the `modules/postgres` package, which bakes the wait
strategy in.

## Snippet F — Nondeterministic seed

```go
rand.Seed(time.Now().UnixNano())
id := rand.Int63()
```

Defect: failing test cannot be reproduced. CI prints `id=8472938472938`,
but the next attempt produces a different ID.

Fix: seed from a constant or from `t.Name()` hash, and print the seed on
failure. Even better, use `math/rand/v2` (Go 1.22+) with an explicit
`rand.New(rand.NewPCG(seed1, seed2))` so randomness is local to the test.

## Snippet G — Ignored context

```go
func TestProducer(t *testing.T) {
    ctx := context.Background()
    if err := producer.Send(ctx, msg); err != nil {
        t.Fatal(err)
    }
}
```

Defect: a hung broker hangs the test forever, blocking CI. Eventually the
top-level `-timeout` kicks in, but the failure message will not point at
this test specifically.

Fix: always wrap with `context.WithTimeout(ctx, 10*time.Second)`. Plumb
the test deadline into the context so cancellation is observable.

## Snippet H — Cleanup before allocation

```go
t.Cleanup(func() { db.Close() })
db := openDB(t) // db is nil at Cleanup registration time? No — closure captures by reference
```

Defect: `t.Cleanup` runs LIFO at test end. The closure captures `db` by
its outer-scope name, which is fine here once `openDB` returns. However,
if `openDB` itself calls `t.Fatal` (e.g. inside `t.Helper()` with an
assertion), the cleanup is already registered for a nil db, and the
deferred `db.Close()` panics with a nil pointer dereference, masking the
original error.

Fix: register cleanup AFTER successful allocation.

```go
db := openDB(t)
t.Cleanup(func() { _ = db.Close() })
```

## Snippet I — Wrong assertion granularity

```go
func TestOrder(t *testing.T) {
    o := factories.Order(t, db)
    if o == nil { t.Fatal("nil order") }
}
```

Defect: factories rarely return `nil`; the assertion is a tautology. The
test passes even if the order has wrong fields, missing relations or
unsaved state.

Fix: assert on concrete fields — `o.UserID != 0`, `o.Status == "new"` —
and load the row back through the repository to verify persistence.

## Snippet J — Network leak

```go
ln, _ := net.Listen("tcp", "127.0.0.1:0")
go http.Serve(ln, h)
// no cleanup
```

Defect: the goroutine keeps serving forever; the listener stays open;
fd usage climbs across tests.

Fix: wrap in `http.Server`, register `t.Cleanup` that calls
`srv.Shutdown(ctx)`. Or, simplest: use `httptest.NewServer`.

## Snippet K — Map iteration order

```go
seen := map[string]bool{"a": true, "b": true, "c": true}
got := []string{}
for k := range seen {
    got = append(got, k)
}
want := []string{"a", "b", "c"}
if !reflect.DeepEqual(got, want) {
    t.Fatalf("got %v", got)
}
```

Defect: Go intentionally randomizes map iteration. The test fails
unpredictably.

Fix: `sort.Strings(got)` before comparing, or compare via a set abstraction.

## Snippet L — Connection exhaustion

```go
func TestMany(t *testing.T) {
    for i := 0; i < 1000; i++ {
        db, _ := sql.Open("pgx", dsn)
        _ = db.QueryRow("SELECT 1").Scan(new(int))
        // no Close
    }
}
```

Defect: each `sql.Open` allocates a connection pool. After a few hundred
iterations Postgres rejects with "too many clients". The test process
also leaks file descriptors.

Fix: open `db` once at the top, `t.Cleanup(func(){ db.Close() })`. Reuse
across iterations.

## Snippet M — Goroutine leak in test

```go
func TestProducer(t *testing.T) {
    ch := make(chan int)
    go func() {
        for v := range ch {
            _ = v
        }
    }()
    ch <- 1
    ch <- 2
    // forgot to close(ch); the goroutine lives forever
}
```

Defect: the spawned goroutine never returns. Across 1000 tests you
accumulate 1000 leaked goroutines and gigabytes of stack space.

Fix: `defer close(ch)`. Use `go.uber.org/goleak` at the end of
`TestMain` to fail the suite if goroutines leak:

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

## Snippet N — Forgotten `t.Helper`

```go
func mustOpenDB(t *testing.T) *sql.DB {
    db, err := sql.Open("pgx", dsn)
    if err != nil { t.Fatal(err) }
    return db
}
```

Defect: when the test fails, the line number points at this helper,
not at the test that called it. Reviewers waste time tracing back.

Fix: add `t.Helper()` as the first line of the helper.

## Snippet O — Reused context cancel

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

pg, _ := postgres.Run(ctx, ...)
t.Cleanup(func() { _ = pg.Terminate(ctx) })
```

Defect: `cancel()` runs at function return — *before* `t.Cleanup` fires.
By the time cleanup runs, `ctx` is already cancelled and
`pg.Terminate(ctx)` returns instantly with a context error, possibly
leaving the container alive.

Fix: create a fresh context for cleanup:

```go
t.Cleanup(func() {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    _ = pg.Terminate(ctx)
})
```

## Snippet P — Reading from a closed channel

```go
done := make(chan struct{})
go func() {
    defer close(done)
    if err := server.Run(); err != nil {
        t.Errorf("server: %v", err)
    }
}()
server.Shutdown()
<-done
```

Defect: calling `t.Errorf` from a goroutine other than the test's
main goroutine is racy and may be reported on the wrong test, or not at
all. Some Go versions even panic.

Fix: send the error via a channel and assert in the main goroutine:

```go
errCh := make(chan error, 1)
go func() { errCh <- server.Run() }()
server.Shutdown()
if err := <-errCh; err != nil { t.Errorf("server: %v", err) }
```

## Snippet Q — Container reuse without isolation

```go
func TestA(t *testing.T) {
    db := sharedDB(t)
    _, _ = db.Exec("UPDATE settings SET v = 1")
    // assert v == 1
}

func TestB(t *testing.T) {
    db := sharedDB(t)
    // assert v == 0 — passes if A runs after B, fails if before
}
```

Defect: A and B share a database. Their assertions assume initial
state. Order matters; `-shuffle=on` exposes the bug.

Fix: each test gets a fresh database, or each test sets up the state
it needs.

## Closing note

If you can identify defects A through Q on review without running the
test, you are a stronger second pair of eyes than 90% of Go reviewers.
Add this page's snippets to your team's onboarding doc; they pay back
in fewer flaky CI signals.

The patterns repeat across codebases. Once your eye is trained for
them, you spot them quickly during PR review — and your colleagues
learn by osmosis as you leave concise review comments.
