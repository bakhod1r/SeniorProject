---
layout: default
title: Mocks and Stubs — Tasks
parent: Mocks and Stubs
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/03-mocks-and-stubs/tasks/
---

# Mocks and Stubs — Tasks

[← Back](../)

Each task asks you to implement the *same* small `Logger` interface three ways: a hand-rolled stub, a `testify/mock`-based mock, and a `gomock`-based mock. At the end you compare the three on lines of code, type safety, and refactor pain. Allocate roughly 90 minutes.

---

## The interface you will fake

```go
// Package log defines a minimal logger consumed by the order service.
package log

import "context"

type Logger interface {
    Info(ctx context.Context, msg string, fields map[string]any)
    Error(ctx context.Context, err error, msg string, fields map[string]any)
}
```

The unit under test is:

```go
package order

import (
    "context"
    "errors"

    "example.com/log"
)

type Repo interface {
    Save(ctx context.Context, o Order) error
}

type Service struct {
    Repo   Repo
    Logger log.Logger
}

func (s *Service) Place(ctx context.Context, o Order) error {
    if err := s.Repo.Save(ctx, o); err != nil {
        s.Logger.Error(ctx, err, "order.place.save_failed", map[string]any{"order_id": o.ID})
        return err
    }
    s.Logger.Info(ctx, "order.placed", map[string]any{"order_id": o.ID})
    return nil
}

type Order struct{ ID string }

var ErrDB = errors.New("db down")
```

Your job: write three tests for `Place`, each using a different fake/mock for `Repo` and `Logger`.

---

## Task 1 — Hand-rolled stubs (no framework)

Write `order/service_handrolled_test.go`. Requirements:

- Define `fakeRepo` and `recordingLogger` as struct types in the test file.
- `fakeRepo` should have a field `err error`; returning it from `Save`.
- `recordingLogger` should record every `Info`/`Error` call into a slice for assertion.
- Two test cases: happy path and DB-error path.
- Use `t.Run` for table-driven subtests; pass them with `t.Parallel()`.
- Add a compile-time conformance check: `var _ log.Logger = (*recordingLogger)(nil)`.

Bonus: make `recordingLogger` safe for concurrent appends (`sync.Mutex`), then write a sub-test that calls `Place` from two goroutines and asserts the log slice contains exactly two `Info` entries.

Expected outcome: ~70 lines of test code, zero dependencies beyond the standard library and your `example.com/log` package.

---

## Task 2 — `testify/mock`

Write `order/service_testify_test.go`. Requirements:

- Add `github.com/stretchr/testify` to `go.mod`.
- Define `MockRepo` and `MockLogger` types that embed `mock.Mock` and implement the interfaces.
- For each test, set up expectations with `On(...).Return(...)` and finish with `AssertExpectations(t)`.
- Use `mock.MatchedBy` to assert that the `fields` map passed to `Info` contains the expected `order_id`.
- The DB-error case should expect `Error` to be called once, then `AssertExpectations` validates that absence of `Info`.

Bonus: rewrite the matchers using `MatchedBy` predicates that return helpful diagnostic messages on failure (use `assert.ObjectsAreEqual` inside the predicate).

Expected outcome: ~100 lines, with the verbosity tax of explicit `On` and `AssertExpectations`.

---

## Task 3 — `gomock` (`go.uber.org/mock`)

Write `order/service_gomock_test.go`. Requirements:

- Add `go.uber.org/mock` to `go.mod`.
- Run `mockgen -source=repo.go -destination=mocks/repo_mock.go -package=mocks` and the equivalent for the logger.
- Construct mocks via `gomock.NewController(t)` (no manual `Finish`).
- Use `gomock.InOrder` to assert that on the success path `Save` is called *before* `Info`.
- Use a custom `gomock.Matcher` for the `fields` map (define a `containsKey(key, val)` matcher).
- Verify that on the failure path `Info` is never called by *not* registering an expectation for it — `gomock` will fail the test if it is invoked.

