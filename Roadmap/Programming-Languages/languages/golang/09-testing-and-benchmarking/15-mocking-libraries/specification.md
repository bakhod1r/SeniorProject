---
layout: default
title: Mocking Libraries — Specification
parent: Mocking Libraries Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/15-mocking-libraries/specification/
---

# Mocking Libraries — Specification

[← Back](../)

## 1. Definitions

- **Mock object**: an object that records calls received, validates them against
  expectations, and either returns canned values or invokes user code.
- **Expectation**: a tuple `(method, argument matchers, return values, call count,
  call ordering, side effect)` registered with a mock prior to use.
- **Controller** (gomock terminology): the lifecycle owner of one or more mocks;
  failing expectations are reported through it.
- **Matcher**: a predicate over argument values; e.g. `gomock.Any()`,
  `gomock.Eq(v)`, `gomock.AssignableToTypeOf(t)`.
- **Generator**: a program that takes an interface declaration and produces a
  Go source file implementing that interface with mock semantics.

## 2. Lifecycle

For each test:

1. Construct controller `ctrl := gomock.NewController(t)`.
2. Construct mock `m := NewMockX(ctrl)`.
3. Register expectations: `m.EXPECT().Foo(args).Return(v).Times(n)`.
4. Inject `m` into the System Under Test.
5. Run code.
6. At test end (`t.Cleanup` or deferred `ctrl.Finish()`), unmet expectations
   cause `t.Errorf` and the test fails.

`go.uber.org/mock@v0.4.0` registers `ctrl.Finish` automatically via
`t.Cleanup`, so calling `ctrl.Finish()` explicitly is optional.

## 3. Matcher contract

A matcher implements:

```go
type Matcher interface {
    Matches(x interface{}) bool
    String() string
}
```

Built-in matchers in `go.uber.org/mock/gomock`:

- `Any()` — always matches.
- `Eq(x)` — `reflect.DeepEqual`.
- `Nil()` — `x == nil` or a typed nil.
- `Not(m)` — inverts another matcher.
- `Len(n)` — argument has length `n`.
- `AssignableToTypeOf(v)` — argument's type is assignable to `v`'s type.
- `InAnyOrder(slice)` — argument is a slice with the same elements regardless
  of order.

testify/mock uses a different convention: arguments compared via `ObjectsAreEqual`
plus optional `mock.MatchedBy(func(x T) bool)` for custom predicates.

## 4. Call counts

- `Times(n)` — exactly n.
- `MinTimes(n)` — at least n.
- `MaxTimes(n)` — at most n.
- `AnyTimes()` — zero or more.
- Default (no call-count call) — exactly once.

## 5. Ordering

`gomock.InOrder(e1, e2, e3)` declares that `e1` must be satisfied before `e2`,
and `e2` before `e3`. Each expectation must still match all its other
constraints (matchers, count).

`After(e)` is the underlying primitive; `InOrder` is sugar for chained `After`.

## 6. Return and side effects

- `.Return(v1, v2, ...)` sets canned return values.
- `.Do(func(args...))` runs a side effect after matching; ignores its return.
- `.DoAndReturn(func(args...) (r1, r2, ...))` runs and uses its return values.

The function passed to `Do` / `DoAndReturn` must have the same signature as the
mocked method or the call panics at runtime.

## 7. Strictness

- gomock is **strict** by default: any unexpected call fails the test.
- testify/mock is **lenient by default** for unexpected calls (returns the
  zero value); strictness is enabled with `mock.AssertExpectations(t)`
  and `mock.AssertNotCalled(t, "Method")`.
- moq generated mocks are lenient: they record calls; tests assert post hoc.

## 8. Generator I/O

`mockgen` modes:

- Source mode: `mockgen -source=foo.go -destination=mock_foo.go -package=foomock`.
- Reflect mode: `mockgen example.com/pkg Foo` — uses runtime reflection on a
  compiled binary to find the interface.

`mockery` reads `.mockery.yaml`:

