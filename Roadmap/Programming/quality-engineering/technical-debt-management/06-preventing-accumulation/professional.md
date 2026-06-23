# Preventing Accumulation — Professional Level

> **Roadmap:** [Technical Debt Management](../README.md) → [Preventing Accumulation](./) → Professional
> *The senior page taught you the controls — Definition of Done, gates, fitness functions, a debt budget. This page is about why those controls keep getting switched off. Prevention is not a tooling problem you solve once; it's a standing fight against the incentive gradient. If the only thing your org rewards is hitting dates, then taking on debt is the* rational individual choice*, and no linter will save you. The work here is changing what gets rewarded.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Prevention Is an Incentives Problem, Not a Tooling One](#prevention-is-an-incentives-problem-not-a-tooling-one)
4. [Broken Windows at Org Scale](#broken-windows-at-org-scale)
5. [Building a Quality-First Engineering Culture](#building-a-quality-first-engineering-culture)
6. [Aligning Incentives and the Golden Path](#aligning-incentives-and-the-golden-path)
7. [Preventing Debt During Org Events](#preventing-debt-during-org-events)
8. [The Leadership Conversation That Funds Prevention](#the-leadership-conversation-that-funds-prevention)
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

> Focus: **The culture, incentives, and systems that keep debt low across an organization — and why those are leadership problems before they are engineering ones.**

The earlier tiers gave you a toolbox: a Definition of Done that includes tests and docs, quality gates in CI, architectural fitness functions, the boy-scout rule, a debt budget. Every one of those controls works in a demo. And every one of them gets quietly abandoned the first time a launch date is at risk — the DoD gets a "we'll add tests next sprint" exception, the gate gets a `// nolint`, the fitness function gets disabled in `main` because it's "blocking the release."

This is the central, uncomfortable truth of the professional tier: **prevention controls don't fail technically, they fail politically.** They fail because they sit in tension with the actual reward function of the organization, and over a long enough horizon the reward function always wins. If a team ships on time with awful code and gets praised, while a team that pushed a date to keep the code clean gets a hard conversation, you have *taught* the org that debt is free and quality is expensive. People are not stupid; they optimize for what is rewarded.

So the professional skill is not "configure better gates." It's diagnosing the incentive gradient your team is standing on, and reshaping it so that the clean thing is also the rewarded thing — and, where possible, the *default* thing that requires no willpower at all. That spans Definition of Done, planning rituals, leadership language, paved paths owned by a platform team, onboarding, and the specific organizational *events* — crunch, reorgs, acquisitions, attrition — that manufacture debt faster than any sprint ever could. This is the layer where you stop being the person who *cleans up* debt and become the person who *changes the conditions that produce it*.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — Definition of Done, quality gates, fitness functions, the debt budget, and the boy-scout rule as concrete mechanisms.
- **Required:** [Paying Down Debt — Professional](../05-paying-down-debt/professional.md) — you can't credibly argue for prevention budget without understanding the cost of cure.
- **Required:** [What Is Technical Debt — Professional](../01-what-is-technical-debt/professional.md) — principal vs interest, and the prudent/reckless distinction this page assumes.
- **Helpful:** You've watched a quality control get switched off under deadline pressure — and seen what happened six months later.
- **Helpful:** You've influenced a roadmap or a team's working agreements, not just your own commits.

---

## Prevention Is an Incentives Problem, Not a Tooling One

Start with the model that explains almost every failure of prevention: **debt is the locally rational choice under a delivery-only reward function.**

Picture an engineer with a feature due Friday. The clean implementation needs a small refactor of a shared module — two extra days, some risk, a code review argument. The dirty implementation copy-pastes the logic, special-cases the new behavior, and ships Thursday. Which gets rewarded? In most orgs, the one that shipped. The refactor's benefit is *diffuse and deferred* (the codebase stays changeable, for everyone, later); its cost is *concentrated and immediate* (this engineer is slower, this sprint, visibly). The dirty version inverts that: concentrated immediate benefit (shipped, praised), diffuse deferred cost (everyone pays interest, later, untraceably). **This is a classic tragedy of the commons, and the commons is the codebase.**

No tool changes this calculus. A linter that blocks the merge just gets a suppression comment, because the engineer is still being measured on Friday. The gate is fighting the incentive and the incentive is stronger. So the leverage is not the gate — it's the three places where the reward function is actually set:

**1. Definition of Done is the contract.** If "done" means "feature works in the demo," then tests, docs, and cleanup are optional extras that vanish under pressure. If "done" *structurally includes* tested, reviewed, no new gate violations, and the touched code left no messier than found, then quality is not a thing you trade against the deadline — it's part of what the deadline is *for*. The DoD is where you move quality from "nice-to-have we cut first" to "definition of the work." (See [senior.md](senior.md) for the concrete DoD checklist; the professional move is *enforcing* it when a VP wants an exception.)

**2. Debt must be visible in planning, in the same units as features.** Invisible debt is unfunded by construction — you can't prioritize what doesn't appear on the board. When the only cards in the sprint are features, paydown is something that happens in stolen time, apologetically. When debt items sit on the *same backlog* with the same estimation and the same cost-of-delay math (see [Tracking & Prioritizing](../04-tracking-and-prioritizing/)), the conversation changes from "should we waste time on cleanup" to "which of these competing investments has the better return." You're not asking for charity; you're competing on ROI.

**3. Leadership language sets the norm — "slow is smooth, smooth is fast."** Teams read what leaders *celebrate*, not what they put in the values deck. If every all-hands praises the heroic weekend that saved the launch, you are training people to create the crises that produce heroes. If leaders instead ask "what did we have to cut to hit that date, and when do we pay it back?" — and *fund the payback* — they signal that sustainable pace is the expectation. The phrase "slow is smooth, smooth is fast" (from special-operations training) captures it: deliberate, careful work *is* the fast path over any horizon longer than one sprint, because it doesn't manufacture the rework that dominates real-world velocity.

> **The professional reality:** when you find yourself proposing yet another gate to stop a recurring kind of debt, stop and ask *why the last gate failed*. Almost always it's because the gate was fighting an incentive nobody addressed. Fix the incentive — what "done" means, what shows up in planning, what leadership praises — and the gates start *holding* instead of getting suppressed. Tooling enforces a culture that already exists; it cannot create one that doesn't.

---

## Broken Windows at Org Scale

The **broken-windows theory** — that visible, tolerated small disorder signals that nobody is watching and invites larger disorder — was coined for neighborhoods, popularized for codebases by Hunt and Thomas in *The Pragmatic Programmer*, and it is the single most useful lens for *culture-level* prevention. At org scale it operates as a **norm-setting mechanism**, and it runs in both directions.

**Downward (the death spiral).** A `TODO: fix this hack` sits untouched for a year. A flaky test gets `@Disabled` instead of fixed. A module everyone knows is rotten never gets cleaned. Each tolerated mess is a *signal to every engineer who reads it*: this is what's acceptable here; care is not rewarded here; don't bother. The next person, reasonably, matches the local standard — why polish your function when it sits next to a dumpster fire nobody's putting out? Standards don't collapse by decision; they erode by example. The most expensive broken window is not the messy code itself — it's the **permission it grants**.

**Upward (the virtuous version).** The same mechanism builds quality when care is *visible*. A codebase where the formatter is non-negotiable, where reviews routinely catch and fix small messes, where someone tidies the module they touched and it gets noticed — teaches the opposite lesson: *here, we keep things clean, and that's normal.* New engineers calibrate to the standard they see, and a high standard is self-reinforcing because nobody wants to be the one who lowered the bar. This is why "fix the small things visibly" is high-leverage out of proportion to the lines changed: you're not fixing a window, you're resetting the norm.

The professional implication is about **where to spend a fixed cleanup budget for maximum culture effect.** A reorg, a quarter of crunch, or an acquisition (next section) is exactly the moment windows get broken at scale — and exactly the moment to *visibly* fix a few, because the norm is being re-established whether you steer it or not. The lever isn't fixing *every* window (you can't); it's making sure the *signal* in the codebase says "cared for," not "abandoned." One conspicuously cleaned-up core module resets expectations more than a hundred quiet fixes in corners nobody reads.

> **The norm is the asset.** You are not maintaining code; you are maintaining a *standard*, and the standard is communicated by what's tolerated. A single visibly-rotten, untouched hotspot can lower the bar for an entire team, because it proves that messes survive here. Conversely, a small, visible act of care — done where people will see it — raises the bar for free. Spend your scarce attention on the windows everyone walks past.

---

## Building a Quality-First Engineering Culture

Culture is not a poster; it's **the set of behaviors that are easy, expected, and rewarded.** Four concrete mechanisms turn "we value quality" from aspiration into the path of least resistance.

**Review norms that prevent rather than nitpick.** Code review is the highest-frequency cultural ritual you have — it's where standards are transmitted, person to person, dozens of times a day. The professional move is to *aim* it at debt prevention rather than style bikeshedding. That means: a shared, written definition of what review is *for* (correctness, changeability, "would the next person understand this?") and what it explicitly is *not* for (formatting — that's the formatter's job, automated away so humans never argue about it). It means reviewers are expected to flag *new* debt ("this duplicates logic in X," "this special-case will rot") as a first-class review outcome, not a nice-to-have. A review culture that only checks "does it work" is a debt *intake* funnel; one that asks "will this still be changeable in a year" is a debt *filter*.

**Blameless standards.** People hide debt — skip the test, suppress the warning, leave the `TODO` undocumented — when admitting it is dangerous. A blameless culture (drawn straight from incident-response practice) makes the rational move *disclosure* instead of concealment: "I shipped this with a known shortcut, here's the ticket" is met with "good, it's tracked" rather than punishment. Critically, blameless does not mean standardless — it means you separate *the person* from *the system that made the shortcut tempting*. The output of a debt postmortem is a fixed incentive or a paved path, not a name.

**Paved paths owned by a platform team.** This is the structural heart of culture at scale, and it deserves its own section below — but the cultural point is this: a strong culture *removes the temptation to cut corners* by making the well-architected option the easiest one. When the blessed service template already has logging, metrics, CI, the right error handling, and the security defaults wired in, an engineer in a hurry reaches for the paved path *because it's faster*, and gets quality as a side effect. Culture you have to enforce with willpower loses to deadlines; culture baked into the default tooling doesn't require willpower at all.

**Onboarding that teaches the local "clean."** "Clean code" is not universal — every codebase has a *local* definition of good (its layering, its naming, its idioms, its testing style), and that definition lives mostly in senior engineers' heads. New hires (and acquired teams — see below) default to *their previous* org's standard until they're explicitly taught yours, and every untaught newcomer is a slow leak of foreign patterns into the codebase. Encoding the local "clean" — in a short, living style guide, in the paved-path templates, in the first few reviews a new hire gets — is how you keep the standard from diluting one well-meaning newcomer at a time. The cost of *not* doing this compounds: each cohort onboarded by osmosis drifts a little further from the intended design.

> **The cultural test:** does doing the right thing require *willpower*, or is it the default? A culture that depends on every engineer choosing virtue under deadline pressure will lose, every time, because willpower is a depleting resource and deadlines are infinite. A culture where the easy path *is* the clean path — paved templates, automated formatting, reviews aimed at changeability, blameless disclosure — wins because it doesn't ask people to be heroes. **Engineer the defaults, don't exhort the people.**

---

## Aligning Incentives and the Golden Path

If the previous sections diagnosed the incentive problem, this one is the *prescription*: change what gets rewarded, and make the healthy thing the default.

**Stop rewarding feature velocity as the sole metric.** The moment shipped-features-per-quarter is the only number that determines a good review, a promotion, or praise, you have *priced debt at zero* and quality at a personal cost — and you will get exactly what you priced. This doesn't mean velocity stops mattering; it means it can't be the *only* thing that matters, because a metric optimized in isolation gets gamed, and the way you game "ship more features faster" is by skipping the slow, careful, debt-preventing work. The fix is to pair delivery metrics with *health* metrics that leadership actually looks at — change-failure rate, lead time, the trend in your debt hotspots (see [Engineering Metrics & DORA](../../engineering-metrics-and-dora/)). When a team's *fast-but-fragile* output shows up as a rising change-failure rate next to their feature count, the incentive to cut corners loses its cover.

**Recognize debt prevention explicitly.** What gets celebrated gets repeated. If the only things that earn visible recognition are launches, then the engineer who spent a week deleting a class of bugs, or untangling a module so the *next* ten features are cheap, did invisible work — and learned not to do it again. The professional move is to make prevention *legible*: call out the refactor that unblocked a roadmap in the same channel you celebrate launches; in promotion packets, credit "made the system more changeable" as a real accomplishment with evidence (the features it later enabled, the incidents it prevented). You are signaling that the diffuse, deferred, commons-protecting work is *seen*. Otherwise you are running an organization that, by its own reward function, punishes the exact behavior you say you want.

**Make the healthy thing the default — the golden path.** This is the highest-leverage prevention mechanism in existence, because it doesn't fight the incentive gradient — it *re-routes* it. A **golden path** (or paved road) is the supported, opinionated, well-architected way to build a service in your org: a generated template, a shared library, a CLI that scaffolds the blessed setup with logging, observability, CI, security defaults, and the right architectural seams already in place. Its power is psychological as much as technical: it makes the well-engineered choice the *fastest* choice, so an engineer optimizing purely for their own speed *still* produces quality, with no willpower spent. The platform team that owns the golden path is, in effect, the org's prevention team — every improvement to the paved road prevents a class of debt across *every* team that uses it, simultaneously. Compare that leverage to a linter rule. A golden path is prevention with a force multiplier.

The three together form a system: **measure health alongside speed** (so corner-cutting is visible), **recognize prevention** (so it's worth doing), and **pave the path** (so the right thing needs no willpower). Miss any one and the other two leak — pave a path no one's rewarded to use and adoption stalls; reward prevention while measuring only velocity and you've sent a contradiction.

> **The incentive reality:** you cannot out-discipline a bad incentive structure at scale. If your reward function says "ship features, ignore the commons," then asking engineers to prevent debt is asking them to act against their own interest, and a few will (the conscientious ones, until they burn out or leave) while most, rationally, won't. Change the reward function — health metrics in the open, prevention recognized, the clean path made default — and prevention stops being an act of individual virtue and becomes simply *how work gets done here*.

---

## Preventing Debt During Org Events

Steady-state prevention — DoD, reviews, paved paths — handles the debt of normal development. But the *largest* debt spikes don't come from normal development; they come from **organizational events**, and these are where a prevention-minded engineer earns their keep, because the debt is predictable and therefore preventable if someone names it in advance.

**Crunch and deadline pressure.** Crunch is a debt-manufacturing machine: under a hard date, every local decision tilts toward the dirty option, gates get exceptions, and the DoD quietly loses its quality clauses. The prevention move is *not* "don't crunch" (sometimes the business genuinely needs a date) — it's **making the debt of crunch explicit and pre-committing to its repayment.** Before the crunch: name what you'll cut ("we're skipping the refactor and the integration tests on module X"), write the paydown tickets *now* while everyone remembers why, and get leadership to fund a post-crunch recovery sprint *as part of the same decision*. Crunch that is *acknowledged and scheduled for repayment* is prudent deliberate debt; crunch that is denied ("we'll be fine") is reckless debt that becomes permanent, because once the launch ships the pressure moves on and the unwritten tickets evaporate.

**Reorgs and the orphaning of code.** Reorganizations break ownership. A module whose team gets disbanded or reshuffled becomes *orphaned* — no one feels responsible, so no one tidies it, broken windows accumulate, and it rots faster than any actively-owned code. The prevention move is to treat **ownership as a first-class artifact of any reorg**: every service/module must have an explicitly named owning team *after* the dust settles, with no orphans, and the reorg plan should *say so* before it's executed. Reorgs are also a prime broken-windows moment (people are demoralized, standards wobble) — which is exactly when a visible re-commitment to the bar pays off. The debt of a reorg isn't the new org chart; it's the code that fell through the cracks between the old chart and the new one.

**Acquisitions and inherited code.** Acquired codebases arrive with a *foreign* definition of "clean" — different conventions, different testing culture, different architecture, and a team that learned a *different* set of norms. Forcing instant assimilation manufactures debt (rushed, half-translated rewrites); ignoring it manufactures debt (two divergent standards forever, and a quiet drift as the foreign patterns spread). The professional path is deliberate *integration*, not conquest: decide explicitly which of their patterns to adopt and which of yours to impose, give the acquired team real onboarding into your local "clean" (and learn from theirs where it's better), and budget integration as real work with a timeline — not a side effect expected to happen for free. The single biggest acquisition mistake is assuming culture transfers by proximity; it transfers by *teaching*.

**Attrition and knowledge loss.** When the person who understood a gnarly subsystem leaves, the *code* hasn't changed but the *debt* just spiked — because debt is the gap between the code and the team's ability to change it safely, and that ability just dropped. Undocumented tribal knowledge is debt with a single point of failure attached. The prevention moves are the boring, durable ones: documentation and ADRs *while* people are present (not extracted in an exit interview), pairing and rotation so no subsystem has a bus factor of one, and treating a key departure as a trigger to *invest* in the now-orphaned area before it becomes unmaintainable. Attrition is the one org event you can't schedule, which is exactly why the defenses against it have to be *standing*, not reactive.

**Outsourced and contractor code.** Code written by a vendor optimizing for *their* contract (deliver to spec, on date, move on) is structurally prone to debt — they don't pay the interest, you do, so the incentive to invest in changeability is misaligned by default. Prevention here is *contractual and procedural*: the same Definition of Done, the same quality gates, and the same code review applied to vendor output as to internal code, plus a real knowledge-transfer requirement before the engagement ends. The classic failure is accepting outsourced code that *passes acceptance tests but is internally unmaintainable* — it works on day one and becomes a tar pit on day ninety, after the vendor is gone and no one on your team understands it. Whoever doesn't pay the interest can't be trusted to price the debt; you have to price it for them, in the contract.

> **The professional pattern across all five:** org events produce debt because they *break the normal prevention mechanisms* — they sever ownership, override the DoD, import foreign standards, drain knowledge, or misalign incentives. The defense is the same shape every time: **name the debt the event will create *before* it happens, and pre-commit to the specific work that pays it back.** Debt taken on knowingly, with a written repayment plan, is prudent; debt that an event creates silently while everyone's attention is elsewhere is how organizations end up with subsystems no one will touch.

---

## The Leadership Conversation That Funds Prevention

Every prevention mechanism on this page — paved paths, recovery sprints, health metrics, integration budget — costs money and time that could go to features. None of it happens without leadership *funding* it, which means the final professional skill is **making the business case for prevention in language a non-engineer will act on.** The argument has three moves.

**1. Prevention is cheaper than cure — frame it as interest, not aesthetics.** The losing pitch is "the code is messy and it bothers us." The winning pitch reuses the debt metaphor leadership already understands: *we are paying interest on debt, every sprint, forever, until we either prevent it or pay it down.* Prevention is refinancing before the balance compounds. Concretely: a paved path that costs one team-quarter to build saves a slice of *every* future service's setup and a class of *every* team's bugs — it amortizes across the whole org and across all future time, which is exactly the shape of investment leadership funds elsewhere. Frame prevention as the *cheap* option it is on any multi-quarter horizon, because the alternative isn't "save the money," it's "pay it with interest later."

**2. Quantify the cost of *not* preventing.** Abstract "quality" loses budget fights; concrete cost wins them. Translate prevention into the metrics leadership already tracks (see [Tracking & Prioritizing](../04-tracking-and-prioritizing/) and the metrics roadmap): the lead-time tax (features in this area take N× longer than they should), the change-failure rate in debt-heavy modules, the on-call burden and incident rate the debt generates, the attrition risk of engineers worn down by it. "This subsystem's debt costs us roughly X engineer-weeks per quarter in slowdown and Y incidents" is a sentence a VP can act on. "It's not clean" is not. The cost of *not* preventing is always being paid — your job is to make it *visible* so it can be compared against the cost of prevention.

**3. Make it a portfolio decision, not a moral one.** Don't ask leadership to choose virtue; ask them to choose return. Prevention investments compete with features on the same ROI terms — and well-chosen ones *win* on those terms, because their payoff is leveraged (a paved path) or compounding (debt you didn't take on never accrues interest). Bring the numbers, propose a *specific* allocation (the classic is a standing fraction of capacity for prevention + paydown, so it's not a recurring fight), and let the business make a business decision. When you frame it as "here's the return on each option," prevention stops being the thing engineers beg for and becomes a line item leadership *chooses* because it pencils out.

> **The funding reality:** prevention dies in orgs where it's argued as taste and lives in orgs where it's argued as economics. Leadership will not fund "let us write nicer code"; it will fund "this investment cuts our change-failure rate and lead time, amortizes across every team, and is cheaper than the interest we're paying now." Same work, different sentence. The professional engineer is fluent in *that* sentence — and brings the numbers to back it.

---

## War Stories

**The deadline culture that manufactured its own debt.** A product org ran on quarterly launch commitments, and the all-hands ritual was celebrating the teams that hit their dates — especially the heroic weekend saves. Velocity looked great for a year, then cratered: every team's features were taking 2–3× longer than estimated, and change-failure rate had crept up quarter over quarter. The post-mortem was uncomfortable: the org had *trained* itself to ship debt. Hitting the date was the only rewarded outcome, so every team, rationally, cut the same corners every quarter, and the accumulated interest had finally eaten the velocity that the deadlines were meant to protect. The fix wasn't a tool — it was reframing. Leadership added change-failure rate and lead-time to the metrics reviewed alongside delivery, started asking "what did we cut and when do we repay it?" at launch reviews, funded a standing paydown allocation, and pointedly celebrated a team that pushed a date to avoid a reckless shortcut. Velocity recovered over the next two quarters — not because anyone worked harder, but because the org stopped rewarding the manufacture of debt.

**The paved path that cut debt org-wide.** A company with ~40 services had 40 slightly-different ways of doing logging, config, error handling, and CI — every new service reinvented the setup, usually badly and under time pressure, and each one was a fresh debt seed. A small platform team invested two quarters in a golden-path service template: a CLI that scaffolded a new service with observability, CI, security defaults, and the right architectural seams already wired in. The leverage was immediate and *compounding*: every new service started clean for free, and because the paved path was *also the fastest way to start*, adoption needed no mandate — engineers in a hurry reached for it precisely *because* it was faster. An entire category of "we'll add metrics later" debt simply stopped being created. The platform team had become the org's prevention team; each improvement they shipped to the template prevented a class of debt across every service at once — leverage no per-team linter rule could match.

**Broken windows after a reorg.** A reorg dissolved the team that owned a core billing module and scattered its members. No new team was explicitly assigned ownership — it fell through the gap between the old org chart and the new one. Within two quarters it was visibly rotting: a flaky test got disabled, a `TODO: refactor this` aged untouched, a sloppy fix landed because there was no owner to hold the bar — and each tolerated mess signaled to the next engineer that this module was fair game for shortcuts. The decay wasn't really technical; it was *ownership* decay made visible through broken windows, and the broken windows were lowering the standard for everyone who passed through. The recovery had two parts: assign an explicit owning team (which stopped the bleeding), then have that team *visibly* clean up the module — fix the flaky test, do the deferred refactor, in the open. The visible care reset the norm; engineers calibrated back up. The lesson the org internalized: a reorg's real risk isn't the new boxes on the chart, it's the code that lands in the *whitespace between* them, and the cure is naming an owner *before* the reorg ships, not after the rot shows.

---

## Decision Frameworks

**Is a recurring debt problem a tooling gap or an incentive gap? Ask:**
- Has a previous gate/control for this been suppressed, exception'd, or disabled under pressure? → **incentive gap**; another gate will be suppressed too. Fix what "done" means, what's planned, what's rewarded.
- Is the right behavior genuinely *hard to do* (no template, no automation)? → **tooling gap**; pave the path.
- Do engineers *know* the right thing and skip it anyway? → incentive (it's not rewarded / it's slower / it's hidden), not knowledge.

**Should this prevention work get funded? Pitch it as:**
- Interest, not aesthetics — "we pay this every sprint until we prevent it."
- Quantified cost of *not* doing it — lead-time tax, change-failure rate, incidents, attrition risk.
- A portfolio choice with a return — competes with features on ROI; propose a *specific* allocation.

**An org event is coming (crunch / reorg / acquisition / key departure / vendor). Before it:**
- **Crunch** → name what you'll cut, write the paydown tickets now, fund a recovery sprint in the *same* decision.
- **Reorg** → assign an explicit owner to every module *before* it ships; no orphans.
- **Acquisition** → budget integration as real work; teach the local "clean"; decide which patterns to adopt vs impose.
- **Attrition** → ADRs/docs/pairing *standing*, not reactive; treat a key exit as a trigger to invest.
- **Vendor** → same DoD/gates/review as internal code + mandatory knowledge transfer before they leave.

**Where do I spend a fixed cleanup budget for culture effect? Default to:**
- The most *visible* broken windows (the modules everyone walks past), because you're resetting a norm, not fixing lines. One conspicuous fix beats a hundred quiet ones.

---

## Mental Models

- **Debt is the rational individual choice under a delivery-only reward function.** The dirty option has concentrated, immediate, rewarded benefit; the clean option has diffuse, deferred, unrewarded benefit. It's a tragedy of the commons with the codebase as the commons. You don't fix it with a linter; you fix it by changing what's rewarded.

- **Tooling enforces a culture; it cannot create one.** A gate that fights an unaddressed incentive gets suppressed. Fix the incentive — DoD, planning visibility, what leadership celebrates — and the gates start holding instead of getting `// nolint`'d.

- **The norm is the asset, and broken windows set the norm.** A single tolerated, visible mess grants permission to the whole team; a single visible act of care raises the bar for free. Spend attention where people will *see* it.

- **Engineer the defaults; don't exhort the people.** Willpower depletes and deadlines are infinite, so any culture that depends on engineers choosing virtue under pressure loses. Make the clean path the *fastest* path (golden path) and quality needs no willpower.

- **Org events break the prevention machinery — so name their debt in advance.** Crunch, reorgs, acquisitions, attrition, and vendors each sever ownership / override the DoD / import foreign standards / drain knowledge. Debt taken on knowingly with a written repayment plan is prudent; debt an event creates silently is how subsystems become untouchable.

- **Prevention is refinancing before the balance compounds.** It's cheaper than cure on any multi-quarter horizon, leveraged (paved paths) or compounding (debt never taken). Argue it as economics, not taste, or it doesn't get funded.

---

## Common Mistakes

1. **Treating prevention as a tooling problem.** Adding gate after gate while the underlying incentive (ship-by-Friday, quality unrewarded) goes unaddressed. The gates get suppressed. Diagnose *why the last control failed* before adding another.

2. **Rewarding feature velocity as the sole metric.** This prices debt at zero and quality at a personal cost, then acts surprised when engineers, rationally, cut corners. Pair delivery with health metrics leadership actually looks at.

3. **Letting prevention work be invisible.** If refactors and bug-class eliminations never get celebrated or credited in promotions, you've taught your best engineers not to do them. Make prevention *legible* and recognized.

4. **Depending on willpower instead of defaults.** Asking everyone to choose the clean path under deadline pressure. It loses every time. Pave the path so the clean choice is the easy, fast, default choice.

5. **Ignoring org events until they've already manufactured the debt.** Crunch with no named cuts and no recovery sprint; reorgs that orphan modules; acquisitions assimilated by osmosis; key departures with no knowledge transfer. Name the debt *before* the event and pre-commit to repayment.

6. **Tolerating visible broken windows.** Leaving the disabled flaky test, the year-old `TODO`, the rotten-but-untouched module — each one lowers the bar for everyone who reads it. Fix the *visible* ones to reset the norm.

7. **Pitching prevention as aesthetics, not economics.** "The code is messy" loses budget fights; "this cuts our change-failure rate and lead-time and amortizes across every team" wins them. Bring the numbers and frame it as a portfolio decision.

8. **Accepting "clean" as universal.** Assuming new hires, acquired teams, and vendors share your definition of good. They default to *their* prior standard until taught yours; every untaught newcomer is a slow leak of foreign patterns. Encode and teach the *local* "clean."

---

## Test Yourself

1. An engineer ships a copy-pasted, special-cased feature on time instead of the clean version that needed two more days. Explain, in terms of incentives and the commons, why this was the *rational* individual choice — and what would have to change for the clean version to be rational.
2. Your team keeps adding lint rules and CI gates to stop a recurring kind of debt, but it keeps appearing anyway. What's the most likely root cause, and where should you actually intervene?
3. Explain broken-windows theory at org scale in *both* directions, and use it to decide where to spend a small, fixed cleanup budget for maximum effect.
4. What is a "golden path" / paved road, and why is it described as prevention "with a force multiplier" compared to a linter rule? What makes engineers adopt it *without* a mandate?
5. A hard launch deadline (crunch) is coming. Describe the prevention moves that turn the crunch's debt from *reckless* into *prudent deliberate* debt.
6. A reorg is about to dissolve a team that owns a core module. What's the specific debt risk, and what single artifact must the reorg plan include to prevent it?
7. A VP asks "why should I fund this refactoring/platform work instead of features?" Give the three-move business case, in language they'll act on.

<details>
<summary>Answers</summary>

1. The dirty option's benefit is **concentrated, immediate, and rewarded** (shipped Thursday, praised for hitting the date); its cost is **diffuse and deferred** (everyone pays interest later, untraceably). The clean option inverts this — diffuse deferred benefit (codebase stays changeable for everyone, later), concentrated immediate cost (this engineer is visibly slower this sprint). That's a **tragedy of the commons** with the codebase as the commons, so debt is locally rational. For the clean version to be rational, the *reward function* must change: quality structurally in the Definition of Done (so "done" isn't "shipped Thursday"), debt visible in planning (so the refactor is funded work, not stolen time), and leadership rewarding sustainable pace over heroics.
2. The root cause is almost certainly an **incentive gap, not a tooling gap** — the gates keep getting suppressed/exception'd because they fight an incentive nobody addressed (engineers are still measured on the date, quality is still unrewarded). Intervene at the reward function: what "done" means (DoD), whether debt is visible in planning, and what leadership celebrates. A new gate fighting the same unaddressed incentive will be suppressed too.
3. **Downward:** a tolerated, visible mess (disabled test, aged `TODO`, rotten module) signals "care isn't rewarded here," granting permission for the next person to match the low standard — norms erode by example. **Upward:** visible care (non-negotiable formatter, reviews that fix small messes, noticed tidying) teaches "we keep things clean here," and new engineers calibrate up. Spend the fixed budget on the **most *visible* broken windows** — the modules everyone walks past — because you're resetting a *norm*, not fixing lines; one conspicuous fix beats a hundred in corners nobody reads.
4. A **golden path / paved road** is the supported, opinionated, well-architected default way to build a service — a template/CLI that scaffolds logging, observability, CI, security defaults, and the right seams already wired in. It's a **force multiplier** because one improvement to the path prevents a class of debt across *every* team using it simultaneously (vs a linter rule that catches one pattern in one repo). Engineers adopt it without a mandate because it's *also the fastest way to start* — optimizing purely for their own speed, they still produce quality, with no willpower spent.
5. Don't deny the debt — make it **explicit and pre-commit to repayment**: before the crunch, *name what you'll cut* ("skipping the refactor and integration tests on module X"), *write the paydown tickets now* while everyone remembers why, and get leadership to *fund a recovery sprint as part of the same decision*. Acknowledged, scheduled debt is prudent deliberate debt; denied debt ("we'll be fine") becomes permanent once the launch ships and attention moves on.
6. The risk is **orphaned code** — a module with no owning team falls through the gap between the old and new org charts, so no one tidies it, broken windows accumulate, and it rots faster than owned code. The reorg plan must include an **explicit named owning team for every module/service after the reorg, with no orphans** — ownership as a first-class artifact of the reorg, decided *before* it ships.
7. (a) **Interest, not aesthetics** — "we pay interest on this every sprint, forever, until we prevent or pay it down; prevention is refinancing before it compounds." (b) **Quantify the cost of *not* doing it** — lead-time tax (features here take N× longer), change-failure rate, incident/on-call burden, attrition risk — in the metrics they already track. (c) **A portfolio decision with a return** — it competes with features on ROI and *wins* because it's leveraged (paved path) or compounding (debt never taken); propose a *specific* allocation (e.g. a standing fraction of capacity) so it's not a recurring fight.

</details>

---

## Cheat Sheet

```
THE CORE INSIGHT
  Prevention is an INCENTIVES problem, not a tooling one.
  Under a delivery-only reward function, debt is the RATIONAL individual choice
  (concentrated immediate reward vs diffuse deferred cost = tragedy of the commons).
  Tooling enforces a culture; it cannot create one. A gate vs an unfixed
  incentive gets suppressed.

THREE PLACES THE REWARD FUNCTION IS SET
  Definition of Done  → quality is part of "done", not traded against the date
  Planning            → debt visible on the same backlog, same units as features
  Leadership language → "slow is smooth, smooth is fast"; reward pace, not heroics

BROKEN WINDOWS @ ORG SCALE
  down: one tolerated mess grants permission → norm erodes by example
  up:   one visible act of care raises the bar for free
  → spend cleanup budget on the VISIBLE windows (reset the norm, not the lines)

QUALITY-FIRST CULTURE (make the right thing the DEFAULT)
  review aimed at changeability (not formatting — automate that away)
  blameless disclosure (separate person from the tempting system)
  paved paths owned by a platform team
  onboarding that teaches the LOCAL "clean"

ALIGN INCENTIVES
  don't reward velocity alone → pair with health metrics (CFR, lead time, hotspots)
  recognize prevention explicitly (in praise AND promotions)
  golden path = prevention with a force multiplier (fastest = cleanest, no mandate)

ORG EVENTS (name the debt BEFORE, pre-commit to repayment)
  crunch       → name cuts + write paydown tickets now + fund recovery sprint
  reorg        → explicit owner per module, no orphans, before it ships
  acquisition  → budget integration; teach local clean; adopt vs impose
  attrition    → ADRs/docs/pairing STANDING; key exit = trigger to invest
  vendor       → same DoD/gates/review + knowledge transfer before they leave

LEADERSHIP PITCH (economics, not aesthetics)
  1. interest, not taste — "paid every sprint until prevented"
  2. quantify cost of NOT doing it — lead-time tax, CFR, incidents, attrition
  3. portfolio decision with a return — propose a SPECIFIC allocation
```

---

## Summary

- **Prevention is fundamentally an incentives-and-culture problem, not a tooling one.** Under a delivery-only reward function, taking on debt is the *rational individual choice* — concentrated immediate reward, diffuse deferred cost — a tragedy of the commons with the codebase as the commons. No linter overrides that; a gate fighting an unaddressed incentive just gets suppressed.
- **Change what's rewarded** at the three places the reward function lives: Definition of Done (quality is part of "done," not traded against the date), planning (debt visible on the same backlog in the same units as features), and leadership language ("slow is smooth, smooth is fast" — reward sustainable pace, not the heroics that manufacture crises).
- **Broken windows operate at org scale as a norm-setting mechanism, in both directions.** One tolerated, visible mess grants permission and erodes the standard by example; one visible act of care raises the bar for free. Spend scarce cleanup budget on the *visible* windows — you're resetting a norm, not fixing lines.
- **Build a quality-first culture by engineering the defaults, not exhorting the people:** reviews aimed at changeability (formatting automated away), blameless disclosure, paved paths owned by a platform team, and onboarding that teaches the *local* definition of "clean." Willpower loses to deadlines; defaults don't require willpower.
- **Align incentives** by pairing velocity with health metrics (so corner-cutting is visible), recognizing prevention explicitly (so it's worth doing), and making the healthy thing the default via a **golden path** — prevention with a force multiplier, because one improvement prevents a class of debt across every team and engineers adopt it *because it's the fastest path*, no mandate needed.
- **Org events — crunch, reorgs, acquisitions, attrition, vendors — manufacture the largest debt spikes** because they break the normal prevention machinery. The defense is the same shape every time: *name the debt the event will create before it happens, and pre-commit to the specific work that pays it back.*
- **Fund prevention by arguing economics, not aesthetics:** it's cheaper than cure (refinancing before the balance compounds), quantify the cost of *not* preventing in metrics leadership tracks, and frame it as a portfolio decision with a return — so prevention becomes a line item leadership *chooses*, not charity engineers beg for.

The next tier — [interview.md](interview.md) — consolidates the entire topic into the questions that probe whether someone can actually reason about prevention as a systems-and-incentives problem, not just recite a list of controls.

---

## Further Reading

- *The Pragmatic Programmer* (Hunt & Thomas) — the original "software entropy / broken windows" chapter that grounds the org-scale lens here.
- *Accelerate* (Forsgren, Humble, Kim) — the evidence that pairing delivery with health metrics (the DORA four) is how you stop rewarding fast-but-fragile.
- *Team Topologies* (Skelton & Pais) — platform teams, the "thinnest viable platform," and paved paths as the structural prevention mechanism.
- *Managing Technical Debt* (Kruchten, Nord & Ozkaya, SEI) — the canonical treatment of debt as a managed, funded, portfolio concern rather than a moral failing.
- Spotify's "golden path" / paved-road writing and Netflix's "paved road" engineering posts — real-world golden paths and why adoption follows speed, not mandate.
- *An Elegant Puzzle* (Will Larson) — funding engineering investment, surviving reorgs, and the leadership-conversation framing that makes prevention fundable.

---

## Related Topics

- [Paying Down Debt — Professional](../05-paying-down-debt/professional.md) — the cure whose cost is the lever you use to argue for prevention; the two are one budget conversation.
- [What Is Technical Debt — Professional](../01-what-is-technical-debt/professional.md) — principal vs interest and the prudent/reckless distinction this page's "name it before the event" advice depends on.
- [Junior](junior.md) · [Senior](senior.md) · [Interview](interview.md) — the rest of this topic's tier set; senior holds the concrete control mechanisms this page argues you have to *fund and defend*.
- [Quality Gates](../../quality-gates/) — the automated controls that enforce a prevention culture once you've built one (and get suppressed when you haven't).
- [Code Review](../../code-review/) — the highest-frequency cultural ritual you have, and where the local definition of "clean" is transmitted person to person.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the health metrics that make corner-cutting visible and turn the leadership pitch into numbers.
