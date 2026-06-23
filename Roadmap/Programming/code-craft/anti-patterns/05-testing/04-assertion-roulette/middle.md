# Assertion Roulette — Middle Level

> **Category:** [Testing Anti-Patterns](../README.md) → **Assertion Roulette** — *a test with many unlabelled assertions, so when one fails you cannot tell which — or why.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Root Cause: the Eager Test](#the-root-cause-the-eager-test)
4. [Cure 1 — One Behavior per Test](#cure-1--one-behavior-per-test)
5. [Cure 2 — Descriptive Assertion Messages](#cure-2--descriptive-assertion-messages)
6. [Cure 3 — Rich Matcher Libraries](#cure-3--rich-matcher-libraries)
7. [Cure 4 — Soft Assertions to Reveal Every Failure](#cure-4--soft-assertions-to-reveal-every-failure)
8. [Choosing a Cure](#choosing-a-cure)
9. [Common Mistakes](#common-mistakes)
10. [Test Yourself](#test-yourself)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why does the roulette wheel get built**, and **what do you do instead** — concretely, in Go, Java, and Python.

`junior.md` showed you the smell: a test with many bare assertions whose failure names a line, not a fact. This file goes after the **cause** and gives you four cures with trade-offs, so you pick the right one rather than reflexively splitting everything.

The cause is almost always a sibling smell Meszaros named the **Eager Test**: a single test method that verifies *many behaviors* at once. Eager Test is the disease; Assertion Roulette is the symptom you feel at failure time. Fix the Eager Test and the roulette usually disappears — but not always, because sometimes you legitimately have several assertions about *one* outcome and just need them to fail legibly. Knowing which situation you're in is the middle-level skill.

> **The mental model:** the question isn't "how many assertions is too many?" — it's "how many *behaviors* is this test responsible for?" One behavior, several facets → multiple assertions are fine (label them). Many behaviors → split.

---

## Prerequisites

- **Required:** Comfortable with [`junior.md`](junior.md) — you can spot the smell and add a basic message.
- **Required:** You write tests in at least one of Go (`testing`/testify), Java (JUnit 5/AssertJ), Python (pytest).
- **Helpful:** Familiarity with the Arrange–Act–Assert structure (introduced fully in `senior.md`).
- **Helpful:** The `unit-testing-patterns` and `test-data-management` skills for the positive patterns these cures reach for.

---

## The Root Cause: the Eager Test

An **Eager Test** tries to be efficient by exercising a whole workflow in one method — "while I've got an account object built, let me check *everything* about it." It feels economical. It isn't.

```java
// Java — an Eager Test: registration, login, AND profile update, all in one
@Test
void userFlow() {
    User u = service.register("ada@x.com", "pw");
    assertTrue(u.isActive());
    assertEquals("ada@x.com", u.getEmail());

    Session s = service.login("ada@x.com", "pw");
    assertNotNull(s);
    assertTrue(s.isValid());

    service.updateProfile(u.getId(), "Ada Lovelace");
    User reloaded = service.find(u.getId());
    assertEquals("Ada Lovelace", reloaded.getName());
    assertTrue(reloaded.isActive());
}
```

This single test is responsible for *three behaviors*: registration, login, and profile update. Problems:

- **Roulette at failure time.** A red `userFlow` could mean any of six assertions across three features.
- **Fail-fast masking.** If `register` is broken, `login` and `updateProfile` are never even reached — you can't tell if they also regressed.
- **It reads as a script, not a specification.** Nobody can scan the test names and learn "what does registration guarantee?"

The Eager Test is *why* you end up holding a roulette wheel. Splitting it by behavior is the primary cure.

---

## Cure 1 — One Behavior per Test

Split the Eager Test so each test verifies a single behavior and is named for it. Now the failing test's *name* is the diagnosis.

```java
@Test
void registerCreatesActiveUser() {
    User u = service.register("ada@x.com", "pw");
    assertThat(u.isActive()).isTrue();
    assertThat(u.getEmail()).isEqualTo("ada@x.com");
}

@Test
void loginReturnsValidSession() {
    service.register("ada@x.com", "pw");
    Session s = service.login("ada@x.com", "pw");
    assertThat(s).isNotNull();
    assertThat(s.isValid()).isTrue();
}

@Test
void updateProfileChangesName() {
    User u = service.register("ada@x.com", "pw");
    service.updateProfile(u.getId(), "Ada Lovelace");
    assertThat(service.find(u.getId()).getName()).isEqualTo("Ada Lovelace");
}
```

Note that each test still has **two or three assertions** — and that's fine, because they all describe *one* behavior. `registerCreatesActiveUser` asserts the two things "an active user was created" means. Splitting is about **behaviors, not assertion count**. The myth "one assert per test" is addressed head-on in `professional.md`; the real rule is **one *reason to fail* per test**.

> **Bonus:** the three tests now fail *independently*. If login and profile-update are both broken, you see two red tests, not one that hid the second behind fail-fast.

---

## Cure 2 — Descriptive Assertion Messages

When several assertions legitimately belong to one test, label each so its failure is self-describing. This is the cure for the multi-facet-of-one-outcome case where splitting would be silly.

```python
# Python + pytest — messages turn "line N" into a sentence
def test_invoice_totals():
    inv = build_invoice(subtotal=1000, tax_rate=0.10, discount=50)
    assert inv.subtotal == 1000,  f"subtotal: {inv.subtotal}"
    assert inv.tax == 100,        f"tax (10% of 1000): {inv.tax}"
    assert inv.discount == 50,    f"discount: {inv.discount}"
    assert inv.total == 1050,     f"total = sub + tax - disc: {inv.total}"
```

A failure now prints `AssertionError: tax (10% of 1000): 95` — you know instantly *which* facet and *what value*. The message answers "what was supposed to be true here?" so the reader never has to reconstruct it.

In Go, the message is a trailing argument to testify; in Java, the last argument to a JUnit assertion or AssertJ's `.as("...")`:

```go
assert.Equal(t, 100, inv.Tax, "tax should be 10%% of subtotal")
```
```java
assertThat(inv.getTax()).as("tax = 10%% of subtotal").isEqualTo(100);
```

---

## Cure 3 — Rich Matcher Libraries

Bare framework asserts (`assertTrue`, Go's `if got != want`) are the worst offenders because they discard values. A **fluent matcher library** prints actual-vs-expected *and* a readable description automatically — often eliminating the need for a hand-written message.

```java
// Java — AssertJ: the failure message is generated, with full context
assertThat(order.getLines())
    .as("order lines")
    .hasSize(3)
    .extracting(Line::sku)
    .containsExactly("A-1", "B-2", "C-3");
// failure: "[order lines] expected size 3 but was 2 ... <[A-1, B-2]>"
```

```python
# Python + pytest — assert-rewriting shows the diff for free
def test_payload():
    assert build_payload() == {"id": 1, "status": "open", "items": []}
# failure shows a structural diff of the two dicts, key by key
```

```go
// Go + testify — prints expected, actual, and the diff
assert.Equal(t, want, got, "response payload")
```

The win: instead of `assertTrue(order.getLines().size() == 3)` (which prints "expected true, got false"), you get "expected size 3 but was 2, and here are the elements." The matcher carries the diagnostic context the bare assert threw away. This is why "use a real assertion library" is the single highest-leverage fix for an existing roulette suite.

---

## Cure 4 — Soft Assertions to Reveal Every Failure

Sometimes you genuinely want several assertions in one test *and* you want **all** of them evaluated even if an early one fails — so one run shows every problem. That's a **soft assertion** (a.k.a. assert-all): failures are collected, not thrown, and reported together at the end.

```java
// Java + JUnit 5 — assertAll runs every assertion, reports all failures
@Test
void responseHasCorrectShape() {
    Response r = client.get("/me");
    assertAll("profile response",
        () -> assertEquals(200, r.status(), "status"),
        () -> assertEquals("ada", r.body().get("name"), "name"),
        () -> assertEquals("pro", r.body().get("plan"), "plan"));
}
// If status AND plan are wrong, BOTH are reported in one run.
```

```python
# Python — pytest-check (or pytest.raises-free soft checks)
from pytest_check import check
def test_response_shape():
    r = client.get("/me")
    with check: assert r.status == 200, "status"
    with check: assert r.body["name"] == "ada", "name"
    with check: assert r.body["plan"] == "pro", "plan"
```

```java
// Java + AssertJ soft assertions
SoftAssertions softly = new SoftAssertions();
softly.assertThat(r.status()).as("status").isEqualTo(200);
softly.assertThat(r.plan()).as("plan").isEqualTo("pro");
softly.assertAll();   // reports every failure at once
```

Go has no built-in soft assert, but testify's `assert.*` (as opposed to `require.*`) is exactly this: `assert` records the failure and continues; `require` stops the test. Use `assert` when you want every check evaluated, `require` when a later check is meaningless after an earlier one failed (e.g. don't dereference a nil you just asserted non-nil).

> **Caveat:** soft assertions reveal all failures, but they don't replace splitting. A soft-asserted Eager Test still bundles many behaviors under one name. Use soft assertions for *one behavior, several facets you want fully reported* — not to legitimize a mega-test.

---

## Choosing a Cure

| Situation | Best cure |
|---|---|
| One test verifies several **behaviors** (Eager Test) | **Split** — one behavior per test (Cure 1) |
| One behavior, several **facets** of the same outcome | **Messages** (Cure 2) or **soft assertions** (Cure 4) |
| Bare `assertTrue` / `if got != want` everywhere | **Rich matchers** (Cure 3) — biggest win per minute |
| You need to see **all** failures in one run | **Soft assertions** (Cure 4) |

These compose. The strongest result is usually: split by behavior **and** use a rich matcher library **and** label any remaining multi-assert facet.

---

## Common Mistakes

1. **Splitting on assertion count instead of behavior.** Chopping a cohesive 3-assert "active user created" test into three one-line tests triples the Arrange code and slows the suite for no diagnostic gain. Split *behaviors*, not *asserts*.
2. **Adding messages but keeping fail-fast.** Messages fix "which assert," but the second broken assert is still hidden behind the first. If you need to see all failures, reach for soft assertions or split.
3. **Using soft assertions to excuse an Eager Test.** Soft-asserting twelve checks across three features just means you now see all twelve fail under one badly-named test. Split first; soften within a behavior.
4. **Bare booleans even with a library available.** `assertThat(x.isReady()).isTrue()` still prints "expected true." Prefer `assertThat(x.getState()).isEqualTo(READY)` so the value shows.
5. **Forgetting `require` vs `assert` semantics in Go.** A `require.NotNil` *must* precede a dereference; using `assert.NotNil` lets the test continue and then panic on nil, producing a worse failure than the roulette you were fixing.

---

## Test Yourself

1. What is the relationship between the *Eager Test* smell and *Assertion Roulette*?
2. Give the rule that replaces the "one assert per test" myth.
3. You have a test with three assertions, all about whether a newly-created order is valid. Should you split it into three tests? Why or why not?
4. What does a soft assertion give you that a normal (hard) assertion doesn't?
5. Why is "switch to a rich matcher library" often the highest-leverage single fix for a legacy roulette suite?

<details>
<summary>Answers</summary>

1. Eager Test is the cause; Assertion Roulette is the symptom. An Eager Test verifies many behaviors in one method, which is precisely what produces a pile of unlabelled assertions under one test name — the roulette you feel at failure time.
2. **One *reason to fail* (one behavior) per test** — not one assertion. A single behavior may need several assertions to describe; that's fine if they're labelled.
3. **No** (probably). Three assertions about *one* behavior ("the order is valid") belong together — splitting triples the Arrange and adds no diagnostic value. Add messages or use soft assertions so each facet fails legibly. Split only if those are really *different* behaviors.
4. It evaluates **all** assertions and reports **every** failure in one run, instead of stopping at the first (fail-fast). You learn about multiple problems from a single execution.
5. Bare framework asserts discard the actual-vs-expected values; a rich matcher prints them plus a description automatically across the whole suite, turning thousands of "expected true, got false" failures into self-describing ones — without touching each test by hand.

</details>

---

## Cheat Sheet

| Cure | Use when | Mechanism |
|---|---|---|
| Split by behavior | Eager Test (many behaviors) | One test per behavior; name = diagnosis |
| Descriptive messages | One behavior, several facets | Trailing message / AssertJ `.as()` / pytest `assert x, "msg"` |
| Rich matchers | Bare booleans everywhere | AssertJ, testify, pytest rewrite — prints values |
| Soft assertions | Want every failure in one run | `assertAll`, AssertJ `SoftAssertions`, `pytest-check`, testify `assert.*` |

> **One rule to remember:** *fix the Eager Test first (split by behavior); then make whatever assertions remain in each test fail legibly (messages, matchers, soft asserts).*

---

## Summary

- **Assertion Roulette** is almost always a symptom of the **Eager Test** smell — one method verifying many behaviors.
- **Cure 1 (split by behavior)** is primary: the failing test's *name* becomes the diagnosis, and behaviors fail independently instead of hiding behind fail-fast.
- **Cure 2 (messages)** and **Cure 3 (rich matchers)** make whatever assertions remain self-describing — print *which* check and *what* value.
- **Cure 4 (soft assertions)** evaluates every check in one run, surfacing all failures at once — for *one behavior with several facets*, not to excuse a mega-test.
- Split on **behaviors, not assertion count**; the real rule is **one reason to fail per test**.
- Next: [`senior.md`](senior.md) — *fixing roulette across a whole suite, the design behind one-reason-to-fail, AAA, behavior naming, parameterized tests, and custom domain assertions.*

---

## Further Reading

- **xUnit Test Patterns** — Gerard Meszaros (2007) — *Assertion Roulette*, *Eager Test*; *Verify One Condition per Test*, *Assertion Message*.
- **Clean Code** — Robert C. Martin (2008) — Ch. 9, "Single Concept per Test."
- **AssertJ documentation** — fluent assertions, `.as()` descriptions, `SoftAssertions`.
- **JUnit 5 User Guide** — `assertAll`; assertion messages and suppliers.
- **pytest** — assertion introspection; **pytest-check** for soft assertions.

---

## Related Topics

- [Fragile Tests](../01-fragile-tests/middle.md) — over-asserting on internals; pairs with roulette in over-eager tests.
- [Slow Tests](../05-slow-tests/middle.md) — note that over-splitting can *create* slow suites (duplicated Arrange); the trade-off lives in `professional.md`.
- [Mystery Guest](../03-mystery-guest/middle.md) — hidden fixtures that also make failures hard to read.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — system-scale shapes.
- [Bad Structure](../../01-development/01-bad-structure/senior.md) — the production code these tests protect during refactors.
