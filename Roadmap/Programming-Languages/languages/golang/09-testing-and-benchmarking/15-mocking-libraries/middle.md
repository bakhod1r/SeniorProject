---
layout: default
title: Mocking Libraries — Middle
parent: Mocking Libraries Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/15-mocking-libraries/middle/
---

# Mocking Libraries — Middle

[← Back](../)

This file covers two libraries used heavily in the Go ecosystem outside
the gomock world: `github.com/stretchr/testify/mock` (reflection-based,
hand-written) and `github.com/vektra/mockery` (code generator that
emits testify-style mocks). After reading this you should be able to read
and contribute to any testify-mock-based codebase and decide whether
mockery's codegen is worth adopting for your project.

## 1. The testify ecosystem in three sentences

`stretchr/testify` is a broad assertion and mocking library. The `assert`
and `require` packages provide one-line assertions; the `mock` package
provides a generic mock object you embed into your own struct; the `suite`
package provides xUnit-style test suites. Most large Go codebases use
testify for one or more of these. The `mock` package is reflection-based
and uses runtime type assertions, which has both ergonomic and safety
implications discussed below.

## 2. Writing a hand-rolled testify mock

The `mock.Mock` type provides call recording, expectation matching, and
return-value playback. You embed it into a struct and implement the
target interface:

```go
package usermocks

import (
    "context"

    "github.com/stretchr/testify/mock"

    "example.com/myapp/internal/user"
)

type UserRepo struct {
    mock.Mock
}

func (r *UserRepo) Get(ctx context.Context, id string) (*user.User, error) {
    args := r.Called(ctx, id)
    var u *user.User
    if v := args.Get(0); v != nil {
        u = v.(*user.User)
    }
    return u, args.Error(1)
}

func (r *UserRepo) Save(ctx context.Context, u *user.User) error {
    return r.Called(ctx, u).Error(0)
}

func (r *UserRepo) Delete(ctx context.Context, id string) error {
    return r.Called(ctx, id).Error(0)
}
```

Every method does the same thing:

1. Call `r.Called(args...)` which records the call and returns a
   `mock.Arguments`.
2. Pull return values out via `args.Get(0).(T)`, `args.Error(N)`, etc.
3. Return them.

This pattern is fully manual. The compiler does not know that "this is a
mock for `user.UserRepo`" — only that `UserRepo` happens to implement
the same methods. If you rename a method on the production interface, the
mock continues to compile but the test silently breaks at runtime when
the production code calls a method that the mock implements as
`Called("OldName")`.

## 3. Setting expectations and asserting

In a test:

```go
package user_test

import (
    "context"
    "errors"
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"

    "example.com/myapp/internal/user"
    "example.com/myapp/internal/user/usermocks"
)

func TestService_Get(t *testing.T) {
    repo := new(usermocks.UserRepo)
    repo.On("Get", mock.Anything, "u1").
        Return(&user.User{ID: "u1", Name: "Alice"}, nil)

    svc := user.NewService(repo)
    got, err := svc.Get(context.Background(), "u1")

    assert.NoError(t, err)
    assert.Equal(t, "Alice", got.Name)
    repo.AssertExpectations(t)
}
```

Key points:

- `repo.On("Get", mock.Anything, "u1")` declares an expectation: when
  `Called("Get", anything, "u1")` runs, return the configured values.
  The method name is a **string**. Typos here are runtime errors.
- `mock.Anything` is the equivalent of `gomock.Any()`. Other matchers:
  `mock.AnythingOfType("*user.User")`, `mock.MatchedBy(func(x T) bool)`.
- `repo.AssertExpectations(t)` verifies that every `On(...)` was
  consumed. Without this call, the test passes even if no expected call
  occurred.

Compare this to gomock: gomock fails the test automatically at the
controller's cleanup. testify defers the responsibility to the test
author. Forgetting `AssertExpectations` is one of the most common
testify pitfalls.

## 4. Default leniency

testify's mock is **lenient by default**:

```go
repo := new(usermocks.UserRepo)
// No On(...).
got, err := repo.Get(context.Background(), "u1")
// PANIC: mock: I don't know what to return because the method call was unexpected.
```

Actually no — the behavior depends on whether any `On` calls exist. If
there are no `On` calls at all, `Called(...)` panics with "I don't know
what to return". If there is at least one `On` but the arguments don't
match, the same panic occurs.

To make `Get` accept anything and return zero values:

```go
repo.On("Get", mock.Anything, mock.Anything).Return(nil, nil)
```

But — and this is the lenient-by-default trap — `AssertExpectations` will
**fail** if `Get` was never called (because the expectation was unmet).
To allow zero or more calls, use `Maybe`:

```go
repo.On("Get", mock.Anything, mock.Anything).Return(nil, nil).Maybe()
```

`Maybe()` registers the expectation but does not require it to be called.

## 5. Argument matchers

```go
// Exact value
repo.On("Get", mock.Anything, "u1").Return(...)

// Any value
repo.On("Get", mock.Anything, mock.Anything).Return(...)

// Type-based
repo.On("Save", mock.Anything, mock.AnythingOfType("*user.User")).Return(nil)

// Custom predicate
repo.On("Save", mock.Anything, mock.MatchedBy(func(u *user.User) bool {
    return u != nil && u.ID != ""
})).Return(nil)
```

