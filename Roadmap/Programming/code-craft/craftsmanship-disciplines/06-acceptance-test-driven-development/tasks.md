# Acceptance Test-Driven Development — Practice Tasks

> **Category:** [Craftsmanship Disciplines](../README.md) — drive development from executable acceptance criteria agreed with the business.

10 graded hands-on tasks with full solutions in Gherkin plus Python (behave) and Java (Cucumber) step definitions. Try each before expanding the solution.

---

## Table of Contents

1. [Task 1: User Story → Gherkin](#task-1-user-story-gherkin)
2. [Task 2: Wire a Step Definition](#task-2-wire-a-step-definition)
3. [Task 3: Drive a Feature Outside-In](#task-3-drive-a-feature-outside-in)
4. [Task 4: Fix a UI-Coupled Test (Push to the Service Layer)](#task-4-fix-a-ui-coupled-test-push-to-the-service-layer)
5. [Task 5: Make an Imperative Scenario Declarative](#task-5-make-an-imperative-scenario-declarative)
6. [Task 6: Scenario Outline for a Rule Table](#task-6-scenario-outline-for-a-rule-table)
7. [Task 7: Run an Example Mapping Session](#task-7-run-an-example-mapping-session)
8. [Task 8: Isolate Scenario Test Data](#task-8-isolate-scenario-test-data)
9. [Task 9: Stub an External Dependency](#task-9-stub-an-external-dependency)
10. [Task 10: Rebalance an Ice-Cream-Cone Suite](#task-10-rebalance-an-ice-cream-cone-suite)
11. [Practice Tips](#practice-tips)

---

## Task 1: User Story → Gherkin

**Goal:** Turn a vague user story into a declarative scenario with concrete examples, including a boundary case.

**Given the story:**

> "As a member, I want to earn loyalty points on purchases, so that I'm rewarded. Members earn 1 point per dollar; orders of $50+ earn double points."

<details><summary>Solution</summary>

```gherkin
Feature: Loyalty points
  As a member
  I want to earn points on purchases
  So that I'm rewarded for spending

  Scenario Outline: Points earned per order
    Given a member places an order of $<amount>
    When the order completes
    Then the member earns <points> points

    Examples:
      | amount | points | note                       |
      | 10     | 10     | 1x below threshold         |
      | 49     | 49     | just below the boundary    |
      | 50     | 100    | exactly at threshold (2x)  |
      | 80     | 160    | 2x above threshold         |
```

**Why:** Declarative (no UI mechanics), the `Examples` table *is* the rule's specification, and the `49`/`50` rows pin down the boundary — exactly the ambiguity a Three Amigos conversation surfaces. The `$50+` wording was ambiguous ("+" inclusive?); the examples make it unambiguous.
</details>

---

## Task 2: Wire a Step Definition

**Goal:** Connect the scenario from Task 1 to real code at the **service layer** (no UI).

<details><summary>Solution</summary>

### Python (behave)
```python
from behave import given, when, then
from loyalty.service import LoyaltyService, Order

@given('a member places an order of ${amount:d}')
def step_order(context, amount):
    context.service = LoyaltyService()
    context.order = Order(amount=amount)

@when('the order completes')
def step_complete(context):
    context.points = context.service.points_for(context.order)

@then('the member earns {points:d} points')
def step_assert(context, points):
    assert context.points == points, f"got {context.points}, want {points}"
```

### Java (Cucumber)
```java
public class LoyaltySteps {
    private final LoyaltyService service = new LoyaltyService();
    private Order order;
    private int points;

    @Given("a member places an order of ${int}")
    public void placesOrder(int amount) { order = new Order(amount); }

    @When("the order completes")
    public void completes() { points = service.pointsFor(order); }

    @Then("the member earns {int} points")
    public void earns(int expected) { assertEquals(expected, points); }
}
```

**Why:** Each step does one job — `Given` sets up, `When` performs the single action, `Then` asserts. The step calls the real `LoyaltyService` in-process: fast and stable. The Gherkin knows nothing about Python/Java classes.
</details>

---

## Task 3: Drive a Feature Outside-In

**Goal:** Implement `points_for` from scratch using the double loop. Write nothing the failing tests don't demand.

<details><summary>Solution</summary>

**The sequence:**

```text
1. OUTER red:  run scenario → fails (LoyaltyService.points_for missing)
2. INNER:      unit test test_base_rate (10 → 10) → implement → green → refactor
3. OUTER:      re-run → rows 10 and 49 pass; 50 and 80 fail (no 2x)
4. INNER:      unit test test_double_at_50 (50 → 100) → implement threshold → green → refactor
5. OUTER:      re-run → all rows green → feature done
```

### Python — the code the loop produces
```python
from dataclasses import dataclass

@dataclass
class Order:
    amount: int

class LoyaltyService:
    def points_for(self, order: Order) -> int:
        multiplier = 2 if order.amount >= 50 else 1
        return order.amount * multiplier
```

### The inner unit tests that drove it
```python
def test_base_rate():
    assert LoyaltyService().points_for(Order(10)) == 10

def test_double_at_threshold():
    assert LoyaltyService().points_for(Order(50)) == 100
```

**Why:** The acceptance test's failures dictated the order of work and stopped you the instant the behavior was complete — no gold-plating. The unit tests give precise, fast feedback; the acceptance test proves they add up to the feature.
</details>

---

## Task 4: Fix a UI-Coupled Test (Push to the Service Layer)

**Goal:** A scenario drives the real browser and breaks on every layout change. Move it down to the service layer without changing the business-readable scenario.

**Given — brittle UI step definition:**

```python
@when('she transfers ${amt:d} from checking to savings')
def step(context, amt):
    context.browser.visit("/transfer")
    context.browser.fill("#amount", amt)
    context.browser.select("#from", "checking")
    context.browser.select("#to", "savings")
    context.browser.click("#submit")          # couples to the DOM; slow; flaky
```

<details><summary>Solution</summary>

The **Gherkin stays exactly the same** (`When she transfers $40 from checking to savings`). Only the step definition changes:

### Python (behave)
```python
@when('she transfers ${amt:d} from checking to savings')
def step(context, amt):
    context.result = context.bank.transfer(   # real service, in-process
        user="ada", src="checking", dst="savings", amount=amt)

@then('checking shows ${chk:d} and savings shows ${sav:d}')
def step(context, chk, sav):
    assert context.bank.balance("ada", "checking") == chk
    assert context.bank.balance("ada", "savings") == sav
```

### Java (Cucumber)
```java
@When("she transfers ${int} from checking to savings")
public void sheTransfers(int amt) {
    bank.transfer("ada", "checking", "savings", Money.of(amt));
}
```

**Why:** The behavior (transfer money) is identical; the *layer* it's verified at moved from the brittle DOM to the stable service API. The test is now milliseconds instead of seconds, deterministic instead of flaky, and survives UI redesigns. Keep one *separate* thin UI smoke test to prove the form is wired to the service — but verify the rule here.
</details>

---

## Task 5: Make an Imperative Scenario Declarative

**Goal:** Rewrite a click-by-click scenario as a statement of business intent.

**Given — imperative:**

```gherkin
Scenario: Checkout
  Given I am on the home page
  When I click "Shop"
  And I click "Add to cart" on product "Widget"
  And I click the cart icon
  And I click "Checkout"
  And I fill "card" with "4242..." and click "Pay"
  Then I see a page with text "Thank you"
```

<details><summary>Solution</summary>

```gherkin
Scenario: A shopper completes a purchase
  Given a shopper with a "Widget" in their cart
  When they pay with a valid card
  Then their order is confirmed
```

**Why:** The declarative version describes *what the shopper accomplishes*, not the sequence of clicks. It's readable by the business (living documentation), survives any UI or flow redesign, and pushes all the mechanism (navigation, form filling) down into step definitions. A failure now means "purchase is broken," not "the cart icon moved." The original had no single `When` and asserted on page text — both smells the rewrite fixes.
</details>

---

## Task 6: Scenario Outline for a Rule Table

**Goal:** Three near-duplicate scenarios share one behavior with different inputs. Collapse them into a Scenario Outline (Specification by Example).

**Given — duplicated:**

```gherkin
Scenario: Standard user gets no discount
  Given a standard user with a $100 cart
  When they check out
  Then they pay $100

Scenario: Silver user gets 5% off
  Given a silver user with a $100 cart
  When they check out
  Then they pay $95

Scenario: Gold user gets 10% off
  Given a gold user with a $100 cart
  When they check out
  Then they pay $90
```

<details><summary>Solution</summary>

```gherkin
Scenario Outline: Tier discount on checkout
  Given a <tier> user with a $100 cart
  When they check out
  Then they pay $<total>

  Examples:
    | tier     | total |
    | standard | 100   |
    | silver   | 95    |
    | gold     | 90    |
```

**Why:** One behavior, one scenario, a table of examples. The table reads as the discount-tier specification — the business can review and extend it by adding a row. Each row still runs as a separate test with its own pass/fail, so you keep granular signal while removing duplication.
</details>

---

## Task 7: Run an Example Mapping Session

**Goal:** Given a story, produce the four card types of Example Mapping (story / rules / examples / questions) — the practical Three Amigos.

**Story:** "Customers can return items for a refund."

<details><summary>Solution</summary>

```text
🟨 STORY:    Customer returns an item for a refund

🟦 RULE 1:   Returns within 30 days get a full cash refund
   🟩 ex:    Delivered 5 days ago  → full cash refund
   🟩 ex:    Delivered 30 days ago → full cash refund (boundary)

🟦 RULE 2:   Returns after 30 days get store credit only
   🟩 ex:    Delivered 31 days ago → store credit, no cash (boundary)
   🟩 ex:    Delivered 90 days ago → store credit

🟦 RULE 3:   Final-sale items can't be returned
   🟩 ex:    Final-sale item, 5 days ago → return rejected

🟥 QUESTION: What about items damaged in shipping after 30 days?  (unresolved)
🟥 QUESTION: Is the 30 days from delivery or from purchase?       (unresolved)
```

**Why:** The two 🟥 red cards are misunderstandings caught *before* a line of code — the entire payoff of the Three Amigos. The boundary examples (day 30 vs day 31) come from the QA perspective. The green examples become Scenario Outlines. A story with unresolved reds isn't ready to build — it returns to refinement.
</details>

---

## Task 8: Isolate Scenario Test Data

**Goal:** A suite shares a seeded database; scenarios fail intermittently when run in parallel because they depend on each other's data. Make each scenario own its world.

**Given — the problem:** scenario B assumes a user that scenario A created.

<details><summary>Solution</summary>

### Python (behave) — transactional rollback per scenario
```python
# environment.py
def before_scenario(context, scenario):
    context.tx = db.begin()              # fresh transaction
    context.bank = BankService(db)

def after_scenario(context, scenario):
    context.tx.rollback()               # discard everything the scenario created
```

```python
# every scenario creates exactly the data it needs in Given:
@given('a customer "{name}" with ${balance:d} in checking')
def step(context, name, balance):
    context.bank.open_account(name, "checking", balance)
```

### Java (Cucumber + Spring)
```java
@CucumberContextConfiguration
@SpringBootTest
@Transactional   // each scenario runs in a transaction, rolled back after
public class CucumberSpringConfig { }
```

**Why:** With each scenario starting from an empty, isolated world and rolling back after, there's no leftover state, no order-dependence, and the suite can run **in parallel** without collisions — the prerequisite for keeping CI fast. Builders/object-mothers in `Given` keep setup readable. This single change kills the most common source of acceptance-suite flakiness.
</details>

---

## Task 9: Stub an External Dependency

**Goal:** A scenario hits a real email/payment provider, making it slow and flaky. Stub the dependency at the boundary; verify behavior against the stub.

**Given — calls the real provider:**

```python
@when('she requests a password reset')
def step(context):
    context.auth.request_reset(context.user)   # really sends an email via SES → flaky, slow
```

<details><summary>Solution</summary>

### Python (behave) — inject a fake mailer
```python
# environment.py
def before_scenario(context, scenario):
    context.mailer = FakeMailer()                 # records sends, sends nothing
    context.auth = AuthService(mailer=context.mailer)

# steps
@when('she requests a password reset')
def step(context):
    context.auth.request_reset(context.user)

@then('she receives a reset link by email')
def step(context):
    sent = context.mailer.last_to(context.user.email)
    assert sent is not None and "reset" in sent.body   # assert on behavior, via the fake
```

```python
class FakeMailer:
    def __init__(self): self.sent = []
    def send(self, to, subject, body): self.sent.append(Email(to, subject, body))
    def last_to(self, addr): return next((m for m in reversed(self.sent) if m.to == addr), None)
```

**Why:** The scenario now runs in-memory — fast, deterministic, no network. You still verify the real behavior ("a reset email is sent to her with a link") against the fake. The *contract* with the real email provider is verified separately (a contract test or a single integration test), keeping that slow/flaky check out of the main acceptance suite — pushing integration confidence down the pyramid.
</details>

---

## Task 10: Rebalance an Ice-Cream-Cone Suite

**Goal:** A team has 200 slow UI scenarios verifying business rules and almost no unit tests. Propose the rebalance and show the move for one rule.

<details><summary>Solution</summary>

**The plan:**

```text
BEFORE (cone):  ~200 UI scenarios · ~10 service · ~20 unit   → 35-min flaky build
AFTER (pyramid):
  • Move each business RULE from UI → service-layer scenario (fast, stable)
  • Keep ~15 UI SMOKE scenarios: prove screens are wired to services
  • Build out UNIT tests for edge cases / pure logic (was tested through UI)
  → target: ~15 UI · ~60 service · ~300 unit · <5-min build
```

**One rule moved — discount math:**

```gherkin
# WAS: a UI scenario clicking through the cart to check the total.
# NOW: a service-layer scenario.
Scenario: Gold members get 10% off orders over $100
  Given a gold member with a $200 cart
  When they check out
  Then they are charged $180
```

```python
@when('they check out')
def step(context):
    context.charged = Checkout().total_for(context.cart, context.member)  # service layer
```

Plus a **single** thin UI smoke test that the cart page shows *a* total — not the math:

```gherkin
@smoke
Scenario: Cart page displays a total
  Given a member with items in their cart
  When they open the cart page
  Then a total is displayed
```

**Why:** Business rules now run in milliseconds at the service layer with precise failures; the UI layer shrinks to proving wiring (the one thing only it can verify); edge cases drop to fast unit tests. The build gets fast and trustworthy, refactoring stops breaking dozens of tests, and the team starts trusting red again. This is the single most valuable large-scale fix a senior makes to a test suite.
</details>

---

## Practice Tips

1. **Always see a new scenario fail first** — a green test you never watched go red proves nothing.
2. **Keep `Given/When/Then` in their lanes** — setup, one action, observable outcome.
3. **Be declarative** — business intent in Gherkin, mechanism in step definitions.
4. **Default to the service layer**; reserve a thin UI layer for wiring smoke tests.
5. **Use Scenario Outlines** for rule tables; include boundary rows.
6. **Isolate scenario data** (transactional rollback / fresh setup) so the suite is parallel-safe and non-flaky.
7. **Stub external deps** at the boundary; verify the real contract separately.
8. **Do the conversation** (Example Mapping) — red cards are the payoff, not the syntax.

---

[← Interview](interview.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
