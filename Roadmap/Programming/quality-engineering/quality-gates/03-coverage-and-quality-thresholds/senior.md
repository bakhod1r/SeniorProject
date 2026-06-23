# Coverage & Quality Thresholds — Senior Level

> **Roadmap:** [Quality Gates](../README.md) → Coverage & Quality Thresholds
> *The middle page showed you how to wire a coverage number into a gate and pick a percentage. This page is about why that percentage lies to you the moment it becomes a target, the statistics that separate a real performance regression from CI noise, and how to design numeric gates that catch regressions in what you actually care about without crying wolf so often that the team disables them.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Goodhart, Campbell, and Surrogation](#core-concept-1--goodhart-campbell-and-surrogation)
5. [Core Concept 2 — Why Coverage Is Execution, Not Verification](#core-concept-2--why-coverage-is-execution-not-verification)
6. [Core Concept 3 — Gaming Vectors for Coverage Gates](#core-concept-3--gaming-vectors-for-coverage-gates)
7. [Core Concept 4 — Mutation Score as the Gaming-Resistant Gate](#core-concept-4--mutation-score-as-the-gaming-resistant-gate)
8. [Core Concept 5 — Coverage Gate Design: Project, Patch, and the Ratchet](#core-concept-5--coverage-gate-design-project-patch-and-the-ratchet)
9. [Core Concept 6 — Line vs Branch vs Condition vs MC/DC](#core-concept-6--line-vs-branch-vs-condition-vs-mcdc)
10. [Core Concept 7 — Statistical Performance Gates](#core-concept-7--statistical-performance-gates)
11. [Core Concept 8 — The Multiple-Comparisons Problem](#core-concept-8--the-multiple-comparisons-problem)
12. [Core Concept 9 — Other Thresholds and Their Failure Modes](#core-concept-9--other-thresholds-and-their-failure-modes)
13. [Core Concept 10 — Setting and Governing Thresholds](#core-concept-10--setting-and-governing-thresholds)
14. [Real-World Examples](#real-world-examples)
15. [Mental Models](#mental-models)
16. [Common Mistakes](#common-mistakes)
17. [Test Yourself](#test-yourself)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)
21. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The theory and statistics a senior engineer needs to make a numeric gate measure the thing it claims to measure — and to know when the number is noise.**

By the middle level you can configure a coverage gate, set it to 80%, and fail a PR that drops below. That is enough to ship a policy. The senior jump is recognizing what you've actually built: a *measure* that the entire team is now incentivized to maximize — and the moment a measure carries that incentive, it stops measuring the underlying thing and starts measuring how good the team is at producing the number.

This is not cynicism; it is a well-documented mechanism with a name (Goodhart's law, Campbell's law, surrogation) and it has a quantitative shape. A coverage gate does not measure "tested code"; it measures "executed code," and the gap between those two is where every gaming vector lives. A performance gate that fails on "3% slower in one run" is not measuring a regression; it is sampling CPU jitter and calling it signal. This page is about closing both gaps: making the gate's number track the goal (via mutation testing, diff scoping, ratchets) and making it fire on signal rather than noise (via proper statistics — distributions, A/B comparison on one machine, significance testing, effect sizes, and multiple-comparisons correction). A gate's only job is to catch *regressions in what you care about*, measured so it rarely cries wolf. Everything here serves that one sentence.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — wiring coverage and quality numbers into a gate, project vs patch coverage, and the basic idea of a threshold.
- **Required:** You understand what line and branch coverage are and how a coverage report is produced (instrumentation or profiling). See [Code Coverage](../../code-coverage/).
- **Helpful:** A working memory of basic inferential statistics: mean vs median, variance, the idea of a p-value, and what a confidence interval is.
- **Helpful:** You've watched a team disable a gate because it became too noisy — the failure mode this whole page is engineered to prevent.

---

## Glossary

| Term | Meaning |
|---|---|
| **Goodhart's law** | "When a measure becomes a target, it ceases to be a good measure" (Strathern's restatement of Goodhart). |
| **Campbell's law** | The more a quantitative indicator is used for decisions, the more it distorts and corrupts the process it monitors. |
| **Surrogation** | Cognitively replacing the goal (defect-free code) with its proxy (coverage %), so the team optimizes the proxy and forgets the goal. |
| **Project coverage** | Coverage of the whole codebase at a commit. |
| **Patch / diff coverage** | Coverage restricted to the lines added or changed by a PR. |
| **Ratchet** | A monotonic non-decrease rule: the gate fails if the metric gets worse than the base commit, regardless of the absolute value. |
| **Mutation score (kill rate)** | Fraction of injected faults (mutants) that the test suite detects (kills). The honest measure of suite *fault-detection*. |
| **MC/DC** | Modified Condition/Decision Coverage — each condition independently shown to affect the decision outcome; mandated by DO-178C Level A avionics. |
| **`benchstat`** | Go tool that compares two sets of benchmark samples with a Mann–Whitney U test, reporting p-value, delta, and confidence. |
| **Effect size** | The *magnitude* of a change (e.g., +4%), distinct from whether it is statistically significant. |
| **Carry-forward flag** | A coverage flag whose previous report is reused when the current upload is missing (partial uploads in monorepos). |
| **Changepoint detection** | Statistical detection of a shift in a time series — used for trend-based perf regression detection instead of per-PR gating. |

---

## Core Concept 1 — Goodhart, Campbell, and Surrogation

The single most important idea on this page is a mechanism, not a tool. Charles Goodhart observed it in monetary policy; Marilyn Strathern gave it its famous form: **"When a measure becomes a target, it ceases to be a good measure."** Donald Campbell stated the social-science version: the more any quantitative indicator drives decisions, the more it is subject to corruption pressure and the more it distorts the process it was meant to monitor.

The cognitive engine underneath is **surrogation** — documented in management-accounting research (Choi, Hecht, Tayler). When you give a team a proxy metric tied to consequences, people unconsciously *substitute the proxy for the goal*. The goal is "code that doesn't break in production." The proxy is "85% line coverage." Surrogation is the team coming to believe, and act as though, the proxy *is* the goal. Nobody decides to game it; the metric quietly becomes the thing they optimize, and the original objective fades from view.

This matters because every numeric quality gate is, by construction, a measure that has been made a target. The gate does not weaken Goodhart's law — it *activates* it. So the senior question is never "what number should the gate be?" It is "given that this number will now be optimized directly, what is the cheapest way to move it, and does that cheapest path also achieve the goal?" If the cheapest way to raise coverage is to write better tests, the gate is well-designed. If the cheapest way is to delete uncovered code or add assertion-free tests, the gate is actively harmful: it spends the team's effort manufacturing the number while the goal stagnates or regresses.

> **Key insight:** A quality gate does not measure quality. It measures the team's incentive-shaped response to being measured. Design every gate by asking "what is the laziest way to satisfy this?" — because that is the behavior you will actually get, not the behavior you hoped for.

---

## Core Concept 2 — Why Coverage Is Execution, Not Verification

Code coverage answers exactly one question: *was this line/branch executed while the tests ran?* It says nothing about whether anything was *checked*. A test that calls a function and asserts nothing still executes every line inside it, so the coverage tool reports 100% — while the test would pass no matter how badly the function is broken.

This is the structural reason coverage is a poor target. Coverage and correctness-checking are *orthogonal axes*:

| | Asserts behavior | Asserts nothing |
|---|---|---|
| **Executes the code** | Real test (covered + verified) | Coverage theater (covered, unverified) |
| **Doesn't execute** | Impossible | Uncovered |

A coverage gate can only push code from the bottom row to the top row — from "not executed" to "executed." It cannot distinguish the two top-row cells, and *those are the cells that matter*. High coverage with weak assertions is the most common quality illusion in the industry: a number that looks like safety and provides none.

Coverage is still useful as a *floor and a map*: it reliably tells you what is **not** tested at all (genuinely valuable — uncovered code is definitionally unverified), and it surfaces dead code and surprising gaps. The error is treating it as a *ceiling on risk* — believing that 90% covered means 90% safe. It means at most that 10% is definitely unsafe and the other 90% is *unknown*.

> **Key insight:** Coverage is a measure of test *reach*, not test *strength*. It is excellent at proving the negative (this is untested) and worthless at proving the positive (this is tested well). Gate on the negative; never trust the positive.

---

## Core Concept 3 — Gaming Vectors for Coverage Gates

Because coverage is execution-not-verification, the menu of ways to raise it without improving quality is large, cheap, and — under a strict gate — *rational*. A senior must recognize these on sight, in review and in their own behavior under deadline pressure:

1. **Assertion-free tests.** Call the function, assert nothing. Coverage rises to 100% of the executed lines; defect-detection is zero. The purest form of coverage theater.
2. **Tautological assertions.** `assert result == result`, `assertTrue(true)`, or asserting on a value you just computed with the same code under test. Executes, passes always, verifies nothing.
3. **Padding with trivial accessors.** Write tests for getters, setters, `toString`, generated boilerplate, and `equals`. Each is a cheap chunk of covered lines that drags the percentage up while the complex, risky logic stays untested. The metric improves; the risk is unchanged.
4. **Excluding hard files.** Add the genuinely complex modules to the coverage-ignore list. The denominator shrinks, the ratio jumps, and the *exact code most likely to contain defects* is now invisible to the gate.
5. **Deleting uncovered defensive code.** This is the most perverse vector. Coverage is `covered / total`. You can raise the ratio by raising the numerator (test more) *or by shrinking the denominator* — and the cheapest denominator shrink is deleting the `else` branch, the `default:` case, the null-guard, the error path you "can't easily hit." The gate *rewards removing safety checks*, which is the literal opposite of its goal.

Vectors 4 and 5 are the dangerous ones because they make the codebase worse to satisfy the gate. A naive "coverage must not drop" rule combined with "delete the uncovered defensive branch" produces a green gate and a more fragile system — a textbook Goodhart inversion.

> **Key insight:** Any gate defined as a *ratio* can be satisfied by shrinking the denominator. Coverage's denominator is "lines of code," so a coverage gate silently incentivizes deleting hard-to-test code and excluding hard-to-test files. The counter is diff-scoping (you can't improve a PR's patch coverage by deleting *other* code) and reviewing the *tests*, not the number.

---

## Core Concept 4 — Mutation Score as the Gaming-Resistant Gate

The principled answer to "coverage is execution, not verification" is to measure verification directly. **Mutation testing** does this: it programmatically injects small faults (**mutants**) into your code — flip `<` to `<=`, `+` to `-`, `&&` to `||`, replace a return value with a default, delete a statement — then runs your test suite against each mutant. If a test fails, the mutant is **killed** (your tests detected the injected fault). If all tests still pass, the mutant **survived** (your tests cannot tell correct code from this specific broken version).

The **mutation score** (kill rate) = killed / total mutants. Unlike coverage, this directly measures whether your tests *detect faults* — which is the actual goal coverage was a proxy for. Critically, it defeats the gaming vectors:

- Assertion-free and tautological tests **execute** the mutant but never **fail** on it, so they kill nothing → mutation score exposes them where coverage hid them.
- Trivial-accessor padding adds tests that kill only trivial mutants; the surviving mutants pinpoint the complex untested logic.
- You cannot pad mutation score by shrinking the denominator in the same way — mutants are generated from the code that exists, and stronger assertions are the *only* cheap way to kill more.

Mature tooling exists per ecosystem:

| Language | Tool |
|---|---|
| Java/JVM | **PIT** (pitest) — the reference implementation; bytecode mutation, fast |
| JavaScript/TypeScript | **Stryker** |
| Python | **mutmut**, `cosmic-ray` |
| Go | **go-mutesting**, `gremlins` |
| Rust | `mutants` (cargo-mutants) |

The cost is real and is the reason it is not the default gate: naively, you run the whole suite *once per mutant*, so a 10-minute suite × 2,000 mutants is days of compute. The mitigations are what make it viable:

- **Diff-scope it.** Only mutate the lines changed in the PR (PIT's `--changeClassesFile`, Stryker's `--since`, cargo-mutants' `--in-diff`). This bounds cost to the change size and matches the gate's job — catch regressions in *new* code.
- **Coverage-guided mutant selection.** Only run the tests that actually cover the mutated line (PIT does this automatically). A mutant on line 50 only needs the tests touching line 50.
- **Sample.** Mutate a random subset to estimate the score cheaply for a trend, run the full set nightly.

A diff-scoped mutation gate is the senior's answer to coverage gaming: *"new code must have a mutation score ≥ X on the changed lines."* It is far harder to satisfy with theater because the only cheap way to kill a mutant is a real assertion.

> **Key insight:** Coverage asks "did a test run this line?" Mutation testing asks "would a test *notice* if this line were wrong?" The second question is the one you actually mean. Diff-scoped mutation testing is expensive enough to reserve for changed code, and gaming-resistant enough to be worth it there.

```yaml
# .github/workflows/mutation-gate.yml — diff-scoped PIT gate (JVM)
- name: Mutation test changed code
  run: |
    git diff --name-only origin/main...HEAD \
      | grep '\.java$' | sed 's#src/main/java/##;s#\.java$##;s#/#.#g' > changed.txt
    mvn -B org.pitest:pitest-maven:mutationCoverage \
      -DtargetClasses=$(paste -sd, changed.txt) \
      -DmutationThreshold=70           # fail if <70% of mutants on changed code are killed
```

---

## Core Concept 5 — Coverage Gate Design: Project, Patch, and the Ratchet

Given that absolute coverage targets punish legacy code and invite gaming, the senior design is built on two ideas: **diff scoping** and the **ratchet**.

**Project vs patch.** A *project* gate ("whole repo ≥ 80%") is the worst form: a large legacy codebase can never reach it without a heroic, low-value back-fill, so teams either exclude files (vector 4) or set the number where it already sits, making it meaningless. A *patch* (diff) gate — "the lines you changed must be ≥ 80% covered" — is enforceable, fair, and aligned with the gate's job: it asks new and modified code to be tested, and ignores the legacy you didn't touch. This is SonarQube's **Clean as You Code** philosophy: gate the *new code period*, let the old code improve opportunistically.

**The ratchet** is the monotonic non-decrease rule: the gate fails if coverage drops *below the base commit's* coverage, whatever the absolute value. It encodes "don't make it worse" — the only rule that is both always-satisfiable (don't reduce coverage) and always-improving (the floor only rises). But the ratchet has sharp edges a senior must handle:

- **Base-commit selection.** Compare against the **merge-base** (the common ancestor of the PR and the target branch), *not* the tip of `main`. If you compare against the tip, an unrelated coverage change merged into `main` after you branched will spuriously fail or pass your PR. The diff and the coverage delta must use the same merge-base.
- **Carry-forward flags.** In a monorepo, a PR that touches only service A may not produce a fresh coverage upload for service B. Without carry-forward, B's coverage reads as 0% and the project number collapses. **Carry-forward flags** reuse B's last known report when the current upload is absent — essential for partial uploads, but they must be invalidated correctly or you carry stale numbers forever.
- **Multi-language / multi-flag merges.** A polyglot repo uploads several reports (Go + TS + Python, or unit + integration). The gate must *merge* them into one project number and also keep per-flag ratchets, or a drop in one language hides behind a rise in another.
- **Flaky coverage.** Non-deterministic execution (concurrency, time-dependent branches, random test ordering) makes coverage itself flaky: the same code reports 81% then 79%. A strict ratchet on a flaky base produces random failures. The fix is a small tolerance (`threshold: 1%`) and removing the non-determinism, not loosening the gate to uselessness.

> **Key insight:** The ratchet's correctness lives entirely in *which base commit you diff against*. Diff against the merge-base, scope to the patch, and add a small tolerance for measurement noise — otherwise the gate fails for reasons that have nothing to do with the PR, and a gate that fails for unrelated reasons is a gate the team will route around.

```yaml
# codecov.yml — patch-focused ratchet with noise tolerance and carry-forward
coverage:
  status:
    project:
      default:
        target: auto          # ratchet: compare to base (merge-base) coverage
        threshold: 1%         # tolerate ±1% measurement noise — don't fail on flake
        if_ci_failed: error
    patch:
      default:
        target: 80%           # NEW/changed lines must be ≥80% covered
        threshold: 0%         # strict on the diff; this is the real gate
flag_management:
  default_rules:
    carryforward: true        # reuse last report for components not rebuilt in this PR
    statuses:
      - type: project
        target: auto
        threshold: 1%
```

---

## Core Concept 6 — Line vs Branch vs Condition vs MC/DC

*What* you count as "covered" changes how strong the gate is, and the levels form a hierarchy of rigor:

- **Line / statement coverage** — was the line executed? Weakest. `if (a && b) doX();` counts as covered if the line ran at all, even though only one path through it was exercised.
- **Branch / decision coverage** — was each branch (true *and* false) of every decision taken? Strictly stronger; catches the unexercised `else` and the missing `false` case that line coverage hides. This should be the default gate criterion for anything non-trivial.
- **Condition coverage** — was each *boolean sub-condition* (`a`, `b` individually in `a && b`) evaluated both true and false? Stronger again.
- **Modified Condition/Decision Coverage (MC/DC)** — each condition must be shown to *independently* affect the decision's outcome, holding the others fixed. For `a && b && c` this needs `n+1` carefully chosen cases (not the `2^n` of exhaustive condition combinations) where each variable is the lone difference that flips the result.

MC/DC is not academic: it is **mandated by DO-178C Level A** (catastrophic-failure-risk avionics software) and appears in ISO 26262 (automotive) and IEC 61508 guidance for the highest safety integrity levels. If you build flight-control or safety-critical software, MC/DC is a regulatory gate, not a choice. For ordinary services, **branch coverage as the gate criterion** is the sweet spot: meaningfully stronger than line coverage, supported everywhere, and not absurdly expensive to satisfy.

**Exclusions discipline** applies at every level. Excluding generated code, vendored code, and genuinely unreachable defensive branches is legitimate — but every exclusion must be *justified in the config with a comment* and *reviewed*, because the exclusion list is exactly where vector 4 (excluding hard files) hides. Treat the ignore list as code that needs review, not as a dumping ground.

> **Key insight:** "100% coverage" is meaningless until you say *which* coverage. 100% line coverage can leave half your branches and most of your conditions unexercised. Gate on **branch** coverage by default; reserve **MC/DC** for code where a missed condition is a regulatory or safety event.

---

## Core Concept 7 — Statistical Performance Gates

Performance gates are where naive thresholds do the most damage, because microbenchmarks are *noisy*, and a single-run "X% slower → fail" gate is, statistically, a coin flip dressed as a check.

**The noise sources are physical and large:**

- **CPU frequency scaling** — turbo boost and thermal throttling change clock speed run-to-run; the same code can be 20% faster on a cold core than a hot one.
- **Noisy neighbors** — shared CI runners co-schedule other tenants' work on sibling cores, contending for cache, memory bandwidth, and the scheduler.
- **ASLR & memory layout** — address randomization shifts cache-line and page alignment between runs, producing real, code-independent timing swings.
- **Garbage collection / allocator state** — GC pauses and heap fragmentation land differently each run.
- **Cache and TLB warmth** — the first iterations pay cold-cache costs; warmup state varies.

Against that noise floor, comparing one base run to one PR run and failing on "3% slower" measures jitter, not your code. The variance between two runs of *identical* code routinely exceeds the regression you're trying to catch.

**The statistically sound approach:**

1. **Multiple iterations, report the distribution.** Run each benchmark many times (e.g., `-count=10`) and keep the *samples*, not a single mean. The median and the spread are what you reason about.
2. **A/B compare base vs PR on the *same* machine, interleaved.** Build both versions and run them back-to-back on one runner so they share the same thermal state, neighbors, and layout. Comparing a number from runner X to a number from runner Y is meaningless.
3. **Declare a regression only at significance *and* a meaningful effect size.** Use a proper test — Go's **`benchstat`** runs a **Mann–Whitney U** (rank-based, distribution-free) test and reports a **p-value** and the **delta with a confidence interval**. Fail only when the p-value clears your significance level (e.g., `p < 0.05`) *and* the median change exceeds a threshold you care about (e.g., > 3%). Significance without effect size flags trivial-but-real 0.4% drifts; effect size without significance flags noise. You need both.
4. **Use dedicated, quiet runners.** Pin to isolated cores (`taskset`/`cset`), disable frequency scaling (`cpupower frequency-set -g performance`), and remove background load. Bare-metal or dedicated instances beat shared CI for any perf number you intend to gate on.
5. **Prefer trend-based detection over per-PR gating.** Even with all the above, per-PR perf gates are inherently low-signal. The robust pattern (e.g., the **"Sandbox"/SPC** statistical-process-control approach) is to record every commit's benchmark to a time series and run **changepoint detection** — flag the *commit where the distribution shifted*, after the fact, when you have enough samples to be confident. This trades immediacy for trustworthiness, which is the right trade for performance.
6. **Make perf gates advisory until trusted.** A new perf gate should *report* (post a comment, annotate) without *blocking* until you've watched it for weeks and confirmed its false-positive rate is low. A blocking perf gate that fires on noise is the fastest way to get all perf gates disabled.

> **Key insight:** A performance number is a *sample from a distribution*, never a fact. Treat it like one: many iterations, same-machine A/B, a significance test with a confidence interval, and a minimum effect size. A perf gate that doesn't report a p-value and a CI is not measuring a regression — it's flipping coins.

```bash
#!/usr/bin/env bash
# perf-gate.sh — statistically sound Go perf gate. Decision rule at the bottom.
set -euo pipefail
PKG="${1:-./...}"; COUNT=10; PCT_THRESHOLD=3   # require >3% median change AND p<0.05

# Build & bench BASE and PR on the SAME machine, interleaved counts for fairness.
git stash --include-untracked || true
go test -run=^$ -bench=. -count="$COUNT" -benchmem "$PKG" | tee base.txt
git stash pop || true
go test -run=^$ -bench=. -count="$COUNT" -benchmem "$PKG" | tee pr.txt

# benchstat runs Mann–Whitney U; prints delta %, ±CI, and p-value per benchmark.
benchstat base.txt pr.txt | tee result.txt

# Decision rule: regression iff p<0.05 (significant) AND median slowdown > threshold (effect size).
awk -v thr="$PCT_THRESHOLD" '
  /sec\/op/ {section="time"}
  section=="time" && $0 ~ /\+[0-9.]+%/ {
    match($0, /\+([0-9.]+)%/, m); pct=m[1]
    # benchstat prints "p=0.xxx" or "~" (no significant difference)
    if ($0 ~ /p=0\.0[0-4]/ && pct > thr) {
      print "REGRESSION: " $1 "  +" pct "% (p<0.05)"; bad=1
    }
  }
  END { if (bad) exit 1 }
' result.txt
```

---

## Core Concept 8 — The Multiple-Comparisons Problem

A subtle statistical trap turns even a correct per-benchmark test into a false-positive generator. If you run *one* significance test at `p < 0.05`, you accept a 5% chance of a false positive. But a real suite has *hundreds* of benchmarks, and you test each one. With **100 independent benchmarks of unchanged code**, the probability that *at least one* falsely flags is `1 − (1 − 0.05)^100 ≈ 99.4%`. You are essentially *guaranteed* a spurious "regression" on every run, even when nothing changed.

This is the **multiple-comparisons problem**, and ignoring it is why naive benchmark gates "always find something." The corrections:

- **Bonferroni** — divide your significance level by the number of tests (`α/n`). Simple, conservative; with 100 benchmarks you'd require `p < 0.0005`. It controls the family-wise error rate but can be over-strict, hiding small real regressions.
- **Benjamini–Hochberg (FDR control)** — controls the *false discovery rate* (the expected fraction of flagged results that are false) rather than the chance of *any* false positive. Less conservative, usually the better choice when you have many benchmarks and want to catch real regressions without being swamped.
- **Require a meaningful effect size as a second filter** — even after correction, demand the change exceed a magnitude you care about. The combination (corrected significance + minimum effect) is what keeps the flagged set small and real.

The same arithmetic applies to *any* gate that runs many checks: hundreds of bundle-size budgets, hundreds of per-file complexity thresholds. Each independent threshold is another comparison, and the family-wise false-positive rate compounds the same way.

> **Key insight:** Running N significance tests at α each gives a family-wise false-positive rate near `1 − (1−α)^N`, which approaches certainty fast. A perf gate over a big benchmark suite *must* correct for multiplicity (Bonferroni or, better, Benjamini–Hochberg) or it will flag a phantom regression every single run and train the team to ignore it.

---

## Core Concept 9 — Other Thresholds and Their Failure Modes

Coverage and performance get the most attention, but every numeric quality gate inherits the same Goodhart dynamics. The senior pattern is identical across them: diff-scope, ratchet, and watch the gaming vector.

- **Cyclomatic complexity / cognitive complexity.** Gating "no function over complexity 10" is reasonable as a ratchet on new code. The Goodhart failure: developers split one coherent 12-branch function into three artificially-separated functions that pass through shared mutable state — *lower per-function complexity, higher total complexity*, worse code. The metric improved; comprehension regressed.
- **Duplication.** "No block duplicated more than 3 times" pressures real DRY but is gamed by trivial obfuscation — rename variables, reorder statements, extract a parameter — to defeat the token-matching detector without removing the actual duplication.
- **Maintainability index.** A composite of complexity, lines, and Halstead volume. Because it's a *blend*, it is the most surrogation-prone: the team optimizes a synthetic score whose connection to actual maintainability is loose, and a high index becomes the goal in place of code anyone wants to maintain.
- **"No new warnings" ratchet.** One of the *best-behaved* gates: it is inherently diff-scoped (only new warnings fail) and the cheapest way to satisfy it is to fix or justify the warning. Its failure mode is blanket `// nolint` / `@SuppressWarnings` suppression — which review catches because the suppression is visible in the diff.
- **Bundle-size budgets.** Front-end size budgets with **CI diffing** (compare the PR's bundle to the base, fail on a meaningful increase) are an excellent ratchet — they catch the accidental import of a 200KB dependency at review time. The gaming vector is moving code behind dynamic `import()` to hide it from the initial-bundle metric while not actually reducing what users download.

The throughline: a *ratchet on the diff* with the *cheapest satisfying behavior being the desired behavior* is a good gate; a *composite absolute score* the team can move sideways is a bad one.

> **Key insight:** Composite metrics (maintainability index) are the most dangerous because they obscure *which* lever moved — you can't see the gaming. Single, legible, diff-scoped metrics ("no new warnings," "patch coverage," "bundle delta") are safest because the gaming vector is visible in the diff a reviewer is already reading.

---

## Core Concept 10 — Setting and Governing Thresholds

How you *choose* the number determines whether the gate helps or rots. The senior method is empirical and adaptive, not aspirational.

**Derive from the current distribution, then ratchet.** Do not pick a round number (80%, 90%) because it sounds rigorous — round numbers are arbitrary and usually either trivially met or impossibly far. Measure where the metric *currently* sits, set the floor just below that (so the gate passes today), and let the ratchet pull it up over time. A threshold set at "current minus a small tolerance" is always-satisfiable now and monotonically improving — which is the only kind of threshold a team won't fight.

**Diff-scope to avoid legacy punishment.** A repo-wide absolute target taxes the whole team for the sins of code written before the gate existed. Patch-scoped thresholds ask only that *new* work meet the bar, which is fair and enforceable. This is the governing principle behind Clean as You Code.

**Understand the death spiral.** Every gate that fires too often dies the same way: **false positive → developers learn to ignore it → someone disables it → the gate is gone.** A gate's credibility is a budget you spend with every false alarm. A perf gate that cries wolf on CPU noise, a coverage ratchet that fails on flaky measurement, a complexity gate that fires on legitimately-complex domain logic — each erodes trust until the team routes around all gates, including the good ones. **Keeping the false-positive rate low is not polish; it is the gate's entire viability.**

**Recalibrate periodically.** Thresholds set once and never revisited drift out of usefulness: the codebase changes, the noise floor changes, the team's baseline changes. Schedule a periodic review (quarterly) to re-derive thresholds from the current distribution, tighten ratchets that have slack, and loosen any gate whose false-positive rate has crept up.

**The meta-principle.** Wrap all of it in one sentence: *a gate's job is to catch regressions in what you care about, measured so it rarely cries wolf.* Every design choice — diff scope, ratchet, significance testing, effect-size floor, multiplicity correction, advisory-until-trusted — is in service of that one sentence. If a proposed gate doesn't catch a regression you care about, or fires when nothing regressed, it fails the test regardless of how rigorous its number looks.

> **Key insight:** A threshold is not set by what's *aspirational*; it's set by the current distribution plus a small ratchet, diff-scoped so it never punishes legacy. And its single most important property is a low false-positive rate — because the day a gate cries wolf one too many times, someone disables it, and a disabled gate protects nothing.

---

## Real-World Examples

**Codecov ratchet on a polyglot monorepo.** A 4-language repo (Go, TS, Python, Rust) sets `patch.target: 80%` (strict, the real gate) and `project.target: auto` with `threshold: 1%` (ratchet with noise tolerance). Carry-forward flags keep each service's last report alive when a PR doesn't rebuild it, so a Go-only PR doesn't read the TS service as 0%. The diff is computed against the merge-base, so an unrelated coverage change landing on `main` after branching can't spuriously fail the PR. Result: new code is held to a real bar, legacy is left alone, and the gate almost never fires for a reason unrelated to the change.

**PIT mutation gate on a payments service.** Line coverage sat at a comfortable 88% — but a diff-scoped PIT run (`mutationThreshold: 70` on changed classes) revealed surviving mutants in the fee-calculation logic: the tests *executed* the rounding code but never *asserted* on the rounded value, so flipping `Math.floor` to `Math.ceil` left every test green. Coverage said "tested"; mutation testing said "your tests can't tell correct rounding from wrong rounding." The gate forced a real assertion that would have caught a production money bug.

**Go perf gate that stopped crying wolf.** A team's per-PR perf gate failed roughly one PR in three on "regressions" of 2–6% that vanished on re-run — classic shared-runner noise. They rebuilt it: `-count=10`, base-vs-PR built and run interleaved on a dedicated isolated-core runner, `benchstat`'s Mann–Whitney p-value with a `>3%` effect-size floor, Benjamini–Hochberg across the ~80 benchmarks, and **advisory-only** (a PR comment) for the first month. False positives dropped to near zero; when it later flipped to blocking, the team trusted it. The same suite also feeds a changepoint-detection dashboard that catches slow drifts no single PR would trip.

---

## Mental Models

- **A gate activates Goodhart's law, it doesn't escape it.** The moment a measure carries consequences, the team optimizes the measure. Design every gate by finding the laziest way to satisfy it — that's the behavior you'll get.

- **Coverage measures reach; mutation measures strength.** "Did a test run this line?" vs "would a test notice if this line were wrong?" The second is the question you actually mean. Coverage gates the negative (untested), mutation gates the positive (tested well).

- **Any ratio gate can be satisfied by shrinking the denominator.** Coverage's denominator is lines of code, so it rewards deleting hard-to-test code. Diff-scoping removes the incentive — you can't raise a patch's coverage by deleting *other* code.

- **A benchmark number is a sample, not a fact.** It comes from a distribution shaped by frequency scaling, neighbors, ASLR, and GC. Treat every perf comparison as statistics: many runs, same machine, p-value, CI, effect size, multiplicity correction.

- **A gate's credibility is a budget you spend on false positives.** Every cry-wolf failure draws down trust until someone disables the gate. Low false-positive rate isn't polish — it's the gate's whole reason to exist.

---

## Common Mistakes

1. **Treating a coverage percentage as a measure of safety.** Coverage is execution, not verification; assertion-free tests report 100%. Gate on what's *uncovered* (definitely unsafe); never read covered as "safe."

2. **Setting a single repo-wide absolute coverage target.** It punishes legacy code, can't be met without back-fill heroics or file exclusions, and invites gaming. Use a patch-scoped target plus a project ratchet.

3. **Ratcheting against `main`'s tip instead of the merge-base.** Unrelated changes on `main` after you branch will spuriously pass or fail your PR. Diff and coverage delta must share the same merge-base.

4. **Failing a perf gate on a single-run percentage.** One run vs one run measures CPU jitter, not your code. Require multiple iterations, same-machine A/B, a significance test with a CI, and a minimum effect size.

5. **Ignoring multiple comparisons across a big benchmark suite.** N tests at α each give a family-wise false-positive rate near `1−(1−α)^N` — near-certain spurious flags. Correct with Bonferroni or Benjamini–Hochberg.

6. **Gating composite scores (maintainability index) you can move sideways.** Blended metrics hide *which* lever moved, so gaming is invisible. Prefer single, legible, diff-scoped metrics whose gaming vector shows up in the diff.

7. **Letting a noisy gate stay blocking.** A gate that cries wolf gets disabled, taking the good gates with it. Ship new gates advisory-until-trusted, add noise tolerances, and recalibrate when the false-positive rate creeps up.

8. **Treating the coverage-exclude list as a dumping ground.** Excluding the hard files is the most common quiet gaming vector. Every exclusion needs a justifying comment and review, because that list hides the riskiest code from the gate.

---

## Test Yourself

1. State Goodhart's law in Strathern's form and explain *surrogation* — how does a coverage gate trigger it?
2. Why is high line coverage compatible with a test suite that detects nothing? Name the orthogonal axis coverage ignores.
3. List three concrete ways to raise coverage without improving quality, and explain which two make the *codebase worse*.
4. What does mutation testing measure that coverage cannot, and what is the mechanism (mutant, kill, survive)? How do you make it affordable enough to gate on?
5. In a coverage ratchet, why must you diff against the *merge-base* and not `main`'s tip? What's a carry-forward flag for?
6. Why is failing a perf gate on "one run was 4% slower" statistically unsound? Give four ingredients of a sound perf gate.
7. With 100 benchmarks of *unchanged* code tested at `p<0.05` each, roughly what's the chance of at least one false "regression," and how do you fix it?
8. How should you *choose* a threshold value, and what is the death spiral that kills a gate set wrong?

<details>
<summary>Answers</summary>

1. **"When a measure becomes a target, it ceases to be a good measure."** Surrogation is cognitively substituting the proxy (coverage %) for the goal (defect-free code), so the team optimizes the proxy and forgets the goal. A coverage gate ties consequences to the proxy, which is exactly the condition that triggers surrogation — people come to act as though hitting the percentage *is* the objective.

2. Coverage measures only whether a line *executed*, not whether anything was *checked*. An assertion-free test executes every line (100% coverage) while verifying nothing. The orthogonal axis is **assertion strength / verification** — coverage cannot distinguish "executed and checked" from "executed and unchecked," and only the former provides safety.

3. (a) Assertion-free or tautological tests; (b) padding with tests for trivial accessors (getters/setters/`toString`); (c) excluding hard files or deleting uncovered defensive branches. The last two make the codebase *worse* — excluding hides the riskiest code from the gate, and deleting defensive code raises the ratio by shrinking the denominator while removing safety checks (a Goodhart inversion).

4. Mutation testing measures whether tests **detect faults**: it injects a mutant (small fault), runs the suite, and the mutant is *killed* if a test fails or *survives* if all pass. Surviving mutants are code where tests can't tell correct from broken — what coverage hides. Make it affordable by **diff-scoping** to changed lines, **coverage-guided** mutant selection (run only tests covering the mutated line), and **sampling** for trends with full runs nightly.

5. The merge-base is the common ancestor of your PR and the target branch; diffing against it isolates *your* change. Diffing against `main`'s tip mixes in unrelated coverage changes merged after you branched, causing spurious pass/fail. A **carry-forward flag** reuses a component's last coverage report when the current PR didn't rebuild it — preventing a service from reading as 0% in a monorepo partial upload.

6. Run-to-run variance from CPU frequency scaling, noisy neighbors, ASLR, and GC routinely exceeds the regression you're hunting, so one-vs-one measures jitter, not code. A sound gate uses: (a) multiple iterations with the distribution kept; (b) same-machine, interleaved base-vs-PR comparison; (c) a significance test (`benchstat`'s Mann–Whitney U) reporting a p-value and CI; (d) a minimum *effect size* so trivial-but-real drifts don't fire — plus multiplicity correction and ideally advisory-until-trusted.

7. `1 − (1 − 0.05)^100 ≈ 99.4%` — you're virtually guaranteed a false positive every run. Fix with a multiple-comparisons correction: **Bonferroni** (`α/n`, conservative) or **Benjamini–Hochberg** (controls false discovery rate, usually better for many benchmarks), combined with an effect-size floor.

8. Derive it from the **current distribution** (set the floor just below where the metric sits today) plus a small **ratchet**, **diff-scoped** so it doesn't punish legacy — never a round aspirational number. The **death spiral**: false positive → developers learn to ignore it → someone disables it → the gate is gone. A gate's viability *is* its low false-positive rate.

</details>

---

## Cheat Sheet

```
THE GOODHART LENS (apply to every numeric gate)
  "When a measure becomes a target, it ceases to be a good measure."
  Ask: what is the LAZIEST way to satisfy this gate? → that's the behavior you'll get.
  Surrogation = team optimizes proxy (coverage %), forgets goal (defect-free code).

COVERAGE
  Coverage = EXECUTION, not verification. Gate the negative (untested), distrust the positive.
  Gaming: assertion-free tests · tautological asserts · accessor padding ·
          excluding hard files · deleting uncovered defensive code (denominator shrink!)
  Design: PATCH target (strict) + PROJECT ratchet (target:auto, threshold:1%)
          diff vs MERGE-BASE · carryforward flags · branch>line as the criterion
          MC/DC only where mandated (DO-178C avionics, ISO 26262)

MUTATION (gaming-resistant gate)
  Measures: would a test NOTICE if this line were wrong? (kill rate = killed/total)
  Tools: PIT (JVM) · Stryker (JS/TS) · mutmut (Py) · go-mutesting/gremlins (Go) · cargo-mutants
  Affordable: diff-scope to changed lines · coverage-guided selection · sample + nightly full

PERF GATES (statistics, not single runs)
  Noise: CPU freq scaling · noisy neighbors · ASLR · GC · cache warmth
  Sound: many iters (-count=10) · same-machine interleaved A/B · benchstat (Mann–Whitney U)
         fail iff  p < 0.05  AND  median delta > effect-size floor (e.g. >3%)
  Multiplicity: N tests at α → FP rate ≈ 1−(1−α)^N → Bonferroni / Benjamini–Hochberg
  Quiet runners (taskset, perf governor) · trend/changepoint detection · advisory-until-trusted

GOVERNANCE
  Threshold = current distribution − small tolerance, then RATCHET (not a round number)
  Diff-scope to spare legacy · recalibrate quarterly
  Death spiral: false positive → ignored → disabled. Low FP rate = the gate's whole viability.
  Meta-rule: catch regressions in what you care about, measured so it rarely cries wolf.
```

---

## Summary

- A numeric quality gate does not measure quality — it **activates Goodhart's law**: the measure becomes a target and the team optimizes the measure. **Surrogation** is the cognitive engine. Design every gate by finding its laziest satisfying behavior.
- **Coverage is execution, not verification.** It's orthogonal to assertion strength, so 100% coverage is compatible with a suite that detects nothing. Gate on the *uncovered* (definitely unsafe); never read *covered* as *safe*. Every ratio gate — coverage included — is gameable by shrinking the denominator (deleting defensive code, excluding hard files).
- **Mutation testing** measures the right thing — whether tests *detect injected faults* (kill rate) — and resists gaming. Diff-scope it (PIT, Stryker, mutmut, go-mutesting) to make it affordable enough to gate changed code.
- **Coverage gate design** is patch target + project ratchet, diffed against the **merge-base**, with carry-forward flags, noise tolerance, and **branch** (not line) coverage as the criterion; **MC/DC** only where DO-178C-style regulation mandates it.
- **Performance gates are statistics.** A single-run percentage measures jitter. Use many iterations, same-machine A/B, `benchstat`'s Mann–Whitney p-value with a confidence interval, a minimum **effect size**, and **multiple-comparisons correction** (Bonferroni / Benjamini–Hochberg); prefer trend/changepoint detection and ship advisory-until-trusted.
- **Govern thresholds** by deriving from the current distribution plus a small ratchet, diff-scoping to spare legacy, and guarding the **false-positive rate above all** — because the death spiral (false positive → ignored → disabled) kills any gate set to cry wolf.

The meta-principle ties it together: a gate's job is to catch regressions in what you care about, measured so it rarely cries wolf. The next layer — [professional.md](professional.md) — is about operating these gates across an organization: rollout, exception handling, and the politics of tightening a number on a team that has to live with it.

---

## Further Reading

- **Goodhart's law / Campbell's law** — Charles Goodhart's original (1975) and Donald T. Campbell, *Assessing the Impact of Planned Social Change* (1976). The foundational statements.
- **Marilyn Strathern, "'Improving ratings': audit in the British University system"** (1997) — the source of the canonical phrasing "when a measure becomes a target, it ceases to be a good measure."
- **Surrogation research** — Choi, Hecht & Tayler, "Lost in Translation: The Effects of Incentive Compensation on Strategy Surrogation" (The Accounting Review, 2012). The mechanism by which proxies replace goals.
- **`benchstat` and Go benchmarking** — Russ Cox's `benchstat` docs and the Go testing/benchmark guidance; on the Mann–Whitney U test, p-values, and reporting confidence intervals for microbenchmarks.
- **Mutation testing** — Henry Coles, *PIT (pitest)* docs and the literature on mutation analysis (DeMillo/Lipton/Sayward); the Stryker mutator docs for the JS/TS approach and cost mitigations.
- **SonarQube Clean as You Code** — the new-code-period / diff-scoped quality-gate philosophy that underpins patch-scoped thresholds.
- **DO-178C and MC/DC** — RTCA DO-178C and the FAA's MC/DC guidance, for where modified condition/decision coverage is a regulatory gate.
- Continue to **[professional.md](professional.md)** — operating coverage and quality gates across an organization.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/senior.md) — the check/status data model these numeric gates report through, and why "everything required" collapses.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/senior.md) — the latency budget that decides which of these gates run per-PR vs nightly vs advisory.
- [Code Coverage](../../code-coverage/) — instrumentation, report formats, and the full treatment of line/branch/condition coverage.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity, duplication, and maintainability metrics and their measurement.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the macro version of the same Goodhart problem applied to delivery metrics.
