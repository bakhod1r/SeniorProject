# Test Data Management — Middle Level

> **Roadmap:** [Testing](../README.md) → Test Data Management
>
> *Inline vs shared data, determinism, and isolation — the three forces that decide whether a suite is readable, reproducible, and safe to run in parallel.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Inline vs Shared Fixtures](#core-concept-1--inline-vs-shared-fixtures)
5. [Core Concept 2 — The Mystery Guest, Before and After](#core-concept-2--the-mystery-guest-before-and-after)
6. [Core Concept 3 — Determinism: Killing now() and Order Dependence](#core-concept-3--determinism-killing-now-and-order-dependence)
7. [Core Concept 4 — Random Data Done Right: Seeded Fakers](#core-concept-4--random-data-done-right-seeded-fakers)
8. [Core Concept 5 — Isolation Between Tests](#core-concept-5--isolation-between-tests)
9. [Core Concept 6 — Seeding Databases and Environments](#core-concept-6--seeding-databases-and-environments)
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

> Focus: **the trade-offs that govern test data once a suite grows — local clarity vs shared DRY, deterministic time and randomness, and keeping tests from polluting each other.**

At the junior level you learned to build minimal, readable data for a single test. The moment you have hundreds of tests, three new forces appear. **Duplication vs readability**: should each test build its own data, or share a fixture? **Determinism**: a test that reads the clock or relies on unseeded randomness fails on a leap day or one run in fifty. **Isolation**: a test that writes to a shared database can corrupt the next test, especially when tests run in parallel.

This level gives you a principled way to navigate all three. None has a one-size answer; each is a trade-off you make on purpose. The cross-cutting truth: most flakiness traced back to test data is a determinism or isolation failure, not a logic bug (see [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/)).

---

## Prerequisites

- You are comfortable with builders, factories, and the "only specify what matters" rule (see [Test Data Management — Junior](junior.md)).
- You have written integration tests that hit a real database (see [Integration Testing — Middle](../03-integration-testing/middle.md)).
- You know what a test runner's setup/teardown hooks do.
- You understand database transactions at a basic level.

---

## Glossary

| Term | Meaning |
|---|---|
| **Inline fixture** | Test data built inside the test body, visible at the call site. |
| **Shared fixture** | Data defined once (a helper, a `conftest`, a seed) and reused by many tests. |
| **Mystery guest** | A test that depends on data defined elsewhere, so it can't be understood in isolation. |
| **Determinism** | The property that a test gives the same result on every run, regardless of time, order, or machine. |
| **Seeded faker** | A fake-data generator initialized with a fixed seed, so output is varied yet reproducible. |
| **Transaction rollback** | Wrapping a test in a DB transaction and rolling it back at the end so no data persists. |
| **Truncate-and-reseed** | Emptying tables and re-inserting a known baseline between tests. |
| **Namespacing** | Giving each test unique data (unique emails, IDs) so tests can't collide. |
| **Reference data** | Slow-changing baseline data (countries, currencies) shared across all tests. |

---

## Core Concept 1 — Inline vs Shared Fixtures

Every test datum lives somewhere on a spectrum from **fully inline** (built in the test body) to **fully shared** (defined once, used everywhere).

Inline data is maximally **readable**: you see exactly what the test depends on without leaving the test. Its cost is **duplication** — the same setup repeated across tests.

Shared data is maximally **DRY**: define a `gold_customer` fixture once, reuse it. Its cost is **opacity and coupling** — a reader must hunt for the definition, and a change to the shared fixture silently affects every test using it.

The resolution is not "always inline" or "always shared." It is a layered rule:

- **Inline the data the test asserts on.** If the test is about a $120 order, `with_total(120)` belongs in the test body. This is the test's *intent*; it must be visible.
- **Share the construction machinery, not the values.** A `an_order()` builder is shared (DRY), but each test calls it with its own overrides (readable). You get both properties because the builder is shared while the *choices* stay local.
- **Share only truly invariant baselines.** Reference data — the country table, the product catalog seed — can be a shared fixture, because no test asserts on its specifics; it's just scenery.

So the right answer is almost always **shared builders, local overrides** — not shared fixtures of finished objects.

---

## Core Concept 2 — The Mystery Guest, Before and After

The **mystery guest** is the anti-pattern that shared fixtures invite: a test whose outcome depends on data defined far away, so you cannot understand the test by reading it.

**Before** — a mystery guest:

```python
# conftest.py, 300 lines away:
@pytest.fixture
def seeded_db(db):
    db.add(Customer(id=1, name="Jane", tier="gold", lifetime_spend=5000))
    db.add(Order(id=10, customer_id=1, total=80, status="paid"))
    db.commit()

# the test:
def test_loyalty_discount(seeded_db, db):
    order = db.get(Order, 10)
    apply_loyalty_discount(order)
    assert order.total == 72   # why 72? who is customer 1? why gold?
```

Nothing in the test explains why the discount is 10%. The reader must find the fixture, learn that customer 1 is `gold` with a high lifetime spend, and reconstruct the rule. The test is a puzzle.

**After** — intent at the call site:

```python
def test_gold_customer_gets_10_percent(db):
    customer = a_customer().with_tier("gold").save(db)
    order = an_order().for_customer(customer).with_total(80).save(db)

    apply_loyalty_discount(order)

    assert order.total == 72   # 80 - 10% (gold) — visible right here
```

The data the rule depends on — `gold` tier, `80` total — is in front of you. The builder still does the heavy lifting (DRY), but the *meaning* is local (readable). This is **test-data-as-documentation**: a well-built test is the clearest specification of the behavior, because the inputs and the expected output sit side by side.

---

## Core Concept 3 — Determinism: Killing now() and Order Dependence

A deterministic test gives the same verdict every run. Test data breaks determinism in two classic ways.

**Reading the clock.** Any default of `datetime.now()` makes the data depend on *when the test runs*. A test that creates an order "today" and asserts it's "less than 30 days old" passes for 30 days and then fails forever. The fix is to inject the clock and use fixed dates in data:

```python
FIXED_NOW = datetime(2023, 6, 1, 12, 0, 0)

def test_order_is_recent():
    order = an_order().created_at(FIXED_NOW - timedelta(days=5)).build()
    assert order.is_recent(now=FIXED_NOW)   # clock is an argument, never global
```

The rule: **no `now()` in seeds or defaults, and no `now()` inside the code under test that the test can't override.** Pass time in.

**Order dependence.** If test B only passes because test A left a row behind, the suite breaks the moment the runner reorders tests (most parallel runners do). Never let one test's data leak into another's expectations — which is exactly what isolation (Concept 5) enforces. A good smell check: run the suite with `--randomly-seed` / shuffled order. If anything breaks, you have an order-dependence bug hiding in your data.

**Stable IDs.** Auto-increment IDs make assertions like `assert order.id == 10` brittle — the number depends on insertion order. Assert on data you set (`order.total`), not on database-assigned surrogate keys.

---

## Core Concept 4 — Random Data Done Right: Seeded Fakers

Random data sounds dangerous, but used correctly it *increases* coverage without sacrificing reproducibility. The key is a **fixed seed**: the generator produces varied-looking data, but the *same* varied data on every run.

```python
from faker import Faker

fake = Faker()
Faker.seed(12345)        # pin the seed — same sequence every run

def a_customer():
    return Customer(
        name=fake.name(),          # "Allison Hill" every run, given the seed
        email=fake.email(),        # varied across customers, fixed across runs
        phone=fake.phone_number(),
    )
```

This gives you the best of both worlds: data that *looks* real and varies between records (catching code that accidentally assumes a fixed name length), yet is fully reproducible (when a test fails, it fails the same way on your machine and in CI). `factory_boy`'s `factory.Faker(...)` is seeded the same way.

Two rules keep seeded fakers safe:

1. **Seed once, globally, in test setup** — so the whole run is reproducible.
2. **Never assert on faked fields.** If a test checks `name == "Jane"`, don't let faker pick the name; pin it. Faker fills the *scenery* (the fields you don't assert on); your builder pins the *subject* (the fields you do). When a property-based approach is warranted instead, see [Property-Based Testing](../06-property-based-testing/).

---

## Core Concept 5 — Isolation Between Tests

Isolation means one test's data cannot affect another's. Four strategies, in rough order of speed:

**1. Transaction rollback per test** — the fastest for DB tests. Begin a transaction in setup, run the test, roll back in teardown. Nothing persists.

```python
@pytest.fixture
def db():
    conn = engine.connect()
    txn = conn.begin()
    session = Session(bind=conn)
    yield session
    session.close()
    txn.rollback()        # everything the test wrote disappears
    conn.close()
```

Limit: code that commits its own transactions (or tests across multiple connections) won't roll back cleanly.

**2. Truncate-and-reseed** — between tests, empty the tables and re-insert a known baseline. Slower (a full reset each test) but works regardless of commits.

```sql
TRUNCATE orders, customers RESTART IDENTITY CASCADE;
-- then re-seed reference data
```

**3. Schema-per-worker** — when tests run in parallel, give each worker its own schema/database so writes can't collide. The standard pattern for parallel integration suites.

**4. Namespacing (unique data per test)** — when a shared store can't be reset, make every test's data unique:

```python
def unique_email():
    return f"user-{uuid4()}@test.local"   # no two tests collide
```

Choose the cheapest strategy that actually isolates your case: rollback for single-connection unit-ish DB tests, schema-per-worker for parallel integration, namespacing for shared external systems you can't truncate. Isolation failures are the number-one source of "passes alone, fails in the suite" flakiness.

---

## Core Concept 6 — Seeding Databases and Environments

Seeding is populating an environment with data before tests run. Distinguish **layers**:

- **Reference data** — slow-changing baselines (countries, currencies, feature flags, a product catalog). Seed once per environment; it's scenery, never asserted on. Use idempotent SQL or a migration-style seed (the `database-migration-patterns` skill covers keeping these in lockstep with the schema).
- **Test-case data** — the rows a specific test acts on. Build these per test, via factories, inside isolation boundaries — never bake them into a shared seed.

**Programmatic seeds vs SQL dumps.** Programmatic seeds (factories/builders called in code) stay valid as the schema evolves and express intent. SQL dumps are fast to load and exact, but rot the instant the schema changes and are opaque to read. Prefer programmatic seeds for test-case data; SQL dumps are acceptable only for large, stable reference data where load speed matters.

**By test level**: unit tests need almost no seeding (build objects in memory). Integration and E2E tests need real reference data seeded plus per-test-case data built inside isolation (see [Integration Testing](../03-integration-testing/) and [End-to-End Testing](../04-end-to-end-testing/)).

---

## Real-World Examples

- **The leap-day failure.** A subscription test built a trial that "ends in one month" using `now()`. On January 30, "one month later" had no valid date and the test threw. Pinning `now` to a fixed date and computing relative dates fixed it permanently.
- **The parallel-suite corruption.** A team enabled parallel test execution and saw random failures. Two workers were inserting a customer with email `test@x.com`; whichever ran second hit a unique-constraint error. Switching to `unique_email()` namespacing resolved every failure at once.
- **The seed that hid a bug.** A shared SQL seed inserted an order with status `paid`. A new "only paid orders are refundable" feature passed all tests — because the seed only ever had paid orders. A builder that produced *both* paid and pending orders per test exposed the missing branch.

---

## Mental Models

- **Builders are shared; choices are local.** That single rule resolves the inline-vs-shared tension.
- **Time is an input, not an ambient fact.** Pass the clock in; never let data read it.
- **A seed is a recording, not a dice roll.** Seeded randomness replays the same "random" run every time.
- **Isolation is a boundary, not a cleanup.** The goal isn't to tidy up after; it's that a test could never see another test's data in the first place.
- **The test is the spec.** When inputs and expected output sit together, the test documents the behavior better than any prose.

---

## Common Mistakes

| Mistake | Why it hurts | Fix |
|---|---|---|
| Shared fixtures of finished objects | Mystery guest; cross-test coupling | Shared builders, local overrides |
| `now()` in data or code under test | Time-dependent flakiness | Inject a fixed clock |
| Unseeded faker | Irreproducible failures | `Faker.seed(...)` once globally |
| Asserting on faked/auto-ID fields | Random green/red | Pin the fields you assert on |
| Relying on test execution order | Breaks under shuffling/parallel | Isolate; run shuffled in CI |
| Baking test-case rows into a shared seed | Hides branches; couples tests | Build per-test inside isolation |

---

## Test Yourself

1. Explain why "shared builders, local overrides" satisfies both DRY and readability.
2. Take a mystery-guest test you've seen and describe the minimum change to make its intent local.
3. List two ways `now()` creeps into test data and how to remove each.
4. How can random faker data be reproducible? What must you *never* let faker control?
5. For a parallel integration suite that commits its own transactions, which isolation strategy fits, and why not transaction rollback?
6. Which data belongs in a shared seed and which must be built per test?

---

## Cheat Sheet

```text
INLINE vs SHARED   Share builders, not finished objects; keep overrides local.
MYSTERY GUEST      If you must scroll to understand a test, fix the data locality.
DETERMINISM        No now() in data/code; pass clock in; assert on set values, not IDs.
SEEDED FAKER       Faker.seed(N) once; faker = scenery, builder = subject.
ISOLATION          rollback (fast) → truncate → schema-per-worker (parallel) → namespacing
SEED LAYERS        reference data = seed once; test-case data = build per test.
SMELL CHECK        Run the suite shuffled. Anything that breaks = order/isolation bug.
```

---

## Summary

A growing suite is governed by three forces. **Inline vs shared** is resolved by sharing builders while keeping override choices local, which kills the mystery guest. **Determinism** demands no clock reads in data and seeded (not unseeded) randomness, so failures replay identically. **Isolation** — via rollback, truncation, schema-per-worker, or namespacing — guarantees no test sees another's data, which is the root fix for most "passes alone, fails together" flakiness. Seed reference data once, build test-case data per test, and your suite stays readable, reproducible, and parallel-safe. The senior level scales these habits into an organization-wide strategy and confronts the risk of production-derived data.

---

## Further Reading

- Gerard Meszaros, *xUnit Test Patterns* — the canonical treatment of fixtures, the mystery guest, and shared vs fresh fixtures.
- `faker` / `Faker.seed` documentation — reproducible fake data.
- The `database-migration-patterns` skill — keeping seeds aligned with schema changes.
- The `test-data-management` skill — setup, cleanup, and isolation patterns.

---

## Related Topics

- [Integration Testing](../03-integration-testing/) — where isolation and seeding matter most.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — determinism and isolation are the cure.
- [Property-Based Testing](../06-property-based-testing/) — generating inputs as a discipline.
- [Unit Testing](../02-unit-testing/) — in-memory data, no seeding needed.
