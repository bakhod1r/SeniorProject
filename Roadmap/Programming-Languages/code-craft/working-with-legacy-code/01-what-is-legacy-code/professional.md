# What Is Legacy Code — Professional Level

## Table of Contents

- [Leading legacy work, not just doing it](#leading-legacy-work-not-just-doing-it)
- [Reframing "legacy" for stakeholders](#reframing-legacy-for-stakeholders)
- [The economic framing that gets buy-in](#the-economic-framing-that-gets-buy-in)
- [A decision framework for legacy investment](#a-decision-framework-for-legacy-investment)
- [War story 1: the discount that couldn't be touched](#war-story-1-the-discount-that-couldnt-be-touched)
- [War story 2: the rewrite that ate a year](#war-story-2-the-rewrite-that-ate-a-year)
- [War story 3: the load-bearing engineer](#war-story-3-the-load-bearing-engineer)
- [Team dynamics and incentives](#team-dynamics-and-incentives)
- [Operating checklists](#operating-checklists)
- [Metrics that actually mean something](#metrics-that-actually-mean-something)
- [Common pitfalls at the leadership level](#common-pitfalls-at-the-leadership-level)
- [Preventing new legacy: the inflow problem](#preventing-new-legacy-the-inflow-problem)
- [Related Topics](#related-topics)

---

## Leading legacy work, not just doing it

By staff and principal level, your relationship to legacy code changes shape. You spend less time personally writing characterization tests and more time on three things: **framing** legacy work so the business funds it, **sequencing** it so it ships value continuously instead of disappearing into a black hole, and **changing the team's habits** so the inflow of new legacy code slows. The technical definition — code without tests — is settled. The hard part is now organizational: legacy code is as much a problem of incentives, communication, and risk management as of engineering technique.

The recurring failure mode of legacy initiatives is not technical incompetence; it's *misframing*. A team asks for "a quarter to pay down tech debt," gets a grudging yes or a no, delivers no visible value for months, and the next request is dead on arrival. The professional skill is to make legacy work *legible to the business* and *incremental in delivery* so it never looks like a value-free detour.

## Reframing "legacy" for stakeholders

A product manager or VP does not care that a module lacks tests. They care about outcomes: shipping speed, incident rate, predictability, ability to enter a new market. Your job is to translate the engineering condition into the business consequence.

| Engineer says | Stakeholder hears (useless) | Translate to (useful) |
| --- | --- | --- |
| "This code has no tests." | "Engineers want to gold-plate." | "Every change here risks an outage; that's why estimates here are 3× and unreliable." |
| "We need to refactor billing." | "Rewrite with no new features." | "We can't safely add the new pricing tier until we make billing changeable; here's the smallest path." |
| "There's a lot of tech debt." | "Vague complaining." | "Three modules cause 60% of our incidents and 40% of our cycle time. Here's the data." |

> **Key idea:** Legacy work gets funded when it is framed as *enabling a business outcome the stakeholder already wants* — not as virtuous cleanup. "We must cover billing to safely ship the new pricing tier" beats "we should pay down debt" every time.

The most durable framing ties the coverage work to a *feature the business is already demanding*. You almost never get a standalone "make it testable" budget; you get the budget by making testability the *first step* of a funded feature, and being honest that the feature in this area legitimately costs more because the area is legacy.

## The economic framing that gets buy-in

Stakeholders respond to numbers and to the *shape* of cost over time. Two framings consistently land.

**Interest-bearing debt.** Frame untested code as a loan accruing interest: every change you make to it costs *extra* (the interest), and the principal grows as the module grows. You can make this concrete with cycle-time data: "Changes in module A take 4 days on average versus 1 day elsewhere; that 3-day premium, times the ~30 changes a quarter we make there, is ~90 engineer-days a quarter of pure interest." Now the cost of *inaction* is visible, which is the number that's usually missing from the conversation.

**Cost of delay vs. cost of coverage.** For a specific change blocked by legacy code:

```
Option A — edit and pray:
   cost: 1 day now
   risk: ~30% chance of incident (no feedback), each incident ~5 days + reputation

Option B — cover then change:
   cost: 3 days now (1 to cover, 1 to change, 1 buffer)
   risk: ~3% chance of incident

Expected cost A = 1 + 0.30 * 5  = 2.5 days   (+ unbounded reputational tail)
Expected cost B = 3 + 0.03 * 5  = 3.15 days
```

The honest version of this analysis is what builds trust: sometimes edit-and-pray *is* the cheaper expected bet for a low-risk, low-churn change — and saying so when it's true earns you the credibility to insist on coverage when the stakes are high. A leader who *always* demands coverage is correctly perceived as ideological; one who demands it *selectively, with reasoning* gets listened to. The full apparatus for this lives in [`../07-the-economics-of-tidying/`](../07-the-economics-of-tidying/).

## A decision framework for legacy investment

A repeatable framework you can apply to any "should we invest in this legacy area?" question, and teach to the team:

```
1. CHURN?     How often is this code changed?            (git log frequency)
2. RISK?      Blast radius + incident history if it breaks?
3. PULL?      Is a funded change about to touch it anyway?
4. EFFORT?    Where on the untestability spectrum does it sit?
5. KEY-PERSON? Does only one person understand it?

Invest now if:  (CHURN high OR PULL yes) AND (RISK high OR KEY-PERSON yes)
Defer if:       low churn AND low risk AND no pull
Strangle/replace if: EFFORT astronomical AND a clean boundary exists
```

The two highest-signal inputs are **churn** (from `git log --format=%h -- path | wc -l` over the last year) and **incident history** (from the postmortem record). Code that is both frequently changed and frequently implicated in incidents is your portfolio's worst asset; it's where the first coverage dollar returns the most. Code that is stable and never breaks is, almost by definition, *not worth testing now* however ugly it looks — a point you'll have to defend against well-meaning engineers who want to clean everything.

## War story 1: the discount that couldn't be touched

A mid-size commerce team had a `PricingEngine` — 1,400 lines, no tests, six years old, touched by a dozen people who'd since scattered. Every quarter, marketing wanted a new promotion type, and every quarter the change took three weeks and caused at least one pricing incident (customers charged wrong, refunds, support load). The team had asked twice for "time to refactor pricing" and been refused — correctly, because the ask was a value-free rewrite.

What worked: the next promotion request was reframed. Instead of "give us a refactor quarter," the lead scoped it as "this promotion, done safely," and made *characterizing the current pricing behavior* the explicit first deliverable. The team:

1. Wrote characterization tests by *recording real production pricing inputs and outputs* (a week of anonymized orders) and pinning them — capturing the lost spec, bugs and all.
2. Found, in the process, *three* long-standing pricing bugs the business didn't know about. One was overcharging a customer segment; fixing it was now a deliberate, tested change with a clear paper trail — and a small refund liability surfaced early instead of in a lawsuit.
3. Extracted the discount *decision* into a pure, fully-tested function, leaving the I/O shell thin.
4. Shipped the new promotion in the now-tested core.

The promotion took the same three weeks the first time — but the *next* promotion took four days, and pricing incidents went to roughly zero. The lesson the org learned was not "testing is good" in the abstract; it was "covering the hot, risky module paid for itself by the second change." That concrete payback is what unlocked budget for the next two legacy areas.

> **Key idea:** You rarely win the argument for legacy investment with principle. You win it by attaching coverage to a funded change, delivering it, and then *showing the second change get dramatically cheaper.* One demonstrated payback funds the next initiative.

## War story 2: the rewrite that ate a year

A different team inherited a legacy order-fulfillment service: ugly, untested, but *working* and handling real money. A newly-hired senior, fresh and confident, made the classic call: "This is unmaintainable. We rewrite it clean in the new framework." Leadership, tired of the old system, agreed.

The rewrite took fourteen months instead of the estimated four. Why: the old system encoded hundreds of edge cases nobody remembered — partial shipments, split payments, a bizarre tax rule for one jurisdiction, retry behavior for a flaky carrier API. None were documented; all were discovered, painfully, when the new system hit production and *failed on real orders the old one had silently handled for years.* Meanwhile the old system still needed maintenance, so the team ran two systems. Feature delivery stopped for over a year. Two engineers burned out and left, taking yet more knowledge.

What should have happened: characterize the old system's behavior first (its outputs *are* the spec), then strangle it incrementally — route one order type at a time to the new implementation, diffing old-vs-new outputs on real traffic before each cutover. Slower to feel heroic, but it ships continuously and never loses the encoded behavior. The characterization suite would have *been* the acceptance criteria for the rewrite.

The leadership lesson: when an engineer proposes a full rewrite of a working legacy system, the staff-level response is *"show me the characterization tests first."* If the behavior can't be pinned, the rewrite can't be safe — and that's an argument for incremental modernization, not against caution.

## War story 3: the load-bearing engineer

A payments team had one engineer, call him Marek, who was the only person who understood the settlement reconciliation job — an untested, gnarly batch process that moved real money nightly. Everyone knew it was a risk; nobody acted, because it never broke (Marek quietly kept it running) and there was always something more urgent.

Marek gave notice. Suddenly the abstract "key-person risk" became a four-week countdown to losing the only person who understood a revenue-critical, untested system. The team scrambled: pair Marek with two engineers, and *characterize the reconciliation behavior while he was still there to confirm the pinned outputs were correct.* They captured the contract into executable tests in his final weeks. It was stressful and partial, but when he left, the system's behavior lived in the test suite instead of only in his head.

The staff-level takeaway: **key-person risk on untested code is a live incident waiting for a trigger (resignation, illness, vacation during an outage).** Don't wait for the resignation. Maintain a risk register of "untested + single-owner + high-stakes" modules, and spend the characterization effort *while the expert is present*, because their presence is what makes the pinned behavior trustworthy. The expert plus the code is the only complete copy of the spec; lose either and you're reverse-engineering money movement under pressure.

## Team dynamics and incentives

Legacy code is sustained by incentive structures, and changing the code durably means changing those incentives. The patterns to watch:

- **The hero who hoards.** An engineer whose status comes from being the only one who can touch the scary module is *disincentivized* to make it testable and shareable. Counter it by valuing — in promotions and reviews — *spreading* the ability to change a system (via tests and docs) over being its sole priest.
- **The deadline ratchet.** Every "just ship it, skip the tests" decision adds to legacy inflow. If the org only ever rewards shipping and never the safety that enables future shipping, the codebase is *guaranteed* to trend legacy (Lehman). Leadership has to make "definition of done includes tests" a real, defended standard, not a wish.
- **The bystander effect on shared code.** Code owned by everyone is owned by no one; nobody invests in covering it. Assign ownership explicitly. Coverage follows ownership.
- **Blame culture amplifies fear.** If breaking production gets you punished, engineers respond rationally: touch as little as possible, copy-paste around risk, never refactor. Blameless postmortems and good test safety nets are what make engineers brave enough to *improve* code instead of fearfully preserving it.

> **Key idea:** Legacy code is downstream of incentives. If the org rewards only shipping features and punishes the breakage that untested code makes inevitable, you will manufacture legacy faster than any cleanup can remove it. Fix the incentive and the inflow slows.

## Operating checklists

**Before touching a legacy module (per-change):**

- [ ] Identify the *change point* and the *narrowest slice* I must cover.
- [ ] Are there existing tests? Are they fast and reliable, or red noise?
- [ ] Write characterization tests pinning current behavior at the change point; watch them pass.
- [ ] Make behavior-changing edits only via a deliberate failing-then-passing test, in a separate commit from safety work.
- [ ] Flag any pinned behavior I suspect is a bug for follow-up.
- [ ] Leave the area marginally better, within the change's budget (no heroics).

**When proposing a legacy investment (to stakeholders):**

- [ ] Tie it to a business outcome they already want.
- [ ] Bring churn and incident data; quantify the *interest* being paid now.
- [ ] Scope coverage as the *first step* of a funded change, not a standalone project.
- [ ] State the expected payback and when the *second* change should get cheaper.
- [ ] Be honest where edit-and-pray is the cheaper bet; spend credibility selectively.

**When someone proposes a full rewrite:**

- [ ] "Show me the characterization tests for the current behavior."
- [ ] Is there a clean boundary to strangle along incrementally?
- [ ] Can we parallel-run and diff old vs. new on real traffic before cutover?
- [ ] What encoded edge cases will we lose, and how will we recover them?
- [ ] Can we ship value continuously during the migration, or does delivery freeze?

## Metrics that actually mean something

Coverage percentage is the metric leaders reach for and the one that misleads most. A senior leader watches second-order signals instead:

| Metric | What it really tells you | Watch for |
| --- | --- | --- |
| Cycle time *by module* | Where change is expensive (legacy hotspots) | Modules 3–5× slower than the median |
| Change-failure rate by module | Where the missing feedback is biting | Repeat incident sources |
| Coverage *trend on changed files* | Are we covering as we go? | Should ratchet *up* on every PR that touches legacy |
| Churn × complexity hotspot map | The portfolio's worst assets | High-churn, high-complexity, low-coverage cells |
| Bus factor per critical module | Key-person risk | Single-owner, untested, high-stakes |

The most actionable single practice: enforce that **coverage on changed lines may not decrease** (a "ratchet"). You don't demand 80% globally — that invites gaming and gold-plating. You demand that *every change leaves its slice better tested than it found it.* Over time the hot code — the only code that matters — converges to well-covered, because hot code is changed often, and every change ratchets it. This aligns the metric with the triage strategy from the middle and senior material.

## Common pitfalls at the leadership level

- **The tech-debt sprint that ships nothing.** A quarter of cleanup with no feature output. Burns trust and usually arrives to a worse codebase than if you'd covered incrementally. Prefer continuous, change-attached coverage.
- **Mandating global coverage targets.** "80% coverage by Q3" produces tests that assert nothing on code that doesn't matter, while the scary stuff stays uncovered because it's *hard*. Ratchet on changed code instead.
- **Confusing pretty with safe.** Approving a refactor of clean-but-stable code while the untested money-mover sits untouched. Spend effort where churn × risk is highest.
- **Endorsing the rewrite.** Covered above; the single most expensive endorsement a leader gives. Characterize first.
- **Letting fear go unnamed.** Padded estimates and avoided modules are *data*. If you don't surface "we're afraid of this code" as a real risk, you can't fund fixing it.
- **Punishing the breakage that legacy makes inevitable.** Drives engineers to fearful preservation. Pair safety nets with blameless culture so people are brave enough to improve.

## Preventing new legacy: the inflow problem

All of the above manages the *stock* of legacy code. The leverage move at scale is reducing the *inflow* — because no cleanup effort wins against a team that mints new untested code faster than it covers old. The definition makes the prevention obvious: **untested new code is born legacy**, so prevention is just *not shipping untested code in the first place.*

The mechanisms are cultural and live in [`../../craftsmanship-disciplines/`](../../craftsmanship-disciplines/): a definition of done that includes tests; TDD so code is born covered; CI that runs the suite on every push; code review that treats "where are the tests?" as a normal, non-negotiable question. A leader's job is to make these the *path of least resistance*, not a heroic individual virtue — because if doing the right thing requires heroism, it won't happen under deadline pressure, and the inflow continues.

> **Key idea:** Managing legacy code is a flow problem, not just a stock problem. The highest-leverage staff move is reducing the rate at which new untested code enters the system — turning "tests" from an act of individual heroism into the default, frictionless path.

The endgame is a team where legacy code is a *managed, shrinking liability* rather than a *growing, feared inevitability*: new code is born tested, hot legacy code is covered as it's touched, key-person risk is tracked and retired, and the business funds the work because it's framed in outcomes it wants. That's not a state you reach once — per Lehman, entropy is always pulling the other way — but it's a steady-state a strong staff engineer can hold.

## Related Topics

- [`../02-the-legacy-change-algorithm/`](../02-the-legacy-change-algorithm/) — the per-change discipline your checklists operationalize.
- [`../03-seams-and-enabling-points/`](../03-seams-and-enabling-points/) — the technique that makes "cover before you change" affordable.
- [`../04-characterization-tests/`](../04-characterization-tests/) — recording production behavior as the lost spec; the backbone of the pricing and rewrite war stories.
- [`../05-dependency-breaking-techniques/`](../05-dependency-breaking-techniques/) — severing the couplings that block coverage.
- [`../06-tidy-first-when-and-how/`](../06-tidy-first-when-and-how/) — sequencing small improvements without ballooning a change's budget.
- [`../07-the-economics-of-tidying/`](../07-the-economics-of-tidying/) — the cost-of-delay and interest framing behind the stakeholder conversation.
- [`../../refactoring/`](../../refactoring/) — the transformation toolkit applied once code is covered; large-scale migration mechanics.
- [`../../craftsmanship-disciplines/`](../../craftsmanship-disciplines/) — the practices (TDD, CI, definition of done) that slow legacy inflow.
