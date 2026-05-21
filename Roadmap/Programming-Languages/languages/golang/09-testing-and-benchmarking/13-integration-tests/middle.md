---
layout: default
title: Integration Tests — Middle
parent: Integration Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/13-integration-tests/middle/
---

# Integration Tests — Middle

[← Back](../)

The Middle page takes the Junior patterns further. By the end you can run a
test suite that shares one Postgres container across many tests, isolates
each test from the others, runs in parallel, and tears down cleanly even
when something throws.

## 1. The expensive-setup problem

A Postgres `testcontainers-go` startup costs roughly 2–4 seconds: image
pull (cached after the first time), container create, network attach, and
finally the database init scripts. Multiply that by 50 tests and you have
two minutes of pure setup latency.

The fix is well-known across testing frameworks: do the expensive thing
once per package, share it, and isolate the cheap thing per test. In Go,
the lever is `TestMain`.

## 2. `TestMain` in depth

`go test` calls `TestMain(m *testing.M)` instead of running tests directly
if you define one in the package. You are responsible for invoking
`m.Run()` and passing its exit code to `os.Exit`.

```go
// file: db/main_test.go
//go:build integration

package db

import (
    "context"
    "database/sql"
    "log"
    "os"
    "testing"

    _ "github.com/jackc/pgx/v5/stdlib"
    "github.com/testcontainers/testcontainers-go/modules/postgres"
)

var (
    adminDSN string
    admin    *sql.DB
)

func TestMain(m *testing.M) {
    ctx := context.Background()

    pg, err := postgres.Run(ctx,
        "postgres:16-alpine",
        postgres.WithDatabase("template"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"),
        postgres.BasicWaitStrategies(),
    )
    if err != nil {
        log.Fatalf("start postgres: %v", err)
    }

    adminDSN, err = pg.ConnectionString(ctx, "sslmode=disable")
    if err != nil {
        _ = pg.Terminate(ctx)
        log.Fatal(err)
    }

    admin, err = sql.Open("pgx", adminDSN)
    if err != nil {
        _ = pg.Terminate(ctx)
        log.Fatal(err)
    }

    code := m.Run()

    _ = admin.Close()
    _ = pg.Terminate(ctx)
    os.Exit(code)
}
```

Important details:

- The container lives for the entire package run. Do not call `pg.Terminate`
  before `m.Run()` returns.
- `os.Exit` bypasses deferred functions; any cleanup must happen *before*
  the call.
- `BasicWaitStrategies()` provided by the postgres module covers the
  "ready to accept connections" log line and a TCP probe. Reliable enough
  for almost all suites.

## 3. Database-per-test isolation

`CREATE DATABASE` in Postgres takes about 20–40 ms. That is cheap enough
to run per test, and it gives you complete write isolation. Pattern:

```go
func newTestDB(t *testing.T) *sql.DB {
    t.Helper()
    name := "t_" + strings.ReplaceAll(strings.ToLower(t.Name()), "/", "_")
    name = name + "_" + randSuffix()

    if _, err := admin.Exec("CREATE DATABASE " + pq.QuoteIdentifier(name)); err != nil {
        t.Fatalf("create database: %v", err)
    }
    t.Cleanup(func() {
        _, _ = admin.Exec("DROP DATABASE " + pq.QuoteIdentifier(name) + " WITH (FORCE)")
    })

    dsn := strings.Replace(adminDSN, "/template", "/"+name, 1)
    db, err := sql.Open("pgx", dsn)
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { _ = db.Close() })

    if err := applySchema(db); err != nil {
        t.Fatal(err)
    }
    return db
}

func randSuffix() string {
    var b [4]byte
    _, _ = crand.Read(b[:])
    return hex.EncodeToString(b[:])
}
```

Notes:

- `pq.QuoteIdentifier` (from `lib/pq`) prevents SQL injection from test
  names with strange characters.
- `WITH (FORCE)` in `DROP DATABASE` disconnects any leftover sessions —
  handy when a test left a connection open due to a bug.
- The DSN swap relies on knowing the path component contains the database
  name. Real code should parse and rebuild via `net/url` for safety.

## 4. Transactional fixtures for read-mostly tests

Sometimes you do not need a fresh database — only fresh state. Wrap the
test in a transaction, do all work through it, and let `t.Cleanup` roll it
back.

```go
type DBTX interface {
    QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row
    ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error)
    QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error)
}

func newTx(t *testing.T, db *sql.DB) DBTX {
    t.Helper()
    tx, err := db.BeginTx(context.Background(), nil)
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { _ = tx.Rollback() })
    return tx
}
```

Your repositories accept `DBTX`, so the same code paths run in tests and
production:

