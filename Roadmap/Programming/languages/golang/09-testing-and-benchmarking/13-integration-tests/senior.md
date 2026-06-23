---
layout: default
title: Integration Tests — Senior
parent: Integration Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/13-integration-tests/senior/
---

# Integration Tests — Senior

[← Back](../)

At the senior level you stop writing one-off integration tests and start
*architecting* a test harness used by an entire codebase. That means
multi-service topologies, deterministic seeds, parallel safety across
processes, and CI workflows that finish before the developer goes for
coffee.

## 1. The harness mindset

A harness is a thin internal library that hides the complexity of starting
real infrastructure and gives test authors a single function call. Goal:
`db := testenv.Postgres(t)` and `kafka := testenv.Kafka(t)` should be
all a test author has to write.

```go
// file: internal/testenv/postgres.go
package testenv

import (
    "context"
    "database/sql"
    "testing"

    "github.com/testcontainers/testcontainers-go/modules/postgres"
)

type PG struct {
    Admin *sql.DB
    DSN   string
}

func Postgres(t *testing.T) *PG {
    t.Helper()
    return getSharedPG(t) // returns from a sync.Once-backed cache
}
```

Internally the harness uses `sync.Once` to start each container exactly
once per process, sub-leases logical resources (databases, schemas) to
individual tests, and registers cleanups against `t.Cleanup`.

## 2. `testcontainers-go` modules at a glance

The community maintains modules for the popular dependencies. Each module
encapsulates image, wait strategy, common options:

- `postgres.Run` — `github.com/testcontainers/testcontainers-go/modules/postgres`
- `redis.Run` — `github.com/testcontainers/testcontainers-go/modules/redis`
- `kafka.Run` — `github.com/testcontainers/testcontainers-go/modules/kafka`
- `mongodb.Run` — `.../modules/mongodb`
- `localstack.Run` — `.../modules/localstack`

A module is just a wrapper. You can always drop down to
`testcontainers.GenericContainer` if you need something custom (a private
image, a sidecar pattern, multi-port exposure).

## 3. Spinning a Kafka broker

```go
//go:build integration

package broker

import (
    "context"
    "testing"
    "time"

    "github.com/segmentio/kafka-go"
    tcKafka "github.com/testcontainers/testcontainers-go/modules/kafka"
)

func TestProducerConsumer(t *testing.T) {
    t.Parallel()
    ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
    defer cancel()

    k, err := tcKafka.Run(ctx, "confluentinc/cp-kafka:7.6.1")
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { _ = k.Terminate(ctx) })

    brokers, err := k.Brokers(ctx)
    if err != nil {
        t.Fatal(err)
    }

    w := &kafka.Writer{
        Addr:     kafka.TCP(brokers...),
        Topic:    "events",
        Balancer: &kafka.LeastBytes{},
    }
    defer w.Close()

    if err := w.WriteMessages(ctx, kafka.Message{Value: []byte("hello")}); err != nil {
        t.Fatal(err)
    }

    r := kafka.NewReader(kafka.ReaderConfig{
        Brokers:     brokers,
        Topic:       "events",
        GroupID:     "test",
        StartOffset: kafka.FirstOffset,
        MaxWait:     200 * time.Millisecond,
    })
    defer r.Close()

    m, err := r.ReadMessage(ctx)
    if err != nil {
        t.Fatal(err)
    }
    if string(m.Value) != "hello" {
        t.Fatalf("got %q", m.Value)
    }
}
```

Kafka starts slowly (Zookeeper-less mode plus topic auto-create). For a
suite with many Kafka tests, share one broker via `TestMain` and use
unique topic names per test.

## 4. Topic isolation

Two parallel tests writing to the same topic produce non-deterministic
ordering. Best practice is `topic := t.Name() + "-" + randSuffix()`. The
broker auto-creates topics on first write when `auto.create.topics.enable`
is true (default in the testcontainers Kafka image).

```go
topic := fmt.Sprintf("test-%s-%s", normalize(t.Name()), randSuffix())
```

## 5. Multi-container topologies

Real services need a database and a broker and a cache. With
`testcontainers-go` you compose them, optionally on a shared network:

```go
net, err := network.New(ctx)
if err != nil { t.Fatal(err) }
t.Cleanup(func() { _ = net.Remove(ctx) })

pg, _ := postgres.Run(ctx, "postgres:16-alpine",
    network.WithNetwork([]string{"db"}, net))
rd, _ := redis.Run(ctx, "redis:7-alpine",
    network.WithNetwork([]string{"cache"}, net))
```

Containers can address each other by alias (`db`, `cache`) — important
when one container needs to talk to another, such as Kafka talking to a
schema registry.

## 6. Dockertest alternative

`github.com/ory/dockertest/v3` is the older library, still in active use.
The API is more imperative: build a `Pool`, run a resource, retry until
ready.

```go
pool, err := dockertest.NewPool("")
if err != nil { log.Fatal(err) }

res, err := pool.Run("postgres", "16-alpine", []string{
    "POSTGRES_USER=test",
    "POSTGRES_PASSWORD=test",
    "POSTGRES_DB=app",
})
if err != nil { log.Fatal(err) }
defer pool.Purge(res)

dsn := fmt.Sprintf("postgres://test:test@localhost:%s/app?sslmode=disable",
    res.GetPort("5432/tcp"))

pool.MaxWait = 30 * time.Second
err = pool.Retry(func() error {
    db, err := sql.Open("pgx", dsn)
    if err != nil { return err }
    return db.Ping()
})
```

Differences from `testcontainers-go`:

- No "Ryuk" sidecar; cleanup is your responsibility via `pool.Purge`.
- No built-in modules; you assemble the args yourself.
- Slightly smaller binary footprint.

Pick whichever your team already invested in. Migrations cost more than
the marginal API differences.

