# Measuring Docs ROI — Senior Level

> **Roadmap:** [Documentation Quality](../README.md) → Measuring Docs ROI
> *The earlier tiers gave you metrics — pageviews, search-success, ticket counts. This page is about the thing those metrics quietly fail at: turning a number into a defensible claim about value. Docs ROI is an observational, confounded, Goodhart-prone estimation problem, and the senior skill is building a model honest enough to survive a CFO's "prove it" — ranges and assumptions, not a single triumphant number.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The ROI Model — Cost Side and Benefit Side](#the-roi-model--cost-side-and-benefit-side)
4. [The Benefit Terms, Quantified](#the-benefit-terms-quantified)
5. [Sensitivity Analysis — Where the Number Actually Lives](#sensitivity-analysis--where-the-number-actually-lives)
6. [The Attribution Problem — Why This Is Observational](#the-attribution-problem--why-this-is-observational)
7. [Causal Identification — Getting Closer to a Real Number](#causal-identification--getting-closer-to-a-real-number)
8. [Proxy Metrics, Goodhart, and Surrogation](#proxy-metrics-goodhart-and-surrogation)
9. [Leading Indicators That Predict the Lagging Outcome](#leading-indicators-that-predict-the-lagging-outcome)
10. [The Qualitative Half — Counterfactuals You Can't Quantify](#the-qualitative-half--counterfactuals-you-cant-quantify)
11. [Presenting ROI Honestly to Leadership](#presenting-roi-honestly-to-leadership)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The measurement methodology and the genuine attribution problem — building an ROI model you can defend, and being rigorously honest about what it can and cannot prove.**

By the middle level you can instrument docs: you track pageviews, time-on-page, search queries with no results, support tickets tagged by topic, and time-to-first-success in onboarding. You can build a dashboard. That makes you useful in a planning meeting.

The senior jump is different. Anyone can produce a number; the senior produces a number that *survives scrutiny*. Three things separate the two. First, a **model** — an explicit chain from docs effort to dollars, with every term named and every assumption written down, so the estimate is auditable rather than asserted. Second, **causal honesty** — the recognition that docs ROI is an *observational* problem (you rarely get to run the clean experiment), that a ticket drop after you shipped a guide is confounded by the product change that shipped the same week, and that "pageviews went up" is not evidence of value. Third, **Goodhart awareness** — the discipline to choose metrics that *resist gaming*, because the moment "docs pageviews" becomes a target, it stops measuring anything real.

This page is that layer: the arithmetic of the ROI model, the causal-inference cautions that keep it honest, and the practice of presenting a *range with assumptions* to leadership instead of a single false-precision figure that the first hard question will demolish.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the metric inventory (ticket deflection, time-to-first-success, search-success, self-service rate) and how to instrument them.
- **Required:** Comfort with [docs coverage and its limits](../04-docs-coverage-and-gaps/senior.md) — you already know "documented ≠ good," which is the same coverage trap one level up.
- **Helpful:** Basic causal-inference vocabulary — confounder, counterfactual, selection bias, A/B test, control group. We'll define them in context, but a working memory helps.
- **Helpful:** You've sat in a budget meeting where someone asked "what did we get for that headcount?" and felt the weight of not having a defensible answer.

---

## The ROI Model — Cost Side and Benefit Side

ROI is a ratio, and the discipline begins by writing it as one. Net value over cost:

```
ROI = (Benefit − Cost) / Cost
```

The point of a model is not the final ratio — it's that every term is *named, sourced, and challengeable*. A number with no model behind it is an opinion with a decimal point. So we decompose both sides until each leaf is something you can actually estimate or measure.

**The cost side is the easy half** — it's mostly labor, and labor you can count.

```
Cost = creation_cost + maintenance_cost + tooling_cost

  creation_cost     = writer_hours × loaded_hourly_rate
                      (+ SME/reviewer hours — engineers pulled in to review)
  maintenance_cost  = update_hours_per_year × loaded_hourly_rate
                      (the recurring tax — docs rot; see ../03-freshness-and-rot-metrics/)
  tooling_cost      = docs platform, search, CI checks, analytics (usually small)
```

Two senior refinements people miss. First, **maintenance is not a footnote** — it is often the *larger* lifetime cost. A guide written once in 8 hours but touched 2 hours a quarter for three years costs 8 + 24 = 32 hours; the creation cost was 25% of the total. Budgeting docs as a one-time creation expense is the single most common costing error, and it's why unmaintained docs proliferate — nobody priced the upkeep. Second, **use a loaded rate**, not salary÷2080. Loaded cost (salary + benefits + overhead + opportunity cost) is typically 1.5–2.5× base; for a senior engineer pulled into doc review, the *opportunity* cost — the feature they didn't ship — often dominates the accounting cost.

**The benefit side is the hard half**, and it's where all the rigor goes. The next section decomposes it term by term; the section after that confronts the fact that these benefits are *estimated against a counterfactual you can't observe*.

> **Key insight:** The deliverable of an ROI exercise is the *model*, not the *number*. A transparent model with honest ranges lets a skeptical reviewer poke at your assumptions and either accept the conclusion or tell you exactly which input they doubt. A bare number invites "I don't believe it" with no way forward. You're building an argument, and the model is its structure.

---

## The Benefit Terms, Quantified

Docs create value by *substituting for more expensive things*: a human answering a question, an engineer interrupting flow to ask, a slow ramp-up. Each substitution is a benefit term. The senior move is to write each as `quantity × unit_value × confidence_factor`, where the confidence factor (∈ [0, 1]) honestly discounts for the attribution uncertainty we'll formalize later.

**Term 1 — Deflected support tickets.** A doc that answers a question that would otherwise have become a ticket saves the fully-loaded cost of handling that ticket.

```
deflection_benefit = tickets_avoided × cost_per_ticket

  cost_per_ticket   = handle_time × loaded_support_rate (+ escalation share)
                      — commonly $15–$50 for tier-1, far more if it escalates to eng
  tickets_avoided   = the hard term — NOT "tickets that dropped" (confounded).
                      Estimate via: deflection surveys ("did this article solve
                      your problem?"), search-to-ticket funnels, or a controlled
                      rollout (see §Causal Identification).
```

The trap is equating `tickets_avoided` with an observed *drop* in ticket volume. That drop is confounded by everything else that changed — a bug fix, a UI redesign, a quieter season. `tickets_avoided` is a *counterfactual* ("how many would have been filed without the doc"), and getting at it honestly requires either a survey instrument or a controlled comparison, not a before/after subtraction.

**Term 2 — Engineer-hours saved by self-service.** When a reader finds an answer in the docs, they *didn't* interrupt a colleague. That avoided interruption has a real, well-studied cost: context-switch recovery, not just the duration of the question.

```
self_service_benefit = reads × P(would_have_asked) × interruption_cost

  reads               = genuine task-oriented reads (not bounces, not bots)
  P(would_have_asked) = fraction who, absent the doc, would have asked a human
                        — the crucial discount; most reads would NOT have become
                        a question. Realistic values are small (0.05–0.20).
  interruption_cost   = asker's time + answerer's time + context-switch tax
                        (the answerer loses far more than the 5-minute answer;
                        flow-state recovery is the dominant term)
```

`P(would_have_asked)` is where naïve models explode. Multiplying *all* pageviews by an interruption cost yields absurd, indefensible totals — the classic "our docs saved $14M" howler that gets you laughed out of the room. Most reads are low-stakes or wouldn't have generated a question at all. Pin this probability with a survey ("if this page hadn't existed, would you have asked someone?") and keep it conservative.

**Term 3 — Faster onboarding.** Good docs shorten time-to-productivity for new hires — a large, real, and *relatively* measurable benefit.

```
onboarding_benefit = new_hires × days_saved × loaded_daily_cost

  days_saved        = reduction in time-to-first-meaningful-contribution
                      (e.g., first merged non-trivial PR), measured against a
                      pre-docs baseline cohort
  loaded_daily_cost = the new hire's loaded cost while ramping (you pay full
                      freight for reduced output) — and arguably the mentor
                      time freed up too
```

Onboarding is the term most worth investing measurement effort in, because cohorts give you a natural comparison: measure ramp time for hires before vs after the onboarding docs landed, ideally controlling for role and team. It's the closest docs ROI gets to a clean signal — though still confounded by hiring-bar drift, team changes, and product complexity over time.

**A worked back-of-envelope.** Suppose a 600-page internal platform doc set: creation 400 hours, maintenance 300 hours/year, at a $150/hr loaded rate.

```
COST (year 1)
  creation     400 h × $150 =  $60,000
  maintenance  300 h × $150 =  $45,000
  Cost ≈ $105,000

BENEFIT (year 1, deliberately conservative)
  deflection   8,000 tickets_avoided × $30           = $240,000
  self-service 200,000 reads × 0.10 × $40            = $800,000
  onboarding   40 hires × 5 days × $1,200            = $240,000
  raw benefit ≈ $1,280,000
  × confidence_factor 0.4 (attribution discount)     ≈ $512,000

ROI ≈ (512,000 − 105,000) / 105,000 ≈ 3.9×  (i.e., ~390%)
```

> **Key insight:** Every benefit term is `quantity × unit_value × confidence`. The *quantities* (reads, tickets, hires) you can often measure. The *unit values* (cost per ticket, interruption cost) you estimate from a handful of inputs. The *confidence factors* encode the attribution problem honestly — and they are exactly where a reviewer will push, which is why they belong in the model explicitly rather than hidden in a hand-wave. The single largest term here (self-service) is also the *least* certain; that asymmetry is the whole game, and it's what sensitivity analysis exposes next.

---

## Sensitivity Analysis — Where the Number Actually Lives

A point estimate of "$512,000" is a lie of precision. The honest object is a *range*, and the tool that produces it — and tells you which assumption to go measure — is **sensitivity analysis**: vary each input across a plausible range, hold the rest, and watch the output move.

Take the self-service term, the model's biggest and shakiest. `P(would_have_asked)` is genuinely uncertain — anywhere from 0.05 to 0.20 is defensible:

```
P(would_have_asked) = 0.05  →  self-service =   $400,000
P(would_have_asked) = 0.10  →  self-service =   $800,000   (base case)
P(would_have_asked) = 0.20  →  self-service = $1,600,000
```

One input swings the largest term by 4×. That is the most important finding in the whole exercise — more important than the base-case number — because it tells you two things: (1) report a *range*, not a point, and (2) the highest-value measurement you could do next is to *pin `P(would_have_asked)` with a real survey*, because it dominates the uncertainty. This is sensitivity analysis doing its actual job: it's a *prioritization tool for measurement effort*, not just error bars.

A **tornado chart** formalizes this — rank each input by how much the output moves when you swing it across its plausible range; the widest bars (the "tornado" shape) are where your uncertainty and your measurement priorities live. For a typical docs model the ranking is reliably: `P(would_have_asked)` and `tickets_avoided` (both counterfactuals) at the top, `reads` and unit costs (both measurable) at the bottom.

The disciplined output is therefore a **scenario table**, not a number:

```
                 Conservative    Base      Optimistic
P(would_ask)        0.05         0.10        0.15
tickets_avoided     5,000        8,000      12,000
confidence_factor   0.3          0.4         0.5
─────────────────────────────────────────────────
Net value (~)      $90k         $407k       $900k
ROI (~)            1.9×         3.9×        9.6×
```

> **Key insight:** Sensitivity analysis converts "I'm not sure" into "here is exactly what I'm not sure about and how much it matters." When the conservative scenario *still clears the bar* (here, 1.9× even on pessimistic inputs), you have a robust decision that doesn't depend on optimism — and that is a far stronger thing to bring to leadership than a fragile point estimate that collapses the moment someone disputes one input. If the conservative scenario goes *negative*, you've learned the investment is a bet, not a sure thing — also worth knowing.

---

## The Attribution Problem — Why This Is Observational

Here is the uncomfortable core, and the thing that separates a senior treatment from a dashboard. **Docs ROI is an observational, not experimental, measurement.** You almost never get to compare a world with the doc against the *same world* without it. You observe one timeline and have to *infer* the counterfactual — and inference from observational data is where careers in statistics go to be humbled.

Three failures recur, and naming them precisely is half the defense.

**Pageviews are not value.** A pageview measures *attention*, not *outcome*. A page with 50,000 views might be heavily visited *because it's confusing* — people bounce back repeatedly, searching for an answer they never find. High traffic on a troubleshooting page can mean the product is broken, not that the doc is succeeding. Traffic is an *input* to value (you can't help someone who never reads), but it's screened off from value by whether the read actually *resolved the task*. Treating views as the benefit is the original sin of docs measurement.

**The post-hoc trap: a ticket drop is confounded.** You ship a guide on Monday; tickets for that topic fall 30% over the next month. Did the guide do it? Maybe. But consider what else changed:

- **Product changes.** The same release that needed the guide may have *fixed the underlying confusion* — the docs and the fix are entangled, and the fix may deserve the credit.
- **Seasonality.** Ticket volume has weekly and yearly rhythms (holidays, fiscal quarters, academic calendars). A "drop" may be the season, not the doc.
- **Concurrent initiatives.** Support hired two people, the in-app tooltips shipped, the onboarding email changed. Any of these confounds the doc's effect.
- **Regression to the mean.** You wrote the guide *because* tickets spiked. Spikes are partly noise; they fall back toward baseline on their own. Acting on an extreme and then crediting the subsequent return-to-normal is one of the most seductive errors in all of metrics.

A **confounder** is a variable that moves both your supposed cause (the doc) and your effect (tickets) — and product changes are the textbook confounder for docs. The naïve before/after subtraction silently *attributes the confounder's effect to the doc*. That's not a small error; it can flip the sign.

**Selection bias in who reads.** The people who find and read your doc are not a random sample — they're the motivated, the self-service-inclined, the ones who'd have solved it anyway. So the readers' good outcomes partly reflect *who they are*, not what the doc did. Comparing readers to non-readers and crediting the gap to the doc overstates the effect, because the groups differ in ways beyond exposure.

> **Key insight:** "Tickets dropped after we shipped docs" is a *correlation in a confounded, observational time series*, and the default scientific stance toward such a claim is skepticism. The senior doesn't pretend the confounding away; they either (a) design a way to break it (next section) or (b) report the correlation *honestly labeled as suggestive, not causal*, and lean on the sensitivity-tested model plus qualitative evidence. Claiming clean causation from a before/after chart is the fastest way to lose credibility with anyone numerate in the room.

---

## Causal Identification — Getting Closer to a Real Number

The attribution problem is hard, not hopeless. There is a hierarchy of methods, roughly ordered by how convincingly they isolate the doc's *causal* effect. A senior reaches for the strongest one the situation allows.

**Gold standard — randomized experiment (A/B or staged rollout).** Randomization is the only thing that *guarantees* the treatment and control groups differ only in exposure, which is what kills confounding by construction. For docs this is more feasible than people assume:

- **A/B test a doc change.** Serve a new version of a page to a random half of visitors, the old to the other half, and compare downstream outcomes — task completion, "did this help?", subsequent ticket filing keyed to a session ID. This is clean and underused for *high-traffic* pages where you get statistical power.
- **Staged / cohort rollout.** Release a new onboarding doc to a random subset of new hires (or one team) and measure ramp time vs the held-back cohort. Randomize *which* cohort gets it first.
- **Holdout cohort.** Deliberately *withhold* the docs from a small random group as a control. Ethically and politically touchy ("we're denying people help"), but for a *new, optional* resource it's defensible and gives you a genuine baseline.

The honest constraints: power (you need enough traffic/hires per arm to detect an effect — small docs for niche features can't be A/B'd meaningfully), and ethics (withholding genuinely useful help is sometimes unacceptable). When you can run one, an experiment beats every observational method combined.

**When you can't randomize — quasi-experimental methods.** These exploit structure in observational data to *approximate* a control.

- **Interrupted time-series (ITS).** Model the ticket trend *before* the doc shipped — including its seasonality and slope — and forecast it forward as the counterfactual. The doc's effect is the gap between the forecast and what actually happened. Critically, ITS lets you *control for release events* by marking them in the model, partially separating the doc's effect from the product change's. Far stronger than a naïve before/after because it accounts for the pre-existing trend and rhythm.
- **Difference-in-differences (DiD).** Compare the change in a *treated* group to the change in an *untreated comparison* group over the same period. If tickets for the documented feature fell 30% while tickets for a *similar undocumented* feature fell 10% (absorbing the seasonality and company-wide effects common to both), the DiD estimate of the doc's effect is ~20 points. The key assumption is *parallel trends* — the two groups would have moved together absent the doc — which you argue from pre-period data, never just assert.
- **Controlling for release events.** Whatever the method, you *must* mark product releases on the timeline and check whether the doc's apparent effect is really a release's effect. A ticket drop that coincides exactly with a bug-fix release should be attributed with extreme caution.

> **Key insight:** There is a *ladder* of evidence — randomized experiment > quasi-experiment (ITS, DiD) controlling for releases > naïve before/after > "pageviews went up." Climb as high as the situation and traffic allow, and *report which rung you're on*. The credibility of your ROI claim is bounded by your causal method, and leadership numerate enough to fund you is numerate enough to ask "how do you know it wasn't the release?" Have the answer before they ask it.

---

## Proxy Metrics, Goodhart, and Surrogation

You can't always measure the outcome you care about (resolved tasks, deflected tickets, dollars), so you reach for a **proxy** that's easier to count (pageviews, 👍 rates, time-on-page). This is necessary — and it's a trap with a name.

**Goodhart's Law:** *when a measure becomes a target, it ceases to be a good measure.* The moment "increase docs pageviews" becomes an OKR, behavior optimizes the *proxy*, and the proxy detaches from the value it was standing in for. The mechanism is **surrogation** — the cognitive substitution where people start optimizing the *metric* as if it *were* the goal, forgetting it was only ever a stand-in.

Concretely, "increase docs pageviews 30%" is a *bad* OKR, and seeing exactly why is the senior skill. Pageviews are trivially gameable in ways that *destroy* the actual goal:

- **Split one good page into five.** Same content, 5× the navigation, pageviews soar — and findability *drops*, the opposite of value.
- **SEO-bait the top of the funnel.** Pull in drive-by traffic that bounces immediately — pageviews up, task-resolution flat or down.
- **Remove the in-page answer to force more clicks.** Bury the resolution one click deeper; pageviews rise, user success falls.

Every one of these *moves the metric the wrong way relative to value*. That's the signature of a Goodhart-vulnerable target: the cheapest way to hit it is *not* the way that creates value. The 👍/👎 helpfulness rate is similarly soft — it's subject to extreme non-response bias (only the angry and the delighted click), is easily nudged by button placement, and measures *momentary sentiment*, not whether the task got done.

The defense is not "never use proxies" — you have to. The defense is:

1. **Never make a gameable proxy a *target*.** Measure pageviews; don't *incentivize* them. The instant a metric has someone's bonus attached, assume it will be gamed and ask "what's the cheapest way to hit this without creating value?"
2. **Pair every proxy with a *guardrail* outcome metric** that catches the gaming. Pageviews paired with *search-success rate* and *task-completion*: if views rise while task-completion falls, you're surrogating, and the pairing exposes it.
3. **Prefer proxies that are *causally closer* to the outcome** and harder to game (next section).

> **Key insight:** Goodhart is not cynicism about people — it's structural. *Any* single metric under optimization pressure drifts from its goal, because optimization finds the cheapest path to the number and the cheapest path is rarely the valuable one. The senior posture is to (a) keep the *value* outcome as the real goal, (b) use proxies for *visibility* but never as *targets*, and (c) always pair a proxy with a guardrail that goes red when the proxy is being gamed. "Increase pageviews" fails all three; "improve task-completion, with pageviews and search-success as guardrails" passes.

---

## Leading Indicators That Predict the Lagging Outcome

The outcome you ultimately care about — deflected tickets, time-to-productivity, retained customers — is a **lagging indicator**: it arrives weeks or months late and is heavily confounded. To *steer* docs work you need **leading indicators**: faster signals that *predict* the lagging outcome. The senior discipline is choosing leading indicators that are *genuinely predictive*, not merely *available*.

The test for a good leading indicator is empirical: **does it actually correlate with the lagging outcome you care about?** Raw traffic mostly fails this test; task-level signals mostly pass it.

| Leading indicator | Predicts | Why it's better than pageviews |
|---|---|---|
| **Search-success rate** (searches that lead to a click + no immediate re-search) | Ticket deflection | A failed search is a near-certain future ticket; this catches gaps *before* they become tickets |
| **Task-completion rate** (started a tracked flow → finished it) | Self-service value | Measures *outcome*, not attention; resists the split-the-page gaming |
| **Zero-result search rate** | Coverage gaps → tickets | Directly names the missing docs; a strong forward signal (ties to [04 — coverage and gaps](../04-docs-coverage-and-gaps/senior.md)) |
| **Time-to-first-success** in a guided flow | Onboarding ramp | Early, per-task proxy for the slow "time-to-productivity" lagging metric |
| **Bounce-with-immediate-ticket** (read a page, then filed a ticket on that topic) | Doc *failure* | A direct, damning signal that the doc didn't deflect |

Why search-success and task-completion beat raw traffic, specifically: they're measured at the level of an *individual task with a binary outcome*, which is causally one short step from value (a completed task is *almost* a deflected ticket), and they're *hard to game without actually helping* — you can't fake a higher task-completion rate by splitting pages or buying traffic; the only path to the number is making the task succeed. Raw pageviews are two long, confounded steps from value and gameable a dozen ways. That difference — *causal proximity* and *game-resistance* — is exactly what makes one a real leading indicator and the other a vanity metric.

> **Key insight:** A leading indicator earns its place by *predictive validity* — you should be able to point to evidence (even a correlation across pages or over time) that it forecasts the lagging outcome. "It's the number our tool gives us" is not predictive validity. Search-success and task-completion qualify because each maps to a *task with an outcome*; pageviews don't because attention is not outcome. Steer on the leading indicators that pass the test, validate them against the lagging outcome periodically, and demote any that stop predicting.

---

## The Qualitative Half — Counterfactuals You Can't Quantify

Some of the highest-value documentation produces benefits that are *fundamentally* unquantifiable — not "hard to measure," but resistant *in principle* — and pretending otherwise is its own failure of rigor. The senior holds two ideas at once: be quantitative where you can, and be *honestly qualitative* where you can't, rather than fabricating numbers for things that don't have them.

The canonical example: **the architecture document that prevented a bad decision.** A well-written design doc or ADR causes a team to *not* build the wrong thing — to catch the scaling flaw at design time, to reuse a service instead of duplicating it, to avoid a migration that would have failed. The value is enormous and the evidence is a *counterfactual that never happened*: there is no ticket, no traffic spike, no metric, because the disaster was *averted*. You cannot put a credible point-value on "the outage we didn't have." The events that *prove* the doc's value are, by construction, the events that *didn't occur*.

This is where **narrative and counterfactual evidence legitimately belong** in an ROI case — not as a consolation prize for missing data, but because for these benefits *narrative is the most accurate available evidence*:

- **Documented decision reversals.** "In the Q3 design review, the team was about to build a custom queue; the platform ADR pointed them to the existing one, saving an estimated quarter of work." This is a counterfactual, but a *specific, sourced, auditable* one — far more credible than a fabricated dollar figure.
- **Structured testimony.** Survey or interview senior engineers: "name a time docs changed a decision or prevented rework." Aggregate the stories. *n* of these, each plausible, is genuine evidence — the same way a doctor's case series is evidence even without a randomized trial.
- **Incident retros that cite (or indict) docs.** A postmortem noting "the runbook let us resolve this in 10 minutes instead of an hour" is causal evidence captured at the moment of value, with a built-in comparison to the no-doc world.

The rigor in qualitative evidence is *specificity and honesty about the counterfactual*, not false precision. "Several senior engineers independently cited the architecture docs as having prevented significant rework, with two naming specific avoided projects" is a *defensible* claim. "The architecture docs saved $2.3M" is a fabricated one that invites — and deserves — challenge.

> **Key insight:** Not everything that counts can be counted, and the senior failure mode is *forcing* a number onto a counterfactual that doesn't support one. The architecture doc that prevents a bad decision generates value precisely as the *absence* of a disaster — and absences leave no quantitative trace. For those benefits, specific, sourced, counterfactual *narrative* is not a weaker form of evidence; it is the *most accurate* form available, and presenting it as such is more rigorous than inventing a dollar figure.

---

## Presenting ROI Honestly to Leadership

The final senior skill is *communication under scrutiny*. You're presenting to people who allocate budget and who have seen every flavor of inflated metric. The way you present determines whether the work gets funded *and whether you keep your credibility for next time* — and credibility compounds.

**Lead with a range and its driver, not a point.** "We estimate docs returned 2–6× last year; the range is driven mostly by how many reads would otherwise have become questions, which we're measuring more precisely next quarter." This does three things at once: it's *honest* (ranges, not false precision), it *front-runs the hardest question* (the biggest uncertainty, named before they find it), and it *shows a path to a better number*. A single figure — "docs returned 4.1×" — invites "I don't believe that," and you have nowhere to go.

**State assumptions as first-class content, not fine print.** Put the key inputs and their ranges on the slide: cost per ticket, `P(would_have_asked)`, the confidence factor, the causal method. When a reviewer disputes one — and they will — you say "agreed that's uncertain; here's the conservative scenario where we drop it, and we *still* clear the bar." A model with visible assumptions turns an adversarial "prove it" into a *collaborative* "which input should we tighten?"

**Be explicit about the causal method and its limits.** "This is a difference-in-differences estimate against an undocumented comparable feature, controlling for the March release — so it's quasi-experimental, not a clean A/B. We're A/B-testing the high-traffic pages next." Naming the rung you're on *pre-empts* the "how do you know it wasn't the release?" question and signals that you understand the difference between correlation and causation — which is itself credibility.

**Separate the quantified from the narrative, and label each honestly.** "Quantified benefits net to a conservative 2× on tickets and onboarding alone. Separately — and not in that number — multiple senior engineers cite the architecture docs as having prevented specific, costly rework; we report that as qualitative evidence rather than forcing a figure onto it." Mixing a fabricated dollar value for the architecture doc *into* the quantified total is exactly what destroys trust; keeping them separate and labeled is what builds it.

**Tie the ask to the sensitivity finding.** The most persuasive close isn't the ROI number — it's "the biggest uncertainty is `P(would_have_asked)`; fund the survey and we'll replace this range with a measured number." That reframes the conversation from *defending* a figure to *investing in a better one*, which is a posture leadership respects.

> **Key insight:** Honesty is the *strategically* correct choice, not just the ethical one. A defensible range with visible assumptions survives the hard question; a fragile point estimate dies on it — and takes your credibility with it. The engineer who says "2–6×, here's exactly what I'm unsure about, and here's how I'll narrow it" gets funded *and* gets believed next time. The one who claims "4.1×, trust me" gets one good meeting and a reputation for inflation. False precision is a loan against your credibility, and the rate is brutal.

---

## Mental Models

- **The deliverable is the model, not the number.** A bare figure is an opinion with a decimal point. A transparent model — every term named, sourced, and challengeable — is an *argument* a skeptic can engage with. Build the argument; the number falls out.

- **Every benefit is `quantity × unit_value × confidence`.** Quantities you measure, unit values you estimate from a few inputs, and confidence factors encode the attribution uncertainty *explicitly* — so the place a reviewer will push is *in the model*, not hidden in a hand-wave.

- **Docs ROI is observational, and observation is confounded.** You see one timeline and infer the counterfactual. A ticket drop after a doc ships is correlation in a confounded series — the product change that shipped the same week is the textbook confounder. Skepticism is the correct default; breaking the confounding (or honestly labeling it) is the work.

- **Climb the evidence ladder and report your rung.** Randomized experiment > quasi-experiment (ITS/DiD, controlling for releases) > naïve before/after > "pageviews went up." Your ROI claim is only as credible as the rung you're standing on, so name it.

- **Any metric under optimization pressure drifts from its goal (Goodhart).** Optimization finds the *cheapest* path to the number, which is rarely the valuable path. Use proxies for visibility, never as targets, and pair each with a guardrail that goes red when it's gamed.

- **Causal proximity and game-resistance make a leading indicator real.** Search-success and task-completion are one short, hard-to-fake step from value; pageviews are several confounded, easily-gamed steps away. Steer on the former.

- **Absences leave no quantitative trace.** The architecture doc that prevents a disaster produces value as the *non-occurrence* of the disaster — uncountable by construction. For those, specific sourced narrative is the *most accurate* evidence, not a weaker substitute.

---

## Common Mistakes

1. **Reporting a point estimate instead of a range.** "$512,000" implies a precision the model doesn't have. The honest object is a scenario table; the most important output is often the *width* of the range and which input drives it — not the base case.

2. **Equating an observed ticket *drop* with `tickets_avoided`.** The drop is confounded by product changes, seasonality, and regression to the mean. `tickets_avoided` is a *counterfactual* requiring a survey or a controlled comparison — never a before/after subtraction.

3. **Multiplying *all* pageviews by an interruption cost.** This is the "docs saved $14M" howler. Most reads would never have become a question; you must discount by `P(would_have_asked)`, which is small (0.05–0.20) and dominates the model's uncertainty.

4. **Treating pageviews as value — or worse, as a target.** Traffic is attention, not outcome (a confusing page gets *more* views). Made an OKR, "increase pageviews" is gamed by splitting pages and SEO-baiting — both of which *reduce* actual value. Classic Goodhart.

5. **Claiming causation from a before/after chart.** "Tickets fell after we shipped docs" is a confounded correlation. Without controlling for concurrent releases (ITS/DiD) you may be crediting the doc for a bug fix's effect — and you'll be caught by the first numerate reviewer.

6. **Budgeting docs as a one-time creation cost.** Maintenance is often the *larger* lifetime cost. Pricing only creation is why unmaintained, rotting docs proliferate — nobody costed the upkeep (see [03 — freshness and rot](../03-freshness-and-rot-metrics/senior.md)).

7. **Forcing a dollar figure onto unquantifiable value.** The architecture doc that prevented a bad decision has no metric — the disaster didn't happen. Inventing "$2.3M" for it invites and deserves challenge; specific sourced *narrative* is the more rigorous evidence.

8. **Mixing the narrative benefit into the quantified total.** Folding a fabricated value for the prevented-disaster doc into the headline ROI number is what destroys trust. Keep quantified and qualitative *separate and labeled*.

---

## Test Yourself

1. Write the docs ROI ratio and decompose the *cost* side. Why is maintenance the term people most often omit, and why does omitting it matter?
2. The self-service benefit is `reads × P(would_have_asked) × interruption_cost`. What does `P(would_have_asked)` represent, why is it the dangerous term, and roughly what range is defensible?
3. A team ships a troubleshooting guide; tickets for that topic fall 25% the next month. Name three reasons this is *not* clean evidence the guide caused the drop.
4. You want a credible causal estimate but can't run a clean A/B test. Name two quasi-experimental methods and what each controls for.
5. "Increase docs pageviews 30%" is proposed as a quarterly OKR. Explain why it's a bad target using Goodhart and surrogation, and give two ways it can be hit *without* creating value.
6. Why are search-success rate and task-completion better *leading* indicators than raw pageviews? Give the two properties that make a leading indicator trustworthy.
7. How would you represent the ROI of an architecture doc that prevented a costly bad decision, given there's no metric for it — and why is that representation *more* rigorous than estimating a dollar value?
8. You're presenting docs ROI to a skeptical CFO. State the one structural choice (about *how* you present the number) that most protects both the funding decision and your credibility.

<details>
<summary>Answers</summary>

1. `ROI = (Benefit − Cost) / Cost`. Cost ≈ `creation (writer_hours × loaded_rate, + SME review) + maintenance (update_hours/yr × loaded_rate) + tooling`. **Maintenance** is omitted because docs are mentally filed as a one-time creation expense — but upkeep is recurring and often *exceeds* creation over a doc's life (8h to write, 24h to maintain over 3 years). Omitting it under-costs docs, which is precisely why unmaintained, rotting docs proliferate: nobody budgeted the tax.

2. `P(would_have_asked)` is the fraction of readers who, *absent the doc*, would have interrupted a colleague — the counterfactual conversion from "read" to "avoided question." It's dangerous because multiplying *all* reads by an interruption cost yields absurd, indefensible totals; most reads would never have become a question. Defensible range is small, ~**0.05–0.20**, and it should be pinned with a survey because it dominates the model's uncertainty.

3. (a) **Product changes / confounding** — the same release may have *fixed* the underlying confusion, and the fix (not the doc) deserves credit. (b) **Seasonality** — ticket volume has weekly/yearly rhythms; the drop may be the calendar. (c) **Regression to the mean** — you wrote the guide *because* tickets spiked, and spikes are partly noise that falls back to baseline on its own. (Also acceptable: concurrent initiatives, selection bias in readers.)

4. **Interrupted time-series (ITS)** — model the pre-doc trend *including seasonality and slope*, forecast it as the counterfactual, and take the gap; lets you *mark and control for release events*. **Difference-in-differences (DiD)** — compare the treated feature's change to an *undocumented comparable* feature's change over the same period, absorbing company-wide/seasonal effects common to both; key assumption is *parallel trends*, argued from pre-period data.

5. Goodhart: when a measure becomes a target it stops measuring what it stood for; **surrogation** is people then optimizing the *proxy* as if it were the goal. Pageviews are attention, not value, and the cheapest path to +30% is *not* the valuable path. Two value-destroying ways to hit it: (a) **split one good page into five** — views 5×, findability *drops*; (b) **SEO-bait drive-by traffic** that bounces, or **bury the in-page answer** to force extra clicks — views up, task-success flat or down. Pair any proxy with a guardrail (search-success, task-completion).

6. Both are measured at the level of an *individual task with a binary outcome*, so they're (i) **causally close to value** — a completed task is *almost* a deflected ticket, one short step away — and (ii) **hard to game without actually helping** — you can't fake higher task-completion by splitting pages or buying traffic; the only path is making the task succeed. Pageviews are several confounded steps from value and gameable many ways. The two trustworthy properties: *causal proximity* and *game-resistance* (plus demonstrated predictive validity against the lagging outcome).

7. Represent it with **specific, sourced, counterfactual narrative**, kept *separate from and not folded into* the quantified total — e.g., "in the Q3 review the architecture ADR steered the team off a custom queue toward the existing one, an estimated quarter of work avoided," plus aggregated structured testimony from senior engineers and incident retros. It's *more* rigorous than a dollar figure because the value exists as the *absence of a disaster* that left no quantitative trace; a fabricated "$2.3M" asserts a precision the evidence can't support, while the specific counterfactual is auditable and honest about what kind of evidence it is.

8. **Lead with a range and its driving assumption, not a point estimate** (e.g., "2–6×, driven mostly by `P(would_have_asked)`, which we're measuring next"). A range with visible assumptions survives the inevitable "prove it" — you retreat to the conservative scenario that still clears the bar — whereas a single figure dies on the first hard question and takes your credibility with it. (Also strong: state the causal method and its limits up front; keep quantified and narrative evidence separate and labeled.)

</details>

---

## Cheat Sheet

```
THE MODEL
  ROI = (Benefit − Cost) / Cost          ← deliverable is the MODEL, not the number
  Cost = creation + maintenance + tooling   (maintenance often > creation; loaded rate)
  Each benefit term = quantity × unit_value × confidence_factor[0..1]

BENEFIT TERMS
  deflection   = tickets_avoided × cost_per_ticket        ($15–50/ticket tier-1)
  self-service = reads × P(would_have_asked) × interruption_cost
                 ↑ P(would_have_asked) ≈ 0.05–0.20  — the dangerous, dominant term
  onboarding   = new_hires × days_saved × loaded_daily_cost   (most measurable: cohorts)

SENSITIVITY (the real output)
  Vary each input across its plausible range → scenario table (Cons/Base/Optimistic)
  Tornado chart: widest bars = biggest uncertainty = where to measure NEXT
  If the CONSERVATIVE scenario still clears the bar → robust decision

ATTRIBUTION (it's OBSERVATIONAL)
  pageviews ≠ value          (attention, not outcome; confusing pages get MORE views)
  ticket drop ≠ doc effect   confounders: product change, seasonality, regress-to-mean
  selection bias: readers ≠ random sample

EVIDENCE LADDER (climb as high as possible, REPORT YOUR RUNG)
  A/B test / staged rollout / holdout cohort   ← gold standard (randomized)
  > ITS / DiD, controlling for release events  ← quasi-experimental
  > naïve before/after                          ← weak, confounded
  > "pageviews went up"                         ← not evidence

GOODHART / SURROGATION
  measure becomes target → stops measuring value (optimize proxy ≠ optimize outcome)
  "increase pageviews" = BAD OKR (split pages / SEO-bait / bury answer all game it)
  rule: proxy for VISIBILITY, never as TARGET; pair with a guardrail outcome metric

LEADING INDICATORS THAT PREDICT (causally close + game-resistant)
  search-success, task-completion, zero-result-rate, time-to-first-success
  > raw traffic   (validate predictive validity against the lagging outcome)

PRESENTING
  range + driving assumption, not a point   |   assumptions as first-class content
  name the causal method + its limits        |   separate & label quantified vs narrative
  tie the ask to the sensitivity finding ("fund the survey, get a measured number")
```

---

## Summary

- **The deliverable is the model, not the number.** ROI = (Benefit − Cost)/Cost, with every term *named, sourced, and challengeable*. A transparent model survives scrutiny; a bare figure is an opinion with a decimal point.
- **Cost is the easy half** (creation + maintenance + tooling, loaded rate) — and **maintenance is often the larger lifetime cost**, the term people most fatally omit. **Benefit is the hard half**: deflection, self-service, and onboarding, each written as `quantity × unit_value × confidence`.
- **`P(would_have_asked)` is the dangerous term** — multiplying *all* reads by an interruption cost produces the "$14M" howler; keep it small (0.05–0.20) and survey-pinned.
- **Sensitivity analysis is the real output** — vary each input, build a scenario table, find which assumption dominates (the tornado). If the *conservative* scenario still clears the bar, the decision is robust; the widest-uncertainty input is your next measurement.
- **Docs ROI is observational, not experimental** — pageviews are attention not value, and a ticket drop is confounded by product changes, seasonality, and regression to the mean. Climb the **evidence ladder** (A/B > ITS/DiD controlling for releases > before/after > "views went up") and *report your rung*.
- **Goodhart and surrogation** make any optimized metric drift from its goal; "increase pageviews" is a bad OKR because the cheapest way to hit it (splitting pages, SEO-bait) *destroys* value. Use proxies for visibility, never as targets, and pair each with a guardrail.
- **Choose leading indicators by causal proximity and game-resistance** — search-success and task-completion predict deflection; raw traffic doesn't.
- **The qualitative half is real** — the architecture doc that prevents a disaster has no metric because the disaster didn't happen; *specific, sourced, counterfactual narrative* is the most accurate evidence, kept separate from the quantified total.
- **Present honestly** — a range with visible assumptions and a named causal method survives the CFO's "prove it"; false precision is a loan against your credibility at a brutal rate.

ROI measurement is, at root, applied causal inference on a confounded, Goodhart-prone observational system — and the senior skill is being *rigorously honest* about exactly that. The next layer — [professional.md](professional.md) — is about operating this measurement as a standing program: instrumenting it across an org, running the experiments continuously, and defending the docs budget every cycle.

---

## Further Reading

- *Trustworthy Online Controlled Experiments* — Kohavi, Tang & Xu. The practitioner's bible on A/B testing, control groups, and the traps of observational comparison; everything in §Causal Identification, deeper.
- *How to Measure Anything* — Douglas Hubbard. The case that "unmeasurable" usually means "not yet decomposed"; calibrated estimation, ranges over points, and the value-of-information argument behind sensitivity analysis.
- *The Tyranny of Metrics* — Jerry Z. Muller. Goodhart and surrogation in the wild — how target-driven metrics corrupt the activities they measure, across many fields.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the chapter on measuring documentation; the practical metric inventory this page builds the model on top of.
- Google's "[How to measure documentation quality](https://developers.google.com/tech-writing)" / Tom Johnson's *I'd Rather Be Writing* on docs metrics — the industry conversation on deflection, leading indicators, and the limits of analytics.
- *Mostly Harmless Econometrics* — Angrist & Pischke. Difference-in-differences, the parallel-trends assumption, and quasi-experimental identification, rigorously — for when you want the math under ITS/DiD.

---

## Related Topics

- [04 — Docs Coverage & Gaps](../04-docs-coverage-and-gaps/senior.md) — zero-result searches and coverage gaps are the *leading indicators* that feed the deflection term of this model.
- [01 — What Makes Docs Good](../01-what-makes-docs-good/senior.md) — the quality attributes whose *value* this page tries to price; ROI is the dollars-and-cents shadow of "good."
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/senior.md) — the *maintenance* cost term made concrete: rot is what you're paying to prevent.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the same discipline one level up: leading vs lagging indicators, Goodhart, and the difference between measuring and gaming an engineering org.
