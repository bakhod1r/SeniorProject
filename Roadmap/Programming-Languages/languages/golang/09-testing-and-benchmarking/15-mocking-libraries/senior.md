---
layout: default
title: Mocking Libraries — Senior
parent: Mocking Libraries Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/15-mocking-libraries/senior/
---

# Mocking Libraries — Senior

[← Back](../)

This file maps the rest of the Go mocking ecosystem. We cover `moq` and
`counterfeiter` (alternative codegen tools), HTTP-layer mocks
(`jarcoal/httpmock`, `httptest`), SQL mocks (`DATA-DOG/go-sqlmock`),
Redis mocks (`go-redismock`), gRPC testing strategies including
`bufconn`, and we close with a comparison matrix and a per-layer
recommendation.

## 1. `github.com/matryer/moq`

`moq` is a simpler codegen than mockgen. It produces a plain struct
with function fields, no controller, no reflection, no DSL. Given:

```go
package store

import "context"

//go:generate go run github.com/matryer/moq -out user_repo_moq.go . UserRepo

type UserRepo interface {
    Get(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
}
```

`moq` produces:

```go
type UserRepoMock struct {
    GetFunc  func(ctx context.Context, id string) (*User, error)
    SaveFunc func(ctx context.Context, u *User) error

    calls struct {
        Get  []struct{ Ctx context.Context; ID string }
        Save []struct{ Ctx context.Context; U *User }
    }
}

func (m *UserRepoMock) Get(ctx context.Context, id string) (*User, error) {
    if m.GetFunc == nil {
        panic("UserRepoMock.GetFunc: method is nil but UserRepo.Get was called")
    }
    // record call
    m.calls.Get = append(m.calls.Get, struct{ Ctx context.Context; ID string }{ctx, id})
    return m.GetFunc(ctx, id)
}

func (m *UserRepoMock) GetCalls() []struct{ Ctx context.Context; ID string } {
    return m.calls.Get
}
```

Usage:

```go
repo := &storemocks.UserRepoMock{
    GetFunc: func(ctx context.Context, id string) (*store.User, error) {
        return &store.User{ID: id, Name: "Test"}, nil
    },
}

svc := store.NewService(repo)
got, _ := svc.Get(ctx, "u1")

if len(repo.GetCalls()) != 1 {
    t.Errorf("Get called %d times, want 1", len(repo.GetCalls()))
}
if repo.GetCalls()[0].ID != "u1" {
    t.Errorf("Get called with id %q", repo.GetCalls()[0].ID)
}
```

### moq trade-offs

Strengths:

- Zero runtime dependencies — generated code uses only stdlib.
- Fully type-safe — each function field has the exact method signature.
- No DSL to learn — set a function, call methods on it.
- Each call is recorded in a typed struct; post-hoc assertions are easy.

Weaknesses:

- No built-in expectation/strictness — if your test forgets to assert
  on `GetCalls()`, an unexpected call passes silently.
- No matchers — argument validation happens inside the function body.
- No ordering primitives — write your own with sentinels.

`moq` is the right choice when you value simplicity over strictness.
Often used for small interfaces (1–3 methods) where the ceremony of
gomock feels heavy.

## 2. `github.com/maxbrunsfeld/counterfeiter`

`counterfeiter` is the spiritual cousin of `moq` from the Cloud Foundry
world. It generates "fakes" rather than "mocks" — the terminology
emphasizes that the generated type is a stand-in implementation, not a
strict expectation engine.

Install:

```bash
go install github.com/maxbrunsfeld/counterfeiter/v6@latest
```

Generate:

```bash
counterfeiter -o internal/store/fakes/fake_user_repo.go \
    ./internal/store UserRepo
```

Produces a `FakeUserRepo` struct with the same function-field pattern as
`moq`, plus richer call recording:

```go
type FakeUserRepo struct {
    GetStub        func(ctx context.Context, id string) (*store.User, error)
    getMutex       sync.RWMutex
    getArgsForCall []struct{
        ctx context.Context
        id  string
    }
    getReturns struct{
        result1 *store.User
        result2 error
    }
    getReturnsOnCall map[int]struct{
        result1 *store.User
        result2 error
    }
    invocations      map[string][][]interface{}
    invocationsMutex sync.RWMutex
}

func (fake *FakeUserRepo) Get(ctx context.Context, id string) (*store.User, error) {...}
func (fake *FakeUserRepo) GetCallCount() int {...}
func (fake *FakeUserRepo) GetCalls(stub func(context.Context, string) (*store.User, error))
func (fake *FakeUserRepo) GetArgsForCall(i int) (context.Context, string) {...}
func (fake *FakeUserRepo) GetReturns(result1 *store.User, result2 error) {...}
func (fake *FakeUserRepo) GetReturnsOnCall(i int, result1 *store.User, result2 error) {...}
func (fake *FakeUserRepo) Invocations() map[string][][]interface{} {...}
```

Usage:

```go
fake := &storefakes.FakeUserRepo{}
fake.GetReturns(&store.User{ID: "u1"}, nil)

svc := store.NewService(fake)
_, _ = svc.Get(ctx, "u1")

require.Equal(t, 1, fake.GetCallCount())
gotCtx, gotID := fake.GetArgsForCall(0)
require.Equal(t, "u1", gotID)
_ = gotCtx
```

### counterfeiter trade-offs

Strengths:

- Generates a thread-safe fake (mutex around call recording).
- Explicit return setters (`GetReturns`, `GetReturnsOnCall`) plus stub
  function fallback.
- Records arguments in a typed-indexable form (`GetArgsForCall(i)`).
- Used heavily in Cloud Foundry, BOSH, and Pivotal codebases.

Weaknesses:

- More boilerplate in generated code than `moq`.
- No matchers or expectation engine — same as `moq`.
- Larger generated files (~100+ lines per method).

