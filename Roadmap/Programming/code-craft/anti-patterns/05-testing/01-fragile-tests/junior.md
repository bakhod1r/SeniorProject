# Fragile Tests — Junior Level

> **Category:** [Testing Anti-Patterns](../README.md) → **Fragile Tests** — *a test that breaks when you change code without changing its behavior.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [What "Fragile" Means](#what-fragile-means)
4. [The Pain: Refactor → Red for No Reason](#the-pain-refactor--red-for-no-reason)
5. [Side by Side: Brittle vs Robust](#side-by-side-brittle-vs-robust)
6. [The Four Ways Tests Couple to Internals](#the-four-ways-tests-couple-to-internals)
7. [Why It's Bad](#why-its-bad)
8. [The Junior-Level Fix](#the-junior-level-fix)
9. [Common Mistakes](#common-mistakes)
10. [Test Yourself](#test-yourself)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What does a fragile test look like?** and **Why is it bad?**

A test exists to answer one question: *does this code still do what it's supposed to do?* A **fragile test** (also called *brittle* or *over-specified*) breaks the deal. It goes red not because the code's behavior changed, but because you renamed a private field, reordered two method calls, changed a log message, or split one function into two. The behavior is identical — the user sees the same result — yet the test screams failure.

That mismatch is the whole problem. When a test fails, it should mean *"you broke something."* A fragile test instead means *"you touched something,"* and those are not the same. After enough false alarms, people stop believing the red. They edit the test to make it pass without thinking, or they delete it, or they stop running the suite. A fragile test slowly converts your safety net into noise.

The root cause is always the same: **the test is checking *how* the code works instead of *what* it does.** It reaches inside the implementation — private state, exact call sequences, the order of JSON keys — and pins those details in place. So the moment you improve the implementation without changing the result, the pins snap.

At the junior level your goal is to **recognize a fragile test on sight** and to **write tests that survive a refactor.** You don't need to fix a whole suite yet — that's `senior.md`. You need to stop writing tests that break for no reason.

> **The mindset shift:** a good test is a contract about *observable behavior*. A refactor that preserves behavior should leave every good test green. If a behavior-preserving change turns a test red, the test — not the code — is usually wrong.

---

## Prerequisites

- **Required:** You can write a basic unit test in at least one framework (examples here use Go `testing`/`testify`, Java JUnit 5/AssertJ, and Python `pytest`).
- **Required:** You understand the difference between a function's *public API* (what callers see) and its *implementation* (how it does the work internally).
- **Helpful:** You've done at least one refactor — renamed a method, extracted a function, reordered code — and felt the friction of tests breaking afterward. That friction is what this topic explains.
- **Helpful:** Basic familiarity with mocks/stubs (we touch them here; [over-mocking](../06-over-mocking/junior.md) is the deep dive).

---

## What "Fragile" Means

A test has two reasons it can legitimately fail:

1. **The behavior changed** — and that change is wrong. *This is the failure you want.*
2. **The behavior changed** — and that change is intended. *You update the test on purpose; fair.*

A **fragile** test adds a third, illegitimate reason:

3. **The behavior did *not* change** — but the test broke anyway, because it was coupled to an implementation detail you altered.

Reason 3 is pure cost. It produces no signal, only work: you re-read the test, confirm nothing actually broke, and edit it back to green. Multiply that across a suite and across a team, and fragile tests become the single biggest reason developers stop trusting — and stop running — their tests.

> **One-line definition:** a fragile test fails for reason 3. It couples to *how* the code works, so a behavior-preserving change makes it red.

---

## The Pain: Refactor → Red for No Reason

Here is the experience, start to finish. You have a working function and a passing test. You decide to clean up the implementation — a textbook behavior-preserving refactor:

```python
# Before — the implementation builds the greeting in two steps.
def greet(name):
    prefix = "Hello, "
    return prefix + name + "!"
```

You refactor it to use an f-string. **Same input, same output** — `greet("Sam")` still returns `"Hello, Sam!"`:

```python
# After — cleaner, identical behavior.
def greet(name):
    return f"Hello, {name}!"
```

A *robust* test stays green:

```python
def test_greet_returns_greeting():
    assert greet("Sam") == "Hello, Sam!"   # checks the result — survives the refactor
```

But suppose someone wrote a *fragile* test that reached into the implementation:

```python
def test_greet_uses_prefix_variable(monkeypatch):
    # Asserts on HOW greet is built, not WHAT it returns.
    import inspect
    source = inspect.getsource(greet)
    assert "prefix = " in source       # ← breaks the moment you use an f-string
```

The behavior is identical, the user sees the same greeting — and the test is red. That is fragility in its purest form: **the test broke because you improved the code.** Now the developer faces a choice that should never have existed: revert a perfectly good refactor, or edit a test that was testing the wrong thing all along.

---

## Side by Side: Brittle vs Robust

The same behavior — "a `Cart` totals its line items" — tested two ways. Watch what each test couples to.

```python
class Cart:
    def __init__(self):
        self._items = []          # private: an implementation detail

    def add(self, price, qty):
        self._items.append((price, qty))

    def total(self):
        return sum(p * q for p, q in self._items)
```

**Brittle — couples to private internals:**

```python
def test_cart_brittle():
    cart = Cart()
    cart.add(10, 2)
    # Reaches into the private list and asserts on its exact shape.
    assert cart._items == [(10, 2)]        # ← breaks if we store items differently
    assert len(cart._items) == 1           # ← breaks if we coalesce duplicates
```

If tomorrow you change `_items` to a dict, or store `Decimal` instead of `int`, or coalesce duplicate prices — all behavior-preserving for `total()` — this test breaks. It pinned the *storage format*, which was never the contract.

**Robust — couples only to observable behavior:**

```python
def test_cart_robust():
    cart = Cart()
    cart.add(10, 2)
    cart.add(5, 1)
    assert cart.total() == 25      # ← the only thing a caller actually cares about
```

This test exercises the public API (`add`, `total`) and asserts on the public result. You can rewrite the entire internals of `Cart` and, as long as `total()` is correct, the test stays green. **It fails only when the behavior is actually wrong** — which is exactly what you want.

> The rule the robust test follows: *touch the object only through its public surface, and assert only on what that surface returns.*

---

## The Four Ways Tests Couple to Internals

Almost every fragile test is one of these four shapes. Learn to spot them.

| # | Couples to | Looks like | Breaks when you… |
|---|---|---|---|
| 1 | **Private state** | `assert obj._cache == {...}`, reading private fields | change the internal data structure |
| 2 | **Exact call sequence** | `verify(mock).a(); verify(mock).b()` in strict order | reorder or batch the internal calls |
| 3 | **Incidental output format** | asserting on log text, exact JSON key order, whitespace | reword a log, reorder fields, reformat |
| 4 | **Mock interactions** | asserting *that* a collaborator was called, not the outcome | replace the collaborator or skip a redundant call |

```java
// Java — shape #2 and #4 together: asserting on HOW, not WHAT.
@Test
void brittle_assertsOnInteractions() {
    OrderService svc = new OrderService(repo, mailer);
    svc.place(order);

    // These pin the exact internal choreography:
    InOrder inOrder = inOrder(repo, mailer);
    inOrder.verify(repo).beginTx();          // ← breaks if we batch saves
    inOrder.verify(repo).save(order);
    inOrder.verify(repo).commit();
    inOrder.verify(mailer).send(any());      // ← breaks if we send via an event later
}
```

The robust version asserts on the *outcome* — the order ends up persisted and confirmed — and lets the implementation choose how to get there:

```java
@Test
void robust_assertsOnOutcome() {
    OrderService svc = new OrderService(repo, mailer);

    svc.place(order);

    assertThat(repo.find(order.id())).isPresent();          // it was saved
    assertThat(order.status()).isEqualTo(Status.CONFIRMED); // it was confirmed
    // We don't care HOW many DB calls happened or in what order.
}
```

> Shapes #2 and #4 are so common they get their own topic. When a test asserts on *interactions* instead of *outcomes*, you're usually looking at [over-mocking](../06-over-mocking/junior.md) — the most frequent source of fragility in real suites.

---

## Why It's Bad

- **It punishes good work.** Refactoring — the thing we *want* engineers to do — turns the suite red. Fragile tests raise the cost of every cleanup, so cleanups stop happening and code rots.
- **It cries wolf.** A red that doesn't mean "broken" trains people to ignore red. Eventually a *real* failure hides among the false ones and ships to production.
- **It tests the wrong thing.** A test pinned to internals gives you false confidence: it's green, so you think the behavior is verified — but you've actually verified the *shape of the code*, which tells you nothing about whether it works.
- **It rots the suite.** Because each false failure costs time, people "fix" fragile tests by weakening or deleting them. The suite shrinks exactly where it was already lying to you.

The deep reason ties back to the chapter theme: **a fragile test makes the suite lie.** It flips red when nothing is wrong, and a suite you can't trust is worse than no suite — it costs maintenance and gives no safety in return.

---

## The Junior-Level Fix

Three habits, and almost all junior-level fragility disappears.

**1. Drive the code through its public API.** If your test touches a private field, a `_`-prefixed name, or uses reflection to reach internals, stop — exercise the object the way a real caller would.

```python
# Don't:  assert account._balance == 100
# Do:     assert account.balance() == 100      # public method = the actual contract
```

**2. Assert on the outcome, not the steps.** Ask: *"what would a user or caller observe?"* Assert on **that** — the return value, the resulting state visible through the public API, the response a client receives — not on which internal method ran in which order.

```go
// Go — assert the result the caller sees, not the internal choreography.
func TestTransfer(t *testing.T) {
    bank := NewBank()
    bank.Deposit("alice", 100)

    err := bank.Transfer("alice", "bob", 30)

    require.NoError(t, err)
    assert.Equal(t, 70, bank.Balance("alice"))   // observable outcome
    assert.Equal(t, 30, bank.Balance("bob"))     // observable outcome
}
```

**3. Don't assert on incidental details.** Log lines, exact error wording, JSON field order, and whitespace are usually *not* part of the contract. Assert on the *meaning* (a specific error type, a value in a parsed structure), not the surface text.

```python
# Brittle: pins the exact message string.
# with pytest.raises(ValueError, match="amount must be >= 0, got -5"): ...

# Robust: pins the error TYPE, which is the real contract.
with pytest.raises(ValueError):
    withdraw(account, -5)
```

> **Smell test:** before you write an assertion, ask *"if a teammate refactored this code without changing what it does, would this line still pass?"* If the honest answer is "no," you're about to write a fragile test.

---

## Common Mistakes

1. **Treating "any green test" as a good test.** A test pinned to internals is green *and* useless — it verifies the shape of the code, not its behavior. Coverage of internals is not coverage of behavior.
2. **Reaching for private state "to be thorough."** Asserting on `_items`, `_cache`, or private counters feels rigorous. It's the opposite: it locks the implementation and breaks on every cleanup. Test through the public door.
3. **Asserting on log output.** Logs are for humans debugging, not for tests. The exact wording is the most volatile thing in the codebase. Assert on behavior; if you must check that *something was logged*, check a structured field, not the prose.
4. **Verifying that a mock was called instead of checking the result.** `verify(mock).save()` proves a method ran, not that the right thing happened. Prefer asserting on the observable outcome; mock-call verification is a last resort (see [over-mocking](../06-over-mocking/junior.md)).
5. **Pinning JSON/serialization field order.** `assert response == '{"a":1,"b":2}'` breaks when a library reorders keys. Parse the response and assert on values, not on the byte-for-byte string.
6. **"Fixing" a fragile test by deleting it.** When a false failure annoys you, the temptation is to delete the test. Sometimes that's right (it tested nothing real) — but often you're throwing away coverage. Rewrite it to assert on behavior instead.

---

## Test Yourself

1. In one sentence, what is a fragile test? Give the "reason 3" failure that defines it.
2. A test asserts `assert cart._items == [(10, 2)]`. Why is this fragile, and how would you rewrite it?
3. You refactor a function from a `+`-concatenated string to an f-string. The behavior is identical but a test goes red. Whose fault is it — the code or the test? Why?
4. Name the four common things fragile tests couple to.
5. Rewrite this brittle test to assert on the outcome instead of the interaction:
   ```java
   @Test
   void brittle() {
       svc.register(user);
       verify(repo).save(user);        // ← asserts the call happened
       verify(mailer).send(any());     // ← asserts the call happened
   }
   ```
6. Why is a fragile test arguably *worse* than having no test at all?

<details>
<summary>Answers</summary>

1. A fragile test breaks when you change code **without changing its behavior** — it fails for "reason 3": the behavior didn't change, but the test was coupled to an implementation detail you altered.
2. It couples to **private state** (`_items`) and its exact storage shape. Change `_items` to a dict, coalesce duplicates, or use `Decimal`, and it breaks though `total()` is unaffected. Rewrite to assert on the public result: `cart.add(10, 2); assert cart.total() == 20`.
3. **The test's fault.** A behavior-preserving refactor (`+` → f-string) produced identical output. A test that goes red on it was checking *how* the string is built (implementation), not *what* `greet` returns (behavior). The fix is to assert on the return value.
4. (1) Private state, (2) exact call sequence/order, (3) incidental output format (log text, JSON key order, whitespace), (4) mock interactions (that a collaborator was called).
5. Assert on observable outcome:
   ```java
   @Test
   void robust() {
       svc.register(user);
       assertThat(repo.findByEmail(user.email())).isPresent();   // user was persisted
       assertThat(inbox.messagesFor(user.email())).hasSize(1);   // a welcome mail exists
   }
   ```
   (Using a fake `inbox`/in-memory repo instead of strict mocks decouples the test from the call choreography.)
6. With no test, you *know* a behavior is unverified. A fragile test gives **false confidence** (green means "shape unchanged," not "behavior correct") and **false alarms** (red that means "you touched it," not "you broke it"), training the team to ignore red — so a real failure can hide among the noise and ship.

</details>

---

## Cheat Sheet

| Fragile because it couples to… | Spot it by | Make it robust by |
|---|---|---|
| **Private state** | `obj._field`, reflection, reading internals | Drive through the public API; assert on public results |
| **Call sequence** | `inOrder`/strict ordered `verify` | Assert on the final outcome, not the order of steps |
| **Output format** | asserting log text, JSON key order, whitespace | Assert on parsed values and meaning, not surface text |
| **Mock interactions** | `verify(mock).x()` as the main assertion | Prefer fakes/real objects; assert observable outcome |

> **One rule to remember:** *a behavior-preserving refactor should keep every good test green. If it doesn't, the test was testing how, not what.*

---

## Summary

- A **fragile test** breaks when you change code *without changing its behavior* — it fails for "reason 3," coupling to *how* the code works instead of *what* it does.
- The pain is concrete: **refactor → red for no reason.** That false red trains people to distrust and then ignore the suite, turning a safety net into noise.
- Fragility comes from coupling to **private state, exact call order, incidental output format, or mock interactions** — pinning details that were never part of the contract.
- The junior-level cure is three habits: **drive the code through its public API, assert on the outcome not the steps, and ignore incidental details.** Then a behavior-preserving change leaves your tests green.
- Next: [`middle.md`](middle.md) — *when fragility creeps into a growing suite, and the concrete countermoves (over-specified assertions, snapshot-everything, white-box mocking) in all three languages.*

---

## Further Reading

- **xUnit Test Patterns: Refactoring Test Code** — Gerard Meszaros (2007) — the canonical catalog; see *Fragile Test*, *Overspecified Software*, and *Sensitive Equality*.
- **Refactoring** — Martin Fowler (2nd ed. 2018) — why tests must survive behavior-preserving change; the self-testing-code chapter.
- **"Test Behaviour, Not Implementation"** — Martin Fowler (martinfowler.com) and the broader writing on Solitary vs Sociable tests.
- **Working Effectively with Legacy Code** — Michael Feathers (2004) — characterization tests and testing through seams without coupling to internals.

---

## Related Topics

- [Over-Mocking](../06-over-mocking/junior.md) — the most common source of fragility: asserting on mock interactions instead of outcomes.
- [Flaky Tests](../02-flaky-tests/junior.md) — the sibling "untrustworthy suite" problem: a test that fails non-deterministically rather than on change.
- [Mystery Guest](../03-mystery-guest/junior.md) — hidden fixtures that make tests both fragile and hard to read.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — fragile tests are a code smell in test code.
- The `unit-testing-patterns` and `mocking-strategies` skills — the positive patterns fragile tests violate.
