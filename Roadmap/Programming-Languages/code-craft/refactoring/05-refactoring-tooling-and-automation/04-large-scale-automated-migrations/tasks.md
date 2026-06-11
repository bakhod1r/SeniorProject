# Large-Scale Automated Migrations — Tasks

> **Source:** Google, "Software Engineering at Google" (Large-Scale Changes ch.); OpenRewrite docs

Each task gives you a large change and asks you to design the rollout — or argue it doesn't need
one. Try it before reading the worked solution. The skill being graded is *judgment*: sharding,
idempotency, sequencing, completion, enforcement, and knowing when to skip the machinery.

---

## Task 1 — Design a rollout for a method rename

**Given:** Across a 25,000-file TypeScript monorepo (40 teams, `CODEOWNERS` defined), rename
`logger.warn(msg)` to `logger.warning(msg)`. The old method will be deleted.

Design the full rollout.

<details><summary>Worked solution</summary>

1. **Codemod:** jscodeshift transform matching `CallExpression` where callee is
   `logger.warn`, rewrite to `logger.warning`. Make it **idempotent** — a `logger.warning`
   call already matches the new shape and isn't touched, so re-runs are no-ops by construction.
2. **Dry-run** across the repo: `jscodeshift -t rename.ts --dry --print src/`. Record changed
   count and any transform errors.
3. **Shard by `CODEOWNERS` area** — one PR per owning team, routed to that team.
4. **Bot rollout:** branch per shard, run codemod scoped to the shard, commit with a standard
   message linking the tracking issue, open PR, request owner review, run scoped CI, auto-merge
   on green + approval. Pace at e.g. 30 PRs/hour.
5. **Track:** `grep -rcE 'logger\.warn\(' src/` → zero means done. Dashboard the trend.
6. **Enforce in stages:** lint rule banning `logger.warn` at *warn* during rollout → *error* at
   zero → then **delete `warn`** so the compiler enforces it permanently.

Clean, mechanical, wide → textbook LSC.
</details>

---

## Task 2 — Choose the sharding boundary

**Given:** Same monorepo. The change must also update a generated client and several Bazel-style
build files, and a few teams have unreviewed/abandoned directories.

Pick a sharding boundary and justify it; handle the awkward areas.

<details><summary>Worked solution</summary>

- **Boundary: by build target**, refined by ownership. Each target gives a clean, self-contained
  CI signal, and you route the PR to that target's owners.
- **Generated client:** don't migrate the generated output — migrate the *generator* and
  regenerate. Migrating generated code gets overwritten on next gen.
- **Abandoned dirs:** flag as long tail up front. Decide the policy now: proceed under a global
  approval after a no-response window, or hand-migrate, or delete if dead. Don't let them block
  the other 39 teams.

The lesson: the boundary should give meaningful CI *and* map to a reviewer; generated and
unowned code are special cases you plan for, not surprises.
</details>

---

## Task 3 — Make a non-idempotent codemod safe

**Given:** A codemod wraps every `fetchData()` call in `withRetry(...)`. On a re-run it produced
`withRetry(withRetry(fetchData()))` in 300 files and broke the build.

Fix the codemod and describe how to repair the corrupted files.

<details><summary>Worked solution</summary>

**Fix (idempotency guard):** before wrapping, skip calls already wrapped.

```js
root.find(j.CallExpression, { callee: { name: 'fetchData' } })
  .filter(p => !(p.parent.node.type === 'CallExpression'
              && p.parent.node.callee.name === 'withRetry'))   // already wrapped? skip
  .replaceWith(p => j.callExpression(j.identifier('withRetry'), [p.node]));
```

**Repair:** write a one-shot un-wrap codemod that collapses `withRetry(withRetry(x))` →
`withRetry(x)` (also idempotent), run it across the 300 files, then re-run the *fixed* codemod
to confirm a no-op. Because both are now idempotent, re-running across the whole repo is safe.

Root cause to call out: the original transform had no "already applied?" check — the defining
property of a non-idempotent codemod.
</details>

---

## Task 4 — Sequence two dependent migrations

**Given:** Migration A introduces a new `Clock` interface; Migration B replaces every
`System.currentTimeMillis()` call with `clock.now()`, which requires `Clock` to be injected
(introduced by A).

Design the rollout so it's safe and parallelizable.

<details><summary>Worked solution</summary>

Don't run B's PRs in parallel with A's PRs — they'll fail CI where A hasn't landed. Use
**expand-migrate-contract** to make the sequence explicit and each phase independently valid:

1. **Expand (A):** introduce `Clock` and inject it everywhere it's needed; `System.currentTimeMillis()`
   still present and used. Roll this out fully to 100%.
2. **Migrate (B):** the big sharded rollout — point every `System.currentTimeMillis()` site at
   `clock.now()`. Independent per shard *because* A already finished, so any order works.
3. **Contract:** add a lint/Forbidden-API rule banning `System.currentTimeMillis()`; once
   remaining-sites is zero, the rule goes to error.

Each phase reaches 100% and is shippable before the next starts. Never start B before A is at
100%, or shards break where `Clock` isn't injected yet.
</details>

---

## Task 5 — Argue a change is too small for an LSC

**Given:** A staff engineer proposes a full LSC pipeline (bot, dashboard, governance) to rename
a config key used in 18 files, all under your own team's two directories.

Make the case to do it simpler.

<details><summary>Worked solution</summary>

This fails the LSC cost test. The fixed cost of a governed rollout — authoring + vouching +
bot + dashboard + enforcement scaffolding — dwarfs an 18-file change in code you already own.

Do instead:
- IDE rename / a one-off `jscodeshift` run across the 18 files.
- One normal PR to your own team; you *are* the owners, so review is immediate.
- If the key shouldn't return, a single lint rule or schema validation — no rollout machinery.

State the rule: LSC machinery pays off for *wide, multi-owner, mechanical, long-lived* changes.
18 files in two of your own directories is none of those. Reserve the highway-repaving operation
for the highway.
</details>

---

## Task 6 — Handle the long tail

**Given:** A Java `javax → jakarta` migration via OpenRewrite reached 96%. The remaining 4%:
~120 files with hand-written annotation processors the recipe skipped, plus one frozen module a
team opted out of.

Plan completion.

<details><summary>Worked solution</summary>

1. **Quarantined 120 files:** triage each — hand-migrate the ones with real future life;
   delete-if-dead any unused; if a *class* of them shares a skip cause, improve the recipe and
   re-run (idempotent, so safe) before resorting to hand work.
2. **Frozen opted-out module:** time-box the exception. Get its deletion/upgrade date in
   writing; if it's truly being deleted soon, leave it but record the decision. Otherwise
   escalate the opt-out as the deadline nears.
3. **Finish:** once remaining-sites hits zero, remove the compatibility scaffolding, and keep
   the recipe in CI as enforcement (any reintroduced `javax` import makes the recipe non-empty
   → CI fails).

The deliverable is *zero*, not 96%. A permanently-mixed `javax`/`jakarta` codebase carries the
shim and ambiguity forever.
</details>

---

## Task 7 — Design quarantine + completion tracking for a flaky transform

**Given:** A polyglot repo migration via Comby will hit files in 6 languages; you expect ~5% to
not transform cleanly. Leadership wants daily visibility.

Design the partial-failure handling and the tracking.

<details><summary>Worked solution</summary>

- **Quarantine, don't fail:** for each file, attempt the transform; on failure, append to
  `quarantine/<lang>.skipped` and continue — never fail a shard for one file.
- **Completion metric:** emit daily `remaining_sites` (count of the old pattern across all
  languages) and `quarantine_count`. Both go to a dashboard.
- **Health alerts:** alert if `quarantine_count` *rises* over time (codemod hitting an unhandled
  case class) or if the generated-PR CI-failure rate spikes (pause and fix).
- **Ownership of the tail:** assign the quarantine list to a person; triage weekly
  (hand-migrate / delete / improve-pattern-and-rerun).

Leadership sees % complete, quarantine trend, and red-shard reasons every day — the three
numbers that tell whether the rollout is healthy or stuck.
</details>

---

## Task 8 — Add regression enforcement without blocking in-flight work

**Given:** Mid-rollout of a deprecation, another team complains your new lint rule is failing
their unrelated PRs because their branch still contains the old API.

Fix the enforcement strategy.

<details><summary>Worked solution</summary>

The rule was set to **error too early**. Correct staging:

1. **Warn** during the rollout — nudges new code, blocks nothing. Existing old-API code (and
   branches predating the migration) still builds.
2. **Error** only after remaining-sites hits **zero** — now every site is migrated, so erroring
   can't block legitimate unmigrated code.
3. **Delete** the old API — the compiler enforces it and the lint rule becomes redundant.

Communicate the flip date so teams rebase before it lands. The principle: never let enforcement
outrun the migration's completion.
</details>
