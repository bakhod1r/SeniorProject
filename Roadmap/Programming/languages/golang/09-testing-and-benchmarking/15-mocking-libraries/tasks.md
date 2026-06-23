---
layout: default
title: Mocking Libraries — Tasks
parent: Mocking Libraries Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/15-mocking-libraries/tasks/
---

# Mocking Libraries — Tasks

[← Back](../)

The tasks below are progressive. Each builds on the previous one. Use the
official module paths exactly as cited.

## Task 1 — gomock from scratch

Install `go.uber.org/mock/mockgen` and generate a mock for the following
interface. Write a single test that exercises `Save` and verifies it was
called exactly once with the right argument.

```go
package store

type EventStore interface {
    Save(ctx context.Context, e Event) error
}

type Event struct {
    ID   string
    Body []byte
}
```

Acceptance:

- `mock_store.go` is produced by `//go:generate mockgen -source=store.go
   -destination=mock_store.go -package=store`.
- The test uses `gomock.NewController(t)` and `EXPECT().Save(...)`.
- Running `go test ./...` passes; deleting the `Save` call in the SUT causes
  the test to fail.

## Task 2 — testify/mock equivalent

Rewrite the same test using `github.com/stretchr/testify/mock`. Write the
mock by hand (no codegen). Verify with `mock.AssertExpectations(t)`.

Acceptance:

- The hand-written mock embeds `mock.Mock`.
- A typo in the method name (e.g. `Sve` instead of `Save`) is not caught at
  compile time — note this in a comment explaining the trade-off.

## Task 3 — mockery codegen

Add `mockery` to the project, configure `.mockery.yaml` to generate into
`internal/store/mocks/`, and regenerate. Convert the test from Task 2 to use
the mockery-generated mock with `with-expecter: true`.

Acceptance:

- `.mockery.yaml` lives at the repo root.
- The generated file is `internal/store/mocks/EventStore.go`.
- The test uses `mocks.NewEventStore(t).EXPECT().Save(ctx, event).Return(nil)`.

## Task 4 — moq codegen

Add a `//go:generate go run github.com/matryer/moq -out event_store_moq.go .
EventStore` directive. Use the generated mock in a test where the SUT calls
`Save` twice, and assert the second argument by reading the `SaveCalls()`
slice.

Acceptance:

- The mock is generated without writing YAML config.
- The test reads `mock.SaveCalls()[1].E.ID` to verify the second call's ID.

## Task 5 — HTTP client with httpmock

Write a `WeatherClient` that calls `https://api.example.com/weather?city=X`
and returns the temperature. Test it with `github.com/jarcoal/httpmock`:

```go
httpmock.Activate()
defer httpmock.DeactivateAndReset()
httpmock.RegisterResponder("GET",
    "https://api.example.com/weather?city=Tashkent",
    httpmock.NewStringResponder(200, `{"temp":21}`))
```

Acceptance:

- A test using a 500 response asserts the client returns a wrapped error.
- A test using a malformed body asserts a parse error.

## Task 6 — DB with sqlmock

Install `github.com/DATA-DOG/go-sqlmock`. Write a `UserRepo.GetByID(ctx, id)`
that runs a single `SELECT`. Test it with sqlmock:

```go
mock.ExpectQuery("SELECT id, name FROM users WHERE id = \\$1").
    WithArgs("u1").
    WillReturnRows(sqlmock.NewRows([]string{"id", "name"}).
        AddRow("u1", "Alice"))
```

Acceptance:

- The test asserts `mock.ExpectationsWereMet()` at the end.
- A second test simulates `sql.ErrNoRows` and asserts the repo returns the
  domain-specific `ErrUserNotFound`.

## Task 7 — gRPC with bufconn

Define a small `pb.UserService` with one RPC `GetUser`. Implement a server.
In the test, start the server on `bufconn.Listen(1 << 20)` and dial it with
the custom dialer. Assert that the real client and server work end to end.

Acceptance:

- No mocks of the gRPC client are used.
- The test runs in under 100ms.

## Task 8 — Redis with miniredis

Build a `UserCache` that uses `github.com/redis/go-redis/v9`:

```go
type UserCache struct {
    rdb *redis.Client
}

func (c *UserCache) Set(ctx context.Context, u *User) error { ... }
func (c *UserCache) Get(ctx context.Context, id string) (*User, error) { ... }
```

Test it with `github.com/alicebob/miniredis/v2`. Verify:

- A `Set` followed by a `Get` returns the stored value.
- A `Get` of an unknown key returns `redis.Nil`.
- After `miniredis.FastForward(ttl + 1)`, the key is gone.

Acceptance:

- Tests use `miniredis.RunT(t)`.
- Each test creates its own miniredis instance (no shared state).
- The test suite runs in under 200ms.

## Task 9 — Comparing testify and gomock on the same SUT

Write two test files for the same `UserService`:

- `service_gomock_test.go` — uses `go.uber.org/mock`.
- `service_testify_test.go` — uses `github.com/stretchr/testify/mock`
  with a hand-written mock.

Both test files cover the same five scenarios. After implementing:

1. Count lines of mock setup per test in each file.
2. Force a typo: rename `Save` to `Sve` on the production interface.
   Note which test file's compilation breaks first.
3. Remove the `Save` call from one test path in the SUT. Note which
   test file's failure message is more useful.

Acceptance:

- Both test files pass before the typo experiment.
- The typo experiment yields a write-up of "gomock catches at compile,
  testify catches at runtime".

## Task 10 — Migrate from `github.com/golang/mock` to `go.uber.org/mock`

Find a public Go project still using the archived
`github.com/golang/mock`. Fork it, perform the migration:

