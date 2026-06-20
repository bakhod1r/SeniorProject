# Code Health Dashboards — Senior Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Code Health Dashboards
> *The middle page showed you how to wire the tools up and read the panels. This page is about the hard part nobody puts on the marketing slide: combining complexity, duplication, coverage, and smells into something that drives action is a measurement-theory problem with no clean answer, and the moment you display a single number it becomes a target that engineers optimize instead of the code. A senior designs the dashboard that survives both.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Aggregation Problem — Why One Score Is a Lie You Choose to Tell](#the-aggregation-problem--why-one-score-is-a-lie-you-choose-to-tell)
4. [Distributions Beat Means — One Catastrophe vs Uniform Mediocrity](#distributions-beat-means--one-catastrophe-vs-uniform-mediocrity)
5. [Designing for Action, Not Vanity](#designing-for-action-not-vanity)
6. [Risk-Weighting — Criticality × Churn, Not Raw Counts](#risk-weighting--criticality--churn-not-raw-counts)
7. [Goodhart and Surrogation — The Dashboard Becomes the Target](#goodhart-and-surrogation--the-dashboard-becomes-the-target)
8. [Trends, Deltas, and New-Code Conditions](#trends-deltas-and-new-code-conditions)
9. [Build vs Buy — SonarQube / CodeScene / Code Climate vs a Metrics Warehouse](#build-vs-buy--sonarqube--codescene--code-climate-vs-a-metrics-warehouse)
10. [Making It Trustworthy — Data Quality and Flaky-Signal Eradication](#making-it-trustworthy--data-quality-and-flaky-signal-eradication)
11. [The Honest Limit — A Dashboard Is a Hypothesis Generator](#the-honest-limit--a-dashboard-is-a-hypothesis-generator)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Designing a dashboard that drives action and resists Goodhart — and the measurement theory of why aggregating heterogeneous metrics into one number is fundamentally arbitrary.**

By the middle level you can stand up SonarQube or CodeScene, read the ratings, and explain what cyclomatic complexity, duplication percentage, and coverage each measure in isolation. That makes you useful. The senior jump is twofold, and both halves are about *design under adversarial conditions*.

The first half is a measurement-theory problem: a dashboard's job is to compress dozens of heterogeneous metrics — complexity, duplication, coverage, smell density, coupling — into something a human can act on. But these metrics are measured on different scales, with different units, and there is no principled, non-arbitrary way to combine them into one grade. Any weighting you pick is a value judgment dressed as arithmetic. Understanding *why* that is true, and what to do instead, is the difference between a dashboard that ranks teams by a fake number and one that points engineers at the three files most likely to hurt them next.

The second half is a behavioral problem, and it is older than software. The instant you display a number and someone is rewarded for moving it, the number stops measuring what it used to. Engineers do not optimize the code; they optimize the dashboard — and the two are not the same. This is **Goodhart's law**, the same force you met in [coverage as signal not target](../../code-coverage/06-coverage-as-signal-not-target/) and [DORA's metrics anti-patterns](../../engineering-metrics-and-dora/06-metrics-anti-patterns-and-goodhart/). A senior designs the dashboard knowing it will be gamed and arranges for the gaming to be either impossible or harmless. This page is both layers.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — you can configure SonarQube/CodeScene, read a quality gate, and explain each underlying metric on its own.
- **Required:** You understand the individual metrics deeply: [02 — Maintainability Index](../02-maintainability-index/senior.md) (why composite indices are seductive and weak) and [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/senior.md) (why history predicts defects better than a static snapshot).
- **Helpful:** You've watched a metric get gamed in the wild — a coverage target met with assertion-free tests, a complexity ceiling dodged by extracting six trivial methods.
- **Helpful:** Working familiarity with measurement scales (nominal/ordinal/interval/ratio) and why you can't average ordinal data — the formal name for the intuition this page leans on.

---

## The Aggregation Problem — Why One Score Is a Lie You Choose to Tell

A dashboard wants to answer "how healthy is this codebase?" with one number. The temptation is overwhelming and the math underneath is rotten. Walk through what aggregation actually requires.

You have, per file or per module, a vector of metrics: cyclomatic complexity (a count, ratio scale), duplication percentage (a proportion, 0–100), line coverage (a proportion, 0–100), smell density (count per KLOC), coupling (a count). To collapse that vector into a scalar you must do two things, and both are arbitrary:

1. **Normalize to a common scale.** Complexity of 40 and coverage of 60% live in incommensurable units. To combine them you map each onto a shared 0–100 or A–F scale via a threshold curve — and *every breakpoint in that curve is a choice*. Is complexity 15 an "A" or a "C"? SonarQube, CodeScene, and Code Climate each answer differently, which is the first tell that the answer is conventional, not discovered.

2. **Weight and combine.** Once on a common scale you need weights: is duplication twice as bad as low coverage? Half as bad? The composite score `0.3·complexity + 0.3·coverage + 0.2·duplication + 0.2·smells` looks objective. It is not. Those coefficients encode a theory of what matters, and *no empirical procedure fixes them* — they are picked to make the output "feel right," which is circular.

This is the same disease as the [Maintainability Index](../02-maintainability-index/senior.md): the MI's famous `171 − 5.2·ln(HV) − 0.23·CC − 16.2·ln(LOC)` has constants fit to a specific 1990s corpus, and nobody can defend the magnitudes today. A code-health grade is the MI's sin repeated across more inputs.

The deeper problem is **information destruction**. A single grade is a lossy hash of a high-dimensional state, and the loss is the *actionable part*. "Your codebase is a B" tells an engineer nothing they can do tomorrow. Worse, the same "B" is reachable from radically different states — one with a single horrifying hotspot and clean everything else, and one that is uniformly mediocre — and those two states demand opposite responses. The grade has thrown away exactly the distinction that determines what you do.

There is also a formal objection. Most of these inputs are, at best, *ordinal* — a complexity of 30 is "worse" than 15, but it is not meaningfully "twice as bad," and the distance between grades A and B is not the same quantity as between B and C. Arithmetic on ordinal data (averaging, weighting) is not mathematically licensed; the result is a number you can compute but cannot interpret. You are performing interval-scale operations on ordinal-scale data and reporting the output as if it meant something.

> **Key insight:** A single code-health score is not a measurement you discover; it is a weighting you *choose*, performed on scales that don't support the arithmetic, producing a number whose main effect is to destroy the one thing a human could have acted on. The right response is not a better formula — it is to stop aggregating into a scalar and instead surface the *distribution* and the *worst offenders*.

---

## Distributions Beat Means — One Catastrophe vs Uniform Mediocrity

The aggregation problem has a concrete, operational consequence: **the mean is the wrong summary statistic for code health**, because code risk is not uniformly distributed and the damage is concentrated in the tail.

Consider two services, each with 200 files, each reporting an average complexity of 12.

- **Service A:** 199 files at complexity 11, and one file at complexity 210 — a 4,000-line god-class that every payment flows through, touched in 40% of all commits.
- **Service B:** all 200 files clustered between 10 and 14 — uniformly unremarkable, nothing scary, nothing pristine.

Both have the same mean. They could not be more different in risk. Service A has a single catastrophic hotspot that will generate most of its defects and absorb most of its change cost; Service B has no acute danger at all. A dashboard that reports "average complexity: 12" for both is *actively lying* — it has averaged away the only fact that matters. This is the central reason means fail: they assume the thing being averaged is interchangeable across the population, and code is the opposite — defect density follows a steep Pareto distribution, where a small fraction of files carries the overwhelming majority of bugs and rework. (This is the empirical core of [churn × complexity hotspots](../04-code-churn-and-hotspots/senior.md): risk concentrates.)

So design the dashboard around the *shape* of the distribution, not its center:

- **Show the tail explicitly.** The headline is not "mean complexity"; it is "files above the risk threshold" and, above all, "the top-N hotspots." A p95/p99 of complexity, or a count of files in the danger zone, conveys concentration that a mean erases.
- **Rank by risk, present the worst.** The single most useful artifact a code-health dashboard produces is an ordered list of the handful of files where high complexity *coincides* with high churn — the places change is both frequent and dangerous. That list is short, specific, and directly actionable.
- **Use risk-weighting, not counts, when you must aggregate** (next section) — so the payment hotspot dominates the summary the way it dominates reality, instead of being diluted by 199 boring files.

The general rule: **for a quantity whose harm is concentrated and super-linear, summarize by the tail, not the average.** A team can ship for years on a "mediocre average" with no incident; a single uncovered, high-complexity, high-churn payment file can take production down next quarter. The dashboard must make the second visible and refuse to let the first hide it.

> **Key insight:** Code risk is Pareto-distributed, so the mean is the least informative summary you could pick — it deletes the tail, and the tail is the risk. Report the distribution's shape and the named worst offenders; one catastrophic hotspot and uniform mediocrity are different problems that share a mean, and only the tail tells them apart.

---

## Designing for Action, Not Vanity

A vanity dashboard answers "what grade are we?" An action dashboard answers "what should I do next, and where?" The two have almost no panels in common. Building for action means deliberately removing the things executives love and adding the things engineers can use.

**Surface the top-N hotspots with a specific next action — not a letter grade.** The unit of an action dashboard is a *row*, and each row names a file, the reason it's flagged, and the concrete move:

```
FILE                          WHY IT'S HERE                         NEXT ACTION
payments/charge.go            complexity 210 · churn top-1% ·       extract refund/retry paths;
                              coverage 22% · 3 incidents/90d        add tests around the money math
auth/session.go               complexity 95 · 8 contributors ·      split session lifecycle from
                              change-coupled to 6 unrelated files   token validation; break the coupling
billing/invoice.go            duplication 31% (4 clones of the      consolidate the clones behind one
                              tax calc) · 2 recent tax bugs         tax module; delete the copies
```

That table is worth more than any A–F badge because every row ends in a verb. "Your maintainability is C-" produces a shrug; "`charge.go` is your single riskiest file, here's why, here's the move" produces a ticket.

**Trends and deltas over absolutes.** An absolute number ("duplication is 14%") is unanchored — nobody knows if 14% is fine for this codebase. A *delta* ("duplication rose 3 points this quarter, all of it in `billing/`") is immediately actionable and far harder to argue with. The most motivating panel is direction: is the danger zone shrinking or growing, and where is the new debt landing? You are managing a derivative, not a level.

**New-code conditions ("clean as you code").** The decisive design move — pioneered by SonarQube's quality gate and the right default for any dashboard — is to *stop gating on the whole codebase and start gating only on what changed*. Demanding 80% coverage across a 15-year-old monolith is hopeless and ignored; demanding that *new and modified* code meet the bar is achievable, fair, and stops the bleeding. The codebase then improves monotonically as files are touched, without a doomed boil-the-ocean cleanup. New-code conditions also neatly dodge a chunk of the aggregation problem: you are not grading the legacy lake, only the stream flowing into it.

**Per-team relevance without cross-team ranking.** Every team should see *their* hotspots, *their* trends, *their* new-code health — scoped to the code they own. What you must never build is the leaderboard that ranks teams against each other by a quality score. The moment Team A's "B+" sits next to Team B's "C-", you have (a) compared incomparable codebases (a greenfield CRUD service vs a 12-year-old billing engine — different baselines, same axis), and (b) created a target that will be optimized by gaming, not by engineering (next section). Relevance is per-team; *comparison* across teams via a single score is where dashboards turn toxic.

> **Key insight:** An action dashboard's atomic unit is a row that ends in a verb — a named file, the reason, the next move — not a grade. Show deltas not absolutes, gate new code not the whole lake, and give each team their own view but never a cross-team scoreboard. If a panel doesn't change what someone does tomorrow, it's vanity, and vanity panels are where Goodhart enters.

---

## Risk-Weighting — Criticality × Churn, Not Raw Counts

If a mean is the wrong way to summarize and a raw count is the wrong way to rank, what's right? **Weight every metric by the consequence of the code being wrong.** Two files with identical complexity and identical coverage are not equally risky, and a dashboard that treats them as equal is misallocating the only scarce resource that matters: engineering attention.

The two weights that carry almost all the signal:

- **Criticality (blast radius).** An uncovered, complex *payment* file is a latent incident; an uncovered, complex *logging-formatter* file is a shrug. Same metrics, wildly different stakes. Criticality is the cost of this code being wrong — money moved, data corrupted, auth bypassed, customers blocked. You can approximate it structurally (fan-in: how much depends on this), by domain tagging (modules under `payments/`, `auth/`, `pii/` carry a multiplier), or by incident history (files that have caused production pain).
- **Churn (recency and frequency of change).** A gnarly file nobody has touched in three years is dormant — its complexity is a sunk fact, not an active hazard. A gnarly file changed twice a week is where bugs are being *minted right now*, because every edit to complex code is a chance to break it. This is the empirical engine of [hotspots](../04-code-churn-and-hotspots/senior.md): **defect risk ≈ complexity × churn**, because complexity is the chance any given change goes wrong and churn is how many changes there are.

Combine them so the ranking reflects expected harm, not raw size:

```
risk(file) ≈ defect_proxy(complexity, duplication, low_coverage)
             × churn(commits over window)
             × criticality(blast radius / domain / incident history)
```

The payoff is a ranking that matches reality. The 4,000-line, never-touched, internal report generator drops *down* the list (dormant, low blast radius) even though it has the worst raw complexity in the repo. The 300-line payment authorizer changed weekly with 60% coverage rises to the *top* even though plenty of files look worse on paper. That reordering is the entire value: it points the team at the files where an hour of work removes the most expected risk, rather than at whatever happens to have the biggest raw number.

This is also the principled answer to the aggregation problem's "arbitrary weights" charge. You still can't defend `0.3·complexity + 0.3·coverage`, but you *can* defend "weight by how much it'll cost when this breaks (criticality) and how often we're rolling those dice (churn)" — those weights map to consequences in the world, not to aesthetics. Risk-weighting doesn't make aggregation rigorous, but it grounds the weights in something an engineer and a director will both recognize as real.

> **Key insight:** An uncovered payment file and an uncovered logging file are not the same finding, and a dashboard that ranks by raw counts pretends they are. Weight every metric by criticality (what it costs when wrong) and churn (how often you're changing it) — that turns a list of "files with bad numbers" into a list of "files where attention removes the most risk," which is the only list worth showing.

---

## Goodhart and Surrogation — The Dashboard Becomes the Target

Here is the law that governs every dashboard, stated precisely: **"When a measure becomes a target, it ceases to be a good measure" (Goodhart's law).** The mechanism is that a metric is a *proxy* for something you actually care about — coverage proxies for "the code is tested," complexity proxies for "the code is understandable" — and a proxy holds only as long as nobody is pushing on it. Reward people for moving the proxy and they will move the proxy *without moving the thing it stood for*, because that is almost always the cheaper path.

The companion concept, and the one most worth naming, is **surrogation**: the cognitive slip where people *mistake the measure for the goal itself*. Once "code quality" is operationalized as "the dashboard score," engineers stop thinking about quality and start thinking about the score — they have surrogated the rich, fuzzy goal with the crisp, gameable number. Surrogation is why dashboards rot: the number was supposed to be a window onto quality and quietly becomes a substitute for it.

The gaming patterns are not hypothetical; they are the lawful, predictable response to each displayed metric:

- **Coverage target → assertion-free tests.** Tie a gate to coverage % and engineers write tests that *execute* the code (so the lines count as covered) while asserting nothing — the exact failure dissected in [coverage as signal not target](../../code-coverage/06-coverage-as-signal-not-target/). The number goes green; the code is no more tested than before. The proxy moved; the goal didn't.
- **Complexity ceiling → method-shredding.** Cap cyclomatic complexity per method and the decision logic gets sliced into six trivially-named private methods that pass the linter while making the *flow* harder to follow, not easier. Per-method complexity drops; actual understandability gets worse. (The dual of comment-padding below.)
- **Comment-density target → comment-padding.** Reward comment-to-code ratio and you get `i++; // increment i` — noise that satisfies the metric and degrades the code, because now real comments drown in restatements of the obvious.
- **Duplication target → premature abstraction.** Punish duplication hard and engineers collapse two superficially similar blocks into one over-parameterized function with a `mode` flag — trading honest duplication for a coupling that the [rule of three / AHA](../05-duplication-and-similarity/senior.md) exists to warn against.

Every one of these is the dashboard being optimized instead of the code. And they share a root cause: a number was put under pressure.

This leads to the single most important governance rule for any code-health dashboard, stated without hedging:

> **You never tie dashboard scores to performance reviews, compensation, or cross-team ranking.**

The reasoning is direct. The pressure of a review is exactly the force that converts a measure into a target and triggers surrogation. The moment "your coverage was 71%" appears in a performance conversation, every engineer who hears about it will, rationally, start writing assertion-free tests — and your dashboard's signal is dead, permanently, across the org. You have spent the thing that made the dashboard valuable (its honest correlation with quality) to buy a metric that now correlates only with gaming skill. Worse, you've made *fixing* genuinely bad code dangerous to do honestly, because honest work might temporarily make a number look worse. A dashboard is a tool for engineers to find their own risks; the instant it becomes a tool managers use to *judge* engineers, it stops measuring code and starts measuring compliance theater.

Keep it diagnostic. The dashboard answers "where is the risk?" for the people who can fix it. It must never answer "who is good?" for the people who rate them.

> **Key insight:** Goodhart guarantees any displayed number becomes a target; surrogation guarantees people will mistake that number for the goal and optimize it directly. Both forces are strongest under evaluation pressure, which is why the non-negotiable rule is that dashboard scores never touch performance reviews, pay, or cross-team rankings — the day they do, the signal dies and is replaced by skill at gaming.

---

## Trends, Deltas, and New-Code Conditions

Absolutes invite Goodhart; *changes* resist it, and they're more honest besides. This deserves its own treatment because the shift from levels to derivatives is the cheapest way to make a dashboard both fairer and harder to game.

**Why deltas beat absolutes.** An absolute conflates two things you must separate: the *legacy* state you inherited and the *trajectory* you're responsible for. Reporting "complexity is high" punishes a team for code written before they arrived; reporting "complexity in your new code is flat and your hotspot count fell by four this quarter" measures *what they actually did*. Deltas align the metric with agency — people are accountable for the change, not the inheritance — which both motivates and removes the unfairness that breeds gaming. A team that can never win an absolute target will game it; a team measured on improvement has an honest path.

**New-code conditions formalize this.** The "clean as you code" model splits the world cleanly:

- **New/changed code** gets a strict gate: meets the coverage bar, introduces no new critical smells, adds no new duplication, stays under complexity limits. This is enforceable on every PR because it scopes to a small, fresh diff the author actually controls.
- **Legacy code** gets *no gate* — only monitoring. You don't block work on a 10-year-old file for failing today's standards; you simply make sure new edits to it clear the new-code bar, so it ratchets toward health every time it's touched.

The effect is a monotonic improvement engine with no boil-the-ocean project: the codebase gets healthier exactly as fast as it's edited, the bar is always met by the person best positioned to meet it (the author of the change), and you've sidestepped the aggregation problem for the legacy lake entirely — you're not grading it, only the stream into it.

**Deltas still need a denominator and a window.** A raw delta lies if volume changed: "smells up 200" means nothing if the team shipped a major feature. Normalize (smells per KLOC changed, new violations per PR) and pick a window that matches the decision cadence — per-PR for the gate, per-sprint or per-quarter for the trend. And beware the *measurement artifact* delta: a config change or a tool upgrade that re-categorizes findings can spike a trend overnight with zero code change. Which is the bridge to trust.

> **Key insight:** Measure the derivative, not the level — deltas hold a team accountable for what they did rather than what they inherited, and "clean as you code" turns that into a monotonic improvement engine that needs no cleanup project. Just remember to normalize by volume and to distinguish a real trend from a tool-config artifact.

---

## Build vs Buy — SonarQube / CodeScene / Code Climate vs a Metrics Warehouse

At senior level you'll be asked to choose the platform, and the honest framing is a spectrum from turnkey product to custom pipeline, each with a different cost center and a different ceiling.

| Option | What you get | Strengths | The catch |
|---|---|---|---|
| **SonarQube / SonarCloud** | Per-language analyzers, quality gates, **clean-as-you-code** new-code conditions, SQALE-based ratings | Excellent new-code model; broad language coverage; mature CI integration; the gate-on-the-diff design is the right default | Ratings are opinionated and arbitrary (the aggregation problem, productized); the A–F can invite scoreboard misuse |
| **CodeScene** | **Behavioral** analysis — churn × complexity hotspots, change coupling, knowledge/bus-factor maps, code health over time | Built on the *right* theory (history predicts defects, risk is concentrated); hotspot ranking is action-shaped out of the box; strong on the human/ownership dimension | Narrower than a general linter; a distinct mental model the team must learn |
| **Code Climate (Quality)** | Maintainability grades, duplication, churn, test coverage overlay, PR-level checks | Fast to adopt; clean PR ergonomics; decent churn/hotspot surfacing | Letter grades front-and-center — the most scoreboard-prone framing of the three |
| **Custom warehouse → Grafana** | You emit raw metrics from many tools (linters, coverage, `git log`, complexity tools) into a store (Postgres/ClickHouse/Prometheus) and visualize | Total control of weighting, risk model, and which numbers are *never* shown; unify code + delivery + incident data in one place | You own ingestion, scale, flaky-signal cleanup, and config consistency forever; it is a *product you maintain*, not a tool you buy |

The decision heuristic:

- **Buy (Sonar/CodeScene)** when you want a correct new-code/hotspot model fast and don't have a platform team to feed a custom pipeline. For most orgs this is right. Pick **CodeScene** if you specifically value the behavioral/ownership lens; **SonarQube** if you want broad language gating with clean-as-you-code; treat **Code Climate's** letter grades with care precisely because they're so easy to weaponize.
- **Build (warehouse + Grafana)** when you have *genuinely* idiosyncratic needs — a risk-weighting model the vendors can't express, a desire to fuse code metrics with DORA/incident data (see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/)) into one risk view, or a hard requirement to control which numbers are displayable to whom (so you can keep scores away from reviews by *construction*). The custom build's real advantage is *editorial*: you decide what's surfaced and what's deliberately suppressed.
- **Hybrid is common and sensible:** let Sonar/CodeScene compute the per-file metrics (don't reimplement complexity parsers), but export their raw outputs into your warehouse so *you* own the aggregation, the risk-weighting, and the presentation — keeping the vendor's opinionated grade out of the human-facing view.

> **Key insight:** Buying gives you a correct hotspot/new-code model fast (CodeScene's behavioral theory and SonarQube's clean-as-you-code are both genuinely good); building gives you editorial control over weighting and — crucially — over *what is shown to whom*. The frequent right answer is hybrid: let the vendor compute metrics, but own the aggregation and presentation so the arbitrary grade never reaches a performance review.

---

## Making It Trustworthy — Data Quality and Flaky-Signal Eradication

A dashboard has exactly one currency: trust. The first time an engineer clicks into a flagged "hotspot" and finds it's clean — flagged because the parser choked on a macro, or a config drifted between two CI runners — they stop believing the dashboard, and a disbelieved dashboard is worse than none, because it costs attention and returns noise. Trust is fragile and asymmetric: it takes one false alarm to lose and many true ones to rebuild. Defending it is a senior responsibility, not a nice-to-have.

The threats and their fixes:

- **Inconsistent configuration.** If two services run different linter rule sets, different complexity thresholds, or different tool versions, their numbers are not comparable and *any* aggregation across them is meaningless — you're adding apples to a different definition of apples. Pin the config: one rule set, one set of thresholds, one tool version, enforced centrally (shared config repo, versioned, not per-team copies that drift). Comparability requires identical measurement, full stop.

- **Flaky signals.** A metric that swings between runs with no code change — coverage jittering because a flaky test sometimes doesn't run, duplication flickering as a tokenizer treats generated code inconsistently — destroys the delta panels, because every real trend is buried in noise. Hunt flaky signals the way you hunt flaky tests: identify, quarantine, fix the root cause. Exclude generated code, vendored code, and migrations from the analysis explicitly (they pollute every metric); make the analysis deterministic so the same commit yields the same numbers.

- **Measurement-artifact spikes.** A rule-set upgrade or tool bump re-categorizes findings and a trend jumps overnight with zero code change. Version the *configuration alongside the data*, and annotate the timeline when config changes, so a step in the graph is legible as "we changed the ruler" rather than misread as "the code suddenly degraded." Never compare a trend across a config change without flagging the discontinuity.

- **Stale or partial data.** A dashboard fed by a job that silently half-fails (analyzed 60% of modules, displayed the average as if it were whole) lies confidently. Make freshness and completeness *first-class, visible* facts on the dashboard itself — last-updated timestamp, modules-analyzed count, explicit failure banners — so a degraded pipeline announces itself instead of quietly poisoning the numbers.

- **Definitional clarity.** Every number needs a precise, one-click definition: what does "coverage" mean here (line? branch? which files excluded?), over what window is "churn" computed, what counts as a "smell." Ambiguous definitions breed mistrust and endless litigation in review meetings. Pin the definitions next to the numbers.

> **Key insight:** A dashboard's only currency is trust, and trust is lost the first time a flagged hotspot turns out clean. Pin configuration so numbers are comparable, hunt flaky signals like flaky tests, annotate the timeline when you change the ruler, and make freshness/completeness visible — a half-failed pipeline that shows a confident number is worse than no dashboard at all.

---

## The Honest Limit — A Dashboard Is a Hypothesis Generator

The most senior thing you can know about a code-health dashboard is the precise boundary of what it can claim. Stated plainly: **a dashboard shows correlation, not causation, and every flagged item is a hypothesis, not a verdict.**

The metrics correlate with risk — high complexity *tends* to coincide with defects, churn *tends* to predict where bugs land, low coverage *tends* to mean untested logic. "Tends to" is the operative phrase. A file at the top of your risk ranking is a file *worth a human look*, not a file *proven bad*. There are real, common reasons a high-scoring file is fine: a parser or state machine that is *irreducibly* complex (the domain is complex, and a "simpler" version would be wrong), a config file that's "duplicated" because the entries genuinely are similar, a generated file with terrible metrics that no human reads or edits. Conversely — and more dangerously — a file with *pristine* metrics can be the worst code in the system: low complexity, high coverage, zero duplication, and quietly wrong, because none of these metrics measure *correctness*, *appropriate design*, or whether the abstraction matches the problem. The dashboard is blind to the things that often matter most.

So the correct posture is investigative, and the [crime-scene metaphor](../04-code-churn-and-hotspots/senior.md) is exact: the dashboard tells you *where to look*, like a heat map of where incidents cluster. It does not tell you *who did it* or *what's wrong* — that requires a detective (an engineer) going to the scene (reading the code). The dashboard generates leads; humans close them. A red number is "go investigate this," and the only valid outcomes of investigating are "yes, this needs work, here's the action" or "no, this is fine, and here's why we're suppressing the alert" — both of which are *judgments a tool cannot make*.

This reframes the entire artifact and dissolves most of its pathologies at once. If the dashboard is a hypothesis generator, then:

- A single grade is obviously wrong — you can't compress a set of *hypotheses* into a letter.
- Tying it to performance reviews is obviously wrong — you don't punish people for a tool's *unconfirmed leads*.
- Distributions and named hotspots are obviously right — those *are* the leads, presented for investigation.

The dashboard's job is to make the most promising hypotheses cheap to find and act on. It earns its keep by directing scarce engineering attention to the few files where investigation most often pays off. It fails the moment anyone treats its output as a conclusion rather than a question.

> **Key insight:** A code-health dashboard is a hypothesis generator: it shows correlation, points at where to look, and is wired blind to correctness and design. Every flag is a lead for a human to confirm or dismiss — which is precisely why a single grade and any link to performance reviews are category errors, and why named hotspots presented for investigation are the right and only honest design.

---

## Mental Models

- **A single score is a chosen lie, not a discovered truth.** Aggregating heterogeneous metrics requires arbitrary normalization and arbitrary weights, performed on ordinal data that doesn't license the arithmetic. The output is a number you can compute but can't defend or act on. Don't aggregate into a scalar; surface the distribution and the worst offenders.

- **Summarize the tail, not the average.** Code risk is Pareto-distributed — a few files carry most of the danger. The mean averages the catastrophe away; one horrifying hotspot and uniform mediocrity share a mean and demand opposite responses. Report p95/p99, danger-zone counts, and the named top-N.

- **Every row should end in a verb.** The unit of an action dashboard is a flagged file with its reason and its next move, not a grade. Deltas over absolutes, new code over the whole lake, per-team view but never a cross-team scoreboard. If a panel doesn't change what someone does tomorrow, delete it.

- **Weight by consequence: criticality × churn.** An uncovered payment file is not an uncovered logging file. Risk ≈ defect-proxy × churn × criticality. That reordering — dormant god-classes down, hot payment paths up — is the entire value, and it's the only weighting you can actually defend.

- **Any displayed number becomes a target (Goodhart), and people mistake it for the goal (surrogation).** Coverage targets breed assertion-free tests; complexity caps breed method-shredding. The forces are strongest under evaluation pressure, so the number never touches reviews, pay, or rankings.

- **The dashboard points; the human investigates.** It shows correlation not causation, is blind to correctness and design, and emits hypotheses not verdicts. A red number means "go look," and only an engineer at the scene can return "fix it" or "it's fine."

---

## Common Mistakes

1. **Reporting one overall grade.** A letter compresses a high-dimensional risk state into a number whose main effect is to destroy actionability and invite scoreboard abuse. The same grade is reachable from a single-catastrophe state and a uniform-mediocrity state — opposite problems. Show the distribution and the top-N hotspots instead.

2. **Summarizing by the mean.** Code risk lives in the tail; the average deletes it. "Mean complexity 12" hides both a 199-clean-files-plus-one-god-class service and a uniformly-dull one. Use tail statistics and named worst offenders.

3. **Ranking by raw counts instead of risk.** Sorting by raw complexity floats dormant, low-blast-radius monsters to the top and buries the hot, critical payment file that actually matters. Weight by criticality × churn so the ranking reflects expected harm.

4. **Tying dashboard numbers to performance reviews, pay, or cross-team ranking.** This is the cardinal sin. Evaluation pressure is exactly what converts a measure into a target and triggers surrogation; the signal dies org-wide and is replaced by gaming skill. Keep the dashboard diagnostic — for engineers to find risk, never for managers to judge people.

5. **Gating the whole legacy codebase instead of new code.** A blanket "80% everywhere" target on a 15-year-old monolith is hopeless, ignored, and breeds resentment. Gate new/changed code (clean-as-you-code); the codebase improves monotonically as it's touched, with no boil-the-ocean project.

6. **Letting config drift between teams/services and then aggregating.** Different rule sets and tool versions make numbers incomparable; aggregating them is adding apples to a different apple. Pin one rule set, thresholds, and tool version centrally; comparability requires identical measurement.

7. **Treating a flagged item as a verdict.** A high score is a hypothesis, not proof — irreducibly-complex parsers and generated files score badly and are fine, while pristine-metric files can be quietly, dangerously wrong. The dashboard points; a human confirms or dismisses. Both "fix it" and "suppress, here's why" are valid outcomes.

8. **Hiding pipeline failures.** A half-failed analysis that displays a confident average lies. Make freshness, completeness, and failures first-class visible facts; a disbelieved dashboard is worse than none.

---

## Test Yourself

1. Why is combining complexity, duplication, coverage, and smells into one health score fundamentally arbitrary? Name the two arbitrary steps and the measurement-scale objection.
2. Two services both report average complexity 12. Why might that single number be actively misleading, and what should the dashboard show instead?
3. You're designing the headline view. Give three concrete design choices that orient it toward *action* rather than *vanity*.
4. An uncovered payment file and an uncovered logging file have identical metrics. How should the dashboard rank them, and what two weights drive that?
5. State Goodhart's law and surrogation in one sentence each, give two specific gaming patterns a code-health dashboard induces, and the one governance rule that follows.
6. Why are deltas and new-code conditions both fairer and harder to game than absolute, whole-codebase targets?
7. When would you build a custom metrics warehouse instead of buying SonarQube/CodeScene, and what's the usual hybrid?
8. "The dashboard flagged this file, so it's bad." What's wrong with that sentence?

<details>
<summary>Answers</summary>

1. **Step one: normalization** — complexity (a ratio count) and coverage (a 0–100 proportion) are incommensurable units, so each must be mapped onto a common scale via a threshold curve whose every breakpoint is a *choice* (Sonar/CodeScene/Code Climate each pick differently). **Step two: weighting** — combining them needs coefficients (is duplication twice as bad as low coverage?) that no empirical procedure fixes; they're chosen to "feel right," which is circular. **Scale objection:** the inputs are at best *ordinal* (30 is worse than 15 but not "twice as bad"; A→B ≠ B→C), and averaging/weighting are interval-scale operations the data doesn't license — a computable but uninterpretable number.

2. The mean averages away the tail, and code risk lives in the tail (Pareto-distributed). Service A could be 199 clean files plus one complexity-210 god-class on the payment path; Service B uniformly 10–14. Same mean, opposite risk and opposite required responses. Show the **distribution shape** (p95/p99, count above the danger threshold) and the **named top-N hotspots**, not the average.

3. Any three: (a) headline is the **top-N hotspots, each with a specific next action and the reason it's flagged** — every row ends in a verb, no letter grade; (b) **deltas/trends over absolutes** (direction of the danger zone, where new debt lands); (c) **new-code conditions** (gate the diff, not the legacy lake); (d) **per-team views without a cross-team scoreboard**.

4. They must **not** rank equal. Weight by **criticality** (blast radius — what it costs when wrong; payments ≫ logging) and **churn** (how often it changes — where bugs are minted now). Risk ≈ defect-proxy × churn × criticality, so the payment file rises and the logging file falls despite identical raw metrics.

5. **Goodhart:** when a measure becomes a target, it ceases to be a good measure (people move the proxy without moving the goal). **Surrogation:** people mistake the measure for the goal itself and optimize the number instead of the thing it stood for. **Patterns:** coverage target → assertion-free tests; complexity cap → method-shredding into trivial private methods (or comment target → `i++; // increment i`; duplication target → premature over-parameterized abstraction). **Rule:** never tie dashboard scores to performance reviews, compensation, or cross-team ranking — evaluation pressure kills the signal.

6. An absolute conflates inherited legacy with the team's actual trajectory and punishes people for code they didn't write — an unwinnable target that invites gaming. A **delta** measures what the team *did* (agency), aligning accountability with action. **New-code conditions** gate only the small fresh diff the author controls, which is achievable and fair, ratchets the codebase healthier as it's touched, and sidesteps grading the legacy lake entirely.

7. **Build** when you have genuinely idiosyncratic needs: a risk-weighting model vendors can't express, a desire to fuse code metrics with DORA/incident data into one risk view, or a hard requirement to control *what's shown to whom* (keeping scores out of reviews by construction). **Hybrid (the usual answer):** let Sonar/CodeScene compute the per-file metrics, but export their raw outputs into your warehouse so you own the aggregation, risk-weighting, and presentation — keeping the vendor's arbitrary grade out of the human-facing view.

8. A flag is a **hypothesis (correlation), not a verdict (causation)**. The metrics are blind to correctness and design: irreducibly-complex parsers and generated files score badly and are fine, while pristine-metric files can be quietly wrong. The flag means "a human should go look"; valid outcomes are "yes, fix it, here's the action" or "no, it's fine, here's why we're suppressing it" — judgments the tool can't make.

</details>

---

## Cheat Sheet

```
THE AGGREGATION PROBLEM
  one score = arbitrary normalization + arbitrary weights on ORDINAL data
  → don't compute a scalar grade; show the DISTRIBUTION + named TOP-N hotspots
  same "B" reachable from 1-catastrophe and uniform-mediocrity → opposite fixes

DISTRIBUTIONS > MEANS
  code risk is Pareto (tail carries the danger); mean averages it away
  report p95/p99, count above danger threshold, ranked worst offenders

DESIGN FOR ACTION (not vanity)
  unit = a ROW that ends in a VERB: file · why flagged · next action
  deltas/trends over absolutes        new-code gate over whole-lake gate
  per-team view  —  NEVER a cross-team scoreboard / single grade

RISK-WEIGHTING
  risk ≈ defect_proxy(complexity, dup, low-cov) × churn × criticality
  uncovered PAYMENT file ≫ uncovered LOGGING file (same metrics, diff stakes)
  dormant god-class DOWN, hot critical path UP

GOODHART / SURROGATION
  any displayed number → a target (Goodhart); people optimize it (surrogation)
  coverage→assertion-free tests · complexity cap→method-shredding
  comment target→padding · dup target→premature abstraction
  RULE: scores NEVER touch reviews / pay / cross-team ranking

TRUST
  pin ONE config (rules, thresholds, tool version) → comparability
  hunt flaky signals like flaky tests; exclude generated/vendored/migrations
  annotate timeline on config change ("changed the ruler" ≠ "code degraded")
  show freshness + completeness + failures as first-class facts

BUILD vs BUY
  SonarQube  → clean-as-you-code new-code gate, broad languages
  CodeScene  → behavioral hotspots (churn×complexity), ownership/bus-factor
  Code Climate → fast PR ergonomics, but letter grades = scoreboard-prone
  Custom (warehouse→Grafana) → own weighting + control WHAT'S SHOWN TO WHOM
  hybrid: vendor computes metrics, YOU own aggregation + presentation

THE HONEST LIMIT
  correlation not causation · blind to correctness + design
  every flag = HYPOTHESIS for a human to confirm/dismiss, not a verdict
```

---

## Summary

- **Aggregating heterogeneous metrics into one health score is fundamentally arbitrary** — it requires choosing a normalization curve and choosing weights, performed on ordinal data that doesn't license the arithmetic. The grade is a number you can compute but can't defend, and its main effect is to destroy the actionable detail. Don't aggregate into a scalar; surface the distribution and the worst offenders.
- **The mean is the wrong summary** because code risk is Pareto-distributed: one catastrophic hotspot and uniform mediocrity share a mean and demand opposite responses. Report the tail (p95/p99, danger-zone counts) and the named top-N.
- **Design for action, not vanity:** the atomic unit is a flagged file with a reason and a next action — every row ends in a verb. Prefer deltas to absolutes, gate new code rather than the whole legacy lake, and give each team their own view but never a cross-team scoreboard.
- **Risk-weight by criticality × churn.** An uncovered payment file is not an uncovered logging file; weighting by what-it-costs-when-wrong and how-often-it-changes reorders the list to where attention removes the most expected risk — and it's the only weighting you can actually defend.
- **Goodhart and surrogation are inescapable:** any displayed number becomes a target and people optimize it directly (assertion-free tests, method-shredding). The forces peak under evaluation pressure, so the cardinal rule is that scores never touch performance reviews, compensation, or rankings.
- **Trust is the dashboard's only currency.** Pin configuration for comparability, eradicate flaky signals, annotate config changes on the timeline, and make freshness/completeness visible — a confident number from a half-failed pipeline is worse than no dashboard.
- **A dashboard is a hypothesis generator** — correlation not causation, blind to correctness and design. Every flag is a lead for a human to confirm or dismiss, which is exactly why a single grade and any link to reviews are category errors, and why named hotspots presented for investigation are the only honest design.

You now design code-health dashboards as instruments that direct scarce engineering attention to confirmable risk — and that survive contact with the people they measure. The next layer — [professional.md](professional.md) — is about rolling one out across an organization: governance, adoption without fear, and operating it as live infrastructure that engineers trust enough to act on.

---

## Further Reading

- *Your Code as a Crime Scene* and *Software Design X-Rays* — Adam Tornhill. The behavioral, churn × complexity hotspot model that underpins action-oriented health dashboards (and CodeScene); the crime-scene "point at where to look" framing.
- *The Tyranny of Metrics* — Jerry Z. Muller. The general case for why measurement-as-target degrades the thing measured, across every field — the deep background to Goodhart on dashboards.
- Goodhart's law and **surrogation** — the original Goodhart formulation (and Marilyn Strathern's crisp restatement), plus the management-accounting literature on surrogation (mistaking the measure for the construct).
- *Accelerate* — Forsgren, Humble, Kim. On using metrics for *learning, not judgment* — the same discipline this page applies to code health, from the delivery side.
- SonarQube's **"Clean as You Code"** documentation — the canonical treatment of new-code conditions and gating the diff rather than the whole codebase.
- CodeScene's technical write-ups on code health, hotspots, and change coupling — a buy-side platform built on the right (behavioral, distribution-aware) theory.

---

## Related Topics

- [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/senior.md) — the churn × complexity model and the crime-scene metaphor that make risk-weighting and "point at where to look" concrete.
- [02 — Maintainability Index](../02-maintainability-index/senior.md) — the canonical cautionary tale of a composite index with indefensible constants; the aggregation problem in a single metric.
- [05 — Duplication & Similarity](../05-duplication-and-similarity/senior.md) — why a duplication *target* breeds premature abstraction (rule of three / AHA), one of the dashboard's gaming patterns.
- [Code Coverage](../../code-coverage/) — the home of "signal not target" and the assertion-free-test failure mode; coverage is the metric most often weaponized on dashboards.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the delivery-side twin of this page: the same Goodhart discipline, metrics-as-learning-not-judgment, and the warehouse you might fuse with code health.
- [Technical Debt Management](../../technical-debt-management/) — what to *do* with the hotspots a dashboard surfaces: prioritizing and paying down the risk it points at.
