---
layout: default
title: Integration Tests — Interview
parent: Integration Tests
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/13-integration-tests/interview/
---

# Integration Tests — Interview

[← Back](../)

The following questions appear regularly in Go backend interviews when the
discussion turns to testing strategy. Practise them out loud, not just on
paper — interviewers care as much about how you reason as the final
answer.

## Q1 — What separates integration from unit tests in Go?

Integration tests touch a real external dependency — database, message
broker, HTTP peer. Unit tests stay inside the process and replace I/O with
fakes. The `//go:build integration` tag is the conventional gate; without
the tag the file is excluded from compilation.

A strong follow-up answer mentions the test pyramid: many unit, fewer
integration, very few end-to-end. The point of integration is to catch
contract drift between your code and the real dependency, which unit tests
with mocks cannot do because the mock is part of the contract you wrote.

## Q2 — Why prefer `testcontainers-go` over a shared dev Postgres?

Containers per suite give you isolation, version pinning, parallel runs
and a clean shutdown. A shared dev DB couples engineers, leaks state and
breaks CI determinism. The cost is image pull on first run, which caches
afterwards.

If pushed: mention `testcontainers-go` modules (`postgres.Run`,
`redis.Run`, `kafka.Run`), the Ryuk sidecar that cleans up orphans, and
the alternative `ory/dockertest` for older projects.

## Q3 — How do you handle expensive setup that all tests share?

`TestMain` creates the container once, exposes its DSN via a package
variable, calls `m.Run()`, then tears down before `os.Exit`. Each `Test*`
opens its own database or transaction so isolation survives.

```go
func TestMain(m *testing.M) {
    ctx := context.Background()
    pg, err := postgres.Run(ctx, "postgres:16-alpine",
        postgres.WithDatabase("template"),
        postgres.BasicWaitStrategies())
    if err != nil { log.Fatal(err) }
    adminDSN, _ = pg.ConnectionString(ctx, "sslmode=disable")
    code := m.Run()
    _ = pg.Terminate(ctx)
    os.Exit(code)
}
```

Watch out for `os.Exit` bypassing deferred functions — terminate before
exit, not after.

## Q4 — When do you use `httptest.NewServer` vs a containerized HTTP service?

`httptest` is right for testing your own handler in-process. It is fast,
hermetic, and lets you inspect captured request state directly. When you
need the actual third-party server — RabbitMQ management UI, Stripe
emulator, Wiremock — you reach for a container.

Bonus answer: if the third-party publishes an SDK with a fake mode (Stripe
test cards, AWS LocalStack), prefer that over containerizing the real
thing.

## Q5 — How do you keep integration tests parallel-safe?

Either give each test its own database (CREATE DATABASE per test, or use
a randomized schema), or wrap the test body in a transaction that always
rolls back. Avoid shared global tables; avoid global package state in
general.

A common antipattern is one shared `*sql.DB` mutated by every parallel
test. The fix is to give each `t.Parallel()` test a fresh handle to an
isolated database created in a helper.

## Q6 — Why bind to port `:0`?

`net.Listen("tcp", ":0")` asks the kernel for a free ephemeral port. Hard-
coded ports clash under parallel execution and force test runs to be
sequential. After listening, read `ln.Addr().String()` to find out which
port the kernel assigned.

`httptest.NewServer` does this for you. For non-HTTP servers (gRPC, raw
TCP), you write the listener yourself.

## Q7 — How do you stop flaky integration tests?

Investigate, do not retry. Common roots:

- Missing wait strategy on container start.
- `time.Sleep` instead of poll loop.
- Shared global state.
- Ordering assumptions on `range` over a map.
- Random data without a logged seed.

Fix the root cause. Only then add a bounded retry for genuinely networked
operations — and even there, prefer increasing the deadline over retrying
a flaky assertion.

A flake budget such as "no more than 0.5% of runs may be retried" is a
healthy organizational guardrail.

## Q8 — Compare `testcontainers-go` and `ory/dockertest`.