```go
type UserRepo struct{ Q DBTX }

func (r *UserRepo) Insert(ctx context.Context, name string) (int64, error) {
    var id int64
    err := r.Q.QueryRowContext(ctx,
        `INSERT INTO users(name) VALUES($1) RETURNING id`, name,
    ).Scan(&id)
    return id, err
}
```

Caveats:

- Tests that depend on `COMMIT` semantics (triggers fired on commit,
  asynchronous after-commit hooks) cannot use this pattern.
- Some isolation levels surprise you. Default `READ COMMITTED` is usually
  fine; `SERIALIZABLE` may deadlock with parallel writes.

## 5. Schema application

A small `applySchema` helper either runs migrations or executes a single
file. For real projects, plug your migration tool (`golang-migrate`,
`pressly/goose`) and call it programmatically:

```go
import "github.com/golang-migrate/migrate/v4"
import _ "github.com/golang-migrate/migrate/v4/source/file"
import _ "github.com/golang-migrate/migrate/v4/database/postgres"

func applySchema(db *sql.DB) error {
    driver, err := mpostgres.WithInstance(db, &mpostgres.Config{})
    if err != nil {
        return err
    }
    m, err := migrate.NewWithDatabaseInstance(
        "file://../migrations", "postgres", driver)
    if err != nil {
        return err
    }
    return m.Up()
}
```

Real-life advice: pre-build a template database with migrations applied,
then `CREATE DATABASE new TEMPLATE template` per test. Postgres copies the
template in milliseconds. The cost of running migrations once per package
disappears.

## 6. Parallel integration tests

Once tests are isolated by database, `t.Parallel()` becomes safe:

```go
func TestRepo_Insert(t *testing.T) {
    t.Parallel()
    db := newTestDB(t)
    // ...
}
```

A few rules to keep parallel tests sane:

- Do not share `*sql.DB` instances across tests unless every operation
  goes through a transaction.
- Set `db.SetMaxOpenConns` per test to a small number (5–10). Otherwise
  100 parallel tests open 5000 connections and Postgres rejects them.
- The default `go test` parallelism is `GOMAXPROCS`. Override with
  `-parallel=8` if your machine has more cores than your DB can serve.

## 7. Network port allocation

Whenever you run a server in-process, ask the kernel for an ephemeral
port. Never hard-code.

```go
func startServer(t *testing.T, h http.Handler) string {
    ln, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        t.Fatal(err)
    }
    srv := &http.Server{Handler: h}
    go func() { _ = srv.Serve(ln) }()
    t.Cleanup(func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        _ = srv.Shutdown(ctx)
    })
    return "http://" + ln.Addr().String()
}
```

Reading `ln.Addr().String()` returns something like `127.0.0.1:54327`.
Use that as the base URL for the test's clients.

## 8. Mixing `httptest` and containers

A common pattern is: real database, fake third-party API. The third party
runs as an `httptest.NewServer` that records calls and replies with canned
responses.

```go
func TestService_HandlesUpstreamFailure(t *testing.T) {
    db := newTestDB(t)
    upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        http.Error(w, "boom", http.StatusBadGateway)
    }))
    t.Cleanup(upstream.Close)

    svc := New(db, upstream.URL)
    err := svc.Sync(context.Background())
    if !errors.Is(err, ErrUpstream) {
        t.Fatalf("got %v", err)
    }
}
```

This blends real persistence (catches schema bugs) with controllable
upstream (catches error handling), without booting Wiremock.

## 9. Flake hunting

Three patterns explain 90% of integration flakes:

1. **Time-based assumptions.** `time.Sleep(100ms)` works locally and times
   out on slow CI. Replace with bounded polling: try every 20 ms until 5 s
   passes.
2. **Map iteration order.** Tests that depend on the first key of a map
   look correct most days. Always sort.
3. **Connection leaks.** Setting `MaxOpenConns=∞` plus parallel tests
   exhausts the database. Limit connections and confirm with
   `pg_stat_activity` if needed.

```go
func waitFor(t *testing.T, cond func() bool, within time.Duration) {
    t.Helper()
    deadline := time.Now().Add(within)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(20 * time.Millisecond)
    }
    t.Fatalf("condition not met within %v", within)
}
```

## 10. Selecting which dependency to containerize

Just because you *can* spin a real Kafka does not mean every test should.
Heuristic:

- Test the thing your code talks to directly. If you wrap a Kafka producer
  behind an interface, unit-test the wrapper with a fake, integration-test
  the producer-to-broker boundary.
- Containerize anything where your code generates SQL, queries, or wire
  protocol that the fake might not validate.
- Skip containerizing pure HTTP services you control — `httptest` is
  faster and gives you matchers.

