# Assertion Roulette — Find the Bug

> **Category:** [Testing Anti-Patterns](../README.md) → **Assertion Roulette** — *a test with many unlabelled assertions, so when one fails you cannot tell which — or why.*

---

This file is **critical-reading practice**. Each snippet is a plausible test in Go, Java (JUnit 5/AssertJ), or Python (pytest). Your job is to read it the way a reviewer does and answer three questions:

> **Why would a failure here be undiagnosable (or hide a second failure)? What concrete problem does it cause? How would you fix it?**

The "bug" usually isn't a crash — it's a test that *catches* a regression but can't *tell you* what broke, or one whose fail-fast assertions **mask** later failures. Some snippets are deliberately innocent-looking; one is a **trap** where the multi-assert shape is actually correct. Read slowly, write your answer, then open the collapsible.

> **How to use this file:** answer *before* expanding. The skill is noticing the undiagnosable failure, not recalling the name.

---

## Table of Contents

1. [The twelve-assert account test](#snippet-1--the-twelve-assert-account-test)
2. [The bare boolean](#snippet-2--the-bare-boolean)
3. [The hidden second failure](#snippet-3--the-hidden-second-failure)
4. [The case-pile](#snippet-4--the-case-pile)
5. [The nil-deref that buries the cause](#snippet-5--the-nil-deref-that-buries-the-cause)
6. [The lying message](#snippet-6--the-lying-message)
7. [The anonymous parameterized test](#snippet-7--the-anonymous-parameterized-test)
8. [The "too many asserts" trap](#snippet-8--the-too-many-asserts-trap)

---

## Snippet 1 — The twelve-assert account test

```go
// Go — verifies a newly created account
func TestNewAccount(t *testing.T) {
    a := CreateAccount("ada@x.com", "pro")
    if a.Email != "ada@x.com" { t.Fail() }
    if a.Plan != "pro"        { t.Fail() }
    if !a.Active              { t.Fail() }
    if a.TrialDays != 14      { t.Fail() }
    if a.Role != "member"     { t.Fail() }
    if a.Quota != 1000        { t.Fail() }
}
```

> Why is a failure undiagnosable? What's the fix?

<details>
<summary>Answer</summary>

**Textbook Assertion Roulette.** Every check is `if cond { t.Fail() }` — `t.Fail()` records a failure with **no message and no values**. A red `TestNewAccount` tells you *nothing*: not which field, not expected vs actual. You re-read all six `if`s and start guessing.

Worse than even a bare `assert`: `t.Fail()` doesn't print the offending value at all.

**Fix:** use a matcher library that prints values + a label. The facets all describe one behavior ("account created with correct defaults"), so keep them in one test but make each speak.

```go
func TestNewAccount(t *testing.T) {
    a := CreateAccount("ada@x.com", "pro")
    assert.Equal(t, "ada@x.com", a.Email, "email")
    assert.Equal(t, "pro", a.Plan, "plan")
    assert.True(t, a.Active, "active")
    assert.Equal(t, 14, a.TrialDays, "pro plan trial days")
    assert.Equal(t, "member", a.Role, "default role")
    assert.Equal(t, 1000, a.Quota, "pro plan quota")
}
// failure: "pro plan trial days: Not equal: expected: 14, actual: 30"
```

Using `assert.*` (not `require.*`) also makes them **soft**, so multiple wrong fields all report in one run.

</details>

---

## Snippet 2 — The bare boolean

```python
# Python + pytest — looks fine because pytest "shows values"
def test_checkout_succeeds():
    result = checkout(cart, card)
    assert result.success
    assert result.charged
    assert result.email_sent
    assert result.inventory_reserved
```

> pytest rewrites asserts to show values — so why is this still roulette?

<details>
<summary>Answer</summary>

**pytest's introspection doesn't help here.** Assertion rewriting shows operands of comparisons (`a == b`), but these are bare booleans — `assert result.success` has nothing to compare, so the failure is just `assert False` with the line. With four near-identical boolean asserts, a red test means "one of success/charged/email/inventory is false" and you don't know which.

This is the trap from `junior.md`: people assume pytest immunizes them. It doesn't immunize bare booleans.

**Fix:** add a message to each (cheapest), and consider that "email sent" and "inventory reserved" may be *different behaviors* worth splitting:

```python
def test_checkout_charges_and_succeeds():
    result = checkout(cart, card)
    assert result.success, "checkout should succeed"
    assert result.charged, "card should be charged"

def test_checkout_reserves_inventory():
    assert checkout(cart, card).inventory_reserved, "inventory should be reserved"

def test_checkout_sends_confirmation_email():
    assert checkout(cart, card).email_sent, "confirmation email should be sent"
```

Even if you keep one test, the messages turn `assert False` into `AssertionError: card should be charged`.

</details>

---

## Snippet 3 — The hidden second failure

```java
// Java + JUnit 5 — two assertions, one masked
@Test
void discountCalculation() {
    Order o = priceOrder(cart, "GOLD");
    assertEquals(10, o.getDiscountPercent());   // (1)
    assertEquals(1800, o.getTotalCents());      // (2)
}
```

> Both the discount *and* the total are wrong in production. What does this test report, and why is that a problem?

<details>
<summary>Answer</summary>

**Fail-fast masking.** JUnit is fail-fast: assertion (1) throws, so (2) **never runs**. If both the discount percent *and* the total are wrong, the test only reports the discount. You fix the discount, re-run, *then* discover the total is also broken — two debug cycles for two failures that were both present from the start.

These two assertions are **independent facets** of one outcome ("the gold order was priced correctly"), so you want them *both* reported in one run.

**Fix:** soft-assert with `assertAll`:

```java
@Test
void goldOrderIsPricedCorrectly() {
    Order o = priceOrder(cart, "GOLD");
    assertAll("gold pricing",
        () -> assertEquals(10, o.getDiscountPercent(), "discount %"),
        () -> assertEquals(1800, o.getTotalCents(), "total cents"));
}
```

Now both wrong numbers appear together — which, for a pricing bug, *speeds* diagnosis because you see the relationship between the broken discount and the broken total.

</details>

---

## Snippet 4 — The case-pile

```python
# Python — validation rules tested in one method
def test_password_rules():
    assert is_valid("abcdefgh1!")          # ok
    assert not is_valid("short1!")         # too short
    assert not is_valid("alllowercase1!")  # no uppercase
    assert not is_valid("ALLUPPER1!")      # no lowercase
    assert not is_valid("NoDigits!!")      # no digit
    assert not is_valid("NoSymbol12")      # no symbol
```

> Why is this hard to debug, and what's the right structure?

<details>
<summary>Answer</summary>

**Roulette across cases + fail-fast masking.** Six rules in one method. A failure is `assert ... ` at some line, and you must map line → rule by hand. If "no uppercase" and "no symbol" are both broken, fail-fast shows only the first. And there are no messages, so even the line gives you only the *input*, not the *intent*.

**Fix:** a parameterized test, one named case per rule — isolated and self-labelling:

```python
import pytest

@pytest.mark.parametrize("password, valid", [
    ("abcdefgh1!", True),
    ("short1!", False),
    ("alllowercase1!", False),
    ("ALLUPPER1!", False),
    ("NoDigits!!", False),
    ("NoSymbol12", False),
], ids=["valid", "too-short", "no-uppercase", "no-lowercase", "no-digit", "no-symbol"])
def test_password_rules(password, valid):
    assert is_valid(password) is valid
```

A failure now reports `test_password_rules[no-symbol]` — the exact rule. Every case runs independently; adding a rule is one row. The `ids=` are essential (see Snippet 7 for what happens without them).

</details>

---

## Snippet 5 — The nil-deref that buries the cause

```go
// Go — fetches a user and checks fields, all soft
func TestFetchUser(t *testing.T) {
    u, err := Fetch(42)
    assert.NoError(t, err)
    assert.Equal(t, "ada", u.Name)     // panics if u is nil
    assert.Equal(t, "pro", u.Plan)
}
```

> The author used soft `assert.*` to "see all failures." Why does this backfire?

<details>
<summary>Answer</summary>

**Wrong assertion mode for a precondition.** When `Fetch` fails, it returns `err != nil` *and* `u == nil`. `assert.NoError` is **soft** — it records the failure and **continues**. The next line `u.Name` then **dereferences a nil pointer and panics**. The panic's stack trace becomes the headline failure, *burying* the real cause (the error from `Fetch`) under a secondary crash. The author wanted "see all failures" but got "a panic that hides the actual failure."

This is the asymmetry from `professional.md`: soft-assert is wrong when later assertions are *meaningless or dangerous* after an earlier one fails.

**Fix — hybrid: `require` the preconditions, `assert` the independent facets:**

```go
func TestFetchUser(t *testing.T) {
    u, err := Fetch(42)
    require.NoError(t, err)          // fail-fast: nothing below is valid if this fails
    require.NotNil(t, u)             // fail-fast: guard the deref
    assert.Equal(t, "ada", u.Name, "name")   // soft: independent facets
    assert.Equal(t, "pro", u.Plan, "plan")
}
```

Now a fetch error stops the test cleanly with `require.NoError` reporting the real error — no nil-panic to bury it.

</details>

---

## Snippet 6 — The lying message

```java
// Java — a message was added, so it's diagnosable... right?
@Test
void shipmentStatus() {
    Shipment s = track("PKG-1");
    assertEquals("DELIVERED", s.getStatus(), "status should be in transit");
}
```

> There *is* a message. What's the bug?

<details>
<summary>Answer</summary>

**A drifted (lying) message.** The assertion checks for `"DELIVERED"`, but the message says `"status should be in transit"`. Someone changed the expected value and forgot the message. On failure it prints:

```
status should be in transit ==> expected: <DELIVERED> but was: <PENDING>
```

The reader now gets *contradictory* information — the message says one thing, the values say another — and wastes time reconciling them. **A wrong message is worse than no message** because it actively misdirects.

**Fix:** let the matcher generate the message from the actual code, or make the message name the *identity/why*, not restate a value that can drift:

```java
assertThat(s.getStatus())
    .as("shipment status for PKG-1")     // identity, not a value that can drift
    .isEqualTo("DELIVERED");
```

AssertJ prints `[shipment status for PKG-1] expected: "DELIVERED" but was: "PENDING"` — accurate, with no hand-maintained value to fall out of sync.

</details>

---

## Snippet 7 — The anonymous parameterized test

```python
# Python — someone parameterized, but CI shows "test_rate[3]"
@pytest.mark.parametrize("balance, rate", [
    (0, 0.0),
    (1000, 0.01),
    (10000, 0.02),
    (-50, 0.0),
    (100000, 0.05),
])
def test_rate(balance, rate):
    assert interest_rate(balance) == rate
```

> Parameterizing was supposed to fix roulette. Why is `test_rate[3]` still roulette?

<details>
<summary>Answer</summary>

**Roulette reintroduced across anonymous cases.** Parameterizing *isolated* the cases (good — they now run independently), but without `ids=`, pytest labels them by **index**: `test_rate[0]`, `test_rate[1]`, … A failure of `test_rate[3]` forces you to count down to the 4th tuple `(-50, 0.0)` by hand — the exact mapping-by-position problem parameterizing was meant to kill. (pytest sometimes derives ids from simple values, but for several numeric tuples they're easy to misread, and the overdraft case `-50` carries *intent* the number doesn't show.)

**Fix:** add descriptive `ids` so the case names itself:

```python
@pytest.mark.parametrize("balance, rate", [
    (0, 0.0),
    (1000, 0.01),
    (10000, 0.02),
    (-50, 0.0),
    (100000, 0.05),
], ids=["zero", "tier-1", "tier-2", "overdraft", "tier-vip"])
def test_rate(balance, rate):
    assert interest_rate(balance) == rate
```

Now a failure reads `test_rate[overdraft]` — the case *and* its intent. The lesson: parameterizing only kills roulette if the cases are **named**.

</details>

---

## Snippet 8 — The "too many asserts" trap

```java
// Java + AssertJ — a reviewer flags this as Assertion Roulette. Are they right?
@Test
void registerProducesValidUser() {
    User u = service.register("ada@x.com", "pw");
    assertThat(u.getEmail()).as("email").isEqualTo("ada@x.com");
    assertThat(u.isActive()).as("active").isTrue();
    assertThat(u.getRole()).as("role").isEqualTo(MEMBER);
    assertThat(u.getId()).as("id").isPositive();
    assertThat(u.getCreatedAt()).as("createdAt").isNotNull();
}
```

> Five assertions in one test. Is the reviewer correct that this is Assertion Roulette?

<details>
<summary>Answer</summary>

**Trap snippet: NO, the reviewer is wrong.** This is *not* Assertion Roulette, and splitting it would be the *opposite* mistake.

Why it's fine:
- **One behavior, one Act.** A single `register` call; the five assertions are *facets* of one outcome — "registration produces a valid user." There is exactly **one reason to fail** ("registration is broken"), observed five ways.
- **Every assertion is labelled** (`.as("...")`) and value-bearing (AssertJ prints actual vs expected). The failure is fully diagnosable: `[role] expected: MEMBER but was: GUEST`.
- The test is **named for the behavior**, so a red run already says "registration produces a valid user — broken."

Splitting into five one-assert tests would **duplicate the `register` Arrange five times**, slow the suite, and lose the relationship between the facets — the *fragment-itis* anti-pattern from `professional.md`.

**The lesson for critical reading:** Assertion Roulette is *undiagnosable failures across multiple behaviors*, not *plural assertions*. Count the **behaviors/Acts and the labels**, not the asserts. The diagnostic question is "could this fail for two *unrelated* reasons?" — here, no. (You could optionally wrap the five in `assertAll`/`SoftAssertions` so all facets report in one run, but that's polish, not a fix.)

</details>

---

## Summary — patterns of spotting

You don't spot Assertion Roulette by counting assertions — you spot it by asking what a *failure* would tell you. The repeatable moves from these eight snippets:

- **Read the failure, not the test.** If a red run names a *line* or says "assertion failed" without values, it's roulette — fix with messages or a matcher library (Snippets 1, 2).
- **Bare booleans and `t.Fail()` are the worst offenders.** They discard actual-vs-expected; pytest's introspection doesn't save them (Snippets 1, 2).
- **Watch fail-fast masking.** Independent facts behind hard assertions hide each other — soft-assert them so all report in one run (Snippet 3).
- **Count Acts/behaviors, not asserts.** Multiple behaviors → split; one behavior with labelled facets is *correct* (Snippets 2, 8).
- **Match assertion mode to dependency.** Hard-assert (`require`) preconditions that guard a dereference; soft-assert independent facets — soft-asserting a precondition can panic and bury the cause (Snippet 5).
- **Messages can lie.** A drifted hand-written message misdirects worse than none; prefer matcher-generated messages and name the *identity/why* (Snippet 6).
- **Parameterizing only kills roulette if cases are named.** Anonymous `[3]` indices reintroduce it (Snippets 4, 7).
- **Resist the false positive.** Plural labelled assertions about one outcome are not roulette; "could it fail for two *unrelated* reasons?" is the discriminator (Snippet 8).

The meta-lesson: **the smell is the undiagnosable failure, not the count.** When you can't tell from a red run what broke — or a later failure is hidden — fix the *output*: split behaviors, label facets, choose the right assert mode, and let the library print the values.

---

## Related Topics

- [`junior.md`](junior.md) — what the smell looks like and why it's bad.
- [`middle.md`](middle.md) — the Eager Test cause and the four cures.
- [`senior.md`](senior.md) — one-reason-to-fail, parameterized tests, custom assertions.
- [`professional.md`](professional.md) — soft vs fail-fast, message discipline, the fragment-itis trade-off.
- [`tasks.md`](tasks.md) — fix-it exercises; [`optimize.md`](optimize.md) — refactor a giant Eager Test end-to-end.
- [Fragile Tests](../01-fragile-tests/find-bug.md) · [Slow Tests](../05-slow-tests/find-bug.md) — sibling find-bug files.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) · [Bad Structure](../../01-development/01-bad-structure/find-bug.md).
