# Quality & Reliability Metrics — Professional Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Quality & Reliability Metrics
> *The senior page taught you to compute the numbers — change failure rate, MTTR percentiles, an error budget. This page is about running reliability as a funded, governed discipline: turning the error budget into a written policy that product actually honors, choosing how many nines each service is worth, building an incident program whose definitions hold up under pressure, and using downtime cost to win the budget fight in the room where money is allocated.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Error Budgets as Policy, Not a Dashboard](#error-budgets-as-policy-not-a-dashboard)
4. [Setting SLOs That Match Users and Business Cost](#setting-slos-that-match-users-and-business-cost)
5. [The Incident-Metrics Program](#the-incident-metrics-program)
6. [Using Reliability Metrics to Justify Investment](#using-reliability-metrics-to-justify-investment)
7. [Cross-Cutting Governance — One Definition, Org-Wide](#cross-cutting-governance--one-definition-org-wide)
8. [The Failure Modes](#the-failure-modes)
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

> Focus: **Running reliability as a managed, funded discipline — error budgets as enforceable policy, SLOs priced against business cost, an incident program whose numbers are trustworthy, and a business case that wins reliability the staffing and the slow-downs it needs.**

The senior page made you fluent in the measurements. At the professional level the measurements stop being the point. The point is the *fight* they exist to settle — speed versus reliability — and who wins it.

That fight happens in real meetings. A VP wants three features shipped this quarter; the on-call rotation is drowning; the last two launches each caused a SEV-2; and "we should slow down and fix reliability" loses to "ship it" every single time, because *slow down* is a feeling and *ship it* is a roadmap commitment. The whole apparatus on this page — the error-budget *policy*, the criticality-tiered SLOs, the incident program, the downtime-cost model — exists to convert that feeling into a number with teeth, so the decision is made by a referee instead of by whoever has more political capital.

None of this is new *math*. It's the senior tier's CFR, MTTR distribution, and error budget, now wrapped in agreements, governance, and money. The skill is judgment under organizational pressure: knowing that an SLO at 100% guarantees failure, that a loosely-set budget that never trips is reliability theater, and that an MTTR you can game by reclassifying a SEV-1 to a SEV-3 is worse than no MTTR at all. This is the pragmatic, battle-tested layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — CFR, the MTTR family and why you watch the distribution not the mean, SLI/SLO/SLA, computing an error budget, the speed-vs-stability false trade-off.
- **Required:** You've been on call and felt the pull between "ship the feature" and "the system is on fire."
- **Helpful:** You've sat in a planning meeting where reliability work lost to feature work, and watched the consequences.
- **Helpful:** You've owned a service's SLO, run a postmortem, or argued for headcount.

---

## Error Budgets as Policy, Not a Dashboard

At the senior level an error budget is a *number*: if your SLO is 99.9% over 30 days, you may be unavailable for ~43 minutes, and you can watch that budget burn on a dashboard. That dashboard, by itself, changes nothing. Teams stare at a depleted budget and ship the next risky feature anyway. The budget only becomes powerful when it is a **policy** — a written agreement, signed by both engineering *and* product leadership, that specifies in advance what happens when the budget runs out.

A real error-budget policy has four parts, and the third and fourth are the ones that matter:

1. **The SLO target** — e.g., "the checkout API is 99.9% successful over a rolling 28 days," with the SLI defined precisely (which requests count, what "success" means, measured where).
2. **The budget** — the math: 99.9% over 28 days = ~40 minutes of allowed failure, tracked as a burn-down.
3. **The consequence when it's exhausted** — *this is the policy.* For example: "When the error budget is spent, all feature deployments to this service freeze. Only reliability fixes and rollbacks ship until the budget recovers. Reliability work is pulled to the top of the backlog ahead of feature work." Without a stated consequence you have a metric, not a policy.
4. **The escalation and override path** — who can declare an exception (e.g., a contractually-committed launch), what they trade for it, and who must sign. The override must be *expensive and visible*, not a quiet Slack message — otherwise it's the default.

The policy's real function is to make the speed-vs-reliability decision **objective and pre-committed**. Before the budget is spent, both sides agree to the rule while calm; when it's spent, the freeze is automatic and impersonal. The on-call engineer no longer has to win a political argument against a VP at 2 a.m. — the *policy* already won it, in daylight, with everyone's signature on it. The error budget becomes the **objective referee**: as long as you're within budget, product gets to ship as fast as it likes (reliability stops nagging); the moment you're over, reliability gets the wheel. Both sides get something, which is why both sides can sign.

Getting product and engineering to *actually honor it* is the hard part, and it is mostly social, not technical:

- **Get the signature before you need it.** A policy negotiated during an outage is a policy nobody believes. Negotiate it during a calm quarter, when "we'll freeze if we burn the budget" is hypothetical and cheap to agree to.
- **Make the freeze automatic, not requested.** If the freeze requires someone to *ask* for it, it won't happen — asking costs political capital. Wire the policy into the deploy pipeline so an exhausted budget blocks feature deploys by default, and shipping anyway requires a logged, named override.
- **The first honored freeze is everything.** The policy is fiction until the org actually freezes a launch because of it. That first freeze — ideally one that visibly prevents a worse outage — converts the budget from a chart into a force. (See the war story.)
- **Frame it as product's lever, not engineering's veto.** A budget *in surplus* is explicit permission to take risks and move fast. Sold that way, product owns the budget rather than resenting it.

> **The professional reality:** an error budget without a written, pre-signed consequence is a thermometer in a building with no fire department. Everyone agrees it's hot; nobody is obligated to do anything. The policy — the *if-exhausted-then-freeze* clause and the expensive override — is the entire mechanism that turns measurement into behavior.

---

## Setting SLOs That Match Users and Business Cost

The single most important fact about SLO targets: **the right target is almost never 100%, and chasing 100% is a way to fail.** Reliability has steeply rising marginal cost — each additional "nine" is roughly an order of magnitude more expensive than the last, in engineering effort, architectural complexity, and opportunity cost — while the *user-perceived* benefit flattens. Past a certain point your users literally cannot tell the difference, because their own network, device, and the services around yours fail more often than you do.

The cost-of-a-nine, made concrete (downtime per rolling 30 days):

| SLO | Allowed downtime / 30d | Roughly what it demands |
|---|---|---|
| 99% (two nines) | ~7.2 hours | Basic monitoring, business-hours response |
| 99.9% (three nines) | ~43 minutes | Real on-call, fast rollback, tested alerting |
| 99.95% | ~22 minutes | Redundancy, automated failover, mature deploys |
| 99.99% (four nines) | ~4.3 minutes | Multi-AZ/region, no-human-in-the-loop recovery, heavy investment |
| 99.999% (five nines) | ~26 seconds | Extreme engineering; very few systems genuinely need this |

The discipline is to set the target by **service criticality and user expectation**, not by ambition or vanity:

- **Tier the services.** A payment path, an auth service, and the front door of the product warrant a tight SLO; an internal admin tool, a batch report, or a "related items" widget warrant a loose one. Spending four-nines effort on the recommendations sidebar is money set on fire while the payment path runs on three.
- **Anchor the target in what users actually expect and tolerate.** If users retry without noticing a sub-second blip, your SLI/SLO should reflect *user-perceived* success, not raw server-side 200s. The target exists to keep users happy at the lowest sustainable cost — not to make a number look impressive.
- **Price the next nine before you commit to it.** "To go from 99.9% to 99.99% we need multi-region failover, ~2 engineers for a quarter, and higher infra spend — for 38 fewer minutes of downtime a month. Is *this* service worth that?" Frequently the honest answer is no, and naming the cost is what makes that answer sayable.

**The SLA-versus-SLO buffer** is the other piece professionals always get right. The **SLA** is the *contractual, customer-facing* promise with financial penalties (refunds, credits) attached. The **SLO** is your *internal* target — and it must be **stricter than the SLA**, deliberately, so your internal alarms fire and you start responding *before* you're anywhere near breaching the contract. If your SLA promises 99.9%, you might run an internal SLO of 99.95%: the gap is your early-warning margin and your safety buffer. Setting SLO = SLA means the first time you learn you're in trouble is the moment you owe customers money. Publishing your internal SLO *as* your SLA is a different, classic error — you've contractually promised your aspiration and removed your own headroom.

> **The professional reality:** "what's our SLO?" is the wrong first question. The right ones are *who depends on this service, what do they actually notice, what does an extra nine cost, and what does an outage cost?* The number falls out of those answers. A target picked because it "sounds responsible" (everything is 99.99%!) either bankrupts you on the trivial services or under-protects the critical ones.

---

## The Incident-Metrics Program

Incident metrics are only as trustworthy as the *program* that produces them. A pile of MTTR numbers computed from inconsistently-classified, inconsistently-recorded incidents is worse than useless — it's *confidently* misleading. The program is what makes the numbers mean something.

**Consistent incident definition and severity.** Before any metric, the org needs a single, written answer to "what is an incident?" and a severity scale with *objective* triggers, not vibes:

| Sev | Trigger (example, customer-impact based) | Response |
|---|---|---|
| SEV-1 | Critical path down / data loss / major customer-facing outage | All-hands, immediate page, exec comms |
| SEV-2 | Significant degradation, workaround exists, subset of users | Page on-call, urgent |
| SEV-3 | Minor / internal / single-customer, low impact | Ticket, business hours |

Severity must be defined by **customer impact**, not by how stressed the responder felt — because severity is what most of your metrics slice on, and a fuzzy scale is the exact lever people use to game them (next section).

**The MTTR family, with the senior caveat carried forward.** Track the full lifecycle, not one blurry "MTTR":

- **MTTD** — detect (incident start → someone/something notices).
- **MTTA** — acknowledge (alert → human engaged).
- **MTTR** — *restore service* (the user-facing one; distinct from full root-cause repair).
- **MTBF** — mean time between failures (frequency).

And the caveat that separates seniors from juniors: **watch the distribution and the cost, not the mean.** MTTR is a small sample of a long-tailed, skewed quantity; the *average* is dominated by outliers and noise. One catastrophic 9-hour outage and twenty 4-minute blips "average" to a number that describes none of them. Track the **p50 and p90/p95**, look at the *tail* (the rare long incident is where the real risk and cost live), and weight by **customer impact / downtime cost**, not incident count. "Our MTTR dropped 20%" is meaningless if the one outage that actually hurt customers got *longer*.

**Blameless postmortems feeding the numbers.** The metrics program and the postmortem process are one system. Postmortems are where each incident gets its *agreed* severity, its accurate timeline (the timestamps that produce MTTD/MTTA/MTTR), and its contributing factors — and they only produce honest data if they're **blameless**. The instant a postmortem can get someone blamed or punished, two things happen: people stop reporting marginal incidents (your CFR and incident count drop — falsely), and they fight to downgrade severity (your MTTR improves — falsely). A blame culture doesn't just hurt morale; it *corrupts your reliability data at the source*. The postmortem's job is to feed the program accurate, defensible numbers and a list of prioritized fixes — which is exactly the work the error budget then funds.

> **The professional reality:** the incident program is the measurement instrument, and an instrument you can bend produces readings you can't trust. Objective severity triggers, a defined "what is an incident," distribution-not-mean MTTR, and blameless postmortems aren't process for its own sake — they're calibration. Skip them and every reliability number you report downstream (including your DORA stability keys) is built on sand.

---

## Using Reliability Metrics to Justify Investment

Reliability work loses to feature work by default, because features have visible upside and reliability's payoff is an *absence* — the outage that didn't happen. The professional move is to make that absence financial. Reliability metrics are the raw material for a **business case**, and the business case is how you win staffing, slow-downs, and infra budget.

**Quantify downtime cost.** The foundational number is *what an hour of this service being down costs the business*. Assemble it from whatever's defensible:

- **Direct revenue loss** — e.g., a checkout flow doing $400k/hour in transactions loses ~$400k per hour of full outage (adjust for partial impact and recovery curve).
- **SLA penalties** — credits and refunds contractually owed when you breach the customer-facing SLA.
- **Productivity loss** — for internal tooling, (engineers blocked) × (loaded hourly cost) × (hours down).
- **Churn and trust** — softer, but real; a string of visible outages shows up in renewals and reputation, and the trend is citable even when the exact dollar isn't.

Once "an hour down on the payment path costs ~$X" exists, every other argument gets sharper. The cost of the *next nine* (previous section) can be weighed against the downtime it prevents. "We had Y hours of SEV-1/SEV-2 downtime last quarter at ~$X/hour = $Z of impact; two SREs and a failover project cost less than $Z and would have prevented most of it" is an argument a CFO can act on. "We feel like we should invest in reliability" is not.

**The business case for SRE staffing** is the same logic applied to people. On-call toil, MTTR trending the wrong way, error budgets chronically exhausted, and a rising incident rate are all *evidence*, and you translate them: "the budget for service A has been exhausted 3 quarters running; the team spends ~40% of its time firefighting instead of shipping; that's N engineer-months of feature work lost to reliability debt — funding an SRE pays for itself by reclaiming it." Notice the framing: reliability investment isn't a *cost*, it's *buying back* the velocity that incidents are stealing — which reconnects to the central thesis that speed and stability are allies, not opposites.

> **The professional reality:** the org funds what it can see a number for. Reliability's whole problem is that its wins are invisible (nothing broke). Downtime cost, hours-of-impact, and toil-percentage make the invisible legible — they turn "trust us, we need this" into a financial case with a return. That translation is, more than any dashboard, the senior-most reliability skill.

---

## Cross-Cutting Governance — One Definition, Org-Wide

Reliability metrics are comparable and aggregable *only* if everyone computes them the same way. The moment "incident," "failure," and "severity" mean different things in different teams, every cross-team number — and every DORA roll-up — becomes apples-to-oranges, and leadership makes decisions on noise.

This is the governance layer, and it's unglamorous but load-bearing:

- **One definition of "incident" and "failure," org-wide.** [Change failure rate](../01-dora-four-key-metrics/professional.md) is "% of deployments causing a failure" — but if Team A counts only customer-facing outages and Team B counts every rolled-back deploy, their CFRs are not the same metric and must never sit in the same comparison. Pick one definition of "failure that counts," write it down, and hold every team to it.
- **One severity scale with shared triggers.** If a SEV-1 in payments is a SEV-2 in platform, MTTR-by-severity is meaningless across teams. The scale and its objective triggers are an org asset, not a team preference.
- **Tie it to the DORA stability keys.** CFR and time-to-restore are two of DORA's four keys, and they are *exactly* these reliability numbers. Govern the definitions once, and your DORA stability reporting and your reliability program draw from the same trustworthy well. Let them drift, and your DORA dashboard quietly lies. (See [01 — DORA Four Keys](../01-dora-four-key-metrics/professional.md) for the keys; this section is why their definitions must be centrally owned.)
- **Centralize the SLI/SLO definitions and the budget math.** Same averaging windows, same percentiles, same "what counts as success," same rolling period. Federated *targets* (each team picks its tier) on top of centralized *definitions* (everyone measures the same way) is the balance that scales.

> **The professional reality:** governance here isn't bureaucracy, it's *unit consistency*. You'd never let two teams report "revenue" with different definitions of a dollar. CFR and MTTR are no different — without one org-wide definition of "incident" and "failure," your reliability numbers and your DORA stability keys are measured in incompatible units, and any comparison built on them is fiction.

---

## The Failure Modes

The same metrics that drive improvement get gamed, gutted, or theatricalized. Recognize the patterns:

- **Gaming MTTR by reclassifying incidents.** The fastest way to "improve" MTTR is to *downgrade severities* so the long, painful incidents fall out of the headline metric, or to *not declare an incident at all* until you've already mostly fixed it (starting the clock late). The number gets better; reliability does not. This is [Goodhart's law](../06-metrics-anti-patterns-and-goodhart/professional.md) in pure form — the measure became the target, so it stopped measuring reality. The defense is *objective* severity triggers and a defined incident-start, governed centrally, plus watching the distribution (a suspiciously shrinking tail with stable customer complaints is the tell).
- **SLOs set so loose they never trip.** A 95% SLO on a service that naturally runs at 99.5% has an error budget that *never empties*, so the policy never activates and the freeze never happens. It looks like you have governance; you have a decoration. A budget that has never once constrained a launch isn't protecting anything. The defense is to set targets near real user expectation, and to treat "the budget never trips" as a *red flag*, not a success.
- **Reliability theater.** Dashboards no one acts on, SLOs with no attached policy, postmortems that produce documents but never funded fixes, MTTR tracked but never used in a decision. The *appearance* of a reliability practice with none of the consequences. The tell: the numbers exist, look healthy, and *nothing the org does ever changes because of them*. If no launch was ever frozen, no investment ever justified, and no target ever moved a decision, the whole apparatus is ceremony.

> **The professional reality:** a reliability metric is only real if it can *force a decision you'd otherwise avoid* — freeze a launch, fund an SRE, slow a team down. The instant a number can be improved by relabeling instead of by fixing, or set so it never bites, it has stopped being a measurement and become theater. Audit your own program by asking: *what did this number actually change last quarter?* If the answer is "nothing," you have decoration, not reliability engineering.

---

## War Stories

**The error-budget policy that finally stopped reckless launches.** A team shipped big features on fixed marketing dates, each launch causing a multi-hour SEV. "Slow down and harden first" lost every time — the date was a commitment, reliability was a feeling. They negotiated an error-budget policy *during a calm month*: 99.9% SLO, and **feature deploys freeze automatically when the budget is spent**, override requiring a VP's logged signature. The next launch burned the budget in a day. The pipeline blocked the *following* feature; the override sat unsigned because no VP wanted their name on shipping into a known-unstable service. The team spent two weeks on reliability instead — and the *next* launch was the first in a year without a SEV-1. The policy didn't change the engineering; it changed *who won the argument*, by settling it in advance with a signature instead of in the moment with politics.

**MTTR gamed by downgrading sev levels.** Leadership put MTTR on a dashboard and asked teams to "drive it down." Within two quarters MTTR was beautifully improved — and customer-reported outages were flat. The mechanism: incidents that used to be SEV-1 were quietly logged as SEV-2 or SEV-3 (which had a separate, gentler MTTR target, or fell out of the headline number entirely), and several painful incidents were "investigations," never formally declared, so their clocks started late. The metric measured *classification discipline*, not recovery. The fix was governance: objective, customer-impact-based severity triggers; a defined incident-start independent of who's responding; reporting the *distribution* (the tail told the true story the mean hid); and crucially, *never* setting MTTR as a target to beat — only watching it to learn.

**The SLO set at 100% that guaranteed failure.** A new platform team, wanting to signal seriousness, declared a **100% availability SLO** for an internal API. The error budget was therefore *zero* — meaning the very first failed request, ever, was an SLO breach. Every blip became an "SLO violation," alerts screamed constantly, the team learned to ignore them (alert fatigue), and the SLO became a number nobody believed or acted on — the opposite of its purpose. Worse, with a zero budget there was *no room for the normal risk of shipping*, so either nothing could change or the SLO was a permanent, ignored lie. They reset it to 99.9% — a real, breachable, *budgeted* target — and reliability conversations became possible again. The lesson: **100% isn't the most reliable target, it's the one that guarantees the SLO is meaningless.** A budget of zero is no budget at all.

---

## Decision Frameworks

**How many nines does THIS service need? Walk it:**
- **Who depends on it, and what do they notice?** Critical user path (payments, auth, the front door) → tight (99.95%+). Internal tool, batch job, non-critical widget → loose (99%–99.9%) is *correct*, not lazy.
- **What does an hour of downtime cost?** High (direct revenue, SLA penalties) → justify a tighter target. Low (mild inconvenience, easy retry) → a looser target is the responsible spend.
- **What does the next nine cost?** Price it (engineers, architecture, infra, opportunity) and weigh against the downtime it prevents. If the cost exceeds the avoided loss, *stop* — this service doesn't need that nine.
- **Then set SLO < SLA.** Keep an internal buffer below any contractual promise so you respond before you owe money.

**Do we have a real error-budget policy, or just a chart? It's real only if:**
- There's a *written consequence* when the budget is exhausted (freeze / reliability-work-first).
- The consequence is *automatic* (wired into the pipeline), and overriding it is *expensive and logged*.
- Both product *and* engineering leadership *signed* it, while calm.
- It has *actually* frozen something at least once. (If not, it's untested fiction.)

**Is this reliability metric trustworthy, or gameable? Ask:**
- Could the number improve via *relabeling* (downgrading severity, late incident-start) instead of *fixing*? → harden the definitions, govern centrally.
- Is it a *target to beat* or a *signal to learn from*? → if it's a target (Goodhart bait), expect gaming; prefer "watch, don't weaponize."
- Has the budget/SLO *ever actually tripped*? → if never, it's set too loose; that's a red flag, not a win.

**Should we fund this reliability investment? Build the case:**
- Downtime cost ($/hour) × hours-of-impact last period = $ of pain.
- Cost of the fix (people + infra) vs that $ of pain → if the fix is cheaper, it pays for itself.
- Reframe as *buying back velocity*: toil-% and exhausted-budget quarters = feature work reliability is stealing.

---

## Mental Models

- **An error budget is a peace treaty signed before the war.** Both sides agree, while calm, that in-budget means product ships freely and over-budget means reliability takes the wheel. The signature, negotiated in daylight, is what wins the 2 a.m. argument automatically.

- **100% is not the most reliable target — it's the one that guarantees failure.** A zero budget has no room for the normal risk of change, so the SLO becomes a permanent lie everyone ignores. The right target is the *lowest* one your users are happy with.

- **Each nine costs ~10× the last; users notice ~10× less.** Reliability has steeply rising cost and flattening benefit. The job is to find where they cross *for this specific service*, not to maximize nines.

- **An MTTR you can relabel measures classification, not recovery.** Watch the *distribution and the cost-weighted tail*, never the mean, and never set it as a target to beat — the moment it's a target, the severity scale becomes the lever and the number lies.

- **A reliability metric is real only if it forced a decision you'd have avoided.** Froze a launch, funded an SRE, moved a target. If nothing the org does ever changes because of a number, that number is theater.

- **One definition or it's not a comparison.** CFR and MTTR are units of measurement; two teams with different definitions of "incident" are reporting in incompatible units, and every roll-up (including DORA) built on them is fiction.

---

## Common Mistakes

1. **An error budget with no attached policy.** A burn-down chart nobody is obligated to act on changes nothing. Write the *if-exhausted-then-freeze* consequence, wire it into the pipeline, make the override expensive and logged, and get both leaderships to sign — before you need it.

2. **Setting the SLO to 100% (or equal to the SLA).** 100% means a zero budget, no room for change, constant false breaches, and an ignored SLO. SLO = SLA means you learn you're in trouble the moment you owe customers money. Set realistic, breachable targets, with the internal SLO *stricter* than the contractual SLA.

3. **One SLO for everything.** Four-nines effort on a sidebar widget is money burned; three-nines on the payment path may be negligence. Tier the target by criticality, downtime cost, and what users actually notice.

4. **Reporting the mean MTTR.** A skewed, small-sample, long-tailed quantity has no meaningful average. Report p50/p90, watch the *tail*, weight by customer impact — and don't make MTTR a target to beat.

5. **Letting "incident" and "severity" mean different things per team.** Without one org-wide definition, CFR and MTTR aren't comparable and your DORA stability keys are noise. Govern the definitions centrally; federate only the *targets*.

6. **Punishing people in postmortems.** Blame corrupts the data at its source — people stop declaring incidents and fight to downgrade severity, so your CFR and MTTR improve *falsely*. Blameless isn't only kind; it's the only way the numbers stay honest.

7. **Reliability theater.** Dashboards no one acts on, SLOs with no policy, postmortems that produce docs but never funded fixes. Audit by asking *what decision did this number change?* — if "none," it's ceremony, not engineering.

8. **Asking for reliability investment without a number.** "We should invest in reliability" loses to a roadmap. Quantify downtime cost and toil-%, frame the work as *buying back stolen velocity*, and make it a financial case a CFO can act on.

---

## Test Yourself

1. An error budget dashboard has been red for weeks and the team keeps shipping features anyway. What is missing that would change the behavior, and what are the parts that make it real?
2. A leader says "let's make every service 99.99%." Explain why that's wrong in terms of the cost of a nine, and describe how you'd actually choose each service's target.
3. Why must the internal SLO be stricter than the customer-facing SLA, and what goes wrong if they're equal?
4. Your org's MTTR has improved 25% over two quarters, but customer-reported outage hours are flat. Give the most likely explanation and the governance fixes.
5. Why is reporting a *mean* MTTR misleading, and what should you report and weight by instead?
6. Two teams both report a 5% change failure rate. Why might these numbers be incomparable, and what's the fix?
7. A platform team sets a 100% availability SLO to "show they're serious." Walk through everything that goes wrong.
8. You need to fund two SREs and leadership is skeptical. Build the business case from reliability metrics.

<details>
<summary>Answers</summary>

1. Missing: a **written policy with a consequence**. The budget is just a metric until there's a pre-agreed rule — *when the budget is exhausted, feature deploys freeze and reliability work goes to the top of the backlog*. To be real it needs: (a) a stated consequence, (b) enforcement that's *automatic* (wired into the pipeline, not requested), (c) an *expensive, logged* override, and (d) sign-off from both product and engineering leadership, obtained while calm. The policy makes the speed-vs-reliability call objective and pre-committed so the on-call engineer doesn't have to win a political fight in the moment.
2. Each additional nine costs roughly **10× the previous one** (effort, architecture, infra, opportunity cost) while users notice ~10× *less* — past a point they can't perceive the difference. Choosing the target: **tier by criticality** (payments/auth/front-door tight; internal/batch/widgets loose), **anchor to what users actually notice and tolerate**, **price the next nine** against the downtime it prevents, and set **SLO < SLA**. A blanket 99.99% bankrupts you on trivial services and may *under*-protect the truly critical ones.
3. The **SLA** is the contractual, penalty-bearing promise; the **SLO** is the internal target. Keeping SLO *stricter* gives an early-warning buffer — your alarms fire and you respond *before* you're near breaching the contract and owing credits. If SLO = SLA, the first time you learn you're in trouble is the moment you've already breached and owe customers money; you've removed your own headroom.
4. Most likely **gaming via reclassification**: painful incidents downgraded to lower severities (with gentler/separate MTTR targets, or excluded from the headline number) and/or incidents declared *late* so the clock starts after most of the recovery. The metric now measures classification discipline, not recovery. Fixes: **objective, customer-impact-based severity triggers**; a **defined incident-start** independent of the responder; report the **distribution/tail** (it reveals what the mean hides); **never set MTTR as a target to beat** — watch it to learn. Centralized governance of these definitions.
5. MTTR is a **small, skewed, long-tailed** sample; the mean is dominated by outliers and describes none of the actual incidents — one 9-hour outage plus twenty 4-minute blips "average" to a fiction. Report **p50 and p90/p95**, examine the **tail** (where real risk/cost lives), and **weight by customer impact / downtime cost**, not incident count.
6. They're likely **different definitions of "failure"** — Team A counts only customer-facing outages, Team B counts every rolled-back deploy. Same word, different units, so the comparison is meaningless (and any DORA roll-up across them is noise). Fix: **one org-wide definition of "incident"/"failure" and one severity scale with shared triggers**, governed centrally; teams may pick their own *targets* but must *measure* identically.
7. A 100% SLO → a **zero error budget**, so the *first failed request ever* is a breach. Consequences: constant false "violations" → **alert fatigue** → the team ignores the SLO; **no room for the normal risk of change**, so either nothing ships or the SLO is a standing lie; the SLO drives no real decisions. 100% isn't the most reliable target — it's the one that **guarantees the SLO is meaningless**. Reset to a realistic, breachable, *budgeted* target (e.g., 99.9%).
8. Quantify **downtime cost** ($/hour from direct revenue, SLA penalties, productivity, churn), multiply by the **hours of SEV-1/2 impact** last period to get $ of pain; show the **fix cost** (two SREs + infra) is *less than* that pain so it pays for itself; and reframe as **buying back velocity** — "the team spends ~40% of its time firefighting; that's N engineer-months of feature work reliability is stealing." Turn the invisible (outages that didn't happen) into a financial return a CFO can act on.

</details>

---

## Cheat Sheet

```
ERROR BUDGET AS POLICY (the four parts; #3 and #4 are the point)
  1. SLO target + precise SLI
  2. The budget (e.g. 99.9%/28d ≈ 40 min)
  3. CONSEQUENCE when exhausted  → freeze features, reliability-work-first
  4. Override path               → expensive, logged, named signature
  REAL only if: automatic enforcement + signed by product & eng + has frozen something once

THE COST OF A NINE  (downtime / 30 days)
  99%     ~7.2 h    monitoring, business-hours
  99.9%   ~43 min   real on-call, fast rollback
  99.95%  ~22 min   redundancy, auto-failover
  99.99%  ~4.3 min  multi-region, no-human recovery (expensive)
  99.999% ~26 s     extreme; almost nobody needs it
  RULE: each nine ≈ 10× cost, ~10× less noticed. Tier by criticality.
  SLA = contract (penalties). SLO = internal, STRICTER than SLA (buffer).

INCIDENT PROGRAM
  Define "incident" once, org-wide. Severity by CUSTOMER IMPACT, objective triggers.
  MTTD → MTTA → MTTR(restore) → MTBF
  MTTR: watch p50/p90 + TAIL + cost-weighted. NEVER the mean. NEVER a target to beat.
  Blameless postmortems = honest data (blame → false-better CFR/MTTR).

JUSTIFY INVESTMENT
  downtime $/hr  ×  hours-of-impact  =  $ of pain
  fix cost (people+infra)  <  $ of pain   → it pays for itself
  Frame as BUYING BACK VELOCITY (toil-% + exhausted-budget quarters)

GOVERNANCE
  One def of incident/failure → CFR & MTTR comparable → DORA stability keys trustworthy
  Centralize definitions; federate targets.

FAILURE MODES
  Game MTTR by reclassifying severity / late incident-start  → objective triggers
  SLO so loose it never trips                                → red flag, not success
  Reliability theater (numbers nothing acts on)             → "what did it change?"
```

---

## Summary

- **An error budget is only powerful as a written policy.** The math is senior-tier; the professional layer is the *agreement*: SLO target, the budget, the **consequence when it's exhausted** (feature freeze, reliability-work-first), and an **expensive, logged override** — pre-signed by product *and* engineering while calm. It makes the speed-vs-reliability fight objective and pre-committed, with the budget as the impartial referee. It's real only once it has *actually frozen* something.
- **The right SLO is almost never 100%.** Each nine costs ~10× the last and is noticed ~10× less; 100% means a zero budget and a meaningless, ignored SLO. **Tier targets by criticality and downtime cost**, anchor to real user expectation, price the next nine before committing, and keep the **internal SLO stricter than the customer-facing SLA** as your safety buffer.
- **Trustworthy incident metrics require a program**: one definition of "incident," **objective customer-impact severity triggers**, the full MTTD/MTTA/MTTR/MTBF family with the caveat to **watch the distribution and cost-weighted tail, never the mean**, and **blameless postmortems** that feed honest numbers and funded fixes.
- **Reliability work gets funded when you make its payoff financial.** Quantify **downtime cost**, multiply by hours-of-impact, show the fix costs less than the pain, and frame reliability investment as **buying back the velocity incidents are stealing**.
- **Govern the definitions org-wide.** CFR and MTTR are units; without one shared definition of "incident"/"failure" they're incomparable and your **DORA stability keys** become noise. Centralize definitions; federate targets.
- **Watch for the failure modes** — MTTR gamed by reclassification, SLOs so loose they never trip, and reliability theater. A metric is real only if it *forced a decision you'd otherwise have avoided*.

You can now run reliability as a managed, funded, governed discipline rather than a dashboard. The final tier — [interview.md](interview.md) — distills the whole topic into the questions that reveal whether someone truly understands error budgets, SLO economics, and trustworthy incident metrics.

---

## Further Reading

- *Site Reliability Engineering* (Google, the "SRE book") — chapters on SLOs, error budgets, and the error-budget *policy*; the canonical source for "100% is the wrong target" and the budget-as-referee idea.
- *The Site Reliability Workbook* (Google) — the practical companion: implementing SLOs, writing an error-budget policy, and the SLA-vs-SLO buffer with worked examples.
- *Implementing Service Level Objectives* by Alex Hidalgo — a deep, vendor-neutral treatment of choosing targets, SLIs, and burn-rate alerting.
- *Accelerate* (Forsgren, Humble, Kim) — change failure rate and time-to-restore as DORA stability keys, and why speed and stability rise together.
- Google's incident-management and *postmortem culture* material — blameless postmortems as the source of trustworthy incident data.
- John Allspaw's writing on incident analysis and severity — why customer-impact-based, objective severity beats responder-felt severity.

---

## Related Topics

- [junior.md](junior.md) — the starting point: what CFR, MTTR, availability, and an SLO *are*.
- [senior.md](senior.md) — computing the numbers: CFR, the MTTR family and the distribution caveat, SLI/SLO/SLA, the error-budget math, the speed-vs-stability false trade-off.
- [interview.md](interview.md) — the questions that probe whether you truly understand error budgets, SLO economics, and trustworthy incident metrics.
- [01 — DORA Four Key Metrics](../01-dora-four-key-metrics/professional.md) — change failure rate and time-to-restore are two of the four keys; this page is why their definitions must be centrally governed.
- [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/professional.md) — the deeper treatment of gaming, Goodhart's law, and "measure to improve, never to judge" that the failure-modes section draws on.
- [Diagnostics](../../../diagnostics/) — the broader discipline of debugging and operating systems under failure that incident response and MTTR live inside.
