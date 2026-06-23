# Acceptance Test-Driven Development — Interview Questions

> **Category:** [Craftsmanship Disciplines](../README.md) — drive development from executable acceptance criteria agreed with the business.

Conceptual and coding questions, graded junior → professional, plus coding tasks, trick, and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What is ATDD?

**Answer:** Acceptance Test-Driven Development — starting a feature by writing an executable acceptance test (in business language) that defines "done," then writing code until it passes. It answers "would the customer accept this?", not "does this function return the right value?"

### J2. How is an acceptance test different from a unit test?

**Answer:** A unit test verifies one unit in isolation, in code terms (methods, return values). An acceptance test verifies a whole feature end-to-end through a realistic slice of the system, in business terms (users, actions, outcomes). One proves *built correctly*; the other proves *built the right thing*.

### J3. What are the three beats of a BDD scenario?

**Answer:** **Given** (preconditions / starting state), **When** (the single action under test), **Then** (the expected observable outcome). Setup, action, assertion.

### J4. What is a step definition?

**Answer:** The code that connects one Gherkin line to an action against the system. The `.feature` file is business English; the step definition translates each line into a method call.

### J5. What is the "outer loop"?

**Answer:** The slow ATDD cycle — failing acceptance test → build → acceptance passes — that wraps the fast inner unit-TDD cycle (red-green-refactor). The acceptance test is in the outer loop.

### J6. Why write the acceptance test before the code?

**Answer:** To catch "we're building the wrong thing" while it's cheap to fix (a sentence), and to get a concrete, agreed definition of done before any code exists.

### J7. What is Gherkin?

**Answer:** The structured plain-text language (`Feature`/`Scenario`/`Given`/`When`/`Then`) used to write BDD scenarios that tools like Cucumber, behave, and SpecFlow execute.

### J8. What's the difference between a declarative and an imperative scenario?

**Answer:** Declarative describes *what* the user achieves ("she logs in with the correct password"); imperative describes *how* they do it click-by-click ("type into #email, click #submit"). Declarative is readable and stable; imperative is brittle.

### J9. What does it mean that a scenario is "living documentation"?

**Answer:** It's documentation that runs as a test and fails the build when the code no longer matches it — so it can't silently go stale or lie.

### J10. Name a tool that runs Gherkin.

**Answer:** Cucumber (JVM/JS/Ruby), behave or pytest-bdd (Python), SpecFlow/Reqnroll (.NET).

---

## Middle Questions

### M1. Explain the double loop.

**Answer:** A slow outer acceptance loop wraps many fast inner unit-TDD loops. You write a failing acceptance test; its failures point at the first missing piece; you build that piece with a unit-TDD cycle; re-run the acceptance test; repeat until it's green. Outside-in — observable behavior drives the order of work.

### M2. Why have two loops instead of just unit tests?

**Answer:** Unit-only suites can be all-green while the assembled feature is wrong — you built the parts right but the wrong whole. The acceptance test is the integration of intent. Conversely, acceptance-only suites are slow and give coarse failure signals. The loops divide labor: outer = right feature, inner = correct pieces (fast).

### M3. Which layer should most acceptance tests drive, and why?

**Answer:** The **service / application layer**. It's fast (in-process), stable (changes far less than the UI), and gives a clear failure signal (behavior, not browser/layout). Keep only a thin set of UI tests to prove the UI is wired up.

### M4. What are the Three Amigos?

**Answer:** Business, development, and QA reviewing a story together before building. Business catches "that's not what we need"; dev catches "this rule is undefined/infeasible"; QA catches edge cases and failure modes. The output is concrete examples that become scenarios.

### M5. What's the difference between ATDD, BDD, and Cucumber?

**Answer:** ATDD is the *practice* (drive from acceptance tests). BDD is a *style* of ATDD using `Given-When-Then` natural language. Cucumber is a *tool* that runs Gherkin. You can do ATDD with plain xUnit and no Gherkin.

### M6. What is a Scenario Outline for?

**Answer:** Running the same behavior against many examples via an `Examples` table — the core of Specification by Example. Each row is a separate test; the table is the rule's spec, including boundary cases.

### M7. What does "outside-in" mean? Does it mean build the UI first?

**Answer:** It means start from observable behavior and let its failures pull you inward to the units you need. It does *not* mean build the UI first — you usually drive the behavior through the service layer and add the UI thinly later.

### M8. When is ATDD the wrong tool?