## 7. Real HTTP integration with `httptest`

For testing your handlers end-to-end with the real router, middleware,
auth and database, `httptest.NewServer` remains the right tool — even at
senior level.

```go
func TestAPI_CreateUser(t *testing.T) {
    t.Parallel()
    db := testenv.Postgres(t).Fresh(t)
    h := api.New(api.Config{DB: db, Clock: clockwork.NewFakeClockAt(t0)})

    srv := httptest.NewServer(h)
    t.Cleanup(srv.Close)

    body := strings.NewReader(`{"name":"ann"}`)
    resp, err := http.Post(srv.URL+"/users", "application/json", body)
    if err != nil { t.Fatal(err) }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusCreated {
        t.Fatalf("got %d", resp.StatusCode)
    }
}
```

Three multipliers when this scales:

- Use `httptest.NewUnstartedServer` if you need to customize the listener
  (`http2`, TLS) before serve.
- Mount tracing middleware so test logs include a trace ID; debugging
  flakes becomes much easier.
- Inject a fake clock so time-based assertions are exact.

## 8. Test data management

Three approaches, ordered by maintainability:

1. **Factories.** Functions like `factories.User(t, db, opts...)` create
   one row, return the inserted struct, register cleanup. Easy to compose;
   no SQL in tests.

   ```go
   func User(t *testing.T, db DBTX, opts ...func(*User)) User {
       t.Helper()
       u := User{Name: "user-" + randSuffix(), Email: randEmail()}
       for _, opt := range opts { opt(&u) }
       err := db.QueryRowContext(ctx,
           `INSERT INTO users(name, email) VALUES($1,$2) RETURNING id`,
           u.Name, u.Email).Scan(&u.ID)
       if err != nil { t.Fatal(err) }
       return u
   }
   ```

2. **Seeders.** SQL files under `testdata/seed/` run by the harness. Use
   for bulk reference data ("the 50 US states").

3. **Snapshots.** Save the entire database state to a file, restore for
   each test. Powerful but slow; only use for read-only legacy data.

## 9. Determinism

Random data is welcome — but seeded. A test with a fresh random seed each
run is unreproducible.

```go
seed := os.Getenv("TEST_SEED")
if seed == "" { seed = strconv.FormatInt(time.Now().UnixNano(), 10) }
t.Logf("seed=%s", seed)
rng := rand.New(rand.NewSource(parseInt64(seed)))
```

Log the seed on every test. When a test fails on CI, the failure message
prints `seed=1739472384`, and you can reproduce locally with
`TEST_SEED=1739472384 go test ./...`.

## 10. Resource isolation across parallel containers

When several integration tests each spin a Postgres on a developer's
laptop, Docker Desktop's port allocator picks random ephemeral ports —
fine. The risk is volume names and container names colliding. The default
`testcontainers-go` strategy generates random names per run, so this
seldom bites.

A subtler issue: the host's file descriptor limit. 50 containers ×
~20 sockets each can exhaust the default `ulimit -n` of 1024 on macOS.
Either raise the limit or share containers via `TestMain`.

## 11. CI tuning — GitHub Actions

The standard runner ships Docker. Two strategies coexist:

- **Test-managed containers.** Tests spin their own via testcontainers.
  Cleanest, but slow on cold caches.
- **CI-managed services.** Workflow declares `services:` with images
  cached by GitHub. Faster, but tests need to read `DATABASE_URL` from
  the environment.

A pragmatic compromise: declare Postgres in `services:` for the common
fast path, and let occasional tests that need a private image spin their
own.

```yaml
jobs:
  integration:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_PASSWORD: test }
        ports: ["5432:5432"]
        options: --health-cmd="pg_isready" --health-interval=5s
    env:
      DATABASE_URL: postgres://postgres:test@localhost:5432/postgres?sslmode=disable
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.24' }
      - run: go test -tags=integration -timeout=10m -shuffle=on ./...
```

`-shuffle=on` randomizes test order. If shuffling breaks tests, your tests
share state — fix the share, not the shuffle.

## 12. GitLab CI

```yaml
integration:
  image: golang:1.24
  services:
    - name: postgres:16-alpine
      alias: postgres
      variables:
        POSTGRES_PASSWORD: test
  variables:
    DATABASE_URL: postgres://postgres:test@postgres:5432/postgres?sslmode=disable
  script:
    - go test -tags=integration -timeout=10m ./...
```

Same idea, slightly different keys.

## 13. Tracing flakes

When a test fails once per hundred runs:

- Log everything with structured fields tied to the test name.
- Capture `docker logs` from each container at teardown.
- Re-run the failing test under `go test -run 'TestX' -count=200 -race`
  on the developer machine before declaring the fix complete.

```go
func dumpContainerLogs(t *testing.T, c testcontainers.Container) {
    t.Helper()
    reader, err := c.Logs(context.Background())
    if err != nil { return }
    defer reader.Close()
    b, _ := io.ReadAll(reader)
    t.Logf("container logs:\n%s", b)
}

t.Cleanup(func() { dumpContainerLogs(t, pg.Container) })
```

## 14. Performance — the long pole

Run `gotestsum --jsonfile out.json` and sort by duration. Almost always:

- The first three or four are container starts that should be shared via
  `TestMain`.
- The next handful are tests that pull large fixtures over the network or
  exercise long-tailed retries.

Refactoring those few brings the suite under your target wall-clock.

## 15. Putting senior pieces together

A canonical project layout:

```
internal/
  testenv/
    pg.go        # Postgres harness
    redis.go     # Redis harness
    kafka.go     # Kafka harness
    network.go   # Shared docker network
    seed.go      # Fixture factories
  api/
    api_integration_test.go
  store/
    user_integration_test.go
    order_integration_test.go
.github/
  workflows/
    integration.yml
Makefile
```