`counterfeiter` is a solid choice if you like its idiom or already have
it in your dependency graph. For new projects, `moq` is usually simpler.

## 3. `jarcoal/httpmock`

Mocking HTTP at the `http.Client` level. The library patches
`http.DefaultTransport` (or a custom client) to intercept requests and
return programmed responses.

Install:

```bash
go get github.com/jarcoal/httpmock
```

Basic use:

```go
import "github.com/jarcoal/httpmock"

func TestWeatherClient(t *testing.T) {
    httpmock.Activate()
    defer httpmock.DeactivateAndReset()

    httpmock.RegisterResponder("GET",
        "https://api.weather.example/forecast?city=Tashkent",
        httpmock.NewStringResponder(200, `{"temp":21.5}`))

    client := weather.NewClient(http.DefaultClient,
        "https://api.weather.example")
    temp, err := client.Forecast(context.Background(), "Tashkent")
    require.NoError(t, err)
    require.Equal(t, 21.5, temp)
}
```

For non-`DefaultClient` clients:

```go
client := &http.Client{Transport: ...}
httpmock.ActivateNonDefault(client)
defer httpmock.DeactivateAndReset()
```

### Responders

- `httpmock.NewStringResponder(status, body)` — fixed string.
- `httpmock.NewBytesResponder(status, body)` — fixed bytes.
- `httpmock.NewJsonResponderOrPanic(status, obj)` — JSON-encoded object.
- `httpmock.NewErrorResponder(err)` — simulate transport error
  (timeout, DNS failure).
- `httpmock.ResponderFromResponse(*http.Response)` — full custom.
- Custom function:

  ```go
  httpmock.RegisterResponder("POST", "https://x.example/create",
      func(req *http.Request) (*http.Response, error) {
          body, _ := io.ReadAll(req.Body)
          if !bytes.Contains(body, []byte(`"name":"Alice"`)) {
              return httpmock.NewStringResponse(400, "missing name"), nil
          }
          return httpmock.NewJsonResponse(201, map[string]string{"id": "u1"})
      })
  ```

### URL pattern matching

`RegisterRegexpResponder` accepts a regex URL pattern; useful when
query strings vary:

```go
httpmock.RegisterRegexpResponder("GET",
    regexp.MustCompile(`^https://api\.example/users/\w+$`),
    httpmock.NewStringResponder(200, `{"id":"u1"}`))
```

### Call counting

```go
info := httpmock.GetCallCountInfo()
require.Equal(t, 2, info[`GET https://api.weather.example/forecast?city=Tashkent`])
```

### Common pitfalls

- **Forgetting `DeactivateAndReset`.** httpmock patches a global. Without
  reset, the patch leaks between tests and the order-dependence makes
  CI flaky.
- **Default vs custom transport.** Code that constructs its own
  `http.Client` (e.g. AWS SDK) does not use `DefaultTransport`. Either
  inject the client into your client, or use `ActivateNonDefault`.
- **Empty response bodies.** Some HTTP libraries require a non-nil
  body. Use `httpmock.NewStringResponder(204, "")` for explicit empty
  bodies.

### Alternative — `httptest.NewServer`

Standard library has `httptest`:

```go
srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(200)
    fmt.Fprint(w, `{"temp":21.5}`)
}))
defer srv.Close()

client := weather.NewClient(http.DefaultClient, srv.URL)
```

`httptest` is the lower-level option. It spins up a real HTTP server on a
random port. Use it when:

- You want to test the real HTTP roundtrip (headers, status, body).
- You don't want to monkey-patch transports.
- You need TLS (`httptest.NewTLSServer`).

`httpmock` is more convenient for stubbing many URLs in one test;
`httptest` is more realistic. I default to `httptest` for new code and
fall back to `httpmock` when the URLs are pinned externally (third-party
SDKs that don't take a base URL parameter).

## 4. `DATA-DOG/go-sqlmock`

Mocks the `database/sql` driver interface. Lets you assert on SQL
queries and return canned rows without a real database.

Install:

```bash
go get github.com/DATA-DOG/go-sqlmock
```

Basic use:

```go
import "github.com/DATA-DOG/go-sqlmock"

func TestUserRepo_GetByID(t *testing.T) {
    db, mock, err := sqlmock.New()
    require.NoError(t, err)
    defer db.Close()

    rows := sqlmock.NewRows([]string{"id", "name"}).
        AddRow("u1", "Alice")
    mock.ExpectQuery(`SELECT id, name FROM users WHERE id = \$1`).
        WithArgs("u1").
        WillReturnRows(rows)

    repo := store.NewUserRepo(db)
    u, err := repo.GetByID(context.Background(), "u1")
    require.NoError(t, err)
    require.Equal(t, "Alice", u.Name)

    require.NoError(t, mock.ExpectationsWereMet())
}
```

### Matchers

By default `sqlmock` uses regex matching (`QueryMatcherRegexp`). Anchor
with `^` and `$` for exact-match-with-escapes:

```go
mock.ExpectQuery(`^SELECT id, name FROM users WHERE id = \$1$`)
```

Or switch to exact-match mode:

```go
db, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
mock.ExpectQuery("SELECT id, name FROM users WHERE id = $1")
```

### Transactions

```go
mock.ExpectBegin()
mock.ExpectExec("INSERT INTO users").
    WithArgs("u1", "Alice").
    WillReturnResult(sqlmock.NewResult(1, 1))