```yaml
with-expecter: true
packages:
  example.com/internal/store:
    interfaces:
      UserRepo:
        config:
          dir: "{{.InterfaceDir}}/mocks"
```

`moq`: `go run github.com/matryer/moq -out user_repo_mock.go . UserRepo`.

## 9. Termination

A test using mocks terminates successfully if and only if:

- The controller reports no unmet expectations.
- No unexpected call was made.
- All ordering constraints were satisfied.

Failure is reported via `t.Errorf` / `t.Fatalf` so the standard Go test runner
handles it.

## 10. Library identity reference

For unambiguous citation, the canonical module paths are:

| Library                              | Module path                                  |
| ------------------------------------ | -------------------------------------------- |
| Original golang/mock (archived)      | `github.com/golang/mock`                     |
| Uber fork (current gomock)           | `go.uber.org/mock`                           |
| mockgen binary                       | `go.uber.org/mock/mockgen`                   |
| testify suite (assertions + mock)    | `github.com/stretchr/testify`                |
| testify mock subpackage              | `github.com/stretchr/testify/mock`           |
| mockery                              | `github.com/vektra/mockery/v2` (or v3 beta)  |
| moq                                  | `github.com/matryer/moq`                     |
| counterfeiter                        | `github.com/maxbrunsfeld/counterfeiter/v6`   |
| jarcoal/httpmock                     | `github.com/jarcoal/httpmock`                |
| stdlib httptest                      | `net/http/httptest`                          |
| DATA-DOG go-sqlmock                  | `github.com/DATA-DOG/go-sqlmock`             |
| go-redis redismock                   | `github.com/go-redis/redismock/v9`           |
| miniredis                            | `github.com/alicebob/miniredis/v2`           |
| gRPC bufconn                         | `google.golang.org/grpc/test/bufconn`        |

Always use the canonical path in imports. Aliases like `gomock` (no
slash) refer to the package `gomock` inside `go.uber.org/mock`.

## 11. Determinism guarantees

For any test using these libraries with `t.Parallel()`, the following
must hold:

- The mock's call counter and expectation list are protected by an
  internal mutex; concurrent `EXPECT()`s and calls are safe but their
  interleaving is not deterministic.
- testify's `mock.Mock` uses `sync.Mutex` for the same purpose.
- `httpmock` patches global state; tests using it cannot run in
  parallel with one another (but can with non-httpmock tests).
- `sqlmock`'s expectations are queue-based; with
  `MatchExpectationsInOrder(true)` (default), out-of-order calls fail.
  With `false`, any call that matches any expectation passes.
- `bufconn` is fully deterministic: a write to the buffer is visible to
  the reader immediately. Tests are reproducible.
- `miniredis` is single-threaded internally; concurrent client calls
  serialize on its internal mutex.

## 12. Version compatibility notes

- `go.uber.org/mock@v0.4.0` requires Go 1.21+ for generics support.
- `mockery@v2.x` works back to Go 1.18; v3 may bump to 1.21.
- `testify@v1.9+` requires Go 1.19+.
- `bufconn` has been stable for a long time and works with any
  supported Go version.

When adopting a new library, check its `go.mod` for the minimum Go
version; mismatches cause confusing build errors.

## 13. Conformance test for mock implementations

A library is conformant if it provides:

- A way to construct a mock implementing a target interface.
- A way to register expected calls with arguments and returns.
- A way to verify expectations were met (either automatically at
  cleanup, or via an explicit assertion call).
- A failure mode that integrates with `testing.T` (calls `Errorf` or
  `Fatalf` rather than panicking from a goroutine).

Most libraries discussed here meet these. testify/mock without
`Mock.Test(t)` or `AssertExpectations` is partially non-conformant
because failures may surface as panics.

## 14. Glossary

- **Controller**: gomock's per-test orchestrator.
- **Expectation**: a registered call pattern with arguments, returns,
  count, and ordering.
- **Mock**: a generated or hand-rolled implementation of an interface
  whose behavior is configured per test.
- **Fake**: a working alternate implementation suitable for tests
  (e.g. in-memory map for a repository).