`mock.MatchedBy` takes a function with one concrete-typed parameter. The
type assertion happens via reflection; if the argument is the wrong
type, the matcher returns false silently. This means a typo in the
parameter type results in the matcher never matching — and the test
fails with "expected call but didn't happen" rather than "type mismatch".

## 6. Return-value plumbing

```go
args := r.Called(ctx, id)
return args.Get(0).(*User), args.Error(1)
```

The receiver method does a type assertion on every call. If the test
configures `.Return(nil, nil)`, then `args.Get(0)` is `interface{}(nil)`,
and the assertion `args.Get(0).(*User)` returns `(*User)(nil), false`.
With the comma-ok form you guard against this; with the panicking form
you crash. Hand-written mocks usually use the guarded form:

```go
var u *User
if v := args.Get(0); v != nil {
    u = v.(*User)
}
return u, args.Error(1)
```

mockery-generated mocks do this automatically.

## 7. Call counts and ordering

testify supports call counts via `.Times(n)`, `.Once()`, `.Twice()`,
`.Maybe()`:

```go
repo.On("Save", mock.Anything, mock.Anything).Return(nil).Once()
repo.On("Save", mock.Anything, mock.Anything).Return(errSecondCall).Once()
```

The second `On` registers a second expectation for the same arguments.
testify consumes them in registration order. This is how you simulate
different responses on successive calls.

There is no direct equivalent of `gomock.InOrder` across different
methods. You can use `mock.Mock.Calls` to inspect the history and assert
order manually:

```go
repo.AssertCalled(t, "Save", mock.Anything, mock.Anything)
require.Equal(t, "Save", repo.Calls[0].Method)
require.Equal(t, "Commit", repo.Calls[1].Method)
```

But this is awkward and fragile. If ordering across methods matters,
gomock's `InOrder` is cleaner.

## 8. Side effects via `Run`

testify's equivalent of gomock's `Do`:

```go
repo.On("Save", mock.Anything, mock.Anything).
    Run(func(args mock.Arguments) {
        u := args.Get(1).(*user.User)
        t.Logf("Save called with %+v", u)
    }).
    Return(nil)
```

The `Run` callback receives `mock.Arguments` (a slice). You pull values
out by index and type-assert. There is no compile-time check that you
type-assert correctly.

There is no `DoAndReturn` equivalent — `Run` and `Return` are separate
calls. To compute the return dynamically, capture state in the closure
and use a function-returning return value isn't supported either. The
testify idiom is:

```go
counter := 0
repo.On("Next").Return(func() string {
    counter++
    return fmt.Sprintf("v%d", counter)
}, nil)
```

But this requires the production code to call the returned function,
which is awkward. Alternative: register multiple `On("Next").Once()`
calls with different `Return` values.

## 9. Mockery — codegen for testify-style mocks

`github.com/vektra/mockery` is to testify what `mockgen` is to gomock: a
generator that emits a `*testify.Mock`-based mock from an interface.

Install:

```bash
go install github.com/vektra/mockery/v2@latest
```

Configuration via `.mockery.yaml` at the repo root:

```yaml
with-expecter: true
filename: "{{.InterfaceName}}.go"
dir: "{{.InterfaceDir}}/mocks"
outpkg: mocks
mockname: "Mock{{.InterfaceName}}"
packages:
  example.com/myapp/internal/user:
    interfaces:
      UserRepo:
      EmailSender:
  example.com/myapp/internal/payment:
    config:
      dir: "{{.InterfaceDir}}/testmocks"
    interfaces:
      Provider:
```

Run:

```bash
mockery
```

For each configured interface, mockery emits a Go file with a struct
type implementing the interface using `testify/mock`. With
`with-expecter: true`, it also emits a typed `EXPECT()` API that looks
similar to gomock's:

```go
// Generated:
type MockUserRepo struct {
    mock.Mock
}

type MockUserRepo_Expecter struct {
    mock *mock.Mock
}

func (m *MockUserRepo) EXPECT() *MockUserRepo_Expecter {
    return &MockUserRepo_Expecter{mock: &m.Mock}
}

func (e *MockUserRepo_Expecter) Get(ctx, id any) *MockUserRepo_Get_Call {
    return &MockUserRepo_Get_Call{Call: e.mock.On("Get", ctx, id)}
}
```

Usage in tests:

```go
repo := mocks.NewMockUserRepo(t)
repo.EXPECT().Get(mock.Anything, "u1").
    Return(&user.User{ID: "u1"}, nil)
```

`NewMockUserRepo(t)` is a constructor mockery generates that registers
`t.Cleanup(func() { repo.AssertExpectations(t) })` automatically. This
fixes the "forgot to call AssertExpectations" pitfall mentioned in
section 3.

## 10. Mockery v2 vs v3

At time of writing, mockery has two active major versions:

- **v2** — stable, widely used, configuration via `.mockery.yaml` or CLI
  flags, supports `with-expecter`.