## 11. Putting it together — sample test

```go
//go:build integration

package store

func TestUserRepo_DuplicateName(t *testing.T) {
    t.Parallel()

    db := newTestDB(t)
    repo := &UserRepo{DB: db}

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    if _, err := repo.Insert(ctx, User{Name: "ann"}); err != nil {
        t.Fatal(err)
    }
    _, err := repo.Insert(ctx, User{Name: "ann"})
    if !errors.Is(err, ErrDuplicate) {
        t.Fatalf("want ErrDuplicate, got %v", err)
    }
}
```

Every primitive on this page is in play: build tag, parallel, fresh
database, context with deadline, structured error checking. If you can
write this pattern reliably, you are at solid mid-level integration
testing in Go.

## 12. Recap

- `TestMain` for one-time expensive setup.
- Fresh database per test using `CREATE DATABASE ... TEMPLATE template`.
- Transactional fixtures when commit semantics are not required.
- `t.Parallel()` is safe once tests are isolated.
- Bounded polling beats `time.Sleep`.
- Containerize the dependency your code directly hits; fake the rest.

The Senior page extends these ideas to Kafka, Redis, parallel containers
across packages, and CI-specific tuning.

## 13. The full lifecycle in one diagram

For visual learners, here is the lifecycle of an integration test in a
package that uses `TestMain` + database-per-test:

```
[ go test -tags=integration ./store/... ]
            |
            v
[ TestMain entry ]
            |
            v
[ Start Postgres container (3s, once) ]
            |
            v
[ Apply migrations into template DB ]
            |
            v
[ Set package var adminDSN ]
            |
            v
[ m.Run() ]
   |              |              |
   v              v              v
[ TestA ]    [ TestB ]    [ TestC ]
   |              |              |
   v              v              v
[ CREATE   [ CREATE   [ CREATE
   DB A ]      DB B ]      DB C ]
   |              |              |
   v              v              v
[ run test ][ run test ][ run test ]
   |              |              |
   v              v              v
[ Cleanup:  [ Cleanup:  [ Cleanup:
   DROP DB ]  DROP DB ]  DROP DB ]
            \      |      /
             v     v     v
            [ all tests done ]
                  |
                  v
[ Terminate container ]
                  |
                  v
[ os.Exit(code) ]
```

Visualising the flow helps when something fails mid-lifecycle — knowing
where you are in the sequence narrows the search for the bug.

## 14. Pre-applied migrations via Postgres template database

A trick that saves several seconds per package: run migrations once
into a `template` database and let each test do
`CREATE DATABASE testN TEMPLATE template`. Postgres copies the schema
in milliseconds, far cheaper than re-running migrations.

```go
func TestMain(m *testing.M) {
    ctx := context.Background()
    pg, err := postgres.Run(ctx, "postgres:16-alpine",
        postgres.WithDatabase("template"),
        postgres.BasicWaitStrategies())
    if err != nil { log.Fatal(err) }
    defer pg.Terminate(ctx)

    adminDSN, _ = pg.ConnectionString(ctx, "sslmode=disable")
    admin = mustOpen(adminDSN)

    // Apply migrations once.
    if err := applyMigrations(admin); err != nil {
        log.Fatalf("migrate: %v", err)
    }

    code := m.Run()
    _ = admin.Close()
    _ = pg.Terminate(ctx)
    os.Exit(code)
}

func newTestDB(t *testing.T) *sql.DB {
    name := "t_" + randSuffix()
    if _, err := admin.Exec("CREATE DATABASE " + name + " TEMPLATE template"); err != nil {
        t.Fatalf("create db: %v", err)
    }
    t.Cleanup(func() {
        _, _ = admin.Exec("DROP DATABASE " + name + " WITH (FORCE)")
    })
    return mustOpen(strings.Replace(adminDSN, "/template", "/"+name, 1))
}
```

Caveats:

- The template database cannot be in use when you copy from it. Make
  sure no connections target the template; close them after migration.
- `CREATE DATABASE ... TEMPLATE` does not work concurrently against the
  same template — Postgres serializes. For very parallel suites,
  pre-create N copies upfront.

## 15. Handling test ordering and dependencies

Tests should not depend on each other. The Go test runner shuffles
order via `-shuffle=on`; CI should always use that flag.

A common bug: test A inserts a row and test B reads it without
inserting first. The pair works when A runs before B (default order),
fails when order shuffles. Symptoms: occasional CI red, flaky
diagnoses.

Fix: every test arranges its own data. If two tests need the same
fixture, both should call the factory:

