# Large-Scale Automated Migrations — Junior

> **Source:** Google, "Software Engineering at Google" (Large-Scale Changes ch.); OpenRewrite docs

You learned to write a codemod — a script that rewrites code automatically. Now your team
wants to apply one to **40,000 files across 600 directories owned by 180 different teams.**
You cannot just run the script and push one commit. That commit would be unreviewable,
unmergeable, and if it broke a build at 2 a.m. it would be unrevertable without taking down
everyone else's work too.

This topic is about the **discipline** of running automated changes across a huge codebase
safely: the process Google calls a **Large-Scale Change (LSC)** and Meta runs through its
**codemod + Sandcastle** pipelines. It is the capstone of the tooling section: the codemod is
the *tool*, the LSC is the *operation* you run with it.

---

## Table of Contents

1. [Why "just run the codemod everywhere" fails](#1-why-just-run-the-codemod-everywhere-fails)
2. [The interstate-repaving analogy](#2-the-interstate-repaving-analogy)
3. [The LSC playbook, end to end](#3-the-lsc-playbook-end-to-end)
4. [Sharding: turning one huge change into many small ones](#4-sharding-turning-one-huge-change-into-many-small-ones)
5. [Many small reviewable PRs](#5-many-small-reviewable-prs)
6. [Idempotency: why a migration must be re-runnable](#6-idempotency-why-a-migration-must-be-re-runnable)
7. [Tracking completion and cleaning up](#7-tracking-completion-and-cleaning-up)
8. [Preventing regressions after you finish](#8-preventing-regressions-after-you-finish)
9. [When NOT to run a large-scale migration](#9-when-not-to-run-a-large-scale-migration)
10. [Glossary](#10-glossary)
11. [Review questions](#11-review-questions)
12. [Next](#next)

---

## 1. Why "just run the codemod everywhere" fails

Say you have a perfect codemod. It renames `getUserById(id)` to `users.findById(id)` and it
works on every file you've tested. The naive move is:

```bash
# DON'T do this on a large monorepo
find . -name '*.ts' | xargs jscodeshift -t rename-getuser.ts
git add -A && git commit -m "rename getUserById -> users.findById"
git push
```

Here is what goes wrong, in order of how badly it hurts:

- **The PR is unreviewable.** A 40,000-file diff cannot be reviewed by a human. Reviewers will
  either rubber-stamp it (so real mistakes ship) or refuse to look (so it never merges).
- **No single person owns all of it.** In a monorepo, `payments/`, `search/`, and `ads/` are
  owned by different teams. None of them will approve a change to their code that someone else
  wrote and they didn't vet.
- **One bad file fails the whole thing.** If your codemod mangles 1 file out of 40,000, the
  build is red, and now *all* 40,000 changes are blocked behind that one failure.
- **You cannot revert safely.** If the change breaks production a week later, reverting one
  giant commit reverts a week of *everyone's* work that landed on top of it.
- **Merge conflicts guarantee it never lands.** While your giant PR sits in review, hundreds of
  other commits touch those same files. Your diff is stale before anyone finishes reading it.

The core insight: **a large change is not a big PR, it is a small PR repeated thousands of
times, automatically, with tracking.** Everything in this topic follows from that.

---

## 2. The interstate-repaving analogy

You need to repave a 200-mile interstate. You cannot close the whole highway, dig it all up,
and reopen it when finished — the country would grind to a halt for months. Instead:

- You **close one section at a time** (a *shard*). Traffic reroutes around it.
- Each section is **small, independent, and reversible** — if one crew hits bedrock, the other
  150 sections keep going.
- A **central control room** tracks which sections are done, in progress, or not started
  (*completion tracking*).
- Once a section is repaved, you put up **"no potholes allowed" signs and inspectors**
  (*regression enforcement*) so the old surface never comes back.
- The highway **stays open the entire time** — at no point is the system fully broken.

That last point is the whole game. A large-scale migration must keep the codebase *shippable
at every moment* — see [`../../04-large-scale-refactoring/05-keeping-the-system-shippable/junior.md`](../../04-large-scale-refactoring/05-keeping-the-system-shippable/junior.md).
Keep the analogy in your head, but don't lean on it for the technical details below.

---

## 3. The LSC playbook, end to end

This is the canonical sequence. Memorize the shape; the rest of the file fills in each step.

```
1. WRITE & VALIDATE the codemod        ← the tooling sections 02 + 03
2. DRY-RUN on the whole repo           ← see what it would change, fix the codemod
3. SHARD the change                    ← split by directory / owner / build target
4. GENERATE many small commits/PRs     ← one per shard, each independently reviewable
5. AUTOMATED ROLLOUT with bots         ← bot sends PRs, pings owners, merges on green
6. TRACK COMPLETION                    ← dashboard of % migrated; chase the long tail
7. CLEAN UP                            ← delete the old API, add enforcement so it can't return
```

**Step 1 — Write & validate the codemod.** You already learned this in the *codemods and AST
transforms* sibling section (02) and *automated safety nets* (03). The migration assumes the
codemod itself is correct and well-tested. If the codemod is wrong, scaling it up just spreads
the bug 40,000 times.

**Step 2 — Dry-run.** Run the codemod across the *entire* repo but produce a diff instead of
committing. This is your reality check: how many files change? Are there files it transforms
*incorrectly*? Are there files it *refuses* to transform (parse errors, weird macros)? The
dry-run tells you the true size and the rough edges before you commit to anything.

```bash
# jscodeshift dry-run: --dry prints what would change, --print shows the output
jscodeshift -t rename-getuser.ts --dry --print src/ | tee dryrun.log
grep -c 'modified' dryrun.log   # how many files actually change
grep 'ERROR'      dryrun.log    # files that failed to transform
```

**Steps 3–7** are the rest of this file.

---

## 4. Sharding: turning one huge change into many small ones

A **shard** is a slice of the codebase small enough to be one reviewable, independently
mergeable unit. You split the giant change into shards along a boundary that matches **who
reviews it** and **what can break together.** Common boundaries:

- **By directory / module** — `payments/`, `search/`, `ads/`. Natural for monorepos.
- **By owner** — every file under a given `OWNERS` file becomes one shard, so one team reviews
  one PR.
- **By build target** — each compilation unit (a Bazel target, a Go package, a Maven module)
  becomes a shard, so each PR has a clean, self-contained build to verify.

A simple sharding sketch — group the dry-run's changed files by their owning directory:

```bash
#!/usr/bin/env bash
# shard-by-toplevel-dir.sh — read changed files, bucket them by top-level dir
set -euo pipefail

# changed-files.txt = list of files the dry-run would modify
while read -r file; do
  shard=$(echo "$file" | cut -d/ -f1)      # e.g. "payments" from "payments/api/user.ts"
  echo "$file" >> "shards/${shard}.files"
done < changed-files.txt

ls shards/                                 # one .files list per shard
```

Each `shards/*.files` list then becomes one branch, one codemod run scoped to those files, one
commit, one PR. **Rule of thumb:** a shard should be reviewable in a few minutes by the team
that owns it — typically tens of files, not thousands.

> **When NOT to shard finely:** if the change is truly atomic — it *must* land everywhere at
> once or the code won't compile (e.g. renaming a symbol used across module boundaries with no
> compatibility shim) — you can't shard it into independent PRs. Then you either add a
> compatibility shim first (so shards *become* independent) or you do a single atomic change.
> Sharding assumes shards are independently valid. See section 9 and the senior file.

---

## 5. Many small reviewable PRs

Once you have shards, you generate one PR per shard. Each PR:

- contains only the codemod's output for that shard — no hand edits, so reviewers trust it,
- is routed to the **owning team** for review (in a monorepo, the `OWNERS` file decides this),
- carries a **standard description** explaining the migration, linking the tracking issue, and
  saying "this was generated by an automated migration; reply STOP to opt out."

The point of "small + many" instead of "one + giant": a reviewer for `search/` sees only the
~30 files in `search/`, recognizes the mechanical pattern, and approves in two minutes. They
never have to care that 599 other directories are also changing.

You do **not** generate and push 600 PRs by hand. A **bot** does it — opens the PR, requests
review from owners, watches CI, and merges automatically when the build is green and an owner
approves. Google's bot for this is part of the **Rosie** system. We cover the bot and review
mechanics in [`middle.md`](middle.md).

> **When NOT to do many PRs:** if your shards have dependencies on each other (shard B only
> builds after shard A merges), independent parallel PRs will fail CI in a confusing order.
> Either remove the dependency (compatibility shim) or sequence them. Sequencing is a senior
> concern — see [`senior.md`](senior.md).

---

## 6. Idempotency: why a migration must be re-runnable

A migration spanning weeks will be interrupted: a shard fails CI, a file gets a merge conflict,
someone reverts a PR, the codemod gets a bug fix mid-rollout. So you will **re-run the codemod
on files it has already touched.** This makes idempotency non-negotiable.

A codemod is **idempotent** if running it twice produces the same result as running it once:

```
codemod(codemod(file)) == codemod(file)
```

A *non-idempotent* codemod corrupts code on the second pass. Classic failure:

```js
// BAD: not idempotent. Wraps every call in a logger.
// First run:  doThing()          -> log(doThing())
// Second run: log(doThing())     -> log(log(doThing()))   ← double-wrapped, broken!
root.find(j.CallExpression, { callee: { name: 'doThing' } })
    .replaceWith(p => j.callExpression(j.identifier('log'), [p.node]));
```

```js
// GOOD: idempotent. Skip calls that are already wrapped.
root.find(j.CallExpression, { callee: { name: 'doThing' } })
    .filter(p => !(p.parent.node.type === 'CallExpression'
                && p.parent.node.callee.name === 'log'))   // already wrapped? skip.
    .replaceWith(p => j.callExpression(j.identifier('log'), [p.node]));
```

The fix is always the same shape: **before transforming, check whether the transform has
already been applied, and if so, do nothing.** An idempotent codemod is safe to re-run on the
whole repo any number of times — which is exactly what a multi-week rollout needs.

> **When NOT to worry about idempotency:** a one-shot codemod you run once, review once, and
> land as a single PR (a *small* change) doesn't need to be re-runnable. Idempotency matters
> precisely because large migrations get re-run. If you can't make a codemod reliably
> idempotent, that's a strong signal the change is *not* a good candidate for automation at
> scale (section 9).

---

## 7. Tracking completion and cleaning up

A large migration is "done" only when **every** site is converted and the old thing is deleted.
Without tracking, migrations stall at 80% and rot there forever — half-old, half-new, the worst
possible state.

**Track completion with a number you can compute, not a feeling.** The cheapest tracker is a
count of remaining old-API usages:

```bash
# remaining sites = the migration's progress bar
grep -rc 'getUserById(' src/ | grep -v ':0' | wc -l
# 0 means done. Run this in CI and post it to a dashboard daily.
```

Then **clean up**:

1. Migrate every site to the new API (the rollout above).
2. When the remaining count hits zero, **delete the old API** entirely.
3. Add **enforcement** so it can never come back (section 8).

Steps 2 and 3 are the part everyone skips, and skipping them is why old deprecated functions
linger for a decade. The migration is not finished until the old code is *gone* and *cannot
return*.

---

## 8. Preventing regressions after you finish

You migrated all 40,000 sites. Tomorrow a developer on a feature branch writes `getUserById`
again — they copied an old example, or their branch predates your migration. Now you're at
39,999. Regressions silently un-do migrations.

The fix is **mechanical enforcement** that fails the build when the old pattern reappears. The
cheapest version is a lint rule:

```js
// .eslintrc — ban the migrated-away API so it can't come back
module.exports = {
  rules: {
    'no-restricted-syntax': ['error', {
      selector: "CallExpression[callee.name='getUserById']",
      message: 'getUserById was migrated to users.findById. Do not reintroduce it.',
    }],
  },
};
```

If you fully deleted the old API in cleanup (section 7), the *compiler* enforces it for free —
`getUserById` no longer exists, so referencing it won't build. Deletion is the strongest
enforcement; a lint rule is the fallback when you can't delete yet. The principle: **after a
migration, make the old state un-representable.**

---

## 9. When NOT to run a large-scale migration

The whole LSC apparatus — sharding, bots, dashboards, enforcement — has real overhead. Don't
build a highway-repaving operation to fix a pothole. **Do it by hand or in the IDE instead
when:**

- **It's small.** Under ~50 files in one or two owned areas? Use the IDE's rename/refactor (the
  *IDE refactorings* sibling section, 01) and a normal PR. The LSC machinery costs more than the
  change.
- **Each site needs human judgment.** If the codemod can't decide what to do without a human
  reading the surrounding code ("is *this* `parse()` the one we mean?"), it's not mechanical,
  and forcing it through automation produces wrong changes at scale. Migrate by hand, or split
  off the mechanical 90% and hand-do the judgment-heavy 10%.
- **You can't make it reliably idempotent.** If re-running corrupts code (section 6) and you
  can't fix that, a multi-week automated rollout is unsafe. Either keep it a single one-shot
  change or do it manually.
- **The blast radius doesn't justify it.** A change to a rarely-touched internal tool used by
  one team isn't worth a governed rollout.

The senior decision is honest scoping: *most* "we should migrate everything" ideas are better
as a hand change in the few places that matter. Reserve the LSC discipline for genuinely
cross-cutting, mechanical changes.

---

## 10. Glossary

| Term | Meaning |
|------|---------|
| **LSC (Large-Scale Change)** | Google's term and process for an automated change touching many files across many owners. |
| **Codemod** | A program that rewrites source code automatically (usually via an AST). The *tool* an LSC runs. |
| **Shard** | A slice of the change small enough to be one reviewable, independently mergeable PR. |
| **Dry-run** | Running the codemod to *see* the diff without committing it. |
| **Idempotent** | Running the codemod twice gives the same result as once — safe to re-run. |
| **Rosie** | Google's system that shards an LSC and drives the per-shard PRs through review and submit. |
| **TAP** | Google's Test Automation Platform — runs affected tests for changes across the monorepo. |
| **OWNERS** | A file listing who must approve changes to a directory; routes each shard to the right reviewers. |
| **Completion tracking** | A measurable count of remaining un-migrated sites; the migration's progress bar. |
| **Regression enforcement** | A lint rule, CI check, or API deletion that stops the old pattern from coming back. |
| **Long tail** | The last few percent of sites that resist automated migration and need human attention. |

---

## 11. Review questions

1. Give three concrete reasons one 40,000-file PR fails where many small PRs succeed.
2. What is a *shard*, and name three boundaries you can shard along.
3. Write a one-line shell command that tells you how many files a jscodeshift codemod *would*
   change without committing anything.
4. Define idempotency for a codemod and explain why a multi-week rollout requires it.
5. A migration is stuck at 85%. What measurable signal would have told you, and what two steps
   "finish" a migration after the last site is converted?
6. After a clean migration, a developer reintroduces the old API on a feature branch. Name two
   mechanisms that prevent this, and say which is strongest.
7. Give two situations where you should *not* run a large-scale automated migration at all.

---

## Next

- [`middle.md`](middle.md) — sharding strategies, PR-generation bots, completion tracking,
  idempotency, deprecation enforcement.
- The *codemods and AST transforms* sibling section (02) — how to actually write the codemod an
  LSC scales up.
- The *automated safety nets* sibling section (03) — the tests and checks that make a migration
  safe to land.
- [`../../04-large-scale-refactoring/02-parallel-change-expand-contract/junior.md`](../../04-large-scale-refactoring/02-parallel-change-expand-contract/junior.md)
  — the expand-migrate-contract pattern an API migration follows at scale.