1. Update `go.mod`: replace the dependency.
2. Rewrite imports across the codebase.
3. Reinstall `mockgen` from the new module.
4. Regenerate all mocks.
5. Run tests; fix any drift.
6. Commit as a single PR with a clear description.

Acceptance:

- All tests pass.
- `git grep "github.com/golang/mock"` returns nothing.
- The diff is mostly mechanical (imports + regeneration).

## Task 11 — Replace a mock-heavy test with a fake

Find one of the test files you wrote in Tasks 1-3 (the `UserService`
tests). Replace the mocked `UserRepo` with a hand-written
`fakeUserRepo` storing data in a `map[string]*User`. Adjust the tests:

- Pre-populate the fake before the SUT runs (instead of `EXPECT().Get`).
- Assert on the fake's final state after the SUT runs (instead of
  `EXPECT().Save`).

Compare:

- Total line count (mock-based vs fake-based).
- Robustness: refactor the SUT to call `Save` twice. Which test still
  passes?

Acceptance:

- The fake is reusable across multiple test functions.
- Tests using the fake survive the "Save twice" refactor; tests using
  the mock fail.

## Task 12 — Contract test for a fake

Take the fake from Task 11. Write a `repoContractTest` function that
takes a `func() UserRepo` factory and runs the same five tests against
whatever it returns. Run it against both:

- The fake.
- A real `*sql.DB`-backed repository (using
  `github.com/testcontainers/testcontainers-go` for PostgreSQL).

Acceptance:

- The same test file passes against both implementations.
- The PostgreSQL test is gated behind `-short=false` so it doesn't run
  on every push.

## Task 13 — Counterfeiter for a callback-heavy interface

Define an interface with a callback parameter:

```go
type EventBus interface {
    Subscribe(topic string, handler func(event Event)) (cancel func(), err error)
}
```

Generate a counterfeiter fake. Write a test where the SUT subscribes,
the fake invokes the handler twice with different events, and the SUT
processes both. Assert that the SUT's internal state reflects both
events.

Acceptance:

- Uses `counterfeiter -o ./fakes/event_bus_fake.go . EventBus`.
- Test reads `fake.SubscribeCallCount()` and `fake.SubscribeArgsForCall(0)`
  to verify the topic.
- Handler is invoked from inside the `SubscribeStub` function.

## Task 14 — Mockgen reflect mode for an external package

Generate a mock for `crypto/tls.ClientHelloInfo` accessor functions
(actually a struct, but for the sake of practice — use an interface from
an external package, e.g. `aws-sdk-go-v2/service/s3.PutObjectAPIClient`).

Acceptance:

- Generated in reflect mode (no source file path).
- Mock is used in a test that exercises the consumer code.

## Task 15 — Add CI check for stale mocks

Add a CI step to your repo:

```yaml
- name: Verify mocks are up to date
  run: |
    go generate ./...
    git diff --exit-code
```

Make a change that adds a method to one of your mocked interfaces.
Without regenerating, push and observe the CI failure. Then regenerate
locally and observe the CI pass.

Acceptance:

- The check fails when mocks are out of date.
- The check passes when mocks are regenerated.
- A README section documents how to regenerate locally.

## Task 16 — Refactor a mock-heavy test into property-based test

Pick one of your gomock-based tests and convert it to a property-based
test using `testing/quick` or `pgregory.net/rapid`. The mock will need
to behave dynamically (different inputs each iteration). Use
`DoAndReturn` to compute responses based on the input.

```go
import "pgregory.net/rapid"

func TestServiceProperty(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        ctrl := gomock.NewController(t)
        repo := mocks.NewMockUserRepo(ctrl)
        repo.EXPECT().Get(gomock.Any(), gomock.Any()).
            DoAndReturn(func(_ context.Context, id string) (*User, error) {
                return &User{ID: id, Name: "test-" + id}, nil
            }).
            AnyTimes()

        id := rapid.String().Draw(t, "id")
        svc := user.NewService(repo)
        got, err := svc.Get(context.Background(), id)
        require.NoError(t, err)
        require.Equal(t, id, got.ID)
    })
}
```

Acceptance:

- The test exercises the SUT with at least 100 random inputs per
  invocation.
- The mock returns dynamic data per call (not the same hardcoded
  value).
- The test catches a regression you intentionally introduce in the SUT.

## Task 17 — Comparison report

Write a 1-page report comparing your experience across Tasks 1-15. For
each library you used, note:

- Setup time (minutes).
- Lines of code per typical test.
- Failure-message helpfulness on a 1-10 scale.
- Refactor resilience (did renames break tests unnecessarily?).
- Whether you would pick it for a new project.

This report becomes a useful artifact for your team to standardize
on a mocking approach.

Acceptance:

- Report exists at `docs/mocking-comparison.md` in your project.
- Includes at least 6 libraries (gomock, mockery, testify hand-rolled,
  moq, httpmock, sqlmock, miniredis, bufconn — pick six).

## Task 18 — Final integration

Put it all together. Build a small service (a URL shortener,
RSS aggregator, or paste bin — your choice) using:

- A `Repo` interface backed by PostgreSQL in production.
  - Unit tests use an in-memory fake.
  - Contract tests run the fake and a testcontainers PostgreSQL.
- A `Cache` interface backed by Redis in production.
  - Tests use miniredis.
- A `Notifier` interface (mock with gomock in tests).
- An HTTP API tested with `httptest.NewServer`.

Acceptance:

- All tests pass with `go test ./... -short`.
- All tests including contract tests pass with `go test ./...`.
- CI is configured to run both.
- No mocks are hand-written; either generated or written as fakes
  intentionally.

This task simulates a realistic test architecture at small scale. The
skills transfer directly to large microservices.