mock.ExpectCommit()
```

If your code uses `db.BeginTx` with options, `ExpectBegin().WillReturnError`
or `WithOptions` lets you control begin behavior.

### Errors

```go
mock.ExpectQuery("SELECT").WillReturnError(sql.ErrConnDone)
mock.ExpectQuery("SELECT").WillReturnRows(rows).WillDelayFor(2 * time.Second)
```

### Pitfalls

- **Loose regex.** `ExpectQuery("SELECT")` matches any `SELECT`. Anchor
  or switch to `QueryMatcherEqual`.
- **Argument types.** `WithArgs(1)` and `WithArgs(int64(1))` are
  different in sqlmock; mismatch fails the expectation. Use the same
  type your driver passes (usually `int64` for `int`).
- **Order.** sqlmock requires expectations in order. If your code does
  two queries in either order, use `MatchExpectationsInOrder(false)`:

  ```go
  db, mock, _ := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
  mock.MatchExpectationsInOrder(false)
  ```

- **Forgetting `mock.ExpectationsWereMet`.** Same trap as testify
  without `AssertExpectations`.

### Higher-level alternatives

For complex repository tests, sqlmock can become unwieldy. Alternatives:

- **Real database in CI** (e.g. PostgreSQL in a Docker container via
  `testcontainers-go`). Slower per test but exercises real SQL.
- **In-memory SQLite** for stateless transactional tests.
- **Repository fake** — implement the interface against a `map`.

sqlmock shines when you want to assert on the exact SQL the repository
produces (e.g. when validating that a query uses an index). For pure
"does this CRUD method work" tests, a fake repository is usually
better.

## 5. Redis mocks

Two common libraries:

- `github.com/go-redis/redismock/v9` — for `github.com/redis/go-redis/v9`
  clients.
- `github.com/elliotchance/redismock` — older, less maintained.

Example with redismock v9:

```go
import (
    "github.com/go-redis/redismock/v9"
)

func TestCache(t *testing.T) {
    db, mock := redismock.NewClientMock()
    defer db.Close()

    mock.ExpectGet("user:u1").SetVal(`{"id":"u1","name":"Alice"}`)
    mock.ExpectSet("user:u1", `{"id":"u1","name":"Alice"}`, time.Hour).
        SetVal("OK")

    cache := cache.NewUserCache(db)
    u, err := cache.Get(context.Background(), "u1")
    require.NoError(t, err)
    require.Equal(t, "Alice", u.Name)
    require.NoError(t, mock.ExpectationsWereMet())
}
```

### Alternative — `miniredis`

`github.com/alicebob/miniredis/v2` is an in-memory Redis server (real
RESP protocol, real commands, real expiry). It's the Redis equivalent
of `httptest.NewServer`:

```go
import "github.com/alicebob/miniredis/v2"

func TestCacheReal(t *testing.T) {
    s := miniredis.RunT(t)
    db := redis.NewClient(&redis.Options{Addr: s.Addr()})
    cache := cache.NewUserCache(db)

    // Real Redis behavior, in-memory.
    _ = cache.Set(ctx, &user.User{ID: "u1", Name: "Alice"})
    u, _ := cache.Get(ctx, "u1")
    require.Equal(t, "Alice", u.Name)

    // miniredis lets you inspect or manipulate state.
    require.True(t, s.Exists("user:u1"))
    s.FastForward(time.Hour) // advance time for TTL tests
    require.False(t, s.Exists("user:u1"))
}
```

`miniredis` is usually superior to `redismock` because:

- It exercises real protocol parsing.
- TTLs work without simulating time.
- Lua scripts work.
- You can swap to a real Redis with zero code changes.

Use `redismock` only when you want to assert on the exact sequence of
commands (e.g. for compliance tests).

## 6. gRPC — `bufconn` vs interface mocking

For gRPC services, you have two testing strategies:

### Strategy A — Mock the generated client interface

`protoc-gen-go-grpc` produces a `pb.UserServiceClient` interface. You can
mock it with `mockgen`:

```bash
mockgen example.com/myapp/proto UserServiceClient \
    -destination=internal/usermocks/userservice_client_mock.go \
    -package=usermocks
```

Then test code that consumes `pb.UserServiceClient`:

```go
ctrl := gomock.NewController(t)
client := usermocks.NewMockUserServiceClient(ctrl)
client.EXPECT().GetUser(gomock.Any(), gomock.Any()).
    Return(&pb.GetUserResponse{Id: "u1", Name: "Alice"}, nil)

svc := myapp.NewService(client)
// ...
```

Use this when the SUT only uses the client to call one or two RPCs and
you don't care about serialization, interceptors, or transport.

### Strategy B — Run real client and server over `bufconn`

`google.golang.org/grpc/test/bufconn` is an in-memory `net.Listener`.
You can run a real gRPC server on it and connect a real client without
opening a TCP port:

```go
import (
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
    "google.golang.org/grpc/test/bufconn"
)

func TestServiceEndToEnd(t *testing.T) {
    lis := bufconn.Listen(1 << 20) // 1 MiB buffer
    srv := grpc.NewServer()
    pb.RegisterUserServiceServer(srv, &fakeUserServer{
        users: map[string]string{"u1": "Alice"},
    })
    go func() { _ = srv.Serve(lis) }()
    defer srv.Stop()

    dialer := func(ctx context.Context, _ string) (net.Conn, error) {
        return lis.Dial()
    }
    conn, err := grpc.DialContext(context.Background(), "bufnet",
        grpc.WithContextDialer(dialer),
        grpc.WithTransportCredentials(insecure.NewCredentials()))
    require.NoError(t, err)
    defer conn.Close()

    client := pb.NewUserServiceClient(conn)
    resp, err := client.GetUser(context.Background(), &pb.GetUserRequest{Id: "u1"})
    require.NoError(t, err)
    require.Equal(t, "Alice", resp.Name)
}

type fakeUserServer struct {
    pb.UnimplementedUserServiceServer
    users map[string]string
}

