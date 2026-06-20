# Performance Budgets and Regression Testing — Professional Level

> **Roadmap:** [Performance](../README.md) → Performance Budgets and Regression Testing
> *The senior page taught you to write a stable benchmark and pick a statistical threshold. This page is about running that machinery as org-wide governance — who owns the budget, who gets paged when it breaks, why half the benchmarks get muted within a year, and how you justify a six-figure runner fleet against incidents nobody can see because they never happened.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Making Budgets Stick Organizationally](#making-budgets-stick-organizationally)
4. [Performance Budgets as SLOs and Error Budgets](#performance-budgets-as-slos-and-error-budgets)
5. [The Continuous-Benchmarking Platform as Infrastructure](#the-continuous-benchmarking-platform-as-infrastructure)
6. [Blocking Gate vs Non-Blocking Alert vs Trend-Only](#blocking-gate-vs-non-blocking-alert-vs-trend-only)
7. [The Human Side — Sheriffs, Triage, and Trust](#the-human-side--sheriffs-triage-and-trust)
8. [The Production-Feedback Loop — RUM and Canaries as Ground Truth](#the-production-feedback-loop--rum-and-canaries-as-ground-truth)
9. [Cost and ROI of the Apparatus](#cost-and-roi-of-the-apparatus)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Running performance governance across an organization — turning a benchmark suite into an owned, paged, funded SLO program that survives contact with deadlines, flaky hardware, and skeptical engineers.**

The senior page solved a technical problem: how to produce a trustworthy verdict from a noisy benchmark and decide whether a PR regressed. That verdict is worthless if nobody acts on it. At the professional level the hard part isn't the statistics — it's the *organization* around the statistics. A perfect Mann-Whitney threshold that fires into a Slack channel everyone has muted has prevented zero regressions.

The questions that actually consume your time look like this: A budget is breached on `main` — whose pager rings, and what are they expected to do at 2 a.m.? A team needs to ship a feature that costs 8 ms of p99 — who is allowed to say yes, and how is that recorded? The micro-benchmark suite has 40 benchmarks; six are flaky and people now reflexively re-run red builds until they go green — how much trust has already leaked out of the system? The runner fleet costs $120k/year — what do you tell the VP who asks why?

This is the layer where performance stops being an engineering practice and becomes a *governance* practice, modeled on the same machinery as reliability SLOs. The reference implementations are public and worth studying: Chromium's [perf sheriffs](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/perf_regression_sheriffing.md) and the Pinpoint auto-bisector, Mozilla's [Perfherder](https://wiki.mozilla.org/EngineeringProductivity/Projects/Perfherder), and the [Go performance dashboard](https://perf.golang.org). They all converged on the same shape — and so will you, whether by design or by painful iteration.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — stable benchmarks, statistical thresholds (Mann-Whitney U, confidence intervals), `benchstat`-style comparison, the noise problem.
- **Required:** Familiarity with SLOs and error budgets (the SRE model) — this page leans on them heavily. See the `monitoring-alerting` skill.
- **Helpful:** You've owned an on-call rotation and felt alert fatigue from the inside.
- **Helpful:** You've watched a quality gate get disabled because it was annoying, and seen what slipped through afterward.

---

## Making Budgets Stick Organizationally

A budget that isn't *owned* isn't a budget — it's a number in a wiki. The single most common failure mode of performance governance is a beautifully instrumented dashboard that nobody is accountable for, breaching quietly for months.

Three things have to be true for a budget to have teeth:

**1. It has a named owner, not a team alias.** "The platform team owns the search-latency budget" decays into nobody owning it. Assign budgets to a person (with a backup), the same way you assign service ownership. The owner's job isn't to *never regress* — it's to *know the current state and drive the decision* when a regression lands.

**2. A breach has a defined consequence and a defined responder.** Without this, a red dashboard is wallpaper. The consequence is a spectrum (covered in [Blocking Gate vs Non-Blocking Alert vs Trend-Only](#blocking-gate-vs-non-blocking-alert-vs-trend-only)), but *someone specific* must be on the hook to respond. The model that works: the **regression is attributed to the offending PR**, and the PR author — not the budget owner — is the first responder. The author has the context; the budget owner escalates if the author can't.

**3. Changing the budget requires sign-off, not a quiet edit.** The moment a budget becomes uncomfortable, the path of least resistance is to bump the number. If anyone can edit `latency_budget_ms: 200` → `250` in a config file and merge it, the budget is fiction. Gate budget changes behind a lightweight RFC:

```markdown
# RFC: Raise checkout-service p99 budget 180ms → 220ms

## Current state
p99 budget: 180ms (set 2024-Q1). Breached by the new fraud-scoring call.

## Proposed change
Raise to 220ms.

## Why this is the right tradeoff
Fraud scoring blocks $1.2M/yr in chargebacks. The 40ms is a synchronous
ML call; async rework is ~6 weeks. We accept the latency now and track
the async migration as PERF-4471 (target Q3).

## Alternatives considered
- Async the call now: +6wk, delays fraud rollout. Rejected for timing.
- Cache scores: 30% hit rate in spike test, insufficient. Deferred.

## Sign-off
- [ ] Budget owner (latency): @asha
- [ ] Service owner (checkout): @diego
- [ ] Eng director (accepts the regression on record): @priya
```

The RFC does two things: it makes the cost *visible* (a director's name is on accepting 40 ms of permanent latency), and it creates an audit trail so the budget's history is a record of deliberate decisions, not entropy. The friction is the point — it should be slightly annoying to widen a budget, exactly as annoying as it is to widen an SLO.

> **The professional reality:** budgets don't fail because the threshold math is wrong. They fail because no one is accountable, breaches have no consequence, and the number can be edited away under deadline pressure. Fix the org design first; the statistics were never the bottleneck.

---

## Performance Budgets as SLOs and Error Budgets

The cleanest mental upgrade at this tier is to stop treating a performance budget as a pass/fail line and start treating it as an **SLO with an error budget** — the same construct SRE uses for availability.

A naive budget says "p99 checkout latency must be ≤ 200 ms." That formulation is brittle: a single spike trips it, and a sustained 201 ms is treated the same as a sustained 400 ms. The SLO formulation is richer:

- **SLI (indicator):** the measured quantity — p99 checkout latency over a rolling 28-day window.
- **SLO (objective):** "99% of 1-minute windows have p99 ≤ 200 ms."
- **Error budget:** the allowed 1% of windows that may exceed it — roughly 7 hours/month of being over budget.

Now a regression isn't binary. It *burns error budget*. A small regression burns slowly; a large one burns fast. You alert on the **burn rate**, which gives you the same elegant escalation SRE uses:

```yaml
# Multi-window burn-rate alerts for a latency SLO (concept)
- alert: PerfBudgetFastBurn
  # Burning a month of budget in ~2 days → page now
  expr: latency_budget_burn_rate_1h > 14 and latency_budget_burn_rate_5m > 14
  severity: page
- alert: PerfBudgetSlowBurn
  # Burning steadily → ticket, look at it this week
  expr: latency_budget_burn_rate_6h > 3 and latency_budget_burn_rate_1h > 3
  severity: ticket
```

The error-budget framing unlocks the organizational lever that makes budgets *negotiable in a healthy way*: **when the error budget is exhausted, feature work that risks latency stops until the budget is recovered.** That's the SRE freeze, applied to performance. It converts "performance vs features" from a recurring argument into a pre-agreed policy. Teams don't litigate it every sprint; they agreed once that an exhausted budget halts risky merges.

> **The link that matters:** a performance budget *is* a latency SLO measured pre-production (in CI/benchmarks) and validated post-production (in [RUM](#the-production-feedback-loop--rum-and-canaries-as-ground-truth)). The CI benchmark is your *leading* indicator; the production SLO is your *ground-truth* indicator. They should agree; when they diverge, your benchmark is lying to you (see [Latency and Throughput](../03-latency-and-throughput/professional.md) for why lab p99 and prod p99 drift).

---

## The Continuous-Benchmarking Platform as Infrastructure

At one engineer's scale, "continuous benchmarking" is a CI job that runs `go test -bench` and posts a comment. At org scale it's *infrastructure* — a system with the same operational weight as your metrics stack, and it has four components that you will build or buy whether you plan to or not.

**1. A dedicated runner fleet.** This is the non-negotiable foundation, and the most common thing teams get wrong. Shared CI runners are *noisy*: they share CPUs with other jobs, have variable thermal state, and live on cloud instances with stolen cycles and noisy neighbors. Benchmark noise on a shared runner can dwarf the regressions you're trying to detect. You need **dedicated, isolated, identical hardware**:

- Bare-metal or pinned dedicated instances — no neighbors, no CPU steal.
- Fixed CPU frequency: disable turbo/boost, pin the governor to `performance`, so a result doesn't depend on thermal luck.
- `taskset`/cgroup pinning to isolated cores; `isolcpus` to keep the OS scheduler off them.
- The *same* machine model for every run, forever — comparing across hardware generations silently corrupts the time series.

```bash
# A perf-runner pre-flight, run before every benchmark batch
cpupower frequency-set -g performance
echo 0 > /sys/devices/system/cpu/cpufreq/boost          # kill turbo variance
echo 1 > /proc/sys/kernel/perf_event_paranoid
taskset -c 4-7 ./run-benchmarks --warmup 5 --iterations 30
```

A pragmatic fleet for a mid-size org is small — often 4–10 machines — because benchmark runs are serialized per machine to avoid contention. The fleet's *value* is consistency, not throughput.

**2. A result store / time-series database.** Every benchmark result, tagged with commit SHA, machine ID, and full environment fingerprint, written to a queryable store. This is what turns "is this PR slower?" into "is this metric trending up over the last 200 commits?" Go's perf dashboard, Perfherder, and Chromium's dashboard are all, at heart, this store plus a UI.

**3. A dashboard with per-metric time series and commit annotations.** The killer feature is **attribution**: every point on the graph links to the commit that produced it, so a step-change in the line points straight at the offending SHA. This is what makes a sheriff's job possible.

**4. Alerting with automatic attribution to the offending PR/commit.** When a metric steps, the system shouldn't just fire — it should identify *which commit* caused it and ideally *auto-bisect* the range to a single SHA, then file a bug assigned to that author. This is the part that separates a toy from Chromium's setup:

```json
{
  "alert": "regression",
  "metric": "browser.startup_time_p95",
  "magnitude": "+9.2% (412ms → 450ms)",
  "confidence": "p < 0.001, 30 runs each side",
  "bisected_to": "a1b9f3c",
  "author": "@kira",
  "auto_action": "filed BUG-8842, assigned @kira, snoozed gate to alert-only for this metric pending triage"
}
```

> **The build-vs-buy reality:** small teams should *buy or adopt* (`bencher.dev`, Codspeed, language-native dashboards) before building. Building the full Chromium-grade platform — fleet, store, bisector, sheriff tooling — is a multi-quarter infra project justified only when benchmark coverage is core to the product (a browser, a database, a language runtime). Most orgs need 10% of Chromium's machinery; building 100% of it is a classic over-investment.

---

## Blocking Gate vs Non-Blocking Alert vs Trend-Only

The single most consequential design decision in performance governance is *what happens when a check goes red*. Get this wrong and you either grind PRs to a halt with flaky gates (and lose trust) or fire alerts nobody reads (and catch nothing). There are three response levels, and the skill is matching each metric to the right one.

| Response | What it does | Use for | Failure mode if misused |
|---|---|---|---|
| **Blocking gate** | Red blocks the merge | User-facing latency budgets; binary-size budgets; a small set of golden macro-benchmarks | A flaky gate trains everyone to re-run until green, then it catches nothing |
| **Non-blocking alert** | Red posts a comment / pings a channel, merge proceeds | Micro-benchmark suites; per-component timings; anything with > ~2% run-to-run noise | Alert fatigue → muted channel → invisible regressions |
| **Trend-only** | No per-PR verdict; watched as a time series, sheriff investigates steps | Noisy metrics; metrics with no clean per-PR signal; broad coverage suites | None for trust, but slow detection (a sheriff has to look) |

The governing principle: **block only what is (a) genuinely user-facing and (b) stable enough that a red verdict is almost always real.** A blocking gate's credibility is its entire value, and credibility is destroyed by a single percentage of false positives. If a gate cries wolf even 3% of the time on a busy repo, engineers learn the ritual "regression? just re-run it" — and the next time it fires on a *real* 2x regression, they re-run that too, and ship it.

The mapping that works in practice:

- **Block** on a handful of curated, rock-stable, user-facing budgets: end-to-end page-load p95, API latency budget, bundle size, cold-start time. These should be macro-benchmarks or production-shaped scenarios with noise well under the regression you care about.
- **Alert** on the broad micro-benchmark suite — the hundreds of `BenchmarkX` functions. They're valuable as a trend and for attribution, but per-PR blocking on a noisy micro-bench is pure friction. Post a comment, don't block.
- **Trend-only** for the long tail — exploratory metrics, third-party-dependent timings, anything you haven't yet earned the right to gate on.

> **The migration path:** a metric *earns* its way up the ladder. New metrics start trend-only. Once they're stable for a quarter and clearly tied to user experience, promote them to alert. Only after they've proven they fire true positives do you promote to a blocking gate. Demote instantly the moment a gate produces a false positive that wastes the team's time — a blocking gate that has lost trust is worse than no gate.

---

## The Human Side — Sheriffs, Triage, and Trust

Automated detection is half the system. The other half is a *human workflow* that turns a fired alert into a closed regression — and a *trust budget* that, once spent, is brutally hard to recover.

**The sheriff rotation.** Borrowed directly from Chromium and Mozilla: a rotating role (a week at a time) whose job is to watch the performance dashboards and triage every regression alert. The sheriff isn't expected to *fix* regressions — they're a dispatcher. The rotation spreads the load and the knowledge, and crucially it means *someone is always looking*. Without a named sheriff, dashboards rot; everyone assumes someone else is watching.

**The triage workflow.** A good system does most of this automatically and leaves the sheriff the judgment calls:

```
Alert fires (metric stepped, p < 0.001)
   │
   ▼
Auto-bisect the commit range  ──► single offending SHA
   │
   ▼
Auto-file a bug, assign to the commit author, link the dashboard
   │
   ▼  (sheriff reviews)
   ├─ Real & expected (we accepted this in an RFC)  → close, annotate budget
   ├─ Real & unexpected                              → confirm assignment, set severity
   ├─ Real but tiny / not worth it                   → file as low-pri or wontfix
   └─ Not real (flaky benchmark / infra blip)        → MUTE the benchmark, file a fix-the-bench bug
```

The last branch is the most important and the most neglected. **Flaky benchmarks are the cancer of a perf program.** A benchmark that fires false alarms doesn't just waste the sheriff's time — it teaches everyone that perf alerts are noise. The discipline that keeps the system alive: *a benchmark that produces a false positive is muted immediately and treated as broken until fixed.* It does not get to keep crying wolf while someone "gets around to" stabilizing it. Killing flaky benchmarks aggressively is how you protect the trust budget of the ones that remain.

> **Trust is the real currency.** Every false positive — a flaky gate, a noisy alert, a regression bug filed against an innocent commit — withdraws from a trust account. When the balance hits zero, engineers route around the entire system, and you're back to shipping regressions blind. Protect trust ruthlessly: fewer, more-reliable signals beat broad, noisy coverage every time. A perf program's health is measured not by how many benchmarks it runs but by how often its alerts are *believed*.

---

## The Production-Feedback Loop — RUM and Canaries as Ground Truth

Every benchmark is a model of reality, and every model is wrong somewhere. The CI suite runs on pristine hardware with synthetic inputs; production runs on whatever the customer has, under real traffic shapes, with cache states and contention the lab never reproduces. The professional posture treats **production as the ground-truth budget** and the lab as a leading indicator that must be validated against it.

**Real-user monitoring (RUM).** For anything user-facing, the budget that *actually matters* is the latency real users experience — Core Web Vitals (LCP, INP, CLS) from real browsers for frontend, prod p99/p999 from your APM for backend. RUM is the ultimate budget because it's denominated in the only units that count: user experience. Your CI benchmark should *track* RUM, not replace it. When the lab says "no regression" but RUM p99 climbs, the lab is unrepresentative — wrong inputs, wrong hardware mix, wrong concurrency — and that divergence is itself a high-value signal that your benchmark needs fixing.

**Canary performance comparison.** The highest-leverage regression catch happens *between* CI and full rollout: the canary. Before a build reaches 100% of traffic, route a small slice (1–5%) to it and statistically compare the canary's performance against the stable fleet on identical, *real* traffic:

```
Canary analysis — build a1b9f3c, 5% traffic, 30-min window
  metric          stable      canary      delta     verdict
  ─────────────────────────────────────────────────────────
  p50 latency     42ms        43ms        +2.4%     PASS
  p99 latency     180ms       361ms       +101%     FAIL  ◄── 2x regression
  error rate      0.02%       0.02%       —         PASS
  cpu / req       8.1ms       8.3ms       +2.5%     PASS
  → AUTOMATED ROLLBACK: p99 breach > 20% threshold. Build held at 5%.
```

The canary catches what no lab benchmark can: regressions that only manifest under *real* traffic distribution, *real* cache behavior, and *real* data sizes. It's an apples-to-apples comparison (same time, same traffic, same hardware) and it gates the rollout, not the merge — so it can be strict without slowing PR velocity. A canary that auto-rolls-back on a p99 breach is the strongest single safeguard in the entire apparatus, because it sits at the last gate before users feel the pain.

> **The three-layer defense:** CI benchmarks (fast, cheap, leading, but unrepresentative) → canary comparison (slower, real traffic, gates rollout) → RUM/prod SLO (ground truth, but lagging). No single layer is sufficient. CI catches the obvious early; canary catches the production-only; RUM tells you whether the whole system is actually keeping its promise. Tune your investment so the cheap layers catch most regressions and the expensive ground-truth layer is the backstop, not the primary detector.

---

## Cost and ROI of the Apparatus

Eventually someone with a budget asks: *why does performance testing cost six figures a year?* You need an answer that isn't "trust me, it's important."

**The cost side is concrete:**

- **Runner fleet:** 6 dedicated bare-metal machines ≈ $1.5–3k/month hardware or reserved-instance equivalent → ~$25–35k/year. Plus the engineer-time to keep them identical and healthy.
- **Platform engineering:** building/operating the store, dashboard, and bisector — easily 0.5–1 FTE if self-built (the strongest argument for buying).
- **Sheriff time:** one engineer-week per rotation cycle, spread across the team — real, recurring opportunity cost.
- **PR friction:** every false positive costs the whole team minutes-to-hours of re-runs and investigation. This is the *hidden* cost that destroys ROI if flakiness isn't controlled.

**The value side is harder to see because it's counterfactual** — the regressions that *didn't* ship. To make it visible, instrument the wins:

- **Count caught regressions and estimate their blast radius.** "The canary caught a 2x p99 regression that would have hit 100% of checkout traffic; at our conversion sensitivity (~1% revenue per 100 ms), a sustained 180 ms regression is ~$X/day." A single caught checkout or search regression often pays for the fleet for a year.
- **Track the alternative cost: perf incidents.** A regression that ships becomes an incident — on-call hours, customer impact, an emergency rollback, a postmortem. Tally incidents *avoided* (caught pre-prod) against incidents *that slipped*. A program that catches 10 real regressions a year and lets 1 slip has an obvious ROI story.
- **Frame it as insurance, priced by exposure.** A browser, a database, or a high-traffic checkout flow has enormous performance exposure; a low-traffic internal tool has almost none. The apparatus should be sized to the exposure. Spending Chromium money to guard an internal admin panel is malpractice; spending nothing to guard a billion-user product is negligence.

> **The honest ROI conversation:** the apparatus is insurance against expensive, hard-to-detect, slow-to-roll-back regressions. Its cost is visible and recurring; its value is invisible and counterfactual. Win the argument by *instrumenting the catches* — make the avoided incidents and the prevented revenue loss a number on a slide — and by *right-sizing to exposure* so you're never defending Chromium-scale spend on a low-stakes service.

---

## War Stories

**The budget everyone ignored.** A team set a 250 KB JavaScript bundle budget and wired a CI check. It was non-blocking (a warning comment) and owned by "the frontend team." Over 14 months the bundle grew to 900 KB, one 30 KB dependency at a time, each PR's warning dismissed as "we'll trim it later." No single PR looked bad; the budget had no owner who tracked the *trend*, no consequence for a breach, and no point at which the warning escalated. Mobile LCP quietly doubled. The fix wasn't a tighter number — it was making the budget *blocking* above a hard ceiling, assigning a named owner who reviewed the trend weekly, and requiring an RFC to merge anything that pushed past it. The budget had failed as governance, not as math.

**The flaky gate that got disabled, then a real regression shipped.** A backend team gated merges on a micro-benchmark suite. Several benchmarks were noisy (~5% run-to-run on shared CI runners), so the gate failed spuriously a couple of times a week. Engineers learned to re-run red builds until green. After a particularly bad week of false failures during a deadline crunch, someone disabled the gate "temporarily." Three weeks later a refactor introduced a real 40% regression in a hot serialization path — exactly the kind of thing the gate existed to catch. It shipped, surfaced as elevated p99 in production a week later, and took a day to bisect by hand. Two lessons: the gate should never have been *blocking* on noisy micro-benchmarks (alert-only was correct), and the noise should have been fixed at the source (a dedicated runner) instead of tolerated until trust collapsed. The flakiness didn't just cause false alarms — it caused the gate's *deletion*, which is how a real regression got through.

**The canary that caught a 2x regression.** A change to an ORM's query builder passed every CI benchmark — the micro-benchmarks used small synthetic datasets where the new code path was fine. At 5% canary traffic, p99 on the largest tenant's queries jumped from 180 ms to 360 ms: the change had pessimized a query plan that only mattered at production data scale. The automated canary analysis flagged the p99 delta against the stable fleet and held the rollout at 5% instead of promoting to 100%. The regression never reached the other 95% of users. No lab benchmark caught it because no lab benchmark had production-scale data; the canary caught it precisely because it ran on *real* traffic and *real* data. This is the case that justifies the canary layer's existence in one incident.

---

## Decision Frameworks

**Should this metric be a blocking gate, an alert, or trend-only? Ask:**
- Is it genuinely user-facing (latency, bundle size, cold start)? If no → alert or trend-only, never block.
- Is its run-to-run noise comfortably smaller than the regression I care about? If no → fix the noise first, or alert/trend-only.
- Has it produced a false positive in the last quarter? If yes → demote until it's reliable.
- New metric with no track record? → start trend-only and let it earn promotion.

**Who responds to a breach? Default to:**
- First responder = the **PR author** the regression is attributed to (they have the context).
- Escalation = the **named budget owner** (drives the decision if the author can't).
- Sign-off to *change* the budget = service owner + budget owner + a director on record.

**Should we build or buy the platform? Ask:**
- Is benchmark coverage core to the product (browser/DB/runtime)? → building the full fleet+store+bisector may be justified.
- Otherwise → buy/adopt (`bencher.dev`, Codspeed, language dashboards). You need ~10% of Chromium's machinery.

**How much should we spend? Size to exposure:**
- High traffic × high latency-sensitivity (checkout, search, a browser) → invest in the full three-layer defense incl. canary auto-rollback.
- Low traffic / low stakes (internal tool) → trend-only dashboard, no fleet, no sheriff.

**A regression alert fired — first question:**
- Is it *real*? If flaky → **mute the benchmark now** and file a fix-the-bench bug. Never let a known-flaky benchmark keep firing.

---

## Mental Models

- **A budget without an owner, a consequence, and a sign-off gate is decoration.** The statistics were never the bottleneck; the org design is. Fix accountability before you tune thresholds.

- **A performance budget is an SLO with an error budget.** Stop thinking pass/fail; think burn rate. An exhausted error budget halts risky merges — the freeze converts a recurring argument into a pre-agreed policy.

- **A blocking gate's only asset is its credibility, and one false positive spends it.** Block only what is user-facing *and* rock-stable. Everything else alerts or trends. A gate engineers re-run reflexively has already failed.

- **Flaky benchmarks are a tax on every other signal's trust.** Mute on first false positive, treat as broken until fixed. Fewer reliable signals beat broad noisy coverage.

- **The lab is a leading indicator; production is ground truth.** RUM and the prod SLO are the real budget; CI benchmarks predict it. When they diverge, the benchmark is unrepresentative — and that divergence is itself a signal.

- **The canary is the last gate before users feel pain — and the only one that runs on real traffic.** It catches the production-only regressions no lab can, and it gates the rollout, not the merge, so it can be strict for free.

- **The apparatus is insurance; price it by exposure.** Chromium money guarding an admin panel is malpractice; nothing guarding a billion-user product is negligence.

---

## Common Mistakes

1. **Budgets with no owner, no consequence, and an editable number.** The bundle creeps to 900 KB one PR at a time. Assign a named owner, define a breach consequence, and gate budget changes behind an RFC with sign-off.

2. **Blocking merges on noisy micro-benchmarks.** A few percent of false failures trains everyone to re-run until green, then the gate catches nothing and eventually gets deleted. Block only stable user-facing metrics; alert on micro-benches.

3. **Tolerating flaky benchmarks instead of muting them.** Every false alarm drains the trust account. Mute on the first false positive and fix the bench; a known-flaky benchmark that keeps firing is actively harmful.

4. **Running benchmarks on shared CI runners.** Noisy neighbors and CPU steal produce noise that dwarfs real regressions. A dedicated, frequency-pinned, isolated fleet is the foundation, not an optimization.

5. **Trusting the lab over production.** Synthetic inputs and pristine hardware miss production-scale, real-traffic regressions. Validate against RUM and gate rollout with a canary; treat lab-vs-prod divergence as a benchmark bug.

6. **No attribution / no auto-bisect.** "Something regressed in the last 200 commits" is nearly useless under deadline. Tag every result with the SHA, annotate the dashboard, and auto-bisect to a single commit and author.

7. **Defending the apparatus's cost with vibes.** "It's important" loses to a spreadsheet. Instrument the catches — count avoided incidents and prevented revenue loss, and size spend to the service's exposure.

8. **No sheriff / no rotation.** Dashboards rot when everyone assumes someone else is watching. A named, rotating sheriff guarantees someone is always triaging.

---

## Test Yourself

1. A bundle-size budget grew from 250 KB to 900 KB over a year despite a CI check. Name the three governance failures and the fix for each.
2. Reframe "p99 checkout latency must be ≤ 200 ms" as an SLO with an error budget. What does burn-rate alerting buy you that a pass/fail line doesn't?
3. You have an end-to-end page-load p95 budget and a suite of 200 noisy micro-benchmarks. Which should block merges, which should alert, which should be trend-only — and why?
4. Why are shared CI runners unacceptable for benchmarking, and what specific machine-level controls make a runner trustworthy?
5. A micro-benchmark gate fired falsely twice a week; the team disabled it; a real 40% regression then shipped. What two distinct mistakes caused this, and what was the correct configuration?
6. A change passed every CI benchmark but a canary caught a 2x p99 regression. Why did CI miss it, and what does this tell you about the role of each defense layer?
7. A VP asks why performance testing costs $120k/year. Build the ROI argument. What do you need to have instrumented to make it?

<details>
<summary>Answers</summary>

1. (a) **No owner who tracked the trend** — assign a named person who reviews the time series, not a team alias. (b) **No consequence for a breach** — the warning was dismissible; make it blocking above a hard ceiling. (c) **The number was editable / no escalation** — require an RFC with sign-off (service owner + budget owner + director) to push past the budget. Each PR looked fine in isolation; only trend ownership + a real consequence catches death-by-a-thousand-cuts.
2. **SLI** = p99 latency over a rolling window; **SLO** = "99% of 1-min windows have p99 ≤ 200 ms"; **error budget** = the allowed 1% over-budget time (~7 hrs/month). Burn-rate alerting distinguishes a tiny regression (slow burn → ticket) from a large one (fast burn → page), and an *exhausted* error budget triggers a freeze on risky merges — turning "perf vs features" into a pre-agreed policy instead of a per-sprint fight.
3. **Block** the page-load p95 budget — it's user-facing and (as a macro-benchmark) stable enough that red is almost always real. **Alert** (non-blocking) on the 200 micro-benchmarks — they're valuable as trend/attribution but too noisy to block without training people to re-run until green. **Trend-only** for any micro-bench that's still unstable or not clearly user-tied. Principle: block only what's user-facing *and* low-noise; a blocking gate's value is its credibility.
4. Shared runners have noisy neighbors, CPU steal, and variable thermal state — noise that can exceed the regression you're hunting. A trustworthy runner is **dedicated/bare-metal (no neighbors)**, **frequency-pinned** (turbo off, `performance` governor), **core-isolated** (`taskset`/`isolcpus`), and the **same machine model forever** so the time series is comparable.
5. Mistake 1: the gate was **blocking on noisy micro-benchmarks** — it should have been alert-only; blocking on noise trains re-run-until-green behavior. Mistake 2: the **noise was tolerated, not fixed at the source** (needed a dedicated runner). Correct config: micro-benches alert (non-blocking) on a dedicated frequency-pinned fleet; only stable user-facing macro-benchmarks block. The flakiness's real damage was getting the gate *deleted*, which let the real regression through.
6. CI used small synthetic datasets where the new code path was fine; the regression only appeared at production data scale / real traffic. The canary runs on **real traffic and real data**, so it caught it. Lesson: CI is a cheap, fast *leading* indicator that's unrepresentative; the canary is the apples-to-apples real-traffic gate before full rollout; RUM/prod SLO is lagging ground truth. No single layer suffices — cheap layers catch the obvious, the canary catches production-only regressions, RUM confirms the promise is kept.
7. Cost: ~$25–35k fleet + ~0.5–1 FTE platform/sheriff time + PR-friction from false positives. Value (counterfactual): **count regressions caught** and estimate their blast radius (e.g., a caught 2x checkout-p99 regression at ~1% revenue / 100 ms is $X/day), and **tally incidents avoided vs slipped**. Frame as insurance sized to exposure. To make the argument you must have *instrumented the catches* — a log of caught regressions with magnitude and estimated impact — otherwise the value is invisible.

</details>

---

## Cheat Sheet

```
MAKE BUDGETS STICK
  named owner (person, not alias)      knows state, drives decisions
  breach → defined responder           first responder = attributed PR author
  change budget → RFC + sign-off       service owner + budget owner + director on record

BUDGET = SLO + ERROR BUDGET
  SLI  measured quantity (p99 over rolling window)
  SLO  "99% of windows p99 <= 200ms"
  error budget burned by regressions; alert on BURN RATE
  exhausted budget → freeze risky merges (the SRE freeze, for perf)

PLATFORM (4 parts)
  dedicated runner fleet   bare-metal, turbo off, governor=performance, core-pinned, same model forever
  result store             every result tagged: SHA + machine + env fingerprint
  dashboard                per-metric time series, every point links to its commit
  alerting + attribution   auto-bisect to one SHA → file bug → assign author

RESPONSE LEVEL  (match metric to level)
  BLOCK      user-facing + rock-stable     (page-load p95, bundle size, cold start)
  ALERT      noisy but useful              (micro-benchmark suite)
  TREND-ONLY long tail / unproven          (sheriff watches steps)
  metrics EARN promotion; DEMOTE on first false positive

HUMAN SIDE
  sheriff rotation (weekly)    someone always watching
  triage: bisect → file → assign → sheriff judges real/expected/tiny/flaky
  FLAKY BENCH → mute NOW, file fix-bench bug   (protect the trust budget)

PRODUCTION GROUND TRUTH
  RUM / prod p99   the real budget (Core Web Vitals, APM p99)
  canary compare   1-5% traffic vs stable, same time/traffic; auto-rollback on p99 breach
  3 layers: CI (leading) → canary (real-traffic gate) → RUM (ground truth)

ROI
  cost: fleet $25-35k/yr + 0.5-1 FTE + PR friction
  value: COUNT catches × blast radius; incidents avoided vs slipped
  size to EXPOSURE: full defense for checkout/browser; trend-only for admin tools
```

---

## Summary

- **Budgets are governance, not math.** A budget needs a **named owner**, a **defined breach consequence with a responder** (first responder = the attributed PR author), and a **sign-off gate to change it** (an RFC with a director on record). Most budgets fail on org design, not statistics.
- **Model a budget as an SLO with an error budget.** Alert on **burn rate**, and let an exhausted budget **freeze risky merges** — the SRE freeze applied to performance, which ends the per-sprint "perf vs features" argument.
- **Continuous benchmarking is infrastructure** with four parts: a **dedicated, frequency-pinned runner fleet** (the foundation — shared CI runners are too noisy), a **result store** keyed by commit, a **dashboard with commit attribution**, and **alerting that auto-bisects to the offending PR**. Buy before you build unless benchmarks are core to the product.
- **Match the response to the metric:** **block** only user-facing, rock-stable budgets; **alert** on noisy micro-benchmarks; **trend-only** for the unproven long tail. A blocking gate's credibility is its whole value — one false positive spends it.
- **Protect the trust budget.** Run a **sheriff rotation**, automate bisect→file→assign, and **mute flaky benchmarks on the first false positive**. Fewer reliable signals beat broad noisy coverage.
- **Production is ground truth.** **RUM/prod p99** is the real budget; CI is a leading indicator. A **canary comparison** on real traffic, with auto-rollback on a p99 breach, is the strongest single safeguard — it catches the production-only regressions no lab can.
- **Justify the cost by instrumenting the catches.** Count avoided incidents and prevented revenue loss, and size the apparatus to the service's exposure.

You can now stand up and *run* a performance-governance program — owned, paged, funded, and trusted — instead of just producing a verdict no one acts on. The remaining tier, [interview.md](interview.md), distills this into the questions that reveal whether someone has actually operated one.

---

## Further Reading

- [Chromium perf regression sheriffing](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/speed/perf_regression_sheriffing.md) and Pinpoint — the canonical sheriff + auto-bisect workflow at scale.
- [Mozilla Perfherder](https://wiki.mozilla.org/EngineeringProductivity/Projects/Perfherder) — result store + dashboard + alerting for a browser-scale suite.
- [Go performance dashboard](https://perf.golang.org) and `benchstat` — a language runtime's continuous-benchmarking story.
- *Site Reliability Engineering* (Google) — SLOs, error budgets, and multi-window burn-rate alerting; the model this page borrows for performance.
- *The Tail at Scale* — Dean & Barroso — why p99 (not p50) is the budget that matters and how it behaves in production.
- [Bencher](https://bencher.dev) and Codspeed — buy-not-build continuous-benchmarking platforms for teams that need ~10% of Chromium's machinery.
- Canary-analysis tooling (e.g., Spinnaker's automated canary analysis / Kayenta) — statistical canary-vs-baseline comparison as a rollout gate.

---

## Related Topics

- [junior.md](junior.md) — what a performance budget is and why a single number on a wiki isn't one.
- [senior.md](senior.md) — stable benchmarks and the statistics (Mann-Whitney U, confidence intervals) behind a trustworthy per-PR verdict.
- [interview.md](interview.md) — the questions that probe whether someone has run a perf-governance program, not just read about one.
- [03 — Latency and Throughput](../03-latency-and-throughput/professional.md) — why lab p99 and production p99 diverge, and the tail-latency thinking the budget is denominated in.
