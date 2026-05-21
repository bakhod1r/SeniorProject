---
layout: default
title: Integration Tests — Junior
parent: Integration Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/13-integration-tests/junior/
---

# Integration Tests — Junior

[← Back](../)

This page walks through your first integration tests in Go. By the end
you will have a small HTTP service plus a database-backed repository, both
covered by tests that touch real I/O — and you will know how to keep
those tests out of the fast unit suite.

## 1. What we already know about `testing`

`go test` runs every `func TestXxx(t *testing.T)` in `*_test.go` files. It
discovers files in the same package (or a `_test` package next door). For
unit tests this is enough: no flags, no setup, sub-second runtime. You
write a function, the runner finds it, calls it, reports pass or fail.

Integration tests follow the same shape. The difference is what they
*touch* — sockets, files, processes — and the conventions we follow so we
do not accidentally run them on a laptop without Docker.

Three things change at the integration tier:

- The test starts something heavy (a server, a database).
- The test waits for that thing to become ready.
- The test cleans up at the end, no matter what happened in the middle.

The Go testing package supports all three through `t.Cleanup`, the
`net/http/httptest` helpers, and the wider ecosystem.

## 2. Our first integration test — `httptest.Server`

We will start with the friendliest dependency: an in-process HTTP server.
`net/http/httptest` ships with the standard library and needs no extra
packages.

```go
// file: api/health.go
package api

import (
    "encoding/json"
    "net/http"
)

func HealthHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}
```

```go
// file: api/health_integration_test.go
//go:build integration

package api

import (
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestHealth(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(HealthHandler))
    t.Cleanup(srv.Close)

    resp, err := http.Get(srv.URL)
    if err != nil {
        t.Fatalf("GET failed: %v", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        t.Fatalf("want 200, got %d", resp.StatusCode)
    }

    var body struct{ OK bool `json:"ok"` }
    if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
        t.Fatal(err)
    }
    if !body.OK {
        t.Fatal("expected ok=true")
    }
}
```

Three details worth noticing:

1. `//go:build integration` at the top of the file. Without
   `-tags=integration`, `go test ./...` skips this file. That keeps the
   fast unit suite fast.
2. `httptest.NewServer` listens on a random port (`127.0.0.1:0`). No
   hard-coded `:8080` to clash with another suite running concurrently.
3. `t.Cleanup(srv.Close)` schedules teardown. Even if a later assertion
   calls `t.Fatal`, the server still closes.

Run it two ways:

```bash
go test ./api/...                         # skipped, file not compiled
go test -tags=integration ./api/...       # runs the integration test
```

The first command finishes in milliseconds. The second one starts the
HTTP server, executes the GET, and prints `PASS`. The behaviour you want
on every developer's machine.

## 3. Why the build tag matters

A standard Go test binary built without `-tags=integration` ignores any
file whose top contains `//go:build integration`. The reasons are:

- CI without Docker (e.g. unit-only jobs) should not import packages that
  need Docker — saves build time and avoids confusing errors.
- Developers running `go test ./...` in their editor want sub-second
  feedback. Integration tests are seconds, sometimes minutes.
- Mixing both styles in the same file leaves no clean lever for skipping
  the slow ones.

The older `// +build integration` syntax is still accepted by `go build`
but the Go 1.17+ recommendation is `//go:build integration`. The file
ought to keep a blank line right after the tag and before the `package`
clause:

```go
//go:build integration

package api
```

The blank line is required. Without it `go vet` complains and the file's
build tag is silently treated as a comment.

You can compose tags: `//go:build integration && !race` excludes the file
from race-enabled builds. Use this only as a last resort — a flaky
race-detector test is a real bug.

## 4. A database-backed test using `testcontainers-go`

Now we will touch a real Postgres instance. The package
`github.com/testcontainers/testcontainers-go` (and its module
`github.com/testcontainers/testcontainers-go/modules/postgres`) wraps the
Docker daemon and exposes Go-friendly helpers.

```go
// file: store/user.go
package store

import (
    "context"
    "database/sql"
)

type User struct {
    ID   int64
    Name string
}

type UserRepo struct{ DB *sql.DB }

func (r *UserRepo) Insert(ctx context.Context, u User) (int64, error) {
    var id int64
    err := r.DB.QueryRowContext(ctx,
        `INSERT INTO users(name) VALUES($1) RETURNING id`, u.Name,
    ).Scan(&id)
    return id, err
}

func (r *UserRepo) Get(ctx context.Context, id int64) (User, error) {
    var u User
    err := r.DB.QueryRowContext(ctx,
        `SELECT id, name FROM users WHERE id=$1`, id,
    ).Scan(&u.ID, &u.Name)
    return u, err
}
```

