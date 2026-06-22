# Gate Design: Speed vs Safety — Professional Level

> **Roadmap:** [Quality Gates](../README.md) → Gate Design: Speed vs Safety
> *The senior page taught you to design a single gate well — owner, cost, signal, bypass. This page is about owning the whole portfolio: forty-odd gates across two hundred repos, each one taxing every change that flows through it, added by a different person after a different incident, and never removed. Your job stops being "is this gate good?" and becomes "does this gate still earn its place in the budget?" — measured, defended, and sunset on a schedule.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Gate Portfolio Has a P&L](#core-concept-1--the-gate-portfolio-has-a-pl)
5. [Core Concept 2 — Instrumenting the Portfolio](#core-concept-2--instrumenting-the-portfolio)
6. [Core Concept 3 — The Accretion Problem and the Counter-Pressure](#core-concept-3--the-accretion-problem-and-the-counter-pressure)
7. [Core Concept 4 — The Trust Economy and Bypass Rate](#core-concept-4--the-trust-economy-and-bypass-rate)
8. [Core Concept 5 — Risk-Based Gating and Reversibility](#core-concept-5--risk-based-gating-and-reversibility)
9. [Core Concept 6 — Selling It to Leadership](#core-concept-6--selling-it-to-leadership)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Managing the org's entire set of gates as a portfolio with a budget — measuring what each one costs and catches, and holding the counter-pressure against a culture that only ever adds.**

The senior page framed each gate as a design object with an owner, a cost, a signal, and an escape hatch. At the professional level the unit of analysis is no longer the gate — it's the *portfolio*. Every change that an engineer pushes pays a tax equal to the sum of every required gate in its path: the lint that takes 40 seconds, the integration suite that takes 18 minutes, the security scan that takes 6, the manual approval that takes a median of 4 hours of wall-clock. That cumulative tax, multiplied across thousands of changes a quarter, is one of the largest line items in your org's cycle time — and almost nobody accounts for it.

The defining failure mode at scale is **accretion**: a gate is added after every incident and removed after none. Pipelines rot from 6 required checks to 22 over two years, each one defensible in isolation, the sum indefensible. The staff/principal engineer's actual job here is *counter-pressure* — instrumenting the portfolio so the dead gates become visible, running the ritual that deletes them, and reframing the org-wide conversation away from "more gates = more safety" toward what [Accelerate](#further-reading) proved: speed and stability are not a trade-off, and the lever for both is fast feedback, good tests, and reversibility — not gate count. This page is the pragmatic, battle-tested layer for the person who owns that.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — gate placement, cost/signal/owner/bypass, fast-feedback ordering, the shift-left vs shift-right trade-off.
- **Required:** You've owned a CI/CD pipeline or release process and felt it get slower over time.
- **Helpful:** You've added a gate after an incident — and never circled back to ask whether it still catches anything.
- **Helpful:** You've had the "we should require X on every PR" conversation in an incident review and watched it get adopted without a cost discussion.

---

## Glossary

| Term | Meaning in this topic |
|---|---|
| **Gate portfolio** | The complete set of gates a change can encounter — per-repo required checks plus org-wide policy — treated as one managed inventory with a total cost and total benefit. |
| **Gate P&L** | The profit-and-loss view of a single gate: its benefit (real defects/incidents caught) against its cost (cumulative added latency + maintenance + bypass friction). |
| **Cycle-time tax** | The cumulative wall-clock latency a gate adds to *every* change that passes through it, summed across all such changes per unit time. |
| **Fire rate** | How often a gate blocks/flags a change (per 100 runs). High fire rate is only good if precision is also high. |
| **Precision (true-positive rate)** | Of the times a gate fired, the fraction that caught a *real* defect rather than a flake or noise. The single most important quality signal. |
| **Bypass rate** | The fraction of the time the gate was overridden (admin-merge, force-merge, skip label, break-glass). The leading indicator of a dead or hated gate. |
| **Accretion** | The org pathology where gates are added after incidents and never removed, monotonically growing the pipeline. |
| **Normalization of deviance** | When bypassing a gate becomes the routine, unremarkable path — at which point the gate is already dead but still taxing the honest. |
| **Reversibility** | How fast and cheaply a bad change can be undone in production (rollback, feature flag, progressive rollout). High reversibility *buys back* speed by letting you gate less up front. |
| **Change tier** | A risk classification for a change (standard / normal / high-risk) that determines which gate set applies. |
| **Last-real-catch date** | The date a gate most recently caught a genuine defect. A gate with no catch in two quarters is a deletion candidate. |

---

## Core Concept 1 — The Gate Portfolio Has a P&L

The single mental shift that separates the senior view from the principal view: **stop evaluating gates one at a time, and start managing the set as a portfolio with a budget.**

Every gate has a benefit and a cost. The benefit is real defects or incidents it prevents from advancing. The cost is the part everyone underweights, because it's diffuse: the latency it adds to *every change*, whether or not that change was ever going to fail the gate. A gate that catches one genuine bug a quarter but adds 4 minutes to 1,200 PRs a quarter has spent **80 engineer-hours of wall-clock** to catch one bug. That can absolutely be worth it — a bug that would have paged at 2 a.m. and cost a day of incident response easily pays for 80 hours of latency. But it can also absolutely *not* be worth it, and you cannot know which without doing the arithmetic.

The portfolio framing makes two things explicit that the per-gate framing hides:

- **Gates compete for a shared, finite cycle-time budget.** Your org has an implicit ceiling on how long "push to merge" and "merge to prod" are allowed to take before developers route around the process or productivity craters. Every gate draws down that budget. Adding the 23rd gate isn't free even if it's a "good" gate — it's spending budget that some *other* gate, or raw delivery speed, could have used.
- **The total cost is the sum, but the total benefit is not.** Costs add linearly (every gate's latency stacks). Benefits overlap heavily — three different scanners that all flag the same class of issue catch *one* problem three times and bill you for three gates. Portfolio thinking surfaces this redundancy that per-gate review never will.

> **The principal reality:** the cumulative cycle-time tax of your gate portfolio is one of the largest and least-measured costs in your org. Most leaders can tell you their cloud bill to the dollar and have no idea that required checks add a median 31 minutes to every merge. Make that number visible and you've already changed the conversation — because now "add a gate" has a price tag attached, and the budget is finite.

The job, then, is portfolio management: every gate must continuously justify its slot, the same way a line item in a budget does. Which means you have to measure it.

---

## Core Concept 2 — Instrumenting the Portfolio

You cannot manage a portfolio you can't see. The deliverable is a **gate P&L dashboard** — one row per gate, refreshed continuously, that turns "I have a feeling this gate is useless" into "this gate has fired 412 times this quarter, caught zero real defects, and is bypassed 38% of the time."

The columns that matter, per gate:

| Metric | Why it's on the dashboard | Healthy / Watch / Dead |
|---|---|---|
| **Fire rate** | How often it blocks/flags (per 100 runs). | Context-dependent; read with precision |
| **Precision (true-positive rate)** | Of fires, the fraction that caught a *real* defect (not flake/noise). | ≥70% healthy · 30–70% watch · <30% dead |
| **Added latency (p50/p95)** | Wall-clock the gate adds to every change. | Track against the budget |
| **Bypass rate** | Fraction overridden (admin-merge, skip, break-glass). | <2% healthy · 2–10% watch · >10% dead |
| **Last-real-catch date** | When it last caught a genuine defect. | <1 quarter healthy · >2 quarters delete-candidate |
| **Owner** | The human/team accountable for it. | "nobody" = automatic finding |
| **Cost/catch** | (Σ added latency) ÷ (real defects caught). | Compare across the portfolio |

The hard part is *precision*, because it requires labeling fires as true or false positives. You get there pragmatically: sample failed runs, ask "did this block a change that would actually have caused a problem?", and tag flaky reruns automatically (a check that fails then passes on re-run with no code change is a false positive by definition — instrument your CI to count those). Even a sampled, approximate precision number is transformative, because the dead gates are not subtle — they sit at <10% precision and >20% bypass and everyone already knows it; the dashboard just makes it undeniable.

Two instrumentation moves pay for themselves immediately:

```text
# Treat gate latency as a tracked DevEx/DORA-adjacent metric, not an afterthought.
# Emit a span per gate so "time in gates" becomes a first-class series.

merge.gate.duration{gate="integration-tests", repo="...", outcome="pass|fail|flake"}  = 1080s
merge.gate.bypass {gate="integration-tests", repo="...", actor="...", reason="..."}    = 1
merge.lead_time.in_gates / merge.lead_time.total   # the % of lead time that is pure gate tax
```

> **The DORA link:** `lead time for changes` is one of the four key metrics, and "time spent waiting in gates" is a direct, attributable component of it. When you can say "gates account for 34% of our p95 lead time, and three of them account for 80% of *that*," you've connected gate design to a metric leadership already cares about. See [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — gate latency is exactly the kind of thing the metrics program exists to surface, and exactly the kind of thing Goodhart's law will distort if you let "number of gates" become the target instead of "defects caught per hour of tax."

The dashboard exists to feed one ritual: the quarterly gate review, where gates that don't pay get removed.

---

## Core Concept 3 — The Accretion Problem and the Counter-Pressure

Here is the structural force you are fighting. Gates are added by a **single, motivated, visible** decision: an incident happens, the review asks "how do we prevent this?", and adding a check is the cheapest-looking answer in the room. Gates are removed by a **diffuse, unmotivated, invisible** decision: nobody's incident is caused by a gate that *exists*, so nobody is ever in a meeting advocating for deletion. The asymmetry is total. Left alone, the portfolio only grows. This is **accretion**, and it is the default trajectory of every pipeline that isn't actively pruned.

The result is **pipeline rot**: a required-check list that grew from 6 to 22 over two years, where each addition was defensible at the time and the sum is a 50-minute merge that everyone resents and half the gates catch nothing. No single person decided to build a 50-minute pipeline. It accreted.

The principal engineer's job is to *be the counter-pressure* — to manufacture the missing force on the deletion side. Three concrete mechanisms:

**1. The "delete a gate" ritual.** A standing quarterly review whose explicit, non-negotiable output is a *removal*. Not "review the gates" (which produces nothing) — "this quarter we delete at least the bottom gate by cost/catch." Make deletion the default action and require justification to *keep*, inverting the asymmetry. The dashboard hands you the candidates: lowest precision, highest bypass, oldest last-real-catch.

**2. The add-a-gate gate.** A new gate must clear a bar before it's added. It must name (a) the specific failure class it catches — not "quality," an actual defect you can point to; (b) its owner — a named human/team who will get the dashboard row and the deprecation duty; (c) its cost — the latency it adds and to how many changes; and (d) what it *replaces* — because a new gate should often retire an old one rather than stack on top. Frame it as: "you may add this gate, and here is the existing gate it lets us delete."

**3. Sunset policies.** Every gate added in reaction to an incident gets a default expiry — say, two quarters — after which it must be *re-justified* with its P&L numbers or it auto-deprecates. This converts the silent-forever default into a forced periodic decision. Incident-driven gates are the highest-accretion category precisely because they're added under emotional pressure and never revisited; a sunset clause is the antidote.

> **The reframe that makes this politically survivable:** deleting a gate is not "lowering the bar." It's *reclaiming cycle-time budget to spend on gates that actually pay, and on raw delivery speed* — both of which DORA shows improve stability, not harm it. You are not arguing for less safety; you are arguing for the *same or better* safety at lower tax. Bring the numbers: "this gate caught zero real defects in two quarters, is bypassed 30% of the time, and taxes every merge by 4 minutes — deleting it buys back 80 hours a quarter and removes a thing nobody trusts."

---

## Core Concept 4 — The Trust Economy and Bypass Rate

Gates run on trust. A gate that engineers believe in, they wait for; a gate they don't, they route around. The **bypass rate is the leading indicator of a dead gate** — it tells you the population has already voted, with their behavior, that this gate isn't worth its cost, *before* any dashboard does.

The progression is predictable and has a name: **normalization of deviance** (Diane Vaughan's term from the Challenger investigation). It runs like this:

1. A gate is slow or flaky. Occasionally someone admin-merges past it under deadline pressure. This feels exceptional.
2. Nothing bad happens (because the gate was usually noise anyway). The bypass is rewarded with a shipped feature and no consequence.
3. Bypassing becomes the *normal* path under any pressure. The exceptional becomes routine.
4. The gate is now *dead* — it taxes the honest, is ignored by the pressured, and provides no safety to anyone — but it still sits in the pipeline, still has a green-checkmark theater around it, and still occasionally masks a *real* failure inside its noise.

The critical principal-level instinct: **when bypass becomes routine, fix the gate — do not police the bypass.** A high bypass rate is a *symptom*; the disease is a gate that isn't worth waiting for. Cracking down on bypasses (removing admin-merge, adding approvals to the override) treats the symptom and makes things worse — you've now forced engineers to honor a gate they correctly judged worthless, taxing them harder for the gate's failure. The correct response is to ask *why* it's bypassed (too slow? too flaky? catches nothing?) and fix or delete it. Bypass is feedback, not insubordination.

```text
Bypass rate read like a vital sign:
  <2%    healthy — bypass is genuinely exceptional, the gate is trusted
  2–10%  watch  — investigate; either the gate is degrading or a team is under chronic pressure
  >10%   the gate is effectively dead; STOP policing, START fixing or deleting
  >50%   the gate is theater; it is providing negative value (masks real failures in its noise)
```

> **The connection to break-glass:** a *legitimate* bypass path (pre-authorized, logged, time-boxed, auto-reviewed) is healthy infrastructure — it's how you survive 3 a.m. without people inventing undocumented hacks. A *routine* bypass is pathology. The difference is rate and reason: break-glass should be rare and post-justified; routine bypass means the gate is wrong. See [07 — Break-glass & Bypass](../07-break-glass-and-bypass/professional.md) for how to build the legitimate path so that the bypass *rate* stays meaningful as a signal — if every override is a clean break-glass with a logged reason, your bypass dashboard becomes an honest gate-health instrument instead of a wall of silent admin-merges.

---

## Core Concept 5 — Risk-Based Gating and Reversibility

The biggest lever for spending less cycle-time budget without losing safety is to stop applying the same gate set to every change. **Not all changes carry the same risk, so not all changes should pay the same tax.** A one-line copy change to a marketing page and a migration that rewrites the billing schema should not traverse identical gates — but in most orgs they do, which means either the copy change is over-gated (wasting budget) or the migration is under-gated (carrying risk), and usually both.

A **risk-based gating program** classifies changes into tiers and assigns a gate set per tier:

| Tier | Examples | Gate set | Deploy |
|---|---|---|---|
| **Standard (low-risk)** | Docs, copy, feature-flag-dark code, config behind a flag, dependency patch bumps | Lint + unit + flag-check. No manual approval. | Auto-deploy on green |
| **Normal** | Typical application code, additive API changes, most feature work | Full automated suite (unit + integration + SAST + secret-scan) + 1 review | Auto-deploy on green, progressive rollout |
| **High-risk** | Schema migrations, auth/authz, payment paths, infra/IaM, anything irreversible | Full suite + 2 reviews (incl. CODEOWNER) + manual sign-off + staged rollout with bake time | Gated deploy, manual promotion |

The classifier can be automatic (path-based rules: `docs/**` and `**/*.md` → standard; `migrations/**`, `auth/**`, `billing/**` → high-risk) with a manual override for judgment calls. The payoff is twofold: low-risk changes flow at full speed (reclaiming enormous budget and review capacity), and that reclaimed capacity gets *concentrated* on the genuinely dangerous changes — your two best reviewers spend their attention on the migration, not on the typo fix.

The deeper lever underneath tiering is **reversibility**. The reason you gate heavily up front is that a bad change in production is expensive to undo. But if you invest in *progressive delivery and fast rollback* — feature flags, canary deploys, automated rollback on SLO breach, one-click revert — you change the economics: a bad change is now cheap and fast to undo, so you can afford to gate *less* before it and catch problems *after* it, in production, with a tight blast radius. **Reversibility buys speed.** This is the mechanism behind DORA's finding that elite performers deploy more often *and* have lower change-failure impact — not because they gate harder, but because they've made failure cheap enough that they don't have to.

> **The principal framing:** "gate before" and "catch after" are substitutes on a spending curve. Every dollar you put into reversibility (flags, canaries, instant rollback) lets you take a dollar out of up-front gating without losing safety — and you come out ahead, because catching a problem in a 1%-canary with auto-rollback is *faster and cheaper feedback* than blocking the merge for 50 minutes hoping a gate catches it. The teams that gate the least, safely, are the ones that can roll back the fastest.

---

## Core Concept 6 — Selling It to Leadership

The portfolio discipline only survives if you can defend it in the rooms where gates get *added* — and those rooms are emotional. An incident just happened. Someone is asking, reasonably, "how do we make sure this never happens again?" The cheapest-looking answer is "require X on every change," and if you have no counter-frame, the org accretes another gate.

Your counter-frame, ready before the meeting:

- **Reframe "safety" away from "gate count."** Safety is *fast feedback + good tests + reversibility*, not the number of checks. A new gate that adds 6 minutes to every change and catches this *specific* past incident is often a worse safety investment than a better test, a canary, or a faster rollback that catches a *class* of incidents. Make the alternatives visible: "we could add this gate, or we could add a canary stage that would have caught this *and* the next three like it, with no merge-time tax."
- **Bring the "no trade-off" evidence.** [Accelerate / the DORA research](#further-reading) is your ammunition: across tens of thousands of respondents, speed and stability are *positively* correlated — the elite performers are faster *and* safer. The folk model ("we must choose: move fast OR be safe") is empirically false. Gating harder does not buy stability; it buys *slowness*, which buys batching, which buys *bigger riskier changes*, which buys *worse* stability. The data lets you say "the thing you're proposing to make us safer will, by the evidence, make us less safe."
- **Attach the price tag.** Never let a gate be added without its cost on the table: "this will add ~5 minutes to ~1,400 changes a quarter — that's ~115 engineer-hours of wall-clock, and it competes with the budget for [the gates that are paying]." Leaders make different decisions when the cost is a number instead of an invisible.
- **Offer the trade, not the refusal.** Don't say "no, we shouldn't add gates." Say "yes, *and* here's the gate it retires, here's its owner, and here's its sunset date." You're not the person who blocks safety; you're the person who keeps the portfolio solvent.

> **The one-liner for the incident review:** "Adding a gate after every incident is how pipelines rot to the point that the gates throttle delivery and *nobody trusts them* — which is how the next incident ships anyway. The fix for this incident is better feedback for *this class* of problem and the ability to roll it back fast, plus retiring a gate that isn't catching anything. Let's not buy slowness and call it safety."

---

## War Stories

**The 22-check pipeline that got faster *and* safer.** A platform team inherited a service whose `main` branch required 22 status checks; a green merge took ~50 minutes p95, and engineers openly batched work to avoid running the gauntlet. A gate-P&L review built the dashboard for the first time: of the 22, *nine* had caught zero real defects in two quarters, four were redundant (three separate tools flagging the same dependency-license class), and two were flaky enough to be bypassed ~25% of the time. They cut the required set to 6 — kept unit, integration, SAST, secret-scan, a single license check, and type-check; deleted or demoted the rest to advisory. Merge p95 dropped to 11 minutes. The counterintuitive result, six months later: the *escape rate* (bugs reaching prod) went **down**. Why? Smaller, more frequent merges (because the gauntlet no longer incentivized batching), and engineers actually *reading* six trusted signals instead of rubber-stamping past twenty-two. Fewer gates, better outcomes — because the portfolio, not the gate, is what determines safety.

**The 70%-bypass gate that masked a real incident.** A performance-regression gate compared each PR's benchmark against a baseline. It was noisy — environmental variance made it fire on ~40% of PRs, almost all false positives — so the team had quietly normalized admin-merging past it; bypass rate sat near 70%. Then a PR introduced a genuine 3x latency regression in a hot path. The gate fired. Nobody looked — *the gate firing was meaningless by then* — and the change was admin-merged like every other day. It paged in production a week later. The post-incident instinct was "tighten the bypass — require VP approval to override." The correct fix, which they eventually reached, was the opposite: the *gate* was the problem. They rebuilt it to run on a stable, isolated runner with statistical significance testing, dropping the false-positive rate below 5%. Bypass collapsed to ~3%, and the gate became *trustworthy* again — which is the only state in which a gate provides safety. **Policing the bypass would have honored a broken gate; fixing the gate restored the signal.**

**The risk-tiering rollout that freed the dangerous-change budget.** An org of ~180 engineers required two reviews and a manual deploy approval on *every* change, including documentation and copy. Senior engineers were drowning in trivial review requests, and the real migrations got the same cursory attention as a README typo. They introduced three change tiers with path-based auto-classification: `docs/**`, copy, and flag-dark code auto-deployed on green with no human approval; normal code kept one review + auto-deploy with canary; high-risk paths (`migrations/**`, `auth/**`, `payments/**`) *gained* a second CODEOWNER review and a staged rollout with bake time. About 35% of changes dropped into the low-risk tier and stopped consuming review capacity entirely. That reclaimed senior-reviewer attention got concentrated on the high-risk tier — where, in the following two quarters, reviewers caught two migration bugs that the old uniform-and-exhausted process would have waved through. They gated *less* overall and *more* where it mattered.

**The "gate after every incident" culture that throttled deploys to weekly.** A team had an unwritten norm: every incident review ended with a new required check. Over eighteen months this produced a pipeline so slow and so flaky that deploys, once daily, had degraded to roughly weekly — engineers batched a week of changes to amortize the pain. The batching made each deploy *enormous and risky*, which caused *more* incidents, which added *more* gates. A textbook accretion death-spiral, with safety theater all the way down. Breaking it required a leadership conversation backed by the DORA "no trade-off" data and the lead-time dashboard showing gates as 60% of cycle time. They instituted the add-a-gate gate and a two-quarter sunset on all incident-driven checks. Within a quarter the required set shrank by a third, deploys returned to near-daily, batch sizes fell, and the incident rate followed batch size *down*. The gates hadn't been buying safety; they'd been manufacturing the conditions for failure.

**The unowned gate that blocked all deploys for a day.** A license-compliance gate had been added years earlier by an engineer who'd since left; it had no owner, no dashboard row, no documentation. One morning the third-party license-data service it called changed its API, the gate started erroring (not failing — *erroring*), and because it was a required check, **every deploy across forty repos was blocked**. It took most of a day just to *find someone willing to own the decision* to disable it, because no name was attached. The lasting fix wasn't technical — it was the policy that **no gate ships without a named owner**, surfaced on the P&L dashboard, with "owner = nobody" treated as an automatic deletion candidate at the next review. An unowned required gate is a single point of failure with no on-call.

---

## Decision Frameworks

### Gate portfolio P&L scorecard

Score every gate on this card; it drives the quarterly review.

| Dimension | Green | Yellow | Red |
|---|---|---|---|
| Precision (true-positive rate) | ≥70% | 30–70% | <30% |
| Bypass rate | <2% | 2–10% | >10% |
| Added latency (p95) vs budget | within budget | nibbling budget | dominates budget |
| Last real catch | <1 quarter | 1–2 quarters | >2 quarters |
| Owner | named, responsive | named, absent | nobody |
| Redundancy | unique signal | overlaps one gate | overlaps several |
| **Action** | **keep** | **fix** | **delete** |

### Add-a-gate gate (what a new gate must justify before it ships)

| Requirement | The question it must answer | If unanswered |
|---|---|---|
| **Named failure class** | What *specific* defect does this catch? (point to a real one) | Reject — "quality" is not a failure class |
| **Owner** | Who gets the dashboard row, the alerts, the sunset duty? | Reject — unowned gates become SPOFs |
| **Cost** | How much latency, on how many changes per quarter? | Reject — cost must be on the table |
| **What it replaces** | Which existing gate does this retire or supersede? | Default: stack only if nothing overlaps |
| **Reversibility alternative** | Could a canary / flag / faster rollback catch this *class* cheaper? | Prefer the alternative if it's broader and tax-free |
| **Sunset date** | When is it re-justified or auto-deprecated? | Default: 2 quarters for incident-driven gates |

### Keep / fix / delete a gate

| Signal pattern | Read | Action |
|---|---|---|
| High precision, low bypass, recent catch | Healthy, trusted, paying | **Keep** |
| High precision, *high* bypass | Good signal, but too slow/painful to wait for | **Fix** the cost (speed/flakiness), not the bypass |
| Low precision, high bypass | Noise; population has already voted | **Delete** (or rebuild to high precision) |
| No catch in 2+ quarters, low bypass | Sleeping; possibly obsolete | **Delete** unless it guards a rare catastrophic class |
| Redundant with another gate | Double-billing for one signal | **Delete** the weaker; keep one |
| Owner = nobody | SPOF with no on-call | **Assign owner or delete** — never leave required + unowned |

### Change-tier → gate-set matrix

| | Standard (low-risk) | Normal | High-risk |
|---|---|---|---|
| **Classifier** | `docs/**`, copy, flag-dark, patch bumps | typical app code, additive APIs | `migrations/**`, `auth/**`, `payments/**`, IaM, irreversible |
| **Automated checks** | lint + unit + flag-check | full suite (unit/integration/SAST/secret) | full suite |
| **Human review** | none | 1 review | 2 reviews incl. CODEOWNER |
| **Approval** | none | none | manual sign-off |
| **Deploy** | auto on green | auto + progressive rollout | gated, staged, bake time |
| **Rollback posture** | flag/instant | canary + auto-rollback on SLO | staged + manual promote + auto-rollback |

### Speed-vs-safety: is this a real trade-off or a bad gate?

| You're told… | Diagnostic question | Likely truth |
|---|---|---|
| "We can't speed up; it's a safety check" | What's its precision and last-real-catch? | If low/stale → it's a *bad gate*, not safety; deleting it costs nothing |
| "We must add this gate to be safe" | Would a canary/flag/rollback catch this class tax-free? | Usually yes → reversibility beats a new gate |
| "Faster deploys will hurt stability" | What does DORA say, and what's our batch size? | False trade-off; slowness *grows* batches → *worse* stability |
| "People bypass it, so lock it down" | *Why* do they bypass it? | The gate is wrong; fix the gate, don't police the override |
| "All changes need the same gates" | Do a typo and a schema migration carry equal risk? | No → tier the gates; concentrate scrutiny on the dangerous |

---

## Mental Models

- **The portfolio, not the gate, determines safety.** A great gate in a 50-minute pipeline of junk gates provides little safety, because the pipeline's slowness grows batch sizes and erodes trust. Manage the set, not the instance.

- **Gates compete for a finite cycle-time budget.** Every gate spends from the same "push-to-prod time" account. The 23rd gate isn't free even if it's good — it's budget some other gate or raw speed can't use. Adding requires *spending*, so it requires *justifying*.

- **Accretion is the default; deletion is the discipline.** Gates are added by a motivated individual after an incident and removed by no one, because no one's incident is caused by a gate that exists. Your job is to manufacture the missing deletion force.

- **Bypass rate is the population's vote.** When engineers route around a gate routinely, they've already judged it not worth its cost. Believe them. Fix or delete the gate; do not police the bypass — that punishes people for being right.

- **Reversibility is a substitute for up-front gating.** Money spent on flags, canaries, and instant rollback lets you take money out of merge-time gates without losing safety — and catching a bug in a 1% canary is *faster, cheaper feedback* than a gate that blocks the merge.

- **"Add a gate after every incident" is how the next incident ships.** Accreted gates throttle delivery, grow batches, and lose trust — manufacturing the exact conditions that cause failures. Safety is fast feedback and reversibility, not gate count.

---

## Common Mistakes

1. **Evaluating gates one at a time.** Each gate looks defensible in isolation; the *sum* is a 50-minute pipeline nobody trusts. Manage the portfolio with a P&L, not the gate with an anecdote.

2. **Never measuring the cumulative cost.** If you can't state "gates add a median 31 minutes to every merge and account for 34% of p95 lead time," every add-a-gate conversation happens with the price invisible. Instrument gate latency as a tracked metric.

3. **Adding a gate after every incident with no sunset.** Incident-driven gates are the highest-accretion category — added under pressure, never revisited. Without a default expiry and re-justification, the portfolio only grows.

4. **Policing bypass instead of fixing the gate.** A high bypass rate is a *symptom* of a bad gate. Locking down the override forces engineers to honor a gate they correctly judged worthless — taxing them harder for the gate's failure.

5. **Applying one gate set to every change.** A typo fix and a schema migration traverse identical gates, so the typo is over-gated and the migration under-gated. Tier by risk; concentrate scrutiny where it pays.

6. **Treating gate count as a safety metric.** More gates is not more safety — past a point it's *less*, via batching and lost trust. Safety is fast feedback + good tests + reversibility. Bring the DORA "no trade-off" evidence to the meeting.

7. **Leaving a required gate unowned.** An unowned required check is a single point of failure with no on-call — when it breaks, it blocks everyone and nobody's authorized to disable it. No gate ships without a named owner; "owner = nobody" is a deletion candidate.

8. **Under-investing in reversibility while over-investing in gates.** Without fast rollback you're forced to gate heavily up front. The cheapest safety improvement is often a canary + auto-rollback, which buys back gating budget *and* catches a broader class of problems.

---

## Test Yourself

1. Explain the "gate portfolio P&L" framing. Why do gate *costs* add linearly across the portfolio while gate *benefits* do not?
2. Your CFO can quote the cloud bill to the dollar but has no idea what the gate portfolio costs. Name the single number you'd put in front of leadership and how you'd compute it from CI telemetry.
3. What is "accretion," why is it the default trajectory of every pipeline, and name the three mechanisms a principal engineer uses as counter-pressure.
4. A required gate has 12% precision and a 40% bypass rate. A peer proposes requiring senior-engineer approval to override it. Why is this the wrong move, and what's the right one?
5. Walk through "normalization of deviance" for a flaky gate, and explain how it can cause a gate to *mask* a real failure.
6. How does investing in reversibility (flags, canaries, rollback) let you gate *less* without losing safety? Tie it to the DORA finding on speed vs stability.
7. In an incident review, someone proposes "require X on every PR" to prevent a recurrence. Give the four-part counter-frame you'd use, including the one-liner.
8. A change touches `migrations/**`. Under a three-tier risk model, what gate set should it get, and why is that *different* from what a docs-only change gets?

<details>
<summary>Answers</summary>

1. The portfolio P&L treats the whole set of gates as one managed inventory with a total cost (cumulative cycle-time tax across all changes) and a total benefit (real defects caught), and requires each gate to continuously justify its slot against a finite budget. **Costs add linearly** because every gate's latency stacks on *every* change that passes through it. **Benefits don't add** because they overlap heavily — multiple gates frequently catch the same class of issue, so you pay N times and catch once. Per-gate evaluation hides this redundancy; portfolio evaluation surfaces it.
2. "**Gates add a median X minutes to every merge, accounting for Y% of p95 lead time.**" Compute it by emitting a duration span per gate (`merge.gate.duration{gate,outcome}`), summing per change to get `time_in_gates`, and dividing by total lead time (`lead_time.in_gates / lead_time.total`). This connects gate design to DORA's *lead time for changes*, a metric leadership already values.
3. **Accretion** is the org pathology where gates are added after incidents and removed after none. It's the default because the addition decision is *motivated, individual, and visible* (an incident, a person, a cheap-looking fix) while the deletion decision is *unmotivated, diffuse, and invisible* (no one's incident is caused by a gate that exists). The three counter-pressures: (a) the **delete-a-gate ritual** (a quarterly review whose required output is a removal), (b) the **add-a-gate gate** (a new gate must name its failure class, owner, cost, and what it replaces), and (c) **sunset policies** (incident-driven gates auto-deprecate after ~2 quarters unless re-justified with P&L numbers).
4. It's wrong because 12% precision + 40% bypass means the gate is *dead* — the population has already correctly voted that it's not worth its cost. Adding approval to the override **policies the symptom and honors a broken gate**, forcing engineers to wait on (or escalate past) a gate that catches almost nothing. The right move: treat bypass as feedback, find *why* it's bypassed (too noisy/slow), and **fix the gate to high precision or delete it.**
5. (1) The gate is flaky, so under deadline pressure someone admin-merges past it; this feels exceptional. (2) Nothing breaks (the gate was mostly noise), so the bypass is rewarded. (3) Bypassing becomes the routine path under any pressure. (4) The gate is now dead. It can **mask a real failure** because when it eventually fires on a *genuine* defect, the firing is meaningless to everyone — they admin-merge past it like every other day — so the real problem ships inside the gate's accumulated noise.
6. Reversibility makes a bad change *cheap and fast to undo* (flag off, canary auto-rollback, one-click revert), which changes the economics: you can afford to gate *less* up front and catch problems *after* merge, in production, with a tight blast radius — and catching a bug in a 1% canary is *faster, cheaper feedback* than a 50-minute gate. This is the mechanism behind DORA's finding that elite performers deploy *more often* with *lower change-failure impact*: not by gating harder, but by making failure cheap enough that heavy up-front gating is unnecessary. Speed and stability are *positively* correlated, not a trade-off.
7. (a) **Reframe safety** away from gate count: safety is fast feedback + good tests + reversibility, not number of checks. (b) **Offer the alternative:** a canary/flag/rollback that catches this *class* of problem (and the next three like it) tax-free, vs a gate that taxes every change and catches only this one. (c) **Attach the price tag:** "this adds ~X min to ~Y changes/quarter = ~Z engineer-hours, competing with the budget for the gates that pay." (d) **Bring the DORA evidence:** speed and stability are positively correlated; gating harder buys slowness → bigger batches → *worse* stability. One-liner: *"Adding a gate after every incident is how pipelines rot until the gates throttle delivery and nobody trusts them — which is how the next incident ships anyway. Let's not buy slowness and call it safety."*
8. A `migrations/**` change is **high-risk** (often irreversible, high blast radius), so it should get the full automated suite **plus** two reviews (including a CODEOWNER), a manual sign-off, and a staged rollout with bake time and auto-rollback. A docs-only change is **standard/low-risk** and should get only lint + a build check and **auto-deploy on green with no human approval**. The difference is the whole point of risk-based gating: stop taxing the typo at migration rates, and *concentrate* the reclaimed review capacity on the change that can actually take down billing.

</details>

---

## Cheat Sheet

```text
PORTFOLIO VIEW (manage the set, not the gate)
  total cost   = Σ (gate latency × changes through it)   ← adds linearly
  total benefit= real defects caught                     ← overlaps; does NOT add
  RULE: every gate competes for a finite cycle-time budget; adding = spending

GATE P&L DASHBOARD (one row per gate)
  fire rate · precision(TPR) · added latency(p50/p95) · bypass rate
  last-real-catch date · owner · cost/catch
  feed it from:  merge.gate.duration{gate,outcome}  +  merge.gate.bypass{gate,reason}
  track: lead_time.in_gates / lead_time.total   ← gate tax as a DORA-linked metric

KEEP / FIX / DELETE
  high precision, low bypass, recent catch ........ KEEP
  high precision, HIGH bypass ..................... FIX the cost (not the bypass)
  low precision, high bypass ...................... DELETE (or rebuild)
  no catch 2+ quarters / owner=nobody ............. DELETE candidate

ACCRETION COUNTER-PRESSURE
  delete-a-gate ritual   → quarterly review whose OUTPUT is a removal
  add-a-gate gate        → name failure class + owner + cost + what it replaces
  sunset policy          → incident gates auto-deprecate in ~2 quarters

BYPASS = the population's vote
  <2% healthy · 2–10% watch · >10% dead · >50% theater (masks real failures)
  RULE: routine bypass → FIX the gate, do NOT police the override

RISK TIERS (don't tax every change the same)
  standard : docs/copy/flag-dark → lint+unit, auto-deploy
  normal   : app code → full suite + 1 review, auto + canary
  high-risk: migrations/auth/payments → full + 2 reviews + sign-off + staged

REVERSIBILITY BUYS SPEED
  invest in flags/canary/auto-rollback → gate LESS up front, catch AFTER
  DORA: speed & stability are POSITIVELY correlated — not a trade-off
```

---

## Summary

- **The unit of management is the portfolio, not the gate.** The full set of gates has a total cost (cumulative cycle-time tax, which adds linearly) and a total benefit (defects caught, which overlaps and does not add). Manage it like a budget: every gate competes for a finite cycle-time allotment, so adding one means *spending*, which means *justifying*.
- **Instrument it or you can't manage it.** Build a gate P&L dashboard — fire rate, precision, added latency, bypass rate, last-real-catch, owner, cost/catch — and track "time in gates" as a DORA-linked [engineering metric](../../engineering-metrics-and-dora/). The dead gates are not subtle once measured.
- **Fight accretion with deliberate counter-pressure.** Gates accrete because adding is motivated and visible while deleting is diffuse and invisible. Manufacture the deletion force: a delete-a-gate ritual, an add-a-gate gate (failure class + owner + cost + replacement), and sunset policies on incident-driven checks.
- **Bypass rate is your leading indicator.** When bypass becomes routine, the gate is already dead and may *mask* real failures. Fix or delete the gate; never police the override — that punishes people for being right. Pair with a legitimate [break-glass path](../07-break-glass-and-bypass/professional.md) so the bypass signal stays honest.
- **Tier by risk and invest in reversibility.** Don't tax a typo at migration rates. Classify changes (standard / normal / high-risk), and spend on flags/canaries/rollback so you can gate *less* up front — reversibility buys speed, and DORA proves speed and stability rise together.
- **Sell it with evidence, not refusal.** In the room where gates get added, reframe safety as fast feedback + reversibility, attach a price tag to every proposed gate, bring the DORA "no trade-off" data, and offer the trade (the gate it retires) rather than a "no."

You can now own the gate portfolio as a budgeted, instrumented, actively-pruned asset rather than an accreting pile of rules. The remaining tier — [interview.md](interview.md) — consolidates the whole topic into the questions that probe whether someone can actually run this at scale.

---

## Further Reading

- *Accelerate* (Forsgren, Humble, Kim) and the annual [DORA / State of DevOps reports](https://dora.dev/) — the empirical case that speed and stability are positively correlated, your primary ammunition against "more gates = more safety."
- *Continuous Delivery* (Humble & Farley) — deployment pipelines, fast feedback, and why small reversible batches beat heavy up-front gating.
- *The Principles of Product Development Flow* (Donald Reinertsen) — queues, batch size, and cost of delay; the economic theory underneath "gates are a tax on every change in the queue."
- *Site Reliability Engineering* and *The Site Reliability Workbook* (Google) — error budgets, progressive rollout, and reversibility as the substitute for up-front gating; also the canonical treatment of toil and why slow gates are toil.
- Diane Vaughan, *The Challenger Launch Decision* — the origin of "normalization of deviance," the model for how routine bypass kills a gate.
- Google's DevEx research and the *DevEx* framework (Noda, Storey, et al.) — slow and flaky gates as a top driver of developer friction; why gate latency is a DevEx metric.
- [interview.md](interview.md) — the questions that test whether someone can run a gate portfolio, not just design one gate.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/professional.md) — the individual checks that make up most of the portfolio; required vs advisory and flaky-check management.
- [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/professional.md) — manual approval as a gate, and the high-risk-tier sign-offs in the change-tier matrix.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/professional.md) — building the *legitimate* override path so bypass rate stays a meaningful gate-health signal.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — lead time, the "no trade-off" evidence, and the Goodhart trap of making gate-count the target.
- [Technical Debt Management](../../technical-debt-management/) — pipeline rot and accretion as a debt class; the sunset/prune discipline that pays it down.
