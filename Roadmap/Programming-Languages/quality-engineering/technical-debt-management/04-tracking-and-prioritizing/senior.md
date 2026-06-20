# Tracking & Prioritizing — Senior Level

> **Roadmap:** [Technical Debt Management](../README.md) → Tracking & Prioritizing
> *The middle page taught you to keep a register and rank with WSJF. This page is about the two things that separate a senior from a list-keeper: prioritizing debt as a **portfolio optimization under uncertainty** — ranking by expected interest saved net of remediation cost, not by how ugly the code is — and building a tracking system that **doesn't rot**, because a standalone debt backlog is a graveyard waiting to be bulk-closed.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Severity-Sorting Is the Wrong Axis](#severity-sorting-is-the-wrong-axis)
4. [The Expected-Interest Model](#the-expected-interest-model)
5. [Fusing the Hotspot Map with the Quadrant](#fusing-the-hotspot-map-with-the-quadrant)
6. [A Worked Ranking — Six Debts, One Spreadsheet](#a-worked-ranking--six-debts-one-spreadsheet)
7. [Cost of Delay, WSJF, and CD3 at Depth](#cost-of-delay-wsjf-and-cd3-at-depth)
8. [The Backlog-Rot Problem — Why Separate Debt Lists Die](#the-backlog-rot-problem--why-separate-debt-lists-die)
9. [Deciding the Paydown Budget](#deciding-the-paydown-budget)
10. [Prioritization Anti-Patterns](#prioritization-anti-patterns)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Ranking debt by the money it actually costs, and keeping a backlog that survives contact with a real roadmap.**

By the middle level you can build a debt register, attach a SonarQube/SQALE remediation estimate to each item, and sort with WSJF. That is already better than most teams. The senior jump is in *what you sort by* and *where the items live*.

Two failure modes are nearly universal, and both feel reasonable from the inside. The first is **severity-sorting**: ranking debt by how bad the code is — the analyzer's "critical" vs "minor", the architect's gut, the size of the smell. The second is the **standalone debt backlog**: a separate Jira project or epic called "Tech Debt" where items go to be triaged quarterly and, eventually, bulk-closed because nobody can remember why `TD-417` matters anymore.

The cure for both is the same shift in framing. Technical debt is a *financial* instrument, so prioritization is *portfolio optimization*: allocate your scarce paydown capacity to the positions with the highest risk-adjusted return, where return is **interest you stop paying** and the position's value decays with how often you actually touch the code. A "critical" smell in a file nobody has edited in two years is a bond from a company that no longer trades — its coupon is theoretical. A "minor" smell in a file three engineers fight with every day compounds weekly. The model in this page makes that intuition rigorous, with numbers, and then makes it *durable* by attaching the paydown to the work that already visits the code.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — debt registers, basic WSJF, the idea of interest vs principal.
- **Required:** You can read a [hotspot map](../02-identifying-and-quantifying/senior.md) — churn × complexity — and a SQALE/remediation-cost estimate, and you trust neither blindly.
- **Required:** You can place a debt item in [the debt quadrant](../03-the-debt-quadrant/senior.md) (deliberate/inadvertent × prudent/reckless).
- **Helpful:** You've watched a "Tech Debt" epic get groomed three quarters running and shipped nothing — the visceral knowledge that a list is not a plan.
- **Helpful:** Comfort with expected value and discounting; you don't need finance, but you need to believe that "cost × probability, in today's money" beats "feels important."

---

## Severity-Sorting Is the Wrong Axis

The instinct is to rank debt by *how bad it is*. Static analyzers feed this directly: SonarQube tags issues `blocker / critical / major / minor / info`; a SQALE rating slaps an A–E grade on a module. So teams sort the list by severity and work top-down. It feels objective — the tool said critical — and it is almost always wrong as a *prioritization* function.

Severity measures the **badness of the code in isolation**. Priority must measure the **cost the badness imposes on you over time**. Those are different quantities, and they routinely point in opposite directions:

- A `blocker`-rated god-class in a payments module that's been frozen since the last rewrite — no feature touches it, it's wrapped in characterization tests, it just sits there working. Its remediation cost is huge; its ongoing interest is near zero because *nobody pays it*. You almost never read frozen code, so its ugliness costs you almost nothing.
- A `minor`-rated tangle of conditionals in the pricing-rules file that every promotion, every A/B test, and every new market touches. Each change is slowed and risks a regression. Low severity, high *frequency-of-contact*, so the interest compounds every sprint.

Sort by severity and you spend your best refactoring days on the frozen god-class while the daily-touched tangle keeps taxing every feature. The analyzer can't see this because **it has no model of how often you touch the file** — it reads a snapshot, not the change history. Severity is an input to *remediation cost* and to *blast radius if it breaks*, but it is not, by itself, priority.

> **Key insight:** Severity is a property of the code; priority is a property of the code *times your relationship with it over time*. A critical smell in frozen code can rank below a minor smell in a hot file, because debt only charges interest when you visit it. The analyzer sees the code; it cannot see the visiting. That missing dimension — churn — is exactly what the hotspot map adds, and why prioritization must fuse the two.

---

## The Expected-Interest Model

Treat each debt item as a position with a cash flow. You want the items with the highest **net present value of paying them down** — the interest you will *stop* paying, minus what it costs to pay it off, all in today's money. Build it up term by term.

**Interest per unit of contact.** Debt charges interest only when you work in the affected code: every change is slower, riskier, more likely to regress. Call the per-touch tax the **interest rate** `r` — the extra cost a single change to this code incurs *because* of the debt (extra hours, plus the expected cost of a regression). This is the term severity informs: a worse smell makes each touch more expensive. But a rate alone is meaningless without a quantity to multiply it against.

**Expected future contact.** A rate applied to nothing yields nothing. The quantity is **expected future churn** `C` — how often you will actually touch this code per period. Your best estimator for future churn is *past* churn (the hotspot map's headline number), adjusted for what you know about the roadmap: a module slated for a big feature next quarter has higher expected churn than its history shows; a module about to be deprecated has near-zero expected churn regardless of how hot it's been.

**Remaining lifetime.** Interest accrues only while the code still exists. **Remaining lifetime** `L` (in periods) caps the accrual. Debt in a service you're sunsetting in two quarters can accrue at most two quarters of interest — which is why "we're rewriting this anyway" is a legitimate reason to *defer*, not a dodge. This is the term that quietly kills most "we must fix the legacy monolith" arguments: if it's leaving, its remaining lifetime is short, so its total remaining interest is small no matter how high the rate.

**Remediation cost.** Paying the debt down costs **`F`** — the one-time fixed cost to remediate (the SQALE/SonarQube remediation estimate is a starting point, but adjust for test coverage, blast radius, and coordination; a "1-day" fix that touches a published API and needs three teams to agree is not a 1-day fix).

**Discounting.** A cost avoided next year is worth less than one avoided this sprint — money has time value, and future estimates are less certain. Discount future interest at rate `d` per period.

Putting it together, the **net value of paying down** a debt item is the discounted interest you avoid over its remaining life, minus the cost to fix it:

```
                  L
                 ___     r · C
Net Value  =     \      ─────────     −     F
                 /__    (1 + d)^t
                 t=1

           ≈   r · C · A(d, L)   −   F        // A = annuity factor for rate d over L periods
```

where the annuity factor `A(d, L) = Σ 1/(1+d)^t` collapses the discounted stream into one multiplier. (For modest horizons you can skip discounting entirely and use `Net Value ≈ r · C · L − F`; the ranking rarely changes, and a transparent model that the team trusts beats a precise one nobody audits.)

Read the formula back as a sentence: **pay down the debt that is expensive per touch, in code you'll touch often, that will live long enough to keep charging — unless the fix costs more than the interest it saves.** Every term earns its place:

- Drop `C` (churn) and you're back to severity-sorting — the failure of the previous section.
- Drop `L` (lifetime) and you'll "fix" debt in code that's about to be deleted.
- Drop `F` (remediation cost) and you'll chase high-interest debt that costs more to fix than it ever saves.
- Drop discounting and, at long horizons, you'll overvalue speculative far-future savings.

> **Key insight:** The single number that flips priorities relative to a severity sort is **churn**. Severity sets the rate `r`; churn sets the quantity `C` the rate is charged against. A high rate on near-zero churn is near-zero interest — the frozen god-class. A modest rate on high churn compounds — the daily-touched tangle. Multiply, don't sort on one factor.

A practical caution on `r`: don't over-engineer it. You will not measure "interest rate" to two decimals. A defensible scheme is a small ordinal scale — say `r ∈ {1, 2, 3, 5, 8}` (extra-hours-equivalent per touch) — anchored by examples the team agrees on. The model's value is in *forcing the multiplication*, not in false precision on any one term. Garbage `r` × garbage `C` is still garbage; but an *honest ordinal* `r` times a *measured* `C` is dramatically better than ranking on `r` alone.

---

## Fusing the Hotspot Map with the Quadrant

You already have two senior instruments. Section 02 gives you the **hotspot map** — every file plotted as *churn × complexity*, the empirical "where does change concentrate on bad code." Section 03 gives you the **debt quadrant** — every item classified *deliberate/inadvertent × prudent/reckless*, the judgment about *what kind* of debt it is and how it got there. Prioritization is where they combine: the hotspot map supplies `C` (and informs `r` via complexity), and the quadrant tells you *how to treat the result*.

The hotspot map is the dominant input because it is **measured, not opinion**. Churn comes straight from version control; complexity from the parser. It cuts through the squeaky-wheel problem (next section) because it doesn't care who is loud — it shows where change actually concentrates. The top-right of the map (high churn × high complexity) *is* your high-interest list, almost by construction: complex code (high `r`) that changes constantly (high `C`).

The quadrant then modulates the ranking with judgment the map can't supply:

| Quadrant | Typical `r` (rate) | Default action when churn is high | Default action when churn is low |
|---|---|---|---|
| **Reckless / inadvertent** ("we didn't know better") | high — messy, surprising code, each touch risky | **Pay down first.** High rate × high churn = the worst-compounding debt you own. | Monitor. Ugly but cheap because rarely touched. |
| **Reckless / deliberate** ("no time for design") | high — known shortcut, no safety net | **Pay down.** You knew it was a shortcut; the churn confirms the bill came due. | Defer; revisit if churn rises. |
| **Prudent / deliberate** ("ship now, refactor later") | moderate — intentional, usually contained | **Pay down on schedule** — this is the debt you *meant* to repay. | Defer happily; this is debt working as designed. |
| **Prudent / inadvertent** ("now we understand the domain") | low–moderate — yesterday's reasonable design | Refactor as you learn — fold into feature work. | Leave it. It's only "debt" in hindsight. |

The two-axis rule that falls out:

- **Pay down high-churn × reckless debt first** — top-right of the map *and* a reckless quadrant. Highest rate, highest contact, and the kind of debt most likely to cause an incident (no safety net). This is where your paydown budget earns its keep.
- **Defer low-churn debt regardless of how ugly it is** — bottom of the map. Low `C` means low interest no matter how high `r` looks. The frozen god-class lives here. Ugliness you don't touch is free.

> **Key insight:** The hotspot map gives you the *quantities* (churn = `C`, complexity ≈ `r`); the quadrant gives you the *judgment* (how risky, how intentional, how to respond). Severity-sorting uses only the analyzer's opinion of badness; mature prioritization multiplies measured churn by an honest rate and then lets the quadrant break ties and set the *kind* of response. Map says *how much it costs*; quadrant says *what to do about it*.

---

## A Worked Ranking — Six Debts, One Spreadsheet

Abstract models convince no one. Here is the model run on six real-shaped debt items. Columns: `r` = interest rate (extra-effort-equivalent per touch, ordinal 1–8); `C` = expected churn (commits/quarter, from the hotspot map, roadmap-adjusted); `L` = remaining lifetime (quarters before the code is likely deleted/rewritten); `F` = remediation cost (engineer-days). We compute undiscounted total interest `r·C·L`, then **Net Value = r·C·L − F** (converting `r·C·L` to engineer-days at, say, 0.25 day saved per rate-point-touch — i.e. multiply by 0.25 — so the units match `F`). Severity rank is shown alongside to expose the divergence.

| # | Debt item | Sev. | `r` | `C` (commits/qtr) | `L` (qtrs) | `F` (days) | Interest = `r·C·L·0.25` (days) | **Net = Interest − F** | **Rank** |
|---|---|---|---|---|---|---|---|---|---|
| A | God-class in **frozen** payments core | blocker | 8 | 1 | 8 | 20 | 16 | **−4** | 5 |
| B | Tangled conditionals in **pricing-rules** (touched by every promo) | minor | 3 | 40 | 8 | 8 | 240 | **+232** | **1** |
| C | Duplicated validation across 3 **active** services | major | 3 | 16 | 8 | 10 | 96 | **+86** | 3 |
| D | No tests around **checkout** state machine (reckless) | critical | 5 | 24 | 8 | 12 | 240 | **+228** | **2** |
| E | Dead-ish module in service **sunsetting next qtr** | major | 5 | 6 | 1 | 6 | 7.5 | **+1.5** | 4 |
| F | Ugly but **stable** logging wrapper, rarely edited | minor | 2 | 2 | 8 | 4 | 8 | **+4**… ≈ 0 | 6 |

What the numbers say, and how badly severity misleads:

- **B (pricing-rules) ranks #1** despite being the *lowest* severity (`minor`). It's touched ~40×/quarter; a small per-touch tax (`r=3`) times huge churn times a long life dominates everything. This is the daily-touched tangle from §3, and the model surfaces it to the top — exactly where a severity sort buries it.
- **D (checkout, no tests) ranks #2** — high churn *and* reckless (no safety net). High rate × high contact: the canonical "pay this first." A severity sort (`critical`) would rank it second too, by luck — but for the wrong reason. Here it's #2 because of *quarterly contact*, not the label.
- **A (frozen god-class) ranks last and is net-negative.** Highest severity (`blocker`), highest rate (`r=8`), but churn is 1/quarter — almost nobody touches it — so total interest (16 days over two years) is *less than the 20-day fix*. **Paying it down loses money.** This is the headline inversion: the analyzer's #1 is the model's last, and fixing it is value-destroying. Leave it; revisit only if churn rises.
- **E (sunsetting service) ranks low purely on `L`.** Decent rate and churn, but it's gone in one quarter — total interest can't exceed ~7.5 days. Remaining lifetime, not ugliness, is the gating term. Don't refactor code that's about to be deleted.
- **F (stable logging wrapper)** is the bottom-of-map case: low rate, low churn → net ≈ 0. Ugliness you don't touch is free. Skip it forever unless churn changes.

The ranking the model produces — **B, D, C, E, A, F** — is almost the *reverse* of the severity ranking for the two extremes (A and B). That inversion is the whole point: **a "critical" smell in frozen code ranks below a "minor" one in a daily-touched file**, and the spreadsheet shows exactly why, in days.

> **Key insight:** Run the multiplication and the priorities reorder themselves, often dramatically. The frozen `blocker` is net-*negative* — fixing it costs more than the interest it saves — while the daily `minor` is your single best investment. You cannot reach that conclusion by sorting on severity, and you can defend it to a PM in one number: **net engineer-days saved.**

A note on honesty: every cell here is an *estimate*. The model's job is not to be exact but to make the assumptions **explicit and arguable**. When a stakeholder insists item A is critical, you don't argue taste — you point at `C=1` and ask, "How often do we actually touch it?" The conversation moves from opinion to evidence. Re-run the sheet quarterly; churn and roadmap (and thus `C` and `L`) drift, and a debt's rank should drift with them.

---

## Cost of Delay, WSJF, and CD3 at Depth

The expected-interest model ranks debt against *other debt*. But debt competes for the same capacity as *features*. To rank a refactor against a feature on one list you need a common currency, and that currency is **Cost of Delay (CoD)** — the economic cost, per unit time, of *not having* something done. Reframed: the interest term `r · C` of the expected-interest model *is* a Cost of Delay — it's money you bleed every period the debt stays unpaid. That equivalence is what lets debt and features share a backlog.

**WSJF (Weighted Shortest Job First)** is the scheduling rule that minimizes total Cost of Delay when jobs compete for one resource:

```
WSJF = Cost of Delay / Job Duration
```

Schedule highest-WSJF first. The math is not a heuristic — it's the provably optimal sequence for minimizing cumulative delay cost across jobs of differing length and urgency (a weighted version of the classic shortest-processing-time scheduling result). The intuition: a high-CoD job that's also *short* should obviously go first; dividing CoD by duration captures "most economic bang per unit of capacity."

SAFe's CoD proxy decomposes into three estimated components:

```
Cost of Delay = User/Business Value + Time Criticality + Risk Reduction / Opportunity Enablement
WSJF (SAFe)   = (Value + Time-Criticality + Risk-Reduction-Opportunity-Enablement) / Job Size
```

For **debt specifically**, that decomposition maps cleanly onto terms you already have:

- **Business value** → usually low for debt directly (users don't feel a refactor) — which is precisely why debt loses naive value-sorts and needs the other two terms to compete.
- **Time criticality** → your *interest rate × churn* (`r · C`): how fast the cost compounds, and whether contact is rising. Rising-churn debt is time-critical; frozen debt is not.
- **Risk reduction / opportunity enablement** → the unblocking value: debt whose paydown *unlocks* a roadmap item (you can't build feature X until module Y is untangled) scores high here even when its standalone interest is modest. This is how an architectural refactor earns its place against shiny features.

**CD3 (Cost of Delay Divided by Duration)** is the same idea stated without SAFe's scoring scaffolding — Joshua Arnold and Don Reinertsen's formulation. It insists you estimate CoD in **actual money per week** (not story-point-flavored 1–10 components) and divide by a real duration:

```
CD3 = (Cost of Delay in $/week) / (Duration in weeks)
```

The discipline CD3 forces is the valuable part: putting a *currency figure* on delay. "This refactor saves ~$8k/week of slowed feature work and takes 2 weeks" (CD3 = 4000) is fundable; "this refactor is a 5/8/3" is not. For debt, the `$/week` of delay is the interest term `r · C` of the expected-interest model converted to money — the two frameworks are the same instrument viewed through different lenses. WSJF/CD3 is the *cross-portfolio* view (debt vs features, one resource); the expected-interest model is the *debt-internal* view (which debt, accounting for lifetime and one-time fix cost). Use both: rank debt internally with expected-interest, then float the top items into the shared backlog with a WSJF/CD3 score so they compete honestly with features.

> **Key insight:** WSJF and CD3 are the same rule — *Cost of Delay over duration* — one dressed in SAFe's component scores, one demanding real dollars. Both reduce to: **do the thing that bleeds the most money per week and finishes soonest, first.** For debt, "money bled per week" is your interest term `r · C`, so the expected-interest model and CD3 are not two competing systems — they're the debt-internal and cross-portfolio faces of one economic model. Dividing by duration is what stops a high-value, year-long mega-refactor from starving ten high-value two-day fixes.

A subtlety seniors get right: **divide by duration, always.** The most common WSJF error is ranking on Cost of Delay alone and greenlighting the giant strategic rewrite because its CoD is highest — while it consumes the capacity that ten short, high-CoD fixes needed. The `/duration` term is the whole reason WSJF beats "value sort"; dropping it quietly turns WSJF back into severity-sorting with extra steps.

---

## The Backlog-Rot Problem — Why Separate Debt Lists Die

Here is the failure that quietly defeats every framework above: you build a beautiful ranked debt register, put it in a "Tech Debt" Jira project or an epic, and **eighteen months later someone bulk-closes 200 stale tickets** because nobody can remember what half of them mean. The model was right; the *container* was fatal.

Standalone debt backlogs rot for structural reasons, not lack of discipline:

1. **They never win prioritization against features.** A separate list competes with the product backlog as a block, and "improve the codebase" loses to "ship the feature customers asked for" every planning cycle. The debt list is always next quarter's problem.
2. **They decay into noise.** Engineers file `TD-` tickets as a venting reflex ("this code is awful"). Most are severity-sorted gripes, not modeled debt. The signal (the high-`r·C` items) drowns in the noise (the frozen-god-class gripes), and triage fatigue sets in.
3. **The context evaporates.** A debt ticket written in March is incomprehensible by September: the file moved, the smell shifted, the engineer left. A ticket that says "refactor the OrderService" is worthless without the *why now* and the *what specifically* — and that context lives in the code, not the ticket.
4. **No natural trigger fires.** A standalone ticket has no event that says "now is the moment." It waits for a mythical "debt sprint" that planning keeps deferring. Without a trigger, even correctly-prioritized debt never gets a turn.

The senior response is to **attach paydown to the work that already touches the code**, not to maintain a parallel list. Two mechanisms, both of which beat a separate backlog precisely because they don't rot:

- **Attach debt to the feature that touches the file.** When a story will modify the pricing-rules tangle anyway, the paydown rides *inside that story* (or as a linked sub-task that ships with it). This is the single most important practice in this whole topic, because it aligns paydown with churn *automatically*: you only ever pay down debt in code you're already touching — which is exactly the high-`C` code the model says to prioritize. The feature carries the debt fix in, and the fix can't go stale because it's done *now*, while the context is live. Churn-aligned paydown is the model's recommendation enforced by workflow, not willpower.

- **The Boy-Scout Rule** — *leave the code a little better than you found it.* Every change makes a small, opportunistic improvement to the code it passes through. This out-performs a debt list for the same reason: it's triggered by contact, so effort flows automatically to the hottest (most-touched) code without anyone ranking anything. The hot files get continuously improved because they're continuously visited; the frozen files are left alone because nobody visits them — which is *exactly* the prioritization the expected-interest model prescribes, achieved with zero tickets. It's the model running as a reflex.

Why these dominate a register: a standalone ticket's value *decays* with time (context rots, code drifts), while contact-triggered paydown's value is *realized at the moment of contact*, when context is maximal and the code is already open in someone's editor. You're not fighting decay; you're paying down at the one moment the cost of touching the code is already sunk.

This does **not** mean "abandon all tracking." Large, cross-cutting debt — an architectural seam, a framework migration — is too big to ride inside one feature and genuinely needs to be a tracked, WSJF-ranked, *scheduled* item (that's §5's "dedicated paydown"). The rule of thumb:

- **Small/local debt** → no ticket; fix it via boy-scout rule or fold it into the touching feature. A ticket would rot before it's actioned.
- **Large/architectural debt** → a tracked, scheduled, WSJF-ranked initiative with a *named owner and a why-now*, revisited every planning cycle so it can't quietly age out.

And if you *do* keep a register, treat staleness as a first-class signal: an item untouched for two quarters is telling you its `r · C` was never high enough to matter — **close it on purpose**, with a note, rather than letting it accumulate into the eventual bulk-close. A register that auto-expires low-priority items is a register that doesn't rot.

> **Key insight:** A separate debt backlog rots because its items lose context with age, never beat features in planning, and have no trigger to fire. **Attaching paydown to the feature that touches the code** and the **boy-scout rule** both out-perform a list — not because they're more disciplined, but because they're *contact-triggered*, which automatically routes effort to high-churn code (the model's exact answer) and realizes the fix while context is live instead of letting it decay. Track only the big debt that can't ride a feature, give it an owner and a why-now, and expire the rest on purpose.

---

## Deciding the Paydown Budget

Once you can rank debt, the next question is *how much* capacity to spend on it — the "what percent of each sprint goes to paydown?" decision. This is the bridge to [§5 — Paying Down Debt](../05-paying-down-debt/senior.md), which covers execution in depth; here is the senior framing of the *budget* itself.

The naive answers are both wrong. **"Zero, until it's a crisis"** lets interest compound until the team is doing nothing *but* paying interest — every feature drowns in workarounds, and velocity collapses. **"A big dedicated debt sprint once a quarter"** is binge-and-purge: debt accrues for twelve weeks, you blitz it, and it immediately starts accruing again, while the dedicated sprint itself competes with — and usually loses to — feature pressure (and tends to attract severity-sorted, not interest-sorted, work). Neither sustains.

The senior default is a **standing percentage of capacity** — a *debt budget* — typically **15–20%** of each iteration's capacity reserved for paydown, spent continuously rather than batched. Why a standing percentage:

- It makes paydown **non-negotiable and recurring**, so it can't be deferred to a debt sprint that never comes. The budget is a *constraint*, like a quality gate, not a request that competes each sprint.
- It matches the **continuous** nature of debt accrual — you pay it down as fast as it accumulates, holding the line, instead of letting it spike and crashing it down.
- It dovetails with contact-triggered paydown: the budget is the slack that *funds* the boy-scout rule and the in-feature fixes, so "leave it better" has somewhere to draw effort from instead of being unpaid overtime.

How to *set* the number rather than pluck it:

- **Calibrate to interest, not to a fashion.** If your hotspot map shows interest compounding (lead time on hot files rising, defect rate climbing), the budget is too low — raise it until the trend flattens. If hot-file metrics are stable, hold. The budget is a control loop with a measured error signal (the §2 metrics), not a constant copied from a blog post.
- **Vary it by lifecycle.** A greenfield product pre-fit can run near 0% (the code's lifetime is uncertain — high churn, but `L` is unknown, so don't over-invest). A mature, high-churn product carrying years of debt may need 25–30% to dig out. A stable product in maintenance may need only 5–10%. The right budget tracks where the system is in its life — which is the `L` and `C` terms of the model showing up at the portfolio level.
- **Spend it top-of-rank.** The budget says *how much*; the expected-interest ranking says *on what*. A budget spent on severity-sorted busywork buys nothing; the same budget spent on the top of the `r·C·L − F` list compounds. Budget and ranking are a pair — neither works alone.

> **Key insight:** Don't binge-and-purge debt; fund a **standing 15–20% paydown budget** spent continuously, and *tune the percentage to the interest signal* from your hotspot metrics — raise it when lead time on hot files trends up, lower it when stable. The budget answers *how much* capacity; the expected-interest ranking answers *on what*; the boy-scout rule and in-feature fixes are *how the budget gets spent* without a rotting backlog. The full execution mechanics are [§5](../05-paying-down-debt/senior.md).

---

## Prioritization Anti-Patterns

Even with the right model, the *social* process around prioritization reintroduces bias. Each of these is a way the ranking gets hijacked by something other than expected interest — name them so you can call them out in the room:

1. **Squeaky-wheel prioritization.** The debt that gets paid is the debt someone complains about loudest, not the debt with the highest `r·C·L`. The hotspot map is the antidote: it's *measured*, so it ranks code that quietly taxes everyone over code that has a vocal advocate. When someone insists on their item, ask for its churn — if the file is barely touched, the squeak is louder than the cost.

2. **Recency bias.** The bug you debugged *yesterday* feels like the most urgent debt today, regardless of how often that code is actually touched. One painful incident in a rarely-touched module is `C=1` — a single touch — even though the memory is vivid. The model deliberately uses *expected future churn*, which is dominated by long-run history, not last week's drama. Recency inflates `r` in your memory while leaving `C` untouched in reality.

3. **The loudest engineer's pet file.** A senior engineer wants to refactor the module *they* find ugly — often a deep-but-stable piece they have strong aesthetic opinions about, frequently the frozen-god-class case. Authority substitutes for evidence. The fix is the same number: "What's its churn and remaining lifetime?" Aesthetics aren't an interest rate. If `C` and `L` are low, it's a personal-taste project, not a portfolio priority — fund it from someone's slack, not the debt budget.

4. **Severity laundering.** Pasting the analyzer's `critical/major/minor` straight into priority order — covered at length in §3 — because the tool *feels* objective. It measures badness-in-isolation, not cost-over-time. Severity is an *input to `r`*, not the rank.

5. **Round-number budgeting / cargo-culting the percent.** Adopting "20% for debt" because a conference talk said so, without tying it to your own interest signal — then either underfunding a debt-laden codebase or overspending on a clean one. The percentage is a *control output*, not a constant (see §9).

6. **Big-bang bias.** Greenlighting the one giant strategic rewrite (highest *absolute* Cost of Delay) while ten short, high-CoD fixes starve — the WSJF error of ranking on CoD without dividing by duration. The size of a debt is not its priority; its CoD *per unit of capacity* is.

The through-line: every anti-pattern substitutes a *salient* signal (loud, recent, senior, tool-stamped, big, fashionable) for the *modeled* one (`r · C · L − F`, discounted). The defense is always the same move — convert the argument into the model's terms and ask for the missing number, usually **churn**. "How often do we touch it?" dissolves more bad prioritization arguments than any other question.

> **Key insight:** Prioritization gets hijacked by salience — loudness, recency, seniority, tool-labels, size, fashion — not by malice. The universal defense is to redirect every "this is important" into "what's its churn and remaining lifetime?" The hotspot map is the great equalizer because it's measured: it can't be argued with by the loudest voice in the room, only by better data.

---

## Mental Models

- **Debt is a portfolio; prioritization is allocation under uncertainty.** You hold many positions and have scarce capital (paydown capacity). Allocate to the highest risk-adjusted return — interest stopped, net of fix cost, in today's money. Sorting by "how bad each position looks" is not allocation; multiplying rate by quantity is.

- **Severity is the rate; churn is the quantity; multiply them.** The analyzer's `critical/minor` sets how expensive each touch is (`r`); the hotspot map sets how many touches there are (`C`). Interest is the product. A high rate on near-zero churn is near-zero interest — which is why the frozen `blocker` ranks below the daily `minor`.

- **Remaining lifetime is the silent veto.** Debt in code that's about to be deleted can accrue only a little more interest no matter how high the rate. "We're rewriting this anyway" is a legitimate *defer*, encoded as a small `L`. Always ask how long the code lives before ranking the debt in it.

- **WSJF and the expected-interest model are one instrument, two lenses.** "Interest per period" (`r · C`) *is* a Cost of Delay. The expected-interest model ranks debt internally (with lifetime and fix cost); WSJF/CD3 floats debt into the shared backlog to compete with features. Same economics; pick the lens for the question.

- **Contact-triggered paydown is the model running as a reflex.** The boy-scout rule and in-feature fixes route effort to whatever code you touch — which is the high-churn code the model already says to prioritize. They achieve the ranking *automatically*, with no register to rot, by realizing the fix at the moment of contact when context is maximal.

- **A backlog rots; a budget plus a trigger doesn't.** Items lose context with age and lose every planning fight. Replace the standalone list (for small debt) with a standing % budget (how much) + contact triggers (when) + the expected-interest ranking (on what). Track only the big debt that can't ride a feature — with an owner and a why-now.

---

## Common Mistakes

1. **Sorting by analyzer severity.** `critical/major/minor` measures badness-in-isolation, not cost-over-time. It's an input to the interest *rate*, not the priority. Multiply rate by *churn* (and lifetime), or you'll pour effort into frozen blockers while daily-touched minor smells tax every feature.

2. **Ignoring churn (the `C` term).** The single factor that flips priorities relative to severity. Without it you can't tell the frozen god-class (`C≈1`, leave it) from the daily tangle (`C=40`, fix it first). Always pull churn from version control before ranking.

3. **Ignoring remaining lifetime (the `L` term).** Refactoring code that's being deprecated next quarter spends your budget on interest that will never accrue. Multiply by remaining life; "it's leaving soon" is a real reason to defer.

4. **Ranking WSJF on Cost of Delay without dividing by duration.** This greenlights the one giant rewrite while ten short high-CoD fixes starve. The `/duration` term is the entire reason WSJF beats value-sorting; dropping it is severity-sorting with extra steps.

5. **Maintaining a standalone "Tech Debt" backlog and expecting it to drive paydown.** It loses context with age, loses every planning fight against features, and gets bulk-closed. Attach paydown to the feature that touches the code and use the boy-scout rule; track separately *only* the big debt that can't ride a feature.

6. **Binge-and-purge via quarterly debt sprints.** Debt accrues continuously, so pay it down continuously with a standing 15–20% budget. A once-a-quarter blitz lets interest spike, competes with (and loses to) feature pressure, and tends to attract severity-sorted busywork.

7. **Treating the budget percentage as a constant.** 15–20% is a starting point, not a law. Tune it to your interest signal — raise it when lead time on hot files trends up, lower it when metrics are stable, vary it by product lifecycle. It's a control output, not a number from a blog post.

8. **Letting salience set priority.** Squeaky wheels, last week's incident, the senior's pet file. Every one substitutes loud/recent/authoritative for *modeled*. Redirect each to "what's its churn and remaining lifetime?" — the hotspot map can't be out-argued, only out-measured.

---

## Test Yourself

1. A static analyzer flags a `blocker`-severity god-class in a payments module that hasn't been edited in two years, and a `minor`-severity tangle in a pricing file touched 40 times last quarter. Which do you prioritize, and what's the one-sentence justification?
2. Write the expected-interest model as a formula and name what each term represents. Which single term, if dropped, collapses it back to severity-sorting?
3. You're told "we should refactor the legacy reporting service." Before ranking it, what two questions do you ask, and which model terms do they pin down?
4. State WSJF. Explain why dividing by duration matters, and what failure occurs if you rank on Cost of Delay alone.
5. How is the interest term (`r · C`) of the expected-interest model related to Cost of Delay? When do you use the expected-interest model vs WSJF/CD3?
6. Your org keeps a "Tech Debt" Jira project that's grown to 300 tickets, mostly stale. Diagnose *why* it rotted, and name two mechanisms that out-perform it for small/local debt and *why* they don't rot.
7. A senior engineer pushes hard to refactor a deep, stable module they find ugly (low churn, long remaining life). Which anti-pattern is this, and what's the deciding question?
8. How do you set the paydown *budget*, and why is "one big debt sprint per quarter" inferior to a standing percentage?

<details>
<summary>Answers</summary>

1. **The `minor` pricing tangle.** Debt charges interest only when you touch the code; the god-class has near-zero churn (≈free despite its severity), while the daily-touched tangle compounds every sprint. Severity is the per-touch *rate*; churn is the *quantity* — and 40 touches × a small rate beats 1 touch × a huge rate.

2. `Net Value = Σ_{t=1..L} (r·C)/(1+d)^t − F  ≈  r·C·L − F`. **`r`** = interest rate (extra cost per touch, set by severity/complexity); **`C`** = expected future churn (touches/period, from the hotspot map); **`L`** = remaining lifetime; **`F`** = one-time remediation cost; **`d`** = discount rate. Drop **`C` (churn)** and it collapses to severity-sorting — ranking on the rate alone.

3. **"How often do we touch it (churn)?"** → pins `C`. **"How long until it's replaced/deprecated (remaining lifetime)?"** → pins `L`. Both are usually low for a legacy service slated for replacement, which is exactly why it should likely *defer* despite the strong feelings.

4. `WSJF = Cost of Delay / Job Duration`; schedule highest first. Dividing by duration captures "economic value per unit of scarce capacity," making it the optimal sequence for minimizing total delay cost. Rank on **CoD alone** and you greenlight the one giant high-CoD rewrite while ten short high-CoD fixes starve — you starve the capacity the short jobs needed.

5. The interest term `r · C` *is* a Cost of Delay — money you bleed per period the debt stays unpaid — so the two are the same economics. Use the **expected-interest model** to rank debt *against other debt* (it accounts for lifetime `L` and one-time fix cost `F`); use **WSJF/CD3** to float debt into the *shared backlog* so it competes with features on one currency.

6. It rotted because: items lost context with age (the code moved, the author left), it never won prioritization against features as a block, it filled with severity-sorted gripes (noise), and no trigger ever fired. Two better mechanisms for small debt: **(a) attach paydown to the feature touching the code** and **(b) the boy-scout rule**. They don't rot because they're *contact-triggered* — effort flows automatically to high-churn code (the model's answer), and the fix is realized while context is live instead of decaying in a ticket.

7. **The loudest-engineer's-pet-file** anti-pattern (authority/aesthetics substituting for evidence) — often the frozen-god-class case. Deciding question: **"What's its churn and remaining lifetime?"** Low `C` and high `L` of *stable* code means low interest; it's a taste project, fund it from slack, not the debt budget.

8. Fund a **standing 15–20% of capacity** spent continuously, and *tune the percentage to the interest signal* — raise it when lead time on hot files trends up, lower it when stable, vary by lifecycle. A quarterly **debt sprint** is binge-and-purge: debt accrues continuously so a once-a-quarter blitz lets interest spike, then competes with (and loses to) feature pressure, and tends to attract severity-sorted busywork rather than top-of-rank items.

</details>

---

## Cheat Sheet

```
THE RANKING FUNCTION (debt vs debt)
  Net Value = Σ (r·C)/(1+d)^t − F   ≈   r·C·L − F
    r = interest rate     (extra cost per touch; set by severity/complexity)
    C = expected churn    (touches/period; from the HOTSPOT MAP, roadmap-adjusted)
    L = remaining lifetime(periods before code is deleted/rewritten)
    F = remediation cost  (one-time; SQALE estimate, adjusted for blast radius)
    d = discount rate     (optional; skip for short horizons)
  Rank DESC by Net Value. Drop C → you've reinvented severity-sorting.

SEVERITY vs PRIORITY
  severity = badness of code in isolation        → an input to r
  priority = badness × your contact over time    → r · C · L − F
  ∴ a "critical" smell in frozen code  <  a "minor" smell in a hot file

FUSE THE TWO INSTRUMENTS
  hotspot map (02)  → quantities: churn=C, complexity≈r   [MEASURED]
  debt quadrant(03) → judgment: how risky / how to respond [JUDGED]
  pay first: high-churn × RECKLESS (top-right + reckless quadrant)
  defer:     low-churn anything (bottom of map) — ugliness you don't touch is free

CROSS-PORTFOLIO (debt vs features)
  WSJF = CoD / Duration         CD3 = ($/week of delay) / (weeks)
  CoD for debt = r·C  (+ unblocking value)   ALWAYS divide by duration
  duration term = the reason WSJF beats value-sort; never drop it

DON'T LET THE BACKLOG ROT
  small/local debt → NO ticket: boy-scout rule + fold into touching feature
                     (contact-triggered → auto-routes to high-churn code)
  large/arch debt  → tracked, WSJF-ranked, OWNER + WHY-NOW, revisited each cycle
  any register     → expire items stale >2 quarters ON PURPOSE

BUDGET (how much; → 05 for execution)
  standing 15–20% of capacity, CONTINUOUS (not a quarterly binge)
  tune to interest signal: hot-file lead time trending up → raise it
  vary by lifecycle: greenfield ~0% · mature/debt-laden 25–30% · maintenance 5–10%

ANTI-PATTERNS (salience ≠ priority)
  squeaky wheel · recency · loudest-engineer's pet file · severity laundering
  · cargo-cult % · big-bang (CoD without /duration)
  DEFENSE: redirect every "it's important" → "what's its churn & lifetime?"
```

---

## Summary

- **Severity-sorting is the wrong axis.** The analyzer's `critical/minor` measures the badness of code *in isolation*; priority is badness *times your contact with it over time*. A `blocker` in frozen code can — and should — rank below a `minor` in a daily-touched file, because debt only charges interest when you visit it.
- **Prioritize by expected interest, net of fix cost, discounted:** `Net Value ≈ r · C · L − F`. Severity sets the rate `r`; the hotspot map sets the churn `C`; remaining lifetime `L` caps accrual; remediation cost `F` is the price of paying it off. The worked six-item ranking shows the frozen `blocker` coming out *net-negative* while the daily `minor` is the #1 investment — an inversion no severity sort reaches.
- **Fuse the hotspot map (02) with the debt quadrant (03):** the map gives measured quantities (churn, complexity), the quadrant gives judgment (how risky, how to respond). Pay down high-churn × reckless debt first; defer low-churn debt regardless of how ugly it is.
- **WSJF and CD3 are the cross-portfolio lens** — Cost of Delay over duration — and the debt's Cost of Delay *is* its interest term `r · C`. Use the expected-interest model to rank debt internally; use WSJF/CD3 to make debt compete with features on one currency. Always divide by duration.
- **A standalone debt backlog rots** — context decays, it loses every planning fight, it gets bulk-closed. **Attach paydown to the feature that touches the code** and use the **boy-scout rule**; both out-perform a list because they're *contact-triggered*, automatically routing effort to high-churn code and realizing fixes while context is live. Track separately only the big debt that can't ride a feature — with an owner and a why-now.
- **Fund a standing 15–20% paydown budget**, spent continuously and tuned to your interest signal, rather than binge-and-purge debt sprints. The budget says *how much*; the ranking says *on what*; contact-triggered paydown is *how* it's spent without a rotting list.
- **Defend against salience.** Squeaky wheels, recency, the senior's pet file, tool-labels, and big-bang bias all substitute a loud signal for the modeled one. The universal defense is one question: *what's its churn and remaining lifetime?*

You now prioritize debt the way a portfolio manager allocates capital — by risk-adjusted return, not by how ugly each position looks — and you keep the backlog alive by triggering paydown on contact instead of curating a list that dies. The next page, [05 — Paying Down Debt](../05-paying-down-debt/senior.md), is about *executing* that paydown: boy-scout rule vs strangler fig vs dedicated initiative, refactor vs rewrite vs leave, and measuring the payoff.

---

## Further Reading

- *Managing Technical Debt* — Kruchten, Nord & Ozkaya (SEI). The rigorous treatment of debt as an economic, trackable portfolio; the source for cost/value framing of paydown decisions.
- *Software Design X-Rays* — Adam Tornhill. The hotspot map (churn × complexity) and behavioral code analysis that supply the `C` term and cut through squeaky-wheel prioritization with data.
- Don Reinertsen, *The Principles of Product Development Flow* — the definitive treatment of Cost of Delay and WSJF, and why dividing by duration is the optimal scheduling rule, not a heuristic.
- Joshua Arnold & Özlem Yüce — ["Black Swan Farming" / CD3](https://blackswanfarming.com/cost-of-delay/) — Cost of Delay in real currency, divided by duration, with the discipline of estimating `$/week`.
- *The Art of Agile Development* (Shore & Warden) and Martin Fowler's ["TechnicalDebt"](https://martinfowler.com/bliki/TechnicalDebt.html) — the boy-scout rule and the case for continuous, contact-triggered paydown over dedicated debt backlogs.
- SAFe's WSJF article — the component decomposition (value + time-criticality + risk-reduction/opportunity-enablement) / job size, useful as a scoring scaffold when dollar estimates are hard.

---

## Related Topics

- [02 — Identifying & Quantifying](../02-identifying-and-quantifying/senior.md) — the hotspot map (churn × complexity) and SQALE/remediation estimates that feed the `C`, `r`, and `F` terms of the ranking model.
- [03 — The Debt Quadrant](../03-the-debt-quadrant/senior.md) — the deliberate/inadvertent × prudent/reckless classification that supplies the *judgment* layer the hotspot map can't, and breaks ties in the ranking.
- [05 — Paying Down Debt](../05-paying-down-debt/senior.md) — executing the prioritized plan: boy-scout rule, strangler fig, dedicated vs continuous vs %-capacity paydown, and measuring payoff. (The budget question previewed here lands there in full.)
- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier set: from "keep a list" (junior) to "rank with WSJF" (middle) to operating debt prioritization across an org and its incentives (professional).
