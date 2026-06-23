# Unit Testing — Junior Level

> **Roadmap:** [Testing](../README.md) → Unit Testing
>
> *Your first safety net: prove one piece of code does what you claim, in milliseconds, every time.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What a Unit Test Actually Is](#core-concept-1--what-a-unit-test-actually-is)
5. [Core Concept 2 — Your First Test (AAA)](#core-concept-2--your-first-test-aaa)
6. [Core Concept 3 — Naming Tests as Specifications](#core-concept-3--naming-tests-as-specifications)
7. [Core Concept 4 — One Logical Assertion per Test](#core-concept-4--one-logical-assertion-per-test)
8. [Core Concept 5 — Testing the Unhappy Path](#core-concept-5--testing-the-unhappy-path)
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

> Focus: **writing a single, fast, deterministic test that checks one piece of behavior — and structuring it so anyone can read it.**

A unit test takes one small piece of your code, feeds it a known input, and checks that the output is what you expect. That's the whole idea. It does not touch a database, a network, the filesystem, or the system clock. It runs in **milliseconds**, so you can run thousands of them on every save.

Unit tests are the **base of the test pyramid** — the widest, fastest, cheapest layer. You will write far more of them than any other kind of test, because they pin down behavior at the level where bugs are born. The layers above them (integration, end-to-end) are covered in [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/).

This level teaches you to write your first tests and structure them well. The deeper debates — what counts as a "unit," when to use mocks, what makes a test *good* — come in the middle and senior tiers.

---

## Prerequisites

- You can write and run a function in at least one language (Go, Java, Python, JS/TS, or Rust).
- You know how to run a command in a terminal (`go test`, `pytest`, `npm test`, `mvn test`, `cargo test`).
- You understand functions, return values, and exceptions/errors.
- Helpful but not required: a code editor that can run tests inline.

---

## Glossary

| Term | Meaning |
|---|---|
| **Unit test** | A test of one small piece of behavior in isolation — fast, deterministic, no external systems. |
| **Unit** | The thing under test: a function, a method, or a small cluster of code that does one job. |
| **System under test (SUT)** | The specific code a test is exercising. |
| **AAA** | Arrange-Act-Assert: the three phases of a clear test. |
| **Assertion** | A check that fails the test if it's not true (`assertEqual`, `expect(x).toBe(y)`). |
| **Deterministic** | Same input → same result, every run, on every machine. |
| **Happy path** | The normal, expected flow where nothing goes wrong. |
| **Edge case** | An unusual but valid input (empty list, zero, max value, negative). |
| **Test suite** | The full collection of tests for a project. |
| **Green / red** | A passing test is "green"; a failing test is "red." |

---

## Core Concept 1 — What a Unit Test Actually Is

A unit test has four non-negotiable properties:

1. **Isolated** — it tests one unit, not the whole app. If the database is down, your unit test should still pass.
2. **Fast** — milliseconds. A thousand of them should finish in seconds, not minutes.
3. **Deterministic** — it passes or fails for the same reason every time. No "passes on my machine," no "fails every third run."
4. **Self-checking** — it asserts the result automatically. You never read the output by eye to decide pass/fail.

The fastest way to recognize a *non*-unit test is to look for these:

```text
❌ Opens a real database connection
❌ Makes an HTTP request to a real server
❌ Reads or writes a file on disk
❌ Calls time.Now() / new Date() and depends on the result
❌ Sleeps, waits for a timer, or depends on thread scheduling
```

Any of those make the test slow, flaky, or environment-dependent — the opposite of a unit test. (How to *replace* those dependencies in a test is the job of [test doubles](../10-test-doubles-mocks-fakes/), covered later.)

A useful first rule: **if a function takes inputs and returns outputs with no side effects, it is the easiest thing in the world to unit-test.** Pure functions are where you start.

```go
// Easy to test: input in, output out, nothing external.
func Discount(price, percentOff float64) float64 {
    return price * (1 - percentOff/100)
}
```

---

## Core Concept 2 — Your First Test (AAA)

Every clean test has three phases. The pattern is called **Arrange-Act-Assert (AAA)** (some teams say **Given-When-Then** — same idea):

- **Arrange** — set up the inputs and the thing under test.
- **Act** — call the one method you're testing.
- **Assert** — check the result.

Here it is in Go:

```go
package pricing

import "testing"

func TestDiscount_TakesPercentOff(t *testing.T) {
    // Arrange
    price := 200.0
    percentOff := 25.0

    // Act
    got := Discount(price, percentOff)

    // Assert
    want := 150.0
    if got != want {
        t.Errorf("Discount(%v, %v) = %v; want %v", price, percentOff, got, want)
    }
}
```

The same test in Python with `pytest`:

```python
from pricing import discount

def test_discount_takes_percent_off():
    # Arrange
    price, percent_off = 200.0, 25.0
    # Act
    result = discount(price, percent_off)
    # Assert
    assert result == 150.0
```

And in JavaScript/TypeScript with Jest or Vitest:

```ts
import { discount } from "./pricing";

describe("discount", () => {
  it("takes the percentage off the price", () => {
    // Arrange
    const price = 200, percentOff = 25;
    // Act
    const result = discount(price, percentOff);
    // Assert
    expect(result).toBe(150);
  });
});
```

Notice the shape is identical across languages. The tool changes; the discipline doesn't. Keep a blank line between the three phases so the structure is visible at a glance.

---

## Core Concept 3 — Naming Tests as Specifications

A test name should read like a sentence describing the behavior. When the test fails, the **name alone** should tell you what broke — without opening the test body.

Compare:

```text
❌ TestDiscount1
❌ test_it_works
❌ testCalc

✅ TestDiscount_TakesPercentOffPrice
✅ test_discount_of_100_percent_returns_zero
✅ "returns the original price when percentOff is 0"
```

A name that reads as a specification follows a pattern like **`Method_Scenario_ExpectedResult`** or **`it("does X when Y")`**. Examples:

```java
@Test
void withdraw_failsWhenBalanceIsInsufficient() { ... }

@Test
void parse_returnsErrorForEmptyInput() { ... }
```

Your growing list of test names becomes living documentation of what the code is supposed to do. Run the suite with verbose output and you should be able to read the behavior of the whole module like a checklist.

---

## Core Concept 4 — One Logical Assertion per Test

Each test should verify **one behavior**. That doesn't mean literally one `assert` line — it means one *reason to fail*. If a test can fail for three unrelated reasons, a failure tells you almost nothing.

```python
# ❌ Three behaviors crammed into one test — which one broke?
def test_user():
    u = create_user("ann", "ann@x.com")
    assert u.name == "ann"
    assert u.email == "ann@x.com"
    assert u.is_active is True
    assert u.created_at is not None
```

```python
# ✅ One behavior per test — a failure points straight at the cause
def test_create_user_sets_name():
    assert create_user("ann", "ann@x.com").name == "ann"

def test_create_user_starts_active():
    assert create_user("ann", "ann@x.com").is_active is True
```

It's fine for one logical assertion to span several lines (e.g. checking all fields of one returned object). The rule is about **conceptual focus**, not line count. When you see a test with checks on five unrelated things, that's a smell called *assertion roulette* — covered at the senior level.

---

## Core Concept 5 — Testing the Unhappy Path

Beginners test that code works when everything is fine. The bugs that reach production live in the cases you *didn't* test: empty input, zero, negative numbers, nulls, the maximum value, the error branch.

For every function, ask: **what are the boundaries and the failure cases?**

```go
func TestDiscount_HundredPercentIsFree(t *testing.T) {
    if got := Discount(50, 100); got != 0 {
        t.Errorf("100%% off should be free; got %v", got)
    }
}

func TestDiscount_ZeroPercentLeavesPriceUnchanged(t *testing.T) {
    if got := Discount(50, 0); got != 50 {
        t.Errorf("0%% off should not change price; got %v", got)
    }
}
```

And the error path — in Python:

```python
import pytest
from bank import Account

def test_withdraw_more_than_balance_raises():
    acct = Account(balance=100)
    with pytest.raises(InsufficientFundsError):
        acct.withdraw(150)
```

A function with three branches (normal, empty, error) needs at least three tests. The happy path alone is a comfortable illusion.

---

## Real-World Examples

**1. A validation helper.** You write `is_valid_email(s)`. The happy-path test (`"a@b.com"` → true) is obvious. The bugs hide in `""`, `"a@"`, `"@b.com"`, `"a@b@c"`, and a 10,000-character string. Each becomes a one-line test; together they pin the function's real contract.

**2. A bug report becomes a test.** A user reports that a 100% discount charges the full price. Before fixing, you write `TestDiscount_HundredPercentIsFree`. It fails (red). You fix the code. It passes (green). Now that bug **can never come back silently** — the test guards it forever. This is the single most valuable habit a junior can build.

**3. Refactoring with confidence.** You want to rewrite a messy `discount` function. With tests in place, you change the code and rerun: still green means behavior is preserved. Without tests, you're guessing. Tests turn "I think this still works" into "I know this still works."

---

## Mental Models

- **A test is a tiny experiment.** Set up conditions, run one thing, check the outcome. That's the scientific method in 10 lines.
- **Tests are executable documentation.** The test names tell you what the code does; the bodies show you how to call it.
- **Red means stop.** A failing test is a hand on your shoulder. Don't suppress it, don't comment it out — understand it.
- **Speed is a feature.** Slow tests get skipped. A test you don't run protects nothing. Keep units in milliseconds.

---

## Common Mistakes

| Mistake | Why it hurts | Fix |
|---|---|---|
| Only testing the happy path | Real bugs are in edge/error cases | Test empty, zero, null, max, and the error branch |
| Vague names (`test1`, `testWorks`) | A failure tells you nothing | Name = `Method_Scenario_Result` |
| Reading output by eye | Not self-checking; not repeatable | Always use an assertion |
| One giant test for everything | Can't tell what broke | One behavior per test |
| Tests that hit a DB or network | Slow and flaky — not unit tests | Test pure logic; isolate dependencies later |
| Depending on `time.Now()` / random | Non-deterministic, fails randomly | Pass time/seed in as a parameter |

---

## Test Yourself

1. List the four properties every unit test must have.
2. What do the three letters in **AAA** stand for?
3. Why is a test that calls a real database not a unit test?
4. Rewrite `testCalc` as a specification-style name for a function that adds tax.
5. A function returns `[]` for empty input, results for valid input, and throws for null. How many tests does it need, minimum?
6. What does "self-checking" mean, and why does it matter?

---

## Cheat Sheet

```text
A UNIT TEST IS:    isolated · fast (ms) · deterministic · self-checking

STRUCTURE (AAA):   Arrange → Act → Assert  (blank line between each)

NAMING:            Method_Scenario_ExpectedResult
                   it("does X when Y")

ONE TEST =         one reason to fail

ALWAYS TEST:       happy path + empty + zero + null + max + error branch

NEVER (in a unit): real DB · network · disk · clock · sleep · randomness

WORKFLOW:          write test → red → write code → green → refactor
```

| Language | Run command | Assertion |
|---|---|---|
| Go | `go test ./...` | `if got != want { t.Errorf(...) }` |
| Python | `pytest` | `assert x == y` |
| JS/TS | `npm test` | `expect(x).toBe(y)` |
| Java | `mvn test` | `assertThat(x).isEqualTo(y)` |
| Rust | `cargo test` | `assert_eq!(x, y)` |

---

## Summary

A unit test checks **one piece of behavior** in **isolation**, runs in **milliseconds**, and gives the **same answer every time**. Structure it with **Arrange-Act-Assert**, name it like a **specification**, keep it to **one reason to fail**, and never let it touch a real database, network, clock, or disk. Test the **unhappy path** — empty, zero, null, and error cases — because that's where bugs live. Turn every bug report into a test before you fix it. Master these basics and you have the foundation the entire test pyramid stands on.

---

## Further Reading

- The `unit-testing-patterns` skill — structuring, naming, and isolating test cases.
- The `test-driven-development` skill — red → green → refactor as a workflow.
- Kent Beck, *Test-Driven Development: By Example* — the canonical introduction.
- Your language's testing docs: Go `testing`, pytest, Jest/Vitest, JUnit 5, Rust `#[test]`.

---

## Related Topics

- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — where unit tests sit and how many to write.
- [Integration Testing](../03-integration-testing/) — the next layer up, with real dependencies.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/) — how to isolate code that *does* touch external systems.
- [Code Coverage](../../code-coverage/) — measuring how much of your code the tests exercise.
- **Next:** [Unit Testing — Middle Level](middle.md).
