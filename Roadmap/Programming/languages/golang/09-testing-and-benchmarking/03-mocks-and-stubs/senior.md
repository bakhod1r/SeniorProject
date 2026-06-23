---
layout: default
title: Mocks and Stubs — Senior
parent: Mocks and Stubs
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/03-mocks-and-stubs/senior/
---

# Mocks and Stubs — Senior

[← Back](../)

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Cultural Position of Mocks in Go](#the-cultural-position-of-mocks-in-go)
4. [Why Hand-Rolled Wins for Small Interfaces](#why-hand-rolled-wins-for-small-interfaces)
5. [Consumer-Defined Interfaces — The Big Idea](#consumer-defined-interfaces--the-big-idea)
6. [Interface Segregation in Practice](#interface-segregation-in-practice)
7. [Testing Behavior, Not Implementation](#testing-behavior-not-implementation)
8. [The Case for In-Memory Fakes](#the-case-for-in-memory-fakes)
9. [Fakes Versus Mocks for Repositories](#fakes-versus-mocks-for-repositories)
10. [The "London School" vs "Detroit School" Debate, Translated to Go](#the-london-school-vs-detroit-school-debate-translated-to-go)
11. [When Mock Frameworks Earn Their Keep](#when-mock-frameworks-earn-their-keep)
12. [Anti-Patterns and How to Recognize Them](#anti-patterns-and-how-to-recognize-them)
13. [Test Smells Specific to Mock-Heavy Codebases](#test-smells-specific-to-mock-heavy-codebases)
14. [Designing for Testability — Without Mocks Driving the Design](#designing-for-testability--without-mocks-driving-the-design)
15. [The Refactor Pressure Test](#the-refactor-pressure-test)
16. [Worked Example — Replacing a Mock with a Fake](#worked-example--replacing-a-mock-with-a-fake)
17. [Worked Example — Splitting an Interface](#worked-example--splitting-an-interface)
18. [Architectural Heuristics](#architectural-heuristics)
19. [Test Yourself](#test-yourself)
20. [Tricky Questions](#tricky-questions)
21. [Cheat Sheet](#cheat-sheet)
22. [Summary](#summary)
23. [Further Reading](#further-reading)
24. [Related Topics](#related-topics)

---

## Introduction

The junior file taught you how to write a stub. The middle file taught you three ways to generate them. This file is about *taste* — when to use which technique, and how to recognize that your tests are coupled too tightly to your implementation.

The senior-level view of test doubles in Go can be summarized as:

> Tests verify behavior. Mocks verify implementation. Therefore most tests should not need mocks — they should need stubs, spies, and fakes. Reach for a mock framework only when call sequence or argument equality is *the contract you are testing*, not when it happens to be a side effect of the implementation.

That view is not Go-specific — Kent Beck argued something similar in the 1990s — but Go's lightweight interfaces and reluctance to add language ceremony make it easier to live by than in Java or Python. This file unpacks why, and shows the design moves that keep mock-mania at bay.

We assume you can read `testify/mock` and `gomock` tests fluently (middle file). We focus on architectural choices: where interfaces live, how big they are, what tests assert, and when fakes beat mocks.

---

## Prerequisites

- You have read the junior and middle files in this section.
- You have written tests using `testify/mock` and/or `gomock` in a real project.
- You have felt the pain of "this refactor broke 40 tests and the user-visible behavior did not change" at least once.
- You understand Go interfaces, struct embedding, and structural typing.

---

## The Cultural Position of Mocks in Go

Compare three language ecosystems:

| Language | Default mocking culture |
|----------|--------------------------|
| Java | Heavy use of Mockito; mocks pervasive; `@Mock` annotations standard. |
| Python | `unittest.mock.patch` everywhere; monkey-patching common. |
| Go | Hand-rolled stubs; mocks reserved for specific cases. |

Why the difference? Three reasons:

1. **Structural typing.** A Go stub is just a struct. No "implements" keyword, no required annotation, no generated boilerplate.
2. **Small interfaces.** Go culture favors interfaces with 1-3 methods, defined near the consumer. Small interfaces are cheap to stub.
3. **Standard library precedent.** The Go std-lib's own tests rarely use mock frameworks. New Go developers reading std-lib source see hand-rolled stubs as the default.

This is not just style. The cultural position has practical consequences:

- New Go projects rarely have a mock framework dependency on day one.
- Mock frameworks in Go feel like an *adoption* event, not a *default*.
- Engineers feel free to refactor interfaces because the cost of updating stubs is low.

In Java, the equivalent refactor often means regenerating dozens of Mockito-based test classes — a friction tax that subtly discourages refactoring.

---

## Why Hand-Rolled Wins for Small Interfaces

Three quantitative arguments:

### 1. Lines of code

For an interface with N methods, used in M tests:

- Hand-rolled stub: ~3N lines of stub code, written once. M tests use it directly.
- `testify/mock` mock: ~5N lines of mock setup + ~3 lines of `On`/`AssertExpectations` per test = ~5N + 3M.
- `gomock` mock: 0 manual lines + ~3 lines per test + ~10N lines of generated code = ~10N (generated) + 3M.

For N=3, M=20:
- Hand-rolled: 9 lines.
- `testify/mock`: 15 + 60 = 75 lines hand-written.
- `gomock`: 60 (generated) + 60 hand-written = 60 hand-written, 60 generated.

Hand-rolled wins handily on small interfaces. At N=15, M=50, the math reverses.

### 2. Cognitive load

A new reader of a hand-rolled stub sees a Go struct with five methods. They can read it linearly. A new reader of a `testify/mock`-based test sees `m.On("Method", mock.Anything, "value").Return(nil).Once()` and must context-switch to "what does `mock.Anything` mean? How is `Once` enforced? Where is `AssertExpectations`?"

The cognitive load is real but invisible. It surfaces as "I bounce off this code" complaints from juniors.

### 3. Refactor pressure

If you rename `Send` to `Dispatch` on the interface:

- Hand-rolled: compiler points at the stub immediately (if `var _ I = (*T)(nil)` is present); rename in two places; done.
- `testify/mock`: the string `"Send"` in every `On(...)` does not break compilation. You discover the bug only when tests panic at runtime.
- `gomock` with `EXPECT()`: typed; compile-checked.
- `mockery` with `EXPECT()`: typed; compile-checked, but you must regenerate.

The string-based vulnerability of `testify/mock`'s base API is the strongest single argument for either hand-rolled or `gomock`/`mockery+EXPECT` over plain `testify/mock`.

---

## Consumer-Defined Interfaces — The Big Idea

This idea, more than any framework choice, determines whether your mocks help or hurt. Two common patterns:

### Pattern A — Interface at the producer (Java style)

```go
// package storage
type Storage interface {
    Get(ctx context.Context, key string) ([]byte, error)
    Put(ctx context.Context, key string, value []byte) error
    Delete(ctx context.Context, key string) error
    List(ctx context.Context, prefix string) ([]string, error)
    Stat(ctx context.Context, key string) (Info, error)
    Watch(ctx context.Context, prefix string) (<-chan Event, error)
    Snapshot(ctx context.Context) (Reader, error)
    // ... 8 more methods
}

type S3Storage struct{ ... }
func (s *S3Storage) Get(...) (... ) { ... }
// implements all methods
```

Consumers import `storage.Storage` and depend on it. Every test that fakes storage must implement all 15 methods.

### Pattern B — Interface at the consumer (Go style)

```go
// package config
type configStore interface {
    Get(ctx context.Context, key string) ([]byte, error)
    Put(ctx context.Context, key string, value []byte) error
}

type Manager struct{ store configStore }
```

```go
// package files
type fileStore interface {
    Get(ctx context.Context, key string) ([]byte, error)
    Put(ctx context.Context, key string, value []byte) error
    Delete(ctx context.Context, key string) error
    List(ctx context.Context, prefix string) ([]string, error)
}

type Service struct{ store fileStore }
```

`package storage` does not define an interface at all. It exports `*S3Storage` (a concrete type). Each consumer defines its own *narrow* interface containing only the methods it uses. The same `S3Storage` happens to satisfy all the consumer interfaces structurally — no declaration needed.

Now to test `package config`, you stub `configStore` (2 methods). To test `package files`, you stub `fileStore` (4 methods). Neither test needs to know about the other 11 methods of `storage.Storage`.

### Why this is the Go way

This pattern is documented in the Go Code Review Comments and the Go FAQ as the recommended approach. Go's standard library follows it: `io.Reader`, `io.Writer`, and `http.Handler` are tiny interfaces consumed in many places; the concrete implementations (`os.File`, `*bytes.Buffer`, `http.ServeMux`) do not declare they "implement" them.

For test doubles, the pattern means:

- Interfaces are usually 1-3 methods.
- Hand-rolled stubs are 5-15 lines.
- Refactoring a producer's surface area does not ripple into consumer tests unless the consumed methods change.

### The cost

The consumer-defined-interface pattern has one cost: you sometimes have *multiple small interfaces* describing overlapping subsets of the same concrete type. A reader of the codebase has to follow each interface to its consumer to understand what it's for.

This cost is real but small. The compensating benefit — refactor-resilient tests — usually wins.

---

## Interface Segregation in Practice

The interface segregation principle (ISP) says clients should not depend on methods they do not use. Consumer-defined interfaces *are* ISP in action.

A concrete refactor: imagine you inherit code like this.

```go
// package billing
import "example.com/storage"

type BillingService struct{ Storage storage.Storage }

func (b *BillingService) Charge(ctx context.Context, userID string, amount int) error {
    blob, err := b.Storage.Get(ctx, "users/"+userID)
    if err != nil { return err }
    // ... parse and process
    return b.Storage.Put(ctx, "users/"+userID, updated)
}
```

`storage.Storage` has 15 methods. The test for `Charge` mocks all 15.

Senior refactor:

```go
// package billing
type userBlobStore interface {
    Get(ctx context.Context, key string) ([]byte, error)
    Put(ctx context.Context, key string, value []byte) error
}

type BillingService struct{ Storage userBlobStore }
```

The interface is private to the package (lowercase `userBlobStore`). It is exactly the surface `BillingService` consumes. The hand-rolled stub:

```go
type fakeBlobStore struct {
    data map[string][]byte
}
func (s *fakeBlobStore) Get(_ context.Context, k string) ([]byte, error) {
    if v, ok := s.data[k]; ok { return v, nil }
    return nil, errNotFound
}
func (s *fakeBlobStore) Put(_ context.Context, k string, v []byte) error {
    s.data[k] = v
    return nil
}
```

12 lines. Tests can save and read back. A bug in `Charge` that writes to the wrong key is *caught* because the fake honestly stores the data.

That last point is important. A mock would have asserted "Get was called with `users/`+userID, Put was called with `users/`+userID, value matching some predicate." The fake asserts the *outcome* — after `Charge`, the stored value at `users/`+userID is correct. Outcome-based assertions are refactor-resilient; call-based are not.

---

## Testing Behavior, Not Implementation

Two test styles:

### Implementation-focused

```go
func TestCharge_CallsStorageGet(t *testing.T) {
    m := new(MockStorage)
    m.On("Get", mock.Anything, "users/42").Return(blob, nil).Once()
    m.On("Put", mock.Anything, "users/42", mock.Anything).Return(nil).Once()
    defer m.AssertExpectations(t)

    svc := &BillingService{Storage: m}
    require.NoError(t, svc.Charge(ctx, "42", 100))
}
```

This test will fail if you:

- Replace `Get`+`Put` with a single `UpdateAtomic` call (behavior unchanged).
- Add a cache that skips `Get` on warm reads (behavior unchanged).
- Switch from `users/42` to `accounts/42` as the key (behavior unchanged from the user's POV — they still get charged).

### Behavior-focused

```go
func TestCharge_DeductsBalance(t *testing.T) {
    store := newFakeBlobStore()
    initial := encodeUser(User{ID: "42", Balance: 500})
    _ = store.Put(ctx, "users/42", initial)

    svc := &BillingService{Storage: store}
    require.NoError(t, svc.Charge(ctx, "42", 100))

    after, _ := store.Get(ctx, "users/42")
    require.Equal(t, 400, decodeUser(after).Balance)
}
```

This test fails only if `Charge` does not actually deduct the balance. Refactoring the implementation (single call vs two, different cache strategy, different key scheme) does not break it as long as the user's balance ends up correct.

Behavior-focused tests are the senior-level default. Use implementation-focused tests only when call sequence is the contract — e.g., "transactions must commit only after all inserts succeed."

---

## The Case for In-Memory Fakes

A fake is a working implementation suitable for testing but not production. For storage-shaped interfaces, fakes have superpowers:

1. **State across calls.** Save a user; read them back. No mock setup required.
2. **Realistic error paths.** The fake naturally errors on `Get` for missing keys; you do not have to register that error.
3. **One implementation, many tests.** Write the fake once. Every test imports it.
4. **Forces interface fidelity.** If the real implementation has a subtle quirk (e.g., `List` returns sorted results), the fake either matches or diverges. Divergences are visible because the fake is small enough to read.

The cost: writing the fake. Typically 30-100 lines per repository-shaped interface. Once written, it pays for itself within 5-10 tests.

### Where fakes shine

- Repository interfaces (`UserRepo`, `OrderRepo`).
- Caches (`Get`/`Set`/`Delete` operations).
- Queues (`Enqueue`/`Dequeue`).
- Filesystems (you can fake `os.File` for many tests using `bytes.Buffer` and `io/fs`).

### Where fakes are awkward

- HTTP clients (each request is unique; a fake would essentially be a recorder).
- Time and randomness (a stub is enough).
- One-off external services with custom protocols.

For those, stubs or `httptest.NewServer` (see professional file) work better.

---

## Fakes Versus Mocks for Repositories

A worked comparison. The interface:

```go
type UserRepo interface {
    FindByID(ctx context.Context, id string) (User, error)
    Save(ctx context.Context, u User) error
    List(ctx context.Context) ([]User, error)
}
```

The SUT:

```go
func (s *Service) Rename(ctx context.Context, id, newName string) error {
    u, err := s.Repo.FindByID(ctx, id)
    if err != nil { return err }
    u.Name = newName
    return s.Repo.Save(ctx, u)
}
```

### Mock-based test

```go
func TestRename_Mock(t *testing.T) {
    m := new(MockUserRepo)
    m.On("FindByID", mock.Anything, "42").Return(User{ID: "42", Name: "Alice"}, nil).Once()
    m.On("Save", mock.Anything, mock.MatchedBy(func(u User) bool {
        return u.ID == "42" && u.Name == "Alicia"
    })).Return(nil).Once()
    defer m.AssertExpectations(t)

    svc := &Service{Repo: m}
    require.NoError(t, svc.Rename(ctx, "42", "Alicia"))
}
```

### Fake-based test

```go
func TestRename_Fake(t *testing.T) {
    repo := newFakeUserRepo()
    _ = repo.Save(ctx, User{ID: "42", Name: "Alice"})

    svc := &Service{Repo: repo}
    require.NoError(t, svc.Rename(ctx, "42", "Alicia"))

    u, err := repo.FindByID(ctx, "42")
    require.NoError(t, err)
    require.Equal(t, "Alicia", u.Name)
}
```

Both tests verify renaming. But:

- The fake test reads more naturally — "save Alice, rename to Alicia, expect Alicia."
- If `Rename` is refactored to do `repo.Update` instead of `Find+Save`, the mock test breaks (wrong methods called); the fake test still passes (Alicia is stored).
- If you add a workflow test "rename, then delete, then verify list," the fake serves four tests without setup duplication.

Mocks are essentially fine for repositories that have *side effects you want to assert on* (e.g., audit logs). For pure persistence, fakes win.

---

## The "London School" vs "Detroit School" Debate, Translated to Go

In test-driven-development circles there are two camps:

- **London / mockist school:** tests assert on interactions; mocks are pervasive; each unit is isolated from its neighbors via mocks.
- **Detroit / classicist school:** tests assert on state; real collaborators or fakes are used; only true I/O boundaries are mocked.

Go culture sits firmly on the Detroit side. The reasons map to what we have seen:

- Small interfaces make hand-rolling stubs cheap, removing the "frameworks-make-it-easier" tilt toward mocks.
- Consumer-defined interfaces keep test boundaries narrow, so you mock less.
- The standard library and influential open-source projects (Kubernetes, Prometheus, etcd) prefer state-based testing with fakes.

In practice, "Go on the Detroit side" means:

- Default to fakes for repositories.
- Default to stubs for one-method side-effect interfaces (mailers, loggers, clocks).
- Use mock frameworks only when call ordering or strict argument checking is the contract under test.

---

## When Mock Frameworks Earn Their Keep

Despite the strong cultural lean, mock frameworks are not anti-Go. They earn their keep in three scenarios:

### 1. Strict ordering contracts

A transactional service must call `Begin`, then `Insert`, then `Commit`. A fake DB could check this, but you would have to bake the order-check into the fake. A mock framework's `gomock.InOrder(...)` expresses it declaratively.

### 2. Boundary side-effect verification

When the thing the test verifies *is* "we sent the right event to the bus," a spy or mock is more direct than a fake event store:

```go
m.EXPECT().Publish(gomock.Eq("orders.placed"), gomock.Any()).Times(1)
```

### 3. Large interfaces with many tests

When 5 packages all consume a 20-method interface and write 10 tests each, generated mocks save serious boilerplate. The reflection cost is invisible; the maintenance saving is real.

Outside these scenarios, mocks are usually heavier than the alternatives.

---

## Anti-Patterns and How to Recognize Them

Patterns we have seen repeatedly in mock-heavy Go codebases:

### Anti-pattern 1 — The "ceremonial mock"

```go
m := new(MockX)
m.On("Method", mock.Anything).Return(nil)
defer m.AssertExpectations(t)

svc := &Service{X: m}
require.NoError(t, svc.DoStuff(ctx))
```

The mock returns `nil`, accepts any arguments, and is never asserted against meaningfully. It exists because the SUT requires *something* of type `X`. The fix: hand-roll a stub.

### Anti-pattern 2 — The "implementation mirror"

```go
m.On("A").Return(...)
m.On("B").Return(...)
m.On("C").Return(...)
m.On("D").Return(...)
// ... fifteen more
```

The test enumerates every internal call. The smallest refactor reorders or batches calls and the test breaks. The fix: replace with a fake; assert on outcomes.

### Anti-pattern 3 — The "frankenmock"

```go
m.On("Method", mock.Anything).Run(func(args mock.Arguments) {
    // 30 lines of imperative logic deciding what to "return"
    if args.Int(0) == 0 { args.Get(2).(*Result).Status = "ok" }
    // ...
}).Return(nil)
```

Logic accreted in the `Run` callback. You have re-implemented the real dependency inside the mock. The fix: extract a fake type.

### Anti-pattern 4 — The "global mock"

```go
var mockMailer = new(MockMailer)

func init() { mockMailer.On("Send", mock.Anything).Return(nil) }
```

Tests share a single mock at package level. Parallel tests race. Fixing one test affects others. The fix: per-test mock construction.

### Anti-pattern 5 — Mocking pure functions

```go
m.On("Hash", "input").Return("a1b2c3")
```

`Hash` is deterministic; no I/O, no time, no randomness. Mocking it adds zero value. The fix: call the real function.

---

## Test Smells Specific to Mock-Heavy Codebases

Signs your tests are over-mocked:

1. **The test setup is longer than the test action.** If 30 lines of `m.On(...)` precede 2 lines of `svc.Action(...)`, the test is implementation-focused.
2. **The test fails on refactors.** If you can change the SUT's body in behavior-preserving ways and the test fails, you are testing implementation.
3. **The mock has more logic than the SUT.** A `Run` callback that decides what to "return" based on call number is a sign you should fake the dependency.
4. **Multiple tests duplicate identical `On` chains.** You are reinventing a fake without naming it.
5. **`mock.Anything` everywhere.** You wired up the mock for ceremony, not assertion.
6. **No `require.Equal` on the SUT's output.** You assert calls but not outcomes. The test could pass while user-visible behavior is wrong.

A useful exercise on PR review: scan the test file for `Equal`/`NotEqual`/`Contains` against the SUT's output. If they are missing, the test is asserting on internals only.

---

## Designing for Testability — Without Mocks Driving the Design

Testability is a design property, not a tool property. A well-designed Go service is testable with minimal mocks because:

1. Side effects pass through interfaces, not direct calls. (Easy to substitute.)
2. The service exposes the outcome it produced (a return value, a writable channel, a recorded event), not "did it call X?"
3. Logic is pure where possible; impure code is thin.

A *bad* sign: the tests need a complex mock framework because the production code mixes pure logic and side effects in the same functions. Fixing the test by adopting `gomock` covers up the design bug.

A *good* sign: the SUT is split into "decide what to do" (pure logic, easy to unit-test with no doubles) and "do it" (thin, mostly delegates to interfaces, tested via fakes).

The senior insight: **mock frameworks are a symptom signal, not a solution signal.** If you reach for them often, look at the design first.

---

## The Refactor Pressure Test

A simple heuristic for evaluating a test suite: can you make a behavior-preserving refactor without changing any tests?

Try these refactors against your suite:

1. Replace two sequential calls with a batched call.
2. Add a cache layer.
3. Reorder independent side effects.
4. Extract a helper function.
5. Change an internal logging detail.

If your tests break on any of these, they are coupled too tightly to implementation. Behavior-focused tests survive all five.

This pressure test is a useful interview signal too. Ask a candidate to describe what they would change about a mock-heavy test suite; senior candidates immediately move toward fakes and outcome assertions.

---

## Worked Example — Replacing a Mock with a Fake

Starting code (mock-heavy):

```go
type SettingsRepo interface {
    Get(ctx context.Context, userID, key string) (string, error)
    Set(ctx context.Context, userID, key, value string) error
}

type SettingsService struct{ Repo SettingsRepo }

func (s *SettingsService) SetIfNew(ctx context.Context, userID, key, value string) (bool, error) {
    _, err := s.Repo.Get(ctx, userID, key)
    if errors.Is(err, ErrNotFound) {
        return true, s.Repo.Set(ctx, userID, key, value)
    }
    return false, err
}
```

Mock-based test (the "before"):

```go
func TestSetIfNew_FirstTime_Mock(t *testing.T) {
    m := new(MockSettingsRepo)
    m.On("Get", mock.Anything, "u1", "lang").Return("", ErrNotFound).Once()
    m.On("Set", mock.Anything, "u1", "lang", "en").Return(nil).Once()
    defer m.AssertExpectations(t)

    svc := &SettingsService{Repo: m}
    isNew, err := svc.SetIfNew(ctx, "u1", "lang", "en")
    require.NoError(t, err)
    require.True(t, isNew)
}

func TestSetIfNew_Existing_Mock(t *testing.T) {
    m := new(MockSettingsRepo)
    m.On("Get", mock.Anything, "u1", "lang").Return("fr", nil).Once()
    defer m.AssertExpectations(t)

    svc := &SettingsService{Repo: m}
    isNew, err := svc.SetIfNew(ctx, "u1", "lang", "en")
    require.NoError(t, err)
    require.False(t, isNew)
}
```

Fake-based test (the "after"):

```go
type fakeSettingsRepo struct {
    mu   sync.Mutex
    data map[string]string // key: userID|key
}

func newFakeSettingsRepo() *fakeSettingsRepo {
    return &fakeSettingsRepo{data: map[string]string{}}
}

func (f *fakeSettingsRepo) Get(_ context.Context, u, k string) (string, error) {
    f.mu.Lock(); defer f.mu.Unlock()
    v, ok := f.data[u+"|"+k]
    if !ok { return "", ErrNotFound }
    return v, nil
}

func (f *fakeSettingsRepo) Set(_ context.Context, u, k, v string) error {
    f.mu.Lock(); defer f.mu.Unlock()
    f.data[u+"|"+k] = v
    return nil
}

var _ SettingsRepo = (*fakeSettingsRepo)(nil)

func TestSetIfNew_FirstTime_Fake(t *testing.T) {
    repo := newFakeSettingsRepo()
    svc := &SettingsService{Repo: repo}

    isNew, err := svc.SetIfNew(ctx, "u1", "lang", "en")
    require.NoError(t, err)
    require.True(t, isNew)

    got, _ := repo.Get(ctx, "u1", "lang")
    require.Equal(t, "en", got)
}

func TestSetIfNew_Existing_Fake(t *testing.T) {
    repo := newFakeSettingsRepo()
    _ = repo.Set(ctx, "u1", "lang", "fr")
    svc := &SettingsService{Repo: repo}

    isNew, err := svc.SetIfNew(ctx, "u1", "lang", "en")
    require.NoError(t, err)
    require.False(t, isNew)

    got, _ := repo.Get(ctx, "u1", "lang")
    require.Equal(t, "fr", got) // unchanged
}
```

What changed:

- The fake is 25 lines, written once, reused everywhere.
- The tests assert on the *state* of the repo afterwards — what users actually see.
- A refactor to use `INSERT ... ON CONFLICT` (single round-trip) instead of `Get+Set` still passes the fake tests; the mock tests would break.

The fake also catches a real bug: the mock-based tests passed even when the implementation contained `s.Repo.Set(ctx, userID, "wrongkey", value)`, because the mock matched `key=mock.Anything` or "lang" without caring whether the right thing was stored. The fake test fails because the wrong key would mean `repo.Get(ctx, "u1", "lang")` returns `ErrNotFound` after the operation.

---

## Worked Example — Splitting an Interface

Starting code:

```go
// package store
type UserStore interface {
    FindByID(ctx context.Context, id string) (User, error)
    Save(ctx context.Context, u User) error
    Delete(ctx context.Context, id string) error
    List(ctx context.Context) ([]User, error)
    Search(ctx context.Context, q string) ([]User, error)
    Count(ctx context.Context) (int, error)
    Lock(ctx context.Context, id string) error
    Unlock(ctx context.Context, id string) error
    // ... 10 more
}
```

Three consumers:

```go
// package auth — uses FindByID, Save
// package admin — uses List, Delete
// package metrics — uses Count
```

Each consumer's tests currently mock all 18 methods, even though they only use 2-3.

Refactor — define narrow interfaces at each consumer:

```go
// package auth
type userLookup interface {
    FindByID(ctx context.Context, id string) (store.User, error)
    Save(ctx context.Context, u store.User) error
}

type Auth struct{ users userLookup }
```

```go
// package admin
type userAdmin interface {
    List(ctx context.Context) ([]store.User, error)
    Delete(ctx context.Context, id string) error
}

type Admin struct{ users userAdmin }
```

```go
// package metrics
type userCounter interface {
    Count(ctx context.Context) (int, error)
}

type Metrics struct{ users userCounter }
```

In production, all three accept the same `*store.PostgresUserStore` because it satisfies all three narrow interfaces structurally.

In tests, each package has a 2-3 method fake that is trivial to write:

```go
// in auth_test
type fakeUserLookup struct{ data map[string]store.User }
// ... 2 methods, ~15 lines total
```

After the refactor:

- The 18-method `UserStore` interface in `package store` can be deleted entirely. Consumers do not import it; they define their own.
- Each consumer's tests are ~30 lines of fake instead of ~150 lines of mock setup.
- A new method on `*store.PostgresUserStore` does not ripple into any test until a consumer actually adopts it.

This pattern is sometimes called "the producer exports concrete types, consumers declare interfaces." It is the most senior-level structural change you can make to a Go codebase, and it almost always improves both testability and code clarity.

---

## Architectural Heuristics

Crystallized into rules of thumb:

1. **Define interfaces where they are consumed.** Producers export concrete types; consumers narrow them to interfaces.
2. **Keep interfaces small.** 1-3 methods is normal; 5+ is unusual; 10+ is a code smell.
3. **Prefer hand-rolled stubs for small interfaces.** Reserve frameworks for large interfaces with many tests.
4. **Prefer fakes over mocks for storage-shaped interfaces.** Assert on outcome state, not on call sequences.
5. **Reach for mocks when the contract under test is the sequence or argument shape of calls.** Otherwise, mocks are usually the wrong tool.
6. **Test behavior, not implementation.** A refactor that preserves user-visible behavior should not break tests.
7. **Use `var _ I = (*T)(nil)` on every test double.** Compile-time conformance is free insurance.
8. **Never share mocks across parallel subtests.** Construct fresh per `t.Run`.
9. **Pin tool versions for generated mocks.** Drift between engineers is a real cost.
10. **When in doubt, ask: would a junior reader of this test understand it without learning a framework first?** If no, consider hand-rolling.

---

## Test Yourself

1. Why is "interface at the consumer" the senior-level default in Go?
2. Under what condition does a fake become *worse* than a mock?
3. What's wrong with `m.On("Method", mock.Anything).Return(nil)` if it appears 15 times in a test file?
4. Name three behavior-preserving refactors that should never break a well-written test suite.
5. When is it correct to mock a method that is logically pure (deterministic, no I/O)?

---

## Tricky Questions

1. **A coworker argues that mocking everything makes tests "more isolated and faster." How do you respond?**

   Faster, perhaps marginally — mocks avoid I/O. More isolated, yes, but isolation past a certain point is *over*-isolation: tests no longer verify whether the system works as a whole, only that the function under test makes the right *calls*. The trade-off is that behavior bugs (wrong key written, wrong order of operations) slip through if the mocks are loose. The right answer is: isolate at *I/O boundaries* with fakes/stubs, not at every internal call.

2. **You inherit a service where every method takes 8 interface dependencies. Tests are 80% mock setup. Where do you start?**

   First, look at the SUT's responsibilities. 8 dependencies almost always means the SUT is doing too much. Step 1: identify cohesive sub-units and split. Step 2: replace mocks with fakes for the storage-shaped dependencies — typically half of them. Step 3: extract pure logic from the orchestration layer so it can be tested without doubles at all. The mock framework was hiding a god-object design problem.

3. **When is `gomock.InOrder` the *right* answer rather than a smell?**

   When the contract you are testing is the order itself. Examples: transactional code (`Begin` before `Insert` before `Commit`), lifecycle hooks (`OnStart` before `OnReady`), retry policies (first call, wait, second call). In all of these, breaking the order is a user-visible bug, so asserting on the order *is* asserting on behavior. Use `InOrder`. Outside these cases, ordering assertions are usually implementation coupling.

---

## Cheat Sheet

```
Consumer-defined interface (the big one):

    package consumer
    type dep interface { Method(ctx, args) (ret, error) }
    type Service struct{ d dep }
    // Producer exports concrete *RealDep, no interface

Choose your double:

    Pure side effect, 1-3 methods       -> hand-rolled stub
    Wants to record calls               -> hand-rolled spy
    Repository / cache / queue          -> in-memory fake
    Large interface, many tests         -> mockery + EXPECT()
    Strict ordering or arg matching     -> gomock
    External HTTP API                   -> httptest.NewServer
    External gRPC                       -> bufconn + fake server
    Database (real testing)             -> testcontainers
    Database (fast unit test)           -> in-memory fake repository

Test smells:

    [] Setup longer than action
    [] Refactor breaks unrelated tests
    [] Mock callback has logic
    [] Package-level shared mock
    [] mock.Anything everywhere
    [] No outcome assertions on SUT output

Always:

    var _ I = (*FakeI)(nil)   // conformance check
    fresh mock per t.Run      // never share
    AssertExpectations(t)     // not optional
    t.Parallel()-safe doubles // mutex or per-test construction
```

---

## Summary

- Go culture treats mock frameworks as an *escape hatch*, not a default. Hand-rolled stubs and in-memory fakes carry most of the load.
- Consumer-defined interfaces are the architectural lever that makes hand-rolled doubles cheap.
- Test *behavior* (user-visible outcomes), not *implementation* (which calls happened in what order). Mocks tilt you toward the wrong side; fakes tilt you toward the right side.
- Mock frameworks earn their keep for strict ordering, boundary side-effect verification, and large interfaces with many consumers.
- Test smells (long setup, refactor brittleness, package-level mocks) point at design problems, not framework choice problems.
- The senior-level move is usually to shrink interfaces, replace mocks with fakes, and assert on outcomes — the framework choice fades from the conversation once those are in place.

---

## Further Reading

- Sandi Metz, "The Magic Tricks of Testing" — classic talk on what to test.
- Martin Fowler, "Mocks Aren't Stubs" — taxonomy and the London/Detroit divide.
- Dave Cheney, "SOLID Go Design" — interface segregation as an architectural lever.
- Go Code Review Comments — "interface should be defined where it is consumed."
- Kent Beck, "Test-Driven Development by Example" — the original argument for behavior-focused tests.
- Eric Evans, *Domain-Driven Design* — repository pattern, fakes vs mocks for persistence.

---

## Related Topics

- [Junior](../junior/) — taxonomy and first hand-rolled stub.
- [Middle](../middle/) — framework walkthroughs.
- [Professional](../professional/) — production patterns at scale.
- [Find the Bug](../find-bug/) — common mistakes in mock-heavy tests.
- [Tasks](../tasks/) — comparison exercises across hand-rolled, testify, gomock.
- [Optimize](../optimize/) — performance discussion of test doubles.