Authors of new tests touch only the `_integration_test.go` files; the
harness covers the rest. That separation is what makes a senior
integration suite scalable.

## 16. Anti-patterns to retire

- Tests that depend on file system absolute paths.
- Tests that rely on the time of day.
- Tests that mutate global package variables for "convenience".
- Tests that retry until green to hide a race.
- Tests that share a single transaction across parallel goroutines.

If you spot any of these in code review, push back. They will produce
flakes proportional to the team size.

## 17. Recap

- A reusable harness hides container complexity from test authors.
- `testcontainers-go` modules cover Postgres, Redis, Kafka and more.
- `dockertest` is a viable alternative for older codebases.
- Multi-container topologies share networks via aliases.
- Deterministic seeds, parallel safety, structured logs and shuffle-on
  test execution are the senior-level defaults.
- CI services accelerate cold runs; testcontainers gives flexibility.
- Optimize the long pole; the rest takes care of itself.

The Professional page covers how to run this at organization scale —
budgets, sharding, cost discipline, and quarterly health reviews.

## 18. Working with LocalStack

For AWS-shaped dependencies (S3, SQS, DynamoDB, Lambda, SNS), the
LocalStack project provides an emulator. The
`testcontainers-go/modules/localstack` package wraps it.

```go
import (
    "github.com/testcontainers/testcontainers-go/modules/localstack"
)

func TestS3Upload(t *testing.T) {
    ctx := context.Background()
    ls, err := localstack.Run(ctx, "localstack/localstack:3.4")
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { _ = ls.Terminate(ctx) })

    endpoint, err := ls.PortEndpoint(ctx, "4566", "http")
    if err != nil { t.Fatal(err) }

    cfg, _ := config.LoadDefaultConfig(ctx,
        config.WithRegion("us-east-1"),
        config.WithCredentialsProvider(
            credentials.NewStaticCredentialsProvider("test", "test", "")),
        config.WithEndpointResolverWithOptions(
            aws.EndpointResolverWithOptionsFunc(
                func(svc, region string, _ ...interface{}) (aws.Endpoint, error) {
                    return aws.Endpoint{URL: endpoint}, nil
                })))

    s3c := s3.NewFromConfig(cfg, func(o *s3.Options) { o.UsePathStyle = true })

    bucket := "test-" + randSuffix()
    _, err = s3c.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: &bucket})
    if err != nil { t.Fatal(err) }

    _, err = s3c.PutObject(ctx, &s3.PutObjectInput{
        Bucket: &bucket,
        Key:    aws.String("hello"),
        Body:   strings.NewReader("world"),
    })
    if err != nil { t.Fatal(err) }
}
```

LocalStack covers most AWS APIs at a level good enough for integration
testing. For services not yet supported, fall back to AWS' own emulators
(DynamoDB Local, SQS Local) which also ship as containers.

## 19. Wiremock and HTTP fixtures

When integrating against a third-party HTTP API that you cannot host
locally, Wiremock provides a programmable stub server.

```go
import "github.com/wiremock/wiremock-testcontainers-go"

wm, err := wiremock.RunContainer(ctx, "wiremock/wiremock:3.5.4-alpine",
    wiremock.WithMappingFromFile("stripe-charges", "testdata/stripe/charges.json"))
if err != nil { t.Fatal(err) }
t.Cleanup(func() { _ = wm.Terminate(ctx) })

base, _ := wm.GetBaseEndpoint(ctx)
client := stripe.NewClient(base+"/v1", "sk_test_...")
```

The `stripe-charges` mapping file is JSON that declares request matchers
and canned responses. Wiremock records actual calls so you can assert
your code invoked the API correctly.

Alternative: pure-Go solutions like `nbio/httpwiremock` or hand-rolled
`httptest.NewServer` with a switch on path. Choose by team familiarity.

## 20. Real gRPC integration tests

`google.golang.org/grpc/test/bufconn` provides an in-process network
suitable for gRPC integration tests without opening a real socket:

```go
import (
    "google.golang.org/grpc"
    "google.golang.org/grpc/test/bufconn"
)

func TestGRPC_Echo(t *testing.T) {
    lis := bufconn.Listen(1024 * 1024)
    srv := grpc.NewServer()
    pb.RegisterEchoServer(srv, &echoServer{})

    go func() { _ = srv.Serve(lis) }()
    t.Cleanup(srv.Stop)

    conn, err := grpc.NewClient("passthrough://bufnet",
        grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
            return lis.DialContext(ctx)
        }),
        grpc.WithTransportCredentials(insecure.NewCredentials()))
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { _ = conn.Close() })

    client := pb.NewEchoClient(conn)
    resp, err := client.Echo(context.Background(), &pb.EchoRequest{Message: "hi"})
    if err != nil { t.Fatal(err) }
    if resp.Message != "hi" { t.Fatalf("got %q", resp.Message) }
}
```

Why not `httptest`? Because gRPC uses HTTP/2 + protobuf and needs the
grpc.Server to negotiate. `bufconn` keeps everything in-process while
exercising the real grpc-go stack — the most realistic environment short
of a real TCP socket.

For tests that must run on real TCP (e.g. cross-process), bind `:0` and
serve over `net.Listen`.

## 21. Test data factories at scale

A factory exposes a builder pattern for fixtures. Each factory method
returns a typed struct, registers cleanup, and accepts overrides via
functional options.

```go
package factories

type UserOpt func(*User)

func WithEmail(e string) UserOpt   { return func(u *User) { u.Email = e } }
func WithRole(r string) UserOpt    { return func(u *User) { u.Role = r } }
func WithStatus(s string) UserOpt  { return func(u *User) { u.Status = s } }

func User(t *testing.T, db DBTX, opts ...UserOpt) User {
    t.Helper()
    u := User{
        Email:  "u-" + randSuffix() + "@example.com",
        Name:   "User " + randSuffix(),
        Role:   "member",
        Status: "active",
    }
    for _, o := range opts { o(&u) }
    err := db.QueryRow(`INSERT INTO users(email, name, role, status)
        VALUES($1, $2, $3, $4) RETURNING id`,
        u.Email, u.Name, u.Role, u.Status).Scan(&u.ID)
    if err != nil { t.Fatal(err) }
    return u
}
```

