# Testing in Production — Junior Level

> **Roadmap:** [Testing](../README.md) → Testing in Production
> *Why some confidence can only be earned in the real environment — and how to earn it safely.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why Staging Is Never Enough](#core-concept-1----why-staging-is-never-enough)
5. [Core Concept 2 — It Is Not Recklessness, It Is Discipline](#core-concept-2----it-is-not-recklessness-it-is-discipline)
6. [Core Concept 3 — Canary Releases](#core-concept-3----canary-releases)
7. [Core Concept 4 — Synthetic Monitoring](#core-concept-4----synthetic-monitoring)
8. [Core Concept 5 — You Cannot Test What You Cannot See](#core-concept-5----you-cannot-test-what-you-cannot-see)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **understanding why production is the only place to verify certain properties — and that doing so safely requires more discipline, not less.**

"Testing in production" sounds like a joke a tired engineer makes at 2 a.m. — *"we don't have a staging environment, we test in prod, lol."* That joke is funny because it describes recklessness: shipping untested code to real users and hoping.

This topic is about the opposite. **Disciplined testing in production** is the recognition that some kinds of confidence *cannot* be obtained anywhere else, combined with a set of guardrails that let you obtain that confidence without harming users.

The key insight: your staging environment is a model of production, and **all models are wrong**. Staging has less data, fake traffic, mocked dependencies, and one user (you) clicking around. Production has terabytes of real data, millions of concurrent users, real third-party APIs that time out, and edge cases nobody imagined. A bug that only appears under these conditions will *never* be caught before production — so you must have a safe, controlled way to look for it in production.

You still write unit tests, integration tests, and end-to-end tests. Testing in production is the **apex** of confidence, not a replacement for the base. You earn the cheap confidence cheaply (in CI) and reserve production for the confidence that money can't buy anywhere else.

---

## Prerequisites

- You understand the [test pyramid](../01-test-strategy-and-the-pyramid/) — unit, integration, and end-to-end tests, and why each layer exists.
- You know what a **deployment** is (shipping new code to servers users hit).
- You have basic familiarity with **metrics** — error rate, latency, request count — even just from looking at a dashboard.
- You know what an **API** is and that services call other services.
- Helpful: skim the `monitoring-alerting` skill so the word "alert" means something concrete.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Production (prod)** | The live environment real users actually use. |
| **Staging** | A pre-production environment meant to resemble prod, used for final testing. |
| **Canary release** | Shipping new code to a tiny slice of traffic first, watching, then expanding. |
| **Rollout** | Gradually increasing the percentage of traffic served by new code. |
| **Rollback** | Reverting to the previous known-good version when something goes wrong. |
| **Feature flag** | A runtime switch that turns a feature on/off without redeploying. |
| **Synthetic monitoring** | Scripted fake users that continuously exercise real prod journeys. |
| **Blast radius** | How many users/systems a failure can affect before it is contained. |
| **Observability** | The ability to understand what your system is doing from its outputs (metrics, logs, traces). |
| **SLO** | Service Level Objective — a target like "99.9% of requests succeed." |

---

## Core Concept 1 — Why Staging Is Never Enough

Staging tries to imitate production. It always falls short in ways that hide real bugs:

| Dimension | Staging | Production |
|-----------|---------|------------|
| **Data scale** | A few thousand rows | Billions of rows, skewed distributions |
| **Data shape** | Clean, synthetic | Messy: emoji in names, null in "required" fields, 2008-era records |
| **Traffic** | One engineer clicking | Millions of concurrent, unpredictable users |
| **Dependencies** | Mocked or stubbed | Real third-party APIs that throttle, time out, return garbage |
| **Concurrency** | Almost none | Real race conditions under real load |
| **Configuration** | Simplified | The actual prod config, with its quirks |

A concrete example. Your code paginates database results. In staging the table has 500 rows, so one page covers everything and the pagination bug never fires. In production the table has 40 million rows, the query without a proper index times out, and the page falls over. **No amount of staging testing would have found this**, because the bug is a property of *scale*, and staging has no scale.

This is why we say: *staging answers "does it work?"; production answers "does it work here, now, at this scale, with this data, under this load?"* Those are different questions.

---

## Core Concept 2 — It Is Not Recklessness, It Is Discipline

The single most important idea in this whole topic:

> **Testing in production requires MORE rigor than testing anywhere else — not less.**

When you run a test in CI and it fails, nobody is hurt. When you "test" in production carelessly, real users see errors, lose data, or can't check out. So the bar is *higher*. Safe testing in production rests on four pillars:

1. **Small blast radius** — expose the change to 1% of traffic before 100%, so a failure hurts few people.
2. **Observability** — you can *see* within seconds that something broke (error rate spiked, latency doubled).
3. **Automated rollback / kill switch** — when the signal goes bad, you revert in seconds, automatically.
4. **A budget for risk** — you accept that a tiny, bounded amount of failure is the price of confidence, and you spend it deliberately.

If you don't have all four, you are not "testing in production" — you are gambling. The discipline is what turns the joke into an engineering practice.

---

## Core Concept 3 — Canary Releases

A **canary release** is the gateway technique. Named after the canary in a coal mine: send a small, expendable sentinel ahead to detect danger before it reaches everyone.

The pattern:

1. Deploy the new version alongside the old one.
2. Route **1%** of traffic to the new version (the canary).
3. Watch the canary's metrics versus the old version's for a few minutes.
4. If metrics are healthy, expand: 1% → 5% → 25% → 50% → 100%.
5. If metrics degrade at any step, **stop and roll back automatically**.

A simple canary metric gate, expressed as configuration:

```yaml
# canary-analysis.yaml — the rules that decide promote vs. rollback
canary:
  steps: [1, 5, 25, 50, 100]   # percent of traffic per stage
  interval: 5m                  # watch each stage this long
  metrics:
    - name: error-rate
      threshold: "<= 1%"        # canary must stay under 1% errors
    - name: p99-latency
      threshold: "<= baseline * 1.1"  # no more than 10% slower than old version
  on_failure: rollback          # any breach -> revert to previous version
```

The canary turns deployment from a cliff (all users at once) into a staircase (a few users at a time, with a check at each step). This is the most common form of testing in production, and many teams do it without even calling it "testing in production."

> Canary releases lean heavily on **feature flags and progressive delivery** — see [`../../release-engineering/06-feature-flags-and-progressive-delivery/`](../../release-engineering/06-feature-flags-and-progressive-delivery/) — and on fast, safe [rollback](../../release-engineering/07-rollback-and-roll-forward/).

---

## Core Concept 4 — Synthetic Monitoring

**Synthetic monitoring** runs scripted "fake users" that continuously perform critical journeys against *real production*, around the clock. If checkout breaks at 3 a.m., a synthetic check catches it before the first real customer does.

A synthetic check for a login + dashboard journey:

```javascript
// synthetic/login-journey.js — runs every 60s from 3 regions
import { check, journey } from "synthetics-runtime";

journey("user can log in and see dashboard", async (page) => {
  await page.goto("https://app.example.com/login");
  await page.fill("#email", process.env.SYNTHETIC_USER);
  await page.fill("#password", process.env.SYNTHETIC_PASS);
  await page.click("#submit");

  // Assertions on REAL production
  await check("dashboard loads", () =>
    page.waitForSelector("#dashboard", { timeout: 5000 }));
  await check("loads under 3s", () =>
    page.timing.loadEventEnd < 3000);
});
// On failure -> page the on-call engineer.
```

**How is this different from an end-to-end (E2E) test?**

| | [E2E test](../04-end-to-end-testing/) | Synthetic monitor |
|---|---|---|
| **When** | Before release (in CI/staging) | Forever, in production |
| **Environment** | Test/staging | Real production |
| **Purpose** | "Is this build correct?" | "Is the live system healthy *right now*?" |
| **On failure** | Block the deploy | Page the on-call engineer |

The script may look almost identical — the difference is *where* and *why* it runs. Synthetic monitoring is your always-on smoke test against the real thing.

---

## Core Concept 5 — You Cannot Test What You Cannot See

Imagine driving a car at night with the headlights off. That's testing in production without observability. The whole practice depends on a simple precondition:

> **If you cannot detect, within seconds, that your change made production worse, you must not test in production.**

The minimum you need before any prod testing:

- **Metrics** — error rate, latency (p50/p99), throughput, saturation — on a dashboard, per version.
- **Logs** — searchable records of what happened, so you can investigate a spike.
- **Traces** — the path of a single request across services, to find *where* it broke.
- **Alerts** — automated notifications when a metric crosses a threshold.

This is the domain of the `observability-stack` and `monitoring-alerting` skills. The mental shortcut: **observability is the headlights; testing in production is driving fast at night.** You need the headlights *first*.

---

## Real-World Examples

- **Facebook / Meta — Gatekeeper:** virtually every change is wrapped in a feature flag and rolled out progressively to employees, then 1% of users, then more — with automatic metric checks at each ring.
- **Netflix — synthetic + canary:** new service versions take a slice of real traffic while an automated canary analysis compares them to the baseline before full rollout.
- **Your own team, probably:** if you've ever shipped a feature "to internal users first" or "to 5% of accounts," you've already tested in production — you just may not have called it that.
- **The pagination bug:** a real, recurring story — code that works on 500 staging rows and dies on 40 million prod rows. Only a canary against real data would have caught it.

---

## Mental Models

- **Canary in a coal mine:** send a small expendable sentinel ahead; if it's fine, follow; if it falls over, retreat.
- **Headlights before speed:** observability is the headlights. No headlights, no night driving.
- **All models are wrong:** staging is a model of prod; it's useful but incomplete. Some truths live only in the territory, not the map.
- **The staircase, not the cliff:** deploy in small steps with a check between each, instead of one big leap to 100%.
- **Dimmer switch, not light switch:** a feature flag lets you turn a feature up gradually and snap it off instantly.

---

## Common Mistakes

| Mistake | Why it's wrong | Do instead |
|---------|----------------|------------|
| Treating "test in prod" as skipping tests | It demands *more* rigor, not less | Keep the pyramid; add prod testing on top |
| Testing in prod with no dashboards | You're driving blind | Set up observability *first* |
| Canary to 100% immediately | Defeats the point — full blast radius | Use small steps with checks |
| No automated rollback | A human at 3 a.m. is too slow | Wire SLO-breach → auto-rollback |
| Synthetic monitor with no alert | Detecting silently helps no one | Failed check must page someone |
| Synthetic credentials with real-money side effects | Your fake users place real orders | Use safe test accounts / sandbox paths |

---

## Test Yourself

1. Give two properties of production that staging fundamentally cannot reproduce.
2. Why is "we test in prod" a joke in one context and a serious discipline in another?
3. Walk through the stages of a canary release and say what happens if stage 2 shows a latency spike.
4. What is the difference between an E2E test and a synthetic monitor, given they may share code?
5. Why must observability exist *before* you test in production, not after?
6. What four pillars make production testing safe?

---

## Cheat Sheet

```text
WHY PROD-ONLY?      scale · real data · real deps · real concurrency · real users
NOT                 skipping tests   →  it needs MORE rigor
CANARY              1% → 5% → 25% → 50% → 100%, check metrics each step
SYNTHETIC           scripted fake users hit REAL prod, forever, page on fail
E2E vs SYNTHETIC    E2E = before release in CI; synthetic = always, in prod
PRECONDITION        observability (metrics/logs/traces/alerts) FIRST
SAFETY PILLARS      small blast radius · observability · auto-rollback · risk budget
MANTRA              you cannot test what you cannot see
```

---

## Summary

Staging is a model of production, and all models are wrong: scale, real data, real dependencies, concurrency, and real user behavior produce bugs that pre-production testing can never see. Disciplined testing in production earns that confidence safely. It is the opposite of recklessness — it demands *more* rigor: a small blast radius, real-time observability, and automated rollback. The two starter techniques are **canary releases** (ship to 1%, watch, expand or revert) and **synthetic monitoring** (scripted fake users continuously exercising real prod). The non-negotiable precondition is observability: you cannot test what you cannot see. Testing in production sits at the *apex* of the confidence pyramid — it complements the unit, integration, and E2E layers; it never replaces them.

---

## Further Reading

- Charity Majors — *"Testing in Production: the hard parts"* (blog).
- Cindy Sridharan — *"Testing in Production, the safe way."*
- Google SRE Workbook — chapters on canarying releases.
- The `monitoring-alerting` and `observability-stack` skills in this repository.

---

## Related Topics

- [Test Strategy and the Pyramid](../01-test-strategy-and-the-pyramid/) — where prod testing fits.
- [End-to-End Testing](../04-end-to-end-testing/) — the closest pre-prod cousin to synthetic monitoring.
- [Performance and Load Testing](../09-performance-and-load-testing/) — verifying scale before and during prod.
- [Feature Flags & Progressive Delivery](../../release-engineering/06-feature-flags-and-progressive-delivery/) — the control plane.
- [Rollback and Roll-Forward](../../release-engineering/07-rollback-and-roll-forward/) — the safety net.
- **Middle level** — the full catalog of techniques and their guardrails.
