# Flaky Tests & Reliability — Senior Level

> **Roadmap:** [Testing](../README.md) → Flaky Tests & Reliability
> *Quarantine with discipline, treat retries as a controlled poison, learn when a flaky test is screaming about a real product bug, and design flakiness out before it happens.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- The Quarantine Pattern](#core-concept-1----the-quarantine-pattern)
5. [Core Concept 2 -- The Quarantine Discipline: TODO, Not Graveyard](#core-concept-2----the-quarantine-discipline-todo-not-graveyard)
6. [Core Concept 3 -- Retries: The Double-Edged Sword](#core-concept-3----retries-the-double-edged-sword)
7. [Core Concept 4 -- When a Flaky Test Reveals a Real Bug](#core-concept-4----when-a-flaky-test-reveals-a-real-bug)
8. [Core Concept 5 -- Prevention by Design: Determinism Seams](#core-concept-5----prevention-by-design-determinism-seams)
9. [Core Concept 6 -- Hermetic Tests & Isolation by Construction](#core-concept-6----hermetic-tests--isolation-by-construction)
10. [Core Concept 7 -- Triage: Fix, Quarantine, or Delete](#core-concept-7----triage-fix-quarantine-or-delete)
11. [Core Concept 8 -- Measuring Suite Reliability Over Time](#core-concept-8----measuring-suite-reliability-over-time)
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

> Focus: **The operational disciplines a senior owns — quarantine done right, retries as a measured trade-off, recognizing product flakiness behind test flakiness, and engineering determinism in from the start.**

A junior fixes a flaky test. A middle engineer can name its root cause. A senior owns the *system* that keeps a suite trustworthy at scale: deciding what to quarantine and for how long, whether retries are buying time or hiding bugs, when a flaky test is actually the only thing catching a real race in production, and how to build tests that can't flake in the first place.

The throughline remains: **a flaky test is a broken test, and trust is the asset.** Everything here is about protecting that trust while keeping the team unblocked.

## Prerequisites

- Junior + middle pages: the trust thesis and the full root-cause taxonomy with fixes.
- Experience running and maintaining a CI suite for a team.
- Familiarity with dependency injection, the `concurrency-patterns` skill, and [Test Doubles](../10-test-doubles-mocks-fakes/senior.md).

## Glossary

| Term | Meaning |
|------|---------|
| **Quarantine** | Moving a known-flaky test out of the merge-blocking suite while keeping it running and tracked. |
| **Retry / rerun-on-failure** | Automatically re-executing a failed test up to N times; "green if any attempt passes." |
| **Determinism seam** | An injected boundary (clock, RNG, network) that lets a test control an otherwise non-deterministic input. |
| **Hermetic test** | A test that depends on nothing outside its own controlled inputs. |
| **Flaky reveals real bug** | A flaky test that is correctly catching a genuine race/timeout in the product, not a test defect. |
| **Triage** | Deciding for each flaky test: fix now, quarantine, or delete. |
| **Pass rate / reliability** | The fraction of CI runs that are green without intervention. |
| **Flake budget** | An agreed cap on acceptable flakiness (introduced fully at the professional tier). |

## Core Concept 1 -- The Quarantine Pattern

When a test is flaky and you can't fix it *right now*, leaving it in the blocking suite poisons every merge — it'll randomly red-light unrelated PRs and train people to ignore CI. The disciplined move is **quarantine**: pull it out of the merge-gating set so it stops blocking, but keep running it on a separate track so you don't lose sight of it.

```python
# Mark the test so CI excludes it from the blocking suite but still runs & reports it.
import pytest

@pytest.mark.quarantine     # custom marker; CI runs these non-blocking
def test_payment_webhook_roundtrip():
    ...
```

```yaml
# CI: blocking job excludes quarantine; a separate non-blocking job runs them.
- name: blocking-tests
  run: pytest -m "not quarantine"          # gates the merge
- name: quarantined-tests
  run: pytest -m quarantine || true        # reports, never blocks
  continue-on-error: true
```

Quarantine **restores trust in the blocking suite** immediately: now red on the gate means a real problem again. The flaky test keeps running so you still see whether it's getting better or worse. What you must *not* do is delete it silently (you lose the coverage and the signal) or leave it blocking (you keep eroding trust).

## Core Concept 2 -- The Quarantine Discipline: TODO, Not Graveyard

Quarantine is dangerous precisely because it works *too well*. Once the pain of a blocking flake is gone, the incentive to fix it evaporates. Quarantine quietly becomes a **graveyard** of "temporarily" disabled tests — coverage you think you have but don't.

The discipline that prevents this:

- **Every quarantined test has an owner.** A name, not "the team." Unowned means unfixed.
- **Every quarantined test has a tracking ticket** linked from the code, treated as a real bug.
- **Every quarantined test has a deadline.** Two weeks, a sprint — pick a number and enforce it.
- **Auto-expiry.** If a test sits in quarantine past its deadline, escalate it or delete it — don't let it rot.

```python
@pytest.mark.quarantine(
    owner="bakhodir",
    ticket="QE-1423",
    deadline="2026-07-05",        # CI fails the build if this date passes
)
def test_payment_webhook_roundtrip():
    ...
```

> **Quarantine is a TODO with a deadline, not a place tests go to die.** A quarantine list that only grows is a sign of a team that has given up on its suite. Periodically review it; a healthy program keeps it small and moving.

The economics matter too: a quarantined test provides *zero* gate protection. The longer it stays out, the longer that code path is effectively untested. Treat the quarantine queue with the same urgency as a production-bug queue.

## Core Concept 3 -- Retries: The Double-Edged Sword

Auto-retry — "re-run the failed test up to N times; pass if any attempt is green" — is the most tempting and most dangerous tool in this topic.

```yaml
# JVM example: Gradle test-retry plugin
test {
  retry {
    maxRetries = 2
    maxFailures = 10           # disable retries if too many tests are failing
    failOnPassedAfterRetry = false
  }
}
```

The danger is brutal and concrete: **a green-on-retry hides flakiness *and* hides real race conditions.** Suppose production code has a 1-in-50 data race. A single run catches it 2% of the time — annoying but a genuine signal. Add 2 retries and the chance all three attempts hit the race drops to ~1-in-125,000. The test now goes green ~99.999% of the time. **You have not fixed the race. You have hidden a real production bug behind retries**, and shipped it.

So when are retries acceptable?

- **Acceptable, with limits:** end-to-end tests against networks/third-party systems you don't control, where transient infra failures are unavoidable. Even here: cap retries low (1-2), and **always record the retry rate**.
- **Not acceptable:** unit and integration tests of *your own* logic. A flaky unit test means your code or your test has a determinism bug. Retrying it masks exactly the bug you wrote the test to catch.

The non-negotiable rule: **if you retry, you must measure the retry rate and surface it.** A test that "passes" only after retries is not green — it's amber, and a rising retry rate is a leading indicator of a real bug or a degrading suite. A silent retry is a lie told to the whole team.

## Core Concept 4 -- When a Flaky Test Reveals a Real Bug

The deepest insight in this topic: **sometimes the test isn't flaky — the product is.**

A test that fails 1-in-N times because of a real data race, a real timeout that's *almost* always met, or a real ordering assumption in the code is doing its job perfectly. It is the only thing standing between you and an intermittent production incident. If you "stabilize" it by adding a sleep, a retry, or a quarantine, you have:

1. Silenced your only detector of a live bug.
2. Shipped a system that will fail intermittently for *users* instead of for CI.

```go
// The flaky test:
func TestCounterConcurrent(t *testing.T) {
    c := &Counter{}
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); c.Inc() }()
    }
    wg.Wait()
    require.Equal(t, 1000, c.value)   // sometimes 997, 998... FLAKY
}
```

The wrong response is "add a mutex around the test" or retry. The right response is `go test -race`, which points at the *product*:

```go
// The REAL bug the flaky test was catching:
func (c *Counter) Inc() { c.value++ }            // ❌ unsynchronized — data race

// The actual fix — in PRODUCTION code, not the test:
func (c *Counter) Inc() { atomic.AddInt64(&c.value, 1) }   // ✅
```

> Before you stabilize a flaky test, ask: **"is the test wrong, or is the product wrong?"** Reach for `go test -race` / ThreadSanitizer and the `concurrency-patterns` skill. Stabilizing the test when the product is flaky is how intermittent outages reach production. (Cross-ref concurrency.)

This is also the strongest argument *against* blanket auto-retry: it systematically converts "the product is flaky" into "CI is green," which is the worst possible outcome.

## Core Concept 5 -- Prevention by Design: Determinism Seams

The cheapest flaky test is the one that can't exist. Seniors prevent whole categories by building **determinism seams** into the code under test — injectable boundaries for every non-deterministic input.

- **Time.** Never call `time.Now()` / `Date.now()` directly in business logic. Inject a `Clock`. Tests pass a fixed or fake clock; no flakiness from boundaries, timezones, or DST. (See [Test Doubles](../10-test-doubles-mocks-fakes/senior.md).)
- **Randomness.** Inject the RNG (or seed it). Production uses a secure/real source; tests pass `Random(seed)`.
- **Network/I-O.** Inject the HTTP client / repository so tests substitute a fake. No real network in unit tests means no network flakiness. (Cross-ref test-doubles.)
- **Concurrency.** Provide deterministic hooks — done channels, completion callbacks, controllable schedulers — so tests wait on real events, not sleeps. (Cross-ref E2E for explicit waits.)
- **Collections.** Return sorted or canonicalized output where order isn't semantically meaningful, so callers (and tests) never depend on iteration order.

```typescript
// Determinism seam for time — the single most valuable one to add.
interface Clock { now(): Date }
class SystemClock implements Clock { now() { return new Date() } }
class FixedClock implements Clock {
  constructor(private t: Date) {}
  now() { return this.t }
}
// Production: new TokenService(new SystemClock())
// Test:       new TokenService(new FixedClock(new Date("2026-01-01")))
```

Design seams in, and the async/timing, non-determinism, and external-dependency families of flakiness mostly evaporate at the source.

## Core Concept 6 -- Hermetic Tests & Isolation by Construction

A **hermetic** test depends on nothing it doesn't control: no shared DB, no real clock, no network, no global state. Hermeticity is the structural cure for ordering, isolation, and external-dependency flakiness.

Build it in by construction, not by cleanup-after-the-fact:

- **Per-test isolation.** Each test gets a fresh schema/namespace, or runs inside a transaction rolled back at teardown. Containerized ephemeral databases (Testcontainers) give every run a clean instance. (See [Integration Testing](../03-integration-testing/senior.md).)
- **Unique resources.** Bind to ephemeral ports (`:0`), use unique temp dirs and random key prefixes so parallel tests never collide.
- **No shared mutable singletons in tested code.** Inject dependencies; reset any unavoidable statics in setup, not just teardown (so a previous crash can't poison you).
- **Independent test data.** Each test creates exactly the data it needs and owns its lifecycle. (See [Test Data Management](../11-test-data-management/senior.md).)

Hermetic tests are also a prerequisite for safe parallelism: you can only run tests in parallel if none of them share mutable state.

## Core Concept 7 -- Triage: Fix, Quarantine, or Delete

When a flake surfaces, a senior runs a fast decision:

```
Is the PRODUCT flaky (real race/timeout)?  → YES → fix the product. STOP. (Concept 4)
Can I fix the test cheaply now?            → YES → fix it (taxonomy). Done.
Is it blocking merges and not cheap?       → YES → QUARANTINE (owner+ticket+deadline).
Is the test low-value / redundant / costly to keep deterministic? → DELETE it.
```

**When to delete rather than fix.** Not every test is worth saving. Delete when: the test is redundant with cheaper coverage; it tests behavior no longer worth asserting; or making it deterministic would cost more than the bug it could catch. A deleted low-value flaky test is *better* than a quarantined one rotting forever — but deletion is a deliberate, reviewed decision with a rationale, never a stealth `@skip`.

> The cardinal sin is the *non-decision*: a flaky test left blocking, or silently skipped, with no owner and no plan. Every flake gets a verdict.

## Core Concept 8 -- Measuring Suite Reliability Over Time

You manage reliability as a trended metric, not a vibe.

- **Suite pass rate** — fraction of CI runs green without intervention (reruns/quarantine). Trend it weekly; a falling pass rate means trust is leaking.
- **Per-test flakiness rate** — `failures / runs` per test. Rank tests; the worst offenders get triaged first.
- **Retry rate** — how often any test passes only after a retry. A rising retry rate is a leading indicator of a real bug or a degrading suite.
- **Quarantine size & age** — how many tests are quarantined and how long. Should stay small and move; a growing, aging queue signals surrender.

Feed these into a dashboard and review them as a team. Reliability that isn't measured silently decays — every flake nudges the team one step closer to ignoring red. (See [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) for treating reliability as a first-class metric.)

## Real-World Examples

- **Retry hid an outage.** A service had a 1-in-40 race in connection handling. CI ran with 3 retries, so it was green ~99.998% of the time. The race manifested in production as intermittent 500s under load. Removing retries turned the flake back red, `-race` found the bug in a day. The retry config had been hiding a real incident for months.
- **Quarantine graveyard.** A monorepo accumulated 380 quarantined tests over two years with no deadlines. Nobody knew which code paths were actually covered. The cleanup project deleted half (redundant/obsolete) and fixed the rest — and instituted a 14-day quarantine expiry so it could never happen again.
- **The seam that ended a class of flakes.** A team introduced a `Clock` interface across the codebase. Every date/expiry/scheduling test became deterministic overnight; a recurring family of "midnight" and "DST" flakes simply stopped occurring.

## Mental Models

- **Quarantine = ICU, not morgue.** Tests go there to be treated under a deadline, not to be forgotten.
- **Retry is a controlled poison.** A tiny dose handles unavoidable infra flakiness; a large dose silently hides real bugs. Always measure the dose.
- **The flaky test might be the smartest one you have.** It may be the only thing catching a real race. Ask "test wrong, or product wrong?" first.
- **Determinism is designed in, not patched on.** Seams beat sleeps; hermeticity beats cleanup.

## Common Mistakes

- **Quarantine without deadline/owner** → permanent graveyard, silent coverage loss.
- **Blanket auto-retry on all tests** → systematically converts product bugs into green builds.
- **Stabilizing a test that's catching a real race** → ships the race to users.
- **Reading the real clock/RNG/network in tested code** → flakiness you'll fight forever instead of injecting once.
- **No reliability metrics** → you discover trust is gone only after the team already ignores red.
- **Silent `@skip` instead of a reviewed delete** → undocumented coverage hole.

## Test Yourself

1. Design a quarantine mechanism. What three pieces of metadata must each quarantined test carry, and why?
2. With math, explain how 2 retries can hide a 1-in-50 production race. What's the systemic harm?
3. When are retries defensible, and what must you *always* do if you use them?
4. A test fails 1-in-100 in a concurrent code path. Walk through deciding whether to fix the test or the product.
5. List four determinism seams and the flakiness family each one prevents.
6. Give two situations where deleting a flaky test is the correct call.

## Cheat Sheet

```text
QUARANTINE (restore trust in the gate)
  Move flaky test OUT of blocking suite, keep running non-blocking.
  MUST carry: owner + ticket + deadline. Auto-expire. Keep queue SMALL.
  Quarantine = TODO with a deadline, NOT a graveyard.

RETRIES (double-edged)
  Green-on-retry hides flakiness AND real races.
  OK (limited): E2E vs networks. NOT OK: your own unit/integration logic.
  ALWAYS record retry rate. A retried pass is AMBER, not green.

FLAKY MAY = REAL BUG
  Before stabilizing, ask: test wrong or PRODUCT wrong?
  Run -race / TSan. Fix the product, not the test. (concurrency-patterns)

PREVENTION BY DESIGN (seams)
  time→Clock | random→inject RNG | network→inject client | order→sort
  Hermetic + isolated-by-construction → safe parallelism.

TRIAGE: product-flaky→fix product | cheap→fix test | blocking→quarantine | low-value→delete
MEASURE: pass rate ↓ = trust leaking | flakiness rate | retry rate | quarantine size/age
```

## Summary

Seniors own the *system* that keeps a suite trustworthy. **Quarantine** restores trust in the blocking gate by pulling a known flake out of it — but only works with the discipline of owner, ticket, and deadline, or it becomes a graveyard. **Retries** are a controlled poison: a small dose absorbs unavoidable infra flakiness in E2E, but a large dose silently hides flakiness *and real product races* — so you cap them and always record the retry rate. The deepest move is recognizing when **the product, not the test, is flaky** and fixing the real race instead of muting the alarm. Best of all is **prevention by design** — determinism seams for time/random/network and isolation-by-construction make whole families of flakiness impossible. Throughout, you **measure** suite reliability over time, because a flaky test is a broken test and trust is the only asset your suite has.

## Further Reading

- Martin Fowler, "Eradicating Non-Determinism in Tests"
- Google, "Flaky Tests at Google and How We Mitigate Them" (and the test-certified / flaky infrastructure write-ups)
- Sam Saffron / Discourse and Spotify engineering blogs on flaky-test quarantine programs
- Gradle test-retry, `pytest-rerunfailures`, `go test -race` documentation
- The `concurrency-patterns` and `systematic-debugging` skills.

## Related Topics

- [End-to-End Testing](../04-end-to-end-testing/senior.md) — explicit waits; where bounded retries are legitimate.
- [Integration Testing](../03-integration-testing/senior.md) — hermetic DBs, transaction isolation.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/senior.md) — clock/RNG/network seams.
- [Test Data Management](../11-test-data-management/senior.md) — isolation-by-construction.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — reliability as a tracked metric.
