---
layout: default
title: Mocking Libraries — Junior
parent: Mocking Libraries Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/15-mocking-libraries/junior/
---

# Mocking Libraries — Junior

[← Back](../)

This file teaches one library, `go.uber.org/mock`, from zero to confident.
The next file (`middle.md`) covers testify/mock and mockery. The conceptual
intro to test doubles lives in `09/03-mocks-and-stubs`; if the words
"stub", "fake", and "mock" feel fuzzy, read that file first.

## 1. Why a library at all?

You can always write a mock by hand:

```go
package userservice_test

import (
    "context"
    "testing"
)

// Production interface.
type UserRepo interface {
    Save(ctx context.Context, id string, name string) error
}

// Hand-rolled mock.
type fakeRepo struct {
    saveCalls []struct {
        ID   string
        Name string
    }
    saveReturns error
}

func (f *fakeRepo) Save(ctx context.Context, id, name string) error {
    f.saveCalls = append(f.saveCalls, struct {
        ID   string
        Name string
    }{id, name})
    return f.saveReturns
}

func TestCreateUserHand(t *testing.T) {
    repo := &fakeRepo{}
    svc := NewService(repo)
    if err := svc.Create(context.Background(), "u1", "Alice"); err != nil {
        t.Fatalf("Create: %v", err)
    }
    if len(repo.saveCalls) != 1 {
        t.Fatalf("Save called %d times, want 1", len(repo.saveCalls))
    }
    if repo.saveCalls[0].ID != "u1" {
        t.Fatalf("ID = %q, want %q", repo.saveCalls[0].ID, "u1")
    }
}
```

That's twenty lines of boilerplate for one method on one interface. When
the interface has eight methods and you need to test six combinations of
behavior, the boilerplate dominates. That is what `go.uber.org/mock` (and
the older archived `github.com/golang/mock`) automate: a generator reads
the interface and emits all that mechanical code for you, with type-safe
expectation methods and ordering primitives on top.

## 2. Installing the toolchain

Add the runtime dependency to your module:

```bash
go get go.uber.org/mock/gomock@v0.4.0
```

Install the generator binary:

```bash
go install go.uber.org/mock/mockgen@latest
```

Keep the generator version pinned in a `tools.go` file so contributors get
the same version:

```go
//go:build tools

package tools

import (
    _ "go.uber.org/mock/mockgen"
)
```

Run `go mod tidy` and the `mockgen` package will be added to `go.mod`
without polluting your production binary (the `tools` build tag excludes it
from normal builds).

## 3. Generating your first mock

Start with a tiny interface:

```go
// File: internal/store/store.go
package store

import "context"

type User struct {
    ID   string
    Name string
}

//go:generate mockgen -source=store.go -destination=mocks/store_mock.go -package=mocks

type UserRepo interface {
    Get(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
    Delete(ctx context.Context, id string) error
}
```

Now run:

```bash
go generate ./internal/store/...
```

A new file `internal/store/mocks/store_mock.go` appears. It contains:

- `MockUserRepo` — implements `UserRepo`.
- `MockUserRepoMockRecorder` — used internally by `EXPECT()`.
- `NewMockUserRepo(ctrl *gomock.Controller) *MockUserRepo`.
- Per-method methods on the recorder: `Get`, `Save`, `Delete`.

You should never edit the generated file. If the interface changes, rerun
`go generate`.

## 4. Anatomy of a generated method

Inside `store_mock.go` you will see something like:

```go
// Get mocks base method.
func (m *MockUserRepo) Get(ctx context.Context, id string) (*User, error) {
    m.ctrl.T.Helper()
    ret := m.ctrl.Call(m, "Get", ctx, id)
    ret0, _ := ret[0].(*User)
    ret1, _ := ret[1].(error)
    return ret0, ret1
}

// Get indicates an expected call of Get.
func (mr *MockUserRepoMockRecorder) Get(ctx, id any) *gomock.Call {
    mr.mock.ctrl.T.Helper()
    return mr.mock.ctrl.RecordCallWithMethodType(
        mr.mock, "Get",
        reflect.TypeOf((*MockUserRepo)(nil).Get),
        ctx, id)
}
```

Two things to notice:

1. The mock dispatches into `ctrl.Call`, which looks up expectations and
   returns whatever was registered. This is where strictness happens: if
   no expectation matches, `ctrl.T.Errorf` is called and the test fails.
2. The recorder method has the same signature but with `any` parameters.
   You pass matchers (or raw values, which become `gomock.Eq` implicitly).

The split between "real" method and "recorder" method is what lets you
write `mock.EXPECT().Get(ctx, "u1")`. The `EXPECT()` call returns the
recorder; chaining a method on the recorder registers an expectation.

## 5. Your first test with gomock

