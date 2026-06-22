# Integration Testing — Senior Level

> **Roadmap:** [Testing](../README.md) → Integration Testing
>
> *An integration suite that's slow and flaky doesn't get run — and a test that doesn't get run protects nothing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Where to Draw the Unit / Integration Line](#core-concept-1--where-to-draw-the-unit--integration-line)
5. [Core Concept 2 — Container Reuse & Suite-Level Lifecycle](#core-concept-2--container-reuse--suite-level-lifecycle)
6. [Core Concept 3 — Parallelism Without Cross-Talk](#core-concept-3--parallelism-without-cross-talk)
7. [Core Concept 4 — Layered Fixtures & Fast Reset](#core-concept-4--layered-fixtures--fast-reset)
8. [Core Concept 5 — Killing Flakiness at the Source](#core-concept-5--killing-flakiness-at-the-source)
9. [Core Concept 6 — Determinism: Clock, Ordering, Async](#core-concept-6--determinism-clock-ordering-async)
10. [Core Concept 7 — Broad Integration & the Message-Broker Case](#core-concept-7--broad-integration--the-message-broker-case)
11. [Core Concept 8 — Diagnosing a Slow Suite](#core-concept-8--diagnosing-a-slow-suite)
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

> Focus: **keeping an integration suite fast and trustworthy at scale — container reuse, safe parallelism, layered fixtures, and the disciplined elimination of flakiness and non-determinism.**

Anyone can write one Testcontainers test. The senior problem is the *suite*: five hundred integration tests that must run in minutes, in parallel, deterministically, on every PR — without one flaky test poisoning the team's trust in the whole thing. This file is about the engineering that makes that possible: lifecycle, isolation, parallelism, fixtures, and the systematic war on flakiness.

---

## Prerequisites

- Fluent with Testcontainers, isolation strategies, and WireMock ([middle](middle.md)).
- You've felt the pain of a 25-minute integration suite or a test that fails 1-in-20.
- You understand connection pooling, transaction isolation levels, and async messaging.
- You know your test runner's parallelism model (JUnit, `go test -parallel`, pytest-xdist).

---

## Glossary

| Term | Meaning |
|---|---|
| **Suite-level container** | One container shared by an entire test class/module. |
| **Container reuse** | Keeping a container alive across test *runs* (`TESTCONTAINERS_REUSE_ENABLE`). |
| **Fixture layering** | Splitting setup into slow-once (schema) and fast-per-test (data). |
| **Cross-talk** | One parallel test seeing another's data. |
| **Flake** | A test that passes and fails on the same code. |
| **Quarantine** | Isolating a flaky test out of the gating suite until fixed. |
| **Hermetic** | A test whose result depends only on its own inputs, not the environment. |
| **Database-per-worker** | Each parallel worker gets its own logical DB/schema. |

---

## Core Concept 1 — Where to Draw the Unit / Integration Line

The most consequential senior decision isn't *how* to write integration tests — it's *which* behaviours deserve one. Misdraw the line and you either under-test the seams or build a bloated, slow suite that re-tests business logic through the database.

Heuristics that hold up:

- **Test logic as a unit; test the boundary as an integration.** Pricing rules, validation, state machines → unit tests, no DB. The repository's SQL, the controller's serialization, the consumer's offset handling → integration.
- **Each integration test should justify its I/O.** If you can delete the database from a test and it still proves the same thing, it should have been a unit test.
- **Don't re-test the same logic at two layers.** If a business rule has thorough unit coverage, the integration test for the endpoint that uses it should assert *wiring* (it's reachable, serialized, persisted), not re-enumerate every rule branch.
- **Push fidelity to the lowest layer that catches the bug.** A serialization bug belongs in a focused HTTP-layer test, not a full end-to-end click-through.

The pyramid shape isn't dogma, but its logic is: integration tests are 10–100× costlier than unit tests, so spend them where only real I/O can catch the bug. See [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/).

---

## Core Concept 2 — Container Reuse & Suite-Level Lifecycle

Starting a Postgres container costs ~1–3 seconds. Do that per-test across 500 tests and you've spent 15+ minutes on startup alone. The fix is lifecycle discipline.

**Suite-level (singleton) container** — start once, share across all tests, reset *data* per test:

```java
abstract class IntegrationTest {
    // static + no @Container management → started once for the whole JVM
    static final PostgreSQLContainer<?> PG =
        new PostgreSQLContainer<>("postgres:16.4-alpine");
    static {
        PG.start();   // singleton; JVM shutdown terminates it
    }
}
```

Every test class extends `IntegrationTest`; the container is shared. You pay startup once and isolate via truncate/rollback per test.

**Cross-run reuse** — keep the container alive *between* `mvn test` invocations during local development:

```properties
# ~/.testcontainers.properties
testcontainers.reuse.enable=true
```

```java
new PostgreSQLContainer<>("postgres:16.4-alpine")
    .withReuse(true)        // matched by labels; reattaches instead of recreating
    .withLabel("app", "myservice");
```

Reuse makes the local edit-test loop near-instant. **Disable reuse in CI** — CI wants a clean, reproducible container every time; reuse is a developer-ergonomics feature, not a CI one.

**Go** — share via `TestMain`:

```go
var sharedDB *sql.DB

func TestMain(m *testing.M) {
    ctx := context.Background()
    pg, _ := postgres.Run(ctx, "postgres:16.4-alpine", /* ... */)
    sharedDB = mustConnect(pg)
    code := m.Run()
    _ = pg.Terminate(ctx)
    os.Exit(code)
}
```

---

## Core Concept 3 — Parallelism Without Cross-Talk

Parallelism is how you turn a 20-minute suite into a 4-minute one — but shared real I/O makes it dangerous. The two robust patterns:

**1. Database-per-worker.** Each parallel worker gets its own logical database or schema on the *same* container. No truncation contention, no cross-talk.

```python
# pytest-xdist: derive a unique schema from the worker id
@pytest.fixture
def db(pg_container, worker_id):                 # worker_id = "gw0", "gw1", ...
    schema = f"test_{worker_id}"
    conn = connect(pg_container.get_connection_url())
    conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
    conn.execute(f"SET search_path TO {schema}")
    migrate(conn)
    yield conn
    conn.execute(f"DROP SCHEMA {schema} CASCADE")
```

**2. Container-per-worker.** Each worker gets its own container. Stronger isolation, more memory. Use when workers need different DB versions or full isolation including system catalogs.

**Anti-pattern to avoid:** N workers all truncating the *same* shared tables. They serialize on locks (slow) and randomly clobber each other (flaky). If you parallelize, you must partition state.

A subtle trap: **connection-pool exhaustion under parallelism.** Each worker × each app's pool size can exceed the DB's `max_connections`. Size pools down in tests, or raise the container's `max_connections`. (See the `connection-pooling` skill.)

---

## Core Concept 4 — Layered Fixtures & Fast Reset

Split setup by *cost* and *change frequency*:

```
Layer 0  container        once per JVM/process          (~seconds)
Layer 1  schema/migrations once per container            (~hundreds of ms)
Layer 2  reference data    once per container (read-only) (countries, roles…)
Layer 3  test data         per test                       (~ms; truncate + seed)
```

The win: the expensive layers (0–2) run once; only the cheap, test-specific layer (3) runs per test. Reference data that no test mutates can be seeded once and never reset — but you must *enforce* read-only-ness (e.g. assert it's untouched, or put it in a schema the tests can't write).

**Fast reset for the per-test layer.** Truncate is fine; for very large suites, a snapshot-and-restore is faster:

- **Template database** (Postgres `CREATE DATABASE ... TEMPLATE`) — clone a pre-seeded DB per test in milliseconds.
- **Savepoints** — nest each test in a savepoint, roll back to it; faster than full truncate when the per-test footprint is small.

Build fixtures with **factories/builders**, not giant SQL dumps, so each test declares exactly the state it needs (see [Test Data Management](../11-test-data-management/) and the `test-data-management` skill). The senior smell is a 2000-line `seed.sql` every test depends on implicitly — change one row and a dozen tests break for unrelated reasons.

---

## Core Concept 5 — Killing Flakiness at the Source

A flaky integration test is worse than no test: it trains the team to ignore red. Treat flakiness as a defect with a root cause, never as something to `@Retry` away. The recurring causes, with fixes:

| Cause | Symptom | Fix |
|---|---|---|
| **Order dependence** | Passes alone, fails in suite | Reset state per test; randomize order to flush out coupling |
| **Shared mutable state** | Random failures under parallelism | Database-per-worker; namespacing |
| **Real time / sleeps** | Fails on slow CI | Inject a clock; poll-with-timeout, never `sleep(n)` |
| **Async / eventual** | Assertion runs before the effect lands | Awaitility / poll until condition or timeout |
| **Network to real externals** | Fails when partner is down | Stub with WireMock; never hit live third parties |
| **Resource leaks** | Slow degradation, port/connection exhaustion | Close pools/containers in teardown |
| **Nondeterministic queries** | `LIMIT` without `ORDER BY` returns different rows | Always order; assert on sets, not row order |

**Policy, not heroics.** Quarantine a flaky test out of the gating suite the moment it's identified, file a ticket, and fix the root cause — but never let "add a retry" be the fix for a test whose flakiness reflects a *real* race in the product. See [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/).

---

## Core Concept 6 — Determinism: Clock, Ordering, Async

Three non-determinism hazards dominate integration tests:

**Clock.** Never let production code read the wall clock directly. Inject a clock so tests control time:

```java
// production takes a Clock; tests pass a fixed one
var clock = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC);
var service = new SubscriptionService(repo, clock);
```

Tests that depend on `now()` are flaky around midnight, month boundaries, and DST. A fixed clock makes them hermetic.

**Ordering.** `SELECT ... LIMIT 10` without `ORDER BY` returns *an arbitrary 10* — Postgres may change the order across versions, vacuum, or parallelism. Always add a deterministic `ORDER BY`, and assert on sets where order isn't part of the contract.

**Async / eventual consistency.** When the effect you assert on happens asynchronously (a Kafka consumer wrote a row, a job ran), `Thread.sleep` is a bet against CI's mood. **Poll with a timeout** instead:

```java
await().atMost(5, SECONDS)
       .pollInterval(50, MILLISECONDS)
       .untilAsserted(() ->
           assertThat(repo.findByOrderId("o-1")).isPresent());
```

This passes as soon as the condition holds and fails fast with a clear message if it never does — fast *and* reliable, which `sleep` can never be both of.

---

## Core Concept 7 — Broad Integration & the Message-Broker Case

Broad integration (several components, or async messaging) is the hardest to keep deterministic. The Kafka/Redis case is instructive:

```java
@Testcontainers
class OrderEventsIT {
    @Container static KafkaContainer kafka =
        new KafkaContainer(DockerImageName.parse("confluentinc/cp-kafka:7.6.0"));

    @Test
    void publishesOrderPlacedEvent() {
        producer.placeOrder(new Order("o-1"));

        // do NOT sleep — poll the topic until the event arrives or time out
        await().atMost(10, SECONDS).untilAsserted(() -> {
            var records = consumer.poll(Duration.ofMillis(200));
            assertThat(records).anyMatch(r -> r.value().contains("o-1"));
        });
    }
}
```

Principles for broad integration:

- **Bound the blast radius.** Test one async hop with real infra; mock the hops beyond it. Don't spin up the whole estate for one assertion.
- **Make boundaries deterministic.** Wait on *observable conditions* (a row, an offset, a topic record), never on time.
- **Prefer contract tests for service-to-service shape.** Broad integration is expensive; verify message *formats* with contracts and reserve broad integration for genuinely emergent wiring behaviour. See [Contract Testing](../05-contract-testing/).

---

## Core Concept 8 — Diagnosing a Slow Suite

When the suite is too slow, profile before optimizing. Common findings and remedies:

- **Per-test container startup** → suite-level singleton + reuse locally (Concept 2).
- **Full schema rebuild per test** → migrate once; reset data only (Concept 4).
- **Serial execution** → partition state and parallelize (Concept 3).
- **`sleep`-based waits** → replace with poll-until (Concept 6); often recovers minutes.
- **Over-broad tests** → demote logic-only checks to unit tests (Concept 1).
- **Giant shared seed** → factory-built minimal per-test data (Concept 4).

Track the slowest 20 tests; they're usually where 80% of the time hides. A suite that drifts past the team's patience threshold simply stops being run on every change — and an unrun test is dead weight.

---

## Real-World Examples

- **The 28-minute suite that nobody ran on PRs.** Profiling showed per-test container startup and `Thread.sleep(2000)` in 60 tests. Suite-level container + Awaitility cut it to 5 minutes; PR-gating was re-enabled.
- **The 1-in-15 flake.** A `LIMIT 5` "latest orders" query had no `ORDER BY`. Under parallel vacuum the row order shifted. Adding `ORDER BY created_at DESC, id DESC` eliminated the flake permanently.
- **Connection storm.** Enabling pytest-xdist with 8 workers each opening a 20-connection pool blew past Postgres `max_connections=100`. Database-per-worker plus smaller pools fixed both isolation and the storm.
- **The midnight failure.** A subscription-expiry test passed all day, failed in the nightly run because it computed "today" from the wall clock during a month rollover. A fixed `Clock` made it hermetic.

---

## Mental Models

- **An unrun test protects nothing.** Speed and reliability aren't polish — they're what keeps the suite alive.
- **One flake taxes the whole suite.** Trust is binary; a single ignored red trains the team to ignore all red.
- **Pay setup costs by frequency.** Slow-once for schema, fast-per-test for data.
- **Wait on conditions, never on time.** `sleep` is a bribe to the scheduler; polling is a contract with reality.
- **Spend I/O where only I/O can catch the bug.** Everything else is a unit test.

---

## Common Mistakes

- **Retrying flakes instead of fixing them.** Hides real product races; rots trust.
- **Per-test containers as the default.** Crippling startup cost; use suite-level + reuse.
- **Parallelizing onto shared tables.** Lock contention + cross-talk. Partition state first.
- **`Thread.sleep` for async assertions.** Slow when it works, flaky when it doesn't.
- **`LIMIT` without `ORDER BY`.** Nondeterministic results that flake.
- **Re-testing business logic through the database.** Bloats the suite; belongs in unit tests.
- **A monolithic seed every test leans on.** Hidden coupling; one edit breaks a dozen tests.
- **Enabling container reuse in CI.** CI must be reproducible; reuse is a local-dev feature.

---

## Test Yourself

1. Give two heuristics for deciding whether a behaviour gets a unit or an integration test.
2. How do you start one Postgres container for an entire test class but still isolate per test?
3. What's the difference between suite-level sharing and cross-run reuse, and where does each belong?
4. Describe database-per-worker and why it beats truncating shared tables under parallelism.
5. Why is `Thread.sleep` for async assertions both slow and flaky, and what replaces it?
6. A "latest 5 orders" test flakes ~1-in-15. What's the most likely cause and the fix?
7. How would you cut a 25-minute integration suite to under 5 without deleting coverage?

---

## Cheat Sheet

```
LINE:        logic → unit; boundary (SQL/HTTP/broker) → integration
LIFECYCLE:   suite-level singleton container; reuse=true LOCAL only, never CI
PARALLELISM: database-per-worker or container-per-worker; never shared truncate
FIXTURES:    layer by cost — container/schema/ref-data once, test data per test
             template DB or savepoints for fast reset; factories not seed.sql
FLAKE WAR:   reset state · inject clock · poll-don't-sleep · stub externals
             order all queries · close resources · quarantine + root-cause
DETERMINISM: fixed Clock · explicit ORDER BY · Awaitility poll-until-timeout
SLOW SUITE:  profile slowest 20 → kill per-test startup, sleeps, broad tests
```

---

## Summary

At senior level the unit of work is the *suite*, not the test. Draw the unit/integration line so that integration tests earn their I/O — boundaries, not logic. Keep them fast with suite-level containers, local reuse, and layered fixtures that pay slow costs once. Keep them reliable with database-per-worker parallelism, injected clocks, explicit ordering, and poll-until-timeout instead of sleeps. Treat every flake as a defect with a root cause, quarantine it, and fix it — because one ignored red erodes trust in the entire suite, and a suite the team stops trusting is a suite the team stops running.

---

## Further Reading

- The `integration-testing` skill — scaling and infrastructure-backed patterns.
- The `test-data-management` skill — factories, layered fixtures, fast reset.
- The `transaction-isolation` and `connection-pooling` skills — what you'll exercise and exhaust under parallelism.
- Testcontainers reuse and singleton-container docs; Awaitility documentation.

---

## Related Topics

- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — why integration tests are scarce by design.
- [Unit Testing](../02-unit-testing/) — where logic belongs.
- [Contract Testing](../05-contract-testing/) — cheaper than broad integration for service shape.
- [Test Data Management](../11-test-data-management/) — fixtures and reset at scale.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — the discipline behind Concept 5.
- [End-to-End Testing](../04-end-to-end-testing/) — the broadest, costliest layer.
