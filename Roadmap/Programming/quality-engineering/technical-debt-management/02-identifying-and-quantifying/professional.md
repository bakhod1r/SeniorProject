# Identifying & Quantifying — Professional Level

> **Roadmap:** [Technical Debt Management](../README.md) → [Identifying & Quantifying](./) → Professional
> *The senior page taught you to read a hotspot map and price a single piece of debt. This page is about running measurement as an org practice — turning those numbers into a dashboard leadership trusts, an ROI model finance funds, and a metric that survives contact with the people it measures. Because the moment a debt number becomes a target, someone starts gaming it, and a measurement program that goes dishonest is worse than none at all.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Building Org-Wide Debt Visibility](#building-org-wide-debt-visibility)
4. [The Debt Dashboard — Signals, Not Vanity Metrics](#the-debt-dashboard--signals-not-vanity-metrics)
5. [The Politics of Measurement — Who Owns the Number](#the-politics-of-measurement--who-owns-the-number)
6. [Goodhart in Practice — Every Debt Metric Gets Gamed](#goodhart-in-practice--every-debt-metric-gets-gamed)
7. [From Measurement to an ROI Model Leadership Funds](#from-measurement-to-an-roi-model-leadership-funds)
8. [Connecting Debt Signals to Business Outcomes](#connecting-debt-signals-to-business-outcomes)
9. [When a Measurement Program Backfires](#when-a-measurement-program-backfires)
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

> Focus: **Running debt measurement as a durable organizational practice, and using the numbers to drive funding and roadmap decisions — without the metric corrupting the work it measures.**

The senior page made you fluent in the signals: churn × complexity hotspots, SQALE remediation cost, the lead-time and defect trails debt leaves. You can look at one file and argue, with numbers, that it's worth fixing. That's an individual skill.

At the professional level the question changes from *"can I measure this debt?"* to *"can I run measurement across forty teams, surface it where decisions get made, and keep the number honest for two years?"* — and that is a fundamentally different, mostly *political* problem. The hard parts are no longer statistical. They are: who owns the number when it looks bad; what happens the day a VP puts "reduce technical debt 20%" in a performance review; how you turn a complexity trend into dollars a CFO will fund; and how you keep the whole apparatus from quietly going dishonest the moment it becomes a target.

This page is the pragmatic, battle-tested layer. The recurring theme is **Goodhart's Law** — *"when a measure becomes a target, it ceases to be a good measure"* — because every debt metric, without exception, gets gamed once someone's quarter depends on it. The senior skill is producing the number. The professional skill is building a measurement program that drives good decisions *and resists its own corruption*.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — hotspots, churn × complexity, SQALE/SonarQube remediation cost, reading the lead-time and defect signals for one codebase.
- **Required:** You've owned a metric that someone above you cared about, and watched a team optimize for the number instead of the goal.
- **Helpful:** You've sat in a roadmap or funding meeting and tried to argue for non-feature work — and lost.
- **Helpful:** Familiarity with [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — lead time, deployment frequency, change-failure rate, MTTR — because the debt dashboard borrows their outcome signals.

---

## Building Org-Wide Debt Visibility

A one-off debt audit is a slide deck that's stale the week after the offsite. An *org practice* is a continuously-updated, trended view that's already on the screen when planning happens. The difference is the difference between "we did a debt assessment in Q1" and "debt is a standing input to every quarterly plan." Only the second one changes decisions.

Three things make visibility organizational rather than personal:

**1. Hotspot maps surfaced in planning, not buried in a tool.** The senior tier taught you to *compute* a hotspot (high churn × high complexity = the code that's both messy and changing). The professional move is to put that map *in front of the people writing the roadmap*, every quarter, ranked. When a planning team sees that the file they're about to build three features on top of is the #1 hotspot — top-decile churn, cyclomatic complexity of 80, the source of 40% of last quarter's incidents in that service — the conversation about sequencing changes on its own. You're not asking for a "refactoring sprint." You're showing them the load-bearing wall they're about to hang more weight on.

**2. Complexity *trends*, not snapshots.** A single complexity number is almost useless for decisions — is 2,400 weighted-complexity-points good or bad? Nobody knows. The *slope* is what's actionable: "this service's complexity has risen 30% over two quarters while its team size held flat" is a leading indicator that lead time is about to degrade. Trend lines turn a static, arguable number into a *direction*, and direction is what triggers action. Track it per service, plot it against headcount and feature output, and the early-warning signal emerges.

**3. Debt as a tracked, trended metric — not a periodic audit.** The audit model fails for a structural reason: it produces a number at a point in time, divorced from the flow of work, owned by no one, and obsolete before it's socialized. The metric model wires debt signals into the same dashboards the org already watches, refreshed automatically, so the trend is *always current* and *always visible*. The audit asks "how bad is it?" once. The metric answers "which way is it moving, and where?" continuously. Leadership funds trends they can watch; they ignore audits they have to remember.

> **The visibility principle:** debt that isn't *trended and surfaced where decisions are made* might as well not be measured. The goal of org-wide visibility isn't a comprehensive number — it's that the right map is on the screen at the moment someone is about to make a sequencing decision they'd make differently if they could see the debt.

---

## The Debt Dashboard — Signals, Not Vanity Metrics

A debt dashboard earns its place only if it's tied to **outcomes leadership already cares about**. A panel showing "total remediation cost: 412 days" is a vanity metric — it's big, it's scary, and it drives no decision, because nobody believes you'll spend 412 days and nobody can tell if 412 is better or worse than last quarter. A dashboard that *works* pairs debt signals with the delivery outcomes they predict, so the debt number becomes the *explanation* for a number leadership is already anxious about.

The structure that survives executive scrutiny has three layers:

| Layer | Example signals | Why it's there |
|---|---|---|
| **Debt signals (causes)** | Hotspot count & rank, complexity trend slope, SQALE debt-ratio per service, churn concentration (% of changes in top-10 files), test-coverage on hotspots | The leading indicators — the *internal* state of the code |
| **Delivery outcomes (effects)** | Lead time for changes, change-failure rate, MTTR, deployment frequency (the DORA four) | The *external* symptoms leadership already tracks and funds |
| **Business outcomes (the bridge)** | Feature throughput trend, incident count & cost, time-to-market for a flagship feature, security-finding age | The language the CFO and CPO actually speak |

The dashboard's power comes from putting cause and effect on the **same screen, correlated over time**. "Lead time in the Payments service rose 60% over three quarters" is a problem leadership feels. Overlay "and the Payments hotspot complexity rose 45% over the same window, with 70% of changes concentrated in three files" and you've turned an unexplained slowdown into a *fundable diagnosis*. The debt panel stops being an engineering vanity board and becomes the root-cause annotation on a business-metric chart.

Concrete signals that belong on it, and what each one *tells a decision-maker*:

- **Lead-time-for-changes, split by service.** The single most decision-useful debt symptom. When one service's lead time diverges sharply from the rest, that's where the debt tax is being paid — and it points at *where*, which an aggregate org number never does.
- **Change-failure-rate on hotspot files.** If the files you've flagged as debt are also the files where deploys break, you've closed the loop from "messy" to "expensive" — and that correlation is your funding argument.
- **% of engineering time in top-N hotspots.** Pull from commit data: if 35% of all changes touch 5% of the files, that concentration *is* the debt cost, expressed as where the effort actually goes.
- **Hotspot trend (count entering/leaving the danger zone).** Are you creating hotspots faster than you retire them? This is the "are we winning or losing?" number — the one that tells you whether your *prevention* (see [06 — Preventing Accumulation](../06-preventing-accumulation/professional.md)) is working.
- **Security-finding age on critical-path code.** Old, unremediated findings clustered in a hotspot are debt with a CVE clock — the panel that gets security and engineering funding aligned.

> **The dashboard test:** for every panel, ask *"what decision changes if this number moves?"* If the honest answer is "none — it's just big," it's a vanity metric and it's diluting the dashboard. A debt dashboard is a **decision instrument tied to delivery and business outcomes**, not a guilt meter. The first panel that exists only to look impressive is the one that teaches leadership to stop looking at the whole thing.

---

## The Politics of Measurement — Who Owns the Number

The instant debt becomes a *measured, visible* number, it becomes *political*, and pretending otherwise is the fastest way to get a measurement program killed. Three political questions decide whether your program survives:

**Who owns the number?** A debt metric needs an owner who is accountable for the *trend* but *not punished for the absolute level*. This is a razor's edge. If the platform team "owns debt," they get blamed for debt created by feature teams shipping under deadline — so they either stop measuring honestly or stop caring. If *no one* owns it, the trend drifts and the dashboard rots. The durable arrangement: a central function (platform / eng-effectiveness) owns the *measurement system and the org-level trend*; individual teams own their *own* service's trend; and **nobody** is rewarded or punished for the raw level, only for the direction and for honest reporting. The number is a thermostat the org reads together, not a scorecard one team is graded on.

**What happens when the number looks bad?** This is the real test, and it usually arrives in the first quarter. If a service's debt spikes and the response is to question the team or demand it be "fixed by next quarter," you have just taught every team in the org to stop surfacing debt. The *correct* response to a bad number is *curiosity, then resourcing* — "why did Payments' complexity jump? Oh, we shipped the regulatory deadline by cutting corners we consciously chose — let's schedule the paydown" (a deliberate-prudent entry; see [03 — The Debt Quadrant](../03-the-debt-quadrant/)). The number going up should make it *easier* to get paydown funded, not riskier to report. The first time a high number is punished, your data quality dies — quietly, irreversibly, and you won't find out until you're making decisions on fiction.

**Never tie a debt metric to individual performance.** This is the cardinal rule, and it's non-negotiable for a reason that's mechanical, not moral: the *purpose* of debt measurement is to get an *honest* picture so the org can make good resourcing decisions. The moment "debt reduced" appears in a performance review or a team OKR with teeth, the metric's purpose silently shifts from *honesty* to *looking good*, and those two goals are in direct conflict. You will get the number you incentivized and lose the truth you needed. A debt metric is a *diagnostic instrument for the organization*, in the same category as a thermometer — and you don't grade the nurse on whether the patient's temperature is low.

> **The political reality:** the technical work of measuring debt is the easy 20%. The 80% is building a *social contract* where the number can look bad without anyone getting hurt, because that's the only condition under which the number stays *true*. A debt program with great tooling and a punitive culture produces beautiful, worthless data. A program with crude tooling and a blameless contract produces ugly, *actionable* data. Choose the second every time.

---

## Goodhart in Practice — Every Debt Metric Gets Gamed

Goodhart's Law — *"when a measure becomes a target, it ceases to be a good measure"* — is not a cynical aphorism here; it is the single most reliable thing that will happen to your debt program, and you should plan for it the way you plan for hardware failure: as a certainty, not a risk. The specific, predictable ways each common debt metric gets gamed:

| Metric made a target | How it gets gamed | What you actually lost |
|---|---|---|
| **Code coverage %** | Tests that execute lines but assert nothing (`assert True`), or trivial getter/setter tests to pad the percentage | Coverage rises, *defect-catching* falls — you've incentivized test *theater*, and now the green number actively lies |
| **SonarQube issue count → zero** | Bulk "won't fix" / suppression annotations; tuning the ruleset down until the count drops; `// NOSONAR` sprinkled liberally | Issues "resolved" without code changing; the linter is now decorative |
| **Cyclomatic complexity per function** | Splitting one 60-complexity function into six 10-complexity functions that are *more* tangled together (complexity moved, not removed) | Per-function metric looks great; the *system* is harder to follow — you optimized the measurement, not the design |
| **"Debt score" / debt ratio** | Reclassifying debt tickets as "tech improvements," closing debt tickets as "won't do," gaming the remediation-cost estimate downward | The score drops; the debt is still there, now *invisible* and unlabeled |
| **Number of debt tickets closed** | Splitting one real fix into many tickets; closing stale tickets en masse; logging trivial debt to pad throughput | High closure rate, no improvement in the outcomes that matter |

The pattern underneath all of these: **a proxy is cheaper to move than the thing it proxies.** Coverage is a proxy for "well-tested"; it's cheaper to add empty tests than real ones. Issue count is a proxy for "clean"; it's cheaper to suppress than to fix. Every debt metric is a *proxy* for an unmeasurable true quality, and under pressure people optimize the proxy, because that's what they're graded on and it's less work. This isn't malice — it's the rational response to a target, and *you* created the incentive.

Defenses that actually hold up:

- **Measure trends and *outcomes*, not absolute proxies.** Coverage-as-a-target gets gamed; "change-failure-rate is falling" is far harder to fake because it's an *outcome*, not a proxy you control directly. Anchor on effects (DORA outcomes) and use the internal proxies (coverage, complexity) only as *diagnostic leading indicators you never set a target on*.
- **Use a *basket* of signals, not one number.** A single "debt score" is a single thing to game. Hotspot rank + complexity trend + change-failure-rate + lead time is much harder to move all at once *without actually improving the code* — gaming one makes another look worse.
- **Watch for the divergence signature.** When the proxy improves but the outcome doesn't — coverage up, defects flat; issue count down, lead time still rising — that gap *is* the tell that the metric is being gamed. Put both on the same chart and the gaming becomes visible.
- **Never make any debt proxy a target with consequences.** Targets corrupt proxies. Keep proxies as *instruments* the team reads, and reserve any "targets" for outcomes — and even then, lightly.

> **The Goodhart discipline:** assume from day one that any debt number you publish *will* become a target if it gets attention, and *will* be gamed the moment it's a target. Design for it: lead with outcomes, triangulate with a basket, watch for proxy-vs-outcome divergence, and never attach consequences to a proxy. The goal is a metric that *informs* decisions, never one that *is* the decision — because the second kind dies of Goodhart within a quarter.

---

## From Measurement to an ROI Model Leadership Funds

Engineers lose the funding argument because they argue in the wrong currency. "This code is a mess and it's slowing us down" is *true* and *unfundable* — it has no number a budget owner can weigh against the feature they'd fund instead. The professional skill is translating a debt signal into an **ROI model in the currency leadership allocates**: expected cost saved versus remediation cost, with a payback period. This is Cunningham's metaphor taken literally — debt has *principal* (the cost to fix) and *interest* (the recurring cost of not fixing), and you fund a paydown exactly when the interest justifies retiring the principal.

The model has four moving parts:

**1. Remediation cost (the principal).** What it costs to fix — engineer-days × loaded cost, derived from the SQALE estimate (senior tier) or a planning estimate, *plus* the opportunity cost of the features not built during that time. Be honest and include both; leadership will.

**2. Interest (the recurring cost of *not* fixing).** The ongoing tax the debt levies. Make it concrete and measurable:
- *Lead-time tax:* changes to the hotspot take, say, 3× longer than baseline. If the team spends 200 engineer-days/year touching it, and the debt adds 40% overhead, that's ~57 engineer-days/year of pure interest.
- *Incident tax:* if the hotspot causes N incidents/year at M hours of response + lost revenue each, that's interest too.
- *Defect tax:* rework, hotfixes, and the change-failure-rate premium on that code.

**3. Cost of delay.** What does *waiting* cost? Interest compounds — the hotspot gets worse (complexity trends *up*, recall), so next year's remediation is more expensive *and* next year's interest is higher. Cost of delay is what reframes "we'll do it eventually" as a decision with a price tag attached to *every quarter of eventually*.

**4. Payback period.** `remediation_cost / annual_interest_saved` = years to break even. A paydown that costs 57 engineer-days and saves 57 engineer-days/year of lead-time tax has a *one-year payback* — and that is a sentence a CFO can act on, because it's the same sentence they hear from every capital investment.

A worked example, the way you'd put it in a funding deck:

```
HOTSPOT: payments-core/charge_processor   (rank #1, complexity 80, churn top-decile)

PRINCIPAL (remediation)
  estimate: 45 engineer-days  ×  $1,200/day loaded   =  $54,000

INTEREST (annual, cost of NOT fixing)
  lead-time tax : 220 eng-days/yr touch it × 35% overhead × $1,200  =  $92,400/yr
  incident tax  : 6 incidents/yr × 14 hrs × $1,200/8h-day            =  $12,600/yr
  ------------------------------------------------------------------------------
  total interest                                                     ≈ $105,000/yr

PAYBACK PERIOD  =  $54,000 / $105,000  ≈  0.5 years  (~6 months)
COST OF DELAY   =  ~$8,750 per month we wait, plus rising principal as complexity grows
```

That table is fundable. "The charge processor is gross" is not. Same underlying reality — one is in the currency of engineering taste, the other in the currency of capital allocation. Note what made it work: the *interest* came straight off the dashboard (lead time, incidents on the hotspot), so the ROI model isn't a one-off spreadsheet — it's the *measurement program cashed out as a decision*. That's the whole point of building the dashboard first.

> **The ROI principle:** leadership doesn't fund "quality"; they fund *returns*. A debt paydown with a six-month payback competes on equal footing with any other six-month-payback investment, and *wins* the ones where the interest is high. Your job is to do the translation — and to do it with numbers that come off the same dashboard you already trust, not numbers you invented for the deck. See [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/professional.md) for turning a portfolio of these ROI cases into a prioritized paydown plan (cost-of-delay, WSJF).

---

## Connecting Debt Signals to Business Outcomes

The dashboard and the ROI model both rest on one load-bearing claim: that internal debt signals *cause* the business outcomes leadership cares about. If you can't connect them, your debt panel is just engineering navel-gazing with charts. The four connections worth making explicit, each with the *mechanism* and the *evidence* you'd show:

**Debt → feature throughput.** *Mechanism:* high complexity and low test coverage make every change slower and riskier, so the same team ships fewer features. *Evidence:* plot story-points or feature-count delivered per quarter against the service's complexity trend; the inverse correlation, when it's there, is your headline. The honest version controls for team size — throughput falling while headcount rises is the unambiguous debt signature.

**Debt → incidents and MTTR.** *Mechanism:* tangled, poorly-tested code fails more (higher change-failure-rate) and is harder to diagnose under pressure (higher MTTR). *Evidence:* overlay incident count and MTTR per service on hotspot rank. When your top hotspots are also your top incident sources, the line from "messy" to "expensive and risky" draws itself — and incidents have a dollar cost leadership already accepts.

**Debt → time-to-market.** *Mechanism:* a high-debt service is a *bottleneck* — initiatives that route through it slip. *Evidence:* the most powerful single argument you can make. "The Q3 flagship launch slipped six weeks; four of those weeks were spent fighting the payments hotspot" connects debt directly to *revenue timing*, which is the outcome executives feel most viscerally. Capture this from launch retros, not just metrics.

**Debt → security findings.** *Mechanism:* old, complex code accumulates unpatched findings and is the hardest to remediate safely. *Evidence:* security-finding age and count, clustered on hotspots. This connection unlocks a *different* funding pool — security and compliance budget — for the same paydown work, which is often easier to access than feature-team capacity.

The technique that makes all four credible is **correlation over time on a shared timeline**: put the debt signal and the business outcome on the same chart, same x-axis, and let the eye see the relationship. You are rarely proving strict causation — you're showing a correlation strong and mechanistically plausible enough to *act on*. That's the bar for a funding decision, and it's a far lower bar than a research paper. Leadership doesn't need a p-value; they need a chart where the two lines move together and a mechanism that makes sense.

> **The connection principle:** every internal debt signal must terminate in a business outcome, or it doesn't belong in front of leadership. "Complexity is rising" → *so what*. "Complexity is rising, lead time is rising in lockstep, and the Q3 launch slipped because of it" → *fund the paydown*. The senior skill is measuring the internal signal; the professional skill is **drawing the line from that signal to a number on the P&L**.

---

## When a Measurement Program Backfires

Debt measurement programs fail in characteristic, recognizable ways. Knowing the failure modes lets you spot the program going wrong *before* the data is poisoned beyond recovery — because the worst outcome isn't a program that produces no data, it's one that produces *confident, dishonest* data that drives bad decisions while everyone trusts it.

**The metric becomes the mission.** The program drifts from "use debt signals to make better decisions" to "make the debt numbers look good." Teams optimize the dashboard instead of the codebase. *Tell:* the proxies improve (coverage up, issue count down) while the outcomes don't (lead time, change-failure-rate flat or worse) — the proxy-vs-outcome divergence again. *Fix:* re-anchor on outcomes, kill or demote the gamed proxies, and publicly stop celebrating the proxy numbers.

**The number gets weaponized.** A debt metric meant as a diagnostic becomes ammunition — in a reorg, a blame assignment, a team's performance review, a budget fight. *Tell:* people start arguing about whether the number is *fair* instead of what to *do* about it; teams begin disputing the measurement methodology rather than discussing the debt. *Fix:* re-establish the blameless contract loudly, and if leadership won't hold it, *stop publishing per-team numbers* — an org-level trend that can't be weaponized beats per-team numbers that get used as clubs.

**Measurement theater.** The org invests heavily in dashboards and reports that *no one uses to make a decision*. Effort goes into the appearance of rigor; nothing changes. *Tell:* the dashboard exists, it's polished, and you can't name a single decision it changed last quarter. *Fix:* apply the dashboard test ruthlessly — every panel must tie to a decision, or it gets deleted. A small dashboard that drives three decisions beats a comprehensive one that drives none.

**Precision theater.** False confidence from a number that *looks* exact. "We have 412.5 days of technical debt" implies a precision the underlying estimates (rough remediation guesses, heuristic complexity weights) simply don't have. *Tell:* debate centers on whether it's 412 or 430 days, instead of on the *direction and the decision*. *Fix:* present ranges and trends, not false decimals — "debt in Payments is high and rising" drives the same correct decision as a fake-precise number, without the credibility trap when someone discovers the estimate was a guess.

Keeping it honest, in practice:
- **Lead with outcomes, treat internal proxies as diagnostics.** Outcomes resist gaming; proxies don't.
- **Triangulate** — no single number, always a basket, so gaming one surfaces in another.
- **Watch the proxy-vs-outcome gap** as your built-in lie detector. It's the one signal that catches a program going dishonest.
- **Hold the blameless contract**, and if you can't, narrow what you publish until you can.
- **Re-validate the program yearly:** which numbers changed a decision? Kill the ones that didn't. A measurement program is itself subject to debt — prune it.

> **The honesty principle:** a debt measurement program is *only* worth running if the data stays honest, and honesty is a *cultural* property, not a tooling one. The fastest way to a dishonest program is to attach consequences to the numbers; the fastest way to keep it honest is to make it always-safe to report a bad number and always-required to tie a number to a decision. A program that's gone dishonest is *worse than no program*, because it launders bad decisions in the authority of data — and everyone trusts it right up until it's wrong.

---

## War Stories

**The hotspot map that re-pointed a quarter's roadmap.** A platform team built its first churn × complexity hotspot map and brought it to quarterly planning, ranked, with each hotspot's incident count and lead-time overlaid. The #1 hotspot was the auth/session module — top-decile churn, cyclomatic complexity north of 70, the origin of roughly a third of the prior quarter's customer-facing incidents. The roadmap as drafted had *three* new features building directly on top of it. Seeing the map, the planning group resequenced on the spot: a two-week paydown of the session module *first*, then the features on the now-stable foundation. The lesson wasn't the tool — it was *where* the map appeared. The exact same data in a Q1 audit deck had been nodded at and shelved; the same data *on the screen during sequencing* re-pointed the quarter. Visibility at the decision moment is the whole game.

**The debt score that got gamed.** An org rolled out a single composite "debt score" per team and, fatefully, put "reduce your debt score 15%" in the quarterly team goals. Scores dropped beautifully across the board — and lead time and change-failure-rate didn't budge. Investigation found the mechanics: teams had bulk-reclassified debt tickets as "tech improvements" (outside the score's scope), closed others as "won't do," and quietly tuned their SonarQube rulesets to lower the issue count feeding the score. The number went down; the debt stayed exactly where it was, now *unlabeled and invisible*. Textbook Goodhart: the moment the score became a target with consequences, it stopped measuring debt and started measuring *teams' ability to move the score*. The fix was painful — drop the target, stop scoring teams, rebuild trust, and re-anchor the dashboard on outcomes (lead time, change-failure-rate) that couldn't be reclassified away. The data took two quarters to become trustworthy again.

**The ROI model that won funding.** A staff engineer had spent a year losing the argument that the billing service needed serious paydown — "it's fragile," "it's slowing us down," all true, all unfunded. Then she rebuilt the case as an ROI model straight off the dashboard: principal of ~40 engineer-days; interest of ~$95K/year (lead-time tax from the team spending 35% longer on every billing change, plus four billing incidents/year at measurable response + revenue cost); payback under six months; cost-of-delay of ~$8K/month with the principal rising as complexity trended up. She put the worked table in a one-page deck. It was funded in the next planning cycle — not because the code got worse, but because the *argument changed currency*, from engineering taste to capital allocation. Same debt, same engineer, opposite outcome. The interest numbers came off the dashboard the team already trusted, which is exactly why finance trusted them too.

---

## Decision Frameworks

**Is this debt program ready to show leadership? Ask:**
- Does every dashboard panel tie to a decision that changes if it moves? → if not, cut it (dashboard test).
- Does each internal signal (complexity, coverage) terminate in a business outcome (lead time, incidents, time-to-market)? → if not, it's navel-gazing.
- Are you leading with *outcomes* and using proxies only as diagnostics? → if you're leading with proxies, expect gaming.

**Should I make this debt metric a target? Ask:**
- Is it a *proxy* (coverage, issue count, complexity) or an *outcome* (change-failure-rate, lead time)? → never target a proxy; target outcomes only, and lightly.
- Will it appear in anyone's performance review or a team OKR with teeth? → if yes, *don't* — you'll trade truth for the appearance of progress.
- Can I triangulate it with a basket so gaming one surfaces in another? → if it's a lone number, it *will* be gamed.

**How do I price a paydown for funding? Ask:**
- What's the principal (remediation eng-days × loaded cost + opportunity cost)?
- What's the annual interest (lead-time tax + incident tax + defect tax), *off the dashboard*?
- What's the payback period (`principal / annual interest`) and cost-of-delay per month?
- Can I say it in one sentence a CFO acts on? → "Costs 45 days, saves $105K/year, pays back in six months."

**Is the program going dishonest? Watch for:**
- Proxies improving while outcomes don't (the divergence signature).
- Debate shifting from *what to do* to *whether the number is fair*.
- A polished dashboard you can't tie to a single decision last quarter.
- False-precision arguments (412 vs 430 days) instead of direction. → re-anchor on outcomes, restore blamelessness, present ranges.

---

## Mental Models

- **Goodhart is a certainty, not a risk.** Any debt number that gets attention *will* become a target, and any target *will* be gamed. Design the program assuming this, the way you design for hardware failure — lead with outcomes, triangulate, never attach consequences to a proxy.

- **A debt metric is a thermometer, not a scorecard.** Its job is an honest reading so the org can decide. You don't grade the nurse on the patient's temperature, and you don't grade a team on its raw debt level — do either and the reading goes dishonest.

- **Debt signals are causes; you must connect them to effects.** "Complexity is rising" is inert. "Complexity is rising, lead time rose in lockstep, and the launch slipped because of it" is fundable. Every internal signal must terminate in a business outcome or it stays invisible to leadership.

- **Leadership funds returns, not quality.** Translate debt into principal, interest, and payback period, and a paydown competes — and wins — against any investment with the same payback. "It's gross" has no currency; "six-month payback, $105K/year" does.

- **Visibility at the decision moment is the whole game.** The same hotspot map is shelved in an audit deck and re-points a roadmap when it's on the screen during planning. Measurement only matters where and when a decision is being made.

- **A dishonest program is worse than none.** Bad data wearing the authority of a dashboard launders bad decisions. Honesty is cultural, not technical — keep it always-safe to report a bad number, or stop publishing the number.

---

## Common Mistakes

1. **Running an audit instead of a trend.** A point-in-time debt assessment is stale the week after the offsite and owned by no one. Wire debt signals into the dashboards the org already watches, refreshed automatically, so the *trend* is always current and visible. Leadership funds trends they can watch, not audits they have to remember.

2. **Vanity panels on the dashboard.** "412 days of total debt" is big and scary and drives no decision. Every panel must pass the dashboard test — *what decision changes if this moves?* The first impressive-but-inert panel teaches leadership to stop trusting the whole board.

3. **Making a debt proxy a target.** Coverage %, issue count, complexity-per-function, composite "debt score" — every one gets gamed the moment it's a target with consequences (Goodhart). Target *outcomes* (change-failure-rate, lead time) lightly, and keep proxies as diagnostics you never set a goal on.

4. **Tying debt metrics to individual or team performance.** This silently flips the metric's purpose from *honesty* to *looking good*, and those conflict. You'll get the number you incentivized and lose the truth you needed. A debt metric is a diagnostic for the org, never a scorecard for a person.

5. **Punishing the bad number.** The first time a high reading gets a team questioned or a "fix it by next quarter" mandate, every team learns to stop surfacing debt — and your data quality dies quietly. The correct response to a bad number is curiosity, then resourcing.

6. **Arguing in the wrong currency.** "This code is a mess and slows us down" is true and unfundable. Translate to principal / interest / payback off the dashboard. Leadership allocates capital, not sympathy.

7. **Leaving internal signals unconnected to outcomes.** A complexity chart with no business outcome next to it is engineering navel-gazing. Put the debt signal and the lead-time/incident/time-to-market line on the same timeline, or don't show it to leadership.

8. **False precision.** "412.5 days of debt" implies a rigor the rough estimates underneath don't have, and the credibility collapses the moment someone learns the number was a guess. Present ranges and direction — they drive the same decision without the trap.

---

## Test Yourself

1. Your org has run a thorough debt audit every Q1 for three years, and nothing ever changes as a result. Diagnose why, and describe what an org *practice* looks like instead.
2. A VP wants to put "reduce technical debt 20% this quarter" into every team's OKRs. Explain, using Goodhart's Law, exactly what will happen, and propose what to measure and target instead.
3. You're asked to fund a paydown of a hotspot. Walk through the four components of an ROI model and produce the one sentence you'd say to the CFO.
4. A team's coverage rose from 60% to 85% over two quarters, but their change-failure-rate didn't improve at all. What does this pattern tell you, and what's the underlying mechanism?
5. Why must a debt metric *never* be tied to individual performance? Give the mechanical reason, not the moral one.
6. Leadership is anxious that lead time in the Payments service has risen 60% over three quarters. You have a hotspot map. How do you turn this into a funded paydown?
7. Your debt program has a beautiful, comprehensive dashboard. What single test tells you whether it's actually useful, and what do you do with the panels that fail it?
8. How can you tell, from the data alone, that a debt measurement program has started to go dishonest?

<details>
<summary>Answers</summary>

1. The audit produces a number at a point in time, divorced from the flow of work, owned by no one, and stale before it's socialized — so it drives no decision. An org *practice* wires debt signals (hotspot rank, complexity trend, debt ratio) into the dashboards the org already watches, refreshed automatically, surfaced *in planning* where sequencing decisions are made, and owned for its *trend* (not its level) by a central function plus per-service team ownership. The shift is from "how bad is it?" once to "which way is it moving, and where?" continuously.

2. By Goodhart, the metric stops measuring debt and starts measuring teams' ability to move the number: they'll reclassify debt tickets as "tech improvements," close others as "won't do," tune the linter ruleset down, and pad coverage with empty tests. The score drops; the debt stays, now invisible. Instead, don't target a proxy at all — anchor on *outcomes* (change-failure-rate, lead time) that resist gaming, use a *basket* of signals so gaming one surfaces in another, and never attach the number to OKRs with consequences. Keep the debt signals as diagnostics the org reads together, not a target one team is graded on.

3. **Principal:** remediation eng-days × loaded cost + opportunity cost of features not built. **Interest:** annual recurring tax — lead-time overhead (eng-days/yr touching it × % overhead × loaded cost) + incident tax (incidents/yr × response hours + revenue) + defect/rework tax — pulled off the dashboard. **Cost of delay:** the per-month cost of waiting, including the rising principal as complexity trends up. **Payback period:** `principal / annual interest`. One sentence: *"It costs ~45 engineer-days to fix, saves ~$105K/year in lead-time and incident tax, and pays back in about six months."*

4. It's the classic proxy-vs-outcome divergence — the signature of a gamed metric. The proxy (coverage) improved while the outcome (change-failure-rate) didn't, which means the added tests execute lines without meaningfully asserting behavior (test theater: `assert True`, trivial getter tests). Mechanism: coverage is a *proxy* for "well-tested," and it's far cheaper to add empty tests than real ones, so under a coverage target people optimize the proxy. The green number now actively lies.

5. The mechanical reason: the *purpose* of debt measurement is an honest picture for resourcing decisions. The moment "debt reduced" carries personal consequences, the metric's optimization target silently shifts from *honesty* to *looking good* — and those two goals are in direct conflict. You get the number you incentivized and lose the truth you needed. It's a diagnostic instrument (a thermometer); grading the nurse on the patient's temperature corrupts the reading.

6. Overlay the debt signal on the outcome on a shared timeline: show that the Payments hotspot's complexity rose ~45% over the same three quarters, with changes concentrated in a few files and change-failure-rate elevated on them. That turns an unexplained slowdown into a root-caused diagnosis. Then translate to an ROI model off the dashboard — principal, interest (the lead-time tax that *is* the 60% rise), payback period — and present "X engineer-days to fix, $Y/year saved, Z-month payback." Cause + effect on one chart, then the cost in capital-allocation currency.

7. The dashboard test: for every panel, *"what decision changes if this number moves?"* If the honest answer is "none — it's just big," it's a vanity metric. Delete the panels that fail. A small dashboard that drives three decisions beats a comprehensive one that drives none; inert panels dilute trust in the whole board.

8. Watch for the proxy-vs-outcome divergence — internal proxies improving (coverage up, issue count down) while outcomes stay flat or worsen (lead time, change-failure-rate). Also: debate shifting from *what to do* to *whether the number is fair* (weaponization), a polished dashboard you can't tie to any decision (theater), and false-precision arguments about decimals instead of direction. The proxy-vs-outcome gap is the built-in lie detector.

</details>

---

## Cheat Sheet

```
ORG-WIDE VISIBILITY (practice, not audit)
  hotspot map (churn × complexity)  → surfaced IN PLANNING, ranked, with incidents+lead-time
  complexity TREND (slope), not snapshot → the actionable early-warning signal
  debt = tracked, trended metric on existing dashboards, auto-refreshed
  RULE: debt not trended + surfaced at the decision moment = not measured

DASHBOARD (3 layers, cause→effect→business)
  causes   : hotspot rank, complexity slope, debt ratio, churn concentration, hotspot coverage
  effects  : DORA — lead time, change-failure-rate, MTTR, deploy frequency
  business : feature throughput, incident cost, time-to-market, security-finding age
  TEST: every panel → "what decision changes if this moves?"  no answer = delete

POLITICS
  own the TREND, never punished for the LEVEL  (central = system+org trend; teams = own service)
  bad number → curiosity + resourcing, NEVER blame  (punish once = data dies)
  NEVER tie a debt metric to individual/team performance  (flips honesty → looking-good)

GOODHART (a certainty, plan for it)
  coverage %      → empty/assert-True tests        proxy moves cheaper than the truth
  issue count→0   → suppress / NOSONAR / tune rules
  complexity/fn   → split into tangled small fns
  "debt score"    → reclassify / "won't do" tickets
  DEFENSE: lead with OUTCOMES, basket not one number, watch proxy-vs-outcome gap, no targets on proxies

ROI MODEL (the funding currency)
  principal = remediation eng-days × loaded cost + opportunity cost
  interest  = lead-time tax + incident tax + defect tax   (off the dashboard)
  payback   = principal / annual interest
  cost-of-delay = $/month waiting + rising principal
  SAY IT: "45 days to fix, $105K/yr saved, ~6-month payback"

CONNECT TO BUSINESS (same timeline, cause + effect)
  debt → throughput | incidents/MTTR | time-to-market | security findings
  correlation + plausible mechanism = enough for a funding decision (not a p-value)

BACKFIRE TELLS
  proxy↑ outcome flat (gamed) | argues "fair?" not "do what?" (weaponized)
  dashboard drives 0 decisions (theater) | 412 vs 430 days (false precision)
```

---

## Summary

- **Run measurement as a practice, not an audit.** A point-in-time assessment is stale and ownerless; an org practice wires debt signals into the dashboards leadership already watches, trended and refreshed, surfaced *in planning* where sequencing decisions get made. Leadership funds trends they can watch, not audits they have to remember.
- **The dashboard pairs causes with effects.** Internal debt signals (hotspot rank, complexity slope, debt ratio) on the same screen as delivery outcomes (the DORA four) and business outcomes (throughput, incident cost, time-to-market). Every panel must pass the test: *what decision changes if this moves?*
- **Measurement is political; the number must be safe to look bad.** Own the *trend*, never the *level*. The correct response to a bad number is curiosity and resourcing, never blame — punish a high reading once and your data goes quietly dishonest. And **never** tie a debt metric to individual or team performance.
- **Goodhart is a certainty.** Every debt proxy — coverage, issue count, complexity-per-function, composite "score" — gets gamed the moment it's a target with consequences. Lead with *outcomes* (which resist gaming), triangulate with a *basket*, watch the proxy-vs-outcome gap as your lie detector, and put targets only on outcomes.
- **Translate debt into ROI to get it funded.** Principal (remediation cost), interest (lead-time + incident + defect tax off the dashboard), cost-of-delay, and payback period. "It's a mess" is unfundable; "45 days to fix, $105K/year saved, six-month payback" competes with any investment and wins the high-interest ones.
- **Connect every internal signal to a business outcome, or don't show it.** Complexity rising is inert; complexity rising *with* lead time, *causing* a slipped launch, is fundable. Correlation on a shared timeline plus a plausible mechanism clears the bar for a funding decision.
- **A dishonest program is worse than none.** It launders bad decisions in the authority of data. Honesty is cultural — keep it always-safe to report a bad number and always-required to tie a number to a decision, or narrow what you publish until you can.

You can now run debt measurement as an organizational practice and turn the numbers into roadmap and funding decisions that hold up. The remaining tier — [interview.md](interview.md) — consolidates identifying and quantifying into the questions that probe whether someone can do this for real.

---

## Further Reading

- **Ward Cunningham — the debt metaphor (OOPSLA '92 experience report) and his 2009 clarifying video** — the principal/interest framing the entire ROI model rests on.
- **Kruchten, Nord & Ozkaya — *Managing Technical Debt* (SEI)** — the canonical treatment of debt as a tracked, managed, organizational concern rather than a one-off cleanup.
- **Adam Tornhill — *Software Design X-Rays***  — behavioral hotspots (churn × complexity) and turning version-control data into the maps that re-point roadmaps.
- **Nicole Forsgren, Jez Humble & Gene Kim — *Accelerate*** — the DORA four (lead time, deployment frequency, change-failure-rate, MTTR) that form the dashboard's outcome layer and the currency for connecting debt to delivery.
- **Charles Goodhart / Marilyn Strathern — Goodhart's Law** — *"when a measure becomes a target, it ceases to be a good measure"*; Strathern's formulation is the one to internalize before you publish any number.
- **The SQALE method and the SonarQube debt-ratio documentation** — the remediation-cost estimates that feed the principal, *and* a cautionary example of a number that gets gamed once it's a target.

---

## Related Topics

- [junior.md](junior.md) — what debt is and the first signals (smells, the change that took 3× longer).
- [senior.md](senior.md) — computing hotspots, SQALE remediation cost, reading the lead-time and defect signals for one codebase.
- [interview.md](interview.md) — the questions that test whether you can identify, quantify, and *fund* debt for real.
- [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/professional.md) — turning a portfolio of ROI cases into a prioritized paydown plan (cost-of-delay, WSJF).
- [05 — Paying Down Debt](../05-paying-down-debt/professional.md) — executing the paydown the ROI model funded, and measuring the payoff.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — lead time, deployment frequency, change-failure-rate, MTTR: the outcome layer the debt dashboard and ROI model both borrow.
