# Coverage in CI & Diffs — Interview Questions

> **Roadmap:** [Code Coverage](../README.md) → Coverage in CI & Diffs
> *A coverage interview rarely asks "what is line coverage." It asks "your PR shows 40% patch coverage but the project is at 85% — which number gates the merge, and why?", and then watches whether you can separate the diff from the whole, the merge-base from the branch tip, and a real coverage signal from a number a developer can game. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Diff/Patch vs Project Coverage](#theme-1--diffpatch-vs-project-coverage)
3. [Theme 2 — How Patch Coverage Is Computed](#theme-2--how-patch-coverage-is-computed)
4. [Theme 3 — The Ratchet and Clean-as-You-Code](#theme-3--the-ratchet-and-clean-as-you-code)
5. [Theme 4 — Parallel Shards and Merging](#theme-4--parallel-shards-and-merging)
6. [Theme 5 — Flaky Coverage](#theme-5--flaky-coverage)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Gate Policy and Politics](#theme-7--gate-policy-and-politics)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **the diff vs the whole** (what *this PR* did vs the state of the repo)
- **a number vs a signal** (coverage as a fact about execution vs coverage as evidence of testing)
- **measure vs gate** (reporting a value vs blocking a merge on it)
- **the branch tip vs the merge-base** (your commits vs everything you'll inherit on merge)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a threshold number — and who never confuse "the line ran" with "the behavior is tested."

---

## Theme 1 — Diff/Patch vs Project Coverage

### Q1.1 — Define patch coverage and project coverage. Which should gate a PR, and why?

> **Testing:** Whether you understand the two are answers to *different questions*, not two estimates of one thing.

**A.** **Project coverage** is the ratio over the *entire codebase*: of all executable lines in the repo, what fraction did the test run execute. **Patch coverage** (also "diff coverage") is the ratio over *only the lines this PR added or modified*: of the lines you touched, what fraction your tests executed. They answer different questions — project asks "how well-tested is the system?", patch asks "did *this change* come with tests?"

**Patch coverage is the saner gate for everyday PRs.** A merge gate is a control on the *increment*, and patch coverage measures exactly the increment. Project coverage as a gate is noisy and unfair: a 200-line PR can drop project coverage by a fraction of a percent through pure dilution even with perfect tests, and it holds the author hostage to code they never touched. Patch coverage is local, attributable, and actionable — "these specific new lines aren't covered, add a test for them." That's a request a reviewer can make and an author can satisfy in the same PR.

### Q1.2 — Make the strongest argument *for* still tracking project coverage even if you gate on patch.

> **Testing:** Whether you treat the two as complementary rather than picking a tribe.

**A.** Patch coverage gates the flow; project coverage watches the stock. Gating purely on patch can let project coverage *drift down silently* — every PR covers its own diff perfectly, but deletions of tests, refactors that move logic into untested paths, or dead-code accumulation erode the whole without any single PR failing the patch gate. So I'd **gate on patch** (blocking) and **track project as a trend** (reported, alert on sustained decline), plus a "don't let project drop by more than N%" guardrail to catch egregious regressions. Patch is the steering wheel; project is the fuel gauge. You drive with the wheel but you still glance at the gauge.

### Q1.3 — A team has a 10-year-old repo at 30% project coverage. They mandate "every PR must keep project coverage ≥ 80%." What happens?

> **Testing:** The legacy-repo argument — the single most important reason patch beats project as a gate.

**A.** Every PR is instantly blocked and nothing merges, because no reasonable PR can drag a 30% repo to 80% — you'd have to write tests for thousands of untouched legacy lines just to land a typo fix. This is the **legacy deadlock**: a project-coverage gate set above current reality makes the gate impossible to satisfy through normal work, so the team either reverts the gate in frustration (and learns to distrust coverage policy) or routes around it with blanket exclusions (and the gate becomes theater). The correct policy for that repo is a **patch gate**: "new and changed lines must be ≥ 80% covered." That ratchets quality on everything the team actively touches without demanding they retroactively test a decade of code they're not changing. It converts an impossible one-time debt into a steady, fair, forward-looking improvement.

### Q1.4 — Why is patch coverage often *lower variance* and more honest than project coverage as a PR metric?

> **Testing:** Whether you understand the denominator dynamics.

**A.** Project coverage's denominator is the whole repo, so any single PR moves it by a tiny, mostly-meaningless amount dominated by *dilution* (adding lines) rather than *testing* (covering them) — the number wobbles for reasons unrelated to the author's diligence. Patch coverage's denominator is just the touched lines, so the number reflects exactly one thing: did you test what you wrote. It's high-signal precisely because the denominator is scoped to the author's actual responsibility. A 30% patch coverage is an unambiguous statement ("most of your new logic is untested"); a 0.2% project drop is statistical noise wearing the costume of a quality signal.

---

## Theme 2 — How Patch Coverage Is Computed

### Q2.1 — Walk me through how a tool computes patch coverage for a PR.

> **Testing:** Whether you see it as an *intersection of two sets of line numbers*, not magic.

**A.** It's a set intersection over line numbers, in three steps:
1. **Get the diff.** Compute the lines this PR added or changed — concretely, the added/modified lines from `git diff` against the comparison point, yielding a set of `(file, line)` pairs.
2. **Get the coverage report.** Run the suite with coverage instrumentation; the report records, per file, which lines are executable and which of those were *hit* (e.g. an LCOV `DA:line,hits` record, or Cobertura/coverage.py XML).
3. **Intersect.** For each changed *executable* line, check whether the coverage report marks it hit. Patch coverage = (changed executable lines that were hit) / (changed executable lines total). Non-executable changed lines — comments, blank lines, braces in some formats — are excluded from the denominator, which is why reformatting a file doesn't tank its patch coverage.

The subtlety is keeping the two coordinate systems aligned: the diff's line numbers and the coverage report's line numbers must refer to the *same revision of the file*, or the intersection is garbage.

### Q2.2 — Should patch coverage diff against the target branch tip, or the merge-base? Why does it matter?

> **Testing:** A genuine correctness trap that separates people who've debugged a wrong-looking number.

**A.** Against the **merge-base** — the common ancestor of your branch and the target — not the target's current tip. Here's why it matters: if you diff against the *tip*, then commits that landed on `main` *after* you branched show up as differences, and you get blamed for (or credited with) lines you never touched. The merge-base is the point where your history diverged, so diffing against it isolates *exactly your contribution*. This is the same set of changes a `git merge` would introduce, which is what you actually want the gate to evaluate.

Diffing against the tip causes two classic confusing symptoms: your patch coverage includes someone else's recent lines (noise you can't fix), or, after you rebase onto a newer `main`, the diff suddenly shrinks or grows for reasons unrelated to your edits. Merge-base makes the number stable and attributable.

### Q2.3 — A developer rebases their branch and the patch-coverage report changes even though they edited no source. Explain.

> **Testing:** Line mapping across history rewrites — the deepest part of this theme.

**A.** Two mechanisms. First, **the merge-base moved.** After a rebase, the branch's common ancestor with `main` is a newer commit, so the *set of changed lines* is recomputed against a different baseline — code that was "new" relative to the old base may now already exist in the base, leaving the diff. Second, **line numbers shift.** A rebase replays your commits on top of new history; if upstream changes altered line numbers in files you also touched, the `(file, line)` coordinates in your diff move, and they must be re-mapped onto the *freshly generated* coverage report for the rebased tree. If the CI ran coverage on the pre-rebase commit but the diff is computed post-rebase (or vice versa), the two coordinate systems disagree and you get phantom uncovered lines.

The defensive practice: always compute the diff and run coverage against *the same commit SHA*, and let the coverage service handle the merge-base resolution rather than diffing against a moving branch name. This is also why coverage services key everything by commit SHA, not branch name — SHAs are immutable, branch tips are not.

### Q2.4 — Why can a line show as "changed but not counted" in patch coverage?

> **Testing:** Whether you know coverage operates on *executable* lines, and the format gotchas.

**A.** Because the diff and the coverage instrumentation disagree on whether the line is *executable*. The diff is purely textual — it flags any altered line, including comments, blank lines, a closing brace, a function signature, or a `package`/`import` line. Coverage instrumentation only records lines the compiler/runtime considers executable statements. So a changed comment is "in the diff" but has no coverage record, and a sane tool excludes it from the patch-coverage denominator. The cases that trip people up: in some languages a method *signature* line or a `}` is not an instrumented line, so a one-line change there counts as "changed, non-executable, not measured" — which is correct, but looks like the line was ignored. The opposite bug — a tool counting non-executable changed lines in the denominator — is exactly what makes a pure-formatting PR show absurdly low patch coverage.

---

## Theme 3 — The Ratchet and Clean-as-You-Code

### Q3.1 — Explain the coverage ratchet. What problem does it solve that an absolute threshold doesn't?

> **Testing:** Whether you understand monotonic-improvement policy vs a fixed bar.

**A.** A **ratchet** is a gate that says "coverage may not *decrease*" — the bar is the current value, and it can only move up. The mechanism: store the project's coverage as a **baseline**, and on each PR fail if the new value is below baseline (minus a small tolerance); on merge, update the baseline upward to lock in gains. The problem it solves over an absolute threshold (`≥ 80%`): an absolute bar is arbitrary and bimodal — a repo below it is permanently failing (the legacy deadlock again), and a repo above it has no pressure to improve and can decay freely down to the line. A ratchet adapts to *where the repo actually is* and only ever demands "don't make it worse, and keep the wins." It turns coverage into a one-way valve.

### Q3.2 — How does "clean as you code" relate to the ratchet, and why is it the better framing for legacy code?

> **Testing:** Whether you know the Sonar-style "new code" philosophy and *why* it dissolves the legacy problem.

**A.** **Clean as you code** says: hold *new code* to a high standard and leave *old code* alone until you touch it. Applied to coverage, the gate is "coverage on new/changed code ≥ X%" (i.e. patch coverage) rather than any project-wide number. It's the same idea as a ratchet but framed around the *diff* rather than the *aggregate*: instead of "the whole repo's number can only rise," it's "everything you add or modify must meet the bar."

Why it's better for legacy: it makes the standard *independent of the legacy debt entirely*. A 30% repo and a 95% repo impose the identical demand on a new PR — cover your new lines — so there's no deadlock, no demand to test untouched code, and the codebase converges to the standard along its *active surface* (the parts people actually change), which is exactly the code where quality matters most. The untouched dead corners stay at 30% but they're untouched, so the risk is bounded.

### Q3.3 — Where do you store the baseline, and what goes wrong if you store it badly?

> **Testing:** A practical detail that reveals whether you've actually operated a ratchet.

**A.** The baseline must be keyed to a **specific commit on the target branch** and stored where every CI run can read and atomically update it — typically the coverage *service's* per-branch record (Codecov/Coveralls keep coverage per commit SHA), or, if self-hosted, a value in an artifact store or a protected branch keyed by SHA, never a mutable file in the working tree.

Failure modes: (1) **Storing the baseline in the repo** (a committed `coverage-baseline.txt`) creates merge conflicts and lets a PR lower its *own* bar in the same change — the fox guarding the henhouse. (2) **Keying by branch name instead of SHA** makes the baseline ambiguous during concurrent merges and after rebases. (3) **No atomic update** means two PRs merging near-simultaneously race to write the baseline and one gain is lost. (4) **Updating the baseline on PR runs instead of only on merge** lets a branch ratchet the bar up before it's actually merged, blocking unrelated PRs. The rule: read baseline from the merge target's last *merged* commit, update only after merge, atomically.

### Q3.4 — What's the deadlock a naive ratchet can still create, and how do you avoid it?

> **Testing:** Whether you see the subtle trap even in the "good" policy.

**A.** Even a ratchet can deadlock if it's applied to *project* coverage with **no tolerance** in a repo where normal PRs dilute. You add 50 well-tested lines, project coverage ticks down 0.05% from rounding/dilution, the "may not decrease" gate fails, and now you're blocked despite doing everything right. The fix is twofold: (1) gate the ratchet on **patch coverage**, not project — "new code ≥ X" can't be diluted by old code; and (2) if you do ratchet project, add a **tolerance band** (e.g. allow a drop of up to 0.1–0.5%) so noise doesn't trip the gate, accepting that the band is a small leak in exchange for not blocking honest work. The deeper lesson: a ratchet on the *aggregate* fights dilution; a ratchet on the *diff* sidesteps it. Prefer the diff.

---

## Theme 4 — Parallel Shards and Merging

### Q4.1 — You split the test suite across 8 parallel CI shards. How do you produce one coverage number?

> **Testing:** Whether you know partial reports must be *merged*, not averaged.

**A.** Each shard runs a *subset* of tests and emits a **partial coverage report** covering only what its subset executed. You **merge** the partials into one combined report, then compute coverage from the combined data — you do *not* average the shards' percentages. Merging is a union at the line level: a line is "covered" in the combined report if *any* shard hit it; hit-counts sum. Mechanically: each shard uploads its report (LCOV/coverage.py/JaCoCo `.exec`) tagged by shard; a final step (`coverage combine`, `lcov -a`, JaCoCo merge, or the coverage service's automatic merge) unions them; the gate runs on the union.

Averaging the percentages is the classic blunder — if shard 1 covers files A–C and shard 2 covers files D–F, each shows ~50% of the *whole* but the true combined coverage is ~100%. Percentages aren't additive; line-hit sets are.

### Q4.2 — A team's coverage suddenly "drops to 12%" on a PR. CI is green, tests pass. The most likely cause?

> **Testing:** The signature "only one shard reported" bug — recognizing it instantly is the senior tell.

**A.** Almost certainly **the coverage service computed the number before all shards had uploaded** — it saw 1 of 8 partial reports and treated that single shard's coverage as the whole. One shard runs ~1/8 of the tests, hits ~1/8 of the lines, so the "coverage" lands around 12% (≈ 1/8). The tests pass and CI is green because the *test* jobs succeeded; the *coverage merge* is what's broken.

Root causes: the upload from the other shards failed silently, or — most common — the service wasn't told **how many shards to expect**, so it finalized on the first upload instead of waiting for all of them. The fix is to make the merge *aware of the expected shard count*: send a "done, expect N reports" signal (Codecov's `--flags` + a completion call, or an explicit count), and don't finalize/gate until all N arrive. Until then, treat any sudden drop to a clean fraction (≈ 1/N of normal) as "a shard didn't report," not "someone deleted the tests."

### Q4.3 — What is carryforward coverage and what problem does it solve?

> **Testing:** Whether you know the optimization that keeps sharded/monorepo coverage honest when not everything reran.

**A.** **Carryforward** (a.k.a. carryover) reuses a component's coverage from a *previous* commit when that component wasn't re-tested in the current run. The problem: in a monorepo with path-based CI, a PR touching service A only runs service A's tests, so the current run has *no* coverage data for services B–Z. Without carryforward, the combined report would show B–Z as 0% covered and project coverage would crater on every PR — a false alarm. Carryforward says "B–Z didn't change and weren't retested, so reuse their last known coverage," producing a combined number that reflects reality.

It's flag-/component-scoped: you tag each component's coverage (a "flag"), and the service carries forward any flag absent from the current upload. The risk to manage: carryforward can mask a *real* drop if a shared change should have affected B but B wasn't retested — so carryforward must be paired with correct CI test-selection (if a change *can* affect B, B's tests must run). Carryforward compensates for *intentionally* skipped work, not for a broken test-selection graph.

### Q4.4 — Two shards both execute the same shared utility file. How does merging handle the double-count, and does it inflate coverage?

> **Testing:** Whether you understand merge is a set union, not a sum of percentages.

**A.** It doesn't inflate coverage, because line coverage is a **set membership** question, not a tally. When merging, a line is covered if *any* shard hit it; covering it in two shards doesn't make it "more covered." Hit-*counts* sum (the line shows, say, 14 hits instead of 7+7 reported separately), which matters only if you care about execution frequency, but the *coverage percentage* — covered lines / total lines — is unaffected because the numerator counts the line once. The only thing that would inflate coverage is the averaging mistake from Q4.1; a correct union merge is idempotent on overlap. This is also why you can safely re-run a flaky shard and re-upload: merging the same data twice changes nothing.

---

## Theme 5 — Flaky Coverage

### Q5.1 — The same commit produces 84.1% coverage one run and 83.6% the next. What causes non-deterministic coverage, and why is it corrosive?

> **Testing:** Whether you can enumerate real causes, not just say "flaky tests."

**A.** Coverage flakes when *which lines execute* varies run to run. Common causes:
- **Concurrency / race conditions** — goroutines, threads, or async tasks that may or may not finish (or interleave differently) before the process exits, so their lines are sometimes recorded, sometimes not.
- **Time/order/randomness in tests** — a test seeded by wall-clock or an unseeded RNG takes a different branch; randomized test ordering exercises different setup paths.
- **Flaky tests that sometimes don't run their assertions** — a test that times out or short-circuits skips the lines after the failure point.
- **Lost coverage data on abnormal exit** — if the process is killed (timeout, OOM, `os.Exit`) before the coverage runtime flushes counters, that run under-reports.
- **Non-deterministic test selection** — sharding or "test impact analysis" picking a different subset.
- **Counter races in the coverage runtime itself** — non-atomic increments under parallelism dropping hits.

It's corrosive because a *ratchet or patch gate built on a flaky number is itself flaky*: a PR fails not because its tests are bad but because today's measurement landed on the wrong side of the line. That destroys trust in the gate — developers learn to just hit "re-run," which trains everyone to ignore the gate entirely, including when it's right.

### Q5.2 — How do you make coverage measurement deterministic?

> **Testing:** Whether your fixes target the *measurement*, not just retries.

**A.** Attack the sources, don't paper over with retries:
- **Make the tests deterministic first** — seed all RNGs, inject the clock, remove sleeps-as-synchronization, and fix or quarantine genuinely flaky tests (coverage flake is usually test flake wearing a different hat).
- **Ensure clean flush on exit** — make sure the coverage runtime writes counters even on early/abnormal termination; avoid hard `exit()` paths that skip the writer; give the suite enough timeout headroom so it isn't killed mid-flush.
- **Use atomic counters under parallelism** — e.g. Go's `-covermode=atomic` (vs `set`/`count`) so concurrent goroutines don't lose hits to a data race; the non-atomic modes can under-count exactly the lines exercised by concurrent code.
- **Pin test ordering** where order changes which lines run, or make setup order-independent.
- **Stabilize test selection** — if you shard or use impact analysis, make it deterministic for a given SHA, or use carryforward so unselected components don't read as 0%.

The principle mirrors reproducible builds: same input (commit) should yield the same output (coverage). If it doesn't, the number can't be a gate.

### Q5.3 — Why does `-covermode=atomic` (or its equivalent) matter specifically for coverage of concurrent code?

> **Testing:** A precise, language-grounded detail about counter correctness.

**A.** Coverage works by incrementing a per-line (or per-block) counter when execution reaches it. Under the non-atomic modes, that increment is a plain read-modify-write; when multiple goroutines/threads hit the *same* instrumented block concurrently, the writes race and some increments are lost — and in the boolean "set" mode, while you won't get a wrong *count*, a torn write can still leave a block marked unexecuted under heavy contention in some runtimes. The practical consequence is *flaky under-reporting precisely on the lines exercised by concurrent paths* — the most important code to have covered shows as intermittently uncovered. `atomic` mode makes each increment an atomic operation, so no hits are lost and the covered/uncovered verdict is stable across runs. The cost is some runtime overhead, which is why it's not the default — but for any suite with meaningful concurrency, it's the correct mode for a number you intend to gate on.

### Q5.4 — A coverage tool reports a line as covered in run A and uncovered in run B, but the test that hits it passes in both runs. How is that possible?

> **Testing:** Whether you can reason about flush/process-exit and instrumentation gaps.

**A.** The test passing only means its assertions held — it doesn't guarantee the coverage *data* for that line was recorded and persisted. Possibilities: (1) the line runs on a **background goroutine/thread** that hadn't finished when the process exited in run B, so its counter increment never happened before the writer ran; (2) the process **exited via a path that skipped the coverage flush** in run B (a hard `os.Exit`, a signal, an OOM kill after the assertion but before teardown); (3) **counter race** dropped the increment under concurrency; or (4) the coverage data file from one parallel worker was **overwritten or not merged** in run B (two processes writing the same output path). The assertion and the coverage record are decoupled events — the test verifies behavior, the counter records execution, and they can diverge. The fix is the determinism work in Q5.2: clean flush on all exit paths, atomic counters, unique per-worker output files, proper merge.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — A PR that *only adds tests* (no source changes) shows project coverage *dropping 5%*. Explain how.

> **Testing:** Whether you can debug a paradoxical number instead of declaring it impossible.

**A.** Adding tests cannot lower true coverage, so the *measurement* changed, not the reality. Likely causes, in order:
1. **A shard didn't report.** The new tests pushed total runtime over a CI timeout, one shard was killed, and its partial coverage is missing from the merge — so the combined number drops (the Q4.2 signature). Check that all N shards uploaded.
2. **Carryforward/flag mismatch.** The new test file landed in a component whose flag got renamed or split, so the service stopped carrying forward part of the old coverage and now reads it as 0%.
3. **Test selection shifted the denominator or scope.** Adding tests changed which files are *considered* (e.g. newly imported source modules now count as instrumented-but-unhit lines that weren't in the denominator before).
4. **The baseline/comparison moved** — the PR was compared against a different commit than expected (merge-base vs tip confusion), pulling in unrelated drops.
5. **A flush/timeout race** (Q5.4) under the heavier suite lost data.

The senior move is to *not trust the delta at face value* — open the report, diff the per-file coverage between base and head, and find *which files* lost coverage. A test-only PR losing coverage is virtually always a pipeline/merge artifact, and the per-file diff localizes it in minutes.

### Q6.2 — How would you roll out a coverage gate on a 10-year-old repo sitting at 30%?

> **Testing:** Whether you can introduce a gate without revolt — the flagship judgment question.

**A.** Incrementally, advisory-first, and on the *diff* — never a project-wide bar.
1. **Measure silently first.** Wire up coverage and report patch + project on every PR for a few weeks with *no gate*, so the numbers are visible and trusted before they bite.
2. **Gate on patch coverage, not project.** Start the rule as "new/changed lines should be ≥ X%" — this sidesteps the legacy deadlock entirely (Q1.3) and only asks people to test what they're already touching.
3. **Start the patch bar modest and advisory.** Begin at, say, 60–70% and **non-blocking** (a comment/check that doesn't fail the build) for a sprint or two; let the team see it's fair and fixable, gather the false-positive cases, fix the pipeline flakes.
4. **Flip to blocking, then ratchet the patch bar up** over quarters (70 → 80 → 85) once it's trusted and stable.
5. **Add a project guardrail, not a project gate** — "project coverage may not drop by more than N%" to catch egregious regressions without demanding the 80% fantasy.
6. **Provide an override path** (documented, audited) for genuine emergencies so the gate never fully blocks a critical hotfix.

The throughline: change *flow*, not *stock*; advisory before blocking; and let the legacy debt burn down naturally along the active surface. Mandating "80% project tomorrow" is how you get the gate deleted in a week.

### Q6.3 — A developer hits the patch-coverage gate by adding tests that execute the new code but assert nothing. How do you respond?

> **Testing:** Whether you understand coverage measures *execution, not verification* — and respond as an engineer, not a cop.

**A.** First, name what happened honestly: **coverage measures that a line *ran*, not that its behavior is *verified*.** An assertion-free test that calls the code satisfies a coverage gate while testing nothing — this is the fundamental limitation of coverage as a metric, and it's *exactly* what Goodhart's law predicts when you make a proxy a target. The developer didn't break a rule so much as expose that the rule's proxy is gameable.

The response is layered, and *not* primarily punitive:
- **Catch it in code review.** A reviewer should reject assertion-free tests; coverage is an input to review, not a replacement for it. This is the real backstop.
- **Strengthen the signal.** Add **mutation testing** on the changed lines — mutation testing deliberately breaks the code and checks whether a test *fails*, so assertion-free tests score near zero. It measures verification, not just execution, and is the direct antidote to this gaming.
- **Treat it as a culture signal, not just an individual one.** If someone is gaming the gate, the gate is being experienced as an obstacle rather than a help. Talk to the person: are they under deadline pressure? Is the bar unreasonable for this code? Gaming is usually a symptom of a mis-calibrated or mis-communicated gate.
- **Don't escalate to surveillance.** Adding ever-more-rigid coverage rules to defeat a determined gamer is an arms race you lose; the fix is review culture + a better metric (mutation), not a thicker rulebook.

The interviewer wants to hear that you know coverage is necessary-not-sufficient, that the real control is human review, and that you'd diagnose *why* someone is gaming before reaching for punishment.

### Q6.4 — Coverage on the `main` branch silently dropped 8% over three months with no single PR responsible. What happened and how do you prevent recurrence?

> **Testing:** Whether you understand slow drift and why patch-only gating misses it.

**A.** This is **death by a thousand dilutions / quiet erosion** — the failure mode a *patch-only* gate is blind to (Q1.2). Each PR covered its own diff fine, so the patch gate never fired, but across hundreds of PRs: new lines added at the bar (say 80%) slowly drag a higher project number down toward 80; tests got deleted or skipped in ways that didn't touch much "new code"; or refactors moved logic into paths that happened to dodge the diff measurement. No single PR is guilty because the loss is *aggregate*.

Prevention: pair the patch gate with **project-coverage trend monitoring** — track `main`'s project coverage over time and **alert on sustained decline** (not per-PR, but a moving-average drop), plus the "project may not fall more than N% on a PR" guardrail to catch the larger single-PR contributors. You don't *block* on the trend (that reintroduces the legacy deadlock), you *observe* it and investigate when it bends down. Patch gates the increment; trend monitoring watches the stock; you need both because they fail in opposite directions.

### Q6.5 — Your patch-coverage gate is blocking a one-line production hotfix because the touched line is genuinely hard to test. What do you do, right now and afterward?

> **Testing:** Whether the gate serves the team or the team serves the gate.

**A.** **Right now:** ship the fix. A coverage gate must never be the reason a production incident stays unresolved — use the documented **override** (a labeled exception, an admin merge, or a skip-coverage annotation that's *audited*, not silent). The gate exists to improve quality over time, and trading a few minutes of test-writing against prolonged downtime is an obvious call. If your gate has *no* override path, that's a design defect to fix today.

**Afterward:** (1) file a follow-up to add the test or refactor the line into something testable, so the exception doesn't become permanent debt; (2) examine *why* the line was hard to test — usually it's a design smell (an untestable static call, a side-effect buried in a constructor) and the real fix is decoupling, not a coverage waiver; (3) if this class of line keeps tripping the gate, add a *narrow, reviewed* exclusion rule rather than overriding ad hoc each time. The principle: overrides are fine when they're rare, visible, and trailed by remediation — the danger is a silent or routine override, which means the gate has quietly become advisory without anyone deciding that.

---

## Theme 7 — Gate Policy and Politics

### Q7.1 — Blocking gate vs advisory check — how do you choose, and how do they fail?

> **Testing:** Whether you weigh enforcement against developer trust and velocity.

**A.** **Advisory** posts the number as a non-blocking comment/check; **blocking** fails the build and prevents merge. The trade: blocking actually changes behavior (an advisory check is widely ignored once it's familiar wallpaper), but a blocking gate on a noisy or unfair metric *destroys trust* and trains people to route around it (overrides, exclusions, assertion-free tests). My rule: **advisory while you build trust and shake out flakiness; blocking once the metric is stable, fair (patch-based), and the team agrees it's reasonable.** Blocking fails by becoming an obstacle people defeat; advisory fails by becoming invisible. The migration path — advisory → blocking on patch with an override — gets the behavior change of blocking while preserving the escape valve that keeps it trusted. Critically, only ever block on a number you'd defend as *correct and fair*; blocking on project coverage in a legacy repo is the canonical way to get your gate deleted.

### Q7.2 — How do you handle code that legitimately shouldn't count toward coverage — generated code, vendored deps, simple DTOs?

> **Testing:** Exclusions as a deliberate, reviewed tool vs a loophole.

**A.** Use **explicit, version-controlled exclusions** scoped as narrowly as possible: path-based ignores for generated code and vendored directories (they're not your tests' job and they distort both numerator and denominator), and line/block annotations (`// coverage:ignore`, `# pragma: no cover`) for genuinely untestable lines like unreachable `default` branches or `panic("unreachable")`. The discipline that keeps exclusions honest:
- **Review them like code** — every exclusion is in a config/annotation that shows up in the diff, so a reviewer can challenge it. The danger is exclusions becoming a silent loophole ("can't test it → just ignore it").
- **Prefer excluding *categories* over *files*** — "all `*.pb.go`" is auditable; "this one file I couldn't be bothered to test" is debt in disguise.
- **Don't exclude to hit a number** — excluding hard-to-test code to make the gate pass inverts the gate's purpose; that code is *where the risk is*. If something's hard to test, that's a design signal, not an exclusion candidate.

Exclusions are legitimate and necessary (generated code genuinely shouldn't count), but each one is a small reduction in the gate's coverage of reality, so they earn their place through review.

### Q7.3 — Should individual coverage numbers feed into performance reviews? Defend your position.

> **Testing:** Whether you understand Goodhart's law and metric weaponization — a values question.

**A.** **No.** The instant a proxy metric becomes a *personal performance target*, it gets gamed and stops measuring what you wanted — Goodhart's law in its purest form. Tie coverage to reviews and you get assertion-free tests (Q6.3), people avoiding hard-to-test (often most-important) code, gaming of the diff boundary, and the metric's information value collapses precisely when you've made it high-stakes. Worse, it punishes engineers working in inherently hard-to-test areas (legacy, concurrency, infra) and rewards those padding easy code.

Coverage is a **team-level health signal and a per-PR guardrail**, not an individual KPI. The right framing: the gate is a shared quality floor the *team* maintains, like a passing build — you don't put "build pass rate" on someone's review, you make a green build the baseline expectation. Use coverage to find *untested risk*, not to rank *people*. The senior position is that metrics used for improvement and metrics used for evaluation must be kept separate, because evaluation pressure corrupts the measurement.

### Q7.4 — A team wants 100% coverage as policy. Talk them into or out of it.

> **Testing:** Whether you can reason about diminishing returns and the cost curve, not just recite "100% is bad."

**A.** **Out of it, mostly — but carefully.** The last 10–15% of coverage is where the cost curve goes vertical: you spend disproportionate effort testing trivial getters, unreachable defaults, and error branches that require elaborate fakes, for paths that carry little risk. A 100% *mandate* drives exactly the pathologies that hollow out the metric — assertion-free tests, contorted code written for coverability over clarity, and exclusion-gaming to reach the number. It optimizes the proxy at the expense of the goal (actual confidence).

The nuance: 100% can be *reasonable for a small, critical library* (a crypto primitive, a parser, a billing core) where the surface is small and the stakes justify exhaustive execution — and even there, 100% line coverage still doesn't mean 100% *behavior* coverage (you can hit every line without testing every input class; that's what mutation/property testing is for). So I'd steer them to: gate **patch coverage at a high-but-not-100 bar** (80–90%), reserve 100% for genuinely critical modules by exception, and invest the energy they'd spend chasing the last 10% into **mutation testing** on the code that matters — which buys far more real confidence per hour than forcing the line number to a round 100.

### Q7.5 — How do you keep a coverage gate from becoming theater — present but meaningless?

> **Testing:** Whether you can keep a quality control *honest* over time.

**A.** A gate becomes theater when it's technically enforced but everyone has learned to satisfy it without improving quality. Keeping it real:
- **Gate the diff, not the aggregate**, so the number is fair and people don't reflexively distrust it.
- **Pair coverage with a *verification* signal** — mutation testing (even sampled/periodic, since it's expensive) so "covered" can't mean "executed but unasserted." This is the single biggest defense against the gate degrading into line-touching.
- **Keep review in the loop** — coverage informs the human reviewer; it never replaces them. The reviewer is the one who catches a meaningless test.
- **Watch the leading indicators of theater**: rising exclusions, climbing override frequency, lots of assertion-light tests, re-runs to dodge flakiness. Each is a signal the gate is being routed around, and the response is to fix the *cause* (flaky measurement, unfair bar, mis-calibrated policy), not to bolt on more rules.
- **Keep it fast and deterministic** — a slow or flaky gate trains people to ignore it, after which it's theater regardless of policy.

The throughline of the whole topic: coverage is a *useful, gameable proxy*. It earns its place as a gate only when it's fair (diff-scoped), trustworthy (deterministic), backed by verification (mutation), and embedded in a review culture — and the moment any of those slips, the gate quietly becomes a number nobody believes.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Patch coverage vs project coverage in one line?** A: Coverage of just this PR's changed lines vs coverage of the whole repo; gate on the former, track the latter.
- **Q: Diff against branch tip or merge-base?** A: Merge-base — it isolates exactly your changes and matches what the merge would introduce.
- **Q: How do you combine coverage from 8 shards?** A: Merge the partial reports (union at the line level), then compute the percentage — never average the shards' percentages.
- **Q: Coverage drops to ~1/N of normal on a sharded PR. Cause?** A: A shard didn't upload (or the service finalized before all N reports arrived), not a real loss.
- **Q: What is carryforward coverage?** A: Reusing a component's last-known coverage when it wasn't retested this run, so unchanged code doesn't read as 0%.
- **Q: One reason coverage is non-deterministic?** A: Concurrency/early-exit losing counter data, or non-atomic counters dropping hits under parallelism.
- **Q: Why `-covermode=atomic`?** A: So concurrent goroutines don't lose coverage hits to a counter race, stabilizing coverage of concurrent code.
- **Q: What does coverage *not* measure?** A: Verification — a line can be executed by an assertion-free test and still be untested behavior.
- **Q: Direct antidote to assertion-free tests?** A: Mutation testing — it checks whether a test *fails* when the code is broken.
- **Q: Why not gate a legacy repo on project coverage?** A: The legacy deadlock — no normal PR can lift a low repo to the bar, so nothing merges.
- **Q: Where should the ratchet baseline live?** A: Keyed to a merged commit SHA in the coverage service/artifact store — never a mutable file in the repo.
- **Q: Should coverage be in performance reviews?** A: No — making the proxy a personal target gets it gamed (Goodhart) and destroys its signal.
- **Q: Advisory vs blocking gate?** A: Advisory builds trust and shakes out flakiness; flip to blocking once the metric is fair, stable, and trusted — with an override.
- **Q: How do exclusions stay honest?** A: Version-controlled, reviewed in the diff, scoped to categories (generated/vendored), never used just to hit a number.
- **Q: One guardrail to catch slow project-coverage drift?** A: Trend-monitor `main`'s project coverage and alert on sustained decline (don't block on it).

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Conflating patch and project coverage, or proposing a project-coverage gate on a legacy repo.
- Averaging shard percentages to get a combined number.
- Treating a sudden drop to ~1/N coverage as "tests were deleted" instead of "a shard didn't report."
- Saying coverage proves code is *tested* — confusing execution with verification.
- "Just mandate 100%" or "block every PR below 80% project" with no rollout or override.
- Wanting to put coverage in performance reviews or punish a gate-gamer first.
- Diffing against the branch tip and not knowing why a rebase changed the number.

**Green flags:**
- Naming the *distinction* (diff vs whole, number vs signal, measure vs gate, tip vs merge-base) before quoting a threshold.
- Reaching for **patch coverage + clean-as-you-code** for legacy repos unprompted.
- Recognizing the "one shard reported" signature on sight, and knowing carryforward.
- Knowing coverage measures execution not verification, and proposing **mutation testing** as the fix for gaming.
- Treating gate rollout as advisory-then-blocking with an audited override.
- Insisting metrics for *improvement* and metrics for *evaluation* stay separate (Goodhart).
- Pairing a patch gate with project-*trend* monitoring because they fail in opposite directions.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **the diff vs the whole**, **a number vs a signal**, **measure vs gate**, **the branch tip vs the merge-base**. Name the distinction first; the threshold follows.
- **Patch vs project:** patch coverage (changed lines) is the fair, attributable PR gate; project coverage (whole repo) is a trend to watch. A project-coverage gate on a legacy repo causes the **legacy deadlock** — nothing can merge.
- **Computing patch coverage** is an intersection of the PR's changed *executable* lines with the coverage report's hit lines, diffed against the **merge-base** (not the tip), keyed by commit SHA so rebases and concurrent merges stay coherent.
- **The ratchet + clean-as-you-code** make the standard one-way and diff-scoped, dissolving the legacy problem; store the baseline by merged SHA, update only on merge, and prefer a patch ratchet over a project one to dodge dilution.
- **Parallel shards** require *merging* partials (line-level union, not averaging percentages); a drop to ≈ 1/N coverage means a shard didn't report; **carryforward** keeps unretested components from reading as 0%.
- **Flaky coverage** comes from concurrency, early exit before flush, and non-atomic counters; fix the *measurement* (deterministic tests, clean flush, atomic mode), because a gate on a flaky number is itself flaky and loses trust.
- **Policy and politics:** advisory before blocking, exclusions reviewed in the diff, an audited override, coverage kept out of performance reviews, and paired with **mutation testing** — because coverage is a useful but gameable proxy that measures execution, not verification.

---

## Further Reading

- *Working Effectively with Legacy Code* (Michael Feathers) — the testing-the-untouchable mindset behind clean-as-you-code and "hard to test is a design smell."
- Sonar's "Clean as You Code" methodology — the canonical articulation of gating new code instead of the whole codebase.
- Codecov and Coveralls docs on **flags, carryforward, and merge-base comparison** — primary sources for how sharded/monorepo coverage is actually merged and computed.
- Goodhart's law and the testing literature on it ("When a measure becomes a target, it ceases to be a good measure") — the theory under Themes 6 and 7.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [03 — Coverage Tooling per Language](../03-coverage-tooling-per-language/interview.md) — how `go test -cover`, `coverage.py`, JaCoCo, and friends produce the reports this page merges and diffs.
- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/interview.md) — the deep treatment of Goodhart, mutation testing, and why coverage is necessary-not-sufficient.
- [Code Coverage README](../README.md) — where coverage-in-CI sits in the broader coverage landscape.
- [Quality Engineering README](../../README.md) — where coverage gating fits among the other quality controls.
