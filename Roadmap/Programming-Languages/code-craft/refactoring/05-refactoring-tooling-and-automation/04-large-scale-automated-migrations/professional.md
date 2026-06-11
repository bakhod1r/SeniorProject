# Large-Scale Automated Migrations — Professional

> **Source:** Google, "Software Engineering at Google" (Large-Scale Changes ch.); OpenRewrite docs

This file is about the real systems that run migrations at industrial scale, the economics that
decide whether a migration is worth running at all, and the governance and observability that
keep a quarter-long rollout from becoming a quarter-long outage.

---

## 1. The real systems

### 1.1 Google: LSC + Rosie + TAP

Google's "Software Engineering at Google" devotes a chapter to **Large-Scale Changes** because
its monorepo makes them routine — thousands of commits a day, billions of lines, one repo. The
machinery:

- **LSC process** — the social protocol. A change that's too big for one reviewer is registered
  as an LSC, a global approver vouches for its correctness and necessity, and it's then allowed
  to land across many owners without each owner re-litigating it.
- **Rosie** — the automation. Rosie takes the codemod's output, **shards** it (typically by
  project/build target), and drives each shard as its own change: it sends it for review to the
  local `OWNERS`, waits for green tests + approval, and **commits it automatically**. Rosie
  manages rate-limiting and retries so thousands of shards roll out without overwhelming review
  or CI.
- **TAP (Test Automation Platform)** — the safety net. TAP knows the dependency graph and runs
  exactly the tests affected by each change, so every shard gets a meaningful, scoped green
  signal instead of "run the whole world."
- **Tricorder + fixits** — the analysis/cleanup layer. Tricorder surfaces static-analysis
  findings in review; a **fixit** is a focused campaign to drive a specific finding to zero
  repo-wide, often itself run as an LSC.

The shape to internalize: a human writes and vouches for the change *once*; Rosie applies it
*thousands of times*; TAP proves each application safe; `OWNERS` approve local fit; the LSC
process is the governance that makes "land it across 180 teams" legitimate.

### 1.2 Meta: codemod + Sandcastle

Meta runs comparable infrastructure on its own monorepo. Engineers write **codemods** (Meta
open-sourced a `codemod` framework) and drive them through CI/automation pipelines built on
**Sandcastle** (its internal CI/build orchestration) to generate, test, and land many small
diffs. Same playbook — author once, shard, test per-shard, land via bots, track to completion —
on different plumbing.

### 1.3 OpenRewrite: mass recipes for Java/JVM

For teams *without* a Google-scale monorepo and bespoke bots, **OpenRewrite** is the closest
off-the-shelf equivalent for the JVM world. A **recipe** is a composable, idempotent
AST-to-AST transform (LST — Lossless Semantic Tree) that runs across a whole repo or across
*many* repos via the Moderne platform.

```yaml
# A composite recipe: do a whole framework migration in one declarative unit
type: specs.openrewrite.org/v1beta/recipe
name: com.example.SpringBoot2To3
displayName: Migrate Spring Boot 2.x -> 3.x
recipeList:
  - org.openrewrite.java.spring.boot3.UpgradeSpringBoot_3_0
  - org.openrewrite.java.migrate.jakarta.JavaxToJakarta
  - org.openrewrite.staticanalysis.CommonStaticAnalysis
```

Because recipes are idempotent by construction, you can run the same recipe to **migrate** and
re-run it in CI to **enforce** (a non-empty result fails the build). Comby fills the same niche
for **polyglot** repos with lightweight structural patterns when you don't have a full
language-aware engine per language. ts-morph / jscodeshift do it for TypeScript/JavaScript
monorepos.

> **When NOT to reach for the heavy platform:** OpenRewrite/Rosie-class tooling is overhead for
> a single-repo, single-team change. Match tool weight to blast radius — a `jscodeshift` script
> and a handful of PRs beats standing up a recipe pipeline for 80 files.

---

## 2. Cost / risk economics

A migration is an investment decision, not a moral imperative. The arithmetic:

```
Cost  = codemod authoring + rollout drive + N owners' review time
        + long-tail hand work + ongoing enforcement
Value = (maintenance saved per year + risk removed + velocity gained)
        × expected remaining lifetime of the code
```

Consequences that follow from the math:

- **Fixed cost is high, marginal cost is low.** Writing the codemod, getting it vouched, and
  standing up tracking is most of the cost; each additional shard is cheap. So migrations pay
  off when the change is *wide* (many sites) and *mechanical* (cheap per site). A narrow change
  rarely clears the fixed cost — do it by hand.
- **Reviewer-hours are the dominant variable cost.** 600 owners × 5 minutes = 50 hours of
  *other people's* time. That's real and it's why mechanical, vouch-once review matters: it
  collapses per-owner cost.