func (f *fakeUserServer) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.GetUserResponse, error) {
    name, ok := f.users[req.Id]
    if !ok {
        return nil, status.Error(codes.NotFound, "not found")
    }
    return &pb.GetUserResponse{Id: req.Id, Name: name}, nil
}
```

This pattern:

- Exercises real serialization and framing.
- Exercises real interceptors (auth, tracing, retries).
- Runs as fast as in-process function calls (no TCP, no DNS).
- Lets you test streaming RPCs realistically.

For most gRPC service tests, **bufconn is the right answer.** Use mocks
only when you need to inject fault behavior (e.g. specific gRPC error
codes) that's hard to produce from the fake server.

### Streaming RPCs

For server-streaming RPCs, the bufconn approach is essential. Mocking
streams via gomock requires implementing the stream interface
(`pb.UserService_StreamUsersServer`) with `Send`/`Recv` methods, which
is verbose and error-prone. With bufconn:

```go
stream, _ := client.StreamUsers(ctx, &pb.StreamRequest{})
for {
    user, err := stream.Recv()
    if err == io.EOF { break }
    require.NoError(t, err)
    // assert on user
}
```

Real streaming, in-memory. Hard to beat.

## 7. The comparison matrix

| Library                              | Style         | Generation | Strictness | Type Safety | Notes                                  |
| ------------------------------------ | ------------- | ---------- | ---------- | ----------- | -------------------------------------- |
| `go.uber.org/mock` (gomock)          | DSL           | codegen    | strict     | full        | Successor to `golang/mock`             |
| `github.com/stretchr/testify/mock`   | DSL           | hand or codegen | lenient by default | runtime | Most popular in ecosystem              |
| `github.com/vektra/mockery`          | testify-style | codegen    | configurable | partial→full with `with-expecter` | Testify's preferred generator |
| `github.com/matryer/moq`             | function fields | codegen   | lenient    | full        | Simplest                               |
| `github.com/maxbrunsfeld/counterfeiter` | function fields | codegen | lenient    | full        | Heavier than moq; Cloud Foundry origin |
| `github.com/jarcoal/httpmock`        | transport patch | none     | lenient    | partial     | For HTTP clients                       |
| `net/http/httptest`                  | real server   | none       | n/a        | full        | Stdlib; better than httpmock for many cases |
| `github.com/DATA-DOG/go-sqlmock`     | driver patch  | none       | strict     | partial     | For `database/sql` drivers             |
| `github.com/go-redis/redismock/v9`   | client wrap   | none       | strict     | partial     | For go-redis client                    |
| `github.com/alicebob/miniredis/v2`   | real in-mem server | none  | n/a        | full        | Real Redis behavior, in-memory         |
| `google.golang.org/grpc/test/bufconn` | real listener | none      | n/a        | full        | For gRPC end-to-end                    |

Pattern: the libraries split along two axes — **codegen vs runtime**,
and **strict mock vs lenient fake**. Codegen + strict = gomock.
Codegen + lenient = moq, counterfeiter, mockery-without-expecter.
Real-implementation = httptest, miniredis, bufconn. Driver-patch =
sqlmock, httpmock.

The senior-level decision: which to pick for each layer.

## 8. Per-layer recommendation

For a new Go service in 2026:

| Layer                | First choice                  | When to use the second choice          |
| -------------------- | ----------------------------- | -------------------------------------- |
| Domain interfaces    | gomock or moq                 | testify+mockery if codebase uses testify|
| HTTP client          | `httptest.NewServer`          | `httpmock` if base URL is not injectable |
| Database (driver)    | sqlmock for query assertions  | `testcontainers-go` PostgreSQL for full coverage |
| Database (repo)      | hand-written fake             | sqlmock for query-shape assertions     |
| Redis                | `miniredis`                   | `redismock` for command-sequence assertions |
| gRPC service         | `bufconn` + fake server       | gomock client mock for fault injection |
| gRPC client caller   | `bufconn` + fake server       | gomock client mock for narrow tests    |
| File system          | `afero.NewMemMapFs`           | hand-rolled os.File mock (rare)        |
| Clock                | `clockwork.NewFakeClock`      | hand-rolled clock interface mock       |

The pattern across the table: prefer **real implementations in-memory**
when they exist (httptest, miniredis, bufconn, afero, clockwork) over
strict mocks. Use strict mocks (gomock) for **domain interfaces** where
no real implementation is cheap to construct.

## 9. Hybrid approach — fakes for repos, mocks for ports

A pattern that ages well in large codebases:

- **Repository interfaces** get hand-written in-memory fakes. Tests use
  the fake throughout. A small contract test runs against both the
  fake and a real database to catch behavioral drift.
- **Port interfaces** (notifier, audit logger, metrics, external APIs)
  get gomock-generated mocks. Tests configure expectations per case.

```go
// Test using fake repo + mock notifier
repo := fakerepo.New() // in-memory map
notifier := mocks.NewMockNotifier(ctrl)
notifier.EXPECT().Notify(gomock.Any(), "user_created", gomock.Any()).Return(nil)

svc := user.NewService(repo, notifier)
require.NoError(t, svc.Create(ctx, "alice"))

// Assert observable repo state (fake style)
got, err := repo.GetByName("alice")
require.NoError(t, err)
require.NotEmpty(t, got.ID)

