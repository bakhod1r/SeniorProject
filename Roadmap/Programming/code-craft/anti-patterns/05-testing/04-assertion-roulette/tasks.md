# Assertion Roulette — Exercises

> **Category:** [Testing Anti-Patterns](../README.md) → **Assertion Roulette** — *hands-on practice making test failures diagnosable.*

---

These are **fix-it** exercises, not recognition quizzes ([`find-bug.md`](find-bug.md) does recognition). For each one you get a problem statement, starting test code (Go, Java with JUnit 5/AssertJ, or Python with pytest — the language varies on purpose), acceptance criteria, and a collapsible solution. The point is to *make the change*: add diagnostic messages, split an Eager Test, parameterize a case-pile, introduce soft assertions, and extract a custom domain assertion.

> **How to use this file.** Read the problem, do it in your editor *before* opening the solution, then compare. The "why it's better" note matters more than the diff — the goal is a failure that names itself, at minimum cost. Refer back to [`middle.md`](middle.md) for the cures and [`senior.md`](senior.md) for the judgement.

---

## Table of Contents

| # | Exercise | Cure | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Make the failure speak](#exercise-1--make-the-failure-speak) | Diagnostic messages | Python | ★ easy |
| 2 | [Split the Eager Test](#exercise-2--split-the-eager-test) | One behavior per test | Java | ★★ medium |
| 3 | [Parameterize the case-pile](#exercise-3--parameterize-the-case-pile) | Parameterized test | Python | ★★ medium |
| 4 | [Reveal every failure with soft assertions](#exercise-4--reveal-every-failure-with-soft-assertions) | Soft assertions | Java | ★★ medium |
| 5 | [Extract a custom domain assertion](#exercise-5--extract-a-custom-domain-assertion) | Custom assertion | Go | ★★★ hard |
| 6 | [Decide split vs keep, then fix](#exercise-6--decide-split-vs-keep-then-fix) | Judgement + hybrid assert | Go | ★★★ hard |

---

## Exercise 1 — Make the failure speak

**Cure:** diagnostic messages · **Language:** Python · **Difficulty:** ★ easy

This test fails with `assert False`. You can't tell which check broke. Without restructuring, make every failure self-describing.

```python
def test_account_defaults():
    acct = create_account("ada@example.com", plan="pro")
    assert acct.email == "ada@example.com"
    assert acct.active
    assert acct.trial_days == 14
    assert acct.role == "member"
    assert acct.api_quota == 1000
```

**Acceptance criteria:** a failure of *any* assertion prints which check failed and the offending value; no behaviors split (still one test).

<details>
<summary>Solution</summary>

The `== ` asserts already get pytest's value introspection, so the worst offender is `assert acct.active` (a bare boolean — prints nothing useful). Add messages, especially there. Naming the *thing* is what was missing.

```python
def test_account_defaults():
    acct = create_account("ada@example.com", plan="pro")
    assert acct.email == "ada@example.com", "email"
    assert acct.active, "account should be active"
    assert acct.trial_days == 14, "pro plan grants 14 trial days"
    assert acct.role == "member", "default role"
    assert acct.api_quota == 1000, "pro plan api quota"
```

**Why it's better:** every failure now reads as a sentence — `AssertionError: pro plan grants 14 trial days` plus the value pytest already prints. The bare-boolean `active` assert goes from "prints nothing" to "account should be active." This is the cheapest cure; it leaves the test shape untouched but kills the roulette. (Note these are still facets of *one* behavior — "account is created with correct defaults" — so keeping them in one test is correct; the fix is legibility, not splitting.)

</details>

---

## Exercise 2 — Split the Eager Test

**Cure:** one behavior per test · **Language:** Java (JUnit 5 / AssertJ) · **Difficulty:** ★★ medium

This test verifies three behaviors. A red run is undiagnosable and fail-fast hides later behaviors. Split it.

```java
@Test
void userLifecycle() {
    User u = service.register("ada@x.com", "pw");
    assertThat(u.isActive()).isTrue();
    assertThat(u.getEmail()).isEqualTo("ada@x.com");

    Session s = service.login("ada@x.com", "pw");
    assertThat(s.isValid()).isTrue();

    service.updateProfile(u.getId(), "Ada Lovelace");
    assertThat(service.find(u.getId()).getName()).isEqualTo("Ada Lovelace");
}
```

**Acceptance criteria:** each behavior is its own test, named for the behavior; each fails independently; no behavior loses coverage.

<details>
<summary>Solution</summary>

Three Acts → three behaviors → three tests, each named so the failure *is* the diagnosis.

```java
@Test
void registerCreatesActiveUserWithEmail() {
    User u = service.register("ada@x.com", "pw");
    assertThat(u.isActive()).as("active").isTrue();
    assertThat(u.getEmail()).as("email").isEqualTo("ada@x.com");
}

@Test
void loginReturnsValidSession() {
    service.register("ada@x.com", "pw");
    Session s = service.login("ada@x.com", "pw");
    assertThat(s.isValid()).as("session valid").isTrue();
}

@Test
void updateProfileChangesName() {
    User u = service.register("ada@x.com", "pw");
    service.updateProfile(u.getId(), "Ada Lovelace");
    assertThat(service.find(u.getId()).getName()).isEqualTo("Ada Lovelace");
}
```

**Why it's better:** a red CI now reads like a list of broken requirements — `updateProfileChangesName FAILED` tells you what broke before you open a file. Login and profile-update fail *independently* (no fail-fast masking). The first test keeps two assertions because they're facets of *one* behavior ("an active user was created"); that's correct — we split on **behaviors, not assertion count**. The cost: `register` is now repeated as Arrange in two tests — acceptable here, and a signal to extract a `@BeforeEach` or fixture helper if it grows.

</details>

---

## Exercise 3 — Parameterize the case-pile

**Cure:** parameterized test · **Language:** Python (pytest) · **Difficulty:** ★★ medium

One body, many input/output pairs. A failure forces you to count asserts down to the broken case, and fail-fast hides later cases. Convert to a parameterized test.

```python
def test_shipping_cost():
    assert shipping_cost("US", 0.5) == 5
    assert shipping_cost("US", 5.0) == 12
    assert shipping_cost("EU", 0.5) == 8
    assert shipping_cost("EU", 5.0) == 20
    assert shipping_cost("US", 0.0) == 0
```

**Acceptance criteria:** each case runs independently; a failure names the exact case; adding a case is one line.

<details>
<summary>Solution</summary>

```python
import pytest

@pytest.mark.parametrize("region, weight, expected", [
    ("US", 0.5,  5),
    ("US", 5.0, 12),
    ("EU", 0.5,  8),
    ("EU", 5.0, 20),
    ("US", 0.0,  0),
], ids=["us-light", "us-heavy", "eu-light", "eu-heavy", "us-zero"])
def test_shipping_cost(region, weight, expected):
    assert shipping_cost(region, weight) == expected
```

**Why it's better:** a failure reports `test_shipping_cost[eu-heavy]` — the exact case by name, no counting. All five cases run independently, so two broken cases show as two failures, not one hiding the other. Adding a region is one table row. The `ids=` are essential — without them you'd get `test_shipping_cost[2]`, which is roulette across anonymous indices. (If you ever need different *logic* per case, that's a sign they're different behaviors and want separate tests, not table rows.)

</details>

---

## Exercise 4 — Reveal every failure with soft assertions

**Cure:** soft assertions · **Language:** Java (JUnit 5) · **Difficulty:** ★★ medium

This test verifies several facets of *one* API response. They're independent, and you want *all* mismatches reported in one run — but right now fail-fast stops at the first.

```java
@Test
void profileResponse() {
    Response r = client.get("/me");
    assertEquals(200, r.status());
    assertEquals("ada", r.body().get("name"));
    assertEquals("pro", r.body().get("plan"));
    assertEquals("UTC", r.body().get("timezone"));
}
```

**Acceptance criteria:** every assertion is evaluated and all failures reported in one run; each failure is labelled; the test stays a single test (it's one behavior — "the response has the right shape").

<details>
<summary>Solution</summary>

Wrap the independent facets in `assertAll` and label each. (If `r` could be null or the call could error, hard-assert that *first* — see Exercise 6.)

```java
@Test
void profileResponseHasCorrectShape() {
    Response r = client.get("/me");
    assertAll("profile response",
        () -> assertEquals(200, r.status(),               "status"),
        () -> assertEquals("ada", r.body().get("name"),   "name"),
        () -> assertEquals("pro", r.body().get("plan"),   "plan"),
        () -> assertEquals("UTC", r.body().get("timezone"), "timezone"));
}
```

**Why it's better:** if `plan` *and* `timezone` are both wrong, one run reports **both** — no fix-and-rerun cycle. Each is labelled, so the report is self-describing. These are independent facets of one outcome, so `assertAll` (soft) is exactly right and the test stays single. Contrast with a *causal chain*: if `name` depended on `status == 200` being true, you'd hard-assert status first, because soft-asserting a chain reports derived failures that bury the root cause.

> AssertJ equivalent: a `SoftAssertions softly = new SoftAssertions();` block of `softly.assertThat(...).as(...)...;` ended with `softly.assertAll();`.

</details>

---

## Exercise 5 — Extract a custom domain assertion

**Cure:** custom domain assertion · **Language:** Go · **Difficulty:** ★★★ hard

The same five-facet "valid order" check is copy-pasted across many tests as a bare stack of `assert.Equal`s — roulette, duplicated, and with messages that drift. Extract a named, reusable assertion.

```go
func TestCreateOrder(t *testing.T) {
    o := CreateOrder(cart, "pro")
    assert.Equal(t, "CONFIRMED", o.Status)
    assert.Equal(t, 1800, o.TotalCents)
    assert.Equal(t, "USD", o.Currency)
    assert.Len(t, o.Lines, 3)
    assert.NotZero(t, o.CreatedAt)
}
// ...repeated, slightly differently, in 6 other tests
```

**Acceptance criteria:** one named helper expresses "this is a valid confirmed order"; each facet still fails legibly with its own message; the helper is reused; call sites read as domain statements.

<details>
<summary>Solution</summary>

Extract a helper that takes the expected facets and labels each internal check. Mark it a test helper so failures report the *caller's* line.

```go
type orderWant struct {
    Status   string
    Total    int
    Currency string
    Lines    int
}

func assertValidOrder(t *testing.T, o *Order, want orderWant) {
    t.Helper()                                    // failures point at the caller
    assert.Equal(t, want.Status, o.Status, "order status")
    assert.Equal(t, want.Total, o.TotalCents, "order total (cents)")
    assert.Equal(t, want.Currency, o.Currency, "order currency")
    assert.Len(t, o.Lines, want.Lines, "order line count")
    assert.NotZero(t, o.CreatedAt, "order createdAt")
}

func TestCreateOrder(t *testing.T) {
    o := CreateOrder(cart, "pro")
    assertValidOrder(t, o, orderWant{
        Status: "CONFIRMED", Total: 1800, Currency: "USD", Lines: 3,
    })
}
```

**Why it's better:** the call site now reads as a domain statement — "assert this is a valid order with these facets." The five messages live in *one* place, so they can't drift per call site (the message-discipline win from `professional.md`). Each facet still fails with its own label (`order total (cents)`), so it's not roulette inside the helper. `t.Helper()` makes failures point at the calling test, not the helper's internals. Reused across the 6 other tests, this removes ~30 lines of duplicated, drift-prone asserts. (In Java this is an AssertJ `AbstractAssert` subclass: `OrderAssert.assertThat(o).isConfirmed().hasTotal(1800)`.)

</details>

---

## Exercise 6 — Decide split vs keep, then fix

**Cure:** judgement + hybrid (fail-fast preconditions + soft facets) · **Language:** Go · **Difficulty:** ★★★ hard

This test mixes two *behaviors* and also has a hidden fail-fast hazard. Decide what to split and what to keep, then fix the assertion modes.

```go
func TestTransfer(t *testing.T) {
    from := NewAccount(500)
    to := NewAccount(0)

    // behavior A: a valid transfer
    err := Transfer(from, to, 100)
    assert.NoError(t, err)
    assert.Equal(t, 400, from.Balance)
    assert.Equal(t, 100, to.Balance)
    entry := Ledger.Last()
    assert.Equal(t, 100, entry.Amount)         // panics if entry is nil

    // behavior B: overdraft is rejected
    err2 := Transfer(from, to, 99999)
    assert.Error(t, err2)
    assert.Equal(t, 400, from.Balance)         // unchanged
}
```

**Acceptance criteria:** distinct behaviors are separate tests; within the transfer test, the *facets* are reported together but preconditions that guard a dereference are fail-fast; no nil-panic can mask the real failure.

<details>
<summary>Solution</summary>

**Decision:** two behaviors ("a valid transfer" and "overdraft rejected") → two tests. Within the transfer test, the post-conditions (source down, dest up, ledger entry) are facets of *one* outcome → keep together and **soft-assert** them. But `entry.Amount` dereferences `entry`, which is meaningless if `Ledger.Last()` is nil → that precondition must be **fail-fast** (`require`) so a nil-panic can't bury the real failure.

```go
func TestTransfer_MovesMoneyAndRecordsLedger(t *testing.T) {
    from, to := NewAccount(500), NewAccount(0)

    require.NoError(t, Transfer(from, to, 100))   // precondition: stop if the op errored

    assert.Equal(t, 400, from.Balance, "source balance")  // independent facets:
    assert.Equal(t, 100, to.Balance, "dest balance")      //  soft, all reported
    entry := Ledger.Last()
    require.NotNil(t, entry, "a ledger entry must exist")  // precondition for the deref
    assert.Equal(t, 100, entry.Amount, "ledger entry amount")
}

func TestTransfer_RejectsOverdraft(t *testing.T) {
    from, to := NewAccount(400), NewAccount(0)
    err := Transfer(from, to, 99999)
    require.Error(t, err, "overdraft should be rejected")
    assert.Equal(t, 400, from.Balance, "balance unchanged on rejected transfer")
}
```

**Why it's better:** the two behaviors fail independently and are named for the requirement. Inside the transfer test, the three facets are **soft** (`assert`) so a wrong source-balance *and* a wrong dest-balance both show in one run — which is exactly what you want to diagnose a transfer-math bug. The two dereference-guards are **fail-fast** (`require`): if the op errored or no ledger entry exists, the test stops cleanly with a clear message instead of panicking on a nil and burying the cause. This is the hybrid rule from `professional.md`: *hard-assert the preconditions, soft-assert the independent facets.*

</details>

---

## Wrap-Up

The six exercises walk the full toolkit, cheapest cure first:

1. **Messages** — the zero-restructuring win; make bare booleans speak.
2. **Split by behavior** — one reason to fail per test; the failing *name* is the diagnosis.
3. **Parameterize** — many cases, isolated and named; never anonymous indices.
4. **Soft assertions** — report every independent facet in one run.
5. **Custom domain assertion** — DRY a recurring facet-check; messages in one drift-proof place.
6. **Judgement + hybrid** — split behaviors, keep facets, hard-assert preconditions and soft-assert the rest.

Throughout, the discriminator is the same: **could this fail for two *unrelated* reasons?** If yes, split; if no, keep and make legible.

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — the level progression.
- [`find-bug.md`](find-bug.md) — recognition practice; [`optimize.md`](optimize.md) — refactor a giant Eager Test end-to-end.
- [`interview.md`](interview.md) — Q&A across all levels.
- [Fragile Tests](../01-fragile-tests/tasks.md) · [Slow Tests](../05-slow-tests/tasks.md) — sibling-smell exercises.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) · [Bad Structure](../../01-development/01-bad-structure/senior.md).