```go
// file: store/user_integration_test.go
//go:build integration

package store

import (
    "context"
    "database/sql"
    "testing"
    "time"

    _ "github.com/jackc/pgx/v5/stdlib"
    "github.com/testcontainers/testcontainers-go"
    "github.com/testcontainers/testcontainers-go/modules/postgres"
    "github.com/testcontainers/testcontainers-go/wait"
)

func TestUserRepo_InsertAndGet(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
    defer cancel()

    pg, err := postgres.Run(ctx,
        "postgres:16-alpine",
        postgres.WithDatabase("app"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"),
        testcontainers.WithWaitStrategy(
            wait.ForLog("database system is ready to accept connections").
                WithOccurrence(2).
                WithStartupTimeout(30*time.Second)),
    )
    if err != nil {
        t.Fatalf("run postgres: %v", err)
    }
    t.Cleanup(func() { _ = pg.Terminate(ctx) })

    dsn, err := pg.ConnectionString(ctx, "sslmode=disable")
    if err != nil {
        t.Fatal(err)
    }

    db, err := sql.Open("pgx", dsn)
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { _ = db.Close() })

    if _, err := db.ExecContext(ctx,
        `CREATE TABLE users(id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL)`,
    ); err != nil {
        t.Fatal(err)
    }

    repo := &UserRepo{DB: db}
    id, err := repo.Insert(ctx, User{Name: "ann"})
    if err != nil {
        t.Fatal(err)
    }
    if id == 0 {
        t.Fatal("expected non-zero id")
    }

    got, err := repo.Get(ctx, id)
    if err != nil {
        t.Fatal(err)
    }
    if got.Name != "ann" {
        t.Fatalf("got %q", got.Name)
    }
}
```

Walk-through:

- `postgres.Run` starts the container. The variadic options set database
  name, username and password.
- `WithWaitStrategy` waits for a log line. Postgres prints "ready to
  accept connections" twice during startup; waiting for the second
  occurrence avoids racing the readiness signal.
- `ConnectionString` gives us a DSN like
  `postgres://test:test@127.0.0.1:54321/app?sslmode=disable`.
- We pin the driver with the side-effect import
  `_ "github.com/jackc/pgx/v5/stdlib"`.
- Every resource gets a `t.Cleanup` so even a `t.Fatal` in the middle
  leaves nothing behind.

The first time you run this, Docker pulls `postgres:16-alpine`. That can
take 30 seconds on a slow connection. Subsequent runs reuse the cached
image and start in ~3 seconds.

## 5. What happens without Docker?

If Docker is not running, `postgres.Run` returns an error. The test fails
with a clear message — better than hanging. To make the test gracefully
skip instead, check Docker availability at the start of `TestMain`:

```go
import "github.com/testcontainers/testcontainers-go"

func TestMain(m *testing.M) {
    if _, err := testcontainers.NewDockerProvider(); err != nil {
        log.Printf("docker unavailable: %v; skipping integration tests", err)
        os.Exit(0)
    }
    os.Exit(m.Run())
}
```

`os.Exit(0)` with a logged note treats absence of Docker as "nothing to
do" rather than a failure. For local development this is friendlier; in
CI you want the failure to bubble up because Docker should always be
available on the runner.

A more nuanced approach: skip if the environment variable
`SKIP_INTEGRATION` is set, fail otherwise.

```go
if os.Getenv("SKIP_INTEGRATION") != "" {
    log.Println("SKIP_INTEGRATION set; exiting")
    os.Exit(0)
}
```

Developers running `make test-unit` set the variable; CI does not.

## 6. Shared setup with `TestMain`

When several tests in a package each want a Postgres, paying the
container startup cost per test is wasteful. The standard pattern is to
start it once in `TestMain`, store the DSN in a package variable, and let
each test create its own database or transaction.

```go
var dsnTemplate string

func TestMain(m *testing.M) {
    ctx := context.Background()
    pg, err := postgres.Run(ctx, "postgres:16-alpine",
        postgres.WithDatabase("template"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"))
    if err != nil {
        log.Fatalf("postgres: %v", err)
    }
    defer pg.Terminate(ctx)

    dsnTemplate, _ = pg.ConnectionString(ctx, "sslmode=disable")
    os.Exit(m.Run())
}
```

Each `Test*` then calls `mustOpenFreshDB(t)` which `CREATE DATABASE`-s a
unique schema. We cover that pattern in the Middle page.

Important: `os.Exit` does not run deferred functions. The `defer
pg.Terminate(ctx)` above looks correct but does nothing — control never
returns from `os.Exit`. The fix is to terminate explicitly:

```go
code := m.Run()
_ = pg.Terminate(ctx)
os.Exit(code)
```

A subtle, easy mistake to copy-paste from outdated examples.

## 7. Cleanup discipline

A leaked Docker container holds memory, ports and disk space. Two rules
prevent leaks:

1. Register `t.Cleanup` *after* the resource is successfully created.
2. Use `_ = container.Terminate(ctx)` (ignore the error) — at cleanup
   time you cannot do much about it, and panicking would mask the real
   failure.

