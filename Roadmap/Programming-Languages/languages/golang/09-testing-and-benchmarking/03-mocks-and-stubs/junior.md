---
layout: default
title: Mocks and Stubs — Junior
parent: Mocks and Stubs
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/03-mocks-and-stubs/junior/
---

# Mocks and Stubs — Junior

[← Back](../)

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Problem Test Doubles Solve](#the-problem-test-doubles-solve)
5. [Fowler's Taxonomy in Plain English](#fowlers-taxonomy-in-plain-english)
6. [Your First Hand-Rolled Stub](#your-first-hand-rolled-stub)
7. [Interfaces — The Magic Sauce](#interfaces--the-magic-sauce)
8. [Stub vs Mock vs Fake — A Comparison Walkthrough](#stub-vs-mock-vs-fake--a-comparison-walkthrough)
9. [Dependency Injection — The Pattern Behind All of This](#dependency-injection--the-pattern-behind-all-of-this)
10. [Recording Calls — Your First Spy](#recording-calls--your-first-spy)
11. [In-Memory Fakes](#in-memory-fakes)
12. [When to Reach for a Framework](#when-to-reach-for-a-framework)
13. [Compile-Time Conformance Check](#compile-time-conformance-check)
14. [Common Mistakes](#common-mistakes)
15. [Common Misconceptions](#common-misconceptions)
16. [Tricky Points](#tricky-points)
17. [Test Yourself](#test-yourself)
18. [Tricky Questions](#tricky-questions)
19. [Cheat Sheet](#cheat-sheet)
20. [Self-Assessment Checklist](#self-assessment-checklist)
21. [Summary](#summary)
22. [What You Can Build Next](#what-you-can-build-next)
23. [Further Reading](#further-reading)
24. [Related Topics](#related-topics)

---

## Introduction

> Focus: "What is a stub? What is a mock? Why does my Go code use interfaces in tests but concrete types in production? How do I write my first hand-rolled stub?"

Sooner or later, the code you want to test will call something you do not want to call for real during a test run. A unit test should not send an email to a real customer, charge a real credit card, write to the real production database, or make a real HTTP request to a third-party API that costs money per call. You need a way to *substitute* those external dependencies with stand-ins that behave just enough like the real thing to make the test meaningful — without the cost, the latency, or the side effects.

That stand-in has a name. In fact it has *five* names, because the testing community has been arguing about terminology for twenty years. The names are: **dummy**, **stub**, **spy**, **mock**, and **fake**. They all do similar things but with subtly different intents. We will untangle them in this file.

The Go ecosystem has a strong preference. While Java developers reach for Mockito and Python developers reach for `unittest.mock`, the typical Go developer writes a small struct that implements an interface and uses it as a stub. No framework. No magic. The reason this works so well in Go — and feels awkward in other languages — is that Go interfaces are *structurally typed*, meaning any struct with the right methods automatically satisfies the interface without an `implements` keyword. This makes hand-rolling a stub cost almost nothing.

After this file you will:

1. Know what each test-double term means (dummy, stub, spy, mock, fake).
2. Write a hand-rolled stub for a simple interface.
3. Understand why the Go community usually prefers hand-rolled over framework-generated.
4. Recognize when a framework would help and when it would just be overhead.
5. Be able to read tests written by colleagues who use `testify/mock` or `gomock`, even if you do not write them yet (middle file will cover usage).

We are *not* going to learn `testify/mock` or `gomock` in this file. Those are middle-level topics. We are going to learn the *idea* of a test double first, with nothing but interfaces and structs.

---

## Prerequisites

- **Required:** Comfort with Go syntax — `struct`, `func`, `interface`, methods on receivers.
- **Required:** You have written at least one `*_test.go` file with a `func TestX(t *testing.T)` and have run `go test` to see it pass.
- **Required:** You understand that Go interfaces are satisfied by implementing the method set, with no `implements` keyword.
- **Helpful:** You have read at least one StackOverflow answer about mocks and felt confused. (That confusion is what we are about to clear up.)

You do *not* need to know:

- Any third-party testing library. `testify`, `gomock`, `mockery` — none of these will appear in this file.
- Reflection, code generation, or build tags.
- Anything about `database/sql`, HTTP clients, or gRPC. We will use a fake "email sender" as the running example.

If you can write `func TestAdd(t *testing.T) { if Add(2, 2) != 4 { t.Fail() } }` and run it, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Test double** | Umbrella term for any object that replaces a real dependency during a test. Coined by Gerard Meszaros. |
| **Dummy** | An object that is passed but never used; fills a parameter slot. |
| **Stub** | A test double that returns hard-coded values when its methods are called. No verification. |
| **Spy** | A stub that *also* records information about how it was called (call counts, arguments). |
| **Mock** | A test double pre-programmed with expectations — a specification of which calls should happen, with what arguments, in what order. The test fails if those expectations are not met. |
| **Fake** | A working implementation with a shortcut not suitable for production. Example: an in-memory map standing in for a real database. |
| **System under test (SUT)** | The thing you are actually trying to test. Everything else around it that is replaced is a test double. |
| **Interface** | In Go, a named set of method signatures. Any type with those methods satisfies the interface implicitly. |
| **Dependency injection (DI)** | Passing a dependency into a function or struct from outside, rather than constructing it internally. |
| **Hand-rolled** | Written by hand as plain Go code, rather than generated by a tool. |
| **Conformance check** | A compile-time assertion that a struct implements an interface, usually via `var _ I = (*T)(nil)`. |

You will see these words used inconsistently in blog posts and even in framework documentation. Many people say "mock" when they mean "stub." After reading this file you will hear the difference.

---

## The Problem Test Doubles Solve

Here is a function we want to test:

```go
package signup

import (
    "context"
    "errors"
    "regexp"
)

type EmailSender interface {
    Send(ctx context.Context, to, subject, body string) error
}

type Service struct {
    Mailer EmailSender
}

var emailRE = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func (s *Service) Signup(ctx context.Context, email string) error {
    if !emailRE.MatchString(email) {
        return errors.New("invalid email")
    }
    return s.Mailer.Send(ctx, email, "Welcome!", "Thanks for signing up.")
}
```

We want to test:

1. Invalid emails are rejected without sending.
2. Valid emails cause `Send` to be called with the right arguments.
3. If `Send` returns an error, `Signup` propagates it.

But `EmailSender.Send` in production would actually deliver an email. We need a *substitute* — something that satisfies the `EmailSender` interface, does not actually send mail, and (for tests 2 and 3) lets us control what happens.

That substitute is a test double. We have five flavors to choose from. For this case the simplest flavor — a **stub** — is enough.

---

## Fowler's Taxonomy in Plain English

In a 2007 essay titled "Mocks Aren't Stubs," Martin Fowler popularized a taxonomy originally from Gerard Meszaros's book *xUnit Test Patterns*. Five flavors:

### Dummy

A placeholder. The test passes it as a parameter but the code never calls any of its methods. Use case: when a function signature requires an argument that is irrelevant to the test.

```go
var dummyLogger Logger = nil // sometimes a typed nil suffices
svc.DoSomething(dummyLogger)
```

### Stub

Returns canned values. The test wants the code under test to receive a specific return value, but does not care to verify *how* the stub was called.

```go
type stubMailer struct{ err error }

func (s stubMailer) Send(_ context.Context, _, _, _ string) error {
    return s.err
}
```

A stub *answers* questions; it does not *check* whether the right question was asked.

### Spy

A stub plus a recording. Use case: you want to verify that a call happened (or did not happen), and possibly inspect the arguments.

```go
type spyMailer struct {
    calls []spyCall
}

type spyCall struct{ to, subject, body string }

func (s *spyMailer) Send(_ context.Context, to, subject, body string) error {
    s.calls = append(s.calls, spyCall{to, subject, body})
    return nil
}
```

After the test runs, you read `s.calls` and assert on its contents. The verification is *outside* the spy.

### Mock

Pre-programmed with expectations. The verification is *inside* the mock — it knows what calls are supposed to happen and fails the test if they do not. This is the role frameworks like `testify/mock` and `gomock` fill.

```go
// Conceptually:
m.Expect("Send", "alice@example.com", "Welcome!", anyString).Return(nil)
// After the test:
m.Verify(t) // fails if Send was not called as specified
```

A mock *asserts* expectations as part of its own contract. A spy lets you assert externally.

### Fake

A working stand-in implementation suitable for tests but not production. Example: a `map[string]User`-backed user repository that satisfies the same interface as the real PostgreSQL-backed one. A fake actually *does* something meaningful — store users, look them up — just in a way that is not durable, fast, or scalable enough for production.

The line between *fake* and *stub* is the amount of behavior. A stub returns canned values; a fake implements the contract.

### Putting them on a spectrum

```
Passivity                                                Activity
---------|--------|--------|--------|--------|--------------|
       Dummy    Stub     Spy     Mock     Fake
        |        |        |        |         |
   does       returns  remembers asserts  acts like
  nothing      canned   calls   on calls   the real
              values                       thing
```

In Go, you will spend 80% of your time writing stubs and fakes. Spies are common. Mocks (with framework expectations) are next. Dummies are rare.

---

## Your First Hand-Rolled Stub

Back to our `Signup` example. Let's write a stub for `EmailSender`:

```go
package signup_test

import (
    "context"
    "errors"
    "testing"

    "example.com/signup"
)

type stubMailer struct {
    err error // what to return from Send
}

func (s stubMailer) Send(_ context.Context, _, _, _ string) error {
    return s.err
}

func TestSignup_InvalidEmail(t *testing.T) {
    svc := &signup.Service{Mailer: stubMailer{}}
    err := svc.Signup(context.Background(), "not-an-email")
    if err == nil {
        t.Fatal("expected error for invalid email")
    }
}

func TestSignup_ValidEmail(t *testing.T) {
    svc := &signup.Service{Mailer: stubMailer{}}
    err := svc.Signup(context.Background(), "alice@example.com")
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}

func TestSignup_MailerError(t *testing.T) {
    boom := errors.New("smtp down")
    svc := &signup.Service{Mailer: stubMailer{err: boom}}
    err := svc.Signup(context.Background(), "alice@example.com")
    if !errors.Is(err, boom) {
        t.Fatalf("expected boom, got %v", err)
    }
}
```

Notice what we did *not* do:

- We did not import any testing library.
- We did not generate any code.
- We did not declare anywhere that `stubMailer` "implements" `EmailSender`. The compiler infers it from the methods.
- We did not create a mock object with `On(...).Return(...)` syntax.

We wrote a 5-line struct, gave it one method, and used it. That is the entire pattern.

This is what Go developers mean when they say "just use a struct." For most situations, this *is* the right answer. Frameworks are an additional tool for when this gets unwieldy — not a default starting point.

---

## Interfaces — The Magic Sauce

The reason this is so easy in Go is **structural typing**. In Java:

```java
class StubMailer implements EmailSender {
    public void send(String to, String subject, String body) { /* ... */ }
}
```

You must *declare* that `StubMailer` implements `EmailSender`. The compiler will refuse if you forget.

In Go:

```go
type stubMailer struct{}
func (stubMailer) Send(ctx context.Context, to, subject, body string) error { return nil }
```

Nowhere did we write "implements EmailSender." The compiler matches the method set to the interface at the call site. If a function parameter is `EmailSender` and you pass `stubMailer`, the compiler verifies the method match and allows it. If the methods are wrong, you get a compile error at the call site.

This has two consequences:

1. **Writing a stub is just writing a struct.** No declaration, no annotation, no boilerplate.
2. **Interfaces are usually defined where they are consumed, not where they are implemented.** The `EmailSender` interface lives in `package signup` because `signup` uses it. The real implementation might be a `SMTPMailer` in `package mailer` that has *no idea* about `EmailSender` — it just happens to have a `Send` method with the right signature.

This pattern — "interface at the consumer" — is core to Go's design philosophy. It keeps interfaces tiny because they contain only the methods one specific consumer uses. And tiny interfaces are easy to stub.

### A small interface beats a big one

Consider two designs:

```go
// Design A — interface near the implementation
package mailer

type Mailer interface {
    Send(ctx context.Context, to, subject, body string) error
    SendBatch(ctx context.Context, recipients []string, subject, body string) error
    SendTemplated(ctx context.Context, to, templateID string, data map[string]any) error
    SetFrom(addr string)
    SetReplyTo(addr string)
    Quota() (remaining int, err error)
    // ... 12 more methods
}
```

```go
// Design B — interface near the consumer
package signup

type emailSender interface {
    Send(ctx context.Context, to, subject, body string) error
}
```

If you stub Design A, you write 18 method bodies. If you stub Design B, you write 1. The methods are the same; the *interface* is sized to what `signup` actually needs.

This is the **interface segregation principle** applied to Go. It is not just academic — it directly affects how painful your tests are to maintain.

---

## Stub vs Mock vs Fake — A Comparison Walkthrough

Let's see the same test written three ways. The system under test: a `Notifier` that emails a user when an order ships.

```go
package notify

import (
    "context"
    "fmt"
)

type Mailer interface {
    Send(ctx context.Context, to, subject, body string) error
}

type Notifier struct{ M Mailer }

func (n *Notifier) OrderShipped(ctx context.Context, email, orderID string) error {
    return n.M.Send(ctx, email, "Your order shipped", fmt.Sprintf("Order %s is on its way.", orderID))
}
```

### Style 1 — Stub

```go
type stubMailer struct{ err error }

func (s stubMailer) Send(_ context.Context, _, _, _ string) error { return s.err }

func TestOrderShipped_Stub(t *testing.T) {
    n := &notify.Notifier{M: stubMailer{}}
    if err := n.OrderShipped(context.Background(), "alice@x", "ORD-1"); err != nil {
        t.Fatal(err)
    }
}
```

We verify the happy path completes without error. We do not check what `Send` was called with. The stub answered the question "what does `Send` return" and that was enough.

### Style 2 — Spy

```go
type spyMailer struct {
    calls []struct{ to, subject, body string }
}

func (s *spyMailer) Send(_ context.Context, to, subject, body string) error {
    s.calls = append(s.calls, struct{ to, subject, body string }{to, subject, body})
    return nil
}

func TestOrderShipped_Spy(t *testing.T) {
    spy := &spyMailer{}
    n := &notify.Notifier{M: spy}
    if err := n.OrderShipped(context.Background(), "alice@x", "ORD-1"); err != nil {
        t.Fatal(err)
    }
    if len(spy.calls) != 1 {
        t.Fatalf("expected 1 call, got %d", len(spy.calls))
    }
    if spy.calls[0].to != "alice@x" {
        t.Errorf("wrong recipient: %s", spy.calls[0].to)
    }
    if !strings.Contains(spy.calls[0].body, "ORD-1") {
        t.Errorf("body missing order id: %s", spy.calls[0].body)
    }
}
```

Now we verify *what* was sent. The spy recorded the call; the test inspected the recording.

### Style 3 — Mock (conceptual, without a framework)

```go
type mockMailer struct {
    expected struct{ to, subject string }
    called   bool
}

func (m *mockMailer) Send(_ context.Context, to, subject, _ string) error {
    if to != m.expected.to || subject != m.expected.subject {
        // mock-style: fail the test from inside the mock
        panic(fmt.Sprintf("unexpected call: to=%s subject=%s", to, subject))
    }
    m.called = true
    return nil
}

func (m *mockMailer) Verify(t *testing.T) {
    if !m.called {
        t.Error("expected Send to be called")
    }
}

func TestOrderShipped_Mock(t *testing.T) {
    m := &mockMailer{}
    m.expected.to = "alice@x"
    m.expected.subject = "Your order shipped"

    n := &notify.Notifier{M: m}
    if err := n.OrderShipped(context.Background(), "alice@x", "ORD-1"); err != nil {
        t.Fatal(err)
    }
    m.Verify(t)
}
```

The mock knows what it expects and fails if violated. This is what `testify/mock` and `gomock` do for you — but as you can see, it's just a struct with extra fields.

In production Go, you would rarely hand-roll mocks. If you need expectation-style behavior, reach for `gomock` (middle file). The role for hand-rolling is **stubs** and **spies** and **fakes**.

### Style 4 — Fake (in-memory implementation)

For a `UserRepo` (not the `Mailer`), a fake might look like:

```go
type fakeUserRepo struct {
    mu    sync.Mutex
    users map[string]User
}

func newFakeUserRepo() *fakeUserRepo { return &fakeUserRepo{users: map[string]User{}} }

func (f *fakeUserRepo) Save(_ context.Context, u User) error {
    f.mu.Lock(); defer f.mu.Unlock()
    f.users[u.ID] = u
    return nil
}

func (f *fakeUserRepo) FindByID(_ context.Context, id string) (User, error) {
    f.mu.Lock(); defer f.mu.Unlock()
    u, ok := f.users[id]
    if !ok { return User{}, ErrNotFound }
    return u, nil
}
```

The fake actually stores users and lets them be retrieved. Tests can save a user and then test code that reads it back. A stub cannot do this because a stub has no state — it only returns canned values.

---

## Dependency Injection — The Pattern Behind All of This

For test doubles to work, the code under test must *accept* a dependency rather than create one. Compare:

```go
// Bad — Mailer is constructed internally; cannot be replaced
func Signup(email string) error {
    m := smtp.NewMailer("smtp.example.com:25")
    return m.Send(context.Background(), email, "Welcome", "...")
}
```

```go
// Good — Mailer is passed in; replaceable in tests
type Service struct{ M Mailer }

func (s *Service) Signup(ctx context.Context, email string) error {
    return s.M.Send(ctx, email, "Welcome", "...")
}
```

This pattern is **dependency injection** (DI). In Go, DI is usually plain struct fields — no container, no framework. You inject by writing `&Service{M: realMailer}` in production and `&Service{M: stubMailer{}}` in tests.

Three common DI styles in Go:

### 1. Struct field injection (most common)

```go
type Service struct {
    Mailer EmailSender
    Logger Logger
    Clock  Clock
}
```

Wire up in `main`:

```go
svc := &Service{
    Mailer: smtp.New("smtp:25"),
    Logger: zap.NewProduction(),
    Clock:  realClock{},
}
```

### 2. Constructor injection

```go
func NewService(m EmailSender, l Logger, c Clock) *Service {
    return &Service{Mailer: m, Logger: l, Clock: c}
}
```

Equivalent in tests but more explicit about required dependencies.

### 3. Functional options

```go
func NewService(opts ...Option) *Service {
    s := &Service{}
    for _, opt := range opts {
        opt(s)
    }
    return s
}

func WithMailer(m EmailSender) Option { return func(s *Service) { s.Mailer = m } }
```

Used when there are many optional dependencies. Overkill for small services.

For our purposes — testing — what matters is that the dependency *can* be supplied from outside. If it cannot, no amount of clever stubbing will help.

---

## Recording Calls — Your First Spy

Spies are stubs that remember. The pattern:

```go
type spy struct {
    mu     sync.Mutex // only if used from multiple goroutines
    calls  int
    lastTo string
}

func (s *spy) Send(_ context.Context, to, _, _ string) error {
    s.mu.Lock(); defer s.mu.Unlock()
    s.calls++
    s.lastTo = to
    return nil
}
```

Use it in a test:

```go
func TestSendCalledOnce(t *testing.T) {
    s := &spy{}
    n := &Notifier{M: s}
    _ = n.OrderShipped(ctx, "alice@x", "1")

    if s.calls != 1 {
        t.Fatalf("expected 1 call, got %d", s.calls)
    }
    if s.lastTo != "alice@x" {
        t.Errorf("wrong recipient: %s", s.lastTo)
    }
}
```

Tips:

- **Use a pointer receiver** (`func (s *spy) Send`) so the call increment is visible to the caller. With a value receiver, you would be incrementing a copy.
- **Protect with a mutex** if the SUT spawns goroutines. The Go race detector (`go test -race`) will catch you if you forget.
- **Keep the spy minimal.** Record only what the test verifies. Adding fields "in case we need them" is a code smell.

---

## In-Memory Fakes

For repository-like interfaces, an in-memory fake is often easier than a mock:

```go
type Repo interface {
    Save(ctx context.Context, item Item) error
    Find(ctx context.Context, id string) (Item, error)
    List(ctx context.Context) ([]Item, error)
}

type fakeRepo struct {
    mu    sync.Mutex
    items map[string]Item
}

func newFakeRepo() *fakeRepo { return &fakeRepo{items: map[string]Item{}} }

func (r *fakeRepo) Save(_ context.Context, it Item) error {
    r.mu.Lock(); defer r.mu.Unlock()
    r.items[it.ID] = it
    return nil
}

func (r *fakeRepo) Find(_ context.Context, id string) (Item, error) {
    r.mu.Lock(); defer r.mu.Unlock()
    it, ok := r.items[id]
    if !ok { return Item{}, ErrNotFound }
    return it, nil
}

func (r *fakeRepo) List(_ context.Context) ([]Item, error) {
    r.mu.Lock(); defer r.mu.Unlock()
    out := make([]Item, 0, len(r.items))
    for _, it := range r.items {
        out = append(out, it)
    }
    return out, nil
}
```

Why a fake beats a mock for repositories:

1. **Tests can read back what they wrote.** A workflow test that does "save, then verify the saved item is findable" needs state. Mocks would require setting up `Save` *and* `Find` expectations explicitly; the fake handles it automatically.
2. **One implementation serves many tests.** The fake is a one-time investment. Mocks duplicate setup per test.
3. **Refactor-safe.** Renaming a method on the interface breaks the fake and the production implementation. Renaming a method only breaks mocks if you remember to update every test.

The trade-off: a fake is more code to write *once*. Once written, it costs less per test.

---

## When to Reach for a Framework

You do *not* need a framework if:

- The interface has 1-3 methods.
- The same stub serves multiple tests with minor variations (use a struct field for the variation).
- You are not verifying call counts or call sequences.

You may benefit from a framework if:

- The interface has 15+ methods and you only care about 4 in each test.
- You need to assert that a specific call happened with specific arguments in a specific order.
- You are writing 50+ tests against the same interface and the boilerplate is causing copy-paste bugs.

The middle file covers `testify/mock`, `mockery`, and `gomock` in detail. For now, the take-away is: **start hand-rolled, move to a framework only when the pain is real.**

---

## Compile-Time Conformance Check

A small but important habit. After defining a stub:

```go
type stubMailer struct{}
func (stubMailer) Send(ctx context.Context, to, subject, body string) error { return nil }

var _ EmailSender = (*stubMailer)(nil) // compile-time check
```

The `var _ I = (*T)(nil)` line declares that `*stubMailer` satisfies `EmailSender`. The underscore discards the variable. The cost is one line, zero allocation, zero runtime overhead.

Without it: if you rename `Send` to `SendEmail` on the interface but forget to update the stub, the test file still compiles (because no one calls the stub *as* the interface inside that file). The compile error appears somewhere else, where the stub is passed to the service. With the conformance check, the error appears right next to the stub declaration — much easier to fix.

---

## Common Mistakes

### Mistake 1 — Stubbing a concrete type

```go
type Mailer struct{ /* ... */ }
func (m *Mailer) Send(...) error { /* ... */ }

// in test:
var realMailer Mailer
realMailer.Send(...) // not a stub, the real thing!
```

Symptom: the test "succeeds" but actually hit the network. Fix: introduce an interface and inject it.

### Mistake 2 — Forgetting the pointer receiver on a spy

```go
type spy struct{ calls int }
func (s spy) Send(...) error {
    s.calls++ // increments a copy!
    return nil
}
```

After the test, `spy.calls` is still 0. Use `func (s *spy)` so the increment hits the original.

### Mistake 3 — Sharing a spy across parallel subtests

```go
spy := &spy{}
for _, tc := range cases {
    tc := tc
    t.Run(tc.name, func(t *testing.T) {
        t.Parallel()
        // all subtests append to the same spy.calls — race!
    })
}
```

Fix: build a fresh spy inside each subtest.

### Mistake 4 — Using `mock.Anything` everywhere

(More relevant once you use `testify/mock` — but the principle applies to hand-rolled too.)

```go
spy.On("Send", anything, anything, anything, anything).Return(nil)
```

This stub accepts any argument, so the test never checks that the right arguments were passed. The bug "we send the wrong recipient" sails through. Always check at least one identifying argument.

### Mistake 5 — Verifying internals instead of behavior

```go
// Bad — testing implementation
spy.AssertCalled("Begin")
spy.AssertCalled("Save", anything)
spy.AssertCalled("Commit")

// Better — testing behavior
afterSave, _ := repo.Find(ctx, id)
require.Equal(t, expected, afterSave)
```

The first version breaks if you refactor `Save+Commit` into a single method. The second only breaks if the user-visible behavior changes.

### Mistake 6 — Stubbing what you should be calling for real

```go
// Stubbing time.Now
type stubClock struct{ t time.Time }
func (s stubClock) Now() time.Time { return s.t }
```

This is *correct*. Time is a side effect; stub it.

```go
// Stubbing fmt.Sprintf
// ... why?
```

This is wrong. `fmt.Sprintf` is deterministic and free; no need to stub.

Rule of thumb: stub things that involve I/O, randomness, or time. Do not stub pure functions.

---

## Common Misconceptions

### "Stub and mock are the same thing"

They are not. A stub answers questions; a mock asserts that questions were asked. The same Go struct can play either role depending on whether you call `Verify(t)` on it — but the *concepts* are different.

### "Mocks are always better because they verify more"

More verification is not always better. Mocks that assert on call order make tests brittle — any refactor that reorders calls breaks the test even if behavior is unchanged. Use mocks only where the call sequence *is* the contract (transactions, lifecycle hooks, retries).

### "Frameworks are required for serious testing"

False in Go. The standard library has no mock framework. The most common pattern in production Go codebases is the hand-rolled stub. Frameworks are a useful tool when the interface is large or expectations are complex; they are not a baseline requirement.

### "I should mock everything I depend on"

Mocking everything makes tests fragile and divorced from reality. Mock external systems (network, files, time) and *behavioral* boundaries you care about. Use real things or fakes for everything else.

### "Generated mocks are faster than hand-rolled"

Slightly faster at runtime (less reflection), but the runtime cost of a mock call is invisible in normal tests. The real question is which is faster to write and to read — and that depends on the interface size, not the framework.

### "An interface with 20 methods needs a mock framework"

Or it needs to be split into smaller interfaces, one per consumer. A 20-method interface is usually a design smell. Fix the design, then the test problem disappears.

---

## Tricky Points

### Value receiver vs pointer receiver

```go
type stubMailer struct{}
func (stubMailer) Send(...) error { return nil }  // value receiver
```

```go
type stubMailer struct{}
func (*stubMailer) Send(...) error { return nil } // pointer receiver
```

Both work, but:

- Value receivers mean `stubMailer{}` satisfies the interface. You can pass `stubMailer{}` or `&stubMailer{}`.
- Pointer receivers mean only `&stubMailer{}` satisfies the interface. Passing `stubMailer{}` fails to compile.

If your stub holds state (a recording slice, a counter), use a pointer receiver — see the "spy" example earlier. If your stub is stateless, either works; value receiver is slightly more flexible.

### Stubbing methods with return values you do not care about

```go
type Mailer interface {
    Send(...) error
    Quota() (int, error)
}
```

If your test only calls `Send`, you still need to implement `Quota` to satisfy the interface. You can:

```go
func (stubMailer) Quota() (int, error) { return 0, nil }
```

Or panic if it should never be called:

```go
func (stubMailer) Quota() (int, error) { panic("Quota not expected in this test") }
```

The panic version surfaces "unexpected" calls clearly. Use it when you specifically want to assert "this method should not be called."

### Embedding a default to skip methods

Some Go projects publish a base type that satisfies an interface with no-op methods:

```go
type NoopMailer struct{}
func (NoopMailer) Send(...) error { return nil }
func (NoopMailer) Quota() (int, error) { return 0, nil }

// in test:
type myStub struct{ NoopMailer }
func (s *myStub) Send(...) error { return s.err } // override only what we care about
```

This embedding trick is occasionally useful for large interfaces. For interfaces with 2-3 methods it is overkill.

---

## Test Yourself

1. What's the difference between a stub and a spy?
2. Why does Go make hand-rolled test doubles cheaper than Java?
3. When would you use a fake instead of a stub for a repository?
4. What does `var _ EmailSender = (*stubMailer)(nil)` do?
5. Why use a pointer receiver on a spy?
6. Name one situation where a mock is better than a stub.

Answers below the next section.

---

## Tricky Questions

1. You have a `Logger` interface with a `Debug` method that does I/O. Should your test stub it or call the real thing? Why?
2. A coworker writes a stub that returns `errors.New("nope")` to test the error path. What's wrong with that, and what should they do?
3. Why is `var _ Interface = (*Stub)(nil)` better than letting the compiler discover the mismatch at the call site?

Answers:

1. **Stub it.** Even if the logger writes to `/dev/null` in tests, you do not want tests to compete for stdout/stderr or to pollute test output. A no-op stub `(stubLogger) Debug(...) {}` is the standard pattern.

2. **`errors.New` creates a new error every call.** If the production code does `errors.Is(err, ExpectedErr)`, comparing by identity fails because the stub's error is a different value. Use a package-level sentinel: `var errStub = errors.New("stub error")`, then return `errStub`. Now `errors.Is(err, errStub)` works.

3. **Locality.** The conformance check fires next to the stub declaration; the call-site error fires far away. Reading the latter requires jumping files; the former is a glance. Saves minutes of debugging per slip-up.

---

## Cheat Sheet

```go
// 1. Define the interface where it's consumed
type EmailSender interface {
    Send(ctx context.Context, to, subject, body string) error
}

// 2. Define the SUT to accept the interface
type Service struct{ M EmailSender }
func (s *Service) DoIt(ctx context.Context) error { return s.M.Send(ctx, "...", "...", "...") }

// 3. Hand-roll a stub
type stubMailer struct{ err error }
func (s stubMailer) Send(_ context.Context, _, _, _ string) error { return s.err }

// 4. Add a conformance check
var _ EmailSender = (*stubMailer)(nil)

// 5. Use in tests
func TestDoIt(t *testing.T) {
    svc := &Service{M: stubMailer{}}
    if err := svc.DoIt(context.Background()); err != nil { t.Fatal(err) }
}

// 6. For recording calls, use a spy with a pointer receiver
type spyMailer struct{ calls []string }
func (s *spyMailer) Send(_ context.Context, to, _, _ string) error {
    s.calls = append(s.calls, to)
    return nil
}

// 7. For repository-like interfaces, prefer an in-memory fake
type fakeRepo struct {
    mu    sync.Mutex
    items map[string]Item
}
```

Mental model:

```
       Behavior to verify?
              |
       +------+-----+
       |            |
      NO          YES
       |            |
      Stub        How?
                   |
            +------+------+
            |             |
       Counts /         Strict
       arguments       order &
       (Spy)          expectations
                       (Mock —
                       use framework)

Need persistent state (read-back)?
  -> Fake (in-memory implementation)
```

---

## Self-Assessment Checklist

- [ ] I can define a stub for an interface with one method and use it in a test.
- [ ] I can explain the difference between stub, spy, mock, and fake without consulting notes.
- [ ] I know why Go prefers hand-rolled stubs over framework-generated mocks for simple interfaces.
- [ ] I add `var _ I = (*T)(nil)` to every hand-rolled fake/stub I write.
- [ ] I use pointer receivers on spies that record state.
- [ ] I do not share spies/stubs across parallel subtests.
- [ ] I prefer fakes over mocks for repository-like interfaces.
- [ ] I understand that the framework decision is not a default — it's a response to interface size and verification complexity.

If you can check all eight, you are ready for the middle file (`testify/mock`, `mockery`, `gomock`).

---

## Summary

- Test doubles are stand-ins for real dependencies. Fowler's five flavors: dummy, stub, spy, mock, fake.
- Go's structural typing makes hand-rolled doubles cheap — a stub is just a struct with the right methods.
- The most common Go pattern: small consumer-defined interface plus hand-rolled stub.
- Stubs answer; spies record; mocks assert; fakes implement.
- Use mock frameworks when interfaces are large or expectations are strict — not as a default.
- Verify behavior (outcomes) over implementation (call sequences) wherever possible.
- Add `var _ I = (*T)(nil)` for compile-time safety.
- Use pointer receivers and mutexes for stateful spies.

The middle file will show you how to use `testify/mock`, `mockery`, and `gomock` and when each one earns its keep over hand-rolled.

---

## What You Can Build Next

- A small CLI tool with a `Notifier` interface and three implementations: real SMTP, console-printer, and an in-memory stub for tests.
- A repository test suite for a domain you understand (todo list, library books, etc.) using an in-memory fake.
- A retry helper that takes a `func() error` and retries on transient errors; write tests using a stub `error`-returning function whose behavior is controlled by a counter.

---

## Further Reading

- Martin Fowler, "Mocks Aren't Stubs" — <https://martinfowler.com/articles/mocksArentStubs.html>
- Gerard Meszaros, *xUnit Test Patterns* — the original taxonomy.
- Dave Cheney, "SOLID Go Design" — discusses interface segregation and consumer-defined interfaces.
- Go standard library tests — read tests in `net/http`, `io`, `database/sql` to see hand-rolled test doubles in idiomatic style.

---

## Related Topics

- [Mocks and Stubs — Middle](../middle/) — frameworks: `testify/mock`, `mockery`, `gomock`.
- [Mocks and Stubs — Senior](../senior/) — why Go favors hand-rolled; interface design; in-memory fakes.
- [Mocks and Stubs — Professional](../professional/) — production scenarios: HTTP, gRPC, DB.
- [Mocks and Stubs — Find the Bug](../find-bug/) — common pitfalls.
- [Mocks and Stubs — Tasks](../tasks/) — hand-rolled vs framework comparison exercises.