Call sites stay short:

```go
admin := factories.User(t, db, factories.WithRole("admin"))
factories.Order(t, db, factories.WithOwner(admin.ID), factories.WithStatus("paid"))
```

Composing factories handles related rows automatically; the test body
never writes SQL.

## 22. Snapshot fixtures

Sometimes a test exercises behaviour against a richly-populated database
that is expensive to build. A snapshot fixture pre-builds the state once
and restores it for each test.

Postgres approach: pre-populate a database, then `pg_dump` to a SQL file.
In `TestMain`, restore the dump into the template database. Each test
forks from the template.

Trade-off: snapshots are opaque. A change to the schema requires
regenerating the snapshot. Use sparingly — for legacy reference data
that is hard to seed any other way.

## 23. Deterministic time

Integration tests that depend on `time.Now` are fragile. Inject a clock:

```go
import "github.com/jonboulle/clockwork"

type Service struct {
    Clock clockwork.Clock
}

func (s *Service) IsStale(t time.Time) bool {
    return s.Clock.Now().Sub(t) > 5*time.Minute
}
```

Tests inject a `FakeClock`:

```go
clock := clockwork.NewFakeClockAt(time.Date(2026, 5, 20, 12, 0, 0, 0, time.UTC))
svc := &Service{Clock: clock}
if svc.IsStale(clock.Now()) { t.Fatal("fresh data flagged stale") }
clock.Advance(6 * time.Minute)
if !svc.IsStale(clock.Now().Add(-6 * time.Minute)) {
    t.Fatal("stale data not flagged")
}
```

This combination works even when the system under test integrates with a
real database. The clock controls *your* logic; the database controls
its own clocks independently.

## 24. Working with retries and circuit breakers

Code that calls external services often wraps calls in a retry loop or
circuit breaker. Integration tests should exercise both the success and
the open-circuit paths.

```go
func TestService_RetriesTransient(t *testing.T) {
    var calls int32
    upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        n := atomic.AddInt32(&calls, 1)
        if n < 3 { http.Error(w, "transient", 500); return }
        w.WriteHeader(200)
    }))
    t.Cleanup(upstream.Close)

    svc := New(upstream.URL, retryBudget(5))
    if err := svc.Call(context.Background()); err != nil {
        t.Fatal(err)
    }
    if c := atomic.LoadInt32(&calls); c != 3 {
        t.Fatalf("got %d calls, want 3", c)
    }
}
```

For circuit breakers, inject a clock so you can advance past the
breaker's reset window without waiting in real time.

## 25. Multi-process integration tests

Sometimes the system under test is two Go binaries communicating over
the network. To run both as part of the test:

```go
func startBinary(t *testing.T, path string, args ...string) string {
    cmd := exec.Command(path, args...)
    var port int32
    cmd.Env = append(os.Environ(), "BIND_PORT=0")
    pr, pw := io.Pipe()
    cmd.Stdout = pw
    cmd.Stderr = pw
    if err := cmd.Start(); err != nil { t.Fatal(err) }
    t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })

    // Parse the listening port from stdout.
    scanner := bufio.NewScanner(pr)
    deadline := time.Now().Add(10 * time.Second)
    for scanner.Scan() {
        if strings.HasPrefix(scanner.Text(), "PORT=") {
            p, _ := strconv.Atoi(strings.TrimPrefix(scanner.Text(), "PORT="))
            atomic.StoreInt32(&port, int32(p))
            break
        }
        if time.Now().After(deadline) { break }
    }
    return fmt.Sprintf("http://127.0.0.1:%d", atomic.LoadInt32(&port))
}
```

The binary prints its port to stdout. The test scans for the line, then
issues HTTP calls to that URL. Real-process integration covers things
that in-process tests cannot: signal handling, environment-variable
parsing, graceful shutdown.

## 26. Snapshot logging

When a test fails on CI, the most precious thing is the chronological
log of everything that happened. Use a structured logger that buffers
into `t.Logf`:

```go
type testWriter struct{ t *testing.T }

func (w *testWriter) Write(p []byte) (int, error) {
    w.t.Logf("%s", strings.TrimRight(string(p), "\n"))
    return len(p), nil
}

logger := slog.New(slog.NewTextHandler(&testWriter{t}, nil))
```

Now every `slog.Info` call goes through `t.Logf`. The Go test runner
only prints these lines on failure or `-v`, keeping passing runs clean.

## 27. Failure metrics

A senior-level harness emits metrics about test execution: setup time,
teardown time, retry counts. These feed CI dashboards and budget
discussions:

```go
defer func(t0 time.Time) {
    metrics.Observe("test_duration_seconds",
        time.Since(t0).Seconds(),
        "test", t.Name(),
        "package", packageName())
}(time.Now())
```

Dashboards track the P95 over time; sudden growth in any individual
test is the early-warning signal.

## 28. Cross-cutting harness concerns

A mature harness handles:

- Image digest pinning.
- Container reuse via `sync.Once`.
- Schema migration into a template database.
- Per-test fresh schema via `CREATE DATABASE ... TEMPLATE`.
- Cleanup at `t.Cleanup` AND a leak check at `TestMain` exit.
- Structured logging routed through `t.Logf`.
- Deterministic random seeds.
- Fake clocks.
- Optional Docker availability check that skips when absent.

A test author should not need to think about any of these. The harness
is the substrate; the test is just the assertion.

