# Assertion Roulette — Refactoring Practice

> **Category:** [Testing Anti-Patterns](../README.md) → **Assertion Roulette** — *a test with many unlabelled assertions, so when one fails you cannot tell which — or why.*

---

These are not "spot the smell" puzzles — [`find-bug.md`](find-bug.md) does that. Here the test is **a working roulette wheel**, and your job is to **refactor it into focused, self-describing tests without changing what's covered**. The skill on display is the *process* and the *judgement*: deciding what to split, what to keep, what to parameterize, and which assertion mode each check needs.

Each worked solution shows **Before → After**, names the moves, and — critically — **weighs the granularity trade-off**: how far to split before you tip from roulette into fragment-itis (duplicated Arrange, a slower, noisier suite).

> **How to use this file:** read the "Before," write down your refactor plan *yourself* (what splits, what stays, assertion modes), then compare. The gap between your plan and the worked one is the learning.

---

## Table of Contents

| # | Exercise | Starting smell | Lang | Key moves |
|---|---|---|---|---|
| 1 | [The giant signup test](#exercise-1--the-giant-signup-test) | Eager Test + bare asserts | Python | Split by behavior, message, parameterize |
| 2 | [The pricing mega-test](#exercise-2--the-pricing-mega-test) | Case-pile roulette | Java | Parameterize, soft-assert, label |
| 3 | [The API response avalanche](#exercise-3--the-api-response-avalanche) | Roulette + fail-fast hazard | Go | Hybrid require/assert, custom assertion |

---

## Exercise 1 — The giant signup test

**Starting smell:** Eager Test + bare assertions + a case-pile, all in one method. **Goal:** focused, self-describing tests. **Constraint:** identical coverage; no behavior change.

### Before

```python
# Python + pytest — one method verifies the entire signup feature
def test_signup():
    # create a pro user
    u = signup("ada@x.com", "pw", plan="pro")
    assert u.email == "ada@x.com"
    assert u.active
    assert u.plan == "pro"
    assert u.trial_days == 14
    assert u.role == "member"

    # a free user gets different trial days
    f = signup("bob@x.com", "pw", plan="free")
    assert f.trial_days == 0

    # an enterprise user gets more
    e = signup("ent@x.com", "pw", plan="enterprise")
    assert e.trial_days == 30

    # login works after signup
    s = login("ada@x.com", "pw")
    assert s.valid

    # duplicate email is rejected
    try:
        signup("ada@x.com", "pw", plan="pro")
        assert False
    except DuplicateEmail:
        pass
```

### Plan it first

What does this test actually cover? Three *behaviors* tangled together:
1. **Signup produces a correct user** (facets: email, active, plan, role) — one behavior.
2. **Trial days depend on the plan** (pro=14, free=0, enterprise=30) — a *case-pile*, one rule across three inputs.
3. **Login works after signup** — a different behavior.
4. **Duplicate email is rejected** — a different behavior.

A red `test_signup` could be any of these, and fail-fast means a broken signup hides everything after it. The refactor: split the behaviors, parameterize the trial-days rule, label the facets.

<details>
<summary>Solution</summary>

```python
import pytest

# Behavior 1: signup produces a correct user (facets of ONE outcome → one test, labelled)
def test_signup_produces_active_member():
    u = signup("ada@x.com", "pw", plan="pro")
    assert u.email == "ada@x.com", "email"
    assert u.active, "new user should be active"
    assert u.plan == "pro", "plan"
    assert u.role == "member", "default role"

# Behavior 2: trial days depend on plan (a RULE across inputs → parameterized, named)
@pytest.mark.parametrize("plan, days", [
    ("pro", 14),
    ("free", 0),
    ("enterprise", 30),
], ids=["pro", "free", "enterprise"])
def test_trial_days_by_plan(plan, days):
    assert signup(f"{plan}@x.com", "pw", plan=plan).trial_days == days

# Behavior 3: login works after signup
def test_login_succeeds_after_signup():
    signup("ada@x.com", "pw", plan="pro")
    assert login("ada@x.com", "pw").valid, "login should succeed after signup"

# Behavior 4: duplicate email is rejected
def test_duplicate_email_is_rejected():
    signup("ada@x.com", "pw", plan="pro")
    with pytest.raises(DuplicateEmail):
        signup("ada@x.com", "pw", plan="pro")
```

**Moves:** *Split by Behavior* (×4 tests), *Parameterize* the trial-days rule, *Assertion Message* on each remaining facet, and *Replace `try/except + assert False`* with `pytest.raises` (the idiomatic, self-describing way to assert an exception — the old form was its own mini-roulette).

**Why it's better:**
- A red run reads like broken requirements: `test_trial_days_by_plan[enterprise] FAILED`, `test_duplicate_email_is_rejected FAILED`. The *name* is the diagnosis.
- Behaviors fail **independently** — a broken signup no longer hides the login or duplicate-email checks (fail-fast masking gone).
- The trial-days rule is one parameterized test; adding a plan is one row, and each plan fails by name.
- The exception case uses `pytest.raises`, which fails legibly ("DID NOT RAISE DuplicateEmail") instead of a bare `assert False`.

**Granularity trade-off:** note Behavior 1 **kept four assertions** — they're facets of one outcome ("an active pro member was created"), so splitting them would duplicate the `signup` Arrange four times for zero diagnostic gain. We split on **behaviors**, parameterized the **rule**, and stopped there. Going further (one assert per test) would be fragment-itis: more Arrange, slower suite, noisier output.

</details>

---

## Exercise 2 — The pricing mega-test

**Starting smell:** a case-pile of pricing scenarios with bare `assertTrue`-style checks. **Goal:** each scenario isolated and named, each facet legible. **Constraint:** same coverage.

### Before

```java
// Java + JUnit 5 — every pricing scenario crammed into one method
@Test
void pricing() {
    assertTrue(price(cart(1000), "NONE") == 1000);
    assertTrue(price(cart(1000), "GOLD") == 900);     // 10% off
    assertTrue(price(cart(1000), "STAFF") == 700);    // 30% off
    assertTrue(price(cart(1000), "GOLD_HOLIDAY") == 850); // 10% + 5%
    assertTrue(price(cart(0), "GOLD") == 0);

    // and check the gold order's full breakdown
    Order o = priceOrder(cart(1000), "GOLD");
    assertTrue(o.getSubtotal() == 1000);
    assertTrue(o.getDiscount() == 100);
    assertTrue(o.getTotal() == 900);
}
```

### Plan it first

Two things are tangled: a **case-pile** (five tier→price pairs, a rule) and a **multi-facet check** of one gold order's breakdown (subtotal/discount/total). The `assertTrue(a == b)` form is the worst offender — it prints "expected true, got false" with no values. Parameterize the rule; keep the breakdown together but make it soft and labelled.

<details>
<summary>Solution</summary>

```java
class PricingTest {

    // The RULE across tiers → parameterized, each case named, values printed
    @ParameterizedTest(name = "{1} on 1000 -> {2}")
    @CsvSource({
        "1000, NONE,         1000",
        "1000, GOLD,          900",
        "1000, STAFF,         700",
        "1000, GOLD_HOLIDAY,  850",
        "0,    GOLD,            0",
    })
    void priceByTier(int subtotal, String tier, int expected) {
        assertThat(price(cart(subtotal), tier)).isEqualTo(expected);
    }

    // The BREAKDOWN of one order = facets of one outcome → one test, soft + labelled
    @Test
    void goldOrderBreakdown() {
        Order o = priceOrder(cart(1000), "GOLD");
        assertAll("gold order breakdown",
            () -> assertThat(o.getSubtotal()).as("subtotal").isEqualTo(1000),
            () -> assertThat(o.getDiscount()).as("discount").isEqualTo(100),
            () -> assertThat(o.getTotal()).as("total").isEqualTo(900));
    }
}
```

**Moves:** *Parameterize* (`@ParameterizedTest` + `@CsvSource`) for the tier rule, *Replace bare `assertTrue(a==b)` with `assertThat(...).isEqualTo(...)`* (prints values), *Soft-assert* (`assertAll`) the breakdown facets, *Assertion Description* (`.as(...)`).

**Why it's better:**
- A failing tier reports `priceByTier(GOLD on 1000 -> 900)` — the exact scenario, with AssertJ printing `expected: 900 but was: 950`. No more "expected true, got false."
- Each tier case is independent (no fail-fast across the five).
- The breakdown's three facets are *one* behavior; `assertAll` reports all three at once, so if discount **and** total are wrong you see both — which speeds diagnosis of a pricing-formula bug because you see the relationship.

**Granularity trade-off:** the breakdown stays a **single test** — splitting subtotal/discount/total into three tests would re-run `priceOrder` three times and lose the at-a-glance "discount + total both wrong → formula bug" signal. The tier rule is parameterized rather than split into five methods, keeping it DRY while isolating cases. That's the sweet spot: parameterize *cases*, soft-assert *facets*, split *behaviors*.

</details>

---

## Exercise 3 — The API response avalanche

**Starting smell:** a long chain of soft asserts on an API response, with a hidden nil-deref hazard and a check that recurs across many tests. **Goal:** safe assertion modes + a reusable custom assertion. **Constraint:** same coverage.

### Before

```go
// Go — verifies a /me response; this exact block is copy-pasted in 8 tests
func TestMe(t *testing.T) {
    resp, err := client.Get("/me")
    assert.NoError(t, err)
    assert.Equal(t, 200, resp.Status)
    assert.Equal(t, "ada", resp.Body.Name)        // panics if resp is nil
    assert.Equal(t, "pro", resp.Body.Plan)
    assert.Equal(t, "UTC", resp.Body.Timezone)
    assert.True(t, resp.Body.Verified)
    assert.NotEmpty(t, resp.Body.ID)
}
```

### Plan it first

Two problems. (1) **Assertion mode:** `err`/`resp` are *preconditions* — if the request errors or `resp` is nil, every `resp.Body.*` line dereferences nil and **panics**, burying the real failure. These must be fail-fast (`require`); the field facets can stay soft (`assert`). (2) **Duplication:** the same field-block is copy-pasted in 8 tests with drift-prone messages — extract a **custom domain assertion**.

<details>
<summary>Solution</summary>

```go
// One reusable, named assertion for "this is the expected /me body".
type meWant struct {
    Status   int
    Name     string
    Plan     string
    Timezone string
}

func assertMeResponse(t *testing.T, resp *Response, err error, want meWant) {
    t.Helper()                                   // failures point at the caller
    require.NoError(t, err)                       // precondition: stop on transport error
    require.NotNil(t, resp, "response must be non-nil")  // precondition: guard the deref
    require.Equal(t, want.Status, resp.Status, "http status")

    // independent facets of the body → soft, each labelled
    assert.Equal(t, want.Name, resp.Body.Name, "name")
    assert.Equal(t, want.Plan, resp.Body.Plan, "plan")
    assert.Equal(t, want.Timezone, resp.Body.Timezone, "timezone")
    assert.True(t, resp.Body.Verified, "verified")
    assert.NotEmpty(t, resp.Body.ID, "id")
}

func TestMe(t *testing.T) {
    resp, err := client.Get("/me")
    assertMeResponse(t, resp, err, meWant{
        Status: 200, Name: "ada", Plan: "pro", Timezone: "UTC",
    })
}
```

**Moves:** *Hybrid assertion mode* (`require` for preconditions that guard the deref, `assert` for independent facets), *Extract Custom Assertion* (the named helper), *`t.Helper()`* so failures report the caller, *Assertion Message* on every field.

**Why it's better:**
- **No buried failures.** If the request errors or `resp` is nil, `require.NoError`/`require.NotNil` stop the test with a clear message — instead of a nil-panic stack trace hiding the real cause (the fix from `find-bug.md` Snippet 5).
- **Independent facets soft-assert**, so a wrong plan *and* a wrong timezone both report in one run.
- **DRY across 8 tests:** the field checks and their messages live in one place, so they can't drift per call site (the message-discipline win from `professional.md`). Each of the 8 tests shrinks to one self-describing call: `assertMeResponse(t, resp, err, meWant{...})`.
- **Failures point at the caller** via `t.Helper()`, so you see *which test* failed, not the helper's internals.

**Granularity trade-off:** we did *not* split the `/me` body into 5 separate tests — those fields are facets of one outcome ("the profile response is correct"), and 8 callers × 5 tests would be 40 near-identical methods with duplicated request setup. The custom assertion keeps it DRY *and* legible — the right tool when splitting would explode Arrange. (The Java equivalent is an AssertJ `AbstractAssert` subclass: `assertThat(resp).isOk().hasName("ada").hasPlan("pro");`.)

</details>

---

## Wrap-Up — the refactoring playbook

Across all three, the same ordered judgement applies:

1. **Identify the behaviors.** Each distinct Act / "could fail for an unrelated reason" is its own test. Split those.
2. **Find the rules-across-inputs.** A case-pile becomes a **parameterized test** with **named** cases — DRY and isolated.
3. **Keep facets of one outcome together**, but make them **soft-asserted and labelled** so all report in one run.
4. **Guard the preconditions.** Hard-assert (`require`) anything that, if false, makes later assertions meaningless or unsafe (nil, error, wrong type); soft-assert the rest.
5. **Extract a custom assertion** when a multi-facet check recurs — DRY the checks *and* their messages in one drift-proof place.
6. **Stop before fragment-itis.** Don't split facets into one-assert tests; you'd duplicate Arrange, slow the suite, and add noise. The target is **one reason to fail per test**, not one assertion.

The destination is always the same: a red run where **the test name and the labelled values tell you what broke**, achieved at the *lowest* cost in duplicated setup and runtime.

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — the level progression and the trade-offs.
- [`find-bug.md`](find-bug.md) — recognition practice; [`tasks.md`](tasks.md) — smaller targeted fix-it drills.
- [`interview.md`](interview.md) — Q&A across all levels.
- [Slow Tests](../05-slow-tests/optimize.md) — what over-splitting costs at runtime.
- [Fragile Tests](../01-fragile-tests/optimize.md) — refactoring over-specified tests.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) · [Bad Structure](../../01-development/01-bad-structure/optimize.md).
