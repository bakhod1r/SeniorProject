# Quality & Reliability Metrics — Interview Questions

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Quality & Reliability Metrics
> *A reliability interview rarely asks "what is uptime." It asks "set an SLO for checkout — walk me through it," then watches whether you reach for a number or for the *user journey*, whether you know error budget is just `1 − SLO`, and whether you can explain why your MTTR dashboard is lying to you. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — The Stability Metrics](#theme-1--the-stability-metrics)
3. [Theme 2 — Availability and the Nines](#theme-2--availability-and-the-nines)
4. [Theme 3 — SLI, SLO, SLA, and Error Budgets](#theme-3--sli-slo-sla-and-error-budgets)
5. [Theme 4 — The MTTR Critique](#theme-4--the-mttr-critique)
6. [Theme 5 — Quality Metrics](#theme-5--quality-metrics)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Program and Gaming](#theme-7--program-and-gaming)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **rate vs duration** (how *often* you fail vs how *long* you stay broken)
- **the SLI/SLO/SLA stack** (the measurement, the internal target, the external promise with teeth)
- **mean vs distribution** (the average that hides the tail vs the percentile that exposes it)
- **the metric vs the goal** (the number on the dashboard vs the user outcome it stands in for)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well name the distinction first, do the arithmetic without flinching, and volunteer the *caveat* — the way each metric lies — before being pushed to it.

---

## Theme 1 — The Stability Metrics

### Q1.1 — DORA has four metrics. Two are about speed. What are the two *stability* metrics, and exactly how do you compute each?

> **Testing:** Whether you can name and *operationalize* CFR and time-to-restore, not just recite the four.

**A.** The two stability metrics are **Change Failure Rate (CFR)** and **Failed Deployment Recovery Time** (the metric formerly called *Time to Restore Service* / MTTR in older DORA reports).

- **CFR** = (deployments that cause a degraded service requiring remediation — a hotfix, rollback, patch, or forward-fix) ÷ (total deployments), over a window. It's a *ratio*, expressed as a percentage. Elite performers sit in the **0–15%** band in the *Accelerate*/DORA reports. The hard part isn't the division — it's defining "failure" consistently (does a feature-flag-disabled rollout count? a config-only fix?), because the denominator and the failure definition decide everything.
- **Time to restore** = the elapsed wall-clock time from when a change-induced failure *begins to affect users* to when service is *restored*, aggregated as a median or distribution across incidents. Elite is **under one hour**.

The distinction to name out loud: CFR is a **rate** (how often deploys break things), restore time is a **duration** (how long you stay broken). They answer different questions and you need both — a 2% CFR with a 3-day recovery is a very different operation than a 20% CFR with a 5-minute rollback.

### Q1.2 — A team brags about a 1% change failure rate. What's your first question?

> **Testing:** Whether you interrogate the denominator and the failure definition before believing the number.

**A.** "How many deployments, and how do you define a failure?" A 1% CFR over **10 deploys a quarter** is one failure and statistically meaningless; over **5,000 deploys** it's a real signal. Then the definition: if "failure" only counts incidents someone bothered to open a Sev ticket for, the rate measures *ticketing discipline*, not quality. I'd also check it against the recovery time — a suspiciously low CFR often pairs with a long recovery, which usually means they batch large, infrequent releases (fewer "deploys," each one riskier), the exact pattern DORA shows correlates with *worse* outcomes. The number alone is uninterpretable without volume and definition.

### Q1.3 — "Moving fast means accepting more failures — it's a trade-off." Do you agree?

> **Testing:** The single most important finding in the DORA research, and whether you've internalized it.

**A.** No — and this is the headline result of the DORA program. Across years of data, the high performers are **not** trading stability for speed; they score *better on both at once*. Throughput (deploy frequency, lead time) and stability (CFR, restore time) are **positively correlated**, not opposed. The mechanism: the practices that make you fast — small batch sizes, continuous integration, automated testing, trunk-based development, fast rollback — are the *same* practices that make you stable. A small change is easier to test, easier to reason about, and easier to revert than a quarterly mega-release. So the framing "speed vs stability" is a false trade-off; the real axis is *batch size and engineering discipline*, and improving it moves all four metrics together. The teams that *do* see a trade-off are usually missing the safety net (no automated tests, no instant rollback), so for them more speed genuinely is more risk — which is a signal to invest in the net, not to slow down.

### Q1.4 — Why does DORA emphasize the *distribution* (the elite/high/medium/low bands) rather than a single target number?

> **Testing:** Whether you understand DORA as a benchmark for *trends and clustering*, not an absolute scorecard.

**A.** Because the absolute numbers only mean something relative to context and to your own past. The bands (elite/high/medium/low) exist so a team can locate itself and see which *cluster of practices* tends to move it up — they're a diagnostic, not a quota. Chasing a specific CFR or lead-time number as a target invites gaming (Goodhart); using the bands to ask "what do elite teams do differently" drives the practice changes that actually improve delivery. The right use is **track your own four metrics over time and watch them move together**, with the bands as a sanity check on where you stand industry-wide.

---

## Theme 2 — Availability and the Nines

### Q2.1 — Write the availability formula and explain each term.

> **Testing:** Whether you can derive availability from first principles, not just recite "three nines."

**A.** Steady-state availability is:

```
Availability = MTBF / (MTBF + MTTR)
```

- **MTBF** (Mean Time Between Failures) — average uptime between consecutive failures; the *reliability* term.
- **MTTR** (Mean Time To Repair/Restore) — average time to recover once failed; the *recoverability* term.

The denominator `MTBF + MTTR` is the full cycle (up period + down period), so the ratio is just "fraction of the cycle spent working." The insight this formula forces: you can hit a target availability by pushing *either* term. Doubling MTBF (fail half as often) and halving MTTR (recover twice as fast) improve availability by the *same amount*. For most software systems MTTR is the cheaper lever — you can't easily stop failures, but you can invest in fast detection and rollback — which is why mature orgs obsess over recovery speed, not just prevention.

### Q2.2 — Translate the nines into downtime. How much downtime does each nine allow per year?

> **Testing:** Whether you actually know the table — this is a near-universal warm-up.

**A.** Per **year** (≈8,760 hours), approximately:

| Availability | "Nines" | Downtime / year | Downtime / month (30d) |
|---|---|---|---|
| 90% | one nine | ~36.5 days | ~72 hours |
| 99% | two nines | ~3.65 days | ~7.2 hours |
| 99.9% | three nines | ~8.77 hours | ~43.8 minutes |
| 99.95% | three-and-a-half | ~4.38 hours | ~21.9 minutes |
| 99.99% | four nines | ~52.6 minutes | ~4.38 minutes |
| 99.999% | five nines | ~5.26 minutes | ~26 seconds |

The mental shortcut: each added nine cuts allowed downtime by **10×**. The senior point to volunteer: **the cost of each nine rises roughly an order of magnitude** — going from three to four nines might mean multi-region failover, automated remediation, and a much larger on-call investment. So "what availability do we need" is really "what downtime can the *business* tolerate, and is the next nine worth its cost." Five nines (26 seconds/year) is essentially incompatible with any human-in-the-loop recovery — it demands fully automated failover.

### Q2.3 — Why is raw uptime a poor SLI for a modern service?

> **Testing:** Whether you see past the "is the box up" model to user-perceived reliability.

**A.** Because "the server process is up" and "users are getting correct, fast responses" are different things, and uptime only measures the first. A service can be 100% "up" by a ping check while: returning 500s to 30% of requests, serving p99 latencies of 10 seconds, or being up in a region none of your users are in. Uptime is **binary and host-centric**; modern reliability is **proportional and user-centric**. The better SLIs are *ratios of good events to valid events* measured at the user's vantage point — success rate (fraction of requests served without error), latency (fraction served under a threshold), correctness, freshness. "The fraction of requests that succeeded within 300 ms" tells you about user experience in a way "the host responded to a health check" never can. Uptime also can't express *partial* degradation, which is the most common real-world failure mode — not "down," but "bad for some users."

### Q2.4 — If a dependency is 99.9% available and you call it on every request, what's the *ceiling* on your own availability — and how do you beat it?

> **Testing:** Composition of availability and basic resilience design.

**A.** For independent serial dependencies, availabilities **multiply**. If a single hard dependency is 99.9% and you can't serve a request without it, your ceiling is **99.9%** — and if you have three such independent dependencies each at 99.9%, you're capped near `0.999³ ≈ 99.7%`. You can't be more available than the weakest thing you *hard*-depend on. You beat the ceiling by removing the hard dependency from the request path: **caching** (serve stale on dependency failure), **graceful degradation** (return a reduced but valid response), **redundancy** (replicas so the *combined* availability is `1 − (1−a)ⁿ`, which rises with each replica), and **asynchrony** (move the dependency off the critical path). The framing the interviewer wants: availability is *composed*, so reliability is an architecture problem, not just an ops problem.

---

## Theme 3 — SLI, SLO, SLA, and Error Budgets

### Q3.1 — Define SLI, SLO, and SLA, and give the relationship between them.

> **Testing:** The core vocabulary — and whether you keep the three crisply separate.

**A.** Three layers, narrowest to widest blast radius:

- **SLI** (Service *Level Indicator*) — the **measurement**: a quantified ratio of *good events to valid events*, e.g. "proportion of HTTP requests that returned non-5xx within 300 ms." It's a number you compute from telemetry.
- **SLO** (Service *Level Objective*) — the **internal target** for that SLI over a window, e.g. "99.9% of requests succeed within 300 ms over 28 days." It's the goal you hold yourselves to.
- **SLA** (Service *Level Agreement*) — the **external contract** with customers, including **consequences** (refunds, credits) if breached.

The relationship: the SLA should be **looser** than the SLO, which is computed from SLIs. You set the SLO *stricter* than the SLA on purpose so that you breach your internal alarm and have time to act *before* you breach the contract that costs money. A common shape: SLI = success rate; SLO = 99.9% internal; SLA = 99.5% contractual. SLIs are facts, SLOs are decisions, SLAs are promises with teeth.

### Q3.2 — What is an error budget, and how is it computed?

> **Testing:** The one-line formula and what it *enables*.

**A.** The **error budget** is the allowed amount of unreliability — the complement of the SLO:

```
Error budget = 1 − SLO
```

At a 99.9% SLO, the budget is **0.1%** of valid events. Over 28 days that's `0.1% × total requests` you're *allowed* to fail; if you serve 100M requests, you may fail up to 100,000 of them and still meet the objective. The point of expressing unreliability as a *budget* is that it converts a fuzzy argument ("are we reliable enough?") into a quantity you can **spend**. Below budget, you have room to take risk — ship faster, run experiments, do chaos testing. Above budget, you've overspent and reliability work takes priority. It turns "stability vs features" from a political fight into a number both sides read off the same dashboard.

### Q3.3 — Walk me through "good events" and "valid events." Why does the denominator matter so much?

> **Testing:** Whether you know an SLI is a ratio, and that the *denominator* is where most SLIs go wrong.

**A.** An SLI is `good events / valid events`. **Good events** are the ones meeting the bar (success within the latency threshold). **Valid events** are the ones that *should count* — and getting this denominator right is most of the work:

- Exclude requests that aren't your fault or aren't real: load-balancer health checks, requests that 4xx because the *client* sent garbage (a 400 isn't your reliability failing), traffic during a declared maintenance window.
- Don't accidentally exclude real failures: a request that times out and never reaches your handler still failed the user, so a server-side-only counter undercounts.

The reason the denominator matters: if you put health-check pings in the denominator, you dilute the ratio and a real outage looks smaller than it is; if you exclude legitimate failures, you flatter yourself. The discipline is to define "valid" as "events that represent a real user expecting service," measured as close to the user as practical. Two teams with the same raw errors can report wildly different SLIs purely from how they scoped "valid."

### Q3.4 — Your error budget is the policy lever. Describe the "freeze when burned" policy and why it works.

> **Testing:** Whether you understand error budgets as a *governance* mechanism, not just a metric.

**A.** The policy: while there's **budget remaining**, the team ships features at full speed and takes reasonable risks. Once the budget is **exhausted** for the window, a pre-agreed consequence kicks in — typically a **feature freeze**: no new feature releases, only reliability work (bug fixes, hardening, paying down the toil that caused the burn) until the budget recovers (either the window rolls forward or you've bought back headroom).

Why it works: it's an **automatic, depersonalized brake** agreed *in advance* by both product and engineering. When the budget blows, nobody has to win an argument about whether to slow down — the policy already decided, so the conversation is "what do we fix," not "should we care." It aligns incentives: product now has skin in reliability (a burned budget stops their roadmap), and SRE/engineering can't gold-plate reliability forever (an *under*-spent budget is a signal you're being too conservative and could ship faster). The budget makes the trade-off self-regulating instead of a recurring fight.

### Q3.5 — Why alert on *burn rate* instead of "we crossed the SLO threshold"?

> **Testing:** The most senior SLO concept — multi-window burn-rate alerting.

**A.** Because alerting the instant the SLI dips below target produces alerts that are either too noisy or too late. **Burn rate** measures *how fast you're consuming the error budget* relative to the rate that would exhaust it exactly at the window's end. A burn rate of **1** means you'll spend the whole 28-day budget right on schedule; a burn rate of **14.4** means you'll exhaust the entire 28-day budget in about **2 days** if it continues — a genuine emergency worth waking someone for.

The mature pattern is **multi-window, multi-burn-rate** alerting (from the Google SRE Workbook): pair a **fast burn** alert (e.g. burn rate ≥ 14.4 over a 1-hour window, requiring a short confirmation window) for "you're torching the budget right now, page immediately," with a **slow burn** alert (e.g. burn rate ≈ 1–3 over a multi-day window) for "a low-grade leak is quietly eating the month, open a ticket." This gives you fast detection of acute outages *and* detection of slow erosion, while the dual-window requirement suppresses the false pages a single threshold would generate. It ties alerting directly to *user-facing budget consumption* rather than to arbitrary resource thresholds like "CPU > 80%," which may not correlate with any user pain at all.

---

## Theme 4 — The MTTR Critique

### Q4.1 — MTTR is on every reliability dashboard. Make the case that it's a *misleading* metric.

> **Testing:** Whether you can critique a metric everyone treats as sacred — the mark of a senior who's read the literature.

**A.** MTTR — mean time to restore — is misleading for three compounding reasons, and the critique is well-established (John Allspaw, Štěpán Davidovič's Google study, Courtney Nash's VOID report all land here):

1. **Incident durations are heavy-tailed, so the mean is meaningless.** Recovery times aren't normally distributed — they're closer to log-normal or power-law: lots of short incidents and a few enormous ones. The *mean* of a heavy-tailed distribution is dominated by the tail and is wildly unstable; a single 30-hour incident swamps fifty 10-minute ones. Reporting the mean of a distribution where the mean isn't a representative value is just bad statistics.
2. **The sample size is tiny.** Most teams have a handful of real incidents per quarter. Computing a "mean" (let alone comparing it month-over-month) from `n = 4` is noise dressed as signal — the standard error is so large that quarter-to-quarter "improvements" are almost always random.
3. **It collapses fundamentally different events into one number.** A config typo fixed in 90 seconds and a multi-team data-corruption incident are *categorically* different work, but MTTR averages them as if they're samples of the same process. There's no single underlying "repair process" whose mean is worth estimating.

Davidovič's analysis went further: with realistic incident data, MTTR often **can't even reliably distinguish** whether an intervention (a new tool, a process change) actually improved recovery — the metric is too noisy to detect the very improvements it's used to justify.

### Q4.2 — So what should you watch *instead* of MTTR?

> **Testing:** Whether your critique is constructive — do you have a replacement, or just complaints?

**A.** Watch the **distribution and the cost**, not the mean:

- **Plot the full distribution** of recovery times (a histogram or CDF), and track **percentiles** — p50, p90, p99 — and the **count of incidents beyond a threshold** (e.g. "how many incidents exceeded 1 hour this quarter"). The tail is where the user pain and the business cost live, and percentiles are stable in a way the mean isn't.
- Measure **cost/impact directly**: customer-minutes affected, revenue impacted, error budget burned. "How much did unreliability *cost* us" is more decision-relevant than "what was our average repair time."
- Do **qualitative review** of the tail incidents — the long ones are where the organizational learning is, and a blameless retrospective on a single 30-hour outage teaches more than any movement in the mean.

The reframe: stop trying to optimize a single average and start understanding the *shape* of your incidents and what the bad tail is costing you. DORA's own rename — from "Mean Time to Restore" to "**Failed Deployment Recovery Time**", reported as a distribution band — is a quiet acknowledgment that the *mean* framing was a mistake.

### Q4.3 — A VP says "our MTTR dropped 40% this quarter — great work." What do you say?

> **Testing:** Whether you can challenge a flattering-but-meaningless number diplomatically.

**A.** I'd be genuinely curious before celebrating: "How many incidents was that across? If it's single digits, a 40% move is well inside the noise — one fewer long incident this quarter would do it without anything actually changing." Then I'd check whether the *distribution* improved, not just the mean: did our p90 recovery come down, or did we just happen to avoid a long-tail incident this quarter? And I'd ask whether the *definition* shifted — did we start classifying some events as non-incidents, which mechanically lowers the average? The constructive move is to redirect the celebration toward something real: "Let's look at the histogram and the number of incidents over an hour — if *those* improved, we've genuinely gotten better at recovery." Done carelessly this sounds like raining on a parade; done well it protects the team from chasing a phantom.

---

## Theme 5 — Quality Metrics

### Q5.1 — What is escaped-defect rate, and why is it one of the more honest quality metrics?

> **Testing:** Whether you measure quality by *outcome* (what reached users) rather than by activity.

**A.** **Escaped-defect rate** (a.k.a. defect escape rate) is the fraction of defects that **escaped to production / customers** rather than being caught earlier — typically `defects found in production ÷ total defects found (pre- + post-release)` over a window. It's honest because it measures the thing that actually matters — *did the bug reach the user* — rather than activity proxies like "number of tests" or "bugs filed." It directly evaluates the effectiveness of your whole pre-production net (review, CI, QA, staging): a rising escape rate says defects are slipping past your gates, regardless of how busy those gates look. It also resists one common gaming vector: you can pad your test count without improving anything, but you can't easily fake "fewer bugs reached customers." The caveat to volunteer: it depends on *finding* and attributing production defects, so a team that's bad at detecting prod issues can show an artificially low escape rate — silence isn't quality.

### Q5.2 — Your manager wants to track defect density (bugs per KLOC) across teams and rank them. What are the caveats?

> **Testing:** Whether you know why defect density is a dangerous *comparison* metric.

**A.** Defect density = `defects ÷ thousand lines of code`. As a within-team *trend* it's mildly useful; as a *cross-team ranking* it's actively misleading, for several reasons:

1. **The denominator is gameable and meaningless.** LOC is not a measure of functionality — verbose code lowers density, terse code raises it, and you can cut "density" by writing *more* code, which is the opposite of what you want. The instant density becomes a target, people optimize the denominator.
2. **It conflates discovery with creation.** A team that *finds* lots of bugs (good testing) looks worse than a team that ships them blind. You'd be rewarding the team with the *worse* net.
3. **Not all defects are equal.** A crash and a typo count the same; density treats a Sev1 and a cosmetic glitch as one "defect" each, so the number says nothing about *severity-weighted* risk.
4. **No control for complexity or domain.** A flight-control module and a marketing landing page have different inherent defect rates; ranking them on the same scale is nonsense.

The senior framing: defect density is a **descriptive** metric for one codebase over time at best, and using it to rank teams is a textbook Goodhart trap — it'll drive code bloat, suppressed bug reporting, and severity-gaming. If you must measure quality comparatively, prefer outcome metrics (escaped defects, customer-impacting incidents, error-budget burn) and treat them as conversation-starters, not scorecards.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — Set an SLO for a checkout service. Walk me through it.

> **Testing:** The whole stack applied end-to-end — and whether you start from the *user journey*, not a number.

**A.** I'd work it in this order, because jumping to "99.99%" first is the classic mistake:

1. **Identify the critical user journey, not the service.** Checkout's job is "the user can complete a purchase." So the journey is *add-to-cart → payment → order confirmation*. I'm setting an SLO on *that flow's* success as the user sees it, not on a single microservice's uptime.
2. **Choose SLIs that reflect the journey.** Two at minimum: **availability/success rate** — "fraction of checkout attempts that complete without a server-side error" — and **latency** — "fraction of payment submissions that confirm within, say, 3 seconds." For checkout I'd also consider a **correctness** SLI (no double-charges, no lost orders), because a *wrong* success is worse than a clean failure here.
3. **Pick targets from business tolerance, working backward from cost.** Checkout is revenue-critical, so it warrants a high bar — say **99.95%** success — but I'd justify it by what a failed checkout *costs* and what the next nine *costs to build*, not by reflex. I'd resist 99.999%: it's wildly expensive and probably exceeds what the upstream payment processor even offers, which caps me anyway (availability composes).
4. **Derive the error budget:** `1 − 0.9995 = 0.05%`. Over 28 days and N checkouts, that's my allowance — concrete and spendable.
5. **Set the SLA looser than the SLO** (e.g. 99.9% contractual) so internal alarms fire before contractual penalties.
6. **Define good/valid events carefully:** exclude client-caused 4xx (bad card details are the user's failure, not mine) and synthetic health checks; *include* timeouts and downstream-payment failures that the user experiences as "checkout broke."
7. **Wire up burn-rate alerts** (fast-burn page + slow-burn ticket) and the **error-budget policy** (what freezes when it's gone).

The thread throughout: every choice traces back to *what the user is trying to do and what failure costs the business*, not to an aesthetically pleasing number of nines.

### Q6.2 — It's mid-quarter and your error budget is fully exhausted. What happens now?

> **Testing:** Whether you treat the budget as a real governance lever, not a vanity metric.

**A.** The pre-agreed **error-budget policy** triggers — and the value is that this was decided *before* the crisis, so there's no negotiation under pressure. Concretely:

1. **Feature releases stop**; the team pivots to reliability work — fix the root causes that burned the budget, harden the weak paths, pay down the toil. This holds until the rolling window recovers headroom or we've bought it back.
2. **Run a real retrospective on what consumed the budget** — usually it's one or two incident classes, and the budget is a forcing function to actually fix them rather than route around them.
3. **Communicate the freeze to stakeholders** using the budget as the neutral justification: "we're over budget, the policy we all agreed to says reliability comes first until we recover." Product can be unhappy with the *situation* but can't relitigate the *rule*.
4. If this keeps happening, the budget is also telling me the **SLO might be miscalibrated** (too strict for the architecture/investment) — a chronically blown budget is a signal to either invest more in reliability or, deliberately and with stakeholder buy-in, *relax the target* to one the system can actually hold. What you don't do is quietly ignore the breach, because the moment the budget has no teeth, it stops aligning anyone.

The senior note: an exhausted budget is *working as designed* — it's the brake engaging. The failure mode isn't hitting the limit; it's having a limit nobody honors.

### Q6.3 — A stakeholder asks for 100% availability. Is that a good target?

> **Testing:** Whether you can push back on an intuitively-appealing but wrong goal with real reasoning.

**A.** No — 100% is the wrong target, and saying so confidently is the point. Three reasons:

1. **It's unachievable and the cost curve is asymptotic.** Each nine costs roughly an order of magnitude more, and the *last* fraction of a percent is effectively infinite cost — you'd be chasing perfection past the point of any business return.
2. **It's the wrong target even in principle.** Google's SRE argument: **100% is almost never the right reliability target** because *users can't tell the difference* between 100% and, say, 99.99%, since their own ISP, device, Wi-Fi, and DNS already inject more unreliability than that. Engineering past the point the user can perceive is pure waste — you're buying nines nobody experiences.
3. **A 100% SLO means a zero error budget**, which means you can *never* deploy, experiment, or take any risk — it freezes the product permanently. The whole value of an error budget is that a *little* unreliability is the currency that buys you velocity; setting it to zero forfeits that.

The constructive reframe: "What's the right target?" is a *business* question — "how much downtime can our users and revenue actually tolerate?" — answered with a deliberately-chosen SLO (say 99.9% or 99.95%) and an error budget you intend to *spend*. The goal isn't maximum reliability; it's *adequate* reliability at sustainable cost, with the leftover budget spent on shipping.

---

## Theme 7 — Program and Gaming

### Q7.1 — Two teams report "MTTR" but their numbers aren't comparable. Why? Start with the definition of an incident.

> **Testing:** Whether you see that metric comparison requires a shared *definition*, and incidents are the slipperiest one.

**A.** Because "**incident**" has no universal definition, so the two teams are measuring different populations and a shared *word* hides it. Team A might open an incident for any customer-visible error lasting over a minute; Team B only declares an incident at Sev2+ after a formal page. The clock-start and clock-stop differ too: does the timer begin at *detection*, at the *failure's actual onset* (often earlier, discovered post-hoc), or at *acknowledgement*? Does it stop at *mitigation* (users okay again) or at *full resolution* (root cause fixed)? Each choice can move the number by an order of magnitude. So before comparing any reliability metric across teams, I'd insist on a **shared, written definition**: what counts as an incident, what severities are in scope, and exactly when the clock starts and stops. Without that, you're comparing two different measurements that happen to share a label — and any ranking built on it is fiction.

### Q7.2 — How would a team *game* MTTR, and what would tip you off?

> **Testing:** Goodhart's law applied to recovery time — whether you can think like someone under a bad incentive.

**A.** The easiest gaming vector is **severity reclassification**: if MTTR is computed only over Sev1/Sev2 incidents, downgrade the long, ugly ones to Sev3 so they fall out of the calculation, and the average drops without any real improvement. Other vectors: **stop the clock at "mitigated" but leave the underlying problem festering** (the metric looks great while users still suffer intermittently); **declare incidents resolved prematurely** and reopen under a new ID (splitting one long incident into several short ones); or simply **stop opening incidents for messy events** so only the quick wins get recorded. What tips me off: a falling MTTR while *customer complaints or error-budget burn rise* (the canonical Goodhart divergence — the proxy improves while the goal worsens); a sudden shift in the **severity distribution** (more Sev3s, fewer Sev1s, same underlying reality); a cluster of incidents resolved suspiciously close to a reporting threshold; or "resolved" incidents that quietly reopen. The defense is to **measure the goal alongside the proxy** (customer impact, budget burn) and watch for them diverging, and to **never tie compensation or rank to MTTR** — the moment it's a target, it stops being a measure.

### Q7.3 — What is "reliability theater," and how do you spot it?

> **Testing:** Whether you can distinguish real reliability work from its performance.

**A.** **Reliability theater** is activity that *looks* like reliability engineering but doesn't change the user's experience — the metrics-and-process equivalent of security theater. Symptoms: dashboards full of green SLIs that don't track any real user journey (measuring host uptime while users see errors); SLOs set so loose they can never be breached (so they never trigger anything and provide no signal); error budgets that are reported but whose policy is never *enforced* (the budget blows and nothing happens); postmortems written, filed, and never acted on; an on-call rotation that exists but whose alerts are 90% noise nobody trusts. How I spot it: I ask *"when did this last change a decision?"* — when did an SLO breach actually stop a release, when did a postmortem action item actually ship, when did the error budget actually freeze a feature. If the honest answer is "never," the apparatus is theater. Real reliability practice is *load-bearing*: the metrics cause behavior to change. Theater is the apparatus without the consequences — and it's worse than nothing, because it manufactures false confidence.

### Q7.4 — Leadership wants to put one of these metrics on individual performance reviews. Your take?

> **Testing:** Whether you understand that turning a system metric into a personal target destroys it.

**A.** I'd push back hard. These are **system-health metrics**, and the moment any of them becomes an *individual* target, Goodhart's law guarantees it gets optimized at the expense of the actual goal: tie deploy frequency to reviews and people fragment one change into ten trivial deploys; tie CFR to reviews and people stop deploying or stop reporting failures; tie MTTR to reviews and you get the severity-reclassification gaming above. You also corrode the **blameless** culture that makes incident learning possible — if my recovery time hits my bonus, I'm incentivized to hide incidents, not surface and learn from them, which makes the whole system *less* reliable. The right posture, straight from the DORA guidance: use these metrics at the **team/system level** to drive *conversations and process improvement*, never as individual performance KPIs. They're a thermometer for the system, and you don't improve a patient's health by punishing the thermometer.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Error budget formula?** A: `1 − SLO`. At 99.9% SLO the budget is 0.1% of valid events.
- **Q: Availability formula?** A: `MTBF / (MTBF + MTTR)` — uptime fraction of the up+down cycle.
- **Q: Downtime allowed by three nines per year?** A: ~8.77 hours (99.9%).
- **Q: Downtime allowed by four nines per year?** A: ~52.6 minutes (99.99%).
- **Q: SLI vs SLO vs SLA in one line?** A: SLI = the measurement, SLO = internal target, SLA = external contract with penalties.
- **Q: Which should be stricter, SLO or SLA?** A: The SLO — so you breach your internal alarm before the contractual one that costs money.
- **Q: An SLI is a ratio of what to what?** A: Good events to *valid* events.
- **Q: The two DORA stability metrics?** A: Change Failure Rate and Failed Deployment Recovery Time (time to restore).
- **Q: Elite CFR band?** A: 0–15%.
- **Q: Elite time-to-restore?** A: Under one hour.
- **Q: Is speed traded against stability in DORA?** A: No — they're positively correlated; the same practices drive both.
- **Q: One reason MTTR misleads?** A: Incident durations are heavy-tailed, so the mean isn't representative (also: tiny samples).
- **Q: What to watch instead of MTTR mean?** A: The distribution — percentiles (p90/p99), count over a threshold, and cost/impact.
- **Q: What's a burn rate of 1?** A: You'll spend the entire error budget exactly at the window's end.
- **Q: Why multi-window burn-rate alerts?** A: Fast-burn pages on acute outages; slow-burn tickets on quiet erosion; dual windows cut false pages.
- **Q: Why is 100% availability the wrong target?** A: Infinite cost, users can't perceive it past their own ISP/device noise, and a zero error budget means you can never ship.
- **Q: Escaped-defect rate measures what?** A: The fraction of defects that reached production rather than being caught pre-release.
- **Q: Biggest caveat on defect density?** A: LOC is a gameable, meaningless denominator — never rank teams by it.
- **Q: How is MTTR most easily gamed?** A: Reclassifying long incidents to a severity that's excluded from the calculation.
- **Q: Where should DORA/SLO metrics live — individual or team?** A: Team/system level only; individual KPIs trigger Goodhart gaming and kill blameless culture.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Quoting a CFR or MTTR without asking about volume, sample size, or the definition of "failure"/"incident."
- Believing speed and stability are a trade-off — missing DORA's central finding.
- Reciting `1 − SLO` but unable to say what the budget is *for* (governance, spendable risk).
- Treating MTTR's mean as gospel — no awareness of heavy tails or tiny samples.
- Choosing an availability target by aesthetics ("let's do four nines") rather than business tolerance and cost.
- Defending 100% availability, or any zero-error-budget SLO.
- Putting uptime forward as the primary SLI; conflating "host is up" with "users are served."
- Proposing these metrics as individual performance KPIs.

**Green flags:**
- Naming the *distinction* (rate vs duration, SLI/SLO/SLA, mean vs distribution, metric vs goal) before doing arithmetic.
- Doing the nines→downtime math from memory and noting each nine costs ~10×.
- Volunteering the *caveat* — how each metric lies — before being pushed (MTTR's tail, defect density's denominator, escaped-defect detection gap).
- Starting an SLO from the **user journey** and **business cost**, then deriving the budget.
- Treating the error budget as a real policy lever with a pre-agreed freeze, and reading an under-spent budget as "ship faster."
- Citing the SRE-canon reasons 100% is wrong (user can't perceive it; zero budget freezes the product).
- Spotting Goodhart/gaming vectors and insisting the *goal* be measured alongside the *proxy*.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **rate vs duration** (CFR vs restore time), the **SLI/SLO/SLA stack**, **mean vs distribution** (the MTTR critique), and **the metric vs the goal** (Goodhart). Name the distinction first; the arithmetic follows.
- **Stability metrics:** CFR is a *rate* (failures ÷ deploys; elite 0–15%), restore time is a *duration* (onset→recovery; elite under an hour). DORA's central finding is that speed and stability are **positively correlated** — small batches and discipline move all four metrics together; there is no trade-off.
- **Availability:** `MTBF / (MTBF + MTTR)`; each nine cuts allowed downtime 10× (three nines ≈ 8.77 h/yr, four ≈ 52.6 min/yr) and costs ~10× more. Raw uptime is a poor SLI — prefer user-centric ratios of good to valid events; availability *composes* across hard dependencies.
- **SLI/SLO/SLA and budgets:** SLI = measurement, SLO = internal target, SLA = external promise (SLO stricter than SLA). Error budget = `1 − SLO` — spendable risk; the freeze-when-burned policy makes the speed/stability trade-off self-regulating. Get the *valid-events* denominator right, and alert on **burn rate** (multi-window: fast-burn page + slow-burn ticket), not raw thresholds.
- **The MTTR critique:** the mean of heavy-tailed durations over tiny samples is noise that can't even detect the improvements it's cited for — watch the **distribution**, **percentiles**, **count over threshold**, and **cost** instead.
- **Quality metrics:** escaped-defect rate is honest because it measures what reached the user; defect density is a gameable, complexity-blind denominator that must never rank teams.
- **Program/gaming:** define "incident" and the clock precisely or cross-team comparison is fiction; MTTR is gamed by severity reclassification; "reliability theater" is the apparatus without consequences — real metrics *change decisions*, and they belong at the team level, never on individual reviews.

---

## Further Reading

- *Site Reliability Engineering* and *The SRE Workbook* (Google) — the canonical treatment of SLIs, SLOs, error budgets, and multi-window burn-rate alerting; the source of "100% is the wrong target."
- *Accelerate* (Forsgren, Humble, Kim) and the annual **DORA / State of DevOps** reports — the four key metrics, the performance bands, and the speed-stability correlation.
- "Incident Metrics in SRE" (Štěpán Davidovič, Google) and the **VOID report** (Courtney Nash) — the rigorous case that MTTR is statistically unsound; read these before defending MTTR.
- John Allspaw on MTTR and the heavy-tailed nature of incidents — the practitioner critique.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [01 — DORA Four Key Metrics](../01-dora-four-key-metrics/interview.md) — the throughput half of the four, and how the stability metrics here fit the full set.
- [06 — Metrics Anti-Patterns and Goodhart](../06-metrics-anti-patterns-and-goodhart/interview.md) — the gaming and theater questions, generalized into the law that governs all of them.
- [Engineering Metrics & DORA README](../README.md) — where reliability metrics sit in the broader measurement landscape.
