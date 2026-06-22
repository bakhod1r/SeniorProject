# Rollback & Roll-Forward — Junior Level

> **Roadmap:** [Release Engineering](../README.md) → Rollback & Roll-Forward

*When a release goes bad, you have two exits: go back to what worked, or push a fix forward. Learn to do both calmly.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What "rollback" and "roll-forward" actually mean](#core-concept-1--what-rollback-and-roll-forward-actually-mean)
5. [Core Concept 2 — Your first rollback: `kubectl rollout undo`](#core-concept-2--your-first-rollback-kubectl-rollout-undo)
6. [Core Concept 3 — Roll back the binary, not the source](#core-concept-3--roll-back-the-binary-not-the-source)
7. [Core Concept 4 — The database does not roll back with the code](#core-concept-4--the-database-does-not-roll-back-with-the-code)
8. [Core Concept 5 — When to roll back vs roll forward](#core-concept-5--when-to-roll-back-vs-roll-forward)
9. [Core Concept 6 — The kill switch: rollback without deploying](#core-concept-6--the-kill-switch-rollback-without-deploying)
10. [Core Concept 7 — Know your last known-good version before you need it](#core-concept-7--know-your-last-known-good-version-before-you-need-it)
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

> Focus: **understanding the two recovery options and performing a safe rollback for the first time.**

Every release carries risk. Sometimes you push a change and within minutes the error rate spikes, latency climbs, or a feature is visibly broken in production. The question is no longer "was this a good change?" — it's "how do I make the bleeding stop, *now*?"

You have exactly two moves:

- **Roll back** — return to the previous known-good version. The bad change disappears.
- **Roll forward** — leave the current version running and ship a small fix on top of it.

Neither is universally correct. A junior engineer's job is to know both exist, to be able to execute a rollback under pressure without panicking, and to understand the one thing that makes rollback dangerous: **the database does not come back with you.**

This level gets you to a confident first rollback. Later tiers cover the mechanisms, the data problem in depth, and rollback as a designed capability.

---

## Prerequisites

- Basic command line and `git` (commit, tag, log).
- You have deployed *something* — a container, a service, or an app — at least once.
- Rough familiarity with Kubernetes Deployments **or** another deploy tool (the ideas transfer).
- Understanding of what an **artifact** is (a built, versioned thing: a Docker image, a JAR, a binary).
- Helpful: [Versioning & SemVer](../01-versioning-and-semver/junior.md) and [Registries & Distribution](../05-registries-and-distribution/junior.md).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Rollback** | Returning a system to a previous, known-good version. |
| **Roll-forward** | Fixing a bad release by deploying a *new* version, not by going back. |
| **Artifact** | The exact built thing you deploy (image, binary, JAR), identified by a version/digest. |
| **Known-good** | A version that was running fine in production before the bad change. |
| **Hotfix** | A small, urgent fix shipped outside the normal release cadence. |
| **Revision** | A numbered snapshot of a deployment's config that you can return to. |
| **Migration** | A script that changes the database schema (add/drop column, etc.). |
| **MTTR** | Mean Time To Recovery — how long it takes to get back to healthy. |
| **Rollout** | The process of replacing the running version with a new one, pod by pod. |

---

## Core Concept 1 — What "rollback" and "roll-forward" actually mean

Imagine you deployed version `v2.4.0` and the checkout page started returning 500 errors.

**Rollback** means: stop running `v2.4.0`, start running `v2.3.0` again — the version that worked an hour ago. The system returns to a state you *know* was healthy. You do this when the previous version is trustworthy and you want safety fast.

**Roll-forward** means: keep `v2.4.0`, find the bug, fix it, and ship `v2.4.1`. The system never goes backward. You do this when going back is impossible or risky (for example, the data already changed in a way `v2.3.0` can't read), or when the fix is genuinely tiny and fast.

```
Timeline:

  v2.3.0  ──►  v2.4.0 (broken)  ──┬──►  v2.3.0  again      = ROLLBACK
                                  │
                                  └──►  v2.4.1 (fixed)      = ROLL-FORWARD
```

The instinct for a junior should usually be: **roll back first, debug later.** Restoring service is the priority; understanding the bug can happen once users are no longer affected. Roll-forward is for when rollback isn't safe (you'll learn to spot that in Concept 4).

---

## Core Concept 2 — Your first rollback: `kubectl rollout undo`

Kubernetes keeps a history of your Deployment's revisions. Rolling back is one command.

```bash
# See the history of a deployment
kubectl rollout history deployment/checkout

# Output:
# REVISION  CHANGE-CAUSE
# 1         initial deploy v2.3.0
# 2         deploy v2.4.0   <-- the broken one (current)

# Roll back to the immediately previous revision
kubectl rollout undo deployment/checkout

# Or roll back to a specific revision number
kubectl rollout undo deployment/checkout --to-revision=1

# Watch it happen
kubectl rollout status deployment/checkout
```

That's it. Kubernetes spins up pods running the previous image and drains the broken ones. Within seconds to a couple of minutes, you're back on `v2.3.0`.

If you use **Helm**, the equivalent is:

```bash
helm history checkout          # list releases and their revisions
helm rollback checkout 1       # go back to revision 1
```

Two things to internalize:

1. **You can practice this safely.** Deploy a no-op change, then `rollout undo`. Build the muscle memory *before* the incident, not during it.
2. **Set a change-cause** so history is readable: `kubectl annotate deployment/checkout kubernetes.io/change-cause="deploy v2.4.0"` (or use `--record` in older clusters).

---

## Core Concept 3 — Roll back the binary, not the source

A classic junior mistake under pressure: "the deploy is broken, let me `git revert` the commit and rebuild." That is the *slowest* possible rollback.

```
Slow (minutes to tens of minutes, can fail):
  git revert  →  CI builds new image  →  tests  →  push to registry  →  deploy

Fast (seconds):
  re-deploy the exact previous image that you already built and tested
```

The previous artifact — say `myapp:v2.3.0` with digest `sha256:abc123…` — was already built, already tested, already proven in production. Rebuilding from source introduces a *new* artifact that has never run anywhere. A dependency could have moved, the base image could have changed, the build could fail at the worst moment.

**Rule of thumb: roll back to an artifact, not to a commit.** Pull the known-good image from the registry by its immutable tag or digest and deploy that. This is why immutable, retained artifacts in a registry matter — see [Registries & Distribution](../05-registries-and-distribution/middle.md).

---

## Core Concept 4 — The database does not roll back with the code

This is the single most important idea on this page. **Code rolls back in seconds. The database does not.**

When you roll back `v2.4.0` → `v2.3.0`, you replace the running code. But if `v2.4.0` had a database migration — say it *dropped* a column — that column is **still gone** after rollback. Now the old `v2.3.0` code starts up, tries to read the column it expects, and crashes. You rolled back the code straight into a broken database.

```sql
-- Migration shipped with v2.4.0 (DANGEROUS)
ALTER TABLE users DROP COLUMN legacy_email;   -- destructive!

-- Now you roll back to v2.3.0, whose code still does:
SELECT id, legacy_email FROM users;           -- ERROR: column does not exist
```

The takeaway for now: **a destructive migration can make rollback impossible.** This is why senior engineers insist that schema changes be *backward-compatible* — the new code and the old code must both work against the same database. You'll learn the full technique (called expand/contract) in the middle tier, and you can read the `database-migration-patterns` skill for the deep version.

For now, just remember: **if a release changed the database in a way the old code can't handle, you cannot simply roll back — you must roll forward.**

---

## Core Concept 5 — When to roll back vs roll forward

A simple decision aid for your first year:

| Situation | Do this | Why |
|-----------|---------|-----|
| Code-only change is broken, no DB change | **Roll back** | Fast, safe, reversible. |
| You're unsure what's wrong | **Roll back** | Stop the bleeding, debug calmly. |
| The bad release dropped/renamed a column | **Roll forward** | Old code can't read the new DB. |
| Fix is one line and you're confident | Either; often **roll forward** | But rollback is still safer if untested. |
| Incident is escalating fast | **Roll back** | Time pressure favors the proven version. |

The senior mantra: **"Roll back to recover, roll forward to fix."** Recovery first, root cause second.

A second thing to internalize early: **rolling back is not an admission of failure.** It's a normal, healthy operation. The best teams roll back often and without drama, precisely because they treat it as a routine safety move rather than a confession. A team that *never* rolls back is usually either lucky, not shipping much, or quietly leaving users in pain because someone is embarrassed to hit undo. Reaching for rollback quickly is a sign of operational maturity, not weakness.

---

## Core Concept 6 — The kill switch: rollback without deploying

There's a rollback so fast it doesn't involve a deploy at all: the **feature-flag kill switch.**

If the risky part of your release is wrapped in a feature flag, you can turn it *off* without touching the running code. The bad code is still installed on the servers — it's just dormant. No pods restart, no image changes, no traffic moves. The feature simply stops running.

```python
# Code shipped with a flag guard
if flags.is_enabled("new-checkout"):
    return new_checkout(cart)     # the risky new path
else:
    return old_checkout(cart)     # the proven old path
```

When `new-checkout` causes problems, you flip it off in the flag dashboard and *every* request immediately takes the old path — within seconds, globally. That is the single fastest way to recover from a bad feature.

This is why feature flags and rollback are tightly linked. Wrapping a risky change in a flag gives you an instant "undo" that doesn't depend on `kubectl` or rebuilds at all. You'll go deep on this in [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/junior.md), but the takeaway for now: **if a change is risky, putting it behind a flag buys you the cheapest possible rollback.**

Note the limit: a kill switch only works for the parts of your change that are *behind a flag*. A bad library upgrade, a broken config, or a schema change can't be flipped off — those need a real rollback or roll-forward.

---

## Core Concept 7 — Know your last known-good version before you need it

You cannot roll back to a version you can't name. The most embarrassing way to fail an incident is to decide "let's roll back" and then spend ten minutes figuring out *what to roll back to.*

Build the habit of knowing, at any moment, what the last known-good version is:

```bash
# What's running right now, and what was running before?
kubectl rollout history deployment/checkout

# REVISION  CHANGE-CAUSE
# 5         deploy v2.4.0   <-- current (suspected bad)
# 4         deploy v2.3.0   <-- last known-good  <- your target

# Confirm the exact image of the good revision
kubectl rollout history deployment/checkout --revision=4
```

Two practices that make this painless:

1. **Always set a change-cause** on every deploy so the history is human-readable, not a wall of hashes. A revision labeled `deploy v2.3.0 (release train 2026-W24)` tells you instantly what it is.
2. **Tag releases meaningfully** so the version in `rollout history` maps to a real, findable artifact in your registry. See [Versioning & SemVer](../01-versioning-and-semver/junior.md).

If you can answer "what's the last good version?" in five seconds, your rollback is five seconds from starting. If you can't, your rollback hasn't even begun — and the clock is running while users suffer.

---

## Real-World Examples

- **Bad config deploy.** A team ships a Deployment with a wrong environment variable; the service can't reach its database. They run `kubectl rollout undo deployment/api`, service recovers in 40 seconds, and they investigate the config in a branch. Textbook rollback.
- **The migration trap.** A team ships a feature that renames `full_name` → `name` in one migration, coupled with code that uses `name`. The feature has a bug. They try to roll back — and the old code crashes because `full_name` no longer exists. They're forced to roll forward under pressure. The lesson: never couple a destructive schema change to the deploy.
- **Tiny typo, roll forward.** A copy change shows "Welcom" instead of "Welcome." Nobody rolls back for that; they ship `v2.4.1` with the fix. Low risk, no data involved — roll-forward is the natural choice.

---

## Mental Models

- **The undo button vs the patch.** Rollback is `Ctrl+Z`. Roll-forward is writing a correction. `Ctrl+Z` is faster but only works if nothing downstream depends on the change you're undoing — and the database is exactly that downstream thing.
- **Roll back the elevator, not the building.** You can move the code (the elevator car) up and down easily. The database (the building) doesn't move with it. If you remodeled a floor, the old car may not stop there anymore.
- **Proven beats new.** Under fire, prefer the version that has *already* survived production over any version that hasn't — even a "fixed" one.
- **The flag is the light switch; the deploy is the wiring.** Flipping a flag is like turning off a lamp — instant, reversible. A deploy is rewiring the room. Reach for the switch before the wire cutters.
- **Stop the bleeding, then diagnose.** A paramedic applies pressure before ordering an MRI. Recovery (rollback) comes before root cause (debugging). Users feel the bleeding, not your analysis.

---

## Common Mistakes

- **Rebuilding from source to roll back.** Slow and risky; deploy the existing known-good artifact instead.
- **Forgetting the database.** Rolling back code over a destructive migration crashes the old code. Always ask "did this release change the schema?"
- **Panicking and debugging in prod first.** Recover service, *then* investigate. Users don't care about your root-cause analysis while they're seeing 500s.
- **No idea what the previous version was.** If you can't name the last known-good version, you can't roll back. Know your `rollout history`.
- **Never having practiced.** The first time you run `rollout undo` should not be during a Sev-1.

---

## Test Yourself

1. In one sentence each, define rollback and roll-forward.
2. What command rolls a Kubernetes Deployment back to its previous revision?
3. Why is "deploy the previous image" better than "`git revert` and rebuild"?
4. A release dropped a column and broke. Can you safely roll back the code? Why or why not?
5. Give two situations where you should roll back rather than roll forward.

---

## Cheat Sheet

```bash
# Kubernetes
kubectl rollout history deployment/<name>        # list revisions
kubectl rollout undo    deployment/<name>        # back one revision
kubectl rollout undo    deployment/<name> --to-revision=N
kubectl rollout status  deployment/<name>        # watch recovery

# Helm
helm history  <release>
helm rollback <release> <revision>
```

| Question to ask first | If yes |
|-----------------------|--------|
| Did this release change the database destructively? | You likely must roll **forward**. |
| Is it code-only and broken? | Roll **back** immediately. |
| Do I know the last known-good version? | If no, find it *now*. |

**Mantra:** Roll back to recover, roll forward to fix. Roll back the binary, not the source.

---

## Summary

When a release is bad you either **roll back** (return to a known-good artifact) or **roll forward** (ship a fix). Rollback is usually the fastest, safest first move — and on Kubernetes it's one command (`kubectl rollout undo`). Always roll back to the *exact previous artifact*, never by rebuilding from source. The one thing that breaks this simple picture is the **database**: code rolls back instantly, schemas do not, and a destructive migration can make rollback impossible — forcing a roll-forward. Practice rollback before you need it.

---

## Further Reading

- Kubernetes docs: *Rolling Back a Deployment* (`kubectl rollout undo`).
- Helm docs: *Helm Rollback*.
- Skill: `database-migration-patterns` — for the data side (read it early).
- Martin Fowler: *BlueGreenDeployment* and *ParallelChange* (a.k.a. expand/contract).

---

## Related Topics

- [Registries & Distribution](../05-registries-and-distribution/junior.md) — where your known-good artifacts live.
- [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/junior.md) — the fastest "rollback" of all: a kill switch.
- [Versioning & SemVer](../01-versioning-and-semver/junior.md) — naming versions so you can find the last good one.
- [Release Branching & Trains](../03-release-branching-and-trains/junior.md) — where hotfix branches come from.
