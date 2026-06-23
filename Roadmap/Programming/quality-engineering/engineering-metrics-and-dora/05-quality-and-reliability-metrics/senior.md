# Quality & Reliability Metrics — Senior Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → [Quality & Reliability Metrics](../README.md) → Senior
> *The middle page taught you the four reliability numbers and how to wire them up. This page is about the discipline behind them: how to define an SLI that survives a real outage, why a single error-budget threshold is the wrong alert, why the industry's favourite recovery metric — MTTR — is mostly noise, and why "you must trade speed for stability" is a finding the data contradicts.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [SLIs Done Right — The Good-Events / Valid-Events Formulation](#slis-done-right--the-good-events--valid-events-formulation)
4. [Reliability Is a Distribution, Not a Point](#reliability-is-a-distribution-not-a-point)
5. [Error Budgets and the Burn-Rate View](#error-budgets-and-the-burn-rate-view)
6. [Multi-Window, Multi-Burn-Rate Alerting](#multi-window-multi-burn-rate-alerting)
7. [The MTTR Critique — Why the Mean Lies](#the-mttr-critique--why-the-mean-lies)
8. [Speed and Stability Move Together](#speed-and-stability-move-together)
9. [Defect Metrics With Rigor — Escape Rate, DDP, and the Density Trap](#defect-metrics-with-rigor--escape-rate-ddp-and-the-density-trap)
10. [Composing a Balanced Reliability Scorecard Without Gaming](#composing-a-balanced-reliability-scorecard-without-gaming)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The measurement discipline an SRE actually practises, and the statistics that make reliability numbers trustworthy instead of theatrical.**

By the middle level you can compute change failure rate, recovery time, and a basic availability SLO; you can draw a burn-down of an error budget. That gets you a dashboard. The senior jump is statistical and definitional: you now decide *what to measure such that the number means something*, and you defend those definitions against the two failure modes that plague reliability metrics — **measuring the wrong event** and **summarising a skewed distribution with a mean**.

This matters because reliability data is unusually hostile to naive statistics. Request outcomes are events you must define carefully (what is a "good" request? what is a "valid" one?). Latency is a heavy-tailed distribution where the average is a lie and the tail is the product. Incident durations are *extremely* heavy-tailed and sampled in the dozens, which makes their mean — the celebrated **MTTR** — statistically meaningless. And the relationship everyone assumes between shipping fast and staying stable turns out, in the research, to be the *opposite* of the folk model. A senior owns these subtleties; the four-keys framing glosses every one of them.

---

## Prerequisites

- **Required:** You've internalised [middle.md](middle.md) — change failure rate, recovery time, a basic SLI/SLO/error-budget loop, and percentile latency.
- **Required:** You're comfortable with [01 — The DORA Four Keys](../01-dora-four-key-metrics/senior.md), especially CFR and time-to-restore as *stability* metrics.
- **Helpful:** Working intuition for distributions — mean vs median vs tail, variance, and what "heavy-tailed" does to an average.
- **Helpful:** You've been on call and watched an alert fire too late, or far too often, for the same underlying budget.

---

## SLIs Done Right — The Good-Events / Valid-Events Formulation

A **Service Level Indicator** is a *quantitative measure of some aspect of the service*, expressed as a number between 0 and 100%. The single most useful pattern from the Google SRE practice is to define almost every SLI as a **ratio of good events to valid events**:

```
SLI = good events / valid events × 100%
```

This formulation is deceptively powerful. It forces three decisions that vague availability talk lets you skip:

1. **What is an *event*?** A request? A queue message processed? A scheduled job run? A data-freshness check? Picking the event is picking what reliability *means* for this service.
2. **What makes an event *good*?** A `2xx`/`3xx` response — or one that is *also* under a latency threshold? A job that completed *and* produced correct output?
3. **What makes an event *valid* (in the denominator)?** Crucially, this lets you *exclude* events you should not be judged on — health-check pings, load-balancer probes, requests rejected as malformed `4xx` from a misbehaving client, traffic during a planned maintenance window. A `400` because the caller sent garbage is not your unreliability.

Contrast the dominant categories of SLI:

| SLI type | Good event | Valid event | Typical use |
|---|---|---|---|
| **Availability (request-success)** | request with a non-error response | all served, non-excluded requests | request/response services |
| **Latency** | request served faster than threshold T | all served requests | "fast enough" as a reliability property |
| **Quality / correctness** | response served at full fidelity (not degraded) | all served requests | graceful-degradation systems |
| **Freshness** | data younger than threshold | all data items / reads | pipelines, caches, replicas |
| **Throughput / correctness** | records processed correctly | records that should be processed | batch and streaming pipelines |

### Why request-success beats availability-as-uptime

The folk definition of availability is **uptime**: `time_up / total_time`, derived from a black-box ping ("is the host responding?"). For a modern distributed service this is a *weak* SLI, for concrete reasons:

- **"Up" is not binary at the edge.** A service behind a load balancer with fifty replicas is never wholly up or down; it's serving 99.2% of requests successfully while 0.8% hit a bad shard. Uptime can't express "mostly working."
- **Uptime measures the *prober's* experience, not the user's.** Your health check hits `/healthz` and gets `200` while real users on a specific route get `500`. Uptime says 100%; users disagree.
- **It can't weight by traffic.** A 30-second blip at 03:00 (10 requests) and a 30-second blip at peak (100,000 requests) are identical to a time-based uptime metric and wildly different to your users. Request-success SLIs are *intrinsically traffic-weighted* — they count the requests that actually happened.
- **Time-based SLOs hide the unit of harm.** "Three nines" as 8.76 hours/year of "downtime" invites the question "downtime *of what*?" The good/valid-events ratio answers it directly: 99.9% of requests succeeded.

So the modern default for a request/response service is **request-success rate** (and a **latency SLI**), not host uptime. Uptime survives where it genuinely models the user experience — a single-tenant appliance, a VPN endpoint — but for a sharded, replicated service it is the wrong indicator.

> **Key insight:** The good/valid-events ratio is not notation — it is a forcing function. By making you name the event, the success criterion, and the *exclusion* criterion, it converts the hand-wavy word "available" into a measurement you can defend in a postmortem. Most bad SLIs are bad because someone skipped one of those three decisions.

---

## Reliability Is a Distribution, Not a Point

The deepest reframing at this level: **reliability is a distribution, and most reliability metrics are summary statistics of that distribution — so the choice of summary statistic *is* the metric design.**

### Latency: the average is a lie

Service latency is right-skewed and heavy-tailed: most requests are fast, a long tail is slow (GC pauses, cold caches, lock contention, retried calls, a slow downstream). On such a distribution the **mean is dominated by the tail and the median hides it** — both mislead. That is why latency SLOs are written on **percentiles**:

```
p50  = median           "typical" request
p90 / p95               where the experience starts to degrade
p99 / p99.9             the tail — power users, fan-out, and the angriest tickets
```

Two facts a senior keeps in hand:

- **Tail latency is amplified by fan-out.** If a single user request fans out to 100 backends and waits for all, the *user-visible* latency is roughly the **max** of 100 samples — so a backend p99 becomes a user-facing near-certainty. Formally, the chance all 100 are under p99 is `0.99^100 ≈ 37%`; about **63%** of such requests touch at least one p99-tail backend. This is the core argument of Dean & Barroso's *The Tail at Scale*: at scale the tail is the common case.
- **Percentiles do not average and do not add.** You cannot average p99s across hosts, time buckets, or services to get a meaningful aggregate p99 — that requires merging the underlying distributions (e.g. histograms / t-digests). Averaging precomputed percentiles is one of the most common silent errors in monitoring.

Express a latency SLO as a **good/valid-events** ratio over a threshold, which sidesteps the averaging problem entirely:

```
99% of requests served in < 300 ms  (over 28 days)
  good  = requests with latency < 300 ms
  valid = all served requests
```

That is a *count* of fast vs total requests — countable, traffic-weighted, and aggregable, where a raw "p99 = 290 ms" is none of those once you try to combine windows.

### Availability: over what window?

"99.9% available" is meaningless until you state the **window** it's measured over, because the same nines mean very different things at different horizons:

| SLO | Per **30 days** | Per **90 days** (quarter) | Per **365 days** |
|---|---|---|---|
| 99.9% ("three nines") | ~43 min budget | ~2.16 h | ~8.76 h |
| 99.95% | ~21.6 min | ~1.08 h | ~4.38 h |
| 99.99% ("four nines") | ~4.3 min | ~13 min | ~52.6 min |

Three consequences:

- **A short window is volatile; a long window is forgiving but slow to react.** A single 20-minute outage blows a *daily* 99.9% budget entirely but is a rounding error against an *annual* one. Pick the window to match how you want to react — most teams use a **rolling 28- or 30-day** window for the budget that gates releases.
- **Rolling vs calendar matters.** A calendar-quarter budget resets on the 1st (and tempts end-of-quarter risk-taking); a rolling 30-day window has no reset and so no cliff — generally the better default.
- **The budget is the inverse of the SLO**, and that's the number you actually manage: a 99.9% / 30-day SLO yields ~43 minutes (time-based) or 0.1% of requests (event-based) of *permitted* failure. That budget is the bridge to the next section.

> **Key insight:** Every reliability number you report is a summary of a skewed distribution. Latency lives or dies on percentiles (and percentiles don't average); availability is undefined without a window. The discipline is to *always state the statistic and the window*, and to treat any single-number reliability claim ("we're 99.9%", "p99 is fine") as incomplete until both are pinned down.

---

## Error Budgets and the Burn-Rate View

An **error budget** is the permitted unreliability: `100% − SLO`. A 99.9% SLO grants a 0.1% budget. Its purpose is organisational, not arithmetic — it turns reliability into a *currency* that both product and SRE spend, and it ends the sterile "ship features vs stay stable" argument by making the trade-off explicit and bounded: you may take risk *while there is budget*, and you stop taking risk *when there isn't*.

To alert on a budget you reason about **burn rate** — how fast you are consuming it relative to the rate that would exactly exhaust it over the SLO window.

```
burn rate = (observed error rate) / (budget error rate)
          = (observed error rate) / (1 − SLO)
```

A burn rate of **1** spends the entire budget exactly at the end of the window (e.g. exactly 0.1% errors for a 99.9% SLO). A burn rate of **10** spends it 10× too fast. The link between burn rate and time-to-exhaustion is direct:

```
time to exhaust budget = SLO window / burn rate
```

For a 30-day window:

| Burn rate | Error rate (for 99.9% SLO) | Budget consumed in 1 h | Time to exhaust full budget |
|---|---|---|---|
| 1× | 0.1% | ~0.14% | 30 days |
| 10× | 1% | ~1.4% | 3 days |
| 14.4× | 1.44% | 2% | ~50 hours |
| 100× | 10% | ~14% | ~7.2 hours |
| 1000× | 100% (total outage) | 100% (≈43 min) | ~43 minutes |

The right-hand column is the whole point: **a high burn rate is an early-warning that you will breach the SLO long before the window closes.** Alerting on burn rate, rather than on the raw error count or on "budget < X% remaining," gives you a *rate of change* — and rates of change are what let you intervene in time.

> **Key insight:** Don't alert on the budget level ("10% remaining") — that's a lagging, after-the-fact signal that says nothing about *how fast* you're falling. Alert on the **burn rate**, which is the derivative: it tells you whether the current trajectory will breach the SLO and roughly when. The level is the fuel gauge; the burn rate is the rate the needle is dropping.

---

## Multi-Window, Multi-Burn-Rate Alerting

Naive SLO alerting picks one threshold and one window — "page if error rate > 0.1% over 5 minutes" or "page if budget burn > 2% in an hour." Both are bad, and the *why* is the senior content here.

**A single short window is too twitchy.** A 5-minute window reacts fast but fires on every transient blip — a brief dependency hiccup, a deploy-induced spike — flooding on-call with noise. High **recall**, terrible **precision**: most pages are not real, on-call learns to ignore them, and you've built alert fatigue.

**A single long window is too sluggish.** A 1-hour or 6-hour window is precise — it won't fire on a blip — but a *total outage* takes far too long to cross the threshold. Good precision, terrible **detection time** and **reset time** (after the incident clears, a long window keeps the alert firing long after recovery).

You cannot fix this with one window. The Google SRE Workbook's answer is **multi-window, multi-burn-rate** alerting, built from two ideas:

### 1. Multiple burn rates → multiple severities

Pick burn-rate thresholds so that each one corresponds to consuming a fixed, meaningful *fraction of the total budget* before it fires — and route them to different responses:

| Severity | Budget consumed | Long window | Burn rate (30-day SLO) | Response |
|---|---|---|---|---|
| **Fast burn** | 2% in 1 hour | 1 h | **14.4×** | **Page** — something is on fire now |
| **Medium burn** | 5% in 6 hours | 6 h | **6×** | **Page** (or urgent ticket) |
| **Slow burn** | 10% in 3 days | 3 days (72 h) | **~1×** | **Ticket** — chronic, fix during business hours |

A *fast* burn (14.4×) means you'll exhaust a month's budget in ~50 hours — wake someone. A *slow* burn (~1×) means a low-grade leak that, left alone, breaches the SLO at month's end — a ticket, not a 03:00 page. **Different burn rates are different problems and deserve different responses.** One threshold cannot encode that.

### 2. Two windows per alert → kill the long reset tail

For each burn-rate alert, require **both a long window and a short window** to be over threshold simultaneously. The long window gives *precision* (a real, sustained burn, not a blip); the short window (typically the long window / 12) acts as a *recency gate* so the alert **resets quickly** once the burn actually stops:

```
fire fast-burn page  IF  burn_rate(1h)  > 14.4  AND  burn_rate(5m)  > 14.4
fire slow-burn ticket IF  burn_rate(72h) > 1     AND  burn_rate(6h)  > 1
```

The short-window AND-condition is the trick that makes long windows usable: without it, a 1-hour window stays elevated for ~an hour *after* recovery (the bad minutes are still inside the window), so on-call gets paged for an already-resolved incident. With it, the moment the *recent* short window drops below threshold, the alert clears.

This gives you the property a single threshold can never have: **high precision *and* fast detection *and* fast reset, with severity proportional to how fast the budget is actually burning.**

> **Key insight:** Single-threshold SLO alerting forces an impossible choice between a twitchy short window (noise, alert fatigue) and a sluggish long window (slow detection, long reset). Multi-window multi-burn-rate dissolves the trade-off: multiple burn rates encode *severity*, and pairing each long window with a short one buys both *precision* and *fast reset*. It is the difference between an SLO that pages usefully and one that pages until everyone mutes it.

---

## The MTTR Critique — Why the Mean Lies

MTTR — usually expanded as **Mean Time To Recover/Restore/Repair** — is one of the four DORA keys (as time-to-restore-service) and the industry's default reliability headline. At the senior level you must understand the influential and well-founded argument that **MTTR is a poor, often misleading metric** — articulated sharply by Courtney Nash and the team behind Verica's *VOID* (Verica Open Incident Database) report, in the piece commonly summarised as *"MTTR is a misleading metric."*

The critique is statistical, and it is hard to refute:

**1. Incident durations are extremely heavy-tailed (often log-normal-ish, with a fat right tail).** Most incidents resolve quickly; a few drag on for hours or days. On such a distribution the **mean is dragged toward the rare long incidents** and stops describing the typical experience. The VOID's analysis of tens of thousands of real incidents found durations spanning many orders of magnitude — the textbook shape where a mean is the wrong summary.

**2. The variance is enormous, so the mean is unstable.** With durations ranging from minutes to days, the *standard deviation rivals or exceeds the mean*. A metric whose noise is as large as its signal can't tell you whether a change between two periods is improvement or chance.

**3. The sample is tiny.** Even a busy org has *dozens* of incidents per period, not thousands. A mean of a heavy-tailed variable computed from a small sample is dominated by *whether you happened to have one bad incident* — one 14-hour outage can double a quarter's MTTR while nothing about the system changed. You are, in effect, reporting the noise.

**4. Therefore quarter-over-quarter MTTR comparisons are mostly meaningless.** "MTTR dropped 20%" usually means "we got lucky on the tail this quarter," not "we recover faster." The VOID found *no clear relationship* between MTTR and other reliability signals, and warned explicitly against using it for targets or trends.

What to do instead — the senior's toolkit when someone demands "the recovery number":

- **Report the distribution, not the mean.** Show the **median (p50)** and a high percentile (**p90/p95**) of incident duration, or the full histogram. The median resists the tail; the high percentile *is* the tail you care about — and together they say far more than one mean.
- **Prefer cost-of-incident measures.** Total time-in-incident per period, count of high-severity incidents, or estimated user-impact-minutes (severity × duration × affected users) capture the *burden* without averaging wildly different events into one figure.
- **Use the data qualitatively.** The VOID's stance is that incidents are richest as *learning material* — read the long-tail incidents for systemic weaknesses; a count and a distribution beat a mean for tracking, and the narratives beat both for improving.
- **If you must keep MTTR (e.g. it's a DORA key), treat its *band*, not its value.** DORA's own framing buckets time-to-restore into broad clusters (Elite: < 1 hour; Low: weeks). The *order-of-magnitude band* is robust; the precise mean within a band is not. Use the band, never the third decimal.

> **Key insight:** MTTR is a **mean of a small sample from a heavy-tailed, high-variance distribution** — exactly the situation where the mean is least trustworthy. One unlucky long incident dominates it, so period-over-period MTTR mostly measures luck on the tail. Report the **distribution** (median + p90) or a **cost-of-incident** measure instead, and use incidents as learning, not as a single average to game. This is the senior nuance the clean four-keys story skips.

---

## Speed and Stability Move Together

The folk model of engineering is a **trade-off**: go faster and you'll break more; to be stable, slow down. The central empirical finding of the DORA / *Accelerate* research is that **this trade-off is false** — across thousands of teams, the *throughput* metrics (deployment frequency, lead time) and the *stability* metrics (change failure rate, time to restore) are **positively correlated**. Elite performers are better at *both* simultaneously; low performers are worse at both. There is no frontier you slide along; there is a capability that lifts the whole picture.

The mechanism is not magic, and a senior should be able to explain *why* the same practices raise speed and stability together:

- **Small batches reduce blast radius.** Frequent deploys mean each deploy contains *less* change, so when one fails it's faster to diagnose (less to bisect), faster to revert, and damages less. Smaller changes are *both* more frequent (speed) *and* less likely/able to cause a large failure (stability). Batch size is the hinge.
- **Fast, automated pipelines catch defects earlier.** The same CI/CD investment that shortens lead time (automated tests, fast deploys) is what *prevents* changes from failing in production. You don't buy speed and stability separately; one set of capabilities yields both.
- **Fast recovery requires the same machinery as fast delivery.** The ability to deploy quickly *is* the ability to roll back or roll forward quickly — short time-to-restore is downstream of a fast, reliable deploy path, the very thing that gives you a short lead time.
- **The loop reinforces itself.** Teams that deploy more often get more practice at deploying, more feedback, and better tooling — compounding into both higher frequency and lower failure rate. Speed and stability co-evolve.

This reframes change failure rate and time-to-restore: they are *not* the price of speed, to be traded against it. They rise and fall *with* speed under good engineering. The instinct to "slow down to be safe" is, in the data, usually counterproductive — large infrequent releases are *more* dangerous, not less. (Note the discipline: CFR is itself a ratio — failed deploys / total deploys — so deploying more does *not* mechanically inflate it; an elite team deploys far more *and* fails a smaller fraction.)

> **Key insight:** Speed and stability are *not* opposite ends of a trade-off — the *Accelerate* data shows them positively correlated, because the capability that raises deploy frequency (small batches, automation, fast feedback) is the same capability that lowers change failure rate and shortens recovery. "Slow down to be safe" optimises the wrong variable; the lever is **batch size and pipeline quality**, which move both at once.

---

## Defect Metrics With Rigor — Escape Rate, DDP, and the Density Trap

Beyond runtime reliability sit *defect* metrics — about bugs found, where, and when. They're useful, but they carry the same statistical hazards as code metrics, and a senior applies them with caveats.

**Defect escape rate** — the fraction of defects that reach production rather than being caught pre-release — is the most decision-useful, because it measures the *effectiveness of your quality gates*, which you can act on:

```
escape rate = defects found in production / total defects found (pre-prod + prod)
```

A rising escape rate says your tests/reviews/staging are leaking — a direct signal to invest in the gate. It's a *ratio*, which (like CFR) makes it largely robust to changing release volume.

**Defect Detection Percentage (DDP)** is the same idea from the other side — the fraction of all eventually-known defects caught by a given activity (a test stage, a review, the whole pre-release process):

```
DDP(stage) = defects found by stage / (defects found by stage + defects that slipped past it)
```

DDP lets you compare the *yield* of quality activities — "code review catches 40% of defects that reach it; integration tests catch 55% of what reaches them" — and target the weakest filter. Its honest limitation: the denominator includes defects found *later*, so DDP for a recent period is provisional and only stabilises as escaped defects surface over time.

**Defect density** — `defects / KLOC` (defects per thousand lines of code) — is the metric to handle with the most suspicion, for the same reasons LOC-based code metrics fail:

- **LOC is a terrible denominator.** It rewards verbose code (more lines → lower density for the same bugs) and punishes concise, dense code. A refactor that *halves* the code while fixing nothing will *double* the apparent defect density. The denominator moves for reasons unrelated to quality.
- **It conflates discovery with creation.** Density measures defects *found*, not defects *present*. A well-tested module shows *higher* density than an untested one with more latent bugs — so density can reward not looking. (This is the classic counter-intuitive result: the modules with the most reported bugs are often the *best*-tested ones.)
- **Cross-team/language comparison is invalid.** LOC means wildly different things across languages and styles; comparing defect density between a Go service and a Java monolith measures verbosity differences, not quality differences.

Use defect density, if at all, as a *trend within one stable codebase and team*, never as a cross-team target — and pair it with escape rate, which doesn't depend on LOC at all. (For the full treatment of why LOC-based size and density metrics mislead, see [Code Quality Metrics](../../code-quality-metrics/).)

> **Key insight:** **Escape rate** and **DDP** are the rigorous defect metrics because they're *ratios about the effectiveness of your filters* — actionable and largely volume-robust. **Defect density** (defects/KLOC) inherits every pathology of LOC-based code metrics: a moving, gameable denominator that conflates "found" with "present" and rewards verbosity and not-testing. Track filter yield (escape rate, DDP); distrust density.

---

## Composing a Balanced Reliability Scorecard Without Gaming

The final senior skill is *composition*: assembling these metrics into a scorecard that drives improvement and resists gaming. Every individual reliability metric can be gamed in isolation, and Goodhart's law guarantees that whatever you target will be optimised — often perversely. The defence is a *balanced* set whose members **constrain each other**, so that gaming one degrades another.

The canonical balancing pairs:

| Metric | Game it by… | …which is caught by its counterweight |
|---|---|---|
| **Deploy frequency** (speed) | shipping tiny no-op deploys | **change failure rate** (and lead time) — empty deploys don't improve outcomes |
| **Change failure rate** (stability) | calling failures "non-deploy issues," not deploying | **deploy frequency** & **escape rate** — stalling delivery shows up immediately |
| **MTTR / time-to-restore** | declaring incidents resolved early; not opening incidents | **CFR**, **escape rate**, **SLO burn** — unresolved issues keep burning budget |
| **SLO attainment** | setting the SLO trivially low | **user-facing latency/quality SLIs** & customer signal — a too-loose SLO is met but users still complain |
| **Defect escape rate** | not logging production bugs | **SLO/error budget** & support volume — real failures still consume budget |

Principles for a non-gameable reliability scorecard:

- **Pair every speed metric with a stability metric, and vice versa** — the *Accelerate* four keys are deliberately two-and-two for exactly this reason. A speed number alone invites recklessness; a stability number alone invites paralysis.
- **Anchor at least one metric in *user-perceived* reality** — a request-success or latency SLI tied to actual user experience, or direct customer signal. Internal proxies can all be satisfied while users suffer (the McNamara fallacy); a user-anchored SLI is the hardest to game because the user is outside your control.
- **Own metrics at the *team/system* level, never the individual.** Individual reliability metrics (bugs-per-engineer, incidents-caused) destroy blameless culture, suppress incident reporting, and corrupt the data — the opposite of what reliability work needs. (This is the heart of [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/senior.md).)
- **Report distributions and trends, not single point targets** — a *target* number ("MTTR must be < 1 h") is far more gameable than a *trend* you discuss ("is our incident-duration distribution improving?"). Targets invite definitional gaming; trends invite investigation.
- **Use the scorecard for *conversations*, not rewards.** The moment a reliability metric is tied to compensation or stack-ranking, Goodhart's law takes over and the number decouples from reality. Keep it diagnostic.

> **Key insight:** No single reliability metric is safe alone — Goodhart guarantees it will be gamed. A balanced scorecard works because its members are **mutually constraining** (gaming speed degrades stability, gaming stability degrades speed) and at least one is **anchored in user-perceived reality** outside the team's control. Pair speed with stability, anchor in the user, own at the system level, report trends not targets, and never tie it to reward.

---

## Mental Models

- **Define the event before you define the metric.** Every good SLI starts as *good events / valid events*. Naming the event, the success criterion, and the *exclusion* (denominator) is the whole job — most bad SLIs skipped one of the three.

- **Reliability is a distribution; your metric is a summary statistic.** Latency lives on percentiles (and percentiles don't average); availability is undefined without a window. Any single-number reliability claim is incomplete until the statistic and the window are stated.

- **Alert on the derivative, not the level.** The error budget is the fuel gauge; the **burn rate** is how fast the needle is dropping. Pages should fire on burn rate (rate of change), with severity scaled to how fast the budget is actually disappearing.

- **One window can't win.** Short windows are twitchy (noise), long windows are sluggish (slow detection + slow reset). Multi-window multi-burn-rate dissolves the trade-off — burn rates encode severity, short+long windows buy precision *and* fast reset.

- **The mean is the wrong tool for incidents.** Durations are heavy-tailed, high-variance, and few — the exact conditions where a mean is least trustworthy. MTTR mostly measures tail luck; report the *distribution* (median + p90) or *cost-of-incident* instead.

- **Speed and stability are the same capability, not a trade-off.** Small batches and a fast, automated pipeline raise deploy frequency *and* lower change failure rate *and* shorten recovery. The lever is batch size and pipeline quality; "slow down to be safe" optimises the wrong variable.

- **A metric alone gets gamed; a balanced, mutually-constraining set anchored in the user does not.** Pair speed with stability, anchor one metric in user-perceived reality, own at the system level, and report trends not targets.

---

## Common Mistakes

1. **Measuring host uptime instead of request success.** Black-box "is it up?" misses partial failures, measures the prober not the user, and can't weight by traffic. For a sharded/replicated service, use a *request-success* SLI (good/valid events) and a latency SLI; reserve uptime for genuinely binary, single-tenant systems.

2. **Reporting a latency mean — or averaging p99s.** The mean of a heavy-tailed latency distribution is dominated by the tail and hides the median; *averaging precomputed percentiles* across hosts/windows is statistically invalid. Use percentile SLOs expressed as good/valid-event ratios, and merge distributions (histograms/t-digests), never percentiles.

3. **Quoting availability without a window.** "99.9%" means 43 min/month or 8.76 h/year — wildly different. Always state the window (prefer a rolling 28–30 days for the release-gating budget) and whether it's rolling or calendar.

4. **Alerting on a single threshold/window.** Short windows flood on-call (alert fatigue); long windows detect slowly and reset slowly (paging after recovery). Use multi-window multi-burn-rate: burn rates for severity, a short window AND-ed with each long window for precision and fast reset.

5. **Alerting on remaining budget instead of burn rate.** "10% budget left" is a lagging level with no trajectory. Alert on the *burn rate* (the derivative), which tells you whether and roughly when you'll breach.

6. **Trusting MTTR's value or its quarter-over-quarter delta.** It's a mean of a small, heavy-tailed, high-variance sample — one long incident dominates it. Report the duration *distribution* (median + p90) or cost-of-incident; treat MTTR only as an order-of-magnitude *band*.

7. **Assuming you must trade speed for stability.** The *Accelerate* data shows them positively correlated. Deliberately slowing delivery to "be safe" produces large, infrequent, high-blast-radius releases — *worse* stability. Fix batch size and pipeline quality instead.

8. **Targeting defect density (defects/KLOC).** LOC is a moving, gameable denominator that conflates defects-found with defects-present and rewards verbosity and not-testing. Track *escape rate* and *DDP* (filter yield); use density only as a within-codebase trend, never a cross-team target.

9. **Shipping a single reliability number as a target tied to reward.** Goodhart guarantees it gets gamed. Use a balanced, mutually-constraining set, anchored in a user-facing SLI, owned at the team/system level, reported as trends for conversation — never an individual target for compensation.

---

## Test Yourself

1. Write the good-events / valid-events form of an SLI. What three decisions does it force, and which one lets you legitimately *exclude* events from the metric?
2. Give three concrete reasons request-success rate is a better SLI than host uptime for a sharded, replicated service.
3. Why can't you report a latency mean, and why can't you average p99s across hosts? What do you do instead?
4. Define burn rate. For a 99.9% / 30-day SLO, what burn rate exhausts the budget in ~50 hours, and what severity should it trigger?
5. Explain why single-window SLO alerting fails, and how multi-window multi-burn-rate fixes *both* failure modes. What does the short window AND-ed onto each alert buy you?
6. State the statistical case that MTTR is misleading. What three properties of incident-duration data make the mean untrustworthy, and what should you report instead?
7. The *Accelerate* research found speed and stability are positively correlated. Give the mechanism — why does the same capability improve both, and what's the single biggest lever?
8. Why is defect density (defects/KLOC) a trap, and which two defect metrics are more rigorous? Why?

<details>
<summary>Answers</summary>

1. `SLI = good events / valid events × 100%`. It forces you to define (a) the **event** (request? job? read?), (b) what makes an event **good** (success + under latency T?), and (c) what makes an event **valid** — the *denominator*, which lets you **exclude** events you shouldn't be judged on (health-check probes, malformed-client `4xx`, planned-maintenance traffic).

2. (a) "Up" isn't binary at the edge — a 50-replica service serves 99.2% success while one shard fails; uptime can't express "mostly working." (b) Uptime measures the *prober's* experience (`/healthz` returns 200) not the *user's* (a route returns 500). (c) It can't weight by traffic — a blip over 10 requests and one over 100,000 are identical to time-based uptime but very different to users; request-success SLIs are intrinsically traffic-weighted.

3. Latency is heavy-tailed, so the **mean is dominated by the tail** (and the median hides it) — neither describes the experience. **Percentiles don't average or add**: an average of per-host p99s isn't a meaningful aggregate p99 (you must merge the underlying distributions). Instead, write the SLO as a *good/valid-event ratio over a threshold* ("99% of requests < 300 ms"), which is a count — traffic-weighted and aggregable — and merge histograms/t-digests rather than percentiles.

4. `burn rate = observed error rate / (1 − SLO)`; a rate of 1 spends the budget exactly over the window. For 99.9%/30 days, a **14.4×** burn consumes 2% of budget in 1 hour and exhausts the full budget in ~50 hours — it should **page** (fast burn).

5. A single *short* window is twitchy (high recall, low precision → noise, alert fatigue); a single *long* window detects slowly and **resets slowly** (keeps paging after recovery, because the bad minutes stay inside the window). Multi-window multi-burn-rate fixes both: **multiple burn rates** map to **severities** (14.4× page / ~1× ticket), and pairing each long window with a **short window AND-condition** acts as a recency gate — the alert **resets fast** the moment the recent window drops below threshold, giving precision *and* fast reset.

6. Incident durations are (a) **heavy-tailed** — a few long incidents drag the mean away from the typical case; (b) **high-variance** — the SD rivals the mean, so changes are indistinguishable from noise; (c) **small-sample** — dozens per period, so one 14-hour outage can double a quarter's MTTR with no system change. So MTTR mostly measures tail luck (VOID/Nash: "MTTR is a misleading metric"). Report the **distribution** (median + p90), a **cost-of-incident** measure (total incident-minutes, severity-weighted impact), or use incidents qualitatively — and treat MTTR only as an order-of-magnitude *band*.

7. Mechanism: **small batches** (frequent deploys contain less change) shrink blast radius, speed diagnosis/revert, and lower failure rate — so frequent *and* safer; the same **automated pipeline** that shortens lead time also prevents defects and enables fast rollback (short time-to-restore). One capability yields both; the biggest lever is **batch size + pipeline quality**. "Slow down to be safe" creates large infrequent high-blast-radius releases — worse stability.

8. Density's denominator (**LOC**) is moving and gameable — verbose code lowers density for the same bugs, a refactor that halves code doubles density — and it conflates defects **found** with defects **present** (well-tested modules show *higher* density), invalid across languages/teams. **Escape rate** (prod defects / total defects) and **DDP** (defects caught by a stage / defects that reached it) are rigorous because they're *ratios about filter effectiveness* — actionable and volume-robust, not dependent on LOC.

</details>

---

## Cheat Sheet

```
SLI — GOOD / VALID EVENTS
  SLI = good events / valid events × 100%
  decide:  event?   good?   valid? (denominator → lets you EXCLUDE probes/4xx/maintenance)
  request-success  > host uptime  (partial failures, user-not-prober, traffic-weighted)
  types: availability · latency(<T) · quality · freshness · correctness

DISTRIBUTION, NOT POINT
  latency → percentiles  p50/p90/p95/p99/p99.9   (mean lies; tail is the product)
  percentiles DON'T average/add → merge histograms/t-digests, never avg p99s
  tail × fan-out: 0.99^100 ≈ 37% → ~63% of fan-out requests hit a p99 tail
  availability MUST state a WINDOW (prefer rolling 28–30d for release gate)
    99.9%  → 43m/30d · 8.76h/yr      99.99% → 4.3m/30d · 52.6m/yr

ERROR BUDGET & BURN RATE
  budget = 100% − SLO        burn rate = observed error rate / (1 − SLO)
  time to exhaust = window / burn rate
  burn 1× = full window · 14.4× ≈ 50h · 1000× ≈ 43m (for 99.9%/30d)
  ALERT ON BURN RATE (derivative), not remaining budget (level)

MULTI-WINDOW MULTI-BURN-RATE (SRE Workbook)
  fast  PAGE   2% budget / 1h   → 14.4×   AND short 5m  > 14.4
  med   PAGE   5% budget / 6h   → 6×      AND short 30m > 6
  slow  TICKET 10% budget / 3d  → ~1×     AND short 6h  > 1
  long window = precision · short window AND = fast reset (recency gate)

MTTR IS MISLEADING (Nash / VOID)
  mean of small + heavy-tailed + high-variance sample → dominated by one long incident
  q-o-q MTTR delta ≈ tail luck, not improvement
  instead: distribution (median + p90) · cost-of-incident · MTTR as a BAND only

SPEED ↔ STABILITY (Accelerate)
  POSITIVELY correlated — NOT a trade-off
  lever: SMALL BATCHES + fast automated pipeline → ↑freq ↓CFR ↓restore
  CFR is a RATIO (failed/total) → deploying more ≠ higher CFR

DEFECT METRICS
  escape rate = prod defects / total defects        (filter effectiveness — use)
  DDP(stage)  = found by stage / reached stage       (filter yield — use)
  defects/KLOC = density  → LOC denominator trap     (gameable — distrust)

SCORECARD (anti-gaming)
  pair speed+stability · anchor 1 in user SLI · own at SYSTEM level
  report TRENDS not targets · for conversation, never reward (Goodhart)
```

---

## Summary

- An SLI should be a **good events / valid events** ratio — the formulation forces you to name the event, the success criterion, and the *exclusion* (denominator). For modern sharded/replicated services, **request-success** beats **host uptime** (partial failures, user-not-prober, traffic-weighted).
- **Reliability is a distribution, and your metric is a summary statistic.** Latency lives on **percentiles** (the mean lies; percentiles don't average — merge distributions), and **availability is undefined without a window** (prefer a rolling 28–30 days for the release-gating budget).
- The **error budget** is `100% − SLO`; manage it via **burn rate** (`observed / (1 − SLO)`). **Alert on the burn rate (the derivative), not the remaining level.**
- **Multi-window, multi-burn-rate** alerting dissolves the single-threshold trade-off: multiple burn rates encode *severity* (14.4× page / ~1× ticket), and a **short window AND-ed** with each long window gives both *precision* and *fast reset*.
- **MTTR is misleading** — a mean of a small, heavy-tailed, high-variance sample dominated by the occasional long incident (Nash / the VOID). Report the **distribution** (median + p90) or **cost-of-incident**, and treat MTTR only as an order-of-magnitude band.
- **Speed and stability are positively correlated** (*Accelerate*), not a trade-off — **small batches + a fast, automated pipeline** raise deploy frequency *and* lower change failure rate *and* shorten recovery.
- For defects, prefer **escape rate** and **DDP** (ratios about filter effectiveness) over **defect density** (defects/KLOC), which inherits every LOC-denominator pathology.
- A reliability **scorecard** resists gaming only when its members are **mutually constraining** (speed vs stability) and **anchored in a user-facing SLI**, owned at the **system level**, reported as **trends not targets**, and **never tied to reward**.

You now measure reliability the way an SRE does — defining indicators that survive a postmortem, alerting on rates of change, distrusting the mean of a skewed sample, and composing a balanced set that drives improvement instead of inviting games. The next page, [professional.md](professional.md), is about operating this discipline across an organisation: negotiating SLOs with product, running the error-budget policy, and embedding it in incident and release process.

---

## Further Reading

- *Site Reliability Engineering* (Beyer, Jones, Petoff, Murphy, eds.) — the SLI/SLO/error-budget chapters; the canonical statement of the good/valid-events discipline and budget-driven release decisions.
- *The Site Reliability Workbook* — the **Alerting on SLOs** chapter, the definitive treatment of multi-window, multi-burn-rate alerting (the burn-rate tables in this page follow it).
- Courtney Nash & the Verica team — *"MTTR is a misleading metric"* and the **VOID** (Verica Open Incident Database) reports — the statistical case against MTTR and for reporting incident-duration distributions.
- *The Tail at Scale* — Dean & Barroso (CACM, 2013) — why tail latency dominates at scale and why fan-out turns a backend p99 into a user-facing near-certainty.
- *Accelerate* — Forsgren, Humble & Kim — the research showing throughput and stability are positively correlated, and the capabilities that drive both.
- *Implementing Service Level Objectives* — Alex Hidalgo — book-length treatment of SLIs, SLOs, error budgets, and burn-rate alerting in practice.

---

## Related Topics

- [01 — The DORA Four Keys](../01-dora-four-key-metrics/senior.md) — change failure rate and time-to-restore as the stability half of the four keys, and the speed/stability correlation in full.
- [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/senior.md) — why every metric here gets gamed in isolation, and the anti-patterns (individual metrics, vanity numbers, the McNamara fallacy) the scorecard defends against.
- [Performance → Latency & Throughput](../../performance/03-latency-and-throughput/) — the runtime side of latency SLIs: where tail latency comes from and how to measure and reduce it.
- [Diagnostics](../../../diagnostics/) — turning a fired SLO/burn-rate alert into a root cause: profiling, tracing, and incident investigation.
- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier set.
