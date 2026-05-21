---
layout: default
title: Mocks and Stubs — Find the Bug
parent: Mocks and Stubs
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/03-mocks-and-stubs/find-bug/
---

# Mocks and Stubs — Find the Bug

[← Back](../)

Six real-world bugs that show up in mock-heavy Go test suites. Read the snippet, write down what is wrong, then check against the diagnosis. Some bugs make the test silently green; some make the test brittle; some leak state across parallel runs.

---

## Bug 1 — The forgotten `AssertExpectations`

```go
func TestSendEmail(t *testing.T) {
    mailer := new(MockMailer)
    mailer.On("Send", "user@example.com", mock.Anything).Return(nil).Once()

    svc := &SignupService{Mailer: mailer}
    err := svc.SignUp(context.Background(), "user@example.com")
    require.NoError(t, err)
}
```

### Diagnosis

The expectation `On("Send", ...).Once()` is *decorative* without `mailer.AssertExpectations(t)`. If `SignUp` skips the email send entirely (e.g., the code was refactored to send mail asynchronously), the test passes. The `Once()` qualifier is checked only by `AssertExpectations`.

### Fix

```go
defer mailer.AssertExpectations(t)
// or
t.Cleanup(func() { mailer.AssertExpectations(t) })
```

Some teams enforce this with a lint rule that flags `On(...)` without a matching assertion later in the function.

---

## Bug 2 — Over-mocking masks the real bug

```go
type orderTest struct {
    repo   *MockRepo
    pubSub *MockPubSub
    audit  *MockAudit
    cache  *MockCache
}

func (ot *orderTest) setup() {
    ot.repo.On("Save", mock.Anything, mock.Anything).Return(nil)
    ot.cache.On("Invalidate", mock.Anything).Return(nil)
    ot.pubSub.On("Publish", "orders.placed", mock.Anything).Return(nil)
    ot.audit.On("Record", mock.Anything, mock.Anything).Return(nil)
}

func TestPlaceOrder(t *testing.T) {
    ot := &orderTest{ /* ... */}
    ot.setup()
    err := ot.service.Place(ctx, Order{ID: "42"})
    require.NoError(t, err)
    ot.repo.AssertCalled(t, "Save", mock.Anything, mock.Anything)
    ot.pubSub.AssertCalled(t, "Publish", "orders.placed", mock.Anything)
    ot.audit.AssertCalled(t, "Record", mock.Anything, mock.Anything)
    ot.cache.AssertCalled(t, "Invalidate", mock.Anything)
}
```

### Diagnosis

The test asserts that four collaborators were invoked, but every payload is `mock.Anything`. A bug that publishes `orders.cancelled` instead of `orders.placed` would be caught (the topic string is literal), but a bug that publishes an empty order body, or invalidates the wrong cache key, would pass. The test is *describing* the implementation rather than *verifying* behavior.

### Fix

Decide what user-visible outcome you want to assert. For "order is placed," the relevant assertions are:

1. The order can be retrieved (`repo.Find`).
2. A correct event was published (test the payload with `MatchedBy` checking the order ID).
3. Idempotency: a second call does not duplicate.

The mock setup shrinks; the test now describes a contract, not a sequence.

---

## Bug 3 — Leaked mock state across parallel subtests

```go
var sharedRepo = new(MockRepo)

func TestRepo(t *testing.T) {
    cases := []struct {
        name string
        id   string
        want User
    }{
        {"alice", "1", User{Name: "Alice"}},
        {"bob", "2", User{Name: "Bob"}},
    }
    for _, tc := range cases {
        tc := tc
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            sharedRepo.On("FindByID", tc.id).Return(&tc.want, nil)
            got, err := svc.Get(tc.id, sharedRepo)
            require.NoError(t, err)
            require.Equal(t, tc.want, *got)
        })
    }
}
```

### Diagnosis

Two problems:

1. `sharedRepo` is a package-level mock — both subtests append expectations to the same `mock.Mock.ExpectedCalls` slice. The race detector will flag concurrent writes.
2. Even without races, the second subtest's `FindByID("1")` expectation lingers if the first subtest registers it; calls from later tests can match expectations registered by earlier tests, masking real failures.

### Fix

Construct a fresh mock inside each subtest:

```go
t.Run(tc.name, func(t *testing.T) {
    t.Parallel()
    repo := new(MockRepo)
    repo.On("FindByID", tc.id).Return(&tc.want, nil)
    ...
})
```

Rule: a mock object is mutable state; treat it like a `*sync.Mutex` and never share across parallel goroutines.

---

## Bug 4 — Mock that does not actually verify call order

```go
func TestTransaction(t *testing.T) {
    db := new(MockDB)
    db.On("Begin").Return(tx, nil)
    db.On("Insert", mock.Anything).Return(nil)
    db.On("Commit").Return(nil)

    err := svc.InsertWithTx(ctx, row)
    require.NoError(t, err)
    db.AssertExpectations(t)
}
```

### Diagnosis

`testify/mock` records that all three calls happened but does not assert they occurred in `Begin -> Insert -> Commit` order. A refactor that accidentally invokes `Commit` before `Insert` (e.g., a deferred `Commit` running too early) will pass this test. For transactional logic, order is the whole point.

### Fix

Two options:

1. Use `testify`'s `.NotBefore(prev)`:
   ```go
   begin := db.On("Begin").Return(tx, nil)
   insert := db.On("Insert", mock.Anything).Return(nil).NotBefore(begin)
   db.On("Commit").Return(nil).NotBefore(insert)
   ```
2. Switch to `gomock` and use `gomock.InOrder`:
   ```go
   gomock.InOrder(
       db.EXPECT().Begin(),
       db.EXPECT().Insert(gomock.Any()),
       db.EXPECT().Commit(),
   )
   ```

For ordering-critical code (transactions, lifecycle hooks, retries) prefer `gomock`.

---

## Bug 5 — Race inside `.Run` callback

```go
var calls []string
mailer.On("Send", mock.Anything, mock.Anything).
    Return(nil).
    Run(func(args mock.Arguments) {
        calls = append(calls, args.String(0))
    })

var wg sync.WaitGroup
for _, addr := range []string{"a@x", "b@x", "c@x"} {
    wg.Add(1)
    go func(a string) {
        defer wg.Done()
        _ = svc.Notify(a)
    }(addr)
}
wg.Wait()
require.Len(t, calls, 3)
```

### Diagnosis

`mailer.On` is goroutine-safe internally, but the closure mutates the outer `calls` slice without synchronization. `append` may corrupt the underlying array, drop entries, or trigger the race detector. The `require.Len(t, calls, 3)` may pass or fail depending on scheduling.

### Fix

Synchronize the recording:

```go
var (
    mu    sync.Mutex
    calls []string
)
Run(func(args mock.Arguments) {
    mu.Lock()
    defer mu.Unlock()
    calls = append(calls, args.String(0))
})
```

Or use a channel. The general lesson: anything captured by a mock's `Run` callback runs from whichever goroutine invokes the mocked method.

---

## Bug 6 — Unstubbed method panics the test runner

```go
type MockUserRepo struct{ mock.Mock }

func (m *MockUserRepo) FindByID(id string) (*User, error) {
    args := m.Called(id)
    return args.Get(0).(*User), args.Error(1)
}
func (m *MockUserRepo) Save(u *User) error {
    args := m.Called(u)
    return args.Error(0)
}

func TestProfile_View(t *testing.T) {
    repo := new(MockUserRepo)
    repo.On("FindByID", "42").Return(&User{ID: "42"}, nil)
    svc := &Profile{Repo: repo}

    _, err := svc.View(ctx, "42")
    require.NoError(t, err)
}
```

Suppose `Profile.View` was changed to also call `repo.Save` to record "last viewed at." The test now panics:

```
panic: assert: mock: I don't know what to return because the method call was unexpected.
    Either do Mock.On("Save").Return(...) first, or remove the Save() call.
```

### Diagnosis

`testify/mock` panics on un-stubbed calls. The panic message is helpful, but in a CI run that swallows panics or in tests run in parallel, this can produce confusing output ("test passed but the goroutine crashed").

### Fix

Two valid responses:

1. **Add the expectation** if the new call is intentional.
2. **Use `mock.Mock.Test(t)`** so that unexpected calls fail the test cleanly instead of panicking:
   ```go
   repo := new(MockUserRepo)
   repo.Test(t)
   ```

`Test(t)` reroutes panics through `t.Errorf`, producing a normal test failure with a stack trace pointing at the offending call site.

---

## Bug 7 — Conformance silently broken after interface change

```go
// repo.go
type UserRepo interface {
    FindByID(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
}

// test
type fakeRepo struct {
    saved []*User
}
func (f *fakeRepo) FindByID(id string) (*User, error) { return nil, nil }
func (f *fakeRepo) Save(u *User) error { f.saved = append(f.saved, u); return nil }
```

The interface gained `ctx context.Context` parameters. The fake's methods now have a *different* signature, so it no longer satisfies `UserRepo`. But because the test only passes `fakeRepo` to a *generic helper*, the compile error surfaces somewhere distant and confusing.

### Diagnosis

There is no compile-time conformance check. Without one, the fake silently de-implements the interface.

### Fix

```go
var _ UserRepo = (*fakeRepo)(nil)
```

Place this line directly under the type declaration. Any signature drift fails the package build immediately, with the error pointing at the right file.

---

## Summary table

| Bug | Symptom | Root cause | Prevention |
|-----|---------|------------|-----------|
| 1 | False green | Missing `AssertExpectations` | Lint rule; `t.Cleanup` |
| 2 | False green; rigid tests | Asserting on calls, not outcomes | Assert behavior, not implementation |
| 3 | Race / cross-test contamination | Shared mock between parallel subtests | Per-subtest mock; never package-level |
| 4 | False green on ordering bugs | No order constraint declared | `.NotBefore` or `gomock.InOrder` |
| 5 | Flaky `Len` assertions, race warnings | Unsynchronized closure in `Run` | Mutex / channel in callback |
| 6 | Panic instead of failure | `testify` panics on unexpected calls | `m.Test(t)` |
| 7 | Confusing distant compile errors | Fake drifted from interface | `var _ I = (*F)(nil)` conformance check |

When reviewing a mock-heavy PR, scan first for missing `AssertExpectations` and shared package-level mocks — these two account for most false greens in real codebases.
