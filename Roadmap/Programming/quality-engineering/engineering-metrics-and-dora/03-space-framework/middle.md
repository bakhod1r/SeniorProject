# The SPACE Framework — Middle Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → The SPACE Framework
> *The junior page made the case that productivity isn't one number. This page turns that argument into a method: how to read each of the five dimensions, where to get the signal, and how to assemble a small balanced scorecard that resists gaming because it watches a team from several angles at once.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Five Dimensions, Concretely](#the-five-dimensions-concretely)
4. [Three Kinds of Metric — Perceptual, System, Workflow](#three-kinds-of-metric--perceptual-system-workflow)
5. [The Core Guidance — Pick from Three Dimensions, Mix the Types, Measure the Team](#the-core-guidance--pick-from-three-dimensions-mix-the-types-measure-the-team)
6. [SPACE vs DORA — Complementary, Not Competing](#space-vs-dora--complementary-not-competing)
7. [The Activity Trap](#the-activity-trap)
8. [Worked Example — Assembling a Balanced SPACE Scorecard](#worked-example--assembling-a-balanced-space-scorecard)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I turn "productivity is multidimensional" into a concrete, balanced metric set?**

At the junior level you learned the five letters — **S**atisfaction, **P**erformance, **A**ctivity, **C**ommunication, **E**fficiency — and the headline warning: never reduce productivity to a single number, and never measure individuals. That's the *what* and the *why*. This page is the *how*.

The SPACE framework's real contribution isn't the five words; it's a **selection discipline**. Its authors (Forsgren, Storey, Maddila, Zimmermann, Butler & Houck, 2021) deliberately did *not* hand you a fixed dashboard. They gave you a *menu* and three rules for ordering from it: span at least three dimensions, blend perceptual with system and workflow signals, and report at the team level. Follow those rules and you get a picture that's hard to fake. Ignore them and you get exactly the kind of activity leaderboard the framework was written to kill.

So this page does two things. First, it makes each dimension concrete — actual metrics you could collect on Monday, including which ones are easy (and therefore dangerous) and which are genuinely hard. Second, it walks the assembly: from a menu of candidate metrics to a small, defensible scorecard for one real team.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name the five dimensions and say why single metrics fail.
- **Required:** You've seen the [DORA four keys](../01-dora-four-key-metrics/middle.md) — SPACE assumes you already have a delivery-outcome story.
- **Helpful:** You've run or sat through at least one developer survey, even an informal retro poll.
- **Helpful:** You know where your team's data lives — Git host, issue tracker, CI, incident tool — because that's where most SPACE signals come from.

---

## The Five Dimensions, Concretely

The dimensions are *categories of evidence*, not metrics themselves. Each can be measured several ways; the skill is choosing one or two cheap, honest signals per dimension you decide to use.

**S — Satisfaction & well-being.** How fulfilled, healthy, and supported developers feel by their work and tools. This is the dimension everyone underrates because it has no row in a Git report — and it's often the *leading* indicator that delivery numbers are about to fall.

- Periodic **satisfaction surveys** ("I have the tools and information I need to do my job well" on a 1–5 scale).
- **eNPS** (employee net promoter score) — "would you recommend this team as a place to work?"
- **Burnout indicators** — self-reported energy/exhaustion items; sustained after-hours commit patterns as a *corroborating* signal, never the sole one.
- **Retention / voluntary attrition** — the lagging, brutally honest version of satisfaction.

**P — Performance.** The *outcome* of the work — not how much was produced, but whether what was produced was good. This is the dimension that most resists direct measurement, so you proxy it with quality and impact.

- **Quality & reliability outcomes** — change failure rate, escaped defect rate, [reliability/SLO attainment](../05-quality-and-reliability-metrics/middle.md).
- **Customer satisfaction** with the delivered feature (CSAT, adoption, support-ticket volume).
- **Review quality** — not review *count*, but whether reviews catch real defects and whether merged code stays merged.

> **Key insight:** Performance is about **outcomes**, and outcomes are genuinely hard to attribute to a team in a clean window — value lands weeks after the work, and many hands touch it. That difficulty is *why* teams quietly substitute Activity for Performance: commits are countable today, outcomes are murky for a quarter. Resisting that substitution is most of the discipline.

**A — Activity.** Counts of the actions developers take: **commits, pull requests, code reviews, deploys, documents written, issues closed.** This is the easy-to-count, easy-to-abuse dimension — the one every naive dashboard maxes out on.

Activity is not worthless. A *collapse* in deploy frequency or PR throughput is a real signal worth investigating. But Activity measures *motion*, not *progress*, and it inverts under pressure: tell a team you reward PR count and you'll get more, smaller, emptier PRs. Use it as a corroborating texture, never as the headline.

**C — Communication & collaboration.** How well information and work flow *between* people: discoverability, review participation, knowledge spread, onboarding.

- **PR review participation** — are reviews shared across the team, or funnelled through one overloaded person? (A review-load distribution, not a per-person score.)
- **Knowledge sharing** — bus-factor / code-ownership concentration; how many people can safely touch each critical area.
- **Onboarding time** — days from a new hire's start to their first merged change, then to independent productivity.
- **Discoverability** — can engineers find the docs, code, and people they need? (Usually a survey item — "I can find the information I need to do my work.")

**E — Efficiency & flow.** The ability to make progress with minimal friction, interruption, and delay — this is where SPACE ties directly into [flow metrics](../02-flow-metrics-and-value-stream/middle.md).

- **Flow time** — wall-clock from start to done for a unit of work (the value-stream view).
- **Handoffs** — number of team/role boundaries a piece of work crosses before it ships.
- **Interruptions & meeting load** — fragmentation of focus time; hours of uninterrupted "maker time" per week.
- **Wait time** — time work spends *blocked* (in review queue, awaiting deploy, waiting on another team) versus actively worked. High wait time is the most common, most fixable efficiency killer.

---

## Three Kinds of Metric — Perceptual, System, Workflow

Cutting *across* the five dimensions is a second axis that matters just as much: **where the signal comes from**. SPACE names three sources, and a healthy metric set draws from all three because each lies in a different way.

| Type | Source | Example | Its characteristic blind spot |
|---|---|---|---|
| **Perceptual** | People — surveys, interviews, ratings | "I can deploy with confidence" (1–5); eNPS | Subjective, recency-biased, survey fatigue |
| **System** | Tools — Git, CI, tracker, incident tooling | Deploy frequency, PR cycle time, CFR | Counts only what's instrumented; gameable |
| **Workflow** | The process between people | Handoff count, review wait time, meeting load | Hard to instrument; needs process mapping |

The reason to mix them is that their failure modes are *uncorrelated*. System data is precise but blind to how work *feels* and easy to inflate. Perceptual data captures lived experience but drifts and fatigues. Workflow data exposes the structural friction neither of the others sees. When all three agree, you can trust the story; when they *disagree* — system metrics say "fast" but survey says "miserable" — you've found something real and important to dig into.

> **Key insight:** A scorecard built only from system metrics (the Git-report dashboard) is the default failure mode, because tool data is the cheapest to collect. But tool data is also the *most gameable* and the *most silent about well-being*. The single highest-leverage move when improving a metric set is to add **one perceptual signal** — a three-question pulse survey — alongside the system numbers you already have.

---

## The Core Guidance — Pick from Three Dimensions, Mix the Types, Measure the Team

Here is the whole framework compressed into three rules. The SPACE authors are explicit that these are the point — not the acronym.

**1. Capture at least three dimensions.** Any single dimension can be gamed or can mislead in isolation; three or more force trade-offs into the open. A team that "improves" on Activity while Satisfaction and Performance sag is *not* improving, and a three-dimension set makes that visible at a glance. (More than three is fine; fewer is the trap.)

**2. Include more than one *type* of metric.** Combine **perceptual** (surveys), **system** (tool data), and **workflow** (process) signals. As above, mixing types is what makes the set robust to gaming and honest about experience. At minimum, pair system data with one perceptual signal.

**3. Measure at the team (or system) level, not the individual.** This is non-negotiable, and it's the rule most often broken. SPACE metrics describe a *system of work*, and software is a team sport — attributing commits or review counts to individuals creates incentives that *destroy* the collaboration the C and E dimensions are trying to protect. Engineers stop reviewing each other's code (it doesn't help *their* number) and stop helping teammates (no credit). Aggregate to the team; use the numbers to start improvement conversations, never to rank people.

> **Key insight:** These three rules interlock. Three dimensions stop you from optimizing one thing into the ground; mixed types stop any one source from lying to you; team-level aggregation stops the metrics from poisoning collaboration. Drop any one rule and the other two weaken — a three-dimension *individual* scorecard is still a leaderboard, and a team-level *single-type* scorecard is still gameable.

---

## SPACE vs DORA — Complementary, Not Competing

Teams new to metrics often ask "do we use DORA or SPACE?" The question contains a false choice. They measure different things and are designed to sit together.

| | DORA (four keys) | SPACE |
|---|---|---|
| **Measures** | Delivery *outcomes* — speed & stability of shipping | *Productivity broadly* — incl. how developers feel and collaborate |
| **Scope** | The delivery pipeline | The whole developer experience around it |
| **Signal types** | Almost all **system** | Deliberately **perceptual + system + workflow** |
| **Question** | "How fast and safely do we ship?" | "Are our developers effective *and* healthy *and* well-coordinated?" |
| **Blind spot alone** | Says nothing about burnout, collaboration, or focus | Broad menu — easy to assemble a vague set without DORA's sharp outcomes |

The clean way to see it: **DORA's four keys are an excellent set of System metrics that fit neatly inside SPACE's *Performance* and *Efficiency* dimensions.** Deploy frequency and lead time are Efficiency/Activity signals; change failure rate and time-to-restore are Performance signals. SPACE then *surrounds* those hard delivery numbers with the Satisfaction and Communication signals DORA never claims to cover.

> **Key insight:** Use DORA as your spine — the rigorous, research-backed delivery outcomes — and use SPACE as the body around it that adds *how the people doing the delivering are actually doing*. A team can hit Elite DORA numbers while quietly burning out; only the S and C dimensions of SPACE will tell you, and they'll tell you *before* the DORA numbers start sliding.

---

## The Activity Trap

The authors of SPACE issue two explicit warnings, and both are worth quoting in spirit because they're the most-ignored part of the whole paper.

**Warning one: never use a single metric.** Any lone number — even a good one like lead time — becomes a target the moment it's tracked, and a target gets optimized at the expense of everything it doesn't capture (this is [Goodhart's law](../06-metrics-anti-patterns-and-goodhart/middle.md), the subject of a whole later topic). A single metric also can't represent something as multidimensional as productivity; it can only represent a *shadow* of it.

**Warning two: never measure Activity alone.** Activity is seductive precisely because it's the easiest dimension to instrument — every Git host hands you commit and PR counts for free. But Activity-only measurement is actively harmful:

- It rewards *motion over outcome* — more commits, not better software.
- It inverts under pressure — measured PR count produces smaller, emptier PRs; measured lines-of-code produces bloat.
- It's silent about quality, well-being, and collaboration — three of the five dimensions.
- At the individual level it's a leaderboard, with all the collaboration-destroying incentives that implies.

The fix is structural, not motivational: you don't *exhort* people to ignore the activity numbers, you *dilute* them by always pairing Activity with at least one outcome dimension (Performance) and one human dimension (Satisfaction or Communication). A number can't be the sole target if it's never reported alone.

---

## Worked Example — Assembling a Balanced SPACE Scorecard

A platform team of seven owns an internal deployment service. Leadership wants "a productivity number." Instead of handing them one, you assemble a small SPACE scorecard. Walk the assembly against the three rules.

**Step 1 — list candidate metrics by dimension (the menu).**

| Dimension | Candidates |
|---|---|
| S | quarterly satisfaction pulse, eNPS, voluntary attrition |
| P | change failure rate, escaped-defect count, SLO attainment |
| A | deploys/week, merged PRs/week |
| C | review-load distribution, onboarding-to-first-merge time |
| E | flow time (p75), review wait time, weekly focus hours |

**Step 2 — select to satisfy the rules.** Pick a *small* set spanning **four** dimensions (≥3 ✓), mixing **all three types** (perceptual + system + workflow ✓), all reported at **team level** (✓). Keep it to roughly five metrics — a scorecard you can read in one screen and discuss in one meeting.

**The balanced scorecard:**

| Metric | Dimension | Type | Why it's here |
|---|---|---|---|
| Quarterly satisfaction pulse (1–5) | **S** | Perceptual | The leading indicator; the only window into well-being |
| Change failure rate | **P** | System | Outcome quality — did the work hold up in production? |
| Deploys per week (team) | **A** | System | Throughput texture — *diluted*, never the headline |
| Review wait time (p75) | **E** | Workflow | The team's most-suspected friction — work stuck in queues |
| Onboarding time to first merge | **C** | Workflow | Collaboration & knowledge spread; matters for a growing team |

**Step 3 — read it as a system, not a row of scores.** This set is *designed to trade off against itself*. If next quarter deploys/week climbs but the satisfaction pulse drops and change failure rate rises, the scorecard says plainly: **the team is shipping more by burning out and cutting quality** — the opposite of improvement, and invisible to an Activity-only dashboard. If review wait time falls *and* satisfaction holds *and* CFR is flat, that's a genuine, defensible win you can point at.

Note what we *didn't* do: we didn't track per-developer commit counts (individual-level — banned by rule 3), we didn't build a single composite "productivity index" (single metric — banned by the first warning), and we didn't fill the board with five system metrics (rule 2 — we deliberately spent two slots on perceptual/workflow signals tool data can't see). The scorecard is small, mixed, team-level, and honest. That's the entire goal.

---

## Mental Models

- **SPACE is a menu with ordering rules, not a fixed dashboard.** The value is the selection discipline — three dimensions, mixed types, team level — not the five words. Anyone who hands you "the SPACE dashboard" as a fixed set has missed the point.

- **Triangulation, like a GPS fix.** One satellite can't locate you; three intersecting signals can. One metric (or one *type* of metric) can't locate a team's productivity; perceptual + system + workflow intersecting can.

- **Activity is the team's pulse, not its health.** A pulse reading is easy to take and a *flatline* is alarming — but a strong pulse tells you nothing about whether the patient is well. Watch Activity for collapses; never mistake a high count for progress.

- **DORA is the spine; SPACE is the body.** DORA gives you rigorous delivery outcomes; SPACE wraps them in the human and collaboration signals DORA never measures. Use both — the spine alone can't tell you the patient is exhausted.

- **A metric reported alone becomes a target; a metric reported in a set becomes evidence.** Goodhart bites single numbers hardest. The scorecard's job is to make sure no number ever stands alone.

---

## Common Mistakes

1. **Measuring only Activity because it's free.** Commit and PR counts come straight from the Git host, so they become the whole dashboard. Activity-only measurement rewards motion over outcome and is silent on quality and well-being. Always pair it with a Performance and a human dimension.

2. **Building a system-only scorecard.** Tool data is cheap, precise, and *gameable*, and it never sees how work feels. A set with zero perceptual signals will look healthy right up until your best engineers quit. Add at least one survey item.

3. **Measuring individuals.** Per-person commit/review/PR counts create a leaderboard that destroys the collaboration the C and E dimensions exist to protect — people stop reviewing and helping because it doesn't move *their* number. Aggregate to the team, always.

4. **Collapsing the set into one composite "productivity score."** Averaging five dimensions into a single index re-creates exactly the single-number problem SPACE was written to solve, and hides the trade-offs that make the scorecard useful. Keep the dimensions visible and separate.

5. **Treating SPACE and DORA as a choice.** They measure different layers and are designed to nest. Picking one means either no human signal (DORA alone) or no rigorous delivery outcome (a vague SPACE set). Use DORA inside SPACE.

6. **Picking one dimension and calling it SPACE.** "We measure Efficiency, that's our SPACE metric" misses the entire selection discipline. One dimension is gameable and partial by definition — the framework's minimum is *three*.

---

## Test Yourself

1. What are the five SPACE dimensions, and which one is about *outcomes* rather than counts?
2. Name the three *types* of metric. Why does a healthy set need more than one type?
3. What are the three core selection rules SPACE gives you for assembling a metric set?
4. Why is the **Performance** dimension hard to measure directly, and why does that difficulty make Activity dangerous?
5. How do SPACE and DORA relate — competing, or complementary? Where do DORA's four keys sit inside SPACE?
6. Give two concrete metrics for **Communication** and two for **Efficiency**.

<details>
<summary>Answers</summary>

1. **S**atisfaction & well-being, **P**erformance, **A**ctivity, **C**ommunication & collaboration, **E**fficiency & flow. **Performance** is the outcome dimension — quality/reliability/customer impact, not counts.
2. **Perceptual** (surveys/people), **System** (tool data), **Workflow** (process). You need more than one because their failure modes are uncorrelated: system data is gameable and silent about feelings; perceptual data drifts and fatigues; workflow data exposes friction the others can't see. Mixing them makes the set robust and honest.
3. (1) Span **at least three dimensions**; (2) include **more than one type** of metric (perceptual + system + workflow); (3) measure at the **team/system level, never the individual**.
4. Value lands weeks after the work and many people touch it, so outcomes are hard to attribute to a team in a clean window. Because outcomes are murky-today and Activity is countable-today, teams quietly *substitute* Activity (commits/PRs) for Performance — rewarding motion instead of results.
5. **Complementary.** DORA measures delivery *outcomes* (speed & stability) almost entirely via system metrics; SPACE measures productivity *broadly*, adding perceptual and workflow signals about well-being and collaboration. DORA's four keys sit inside SPACE's **Performance** (CFR, time-to-restore) and **Efficiency/Activity** (deploy frequency, lead time) dimensions — DORA is the spine, SPACE the body around it.
6. **Communication:** PR review-load distribution; onboarding time to first merge (also: bus-factor/ownership concentration, discoverability survey item). **Efficiency:** flow time; review wait time (also: handoff count, weekly focus/maker hours, meeting load).

</details>

---

## Cheat Sheet

```
THE FIVE DIMENSIONS (categories of evidence, not metrics)
  S  Satisfaction  surveys, eNPS, burnout signals, retention/attrition
  P  Performance   OUTCOMES — CFR, escaped defects, SLO, CSAT, review quality   ← hard to measure
  A  Activity      commits, PRs, reviews, deploys, docs    ← easy to count, easy to abuse
  C  Communication review-load spread, knowledge sharing, onboarding, discoverability
  E  Efficiency    flow time, handoffs, interruptions, meeting load, wait time   ← ties to flow

THREE METRIC TYPES (mix them — uncorrelated blind spots)
  Perceptual  people  surveys, ratings        (subjective, fatigues)
  System      tools   Git/CI/tracker counts   (precise but gameable)
  Workflow    process handoffs, wait, meetings (exposes friction)

THREE SELECTION RULES (this IS the framework)
  1. ≥ 3 dimensions          → trade-offs visible, can't optimize one to death
  2. > 1 metric type         → no single source can lie to you
  3. TEAM level, never indiv → individual = leaderboard = kills collaboration

TWO EXPLICIT WARNINGS
  ✗ never a single metric   (it becomes a target — Goodhart)
  ✗ never Activity alone     (rewards motion, silent on quality & people)

SPACE vs DORA
  DORA  = delivery OUTCOMES (speed+stability), mostly System  → the spine
  SPACE = productivity BROADLY incl. how devs feel            → the body
  DORA's 4 keys nest inside SPACE's Performance + Efficiency. Use both.
```

---

## Summary

- The five dimensions — **S**atisfaction, **P**erformance, **A**ctivity, **C**ommunication, **E**fficiency — are *categories of evidence*, each measurable several ways. Performance is the **outcomes** dimension and the hardest to measure directly; Activity is the easiest to count and the easiest to abuse.
- Cutting across the dimensions are three **metric types** — **perceptual** (surveys), **system** (tool data), **workflow** (process). Their blind spots are uncorrelated, so a robust set draws from more than one; the highest-leverage fix to a tool-only dashboard is adding one perceptual signal.
- The framework *is* its three selection rules: span **≥ 3 dimensions**, **mix the types**, and measure at the **team level, never the individual**. The rules interlock — drop one and the others weaken.
- The authors explicitly warn against **single metrics** (they become Goodhart targets) and **Activity-only** measurement (it rewards motion and is silent on quality and well-being). The structural fix is to never report Activity alone.
- **SPACE and DORA are complementary.** DORA measures delivery *outcomes* and nests inside SPACE's Performance and Efficiency dimensions — the rigorous spine; SPACE surrounds it with the satisfaction and collaboration signals DORA never claims — the body.
- A good scorecard is **small, mixed, team-level, and self-trading-off** — five-ish metrics across four dimensions and all three types, designed so that "shipping more by burning out" shows up as a *loss*, not a win.

---

## Further Reading

- *The SPACE of Developer Productivity* — Forsgren, Storey, Maddila, Zimmermann, Butler & Houck (ACM Queue, 2021). The primary source; read it for the dimension/type matrix and the selection rules in the authors' own words.
- *Accelerate* — Forsgren, Humble & Kim. The research foundation for DORA, which SPACE assumes you pair it with.
- *DevEx: What Actually Drives Productivity* — Noda, Storey, Forsgren & Greiler (2023). The successor lens — flow state, feedback loops, cognitive load — that deepens SPACE's S and E dimensions.
- Martin Fowler, *CannotMeasureProductivity* — the essay on why output-based productivity measurement is a category error; the philosophical case behind SPACE's warnings.

---

## Related Topics

- [01 — The DORA Four Keys](../01-dora-four-key-metrics/middle.md) — the delivery-outcome spine that nests inside SPACE's Performance and Efficiency.
- [02 — Flow Metrics & Value Stream](../02-flow-metrics-and-value-stream/middle.md) — where SPACE's Efficiency dimension gets its flow-time, wait-time, and handoff signals.
- [05 — Quality & Reliability Metrics](../05-quality-and-reliability-metrics/middle.md) — the outcome measures that fill SPACE's Performance dimension.
- [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/middle.md) — why single metrics and individual measurement go wrong, in depth.
- [Documentation Quality](../../documentation-quality/) — discoverability and knowledge-sharing signals that feed SPACE's Communication dimension.
- [junior.md](junior.md) — the five dimensions and the case against single-number productivity.
- [senior.md](senior.md) — operationalizing SPACE at org scale, survey design, and DevEx.
