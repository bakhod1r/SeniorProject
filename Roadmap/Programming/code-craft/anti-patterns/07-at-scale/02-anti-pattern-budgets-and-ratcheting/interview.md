# Anti-Pattern Budgets & Ratcheting — Interview Questions

> **Category:** [Anti-Patterns at Scale](../README.md) → **Anti-Pattern Budgets & Ratcheting** — *make the metric monotonically improve: stop the bleeding while you clean up legacy.*
> **Covers (collectively):** Baseline-and-ratchet · "No new violations" gates · Per-area debt budgets · Ratchet tooling · Failing the build on regression

---

## How to Use This File

30+ questions, grouped from fundamentals to staff-level judgment. Each has a **short answer** (what you'd say out loud) and, where useful, a **deeper note** (what separates a strong answer from a memorized one). Read the question, answer it yourself, then expand.

> The signal interviewers look for here isn't "do you know what a ratchet is" — it's whether you understand that **a ratchet is an incentive deployed against a large org**, and can reason about merge mechanics, gaming, and metric choice under that lens.

---

## Table of Contents

1. [Fundamentals](#fundamentals)
2. [Baselines & Storage](#baselines--storage)
3. [Tooling](#tooling)
4. [Metric Choice & Gaming](#metric-choice--gaming)
5. [Merges, Races & Scale](#merges-races--scale)
6. [Strategy & Judgment](#strategy--judgment)

---

## Fundamentals

### Q1. What is a ratchet, in one sentence?

**Short answer.** A CI gate that lets a quality metric's count stay the same or go down, but **never up** — so a legacy codebase can only get cleaner over time without anyone having to fix it all at once.

**Deeper note.** Name the property explicitly: **monotonic non-increasing**. That word is the whole idea.

---

### Q2. Why not just set the linter to fail on *any* violation (zero-gate) on a legacy codebase?

**Short answer.** The existing violations are still there, so the build is **red for everyone immediately** and nobody can merge. The gate gets reverted or bypassed with mass suppressions within a day. Zero is the right *destination* but an unreachable *gate* on legacy.

**Deeper note.** A zero-gate conflates two goals — *stop the bleeding* (achievable now) and *heal the wound* (months of work). The ratchet enforces the first strictly and lets the second happen gradually.

---

### Q3. What's the difference between a ratchet and an absolute (binary) gate?

**Short answer.** An **absolute gate** asserts a fixed condition ("zero warnings," "no import cycles") — pass/fail. A **ratchet** asserts a *relative, improving* condition ("no more than today, trending down"). Use absolute for greenfield (zero from day one); use a ratchet to retrofit a constraint onto legacy you can't make zero yet.

**Deeper note.** They're the same tool in two phases: the ratchet drives a count to zero, then you **promote** it to a binary gate that forbids the violation forever. A ratchet is the on-ramp to an absolute gate.

---

### Q4. How does a ratchet relate to the Boy-Scout Rule?

**Short answer.** The Boy-Scout Rule ("leave it cleaner than you found it") is a *voluntary* cultural habit. A ratchet is its *mechanical enforcement*: it doesn't ask you to clean up, it **forbids** leaving things dirtier and **locks in** any cleanup you do so it can't be undone.

---

### Q5. What is the single most important property of a ratchet, and what breaks if you lose it?

**Short answer.** **Monotonicity** — the baseline only ever moves *down*. Lose it (e.g. the baseline auto-updates to the current count every run) and the gate is decorative: the build is always green no matter how many violations you add.

---

### Q6. A PR removes 5 warnings. What should the ratchet do, and why does it matter?

**Short answer.** **Tighten the baseline** to the new lower number, so those 5 fixes are **locked in** — they can never be re-introduced without the build going red. If the baseline didn't tighten, the next PR could re-add 5 warnings for free.

---

## Baselines & Storage

### Q7. Where should the baseline live?

**Short answer.** In a **version-controlled file in the repo**, so every branch compares against the same agreed floor and code review sees every change to it — including a suspicious *increase*. Alternatives: an external service (SonarQube) or **no file at all** (diff-based new-code gate).

**Deeper note.** A CI environment variable is wrong: it's invisible to review and editable out-of-band.

---

### Q8. Bare count vs hashed per-violation baseline — what's the trade-off?

**Short answer.** A **bare count** (one integer) is simple but can't tell "fixed X, added Y" from "no change," and conflicts on every merge. A **hashed per-violation set** identifies each violation by file + a hash of its context, so it detects swaps and merges cleanly (different fixes touch different keys). The cost is a bigger file and a stable hash function.

---

### Q9. Why hash the *context* of a violation rather than key on the line number?

**Short answer.** Line numbers shift on every insertion above the violation, so a line-number key invalidates every record below an edit. A hash of the **surrounding code** is position-tolerant — inserting a blank line doesn't change which violations the baseline recognizes.

---

### Q10. How does a "new code" / diff-based gate avoid needing a baseline file at all?

**Short answer.** It uses the **PR's own diff** (against its merge-base) as the baseline: "new or changed lines must have zero new issues," exempting legacy lines. Nothing is persisted between PRs, so there's no file to conflict, no whole-repo recompute, and no legacy pool to swap against.

**Deeper note.** The catch: it only stops *new* bleeding; it doesn't reduce existing legacy on its own.

---

### Q11. Why is a committed baseline file a problem in a high-throughput monorepo?

**Short answer.** Every PR that changes the count rewrites the same file, so it **conflicts on nearly every merge** and can silently mis-resolve to a looser number. At hundreds of PRs/day you spend more time resolving baseline conflicts than fixing violations.

---

## Tooling

### Q12. What does ESLint's `--max-warnings N` do, and how is it a ratchet?

**Short answer.** It exits non-zero if there are more than `N` warnings. Set `N` to today's count; the build fails the moment a PR pushes it to `N+1`. You lower `N` as you clean up. It's the simplest tool-native ratchet — a single global ceiling.

**Deeper note.** Limitation: one global number, manually maintained, and silenceable (an `eslint-disable` lowers the count without fixing anything).

---

### Q13. What is `betterer` and what does it add over `--max-warnings`?

**Short answer.** `betterer` is a dedicated ratchet framework: you declare *tests* (each a metric), and it stores a **per-violation snapshot** in `.betterer.results`, failing CI if any test regresses. Over `--max-warnings` it adds: multiple metrics, **swap detection** (per-violation hashing), and a **merge-friendly** baseline format.

---

### Q14. Why must CI run `betterer ci` and not plain `betterer`?

**Short answer.** Plain `betterer` runs in *write* mode — it **updates** `.betterer.results` to the current count, so it records whatever exists and never reports a regression. `betterer ci` is **read-only**: it only *fails* on regression. Running write-mode in CI silently disables the ratchet (the same trap as auto-updating a hand-rolled baseline).

---

### Q15. `betterer` vs SonarQube's new-code gate — when would you pick each?

**Short answer.** **`betterer`** when you want metrics defined *in the repo*, multiple custom checks, and a committed snapshot (good for JS/TS, offline, reviewable). **SonarQube new-code gate** when you're already running Sonar, want a *server-side, polyglot, diff-based* gate with dashboards and no baseline file to maintain. `betterer` drives legacy down via its snapshot; the new-code gate only guards the diff.

---

### Q16. How would you build a ratchet for a metric no tool supports out of the box?

**Short answer.** Write a small script: run the analyzer, count from **structured output** (not grepped text), compare to a committed baseline, exit non-zero on an increase, and tighten the baseline (from a single serialized writer) on a decrease. It's ~30 lines; the hard parts are determinism and the write-back, not the comparison.

---

## Metric Choice & Gaming

### Q17. Why should you never ratchet "lines of code"?

**Short answer.** LOC measures nothing about quality and is **trivially gamed** — split a file, minify, one-line everything. The number goes down with zero improvement. This is **Goodhart's law**: when a measure becomes a target it stops being a good measure.

---

### Q18. You ratchet "lint warnings." A teammate notes people can write `// eslint-disable`. What do you change?

**Short answer.** Count **warnings *plus* suppressions** as one combined metric. Otherwise the cheapest way to lower the count is to *silence* warnings, not fix them — the ratchet rewards hiding debt. The principle: **make hiding a violation cost the same as adding one.**

---

### Q19. What is Goodhart's law and why does every ratchet live under it?

**Short answer.** "When a measure becomes a target, it ceases to be a good measure." A ratchet *is* a target — engineers optimize for green CI — so any slack in the metric gets exploited. You can't escape it; you can only choose metrics where **fixing is cheaper than gaming** and monitor the gaming (suppressions, exclude-list growth) as second-order metrics.

---

### Q20. List concrete ways a ratchet metric gets gamed and the counter for each.

**Short answer.**
- **Suppress, don't fix** (`eslint-disable`, `@SuppressWarnings`) → count suppressions too.
- **Swap escape hatch** (`@ts-ignore`→`as any`) → count the whole family.
- **Move to an excluded dir** → ratchet the size of the exclude list.
- **Generate/vendor around it** → lint generated/first-party code explicitly.
- **Swap one violation for another (bare count)** → hashed per-violation baseline.
- **Raise the baseline** → "baseline must not rise" guard + `CODEOWNERS` on the file.

---

### Q21. How do you make a "be the adversary" check part of choosing a metric?

**Short answer.** Before shipping a ratchet, spend ten minutes asking: *"If I had to make this number drop by Friday and didn't care about quality, what would I do?"* If the answer is fast and harmful (suppress, swap, move), fix the metric — count the escape hatches, or gate the diff — *before* rollout.

---

## Merges, Races & Scale

### Q22. Walk through why a bare-count baseline conflicts on merge, and the mis-resolution risk.

**Short answer.** Two PRs both change the count, so both edit the **single line** of the file relative to the merge-base → git conflict. Resolving it, a developer picks one number, **discarding the other PR's improvement** and possibly leaving the baseline *looser* than the true post-merge count — slack the next PR fills for free.

---

### Q23. How do hashed per-violation baselines merge without conflict?

**Short answer.** Each violation is a separate keyed record. Two PRs fixing violations in **different files** edit **different keys**, so a three-way merge contains both fixes cleanly — there's no shared region to conflict on.

---

### Q24. Your PR fails the ratchet for violations it didn't introduce. What's the likely bug?

**Short answer.** The gate is comparing against the **tip of `main`** instead of the **merge-base** where the branch diverged, so violations added to `main` *after* you branched are attributed to you. Fix: compute "did I regress?" against the **merge-base**.

---

### Q25. Two post-merge jobs update the baseline at once. What's the race and the fix?

**Short answer.** **Lost update:** both read the old baseline, compute different numbers from pre-other-merge code, and race to push; one clobbers the other. Fix: **one serialized writer** that, in a *fetch → reset to latest `main` → recompute → fast-forward-only push with retry* loop, always derives the baseline from the *current* merged state.

---

### Q26. Your ratchet count is 1844 on CI but 1846 locally for the same commit. Causes and cure?

**Short answer.** Tool version drift, plugin/config differences, or non-deterministic parallelism/caching. Cure: **pin everything** and treat **CI (a pinned container) as the single authoritative count**; local is advisory. Verify reproducibility (same commit → same number 10×) *before* gating — a flaky gate trains the team to ignore CI.

---

### Q27. The ratchet re-analyzes the whole 2M-line repo on every PR and is now the slowest check. How do you fix it?

**Short answer.** Scope to **changed files** (analyze the diff, not the world), enable **incremental caching** (`eslint --cache`, `tsc --incremental`), and on a monorepo ride the **affected-target graph** (Bazel/Nx/Turborepo). Run a **full scan on a slower cadence** (nightly) as a backstop to catch cross-file effects the changed-files gate can miss.

---

### Q28. What correctness case does "changed files only" miss, and how do you cover it?

**Short answer.** A violation your change **introduces in a file you didn't touch** (e.g. deleting a symbol makes an unchanged file's rule newly fire). Cover it with a **full analysis on a slower cadence** while the fast per-PR gate stays scoped — speed on the hot path, completeness on a slower one.

---

### Q29. How do you structure ratchets in a large multi-team monorepo?

**Short answer.** **Per-package budgets co-located with the package** (`packages/billing/.ratchet.json`), owned via `CODEOWNERS`. This eliminates cross-team conflicts (different files), isolates failures (a regression fails only that package), and aligns ownership. Run only the ratchets for **affected** packages. Split to the *ownership boundary*, no finer.

---

## Strategy & Judgment

### Q30. Which violations do you ratchet first, and what signal drives that?

**Short answer.** The **hotspots** — files with high **churn × complexity**, found from git history. Stopping the bleeding where code changes most often buys the most quality per unit of friction; cold files can't regress anyway, so ratcheting them buys nothing.

---

### Q31. "A ratchet is a fitness function." Explain, and what does it imply about the end state?

**Short answer.** A fitness function is an automated test of a system characteristic; a ratchet is the kind **whose metric is a count and whose target is "monotonically non-increasing."** Implication: when the count hits **zero**, you **promote** it to a *binary* fitness function (`--max-warnings 0`) that forbids the violation forever. The ratchet is the on-ramp; the absolute gate is the destination.

---

### Q32. How would you ratchet a 2M-line TypeScript codebase toward `strict` mode?

**Short answer.** Two shapes: **(a)** enable `strict` globally and ratchet the **list of files still excluded** — it can only shrink; or **(b)** turn `strict` on, baseline the resulting **error count** (say 4,200) and drive it to zero. Both turn an impossible flag-day migration into a monotonic grind any PR can advance and none can reverse; at zero, flip to `strict: true` with no exclusions.

---

### Q33. What's the most dangerous failure mode of a ratchet, and why is it worse than no ratchet?

**Short answer.** **A ratchet that flawlessly enforces the *wrong* metric.** Because a ratchet makes a metric *permanent and load-bearing*, and a green build *certifies progress*, a bad metric means the org optimizes the wrong thing for a long time and can't easily stop — the green status masks the degradation. No ratchet at least doesn't lie about direction.

**Deeper note.** Example: ratcheting "cyclomatic complexity ≤ 10" leads engineers to shatter a readable function into five that share state — the number improves, the code worsens. Guard against it by tying each ratchet to a *written goal*, auditing ratchets quarterly like feature flags, and being willing to **retire** one.

---

### Q34. A ratchet reached zero and its rule is now obsolete (it bans a pattern nobody uses). What do you do?

**Short answer.** **Delete it.** A green, meaningless gate is a [Boat Anchor](../../01-development/01-bad-structure/junior.md) in your CI — keeping it trains the team to route around gates. Ratchets, like feature flags, need a retirement plan.

---

### Q35. How do you roll out a ratchet so it doesn't get disabled in week one?

**Short answer.** Start **green** (baseline = today's count, so the first run passes), **non-blocking** (informational for a week so teams trust it), and on the **hotspots** (highest value). Then flip to required. Enforce the "baseline can't rise" invariant. The initiative succeeds on **trust** — a flaky count, a globally-red build, or a mysteriously-risen baseline kills it fast.

---

### Q36. When is the "new code is clean" framing better than a count-based ratchet?

**Short answer.** Almost always at scale: it needs **no baseline file** (no conflicts), is **O(diff)** (fast), and is **un-gameable by swapping** (no legacy pool). You add a count-based ratchet or scheduled hotspot work *alongside* it only when you also need to actively **drive legacy down**, which the new-code gate alone doesn't do.

---

## Related Topics

- [`junior.md`](junior.md) — the core idea: don't make it worse; why zero-on-legacy fails.
- [`middle.md`](middle.md) — baselines, auto-tightening, per-directory budgets, betterer/`--max-warnings`.
- [`senior.md`](senior.md) — rollout at scale, un-gameable metrics, merges, hotspots-first, the fitness-function frame.
- [`professional.md`](professional.md) — implementation & failure modes: conflicts, races, noise, recompute cost, entrenchment.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — hands-on drills.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/senior.md) · [Hotspot Analysis](../03-hotspot-analysis/senior.md) — the sibling topics this one sits between.
- [Clean Code → The Boy-Scout Rule](../../../clean-code/21-boy-scout-rule/README.md) — the habit a ratchet automates.