// Strict assertion on notification (mock style)
// already verified by ctrl cleanup
```

The fake repo lets tests focus on business behavior; the mock notifier
lets tests assert the side effect happened.

## 10. The mocks-vs-fakes long-term cost analysis

Five years from now, the codebase will have refactored its data layer
multiple times. With **mocks-only** tests, every refactor breaks many
tests because the call sequence changed. With **fakes-only** tests,
refactors usually pass — only true behavior changes break tests.

Empirically, in a 200-service codebase, the maintenance cost of mock-
heavy tests is roughly 2–3× the cost of fake-heavy tests, because mocks
need updating every time the SUT's implementation drifts.

This is the strongest argument for fakes. The strongest argument for
mocks is that they catch unintended side effects (e.g. "this refactor
added a duplicate Save call") that fakes wouldn't notice.

A pragmatic split: mocks for **assertions on side effects**, fakes for
**state-based assertions**. The notification service example in section 9
illustrates this.

## 11. Reading the generated code

A useful exercise: take a generated mock from each of the libraries
covered here and read it line by line. You'll learn:

- gomock encodes expectations in a `gomock.Call` linked list inside the
  controller.
- mockery generates a per-method `_Call` type that supports `Run`,
  `Return`, `RunAndReturn`.
- moq's generated code is the simplest; the call recording is just a
  slice of structs.
- counterfeiter records into a `map[string][][]interface{}` that loses
  type safety on access (`Invocations()`).
- httpmock stores a map of responders keyed by `method + URL pattern`.
- sqlmock keeps a queue of expectations and dequeues on each driver
  call.

Understanding the implementations makes the libraries less magical and
helps you debug edge cases (e.g. why a particular matcher doesn't
match) without trial and error.

## 12. Choosing for an open-source library

If you're writing a library others will consume, your test
infrastructure becomes part of your contribution surface:

- Avoid heavy dependencies (gomock and testify both pull in their own
  trees). `moq` is the lightest (zero runtime deps).
- Use stdlib `httptest` over `httpmock` to avoid pulling
  `jarcoal/httpmock` into your contributors' module graphs.
- Document your test setup so contributors know how to run tests.

For your own services, the dependency cost is irrelevant. For libraries,
it shows up in `go.sum` of every consumer.

## 13. CI considerations

In CI, generated mocks deserve a check that they are up to date:

```bash
go generate ./...
git diff --exit-code -- ':(glob)**/mock_*.go' ':(glob)**/mocks/'
```

If `git diff --exit-code` returns non-zero, the working tree has
modifications, which means the committed mocks are stale. Failing CI on
this prevents the common pattern of merging a change to an interface
without regenerating mocks.

A small subtlety: `go generate` is not transitively triggered by
`go test`. You must run it explicitly. Some teams add a `make test`
that does both.

## 14. The deprecation watch

Libraries to watch in 2026:

- **`github.com/golang/mock`** — archived June 2023. Migrate to
  `go.uber.org/mock`.
- **`github.com/stretchr/testify/v2`** — the v2 beta has been stable
  for years. The v1 line is still the default.
- **`mockery` v3** — the redesign. Watch the release notes; v2 will
  continue receiving fixes for some time.
- **`github.com/elliotchance/redismock`** — superseded by
  `go-redis/redismock`.

The Go ecosystem favors stability, so changes are slow. But check
yearly to avoid being on archived libraries.

## 15. Summary

You should now have a map of the Go mocking landscape with enough detail
to make informed choices:

- **Domain mocks** — gomock (strict, codegen) or testify+mockery
  (popular, codegen). For new code, lean toward gomock.
- **HTTP** — `httptest` for new code; `httpmock` for legacy or
  third-party SDKs.
- **SQL** — sqlmock for query-shape assertions; testcontainers for full
  fidelity; fakes for repository-level tests.
- **Redis** — miniredis for behavior, redismock for command-sequence
  assertions.
- **gRPC** — bufconn for service tests; gomock client mock for narrow
  caller tests.
- **Lightweight codegen** — moq is the simplest; counterfeiter if you
  prefer its idiom.

The professional.md file explores migration paths, mock-driven design
pitfalls, and the strategic question of mocks vs fakes in more depth.

## 16. Appendix — full bufconn helper

A reusable helper for bufconn-based gRPC tests:

```go
package grpctest

import (
    "context"
    "net"
    "testing"

    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
    "google.golang.org/grpc/test/bufconn"
)

const bufSize = 1 << 20

func NewServer(t *testing.T, register func(*grpc.Server)) *grpc.ClientConn {
    t.Helper()
    lis := bufconn.Listen(bufSize)
    srv := grpc.NewServer()
    register(srv)

    go func() { _ = srv.Serve(lis) }()
    t.Cleanup(srv.Stop)

    conn, err := grpc.DialContext(context.Background(), "bufnet",
        grpc.WithContextDialer(func(_ context.Context, _ string) (net.Conn, error) {
            return lis.Dial()
        }),
        grpc.WithTransportCredentials(insecure.NewCredentials()))
    if err != nil {
        t.Fatalf("dial bufconn: %v", err)
    }
    t.Cleanup(func() { _ = conn.Close() })
    return conn
}
```

Usage:

```go
conn := grpctest.NewServer(t, func(s *grpc.Server) {
    pb.RegisterUserServiceServer(s, &fakeUserServer{})
})
client := pb.NewUserServiceClient(conn)
// ... use client
```

Drop this into `internal/testutil/grpctest/` and every gRPC test in your
codebase becomes a four-line setup. Pair it with a small fake server
per service and you have a robust, fast, realistic test setup.

## 17. Appendix — full httptest helper

For HTTP-client tests:

```go
package httptest_util

import (
    "io"
    "net/http"
    "net/http/httptest"
    "testing"
)

type Handler func(t *testing.T, w http.ResponseWriter, r *http.Request)

func NewServer(t *testing.T, handlers map[string]Handler) (*httptest.Server, *http.Client) {
    t.Helper()
    mux := http.NewServeMux()
    for path, h := range handlers {
        h := h
        mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
            h(t, w, r)
        })
    }
    srv := httptest.NewServer(mux)
    t.Cleanup(srv.Close)
    return srv, srv.Client()
}
```

Usage:

```go
srv, client := httptest_util.NewServer(t, map[string]httptest_util.Handler{
    "/users/u1": func(t *testing.T, w http.ResponseWriter, r *http.Request) {
        require.Equal(t, "Bearer secret", r.Header.Get("Authorization"))
        _, _ = io.WriteString(w, `{"id":"u1","name":"Alice"}`)
    },
})

