---
layout: default
title: Mocks and Stubs — Professional
parent: Mocks and Stubs
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/03-mocks-and-stubs/professional/
---

# Mocks and Stubs — Professional

[← Back](../)

This file is for engineers maintaining test infrastructure across a large Go codebase — say, hundreds of packages and dozens of services. The questions here are not "how does `On` work" but "what test-double strategy keeps a 200-engineer team productive over five years?" The answers reflect what has worked at companies running Go at scale; nothing here is novel research, but the trade-offs are easy to miss when you only operate on a small project.

---

## Table of Contents

1. [The strategy question](#the-strategy-question)
2. [Codegen vs hand-roll at scale](#codegen-vs-hand-roll-at-scale)
3. [Mocking external HTTP APIs](#mocking-external-http-apis)
4. [gRPC test doubles](#grpc-test-doubles)
5. [Database fakes vs `sqlmock` vs real DB](#database-fakes-vs-sqlmock-vs-real-db)
6. [Interfaces at module boundaries](#interfaces-at-module-boundaries)
7. [Mock contracts and consumer-driven testing](#mock-contracts-and-consumer-driven-testing)
8. [Generation pipelines in monorepos](#generation-pipelines-in-monorepos)
9. [Operational lessons](#operational-lessons)

---

## The strategy question

Before choosing a framework, decide three things at the team level:

1. **Where do interfaces live?** If consumers define them (idiomatic Go), interfaces are small and per-test stubs are cheap. If producers define them (Java-style), interfaces are large and codegen pays off.
2. **What do tests verify — outcomes or interactions?** Outcome-focused tests (assert on the resulting state) need few mock expectations; interaction-focused tests (assert on call sequences) live or die by their mock vocabulary.
3. **How often do interfaces change?** Interfaces that churn weekly benefit from generators because the regen step is mechanical; stable interfaces do not need them.

A team that gets these three answers consistent across services will look uniform without policing every PR.

---

## Codegen vs hand-roll at scale

A useful threshold: if more than five packages depend on the same interface, generate the mock once and import it. Below that, hand-roll. The cost model:

- **Hand-rolled stub:** 30 lines of straightforward Go, no toolchain.
- **Generated mock:** 150-300 lines of generated code, plus a `go:generate` directive, plus a CI step.

For a 5-method interface used in 50 tests, the generated mock saves ~2000 lines of test scaffolding. For a 2-method interface used in 3 tests, the generator costs more than it saves once you count the build infrastructure.

Concrete pattern that works:

```go
//go:generate mockery --name UserRepo --output ./mocks --case underscore
type UserRepo interface {
    FindByID(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
}
```

CI runs `go generate ./...` and a separate `git diff --exit-code` step that fails if generated files were not committed. This prevents the most common failure mode — engineers regenerate locally but forget to commit.

---

## Mocking external HTTP APIs

Three approaches, ranked by how production-realistic they are:

### 1. `httptest.NewServer` — recommended default

Spin up an in-process HTTP server that returns canned responses. Inject the test server's `URL` into the client under test.

```go
srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    switch r.URL.Path {
    case "/charge":
        w.Header().Set("Content-Type", "application/json")
        _, _ = fmt.Fprintln(w, `{"status":"ok","id":"ch_123"}`)
    default:
        http.NotFound(w, r)
    }
}))
defer srv.Close()

client := payments.New(srv.URL, srv.Client())
err := client.Charge(ctx, 1000, "usd")
require.NoError(t, err)
```

Why this beats `httpmock`:

- Parallel-test safe (each test gets its own port).
- No monkey-patching of `http.DefaultTransport`.
- Exercises the *real* HTTP transport, including headers, encoding, and content negotiation.
- The handler is plain Go, so you can add complexity (delays, conditional 500s, slow drains) without learning a DSL.

### 2. Recorded fixtures (`vcr`-like patterns)

Tools like `github.com/dnaeon/go-vcr` record real responses on first run, then replay them. This works for stable third-party APIs where rebuilding fixtures is rare. The downside: when the third party changes its API contract, your tests still pass against stale tape, hiding the regression until prod.

Use recorded fixtures for:

- Long, complex responses (e.g., large JSON catalogs) that are tedious to handwrite.
- APIs you do not control and rarely change.

Avoid for:

- APIs you control (just spin a real server in CI).
- APIs that change often.

### 3. `httpmock` — only with `ActivateNonDefault`

`github.com/jarcoal/httpmock` patches a transport. Acceptable when:

- You are testing a third-party library that constructs its own `*http.Client` internally and offers no injection point.
- You are migrating an old test suite incrementally.

Always use `httpmock.ActivateNonDefault(yourClient)` rather than `Activate()`, otherwise parallel tests share patched global transport.

---

## gRPC test doubles

gRPC services typically expose a generated `XYZServer` interface. To fake a server:

```go
type fakeUserServer struct {
    userpb.UnimplementedUserServiceServer
    users map[string]*userpb.User
}

func (f *fakeUserServer) GetUser(ctx context.Context, req *userpb.GetUserRequest) (*userpb.GetUserResponse, error) {
    u, ok := f.users[req.GetId()]
    if !ok {
        return nil, status.Error(codes.NotFound, "user not found")
    }
    return &userpb.GetUserResponse{User: u}, nil
}
```

Wire it to a `bufconn` listener for in-process testing without TCP:

```go
lis := bufconn.Listen(1 << 20)
srv := grpc.NewServer()
userpb.RegisterUserServiceServer(srv, &fakeUserServer{users: ...})
go srv.Serve(lis)

conn, _ := grpc.Dial("bufnet", grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
    return lis.Dial()
}), grpc.WithTransportCredentials(insecure.NewCredentials()))
client := userpb.NewUserServiceClient(conn)
```

This pattern is faster than spinning up real gRPC over TCP and is parallel-safe (each test gets its own listener). It is the standard approach inside Google's open-source Go projects.

For *client-side* tests where you want to assert on outgoing gRPC calls, generate a mock of the `XYZClient` interface using `mockgen`:

```bash
mockgen -destination=mocks/user_client_mock.go example.com/userpb UserServiceClient
```

---

## Database fakes vs `sqlmock` vs real DB

Three options, three different roles:

### Real DB via testcontainers

```go
ctx := context.Background()
pgC, err := postgres.RunContainer(ctx,
    testcontainers.WithImage("postgres:16-alpine"),
    postgres.WithDatabase("testdb"),
)
require.NoError(t, err)
t.Cleanup(func() { _ = pgC.Terminate(ctx) })
dsn, _ := pgC.ConnectionString(ctx, "sslmode=disable")
db, _ := sql.Open("postgres", dsn)
```

Use this for:

- Repository implementation tests (does the SQL actually work?).
- Migration tests.
- Anything involving constraints, triggers, or transactions.

Cost: 1-3 seconds startup per test class. Mitigate with a single shared container per package using `TestMain` and per-test transaction rollback for isolation.

### In-memory fake repository

```go
type FakeUserRepo struct {
    mu    sync.Mutex
    items map[string]User
}

func (r *FakeUserRepo) Save(_ context.Context, u User) error {
    r.mu.Lock(); defer r.mu.Unlock()
    r.items[u.ID] = u
    return nil
}

func (r *FakeUserRepo) FindByID(_ context.Context, id string) (User, error) {
    r.mu.Lock(); defer r.mu.Unlock()
    u, ok := r.items[id]
    if !ok { return User{}, ErrNotFound }
    return u, nil
}
```

Use this for:

- Service-layer tests where the repository is a dependency, not the subject.
- Anything that needs to "read what was just written."

The fake is a one-time investment; it amortizes across hundreds of tests. The implementation is short — usually ~50 lines per interface — and lives next to the interface declaration.

### `sqlmock`

Use this *only* when:

- You need to drive specific error paths (e.g., "what happens when `INSERT` returns a unique-violation"?) without configuring the real DB to produce them.
- You are testing a query builder and the test is about the SQL string itself.

Do not use `sqlmock` for general repository tests. The reason: `sqlmock` ties your tests to SQL phrasing. Renaming a column in the `SELECT` list, switching to a CTE, or using `RETURNING` clauses can break tests without changing behavior. Either go higher (in-memory fake) or lower (real DB).

---

## Interfaces at module boundaries

A common anti-pattern in large codebases: the `repo` package exports both the `UserRepo` interface and the concrete `PostgresUserRepo` implementation, and every consumer mocks the interface. After 18 months you have 47 packages all generating mocks for the same interface, each with subtly different `MatchedBy` predicates.

Better: each consumer defines its own narrower interface containing only the methods it uses.

```go
// In package billing
type userLookup interface {
    FindByID(ctx context.Context, id string) (*user.User, error)
}

type Billing struct{ users userLookup }
```

Now `billing` mocks `userLookup` (one method) rather than `user.UserRepo` (twelve methods). Mocks shrink, tests shrink, and refactoring the wider `UserRepo` does not ripple into `billing`'s tests unless the consumed methods actually change.

This requires discipline — every consumer adds a one-line interface declaration. Teams that adopt this convention report 30-60% reductions in test boilerplate after a year.

---

## Mock contracts and consumer-driven testing

In services-over-services architectures, the hard question is: *does the mock match reality?* Two mitigations:

### 1. Shared fakes

Publish a fake implementation alongside the real one:

```
example.com/payments/client       // real client
example.com/payments/clienttest   // FakeClient implementing the same interface
```

Consumers import `clienttest` in their tests. If the real client gains a method, the fake gains a method (caught at compile time). This single change has prevented entire classes of "tests pass, prod breaks" failures in production codebases.

### 2. Contract tests

Run a small set of tests against *both* the real client (in integration CI) and the fake (in unit tests). If both pass, you have high confidence the fake reflects production behavior. Pact and pact-go offer infrastructure for this but a hand-rolled contract suite is usually enough.

---

## Generation pipelines in monorepos

Patterns that survive a monorepo with 500+ generated mock files:

1. **Single configuration file.** `.mockery.yaml` at the repo root, with per-package overrides. Avoids the "every package has its own `go:generate` line that drifts" failure mode.
2. **CI verification step.** Run `go generate ./...` then `git diff --exit-code`. Stale generated files break the build.
3. **Pinned tool versions.** Add `tools.go` with a build tag and import the generator binary so `go mod` tracks the version. Without this, two engineers on different `mockery` versions will produce different output and create unstable diffs.

```go
//go:build tools

package tools

import (
    _ "github.com/vektra/mockery/v2"
    _ "go.uber.org/mock/mockgen"
)
```

Run `go install github.com/vektra/mockery/v2@v2.43.2` from CI matching this pin.

4. **Generated files in their own directory.** `mocks/` next to the package, not interspersed with hand-written code. Reviewers can collapse the directory in PR diffs.

---

## Operational lessons

A few hard-won observations from production Go codebases:

1. **The fastest way to slow down a team is to standardize on a mock framework and not provide examples.** Teams adopt the framework, write bad mocks, and the test suite becomes a refactor barrier.
2. **Test-suite runtime grows non-linearly with mock count.** Setup cost dominates. A test suite that takes 30 seconds at 1000 mocks often takes 4 minutes at 5000 mocks — entirely from per-test `New` calls and reflection.
3. **The boundary between mock and fake is empirical.** Start with mocks (cheap to write per test). When you write the *third* test that needs to "read back what was written," upgrade to a fake (shared, cheap to read).
4. **Engineers prefer hand-rolled stubs once they have written three of them.** The pattern is so simple that the framework feels like ceremony. The trick is getting them to write the first three; that is what the junior file is for.

---

## Decision flowchart

```
Need a test double?
|
+-- Interface has 1-3 methods, used in 1-5 tests
|   -> Hand-rolled stub. Add `var _ I = (*F)(nil)`.
|
+-- Interface has many methods or many consumers
|   |
|   +-- Tests assert call sequences and strict argument types
|   |   -> gomock (go.uber.org/mock)
|   |
|   +-- Tests assert outcomes, occasional call counts
|       -> mockery + testify/mock (with-expecter)
|
+-- Doubling out an external service over the network
|   |
|   +-- HTTP -> httptest.NewServer
|   +-- gRPC -> fake server on bufconn
|
+-- Doubling out a database
    |
    +-- Testing the repo itself -> real DB via testcontainers
    +-- Testing a service above the repo -> in-memory fake
    +-- Specifically asserting on SQL strings -> sqlmock (rare)
```

This flowchart is the single most useful artifact for a team standardizing test doubles. Print it, paste it in the wiki, link to it from PR templates.
