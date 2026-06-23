# Rollback & Roll-Forward — Middle Level

> **Roadmap:** [Release Engineering](../README.md) → Rollback & Roll-Forward

*Recovery has a toolbox. Know each mechanism's speed and risk, treat the database as the hard part, and turn hotfixes into a procedure rather than a scramble.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Rollback mechanisms ranked by speed and risk](#core-concept-1--rollback-mechanisms-ranked-by-speed-and-risk)
5. [Core Concept 2 — The data problem and expand/contract migrations](#core-concept-2--the-data-problem-and-expandcontract-migrations)
6. [Core Concept 3 — Never couple a schema change to the deploy that uses it](#core-concept-3--never-couple-a-schema-change-to-the-deploy-that-uses-it)
7. [Core Concept 4 — Hotfix policy: roll-forward as a procedure](#core-concept-4--hotfix-policy-roll-forward-as-a-procedure)
8. [Core Concept 5 — The rollback decision tree](#core-concept-5--the-rollback-decision-tree)
9. [Core Concept 6 — Mixed-version fleets: N and N-1 must interoperate](#core-concept-6--mixed-version-fleets-n-and-n-1-must-interoperate)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **the full recovery toolbox, the migration discipline that makes rollback safe, and a repeatable hotfix process.**

At the junior level you learned the two exits — roll back, roll forward — and ran your first `kubectl rollout undo`. At this level you stop treating rollback as one button and start treating it as a *ranked set of mechanisms*, each with a different recovery time and blast radius. You also confront the genuinely hard part: the database. Code is reversible; schema changes are mostly not, unless you design them to be. The technique that makes rollback safe is **expand/contract** (a.k.a. parallel change), and you must understand it concretely, in SQL, not as a slogan.

---

## Prerequisites

- Comfortable with `kubectl rollout` and/or `helm rollback` (see [junior](./junior.md)).
- You write or review database migrations (Flyway, Liquibase, Alembic, golang-migrate, Rails, etc.).
- Understanding of immutable artifacts and registries — [Registries & Distribution](../05-registries-and-distribution/middle.md).
- Familiarity with feature flags — [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/junior.md).
- Basic SQL DDL (`ALTER TABLE`, `ADD COLUMN`, `DROP COLUMN`).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Kill switch** | A feature flag that disables a feature instantly without a deploy. |
| **Blue-green** | Two identical environments; you swap traffic from old (blue) to new (green) and back. |
| **Traffic shift** | Moving a percentage of requests between versions (load balancer / mesh). |
| **Expand/contract** | Migration pattern: add the new schema (expand), migrate, then later remove the old (contract). |
| **Parallel change** | Fowler's name for expand/contract — old and new coexist. |
| **Destructive migration** | A schema change that removes information the old code needs (drop/rename column). |
| **Backward-compatible** | New schema/API that old code can still operate against. |
| **Hotfix** | A minimal urgent fix branched from a release tag and shipped via an expedited gate. |
| **Cherry-pick** | Applying a specific commit onto another branch (e.g., hotfix back to `main`). |
| **N / N-1** | The current version and the immediately previous one. |

---

## Core Concept 1 — Rollback mechanisms ranked by speed and risk

Not all rollbacks are equal. Rank them from fastest/safest to slowest/riskiest and *reach for the top of the list first*:

| # | Mechanism | Recovery time | Notes |
|---|-----------|---------------|-------|
| 1 | **Feature-flag kill switch** | Seconds, **no deploy** | Best when the bad change is behind a flag. Config change only. |
| 2 | **Traffic shift / blue-green swap** | Seconds–minutes | Point the LB/mesh back at the old version that's still running warm. |
| 3 | **Redeploy previous artifact** | Minutes | `rollout undo` / `helm rollback` to the *exact* prior image. |
| 4 | **Revert commit + rebuild** | Tens of minutes, **risky** | New, untested artifact. Last resort. |

**1 — Kill switch.** If the broken feature is behind a flag, you don't roll back anything; you flip the flag off. No pods restart, no traffic moves. This is why progressive delivery and rollback are deeply linked — see [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/middle.md).

```bash
# Conceptual: flip a flag off (LaunchDarkly/Unleash/OpenFeature backend)
curl -X PATCH https://flags.internal/api/flags/new-checkout \
  -d '{"enabled": false}'
# Effect is global within seconds. No deployment occurred.
```

**2 — Traffic shift / blue-green.** If you deployed green alongside still-running blue, recovery is just repointing the router.

```bash
# Blue-green via a Kubernetes Service selector swap
kubectl patch service checkout -p \
  '{"spec":{"selector":{"version":"blue"}}}'   # instant cutback to blue
```

**3 — Redeploy previous artifact.** The workhorse. Deploy the known-good image by tag/digest:

```bash
kubectl rollout undo deployment/checkout --to-revision=4
helm rollback checkout 7        # to a specific Helm revision
```

**4 — Revert + rebuild.** Only when no prior artifact exists or the fix genuinely belongs in source and you've decided to roll *forward*. It is the slowest and the only one that ships something production has never seen.

> **The mantra: roll back the *binary*, not the *source*.** Mechanisms 1–3 reuse proven artifacts/state. Mechanism 4 builds a new one — that's roll-forward in disguise.

---

## Core Concept 2 — The data problem and expand/contract migrations

Code rolls back in seconds. **Databases do not.** A schema migration is, by default, a one-way door — and if it removed something the old code reads, rolling the code back lands it in a database it cannot operate. This is *the* reason rollbacks fail.

The fix is to make every schema change **backward-compatible** so that *both* the old and new code work against *every* intermediate schema. The pattern is **expand/contract** (Fowler calls it **parallel change**). Instead of one destructive step, you split a change into reversible phases spread across multiple releases.

### Worked example: renaming `full_name` → `name`

**The wrong way (one destructive migration, coupled to the deploy):**

```sql
-- Ships with the feature deploy. Now rollback is impossible.
ALTER TABLE users RENAME COLUMN full_name TO name;
```

**The right way — expand/contract across releases:**

```sql
-- Release 1: EXPAND. Add the new column. Old code untouched.
ALTER TABLE users ADD COLUMN name TEXT;

-- Backfill existing rows (batched, online).
UPDATE users SET name = full_name WHERE name IS NULL;

-- Keep both in sync during the transition (trigger or dual-write in app code).
CREATE OR REPLACE FUNCTION sync_name() RETURNS trigger AS $$
BEGIN
  NEW.name := COALESCE(NEW.name, NEW.full_name);
  NEW.full_name := COALESCE(NEW.full_name, NEW.name);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_sync_name BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION sync_name();
```

```text
Release 2: MIGRATE CODE. Application reads/writes `name`.
           Old `full_name` still present and in sync.
           --> Rollback to Release-1 code is SAFE: it reads full_name, still there.

Release 3: CONTRACT. Only after Release 2 is proven stable, drop the old column.
```

```sql
-- Release 3: CONTRACT. Now, and only now, it is safe.
DROP TRIGGER trg_sync_name ON users;
ALTER TABLE users DROP COLUMN full_name;
```

At every step, the previous version of the code can still run. **Rollback is preserved because the schema is forward-only and backward-compatible.** The `database-migration-patterns` skill covers backfill batching, dual-writes, and contract timing in depth.

---

## Core Concept 3 — Never couple a schema change to the deploy that uses it

The most common way teams destroy their own rollback path is to bundle a schema change *into the same deploy* as the code that depends on it. Now the deploy is atomic in the wrong way: you can't undo the code without undoing the schema, and you can't undo the schema because it deleted data.

**Decouple migrations from deploys:**

- Run **expand** migrations *before* the code that needs them, as a separate, idempotent step.
- Ship code that works against **both** the old and new schema (tolerant reader).
- Run **contract** migrations *after* the new code is stable, as a *later* release — never in the rollback window.

```yaml
# Pipeline ordering (conceptual)
stages:
  - migrate-expand     # additive only; safe to re-run; safe under old code
  - deploy-code        # rollback-able on its own
  - soak               # bake time; watch SLOs
  - migrate-contract   # destructive; gated behind "previous release is permanent"
```

A migration in the expand phase must be **idempotent** (`ADD COLUMN IF NOT EXISTS`, guarded backfills) so re-running it during a chaotic rollout never corrupts state.

---

## Core Concept 4 — Hotfix policy: roll-forward as a procedure

When you *must* roll forward (a destructive change shipped, or only a small fix is appropriate), do it as a disciplined procedure, not a hero scramble. A hotfix is roll-forward formalized.

**The standard hotfix flow:**

```bash
# 1. Branch from the EXACT release tag that's in production — not from main.
git checkout -b hotfix/checkout-500 v2.4.0

# 2. Make the MINIMAL change. One bug. No refactors, no extras.
#    (edit, test the specific path)

# 3. Tag and build the hotfix artifact.
git commit -am "fix: null guard in checkout total"
git tag v2.4.1
#    CI builds v2.4.1 from this tag through an EXPEDITED gate
#    (critical tests + security scan, not the full multi-hour suite).

# 4. Deploy v2.4.1 (this is the roll-forward).

# 5. Merge the fix BACK to main so it isn't lost on the next release.
git checkout main
git cherry-pick <hotfix-commit-sha>
```

Why branch from the **tag** and not `main`? Because `main` may already contain unreleased changes you do *not* want in production. Branching from the release tag guarantees the hotfix contains *only* the in-production code plus your one fix. See [Release Branching & Trains](../03-release-branching-and-trains/middle.md) for how release branches and tags support this.

The **expedited gate** is a deliberately narrowed quality gate: you still run the critical correctness and security checks, but you skip the slow, low-risk parts so recovery isn't blocked for an hour. Never skip *all* gates — an unverified hotfix can make the incident worse.

---

## Core Concept 5 — The rollback decision tree

```
Incident: current release is bad.
│
├─ Is the bad change behind a feature flag?
│     └─ YES → flip the kill switch (seconds). DONE.
│
├─ Did this release run a DESTRUCTIVE migration?
│     ├─ YES → you CANNOT safely roll back the code.
│     │         → ROLL FORWARD (hotfix). 
│     └─ NO  → continue.
│
├─ Is a known-good previous artifact available & warm (blue-green)?
│     └─ YES → traffic shift / blue-green swap (seconds). DONE.
│
├─ Is a known-good previous artifact in the registry?
│     └─ YES → redeploy it (rollout undo / helm rollback). DONE.
│
└─ None of the above → revert + rebuild (slow) OR roll forward.
```

The tree is ordered by speed and safety. You only descend when the faster option isn't available.

---

## Core Concept 6 — Mixed-version fleets: N and N-1 must interoperate

During any rollout *or* rollback, you transiently run **two versions at once**: some pods on N, some on N-1. If those two versions can't coexist, your rollback (and your rollout) will break mid-flight.

Concretely, N and N-1 must agree on:

- **Database schema** — guaranteed by expand/contract (both versions tolerate the same schema).
- **API/contract compatibility** — N-1 must accept requests/responses produced by N and vice versa. Don't remove a field N-1 still sends; don't require a field N-1 doesn't send.
- **Message/event schema** — a consumer on N-1 must still parse messages produced by N (use additive, versioned schemas; tolerant readers).

```text
Rolling rollback in progress:
  [pod: N-1] [pod: N-1] [pod: N]  ← all hitting the same DB and queue
  Every pair must interoperate, or requests fail non-deterministically.
```

The practical rule: **every release must be compatible with the one immediately before it.** This compatibility window is what *makes* rollback safe — without it, a rollback is just a different way to cause an outage. The `high-availability-patterns` skill discusses designing for mixed-version operation.

---

## Real-World Examples

- **Flag save.** A new recommendation engine tanks conversion. Because it shipped behind a flag at 10% rollout, the team flips it off in 5 seconds — no deploy, no rollback. The bad code is still on the boxes, just dormant.
- **Expand/contract pays off.** A team renames a column via expand/contract over three releases. A bug surfaces in the release that switched reads to the new column. They roll the code back one revision; because the old column is still present and synced, the old code runs perfectly. Rollback worked *because* the migration was non-destructive.
- **Coupled migration disaster.** A team drops `legacy_token` in the same deploy that stops using it. A separate, unrelated bug in that deploy forces a rollback — but the old code authenticates against `legacy_token`, now gone. They can't roll back and must scramble a hotfix while logins fail. The root cause wasn't the bug; it was *coupling a destructive migration to the deploy.*

---

## Mental Models

- **Recovery ladder.** Kill switch → traffic shift → redeploy artifact → rebuild. Always start at the top rung.
- **Two doors, one of them locked.** Rollback and roll-forward are both doors out. A destructive migration *locks the rollback door*; expand/contract keeps it open.
- **Both engines must run on the same fuel.** N and N-1 share one database and one queue. If they can't both run on that shared state, you can't safely transition between them in either direction.
- **A hotfix is a scalpel, not a Swiss Army knife.** One change, from the tag, through a narrowed gate, cherry-picked back.

---

## Common Mistakes

- **Reaching for `rollout undo` when a kill switch would do.** If it's behind a flag, flip the flag — it's faster and touches nothing.
- **Destructive migrations in the release window.** `DROP`/`RENAME` belongs in a *later* contract release, never coupled to the feature deploy.
- **Branching the hotfix from `main`.** You'll smuggle unreleased changes into production. Branch from the release tag.
- **Forgetting to cherry-pick back.** The next release re-introduces the bug you just hotfixed.
- **Assuming versions interoperate.** Removing an API field or changing a message schema breaks the mixed-version window during rollout *and* rollback.
- **Non-idempotent expand migrations.** A re-run during a messy rollout corrupts data; guard everything with `IF NOT EXISTS`.

---

## Test Yourself

1. Rank the four rollback mechanisms by speed and explain why a kill switch beats a redeploy.
2. Write the three phases of an expand/contract rename and explain why rollback is safe at each.
3. Why must you never couple a destructive migration to the deploy that uses it?
4. A release dropped a column and is now broken. Walk through your recovery.
5. Why must N and N-1 interoperate, and name three things they must agree on.
6. Outline the hotfix procedure, including why you branch from the tag and cherry-pick back.

---

## Cheat Sheet

```bash
# Recovery ladder (fastest first)
flag off                                   # kill switch — no deploy
kubectl patch svc app -p '{...blue...}'    # blue-green / traffic swap
kubectl rollout undo deploy/app            # redeploy previous artifact
helm rollback app <rev>
git revert + rebuild                       # last resort (= roll forward)

# Expand/contract
ADD COLUMN IF NOT EXISTS ...               # expand (additive, idempotent)
backfill in batches; dual-write/sync       # transition
DROP COLUMN ...                            # contract — LATER release only

# Hotfix
git checkout -b hotfix/x <release-tag>     # from the TAG
# minimal change → tag → expedited gate → deploy
git cherry-pick <sha>                      # back to main
```

| Rule | Why |
|------|-----|
| Roll back the binary, not the source | Proven artifact, seconds not minutes. |
| Migrations forward-only & backward-compatible | Keeps the rollback door open. |
| Decouple schema change from its deploy | Code stays independently rollback-able. |
| N must be compatible with N-1 | Mixed-version fleet during rollout/rollback. |

---

## Summary

Rollback is a *ranked toolbox*: kill switch, traffic shift/blue-green, redeploy the previous artifact, and — last and riskiest — revert and rebuild. Reach for the top of the ladder first, and always roll back to a proven binary rather than rebuilding from source. The hard part is data: code reverts in seconds, schemas don't, and a destructive migration can lock the rollback door entirely. The discipline that keeps it open is **expand/contract** — additive, idempotent, backward-compatible migrations spread across releases, with destructive steps deferred to a later contract phase and never coupled to the deploy that uses them. When rollback isn't safe, roll forward via a disciplined hotfix from the release tag through an expedited gate, cherry-picked back to main. Throughout, N and N-1 must interoperate, because every rollout and rollback runs a mixed-version fleet.

---

## Further Reading

- Martin Fowler: *ParallelChange* (expand/contract) and *BlueGreenDeployment*.
- Skill: `database-migration-patterns` — backfills, dual-writes, contract timing.
- Skill: `high-availability-patterns` — mixed-version operation, compatibility.
- *Database Reliability Engineering*, Campbell & Majors — schema change under load.
- Kubernetes & Helm rollback documentation.

---

## Related Topics

- [Feature Flags & Progressive Delivery](../06-feature-flags-and-progressive-delivery/middle.md) — the kill switch and canary that pair with rollback.
- [Registries & Distribution](../05-registries-and-distribution/middle.md) — immutable artifacts you roll back to.
- [Release Branching & Trains](../03-release-branching-and-trains/middle.md) — release tags and hotfix branches.
- [Versioning & SemVer](../01-versioning-and-semver/middle.md) — version identity for N and N-1.
