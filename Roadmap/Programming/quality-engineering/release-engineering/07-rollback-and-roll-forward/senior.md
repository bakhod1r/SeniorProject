# Rollback & Roll-Forward — Senior Level

> **Roadmap:** [Release Engineering](../README.md) → Rollback & Roll-Forward

*A rollback path that has never been exercised is a hope, not a plan. Make recovery a tested, automated, measured capability — not a runbook nobody has read.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Rollback as a tested, rehearsed capability](#core-concept-1--rollback-as-a-tested-rehearsed-capability)
5. [Core Concept 2 — Automated rollback on SLO breach](#core-concept-2--automated-rollback-on-slo-breach)
6. [Core Concept 3 — Rollback time as an SRE metric (MTTR)](#core-concept-3--rollback-time-as-an-sre-metric-mttr)
7. [Core Concept 4 — Mixed-version compatibility as a contract](#core-concept-4--mixed-version-compatibility-as-a-contract)
8. [Core Concept 5 — Idempotency and the safe-to-retry property](#core-concept-5--idempotency-and-the-safe-to-retry-property)
9. [Core Concept 6 — Stateful systems: when rollback is genuinely hard](#core-concept-6--stateful-systems-when-rollback-is-genuinely-hard)
10. [Core Concept 7 — Roll-forward culture vs rollback culture](#core-concept-7--roll-forward-culture-vs-rollback-culture)
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

> Focus: **turning rollback from a documented intention into a continuously verified, automated, measured property of the system.**

The middle tier gave you the mechanisms and the migration discipline. The senior shift is one of *epistemics*: you stop *believing* you can roll back and start *knowing* it — because you exercise the path on a schedule, you automate it on objective signals, and you measure how long it takes. A rollback procedure that lives only in a wiki and has never been run is indistinguishable from no rollback at all. The first time you discover that your "previous artifact" was garbage-collected, that your migration was destructive, or that N-1 can't read N's messages should be a *game day*, not an incident.

---

## Prerequisites

- Solid grasp of expand/contract and the mixed-version window — [middle](./middle.md).
- Operating experience with an orchestrator (Kubernetes) and a progressive-delivery controller (Argo Rollouts, Flagger, or similar).
- Familiarity with SLOs, error budgets, and the four golden signals — see the `monitoring-alerting` skill.
- You own or co-own production incident response for a service.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Game day** | A planned exercise that injects failure to test recovery procedures. |
| **Auto-rollback / auto-abort** | Automated reversal of a rollout when health signals breach thresholds. |
| **SLO** | Service Level Objective — the target for a reliability metric. |
| **Error budget** | The allowed amount of unreliability before you stop shipping. |
| **MTTR** | Mean Time To Recovery — clock from impact to healthy. |
| **Analysis run** | Argo Rollouts' automated metric check during a canary step. |
| **Tolerant reader** | Code that ignores unknown fields and tolerates missing optional ones. |
| **Idempotent** | An operation that produces the same result when applied more than once. |
| **Compatibility window** | The set of versions that must interoperate concurrently. |
| **Roll-forward-only** | A culture/architecture where rollback is rare; you always fix forward. |

---

## Core Concept 1 — Rollback as a tested, rehearsed capability

The defining senior belief: **an unexercised rollback path does not exist.** Treat rollback like a backup — backups that are never restored are folklore. You verify rollback the same way: by doing it, regularly, on purpose.

**What "tested" means in practice:**

- **Retention is enforced and verified.** The previous N artifacts are pinned in the registry and protected from GC. A scheduled job actually pulls and runs the N-1 image to confirm it still starts. (Immutability and retention live in [Registries & Distribution](../05-registries-and-distribution/senior.md).)
- **The migration is provably reversible.** CI runs the N-1 code against the post-migration schema and asserts it passes. If it doesn't, the migration is destructive and the release is blocked until expand/contract is applied.
- **Game days exercise the real path.** On a schedule, in staging that mirrors production, you deploy a known-bad version and recover using only the documented procedure and tooling — measuring how long it takes and where people stumble.

```bash
# Game-day skeleton: deploy a deliberately bad version, then recover.
kubectl set image deployment/checkout app=registry/checkout:chaos-bad
kubectl rollout status deployment/checkout --timeout=120s || true
START=$(date +%s)
kubectl rollout undo deployment/checkout            # the rehearsed move
kubectl rollout status deployment/checkout
echo "rollback took $(( $(date +%s) - START ))s"    # this number is the deliverable
```

The output of a game day is not "it worked." It is a *number* (recovery time), a *list of friction points*, and *fixes* for them. Run it often enough that the muscle memory survives the panic of a real Sev-1.

---

## Core Concept 2 — Automated rollback on SLO breach

Humans are slow and stressed during incidents. The fastest, most reliable rollback is one that fires automatically when objective health signals degrade — before a human even pages. Progressive-delivery controllers make this declarative.

**Argo Rollouts** with an analysis template that auto-aborts on error-rate breach:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: checkout }
spec:
  strategy:
    canary:
      steps:
        - setWeight: 10
        - pause: { duration: 5m }
        - setWeight: 50
        - pause: { duration: 10m }
      analysis:
        templates: [{ templateName: error-rate }]
        startingStep: 1            # begin analysis at 10% weight
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata: { name: error-rate }
spec:
  metrics:
    - name: error-rate
      interval: 30s
      failureLimit: 2              # 2 bad samples → abort
      successCondition: result < 0.01
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_requests_total{job="checkout",code=~"5.."}[2m]))
            / sum(rate(http_requests_total{job="checkout"}[2m]))
```

When the canary's 5xx ratio exceeds 1% for two intervals, the rollout **auto-aborts**: traffic snaps back to the stable ReplicaSet and the new version is held at zero weight. No human, no page-to-action delay. The same applies to Flagger with its `webhooks` and metric checks.

Two design notes:

- **Auto-rollback only works if the *automated* path is safe** — i.e., no destructive migration in the rollout. Automation cannot un-drop a column. Auto-rollback is the *enforcement* of the expand/contract discipline.
- **Pick signals that move fast and matter.** Error rate and latency (golden signals) react in seconds; business KPIs are better as a slower, secondary gate. The `monitoring-alerting` skill covers choosing SLIs that make good rollback triggers.

---

## Core Concept 3 — Rollback time as an SRE metric (MTTR)

If you can't measure recovery, you can't improve it. **Rollback time is a first-class reliability metric** and a major component of MTTR (Mean Time To Recovery), one of the four DORA metrics.

Decompose the recovery clock so you can attack each segment:

```
MTTR = detect + decide + act + verify

  detect  : time from bad deploy to alert (improve: better SLIs, faster windows)
  decide  : time from alert to "roll back" decision (improve: clear authority, runbook)
  act     : time to execute the rollback (improve: kill switch > redeploy; automation)
  verify  : time to confirm health restored (improve: health checks, dashboards)
```

Track the *distribution*, not just the mean — p50 and p95 rollback times tell different stories. Set an explicit objective, e.g. "p95 rollback under 5 minutes for tier-1 services," and treat regressions against it as bugs. Auto-rollback collapses `detect + decide + act` into near-zero, which is why it's the single biggest MTTR lever you have.

A useful corollary: **the cheaper and faster rollback is, the more aggressively you can ship.** Fast recovery is what *licenses* high deploy frequency — the two DORA velocity metrics and the two stability metrics reinforce each other.

---

## Core Concept 4 — Mixed-version compatibility as a contract

At the middle level you learned N and N-1 must interoperate. At senior level you make that a *contract you can verify in CI*, not a hope.

- **API compatibility** — enforce with consumer-driven contract tests (Pact) and schema linting (e.g., `buf breaking` for protobuf, OpenAPI diff). A breaking change *fails the build*, not production.

```bash
# protobuf: fail CI if the new schema breaks the previous one
buf breaking --against '.git#branch=main'
```

- **Message/event compatibility** — register schemas in a schema registry with a compatibility policy (`BACKWARD` so new producers don't break old consumers). For a rollback you also need `FORWARD` (old producers, new consumers), so practically you want `FULL` compatibility across the rollback window.

- **Tolerant readers everywhere** — code must ignore unknown fields and supply defaults for missing optional ones. This is what lets N and N-1 share a wire format without lockstep deploys.

The senior framing: **backward compatibility is not a courtesy, it's the precondition for rollback.** Any change that breaks N↔N-1 interop has secretly converted itself into an *irreversible* release. Catch those in CI.

---

## Core Concept 5 — Idempotency and the safe-to-retry property

Rollbacks, rollouts, and automated recovery all re-run operations: a pod restarts, a migration step re-applies, a message redelivers, a reconcile loop fires again. If those operations aren't **idempotent**, the chaos of a rollback *creates* corruption.

Design for safe replay:

- **Migrations** — `ADD COLUMN IF NOT EXISTS`, guarded backfills (`WHERE col IS NULL`), upserts over inserts. A half-applied migration must be safe to re-run from the top.
- **Message handlers** — dedupe on an idempotency key so a redelivered event during version churn doesn't double-charge a customer.
- **Reconcilers** — converge to desired state regardless of current state; never assume a delta.

```sql
-- Idempotent backfill: re-running it is a no-op once complete.
UPDATE users SET name = full_name
WHERE name IS NULL AND full_name IS NOT NULL;
```

During a rollback, the system is in a *partially transitioned* state by definition — some nodes new, some old, some operations half-done. Idempotency is what makes that state recoverable rather than corrupting.

---

## Core Concept 6 — Stateful systems: when rollback is genuinely hard

Stateless services roll back trivially. The hard cases are stateful, and a senior must recognize them:

- **Databases** — handled by expand/contract; the schema is forward-only, so "rollback" means rolling back *code*, never the schema. You essentially never roll a schema backward in production.
- **Data already written in the new format** — if N wrote records the old format can't parse, you must keep a tolerant reader in N-1 or you cannot roll back. Plan the dual-format window *before* shipping N.
- **Caches and derived state** — a rollback may leave caches populated with new-format entries the old code mis-reads. Version your cache keys (`cache:v2:...`) so old and new code don't collide.
- **External side effects** — emails sent, payments captured, webhooks delivered. These *cannot* be rolled back at all. The only mitigation is to gate side-effecting code behind flags so you can stop the effect, and to design compensating actions (refund, retraction).
- **Stateful workloads (StatefulSets, leader election)** — rolling these back has ordering and quorum constraints; an in-place rollback can violate invariants. The `high-availability-patterns` skill covers safe rollback of stateful clusters.

The principle: **identify every piece of state your release touches and ask "does this come back when the code does?" If not, you have an irreversibility you must design around** — usually with flags, dual-format reads, or compensating actions.

---

## Core Concept 7 — Roll-forward culture vs rollback culture

Mature organizations make a deliberate *cultural* choice between two valid stances:

| | **Rollback culture** | **Roll-forward culture** |
|---|---|---|
| Default recovery | Return to N-1 | Fix and ship N+1 fast |
| Requires | Reliable, fast, tested rollback | Very high deploy frequency, fast pipeline, trunk-based, flags |
| Strength | Proven artifact, low risk per recovery | No "stuck on old version," small forward diffs |
| Risk | Rollback can be impossible (state) | Fixing forward under pressure can introduce new bugs |
| Fits | Lower deploy frequency, regulated, batch releases | Continuous deployment, feature-flag-heavy, elite DORA |

The highest-performing teams trend toward **roll-forward via feature flags**: they deploy continuously, gate everything behind flags, and "recover" by flipping flags (which is itself an instant rollback of *behavior* without a code rollback). The deploy and the release are decoupled — see [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/senior.md).

But this is *not* universal advice. If your pipeline takes 40 minutes, roll-forward means 40 minutes of pain; rollback is correct. The senior job is to *choose consciously* based on deploy frequency, pipeline speed, and how much of your system is flag-gated — and to invest in whichever path you've chosen so it's genuinely fast.

---

## Real-World Examples

- **Auto-abort saves the SLO.** A canary at 10% trips the error-rate analysis after 90 seconds; Argo Rollouts aborts automatically and snaps traffic back to stable. The on-call engineer wakes up to a resolved incident and a clean post-mortem timeline. `detect + decide + act` was effectively zero.
- **The game day that found the gap.** A team's quarterly game day reveals the N-1 image was garbage-collected by an aggressive registry retention policy — they literally *could not* roll back. They fix retention before it bites them in a real incident. The rollback "plan" had been fiction.
- **Irreversible side effect.** A release double-sends order-confirmation emails. Code rolls back in seconds, but the emails are gone — irreversible. Postmortem action: gate all outbound email behind a flag and add idempotency keys so redelivery during churn can't double-send.
- **Contract test catches an irreversible release.** A proto change removes a field N-1 consumers still read. `buf breaking` fails CI. The change is reworked as additive — preserving the rollback window — *before* it ever reaches production.

---

## Mental Models

- **Backups you never restore are folklore.** Same for rollback. Exercise it or you don't have it.
- **Automate the decision, not just the action.** The win from auto-rollback isn't the execution speed — it's removing the slow, stressed human from `detect → decide`.
- **Rollback is the enforcement arm of expand/contract.** Auto-rollback can only do what the migration discipline allows; the two are one system.
- **Every release pays a reversibility tax.** Either you keep the rollback window open (compat, retention, flags, dual-format) or you ship an irreversible release. Choose knowingly.
- **State is the only thing that doesn't come back for free.** Catalog it.

---

## Common Mistakes

- **A rollback runbook nobody has executed.** Game-day it or assume it's broken.
- **Auto-rollback over a destructive migration.** Automation will roll the *code* back into a schema it can't read. Auto-rollback presumes expand/contract.
- **Triggering auto-rollback on slow/noisy signals.** Use fast golden signals; business KPIs flap and cause false aborts.
- **Not measuring rollback time.** If MTTR isn't tracked with an SLO, it silently regresses.
- **Treating compatibility as etiquette.** Breaking N↔N-1 interop quietly makes the release irreversible. Gate it in CI.
- **Ignoring side effects.** Emails, payments, and webhooks don't roll back. Flag them; design compensation.
- **Choosing roll-forward culture with a 40-minute pipeline.** Roll-forward only works when forward is *fast*.

---

## Test Yourself

1. Why is an unexercised rollback path equivalent to no rollback? What does a good game day produce?
2. Write the conditions under which an Argo Rollouts canary should auto-abort, and explain why auto-rollback presumes expand/contract.
3. Decompose MTTR into its phases and name the biggest lever for each.
4. How do you enforce N↔N-1 API and message compatibility in CI rather than in production?
5. Give three kinds of state that do *not* roll back with the code and the mitigation for each.
6. When is roll-forward culture the right choice, and what does it require to be safe?

---

## Cheat Sheet

```yaml
# Auto-rollback (Argo Rollouts) — the senior default for stateless services
analysis:
  metrics:
    - name: error-rate
      failureLimit: 2
      successCondition: result < 0.01     # abort on >1% 5xx
```

```bash
buf breaking --against '.git#branch=main'   # block irreversible API changes
# schema registry: compatibility=FULL across the rollback window
# game day: deploy known-bad, recover by runbook, RECORD the recovery time
```

| Senior rule | Why |
|-------------|-----|
| Exercise rollback on a schedule | Unexercised = nonexistent. |
| Auto-rollback on golden signals | Removes the slow human from detect/decide. |
| Track MTTR with an SLO | What you don't measure regresses. |
| Enforce N↔N-1 compat in CI | Breaking it = secretly irreversible release. |
| Make everything idempotent | Rollback runs through a half-transitioned state. |
| Catalog non-reversible state | Flags, dual-format reads, compensation. |

---

## Summary

At senior level, rollback stops being a button and becomes a *verified property*. You prove it by exercising it — game days that yield a recovery time and a punch-list, not a vibe. You make it fast and reliable by automating it on objective health signals (Argo Rollouts / Flagger auto-abort on SLO breach), which collapses the slow `detect → decide → act` phases of MTTR. You keep the rollback window open by enforcing N↔N-1 compatibility in CI (contract tests, `buf breaking`, schema-registry policies) and by making every operation idempotent so a half-transitioned fleet is recoverable. The genuinely hard cases are stateful — schemas (handled by expand/contract), data in new formats, caches, and irreversible side effects like emails and payments — each requiring deliberate design (flags, dual-format reads, compensation). Finally, you choose consciously between rollback culture and roll-forward culture based on deploy frequency and pipeline speed, and you invest in whichever you pick so it is genuinely fast.

---

## Further Reading

- *Site Reliability Engineering* (Google) — MTTR, error budgets, safe releases.
- Argo Rollouts and Flagger documentation — analysis, auto-abort, canary.
- Skill: `monitoring-alerting` — choosing SLIs/SLOs that make good rollback triggers.
- Skill: `high-availability-patterns` — stateful rollback, mixed-version operation.
- Skill: `database-migration-patterns` — provably reversible schema changes.
- *Accelerate*, Forsgren/Humble/Kim — MTTR and deploy frequency as paired metrics.

---

## Related Topics

- [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/senior.md) — auto-canary, kill switches, deploy/release decoupling.
- [Registries & Distribution](../05-registries-and-distribution/senior.md) — artifact retention and immutability that make rollback possible.
- [Release Branching & Trains](../03-release-branching-and-trains/senior.md) — hotfix workflow under roll-forward.
- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/senior.md) — verifying the artifact you roll back to.
