# Anti-Pattern Budgets & Ratcheting — Exercises

> **Category:** [Anti-Patterns at Scale](../README.md) → **Anti-Pattern Budgets & Ratcheting** — *hands-on practice building gates that only let the metric improve.*
> **Covers (collectively):** Baseline-and-ratchet · "No new violations" gates · Per-area debt budgets · Ratchet tooling · Failing the build on regression

---

These are **build-it** exercises. For each you get a problem statement, starting material, acceptance criteria, and a collapsible solution. The point is to *write the ratchet* — a script that freezes a baseline, fails CI on an increase, and tightens on a decrease — then harden it against the ways ratchets break in the real world.

> **How to use this file.** Try each in a scratch repo before opening the solution. The "why it's better" note matters more than the code — a ratchet is an *incentive*, and the design choices (what you count, when you write back, what you compare against) are the whole game. Refer back to [`middle.md`](middle.md) for the mechanics and [`professional.md`](professional.md) for the failure modes.

---

## Table of Contents

| # | Exercise | Focus | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [The minimal ratchet](#exercise-1--the-minimal-ratchet) | count → compare → fail | bash | ★ easy |
| 2 | [Auto-tighten on a decrease](#exercise-2--auto-tighten-on-a-decrease) | locking in improvements | bash | ★ easy |
| 3 | [Guard the baseline against rising](#exercise-3--guard-the-baseline-against-rising) | monotonic invariant | bash | ★ easy |
| 4 | [Count structured output, not text](#exercise-4--count-structured-output-not-text) | deterministic metric | Python | ★★ medium |
| 5 | [Configure `eslint --max-warnings`](#exercise-5--configure-eslint---max-warnings) | tool-native ratchet | config | ★ easy |
| 6 | [A `betterer` ratchet for `@ts-ignore`](#exercise-6--a-betterer-ratchet-for-ts-ignore) | per-violation snapshot | TS | ★★ medium |
| 7 | [Per-directory budgets](#exercise-7--per-directory-budgets) | per-area isolation | Python | ★★ medium |
| 8 | [Compare against the merge-base](#exercise-8--compare-against-the-merge-base) | correct comparison point | bash | ★★ medium |
| 9 | [Count the escape hatches](#exercise-9--count-the-escape-hatches) | un-gameable metric | Python | ★★★ hard |
| 10 | [Serialized post-merge write-back](#exercise-10--serialized-post-merge-write-back) | race-free tightening | bash | ★★★ hard |
| 11 | [Ratchet TypeScript `strict` adoption](#exercise-11--ratchet-typescript-strict-adoption) | incremental strict mode | config | ★★★ hard |

---

## Exercise 1 — The minimal ratchet

**Focus:** count → compare → fail · **Language:** bash · **Difficulty:** ★ easy

Write the smallest possible ratchet: it reads a committed baseline number, counts current violations, and **fails (exit 1) if the current count is greater**. Assume a command `violations` prints one violation per line.

**Acceptance criteria**
- Reads the baseline from a committed file `.baseline`.
- Fails *only* on a genuine increase (`current > baseline`), not on equal.
- Prints both numbers so a red build is debuggable.

**Hint:** the comparison is `-gt`, not `-ge`. The difference is a one-line ratchet bug (Exercise in `find-bug.md`).

<details>
<summary>Solution</summary>

```bash
#!/usr/bin/env bash
# ratchet.sh — fail if violations increased above the committed baseline.
set -euo pipefail

baseline=$(cat .baseline)
current=$(violations | grep -c '^')

echo "baseline=$baseline current=$current"

if [ "$current" -gt "$baseline" ]; then
  echo "❌ violations increased: $current > $baseline (+$((current - baseline)))"
  exit 1
fi
echo "✓ no new violations ($current ≤ $baseline)"
```

**Why it's better.** It does exactly one job correctly: a *new* violation turns the build red, while a no-op or improvement passes. The `-gt` (strictly greater) is load-bearing — `-ge` would fail every PR that left the count unchanged, blocking all work. Printing both numbers means a failing CI log explains itself.

</details>

---

## Exercise 2 — Auto-tighten on a decrease

**Focus:** locking in improvements · **Language:** bash · **Difficulty:** ★ easy

Extend Exercise 1: when a PR *reduces* the count, rewrite `.baseline` to the new lower number so the improvement is locked in. (For now, assume a single writer — concurrency is Exercise 10.)

**Acceptance criteria**
- On `current < baseline`: write the new count to `.baseline` and signal the caller to commit it.
- On `current == baseline`: do nothing, pass.
- On `current > baseline`: fail, do **not** write.

**Hint:** the write must happen **only** on a decrease. Writing unconditionally is the #1 broken-ratchet bug.

<details>
<summary>Solution</summary>

```bash
#!/usr/bin/env bash
set -euo pipefail

baseline=$(cat .baseline)
current=$(violations | grep -c '^')
echo "baseline=$baseline current=$current"

if [ "$current" -gt "$baseline" ]; then
  echo "❌ increased: $current > $baseline"; exit 1
fi

if [ "$current" -lt "$baseline" ]; then
  echo "$current" > .baseline      # tighten — lock in the improvement
  echo "✓ improved $baseline → $current; commit .baseline"
else
  echo "✓ unchanged at $baseline"
fi
```

**Why it's better.** The baseline now ratchets — every improvement becomes the new floor, so a fixed violation can never be silently re-added. Critically, the write is **conditional on a decrease**: an unconditional `echo "$current" > .baseline` would absorb increases too, and the gate would never fail (the classic dead ratchet). The "commit `.baseline`" instruction is the reminder that a tightened baseline is worthless until it's persisted.

</details>

---

## Exercise 3 — Guard the baseline against rising

**Focus:** monotonic invariant · **Language:** bash · **Difficulty:** ★ easy

A ratchet is only as strong as the rule that the baseline can't be *loosened*. Write a check that fails a PR which **raises** the committed baseline (the easiest way to make a red build green is to bump the number).

**Acceptance criteria**
- Compares the PR's `.baseline` against `main`'s `.baseline`.
- Fails if the new value is greater than the old.
- Passes if it's equal or lower.

**Hint:** read the old value with `git show origin/main:.baseline`.

<details>
<summary>Solution</summary>

```bash
#!/usr/bin/env bash
# no-loosen.sh — reject any PR that raises the baseline (loosens the ratchet).
set -euo pipefail

old=$(git show origin/main:.baseline 2>/dev/null || echo 0)
new=$(cat .baseline)

if [ "$new" -gt "$old" ]; then
  echo "❌ baseline raised $old → $new — that LOOSENS the ratchet."
  echo "   If this is an intentional re-baseline (e.g. linter upgrade),"
  echo "   do it in a dedicated, reviewed commit with justification."
  exit 1
fi
echo "✓ baseline did not rise ($old → $new)"
```

**Why it's better.** Without this guard, the ratchet is trivially defeated: a developer facing a red build just edits `.baseline` upward to absorb their new violations. This check makes loosening the ratchet a **visible, justified event** rather than a silent one — and pairs naturally with putting `.baseline` under `CODEOWNERS` so a human must approve any rise. The escape hatch (intentional re-baseline on a tool upgrade) is allowed but must be its own reviewed commit.

</details>

---

## Exercise 4 — Count structured output, not text

**Focus:** deterministic metric · **Language:** Python · **Difficulty:** ★★ medium

Grepping a linter's human output is fragile: summary lines, file headers, and color codes throw off `wc -l`. Rewrite the count to parse **structured JSON** output.

Starting point (fragile):

```bash
current=$(eslint . | grep -c warning)   # counts the word "warning" anywhere — wrong
```

**Acceptance criteria**
- Counts violations from `eslint -f json`, not from human text.
- Sums errors + warnings across all files.
- Is deterministic: the same commit yields the same number every run.

**Hint:** `eslint -f json` emits a list of file objects, each with `errorCount` and `warningCount`.

<details>
<summary>Solution</summary>

```python
#!/usr/bin/env python3
"""count.py — deterministic violation count from structured ESLint output."""
import json
import subprocess

def count() -> int:
    out = subprocess.run(
        ["npx", "eslint", ".", "-f", "json"],
        capture_output=True, text=True,
    ).stdout
    results = json.loads(out)
    return sum(f["errorCount"] + f["warningCount"] for f in results)

if __name__ == "__main__":
    print(count())
```

**Why it's better.** `grep -c warning` would also match the word "warning" inside a code snippet, a rule name, or a summary line — and any change to ESLint's human formatting silently changes the count. Parsing `-f json` reads the tool's *actual* counts, so the number is exact and stable across tool-output cosmetic changes. A reproducible count is a prerequisite for a trustworthy gate: if the same commit can produce two different numbers, the ratchet flakes and gets ignored (see [`professional.md`](professional.md) on flaky counts).

</details>

---

## Exercise 5 — Configure `eslint --max-warnings`

**Focus:** tool-native ratchet · **Difficulty:** ★ easy

You have a JS/TS repo with 1,290 lint warnings. Configure the simplest possible ratchet using ESLint's built-in flag, so the build fails the moment anyone adds a 1,291st warning.

**Acceptance criteria**
- A `package.json` script that fails CI on an increase.
- A comment recording that the ceiling is meant to *decrease* over time.

<details>
<summary>Solution</summary>

```jsonc
// package.json
{
  "scripts": {
    // Ratchet: today's count is 1290. The build fails at 1291.
    // LOWER this number whenever you bring the real count down — never raise it.
    "lint:ratchet": "eslint . --max-warnings 1290"
  }
}
```

```yaml
# CI
- run: npm run lint:ratchet     # non-zero exit on the 1291st warning → red build
```

**Why it's better.** Zero new infrastructure — ESLint already exits non-zero above the ceiling. The trade-offs are honest: it's a *single global number you maintain by hand*, and it's silenceable (an `eslint-disable` lowers the count without fixing anything). It's the right *starter*; you graduate to `betterer` (Exercise 6) when you need swap-detection or multiple metrics. The comment makes the monotonic intent explicit so a future reader doesn't "fix the red build" by bumping the number up.

</details>

---

## Exercise 6 — A `betterer` ratchet for `@ts-ignore`

**Focus:** per-violation snapshot · **Language:** TypeScript · **Difficulty:** ★★ medium

Your codebase has 214 `// @ts-ignore` comments. Set up a `betterer` ratchet that snapshots all 214, fails CI on a 215th, and tightens when one is removed — using a per-violation snapshot so "fix one, add another" is detected.

**Acceptance criteria**
- A `.betterer.ts` test that matches `@ts-ignore` across the source.
- The CI invocation is **read-only** (fails on regression, never updates the snapshot).
- The committed snapshot is the baseline.

**Hint:** `regexp()` from `@betterer/regexp`; CI runs `betterer ci`.

<details>
<summary>Solution</summary>

```typescript
// .betterer.ts
import { regexp } from '@betterer/regexp';

export default {
  'no new @ts-ignore (ratchet 214 → 0)': () =>
    regexp(/@ts-ignore/).include('./src/**/*.ts'),
};
```

```bash
# One-time: snapshot the 214 existing occurrences, then commit the snapshot.
npx betterer
git add .betterer.ts .betterer.results
git commit -m "ratchet: freeze @ts-ignore at 214"
```

```yaml
# CI — READ-ONLY gate. Fails on a 215th; passes (no write) when one is removed.
- run: npx betterer ci
```

**Why it's better.** `.betterer.results` records *each* `@ts-ignore` by file + a hash of its context, so removing occurrence A and adding occurrence B is seen as "−1 known, +1 unknown" and **fails** — even though the total is still 214. A bare count would pass that swap. The snapshot format also merges cleanly (different fixes touch different keys). The crucial discipline is `betterer ci` (read-only) in CI: plain `betterer` would *update* the snapshot to the current state and never fail — silently disabling the ratchet.

</details>

---

## Exercise 7 — Per-directory budgets

**Focus:** per-area isolation · **Language:** Python · **Difficulty:** ★★ medium

A single global budget means one team's regression breaks everyone's build. Write a ratchet that holds a **separate budget per directory**, gates each independently, and tightens each independently.

Given a budgets file:

```json
{ "payments/": 120, "reporting/": 540, "auth/": 38 }
```

**Acceptance criteria**
- Each directory's violations are gated against its own budget.
- A regression in one directory fails only that directory.
- A decrease in one directory tightens only that budget.
- Files are attributed to a directory by path prefix.

<details>
<summary>Solution</summary>

```python
#!/usr/bin/env python3
"""per_dir_ratchet.py — independent budget per directory."""
import json, subprocess
from collections import Counter
from pathlib import Path

BUDGETS = Path(".ratchet-budgets.json")

def counts_by_dir(dirs) -> Counter:
    out = subprocess.run(["npx", "eslint", ".", "-f", "json"],
                         capture_output=True, text=True).stdout
    tally = Counter()
    for f in json.loads(out):
        n = f["errorCount"] + f["warningCount"]
        # longest matching prefix wins (so nested dirs attribute correctly)
        match = max((d for d in dirs if d in f["filePath"]), key=len, default=None)
        if match:
            tally[match] += n
    return tally

def main() -> int:
    budgets = json.loads(BUDGETS.read_text())
    now = counts_by_dir(budgets)
    failed = changed = False
    for d, allowed in list(budgets.items()):
        c = now.get(d, 0)
        if c > allowed:
            print(f"❌ {d}: {c} > {allowed} (+{c - allowed})"); failed = True
        elif c < allowed:
            budgets[d] = c; changed = True
            print(f"✓ {d}: improved {allowed} → {c}")
        else:
            print(f"✓ {d}: holds at {allowed}")
    if changed and not failed:
        BUDGETS.write_text(json.dumps(budgets, indent=2) + "\n")
    return 1 if failed else 0

if __name__ == "__main__":
    raise SystemExit(main())
```

**Why it's better.** A regression in `reporting/` now fails only the `reporting/` budget — `payments/` keeps merging green, and one team's cleanup no longer subsidizes another's mess (the global-count fairness bug). The budgets file also makes the worst area visible at a glance, which is where you point [hotspot-driven](../03-hotspot-analysis/senior.md) cleanup. The trade-off is maintenance: split budgets to the **ownership boundary** (per team-owned directory), not finer, or you get "death by a thousand budgets."

</details>

---

## Exercise 8 — Compare against the merge-base

**Focus:** correct comparison point · **Language:** bash · **Difficulty:** ★★ medium

A PR is being failed for violations it didn't introduce — they landed on `main` *after* the branch was cut. Fix the comparison so a PR is judged only against the state it branched from.

Starting point (buggy):

```bash
old=$(git show origin/main:.baseline)   # tip of main — includes commits made AFTER this branch
```

**Acceptance criteria**
- The PR's regression is computed against the **merge-base**, not `main`'s tip.
- A PR is never blamed for violations another PR added after it branched.

**Hint:** `git merge-base origin/main HEAD` gives the commit where the branch diverged.

<details>
<summary>Solution</summary>

```bash
#!/usr/bin/env bash
# Compare against the MERGE-BASE: where this branch diverged from main.
set -euo pipefail

base_commit=$(git merge-base origin/main HEAD)
baseline=$(git show "$base_commit":.baseline)   # the floor THIS branch started from
current=$(violations | grep -c '^')

echo "merge-base=$base_commit baseline=$baseline current=$current"
if [ "$current" -gt "$baseline" ]; then
  echo "❌ this branch increased violations: $current > $baseline"; exit 1
fi
echo "✓ no regression vs merge-base"
```

**Why it's better.** Comparing against the **tip of `main`** punishes a PR for violations introduced by *other* PRs merged after it branched — a maddening, flaky-feeling failure that erodes trust in the gate. The merge-base is the exact state the branch started from, so the comparison measures *only this branch's effect*. This is the silent correctness bug behind many "the ratchet is blaming me for someone else's mess" complaints.

</details>

---

## Exercise 9 — Count the escape hatches

**Focus:** un-gameable metric · **Language:** Python · **Difficulty:** ★★★ hard

A ratchet on `@ts-ignore` alone is gameable: engineers swap it for `@ts-expect-error`, `as any`, or a bare `: any`. Write a metric that counts the **whole family** of type-escape hatches as one number, so hiding a type error costs the same as adding one.

**Acceptance criteria**
- Counts `@ts-ignore`, `@ts-expect-error`, `as any`, and `: any` (whole-word) across `src/`.
- Returns a single combined count to ratchet.
- Briefly note why each pattern belongs in the family.

<details>
<summary>Solution</summary>

```python
#!/usr/bin/env python3
"""escape_hatches.py — one combined count of all TS type-escape mechanisms."""
import re
from pathlib import Path

# Each pattern silences or erases the type checker; counting only one just
# redirects gaming to the others. Count the family.
PATTERNS = [
    re.compile(r"@ts-ignore"),         # silence the next line's error
    re.compile(r"@ts-expect-error"),   # the "nicer" silence — still an escape
    re.compile(r"\bas\s+any\b"),       # cast away the type
    re.compile(r":\s*any\b"),          # annotate away the type
]

def count(root: str = "src") -> int:
    total = 0
    for path in Path(root).rglob("*.ts"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        total += sum(len(p.findall(text)) for p in PATTERNS)
    return total

if __name__ == "__main__":
    print(count())
```

**Why it's better.** Ratcheting `@ts-ignore` in isolation just teaches the team to reach for `as any` instead — the type errors don't go away, they wear a different mask, and the metric reports false progress (Goodhart). Counting the *family* makes every escape mechanism cost the same, so the cheapest way to lower the number is to **actually fix the type**. The comment is load-bearing: it documents *why* each pattern is an escape, so the next maintainer doesn't "clean up" the list and reopen a hole. (To go further, add suppression comments — `eslint-disable`, `// @ts-nocheck` — to the family too.)

</details>

---

## Exercise 10 — Serialized post-merge write-back

**Focus:** race-free tightening · **Language:** bash · **Difficulty:** ★★★ hard

When two PRs merge seconds apart, two post-merge jobs both recompute and push the baseline — a lost-update race that can clobber a fix or write a stale number. Write a write-back that is **safe under concurrency**: it always derives the baseline from the *latest* `main` and pushes atomically.

**Acceptance criteria**
- Recomputes the count against the current tip of `main` (not a stale snapshot).
- Pushes fast-forward-only; on a push race, retries (re-fetching and recomputing).
- Only ever *lowers* the baseline.

**Hint:** loop: `fetch` → `reset --hard origin/main` → recompute → conditional write → `push`; retry on push failure.

<details>
<summary>Solution</summary>

```bash
#!/usr/bin/env bash
# post-merge-baseline.sh — the SINGLE writer. Race-safe via recompute + ff-only retry.
set -euo pipefail

for attempt in 1 2 3 4 5; do
  git fetch origin main
  git reset --hard origin/main           # always start from the LATEST merged state

  current=$(violations | grep -c '^')    # recompute against current main, not a stale number
  baseline=$(cat .baseline)

  if [ "$current" -ge "$baseline" ]; then
    echo "✓ no improvement to record ($current ≥ $baseline)"; exit 0
  fi

  echo "$current" > .baseline
  git commit -am "ratchet: recompute baseline → $current [skip ci]"

  if git push origin HEAD:main; then     # ff-only; fails if another job pushed first
    echo "✓ baseline tightened to $current"; exit 0
  fi
  echo "push race on attempt $attempt; retrying…"
  sleep $((attempt * 2))
done

echo "❌ could not update baseline after retries"; exit 1
```

**Why it's better.** The naïve version reads the baseline once and pushes blindly, so two concurrent jobs lose each other's updates and may persist a number computed against pre-other-merge code. This version makes the baseline a **derived value, recomputed against the live `main` inside the retry loop** — so whichever job wins the push race writes a number that reflects *all* merged changes, and a loser simply retries against the now-updated `main`. That's the single-writer / immutable-snapshot discipline from concurrency, applied to a file in git. Keeping this the *only* writer (PR-time gates are read-only) removes the race surface entirely.

</details>

---

## Exercise 11 — Ratchet TypeScript `strict` adoption

**Focus:** incremental strict mode · **Difficulty:** ★★★ hard

Turning on `strict: true` across a 2M-line TS codebase yields thousands of errors at once — an unreachable zero-gate. Design a ratchet that adopts `strict` **file by file** by ratcheting the *exclusion list* down to zero.

**Acceptance criteria**
- `strict` is on globally; a baseline list of files is *excluded* from strict checking.
- The ratchet's metric is the **length of the exclusion list** — it may only shrink.
- Reaching an empty list lets you delete the exclusion mechanism and go fully strict.

**Hint:** keep a `strict-excludes.json` list; `betterer` (or a script) ratchets its length; PRs remove files as they're made clean.

<details>
<summary>Solution</summary>

```jsonc
// tsconfig.json — strict on for everyone…
{ "compilerOptions": { "strict": true } }
```

```json
// strict-excludes.json — …except these legacy files (the baseline list).
[
  "src/legacy/billing.ts",
  "src/legacy/reports.ts",
  "src/payments/old-gateway.ts"
]
```

```python
#!/usr/bin/env python3
"""strict_ratchet.py — the exclusion list may only get SHORTER."""
import json, sys
from pathlib import Path

EXCLUDES = Path("strict-excludes.json")

def main() -> int:
    new = json.loads(EXCLUDES.read_text())
    import subprocess
    old_raw = subprocess.run(
        ["git", "show", "origin/main:strict-excludes.json"],
        capture_output=True, text=True).stdout or "[]"
    old = json.loads(old_raw)

    added = set(new) - set(old)
    if added:
        print(f"❌ files ADDED to strict-excludes (regression): {sorted(added)}")
        print("   Make new files strict-clean; never opt them out.")
        return 1
    removed = set(old) - set(new)
    if removed:
        print(f"✓ {len(removed)} file(s) made strict-clean: {sorted(removed)}")
    print(f"strict-excludes: {len(old)} → {len(new)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

A CI step type-checks excluded files loosely and everything else under `strict`; this ratchet ensures the exclusion list only shrinks. When it hits `[]`, delete `strict-excludes.json` and the loose path — the codebase is fully strict.

**Why it's better.** The flag-day alternative ("make 2M lines strict-clean this sprint") is impossible, so it never happens and the codebase stays loosely typed forever. Ratcheting the **exclusion list** turns it into a monotonic grind: every PR that cleans a file removes it from the list (locked in — nothing may re-add it), and `strict` protects all new files from day one. The end state is a *binary gate* (`strict: true`, no excludes) — the ratchet was the on-ramp. This is the single highest-leverage quality migration a typed-language codebase can ratchet.

</details>

---

## Summary

- These exercises build a ratchet from its core (count → compare → fail) outward to the things that make it survive a real org: **conditional tightening**, a **no-loosen guard**, a **deterministic structured count**, **merge-base** comparison, **per-directory** isolation, **escape-hatch** metrics, **race-free** write-back, and **incremental strict-mode** adoption.
- **The recurring design rules:** fail only on a true increase (`-gt`, not `-ge`); write the baseline **only on a decrease** and **only from one serialized writer**; count **structured output** and the **whole family** of escape hatches; compare against the **merge-base**; and put the baseline under review (`CODEOWNERS`) so loosening is visible.
- **The baseline is shared mutable state in a concurrent system** — treat it like one (single writer, recompute-don't-merge, atomic push), which is why several "hard" exercises are really concurrency exercises.
- **A ratchet stops the bleeding; it doesn't heal.** Pair every ratchet with deliberate downward pressure (Boy-Scout cleanup, hotspot work, automated refactoring), and at zero **promote it to a binary gate**.

---

## Related Topics

- [`junior.md`](junior.md) — why zero-on-legacy fails and a ratchet works.
- [`middle.md`](middle.md) — baselines, tightening, per-directory budgets, betterer/`--max-warnings`.
- [`senior.md`](senior.md) — rollout at scale, un-gameable metrics, hotspots-first.
- [`professional.md`](professional.md) — the failure modes these exercises harden against.
- [`find-bug.md`](find-bug.md) — broken ratchets to diagnose.
- [`optimize.md`](optimize.md) — making a whole-repo ratchet fast.
- [`interview.md`](interview.md) — Q&A across all levels.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/senior.md) — the general frame for these gates.
