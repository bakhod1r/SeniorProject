# Performance Budgets and Regression Testing — Interview Questions

> **Roadmap:** [Performance](../README.md) → Performance Budgets and Regression Testing
> *A performance-regression interview rarely asks "what is a budget." It asks "CI says you regressed p99 by 4% — is that real?" and then watches whether you reach for a t-test (wrong) or a distribution-free test plus an effect size (right), whether you know why the cloud runner poisons the measurement, and whether you can tell the difference between a gate that catches regressions and a gate that floods you with false positives until someone deletes it. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Why Budgets and Regression Gates](#theme-1--why-budgets-and-regression-gates)
3. [Theme 2 — Defining Budgets](#theme-2--defining-budgets)
4. [Theme 3 — The Noise Problem and Statistics](#theme-3--the-noise-problem-and-statistics)
5. [Theme 4 — Detection in Time Series](#theme-4--detection-in-time-series)
6. [Theme 5 — Stable Measurement Environment](#theme-5--stable-measurement-environment)
7. [Theme 6 — Scenario and Debugging](#theme-6--scenario-and-debugging)
8. [Theme 7 — Design and Judgment](#theme-7--design-and-judgment)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **mean vs distribution** (you don't ship the average; you ship the tail)
- **significance vs effect size** (is the change real vs is the change big enough to care)
- **signal vs noise** (a number moved vs the system actually changed)
- **gate vs alert vs trend** (block the merge vs page someone vs draw a line on a chart)
- **measured-here vs ground-truth-there** (the microbench in CI vs what users feel in production)

Nearly every question in this bank is one of those distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a number or a tool.

---

## Theme 1 — Why Budgets and Regression Gates

### Q1.1 — Why do you need an automated performance gate at all? Can't you just profile when things feel slow?

> **Testing:** Whether you understand performance rot as a continuous, invisible accumulation rather than a discrete event.

**A.** Because performance dies by a thousand cuts, not by one catastrophe. Each individual change adds 0.3% — a defensible allocation here, a slightly chattier query there, one more middleware in the chain — and no single PR is worth blocking. But thirty of those across a quarter is a 10% regression that nobody can attribute to anything, because the moment to catch each one has already passed. By the time it "feels slow," you're doing archaeology across hundreds of commits with `git bisect` and a vague repro, which is the most expensive possible way to find a regression. A gate moves detection to the cheapest moment: the PR that caused it, while the author still has the context in their head and the diff is one screen. The gate's value isn't catching the big regression — it's making the *small* ones visible while they're still attributable.

### Q1.2 — What does it mean to treat a performance budget as a "testable line," and why is that framing important?

> **Testing:** Whether you see a budget as an executable assertion, not a wiki page.

**A.** A budget is a number that a machine can evaluate to pass/fail on every change — "p99 of the checkout endpoint stays under 200ms," "the JS bundle stays under 250KB gzipped," "this hot function allocates zero times per call." The framing matters because the alternative — a performance *goal* in a design doc — has no teeth. A goal is something everyone agrees with and no one enforces; it degrades silently because nothing fails when you cross it. A budget is enforced by the same mechanism as correctness: it's a test. That's the whole shift — performance stops being an aspiration that depends on individual diligence and becomes a property the CI system defends automatically, like a failing unit test. The discipline is identical to test-driven development applied to a non-functional requirement.

### Q1.3 — A skeptic on your team says "we'll optimize when we have a problem." What's the steelman, and where does it break?

> **Testing:** Intellectual honesty — can you argue against budgets before defending them?

**A.** The steelman is real: premature optimization burns engineering time on code paths that don't matter, micro-optimizations often get erased by the next refactor, and a budget on the wrong metric creates busywork defending a number no user cares about. Knuth's point stands — most code isn't hot, and gating everything is waste. Where it breaks is the asymmetry between *adding* slowness and *removing* it. Slowness accretes for free, distributed across many authors, with no owner. Removing it requires a dedicated, expensive project against code those authors have since forgotten. So "optimize when we have a problem" works for the *absolute* level of performance but fails for the *trend*: by the time you have a problem, you've lost the cheap attribution. The synthesis is to budget only the things that matter to users (the SLO-linked metrics, the known-hot paths) and let everything else float — gate the trend on what counts, don't gate everything.

---

## Theme 2 — Defining Budgets

### Q2.1 — What should you actually put a budget on? Give me the categories.

> **Testing:** Whether your budgeting is structured around what users experience and what the machine consumes.

**A.** Four broad families, and you usually want one from each:

- **Latency, expressed as a tail percentile** — p99 (and p99.9 for anything fanned-out), almost never the mean. The average hides the tail, and the tail is what users feel and what cascades in a fanout.
- **Throughput / resource efficiency** — requests per second per core, or CPU-seconds per request. This catches regressions that latency hides when the system isn't loaded.
- **Allocation / memory** — allocs per operation and bytes per operation (Go's `benchstat` reports these directly). Allocation regressions are a leading indicator: they show up in microbenchmarks before they manifest as GC-pressure latency in production.
- **Artifact size** — bundle size (gzipped/brotli), binary size, image size. For frontend this is a direct proxy for load time on slow networks and the easiest budget to enforce because it's deterministic — no noise at all.

The pattern: budget a tail latency for what users feel, an efficiency metric for what it costs, allocations as an early-warning leading indicator, and a size for static artifacts.

### Q2.2 — Where do you set the threshold? Give me a principled answer, not "10% slower than today."

> **Testing:** Whether you can distinguish a regression *band* from an absolute *ceiling*, and tie thresholds to noise.

**A.** There are two distinct kinds of threshold and you need both:

1. **The absolute ceiling** — derived top-down from the SLO. If the product SLO is "checkout p99 under 300ms" and the rest of the request budget (network, downstream) consumes 100ms, this service gets a 200ms ceiling. This number comes from the user requirement, not from current performance.
2. **The regression band** — a relative tolerance for change-detection, and this must be set *above the measurement noise*, not below it. If your harness's run-to-run variance is ±3%, a 2% regression band is uselessly flaky — it'll fire on noise constantly. You measure your own noise floor first (run the unchanged baseline against itself many times, look at the spread), then set the band comfortably outside it.

The mistake is picking a round number like 5% with no idea whether the harness can even resolve 5%. A budget tighter than your measurement precision is a random number generator wearing a CI badge.

### Q2.3 — How does a performance budget relate to an SLO? Are they the same thing?

> **Testing:** Whether you connect the pre-production gate to the production objective.

**A.** They're linked but live at different borders. The **SLO** is the production objective measured on real traffic — "99.9% of requests under 300ms over a 28-day window" — and it's enforced by alerting and an error budget. The **performance budget** is the pre-production proxy: a CI gate that tries to stop a regression *before* it can burn the SLO's error budget. The right relationship is *derivation*: the budget's absolute ceiling is computed backward from the SLO so that staying under the budget keeps you safely under the SLO with margin. The budget is the cheap, early, synthetic check; the SLO is the expensive, real, late check. A regression that slips the budget should eventually show up as SLO-error-budget burn — and when it does without the budget firing, that's a signal your budget is testing the wrong thing or your environment is too noisy to catch it. They're two layers of the same defense, not redundant.

### Q2.4 — Why budget allocations when users only feel latency?

> **Testing:** Whether you understand leading vs lagging indicators.

**A.** Because allocations are a *leading* indicator and latency is a *lagging* one. An allocation regression in a microbenchmark is deterministic, low-noise, and shows up immediately — `benchstat` will tell you a function went from 2 allocs/op to 5 allocs/op with near-certainty. That same regression manifests as user-facing latency only later and indirectly, through GC pressure under production load, where it's buried in noise and hard to attribute. So allocs-per-op is a cheap, sharp early warning for a class of latency regression that would otherwise be expensive and late to detect. It's also far less noisy than wall-clock time, which makes it a more reliable gate. The senior framing: budget the deterministic leading indicator (allocations) precisely, and budget the noisy lagging indicator (latency) loosely.

---

## Theme 3 — The Noise Problem and Statistics

### Q3.1 — CI reports the new build's mean latency is 4% higher than the baseline's mean. Is that a regression?

> **Testing:** The single most important concept in the topic — you cannot compare two point estimates.

**A.** You can't tell from that statement, because comparing two means tells you nothing without the spread and the sample sizes. A 4% difference between two means is meaningless if the run-to-run variance is ±8% — you've just observed noise. The question "is this a regression" is a question about *distributions*, not two numbers: you ran the baseline N times and got a distribution of measurements, you ran the new code N times and got another distribution, and you're asking whether those two distributions are actually different or whether the difference you see is consistent with random sampling from the same underlying distribution. To answer it you need the samples, not the means — which is why a serious harness keeps every run, not just the average. The correct response to "the mean went up 4%" is "show me the distributions and how many runs each came from."

### Q3.2 — Why is a Student's t-test usually the wrong tool for benchmark results?

> **Testing:** Whether you know your data violates the test's assumptions.

**A.** The t-test assumes the data is roughly normally distributed, and benchmark latency almost never is. Latency distributions are **right-skewed with a long tail** — bounded below by some physical minimum, with occasional large spikes from GC pauses, context switches, cache misses, or a noisy neighbor. They're often multimodal too (a fast path and a slow path). A t-test on that data is comparing means of a distribution where the mean isn't even a good summary, and the skew and outliers wreck its assumptions, giving you confident-looking but wrong p-values. The right tool is a **non-parametric, distribution-free test** like the **Mann-Whitney U test** (also called the Wilcoxon rank-sum test), which asks whether one distribution tends to produce larger values than the other without assuming any particular shape. It works on the ranks of the data, so a single outlier can't dominate it. This is essentially what Go's `benchstat` does — it uses Mann-Whitney to decide whether two sets of benchmark runs differ.

### Q3.3 — Explain the difference between statistical significance and effect size, and why a gate needs both.

> **Testing:** The distinction that separates people who've actually run regression gates from people who've read about p-values.

**A.** **Significance** answers "is this difference real, or could it be random noise?" — it's a p-value, a statement about confidence. **Effect size** answers "how big is the difference?" — the actual magnitude, like +3.2% with a confidence interval. They're independent, and a gate needs both because each alone is a trap. With enough samples, a *statistically significant* result can be trivially small — you can prove with high confidence that a function got 0.1% slower, which is real but nobody cares. Conversely a large effect from few samples may not be significant — the measured difference is big but you can't rule out noise. So the gate logic is two-pronged: fail only when the change is **both** statistically significant (probably not noise) **and** larger than a meaningful threshold (worth blocking a merge over). Gating on significance alone gives you a gate that blocks merges over 0.1% noise-confirmed changes; gating on effect size alone gives you a gate that fires on random spikes. You need "probably real AND big enough to matter."

### Q3.4 — You have 500 benchmarks running on every PR. What statistical problem does that create, and how do you handle it?

> **Testing:** Multiple-comparisons — the false-positive flood that kills suites at scale.

**A.** The **multiple-comparisons problem**. If each benchmark uses a 95%-confidence test, each has a ~5% false-positive rate by construction. Run 500 of them on an unchanged baseline and you expect ~25 to fail *purely by chance*, every single run. The gate becomes the boy who cried wolf: it's red constantly, every failure looks plausible, people stop reading it, and within a month someone sets it to non-blocking. Handling it: (1) **correct for multiplicity** — Bonferroni (divide your alpha by the number of tests; crude but safe) or, better, **Benjamini-Hochberg** to control the *false discovery rate* rather than the family-wise error, which is far less conservative for large suites; (2) **require effect size** so the marginal noise-driven significances get filtered out anyway; (3) **require persistence** — only alert on a regression that reproduces across multiple consecutive runs, not a one-shot flag. The combination of FDR control plus an effect-size floor plus persistence is what makes a large suite's gate trustworthy instead of a noise generator.

### Q3.5 — Why does keeping all raw measurements matter, not just the summary statistic?

> **Testing:** Whether you understand that the test operates on samples, not summaries.

**A.** Because every legitimate comparison method — Mann-Whitney, bootstrap confidence intervals, distribution overlap — operates on the *samples*, and you can't reconstruct samples from a mean. If your harness only stores "p99 = 187ms," you've thrown away the information needed to know whether a later 192ms is a regression or noise; you're back to comparing two point estimates, which we established is meaningless. Storing the full distribution (or at least a rich set of percentiles and the raw run vector) lets you compute effect sizes with confidence intervals after the fact, re-run the comparison with a different test, and characterize the noise floor. It also lets you spot *distribution-shape* changes — a regression that doesn't move the median but fattens the tail, which a single summary stat would completely miss.

---

## Theme 4 — Detection in Time Series

### Q4.1 — Pairwise A/B (PR vs baseline) is the obvious gate. What does it miss, and what's the alternative?

> **Testing:** Whether you know change-point detection and why per-commit comparison has blind spots.

**A.** Pairwise A/B catches a regression large enough to clear the noise floor *in a single step*. It misses the slow drift — the death-by-a-thousand-cuts case where each commit adds 0.3%, individually well under the band, but the trend is steadily upward. Every PR passes its A/B comparison and the system rots anyway. The alternative is to treat the metric as a **time series over the commit history** and run **change-point detection** on it: an algorithm (e.g., E-divisive, or the approach behind MongoDB's "Hunter" / the Pingmer/Performance-Tools lineage) that scans the series for the point where the distribution's statistics shifted, even if no single step was significant. This catches the gradual creep that pairwise comparison structurally cannot, and it has a nice property — it can attribute a slow drift to the *region* of commits where the shift began, narrowing the bisect. The mature setup runs *both*: per-PR A/B as a fast blocking pre-merge check, and change-point detection over the mainline series as an asynchronous trend watcher.

### Q4.2 — What makes a good baseline to compare against, and why is "the previous run" a bad one?

> **Testing:** Whether you understand baselines as statistical objects, not single data points.

**A.** A good baseline is a *distribution*, not a point — ideally a rolling window of recent mainline runs that captures the current noise floor, so the comparison is "is this PR's distribution different from the recent population of trusted runs." "The previous run" is a single sample, so comparing against it inherits all of that one run's noise: if the previous run happened to be a fast outlier, every PR after it looks like a regression, and vice versa. You're comparing one noisy point to another noisy point. The fixes are to baseline against an *aggregate* of many recent runs (more statistical power, stable reference), to re-establish the baseline only from runs on a known-good environment, and to recompute it on a schedule so it tracks legitimate drift without locking in a bad day. For absolute budgets the baseline is the SLO-derived ceiling instead, which doesn't drift.

### Q4.3 — Your blocking gate is per-PR, but you also keep a trend dashboard. What's each one for?

> **Testing:** Whether you can place blocking vs observation in the right roles.

**A.** They serve different failure modes and have different costs of being wrong. The **per-PR blocking gate** must be fast, must have a very low false-positive rate (a flaky blocking gate destroys developer trust faster than almost anything), and therefore should only fire on large, clearly-significant, single-step regressions — it's deliberately *insensitive* to protect against false blocks. The **trend dashboard** runs asynchronously over the mainline series with change-point detection, can afford to be more *sensitive* because it doesn't block anyone — a false positive there costs an investigation, not a blocked merge — and it's where the slow drift gets caught. So the division is: blocking gate catches the obvious cliff at low false-positive cost; trend dashboard catches the slow slope at higher sensitivity because the cost of a false alarm is just a look, not a stopped pipeline. Putting the sensitive detection on the blocking path is the classic mistake that gets gates disabled.

---

## Theme 5 — Stable Measurement Environment

### Q5.1 — Why do microbenchmark gates break on standard cloud CI runners?

> **Testing:** Whether you understand that shared, virtualized, frequency-scaling hardware destroys measurement stability.

**A.** Because a shared cloud runner is the worst possible place to measure time precisely. The problems stack: **noisy neighbors** — you're on a multi-tenant host and another VM's load steals CPU and pollutes caches; **CPU frequency scaling / turbo** — the core clocks up and down unpredictably based on thermal and power budgets, so the same code runs at different speeds run to run; **no CPU pinning** — the scheduler migrates your benchmark across cores, blowing away cache locality; **variable instance assignment** — today's runner might be a different physical CPU generation than yesterday's. The result is run-to-run variance of 10-30% on wall-clock microbenchmarks, which swamps the 2-5% regression you're trying to detect. The gate fires on noise, gets distrusted, gets disabled. Cloud CI is fine for correctness tests, which are deterministic, and fine for *deterministic* perf metrics like bundle size or allocation counts — but it's structurally unable to give you a stable wall-clock floor.

### Q5.2 — So how do you actually get stable wall-clock measurements?

> **Testing:** The concrete remediations — dedicated hardware plus statistical defenses.

**A.** Two complementary approaches:

1. **Control the hardware.** Use a **dedicated, bare-metal or reserved runner** that nothing else shares; **pin the benchmark to isolated cores** (`taskset`, `isolcpus`/`cpuset` so the kernel keeps other work off them); **disable frequency scaling and turbo** (fix the governor to `performance`, lock the clock); disable hyperthreading on the measured cores; warm up before measuring. This gets variance down to the low single digits.
2. **Defend statistically regardless.** Even on good hardware you interleave A/B runs (run baseline and candidate alternately rather than all-baseline-then-all-candidate, so any slow drift in the environment hits both equally), take many samples, and use the distribution-free comparison from Theme 3. Interleaving is the cheap, powerful trick — it converts *absolute* environmental drift into a *common-mode* error that cancels out of the relative comparison.

The principle behind both: you can never make the environment perfectly stable, so you make the *comparison* robust to the instability that remains.

### Q5.3 — Why is a relative comparison more trustworthy than an absolute number from CI?

> **Testing:** The core insight that rescues perf testing on imperfect hardware.

**A.** Because the absolute number carries the environment's bias and noise, but the *ratio* of two measurements taken in the same environment cancels most of it. If today's runner is a slower CPU generation, every absolute measurement is inflated — your "200ms" means nothing against yesterday's "180ms" on faster silicon. But if you measure the baseline *and* the candidate on that same slow runner, in the same session, interleaved, then the candidate-vs-baseline ratio is largely immune to how fast the underlying hardware is — both numerator and denominator scaled together. So the gate should never assert "this took less than 200ms" (an absolute claim hostage to the hardware); it should assert "this is not more than 5% slower than the baseline measured right now on this same machine." Relative-and-same-session is what makes regression detection work on hardware you don't fully control. The exception is genuinely deterministic metrics — bundle size, alloc counts — where the absolute number is reproducible and you can gate on it directly.

---

## Theme 6 — Scenario and Debugging

### Q6.1 — CI says you regressed a hot path by 4%. Walk me through deciding whether it's real or noise.

> **Testing:** Calm, statistics-driven triage instead of either panicking or hand-waving it away.

**A.** I don't trust the 4% as a point estimate; I interrogate it.

1. **Characterize the noise floor first.** What's this benchmark's known run-to-run variance on this harness? If it's ±6%, a 4% delta is inside the noise and I'm probably done — but I confirm rather than assume.
2. **Get the distributions, not the means.** Pull the raw runs for baseline and candidate and run the proper comparison — `benchstat` (Mann-Whitney) or equivalent — to get a p-value *and* an effect size with a confidence interval. If the CI of the delta spans zero, it's noise.
3. **Reproduce with more samples, interleaved.** Re-run baseline and candidate alternately, many iterations, on a quiet/dedicated runner. Noise won't survive repetition; a real regression will reproduce with a tightening confidence interval.
4. **If it reproduces and is significant and above the effect-size threshold,** it's real — now I profile the diff (`pprof`/`perf`) to attribute it to a specific change, often a new allocation or a lost inline. If allocs/op moved alongside the time, that's strong corroboration because allocation counts are nearly noise-free.

The throughline: a single 4% number is a hypothesis, not a verdict. The verdict comes from the distribution, an effect size with a confidence interval, and reproduction.

### Q6.2 — The perf gate is flaky, it's blocked three legitimate PRs this week, and the team wants to turn it off. What do you do?

> **Testing:** Whether you treat gate flakiness as a real bug to fix, not a political problem to argue about — and whether you'd rather fix it than lose it.

**A.** A flaky blocking gate is worse than no gate, because it trains people to ignore red and adds friction without trust — so the team is right to be angry, and I take it seriously rather than defending the gate on principle. But the answer isn't "delete it," it's "demote it while I fix the root cause."

1. **Immediately move it from blocking to advisory** (warn, don't fail) so it stops blocking legitimate work *today*. Removing the harm buys the goodwill to fix it.
2. **Diagnose the flakiness as the bug it is.** Almost always it's one of: the band is tighter than the harness's noise floor (Theme 2), it's running on shared cloud hardware (Theme 5), it's comparing means or using a t-test (Theme 3), or it has no effect-size floor / multiple-comparisons correction (Theme 3). I'd measure the actual noise floor by running the unchanged baseline against itself dozens of times.
3. **Fix the measurement**: dedicated runner, core pinning, interleaved A/B, distribution-free comparison with significance *and* effect size, widen the band above the real noise floor, require persistence across runs.
4. **Re-promote to blocking only after** I can show it's quiet on no-op changes (a stable false-positive rate I can quote).

The principle: never argue to keep a gate that's hurting people. Remove the hurt, fix the statistics, earn the blocking status back with evidence.

### Q6.3 — A real regression shipped to production despite a green perf gate. Root-cause the gate's failure.

> **Testing:** Whether you can reason about a gate's *blind spots*, not just its false positives.

**A.** The gate had a false *negative*, and there's a short list of structural reasons.

- **It tested the wrong thing.** The microbenchmark measured a function in isolation, but the regression was in the *interaction* — lock contention, cache behavior, or GC pressure that only appears under concurrent production load. Isolated microbenchmarks routinely miss systemic regressions.
- **It was too insensitive.** The band was set so wide (to avoid flakiness) that a real, moderate regression fit underneath it. There's a genuine tension here: widening the band to kill false positives raises the floor under which true regressions hide.
- **Slow drift, not a step.** The regression accumulated over many PRs, each under the per-PR band, and there was no change-point detection on the trend to catch the cumulative slope (Theme 4).
- **Unrepresentative workload.** The benchmark's input distribution didn't match production — synthetic uniform data instead of the skewed, large-key real traffic that triggered the slow path.
- **It wasn't gated at all on that metric.** The regressed dimension (say, p99.9 under fanout, or memory) simply wasn't in the budget.

The fix depends on which, but the meta-point is that **a microbenchmark gate is necessary, not sufficient** — the ultimate ground truth is production, so you back the pre-merge gate with canary analysis and RUM/production SLO monitoring to catch what synthetic tests structurally cannot.

### Q6.4 — Two benchmarks regressed and three improved in the same PR. How do you read that?

> **Testing:** Whether you treat a suite result as a portfolio and watch for the multiple-comparisons trap.

**A.** First, given multiple comparisons, I check whether any of those five are just noise — with a suite running many benchmarks, a handful crossing the line every run is expected by chance (Theme 3), so I apply the FDR correction and effect-size floor before believing any of them. For the ones that survive: a mix of regressions and improvements in one PR is the normal signature of a *trade-off* change — for example, an algorithm that's faster on large inputs and slower on small ones, or a cache that helps reads and costs writes. So I don't read it as "net positive, ship it"; I read it as "characterize the trade-off." Which scenarios regressed, are they the ones that matter for production traffic, and does the improvement land where load actually is? A 10% win on a cold path and a 5% loss on the hot path is a *regression* even though the suite shows three green and two red. The judgment is weighting by production relevance, not counting wins and losses.

---

## Theme 7 — Design and Judgment

### Q7.1 — When do you make a perf check blocking, when alerting, and when trend-only? Give me the decision rule.

> **Testing:** Whether you match enforcement strength to signal quality and cost-of-wrong.

**A.** The rule keys on **signal quality** (how confidently can this check distinguish regression from noise?) and **cost of a false positive**:

- **Blocking** — only for high-signal, low-noise checks where a false positive is rare and a false negative is expensive: deterministic metrics like **bundle size and allocation counts** (zero noise, gate hard), and large single-step wall-clock regressions on a *stable dedicated runner* with proper statistics. Blocking demands the lowest false-positive rate because it stops people.
- **Alerting** (page/notify, don't block) — for medium-signal checks where you want fast human attention but can't trust the gate to auto-block: a significant wall-clock regression on a moderately noisy harness.
- **Trend-only** (dashboard + change-point detection) — for the slow-drift detection and noisier metrics where any single data point is weak but the series is informative. Sensitive, asynchronous, never blocks.

The anti-pattern is putting a noisy or slow-drift-oriented check on the blocking path — that's the configuration that gets gates disabled. Match the strength of enforcement to how much you can trust the signal.

### Q7.2 — Would you build auto-bisect for performance regressions? What's the tradeoff?

> **Testing:** Whether you understand the cost structure of perf bisection vs functional bisection.

**A.** Yes, for the mainline trend detector, because perf bisection is *much* more expensive to do by hand than functional bisection. A functional `git bisect` runs a fast pass/fail test per commit; a perf bisect must run *many samples per commit* on a *stable dedicated runner* to get a statistically confident measurement at each step — so a human doing it manually burns hours of scarce dedicated-hardware time. Automating it (when change-point detection flags a shift in the mainline series, kick off an automated bisect over the suspect commit range on the perf runner) turns hours of an engineer's time into a queued machine job and lands the answer with the offending commit already identified. The tradeoff is cost: it consumes a lot of dedicated-runner time, so you reserve it for confirmed change-points (not every flagged blip) and you make each bisection step's sample count just large enough for confidence, no more. It pairs naturally with change-point detection — the detector says *that a* shift happened and *roughly where*; the auto-bisect pins down *exactly which commit*.

### Q7.3 — You can never make synthetic benchmarks perfectly represent production. Where does ground truth actually come from?

> **Testing:** Whether you know the pre-merge gate is a proxy and production is the real measurement.

**A.** Ground truth is production, observed two ways. **Canary / progressive rollout** is the controlled experiment: ship the new version to a small slice of real traffic, compare its real latency/error/resource distributions against the stable version serving the rest, and auto-rollback if it regresses — this is an A/B test on the actual workload, which no synthetic bench can fully replicate. **RUM (real user monitoring) and production SLO dashboards** are the continuous observation: real users' real percentiles on real devices and networks, which for frontend especially diverge wildly from a lab benchmark (a fast lab machine never sees the p75 user's three-year-old phone on 3G). So the layered model is: cheap, fast, synthetic **pre-merge budgets** catch the obvious and the attributable early; **canary analysis** catches what only appears under real traffic before full rollout; **production RUM/SLO** is the final arbiter and the feedback loop that tells you whether your synthetic budgets are even testing the right things. The synthetic gate's job isn't to be ground truth — it's to be the cheap early filter so production rarely has to be the one that catches the regression.

### Q7.4 — How do you justify the ROI of a perf-regression program when it has a real ongoing cost?

> **Testing:** Whether you can reason about budgets as an economic decision, not a purity crusade.

**A.** I'd frame it as buying down a large, deferred, hard-to-attribute cost with a small, continuous, attributable one. The cost of *not* having it is the death-by-a-thousand-cuts regression that eventually triggers an expensive optimization project, an SLO breach, or infrastructure over-provisioning to paper over avoidable slowness — all paid late, at the worst time, by people who didn't cause it. The cost of *having* it is the dedicated runner, the maintenance, and the occasional false-positive investigation. The ROI argument is concrete on the resource side: a 10% efficiency regression caught and prevented across a large fleet is a direct, quantifiable compute-cost saving, often dwarfing the program's cost. But I'd also scope it honestly — the ROI is real only for the metrics that matter (SLO-linked latency, fleet-wide efficiency, user-facing bundle size). Gating everything everywhere is the failure mode that makes the skeptic right; gating the few things tied to user experience and infra spend is where the program pays for itself many times over. ROI, like the budgets themselves, has to be targeted.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Mean or percentile for a latency budget?** A: Percentile (p99/p99.9) — the mean hides the tail, and the tail is what users feel and what cascades in a fanout.
- **Q: Why not a t-test on benchmark data?** A: Latency distributions are skewed and outlier-heavy, violating normality; use a distribution-free test like Mann-Whitney.
- **Q: What does `benchstat` do?** A: Compares two sets of Go benchmark runs with a non-parametric test and reports the delta with significance, so you don't eyeball two means.
- **Q: Significance vs effect size in one line?** A: Significance = probably real; effect size = big enough to care. Gate on both.
- **Q: What's the multiple-comparisons problem?** A: Run enough benchmarks at 95% confidence and ~5% fail by pure chance every run; correct with FDR/Benjamini-Hochberg plus an effect-size floor.
- **Q: Pairwise A/B's blind spot?** A: Slow drift — many sub-band regressions that each pass but trend upward; catch it with change-point detection on the series.
- **Q: Why is cloud CI bad for microbench gates?** A: Noisy neighbors, frequency scaling, no core pinning, variable instances → 10-30% variance that swamps the signal.
- **Q: Cheapest trick for stable A/B on noisy hardware?** A: Interleave baseline and candidate runs so environmental drift becomes common-mode and cancels from the ratio.
- **Q: Absolute or relative gate on a noisy harness?** A: Relative ("≤5% slower than baseline measured now, same machine") — absolute numbers are hostage to the hardware.
- **Q: One metric you *can* gate absolutely?** A: Bundle size or allocation count — deterministic, zero measurement noise.
- **Q: Where does real ground truth live?** A: Production — canary analysis and RUM/SLO monitoring; the synthetic gate is a cheap early proxy.
- **Q: Blocking vs trend-only for slow-drift detection?** A: Trend-only — it's too sensitive to block on; blocking is for high-signal single-step regressions.
- **Q: Why budget allocs/op?** A: It's a near-noise-free leading indicator for latency regressions that GC pressure would otherwise surface late and noisily.
- **Q: What makes a good baseline?** A: A rolling distribution of recent trusted runs, not a single previous run (which carries its own noise).

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Comparing two means and calling a difference a regression without spread or sample size.
- Reaching for a t-test on latency data, or not knowing why it's wrong.
- Conflating statistical significance with "big enough to matter."
- No awareness of the multiple-comparisons flood in a large suite.
- Asserting absolute timing budgets on shared cloud CI runners.
- "Just gate everything at 5%" with no notion of the harness's noise floor.
- Defending a flaky blocking gate on principle instead of fixing it.
- Treating a microbenchmark as ground truth, with no canary/RUM backstop.

**Green flags:**
- Naming the *distinction* (mean/distribution, significance/effect-size, gate/alert/trend) before reaching for a number.
- Asking for the distributions and sample sizes, not the means.
- Knowing `benchstat`/Mann-Whitney and *why* (distribution-free, robust to outliers).
- Requiring both significance and an effect-size floor, plus FDR correction at scale.
- Measuring the noise floor before setting a band.
- Interleaving A/B and using relative comparison to beat unstable hardware.
- Separating the blocking gate (insensitive, low FP) from the trend detector (sensitive, async).
- Treating production canary/RUM as the real arbiter and the synthetic gate as a cheap early filter.

---

## Summary

- The bank reduces to a few distinctions in costumes: **mean vs distribution**, **significance vs effect size**, **signal vs noise**, **gate vs alert vs trend**, **synthetic proxy vs production ground truth**. Name the distinction first; the number follows.
- **Why budgets:** performance dies by a thousand cuts; a budget is a *testable line* that moves detection to the cheapest, most attributable moment — the PR that caused it. Gate the trend on what users feel, not everything.
- **Defining budgets:** budget tail latency (p99+), efficiency, allocations (a near-noise-free leading indicator), and artifact size. Separate the SLO-derived absolute ceiling from a regression band set *above* your measured noise floor.
- **Statistics:** you can't compare two means — you compare two *distributions* with a distribution-free test (Mann-Whitney / `benchstat`), gate on significance **and** effect size, and correct for multiple comparisons (FDR + effect-size floor + persistence) or a large suite drowns in false positives.
- **Time series:** pairwise A/B catches single-step cliffs; **change-point detection** over the mainline series catches the slow drift A/B structurally misses. Baseline against a rolling distribution, not the previous run.
- **Environment:** cloud CI's noisy neighbors and frequency scaling swamp microbench signals; use dedicated pinned hardware, interleave A/B, and gate on **relative** comparison — absolute timing is hostage to the silicon. Deterministic metrics (size, allocs) are the exception you *can* gate absolutely.
- **Judgment:** match enforcement to signal quality (blocking = high-signal/low-FP; trend-only = sensitive/async); auto-bisect confirmed change-points; and remember the synthetic gate is a proxy — **canary and RUM/SLO are ground truth**. ROI is real but only for targeted, user- and cost-linked metrics.

---

## Further Reading

- Brendan Gregg, *Systems Performance* — the reference for measurement methodology, statistics, and avoiding measurement error.
- Go's `benchstat` documentation and source — the canonical example of distribution-free benchmark comparison (Mann-Whitney) in a real tool.
- "Automated system performance testing at MongoDB" / the Hunter change-point-detection work — practical change-point detection on a CI performance series.
- Benjamini & Hochberg (1995), "Controlling the False Discovery Rate" — the multiple-comparisons correction that makes large suites tractable.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [02 — Benchmarking and Microbenchmarks](../02-benchmarking-and-microbenchmarks/interview.md) — how to produce the stable, repeatable measurements these gates compare.
- [Performance README](../README.md) — where regression testing sits in the broader performance landscape.
- [Quality Engineering README](../../README.md) — the wider QE interview context.
