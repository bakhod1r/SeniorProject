# Acceptance & BDD — Junior Level

> **Roadmap:** [Testing](../README.md) → Acceptance & BDD
>
> *Unit tests ask "is the code right?" Acceptance tests ask "did we build the thing the customer asked for?" — this tier teaches the difference and your first behaviour scenario.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Two Different Questions](#core-concept-1----two-different-questions)
5. [Core Concept 2 — Acceptance Criteria as the Definition of Done](#core-concept-2----acceptance-criteria-as-the-definition-of-done)
6. [Core Concept 3 — What BDD Is (and Isn't)](#core-concept-3----what-bdd-is-and-isnt)
7. [Core Concept 4 — Your First Gherkin Scenario](#core-concept-4----your-first-gherkin-scenario)
8. [Core Concept 5 — Wiring Gherkin to Code with Step Definitions](#core-concept-5----wiring-gherkin-to-code-with-step-definitions)
9. [Core Concept 6 — Manual UAT vs Automated Acceptance Tests](#core-concept-6----manual-uat-vs-automated-acceptance-tests)
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

> Focus: **the difference between testing that the code is correct and testing that the system does what the business asked — plus how to read and write a single Gherkin scenario.**

A unit test can be 100% green while the feature is completely wrong. The test proves the function returns what the function was written to return; it says nothing about whether the function should exist or whether it solves the customer's problem. **Acceptance testing** closes that gap: it verifies the system meets the *business requirement* — the thing the user actually wanted.

**BDD** (Behaviour-Driven Development) is a way of agreeing on that requirement *before* coding, by writing it down as concrete examples of behaviour in plain language everyone understands — business, QA, and developers alike. Those examples double as tests. This tier introduces both ideas and gets you reading and writing your first scenario.

---

## Prerequisites

- You can write a basic unit test in some language ([Unit Testing](../02-unit-testing/)).
- You understand the rough idea of a test pyramid: many small tests, few big ones ([Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/)).
- You have seen the words "user story" or "ticket" and know they describe a feature a user wants.
- No tool experience required — we start from the concepts.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Acceptance test** | A test that checks the system does what the business/user requirement says, not just that the code is internally correct. |
| **UAT** | User Acceptance Testing — real users (or product owners) trying the feature to confirm it meets their needs, often by hand. |
| **Acceptance criteria** | The concrete conditions a story must satisfy to be considered "done". |
| **BDD** | Behaviour-Driven Development — defining behaviour as plain-language examples, shared by business + dev + QA, that become tests. |
| **Gherkin** | The structured plain-language format (`Given / When / Then`) used to write behaviour scenarios. |
| **Feature** | A Gherkin file describing one capability, containing one or more scenarios. |
| **Scenario** | One concrete example of behaviour: a context, an action, an outcome. |
| **Step definition** | The code that connects a Gherkin step (e.g. `Given I have $50`) to an actual action in the system. |
| **Cucumber** | The most common tool that runs Gherkin features by matching steps to step definitions. |

---

## Core Concept 1 — Two Different Questions

Imagine a "transfer money" feature. Two tests can both pass while the product fails the customer.

```python
# UNIT TEST — "is the code correct?"
def test_transfer_subtracts_amount():
    account = Account(balance=100)
    account.withdraw(30)
    assert account.balance == 70   # the function does what it says
```

This is true and useful. But it never asks: *should the user be allowed to transfer when their account is frozen? What error do they see if they're overdrawn? Does the money actually arrive in the other account?* Those are **business questions**, and they need a different kind of test:

```gherkin
# ACCEPTANCE TEST — "does it do what the customer wanted?"
Scenario: A customer cannot overdraw their account
  Given my account balance is $50
  When I try to transfer $80 to my landlord
  Then the transfer is declined
  And I see the message "Insufficient funds"
  And my balance is still $50
```

The unit test lives *inside* one function. The acceptance test describes *observable behaviour* the customer cares about. Both matter. The trap is thinking green unit tests mean the feature is right.

| | Unit / Integration | Acceptance |
|---|---|---|
| Question | Is this code correct? | Did we build what was asked? |
| Audience | Developers | Business + QA + developers |
| Language | Code/technical | Plain business language |
| Fails when | A function misbehaves | The system doesn't meet the requirement |

---

## Core Concept 2 — Acceptance Criteria as the Definition of Done

Before writing a line of code, a good team agrees on **acceptance criteria**: the specific conditions that make the story "done". They turn a vague request into something testable.

A vague story:

> *As a user, I want to reset my password.*

The same story with acceptance criteria:

- Given a registered email, requesting a reset sends a reset link valid for 1 hour.
- An expired link shows "This link has expired" and offers to resend.
- An unknown email shows the *same* success message (so attackers can't tell which emails exist).
- After a successful reset, the old password no longer works.

Notice what happened: the fourth criterion (the security one) was probably *missing* from the original request, and writing criteria surfaced it. **This is the whole point** — agreeing on concrete examples before coding finds the gaps while they're cheap to fix. Each criterion is a candidate acceptance test.

---

## Core Concept 3 — What BDD Is (and Isn't)

BDD grew out of TDD. Dan North coined it because new developers kept asking *"where do I start? what do I test? what do I call the test?"* He found that phrasing tests as **behaviour** — sentences starting with "should" — answered all three. The `test-driven-development` skill covers the red-green-refactor loop BDD builds on.

The single most important thing to learn now:

> **BDD is mainly about *conversation*, and only secondarily about tools.** Its value is getting business, QA, and developers to agree on what "correct behaviour" means *before* code is written. The Gherkin files and Cucumber tests are a *by-product* of that conversation.

Most teams get this backwards. They install Cucumber, write Gherkin alone at their desks, and wonder why it feels like extra paperwork. **Gherkin without the conversation is pure overhead.** Remember the order: talk first, write examples together, *then* automate them. As a junior, your job is mostly to recognise this so you don't mistake "we use Cucumber" for "we do BDD".

---

## Core Concept 4 — Your First Gherkin Scenario

Gherkin has a small, fixed vocabulary. The core is **Given / When / Then**:

| Keyword | Role | Plain meaning |
|---|---|---|
| `Feature` | Names the capability | "What are we building?" |
| `Scenario` | One concrete example | "Here's one situation." |
| `Given` | Context / starting state | "The world is set up like this." |
| `When` | The action / event | "This happens." |
| `Then` | The expected outcome | "We should observe this." |
| `And` / `But` | Continue the previous step | Chains more Givens/Thens. |

A complete feature file for a shopping cart:

```gherkin
Feature: Free shipping threshold
  As a customer
  I want free shipping over $50
  So that I'm encouraged to buy a little more

  Scenario: Order qualifies for free shipping
    Given my cart total is $60
    When I check out
    Then shipping is free

  Scenario: Order does not qualify
    Given my cart total is $40
    When I check out
    Then shipping costs $5.99
```

Read it aloud. A product owner with no coding background understands it completely — that is the design goal. Each `Scenario` is one example; together they pin down the rule.

---

## Core Concept 5 — Wiring Gherkin to Code with Step Definitions

A Gherkin step is just a sentence. To make it *run*, you write a **step definition**: a small function matched to the sentence by a pattern. Here it is in Python with `pytest-bdd`:

```python
# features/free_shipping.feature  → the Gherkin above
# test_free_shipping.py           → the step definitions

from pytest_bdd import scenarios, given, when, then, parsers

scenarios("free_shipping.feature")   # load every scenario in the file

@given(parsers.parse("my cart total is ${total:d}"), target_fixture="cart")
def cart_with_total(total):
    return Cart(subtotal=total)

@when("I check out", target_fixture="checkout")
def check_out(cart):
    return checkout(cart)

@then("shipping is free")
def shipping_is_free(checkout):
    assert checkout.shipping == 0

@then(parsers.parse("shipping costs ${cost:f}"))
def shipping_costs(checkout, cost):
    assert checkout.shipping == cost
```

The flow is always the same:

1. The runner reads the `.feature` file.
2. For each step, it finds the step definition whose pattern matches the sentence.
3. It calls that function, passing any captured values (`$60` → `total=60`).
4. `Then` steps assert; if an assertion fails, the scenario fails — and the failure is reported in *business language*, e.g. *"Order qualifies for free shipping → shipping is free: FAILED"*.

The same scenario could be wired in Java (Cucumber), JavaScript (Cucumber.js), or Go (Godog). The Gherkin is portable; only the glue code changes.

---

## Core Concept 6 — Manual UAT vs Automated Acceptance Tests

Acceptance testing comes in two flavours, and they complement rather than compete.

**User Acceptance Testing (UAT)** is *people* — usually the product owner or real users — trying the feature against the acceptance criteria, by hand, before it's accepted. It's the final "yes, this is what we asked for" sign-off. UAT catches things automation can't easily judge: *does this actually feel right? is the wording clear? is the flow sensible?* Its weakness is that it's slow, manual, and doesn't repeat cheaply — you can't run UAT on every commit.

**Automated acceptance tests** are the same criteria, encoded (often as Gherkin scenarios) so a machine checks them on every change. They're fast and repeatable, so they protect against *regression* — the feature silently breaking later. Their weakness is that they only check what you thought to encode; they can't notice the wording feels off.

| | Manual UAT | Automated acceptance |
|---|---|---|
| Who runs it | A person (PO / real user) | The CI pipeline |
| When | Before accepting a story / release | Every commit |
| Strength | Judgement, feel, the unexpected | Speed, repeatability, regression safety |
| Weakness | Slow, doesn't repeat cheaply | Only checks what was encoded |

A healthy team uses both: automate the criteria you can pin down precisely, and keep human UAT for judgement and final sign-off. Crucially, both are driven by the *same acceptance criteria* — that's why agreeing on them up front (Concept 2) pays off twice.

---

## Real-World Examples

- **Login lockout.** Story: "lock the account after 5 failed attempts." A scenario nails the edge: `Given I have failed to log in 4 times / When I enter a wrong password again / Then my account is locked`. The "is it the 5th attempt or the 6th?" ambiguity gets settled by the example, not by guessing.
- **Discount codes.** Product wants "SAVE10 gives 10% off." Writing scenarios surfaces the unasked questions: does it stack with other offers? does it apply before or after tax? is it case-sensitive? Each becomes a `Scenario`.
- **UAT before launch.** A bank's product owners spend a day clicking through the new statements feature against a checklist of acceptance criteria. They find that statements show the wrong currency symbol for EU accounts — a requirement gap no unit test was looking for.

---

## Mental Models

- **The contract, not the wiring.** Acceptance tests describe the agreement with the user; unit tests describe the internal wiring. You can rewire freely as long as the contract holds.
- **Examples are cheaper than arguments.** "It should handle weird inputs" causes a meeting. "Given an empty cart, when I check out, then I see 'Your cart is empty'" ends it.
- **Talk → write → automate.** BDD's value is front-loaded in the talking. Skip the talk and you've kept the cost and thrown away the benefit.
- **Plain language is a feature, not decoration.** If a non-coder can't read your scenario, it's not doing its main job.

---

## Common Mistakes

- **Confusing "we use Cucumber" with "we do BDD."** The tool is not the practice. The conversation is the practice.
- **Writing scenarios after the code, alone.** Then they're just a slow, awkward way to write unit tests, with none of the shared-understanding payoff.
- **Treating acceptance tests as a replacement for unit tests.** They answer different questions. You need both; you need *far more* unit tests than acceptance tests.
- **Putting UI clicks in Gherkin** (`When I click the button with id "submit"`). Keep Gherkin in business language; the *how* belongs in step definitions. (You'll learn this discipline properly at [Middle Level](./middle.md).)
- **One giant scenario that tests everything.** One scenario = one behaviour. Split them.

---

## Test Yourself

1. A function's unit tests are all green. Can you conclude the feature works for the customer? Why or why not?
2. What are the three Gherkin keywords for context, action, and outcome?
3. In one sentence, what is the *primary* value of BDD?
4. Rewrite this vague story as two acceptance criteria: "As a user I want to search products."
5. What does a step definition do?
6. Why is `When I click the element "#login-btn"` a poor Gherkin step?

<details>
<summary>Answers</summary>

1. No. Unit tests prove the code does what it was written to do; they don't prove that was the *right* thing to build. The requirement could be wrong or incomplete.
2. `Given` (context), `When` (action), `Then` (outcome).
3. Building shared understanding between business, QA, and developers about what the system should do — *before* coding.
4. Example: "Searching 'shoes' returns products whose name or category contains 'shoes', newest first." / "Searching a term with no matches shows 'No products found'."
5. It connects a plain-language Gherkin step to real code, so the scenario can actually execute against the system.
6. It's an imperative UI script, not a description of behaviour. It breaks when the button id changes and means nothing to a business reader. Say *what* ("When I log in"), not *how*.

</details>

---

## Cheat Sheet

```text
ACCEPTANCE vs UNIT
  Unit:        is the code correct?        (developers, internal)
  Acceptance:  did we build the right thing? (business, observable behaviour)

ACCEPTANCE CRITERIA = the definition of done, written as concrete conditions.

BDD IN ONE LINE
  Conversation first, examples second, automation last.
  Gherkin without the conversation = overhead.

GHERKIN SKELETON
  Feature: <capability>
    Scenario: <one concrete example>
      Given <context>
      When  <action>
      Then  <observable outcome>
      And   <more context/outcome>

STEP DEFINITION = code matched to a Gherkin sentence by a pattern.

RULE: Gherkin says WHAT (business language). Step defs handle HOW.
```

---

## Summary

Acceptance testing verifies the system does what the business asked, a different question from "is the code correct?" that unit tests answer. **Acceptance criteria** turn vague stories into testable, agreed conditions — the definition of done — and writing them surfaces gaps early. **BDD** is, above all, a *collaboration* practice: business, QA, and developers agree on concrete behaviour examples before coding. **Gherkin** (`Given/When/Then`) is the plain-language format for those examples, and **step definitions** wire them to code so they run as tests. The cardinal rule to carry forward: the conversation is the point; the automation is a by-product, and Gherkin written without the conversation is just overhead.

---

## Further Reading

- Dan North — *Introducing BDD* (the original essay; explains why "behaviour" beats "test").
- *The Cucumber Book* — Wynne & Hellesøy (chapters 1–3 for first scenarios).
- *Specification by Example* — Gojko Adzic (the readable introduction to examples-as-specs).
- Cucumber docs — "Gherkin Reference" (the full, small keyword set).

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — the "is the code correct?" counterpart you'll write far more of.
- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — where acceptance tests sit (few, near the top).
- [End-to-End Testing](../04-end-to-end-testing/) — how automated acceptance tests are often run.
- The `test-driven-development` skill — the practice BDD evolved from.
- [Middle Level](./middle.md) — the Three Amigos, Gherkin discipline, and tooling.
