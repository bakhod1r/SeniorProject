---
layout: default
title: Integration Tests — Tasks
parent: Integration Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/13-integration-tests/tasks/
---

# Integration Tests — Tasks

[← Back](../)

The following exercises build a complete integration testing harness.
Each task introduces one additional capability and stacks on the previous
ones. Work them in order; commit after every task so you can compare your
suite against this guide.

## Task 1 — HTTP handler with `httptest`

Write a handler `GET /health` that returns 200 and JSON `{"ok":true}`.
Test it with `httptest.NewServer`. Verify:

- Status code is 200.
- `Content-Type` starts with `application/json`.
- The body decodes to a struct with `OK == true`.

```go
func TestHealth(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(Health))
    t.Cleanup(srv.Close)
    resp, err := http.Get(srv.URL)
    if err != nil { t.Fatal(err) }
    defer resp.Body.Close()
    if resp.StatusCode != 200 { t.Fatalf("got %d", resp.StatusCode) }
}
```

Acceptance: test passes with `go test ./...`, no extra dependencies.

## Task 2 — Build tag gate

Move the test from Task 1 into `health_integration_test.go` with the
build tag `//go:build integration`. Confirm that `go test ./...` does not
run it and `go test -tags=integration ./...` does.

Hint: the tag must be on the very first line of the file, followed by a
blank line, then the `package` clause.

## Task 3 — Postgres container

Add a repository `UserRepo` with method `Insert(ctx, u User) (int64, error)`
backed by `database/sql` and `github.com/jackc/pgx/v5/stdlib`. Test it
against a containerized Postgres started in `TestMain` via
`github.com/testcontainers/testcontainers-go/modules/postgres`. Verify
the returned id is non-zero and a subsequent `SELECT` returns the row.

Steps:

1. Create `TestMain` that starts Postgres and stores the DSN in a package
   variable.
2. Add a `newTestDB(t)` helper that opens `*sql.DB` and creates the
   `users` table.
3. Write `TestUserRepo_Insert` exercising the round trip.

Acceptance: passes under `go test -tags=integration ./...`.

## Task 4 — Transactional fixtures

Refactor Task 3 so each test runs inside a transaction that rolls back at
`t.Cleanup`. Show that two tests can run in parallel without seeing each
other's writes.

Change `UserRepo` to take a `DBTX` interface (the subset of
`*sql.DB`/`*sql.Tx` methods you use) so the production wiring still
passes a real `*sql.DB`.

Acceptance: `go test -tags=integration -run TestUserRepo -count=10 ./...`
passes and shows parallel execution in `-v` output.

## Task 5 — Random port

Replace the hard-coded `:8080` in your server with `:0`. Inside a test,
start the server, capture `ln.Addr().String()`, send a request, and shut
down via `srv.Shutdown(ctx)`.

```go
ln, err := net.Listen("tcp", "127.0.0.1:0")
```

Acceptance: two copies of the test can run side-by-side in different
shells without port collisions.

## Task 6 — Redis cache

Spin a Redis container with
`github.com/testcontainers/testcontainers-go/modules/redis`. Write a
`Cache` type with `Get`, `Set(key, value, ttl)` methods. Test SET-then-GET,
GET on miss, and TTL expiry. Use a polling loop with a deadline rather
than `time.Sleep`.

For the TTL test: set a key with 200ms TTL, poll every 20ms until the key
is gone, fail after 2 s. This is reliable on slow CI without being slow
in the happy path.

## Task 7 — Kafka producer

Run Kafka via
`github.com/testcontainers/testcontainers-go/modules/kafka`. Produce a
message in the test, consume it back through a consumer, assert payload
equality. Use context with deadline to avoid hangs.

Suggested clients: `github.com/segmentio/kafka-go` or
`github.com/twmb/franz-go`. Generate a unique topic per test:

```go
topic := "test-" + strings.ToLower(t.Name()) + "-" + randSuffix()
```

Acceptance: round-trip in under five seconds locally.

## Task 8 — Seed data

Add a `seed.sql` file under `testdata/`. In `TestMain`, after starting
Postgres, run the SQL to create tables and insert ten reference rows.
Tests should read but never mutate the seed (use transactions or a
read-only schema role).

Bonus: use `migrate` from `golang-migrate/migrate/v4` to apply versioned
migrations from `migrations/`.

## Task 9 — Cleanup leaks

Deliberately omit `t.Cleanup(func() { c.Terminate(ctx) })`. Run the suite,
then list containers with `docker ps -a`. Add cleanup back and confirm the
list stays clean.

This task teaches a habit by violating it once.

## Task 10 — CI workflow

Write `.github/workflows/integration.yml` that runs
`go test -tags=integration -timeout=10m ./...` on Ubuntu, with Docker
available and Go 1.24. Cache the module download with
`actions/setup-go`'s built-in caching and Docker images via
`actions/cache` keyed on the digest of your image constants file.

Make the job fail the build if it takes longer than 10 minutes.

## Task 11 — Factories

Create a `testfactory` package with helpers like
`testfactory.User(t, db, opts...)` and
`testfactory.Order(t, db, user, opts...)`. Each helper inserts one row,
registers cleanup, returns the inserted struct. Refactor at least three
existing tests to use the factories instead of inline SQL.

## Task 12 — Deterministic seeds

Add a `seed` package that reads `TEST_SEED` from environment or generates
a fresh one. Log the seed at the start of `TestMain`. Refactor any
randomness in your tests to flow through this seed.

Demonstrate reproducibility: run the suite, copy the seed from the logs,
re-run with `TEST_SEED=<value>` and confirm identical outcomes.

## Task 13 — Flake hunt