```go
// File: internal/service/user_service_test.go
package service_test

import (
    "context"
    "errors"
    "testing"

    "go.uber.org/mock/gomock"

    "example.com/myapp/internal/service"
    "example.com/myapp/internal/store"
    mocks "example.com/myapp/internal/store/mocks"
)

func TestUserService_Get(t *testing.T) {
    ctrl := gomock.NewController(t)
    repo := mocks.NewMockUserRepo(ctrl)

    ctx := context.Background()
    want := &store.User{ID: "u1", Name: "Alice"}
    repo.EXPECT().Get(ctx, "u1").Return(want, nil)

    svc := service.NewUserService(repo)
    got, err := svc.Get(ctx, "u1")
    if err != nil {
        t.Fatalf("Get: %v", err)
    }
    if got.ID != "u1" || got.Name != "Alice" {
        t.Fatalf("unexpected user: %+v", got)
    }
}

func TestUserService_Get_NotFound(t *testing.T) {
    ctrl := gomock.NewController(t)
    repo := mocks.NewMockUserRepo(ctrl)

    repo.EXPECT().
        Get(gomock.Any(), "missing").
        Return(nil, errors.New("not found"))

    svc := service.NewUserService(repo)
    _, err := svc.Get(context.Background(), "missing")
    if err == nil {
        t.Fatal("expected error, got nil")
    }
}
```

Key points:

- `gomock.NewController(t)` ties the mock to the test. When the test
  finishes, the controller verifies expectations.
- `repo.EXPECT().Get(ctx, "u1").Return(want, nil)` registers one
  expectation: when `Get` is called with these arguments, return `want, nil`.
- `gomock.Any()` is a matcher that accepts any value. Raw values like `"u1"`
  are implicitly wrapped in `gomock.Eq("u1")`.

In version v0.4 and later, `ctrl.Finish()` is registered via `t.Cleanup`
automatically. You can call it explicitly if you want — it's a no-op the
second time.

## 6. Matchers

The matcher interface is small:

```go
type Matcher interface {
    Matches(x any) bool
    String() string
}
```

Built-in matchers (in `go.uber.org/mock/gomock`):

| Matcher                          | Matches                                           |
| -------------------------------- | ------------------------------------------------- |
| `Any()`                          | any value                                         |
| `Eq(x)`                          | `reflect.DeepEqual(arg, x)`                       |
| `Not(m)`                         | inverse of `m`                                    |
| `Nil()`                          | `nil` or typed nil                                |
| `Len(n)`                         | argument is slice/array/map/string of length n    |
| `AssignableToTypeOf(v)`          | `reflect.TypeOf(arg).AssignableTo(reflect.TypeOf(v))` |
| `InAnyOrder(slice)`              | arg is a slice with same elements in any order    |
| `Cond(fn)` (v0.4+)               | custom predicate                                  |

Example using `Cond`:

```go
repo.EXPECT().
    Save(gomock.Any(), gomock.Cond(func(x any) bool {
        u, ok := x.(*store.User)
        return ok && u.ID != "" && len(u.Name) > 0
    })).
    Return(nil)
```

A custom matcher is a struct implementing the interface:

```go
type validEmail struct{}

func (validEmail) Matches(x any) bool {
    s, ok := x.(string)
    return ok && strings.Contains(s, "@")
}

func (validEmail) String() string { return "is a valid email" }

repo.EXPECT().FindByEmail(gomock.Any(), validEmail{}).Return(nil, nil)
```

When a matcher fails, `String()` is printed in the failure message, so make
it descriptive.

## 7. Return, Do, and DoAndReturn

Three ways to define what the mock should "do" when called:

```go
// Return canned values.
repo.EXPECT().Get(gomock.Any(), "u1").Return(&store.User{ID: "u1"}, nil)

// Run a side effect, ignore its return.
repo.EXPECT().Save(gomock.Any(), gomock.Any()).
    Do(func(ctx context.Context, u *store.User) {
        t.Logf("Save called with %+v", u)
    }).
    Return(nil)

// Run a function, use its return as the result.
repo.EXPECT().Get(gomock.Any(), gomock.Any()).
    DoAndReturn(func(_ context.Context, id string) (*store.User, error) {
        return &store.User{ID: id, Name: "Generated"}, nil
    })
```

`Do` is for observation; `DoAndReturn` is for dynamic responses. The
function signature must match the mocked method exactly or gomock panics
at call time with `reflect: Call using too few input arguments` or similar.

## 8. Call counts

By default, an expectation must be called exactly once. Override with:

```go
repo.EXPECT().Get(gomock.Any(), gomock.Any()).Return(u, nil).Times(3)
repo.EXPECT().Get(gomock.Any(), gomock.Any()).Return(u, nil).MinTimes(1)
repo.EXPECT().Get(gomock.Any(), gomock.Any()).Return(u, nil).MaxTimes(5)
repo.EXPECT().Get(gomock.Any(), gomock.Any()).Return(u, nil).AnyTimes()
```

`AnyTimes()` is convenient but dangerous: a test passes even if the SUT
never calls the mock at all. Prefer `MinTimes(1)` when you mean "at least
once but I don't care how many".

