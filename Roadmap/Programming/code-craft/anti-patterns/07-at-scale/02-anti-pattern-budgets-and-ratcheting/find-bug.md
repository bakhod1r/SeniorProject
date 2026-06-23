# Anti-Pattern Budgets & Ratcheting — Find the Bug

> **Category:** [Anti-Patterns at Scale](../README.md) → **Anti-Pattern Budgets & Ratcheting** — *spot the ratchet that looks like it works but doesn't.*
> **Covers (collectively):** Baseline-and-ratchet · "No new violations" gates · Per-area debt budgets · Ratchet tooling · Failing the build on regression

---

These are **broken ratchets**. Each one *looks* fine — it runs, it's green on the happy path, it gets merged — but it silently fails to do its one job: stop the metric from getting worse. For each: read the snippet, answer the question yourself, then reveal the fix.

> **The theme:** a broken ratchet is more dangerous than no ratchet, because everyone *believes* the codebase is protected while it quietly rots. The bugs below are the ones that actually ship — usually because the gate stays green, so nobody notices it stopped gating. Refer to [`professional.md`](professional.md) for the failure-mode catalog.

---

## Table of Contents

| # | Bug | The lie it tells |
|---|---|---|
| 1 | [The self-updating baseline](#bug-1--the-self-updating-baseline) | "no regressions ever" (because it can't detect them) |
| 2 | [The off-by-one creep](#bug-2--the-off-by-one-creep) | "≤ baseline" (but lets it climb one at a time) |
| 3 | [Counting lines, not violations](#bug-3--counting-lines-not-violations) | "quality is improving" (it's just fewer lines) |
| 4 | [The baseline that resets on merge](#bug-4--the-baseline-that-resets-on-merge) | "tightened" (then silently loosened) |
| 5 | [Comparing against `main`'s tip](#bug-5--comparing-against-mains-tip) | "you regressed" (someone else did) |
| 6 | [`betterer` in write mode](#bug-6--betterer-in-write-mode) | "betterer is gating us" (it's recording, not gating) |
| 7 | [The swap that a bare count misses](#bug-7--the-swap-that-a-bare-count-misses) | "no new violations" (one was swapped in) |

---

## Bug 1 — The self-updating baseline

```bash
#!/usr/bin/env bash
# ratchet.sh
set -euo pipefail

baseline=$(cat .baseline)
current=$(violations | grep -c '^')

if [ "$current" -gt "$baseline" ]; then
  echo "regression detected"
  exit 1
fi

echo "$current" > .baseline          # keep the baseline up to date
git commit -am "update baseline" && git push
```

**The question.** This passes every test, the build is always green, and yet the violation count keeps climbing in production. Why does this ratchet never catch a regression?

<details>
<summary>Reveal the bug & fix</summary>

**The bug.** The baseline is rewritten to the **current count on every run, unconditionally** — including runs where the count *increased*. Trace a regression: a PR adds 3 violations, so `current = baseline + 3`. The `-gt` check *should* fire… but look closely at the order — even when it does fire and exits, on the runs where it *doesn't* (the very next run, or a run on a slightly different count), the final two lines overwrite `.baseline` with whatever `current` is. In practice the write-back means the baseline always drifts up to match reality, so over time the gate compares "today's count" to "today's count" and **can never detect an increase**. The ratchet has no memory of a lower floor.

**The fix.** Write the baseline **only on a decrease**, never unconditionally:

```bash
if [ "$current" -gt "$baseline" ]; then
  echo "❌ regression: $current > $baseline"; exit 1
fi
if [ "$current" -lt "$baseline" ]; then
  echo "$current" > .baseline                    # tighten ONLY on improvement
  git commit -am "ratchet: tighten → $current"
fi
# equal: do nothing — the baseline holds.
```

**Why this is the bug that matters most.** This is *the* canonical broken ratchet. An auto-updating baseline always equals the current count, so the gate is decorative — permanently green, gating nothing. It's especially insidious because the build *never goes red*, so it looks like the codebase is clean when it's silently degrading. The baseline must only ever move **down**.

</details>

---

## Bug 2 — The off-by-one creep

```python
def check(current: int, baseline: int) -> int:
    if current > baseline + 1:        # allow a little slack so we're not too strict
        print(f"❌ regression: {current}")
        return 1
    return 0
```

**The question.** The author added `+ 1` "to avoid being annoyingly strict." Why does this quietly let the violation count grow without bound?

<details>
<summary>Reveal the bug & fix</summary>

**The bug.** The `+ 1` slack lets each PR add **one** violation without failing. The baseline isn't tightened on these neutral-looking passes, so a PR goes `baseline → baseline + 1` (passes, `baseline+1` is not `> baseline+1`). The *next* PR sees the baseline still recorded as the old value (or, worse, if the baseline tightens to `current`, it ratchets *up*) and adds another. Either way, the count creeps upward one violation per PR, indefinitely — a slow leak that never trips the gate. "A little slack" is a hole the size of one violation per merge.

**The fix.** No slack. Fail on any genuine increase:

```python
def check(current: int, baseline: int) -> int:
    if current > baseline:            # strict: not one more than today
        print(f"❌ regression: {current} > {baseline}")
        return 1
    return 0
```

If the *real* problem was a flaky count that legitimately wobbles by ±1, the answer is to **fix the determinism** (pin tools, count structured output — see [`professional.md`](professional.md)), not to bake permanent slack into the gate. Slack in a ratchet is just a slower leak.

</details>

---

## Bug 3 — Counting lines, not violations

```bash
#!/usr/bin/env bash
# "code quality ratchet"
baseline=$(cat .loc-baseline)
current=$(find src -name '*.go' | xargs wc -l | tail -1 | awk '{print $1}')

if [ "$current" -gt "$baseline" ]; then
  echo "❌ codebase grew — quality regression"; exit 1
fi
echo "$current" > .loc-baseline
```

**The question.** This ratchets *total lines of code* as a quality metric. Beyond the self-updating-baseline bug, what makes the **metric itself** worthless and trivially gamed?

<details>
<summary>Reveal the bug & fix</summary>

**The bug.** **Lines of code measure nothing about quality**, and the metric is trivially gamed in *both* directions:
- To make the number go *down*, an engineer minifies, one-lines things, or deletes whitespace/comments — making the code *worse* while the gate cheers.
- The gate also **blocks legitimate growth**: adding a genuinely-needed feature (more lines) fails the "quality" check, so the ratchet fights real work.

This is textbook **Goodhart's law**: LOC became a target, so it stopped measuring anything useful. (It also has the self-updating-baseline bug from Bug 1.)

**The fix.** Ratchet an actual *violation* count, not lines:

```bash
baseline=$(cat .lint-baseline)
current=$(golangci-lint run ./... 2>/dev/null | grep -c ':')   # count warnings, not lines
if [ "$current" -gt "$baseline" ]; then
  echo "❌ lint warnings increased: $current > $baseline"; exit 1
fi
# (and tighten only on a decrease)
```

**The lesson.** *What* you count is the most important decision in a ratchet — more important than the mechanics. Count the **bad thing you want less of** (warnings, escape hatches, complex functions over a threshold), never a proxy like LOC that has no relationship to quality and that engineers can move in either direction without changing anything real.

</details>

---

## Bug 4 — The baseline that resets on merge

```yaml
# .github/workflows/ratchet.yml
on:
  push:
    branches: [main]          # run after every merge to main
jobs:
  ratchet:
    steps:
      - uses: actions/checkout@v4
      - run: |
          current=$(violations | grep -c '^')
          echo "$current" > .baseline      # "refresh" the baseline on main
          git commit -am "baseline: $current" && git push
```

**The question.** This recomputes and commits the baseline on every push to `main`. The PR-time gate compares against this committed baseline. Why does this combination mean a PR can add violations and they become *permanent* with no red build?

<details>
<summary>Reveal the bug & fix</summary>

**The bug.** After *every* merge to `main`, this job **overwrites `.baseline` with whatever the current count is** — including any violations the just-merged PR added. So even if the PR-time gate somehow let a regression through (or the PR was merged with admin override, or the gate ran against a stale base), the post-merge job *bakes the higher count into the baseline as the new normal*. The baseline "resets" upward to match reality on every merge, exactly like Bug 1 but at the merge level — the floor follows the ceiling. Each merge ratchets the baseline *up*, the opposite of the intent.

**The fix.** The post-merge job must **only lower** the baseline, never raise it — and must recompute against the latest `main` race-safely (see [`tasks.md`](tasks.md) Exercise 10):

```bash
current=$(violations | grep -c '^')
baseline=$(cat .baseline)
if [ "$current" -lt "$baseline" ]; then    # tighten only; NEVER overwrite upward
  echo "$current" > .baseline
  git commit -am "ratchet: tighten → $current [skip ci]" && git push
fi
# if current >= baseline: leave the baseline untouched.
```

Better still, also run the **no-loosen guard** (Exercise 3) on PRs so a regression can't reach `main` in the first place. The post-merge job is for *locking in improvements*, not for accepting whatever just landed.

</details>

---

## Bug 5 — Comparing against `main`'s tip

```bash
#!/usr/bin/env bash
# PR-time ratchet
baseline=$(git show origin/main:.baseline)   # the baseline on main right now
current=$(violations | grep -c '^')

if [ "$current" -gt "$baseline" ]; then
  echo "❌ you increased violations: $current > $baseline"; exit 1
fi
```

**The question.** Developers complain the ratchet randomly blames them for violations they never wrote. The script reads the baseline from the **tip of `origin/main`**. Why does that produce false failures?

<details>
<summary>Reveal the bug & fix</summary>

**The bug.** A long-lived branch was cut when `main`'s baseline was `1840`. While the branch was open, *other* PRs merged to `main` and cleaned up, dropping `main`'s baseline to `1810`. Now this branch's `current` is `1835` — *better* than where it started (1840), an improvement! — but the script compares against `main`'s **current tip** baseline of `1810` and screams "you increased violations: 1835 > 1810." The branch is being judged against work it never saw. Symmetrically, a branch can be wrongly *passed* if `main` regressed after it branched.

**The fix.** Compare against the **merge-base** — the state the branch actually diverged from:

```bash
base_commit=$(git merge-base origin/main HEAD)
baseline=$(git show "$base_commit":.baseline)   # the floor THIS branch started from
current=$(violations | grep -c '^')
if [ "$current" -gt "$baseline" ]; then
  echo "❌ this branch increased violations vs its merge-base: $current > $baseline"; exit 1
fi
```

**The lesson.** A ratchet must measure *this branch's effect*, which means comparing against where the branch **diverged** (`git merge-base`), not against the moving target of `main`'s tip. Comparing against the tip makes the gate flaky and erodes trust — the fastest way to get a ratchet declared "annoying" and disabled.

</details>

---

## Bug 6 — `betterer` in write mode

```yaml
# ci.yml
- name: Quality ratchet
  run: npx betterer            # run betterer to enforce our quality budgets
```

**The question.** The team adopted `betterer` to gate `@ts-ignore`. CI runs `npx betterer`. The snapshot file `.betterer.results` keeps changing in CI and the build is always green even as `@ts-ignore`s pile up. What's wrong with the invocation?

<details>
<summary>Reveal the bug & fix</summary>

**The bug.** Plain `npx betterer` runs in **write mode**: it *updates* `.betterer.results` to match the current state of the code, then reports success. So when a PR adds a new `@ts-ignore`, betterer dutifully **records it as part of the new baseline** and passes — it's a recorder, not a gate. (You'll also see CI committing or dirtying `.betterer.results`, the tell-tale sign.) This is the tool-specific form of Bug 1's self-updating baseline.

**The fix.** Use the read-only CI mode:

```yaml
- name: Quality ratchet
  run: npx betterer ci          # READ-ONLY: fails on regression, never writes the snapshot
```

`betterer ci` compares against the committed `.betterer.results` and **fails** on any regression without modifying the file. The snapshot only changes when a developer runs `betterer` locally to *lock in an improvement* and commits the result.

**The lesson.** Every ratchet tool has a "record" mode and a "gate" mode, and running the record mode in CI silently disables the gate. The same trap: `eslint` without `--max-warnings`, a hand-rolled script that writes the baseline unconditionally, betterer without `ci`. **CI must be read-only; only humans (or one controlled post-merge job) write the baseline.**

</details>

---

## Bug 7 — The swap that a bare count misses

```python
# ratchet on a bare count
baseline = 214                       # number of @ts-ignore last time
current = count_ts_ignore("src/")    # → 214

assert current <= baseline, "regression!"   # passes: 214 <= 214 ✓
```

**The question.** A PR *removed* a `@ts-ignore` from a well-tested file and *added* one to a critical untested file. The total is still 214, so this passes. Why is "passes" the wrong outcome, and what kind of baseline catches it?

<details>
<summary>Reveal the bug & fix</summary>

**The bug.** A **bare count** can't tell "fixed X, added Y" from "no change" — both leave the total at 214. The PR genuinely made the codebase *worse* (it moved a silenced type error from safe code into critical untested code), but the count is identical, so the gate is blind. Any bare-count ratchet permits unlimited **swapping**: as long as you remove one violation for each you add, the number never moves and the gate never fires — even as the violations migrate to the worst possible places.

**The fix.** Use a **per-violation baseline** that identifies each violation individually (by file + a hash of its context), so a *new* violation is detected even when the total is unchanged. This is exactly what `betterer`'s `.betterer.results` does:

```typescript
// .betterer.ts — records EACH @ts-ignore by location+context, not just the count.
import { regexp } from '@betterer/regexp';
export default {
  'no new @ts-ignore': () => regexp(/@ts-ignore/).include('./src/**/*.ts'),
};
// betterer ci sees the removed one AND the added one as distinct changes:
// the added one is NOT in the snapshot → regression → fail.
```

A **diff/new-code gate** (SonarQube/Code Climate) catches it too: the added `@ts-ignore` is on a *new* line, so it fails the "new code is clean" check regardless of what was removed elsewhere.

**The lesson.** A bare count is the right *starter* but has a real hole: it measures the *quantity* of debt, not its *identity* or *location*. When swap-gaming starts to matter — and in a critical codebase it does — graduate to per-violation snapshots or diff-gating, which track *which* violations exist, not just *how many*.

</details>

---

## Summary

- A broken ratchet's signature is a **permanently green build that gates nothing** — far more dangerous than no ratchet, because it certifies safety while the codebase rots.
- **The recurring bugs:** (1) writing the baseline **unconditionally** so it self-updates and never detects a regression; (2) **slack** (`+1`, `-ge`) that leaks one violation per PR; (3) counting a **worthless proxy** (LOC) instead of the actual violation; (4) a post-merge job that **resets the baseline upward** on every merge; (5) comparing against **`main`'s tip** instead of the **merge-base**, blaming a branch for others' work; (6) running a tool in **write/record mode** in CI instead of read-only gate mode; (7) a **bare count** that's blind to **swaps**.
- **The unifying rules:** the baseline only ever moves **down**; CI is **read-only** (only one controlled writer tightens); compare against the **merge-base**; count the **real violation**, not a proxy; and when swaps matter, track **which** violations exist, not just how many.
- Each bug stays green, which is exactly why it survives review — a ratchet's correctness is invisible until you deliberately try to make it go red. Test your ratchet by **adding a violation on purpose** and confirming the build fails.

---

## Related Topics

- [`tasks.md`](tasks.md) — build correct versions of every gate broken here.
- [`optimize.md`](optimize.md) — the *performance* failure mode (whole-repo recompute).
- [`professional.md`](professional.md) — the full failure-mode catalog these bugs are drawn from.
- [`junior.md`](junior.md) — why the baseline must only move down.
- [`interview.md`](interview.md) — Q&A, including several of these bugs as discussion prompts.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/senior.md) — the sibling topic; a broken fitness function fails the same way.
