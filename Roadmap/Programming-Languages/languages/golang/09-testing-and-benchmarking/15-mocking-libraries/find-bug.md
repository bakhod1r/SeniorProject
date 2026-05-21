---
layout: default
title: Mocking Libraries — Find the Bug
parent: Mocking Libraries Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/15-mocking-libraries/find-bug/
---

# Mocking Libraries — Find the Bug

[← Back](../)

Each snippet below is buggy. Identify the bug, the symptom in CI, and the fix.

## Bug 1 — Forgotten controller.Finish

```go
func TestCreateUser(t *testing.T) {
    ctrl := gomock.NewController(t)
    repo := mocks.NewMockUserRepo(ctrl)
    repo.EXPECT().Save(gomock.Any(), gomock.Any()).Return(nil)

    svc := NewUserService(repo)
    _ = svc.Create(context.Background(), "alice")
    // no Finish, no Cleanup
}
```

**Symptom.** Older `github.com/golang/mock` versions before v1.5 do not auto-
register `t.Cleanup`. Forgetting `ctrl.Finish()` means the controller never
checks that `Save` was actually called, so the test passes even if the
service never calls `Save`.

**Fix.** Either upgrade to `go.uber.org/mock@v0.4+` (which registers cleanup
automatically) or add `t.Cleanup(ctrl.Finish)` immediately after creating the
controller.

## Bug 2 — Matcher pointer equality

```go
expected := &User{ID: "u1", Name: "Alice"}
repo.EXPECT().Save(gomock.Any(), expected).Return(nil)

svc.Create(ctx, "u1", "Alice") // builds a new *User internally
```

**Symptom.** The test fails with `unexpected call to Save(*User<addr>)`
because gomock's default `Eq` matcher uses `reflect.DeepEqual` and the SUT
constructs a different pointer. Wait — `DeepEqual` on pointers follows them,
so the values are compared. So when does this actually fail?

It fails when the SUT mutates the struct before passing it (e.g. sets
`CreatedAt = time.Now()`). The matcher compares against the pre-mutation
expected value.

**Fix.** Use `gomock.AssignableToTypeOf((*User)(nil))` plus a custom matcher
that only inspects stable fields:

```go
repo.EXPECT().Save(gomock.Any(), gomock.Cond(func(x any) bool {
    u := x.(*User)
    return u.ID == "u1" && u.Name == "Alice"
})).Return(nil)
```

## Bug 3 — testify/mock returning nil concrete type

```go
m := new(mocks.UserRepo)
m.On("Find", "u1").Return(nil, nil)

u, err := m.Find("u1")
fmt.Println(u.ID) // panic: nil pointer dereference
```

**Symptom.** The first `Return(nil, ...)` is interpreted by testify as
`(interface{})(nil)`. The mock's generated method casts it to `*User`. Since
both the inner value and the type are nil-shaped, the SUT panics on
`u.ID`.

**Fix.** Return a typed nil: `m.On("Find", "u1").Return((*User)(nil), nil)`
or use `mock.AnythingOfType("*pkg.User")` plus a real value.

## Bug 4 — InOrder with AnyTimes

```go
gomock.InOrder(
    repo.EXPECT().Begin().Return(tx, nil).AnyTimes(),
    repo.EXPECT().Commit().Return(nil),
)
```

**Symptom.** `InOrder` with `AnyTimes` is nonsensical: `AnyTimes` matches
zero or more, so the controller may satisfy `Commit` before any `Begin`.
The test passes even when the SUT calls `Commit` first.

**Fix.** Use `MinTimes(1)` if at least one call is required, or drop
`AnyTimes` and use `Times(1)`.

## Bug 5 — Shared mock across t.Parallel sub-tests

```go
func TestSomething(t *testing.T) {
    ctrl := gomock.NewController(t)
    repo := mocks.NewMockUserRepo(ctrl)
    repo.EXPECT().Get(gomock.Any()).Return(&User{}, nil).AnyTimes()

    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            svc := NewService(repo)
            svc.Run(tc.input)
        })
    }
}
```