## 9. Returning different values across calls

If the SUT calls `Get` three times and you want different results each time:

```go
gomock.InOrder(
    repo.EXPECT().Get(gomock.Any(), "u1").Return(&store.User{ID: "u1"}, nil),
    repo.EXPECT().Get(gomock.Any(), "u1").Return(nil, errors.New("kaboom")),
    repo.EXPECT().Get(gomock.Any(), "u1").Return(&store.User{ID: "u1"}, nil),
)
```

`InOrder` enforces that these three expectations are consumed in this
sequence. Each expectation matches once; together they cover three calls.

Alternatively, use `DoAndReturn` with a counter:

```go
calls := 0
repo.EXPECT().Get(gomock.Any(), "u1").
    DoAndReturn(func(context.Context, string) (*store.User, error) {
        calls++
        switch calls {
        case 1:
            return &store.User{ID: "u1"}, nil
        case 2:
            return nil, errors.New("kaboom")
        default:
            return &store.User{ID: "u1"}, nil
        }
    }).Times(3)
```

The `InOrder` form is clearer; the `DoAndReturn` form is more flexible.

## 10. Ordering

`gomock.InOrder(e1, e2, e3)` chains `After` constraints. It does not mean
"e1 immediately before e2" — only "e2 may not satisfy any matching call
until e1 is satisfied". Use it when the order matters for correctness:

```go
gomock.InOrder(
    tx.EXPECT().Begin().Return(nil),
    repo.EXPECT().Save(gomock.Any(), gomock.Any()).Return(nil),
    tx.EXPECT().Commit().Return(nil),
)
```

Use it sparingly — over-specifying order couples the test to the SUT's
internal structure. If you find yourself writing `InOrder` for five
operations, ask whether the test should instead check post-conditions on a
fake.

## 11. The full controller lifecycle

```go
func TestX(t *testing.T) {
    ctrl := gomock.NewController(t)
    // From v0.4 onward, ctrl registers t.Cleanup(ctrl.Finish) here.

    repo := mocks.NewMockUserRepo(ctrl)
    // Mocks are bound to the controller. Multiple mocks can share one.

    repo.EXPECT().Get(gomock.Any(), "u1").Return(u, nil)
    // Expectations are stored in the controller, keyed by mock+method.

    svc := service.New(repo)
    _, err := svc.Get(context.Background(), "u1")
    if err != nil { t.Fatal(err) }

    // t.Cleanup fires, ctrl.Finish runs, expectations are verified.
}
```

Failure modes:

- Unexpected call: `Unexpected call to *mocks.MockUserRepo.Get(...)`.
- Unmet expectation: `missing call(s) to *mocks.MockUserRepo.Get(...)`.
- Wrong call count: `expected call at .../user_service_test.go:42 has already been called the max number of times`.

## 12. Pointer arguments and deep equality

The default matcher is `gomock.Eq`, which uses `reflect.DeepEqual`. For
pointers, `DeepEqual` follows the pointer:

```go
repo.EXPECT().Save(gomock.Any(), &store.User{ID: "u1"}).Return(nil)

svc.Create(ctx, "u1") // internally constructs &store.User{ID: "u1"}
// matches: DeepEqual compares the pointed-to values.
```

Trap: if the SUT mutates the struct before calling Save (e.g. fills in
`CreatedAt`), the pointed-to values differ and the matcher fails. Three
fixes:

1. Match on stable fields with `Cond`:

   ```go
   repo.EXPECT().Save(gomock.Any(), gomock.Cond(func(x any) bool {
       u, ok := x.(*store.User)
       return ok && u.ID == "u1"
   })).Return(nil)
   ```

2. Use `AssignableToTypeOf` to accept any `*User` and assert later:

   ```go
   repo.EXPECT().Save(gomock.Any(), gomock.AssignableToTypeOf((*store.User)(nil))).
       DoAndReturn(func(_ context.Context, u *store.User) error {
           gotUser = u
           return nil
       })
   ```

3. Switch to a fake repo that records calls in a slice you assert on.

## 13. Mockgen source mode vs reflect mode

Source mode parses Go files directly:

```bash
mockgen -source=internal/store/store.go \
    -destination=internal/store/mocks/store_mock.go \
    -package=mocks
```

Reflect mode loads the package via the toolchain and reflects on the
interface at runtime:

```bash
mockgen example.com/myapp/internal/store UserRepo \
    -destination=internal/store/mocks/store_mock.go \
    -package=mocks
```

Source mode pros:

- Fast (no compilation).
- Works for interfaces using unexported types in the same package.
- Easier to specify which interfaces to mock — pass the file.

Reflect mode pros:

- Handles embedded interfaces from other packages without manual
  intervention.
- No need for `//go:generate` directives at the source.

Most teams use source mode and check in a `//go:generate` directive next
to the interface declaration. Reflect mode is useful when interfaces are
spread across files or come from external dependencies.

