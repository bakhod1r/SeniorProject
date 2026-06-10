# Assertion Roulette — Junior Level

> **Category:** [Testing Anti-Patterns](../README.md) → **Assertion Roulette** — *a test with many unlabelled assertions, so when one fails you cannot tell which — or why.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [What the Failure Looks Like](#what-the-failure-looks-like)
4. [Why You Can't Tell Which Assert Blew Up](#why-you-cant-tell-which-assert-blew-up)
5. [The First Fix: Give Every Assertion a Voice](#the-first-fix-give-every-assertion-a-voice)
6. [The Better Fix: Stop Cramming](#the-better-fix-stop-cramming)
7. [Fail-Fast Hides the Rest](#fail-fast-hides-the-rest)
8. [Common Mistakes](#common-mistakes)
9. [Test Yourself](#test-yourself)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What does it look like?** and **Why is it bad?**

You wrote a test. It has twelve assertions. CI goes red and prints:

```
FAIL  TestCheckout  expected true, got false   (checkout_test.go:48)
```

Line 48 is one of twelve `assert` calls in a single method. Which condition failed? *Why* did it fail? The message tells you nothing — it just says "something on line 48 wasn't true." You now open the test, re-read all twelve assertions, and start guessing. That guessing game is **Assertion Roulette**: the test fires a barrage of unlabelled assertions, and when one fails you gamble on which.

Gerard Meszaros named this smell in *xUnit Test Patterns*. The point of a test is not only to *catch* a regression but to *tell you what broke* the moment it does. A test that catches the bug but can't name it has done half its job and handed you the other half as a debugging session.

> **The mindset shift:** a failing test is a message to a future engineer — often you, at 4 p.m. on a Friday. The test's failure output is that message. If the message is "line 48 was false," the test is mumbling. Make it speak.

At the junior level your goal is to **recognize the smell** and apply the two simplest cures: **label your assertions** and **don't cram unrelated checks into one test**.

---

## Prerequisites

- **Required:** You can write a basic unit test with assertions in at least one language (examples here use Go, Java with JUnit 5, and Python with pytest).
- **Required:** You understand what an assertion is — a statement that must be true, or the test fails.
- **Helpful:** You've read a red CI log and felt the "...which line was that again?" moment. That moment is exactly what this file is about.

---

## What the Failure Looks Like

Here is a test that verifies a freshly-created user account. It looks thorough. It is, in fact, a roulette wheel.

```python
# Python + pytest — twelve bare assertions, no messages
def test_new_account():
    acct = create_account("ada@example.com", plan="pro")
    assert acct.email == "ada@example.com"
    assert acct.plan == "pro"
    assert acct.active
    assert acct.balance == 0
    assert acct.trial_days == 14
    assert acct.created_at is not None
    assert acct.id > 0
    assert not acct.suspended
    assert acct.role == "member"
    assert acct.api_quota == 1000
    assert acct.referral_code is not None
    assert acct.timezone == "UTC"
```

Now suppose `trial_days` is actually `30` because of a config bug. The run prints:

```
>       assert acct.trial_days == 14
E       assert 30 == 14
```

pytest is unusually kind here — it shows `30 == 14`. But in Go or a bare JUnit `assertTrue`, you'd often get only:

```
checkout_test.go:48: assertion failed
```

No value, no name, no clue. You're left counting `assert` statements down to line 48.

---

## Why You Can't Tell Which Assert Blew Up

Three things conspire to make the failure undiagnosable:

1. **No message.** `assertTrue(x)` and `assert x` say "this was false" — but *what* was supposed to be true, and what was the actual value? The assert threw away the context.
2. **Many checks, one location.** A dozen asserts share one test name (`TestCheckout`). The failure points at a *line*, and you have to map line → meaning by hand.
3. **The actual vs. expected is gone.** `assert acct.active` has no "expected `True`, got `False`" because there's no value to compare — just a boolean that came out wrong.

The combination is the roulette: the failure report identifies a *position*, not a *fact*. Good test output should read like a sentence — "expected the plan to be `pro` but it was `free`" — not like a coordinate.

---

## The First Fix: Give Every Assertion a Voice

The cheapest improvement, requiring zero restructuring: **attach a message** (or use a matcher that prints values). Now the failure names itself.

```java
// Java + JUnit 5 — the third argument is the failure message
@Test
void newAccountHasCorrectDefaults() {
    Account acct = createAccount("ada@example.com", "pro");
    assertEquals("ada@example.com", acct.getEmail(), "email");
    assertEquals("pro", acct.getPlan(), "plan");
    assertTrue(acct.isActive(), "account should be active");
    assertEquals(14, acct.getTrialDays(), "trial days");
}
```

If `trial days` is wrong, JUnit now prints:

```
org.opentest4j.AssertionFailedError: trial days ==> expected: <14> but was: <30>
```

That single line tells you *which* check, *what* it expected, and *what* it got. No re-reading the test.

In Go, prefer an assertion library (`testify`) over bare `if got != want { t.Fail() }`, because it prints both values and a message:

```go
// Go + testify
func TestNewAccount(t *testing.T) {
    acct := CreateAccount("ada@example.com", "pro")
    assert.Equal(t, "pro", acct.Plan, "plan")
    assert.Equal(t, 14, acct.TrialDays, "trial days")
}
// failure: "trial days: Not equal: expected: 14, actual: 30"
```

In Python, pytest already rewrites bare asserts to show values — but on `assert acct.active` there's no value to show, so add a message: `assert acct.active, "account should be active"`.

---

## The Better Fix: Stop Cramming

Messages make a roulette wheel *survivable*. But the deeper cure is to **not build the wheel**. That twelve-assert test is really verifying many independent facts; split it so each test name *is* the failure description.

```python
def test_new_account_uses_given_email():
    assert create_account("ada@example.com", plan="pro").email == "ada@example.com"

def test_new_account_starts_active():
    assert create_account("ada@example.com", plan="pro").active

def test_pro_plan_grants_14_trial_days():
    assert create_account("ada@example.com", plan="pro").trial_days == 14
```

Now a failure reads `FAILED test_pro_plan_grants_14_trial_days` — the test *name* tells you exactly what broke before you've read a single line of code. (You don't always split this far — that's the judgement `middle.md` and `senior.md` teach. The principle: **one behavior per test**.)

> **Smell test:** if a failing test makes you re-read the test body to find out what failed, it's Assertion Roulette. A good test announces its failure in its name and message.

---

## Fail-Fast Hides the Rest

There's a second, sneakier problem with the twelve-assert test. Most test frameworks are **fail-fast**: the *first* failed assertion throws and the test stops. So if both `plan` (assert #2) and `trial_days` (assert #5) are broken, you only ever see `plan`. You fix `plan`, re-run, *then* discover `trial_days` is also broken. Two round-trips for two bugs that were both visible from the start.

```python
def test_new_account():
    acct = create_account("ada@example.com", plan="pro")
    assert acct.plan == "pro"        # if this fails...
    assert acct.trial_days == 14     # ...this never runs, so you don't learn it's broken too
```

The cure here is either **splitting** (each fact in its own test, so all fail independently) or **soft assertions** that collect every failure before reporting — covered in `middle.md`. For now, just know: a long chain of asserts doesn't only obscure *which* failed, it *hides later failures entirely*.

---

## Common Mistakes

1. **Bare boolean asserts.** `assertTrue(acct.isActive())` discards the most useful info. Prefer `assertEquals`/matchers that print actual-vs-expected, or at minimum add a message.
2. **Treating the message as optional.** "I'll know which line it was." You won't, six months from now, at 4 p.m. Write the message when you write the assert — it costs five seconds.
3. **One giant test named after a feature, not a behavior.** `testCheckout` with 15 asserts is a roulette wheel. `testCheckoutRejectsExpiredCard` names a behavior and fails legibly.
4. **Confusing "more assertions" with "more thorough."** Coverage comes from *cases*, not from stacking asserts in one method. Twelve asserts in one test ≈ one test's worth of diagnostic value.
5. **Believing pytest saves you.** pytest's assert-rewriting helps for `==`, but `assert x` on a plain boolean still prints nothing useful. The smell is language-independent.

---

## Test Yourself

1. What is Assertion Roulette, in one sentence?
2. CI prints `assertion failed (user_test.go:31)` and line 31 is one of nine asserts. Name two changes that would make this failure diagnosable.
3. Why does a bare `assertTrue(x)` produce worse output than `assertEquals(expected, actual)`?
4. A test has two broken assertions but you only see the first one fail. Why? Name one cure.
5. Add a failure message to: `assert order.total == 4200`.

<details>
<summary>Answers</summary>

1. A test with many unlabelled assertions, so when one fails you can't tell which one — or why.
2. (a) Add a descriptive message to each assertion (or use a matcher that prints expected-vs-actual). (b) Split the test so each behavior is its own named test, so the failing test's *name* identifies the failure.
3. `assertTrue(x)` only knows `x` was false — it has no expected/actual values to show, so it prints "assertion failed." `assertEquals` knows both the expected and actual value and prints `expected: <14> but was: <30>`, which names the discrepancy.
4. The framework is **fail-fast**: the first failed assertion throws and the test halts, so later assertions never run. Cures: split into separate tests (each fails independently), or use **soft assertions** that collect all failures.
5. `assert order.total == 4200, f"order total expected 4200, got {order.total}"`

</details>

---

## Cheat Sheet

| Symptom | What it is | First cure |
|---|---|---|
| Failure says "line N", not what broke | Assertion Roulette | Add a message to every assert |
| `assertTrue(x)` with no context | Lost actual-vs-expected | Use `assertEquals`/matchers that print values |
| 12 asserts under one test name | Eager Test / roulette | Split into one-behavior-per-test |
| Second bug invisible until you fix the first | Fail-fast masking | Split, or use soft assertions |

> **One rule to remember:** *a failing test should announce what broke in its name and message — never make a future engineer re-read the body to find out.*

---

## Summary

- **Assertion Roulette** is a test packed with many unlabelled assertions; when one fails, the report names a *line*, not a *fact*, so you gamble on which assert blew up.
- The failure is undiagnosable because there's **no message**, **many checks share one test name**, and **bare booleans lose actual-vs-expected**.
- **Cheapest cure:** give every assertion a message, or use a matcher that prints values (`assertEquals`, testify, pytest's rich asserts).
- **Deeper cure:** stop cramming — one behavior per test, so the test *name* is the failure description.
- **Fail-fast** frameworks also *hide* later failures behind the first one — another reason to split or use soft assertions.
- Next: [`middle.md`](middle.md) — *the causes (the Eager Test smell), and what to do instead, with examples in all three languages.*

---

## Further Reading

- **xUnit Test Patterns: Refactoring Test Code** — Gerard Meszaros (2007) — the smells *Assertion Roulette* and *Eager Test*; the patterns *Verify One Condition per Test* and *Assertion Message*.
- **Clean Code** — Robert C. Martin (2008) — Chapter 9, "Unit Tests": one assert / single concept per test.
- **JUnit 5 User Guide** — assertion messages and `assertAll` (soft assertions).
- **pytest documentation** — assertion introspection and the `pytest.fail`/`-r` failure reporting.

---

## Related Topics

- [Fragile Tests](../01-fragile-tests/junior.md) — the sibling smell: tests that break when behavior didn't change.
- [Slow Tests](../05-slow-tests/junior.md) — another reason a suite stops being trusted.
- [Mystery Guest](../03-mystery-guest/junior.md) — when a test depends on data you can't see; pairs with unreadable failures.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the larger-scale shapes these test smells defend against.
- [Bad Structure](../../01-development/01-bad-structure/senior.md) — the production-code anti-patterns good tests are supposed to let you refactor.
