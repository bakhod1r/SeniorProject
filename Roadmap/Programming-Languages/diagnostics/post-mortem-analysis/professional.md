# Post-Mortem Analysis — Professional (Staff / Principal) Level

> **Topic:** [Post-Mortem Analysis Roadmap](README.md)
> **Focus:** Incident analysis as an *organizational capability*, not a personal skill. Org-wide learning-from-incidents (LFI) programs. Near-miss and weak-signal harvesting. Counterfactual-reasoning pitfalls at program scale. Post-mortem-driven reliability *investment* (turning analysis into budget). Large-scale forensic reconstruction — correlating distributed traces, core dumps, heap dumps, and logs across a *fleet*. SEV taxonomies and escalation as designed systems.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The Org-Wide Learning-From-Incidents Program](#the-org-wide-learning-from-incidents-program)
6. [Near-Miss and Weak-Signal Analysis](#near-miss-and-weak-signal-analysis)
7. [Counterfactual-Reasoning Pitfalls at Scale](#counterfactual-reasoning-pitfalls-at-scale)
8. [Post-Mortem-Driven Reliability Investment](#post-mortem-driven-reliability-investment)
9. [SEV Taxonomies and Escalation as a Designed System](#sev-taxonomies-and-escalation-as-a-designed-system)
10. [Large-Scale Forensic Reconstruction Across a Fleet](#large-scale-forensic-reconstruction-across-a-fleet)
11. [Correlating Traces + Core Dumps + Heap Dumps + Logs](#correlating-traces--core-dumps--heap-dumps--logs)
12. [Fleet-Wide Crash Triage and Bucketing](#fleet-wide-crash-triage-and-bucketing)
13. [The Evidence Pipeline: Capture, Retention, Symbolication at Scale](#the-evidence-pipeline-capture-retention-symbolication-at-scale)
14. [Adversarial Forensics at the Frontier](#adversarial-forensics-at-the-frontier)
15. [Measuring the Program Itself](#measuring-the-program-itself)
16. [The Reliability Council and Cross-Org Governance](#the-reliability-council-and-cross-org-governance)
17. [Code & Command Examples](#code--command-examples)
18. [A Worked Fleet-Scale Forensic Reconstruction](#a-worked-fleet-scale-forensic-reconstruction)
19. [Public Incident Stories, Read at Program Level](#public-incident-stories-read-at-program-level)
20. [Templates](#templates)
21. [Pros & Cons](#pros--cons)
22. [Use Cases](#use-cases)
23. [Coding Patterns](#coding-patterns)
24. [Clean Code](#clean-code)
25. [Best Practices](#best-practices)
26. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
27. [Common Mistakes](#common-mistakes)
28. [Tricky Points](#tricky-points)
29. [Test Yourself](#test-yourself)
30. [Tricky Questions](#tricky-questions)
31. [Cheat Sheet](#cheat-sheet)
32. [Summary](#summary)
33. [What You Can Build](#what-you-can-build)
34. [Further Reading](#further-reading)
35. [Related Topics](#related-topics)
36. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Stop running good post-mortems one at a time. Build the machine that makes every incident — and every near-incident — cheaper to learn from than the last, across the whole org, and forensically reconstructable months later from cold artifacts spread across a fleet.**

At senior level you internalized the conceptual frontier: kill the single root cause, reframe via local rationality, read a dump adversarially, engineer action-item follow-through, and close the outer loop for *your* incidents. That is the ceiling of individual mastery. It does not scale past the incidents you personally touch.

The staff/principal jump is a change of *unit*. Your unit is no longer the incident — it is the **program**: the standing apparatus of SEV taxonomy, escalation policy, evidence pipeline, learning reviews, near-miss intake, reliability budget, and the governance that decides where prevention dollars go. You are accountable not for whether *one* post-mortem was good but for whether the org **gets safer per unit of incident pain**, measured, over quarters, across teams that will never read each other's docs unless you build the channel that makes them.

Two things change in kind:

1. **Analysis becomes investment.** A senior writes action items. A principal turns the *aggregate signal* from hundreds of post-mortems into a reliability roadmap with a budget that competes — and wins — against feature work in the planning process. The deliverable is not a document; it is a funded program that kills classes of failure before they happen.
2. **Forensics becomes fleet-scale and cold.** A senior reads one dump with a hypothesis. A principal reconstructs an incident from **thousands of partial artifacts** — sampled traces that mostly missed the bad request, core dumps from 40 of 9,000 hosts, heap dumps that are days old, logs that rotated — and correlates them into a single causal story, often *after* the evidence has half-decayed. This is the discipline of building the *evidence pipeline* so that the reconstruction is possible at all, and then doing the cross-artifact join under real-world degradation.

> 🎓 **Why this matters for a principal:** The org already has people who can find a bug and write a blameless doc. What it lacks — what only you can provide — is the *system* that turns ten thousand incident-hours per year into a declining failure rate and a defensible reliability budget. Your signature is invisible in any single post-mortem and unmistakable in the *trend line*: classes of incident going quiet, MTTD bending down, near-misses surfacing before they become SEV-1s, and a forensic pipeline that lets a stranger reconstruct an outage from cold storage in an afternoon. If your org still depends on heroes to reconstruct incidents and still relives the same failure class every quarter, that is the gap you exist to close.

This file does **not** re-teach blamelessness, the root-cause critique, Swiss cheese / STAMP / New View, local rationality, the rubric, or the basic adversarial dump reads — those are owned at [`senior.md`](senior.md), and you are assumed to wield them cold. Everything here is the program-and-fleet frontier on top of that.

---

## Prerequisites

What you must already own, without reference:

- **Required:** All of [`junior.md`](junior.md), [`middle.md`](middle.md), and [`senior.md`](senior.md) — the entire conceptual and single-incident forensic toolkit. This file assumes you never write "root cause: X," never leave a counterfactual, and can read a smashed stack, a red-herring heap dominator, and an absent-producer goroutine dump without prompting.
- **Required:** You have *run a program*, not just incidents — owned a SEV policy, a learning-review cadence, or an error-budget process for more than one team.
- **Required:** Fluency with a real observability stack at scale (Prometheus/Mimir + Grafana + Loki + Tempo, or Honeycomb, or Datadog) and how each signal is *sampled, retained, and priced*. See [`../observability-engineering/README.md`](../observability-engineering/README.md) and [`../telemetry-cost-and-sampling-strategy/README.md`](../telemetry-cost-and-sampling-strategy/README.md).
- **Required:** You can drive `gdb`/`lldb`, `dlv core`, JVM `jcmd`/`jmap`/`jstack`, `py-spy dump`, and `coredumpctl` from memory, and you understand build-id/UUID symbolication. See [`../crash-reporting/README.md`](../crash-reporting/README.md) and [`../debugging/professional.md`](../debugging/professional.md).
- **Required:** Organizational standing — you can actually change the SEV taxonomy, fund a reliability project, or stand up a near-miss channel, not merely propose it.
- **Helpful:** Exposure to the safety-science literature *as program design*: Cook's *How Complex Systems Fail*, Dekker's *Drift Into Failure*, Allspaw/Adaptive Capacity Labs on Learning From Incidents, the LFI Community.
- **Helpful:** You have owned an SLO portfolio and watched error budgets translate into roadmap decisions.

---

## Glossary

| Term | Definition |
|------|-----------|
| **LFI** | Learning From Incidents — the discipline (and community) treating incidents as the org's richest source of system understanding, not just failures to be eliminated. |
| **Program (incident program)** | The standing apparatus: SEV policy, escalation, evidence pipeline, learning reviews, near-miss intake, reliability budget, governance. The principal's unit of work. |
| **Weak signal** | A faint, ambiguous indicator of latent trouble (a near-miss, a degrading SLO, a rising retry rate) that precedes an incident. Cheap to act on, easy to ignore. |
| **Near-miss** | An event that could have been an incident but wasn't, by luck or a defense that held. The cheapest tuition the org buys. |
| **Counterfactual (program-level)** | At scale: an *aggregate* "if only we'd staffed/prioritized/known" narrative that, like the individual kind, narrates a world that didn't happen and explains nothing. |
| **Cause class / failure mode taxonomy** | A controlled vocabulary tagging each incident's mechanism (cache-stampede, config-blast-radius, retry-storm, capacity, dependency-failure, deploy-coordination, data-corruption…). |
| **Reliability budget** | An explicit, defended allocation (% of eng capacity, or a headcount/quarter line) reserved for incident follow-up and class-killing platform work. |
| **Error budget** | The allowed unreliability under an SLO (1 − SLO over a window). When spent, policy *changes* (freeze features, shift to reliability work). |
| **SEV taxonomy** | The org's severity ladder (SEV-1..N) with crisp, objective entry criteria, escalation, and comms obligations per level. |
| **SEV deflation** | The pathology where teams downgrade severity to dodge the obligations (post-mortem, exec comms) the higher level requires — corrupting the data. |
| **Escalation policy** | The rules and routing (who pages whom, when an IC is mandatory, when execs/legal/comms join) attached to each SEV. |
| **Evidence pipeline** | The capture → transport → symbolication → retention → query path that makes cold artifacts (cores, heaps, traces, logs) reconstructable later. |
| **Forensic reconstruction** | Rebuilding the causal story of an incident from after-the-fact artifacts, often partial and decayed, spread across a fleet. |
| **Fleet** | The full set of hosts/pods/devices running a service (hundreds to millions), each a potential evidence source. |
| **Bucketing / clustering (crashes)** | Grouping many crash reports by a stable signature (top-frames hash, fault address class) so N crashes become 1 actionable signal. |
| **Provenance** | The metadata binding an artifact to its origin: build-id, host, region, deploy version, time, trace-id. Without it, correlation is impossible. |
| **Trace exemplar** | A trace-id attached to a metric point, enabling the jump from "p99 spiked at 14:32" to the exact request. The seam that stitches metrics→traces. |
| **Correlation key** | A shared identifier (trace-id, request-id, host-id, build-id, k-sorted timestamp) used to join signals across logs/traces/dumps. |
| **STELLA / SNAFU catcher** | Adaptive Capacity Labs' framing: resilience is the *work people do to keep things working* (SNAFU = situation normal, all fouled up); incidents reveal that adaptive capacity. |
| **Above/below the line** | Cook/Allspaw model: "below the line" = the technical system; "above the line" = the humans, mental models, and coordination acting on it. Most learning is above the line. |

---

## Core Concepts

### 1. The unit of work is the *program*, and its output is a *trend*

A senior is judged by a post-mortem; a principal is judged by a slope. The question is never "was this incident analyzed well?" but "is the org's failure rate *per cause class* declining, is detection getting faster, are near-misses surfacing earlier, and is the evidence pipeline good enough that a stranger can reconstruct an outage from cold storage?" If you cannot point at a trend, you have a pile of documents, not a program.

### 2. Aggregate signal beats any single analysis

One brilliant post-mortem teaches one lesson. The *distribution* of two hundred mediocre post-mortems, correctly tagged, tells you which **class** of failure is eating the org and therefore where a single platform investment kills the most future pain. The principal's highest-leverage act is rarely analyzing an incident — it is building the **taxonomy and the aggregation** that turns the corpus into a reliability roadmap. The insight "config-blast-radius caused 9 of our last 30 incidents" is invisible at the per-incident level and dispositive at the program level.

### 3. Near-misses and weak signals are the cheapest data the org will ever refuse to collect

For every customer-visible SEV, there are 10–100× as many near-misses carrying the *same lesson at zero customer cost*. Orgs systematically discard this because near-misses have no urgency — nothing broke, so nobody writes it up. The principal's job is to make near-miss capture *frictionless and culturally rewarded*, because a program that only learns from SEVs is paying retail for tuition it could get at a 95% discount.

### 4. Counterfactuals scale up into *organizational* hindsight

At senior level you strike "the on-call should have rolled back sooner." At program level the same poison reappears as "if only we had prioritized that reliability project last quarter" or "leadership should have funded the canary work." These *feel* like learning and are equally empty — they narrate a world that didn't happen and dodge the real question: *given the actual incentives, staffing, and information at the time, why was that the rational allocation?* Program-level local rationality is the same discipline pointed at the org's own decision-making.

### 5. Analysis is worthless until it becomes budget

A post-mortem that produces action items the team can't fund is theater with extra steps. The principal's distinctive contribution is the **translation layer**: turning the aggregate incident signal into a *defended reliability budget* that competes against features in the real planning process and wins, with the error-budget mechanism as the forcing function. If reliability work always loses to features silently, your analysis changes nothing.

### 6. Forensics at scale is a *join problem* over decayed evidence

A single dump is a frozen crime scene. A fleet incident is ten thousand partial crime scenes, most of them missing the relevant moment, half of them already decayed (logs rotated, sampled traces dropped, pods restarted before capture). The principal's forensic skill is **building the pipeline that preserves provenance** (so artifacts can be joined) and then **executing the cross-artifact join** — trace-id stitching metric→trace→log, build-id stitching dump→symbols, host-id+timestamp stitching dump→trace — under real degradation.

### 7. The SEV taxonomy is a *designed control system*, not a vibe

Severity is the org's central routing function: it decides who wakes up, who gets told, what comms fire, and what analysis is owed. Designed badly, it produces SEV-deflation (gaming the data), alert fatigue (everything is SEV-1), or silent under-response (real harm dismissed as SEV-3). Designed well, it is *objective, cheap to assign under stress, and game-resistant*. This is systems design, and it is yours to own.

---

## The Org-Wide Learning-From-Incidents Program

The senior closes the outer loop for their incidents. The principal builds the loop *as institution* so it closes for incidents they never see.

### The five pillars

| Pillar | What it is | Failure mode if absent |
|---|---|---|
| **Taxonomy** | Controlled cause-class + contributing-factor vocabulary, version-controlled, curated. | Every author invents categories; aggregation is impossible; recurrence hides. |
| **Evidence pipeline** | Capture→symbolicate→retain→query for cores/heaps/traces/logs with provenance. | Incidents are un-reconstructable after a day; you go blind retroactively. |
| **Learning reviews** | Recurring cross-team forums that read incidents for *understanding*, not status. | Lessons stay trapped in the affected team; the org repeats them. |
| **Near-miss intake** | Frictionless capture of events that didn't become incidents. | The org pays retail (SEVs) for lessons available at a discount. |
| **Reliability investment** | The budget + governance that funds class-killing work from the aggregate. | Analysis produces tickets nobody funds; recurrence never drops. |

You don't build all five at once. The usual maturation order: get *blameless single-incident* analysis working (senior-level), then **taxonomy** (so you can aggregate), then **learning reviews** (so lessons spread), then **near-miss intake** (so you learn cheaper), then **reliability investment** (so analysis becomes budget), with the **evidence pipeline** maturing in parallel because forensics gates everything.

### From per-incident to cross-incident, mechanically

The mechanism is dumb and that is its strength: **front-matter every post-mortem with structured metadata, parse the corpus, report the distribution.**

```yaml
---
id: INC-2026-05-29-001
sev: 2
date: 2026-05-29
duration_min: 6
cause_class: [cache-stampede, config-blast-radius]   # controlled vocabulary
contributing_factors: [no-canary, no-coalescing, no-pool-alert]
detection: alert            # alert | human | customer
mttd_seconds: 60
mttr_seconds: 420
customer_impact_pct: 12
revenue_impact_usd: 8400
action_items_open: 7
action_items_done: 0
teams: [checkout, pricing, sre]
---
```

Once every doc carries this, the corpus is a dataset. The quarterly question is not "what happened in incident X" but **"what do our last N incidents have in common, and where does one platform fix kill the most future pain?"** That single reframe — from narrative to distribution — is the whole program in one sentence.

### The learning review (not a status meeting)

The anti-pattern is the "incident review" that is really a status check: did the AIs land, who's accountable, next. Useful for follow-through, useless for *learning*. A real learning review (Allspaw/ACL style) asks instead:

- **What surprised people?** Surprise marks the gap between mental models and the system — the richest learning.
- **What made the work hard?** Coordination friction, missing tools, ambiguous ownership — the *above-the-line* findings that no timeline captures.
- **What expertise was load-bearing?** Whose tacit knowledge saved the day? That's a bus-factor and a documentation finding.
- **Where did the system surprise its own builders?** That's where the next incident lives.

Run these read-aloud, multi-team, with the affected engineers narrating their *experience* (not defending their decisions). The output is shared understanding, not a closed ticket. Google's "Wheel of Misfortune" (tabletop replay of past incidents) is the rehearsal complement.

### The searchable archive as infrastructure

A post-mortem nobody can find before repeating the incident taught nobody. The archive must be:

- **Grep-able / full-text searchable** (a wiki search box, or a real index — Elasticsearch over the corpus).
- **Tagged by cause class and contributing factor**, so "show me every stampede incident" is one query.
- **Linked from the alert and the runbook**, so the on-call meets the prior incident *at the moment they need it*, not by luck.
- **Front-matter-validated in CI**, so the dataset stays clean (no free-text cause classes leaking in).

> The test of the archive: when a new SEV opens, can the IC find every prior incident of the same class in under 60 seconds, from the alert itself? If finding the prior art requires knowing it exists, the archive is a drawer, not infrastructure.

---

## Near-Miss and Weak-Signal Analysis

This is the highest-ROI, most-neglected practice in the entire field, and standing it up well is a principal-defining act.

### Why near-misses are the cheap lessons

A near-miss carries the *same systemic lesson* as the incident it almost was — the same lined-up holes, minus one that happened to hold — at *zero customer cost*. The deploy that would have stampeded but landed at 3 a.m. with no traffic. The config typo one engineer caught by gut. The descriptor leak noticed at 60% before it hit `EMFILE`. Each is a SEV that *didn't happen*, and each is therefore free tuition the org will throw away unless you build the intake.

The classic safety-science ratio (Heinrich's pyramid, much-critiqued but directionally real): for each major incident there are many minor ones and *many more* near-misses and unsafe conditions. The base of the pyramid is where the cheap, abundant signal lives.

```text
                    ▲     1   major incident (SEV-1)        ← expensive, rare, urgent
                   ╱ ╲    ~10  minor incidents (SEV-2/3)
                  ╱   ╲   ~30  near-misses (held by luck)   ← SAME lessons, ZERO cost
                 ╱     ╲  ~600 weak signals / unsafe conds  ← the cheapest tuition of all
                ╱───────╲      (degrading SLOs, rising retries, normalized shortcuts)
   Orgs over-invest at the apex (urgency forces it) and ignore the base (no urgency).
   The principal's job: harvest the base before it climbs to the apex.
```

### Designing frictionless near-miss intake

Friction kills reporting, and a near-miss has no urgency to overcome friction. So:

- **One channel, thirty seconds.** A Slack `/near-miss` slash command or a three-field form (what nearly happened, what caught it, what class) feeding the *same dataset* as full post-mortems. If it takes longer than reporting a bug, it won't happen.
- **No blame, ever, structurally.** The reporter of "I almost took down prod" must be *thanked*, publicly, or the well poisons instantly. Near-miss reporting dies the first time someone gets a hard look for it. This is Just Culture's load-bearing test.
- **Tag with the same cause-class taxonomy.** A near-miss is data of the same kind; it must aggregate with incidents, or you've built a second silo.
- **Lightweight review, not full post-mortem.** Most near-misses deserve a paragraph and a tag, not a two-page doc. Reserve depth for the ones whose held-defense was *luck* rather than design — those are the apex incidents you almost had.

### Weak-signal analysis: the layer below near-misses

Below near-misses sit *weak signals* — conditions that aren't even events yet:

- An SLO slowly eroding toward its objective over weeks (drift into failure made measurable).
- A retry rate creeping up under load that nobody alerts on because it's "still fine."
- A normalized shortcut — "we always skip the canary for config changes" — that hasn't bitten *yet*.
- A queue depth trending up monotonically, hours from breaking.

The principal builds the **mechanisms that surface these before they become events**: SLO burn-rate alerting (multi-window, multi-burn-rate), trend alerts on saturation/retry/queue-depth, and a periodic "normalized deviance audit" where teams name the shortcuts they take. The goal is to *move detection left* — from incident, to near-miss, to weak signal — because every step left is an order of magnitude cheaper.

> **The counterintuitive metric (again, now at program scale):** a *rising* near-miss and weak-signal report rate is a **health** signal, not a problem signal. It means the org is surfacing the base of the pyramid before it climbs to the apex. A near-zero near-miss rate means either a perfect system (no) or a culture where nobody reports (yes). Reward the rising number.

---

## Counterfactual-Reasoning Pitfalls at Scale

Senior level killed the individual counterfactual ("she should have rolled back sooner"). At program scale the same cognitive defect reappears in subtler, more dangerous forms, because now it shapes *investment* and *culture*, not just one document.

### Pitfall 1: Organizational hindsight ("if only we'd funded X")

After a SEV-1, the seductive narrative is "if only leadership had funded the canary project last quarter, this wouldn't have happened." It *feels* like a systemic insight and is the same empty counterfactual one level up. It narrates a world that didn't happen and dodges the real question: **given the actual roadmap pressure, staffing, and information at the time, why was de-prioritizing the canary work the locally rational call?** Maybe three other fires were bigger. Maybe nobody had connected the canary gap to a concrete risk. *That* reconstruction — why the org's decision made sense at the time — is what changes the planning process. "Leadership should have known" changes nothing and corrodes trust.

### Pitfall 2: The outcome bias in severity and blame

Knowing the outcome contaminates the *severity* assessment and the *judgment of the operators*. The exact same action — a config push with no canary — gets called "reckless negligence" when it caused a SEV-1 and "fine, everyone does it" when it happened to land safely. This is **outcome bias**, and it's poison at program scale because it makes your SEV data and your culture a function of *luck*, not *behavior*. The discipline: judge the *decision quality given what was knowable*, independent of the outcome. A safe-by-luck bad decision and a harmful-by-luck bad decision are the *same* finding and deserve the *same* fix.

### Pitfall 3: Counterfactual action items ("add a check for exactly this")

The most common aggregate failure: each post-mortem produces an action item that prevents *the specific incident that just happened* — "add a validation for this exact config field." Run a hundred of those and you've built a hundred narrow checks for a hundred things that will never recur in exactly that form, while the *class* (no validation framework for config at all) stays open. Counterfactual AIs are hindsight crystallized into code: they fix the path the accident took, not the system that allowed the class. The principal's job is to push every narrow AI up to its class: not "validate this field" but "config changes go through a validation framework."

### Pitfall 4: Survivorship in the corpus

You only deeply analyze incidents that *happened*. The near-misses that were caught — the times the system's resilience *worked* — are systematically under-studied, so your corpus over-represents failures of defenses and under-represents *successes* of resilience. This skews investment toward "add more defenses" and away from "understand and strengthen the adaptive capacity that's already saving you." The fix is studying near-misses and *successful* incident responses with the same rigor as failures (the STELLA / "study the work, not the failure" move).

| Counterfactual pitfall | How it looks at scale | The local-rationality / class-level rewrite |
|---|---|---|
| Org hindsight | "If only we'd funded the canary work last Q." | "Given Q's roadmap pressure and that nobody linked the gap to a concrete risk, de-prioritizing was rational. The process fix: incidents feed a *risk register* that surfaces these links at planning." |
| Outcome bias | Same push judged 'reckless' or 'fine' by its luck. | "Judge the decision given what was knowable; the safe-by-luck case is the *same* finding. The fix is a guardrail that doesn't depend on luck." |
| Counterfactual AI | 100 narrow "check exactly this" items. | "Push each to its class: a validation *framework*, not 100 field checks." |
| Survivorship | Corpus over-represents failed defenses. | "Study near-misses and successful responses with equal rigor; fund the resilience that already works." |

> **Program-level reviewer move:** run the same `grep -niE 'should have|could have|if only|failed to'` over your *quarterly retrospectives and investment proposals*, not just individual post-mortems. Organizational hindsight hides in strategy docs, where it does the most damage.

---

## Post-Mortem-Driven Reliability Investment

This is the principal's distinctive output and the one that most separates the role from senior: **turning the aggregate incident signal into a funded, defended reliability roadmap.** Analysis that doesn't become budget changes nothing.

### The translation chain

```text
   incidents ─► tagged corpus ─► cause-class distribution ─► risk register ─► reliability roadmap ─► BUDGET
       │             │                    │                      │                  │                  │
   raw pain     queryable          "config-blast-radius      ranked by         class-killing      defended in
                dataset            = 9 of 30 + biggest $"     pain × likelihood  platform projects  planning vs features
```

Each arrow is a thing you build:

1. **Tagged corpus** — the front-matter discipline (above).
2. **Cause-class distribution** — the aggregator that, each quarter, ranks classes by *count × customer-impact × revenue × likelihood-of-recurrence*. Not just frequency — a rare class with huge blast radius outranks a common harmless one.
3. **Risk register** — a living, ranked list of *open* systemic risks (the classes not yet killed), each with an estimated cost-if-it-recurs and a candidate platform fix. This is the artifact that lets you say "here is the next SEV-1 waiting to happen, and here is what prevents it."
4. **Reliability roadmap** — the class-killing platform projects, scoped and sequenced, that drain the risk register.
5. **Budget** — the explicit, leadership-defended allocation that funds the roadmap.

### Making reliability work *win* against features

The default state is that prevention work loses to feature work silently, because feature work has a visible champion (the PM) and reliability work doesn't. Three mechanisms force the fight into the open:

- **The error-budget policy.** When a service burns its error budget, *policy changes automatically*: feature work freezes, the team shifts to reliability until the budget recovers. This converts reliability from "nice to have" into a hard gate. The principal owns the SLO→budget→policy chain so it actually triggers, not just exists on a wiki.
- **The reliability budget (capacity reservation).** A defended X% of every team's capacity (commonly 20–30% in mature orgs, but pick a number leadership will *defend under pressure*) reserved for incident follow-up and class-killing work, tagged `reliability` in the same backlog as features. Without a reserved, defended slice, every sprint silently spends it on features.
- **Costed risk, not vibes.** "We should invest in canaries" loses. "Config-blast-radius has caused 9 incidents and \$N in the last year; a config-canary platform (2 eng × 1 quarter) removes the class; the next occurrence is a likely SEV-1" wins, because it's an ROI argument in the language planning already speaks. Your risk register *is* the ammunition.

### The investment portfolio (don't fund only prevention)

Mirror the action-item classification at portfolio scale. A reliability roadmap that's all "prevent" has a hidden detection or recovery gap:

| Investment class | What it buys | Aggregate signal that demands it |
|---|---|---|
| **Prevent** | Kill a failure class (config-canary platform, shared coalescing primitive). | A cause class recurring across teams. |
| **Detect** | Bend MTTD down (SLO burn alerting, saturation trend alerts). | Detection-gap rate high (customers/humans detect before alerts). |
| **Recover** | Bend MTTR down (one-click rollback, failover drills, runbook coverage). | MTTR not improving despite detection gains. |
| **Investigate** | Make incidents reconstructable (the evidence pipeline itself). | "Couldn't determine X" appearing across post-mortems. |

> The "investigate" investment is the principal's signature and the one budget that never has a feature-PM champion. If your post-mortems repeatedly say "we couldn't determine X because logs rotated / the dump was lost / sampling dropped the trace," the evidence pipeline *is* a reliability project, and funding it is your job to argue.

---

## SEV Taxonomies and Escalation as a Designed System

Severity is the org's master routing function. Design it as a control system with objective inputs, cheap-under-stress assignment, and resistance to gaming.

### Design principles

- **Objective entry criteria, not judgment calls.** "SEV-1 = customer-facing total outage OR data-loss OR >X% error rate for >Y min OR regulatory/safety exposure." A stressed on-call at 3 a.m. must be able to assign severity *correctly in ten seconds* from observable facts, without a debate. Subjective ladders produce inconsistent data and slow response.
- **Severity drives obligations, and obligations must be worth dodging-resistant.** Each level carries duties: who pages, whether an IC is mandatory, comms (status page, exec notify, customer comms), and the *analysis owed* (full post-mortem vs lightweight). Make the obligations proportionate, or you breed SEV-deflation.
- **Separate severity (impact now) from priority (fix urgency) from cause-class (mechanism).** Conflating them corrupts all three datasets. A SEV-1 might have a trivial fix (priority); a SEV-3 might reveal a scary class (cause). Tag them independently.
- **Game-resistance is a first-class requirement.** If downgrading a SEV-2 to SEV-3 dodges the post-mortem requirement, teams will do it under deadline pressure, and your incident data becomes a function of how much people wanted to avoid paperwork. Counter with: objective criteria (less room to argue down), *automatic* severity from telemetry where possible (error-rate/duration thresholds auto-assign), and **audit** (sample downgrades; a rising downgrade rate near level boundaries is a deflation tell).

### A concrete SEV ladder

| SEV | Entry criteria (objective) | IC | Comms obligation | Analysis owed |
|---|---|---|---|---|
| **SEV-1** | Full/major outage; data loss/corruption; security breach; >5% error or >Y$ /min; safety/regulatory exposure. | Mandatory, dedicated | Status page + exec page + customer comms + (if applicable) legal/regulator. | Full post-mortem within 5 business days; leadership review. |
| **SEV-2** | Major feature down or severe degradation; single region; 1–5% error; significant but bounded customer impact. | Mandatory | Status page + exec notify (async). | Full post-mortem within 5 business days. |
| **SEV-3** | Minor/partial degradation; workaround exists; small customer subset; internal-only impact. | Optional | Internal channel. | Lightweight write-up + cause-class tag. |
| **SEV-4 / near-miss** | No customer impact; caught by luck or a held defense; weak signal. | No | None. | One-paragraph near-miss note + tag. |

Note SEV-4/near-miss is *in the ladder* — making near-misses first-class is what feeds the cheap-tuition pipeline.

### Escalation as routing

Escalation is the policy that turns severity into the right humans, fast, without over-paging:

```text
   alert / report ─► auto-severity from telemetry (error%/duration) ─► page primary on-call
        │                                                                      │
        │                                          ack < 5 min? ──no──► page secondary + IC
        │                                                                      │ yes
   SEV ≥ 2? ──yes──► page IC + service owners ─► SEV-1? ──yes──► exec bridge + comms + (legal)
        │                                                                      │
   SEV-3/4 ──► single on-call handles; no wake-ups                    rehearsed runbook per SEV-1 class
```

The principles: **auto-assign severity from telemetry where you can** (removes human deflation at the entry point), **page by need not by curiosity** (the senior rule, now policy), and **rehearse the high-SEV escalation** (a SEV-1 exec bridge that's improvised the first time is a second incident). The escalation policy is *written, versioned, and drilled* — never improvised at 3 a.m.

---

## Large-Scale Forensic Reconstruction Across a Fleet

Senior forensics: one dump, one hypothesis, cross-examined. Principal forensics: reconstruct the causal story from **thousands of partial, decaying artifacts across a fleet** — and, crucially, *build the pipeline that makes it possible at all*.

### Why fleet forensics is a different problem

| Single-incident forensics | Fleet-scale forensics |
|---|---|
| One dump; you have the binary. | Cores from 40 of 9,000 hosts; *which* build is on *which* host varies (rolling deploy in flight). |
| You captured state at the moment. | Most hosts never crashed; the trace you want was *sampled out*; logs *rotated*. |
| One hypothesis to falsify. | You must first *find the affected subset* among thousands, then form the hypothesis. |
| Provenance is obvious (it's your process). | Provenance must have been *captured at the time*, or correlation is impossible after the fact. |
| Minutes to read. | The reconstruction is a *join* across signals, often executed days later from cold storage. |

### The reconstruction method

1. **Scope the blast radius first** — *which* hosts/pods/regions/builds were affected, and over what window? You cannot reconstruct what you haven't bounded. Use metrics with high-cardinality labels (build-id, region, host) to draw the boundary: "error spike confined to build `v2.317`, us-east-1, 14:11–14:18, ~120 of 9,000 pods."
2. **Find a representative bad sample** — within the boundary, find *one* request/host/dump that exhibits the failure cleanly. Exemplars (trace-id on a metric point) are the fast path from "p99 spiked" to "here is the exact bad request."
3. **Stitch across signals via correlation keys** — the join is the whole game:
   - metric point → **trace-id** (exemplar) → the trace → **request-id**/log lines for that request → **host-id** → any core/heap dump from that host in that window.
   - dump → **build-id**/UUID → the right symbols (or you read garbage).
   - dump → **host-id + timestamp** → the trace and logs *from that host at that moment*.
4. **Confirm across multiple samples** — fleet incidents demand you avoid generalizing from one host. Check that the signature (top frames, fault address, leak retainer) is *consistent* across the affected subset, not an artifact of one weird host.
5. **Separate the affected from the unaffected** — the *difference* between a crashing host and a healthy one (same build? same region? same in-flight request? same neighbor?) is often the finding. This is a fleet-scale A/B on the evidence.

> The reconstruction is only as good as the **provenance you captured at the time**. The principal's forensic work is 80% pipeline design (ensuring build-id, host-id, trace-id, timestamp ride along with every artifact) and 20% the join itself. A core dump with no build-id and no host label is a beautiful, useless corpse.

---

## Correlating Traces + Core Dumps + Heap Dumps + Logs

The concrete cross-artifact join, with real commands. The seam between each pair of signals is a *shared key*; if the key wasn't captured, the seam doesn't exist.

### The correlation-key map

```text
   METRICS ──(trace-id exemplar)──► TRACES ──(request-id / span-id)──► LOGS
      │                                │                                 │
      │                          (host-id, ts)                     (host-id, ts)
      ▼                                ▼                                 ▼
   build-id label              CORE / HEAP DUMP ◄──(host-id + ts window)─┘
      │                                │
      └──────(build-id)────────────────┴──► SYMBOLS  (readelf -n / eu-unstrip / dwarfdump --uuid)
```

### Step 1 — Metrics → the bad request (exemplar → trace)

```promql
# Find the p99 spike, scoped to the affected build, with an exemplar attached.
histogram_quantile(0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket{
    service="checkout", build_id="v2.317", region="us-east-1"
  }[1m]))
)
# In Grafana/Tempo: click the exemplar dot on the spike → jump to trace 9f2a...
```

### Step 2 — Trace → the failing service + host (Tempo / OTEL)

```bash
# Pull the trace; find the longest span and the host that served it.
curl -s "http://tempo:3200/api/traces/9f2a3c..." \
  | jq '.batches[].scopeSpans[].spans[] | select(.durationNano > 1e9)
        | {name, host: (.attributes[] | select(.key=="host.name").value.stringValue),
           durMs: (.durationNano/1e6)}'
# → pricing-service.fetchCatalog, host=pricing-pod-7c4, 4120 ms  → go inspect THAT host.
```

### Step 3 — Trace → logs for that exact request (correlation id)

```logql
# Loki: pull every log line for that trace, across services, time-ordered.
{service=~"checkout|pricing"} | json | trace_id="9f2a3c..."
  | line_format "{{.timestamp}} {{.service}} {{.level}} {{.msg}}"
# The log line where pricing-pod-7c4 logged "pool acquire timeout" is your anchor.
```

### Step 4 — Host + timestamp → the dump from that host (fleet store)

```bash
# Cores are uploaded to object storage keyed by host+time+build. Fetch the right one.
aws s3 ls s3://fleet-cores/pricing/ | grep 'pricing-pod-7c4' | grep '2026-05-29T14:1'
aws s3 cp s3://fleet-cores/pricing/pricing-pod-7c4-20260529T141145Z-v2.317.core ./
# On systemd hosts, the local equivalent before upload:
coredumpctl list pricing-service
coredumpctl dump  pricing-service --output=./pricing.core   # extract the core
coredumpctl debug pricing-service                            # opens gdb with matched binary
```

### Step 5 — Dump → the RIGHT symbols (build-id is non-negotiable at fleet scale)

```bash
# The fleet is mid-deploy: hosts run DIFFERENT builds. Match build-id or read garbage.
eu-unstrip -n --core=./pricing.core | head        # build-ids of every module in THIS core
#   0x55a...  7b3c9f...  /app/pricing   ← this core's build-id
readelf -n /artifacts/pricing-v2.317 | grep -A1 'Build ID'   # the binary you think it is
#   Build ID: 7b3c9f...   ← MUST match the core's, or stop.
# Fetch the matching symbols from the symbol store by build-id (debuginfod is the clean way):
DEBUGINFOD_URLS=https://debuginfod.internal/ gdb /artifacts/pricing-v2.317 ./pricing.core
```

### Step 6 — Read the dump in the right runtime

```bash
# Native (C/C++/Rust): gdb / lldb
gdb /artifacts/pricing-v2.317 ./pricing.core -ex 'thread apply all bt' -ex quit | head -50
lldb -c ./pricing.core /artifacts/pricing-v2.317 -o 'thread backtrace all' -o quit

# Go: delve on a core (GOTRACEBACK=crash to get a core with all goroutines)
dlv core /artifacts/pricing-v2.317 ./pricing.core
(dlv) goroutines -with running        # which goroutines exist; find the absent producer
(dlv) goroutine 4012 bt               # the stuck consumer's stack

# JVM: there is no "core" the same way — match the hs_err / heap dump by pid+build.
jcmd <pid> GC.heap_dump /fleet/heaps/<host>-<ts>.hprof   # capture (live host)
#   crashed JVM: the hs_err_pidNNN.log file has the build, threads, and native frames.
#   Eclipse MAT on the .hprof: Dominator Tree → sort by RETAINED (not shallow).

# Python: a faulthandler/py-spy dump, plus the OS layer if C-extension is involved.
sudo py-spy dump --pid 12345          # Python stacks (may look healthy)
cat /proc/12345/wchan                 # kernel: what is it blocked in?
```

### The join, summarized

| From | To | Key | Command/seam |
|---|---|---|---|
| Metric spike | Bad request | trace-id (exemplar) | Grafana exemplar click |
| Trace | Slow service + host | span attrs (host.name) | `jq` on Tempo trace |
| Trace | Logs | trace-id / request-id | LogQL `\| json \| trace_id=…` |
| Host + ts | Dump | host-id + time window | `coredumpctl` / object-store key |
| Dump | Symbols | **build-id / UUID** | `eu-unstrip -n`, `readelf -n`, `debuginfod` |
| Dump | Cause | runtime reader | `gdb`/`lldb`/`dlv core`/MAT/`py-spy` |

If any one key was not captured at the time, that seam is broken and the reconstruction has a hole. **That is why the pipeline (next section) is the real forensic work.**

---

## Fleet-Wide Crash Triage and Bucketing

When 9,000 hosts can each crash, you don't read 9,000 dumps. You **bucket** them: turn N crashes into K distinct signatures, rank by impact, and analyze the top buckets. This is the Crashpad/Breakpad/Sentry/`systemd-coredump` model, and the principal's job is to make it work for the org's stacks.

### Signature design (the crux)

A crash signature must be **stable** (the same bug always hashes to the same bucket) yet **discriminating** (different bugs land in different buckets). The usual recipe:

- **Top N stack frames, normalized.** Hash the function names of the top ~5 frames *after* stripping addresses, line numbers, and inlining noise. Addresses change per build; function names are stable.
- **Skip the noise frames.** The actual crash is often a few frames below `abort`/`__assert_fail`/`malloc`/allocator internals. Skip known-noise frames so the signature reflects the *bug*, not the *failure mechanism*.
- **Include the fault class for native crashes.** `SIGSEGV` at a near-null address (null deref) vs a wild address (corruption) vs `SIGABRT` (assertion) are different bugs even with similar stacks. Fault address *class* (null / small-offset / wild / non-canonical) is a strong discriminator.

```bash
# A crude but effective native signature from a core: top frames, normalized.
gdb -q -batch -ex 'bt' /artifacts/svc ./core 2>/dev/null \
  | grep -oE 'in [a-zA-Z0-9_:]+' | head -5 | sed 's/ in //' \
  | tr '\n' '>' 
# e.g. "pricing::fetch>std::vector::push_back>operator new>..."  → sha1 → bucket id
```

```python
# Generic top-frames signature usable across runtimes (feed it parsed frames).
import hashlib, re

NOISE = re.compile(r'^(abort|__assert_fail|malloc|operator new|raise|'
                   r'gsignal|panic|runtime\.|java\.lang\.Throwable)')

def signature(frames: list[str], fault_class: str = "") -> str:
    meaningful = [f for f in frames if not NOISE.match(f)][:5]
    norm = [re.sub(r'\+0x[0-9a-f]+|:\d+', '', f) for f in meaningful]  # strip offsets/lines
    return hashlib.sha1((fault_class + "|" + ">".join(norm)).encode()).hexdigest()[:12]
```

### Triage by impact, not by count

A bucket hit by 8,000 hosts but only on one rare build is less urgent than a bucket hit by 200 hosts on the *current* build that's still rolling out. Rank buckets by:

- **New vs regression** — is this signature new in the current build (a fresh regression → halt the rollout) or a long-standing low-rate crash (chronic → backlog)?
- **Build correlation** — does the bucket *start* at a specific build-id? That's your trigger and your rollback target.
- **Trend** — is the bucket's rate *climbing* (a rollout reaching more hosts) or flat?
- **User/revenue weight** — crashes on paying-customer paths outrank background-job crashes.

> The fleet-forensics reframe: a single new crash signature appearing at the moment a build started rolling is a *rollback decision*, made from aggregate crash telemetry, often *before* anyone reads a single dump. Bucketing turns forensics into a real-time mitigation input, not just a post-hoc analysis.

---

## The Evidence Pipeline: Capture, Retention, Symbolication at Scale

The unglamorous infrastructure that makes every reconstruction above *possible*. Most orgs discover the gaps in this pipeline *during* an incident, when it's too late. The principal builds it before.

### Capture: collect the corpse cheaply, with provenance

The senior rule was "capture before restart." At fleet scale, capture must be *automatic, cheap, and provenance-rich*, because no human will be there to run it on 9,000 hosts.

| Runtime | Automatic capture | Provenance to attach |
|---|---|---|
| **Native (C/C++/Rust)** | `core_pattern` → `systemd-coredump` (`coredumpctl`) or a pipe to an uploader; `ulimit -c unlimited` via the supervisor. | build-id (auto in ELF), host-id, region, deploy version, timestamp, k8s pod/node. |
| **Go** | `GOTRACEBACK=crash` to dump *all* goroutines into a core on panic; `runtime/debug.SetTraceback`. | go build-id (`go tool buildid`), host, version. |
| **JVM** | `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=…` + `-XX:+CrashOnOutOfMemoryError`; `hs_err_pid*.log` auto-written on fatal. | JVM version, jar build, host; the `hs_err` log already carries build + native frames. |
| **Python** | `faulthandler.enable()` (stacks on fatal signal); `PYTHONFAULTHANDLER=1`. | interpreter version, package build, host. |
| **Mobile / desktop client** | Crashpad/Breakpad (Chrome model); minidumps uploaded on next launch. | app version, OS, device, symbol-file UUID. See [`../crash-reporting/README.md`](../crash-reporting/README.md). |

The non-negotiable: **provenance rides with the artifact.** A core named `core.12345` is useless; a core named `pricing-pod-7c4-20260529T141145Z-buildid-7b3c9f.core` is joinable. If you capture nothing else, capture the keys (build-id, host, time, version, trace-id-if-available).

```bash
# core_pattern that pipes the core to an uploader carrying provenance (Linux).
# /proc/sys/kernel/core_pattern:
#   |/usr/local/bin/core-upload %P %t %e
# core-upload then tags with host, region, k8s labels, and the binary's build-id, and
# writes to s3://fleet-cores/<svc>/<host>-<ts>-<buildid>.core (with a TTL lifecycle rule).
```

### Retention: dumps are huge; tier and expire them

A heap dump is the size of the heap; a core is the size of RSS. At fleet scale, naive retention is a budget fire. The principal designs the tiering (see [`../telemetry-cost-and-sampling-strategy/README.md`](../telemetry-cost-and-sampling-strategy/README.md)):

- **Triage on capture, store on signal.** Don't store every core. Bucket on capture (cheap signature), keep *one representative* per bucket per build, sample the rest, drop the redundant majority.
- **Hot → cold → expire.** Recent + current-build dumps in hot storage (queryable in the incident); older dumps to cold object storage; auto-expire after the investigation window (e.g. 30–90 days) via lifecycle policy. Encrypt at rest — cores contain secrets and PII (live memory!).
- **Symbols outlive binaries.** Retain the *symbol files / debuginfo* for every release **longer** than the dumps, indexed by build-id, in a symbol server (`debuginfod`, or a Breakpad/Crashpad symbol store). A dump six weeks later is worthless if the symbols for that build were garbage-collected. This is the single most common pipeline failure: dumps kept, symbols lost.

### Symbolication at scale: the build-id index

```bash
# A symbol server (debuginfod) lets any dump fetch its symbols by build-id, anywhere.
# Index every release's debuginfo on publish:
debuginfod-find debuginfo 7b3c9f...      # resolves build-id → debuginfo, no manual matching

# Breakpad/Crashpad model (clients, multi-platform): dump_syms at build time → symbol store,
# minidump_stackwalk symbolicates a minidump against the store by module UUID:
minidump_stackwalk ./crash.dmp ./symbols/ 2>/dev/null | head -30

# macOS clients: archive the dSYM per release, indexed by UUID:
dwarfdump --uuid MyApp.app/Contents/MacOS/MyApp     # the binary's UUID
# atos -o MyApp.dSYM -arch arm64 -l <load_addr> <addr>   # symbolicate one address
```

> **The pipeline test:** pick a random core from 45 days ago in cold storage. Can a stranger, today, fetch its symbols by build-id, attach the right binary, and read a correct backtrace — without asking the team that owns the service? If not, your pipeline has a hole, and that hole is a reliability investment ([the "investigate" class](#post-mortem-driven-reliability-investment)) waiting to be funded.

---

## Adversarial Forensics at the Frontier

Senior level taught reading *one* dump adversarially (smashed stack, `<optimized out>`, red-herring heap dominator, absent producer). At the frontier, the adversarial cases are *fleet-scale* and *cross-artifact* — the dump lies in ways only visible when you correlate it against the rest of the fleet.

### Frontier case 1: The dump is from the wrong build *because the fleet was mid-deploy*

You pull 40 cores from the incident window. Some symbolicate cleanly against `v2.317`; some produce garbage frames. The naive read: "corrupted dumps." The frontier read: the **rolling deploy was in flight** — some hosts ran `v2.316`, some `v2.317`, and you're symbolicating all of them against one binary. The fix is *per-dump* build-id resolution (debuginfod), and the *finding* is often that the crash signature *appears only on the new build* — which is your trigger and your rollback target. The build heterogeneity isn't noise; it's the A/B that localizes the regression.

### Frontier case 2: The leak is invisible in any single heap dump

A slow leak across the fleet may be *below the noise* in any one heap dump (each host caught at a random point in its leak trajectory). No single dump's dominator tree screams "leak." The frontier move: **diff dominator trees across time and across hosts.** Capture heap dumps from the *same host at two times* (or two hosts at different uptimes) and diff the retained-heap-by-class — the class whose retained heap *grows monotonically with uptime* is the leak, even when no single dump points at it.

```bash
# Two heap dumps from the same host, 1h apart; the GROWING class is the leak.
jmap -histo:live 12345 > h1.txt ; sleep 3600 ; jmap -histo:live 12345 > h2.txt
join -1 4 -2 4 <(sort -k4 h1.txt) <(sort -k4 h2.txt) \
  | awk '{ delta = $7 - $3; if (delta > 0) print delta, $1 }' | sort -rn | head
# The class with the largest positive delta is leaking; one dump alone would never show it.
```

### Frontier case 3: The crash is a *symptom* of a fleet-wide upstream death

47k goroutines stuck on `chan receive` on *one* host is a local absent-producer (senior level). The *same* signature appearing on *thousands* of hosts simultaneously is a different beast: a **shared upstream died** (a dependency, a config service, a Kafka cluster), and every consumer fleet-wide is now a victim in unison. The tell is *correlation across hosts*: a per-host bug stuck-set rises gradually and independently; a shared-upstream death produces a *synchronized* cliff across the fleet at one timestamp. Read the *cross-host time alignment* to distinguish a local bug from a dependency outage.

### Frontier case 4: Sampling dropped exactly the request you need

Distributed tracing is sampled (you can't keep every trace at fleet scale). The bad request's trace was, with near-certainty, *not* sampled — sampling is uniform, the bad request is rare. The frontier mitigations: **tail-based sampling** (decide *after* the request completes, keeping all errors/slow traces — so the bad ones are *never* dropped), and **exemplars** (which attach trace-ids to the metric buckets, biased toward outliers). If your tracing is head-sampled, your fleet forensics will routinely hit "the trace I want wasn't kept" — and fixing that is an evidence-pipeline investment, not a forensic technique.

### Frontier case 5: The "impossible" cross-host ordering (clock skew at scale)

Reconstructing a fleet timeline, you find host A logged an effect *before* host B logged its cause. The naive read: "the cause-effect model is wrong." The frontier read: **clock skew** between hosts (NTP drift, leap-second mishandling) makes cross-host log ordering *unreliable by milliseconds-to-seconds*. Never reconstruct cross-host causality from wall-clock timestamps alone — use the **trace's span ordering** (causally consistent within a trace) or logical clocks, and treat raw cross-host timestamps as approximate. A reconstruction that trusts wall clocks across a fleet will invent false causality.

| Frontier tell | Naive read | Cross-artifact / fleet read |
|---|---|---|
| Some cores garbage, some clean | "corrupted dumps" | rolling deploy mid-flight → per-dump build-id; regression localizes to the new build |
| No single heap dump shows a leak | "no leak" | diff dominator/histogram across time & hosts; the *growing* class is the leak |
| Stuck-set on thousands of hosts at once | "widespread bug" | synchronized cliff = shared-upstream death; consumers are victims in unison |
| The trace you need is missing | "bad luck" | head-sampling dropped it → tail-based sampling + exemplars (pipeline fix) |
| Effect-before-cause across hosts | "model wrong" | clock skew; use intra-trace span order, not cross-host wall clocks |

---

## Measuring the Program Itself

The senior measured a post-mortem's quality. The principal measures whether the *program* is making the org safer — and resists the gaming that every metric invites.

### Program metrics (and how each is gamed)

| Metric | Healthy direction | What it's really telling you | Gaming / blind spot |
|---|---|---|---|
| **Recurrence rate per cause class** | down | Are we *killing classes* or reliving them? The only near-ungameable signal. | Re-labeling the same class each time hides recurrence → curate the taxonomy. |
| **MTTD trend (per class)** | down | Is detection moving left? | Alerting on symptoms not causes can flatter MTTD while real detection lags. |
| **MTTR trend (per class)** | down | Is recovery improving? | Counting "mitigated" as "recovered" inflates it. |
| **Detection source mix** (alert/human/customer) | shift to *alert* | Are we finding our own problems? | "Auto-resolved" alerts that nobody saw count as alert-detected falsely. |
| **Near-miss & weak-signal report rate** | **up** | Is the culture surfacing the cheap base of the pyramid? | A *falling* rate often means fear, not safety — read it inverted. |
| **Reliability-budget utilization** | near target | Is prevention actually getting funded, or silently spent on features? | Tagging feature work as `reliability` to hit the number. |
| **Risk-register burn-down** | steady down | Are we draining systemic risk or just adding to it? | Closing risks without killing the class (cosmetic burn-down). |
| **Time-to-evidence** (incident → reconstructable) | down | Is the pipeline good enough to investigate? | Only measurable if you actually attempt cold reconstructions. |
| **Action-item class balance** | balanced | Not all "prevent"; detect/recover/investigate present. | All-prevent portfolios hide detection/recovery gaps. |

### The meta-principle: pair every gameable metric with the outcome it serves

Process metrics (% with post-mortem, time-to-publish, AI completion) are *necessary and gameable*. Outcome metrics (recurrence-by-class, MTTD/MTTR trends) are *what matter and harder to fake*. **Never report a process metric without the outcome it's supposed to drive.** "AI completion is 95%" is meaningless beside "and yet stampede-class recurred three times" — the pairing exposes the theater.

> **The one number a principal watches above all:** recurrence-by-cause-class. Everything else can be gamed by paperwork. If a class goes quiet for four quarters after its platform fix landed, the program *worked*. If the same class keeps recurring under different incident names, the program is producing documents, not safety — and no amount of green process dashboards changes that.

### Don't weaponize the metrics

Every metric here becomes poison the moment it's used to *punish* a team. SEV counts used in performance reviews breed SEV-deflation. AI completion used as a team OKR breeds trivial AIs. Near-miss rate used punitively kills reporting overnight. These metrics are **instruments for the program to learn about itself**, not sticks. The principal protects them from management misuse as fiercely as they protect Just Culture — because they have the same failure mode: the moment they threaten people, the data corrupts and you go blind.

---

## The Reliability Council and Cross-Org Governance

At scale, no single person can own every incident, yet the *learning* must cross team boundaries or the org relives the same class in five teams independently. The governance layer:

- **A reliability council / review board.** A small standing group (principals + SRE leads + a rotating eng rep) that reviews the *aggregate* — the cause-class distribution, the risk register, the recurrence trends — and *owns the reliability roadmap and budget*. It does not re-litigate individual incidents; it allocates prevention investment from the aggregate signal. This is where "config-blast-radius hit nine times" becomes a funded platform project.
- **Cross-team incident review.** The learning-review forum (above) run org-wide, so a stampede lesson in checkout reaches pricing, search, and inventory before they each rediscover it. The principal owns making the channel exist and lowering its friction.
- **A standards function.** Someone must own the SEV taxonomy, the cause-class taxonomy, the post-mortem template, the front-matter schema, and the evidence-pipeline SLAs — version-controlled, curated, evolved. Without an owner, each drifts and the dataset rots.
- **The error-budget policy as governance.** The council enforces the SLO→budget→policy chain: when a service is over budget, feature work *stops* by policy, not by negotiation. This is the mechanism that makes reliability investment non-optional, and it lives at the governance layer, not the team's discretion.

> The council's product is the **reliability roadmap with a defended budget** — the artifact that turns hundreds of incident-hours into a sequenced set of class-killing investments that win against features in planning. If your org has post-mortems but no body that owns the aggregate and the budget, the loop never closes at org scale; it closes per-team and the classes leak between teams forever.

---

## Code & Command Examples

### The full cross-artifact join, as a runbook

```bash
# 0. SCOPE: bound the blast radius from metrics (build, region, window).
#    Grafana/PromQL: error rate by build_id+region → "v2.317, us-east-1, 14:11–14:18".

# 1. EXEMPLAR → TRACE: click the spike's exemplar dot → trace 9f2a3c...

# 2. TRACE → SLOW SERVICE + HOST:
curl -s "http://tempo:3200/api/traces/9f2a3c..." \
  | jq '.batches[].scopeSpans[].spans[] | select(.durationNano>1e9)
        | {name, host:(.attributes[]|select(.key=="host.name").value.stringValue)}'

# 3. TRACE → LOGS (Loki):  {service=~"checkout|pricing"} | json | trace_id="9f2a3c..."

# 4. HOST+TS → DUMP:
coredumpctl list pricing-service
coredumpctl dump pricing-service --output=./pricing.core
#   or: aws s3 cp s3://fleet-cores/pricing/pricing-pod-7c4-20260529T141145Z-7b3c9f.core .

# 5. DUMP → SYMBOLS (verify build-id FIRST — fleet is mid-deploy):
eu-unstrip -n --core=./pricing.core | head
readelf -n /artifacts/pricing-v2.317 | grep -A1 'Build ID'   # MUST match
DEBUGINFOD_URLS=https://debuginfod.internal/ gdb /artifacts/pricing-v2.317 ./pricing.core \
  -ex 'thread apply all bt' -ex 'quit'
```

### Aggregate the corpus into a risk register (the investment input)

```python
# Parse front-matter from every post-mortem + near-miss; rank cause classes by PAIN,
# not just frequency. Output is the seed of the quarterly risk register.
import pathlib, yaml, collections

DOCS = pathlib.Path("postmortems")
pain = collections.defaultdict(lambda: {"n": 0, "usd": 0, "max_sev": 9, "recent": 0})

def front_matter(md):
    t = md.read_text()
    if not t.startswith("---"):
        return {}
    return yaml.safe_load(t.split("---", 2)[1])

import datetime
cutoff = datetime.date.today() - datetime.timedelta(days=90)
for md in DOCS.glob("*.md"):
    m = front_matter(md)
    for cls in (m.get("cause_class") or ["unclassified"]):
        p = pain[cls]
        p["n"] += 1
        p["usd"] += m.get("revenue_impact_usd", 0)
        p["max_sev"] = min(p["max_sev"], m.get("sev", 9))   # lower SEV num = worse
        d = m.get("date")
        if isinstance(d, datetime.date) and d >= cutoff:
            p["recent"] += 1

# Rank by a crude pain score: $ impact, frequency, severity, and recent recurrence.
def score(p):
    sev_weight = {1: 100, 2: 30, 3: 5}.get(p["max_sev"], 1)
    return p["usd"] + p["n"] * 1000 + sev_weight * 1000 + p["recent"] * 5000

print(f"{'cause_class':28} {'n':>3} {'recent':>6} {'$impact':>10}  score")
for cls, p in sorted(pain.items(), key=lambda kv: score(kv[1]), reverse=True):
    print(f"{cls:28} {p['n']:>3} {p['recent']:>6} {p['usd']:>10}  {score(p):>8}")
# The top rows ARE the reliability roadmap: highest pain × recurrence = fund the class-killer.
```

### Bucket fleet crashes into signatures (turn N dumps into K signals)

```python
# Walk a directory of minidumps/cores' parsed top-frames; bucket and rank by impact.
import collections
buckets = collections.defaultdict(lambda: {"hosts": set(), "builds": collections.Counter()})

for record in parsed_crashes():          # each: {host, build_id, top_frames, fault_class}
    sig = signature(record["top_frames"], record["fault_class"])   # from earlier
    buckets[sig]["hosts"].add(record["host"])
    buckets[sig]["builds"][record["build_id"]] += 1

for sig, b in sorted(buckets.items(), key=lambda kv: len(kv[1]["hosts"]), reverse=True)[:10]:
    top_build, n = b["builds"].most_common(1)[0]
    new = "NEW-IN-BUILD" if len(b["builds"]) == 1 else "chronic"
    print(f"{sig}  hosts={len(b['hosts']):>5}  {new}  top_build={top_build} ({n})")
# A NEW-IN-BUILD bucket climbing as a rollout spreads = a ROLLBACK decision from telemetry.
```

### Detect a fleet-wide leak that no single dump shows

```bash
# Same host, two times: the class whose retained heap GROWS is the leak.
jmap -histo:live "$PID" > /tmp/h1 ; sleep 3600 ; jmap -histo:live "$PID" > /tmp/h2
join -1 4 -2 4 <(sort -k4 /tmp/h1) <(sort -k4 /tmp/h2) \
  | awk '{ d=$7-$3; if (d>0) printf "%12d  %s\n", d, $1 }' | sort -rn | head
```

### Distinguish a local stuck-set from a fleet-wide upstream death

```bash
# Pull the stuck-goroutine count per host over time; SYNCHRONIZED cliff = shared upstream died.
# (one host, gradual rise = local bug; all hosts, same second = dependency outage)
promtool query range http://prom:9090 \
  'sum by (host) (go_goroutines{service="notify"})' \
  --start=2026-05-29T01:00:00Z --end=2026-05-29T01:30:00Z --step=10s | head
# If every host's count steps up at 01:08:xx together → the upstream (config svc) died at 01:08.
```

---

## A Worked Fleet-Scale Forensic Reconstruction

A realistic SEV-1 reconstructed from cold, partial evidence three days later. Demonstrates the join, the build heterogeneity, and the cross-artifact discipline. All times UTC.

**The report (3 days late):** "Customers report sporadic checkout failures Tuesday ~14:10–14:20. Our alerting *did* fire but nobody fully understood it; the incident was mitigated by an unrelated rollback and never properly analyzed. Reconstruct it."

**Step 1 — Scope from metrics.** Query error rate by `build_id` + `region` over Tuesday. Finding: errors confined to `checkout v2.317`, us-east-1, 14:11–14:18, peaking at ~120 of ~9,000 pods. The other 8,880 pods (still on `v2.316`, the rollout was at ~1.3%) were clean. **The boundary is drawn: a regression in `v2.317`, contained because the rollout was early.**

**Step 2 — Find a clean bad sample.** The error-rate metric has exemplars. Click a data point at 14:13 → trace `9f2a3c…`. Most traces in the window are *fine* (sampling kept mostly-healthy ones), but tail-based sampling retained this error trace. It shows `pricing-service.fetchCatalog` taking 4.1s, all of it in `db.acquire()` — **pool exhaustion**, not slow queries.

**Step 3 — Logs for that trace.** `{service=~"checkout|pricing"} | json | trace_id="9f2a3c…"` → checkout-pod on `v2.317` logged a *flood* of `pricing fetch` calls (cache-miss storm); pricing-pod-7c4 logged `pool acquire timeout`. **Anchor found: a stampede from the v2.317 checkout pods.**

**Step 4 — Get the dump from the right host.** Pricing-pod-7c4 didn't crash, but it dumped a heap on pool exhaustion (auto-capture on a saturation guard). Fetch `s3://fleet-cores/pricing/pricing-pod-7c4-20260529T141320Z-…hprof`. *Also* fetch a heap from a *healthy* pricing pod at the same time for the A/B.

**Step 5 — Read the dumps, with the right symbols.** Both pricing pods ran the same `pricing` build (the regression is in *checkout*, not pricing). MAT dominator tree on 7c4's heap: 11M `CatalogRequest` objects queued behind an exhausted pool — *symptom*, not cause. The healthy pod's heap is unremarkable. **The pricing dumps confirm the victim, not the culprit.**

**Step 6 — The culprit is in the checkout build diff.** Diff `v2.316`→`v2.317` of checkout: the cache TTL changed `30s`→`300s` (the same latent stampede risk from the senior worked example — but now caught in a *different* incident, on a *different team's* artifacts, weeks later, from cold storage). With the long TTL, the periodic catalog-invalidate cleared a *full* cache across the v2.317 pods at once → stampede on pricing.

**Step 7 — The fleet read.** Why only 120 pods and not catastrophic? Because the rollout was at 1.3%. **Had this reached 100%, it's a SEV-1 with pricing fully down.** The reconstruction's most valuable output is not "what happened" but *"we got lucky the rollout was early, and the same regression is still in the pipeline for the next deploy."*

**The meta-findings (the principal's delta):**

- **This is a recurrence.** The *identical* cause class (long-TTL + bulk-invalidate stampede) appears in the checkout post-mortem from three weeks ago. The per-team fix there (coalescing in *that* path) didn't generalize. **→ the class needs a platform fix: a shared coalescing primitive + a TTL-vs-invalidate-interaction lint.** (Risk-register entry, funded.)
- **The detection-comprehension gap.** Alerts *fired* but nobody understood them, so mitigation was accidental (an unrelated rollback). The alert didn't link the symptom (pricing pool) to the cause (a checkout deploy). **→ surface deploy markers + cross-service causality on the alert.** (Detect investment.)
- **The pipeline *worked*, and that's the only reason this was reconstructable at all.** Tail-based sampling kept the error trace; exemplars linked metric→trace; heap auto-capture on saturation preserved the victim state; build-id provenance let us symbolicate three days late. **Had any one of those been absent, the reconstruction fails.** That's the evidence-pipeline ROI, made concrete.

> The senior worked example *analyzed one incident in real time*. This reconstruction *recovered a missed incident from cold, partial, fleet-spread evidence days later, found it was a recurrence of a class a different team already "fixed," and turned it into a platform investment.* That delta — cross-team, cross-artifact, cold-storage, class-level — is the principal's forensic frontier.

---

## Public Incident Stories, Read at Program Level

Senior level read these for the failure structure. Program level reads them for what they say about the *org's incident program, evidence pipeline, and investment*.

### GitLab, 2017 — the program lesson: untested recovery is a program failure, not an operator failure

A tired engineer deleted the wrong directory; then **five separate backup/restore mechanisms were all broken or untested**. The senior read is local rationality + the meta-finding. The *program* read: the org had no mechanism that *continuously verified recoverability* — backups were a checkbox, not a tested capability. The program-level fix isn't "test the backups once"; it's a *standing* drill (game-day / chaos) that exercises recovery on a schedule, so the next "we have backups" is a tested claim. **Recovery capability is a reliability investment that must be continuously verified, and its absence is a program gap that no single post-mortem can close.** (GitLab's public, live-streamed handling is also the gold standard of a Just-Culture program in action.)

### Cloudflare, 2019 — the program lesson: a missing guardrail is a *class*, not an instance

A catastrophic-backtracking regex pegged global CPU. The senior read: latent condition + no staged rollout + no CPU guard. The *program* read: the fix Cloudflare committed to was **class-level** — regex complexity limits, staged rollout for *all* rule changes, a global CPU-runaway protection. They didn't patch the one regex; they killed the *class* of "a single rule can consume unbounded global CPU." That is post-mortem-driven *investment*: the incident funded a platform guardrail, not a one-off check. The program lesson is to push every "fix this rule" up to "fix the class of unbounded-cost rules."

### Knight Capital, 2012 — the program lesson: no aggregate signal, no early kill

\$440M in 45 minutes: stale code on 1 of 8 servers, a reused flag, no consistency check, no anomaly-halt. The *program* read: Knight had **no aggregate monitoring that would have screamed "our order flow is anomalous"** and no automated kill sized to the blast radius. A mature incident program would have (a) bucketed the runaway behavior into an instant signal, (b) auto-halted on the anomaly, and (c) had a rehearsed escalation for "trading is doing something insane." The absence of *detection-as-investment* and *rehearsed high-SEV escalation* turned a deploy slip into a company-ending event. Knight didn't survive — the ultimate cost of a missing program.

### The pattern at program level

| Incident | Senior read (single) | Program read (this file) |
|---|---|---|
| GitLab 2017 | local rationality + recovery meta-finding | recovery must be *continuously verified* (game-days); untested recovery is a program gap |
| Cloudflare 2019 | latent regex + missing defenses | fix the *class* (complexity limits, staged rollout for all rules) — investment, not instance |
| Knight 2012 | no defense-in-depth on deploy | no aggregate detection + no rehearsed high-SEV escalation = company-ending |

Read every public post-mortem twice now: once for the failure (senior), once for **what the org's *program* did or lacked** — because that's the layer you own.

---

## Templates

### Program-level quarterly reliability review (the artifact that funds the roadmap)

```markdown
# Reliability Review — Q2 2026

## 1. Aggregate incident signal (from the tagged corpus)
- Incidents this quarter: 31 (4 SEV-1, 9 SEV-2, 18 SEV-3).
- Cause-class distribution (count · $impact · recent recurrence):
  | class                | n | $impact | recurring? |
  |----------------------|---|---------|-----------|
  | config-blast-radius  | 9 | $74k    | YES (also Q1×6) |  ← top risk
  | cache-stampede       | 4 | $12k    | YES (also Q1×3) |
  | dependency-failure   | 5 | $31k    | flat |
  | capacity             | 6 | $9k     | down (Q1 fix landed) |  ← a class going quiet = WIN

## 2. Trends (the only ungameable signals)
- MTTD: 6m → 4m (detect investments landing). MTTR: 22m → 19m.
- Detection mix: 70% alert / 20% human / 10% customer (customer ↓ — good).
- Near-miss reports: 14 → 41 (UP = healthier reporting culture). 
- Recurrence: capacity class went quiet (Q1 platform fix worked); config-blast-radius still hot.

## 3. Risk register (open systemic risks, ranked)
| rank | class | est. cost-if-recurs | candidate fix | status |
|------|-------|---------------------|---------------|--------|
| 1 | config-blast-radius | likely SEV-1, ~$100k | config-canary platform | PROPOSED — fund this Q |
| 2 | cache-stampede | SEV-2, ~$15k | shared coalescing primitive | scoped (PLAT-77) |

## 4. Reliability investment ask (the budget)
- Fund config-canary platform: 2 eng × 1 quarter. Kills the #1 risk (9 incidents, $74k, Q1+Q2).
- Continue shared-coalescing primitive (PLAT-77).
- Evidence-pipeline: fund tail-based sampling rollout (3 "couldn't-investigate" findings this Q).
- Reserve: 25% of each team's capacity for `reliability`, defended by leadership.

## 5. Program health
- Evidence pipeline: time-to-reconstruct a cold incident = 1 afternoon (target met).
- Taxonomy: 2 new cause classes added; curated. Front-matter CI-validated: 100%.
- Governance: error-budget policy triggered a feature freeze on checkout (over budget) — worked.
```

### Near-miss intake (the 30-second form)

```markdown
# Near-Miss / Weak Signal
- What nearly happened: (one sentence)
- What caught it: (luck | a defense that held | a person's gut)  ← if "luck", escalate to review
- Cause class: (pick from taxonomy)
- Where we'd have been blind / lucky: (one sentence)
- (optional) Suggested defense:
> Reporter is THANKED, publicly. No blame, structurally. This feeds the same dataset as SEVs.
```

### SEV declaration (objective, cheap under stress)

```markdown
# SEV Declaration  — assign in <10s from observable facts
- Severity: SEV-_  (criteria: outage? data-loss? error% & duration? security? regulatory?)
- IC: @____   (mandatory for SEV-1/2)
- Comms fired: [ ] status page  [ ] exec notify  [ ] customer  [ ] legal/regulator
- Cause class (initial guess): ____   (separate from severity; refine later)
- Evidence captured: [ ] dumps persisted off-pod  [ ] traces retained  [ ] timeline started
```

---

## Pros & Cons

| Practice / capability | Pros | Cons |
|---|---|---|
| Org-wide LFI program | Lessons cross teams; classes die once for everyone | Heavy to stand up; needs sustained leadership will |
| Cause-class aggregation | Funds platform fixes that kill whole classes | Useless without disciplined tagging + critical mass |
| Near-miss / weak-signal intake | Cheapest possible tuition; moves detection left | Dies instantly without deep Just Culture |
| Reliability investment (budget) | Analysis becomes funded prevention; wins vs features | Requires costed-risk argument + leadership defense |
| Error-budget policy | Forces reliability work non-optionally | Needs real SLOs; can feel punitive if mis-set |
| SEV taxonomy as designed system | Consistent routing/data; game-resistant | Over-engineered ladders confuse the 3 a.m. on-call |
| Evidence pipeline | Cold incidents reconstructable; no hero needed | Real infra cost (storage, symbol servers); no feature champion |
| Fleet crash bucketing | N crashes → K signals; rollback from telemetry | Signature design is subtle; bad signatures merge/split bugs |
| Reliability council/governance | Owns aggregate + budget; closes the org loop | Can ossify into bureaucracy if it re-litigates incidents |
| Program metrics | The program learns about itself | Every metric gameable; weaponizing them corrupts the data |

---

## Use Cases

- **The same cause class recurs across teams** despite good per-incident post-mortems. → Aggregate by class, build the risk register, fund a platform fix that kills the class everywhere.
- **Leadership won't fund reliability work** because it has no champion. → Translate the incident corpus into costed risk; win the planning argument in ROI language; set an error-budget policy.
- **A SEV-1 was missed/misunderstood** and never analyzed. → Cold fleet reconstruction from retained traces/dumps/logs; the *evidence pipeline* is what makes it possible.
- **SEV data is corrupted by deflation.** → Redesign the taxonomy with objective, auto-assigned criteria; audit downgrades near level boundaries.
- **The org pays retail (SEVs) for every lesson.** → Stand up frictionless near-miss + weak-signal intake into the same dataset; reward the rising report rate.
- **Incidents are un-reconstructable after a day** (logs rotate, dumps lost, symbols GC'd). → Build the evidence pipeline: provenance-rich capture, tiered retention, a build-id symbol server.
- **Crashes flood in from a 9,000-host fleet.** → Bucket by signature; rank by impact + build correlation; turn forensics into a real-time rollback signal.
- **Quarterly planning has no reliability voice.** → Stand up a reliability council that owns the aggregate, the risk register, the roadmap, and the budget.

---

## Coding Patterns

### Pattern: CI-validated front-matter schema (the dataset stays clean)

```yaml
# .github/workflows/postmortem-lint.yml — reject docs with off-taxonomy cause classes.
# A controlled vocabulary in causes.txt; CI fails if a doc uses a class not in it.
- run: |
    ALLOWED=$(cat taxonomy/cause-classes.txt)
    for md in postmortems/*.md; do
      cls=$(yq '.cause_class[]' "$md")
      for c in $cls; do
        grep -qxF "$c" taxonomy/cause-classes.txt || { echo "$md: bad class '$c'"; exit 1; }
      done
    done
```

### Pattern: provenance-stamped core upload (joinable later)

```bash
# core_pattern pipe target: name the artifact so it can be joined to traces/logs/symbols.
# /proc/sys/kernel/core_pattern -> |/usr/local/bin/core-upload %P %t %e
BUILD_ID=$(readelf -n "/proc/$1/exe" | awk '/Build ID/{print $3}')
HOST=$(hostname); REGION=${REGION:-unknown}; TS=$(date -u +%Y%m%dT%H%M%SZ)
KEY="s3://fleet-cores/${3}/${HOST}-${TS}-${BUILD_ID}.core"
cat | aws s3 cp - "$KEY" --metadata "build_id=$BUILD_ID,host=$HOST,region=$REGION"
# Symbols for $BUILD_ID live in the symbol server, retained LONGER than this core.
```

### Pattern: tail-based sampling keeps the bad traces (the ones forensics needs)

```yaml
# OpenTelemetry Collector — keep ALL errors and slow traces; sample the boring ones.
processors:
  tail_sampling:
    policies:
      - name: errors            # never drop an error trace
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: slow              # never drop a slow trace
        type: latency
        latency: { threshold_ms: 1000 }
      - name: baseline          # sample the healthy majority
        type: probabilistic
        probabilistic: { sampling_percentage: 1 }
```

### Pattern: error-budget policy as code (reliability work becomes non-optional)

```python
# When a service is over its error budget, the deploy gate flips to "reliability only".
def deploy_allowed(service: str, change_type: str) -> bool:
    burned = error_budget_burned(service, window_days=30)   # 0.0–1.0+
    if burned >= 1.0 and change_type == "feature":
        raise DeployBlocked(
            f"{service} over error budget ({burned:.0%}). "
            "Feature deploys frozen; reliability work only until budget recovers."
        )
    return True
```

---

## Clean Code

- Every incident **and near-miss** carries CI-validated, machine-readable front-matter; the archive is a queryable dataset, not a drawer.
- The **cause-class taxonomy** is version-controlled and curated; off-vocabulary classes fail CI.
- Every artifact (core/heap/trace/log) carries **provenance** — build-id, host, region, version, timestamp, trace-id — captured *automatically* at the time, not reconstructed later.
- **Symbols/debuginfo are retained longer than dumps**, indexed by build-id in a symbol server (`debuginfod`/Breakpad store). Dumps without symbols are corpses.
- Tracing is **tail-sampled** (errors and slow traces never dropped) with **exemplars** on metrics, so the request forensics needs is the one that's kept.
- The **SEV taxonomy** has objective, auto-assignable criteria; severity, priority, and cause-class are *separate* fields; downgrades near boundaries are audited.
- A **reliability budget** (defended % of capacity) and an **error-budget policy** (auto feature-freeze over budget) make prevention non-optional.
- The **risk register** and **recurrence-by-class** report are *generated* from the corpus, not remembered.
- Program metrics are **instruments, never weapons** — never used to punish a team, or the data corrupts.

---

## Best Practices

1. **Treat the program, not the post-mortem, as the unit.** Measure the *trend* (recurrence-by-class, MTTD/MTTR, detection mix, near-miss rate), not the prose of one doc.
2. **Aggregate relentlessly.** Tag every incident and near-miss by cause class; the *distribution* tells you where one platform fix kills the most future pain.
3. **Harvest the base of the pyramid.** Frictionless, blameless near-miss and weak-signal intake into the *same dataset* — the cheapest tuition the org can buy. Reward a *rising* report rate.
4. **Kill organizational hindsight too.** Apply local rationality to the *org's own decisions* ("given the actual roadmap, why was de-prioritizing rational?"), not just the operators'. Judge decisions by what was knowable, independent of outcome.
5. **Push every action item up to its class.** Not "validate this field" but "config goes through a validation framework." Counterfactual AIs fix the path, not the system.
6. **Turn analysis into budget.** Build the corpus → distribution → risk register → roadmap → defended budget chain. Win the planning fight with costed risk, backed by an error-budget policy.
7. **Design the SEV taxonomy as a control system.** Objective, auto-assignable, game-resistant criteria; separate severity/priority/cause; audit deflation; rehearse high-SEV escalation.
8. **Build the evidence pipeline before you need it.** Provenance-rich automatic capture, tiered retention, symbols-outlive-dumps, tail-based sampling, exemplars, build-id symbol server.
9. **Bucket fleet crashes by signature.** Turn N dumps into K signals; rank by impact + build correlation; let a new-in-build bucket drive a rollback from telemetry.
10. **Do fleet forensics as a cross-artifact join over decayed evidence.** Scope first, find a clean bad sample, stitch via correlation keys, confirm across samples, contrast affected vs unaffected.
11. **Stand up governance that owns the aggregate.** A reliability council owning the risk register, roadmap, and budget — closing the loop at *org* scale, so classes don't leak between teams.
12. **Protect the metrics from weaponization** as fiercely as Just Culture; the moment they punish, the data corrupts and you go blind.

---

## Edge Cases & Pitfalls

- **The program becomes process theater.** Green dashboards (100% post-mortems, 95% AI completion) beside *rising recurrence* — the ritual runs, nobody learns. Pair every process metric with the outcome it serves.
- **Taxonomy drift hides recurrence.** The same class re-labeled each quarter looks like distinct incidents. Curate the vocabulary; CI-validate it; or the pattern stays invisible.
- **SEV deflation corrupts the dataset.** Make criteria objective and auto-assigned; audit downgrades near boundaries; never tie SEV counts to performance reviews.
- **Near-miss intake without real Just Culture.** Stand it up before reporting is safe and you get zero reports plus false confidence. The first hard look at a reporter poisons the well permanently.
- **Reliability budget that's "reserved" but always spent on features.** Without leadership *defending* the reservation under deadline pressure, it silently evaporates. The error-budget policy is the forcing function.
- **Symbols garbage-collected before the dump.** The most common pipeline failure: dumps retained, symbols for that build expired → cold dumps become unreadable. Symbols must outlive dumps.
- **Head-sampling drops the bad trace.** Uniform sampling almost never keeps the rare bad request. Tail-based sampling + exemplars, or your fleet forensics routinely dead-ends at "the trace wasn't kept."
- **Symbolicating a fleet of mixed builds against one binary.** Rolling deploys mean hosts run different builds; per-dump build-id resolution (debuginfod) is mandatory, or half your frames are plausibly wrong.
- **Cross-host wall-clock causality.** Clock skew makes effect-before-cause appear across hosts; reconstruct causality from intra-trace span order, never raw cross-host timestamps.
- **A leak below the noise of any single dump.** Diff dominator/histogram across time and hosts; the *growing* class is the leak no single dump reveals.
- **Counterfactual investment proposals.** "If only we'd funded X last quarter" in a strategy doc is organizational hindsight; rewrite via the org's local rationality at the time.

---

## Common Mistakes

1. **Running great post-mortems with no aggregation** — every lesson dies in the affected team; the org relives every class.
2. **Only learning from SEVs**, ignoring the 10–100× cheaper near-misses and weak signals.
3. **Counterfactual action items** that fix the exact path the accident took, leaving the class open — a hundred narrow checks, zero class-killers.
4. **Organizational hindsight** in retrospectives and investment docs ("leadership should have funded…"), which explains nothing and corrodes trust.
5. **Outcome bias** — judging the same decision as reckless or fine based on its luck, corrupting both SEV data and culture.
6. **Analysis that never becomes budget** — tickets nobody funds, because there's no costed-risk register and no error-budget policy.
7. **A SEV taxonomy that's subjective**, breeding deflation and inconsistent data; or *over-engineered*, paralyzing the 3 a.m. on-call.
8. **No evidence pipeline** — incidents un-reconstructable after a day; symbols GC'd before dumps; head-sampling dropping the bad trace.
9. **Reading 9,000 dumps individually** instead of bucketing into signatures and ranking by impact + build correlation.
10. **Generalizing a fleet incident from one host** — missing build heterogeneity, clock skew, and the affected-vs-unaffected contrast.
11. **No governance owning the aggregate** — the loop closes per-team and classes leak between teams forever.
12. **Weaponizing program metrics** — SEV counts or AI completion in performance reviews — which instantly corrupts the data they measure.

---

## Tricky Points

1. **The principal's output is a *slope*, not a document.** If you can't point at recurrence-by-class declining and detection moving left, you have a pile of post-mortems, not a program.
2. **A rising near-miss/weak-signal rate is *health*.** It means the cheap base of the pyramid is surfacing before it climbs to the apex. A near-zero rate means fear, not safety — read it inverted.
3. **Organizational hindsight is the same poison one level up.** "If only we'd funded X" narrates a world that didn't happen; the fix is the org's *local rationality given the actual roadmap*, which changes the planning process instead of assigning blame to leadership.
4. **Counterfactual AIs masquerade as diligence.** Fixing the exact path the accident took feels rigorous and leaves the class armed. Push every narrow AI up to its class.
5. **Severity must be assignable in ten seconds and resist gaming** — objective, auto-from-telemetry where possible, audited at the boundaries. Subjective ladders corrupt the dataset they exist to populate.
6. **The forensic work is 80% pipeline, 20% join.** A core with no build-id/host/timestamp is a beautiful useless corpse; provenance captured *at the time* is what makes any reconstruction possible later.
7. **Symbols must outlive dumps.** The most common evidence-pipeline failure is keeping cores and GC'ing the symbols for that build — turning cold dumps into unreadable garbage.
8. **The bad trace is the one head-sampling drops.** Tail-based sampling (keep all errors/slow) is what makes the request forensics needs survivable; uniform sampling fails the rare case by construction.
9. **A new-in-build crash bucket is a rollback decision from telemetry** — forensics becomes a real-time mitigation input, made *before* anyone reads a dump.
10. **Never trust cross-host wall clocks for causality.** Clock skew invents effect-before-cause; use intra-trace span order. Within a trace, order is causal; across hosts, timestamps are approximate.
11. **Recurrence-by-class is the only near-ungameable program metric.** Everything else can be faked by paperwork; if a class keeps recurring under different names, no green dashboard means the program works.
12. **Program metrics weaponized = data corrupted.** They are instruments for the program to learn about itself; the moment they threaten people, deflation and gaming destroy them — protect them like Just Culture.

---

## Test Yourself

1. Take your org's last 30 incidents. Tag each by cause class, rank classes by *count × $impact × recurrence*, and write the one-paragraph risk-register entry and reliability-budget ask for the top class.
2. Design a near-miss intake program: the 30-second capture mechanism, the Just-Culture guarantees, the taxonomy integration, and the metric you'd watch (and which direction is healthy).
3. Find an "if only we'd funded X" statement in a real retrospective or strategy doc. Rewrite it via the org's local rationality at the time, and show how the rewrite changes the *planning process* rather than blaming leadership.
4. Given a fleet of 9,000 hosts mid-rollout (1.3% on a new build) with a crash spike, write the exact steps — metrics, exemplar, trace, logs, dump, build-id — to localize the regression to the new build from cold storage.
5. Design a crash signature for your stack: which frames, how normalized, what fault-class discriminator. Show two different bugs that must *not* collide and one bug across builds that must *not* split.
6. Your tracing is head-sampled and the bad request's trace was dropped. Write the OTEL tail-sampling config that would have kept it, and explain why uniform sampling fails the rare case by construction.
7. Design a SEV taxonomy for a payments company: objective entry criteria per level, the obligations each level carries, how you auto-assign from telemetry, and how you audit for deflation.
8. Two heap dumps from the same host an hour apart show no obvious leak in either. Write the command that finds the leaking class from the *delta*, and explain why a single dump can't.
9. A stuck-goroutine signature appears on 4,000 hosts at the same second. Distinguish (with a query) a fleet-wide upstream death from 4,000 independent local bugs, and state the different fixes.
10. Define five program-level metrics, label each gameable/ungameable, describe how each is gamed, and name the outcome metric that guards it. Identify the one number you'd watch above all and defend why.

---

## Tricky Questions

1. **Q: Your incident program has 100% post-mortem coverage, 95% AI completion, green everywhere — yet customers feel the same outages recur. What's wrong?**
   A: The process metrics are green and gameable; the *outcome* metric is red. Look at recurrence-by-cause-class: the same class is recurring under different incident names, which means AIs are *counterfactual* (fixing the exact path, not the class) and there's no aggregation funding a class-killer. 100% coverage with rising recurrence is theater. The fix is the corpus→distribution→risk-register→funded-platform-fix chain, and pushing every narrow AI up to its class. No green dashboard substitutes for a class going quiet.

2. **Q: A reliability project keeps losing to feature work in planning despite obvious incident pain. How do you make it win?**
   A: You can't win on "we should invest in reliability" — that has no champion. You win three ways: (1) costed risk — "config-blast-radius caused 9 incidents and \$74k this year; the next is a likely SEV-1; the fix is 2 eng × 1 quarter" — an ROI argument in planning's own language, backed by your risk register; (2) an error-budget policy that *automatically* freezes features when a service is over budget, making reliability non-optional; (3) a defended capacity reservation leadership won't let evaporate. Analysis that doesn't become budget changes nothing.

3. **Q: You pull 40 cores from an incident; half symbolicate cleanly, half produce garbage frames. Junior says "corrupted dumps." What's actually happening?**
   A: The fleet was mid-rollout — different hosts ran different builds, and you're symbolicating all of them against one binary. The garbage frames are the *wrong build*, not corruption. Resolve symbols *per dump* by build-id (debuginfod), and notice the real finding: the crash signature likely appears *only on the new build*. The build heterogeneity isn't noise; it's the A/B that localizes the regression and names your rollback target.

4. **Q: Why is a *rising* near-miss report rate a good sign, and what would you conclude from a near-zero rate?**
   A: A rising rate means the org is surfacing the cheap base of the pyramid — events that didn't become incidents — before they climb to the apex, which requires a culture where reporting "I almost broke prod" earns thanks, not a hard look. It's the Just-Culture signal working. A near-zero rate means one of two things, and it's never "perfect system": it means fear — people don't report — so you're blind to your cheapest, most abundant data. You'd treat near-zero as an alarm, not a victory.

5. **Q: Your post-mortems keep saying "we couldn't determine X because logs rotated / the dump was lost / the trace was sampled out." Where does this go?**
   A: That's an evidence-pipeline gap, and it's a *reliability investment* (the "investigate" class) with no feature champion, so it's yours to argue. The fixes: tail-based sampling (errors/slow traces never dropped), provenance-rich automatic dump capture off-pod, symbols retained longer than dumps in a build-id symbol server, longer log retention or structured archival. "Time-to-reconstruct a cold incident" is the metric; if a stranger can't reconstruct a 45-day-old incident from cold storage in an afternoon, the pipeline has a hole worth funding.

6. **Q: A senior leader wants to use SEV counts and AI-completion rates in team performance reviews. Why do you push back hard?**
   A: Because the instant a metric punishes people, they optimize the metric, not the thing it measures. SEV counts in reviews breed SEV-deflation (downgrade to dodge the obligation), corrupting your severity dataset. AI-completion targets breed trivial AIs and bulk "won't-do" closes. These metrics exist for the *program* to learn about itself; weaponized, they destroy the data and you go blind — exactly the Just-Culture failure mode, one level up. Protect them as fiercely as blamelessness.

7. **Q: Reconstructing a fleet incident, host A logged an effect before host B logged its cause. Is your causal model wrong?**
   A: Almost certainly not — it's clock skew. Cross-host wall clocks drift (NTP, leap seconds) by milliseconds to seconds, so cross-host log ordering is unreliable for causality. Reconstruct causality from *intra-trace span ordering* (causally consistent within a trace) or logical clocks, and treat raw cross-host timestamps as approximate. A reconstruction that trusts wall clocks across a fleet will invent false cause-effect relationships.

8. **Q: A new crash signature appears the moment a build starts rolling out, on 0.5% of hosts. What's the decision, and did you read any dumps to make it?**
   A: The decision is *halt the rollout / roll back* — and you make it from aggregate crash telemetry (a new-in-build bucket climbing as the rollout spreads), often *before* reading a single dump. Bucketing turns forensics into a real-time mitigation input: the signature's *novelty* and *build correlation* are enough to act. You read the dumps *after*, to find and fix the bug; the rollback is a telemetry decision. This is the difference between fleet forensics (real-time signal) and single-incident forensics (post-hoc read).

---

## Cheat Sheet

```text
┌──────────────────── POST-MORTEM ANALYSIS — PROFESSIONAL (STAFF/PRINCIPAL) CHEAT SHEET ───────────────────┐
│                                                                                                          │
│  UNIT = THE PROGRAM, OUTPUT = A TREND                                                                    │
│    Judged by recurrence-by-class ↓, MTTD/MTTR ↓, detection-mix→alert, near-miss-rate ↑                    │
│    Not "was this PM good?" but "is the org safer per unit of incident pain?"                              │
│                                                                                                          │
│  AGGREGATE → INVEST                                                                                      │
│    tag every incident + near-miss by CAUSE CLASS → distribution → RISK REGISTER → roadmap → BUDGET        │
│    Win planning with COSTED RISK ("9 incidents, $74k, next=SEV-1, fix=2eng×1Q"), not vibes.               │
│    Error-budget policy: over budget → features FREEZE automatically. Defend the capacity reservation.     │
│                                                                                                          │
│  NEAR-MISS / WEAK SIGNAL = CHEAPEST TUITION                                                              │
│    10–100× the SEVs, same lesson, $0 cost. 30-sec frictionless intake, blameless, same dataset.          │
│    RISING report rate = HEALTH. Near-zero = FEAR. Move detection LEFT: incident→near-miss→weak signal.    │
│                                                                                                          │
│  COUNTERFACTUALS AT SCALE                                                                                │
│    Org hindsight ("if only we'd funded X") = empty → org local rationality given the real roadmap.        │
│    Outcome bias: same decision judged by its LUCK → judge by what was knowable.                           │
│    Counterfactual AIs (fix this exact path) → push UP to the CLASS.                                       │
│                                                                                                          │
│  SEV TAXONOMY = DESIGNED CONTROL SYSTEM                                                                  │
│    Objective + auto-from-telemetry + game-resistant. Separate SEVERITY / PRIORITY / CAUSE-CLASS.          │
│    Audit deflation at level boundaries. Rehearse high-SEV escalation. Near-miss IS in the ladder.        │
│                                                                                                          │
│  FLEET FORENSICS = A JOIN OVER DECAYED EVIDENCE (80% pipeline, 20% join)                                 │
│    metric→(exemplar)→TRACE→(trace-id)→LOGS→(host+ts)→DUMP→(BUILD-ID)→SYMBOLS                              │
│    coredumpctl / eu-unstrip -n / readelf -n / debuginfod / dlv core / MAT(retained) / py-spy             │
│    Scope FIRST (build,region,window) → clean bad sample → stitch keys → confirm across samples →          │
│      contrast affected vs unaffected. Mixed builds → per-dump build-id. Never cross-host wall-clock.      │
│    BUCKET crashes by signature (top frames + fault class); new-in-build bucket = ROLLBACK from telemetry. │
│                                                                                                          │
│  EVIDENCE PIPELINE (build it BEFORE you need it)                                                         │
│    Auto capture w/ PROVENANCE (build-id,host,region,ts,trace-id) · tiered retention · ENCRYPT (PII!) ·    │
│    SYMBOLS OUTLIVE DUMPS (build-id symbol server) · TAIL-SAMPLING (keep errors/slow) + exemplars.         │
│                                                                                                          │
│  GOVERNANCE: reliability council owns aggregate + risk register + roadmap + BUDGET + error-budget policy. │
│  METRICS ARE INSTRUMENTS, NEVER WEAPONS — weaponized = data corrupts = blind.                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **The unit of work is the program, and its output is a trend.** A principal is judged by recurrence-by-cause-class declining, detection moving left, and a forensic pipeline good enough that a stranger reconstructs a cold incident in an afternoon — not by the prose of any single post-mortem.
- **Aggregate relentlessly, then invest.** Tag every incident *and near-miss* by cause class; the distribution feeds a risk register, a reliability roadmap, and a *defended budget* that wins against features in planning via costed-risk argument and an error-budget policy. Analysis that doesn't become budget changes nothing.
- **Harvest the base of the pyramid.** Near-misses and weak signals carry the same lessons as SEVs at 10–100× lower cost; build frictionless, blameless intake into the same dataset, and treat a *rising* report rate as health.
- **Kill counterfactuals at scale too.** Organizational hindsight ("if only we'd funded X"), outcome bias, and counterfactual action items are the same poison one level up; reframe via the org's local rationality and push every narrow AI up to its class.
- **Design the SEV taxonomy as a control system** — objective, auto-assignable, game-resistant, with severity/priority/cause separated and escalation rehearsed; near-miss is a first-class rung.
- **Fleet forensics is a cross-artifact join over decayed evidence** — metric→(exemplar)→trace→(trace-id)→logs→(host+ts)→dump→(build-id)→symbols — and it's 80% pipeline (provenance, tail-sampling, symbols-outlive-dumps, build-id symbol server) and 20% the join. Bucket crashes by signature; a new-in-build bucket is a rollback decision from telemetry.
- **Watch for the frontier lies:** mixed-build symbolication, leaks invisible in any single dump (diff across time/hosts), synchronized stuck-sets (shared-upstream death), the dropped bad trace (head-sampling), and cross-host clock skew inventing false causality.
- **Stand up governance** — a reliability council owning the aggregate, risk register, roadmap, budget, and error-budget policy — so the loop closes at *org* scale and classes don't leak between teams.
- **Protect the program metrics from weaponization** as fiercely as Just Culture; the moment they punish people, the data corrupts and the org goes blind.

---

## What You Can Build

- A **reliability-investment pipeline**: parse front-matter from every post-mortem and near-miss into a store; emit the cause-class *pain ranking* (count × \$impact × severity × recurrence), the recurrence-by-class trend, the detection-source mix, and the auto-generated risk register that seeds the quarterly roadmap.
- A **near-miss / weak-signal intake bot**: a `/near-miss` slash command + three-field form feeding the same dataset as SEVs, with auto-thanks to the reporter and cause-class tagging; plus burn-rate and saturation-trend alerts that surface weak signals before they become events.
- A **fleet crash-bucketing service**: ingest cores/minidumps/`hs_err`/tracebacks, compute stable signatures (normalized top frames + fault class), cluster, rank by impact + build correlation, and fire a "new-in-build bucket climbing" rollback signal.
- An **evidence pipeline**: provenance-stamped automatic capture (core_pattern uploader, `GOTRACEBACK=crash`, JVM heap-on-OOM, `faulthandler`), tiered+encrypted retention with lifecycle expiry, a **build-id symbol server** (`debuginfod`/Breakpad store) that retains symbols longer than dumps, and tail-based sampling with exemplars.
- A **cross-artifact reconstruction tool**: given a trace-id or a metric spike, automatically pull the trace, the correlated logs, the dumps from the implicated hosts/window, verify build-ids, fetch symbols, and produce a stitched timeline — the cold-incident reconstructor.
- A **fleet leak detector**: diff dominator trees / histograms across time and hosts to surface the class whose retained heap grows with uptime — the leak no single dump reveals.
- A **SEV control plane**: auto-assign severity from telemetry thresholds, route escalation by SEV, fire the comms obligations, and audit downgrades near level boundaries for deflation.
- An **error-budget policy engine**: compute burn per service, gate deploys (feature-freeze over budget), and surface budget state to the reliability council.
- A **program-health dashboard**: recurrence-by-class, MTTD/MTTR trends, detection-source mix, near-miss rate, risk-register burn-down, and time-to-reconstruct — paired so every gameable process metric sits beside the outcome it serves.

---

## Further Reading

- John Allspaw & Adaptive Capacity Labs — *Learning From Incidents* writing; "Above the Line / Below the Line"; the STELLA report; why the *work* (not just the failure) is the unit of study. The program-level canon.
- Richard Cook, *How Complex Systems Fail* — eighteen observations; required reading, now re-read as program design (esp. on hindsight, the absence of a single root cause, and the role of practitioners' adaptive capacity).
- Sidney Dekker, *Drift Into Failure* — how locally rational decisions accumulate into organizational disaster; the systemic frame for "if only we'd funded X."
- *The SRE Workbook*, "Postmortem Culture" and the error-budget / SLO chapters; *Site Reliability Engineering* Ch. 15 — Google's templates, the wheel of misfortune, error-budget policy mechanics.
- The **Learning From Incidents in Software** community (howie guide, the LFI conference talks) — practical program-building, learning reviews, and facilitation at scale.
- Crashpad / Breakpad documentation and the Sentry/`systemd-coredump` models — fleet crash capture, minidumps, signature bucketing, symbol stores.
- `debuginfod` documentation; `coredumpctl`, `eu-unstrip`, `readelf -n` man pages — the build-id symbolication-at-scale toolchain.
- OpenTelemetry Collector docs — tail-based sampling and exemplars, the seam that keeps the traces forensics needs.
- Public post-mortems read at program level: GitLab 2017 (continuous recovery verification), Cloudflare 2019 (class-level guardrails), the Knight Capital SEC filing (missing aggregate detection + escalation); the CAIB/Columbia report (the gold standard of organizational investigation).

---

## Related Topics

- [`junior.md`](junior.md) — the two senses of post-mortem, blameless basics, timelines, 5 Whys, first core dump.
- [`middle.md`](middle.md) — running the review, the document, contributing factors, SEV levels, forensic reconstruction, the full dump walkthrough.
- [`senior.md`](senior.md) — the root-cause critique, Swiss cheese / STAMP / New View, local rationality, the meta-investigation, adversarial single-dump reads, action-items-as-a-system. **The conceptual floor this file builds on.**
- [`interview.md`](interview.md) — staff/principal incident-program and systems-thinking interview questions.
- [`tasks.md`](tasks.md) — labs: build a cause-class aggregator; reconstruct a cold fleet incident; design a SEV taxonomy.
- [`../debugging/professional.md`](../debugging/professional.md) — debugging as an org capability, observability triangle, building debuggability in, the live-incident counterpart to this file.
- [`../crash-reporting/README.md`](../crash-reporting/README.md) — automated fleet crash capture, minidumps, symbolication, and bucketing — the client/native side of the evidence pipeline.
- [`../observability-engineering/README.md`](../observability-engineering/README.md) — the metrics/logs/traces foundation that fleet forensics joins across.
- [`../telemetry-cost-and-sampling-strategy/README.md`](../telemetry-cost-and-sampling-strategy/README.md) — tail-based sampling, retention tiering, and the cost trade-offs the evidence pipeline must respect.
- [`../tracing/README.md`](../tracing/README.md) — distributed traces and exemplars, the seam that stitches metric→trace→log in every reconstruction.
- [`../logging/README.md`](../logging/README.md) — structured logs and correlation IDs, the raw material the join runs over.

---

## Diagrams & Visual Aids

### The translation chain: incidents → budget

```text
   INCIDENTS + NEAR-MISSES                                                   FUNDED PREVENTION
   ┌──────────────────┐   tag    ┌────────────┐  aggregate  ┌─────────────┐  rank  ┌──────────────┐
   │ raw pain (SEVs,  │ ───────► │ queryable   │ ──────────► │ cause-class │ ─────► │ RISK REGISTER│
   │ near-misses)     │ frontmtr │ corpus      │             │ distribution│        │ (ranked risk)│
   └──────────────────┘          └────────────┘             └─────────────┘        └──────┬───────┘
                                                                                           │ costed
                                                                                           ▼
   ┌─────────────────────────────────────────────────────┐   defends   ┌────────────────────────────┐
   │ ERROR-BUDGET POLICY (over budget → features freeze)  │ ◄────────── │ RELIABILITY ROADMAP+BUDGET │
   └─────────────────────────────────────────────────────┘             │ (class-killing platform work)│
                                                                        └────────────────────────────┘
        Analysis that does not reach the rightmost box changes NOTHING.
```

### The incident pyramid (harvest the base, not just the apex)

```text
                    ▲     1   SEV-1            ← expensive, rare, URGENT (orgs over-invest here)
                   ╱ ╲   ~10  SEV-2/3
                  ╱   ╲  ~30  near-misses      ← SAME lessons, ZERO customer cost
                 ╱     ╲ ~600 weak signals     ← degrading SLOs, rising retries, normalized shortcuts
                ╱───────╲     / unsafe conds      (the cheapest, most abundant tuition)
   Move detection LEFT: incident → near-miss → weak signal. Each step left = 10× cheaper.
   A RISING report rate at the base = HEALTH (safe reporting). Near-zero = FEAR, not perfection.
```

### Fleet forensics: the cross-artifact join over decayed evidence

```text
   METRICS ──(exemplar: trace-id)──► TRACE ──(trace-id / request-id)──► LOGS
      │ build_id,region labels           │ span attrs: host.name, dur          │ host, ts
      │ SCOPE the blast radius           │ find the SLOW span + HOST            │ anchor line
      ▼                                  ▼                                      ▼
   "v2.317, us-east-1,            pricing-pod-7c4, fetchCatalog 4.1s     "pool acquire timeout"
    14:11–14:18, 120/9000"                 │                                     │
                                           ▼ (host-id + ts window)               │
                                   CORE / HEAP DUMP ◄───────────────────────────-┘
                                           │  (mixed builds! resolve PER DUMP)
                                           ▼ (build-id)
                                        SYMBOLS  ── eu-unstrip -n / readelf -n / debuginfod
                                           │
                                           ▼
                                   gdb / lldb / dlv core / MAT(retained) / py-spy + /proc/wchan
   Any missing correlation key = a broken seam = a hole in the reconstruction.
   80% of the work is the PIPELINE that captured the keys; 20% is the join.
```

### Crash bucketing: N dumps → K signals → a rollback decision

```text
   9,000 hosts ─► cores/minidumps ─► SIGNATURE = sha1(normalized top frames + fault class)
                                          │
                ┌─────────────────────────┼─────────────────────────┐
                ▼                          ▼                         ▼
        bucket A (8000 hosts,      bucket B (200 hosts,       bucket C (12 hosts,
        old build, chronic)        NEW-IN-v2.317, climbing)   wild address, rare)
                │                          │                         │
            backlog              ROLLBACK v2.317 (from telemetry,    investigate
                                  before reading a single dump)      (memory-safety?)
   Rank by impact × build-correlation × trend, NOT by raw count.
```

### SEV as a designed control system

```text
   telemetry (error%, duration) ──auto-assign──► SEVERITY ──drives──► OBLIGATIONS
        │                                           │                    ├─ who pages / IC mandatory?
   (removes human deflation                         │                    ├─ comms: status/exec/customer/legal
    at the entry point)                             │                    └─ analysis owed: full PM / lightweight / note
                                                    │
                          SEPARATE FROM: priority (fix urgency) · cause-class (mechanism)
                                                    │
                          AUDIT downgrades near level boundaries  → deflation tell
                          REHEARSE high-SEV escalation            → no improvised exec bridge at 3 a.m.
```