## 14. Generating mocks for third-party interfaces

To mock an interface defined in another module (e.g. `io.Reader`):

```bash
mockgen io Reader -destination=internal/iomocks/reader_mock.go \
    -package=iomocks
```

This uses reflect mode. The generated file imports `io` and provides
`MockReader`. Use case: testing code that consumes `io.Reader` without
running real I/O.

## 15. Worked example: a payment service

Interface:

```go
// File: internal/payment/payment.go
package payment

import "context"

type Provider interface {
    Charge(ctx context.Context, amount int64, token string) (txID string, err error)
    Refund(ctx context.Context, txID string) error
}

//go:generate mockgen -source=payment.go -destination=mocks/payment_mock.go -package=mocks
```

Service:

```go
// File: internal/payment/service.go
package payment

import (
    "context"
    "errors"
)

var ErrTokenRequired = errors.New("token required")

type Service struct {
    provider Provider
}

func NewService(p Provider) *Service {
    return &Service{provider: p}
}

func (s *Service) Pay(ctx context.Context, amount int64, token string) (string, error) {
    if token == "" {
        return "", ErrTokenRequired
    }
    return s.provider.Charge(ctx, amount, token)
}

func (s *Service) Cancel(ctx context.Context, txID string) error {
    return s.provider.Refund(ctx, txID)
}
```

Tests:

```go
// File: internal/payment/service_test.go
package payment_test

import (
    "context"
    "errors"
    "testing"

    "go.uber.org/mock/gomock"

    "example.com/myapp/internal/payment"
    mocks "example.com/myapp/internal/payment/mocks"
)

func TestPay_Success(t *testing.T) {
    ctrl := gomock.NewController(t)
    p := mocks.NewMockProvider(ctrl)

    p.EXPECT().
        Charge(gomock.Any(), int64(1000), "tok_abc").
        Return("tx_001", nil)

    svc := payment.NewService(p)
    txID, err := svc.Pay(context.Background(), 1000, "tok_abc")
    if err != nil {
        t.Fatalf("Pay: %v", err)
    }
    if txID != "tx_001" {
        t.Fatalf("txID = %q, want tx_001", txID)
    }
}

func TestPay_EmptyToken(t *testing.T) {
    ctrl := gomock.NewController(t)
    p := mocks.NewMockProvider(ctrl)
    // No EXPECT: Charge must not be called.

    svc := payment.NewService(p)
    _, err := svc.Pay(context.Background(), 1000, "")
    if !errors.Is(err, payment.ErrTokenRequired) {
        t.Fatalf("err = %v, want ErrTokenRequired", err)
    }
}

func TestCancel_PropagatesError(t *testing.T) {
    ctrl := gomock.NewController(t)
    p := mocks.NewMockProvider(ctrl)

    wantErr := errors.New("network")
    p.EXPECT().Refund(gomock.Any(), "tx_001").Return(wantErr)

    svc := payment.NewService(p)
    if err := svc.Cancel(context.Background(), "tx_001"); err != wantErr {
        t.Fatalf("err = %v, want %v", err, wantErr)
    }
}
```

Things to notice:

- `TestPay_EmptyToken` registers no expectation on `Charge`. Strict mode
  fails the test if `Charge` is called, which is exactly the assertion we
  want (the service short-circuits before reaching the provider).
- `TestCancel_PropagatesError` returns a sentinel error from the mock and
  asserts the service forwards it untouched.

## 16. Multiple mocks under one controller

You can share a controller across mocks:

```go
ctrl := gomock.NewController(t)
provider := mocks.NewMockProvider(ctrl)
ledger   := mocks.NewMockLedger(ctrl)

gomock.InOrder(
    provider.EXPECT().Charge(gomock.Any(), int64(1000), "tok_x").Return("tx_1", nil),
    ledger.EXPECT().Record(gomock.Any(), "tx_1", int64(1000)).Return(nil),
)
```

The controller verifies expectations across all mocks at cleanup time. The
`InOrder` constraint correctly enforces that `Charge` happens before
`Record`, even though they live on different mocks.

## 17. Common rookie mistakes

1. **Forgetting `gomock.Any()` for context.** Most methods take `ctx
   context.Context` and most tests pass `context.Background()`. If you
   write `Charge(ctx, ...)` literally, your test relies on `DeepEqual`
   between two `context.Background()` values, which works today but is
   brittle. Use `gomock.Any()`.

2. **Reusing one mock across parallel subtests.** Mocks are not goroutine-
   safe in all versions. Create a fresh controller and mock inside each
   subtest, especially when using `t.Parallel()`.

3. **Returning untyped nil.** `Return(nil, nil)` is fine when both
   parameters are interface types or pointers, but if the first param is
   a `*User`, gomock's reflection may store an untyped nil that triggers
   a panic on the caller side. Prefer `Return((*store.User)(nil), nil)`.