api := myapp.NewAPIClient(client, srv.URL, "secret")
u, err := api.GetUser(ctx, "u1")
require.NoError(t, err)
require.Equal(t, "Alice", u.Name)
```

Patterns like this make HTTP-client tests boringly straightforward.
The verbosity of explicit handlers is offset by the realism of testing
against real HTTP.

## 18. Deeper — moq with method-level call ordering

moq doesn't have an ordering DSL, but its call-recording slice gives you
post-hoc ordering. To enforce "X must be called before Y":

```go
type orderedMock struct {
    *storemocks.UserRepoMock
}

func TestOrderViaSlice(t *testing.T) {
    repo := &storemocks.UserRepoMock{
        GetFunc:  func(ctx context.Context, id string) (*store.User, error) {
            return &store.User{ID: id}, nil
        },
        SaveFunc: func(ctx context.Context, u *store.User) error { return nil },
    }

    svc := store.NewService(repo)
    require.NoError(t, svc.GetAndSave(ctx, "u1"))

    require.Equal(t, 1, len(repo.GetCalls()))
    require.Equal(t, 1, len(repo.SaveCalls()))
    // No global "what happened first" record without union;
    // for true cross-method ordering, hand-write a wrapper.
}
```

For real cross-method ordering with moq, write a wrapper:

```go
type orderedRepo struct {
    *storemocks.UserRepoMock
    ops *[]string
}

func (r *orderedRepo) Get(ctx context.Context, id string) (*store.User, error) {
    *r.ops = append(*r.ops, "Get:"+id)
    return r.UserRepoMock.Get(ctx, id)
}

func (r *orderedRepo) Save(ctx context.Context, u *store.User) error {
    *r.ops = append(*r.ops, "Save:"+u.ID)
    return r.UserRepoMock.Save(ctx, u)
}
```

Now `ops` tracks the global order. This is more work than `gomock.InOrder`
but it's the cost of moq's simplicity.

## 19. Deeper — counterfeiter for streaming-style interfaces

counterfeiter handles function-type fields well, which makes it pleasant
for callback-heavy interfaces:

```go
type EventSubscriber interface {
    Subscribe(topic string, handler func(Event)) error
    Unsubscribe(topic string) error
}
```

Generated fake:

```go
type FakeEventSubscriber struct {
    SubscribeStub func(string, func(Event)) error
    // ...
}

// Test
fake := &FakeEventSubscriber{
    SubscribeStub: func(topic string, h func(Event)) error {
        go h(Event{ID: "e1", Topic: topic})
        go h(Event{ID: "e2", Topic: topic})
        return nil
    },
}
```

Sub's stub function can call the handler argument, simulating
asynchronous event delivery. This is harder to do cleanly in gomock
because gomock's `DoAndReturn` doesn't naturally model "call this
callback later".

## 20. Deeper — sqlmock pitfalls in practice

### Driver argument types

The driver receives all arguments as `driver.Value`, which is one of:
`int64`, `float64`, `bool`, `[]byte`, `string`, `time.Time`, `nil`. If
your code passes a custom type that implements `driver.Valuer`, sqlmock
sees the result of `Value()`, not the original type. Match accordingly:

```go
mock.ExpectQuery("SELECT").WithArgs(int64(42)).WillReturnRows(rows)
// NOT WithArgs(42), because Go's int is converted to int64 in the driver.
```

### Multiple rows

```go
rows := sqlmock.NewRows([]string{"id", "name"}).
    AddRow("u1", "Alice").
    AddRow("u2", "Bob")
mock.ExpectQuery("SELECT id, name FROM users").
    WillReturnRows(rows)
```

The driver iterates these in order. If your code does `LIMIT 1`, you
still need to declare two rows — sqlmock doesn't know about SQL
semantics; it just returns what you told it to.

### Row close errors

Test that your repository handles row iteration errors correctly:

```go
rows := sqlmock.NewRows([]string{"id"}).
    AddRow("u1").
    RowError(0, errors.New("scan failed"))
mock.ExpectQuery("SELECT id").WillReturnRows(rows)
```

This triggers `rows.Err()` to return the error after iteration. Your
repo code should check `rows.Err()` after `rows.Next()` returns false;
this test verifies it does.

### Prepared statements

If your code uses `db.Prepare(...)` instead of `db.Query(...)`, declare:

```go
mock.ExpectPrepare("SELECT id FROM users WHERE name = ?").
    ExpectQuery().WithArgs("Alice").
    WillReturnRows(rows)
```

Common bug: declaring `ExpectQuery` without `ExpectPrepare` first, and
then the test fails with "prepared statement not expected".

## 21. Deeper — miniredis testing patterns

### Pub/Sub

miniredis supports basic pub/sub:

```go
s := miniredis.RunT(t)
db := redis.NewClient(&redis.Options{Addr: s.Addr()})

pubsub := db.Subscribe(ctx, "events")
defer pubsub.Close()

// In production code, something publishes:
require.NoError(t, db.Publish(ctx, "events", "hello").Err())