## 29. Choosing between testcontainers and dockertest

Both work; both are maintained. Picking criteria:

- Use `testcontainers-go` if you want typed modules (`postgres.Run`,
  `kafka.Run`), structured wait strategies, Ryuk auto-cleanup, and an
  active community.
- Use `ory/dockertest` if your project already uses it, or if you want
  the smallest possible dependency footprint.

Avoid mixing both in the same repo. Migrations are not hard but they
cost time that you do not need to spend.

## 30. Final senior recap

- The harness abstraction is the single most leveraged investment.
- `testcontainers-go` modules cover the common dependencies.
- `dockertest` is the older alternative.
- Multi-container topologies share networks via aliases.
- `bufconn` keeps gRPC tests in-process.
- LocalStack handles AWS-shaped dependencies.
- Factories beat raw SQL for fixture creation.
- Deterministic seeds and fake clocks are non-negotiable at scale.
- CI services accelerate cold runs; testcontainers gives flexibility.
- Observability inside the suite is what tames flakes.
- Race detection, shuffle, deadline-aware contexts keep tests honest.

By the time these patterns feel automatic, you are running a healthy
integration suite at senior level. The Professional page extends them
to organizational scale.

## 31. Worked example — multi-service flow

The most realistic senior-level scenario is a service that touches
several dependencies in one operation. Below is an outline of a test
that exercises a real Postgres, real Redis, and a fake upstream HTTP
service in a single test.

```go
//go:build integration

func TestOrderService_Place(t *testing.T) {
    t.Parallel()
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    db := testenv.FreshDB(t)
    cache := testenv.Redis(t)
    payment := httptest.NewServer(http.HandlerFunc(fakePaymentHandler))
    t.Cleanup(payment.Close)

    svc := order.New(order.Config{
        DB:         db,
        Cache:      cache,
        PaymentURL: payment.URL,
        Clock:      clockwork.NewFakeClockAt(t0),
        Logger:     testLogger(t),
    })

    factories.Account(t, db, factories.Balance(1000), factories.ID(1))
    factories.Product(t, db, factories.Price(250), factories.ID(42))

    o, err := svc.Place(ctx, order.Request{AccountID: 1, ProductID: 42, Qty: 2})
    if err != nil { t.Fatal(err) }
    if o.Status != "paid" { t.Fatalf("got status %q", o.Status) }
    if b := getBalance(t, db, 1); b != 500 {
        t.Fatalf("balance %d, want 500", b)
    }
    if entries := cache.Keys(ctx, "order:*"); len(entries) != 1 {
        t.Fatalf("cache entries %d", len(entries))
    }
}
```

Every dependency in this test is one of three kinds:

- Real container managed by the harness (Postgres, Redis).
- In-process fake (the payment server).
- Injected primitive (clock, logger).

That structure scales. Tests in a healthy senior-level suite read like
the one above — short, declarative, easy to follow.

## 32. Harness design — interfaces over concretes

A common evolution: the first version of `testenv.Postgres(t)` returns
a `*sql.DB`. The second version wraps that into a struct with helper
methods. The third version returns an interface that hides the
underlying technology, allowing the test to run against either
Postgres or an in-memory SQLite when speed matters most:

```go
type Store interface {
    DB() DBTX
    Migrate(t *testing.T)
    Snapshot(t *testing.T) Snapshot
}

func Postgres(t *testing.T) Store { ... }
func SQLite(t *testing.T) Store   { ... }
```

Tests that exercise SQL correctness use `Postgres`. Tests that
exercise business logic use either, controlled by an environment
variable or a build tag. This dual-implementation harness is rare in
small projects, valuable in large ones.

## 33. Snapshot-restore for legacy data

In legacy systems where the production database carries 20 years of
historical data, building fixtures from scratch is impractical. The
solution is a sanitized snapshot — `pg_dump` of production data with
PII removed — restored into the test database before each suite.

```go
func RestoreSnapshot(t *testing.T, db *sql.DB, path string) {
    t.Helper()
    f, err := os.Open(path)
    if err != nil { t.Fatal(err) }
    defer f.Close()
    // Use psql via exec.Command, or a SQL parser. psql is simplest:
    cmd := exec.Command("psql", dsnTo(db))
    cmd.Stdin = f
    if err := cmd.Run(); err != nil { t.Fatal(err) }
}
```

Snapshots are big (GB scale) and slow (seconds to restore). Restore
once per package, never per test. Combine with transactional fixtures
for test isolation.

## 34. Failure injection

Senior-level harnesses include failure injection: ways to make
dependencies misbehave on demand to exercise error paths.

For HTTP fakes:

```go
upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    if r.URL.Query().Get("fail") == "1" {
        http.Error(w, "boom", 500); return
    }
    w.WriteHeader(200)
}))
```

For database mid-test failures, use a connection proxy like
`Shopify/toxiproxy` that the test can configure to drop or delay
packets:

```go
import "github.com/Shopify/toxiproxy/v2/client"

px := client.NewClient("http://localhost:8474")
proxy, _ := px.CreateProxy("pg", "localhost:0", pgAddr)
proxy.AddToxic("latency", "latency", "downstream", 1.0,
    client.Attributes{"latency": 500})
```

Now traffic to Postgres incurs 500ms latency. Tests that should retry
on slow responses get exercised.

## 35. CI-specific cleanups

Some CI runners persist state between jobs. A leftover container holds
a port that the next job's tests expected to be free. Add a pre-test
cleanup step:

```bash
# pre-test.sh
docker ps -q --filter "label=com.docker.compose.project=test" \
    | xargs -r docker rm -f
docker volume prune -f --filter label=test
```

Run as the first step of every integration job. Tiny investment, huge
reliability gain.

## 36. When NOT to write integration tests

Even at senior level, sometimes a unit test is the right tool:

