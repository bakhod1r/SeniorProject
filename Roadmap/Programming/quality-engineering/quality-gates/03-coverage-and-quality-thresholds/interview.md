# Coverage & Quality Thresholds — Interview Level

> **Roadmap:** [Quality Gates](../README.md) → Coverage & Quality Thresholds
> *A thresholds interview rarely asks "what is code coverage." It asks "leadership wants 90% — what do you advise," and then watches whether you can separate execution from verification, name Goodhart's law without the buzzword, and turn a flaky perf gate into a statistical one. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Introduction](#introduction)
3. [Prerequisites](#prerequisites)
4. [Fundamentals](#fundamentals)
5. [Goodhart & Gaming](#goodhart--gaming)
6. [Other Thresholds](#other-thresholds)
7. [Performance Gates](#performance-gates)
8. [Scale & Scenarios](#scale--scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **execution vs verification** (the line ran vs the line was checked)
- **absolute vs diff coverage** (the whole repo's number vs this change's number)
- **the metric vs the goal** (coverage % vs "few escaped defects")
- **signal vs noise** (a real regression vs benchmark variance)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a number.

---

## Introduction

Quality thresholds are the part of a quality gate that turns a measurement into a pass/fail decision: "coverage must be ≥ 80%," "no new Sonar blocker issues," "p95 latency must not regress > 5%." They are seductive because they're cheap to add and feel objective — and they're dangerous for exactly the same reason. A threshold is a *proxy*. The thing you actually care about (does this change make the system worse?) is hard to measure, so you measure something correlated and easy (did a line execute?) and pretend the correlation holds under pressure. It doesn't, because the moment a number controls promotions and merges, people optimize the number.

This is the level where the interview separates people who have *configured* a coverage gate from people who have *owned* one through a quarter of incidents, gaming, and false alarms. The fundamentals (line vs branch, absolute vs diff, the ratchet) are table stakes. The differentiator is judgment: when a threshold helps, when it actively hurts, how to roll one out without a revolt, and how to prove afterward that it caught real defects instead of just generating busywork.

---

## Prerequisites

You should be comfortable with:

- **What code coverage measures** — instrumentation, line vs branch vs function vs statement coverage. See [Code Coverage](../../code-coverage/).
- **CI gates in general** — what a required check is and how it blocks a merge. See [01 — Required CI Checks](../01-required-ci-checks/interview.md).
- **Basic statistics** — mean, variance, the idea that a single measurement is a sample, not a truth. Needed for the performance-gate questions.
- **The gate-design tension** — every gate trades developer speed against escaped-defect risk. See [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/interview.md).

---

## Fundamentals

### Q1.1 — What is a coverage gate, and what does a coverage number tell you?

> **Testing:** Whether you state the *limit* of the metric unprompted, or sell it as a quality score.

**A.** A coverage gate is a CI check that fails a build when test coverage falls below (or drops from) a configured threshold — measured by a tool like `go test -cover`, JaCoCo, `coverage.py`, or Istanbul, and usually reported through Codecov or SonarQube. What the number tells you is narrow and precise: **what fraction of code was *executed* by the test suite**. That's it. It tells you nothing about whether the executed code was *checked* — a test that runs a function and asserts nothing produces full coverage and zero verification. So coverage is a strong *negative* signal (0% coverage on a module means that module is definitely untested) and a weak *positive* one (90% coverage tells you the lines ran, not that they're correct). I'd frame it as "coverage finds what you forgot to test; it can't tell you whether what you tested actually works."

### Q1.2 — Line coverage vs branch coverage — what's the difference and which is stronger?

> **Testing:** Whether you know line coverage hides untested logic.

**A.** **Line coverage** counts whether each executable line ran at least once. **Branch (decision) coverage** counts whether each *edge* out of a conditional was taken — both the true and false sides of every `if`, every case, every short-circuit. Branch is strictly stronger because a single line can hide an untested branch:

```python
def withdraw(balance, amount):
    if amount > balance:          # one line, two branches
        raise InsufficientFunds()
    return balance - amount
```

A test that only withdraws a valid amount gives you **100% line coverage** of the function while **never executing the error branch** — branch coverage correctly reports 50%. That gap is where bugs live. So when I set a threshold, I prefer branch coverage if the tooling supports it cleanly; reporting only line coverage lets whole error paths go untested while the dashboard glows green.

### Q1.3 — Absolute coverage vs diff/patch coverage. Which makes a better gate and why?

> **Testing:** The single most important practical distinction in this topic.

**A.** **Absolute coverage** is the percentage over the *entire* codebase; **diff (patch) coverage** is the percentage over *only the lines changed in this PR*. Diff coverage is almost always the better gate, for three reasons:

1. **It's actionable and local.** A failing diff-coverage check points at *your* uncovered lines, which you can fix now. A failing absolute check might be failing because of code you never touched.
2. **It works on legacy code.** A service at 15% absolute coverage can still demand 80% on *new* changes — you stop the bleeding without a hopeless "boil the ocean" backfill.
3. **It resists the denominator trap.** Absolute coverage moves when the denominator moves: delete a big tested file and your percentage drops though you improved nothing; add generated code and it craters. Diff coverage ignores all that.

The honest framing: absolute coverage is a useful *trend to watch on a dashboard*; diff coverage is what I'd actually *gate* on. Codecov's `patch` status and Sonar's "Clean as You Code" both encode exactly this — judge the change, not the history.

### Q1.4 — What is a coverage "ratchet"?

> **Testing:** Whether you know the standard mechanism for improving legacy coverage without a flag day.

**A.** A ratchet is a gate that **never lets coverage go down**: the threshold is set to the current measured value, and any PR that lowers it fails. As covered code is added, the floor rises and gets locked in — like a socket-wrench ratchet that only turns one way. It's the pragmatic answer to "we're at 47% and can't realistically jump to 80%": instead of picking an arbitrary target, you forbid regression and let the number climb organically. The implementation detail that bites people: a *strict* "no decrease in absolute percentage" ratchet is noisy, because deleting tested code or refactoring legitimately moves the percentage and trips the gate for no real reason. The robust version ratchets on **diff coverage** (every new change must clear a bar) plus a tolerance band on absolute (e.g. "may not drop more than 0.1%"), so normal refactoring doesn't generate false failures.

### Q1.5 — A module shows 100% coverage. What can still be wrong with it?

> **Testing:** The execution-vs-verification line, made concrete.

**A.** Plenty. 100% coverage means every line *ran*, not that every line was *verified* or that every *input* was tried:

- **Assertion-free tests** — the code executed inside a test that asserts nothing (or only asserts "it didn't throw"). Full coverage, zero verification.
- **Untested inputs** — coverage is binary per line; the line that handles `divide(a, b)` shows covered after one call, but you never tried `b == 0`. Coverage doesn't measure the *input space*.
- **Weak oracles** — the test asserts the wrong thing, or asserts an implementation detail rather than behavior, so it passes even when the behavior is broken.
- **Untested interactions** — each unit is covered in isolation, but the integration between them is where the bug is, and no integration test exercises it.

The takeaway I'd give: 100% coverage is a ceiling on *one* failure mode (forgot to run the code), not a floor on correctness. To measure whether tests actually *catch* bugs, you need mutation testing, not coverage.

---

## Goodhart & Gaming

### Q2.1 — Leadership wants to mandate 80% coverage org-wide. Why might that backfire?

> **Testing:** Whether you can explain Goodhart's law in plain terms, not just name it.

**A.** Because the moment coverage controls something people care about — merge, promotion, a team's quarterly score — it stops being a measurement of test quality and becomes a *target to hit by the cheapest available means*. That's **Goodhart's law**: "when a measure becomes a target, it ceases to be a good measure." The specific failure mode here is **surrogation** — people start treating the proxy (coverage %) *as if it were* the goal (working software), and optimize the proxy directly.

Concretely, an 80% mandate produces:

- **Assert-free tests** that call code to bump the number without checking anything.
- **Tests of trivial code** (getters, generated boilerplate, `toString`) because they're cheap coverage, while the gnarly logic that actually needs testing is *harder* to cover so it gets skipped — coverage goes up while *risk-weighted* coverage goes down.
- **Coverage-shaped tests** written to execute lines rather than to specify behavior, which are brittle and get deleted or `@Ignore`d the first time they fail.

So the number rises, everyone reports green, and escaped defects don't move — or get worse, because the test suite is now full of low-value tests that slow CI and erode trust. The metric got gamed; the goal didn't get met. That's the textbook backfire.

### Q2.2 — Then is coverage useless as a gate? What would you do instead?

> **Testing:** Whether you over-correct into nihilism, or land on a principled design.

**A.** No — coverage is useful, just not as a *high absolute target*. The principled design keeps what coverage is good at and adds what it can't do:

1. **Gate on diff coverage, not absolute** — "new code should be reasonably covered" (say 70–80% on the patch) is a fair, local, ungameable-at-scale ask. It catches the "shipped a whole feature with no tests" case, which is the real thing you want to stop.
2. **Pair it with mandatory review** — a human asks "do these tests actually assert anything?" Coverage can't see assertion quality; a reviewer can. The gate plus the review covers both execution *and* verification.
3. **Use mutation testing for the real "do the tests work?" signal** — tools like PIT (Java), Stryker (JS/TS), `cargo-mutants`, or `go-mutesting` deliberately introduce bugs (flip `>` to `>=`, delete a statement) and check whether a test *fails*. A surviving mutant is a line that's covered but *not verified* — exactly the gap coverage can't see. Mutation score is far harder to game because gaming it means writing tests that actually catch injected bugs, which is the thing you wanted.
4. **Don't chase 100%** — the last 10–15% is usually error handling and defensive branches with terrible cost-to-value. Cap the ambition; spend the effort on mutation-testing the *critical* modules instead.

So: diff-coverage as a cheap floor, review for assertion quality, mutation testing as the trustworthy gate where it matters. Coverage isn't useless; it's just the *floor*, not the *ceiling*.

### Q2.3 — Why is mutation testing harder to game than coverage?

> **Testing:** Whether you understand *why* it measures verification, not execution.

**A.** Because the only way to "pass" a mutant is to have a test that **fails when the behavior is wrong** — which is the definition of a real test. Coverage rewards *running* a line, and you can run a line without checking it. Mutation testing rewards *detecting a deliberate defect*: it changes the code (the mutant) and reruns your suite; if every test still passes, the mutant "survived," meaning your tests don't actually constrain that behavior. An assert-free test gives you 100% coverage and a 0% mutation score, because it never fails no matter what you mutate. To raise the mutation score you have to write assertions that pin down behavior — so the metric and the goal point the same way. Goodhart still applies in principle (you could mutation-test only easy code), but the *act of gaming it produces real tests*, which is a much better failure mode than coverage's. The cost is that mutation testing is slow (it reruns the suite per mutant), so you scope it: critical modules, changed files, or run it nightly rather than per-PR.

### Q2.4 — A team consistently hits 95% coverage but keeps shipping bugs. What's wrong and what do you do?

> **Testing:** Diagnosis under a classic real-world contradiction.

**A.** The 95% is measuring execution, and the bugs are escaping through everything execution doesn't capture. I'd investigate, roughly in this order:

1. **Are the tests asserting anything?** Run mutation testing on a few core modules. If the mutation score is low (say 95% coverage but 40% mutation score), the tests run the code but don't verify it — that's the smoking gun. The fix is a campaign to add assertions, and adding mutation score as the *real* gate going forward.
2. **What kind of bugs?** Pull the last 20 incidents. If they're integration/contract bugs, *unit* coverage being 95% is irrelevant — the gap is integration and contract testing, not unit coverage. If they're "we never tested this input" bugs, the issue is weak input coverage (push toward property-based testing). Coverage was never going to catch either.
3. **Is the 95% concentrated in trivial code?** If getters and boilerplate are 100% and the payment logic is 60%, the *aggregate* looks great while the *risk* is uncovered. Look at coverage *weighted by where defects actually occur*.

The deeper point I'd make: 95% coverage with shipped bugs is *evidence the gate is measuring the wrong thing*, and the worst response is to raise it to 98%. I'd hold coverage where it is, add mutation testing on critical paths, and shift investment to the test *type* (integration/contract/property) that matches the escaping defects. Then I'd measure escaped-defect rate to confirm the new gate actually moves it.

### Q2.5 — Should coverage be a gate at all, or just a dashboard metric?

> **Testing:** Whether you can hold a nuanced position instead of a slogan.

**A.** Both, but for different things. As an **absolute number**, coverage should be a *dashboard trend*, not a gate — gating on absolute % invites all the Goodhart problems and generates false failures on refactors. As **diff coverage**, it's a reasonable *gate*, because "this change added no tests" is a real, actionable, mostly-ungameable thing to block. So my position is: gate on diff coverage with a humane threshold and an escape hatch; watch absolute coverage as a trend; and put the *real* quality gate (mutation testing, review) on the things that actually correlate with escaped defects. The wrong answers are the two extremes — "mandate a high absolute number" (gameable, backfires) and "never gate on coverage at all" (lets people ship untested features). The mature answer gates on the change, not the history, and keeps coverage in its lane.

---

## Other Thresholds

### Q3.1 — Beyond coverage, what other quality thresholds might a gate enforce?

> **Testing:** Breadth — do you know the landscape of static-analysis gates?

**A.** The common families:

- **Cyclomatic complexity** — fail or warn when a function exceeds a complexity ceiling (e.g. McCabe > 15), because complexity correlates with defect density and untestability.
- **Duplication** — fail when duplicated-block percentage rises (Sonar's duplication ratio, `jscpd`); copy-paste is a maintenance liability.
- **Maintainability / code smells** — Sonar's maintainability rating, lint-rule violations, dead code.
- **"No new warnings" ratchets** — the compiler/linter warning count may not increase; new code must be clean even if legacy isn't.
- **Bundle-size budgets** — front-end gates (`bundlesize`, Lighthouse CI, `size-limit`) that fail a PR if the shipped JS/CSS exceeds a byte budget, because bundle size directly hits load performance.
- **Security/dependency gates** — no new high-severity SAST findings, no dependencies with known critical CVEs.

The thread through all of them: each is a proxy with its own Goodhart risk, and each works far better **scoped to the diff** than enforced as an absolute over the whole repo.

### Q3.2 — What is SonarQube's "Clean as You Code" and why is it well-designed?

> **Testing:** Whether you recognize the diff-scoping principle as a *named, productized* idea.

**A.** "Clean as You Code" is SonarQube's model where the quality gate evaluates only **new code** — code added or changed since a reference (the previous release or the branch base) — rather than the whole codebase. The gate's default conditions ("no new bugs," "no new vulnerabilities," coverage and duplication thresholds *on new code only*) all apply to the diff. It's well-designed because it solves the legacy problem structurally: you never have to fix the mountain of historical debt to pass, you just have to not *add* to it. Every change leaves the touched area cleaner, the "new code" of today becomes the "old code" of tomorrow, and the codebase improves monotonically without a paralyzing remediation project. It's the same insight as diff coverage, applied across *all* the metrics — bugs, vulnerabilities, smells, coverage, duplication — and it's the single most important configuration choice in Sonar: gate on new code, watch overall as a trend.

### Q3.3 — How do you set a complexity or duplication threshold without it becoming noise?

> **Testing:** Whether you've actually rolled one of these out, or just know it exists.

**A.** Three moves. First, **scope to the diff** — "no *new* code with complexity > X" rather than "no function anywhere over X," so you're not failing builds over legacy you didn't touch. Second, **set the threshold from your own baseline, not a blog post** — measure the current distribution, set the line at roughly the 90th–95th percentile so it catches genuine outliers rather than flagging half the codebase, then ratchet it down over time. Third, **start advisory** — surface it as a warning/comment for a few weeks, see how often it fires and whether the firings are real, *then* make it blocking. The failure mode I'm avoiding is a threshold so aggressive it fires constantly, gets normalized as noise, and gets bypassed or disabled — a gate everyone ignores is worse than no gate, because it costs CI time and trains people to click through failures.

### Q3.4 — What's a "no new warnings" ratchet and when is it the right tool?

> **Testing:** Whether you know the cheapest way to improve a noisy legacy codebase.

**A.** It's a gate that records the current count of compiler/linter warnings and **fails any PR that increases it** — you can't fix the 4,000 existing warnings overnight, but you can guarantee the number only goes down. It's the right tool when you've *just turned on* a stricter linter or compiler flag (`-Wall`, a new ESLint config, `mypy --strict`) on a large existing codebase and a hard "zero warnings" gate would block every PR. The ratchet lets you adopt the stricter rules immediately for *new* code while paying down the backlog opportunistically. The gotcha is the same as the coverage ratchet: count-based ratchets are sensitive to noise (a refactor that moves code can shuffle counts), so the robust version checks "no new warnings *on changed files*" rather than a global count — diff-scoping again.

---

## Performance Gates

### Q4.1 — Why are naive performance gates flaky, and what's the fix?

> **Testing:** Whether you understand benchmark variance — the thing that breaks 90% of perf gates.

**A.** Because a benchmark is a *sample from a noisy distribution*, not a fixed truth, and a naive gate compares two single samples. The noise comes from everything around the code: CPU frequency scaling and thermal throttling, noisy-neighbor VMs in shared CI, garbage-collection timing, ASLR changing cache layout, background processes. Run the *same unchanged code* twice in CI and you'll often see 5–15% swings. So a gate that fails when "this run is 5% slower than the last run" will fail *constantly on noise* — and a gate that cries wolf gets ignored or disabled.

The fix is **statistics, not a single comparison**:

- **Multiple runs** per benchmark on each side, so you estimate the *distribution*, not one point.
- **A significance test** — feed both sets of measurements to a tool like `benchstat` (Go) which reports the delta *and a p-value / confidence interval*, and only flag changes that are statistically significant, not within the noise band.
- **Same machine, same conditions** — compare old vs new on the *same* dedicated/pinned runner back-to-back, not across heterogeneous CI fleet, so the only variable is the code.
- **Account for multiple comparisons** — if you run 200 benchmarks, ~5% will look "significant" at p<0.05 by pure chance; correct for that (Bonferroni/Holm, or just a stricter threshold) or you'll chase phantom regressions every build.

And critically, run perf gates **advisory until proven trustworthy** — report the result, don't block, until you've confirmed it doesn't false-alarm.

### Q4.2 — Your perf gate fails randomly on PRs that don't touch the hot path. Walk me through fixing it.

> **Testing:** Calm, statistical triage instead of "increase the threshold."

**A.** First, classify it: this is **noise**, not a real regression — random failures uncorrelated with the change are the signature of benchmark variance, not a true slowdown. Triage:

1. **Quantify the noise floor.** Run the benchmark suite N times against *unchanged* `main` and look at the variance. If the run-to-run swing is ±8% and the gate trips at 5%, the gate is *inside the noise* — it cannot possibly work as configured.
2. **Switch from single-shot to repeated runs + significance.** Run each benchmark multiple times per side and compare with `benchstat` (or equivalent), gating on the confidence interval, not the point delta. A change is "real" only if the distributions are statistically distinguishable.
3. **Stabilize the environment.** Move benchmarks off shared CI to a *dedicated, pinned* runner; disable CPU frequency scaling/turbo; pin to specific cores; warm up before measuring. Less environmental variance means a tighter, more sensitive gate.
4. **Correct for multiple comparisons.** If you run hundreds of benchmarks, expect a few false "significant" hits per run by chance — apply a correction or require a larger effect size.
5. **Make it advisory + trend-based.** Demote the gate to a *comment* that posts the delta, and watch the *trend over many builds* (changepoint detection on the time series) rather than blocking on any single PR. Promote back to blocking only once it stops false-alarming.

The thing I would *not* do is bump the threshold to 20% to stop the noise — that just makes the gate blind to real 10% regressions. The fix is reducing variance and using statistics, not loosening the bar.

### Q4.3 — Single-run threshold vs trend/changepoint detection — when do you use each?

> **Testing:** Whether you know that "did this PR regress" and "is the system getting slower" are different questions.

**A.** They answer different questions. A **per-PR threshold** (with repeated runs + significance) answers "did *this change* cause a measurable regression?" — it's a gate, blocking or advisory. **Trend / changepoint detection** answers "is the system *drifting* slower over time?" — it runs benchmarks continuously (often nightly on a stable machine), stores the time series, and uses changepoint detection (e.g. the approach behind Mongo's `Hunter`/`signal-processing` tooling) to find the *commit where the level shifted*, even if each individual PR's change was below the per-PR noise threshold. You want both: per-PR for the obvious "this PR doubled the latency" case, and trend detection to catch the **slow boil** — fifty PRs each adding 0.5% that no per-PR gate could ever catch, but which compound into a 25% regression. Per-PR catches the cliff; trend detection catches the slope.

### Q4.4 — Where should you measure a performance gate — micro-benchmarks, or end-to-end?

> **Testing:** Whether you understand what each level can and can't see.

**A.** Both, for different failure modes, and you have to know the limits of each. **Micro-benchmarks** (function-level, `go test -bench`, JMH, `criterion`) are precise and low-variance and pinpoint *which function* regressed — but they can mislead, because a function 2× faster in isolation can be irrelevant or even worse in context (cache effects, allocation pressure the micro-benchmark doesn't reproduce). **End-to-end / load tests** (k6, Gatling, a staging perf run) measure what users actually feel — p95/p99 latency, throughput under realistic concurrency — but they're noisier and slower, so they're usually a *nightly/pre-release* gate, not per-PR. My rule: micro-benchmarks per-PR for tight feedback on known-hot code, end-to-end on a schedule for the system-level truth, and never trust a micro-benchmark win without confirming it shows up end-to-end.

---

## Scale & Scenarios

### Q5.1 — How do you roll out a new threshold across many teams without a revolt?

> **Testing:** Change management — the staff-level skill that turns a good gate into an *adopted* gate.

**A.** Never flip it straight to blocking. The standard rollout is three phases:

1. **Dry-run / shadow** — compute the metric and *log* what *would* have failed, blocking nothing. This tells you the *real* failure rate and surfaces false positives before anyone is inconvenienced. If 60% of PRs would have failed, your threshold is wrong and you just learned it cheaply.
2. **Advisory** — surface it as a non-blocking PR comment or a warning status. People see it, start reacting to it, and you collect feedback on the firings — are they real? Then you tune the threshold *before* it has teeth.
3. **Enforce** — make it blocking, with a clearly documented **escape hatch** (an override label or a config exception) for legitimate exceptions, and a named owner who watches the override rate.

Alongside the phases: **diff-scope it** so legacy teams aren't punished for history, **set per-tier targets** (a critical billing service may need a higher bar than an internal tool), and *communicate the why* — a gate people understand the purpose of gets adopted; a mandate that appears from on high gets gamed or bypassed. The override *rate* is your health metric: lots of overrides means the gate is wrong, not that people are bad.

### Q5.2 — Design a coverage gate for a legacy service sitting at 15% coverage.

> **Testing:** The flagship scenario — can you avoid the "boil the ocean" trap?

**A.** I would **not** set any absolute target near where we want to be — demanding 80% on a 15% codebase is a multi-quarter project that blocks all feature work and gets abandoned. Instead:

1. **Gate on diff coverage only.** Require new/changed lines to hit a humane bar — start at 60–70%, not 90% — so every change *stops the bleeding* and the touched code gets tested. This is Sonar's "Clean as You Code" exactly.
2. **Ratchet the absolute as a floor, not a target.** Lock "absolute coverage may not *decrease*" (with a small tolerance for refactors). Now the number can only climb, organically, as covered code is added.
3. **Roll out dry-run → advisory → enforce**, so the team sees what the gate does before it blocks them.
4. **Direct deliberate testing at the *risky* parts**, not uniformly. Use churn × complexity (and the incident history) to find the hotspots — the files that change often *and* are complex *and* have caused outages — and write characterization tests there first. That's where coverage buys the most risk reduction per hour.
5. **Add mutation testing to the *new* tests** on critical paths, so the diff-coverage requirement produces tests that actually verify, not assert-free filler.

The result: feature velocity is barely affected, new code is well-tested from day one, the legacy number rises on its own, and the riskiest legacy code gets characterized first. The whole point is *diff-scoping turns an impossible backfill into a sustainable habit.*

### Q5.3 — How do you know whether a quality gate is actually working?

> **Testing:** Whether you close the loop — measuring the *goal*, not the proxy.

**A.** You measure the **outcome the gate exists to protect**, not the gate's own pass rate. For a coverage/quality gate that's primarily the **escaped-defect rate** — bugs found in production (or in later stages) per change, ideally for code paths the gate covered. The question is: *since we turned this gate on, did defects that the gate should catch actually go down?* Supporting signals: **change failure rate** and **MTTR** (the DORA metrics — see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/)), the gate's **false-positive rate** (how often it blocks a change that turns out fine — high FP rate destroys trust), and its **override rate** (frequent overrides mean it's mis-calibrated). The anti-pattern is celebrating "coverage went from 60% to 85%!" as if the *proxy* moving were the win — that's surrogation again. A gate that raised coverage 25 points but didn't move escaped defects is a gate that generated work without value, and I'd be willing to *loosen or kill it*. The proof of a quality gate is fewer escaped defects, not a higher number on a dashboard.

### Q5.4 — When and how do you kill a noisy gate?

> **Testing:** Whether you treat gates as falsifiable, or as sacred once added.

**A.** A gate earns its place by catching real problems at an acceptable false-alarm cost; when it stops doing that, it's a tax and I remove or fix it. The signals that a gate should die: a **high false-positive rate** (it blocks changes that were fine), a **high override rate** (everyone's bypassing it, so it's blocking nothing but costing CI time and training people to ignore failures), and **no measured effect on escaped defects** (it's not protecting the thing it claims to). Before killing it I'd try to fix it — demote to advisory, re-tune the threshold, diff-scope it, reduce variance for a perf gate — because the *intent* may be sound even if the calibration is off. But if a re-tuned gate still doesn't pay for itself, I delete it without ceremony. The cultural point: a gate everyone clicks through is *worse* than no gate, because it adds latency and normalizes ignoring red. Gates should be falsifiable; "we've always had this check" is not a reason to keep one.

### Q5.5 — Leadership says "every team must hit 90% coverage by Q4." What do you advise?

> **Testing:** The capstone — can you push back constructively and offer something better?

**A.** I'd push back on the *specific instrument* while honoring the *underlying intent* (they want fewer production bugs and more confidence to ship). My advice, in order:

1. **Name the risk plainly:** a hard 90% absolute mandate will be *met and will not work* — it incentivizes assert-free tests, testing trivial code, and gaming, so coverage hits 90% while escaped defects don't improve. We'd spend a quarter of engineering time to make a number go up. That's Goodhart, and I've watched it happen.
2. **Reframe the goal as the outcome:** what we actually want is fewer escaped defects and safer changes. Let's gate and measure *that*.
3. **Propose the alternative that achieves the intent:**
   - Gate on **diff coverage** (70–80% on new code) — catches the real "shipped untested code" case, works on every codebase regardless of legacy.
   - Add **mutation testing on critical services** as the *real* "are these tests any good" gate.
   - Track **escaped-defect rate and change-failure rate** as the success metric, with coverage as a *watched trend*, not the target.
   - Roll out **dry-run → advisory → enforce** with per-tier targets so high-risk services get a higher bar.
4. **Offer to prove it:** pilot on two teams for a quarter and compare escaped defects against the rest — let data, not my opinion, settle it.

The meta-skill being tested is whether I'll cave to a plausible-sounding number, or translate leadership's real goal into a gate that achieves it. The right move is "yes to fewer defects, here's a measurably better way than a coverage mandate" — not "yes sir, 90%."

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: Diff coverage vs absolute coverage in one line?** A: Diff = % of the *changed* lines covered (gate this); absolute = % of the *whole repo* (watch this as a trend).
- **Q: Does coverage measure correctness?** A: No — it measures *execution*; a covered line can be unverified, untested for edge inputs, or wrongly asserted.
- **Q: What's a coverage ratchet?** A: A gate that only lets coverage go up — sets the floor at the current value so it can never regress.
- **Q: Line vs branch coverage?** A: Line = the statement ran; branch = both sides of each conditional ran (strictly stronger; reveals untested error paths).
- **Q: One sentence on Goodhart's law here?** A: When coverage % becomes a target, people optimize the percentage (assert-free tests) instead of test quality, so it stops measuring quality.
- **Q: What does mutation testing measure that coverage can't?** A: Whether tests actually *fail* when behavior breaks — verification, not just execution.
- **Q: A surviving mutant means?** A: A line that's covered but *not verified* — the tests run it but don't constrain its behavior.
- **Q: Why are perf gates flaky?** A: A benchmark is a noisy sample; comparing two single runs trips on 5–15% environmental variance, not real regressions.
- **Q: What does `benchstat` give you?** A: The delta between two sets of benchmark runs *plus a significance test*, so you flag real changes, not noise.
- **Q: Why dedicate/pin the perf runner?** A: To remove environmental variance (CPU scaling, noisy neighbors) so the only variable is the code change.
- **Q: What is "Clean as You Code"?** A: SonarQube's model where the quality gate evaluates only *new* code, so legacy debt never blocks you and the codebase improves monotonically.
- **Q: Rollout order for a new gate?** A: Dry-run (log only) → advisory (warn) → enforce (block, with an escape hatch).
- **Q: A bundle-size budget gate fails — what does it protect?** A: Front-end load performance — it blocks PRs that push shipped JS/CSS over a byte budget.
- **Q: Should you chase 100% coverage?** A: No — the last 10–15% is low-value defensive branches with terrible cost-to-benefit; spend that effort on mutation-testing critical paths.
- **Q: How do you prove a gate works?** A: Measure escaped-defect / change-failure rate before and after — not whether the coverage number went up.
- **Q: Worst response to "95% coverage but shipping bugs"?** A: Raising the threshold to 98% — it doubles down on the metric that's already failing to predict defects.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating coverage % as a measure of *quality* or *correctness* rather than execution.
- Recommending a high *absolute* coverage mandate (80–100%) with no mention of gaming or diff-scoping.
- Not being able to explain *why* a coverage mandate backfires (no Goodhart, no assert-free-tests insight).
- "Just increase the threshold" as the fix for a flaky perf gate — making it blind instead of stable.
- Comparing two single benchmark runs and calling a 6% delta a regression.
- Confusing "the gate passes a lot" with "the gate is working" — never measuring escaped defects.
- Treating any gate as permanent and un-killable.

**Green flags:**
- Naming the *distinction* (execution vs verification, diff vs absolute, metric vs goal) before reaching for a number.
- Reaching for **diff coverage / Clean-as-You-Code** as the default gate, unprompted.
- Bringing up **mutation testing** as the real "do the tests verify?" signal.
- Framing performance gates statistically — repeated runs, `benchstat`/significance, same machine, multiple-comparisons, advisory-until-trustworthy.
- Distinguishing per-PR gates from **trend/changepoint detection** for the slow-boil case.
- Closing the loop: "I'd measure whether escaped defects actually dropped," and being willing to *kill* a gate that doesn't pay for itself.
- Rolling out gates **dry-run → advisory → enforce** with per-tier targets and an escape hatch.

---

## Cheat Sheet

| Concept | One-line answer |
|---|---|
| Coverage measures | Execution (lines/branches *ran*), **not** verification or correctness. |
| Diff vs absolute | Gate on **diff** (actionable, legacy-safe); watch **absolute** as a trend. |
| Ratchet | Floor that only goes up; prefer ratcheting *diff* coverage to avoid refactor noise. |
| Line vs branch | Branch is stronger — reveals untested error paths a covered line hides. |
| Goodhart here | Coverage-as-target → assert-free tests, trivial-code testing; number rises, defects don't. |
| Real verification gate | **Mutation testing** (PIT, Stryker, `cargo-mutants`) — surviving mutant = covered-but-unverified. |
| Other thresholds | Complexity, duplication, "no new warnings" ratchet, bundle-size budget, Sonar quality gate. |
| Clean as You Code | Sonar gates on **new code only** → legacy never blocks, codebase improves monotonically. |
| Perf gate flakiness | Benchmark = noisy sample; fix with repeated runs + `benchstat` significance + pinned machine + multiple-comparison correction. |
| Per-PR vs trend | Per-PR catches the *cliff*; changepoint detection catches the *slow boil* across many small PRs. |
| Rollout | Dry-run (log) → advisory (warn) → enforce (block) with escape hatch + per-tier targets. |
| Prove it works | Measure **escaped-defect / change-failure rate**, not whether the coverage number rose. |

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **execution vs verification**, **diff vs absolute coverage**, **the metric vs the goal**, and **signal vs noise**. Name the distinction first; the number follows.
- **Fundamentals:** coverage measures whether code *ran*, not whether it was *checked*. Branch > line. **Diff coverage is the gate; absolute coverage is a dashboard trend.** A ratchet locks in gains; ratchet on diff to avoid refactor noise. 100% coverage still permits assert-free tests, untested inputs, and weak oracles.
- **Goodhart:** a high absolute coverage *mandate* backfires via surrogation — people game the proxy (assert-free tests, trivial-code testing) so the number rises while escaped defects don't. The principled answer: diff-coverage floor + mandatory review + **mutation testing** for the real verification signal; don't chase 100%.
- **Other thresholds:** complexity, duplication, "no new warnings" ratchets, bundle-size budgets, Sonar quality gates — all better diff-scoped (Clean as You Code) than enforced as absolutes.
- **Performance gates:** benchmarks are noisy samples, so naive single-run gates are flaky. Fix with repeated runs + significance (`benchstat`), same/pinned machine, multiple-comparison correction, and advisory-until-trustworthy. Per-PR gates catch the cliff; trend/changepoint detection catches the slow boil.
- **Scale & judgment:** roll out dry-run → advisory → enforce with per-tier targets and an escape hatch; diff-scope legacy; **measure whether the gate reduced escaped defects** rather than whether the number rose; and kill a gate that false-alarms or doesn't pay for itself — a gate everyone overrides is worse than none.

---

## Further Reading

- [Codecov documentation](https://docs.codecov.com/) — `project` vs `patch` (diff) status, coverage configuration, and how to gate on the change rather than the history.
- [SonarQube — Clean as You Code](https://docs.sonarsource.com/sonarqube-server/latest/user-guide/clean-as-you-code/) — the canonical "gate on new code" model for coverage, bugs, smells, and duplication.
- [`benchstat` (golang.org/x/perf)](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) — comparing benchmark runs with significance testing instead of single-shot deltas.
- Charles Goodhart's law and Marilyn Strathern's formulation ("when a measure becomes a target, it ceases to be a good measure") — the theory behind why coverage mandates backfire; pair with the literature on *surrogation*.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — junior grounds the mechanics (how coverage and thresholds are configured); senior goes deeper on mutation testing, statistical perf gating, and org-scale rollout.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/interview.md) — how a threshold becomes a *required* check that blocks the merge.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/interview.md) — the broader tension every threshold trades: developer velocity against escaped-defect risk.
- [Code Coverage](../../code-coverage/) — the underlying measurement: instrumentation, line/branch/path coverage, and its limits.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity, duplication, maintainability, and the metrics behind the non-coverage gates.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — change-failure rate and escaped-defect measurement that tell you whether a gate actually works.
