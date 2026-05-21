---
layout: default
title: Integration Tests — Optimize
parent: Integration Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/13-integration-tests/optimize/
---

# Integration Tests — Optimize

[← Back](../)

A 12-minute integration suite blocks every pull request. Below are
concrete levers that bring it under three minutes without losing
coverage. Apply them in order; measure after each.

## Lever 1 — Container reuse across tests

The slowest part of most suites is starting Docker images. Spin a single
Postgres instance per package via `TestMain`, then create one database
per test. Database creation takes ~30 ms; container start takes ~3 s.

```go
func TestMain(m *testing.M) {
    ctx := context.Background()
    pg, err := postgres.Run(ctx, "postgres:16-alpine",
        postgres.WithDatabase("template"),
        postgres.BasicWaitStrategies())
    if err != nil { log.Fatal(err) }
    defer pg.Terminate(ctx)
    adminDSN, _ = pg.ConnectionString(ctx, "sslmode=disable")
    os.Exit(m.Run())
}

func newDB(t *testing.T) *sql.DB {
    name := "test_" + uniqueSuffix()
    admin := mustOpen(adminDSN)
    _, err := admin.Exec("CREATE DATABASE " + name)
    require.NoError(t, err)
    t.Cleanup(func() {
        admin.Exec("DROP DATABASE " + name)
        admin.Close()
    })
    return mustOpen(strings.Replace(adminDSN, "/template", "/"+name, 1))
}
```

Even better, pre-apply migrations once into a template database and let
each test do `CREATE DATABASE testN TEMPLATE template`. The template
copy is a near-instant Postgres operation.

## Lever 2 — Transactional fixtures

For read-heavy tests, share a populated database and wrap each test in a
transaction that rolls back at `t.Cleanup`. No `CREATE DATABASE` cost at
all.

```go
func newTx(t *testing.T, db *sql.DB) *sql.Tx {
    tx, err := db.BeginTx(context.Background(), nil)
    require.NoError(t, err)
    t.Cleanup(func() { _ = tx.Rollback() })
    return tx
}
```

Only works when the system under test accepts `*sql.Tx` or a `DBTX`
interface — design your repositories with that in mind. Tests that rely
on commit triggers cannot use this pattern.

## Lever 3 — Parallelize at the package level

`go test ./...` runs packages in parallel by default. Move integration
tests that need their own database into their own package so they get
their own `TestMain`-created container. Eight cores plus eight containers
run eight suites concurrently.

Inside a package, use `t.Parallel()` for tests that are independent of
each other once they have fresh databases.

## Lever 4 — Skip Docker pulls in CI

GitHub Actions, GitLab CI and Buildkite all support image caching. Push
your service images to a local registry once per day and pull them by
digest. A hot cache turns a 2.5 s pull into a 50 ms one.

For GitHub Actions:

```yaml
- name: Cache Docker images
  uses: actions/cache@v4
  with:
    path: /tmp/.buildx-cache
    key: docker-${{ hashFiles('internal/testenv/images.go') }}
```

## Lever 5 — Trim wait strategies

`testcontainers-go` defaults wait for a log line or TCP port. Setting an
overly conservative `wait.ForLog("ready")` with a 60 s timeout costs time
on every run. Use `wait.ForSQL` for databases — it returns the instant
the driver can `SELECT 1`:

```go
req := testcontainers.ContainerRequest{
    Image:        "postgres:16-alpine",
    ExposedPorts: []string{"5432/tcp"},
    WaitingFor: wait.ForSQL("5432/tcp", "pgx", func(host string, p nat.Port) string {
        return fmt.Sprintf("postgres://test:test@%s:%s/test?sslmode=disable", host, p.Port())
    }).WithStartupTimeout(15 * time.Second),
}
```

For Kafka, prefer `wait.ForLog("Kafka Server started")` over a generic
TCP probe — the broker accepts connections before it accepts produce
requests.

## Lever 6 — Compile once, test many

`go test -count=1 ./internal/integration/...` recompiles when sources
change. Use `go test -c -o int.test ./internal/integration` and run the
binary directly in CI loops. Saves the `go build` phase on repeated runs.

In CI, set `GOFLAGS=-trimpath -ldflags=-s -w` to avoid debug info bloat
that does not help integration tests.

## Lever 7 — Cut the suite into tiers

- `make test-unit` — under 30 seconds, runs on every save.
- `make test-integration` — under 3 minutes, runs on every push.
- `make test-e2e` — under 15 minutes, runs nightly.

Wire the `-tags=integration` build tag into the second tier. Developers
do not pay for E2E latency during inner-loop work.

## Lever 8 — Watch the long pole

Add `-v` and `gotestsum --jsonfile out.json`, then sort by duration:

```bash
gotestsum --jsonfile out.json --post-run-command 'jq -s "sort_by(-.elapsed)[:10]" out.json'
```

The top ten usually account for over 60% of total runtime. Optimize those
first; the rest can stay as-is.

## Lever 9 — Drop heavy fixtures

Some tests load a 10 000-row fixture they never query. Audit:

```sql
SELECT relname, n_tup_ins FROM pg_stat_user_tables ORDER BY n_tup_ins DESC;
```

Trim fixtures to the smallest set that exercises the code path. A
100-row dataset is usually enough; if it is not, that is a hint the test
is actually a benchmark in disguise.

## Lever 10 — Avoid per-test container start where unnecessary

