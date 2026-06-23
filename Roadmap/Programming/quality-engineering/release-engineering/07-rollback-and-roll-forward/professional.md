# Rollback & Roll-Forward — Professional Level

> **Roadmap:** [Release Engineering](../README.md) → Rollback & Roll-Forward

*Reversibility is an architectural property you design for, pay for, and govern — not a feature you bolt on after the outage. At scale, the question is organizational as much as technical.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Reversibility as a first-class design constraint](#core-concept-1--reversibility-as-a-first-class-design-constraint)
5. [Core Concept 2 — The irreversible-release anti-pattern](#core-concept-2--the-irreversible-release-anti-pattern)
6. [Core Concept 3 — Coordinating rollback across dependent services](#core-concept-3--coordinating-rollback-across-dependent-services)
7. [Core Concept 4 — Rollback governance and decision authority](#core-concept-4--rollback-governance-and-decision-authority)
8. [Core Concept 5 — The cost of fast rollback](#core-concept-5--the-cost-of-fast-rollback)
9. [Core Concept 6 — Choosing the strategy per workload, not per company](#core-concept-6--choosing-the-strategy-per-workload-not-per-company)
10. [Core Concept 7 — Organization-wide rollback as a platform capability](#core-concept-7--organization-wide-rollback-as-a-platform-capability)
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

> Focus: **rollback as an architectural, organizational, and economic decision made before code is written — and governed across many teams and services.**

By the senior level, rollback is tested, automated, and measured for a single service. The professional level operates one layer up. Here, reversibility is a *constraint you impose on designs at review time*, an *anti-pattern you can name and reject*, a *cross-service coordination problem*, a *governance question* (who decides, with what authority, under what blast radius), and an *economic trade-off* (fast rollback is not free — warm standby capacity, double-provisioned blue-green, artifact retention all cost money). Your job is to set the policy, build the platform, and own the trade-offs for an organization, not to push a single button.

---

## Prerequisites

- You operate or architect a multi-service system with independent deploy cadences.
- Deep fluency with expand/contract, auto-rollback, MTTR, and mixed-version compatibility — [senior](./senior.md).
- Experience leading or running incident command.
- Budget/capacity ownership or strong influence over infrastructure spend.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Reversibility** | The property that a change can be undone safely and quickly. |
| **One-way / two-way door** | Bezos framing: irreversible vs reversible decisions. |
| **Irreversible release** | A release that cannot be rolled back (destructive state, broken compat, side effects). |
| **Blast radius** | The scope of impact of a change or a rollback. |
| **Incident commander (IC)** | The single person with decision authority during an incident. |
| **Break-glass** | An emergency procedure that bypasses normal gates, with audit. |
| **Warm standby** | Pre-provisioned capacity (e.g., blue env) kept ready for instant cutover. |
| **Compensating transaction** | An action that semantically undoes a completed, irreversible operation. |
| **Saga** | A sequence of local transactions with compensations for distributed rollback. |
| **Deploy/release decoupling** | Shipping code dark, then releasing behavior via flags. |

---

## Core Concept 1 — Reversibility as a first-class design constraint

The professional reframe: **reversibility is a requirement, evaluated at design and code-review time, with the same weight as correctness, security, and performance.** "How do we undo this?" is asked *before* merge, not discovered during an outage.

Operationalize it as a checklist applied to every non-trivial change:

```text
Reversibility review (gate before merge of risky changes):
  [ ] Schema changes are expand/contract; no destructive step in this release.
  [ ] Previous artifact is retained and will remain rollback-able.
  [ ] N-1 ↔ N API/message compatibility verified in CI (contract tests, buf breaking).
  [ ] Side-effecting code (email/payment/webhook) is flag-gated or has a compensation.
  [ ] Data written in a new format is readable by N-1 (dual-format window defined).
  [ ] Rollback procedure is automated or documented AND has been exercised.
  [ ] Cache keys are versioned so N-1 doesn't mis-read N's entries.
```

This makes reversibility a *standing constraint* rather than a heroic recovery skill. Borrow Amazon's **one-way / two-way door** language: most changes should be engineered into two-way doors (reversible, decide fast, undo if wrong). When a change is genuinely a one-way door — a destructive migration, an irreversible data transformation — it must be *flagged as such*, reviewed at a higher bar, and sequenced so that the irreversible step happens only after the reversible parts have been proven in production.

---

## Core Concept 2 — The irreversible-release anti-pattern

Name it so you can reject it in review. An **irreversible release** is any release you cannot roll back. They are almost always *accidental* — engineers don't set out to make a release irreversible; they make a local decision that silently removes the rollback option. The recurring causes:

1. **Destructive migration coupled to the deploy.** `DROP`/`RENAME` in the same release as the code using it.
2. **Broken N↔N-1 compatibility.** Removing an API field, tightening a contract, changing a message schema incompatibly.
3. **Irreversible side effects.** Sending emails, capturing payments, firing webhooks with no compensation.
4. **New-format data with no tolerant reader in N-1.** N writes records N-1 can't parse.
5. **Garbage-collected prior artifacts.** Retention policy deleted the only thing you could roll back to.

The professional discipline is to **convert one-way doors into two-way doors by sequencing**:

```text
Want to: delete a column and change the API.   (irreversible if done at once)

Sequence it:
  R1: EXPAND schema + tolerant-reader code      (reversible)
  R2: switch reads to new column, flag-gated     (reversible — flip flag)
  R3: additive API change, old field retained    (reversible — N-1 compatible)
  R4: soak; prove stability                       (reversible)
  R5: CONTRACT — drop column, remove old field   (the ONLY irreversible step,
                                                   taken only after R1–R4 proven)
```

The irreversible step shrinks to a single, late, well-understood release with nothing risky riding on it. **You don't avoid irreversibility; you isolate and defer it.**

---

## Core Concept 3 — Coordinating rollback across dependent services

In a microservice system, rolling back one service can break others. Service A's N-1 may not understand service B's N, and vice versa. Rollback becomes a *distributed* problem.

**Principles for cross-service reversibility:**

- **Independent deployability requires independent reversibility.** If A can deploy without B, A must be able to *roll back* without B. This is purchased with N↔N-1 compatibility *at every interface*, enforced by contract tests so a rollback of A never breaks B.
- **Order matters, both ways.** If A's new feature depends on B's new capability, you must deploy B before A — and roll back A before B. Capture these dependencies explicitly; an ordered rollback runbook for a coordinated launch is part of the launch plan.
- **Avoid lockstep releases.** A release that requires three services to flip simultaneously is an irreversible release in disguise — there's no clean rollback point. Decompose it into independently reversible steps using flags and additive contracts.
- **Distributed side effects need sagas/compensations.** When a workflow spans services and has committed effects, "rollback" means executing **compensating transactions** (refund, cancel, retract), not reverting code. Design the saga's compensations up front. See the `event-driven-architecture` concepts and the `high-availability-patterns` skill.

```text
Coordinated launch rollback order (recorded in the launch runbook):
  Deploy order:   B (capability) → A (consumer) → flag on
  Rollback order: flag off → roll back A → roll back B
  Verify N-1 compatibility at each hop before proceeding.
```

The platform-level answer is **deploy/release decoupling via flags**: deploy all services dark in any order (they're all backward-compatible), then *release* the cross-cutting behavior with a single flag flip — which is also a single, instant, coordinated *rollback* point. This is the cleanest distributed rollback primitive that exists.

---

## Core Concept 4 — Rollback governance and decision authority

At scale, the bottleneck in recovery is often not the mechanism but the *decision*. Who is allowed to roll back? Who decides between rollback and roll-forward at 3 a.m.? Governance answers this before the incident.

- **Single decision authority during incidents.** The **incident commander** owns the rollback/roll-forward call. Not a committee, not a Slack debate. Pre-authorize the IC to roll back tier-1 services without further sign-off — recovery speed dies in approval chains.
- **Pre-authorized, bounded autonomy.** On-call engineers should be *pre-approved* to execute rollback and kill-switches within a defined blast radius (their service). No change-advisory-board ticket to stop an outage.
- **Break-glass with audit.** Emergency rollback may bypass normal gates (e.g., expedited hotfix), but every bypass is logged, attributed, and reviewed afterward. Speed now, accountability later — see how quality gates handle break-glass in [Release Branching & Trains](../03-release-branching-and-trains/professional.md) and the broader quality-gates material.
- **Roll-forward vs rollback decision rights.** Codify the default: e.g., "roll back unless a destructive migration or irreversible state makes it unsafe, in which case roll forward; IC decides ties." Removing the ambiguity removes minutes from MTTR.
- **Blast-radius-aware authority.** Flipping a global kill switch that affects all customers may need a higher authority than rolling back one service in one region. Tier the authority to the blast radius.

```text
Decision matrix (encoded in the incident policy):
  Single service, no shared state      → on-call, pre-authorized, no approval
  Cross-service / shared data          → incident commander
  Global flag / all-customer impact    → IC + service owner ack
  Break-glass (bypass gate)            → allowed, auto-logged, post-incident review
```

The governance goal: **make the safe action the fast action.** If the policy forces a debate to roll back, the policy is the outage.

---

## Core Concept 5 — The cost of fast rollback

Fast rollback is an insurance premium, and someone pays it. Professionals make the cost explicit and right-size it per workload tier.

| Capability | What it buys | What it costs |
|------------|--------------|---------------|
| **Blue-green** | Seconds to cut back; instant rollback | ~2× capacity during the window; orchestration complexity |
| **Warm standby (prior version kept running)** | No cold-start on rollback | Idle compute paying to wait |
| **Artifact retention (N..N-k)** | A binary to roll back to | Registry storage; retention/GC policy management |
| **Dual-format data / tolerant readers** | Rollback over data changes | Engineering effort; transient storage of both formats |
| **Feature-flag platform** | Instant behavioral rollback, no deploy | Flag-management tooling, flag debt/cleanup cost |
| **Auto-rollback (Argo/Flagger)** | Near-zero MTTR | Controller complexity; risk of false aborts |

The trade-off is **rollback speed vs steady-state cost**. Blue-green gives the fastest cutover but doubles capacity; rolling deploys are cheaper but slower to reverse; flags are cheap at runtime but carry maintenance debt. Tier-1 revenue services may justify blue-green and warm standby; a batch job does not — a slow `rollout undo` is fine there.

A subtle but important point: **a fast pipeline is itself a rollback-cost reducer.** If you can rebuild and ship in 3 minutes, roll-forward is cheap and you can carry less warm standby. Investing in pipeline speed (caching, fast gates — see [Release Automation](../08-release-automation/professional.md)) reduces the capacity you must pay to keep warm. The cheapest fast recovery is often a fast pipeline plus pervasive flags, not double infrastructure.

---

## Core Concept 6 — Choosing the strategy per workload, not per company

The senior level posed rollback culture vs roll-forward culture as an org choice. The professional refinement: **it's a per-workload decision, governed by org-wide policy but applied by tier.** A single company runs both.

```text
Workload tier      Recovery default        Mechanism investment
-----------------  ----------------------  -------------------------------
Tier-1 revenue     Auto-rollback           Blue-green + flags + warm standby
Customer-facing    Rollback, fast          Canary + auto-abort + flags
Internal tools     Roll-forward            Plain rolling deploy, fast pipeline
Batch / async      Roll-forward            rollout undo is fine; idempotent jobs
Data pipelines     Roll-forward + replay   Reprocessing; rarely roll back code
```

Drivers of the choice:

- **Deploy frequency** — high frequency favors roll-forward (forward is routine and fast).
- **Pipeline speed** — slow pipeline forces rollback (can't fix forward in time).
- **Flag coverage** — heavily flag-gated systems get instant behavioral rollback for free, pushing toward roll-forward-with-kill-switch.
- **Statefulness** — stateful systems make code rollback hard, often forcing roll-forward + compensation.
- **Regulatory/blast radius** — high-stakes systems favor the *most proven* recovery, which is usually rollback to a known-good artifact.

The professional sets the *policy* (which tier gets which default, what each must invest in) and ensures the platform makes the chosen path genuinely fast for each tier.

---

## Core Concept 7 — Organization-wide rollback as a platform capability

The endgame: individual teams should not each invent rollback. The platform provides it as a **paved road**, so that *every* service inherits tested, fast, governed recovery by default.

What a platform team ships:

- **A standard progressive-delivery template** (Argo Rollouts/Flagger) with auto-abort wired to org-standard SLIs — opt-out, not opt-in.
- **Enforced artifact retention** in the registry so a prior version is *always* present to roll back to; GC cannot delete the last N.
- **CI gates for reversibility**: destructive-migration detection, `buf breaking`/contract tests, dual-format checks — a release that breaks reversibility fails to merge.
- **A central feature-flag platform** with audit, so kill-switch is a one-line capability for every team.
- **Org-wide MTTR / rollback-time dashboards** with SLOs per tier, so reversibility is measured and regressions are visible to leadership.
- **Game-day-as-a-service**: scheduled, automated chaos that exercises each service's rollback path and reports recovery time.

This turns reversibility from a per-team heroics problem into an *org property*: the default service is reversible because the platform makes irreversibility hard to build by accident. That is the highest expression of this topic — **the safe thing is the easy thing, everywhere, by default.**

---

## Real-World Examples

- **Sequenced irreversibility.** A platform team needs to re-shard a core table — genuinely irreversible. They sequence it across five releases (dual-write, backfill, verify, switch reads behind a flag, soak two weeks) so that until the very last contract step, a flag flip restores the old path instantly. The one-way door is reduced to a single, boring, late release.
- **Cross-service rollback order saves a launch.** A coordinated launch spans payments, ledger, and notifications. The launch runbook encodes deploy order and the *reverse* rollback order, all behind a single feature flag. When a ledger bug appears, the IC flips one flag — instantly and atomically rolling back behavior across all three services. No service code was reverted.
- **Governance removes 12 minutes from MTTR.** A post-incident review finds rollback was delayed 12 minutes waiting for a manager to approve. The org pre-authorizes on-call to roll back tier-1 within their service blast radius. Next incident: rollback in 90 seconds.
- **Right-sizing cost.** Finance flags the bill for keeping blue-green warm on 40 internal services. The platform team downgrades non-tier-1 services to rolling deploys with a fast pipeline, keeping blue-green only where revenue justifies the 2× capacity. Recovery stays adequate; spend drops materially.

---

## Mental Models

- **One-way vs two-way doors.** Engineer changes as two-way doors. When a door is genuinely one-way, isolate it, defer it, and review it harder.
- **Reversibility is a tax you pay at design time or a debt you pay during the outage.** Pay it early; it's cheaper.
- **The flag flip is the universal coordinated rollback.** Across services, deploy/release decoupling gives you one atomic, instant rollback point.
- **Governance is part of the mechanism.** A rollback you're not authorized to perform is as slow as one you can't perform.
- **The platform is the policy.** If the paved road is reversible by default, the org is reversible by default.

---

## Common Mistakes

- **Treating reversibility as an ops concern, not a design constraint.** It belongs in design review, with correctness and security.
- **Lockstep multi-service releases.** No clean rollback point; decompose with flags and additive contracts.
- **Approval chains in the recovery path.** Pre-authorize rollback; the safe action must be the fast action.
- **Paying for blue-green everywhere.** Tier the cost to the workload; a fast pipeline plus flags is often cheaper.
- **Letting retention GC the last good artifact.** Enforce minimum retention at the platform level.
- **Designing the saga's happy path but not its compensations.** Distributed rollback *is* the compensations.
- **One company-wide recovery doctrine.** Choose per workload tier; run both rollback and roll-forward.

---

## Test Yourself

1. Frame reversibility as a design constraint. What's on the pre-merge reversibility checklist?
2. List the five common causes of an accidental irreversible release and how sequencing converts a one-way door into two-way doors.
3. How do you coordinate rollback across three dependent services, and why is deploy/release decoupling the cleanest distributed rollback primitive?
4. Design a rollback decision-authority matrix by blast radius. Why must the safe action be the fast action?
5. Compare the costs of blue-green, warm standby, and a fast pipeline as rollback-speed investments. When is each justified?
6. Argue why recovery strategy is a per-workload decision and give the tiering you'd set org-wide.
7. What does a platform team ship to make the org reversible by default?

---

## Cheat Sheet

```text
Reversibility checklist (pre-merge):
  expand/contract • artifact retained • N↔N-1 compat in CI
  side effects flagged/compensated • dual-format reads • rollback exercised
  versioned cache keys

Irreversible-release causes → fix:
  destructive migration   → expand/contract, defer contract
  broken compat           → additive + tolerant reader, buf breaking in CI
  side effects            → flag-gate + compensating transaction
  new-format data         → dual-format window
  GC'd artifact           → enforced retention (platform)

Governance:
  single-service          → on-call, pre-authorized
  cross-service/shared    → incident commander
  global/all-customer     → IC + owner ack
  break-glass             → allowed, logged, post-reviewed

Cost vs speed:
  blue-green = fastest, ~2x capacity      flags = cheap runtime, debt
  warm standby = idle spend               fast pipeline = cheaper roll-forward
```

| Professional rule | Why |
|-------------------|-----|
| Reversibility is a design constraint | Cheaper before merge than during an outage. |
| Isolate & defer the one-way door | Shrinks irreversibility to one late release. |
| Independent deploy ⇒ independent rollback | Each service reversible without the others. |
| Pre-authorize rollback by blast radius | Safe action must be the fast action. |
| Tier rollback cost to the workload | Don't pay for blue-green on a batch job. |
| Make the platform reversible by default | Org-wide property, not per-team heroics. |

---

## Summary

At the professional level, rollback is an architectural, organizational, and economic concern decided *before* code ships. Reversibility becomes a first-class design constraint enforced at review time, and the **irreversible-release anti-pattern** — destructive migrations, broken N↔N-1 compatibility, uncompensated side effects, new-format data, GC'd artifacts — is named and rejected by *isolating and deferring* the one true one-way door rather than avoiding it. Across services, independent deployability demands independent reversibility, ordered rollback runbooks, sagas with real compensations, and — cleanest of all — deploy/release decoupling that turns a single flag flip into an atomic distributed rollback. Governance ensures the *decision* isn't the bottleneck: pre-authorized authority tiered to blast radius, a single incident commander, and audited break-glass make the safe action the fast action. Fast rollback costs money — blue-green capacity, warm standby, retention — so you right-size it per workload tier, often finding that a fast pipeline plus pervasive flags beats double infrastructure. Finally, the platform makes all of this the default paved road, so the organization is reversible by default rather than by heroics.

---

## Further Reading

- *Building Evolutionary Architectures*, Ford/Parsons/Kua — fitness functions, reversibility.
- *Site Reliability Engineering* & *The SRE Workbook* (Google) — incident command, MTTR, governance.
- Jeff Bezos shareholder letters — one-way vs two-way doors.
- Skill: `high-availability-patterns` — sagas, compensations, stateful rollback.
- Skill: `event-driven-architecture` — distributed transactions and compensation.
- Skill: `database-migration-patterns` — sequencing irreversible schema change.
- *Accelerate* — MTTR/deploy-frequency as organizational outcomes.

---

## Related Topics

- [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/professional.md) — deploy/release decoupling, the universal coordinated rollback.
- [Release Branching & Trains](../03-release-branching-and-trains/professional.md) — hotfix, break-glass, expedited gates.
- [Registries & Distribution](../05-registries-and-distribution/professional.md) — retention policy that guarantees a rollback target.
- [Release Automation](../08-release-automation/professional.md) — pipeline speed as a rollback-cost reducer.
- [Supply Chain Security](../09-supply-chain-security/professional.md) — verifying the integrity of the artifact you roll back to.
