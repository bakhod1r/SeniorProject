# Test Doubles: Mocks & Fakes — Junior Level

> **Roadmap:** [Testing](../README.md) → Test Doubles: Mocks & Fakes
>
> *Stand-ins for the real thing — so your test can run fast, every time, without touching a database or the network.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why Test Doubles Exist](#core-concept-1--why-test-doubles-exist)
5. [Core Concept 2 — The Five Doubles, Named Precisely](#core-concept-2--the-five-doubles-named-precisely)
6. [Core Concept 3 — Your First Stub](#core-concept-3--your-first-stub)
7. [Core Concept 4 — A Stub vs a Mock](#core-concept-4--a-stub-vs-a-mock)
8. [Core Concept 5 — Injecting the Dependency](#core-concept-5--injecting-the-dependency)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **understanding why we replace real dependencies in tests, and learning the exact names for the five kinds of stand-in.**

Your code rarely works alone. A function that places an order talks to a database, a payment API, maybe an email service and the system clock. If your test exercised all of those for real, it would be **slow** (network round-trips), **flaky** (the API is down today), and **hard to control** (how do you make a real credit-card charge fail on demand?).

A **test double** is a stand-in object you pass to your code *instead* of the real dependency — just like a stunt double stands in for an actor in a dangerous scene. The double is fast, predictable, and fully under your control. The goal is always **control and speed**, never "mocking because that's what tests do."

There are five distinct kinds of double, and they have precise names. Using the wrong name causes endless confusion, so this level teaches you the vocabulary first, then walks you through writing your first one.

---

## Prerequisites

- You can write and run a basic unit test (see [Unit Testing — Junior](../02-unit-testing/junior.md)).
- You understand functions, classes/structs, return values, and exceptions/errors.
- You have seen an *interface* or *abstract type* in at least one language.
- Helpful: a passing familiarity with the idea of passing a dependency into a constructor or function.

---

## Glossary

| Term | Meaning |
|---|---|
| **Test double** | Any stand-in object used in place of a real dependency during a test. The umbrella term for the five below. |
| **Dummy** | An object passed only to fill a parameter slot. It is **never actually used** by the code path under test. |
| **Stub** | Returns **canned answers** to calls made during the test. It feeds inputs *into* the system under test. |
| **Spy** | A stub that **also records** how it was called, so the test can inspect those records afterward. |
| **Mock** | Pre-programmed with **expectations** about how it should be called, and **verifies** them — the test fails if the interaction didn't happen as specified. |
| **Fake** | A **working, lightweight implementation** (e.g. an in-memory database) — real logic, but a shortcut not suitable for production. |
| **System Under Test (SUT)** | The code your test is actually exercising. |
| **Collaborator** | A dependency the SUT talks to. The thing a double replaces. |
| **Dependency injection (DI)** | Passing a collaborator *in* (via constructor or argument) instead of creating it inside the code — what makes doubles possible. |

> This taxonomy comes from Gerard Meszaros's book *xUnit Test Patterns*. These five names are the industry standard — learn them exactly.

---

## Core Concept 1 — Why Test Doubles Exist

A real dependency causes three problems in a test:

1. **Slow.** A database query or HTTP call is thousands of times slower than an in-memory function call. A suite of 2,000 tests that each hit a real service takes minutes; with doubles it takes a second.
2. **Nondeterministic.** The external API might be down, return different data tomorrow, or rate-limit you. `time.Now()` returns a different value every run. `random()` is, well, random. A flaky test you can't trust is worse than no test.
3. **Hard to control.** To test "what happens when the payment is declined?" you'd need to actually trigger a decline. With a double you just say "pretend this call returns *declined*" — instantly, reliably.

Test doubles solve all three by giving you a fast, deterministic, fully controllable stand-in. That's the entire justification. If a real object is already fast, deterministic, and easy to control (a pure helper function, a value object), **use the real thing** — don't double it.

```
   Real world (in production)          In your test
  ┌────────────┐   ┌─────────┐       ┌────────────┐   ┌──────────────┐
  │  Your code │──▶│ Real DB │       │  Your code │──▶│  Test double │
  │  (the SUT) │   │ network │       │  (the SUT) │   │ fast • exact │
  └────────────┘   └─────────┘       └────────────┘   └──────────────┘
```

---

## Core Concept 2 — The Five Doubles, Named Precisely

People say "mock" for all of these, which is wrong and causes real confusion in code review. Here is the precise distinction:

- **Dummy** — Passed to satisfy a parameter, but never called on the path you're testing. Example: a `Logger` you must pass to a constructor, but the method under test never logs.
- **Stub** — Returns canned data. "When `getUser(7)` is called, return this fixed `User`." It pushes a known input into the SUT. A stub has **no assertions of its own**.
- **Spy** — A stub *plus* a notebook. It returns canned data **and** records what it received ("I was called twice, with these arguments"). The test reads that notebook afterward.
- **Mock** — Set up *in advance* with expectations: "you **must** call `send()` exactly once with this email." The mock itself **verifies** the interaction and fails the test if it didn't happen as specified.
- **Fake** — A genuine working implementation with a shortcut. An in-memory repository that actually stores and retrieves objects (in a map), or an in-memory SQLite instead of production Postgres. It *behaves* correctly; it just isn't production-grade.

The crucial split for now: **stub/spy/fake feed data and let you check the result** (state); **mock asserts that a specific call happened** (behavior). More on that distinction in the middle level.

---

## Core Concept 3 — Your First Stub

Say we have a `Greeter` that fetches a user's name from a repository and builds a greeting. The repository normally hits a database. In the test we replace it with a **stub** that returns a fixed name.

Python, using `unittest.mock`:

```python
from unittest.mock import Mock

def greet(repo, user_id):
    name = repo.get_name(user_id)
    return f"Hello, {name}!"

def test_greet_uses_the_repository_name():
    # Arrange: a stub that returns a canned answer
    repo = Mock()
    repo.get_name.return_value = "Ada"      # canned answer

    # Act
    message = greet(repo, user_id=7)

    # Assert on the RESULT (state verification)
    assert message == "Hello, Ada!"
```

We never touched a database. The stub `repo` answers `get_name` with `"Ada"` no matter what, so the test is instant and deterministic. Notice the assertion is about the **returned string** — the output of our code — not about the stub.

> `unittest.mock.Mock` is a single flexible object that can act as a stub, spy, or mock depending on how you use it. Naming it `repo` (a stub) rather than `mock` keeps your intent clear.

---

## Core Concept 4 — A Stub vs a Mock

This is the single most important distinction in the whole topic. Same scenario, two styles:

**Stub — assert on the result (state):**

```python
def test_with_a_stub():
    repo = Mock()
    repo.get_name.return_value = "Ada"
    assert greet(repo, 7) == "Hello, Ada!"     # I check the OUTPUT
```

**Mock — assert on the interaction (behavior):**

```python
def test_with_a_mock():
    repo = Mock()
    repo.get_name.return_value = "Ada"
    greet(repo, 7)
    repo.get_name.assert_called_once_with(7)    # I check the CALL happened
```

The stub test says *"given this name, the greeting is correct."* The mock test says *"my code called `get_name` once, with `7`."*

For a function whose **output** is what matters (like `greet`), the **stub** version is better: it survives refactoring and actually checks the thing users care about (the greeting). Use a mock only when the *call itself* is the point — e.g. "we must send exactly one confirmation email." Reaching for mocks by default leads to brittle tests, a trap explored at the senior level.

---

## Core Concept 5 — Injecting the Dependency

You can only swap in a double if the code lets you *pass the collaborator in*. This is **dependency injection**, and it's the enabler for everything here.

**Hard to test — the dependency is created inside:**

```python
class OrderService:
    def __init__(self):
        self.db = PostgresDatabase()     # hard-wired; a test can't replace it
```

**Easy to test — the dependency is passed in:**

```python
class OrderService:
    def __init__(self, db):              # injected
        self.db = db

# Production:
service = OrderService(PostgresDatabase())
# Test:
service = OrderService(fake_in_memory_db)   # swap in a fake/stub
```

The second version lets the test hand `OrderService` any stand-in it likes. Whenever something is awkward to test, the first question is usually "is this dependency injected?" The [dependency-injection skill](../02-unit-testing/junior.md) goes deeper on the techniques.

---

## Real-World Examples

- **Payment declined.** Stub the payment gateway to return `DECLINED`, then assert your checkout shows the right error — without ever making a real charge.
- **Time-sensitive logic.** A "token expires after 1 hour" rule is impossible to test with the real clock unless you wait an hour. Inject a fake clock you can set to any time (middle level).
- **Email confirmation.** Use a *mock* email sender to assert "exactly one welcome email was sent to the new user's address" — here the call **is** the behavior.
- **Flaky third-party API.** Replace the weather API with a fake that returns canned forecasts, so your test passes whether or not the vendor is online.

---

## Mental Models

- **Stunt double.** The double does the dangerous, slow, or unpredictable scene so the real object (and your test) stays safe and fast.
- **Inputs vs outputs.** A **stub** supplies *inputs* to your code; a **mock** checks *outputs* in the form of calls. Stub = "here's what you'll get back." Mock = "I expect you to make this call."
- **Don't double cheap things.** If the real object is fast and deterministic, use it. Doubles are for slow, flaky, or hard-to-control collaborators only.
- **The double is not the thing you test.** You test *your* code's behavior. The double is scaffolding.

---

## Common Mistakes

- **Calling everything a "mock."** A stub returns data; a mock verifies calls. Mixing the words muddles design discussions.
- **Stubbing the thing you're testing.** Doubles replace *collaborators*, never the SUT itself. If you stubbed the code under test, you'd be testing nothing.
- **Asserting on the stub instead of the result.** `assert repo.get_name.return_value == "Ada"` checks the test's own setup, not your code. Assert on what `greet` returned.
- **Doubling fast, pure objects.** No need to stub a `Money` value object or a pure formatter — just use the real one.
- **Forgetting determinism.** A "double" that still reads the real clock or real random source isn't controlling the nondeterminism it was supposed to.

---

## Test Yourself

1. In one sentence each, define dummy, stub, spy, mock, and fake.
2. What two assertions distinguish a **stub** test from a **mock** test for the same `greet` function?
3. Why can't you use a test double if the dependency is created with `new` *inside* the class?
4. Give one collaborator that is *worth* doubling and one that is *not*. Justify each.
5. Your test asserts `repo.get_name.return_value == "Ada"`. What's wrong with it?

---

## Cheat Sheet

```
THE FIVE DOUBLES (Meszaros)
  Dummy  → fills a parameter, never used
  Stub   → returns canned answers (feeds input)
  Spy    → stub + records how it was called
  Mock   → pre-set expectations, VERIFIES the call (fails if not met)
  Fake   → working lightweight impl (in-memory DB/repo)

WHY DOUBLE AT ALL
  slow • nondeterministic • hard to control  → DB, network, clock, random, APIs

STUB vs MOCK
  stub  → assert on the RESULT (state)      ← prefer this by default
  mock  → assert the CALL happened (behavior) ← only when the call IS the contract

ENABLER
  dependency injection: pass collaborators in, don't 'new' them inside
```

---

## Summary

A test double is a controllable stand-in for a real dependency, used to make tests **fast, deterministic, and easy to control** — and for no other reason. Meszaros names exactly five: **dummy** (fills a slot), **stub** (canned answers), **spy** (stub that records), **mock** (pre-set expectations that it verifies), and **fake** (a working in-memory implementation). The deepest early lesson is the **stub vs mock** split: a stub lets you assert on your code's *result* (state), while a mock asserts that a specific *interaction* happened (behavior). Default to stubs/fakes and state checks; reach for mocks only when the call itself is the point. None of this is possible without **dependency injection** — passing collaborators in rather than hard-wiring them. The [middle level](middle.md) builds on this with state vs behavior verification and faking the clock, randomness, and HTTP.

---

## Further Reading

- Gerard Meszaros — *xUnit Test Patterns*, the chapter that defines the five doubles.
- Martin Fowler — *Mocks Aren't Stubs* (the essay that popularized the distinction).
- Python docs — `unittest.mock` "Getting Started" guide.
- The `mocking-strategies` and `dependency-injection` skills.

---

## Related Topics

- [Unit Testing — Junior](../02-unit-testing/junior.md) — where doubles get used.
- [Integration Testing](../03-integration-testing/junior.md) — when you deliberately *don't* double the real thing.
- [Test Doubles — Middle](middle.md) — state vs behavior verification, faking the clock and HTTP.
- [Contract Testing](../05-contract-testing/junior.md) — the real answer to "don't mock what you don't own."