```go
c, err := redis.Run(ctx, "redis:7-alpine")
if err != nil {
    t.Fatal(err)               // no resource to clean
}
t.Cleanup(func() { _ = c.Terminate(ctx) })
```

If you put `t.Cleanup` before the error check, you would attempt to
terminate a nil container.

After a local run, list containers with `docker ps -a`. The only
containers visible should belong to other applications, not your tests.
If you see leftovers, the suite has a cleanup bug.

## 8. Common beginner mistakes

- Forgetting the build tag. Suddenly `go test ./...` takes 90 seconds
  and hangs on machines without Docker.
- Hard-coding ports like `127.0.0.1:8080`. Parallel tests collide.
- Using `time.Sleep` to wait for the server to be ready. Either it is
  too short (race) or too long (slow suite). Use a wait strategy.
- Ignoring the context. A frozen container or broken network can keep
  `http.Get` blocked forever. Wrap calls with `context.WithTimeout`.
- Writing to a shared schema with `t.Parallel()` enabled. The tests
  start failing in confusing orders.
- Allocating expensive resources in every test instead of in `TestMain`.
- Storing the resulting DSN in a global without a mutex when tests run
  in parallel — fine if you only write it once during `TestMain`.

## 9. Running with `-race`

Integration tests benefit from the data race detector too. The flag adds
overhead but catches genuine concurrency bugs in your wiring code:

```bash
go test -race -tags=integration ./...
```

Containers are unaffected; the race detector lives inside the test
process. Memory consumption rises by 5-10x, so on small CI runners you
might shard the race-enabled run.

If `-race` finds a real race in your test harness, do not paper over it
with a mutex. The race usually points at a structural issue — for
example, a shared `*sql.DB` that should be per-test.

## 10. Where to go next

- The Middle page covers `TestMain`, transactional fixtures and database-
  per-test patterns.
- The Senior page covers Kafka, Redis, parallel containers and CI
  tuning.
- The Find-the-bug page lists realistic mistakes to recognise on code
  review.

Practice: convert one of your existing unit tests that uses a mock
database into an integration test against a real container. Notice what
breaks — usually it is an assumption the mock allowed but the database
rejects. That is exactly the value an integration test provides.

A realistic example: a unit test asserts that the repository returns
`ErrNotFound` when the row is missing. The mock makes this trivial. The
integration test forces you to translate `sql.ErrNoRows` into your
domain error correctly — which is exactly the boundary a unit test
cannot cover.

## 11. Two-phase tests

A common pattern: arrange the world, act, assert. With integration tests
the arrange step often involves seeding data:

```go
func TestUserRepo_GetByName(t *testing.T) {
    ctx := context.Background()
    db := mustOpenFreshDB(t)
    repo := &UserRepo{DB: db}

    // Arrange
    if _, err := repo.Insert(ctx, User{Name: "ann"}); err != nil {
        t.Fatal(err)
    }
    if _, err := repo.Insert(ctx, User{Name: "bob"}); err != nil {
        t.Fatal(err)
    }

    // Act
    got, err := repo.GetByName(ctx, "ann")

    // Assert
    if err != nil {
        t.Fatal(err)
    }
    if got.Name != "ann" {
        t.Fatalf("got %q", got.Name)
    }
}
```

This shape stays readable as tests grow. When the arrange section gets
long, extract a factory function: `factories.User(t, db, opts...)`.

## 12. Subtests

`t.Run` creates a subtest that participates in `-v` output, can be
filtered by name, and inherits cleanups from its parent.

```go
func TestUserRepo(t *testing.T) {
    db := mustOpenFreshDB(t)
    repo := &UserRepo{DB: db}

    t.Run("insert", func(t *testing.T) {
        _, err := repo.Insert(context.Background(), User{Name: "ann"})
        if err != nil { t.Fatal(err) }
    })

    t.Run("get_missing", func(t *testing.T) {
        _, err := repo.Get(context.Background(), 99999)
        if !errors.Is(err, sql.ErrNoRows) {
            t.Fatalf("got %v", err)
        }
    })
}
```

Note: subtests share the parent's database in the example above. That is
fine if subtests do not stomp on each other; otherwise use a fresh DB
per subtest by moving the helper call inside `t.Run`.

## 13. Choosing test names

Use names that describe behaviour, not method names:

- Bad: `TestInsert`
- Good: `TestUserRepo_Insert_AssignsID`
- Better: `TestUserRepo_Insert_AssignsID_AndIsReadable`

When the test fails, the name should be enough to understand the failed
expectation without reading the body.

## 14. Reading the test output

Run with `-v` to see each test name and result:

```
=== RUN   TestHealth
--- PASS: TestHealth (0.01s)
=== RUN   TestUserRepo_InsertAndGet
--- PASS: TestUserRepo_InsertAndGet (3.42s)
PASS
ok      example.com/api  3.45s
```

The 3.42-second runtime above is dominated by container startup. After
the first run, the Docker image is cached and the same test runs in
roughly the same time — the database initialization, not the image
pull, is the long pole.

