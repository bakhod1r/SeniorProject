# Tracking & Prioritizing — Professional Level

> **Roadmap:** [Technical Debt Management](../README.md) → [Tracking & Prioritizing](./) → Professional
> *The senior page taught you to score one item — interest, cost-of-delay, WSJF. This page is about a hundred items across a dozen teams, a single backlog where every refactor competes with a revenue feature, and a product org that has been burned by "refactoring epics" before. Here the skill stops being measurement and becomes negotiation, portfolio governance, and the politics of getting debt onto a roadmap someone will actually fund.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Perennial Fight: One Backlog, Two Masters](#the-perennial-fight-one-backlog-two-masters)
4. [The Allocation Models — and What Each One Actually Costs](#the-allocation-models--and-what-each-one-actually-costs)
5. [Getting Debt Onto a Roadmap Product Will Fund](#getting-debt-onto-a-roadmap-product-will-fund)
6. [Governing the Debt Portfolio](#governing-the-debt-portfolio)
7. [Aligning Prioritization Across Teams](#aligning-prioritization-across-teams)
8. [Reporting to Leadership Without Crying Wolf](#reporting-to-leadership-without-crying-wolf)
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

> Focus: **Managing technical debt as a portfolio across many teams, and winning the org/product negotiation that funds paydown.**

The senior page handed you instruments: cost-of-delay, WSJF, interest-first ordering, "don't fix debt you never touch." Those instruments answer *which item is most worth doing* in isolation. They do not answer the questions that actually decide whether debt gets paid:

- The whole engineering org shares **one prioritized backlog** with finite capacity, and every debt item competes head-to-head with a feature that has a revenue number attached. Who wins, and who decides?
- A platform team owns a piece of debt that *hurts five product teams* but *belongs to none of them*. Whose roadmap does it go on?
- Leadership has heard "we need to stop and fix tech debt" so many times that the phrase now means nothing. How do you report debt so they act without tuning you out?
- Your debt register has 312 open tickets, the oldest from three years ago, and nobody can tell which ten matter. How did it become a graveyard, and how do you stop that?

None of these are scoring problems. They are **portfolio** and **negotiation** problems, and they are where most debt programs die — not because the engineers couldn't quantify the debt, but because they couldn't get it funded, couldn't keep the register honest, and couldn't align teams around the debt nobody owned. This page is the pragmatic layer: the allocation models real orgs use, the business framing that gets paydown funded, and the governance that keeps a register from rotting.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — interest vs principal, cost-of-delay, WSJF, hotspot-driven prioritization, "don't fix debt you never touch."
- **Required:** [../02-identifying-and-quantifying/professional.md](../02-identifying-and-quantifying/professional.md) — you can put a defensible cost on a debt item (remediation cost, interest rate, lead-time and defect impact).
- **Helpful:** You've sat in a sprint-planning or quarterly-planning room where debt lost to a feature and watched *why* it lost.
- **Helpful:** You've owned a backlog, run a planning cadence, or had to defend an engineering investment to a non-engineer.

---

## The Perennial Fight: One Backlog, Two Masters

Every other tier could pretend debt items live in their own queue. At org scale that fiction collapses: there is **one backlog**, finite team capacity, and a product manager whose job, incentives, and bonus are tied to shipping features. A debt item and a feature draw from the same pool of engineer-weeks. The debt item, framed naively, *always loses* — and it loses for a structural reason worth naming precisely:

> **Features have a visible upside; debt paydown has an invisible downside it merely prevents.** "Ship checkout v2" promises a number someone will be measured on. "Refactor the order module" promises that *something bad won't get worse* — a counterfactual nobody gets credit for. In a contest between a measurable gain and an unmeasured avoided-loss, the gain wins by default. This is not because PMs are short-sighted; it's because the *framing* hides the debt's value.

This is the core asymmetry the rest of the page exists to correct. Three observations follow from it:

1. **You cannot win this fight ticket-by-ticket in sprint planning.** A single debt ticket arguing with a single feature will lose nearly every time, because the feature has a sponsor and a number and the ticket has a sigh. The fight has to be moved *up a level* — to an allocation policy and a roadmap negotiation — where debt competes as a *category* with reserved capacity, not as an underdog line item.

2. **Whoever controls capacity allocation controls debt paydown.** If the PM allocates 100% of capacity ticket-by-ticket, engineering gets 0% for debt and a slow death. The allocation models below are all mechanisms for *taking that decision out of the per-ticket contest* and settling it once, at a level where avoided-loss can actually be argued.

3. **"Naked" debt always loses; *bundled* or *quantified* debt can win.** The same refactor that loses as "tech-debt cleanup" wins as "the prerequisite that makes checkout v2 take 3 weeks instead of 9." The work is identical; the framing is everything. We'll return to this in [Getting Debt Onto a Roadmap](#getting-debt-onto-a-roadmap-product-will-fund).

The professional skill is not "advocate harder for debt." It's recognizing that the per-ticket fight is *unwinnable by design* and changing the level at which the decision is made.

---

## The Allocation Models — and What Each One Actually Costs

Orgs resolve the one-backlog fight with one of a few standard mechanisms. None is free; each trades a different thing. Know all four, because the right one depends on the org's maturity and where the debt actually lives.

### 1. The fixed capacity tax (e.g., "20% to debt")

A standing policy: a fixed fraction of every team's capacity is reserved for debt and engineering health, untouchable by feature planning. Google's "20% time" is the famous cousin; the debt version is typically **10–30%**, often quoted as 20%.

- **Why it works:** it converts the unwinnable per-ticket fight into a *one-time negotiation* settled at the policy level. Inside the 20%, engineering prioritizes freely; debt no longer argues with features one ticket at a time. It's predictable, easy to explain to finance ("we run at 80% feature velocity by design"), and it keeps paydown *continuous* so debt never fully calcifies.
- **What it costs:** a fixed tax is **blind to where debt actually is**. A team with little debt still "spends" its 20% (often on gold-plating); a team drowning in debt is capped at 20% when it needs 60%. It's a flat tax on an uneven distribution.
- **The failure mode — and it is the dominant one:** the tax gets **raided**. The quarter a launch slips, "we'll borrow this sprint's 20% just this once" becomes the permanent state, and the policy quietly dies. A capacity tax only holds if it is *protected at the same level it was granted* — leadership has to defend it against its own deadline pressure, every quarter. An unprotected tax is theater.

### 2. Dedicated paydown allocations (sprints, "fix-it weeks," debt quarters)

Instead of a continuous tax, you concentrate paydown into **dedicated blocks**: a hardening sprint per quarter, a "fix-it week," occasionally a whole "tech-debt quarter" for a large remediation.

- **Why it works:** it's the only model that can fund **large, indivisible** debt — a framework migration, a database re-platform, a module rewrite — that can't be nibbled at 20% a sprint. Concentrated focus also avoids the constant context-switching cost of the tax model, and a dated block is easy to commit to and communicate.
- **What it costs:** the dedicated block is **the first thing cut when the schedule slips** — far easier to cancel "next month's fix-it week" than to claw back a standing policy. It also tempts teams to *let debt accumulate* until the block ("we'll fix it in the hardening sprint"), which is exactly the deferral the boy-scout rule exists to prevent. And one fix-it week per quarter rarely touches debt proportional to a quarter of accumulation.
- **The honest read:** dedicated blocks are *necessary* for the big indivisible items and *insufficient* as the only mechanism. Most healthy orgs run a tax for continuous small paydown **and** reserve dedicated blocks for the large stuff. The two are complementary, not alternatives.

### 3. Fix-on-touch (the boy-scout rule, mandated)

No reserved capacity at all. The rule: **whenever you touch a file or module for any reason, you leave it cleaner** — fix the smell you're standing in, within the blast radius of the change you're already making.

- **Why it works:** it's *free* — no capacity negotiation, because the cleanup rides on work that's already funded. And it self-targets *perfectly*: you fix exactly the code that's being actively changed, which is — by definition — the code that matters, the hotspots. It directly enforces "don't fix debt you never touch" because you only ever touch debt you're already in.
- **What it costs:** it can only fix debt in the **blast radius of current changes**. The dead module nobody touches stays rotten forever (which is usually *fine* — see senior.md), but so does the large *structural* debt that no single small change can address. You cannot fix-on-touch your way out of a wrong database choice or a god-object that every change makes slightly worse. It also depends on *culture and review* to enforce — "leave it cleaner" is unmeasurable and quietly skipped under deadline unless reviewers hold the line.
- **Where it shines:** fix-on-touch is the *default baseline* every team should run regardless of which capacity model sits on top. It handles the long tail of small, localized debt at zero budget; the tax and the dedicated block handle what fix-on-touch structurally cannot reach.

### The synthesis

These are not competing religions; they are **layers that cover different debt**:

| Mechanism | Funds | Self-targets? | First to be cut? | Covers structural debt? |
|---|---|---|---|---|
| **Fix-on-touch** | Small, localized debt in active code | Perfectly (only active code) | N/A (free) | No |
| **Capacity tax (~20%)** | Continuous medium paydown | No (flat, blind to where debt is) | Raided under deadline | Partially |
| **Dedicated block** | Large, indivisible remediations | No (chosen per block) | Yes, cancelled first | Yes |

> **The professional resolution:** run **fix-on-touch as the always-on baseline**, a **protected capacity tax** for continuous medium paydown, and **dedicated blocks** for the large indivisible items — and understand that a tax or block only survives if it's *protected at the level it was granted*. The model is easy; the discipline of not raiding it is the entire game.

---

## Getting Debt Onto a Roadmap Product Will Fund

Allocation models settle *how much* capacity exists for debt. They don't get a *specific* item funded when it needs more than the tax covers — a migration, a re-platform, a structural rewrite. For those, you have to win a roadmap slot in product's language. Three rules, in order of importance.

### Rule 1: Never present a naked "refactoring epic"

The single most common reason debt work dies is that it's pitched as itself. "Refactoring epic: clean up the payments module — 6 weeks." A PM reading that sees six weeks of zero customer-visible output and an unbounded scope, and they are *right* to be skeptical: there's no number, no deadline forcing it, and "refactor" is famously open-ended. A naked refactoring epic is asking product to spend its scarcest resource on a counterfactual. It will lose, and it *should* lose to anything with a business case.

### Rule 2: Express the item as cost-of-delay / interest in business terms

Translate the debt's *interest* (which you quantified in [02](../02-identifying-and-quantifying/professional.md)) out of engineering vocabulary and into the unit product and finance actually optimize: **money, time-to-market, or risk.** The transformation looks like:

| Don't say (engineering) | Do say (business) |
|---|---|
| "The order module is a god-object with no tests." | "Every change to checkout costs ~3 extra engineer-days in regression risk; at our change rate that's ~1.5 engineer-months/quarter we're burning as interest." |
| "We're three major versions behind on the framework." | "We're past the EOL date; we no longer get security patches, and the next critical CVE has no fix path — that's an unbounded risk on a system that processes payments." |
| "This service has a 40-minute test suite." | "Slow CI adds ~25 min to every deploy; across the team that's ~2 engineer-weeks/month, and it's why hotfixes take an hour to ship." |
| "We should refactor before adding more features here." | "Adding features to this module currently takes 3× longer than elsewhere; the next three roadmap items in it will cost ~9 extra weeks unless we address the structure first." |

The pattern is always: **interest rate × how often you pay it = recurring cost in a unit product cares about.** A naked "it's ugly" has no number; "this is costing us 1.5 engineer-months a quarter and rising" is a line item a PM can weigh against a feature — and *will*, because now it's denominated in the same currency.

### Rule 3: Bundle paydown with the feature that needs it

This is the highest-leverage move on the page. Most structural debt becomes *urgent* precisely when a new feature has to be built on top of it. **Don't fight for the refactor separately — make it the enabling first phase of the feature that requires it.**

> Instead of "Refactoring epic: rework the order module (6 wks)" *then later* "Feature: subscriptions (8 wks, but really 14 because the order module fights us," you pitch **one** item: "Subscriptions — 11 weeks, of which the first 3 restructure the order module so the remaining 8 are clean." Same total work, but now the refactor is *funded by the feature's business case* instead of competing against it. The PM isn't choosing debt *over* features; they're buying a feature whose first phase happens to pay down debt.

Bundling works because it inverts the asymmetry from [the perennial fight](#the-perennial-fight-one-backlog-two-masters): the refactor inherits the feature's visible upside instead of standing alone as an avoided-loss. The caveats that keep it honest:

- **The bundling must be genuine.** Bundle debt the feature *actually* needs to traverse, not a wishlist refactor you smuggle in on the feature's budget. Padding features with unrelated cleanup is how engineering loses product's trust — and once lost, *every* future estimate is treated as inflated.
- **Be transparent about the split.** "11 weeks, 3 of which are enabling refactor" is honest and builds credibility; a hidden 3 weeks of refactor inside an "8-week feature" that then slips to 11 looks like a missed estimate and burns the same trust.
- **Some debt has no feature to ride.** Platform debt, EOL'd dependencies, and cross-cutting rot often have no single feature that needs them. That debt needs the *quantified business case* (Rule 2) and a *dedicated allocation* — bundling can't save everything, and pretending otherwise leads to debt that never finds a sponsor.

---

## Governing the Debt Portfolio

A debt register is trivial to *create* and brutal to *keep useful*. Left alone, every register decays into a write-only graveyard: hundreds of tickets, none triaged, none owned, none ever closed except by bulk-deletion. Governance is the maintenance discipline that keeps the portfolio a decision tool instead of a landfill.

### A debt review cadence

The register must be *reviewed on a schedule*, not just appended to. A recurring **debt review** (monthly for a team, quarterly at portfolio level) that does four things and only four:

1. **Re-rank the top of the list** by current interest and cost-of-delay — priorities drift as the codebase and roadmap change; last quarter's #1 may be in a module you're about to delete.
2. **Kill zombies** (below).
3. **Confirm an owner** for every item still considered active.
4. **Promote** the few items now worth pulling into the roadmap or a dedicated block.

The cadence is what converts a register from a *list* into a *managed portfolio*. A register nobody reviews is just a slower way to lose information.

### An owner per major debt item

Every significant debt item needs a **named owner** — a person accountable for keeping its cost estimate current, advocating for it at review, and either driving it to done or recommending it be killed. Debt with no owner is debt with no advocate, and unadvocated debt is invisible at planning time. (Note: *owner* is not *assignee* — the owner stewards the item over its life; the eventual fix may be assigned to anyone.) This is also how **platform debt that no single team owns** gets a home — assign an owner even when the *fix* will span teams, or it falls through the cracks forever (see [next section](#aligning-prioritization-across-teams)).

### Killing zombie debt tickets

A **zombie** is a debt ticket that will never be actioned but never gets closed: the module was deleted, the rewrite made it moot, the "debt" was never real, or it's so low-interest it'll never beat anything in the backlog. Zombies are not harmless — they are *noise that hides the signal*. A register where 280 of 312 tickets are zombies is a register no one can use, because finding the 32 live items means wading through 280 dead ones. Aggressive closure is a feature:

> **Close-or-justify rule:** at each review, any debt ticket that hasn't moved in N reviews (e.g., two) must be either *re-justified with a current cost* or *closed*. "We might want to fix this someday" is a zombie; close it. If it matters again, the smell will resurface and you'll re-open it with fresh data — the codebase *remembers* its debt whether or not a ticket does. Closing a stale ticket loses nothing real and removes noise.

### Preventing the register from becoming a graveyard

The graveyard is the *default* end state of a debt register, and you prevent it structurally, not by willpower:

- **Cap the register.** A register with a hard cap (say, the top ~30 items) forces ranking — to add #31, something must be closed or promoted. An uncapped register is a graveyard with extra steps.
- **Closing is success, not failure.** Reward closing zombies as much as fixing debt. A shrinking register is a *healthy* one; a register that only grows is dying.
- **Don't log debt you'll never act on.** Logging every smell as a ticket *feels* responsible and *is* the road to the graveyard. The bar for a debt ticket is "we plausibly intend to act on this and need to remember/rank it" — not "this exists." Most small debt belongs to fix-on-touch, *not* the register; the register is for debt large enough to need deliberate prioritization.

> **The governance reality:** the register's *value is inversely proportional to its size past the point of usefulness.* Thirty live, owned, ranked items beat three hundred un-triaged ones every time. The discipline is continuous pruning — a register is a garden, not an archive.

---

## Aligning Prioritization Across Teams

Single-team prioritization (senior.md) assumes one backlog and one owner. The hard problems appear at the seams *between* teams, and they don't yield to better scoring — they need cross-team mechanisms.

### Shared hotspots

A hotspot (churn × complexity, from [02](../02-identifying-and-quantifying/professional.md)) is straightforward when one team owns it. The trouble is the file or module *many* teams change. Each team feels the pain a little, no single team feels enough to fund the fix alone, and each rationally waits for someone else to pay. The fix is to surface hotspots **at the portfolio level, attributed across all the teams that touch them** — so a module that costs five teams a day each shows its *aggregate* cost (five days, not one), which is what justifies a *shared* investment. Hotspot analysis at org scope is partly a tool for *finding the debt no single team's view reveals as expensive.*

### Platform debt nobody owns — the tragedy of the commons

The hardest debt in any large org is the **shared substrate**: the internal framework, the build system, the auth library, the schema everyone depends on. It hurts everyone and belongs to no one. Each team's local-optimal move is to route around it (fork the lib, add a special case, work *with* the slow build) rather than fix the commons — because fixing it is expensive and the benefit leaks to every other team. This is a textbook **tragedy of the commons**, and it does not resolve on its own; left to per-team incentives, shared debt only ever gets worse. The mechanisms that actually work:

- **Give the commons an owner** — a platform/infrastructure team (or a chartered owner) whose *explicit mandate* is the shared substrate, funded centrally so its paydown isn't held hostage to any product team's roadmap. Most shared debt needs *centralized* funding precisely because *distributed* incentives will never fund it.
- **Attribute the aggregate cost** so leadership sees the commons debt as the org-wide tax it is, not as N small annoyances none of which clears any single team's bar.
- **Make defaults do the right thing** — if the maintained path is also the *easy* path (a paved road), teams stop routing around the commons and the rot stops compounding. The cheapest way to fix a commons is to make using it correctly the path of least resistance.

> **The cross-team reality:** debt that spans ownership boundaries is *systematically* under-prioritized, because every individual incentive points away from fixing it. You cannot fix this with better scoring inside each team — you need a *named owner for the commons*, *central funding*, and *aggregate-cost visibility*. Those three are how the tragedy gets reversed; without them, shared debt is the debt that quietly sinks the org.

---

## Reporting to Leadership Without Crying Wolf

Engineering's credibility on debt is a finite, depletable resource, and the fastest way to burn it is to over-report. If every quarter is "we have a critical debt crisis and must stop everything," leadership learns to discount the message — and then ignores you the one quarter it's actually true. The professional skill is reporting debt so leaders can *act* without going numb.

**Report trends, not absolutes.** "We have a lot of tech debt" is unmeasurable and un-actionable; *everyone* has a lot of tech debt. "Our change-failure rate in the payments module rose from 8% to 19% over two quarters, and lead time there is now 3× the rest of the codebase" is a *trend* with a *location* and a *number* — it points at a specific problem getting specifically worse, which is what prompts action. Direction and rate beat magnitude.

**Tie debt to outcomes leaders already track.** Leadership cares about velocity, reliability, time-to-market, and risk — not about cyclomatic complexity. Route debt through metrics they *already* watch: lead time, change-failure rate, incident frequency, deploy frequency (the [DORA metrics](../../engineering-metrics-and-dora/)). "Debt in X is *why* this DORA metric you already watch is degrading" lands; "X has a high SQALE remediation cost" does not. Speak in their dashboard, not yours.

**Reserve "crisis" for actual crises.** Keep an honest gradient — most debt is "background interest we're managing," some is "actively slowing us, here's the trend," and *rarely* something is "this is a genuine risk, here's the specific bad outcome and its likelihood." If you spend "crisis" on routine debt, you have no word left for the EOL'd dependency that will have no patch for the next zero-day. Calibrate, so the word still means something when you need it.

**Show the paydown working.** Don't only report problems — report *progress*: "the order-module restructure shipped last quarter; lead time there dropped from 9 days to 4, change-failure rate halved." This is what earns the *next* allocation. Leadership funds debt paydown they've seen pay off and stops funding paydown that vanishes into a void. A debt program with no visible wins gets defunded regardless of how real the debt is.

> **The reporting reality:** your goal is *calibrated* alarm, not maximal alarm. Over-reporting trains leadership to ignore you; well-calibrated trend-based reporting tied to metrics they already track — plus visible wins — keeps debt fundable for years. Credibility is the asset; spend it deliberately.

---

## War Stories

**The 20% tax that worked.** A platform org adopted a firm rule: 20% of every team's capacity went to engineering health, and — critically — the VP of Engineering *defended it personally* every time a deadline threatened it, treating "borrow the 20%" requests the way finance treats spending the reserve. Over two years, lead time trended down and on-call pages dropped; the tax held because it was *protected at the level it was granted*. The mechanism was unremarkable; the discipline of never raiding it was the whole story.

**The 20% tax that got raided into nonexistence.** A sibling org adopted the identical policy with no top-cover. Q1: "big launch, we'll borrow this quarter's 20% just this once." Q2: same. By Q3 the 20% was permanently zero, debt compounded, and a year later they were begging for a *dedicated quarter* to dig out of the hole the tax was supposed to prevent. Same policy, opposite outcome — the difference was entirely whether leadership defended it against its own deadline pressure. An unprotected tax isn't a weak policy; it's no policy.

**The refactoring epic that got cancelled — and the same work, funded.** A team filed "Refactoring epic: rework the order module — 6 weeks." It sat at the bottom of the backlog for three quarters and was eventually closed unstarted; it never beat a single feature, because it never had a business case. Two quarters later the *same* restructure shipped — bundled as the first phase of the subscriptions feature ("11 weeks, first 3 to restructure the order module so the rest is clean"). Identical code change. The difference was that the second time the refactor rode a funded feature's business case instead of standing alone as a counterfactual. The naked epic *should* have lost; the bundled version *should* have won.

**The 400-ticket graveyard.** A team diligently filed a Jira ticket for every smell, every TODO, every "we should clean this up" for three years. The result: 412 open "tech-debt" tickets, the oldest from a service that had since been deleted. When a new lead asked "what are our top five debt items?", *no one could answer* — the signal was buried under hundreds of zombies. They eventually bulk-closed ~370 (deleted modules, never-real "debt," items that would never beat anything), kept ~40 with current cost estimates and named owners, and capped the register going forward. The lesson wasn't "track debt better"; it was that *logging every smell as a ticket is the road to the graveyard* — most small debt belonged to fix-on-touch, never the register, and a register's usefulness collapses past a certain size.

**The commons nobody would fund.** An internal build system got slower every quarter; every team complained and every team routed around it (local caches, skipped steps, "just live with the 40-minute build"). No product team would spend its roadmap fixing infrastructure that benefited everyone else — textbook tragedy of the commons. It only got fixed when leadership *chartered a platform team to own it and funded it centrally*, and surfaced the *aggregate* cost (40 min × every engineer × every build = a staggering org-wide number) that no single team's local view had ever made visible. Distributed incentives never would have funded it; central ownership and aggregate-cost visibility did.

---

## Decision Frameworks

**Which allocation model?**
- Continuous small/medium debt, want a predictable steady drip → **capacity tax (~20%)**, *protected* at the granting level — and assume it will be raided unless someone defends it.
- Large, indivisible remediation (migration, re-platform, rewrite) → **dedicated block** (and expect it to be the first thing cut, so commit to it explicitly).
- Localized debt in actively-changing code, no budget to negotiate → **fix-on-touch** as the always-on baseline.
- Realistically → run **all three as layers** (fix-on-touch baseline + protected tax + dedicated blocks for the big items); they cover different debt.

**How do I get *this* item funded?**
- Does a feature need to traverse this debt? → **bundle it** as the feature's enabling first phase (transparently). Highest leverage by far.
- No feature needs it, but it has recurring cost? → **quantify the interest in business units** (money / time-to-market / risk) and argue for a dedicated allocation.
- Tempted to file a naked "refactoring epic"? → **don't.** Reframe as bundled or quantified, or it will lose and should.

**Is this debt ticket alive or a zombie?**
- Moved in the last two reviews, has a current cost, has an owner? → **alive, keep and rank.**
- Module deleted / made moot / never real / will never beat anything? → **zombie, close it.** If it matters again the smell resurfaces.
- Can't say whether it's alive? → that uncertainty *is* the answer: re-justify with a current cost now or **close it.**

**How do I prioritize debt that spans teams?**
- Hotspot touched by many teams → surface it at **portfolio level with aggregate cost** across all touchers.
- Shared substrate nobody owns (the commons) → **named owner + central funding + aggregate-cost visibility + paved-road defaults.** Per-team incentives will never fund it.

**How do I report debt to leadership?**
- Lead with **trends + location + a number** (a DORA metric degrading in a named area), not absolute volume.
- Tie it to **metrics leadership already tracks**; reserve **"crisis"** for genuine risk; **show paydown paying off** to earn the next allocation.

---

## Mental Models

- **The per-ticket debt fight is unwinnable by design.** A lone debt ticket loses to a feature with a sponsor and a number nearly every time. Stop fighting at the ticket level; move the decision up to an *allocation policy* and a *roadmap negotiation* where debt competes as a funded category, not an underdog.

- **Features promise a visible gain; debt promises an invisible avoided-loss.** A measurable upside beats an unmeasured counterfactual by default. The entire job of debt framing is to *make the avoided-loss visible* — as interest in money/time/risk, or by *bundling* it with a feature so it inherits a visible upside.

- **A capacity tax is only as real as it is protected.** Twenty percent granted and then raided every deadline is zero percent with extra ceremony. The policy is trivial; *defending it at the level it was granted* is the whole game.

- **Bundle debt into the feature that needs it.** The refactor that loses alone wins as a feature's enabling first phase — same work, but now funded by the feature's business case instead of competing against it. Bundle honestly, or you trade short-term funding for long-term mistrust.

- **A debt register is a garden, not an archive.** Its value is inversely proportional to its size past usefulness. Thirty live, owned, ranked items beat three hundred zombies. *Closing* tickets is success; an only-growing register is dying.

- **Shared debt is systematically under-funded.** Every individual incentive points away from fixing the commons. Reverse the tragedy with a *named owner*, *central funding*, *aggregate-cost visibility*, and *paved-road defaults* — better per-team scoring will never get there.

- **Leadership credibility is a depletable resource.** Over-report and they tune you out for the quarter it's real. Calibrated, trend-based reporting tied to metrics they already track — plus visible wins — keeps debt fundable for years.

---

## Common Mistakes

1. **Fighting the debt-vs-feature battle ticket-by-ticket in sprint planning.** Structurally unwinnable — the feature has a sponsor and a number. Move the contest up to an allocation policy and a roadmap negotiation where debt competes as a funded category.

2. **Presenting a naked "refactoring epic."** No business case, unbounded scope, zero visible output — it deserves to lose and will. Bundle it with the feature that needs it, or quantify its interest in business terms. Never pitch the refactor as itself.

3. **Granting a capacity tax and not protecting it.** An unprotected 20% gets raided the first slipped deadline and never comes back. If leadership won't defend it against its own deadline pressure, you don't have a policy — you have theater.

4. **Relying on dedicated blocks alone.** The fix-it week is the first thing cut when the schedule slips, and "we'll fix it in the hardening sprint" becomes permanent deferral. Blocks fund the *big indivisible* items; pair them with fix-on-touch and a tax for everything else.

5. **Logging every smell as a debt ticket.** It feels responsible and is the express lane to a 400-ticket graveyard where the ten items that matter are invisible. Most small debt belongs to fix-on-touch; the register is only for debt big enough to need deliberate ranking.

6. **Letting the register grow without pruning.** Un-triaged, un-owned, never-closed tickets are noise that buries signal. Cap the register, kill zombies on a cadence, give every live item an owner, and treat closing as success.

7. **Leaving cross-team / platform debt to per-team incentives.** The commons only rots faster — every local incentive says "route around it." It needs a named owner, central funding, and aggregate-cost visibility, not five teams each hoping another pays.

8. **Crying wolf to leadership.** If every quarter is a "debt crisis," the word stops working and they ignore the one real emergency. Report calibrated trends tied to metrics they already track, reserve "crisis" for genuine risk, and show paydown paying off.

---

## Test Yourself

1. A debt ticket and a feature compete in the same sprint-planning session, every sprint, and the debt ticket almost always loses. Explain the *structural* reason, and describe the change in approach that actually fixes it (not "advocate harder").
2. Compare a fixed 20% capacity tax, dedicated paydown blocks, and fix-on-touch: what does each fund well, what is each blind to, and which is "first to be cut"? Why do mature orgs run all three?
3. A teammate files "Refactoring epic: rework the billing module — 5 weeks" and it's stuck at the bottom of the backlog. Give two distinct ways to get the *same work* funded, and say which is higher-leverage and why.
4. Your debt register has grown to 300+ tickets and nobody can name the top five debt items. What specifically went wrong, and what governance practices bring it back to usefulness?
5. An internal framework hurts five product teams but no team will fund fixing it; each routes around it instead. Name the phenomenon and the three mechanisms that actually get it funded.
6. Engineering keeps telling leadership "we have a critical tech-debt problem" and leadership has stopped listening. Diagnose the reporting failure and describe how to report debt so leaders act.
7. You quantified that a god-object costs ~1.5 engineer-months/quarter in regression risk. A PM still won't prioritize the "refactor." What's the most likely framing problem, and how do you re-pitch it?

<details>
<summary>Answers</summary>

1. **Structural reason:** a feature offers a *visible, measurable upside* (a revenue/usage number someone is accountable for) while debt paydown offers an *invisible avoided-loss* (something bad merely won't get worse — a counterfactual nobody gets credit for). A measurable gain beats an unmeasured avoided-loss by default, so a naked debt ticket loses nearly every time. **Fix:** stop fighting at the ticket level (unwinnable by design) and move the decision *up* — settle debt's share once via an **allocation policy** (a protected capacity tax / dedicated blocks) and fund specific large items via **roadmap negotiation** where debt competes as a *category* or rides a feature's business case, not as an underdog line item.
2. **Capacity tax (~20%):** funds continuous small/medium paydown, predictable and easy to explain; *blind to where debt actually is* (flat tax on an uneven distribution); its failure mode is being **raided** under deadline. **Dedicated blocks:** the only model that funds *large, indivisible* remediations; *first thing cut* when the schedule slips, and tempts teams to defer debt until the block. **Fix-on-touch:** free and self-targets perfectly (only ever touches actively-changed code = hotspots); *can't reach* structural debt or untouched code. Mature orgs run **all three as layers** because each covers debt the others structurally cannot — fix-on-touch the localized tail, the tax the continuous middle, blocks the big indivisible items.
3. (a) **Bundle** the refactor as the funded first phase of a feature that must be built on the billing module ("Feature X — 9 weeks, first 3 restructure billing so the rest is clean"), transparently. (b) **Quantify the interest in business terms** ("billing changes cost 3× longer; this is ~1.x engineer-months/quarter and rising") and argue for a dedicated allocation. **Bundling is higher-leverage** because the refactor inherits the feature's *visible upside* and is funded by its business case, instead of standing alone as an avoided-loss it will lose as. (Bundle only debt the feature genuinely needs to traverse.)
4. **What went wrong:** every smell/TODO got logged as a ticket; nothing was pruned, owned, or re-ranked, so 300 tickets accumulated and the ~10 that matter are buried under zombies (deleted modules, never-real "debt," items that'll never beat anything) — the register became write-only noise. **Fix:** a **review cadence** that re-ranks the top, **kills zombies** (close-or-justify any ticket stale for N reviews), assigns a **named owner** per live item, and **caps** the register so adding one forces closing another. Treat *closing* as success; route most small debt to fix-on-touch instead of the register.
5. **Tragedy of the commons** — shared substrate that hurts everyone and is owned by no one, where each team's local optimum is to route around it. **Three mechanisms:** (1) give the commons a **named owner** (a platform team chartered to own it), (2) **fund it centrally** so paydown isn't hostage to any product roadmap (distributed incentives never will), and (3) surface the **aggregate cost** across all teams (plus paved-road defaults so the maintained path is the easy path).
6. **Failure:** crying wolf — over-reporting absolute debt volume ("we have a lot of debt") as a recurring "crisis," which is unmeasurable, un-actionable, and trains leadership to discount the message. **Fix:** report **trends with a location and a number** (a DORA metric like change-failure rate or lead time *degrading in a named area*), tie debt to **metrics leadership already tracks**, **reserve "crisis"** for genuine risk (so the word still works), and **show paydown paying off** (metric improved after a fix) to earn the next allocation. Calibrated alarm, not maximal alarm.
7. The framing problem is almost certainly that it's still pitched as a **"refactor"** — a naked, customer-invisible, open-ended cleanup, even with a number attached. **Re-pitch:** either **bundle** it as the enabling first phase of the next feature that has to be built in that module (so the cost rides a funded business case and the PM buys a *feature*, not a refactor), or reframe the number as a forward cost on the *roadmap* ("the next three items in this module will cost ~9 extra weeks unless we fix the structure first") so it's a decision about *those features*, not about abstract code health.

</details>

---

## Cheat Sheet

```
THE PERENNIAL FIGHT (one backlog, finite capacity)
  feature  = visible measurable GAIN (has a sponsor + number)
  debt     = invisible AVOIDED-LOSS (a counterfactual, no credit)
  → naked debt ticket loses by design. Move the fight UP a level.

ALLOCATION MODELS (run all three as LAYERS)
  fix-on-touch   free; self-targets active code; can't reach structural debt
  capacity tax   ~20% continuous; blind to where debt is; GETS RAIDED unless protected
  dedicated block large indivisible items; FIRST to be cut when schedule slips
  RULE: a tax/block is only as real as it is PROTECTED at the granting level

GET IT FUNDED (in priority order)
  1. BUNDLE   make the refactor the feature's enabling first phase (transparently)
  2. QUANTIFY interest in business units: $ / time-to-market / risk
                interest rate × how often you pay = recurring cost PM can weigh
  3. NEVER    present a naked "refactoring epic" (no case, unbounded → loses, rightly)

GOVERN THE PORTFOLIO (register = garden, not archive)
  cadence    monthly/quarterly review: re-rank, kill zombies, confirm owner, promote
  owner      named owner per major item (steward ≠ assignee)
  zombies    close-or-justify any ticket stale N reviews; closing = success
  cap        hard cap (~30) forces ranking; don't log every smell (→ graveyard)
             most small debt → fix-on-touch, NOT the register

CROSS-TEAM / THE COMMONS (tragedy of the commons)
  shared hotspot → surface at portfolio level with AGGREGATE cost across touchers
  substrate nobody owns → NAMED OWNER + CENTRAL FUNDING + aggregate visibility
                          + paved-road defaults (easy path = correct path)

REPORT TO LEADERSHIP (credibility = depletable)
  trends + location + number  (a DORA metric degrading in a named area)
  tie to metrics they already track; reserve "crisis" for real risk
  SHOW paydown paying off → earns the next allocation
```

---

## Summary

- **The debt-vs-feature fight is unwinnable ticket-by-ticket** because a feature is a *visible gain* and debt paydown is an *invisible avoided-loss*. Move the decision up to an **allocation policy** and a **roadmap negotiation**, where debt competes as a funded category instead of an underdog line item.
- **Four allocation models, run as layers:** **fix-on-touch** (free, self-targeting, but can't reach structural debt) as the baseline; a **protected capacity tax (~20%)** for continuous medium paydown (it *will* be raided unless defended at the granting level); and **dedicated blocks** for large indivisible remediations (first to be cut, so commit explicitly). Each covers debt the others structurally cannot.
- **Get specific items funded** by, in order: **bundling** the refactor as a feature's enabling first phase (highest leverage — it inherits the feature's business case); **quantifying** the interest in business units (money / time-to-market / risk); and **never** pitching a naked "refactoring epic," which deserves to lose and will.
- **Govern the portfolio** like a garden: a **review cadence** that re-ranks and prunes, a **named owner** per major item, **aggressive zombie-killing** (close-or-justify), and a **capped** register. Most small debt belongs to fix-on-touch, not the register — logging every smell is the road to a 400-ticket graveyard.
- **Cross-team and platform debt is systematically under-funded** because every per-team incentive points away from fixing the commons. Reverse the tragedy with a **named owner**, **central funding**, **aggregate-cost visibility**, and **paved-road defaults** — better scoring inside each team will never get there.
- **Report to leadership with calibrated alarm:** trends with a location and a number, tied to **[DORA metrics](../../engineering-metrics-and-dora/) they already track**, with **"crisis" reserved** for genuine risk and **paydown wins shown** to earn the next allocation. Credibility is the asset; spend it deliberately.

You can now manage debt as a portfolio and win the funding negotiation — which is the bridge to actually executing the work. The next topic, [05 — Paying Down Debt](../05-paying-down-debt/professional.md), is *how* you spend the capacity you just fought to secure.

---

## Further Reading

- Kruchten, Nord & Ozkaya, *Managing Technical Debt* (SEI) — the portfolio view: a debt register, an owner per item, and prioritizing across a system rather than a single module.
- Martin Fowler, ["Technical Debt"](https://martinfowler.com/bliki/TechnicalDebt.html) and ["Is High Quality Software Worth the Cost?"](https://martinfowler.com/articles/is-quality-worth-cost.html) — the economic argument you reframe for product, in product's language.
- Forsgren, Humble & Kim, *Accelerate* — the DORA metrics that let you report debt as a degrading outcome leadership already tracks, instead of as abstract code health.
- Adam Tornhill, *Software Design X-Rays* — behavioral hotspots and *aggregate* hotspot cost across teams, the data behind cross-team prioritization.
- Donella Meadows, *Thinking in Systems* — the tragedy of the commons and why shared substrate decays under distributed incentives (the platform-debt problem, generalized).
- Reinertsen, *The Principles of Product Development Flow* — cost-of-delay as the language for arguing any investment, debt included, on a product roadmap.

---

## Related Topics

- [junior.md](junior.md) · [senior.md](senior.md) · [interview.md](interview.md) — the rest of this topic's tier set: capturing debt simply (junior), scoring one item with cost-of-delay/WSJF (senior), and the interview consolidation.
- [05 — Paying Down Debt](../05-paying-down-debt/professional.md) — *how* you spend the capacity this page fought to secure: boy-scout rule, strangler fig, dedicated vs continuous paydown, measuring payoff.
- [02 — Identifying & Quantifying](../02-identifying-and-quantifying/professional.md) — where the *number* you put on each item in business terms comes from (remediation cost, interest rate, lead-time and defect impact).
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the metrics leadership already tracks, which you route debt reporting through so it lands without crying wolf.