4. **Mocking concrete types.** You can only mock interfaces. If your
   dependency is a concrete struct, refactor: extract an interface used by
   the SUT. Avoid extracting interfaces purely for mocking — see
   `professional.md` for the discussion.

5. **Putting mocks in the production package.** It is legal — same package
   can mock unexported interfaces — but it bloats your binary. Use a
   `mocks/` subpackage unless you have a good reason.

## 18. A complete workflow

For a new interface `Notifier`:

1. Declare the interface in `internal/notify/notify.go`.
2. Add `//go:generate mockgen -source=notify.go -destination=mocks/notify_mock.go -package=mocks`.
3. Run `go generate ./internal/notify/...`.
4. In the test file: `ctrl := gomock.NewController(t)` and
   `n := mocks.NewMockNotifier(ctrl)`.
5. Register expectations, inject `n` into the SUT, run the SUT.
6. Let `t.Cleanup` verify everything at the end.

After a few cycles this becomes muscle memory. The next file covers the
testify ecosystem so you can recognize and work with it in legacy code.

## 19. Working with embedded interfaces

Embedded interfaces compose like type embedding in structs. Suppose:

```go
package storage

type Reader interface {
    Read(ctx context.Context, key string) ([]byte, error)
}

type Writer interface {
    Write(ctx context.Context, key string, value []byte) error
}

type ReadWriter interface {
    Reader
    Writer
}
```

When you generate a mock for `ReadWriter`, mockgen flattens the embedded
interfaces and produces methods for both `Read` and `Write` on the same
mock. The expectation methods work transparently:

```go
ctrl := gomock.NewController(t)
rw := mocks.NewMockReadWriter(ctrl)

rw.EXPECT().Read(gomock.Any(), "key1").Return([]byte("value1"), nil)
rw.EXPECT().Write(gomock.Any(), "key2", gomock.Any()).Return(nil)
```

If `Reader` and `Writer` are defined in different files or different
packages, source mode requires the `-imports` flag to map their import
paths in the generated file:

```bash
mockgen \
    -source=internal/storage/readwriter.go \
    -destination=internal/storage/mocks/readwriter_mock.go \
    -package=mocks \
    -imports=storage=example.com/myapp/internal/storage
```

Reflect mode handles this without extra flags because it has access to
the compiled type information.

## 20. Generics in gomock

`go.uber.org/mock@v0.4+` supports generic interfaces. Consider:

```go
package repo

type Repository[T any] interface {
    Get(ctx context.Context, id string) (T, error)
    Save(ctx context.Context, item T) error
}
```

Mockgen generates a generic mock:

```go
type MockRepository[T any] struct {
    ctrl     *gomock.Controller
    recorder *MockRepositoryMockRecorder[T]
}

func NewMockRepository[T any](ctrl *gomock.Controller) *MockRepository[T] {
    // ...
}
```

In the test, instantiate it with the concrete type parameter:

```go
type User struct {
    ID, Name string
}

func TestUserRepo(t *testing.T) {
    ctrl := gomock.NewController(t)
    repo := mocks.NewMockRepository[User](ctrl)

    repo.EXPECT().Get(gomock.Any(), "u1").Return(User{ID: "u1"}, nil)
    // ...
}
```

Older versions of `github.com/golang/mock` did not support generics. This
was one of the major reasons for the Uber fork.

## 21. Mocking interfaces that take variadic arguments

Variadic methods need special handling because gomock receives them as a
slice but the recorder accepts individual matchers:

```go
type Logger interface {
    Log(level int, msg string, fields ...string)
}
```

Generated recorder:

```go
func (mr *MockLoggerMockRecorder) Log(level, msg any, fields ...any) *gomock.Call {
    // ...
}
```

To match any number of fields:

```go
logger.EXPECT().Log(gomock.Any(), "starting", gomock.Any()).AnyTimes()
```

A single `gomock.Any()` matches one variadic element, not the slice. To
match arbitrary variadics in one shot, the v0.3+ helper is:

```go
import "go.uber.org/mock/gomock"

logger.EXPECT().Log(0, "starting").Times(1) // zero variadic args
logger.EXPECT().Log(0, "starting", gomock.Any(), gomock.Any()).Times(1) // two
```

For "any number of variadic args", you generally need a custom matcher
that compares slices, or you use `DoAndReturn`:

```go
logger.EXPECT().Log(gomock.Any(), gomock.Any(), gomock.Any()).
    DoAndReturn(func(level int, msg string, fields ...string) {
        // any fields accepted
    }).AnyTimes()
```

## 22. Argument capture for deferred assertion

Sometimes you want to assert on a value the SUT passes to the mock, but
the value is constructed inside the SUT and you cannot predict it. Use a
capture pattern:

