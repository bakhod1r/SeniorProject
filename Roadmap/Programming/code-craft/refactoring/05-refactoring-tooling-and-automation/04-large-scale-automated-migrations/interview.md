# Large-Scale Automated Migrations — Interview

> **Source:** Google, "Software Engineering at Google" (Large-Scale Changes ch.); OpenRewrite docs

Q&A with model answers. These probe whether you understand *why* the LSC discipline exists, not
just that it does. Answer concretely.

---

### Q1. Why not just land a large automated change as one giant PR?

Because a 40,000-file PR is unreviewable, has no single owner in a multi-team repo, fails
entirely if one file breaks, can't be reverted without reverting everyone's downstream work, and
goes stale from merge conflicts before review finishes. The fix is to treat a large change as a
*small* change repeated thousands of times — sharded into independently reviewable, mergeable,
revertable PRs.

---

### Q2. What is sharding and what do you shard along?

Sharding splits one change into slices small enough to each be one reviewable, independently
mergeable PR. Common boundaries: **by owner** (one `OWNERS`/`CODEOWNERS` area → one team
reviews one PR), **by build target** (one compilation/test unit → clean self-contained CI),
or **by file count** (cap at N files) as a fallback. The cut should match *who reviews* and
*what can break together*.

---

### Q3. Walk me through the LSC playbook end to end.

Write & validate the codemod → dry-run across the whole repo to see the true scope and the
rough edges → shard by owner/target → generate one small PR per shard → roll out with a bot that
requests owner review, runs scoped CI, and auto-merges on green → track completion via a
remaining-sites counter → clean up by hand-migrating the long tail, deleting the old API, and
adding enforcement so it can't return.

---

### Q4. What does idempotency mean for a codemod, and why does a large migration require it?

A codemod is idempotent if running it twice equals running it once: `f(f(x)) == f(x)`. Large
migrations span weeks and get re-run — shards fail, get reverted, conflict, or the codemod gets
a bug fix mid-flight — so the codemod *will* be re-applied to already-migrated files. If it
isn't idempotent, the second pass corrupts code (e.g. double-wrapping `log(log(x))`). You make
it idempotent by checking, before transforming, whether the transform is already applied and
skipping if so.

---

### Q5. How does Google run a large-scale change?

It's registered as an **LSC**: a global approver vouches once for the change's correctness and
necessity. **Rosie** shards it (usually by build target), drives each shard as its own change to
the local `OWNERS` for review, runs scoped tests via **TAP**, and auto-commits each shard on
green + approval, with rate-limiting and retries. The two-level review — vouch-once globally,
approve-local-fit per shard — is what lets review scale across hundreds of teams in parallel.

---

### Q6. How do you review a change no human can fully read?

Split the question. One global reviewer answers "is this change correct and worth doing?" once.
Each local owner answers only "should it apply to *my* directory?" — verifying there's nothing
special (generated files, a planned deletion, an in-flight rewrite). Owners aren't re-deriving
correctness, so each small PR is approvable in minutes, and review parallelizes across all teams
at once.

---

### Q7. The migration is stuck at 88% for weeks. What's happening and what do you do?

You've hit the **long tail** — sites the codemod can't handle: quarantined files (parse
errors/macros/generated code), judgment sites, opted-out areas, and unowned code. The flat
remaining-sites line is the signal. You drain it by hand: hand-migrate quarantined/judgment
sites, delete dead sites instead of migrating them, escalate opt-outs as the deadline hits, and
get an org decision for abandoned code. Driving the tail to zero (not the 95% the codemod did)
is the actual deliverable.

---

### Q8. After a clean migration, how do you stop the old pattern from coming back?

Make the old state un-representable. Strongest: **delete the old API** so the compiler enforces
it for free. When you can't delete yet: a **lint rule** or **CI check** banning the pattern.
Roll enforcement out in stages — warn during the rollout (so you don't block unmigrated code),
flip to error once remaining-sites is zero, then delete. OpenRewrite makes the same recipe serve
as both migration and re-runnable enforcement.

---

### Q9. Atomic vs incremental rollout — which and why?

Default to **incremental**: many small PRs over time, with a compatibility shim so old and new
coexist and every intermediate state is valid. Incremental gives you sharding, parallel review,
per-shard rollback, and a pressure valve on failure. **Atomic** (all-at-once, indivisible) is
only for changes where no compatibility shim can exist — it forfeits all of those. The senior
move is recognizing "this must be atomic" is usually false: a shim turns it incremental.

---

### Q10. Two migrations depend on each other — B needs the API A introduces. How do you roll out?

Prefer removing the dependency: use **branch by abstraction** / **parallel change** to introduce
the new API alongside the old so shards land in any order. If a true ordering exists, run
phases — **expand** (add new API everywhere), **migrate** (point sites at it, the big sharded
rollout), **contract** (delete old + enforce) — each phase reaching 100% before the next. Never
contract before migrate hits zero, or you break the build.

---

### Q11. A file won't transform cleanly mid-rollout. What should the tooling do?

Skip it, log it to a quarantine list, and keep going — never fail a whole shard for one bad
file. Quarantine is a *planned* outcome at scale: the skipped files become part of the tracked
long tail, owned and triaged (hand-migrate, delete-if-dead, or improve the codemod and re-run —
which is safe because the codemod is idempotent).

---

### Q12. How do you roll back when something breaks a week into a multi-week rollout?

Because each shard is its own commit, revert *only* the broken shard — the other 599 are
untouched. Often a **forward fix** (fix the codemod, re-run the affected shard) is safer than a
revert, since the repo is already partly migrated and reverting re-creates a mixed state;
idempotency makes roll-forward cheap. A compatibility shim is the pressure valve — reverting a
shard just puts those sites back on the still-present old API with no build break. Keep
enforcement at *warn* until fully done so a rollback doesn't trip CI everywhere.

---

### Q13. When would you NOT run a large-scale automated migration?

When it's small (under ~50 files in one or two owned areas — use the IDE and a normal PR), when
each site needs human judgment the codemod can't make, when you can't make the codemod reliably
idempotent, or when the affected code's remaining lifetime doesn't justify the fixed cost. The
LSC apparatus has high fixed cost; reserve it for wide, mechanical, long-lived changes.

---

### Q14. What tools would you use for a repo-wide Java framework upgrade vs a TypeScript monorepo rename?

Java/JVM: **OpenRewrite** — composable, idempotent recipes (e.g. `UpgradeSpringBoot_3_0`,
`JavaxToJakarta`) that run repo-wide and double as CI enforcement; Moderne for multi-repo.
TypeScript/JavaScript: **jscodeshift** or **ts-morph** codemods across the monorepo. Polyglot
repos with lightweight structural patterns: **Comby**. At Google/Meta scale, the codemod is just
the transform; Rosie/Sandcastle pipelines drive the rollout.

---

### Q15. What metric tells you a migration is healthy, and what does an unhealthy one look like?

The **remaining un-migrated sites** count, trended over time. Healthy: monotonic decline to
zero, ending with the old API deleted and enforcement in place. Unhealthy: a flat line at some
percentage (stalled in the long tail), a rising quarantine rate (codemod hitting an unhandled
case class), or a spiking CI-failure rate on generated PRs (pause the bot and fix the codemod
before flooding reviewers).