Both wrap the Docker API. `testcontainers-go` ships richer modules
(`postgres.Run`, `redis.Run`, `kafka.Run`), structured wait strategies and
Ryuk for orphan cleanup. `ory/dockertest` is older and smaller; the API
is more imperative (`pool.Run`, `pool.Purge`, `pool.Retry`).

New projects usually pick `testcontainers-go` for the module ecosystem
and stronger wait abstractions. Legacy projects keep `dockertest`. Both
work in CI; both spin real containers; the choice is mostly ergonomic.

## Q9 — How do you run integration tests in GitHub Actions?

Two options:

1. Test-managed containers via testcontainers-go inside the test process.
   Works on any runner with Docker.
2. CI-managed `services:` declared in the workflow, which GitHub starts
   and health-checks before your job runs.

The first keeps test infrastructure in code and stays portable to local
runs; the second wins when image pulls dominate. Many teams use a hybrid:
declared services for the hot path, testcontainers for rare or custom
images.

## Q10 — What is the test pyramid and how do integration tests fit?

Many unit tests, fewer integration tests, very few E2E tests. Integration
tests cover the contracts between modules and real infrastructure — the
risk that unit tests miss but E2E is too slow to cover broadly.

Numbers from a healthy mid-size Go monorepo: 25 000 unit tests in 90 s,
1 500 integration tests in 240 s, 80 E2E tests in 14 min.

## Q11 — How do you test code that publishes to Kafka?

Spin a Kafka container with `kafka.Run` from `testcontainers-go`. Read
brokers via `k.Brokers(ctx)`. Use `segmentio/kafka-go` or `confluent-kafka-go`
to produce and consume. Generate a unique topic name per test using
`t.Name() + randSuffix()` so parallel tests do not collide.

Wrap every call in `context.WithTimeout` to prevent a stuck broker from
hanging CI.

## Q12 — What is the role of `t.Cleanup`?

`t.Cleanup` registers a function to run when the test and all its subtests
have finished, even if `t.Fatal` was called. It replaces older patterns
based on `defer` in the test body, which did not survive `t.Fatal` from
helper functions.

Rule: register cleanup AFTER successful allocation. Otherwise you risk
cleaning up a nil resource.

## Q13 — How do you handle database migrations in tests?

Apply migrations once into a template database inside `TestMain`. Each
test does `CREATE DATABASE testN TEMPLATE template`, which is a near-
instant operation in Postgres. The result: each test starts on a
correctly-versioned schema for free.

Tools: `golang-migrate/migrate`, `pressly/goose`, `rubenv/sql-migrate`.

## Q14 — Describe transactional fixtures.

A test begins a transaction, performs all reads and writes through it,
and `t.Cleanup` rolls the transaction back. The database is unchanged for
the next test. Cheaper than `CREATE DATABASE` per test, but limited to
code paths that accept a `DBTX`-style interface and to scenarios that do
not depend on commit triggers.

## Q15 — How do you make integration tests deterministic across runs?

- Inject a clock (e.g. `clockwork` or `jonboulle/clockwork`) instead of
  calling `time.Now`.
- Seed random sources from an environment variable; print the seed.
- Order map iterations by sorting keys.
- Use stable IDs (UUIDv7 with a deterministic seed) for fixtures.
- Avoid network calls to anything outside the harness.

If a failing run on CI cannot be reproduced locally with the same seed,
deterministic discipline is missing somewhere.

## Q16 — When would you skip an integration test?

`t.Skip` is the answer when a dependency cannot be provided. Examples:

- Docker is not available on the local machine.
- The test targets a feature flag that is currently off.
- The test requires hardware that is not in CI.

`t.Skip` is preferable to commenting code out — it shows up in test
output and reminds the team to re-enable.

## Q17 — How would you architect a harness for a 50-engineer codebase?

A small `internal/testenv` package exposes one function per dependency:
`testenv.Postgres(t)`, `testenv.Redis(t)`, `testenv.Kafka(t)`. Each
returns a typed handle with helpers (`db.Fresh(t)` for a new database,
`kafka.Topic(t)` for a unique topic). Internally the harness uses
`sync.Once` to start each container once per process.

The benefits: zero boilerplate in tests, central place to upgrade
image versions, easy enforcement of cleanup discipline.