When a test fails, the output names the line:

```
=== RUN   TestUserRepo_InsertAndGet
    user_integration_test.go:42: want non-zero id, got 0
--- FAIL: TestUserRepo_InsertAndGet (3.10s)
```

Always read the line number first. Most failures are local; jumping to
the source line saves five minutes of guessing.

## 15. Comparing values

Beginners reach for `==` or `!=`. For complex types prefer
`reflect.DeepEqual` or, better, `cmp.Diff` from `github.com/google/go-cmp`:

```go
import "github.com/google/go-cmp/cmp"

if diff := cmp.Diff(want, got); diff != "" {
    t.Errorf("user mismatch (-want +got):\n%s", diff)
}
```

`cmp.Diff` returns a human-readable diff. Compared to `t.Fatalf("got
%+v, want %+v", got, want)`, the diff is far easier to read when the
struct has a dozen fields.

## 16. Testing error paths

A good integration test covers both the happy path and at least one
error path. For a database repository, that usually means:

```go
func TestUserRepo_DuplicateName(t *testing.T) {
    ctx := context.Background()
    db := mustOpenFreshDB(t)
    _, err := db.ExecContext(ctx,
        `ALTER TABLE users ADD CONSTRAINT users_name_unique UNIQUE(name)`)
    if err != nil { t.Fatal(err) }
    repo := &UserRepo{DB: db}

    if _, err := repo.Insert(ctx, User{Name: "ann"}); err != nil {
        t.Fatal(err)
    }
    _, err = repo.Insert(ctx, User{Name: "ann"})
    if err == nil {
        t.Fatal("want error on duplicate, got nil")
    }
}
```

A unit test with a mock could not catch a missing UNIQUE constraint;
the integration test exposes it immediately.

## 17. What integration tests do not replace

Integration tests do not replace:

- Unit tests, which run fast and isolate logic from I/O.
- Property tests, which generate inputs and check invariants.
- Benchmarks, which measure performance over time.
- End-to-end tests, which exercise the full deployment.

A healthy suite has all four. The integration tier sits between unit
and end-to-end, covering contracts with real infrastructure.

## 18. Helpful tools

- `gotestsum` — better output formatting, JUnit XML, JSON streams.
- `go-cmp` — readable diffs.
- `testify/require` — terser assertions (`require.NoError(t, err)`).
- `testify/assert` — non-fatal assertions for accumulating failures.
- `vektra/mockery` — when you do need mocks at the unit layer.

You will pick up these tools as you read other test suites. None are
required to write a correct integration test; they reduce friction.

## 19. Summary checklist

- File guarded with `//go:build integration`.
- Resources allocated with error checking and a `t.Cleanup` registered
  *after*.
- Random ports via `httptest.NewServer` or `:0` listeners.
- Context with timeout on every external call.
- Wait strategy on every container, never `time.Sleep`.
- Driver imported with side-effect import.
- DSN obtained from the container, not hard-coded.
- `go test -tags=integration -race ./...` passes locally.
- No leftover containers visible after `docker ps -a`.
- Subtests with `t.Run` keep failure messages descriptive.

If every box is ticked, you have written a junior-level integration test
the rest of the team will accept on review. Move on to the Middle page
to learn `TestMain` patterns, database-per-test isolation, transactional
fixtures and parallel-safe execution.

## 20. A complete first project

To consolidate, here is the directory layout of a minimal Go project
with both unit and integration tests:

```
example.com/users/
  go.mod
  go.sum
  Makefile
  api/
    health.go
    health_test.go              // unit test
    health_integration_test.go  // integration test
  store/
    user.go
    user_test.go                // unit test with sqlmock
    user_integration_test.go    // integration test against real PG
```

`Makefile` snippet:

```makefile
.PHONY: test-unit test-integration test

test-unit:
	go test -race ./...

test-integration:
	go test -race -tags=integration -timeout=5m ./...

test: test-unit test-integration
```

Typical workflow:

1. Write the feature.
2. Write a unit test that pins the logic. `make test-unit` runs in
   seconds.
3. Write an integration test that covers the I/O boundary.
   `make test-integration` runs in tens of seconds.
4. Commit, push, let CI run the same two targets.

## 21. Reflecting on what changed

Before reading this page, "test" probably meant a fast in-memory
assertion. Now you have a second tool: a slower, heavier test that
runs against real infrastructure and verifies things mocks cannot.

The mental model going forward: every external dependency in your code
deserves at least one integration test. Database drivers, HTTP clients,
queue producers — anything that crosses a boundary. The unit tests pin
the logic; the integration tests pin the wiring.

Practice on small, real services. Convert one repository at a time to
have both flavours. After half a dozen, the pattern is muscle memory.

## 22. Glossary

- **Build tag.** A constraint at the top of a Go file that decides
  whether the file is compiled. `//go:build integration` means "only
  compile when the build was invoked with `-tags=integration`".