**Symptom.** A controller is bound to the outer `t`. When a parallel subtest
fails, the failure is reported on the parent `t`, not the subtest, and the
test output becomes confusing. Worse, if the controller is racy (older
versions), data races appear under `-race`.

**Fix.** Create a fresh controller and mock inside each subtest:

```go
t.Run(tc.name, func(t *testing.T) {
    t.Parallel()
    ctrl := gomock.NewController(t)
    repo := mocks.NewMockUserRepo(ctrl)
    ...
})
```

## Bug 6 — sqlmock regex too loose

```go
mock.ExpectQuery("SELECT").WillReturnRows(rows)
```

**Symptom.** `sqlmock` defaults to `QueryMatcherRegexp`. The pattern
`"SELECT"` matches *any* query starting with `SELECT`. A test for
`GetUserByID` accidentally matches `GetUserByEmail`'s query, so refactoring
the repository does not break the test even when it should.

**Fix.** Use `sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))`
for exact matching, or anchor the regex with `^` and `$`.

## Bug 7 — httpmock not deactivated

```go
func TestA(t *testing.T) {
    httpmock.Activate()
    httpmock.RegisterResponder("GET", "https://x.example/", ...)
    // ... test body, no DeactivateAndReset
}

func TestB(t *testing.T) {
    // expects real HTTP, gets the leftover responder
}
```

**Symptom.** `httpmock` patches `http.DefaultTransport` globally. Without
`DeactivateAndReset` in a `defer` or `t.Cleanup`, the patch leaks into the
next test. CI passes locally but fails when test order changes.

**Fix.** Always pair `Activate` with `defer httpmock.DeactivateAndReset()`
or `t.Cleanup(httpmock.DeactivateAndReset)`.

## Bug 8 — mockery without `with-expecter` and a method typo

```go
repo := new(usermocks.UserRepo)
repo.On("Find", mock.Anything, "u1").Return(&User{}, nil)
// ...
svc.GetUser(ctx, "u1") // Service.GetUser calls repo.Get, not repo.Find
```

**Symptom.** The test fails with "I don't know what to return because
the method call was unexpected" because `Find` was registered but `Get`
was called. The error message names `Get` correctly, but if both methods
are commonly used the misregistration is easy to miss.

**Fix.** Use `with-expecter: true` in mockery config so the expectation
becomes:

```go
repo.EXPECT().Find(mock.Anything, "u1").Return(&User{}, nil)
```

Now `Find` is a typed method on the recorder. A typo (renaming the
interface method to `Get`) becomes a compile-time error rather than a
runtime "method not registered" error.

## Bug 9 — sqlmock argument type drift

```go
mock.ExpectQuery("SELECT id FROM users WHERE age = ?").
    WithArgs(25).
    WillReturnRows(rows)

// SUT
_, err := db.QueryContext(ctx, "SELECT id FROM users WHERE age = ?", 25)
```

**Symptom.** The test fails with "expected query but didn't match
args". sqlmock receives the argument as `int64(25)` (the driver
converts `int` to `int64`), but the expectation was registered for
plain `int(25)`. `reflect.DeepEqual(int(25), int64(25))` is false.

**Fix.** Match the driver type explicitly:

```go
mock.ExpectQuery(...).WithArgs(int64(25)).WillReturnRows(rows)
```

Or use the `sqlmock.AnyArg()` matcher when you don't care about the
exact value:

```go
mock.ExpectQuery(...).WithArgs(sqlmock.AnyArg()).WillReturnRows(rows)
```

## Bug 10 — bufconn server not stopped

```go
func TestRPC(t *testing.T) {
    lis := bufconn.Listen(1 << 20)
    srv := grpc.NewServer()
    pb.RegisterFooServer(srv, &fakeFoo{})
    go srv.Serve(lis)
    // No srv.Stop() at the end.

    // ... test body
}
```

**Symptom.** The goroutine running `srv.Serve` leaks. Under
`-race`, the next test that uses bufconn may see goroutine race reports
because the leaked goroutine is still iterating over the listener.
Eventually the test binary accumulates dozens of leaked goroutines and
exhausts memory in long runs.

