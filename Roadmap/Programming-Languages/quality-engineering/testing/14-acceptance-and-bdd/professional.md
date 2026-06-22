# Acceptance & BDD — Professional Level

> **Roadmap:** [Testing](../README.md) → Acceptance & BDD
>
> *Rolling BDD across an org is change management, not tool adoption. This tier is the introduction strategy, the example-mapping rollout, the traps to design out, and how to measure whether shared understanding actually improved.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — BDD Adoption Is Organisational Change](#core-concept-1----bdd-adoption-is-organisational-change)
5. [Core Concept 2 — Diagnosing Whether the Org Even Needs BDD](#core-concept-2----diagnosing-whether-the-org-even-needs-bdd)
6. [Core Concept 3 — Rolling Out Example Mapping and the Three Amigos](#core-concept-3----rolling-out-example-mapping-and-the-three-amigos)
7. [Core Concept 4 — Designing Out the Cucumber-Without-Collaboration Trap](#core-concept-4----designing-out-the-cucumber-without-collaboration-trap)
8. [Core Concept 5 — Living Documentation as a Platform Capability](#core-concept-5----living-documentation-as-a-platform-capability)
9. [Core Concept 6 — Measuring Whether Shared Understanding Improved](#core-concept-6----measuring-whether-shared-understanding-improved)
10. [Core Concept 7 — Maintaining Acceptance Suites at Scale](#core-concept-7----maintaining-acceptance-suites-at-scale)
11. [Core Concept 8 — BDD, Requirements, and the Product Org](#core-concept-8----bdd-requirements-and-the-product-org)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **introducing, scaling, and governing BDD across an organisation — as a process and culture change — while avoiding the dominant failure modes and measuring the only thing that justifies it: improved shared understanding.**

The professional doesn't write scenarios; they decide whether dozens of teams should, how to introduce the practice without producing an expensive ceremony, what platform support makes it sustainable, and how to know — with evidence, not vibes — whether it worked. Because BDD's value is collaboration and its cost is automation, a careless rollout reliably produces the worst outcome: every team pays the tax, none gain the benefit. This tier is how to avoid that at scale.

---

## Prerequisites

- You can make the senior cost/benefit call on BDD and recognise the Cucumber-without-collaboration trap ([Senior Level](./senior.md)).
- You own org-wide testing standards, the pyramid policy, and CI/CD that runs acceptance suites ([Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/)).
- You work with product/requirements leadership and can influence process, not just code.
- You understand engineering metrics well enough to avoid Goodhart traps (see the engineering-metrics-and-dora section).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Example mapping** | A timeboxed technique (Wynne) decomposing a story into rules, examples, and open questions on coloured cards. |
| **Three Amigos** | The business + dev + QA pre-coding conversation BDD is built on. |
| **Automation tax** | The fixed ongoing cost of Gherkin + step definitions + suite maintenance, independent of collaboration benefit. |
| **Living documentation** | Always-current, human-readable behaviour docs generated from passing scenarios. |
| **Step-definition library** | The shared, curated catalogue of reusable steps across an org's features. |
| **Goodhart's law** | "When a measure becomes a target, it ceases to be a good measure" — the central risk in measuring BDD. |
| **Definition of Ready** | Criteria a story must meet before it's pulled into a sprint; example-mapped questions resolved is a strong one. |
| **Ubiquitous language** | DDD's shared domain vocabulary; BDD scenarios are a natural place to enforce it. |

---

## Core Concept 1 — BDD Adoption Is Organisational Change

The single most expensive professional mistake is treating BDD adoption as a tooling project. It is a **behaviour change for humans**: getting business, dev, and QA to talk *before* coding, in a structured way, sustainably. The tool (Cucumber/SpecFlow/etc.) is the last 10% and the easy part.

Frame the rollout accordingly:

- **The unit of change is the conversation**, not the `.feature` file. If the conversation doesn't change, nothing of value changed.
- **Standards and CI cannot manufacture collaboration.** Mandating "every story must have Gherkin" without mandating the conversation guarantees devs writing Gherkin alone — the trap, at org scale.
- **It competes with culture.** If POs throw stories over the wall and devs prefer to work heads-down, BDD asks for a real change in how people interact. Budget for that, or don't start.

> Professional litmus test: *if you rolled out the Three Amigos conversation and example mapping but never installed any BDD tool, would the org be better off?* If yes, that's the real intervention — automation is optional and follows. If no, BDD isn't your problem.

---

## Core Concept 2 — Diagnosing Whether the Org Even Needs BDD

Before any rollout, diagnose the **communication gap** and **rule complexity** per domain. Not every team should do BDD, and a blanket mandate is how you create org-wide tax.

A simple decision aid:

```text
                          Complex business rules?
                         NO                    YES
                  ┌───────────────────┬───────────────────┐
  Real business   │  DON'T do BDD     │  BDD via shared    │
  ↔ dev ↔ QA      │  expressive plain │  conversation,     │
  gap?    YES     │  tests + good     │  living docs —      │
                  │  acceptance       │  STRONG fit         │
                  ├───────────────────┼───────────────────┤
                  │  DON'T do BDD     │  Maybe — examples   │
            NO    │  pure tax; unit + │  help devs reason,  │
                  │  integration      │  but watch the tax  │
                  └───────────────────┴───────────────────┘
```

Domains in the top-right (insurance, lending, tax, healthcare eligibility, complex pricing, regulated workflows) are where BDD's collaboration value is real and large. Infrastructure/library/protocol teams are bottom-left — keep them off BDD. **Adopt by domain, never by mandate.**

---

## Core Concept 3 — Rolling Out Example Mapping and the Three Amigos

The practical seed of a BDD rollout is **example mapping**, because it makes the collaboration concrete, timeboxed, and low-ceremony — and crucially, it produces value (resolved ambiguity) *before* any code or Gherkin exists.

The session (25 minutes, four card colours):

```text
  🟨 YELLOW — the story under discussion (one card)
  🟦 BLUE   — a business RULE that constrains it
  🟩 GREEN  — a concrete EXAMPLE illustrating a rule
  🟥 RED    — an open QUESTION nobody can answer yet

  Worked example — "Refund a cancelled order":
   🟨 Refund a cancelled order
    🟦 Refund the full amount if cancelled before dispatch
       🟩 Order cancelled 1h after purchase, not yet dispatched → full refund
    🟦 Refund minus restocking fee if cancelled after dispatch
       🟩 Cancelled after dispatch, $100 order, 10% fee → $90 refund
       🟩 Digital goods → no restocking fee even after "dispatch"
    🟥 What about partial cancellations of a multi-item order?   ← UNRESOLVED
    🟥 Do gift-card payments refund to the card or as store credit?  ← UNRESOLVED
```

Rollout sequence that works:

1. **Pilot one team** in a top-right domain (Concept 2). Coach the conversation; let Gherkin emerge from green cards *only after* the session.
2. **Make "no red cards left" part of Definition of Ready.** This alone delivers value even if the team never automates a scenario — the ambiguity is gone before the sprint.
3. **Automate the green examples** that are critical journeys/rules; leave the rest as the agreed criteria.
4. **Spread by demonstrated win**, not decree. Other teams adopt when the pilot ships fewer "that's not what I meant" surprises.

The deliverable of step 1 is *fewer mid-sprint surprises*, not a folder of `.feature` files. Keep that ordering visible or the org will cargo-cult the artefacts.

---

## Core Concept 4 — Designing Out the Cucumber-Without-Collaboration Trap

At org scale, the trap (devs writing imperative Gherkin nobody reads, slow brittle browser suites, full tax / zero benefit) must be *designed out structurally*, because individual goodwill won't hold across dozens of teams.

Structural defences:

- **Don't mandate Gherkin; mandate the conversation.** A standard that says "stories in domains X/Y get an example-mapping session" targets the value. A standard that says "every PR needs a `.feature`" targets the tax.
- **Require a named non-dev reader per feature file.** If no PO/QA/analyst will read it, it shouldn't be Gherkin — it should be a plain test. Make this a review checklist item.
- **Lint against imperative steps.** A CI check that flags `click`, `type`, `wait`, `#id`, `xpath` in `.feature` files catches the brittlest anti-pattern automatically.
- **Cap browser-driven scenarios** via the pyramid policy and drive-layer guidance; provide an in-process/API driver harness so the fast path is the easy path (cross-ref [End-to-End Testing](../04-end-to-end-testing/)).
- **Periodic "reader audit."** Ask POs/QA whether they actually read the living docs. If a team's readers have gone silent, that team has slipped into tax — intervene or let them drop Gherkin.

> The standard you write determines the outcome. "Every story has Gherkin" produces org-wide tax. "Every complex-domain story has a Three Amigos conversation, recorded as examples a named non-dev reads" produces the benefit.

---

## Core Concept 5 — Living Documentation as a Platform Capability

When BDD fits, **living documentation** is the durable asset that often outlives the testing motive — and it's a platform capability worth investing in centrally.

What "platform-grade" living docs require:

- **Aggregation** across teams/services into one searchable behaviour catalogue (Serenity BDD, SpecFlow+ LivingDoc, Cucumber Reports, Pickles).
- **Freshness guarantee:** docs are published from the *passing* CI run, so green is a precondition of publication — stale docs are structurally impossible.
- **Audience routing:** auditors see compliance-tagged features; support sees user-journey features; new joiners get a curated subset.
- **Traceability:** scenarios tagged to requirements/tickets/regulations, so "show me the executable spec for control 8.2.1, all green" is one query — gold in regulated environments.

This is the clearest place BDD's by-product becomes a primary deliverable. But it remains conditional: living docs are only documentation if scenarios are **declarative** (Concept 4). The platform should *refuse to publish* imperative junk by failing the lint gate.

---

## Core Concept 6 — Measuring Whether Shared Understanding Improved

You must know if the investment paid off — and this is treacherous, because the obvious metrics are exactly the ones Goodhart's law destroys.

**Vanity metrics that invite gaming (avoid as targets):**

- *Number of scenarios* — maximised by writing useless scenarios.
- *Gherkin line count / "coverage by feature"* — rewards verbosity and the ice-cream cone.
- *% of stories with a `.feature` file* — produces devs writing Gherkin alone (the trap, mandated).

**Signals that actually track shared understanding:**

- **Rework rate / "that's not what I meant" defects** — bugs traced to *misunderstood requirements*, not code defects. BDD should drive this down; it's the most direct value signal.
- **Mid-sprint requirement clarifications** — should *fall* (resolved up front by example mapping) and shift *earlier* (into the conversation).
- **Story cycle time variance** — fewer nasty surprises means less right-skew in cycle time.
- **Escaped acceptance-criteria defects** — bugs where the system violated an *agreed* criterion; should approach zero if criteria are executable.
- **Qualitative: do non-devs read and trust the living docs?** A direct survey/audit beats any proxy. If POs cite the docs in conversations, the practice took.
- **Open-questions-resolved-before-sprint** (red cards closed in Definition of Ready) — a leading indicator of the conversation actually happening.

> Measure *outcomes* (less rework, fewer requirement-misunderstanding defects, more questions resolved early), never *artefacts* (scenario count). The moment "number of scenarios" becomes a target, teams will hit the target and lose the point — the canonical Goodhart failure, and the most common way BDD metrics mislead leadership into thinking a tax is a triumph.

---

## Core Concept 7 — Maintaining Acceptance Suites at Scale

Across many teams, acceptance suites decay unless governed as a platform concern:

- **A curated step-definition library** with reuse and naming conventions, owned like production code; otherwise every team reinvents `I log in` five ways and the catalogue rots.
- **Pyramid policy with teeth:** acceptance/E2E scenario budgets per service; CI placement that runs `@smoke` per-commit and full suites on a schedule (cross-ref [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/)).
- **Org-wide flake SLO.** Acceptance flake is the most expensive flake; track it, quarantine fast, and treat a chronically flaky suite as a reliability incident ([Flaky Tests & Reliability](../12-flaky-tests-and-reliability/)).
- **Drive-layer harness as paved road.** Provide in-process/API drivers so fast, stable acceptance tests are the default; making the slow browser path the *hard* path is your strongest lever against the ice-cream cone.
- **Periodic dead-scenario pruning.** Scenarios nobody reads and bugs that should've been unit tests accumulate; budget cleanup.

---

## Core Concept 8 — BDD, Requirements, and the Product Org

BDD only works if it reaches *into* the product/requirements process, not just the test code.

- **Examples become acceptance criteria become tests** — one artefact, one source of truth. If product writes criteria in a separate doc that drifts from the scenarios, you've lost specification-by-example's core benefit.
- **Definition of Ready ← example mapping.** "Open questions resolved" gates a story into a sprint; this is where BDD pays even when teams barely automate.
- **Ubiquitous language.** Scenarios are an excellent enforcer of a shared domain vocabulary (DDD); divergent terms in features signal a domain-model fracture worth fixing.
- **Don't let it ossify requirements.** Heavy upfront example mapping can drift toward big-design-up-front. Keep sessions timeboxed and per-story; the goal is shared understanding, not an exhaustive spec.

---

## Real-World Examples

- **Regulated lender, successful rollout.** Started with example mapping on the eligibility domain (top-right). "Red cards resolved" entered Definition of Ready; rework defects dropped ~40% over two quarters. Living docs, tagged to regulatory controls, became the audit artefact. Automation followed the conversation, not the reverse — and they measured rework, not scenario count.
- **Enterprise mandate, failed rollout.** A VP mandated "Cucumber for all teams." Within a quarter, infra and platform teams (bottom-left) were writing imperative Gherkin for themselves, suites ballooned to 40-minute ice-cream cones, and the dashboard proudly showed "12,000 scenarios" — pure tax dressed as success by a vanity metric. The fix: rescind the mandate, adopt by domain, switch the metric to rework rate.
- **Living docs outliving BDD.** A team's automated suite withered, but the *living documentation* habit stuck: their declarative scenarios remained the canonical, always-green description of behaviour that support and new hires relied on daily — the by-product proving more durable than the original testing motive.

---

## Mental Models

- **Roll out the conversation, not the tool.** The conversation is the intervention; automation is optional follow-on.
- **Adopt by domain, never by mandate.** Top-right domains gain; bottom-left domains only pay.
- **The standard you write is the outcome you get.** Mandate Gherkin → tax; mandate the conversation with a named reader → benefit.
- **Measure outcomes, not artefacts.** Rework down, questions resolved early — never scenario count (Goodhart).
- **Living docs are the durable asset** — but only if the gate refuses imperative junk.

---

## Common Mistakes

- **Org-wide Cucumber mandate.** Guarantees the trap at scale: every team pays the tax, bottom-left domains gain nothing.
- **Counting scenarios as success.** The textbook Goodhart failure; rewards volume and the ice-cream cone, misleads leadership.
- **Mandating the artefact, not the conversation.** Produces devs writing Gherkin alone — exactly what BDD exists to prevent.
- **No paved fast path.** Without an in-process/API driver harness, teams default to slow browser scenarios and the pyramid inverts.
- **Letting criteria and scenarios drift apart.** Two sources of truth defeats specification by example; keep examples = criteria = tests.
- **Heavy upfront mapping.** Drifts toward big-design-up-front; keep sessions timeboxed and per-story.

---

## Test Yourself

1. A VP wants to mandate Cucumber across all 30 teams. Walk through your response and the diagnosis you'd run first.
2. Why is "number of scenarios" a dangerous success metric, and what would you measure instead?
3. What structural defences design out the Cucumber-without-collaboration trap at org scale?
4. How can a BDD rollout deliver value to a team that never automates a single scenario?
5. What makes living documentation a "platform capability" rather than a per-team report?
6. Which domains should you keep *off* BDD, and why?

<details>
<summary>Answers</summary>

1. Reframe: BDD is a process/culture change, not a tool purchase, and a blanket mandate creates org-wide tax. Diagnose per domain along two axes — communication gap and rule complexity. Adopt only in top-right domains; pilot one team via example mapping; spread by demonstrated reduction in rework, never by decree.
2. It's a Goodhart trap: making count a target rewards writing useless scenarios and building the ice-cream cone, while masking whether shared understanding improved. Measure outcomes instead: rework/requirement-misunderstanding defect rate (down), mid-sprint clarifications (down/earlier), red cards resolved before sprint (up), and whether non-devs actually read the living docs.
3. Mandate the conversation not the artefact; require a named non-dev reader per feature; lint against imperative steps (click/type/#id); cap browser-driven scenarios via pyramid policy; provide an in-process/API driver harness as the paved fast path; run periodic reader audits.
4. By adopting example mapping into Definition of Ready: resolving the red-card open questions *before* the sprint removes ambiguity and cuts rework, which is the bulk of BDD's value — delivered entirely by the conversation, with zero automation.
5. Central aggregation across teams into one searchable catalogue, a freshness guarantee (published only from passing CI), audience routing and requirement traceability, and a publish gate that refuses imperative scenarios. It serves auditors, support, and onboarding org-wide, not one team's CI artifact.
6. Technically complex but business-simple domains with no non-dev stakeholders — infrastructure, libraries, protocols, build tooling. There's no communication gap to bridge, so the fixed automation tax buys nothing; expressive plain/table-driven tests serve better.

</details>

---

## Cheat Sheet

```text
ADOPTION = ORG CHANGE, NOT TOOLING
  Roll out the conversation (Three Amigos + example mapping).
  Litmus: would rolling out the conversation WITHOUT the tool help?
          yes → that's the intervention.  no → BDD isn't your problem.

DIAGNOSE BY DOMAIN (gap × rule-complexity)
  top-right (regulated/finance/complex rules + non-dev readers) → STRONG fit
  bottom-left (infra/library/protocol)                          → keep OFF

EXAMPLE MAPPING (25 min, 4 cards)
  🟨 story  🟦 rule  🟩 example  🟥 open question
  "no red cards" → Definition of Ready  (value before any Gherkin)

DESIGN OUT THE TRAP
  mandate the CONVERSATION, not the .feature file
  require a named non-dev reader per feature
  lint imperative steps (click/type/#id/xpath)
  paved fast path: in-process/API driver harness  → cap browser scenarios

MEASURE OUTCOMES, NOT ARTEFACTS  (Goodhart!)
  GOOD: rework rate ↓ · req-misunderstanding defects ↓ ·
        red cards resolved pre-sprint ↑ · do non-devs read living docs?
  BAD : scenario count · Gherkin lines · % stories with .feature

LIVING DOCS = platform capability
  aggregated · published only when green · traceable to requirements

SUSTAIN AT SCALE
  curated step-def library · pyramid budgets · flake SLO ·
  prune dead scenarios · examples = criteria = tests (one source of truth)
```

---

## Summary

At the professional tier, Acceptance & BDD is change management. The decisive move is to treat adoption as an **organisational and cultural change** — rolling out the Three Amigos conversation and **example mapping**, not a Cucumber licence — and to **adopt by domain, never by mandate**, because only domains with a real communication gap and complex business rules clear the fixed automation tax. The dominant org-scale failure is the Cucumber-without-collaboration trap, which you **design out structurally**: mandate the conversation rather than the `.feature` file, require a named non-dev reader, lint out imperative steps, and pave a fast in-process/API drive path so the pyramid can't invert. Measure the only thing that justifies the investment — **improved shared understanding**, via rework rate and questions resolved early — and refuse the Goodhart trap of counting scenarios. Done this way, **living documentation** becomes a durable, always-current platform asset, examples stay unified with acceptance criteria and tests as one source of truth, and the org gets BDD's benefit instead of merely paying its bill.

---

## Further Reading

- *Specification by Example* — Gojko Adzic (org-level adoption patterns and anti-patterns; living documentation).
- Matt Wynne — *Introducing Example Mapping* + Cucumber community talks.
- *BDD in Action* — John Ferguson Smart (scaling, living docs, requirement traceability).
- *Fifty Quick Ideas to Improve Your Tests* — Adzic, Evans & Roden (practical maintenance ideas).
- *Domain-Driven Design* — Eric Evans (ubiquitous language, which scenarios should enforce).
- Liz Keogh — writing on measuring BDD by outcomes and avoiding cargo-cult adoption.

---

## Related Topics

- [Senior Level](./senior.md) — the cost/benefit calculus and drive-layer design this tier scales.
- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — the org pyramid policy that keeps acceptance suites few.
- [End-to-End Testing](../04-end-to-end-testing/) — the paved drive-layer harness and browser-scenario caps.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — the flake SLO acceptance suites need most.
- [Unit Testing](../02-unit-testing/) — the inner-loop tests your pyramid policy must protect.
- The `test-driven-development` skill — the inner loop ATDD wraps across the org.
