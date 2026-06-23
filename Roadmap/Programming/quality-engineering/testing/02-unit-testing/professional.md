# Unit Testing — Professional Level

> **Roadmap:** [Testing](../README.md) → Unit Testing
>
> *Unit testing as an org capability: suite health at scale, guidelines as standards, the unit-vs-higher balance, and the economics of over-specified tests.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Unit Testing as an Org Capability](#core-concept-1--unit-testing-as-an-org-capability)
5. [Core Concept 2 — Keeping a Large Suite Fast](#core-concept-2--keeping-a-large-suite-fast)
6. [Core Concept 3 — Measuring Suite Health](#core-concept-3--measuring-suite-health)
7. [Core Concept 4 — Unit-Test Guidelines as a Standard](#core-concept-4--unit-test-guidelines-as-a-standard)
8. [Core Concept 5 — The Unit-vs-Higher Balance as Policy](#core-concept-5--the-unit-vs-higher-balance-as-policy)
9. [Core Concept 6 — The Economics of Over-Specified Tests](#core-concept-6--the-economics-of-over-specified-tests)
10. [Core Concept 7 — Migrating and Retiring Tests](#core-concept-7--migrating-and-retiring-tests)
11. [Core Concept 8 — Ownership, Review, and the Cost of Drift](#core-concept-8--ownership-review-and-the-cost-of-drift)
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

> Focus: **operating unit testing at organization scale — keeping tens of thousands of tests fast and trusted, codifying guidelines, and treating the test suite as an asset on the balance sheet.**

At this level you stop optimizing your own tests and start governing a suite owned by hundreds of engineers. The questions change shape: not "is this test good?" but "what does our org *require* of a test, how do we keep CI under ten minutes with 80,000 units, how do we know the suite is healthy, and when does an over-specified test become a liability we should pay down?"

A unit suite is a capital asset. Maintained well, it compounds: it lets the org refactor, ship, and onboard fast. Neglected, it becomes a liability that taxes every change and that engineers route around. The professional's job is to keep it on the asset side — through standards, measurement, and deliberate trade-offs against the higher test levels.

---

## Prerequisites

- Fluent in the senior tier: four pillars, smells, functional core, testable design.
- You've owned a CI pipeline and felt the cost of a slow or flaky suite.
- You can read coverage and mutation reports and connect them to suite health.
- Familiarity with [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/), [Mutation Testing](../07-mutation-testing/), and [Flaky Tests](../12-flaky-tests-and-reliability/).

---

## Glossary

| Term | Meaning |
|---|---|
| **Suite health** | Composite of speed, flake rate, mutation score, and maintenance cost. |
| **Flake rate** | Fraction of runs where a passing-worthy test fails non-deterministically. |
| **Test budget** | A target ceiling on suite runtime (e.g. unit suite < 90 s locally). |
| **Test selection** | Running only the tests affected by a change. |
| **Quarantine** | Isolating a flaky test so it can't fail the build while it's being fixed. |
| **Over-specified test** | A test that pins more than the contract requires (extra mocks, exact internals). |
| **Test pyramid ratio** | The proportion of unit : integration : E2E tests. |
| **Bus factor (of tests)** | How concentrated test knowledge is; high concentration is fragile. |
| **Golden path** | The org-sanctioned way to write a test for a given layer. |
| **Test debt** | Accumulated brittle, slow, or low-value tests that should be paid down. |

---

## Core Concept 1 — Unit Testing as an Org Capability

A unit suite at scale is infrastructure. Its value comes not from any one test but from properties of the *whole*:

- **Trust.** Engineers run it and believe the result. The moment red can mean "probably nothing," the suite is dead even if every test still exists.
- **Speed.** It's fast enough to run on every change, so it shapes behavior continuously rather than being a CI gate people wait on.
- **Refactor-ability.** It lets the org change code structure without fear — the senior-level resistance pillar, now an org property.

These properties are *emergent and fragile*. One persistently flaky test that nobody owns lowers trust across the whole suite. A handful of 5-second "units" blow the budget for everyone. A pile of brittle mockist tests makes a shared library un-refactorable. The professional manages the suite as a commons: the tragedy is that local convenience (a quick mock, an ignored flake) imposes a global cost.

The governing principle: **a test must earn its place.** Each test costs runtime on every run and maintenance on every related change, forever. A test that protects little (low mutation contribution) and resists nothing (brittle) is a net liability — and *deleting* it improves the suite. Senior orgs are as willing to remove tests as to add them.

---

## Core Concept 2 — Keeping a Large Suite Fast

The unit suite's defining feature is speed; at scale, speed is an active engineering discipline, not a given.

**Set and enforce a budget.** Pick a ceiling — e.g. the full unit suite runs in under 2 minutes on CI, the per-package suite in under 5 seconds locally — and fail the build (or alert) when it's breached. Without a budget, runtime creeps until the suite is unusable.

**Hunt slow "units."** A unit test over ~50 ms is almost always hiding I/O — a real DB driver, an actual HTTP client, a `sleep`, an unmocked clock that does real work. Profile and surface the slowest tests:

```bash
# Go: the slowest tests in the run
go test ./... -json | jq -r 'select(.Action=="pass" and .Elapsed!=null)
  | "\(.Elapsed)\t\(.Test)"' | sort -rn | head -20

# pytest: show the 20 slowest
pytest --durations=20

# Jest/Vitest: per-test timing in CI output, then attack the tail
```

**Parallelize correctly.** `go test` parallelizes by package automatically; mark independent tests `t.Parallel()`. JUnit 5 has `junit.jupiter.execution.parallel.enabled`. pytest has `pytest-xdist` (`-n auto`). Parallelism only works if tests are **independent** — shared mutable state forces serialization and reintroduces flakiness. Independence (a senior discipline) becomes a *performance* lever at scale.

**Test selection / impact analysis.** With a large monorepo, don't run all 80,000 units on every change. Tools like Bazel, Nx, Go's build cache, or test-impact analysis run only tests affected by the diff — turning a 20-minute full run into a 30-second targeted one. Run the full suite on merge to main.

**Cache aggressively.** Go caches passing test results by input hash; Bazel and Nx cache across machines. A test that hasn't changed and whose inputs haven't changed should not re-run.

---

## Core Concept 3 — Measuring Suite Health

"We have lots of tests" is not health. Track four signals and review them like any other reliability metric:

| Signal | What it tells you | Target / action |
|---|---|---|
| **Wall-clock runtime** | Whether the suite stays runnable | Hold a budget; alert on regressions |
| **Flake rate** | How much you can trust red | Drive toward ~0; quarantine + fix offenders |
| **Mutation score** | Whether tests would catch real bugs | Track per-module; gate critical modules |
| **Maintenance cost** | Churn the suite imposes | Watch test-vs-prod line churn ratio in refactors |

**Coverage is a weak health signal** and a dangerous *target* (Goodhart's law — see the DORA/metrics material). High coverage with low mutation score means tests run lines without checking behavior. Use coverage as a *floor and a gap-finder* (what's totally untested), never as the headline number. The honest protection metric is **mutation score** — [Mutation Testing](../07-mutation-testing/) — and serious orgs gate it on high-risk modules even when they let coverage be advisory elsewhere.

**Flake is the trust metric.** A flaky test is not a minor annoyance; it's a leak in the suite's entire credibility. The professional response is mechanical: detect flakes (re-run failures, track per-test failure history), **quarantine** them out of the gating path immediately, assign an owner, and fix or delete within a deadline — never let a flake sit in the build untracked. The full playbook is in [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/).

---

## Core Concept 4 — Unit-Test Guidelines as a Standard

At scale, "write good tests" must become a written, enforceable standard, or every team reinvents (and re-debates) the basics. A strong org unit-test guideline is short and opinionated:

> **Org unit-test standard (illustrative):**
> 1. Default to the **classical** school: real in-process collaborators, fakes for I/O.
> 2. **Mock only unmanaged, out-of-process dependencies** you don't own.
> 3. **Assert on observable behavior** (output / resulting state), never on private members or internal call sequences.
> 4. Structure every test **AAA**; name `Method_Scenario_Result`; one reason to fail.
> 5. **No I/O, network, disk, real clock, or sleep** in a unit test. Inject the clock and RNG.
> 6. Use **parameterized/table** tests for data-varying cases.
> 7. A unit test runs in **< 50 ms**. Over that → it's not a unit; move it up the pyramid.
> 8. **Mutation score ≥ X%** on listed critical modules; coverage is advisory elsewhere.
> 9. **Zero tolerance for flaky tests** in the gating path: quarantine on detection, fix or delete within N days.
> 10. A brittle or low-value test is **deleted**, not preserved.

Make the standard **enforceable, not aspirational**: a linter/CI check for the mechanical rules (test naming, banned imports of real DB/HTTP clients in unit packages, runtime budget), a mutation gate for the protection rule, code-review checklists for the judgment calls. The `unit-testing-patterns` and `mocking-strategies` skills are good source material to base such a standard on, so reviewers cite a shared reference instead of personal preference.

Crucially, **dedupe guidance with the test-design skills rather than restating it** — point engineers at `test-driven-development` for workflow, `mocking-strategies` for the double decision, and keep the org doc to the *decisions your org has made* among the options.

---

## Core Concept 5 — The Unit-vs-Higher Balance as Policy

The pyramid (covered in [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/)) is a strategy; at this level it's a *policy* you tune per system. Unit tests are fast and resist refactoring but, by isolating, they **don't catch wiring and integration bugs** — the defects that live between units. The classic failure mode is a green unit suite shipping a broken system because every collaborator was mocked.

The professional decides, per service, how much confidence to buy at each layer:

- A **pure-logic library** (a parser, a pricing engine, a state machine) is almost all units — the behavior *is* the logic, and there's little wiring. Push toward a tall, narrow pyramid.
- A **glue/orchestration service** (mostly calling other services, little logic of its own) gets *fewer* units and proportionally more integration/contract tests — because the risk is in the wiring, not the logic. Over-unit-testing glue code yields brittle mockist tests that protect nothing.
- A **user-facing flow** needs a thin layer of E2E for the critical paths on top, accepting their cost and slowness for the system-level confidence only they provide.

The anti-pattern to police is the **ice-cream cone** (mostly E2E, few units): slow, flaky, expensive, and it fails to localize. But blind "everything is a unit" is its own failure when applied to glue code. The right ratio is a function of *where the risk lives* — logic vs wiring — and that's an architectural judgment, not a fixed number. Use [Integration](../03-integration-testing/) and [Contract](../05-contract-testing/) testing to cover the seams units leave open.

---

## Core Concept 6 — The Economics of Over-Specified Tests

An over-specified test pins more than the contract requires — exact mock call sequences, internal field values, the precise shape of a private helper. Senior-level, it's a resistance problem; professional-level, it's an **economic** one with a measurable bill, and the bill comes due hardest during change.

Consider a platform migration — say, moving 200 services from one HTTP framework to another, or restructuring a shared domain model. The cost of the migration is dominated not by the production change but by the **test churn it forces**:

- A **behavior-based** suite: the public contracts are unchanged, so most tests stay green. The migration touches production code and a thin shell of integration tests. Cheap.
- An **over-specified** suite: thousands of tests assert on internal call shapes that the migration legitimately changes. Every one turns red for no behavioral reason. The team spends weeks "fixing" tests — and worse, *can't tell* which red is a real regression hiding in the noise. The migration's risk and cost multiply.

The professional treats over-specification as **test debt with interest**: it's tolerable in stable code but ruinous in code you expect to evolve. So during any large migration:

1. **Audit for over-specified tests first** in the blast radius (heavy mock usage, `verifyNoMoreInteractions`, reflection on privates).
2. **Refactor them to behavior** *before* the migration, where feasible — pay down the debt while the code still works, so the migration sees a resilient suite.
3. **Resist re-specifying** during the migration; a behavior-preserving rewrite should not need new internal assertions.

The lesson generalizes: the cost of a test is not when you write it — it's every time the code it pins must change. Over-specified tests are cheap to write and expensive forever.

---

## Core Concept 7 — Migrating and Retiring Tests

Suites need lifecycle management, not just growth.

**Retiring tests.** A test that contributes nothing to mutation score *and* is brittle should be deleted — keeping it costs runtime and maintenance for zero protection. Identify candidates via mutation reports (tests that catch nothing surviving mutants don't) and churn analysis (tests that break on every unrelated change). Deleting low-value tests is a legitimate, healthy activity; a smaller, sharper suite beats a large, noisy one.

**Migrating frameworks.** When moving JUnit 4 → 5, or Jasmine → Jest, or adding `t.Parallel()` across a codebase, do it mechanically and in behavior-preserving steps, with the *old and new runners green simultaneously* during the transition. Never mix a framework migration with a behavior change — you lose the ability to tell which one broke something.

**Onboarding the standard onto legacy code.** You can't retrofit the org standard to a million lines overnight. Apply the **boy-scout rule**: new tests meet the standard; touched tests get brought up to it; legacy stays until it's in the blast radius of other work. Pair with seams and characterization tests (Feathers) to get legacy under test at all before improving it.

---

## Core Concept 8 — Ownership, Review, and the Cost of Drift

A suite owned by everyone is owned by no one. Two failure modes appear at organization scale, and both are governance problems, not coding problems.

**Test knowledge concentration (bus factor).** When one engineer authored the test infrastructure — the custom fixtures, the in-memory fakes, the assertion helpers — and only they understand it, the suite becomes fragile to their absence. Treat test infrastructure as production code: it gets reviewed, documented, and shared ownership. A shared library of well-named fakes (an `InMemoryRepo`, a `FakeClock`, a `RecordingMailer`) pays off across hundreds of test files and prevents every team from hand-rolling a slightly different, slightly broken double.

**Standard drift.** Without enforcement, the org standard erodes the moment attention moves elsewhere — new hires copy the nearest example regardless of quality, and the nearest example is often a brittle one. Counter drift with three layers:

1. **Mechanical enforcement** in CI: a linter rule banning real DB/HTTP client imports in unit-test packages, a naming check, a per-test runtime budget, a mutation gate on listed modules. These need no human and never get tired.
2. **Review-time judgment** for the calls a linter can't make: "is this mock hiding a wiring bug?", "does this assertion pin behavior or implementation?" A short review checklist that cites the standard keeps the debate from re-litigating first principles on every PR.
3. **Golden-path examples** kept current in the repo — a canonical, exemplary test per layer that new code can copy. The fastest way to raise the floor is to make the right way the easiest-to-copy way.

The economic case is the same one running through this whole tier: drift is invisible until a migration or an incident makes the bill visible all at once. Governing the suite continuously is cheaper than paying down a decade of accumulated test debt in a crisis.

```text
ENFORCEMENT LADDER
  mechanical (CI)  → naming · banned imports · runtime budget · mutation gate
  review (human)   → "behavior not impl?" · "mock justified?" · checklist cites standard
  golden path      → one exemplary test per layer, kept current, easy to copy
```

---

## Real-World Examples

**1. The 28-minute suite.** A growing service's unit suite crept to 28 minutes — engineers stopped running it locally and trust eroded. An audit found 6% of "unit" tests were doing real Redis and HTTP calls (5–800 ms each). Mocking the I/O and enforcing a 50 ms per-test budget in CI cut the suite to 90 seconds; local-run rates and trust recovered.

**2. The migration that stalled.** A company moving off a legacy ORM hit a wall: 9,000 tests asserted on exact ORM call sequences via mocks. The behavior-preserving swap turned 4,000 of them red. The migration slipped a quarter. The retro's conclusion fed a new standard (Concept 4) and a rule to audit-and-detox over-specified tests before any platform migration.

**3. Coverage gate that protected nothing.** A team had a 90% coverage gate and felt safe — until a production incident from a logic bug in fully-"covered" code. A mutation run revealed 38% mutation score: tests executed the code but asserted almost nothing. They demoted coverage to advisory and added a mutation gate on the payment and auth modules, catching real assertion gaps the coverage number had hidden.

---

## Mental Models

- **The suite is a commons.** Local convenience (a quick mock, an ignored flake) imposes a global cost on everyone's trust and speed. Govern it as shared infrastructure.
- **Tests are inventory with a carrying cost.** Each one costs runtime forever and maintenance on every related change. Some inventory is dead stock — delete it.
- **A test's true cost is realized on change, not on write.** Over-specified tests are cheap to author and ruinous to migrate past.
- **Trust is binary and fragile.** A suite is trusted or it isn't; a small flake rate flips the whole thing to "ignore the red."
- **Risk drives the ratio.** Put tests where the risk lives — logic → units, wiring → integration/contract, critical flows → a thin E2E layer.

---

## Common Mistakes

| Mistake | Why it hurts | Fix |
|---|---|---|
| No runtime budget | Suite slows until people stop running it | Enforce a per-test and total budget in CI |
| Coverage % as the headline health metric | Goodharted; hides low protection | Use mutation score; coverage as floor/gap-finder |
| Tolerating any flake in the gating path | Erodes trust in the whole suite | Quarantine on detection; fix or delete with a deadline |
| Unit-testing glue code to death | Brittle mockist tests that protect nothing | Move wiring confidence to integration/contract |
| Never deleting tests | Dead inventory taxes every run and change | Retire brittle, zero-protection tests |
| Re-specifying tests during a migration | Multiplies migration cost and risk | Detox over-specified tests first; preserve behavior |
| Guideline that restates skills/docs | Bloat, drift, ignored | Keep org doc to *decisions*; cite shared skills |

---

## Test Yourself

1. Why is trust in a suite "binary," and how does one flaky test threaten it?
2. Give three concrete techniques for keeping an 80,000-test suite under a runtime budget.
3. Why is coverage a poor *target* and what should gate critical modules instead?
4. Write three rules you'd put in an org unit-test standard, and say which you'd enforce by linter vs review.
5. For a thin orchestration service, how does the test ratio differ from a pure-logic library, and why?
6. Explain why an over-specified test is cheap to write but expensive over its lifetime, using a migration scenario.
7. On what grounds is *deleting* a passing test the right call?

---

## Cheat Sheet

```text
SUITE AS ASSET
  every test = runtime forever + maintenance on every related change
  a test must EARN its place; delete brittle + zero-protection tests

SPEED AT SCALE
  budget (per-test < 50ms, suite < N min) · profile slow units (hidden I/O)
  parallelize (needs independence) · test selection / impact · cache results

HEALTH = runtime + flake-rate + mutation-score + maintenance-cost
  coverage → floor / gap-finder, NOT the headline (Goodhart)
  mutation score → honest protection signal; gate critical modules
  flake → quarantine on detect, owner + deadline, never ignore

ORG STANDARD (decisions, enforced)
  classical default · mock only unmanaged out-of-proc · assert behavior
  AAA + naming + 1 reason to fail · no I/O/clock · < 50ms · mutation gate
  zero flake tolerance · delete low-value tests
  cite skills (unit-testing-patterns / mocking-strategies / TDD), don't restate

RATIO BY RISK
  pure logic → mostly units · glue → integration/contract · flows → thin E2E
  avoid ice-cream cone AND "everything is a unit" for glue
```

---

## Summary

At the professional level, a unit suite is **shared infrastructure and a capital asset** whose value is emergent and fragile: trust, speed, and refactor-ability belong to the *whole*, and one untracked flake or pile of brittle tests degrades them for everyone. You keep it on the asset side by **enforcing a runtime budget** (profiling slow units, parallelizing independent tests, using test selection and caching), by **measuring real health** (runtime, flake rate, and above all **mutation score** rather than Goodharted coverage), and by **codifying an enforceable org standard** that records your decisions and cites the test-design skills rather than restating them. You tune the **unit-vs-higher ratio by where the risk lives** — logic favors units, wiring favors integration and contract tests — and you treat **over-specification as test debt** that comes due hardest during migrations, detoxing it before large changes. Finally, you manage the suite's lifecycle: **deleting brittle, zero-protection tests is as healthy as adding good ones.** A smaller, faster, trusted suite beats a large, slow, noisy one every time.

---

## Further Reading

- Vladimir Khorikov, *Unit Testing: Principles, Practices, and Patterns* — Part on suite-level value.
- Titus Winters et al., *Software Engineering at Google* — testing at scale, flakiness, test selection.
- Michael Feathers, *Working Effectively with Legacy Code* — bringing legacy under test.
- Google Testing Blog — flaky tests, test sizes, and the suite-as-infrastructure view.
- The `unit-testing-patterns`, `mocking-strategies`, and `test-driven-development` skills.

---

## Related Topics

- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — the ratio policy this tier tunes per system.
- [Mutation Testing](../07-mutation-testing/) — the protection metric that gates critical modules.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — the quarantine-and-fix playbook for the trust metric.
- [Integration Testing](../03-integration-testing/) and [Contract Testing](../05-contract-testing/) — covering the seams units leave open.
- [Code Coverage](../../code-coverage/) — using coverage as a floor, not a target.
- **Next:** [Unit Testing — Interview Level](interview.md).
