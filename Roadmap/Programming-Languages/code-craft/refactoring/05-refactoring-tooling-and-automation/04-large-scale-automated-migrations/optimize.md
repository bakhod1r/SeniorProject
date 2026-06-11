# Large-Scale Automated Migrations — Optimize

> **Source:** Google, "Software Engineering at Google" (Large-Scale Changes ch.); OpenRewrite docs

Each item is a "before" migration *plan*. Your job is to redesign it into a sharded, automated,
trackable rollout — **or argue it's small enough to skip the machinery entirely.** The skill is
matching the process weight to the change. Try each before reading the "after."

---

## 1. "We'll run sed across the repo over the weekend"

**Before:** "The change is mechanical — replace `assert(x)` with `assertThat(x).isTrue()` in
12,000 files. We'll `find | sed` it on Saturday and push one commit Monday."

<details><summary>After</summary>

`sed` is line-based and not idempotent or syntax-aware; one commit is unreviewable across
12,000 files. Redesign:

- **Codemod, not sed:** an AST transform (jscodeshift/OpenRewrite) that's syntax-aware and
  idempotent (skip calls already in `assertThat` form).
- **Dry-run** to get true scope + quarantine candidates.
- **Shard by owner**, one PR per team, bot-driven, scoped CI, auto-merge on green.
- **Track** remaining `assert(` count to zero; **enforce** with a lint rule, then delete the old
  helper.

12,000 files across many owners is squarely LSC territory — keep the machinery, drop the `sed`.
</details>

---

## 2. "One PR, but we'll tag all the owners"

**Before:** "We sharded the *thinking* but we'll still land it as one PR and add all 200
`CODEOWNERS` as reviewers so everyone signs off."

<details><summary>After</summary>

One PR with 200 reviewers is *worse* than no sharding — it needs 200 approvals on one diff,
conflicts against 200 teams' concurrent commits, and reverts everyone at once on failure.

- **One PR per owner**, not one PR with many owners. Each team reviews only their files.
- A **bot** opens and drives the 200 PRs; review parallelizes instead of serializing on one
  diff.
- Per-shard revert replaces all-or-nothing rollback.

"Tag everyone on one PR" is the giant-PR antipattern with extra steps.
</details>

---

## 3. "Migrate everything, then figure out enforcement later"

**Before:** "Phase 1: codemod all 5,000 sites off the deprecated `EventBus`. Phase 2 (someday):
maybe add a lint rule."

<details><summary>After</summary>

"Someday" enforcement = guaranteed regression. Without it, reintroductions silently push you
back above zero (find-bug §4). Redesign enforcement *into* the rollout:

- **Warn**-level lint rule from day one of the rollout (nudges, blocks nothing).
- Flip to **error** the moment remaining-sites hits zero.
- **Delete `EventBus`** so the compiler enforces it for free — the strongest enforcement.

Enforcement isn't a follow-up; it's the step that makes "done" stay done. Stage it from the
start.
</details>

---

## 4. "Big atomic submit at 2 a.m. to avoid conflicts"

**Before:** "To dodge merge conflicts we'll freeze the repo, run the codemod on everything, and
land one atomic submit during the low-traffic window."

<details><summary>After</summary>

Freezing the repo and one atomic submit forfeits sharding, parallel review, per-shard rollback,
and any pressure valve — and a freeze blocks the whole org. The conflict fear is the wrong
problem to solve this way.

- Ask first: **can a compatibility shim make this incremental?** Almost always yes — introduce
  the new API alongside the old, migrate sites in independent shards, delete the old API last
  (expand-migrate-contract). Conflicts disappear because small shards land in minutes.
- Reserve atomic submits for genuinely indivisible changes where *no* shim can exist — and even
  then, no repo freeze.

The instinct "make it atomic to avoid conflicts" is backwards: incremental + shims is how you
avoid conflicts.
</details>

---

## 5. "Just migrate the 30 files in our service"

**Before:** "We want to standardize logging. Step 1: build a codemod framework, a sharding
script, a rollout bot, and a dashboard. Step 2: apply it to the 30 files in our one service."

<details><summary>After</summary>

This *over*-engineers a small change — the inverse mistake. 30 files in one owned service is not
LSC territory.

- **IDE refactor or a one-off codemod run**, one normal PR to your own team. Review is immediate
  because you're the owners.
- If you want to prevent backsliding, a single lint rule — no bot, no dashboard, no governance.

The LSC apparatus has high fixed cost; it pays off for wide, multi-owner, mechanical, long-lived
changes. 30 files in one service is none of those. **Skip the machinery.**
</details>

---

## 6. "Run both migrations this sprint"

**Before:** "We have two migrations — introduce `Clock` injection, and switch all time calls to
`clock.now()`. Let's parallelize both this sprint to go faster."

<details><summary>After</summary>

The second depends on the first; running them in parallel makes `clock.now()` shards fail
wherever injection hasn't landed (find-bug §7). "Faster" becomes flaky and slower.

- **Sequence** as expand-migrate-contract: drive `Clock` injection to **100%** first, *then*
  roll out `clock.now()`, *then* ban `System.currentTimeMillis()`.
- Better still, if feasible: use branch-by-abstraction so `clock.now()` works against either
  backing impl, removing the ordering constraint and letting them truly parallelize.

Don't parallelize dependent migrations; remove the dependency or sequence the phases.
</details>

---

## 7. "We hit 95%, ship it and move on"

**Before:** "The codemod migrated 95% of the `javax`→`jakarta` imports. The remaining 5% are
weird. Let's mark the migration done and focus on features."

<details><summary>After</summary>

95% "done" is the most expensive state: you carry the compatibility scaffolding and ambiguity
forever, and the codebase has two canonical answers. Redesign the *finish*:

- **Drain the long tail to zero:** hand-migrate the quarantined sites, delete dead ones, and if
  the 5% shares a cause, improve the recipe and re-run (idempotent → safe).
- **Remove the old dependency** and keep the OpenRewrite recipe in CI as enforcement (any
  reintroduced `javax` makes the recipe non-empty → CI fails).
- Time-box any genuine exception (a frozen module) with a written deletion date.

The deliverable is zero and old-API-removed — not the impressive-looking 95% the codemod did for
free. Finishing the tail *is* the migration.
</details>
