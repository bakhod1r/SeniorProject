# Integration Testing — Junior Level

> **Roadmap:** [Testing](../README.md) → Integration Testing
>
> *Where two pieces of code meet, a bug is waiting — integration tests are how you find it before production does.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What Integration Testing Is](#core-concept-1--what-integration-testing-is)
5. [Core Concept 2 — What It Catches That Unit Tests Can't](#core-concept-2--what-it-catches-that-unit-tests-cant)
6. [Core Concept 3 — Real Dependency vs Mock vs In-Memory](#core-concept-3--real-dependency-vs-mock-vs-in-memory)
7. [Core Concept 4 — Your First Testcontainers Test](#core-concept-4--your-first-testcontainers-test)
8. [Core Concept 5 — Cleaning Up Between Tests](#core-concept-5--cleaning-up-between-tests)
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

> Focus: **what integration testing is, why "all unit tests green" can still mean "system broken," and how to write your very first test against a real database.**

A unit test puts one class under glass and replaces everything around it with fakes. That makes it fast and precise — but it also means the unit test never sees the *seams* where your code talks to the outside world: the SQL you send to Postgres, the JSON you serialize over HTTP, the config you load at startup. Those seams are where a huge share of real bugs live.

Integration testing exercises **two or more components together, including the real I/O** — a real database, a real message broker, a real HTTP server. It answers a question the unit test cannot: *when my code actually talks to the thing it depends on, does it work?*

---

## Prerequisites

- You can write a basic unit test (assertions, setup, teardown). See [Unit Testing](../02-unit-testing/).
- You understand what a function, a class, and a method call are.
- You have seen SQL (`SELECT`, `INSERT`) even if you're not fluent.
- Docker is installed and running on your machine (we'll use it). `docker --version` should print something.

---

## Glossary

| Term | Meaning |
|---|---|
| **Unit under test** | The class/function whose behaviour the test checks. |
| **Collaborator / dependency** | Something the unit calls: a database, an API, another service. |
| **Test double** | A stand-in for a real dependency — a mock, stub, or fake. |
| **Integration test** | A test that runs your code against one or more *real* collaborators. |
| **Wiring** | The plumbing that connects components: config, connection strings, DI. |
| **Testcontainers** | A library that starts a real dependency (Postgres, Kafka…) in Docker for the duration of a test. |
| **Ephemeral** | Created fresh, used, and thrown away — like a per-test container. |
| **Fixture** | The setup state a test needs before it runs (seeded rows, a started server). |

---

## Core Concept 1 — What Integration Testing Is

Picture three rings around your code:

1. **Unit** — one class, everything else faked. Milliseconds. No I/O.
2. **Integration** — your code + a *real* dependency (a real DB, a real broker). Hundreds of milliseconds.
3. **End-to-end** — the whole running system, clicked like a user would. Seconds to minutes. See [End-to-End Testing](../04-end-to-end-testing/).

Integration sits in the middle. The defining trait is **real I/O across a boundary**: instead of a mock that *pretends* to be Postgres, you talk to an actual Postgres.

There's a spectrum even within "integration":

- **Narrow integration** — your code + **one** real dependency. Example: your `UserRepository` against a real Postgres. This is the sweet spot and most of what you'll write.
- **Broad integration** — several of your services wired together. Heavier, slower, fewer of them.

As a junior, focus almost entirely on **narrow** integration tests. They give you most of the safety for a fraction of the cost.

---

## Core Concept 2 — What It Catches That Unit Tests Can't

This is the heart of the topic. A unit test with a mocked database can be 100% green while the real thing is 100% broken. Here is what the mock *can't* see:

- **Wrong SQL.** A typo in a column name, a `JOIN` that returns duplicates, a `WHERE` that's off. The mock returns whatever you told it to; the real DB rejects your query.
- **Serialization mismatches.** Your code writes a timestamp one way; the DB stores and returns it another. JSON field named `userId` in code but `user_id` in the payload.
- **Transaction behaviour.** Did your code actually commit? Does a rollback undo what you think? A mock has no transactions.
- **Config and wiring.** Wrong connection string, missing migration, a default that only bites in the real engine.
- **The mocked-vs-real gap.** Your mock said `findById` returns `null` for a missing row — but the real driver throws, or returns an empty `Optional`. Your code handles the mock's version and crashes on the real one.

> **The "unit tests pass, system broken" problem.** Every team has shipped a release where CI was green and production fell over on the first request. Almost always it's a seam a unit test couldn't reach. Integration tests exist to close that gap.

---

## Core Concept 3 — Real Dependency vs Mock vs In-Memory

When your code needs a database in a test, you have three options. Understanding the trade-off here is the single most important idea at this level.

| Option | What it is | Fidelity | Speed | Verdict |
|---|---|---|---|---|
| **Mock the DB** | Replace the repo/driver with a fake | None — tests nothing real | Fastest | Fine for *unit* tests; proves nothing about real SQL |
| **In-memory DB (H2/SQLite)** | A different DB engine that runs in RAM | **Low — it lies** | Fast | A classic trap (see below) |
| **Real DB via Testcontainers** | The actual prod engine, in Docker | High | Slower (seconds) | The modern default |

**Why in-memory is a trap.** H2 and SQLite are *different database engines* from your production Postgres. Different SQL dialect, different type handling, different behaviour around constraints and concurrency. A test that passes against H2 can fail against Postgres — so the test gave you false confidence. (The senior file has a concrete `H2 passes, Postgres fails` example.) The rule of thumb: **if it isn't the engine you run in production, it can lie to you.**

The modern answer is **Testcontainers**: start the *real* Postgres in a throwaway Docker container, run your test against it, throw it away. Same engine as production, no shared state between runs.

---

## Core Concept 4 — Your First Testcontainers Test

Let's write a narrow integration test: a `UserRepository` against a real Postgres. Here it is in three languages so you can find yours.

**Java (JUnit 5 + Testcontainers):**

```java
@Testcontainers
class UserRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres =
        new PostgreSQLContainer<>("postgres:16-alpine");

    DataSource dataSource;

    @BeforeEach
    void setUp() {
        // Point your code at the container's real connection details.
        dataSource = buildDataSource(
            postgres.getJdbcUrl(),
            postgres.getUsername(),
            postgres.getPassword());
        runMigrations(dataSource); // create the real schema
    }

    @Test
    void savesAndLoadsUser() {
        var repo = new UserRepository(dataSource);
        repo.save(new User("ada@example.com", "Ada"));

        var found = repo.findByEmail("ada@example.com");

        assertThat(found).isPresent();
        assertThat(found.get().name()).isEqualTo("Ada");
    }
}
```

**Go (testcontainers-go):**

```go
func TestUserRepository(t *testing.T) {
    ctx := context.Background()
    pg, err := postgres.Run(ctx, "postgres:16-alpine",
        postgres.WithDatabase("app"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"),
        testcontainers.WithWaitStrategy(
            wait.ForListeningPort("5432/tcp")),
    )
    require.NoError(t, err)
    defer pg.Terminate(ctx)

    dsn, _ := pg.ConnectionString(ctx, "sslmode=disable")
    db, _ := sql.Open("pgx", dsn)
    runMigrations(t, db)

    repo := NewUserRepository(db)
    require.NoError(t, repo.Save(ctx, User{Email: "ada@example.com", Name: "Ada"}))

    got, err := repo.FindByEmail(ctx, "ada@example.com")
    require.NoError(t, err)
    require.Equal(t, "Ada", got.Name)
}
```

**Python (pytest + testcontainers):**

```python
import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="module")
def pg_dsn():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url()

def test_save_and_load(pg_dsn):
    db = connect(pg_dsn)
    run_migrations(db)
    repo = UserRepository(db)

    repo.save(User(email="ada@example.com", name="Ada"))
    found = repo.find_by_email("ada@example.com")

    assert found is not None
    assert found.name == "Ada"
```

Notice the shape in all three: **start a real Postgres → run your real migrations → run your real code → assert on real results.** No mocks anywhere. That's an integration test.

---

## Core Concept 5 — Cleaning Up Between Tests

Integration tests share a database, so one test's data can pollute the next. You must reset state between tests. Three common strategies, simplest first:

1. **Truncate tables** before/after each test. Easy, reliable, slightly slow.

   ```java
   @AfterEach
   void cleanup() {
       jdbc.execute("TRUNCATE users RESTART IDENTITY CASCADE");
   }
   ```

2. **Rollback a transaction** per test — start a transaction in setup, never commit, roll back in teardown. Fast, but tricky if your code manages its own transactions (the middle file covers this).

3. **Fresh container per test** — maximum isolation, slowest. Reserve for tests that truly need it.

As a junior, **truncate per test** is the safe default. Always make each test responsible for its own data: never assume a row exists because "another test created it." Tests must be able to run in *any* order and *alone*.

A quick way to check you've got isolation right: run a single test by itself, then run the whole class, then run the class twice in a row. If any of those changes the result, your tests are leaking state into each other and one of the three strategies above isn't being applied. A green test that only stays green when its neighbours run first isn't really testing anything — it's testing the *suite's* order.

One more rule worth internalizing early: **run your real migrations in setup, don't hand-craft the schema.** It's tempting to write `CREATE TABLE users (...)` inside the test, but then you're testing against a schema that may not match what production actually has. Point the test at your real Flyway/golang-migrate/Alembic scripts so the schema under test is the schema you ship.

---

## Real-World Examples

- **The repository that lied.** A `findActiveUsers()` method had a mocked unit test asserting it returned 3 users. Shipped. In production it returned 0 — the real SQL used `status = 'ACTIVE'` but the column stored `'active'` (lowercase). A narrow integration test against real Postgres would have failed instantly.
- **The timestamp that drifted.** Code stored `LocalDateTime`; the DB column was `timestamptz`. Reads came back shifted by the server's timezone. The unit test mocked the DB and never noticed. The integration test made it obvious.
- **The migration nobody ran.** A new column was added in code but the migration script had a typo. Unit tests (mocked) passed. The first integration test failed at startup: *column "phone_number" does not exist.* That failure is the test doing its job.

---

## Mental Models

- **The mock is a mirror; the real DB is a stranger.** A mock only ever tells you what you already told it. The real dependency can surprise you — and surprises are where bugs hide.
- **"If it isn't your prod engine, it can lie."** In-memory substitutes trade fidelity for speed, and the bill comes due in production.
- **Each test brings its own world.** Setup creates the state, the test uses it, teardown destroys it. No test depends on another.
- **Real I/O is the dividing line.** Mock crosses no boundary → unit. Real DB/broker/HTTP → integration.

---

## Common Mistakes

- **Calling a mocked test an "integration test."** If there's no real I/O, it's a unit test wearing a costume.
- **Trusting H2/SQLite for Postgres code.** It passes locally, fails in prod. Use the real engine.
- **Tests that depend on order.** Test B passes only because Test A left a row behind. Run them alone and they break.
- **Forgetting teardown.** Leftover rows make the *next* run fail mysteriously.
- **Not running migrations in the test.** You test against a schema that doesn't match production.
- **One giant test that sets up everything.** Keep each test focused; isolate its data.

---

## Test Yourself

1. Name three bugs an integration test catches that a mocked unit test cannot.
2. Why is "passes against H2" not the same as "works against Postgres"?
3. What does Testcontainers give you that a shared dev database doesn't?
4. Give two strategies for cleaning state between integration tests.
5. Is a test that mocks the database an integration test? Why or why not?

---

## Cheat Sheet

```
Integration test = your code + REAL dependency (DB / broker / HTTP)
Catches:  wrong SQL · serialization · transactions · config · mock-vs-real gap
Avoid:    in-memory DBs (H2/SQLite) for prod-Postgres code — they lie
Use:      Testcontainers — real engine, throwaway Docker container
Isolate:  truncate (default) | rollback (fast) | fresh container (strongest)
Rule:     every test brings its own data; runs alone and in any order
```

---

## Summary

Integration tests run your real code against real dependencies to catch the bugs that live in the seams — wrong SQL, serialization, transactions, config, and the gap between your mocks and reality. The modern default is Testcontainers: a real Postgres (or Kafka, Redis…) in a throwaway Docker container. Avoid in-memory substitutes that aren't your production engine — they pass when they shouldn't. Keep each test isolated by resetting state between runs. Master the narrow integration test (your code + one real dependency) before anything broader.

---

## Further Reading

- The `integration-testing` skill — when and how to test across real infrastructure.
- The `test-data-management` skill — seeding and tearing down test state.
- Testcontainers documentation (testcontainers.org) — quick-start guides per language.

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — the layer below; what to mock and why.
- [End-to-End Testing](../04-end-to-end-testing/) — the layer above; the whole system.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/) — what you're choosing *not* to use here.
- [Test Data Management](../11-test-data-management/) — seeding and resetting fixtures.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — why integration tests get flaky.
