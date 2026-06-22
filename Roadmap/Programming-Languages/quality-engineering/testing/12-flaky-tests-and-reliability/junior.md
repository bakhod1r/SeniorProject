# Flaky Tests & Reliability — Junior Level

> **Roadmap:** [Testing](../README.md) → Flaky Tests & Reliability
> *A test that passes today and fails tomorrow on the exact same code is not a flaky test — it is a broken test, and it is quietly destroying your team's trust.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- What "Flaky" Actually Means](#core-concept-1----what-flaky-actually-means)
5. [Core Concept 2 -- Why Flakiness Is Existential: Trust Erosion](#core-concept-2----why-flakiness-is-existential-trust-erosion)
6. [Core Concept 3 -- The Most Common Cause: Waiting on a Sleep, Not a Condition](#core-concept-3----the-most-common-cause-waiting-on-a-sleep-not-a-condition)
7. [Core Concept 4 -- Other Things That Make Tests Flaky](#core-concept-4----other-things-that-make-tests-flaky)
8. [Core Concept 5 -- What To Do When You Hit a Flaky Test](#core-concept-5----what-to-do-when-you-hit-a-flaky-test)
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

> Focus: **Recognizing a flaky test, understanding why it is dangerous, and fixing the single most common cause — a fixed sleep instead of waiting for a real condition.**

You write a test. It passes. You push. CI goes red. You re-run it — and now it passes. Nothing in the code changed. You shrug and move on.

That moment, repeated across a team, is how test suites die. A test that produces different results on the same code is **flaky**. It feels harmless — "just re-run it" — but it is one of the most corrosive problems in software engineering, because it attacks the one thing your test suite exists to provide: **trust**.

This page teaches you what flakiness is, why it matters far more than juniors expect, and how to fix the cause you'll hit first.

## Prerequisites

- You can write and run a basic automated test (see [Unit Testing](../02-unit-testing/junior.md)).
- You understand pass/fail and what a CI run is.
- Basic familiarity with asynchronous code (callbacks, promises, async/await, or threads).

## Glossary

| Term | Meaning |
|------|---------|
| **Flaky test** | A test that passes and fails non-deterministically on unchanged code. |
| **Deterministic** | Same inputs always produce the same output. The goal for every test. |
| **Non-deterministic** | Output can differ run-to-run for reasons the test doesn't control (timing, randomness, order). |
| **Re-run / retry** | Running a failed test again to see if it passes. Useful for *detecting* flakiness, dangerous for *hiding* it. |
| **Green / Red** | Passing (green) / failing (red) test status. |
| **Race condition** | A bug where the result depends on the unpredictable timing of concurrent operations. |
| **Polling** | Repeatedly checking a condition until it becomes true (with a timeout), instead of waiting a fixed time. |
| **Trust** | The team's confidence that "red means broken." The real asset a suite protects. |

## Core Concept 1 -- What "Flaky" Actually Means

A test is flaky when **the same code, run twice, gives different test results.**

```
Run 1:  test_user_sees_dashboard  ✅ PASS
Run 2:  test_user_sees_dashboard  ❌ FAIL    ← nothing changed!
Run 3:  test_user_sees_dashboard  ✅ PASS
```

The key word is **non-deterministic**. A test that always fails isn't flaky — it's just failing, and that's honest. A test that always passes isn't flaky — it's reliable. Flaky is the in-between, "sometimes" state. That "sometimes" is the danger, because it means you cannot tell from a red result whether something is actually broken.

A good test answers one question precisely: *is the code correct?* A flaky test answers a different, useless question: *did I get lucky this time?*

> **The core slogan of this entire topic: a flaky test is a broken test.** It doesn't matter that it passes most of the time. A test you can't trust is worth less than no test at all, because it costs you time and confidence while giving you nothing reliable in return.

## Core Concept 2 -- Why Flakiness Is Existential: Trust Erosion

Here is the part juniors underestimate. The damage from a flaky test is **not the failure itself.** It's what the failure teaches your team.

Watch the chain of events:

1. A flaky test fails on someone's correct PR.
2. They learn: "red doesn't always mean I broke something."
3. So next time CI is red, they re-run instead of investigating.
4. Re-running becomes a reflex. **Red stops meaning "stop."**
5. One day, a *real* bug turns the suite red. Everyone re-runs out of habit. The bug ships.

This is **trust erosion**, and it's why flakiness is existential. The entire value of a test suite is the promise: **"if it's green, you're safe; if it's red, stop and look."** A flaky test breaks that promise. Once people don't believe red, the suite is decoration. You're paying CI bills and writing tests for nothing.

> **Trust is the asset.** Tests don't protect code directly — they protect the *trust* that lets a team move fast without fear. Protect that trust like it's production data.

This is why a single ignored flaky test is dangerous out of all proportion to its size. It's not "one annoying test." It's one crack that trains everyone to ignore cracks.

## Core Concept 3 -- The Most Common Cause: Waiting on a Sleep, Not a Condition

The number-one cause of flaky tests you'll meet as a junior is **timing**: the test asks for something that happens *asynchronously* (in the background, on another thread, after a network call) and then guesses how long to wait.

The bad pattern is a **fixed sleep**:

```python
# ❌ FLAKY: guess that 1 second is "enough"
def test_order_is_processed():
    submit_order(order_id=42)
    time.sleep(1)                       # hope the worker finished by now
    assert get_status(42) == "processed"
```

Why is this flaky? `sleep(1)` is a **guess**. On your fast laptop the worker finishes in 200 ms, so the test passes. On a loaded CI machine it takes 1.3 seconds, so the assertion runs *before* the work is done, and the test fails. Same code, different machine speed, different result. Pure flakiness.

Sleeps also have no good answer: too short and it's flaky, too long and your suite crawls. Both are bad.

The fix is to **poll for the actual condition** — repeatedly check until the thing you want is true, up to a maximum timeout:

```python
# ✅ STABLE: wait for the real condition, not a guessed duration
def wait_until(predicate, timeout=5.0, interval=0.05):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(interval)
    raise AssertionError(f"condition not met within {timeout}s")

def test_order_is_processed():
    submit_order(order_id=42)
    wait_until(lambda: get_status(42) == "processed")   # poll, don't guess
    assert get_status(42) == "processed"
```

Now the test waits *exactly as long as needed* and no longer. On a fast machine it returns in 200 ms; on a slow machine it waits up to 5 seconds. It only fails if the work genuinely never completes — which is a *real* failure, the kind you want.

> Rule of thumb: **if you wrote `sleep` in a test, you probably wrote a flaky test.** Replace it with "wait until this condition is true." End-to-end frameworks call this an *explicit wait* (see [End-to-End Testing](../04-end-to-end-testing/junior.md)).

## Core Concept 4 -- Other Things That Make Tests Flaky

Beyond sleeps, here are the causes you'll bump into early. You'll go deeper at the next tier; for now, just learn to *recognize* them.

- **Randomness without a seed.** A test that generates a random value behaves differently each run.
- **Time and dates.** Tests that use "now" break at midnight, month boundaries, or in a different timezone.
- **Test order / shared state.** Test A leaves data behind that Test B accidentally depends on, so they pass together but fail when run alone or reordered.
- **Real network / external services.** Calling a real API means your test fails when the network hiccups — that's not your bug.
- **Map / set iteration order.** In some languages, iterating a map yields elements in an unpredictable order; asserting a fixed order is flaky.

Here's a quick seeded-random fix you can apply today:

```python
# ❌ FLAKY: unseeded randomness — different data every run
def test_shuffle_keeps_all_items():
    items = generate_random_items()      # different each run
    ...

# ✅ STABLE: seed it so the run is reproducible
def test_shuffle_keeps_all_items():
    rng = random.Random(12345)           # fixed seed → same data every run
    items = [rng.randint(0, 100) for _ in range(10)]
    shuffled = shuffle(items, rng=rng)
    assert sorted(shuffled) == sorted(items)
```

## Core Concept 5 -- What To Do When You Hit a Flaky Test

You *will* hit one. Here's the junior playbook:

1. **Don't just re-run and move on.** That's the reflex that erodes trust. A green-on-rerun is information, not absolution.
2. **Reproduce it.** Run the test many times in a loop. If it fails maybe 1-in-20, you've confirmed flakiness.
   ```bash
   # Run a single test 50 times to surface flakiness
   for i in $(seq 1 50); do pytest tests/test_orders.py::test_order_is_processed -q || echo "FAILED run $i"; done
   ```
   In Go: `go test -run TestOrder -count=50`.
3. **Find the cause** using the list above — most likely a sleep, randomness, time, or shared state.
4. **Fix it or report it.** If you can fix it (sleep→poll, seed the random), do so. If you can't yet, tell a senior — a flaky test is a real bug that needs an owner, not something to silently ignore.
5. **Never disable-and-forget.** If a test must be temporarily turned off, it needs a ticket and an owner (you'll learn this *quarantine* discipline at the senior tier). A disabled test with no follow-up is worse than a flaky one — it's a silent gap.

## Real-World Examples

- **The "just re-run it" Slack culture.** A team has one flaky login test. People post "re-running CI 🤞" daily. Six months later a genuine auth regression ships to production because everyone assumed the red was "the usual flake." The product bug existed for two weeks before anyone trusted the red enough to look.
- **The midnight failure.** A test asserting `created_at == today()` passes all day and fails for engineers in a different timezone whose "today" has already rolled over. The fix: inject a fixed clock instead of reading the real time.
- **Works on my machine.** A test passes locally (fast SSD, no load) and fails in CI (shared, slow, parallel). Classic `sleep`-too-short timing flake. The machine wasn't the problem; the guessed wait was.

## Mental Models

- **A flaky test is a broken test.** Memorize this. It reframes "annoying" into "must fix."
- **Trust is the asset.** The suite's job is to make "green = safe, red = stop" believable. Flakiness attacks that directly.
- **Sleep is a guess; polling is a measurement.** Never bet your test on a guessed duration.
- **The boy who cried wolf.** A flaky test cries "wolf" at random. Eventually nobody comes — even when there's a real wolf.

## Common Mistakes

- **Re-running until green and calling it fixed.** You hid the symptom; the disease (and the trust damage) remain.
- **Adding `sleep(5)` to "make it pass."** You traded a fast flaky test for a slow flaky test.
- **Assuming flakiness is always the test's fault.** Sometimes the *product* has a real race condition and the flaky test is correctly catching it. (More on this later.)
- **Silently `@skip`-ing the test.** A skipped test with no ticket is a permanent blind spot nobody remembers.
- **Asserting on map/iteration order** when the language doesn't guarantee it. Sort first, or assert on a set.

## Test Yourself

1. Define a flaky test in one sentence. Why is "it passes most of the time" not a defense?
2. Explain *trust erosion*: how does one ignored flaky test endanger the whole suite?
3. Why is `time.sleep(1)` in a test a flakiness risk? What should you use instead?
4. You see CI go red on your PR and a teammate says "just re-run it." What's the *correct* first move?
5. Rewrite a test that uses unseeded randomness to be deterministic.

## Cheat Sheet

```text
DEFINITION
  Flaky = passes AND fails on the SAME code, non-deterministically.
  "A flaky test is a broken test." Trust is the asset.

#1 CAUSE (junior)
  Fixed sleep instead of waiting for a condition.
  ❌ sleep(1); assert done
  ✅ wait_until(lambda: done, timeout=5)

QUICK FIXES
  Randomness  → seed it: random.Random(12345)
  Time/date   → inject a fixed clock, don't read now()
  Map order   → sort or compare as a set
  Network     → don't call real services in unit tests

WHEN YOU HIT ONE
  1. Don't just re-run & move on
  2. Reproduce in a loop (50x)
  3. Find the cause
  4. Fix it, or report to a senior with a ticket
  5. Never disable-and-forget
```

## Summary

A flaky test passes and fails on the same code for reasons the test doesn't control. It is not a minor annoyance — **a flaky test is a broken test**, because the real damage is **trust erosion**: one ignored flake trains the team to ignore red, and a suite you don't trust is worthless. The cause you'll meet first is a **fixed sleep** where you should **poll for a condition**. Other early causes are unseeded randomness, real time/dates, shared state, and real network calls. When you hit a flaky test, reproduce it, find the cause, and fix or report it — never just re-run and move on.

## Further Reading

- Martin Fowler, "Eradicating Non-Determinism in Tests"
- Google Testing Blog, "Flaky Tests at Google and How We Mitigate Them"
- The `systematic-debugging` skill — a disciplined approach to reproducing and isolating intermittent failures.

## Related Topics

- [End-to-End Testing](../04-end-to-end-testing/junior.md) — explicit waits vs. sleeps in UI tests.
- [Integration Testing](../03-integration-testing/junior.md) — where shared-state flakiness lives.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/junior.md) — injecting a fake clock/random for determinism.
- [Test Data Management](../11-test-data-management/junior.md) — isolated, repeatable data.
- [Unit Testing](../02-unit-testing/junior.md) — the foundation a reliable suite is built on.