- **`httptest.Server`.** A real HTTP server on a random port, started
  in-process. Standard library.
- **DSN.** Data source name; the connection string a database driver
  consumes. For Postgres,
  `postgres://user:pass@host:port/db?sslmode=disable`.
- **`testcontainers-go`.** A library that wraps the Docker daemon and
  exposes typed helpers for starting common services.
- **`TestMain`.** A function `func TestMain(m *testing.M)` that, when
  present, runs instead of jumping straight into `Test*` functions.
  Use it for one-time setup.
- **Wait strategy.** A condition the test waits on before deciding the
  container is ready. Common ones: TCP probe, log line, SQL ping.
- **Cleanup.** A function registered with `t.Cleanup` that runs at test
  end, even after `t.Fatal`.

Refer to the glossary when later pages use these terms without
re-explaining them.

## 23. Where each concept lives in the stdlib

| Concept              | Package               | Symbol                |
|----------------------|-----------------------|-----------------------|
| Run tests            | testing               | `(*T)`, `(*M)`        |
| Schedule cleanup     | testing               | `(*T).Cleanup`        |
| HTTP test server     | net/http/httptest     | `NewServer`           |
| Listen on `:0`       | net                   | `Listen`              |
| Context with timeout | context               | `WithTimeout`         |
| JSON decode          | encoding/json         | `NewDecoder`          |

Everything in the table is in the standard library. You do not need a
third-party dependency to write your first integration tests.

## 24. Final practice

Take the `UserRepo` from Section 4. Add a `Delete(ctx, id)` method.
Write an integration test that:

- Inserts a user.
- Calls `Delete`.
- Asserts `Get` returns `sql.ErrNoRows`.

Run with `-tags=integration -race`. The test should pass first try if
your `Delete` is correct. If it fails, the failure message tells you
whether the bug is in `Delete` or your `Get` error mapping. Either way,
you now know where to fix it.

Welcome to integration testing in Go.

## 25. Deep dive — wait strategies

We mentioned wait strategies briefly. They deserve their own section
because flaky tests caused by missing wait strategies are the single
most common beginner mistake.

The `testcontainers-go/wait` package exposes several primitives:

```go
import "github.com/testcontainers/testcontainers-go/wait"

// Wait for a TCP port to accept connections.
wait.ForListeningPort("5432/tcp")

// Wait for a specific log line.
wait.ForLog("ready to accept connections")

// Wait for a log line that appears N times.
wait.ForLog("ready").WithOccurrence(2)

// Wait for an HTTP endpoint to return 200.
wait.ForHTTP("/health").WithPort("8080/tcp").WithStatusCodeMatcher(
    func(status int) bool { return status == 200 },
)

// Wait until a SQL driver can SELECT 1.
wait.ForSQL("5432/tcp", "pgx", func(host string, p nat.Port) string {
    return fmt.Sprintf("postgres://test:test@%s:%s/test?sslmode=disable",
        host, p.Port())
})
```

How to pick:

- **TCP port.** Cheapest, but accepts a connection before the server is
  truly ready. Use only when the server has no readiness signal.
- **Log line.** Reliable when the image prints a known string. Watch
  out for log line changes between image versions.
- **HTTP probe.** Best when the container exposes a health endpoint.
- **SQL ping.** The most accurate for databases — the driver verifies a
  query actually executes.

For Postgres, prefer `wait.ForSQL` or the `postgres.BasicWaitStrategies`
helper, which combines a log probe with a SQL ping.

## 26. Deep dive — environment variables

`testcontainers-go` lets you pass environment variables to a container:

```go
req := testcontainers.ContainerRequest{
    Image: "redis:7-alpine",
    ExposedPorts: []string{"6379/tcp"},
    Env: map[string]string{
        "REDIS_PASSWORD": "test",
    },
    WaitingFor: wait.ForListeningPort("6379/tcp"),
}
```

For module helpers, the options act as typed wrappers:

```go
pg, _ := postgres.Run(ctx, "postgres:16-alpine",
    postgres.WithDatabase("app"),
    postgres.WithUsername("test"),
    postgres.WithPassword("test"))
```

`WithDatabase` sets `POSTGRES_DB`, `WithUsername` sets `POSTGRES_USER`,
and so on. The module hides the env-var spelling so a future Postgres
image rename does not break your tests.

## 27. Deep dive — files and bind mounts

Sometimes you want the container to see a file from the host — for
example, a SQL seed file or a TLS cert.

```go
req := testcontainers.ContainerRequest{
    Image: "postgres:16-alpine",
    Files: []testcontainers.ContainerFile{
        {
            HostFilePath:      "./testdata/init.sql",
            ContainerFilePath: "/docker-entrypoint-initdb.d/init.sql",
            FileMode:          0o644,
        },
    },
}
```

For Postgres, files dropped into `/docker-entrypoint-initdb.d/` run on
first startup. Use this for one-time schema bootstrap when you do not
want to invoke a migration tool from Go.