```go
var captured *store.User
repo.EXPECT().
    Save(gomock.Any(), gomock.AssignableToTypeOf((*store.User)(nil))).
    DoAndReturn(func(_ context.Context, u *store.User) error {
        captured = u
        return nil
    })

svc.Create(ctx, "u1", "Alice")

if captured == nil {
    t.Fatal("Save was not called")
}
if captured.Name != "Alice" {
    t.Fatalf("Name = %q, want Alice", captured.Name)
}
if captured.CreatedAt.IsZero() {
    t.Errorf("CreatedAt was not set")
}
```

The mock accepts any `*User` and stashes it for the test to inspect after
the SUT returns. This combines the strictness of gomock (the call must
happen) with the flexibility of post-hoc assertions.

## 23. When tests fail

The most common failure messages and what they mean:

```
Unexpected call to *mocks.MockUserRepo.Get([context.Background "u2"])
    at .../user_service_test.go:45
```

You did not register an expectation matching `Get(ctx, "u2")`. Either the
SUT called the wrong dependency, or you forgot the expectation, or the
arguments differ from what you expected.

```
missing call(s) to *mocks.MockUserRepo.Save(is anything, is anything)
    at .../user_service_test.go:30
aborting test due to missing call(s)
```

An expectation was registered but never satisfied. Either the SUT skipped
the call (test reveals a bug) or the test set up an irrelevant expectation
(test reveals a test bug).

```
expected call at .../user_service_test.go:30 has already been called
the max number of times.
```

You registered `Times(1)` (or used the default) and the SUT called twice.
Either the SUT has a bug (calling twice when it should call once) or your
expectation count is wrong.

When a test fails, read the failure carefully. gomock's messages include
file/line of both the expectation and the unexpected call, which is the
fastest way to locate the discrepancy.

## 24. Debugging tips

- `mock.EXPECT().Method(...).Do(func(args ...) { t.Logf(...) })` — log
  every call to inspect what the SUT actually passes.
- Run with `go test -v -run TestX` to see test names and any `t.Logf`
  output. Without `-v`, log output is suppressed for passing tests.
- If a test passes that you expect to fail, check for `AnyTimes()` — it
  silently accepts zero calls.
- If a panic with `interface conversion` appears, you returned the wrong
  type from `Return` or `DoAndReturn`. Compare the signature carefully.

## 25. Summary

You should now be able to:

- Install `go.uber.org/mock` and `mockgen`.
- Generate mocks from a `//go:generate` directive.
- Write tests using `gomock.NewController`, `EXPECT()`, `Return`,
  matchers, and call counts.
- Combine multiple mocks under one controller with `InOrder`.
- Use `Do`, `DoAndReturn`, and argument capture for dynamic responses.
- Read gomock failure messages and diagnose the cause.

The next file, `middle.md`, shows how the same job is done with
`testify/mock` and `mockery`, which use reflection at runtime rather than
code generation.

## 26. End-to-end example — building a notification service

Let's wire a complete example from interface to tests.

### 26.1 The interface and the SUT

```go
// File: internal/notify/notifier.go
package notify

import "context"

type Channel string

const (
    ChannelEmail Channel = "email"
    ChannelSMS   Channel = "sms"
    ChannelPush  Channel = "push"
)

type Message struct {
    To      string
    Subject string
    Body    string
    Channel Channel
}

//go:generate mockgen -source=notifier.go -destination=mocks/notifier_mock.go -package=mocks

type Sender interface {
    Send(ctx context.Context, m Message) (msgID string, err error)
}

type RateLimiter interface {
    Allow(ctx context.Context, key string) (bool, error)
}

type AuditLog interface {
    Record(ctx context.Context, msgID string, recipient string) error
}
```

```go
// File: internal/notify/service.go
package notify

import (
    "context"
    "errors"
    "fmt"
)

var (
    ErrRateLimited      = errors.New("rate limited")
    ErrEmptyRecipient   = errors.New("empty recipient")
    ErrUnknownChannel   = errors.New("unknown channel")
)

type Service struct {
    sender  Sender
    limiter RateLimiter
    audit   AuditLog
}

func NewService(s Sender, l RateLimiter, a AuditLog) *Service {
    return &Service{sender: s, limiter: l, audit: a}
}

func (s *Service) Notify(ctx context.Context, m Message) error {
    if m.To == "" {
        return ErrEmptyRecipient
    }
    switch m.Channel {
    case ChannelEmail, ChannelSMS, ChannelPush:
    default:
        return ErrUnknownChannel
    }

    allowed, err := s.limiter.Allow(ctx, m.To)
    if err != nil {
        return fmt.Errorf("rate limiter: %w", err)
    }
    if !allowed {
        return ErrRateLimited
    }

    msgID, err := s.sender.Send(ctx, m)
    if err != nil {
        return fmt.Errorf("send: %w", err)
    }

    if err := s.audit.Record(ctx, msgID, m.To); err != nil {
        // Audit failure does not fail the notification. Log and continue.
        return nil
    }
    return nil
}
```

### 26.2 The tests

