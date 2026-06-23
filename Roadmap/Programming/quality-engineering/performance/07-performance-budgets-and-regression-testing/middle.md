# Performance Budgets and Regression Testing — Middle Level

> **Roadmap:** [Performance](../README.md) → Performance Budgets and Regression Testing
> *The junior page argued why budgets matter. This page builds the gate: how to pick a threshold that isn't arbitrary, why comparing two benchmark means is a statistical trap, and how `benchstat`, a versioned baseline, and a CI job turn "feels slower" into a pull request that fails for a defensible reason.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [What Makes a Budget Good — Picking the Metric and the Threshold](#what-makes-a-budget-good--picking-the-metric-and-the-threshold)
4. [The Core Problem — You Cannot Compare Two Means](#the-core-problem--you-cannot-compare-two-means)
5. [benchstat — Significance, Not Just a Delta](#benchstat--significance-not-just-a-delta)
6. [The Baseline — Golden Numbers, Versioned](#the-baseline--golden-numbers-versioned)
7. [Wiring the Gate into CI](#wiring-the-gate-into-ci)
8. [Fighting Flakiness — Median, Relative Thresholds, Retry](#fighting-flakiness--median-relative-thresholds-retry)
9. [Frontend Budgets — Lighthouse CI, size-limit, bundlesize](#frontend-budgets--lighthouse-ci-size-limit-bundlesize)
10. [Worked Example — A Real Regression Caught in CI](#worked-example--a-real-regression-caught-in-ci)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I build a perf-regression gate that fails for a real reason and not because the runner was busy?**

A performance budget is a number you refuse to cross — p99 under 50 ms, fewer than 12 allocations per request, a JS bundle under 200 KB gzipped. A regression test is the automation that *enforces* that number on every commit. The hard part is not writing the number down; it's making the enforcement **trustworthy**. A gate that cries wolf gets disabled within a week. A gate that sleeps through a 30% slowdown is theatre.

Two things make this hard. First, **a threshold pulled from the air is indefensible** — set it too tight and CI is red constantly; too loose and real regressions slip through. Second, **benchmarks are noisy**: run the same unchanged code twice and you'll see the mean move 1–5%. A naive gate that fails on "candidate mean > baseline mean × 1.03" will fire on pure noise. This page is about getting both right: choosing budgets grounded in production reality, and using **statistics** — specifically `benchstat` and its p-value — to separate a real delta from the runner having a bad day.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain why a budget exists.
- **Required:** You can write a Go benchmark (`func BenchmarkX(b *testing.B)`) and run `go test -bench`. If not, read [02 — Benchmarking and Microbenchmarks](../02-benchmarking-and-microbenchmarks/middle.md) first.
- **Helpful:** You've edited a GitHub Actions workflow (`.github/workflows/*.yml`).
- **Helpful:** A rough sense of what a *p-value* is: the probability of seeing a difference this large if the two versions were actually identical.

---

## What Makes a Budget Good — Picking the Metric and the Threshold

A budget is a pair: **a metric** and **a threshold**. Both have to be chosen, not guessed.

**Pick the metric that maps to user pain.** Different layers call for different numbers:

| Layer | Metric | Why this one |
|---|---|---|
| Hot function / library | `ns/op`, `allocs/op`, `B/op` | Cheap to measure, deterministic enough to gate per-commit |
| Request handler | p50 / **p99** latency | A mean hides the tail; users feel the tail |
| Service | Throughput (req/s) at a fixed concurrency | Capacity is throughput at a latency you'll accept |
| Web page | Bundle size (gzipped KB), LCP, TBT | Bytes shipped and main-thread block time drive load speed |

Note **what is missing: the mean response time as a top-level SLO.** A mean of 40 ms can hide a p99 of 900 ms — and the p99 is what a user with a full cart actually experiences. Budget the tail.

**Set the threshold from data, then add headroom.** Three honest ways to pick the number, in order of preference:

1. **Derive it from a requirement.** "The page-load budget is 100 ms server-side because the product target is a 1 s total load and the frontend owns 900 ms of it." This is the only kind of threshold that survives an argument.
2. **Measure the current baseline and forbid getting worse.** "p99 is 45 ms today; the budget is 50 ms." This is a *relative* budget — you're protecting the status quo, which is most of what regression testing is.
3. **Set a ceiling from the noise floor.** For microbenchmarks, the threshold is "any change `benchstat` calls statistically significant beyond +N%." N is your tolerance band (often 3–10%), chosen so the gate clears the measurement noise on *your* hardware.

> **Key insight:** A good threshold is one you can *justify in a sentence* — derived from a product requirement, the measured status quo, or the measurement noise floor. If the only justification is "it felt about right," you've built a coin flip, and it will land red on innocent PRs until someone deletes the check.

---

## The Core Problem — You Cannot Compare Two Means

Here is the trap that sinks naive perf gates. You run the benchmark on `main`, get **120 ns/op**. You run it on the PR branch, get **123 ns/op**. That's +2.5% — a regression?

Almost certainly **not**. A single benchmark run is one sample from a noisy distribution. Run the *identical* code twice and you'll routinely see the mean wobble by a few percent, driven by:

- **CPU frequency scaling** — the core boosts or throttles depending on temperature and load.
- **Co-tenancy** — on a CI runner, your benchmark shares the box with other jobs.
- **Memory layout luck** — allocator and cache state differ between runs.
- **Garbage collection timing** — a GC cycle landing inside the measured window adds a spike.

```
run 1 of unchanged code:  118 ns/op
run 2 of unchanged code:  124 ns/op   ← +5%, and nothing changed
run 3 of unchanged code:  120 ns/op
```

If your gate is `candidate_mean > baseline_mean * 1.03`, run 2 fails the build for a change that doesn't exist. You'd ship a gate that flakes on its own noise.

The fix is the same one used everywhere noisy measurements are compared: **take multiple samples of each version and ask whether the difference is statistically significant** — that is, larger than the spread you'd expect from noise alone. A +2.5% shift where each version's runs swing ±5% is indistinguishable from luck. A +25% shift where runs swing ±1% is real. The mean alone can't tell these apart; you need the *variance* too.

> **Key insight:** A benchmark result is a distribution, not a number. "123 vs 120" is meaningless without knowing how much each one jitters. The entire job of a regression gate is to separate *signal* (a real change in the distribution) from *noise* (the same distribution sampled twice) — and that is a statistics problem, not an arithmetic one.

---

## benchstat — Significance, Not Just a Delta

`benchstat` (from `golang.org/x/perf`) is the tool that does this comparison correctly for Go benchmarks. You give it **multiple runs** of a baseline and **multiple runs** of a candidate; it computes the median of each, the spread, and a **p-value** for whether they differ.

Collect samples with `-count`:

```bash
# 10 samples of each version, saved to files
git checkout main
go test -run='^$' -bench=BenchmarkParse -count=10 ./parser > old.txt

git checkout my-feature
go test -run='^$' -bench=BenchmarkParse -count=10 ./parser > new.txt

# compare
benchstat old.txt new.txt
```

`-run='^$'` disables unit tests so only benchmarks run. `-count=10` gives `benchstat` enough samples to estimate the spread. Reading the output is the skill:

```
                │   old.txt   │             new.txt              │
                │   sec/op    │   sec/op     vs base             │
Parse-8           120.4n ± 2%   122.1n ± 3%        ~ (p=0.481 n=10)
Encode-8          88.30n ± 1%   97.55n ± 2%   +10.48% (p=0.000 n=10)
geomean           103.1n        109.2n         +5.79%
```

Decode every column:

- **`120.4n ± 2%`** — the **median** time per op and the spread (here ±2% around the median). The `±` is the headline noise number; if it's large, your environment is too noisy to gate on.
- **`~ (p=0.481 n=10)`** — the tilde means **no statistically significant change**. `Parse` moved +1.4% in the mean, but with p=0.481 that's well inside the noise. **A `~` is a pass.** Do *not* fail the build on it.
- **`+10.48% (p=0.000 n=10)`** — a **real** regression. `Encode` got 10% slower, p=0.000 says the chance this is noise is effectively zero. **This is what your gate should catch.**
- **`geomean`** — the geometric mean across all benchmarks, a single rollup number.

The convention: `benchstat` only prints a percentage delta when the change is significant (by default p < 0.05). Otherwise it prints `~`. That single rule — **fail on a printed delta, pass on `~`** — is the heart of a non-flaky gate.

You can also gate on allocations, which are *deterministic* and therefore far easier than time:

```
                │  old.txt   │            new.txt             │
                │ allocs/op  │ allocs/op   vs base            │
Encode-8          4.000 ± 0%   7.000 ± 0%  +75.00% (p=0.000 n=10)
```

Allocs have `± 0%` spread — they don't jitter — so an allocs/op regression is unambiguous. Many teams gate on `allocs/op` *first* because it's the cheapest reliable signal.

> **Key insight:** `benchstat` turns "is this slower?" into "is this *significantly* slower?" — and the `~` symbol is doing real work. It means "the difference is within the noise; treat it as no change." A regression gate that fails on `~` is a gate that fails on noise. The whole design reduces to: **a printed `%` delta is a finding; a `~` is a non-event.**

---

## The Baseline — Golden Numbers, Versioned

`benchstat` compares two files, so a regression gate needs a **baseline**: the "before" numbers to compare the PR against. Where do they come from?

**Option A — compute the baseline in CI from the merge target.** On every PR, check out the base branch (`main`), run the benchmarks, save `old.txt`, then check out the PR head, run again, save `new.txt`, and `benchstat` the two. This is the most robust approach because both runs happen on the **same runner, back to back**, cancelling out most hardware variance. The cost is double the benchmark time per PR.

**Option B — store golden numbers in the repo.** Commit a `bench/baseline.txt` (or a JSON of per-benchmark medians) tied to a known-good commit. The PR runs benchmarks once and compares against the committed file. Cheaper, but fragile: the baseline was measured on a *different* machine at a *different* time, so the noise floor is wider and you'll need a looser tolerance. When you intentionally accept a perf change, you regenerate and commit the file — the diff becomes a reviewable record of "we got 8% faster here on purpose."

```
repo/
  bench/
    baseline.txt        ← golden numbers, regenerated on intentional changes
    README.md           ← "how to regenerate: make bench-baseline"
```

```makefile
bench-baseline:
	go test -run='^$$' -bench=. -count=10 ./... > bench/baseline.txt
	@echo "Baseline updated. Commit bench/baseline.txt with a note WHY it changed."
```

In practice, **Option A is the default for microbenchmark gates** (same-runner comparison kills variance) and **Option B is used when benchmarks are too slow to run twice per PR**, or for tracking long-term trends across releases.

> **Key insight:** A baseline measured on a *different machine* than the candidate is comparing apples to a slightly different apple — hardware variance pollutes the delta. Whenever you can, measure baseline and candidate **on the same runner, in the same job**, so the only systematic difference between them is the code.

---

## Wiring the Gate into CI

Here is a complete, working GitHub Actions job using Option A (same-runner baseline). It checks out `main`, benchmarks it, checks out the PR, benchmarks it, and uses `benchstat` to fail only on a *significant* regression.

```yaml
# .github/workflows/perf.yml
name: perf-regression
on: pull_request

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # need history to check out the base branch

      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - name: Install benchstat
        run: go install golang.org/x/perf/cmd/benchstat@latest

      - name: Benchmark base (main)
        run: |
          git checkout ${{ github.event.pull_request.base.sha }}
          go test -run='^$' -bench=. -benchmem -count=10 ./... > /tmp/old.txt

      - name: Benchmark candidate (PR)
        run: |
          git checkout ${{ github.event.pull_request.head.sha }}
          go test -run='^$' -bench=. -benchmem -count=10 ./... > /tmp/new.txt

      - name: Compare
        run: |
          benchstat /tmp/old.txt /tmp/new.txt | tee /tmp/result.txt

      - name: Fail on significant regression
        run: |
          # benchstat prints a "+N%" delta ONLY when significant.
          # Fail if any sec/op or allocs/op regressed past the tolerance band.
          python3 scripts/check_regression.py /tmp/result.txt --tolerance 5
```

The gate logic lives in a small script rather than a fragile shell one-liner, because you want a **tolerance band** (don't fail on a significant but tiny +1% — only on changes past, say, +5%) and a clear failure message:

```python
# scripts/check_regression.py
import re, sys, argparse

p = argparse.ArgumentParser()
p.add_argument("file"); p.add_argument("--tolerance", type=float, default=5.0)
a = p.parse_args()

# match lines like:  Encode-8  88.30n ± 1%  97.55n ± 2%  +10.48% (p=0.000 n=10)
delta_re = re.compile(r"^(\S+)\s+.*?([+-]\d+\.\d+)%\s+\(p=")
regressions = []
for line in open(a.file):
    m = delta_re.match(line)
    if m and float(m.group(2)) > a.tolerance:     # positive = slower
        regressions.append((m.group(1), float(m.group(2))))

if regressions:
    print("PERF REGRESSION beyond +%.1f%% tolerance:" % a.tolerance)
    for name, pct in regressions:
        print("  %-20s +%.2f%%" % (name, pct))
    sys.exit(1)
print("No significant regression beyond tolerance. OK.")
```

Two design choices make this gate trustworthy rather than annoying:

1. **It only looks at lines `benchstat` flagged significant** (lines with a `±%` delta, not `~`). Noise is filtered by `benchstat` before the script ever sees it.
2. **It has a tolerance band on top of significance.** A change can be statistically real and still operationally irrelevant (+1.2% on a function called twice at startup). The band lets you say "real *and* big enough to care about."

---

## Fighting Flakiness — Median, Relative Thresholds, Retry

Even with `benchstat`, CI runners are hostile measurement environments. A few hardening tactics, in order of impact:

**Use the median, never a single run.** `-count=10` and `benchstat`'s median already do this. One run is a coin flip; ten runs and a median is a measurement. Never gate on `-count=1`.

**Gate on relative deltas, not absolute numbers.** "Fail if slower than 120 ns/op" breaks the moment you move from a fast runner to a slow one — the absolute number is hardware-specific. "Fail if more than 5% slower than the base branch *on this same runner*" travels across hardware unchanged. Relative-to-baseline is the portable form.

**Pin the runner and quiet the box.** Use a consistent `runs-on` (don't mix runner classes). For serious gates, a dedicated, isolated runner with frequency scaling disabled cuts `±%` dramatically. The wider your noise floor (`± 8%` vs `± 1%`), the larger a regression has to be before `benchstat` can detect it — noisy environments are *blind* to small regressions.

**Retry the comparison, not just the test.** If a run produces a borderline result, re-running the *whole comparison* (fresh baseline + candidate) is legitimate — you're taking a new measurement, not p-hacking a green build. What is *not* legitimate: re-running until it passes and ignoring the failures. If it fails 2 of 3 times, it's a regression.

**Prefer allocs/op for the strict gate.** Allocations are deterministic (`± 0%`). An `allocs/op` budget never flakes, so make it a hard gate; treat `ns/op` as a softer, wider-tolerance gate.

> **Key insight:** Flakiness is not bad luck — it's a noise floor wider than the regression you're trying to detect. You fight it two ways: **shrink the noise** (more samples, quieter runner, deterministic metrics like allocs) and **widen the signal you require** (relative thresholds with a tolerance band). A gate is only as sensitive as `regression_size > noise_floor`.

---

## Frontend Budgets — Lighthouse CI, size-limit, bundlesize

The same discipline applies to the browser, where the budgets are **bytes shipped** and **time to interactive**. The good news: bundle size is *deterministic* — a given build always produces the same byte count — so size gates never flake.

**size-limit** — enforce a gzipped/brotli byte budget per entry point:

```json
// package.json
{
  "size-limit": [
    { "path": "dist/main.js", "limit": "180 KB" },
    { "path": "dist/vendor.js", "limit": "120 KB" }
  ],
  "scripts": { "size": "size-limit" }
}
```

```yaml
# in CI
- run: npm run build
- run: npx size-limit          # exits non-zero if any bundle exceeds its limit
```

`bundlesize` does the same job with a similar config; `size-limit` additionally estimates download+execution time, not just bytes. Either one turns "the bundle quietly grew 60 KB over six PRs" into a single PR that fails the moment it crosses the line.

**Lighthouse CI** — budget the *runtime* metrics (LCP, Total Blocking Time, performance score) by running Lighthouse against a built preview:

```js
// lighthouserc.js
module.exports = {
  ci: {
    collect: { url: ['http://localhost:3000/'], numberOfRuns: 5 },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'total-blocking-time': ['warn', { maxNumericValue: 300 }],
      },
    },
  },
};
```

```yaml
- run: npm run build && npm start &
- run: npx @lhci/autorun
```

Note `numberOfRuns: 5` — Lighthouse metrics are noisy (they involve a real browser), so it runs multiple times and takes the median, exactly like `benchstat` does for Go. The split between `error` (fail the build) and `warn` (report only) is the frontend equivalent of a tolerance band: hard-fail on the metrics you've committed to, warn on the ones you're watching.

> **Key insight:** Frontend budgets divide cleanly into **deterministic** (bundle bytes — gate hard, no statistics needed) and **noisy runtime** (LCP, TBT — needs multiple runs and a median, same as a Go microbenchmark). Bundle-size gates are the cheapest, most reliable perf gate any web team can add; do that one first.

---

## Worked Example — A Real Regression Caught in CI

A PR refactors a JSON encoder to be "cleaner." The author runs the gate locally before pushing:

```bash
git stash                                                   # stash the refactor
go test -run='^$' -bench=BenchmarkEncode -benchmem -count=10 ./codec > old.txt
git stash pop                                               # restore it
go test -run='^$' -bench=BenchmarkEncode -benchmem -count=10 ./codec > new.txt
benchstat old.txt new.txt
```

```
                │   old.txt    │              new.txt              │
                │    sec/op     │    sec/op      vs base            │
Encode-8           1.842µ ± 1%    2.431µ ± 2%    +31.97% (p=0.000 n=10)

                │   old.txt    │              new.txt              │
                │  allocs/op    │  allocs/op     vs base            │
Encode-8           6.000 ± 0%    14.00 ± 0%     +133.3% (p=0.000 n=10)
```

The story is unambiguous: the "cleaner" version is **32% slower** and allocates **more than twice** as much, both with `p=0.000` — zero chance this is noise, confirmed by the deterministic `± 0%` on allocs. The refactor moved a buffer from the stack to the heap. In CI, `scripts/check_regression.py` sees `+31.97%` past the 5% tolerance and fails:

```
PERF REGRESSION beyond +5.0% tolerance:
  Encode-8             +31.97%
```

The PR goes red with a specific, defensible reason. The author reuses a pooled buffer, re-runs, and gets:

```
Encode-8           1.842µ ± 1%    1.798µ ± 2%        ~ (p=0.214 n=10)
```

A `~` — no significant change from baseline. The gate passes. The contrast is the whole point of the page: the *same gate*, on the *same code path*, correctly fails the 32% regression and correctly ignores the −2.4% wobble, because it reasons about significance instead of comparing two bare means.

---

## Mental Models

- **A benchmark result is a distribution, not a number.** `123 ns/op` is one draw from a noisy bell curve. Comparing two draws tells you nothing; comparing two *distributions* (medians + spread + p-value) tells you whether the code actually changed.

- **`~` is the most important symbol in `benchstat`.** It means "the difference is buried in the noise — treat it as no change." Build your gate so `~` is always a pass and a printed `%` is always a finding, and most of your flakiness disappears.

- **A threshold is a sentence, not a feeling.** If you can't justify the number in one sentence (a product requirement, the measured status quo, or the noise floor), it's a coin flip wearing a lab coat.

- **Sensitivity = signal vs noise floor.** A gate can only catch regressions larger than its measurement noise. Shrink the noise (more samples, quieter runner, deterministic metrics) or accept that you're blind to small regressions — there is no third option.

- **Deterministic metrics are free gates.** `allocs/op` (Go) and bundle bytes (web) don't jitter, so they gate hard with no statistics. Add those first; save the statistical machinery for the noisy time-based metrics.

---

## Common Mistakes

1. **Comparing two single runs.** `120` vs `123` from one run each is noise. Always `-count=10` (or more) and let `benchstat` judge significance. A `-count=1` gate is a random number generator wired to your CI status.

2. **Failing the build on a `~` result.** `~` means *no significant change*. A gate that goes red on it will fire on innocent PRs and get disabled. Only fail on a printed `%` delta past your tolerance.

3. **Absolute thresholds across different hardware.** "Fail if > 120 ns/op" passes on your laptop and fails on the slower CI runner for no real reason. Gate on *relative* change versus a same-runner baseline.

4. **Comparing a baseline measured on a different machine/time.** Hardware and co-tenancy variance leak straight into the delta. Measure baseline and candidate back-to-back on the same runner whenever you can.

5. **No tolerance band on top of significance.** A change can be statistically real and operationally irrelevant (+1% on a cold-path function). Require *significant **and** past N%* before failing, or you'll block PRs over rounding.

6. **Gating only on the mean, ignoring the tail.** A budget on mean latency can pass while p99 doubles. Budget the percentile users actually feel (p99), not the average that hides the tail.

7. **Re-running until green.** Re-measuring a borderline result is fine; ignoring 2-of-3 failures because the 3rd passed is p-hacking. If it regresses more often than not, it regressed.

---

## Test Yourself

1. You run a benchmark on `main` (120 ns/op) and on a PR (123 ns/op). Is this a regression? What do you need before you can answer?
2. In `benchstat` output, what does `~ (p=0.481 n=10)` mean, and should your gate fail on it?
3. Why is gating on `allocs/op` more reliable than gating on `ns/op`?
4. Why is a *relative* threshold (% vs base branch) better than an *absolute* one (< 120 ns/op) for a CI gate?
5. Why is it better to measure the baseline in the *same CI job* as the candidate rather than reading committed golden numbers?
6. Which frontend budget needs multiple runs and a median, and which can be gated on a single deterministic build — and why?

<details>
<summary>Answers</summary>

1. You can't tell yet — +2.5% from single runs is well within typical benchmark noise. You need *multiple samples* of each version and a significance test (`benchstat` p-value); only a significant delta beyond your tolerance counts.
2. `~` means **no statistically significant change** — the difference is inside the noise (p=0.481 is far above 0.05). The gate should **pass**; failing on `~` is failing on noise.
3. Allocations are deterministic — `benchstat` shows `± 0%` spread — so a change is unambiguous and never flakes. Time (`ns/op`) jitters with CPU scaling, co-tenancy, and GC, so it needs statistics and a tolerance band.
4. Absolute thresholds are hardware-specific: the same code crosses 120 ns/op on a slow runner and not a fast one, causing false failures. A relative threshold compares against a baseline on the *same* runner, so it travels across hardware.
5. Same-runner, back-to-back measurement cancels hardware and co-tenancy variance — the only systematic difference between baseline and candidate is the code. Committed golden numbers were measured on a different machine/time, widening the noise floor.
6. Bundle size is deterministic (same build → same bytes), so gate it on a single build with no statistics. Runtime metrics like LCP/TBT come from a real browser and are noisy, so run multiple times (`numberOfRuns: 5`) and take the median — same reasoning as `benchstat`.

</details>

---

## Cheat Sheet

```
COLLECT SAMPLES (Go)
  go test -run='^$' -bench=. -benchmem -count=10 ./... > old.txt   # baseline
  go test -run='^$' -bench=. -benchmem -count=10 ./... > new.txt   # candidate

COMPARE
  benchstat old.txt new.txt
    120.4n ± 2%   122.1n ± 3%   ~ (p=0.481 n=10)   → PASS (no sig change)
    88.30n ± 1%   97.55n ± 2%   +10.48% (p=0.000)  → FAIL (real regression)
  RULE:  ~  = pass.   printed %  = finding.

GATE DESIGN
  fail when:  significant (printed %)  AND  delta > tolerance band (e.g. +5%)
  metric pick:  allocs/op (deterministic, hard gate) | ns/op (noisy, wide band)
                p99 latency (not mean) | bundle bytes (deterministic)

ANTI-FLAKE
  -count >= 10            never gate on a single run
  relative, not absolute  "5% slower than base", not "< 120 ns/op"
  same-runner baseline    measure old + new back-to-back in one job
  quiet/pinned runner     smaller ± = can detect smaller regressions

FRONTEND
  size-limit / bundlesize   deterministic byte budget → gate hard, no stats
  lighthouse-ci             LCP/TBT, numberOfRuns:5 + median; error=fail warn=watch
```

---

## Summary

- A budget is a **metric + threshold**. Pick the metric that maps to user pain (p99, not mean; allocs/op; bundle bytes), and set the threshold from a *requirement*, the *measured status quo*, or the *noise floor* — never a feeling.
- The core problem is that **you cannot compare two means**: benchmark runs jitter a few percent on identical code, so a naive `mean > baseline × 1.03` gate fails on its own noise.
- **`benchstat`** solves this by comparing distributions: median, spread (`±%`), and a **p-value**. A `~` means no significant change (**pass**); a printed `%` delta means a real change (**finding**). This single rule is the heart of a non-flaky gate.
- A gate needs a **baseline**. Prefer measuring it on the *same runner, same job* as the candidate (kills hardware variance); fall back to versioned golden numbers when benchmarks are too slow to run twice.
- Wire it into CI by collecting `-count=10` samples of base and head, running `benchstat`, and failing only on a delta that is **significant *and* past a tolerance band**.
- Fight flakiness with **medians, relative thresholds, deterministic metrics (allocs/op), and a quiet pinned runner**. A gate can only catch regressions larger than its noise floor.
- The web mirrors this: **deterministic** bundle-size budgets (size-limit / bundlesize) gate hard; **noisy** runtime metrics (Lighthouse CI's LCP/TBT) need multiple runs and a median, exactly like `benchstat`.

---

## Further Reading

- `golang.org/x/perf/cmd/benchstat` — the tool's own docs; read the section on how it computes the p-value and what `±` means.
- *Statistically Rigorous Java Performance Evaluation* — Georges, Buytaert, Eeckhout. The paper that made "don't compare two means" rigorous; the lessons are language-agnostic.
- *Lighthouse CI* docs — assertions, budgets, and the `numberOfRuns` median strategy.
- `size-limit` and `bundlesize` READMEs — practical per-entry-point byte budgets in CI.
- Brendan Gregg, *Systems Performance* — the chapters on measurement methodology and why the mean lies.

---

## Related Topics

- [junior.md](junior.md) — why budgets exist and what a regression test protects.
- [senior.md](senior.md) — non-parametric tests (Mann-Whitney U), change-point detection over long trends, and gating macro-benchmarks and production SLOs.
- [02 — Benchmarking and Microbenchmarks](../02-benchmarking-and-microbenchmarks/middle.md) — writing benchmarks that aren't lies (DCE, warm-up, stable measurement) — the input this gate depends on.
- [03 — Latency and Throughput](../03-latency-and-throughput/middle.md) — where p99, tail-latency, and throughput budgets come from.
- [01 — Profiling](../01-profiling/01-cpu-profiling/middle.md) — once the gate goes red, profiling is how you find *why* it regressed.
