# Testing in Production — Middle Level

> **Roadmap:** [Testing](../README.md) → Testing in Production
> *The full catalog of production-testing techniques — and the guardrails that keep each one safe.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Technique Catalog](#core-concept-1----the-technique-catalog)
5. [Core Concept 2 — Canary & Progressive Rollout](#core-concept-2----canary--progressive-rollout)
6. [Core Concept 3 — Feature Flags as Test Control](#core-concept-3----feature-flags-as-test-control)
7. [Core Concept 4 — Synthetic Monitoring & RUM](#core-concept-4----synthetic-monitoring--rum)
8. [Core Concept 5 — Shadow / Mirror Traffic](#core-concept-5----shadow--mirror-traffic)
9. [Core Concept 6 — Chaos Engineering, Briefly](#core-concept-6----chaos-engineering-briefly)
10. [Core Concept 7 — Guardrails That Make It Safe](#core-concept-7----guardrails-that-make-it-safe)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **the techniques that make up testing in production — canary, flags, synthetic, shadow traffic, chaos — and the guardrails each one needs.**

At the junior level you learned *why* production is the only place to verify scale, real data, real dependencies, and real concurrency — and the two starter techniques (canary, synthetic). This level is the working catalog. For each technique you should be able to say: what it verifies, how to set it up, what its blast radius is, and what guardrail keeps it safe.

The unifying principle remains: **testing in production is a controlled experiment on a live system.** Every technique is a way to extract a specific kind of confidence while bounding the cost of being wrong. Pick the technique by the question you're trying to answer — and never deploy any of them without the guardrails in Core Concept 7.

---

## Prerequisites

- The junior page: why staging is insufficient; canary and synthetic basics.
- Comfort with [end-to-end testing](../04-end-to-end-testing/) and [performance/load testing](../09-performance-and-load-testing/).
- Working knowledge of metrics dashboards (`monitoring-alerting` skill).
- Understanding of HTTP request/response and that a request can be copied or split.
- Familiarity with [feature flags & progressive delivery](../../release-engineering/06-feature-flags-and-progressive-delivery/).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Progressive rollout** | Increasing traffic to a new version in defined stages. |
| **Dark launch** | Shipping code to prod but keeping it invisible/inactive behind a flag. |
| **Ring deployment** | Rolling out in concentric audiences: devs → employees → beta → all. |
| **Shadow / mirror traffic** | Copying live requests to a new version whose response is discarded. |
| **Traffic teeing** | The act of forking a request stream to a second destination. |
| **RUM** | Real User Monitoring — telemetry from actual users' sessions. |
| **Chaos engineering** | Deliberately injecting failure to test resilience hypotheses. |
| **Steady-state hypothesis** | The measurable "normal" a chaos experiment expects to hold. |
| **Blast radius** | The bounded set of users/systems an experiment can affect. |
| **Error budget** | The allowed amount of unreliability (1 − SLO) you may spend on risk. |
| **Kill switch** | A single control that instantly disables a risky feature/experiment. |

---

## Core Concept 1 — The Technique Catalog

Map each technique to the question it answers and its inherent blast radius:

| Technique | Verifies | Blast radius | User impact |
|-----------|----------|-------------|-------------|
| **Canary / progressive rollout** | New version behaves at real scale | Small % first, growing | Real (limited) |
| **Feature flags / dark launch** | Feature works in prod, invisibly | Configurable, often zero | None until exposed |
| **Ring deployment** | Behavior across audiences | Innermost ring first | Internal first |
| **Synthetic monitoring** | Critical journeys stay healthy | Zero (fake users) | None |
| **Shadow / mirror traffic** | New version matches old on real input | Zero (output discarded) | None |
| **A/B testing** | Which variant performs better | Split of real users | Real (by design) |
| **Chaos engineering** | System survives failure | Tightly bounded | Potentially real |
| **RUM / error tracking** | What users actually experience | Zero (observation) | None |

Two families fall out: **zero-impact** techniques (synthetic, shadow, RUM, dark launch) that observe or simulate without touching user-facing output, and **real-impact** techniques (canary, A/B, chaos) that expose real users to the change and therefore need the strongest guardrails.

---

## Core Concept 2 — Canary & Progressive Rollout

Canary is progressive rollout with an automated decision at each stage. The decision is the important part — a canary that nobody analyzes is just a slow deploy.

```yaml
# argo-rollout.yaml — canary with automated analysis (Argo Rollouts style)
spec:
  strategy:
    canary:
      steps:
        - setWeight: 1
        - pause: { duration: 5m }
        - analysis:                       # gate: must pass to continue
            templates: [{ templateName: success-rate }]
        - setWeight: 10
        - pause: { duration: 10m }
        - setWeight: 50
        - pause: { duration: 10m }
        - setWeight: 100
---
# AnalysisTemplate — the metric gate
metrics:
  - name: success-rate
    interval: 1m
    successCondition: "result >= 0.99"     # 99% success required
    failureLimit: 2                         # 2 bad checks -> abort + rollback
    provider:
      prometheus:
        query: |
          sum(rate(http_requests_total{job="myapp",code!~"5.."}[2m]))
          / sum(rate(http_requests_total{job="myapp"}[2m]))
```

Key practices:

- **Compare canary to baseline, not to absolutes.** If prod is already at 0.5% errors, judge the canary against that, not against zero. Run an old-version "baseline" pool to compare apples to apples.
- **Watch the right metrics.** Error rate and latency always; plus business metrics (checkout rate, signups) — a canary can be technically healthy but quietly tank conversion.
- **Bake time matters.** Some bugs (memory leaks, cache poisoning) only surface after minutes or hours. Don't promote in 30 seconds.

---

## Core Concept 3 — Feature Flags as Test Control

A feature flag is a runtime switch that decouples *deploy* from *release*. This makes it the control plane for testing in production.

**Dark launch** — ship the code, keep the feature off, then exercise it without exposing output to users:

```javascript
// Dark launch: run the new pricing engine in prod, but never show its result.
const legacyPrice = computePriceLegacy(cart);

if (flags.enabled("new-pricing-engine-shadow")) {
  try {
    const newPrice = computePriceNewEngine(cart);   // runs in real prod
    metrics.observe("pricing.delta", newPrice - legacyPrice);
    if (newPrice !== legacyPrice) log.warn("pricing mismatch", { cart, legacyPrice, newPrice });
  } catch (e) {
    metrics.increment("pricing.new_engine.error");   // learn it crashes — safely
  }
}

return legacyPrice;   // users always get the trusted value
```

**Ring deployment** — expose to concentric audiences, widening only when each ring is healthy:

```text
Ring 0: the team that wrote it     (dogfooding)
Ring 1: all employees              (internal beta)
Ring 2: opted-in external betas
Ring 3: 1% of production users
Ring 4: everyone
```

The flag gives you two superpowers prod testing depends on: **targeting** (expose to exactly this audience) and **instant kill** (flip off in milliseconds without a deploy). See [`../../release-engineering/06-feature-flags-and-progressive-delivery/`](../../release-engineering/06-feature-flags-and-progressive-delivery/).

---

## Core Concept 4 — Synthetic Monitoring & RUM

These are the two feedback signals — one proactive, one reactive — and you want both.

**Synthetic monitoring** (proactive): scripted journeys you control, run on a schedule from multiple regions. Catches outages *before* users report them; gives you a clean, repeatable signal because the input is fixed.

**Real User Monitoring (RUM)** (reactive): telemetry from real sessions — page load times, JS errors, API failures, by device/geo/version. Catches what your synthetic scripts didn't think to test, on the long tail of real browsers and networks.

```javascript
// RUM: report real user experience back to your telemetry pipeline
rum.track("checkout.completed", {
  durationMs: performance.now() - checkoutStart,
  appVersion: window.__BUILD__,        // tie experience to the canary version!
  device: navigator.userAgent,
});
window.addEventListener("error", (e) =>
  rum.error(e.message, { stack: e.error?.stack, appVersion: window.__BUILD__ }));
```

| | Synthetic | RUM |
|---|---|---|
| **Input** | Fixed, scripted | Whatever real users do |
| **Coverage** | Critical paths you chose | The whole long tail |
| **Signal quality** | Clean, comparable | Noisy, representative |
| **Catches** | Outages, regressions on key journeys | Real-world edge cases, device-specific bugs |

Together with **error tracking** (Sentry-style grouping of exceptions by version), these are the eyes that turn a canary's "something changed" into "the new build throws on Safari 14."

---

## Core Concept 5 — Shadow / Mirror Traffic

Shadow traffic (a.k.a. mirroring, traffic teeing) is the most elegant zero-user-impact technique: copy real production requests, send the copy to the new version, and **throw away its response**. Users only ever see the production response. You compare the shadow's response/behavior to validate the new version against real traffic — at full real scale — with no risk.

```text
                       ┌─────────────────┐   real response
   real request  ──────►  PROD (v1)       ├────────────────►  user
        │                └─────────────────┘
        │  copy (tee)
        ▼
   ┌─────────────────┐   response DISCARDED
   │  SHADOW (v2)     ├───────────► /dev/null
   └─────────────────┘   (compare to v1, log diffs, watch resources)
```

A mirror config at the proxy/mesh layer:

```yaml
# Istio VirtualService — mirror 100% of traffic to v2, ignore its response
http:
  - route:
      - destination: { host: payments, subset: v1 }   # users get v1
    mirror:
      host: payments
      subset: v2                                        # v2 sees a copy
    mirrorPercentage: { value: 100.0 }
```

What shadowing verifies that nothing else can: **does v2 produce the same results as v1 on the exact, weird, real requests users send right now** — plus how v2 behaves under real load (CPU, memory, latency, downstream call volume). 

Two hazards to plan for: (1) **side effects** — the shadow must not write to the real DB, charge cards, or send emails; route it to a sandbox or make writes no-ops. (2) **doubled load on shared dependencies** — mirroring doubles calls to anything v1 and v2 share.

---

## Core Concept 6 — Chaos Engineering, Briefly

Chaos engineering deliberately injects failure (kill a node, add latency, drop a dependency) to test a *resilience hypothesis* — verifying that the system survives the failures you claim it can survive. The structure of an experiment:

```yaml
# chaos-experiment.yaml — the disciplined form
hypothesis:                       # steady state we expect to HOLD
  steady_state: "checkout success rate stays >= 99% and p99 < 800ms"
method:
  inject: "kill 1 of 3 payment-service pods"
blast_radius:
  scope: "only the canary cluster, 5% of traffic"
abort_conditions:
  - "checkout success rate < 95%"   # halt immediately if hypothesis breaks badly
rollback: "restore pod, disable fault injection"
```

You don't run chaos to break things — you run it to *prove* a resilience claim, in a tightly bounded blast radius, with abort conditions ready. (The senior page goes deep on the steady-state hypothesis and blast-radius control; here, just internalize the shape.) Tools: Netflix Chaos Monkey, Gremlin, AWS Fault Injection Simulator, LitmusChaos. The `high-availability-patterns` skill covers the resilience patterns chaos validates.

---

## Core Concept 7 — Guardrails That Make It Safe

No technique above is safe without these. This is the part juniors skip and seniors obsess over.

1. **Blast-radius control** — always start at the smallest exposure (1%, one region, internal ring) and widen only on green metrics.
2. **Observability as precondition** — metrics, logs, traces, per-version, in real time. You cannot test in prod if you can't *see* prod (`observability-stack` skill).
3. **Automated rollback on SLO breach** — wire the metric gate to revert without a human. Humans are too slow at 3 a.m. See [rollback](../../release-engineering/07-rollback-and-roll-forward/).
4. **Kill switches** — a flag that disables the change instantly, independent of the deploy pipeline.
5. **Error budgets govern risk** — spend your (1 − SLO) budget deliberately. Budget exhausted → freeze risky experiments.
6. **No-side-effect isolation** — shadow/chaos must not corrupt real data or trigger real external actions.

The rule of thumb: *for every technique, answer "how do I limit who's affected, how do I know it broke, and how do I undo it in seconds?" before you run it.*

---

## Real-World Examples

- **Netflix:** automated canary analysis (Kayenta) plus Chaos Monkey randomly killing instances in prod — resilience proven continuously, not assumed.
- **GitHub — Scientist:** a library purpose-built for shadowing — run old and new code paths on real requests, compare results, surface mismatches, return only the old result.
- **LinkedIn / Microsoft:** ring deployments (dogfood → employees → beta → world) gate every change through widening audiences.
- **Amazon:** A/B testing at massive scale — but the same infrastructure (flags, traffic splitting, metrics) doubles as the testing-in-production platform.

---

## Mental Models

- **Tee the pipe:** shadow traffic forks the request stream; the fork's output goes to the drain.
- **Two cameras:** synthetic = a fixed scripted camera on the front door; RUM = bodycams on every real user.
- **Deploy ≠ release:** the binary is on the server (deployed); the flag decides if users see it (released).
- **Scientist's experiment:** run control and candidate side by side, trust only the control's answer, study the difference.
- **The dimmer + the breaker:** the flag is a dimmer (gradual) *and* a breaker (instant off).

---

## Common Mistakes

| Mistake | Why it's wrong | Do instead |
|---------|----------------|------------|
| Canary with no metric gate | It's just a slow deploy | Automate promote/abort on metrics |
| Shadowing with live writes | Corrupts real data / sends real emails | Sandbox writes; make them no-ops |
| Forgetting doubled load in mirroring | Overloads shared downstreams | Cap mirror %, isolate dependencies |
| Comparing canary to absolute zero | Prod is never at zero errors | Compare to a live baseline pool |
| Chaos with no abort condition | Turns a test into an outage | Define abort + auto-rollback first |
| Only synthetic, no RUM (or vice-versa) | Miss the long tail / miss key paths | Run both signals |
| A/B test without statistical rigor | Ship the wrong variant on noise | Power the test; respect significance |

---

## Test Yourself

1. For each technique in the catalog, state its blast radius and what unique confidence it provides.
2. Why is a canary without automated analysis "just a slow deploy"?
3. Explain shadow traffic and the two main hazards it introduces.
4. How do synthetic monitoring and RUM complement each other? Give a bug each would catch that the other misses.
5. Write the four parts of a disciplined chaos experiment.
6. Name the six guardrails and which technique each protects.
7. How does a feature flag let you "release" without "deploying"?

---

## Cheat Sheet

```text
PICK BY QUESTION
  "scales / behaves at real load?"      -> canary / progressive rollout
  "works in prod, invisibly?"           -> feature flag / dark launch
  "matches old version on real input?"  -> shadow / mirror traffic
  "key journeys healthy right now?"     -> synthetic monitoring
  "what do real users experience?"      -> RUM + error tracking
  "survives this failure?"              -> chaos experiment
  "which variant is better?"            -> A/B test

ZERO-IMPACT : synthetic · shadow · RUM · dark launch
REAL-IMPACT : canary · A/B · chaos   (need strongest guardrails)

GUARDRAILS (always): blast radius · observability · auto-rollback
                     · kill switch · error budget · no-side-effects
RULE: before any technique answer — limit who? see break? undo in seconds?
```

---

## Summary

Testing in production is a catalog of controlled experiments on a live system. **Canary/progressive rollout** verifies behavior at real scale via automated metric gates. **Feature flags** decouple deploy from release, enabling dark launches and ring deployments. **Synthetic monitoring** proactively guards critical journeys; **RUM** reactively captures the real-user long tail. **Shadow/mirror traffic** validates a new version against real requests with zero user impact (mind side effects and doubled load). **Chaos engineering** proves resilience hypotheses within a bounded blast radius. None of these is safe without the six guardrails: small blast radius, observability, automated rollback, kill switches, error budgets, and side-effect isolation. Choose the technique by the question you must answer — then never run it without answering *limit, detect, undo*.

---

## Further Reading

- Casey Rosenthal & Nora Jones — *Chaos Engineering* (O'Reilly).
- GitHub Engineering — *"Scientist"* (refactoring with confidence in prod).
- Google SRE Workbook — *Canarying Releases*.
- Cindy Sridharan — *Distributed Systems Observability*.
- The `observability-stack`, `monitoring-alerting`, and `high-availability-patterns` skills.

---

## Related Topics

- [Test Strategy and the Pyramid](../01-test-strategy-and-the-pyramid/) — prod testing as the apex.
- [End-to-End Testing](../04-end-to-end-testing/) — the pre-prod sibling of synthetic checks.
- [Performance and Load Testing](../09-performance-and-load-testing/) — scale verification.
- [Feature Flags & Progressive Delivery](../../release-engineering/06-feature-flags-and-progressive-delivery/) — the control plane.
- [Rollback and Roll-Forward](../../release-engineering/07-rollback-and-roll-forward/) — the safety net.
- **Senior level** — observability foundations, blast-radius math, chaos discipline, what-only-prod-can-verify.
