# Large-Scale Automated Migrations — Find the Bug

> **Source:** Google, "Software Engineering at Google" (Large-Scale Changes ch.); OpenRewrite docs

Each scenario is a real way large migrations go wrong. Diagnose the root cause, then design the
fix. The bug is almost never in the codemod's transform logic — it's in the *rollout discipline*
around it.

---

## Scenario 1 — The one giant PR

A team migrated `Date` to `Instant` across a 30,000-file repo. They ran the codemod over
everything and opened a single PR:

```
PR #4471: migrate Date -> Instant
  31,204 files changed   +88,902 −88,902
  Reviewers: @platform-team
  Status: open for 6 weeks, 412 merge conflicts, CI red on 3 files
```

**Diagnose + fix.**

<details><summary>Solution</summary>

**Root cause:** a large change was treated as a *big PR* instead of *many small PRs*. Symptoms
are all predictable consequences — unreviewable size, conflicts accumulating faster than review,
3 bad files holding the entire change hostage, and `@platform-team` has no authority over the
600 directories they're being asked to approve.

**Fix:** abandon the giant PR. **Shard** by owner/build target, generate one small PR per shard
via a bot, route each to its real owners, run scoped CI, auto-merge on green. The 3 bad files
get quarantined and hand-fixed without blocking the other 31,201. Conflicts vanish because each
small shard lands fast.
</details>

---

## Scenario 2 — Non-idempotent re-run corruption

A migration wrapping DB calls in a span tracer stalled on a few shards, so the engineer re-ran
the codemod across the *whole* repo to catch stragglers. Now the build is broken in 900 files:

```js
// before re-run:  trace("db", () => query(sql))
// after re-run:   trace("db", () => trace("db", () => query(sql)))
```

**Diagnose + fix.**

<details><summary>Solution</summary>

**Root cause:** the codemod is **not idempotent** — it has no "already transformed?" check, so
re-applying it double-wraps. The re-run (an inherent part of any multi-shard rollout) corrupted
every previously-migrated site.

**Fix:**
1. Add an idempotency guard: skip `query()` calls already inside a `trace("db", ...)`.
2. Write a one-shot un-wrap codemod collapsing `trace("db", () => trace("db", () => x))` →
   `trace("db", () => x)`; run it over the 900 files.
3. Re-run the *fixed* codemod repo-wide; confirm it's now a no-op on migrated files.

Going forward, every LSC codemod must be idempotent *by construction* because rollouts always
re-run.
</details>

---

## Scenario 3 — No completion tracking

Six months ago a team "migrated" `RestTemplate` to `WebClient`. Today a new hire asks which to
use. Reality:

```bash
$ grep -rc 'new RestTemplate' src/ | grep -v ':0' | wc -l
1,847
```

Nearly 2,000 old-API sites remain. No one knew, because nobody tracked it. The migration was
declared "done" when the codemod's first pass finished.

**Diagnose + fix.**

<details><summary>Solution</summary>

**Root cause:** **no completion tracking.** "Done" was defined as "the codemod ran" instead of
"remaining sites == 0." With no progress metric, the migration stalled in its long tail and the
codebase has been in a permanent mixed state for six months — the worst outcome, since neither
API is canonical.

**Fix:**
1. Stand up the remaining-sites counter (`grep -rc 'new RestTemplate'`) and dashboard it.
2. Resume the rollout to drive the long tail to zero — hand-migrate quarantined/judgment sites,
   delete dead ones.
3. **Delete `RestTemplate` usage capability** (or add an error-level enforcement rule) so it
   can't return.
4. Redefine "done" org-wide: a migration is complete only when the counter is zero *and* the old
   API is removed/enforced.
</details>

---

## Scenario 4 — No regression enforcement

A team successfully drove a `moment.js` → `date-fns` migration to zero and celebrated. Three
months later:

```bash
$ grep -rc "from 'moment'" src/ | grep -v ':0' | wc -l
73
```