## Q18 — When is a unit test better than an integration test?

When the function is pure (input -> output, no I/O) or when the I/O
boundary is well-covered by another, more focused integration test.
Unit tests run 100x faster and remain useful for regression coverage.

A balanced suite has many unit tests, fewer integration tests, very few
end-to-end tests. Integration tests cover the wiring between modules
and external infrastructure; everything else stays at the unit tier.

## Q19 — How do you debug a slow integration test?

1. Run with `-v` to see per-test timings.
2. Run `gotestsum --jsonfile out.json --post-run-command 'jq -s
   "sort_by(-.elapsed)[:10]" out.json'` to find the longest tests.
3. Add `t.Logf` lines around suspected slow sections; their timestamps
   reveal which step dominates.
4. Profile the test binary with `go test -cpuprofile=cpu.out -run
   TestSlow` and `go tool pprof cpu.out`.
5. Compare with a working baseline; the diff is usually a missing
   wait strategy or repeated container creation.

## Q20 — What is Ryuk in testcontainers-go?

Ryuk is a sidecar container that the library launches alongside your
tests. It watches the test process and, if the process dies
unexpectedly (kill -9, panic, network drop), terminates all containers
labeled by the test session.

Ryuk prevents the most common cleanup failure: a developer hits
Ctrl-C, leaves Docker containers running for hours. With Ryuk, the
containers go away within seconds of the test process exiting.

You can disable Ryuk via `TESTCONTAINERS_RYUK_DISABLED=true` if your
environment forbids extra containers, but the default keeps you safer.

## Q21 — What is bufconn and when do you use it?

`google.golang.org/grpc/test/bufconn` provides an in-process listener
suitable for gRPC tests. The server runs in the same process as the
test; the connection bypasses the kernel. Latency is near-zero.

Use bufconn when:

- Testing your gRPC service handlers end-to-end.
- You want grpc-go's full negotiation (HTTP/2, codec, interceptors)
  without a real socket.

Use a real `net.Listen` when:

- Multiple processes must communicate.
- You want to exercise TCP-level behavior (proxies, timeouts).

## Q22 — How would you test a service that talks to S3?

Spin LocalStack via
`github.com/testcontainers/testcontainers-go/modules/localstack`.
Point the AWS SDK at the LocalStack endpoint by overriding the
`EndpointResolver`. Tests use the real AWS Go SDK; LocalStack emulates
the API.

Alternative: AWS provides DynamoDB Local and SQS Local as standalone
containers. Use those if LocalStack does not cover the API you need.

## Q23 — How would you keep test containers shared across packages?

Generally, you should not. Tests in different packages run in parallel
test binaries; sharing a container across binaries requires
inter-process coordination (e.g. via a registry, a fixed port, or a
shared socket file).

If the harness cost is dominating, share within a package via
`TestMain` and accept the per-package cost. Sharing across packages is
fragile and rarely worth it.

## Q24 — What happens when `TestMain` calls `m.Run()` zero times?

If you forget to invoke `m.Run`, the tests simply do not run. The
test binary exits cleanly. The runner reports zero tests executed.

Always pair `code := m.Run()` with `os.Exit(code)` at the end.

## Q25 — How would you write a test for a feature flag?

Inject the flag via a configuration interface, not via `os.Getenv`
inside the function. Tests pass a typed flag value:

```go
cfg := Config{Flags: Flags{NewBilling: true}}
svc := New(cfg)
```

Integration test exercises both branches. The flag becomes a normal
parameter.

## Q26 — How would you handle test data that contains secrets?

Never commit real secrets. Use fake values that look realistic:
`sk_test_1234567890`, `email@example.com`, `password-placeholder`.
For CI, declare secrets as environment variables managed by the CI
system; tests read them via `t.Setenv` mirrors.

## Q27 — What is the role of test pyramids beyond Go?

The test pyramid is language-agnostic. Java, Python, Rust, TypeScript
codebases all stratify into unit, integration, end-to-end. The Go-
specific tooling differs (`testing.T`, `testcontainers-go`); the
strategy does not.