- **v3** — beta, redesigned config schema, supports generics fully,
  uses Go's `text/template` for output path. Many projects are still on
  v2.

Check `mockery --version`. If you are starting a new project today,
mockery v2 with `with-expecter: true` is a safe default; revisit v3 once
it stabilizes.

## 11. The naming question

Mockery's default output is `Mock{{.InterfaceName}}` in `mocks/`. Other
common conventions:

- `Fake{{.InterfaceName}}` — emphasizes "this is a stand-in", common in
  counterfeiter-using codebases.
- `{{.InterfaceName}}Mock` (suffix) — preferred in some teams for
  alphabetical grouping with the real interface.
- `mocks_{{.InterfaceName}}` — Pythonic, rare in Go.

Whichever you choose, configure `.mockery.yaml` once and stick with it:

```yaml
mockname: "Mock{{.InterfaceName}}"
```

Inconsistent naming across a large repo causes endless review nits.

## 12. The migration trade-off (testify vs gomock)

If you are choosing between testify+mockery and go.uber.org/mock+mockgen
for a new project, here is the honest comparison:

| Dimension                    | gomock + mockgen                   | testify/mock + mockery                  |
| ---------------------------- | ---------------------------------- | --------------------------------------- |
| Codegen step                 | Required (mockgen)                 | Optional (mockery) or hand-written      |
| Type safety in expectations  | Compile-time (via generated EXPECT)| Runtime (or compile-time with `with-expecter`) |
| Strict by default            | Yes                                | No (must call AssertExpectations)       |
| Argument matchers            | Rich (`Cond`, `InAnyOrder`, etc.)  | Basic + `MatchedBy`                     |
| Ordering primitives          | `InOrder`, `After`                 | None native; manual via `Calls`         |
| Failure messages             | Detailed, file:line for both sides | Less detailed                           |
| Ecosystem familiarity        | Common in Google-influenced code   | Common in everywhere else               |
| Generics                     | Full (`go.uber.org/mock@v0.4+`)    | Partial (mockery v2), full in v3        |
| Maintenance burden of mocks  | Regenerate after every change      | Regenerate after every change           |
| Mock files in PR             | Show up unless `linguist-generated`| Same                                    |

If your codebase is already using testify everywhere, sticking with
mockery is the lowest-friction choice. If you are starting clean, I lean
toward gomock for stricter-by-default behavior, but it is genuinely a
judgment call.

## 13. Migrating from hand-written testify mocks to mockery

If you inherit a codebase with hand-written testify mocks (one per
interface, often in `mocks/`), mockery can replace them with generated
files. Migration steps:

1. Install mockery: `go install github.com/vektra/mockery/v2@latest`.
2. Create `.mockery.yaml` referring to each interface.
3. Delete the hand-written mock files.
4. Run `mockery`.
5. Update test files: change `new(usermocks.UserRepo)` to
   `usermocks.NewMockUserRepo(t)`. Add `EXPECT()` if you opt into
   `with-expecter`.
6. Run tests; fix any signature mismatches the old hand-written mocks
   hid.