- The function is pure: input in, value out, no I/O. Unit test it.
- The function is a thin wrapper that delegates to a library you do not
  own. Test the library separately; test your wrapper's contract with a
  mock.
- The function is a configuration parser. The dependency (file system)
  is trivially substituted with `embed` or a `strings.NewReader`.

Integration testing has a cost. Choose it when the test pays back in
caught bugs.

## 37. Performance regression catchers

Integration tests are a poor benchmark, but they can catch obvious
regressions. Add a duration assertion to the most performance-sensitive
flow:

```go
t0 := time.Now()
if err := svc.Search(ctx, query); err != nil { t.Fatal(err) }
if d := time.Since(t0); d > 2*time.Second {
    t.Errorf("search took %v, expected < 2s", d)
}
```

The threshold is generous (2s for a normally-200ms operation) to avoid
flake. A 10x regression triggers; smaller ones do not.

A separate proper benchmark suite remains the right place for accurate
performance measurement.

## 38. The senior reading list

To deepen further, study:

- `testcontainers-go` source for the modules you use most.
- `ory/dockertest` to understand the older paradigm.
- `golang-migrate` and `pressly/goose` for migration mechanics.
- `clockwork` or `benbjohnson/clock` for fake clocks.
- `jonboulle/clockwork` v0.4 release notes for new features.
- A real production codebase you trust — read its integration tests.

The pattern recognition that comes from reading other people's tests
is the fastest way to grow beyond senior.

## 39. Where the field is moving

A few trends worth tracking:

- More projects ship vendored containers and proto-fixtures next to
  the code under test.
- `testcontainers-go` modules grow each release. Watch the changelog.
- Go's built-in `testing/synctest` (proposal stage as of 2026) may
  obviate some integration tests for time-dependent logic.
- AI-assisted test generation produces unit tests today; integration
  tests still demand human judgement about which boundaries matter.

Stay curious about new releases; consolidate your patterns; resist
fashion that does not pay back in caught bugs.

## 40. Closing the senior page

You now know the techniques senior engineers reach for when building
and maintaining integration suites in Go. The patterns scale from a
ten-test project to a ten-thousand-test monorepo without fundamental
change.

The Professional page positions these techniques in the context of an
engineering organization — quotas, ownership, sharding, cost. Read it
when you are responsible not just for your own tests but for the
team's suite as a whole.

## 41. Topology diagrams

A realistic senior-level test exercising a multi-service flow has the
following topology in mind:

```
[ Go test process ]
       |
       +-- [ Postgres container ] (shared, TestMain)
       |
       +-- [ Redis container ] (shared, TestMain)
       |
       +-- [ Kafka container ] (per package or shared)
       |
       +-- [ httptest.NewServer ] (fake third-party API)
       |
       +-- [ bufconn listener ] (gRPC service under test)
       |
       +-- [ LocalStack ] (S3 emulator)
```

Each external dependency is either a real container or an in-process
fake. The system under test sees real wire protocols where they matter,
faked ones where they do not.

## 42. The harness's public surface

A senior-level `internal/testenv` package exposes (typical surface):

```go
package testenv

// Postgres returns a shared, migrated Postgres handle.
// Use Fresh to get a per-test database.
func Postgres(t *testing.T) *PG

func (pg *PG) Fresh(t *testing.T) *sql.DB

// Redis returns a shared Redis handle. Use Flush per test.
func Redis(t *testing.T) *RD
func (r *RD) Flush(t *testing.T)

// Kafka returns a shared broker; use Topic per test.
func Kafka(t *testing.T) *KF
func (k *KF) Topic(t *testing.T) string

// HTTP returns an httptest.Server with the given handler.
// Cleans up at t.Cleanup.
func HTTP(t *testing.T, h http.Handler) string

// Clock returns a fake clock set to a fixed instant.
func Clock(t *testing.T) clockwork.FakeClock

// Logger returns a slog.Logger that routes to t.Logf.
func Logger(t *testing.T) *slog.Logger
```

A test imports `testenv` and reaches for these by name. Documentation
lives next to each function via doc comments; new engineers read the
package's godoc and write their first test the same day.

## 43. Composability

The harness functions compose. A complex flow test uses several:

```go
func TestComplexFlow(t *testing.T) {
    t.Parallel()
    db := testenv.Postgres(t).Fresh(t)
    cache := testenv.Redis(t)
    cache.Flush(t)
    topic := testenv.Kafka(t).Topic(t)
    upstream := testenv.HTTP(t, http.HandlerFunc(fakeUpstream))
    clock := testenv.Clock(t)
    logger := testenv.Logger(t)

    svc := app.New(app.Config{
        DB:        db,
        Cache:     cache,
        Topic:     topic,
        Upstream:  upstream,
        Clock:     clock,
        Logger:    logger,
    })

    // ... arrange, act, assert
}
```

Every dependency is wired in three lines. The test reads as the
business intent expresses it.

## 44. Testing observability code

Code that emits metrics or traces deserves integration coverage too.
Use a Prometheus test registry or an OpenTelemetry in-memory exporter:

```go
import (
    "go.opentelemetry.io/otel/sdk/trace"
    "go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestService_EmitsSpan(t *testing.T) {
    exp := tracetest.NewInMemoryExporter()
    provider := trace.NewTracerProvider(trace.WithSyncer(exp))
    defer provider.Shutdown(context.Background())

    tracer := provider.Tracer("test")
    svc := New(Config{Tracer: tracer, ...})
    _ = svc.Do(context.Background())

    spans := exp.GetSpans()
    if len(spans) != 1 { t.Fatalf("got %d spans", len(spans)) }
    if spans[0].Name != "svc.do" {
        t.Errorf("got span name %q", spans[0].Name)
    }
}
```

Without this, observability silently breaks at deployment time.

## 45. Closing the page