```go
func TestRepo_FindByEmail(t *testing.T) {
    db := newTestDB(t)
    repo := &UserRepo{DB: db}
    factories.User(t, db, factories.Email("ann@example.com"))

    got, err := repo.FindByEmail(context.Background(), "ann@example.com")
    if err != nil { t.Fatal(err) }
    if got.Email != "ann@example.com" { t.Fatalf("got %q", got.Email) }
}
```

The factory inserts the row. No reliance on other tests.

## 16. Detecting cleanup leaks

Add a check at the end of `TestMain` that warns if any test left a
database behind:

```go
code := m.Run()
leaks, _ := listLeakedDatabases(admin)
if len(leaks) > 0 {
    log.Printf("WARNING: leaked test databases: %v", leaks)
    for _, name := range leaks {
        _, _ = admin.Exec("DROP DATABASE " + name + " WITH (FORCE)")
    }
}
os.Exit(code)
```

`listLeakedDatabases` runs `SELECT datname FROM pg_database WHERE datname
LIKE 't\_%'`. Warnings can become failures once the team is confident in
cleanup discipline.

## 17. Testing concurrent code paths

Integration tests are an excellent place to catch concurrency bugs
because they exercise real I/O timing. A pattern:

```go
func TestRepo_ConcurrentInsert(t *testing.T) {
    db := newTestDB(t)
    repo := &UserRepo{DB: db}

    const N = 50
    var wg sync.WaitGroup
    errCh := make(chan error, N)
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            _, err := repo.Insert(context.Background(), User{
                Name: fmt.Sprintf("user-%d", i),
            })
            errCh <- err
        }(i)
    }
    wg.Wait()
    close(errCh)

    for err := range errCh {
        if err != nil { t.Errorf("insert: %v", err) }
    }

    var n int
    if err := db.QueryRow(`SELECT count(*) FROM users`).Scan(&n); err != nil {
        t.Fatal(err)
    }
    if n != N { t.Fatalf("got %d rows, want %d", n, N) }
}
```

This pattern has caught real bugs like missing `defer rows.Close()` in
production code that leaked connections under concurrency. A unit test
with a mocked `*sql.DB` would never have caught it.

## 18. Testing transactional behaviour

Some bugs only surface across transactions. Example: a function that
updates two tables should roll back both on error.

```go
func TestService_Transfer_RollsBackOnError(t *testing.T) {
    db := newTestDB(t)
    svc := New(db)

    factories.Account(t, db, factories.Balance(100), factories.ID(1))
    factories.Account(t, db, factories.Balance(50),  factories.ID(2))

    // Force the second update to fail by violating a constraint.
    err := svc.Transfer(context.Background(), 1, 2, -200) // invalid amount
    if err == nil { t.Fatal("expected error") }

    // Both balances must be unchanged.
    if b := getBalance(t, db, 1); b != 100 {
        t.Errorf("account 1: got %d, want 100", b)
    }
    if b := getBalance(t, db, 2); b != 50 {
        t.Errorf("account 2: got %d, want 50", b)
    }
}
```

Unit tests with mocks rarely catch this; the mocked transaction does
what you tell it. The real database enforces ACID and reveals the bug
within milliseconds.

## 19. Connection pool sizing

`*sql.DB` is a pool. Defaults are aggressive:

- `MaxOpenConns`: 0 (unlimited).
- `MaxIdleConns`: 2.
- `ConnMaxLifetime`: 0 (forever).

In production an unlimited pool plus many goroutines can exhaust
Postgres's `max_connections` (default 100). In tests the same problem
shows up when parallel tests each open many connections.

Set sensible limits in your repository or harness:

```go
db.SetMaxOpenConns(10)
db.SetMaxIdleConns(2)
db.SetConnMaxLifetime(time.Hour)
```

## 20. Debugging failed integration tests

When a test fails in CI:

1. Read the `-v` output around the failure. The line number names the
   assertion.
2. Re-run locally with the same seed: `TEST_SEED=<value> go test -run
   TestX -count=1 -tags=integration ./...`.
3. Add temporary `t.Logf` lines around suspicious code. They appear
   only on `-v` or failure.
4. If the container behaves oddly, dump its logs:

   ```go
   t.Cleanup(func() {
       r, _ := pg.Logs(ctx)
       defer r.Close()
       b, _ := io.ReadAll(r)
       t.Logf("postgres logs:\n%s", b)
   })
   ```

5. If the failure repeats locally, narrow until you find a minimal
   reproducer. Then fix or report.

## 21. Antipatterns to avoid at this level

- A single `*sql.DB` shared across all tests and packages. Connection
  pool tuning gets impossible.
- Using `t.Run` for repeated test cases without `t.Parallel()` —
  serializes tests that could overlap.
- Migrations re-applied per test instead of via template database.
- `os.Setenv` instead of `t.Setenv`. State leaks between tests.
- A retry loop around the entire test body to hide an underlying race.