**Fix.** Always register cleanup:

```go
t.Cleanup(srv.Stop)
```

Or use the `grpctest.NewServer` helper from senior.md section 16,
which handles this automatically.

## Bug 11 — moq nil function field

```go
repo := &mocks.UserRepoMock{
    GetFunc: func(ctx context.Context, id string) (*User, error) {
        return &User{ID: id}, nil
    },
    // SaveFunc not set.
}

svc := NewService(repo)
svc.CreateAndPersist(ctx, "u1") // calls Save internally
```

**Symptom.** Panic: "UserRepoMock.SaveFunc: method is nil but
UserRepo.Save was called". The panic happens at the call site, which
crashes the goroutine. If `CreateAndPersist` runs in a worker
goroutine, the test may fail with a confusing panic stack.

**Fix.** Either provide a `SaveFunc` (even if it just returns nil), or
use the `Maybe` pattern by setting every function field:

```go
repo := &mocks.UserRepoMock{
    GetFunc:  func(context.Context, string) (*User, error) { return &User{}, nil },
    SaveFunc: func(context.Context, *User) error { return nil },
    DeleteFunc: func(context.Context, string) error { return nil },
}
```

A helper function `NewNoOpRepo() *mocks.UserRepoMock` that returns a
fully-populated mock with no-op functions is the cleanest fix.

## Bug 12 — strict mock with optional dependency

```go
audit := mocks.NewMockAuditLog(ctrl) // strict gomock
// No EXPECT registered.

svc := notify.NewService(sender, limiter, audit)
svc.Notify(ctx, m) // service swallows audit failures
```

**Symptom.** If the SUT was supposed to call `audit.Record` and you
forgot to register the expectation, the test fails immediately with
"unexpected call to Record". You think the service has a bug — but
actually the service is correct; your test set up is wrong.

**Fix.** Register every expected call, even ones whose results you
don't care about. If the audit failure is genuinely optional behavior:

```go
audit.EXPECT().Record(gomock.Any(), gomock.Any(), gomock.Any()).
    Return(nil).AnyTimes()
```

Just don't `AnyTimes()` everything by default — that's how you slip
into the anti-pattern in find-bug Bug 4.

## Bug 13 — miniredis state leak between tests

```go
var sharedRedis = miniredis.RunT(nil) // package-level

func TestA(t *testing.T) {
    client := redis.NewClient(&redis.Options{Addr: sharedRedis.Addr()})
    client.Set(ctx, "foo", "bar", 0)
    // assertions
}

func TestB(t *testing.T) {
    client := redis.NewClient(&redis.Options{Addr: sharedRedis.Addr()})
    val, _ := client.Get(ctx, "foo").Result()
    // val is "bar" from TestA!
}
```

**Symptom.** TestB unexpectedly sees data from TestA. Tests pass or
fail depending on order.

**Fix.** Use `miniredis.RunT(t)` per test instead of package-level:

```go
func TestA(t *testing.T) {
    s := miniredis.RunT(t) // dedicated, cleaned up at test end
    client := redis.NewClient(&redis.Options{Addr: s.Addr()})
    // ...
}
```

`RunT(t)` registers `t.Cleanup` to close the server automatically.

## Bug 14 — Mockery `with-expecter` and variadic methods

```go
// Interface
type Logger interface {
    Info(format string, args ...any)
}

// Mockery generates EXPECT() typed for variadic
m.EXPECT().Info("user created: %s", "alice").Return()
```

**Symptom.** The expectation never matches because the generated
`EXPECT().Info(format, args ...any)` matcher is comparing
`[]any{"alice"}` to whatever the SUT passed. If the SUT calls
`m.Info("user created: %s", "alice", "extra")`, the variadic length
differs and matching fails — with a confusing error.

**Fix.** Use a typed-but-flexible matcher:

```go
m.EXPECT().Info("user created: %s", mock.Anything).Return()
```

Or assert post-hoc on `m.Calls`. mockery's variadic handling is good
but not perfect; verify generated code looks reasonable for
variadic-heavy interfaces before relying on it.
