# Unit Testing — Middle Level

> **Roadmap:** [Testing](../README.md) → Unit Testing
>
> *What is a "unit"? Classical vs mockist, table-driven tests, and the discipline of testing behavior instead of implementation.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What Counts as a "Unit": Classical vs Mockist](#core-concept-1--what-counts-as-a-unit-classical-vs-mockist)
5. [Core Concept 2 — Table-Driven and Parameterized Tests](#core-concept-2--table-driven-and-parameterized-tests)
6. [Core Concept 3 — Test Behavior, Not Implementation](#core-concept-3--test-behavior-not-implementation)
7. [Core Concept 4 — A Brittle Test, Made Resilient](#core-concept-4--a-brittle-test-made-resilient)
8. [Core Concept 5 — Fixtures, Setup, and Test Independence](#core-concept-5--fixtures-setup-and-test-independence)
9. [Core Concept 6 — Asserting on State vs Interactions](#core-concept-6--asserting-on-state-vs-interactions)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **deciding what a unit *is*, writing dense parameterized tests, and asserting on observable behavior so your tests survive a refactor.**

At the junior level you wrote tests that check one input/output pair. Now you confront the question that splits the testing world in half: **what exactly is a "unit"?** Is it a single class with everything around it mocked, or a slice of behavior that may span several real classes? Your answer shapes every test you write and decides whether your suite helps or fights you during refactoring.

This tier covers the classical/mockist debate, the parameterized patterns that let one test cover dozens of cases, and the single most important skill in unit testing: **testing observable behavior rather than internal mechanics.** Tests that restate the implementation break on every refactor; tests that assert behavior survive.

---

## Prerequisites

- Comfortable with the junior tier: AAA, naming, one reason to fail, edge cases.
- You can write tests in at least one language and run them in your editor.
- You know what an interface/abstract class is and how dependency injection passes collaborators in.
- Basic familiarity with the word "mock" (the rigorous treatment is in [Test Doubles](../10-test-doubles-mocks-fakes/)).

---

## Glossary

| Term | Meaning |
|---|---|
| **Classical / Detroit / Chicago school** | A "unit" is a unit of *behavior*; use real collaborators, isolate only at the test-suite level (shared state). |
| **Mockist / London school** | A "unit" is a single *class*; mock every collaborator so the SUT is tested truly alone. |
| **Collaborator** | Another object the unit under test depends on. |
| **Table-driven test** | One test function iterating over a slice/array of input→expected cases (Go idiom). |
| **Parameterized test** | Same idea via framework annotations (`@ParameterizedTest`, `@pytest.mark.parametrize`). |
| **Fixture** | Reusable setup/teardown for tests (pytest `@fixture`, JUnit `@BeforeEach`). |
| **State verification** | Asserting on the SUT's output or resulting state. |
| **Interaction verification** | Asserting that the SUT called a collaborator in a certain way. |
| **Brittle / fragile test** | A test that breaks when behavior is unchanged but code is rearranged. |
| **Resistance to refactoring** | A test's ability to *not* break during a behavior-preserving change. |

---

## Core Concept 1 — What Counts as a "Unit": Classical vs Mockist

There are two long-standing answers, and the debate is older than most frameworks you use.

**The classical school (Detroit / Chicago, "state-based").** A unit is a *unit of behavior*. The test may exercise several real classes together as long as the cluster is fast and has no out-of-process dependency. You replace only **shared, mutable, or slow** dependencies (a database, the clock). Two real collaborators talking to each other inside one test is fine — even desirable.

**The mockist school (London, "interaction-based").** A unit is a single *class*. Every collaborator is replaced with a mock, so the SUT is tested in genuine isolation. Tests verify the *interactions* between the SUT and its (mocked) neighbors.

```text
                CLASSICAL                         MOCKIST
   ┌─────────────────────────────┐    ┌─────────────────────────────┐
   │  [Order]──▶[PriceCalc]──▶[$] │    │  [Order]──▶(mock PriceCalc)  │
   │   real       real            │    │   real      verify .calc()  │
   │  assert on final result      │    │   was called with X         │
   └─────────────────────────────┘    └─────────────────────────────┘
   tests BEHAVIOR of a slice           tests one class in isolation
```

What each buys you:

| | Classical | Mockist |
|---|---|---|
| Failure localization | Coarser — a failure may be in any class in the slice | Precise — points at one class |
| Resistance to refactoring | **High** — internal restructuring doesn't break tests | **Lower** — tests know the call shape |
| Coupling to implementation | Low | High (mocks encode *how* the SUT collaborates) |
| Speed of running | Fast (collaborators are real but in-memory) | Fast |
| Design feedback | Less | More — pain from setup nudges you toward smaller classes |

The pragmatic middle ground (Khorikov's recommendation, and the one this roadmap takes): **default to classical**, use real collaborators when they're in-memory and fast, and reserve mocks for **out-of-process, shared dependencies** that you don't own — the unmanaged ones (a payment gateway, an email service). Mocking a same-process, owned collaborator usually couples your test to the implementation. The full taxonomy of doubles lives in [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/), and the strategy of *when* to reach for each is in the `mocking-strategies` skill.

---

## Core Concept 2 — Table-Driven and Parameterized Tests

When one behavior has many input cases, don't copy-paste a test five times. Drive a single test from a table of cases. This is the dominant idiom in Go and has direct equivalents everywhere.

**Go — table-driven with subtests:**

```go
func TestDiscount(t *testing.T) {
    tests := []struct {
        name       string
        price      float64
        percentOff float64
        want       float64
    }{
        {"no discount", 100, 0, 100},
        {"quarter off", 200, 25, 150},
        {"fully free", 50, 100, 0},
        {"fractional", 99.99, 10, 89.991},
    }
    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            got := Discount(tc.price, tc.percentOff)
            if got != tc.want {
                t.Errorf("Discount(%v, %v) = %v; want %v",
                    tc.price, tc.percentOff, got, tc.want)
            }
        })
    }
}
```

Each row becomes a named subtest (`TestDiscount/quarter_off`), so a failure tells you exactly which case broke, and adding a case is a one-line change.

**Python — `pytest.mark.parametrize`:**

```python
import pytest
from pricing import discount

@pytest.mark.parametrize("price, percent_off, expected", [
    (100, 0, 100),
    (200, 25, 150),
    (50, 100, 0),
    (99.99, 10, 89.991),
])
def test_discount(price, percent_off, expected):
    assert discount(price, percent_off) == pytest.approx(expected)
```

**Java — JUnit 5 `@ParameterizedTest`:**

```java
@ParameterizedTest(name = "{0}% off {1} = {2}")
@CsvSource({
    "0,   100, 100",
    "25,  200, 150",
    "100, 50,  0",
})
void discount(double percentOff, double price, double expected) {
    assertThat(Discount.apply(price, percentOff)).isEqualTo(expected);
}
```

Use a table when cases differ only in **data**. When cases differ in **setup or logic**, keep them as separate tests — forcing dissimilar cases into one table produces a tangle of conditional fields that's harder to read than the duplication it replaced.

---

## Core Concept 3 — Test Behavior, Not Implementation

This is the principle that separates a suite that helps you from one that holds you hostage.

**Assert on what the code *does* (observable output or state), not on *how* it does it (internal calls, private fields, intermediate steps).**

A test couples to the implementation when it:

- Calls or asserts on private methods.
- Verifies that an internal helper was invoked.
- Checks intermediate values that aren't part of the contract.
- Mocks a collaborator the SUT owns, then asserts the call shape.

Why it matters: the entire point of tests is that they let you **refactor fearlessly**. Refactoring changes the *how* while preserving the *what*. If your tests assert on the *how*, every refactor turns them red even though nothing is broken — so you either stop refactoring or stop trusting the tests. Both are disasters.

The litmus test: **"If I restructure the internals without changing behavior, does this test still pass?"** If no, the test is coupled to implementation.

Test through the **public API**. Treat the unit as a black box with a contract. Inputs in, outputs out, observable state changes checked. Private methods get tested *indirectly* through the public behavior that uses them — and if a private method is so complex it "needs" its own test, that's a signal it wants to become its own public unit elsewhere.

---

## Core Concept 4 — A Brittle Test, Made Resilient

Concretely, here's an implementation-coupled test and its resilient rewrite.

**❌ Brittle — couples to internal calls and private structure:**

```java
@Test
void placeOrder_brittle() {
    InventoryService inventory = mock(InventoryService.class);
    PricingEngine pricing = mock(PricingEngine.class);
    AuditLog audit = mock(AuditLog.class);
    OrderService service = new OrderService(inventory, pricing, audit);

    when(pricing.calculate(any())).thenReturn(150.0);

    service.placeOrder(new Order("widget", 2));

    // Asserting on HOW the work was done — internal call sequence:
    verify(inventory).reserve("widget", 2);
    verify(pricing).calculate(any());
    verify(audit).record(anyString());           // owned, in-process — over-mocked
    verifyNoMoreInteractions(inventory, pricing); // freezes the implementation
}
```

This test breaks the moment you rename a method, reorder two internal calls, or add a new (harmless) internal step — none of which changes what `placeOrder` *does*. It's a copy of the implementation written in mock syntax.

**✅ Resilient — uses real in-process collaborators, asserts on outcome:**

```java
@Test
void placeOrder_reservesStockAndReturnsTotal() {
    var inventory = new InMemoryInventory(Map.of("widget", 10)); // fake, in-process
    var pricing   = new PricingEngine();                          // real
    var service   = new OrderService(inventory, pricing, new NoopAuditLog());

    Receipt receipt = service.placeOrder(new Order("widget", 2));

    // Assert on OBSERVABLE behavior:
    assertThat(receipt.total()).isEqualTo(150.0);     // output
    assertThat(inventory.available("widget")).isEqualTo(8); // resulting state
}
```

The resilient version says *what the order placement accomplishes* — stock reserved, total returned — and is silent about the internal choreography. Rename `reserve` to `decrement`, reorder steps, inline a helper: the test stays green. It only fails if the **behavior** changes, which is exactly when you want it to. (`AuditLog`, an unmanaged side-effect dependency, *would* be a legitimate mock — but you'd assert on its message as a contract, not freeze every interaction.)

---

## Core Concept 5 — Fixtures, Setup, and Test Independence

Tests must be **independent**: any test, in any order, alone or with others, gives the same result. Shared mutable state between tests is the root of most "passes alone, fails in the suite" flakiness.

Use fixtures to build fresh state per test, not to share it:

```python
import pytest

@pytest.fixture
def account():
    return Account(balance=100)   # fresh instance for every test that asks

def test_withdraw_reduces_balance(account):
    account.withdraw(30)
    assert account.balance == 70

def test_overdraw_raises(account):
    with pytest.raises(InsufficientFundsError):
        account.withdraw(150)
```

```java
class AccountTest {
    private Account account;

    @BeforeEach
    void setUp() {            // runs before EACH test → fresh state
        account = new Account(100);
    }
    // ...
}
```

Keep setup minimal. Heavy, shared setup ("excessive setup") is a smell: it usually means the SUT has too many dependencies, or you're testing too much at once. If two tests need wildly different setup, don't force a shared fixture — the divergence is telling you they test different things.

---

## Core Concept 6 — Asserting on State vs Interactions

Two ways to verify a test passed:

- **State verification** — call the SUT, then inspect its return value or resulting state. *"After withdraw(30), balance is 70."*
- **Interaction verification** — assert the SUT called a collaborator in a specific way. *"withdraw() called repository.save() exactly once."*

Prefer **state verification**. It's the natural fit for the classical school and is far more resistant to refactoring, because state is part of the observable contract while internal call patterns usually aren't.

Reach for **interaction verification** only when the *interaction itself is the behavior under test* and the collaborator is an unmanaged, out-of-process dependency:

```python
def test_password_reset_sends_one_email(mailer_spy):
    service = PasswordResetService(mailer_spy)
    service.reset("user@example.com")
    # The OBSERVABLE behavior IS "an email is sent" — verifying it is correct.
    assert mailer_spy.sent == [("user@example.com", "Reset your password")]
```

Sending the email is the externally observable outcome — there's no return value or state to check, so the interaction *is* the contract. That's legitimate. Verifying that an internal, owned helper was called is not. The decision rule and the spy/mock vocabulary are detailed in the `mocking-strategies` skill and [Test Doubles](../10-test-doubles-mocks-fakes/).

---

## Real-World Examples

**1. A migration that should have been painless.** A team rewrote a `TaxCalculator`'s internals for performance. Half their tests were mockist, asserting the old internal call sequence. The rewrite — behavior-identical — turned 40 tests red. They spent two days "fixing" tests that were never testing real behavior. A classical, state-based suite would have stayed green and *confirmed* the rewrite was safe. This is the cost of over-specified tests.

**2. The same bug, two suites.** A pricing rule had an off-by-one in the loyalty discount. The classical suite (real collaborators, assert on final price) caught it instantly — the total was wrong. The mockist suite was *green*, because each class was mocked to return the canned value the test expected; the wiring bug lived in the gaps between the mocks. Mocks can hide integration defects inside a "unit."

**3. Parameterization saving a contract.** A validation function had 14 documented rules. Expressed as a 14-row parameterized table, the rules became a readable spec, and adding the 15th rule was a one-line diff plus its implementation — reviewers could see the new behavior in the test table alone.

---

## Mental Models

- **Black box, not glass box.** Test through the public contract; refuse to peek at internals.
- **The refactor test.** Before writing an assertion, ask: "would this break if I restructured the code without changing behavior?" If yes, it's the wrong assertion.
- **Mocks are coupling.** Each mock is a hard-coded assumption about *how* your code talks to its neighbors. Every assumption is a future break.
- **A unit is a unit of behavior.** Not a class. Not a method. The smallest slice of *behavior* you can verify quickly and deterministically.

---

## Common Mistakes

| Mistake | Why it hurts | Fix |
|---|---|---|
| Mocking owned, in-process collaborators | Couples tests to implementation; hides wiring bugs | Use real or in-memory fakes; mock only unmanaged out-of-process deps |
| Asserting on private methods / fields | Breaks on every refactor | Test through the public API |
| `verifyNoMoreInteractions` everywhere | Freezes the implementation in place | Assert on outcome, not exhaustive call lists |
| Forcing dissimilar cases into one table | Conditional fields, unreadable | Separate tests when setup/logic differs |
| Shared mutable fixture across tests | Order-dependent flakiness | Fresh state per test |
| Over-specified mocks during a migration | Behavior-preserving rewrite turns suite red | Prefer state verification |

---

## Test Yourself

1. Define "unit" the classical way and the mockist way. What does each definition buy and cost?
2. When is mocking a collaborator the *right* call, and when is it a smell?
3. Give a concrete assertion that is coupled to implementation, and rewrite it to assert behavior.
4. Why can a fully mockist "unit" suite be green while a real wiring bug ships?
5. When should many cases live in one parameterized table, and when should they be separate tests?
6. State the one-sentence litmus test for whether an assertion will survive a refactor.

---

## Cheat Sheet

```text
"UNIT" =
  classical → a unit of BEHAVIOR (real collaborators, isolate shared deps)
  mockist   → a single CLASS    (mock all collaborators, verify calls)
  default   → classical; mock only UNMANAGED out-of-process deps

TEST BEHAVIOR, NOT IMPLEMENTATION
  ✅ assert output / resulting state   ❌ assert private calls / internal steps
  litmus: "survives a behavior-preserving refactor?"  → if no, rewrite

VERIFICATION
  state  → preferred (output / resulting state)
  interaction → only when the interaction IS the observable behavior

DATA-DRIVEN
  Go     table + t.Run(name, ...)
  py     @pytest.mark.parametrize
  Java   @ParameterizedTest + @CsvSource/@MethodSource

INDEPENDENCE
  fresh state per test · no shared mutable fixtures · order-agnostic
```

---

## Summary

The defining question of this tier is **what a unit is**. The classical school says a unit is a slice of *behavior* tested with real collaborators; the mockist school says it's a single *class* with everything mocked. Default to classical, and reserve mocks for unmanaged out-of-process dependencies — because mocks are coupling, and over-mocking both hides wiring bugs and makes refactoring painful. Drive many input cases from **parameterized tables**, keep tests **independent** with fresh fixtures, and above all **test behavior, not implementation**: assert on observable output and state through the public API, so your tests survive a refactor instead of fighting it. That single discipline is what makes a test suite an asset rather than a liability.

---

## Further Reading

- Vladimir Khorikov, *Unit Testing: Principles, Practices, and Patterns* — the classical-vs-mockist treatment.
- Martin Fowler, "Mocks Aren't Stubs" — the foundational essay on the two schools.
- The `unit-testing-patterns` and `mocking-strategies` skills.
- Go blog, "Using Subtests and Sub-benchmarks"; pytest parametrize docs; JUnit 5 parameterized-test guide.

---

## Related Topics

- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/) — the full double taxonomy and when each is appropriate.
- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — balancing unit against higher levels.
- [Integration Testing](../03-integration-testing/) — verifying the wiring that classical units leave to the next layer.
- [Property-Based Testing](../06-property-based-testing/) — generating cases instead of enumerating them in a table.
- [Code Coverage](../../code-coverage/) — measuring what the suite exercises.
- **Next:** [Unit Testing — Senior Level](senior.md).