A code review checklist with these items keeps the suite healthy as it
grows.

## 22. Working with subtests

`t.Run` creates a subtest. Subtests inherit cleanups from their parent
but have their own `*testing.T`. They show up in failure messages with
slash-separated names: `TestUserRepo/duplicate`.

```go
func TestUserRepo(t *testing.T) {
    db := newTestDB(t)
    repo := &UserRepo{DB: db}

    t.Run("insert_returns_id", func(t *testing.T) {
        id, err := repo.Insert(ctx, User{Name: "ann"})
        if err != nil { t.Fatal(err) }
        if id == 0 { t.Fatal("zero id") }
    })

    t.Run("duplicate_returns_error", func(t *testing.T) {
        _, _ = repo.Insert(ctx, User{Name: "bob"})
        _, err := repo.Insert(ctx, User{Name: "bob"})
        if err == nil { t.Fatal("want error") }
    })
}
```

Subtests can run in parallel within their parent via `t.Parallel()` on
each, but the parent must be sequential at the top level if subtests
share state.

Caveat: cleanups registered in the parent run after all subtests
finish, not between them. If subtests must start clean, give each its
own database via the same helper that the parent used.

## 23. Filtering tests

`go test -run` accepts a regular expression. To run only the duplicate
subtest:

```bash
go test -tags=integration -run 'TestUserRepo/duplicate' ./store/...
```

To run all tests whose name contains "Concurrent":

```bash
go test -tags=integration -run 'Concurrent' ./...
```

Use this during debugging to skip slow tests you do not care about.

## 24. Stopping at the first failure

`-failfast` exits the run on the first failure. Useful when chasing a
specific bug:

```bash
go test -tags=integration -failfast -shuffle=on -count=10 ./...
```

The above shuffles, repeats ten times, stops at the first red. A good
flake hunter's hammer.

## 25. Closing the gap with senior

Once you can confidently write `TestMain`, transactional fixtures,
fresh-per-test databases, parallel-safe assertions and rich cleanups,
you have a mid-level integration testing skill set in Go. The Senior
page adds Kafka, Redis, multi-container topologies, deterministic
seeds, and CI tuning at scale.

Practice tip: refactor one of your existing services to use the
patterns from this page. The first refactor is slow (an afternoon).
The second is fast (an hour). By the fourth or fifth you are applying
the patterns reflexively, which is the goal.

## 26. Sample harness file

A small `internal/testenv/pg.go` distilling everything above:

```go
package testenv

import (
    "context"
    "database/sql"
    "log"
    "strings"
    "sync"
    "testing"

    _ "github.com/jackc/pgx/v5/stdlib"
    "github.com/testcontainers/testcontainers-go/modules/postgres"
)

var (
    once     sync.Once
    adminDSN string
    admin    *sql.DB
    pgRef    *postgres.PostgresContainer
)

func startPG() {
    ctx := context.Background()
    pg, err := postgres.Run(ctx, "postgres:16-alpine",
        postgres.WithDatabase("template"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"),
        postgres.BasicWaitStrategies())
    if err != nil { log.Fatalf("postgres: %v", err) }
    pgRef = pg

    adminDSN, _ = pg.ConnectionString(ctx, "sslmode=disable")
    admin, _ = sql.Open("pgx", adminDSN)

    if err := applyMigrations(admin); err != nil {
        log.Fatalf("migrate: %v", err)
    }
}

// FreshDB returns a brand-new database for the calling test.
// Drop happens at t.Cleanup.
func FreshDB(t *testing.T) *sql.DB {
    once.Do(startPG)
    name := "t_" + randSuffix()
    if _, err := admin.Exec("CREATE DATABASE " + name + " TEMPLATE template"); err != nil {
        t.Fatalf("create db: %v", err)
    }
    t.Cleanup(func() {
        _, _ = admin.Exec("DROP DATABASE " + name + " WITH (FORCE)")
    })
    dsn := strings.Replace(adminDSN, "/template", "/"+name, 1)
    db, err := sql.Open("pgx", dsn)
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { _ = db.Close() })
    return db
}
```

Tests now reduce to a single call:

```go
func TestX(t *testing.T) {
    t.Parallel()
    db := testenv.FreshDB(t)
    // ...
}
```

This is the mid-level harness in one screen of code. Senior teams
extend it with Redis, Kafka and the rest, but the shape stays the
same.

## 27. Database isolation strategies compared

A summary table of the three database isolation strategies introduced
on this page:

| Strategy              | Setup cost | Per-test cost | Caveats                          |
|-----------------------|------------|---------------|----------------------------------|
| Container per test    | 3 s        | 3 s           | Slowest; rarely justified        |
| Database per test     | 3 s once   | 30 ms         | Default for most write-heavy tests |
| Template + COPY       | 3 s + migr | 50 ms         | Fastest schema-rich setup        |
| Transaction per test  | 3 s once   | 5 ms          | Read-only or rollbackable only   |

Pick by writeability. Read-only tests use transactions. Write tests
use database per test (preferably from a template). Tests that exercise
a feature requiring real `COMMIT` behaviour (triggers fired only on
commit, asynchronous after-commit hooks) get their own database too.

## 28. Schema management options

Two patterns coexist for applying schema:

- **Migration tool, run in test.** Imports `golang-migrate/migrate`, runs
  the same migrations production uses. Maximum realism.
- **`init.sql` file injected via container files.** Postgres runs files
  under `/docker-entrypoint-initdb.d/` on first startup. Simple but
  bypasses your migration history.

For long-lived projects with versioned migrations, choose the migration
tool. The integration tests then double as migration tests — if a
migration fails to apply in CI, you find out before deploying.

```go
import (
    "github.com/golang-migrate/migrate/v4"
    _ "github.com/golang-migrate/migrate/v4/source/file"
    mpostgres "github.com/golang-migrate/migrate/v4/database/postgres"
)

func applyMigrations(db *sql.DB) error {
    driver, err := mpostgres.WithInstance(db, &mpostgres.Config{})
    if err != nil { return err }
    m, err := migrate.NewWithDatabaseInstance(
        "file://../../migrations", "postgres", driver)
    if err != nil { return err }
    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return err
    }
    return nil
}
```

The same code path runs in production via `make migrate-up`.

## 29. Reading the right error type

When tests assert on database errors, use `errors.Is` with sentinel
errors from your own package, not raw `sql.ErrNoRows` or pgx-specific
errors. Otherwise consumers of your repository cannot test against the
sentinel either.

```go
var ErrNotFound = errors.New("not found")

func (r *UserRepo) Get(ctx context.Context, id int64) (User, error) {
    var u User
    err := r.DB.QueryRowContext(ctx, ...).Scan(...)
    if errors.Is(err, sql.ErrNoRows) {
        return User{}, ErrNotFound
    }
    return u, err
}
```

Tests then assert on `ErrNotFound`:

```go
_, err := repo.Get(ctx, 99999)
if !errors.Is(err, store.ErrNotFound) {
    t.Fatalf("want ErrNotFound, got %v", err)
}
```

This pattern matters for two reasons: it decouples the test from the
driver, and it forces you to design the repository's error surface.

## 30. Concurrency safety inside the harness

If `FreshDB` is called from many parallel tests, the underlying admin
connection is shared. `database/sql` handles this internally — every
`Exec` borrows a connection from the pool, returns it. As long as
`admin.SetMaxOpenConns` is generous enough, parallel `CREATE DATABASE`
statements succeed.

A gotcha: `CREATE DATABASE ... TEMPLATE template` does not work
concurrently against the same template. Postgres serializes those
statements. Symptom: occasional `source database is being accessed by
other users`. Mitigate by serializing within the harness:

```go
var copyMu sync.Mutex

func FreshDB(t *testing.T) *sql.DB {
    once.Do(startPG)
    copyMu.Lock()
    _, err := admin.Exec("CREATE DATABASE ...")
    copyMu.Unlock()
    ...
}
```

A small mutex around the create call costs nothing in tests because the
operation itself is fast.

## 31. Putting yourself on a track for senior

The Middle page covers everything a productive squad member needs to
write reliable, parallel-safe, fast integration tests in Go. The
Senior page extends to multi-service flows, deterministic harness
design, CI tuning, and observability.

If you can write a test using the harness in Section 26, with all the
discipline of Sections 21-23, you are ready for the Senior material.
Skim the Senior page to see what is next; come back to write a
real-world test using the new patterns; iterate.

A working professional habit: every two weeks, pick one integration
test and refactor it to use the latest pattern from this page. Over
six months your suite naturally migrates without a big-bang rewrite.

## 32. Database-per-test deep dive

We have used `CREATE DATABASE testN TEMPLATE template` casually. Worth
unpacking what Postgres actually does and where the costs live.

When you issue `CREATE DATABASE foo TEMPLATE template`, Postgres:

1. Acquires an exclusive lock on `pg_database`.
2. Copies the template's files on disk to the new database's location.
3. Updates system catalogs.
4. Returns success.

The copy is byte-for-byte at the filesystem level. With a small empty
schema (few tables, no data), it takes 20-30 ms. With a 100 MB
template, it can take 200 ms or more.