The `Files` field is preferred over `Mounts` for small files because it
works on every Docker driver including Docker Desktop on macOS, where
bind mounts are slow.

## 28. Deep dive — context cancellation

Every container method takes a `context.Context`. Pass one with a
deadline so a stuck Docker daemon does not freeze your test:

```go
ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
defer cancel()
pg, err := postgres.Run(ctx, "postgres:16-alpine", ...)
```

If the context expires before the container is ready, `postgres.Run`
returns an error wrapping `context.DeadlineExceeded`. The test fails
fast instead of hanging on CI.

Cancellation also matters for cleanup:

```go
t.Cleanup(func() {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    _ = pg.Terminate(ctx)
})
```

The original `ctx` passed to `Run` may already be cancelled at cleanup
time (Go calls `cancel()` when the function returns). Always create a
fresh context for teardown.

## 29. Deep dive — concurrent tests in one process

`go test` runs tests within a package sequentially unless they call
`t.Parallel()`. The runner suspends a parallel test until other
non-parallel ones finish, then runs all parallel tests together.

```go
func TestA(t *testing.T) { t.Parallel(); /* ... */ }
func TestB(t *testing.T) { t.Parallel(); /* ... */ }
func TestC(t *testing.T) { /* not parallel */ }
```

In this example, `TestC` runs first, then `TestA` and `TestB` run
concurrently.

The `GOMAXPROCS` environment variable controls how many parallel tests
run simultaneously. The flag `-parallel=N` overrides this for one run.

Integration tests rarely saturate CPU but often saturate downstream
services. If your shared Postgres connection pool has 10 slots and 50
parallel tests each open a connection, the eleventh test waits or
fails. Set `db.SetMaxOpenConns(5)` per test and pick a sensible
`-parallel` value.

## 30. Deep dive — race detection on integration tests

`go test -race` enables a memory-race detector. It instruments the
program and reports two goroutines that access the same memory location
without synchronization, when at least one access is a write.

Common races in integration tests:

- A handler writes to a logger that another goroutine also writes to.
- A test setup goroutine populates a slice that the test body reads
  without a mutex.
- A worker pool inside the handler closes a shared channel from two
  goroutines.

The detector overhead is real (CPU and memory roughly 5x). On hot
laptops, run `-race` only when investigating a suspected race; on CI,
run it on a dedicated job rather than every PR.

## 31. Recap of the page

You learned:

- The `//go:build integration` tag and why it matters.
- `httptest.NewServer` for in-process HTTP testing.
- `testcontainers-go` and `postgres.Run` for real database tests.
- `TestMain` for one-time setup, with the `os.Exit` gotcha.
- `t.Cleanup` for leak-free teardown.
- Wait strategies, environment variables, files, contexts.
- Race detection, parallel execution, subtests.

This is the minimum surface area to write integration tests on real
projects. The Middle page assumes everything here is comfortable.

## 32. Worked example — a small URL shortener

To bring everything together, here is a complete tiny service plus
integration tests.

```go
// file: shortener/shortener.go
package shortener

import (
    "context"
    "database/sql"
    "encoding/hex"
    "errors"
    "crypto/rand"
)

var ErrNotFound = errors.New("not found")

type Store interface {
    Save(ctx context.Context, slug, url string) error
    Lookup(ctx context.Context, slug string) (string, error)
}

type PGStore struct{ DB *sql.DB }

func (s *PGStore) Save(ctx context.Context, slug, url string) error {
    _, err := s.DB.ExecContext(ctx,
        `INSERT INTO links(slug, url) VALUES($1, $2)`, slug, url)
    return err
}

func (s *PGStore) Lookup(ctx context.Context, slug string) (string, error) {
    var url string
    err := s.DB.QueryRowContext(ctx,
        `SELECT url FROM links WHERE slug=$1`, slug).Scan(&url)
    if errors.Is(err, sql.ErrNoRows) {
        return "", ErrNotFound
    }
    return url, err
}

type Service struct{ Store Store }

func (s *Service) Shorten(ctx context.Context, url string) (string, error) {
    var b [4]byte
    if _, err := rand.Read(b[:]); err != nil {
        return "", err
    }
    slug := hex.EncodeToString(b[:])
    if err := s.Store.Save(ctx, slug, url); err != nil {
        return "", err
    }
    return slug, nil
}
```

