# Metrics Anti-Patterns & Goodhart — Professional Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Metrics Anti-Patterns & Goodhart
> *The senior page taught you why measuring individuals corrupts behaviour and how Goodhart's law turns a target into a lie. This page is about defending a whole org's metrics culture against that dysfunction — surviving the executive who wants a single "engineering productivity" number, detecting gaming while it's happening, and walking a broken metrics regime back without a blowup.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Executive Pressure Pattern — The Single Number, The Leaderboard, The Perf Review](#the-executive-pressure-pattern--the-single-number-the-leaderboard-the-perf-review)
4. [What to Offer Instead](#what-to-offer-instead)
5. [Building a Healthy Metrics Culture](#building-a-healthy-metrics-culture)
6. [Detecting Dysfunction in Flight](#detecting-dysfunction-in-flight)
7. [The McNamara Trap at Org Scale](#the-mcnamara-trap-at-org-scale)
8. [Recovering From a Broken Metrics Regime](#recovering-from-a-broken-metrics-regime)
9. [When Metrics Genuinely Help](#when-metrics-genuinely-help)
10. [The Goodhart Thread Across Coverage, Code Quality, and Docs](#the-goodhart-thread-across-coverage-code-quality-and-docs)
11. [War Stories](#war-stories)
12. [Decision Frameworks](#decision-frameworks)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Defending an organization's metrics culture against dysfunction, and the executive conversation that decides whether it lives or dies.**

The senior page framed the anti-patterns as things *you* avoid: don't measure individuals, don't tie a number to comp, don't trust a metric you've turned into a target. At the professional level you rarely get to *avoid* them quietly — you get *asked for them*, by name, by someone two levels up, in a meeting where "I just want one number that tells me how productive engineering is" sounds eminently reasonable and saying no sounds like obstruction.

This is the hardest part of the topic and the least technical. The Goodhart's-law mechanism is the easy half; you understood it at the senior tier. The professional half is **organizational**: how a senior leader absorbs executive pressure without either capitulating (and shipping a regime that teaches the whole org to game) or stonewalling (and getting overruled by someone who then picks a *worse* metric without you). It's how you build a culture where a team can post a *bad* DORA number in a retro without anyone updating their résumé. It's how you spot, in real time, that a metric is climbing while the thing it was supposed to represent is rotting. And it's how you walk back an individual-ranking dashboard that's already in place — the most politically dangerous move in this entire roadmap — without it reading as "the metrics guy admits metrics don't work."

None of this is new *theory*. It's the senior tier's principles, now load-bearing under real organizational weight. This is the battle-tested layer: the conversations, the recoveries, the judgment calls.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — Goodhart's and Campbell's laws, surrogation, the McNamara fallacy, why individual metrics fail, vanity vs actionable metrics.
- **Required:** [interview.md](interview.md) is the consolidation; this page assumes you can already *explain* why a velocity leaderboard is harmful — here you have to *prevent* one.
- **Required:** You've sat in a leadership conversation where someone asked for a metric you knew was a bad idea.
- **Helpful:** You've owned a team's DORA or flow numbers and used them (or failed to use them) in a retro.
- **Helpful:** You've watched a well-intentioned metric get gamed, and had to clean it up.

---

## The Executive Pressure Pattern — The Single Number, The Leaderboard, The Perf Review

There is one request that recurs across nearly every engineering organization, and it is simultaneously **the most common and the most damaging** ask a leader will field. It arrives in three shapes, usually from finance-adjacent or board-facing leadership:

1. **"Give me a single engineering-productivity number."** A composite score, ideally trendable quarter over quarter, ideally comparable to "what we spend." The intent is benign — leadership genuinely needs *some* legible signal of whether the money is buying delivery. The effect is catastrophic, because the moment one number represents "productivity," it becomes the number everyone optimizes, and a composite is the easiest thing on earth to inflate without doing any more useful work.

2. **"Show me a team leaderboard."** Rank the teams by velocity, by deploys, by story points, by lines. The intent is "I want to find and help the struggling teams." The effect is that teams stop comparing themselves to *their own past* (the only valid comparison) and start gaming their *rank*, and the struggling team — often struggling because it owns the gnarliest legacy system — gets punished for the hardest job.

3. **"Put these metrics in performance reviews."** Tie deploys-per-engineer, or PR count, or velocity, to ratings and comp. This is **Campbell's law weaponized**: the instant a number affects someone's salary, it stops measuring reality and starts measuring how badly they need the raise. It is the single fastest way to destroy the *honesty* of your entire metrics system, because now every number is a negotiation.

The naïve senior responses both fail. **Capitulating** ("sure, I'll build the score") ships a system that actively trains the org to game you, and you own the wreckage. **Stonewalling** ("metrics don't work, won't do it") gets you labeled the blocker and — this is the part juniors miss — *gets you overruled*. The exec doesn't drop the need; they hand it to someone more compliant who builds a *worse* version without your guardrails. Either way the bad metric ships. **Your job is not to win a debate about whether to measure; it's to redirect the legitimate need behind the request onto something that survives contact with Goodhart's law.**

The reframe that works starts by *agreeing with the need and separating it from the mechanism*:

> "You're right that we need a legible signal on delivery — I want that too, it's how we make the case for engineering investment. The trap is that *any single productivity number, and especially anything ranked or tied to reviews, stops measuring delivery the moment people optimize it* — that's not an opinion, it's the consistent finding (Goodhart, and the DORA research specifically warns against it). So let me give you something that answers your actual question and *doesn't* rot: here's what I propose instead."

You've now moved the conversation from *whether* to *what*. That is the whole game.

---

## What to Offer Instead

Never leave the "no" hanging. The leader has a real need; meet it with three things, in this order:

**1. Outcome metrics, not output metrics.** Leadership cares — correctly — about *outcomes*: did we ship the things that moved the business, is delivery getting faster and safer, are customers affected by failures less often. Offer the metrics that track outcomes the team *cannot* trivially game in isolation: business/product results (revenue, activation, retention tied to shipped work), and the *stability* keys (change failure rate, time to restore) which resist gaming because making them up means actually breaking production. Output counts — commits, PRs, story points, lines, deploys-per-person — measure *motion*, and motion is what gets gamed. Steer every "how productive" question toward "what outcomes did we move, and is our delivery system getting healthier."

**2. Team-level DORA/SPACE, framed as improvement, never ranking.** The DORA four keys and SPACE are the *right* answer to "how is engineering doing" — but only at **team or org aggregate, for trend-over-self, used to drive improvement**. Offer leadership the org-level DORA trend ("our lead time dropped from 9 days to 4 over two quarters; here's what we changed") and *explicitly decline the per-team leaderboard* with a concrete reason: "the team on the legacy billing system will always look worst on raw throughput because they own the hardest code — ranking them punishes them for taking the hard job, and teaches everyone to avoid hard jobs." DORA's own guidance is emphatic: these are **team** metrics for **improvement**, and using them to compare teams or evaluate individuals is a documented misuse. (See [01 — DORA Four Keys](../01-dora-four-key-metrics/professional.md) and [03 — SPACE](../03-space-framework/professional.md) for the why.)

**3. A qualitative narrative alongside the numbers.** The most senior move is to refuse to let numbers travel naked. Pair every metric you send upward with a *narrative*: "Lead time rose this quarter — that's expected, we paid down the deploy-pipeline debt that was causing the change-failure spikes, and CFR is already down 40%." This does two things: it gives leadership the legible signal they wanted *with the context that prevents misinterpretation*, and it models the culture you want — metrics as the *opening* of a conversation, not a verdict that closes one. A number with a story is informative; a number alone is an invitation to draw the wrong conclusion and act on it.

> **The professional reality:** the executive almost never actually wants "a number." They want *confidence that engineering is working and is a good investment.* A trended org-level DORA picture plus an honest narrative gives them that better than any composite score — and it doesn't detonate when teams start optimizing it. Sell the *outcome of trust*, not the artifact of a dashboard.

---

## Building a Healthy Metrics Culture

A metrics regime is downstream of a culture, not the other way around. The same DORA dashboard is a learning tool in one org and a weapon in another; the dashboard didn't change, the culture did. Four properties separate the healthy version:

**Metrics are owned by the teams they measure.** The team pulls its own numbers, looks at them in its *own* retro, and decides what to do. The instant metrics are *imposed and surveilled from above*, they flip from "our instrument for improving our system" to "the thing management uses to judge us" — and judged people optimize the judgment, not the work. Ownership is the difference between a thermometer the team uses and a camera management points at them.

**Metrics are framed as "improve our system," never "rate our people."** Every metric should answer "where is *our process* slow or fragile, and what experiment do we run next?" Lead time isn't "are people working hard enough," it's "where does work *wait*, and can we shorten the wait." This framing is load-bearing: it points attention at the *system* (queues, handoffs, flaky CI, review latency) — which is where 90% of delivery problems actually live — instead of at *people*, which is both where they mostly *don't* live and where blame destroys honesty.

**Psychological safety so people don't hide bad numbers.** This is the keystone, and it's fragile. A metrics culture only works if a team can surface a *bad* number — a CFR spike, a lead-time regression, a low deploy frequency — *without fear*, because that's precisely when the number is most useful. The fastest way to blind yourself is to punish bad numbers: people don't *fix* the underlying problem, they *hide* the number (reclassify the incident, split the failed deploy, stop recording the rollback). You cannot improve what people are hiding from you. Every time leadership reacts to a bad metric with blame instead of curiosity, they're buying a quarter of clean-looking dashboards and zero real information.

**Transparency, and a hard line against comp/ranking.** The numbers are visible to everyone (transparency builds trust and lets teams learn from each other), *and* they are categorically never tied to compensation, stack-ranking, or individual evaluation. These two go together: you can only afford radical transparency *because* the numbers carry no individual stakes. The moment a visible number can affect someone's rating, transparency becomes a threat and the gaming begins. Keep the wall between "metrics we look at to improve" and "how we evaluate and pay people" absolute and *stated out loud*, repeatedly, because people will assume the worst unless you keep telling them otherwise.

> **The principle:** a healthy metrics culture is one where the worst thing that happens when a number looks bad is *a useful conversation*. The moment the worst thing that can happen is *a worse review or a public ranking*, every number becomes a performance, and your dashboard becomes an elaborate theater that tells you nothing true.

---

## Detecting Dysfunction in Flight

Gaming and surrogation rarely announce themselves. They show up as numbers that *look like success*. The professional skill is reading the signatures of a metric going bad **while it's happening**, not in the postmortem. The tells:

**Numbers improving while reality worsens.** This is the canonical surrogation signature: the *metric* climbs but the *thing it was a proxy for* gets worse. Coverage hits 90% while bugs rise (tests assert nothing). Velocity climbs while customers complain more (points inflated, quality dropped). Deploy frequency soars while incidents spike (changes shipped without care). **Whenever a metric and its underlying goal move in opposite directions, the metric is being optimized as a target — that is Goodhart's law caught in the act.** Always pair any optimization metric with a *guardrail* metric it shouldn't be allowed to harm (throughput paired with CFR; coverage paired with escaped-defect rate), and watch the *pair*, never the single number.

**Sudden jumps right after a target is set.** A metric that was flat for months and then steps sharply *the quarter you announced a target for it* is almost never a real process improvement — process improvements are gradual. A step change is the signature of *gaming*: people found the cheap way to move the number. Lead time that halves the month after you set a lead-time goal usually means tickets are being split, started later, or closed earlier — not that work got faster. Treat any sharp move that coincides with a new target as guilty until proven innocent, and go look at the *distribution*, not the mean (gaming usually distorts the shape).

**Teams optimizing the dashboard instead of the system.** The cultural tell, visible in standups and PRs: conversation drifts from "is this the right thing to build / is our process healthy" to "what does this do to our number." PRs split to pad count. Tickets reclassified to flatter cycle time. Incidents quietly downgraded so they don't count against CFR. When you hear "we should close this ticket before month-end so it lands in this period's flow time," the team is now serving the dashboard, and the dashboard has stopped serving the team. The metric has become the work.

The diagnostic discipline: **suspicion proportional to stakes.** The higher the consequences attached to a number, the harder you scrutinize *how* it moved. A number that improved because the team is genuinely faster has a *mechanism* you can name ("we cut the review queue by adding reviewers"). A number that improved through gaming has *no such mechanism* — or one that, examined, is just relabeling. Always ask "*what specifically changed in the system* to move this?" If there's no satisfying answer, you're looking at surrogation, not progress.

> **The professional reality:** the most dangerous metric in your org is the one that looks *great* and is attached to *high stakes*. A bad-looking number invites scrutiny and gets fixed. A great-looking number that's secretly gamed gets *celebrated*, *propagated*, and *built upon* — until the gap between the dashboard and reality becomes the incident. Audit your wins, not just your losses.

---

## The McNamara Trap at Org Scale

Robert McNamara ran the Vietnam War on body counts because they were measurable, and discounted everything that wasn't — morale, legitimacy, the will to fight — until the measurable numbers looked like winning while the war was lost. The **McNamara fallacy** — *what can't be measured gets treated as unimportant or non-existent* — is the most insidious metrics failure at org scale, precisely because it produces no error message. Nothing on the dashboard ever lights up red. The dashboard is, by construction, *only the measurable things*, and it slowly redirects all attention and reward toward them.

The things that quietly fall off the engineering dashboard because they're hard to quantify are, not coincidentally, the things that matter most over a multi-year horizon:

- **Morale and burnout.** A team can post elite DORA numbers for two quarters by *sprinting unsustainably*, and the dashboard shows triumph right up until the senior engineers quit. Velocity captures none of the cost.
- **Learning and capability growth.** Time spent mentoring, learning a new domain, or building shared understanding shows up on output metrics as *negative* (fewer commits this week) while being one of the highest-leverage long-term investments. Optimize the dashboard and you optimize *away* the learning.
- **Long-term architectural health.** The team taking on debt to hit this quarter's numbers looks *better* on every short-term metric than the team paying debt down. Architectural rot is invisible to throughput metrics until it manifests as a CFR cliff or a delivery slowdown two years out — by which point it's enormously expensive.
- **Collaboration and the health of the system *between* teams.** Cross-team enablement, unblocking others, platform work — value that's diffuse and shared — is systematically undercounted by any per-team or per-person metric, so a metrics regime quietly *taxes* exactly the collaborative behavior healthy orgs most need.

The defense is not "measure those too" — most of them resist honest measurement, and a fake number is worse than none. The defense is **structural humility about the dashboard's blind spots**: explicitly name, in every metrics review, that the dashboard is a *partial* view and that morale, learning, and architectural health are deliberately *not* on it and must be carried in the *narrative* and in qualitative signal (SPACE's satisfaction dimension, retros, skip-levels, attrition, the DevEx survey). The single most important sentence a senior leader says in a metrics meeting is: *"these numbers don't capture X, Y, and Z — what's our read on those?"* That sentence is the entire countermeasure to the McNamara trap.

> **The principle:** the dashboard is a flashlight in a dark room, not a map of the room. Everything the beam doesn't hit still exists — and the most important things in engineering (sustainable people, growing capability, sound architecture) are usually *just outside the beam*. A leader who forgets this optimizes the lit corner while the room burns.

---

## Recovering From a Broken Metrics Regime

You will frequently inherit a regime that's already broken — an individual-productivity dashboard, a velocity stack-rank, story points in the perf cycle. Walking it back is **the most politically dangerous move in this roadmap**, because it can read three bad ways: as "the metrics person admits metrics don't work" (undermines the whole discipline), as "we're hiding from accountability" (alarms leadership), or as "we're lowering the bar" (alarms everyone). Done carelessly it triggers exactly the blowup that keeps bad regimes in place for years. The professional approach is a *managed transition*, not a repudiation:

**1. Lead with the dysfunction it's *already* causing, in the org's own terms.** Don't argue theory; show the gaming. "Our PR counts are up 30% and our defect rate is up with them — we're rewarding splitting work, not delivering it." "The billing team ranks last every quarter and we've lost two engineers off it — we're punishing people for owning our hardest system." Make the *current* regime's cost concrete and *self-evident to leadership* before you propose changing it. You're not attacking metrics; you're fixing a metric that's *backfiring on the org's own goals*.

**2. Replace, don't remove.** A vacuum reads as retreat and gets filled with something worse. Never propose "stop measuring"; propose "*measure this instead*." Swap the individual leaderboard for team-level DORA-trend-over-self; swap velocity-in-reviews for outcome-and-impact conversations. Leadership keeps a legible signal — which is what they actually needed — so the change reads as an *upgrade*, not a *capitulation*. This single framing ("here's a *better* signal") defuses most of the political risk.

**3. Separate the wall publicly and explicitly.** State, out loud and repeatedly, the new contract: *these numbers are for the team to improve its system; they are not, and will never be, an input to ratings, ranking, or pay.* People have to *hear* the wall go up, more than once, before they'll believe it enough to stop gaming — they've been burned, and they'll assume the old rules until convinced otherwise. The behavior change *lags* the policy change by months; budget for that and keep restating the contract.

**4. Expect — and tolerate — the honesty dip.** When you remove the stakes, previously-hidden bad numbers *surface*: CFR ticks up because incidents aren't being downgraded anymore; "velocity" drops because points aren't inflated. **This looks like regression and is actually the system finally telling the truth.** If leadership panics at the worse-looking numbers and reaches for blame, you're back to square one — so you have to *pre-frame this with leadership before it happens*: "as we take the stakes off, some numbers will look worse for a quarter — that's the gaming washing out, not performance dropping; it means we're finally seeing reality." Naming the dip in advance is what stops it from being read as failure.

> **The professional reality:** you don't walk back a broken regime by *winning an argument about metrics*. You walk it back by making the *current* regime's self-inflicted damage undeniable, offering a *better* signal that preserves leadership's legitimate need, and *pre-negotiating the honesty dip* so the truth surfacing doesn't get mistaken for performance collapsing. It's change management, not a debate.

---

## When Metrics Genuinely Help

The cautionary weight of this topic can read as "metrics are a trap, avoid them" — which is the wrong lesson and, ironically, abandons the field to the people who'll misuse them. Metrics, used right, are one of the highest-leverage tools a team has. The pattern that *consistently* works has a precise shape, and it's the inverse of every anti-pattern above:

**A team, for itself, picks a metric to fix a problem it actually has.** Every ingredient matters. *The team*, not management — ownership keeps it an instrument, not a verdict. *For itself* — used in their own retro, no external stakes, so there's nothing to game. *Picks* — the team chose it because it matches *their* bottleneck, so it's actionable and they're invested in it. *A problem it actually has* — it's tied to felt pain, not a number someone wanted to see go up. And critically, it's **temporary and instrumental**: the metric is a tool to fix a specific problem, and when the problem's fixed, the team *retires the metric* rather than enshrining it. A metric kept past its purpose inevitably drifts toward becoming a target.

Concretely: a team whose code review was the bottleneck (work piling up in "review," lead time dominated by review wait) starts tracking *review pickup time* — *its own*, in *its own* retro, *because review is its felt pain*. The number makes the queue visible, the team experiments (reviewer rotation, smaller PRs, a review SLA *they* set), pickup time drops, lead time drops, and once review is no longer the bottleneck they *stop fixating on that number* and watch the next constraint. No leaderboard, no review-cycle stakes, no comparison to other teams — just a team using a number as a flashlight on *its own* process and putting the flashlight down when the room's lit.

That shape — *team-owned, self-chosen, problem-tied, retro-used, stakes-free, and retired when done* — is when metrics are unambiguously good. It's also the exact opposite of the executive's instinct (one number, imposed, ranked, permanent, tied to stakes), which is *why* the same tool helps in one hand and harms in the other.

> **The principle:** the *same metric* (say, lead time) is a learning tool when a team picks it to fix its own bottleneck and a weapon when management imposes it to rank teams. The number is identical; the *ownership, framing, stakes, and intent* are everything. Metrics aren't good or bad — *the system around them* is.

---

## The Goodhart Thread Across Coverage, Code Quality, and Docs

The same failure runs through every quality-metrics topic in this part of the roadmap, and recognizing it as *one pattern* is a senior synthesis worth stating plainly: **a quality proxy, once targeted, gets satisfied without delivering the quality it proxied for.** Goodhart's law isn't a DORA-specific footnote; it's the master pattern of the entire measurement discipline.

- **Code coverage** is a proxy for "the code is tested." Target it, and you get 90% coverage with tests that execute every line and assert nothing — coverage achieved, *testing* not. (See [Code Coverage](../../code-coverage/): coverage is a *floor that catches the untested*, never a *goal*, for exactly this reason.)
- **Code-quality metrics** (cyclomatic complexity, duplication, a "maintainability index") are proxies for "the code is maintainable." Target them, and you get methods split to dodge a complexity threshold while becoming *harder* to follow, or duplication hidden behind a premature abstraction — the metric satisfied, maintainability *worse*. (See [Code Quality Metrics](../../code-quality-metrics/).)
- **Documentation metrics** (doc coverage, page counts, "% of functions with a docstring") are proxies for "the system is understandable." Target them, and you get a docstring on every getter that says `// gets the value` — doc-coverage at 100%, *understanding* unchanged. (See [Documentation](../../../code-craft/documentation/).)
- **DORA / flow metrics** are proxies for "delivery is fast and safe." Target them as individual or ranked goals, and you get split PRs, reclassified incidents, and inflated points — the dashboard green, *delivery* no better.

The unifying lesson — and the thing that ties this whole roadmap together — is that **every one of these is a proxy, and the defense is always the same three moves**: (1) keep the proxy a *diagnostic*, not a *target* (look at *why* coverage is low here, don't mandate a number); (2) pair it with a *guardrail* that catches the obvious gaming (coverage with escaped-defects, throughput with CFR); and (3) keep it *team-owned and stakes-free* so there's no incentive to satisfy the letter while betraying the spirit. Learn the pattern once and you can defend *any* metric, in any domain, because they all fail the same way for the same reason.

---

## War Stories

**The stack-ranking-by-velocity disaster.** A VP, wanting to "find the underperforming teams," introduced a quarterly leaderboard ranking all teams by story-point velocity, with the bottom teams getting "performance attention." Within two quarters every team's velocity had risen 40% and *nothing shipped faster* — points had simply inflated, because each team now estimated generously to protect its rank. Worse, the platform and legacy-billing teams — doing the hardest, least point-countable work — sat permanently at the bottom and bled their best engineers, who left for teams where the work "counted." The leaderboard had selected *against* the hardest and most important work. Unwinding it took a year: replacing the rank with team-level DORA-trend-over-self, publicly killing the "performance attention," and absorbing a quarter of *lower* (honest) velocity numbers that the VP had to be talked out of panicking over. The lesson: ranking teams by an output metric doesn't find the weak teams, it teaches every team to game the metric and punishes whoever owns the hard problems.

**The exec "productivity score" that drove gaming.** Leadership commissioned a composite "engineering productivity score" — a weighted blend of commits, PRs, deploys, and points per engineer — to report to the board. Engineers, being engineers, reverse-engineered the weights within a month. Commits spiked (work split into micro-commits), PRs multiplied (one change became five), and the score climbed beautifully quarter over quarter while *actual* delivery, by every customer-facing measure, was flat. The board got a rising line that meant nothing; the engineering org had spent real energy learning to inflate it. The recovery was to retire the composite entirely and replace it with an org-level DORA trend plus a written narrative — which the board, it turned out, found *more* credible than the suspiciously-perfect score. The lesson: a composite productivity number is the easiest thing in the org to game and the least informative thing to report; the legible signal leadership wanted was better served by trend-plus-narrative.

**The team that improved by owning one self-chosen metric.** A team drowning in a slow delivery pipeline noticed in its own retro that work sat in "code review" for days — review pickup was its bottleneck. *On its own initiative*, with no mandate and no stakes, it started watching review pickup time in retros. It tried a reviewer rotation, then smaller PRs, then a self-imposed "review within 4 business hours" norm. Pickup time fell from ~2 days to a few hours, lead time dropped with it, and — the tell of a *healthy* use — once review stopped being the constraint, the team *stopped foregrounding that number* and turned to the next bottleneck (CI flakiness). No leaderboard, no comparison, no perf-review tie. The lesson: the metric that genuinely improved delivery was *team-owned, self-chosen, tied to felt pain, used in a retro, free of stakes, and retired when its job was done* — the exact opposite of the executive instinct, and exactly why it worked.

---

## Decision Frameworks

**Should we measure this, and how — safely? Ask, in order:**

1. **Who's asking, and what do they actually need?** If it's leadership asking "how productive is engineering," the *need* is confidence/legibility, not literally a number. Meet the need (trend + narrative), not the literal request (a composite score).
2. **Will this measure a *system* or *people*?** People → almost always stop; individual metrics corrupt behavior and honesty. System/team-aggregate → can be safe.
3. **What's the unit and the comparison?** Team-or-org aggregate, compared *to its own past*, → safe. Per-individual, or *ranked* against peers, → unsafe; it will be gamed and will punish the hardest jobs.
4. **What stakes attach to it?** None (retro, improvement) → safe. Comp, ratings, ranking → unsafe; stakes destroy the honesty of the number (Campbell's law).
5. **What's the guardrail?** Any optimization metric needs a paired metric it's not allowed to harm (throughput↔CFR, coverage↔escaped-defects). No guardrail → don't ship it as a target.
6. **Who owns it?** The team that's measured → safe (instrument). Imposed and surveilled from above → unsafe (verdict).
7. **Is it diagnostic or target?** "Look at *why* this is low" → safe. "Make this number hit X" → Goodhart-bait; resist.
8. **Can we retire it?** A metric tied to a *specific problem* that gets retired when fixed → healthy. A *permanent* metric drifts toward becoming a target.

**Default verdict:** measure **systems**, at **team/org aggregate**, **trend-over-self**, with a **guardrail**, **team-owned**, **stakes-free**, as a **diagnostic**, **retired when done**. Any deviation from that profile is where dysfunction enters — and the more boxes a request *fails*, the harder you redirect it.

---

## Mental Models

- **You don't get to avoid the bad metric — you get *asked* for it.** The professional skill isn't knowing velocity-ranking is bad; it's redirecting the legitimate need behind the ask onto something that survives Goodhart. Stonewalling just gets you overruled by someone who builds it worse.

- **The need behind "give me a number" is *trust*, not a number.** Leadership wants confidence engineering is working. Trend-plus-narrative delivers that better than any composite — and doesn't detonate when teams optimize it.

- **Psychological safety is the keystone of any metrics system.** A culture only works if a team can post a *bad* number without fear, because that's when the number is most useful. Punish bad numbers and people hide them — and you can't improve what's hidden.

- **A metric and its goal moving in opposite directions is Goodhart, caught live.** Coverage up while bugs up; velocity up while customers complain. Always watch the *pair* (metric + guardrail), never the lone number.

- **The dashboard is a flashlight, not a map.** Morale, learning, and architectural health are usually *just outside the beam* — and they're what matter most long-term. The countermeasure is one sentence: "the numbers don't capture X — what's our read on it?"

- **The same metric is a tool or a weapon depending on ownership and stakes.** Lead time is a learning instrument when a team picks it to fix its own bottleneck, a weapon when management imposes it to rank. Identical number; opposite effect.

- **Every quality proxy fails the same way: targeted, it's satisfied without the quality.** Coverage, complexity, doc-count, DORA — one pattern. Learn it once, defend any metric.

---

## Common Mistakes

1. **Capitulating to the single-number / leaderboard / perf-review ask.** Building it ships a system that trains the org to game you, and you own the wreckage. Redirect the *need* onto outcome metrics + team-level trend + narrative instead.

2. **Stonewalling instead of redirecting.** "Metrics don't work" gets you labeled the blocker *and overruled* — the exec hands it to someone who builds a worse version without your guardrails. Agree with the need, change the mechanism.

3. **Tying any metric to comp, ratings, or ranking.** Campbell's law weaponized: the instant a number affects pay, it measures negotiation, not reality. Keep an absolute, *stated-out-loud* wall between improvement-metrics and evaluation.

4. **Punishing bad numbers.** You buy clean-looking dashboards and zero real information — people hide the number instead of fixing the problem. React to a bad number with *curiosity*, not blame, or you blind yourself.

5. **Watching single metrics instead of metric+guardrail pairs.** A lone number going up tells you nothing about gaming. Pair every optimization metric with a guardrail it can't harm, and watch the pair.

6. **Trusting great-looking, high-stakes numbers.** The most dangerous metric is the one that looks *great* and carries *high stakes* — it gets celebrated and built upon while secretly gamed. Audit your wins, not just your losses; ask "*what specifically changed* to move this?"

7. **Forgetting the McNamara blind spots.** Optimizing only the measurable (throughput, deploys) silently taxes the unmeasurable (morale, learning, architecture) — and those are what matter at multi-year scale. Name the blind spots in every review.

8. **Removing a broken metric instead of replacing it.** A vacuum reads as retreat and gets filled with something worse. Always swap in a *better* signal so the change reads as an upgrade, and pre-frame the honesty dip so surfacing truth isn't mistaken for regression.

---

## Test Yourself

1. An exec asks you for "a single engineering-productivity number to report to the board." Walk through how a senior leader responds — what's the trap, why does both capitulating *and* stonewalling fail, and what do you offer instead?
2. Name the four properties of a healthy metrics culture, and explain why psychological safety is the keystone.
3. You see a team's coverage climb to 90% while its escaped-defect rate rises. Name the phenomenon, explain the mechanism, and state the general defense that would have caught it.
4. What is the McNamara trap at org scale, what three things does it typically push off the engineering dashboard, and what's the one-sentence countermeasure?
5. You've inherited a velocity-based team leaderboard tied to "performance attention." Lay out the four-step recovery, and explain why "just stop measuring" is the wrong first move.
6. Describe the exact shape of a metric that *genuinely helps*, using a concrete example, and contrast each ingredient with the executive instinct.
7. A metric was flat for a year, then jumped sharply the quarter after a target was set for it. What's your read, and what do you go look at to confirm it?

<details>
<summary>Answers</summary>

1. **The trap:** any single productivity number — especially ranked or tied to reviews — stops measuring delivery the moment people optimize it (Goodhart), and a composite is the easiest thing to inflate without doing more useful work. **Capitulating** ships a system that trains the org to game you. **Stonewalling** ("metrics don't work") gets you labeled the blocker *and overruled* — the need doesn't vanish, it goes to someone who builds a worse version without guardrails. **Offer instead:** agree with the *need* (legibility/trust), separate it from the mechanism, and provide (a) outcome metrics not output, (b) team/org-level DORA trended *over its own past*, never ranked, and (c) a qualitative narrative so numbers never travel naked. You move the conversation from *whether* to *what*.
2. **(a) Team-owned** (instrument, not verdict); **(b) framed as "improve our system," not "rate our people"** (points attention at queues/handoffs/CI where problems live); **(c) psychological safety** so bad numbers surface; **(d) transparency + a hard wall against comp/ranking.** Safety is the keystone because a metrics system only works if a team can post a *bad* number without fear — that's when it's most useful. Punish bad numbers and people *hide* them (reclassify incidents, split failed deploys), and you can't improve what's hidden.
3. **Surrogation / Goodhart's law caught live** — the metric (coverage) is being optimized as a target, so it's satisfied (tests run every line) without delivering the quality it proxied for (tests assert nothing). The metric and its goal move in *opposite* directions, which is the diagnostic signature. **Defense:** keep coverage a *diagnostic* (look at *why* it's low), never a target, and *pair it with a guardrail* (escaped-defect rate) so gaming the proxy is immediately visible in the pair.
4. The **McNamara fallacy at org scale**: what can't be measured gets treated as unimportant, and the dashboard (only the measurable) slowly redirects all attention/reward toward it — with *no error message*, because nothing on it ever goes red. It typically pushes off **morale/burnout, learning/capability growth, and long-term architectural health** (plus cross-team collaboration). **Countermeasure:** in every metrics review, explicitly say "*these numbers don't capture X, Y, Z — what's our read on those?*" and carry them in narrative + qualitative signal (SPACE satisfaction, retros, attrition, DevEx survey).
5. **(1)** Lead with the dysfunction it's *already* causing in the org's own terms (inflated points, attrition off the hardest teams). **(2)** *Replace, don't remove* — swap the leaderboard for team-level DORA-trend-over-self, so leadership keeps a legible signal and it reads as an upgrade. **(3)** State the new wall publicly and repeatedly: these numbers never feed ratings/ranking/pay. **(4)** Pre-frame and tolerate the *honesty dip* — numbers will look worse for a quarter as gaming washes out; that's truth surfacing, not performance dropping. **"Just stop measuring"** is wrong because a vacuum reads as retreat/hiding-from-accountability and gets filled with something worse; you must offer a *better* signal.
6. **A team, for itself, picks a metric to fix a problem it actually has — used in its own retro, free of stakes, and retired when the problem's fixed.** Example: a team whose bottleneck is code review tracks *its own* review pickup time in *its own* retro, experiments (reviewer rotation, smaller PRs, a self-set SLA), drops it, and *stops fixating on it* once review is no longer the constraint. Contrast: *team* vs management-imposed; *self-chosen/problem-tied* vs a number someone wanted up; *retro/stakes-free* vs ranked and tied to reviews; *temporary* vs permanent. It's the exact inverse of the executive instinct, which is why it works.
7. **Read: gaming, not a real improvement** — genuine process improvements are *gradual*; a step change coinciding with a new target is the signature of people finding the cheap way to move the number. **Confirm by** looking at the *distribution*, not the mean (gaming distorts the shape — e.g., tickets split, started later, or closed earlier for lead time), and by asking "*what specifically changed in the system* to move this?" If there's no nameable mechanism beyond relabeling, it's surrogation.

</details>

---

## Cheat Sheet

```
THE EXECUTIVE ASK (most common + most damaging)
  "one productivity number" / "team leaderboard" / "metrics in perf reviews"
  capitulate → you ship a system that trains the org to game you
  stonewall  → labeled the blocker AND overruled (someone builds it worse)
  REDIRECT   → agree with the NEED (trust/legibility), change the MECHANISM

OFFER INSTEAD (in this order)
  1. outcome metrics, not output     (results + stability, hard to game solo)
  2. team/org DORA/SPACE, trend-over-SELF, NEVER ranked   (improvement)
  3. a qualitative NARRATIVE         (numbers never travel naked)

HEALTHY METRICS CULTURE
  team-OWNED  +  "improve our SYSTEM" not "rate people"
  psychological SAFETY (post bad numbers without fear) = keystone
  transparency + ABSOLUTE wall vs comp/ranking (state it out loud, repeat)

DETECTING GAMING IN FLIGHT
  metric ↑ while its GOAL ↓        → surrogation/Goodhart, caught live
  sharp JUMP after a target set    → gaming (real gains are gradual)
  talk shifts to "our NUMBER"      → team serving dashboard, not system
  watch the PAIR (metric+guardrail), never the lone number
  audit your WINS: "what specifically changed to move this?"

McNAMARA TRAP (no error message — nothing goes red)
  unmeasured → ignored: morale, learning, architecture, collaboration
  countermeasure: "these numbers don't capture X — what's our read on it?"

RECOVERING A BROKEN REGIME (change mgmt, not a debate)
  1. show the dysfunction it's ALREADY causing (org's own terms)
  2. REPLACE don't remove (better signal = upgrade, not retreat)
  3. state the wall publicly + repeatedly (behavior lags policy by months)
  4. PRE-FRAME the honesty dip (truth surfacing ≠ performance dropping)

WHEN METRICS HELP (inverse of every anti-pattern)
  team-owned + self-chosen + problem-tied + retro-used + stakes-free + RETIRED
  e.g. team tracks ITS OWN review pickup time → fixes review → drops it

THE GOODHART THREAD (one pattern, every domain)
  coverage→tests assert nothing | complexity→split-but-worse
  doc-count→empty docstrings    | DORA-ranked→split PRs, reclassified incidents
  defense everywhere: diagnostic-not-target + guardrail + team-owned/stakes-free
```

---

## Summary

- The recurring executive ask — **a single productivity number, a team leaderboard, or metrics in perf reviews** — is the most common and most damaging request you'll field. **Capitulating** ships a system that trains the org to game you; **stonewalling** gets you overruled by someone who builds it worse. The senior move is to **agree with the legitimate need (trust/legibility) and redirect the mechanism**: outcome metrics over output, team/org-level DORA/SPACE *trended over its own past* and never ranked, and a *qualitative narrative* so numbers never travel naked.
- A **healthy metrics culture** has four properties: metrics **owned by the teams** they measure, **framed as "improve our system"** not "rate our people," **psychological safety** so bad numbers surface (the keystone — you can't improve what people hide), and **transparency with an absolute, stated wall** against comp and ranking.
- **Detect dysfunction in flight** by its signatures: a metric improving while its goal worsens (surrogation, Goodhart caught live), a sharp jump right after a target is set (gaming — real gains are gradual), and talk shifting to "our number." Always watch the **metric+guardrail pair**, and **audit your wins** — the most dangerous number looks *great* and carries *high stakes*.
- The **McNamara trap** at org scale silently pushes the *unmeasurable* — morale, learning, architectural health, collaboration — off the dashboard, with no error message. The countermeasure is one sentence per review: *"these numbers don't capture X — what's our read on it?"*
- **Recovering a broken regime** is change management, not a debate: show the dysfunction it's *already* causing, **replace don't remove** (a better signal reads as an upgrade), state the wall publicly and repeatedly, and **pre-frame the honesty dip** so truth surfacing isn't mistaken for performance dropping.
- Metrics **genuinely help** in one precise shape — *team-owned, self-chosen, problem-tied, retro-used, stakes-free, and retired when done* — the exact inverse of the executive instinct. And the **Goodhart thread** runs through every quality proxy (coverage, complexity, doc-count, DORA): targeted, each is satisfied without the quality, and the defense is always *diagnostic-not-target + guardrail + team-owned/stakes-free*.

The full topic now lives in your hands as an *organizational* skill, not just a conceptual one. The final tier — [interview.md](interview.md) — consolidates all of it into the questions that reveal whether someone can defend a metrics culture, not just define Goodhart's law.

---

## Further Reading

- Forsgren, Humble & Kim, *Accelerate* — the DORA four keys *and* the explicit warnings that they are team metrics for improvement, never individual or comparative evaluation.
- *The SPACE of Developer Productivity* (Forsgren, Storey, et al., 2021) — why productivity is never one number, and how to carry the perceptual/satisfaction signal the dashboard can't.
- Martin Fowler, *cannotMeasureProductivity* — the canonical essay on why software productivity resists a single number, and what to do anyway.
- Marilyn Strathern's formulation of **Goodhart's law** ("when a measure becomes a target, it ceases to be a good measure") and **Campbell's law** — the theory behind the gaming.
- Deming, *Out of the Crisis* — "drive out fear," the abolition of ranking, and the systems-thinking roots of "fix the system, not the people."
- *DevEx: What Actually Drives Productivity* (Noda, Storey, Forsgren & Greiler, 2023) — the modern, humane successor that foregrounds the unmeasurable McNamara blind spots.

---

## Related Topics

- [junior.md](junior.md) — the first names for the anti-patterns: vanity metrics, measuring individuals, LOC/velocity/commit counts.
- [senior.md](senior.md) — Goodhart's and Campbell's laws, surrogation, and the McNamara fallacy as mechanisms.
- [interview.md](interview.md) — the consolidation: the questions that test whether you can *defend* a metrics culture, not just define the traps.
- [01 — DORA Four Key Metrics](../01-dora-four-key-metrics/professional.md) — the right metrics to offer leadership, and DORA's own guidance against ranking and individual use.
- [03 — The SPACE Framework](../03-space-framework/professional.md) — why productivity is multi-dimensional, and how to carry the qualitative/satisfaction signal upward.
- [Code Quality Metrics](../../code-quality-metrics/) — where the same Goodhart thread plays out on complexity, coupling, and duplication.
- [Technical Debt Management](../../technical-debt-management/) — the architectural-health blind spot the dashboard misses, made explicit and actionable.