- **Stub**: a test double that returns canned data, without recording
  calls.
- **Spy**: a test double that records calls but doesn't constrain them.
- **Matcher**: a predicate over an argument value used in expectations.
- **Recorder**: in gomock, the chainable object returned by `EXPECT()`.
- **Strict mock**: fails the test on unexpected calls.
- **Lenient mock**: returns zero values for unexpected calls.

## 15. Invariants

For a mock-based test using `go.uber.org/mock` with default settings:

- **I1**: If no expectation matches a call, `ctrl.T.Errorf` is invoked
  with a message describing the unexpected call.
- **I2**: If any expectation has not been satisfied at controller
  cleanup, `ctrl.T.Errorf` is invoked with a "missing call(s)" message.
- **I3**: Argument matchers are evaluated lazily; a matcher's
  `Matches` method is called only against arguments of a candidate
  call, not against arguments of unrelated calls.
- **I4**: Within `gomock.InOrder(e1, e2, ..., en)`, `ei` is consumed
  before `e(i+1)`. Expectations not part of the InOrder chain may be
  consumed in any order.
- **I5**: `DoAndReturn`'s function is invoked synchronously inside the
  mocked method's body; if it panics, the panic propagates to the
  caller goroutine.

For testify/mock:

- **T1**: If `Mock.Test(t)` was set, unexpected calls invoke
  `t.Errorf` rather than panicking.
- **T2**: Without `Mock.Test(t)`, unexpected calls panic in the
  goroutine where the call happened.
- **T3**: `AssertExpectations` returns true if and only if every
  registered `On` has been consumed at least once (subject to `.Times`,
  `.Maybe`, etc).

## 16. Comparison axes

Any mocking library can be characterized along these axes:

- **Type safety**: compile-time vs runtime errors on signature drift.
- **Strictness**: strict (fail unexpected) vs lenient (return zero).
- **Generation**: codegen vs reflection vs hand-written.
- **Argument matching**: builtin matchers, custom matchers, captures.
- **Ordering**: explicit ordering primitives vs implicit FIFO.
- **Verification**: automatic cleanup vs explicit assertion.

Most libraries discussed here can be placed on these axes
unambiguously. The decision matrix in `senior.md` section 7 summarizes
the placements.

## 17. Failure-message contracts

Each library defines roughly what its failure messages look like.
Reproducible templates:

- gomock unexpected call: `Unexpected call to *MockX.Foo(...)` followed
  by file:line of the call.
- gomock missing call: `missing call(s) to *MockX.Foo(matcher)`.
- testify unexpected: `mock: I don't know what to return because the
  method call was unexpected` (panics if `Mock.Test(t)` not set).
- testify expectations not met (with `AssertExpectations`): `FAIL:
  mock: Expected method "X" to have been called`.
- sqlmock unmet: `there is a remaining expectation which was not
  matched: ExpectedQuery => ...`.
- moq nil method: panic `MockX.FooFunc: method is nil but X.Foo was
  called`.

These messages are stable across versions, so test diagnostic tooling
(e.g. parsing CI output to surface mock-related failures) can rely on
them.

## 18. Backward-compatibility commitments

- `go.uber.org/mock` follows semver. v0.x is pre-1.0 but treated as
  stable; minor versions add features without breaking imports.
- `testify` v1 has been API-stable since 2017; mock package
  signatures haven't changed in years.
- `mockery` v2 → v3 is a breaking config schema change; generated
  code is similar.
- `bufconn` has been API-stable for the lifetime of `google.golang.org/grpc`.
- `miniredis` v2 has been stable; v3 is occasionally discussed but not
  released as of 2026.
- `jarcoal/httpmock` v1 has been stable; minor versions add responders
  without breaking imports.
- `DATA-DOG/go-sqlmock` v1 has been stable since 2018.
- `matryer/moq` is at v0.x but treated as stable; releases are
  infrequent.

These commitments mean a Go project can pin a mocking library version
and expect it to work for years without forced upgrades.