Senior-level integration testing in Go is a craft. The patterns
covered here scale to large codebases when applied consistently.
The Professional page situates them in an engineering organization
context — budgets, ownership, sharding, cost.

The next ten years of test infrastructure will undoubtedly bring new
tools. The principles in this page — isolation, determinism, parallel
safety, observability, cost discipline — remain stable. Master the
principles, swap in new tools as they appear.

## 46. Custom matchers

For complex assertions, write a small DSL. Example: asserting a row
exists in Postgres with specific column values.

```go
func assertRow(t *testing.T, db DBTX, query string, args []any,
                cols map[string]any) {
    t.Helper()
    row := db.QueryRow(query, args...)
    keys := make([]string, 0, len(cols))
    for k := range cols { keys = append(keys, k) }
    sort.Strings(keys)
    values := make([]any, len(keys))
    pointers := make([]any, len(keys))
    for i := range values { pointers[i] = &values[i] }
    if err := row.Scan(pointers...); err != nil { t.Fatal(err) }
    for i, k := range keys {
        if !reflect.DeepEqual(values[i], cols[k]) {
            t.Errorf("column %s: got %v, want %v", k, values[i], cols[k])
        }
    }
}
```

Usage:

```go
assertRow(t, db, "SELECT name, status FROM users WHERE id=$1", []any{1},
    map[string]any{"name": "ann", "status": "active"})
```

A library of these matchers shortens tests considerably.

## 47. Property-based integration tests

`pgregory.net/rapid` generates inputs and looks for inputs that
violate a property. Combined with a real database, the harness can
fuzz domain invariants:

```go
func TestRepo_Property_InsertGetRoundTrip(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        db := testenv.Postgres(t.(*testing.T)).Fresh(t.(*testing.T))
        repo := &UserRepo{DB: db}
        name := rapid.String().Draw(t, "name")
        if name == "" { return }
        id, err := repo.Insert(context.Background(), User{Name: name})
        if err != nil { t.Skip() }
        got, err := repo.Get(context.Background(), id)
        if err != nil { t.Fatal(err) }
        if got.Name != name { t.Fatalf("round trip failed: got %q", got.Name) }
    })
}
```

The library shrinks failing inputs to the minimal triggering example.
Property tests catch edge cases unit tests miss; integration property
tests catch them at the database boundary.

## 48. Test execution policies in IDEs

Senior teams configure their IDEs to make integration tests cheap to
run:

- VS Code with the Go extension: a `.vscode/settings.json` setting
  `go.buildTags` for integration projects.
- GoLand: a "Test runner" configuration that supplies `-tags=integration`.
- A `Makefile` target invoked from a key binding (`make test-curr`).

The lower the friction, the more developers run integration tests
before pushing. Reducing the loop from 60 s to 5 s changes behaviour.

## 49. Closing thoughts on senior craft

The senior-level harness is the foundation that everything above it
depends on. The patterns covered here — modular `testenv`, container
reuse, deterministic seeds, fake clocks, structured logs, observability
inside the suite, property tests — combine to make integration tests
a productive force.

Apply selectively. The point is not to build the most sophisticated
harness; the point is to build the harness that makes the team most
productive. Tools are a means; reliable, fast feedback is the end.

By the time the harness is invisible to test authors and the suite
catches real bugs in CI before merge, you have arrived at senior-level
integration testing.

## 50. Mocking at the senior level

There remains a place for mocks in a senior-level test suite:

- Pure boundary types (logger, metrics, clock, ID generator). Injecting
  these as interfaces and providing test doubles is cheaper than
  containerizing them.
- Third-party services where running an emulator is impractical
  (a custom payment gateway with no test mode).
- Behaviour that depends on a specific failure injection (a database
  that returns an error mid-query). A mock controls timing precisely.

The senior heuristic: integration tests where wire-level realism
matters; mocks where deterministic control matters. Both have a place.

## 51. Mocking libraries to know

Even when most boundaries are integration-tested, you will reach for:

- `vektra/mockery` to generate mocks from interfaces.
- `golang/mock` (`gomock`) for older codebases.
- `gojuno/minimock` for stricter type-safety.
- `pashagolub/pgxmock` for mocking `pgx`.

Senior reviewers should know which is in use in the repo and apply it
consistently. Mixing two mock generators in one repo creates friction
for new engineers.

## 52. Test code organization

A senior-level repo organizes test code into several layers:

- `pkg/foo/foo_test.go` — unit tests for the `foo` package.
- `pkg/foo/foo_integration_test.go` — integration tests for `foo`.
- `internal/testenv` — the shared harness.
- `internal/testfactory` — fixture factories.
- `e2e/` — end-to-end tests at the project root.
- `testdata/` — fixture files (JSON, SQL, etc.).

This layout makes it easy to grep for tests by tier (`-name
'*_integration_test.go'`) and to run them selectively in CI.

## 53. Inspecting test artifacts

When a CI run fails, the artifacts you collect determine debugging
speed:

- `go test -v` output (stdout/stderr).
- JUnit XML from `gotestsum`.
- Coverage profile from `-cover`.
- Race detector output (if `-race`).
- Container logs from each dependency.
- Stack traces at panic time.

Collect them all into a `test-artifacts/` directory and upload to the
CI as artifacts. Engineers debug from this directory instead of
re-running the failed test.

## 54. Long-running operations and tests

Code that runs for minutes (e.g., batch jobs) is awkward to integration-
test. Strategies:

- Parameterize the duration. The production setting is 10 minutes;
  tests pass 100ms.
- Use a deterministic clock that the code advances explicitly.
- Test the loop body once with realistic inputs and trust the loop.
- Run a short version end-to-end; cover the long version with a
  separate, nightly soak test.

The choice depends on what you most fear regressing in production.

## 55. Eventual consistency