Step 6 is where the bugs come out. Hand-written mocks often have stale
signatures (the interface evolved, the mock didn't). Mockery enforces
the current signature.

## 14. A complete mockery example

Interface and SUT:

```go
// File: internal/billing/billing.go
package billing

import "context"

type Invoice struct {
    ID     string
    Amount int64
    Paid   bool
}

type InvoiceRepo interface {
    Find(ctx context.Context, id string) (*Invoice, error)
    Update(ctx context.Context, inv *Invoice) error
}

type Charger interface {
    Charge(ctx context.Context, amount int64) (txID string, err error)
}

type Service struct {
    repo    InvoiceRepo
    charger Charger
}

func NewService(r InvoiceRepo, c Charger) *Service {
    return &Service{repo: r, charger: c}
}

func (s *Service) PayInvoice(ctx context.Context, id string) error {
    inv, err := s.repo.Find(ctx, id)
    if err != nil {
        return err
    }
    if inv.Paid {
        return nil
    }
    if _, err := s.charger.Charge(ctx, inv.Amount); err != nil {
        return err
    }
    inv.Paid = true
    return s.repo.Update(ctx, inv)
}
```

Mockery configuration (`.mockery.yaml`):

```yaml
with-expecter: true
packages:
  example.com/myapp/internal/billing:
    config:
      dir: "{{.InterfaceDir}}/mocks"
      outpkg: mocks
      mockname: "Mock{{.InterfaceName}}"
    interfaces:
      InvoiceRepo:
      Charger:
```

After `mockery`, you have `internal/billing/mocks/InvoiceRepo.go` and
`Charger.go`. Tests:

```go
// File: internal/billing/service_test.go
package billing_test

import (
    "context"
    "errors"
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/mock"
    "github.com/stretchr/testify/require"

    "example.com/myapp/internal/billing"
    mocks "example.com/myapp/internal/billing/mocks"
)

func TestPayInvoice_Success(t *testing.T) {
    repo := mocks.NewMockInvoiceRepo(t)
    charger := mocks.NewMockCharger(t)

    inv := &billing.Invoice{ID: "i1", Amount: 1000, Paid: false}
    repo.EXPECT().Find(mock.Anything, "i1").Return(inv, nil)
    charger.EXPECT().Charge(mock.Anything, int64(1000)).Return("tx_1", nil)
    repo.EXPECT().Update(mock.Anything, mock.MatchedBy(func(i *billing.Invoice) bool {
        return i.Paid
    })).Return(nil)

    svc := billing.NewService(repo, charger)
    require.NoError(t, svc.PayInvoice(context.Background(), "i1"))
}

func TestPayInvoice_AlreadyPaid(t *testing.T) {
    repo := mocks.NewMockInvoiceRepo(t)
    charger := mocks.NewMockCharger(t)

    repo.EXPECT().Find(mock.Anything, "i2").
        Return(&billing.Invoice{ID: "i2", Paid: true}, nil)
    // charger and Update should not be called. NewMockX(t) auto-asserts.

    svc := billing.NewService(repo, charger)
    assert.NoError(t, svc.PayInvoice(context.Background(), "i2"))
}

func TestPayInvoice_FindError(t *testing.T) {
    repo := mocks.NewMockInvoiceRepo(t)
    charger := mocks.NewMockCharger(t)

    wantErr := errors.New("db down")
    repo.EXPECT().Find(mock.Anything, "i3").Return(nil, wantErr)

    svc := billing.NewService(repo, charger)
    err := svc.PayInvoice(context.Background(), "i3")
    assert.ErrorIs(t, err, wantErr)
}

func TestPayInvoice_ChargeFails(t *testing.T) {
    repo := mocks.NewMockInvoiceRepo(t)
    charger := mocks.NewMockCharger(t)

    inv := &billing.Invoice{ID: "i4", Amount: 500, Paid: false}
    repo.EXPECT().Find(mock.Anything, "i4").Return(inv, nil)
    charger.EXPECT().Charge(mock.Anything, int64(500)).
        Return("", errors.New("declined"))
    // Update not called.

    svc := billing.NewService(repo, charger)
    assert.Error(t, svc.PayInvoice(context.Background(), "i4"))
}
```

The `NewMockX(t)` constructors do two things automatically:

1. Bind the mock to the test (used in `Run` callbacks for error
   reporting).
2. Register `t.Cleanup(repo.AssertExpectations)`.

This makes testify+mockery feel almost as strict as gomock.

## 15. testify `suite` package — does it help?

`github.com/stretchr/testify/suite` provides xUnit-style test grouping
with `SetupTest`/`TearDownTest`. With mocks, it can reduce boilerplate:

```go
type ServiceSuite struct {
    suite.Suite
    repo    *mocks.MockInvoiceRepo
    charger *mocks.MockCharger
    svc     *billing.Service
}

func (s *ServiceSuite) SetupTest() {
    s.repo = mocks.NewMockInvoiceRepo(s.T())
    s.charger = mocks.NewMockCharger(s.T())
    s.svc = billing.NewService(s.repo, s.charger)
}

func (s *ServiceSuite) TestSuccess() {
    inv := &billing.Invoice{ID: "i1", Amount: 1000}
    s.repo.EXPECT().Find(mock.Anything, "i1").Return(inv, nil)
    s.charger.EXPECT().Charge(mock.Anything, int64(1000)).Return("tx_1", nil)
    s.repo.EXPECT().Update(mock.Anything, mock.Anything).Return(nil)

    s.NoError(s.svc.PayInvoice(context.Background(), "i1"))
}

func TestServiceSuite(t *testing.T) {
    suite.Run(t, new(ServiceSuite))
}
```

Verdict: `suite` is fine for shared setup, but it conflicts with
parallelism (`t.Parallel()` is awkward inside a suite). Use it only when
several tests genuinely share substantial setup.

## 16. Pitfalls specific to testify/mock

### 16.1 String-based method names

Every `On("MethodName", ...)` is a string. Rename the interface method
and the test still compiles but fails at runtime when the production
code calls a method the mock implements as `Called("OldName")`.

Mitigation: use `with-expecter: true` in mockery, which gives a typed
`EXPECT().MethodName(...)` API.

### 16.2 Lenient by default

Without `AssertExpectations`, unused expectations are silently fine. With
mockery's `NewMockX(t)` constructor this is fixed; with hand-written
mocks you have to remember.

### 16.3 Panic on missing expectation

If no `On("Foo")` matches and `Foo` is called, `Called` panics. The panic
crashes the goroutine, not the test runner — if the call happens in a
worker goroutine, the test may pass with no output and your CI flakes
forever.

Mitigation: always run tests with `-race` in CI; race detector tends to
surface goroutine panics.

### 16.4 Untyped nil

```go
repo.On("Get", mock.Anything, "u1").Return(nil, nil)
// In the mock method:
args.Get(0).(*User) // panics on nil
```

The fix is the guarded type assertion shown in section 6, or returning
a typed nil:

```go
repo.On("Get", mock.Anything, "u1").Return((*user.User)(nil), nil)
```

mockery-generated mocks handle this correctly.

## 17. When to pick mockery over mockgen

Pick mockery when:

- The codebase already uses `stretchr/testify` heavily (assertions,
  require, suite).
- You want flexible output paths (mockery's `dir` template is more
  powerful than mockgen's flat `-destination`).
- You want auto-`AssertExpectations` (via the `NewMockX(t)` constructor).

Pick mockgen when:

- You want strict-by-default failure semantics without remembering to
  call any cleanup.
- You need rich argument matching (`Cond`, `InAnyOrder`).
- You need cross-method ordering (`InOrder`).

Either way, do not mix the two within a single project. Pick one mocking
style and apply it consistently; mixed codebases are confusing to
contributors.

## 18. Quick reference

| Task                       | gomock                              | testify (mockery)                          |
| -------------------------- | ----------------------------------- | ------------------------------------------ |
| Create controller / mock   | `gomock.NewController(t)`           | `mocks.NewMockX(t)`                         |
| Set return                 | `m.EXPECT().F(args).Return(v)`      | `m.EXPECT().F(args).Return(v)`              |
| Match anything             | `gomock.Any()`                      | `mock.Anything`                             |
| Custom matcher             | `gomock.Cond(func)` or `Matcher`    | `mock.MatchedBy(func)`                      |
| Times exact                | `.Times(n)`                         | `.Times(n)` / `.Once()` / `.Twice()`        |
| Times zero or more         | `.AnyTimes()`                       | `.Maybe()`                                  |
| Side effect                | `.Do(func)` / `.DoAndReturn(func)`  | `.Run(func)` then `.Return(v)`              |
| Ordering                   | `gomock.InOrder(e1, e2, e3)`        | Manual via `m.Calls`                        |
| Verify all expectations    | Automatic (via `t.Cleanup`)         | `m.AssertExpectations(t)` or `NewMockX(t)` |

## 19. Closing thoughts

testify/mock is more popular in absolute numbers because testify itself
is the most-used Go testing library. mockery makes it tolerable to write
many mocks. But the runtime-reflection nature of testify means you
discover problems at test time, not compile time, which costs more on
large refactors.

The next file (`senior.md`) zooms out to cover the rest of the
ecosystem: HTTP mocks, SQL mocks, gRPC bufconn, redismock, moq,
counterfeiter, and how to choose between them per layer.

## 20. Deeper dive — testify Arguments object

`mock.Arguments` is a slice with helper methods. Its API is small but
useful when writing hand-rolled mocks or `Run` callbacks:

```go
type Arguments []interface{}

func (args Arguments) Get(i int) interface{}
func (args Arguments) Int(i int) int
func (args Arguments) Error(i int) error
func (args Arguments) Bool(i int) bool
func (args Arguments) String(i int) string
```

Each typed accessor panics on type mismatch — except `Error`, which
gracefully returns nil if the argument is nil. The common idiom in
hand-written mocks is:

```go
func (m *Repo) Find(ctx context.Context, id string) (*User, error) {
    args := m.Called(ctx, id)
    return args.Get(0).(*User), args.Error(1)
}
```

This works as long as `Return` is always called with `(*User, error)`.
If you mistakenly write `Return("oops", nil)` somewhere, the type
assertion in `args.Get(0).(*User)` panics at test runtime.

## 21. testify mock and goroutines

`mock.Mock` uses an internal `sync.Mutex` for goroutine safety, but its
behavior under concurrent use is subtle:

```go
repo := new(usermocks.UserRepo)
repo.On("Save", mock.Anything, mock.Anything).Return(nil)

var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        repo.Save(context.Background(), &user.User{ID: fmt.Sprintf("u%d", i)})
    }(i)
}
wg.Wait()
```

This works: the mutex serializes access. But `AssertExpectations` only
verifies that *at least one* matching call happened (since `Return` was
not given `.Times(n)`). If you want to assert exactly 10 calls
happened, use `.Times(10)` and trust that the mutex correctly serializes
the call count.

Goroutine pitfall: if `Save` is called from a goroutine that panics
(because the test forgot to set up an expectation), the panic happens
inside the goroutine. Without `recover`, the goroutine crashes silently,
the test's main goroutine continues, and the test might pass.

Mitigation: always run tests with `-race` and `-timeout 30s`. A
goroutine panic with no `recover` crashes the test binary, which the
race detector catches.

## 22. mockery and the `inpackage` mode

By default mockery generates mocks in a separate `mocks/` subdirectory.
For interfaces with unexported fields or methods that the mock needs to
access, generate in the same package:

```yaml
packages:
  example.com/myapp/internal/store:
    config:
      inpackage: true
      mockname: "mock{{.InterfaceName}}"
    interfaces:
      UserRepo:
```

This produces `internal/store/mock_UserRepo.go` in `package store`. The
mock type starts lowercase (`mockUserRepo`) and is not exported. Tests
in the same package can use it directly.

Trade-off: production builds include the mock file unless you add a
build tag. Add `//go:build !production` (or similar) to keep mocks out
of release builds.

## 23. Generated file headers and tooling

Both mockgen and mockery emit a `// Code generated by ... DO NOT EDIT.`
header. Tools that respect this header:

- `gopls` (the language server) marks generated files as such, useful
  for navigation.
- `go vet` skips some checks on generated files.
- `golangci-lint` can exclude generated files via the `exclude-rules`
  section.

`.gitattributes` magic:

```
**/mocks/*.go    linguist-generated=true
```

This tells GitHub to collapse generated mock files in PR diffs, which is
the single biggest quality-of-life improvement for code review when you
have hundreds of generated mocks.

## 24. Snapshot of a real mockery output

For reference, a typical mockery v2 output with `with-expecter: true`
looks like this (lightly trimmed for brevity):

```go
// Code generated by mockery v2.40.1. DO NOT EDIT.

package mocks

import (
    context "context"

    user "example.com/myapp/internal/user"
    mock "github.com/stretchr/testify/mock"
)

type MockUserRepo struct {
    mock.Mock
}

type MockUserRepo_Expecter struct {
    mock *mock.Mock
}

func (m *MockUserRepo) EXPECT() *MockUserRepo_Expecter {
    return &MockUserRepo_Expecter{mock: &m.Mock}
}

// Get provides a mock function.
func (m *MockUserRepo) Get(ctx context.Context, id string) (*user.User, error) {
    ret := m.Called(ctx, id)

    var r0 *user.User
    var r1 error
    if rf, ok := ret.Get(0).(func(context.Context, string) (*user.User, error)); ok {
        return rf(ctx, id)
    }
    if rf, ok := ret.Get(0).(func(context.Context, string) *user.User); ok {
        r0 = rf(ctx, id)
    } else {
        if ret.Get(0) != nil {
            r0 = ret.Get(0).(*user.User)
        }
    }
    if rf, ok := ret.Get(1).(func(context.Context, string) error); ok {
        r1 = rf(ctx, id)
    } else {
        r1 = ret.Error(1)
    }
    return r0, r1
}

type MockUserRepo_Get_Call struct {
    *mock.Call
}

func (e *MockUserRepo_Expecter) Get(ctx, id interface{}) *MockUserRepo_Get_Call {
    return &MockUserRepo_Get_Call{Call: e.mock.On("Get", ctx, id)}
}

func (c *MockUserRepo_Get_Call) Run(run func(ctx context.Context, id string)) *MockUserRepo_Get_Call {
    c.Call.Run(func(args mock.Arguments) {
        run(args[0].(context.Context), args[1].(string))
    })
    return c
}

func (c *MockUserRepo_Get_Call) Return(_a0 *user.User, _a1 error) *MockUserRepo_Get_Call {
    c.Call.Return(_a0, _a1)
    return c
}

func (c *MockUserRepo_Get_Call) RunAndReturn(run func(context.Context, string) (*user.User, error)) *MockUserRepo_Get_Call {
    c.Call.Return(run)
    return c
}

func NewMockUserRepo(t interface {
    mock.TestingT
    Cleanup(func())
}) *MockUserRepo {
    m := &MockUserRepo{}
    m.Mock.Test(t)
    t.Cleanup(func() { m.AssertExpectations(t) })
    return m
}
```

Notice:

- `NewMockUserRepo` registers the cleanup, so callers do not have to
  remember `AssertExpectations`.
- The `Get` method does function-type detection on the return value,
  which is how mockery enables both static `Return(v)` and dynamic
  `RunAndReturn(func)` modes.
- Typed nil is handled (the `if ret.Get(0) != nil` guard).

The cost is that each method generates roughly 40 lines of code. For an
interface with 10 methods you get 400 lines of generated code. This is
fine for a test-only file but inflates `go build` slightly and shows up
in coverage reports unless excluded.

## 25. Hand-writing fakes alongside testify

Some teams use testify for assertions but write fakes instead of mocks
for repositories:

```go
package userfakes

import (
    "context"
    "sync"

    "example.com/myapp/internal/user"
)

type UserRepo struct {
    mu    sync.Mutex
    Items map[string]*user.User
    SaveErr error
    GetErr  error
}

func New() *UserRepo {
    return &UserRepo{Items: map[string]*user.User{}}
}

func (r *UserRepo) Get(ctx context.Context, id string) (*user.User, error) {
    r.mu.Lock()
    defer r.mu.Unlock()
    if r.GetErr != nil {
        return nil, r.GetErr
    }
    u, ok := r.Items[id]
    if !ok {
        return nil, user.ErrNotFound
    }
    return u, nil
}

func (r *UserRepo) Save(ctx context.Context, u *user.User) error {
    r.mu.Lock()
    defer r.mu.Unlock()
    if r.SaveErr != nil {
        return r.SaveErr
    }
    r.Items[u.ID] = u
    return nil
}

func (r *UserRepo) Delete(ctx context.Context, id string) error {
    r.mu.Lock()
    defer r.mu.Unlock()
    delete(r.Items, id)
    return nil
}
```

Tests then use:

```go
func TestService(t *testing.T) {
    repo := userfakes.New()
    svc := user.NewService(repo)

    require.NoError(t, svc.Create(context.Background(), "alice"))

    // Assert on observable state, not call patterns.
    require.NotNil(t, repo.Items["alice"])
    require.Equal(t, "alice", repo.Items["alice"].ID)
}
```

The fake is 30 lines of code (compared to ~150 lines of generated mock)
and survives refactors that change which methods the service calls in
what order, as long as the observable behavior is the same.

The trade-off: a fake encodes assumptions about the production
implementation (e.g. "Save and Get are CRUD on the same map"). If those
assumptions diverge from the real implementation (e.g. the real database
adds constraints the fake doesn't), tests can pass while production
breaks. Many teams write a small *contract test* that runs both the
fake and the real implementation against the same scenarios to catch
this drift.

## 26. Detecting unused mocks in CI

Both testify and gomock can leave unused expectations. To catch them:

```bash
go test -v ./... 2>&1 | grep -E '(FAIL|missing call|unexpected call)' || true
```

Add this to your CI pipeline as a separate "test sanity" step. It does
not gate the build (tests already gate the build), but it surfaces
trends like "this package has 12 unused expectations" that indicate
dead test code.

mockery's `NewMockX(t)` constructor calls `AssertExpectations`
automatically at `t.Cleanup`, so unused expectations cause test
failures. If you write hand-rolled testify mocks, add the same wrapper:

```go
func NewUserRepo(t *testing.T) *usermocks.UserRepo {
    t.Helper()
    m := new(usermocks.UserRepo)
    t.Cleanup(func() { m.AssertExpectations(t) })
    return m
}
```

This is one of the easiest test hygiene wins you can adopt.

## 27. testify vs gomock for table-driven tests

Mocks fit awkwardly into table-driven tests because each case wants
different mock behavior. The standard pattern is to attach a setup
function to each case:

```go
type testCase struct {
    name      string
    setupRepo func(*mocks.MockUserRepo)
    input     string
    wantErr   bool
}

cases := []testCase{
    {
        name: "happy",
        setupRepo: func(m *mocks.MockUserRepo) {
            m.EXPECT().Get(mock.Anything, "u1").Return(&user.User{ID: "u1"}, nil)
        },
        input:   "u1",
        wantErr: false,
    },
    {
        name: "not found",
        setupRepo: func(m *mocks.MockUserRepo) {
            m.EXPECT().Get(mock.Anything, "u2").Return(nil, user.ErrNotFound)
        },
        input:   "u2",
        wantErr: true,
    },
}

for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        repo := mocks.NewMockUserRepo(t)
        tc.setupRepo(repo)
        svc := user.NewService(repo)
        _, err := svc.Get(context.Background(), tc.input)
        if (err != nil) != tc.wantErr {
            t.Errorf("err = %v, wantErr = %v", err, tc.wantErr)
        }
    })
}
```

This pattern works for both gomock and testify. The key is the per-case
`setupRepo` function: it lets each table row encode its own mock
expectations without forcing a giant switch statement.

## 28. Generating mocks for vendored interfaces

If you need to mock an interface from a third-party module (e.g.
`io.Reader`, `aws.Client`):

mockery:

```yaml
packages:
  io:
    interfaces:
      Reader:
      Writer:
```

mockgen reflect mode:

```bash
mockgen io Reader -destination=mocks/io_reader.go -package=mocks
```

Both produce a mock you can use without writing the interface yourself.
Useful for testing code that consumes stdlib interfaces.

## 29. Composing mocks (one struct implementing multiple interfaces)

Sometimes one dependency satisfies multiple interfaces — e.g. a single
`PaymentClient` is both a `Charger` and a `Refunder`. You can either:

a. Mock the union interface (`ChargerRefunder`).
b. Mock each separately and inject the same instance twice.

Option (a) is cleaner; option (b) violates DRY but lets each test focus
on one capability.

In mockery you can declare a union interface and generate one mock:

```go
type Payments interface {
    Charger
    Refunder
}
```

mockery sees `Payments`, flattens the embedded interfaces, and emits
`MockPayments` with both `Charge` and `Refund` methods.

## 30. Wrap-up

You should now be able to:

- Write hand-rolled testify mocks for any interface.
- Configure mockery via `.mockery.yaml` and generate mocks from it.
- Use `with-expecter: true` to get a typed expectation API.
- Recognize and avoid the four classic testify pitfalls (string method
  names, lenient default, panic propagation, untyped nil).
- Decide whether testify+mockery or gomock+mockgen fits a given project
  better.

The senior file dives into HTTP, SQL, gRPC, and Redis mocking, and
introduces the lighter-weight code generators `moq` and `counterfeiter`.

## 31. Bonus — mockery template variables

mockery's path templates support more variables than the docs make
obvious. The full set in v2.x:

- `{{.InterfaceName}}` — bare name (`UserRepo`).
- `{{.InterfaceNameSnake}}` — snake_case version (`user_repo`).
- `{{.InterfaceNameLower}}` — lowercase (`userrepo`).
- `{{.InterfaceNameCamel}}` — camelCase (`userRepo`).
- `{{.InterfaceDir}}` — directory of the source interface.
- `{{.InterfaceDirRelative}}` — relative to module root.
- `{{.PackageName}}` — short package name.
- `{{.PackagePath}}` — full import path.
- `{{.SrcPackageName}}` — source package short name.

Example for a monorepo with many services:

```yaml
filename: "mock_{{.InterfaceNameSnake}}.go"
dir: "{{.InterfaceDir}}/internal/mocks"
outpkg: "{{.PackageName}}mocks"
```

Result for `example.com/myapp/services/billing/Charger`:

- file `services/billing/internal/mocks/mock_charger.go`
- package `billingmocks`

Tune these once and contributors don't have to think about file
placement again.

## 32. Bonus — combining testify and gomock in one project (don't)

If part of your codebase predates the other half and uses a different
mocking style, the temptation is to write new tests with the modern
library and leave the old ones alone. This works but creates an asymmetry
where contributors must learn both libraries.

A better approach:

1. Pick one library going forward and add it to your contribution
   guidelines.
2. As you touch test files for unrelated reasons, convert them to the
   new library.
3. Set a deadline (e.g. 6 months) to finish the migration and remove the
   old library.

Tracking remaining usages is one `grep`:

```bash
grep -rl 'github.com/stretchr/testify/mock' --include='*.go' . | wc -l
```

A burn-down chart of this number over time keeps the migration on
people's minds.

## 33. Bonus — testify mock with generics (workaround)

mockery v2 has incomplete generics support. For a generic interface:

```go
type Cache[K comparable, V any] interface {
    Get(K) (V, bool)
    Set(K, V)
}
```

mockery v2 either errors out or produces a non-generic mock for a
specific instantiation. The workarounds:

a. Hand-roll the mock for that interface.
b. Wrap the generic interface with a non-generic one used at the call
   site:

```go
type StringIntCache interface {
    Get(string) (int, bool)
    Set(string, int)
}
```

Then mock `StringIntCache`. Slightly more boilerplate but avoids
mockery limitations.

c. Use mockery v3 (currently beta), which has improved generics
support.

For `go.uber.org/mock`, generics work out of the box in v0.4+.

## 34. Bonus — testify assertions vs require

A common confusion: `assert` vs `require`. Both packages have identical
signatures, but:

- `assert.Equal(t, want, got)` — on failure, marks the test as failed
  but **continues running**.
- `require.Equal(t, want, got)` — on failure, marks the test as failed
  and **calls `t.FailNow`**, ending the test immediately.

In mock-based tests, prefer `require` for setup assertions (failing
fast is correct when setup is broken) and `assert` for behavioral
checks (you may want to know all the things that are wrong).

```go
require.NoError(t, svc.Init(ctx)) // setup; bail if it fails
assert.Equal(t, "Alice", got.Name)
assert.True(t, got.Active)
assert.WithinDuration(t, time.Now(), got.CreatedAt, time.Second)
```

This is unrelated to mocking but pervasive in testify-heavy code; worth
internalizing.

## 35. Closing checklist for testify+mockery projects

- [ ] Pin mockery version in `tools.go`.
- [ ] Check `.mockery.yaml` into the repo.
- [ ] CI runs `mockery && git diff --exit-code` to catch stale mocks.
- [ ] All generated mocks use `NewMockX(t)` constructor (auto-cleanup).
- [ ] Use `mock.MatchedBy` for non-trivial argument matching.
- [ ] Mock files marked `linguist-generated=true` in `.gitattributes`.
- [ ] `golangci-lint` excludes generated files from style checks.

With these in place, testify+mockery is a productive mocking setup for
the long term.

## 36. Reading exercises before senior.md

Before moving on, try the following on a small repo of yours:

1. Add a new interface with three methods, generate a mockery mock for
   it, and write a happy-path and two error-path tests.
2. Convert one of those tests to gomock to feel the difference. Compare
   line counts and failure messages.
3. Replace one mockery mock with a hand-written fake. Note which tests
   become simpler and which require new state.
4. Run `mockery` in CI and verify it fails the build when you delete a
   generated file without rerunning the generator. This catches stale
   mocks before review.

Doing these three exercises gives you the muscle memory needed for the
senior-level material in the next file, which assumes you already know
the trade-offs between the two main libraries.

## 37. One more nuance — `Mock.Test` and friendly failures

`mock.Mock` has an internal field `t mock.TestingT`. Setting it via
`m.Mock.Test(t)` causes mock failures (e.g. unexpected method calls) to
fail the specific test rather than panic. Mockery's `NewMockX(t)`
constructor calls `m.Mock.Test(t)` for you. If you write hand-rolled
testify mocks, do the same in your wrapper constructor:

```go
func NewUserRepo(t *testing.T) *usermocks.UserRepo {
    t.Helper()
    m := new(usermocks.UserRepo)
    m.Mock.Test(t)
    t.Cleanup(func() { m.AssertExpectations(t) })
    return m
}
```

Without `m.Mock.Test(t)`, unexpected calls panic mid-test, which is
harder to debug than a clean `t.Fatalf`. This is one of those small
details that distinguishes a hand-rolled mock setup that ages well from
one that doesn't.
