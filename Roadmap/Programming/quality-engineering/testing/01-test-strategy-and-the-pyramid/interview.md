# Test Strategy & the Pyramid — Interview Level

> **Roadmap:** [Testing](../README.md) → Test Strategy & the Pyramid
> *The questions that separate "I write tests" from "I can design a test strategy under constraints."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Shapes & Trade-offs](#shapes--trade-offs)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **a question bank for test-strategy interviews — from "what is the pyramid" through designing and measuring a strategy under a CI budget.**

Test-strategy questions probe judgement, not trivia. Interviewers want to see whether you allocate finite effort by *risk* and *cost*, whether you know when the pyramid is the wrong shape, and whether you can reason about the suite as an economic system. Answers below are pitched at strong-candidate depth; adapt the detail to the seniority you're targeting.

## Prerequisites

**Required**

- The junior–professional pages of this topic: shapes, sizes vs types, allocation, CI budgets, governance.
- Hands-on experience writing tests at two or more levels.

**Helpful**

- A real story of a slow/flaky suite you improved — concrete numbers land well.

## Fundamentals

**Q1. What is the test pyramid and what problem does it solve?**
*Testing: do you understand the core trade-off, or just the picture?*
**A.** It is an allocation answer to a budget problem: given finite time, where do you spend testing effort? The pyramid says many fast isolated unit tests at the base, fewer integration tests in the middle, very few slow E2E tests at the top. The shape is bottom-heavy because each level up buys realism (confidence) at the cost of speed, determinism, and debuggability. A unit test fails in milliseconds pointing at a line; an E2E fails in minutes pointing at "something." It originates with Mike Cohn (*Succeeding with Agile*, 2009).

**Q2. Why not just write everything as E2E tests — they're the most realistic?**
*Testing: feedback-loop economics.*
**A.** Realism isn't free. E2E tests are slow (a 1,000-test E2E suite at 8 s each is over two hours; the same count of unit tests is seconds), flaky (real network/UI timing), and uninformative on failure. They also scale combinatorially — covering N edge cases through the UI means N full-stack runs. The result is a suite nobody runs and nobody trusts. E2E is precious; spend it on critical journeys, prove edge cases cheaply below.

**Q3. Distinguish unit, integration, and E2E tests.**
*Testing: vocabulary precision.*
**A.** By *scope*: unit exercises one function/class in isolation (no real I/O); integration exercises your code with a real collaborator (DB, queue, HTTP); E2E drives the whole running system as a user would. Each step adds code exercised and wiring proven, and adds setup, time, and failure surface. Crucially, classify each behaviour to the *lowest* level that can prove it, and cover it there only.

**Q4. What's the difference between a test's *size* and its *type*?**
*Testing: knowledge of the Google taxonomy and why it's sharper.*
**A.** *Type* (unit/integration/E2E) is about scope — how much code runs. *Size* (Google's small/medium/large) is about *resources* — can it touch the network, disk, system clock, or multiple machines? Size matters more operationally because the thing that makes tests slow and flaky is touching shared non-deterministic resources. A "unit test" that calls `sleep()` or hits `localhost` has the cost profile of an integration test regardless of its label. The useful question is "can this test touch the network/disk/clock?" — answer that and you've predicted its speed and flakiness.

## Technique

**Q5. How do you decide where a given behaviour should be tested?**
*Testing: the allocation heuristic.*
**A.** (1) Find the lowest level that can fail if the behaviour breaks — pure logic → unit, needs real I/O round-trip → integration, needs the full user flow → E2E. (2) Keep the *size* small: inject the clock, fake the network, use in-memory adapters to demote medium/large tests to small. (3) Cover each behaviour *once*; higher levels assert different concerns (wiring, journeys), never re-test the same rule. (4) Replace cross-service E2E with contract tests at the seams. (5) Reserve E2E for critical journeys only — happy path each, edge cases pushed down.

**Q6. You inherit a 30-minute, 20%-flaky CI suite. Walk me through fixing it.**
*Testing: can you diagnose and re-shape a suite?*
**A.** First, get data: test counts and runtime per level, and the flakiest offenders. The shape is almost certainly an ice-cream cone. Steps: (1) Quarantine the top flaky tests immediately so red means red again. (2) Audit the E2E suite for tests that re-assert logic catchable lower down — typically a large fraction; move those to fast unit tests and delete the E2E duplicates. (3) Keep only critical-journey E2E tests (happy paths). (4) Add contract tests for any cross-service E2E. (5) Parallelise/shard. (6) Demote medium tests to small by faking clock/network. Target: under 10 minutes, sub-1% flake, with *equal or better* escaped-defect coverage.

**Q7. How do you size the E2E layer concretely?**
*Testing: quantitative reasoning about the CI budget.*
**A.** Start from the budget. Say the rule is pre-merge CI under 10 minutes with 8-way parallelism — that's ~80 minutes of test-CPU. If unit and integration take ~5 minutes of that CPU, ~3–4 minutes remain for E2E. At ~12 s per E2E test that's roughly 15–20 tests of *effective* budget (account for flake re-runs: effective cost ≈ run_time × (1 + expected_reruns)). So the budget *tells you* you can afford ~15–20 E2E tests — which forces the discipline of picking only the most critical journeys. If someone wants 200, the arithmetic shows the budget breaks, and the conversation becomes objective.

**Q8. How do you avoid redundant coverage across levels?**
*Testing: discipline against silent suite bloat.*
**A.** For each behaviour, ask "what is the lowest level that fails if this breaks?" and cover it there only. Higher levels assert *different* things: integration proves the behaviour survives a save/reload round-trip; E2E proves a user can reach it. Concretely, free-shipping-over-$100 boundary cases ($99.99/$100.00/$100.01) belong in unit tests; integration checks the saved order still computes shipping; E2E checks one user sees "free shipping" at checkout — none re-tests the boundaries. Periodic audits ("which E2E tests assert unit-covered logic?") routinely let you delete a third of a legacy E2E suite.

## Shapes & Trade-offs

**Q9. When is the pyramid the wrong shape? Name the alternatives.**
*Testing: do you treat the pyramid as dogma or as one option?*
**A.** The pyramid fits logic-rich systems where complexity is in code you can exercise without I/O. It's wrong when bugs live elsewhere. For **front-ends**, Kent C. Dodds's **Testing Trophy** — fat integration layer (render real component trees, mock little) plus a static base (types/lint) — catches more, because front-end bugs are in composition and rendering, not deep logic. For **microservices**, Spotify's **Honeycomb** — fat integration, thin unit, very few integrated cross-service tests — fits because a thin service's bugs are at its seams (HTTP/JSON/SQL); contract tests replace the flaky cross-service E2E. The wrong shape is the **ice-cream cone**: too many slow E2E/manual tests, thin unit base — almost always arrived at by accident, never on purpose.

**Q10. What actually drives the right shape?**
*Testing: root-cause thinking.*
**A.** Three properties of the system: architecture (where does complexity live — algorithms? boundaries? UI wiring?), change rate (churny code needs fast feedback → push tests down), and cost of a missed bug (spend confidence where the blast radius is large). The shape is a *consequence* of these, not a style choice. Two services with identical architecture can warrant different strategies if one handles money and the other renders a dashboard.

**Q11. How do contract tests fit into a strategy for microservices?**
*Testing: the seam strategy.*
**A.** They're the cheaper substitute for cross-service E2E. Instead of booting N services to check A talks to B (slow, flaky, combinatorial), the consumer records its expectations of the provider as a contract, and the provider is verified against that contract in isolation. Each side runs as a fast small/medium test; together they guarantee the seam without ever running both. This is what keeps the honeycomb's "integrated" top thin — real multi-service E2E shrinks to a handful of smoke tests proving the environment assembles.

**Q12. Where does code coverage fit in a test strategy?**
*Testing: do you mistake coverage for strategy?*
**A.** Coverage is a *diagnostic*, not a target. Two failure modes when it becomes the goal: Goodhart's law (engineers write assertion-free tests that execute lines without checking behaviour — 90% coverage, near-zero confidence; mutation testing measures whether tests actually assert) and misallocation (uniform "80% everywhere" over-tests trivial getters and under-tests the pricing engine). Use coverage to find gaps in code you've *already decided* is risky, never as the strategy itself. Risk-based testing may deliberately lower a global coverage number while raising real safety.

## Scenarios

**Q13. Design a test strategy for a new payments service.**
*Testing: end-to-end strategy design under risk.*
**A.** Build a risk map first: money math is high-likelihood-of-bugs and critical-impact; the gateway integration is external/flaky and critical; auth/sessions are edge-time-sensitive and critical. Allocation: exhaustive unit tests for the money logic, plus property-based tests for invariants (tax never negative, subtotal + tax = total) since example tests miss input space. Fat integration layer for the gateway and DB seams, with the external gateway faked. A consumer-driven contract with the upstream orders service. A *handful* of E2E smoke tests for the one critical journey (successful payment) — not edge cases. Define a CI budget and a flake ceiling up front. Idempotency and retry behaviour get explicit unit tests because that's where payment bugs escape.

**Q14. A team wants to add 150 Selenium tests for "thorough coverage." How do you respond?**
*Testing: pushing back with reasoning, not dogma.*
**A.** Ask what each one asserts. Most will be edge cases of logic that belong in unit tests — cheaper, faster, more precise. Show the budget arithmetic: 150 × ~10 s = 25 minutes of test-CPU just for these, plus flake re-runs, which likely blows the CI budget on its own. Then redirect: keep E2E for the critical journeys (a handful), move the logic edge cases to unit tests, and add contract tests for any service seams they were trying to exercise. The goal is confidence-per-minute, and 150 E2E tests buy little of it.

**Q15. How do you know your test strategy is actually working?**
*Testing: measurement and feedback, the senior/staff differentiator.*
**A.** Four metrics read together: escaped defects classified by the lowest level that *should* have caught them (the key signal — it names the gap: e.g. "40% were unit-catchable bugs we never wrote"), suite p95 wall-clock (is the feedback loop fast enough?), flake rate (is it trusted?), and rough test ROI (confidence per maintenance cost). No single number suffices — they trade against each other, and optimising one alone backfires (Goodhart). The escaped-defect loop is what makes the strategy self-correcting: every production bug either confirms the allocation or points at where to invest next.

**Q16. The architecture is migrating from monolith to microservices. What happens to the test strategy?**
*Testing: evolving strategy with architecture.*
**A.** The shape must follow. Per service, shift from the monolith's pyramid toward a honeycomb/diamond. The critical move: replace cross-module integration and cross-service E2E with *contracts* at the new seams — otherwise the old E2E suite now boots all the services and flakes constantly (the classic lag failure). Push module logic into per-service unit tests, keep a few platform smoke tests, and treat the migration as an explicit coverage-migration review whose output is "what moves where, what gets deleted." Migrating coverage down and to contracts is the bulk of the work.

## Rapid-Fire

**Q17. One-line definition of a test strategy?** What to test, at which level, and why — an allocation of finite effort by risk and cost.

**Q18. "Write tests. Not too many. Mostly integration." Whose slogan, what shape?** Kent C. Dodds; the Testing Trophy (front-end).

**Q19. Why is a flaky test worse than no test?** It trains engineers to ignore red and burns the CI budget on re-runs, destroying trust in the whole suite.

**Q20. Effective cost of an E2E test?** run_time × (1 + expected re-runs) — flakiness multiplies the bill.

**Q21. The single most valuable strategy metric?** Escaped defects classified by the lowest level that should have caught them.

**Q22. Two reasons coverage-driven testing fails?** Goodhart (assertion-free tests game the number) and misallocation (uniform targets ignore risk).

**Q23. Diamond vs pyramid?** Diamond is integration-heavy (thin unit, thin E2E, fat middle) — fits thin services where bugs live at seams.

**Q24. How do you scale strategy governance across many teams?** Paved roads (templates, harnesses, dashboards) plus thin policy-as-code invariants — not a central QA bottleneck.

## Red Flags / Green Flags

**Green flags (strong candidate):**
- Frames testing as allocation under a budget; reasons quantitatively about CI time.
- Knows the pyramid is a default, not a law; picks the shape from where bugs live.
- Distinguishes test *size* from *type* and uses size to predict cost.
- Insists on covering each behaviour once, at the lowest level; audits redundancy.
- Treats coverage as a diagnostic and measures escaped defects by level.
- Replaces cross-service E2E with contracts; prices flakiness.

**Red flags (weak candidate):**
- "Just test everything through the UI / more E2E is safer."
- Treats the pyramid as a rigid rule with no idea when it's wrong.
- Equates coverage percentage with test quality.
- No sense of CI time budget or flakiness as costs.
- Can't say how they'd know the strategy works (no metrics, no feedback loop).
- Adds tests at every level for the same behaviour without noticing redundancy.

## Cheat Sheet

```text
CORE FRAME
  strategy = what / which level / why = allocate finite effort by RISK and COST
  each level up: +realism, -speed, -determinism, -debuggability

SHAPES (pick by where bugs live)
  Pyramid (Cohn)   logic-rich back-end   wide unit base
  Trophy  (Dodds)  front-end / JS        fat integration + static base
  Honeycomb (Spotify) microservices      fat integration + contracts at seams
  Ice-cream cone   ANTI-PATTERN          too many E2E/manual -> push coverage DOWN

SIZE not just TYPE
  small = no net/disk/clock; medium = localhost; large = multi-machine
  "can it touch net/disk/clock?" predicts speed + flakiness

ALLOCATE
  lowest level that proves it | keep size small | cover ONCE
  seams -> contracts | E2E -> critical journeys only | coverage = diagnostic

MEASURE (read together)
  escaped defects by level | CI p95 | flake rate | ROI
  E2E effective cost = run_time × (1 + reruns)
```

## Summary

- A test strategy answers **what / which level / why** — an allocation of finite effort by **risk and cost**; the pyramid is the default answer, not the only one.
- Know the **shapes** (pyramid, trophy, honeycomb, ice-cream cone) and what drives each: architecture, change rate, cost of a missed bug.
- Reason about **size, not just type**, and about the **CI budget** quantitatively — it settles "how many E2E" objectively.
- Cover each behaviour **once at its lowest level**, use **contracts** at seams, treat **coverage as a diagnostic**, and **measure escaped defects by level** to prove the strategy works.
- Strong candidates think in **confidence-per-minute** and a **feedback loop**, not in "more tests."

## Further Reading

- Mike Cohn, *Succeeding with Agile* — the original pyramid.
- Martin Fowler / Ham Vocke, "The Practical Test Pyramid."
- Kent C. Dodds, "The Testing Trophy."
- Mike Wacker (Google), "Just Say No to More End-to-End Tests."
- *Software Engineering at Google* — test sizes, flakiness, scale.

## Related Topics

- [Unit Testing](../02-unit-testing/) · [Integration Testing](../03-integration-testing/) · [End-to-End Testing](../04-end-to-end-testing/)
- [Contract Testing](../05-contract-testing/) — the seam strategy.
- [Property-Based Testing](../06-property-based-testing/) · [Mutation Testing](../07-mutation-testing/) — depth and assertion quality.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — the flakiness tax.
- [Code Coverage](../../code-coverage/) · [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — measurement context.
- Tier pages: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md).