If your template grows large because tests insert reference data via
migrations, consider trimming what lives in the template versus what
lives in factories.

A subtle gotcha: Postgres locks the template during copy. Concurrent
`CREATE DATABASE ... TEMPLATE template` against the same template
serialize. For very parallel suites, you may pre-create N copies and
hand them out round-robin.

## 33. SAVEPOINT-based fixtures

A finer-grained alternative to transactional fixtures: use SAVEPOINTs.
A test opens an outer transaction, then for each subtest sets a
savepoint and rolls back to it. Each subtest gets a fresh state with
just one round trip.

```go
func setup(t *testing.T, db *sql.DB) DBTX {
    t.Helper()
    tx, _ := db.Begin()
    t.Cleanup(func() { _ = tx.Rollback() })
    return tx
}

func TestUser(t *testing.T) {
    tx := setup(t, db)
    t.Run("insert", func(t *testing.T) {
        _, err := tx.Exec("SAVEPOINT sp")
        if err != nil { t.Fatal(err) }
        t.Cleanup(func() { _, _ = tx.Exec("ROLLBACK TO sp") })
        // ... test body
    })
}
```

Works well when subtests share setup but need rollback boundaries.
Less common than full fresh databases; mention in code review when you
spot a fit.

## 34. Schema versioning in tests

If you support multiple production schema versions in parallel (during
a rolling deployment), integration tests should run against each. A
parameterized test:

```go
func TestRepo_AcrossVersions(t *testing.T) {
    for _, version := range []string{"v23", "v24", "v25"} {
        t.Run(version, func(t *testing.T) {
            db := newTestDBAtVersion(t, version)
            // ... assertions
        })
    }
}
```

`newTestDBAtVersion` applies migrations up to the named version,
exercising the upgrade path that production will follow.

## 35. Read-replica simulation

Production reads often hit read replicas with eventual consistency.
Tests can simulate this by injecting a small delay on read-only
connections:

```go
type laggingDB struct{ *sql.DB; lag time.Duration }

func (d *laggingDB) QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row {
    time.Sleep(d.lag)
    return d.DB.QueryRowContext(ctx, q, args...)
}
```

Tests that assert "reader sees writer's update within 100ms" become
deterministic.

## 36. Final practice exercise

Build a small project that uses every pattern from this page:

- `TestMain` with shared Postgres.
- Template database with migrations applied.
- Database-per-test via TEMPLATE copy.
- `t.Parallel()` on every test.
- Factories for fixtures.
- Sentinel errors checked with `errors.Is`.
- Subtests where they help.
- Connection pool sized appropriately.
- Cleanup discipline; no leaks after the run.

Time-box it to four hours. The result is a working harness you can
fork into real projects on day one.

## 37. Test naming conventions

A senior team has conventions for test names:

- `TestType_Method_Behaviour`. Example:
  `TestUserRepo_Insert_ReturnsErrDuplicateOnConflict`.
- For subtests, use `snake_case_descriptors`. Example: `t.Run(
  "fails_on_duplicate_email", ...)`.
- For benchmarks, mirror the test pattern: `BenchmarkUserRepo_Insert`.

When CI reports a failure, the name alone should communicate the
expectation. Reviewers should be able to skim a test file's `t.Run`
calls and understand the behaviours covered without reading bodies.

## 38. Subtest-vs-table-test trade-off

Two ways to express variants of a test:

**Subtests:**

```go
t.Run("missing_field", func(t *testing.T) {
    _, err := svc.Do(in{Field: ""})
    if err == nil { t.Fatal("want error") }
})
t.Run("happy_path", func(t *testing.T) {
    _, err := svc.Do(in{Field: "x"})
    if err != nil { t.Fatal(err) }
})
```

**Table-driven:**

```go
cases := []struct {
    name string
    in   in
    err  error
}{
    {"missing_field", in{Field: ""}, ErrMissing},
    {"happy_path", in{Field: "x"}, nil},
}
for _, c := range cases {
    t.Run(c.name, func(t *testing.T) {
        _, err := svc.Do(c.in)
        if !errors.Is(err, c.err) {
            t.Fatalf("got %v, want %v", err, c.err)
        }
    })
}
```

Use table-driven when cases differ only in parameters. Use plain
subtests when each case requires its own setup or assertions.

## 39. The `t.Run` capture trap

A subtle bug:

```go
for _, c := range cases {
    t.Run(c.name, func(t *testing.T) {
        t.Parallel()
        if got := f(c.in); got != c.want { /* ... */ }
    })
}
```

Before Go 1.22, the loop variable `c` was reused; parallel subtests
all saw the last value. Mitigation: shadow the variable inside the
loop (`c := c`). Go 1.22+ scopes loop variables per iteration, so the
bug disappears. If your module targets older Go, keep the shadow.