`moment` is back in 73 files. The dependency was never removed and nothing stops new imports.

**Diagnose + fix.**

<details><summary>Solution</summary>

**Root cause:** **no regression enforcement.** They reached zero but never made the old state
un-representable, so reintroductions (copied examples, branches predating the migration,
developers unaware) silently un-did the work.

**Fix:**
1. Add a lint rule banning `moment` imports (`no-restricted-imports`), set to **error**.
2. **Remove `moment` from `package.json`** so the import can't even resolve — the build enforces
   it for free. Deletion is the strongest enforcement.
3. Re-migrate the 73 regressed files.

The principle: a migration isn't finished at zero — it's finished when zero *can't be exceeded*.
</details>

---

## Scenario 5 — One bad file fails the whole shard

A bot-driven rollout keeps marking entire shards red. Investigation shows each red shard has
exactly one un-parseable file (a generated file with a syntax the codemod's parser chokes on),
and the codemod fails the *whole shard's* run on that file:

```bash
$ jscodeshift -t migrate.ts payments/**/*.ts
ERROR processing payments/generated/schema.pb.ts: Unexpected token
# ... and jscodeshift exits non-zero, so the whole payments shard PR is never created
```

40 of 600 shards are blocked this way.

**Diagnose + fix.**

<details><summary>Solution</summary>

**Root cause:** **no partial-failure quarantine.** A single un-transformable file aborts an
entire shard, so 40 shards (and all their good files) are stuck behind one bad file each.

**Fix:** transform files individually; on failure, **skip and log**, don't abort:

```bash
for f in $(cat shards/payments.files); do
  jscodeshift -t migrate.ts "$f" 2>>quarantine/payments.log \
    || echo "$f" >> quarantine/payments.skipped
done
```

Now each shard migrates its 99% and the skipped files go to the tracked long tail for
hand-handling. Generated files specifically should be *excluded* from the file list entirely —
you migrate the generator, not its output.
</details>

---

## Scenario 6 — Enforcement landed before the rollout finished

Mid-migration, a developer added the deprecation lint rule at **error** level "to be safe." Now
unrelated PRs across the company are failing CI:

```
ERROR: getUserById is deprecated; use users.findById   (search/legacy/handler.ts)
  ↳ but search/ hasn't been migrated yet — its shard is still in review
```

**Diagnose + fix.**

<details><summary>Solution</summary>

**Root cause:** **enforcement outran completion.** The rule was set to error while sites still
legitimately use the old API, so it blocks code that simply hasn't been migrated yet — including
unrelated branches.

**Fix:** roll enforcement in stages.
1. Set the rule back to **warn** for the duration of the rollout.
2. Flip to **error** only after remaining-sites hits **zero**.
3. Then delete the old API.

Announce the error-flip date so teams rebase first. Enforcement must never precede the
migration's completion.
</details>

---

## Scenario 7 — Dependent shards landing out of order

A migration's shards are failing CI intermittently with "cannot resolve `Clock`." Some shards
pass, some fail, and re-running the failed ones sometimes makes them pass. The change replaces
`System.currentTimeMillis()` with `clock.now()`, where `clock` is injected by a *separate*
earlier migration that's still rolling out in parallel.

**Diagnose + fix.**

<details><summary>Solution</summary>

**Root cause:** **dependent migrations run in parallel.** The `clock.now()` shards only build
where the `Clock`-injection migration already landed; in still-uninjected areas they fail. The
"re-run sometimes fixes it" symptom is just the injection migration catching up by chance — a
race, not a fix.

**Fix:** sequence with expand-migrate-contract. Drive the `Clock`-injection migration to **100%
first** (expand), *then* roll out the `clock.now()` migration (migrate) — now every shard is
independently valid because injection is everywhere. Finally, ban `System.currentTimeMillis()`
(contract). Never let a dependent migration start before its prerequisite reaches zero.
</details>