Inject a deliberate flake into one test (for instance, `time.Sleep(0)`
plus a goroutine race). Run `go test -run TestFlaky -count=200 -race`
until it fails. Now fix the flake and confirm 1000 runs succeed.

## Task 14 — Shard locally

Split your integration packages into two groups by hash of the package
path. Run them in two parallel shells. Note the speedup. This mirrors how
CI would shard across runners.

## Definition of done

- `go test ./...` passes without docker.
- `go test -tags=integration ./...` passes with docker.
- No leftover containers, ports or temporary files.
- `gotestsum` reports parallel execution.
- Suite runs in under three minutes locally on a recent laptop.
- Every random source has a logged seed reproducible from env.
- CI workflow runs the same suite on every push.

Work through the tasks once on your own; revisit them on a real
codebase where the harness lives in `internal/testenv`. Patterns sink
in only after the second application.

## Task 15 — Kafka with shared broker

Refactor Task 7 so the Kafka container is created once in `TestMain`.
Each test creates its own topic. Demonstrate that ten parallel tests
share the broker without collision.

```go
func TestMain(m *testing.M) {
    ctx := context.Background()
    k, err := kafka.Run(ctx, "confluentinc/cp-kafka:7.6.1")
    if err != nil { log.Fatal(err) }
    brokers, _ = k.Brokers(ctx)
    code := m.Run()
    _ = k.Terminate(ctx)
    os.Exit(code)
}
```

Acceptance: `go test -tags=integration -count=10 ./...` completes
within twice the time of `-count=1`.

## Task 16 — LocalStack S3

Spin LocalStack via
`github.com/testcontainers/testcontainers-go/modules/localstack`. Write
a function that uploads a file to S3 and downloads it back. Test the
round trip.

Configure the AWS SDK with an `EndpointResolverWithOptions` pointing
at LocalStack. Use `s3.NewFromConfig(cfg, func(o *s3.Options) {
o.UsePathStyle = true })` because LocalStack defaults to path-style
addressing.

## Task 17 — gRPC with bufconn

Write a gRPC service `Echo` and a client. Test the client by starting
the server on a `bufconn.Listener`, dialing via `grpc.NewClient` with
a custom context dialer, and asserting the response.

Acceptance: no real network port is opened during the test.

## Task 18 — Wiremock for HTTP fixtures

Use Wiremock (or a hand-rolled `httptest.NewServer`) to stub an
external HTTP API. Configure it to return canned responses for two
endpoints. Write a test that exercises both, plus a third test that
asserts a fourth endpoint returns 404.

## Task 19 — Time-based test with fake clock

Add a `clockwork.Clock` to one of your services. Write a test that
calls a function, advances the clock by an hour, and asserts that
state changed accordingly (e.g. a cached entry expired).

Demonstrate that the same test runs in milliseconds, not an hour.

## Task 20 — Snapshot fixture

Capture a `pg_dump` of a populated database. Write a `TestMain` that
restores the dump into the template database. Each test forks the
template and runs against pre-populated data.

Note: this task is large. Aim for a 100-row dataset, not a production
dump.

## Task 21 — Build a small harness

Create `internal/testenv/postgres.go` exposing one function:
`testenv.FreshDB(t *testing.T) *sql.DB`. Internally it does everything
this section has covered: starts the container via `sync.Once`,
applies migrations to a template database, creates a fresh database
per test, cleans up at `t.Cleanup`.

Refactor at least three existing tests to use the harness. Notice how
much shorter they become.

## Task 22 — CI shard

Modify your `.github/workflows/integration.yml` to run two parallel
jobs that shard the integration packages by hash. Each job runs half
the suite.

Acceptance: total wall time on the workflow drops by 40% or more.

## Task 23 — Quarantine workflow

Add a `//go:build flaky` tag to one test you suspect of flakiness.
Update the workflow to run flaky tests in a separate, non-gating job.

Acceptance: failures in the flaky job do not block the merge gate;
successes still get reported.

## Task 24 — Documentation

Write `TESTING.md` at your repo root naming:

- Build tag.
- Prerequisites (Docker, Go version).
- Local commands (`make test-unit`, `make test-integration`).
- Harness package and entry points.
- Troubleshooting common failures.

A new engineer should be productive within two hours of reading it.

## Task 25 — Measure and report

Run `gotestsum --jsonfile out.json -- -tags=integration ./...`. Extract
the top ten slowest tests, the median runtime, and the P95. Share the
numbers in your team's Slack or wiki.

Repeat monthly. Trend the numbers.

Re-do each task on real services where appropriate. The compounding
effect of practice is real; the second time you do task 21 you will
finish in a quarter of the time and produce something better.

## Task 26 — Goroutine leak detector

Add `go.uber.org/goleak` to `TestMain`:

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Run the suite. If any test leaks a goroutine, the suite fails with
a stack trace. Fix the leaks one by one.

Acceptance: `go test -tags=integration ./...` passes with goleak
enabled.

## Task 27 — Failure injection

Use `Shopify/toxiproxy` to inject 500ms latency between your test and
its Postgres container. Write a test that asserts your code handles
the slow database gracefully (timeout or retry).

Acceptance: under normal conditions the test passes in 1s; with the
toxic enabled, it still passes (because your code handles latency)
but takes ~3s.

## Task 28 — Container reuse across test runs

Configure `testcontainers-go` reuse via container labels. The first
test run starts Postgres; subsequent runs reuse it instead of
restarting.

Note: reuse is fragile; only use it for local development, never CI.

Acceptance: second `go test ...` invocation starts at least 3 seconds
faster than the first.

## Task 29 — Harness documentation

Write godoc for every public function in your `internal/testenv`
package. Run `go doc ./internal/testenv` and verify the output reads
like a user manual.

A new engineer should be able to write a working integration test
using only the godoc, without consulting the Senior page.
