# Rollback & Roll-Forward — Interview Level

> **Roadmap:** [Release Engineering](../README.md) → Rollback & Roll-Forward

*A question bank for proving you can get a system out of a bad release safely — and that you understand why the database is the part that bites.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [The Data Problem](#the-data-problem)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **articulating rollback vs roll-forward decisions, the mechanism ranking, the migration discipline, and cross-service/governance concerns under interview pressure.**

Rollback questions separate engineers who have *operated* systems from those who have only built them. Interviewers probe whether you reflexively reach for the fastest safe mechanism, whether you understand that code reverts but data doesn't, and whether you can spot an irreversible release before it ships. Answers below use **Q** / *what's really being tested* / **A** format. Lead with the decision and the trade-off; cite concrete mechanisms (`kubectl rollout undo`, kill switch, expand/contract); never hand-wave the database.

---

## Prerequisites

- Read the [junior](./junior.md), [middle](./middle.md), and [senior](./senior.md) tiers.
- Comfortable explaining expand/contract with SQL.
- Know `kubectl rollout undo`, `helm rollback`, blue-green, canary, and feature flags.

---

## Fundamentals

**Q1. What's the difference between rollback and roll-forward, and which is your default?**
*Tested: do you have a default and a reason, or do you flip a coin?*
**A.** Rollback returns the system to the previous known-good version; roll-forward ships a *new* fix on top of the broken version. My default is **roll back to recover, then roll forward to fix** — restoring service with a proven artifact is faster and lower-risk than fixing under pressure. I deviate to roll-forward when rollback is *unsafe* — chiefly when the release ran a destructive migration the old code can't survive, or there are irreversible state changes — or when the fix is genuinely trivial and the pipeline is fast.

**Q2. Rank rollback mechanisms by speed and risk.**
*Tested: do you reach for the cheapest safe option first?*
**A.** (1) **Feature-flag kill switch** — seconds, no deploy, just config; best when the change is flag-gated. (2) **Traffic shift / blue-green swap** — seconds to minutes; repoint the router at the still-warm old version. (3) **Redeploy the previous artifact** — minutes; `kubectl rollout undo` / `helm rollback` to the exact prior image. (4) **Revert commit + rebuild** — tens of minutes and risky, because it produces a *new* artifact production has never seen. I start at the top and only descend when the faster option isn't available.

**Q3. "Roll back the binary, not the source." Explain.**
*Tested: do you understand why rebuilding is the worst rollback?*
**A.** The previous artifact was already built, tested, and proven in production. Rebuilding from a reverted commit creates a brand-new artifact — dependencies may have moved, the base image may have changed, the build could even fail at the worst moment. Redeploying the known-good image by its immutable tag/digest is faster and far safer. This is exactly why immutable, retained artifacts in a registry matter: rollback *to* a binary is only possible if that binary still exists.

---

## Technique

**Q4. Walk me through rolling back a Kubernetes Deployment.**
*Tested: hands-on familiarity.*
**A.**
```bash
kubectl rollout history deployment/checkout      # find the last good revision
kubectl rollout undo    deployment/checkout      # back one revision
# or to a specific one:
kubectl rollout undo    deployment/checkout --to-revision=4
kubectl rollout status  deployment/checkout      # verify recovery
```
Kubernetes brings up pods on the previous ReplicaSet and drains the bad ones. With Helm: `helm history checkout` then `helm rollback checkout <rev>`. Crucially, before I do this I confirm the bad release didn't run a destructive migration — otherwise I'd be rolling the code back into a database it can't read.

**Q5. Design a hotfix process. Why branch from the tag, not main?**
*Tested: roll-forward as a disciplined procedure.*
**A.** Branch from the **exact release tag** in production (`git checkout -b hotfix/x v2.4.0`), make the *minimal* change, tag it (`v2.4.1`), build through an **expedited gate** (critical correctness + security checks, skipping slow low-risk stages), deploy, then **cherry-pick the fix back to main** so it isn't lost. I branch from the tag rather than `main` because `main` likely contains unreleased changes I don't want in production; branching from the tag guarantees the hotfix is *only* the in-production code plus the one fix.

**Q6. How do you make rollback automatic?**
*Tested: do you remove the slow human from the loop?*
**A.** Use a progressive-delivery controller — Argo Rollouts or Flagger — with an analysis step that watches golden signals during a canary and **auto-aborts** on breach. For example, abort if the 5xx ratio exceeds 1% for two consecutive 30-second windows; traffic snaps back to the stable version with no human action. This collapses the `detect → decide → act` phases of MTTR to near-zero. The critical caveat: auto-rollback only works if the rollout is non-destructive — automation can't un-drop a column — so it presumes expand/contract discipline.

**Q6b. How would you measure whether your rollback capability is actually good?**
*Tested: do you treat rollback as a measured property?*
**A.** I'd track rollback time as part of MTTR, broken into `detect + decide + act + verify`, and set an SLO per service tier — e.g. "p95 rollback under 5 minutes for tier-1." I'd watch the *distribution* (p50 vs p95), not just the mean, since the tail is where incidents live. And I'd validate it empirically with **game days**: deploy a deliberately bad version in a prod-like environment and recover by the runbook, recording the actual recovery time and friction points. The deliverable of a game day is a number and a punch-list, not "it worked." A capability you don't measure silently regresses.

---

## The Data Problem

**Q7. Why is the database "the hard part" of rollback?**
*Tested: the single most important concept on this topic.*
**A.** Code rolls back in seconds; schemas don't. A migration is a one-way door by default. If a release dropped or renamed a column and you roll the code back, the old code starts up, queries the column that's now gone, and crashes — you've rolled back *into* a broken database. So rollback safety isn't a code property; it's a *schema* property. The fix is to make every schema change backward-compatible so old and new code both work against every intermediate schema.

**Q8. Explain expand/contract with concrete SQL.**
*Tested: can you actually do the migration discipline, not just name it?*
**A.** Also called parallel change. To rename `full_name` → `name` safely:
```sql
-- Release 1: EXPAND (additive, idempotent, old code untouched)
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
UPDATE users SET name = full_name WHERE name IS NULL;   -- batched backfill
-- keep both in sync via trigger or app-level dual-write during transition

-- Release 2: switch code to read/write `name`; full_name still present & synced
--   -> rollback to Release-1 code is SAFE: full_name is still there.

-- Release 3: CONTRACT (only after Release 2 is proven stable)
ALTER TABLE users DROP COLUMN full_name;
```
At every step the previous version of the code still runs, so rollback is preserved. The destructive step (`DROP`) is deferred to a *separate, later* release and is never coupled to the deploy that uses the new column.

**Q9. Why must you never couple a schema change to the deploy that uses it?**
*Tested: the most common way teams destroy their own rollback path.*
**A.** Coupling makes the deploy atomic in the wrong way: you can't undo the code without undoing the schema, and you can't undo the schema because it deleted data. An *unrelated* bug in that same deploy then forces a rollback you can't perform. Decoupling means: run additive (expand) migrations as a separate step *before* the code, ship code tolerant of both schemas, and run destructive (contract) migrations as a *later* release outside the rollback window — every migration idempotent so a re-run during a chaotic rollout can't corrupt data.

**Q10. A rollout runs a mixed-version fleet. What must N and N-1 agree on?**
*Tested: compatibility window awareness.*
**A.** During any rollout *or* rollback, some pods run N and some N-1 against the same database and queue, so they must interoperate on: **schema** (guaranteed by expand/contract), **API/contract** (don't remove a field N-1 sends or require one it doesn't), and **message/event schema** (a N-1 consumer must parse N's messages — additive, versioned schemas, tolerant readers). I enforce this in CI with contract tests (Pact), schema-registry compatibility policies (FULL across the rollback window), and breaking-change linters like `buf breaking`. Breaking N↔N-1 compatibility silently converts the release into an *irreversible* one.

---

## Scenarios

**Q11. You deploy v2.4.0; checkout 5xx spikes to 30%. No DB change. What do you do?**
*Tested: incident reflexes.*
**A.** Recover first. If checkout's new path is behind a flag, flip the kill switch — done in seconds, no deploy. Otherwise `kubectl rollout undo deployment/checkout` to the previous revision and `rollout status` to confirm 5xx returns to baseline. *Then* investigate in a branch. I don't debug in production while users are getting errors.

**Q12. Same spike, but this release dropped a column. Now what?**
*Tested: recognizing an irreversible release.*
**A.** I can't safely roll back — the old code needs the dropped column. So I **roll forward**: hotfix branch from the v2.4.0 tag, minimal fix, expedited gate, deploy v2.4.1, cherry-pick back to main. The postmortem action item is structural: that destructive migration should never have been coupled to the deploy. It should have been expand/contract so rollback stayed available.

**Q13. A feature spans three services that must all change together. How do you keep it reversible?**
*Tested: distributed rollback.*
**A.** I avoid a lockstep release — that has no clean rollback point. Instead I make every interface N↔N-1 compatible (additive contracts, tolerant readers), deploy all three services *dark* in any order, then *release* the cross-cutting behavior with a single feature flag. That flag flip is also an atomic, instant, coordinated **rollback** point across all three services — no code reverts needed. For any committed side effects across services, I design compensating transactions (a saga) up front, because distributed rollback *is* the compensations.

**Q14. Your rollback runbook has never been run. Why is that a problem?**
*Tested: rollback as a tested capability.*
**A.** An unexercised rollback path is a hope, not a plan — it's like a backup you've never restored. The first time you run it shouldn't be during a Sev-1. I run **game days**: deploy a deliberately bad version in a production-like environment and recover using only the documented procedure, measuring the recovery time and recording friction points. Game days routinely surface real gaps — e.g., the N-1 artifact was garbage-collected by retention policy, so rollback was literally impossible.

**Q14b. A release sent duplicate confirmation emails. You roll back the code in seconds — is the incident over?**
*Tested: do you recognize irreversible side effects?*
**A.** No. Code rolls back, but the emails are already sent — that's an irreversible side effect; rollback can't un-send them. Recovery has two parts: stop the bleeding (roll back or flag off the email path so no *more* duplicates go out) and then handle the committed effect (a compensating action — e.g., an apology/correction email, or suppressing the duplicate downstream). The structural postmortem fix is to gate side-effecting operations (email, payments, webhooks) behind flags so they can be stopped instantly, and add idempotency keys so a redelivery during version churn can't double-fire in the first place.

**Q14c. During a rollout you see intermittent, non-deterministic request failures. What's your hypothesis?**
*Tested: mixed-version-fleet intuition.*
**A.** My first hypothesis is a broken mixed-version (N / N-1) window. During a rollout, requests hit a fleet that's part new, part old; if the two versions don't interoperate — an incompatible API change, a message-schema change, or a non-backward-compatible migration — failures appear *non-deterministically* depending on which pod served the request. The same failure mode hits a *rollback*, since that's also a mixed-version transition. The fix and prevention is N↔N-1 compatibility enforced in CI (contract tests, `buf breaking`, schema-registry FULL policy) plus tolerant readers.

**Q15. The org argues rollback vs roll-forward culture. What's your take?**
*Tested: judgment over dogma.*
**A.** It's not one company-wide answer; it's a per-workload decision under org policy. Roll-forward suits high deploy frequency, fast pipelines, and heavy flag coverage — you recover by flipping a flag or shipping a tiny diff. Rollback suits slower pipelines, stateful or regulated systems where the most *proven* recovery (a known-good artifact) wins. Tier-1 revenue services might get blue-green + auto-rollback; a batch job is fine with a slow `rollout undo`. The cheapest fast recovery is often a fast pipeline plus pervasive flags rather than double infrastructure.

**Q15b. Fast rollback isn't free. What does it cost, and how do you decide how much to buy?**
*Tested: the economics of reversibility.*
**A.** Blue-green buys near-instant cutover both ways but roughly doubles capacity during the window. Warm standby (keeping the prior version running) avoids cold starts but pays idle compute. Artifact retention costs registry storage and policy management. Feature-flag platforms are cheap at runtime but carry flag debt. So the trade-off is rollback speed vs steady-state cost, and I right-size it per workload tier — blue-green and warm standby for tier-1 revenue services, plain rolling deploys for internal tools and batch jobs. A subtle lever: a *fast pipeline* reduces the cost of rollback, because cheap, fast roll-forward means you can carry less warm standby. Often the cheapest fast recovery is pipeline speed plus flags, not double infrastructure.

**Q15c. Who should be allowed to roll back, and why does it matter?**
*Tested: governance as part of the mechanism.*
**A.** During an incident the **incident commander** owns the rollback/roll-forward call — not a committee or a Slack debate. On-call engineers should be *pre-authorized* to roll back and flip kill switches within their service's blast radius with no approval ticket; recovery speed dies in approval chains. Higher-blast-radius actions (a global flag affecting all customers) can require higher authority. Emergency bypasses of normal gates are allowed as **break-glass** but are logged, attributed, and reviewed afterward. The principle: make the safe action the fast action. If your policy forces a debate before you can roll back, the policy *is* the outage.

---

## Rapid-Fire

**Q16.** Fastest possible rollback? **A.** Feature-flag kill switch — config change, no deploy, seconds.

**Q17.** Command to roll a Deployment back two revisions? **A.** `kubectl rollout undo deployment/x --to-revision=<n>` (or `rollout undo` for one back).

**Q18.** Why not `git revert` + rebuild as your first move? **A.** Slowest path, and it ships an untested *new* artifact. Roll back to the existing one.

**Q19.** What makes a migration safe for rollback? **A.** Forward-only, additive, idempotent, backward-compatible (expand/contract); destructive steps deferred.

**Q20.** What's an irreversible release? **A.** One you can't roll back — destructive migration, broken N↔N-1 compat, uncompensated side effects, new-format data with no tolerant reader, or a GC'd prior artifact.

**Q21.** Where does rollback time show up in DORA? **A.** As a major component of MTTR (Time to Restore Service).

**Q22.** Side effects that can't be rolled back? **A.** Sent emails, captured payments, delivered webhooks — mitigate with flags and compensating transactions.

**Q23.** Schema-registry policy for a safe rollback window? **A.** FULL compatibility (both BACKWARD and FORWARD) so old and new producers/consumers interoperate.

**Q24.** Who decides rollback during an incident? **A.** The incident commander, with on-call pre-authorized to roll back within their service's blast radius — no approval chain.

**Q25.** Cost of blue-green? **A.** Roughly double capacity during the window, in exchange for near-instant cutover both ways.

**Q26.** Why must expand migrations be idempotent? **A.** A rollback runs through a half-transitioned, mixed-version fleet; a re-applied step must be a safe no-op (`ADD COLUMN IF NOT EXISTS`, guarded backfills).

**Q27.** What's a "tolerant reader"? **A.** Code that ignores unknown fields and supplies defaults for missing optional ones — it's what lets N and N-1 share a wire format without lockstep deploys.

**Q28.** Cleanest distributed rollback primitive? **A.** Deploy/release decoupling: deploy all services dark (backward-compatible), then one feature-flag flip releases — and atomically rolls back — the cross-cutting behavior.

**Q29.** How do you isolate an irreversible change like a column drop? **A.** Sequence it via expand/contract so the only one-way step (the `DROP`) is a single, late, well-understood release with nothing risky riding on it.

**Q30.** First question to ask before any rollback? **A.** "Did this release run a destructive migration?" — if yes, rollback is unsafe and you roll forward.

---

## Red Flags / Green Flags

**Red flags (in a candidate):**
- Defaults to `git revert` + rebuild as the rollback mechanism.
- Treats rollback as trivial and never mentions the database.
- Couples destructive migrations to the deploy; doesn't know expand/contract.
- Thinks code rollback automatically reverts data.
- Branches hotfixes from `main`; forgets to cherry-pick back.
- Has a rollback runbook but has never exercised it.
- One dogmatic answer ("always roll forward") regardless of statefulness or pipeline speed.

**Green flags:**
- Reaches for the kill switch first, rebuild last.
- Immediately raises the data problem and explains expand/contract in SQL.
- Names the irreversible-release anti-pattern and how to isolate/defer the one-way door.
- Talks about N↔N-1 compatibility enforced in CI.
- Knows rollback must be game-dayed and auto-fired on SLO breach.
- Discusses cost trade-offs and per-workload strategy, not dogma.
- Mentions governance: who's authorized to roll back, and that the safe action must be the fast one.

---

## Cheat Sheet

```bash
# Recovery ladder (fastest → slowest)
flag off                                  # kill switch, no deploy
kubectl patch svc app -p '{...blue...}'   # blue-green / traffic swap
kubectl rollout undo deploy/app           # redeploy previous artifact
helm rollback app <rev>
git revert + rebuild                      # last resort (= roll forward)

# Expand/contract
ADD COLUMN IF NOT EXISTS ...   # expand (additive, idempotent)
backfill batched; dual-write   # transition; rollback stays safe
DROP COLUMN ...                # contract — LATER release only

# Hotfix (roll-forward)
git checkout -b hotfix/x <release-tag>  # from the TAG, not main
# minimal fix → tag → expedited gate → deploy → cherry-pick to main
```

| One-liner | |
|-----------|---|
| Roll back to recover, roll forward to fix | The default doctrine. |
| Roll back the binary, not the source | Proven artifact, seconds. |
| Code reverts, data doesn't | The whole reason rollback is hard. |
| Don't couple schema change to its deploy | Keeps the rollback door open. |
| Unexercised rollback = no rollback | Game-day it. |
| Breaking N↔N-1 = irreversible release | Enforce compat in CI. |

---

## Summary

Interviewers want to hear a *default* — roll back to recover, roll forward to fix — backed by the mechanism ranking (kill switch > traffic shift > redeploy artifact > rebuild) and the discipline of rolling back the *binary*, not the source. The decisive signal is the **data problem**: code reverts in seconds, schemas don't, a destructive migration makes rollback impossible, and **expand/contract** (with real SQL) is what keeps the rollback door open. From there, demonstrate maturity: hotfix from the release tag through an expedited gate, auto-rollback on SLO breach via Argo Rollouts/Flagger, N↔N-1 compatibility enforced in CI, rollback exercised through game days, distributed rollback via flag flips and sagas, and a per-workload strategy with clear decision authority. Avoid the red flags — especially "rebuild to roll back" and forgetting the database — and the rest follows.

---

## Further Reading

- Martin Fowler: *ParallelChange* (expand/contract), *BlueGreenDeployment*.
- *Site Reliability Engineering* (Google) — MTTR, safe rollouts, incident command.
- Argo Rollouts / Flagger docs — analysis and auto-abort.
- Skill: `database-migration-patterns` — the data side in depth.
- Skill: `monitoring-alerting` — SLIs that make good rollback triggers.
- *Accelerate* — MTTR and deploy frequency as paired metrics.

---

## Related Topics

- [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/interview.md) — kill switch, canary, deploy/release decoupling.
- [Registries & Distribution](../05-registries-and-distribution/interview.md) — the artifact you roll back to.
- [Release Branching & Trains](../03-release-branching-and-trains/interview.md) — hotfix branches and tags.
- [Versioning & SemVer](../01-versioning-and-semver/interview.md) — version identity for N and N-1.
