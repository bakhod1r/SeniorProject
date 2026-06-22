# Acceptance & BDD — Interview Level

> **Roadmap:** [Testing](../README.md) → Acceptance & BDD
>
> *A question bank with model answers — proving you understand that BDD is collaboration first and tooling second, and that you can tell when it pays from when it's tax.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [BDD as Collaboration](#bdd-as-collaboration)
6. [Scenarios and Gherkin Discipline](#scenarios-and-gherkin-discipline)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering BDD questions the way a senior engineer does — leading with collaboration and shared understanding, treating Gherkin/Cucumber as a by-product, and being honest about when the practice is overhead.**

The fastest way to fail a BDD interview is to equate it with Cucumber. Interviewers use this topic to separate people who installed a tool from people who understand *why* the tool exists. Lead every answer with collaboration; mention tooling second; volunteer the honest critique unprompted. That signals seniority better than any syntax recall.

---

## Prerequisites

- Solid grasp of unit/integration/E2E and the test pyramid ([Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/)).
- You can read and write Gherkin and a step definition ([Junior](./junior.md), [Middle](./middle.md)).
- You can argue the cost/benefit of BDD ([Senior](./senior.md)) and discuss rollout ([Professional](./professional.md)).
- Familiarity with the `test-driven-development` skill (the inner loop BDD wraps).

---

## Fundamentals

**Q1. What is acceptance testing, and how does it differ from unit testing?**
*What's really being tested: do you know the difference between "code is correct" and "we built the right thing"?*
**A.** Acceptance testing verifies the system meets the *business/user requirement* — does it do what the customer actually wanted? Unit testing verifies *internal correctness* — does this function do what it was written to do? They answer different questions: unit tests can be 100% green while the feature is wrong, because the requirement itself could be misunderstood or incomplete. Acceptance tests are written in business-observable terms, often run at integration/E2E level, and are far fewer than unit tests. You need both.

**Q2. What is BDD, and what's the most common misconception about it?**
*Whether you understand BDD is collaboration first, tooling second.*
**A.** BDD (Behaviour-Driven Development) evolved from TDD to focus on *shared understanding*: business, dev, and QA agree on concrete examples of behaviour, in plain language, *before* coding — and those examples become the acceptance criteria and the tests. The most common misconception, which most teams get backwards, is that **BDD equals Cucumber/Gherkin**. BDD is primarily a *collaboration* practice; the executable spec is a by-product. Gherkin written without the conversation is pure overhead — you've paid the cost and skipped the value.

**Q3. Where did BDD come from?**
*Origin literacy; signals depth.*
**A.** Dan North coined it. New developers kept asking *where do I start, what do I test, what do I name the test?* He found that phrasing tests as behaviour — sentences with "should" and the Given-When-Then structure — answered all three and, more importantly, made requirements communicable across roles. Gojko Adzic later formalised the practice as *Specification by Example*: concrete examples serve simultaneously as spec, criteria, tests, and living documentation.

**Q4. What are acceptance criteria and why write them before coding?**
*Definition-of-done literacy.*
**A.** Acceptance criteria are the concrete conditions a story must satisfy to be "done." Writing them before coding turns a vague request into something testable and — critically — *surfaces gaps while they're cheap to fix*. The act of agreeing on examples regularly reveals unasked questions (security cases, boundaries, error behaviour) that would otherwise be discovered mid-sprint. Each criterion becomes a candidate acceptance test.

---

## Technique

**Q5. Explain Given-When-Then.**
*Basic Gherkin fluency.*
**A.** `Given` sets the context/starting state, `When` is the action or event under test, `Then` is the expected observable outcome. `And`/`But` chain additional steps. A `Feature` groups related `Scenario`s. The structure forces one behaviour per scenario: one context, one action, one outcome.

**Q6. What's a Scenario Outline and when do you use one?**
*Parameterisation; specification by example.*
**A.** A `Scenario Outline` is a template run once per row of an `Examples` table, substituting `<placeholders>`. You use it when one rule has many example inputs/outputs — e.g. a password policy or a pricing rule. The table *is* the spec: readable by non-devs, and each row is an independent test. It's the cleanest way to express boundary cases that came out of the Three Amigos conversation.

**Q7. How do step definitions work, and how should they manage state?**
*Implementation understanding.*
**A.** A step definition is a function matched to a Gherkin step by a pattern; captured values are passed as arguments. The runner reads the `.feature`, matches each step, and executes — `Then` steps assert. State should flow through a *per-scenario* context/world object (or pytest fixtures in pytest-bdd, a struct in Godog), never globals, so scenarios stay isolated and don't become order-dependent. Step definitions should drive the system *below the UI* whenever the scenario isn't specifically about the UI.

**Q8. Name the main BDD tools per ecosystem.**
*Breadth check; keep it brief.*
**A.** Cucumber (Java, JS/TS, Ruby), SpecFlow/Reqnroll (.NET), Behave and pytest-bdd (Python), Godog (Go), JBehave (older JVM). I'd add that the tool is the *least* important decision — collaboration matters far more — and you can do excellent acceptance testing with no Gherkin at all.

**Q9. How does BDD relate to TDD?**
*Outer/inner loop understanding.*
**A.** BDD wraps TDD; it doesn't replace it. ATDD's *outer loop* is a failing acceptance scenario — an executable definition of done — that stays red until the feature genuinely works. Inside it you run the ordinary TDD *inner loop* (red-green-refactor) to build the units. A team doing "BDD" with no inner-loop unit tests has built an ice-cream cone: lots of slow coarse tests, few fast ones.

---

## BDD as Collaboration

**Q10. Who are the Three Amigos and what does the session produce?**
*The core practice.*
**A.** Business (what/why), Development (feasibility/edges), and Testing (failure modes/ambiguity) meet before coding — typically ~30 minutes. They produce concrete examples that become acceptance criteria that become scenarios. The real product is the *conversation* and the questions it raises (QA asks about the empty/boundary/failure cases; dev surfaces technical edges; business decides what matters). The `.feature` file is just the receipt.

**Q11. What is example mapping?**
*Practical collaboration technique.*
**A.** Matt Wynne's timeboxed technique using four card colours: yellow (the story), blue (a business rule), green (a concrete example of a rule), red (an open question nobody can answer yet). The red question cards are the gold — they're the ambiguities you'd otherwise hit mid-sprint, resolved before estimating. "No red cards left" is a strong Definition of Ready, and it delivers BDD's value *even if you never automate a single scenario*.

**Q12. A team has 500 Cucumber tests, all written and read only by developers, all browser-driven, taking 40 minutes. Is this BDD?**
*The signature question — recognising the trap.*
**A.** No — it's the Cucumber-without-collaboration trap. They're paying 100% of the automation tax (writing/maintaining Gherkin, step glue, a slow brittle suite) for 0% of the collaboration benefit, which is the only thing that justifies the tax. Gherkin is a *worse* way to write a test than plain code unless a non-developer reads it. The fix is rarely more Gherkin: push assertions down to fast API/unit tests to heal the pyramid, and reintroduce scenarios only where a real Three Amigos conversation happens and a non-dev actually reads the output. The "removal test": if deleting Cucumber would cost only some HTML reports, they were never doing BDD.

**Q13. When is BDD genuinely the wrong choice?**
*Balance and honesty.*
**A.** When there's no communication gap to bridge — a technically complex but business-simple domain (a cache, protocol library, build tool) with no non-dev stakeholders. BDD's value scales with the communication gap and rule complexity; its cost is roughly fixed. Bottom-left domains gain nothing, so the tax isn't worth it — expressive plain or table-driven tests are better. Adopt BDD by domain, never by org-wide mandate.

---

## Scenarios and Gherkin Discipline

**Q14. What's the single most important discipline in writing Gherkin? Show it.**
*The #1 anti-pattern.*
**A.** Declarative, not imperative — describe *what* the user wants, not the *mechanical UI steps*.

```gherkin
# IMPERATIVE (anti-pattern): brittle, unreadable, breaks on every UI change
Scenario: Login
  Given I open "/login"
  And I type "alice@x.com" into "#email"
  And I click "#submit"
  And I wait 2 seconds
  Then I see ".dashboard"

# DECLARATIVE (correct): survives redesigns, readable by business
Scenario: Registered user logs in successfully
  Given I am a registered user
  When I log in with valid credentials
  Then I land on my dashboard
```

The mechanics (`#email`, `click`, `wait`) don't vanish — they move *down* into the step definition where a developer maintains them. The Gherkin stays a stable, business-readable description. An imperative suite is the #1 reason teams come to hate BDD.

**Q15. What is living documentation and what's its main caveat?**
*By-product-as-asset, with honesty.*
**A.** Living documentation is human-readable, always-current behaviour docs generated from *passing* scenarios — it can't silently go stale because if it diverges from the system it goes red. It's genuinely valuable for onboarding, support, and audit/compliance. The caveat: it's only documentation if the scenarios are *declarative*. Living docs generated from imperative click-scripts document the test, not the system, and serve no one.

**Q16. Where do acceptance tests belong in the pyramid?**
*Strategy placement.*
**A.** Near the top — they're typically integration/E2E-level, so slow and expensive, which means *few and stable*. Cover critical business journeys and complex rules; push permutations down to unit tests. Forgetting this inverts the pyramid into an ice-cream cone — hundreds of slow flaky business-language tests that bottleneck CI. Complex *rules* are best pinned by many cheap example rows at a low layer; only the critical *journey* needs a true top-of-pyramid acceptance test.

---

## Rapid-Fire

**Q.** One-line difference, acceptance vs unit? — *"Did we build the right thing?" vs "Is the code correct?"*
**Q.** BDD in one sentence? — *Conversation first, examples second, automation last.*
**Q.** Who coined BDD? — *Dan North.*
**Q.** Specification by Example author? — *Gojko Adzic.*
**Q.** The Gherkin triad? — *Given (context), When (action), Then (outcome).*
**Q.** #1 Gherkin anti-pattern? — *Imperative UI steps instead of declarative business language.*
**Q.** What does a step definition do? — *Binds a Gherkin sentence to code by a pattern.*
**Q.** ATDD vs TDD? — *ATDD's outer loop (acceptance) wraps TDD's inner loop (units).*
**Q.** Where do acceptance tests sit? — *Few, stable, near the top of the pyramid.*
**Q.** What's the "removal test"? — *Delete Cucumber; if you lost only HTML, you were paying tax, not doing BDD.*
**Q.** What metric should you NOT use for BDD success? — *Number of scenarios (Goodhart).*
**Q.** What should you measure instead? — *Rework / requirement-misunderstanding defects down; questions resolved early.*
**Q.** Best leading indicator the conversation happened? — *Red (open-question) cards resolved before the sprint.*
**Q.** Adopt BDD by mandate or by domain? — *By domain — only where a real communication gap + complex rules exist.*
**Q.** Should step definitions drive the UI? — *Usually no — drive below the UI; reserve browser for thin UI/smoke scenarios.*

---

## Red Flags / Green Flags

**Red flags (in a candidate):**

- Defines BDD as "writing Cucumber tests" with no mention of collaboration.
- Can't articulate the difference between acceptance and unit testing.
- Thinks more scenarios is always better; would measure success by scenario count.
- Writes imperative Gherkin (`click #id`) and sees nothing wrong with it.
- Believes BDD replaces unit tests / TDD.
- Never volunteers when BDD is *not* worth it.

**Green flags:**

- Leads with collaboration and shared understanding; calls Gherkin a by-product.
- Names the Cucumber-without-collaboration trap and the automation tax unprompted.
- Insists on declarative scenarios and driving below the UI.
- Places acceptance tests few-and-high in the pyramid; mentions the ice-cream cone risk.
- Distinguishes domains where BDD pays from where it's tax; advocates adoption by domain.
- Measures outcomes (rework, early-resolved questions), not artefacts; cites Goodhart.

---

## Cheat Sheet

```text
LEAD WITH: BDD = shared understanding first, tooling second.
           Gherkin without the conversation = overhead.

ACCEPTANCE vs UNIT
  "did we build the right thing?" vs "is the code correct?"

ORIGINS: Dan North (BDD) · Gojko Adzic (Specification by Example)

PRACTICE
  Three Amigos (business+dev+QA, before coding) → examples
  Example mapping: 🟨story 🟦rule 🟩example 🟥open-question
  "no red cards" = Definition of Ready (value w/o automation)

GHERKIN
  Feature / Scenario / Given-When-Then / Scenario Outline+Examples
  DECLARATIVE not imperative (the #1 anti-pattern)
  Step defs bind sentence→code; per-scenario state; drive below UI

STRATEGY
  Acceptance tests: few, stable, top of pyramid (else ice-cream cone)
  ATDD outer loop wraps TDD inner loop
  Living docs = always-current asset IF declarative

THE HONEST CRITIQUE (volunteer it!)
  Pays: real business↔dev↔QA gap + complex rules + readers
  Tax : devs write Gherkin for themselves; business-simple domain
  Removal test · adopt by domain not mandate
  Measure rework ↓, not scenario count (Goodhart)
```

---

## Summary

In a BDD interview, the differentiator is framing: **lead with collaboration**, treat Gherkin and Cucumber as a by-product, and be ready to define **acceptance vs unit testing** crisply ("right thing" vs "code correct"). Know the origins (North, Adzic), the practice (**Three Amigos**, **example mapping**, criteria-as-tests), and the discipline (**declarative not imperative**, drive below the UI, few stable acceptance tests near the top of the pyramid). Above all, volunteer the **honest critique** unprompted — the **Cucumber-without-collaboration trap**, the **automation tax**, the **removal test**, adoption **by domain not mandate**, and measuring **outcomes not scenario counts** (Goodhart). That balance — knowing both the value and the failure modes — is exactly the seniority signal interviewers are probing for.

---

## Further Reading

- Dan North — *Introducing BDD* (the foundational essay).
- *Specification by Example* — Gojko Adzic.
- *BDD in Action* — John Ferguson Smart.
- Matt Wynne — *Introducing Example Mapping*.
- Liz Keogh — talks/posts on BDD as conversation and avoiding cargo-cult adoption.

---

## Related Topics

- [Junior Level](./junior.md) — acceptance vs unit, first scenario, step definitions.
- [Middle Level](./middle.md) — Three Amigos, declarative discipline, tooling.
- [Senior Level](./senior.md) — cost/benefit, the trap, pyramid placement.
- [Professional Level](./professional.md) — org rollout and measurement.
- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — where acceptance tests belong.
- [End-to-End Testing](../04-end-to-end-testing/) — the drive layer acceptance tests often use.
- The `test-driven-development` skill — the inner loop ATDD wraps.