A common antipattern: one test spins its own Postgres. The fix is to add
that test to the package's shared container via `TestMain`. Saved time:
3 seconds per offending test, easily 30 seconds across a suite.

## Result

Twelve minutes drops to two minutes forty. Engineers stop tagging tests
as `t.Skip()` and integration confidence rises. The CI bill drops
proportionally — container-minutes are billed by the minute on most
hosted runners.

Measure before and after. The numbers convince skeptics in a way that
"trust me, it'll be faster" never does.

## 11. Lever 11 — Avoid `-count=1` in the hot path

`go test -count=1` disables the test result cache. That cache is one of
Go's most under-used speedups. With the cache enabled, tests for
unchanged packages return instantly:

```
$ go test ./...
ok      example.com/api          (cached)
ok      example.com/store        (cached)
ok      example.com/shortener    3.61s
```

Caveat: the cache only applies when nothing affecting the test changed
(source, env vars, command-line flags). For most workflows this is a
free win. CI sometimes needs `-count=1` to guarantee fresh runs —
acceptable there, costly during local development.

## 12. Lever 12 — Use `gotestsum` for clearer output

`gotestsum` wraps `go test`, parses JSON output, and provides better
formatting plus JUnit XML:

```bash
gotestsum --format=testname --jsonfile=out.json -- \
    -tags=integration -race ./...
```

Advantages:

- Clear pass/fail per test with timing.
- JUnit XML for CI dashboards.
- A `--rerun-fails=2` flag retries failed tests (use sparingly).

It does not change the speed of the tests themselves but reduces
analysis time after a failure.

## 13. Lever 13 — Selective integration testing

When a PR touches `internal/payments/`, you may not need to run the
entire suite. A small script computes affected packages:

```bash
PKGS=$(go list -deps -tags=integration ./... | sort -u)
CHANGED=$(git diff --name-only origin/main..HEAD | grep -E '\.(go|sql|yaml)$')
AFFECTED=$(echo "$CHANGED" | xargs -n1 dirname | sort -u)
TO_TEST=$(comm -12 <(echo "$PKGS") <(echo "$AFFECTED"))
go test -tags=integration $TO_TEST
```

Used carefully, this scales sublinearly with codebase size. The
trade-off is increased complexity in CI scripts.

## 14. Lever 14 — Connection pool right-sizing

A `*sql.DB` with `SetMaxOpenConns(50)` and 100 parallel tests each
opening a handle means 5000 connections to Postgres — well past its
default `max_connections=100`. Symptoms include `FATAL: too many
clients` errors and slow tests.

Lower per-handle: `SetMaxOpenConns(5)`. Increase the database's limit
only if you have a real reason.

## 15. Lever 15 — Disable WAL on test databases

For tests that do not exercise crash recovery, disable Postgres's
write-ahead log:

```sql
ALTER SYSTEM SET synchronous_commit = 'off';
ALTER SYSTEM SET fsync = 'off';
ALTER SYSTEM SET full_page_writes = 'off';
```

Or, simpler: launch Postgres with `command: ["postgres", "-c",
"fsync=off"]` in the testcontainers options. Inserts speed up 2-3x;
durability is irrelevant because the database is discarded after each
test.

Never apply these settings to a production database.

## 16. Lever 16 — Avoid n+1 in fixture seeding

A common antipattern in test setup:

```go
for i := 0; i < 1000; i++ {
    factories.User(t, db)
}
```

Each call does one INSERT. Total: 1000 round trips, ~5 seconds. Fix
with a bulk insert:

```go
func Users(t *testing.T, db DBTX, n int) []User {
    t.Helper()
    rows := make([]any, 0, n*3)
    args := make([]string, 0, n)
    for i := 0; i < n; i++ {
        rows = append(rows, fmt.Sprintf("u%d", i), "email", "active")
        args = append(args, fmt.Sprintf("($%d,$%d,$%d)", i*3+1, i*3+2, i*3+3))
    }
    query := "INSERT INTO users(name,email,status) VALUES " + strings.Join(args, ",")
    _, err := db.Exec(query, rows...)
    if err != nil { t.Fatal(err) }
    // ... read back and return
}
```

One round trip. ~50 ms.

## 17. Cumulative effect

Applying levers 1 through 16 to a representative 1500-test integration
suite:

| Stage                            | Wall time |
|----------------------------------|-----------|
| Before any optimization          | 12 min    |
| Container reuse (lever 1)        | 8 min     |
| Template + COPY (lever 1 cont.)  | 5 min     |
| Parallelism (lever 3)            | 4 min     |
| Image cache (lever 4)            | 3 min 20 s |
| Test cache (lever 11)            | 2 min 40 s |

Numbers vary by suite. The methodology — measure, optimize the long
pole, re-measure — does not.

## 18. When the suite is already fast

If the integration suite runs in under three minutes, optimizing
further has diminishing returns. Spend the optimization budget on:

- Unit-test feedback loop (under 30 seconds is the target).
- E2E test reliability (often the long pole of full release flow).
- Local developer experience (faster builds, hot-reload).

A balanced ecosystem beats a single hyper-optimized layer.

## 19. Closing the optimize page

Performance work is empirical. Measure, change one thing, measure
again. Publish the before/after numbers; engineering trust grows when
optimization is documented. Resist the urge to micro-optimize tests
that are already short; the wall-clock impact is invisible to users.

The Professional page connects these mechanics to the broader
organizational picture.