Cache invalidation, message broker delivery, replica lag — all
introduce eventual consistency. Tests must accommodate without
becoming flaky.

```go
require.Eventually(t, func() bool {
    var n int
    _ = cache.Get(ctx, "key").Scan(&n)
    return n == 42
}, 2*time.Second, 20*time.Millisecond, "cache did not converge")
```

`testify/require.Eventually` polls a condition until it succeeds or
times out. Same pattern can be written by hand; the libraries reduce
boilerplate.

## 56. Cross-version compatibility tests

If your service consumes an API with multiple versions in production
(say, your protobuf-defined gRPC API), the integration suite should
exercise both. Spin a "vN-1" version of the service via Docker
alongside the current build, run a compatibility test against each.

```go
for _, v := range []string{"v1", "v2"} {
    t.Run(v, func(t *testing.T) {
        srv := startService(t, v)
        // assertions
    })
}
```

This catches breaking changes the contract testing missed.

## 57. Why this page is long

By design. Senior-level integration testing covers a wide territory:
multiple dependency types, parallel orchestration, deterministic seeds,
observability, organizational mechanics. Most pages of this length
overcompress; this one tries to keep each pattern self-contained so
you can return to a section years later and still apply it.

If you take one habit from this page, take the harness package
pattern. Everything else compounds on top of it.

## 58. Sample suite metrics

For an idea of what a healthy senior-level suite looks like in
numbers, here are figures from a representative Go service backend
in 2026:

| Metric                              | Value      |
|-------------------------------------|------------|
| Total integration tests             | 320        |
| Median test runtime                 | 180 ms     |
| P95 test runtime                    | 1.2 s      |
| P99 test runtime                    | 2.4 s      |
| Total suite wall time (8 shards)    | 95 s       |
| Total suite wall time (single)      | 4 min 50 s |
| Flake rate                          | 0.18%      |
| Containers started per run          | 6          |
| Coverage on integration-tested code | 78%        |

Numbers vary widely by service. Use these as anchors when reviewing
your own suite's health.

## 59. Going further

After this section, deepen via:

- Reading the `testcontainers-go` contrib modules to see how richer
  dependencies are wrapped.
- Studying integration tests in the Go standard library
  (`net/http/serve_test.go`, `database/sql/sql_test.go`).
- Following talks from GopherCon on test infrastructure.
- Contributing to your own harness; share improvements as PRs that
  others learn from.

Senior integration testing in Go is a small, mature field. The
patterns rarely change; the tooling evolves slowly. Investing time
here pays back over a long career.

## 60. The senior closing thought

A senior engineer's most lasting contribution is often not a
specific feature shipped, but a substrate that makes future features
cheap to ship. Integration tests are that substrate for backend
systems.

When you leave a team, the tests you wrote and the harness you
designed remain. They catch bugs years later for engineers you never
meet. That is the long compound interest of investing in the
integration tier.

Take pride in it.

## 61. One more pattern — typed test helpers

When tests repeatedly construct large objects, typed helpers reduce
noise:

```go
type orderOpt func(*Order)

func withStatus(s string) orderOpt { return func(o *Order) { o.Status = s } }
func withTotal(t int) orderOpt     { return func(o *Order) { o.Total = t } }

func newOrder(t *testing.T, db DBTX, opts ...orderOpt) Order {
    t.Helper()
    o := Order{Status: "new", Total: 100}
    for _, opt := range opts { opt(&o) }
    err := db.QueryRow("INSERT INTO orders(status, total) VALUES($1,$2) RETURNING id",
        o.Status, o.Total).Scan(&o.ID)
    if err != nil { t.Fatal(err) }
    return o
}
```

Tests then read:

```go
o := newOrder(t, db, withStatus("paid"), withTotal(500))
```

Each helper documents the available knobs through its function name.
Defaults are explicit. The pattern compounds: factories of factories
build complex aggregates without test bodies seeing SQL.

## 62. Where to stop

Two failure modes when learning these patterns:

- Applying every pattern to every test. The result is over-engineered
  tests harder to read than the production code.
- Refusing to apply any pattern. The result is fragile tests that
  rot as the team grows.

The senior judgment is knowing where to stop. A small project with
ten integration tests does not need a `testenv` package; copy-paste
works. A medium project with a hundred tests does; build the harness.
A large project needs the harness plus the discipline of this page's
governance recommendations.

Match the investment to the size and life expectancy of the
codebase.

## 63. End of the senior page

The patterns are now in your hands. Go write integration tests, and
when you have written enough of them, come back to mentor others
through the same journey.

## 64. A short reading checklist

A senior engineer should be able to answer each of these without
hesitation:

- Why does each integration test get its own database (or
  transaction)?
- When is `bufconn` the right choice over `httptest`?
- What does Ryuk do, and how would you disable it?
- How do you write a deterministic test for time-based logic?
- What three patterns most often cause test flakes?
- What does `gotestsum --rerun-fails=2` actually do, and when is it
  acceptable?
- How would you debug a CI failure that you cannot reproduce locally?
- How is image digest pinning enforced in your repo?
- Which dependencies should be containerized vs faked?
- What does the harness package look like on your team?

If a question stumps you, re-read the relevant section. The questions
are a self-check, not a quiz.

## 65. Closing the door

That is the last word on senior. Move to Professional for the
organization-scale picture, or to the Interview, Tasks, Find-the-bug
and Optimize pages for sharper, narrower drills.

Good luck.

## 66. Coda

Tests are not the work. The work is shipping reliable software. Tests
are the discipline that makes the work sustainable.

Senior engineers know this in their bones. They invest in tests
proportionally to the risk and stakes of the code under test —
neither under-nor over-investing. They write code that makes future
engineers grateful for the substrate left behind.

Be one of those engineers.

## 67. Truly the end

You have read everything. Now write code, write tests, and review
PRs with the eye this section has trained.
