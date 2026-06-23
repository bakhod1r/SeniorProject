# What Is Technical Debt — Professional Level

> **Roadmap:** [Technical Debt Management](../README.md) → [What Is Technical Debt](./) → Professional
> *The senior page taught you to name principal and interest precisely. This page is about saying it in a room where nobody writes code — to a VP who controls the roadmap, a CFO who thinks in quarters, a board that funds initiatives. Here "we need to refactor" is a losing sentence, and "this is costing us 20% of delivery capacity" is the one that gets funded. The debt is the same; the language is the entire game.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Debt in the Language of the People Who Fund It](#debt-in-the-language-of-the-people-who-fund-it)
4. [The Second-Order Costs That Never Show Up in the Code](#the-second-order-costs-that-never-show-up-in-the-code)
5. [Strategic vs Tactical Debt at Portfolio Scale](#strategic-vs-tactical-debt-at-portfolio-scale)
6. [Who Is Allowed to Authorize Debt](#who-is-allowed-to-authorize-debt)
7. [When the Organization Manufactures the Debt](#when-the-organization-manufactures-the-debt)
8. [Debt and the Build-vs-Buy / Rewrite Temptation](#debt-and-the-build-vs-buy--rewrite-temptation)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Technical debt as an organizational, financial, and leadership concern — surfacing it, pricing it, and getting it funded by people who will never read the diff.**

The earlier tiers taught you to think correctly about debt: principal vs interest, debt vs bugs vs cruft, the cases where taking on debt is the rational move. That's necessary and not sufficient. At the professional level, the bottleneck is rarely *understanding* the debt — it's that the people who control whether it gets paid down don't speak your language, can't see the code, and are measured on things (revenue, dates, headcount efficiency) that your refactor doesn't obviously move.

So the senior skill shifts. It's no longer "can I recognize and fix this?" It's "can I make a non-engineer feel the cost as clearly as I do, price it in their units, and place it against the other things competing for the same budget?" The engineer who can do that gets a quarter funded for paydown. The engineer who can't writes increasingly desperate Slack messages about how the codebase is "a disaster" and watches the roadmap fill with features anyway.

This page is about that translation layer — and about a darker truth most senior engineers learn the hard way: **the organization itself is usually the thing manufacturing the debt.** Perpetual deadline pressure, "we'll fix it later" with no later, comp and promo that reward shipped features and ignore the foundations they rest on. You cannot out-engineer an incentive system. The highest-leverage thing a senior does here is not write cleaner code — it's change what the organization sees, measures, and rewards.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — principal vs interest, the debt-quadrant lens, debt vs bugs vs cruft, when debt is rational.
- **Required:** You've shipped under a real deadline and made (or watched someone make) a deliberate shortcut.
- **Helpful:** You've sat in a prioritization meeting where engineering work lost to a feature and couldn't articulate why that was the wrong call.
- **Helpful:** You've onboarded onto a system old enough that "why is it like this?" had no living answer.

---

## Debt in the Language of the People Who Fund It

The single most common way senior engineers fail their codebase is by advocating for it in *engineering* terms to an *audience that doesn't have them*. "The code is messy," "we have a lot of tech debt," "we really need to refactor the payment module" — these are statements about how the code feels to the people who touch it. To a VP of Product, they parse as "the engineers are uncomfortable and want time to do engineering things instead of customer things." That request loses, correctly, to "ship the feature that closes the enterprise deal."

The metaphor Cunningham chose is a gift precisely because the audience already understands it. Debt is a thing the business takes on deliberately to move faster now, that accrues interest, and that you pay down with a return. Lean all the way into that frame:

- **Debt is a liability on the balance sheet, not a moral failing.** The first reframe is to stop apologizing. Carrying debt is a *decision the business made* (or let happen) to ship sooner. You're not confessing a sin; you're reporting a liability, the way finance reports any other.
- **Interest is a permanent tax on delivery velocity.** This is the killer reframe. Don't say "the code is hard to change." Say: *"Every feature we ship in this area now takes ~40% longer than it did 18 months ago, and that surcharge applies to every future feature, forever, until we pay down the principal. We are paying interest whether or not we ever 'fix' it."* A tax that compounds and never expires is something a financially literate person viscerally understands.
- **Paydown is a capital investment with an ROI, not a cost.** Reframe the ask from "give us time to clean up" (a cost, a delay, a tax on the roadmap) to "invest N engineer-weeks to permanently remove a Y% velocity tax — payback in ~Q quarters, then it's pure margin." Now it competes on the same axis as every other investment the business makes, and it can *win* on the numbers.

The concrete translation table:

| What you'd say to an engineer | What you say to leadership |
|---|---|
| "This module is a mess, we need to refactor it." | "Changes in checkout cost us ~3× what they cost in 2023; that surcharge hits every checkout feature on the roadmap." |
| "The tests are flaky and slow." | "Our deploy pipeline is unreliable enough that we ship 1×/week instead of daily — every fix waits up to 5 days behind it." |
| "We have a ton of tech debt." | "We're spending roughly 30% of every sprint working *around* known problems instead of *on* roadmap items." |
| "We should pay this down." | "A 6-week investment removes a recurring ~25% tax on this team's output; it pays for itself in two quarters." |

> **The professional reality:** the failure mode is almost never that leadership is anti-quality. It's that you handed them a request they had no way to evaluate. "Refactor" is unpriceable and unschedulable; "remove a 25% velocity tax, payback in two quarters" is a normal investment decision. Quantify with [DORA metrics and lead-time data](../04-tracking-and-prioritizing/professional.md) so the number is *measured*, not asserted — leadership will fund a measured tax and ignore a felt one.

---

## The Second-Order Costs That Never Show Up in the Code

When engineers price debt, they price the obvious thing: features take longer. That's the *first-order* cost, and it badly undersells the liability. The costs that actually move the business are second-order — they show up in incident dashboards, recruiting funnels, security reviews, and resignation letters, not in the diff. Surfacing these is how a senior turns "the code is slow to change" into "this is a business risk," and they're frequently 5–10× the size of the velocity cost alone.

The major second-order costs, each in leadership's units:

- **Incident rate and reliability.** Debt-heavy areas generate disproportionate production incidents — fragile code breaks under change, missing tests let regressions through, tangled coupling turns a small change into an outage. Frame it as: *"60% of our Sev-1s in the last year originated in three modules we've flagged as high-debt."* That's no longer an engineering preference; it's a reliability and on-call-burnout problem with a number attached.
- **Security exposure.** Old dependencies you can't upgrade because the surrounding code is too fragile, auth logic nobody dares touch, no tests to safely patch a CVE. Debt directly extends your mean-time-to-patch and widens the attack surface. To a security-conscious exec or a SOC 2 / regulatory context, *"we cannot upgrade this dependency safely, so we're carrying a known CVE for weeks"* is a risk on the risk register, fundable from a different budget than the feature roadmap.
- **Onboarding time.** A high-debt codebase means new hires take months, not weeks, to be productive — and that delta is pure salary burned plus opportunity cost. *"Our last three hires took ~4 months to ship independently; an industry-normal codebase is ~6 weeks"* converts debt into a recruiting-efficiency and capacity number a VP of Engineering owns directly.
- **Opportunity cost — the features you didn't ship.** This is the largest and most invisible cost. Every sprint spent fighting the existing system is a sprint not spent on revenue features, and the things you *couldn't* build because the architecture made them prohibitively expensive never appear on any ticket. *"We declined to build the bulk-import feature three customers asked for because it would have taken two quarters in the current data model"* makes the invisible visible — and lost deals get a finance person's full attention.
- **Engineer attrition and morale.** Your best engineers have options, and a codebase that makes every change miserable is a documented driver of attrition. Replacing a senior engineer costs roughly 6–12 months of ramp plus recruiting; losing the institutional knowledge in their head is often worse. *"Two of our four senior engineers cited 'fighting the codebase' in exit interviews"* reframes debt as a retention cost — and retention is something leadership already tracks and fears.

> **The principle:** the velocity tax is the cost you can *see*; the second-order costs are where the money actually is. A senior who only argues "features are slower" is leaving the strongest 80% of the case on the table. Lead with incidents, security, attrition, and lost deals — those are the costs that show up in the budgets executives are already accountable for. The [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) roadmap is where you find the instrumentation to put real numbers behind each of these.

---

## Strategic vs Tactical Debt at Portfolio Scale

At a single-team scale, "is this debt worth taking?" is a local question. At portfolio scale — many teams, many systems, one finite budget — it becomes a question about *where in the system you're allowed to be sloppy*, and that's a strategic call, not a per-PR one.

The distinction that matters at this level:

- **Tactical debt** is local and reversible: a shortcut inside one service, an ugly-but-isolated module, a "we'll generalize this later" that's contained behind an interface. The blast radius is one team and the cost of carrying it is bounded. Tactical debt is usually fine to take and fine to leave — you pay it down only if you keep touching it (see [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/professional.md)).
- **Strategic debt** is structural and expensive to reverse: the core data model, the service boundaries, the auth and identity layer, the public API contract, the central abstractions everything else depends on. Debt here is *load-bearing* — it propagates into every team that builds on top of it, and the cost compounds across the whole portfolio. A bad shortcut in the core data model isn't one team's problem; it's a tax every team pays for years.

The portfolio rule that follows: **be willing to take tactical debt liberally; treat strategic debt as a deliberate, senior-authorized decision with eyes open.** The expensive mistakes are almost always strategic debt taken *tactically* — someone made a "we'll fix it later" call inside the core data model under deadline pressure, treating a foundational decision as if it were a local one. Two years later it's the thing the whole platform is built on and can't be changed.

This is also where you stop thinking "pay down all debt" and start thinking like a portfolio manager: **some debt should be paid down aggressively, some should be carried indefinitely, and some should be left to rot in code you're going to delete anyway.** Spending paydown budget on a low-traffic service slated for decommission is as wasteful as ignoring compounding debt in your highest-churn core. The art is allocating a finite paydown budget to the highest-interest, most load-bearing debt — not to the debt that annoys engineers the most.

---

## Who Is Allowed to Authorize Debt

A surprisingly clarifying question that most organizations have never answered explicitly: *who is allowed to decide we'll take on debt here?* When the answer is "any engineer, silently, under deadline pressure, with no record," you get uncontrolled accumulation. When it's matched to the debt's blast radius, you get debt that's actually a decision someone owns.

The principle is **authorization should scale with blast radius**:

| Debt scope | Who authorizes | What's required |
|---|---|---|
| Local / tactical (one module, isolated) | The implementing engineer | A `TODO`/`// DEBT:` note explaining the trade-off and the condition to revisit |
| Cross-cutting (affects a team's whole service, hard to reverse within the team) | Tech lead / staff engineer | A recorded decision (ADR or debt-register entry) with the trade-off and a revisit trigger |
| Strategic (core data model, API contract, service boundaries — propagates across teams) | Architecture review / principal + the owning EM | An explicit, written decision with cost framing — this is a portfolio bet, not a coding choice |

Two things make this work in practice. First, **debt taken must leave a trace.** Undocumented debt is the worst kind not because it's bigger but because nobody decided it — it's just sediment, and you can't manage what you can't see. A one-line `// DEBT: hard-coded to ship for the Q3 demo; revisit when we add the second tenant — JIRA-1234` turns invisible sediment into a tracked, attributable decision. Second, **the authority to take strategic debt is also the accountability for it.** If a principal engineer signs off on a shortcut in the core data model, that decision has an owner who answers for it later — which is exactly the pressure that keeps strategic debt deliberate rather than accidental.

> **The professional move:** when you join a team drowning in debt, one of the highest-leverage early questions is "who's been authorized to take this on, and where's it recorded?" The usual answer — "everyone, nowhere" — tells you the real problem isn't the debt, it's the absence of any authorization model. Fixing *that* (even a lightweight `DEBT:` convention plus a register) does more for the long-term trajectory than any single paydown sprint.

---

## When the Organization Manufactures the Debt

Here is the truth that separates a senior who *manages* debt from one who's perpetually drowning in it: **most chronic technical debt is not created by bad engineers making bad choices. It is manufactured, systematically, by the organization's incentives.** You can hire the best engineers in the world and put them in a system that rewards only shipped features under permanent deadline pressure, and they will produce a debt-ridden codebase — not because they don't know better, but because the environment punishes doing better.

The recognizable patterns of an organization that manufactures its own debt:

- **Perpetual deadline pressure with no recovery.** Every sprint is a crunch, every quarter has an immovable date, and there is never a "now we catch up" period. Debt taken under one deadline is never paid down because the next deadline arrives first. The shortcuts aren't decisions; they're the only way to survive the cadence. A sustainable pace *requires* slack, and an organization with zero slack is choosing debt by choosing the schedule.
- **"We'll fix it later" with no mechanism for "later."** "Later" is where debt goes to become permanent. If there's no debt register, no allocated paydown capacity, no revisit trigger — "later" is a polite "never," and everyone in the room half-knows it. The phrase is a tell: it converts a real trade-off into a fictional repayment plan that lets everyone ship today and forget by next week.
- **Incentives that reward only features.** Look at what gets people promoted and praised. If the promo packet rewards "shipped the new dashboard" and is silent on "made the payment system safe to change for the next five years," you have told your engineers, unambiguously, that foundations don't count. They will optimize for what's rewarded. The debt that results is a *rational response to the incentive system*, and no amount of "engineers should care more about quality" will override what the comp committee actually pays for.
- **Quality work that's invisible to the people who fund it.** When the only thing leadership ever sees is feature demos, paydown work is — to them — engineers disappearing for two weeks and returning with nothing to show. Invisible work doesn't get funded twice. If you can't *show* the result of paydown (in incidents avoided, velocity restored, deals enabled), you'll be asked to stop doing it.

The senior's job in the face of this is **not to take the deadline personally and grind harder.** Grinding harder produces more debt faster and burns you out doing it. The job is to *surface the system to the people who run it* and reframe what they're actually choosing:

1. **Make the trade-off explicit at decision time, in writing.** When the deadline forces a shortcut, say so out loud and on the record: *"We can hit the date, and the cost is a known shortcut in X that we'll pay roughly 20% slower velocity on until we fix it. I want that to be a decision we're making, not an accident."* This single move converts manufactured debt from invisible sediment into an attributable, owned decision — which is the first step to ever paying it down.
2. **Name the system, not the symptom.** Don't argue about this one ticket. Show the pattern: *"This is the fourth quarter we've taken a shortcut here and never come back. We're not accumulating debt by accident; our current operating model produces it structurally. Here's the cost trend."* Leadership can ignore a complaint about one feature; a documented multi-quarter trend with a cost line is much harder to wave away.
3. **Attack the incentive, not just the code.** The leverage move is to get foundational work *visible and rewarded*. Push for paydown outcomes in promo criteria, for a standing debt line in planning, for reliability/velocity metrics on the same dashboard as feature delivery. You will do more for the codebase by changing what the org sees and rewards than by any heroic refactor.

> **The hard-won lesson:** if you find yourself constantly fighting debt and losing, stop trying to win on the code and look up at the system. An organization that rewards only features, runs at permanent crunch, and has no mechanism for "later" *is a debt factory*, and you are downstream of it. The senior move is to make the factory visible to the people who can retool it — because they're usually manufacturing the debt without realizing that's what their incentives do.

---

## Debt and the Build-vs-Buy / Rewrite Temptation

Two of the most expensive decisions an organization makes are framed in debt terms, usually badly: *should we rewrite this debt-ridden system?* and *should we build this ourselves or buy it?* Both are where a clear-eyed view of debt either saves a fortune or where a misunderstanding of debt burns one.

**The rewrite temptation.** A debt-heavy system invites the seductive pitch: "it's too far gone, let's rewrite it clean." This is one of the most reliably disastrous decisions in software, for reasons that are fundamentally about *what debt actually is*:

- The existing system, ugly as it is, encodes years of hard-won knowledge — every weird conditional is usually a bug fix or an edge case a customer hit. A rewrite throws that knowledge away and re-discovers it the hard way, in production, with real customers. The "mess" is partly accumulated correctness.
- During a full rewrite, you freeze feature development on the old system (you can't maintain two), so the business stops moving while a multi-quarter project that *always* runs long tries to reach parity with a moving target. Parity is the trap: you must rebuild everything the old system does before you deliver any new value, and the old system keeps growing while you do.
- The new system accumulates its own debt from day one — rewrites don't produce debt-free code, they produce *different* debt, often written under even more schedule pressure than the original.

The senior framing: **a rewrite is almost never the cheapest way to pay down debt.** Incremental paydown — the strangler-fig pattern, where you replace the system piece by piece behind a stable interface while it keeps running and delivering — is usually far cheaper, far less risky, and keeps the business moving. The rare cases where a rewrite is genuinely right (the platform is fundamentally obsolete, or the system is small enough to rebuild in weeks not quarters) are exactly that: rare. Reach for [05 — Paying Down Debt](../05-paying-down-debt/professional.md) for the incremental playbook before you reach for the rewrite. The strongest tell that "rewrite" is the wrong answer is when the argument for it is emotional ("I can't stand this code") rather than economic ("here's why incremental paydown is more expensive than a rebuild, with numbers").

**Build-vs-buy as a debt decision.** When you build something a vendor already sells (auth, billing, search, feature flags, observability), you're not just paying to build it — you're signing up to *own the debt of maintaining it forever*. That maintenance liability is the part teams systematically underprice. Buying converts an open-ended internal maintenance liability into a predictable line-item cost and moves the debt onto someone whose entire business is maintaining that thing. The reframe for leadership: *"Building our own auth saves a license fee but commits us to maintaining security-critical code forever — that's a permanent liability and a recurring CVE risk, not a one-time build cost."* Build when it's genuine differentiation worth owning; buy the undifferentiated heavy lifting and let someone else carry its debt.

---

## War Stories

**The velocity tax that finally got funded.** A payments team had spent two years asking for "time to refactor checkout" in every planning cycle, and losing to features every time. A new staff engineer stopped asking for refactoring time and instead spent a sprint measuring: cycle time for checkout changes had risen from ~2 days in 2022 to ~7 days, ~35% of the team's tickets were "work around the existing system" rather than new value, and three of the last year's Sev-1 incidents originated in the checkout module. She brought one slide to the VP: *"Every checkout feature on next year's roadmap carries a ~3× time surcharge and a reliability risk; a 6-week investment removes most of it, payback in ~2 quarters."* It got funded in the same meeting where "refactor checkout" had been declined four times. Nothing about the *debt* changed — only that it was finally priced in the VP's units and placed against an ROI.

**Death by a thousand "ship it now" decisions.** A team shipped fast for three years and was, by feature count, the most productive group in the org — which is exactly why nobody looked closely. Each individual "we'll clean it up after the launch" was defensible in isolation; none was ever revisited because the next launch always arrived first. There was no debt register, no paydown capacity, and the promo cycle rewarded only the launches. By year four, velocity had quietly collapsed — simple changes took weeks, two of four senior engineers left citing "fighting the codebase," and onboarding a new hire took five months. No single decision was wrong; the *system* of always shipping and never paying down was. The post-mortem's real finding wasn't "the code is bad" — it was "we had no mechanism for 'later,' so 'later' never came, and the org's incentives manufactured exactly this outcome."

**From "engineering wants to gold-plate" to a board-level risk.** An engineering lead kept losing the argument for upgrading a critical, end-of-life dependency because, framed as "we want to modernize our stack," it read to the executive team as engineers wanting to polish for their own satisfaction. He reframed it entirely: the dependency was past end-of-life and no longer receiving security patches, the surrounding code was too fragile to upgrade safely, and the company was therefore carrying a *known, unpatchable CVE class* in a system that handled customer PII — a direct SOC 2 and breach-disclosure exposure. Recast as a security-and-compliance risk on the risk register rather than an engineering preference, it was funded within a week, out of a different budget than the product roadmap. The work was identical; the *frame* moved it from "nice-to-have engineering polish" to "liability the board is accountable for."

---

## Decision Frameworks

**Should I escalate this debt to leadership? Ask:**
- Can I quantify the cost in *their* units (velocity tax %, incident rate, lead time, lost deals, attrition)? → if no, measure first; an unquantified ask loses.
- Is the cost recurring and compounding, or a one-time annoyance? → escalate compounding interest; absorb one-time costs quietly.
- Is it strategic (load-bearing, cross-team) or tactical (local, contained)? → strategic debt is worth a leadership conversation; tactical debt rarely is.

**How do I frame the ask? Default to:**
- Lead with the second-order cost (incidents / security / attrition / lost deals), not "features are slower."
- State it as an *investment with ROI and a payback period*, never as "time to clean up."
- Bring measured numbers, not adjectives — "25% tax, 2-quarter payback," not "it's a mess."

**Is this rewrite or incremental paydown? Ask:**
- Is the argument economic or emotional? → emotional ("I hate this code") is a red flag; demand the numbers.
- Can the business survive freezing the old system for the rewrite's (always-longer-than-estimated) duration? → if no, it must be incremental.
- Is the platform fundamentally obsolete, or just messy? → messy → strangler-fig; obsolete → maybe rewrite.

**Build or buy? Ask:**
- Is this our genuine differentiator, worth owning the debt of forever? → build only if yes.
- Is it undifferentiated, security-critical, or a maintenance treadmill (auth, billing, observability)? → buy and offload the debt.

**Who authorizes this debt? Match to blast radius:**
- Local/tactical → the engineer, with a `DEBT:` note. Cross-cutting → tech lead, with an ADR. Strategic (core model/API/boundaries) → architecture review + owning EM, in writing.

---

## Mental Models

- **You can't out-engineer an incentive system.** Good engineers in a feature-only, permanent-crunch, no-"later" org will produce debt-ridden code as a *rational response*. The leverage is in changing what the org measures and rewards, not in caring harder about quality.

- **The debt is the same; the language is the variable.** "We need to refactor" and "this is a 25% velocity tax with a 2-quarter payback" describe the identical liability. One gets declined, one gets funded. Your job is the translation.

- **Interest is the cost you see; second-order effects are where the money is.** Velocity is the first-order tax. Incidents, security exposure, slow onboarding, lost deals, and attrition are 5–10× larger and live in budgets executives already own. Lead with those.

- **Strategic debt taken tactically is the expensive mistake.** A shortcut in the core data model made under deadline pressure, as if it were local, becomes the thing the whole platform can't change. Match the authorization to the blast radius.

- **"Later" without a mechanism is "never."** "We'll fix it after the launch" is a fictional repayment plan unless there's a register, allocated capacity, and a revisit trigger. No mechanism, no later.

- **A rewrite is rarely the cheapest paydown.** The mess encodes years of accumulated correctness; freezing the business to rebuild parity with a moving target almost always costs more than strangling it incrementally.

---

## Common Mistakes

1. **Advocating in engineering language to a non-engineering audience.** "The code is messy / we need to refactor" is unpriceable and loses to any feature. Translate to a measured velocity tax, incident rate, or lost-deal number in *their* units.

2. **Pricing only the first-order cost.** Arguing "features are slower" leaves the strongest 80% of the case — incidents, security exposure, onboarding cost, opportunity cost, attrition — on the table. Those are the costs leadership is already accountable for.

3. **Asserting the cost instead of measuring it.** "It's a disaster" is an adjective; "checkout changes cost 3× what they did in 2022" is a number. Leadership funds measured taxes and ignores felt ones. Instrument first ([Engineering Metrics & DORA](../../engineering-metrics-and-dora/)).

4. **Treating strategic debt as a local decision.** A "we'll fix it later" inside the core data model, service boundaries, or public API isn't one team's tactical call — it propagates across the portfolio. Match authorization to blast radius.

5. **Taking the deadline personally and grinding harder.** When the org manufactures debt through permanent crunch and feature-only incentives, grinding produces more debt faster and burns you out. Surface the *system* to the people who can retool it.

6. **Letting "later" stay fictional.** "We'll clean it up after the launch" with no register, capacity, or trigger is a polite "never." If you take debt, leave a trace and a revisit condition or it becomes permanent sediment.

7. **Reaching for the rewrite on emotional grounds.** "I can't stand this code" is not a business case. A full rewrite throws away accumulated correctness and freezes the business to chase parity. Demand the economic argument; default to incremental strangler-fig paydown.

---

## Test Yourself

1. A VP has declined "refactor the checkout module" three planning cycles in a row. Rewrite the ask so it has a chance of being funded, and name what you'd measure first.
2. Name four second-order costs of debt that don't show up in the code, and give the leadership-facing framing of each.
3. Distinguish strategic from tactical debt, and state the portfolio rule for which one warrants a leadership conversation. What's the classic expensive mistake?
4. Your organization ships fast, runs at permanent crunch, rewards only features, and has no debt register. Diagnose what's actually producing the debt, and give three senior moves that address the *system* rather than the symptom.
5. A team wants to rewrite a debt-heavy but working system "because it's too far gone." Give three reasons this is usually a mistake and name the cheaper alternative.
6. Frame a build-vs-buy decision (e.g., in-house auth vs a vendor) explicitly as a debt decision for leadership.
7. Who should be allowed to authorize taking on debt, and on what principle? What must be true of any debt that's taken, regardless of who authorized it?

<details>
<summary>Answers</summary>

1. Stop asking for "time to refactor" (a cost/delay) and reframe as an investment with ROI: *"Checkout changes now cost ~3× what they did in 2022, that surcharge hits every checkout feature on the roadmap, and a 6-week investment removes most of it with payback in ~2 quarters."* **Measure first:** cycle time / lead time for changes in that module, the % of tickets that are "work around the system" vs new value, and the incident rate originating there — so the tax is a number, not an adjective.
2. **Incident rate** ("60% of last year's Sev-1s came from three high-debt modules" — a reliability/on-call cost), **security exposure** ("we can't safely upgrade this dependency, so we're carrying a known CVE" — a risk-register/compliance cost), **onboarding time** ("new hires take 4 months to ship independently vs an industry-normal 6 weeks" — a capacity/salary cost), and **attrition/morale** ("two of four seniors cited 'fighting the codebase' in exit interviews" — a retention cost). **Opportunity cost** ("we declined a feature three customers wanted because it'd take two quarters in the current model") is the fifth and usually largest.
3. **Tactical** = local, contained, reversible (a shortcut inside one service) — usually fine to take and fine to leave. **Strategic** = structural, load-bearing, expensive to reverse (core data model, API contract, service boundaries) — propagates across teams and compounds portfolio-wide. **Rule:** strategic debt warrants a deliberate, leadership/architecture conversation; tactical debt rarely does. **Classic mistake:** taking *strategic* debt *tactically* — a deadline-driven shortcut in the core model treated as if it were local, which becomes the thing the whole platform can't change.
4. The **organization's incentives are manufacturing the debt** — permanent crunch leaves no capacity to pay down, "we'll fix it later" has no mechanism so it's never, and rewarding only features tells engineers foundations don't count. The debt is a rational response to the system. **Three senior moves:** (a) make each shortcut an explicit, written, owned decision at decision time; (b) name the multi-quarter *pattern* with a cost trend rather than arguing one ticket; (c) attack the incentive — get paydown outcomes into promo criteria, a standing debt line in planning, and reliability/velocity metrics on the same dashboard as features.
5. (a) The existing system encodes years of accumulated correctness (every weird conditional is usually a real bug fix / edge case); a rewrite re-discovers it the hard way in production. (b) You must freeze the old system and chase parity with a moving target before delivering any new value, and rewrites always run long. (c) The new system accrues its own debt from day one, often under worse schedule pressure. **Cheaper alternative:** incremental paydown via the strangler-fig pattern, replacing pieces behind a stable interface while the system keeps running.
6. Building it commits you to *owning its debt forever*: *"In-house auth saves a license fee but means we maintain security-critical code permanently — an open-ended maintenance liability and a recurring CVE risk, not a one-time build cost. Buying converts that into a predictable line item and moves the debt onto a vendor whose business is maintaining it."* Build only genuine differentiators worth owning; buy undifferentiated, security-critical heavy lifting.
7. **Authorization should scale with blast radius:** local/tactical → the implementing engineer; cross-cutting → tech lead/staff with an ADR; strategic (core model, API, boundaries) → architecture review + owning EM, in writing. **Regardless of who authorizes it,** the debt must *leave a trace* — a `DEBT:` note or register entry stating the trade-off and a revisit trigger — because undocumented debt is the worst kind: nobody decided it, so nobody can manage it.

</details>

---

## Cheat Sheet

```
TRANSLATE DEBT INTO LEADERSHIP LANGUAGE
  "refactor / it's messy"     →  "X% recurring velocity tax, payback in Q quarters"
  liability, not a sin        →  report it like finance reports any liability
  interest = permanent tax    →  surcharge on every future feature, forever
  paydown = capital invest    →  ROI + payback period, not "time to clean up"
  RULE: measured number, not adjective. Leadership funds taxes, ignores feelings.

SECOND-ORDER COSTS (where the real money is — lead with these)
  incidents     "60% of Sev-1s came from 3 high-debt modules"
  security      "can't upgrade safely → carrying a known CVE"
  onboarding    "4 months to productive vs 6-week norm"
  opportunity   "declined a feature 3 customers wanted (2 quarters in this model)"
  attrition     "2 of 4 seniors cited 'fighting the codebase' on exit"

STRATEGIC vs TACTICAL
  tactical  = local, contained, reversible  → take freely, leave unless you touch it
  strategic = core model/API/boundaries     → load-bearing, cross-team, senior-authorized
  the expensive mistake = strategic debt taken tactically under deadline

AUTHORIZATION (scale to blast radius — and always leave a trace)
  local       → engineer    + // DEBT: note w/ revisit trigger
  cross-team  → tech lead   + ADR / register entry
  strategic   → arch review + owning EM, in writing

THE ORG MANUFACTURES DEBT WHEN
  permanent crunch (no slack) + "later" with no mechanism + features-only rewards
  → you can't out-engineer incentives; surface the SYSTEM, not the symptom

REWRITE vs INCREMENTAL
  emotional case ("I hate this") = red flag; demand economics
  default = strangler-fig (replace piece by piece behind stable interface)
  rewrite only if: platform obsolete OR small enough to rebuild in weeks
```

---

## Summary

- **The debt is the same; the language is the entire game.** "We need to refactor" loses; "this is a 25% velocity tax with a two-quarter payback" wins. Reframe debt as a *liability* (not a moral failing), interest as a *permanent tax on velocity*, and paydown as a *capital investment with ROI* — then it competes on the same axis as every other business decision and can win on the numbers.
- **The second-order costs are where the money is.** Velocity is the first-order tax; incidents, security exposure, onboarding time, lost deals, and attrition are 5–10× larger and live in budgets executives already own. A senior who only argues "features are slower" leaves the strongest case on the table.
- **Strategic vs tactical debt is a portfolio decision.** Take tactical (local, contained) debt liberally; treat strategic (core model, API, boundaries) debt as a deliberate, senior-authorized bet. The expensive mistake is strategic debt taken *tactically* under deadline pressure.
- **Authorization should scale with blast radius, and all debt must leave a trace.** Match who-can-authorize to the cost of reversal, and require a `DEBT:` note or register entry — undocumented debt is the worst kind because nobody decided it.
- **The organization usually manufactures its own debt.** Permanent crunch, "later" with no mechanism, and feature-only incentives produce debt-ridden code from even excellent engineers. You can't out-engineer an incentive system — the senior move is to surface the *system* to the people who can retool it.
- **Resist the rewrite and the false build.** A rewrite is rarely the cheapest paydown (it discards accumulated correctness and freezes the business to chase parity); strangler-fig incremental paydown usually wins. Building undifferentiated, security-critical software means owning its debt forever — buy that, and reserve building for genuine differentiators.

You can now operate technical debt as a leadership and financial concern, not just an engineering one — pricing it, framing it, and getting it funded. The final tier — [interview.md](interview.md) — consolidates the whole topic into the questions that test whether someone genuinely understands debt at every level.

---

## Further Reading

- Ward Cunningham — the [1992 OOPSLA experience report](https://c2.com/doc/oopsla92.html) and his [2009 clarifying video](https://www.youtube.com/watch?v=pqeJFYwnkjE) — the metaphor from the source, including why "debt" means a deliberate trade-off, not a mess.
- Martin Fowler — [*Technical Debt*](https://martinfowler.com/bliki/TechnicalDebt.html) and [*Is High Quality Software Worth the Cost?*](https://martinfowler.com/articles/is-quality-worth-cost.html) — the economic argument for why quality is an investment, not a tax, in language you can borrow for leadership.
- Kruchten, Nord & Ozkaya — *Managing Technical Debt* (SEI) — the most rigorous treatment of debt as a portfolio and organizational concern, including strategic vs tactical framing.
- Joel Spolsky — [*Things You Should Never Do, Part I*](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/) — the canonical case against the full rewrite, and why the "mess" encodes accumulated correctness.
- *Accelerate* (Forsgren, Humble, Kim) — the DORA research that gives you the *measured* metrics (lead time, deploy frequency, change-fail rate) to put real numbers behind the velocity-tax argument.

---

## Related Topics

- [junior.md](junior.md) — the metaphor and the mechanics: principal, interest, debt vs bugs vs cruft.
- [senior.md](senior.md) — the debt quadrant, when debt is rational, and pricing it at team scale.
- [interview.md](interview.md) — the questions that probe whether someone understands debt at every level.
- [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/professional.md) — debt registers, cost-of-delay / WSJF, and the data that powers the leadership conversation.
- [05 — Paying Down Debt](../05-paying-down-debt/professional.md) — the strangler-fig and incremental paydown playbook that beats the rewrite.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the instrumentation that turns "the code is slow to change" into a measured number leadership will fund.
