# Test Strategy & the Pyramid — Professional Level

> **Roadmap:** [Testing](../README.md) → Test Strategy & the Pyramid
> *Governing a test strategy across many teams: making it a living document, measuring whether it works, and evolving it as the architecture moves.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- Strategy as a living document, not a triangle on a wiki](#core-concept-1----strategy-as-a-living-document-not-a-triangle-on-a-wiki)
5. [Core Concept 2 -- Governing across teams without central bottlenecks](#core-concept-2----governing-across-teams-without-central-bottlenecks)
6. [Core Concept 3 -- Measuring whether the strategy works](#core-concept-3----measuring-whether-the-strategy-works)
7. [Core Concept 4 -- The escaped-defect feedback loop](#core-concept-4----the-escaped-defect-feedback-loop)
8. [Core Concept 5 -- Test ROI and the economics of confidence](#core-concept-5----test-roi-and-the-economics-of-confidence)
9. [Core Concept 6 -- Evolving the strategy as architecture changes](#core-concept-6----evolving-the-strategy-as-architecture-changes)
10. [Core Concept 7 -- Guardrails: gates, budgets, and quarantine policy](#core-concept-7----guardrails-gates-budgets-and-quarantine-policy)
11. [Core Concept 8 -- Anti-patterns at organisational scale](#core-concept-8----anti-patterns-at-organisational-scale)
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

> Focus: **operating a test strategy at organisation scale — as a versioned, measured, evolving system, not a one-time diagram — and proving it earns its cost.**

At one service, a strategy is a design choice. Across dozens of teams and services, it becomes a *governance* problem: how do you set direction without becoming a bottleneck, let teams adapt to their own risk profiles, measure whether the whole thing actually prevents escaped defects, and migrate it when the architecture shifts under you? This page is about running the strategy as a living system with feedback.

## Prerequisites

**Required**

- Senior level: risk-based design, CI budgets, redundancy elimination, contracts, flakiness pricing.
- Experience influencing more than one team's engineering practice.

**Helpful**

- Access to your org's incident/postmortem record and CI analytics.
- Familiarity with policy-as-code / required-checks tooling.

## Glossary

| Term | Plain-English meaning |
|---|---|
| Living document | A strategy versioned and revised on a cadence and on triggers, not written once. |
| Escaped defect | A bug that reached production despite the suite; the truest test-quality signal. |
| DDP (Defect Detection Percentage) | Share of total defects caught before release vs. escaped to production. |
| Test ROI | Confidence/defect-prevention gained per unit of authoring + run + maintenance cost. |
| Paved road | A supported default toolchain/template teams get for free if they follow it. |
| Quarantine | Isolating a flaky test from blocking merges while it's fixed or deleted. |
| Suite SLO | A service-level objective for the suite itself (e.g. p95 CI time, flake rate). |
| Strategy drift | The gradual divergence of actual test distribution from the intended one. |

## Core Concept 1 -- Strategy as a living document, not a triangle on a wiki

A test strategy that is written once and never revisited is dead on arrival — the architecture moves, the risk profile shifts, and the document becomes folklore. A *living* strategy has four properties:

1. **Versioned and owned.** It lives in source control next to the code (or in an ADR), with a named owner (often a guild/working group, not one person).
2. **Revised on a cadence and on triggers.** Quarterly review *plus* event-driven revisions: a major incident, a re-architecture, a new compliance requirement, a CI-time regression.
3. **Prescriptive about defaults, permissive about adaptation.** It states the org default (e.g. "pyramid by default; trophy for front-ends; honeycomb + contracts for services") and the *conditions* under which a team deviates — with a documented rationale.
4. **Connected to outcomes.** It cites the metrics it is meant to move (escaped defects, CI time, flake rate) so revisions are evidence-driven, not opinion-driven.

The deliverable is short — a few pages — because a strategy people actually read beats an exhaustive one they don't.

## Core Concept 2 -- Governing across teams without central bottlenecks

The failure mode of org-wide testing is a central QA team that becomes a queue. The scalable alternative is **paved roads + thin governance**:

- **Paved road.** Provide a supported default: test framework, fixtures, CI templates, contract-testing harness, an in-memory infra library, flakiness dashboards. Teams that stay on the paved road get speed and support for free; the strategy is *embodied in tooling*, not enforced by reviewers.
- **Thin governance.** A small set of org-level *invariants* enforced as policy-as-code (see [Quality Gates](../../quality-gates/)), e.g. "every cross-service dependency has a contract test," "pre-merge CI must finish under N minutes," "no PR merges with a quarantined-but-unowned flake older than 14 days."
- **Federated ownership.** Each team owns its risk map and its deviations; a guild reviews patterns across teams and folds learnings back into the paved road.

The principle: **make the right thing the easy thing.** Most adoption comes from good defaults, not from mandates.

## Core Concept 3 -- Measuring whether the strategy works

A strategy you cannot measure is a belief. Four metrics, read together, tell you if it's working:

```text
Metric                    What it tells you                  Healthy direction
-----------------------------------------------------------------------------------
Escaped defects / level   is the suite catching the right     down; and caught at
                          bugs at the right level?            the LOWEST useful level
Suite wall-clock (p95)    is the feedback loop fast enough?   under the CI budget
Flake rate (test+suite)   is the suite trustworthy?           under the ceiling
Test ROI / maintenance    is the suite worth its upkeep?      confidence up, cost flat
```

No single number suffices — they trade against each other. Driving CI time down by deleting tests can raise escaped defects; chasing zero escaped defects can blow the time budget and flake rate. The strategy's job is to hold *all four* in an acceptable region, and the metrics make that trade visible. Beware optimising any one (Goodhart): a team told only "raise coverage" will write assertion-free tests; a team told only "cut CI time" will delete the tests that matter.

## Core Concept 4 -- The escaped-defect feedback loop

The single most valuable signal is **escaped defects classified by the level that *should* have caught them.** Every production incident or customer-reported bug gets a one-line post-hoc tag:

```text
Incident #4471 -- refund applied twice on retry
  Root cause     : non-idempotent refund handler
  Lowest level that could have caught it: UNIT (idempotency of the handler)
  Was there a test there? NO
  Action: add unit test for idempotency; this is a strategy gap, not a fluke
```

Aggregate these over a quarter and a pattern emerges: *"40% of escaped defects were catchable by a unit test we didn't write"* points at an under-invested base; *"most escapes are seam/integration bugs"* points at thin integration coverage or missing contracts; *"escapes are all in flows with no E2E"* points at an over-thin top. This loop is what converts the strategy from static to *self-correcting* — each escape either confirms the allocation or names the gap. It also catches the subtle case where a bug escaped *despite* a test at the right level — meaning the test was weak (a job for [Mutation Testing](../07-mutation-testing/)).

## Core Concept 5 -- Test ROI and the economics of confidence

Every test has a lifetime cost — authoring, every run forever, and maintenance on every related change — paid against the confidence it buys. Framing tests as investments clarifies the whole strategy:

```text
ROI(test) ≈ (probability it catches a real, costly defect × cost of that defect)
            ----------------------------------------------------------------
            (authoring cost + Σ run cost over lifetime + maintenance cost)
```

This explains, quantitatively, the patterns the lower tiers asserted by instinct:

- **Unit tests have high ROI**: tiny run cost, low maintenance, and they catch defects close to the source. The denominator is small.
- **E2E tests have low ROI per test**: large run cost (× every run, forever), high maintenance (brittle to UI change), and flakiness tax. They are worth it *only* where the numerator is huge — a critical journey whose failure is catastrophic.
- **Redundant tests have negative ROI**: the numerator is ~zero (the defect was already catchable elsewhere) while the denominator keeps charging.

The professional move is to **periodically compute rough ROI and prune the bottom of the distribution** — delete brittle, redundant, low-value tests. A smaller suite that is faster and more trusted often *raises* real safety. "More tests" is not the goal; "more confidence per minute" is.

## Core Concept 6 -- Evolving the strategy as architecture changes

The right shape is a function of the architecture, so when the architecture moves, the strategy must follow — and these migrations are where org-scale strategies most often rot.

```text
Architecture change           -> Strategy shift
---------------------------------------------------------------------------
Monolith -> microservices      pyramid -> honeycomb/diamond per service;
                               replace cross-module integration with CONTRACTS at new seams
Server-rendered -> SPA/React   add a static base (types/lint); shift to trophy on the front-end
Sync REST -> event-driven      contracts on message schemas; add consumer tests for events;
                               E2E becomes async/eventual -> needs different harness
Adding a 3rd-party dependency  add a contract or a fake; never let it into the hot test path live
Extracting a shared library    its logic moves to unit tests in the lib; callers drop redundant tests
```

The danger is **lag**: services get split but the old monolith-era E2E suite is kept, now booting six services and flaking constantly. Each architectural change should trigger a strategy review (see the living-document triggers in Concept 1) whose explicit output is *what coverage moves where* — what gets deleted, what new seams need contracts, what new fast tests replace old slow ones. Migrating coverage *down and to contracts* is usually the bulk of the work.

## Core Concept 7 -- Guardrails: gates, budgets, and quarantine policy

Turn the strategy's invariants into automated guardrails so it holds without constant policing:

- **Required checks** (policy-as-code): contracts exist for every declared dependency; pre-merge suite within budget; no merge if flake rate over ceiling. See [Quality Gates](../../quality-gates/).
- **A suite SLO**, treated like a production SLO: e.g. *p95 pre-merge CI < 10 min; suite flake < 0.1%.* Breaches page the suite's owners and trigger investigation, exactly like a latency SLO.
- **Quarantine policy with teeth.** A flaky test is quarantined (stops blocking merges) the moment it crosses a threshold, *and* gets an owner and a deadline. Quarantined-and-orphaned tests are deleted, not left to rot. Blanket auto-retry is banned — it hides the rot and burns the budget.
- **CI-time budget enforcement.** A regression in suite time fails the build or alerts, so the suite cannot creep toward the cone unnoticed.

These guardrails are what keep the strategy from drifting between the quarterly reviews.

## Core Concept 8 -- Anti-patterns at organisational scale

The single-service anti-patterns (cone, redundancy, coverage-worship) recur at org scale, plus some that only appear with many teams:

- **The org-wide ice-cream cone by acquisition.** A central E2E suite owned by no team grows until it's a 90-minute, 30%-flake gatekeeper everyone games with retries. Nobody decided it; it accreted.
- **Mandated uniform shape.** Forcing the pyramid onto front-end teams (or the trophy onto back-end services) ignores where bugs live and produces theatre.
- **Coverage gate as the whole strategy.** An org-wide "80% or no merge" rule with no risk weighting and no assertion-quality check — maximally Goodhart-able.
- **Strategy without a feedback loop.** A beautiful document with no escaped-defect classification; it cannot tell whether it works, so it never improves.
- **Central QA queue.** Governance via a bottleneck team instead of paved roads; scales linearly with headcount, which is to say, doesn't.

## Real-World Examples

**A platform org installs paved roads.** Instead of a QA mandate, the platform team ships a CI template (parallel sharding, flake quarantine, contract-test harness) and an in-memory infra library. Teams adopt it because it makes their CI 4× faster, *not* because they're told to. Strategy adoption follows tooling.

**Escaped-defect review changes the allocation.** A quarterly review classifies 60 production incidents by lowest-catching level. 38 were unit-catchable bugs in code with weak tests; 14 were seam bugs in services lacking contracts; the org had been pouring effort into E2E. The strategy is revised: invest in the base and in contracts, freeze E2E growth. Next quarter's escapes drop by half.

**A microservices migration that lagged.** A team split a monolith into five services but kept the monolith's 40-minute E2E suite, now booting all five and flaking at 25%. The strategy review mandates: replace the cross-service E2E with consumer-driven contracts, keep 6 platform smoke tests, push module logic into per-service unit tests. CI returns to 8 minutes; flake under 1%.

**Pruning for ROI.** An audit computes rough ROI across a 6,000-test suite and deletes ~800 brittle/redundant tests (mostly UI-level duplicates of unit-covered logic). CI drops 30%, trust rises, and the next quarter's escaped-defect count is unchanged — confirming the deleted tests bought no real confidence.

## Mental Models

- **The strategy is a control system, not a document.** Its job is to keep four metrics (escaped defects, CI time, flake rate, ROI) in an acceptable region, with the escaped-defect loop as the controller.
- **Make the right thing the easy thing.** Paved roads beat mandates; tooling embodies strategy better than reviewers enforce it.
- **Every escaped defect is a free lesson.** Classified by lowest-catching level, it either validates or names the gap in the allocation.
- **Tests are investments with running costs.** Optimise confidence-per-minute, not test count; prune the negative-ROI tail.
- **Architecture changes obsolete strategy.** A split or rewrite that doesn't trigger a coverage-migration review will rot into the cone.

## Common Mistakes

- **Write-once strategy.** A wiki triangle nobody revisits; it diverges from reality within a quarter.
- **Governance by bottleneck.** A central QA/E2E team instead of paved roads and thin policy-as-code.
- **Measuring nothing, or one thing.** No escaped-defect loop (can't improve), or a single metric like coverage (Goodhart guarantees gaming).
- **Letting the org E2E suite become a no-owner gatekeeper.** It grows into a flaky 90-minute cone everyone games.
- **Skipping the migration review on re-architecture.** Old slow tests survive into a world they no longer fit.
- **Equating more tests with more safety.** Never pruning means an ever-slower suite with stagnant real confidence.

## Test Yourself

1. Name the four metrics that, read together, tell you if a strategy works, and give one way optimising each *alone* backfires.
2. Describe the escaped-defect feedback loop end to end. What does it mean when a bug escaped *despite* a test at the correct level?
3. A team splits a monolith into services but keeps the old E2E suite. What three coverage moves does the migration review prescribe?
4. Why do paved roads scale governance better than a central QA team?
5. Write the test-ROI formula and use it to explain why redundant tests have negative ROI.

## Cheat Sheet

```text
RUN IT AS A LIVING SYSTEM
  versioned + owned | revised on cadence AND triggers (incident, re-arch, budget breach)
  prescribe defaults, permit justified deviation, cite the metrics it should move

GOVERN WITHOUT BOTTLENECKS
  paved roads (templates, harnesses, dashboards) > mandates
  thin policy-as-code invariants (contracts exist, CI < budget, flake < ceiling)
  federated ownership; guild folds learnings back into the road

MEASURE (read together, never alone)
  escaped defects by lowest-catching level   <- the controller
  suite p95 wall-clock                        <- feedback speed
  flake rate (test + suite)                   <- trust
  test ROI / maintenance                      <- worth its cost

ROI = (P(catch real costly defect) × defect cost) / (author + Σ run + maintain)
  unit: high | E2E: low-per-test (worth it only for critical journeys) | redundant: NEGATIVE

EVOLVE
  every architecture change -> migration review -> move coverage DOWN + to CONTRACTS
```

## Summary

- At org scale, the strategy is a **living, versioned, owned document** revised on a cadence and on triggers — and **connected to outcomes**.
- Govern with **paved roads and thin policy-as-code**, not a central QA bottleneck; make the right thing the easy thing.
- **Measure four metrics together** — escaped defects by level, CI time, flake rate, ROI — and never optimise one alone (Goodhart).
- The **escaped-defect feedback loop** (classify by lowest-catching level) is the controller that makes the strategy self-correcting.
- Frame tests as **investments**: optimise confidence-per-minute, prune the negative-ROI tail, and run a **migration review on every architecture change** to move coverage down and to contracts before the suite rots into the cone.

## Further Reading

- *Software Engineering at Google* — scaling testing, flakiness, and culture.
- *Accelerate* (Forsgren, Humble, Kim) — connecting testing to delivery performance.
- Capers Jones on Defect Detection Percentage (DDP).
- Martin Fowler, "Eradicating Non-Determinism in Tests."
- The `test-driven-development`, `mutation testing`, and `property-based-testing` material.

## Related Topics

- [Quality Gates](../../quality-gates/) — turning strategy invariants into required checks.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — linking test strategy to delivery outcomes.
- [Code Coverage](../../code-coverage/) — diagnostic input, not the strategy.
- [Contract Testing](../05-contract-testing/) — the seam strategy through re-architectures.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) · [Mutation Testing](../07-mutation-testing/) — trust and assertion quality.
- [Interview level](interview.md) — the question bank for this topic.
