# Unit Testing — Senior Level

> **Roadmap:** [Testing](../README.md) → Unit Testing
>
> *Khorikov's four pillars and the tensions between them; test smells; designing a suite that resists refactoring at scale.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Four Pillars of a Good Unit Test](#core-concept-1--the-four-pillars-of-a-good-unit-test)
5. [Core Concept 2 — The Pillars in Tension](#core-concept-2--the-pillars-in-tension)
6. [Core Concept 3 — Resistance to Refactoring at Scale](#core-concept-3--resistance-to-refactoring-at-scale)
7. [Core Concept 4 — Designing Code for Testability](#core-concept-4--designing-code-for-testability)
8. [Core Concept 5 — A Catalogue of Test Smells](#core-concept-5--a-catalogue-of-test-smells)
9. [Core Concept 6 — Humble Object and the Functional Core](#core-concept-6--humble-object-and-the-functional-core)
10. [Core Concept 7 — Controlling Time, Randomness, and the Outside World](#core-concept-7--controlling-time-randomness-and-the-outside-world)
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

> Focus: **judging a test's *value* with the four pillars, navigating the tension between them, and shaping both tests and production code so a large suite resists refactoring.**

Junior was *can you write a test*. Middle was *what is a unit, and do you test behavior*. Senior is *is this test worth its weight* — and how do you keep a suite of tens of thousands of tests fast, trustworthy, and refactor-friendly at the same time.

The central framework here is Vladimir Khorikov's **four pillars**. They turn "is this a good test?" from a matter of taste into a defensible analysis. Crucially, the pillars are **in tension** — you cannot max all four — and recognizing the trade-offs is what separates a senior test author from someone cargo-culting coverage. We then catalogue the **smells** that signal a test is failing one or more pillars, and the production-code design (humble object, functional core) that makes good tests cheap to write.

---

## Prerequisites

- Solid on the middle tier: classical vs mockist, behavior-not-implementation, parameterization, state vs interaction.
- You've maintained a test suite long enough to feel the pain of brittle tests during a refactor.
- You can reason about dependency injection, ports/adapters, and pure vs impure code.
- Familiarity with [Test Doubles](../10-test-doubles-mocks-fakes/) and the concept of mutation score ([Mutation Testing](../07-mutation-testing/)).

---

## Glossary

| Term | Meaning |
|---|---|
| **Four pillars** | Khorikov's criteria: regression protection, resistance to refactoring, fast feedback, maintainability. |
| **Regression protection** | A test's ability to surface a real bug when one is introduced. |
| **Resistance to refactoring** | A test's ability to *not* produce a false positive on a behavior-preserving change. |
| **False positive (test)** | The test fails but the behavior is correct (a "false alarm"). |
| **False negative (test)** | The test passes but the behavior is broken (a missed bug). |
| **Humble object** | Pattern that extracts logic out of a hard-to-test shell (UI, framework) into a testable core. |
| **Functional core, imperative shell** | Architecture: pure decision-making logic surrounded by a thin I/O layer. |
| **Mutation score** | Fraction of injected faults the suite catches — the honest measure of regression protection. |
| **Test smell** | A recurring pattern in test code that signals a deeper problem. |
| **Eradicating brittleness** | Removing false positives so failures are always meaningful. |

---

## Core Concept 1 — The Four Pillars of a Good Unit Test

Every unit test can be scored on four attributes. A test's *value* is roughly the product of the first two, weighed against the cost captured by the last two.

**1. Protection against regressions.** When a real bug is introduced into the code the test covers, does the test fail? This is the whole reason tests exist. It depends on how much code the test exercises, how complex that code is, and how meaningful the assertions are. A test that runs a lot of important logic and checks the real outcome has high regression protection. (`assert true` has none.) The honest, mechanical measure is **mutation score** — see [Mutation Testing](../07-mutation-testing/).

**2. Resistance to refactoring.** When you change the code's *structure* without changing its *behavior*, does the test stay green? A test with high resistance produces a failure **only** when behavior actually breaks. The enemy here is the **false positive** — a failing test on correct code. False positives are catastrophic at scale: they train the team to ignore red, and they make every refactor expensive, so refactoring stops and the code rots. Resistance to refactoring comes almost entirely from **testing observable behavior, not implementation**.

**3. Fast feedback.** How quickly does the test run? Speed is what makes a suite *runnable on every change*. A test that takes 2 ms can run thousands of times a day; a 2-second "unit" test runs rarely and protects little. Fast feedback is why unit tests forbid I/O, network, disk, and the clock.

**4. Maintainability.** How hard is the test to read and to keep working? Two factors: how much code is in the test (setup, helpers) and how many out-of-process dependencies it touches (each one is a thing to configure and a source of flakiness). An unreadable test is a test nobody updates — and an un-updated test rots into a false negative.

```text
TEST VALUE ≈ regression-protection × resistance-to-refactoring
             ───────────────────────────────────────────────
                  weighed against feedback-speed & maintainability cost
```

A test that scores low on any single pillar is a candidate for deletion or rewrite. Low on *resistance* especially: a fragile test does active harm.

---

## Core Concept 2 — The Pillars in Tension

You cannot maximize all four. The first three trade against each other; only maintainability can be pursued freely. Understanding the trade-offs is the senior skill.

**Regression protection ↔ resistance to refactoring.** Both are about *accuracy* of the test signal — protection minimizes false negatives (missed bugs), resistance minimizes false positives (false alarms). They pull apart through **how** you reach the SUT:

- End-to-end-style tests that drive a lot of code have *high* protection but *low* resistance only if they assert on implementation; well-written, they also resist refactoring — but they're slow.
- Mockist tests that pin every interaction have *high* localization but *low* resistance to refactoring — they break on rearrangement.

**Fast feedback ↔ regression protection.** Bigger tests catch more (more code exercised) but run slower. Tiny tests are fast but each catches little. This is precisely why the **pyramid** exists: a base of fast, focused unit tests plus a thin top of slow, broad tests — see [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/).

The one corner you can almost always win: a test that is **trivial, brittle, AND slow** has no redeeming pillar — delete it. The hard cases are the genuine three-way trade-offs.

Khorikov's key insight: **of the three competing pillars, resistance to refactoring is non-negotiable** — a test is either resistant or it isn't, and a non-resistant test is worse than no test because it generates noise. So you fix resistance first (test behavior), then trade protection against speed by choosing the test's *scope* and its place in the pyramid.

```text
        REGRESSION PROTECTION
               ╱ ╲
              ╱   ╲          pick your scope along these edges;
             ╱     ╲         RESISTANCE is mandatory, not a tradeoff
   FAST ────────────── RESISTANCE TO
 FEEDBACK              REFACTORING
```

---

## Core Concept 3 — Resistance to Refactoring at Scale

At ten tests, brittleness is annoying. At ten thousand, it's existential. A single refactor that turns 300 tests red — none for a real reason — costs days and teaches the org that refactoring is dangerous. The compounding effect:

1. Refactor triggers a wave of false positives.
2. The engineer can't tell false alarms from real failures, so they distrust *all* red.
3. They either avoid refactoring (code decays) or rubber-stamp test changes (real failures slip through).
4. The suite's signal-to-noise collapses; eventually people add `@Disabled`.

The structural causes of low resistance at scale, and the fixes:

| Cause | Fix |
|---|---|
| Mocking owned, in-process collaborators | Use real / in-memory fakes; mock only unmanaged out-of-process deps |
| Asserting on private state or call sequences | Assert on observable output and resulting state |
| Tests that mirror the production code's structure 1:1 | Test through stable public contracts, not internal seams |
| Snapshot/approval tests over volatile output | Reserve for stable, reviewed output (see [Snapshot Testing](../08-snapshot-and-approval-testing/)) |
| Over-specified mocks (`verifyNoMoreInteractions`) | Verify only the interactions that *are* the contract |

The discipline that buys resistance most cheaply: **drive every test through the same public surface a real caller uses, and never let a test know anything a caller wouldn't.** When you find yourself reaching past the public API — reflection on a private field, a `@VisibleForTesting` method, an internal call assertion — treat it as a design smell, not a testing necessity. It usually means a hidden unit wants to be extracted and tested on its own public surface (Concept 6).

---

## Core Concept 4 — Designing Code for Testability

Hard-to-test code is usually badly-designed code; the test is just the messenger. The leverage is in production design, not test trickery.

**Inject dependencies; don't reach for them.** Code that calls `new Clock()`, `Database.getInstance()`, or `time.Now()` internally cannot be tested without the real thing. Pass them in.

```go
// ❌ Untestable: reaches for the clock and the DB itself.
func (s *Service) ExpireSessions() error {
    now := time.Now()
    sessions, _ := db.Global().LoadActive()
    // ...
}

// ✅ Testable: dependencies are parameters / fields.
type Service struct {
    now   func() time.Time   // injected clock
    repo  SessionRepo        // injected store
}
func (s *Service) ExpireSessions() ([]ID, error) {
    sessions, err := s.repo.LoadActive()
    if err != nil { return nil, err }
    var expired []ID
    for _, sess := range sessions {
        if sess.ExpiresAt.Before(s.now()) {
            expired = append(expired, sess.ID)
        }
    }
    return expired, nil
}
```

Now the test controls time and uses an in-memory repo — fast, deterministic, no real DB:

```go
func TestExpireSessions_ReturnsOnlyPastDeadlines(t *testing.T) {
    fixed := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
    repo := &InMemorySessionRepo{sessions: []Session{
        {ID: "a", ExpiresAt: fixed.Add(-time.Hour)}, // expired
        {ID: "b", ExpiresAt: fixed.Add(time.Hour)},  // alive
    }}
    s := &Service{now: func() time.Time { return fixed }, repo: repo}

    expired, err := s.ExpireSessions()

    require.NoError(t, err)
    assert.Equal(t, []ID{"a"}, expired)
}
```

Note this test asserts on the **returned set of expired IDs** (observable behavior), not on which internal methods were called — high resistance to refactoring, and it would catch a real off-by-one in the comparison (high regression protection).

---

## Core Concept 5 — A Catalogue of Test Smells

Each smell maps to a violated pillar. Learn to name them in review.

- **Fragile test.** Breaks on behavior-preserving change. *Violates resistance.* Cause: implementation coupling.
- **Test that restates the implementation.** The assertion is the production logic copied into the test (`assert result == price * (1 - off/100)`). *Violates regression protection* — it can't catch a bug in the formula because it shares the formula. Assert against an independently-derived expected value.
- **Excessive setup / "the Mother of all fixtures."** 40 lines of arrangement for a 2-line act. *Violates maintainability* and signals the SUT has too many dependencies.
- **Assertion roulette.** A dozen unrelated assertions with no messages; when it fails, you can't tell which one. *Violates maintainability.* One behavior per test, descriptive failure messages.
- **Mystery guest.** The test depends on external data it doesn't show — a fixture file, a shared DB row, an env var. *Violates maintainability and resistance.* Make inputs explicit and local.
- **Slow unit.** A "unit" test that takes hundreds of ms — usually because it secretly touches I/O. *Violates fast feedback.* Find and remove the hidden dependency.
- **Eager test / testing everything at once.** One test exercising five behaviors. Split it.
- **Conditional logic in tests** (`if`/`for`/`try` deciding what to assert). A test with branches has untested branches of its own. Replace with parameterization.
- **Flaky test.** Non-deterministic pass/fail. *Violates everything* — see [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/). A flaky test is a trust leak; quarantine and fix, never ignore.

The `code-smell-detection` skill and `unit-testing-patterns` skill expand these with refactors.

---

## Core Concept 6 — Humble Object and the Functional Core

The reason some code is hard to test is that **logic is tangled with I/O**. The fix is architectural: separate the part that *decides* from the part that *acts*.

**Functional core, imperative shell.** Push all decision-making into pure functions (no I/O, no clock, no mutation of the world) — the "core." Wrap it in a thin "shell" that reads inputs, calls the core, and writes outputs. The core is trivially unit-testable (pure in/out, maximum resistance and protection). The shell is so thin it needs only a couple of integration tests.

```python
# Functional core — pure, exhaustively unit-tested.
def decide_refund(order, today) -> RefundDecision:
    if order.status != "delivered":
        return RefundDecision(allowed=False, reason="not delivered")
    if (today - order.delivered_on).days > 30:
        return RefundDecision(allowed=False, reason="window expired")
    return RefundDecision(allowed=True, amount=order.total)

# Imperative shell — thin, integration-tested, holds the I/O.
def process_refund(order_id, gateway, repo, clock):
    order = repo.get(order_id)
    decision = decide_refund(order, clock.today())      # ← all logic here
    if decision.allowed:
        gateway.refund(order.payment_id, decision.amount)
        repo.mark_refunded(order_id)
    return decision
```

`decide_refund` is where the bugs and the branches live, and it's a pure function — you can table-drive 20 scenarios against it in microseconds. The **Humble Object** pattern is the same idea applied to UI/framework shells: make the untestable layer so dumb it doesn't need testing.

---

## Core Concept 7 — Controlling Time, Randomness, and the Outside World

Determinism is a pillar prerequisite. Three classic sources of non-determinism and how to neutralize them:

- **Time.** Inject a clock (`func() time.Time`, `Clock` interface, `Instant.now()` via a `Clock` bean). Never call the global clock in testable logic. For "now-ish" assertions, assert a range, not an instant.
- **Randomness.** Inject the RNG or seed it deterministically in tests. A test that depends on real randomness is flaky by construction.
- **Concurrency / ordering.** Don't `sleep` and hope. Pull scheduling out of the logic, or test the synchronous core and leave concurrency to a dedicated, carefully-designed test.

```ts
// ✅ Vitest: freeze the clock so the test is deterministic.
import { vi, it, expect, afterEach } from "vitest";
afterEach(() => vi.useRealTimers());

it("marks a token expired one hour after issue", () => {
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  const token = issueToken();                       // issued at 12:00
  vi.setSystemTime(new Date("2026-01-01T13:00:01Z")); // advance > TTL
  expect(isExpired(token)).toBe(true);
});
```

Anything you can't make deterministic doesn't belong in the unit layer — push it up to integration ([Integration Testing](../03-integration-testing/)).

---

## Real-World Examples

**1. The suite that scored its own tests.** A platform team ran [mutation testing](../07-mutation-testing/) over a 12,000-test module and found a 41% mutation score — most tests restated the implementation and caught nothing. High line coverage, low protection. They rewrote assertions to compare against independently-computed expected values; the mutation score rose to 78% and they *deleted* 1,500 tests that protected nothing, making the suite faster and more trustworthy at once.

**2. Refactoring rescued by resistance.** A billing engine was migrated from inheritance to composition. Because the tests asserted on computed invoices (behavior) and used real in-memory line-item objects rather than mocks, the entire 800-test suite stayed green through a structural overhaul — turning a feared rewrite into a confident afternoon.

**3. Functional core unlocking a feature.** A fraud-scoring rule lived inside a Kafka consumer (impossible to unit-test). Extracting the scoring into a pure `score(transaction) -> Risk` function let the team table-drive 60 edge cases in milliseconds; the consumer shell shrank to five lines and one integration test. The bug rate on fraud rules dropped sharply.

---

## Mental Models

- **The four pillars are a budget, not a checklist.** You spend protection, resistance, and speed against each other; resistance is the one you refuse to spend.
- **A false positive is more expensive than a false negative at scale** — a missed bug costs once; a brittle test taxes every future change and erodes trust in the whole suite.
- **The test is the messenger.** Hard-to-test code is badly-designed code. Fix the design, not the test.
- **Push logic to a pure core.** If it has no I/O, it's trivially testable; arrange your architecture so most logic lives there.
- **Mutation score is the truth serum.** Coverage says the line ran; mutation testing says a test would have *caught a bug* in it.

---

## Common Mistakes

| Mistake | Pillar violated | Fix |
|---|---|---|
| Assertion duplicates production formula | Regression protection | Compare to independently-derived expected value |
| Chasing coverage %, ignoring mutation score | Regression protection | Measure protection with mutation testing |
| Tolerating brittle tests "because they pass now" | Resistance to refactoring | Rewrite to behavior; brittle tests are net-negative |
| Hidden I/O in a "unit" test | Fast feedback | Inject dependencies; move I/O to integration |
| Logic tangled with the framework/shell | Maintainability | Extract a functional core / humble object |
| Global clock / RNG inside logic | Determinism → all pillars | Inject time and randomness |

---

## Test Yourself

1. Name the four pillars and what each one protects against.
2. Explain why resistance to refactoring is the one pillar you should never trade away.
3. A test asserts `result == price * (1 - off/100)`. Which pillar does it fail, and why is high coverage misleading here?
4. Why is a false positive more damaging than a false negative in a 10,000-test suite?
5. Describe the functional-core/imperative-shell split and which part gets unit-tested.
6. List four test smells and the pillar each one signals.
7. Coverage is 95% but mutation score is 40%. What does that tell you, and what do you do?

---

## Cheat Sheet

```text
FOUR PILLARS
  1 regression protection   ← would it catch a real bug?  (measure: mutation score)
  2 resistance to refactor  ← stays green on behavior-preserving change?  (NON-NEGOTIABLE)
  3 fast feedback           ← runs in ms?
  4 maintainability         ← readable, few external deps?

  value ≈ (1 × 2) − cost(3,4) ;  fix 2 first, then trade 1 ↔ 3 via scope

SMELLS → PILLAR
  fragile / impl-coupled .......... resistance
  assertion restates impl ......... protection
  excessive setup / mystery guest . maintainability
  assertion roulette .............. maintainability
  slow "unit" (hidden I/O) ........ fast feedback
  flaky ........................... all of them

TESTABLE DESIGN
  inject clock · inject RNG · inject repos
  functional core (pure logic) + imperative shell (thin I/O)
  test through public contract only — reaching past it = design smell
```

---

## Summary

A senior judges tests by **Khorikov's four pillars**: regression protection, resistance to refactoring, fast feedback, maintainability. They are **in tension** — you trade protection against speed by choosing scope — but **resistance to refactoring is non-negotiable**, because a brittle test produces false positives that, at scale, destroy trust in the entire suite and stop the team from refactoring. You buy resistance by testing observable behavior through public contracts, never internals; you buy protection (measured honestly by **mutation score**, not coverage) by asserting against independently-derived results. The deepest leverage is in **production design**: inject time, randomness, and dependencies, and split a **functional core** from an **imperative shell** so the bulk of your logic is pure and trivially testable. Learn the **test smells**, name them in review, and treat every reach past the public API as a design problem, not a testing one.

---

## Further Reading

- Vladimir Khorikov, *Unit Testing: Principles, Practices, and Patterns* — the four pillars in full.
- Gary Bernhardt, "Boundaries" / "Functional Core, Imperative Shell" (talk).
- Michael Feathers, *Working Effectively with Legacy Code* — seams and testability.
- Gerard Meszaros, *xUnit Test Patterns* — the definitive test-smell catalogue.
- The `unit-testing-patterns` and `code-smell-detection` skills.

---

## Related Topics

- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — scope trade-offs across the whole suite.
- [Mutation Testing](../07-mutation-testing/) — the honest measure of regression protection.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/) — doubles without sacrificing resistance.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — protecting the determinism pillar.
- [Code Coverage](../../code-coverage/) — why coverage alone is a weak signal.
- **Next:** [Unit Testing — Professional Level](professional.md).
