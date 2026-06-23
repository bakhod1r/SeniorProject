# Contract Testing — Professional Level

> **Roadmap:** [Testing](../README.md) → Contract Testing
>
> *Adopting contract testing across an org: governance, ownership, versioning at scale, and CD integration.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The adoption sequence](#core-concept-1--the-adoption-sequence)
5. [Core Concept 2 — Ownership: who owns the contract](#core-concept-2--ownership-who-owns-the-contract)
6. [Core Concept 3 — CDC vs provider-driven as an org decision](#core-concept-3--cdc-vs-provider-driven-as-an-org-decision)
7. [Core Concept 4 — Versioning and branch/environment strategy at scale](#core-concept-4--versioning-and-branchenvironment-strategy-at-scale)
8. [Core Concept 5 — The can-i-deploy gate across many pipelines](#core-concept-5--the-can-i-deploy-gate-across-many-pipelines)
9. [Core Concept 6 — Pending pacts and WIP pacts: adopting without blocking](#core-concept-6--pending-pacts-and-wip-pacts-adopting-without-blocking)
10. [Core Concept 7 — Governance, conventions, and metrics](#core-concept-7--governance-conventions-and-metrics)
11. [Core Concept 8 — Relationship to API versioning and E2E reduction](#core-concept-8--relationship-to-api-versioning-and-e2e-reduction)
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

> Focus: **making contract testing a default across dozens of teams without it becoming a coordination tax.**

A single Pact loop is easy. The hard part is rolling it out across an organization: standing up a broker as shared infrastructure, deciding who owns which contract, integrating `can-i-deploy` into every pipeline *without* turning it into a flaky blocker, and keeping the whole thing trustworthy as hundreds of contracts and thousands of versions accumulate.

This tier is the staff/principal view: the adoption sequence, ownership models, versioning conventions, the **pending/WIP pacts** mechanism that lets you adopt incrementally without breaking provider builds, governance, and how contract testing relates to API versioning and the deliberate shrinking of the E2E layer.

---

## Prerequisites

- You completed [senior.md](senior.md): `can-i-deploy`, schema vs Pact, async/bi-directional.
- You own or influence CD pipelines across multiple teams.
- You understand API evolution; the `api-versioning` skill is assumed.
- You've felt the pain of a flaky shared E2E environment at scale.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Broker as platform** | Running the Pact Broker/PactFlow as shared, governed infrastructure. |
| **Pending pacts** | Newly published consumer contracts that don't *fail* the provider build until verified once. |
| **WIP pacts** | Work-in-progress pacts auto-included in verification without being explicitly configured. |
| **Pacticipant** | A consumer or provider participating in contracts. |
| **Mainline branch** | The integration branch (e.g. `main`) whose verified state gates deploys. |
| **Contract owner** | The team accountable for a given contract's content and upkeep. |
| **Deployment record** | Broker fact that version X is in environment E (basis for `can-i-deploy`). |
| **Verification debt** | Backlog of unverified or stale contracts eroding the gate's trustworthiness. |

---

## Core Concept 1 — The adoption sequence

Roll out in an order that produces value early and avoids a big-bang stall:

```
1. Stand up the broker as platform infra (PactFlow hosted, or self-host).
   - SSO, RBAC, backups, retention policy. Treat it like a prod service.
2. Pick ONE high-value, painful consumer/provider pair as the pilot.
   - Ideally one that currently relies on a flaky shared E2E env.
3. Wire the consumer pipeline: pact test → publish (version=SHA, branch).
4. Wire the provider pipeline: verify → publishVerificationResult.
5. Turn on PENDING pacts on the provider (Concept 6) so new contracts
   never break the provider build before first verification.
6. Add can-i-deploy as a gate in BOTH pipelines (--to-environment).
7. Add record-deployment to both deploy steps.
8. Measure: contract coverage, gate catches, E2E flakiness drop.
9. Templatize the pipeline steps; onboard the next teams from the template.
```

The two non-negotiables that make or break adoption: **pending pacts on** (so providers aren't punished for consumers' new contracts) and **record-deployment everywhere** (so the gate is accurate). Skip either and teams lose trust in the gate, which is fatal.

---

## Core Concept 2 — Ownership: who owns the contract

In consumer-driven testing the *content* of the contract is determined by the consumer, but **ownership is a social contract** that must be explicit:

- **The consumer owns what's in the contract** — only the fields and interactions it actually uses. Bloated contracts (declaring fields the consumer ignores) over-constrain the provider and are the consumer's bug to fix.
- **The provider owns honoring it** — implementing state handlers and keeping responses compatible.
- **Both own the conversation when verification fails.** A failed verification is a *negotiation*, not a unilateral blocker: either the provider preserves the field, or the consumer agrees it can stop reading it and updates its contract.

Make ownership legible:

```
Convention (documented in the platform runbook):
  - Pacticipant names = service names, kebab-case, globally unique.
  - Each pacticipant maps to exactly one team (broker "team" field / labels).
  - A failed verification opens an auto-filed ticket tagged to BOTH teams.
  - The consumer team is the approver for changes to its own contract.
```

Without explicit ownership, a failed verification becomes a hot potato and the gate gets disabled "to unblock the release" — the beginning of the end.

---

## Core Concept 3 — CDC vs provider-driven as an org decision

At one service this is a tooling choice; at org scale it's a *policy* with real trade-offs:

| Factor | Consumer-driven (Pact) | Provider-driven (SCC / schema) |
|--------|------------------------|--------------------------------|
| No-silent-break guarantee | Strong — provider verifies every consumer's needs | Weaker — provider may drop unmentioned fields |
| Who must participate | Every consumer publishes a contract | Provider only |
| Works for unknown consumers | No | Yes |
| Coordination cost | Higher (consumers maintain contracts) | Lower |
| Best fit | Internal, enumerable consumers; high blast-radius seams | Public APIs; many/anonymous consumers; provider-owned platforms |

The pragmatic org policy is **hybrid, by boundary class**:

- **Internal service-to-service** → consumer-driven (Pact). The strong guarantee is worth the ceremony where blast radius is high and consumers are knowable.
- **Public/partner edge** → provider-driven / schema-based (OpenAPI), with formal versioning and deprecation windows (the `api-versioning` skill).
- **gRPC internal platform** → `buf` breaking-change detection as a schema gate; add message/Pact only where richer semantics matter.

Write this down as an architecture standard so teams don't relitigate it per service.

---

## Core Concept 4 — Versioning and branch/environment strategy at scale

At scale, the broker's value depends entirely on disciplined version metadata. Standardize three things:

1. **Version = immutable build identity.** Use the full git SHA (optionally `1.4.2+sha`). Never reuse a version number for different code.
2. **Branch metadata mirrors VCS.** Publish with `--branch $GIT_BRANCH` so the broker can reason about mainline vs feature work and auto-select WIP pacts.
3. **Environments are first-class.** Record deployments to named environments (`production`, `staging`) so `can-i-deploy --to-environment` is meaningful.

```bash
# Consumer publish — full identity + branch
pact-broker publish ./pacts \
  --consumer-app-version "$(git rev-parse HEAD)" \
  --branch "$GIT_BRANCH" \
  --tag-with-git-branch \
  --broker-base-url "$PACT_BROKER_URL" --broker-token "$PACT_BROKER_TOKEN"

# After a successful deploy — make the gate accurate
pact-broker record-deployment \
  --pacticipant OrdersService \
  --version "$(git rev-parse HEAD)" \
  --environment production
```

Add a **retention/cleanup policy** so the broker doesn't accumulate millions of stale feature-branch versions: keep all `production`/`staging` versions and the latest N per branch, prune the rest. Stale data slows queries and muddies the matrix.

---

## Core Concept 5 — The can-i-deploy gate across many pipelines

With dozens of services, the gate must be *templated, fast, and trustworthy*. A reusable pipeline fragment every team includes:

```yaml
# shared CI template: contract-gate (parameterized by PACTICIPANT)
deploy-gate:
  script:
    - pact-broker can-i-deploy
        --pacticipant "$PACTICIPANT"
        --version "$(git rev-parse HEAD)"
        --to-environment "$TARGET_ENV"
        --retry-while-unknown 60 --retry-interval 10
  rules:
    - if: '$DEPLOYING == "true"'
```

Operational rules that keep it healthy at scale:

- **The gate queries recorded results — it runs no tests — so it's fast and deterministic.** Slowness means broker/network, not test flakiness; treat broker latency as a platform SLO.
- **`--retry-while-unknown`** absorbs the race where a consumer just published and the provider hasn't verified yet.
- **Never let teams bypass the gate ad hoc.** A bypass is a policy exception that should require sign-off and leave an audit trail — otherwise the gate's guarantee silently evaporates. (See the broader [quality-gates](../../quality-gates/README.md) section for break-glass design.)

---

## Core Concept 6 — Pending pacts and WIP pacts: adopting without blocking

The single biggest adoption blocker is this failure mode: a consumer publishes a *new* contract requiring a field the provider doesn't yet have; the provider's *next, unrelated* build runs verification and goes red — punishing the provider for the consumer's in-progress work.

**Pending pacts** solve this. When enabled, a pact that has *never been successfully verified* on the provider's mainline is included in verification *for information* but does **not fail** the build:

```javascript
new Verifier({
  provider: 'PaymentsService',
  providerBaseUrl: 'http://localhost:8080',
  pactBrokerUrl: process.env.PACT_BROKER_URL,
  enablePending: true,                    // new contracts won't fail the build
  includeWipPactsSince: '2026-01-01',     // auto-include WIP pacts from feature branches
  providerVersionBranch: process.env.GIT_BRANCH,
  consumerVersionSelectors: [
    { mainBranch: true },                 // verify mainline consumers
    { deployedOrReleased: true },         // and whatever is live
  ],
}).verifyProvider();
```

How the lifecycle works:

```
Consumer publishes new contract requiring `currency`.
  → Provider build verifies it as PENDING → reports "would fail" but build stays GREEN.
Provider team adds `currency`, verifies → contract becomes VERIFIED on mainline.
  → From now on it is NO LONGER pending → future regressions FAIL the build.
```

**WIP pacts** extend this to feature branches: contracts in flight are auto-pulled into verification without the provider explicitly configuring each one. Together these let you turn on contract testing everywhere *immediately* without a coordination freeze — new work flows in safely, and the gate hardens automatically once a contract is first satisfied.

---

## Core Concept 7 — Governance, conventions, and metrics

Treat the contract program like any platform capability — with standards and signals:

**Conventions to mandate:**
- Pacticipant naming = canonical service name; one team per pacticipant.
- Always publish version (SHA) + branch; always `record-deployment`.
- `enablePending` + `includeWipPactsSince` on every provider.
- Contracts use matchers, never literal-value assertions on business data.

**Metrics that tell you the program is healthy:**

| Metric | What it signals |
|--------|-----------------|
| Contract coverage | % of service-to-service edges with a contract |
| Gate catch rate | Breaks caught at `can-i-deploy` vs leaked to prod |
| Verification debt | Count/age of unverified or never-verified pacts |
| E2E suite size & flakiness | Should *drop* as contracts absorb interface checks |
| Time-to-green after a break | How fast the consumer/provider negotiation resolves |

**Anti-goal — Goodhart's law:** don't reward "number of contracts." Reward *edges covered* and *breaks caught*. A team can game contract count with trivial pacts; it can't game a real prod break that the gate stopped.

---

## Core Concept 8 — Relationship to API versioning and E2E reduction

Contract testing and API versioning are complementary, not redundant:

- **API versioning** (the `api-versioning` skill) governs *intentional, planned* evolution — `v1` → `v2`, deprecation windows, sunset headers — especially for public/unknown consumers you can't verify against.
- **Contract testing** governs *unintentional* breakage among consumers you *can* enumerate, and gives a per-deploy safety check.

Use them in layers: contract tests catch the accidental break in CI/CD; versioning provides the deliberate migration path when a break is *intended*. For a public API you do both — schema-based contract checks at the edge plus a formal version policy.

**The E2E reduction is the strategic payoff.** Before contracts, teams pile up end-to-end tests to catch interface drift — slow, flaky, combinatorial. As contract coverage rises, you can *deliberately delete* most of those E2E tests, keeping only a thin layer for true multi-service *behavior* of critical journeys. The target shape (see the [test pyramid](../01-test-strategy-and-the-pyramid/professional.md)):

```
Before contracts:        After contracts:
  many flaky E2E           thin E2E (critical journeys only)
  ───────────────         ──────────────────
  few contract             broad contract coverage (every seam)
  many unit                many unit (unchanged)
```

Track E2E count going *down* as a success metric of the contract program — it's the clearest evidence the investment paid off.

---

## Real-World Examples

- **Platform rollout.** A 40-service org stands up PactFlow as platform infra, pilots on the order/payment seam (their flakiest E2E), templatizes the pipeline, and turns on pending pacts. Within a quarter, contract coverage hits 80% of internal edges and the nightly E2E suite shrinks by half.
- **Pending pacts save a build.** A consumer team publishes a contract needing `currency` on Friday. The provider's Monday build reports it as pending (green), the provider adds the field Tuesday, and the contract hardens — no cross-team fire drill.
- **Hybrid policy.** Internal services use Pact; the public API uses OpenAPI-based bi-directional checks plus a `v1`/`v2` version policy with a 6-month deprecation window.
- **Gate audit trail.** A release engineer needs to bypass `can-i-deploy` during an incident; the break-glass path requires a director's approval and files an automatic ticket, preserving the gate's integrity.

---

## Mental Models

- **The broker is platform infrastructure, not a test artifact.** It needs SLOs, backups, RBAC, and retention — treat it like a production service.
- **Pending pacts turn a hard cutover into a gradient.** You can adopt everywhere at once because new contracts can't punish providers.
- **A failed verification is a conversation, not a verdict.** Ownership conventions decide how that conversation resolves.
- **Contracts let you delete E2E tests.** The program's ROI is measured in E2E tests removed, not contracts added.

---

## Common Mistakes

- **Big-bang rollout with pending pacts off.** Providers get punished for consumers' new work; teams disable the gate.
- **Letting `record-deployment` lapse.** The gate quietly reasons about the wrong production set.
- **Rewarding contract count.** Goodhart kicks in; reward edge coverage and prod breaks caught.
- **No retention policy.** The broker bloats with feature-branch versions; queries slow, the matrix muddies.
- **Ad-hoc gate bypasses.** Each undocumented bypass erodes the guarantee until it's worthless.
- **Keeping the old E2E suite forever.** You pay for contracts *and* the flaky tests they were meant to replace.
- **No ownership model.** Failed verifications become hot potatoes; the gate gets turned off "to ship."

---

## Test Yourself

1. Why are pending pacts the key enabler for adopting contract testing across many teams at once?
2. Describe a sensible hybrid CDC-vs-provider-driven policy by boundary class, with justification.
3. What three pieces of version/branch/environment metadata must be standardized for the gate to work, and why each?
4. How would you measure whether the contract program is actually paying off? Name two metrics and the Goodhart trap to avoid.
5. A failed provider verification blocks a release. Walk through how your ownership conventions resolve it.
6. Explain how contract testing and API versioning divide the labor for a public API with unknown consumers.

---

## Cheat Sheet

```
Adoption order: broker as platform → pilot painful pair → wire consumer+provider
  → enablePending → can-i-deploy gate → record-deployment → measure → templatize.

Non-negotiables:
  enablePending: true + includeWipPactsSince  (adopt without blocking providers)
  record-deployment after EVERY deploy        (accurate gate)
  version = git SHA, always publish --branch   (matrix integrity)
  retention policy                             (broker stays fast)

Ownership:
  consumer owns contract content (only fields it uses)
  provider owns honoring it (state handlers, compat)
  failed verify = negotiation, auto-ticket both teams

Policy by boundary:
  internal svc↔svc  → CDC / Pact (strong guarantee)
  public/partner    → schema-based + formal versioning (api-versioning)
  gRPC internal     → buf breaking gate

Metrics: edge coverage · gate catch rate · verification debt · E2E count ↓
  (reward breaks caught, NOT contract count — Goodhart)

Strategic payoff: delete most E2E tests; keep a thin critical-journey layer.
```

---

## Summary

Scaling contract testing is an organizational program, not a tool install. Stand up the broker as governed platform infrastructure; pilot a painful seam; and make adoption frictionless with **pending and WIP pacts** so new consumer contracts never punish provider builds. Standardize version/branch/environment metadata so `can-i-deploy` stays accurate, template the gate into every pipeline, and make ownership explicit so a failed verification triggers a *negotiation*, not a bypass. Adopt a **hybrid policy by boundary** — CDC for internal seams, schema-based plus formal versioning at the public edge, `buf` for gRPC. Measure edge coverage and breaks-caught (not contract count), and treat the **shrinking E2E suite** as the program's clearest ROI.

---

## Further Reading

- PactFlow / Pact docs — *Pending pacts*, *WIP pacts*, *Consumer version selectors*, *Deployments & environments*.
- *Building Microservices* (Sam Newman) — testing across boundaries at org scale.
- *Accelerate* (Forsgren, Humble, Kim) — deployment gates and flow.
- The `api-versioning`, `api-testing`, and `microservice-communication` skills.
- [Quality Gates](../../quality-gates/README.md) — break-glass and gate governance.

---

## Related Topics

- [Test Strategy and the Pyramid](../01-test-strategy-and-the-pyramid/professional.md) — the E2E-reduction strategy.
- [End-to-End Testing](../04-end-to-end-testing/professional.md) — the thin layer that remains.
- [Integration Testing](../03-integration-testing/professional.md) — in-service boundary tests.
- [Quality Gates](../../quality-gates/README.md) — gate design, break-glass, policy-as-code.
- [Contract Testing — Interview](interview.md) — the question bank.