**Answer:** For pure technical helpers with no business behavior, trivial CRUD that just restates the framework, when you'd over-test at the acceptance level, or when the team won't do the collaboration (then it's just slow tests in English).

### M9. Why must each scenario be independent?

**Answer:** So the suite can be parallelized and isn't fragile. If scenario B depends on data scenario A created, order changes (e.g., parallel runs) break it. Each scenario owns its setup and teardown.

### M10. What goes in the `.feature` file vs. the step definition?

**Answer:** Business intent (declarative `Given/When/Then`) in the feature; the translation to code (ids, HTTP calls, service method calls, assertions) in the step definition. Never leak mechanism into the feature; never put business decisions in the step.

---

## Senior Questions

### S1. What is Specification by Example?

**Answer:** Gojko Adzic's practice of specifying behavior with concrete examples (tables) instead of ambiguous prose. The examples are the requirement; the test, code, and documentation are all derived from the same examples, so they can't drift. A key rule: automate *without changing* the examples — don't distort the business-readable spec to suit the tool.

### S2. Explain the test pyramid as an economic argument.

**Answer:** Each layer has a different cost-per-confidence. Unit tests are fast, stable, cheap, and give precise failures; UI/E2E tests are slow, flaky, and expensive to maintain (superlinear, since they break on non-behavioral changes). So you want many cheap fast tests and few expensive slow ones, and you push every test as far *down* the pyramid as it can go while still proving what you need.

### S3. What's the ice-cream-cone anti-pattern?

**Answer:** An inverted pyramid — many slow brittle UI/E2E tests, few unit tests (sometimes topped with manual testing). It produces slow flaky builds, vague failures, fear of refactoring, and eventually an ignored suite. Fix by rebalancing: thin UI smoke layer, business rules at the service layer, broad unit base.

### S4. Why do UI-driven acceptance tests rot?

**Answer:** They couple to incidental structure (DOM ids/layout) so they break on non-behavioral changes; they're nondeterministic (browser/network/async races → flaky); they fail far from the cause; and being slow, there are few of them, so each failure is catastrophic and tempting to suppress. Cure: drive through the service layer; reserve UI tests for wiring, selecting by stable semantic attributes.

### S5. What does "testing through the wrong layer" mean?

**Answer:** Verifying a behavior at a layer that's too high (discount math through the UI) or coupling to internals (asserting on a DB row/schema). The rule: test a behavior at the lowest layer that can fully express it, and couple to the most stable interface (public contract, not DOM ids or table columns).

### S6. How does ATDD relate to contract testing?

**Answer:** Complementary. ATDD verifies a feature's behavior; contract testing (e.g., Pact) verifies that two services still agree on the wire format. Contract tests let you *shrink* slow cross-service E2E acceptance tests — each service is verified against the shared contract independently, pushing integration confidence down the pyramid.

### S7. When does ATDD add value vs. waste effort?

**Answer:** Adds value for genuine business complexity, ambiguous requirements, cross-team contracts, and long-lived systems (living docs compound). Wastes effort on plumbing/CRUD, throwaway code, volatile early-stage UIs, and teams that won't collaborate. Decisive question: is there a misunderstanding worth preventing and a behavior worth documenting long-term?

### S8. How does outside-in development affect architecture?

**Answer:** Driving from the service-layer acceptance test forces a coherent service-layer API (business logic can't hide in controllers or the DB) and pressures toward dependency injection / hexagonal architecture (swappable adapters: in-memory for tests, real for prod). Testability and good design arrive together.

---

## Professional Questions

### P1. How do you integrate acceptance tests into CI without killing the build?

**Answer:** Staged execution — unit + lint first (seconds, gate), then service-layer acceptance (parallel, isolated data, single-digit minutes, gate), then a thin UI smoke layer, then post-deploy smoke against the real env. Fail fast and cheap; parallelize; tag (`@smoke`, `@wip`) to run the right subset per stage.

### P2. How do you tame a flaky acceptance suite?

**Answer:** Treat flakiness as an incident. Root-cause it: wait-on-condition not `sleep`; per-scenario data isolation with transactional rollback; stub external deps; fix the clock and seed RNG; poll for eventual consistency. Quarantine (with owner + ticket), don't `@Ignore`; track a flakiness rate; treat a flaky test as a failing test. Retries hide rot.

### P3. What is Example Mapping?

**Answer:** A 25-minute structured Three Amigos technique using cards: yellow (story), blue (rules), green (examples → scenarios), red (questions/unknowns). Red cards are misunderstandings caught before coding; a story with many reds isn't ready. It time-boxes the collaboration and produces the scenarios.

### P4. How do you keep specs from rotting?

**Answer:** Ensure the business actually reads scenarios (or they're just slow test code); keep them declarative via a review gate; dedup step definitions; treat `@Ignore`d scenarios as failing; move edge cases to unit tests; make scenarios the single source of truth (delete the parallel requirements wiki); render them as living-doc reports and link from where the team looks.

### P5. When should you NOT use Gherkin/Cucumber?

**Answer:** When non-developers never read the scenarios. Then the Gherkin layer is pure overhead — a regex indirection between you and your assertions. Write plain, well-named service-layer tests tagged `@acceptance` instead. Keep outside-in development and the pyramid; drop the ceremony that buys nothing.

### P6. How do you manage test data for acceptance tests?

**Answer:** Each scenario owns its world — create exactly what it needs in `Given`, tear it down (transactional rollback or in-memory adapter). Use builders/object mothers over fixtures; namespace entities per run for shared environments; make setup idempotent. This is what enables parallelization and prevents flakiness.

### P7. How would you roll ATDD into a team that's never done it?

**Answer:** Start with the conversation (Example Mapping on an ambiguous story), not the tool. Pick one valuable rule-heavy feature. Drive at the service layer from day one (avoid the cone). Add the suite to CI non-blocking first, promote to blocking once stable. Establish data isolation early. Run scenarios in the demo. Don't mandate "Gherkin for every story" — that's theatre.

### P8. What metrics would you track for an acceptance suite?

**Answer:** Suite wall-clock time (per stage), flakiness rate, pyramid ratio (watch for inversion), pass-without-change rate (wrong-layer coupling signal), business-readability sampling, and defect escape rate. Report value (misunderstandings/bugs caught, run time), not count (count is cost, not value).

---

## Coding Tasks

### C1. Turn a user story into a Gherkin scenario.

**Story:** "As a shopper, I want orders over $100 to ship free, so that I'm rewarded for buying more."

**Answer:**

```gherkin
Feature: Free shipping on large orders
  Scenario Outline: Free shipping threshold
    Given a cart subtotal of $<subtotal>
    When I view the shipping cost
    Then the shipping cost should be $<shipping>

    Examples:
      | subtotal | shipping |
      | 99.99    | 5.00     |   # below threshold
      | 100.00   | 5.00     |   # exactly at threshold (boundary)
      | 100.01   | 0.00     |   # above → free
```

Note the boundary rows — the kind QA surfaces in the Three Amigos. The scenario is declarative and the table *is* the rule's spec.

### C2. Write the step definitions (Python / behave) driving the service layer.

```python
from behave import given, when, then
from shop.shipping import ShippingCalculator, Cart

@given('a cart subtotal of ${subtotal:f}')
def step_cart(context, subtotal):
    context.cart = Cart(subtotal=subtotal)

@when('I view the shipping cost')
def step_view(context):
    context.shipping = ShippingCalculator().cost_for(context.cart)  # real service, in-process

@then('the shipping cost should be ${expected:f}')
def step_assert(context, expected):
    assert context.shipping == expected, f"got {context.shipping}, want {expected}"
```

The step calls the real `ShippingCalculator` — no browser, no HTTP — so the test is fast and stable.

### C3. Same scenario, Java / Cucumber step definitions.

```java
public class ShippingSteps {
    private Cart cart;
    private double shipping;

    @Given("a cart subtotal of ${double}")
    public void aCartSubtotalOf(double subtotal) {
        cart = new Cart(subtotal);
    }

    @When("I view the shipping cost")
    public void iViewTheShippingCost() {
        shipping = new ShippingCalculator().costFor(cart);
    }

    @Then("the shipping cost should be ${double}")
    public void theShippingCostShouldBe(double expected) {
        assertEquals(expected, shipping, 0.001);
    }
}
```

### C4. Drive a feature outside-in — show the loop.

**Task:** Implement `cost_for` from scratch using the double loop.

**Answer (the sequence):**

```text
1. OUTER red:  run the scenario → fails (ShippingCalculator.cost_for missing)
2. INNER:      unit test test_below_threshold_costs_5 → implement
               cost_for = return 5.0  → green, refactor
3. OUTER:      re-run → rows 99.99 and 100.00 pass; 100.01 fails
4. INNER:      unit test test_above_threshold_free → implement
               cost_for = 0.0 if subtotal > 100 else 5.0  → green, refactor
5. OUTER:      re-run → all rows green → feature done
```

```python
class ShippingCalculator:
    def cost_for(self, cart):
        return 0.0 if cart.subtotal > 100 else 5.0
```

The acceptance test's failures dictated the order and stopped you exactly when the behavior was complete.

### C5. Fix a UI-coupled scenario so it goes through the service layer.

**Before — brittle UI script:**

```gherkin
Scenario: Apply discount
  Given I open "/cart"
  When I type "SAVE10" into "#promo" and click "#apply"
  Then "#total" should contain "90.00"
```

**After — declarative, service-driven:**

```gherkin
Scenario: Valid promo code applies a 10% discount
  Given a cart with subtotal $100
  When the promo code "SAVE10" is applied
  Then the cart total is $90.00
```

```python
@when('the promo code "{code}" is applied')
def step(context, code):
    context.cart = PromoService().apply(context.cart, code)   # service layer, not the DOM

@then('the cart total is ${expected:f}')
def step(context, expected):
    assert context.cart.total == expected
```

The Gherkin now reads as a business rule and survives any UI redesign; the mechanism moved into the step definition, which calls the real service.

---

## Trick Questions

### T1. "ATDD means writing Selenium tests for every feature." True?

**False — and it's the path straight into the ice-cream cone.** ATDD means driving from acceptance tests; most of those should run at the *service layer*, not the UI. UI/E2E is a thin smoke layer, not where business rules are verified.

### T2. Is a green acceptance test proof the feature is correct?

**Only if you've seen it fail for the right reason first.** A scenario can be green because the step definition asserts nothing (`pass`), matches the wrong steps, or hits a stub. Watch every new scenario go red before you make it green.

### T3. "More acceptance tests = more confidence." True?

**No.** Confidence has steep diminishing returns at the top of the pyramid, and each slow/brittle acceptance test adds carrying cost (run time + maintenance) to *every* future change. A passing test that never catches anything is pure cost. The suite is a portfolio to prune, not a pile to grow.

### T4. Can you do ATDD without Cucumber/Gherkin?

**Yes.** ATDD is a practice, not a tool. You can drive features from plain, well-named service-layer tests in xUnit/pytest tagged `@acceptance`. Use Gherkin *only* if non-developers actually read and shape the scenarios; otherwise it's slower test code with an extra parsing layer.

### T5. "BDD is a testing technique." Accurate?

**Incomplete.** BDD's primary value is *communication* — shared understanding via examples — that happens to produce executable tests. If the business never reads the scenarios, you've kept the testing cost and lost the actual point.

### T6. An acceptance test asserts `Then a row exists in orders with status=2`. Problem?

**Yes — it tests through the wrong layer.** It couples the spec to the schema and a magic number, so it breaks on storage refactors that don't change behavior, and it's unreadable to the business. The behavioral assertion is `Then the order is confirmed`; the step *may* check the DB internally, but the scenario must speak behavior.

---

## Behavioral Questions

### B1. Tell me about a time ATDD caught a problem early.

**Sample:** "In an Example Mapping session for a refund feature, a red card surfaced: nobody knew what happens to a refund requested on day 30 exactly — cash or store credit? Product and finance disagreed. We resolved it in the room, captured it as a boundary example, and built it right the first time. Without the conversation we'd have guessed, shipped, and reworked it after a customer complaint."

### B2. Describe a brittle test suite you fixed.

**Sample:** "We had ~600 Selenium tests, a 40-minute flaky build that people merged through on red. I led a rebalance to the pyramid: moved business rules to service-layer scenarios, kept ~30 UI smoke tests with stable `data-testid` selectors, and grew unit coverage. Build dropped to 6 minutes, flakiness under 1%, and the team started trusting red again. The key lesson I'd repeat: an ignored suite is worse than none."

### B3. How do you handle a team that wants Gherkin for everything?

**Sample:** "I'd separate the practice from the tool. ATDD's value is the conversation and the service-layer outside-in tests; Gherkin only earns its keep when the business reads the scenarios. For plumbing and CRUD I'd write plain tagged tests, and reserve Gherkin for rule-heavy, business-facing features where Example Mapping actually surfaces misunderstandings. Otherwise we'd be paying for theatre."

### B4. When did you decide ATDD was *not* worth it?

**Sample:** "On an early-stage product where the UI and even the core behavior churned weekly. The specs could never stabilize, and the PO was making decisions live, not via examples. We dropped formal scenarios, kept fast service-layer tests and unit tests, and revisited ATDD once the domain settled. Forcing it would have produced specs we rewrote every sprint."

### B5. Tell me about keeping documentation honest.

**Sample:** "Our `.feature` files had drifted imperative — full of `data-testid`s — and the PO had stopped reading them, so Three Amigos quietly died and we shipped a requirement miss. I moved the mechanism down into step definitions, restored declarative scenarios, rendered them as a LivingDoc report linked from the team wiki, and reinstated Example Mapping. The fix wasn't tooling — it was making the docs readable enough that the business re-engaged."

---

## Tips for Answering

1. **Lead with the distinction:** acceptance test = "right thing built" (business, end-to-end); unit test = "built right" (code, isolated).
2. **Name the double loop:** failing acceptance test (outer) wraps red-green-refactor (inner), driven outside-in.
3. **Default to the service layer** and explain why (speed, stability, clear failures) — it's the senior signal.
4. **Know the pyramid as economics** and name the ice-cream cone as its inversion.
5. **Separate ATDD (practice) / BDD (style) / Cucumber (tool)** — and that you can do ATDD without Gherkin.
6. **Cite Specification by Example and Three Amigos / Example Mapping** — the collaboration is the point.
7. **Acknowledge the cost:** flakiness, maintenance, over-specification — and how you manage them.

---

[← Professional](professional.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)