A senior team's lint rules catch this automatically.

## 40. Sample CI configuration for middle level

A complete `.github/workflows/integration.yml`:

```yaml
name: integration

on:
  pull_request:
  push:
    branches: [main]

jobs:
  integration:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
          cache: true
      - name: Run integration tests
        run: |
          go test -tags=integration \
            -race -shuffle=on -timeout=10m \
            -coverprofile=cover.out \
            ./...
      - uses: codecov/codecov-action@v4
        with:
          files: cover.out
```

What this does:

- Single Ubuntu runner with Docker available.
- Go module cache via `actions/setup-go`.
- Race detector, shuffled order, 10-minute timeout.
- Coverage report uploaded to Codecov.

A team adopting this template should clear the middle level within
weeks.

## 41. Where to start when adopting this section

If you arrive at this section with no integration tests in your codebase:

1. Day 1: read Junior and Middle. Write one test against Postgres for
   one repository.
2. Day 2: write the rest of that repository's tests. Configure CI.
3. Week 1: build a small `testenv` package. Refactor the existing
   tests to use it.
4. Week 2: cover the next service.
5. Month 1: ten services covered. Decide which patterns from Senior
   start paying back.

Incremental adoption beats big-bang every time.

## 42. Anti-pattern: shared package-level connection

```go
var sharedDB *sql.DB

func TestA(t *testing.T) {
    _, _ = sharedDB.Exec("INSERT INTO users...")
}

func TestB(t *testing.T) {
    _, _ = sharedDB.Exec("INSERT INTO users...")
}
```

Both tests touch the same database; running them in parallel produces
data interleaving. The fix is the harness pattern: a helper that gives
each test its own isolated database or transaction.

## 43. Anti-pattern: production credentials in tests

```go
db, _ := sql.Open("pgx", os.Getenv("PROD_DATABASE_URL"))
```

Never. Tests must point at a locally-managed dependency. Even
read-only access to production from a test process is a security
red flag. A reviewer should reject the PR.

## 44. Anti-pattern: HTTP integration tests that hit the real internet

```go
resp, _ := http.Get("https://api.thirdparty.com/data")
```

The test now depends on network reachability, the third party's
uptime, and rate limits. Use `httptest.NewServer` with a stub
handler or run a containerized fake.

## 45. Recap of recap

This page repeated some points across sections. Repetition is
intentional — these patterns are the ones engineers most often skip
on review. Internalizing them prevents the bulk of integration test
bugs in Go codebases.

When in doubt:

- Build tag.
- Cleanup after allocation.
- Isolation per test.
- Wait strategy, never sleep.
- Context with deadline.
- Sentinel errors via `errors.Is`.

Six rules. Tape them to the wall above your monitor.

## 46. Worked refactor — before and after

To close, a small but realistic refactor that applies every Middle
pattern to an existing test.

**Before** (representative of what a junior engineer might write):

```go
//go:build integration

func TestUserRepo_Insert(t *testing.T) {
    ctx := context.Background()
    pg, _ := postgres.Run(ctx, "postgres:16-alpine")
    defer pg.Terminate(ctx)
    dsn, _ := pg.ConnectionString(ctx, "sslmode=disable")
    db, _ := sql.Open("pgx", dsn)
    db.Exec(`CREATE TABLE users(id BIGSERIAL PRIMARY KEY, name TEXT)`)
    var id int64
    db.QueryRow(`INSERT INTO users(name) VALUES($1) RETURNING id`, "ann").Scan(&id)
    if id == 0 { t.Fatal("zero id") }
}
```

Problems: errors discarded, defer instead of cleanup, no context
deadline, fresh container per test, no parallel marker.

**After:**

```go
//go:build integration

func TestUserRepo_Insert(t *testing.T) {
    t.Parallel()
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    db := testenv.FreshDB(t)
    repo := &UserRepo{DB: db}

    id, err := repo.Insert(ctx, User{Name: "ann"})
    if err != nil { t.Fatal(err) }
    if id == 0 { t.Fatal("zero id") }
}
```

Same coverage, shorter, isolated, parallel-safe, leak-free. This is
the Middle-level destination for every integration test in the suite.

## 47. End of middle

The patterns covered here scale to small and medium codebases without
strain. When the suite grows past a few hundred tests, move on to the
Senior page for the additional discipline that scale demands.

Practice these patterns until they are automatic. The Senior material
builds on them.

A productive habit: at the end of every sprint, pick one integration
test from your code base and review it against the patterns in this
page. If it falls short, refactor it. Five minutes per sprint adds
up to a healthier suite over a year.

The Senior page awaits when you are ready.
