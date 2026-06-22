# Integration Testing — Professional Level

> **Roadmap:** [Testing](../README.md) → Integration Testing
>
> *At org scale, integration testing stops being a coding skill and becomes infrastructure economics — who owns it, what it costs, and how it runs in CI.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Integration Testing in CI](#core-concept-1--integration-testing-in-ci)
5. [Core Concept 2 — Container Caching & CI Resource Limits](#core-concept-2--container-caching--ci-resource-limits)
6. [Core Concept 3 — The Cost Model of an Integration Suite](#core-concept-3--the-cost-model-of-an-integration-suite)
7. [Core Concept 4 — Test-Environment Management](#core-concept-4--test-environment-management)
8. [Core Concept 5 — Owning Shared Test Infrastructure](#core-concept-5--owning-shared-test-infrastructure)
9. [Core Concept 6 — Suite Health as a Tracked Metric](#core-concept-6--suite-health-as-a-tracked-metric)
10. [Core Concept 7 — Organisational Patterns & the Test Strategy Doc](#core-concept-7--organisational-patterns--the-test-strategy-doc)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **running integration tests reliably and economically across an organisation — CI execution, container caching, the cost model, environment management, and the ownership of shared test infrastructure.**

The senior file made one suite fast and trustworthy. The professional file makes *every team's* suites work inside finite CI budgets, with clear ownership, predictable cost, and a strategy that scales past a single repo. The questions here are organisational and economic: How do integration tests run in CI without melting the runners? Who owns the shared Testcontainers base image and the test-data factories? What does the suite *cost*, and is it worth it? These are platform and engineering-leadership decisions.

---

## Prerequisites

- You can build a fast, reliable, parallel integration suite ([senior](senior.md)).
- You understand CI/CD pipeline design (stages, caching, runners). See the `ci-cd-pipeline-design` skill.
- You've operated containers in CI and hit resource limits.
- You think in terms of cost, ownership, and SLAs, not just code.

---

## Glossary

| Term | Meaning |
|---|---|
| **DinD / DooD** | Docker-in-Docker / Docker-outside-of-Docker — how CI runs containers. |
| **Runner** | A CI machine that executes a job; has CPU/memory limits. |
| **Image cache** | A stored copy of a Docker image to avoid re-pulling on every run. |
| **Ryuk** | Testcontainers' resource-reaper sidecar that cleans up orphaned containers. |
| **Flake rate** | Fraction of runs that fail on unchanged code. |
| **Suite SLA** | A committed bound on suite runtime / reliability (e.g. p95 < 8 min, flake < 0.5%). |
| **Test platform team** | The team that owns shared test infrastructure as a product. |
| **Cost per green** | Compute spend to produce one passing run. |

---

## Core Concept 1 — Integration Testing in CI

Integration tests need Docker on the CI runner, which is the first place they break. The mechanics matter:

- **Docker availability.** The runner must expose a Docker daemon. GitHub Actions Linux runners ship one; many self-hosted/Kubernetes runners need **DooD** (mount the host socket) or a sidecar daemon. Testcontainers also needs its **Ryuk** reaper to run, or you leak orphaned containers across jobs.
- **Stage placement.** Integration tests belong in their own pipeline stage, *after* fast unit tests. Fail cheap and early: lint → unit (seconds) → integration (minutes) → e2e (longer). Don't make every PR wait on the slow stage to learn a typo broke the build.

```yaml
# GitHub Actions — integration as its own gated stage
jobs:
  unit:
    runs-on: ubuntu-latest
    steps: [ {run: ./gradlew test} ]          # fast; fails first
  integration:
    needs: unit                                # only after unit is green
    runs-on: ubuntu-latest                     # Docker preinstalled
    steps:
      - uses: actions/checkout@v4
      - run: ./gradlew integrationTest         # Testcontainers spins real Postgres/Kafka
```

- **Reproducibility over reuse.** The senior trick of container reuse is a *local-dev* feature. In CI, every job gets fresh, pinned containers so a green run means the same thing every time. Pin image digests, not floating tags.
- **Required-checks gating.** Make the integration stage a required check on the protected branch so nothing merges without it — but only once the flake rate is low enough that the gate is trusted (a flaky required check is worse than none). See the `ci-cd-pipeline-design` skill and the broader quality-gates discipline.

---

## Core Concept 2 — Container Caching & CI Resource Limits

Two forces fight on every CI run: **image pull time** and **runner resources.**

**Image caching.** Pulling `postgres:16.4-alpine` + `confluentinc/cp-kafka` on a cold runner can cost 30–90 seconds per job. Options:

- **Registry mirror / pull-through cache** in your network so pulls are LAN-speed, not internet-speed.
- **Pre-baked runner images** that already contain the test dependency images.
- **Layer caching** for your *own* test images (a base image with extensions/seed data pre-installed).
- **Minimal images** (`-alpine`, slim) to shrink the bytes pulled.

**Resource limits.** A CI runner has finite CPU/RAM. Each container (Postgres, Kafka, Redis, localstack) consumes a slice, and parallel workers multiply it. Symptoms of overcommit: OOM-killed containers, timeouts, and *intermittent* failures that look like flakes but are really resource starvation.

- **Budget the job.** Sum container memory × parallelism and keep it under the runner's RAM with headroom. Kafka especially is memory-hungry.
- **Right-size parallelism to the runner**, not to your laptop. 8 workers on a 2-CPU runner thrash.
- **Cap container resources** explicitly so one heavy test can't starve the rest:

```java
new PostgreSQLContainer<>("postgres:16.4-alpine")
    .withCreateContainerCmdModifier(cmd ->
        cmd.getHostConfig().withMemory(512L * 1024 * 1024)); // 512 MB cap
```

- **localstack/heavy AWS fakes** — start only the services you use (`SERVICES=s3,sqs`), not the whole suite.

The recurring lesson: many "CI-only flakes" are actually **resource exhaustion**, not non-determinism. Profile runner memory before blaming the test.

---

## Core Concept 3 — The Cost Model of an Integration Suite

Integration tests cost real money and time. A professional reasons about them as an investment with a measurable return.

**The cost side:**

```
cost_per_run ≈ (runner_minutes × runner_$/min)
             + maintenance_time (flake triage, fixture upkeep)
             + feedback_latency_tax (devs waiting on the suite)
```

A 12-minute suite running on every PR across 40 engineers pushing 8×/day is not free — it's thousands of runner-minutes daily plus the compounding cost of every developer waiting on it. Feedback latency is the sneaky line item: a suite slow enough to context-switch on taxes throughput far beyond its compute bill.

**The value side:** integration tests catch a *specific class* of bug (wiring, SQL, serialization, transactions) that nothing cheaper catches and that is expensive in production. The ROI question per test is: *does this test catch a class of bug worth more than its lifetime run-and-maintain cost?*

**Levers when the bill is too high:**

- **Right-size the layer.** Demote logic-only tests to unit; reserve integration for true boundaries (senior Concept 1).
- **Shard and parallelize** so wall-clock latency drops even if total compute holds.
- **Run the full suite on merge, a fast subset on PR** (test impact analysis / changed-module selection) — but keep the full suite gating *somewhere* before production.
- **Kill low-value tests.** A test that has never caught a bug and costs maintenance is a liability; deletion is a legitimate optimization.

Track **cost per green** and suite runtime as first-class metrics, the same way you'd track cloud spend.

---

## Core Concept 4 — Test-Environment Management

Integration tests need dependencies; *where* those come from is a managed decision with a clear hierarchy of preference:

1. **Ephemeral (Testcontainers) — strongly preferred.** Per-job, hermetic, reproducible, no shared state. The default for narrow and most broad integration.
2. **Dedicated ephemeral environments** (spun per PR via IaC) — for broad multi-service integration that can't fit in one Docker host. Costly; reserve for genuine multi-service wiring tests. See the `infrastructure-as-code` skill.
3. **Shared long-lived test environments — last resort.** A persistent "staging DB" everyone points at. Cheap to stand up, *expensive in flakiness*: shared mutable state, noisy-neighbour failures, drift from production, and contention. The classic anti-pattern is the team integration suite that fails because *another* team's run left bad data in the shared database.

**Configuration & secrets.** Tests need connection strings, credentials, feature flags. Inject them per environment; never hard-code prod endpoints; keep secrets out of the repo (use the CI secret store; see the `secrets-management` skill). A test that can accidentally point at production is a security and data-integrity incident waiting to happen.

The strategic push is **toward ephemeral, away from shared**: the more state a test environment shares across runs and teams, the more it leaks flakiness and the less a green result means.

---

## Core Concept 5 — Owning Shared Test Infrastructure

At scale, integration testing has shared assets, and *unowned shared assets rot*. Treat them as a product with a team behind them:

- **A shared Testcontainers base / fixtures library** — common container setup, waits, and a Postgres/Kafka harness so every team isn't reinventing lifecycle and flake-avoidance.
- **Test-data factories** — canonical builders for core domain objects (see [Test Data Management](../11-test-data-management/) and the `test-data-management` skill), so a schema change updates one factory, not 200 tests.
- **CI runner pools and Docker infra** — capacity, the registry mirror, runner images.
- **Migration-testing harness** — a standard way to verify migrations against the real engine in CI (the `database-migration-patterns` skill).

**Ownership model.** A **test platform / developer-experience team** owns this infrastructure as a product: SLAs on the shared harness, a deprecation process for shared fixtures, and a feedback loop with product teams. Product teams own *their* tests; the platform team owns the *means to run them well*. Without explicit ownership, the base image drifts, fixtures fork, flake rates climb, and every team pays the tax independently — the textbook tragedy of the commons.

A governing **test strategy document** (the unit/integration/e2e split, isolation conventions, the flake policy, the ephemeral-over-shared rule) keeps independent teams from diverging into incompatible local optima. See [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/).

---

## Core Concept 6 — Suite Health as a Tracked Metric

You manage what you measure. For an integration suite at scale, instrument and trend:

| Metric | Why it matters | Target shape |
|---|---|---|
| **p50 / p95 runtime** | Feedback latency; p95 is what devs *feel* | Bounded; alert on regression |
| **Flake rate** | Trust in the gate | < 0.5%; quarantine on breach |
| **Pass rate on `main`** | Health of the trunk gate | ~100% (flakes excluded) |
| **Cost per green** | Spend efficiency | Trending flat/down |
| **Slowest-N tests** | Where to optimize | Reviewed regularly |
| **Container start failures** | Infra health (Docker/Ryuk/resources) | Near zero |

Put these on a dashboard. A rising flake rate or a creeping p95 is a leading indicator that the suite is about to lose the team's trust — catch it before someone proposes "let's just disable integration tests on PRs." Tie a **flake-rate SLO** to a policy: above threshold, the test is auto-quarantined and a ticket is filed. See [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/).

---

## Core Concept 7 — Organisational Patterns & the Test Strategy Doc

How integration testing is organised across many services shapes everything:

- **Per-service narrow integration + cross-service contracts.** The scalable default: each service tests its own boundaries with Testcontainers; service-to-service agreement is verified with [Contract Testing](../05-contract-testing/), not broad integration. This avoids the combinatorial explosion of spinning up the whole estate for every team.
- **Broad integration reserved for genuine emergent wiring** — a saga across two services, a specific eventual-consistency path — and run sparingly, in dedicated ephemeral environments.
- **Standardized harness, decentralized tests.** Central team provides the rails (base images, factories, CI templates); product teams write the tests on those rails.
- **A written test strategy** that codifies: the layer split, isolation conventions, the ephemeral-over-shared rule, the flake policy, and what is/isn't a required check. Without it, 30 teams invent 30 conventions and the shared infra can't serve them all.

This is also where integration testing meets [Testing in Production](../13-testing-in-production/): no pre-prod suite is perfectly faithful, so mature orgs pair a strong integration suite with production observability and synthetic monitoring rather than chasing 100% pre-prod fidelity.

A concrete decision framework for "narrow vs broad vs contract" across services:

| Question being answered | Right tool | Why |
|---|---|---|
| Does my repository's SQL work against the real engine? | Narrow integration (Testcontainers) | Only the real engine exposes dialect/constraint/transaction bugs |
| Does my HTTP layer serialize and route correctly? | Narrow integration (real app server) | Catches JSON/status/middleware bugs a handler unit test misses |
| Do service A and service B still agree on the message shape? | Contract test | Cheap, no need to run both services together |
| Does a saga across A and B converge correctly? | Broad integration (ephemeral env) | Genuinely emergent wiring; reserve for these |

The trap most orgs fall into is reaching for broad integration (spin up everything) for questions the first three rows answer far more cheaply. Broad integration should be the rare exception, justified by genuinely emergent multi-service behaviour that no narrower test can observe.

---

## Real-World Examples

- **The shared staging DB that flaked everyone.** Five teams pointed integration suites at one staging Postgres. Cross-team data collisions produced a ~4% flake rate org-wide. Migrating to per-job Testcontainers dropped it under 0.3% and removed an entire class of "not my bug" triage.
- **The CI memory wall.** A team added Kafka + localstack containers; jobs began OOM-failing intermittently. The "flake" was the runner exceeding RAM under 6 parallel workers. Capping container memory and dropping to 3 workers fixed it — a resource problem, not a test problem.
- **The base-image dividend.** A platform team shipped a shared Testcontainers harness with tuned waits and a Postgres template-DB reset. Adopting teams saw integration suites drop 40% in runtime and flake triage nearly vanish — the value of owned shared infra, quantified.
- **Cost-driven selection.** A 22-minute PR suite was costing more in runner-minutes and developer waiting than it returned. Splitting to changed-module selection on PR + full suite on merge cut PR latency to 6 minutes while keeping the full gate before release.

---

## Mental Models

- **Ephemeral over shared, always.** Every bit of state shared across runs or teams leaks flakiness and dilutes what green means.
- **Unowned shared infra rots.** Name an owner or watch the commons degrade.
- **A flaky required check is worse than no check.** It trains the org to merge through red.
- **The suite is a budget line.** Runner-minutes plus developer-wait is real spend; optimize it like cloud cost.
- **Reproducibility beats reuse in CI.** A green run must mean the same thing every time.

---

## Common Mistakes

- **Container reuse enabled in CI.** Sacrifices the reproducibility that's the whole point of CI.
- **Floating image tags (`:latest`).** Non-reproducible builds; silent engine drift.
- **Blaming non-determinism for resource exhaustion.** Profile runner RAM/CPU before calling it a flake.
- **Standing up a shared staging DB as the default.** Cross-team collisions and drift; prefer ephemeral.
- **No owner for shared fixtures/base images.** Forks, drift, duplicated effort, rising flake rates.
- **Gating on a flaky integration stage.** Erodes trust until someone removes the gate entirely.
- **Ignoring the cost model.** A 25-minute everyone-waits suite can cost more than it protects.
- **Chasing 100% pre-prod fidelity** instead of pairing integration tests with production observability.

---

## Test Yourself

1. Why is container reuse appropriate locally but wrong in CI?
2. Name three ways to cut image-pull time on cold CI runners.
3. How would you tell a resource-exhaustion failure apart from a genuine test flake?
4. Rank ephemeral (Testcontainers), per-PR ephemeral environments, and shared staging — and justify the order.
5. Write the cost model for an integration suite and name the sneakiest line item.
6. What belongs to a test-platform team vs a product team?
7. Which suite-health metrics would you dashboard, and what policy would you tie to flake rate?
8. Why does per-service-integration + cross-service-contracts scale better than broad integration everywhere?

---

## Cheat Sheet

```
CI:        own stage after unit; Docker on runner (DooD/Ryuk); pin digests;
           reproducible > reuse (reuse = LOCAL only); required check once flake low
CACHING:   registry mirror / pre-baked runners / minimal images; cache own base
RESOURCES: budget RAM = container_mem × parallelism + headroom; cap containers;
           "CI-only flake" is often OOM, not non-determinism
COST:      runner_min + maintenance + feedback-latency tax; track cost-per-green;
           PR=changed subset, merge=full gate; delete zero-value tests
ENV:       ephemeral (Testcontainers) > per-PR ephemeral > shared staging (rot)
           secrets from CI store; never point a test at prod
OWNERSHIP: test-platform team owns base image + factories + runner infra (SLA);
           product teams own their tests; written strategy doc governs the split
HEALTH:    dashboard p95 runtime · flake% · cost/green; flake>SLO → auto-quarantine
SCALE:     per-service integration + cross-service CONTRACTS; broad = rare/ephemeral
```

---

## Summary

At the professional level, integration testing is infrastructure economics. It runs in its own CI stage after unit tests, with Docker on the runner, pinned digests, and reproducibility favoured over reuse. Cold-start and resource limits dominate reliability — many "CI flakes" are really OOM. Reason about the suite as a budget line (runner-minutes plus the developer-wait tax) and right-size the layer, shard it, and prune dead tests to control cost. Prefer ephemeral dependencies over shared staging environments, which leak cross-team flakiness. Above all, give shared test infrastructure — base images, data factories, runner pools, the migration harness — an explicit owner and a written strategy, because unowned shared infrastructure rots and every team ends up paying the tax alone. Pair the suite with production observability rather than chasing perfect pre-prod fidelity.

---

## Further Reading

- The `integration-testing` skill — scaling integration tests across services.
- The `ci-cd-pipeline-design` skill — staging, caching, and gating pipelines.
- The `test-data-management` skill — shared factories and fixtures.
- The `database-migration-patterns` skill — migration verification in CI.
- The `infrastructure-as-code` and `secrets-management` skills — ephemeral environments and credentials.
- Testcontainers CI documentation; your CI provider's Docker/runner guides.

---

## Related Topics

- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — the governing strategy doc.
- [Contract Testing](../05-contract-testing/) — how multi-service orgs avoid broad integration.
- [Test Data Management](../11-test-data-management/) — shared factories as owned infrastructure.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — flake-rate SLOs and policy.
- [Testing in Production](../13-testing-in-production/) — where pre-prod fidelity gives way to observability.
- [End-to-End Testing](../04-end-to-end-testing/) — the costliest layer, governed by the same economics.