msg, err := pubsub.ReceiveMessage(ctx)
require.NoError(t, err)
require.Equal(t, "hello", msg.Payload)
```

### Lua scripts

```go
script := redis.NewScript(`return redis.call("GET", KEYS[1])`)
_, _ = db.Set(ctx, "foo", "bar", 0).Result()
val, err := script.Run(ctx, db, []string{"foo"}).Text()
require.NoError(t, err)
require.Equal(t, "bar", val)
```

miniredis evaluates Lua scripts in a Go-based interpreter. Not 100%
compatible with real Redis Lua (some edge cases differ), but covers
the common patterns.

### Time travel

```go
db.Set(ctx, "foo", "bar", 10*time.Second)
require.True(t, s.Exists("foo"))
s.FastForward(11 * time.Second)
require.False(t, s.Exists("foo"))
```

`FastForward` advances miniredis's internal clock and expires keys.
Invaluable for testing TTL-based cache eviction without sleeping.

### Cluster mode

miniredis can simulate a single-node "cluster" but doesn't support real
multi-shard cluster semantics. If your code uses
`redis.NewClusterClient`, point it at miniredis's address but be aware
that cross-slot operations behave differently than in real cluster.

## 22. Deeper — bufconn advanced patterns

### Server interceptors

Real interceptors run with bufconn, so auth, tracing, and recovery
middleware get exercised:

```go
srv := grpc.NewServer(
    grpc.UnaryInterceptor(authInterceptor),
    grpc.StreamInterceptor(streamAuthInterceptor),
)
pb.RegisterUserServiceServer(srv, &fakeUserServer{})
```

A test for an unauthenticated request:

```go
conn := grpctest.NewServer(t, register)
client := pb.NewUserServiceClient(conn)

_, err := client.GetUser(context.Background(), &pb.GetUserRequest{})
require.Error(t, err)
require.Equal(t, codes.Unauthenticated, status.Code(err))
```

The interceptor rejects, the test passes. This exercise wouldn't be
possible with pure interface mocking.

### TLS

bufconn supports TLS:

```go
cert, err := tls.LoadX509KeyPair("test-cert.pem", "test-key.pem")
require.NoError(t, err)
creds := credentials.NewServerTLSFromCert(&cert)
srv := grpc.NewServer(grpc.Creds(creds))
```

Client side dials with matching credentials. Realistic for testing
mTLS-enabled services.

### Streaming with deadlines

Test that a server respects context deadlines:

```go
ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
defer cancel()

stream, err := client.StreamUsers(ctx, &pb.StreamRequest{})
require.NoError(t, err)

for {
    _, err := stream.Recv()
    if err != nil {
        require.Equal(t, codes.DeadlineExceeded, status.Code(err))
        break
    }
}
```

Real gRPC deadline propagation, in 100ms of wall time.

## 23. Decision tree for mocking layer choice

When you face a "should I mock this" decision, walk the tree:

1. Is the dependency a pure function (no state, no I/O)?
   - Yes: don't mock. Pass a different function or use the real one.
2. Is the dependency a clock?
   - Yes: use `clockwork` or similar.
3. Is the dependency a file system?
   - Yes: use `afero.NewMemMapFs`.
4. Is the dependency an HTTP client?
   - Code can take a base URL: use `httptest.NewServer`.
   - Third-party SDK with hard-coded URLs: use `httpmock`.
5. Is the dependency a DB?
   - Repository-level test (CRUD logic): in-memory fake.
   - Query-shape assertion (specific SQL or index use): sqlmock.
   - Migration or vendor-specific feature: testcontainers + real DB.
6. Is the dependency Redis?
   - Behavior test: miniredis.
   - Command-sequence assertion: redismock.
7. Is the dependency a gRPC service?
   - Service test: bufconn + fake server.
   - Caller test (narrow): gomock client mock + bufconn for cross-checks.
8. Is the dependency a domain port (notifier, audit log, metrics)?
   - Strict assertion needed: gomock or testify/mock.
   - Lenient with state assertion: moq or hand-rolled fake.

This tree captures most real-world cases. The principle behind it:
**use real implementations in-memory when they exist; use mocks only
where they don't.**

## 24. Anti-patterns to avoid

### 24.1 Mocking your own concrete types

```go
type UserService struct{} // a concrete type
type MockUserService struct{ /* ... */ } // doesn't compile, but conceptually
```

Mocks are for interfaces. If you find yourself wanting to mock a
concrete struct, extract an interface — but only after considering
whether the test should instead exercise the concrete code directly.

### 24.2 Test that mirrors implementation

```go
// SUT
func (s *Service) Create(ctx context.Context, name string) error {
    if err := s.repo.Save(ctx, &User{Name: name}); err != nil {
        return err
    }
    if err := s.notifier.Notify(ctx, "user_created", name); err != nil {
        s.logger.Error("notify failed", err)
    }
    s.metrics.Inc("users.created")
    return nil
}

// Test
repo.EXPECT().Save(...).Return(nil)
notifier.EXPECT().Notify(...).Return(nil)
metrics.EXPECT().Inc("users.created")
```

This test asserts each line of the SUT. Refactoring "I'll batch the
metric increment elsewhere" breaks the test even though behavior is
the same.

Fix: assert on **behavior** (a notification was sent, the user is
persisted), not on every method call.

### 24.3 Brittle string matching

```go
repo.EXPECT().Query("SELECT * FROM users WHERE created_at > $1")
```

If somebody reformats the query, your test breaks. Use sqlmock with
regex anchoring or assert at a higher level.

### 24.4 Test the mock, not the SUT

```go
// SUT: Service.GetByID is a one-line wrapper around Repo.GetByID
repo.EXPECT().GetByID(...).Return(user, nil)
got, _ := svc.GetByID(ctx, "u1")
require.Equal(t, user, got)
```

This test proves the wrapper forwards correctly. If the wrapper is
truly a wrapper, the test has no value. Either add logic worth testing
or test at the integration level.

### 24.5 Asserting on internal interface methods

If you extract an interface purely to mock it, then have one test that
uses the mock, you've added complexity for one benefit. Often the
right move is to delete the interface and pass the concrete type.

## 25. Mocking and the "test contract"

A test is a contract between you (the test author) and the SUT. The
contract says: "If you call my dependencies in this pattern with these
arguments, you get these results, and the behavior is X."

Mocks define **what the dependencies receive**. The test asserts on
**what the SUT does**. The two halves must remain consistent.

A common failure mode: the test asserts on something the mock doesn't
actually drive. E.g. "the SUT returns the user's name" is asserted, but
the mock returns a `*User` with name "Alice" — so the test really
asserts "the SUT returns whatever name the repo provides", not "the SUT
returns the user's name correctly". The test passes but doesn't catch
bugs where the SUT looks up a different user.

To strengthen tests, vary the mock's return value across cases:

```go
testCases := []struct {
    name        string
    user        *User
    wantName    string
}{
    {"normal", &User{ID: "u1", Name: "Alice"}, "Alice"},
    {"empty name", &User{ID: "u2", Name: ""}, ""},
    {"unicode", &User{ID: "u3", Name: "Алиса"}, "Алиса"},
}

