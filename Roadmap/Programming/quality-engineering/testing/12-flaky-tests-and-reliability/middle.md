# Flaky Tests & Reliability — Middle Level

> **Roadmap:** [Testing](../README.md) → Flaky Tests & Reliability
> *Master the root-cause taxonomy of flakiness — async, ordering, isolation, concurrency, non-determinism, external deps, leaks, environment — and learn to detect and measure it instead of guessing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- The Root-Cause Taxonomy](#core-concept-1----the-root-cause-taxonomy)
5. [Core Concept 2 -- Async & Timing](#core-concept-2----async--timing)
6. [Core Concept 3 -- Test Ordering & Shared State](#core-concept-3----test-ordering--shared-state)
7. [Core Concept 4 -- Isolation Failures: Leaked Singletons, Static & DB State](#core-concept-4----isolation-failures-leaked-singletons-static--db-state)
8. [Core Concept 5 -- Non-Determinism: Random, Time, Iteration Order, Locale](#core-concept-5----non-determinism-random-time-iteration-order-locale)
9. [Core Concept 6 -- External Dependencies, Concurrency & Resource Leaks](#core-concept-6----external-dependencies-concurrency--resource-leaks)
10. [Core Concept 7 -- Detection & Measurement](#core-concept-7----detection--measurement)
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

> Focus: **The complete root-cause taxonomy of flaky tests — recognizing each category and fixing it — plus how to detect and measure flakiness rather than rely on gut feel.**

At the junior tier you learned that a flaky test is a broken test and that the trust it erodes is the real damage. You fixed your first sleep→poll case. Now you need the **full diagnostic map**: when a test is flaky, what *kind* of flaky is it, and what's the canonical fix?

This page is built around the **root-cause taxonomy**. Almost every flaky test in existence falls into one of these buckets. Learn to name the bucket on sight, and fixing becomes mechanical instead of mysterious.

## Prerequisites

- The junior page: flaky = broken, trust is the asset, sleep→poll.
- Comfortable writing tests with setup/teardown and fixtures.
- Basic understanding of threads/async, databases in tests, and CI.
- Familiarity with [Test Doubles](../10-test-doubles-mocks-fakes/middle.md) and [Test Data Management](../11-test-data-management/middle.md).

## Glossary

| Term | Meaning |
|------|---------|
| **Root cause** | The underlying reason a test is non-deterministic, not the surface symptom. |
| **Hermetic test** | A test that depends on nothing outside its own controlled inputs — no real network, clock, or shared state. |
| **Test isolation** | The property that each test starts from a clean, independent state and leaves no residue. |
| **Order dependence** | A test that only passes (or fails) depending on which tests ran before it. |
| **Flakiness rate** | The fraction of runs in which a given test fails despite no code change. |
| **Polling / explicit wait** | Repeatedly checking a condition with a timeout, instead of sleeping a fixed time. |
| **Seed** | A fixed starting value that makes a random generator reproducible. |
| **Test pollution** | When one test mutates shared state (DB rows, statics, globals) that another test reads. |

## Core Concept 1 -- The Root-Cause Taxonomy

Every flaky test traces to one of these eight families. Internalize this list — it's the spine of the whole discipline.

| # | Root cause | Smell | One-line fix |
|---|-----------|-------|-------------|
| 1 | **Async / timing** | `sleep(n)`; "works locally, fails in CI" | Poll for a condition with a timeout |
| 2 | **Order & shared state** | Passes in suite, fails alone (or vice versa) | Make tests independent; reset state |
| 3 | **Isolation failure** | Leaked singletons, static fields, stray DB rows | Per-test isolation/transactions; reset statics |
| 4 | **Concurrency / races** | Fails ~1/N runs, no pattern | Fix the real race (in test *or* product) |
| 5 | **Non-determinism** | Random/time/map-order/locale in assertions | Seed it; inject a clock; sort; pin locale |
| 6 | **External dependencies** | Fails on network/3rd-party hiccup | Stub the dependency; make it hermetic |
| 7 | **Resource leaks/exhaustion** | Fails late in the run, ports/FDs/memory | Close resources; bound pools; clean up |
| 8 | **Environment differences** | CI vs. local, OS, timezone, container | Pin/normalize the environment |

> Mental shortcut: when a test flakes, walk the table top to bottom and ask "could it be *this*?" The first match is usually right.

## Core Concept 2 -- Async & Timing

The most common family. The work happens asynchronously and the test guesses how long to wait.

```go
// ❌ FLAKY: fixed sleep races the goroutine
func TestCacheWarmup(t *testing.T) {
    cache.WarmAsync()
    time.Sleep(100 * time.Millisecond) // guess
    if !cache.IsWarm() {
        t.Fatal("cache not warm")
    }
}

// ✅ STABLE: poll until ready, bounded by a timeout
func TestCacheWarmup(t *testing.T) {
    cache.WarmAsync()
    require.Eventually(t, cache.IsWarm, 5*time.Second, 10*time.Millisecond)
}
```

`require.Eventually` (testify) polls every 10 ms up to 5 s. **Recognize it** by `sleep` calls and the "works on my machine" signature. **Fix it** by waiting on the actual post-condition — a status, a row, an element. Even better, expose a deterministic hook (a callback, a channel, a done signal) so the test waits on a *real event* rather than polling.

## Core Concept 3 -- Test Ordering & Shared State

A test passes only because of what ran before it, or fails because a sibling polluted shared state.

```python
# ❌ FLAKY (order-dependent): relies on a module-level list
USERS = []

def test_add_user():
    USERS.append("alice")
    assert len(USERS) == 1          # passes only if run first

def test_count_users():
    assert len(USERS) == 1          # passes only if test_add_user ran first
```

Run these in a different order (or in parallel) and they fail. **Recognize it** with the rule: *a test that passes in the suite but fails when run alone — or fails when the suite is shuffled — is order-dependent.* Modern runners can shuffle order to expose this (`pytest -p randomly`, `go test -shuffle=on`).

```python
# ✅ STABLE: each test owns its state
def test_add_user():
    users = []
    add_user(users, "alice")
    assert len(users) == 1

def test_count_users():
    users = ["alice"]
    assert count(users) == 1
```

The principle: **every test must set up its own world and tear it down.** Never let global lists, caches, or env vars carry data between tests.

## Core Concept 4 -- Isolation Failures: Leaked Singletons, Static & DB State

A subtler cousin of ordering: state leaks through singletons, static fields, or a shared database.

```python
# ❌ FLAKY: a leaked singleton remembers the previous test
class FeatureFlags:        # process-wide singleton
    _instance = None
    enabled = set()

def test_premium_on():
    FeatureFlags.instance().enabled.add("premium")
    assert is_premium_visible()      # leaves "premium" enabled!

def test_premium_off_by_default():
    assert not is_premium_visible()  # fails if test_premium_on ran first
```

The singleton carries `premium` into the next test. **Fix:** reset shared state in teardown, or — better — don't use a process-wide singleton in tested code; inject the dependency so each test gets a fresh instance (see [Test Doubles](../10-test-doubles-mocks-fakes/middle.md)).

For databases, the canonical fix is **transaction rollback** or **truncate-per-test**:

```python
# ✅ STABLE: each test runs in a transaction that is rolled back
@pytest.fixture
def db():
    conn = engine.connect()
    txn = conn.begin()
    yield conn
    txn.rollback()        # nothing leaks to the next test
    conn.close()
```

Stray rows from one test changing another's query results is one of the most common integration-test flakes. See [Integration Testing](../03-integration-testing/middle.md) and [Test Data Management](../11-test-data-management/middle.md) for the full isolation toolkit.

## Core Concept 5 -- Non-Determinism: Random, Time, Iteration Order, Locale

The test reads a source of variability the team forgot to control.

**Unseeded randomness** — seed it:

```python
# ❌ random.random() differs every run
# ✅
rng = random.Random(42)
data = [rng.random() for _ in range(100)]
```

**Real time / dates** — inject a clock instead of calling `now()`:

```go
// ❌ FLAKY: depends on wall-clock; breaks at boundaries / timezones
func IsExpired(t Token) bool { return time.Now().After(t.Expiry) }

// ✅ STABLE: inject the clock so tests control "now"
type Clock interface{ Now() time.Time }
func IsExpired(c Clock, t Token) bool { return c.Now().After(t.Expiry) }
// test uses a fixed clock: fixedClock{at: parse("2026-01-01T00:00:00Z")}
```

**Map / set iteration order** — don't assert on it:

```go
// ❌ FLAKY: Go randomizes map iteration order
for k := range m { result = append(result, k) }
assert.Equal(t, []string{"a","b","c"}, result)

// ✅ STABLE: sort before asserting, or compare as a set
sort.Strings(result)
assert.Equal(t, []string{"a","b","c"}, result)
```

**Locale / timezone** — pin them: set `TZ=UTC` and a fixed locale in the test environment so number/date formatting is stable across machines.

> The unifying fix: **push every non-deterministic input behind an injectable seam** — clock, RNG, locale — so the test controls it. This is prevention-by-design; you'll formalize it at the senior tier.

## Core Concept 6 -- External Dependencies, Concurrency & Resource Leaks

**External dependencies.** A unit test that calls a real API, DNS, or third-party service will flake whenever the network does — and that failure is not your bug. Make such tests **hermetic** by stubbing the dependency (see [Test Doubles](../10-test-doubles-mocks-fakes/middle.md)). Reserve real-network calls for a small, clearly-labeled E2E layer (see [End-to-End Testing](../04-end-to-end-testing/middle.md)).

**Concurrency / real races.** A test that fails ~1-in-N runs with no obvious pattern often points at a genuine data race — sometimes in the *test*, sometimes in the *product code*. Run with a race detector (`go test -race`, ThreadSanitizer, Java's `-Djava.util.concurrent` stress tools). The `concurrency-patterns` skill covers synchronizing shared state correctly. Crucially: don't assume it's the test's fault — investigate whether the product is actually racy.

**Resource leaks / exhaustion.** Tests that pass early in the run and fail late — "address already in use," "too many open files," OOM — are leaking ports, file descriptors, connections, or memory. **Fix:** close everything in teardown (`defer`/`try-with-resources`/fixtures), bind to ephemeral ports (`:0`), and bound connection pools.

## Core Concept 7 -- Detection & Measurement

You cannot manage what you don't measure. Stop guessing whether a test is flaky — *prove* it.

**Re-run to detect (not to hide).** Run the suite or a suspect test many times:

```bash
go test -run TestOrder -count=100        # Go: run 100 times
pytest tests/test_orders.py --count=100  # pytest-repeat
```

If it fails some of the time, it's flaky. This is using reruns *diagnostically* — the opposite of using them to mask failures (see senior tier on retries).

**Flakiness rate as a metric.** Track, per test, `failures / total runs` over a window. A test failing 2% of runs has a 2% flakiness rate. This number, trended over time, tells you whether reliability is improving.

**Flaky-test detection in CI.** Mature setups detect flakiness by re-running *failed* tests once and flagging any test that flips fail→pass as flaky — recording it, not hiding it. Tooling that does this includes:

- `pytest-rerunfailures` (Python), Maven Surefire / Gradle `retry` plugins (JVM) — re-run on failure *and surface that a retry happened*.
- `go test -count=N` and CI scripts for loop-detection.
- Platform tools: **Datadog Test Optimization**, **BuildPulse**, **Gradle Enterprise/Develocity flaky detection**, and Google's internal flaky-test infrastructure — they aggregate fail-then-pass events into dashboards and per-test flakiness scores.

The non-negotiable rule: **reruns are for *identifying* flakiness, never for silently making CI green.** If a test needed a rerun to pass, that fact must be recorded and visible.

## Real-World Examples

- **Shuffle exposes the rot.** A team turns on `go test -shuffle=on` and 14 previously-green tests start failing — all were order-dependent, propped up by alphabetical run order. The suite was lying for months.
- **The race detector earns its keep.** A test flaked 1-in-200. `-race` revealed an unsynchronized map write in *production* code. The flaky test had been catching a real concurrency bug nobody believed.
- **TZ=UTC saves the build.** A date-formatting test passed in CI (UTC) and failed for an engineer in UTC+9. Pinning `TZ=UTC` everywhere — local and CI — ended a recurring "works on my machine" argument.

## Mental Models

- **Walk the taxonomy.** Eight families. Name the bucket, apply the canonical fix.
- **Push variability behind a seam.** Clock, RNG, network, locale — inject them so tests control them.
- **Hermetic or honest.** A test should depend only on its own inputs; if it must touch the real world, label it and quarantine its flakiness risk.
- **Reruns diagnose, never disguise.** Re-running to *find* flakiness is science; re-running to *hide* it is fraud.

## Common Mistakes

- **Bumping the sleep instead of polling.** A slower flaky test is still flaky.
- **Cleaning up in the test body, not teardown.** If the test fails mid-way, cleanup is skipped and the next test inherits the mess. Use fixtures/`defer`/`finally`.
- **Asserting on unordered collections** (maps, sets, parallel results) as if they were ordered.
- **Blaming the test for a real race.** Run `-race` before deciding the product is fine.
- **Mocking the clock in one place, reading `now()` in another.** Inject it everywhere or the flake survives.
- **Calling reruns a "fix."** They're detection, not a cure.

## Test Yourself

1. Name all eight root-cause families and give a one-line fix for each.
2. A test passes in the full suite but fails when run alone. Which family, and how do you fix it?
3. Show how to make a date-dependent function testable without `sleep` or wall-clock reads.
4. What does `go test -shuffle=on` (or `pytest -p randomly`) help you find?
5. Distinguish using reruns to *detect* flakiness from using them to *hide* it. Why does the distinction matter?

## Cheat Sheet

```text
ROOT-CAUSE TAXONOMY (name the bucket, apply the fix)
  1 Async/timing   sleep → poll (Eventually / wait_until)
  2 Order/state    pass-in-suite-fail-alone → isolate state; shuffle to detect
  3 Isolation      leaked singleton/static/DB → reset in teardown; txn rollback
  4 Concurrency    1/N failures → run -race; fix the REAL race (test or product)
  5 Non-determinism random→seed; time→inject clock; map→sort; locale→pin TZ
  6 External deps   network/3rd-party → stub; make hermetic
  7 Resource leaks  fails late, ports/FDs/mem → close in teardown; ephemeral ports
  8 Environment     CI≠local → pin TZ/locale/OS/container

DETECTION
  Reproduce: go test -count=100 | pytest --count=100
  Shuffle:   go test -shuffle=on | pytest -p randomly
  Races:     go test -race | ThreadSanitizer
  Metric:    flakiness rate = failures / total runs (trend it)
  RULE: reruns DETECT flakiness, never HIDE it.
```

## Summary

Nearly every flaky test belongs to one of eight families: async/timing, order & shared state, isolation failures, concurrency/races, non-determinism, external dependencies, resource leaks, and environment differences. For each, learn the smell and the canonical fix — and notice the unifying theme: **push every uncontrolled input behind an injectable seam and isolate every test's state.** Then *measure*: reproduce with high-count reruns, shuffle to expose order dependence, run race detectors, and track a per-test flakiness rate. Use reruns to **detect** flakiness, never to **hide** it — because a flaky test is a broken test, and the trust it erodes is the only asset your suite has.

## Further Reading

- Martin Fowler, "Eradicating Non-Determinism in Tests"
- Google Testing Blog, "Where do our flaky tests come from?" and "Flaky Tests at Google"
- testify `require.Eventually`, `pytest-rerunfailures`, `go test -race`/`-shuffle` docs
- The `concurrency-patterns` and `systematic-debugging` skills.

## Related Topics

- [Integration Testing](../03-integration-testing/middle.md) — DB isolation and shared-state flakiness.
- [End-to-End Testing](../04-end-to-end-testing/middle.md) — explicit waits, the home of timing flakes.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/middle.md) — injecting clocks, RNG, and network stubs.
- [Test Data Management](../11-test-data-management/middle.md) — per-test isolated data.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/README.md) — reliability as a tracked metric.
