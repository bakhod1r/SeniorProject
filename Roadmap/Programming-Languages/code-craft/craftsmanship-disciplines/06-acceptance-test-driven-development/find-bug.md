# Acceptance Test-Driven Development — Find the Bug

> **Category:** [Craftsmanship Disciplines](../README.md) — drive development from executable acceptance criteria agreed with the business.

12 broken acceptance tests, scenarios, and step definitions. Spot the bug, then expand the fix and the lesson. These are the failures that turn an acceptance suite from an asset into a liability.

---

## Table of Contents

1. [Bug 1: Imperative, UI-Coupled Scenario](#bug-1-imperative-ui-coupled-scenario)
2. [Bug 2: Step That Asserts Nothing](#bug-2-step-that-asserts-nothing)
3. [Bug 3: Scenario Tests Implementation, Not Behavior](#bug-3-scenario-tests-implementation-not-behavior)
4. [Bug 4: Multiple Whens in One Scenario](#bug-4-multiple-whens-in-one-scenario)
5. [Bug 5: Assertion in the Given](#bug-5-assertion-in-the-given)
6. [Bug 6: Order-Dependent Scenarios](#bug-6-order-dependent-scenarios)
7. [Bug 7: sleep() Instead of Wait-for-Condition](#bug-7-sleep-instead-of-wait-for-condition)
8. [Bug 8: Step Hits a Stub, Not the Real Service](#bug-8-step-hits-a-stub-not-the-real-service)
9. [Bug 9: Acceptance Test Written After the Code](#bug-9-acceptance-test-written-after-the-code)
10. [Bug 10: Missing Three-Amigos Clarity (Ambiguous Scenario)](#bug-10-missing-three-amigos-clarity-ambiguous-scenario)
11. [Bug 11: Everything Tested at the UI Layer](#bug-11-everything-tested-at-the-ui-layer)
12. [Bug 12: Time/Random Nondeterminism](#bug-12-timerandom-nondeterminism)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Imperative, UI-Coupled Scenario

```gherkin
Scenario: Login
  Given I open "/login"
  When I type "ada@example.com" into "#email"
  And I type "secret" into "#password"
  And I click "#login-btn"
  Then "#welcome-banner" should contain "Hello, Ada"
```

**Symptoms:** Breaks on every CSS/layout change. The banner id is renamed in a redesign and 40 scenarios go red even though login works perfectly.

<details><summary>Find the bug</summary>

The scenario describes *clicks and selectors*, not *behavior*. It couples the spec to incidental DOM structure, so cosmetic changes break it and a non-developer can't read it.

</details>

### Fix

```gherkin
Scenario: Registered user logs in
  Given a registered user "ada@example.com"
  When she logs in with the correct password
  Then she sees her dashboard
```

Move all the typing/clicking into step definitions (and ideally drive the service layer).

### Lesson

Scenarios state *what the user achieves*, not *how they click*. Mechanism belongs in step definitions; the `.feature` file stays declarative and business-readable.

---

## Bug 2: Step That Asserts Nothing

```python
@then('the order is confirmed')
def step_order_confirmed(context):
    pass    # BUG: placeholder never filled in — can never fail
```

**Symptoms:** The scenario is green from the day it was written. The feature is subtly broken in production; the test never noticed.

<details><summary>Find the bug</summary>

The `Then` step contains no assertion. A scenario whose `Then` does nothing always passes — it's a lie that reports "verified."

</details>

### Fix

```python
@then('the order is confirmed')
def step_order_confirmed(context):
    assert context.order.status == "CONFIRMED", \
        f"expected CONFIRMED, got {context.order.status}"
```

### Lesson

Every `Then` must assert an observable outcome. A `Then` with no assertion is a guard that doesn't guard. Add a CI check that `Then` steps assert, and **always watch a new scenario fail first**.

---

## Bug 3: Scenario Tests Implementation, Not Behavior

```gherkin
Scenario: Place an order
  Given a cart with one item
  When I check out
  Then a row is inserted into the "orders" table with status = 2
  And a record exists in "order_events" with type = "CREATED"
```

**Symptoms:** A storage refactor (renaming the column, changing the status enum to a string) breaks the scenario though the feature behaves identically. The business can't read it.

<details><summary>Find the bug</summary>

The `Then` asserts on the database schema and a magic number (`status = 2`) — implementation details. It couples the spec to storage and is unreadable as a requirement.

</details>

### Fix

```gherkin
Scenario: Place an order
  Given a cart with one item
  When I check out
  Then the order is confirmed
```

The step definition *may* check the DB internally, but assert via the behavior:

```python
@then('the order is confirmed')
def step(context):
    assert context.order_service.status_of(context.order_id) == OrderStatus.CONFIRMED
```

### Lesson

Test through behavior, not internals. Couple to the stable public contract (a service method), never to schema columns or magic numbers. This is "testing through the wrong layer."

---

## Bug 4: Multiple Whens in One Scenario

```gherkin
Scenario: Account lifecycle
  Given a new user
  When they register
  When they verify their email
  When they place an order
  When they request a refund
  Then they have a refunded order
```

**Symptoms:** When it fails, you can't tell *which* action broke — register? verify? order? refund? Debugging is a bisect.

<details><summary>Find the bug</summary>

Four `When`s mean four behaviors crammed into one scenario. A failure gives no signal about which behavior is broken, and the scenario is testing a whole lifecycle instead of one rule.

</details>

### Fix

Split into focused scenarios, each with one `When`:

```gherkin
Scenario: A verified user can place an order
  Given a verified user
  When they place an order
  Then the order is created

Scenario: A user can refund a recent order
  Given a verified user with a recent order
  When they request a refund
  Then the order is refunded
```

### Lesson

One `When`, one behavior per scenario. Set up prior state in `Given` (not by replaying earlier actions). A focused scenario fails with a clear message about *which* behavior broke.

---

## Bug 5: Assertion in the Given

```python
@given('a user with a verified email')
def step(context):
    context.user = db.find_user("ada")
    assert context.user.verified    # BUG: assertion in setup
```

**Symptoms:** When the user isn't verified, the test fails in the `Given` with a confusing message that looks like the *feature* failed, when really the *setup* is wrong.

<details><summary>Find the bug</summary>

The `Given` asserts instead of establishing state. Preconditions should *create* the world the scenario needs, not check a pre-existing one. A failing assertion in setup masquerades as a behavioral failure.

</details>

### Fix

```python
@given('a user with a verified email')
def step(context):
    context.user = make_user("ada", verified=True)   # establish the precondition
```

### Lesson

`Given` *sets up*, `Then` *checks*. Build the required state in the `Given` rather than asserting it exists — that keeps failures attributable to behavior, not flaky test fixtures.

---

## Bug 6: Order-Dependent Scenarios

```python
# scenario A creates the user...
@given('the standard test user')
def step(context):
    db.insert_user("ada")          # BUG: leaks into the shared DB

# scenario B (later) assumes it exists
@given('the existing user "ada"')
def step(context):
    context.user = db.find_user("ada")   # only works if A ran first
```

**Symptoms:** Passes when run in file order; fails intermittently once CI runs scenarios in parallel or shuffles them. Classic "works on my machine."

<details><summary>Find the bug</summary>

Scenario B depends on data scenario A created in a shared database. The scenarios aren't independent, so any change to order (parallelism, sharding) breaks B.

</details>

### Fix

Each scenario owns its world, with per-scenario isolation:

```python
def before_scenario(context, scenario):
    context.tx = db.begin()
def after_scenario(context, scenario):
    context.tx.rollback()          # nothing leaks between scenarios

@given('the existing user "ada"')
def step(context):
    context.user = make_user("ada")   # B creates its own data
```

### Lesson

Scenarios must be independent: own setup, own teardown (transactional rollback or fresh data), no reliance on order. Independence is the prerequisite for parallel CI and the cure for the most common flakiness.

---

## Bug 7: sleep() Instead of Wait-for-Condition

```python
@when('she submits the form')
def step(context):
    context.browser.click("#submit")
    time.sleep(2)                   # BUG: fixed sleep
    context.result = context.browser.text("#status")
```

**Symptoms:** Flaky. On a slow CI runner the response takes 2.5s and the test reads the old status (fail); on a fast run it wastes 2s every time.

<details><summary>Find the bug</summary>

A fixed `sleep` races the system: too short → flaky failure, too long → slow suite. It guesses at timing instead of waiting for the actual condition.

</details>

### Fix

```python
@when('she submits the form')
def step(context):
    context.browser.click("#submit")
    wait_until(lambda: context.browser.text("#status") != "",  timeout=10)
    context.result = context.browser.text("#status")
```

### Lesson

Never `sleep`; wait for a *condition* (element present, status changed, network idle) with a timeout. Fixed sleeps are the #1 source of UI-test flakiness — and another reason to prefer the synchronous service layer.

---

## Bug 8: Step Hits a Stub, Not the Real Service

```python
@when('the discount is applied')
def step(context):
    context.total = 90.0           # BUG: hard-codes the answer instead of calling the system
```

**Symptoms:** The scenario is permanently green regardless of whether the discount logic works. A bug in `Checkout` ships undetected.

<details><summary>Find the bug</summary>

The step fakes the result instead of exercising the real system. The "acceptance test" tests nothing about the actual code — it asserts a constant against a constant.

</details>

### Fix

```python
@when('the discount is applied')
def step(context):
    context.total = Checkout().total_for(context.cart, context.member)  # real service

@then('the total is ${expected:f}')
def step(context, expected):
    assert context.total == expected
```

### Lesson

Acceptance steps must drive the **real** collaborators (the service layer, real domain logic). Stubbing the system-under-test out of its own test makes the green meaningless. Stub only *external* dependencies (email, payment), never the code you're verifying.

---

## Bug 9: Acceptance Test Written After the Code

```text
Workflow observed in the PR:
  1. Developer builds the feature.
  2. Developer writes a Gherkin scenario that matches what they built.
  3. Scenario passes on first run. ✅
```

**Symptoms:** The scenario codifies whatever the code happens to do — including the misunderstanding. It passes immediately, so it never caught "built the wrong thing," and nobody saw it red.

<details><summary>Find the bug</summary>

The acceptance test was written *after* the code, so it can only confirm the existing behavior, not challenge whether that behavior is what the business wanted. It's a regression test masquerading as a design tool, and it was never seen failing.

</details>

### Fix

Reverse the order: Three Amigos / Example Mapping → write the scenario → see it **red** → build outside-in until green. The conversation and the red-first step are where ATDD's value lives.

### Lesson

ATDD is *test-first at the feature level*. A scenario written after the code (and never seen red) proves regression-safety at best and, at worst, locks in the wrong behavior. Order matters.

---

## Bug 10: Missing Three-Amigos Clarity (Ambiguous Scenario)

```gherkin
Scenario: Apply the right discount
  Given a customer with an order
  When they check out
  Then they get an appropriate discount
```

**Symptoms:** "Appropriate" means different things to product, dev, and QA. The scenario can't be automated (what's the expected number?) and three people will implement three rules.

<details><summary>Find the bug</summary>

The scenario is abstract prose, not a concrete example. "An order," "appropriate discount" — nothing is pinned down. This is exactly the ambiguity a Three Amigos conversation exists to remove, skipped.

</details>

### Fix

Run Example Mapping to extract concrete examples, then a Scenario Outline:

```gherkin
Scenario Outline: Tier discount
  Given a <tier> customer with a $<subtotal> order
  When they check out
  Then they are charged $<total>

  Examples:
    | tier   | subtotal | total |
    | bronze | 100      | 100   |
    | silver | 100      | 95    |
    | gold   | 100      | 90    |
    | gold   | 100.00   | 90.00 |
```

### Lesson

Specify with **concrete examples**, not adjectives. If a scenario can't be turned into a number, the requirement isn't understood yet — that's a red card for the Three Amigos, caught before coding.

---

## Bug 11: Everything Tested at the UI Layer

```text
Suite composition:
  • 240 Selenium scenarios (every business rule, every edge case)
  • 8 unit tests
  • CI: 38 minutes, ~12% flaky → developers merge through red
```

**Symptoms:** Slow build, chronic flakiness, vague failures, fear of refactoring. A real regression ships behind the flaky noise.

<details><summary>Find the bug</summary>

This is the **ice-cream-cone** anti-pattern: an inverted pyramid with business rules and edge cases verified through the slow, brittle UI instead of fast service-layer and unit tests.

</details>

### Fix

Rebalance toward the pyramid:

```text
  • Move business RULES from UI → service-layer scenarios (fast, stable)
  • Keep ~15 UI SMOKE tests: prove screens are wired to services
  • Build out UNIT tests for edge cases / pure logic
  → target build < 5 min, flakiness < 1%
```

### Lesson

Push every test as far *down* the pyramid as it can go. UI tests verify *wiring*, not business rules. The cone is the most common large-scale suite pathology and the most valuable thing to fix.

---

## Bug 12: Time/Random Nondeterminism

```python
@then('the refund is a full cash refund')
def step(context):
    days = (datetime.now() - context.order.delivered_at).days   # BUG: real clock
    assert days <= 30
    assert context.refund.type == "CASH"
```

**Symptoms:** A scenario set up with "delivered 30 days ago" passes today and fails tomorrow as real time advances past the boundary. Intermittent failures with no code change.

<details><summary>Find the bug</summary>

The step reads the real wall-clock (`datetime.now()`), so the result depends on *when* the test runs. Time-dependent and random behavior must be controlled, or scenarios near boundaries flake as the world moves.

</details>

### Fix

Inject a fixed clock (and seed any RNG):

```python
def before_scenario(context, scenario):
    context.clock = FixedClock("2026-06-10")        # deterministic "now"
    context.refunds = RefundService(clock=context.clock)

@given('an order delivered {n:d} days ago')
def step(context, n):
    context.order = make_order(delivered_at=context.clock.now() - timedelta(days=n))
```

### Lesson

Control time and randomness — inject a clock, seed RNG, assert on sets not order. Nondeterminism near boundaries is a classic flakiness source; a fixed clock makes "30 days ago" mean the same thing on every run.

---

## Practice Tips

1. **Read every scenario as a non-developer** — if it has ids/clicks/SQL, it's coupled to the wrong layer.
2. **Check every `Then` asserts** an observable outcome — hunt for `pass` and "didn't throw" steps.
3. **Count the `When`s** — more than one means split the scenario.
4. **Verify `Given` sets up, doesn't assert.**
5. **Look for shared/leftover data** — can scenarios run in parallel and any order?
6. **Grep for `sleep(`, `datetime.now()`, `random(`** — nondeterminism and flakiness.
7. **Confirm steps drive the real system**, not stubbed constants — and that the scenario was seen red first.
8. **Check the pyramid ratio** — is business logic being verified through the UI?

---

[← Tasks](tasks.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
