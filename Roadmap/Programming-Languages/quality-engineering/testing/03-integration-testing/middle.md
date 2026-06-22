# Integration Testing — Middle Level

> **Roadmap:** [Testing](../README.md) → Integration Testing
>
> *Fidelity is the whole point — a fast test against the wrong engine is a confident lie.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Fidelity / Speed Trade-off](#core-concept-1--the-fidelity--speed-trade-off)
5. [Core Concept 2 — The "H2 Passes, Postgres Fails" Trap](#core-concept-2--the-h2-passes-postgres-fails-trap)
6. [Core Concept 3 — Database Isolation Strategies](#core-concept-3--database-isolation-strategies)
7. [Core Concept 4 — Transaction-Rollback-Per-Test](#core-concept-4--transaction-rollback-per-test)
8. [Core Concept 5 — HTTP / API Integration & WireMock](#core-concept-5--http--api-integration--wiremock)
9. [Core Concept 6 — Testing Migrations Against a Real Engine](#core-concept-6--testing-migrations-against-a-real-engine)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **choosing real dependencies over in-memory fakes, isolating database state cheaply, stubbing external HTTP with WireMock, and testing migrations against the engine you actually ship.**

At the junior level you wrote your first Testcontainers test and learned to clean up after it. Now you make the deliberate engineering choices: *how real* does each dependency need to be, *how* do you keep a hundred integration tests from stepping on each other, and *where* does the line sit between an integration test and a contract test. These are the decisions that determine whether your integration suite is trustworthy and fast — or slow, flaky, and ignored.

---

## Prerequisites

- Comfortable writing a narrow integration test with Testcontainers ([junior](junior.md)).
- You understand database transactions, commit, and rollback.
- You've consumed an external HTTP API from code.
- You know what a schema migration is (Flyway, Liquibase, golang-migrate, Alembic).

---

## Glossary

| Term | Meaning |
|---|---|
| **Fidelity** | How closely the test environment matches production behaviour. |
| **Narrow integration** | Your code + one real dependency. |
| **Broad integration** | Several of your services wired together. |
| **In-memory substitute** | A DB like H2/SQLite that runs in RAM but is a *different engine*. |
| **Truncate strategy** | Empty all tables between tests. |
| **Rollback strategy** | Wrap each test in a transaction that never commits. |
| **WireMock / MockServer** | A fake HTTP server that returns canned responses for an external dependency. |
| **Contract test** | Verifies two services agree on a message format — *not* the same as integration. |
| **Reuse** | Keeping one container alive across many tests instead of one per test. |

---

## Core Concept 1 — The Fidelity / Speed Trade-off

Every test-double decision is a point on a line between **fidelity** (does it behave like production?) and **speed** (how fast does the test run?).

```
  low fidelity                                            high fidelity
  fast                                                            slow
  |---------------------------------------------------------------|
  mock        in-memory (H2)     Testcontainers     shared staging DB
  (unit)      (fast, lies)       (real engine)      (real but shared/flaky)
```

The naive instinct is "pick the fast one." But a fast test that doesn't reflect production isn't cheaper — it's **negative value**, because it gives confidence that's wrong. The right question is: *what is the cheapest option that still catches the class of bug I care about?*

- Testing pure business logic with no I/O → **mock** (it's a unit test).
- Testing your repository's SQL, transactions, constraints → **Testcontainers** (real engine, nothing less).
- Testing an external partner's API shape → **contract test**, not a live call (see [Contract Testing](../05-contract-testing/)).

For database code there's essentially no middle ground worth taking: it's the real engine or it's not really tested.

---

## Core Concept 2 — The "H2 Passes, Postgres Fails" Trap

This is the canonical reason in-memory substitutes are dangerous. H2 (and SQLite) are *different database engines*. They speak a different enough SQL dialect that real-world queries pass in one and fail in the other. A concrete case:

```sql
-- Postgres: upsert with ON CONFLICT
INSERT INTO accounts (id, balance) VALUES (?, ?)
ON CONFLICT (id) DO UPDATE SET balance = accounts.balance + EXCLUDED.balance;
```

Run your repository test against **H2** in PostgreSQL-compatibility mode and it may quietly accept (or silently misinterpret) `EXCLUDED` and the `ON CONFLICT` target. The test goes green. Ship it. In **production Postgres** the same statement behaves differently around the conflict target or returns a different affected-row count, and your balance update is wrong.

Other classic divergences that bite:

- **Type handling** — Postgres `jsonb`, arrays, `timestamptz`, `numeric` precision. H2 fakes some, mishandles others.
- **Constraint timing** — deferred constraints, `ON DELETE CASCADE` semantics.
- **Concurrency / locking** — `SELECT ... FOR UPDATE`, isolation levels (see the `transaction-isolation` skill). In-memory engines often ignore them.
- **Case sensitivity and identifier quoting** — different defaults.
- **Window functions, CTEs, `RETURNING`** — partial or different support.

The lesson is blunt: **the only database that behaves like your production database is your production database engine.** Testcontainers gives you exactly that, disposably.

```java
// Same engine and version you run in production — pin it.
@Container
static PostgreSQLContainer<?> pg =
    new PostgreSQLContainer<>("postgres:16.4-alpine"); // not :latest
```

Pin the version. `:latest` reintroduces the same drift problem from a different direction.

---

## Core Concept 3 — Database Isolation Strategies

A real database has state, and state leaks between tests. Four strategies, with their trade-offs:

| Strategy | Speed | Isolation | When to use |
|---|---|---|---|
| **Recreate schema** per test | Slowest | Total | Schema-level tests only |
| **Truncate tables** per test | Medium | High | Default for most suites |
| **Transaction rollback** per test | Fastest | High (caveats) | Tests that don't manage their own tx |
| **Unique data per test** (namespacing) | Fast | Logical | Read-heavy, parallel suites |

**Truncate** is the reliable default:

```sql
TRUNCATE users, orders, payments RESTART IDENTITY CASCADE;
```

`RESTART IDENTITY` resets auto-increment so IDs are predictable; `CASCADE` follows foreign keys. Run it in teardown so the next test starts clean regardless of what failed.

**Namespacing** (give each test its own tenant/prefix) lets tests run in parallel without truncation contention — but only if your code respects the namespace and you never assert on global counts.

---

## Core Concept 4 — Transaction-Rollback-Per-Test

The fastest isolation pattern: open a transaction in setup, run the test, **roll back** instead of committing. Nothing ever hits disk permanently, so the next test sees a pristine DB.

**Spring (Java) — `@Transactional` on the test:**

```java
@SpringBootTest
@Testcontainers
@Transactional        // each test runs in a tx that is rolled back at the end
class OrderServiceIT {

    @Container
    static PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired OrderService orders;

    @Test
    void placingOrderReservesStock() {
        orders.place(new Order("sku-1", 2));
        assertThat(orders.stockFor("sku-1")).isEqualTo(8);
    } // tx rolled back here — DB is clean for the next test
}
```

**The caveat that trips people up:** rollback-per-test **silently breaks** when the code under test manages its own transactions or commits explicitly (e.g. a service that opens a `REQUIRES_NEW` transaction, or any code that calls `commit()` itself). The test's outer rollback can't undo a child commit, and you can end up *not testing the real commit path at all*. If your code's correctness depends on commit/visibility behaviour, **use truncate, not rollback** — you want the commit to actually happen.

**Manual rollback (Go):**

```go
func withRollback(t *testing.T, db *sql.DB, fn func(tx *sql.Tx)) {
    tx, err := db.Begin()
    require.NoError(t, err)
    defer tx.Rollback() // always undo
    fn(tx)
}
```

Rule of thumb: **rollback for speed on simple repository tests; truncate when commit semantics matter.**

---

## Core Concept 5 — HTTP / API Integration & WireMock

Two distinct HTTP situations show up in integration tests:

**(a) Testing *your* HTTP layer.** Spin up your real application server (real controllers, real serialization) and hit it over actual HTTP. This catches routing bugs, JSON (de)serialization mismatches, status codes, and middleware behaviour — none of which a unit test on the handler sees.

```java
@SpringBootTest(webEnvironment = RANDOM_PORT)
@Testcontainers
class UserApiIT {
    @Autowired TestRestTemplate http;

    @Test
    void createReturns201WithLocation() {
        var res = http.postForEntity("/users",
            Map.of("email", "ada@example.com"), Void.class);
        assertThat(res.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(res.getHeaders().getLocation()).isNotNull();
    }
}
```

**(b) Faking an *external* HTTP dependency.** Your code calls a third-party API (payments, geocoding). You don't want to hit the real one in tests — it's slow, rate-limited, and non-deterministic. Use **WireMock** (or MockServer) to stand up a fake HTTP server returning canned responses:

```java
@RegisterExtension
static WireMockExtension wm = WireMockExtension.newInstance()
    .options(wireMockConfig().dynamicPort()).build();

@Test
void chargesViaPaymentGateway() {
    wm.stubFor(post("/charge")
        .willReturn(okJson("""{"status":"approved","id":"ch_1"}""")));

    var gateway = new PaymentGateway(wm.baseUrl());
    var result = gateway.charge(100, "usd");

    assertThat(result.approved()).isTrue();
    wm.verify(postRequestedFor(urlEqualTo("/charge")));
}
```

WireMock also lets you simulate failures (500s, timeouts, malformed bodies) so you can test your retry and error handling against realistic HTTP behaviour.

> **The integration / contract boundary.** WireMock proves *your client works against the response you stubbed.* It does **not** prove the real provider actually sends that shape. That guarantee is what [Contract Testing](../05-contract-testing/) provides (Pact, Spring Cloud Contract). Use WireMock for "does my code handle this response?"; use contract tests for "do the two sides still agree?".

---

## Core Concept 6 — Testing Migrations Against a Real Engine

Your migrations (Flyway, Liquibase, golang-migrate, Alembic) are code that runs against the real DB — so test them against the real DB. The cleanest pattern: let the test container start empty and **run your actual migration tool** as part of setup.

```java
@BeforeEach
void migrate() {
    Flyway.configure()
        .dataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword())
        .load()
        .migrate();   // your real V1__, V2__ scripts, against real Postgres
}
```

This catches: a migration that fails on the real engine, a migration that's incompatible with existing data, and the drift between "schema in code" and "schema your tests assume." See the `database-migration-patterns` skill for expand/contract and zero-downtime patterns; integration tests are how you verify those migrations actually apply.

---

## Real-World Examples

- **The `ON CONFLICT` that worked in H2.** A team ran repository tests against H2 for speed. An upsert behaved differently in production Postgres and double-counted balances. Switching to Testcontainers caught the next such bug at PR time.
- **The retry that never fired.** A payment client had a unit test mocking a `500`. WireMock revealed the client only retried on connection errors, not HTTP 5xx — the mock had hidden the bug because it threw the wrong exception type.
- **The migration that locked the table.** An `ALTER TABLE ... ADD COLUMN ... DEFAULT` took a full table lock on the real engine. A migration integration test against a seeded container surfaced the long lock before it hit production.

---

## Mental Models

- **Cheapest faithful option wins.** Not the fastest — the cheapest that still catches the bug class you care about.
- **Rollback is a loan against commit semantics.** Fast, but you've borrowed against ever testing the real commit. Pay it back with truncate when commits matter.
- **WireMock tests your side of the wire; contracts test both sides.** Don't confuse them.
- **A migration is production code.** Test it where it runs — the real engine.

---

## Common Mistakes

- **Using H2/SQLite to test Postgres SQL.** The single most common false-confidence trap.
- **Rollback-per-test on code that commits itself.** You skip the very path you meant to verify.
- **Stubbing external APIs and calling it contract testing.** WireMock ≠ Pact.
- **`:latest` container tags.** Non-reproducible; reintroduces engine drift.
- **Asserting on global state in parallel tests.** Counts and IDs collide. Namespace or serialize.
- **One container per test by default.** Wildly slow; reuse where you can (see [senior](senior.md)).
- **Not testing the failure paths.** Stub the timeout, the 500, the malformed body — that's where bugs hide.

---

## Test Yourself

1. Give a concrete SQL statement that passes in H2 but behaves wrong in Postgres.
2. When does transaction-rollback-per-test silently fail to test what you think?
3. What does WireMock prove, and what does it *not* prove?
4. Why pin the container image to `postgres:16.4-alpine` rather than `:latest`?
5. How would you run 50 integration tests in parallel against one database without them colliding?
6. Why test migrations against a real engine instead of trusting the migration file?

---

## Cheat Sheet

```
FIDELITY > SPEED for DB code: real engine via Testcontainers, never H2/SQLite
PIN the image version (postgres:16.4-alpine), never :latest
ISOLATION:
  truncate ........ default; TRUNCATE ... RESTART IDENTITY CASCADE
  rollback ........ fastest; BREAKS if code commits itself → use truncate
  namespacing ..... per-test tenant/prefix → enables parallelism
HTTP:
  your server  → spin real app, hit over HTTP (serialization, routing)
  external API → WireMock/MockServer canned + failure responses
  WireMock proves YOUR client; CONTRACT tests prove both sides agree
MIGRATIONS: run real Flyway/Liquibase/Alembic against the real container
```

---

## Summary

The middle-level skill is making fidelity-vs-speed decisions deliberately. For database code that means the real engine via Testcontainers — never H2/SQLite, which diverge from production SQL and hand you false green. Isolate state with truncate by default, rollback when you need speed and your code doesn't commit itself, and namespacing when you need parallelism. Use WireMock to stub external HTTP (including failure modes), but know it only tests your side of the wire — both-sides agreement is contract testing. And test your migrations against the real engine, because a migration is production code.

---

## Further Reading

- The `integration-testing` skill — patterns for multi-layer and infrastructure-backed tests.
- The `test-data-management` skill — fixtures, factories, and reset strategies.
- The `database-migration-patterns` skill — expand/contract and zero-downtime migrations.
- The `transaction-isolation` skill — isolation levels and locking you'll exercise here.
- WireMock and Testcontainers documentation.

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — where mocking is the right call.
- [Contract Testing](../05-contract-testing/) — proving both sides of an API agree.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/) — the full taxonomy of fakes.
- [Test Data Management](../11-test-data-management/) — seeding and resetting.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — taming non-determinism.
- [End-to-End Testing](../04-end-to-end-testing/) — the broad-integration extreme.
