---
layout: default
title: Mocks and Stubs — Middle
parent: Mocks and Stubs
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/03-mocks-and-stubs/middle/
---

# Mocks and Stubs — Middle

[← Back](../)

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Why You Eventually Reach for a Framework](#why-you-eventually-reach-for-a-framework)
4. [`testify/mock` — A Full Walkthrough](#testifymock--a-full-walkthrough)
5. [`mockery` — Code Generation for `testify/mock`](#mockery--code-generation-for-testifymock)
6. [`gomock` (`go.uber.org/mock`) — Strict Typed Mocks](#gomock-gouberorgmock--strict-typed-mocks)
7. [`moq` — Minimal Generation Without a Framework](#moq--minimal-generation-without-a-framework)
8. [Comparison — Same Test, Three Tools](#comparison--same-test-three-tools)
9. [Argument Matchers in Each Framework](#argument-matchers-in-each-framework)
10. [Ordering and Call Counts](#ordering-and-call-counts)
11. [Wiring Mocks into `go generate`](#wiring-mocks-into-go-generate)
12. [Picking a Framework for Your Project](#picking-a-framework-for-your-project)
13. [Common Pitfalls](#common-pitfalls)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

The junior file established the principle: in Go, hand-rolled stubs are the default. The middle file is about the *escape hatch* — what to do when hand-rolled is no longer the fastest path. You will learn the three mainstream tools used to generate or simulate mocks in Go:

1. **`testify/mock`** — a reflection-based mock object with expectation recording. Written by hand, no codegen required.
2. **`mockery`** — a code generator that produces `testify/mock`-compatible mocks from interface declarations.
3. **`gomock`** (`go.uber.org/mock`) — Google's strict, typed mock framework. Always uses codegen via `mockgen`.

You will see the same test written in all three styles and learn to read code that uses each. By the end of this file you should be comfortable opening a `testify/mock` or `gomock`-based test and understanding what is being asserted, and you should know which framework you would pick for a new project.

We are still working in plain Go — no exotic patterns. The mental model is unchanged from the junior file: an interface, an implementation that satisfies it, and a substitute (stub/mock) that also satisfies it. The frameworks just *generate* or *assist* that substitute.

---

## Prerequisites

- You have read the junior file in this section, or are comfortable hand-rolling a stub from an interface.
- You can run `go test ./...` and read its output.
- You have used `go mod tidy` and added a third-party dependency before.
- You know what `go generate` does in principle (it runs a directive comment to produce code).

You do *not* need:

- Experience with mock frameworks from other languages.
- Deep reflection knowledge — we will not write reflection ourselves, only consume it.

---

## Why You Eventually Reach for a Framework

Hand-rolled stubs scale linearly with interface size. For a 2-method interface, a stub is 4 lines. For a 12-method interface, the stub is 30+ lines. For a 30-method interface used in 50 tests... you start regretting your career choices.

Three pain points push teams toward frameworks:

### Pain point 1 — Stub bodies you do not care about

A 15-method interface where each test only uses 3 methods forces you to either:

- Implement 12 no-op methods you do not care about, OR
- Embed a base type with no-ops and override 3 — clean but adds friction.

A framework lets you "only set up the methods you need" because the underlying mock object intercepts calls dynamically.

### Pain point 2 — Verifying call arguments

You wrote a spy with a recording slice. Now you want to assert: "called with `to=alice@x` and `body` containing the order ID." Per-test you write:

```go
if len(spy.calls) != 1 { t.Fatalf(...) }
if spy.calls[0].to != "alice@x" { t.Errorf(...) }
if !strings.Contains(spy.calls[0].body, "ORD-1") { t.Errorf(...) }
```

For one test, fine. For 30 tests, repetitive. A framework lets you express that more compactly:

```go
m.On("Send", "alice@x", mock.MatchedBy(func(b string) bool {
    return strings.Contains(b, "ORD-1")
})).Return(nil)
```

### Pain point 3 — Strict expectation enforcement

Sometimes you want a test to fail if an *unexpected* call is made. A hand-rolled spy will silently record any call, even one your code should not be making. A mock framework can flag unexpected calls as test failures automatically.

If you hit none of these pains, do not adopt a framework just because it exists. If you hit two or three regularly, a framework will save time.

---

## `testify/mock` — A Full Walkthrough

Add to your project:

```bash
go get github.com/stretchr/testify
```

### Step 1 — Define the mock type

For our `EmailSender` interface from the junior file:

```go
package signup_test

import (
    "context"
    "testing"

    "github.com/stretchr/testify/mock"
    "github.com/stretchr/testify/require"
    "example.com/signup"
)

type MockMailer struct {
    mock.Mock // embed the framework's mock object
}

func (m *MockMailer) Send(ctx context.Context, to, subject, body string) error {
    args := m.Called(ctx, to, subject, body)
    return args.Error(0)
}

var _ signup.EmailSender = (*MockMailer)(nil)
```

What's happening:

- `mock.Mock` is the framework's recording engine; embedding it gives `MockMailer` all the bookkeeping methods (`On`, `Called`, `AssertExpectations`).
- `m.Called(...)` records that this method was invoked with these arguments and returns an `Arguments` slice. The framework decides what to return by looking up the expectations registered via `On`.
- `args.Error(0)` extracts the first return value as an `error`. There are similar helpers: `args.String(0)`, `args.Int(0)`, `args.Get(0).(MyType)`.

### Step 2 — Set up expectations and run the test

```go
func TestSignup_ValidEmail(t *testing.T) {
    m := new(MockMailer)
    m.On("Send", mock.Anything, "alice@example.com", "Welcome!", mock.AnythingOfType("string")).
        Return(nil).Once()
    defer m.AssertExpectations(t)

    svc := &signup.Service{Mailer: m}
    err := svc.Signup(context.Background(), "alice@example.com")
    require.NoError(t, err)
}
```

What's happening:

- `m.On("Send", ...)` declares "when `Send` is called with these arguments, return `nil`." The first argument to `On` is the method name as a string. The remaining arguments are matchers for the method's arguments.
- `mock.Anything` matches any value.
- `mock.AnythingOfType("string")` matches any string.
- `.Return(nil)` sets the return value.
- `.Once()` says exactly one call is expected; alternatives include `.Twice()`, `.Times(n)`, `.Maybe()` (optional).
- `defer m.AssertExpectations(t)` runs at the end of the test and fails if any `On` expectation was not satisfied.

### Step 3 — Test the error path

```go
func TestSignup_MailerError(t *testing.T) {
    boom := errors.New("smtp down")
    m := new(MockMailer)
    m.On("Send", mock.Anything, mock.Anything, mock.Anything, mock.Anything).
        Return(boom).Once()
    defer m.AssertExpectations(t)

    svc := &signup.Service{Mailer: m}
    err := svc.Signup(context.Background(), "alice@example.com")
    require.ErrorIs(t, err, boom)
}
```

### Step 4 — `mock.MatchedBy` for custom predicates

If `mock.Anything` is too loose and `mock.AnythingOfType` is too coarse, use a custom matcher:

```go
m.On("Send",
    mock.Anything,
    "alice@example.com",
    "Welcome!",
    mock.MatchedBy(func(body string) bool {
        return strings.Contains(body, "Thanks for signing up")
    }),
).Return(nil)
```

The closure receives the actual argument and returns `true` if it matches.

### Step 5 — Inspecting calls with `.Run`

`.Run(func(args mock.Arguments))` lets you peek at arguments without consuming them as return values:

```go
m.On("Send", mock.Anything, mock.Anything, mock.Anything, mock.Anything).
    Run(func(args mock.Arguments) {
        t.Logf("Send invoked with to=%s subject=%s", args.String(1), args.String(2))
    }).
    Return(nil)
```

Useful for diagnostic output during flaky-test investigation.

### Step 6 — Sequencing and call counts

`testify/mock` supports basic ordering via `.NotBefore`:

```go
begin := m.On("Begin").Return(tx, nil)
insert := m.On("Insert", mock.Anything).Return(nil).NotBefore(begin)
m.On("Commit").Return(nil).NotBefore(insert)
```

For complex sequencing, `gomock`'s `InOrder` is more ergonomic — we will see it shortly.

### What `testify/mock` is good at

- Easy to embed and use; no codegen required.
- Familiar Java-Mockito-like API.
- Plays nicely with the rest of the `testify` suite (`assert`, `require`).

### What `testify/mock` is *not* good at

- Method names are strings — typos compile silently and surface as panics ("unknown method") at runtime.
- Argument matchers use `interface{}` — no compile-time type checking.
- Verbose: each test registers expectations explicitly. Tests with many calls become hard to read.

For a 3-test, 1-method interface this is overkill. For a 30-test, 5-method interface, it shines.

---

## `mockery` — Code Generation for `testify/mock`

`mockery` reads your interface declarations and generates the `MockX` struct + methods automatically. Same runtime semantics as `testify/mock`, but you do not hand-write the boilerplate.

### Install

```bash
go install github.com/vektra/mockery/v2@latest
```

### Generate

Two common ways:

**1. CLI flags:**

```bash
mockery --name EmailSender --dir ./signup --output ./signup/mocks --outpkg mocks
```

**2. Config file (`.mockery.yaml`):**

```yaml
with-expecter: true
dir: "mocks/{{.PackagePath}}"
filename: "{{.InterfaceName}}.go"
mockname: "Mock{{.InterfaceName}}"
outpkg: "mocks"
packages:
  example.com/signup:
    interfaces:
      EmailSender:
```

Run `mockery` with no flags; it reads the YAML.

### The generated file

For our `EmailSender`, `mockery` produces something like:

```go
// Code generated by mockery v2.x.x. DO NOT EDIT.

package mocks

import (
    context "context"
    mock "github.com/stretchr/testify/mock"
)

type MockEmailSender struct {
    mock.Mock
}

type MockEmailSender_Expecter struct {
    mock *mock.Mock
}

func (_m *MockEmailSender) EXPECT() *MockEmailSender_Expecter {
    return &MockEmailSender_Expecter{mock: &_m.Mock}
}

func (_m *MockEmailSender) Send(ctx context.Context, to, subject, body string) error {
    ret := _m.Called(ctx, to, subject, body)

    var r0 error
    if rf, ok := ret.Get(0).(func(context.Context, string, string, string) error); ok {
        r0 = rf(ctx, to, subject, body)
    } else {
        r0 = ret.Error(0)
    }
    return r0
}

type MockEmailSender_Send_Call struct {
    *mock.Call
}

func (_e *MockEmailSender_Expecter) Send(ctx, to, subject, body interface{}) *MockEmailSender_Send_Call {
    return &MockEmailSender_Send_Call{Call: _e.mock.On("Send", ctx, to, subject, body)}
}

func (_c *MockEmailSender_Send_Call) Return(_a0 error) *MockEmailSender_Send_Call {
    _c.Call.Return(_a0)
    return _c
}
```

(Real `mockery` output is longer; this is the essence.)

### The `EXPECT()` API

The `with-expecter: true` config produces a typed wrapper:

```go
m := mocks.NewMockEmailSender(t)
m.EXPECT().Send(mock.Anything, "alice@x", "Welcome!", mock.Anything).Return(nil)
```

Benefits over plain `On`:

- `m.EXPECT().Send(...)` is compile-checked — typos in the method name fail at compile time.
- Argument count is enforced by the type signature, not by string-based reflection.
- IDE autocomplete works.

This is by far the recommended way to use `mockery` in new code.

### When `mockery` earns its keep

- The interface has 5+ methods.
- The interface is used in 5+ test files.
- Your team is comfortable with `go generate` and CI verification of generated files.

If you have a 1-method interface used in 2 tests, hand-rolling is still faster.

---

## `gomock` (`go.uber.org/mock`) — Strict Typed Mocks

`gomock` is Google's mock framework, originally `github.com/golang/mock`. That repo was archived in June 2023; the active fork is `go.uber.org/mock`. New projects should use the Uber path. APIs are identical.

### Install

```bash
go install go.uber.org/mock/mockgen@latest
go get go.uber.org/mock/gomock
```

### Generate

Two modes:

**Source mode** — parses one Go file, generates mocks for every interface in it:

```bash
mockgen -source=signup/mailer.go -destination=signup/mocks/mailer_mock.go -package=mocks
```

**Reflect mode** — compiles a temp program that imports the target package:

```bash
mockgen -destination=signup/mocks/mailer_mock.go example.com/signup EmailSender
```

Source mode is faster but does not resolve cross-package types. Reflect mode is slower but resolves them.

### Use in a test

```go
package signup_test

import (
    "context"
    "errors"
    "testing"

    "go.uber.org/mock/gomock"
    "github.com/stretchr/testify/require"
    "example.com/signup"
    mocks "example.com/signup/mocks"
)

func TestSignup_ValidEmail_gomock(t *testing.T) {
    ctrl := gomock.NewController(t) // auto-Finishes at test end since v1.5
    m := mocks.NewMockEmailSender(ctrl)

    m.EXPECT().
        Send(gomock.Any(), gomock.Eq("alice@example.com"), gomock.Eq("Welcome!"), gomock.Any()).
        Return(nil).
        Times(1)

    svc := &signup.Service{Mailer: m}
    err := svc.Signup(context.Background(), "alice@example.com")
    require.NoError(t, err)
}

func TestSignup_MailerError_gomock(t *testing.T) {
    boom := errors.New("smtp down")
    ctrl := gomock.NewController(t)
    m := mocks.NewMockEmailSender(ctrl)

    m.EXPECT().
        Send(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).
        Return(boom)

    svc := &signup.Service{Mailer: m}
    err := svc.Signup(context.Background(), "alice@example.com")
    require.ErrorIs(t, err, boom)
}
```

### Differences from `testify/mock`

| Aspect | `testify/mock` | `gomock` |
|--------|----------------|----------|
| Method name | String (`"Send"`) | Typed (`Send(...)`) |
| Argument matching | `mock.Anything`, `MatchedBy` | `gomock.Any()`, `gomock.Eq`, custom `Matcher` |
| Call count | `.Once()`, `.Times(n)`, `.Maybe()` | `.Times(n)`, `.MinTimes(n)`, `.MaxTimes(n)`, `.AnyTimes()` |
| Ordering | `.NotBefore(other)` | `gomock.InOrder(...)`, `.After(other)` |
| Unexpected call | Panics ("unknown method") unless `mock.Test(t)` | Test failure (controller-driven) |
| Codegen required | No (manual) or yes (mockery) | Yes (mockgen) |
| Compile-time type check | No (with `mockery+EXPECT()`: partial) | Yes |

### `gomock.InOrder` — clean sequencing

For transactional code that *must* call `Begin`, `Insert`, `Commit` in that order:

```go
gomock.InOrder(
    db.EXPECT().Begin().Return(tx, nil),
    db.EXPECT().Insert(gomock.Any()).Return(nil),
    db.EXPECT().Commit().Return(nil),
)
```

If your code calls `Commit` before `Insert`, the controller fails the test with a precise error pointing at the violated edge.

### Custom matchers

Implement the `gomock.Matcher` interface for domain-specific matching:

```go
type orderHasID struct{ id string }

func (m orderHasID) Matches(x interface{}) bool {
    o, ok := x.(Order)
    return ok && o.ID == m.id
}
func (m orderHasID) String() string { return fmt.Sprintf("order with id=%s", m.id) }

// usage:
repo.EXPECT().Save(gomock.Any(), orderHasID{id: "ORD-1"}).Return(nil)
```

The `String()` method controls how the matcher appears in failure messages — make it descriptive.

### Controller behavior

`gomock.NewController(t)` since v1.5 (Uber fork) registers a `t.Cleanup` that automatically calls `Finish`. You do not need `defer ctrl.Finish()`.

Behaviors:

- Unexpected call -> test fails immediately with method name and arguments.
- Expected call not satisfied by end of test -> test fails at `Finish`.
- Multiple matching expectations -> the first matching one fires; consider using ordering or counts to disambiguate.

---

## `moq` — Minimal Generation Without a Framework

`github.com/matryer/moq` generates mocks that do not depend on any framework. The output is plain Go with closure-based method bodies.

### Install

```bash
go install github.com/matryer/moq@latest
```

### Generate

```bash
moq -out mailer_mock.go -pkg mocks ./signup EmailSender
```

### Generated output (essence)

```go
type EmailSenderMock struct {
    SendFunc func(ctx context.Context, to, subject, body string) error

    calls struct {
        Send []struct {
            Ctx     context.Context
            To      string
            Subject string
            Body    string
        }
    }
    lockSend sync.RWMutex
}

func (m *EmailSenderMock) Send(ctx context.Context, to, subject, body string) error {
    if m.SendFunc == nil {
        panic("EmailSenderMock.SendFunc not set")
    }
    callInfo := struct{ Ctx context.Context; To, Subject, Body string }{ctx, to, subject, body}
    m.lockSend.Lock()
    m.calls.Send = append(m.calls.Send, callInfo)
    m.lockSend.Unlock()
    return m.SendFunc(ctx, to, subject, body)
}

func (m *EmailSenderMock) SendCalls() []struct{ Ctx context.Context; To, Subject, Body string } {
    m.lockSend.RLock()
    defer m.lockSend.RUnlock()
    return m.calls.Send
}
```

### Use it

```go
m := &mocks.EmailSenderMock{
    SendFunc: func(ctx context.Context, to, subject, body string) error {
        return nil
    },
}
svc := &signup.Service{Mailer: m}
_ = svc.Signup(ctx, "alice@x")

calls := m.SendCalls()
require.Len(t, calls, 1)
require.Equal(t, "alice@x", calls[0].To)
```

### Why `moq` is appealing

- No framework dependency at runtime.
- Reads like hand-rolled code; new readers do not need to know `On`/`EXPECT`.
- Fast: no reflection at the call site.
- Generated code is shorter than `mockery`'s output.

### Why `moq` is sometimes not enough

- No expectation-style API. You record calls and assert externally.
- No built-in argument matchers beyond what you write yourself.
- Less mindshare than `testify` or `gomock`; fewer Stack Overflow answers.

For teams that want generation but feel `testify/mock` is too magical, `moq` is the middle ground.

---

## Comparison — Same Test, Three Tools

Interface:

```go
type Mailer interface {
    Send(ctx context.Context, to, subject, body string) error
}
```

SUT:

```go
type Service struct{ M Mailer }
func (s *Service) Welcome(ctx context.Context, email string) error {
    return s.M.Send(ctx, email, "Welcome!", "Thanks for signing up.")
}
```

### Hand-rolled

```go
type spyMailer struct{ calls []string }
func (s *spyMailer) Send(_ context.Context, to, _, _ string) error {
    s.calls = append(s.calls, to)
    return nil
}

func TestWelcome_Hand(t *testing.T) {
    s := &spyMailer{}
    svc := &Service{M: s}
    require.NoError(t, svc.Welcome(context.Background(), "alice@x"))
    require.Equal(t, []string{"alice@x"}, s.calls)
}
```

**Line count: 9. Dependencies: 0.**

### `testify/mock`

```go
type MockMailer struct{ mock.Mock }
func (m *MockMailer) Send(ctx context.Context, to, subject, body string) error {
    return m.Called(ctx, to, subject, body).Error(0)
}

func TestWelcome_Testify(t *testing.T) {
    m := new(MockMailer)
    m.On("Send", mock.Anything, "alice@x", "Welcome!", mock.Anything).Return(nil).Once()
    defer m.AssertExpectations(t)
    svc := &Service{M: m}
    require.NoError(t, svc.Welcome(context.Background(), "alice@x"))
}
```

**Line count: 11. Dependencies: testify.**

### `gomock`

```go
// After: mockgen -source=mailer.go -destination=mocks/mailer_mock.go -package=mocks

func TestWelcome_GoMock(t *testing.T) {
    ctrl := gomock.NewController(t)
    m := mocks.NewMockMailer(ctrl)
    m.EXPECT().Send(gomock.Any(), "alice@x", "Welcome!", gomock.Any()).Return(nil)
    svc := &Service{M: m}
    require.NoError(t, svc.Welcome(context.Background(), "alice@x"))
}
```

**Line count: 7 (plus ~120 generated lines). Dependencies: gomock + mockgen.**

For this trivially small case, the hand-rolled version wins on simplicity. As the interface grows, the relative cost of `mockery`/`gomock` shrinks because generation amortizes.

---

## Argument Matchers in Each Framework

### `testify/mock`

| Matcher | Description |
|---------|-------------|
| `mock.Anything` | Any value. |
| `mock.AnythingOfType("string")` | Any value whose Go type name is `"string"`. |
| `mock.MatchedBy(func(x T) bool)` | Custom predicate. |
| Literal value (`42`, `"hi"`) | Equality match via `ObjectsAreEqual`. |

### `gomock`

| Matcher | Description |
|---------|-------------|
| `gomock.Any()` | Any value. |
| `gomock.Eq(x)` | Deep equality with `x`. |
| `gomock.Nil()` | Nil interface or pointer. |
| `gomock.Not(matcher)` | Inverts another matcher. |
| `gomock.AssignableToTypeOf(x)` | Type-based. |
| `gomock.Len(n)` | Length match (slices, maps, strings). |
| Custom `Matcher` interface | Implement `Matches(x interface{}) bool` and `String() string`. |
| Literal value | Implicitly wrapped in `Eq`. |

### Comparison

Both frameworks let you write custom matchers. `gomock` is slightly richer out of the box (`Len`, `Not`). `testify` is slightly more flexible with closures via `MatchedBy`.

In practice, 90% of matchers used in real code are `gomock.Any()` / `mock.Anything` and literal values. The custom-matcher API matters only for the long tail.

---

## Ordering and Call Counts

### `testify/mock`

```go
m.On("A").Return(nil).Once()
m.On("B").Return(nil).Twice()
m.On("C").Return(nil).Times(5)
m.On("D").Return(nil).Maybe() // optional; not failed if absent

// Ordering:
a := m.On("Begin").Return(nil)
m.On("Commit").Return(nil).NotBefore(a)
```

### `gomock`

```go
m.EXPECT().A().Return(nil)             // exactly 1 by default
m.EXPECT().B().Return(nil).Times(2)
m.EXPECT().C().Return(nil).MinTimes(1).MaxTimes(5)
m.EXPECT().D().Return(nil).AnyTimes() // 0 or more

// Ordering:
gomock.InOrder(
    m.EXPECT().Begin().Return(nil),
    m.EXPECT().Insert(gomock.Any()).Return(nil),
    m.EXPECT().Commit().Return(nil),
)
// or
begin := m.EXPECT().Begin().Return(nil)
m.EXPECT().Commit().Return(nil).After(begin)
```

`gomock`'s ordering API is more expressive — `InOrder` for chains, `.After` for DAGs. Use it whenever order is semantically important.

---

## Wiring Mocks into `go generate`

Place a `go:generate` comment near the interface:

```go
//go:generate mockgen -source=mailer.go -destination=mocks/mailer_mock.go -package=mocks
type EmailSender interface { ... }
```

Or for `mockery`:

```go
//go:generate mockery --name EmailSender --output ./mocks --case underscore
type EmailSender interface { ... }
```

CI step:

```bash
go generate ./...
git diff --exit-code # fail if generated files drifted
```

This catches the common bug of someone editing an interface without regenerating mocks. The CI run becomes the source of truth for "mocks match interfaces."

For the tools themselves, pin versions via `tools.go`:

```go
//go:build tools

package tools

import (
    _ "github.com/vektra/mockery/v2"
    _ "go.uber.org/mock/mockgen"
)
```

This ensures `go mod` tracks the generator versions and that everyone on the team uses the same generator output.

---

## Picking a Framework for Your Project

A decision tree that reflects real-world adoption patterns:

```
Are most of your interfaces small (1-5 methods)?
|
+-- Yes -> Hand-rolled by default. Reach for moq if you want generation without a framework.
|
+-- No, several have 10+ methods
    |
    +-- Tests mostly assert outcomes -> mockery + testify/mock + EXPECT()
    +-- Tests assert strict call sequences and types -> gomock (go.uber.org/mock)
    +-- Mixed -> mockery for most, gomock for the strict ones (but keep it consistent within a package)
```

The strongest signal is *how your team writes assertions*. Teams that gravitate to `require.Equal(t, expected, got)` on the SUT's output prefer hand-rolled and `testify/mock`. Teams that gravitate to "called with X then Y" prefer `gomock`.

Avoid mixing two frameworks in the same package. Readers should not have to context-switch between `EXPECT()` and `On()` in adjacent files. It is fine to use different frameworks in different services or libraries.

---

## Common Pitfalls

### Pitfall 1 — Method name typos in `testify/mock`

```go
m.On("Sned", mock.Anything).Return(nil) // typo
```

This compiles. At test time, the actual `Send` call panics with "unknown method." Use `mockery --with-expecter` for compile-time safety.

### Pitfall 2 — Forgetting `AssertExpectations`

```go
m.On("Send", mock.Anything).Return(nil).Once()
// ... no AssertExpectations call
```

The `Once()` is decorative. Always finish with `m.AssertExpectations(t)` (typically via `defer` or `t.Cleanup`).

### Pitfall 3 — Sharing a mock across parallel subtests

```go
m := new(MockMailer)
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        m.On(...) // race!
    })
}
```

Construct a fresh mock inside each subtest.

### Pitfall 4 — Bypassing `gomock.NewController`

```go
m := &mocks.MockMailer{} // bypassing controller
m.EXPECT().Send(...).Return(nil)
```

Some generators allow this; the controller methods then no-op or panic. Always use `gomock.NewController(t)`.

### Pitfall 5 — Using a mock for a stable, deterministic dependency

```go
m := new(MockClock)
m.On("Now").Return(fixedTime)
```

A hand-rolled stub is simpler:

```go
type fixedClock struct{ t time.Time }
func (c fixedClock) Now() time.Time { return c.t }
```

Framework cost is not worth it for a 1-method interface called once.

### Pitfall 6 — Confusing source and reflect mode in `mockgen`

Source mode parses one file; if your interface has types from another package, source mode often "loses" them and generates `interface{}` placeholders. Reflect mode handles transitive types but takes longer to run. Use reflect mode when you see weird type drift in generated code.

---

## Test Yourself

1. What's the difference between `testify/mock`'s `On("Send", ...)` and `mockery`'s `EXPECT().Send(...)` at runtime? At compile time?
2. Why was `golang/mock` archived, and what should new projects use instead?
3. When does `gomock` fail the test — at call time, at `Finish`, or both?
4. Why does `mockery` need a `with-expecter` flag, and what does it produce?
5. In `gomock`, what's the difference between `.Times(1)` and the default?
6. What does `moq` give you that `mockery` does not?

---

## Cheat Sheet

```go
// === testify/mock (manual) ===
type MockX struct{ mock.Mock }
func (m *MockX) Method(arg string) error { return m.Called(arg).Error(0) }

m := new(MockX)
m.On("Method", "input").Return(nil).Once()
defer m.AssertExpectations(t)

// === mockery (generated) ===
// Run: mockery --name X --output ./mocks
m := mocks.NewMockX(t)
m.EXPECT().Method("input").Return(nil)

// === gomock (generated) ===
// Run: mockgen -source=x.go -destination=mocks/x_mock.go -package=mocks
ctrl := gomock.NewController(t)
m := mocks.NewMockX(ctrl)
m.EXPECT().Method(gomock.Eq("input")).Return(nil).Times(1)

// === moq (generated) ===
// Run: moq -out mock_x.go -pkg mocks . X
m := &mocks.XMock{
    MethodFunc: func(arg string) error { return nil },
}
// after test:
require.Len(t, m.MethodCalls(), 1)
```

---

## Summary

- `testify/mock` is reflection-based, hand-written, runtime-typed. Easy adoption, verbose tests.
- `mockery` generates `testify/mock`-compatible mocks. With `EXPECT()` it gains compile-time safety.
- `gomock` (`go.uber.org/mock`) is the strict, typed framework. Generated, with strong ordering primitives.
- `moq` generates minimal closure-based mocks with no runtime framework dependency.
- Pick based on team preferences and interface complexity. Avoid mixing within a package.
- All three frameworks accept the same underlying pattern: a struct that satisfies an interface. They just save you typing.

The senior file will examine *why* Go favors hand-rolled stubs at the architectural level — and when in-memory fakes beat both stubs and mocks for repository-shaped interfaces.

---

## Further Reading

- testify mock godoc — <https://pkg.go.dev/github.com/stretchr/testify/mock>
- mockery docs — <https://vektra.github.io/mockery/>
- gomock docs — <https://pkg.go.dev/go.uber.org/mock/gomock>
- moq README — <https://github.com/matryer/moq>
- "Mocking interfaces in Go" — various Go blog posts collated under the `mock` tag.

---

## Related Topics

- [Junior](../junior/) — taxonomy and hand-rolled stubs.
- [Senior](../senior/) — why hand-rolled wins; interface segregation; in-memory fakes.
- [Professional](../professional/) — large-codebase patterns; HTTP/gRPC/DB doubles.
- [Specification](../specification/) — version notes and API references.
- [Tasks](../tasks/) — comparison exercises across hand-rolled, testify, gomock.