Bonus: switch from source mode to reflect mode (`mockgen example.com/log Logger`) and confirm the generated file still compiles.

Expected outcome: ~120 lines plus generated files (~150 lines of generated code per interface).

---

## Task 4 — Comparison table

After completing Tasks 1-3, fill in this table for your own reference:

| Aspect | Hand-rolled | testify/mock | gomock |
|--------|-------------|--------------|--------|
| Lines of hand-written test code | | | |
| Generated lines | 0 | 0 | |
| External dependencies added | 0 | testify | mock + mockgen binary |
| Compile-time type checking of args | yes | no | yes |
| Refactor cost when interface changes | rewrite struct | edit string literal | regenerate |
| Order-of-calls assertion ergonomics | manual | `.NotBefore` | `InOrder` |
| Cognitive load for a new reader | low | medium | high |

Answer in writing: under which conditions would you switch from hand-rolled to a framework? Aim for three concrete triggers (e.g., "interface grew past 8 methods," "more than 5 tests share the same setup," etc.).

---

## Task 5 — Bug-find drill

The following test passes. It should not. Find the bug:

```go
func TestPlace_HappyPath(t *testing.T) {
    repo := new(MockRepo)
    logger := new(MockLogger)
    repo.On("Save", mock.Anything, mock.Anything).Return(nil)
    logger.On("Info", mock.Anything, mock.Anything, mock.Anything).Return()

    s := &order.Service{Repo: repo, Logger: logger}
    _ = s.Place(context.Background(), order.Order{ID: "1"})
}
```

Two issues exist. Write down both, then fix the test.

Solution sketch (do not read until you've tried): (1) no `AssertExpectations` call, so the expectations are decorative; (2) `return _` swallows the error from `Place` — the happy path expects `nil`, so the call result must be asserted with `require.NoError`.

---

## Task 6 — Replace mocks with a fake

Take the `Repo` interface and write `package fakeorder` containing:

```go
type InMemoryRepo struct {
    mu     sync.Mutex
    orders map[string]order.Order
}

func New() *InMemoryRepo { return &InMemoryRepo{orders: map[string]order.Order{}} }

func (r *InMemoryRepo) Save(ctx context.Context, o order.Order) error { ... }
func (r *InMemoryRepo) Find(ctx context.Context, id string) (order.Order, bool) { ... }
```

Then write `service_with_fake_test.go` that exercises both `Place` *and* a hypothetical `Get` method via the fake. Observe how many lines of test setup you save compared to Task 2 once you add a second test that depends on reading back what was written.

Expected insight: fakes amortize setup across many tests; mocks duplicate setup.

---

## Task 7 — HTTP boundary with `httptest`

Add a `PaymentClient` to the order service that calls `https://payments.example.com/charge`. Write two test variants:

- One using `net/http/httptest.NewServer` to spin up a real HTTP server and inject the URL into the client.
- One using `github.com/jarcoal/httpmock` to intercept the default transport.

Compare: which one is easier to make `t.Parallel()`-safe? (Answer: `httptest.NewServer` — it's per-test, while `httpmock` mutates global state unless you use `ActivateNonDefault`.)

---

## Task 8 — `sqlmock` vs in-memory fake

Pick one task from your day job (or invent one): a function that reads three rows and updates one. Write it twice:

- Once with `github.com/DATA-DOG/go-sqlmock`, asserting on the exact SQL strings.
- Once with an in-memory fake repository implementing the same interface.

Rewrite the SQL phrasing (e.g., change `SELECT id, name` to `SELECT name, id`). Which test broke? Reflect on what that tells you about coupling tests to SQL syntax.

---

## Checklist before submitting

- [ ] All three test files run with `go test ./...` and pass.
- [ ] `go test -race ./...` produces no race warnings.
- [ ] Hand-rolled stub has a `var _ Interface = ...` conformance check.
- [ ] No mock framework is used to fake `time.Now`, `context.Context`, or other std-lib values.
- [ ] No test depends on internal call order *except* the `gomock.InOrder` example, where order is the explicit subject of the test.
