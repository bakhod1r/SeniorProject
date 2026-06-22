# Acceptance & BDD — Middle Level

> **Roadmap:** [Testing](../README.md) → Acceptance & BDD
>
> *The Three Amigos, the declarative-vs-imperative discipline that makes Gherkin worth writing, and the tooling that runs it — Cucumber, SpecFlow, Behave, Godog.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Three Amigos](#core-concept-1----the-three-amigos)
5. [Core Concept 2 — Declarative, Not Imperative: the #1 Gherkin Discipline](#core-concept-2----declarative-not-imperative-the-1-gherkin-discipline)
6. [Core Concept 3 — Scenario Outlines and Examples Tables](#core-concept-3----scenario-outlines-and-examples-tables)
7. [Core Concept 4 — Background, Tags, and Organising Features](#core-concept-4----background-tags-and-organising-features)
8. [Core Concept 5 — Step Definitions Done Well](#core-concept-5----step-definitions-done-well)
9. [Core Concept 6 — The Tooling Landscape](#core-concept-6----the-tooling-landscape)
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

> Focus: **the collaboration ritual (Three Amigos), the writing discipline that separates valuable Gherkin from brittle noise (declarative not imperative), and a working knowledge of the tooling that binds specs to code.**

You can read a scenario and wire a step definition. The middle-tier skills are the ones that decide whether a BDD suite *helps* or *rots*: holding the Three Amigos conversation, writing scenarios in durable business language instead of fragile UI scripts, parameterising with examples tables, and keeping step definitions clean. Get these right and the suite becomes living documentation; get them wrong and it becomes the slowest, most brittle layer you own.

---

## Prerequisites

- You can read and write a basic Gherkin scenario and a step definition ([Junior Level](./junior.md)).
- You write unit and integration tests comfortably ([Unit Testing](../02-unit-testing/), [Integration Testing](../03-integration-testing/)).
- You've worked from user stories / tickets with a product owner.
- You understand the test pyramid well enough to know acceptance tests should be few ([Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/)).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Three Amigos** | A pre-coding conversation between business, development, and testing to agree on a story's behaviour with concrete examples. |
| **Specification by Example** | Gojko Adzic's name for using concrete examples as the authoritative spec, tests, and documentation. |
| **Declarative scenario** | Gherkin phrased as *business intent* ("submit the order"), not UI mechanics. |
| **Imperative scenario** | Gherkin phrased as step-by-step UI actions ("click `#submit`") — the chief anti-pattern. |
| **Scenario Outline** | A scenario template run once per row of an `Examples` table. |
| **Background** | Steps run before every scenario in a feature (shared `Given`). |
| **Tag** | A `@label` on a feature/scenario used to select, group, or skip subsets. |
| **Step definition** | Code matched to a Gherkin step by a pattern; carries state via a "world"/context object. |
| **Living documentation** | Up-to-date, human-readable docs generated from passing scenarios. |
| **ATDD** | Acceptance-Test-Driven Development — write the acceptance test first, then make it pass. |

---

## Core Concept 1 — The Three Amigos

The **Three Amigos** is the conversation that *is* BDD. Before a story is built, three perspectives meet:

| Amigo | Brings | Asks |
|---|---|---|
| **Business** (PO/BA) | What the user needs and why | "What problem are we solving?" |
| **Development** | What's feasible and where the edges are | "What happens when…?" |
| **Testing** (QA) | How it could break, what's ambiguous | "Did we consider…?" |

The session runs ~30 minutes and produces a set of concrete **examples** that become the acceptance criteria that become the scenarios. The magic is the *questions*. QA naturally asks about the empty case, the boundary, the failure; dev surfaces the technical edge; business decides what actually matters. A 30-minute conversation routinely prevents days of building the wrong thing.

> **The conversation is the deliverable.** The Gherkin is the written record of what was agreed. If you skip the conversation and just write Gherkin, you have a record of *one person's assumptions* — which is exactly what BDD exists to prevent.

A lightweight **example-mapping** layout for the session (Matt Wynne's technique):

```text
  ┌─ STORY (yellow): Apply a discount code at checkout
  │
  ├─ RULE (blue): A code gives a percentage off the subtotal
  │    ├─ EXAMPLE (green): SAVE10 on a $100 cart → $90
  │    └─ EXAMPLE (green): SAVE10 on an empty cart → still empty, no error
  │
  ├─ RULE (blue): Expired codes are rejected
  │    └─ EXAMPLE (green): code expired yesterday → "This code has expired"
  │
  └─ QUESTION (red): Do codes stack with an active sale?   ← unresolved!
```

Those red **questions** are the gold: they're the ambiguities you'd otherwise discover mid-sprint. You answer them before estimating, not after committing.

---

## Core Concept 2 — Declarative, Not Imperative: the #1 Gherkin Discipline

This is the single most important writing skill in BDD. A scenario should describe **what** the user is trying to do, not the **mechanical steps** of doing it.

**Imperative (the anti-pattern):**

```gherkin
Scenario: Login
  Given I open the browser at "/login"
  And I type "alice@example.com" into the field "#email"
  And I type "hunter2" into the field "#password"
  And I click the button "#login-submit"
  Then I wait 2 seconds
  And I see the element ".dashboard-header"
```

**Declarative (the same intent):**

```gherkin
Scenario: Registered user logs in successfully
  Given I am a registered user
  When I log in with valid credentials
  Then I land on my dashboard
```

Why the declarative version is strictly better:

| Property | Imperative | Declarative |
|---|---|---|
| Survives a UI redesign? | No — every selector change breaks it | Yes — only the step definition changes |
| Readable by business? | No | Yes |
| Reveals intent? | No (lost in mechanics) | Yes |
| Reusable steps? | Rarely | `I log in` reused everywhere |
| Brittleness | High | Low |

The mechanical detail (`#email`, `click`, `wait 2 seconds`) doesn't vanish — it moves *down* into the step definition, where it belongs and where a developer maintains it. The Gherkin stays a stable description of behaviour. **An imperative Cucumber suite is the most common reason teams come to hate BDD:** it's slow, it's brittle, and it reads like a macro recording instead of a specification.

---

## Core Concept 3 — Scenario Outlines and Examples Tables

When one rule has many examples, don't copy-paste scenarios. Use a **Scenario Outline** with an `Examples` table:

```gherkin
Feature: Password strength

  Scenario Outline: Passwords are accepted or rejected by policy
    Given I am registering a new account
    When I choose the password "<password>"
    Then registration is "<result>"
    And I see the message "<message>"

    Examples:
      | password      | result   | message                        |
      | abc           | rejected | Too short (minimum 8)          |
      | password      | rejected | Too common                     |
      | Tr0ub4dor&3   | accepted |                                |
      | correct horse | rejected | Add a number or symbol         |
```

The outline runs once per row, substituting `<placeholders>`. This is **specification by example** in its purest form: the table *is* the policy, readable by anyone, and each row is an independent test. It's also the natural home for boundary values that came out of the Three Amigos questions (exactly 8 chars? what about whitespace?).

---

## Core Concept 4 — Background, Tags, and Organising Features

**`Background`** factors out `Given` steps shared by every scenario in a feature — but keep it short; a long `Background` usually means your scenarios are over-specified.

```gherkin
Feature: Shopping cart

  Background:
    Given I am a logged-in customer
    And the catalogue contains a "Widget" priced at $20

  Scenario: Add a single item
    When I add 1 "Widget" to my cart
    Then my cart total is $20
```

**Tags** select and group scenarios:

```gherkin
@checkout @smoke
Scenario: Successful purchase with a saved card
  ...
```

Then run subsets: `cucumber --tags "@smoke"`, or exclude work-in-progress with `--tags "not @wip"`. Common tags: `@smoke` (fast critical path), `@wip` (skip in CI), `@slow`, `@regression`. Tags are how you keep an acceptance suite *runnable in stages* instead of an all-or-nothing 40-minute block.

---

## Core Concept 5 — Step Definitions Done Well

Step definitions are real code and deserve real care. Two rules dominate.

**1. Share state through a context object ("world"), not globals.** Each scenario gets a fresh world so scenarios stay isolated.

```python
# pytest-bdd: state flows through fixtures
@given("I am a logged-in customer", target_fixture="session")
def logged_in():
    return create_session(user=make_user())

@when(parsers.parse('I add {qty:d} "{product}" to my cart'))
def add_to_cart(session, qty, product):
    session.cart.add(product, qty)

@then(parsers.parse("my cart total is ${total:d}"))
def assert_total(session, total):
    assert session.cart.total() == total
```

The equivalent in Go with **Godog**, where the world is a struct:

```go
type cartCtx struct {
    session *Session
}

func (c *cartCtx) iAmALoggedInCustomer() error {
    c.session = NewSession(MakeUser())
    return nil
}

func (c *cartCtx) iAddToMyCart(qty int, product string) error {
    return c.session.Cart.Add(product, qty)
}

func (c *cartCtx) myCartTotalIs(total int) error {
    if got := c.session.Cart.Total(); got != total {
        return fmt.Errorf("expected total %d, got %d", total, got)
    }
    return nil
}

func InitializeScenario(ctx *godog.ScenarioContext) {
    c := &cartCtx{}
    ctx.Step(`^I am a logged-in customer$`, c.iAmALoggedInCustomer)
    ctx.Step(`^I add (\d+) "([^"]*)" to my cart$`, c.iAddToMyCart)
    ctx.Step(`^my cart total is \$(\d+)$`, c.myCartTotalIs)
}
```

**2. Drive the system at the right layer — usually below the UI.** A declarative step like `When I log in with valid credentials` should call the *service/API layer*, not click through a browser, whenever the scenario isn't specifically testing the UI. This is what keeps acceptance tests fast and stable. Reserve actual browser-driving for the handful of scenarios that genuinely verify the UI.

---

## Core Concept 6 — The Tooling Landscape

Gherkin is portable; the runner depends on your stack. The tool is the *least* important decision — collaboration matters far more — but you should know the field:

| Tool | Language(s) | Notes |
|---|---|---|
| **Cucumber** | Java, JS/TS (Cucumber.js), Ruby | The original and most widely used; rich ecosystem. |
| **SpecFlow / Reqnroll** | .NET (C#) | Cucumber for .NET; Reqnroll is the maintained successor. |
| **Behave** | Python | Mature, classic Gherkin runner. |
| **pytest-bdd** | Python | Gherkin on top of pytest — reuses pytest fixtures, marks, plugins. Popular when a team already lives in pytest. |
| **Godog** | Go | Official Cucumber implementation for Go; struct-based world. |
| **JBehave** | Java | Predates Cucumber-JVM; uses stories rather than `.feature` files. |

Most tools can also generate **living documentation** — an HTML report of features and their pass/fail state — so the specs that drove development double as always-current docs. (Tools like *Serenity BDD* and *Pickles* specialise in this.) That's a genuine benefit, but only if the scenarios are declarative and readable; living docs generated from imperative click-scripts document nothing.

---

## Real-World Examples

- **Insurance quoting.** Premium rules are genuinely complex (age bands, region, claims history). A `Scenario Outline` with 25 rows becomes the authoritative spec the actuaries, devs, and QA all read from. Here the collaboration payoff is huge — the domain is exactly where shared language pays.
- **A team that hated Cucumber.** Three developers wrote 400 imperative scenarios that drove a Selenium browser. The suite took 45 minutes, was flaky, and no business person ever read it. They had paid the full cost of BDD (the automation tax) and received none of the benefit (collaboration). The fix wasn't more Gherkin — it was deleting most of it and pushing the assertions down to API-level tests.
- **Tag-staged CI.** A fintech runs `@smoke` (12 scenarios, 90 s) on every push and the full `@regression` set nightly, keeping fast feedback while still covering breadth.

---

## Mental Models

- **Gherkin is an interface, step definitions are the implementation.** Keep the interface in business language and stable; let the implementation absorb churn.
- **The table is the spec.** A `Scenario Outline` with a well-chosen `Examples` table often communicates a rule better than a paragraph of prose.
- **One scenario, one behaviour.** If you need "and then also…", it's two scenarios.
- **Drive low, assert in business terms.** Talk to the API in step definitions; phrase the Gherkin as user intent.
- **The Amigos meeting is the product; the .feature file is the receipt.**

---

## Common Mistakes

- **Imperative scenarios.** Click-by-click UI scripts in Gherkin — brittle, unreadable, the #1 cause of BDD regret. Phrase intent; push mechanics into step definitions.
- **Skipping the Three Amigos.** Writing scenarios alone reduces BDD to a verbose unit-test dialect with all the cost and none of the shared understanding.
- **Driving everything through the browser.** Makes the suite slow and flaky. Drive below the UI unless the scenario is specifically about the UI.
- **Bloated `Background`.** Shared setup creeping toward "set up the whole world" signals over-specified scenarios.
- **Leaky shared state.** Globals between step definitions cause order-dependent flakes; use a per-scenario world/context.
- **Too many acceptance tests.** They belong near the top of the pyramid — few and stable. Hundreds of them is a pyramid inverted into an ice-cream cone.

---

## Test Yourself

1. Who are the Three Amigos and what does each contribute?
2. Rewrite this imperative step declaratively: `When I click "#add-to-cart" then click "#cart-icon" then click "#checkout"`.
3. When should you reach for a `Scenario Outline` instead of multiple `Scenario`s?
4. Why should `When I log in` usually hit the API rather than drive a browser?
5. What is the risk of a long `Background`?
6. A team has 400 Cucumber tests, all browser-driven, written by developers, that no PO reads. What have they actually built — and what's the fix?

<details>
<summary>Answers</summary>

1. Business (what/why), Development (feasibility/edges), Testing (failure modes/ambiguity). Together they agree on concrete examples before coding; the conversation is the real deliverable.
2. e.g. `When I check out my cart`. The three clicks are mechanics; the intent is "check out", which lives in the step definition.
3. When one rule has multiple example inputs/outputs — the `Examples` table parameterises a single template and becomes the readable spec.
4. Speed and stability: API-level steps run in milliseconds and don't break on UI changes. Reserve browser-driving for scenarios specifically verifying the UI.
5. It tends to over-specify every scenario and couples them to setup details; it's a sign scenarios should be simpler or split.
6. An expensive, brittle, slow UI test suite with the automation tax but zero collaboration benefit — "Cucumber without BDD". Fix: delete most of it, move assertions to fast API/unit tests, and reintroduce Gherkin only where real Three-Amigos collaboration happens.

</details>

---

## Cheat Sheet

```text
THREE AMIGOS  (before coding, ~30 min)
  Business: what & why   Dev: feasibility & edges   QA: how it breaks
  Output = concrete examples → acceptance criteria → scenarios
  Red "question" cards = the ambiguities you just saved a sprint on.

DECLARATIVE > IMPERATIVE
  BAD : Given I type "x" into "#email" / click "#submit"
  GOOD: Given I am a registered user / When I log in
  Mechanics live in step definitions, not Gherkin.

SCENARIO OUTLINE
  Scenario Outline: ...
    When I choose "<password>"   Then registration is "<result>"
    Examples: | password | result |

ORGANISE
  Background  = shared Givens (keep short)
  @tags       = select/skip subsets (@smoke, @wip, @regression)

STEP DEFS
  - share state via per-scenario world/context (no globals)
  - drive BELOW the UI unless testing the UI

TOOLS: Cucumber (Java/JS/Ruby) · SpecFlow/Reqnroll (.NET)
       Behave & pytest-bdd (Python) · Godog (Go)
  Living docs = HTML generated from passing, readable scenarios.
```

---

## Summary

The middle tier is where BDD lives or dies. The **Three Amigos** conversation — business, dev, QA agreeing on concrete examples before coding, with **example mapping** surfacing the unresolved questions — is the actual practice; the `.feature` file is its receipt. The decisive writing skill is **declarative, not imperative**: describe user intent in Gherkin and push UI mechanics down into step definitions, so the suite survives redesigns and stays readable. **Scenario Outlines** with `Examples` tables turn complex rules into specification by example; **tags** and a lean **Background** keep the suite organised and stageable; and clean **step definitions** share per-scenario state and drive the system below the UI. The tooling — Cucumber, SpecFlow, Behave, pytest-bdd, Godog — is the smallest decision; collaboration is the largest.

---

## Further Reading

- *Specification by Example* — Gojko Adzic (the canonical treatment of examples-as-specs).
- *BDD in Action* — John Ferguson Smart (Three Amigos, living documentation, tooling end to end).
- Matt Wynne — *Introducing Example Mapping* (the red/blue/green/yellow card technique).
- *The Cucumber for Java Book* / Cucumber docs — declarative-vs-imperative guidance.

---

## Related Topics

- [Junior Level](./junior.md) — acceptance vs unit, first scenario, step definitions.
- [Senior Level](./senior.md) — BDD-as-collaboration in depth, when it pays, acceptance in the pyramid.
- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — keeping acceptance tests few and high.
- [End-to-End Testing](../04-end-to-end-testing/) — driving the UI when a scenario truly needs it.
- The `test-driven-development` skill — the inner loop BDD's outer loop wraps.
