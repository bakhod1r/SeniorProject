# Dead Code & Complexity — Professional Level

> **Roadmap:** [Static Analysis](../README.md) → Dead Code & Complexity

*At the org level, complexity stops being a lint rule and becomes a portfolio instrument: an input to debt prioritization, a leading indicator of maintainability, and a metric that must be governed against Goodhart before it governs you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Complexity as a portfolio metric, not a per-PR gate](#core-concept-1--complexity-as-a-portfolio-metric-not-a-per-pr-gate)
5. [Core Concept 2 — The maintainability story complexity belongs to](#core-concept-2--the-maintainability-story-complexity-belongs-to)
6. [Core Concept 3 — Debt prioritization from static signals](#core-concept-3--debt-prioritization-from-static-signals)
7. [Core Concept 4 — Goodhart governance at organizational scale](#core-concept-4--goodhart-governance-at-organizational-scale)
8. [Core Concept 5 — Dead-code economics: when removal pays](#core-concept-5--dead-code-economics-when-removal-pays)
9. [Core Concept 6 — Org-wide dead-code campaigns and verification infrastructure](#core-concept-6--org-wide-dead-code-campaigns-and-verification-infrastructure)
10. [Core Concept 7 — Reporting to leadership without lying with numbers](#core-concept-7--reporting-to-leadership-without-lying-with-numbers)
11. [Core Concept 8 — Policy: thresholds, exceptions, and the long tail](#core-concept-8--policy-thresholds-exceptions-and-the-long-tail)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **operating dead-code and complexity analysis as organizational instruments — feeding debt prioritization, telling the maintainability story to leadership, and governing the metrics so they don't get gamed across hundreds of engineers.**

By this tier you are not running `gocyclo` on a function — you are deciding whether complexity is a KPI, how it feeds a debt backlog spanning hundreds of repos, what a "dead-code campaign" costs versus saves, and how to keep a metric honest when it's visible to leadership and hundreds of engineers who will (rationally) optimize whatever you measure. The technical mechanics are settled; the open problems are economic and organizational.

The throughline: **complexity and dead code are signals, never targets.** The professional's job is to extract decision-grade information from them while structurally preventing them from becoming the thing people game. Get the governance wrong and you get a codebase full of artificially-split functions and a leadership deck full of green numbers that mean nothing.

---

## Prerequisites

- The [senior tier](senior.md): safe deletion, hotspots, trend vs threshold, Goodhart at the team level.
- Experience owning a quality program or a multi-team codebase.
- Comfort with [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) and metric-governance pitfalls.
- Exposure to [Technical Debt Management](../../technical-debt-management/) frameworks.

---

## Glossary

| Term | Meaning |
|---|---|
| **Portfolio metric** | A measure aggregated and trended across many units to inform investment, not to gate individual changes. |
| **Maintainability Index** | A composite (volume, cyclomatic, comments) score; popular, widely criticized as opaque. |
| **Leading indicator** | A signal that moves *before* the outcome it predicts (complexity trend → future defect rate). |
| **Goodhart's law** | When a measure becomes a target, it ceases to be a good measure. |
| **Campaign** | A bounded, funded org-wide cleanup effort (e.g. "remove dead code in Q3"). |
| **Debt register** | A prioritized backlog of remediation items with cost/benefit estimates. |
| **Exception budget** | An allowance for justified threshold violations, tracked rather than silently suppressed. |
| **Toil** | Manual, repetitive work that scales with system size and yields no lasting value. |

---

## Core Concept 1 — Complexity as a portfolio metric, not a per-PR gate

The single most important professional reframing: **complexity's primary value is at the portfolio level, not the per-PR level.** A per-PR gate catches local regressions cheaply (keep it, soft), but the *decisions* that move the needle — where to invest refactoring capacity, which services to staff, what to rewrite — come from aggregated, trended data.

What a portfolio view looks like:

- **Distribution, not a single number.** Report the *shape*: the count of functions above 15, above 25, above 50. A long tail of complexity-50 functions is a different problem than a uniform creep upward.
- **Trend per service, normalized.** Absolute complexity scales with size, so track *complexity per KLOC* or the percentile distribution, and watch the slope per service over quarters.
- **Crossed with risk.** Complexity × churn × incident history per service tells you where complexity is *actually costing money* versus where it's inert.

```console
# Org rollup: count functions by complexity band, per service (CI artifact → warehouse)
service          fn>15   fn>25   fn>50   avg/KLOC   trend(4q)
billing           41      12       3       3.8        ↑↑
auth              18       4       0       2.1        →
notifications      6       1       0       1.4        ↓
```

`billing` with a steep upward slope and three monster functions is an investment decision, not a lint failure. No per-PR gate would surface this; the portfolio view makes it a budget line.

---

## Core Concept 2 — The maintainability story complexity belongs to

Complexity is one chapter in a larger maintainability narrative, and presenting it alone is misleading. The composite picture a professional assembles:

| Signal | Tells you | Caveat |
|---|---|---|
| Cyclomatic / cognitive complexity | How hard code is to change & test | Proxy; size-confounded |
| Test coverage (esp. on complex code) | Whether change is *safe* | Coverage ≠ correctness |
| Churn | Where change actually happens | High churn can be healthy (active feature) |
| Dead-code volume | Unused surface to maintain | False positives from reflection |
| Coupling / fan-out | How far a change ripples | — |
| Incident & MTTR history | Realized cost of poor maintainability | Lagging indicator |

The story is *"complex + under-tested + high-churn + incident-prone = a maintainability liability worth funding,"* not *"this function is 22."* The **Maintainability Index** (the SEI composite of Halstead volume, cyclomatic complexity, and comment ratio) tries to package this into one number — and is widely distrusted precisely because compressing these orthogonal signals hides which one is the problem and is trivially gamed (add comments, score rises). Prefer a small dashboard of orthogonal signals over a single composite. Complexity's role is to answer *"how hard to change?"* — let coverage, churn, and incidents answer the rest.

---

## Core Concept 3 — Debt prioritization from static signals

Static signals are the cheapest, most objective input to a debt register. The professional workflow turns raw metrics into ranked, costed remediation items:

1. **Harvest signals continuously** in CI: complexity, dead-code candidates, coverage, churn, duplication — exported to a warehouse, not just printed to a log.
2. **Score each candidate** by *risk-weighted leverage*: roughly `(complexity × churn × incident_weight) / estimated_effort`. This ranks "small fix, huge payoff" above "heroic rewrite, marginal payoff."
3. **Convert top items to register entries** with explicit cost/benefit, owner, and a hypothesis ("refactoring `computeInvoice` should cut billing-area regressions").
4. **Fund a fixed fraction** of capacity (e.g. 15–20%) against the register — predictable, not heroic.
5. **Measure the outcome**, not the activity: did incident rate / change-failure rate in the touched area fall? Close the loop back to [DORA](../../engineering-metrics-and-dora/) outcomes.

```text
DEBT REGISTER (top 3, auto-generated from static signals)
  rank  item                         cx   churn  incidents  effort  score
  1     billing.computeInvoice       27    142       6       M       HIGH
  2     auth.refreshSession          19     98       3       S       HIGH
  3     legacy.exportV1 (dead?)       —      2       0       S       MED(cleanup)
```

The discipline is to prioritize by *evidence* (these static signals) rather than by whoever complains loudest — and to validate by outcome so the register earns its capacity. Hand this to your [Technical Debt Management](../../technical-debt-management/) process as the objective seed of the backlog.

---

## Core Concept 4 — Goodhart governance at organizational scale

At one engineer, gaming is a temptation. At five hundred engineers with complexity on a dashboard leadership watches, gaming is a *rational, inevitable, systemic response* — and your job is to engineer it out structurally. This is the same governance problem [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) faces with developer-productivity metrics.

Structural defenses:

- **Never tie complexity to individual performance review.** The fastest way to corrupt a metric is to make a person's bonus depend on it. The instant you do, you measure compliance theater, not code health.
- **Keep per-PR thresholds advisory + reviewed.** A human reviewer catches the pointless split that the linter rewards; the linter flags, the human judges. (See the gaming example in the [senior tier](senior.md).)
- **Pair every metric with a balancing metric.** Cyclomatic with cognitive complexity; complexity-reduction with test coverage; speed with change-failure rate. Gaming one usually degrades its pair, making the dodge visible.
- **Report distributions and trends, never leaderboards.** "Team A has lower complexity than Team B" invites gaming and ignores domain differences (a crypto library *is* harder than a CRUD app).
- **Audit the deltas, not just the levels.** A sudden cliff-drop in a service's complexity right before a deadline is a gaming signal — investigate whether real refactoring or cosmetic splitting produced it.

The meta-principle: **measure to inform decisions, not to grade people.** A metric used for learning stays honest; a metric used for judgment gets gamed. This is non-negotiable and is the difference between a quality program and a bureaucracy.

---

## Core Concept 5 — Dead-code economics: when removal pays

Dead-code removal is not free virtue — it has a real cost (engineer time, regression risk, the tombstone observation window) and a real, mostly *deferred* benefit. The professional decides when the trade is worth funding rather than removing dead code reflexively.

Benefits (mostly long-tail): smaller cognitive surface, fewer misleading code paths, reduced attack surface, faster builds/tests, lower onboarding cost, less to migrate during the *next* big refactor or framework upgrade.

Costs (mostly upfront): verification effort (the senior-tier safe-deletion process), regression risk on false positives, and observation latency for code with invisible callers.

Heuristics for *when it pays*:

- **High-leverage triggers:** immediately before a large migration (don't port dead code), when dead code inflates the attack surface (unused auth/crypto paths), when it confuses a frequently-onboarded area, or when it blocks a dependency removal.
- **Low-leverage / defer:** stable, isolated, well-encapsulated dead code with plausible (but unconfirmed) external callers and no migration on the horizon — the removal risk outweighs the inert drag.
- **Automate the cheap tier:** unused imports and unused private locals are zero-risk and should be auto-removed by formatter/linter autofix in CI, never debated.

The framing for leadership: dead-code removal is *risk-and-cost reduction with deferred payoff*, best timed to coincide with work that makes the payoff immediate (a migration, an audit, a dependency upgrade).

---

## Core Concept 6 — Org-wide dead-code campaigns and verification infrastructure

When dead code accumulates across hundreds of repos, ad-hoc deletion doesn't scale — you run a **campaign** with shared verification infrastructure, because the bottleneck is *verification*, not deletion.

Campaign anatomy:

1. **Inventory** across all repos with consistent tooling (`deadcode`, `knip`, `vulture` standardized in a shared CI template), producing one ranked candidate list.
2. **Centralize the false-positive knowledge.** Maintain org-wide allowlists/conventions for the systematic blind spots — DI bean naming, serialization annotations, reflective-dispatch patterns, public-API markers — so each team isn't rediscovering "Spring beans look dead" independently.
3. **Provide tombstone-as-a-service.** A shared library/decorator that emits a standard metric+log on call, so any team can instrument a suspect symbol and watch a common dashboard — this is the *verification infrastructure* that makes safe deletion cheap at scale.
4. **Time-box and observe.** Run instrumentation for one agreed business cycle org-wide, then sweep deletions of confirmed-zero-call symbols.
5. **Prevent recurrence.** Add `--new-from-rev` dead-code gates so new dead code is caught at the PR that introduces it — the cheapest possible moment.

The recurring lesson: at scale the binding constraint is *verifying* deletions safely, so investing in shared tombstone/observability infrastructure has far higher ROI than any individual deletion. The reflective-false-positive problem, manageable per-function, becomes a knowledge-management problem across an org — and centralizing that knowledge is the campaign's real deliverable.

---

## Core Concept 7 — Reporting to leadership without lying with numbers

Leadership wants a number; complexity is easy to misrepresent. The professional reports honestly:

- **Lead with outcomes, support with signals.** "Change-failure rate in billing is double the org median; the area's complexity trend is up and coverage is low" — complexity *explains* the outcome, it isn't the headline.
- **Show trend and distribution, not a single score.** A single "code health = 7.2" invites exactly the false confidence (and gaming) you're trying to avoid.
- **State the proxy honestly.** Say plainly: complexity correlates with defect risk but doesn't cause it and is confounded by size — so the *direction* of the trend matters more than the absolute level.
- **Tie investment asks to risk, not aesthetics.** "Fund refactoring these three hotspots to reduce incident rate," never "our complexity number looks bad."
- **Refuse the leaderboard.** When asked to rank teams by complexity, decline and explain the domain-difference and Goodhart traps — protecting the metric is part of the job.

A leadership slide done right: incident/MTTR trend (the outcome) on top, complexity-and-coverage trend for the implicated services as the *explanation* below, and a costed, risk-justified investment ask. No composite score, no per-engineer numbers, no leaderboard.

---

## Core Concept 8 — Policy: thresholds, exceptions, and the long tail

An org-wide policy must handle the legacy long tail and legitimate exceptions without either rubber-stamping debt or blocking work.

- **Tiered thresholds.** Advisory at one level (e.g. complexity 15, "reviewer should look"), hard-blocking only at an extreme (e.g. 50, "this needs a director-level exception"). The hard line is rare enough that gaming it isn't worth anyone's time.
- **Explicit, expiring exceptions.** When a threshold violation is justified (an inherently complex algorithm — a parser, a scheduler, a codec), record it as a *tracked* exception with a rationale and a review date, not a silent `// nolint`. Maintain an **exception budget** so exceptions stay visible and finite.
- **Baseline the legacy tail; ratchet the new.** Grandfather existing violations, fail only on new/worsened ones (`--new-from-rev`), and tighten the ceiling over time — the only policy that survives a large legacy codebase (see [middle tier](middle.md)).
- **Auto-fix the trivial tier, debate nothing.** Unused imports/locals removed automatically; the policy spends its political capital only on the judgment calls.
- **Domain-aware, not one-size-fits-all.** A cryptography or query-planner module legitimately runs hotter than a CRUD service; the policy must allow per-domain norms rather than a single global line that everyone games.

Policy succeeds when it makes the *right* thing the *easy* thing: trivial debt auto-removed, real debt prioritized by evidence, exceptions visible and expiring, and gates soft enough that nobody profits from gaming them.

---

## Real-World Examples

**The composite-score reversal.** An org adopted a vendor "code health" composite as a leadership KPI. Teams optimized the cheapest input (comment ratio bumped the Maintainability Index) while real complexity rose. They replaced the single score with a four-panel dashboard (complexity trend, coverage, churn, incidents) and the gaming stopped because no single cheap lever moved the picture.

**Migration-timed dead-code removal.** Before a framework-version upgrade, a platform team ran a dead-code campaign with tombstone-as-a-service across 80 repos, observed for one quarter, then deleted ~9% of the code that would otherwise have needed porting. The campaign's ROI came almost entirely from *not migrating dead code*, validating the "time removal to coincide with payoff" heuristic.

**The exception budget that worked.** A team allowed complexity exceptions but required each to be a tracked entry with an expiry. The exception list itself became a prioritized refactoring backlog — and because exceptions expired, debt couldn't quietly become permanent. Silent `// nolint` suppressions, by contrast, had previously hidden hundreds of violations no one ever revisited.

---

## Mental Models

- **Signal, never target.** Complexity and dead code inform investment; the moment they grade people, they rot.
- **Distribution over scalar.** The *shape* of complexity (the tail) carries the decision; a single number hides it.
- **Verification is the constraint at scale.** Removing dead code is easy; proving it safe to remove is the expensive, investable part.
- **Time removal to payoff.** Dead-code cleanup pays most when fused with a migration, audit, or dependency removal.
- **Outcomes lead, signals explain.** Report incidents and change-failure; use complexity to explain *why*.
- **Govern Goodhart structurally.** Advisory gates, balancing metrics, no leaderboards, no review-tie — engineer the gaming out.

---

## Common Mistakes

| Mistake | Why it bites | Better |
|---|---|---|
| Making complexity an individual performance KPI | Guarantees gaming; corrupts the signal | Use it for portfolio decisions only, never reviews |
| Reporting a single composite "health score" | Hides which signal is the problem; trivially gamed | Dashboard of orthogonal signals + trends |
| Removing dead code reflexively as "good hygiene" | Verification cost + regression risk with deferred payoff | Time removal to migrations/audits; auto-fix only the trivial tier |
| Per-team complexity leaderboards | Ignores domain difficulty; drives gaming | Per-service trends, domain-aware norms |
| Silent `// nolint` to clear violations | Debt becomes invisible and permanent | Tracked, expiring exceptions with an exception budget |
| Treating complexity trend as causal | It's a confounded proxy; over-claiming erodes credibility | State the proxy honestly; lead with outcomes |

---

## Test Yourself

1. Why is complexity more valuable as a portfolio metric than as a per-PR gate? What does each scope catch?
2. Why is the Maintainability Index distrusted, and what do you report instead?
3. Build a risk-weighted leverage score for ranking a debt register from static signals.
4. List four *structural* defenses against Goodhart-driven gaming of complexity at org scale.
5. When does dead-code removal pay, and when should it be deferred? Why time it to migrations?
6. What is "tombstone-as-a-service" and why is verification (not deletion) the binding constraint in an org-wide campaign?
7. Design a complexity *policy* covering the legacy tail, legitimate exceptions, and the trivial tier.

---

## Cheat Sheet

```text
PORTFOLIO, NOT PER-PR
  report distribution + trend per service (complexity/KLOC, count>15/25/50)
  cross with churn + coverage + incidents → investment decisions
  per-PR gate stays soft/advisory; portfolio drives funding

MAINTAINABILITY STORY (dashboard, not one score)
  complexity (hard to change?) + coverage (safe to change?) + churn (where?)
  + dead-code volume + coupling + incidents/MTTR (realized cost)
  AVOID single composite (Maintainability Index) — gameable, opaque

DEBT PRIORITIZATION
  score = (complexity × churn × incident_weight) / effort
  fund a fixed % of capacity; measure OUTCOME (CFR/incidents), not activity

GOODHART GOVERNANCE (structural)
  never in perf reviews · advisory+reviewed gates · balancing metrics
  distributions/trends not leaderboards · audit sudden cliff-drops

DEAD-CODE ECONOMICS
  pays most: before migrations/audits, attack-surface, dep removal
  defer: stable isolated code w/ possible external callers
  auto-fix unused imports/locals; tombstone-as-a-service for the rest

POLICY: tiered thresholds · expiring tracked exceptions + budget
  baseline legacy + ratchet (--new-from-rev) · domain-aware norms
```

---

## Summary

At the organizational tier, dead code and complexity are **portfolio instruments, not lint failures**. Complexity's real value is aggregated and trended across services — distribution shape, slope per service, crossed with churn, coverage, and incidents — to drive *investment decisions* a per-PR gate could never surface. It belongs in a small dashboard of orthogonal maintainability signals, never a single gameable composite like the Maintainability Index. Static signals seed the debt register via risk-weighted leverage, and the program is validated by *outcomes* (change-failure and incident rates), not activity. Because any visible metric will be gamed by rational engineers, Goodhart must be engineered out **structurally** — advisory gates, balancing metrics, no leaderboards, never in performance reviews. Dead-code removal is risk-and-cost reduction with deferred payoff, best timed to migrations and audits and run as a campaign whose binding constraint is *verification* (tombstone-as-a-service), not deletion. The whole program succeeds only when it measures to inform decisions rather than to grade people.

---

## Further Reading

- Nicole Forsgren, Jez Humble, Gene Kim, *Accelerate* — outcome metrics and the danger of vanity/individual metrics.
- Adam Tornhill, *Software Design X-Rays* — hotspots, behavioral code analysis, prioritizing debt by evidence.
- Ward Cunningham, *The WyCash Portfolio Management System* (1992) — the original technical-debt metaphor.
- Critiques of the Maintainability Index (e.g. Arie van Deursen, "Think Twice Before Using the Maintainability Index").
- SEI / SonarSource literature on complexity metrics and their limits.

---

## Related Topics

- [Technical Debt Management](../../technical-debt-management/) — the debt register and remediation funding this feeds.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — Goodhart governance and outcome metrics.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity within the org's full metrics portfolio.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — harvesting signals to a warehouse, baselines, soft gates.
- The **refactoring-techniques**, **function-design**, and **code-smell-detection** skills.