```go
// File: internal/notify/service_test.go
package notify_test

import (
    "context"
    "errors"
    "testing"

    "go.uber.org/mock/gomock"

    "example.com/myapp/internal/notify"
    mocks "example.com/myapp/internal/notify/mocks"
)

func TestNotify_Success(t *testing.T) {
    ctrl := gomock.NewController(t)
    sender := mocks.NewMockSender(ctrl)
    limiter := mocks.NewMockRateLimiter(ctrl)
    audit := mocks.NewMockAuditLog(ctrl)

    ctx := context.Background()
    m := notify.Message{
        To:      "alice@example.com",
        Subject: "hi",
        Body:    "hello",
        Channel: notify.ChannelEmail,
    }

    gomock.InOrder(
        limiter.EXPECT().Allow(gomock.Any(), "alice@example.com").
            Return(true, nil),
        sender.EXPECT().Send(gomock.Any(), m).Return("msg_001", nil),
        audit.EXPECT().Record(gomock.Any(), "msg_001", "alice@example.com").
            Return(nil),
    )

    svc := notify.NewService(sender, limiter, audit)
    if err := svc.Notify(ctx, m); err != nil {
        t.Fatalf("Notify: %v", err)
    }
}

func TestNotify_EmptyRecipient(t *testing.T) {
    ctrl := gomock.NewController(t)
    sender := mocks.NewMockSender(ctrl)
    limiter := mocks.NewMockRateLimiter(ctrl)
    audit := mocks.NewMockAuditLog(ctrl)
    // No expectations: none of the dependencies should be called.

    svc := notify.NewService(sender, limiter, audit)
    err := svc.Notify(context.Background(), notify.Message{Channel: notify.ChannelEmail})
    if !errors.Is(err, notify.ErrEmptyRecipient) {
        t.Fatalf("err = %v, want ErrEmptyRecipient", err)
    }
}

func TestNotify_UnknownChannel(t *testing.T) {
    ctrl := gomock.NewController(t)
    sender := mocks.NewMockSender(ctrl)
    limiter := mocks.NewMockRateLimiter(ctrl)
    audit := mocks.NewMockAuditLog(ctrl)

    svc := notify.NewService(sender, limiter, audit)
    err := svc.Notify(context.Background(), notify.Message{
        To:      "x",
        Channel: "carrier-pigeon",
    })
    if !errors.Is(err, notify.ErrUnknownChannel) {
        t.Fatalf("err = %v, want ErrUnknownChannel", err)
    }
}

func TestNotify_RateLimited(t *testing.T) {
    ctrl := gomock.NewController(t)
    sender := mocks.NewMockSender(ctrl)
    limiter := mocks.NewMockRateLimiter(ctrl)
    audit := mocks.NewMockAuditLog(ctrl)

    limiter.EXPECT().Allow(gomock.Any(), "alice").Return(false, nil)
    // sender and audit should not be called.

    svc := notify.NewService(sender, limiter, audit)
    err := svc.Notify(context.Background(), notify.Message{
        To:      "alice",
        Channel: notify.ChannelEmail,
    })
    if !errors.Is(err, notify.ErrRateLimited) {
        t.Fatalf("err = %v, want ErrRateLimited", err)
    }
}

func TestNotify_SendFails(t *testing.T) {
    ctrl := gomock.NewController(t)
    sender := mocks.NewMockSender(ctrl)
    limiter := mocks.NewMockRateLimiter(ctrl)
    audit := mocks.NewMockAuditLog(ctrl)

    wantErr := errors.New("smtp down")
    gomock.InOrder(
        limiter.EXPECT().Allow(gomock.Any(), "bob").Return(true, nil),
        sender.EXPECT().Send(gomock.Any(), gomock.Any()).
            Return("", wantErr),
        // audit not called.
    )

    svc := notify.NewService(sender, limiter, audit)
    err := svc.Notify(context.Background(), notify.Message{
        To:      "bob",
        Channel: notify.ChannelEmail,
    })
    if !errors.Is(err, wantErr) {
        t.Fatalf("err = %v, want wrap of %v", err, wantErr)
    }
}

func TestNotify_AuditFailureDoesNotFailNotification(t *testing.T) {
    ctrl := gomock.NewController(t)
    sender := mocks.NewMockSender(ctrl)
    limiter := mocks.NewMockRateLimiter(ctrl)
    audit := mocks.NewMockAuditLog(ctrl)

    gomock.InOrder(
        limiter.EXPECT().Allow(gomock.Any(), "carol").Return(true, nil),
        sender.EXPECT().Send(gomock.Any(), gomock.Any()).
            Return("msg_002", nil),
        audit.EXPECT().Record(gomock.Any(), "msg_002", "carol").
            Return(errors.New("audit-down")),
    )

    svc := notify.NewService(sender, limiter, audit)
    if err := svc.Notify(context.Background(), notify.Message{
        To:      "carol",
        Channel: notify.ChannelEmail,
    }); err != nil {
        t.Fatalf("Notify should swallow audit failure, got %v", err)
    }
}
```

