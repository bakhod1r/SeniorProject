# Engineering Metrics & DORA

> *"Measure to learn and improve, not to judge and reward."*

This roadmap is about measuring the **software delivery process and the teams that run it** — how fast and how safely change reaches users (DORA), where work actually spends its time (flow), how productive and healthy engineers really are (SPACE), and — above all — how to use those numbers to *improve a system* without corrupting the behaviour you measure.

> Looking for *code*-level quality numbers (complexity, coupling, duplication)? See [Code Quality Metrics](../code-quality-metrics/). This roadmap measures the *delivery process and the org*, not the source.
>
> Looking for *runtime* performance (latency, throughput)? See [Performance](../performance/).
>
> Looking for *what to do about slow delivery once you've measured it*? Pair with [Technical Debt Management](../technical-debt-management/) and the CI/CD and observability skills.

---

## Why a Dedicated Roadmap

"How productive is engineering?" is the question every executive asks and almost every org answers badly — with lines of code, commit counts, story points, or an individual leaderboard, all of which are wrong and several of which are actively harmful. The research-backed answer is a small set of **system-level, team-owned** measures (DORA's four keys, flow, SPACE) used to drive *improvement conversations*, paired with a hard-won understanding of **how metrics go wrong** (Goodhart, the McNamara fallacy, measuring individuals). Getting this right is the difference between metrics that accelerate a team and metrics that quietly teach it to game you.

| Roadmap | Question it answers |
|---|---|
| [Code Quality Metrics](../code-quality-metrics/) | How good is the *code*? |
| [Performance](../performance/) | How fast does the *software* run? |
| **Engineering Metrics & DORA** (this) | How well does the *team and delivery system* perform — and how do I measure that without breaking it? |

---

## Sections

Each topic ships the full five-tier set — **junior / middle / senior / professional / interview**.

| # | Topic | Focus |
|---|---|---|
| [01](01-dora-four-key-metrics/) | The DORA Four Keys | Deployment frequency, lead time for changes, change failure rate, time to restore; throughput vs stability; Elite→Low clusters; the *Accelerate* research |
| [02](02-flow-metrics-and-value-stream/) | Flow Metrics & Value Stream | Flow time/velocity/efficiency/load/distribution (the Flow Framework), value-stream mapping, WIP, wait states, finding the bottleneck |
| [03](03-space-framework/) | The SPACE Framework | Why productivity isn't one number — Satisfaction, Performance, Activity, Communication, Efficiency; mixing perceptual + system + workflow signals; DevEx |
| [04](04-lead-time-and-cycle-time/) | Lead Time & Cycle Time | The many definitions and where to start the clock; decomposing the pipeline (coding/pickup/review/CI/deploy/wait); reducing it; percentiles not means |
| [05](05-quality-and-reliability-metrics/) | Quality & Reliability Metrics | Change failure rate, MTTR/recovery, escaped defects, availability/SLOs/error budgets; the speed-vs-stability false trade-off; the reliability "fifth key" |
| [06](06-metrics-anti-patterns-and-goodhart/) | Metrics Anti-Patterns & Goodhart | Measuring individuals, LOC/velocity/commit counts, vanity & weaponized metrics, the McNamara fallacy; using metrics to improve, never to judge |

---

## Sources & Vocabulary

Grounded in: **Forsgren, Humble & Kim** — *Accelerate* and the **DORA** / State of DevOps reports (the four keys, the performance clusters); **Forsgren, Storey, Maddila, Zimmermann, Butler & Houck** — *The SPACE of Developer Productivity* (2021); **Mik Kersten** — *Project to Product* / the Flow Framework; **Noda, Storey, Forsgren & Greiler** — *DevEx* (2023); **Goodhart's law** and **Campbell's law**; the **McNamara fallacy**; Martin Fowler and the *cannotMeasureProductivity* essay; Google's re:Work / DevOps research.

---

## Status

✅ **Content-complete.** All 6 topics are written across the full five-tier set (junior / middle / senior / professional / interview): 30 topic files in total.

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place. Sits in [Quality Engineering](../) alongside [Code Quality Metrics](../code-quality-metrics/), [Technical Debt Management](../technical-debt-management/), [Code Coverage](../code-coverage/), and [Performance](../performance/).
