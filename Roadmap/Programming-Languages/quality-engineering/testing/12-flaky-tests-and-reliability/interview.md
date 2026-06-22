# Flaky Tests & Reliability — Interview Level

> **Roadmap:** [Testing](../README.md) → Flaky Tests & Reliability
> *A question bank for proving you understand why flakiness is existential, can name and fix every root cause, and can run a reliability program — not just "re-run it."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Root-Cause Taxonomy](#root-cause-taxonomy)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Interview questions on flaky tests, in Q / what's-really-being-tested / model-answer format — from "what is flakiness" to running a flake budget at scale.**

Flaky tests are a favorite interview topic because the answer reveals seniority instantly. A junior says "re-run it." A strong engineer says "a flaky test is a broken test, here's the root-cause taxonomy, and here's how I'd run it as a program." This page is the question bank.

## Prerequisites

- The junior→professional pages on this topic.
- Working knowledge of CI, concurrency, dependency injection, and SLO/error-budget thinking.

## Fundamentals

**Q1. What is a flaky test, and why does it matter more than it seems?**
*Testing: whether you grasp that the real cost is trust, not the failure.*
**A.** A flaky test passes and fails non-deterministically on **unchanged code**. It matters far more than the individual failure suggests because the real damage is **trust erosion**: one ignored flaky test trains the team that "red doesn't always mean broken," so people start re-running instead of investigating. Once the team stops believing red, the suite stops preventing bugs and a real defect ships. The slogan: **a flaky test is a broken test, and trust is the asset.** A suite you don't trust is worth less than no suite at all — it costs time and confidence while providing no reliable signal.

**Q2. "It passes 95% of the time." Is that good enough?**
*Testing: do you reject the false comfort of high pass rates.*
**A.** No. The 5% is the whole problem. A test that flips is non-deterministic, which means a red result no longer reliably indicates a real bug — exactly the property that makes the suite valuable. Worse, a 95%-passing test trains people to dismiss the 5%, including the time it's a *real* failure. "Mostly passes" is not a defense; it's the definition of the disease.

**Q3. Why is "just re-run it until green" dangerous, even when it works?**
*Testing: understanding that the workaround is the harm.*
**A.** Two reasons. First, the reflex itself erodes trust — re-running until green normalizes ignoring red. Second, a green-on-rerun can hide a *real* bug: if the product has an intermittent race, re-running just rolls the dice until it doesn't fire, masking a defect that will hit users. Re-running is acceptable only to *detect and record* flakiness, never to silently make CI pass.

## Technique

**Q4. You hit a test that fails ~1 in 20 runs. Walk me through your process.**
*Testing: a systematic method, not guesswork.*
**A.** (1) **Reproduce** — loop it to confirm and get a rate: `go test -run X -count=100` or `pytest X --count=100`. (2) **Classify** against the root-cause taxonomy (async/timing, order/state, isolation, concurrency, non-determinism, external deps, resource leaks, environment). (3) **Critical fork — is the *product* flaky or the *test*?** Run `-race`/ThreadSanitizer; a real race is fixed in production code, not muted in the test. (4) **Fix** with the canonical remedy for the bucket (sleep→poll, seed the RNG, inject a clock, isolate state). (5) If I can't fix it now and it's blocking, **quarantine** it with owner + ticket + deadline. (6) **Record** the flake in the dashboard. This mirrors the `systematic-debugging` skill: reproduce, isolate, fix the root cause, verify.

**Q5. How do you detect flakiness systematically rather than waiting to get unlucky?**
*Testing: detection-as-engineering.*
**A.** Re-run suspects many times on a fixed commit to compute a **flakiness rate** (`failures/runs`). In CI, **rerun failed tests once and flag any fail→pass flip** as flaky — recording it, not hiding it. Aggregate across runs: any test giving different results on the *same commit hash* is flaky by definition. Tools: `pytest-rerunfailures`, Gradle/Surefire retry, `go test -count`, and platform layers like Gradle Develocity, Datadog Test Optimization, BuildPulse, and Google's flaky infrastructure. Shuffle order (`go test -shuffle=on`, `pytest -p randomly`) to expose order-dependence proactively.

**Q6. Fix this flaky test.** (Interviewer shows `submit(); time.sleep(1); assert done()`.)
*Testing: the canonical sleep→poll fix.*
**A.** The `sleep(1)` is a guess that races the async work — fast machine passes, loaded CI fails. Replace it with a bounded poll on the real condition:
```python
def wait_until(pred, timeout=5, interval=0.05):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred(): return
        time.sleep(interval)
    raise AssertionError("condition not met in time")
# submit(); wait_until(done); assert done()
```
Even better: expose a deterministic completion signal (channel/callback) so the test waits on a real event, not a poll.

## Root-Cause Taxonomy

**Q7. Name the major root causes of flakiness and a fix for each.**
*Testing: breadth and the diagnostic map.*
**A.**
- **Async/timing** — `sleep` racing async work → poll for the condition (`Eventually`/`wait_until`).
- **Order & shared state** — passes in suite, fails alone → make each test own its state; shuffle to detect.
- **Isolation failure** — leaked singletons/statics/DB rows → reset in teardown; transaction rollback per test.
- **Concurrency/races** — fails 1/N with no pattern → run `-race`; fix the real race (test *or* product).
- **Non-determinism** — unseeded random / wall-clock / map-iteration order / locale → seed RNG; inject a clock; sort; pin `TZ`.
- **External dependencies** — real network/3rd-party → stub it; make tests hermetic.
- **Resource leaks/exhaustion** — fails late, ports/FDs/memory → close in teardown; ephemeral ports.
- **Environment differences** — CI≠local, OS/timezone → pin and normalize the environment.

**Q8. How do you make a date-dependent function non-flaky?**
*Testing: determinism seams.*
**A.** Stop reading the wall clock in business logic. Inject a `Clock` interface; production uses a system clock, tests use a fixed one. The test fully controls "now," so midnight, month-end, DST, and timezone flakes disappear. Same pattern for randomness (inject/seed the RNG) and network (inject the client/repository). This is **prevention by design** — the cheapest flaky test is the one that can't exist. (Cross-ref [Test Doubles](../10-test-doubles-mocks-fakes/interview.md).)

**Q9. A concurrency test sometimes asserts the counter is 998 instead of 1000. Is the test flaky?**
*Testing: the "flaky test reveals a real bug" insight — the senior-discriminator question.*
**A.** Probably the *product* is flaky, not the test. An off-by-a-few counter under concurrent increments is the signature of a **data race** in production code (`value++` is not atomic). The wrong fix is muting the test with a sleep or a retry — that ships the race to users. The right fix: run `go test -race`/ThreadSanitizer to confirm, then fix the production code (e.g. `atomic.AddInt64` or a mutex). A flaky test is sometimes the only thing catching a real intermittent bug; before stabilizing it, always ask "is the test wrong, or is the product wrong?"

## Scenarios

**Q10. A team re-runs CI constantly and CI is "always a bit red." What's your plan?**
*Testing: turning a degraded culture into a program.*
**A.** (1) **Stop the bleeding** — quarantine the worst offenders (owner+ticket+deadline) so the blocking suite is trustworthy again; restore "red = stop." (2) **Measure** — stand up detection and a dashboard: first-run pass rate, per-test flake score, retry rate, quarantine size. (3) **Budget** — set a reliability SLO (e.g. ≥99.5% first-run green) with a freeze trigger on breach. (4) **Own & enforce** — auto-route flakes to code owners; fix-or-delete within an SLA with auto-delete on timeout. (5) **Culture** — flakiness becomes a P-level bug; no silent skips. The goal is to make green=safe and red=stop true again.

**Q11. When are auto-retries acceptable, and what's the catch?**
*Testing: the retry trade-off and the measurement obligation.*
**A.** Limited retries (1-2) are defensible for **E2E tests against networks/third-party systems you don't control**, where transient infra failures are unavoidable. They are *not* acceptable for unit/integration tests of your own logic — a flaky unit test means a real determinism bug, and retrying masks exactly what you wrote it to catch. The catch: **green-on-retry hides flakiness AND real product races.** Concretely, 2 retries turn a 1-in-50 production race into a ~1-in-125,000 failure — you've hidden a live bug, not fixed it. So: cap retries, restrict them to E2E, and **always record and surface the retry rate** — a retried pass is amber, not green, and a rising retry rate is a leading indicator of a real bug.

**Q12. Your quarantine list has grown to 300 tests over two years. What went wrong and how do you fix it?**
*Testing: the quarantine-graveyard failure mode.*
**A.** Quarantine worked too well — it removed the pain without a forcing function, so it became a graveyard of "temporarily" disabled tests, i.e. silent coverage loss nobody tracks. The fix is policy: every quarantined test needs an **owner, ticket, and deadline**, and a **fix-or-delete SLA with auto-delete on timeout**. Then triage the backlog: delete redundant/obsolete tests, fix the valuable ones. Quarantine must be a TODO with a deadline, not a place tests go to die.

**Q13. How does flakiness management change at Google/monorepo scale?**
*Testing: statistical-containment thinking.*
**A.** At millions of tests, *something* is always flaky, so you don't chase zero — you do **statistical containment**: maintain a per-test flake score from same-commit history and auto-exclude high-flake tests from gating; run only affected tests via **test-impact/target determination** (Bazel/TAP) to shrink flake exposure; **auto-quarantine + auto-route** to owning teams; enforce **hermeticity via the build system** (Bazel sandboxing eliminates whole families structurally); and run an **org-level reliability SLO** with breach-triggered focus. Google has publicly cited ~1.5% flaky runs managed this way.

## Rapid-Fire

**Q14.** *One sentence: what is a flaky test?* → A test that passes and fails non-deterministically on unchanged code.

**Q15.** *The slogan?* → "A flaky test is a broken test; trust is the asset."

**Q16.** *#1 junior cause?* → A fixed `sleep` instead of polling for a condition.

**Q17.** *Detect order-dependence how?* → Shuffle test order (`go test -shuffle=on`, `pytest -p randomly`).

**Q18.** *Fix unseeded randomness?* → Inject/seed the RNG (`Random(42)`).

**Q19.** *Reruns are for…?* → Detecting and recording flakiness, never hiding it.

**Q20.** *Quarantine without ___ becomes a graveyard.* → owner + ticket + deadline (fix-or-delete SLA).

**Q21.** *Flake budget is modeled on?* → SRE error budgets.

**Q22.** *Biggest cost of flakiness?* → Lost trust (then developer time; compute is smallest).

**Q23.** *Tool to find a real race behind a flake?* → `go test -race` / ThreadSanitizer.

**Q24.** *Hermetic test means?* → Depends on nothing outside its own controlled inputs (no real clock/network/shared state).

## Red Flags / Green Flags

**Red flags (in a candidate's answers):**
- "Just re-run it" as the *solution*, not a detection step.
- Treats flakiness as a minor annoyance; never mentions trust.
- Adds `sleep(5)` / blanket retries to "stabilize."
- Never considers that the *product* might be flaky.
- Quarantines or skips with no owner/deadline.
- Optimizes for 0% flakiness at scale (uneconomic).

**Green flags:**
- Says "a flaky test is a broken test" and centers trust.
- Names the root-cause taxonomy and the canonical fix per bucket.
- sleep→poll, seed-the-RNG, inject-the-clock instincts.
- Asks "is the test wrong or the product wrong?" before stabilizing.
- Quarantine with owner+ticket+deadline; fix-or-delete SLA.
- Talks budget/SLO, ownership routing, dashboards, and economics at scale.

## Cheat Sheet

```text
ONE-LINER  flaky = passes & fails on SAME code; "a flaky test is a broken test"; TRUST is the asset
PROCESS    reproduce(loop) → classify(taxonomy) → product-or-test? (-race) → fix → quarantine? → record
TAXONOMY   async/timing · order/state · isolation · concurrency · non-determinism · external · leaks · env
FIXES      sleep→poll | order→isolate+shuffle | random→seed | time→inject clock | map→sort | net→stub
RACE TRUTH flaky test may catch a REAL product race — fix product, don't mute test
RETRIES    OK(limited) for E2E vs network; NOT for own logic; hides flakiness AND races; ALWAYS record rate
QUARANTINE owner+ticket+deadline; fix-or-delete SLA; never a graveyard
SCALE      flake budget/SLO (like error budget) · ownership routing · dashboards · statistical containment
ECONOMICS  compute < developer-time << trust(priceless)
```

## Summary

In interviews, flaky tests separate "re-run it" from senior judgment. Lead with the thesis — **a flaky test is a broken test, trust is the asset** — then demonstrate the **root-cause taxonomy** with a canonical fix per bucket (sleep→poll, seed the RNG, inject the clock, isolate state). Show you **detect** flakiness systematically (loop to get a rate, rerun-to-flag, shuffle, `-race`) and that you ask the discriminating question: **is the test wrong or is the product wrong?** Treat **retries** as a measured poison (limited E2E only, always record the rate), **quarantine** with owner+ticket+deadline under a fix-or-delete SLA, and at scale run a **flake budget/SLO** with ownership routing, dashboards, and statistical containment — justified by the economics of compute, developer time, and priceless trust.

## Further Reading

- Martin Fowler, "Eradicating Non-Determinism in Tests"
- Google Testing Blog, "Flaky Tests at Google and How We Mitigate Them"
- Google SRE Book — error budgets
- Gradle test-retry / `pytest-rerunfailures` / `go test -race` docs
- The `concurrency-patterns` and `systematic-debugging` skills.

## Related Topics

- [End-to-End Testing](../04-end-to-end-testing/interview.md) — explicit waits; legitimate bounded retries.
- [Integration Testing](../03-integration-testing/interview.md) — isolation and shared-state flakiness.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/interview.md) — clock/RNG/network seams.
- [Test Data Management](../11-test-data-management/interview.md) — isolated, repeatable data.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — reliability as a metric and SLO.