```go
// file: shortener/shortener_integration_test.go
//go:build integration

package shortener

import (
    "context"
    "database/sql"
    "errors"
    "testing"
    "time"

    _ "github.com/jackc/pgx/v5/stdlib"
    "github.com/testcontainers/testcontainers-go/modules/postgres"
)

func TestService_Shorten_RoundTrip(t *testing.T) {
    ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
    defer cancel()

    pg, err := postgres.Run(ctx, "postgres:16-alpine",
        postgres.WithDatabase("shortener"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"),
        postgres.BasicWaitStrategies())
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { _ = pg.Terminate(ctx) })

    dsn, _ := pg.ConnectionString(ctx, "sslmode=disable")
    db, err := sql.Open("pgx", dsn)
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { _ = db.Close() })

    if _, err := db.ExecContext(ctx,
        `CREATE TABLE links(slug TEXT PRIMARY KEY, url TEXT NOT NULL)`,
    ); err != nil { t.Fatal(err) }

    svc := &Service{Store: &PGStore{DB: db}}
    slug, err := svc.Shorten(ctx, "https://example.com")
    if err != nil { t.Fatal(err) }
    if slug == "" { t.Fatal("empty slug") }

    got, err := svc.Store.Lookup(ctx, slug)
    if err != nil { t.Fatal(err) }
    if got != "https://example.com" {
        t.Fatalf("got %q", got)
    }

    _, err = svc.Store.Lookup(ctx, "no-such-slug")
    if !errors.Is(err, ErrNotFound) {
        t.Fatalf("want ErrNotFound, got %v", err)
    }
}
```

Notice:

- The test exercises both the happy path and the not-found path.
- Errors from `db.ExecContext` are checked; nothing is discarded.
- The slug is generated from `crypto/rand` so each run is unique — yet
  the assertion does not depend on the slug value, only on round-trip.
- Cleanup is registered after every successful allocation.

Run it:

```bash
go test -tags=integration -race -v ./shortener/...
```

Output:

```
=== RUN   TestService_Shorten_RoundTrip
--- PASS: TestService_Shorten_RoundTrip (3.62s)
PASS
ok      example.com/shortener  3.65s
```

You now have a real, working integration test for a real database
boundary. The same shape scales to any repository you write.

## 33. When integration tests fail in CI but pass locally

A near-universal experience. Causes, ranked by frequency:

- **Slow CI runner.** Container startup hits the wait strategy's
  timeout. Increase `WithStartupTimeout` for that environment.
- **Different architecture.** Apple Silicon (arm64) developers, x86
  CI. The image must support both — most official images do, but some
  small images do not.
- **Different Docker version.** Older runners might not support newer
  features like `--platform`. Pin Docker version on the runner or use
  `actions/setup-docker`.
- **Missing environment variables.** Tests read configuration from the
  environment. CI may not export the variables developers have in
  their shell.

When you cannot reproduce, log everything: `docker version`,
`runtime.GOARCH`, `os.Environ()` filtered for safe values. Re-run the
job; the logs usually point at the difference within a minute.

## 34. One last warning

Beginner integration test bugs cluster around three patterns:

1. Container starts but the test races readiness. Fix with a wait
   strategy.
2. Resources leak because cleanup was skipped on the unhappy path. Fix
   with `t.Cleanup` registered after allocation.
3. Tests interfere with each other. Fix by giving each test its own
   database, transaction or topic.

If your suite is reliable in those three areas, the rest of integration
testing is incremental. The Middle page builds on that base.

## 35. Working with `*testing.T` helpers

The `testing` package provides several methods worth knowing:

- `t.Helper()` — when called inside a helper function, makes the
  reported failure location point at the caller, not the helper itself.

  ```go
  func mustOpenDB(t *testing.T, dsn string) *sql.DB {
      t.Helper()
      db, err := sql.Open("pgx", dsn)
      if err != nil { t.Fatal(err) }
      return db
  }
  ```

- `t.Logf` — prints a message only when `-v` is set or the test fails.
  Use it generously; it is free at runtime.

- `t.Skip` — skips the rest of the test. `t.Skipf` accepts a format
  string. The test report counts skipped tests separately from passes.

- `t.TempDir` — creates a temporary directory unique to the test,
  cleaned up automatically. Better than `os.MkdirTemp` + manual
  cleanup.

  ```go
  dir := t.TempDir()
  path := filepath.Join(dir, "input.json")
  ```

- `t.Setenv` — sets an environment variable for the duration of the
  test. Restores the old value when the test ends. Safer than calling
  `os.Setenv` directly because cleanup is automatic.

  ```go
  t.Setenv("DATABASE_URL", dsn)
  ```

- `t.Deadline` — returns the deadline of the test (from `-timeout`).
  Use it to derive context deadlines that match the test's overall
  budget.

  ```go
  d, ok := t.Deadline()
  if !ok { d = time.Now().Add(30 * time.Second) }
  ctx, cancel := context.WithDeadline(context.Background(), d)
  defer cancel()
  ```

These helpers exist precisely for the kinds of needs that show up in
integration tests. Use them rather than re-inventing.

## 36. Quick recipes

A handful of one-liners you will reach for repeatedly:

