# Measuring Docs ROI — Interview Questions

> **Roadmap:** [Documentation Quality](../README.md) → Measuring Docs ROI
> *A docs-ROI interview rarely asks "do you write good docs." It asks "leadership wants to measure the docs team by pageviews — what do you say?" and then watches whether you can separate a vanity metric from a value metric, build a defensible back-of-envelope, and admit out loud where the number is a guess. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Why Docs ROI Is Hard](#theme-1--why-docs-roi-is-hard)
3. [Theme 2 — The Metric Families](#theme-2--the-metric-families)
4. [Theme 3 — The ROI Model](#theme-3--the-roi-model)
5. [Theme 4 — Attribution](#theme-4--attribution)
6. [Theme 5 — Goodhart and Proxy Traps](#theme-5--goodhart-and-proxy-traps)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — The Qualitative Half and Honest Presentation](#theme-7--the-qualitative-half-and-honest-presentation)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **proxy vs value** (a number that's easy to move vs a number that tracks the outcome you actually want)
- **correlation vs causation** (the ticket count dropped *and* you shipped a doc vs the doc *caused* the drop)
- **cost vs benefit** (writer + maintenance hours vs deflection + hours-saved + onboarding speedup)
- **precision vs honesty** (a confident single number vs a defensible range with its assumptions on the table)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a metric — and who volunteer the weakness of their own number before the interviewer has to dig for it.

---

## Theme 1 — Why Docs ROI Is Hard

### Q1.1 — Why is measuring the ROI of documentation harder than measuring the ROI of, say, a checkout feature?

> **Testing:** Whether you understand that docs value is *indirect* and *deferred*, not just "hard to measure" in some vague sense.

**A.** A checkout feature sits *on* the revenue path — the conversion event is the value, instrumented at the moment it happens, attributable to the flow that produced it. Documentation sits *beside* the value path: it prevents a support ticket that now never exists, shortens an onboarding that you can't rerun without it, unblocks an integration whose revenue lands on the *product's* ledger, not the docs team's. The value is **counterfactual** (what *didn't* happen — a ticket not filed, an engineer not interrupted), **deferred** (a doc written today pays off across every reader for years), and **diffuse** (spread across support, engineering, sales, and churn, so no single team books it). You're measuring an absence, over time, that someone else gets credit for. That's three structural problems on top of "we forgot to add analytics."

### Q1.2 — There's a phrase, "write once, read many." Why does it matter for the ROI argument specifically?

> **Testing:** Whether you grasp the *leverage* that makes docs economically interesting in the first place.

**A.** It's the entire reason docs are a leveraged investment rather than a chore. The cost is paid **once** by one writer; the benefit is collected **every time** anyone reads it, by everyone who reads it, for as long as it stays accurate. A page that takes four hours to write and is read by 2,000 engineers each saving ten minutes has returned ~330 engineer-hours against a four-hour cost — roughly **80×**. That ratio is the headline of any honest docs-ROI pitch: the denominator is small and fixed, the numerator scales with the audience and the doc's lifetime. It also tells you *which* docs to measure — the high-traffic, high-stakes, long-lived ones, where the multiplier is largest — and it's why maintenance matters: a stale doc doesn't just stop returning value, it goes *negative* by misleading every one of those readers.

### Q1.3 — A skeptical VP says, "If we can't measure docs ROI cleanly, maybe it's not worth measuring." How do you respond?

> **Testing:** Whether you can defend measurement-under-uncertainty without overclaiming.

**A.** I'd separate "measure cleanly" from "measure usefully." We can't get a clean experimental number, and I won't pretend otherwise. But "unmeasurable precisely" is not "unmeasurable at all" — and it's certainly not "worthless." We can build a defensible **estimate with explicit assumptions** (deflection × cost-per-ticket, plus engineer-hours saved) and present it as a *range*, the same way the company already estimates pipeline, LTV, or the value of a reliability project — none of which are clean either. The alternative to a transparent estimate isn't "no number"; it's an *implicit* number of zero, which is the least defensible estimate of all. So the answer is: measure to the precision the decision needs — usually "is this worth a headcount," not "is this worth $412,309" — and be loud about the error bars.

---

## Theme 2 — The Metric Families

### Q2.1 — Lay out the families of docs metrics and rank them by how much they actually tell you about value.

> **Testing:** The single most important taxonomy in the topic — can you separate proxies from real outcomes?

**A.** Four families, roughly weakest to strongest as *value* signals:

1. **Engagement** — pageviews, time-on-page, scroll depth, search queries. The **weakest** proxies. They measure *attention*, not success: high time-on-page can mean "engrossing" or "lost and re-reading." Useful only as **guardrails and diagnostics**, never as the goal.
2. **Task-success** — did the reader accomplish what they came to do? Measured by post-task "did this solve your problem?", completion of the documented flow, or a drop in the follow-up support contact. The **strongest** family, because it's closest to the outcome the doc exists to produce.
3. **Deflection** — support tickets / chats avoided because the doc answered the question first. A **real** value signal *and* the easiest to translate into money (× cost-per-ticket), but the trickiest to attribute (see Theme 4).
4. **Onboarding** — time-to-first-commit, time-to-productive, ramp surveys. A **real** and high-value signal for internal docs specifically, because the cost being saved (senior-engineer mentoring hours + delayed productivity) is large and well understood.

The ranking trap to avoid: engagement is the *easiest to collect*, which is exactly why it gets over-weighted. Easy-to-measure and meaningful are nearly inversely correlated here.

### Q2.2 — Why exactly is "pageviews" a weak proxy? Be specific about how it misleads.

> **Testing:** Whether your critique of vanity metrics is mechanical, not just received wisdom.

**A.** Pageviews are *directionally ambiguous* — the same movement can mean opposite things. Views can rise because the feature got popular (good), because the docs are so confusing people keep coming back (bad), or because an error message links there and the error is now firing constantly (very bad). They can *fall* because the docs got so good people stopped needing them (excellent) or because the feature was deprecated (neutral). A metric where up can be good or bad and down can be good or bad carries almost no decision content on its own. It's a fine **denominator** ("of the people who landed here, what fraction succeeded?") and a fine **anomaly detector** ("this page 5×'d overnight — what broke?"), but as a standalone success number it's noise dressed as signal.

### Q2.3 — Thumbs-up/thumbs-down widgets are everywhere. What are they good for and what are they not?

> **Testing:** Whether you understand response bias and what a 👍 rate actually represents.

**A.** They're good for **localized diagnostics** — a sudden spike in 👎 on one page is a cheap "look here" flag, and the *free-text* attached to a 👎 ("the curl example 401s") is often the single most actionable thing you'll get. They're bad as a **headline metric**, for three reasons. First, **massive self-selection**: a tiny, non-random slice clicks, skewed toward the angry and the delighted, so the rate isn't the population's experience. Second, **no denominator of intent** — a 👎 doesn't tell you whether they failed the task or just disliked the tone. Third, they're **trivially gameable** the moment they become a target (Theme 5). So: use the trend and the comments to *find* problems; never report the raw 👍 rate as "doc quality" or tie a goal to it.

### Q2.4 — Which single metric would you pick as a north star for a developer-docs portal, and why not the others?

> **Testing:** Synthesis — can you commit to a value metric and justify the rejection of the popular ones?

**A.** **Task-success rate** — concretely, the share of readers who complete the documented job, proxied by "self-reported success on the page *and* no support contact on that topic within N days." I pick it because it's the metric that, if it goes up, the *business* outcome we care about (developers integrate successfully, with less help) has genuinely improved — the metric and the goal point the same way. I reject **pageviews** (directionally ambiguous), **time-on-page** (lower can be better *or* worse), and raw **👍 rate** (response-biased and gameable) as *north stars*, while keeping all three as **guardrails** so I notice when chasing task-success quietly wrecks something else. One value north star, several cheap guardrails — never a vanity metric promoted to the goal.

---

## Theme 3 — The ROI Model

### Q3.1 — Write out the basic ROI model for a documentation effort. What's in the cost side and what's in the benefit side?

> **Testing:** Whether you can name *all* the real terms, especially the ones people forget (maintenance, onboarding).

**A.** ROI is benefit minus cost over cost; the discipline is enumerating both honestly.

**Cost** — and this is where people undercount:
- **Creation**: writer-hours (or engineer-hours, often more expensive) to research, draft, review, and publish.
- **Maintenance**: the recurring cost to keep it true — the term juniors forget. A doc isn't a capital expense you pay once; it's a *subscription* you pay every release, and it dominates total cost over a multi-year life.
- **Tooling/review**: the platform, the review time, the CI that lints links.

**Benefit**:
- **Ticket deflection** = (tickets avoided) × (fully-loaded cost per ticket).
- **Engineer-hours saved** = (readers) × (time saved per read) × (loaded hourly cost) — the write-once-read-many term.
- **Onboarding speedup** = (new hires) × (days of ramp saved) × (loaded daily cost), plus the mentoring hours *not* spent by senior engineers.
- Softer but real: faster sales/integration cycles, lower churn from frustration, fewer incidents from misconfiguration.

The number is only as honest as the cost side. Quoting benefits while hiding maintenance is the most common way docs-ROI pitches get correctly torn apart.

### Q3.2 — Do a back-of-envelope. A page costs 8 hours to write and ~2 hours/year to maintain. It gets 500 unique readers a month, ~30% would otherwise have filed a support ticket, and each ticket costs the company $40 fully loaded. Is it worth it over one year?

> **Testing:** Whether you can actually run the arithmetic and sanity-check the result, not just recite the formula.

**A.** Let me lay out the assumptions and compute.

- **Cost (year 1)**: 8h creation + 2h maintenance = 10 engineer-hours. At a loaded ~$75/h, that's **~$750**.
- **Deflection benefit**: 500 readers/month × 12 = 6,000 reader-visits/year. Not all are unique people and not every visit equals an avoided ticket, so I'll be conservative and treat the 30% as applying to readers who *had a question this page answered* — say I haircut the 6,000 to ~3,000 "question-shaped" visits to avoid double-counting repeat readers. 30% × 3,000 = **900 tickets deflected** × $40 = **$36,000**.
- **ROI**: ($36,000 − $750) / $750 ≈ **47×**.

Even if every assumption is off by half — half the readers, half the deflection rate — it's still ~12×. So the answer is an emphatic yes, and the *reason* it's robust is the write-once-read-many leverage: the cost is fixed and tiny, the benefit scales with an audience of thousands. I'd present it as "**conservatively 10–50× in year one**," show the haircuts I applied, and flag that the deflection rate is the assumption most worth validating with a holdout (Theme 4).

### Q3.3 — Where do most back-of-envelope docs-ROI models go wrong?

> **Testing:** Whether you've actually built one and gotten burned, or only seen the clean version.

**A.** Four predictable failure modes. **(1) Forgetting maintenance** — modeling docs as a one-time cost, so the denominator is too small and the multi-year picture is rosy. **(2) Double-counting readers as deflections** — equating a pageview with an avoided ticket, when many readers would have self-served anyway, never had a ticket-worthy question, or are the *same person* returning. **(3) Single-point precision** — quoting "$36,000" instead of a range, which invites someone to attack the exact figure and discredit the whole model. **(4) Ignoring the counterfactual** — assuming the doc caused 100% of an observed ticket drop when the feature also got more stable that quarter. The fix for all four is the same posture: **haircut aggressively, present a range, and state every assumption inline** so the reader audits the assumption, not your honesty.

### Q3.4 — Your model says a doc returns 47×. A VP asks, "so we should write infinitely more docs?" What's the flaw in that reasoning?

> **Testing:** Marginal vs average ROI — a senior economic instinct.

**A.** That 47× is the **average** return of a *good, high-traffic* page, not the **marginal** return of the *next* page. Docs have steeply diminishing marginal returns: the first doc for a popular feature captures most of the deflection; the tenth doc on an obscure edge case is read by twelve people and may cost more to maintain than it ever saves. So the right framing isn't "docs are 47×, write infinitely many" — it's "the *highest-leverage* docs are 47×, so prioritize by expected leverage (traffic × stakes × longevity) and stop when the marginal doc's expected return crosses the maintenance cost." Some docs have *negative* marginal ROI — they exist, go stale, and mislead. The model justifies *prioritized* investment, not unbounded investment.

---

## Theme 4 — Attribution

### Q4.1 — You publish a troubleshooting guide, and support tickets on that topic drop 30% the next month. Did the doc cause it? How do you know?

> **Testing:** The central causal-inference trap of the whole topic — correlation vs causation.

**A.** I *don't* know, not from that alone — this is correlation, and I'd resist the temptation to bank it as causation. Docs measurement is almost always **observational, not experimental**: I changed one thing in a world where many things change. The 30% drop could be the doc, or it could be a **confounder** — the engineering team shipped a fix that month so the underlying problem occurs less, the feature's usage seasonally dipped, a noisy customer churned, or support reclassified the ticket category. To actually attribute it I need to rule those out: check whether the *bug-fix* timeline overlaps, whether *usage* changed, whether *other* topics dropped too (suggesting a portal-wide or seasonal effect, not this doc). Absent a controlled comparison, the honest statement is "tickets dropped 30% **coincident with** the guide; here's the confounder check that makes the doc the most likely driver" — not "the guide deflected 30%."

### Q4.2 — Given that you usually can't run a clean experiment on docs, what methods get you closer to a causal claim?

> **Testing:** Whether you know the quasi-experimental toolkit, not just "do an A/B test."

**A.** In rough order of rigor and feasibility:

- **A/B test** — randomly show some users the new doc (or a docs link in the error/empty state) and some not, then compare task-success or ticket rate. Cleanest, but often impossible for docs: you can't ethically *hide* documentation from half your users, and SEO/shared-link traffic leaks across arms.
- **Holdout / cohort comparison** — withhold a doc-driven change from one segment (a region, a tier, a set of accounts) and compare. A pragmatic stand-in when full randomization isn't available.
- **Interrupted time-series (ITS)** — model the metric's *trend before* the doc and test whether there's a statistically real **level or slope change at the publish date**, beyond the pre-existing trend. The workhorse for docs because publish dates are sharp and you usually have history. Stronger still with a **control series** (a comparable topic you *didn't* touch) — difference-in-differences — so a portal-wide or seasonal shift doesn't masquerade as your doc's effect.

The meta-point: I can't always randomize, but I can almost always (a) establish a baseline trend, (b) find a control group that *wasn't* exposed, and (c) check the timing lines up. That trio turns a coincidence into a defensible attribution.

### Q4.3 — Walk me through the confounders you'd actively check before claiming a doc deflected tickets.

> **Testing:** Whether your causal caution is concrete or just a disclaimer you recite.

**A.** I'd enumerate the plausible alternative explanations and check each: **(1) Product change** — did engineering ship a fix, better error message, or UX change on that flow the same window? That alone can explain a drop. **(2) Usage/traffic** — did the feature's active-user count fall (fewer users → fewer tickets, doc irrelevant)? Normalize tickets *per active user*, not absolute. **(3) Seasonality / calendar** — holidays, end-of-quarter, a region offline. **(4) Support-side changes** — re-tagging, a new deflection bot, changed staffing or hours, a macro that auto-closes. **(5) Composition shift** — a big noisy customer churned or onboarded. **(6) Mean reversion** — the prior month was an anomalous spike, so any next month looks like a "drop." The discipline is that I list these *before* I look at the result, so I'm testing the doc's effect against rivals rather than rationalizing a number I've already decided to like.

### Q4.4 — Leadership wants "the docs team deflected $2M in support cost this year" for the board deck. You ran the numbers and it's defensible-ish but soft. How do you present it?

> **Testing:** Intellectual honesty under pressure to produce a clean, flattering number.

**A.** I present it as an **estimate with its method visible**, not a measured fact, because a number that gets challenged and *folds* does more damage than a smaller number that holds. Concretely: "Our model estimates **$1.5M–$2.5M** in avoided support cost, central case ~$2M. It's built from measured deflection on instrumented pages plus a modeled rate elsewhere; the largest assumption is the deflection rate, which an interrupted-time-series on our top guides supports within this range." I'd resist the single bolded "$2M" if it's softer than that implies, and I'd never launder a guess into a precise figure for the optics — the first sharp question from a skeptical board member ("how do you know the doc, not the bug-fix, deflected those?") would unravel it and discredit *every* number the docs org ever reports. A credible range with a named method survives that question; false precision doesn't.

---

## Theme 5 — Goodhart and Proxy Traps

### Q5.1 — State Goodhart's law and give the canonical docs example.

> **Testing:** Whether you can connect the abstract law to a concrete, predictable docs failure.

**A.** **"When a measure becomes a target, it ceases to be a good measure."** Once you *reward* a proxy, people optimize the proxy, severing it from the thing it used to indicate. The canonical docs example: you set a **pageviews OKR**. Pageviews were a half-decent attention proxy *while nobody was gaming them*. The moment they're the goal, the team writes clickbait titles, splits one good page into five to multiply views, adds "related" link-bait, and SEO-stuffs — pageviews climb, **task-success flatlines or drops**, and the metric now measures the team's gaming skill rather than the docs' helpfulness. The proxy didn't just stop working; optimizing it actively *degraded* the real outcome.

### Q5.2 — What is surrogation, and why is it the more insidious version of this problem?

> **Testing:** A precise concept that separates people who've thought hard about metrics from those who've heard "Goodhart" once.

**A.** **Surrogation** is when people *mentally replace* the real goal with its metric — they stop believing the metric is a *stand-in* for "helpful docs" and start believing the metric **is** the goal. It's more insidious than ordinary gaming because it's not cynical cheating; it's sincere. A well-meaning writer who has surrogated "👍 rate" for "helpful docs" will genuinely optimize for thumbs-up — softening accurate-but-unwelcome warnings, burying caveats that depress the score — and feel they're doing great work, because in their mental model the score *is* the work. You can't fix surrogation with an anti-gaming rule; you fix it by **constantly re-anchoring the team on the real outcome** the metric is supposed to approximate, and by pairing every proxy with the value metric it's meant to serve so the gap stays visible.

### Q5.3 — How do you design a metric system that's resistant to Goodhart?

> **Testing:** The constructive half — not just "metrics are dangerous" but a concrete defense.

**A.** Four moves. **(1) Make the *target* a value metric, not a proxy** — set the goal on **task-success**, the thing you actually want, so optimizing it is mostly good. **(2) Pair every target with a guardrail that moves the opposite way under gaming** — task-success as the north star, with **traffic and 👎-comments as guardrails**, so if someone games success by hiding hard content, a guardrail twitches. **(3) Prefer metrics that are expensive to fake** — a verified drop in *support contacts on the topic* is far harder to game than a 👍 button. **(4) Hold the metric loosely and rotate** — treat any single number as a *current* lens, re-validate that it still correlates with the outcome, and be willing to change it before it ossifies. The summary heuristic: **one value north star, several cheap guardrails, and permission to distrust the number** when it and reality disagree.

### Q5.4 — A manager proposes tying writer bonuses to the 👍 rate on their pages. Argue against it.

> **Testing:** Whether you can apply Goodhart predictively to a specific incentive design.

**A.** It will get you exactly the behavior the incentive rewards, which is *not* the behavior you want. Tie pay to 👍 and writers will optimize 👍: avoid documenting unpleasant truths (rate limits, breaking changes, sharp edges) because warnings depress thumbs; chase upbeat tone over accuracy; and — since the widget is response-biased and trivially clickable — some will find ways to nudge the sample. The metric is a **weak, gameable proxy** for helpfulness, and the moment money rides on it, the gap between "high 👍" and "actually helpful" widens. If you must incentivize, attach it to a **harder-to-fake value outcome** (verified task-success / topic-level deflection) and *use 👍 only as an un-incentivized diagnostic*. Better still: don't bonus on a single number at all — reward demonstrated *impact* reviewed in context, precisely because any single docs metric is too easy to game to bear a financial target.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — Prove the docs team deserves another headcount. Build the case.

> **Testing:** End-to-end application — can you assemble cost, benefit, attribution, and honesty into a persuasive but defensible ask?

**A.** I'd build it as a **marginal-ROI argument with a named bottleneck**, in four beats:

1. **The leverage baseline.** Show the existing high-traffic docs already returning ~10–50× (the back-of-envelope from Theme 3, with assumptions visible), to establish that *docs investment here pays*.
2. **The unmet demand.** Quantify the gap: top search queries with no good result, the backlog of high-deflection-potential pages we can't get to, the support tickets clustering on under-documented topics — i.e., known demand we're leaving on the table. This is from [Docs Coverage and Gaps](../04-docs-coverage-and-gaps/interview.md).
3. **The marginal case for *one more person*.** Estimate what that next writer can plausibly produce against the *highest-leverage* unwritten docs, and show the modeled deflection + hours-saved comfortably exceeds the fully-loaded cost of the hire — presented as a **range**, conservative case first.
4. **The honesty.** State plainly which numbers are measured (deflection on instrumented pages) and which are modeled, and what I'd commit to measuring *post-hire* (a holdout or ITS on the new docs) to validate the bet. 

The case is strong precisely because it's marginal ("the next person against the best unwritten docs"), tied to demonstrated demand, and doesn't overclaim. A pitch that says "docs are good, we're busy" loses; one that says "here's the modeled return of the next hire, here's the demand, here's how I'll prove it worked" wins.

### Q6.2 — Leadership decides to measure the docs team by pageviews. What do you say?

> **Testing:** Whether you can push back on a vanity metric *constructively* — redirect, don't just refuse.

**A.** I wouldn't reject measurement — I'd redirect it to a metric that won't backfire. I'd say: "Pageviews are great as a **health signal**, but as a **target** they'll actively hurt us — the fastest way to grow pageviews is clickbait titles, page-splitting, and link-bait, none of which help a single reader, and some of which make docs worse (Goodhart). Worse, *falling* pageviews can mean we got so good people stopped needing the page — so we'd be punished for success. Let's target the thing we actually want — **task-success** (did the reader accomplish the job, proxied by self-reported success plus no follow-up ticket) — and keep **pageviews as a guardrail and anomaly detector** alongside it." Then I'd offer to stand up the task-success instrumentation so the alternative is concrete, not just an objection. The move is: agree with the *intent* (accountability), reject the *proxy*, and hand them a better target in the same breath.

### Q6.3 — You just shipped a new tutorial. How would you measure whether it worked?

> **Testing:** Operationalizing measurement for a *single artifact* — baseline, value metric, attribution, all in miniature.

**A.** I'd decide *what "worked" means* first, then instrument for attribution:

1. **Define success up front** — for a tutorial, "worked" = readers who start it **complete the documented task** and **don't then file a support ticket** on it. That's the value metric; I set it before launch so I'm not retrofitting a flattering definition.
2. **Establish a baseline** — the pre-tutorial task-success / ticket rate on this topic, so I have a *before* to compare against (an interrupted-time-series setup).
3. **Instrument task-level signals** — completion of the tutorial's final step, an end-of-tutorial "did this work?" prompt, and the topic's support-contact rate over the following weeks.
4. **Attribute carefully** — watch for the publish-date level change in the time series, and if possible compare against a control topic I *didn't* touch (difference-in-differences) so a portal-wide change doesn't get miscredited. Check the obvious confounder: did the feature itself change at the same time?
5. **Read the qualitative** — the free-text on the "did this work?" prompt and the *shape* of any remaining tickets ("step 4 errors") tell me *why*, which the numbers can't.

Then I report it as "task-success on this topic rose from X to Y, coincident with the tutorial, with the bug-fix timeline ruled out" — a value metric, a baseline, and an attribution caveat, for one artifact.

### Q6.4 — Two docs initiatives, one budget. One adds API reference for a heavily-used endpoint; one writes conceptual guides for a new, low-traffic product. How do you choose?

> **Testing:** Prioritization by *expected* leverage under uncertainty, including the strategic exception.

**A.** Default to **expected leverage = audience × stakes × longevity**, which points hard at the high-traffic API reference: large existing audience, high deflection potential (people hit it constantly and file tickets when it's wrong), long life. That's the bigger *measurable* near-term ROI, so absent other factors it wins. **But** I'd name the exception explicitly: if the low-traffic product is a **strategic bet** the company is funding to grow, its docs are an *investment in future* traffic, and judging it on *today's* pageviews is the classic vanity-metric error (low traffic *because* it's new, partly *because* docs are thin). So the real answer is: fund the API reference for immediate, defensible ROI **and** carve out a smaller, *explicitly strategic* slice for the new product, measured against **leading indicators** (activation, integration starts) rather than current traffic — and say out loud that the second one is a bet, not a deflection play, so it's judged on the right yardstick.

---

## Theme 7 — The Qualitative Half and Honest Presentation

### Q7.1 — You've got dashboards full of numbers. Why is the qualitative half still essential, not optional?

> **Testing:** Whether you treat metrics as the whole answer or know their blind spot.

**A.** Numbers tell you **what** moved; they almost never tell you **why**, and "why" is what you act on. A 👎 spike says a page is failing; the attached comment ("the auth example returns 401") tells you the fix. Dashboards also systematically **miss what isn't there** — the doc that *should* exist but doesn't generates no pageviews to flag it; only a reader's "I couldn't find anything on X" surfaces the gap. And metrics flatten the *texture* of failure: "task-success 60%" is a number, but five user-session recordings of people getting stuck at the same step is a diagnosis. So the qualitative half — support-ticket themes, search-with-no-result logs, user interviews, the free-text on feedback widgets — is the **causal and generative** layer the quantitative half structurally can't provide. Quant tells you where to look; qual tells you what you're looking at.

### Q7.2 — What's the "counterfactual value" of docs, and how do you talk about it without sounding hand-wavy?

> **Testing:** Whether you can make an *absence* concrete and defensible.

**A.** Counterfactual value is the value that consists of things that *didn't happen because the doc existed* — the ticket never filed, the engineer never interrupted, the integration never abandoned, the incident never triggered by a misconfiguration the doc prevented. It sounds hand-wavy only if you leave it abstract. You make it concrete the same way insurance and reliability work get measured: **estimate the base rate of the bad event without the doc, estimate the reduction, and price it** — "issues like this generated ~N tickets/month at $X each before the runbook; since it published, that category is down to ~M, and here's the confounder check." That's still an estimate, but it's a *grounded, ranged* one tied to a measured base rate, not a vibe. The trick is to anchor the counterfactual to a number you *can* observe (the historical rate of the thing you're now preventing) and present the avoided cost as a range.

### Q7.3 — Your stakeholder wants one clean number. Your honest answer is a wide range. How do you handle the tension?

> **Testing:** The professional's instinct — credibility over false precision, but without being useless.

**A.** I give them a **central estimate *and* the range, and I refuse to drop the range** — because the range *is* the information, and a single number that hides it is a liability, not a service. Concretely: "Central case ~$2M, defensible band $1.5M–$2.5M; the width is driven mainly by the deflection-rate assumption, which I can tighten with a holdout next quarter." That respects the stakeholder's need for a headline (here's the number to quote) while keeping me honest (here's how sure I am, and here's how I'd get surer). False precision feels more decisive in the room and is catastrophic the first time someone probes it — a number that collapses under one question discredits the whole function. The senior move is to be the person whose numbers *survive scrutiny*, which means shipping the uncertainty *with* the estimate, every time, and framing the band's width as a roadmap to a better number rather than an apology.

### Q7.4 — How do you choose *which* of all these metrics to actually put on a leadership dashboard?

> **Testing:** Editorial judgment — a dashboard is an argument, not a data dump.

**A.** A leadership dashboard is a **decision tool, not a data dump**, so I pick for *the decision they're making*, which is usually "is docs investment paying, and where should it go next." That means: **one value north star** (task-success, or modeled deflection $ as a range), **one or two cost/efficiency numbers** (so ROI is visible, not just benefit), and **a small set of guardrails** to show I'm watching for gaming — deliberately *omitting* the vanity metrics (raw pageviews, 👍 rate) that would invite over-indexing on the wrong thing. Engagement metrics live on the **team's operational** dashboard, where they're diagnostics, not on the **leadership** one, where they'd become accidental targets. The editorial discipline — choosing what to *leave off* — is most of the value: every metric you surface to leadership is a metric you've implicitly told them to optimize, so surface only the ones you'd be happy to see optimized.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Pageviews — value metric or proxy?** A: Weak proxy — directionally ambiguous (up or down can be good or bad); use as guardrail/anomaly detector, never as a target.
- **Q: Strongest metric family for docs value?** A: Task-success — closest to the outcome the doc exists to produce.
- **Q: One-line ROI formula?** A: (benefit − cost) / cost, where cost includes *maintenance*, not just creation.
- **Q: The cost term juniors forget?** A: Maintenance — docs are a subscription, not a one-time capex.
- **Q: Deflection benefit in one expression?** A: (tickets avoided) × (fully-loaded cost per ticket).
- **Q: Why is "write once, read many" the heart of the pitch?** A: Fixed small cost, benefit scaling with audience × lifetime — that's the multiplier.
- **Q: Correlation or causation when tickets drop after a doc ships?** A: Correlation — until you rule out confounders (bug-fix, usage, seasonality).
- **Q: Cleanest attribution method, and why is it often impossible for docs?** A: A/B test — but you usually can't ethically hide docs from half your users.
- **Q: The workhorse quasi-experiment for docs?** A: Interrupted time-series, ideally with a control topic (difference-in-differences).
- **Q: Goodhart's law in one line?** A: When a measure becomes a target, it stops being a good measure.
- **Q: Surrogation?** A: Mentally replacing the real goal with its metric — sincere, not cynical, and harder to fix.
- **Q: Anti-Goodhart design in one phrase?** A: One value north star, several cheap guardrails, permission to distrust the number.
- **Q: Marginal vs average docs ROI?** A: The high-traffic page's 47× is *average*; the next obscure doc's *marginal* return can be near zero or negative.
- **Q: Why present a range, not a point estimate?** A: A point estimate collapses under one probing question; a defensible range survives and keeps the function credible.
- **Q: What does the qualitative half give you that dashboards can't?** A: *Why* a metric moved, and the gaps that generate no data to flag.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Reaching for **pageviews** as a primary success metric without naming its ambiguity.
- Treating an observed ticket drop after a doc ships as **proven** deflection — no confounder talk.
- Quoting a **single precise dollar figure** ("$2M") with no range and no method.
- Forgetting **maintenance cost** — modeling docs as a one-time expense.
- Proposing to **bonus on a single metric** (👍 rate, pageviews) with no awareness of Goodhart.
- Confusing **average and marginal** ROI — "docs are 47×, so write infinitely more."
- Dismissing the **qualitative** half as soft or optional.

**Green flags:**
- Naming the **distinction** (proxy/value, correlation/causation, average/marginal) before reaching for a metric.
- Volunteering **confounders** and a quasi-experimental check (ITS, holdout, diff-in-diff) *unprompted*.
- Presenting numbers as **ranges with explicit assumptions**, and treating the range as information.
- Counting **maintenance** in the cost side without being asked.
- Pairing a **value north star with guardrails** and citing Goodhart/surrogation by name.
- Redirecting a vanity-metric request **constructively** — offering a better target, not just refusing.
- Anchoring **counterfactual value** to an observable base rate rather than a vibe.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **proxy vs value**, **correlation vs causation**, **cost vs benefit (incl. maintenance)**, and **precision vs honesty**. Name the distinction first; the metric follows.
- **Why it's hard:** docs value is counterfactual, deferred, and diffuse — but "unmeasurable precisely" is not "worthless." The **write-once-read-many** leverage (fixed tiny cost, benefit scaling with audience × lifetime) is the heart of every honest pitch.
- **Metric families:** engagement (weakest, directionally ambiguous — guardrails only), task-success (strongest, closest to the goal), deflection (real and monetizable but hard to attribute), onboarding (real and high-value for internal docs).
- **The ROI model:** cost = creation + **maintenance** + tooling; benefit = deflection × cost-per-ticket + engineer-hours saved + onboarding speedup. Haircut aggressively, distinguish **marginal from average**, and present a range.
- **Attribution:** docs measurement is observational, so a ticket drop ≠ caused by the doc. Rule out confounders (bug-fix, usage, seasonality); get closer with A/B (rarely feasible), holdouts, or interrupted-time-series with a control.
- **Goodhart/proxy traps:** a pageviews OKR breeds clickbait; a 👍 bonus breeds gaming; **surrogation** makes it sincere. Defend with a value north star + cheap guardrails + willingness to distrust the number.
- **Honesty:** the qualitative half supplies the *why* and surfaces gaps that generate no data; counterfactual value is real if anchored to a base rate; and a defensible range beats false precision every time it's challenged.

---

## Further Reading

- *Trustworthy Online Controlled Experiments* (Kohavi, Tang, Xu) — the standard reference for A/B testing, holdouts, and why naive attribution misleads; directly applicable to docs metrics.
- *How to Measure Anything* (Douglas Hubbard) — the canonical case that "intangible" things (including docs value) are estimable with calibrated ranges, not false precision.
- Marty Cagan / *Inspired* and the product-metrics literature on **vanity vs actionable metrics** — the proxy-vs-value distinction in product form.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- Goodhart's law and **surrogation** (Choi, Hecht & Tayler, on the surrogation effect) — primary sources for Theme 5.

---

## Related Topics

- [04 — Docs Coverage and Gaps](../04-docs-coverage-and-gaps/interview.md) — finding the unmet demand that justifies the next docs investment, and the input to the headcount case.
- [01 — What Makes Docs Good](../01-what-makes-docs-good/interview.md) — the quality dimensions that task-success and deflection are ultimately measuring.
- [Documentation Quality README](../README.md) — where measuring ROI sits in the broader documentation-quality landscape.
