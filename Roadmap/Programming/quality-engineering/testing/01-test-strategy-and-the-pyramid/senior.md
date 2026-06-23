# Test Strategy & the Pyramid — Senior Level

> **Roadmap:** [Testing](../README.md) → Test Strategy & the Pyramid
> *Designing a risk-based test strategy for a real system under a real CI budget — not drawing a triangle.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- Strategy as risk allocation, not shape worship](#core-concept-1----strategy-as-risk-allocation-not-shape-worship)
5. [Core Concept 2 -- Building the risk map](#core-concept-2----building-the-risk-map)
6. [Core Concept 3 -- The CI time budget is a hard constraint](#core-concept-3----the-ci-time-budget-is-a-hard-constraint)
7. [Core Concept 4 -- Designing the layer allocation from the budget](#core-concept-4----designing-the-layer-allocation-from-the-budget)
8. [Core Concept 5 -- Eliminating redundant coverage](#core-concept-5----eliminating-redundant-coverage)
9. [Core Concept 6 -- Contracts and the seam strategy](#core-concept-6----contracts-and-the-seam-strategy)
10. [Core Concept 7 -- Coverage is an input, risk is the driver](#core-concept-7----coverage-is-an-input-risk-is-the-driver)
11. [Core Concept 8 -- Flakiness as a first-class budget line](#core-concept-8----flakiness-as-a-first-class-budget-line)
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

> Focus: **turning "we should test more" into a defensible plan: which risks, at which level, within a fixed CI budget, with a way to know if it's working.**

A senior engineer does not pick a shape and draw it. They start from *risk* — where defects are most likely and most expensive — and *constraints* — how long CI may take, how much flakiness the team tolerates — and derive the allocation. The pyramid (or trophy, or honeycomb) falls out as a *consequence*. This page is about doing that derivation, then measuring whether it paid off.

## Prerequisites

**Required**

- Middle level: the four shapes, sizes vs types, the allocation heuristic.
- You have owned a non-trivial service or app and felt CI slowness and flaky tests.

**Helpful**

- Familiarity with your CI's parallelism and per-stage timing.
- Some incident/postmortem experience — knowing where bugs actually escaped to production.

## Glossary

| Term | Plain-English meaning |
|---|---|
| Risk-based testing | Allocating test effort by likelihood × cost of failure, not by code structure. |
| Escaped defect | A bug that reached production despite the test suite. |
| CI time budget | The maximum acceptable wall-clock time for the test stage(s) before merge. |
| Test ROI | Confidence gained per unit of suite time + maintenance cost. |
| Redundant coverage | The same behaviour verified at multiple levels — pure cost, no extra confidence. |
| Flake rate | Fraction of test runs that fail for reasons unrelated to the code change. |
| Defect-detection level | Which test level *first* would have caught a given escaped bug. |
| Test diamond | Integration-heavy shape (thin unit + thin E2E, fat integration). |

## Core Concept 1 -- Strategy as risk allocation, not shape worship

Testing is a *budget allocation problem*. You have finite engineer-hours to write tests and finite CI-minutes to run them. The goal is to **maximise confidence per unit cost**, where confidence means "we will catch the defects that matter before they ship."

Two systems with identical architectures can warrant different strategies because their *risk profiles* differ. A reporting dashboard and a payment ledger may both be "a service + a DB," but a wrong number means a stale chart in one case and a financial loss in the other. Strategy starts by asking, for *this* system:

- **Where will defects occur?** (Complex logic, churny code, weak boundaries, integration points, concurrency.)
- **Where will defects hurt?** (Money, safety, data integrity, legal/compliance, reputation, irreversibility.)
- **What can we afford to run, every commit?** (The CI budget.)

The shape is the *answer*, not the question.

## Core Concept 2 -- Building the risk map

Make the risk explicit. A lightweight table per major area beats intuition:

```text
Area            Likelihood  Impact   Where bugs live        -> Test emphasis
-----------------------------------------------------------------------------
Pricing engine    High       High    deep branching logic    unit (exhaustive) + property-based
Payment gateway   Med        Crit    external API, retries   integration + contract + a few E2E
Auth / sessions   Med        Crit    token expiry, edge time small (faked clock) + integration
Report rendering  High       Low     CSS/layout              minimal automated; manual/visual spot
Admin CRUD        Low        Low     framework boilerplate    thin integration only
Search ranking    High       Med     scoring math            unit + property-based; snapshot for output
```

Likelihood and impact are coarse (High/Med/Low) on purpose — precision here is false. The output is *emphasis*: where to spend exhaustive coverage, where a thin smoke test suffices, where automation isn't worth it at all. Note two non-obvious moves: high-likelihood/low-impact areas (report layout) get *less* automation than instinct suggests, and low-likelihood/critical areas (payments) still get heavy coverage because the impact dominates.

Property-based testing earns a place wherever logic is rich (pricing, search ranking, parsers) — it covers input space that example tests miss. (See [Property-Based Testing](../06-property-based-testing/).)

## Core Concept 3 -- The CI time budget is a hard constraint

A strategy that ignores wall-clock time is a fantasy. Define the budget first, then design within it.

**A worked budget.** Say the team's rule is: *pre-merge checks must finish in under 10 minutes* (the threshold above which engineers context-switch and PRs stall). Assume 8-way CI parallelism.

```text
Budget: 10 min wall-clock, 8 parallel shards  =>  ~80 min total test-CPU

Allocate the 80 min of test-CPU:
  Unit (small)        : 5,000 tests × 5 ms     =  25 s   -> trivial, run all every shard
  Integration (medium): 600 tests   × 400 ms   = 240 s   = 4.0 min CPU
  Contract            : 80 tests     × 300 ms   =  24 s
  E2E (large)         : 25 tests     × 12 s     = 300 s   = 5.0 min CPU
                                                  --------
                                       total CPU = ~9.8 min  /8 shards = ~1.2 min wall
```

The arithmetic reveals the real cost driver instantly: **25 E2E tests cost more CPU than 5,000 unit tests.** That is the pyramid argument made quantitative — and it tells you exactly how many E2E tests you can afford. If product wants 200 E2E tests, the math says the budget breaks (200 × 12 s = 40 min CPU = 5 min wall on its own, *before* everything else), so either the budget grows, parallelism grows, or the E2E count is wrong. The budget converts vague "too many E2E" arguments into numbers.

## Core Concept 4 -- Designing the layer allocation from the budget

Given the risk map and the budget, derive counts top-down — because the **top is the scarce resource**:

1. **Decide the E2E set first.** It is the most constrained (slowest, flakiest). List the *critical journeys* — the flows whose breakage is unacceptable. For most systems that is 5–30 flows, not 200. Each becomes one E2E test of the happy path; its edge cases go *down*.
2. **Decide contract coverage at every cross-service seam.** One consumer-driven contract per (consumer, provider) pair you depend on.
3. **Cover wiring and I/O with integration tests** — one or a few per repository/adapter/handler, proving the real round-trip works.
4. **Push everything else down to small tests** — exhaustively, because they're nearly free.

This is why the suite *ends up* pyramid-shaped for logic-heavy systems and *diamond*-shaped (fat integration) for thin services: the shape is the residue of "E2E is scarce, so spend it last and least."

```text
DERIVED SHAPE for a logic-rich payments service (within the 10-min budget):

   E2E         25      |#                       critical journeys only
   Contract    80      |###
   Integration 600     |##########              every seam + adapter
   Unit       5000     |######################  all logic, exhaustively
```

## Core Concept 5 -- Eliminating redundant coverage

Redundant coverage is the most common silent cost in a mature suite: the same behaviour asserted at unit *and* integration *and* E2E. It triples runtime and maintenance while adding zero confidence (a bug in that behaviour was already catchable lower down).

The senior discipline: for each behaviour, ask **"what is the *lowest* level that can fail if this breaks?"** and cover it *there only*. Higher levels assert *different* things:

```text
Behaviour: "orders over $100 get free shipping"
  unit         : the rule itself, all boundaries ($99.99, $100.00, $100.01)   <- cover HERE
  integration  : the order, once saved and reloaded, still computes shipping   <- WIRING, not the rule
  E2E          : a user checking out a $120 cart sees "Free shipping"          <- JOURNEY, not the rule

Anti-pattern: re-testing $99.99/$100.00/$100.01 at all three levels.
```

A periodic audit — "which E2E tests assert logic already covered by unit tests?" — typically lets you delete a third of a legacy E2E suite with no loss of confidence and a large CI speedup.

## Core Concept 6 -- Contracts and the seam strategy

For distributed systems, the strategic move is to **replace cross-service E2E with contract tests.** Booting N services to verify A talks to B is slow, flaky, and scales combinatorially. Contract testing splits that verification:

- The **consumer** records its expectations of the provider (the requests it sends, the responses it needs) as a contract.
- The **provider** is tested *in isolation* against that contract (provider verification).

Each side runs as a fast small/medium test; together they guarantee the seam holds without ever booting both. This is what lets the honeycomb/diamond keep its "integrated" top thin. Reserve true multi-service E2E for a *handful* of smoke tests that prove the environment assembles at all. (Full treatment in [Contract Testing](../05-contract-testing/).)

## Core Concept 7 -- Coverage is an input, risk is the driver

Line/branch coverage is a *diagnostic*, not a *target*. Two failure modes of coverage-driven testing:

1. **Goodhart's law.** When coverage becomes the goal, engineers write assertion-free tests that execute lines without checking behaviour — 90% coverage, near-zero confidence. (See [Mutation Testing](../07-mutation-testing/) for measuring whether tests actually assert anything.)
2. **Uniform coverage misallocates risk.** "80% everywhere" spends as much effort on trivial getters as on the pricing engine. Risk-based testing deliberately over-covers the dangerous parts and under-covers the trivial ones — which may *lower* a global coverage number while *raising* real safety.

Use coverage to find *gaps* in code you've decided is risky ("the pricing engine is only 60% covered — that's a problem"), never as the strategy itself. Coverage lives in its own QE section precisely because it is a measurement, not a kind of test — see [Code Coverage](../../code-coverage/).

## Core Concept 8 -- Flakiness as a first-class budget line

A flaky test is worse than no test: it trains engineers to ignore red, and re-runs burn the CI budget you carefully designed. Flakiness scales with test *size* — the more real network/disk/clock/concurrency a test touches, the more ways it fails for non-reasons. So the strategy must **account for flakiness when allocating up the pyramid:**

```text
Effective cost of an E2E test = run_time × (1 + expected_reruns)
  A 12 s E2E with a 5% flake rate, retried twice on failure,
  costs on average ~12 s + 0.05 × 2 × 12 s ≈ 13.2 s  -- and worse, erodes trust.
```

Budget a **flake rate ceiling** (e.g. < 1% per test, < 0.1% suite-level) and quarantine offenders rather than blanket-retrying. Track it. A rising flake rate is the leading indicator that the suite is drifting up the pyramid into the cone. (See [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/).)

## Real-World Examples

**Redesigning a 28-minute suite.** A team's CI runs 28 minutes and flakes ~8%. Audit finds 220 Selenium tests, ~70% of which re-assert validation/business rules already (or easily) covered lower down. Plan: keep 18 journey E2E tests, move logic to ~900 new unit tests, add 40 contract tests for the three downstream services, quarantine the 12 flakiest E2E tests on day one. Outcome: 7-minute CI, < 1% flake, *more* escaped-defect coverage than before.

**A thin notifications microservice.** Almost no logic — receive event, template a message, call a provider. Risk map says bugs live at the provider seam and in templating. Strategy: minimal unit tests (template rendering), a fat integration layer (event → provider with the provider faked), one contract with the upstream event producer, zero E2E (covered by the platform's smoke suite).

**Adding a risky pricing rewrite.** New tax engine, high likelihood × high impact. Strategy bumps this *one area*: exhaustive unit tests plus property-based tests asserting invariants ("tax is never negative," "subtotal + tax = total"), even though the rest of the service stays thinly tested. Risk-based, not uniform.

## Mental Models

- **Allocate from the top down because the top is scarce.** Decide E2E first (you can afford few), then contracts, then integration, then pour the rest into cheap unit tests.
- **The budget is the forcing function.** "Too many E2E" becomes provable arithmetic once you write the CI time budget down.
- **Cover each behaviour at its lowest failing level — once.** Higher levels assert *different* concerns (wiring, journeys), never the same rule again.
- **Coverage is a flashlight, not a finish line.** It finds gaps in risky code; it is not the goal.
- **Flakiness is debt with interest.** It compounds by destroying trust and burning re-runs; price it into the allocation.

## Common Mistakes

- **Drawing the shape first, fitting reality second.** The shape must be derived from risk + budget, not imposed.
- **Uniform coverage targets.** "80% everywhere" guarantees you over-test the trivial and under-test the dangerous.
- **Ignoring CI wall-clock.** A correct-on-paper strategy that makes CI take 40 minutes will be abandoned in practice.
- **Booting the world for seam tests.** Multi-service E2E where contract tests would do — slow, flaky, combinatorial.
- **Blanket-retrying flakes.** Hides rot and burns budget; quarantine and fix instead.
- **Never auditing redundancy.** Mature suites accrete duplicate coverage; without periodic pruning the suite gets slower with no added safety.

## Test Yourself

1. Your CI budget is 8 min at 6-way parallelism. How much test-CPU is that, and how many 10 s E2E tests can you afford if everything else uses half the budget?
2. Pricing logic is 95% line-covered but bugs keep escaping. What two diagnostics would you reach for, and why is the coverage number not reassuring?
3. A behaviour is currently tested at unit, integration, and E2E. Which two should you usually delete, and what should the survivor at each remaining level assert?
4. Why does flakiness rise as you allocate more tests to the top of the pyramid?
5. Sketch a one-line risk-map entry (likelihood/impact/where-bugs-live → emphasis) for a payment-refund feature.

## Cheat Sheet

```text
DESIGN ORDER (top-down, because the top is scarce)
  1. risk map: likelihood × impact × where-bugs-live -> emphasis
  2. CI budget: wall-clock cap × parallelism = test-CPU minutes
  3. E2E set    : critical journeys only (5-30), happy path each
  4. contracts  : one per (consumer, provider) seam
  5. integration: one+ per adapter/handler (wiring & I/O)
  6. unit       : everything else, exhaustively (+ property-based on rich logic)

GUARDRAILS
  cover each behaviour at lowest failing level, ONCE
  coverage = gap-finder, not target (beware Goodhart)
  flake ceiling (<1% test, <0.1% suite); quarantine, don't blanket-retry
  audit redundancy periodically -> delete duplicate E2E

COST FORMULA
  E2E effective cost = run_time × (1 + expected_reruns)
```

## Summary

- A senior test strategy is **risk allocation under a CI budget**, not a shape you pick. The shape is the residue.
- Build a **risk map** (likelihood × impact × where bugs live) and design top-down: E2E first (scarce), then contracts, integration, and a wide cheap unit base.
- Make the **CI time budget** explicit; the arithmetic settles "how many E2E" debates objectively.
- Eliminate **redundant coverage** — each behaviour at its lowest failing level, once; higher levels assert wiring and journeys, not the same rule.
- Treat **coverage as a diagnostic** and **flakiness as a priced budget line**; both are leading indicators of strategy health.

## Further Reading

- *Software Engineering at Google* — testing chapters (sizes, flakiness, scale).
- Ham Vocke, "The Practical Test Pyramid" (martinfowler.com).
- James Bach, "Risk-Based Testing."
- The `test-driven-development` and `property-based-testing` skills.

## Related Topics

- [Contract Testing](../05-contract-testing/) — the seam strategy for distributed systems.
- [Property-Based Testing](../06-property-based-testing/) · [Mutation Testing](../07-mutation-testing/) — depth and assertion-quality for risky logic.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — the flakiness budget line.
- [Code Coverage](../../code-coverage/) — diagnostic, not target.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — connecting test strategy to delivery outcomes.
- [Professional level](professional.md) — governing the strategy across many teams and measuring it.