```go
// random suffix for unique resource names
func randSuffix() string {
    var b [4]byte
    _, _ = rand.Read(b[:])
    return hex.EncodeToString(b[:])
}

// truncate a string for safe SQL identifier use
func safeIdentifier(s string) string {
    s = strings.ToLower(s)
    s = strings.Map(func(r rune) rune {
        if r >= 'a' && r <= 'z' { return r }
        if r >= '0' && r <= '9' { return r }
        return '_'
    }, s)
    if len(s) > 40 { s = s[:40] }
    return s
}

// poll until cond returns true or deadline passes
func waitFor(t *testing.T, cond func() bool, within time.Duration) {
    t.Helper()
    deadline := time.Now().Add(within)
    for time.Now().Before(deadline) {
        if cond() { return }
        time.Sleep(20 * time.Millisecond)
    }
    t.Fatalf("condition not met within %v", within)
}

// drain an http body so connections can be reused
func drain(r io.Reader) { _, _ = io.Copy(io.Discard, r) }
```

Keep these in a small `internal/testutil` package. The harness benefits
from being the single place where these primitives live.

## 37. What "passes" actually means

A passing integration test means:

- The container started.
- The wait strategy succeeded.
- Your code's request reached the dependency.
- The dependency responded.
- Your assertion matched.
- Cleanup ran.

That is six things. Each one is a potential source of failure. When a
test passes consistently across many runs, you have evidence that all
six are working. When it flakes, isolate which step is the unreliable
one.

A green test means very little if it ran once. Run it ten times.

## 38. Closing thoughts

Integration tests are an investment. The first one feels heavyweight —
you install testcontainers, learn `TestMain`, debug a wait strategy.
But once the harness exists, adding the second integration test takes
five minutes. The third takes two. By the tenth, you write them as
fluently as unit tests.

That fluency is the goal of this page. The Middle and Senior pages
expand the toolkit; this page makes sure the toolkit fits in your hand
to begin with.

If you only remember three things:

1. The build tag is non-negotiable.
2. Register cleanup after allocation.
3. Containers go in `TestMain`, isolation goes per test.

Those three rules carry 80% of correct integration tests across the
language.

## 39. Self-check questions

Before moving to the Middle page, answer these out loud. If any answer
is shaky, re-read the relevant section.

1. What does `//go:build integration` do, and where exactly must it
   appear in the file?
2. Why is `httptest.NewServer` preferable to `http.ListenAndServe` in a
   test?
3. What is the difference between `defer srv.Close()` inside a test and
   `t.Cleanup(srv.Close)`? Which survives a `t.Fatal` from a helper?
4. After calling `postgres.Run`, in what order should you register
   cleanup and check the error?
5. Why does `defer pg.Terminate(ctx)` not work inside `TestMain`?
6. What environment variable could you check to skip integration tests
   in environments without Docker?
7. What is the wait strategy used by `postgres.BasicWaitStrategies`?
8. Why is `time.Sleep` discouraged as a wait mechanism?
9. What does `t.Helper()` change about failure reporting?
10. What does `-race` do, and why might integration suites enable it on
    a dedicated CI job rather than every run?

The answers are scattered throughout this page; reading them once is
the start, recalling them on demand is the end.

## 40. Sample run transcript

A successful local run on a recent laptop produces output similar to
this (timings vary):

```
$ go test -tags=integration -race -v ./...
=== RUN   TestHealth
--- PASS: TestHealth (0.01s)
=== RUN   TestUserRepo_InsertAndGet
    user_integration_test.go:18: starting postgres container
    user_integration_test.go:34: dsn=postgres://test:test@127.0.0.1:54327/app
--- PASS: TestUserRepo_InsertAndGet (3.42s)
=== RUN   TestService_Shorten_RoundTrip
--- PASS: TestService_Shorten_RoundTrip (3.61s)
PASS
ok      example.com/api        0.04s
ok      example.com/shortener  3.65s
ok      example.com/store      3.45s
```

Three things to notice:

- The unit-only `api` package finishes in 40 ms. Build tag worked.
- Each integration test pays its own ~3 s for container start. The
  Middle page reduces this to one start per package.
- `-v` flag shows the `t.Logf` lines we added with `dsn=...`. Helpful
  when diagnosing failures.

If you see this output, you have completed the junior level.

## 41. Looking back, looking forward

You started this page knowing that `go test` runs unit tests. You now
know:

- How to opt code into a separate, slower test tier via build tags.
- How to spin up a real HTTP server and exercise it from a test.
- How to spin up a real Postgres database and exercise it from a test.
- How to clean up reliably with `t.Cleanup`.
- How to use `TestMain` for one-time setup.
- How to wait on a container's readiness without sleeping.
- How to write tests that are deterministic and parallel-safe at a
  small scale.

The Middle page will extend this knowledge: `TestMain` with shared
containers, database-per-test, transactional fixtures, factories,
parallel patterns at scale. The Senior page brings in Kafka, Redis,
multi-container topologies, deterministic seeds and CI tuning.

The path from here is incremental. Each pattern compounds on the
previous one. By the time you reach Senior, the foundation laid in
this page is what makes the higher-level patterns feel natural rather
than overwhelming.