for _, tc := range testCases {
    repo.EXPECT().Get(ctx, gomock.Any()).Return(tc.user, nil)
    got, _ := svc.GetName(ctx, tc.user.ID)
    require.Equal(t, tc.wantName, got)
}
```

By varying input, you actually prove the SUT preserves the data
faithfully, not just that it doesn't crash.

## 26. The last thing — when to walk away from mocks

There are scenarios where mocking is the wrong choice and you should
not even try:

- The dependency is a value, not a behavior. Just pass the value.
- The dependency is a small pure function. Just call it.
- The dependency is `time.Now`. Inject a `func() time.Time` and pass
  `time.Now` in production, `func() time.Time { return fixedTime }` in
  tests. No interface, no mock library.
- The test is a smoke test. Run against real systems.
- The test is a property-based test. Use real implementations to
  preserve invariants.

A litmus test: if you find yourself writing the same mock setup in
every test of a function, the function probably needs less mocking.
Either inject a fake once at the package level (via `TestMain`) or
refactor the function to take values instead of behaviors.

## 27. Final words

Mocking libraries are tools, not philosophy. The same codebase can
mix mockgen for some interfaces, mockery for others, miniredis for the
cache layer, bufconn for gRPC services, and httptest for HTTP clients —
and that's fine. What matters is that each test is **clear**,
**fast**, and **honest about what it asserts**.

The `professional.md` file goes deeper on the strategic questions:
migrating from `github.com/golang/mock` to `go.uber.org/mock`, where to
put generated mocks, mock-driven design pitfalls, and the long-term
case for fakes over mocks.

## 28. Cross-language perspective

Programmers coming from other ecosystems often look for direct
equivalents. A quick map:

| Concept                | Java (Mockito)              | Python (unittest.mock) | Go equivalent                           |
| ---------------------- | --------------------------- | ---------------------- | --------------------------------------- |
| Strict mock            | `Mockito.mock(strict=true)` | `MagicMock(spec=...)`  | gomock                                  |
| Lenient mock           | default                     | default                | testify/mock without AssertExpectations |
| Stubbing               | `when(...).thenReturn(...)` | `m.X.return_value=...` | `.EXPECT().Method(...).Return(...)`     |
| Argument capture       | `ArgumentCaptor`            | `mock.call_args`       | `DoAndReturn` with closure              |
| Verify call count      | `verify(m, times(2))`       | `assert m.call_count==2` | `.Times(2)`                            |
| Order verify           | `InOrder`                   | manual                 | `gomock.InOrder`                        |

The Java/Python world tends to default to lenient mocks with explicit
verification. Go's gomock breaks from that pattern by being strict by
default, which most engineers prefer after a project or two.

## 29. Reproducing common third-party mocks

If your codebase consumes a third-party SDK (AWS, Stripe, etc.), you
often need a mock of one of their interfaces. Pattern:

1. Find the interface in the SDK. AWS SDK v2 puts client interfaces in
   each service package, e.g. `s3.PutObjectAPIClient`.
2. Generate a mock with mockgen or mockery.
3. Inject the SDK client interface into your code, not the concrete
   client.

```go
// Your code
type S3Putter interface {
    PutObject(ctx context.Context, input *s3.PutObjectInput, opts ...func(*s3.Options)) (*s3.PutObjectOutput, error)
}

type Uploader struct {
    s3 S3Putter
}

// Test
mockS3 := mocks.NewMockS3Putter(ctrl)
mockS3.EXPECT().PutObject(gomock.Any(), gomock.Any()).
    Return(&s3.PutObjectOutput{}, nil)

u := &Uploader{s3: mockS3}
require.NoError(t, u.Upload(ctx, "key", []byte("data")))
```

The narrow interface (one method, not the full AWS S3 API surface) is
key: it limits the mock to what you actually use, which makes the test
clear and resilient to SDK changes.

## 30. The shortest possible test setup

For a junior engineer joining your project, the test setup should be
boring. The shortest possible:

```go
func TestX(t *testing.T) {
    repo := mocks.NewMockUserRepo(t) // mockery's auto-cleanup constructor
    repo.EXPECT().Get(mock.Anything, "u1").Return(&user.User{ID: "u1"}, nil)

    svc := user.NewService(repo)
    got, err := svc.Get(context.Background(), "u1")
    require.NoError(t, err)
    require.Equal(t, "u1", got.ID)
}
```

Six lines after the function header. No controllers, no Finish, no
manual cleanup. This is what mocking should feel like 90% of the time.
The other 10% — ordering, dynamic responses, capture — is where the
library complexity earns its keep.

If your project's test setup looks more elaborate than this for simple
cases, ask why. Often the answer is "we wrote helpers wrong" or "we
chose the wrong library". Either way, simplification pays off.

## 31. Where to go next

After this file, read `professional.md` for the strategic questions
(migration, placement, mocks vs fakes long-term). Then come back to
`tasks.md` to put it all into practice. By the end you should have
hands-on experience with at least gomock, mockery, moq, sqlmock,
httpmock, miniredis, and bufconn — enough to face any Go test setup
with confidence.