- **Lifetime gates everything.** Migrating code that's being deleted next quarter is pure cost.
  Migrate code with years of life ahead.
- **The long tail dominates the schedule.** The 95% the codemod does is fast and cheap; the last
  5% is slow, manual, and where the calendar goes. Budget for it explicitly.

---

## 3. Rollback at scale

Reverting one giant commit reverts everyone's downstream work — which is exactly why you shard.
Sharded rollback is *granular*: revert only the broken shard.

- **Per-shard revert.** Each shard is its own commit/PR, so a bad one reverts independently
  without touching the other 599. This is the single biggest operational reason to shard.
- **Roll forward when possible.** For a mechanical migration, a forward fix (fix the codemod,
  re-run the affected shard) is often safer than a revert, because the codebase is already
  partly migrated and reverting one shard re-creates a mixed state. Idempotency makes
  roll-forward cheap.
- **Compatibility shim = pressure valve.** If old and new APIs coexist (incremental rollout),
  reverting a shard just puts those sites back on the still-present old API — no build break. An
  atomic change has no such valve; that's its core risk.
- **Enforcement off-switch.** Keep the deprecation lint rule at *warn* until the rollout is
  fully complete, so a rollback doesn't trip a hard CI failure across unrelated PRs.

> **When NOT to revert:** if a shard merged days ago and others built on top, a blind revert
> creates conflicts and a mixed state. Prefer a forward fix; reserve revert for fresh, isolated
> failures.

---

## 4. Observability of the rollout

A multi-week rollout is a *running system* and needs the same observability as one. Track and
alert on:

- **Rollout % complete** — the remaining-sites counter (middle file §3), trended over time. The
  primary health metric. A flat line = stuck in the long tail.
- **Per-shard state** — merged / in-review / quarantined / opted-out, with reasons. You must be
  able to answer "which shards are red and why" instantly.
- **Quarantine rate** — fraction of files the codemod skipped. A rising rate means the codemod
  hit a class of cases it doesn't handle — investigate before pushing more shards.
- **CI failure rate of generated PRs** — if it spikes, *pause the bot* and fix the codemod. Do
  not flood reviewers with red PRs.
- **Review latency per area** — surfaces unresponsive owners early so you can escalate before
  the deadline.

```bash
# emit rollout health to your metrics system, run on a schedule
echo "lsc.remaining_sites $(grep -rcE 'getUserById\(' src/ | awk -F: '{s+=$2} END{print s+0}')"
echo "lsc.shards_quarantined $(ls quarantine/*.skipped 2>/dev/null | wc -l)"
echo "lsc.shards_merged $(grep -c '^.*|merged|' status.tsv)"
```

---

## 5. Partial-failure quarantine as a first-class feature

At scale, *some* sites will not transform — count on it. The professional stance is that
quarantine is a planned outcome, not an error:

- The codemod **skips and logs** files it can't transform; it never fails a whole shard for one
  bad file (middle file §4).
- The quarantine list is **visible** in the dashboard and **owned** — it's the seed of the long
  tail and someone is assigned to drain it.
- Quarantined sites get **triaged**: hand-migrate, delete-if-dead, or codemod-improvement (if
  the skip reveals a fixable gap, improve the codemod and re-run — idempotency makes this safe).

This converts "the migration failed on weird files" into "98% automated, 2% tracked and
assigned" — which is a finishable migration.

---

## 6. Org governance

At company scale, who is allowed to land a change across everyone's code is a governance
question:

- **Authorization** — a registered process (Google's LSC approval) gates who can run a repo-wide
  change, so not every engineer can rewrite the whole monorepo on a whim.
- **Standards for codemods** — codemods that go through the process are reviewed, tested, and
  idempotent; ad-hoc `sed` across the repo is not allowed.
- **Owner rights and the deadline** — owners get notice and short-term opt-out; the org gets a
  deadline after which the old API is removed. This balance is what keeps migrations both
  *respectful of teams* and *actually completable*.
- **A registry/dashboard of in-flight LSCs** — so teams can see what's changing under them and
  coordinate (two migrations touching the same files must not collide).

> **When NOT to formalize governance:** a 3-team startup doesn't need an LSC approval board. The
> governance weight should track the number of independent owners and the blast radius — at
> small scale, a Slack message and a shared doc are the whole process.

---

## Next

- [`interview.md`](interview.md) — the questions this whole topic gets asked as.
- [`../../04-large-scale-refactoring/01-branch-by-abstraction/junior.md`](../../04-large-scale-refactoring/01-branch-by-abstraction/junior.md)
  — the compatibility-layer technique behind incremental rollout and safe rollback.
- The *automated safety nets* sibling section (03) — the test-impact analysis a TAP-style gate
  is built on.