### 26.3 What these tests demonstrate

- **`TestNotify_Success`** — happy path with three mocks and `InOrder` to
  enforce that rate limiting happens before sending, which happens before
  auditing.
- **`TestNotify_EmptyRecipient` / `TestNotify_UnknownChannel`** —
  validation tests with no expectations on any mock. Strict mode is the
  feature: if the SUT accidentally calls a dependency, the test fails.
- **`TestNotify_RateLimited`** — only the limiter is expected. The
  absence of expectations on `sender` and `audit` is the assertion.
- **`TestNotify_SendFails`** — illustrates error wrapping and that the
  audit step is correctly skipped on send failure.
- **`TestNotify_AuditFailureDoesNotFailNotification`** — documents
  intentional swallowing of audit errors as a behavioral test.

Notice how no test asserts on intermediate state of the SUT. All assertions
are either return-value or call-pattern assertions. This is the gomock
philosophy: black-box tests where the mocks reveal only the relevant
interactions.

## 27. A short checklist for review

When reviewing a PR that adds gomock-based tests, check:

- [ ] Is the controller created with `gomock.NewController(t)` and not a
  package-level variable?
- [ ] Are matchers used (`gomock.Any()`, `gomock.Eq(...)`) rather than
  raw values, where the raw value is brittle?
- [ ] Are call counts explicit (`Times`, `MinTimes`) rather than relying
  on `AnyTimes` for everything?
- [ ] Are ordering constraints (`InOrder`) used only where order matters
  for correctness?
- [ ] Are expectations for irrelevant calls absent? (Strict mode is your
  friend.)
- [ ] Is the generated mock checked in or generated in CI? Pick one and
  enforce it.

These habits make mock-based tests durable and informative when they
fail.

## 28. Going further

Once you are comfortable with everything above, read `middle.md` next.
The testify ecosystem is widely used in older Go codebases and you will
encounter it. After that, `senior.md` covers the broader ecosystem
(httpmock, sqlmock, redismock, bufconn, moq, counterfeiter) and helps you
pick the right tool for each layer of your stack.

## 29. Cheat-sheet of common patterns

The patterns below are the ones you will write 90% of the time. Copy them
verbatim until your fingers remember them.

```go
// 29.1 Basic setup
ctrl := gomock.NewController(t)
m := mocks.NewMockRepo(ctrl)

// 29.2 Stub a success return
m.EXPECT().Get(gomock.Any(), "k").Return(value, nil)

// 29.3 Stub an error
m.EXPECT().Get(gomock.Any(), "k").Return(nil, sentinelErr)

// 29.4 Allow any number of calls (use sparingly)
m.EXPECT().Log(gomock.Any()).AnyTimes()

// 29.5 At-least-one call
m.EXPECT().Heartbeat(gomock.Any()).MinTimes(1)

// 29.6 Custom predicate via Cond (v0.4+)
m.EXPECT().Save(gomock.Any(), gomock.Cond(func(x any) bool {
    u, ok := x.(*User)
    return ok && u.Active
})).Return(nil)

// 29.7 Capture an argument
var captured *User
m.EXPECT().Save(gomock.Any(), gomock.AssignableToTypeOf((*User)(nil))).
    DoAndReturn(func(_ context.Context, u *User) error {
        captured = u
        return nil
    })

// 29.8 Sequential responses
gomock.InOrder(
    m.EXPECT().Next().Return("a", nil),
    m.EXPECT().Next().Return("b", nil),
    m.EXPECT().Next().Return("", io.EOF),
)

// 29.9 Coordinated across mocks
gomock.InOrder(
    tx.EXPECT().Begin().Return(nil),
    repo.EXPECT().Save(gomock.Any(), gomock.Any()).Return(nil),
    tx.EXPECT().Commit().Return(nil),
)
```

Pin these to a `testutil/gomockhelpers.go` file in your project if you
find yourself repeating them across packages.

## 30. Generating mocks for multiple files at once

A common pattern is to keep all interfaces of a package in a `ports.go`
file and generate all mocks in one shot:

```go
// File: internal/usecase/ports.go
package usecase

import "context"

//go:generate mockgen -source=ports.go -destination=mocks/ports_mock.go -package=mocks

type UserRepo interface {
    Get(ctx context.Context, id string) (User, error)
    Save(ctx context.Context, u User) error
}

type EmailSender interface {
    Send(ctx context.Context, to, body string) error
}

type Clock interface {
    Now() time.Time
}
```

One `go generate` invocation produces `MockUserRepo`, `MockEmailSender`,
and `MockClock` in a single file. This keeps the test package imports
clean: `import mocks "example.com/myapp/internal/usecase/mocks"` gives
you all of them.

For the Clock interface specifically, you can also use a real fake from
the standard library or `github.com/benbjohnson/clock`, which is usually
preferable to a gomock. The same goes for any "value object" interface
with a trivial implementation.

