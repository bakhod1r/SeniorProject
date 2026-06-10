# Mystery Guest — Optimize

> **Category:** [Testing Anti-Patterns](../README.md) → **Mystery Guest** — *refactoring a suite that leans on one big shared fixture into local, explicit, fast tests.*

---

This file is a **single end-to-end refactor**. You're handed a real-feeling test suite built on one large shared fixture — the worst case, because it's *mysterious* (data off-screen), *slow* (the fixture is rebuilt or reused expensively), and *coupled* (tests share mutable state and depend on run order). You'll take it apart step by step, showing the before/after at each move and — crucially — **addressing the speed trade-off** that the naive "just make every fixture fresh" advice ignores.

> The companion theory is in [`senior.md`](senior.md) (the migration strategy) and [`professional.md`](professional.md) (the shared-vs-fresh cost model). The **test-data-management** and **integration-testing** skills are the operational tools behind every step here. This file is where you watch the strategy run on real code.

---

## Table of Contents

1. [The suite we inherited](#the-suite-we-inherited)
2. [Step 0 — Characterize: prove the coupling exists](#step-0--characterize-prove-the-coupling-exists)
3. [Step 1 — Stop the bleeding](#step-1--stop-the-bleeding)
4. [Step 2 — Introduce builders](#step-2--introduce-builders)
5. [Step 3 — Migrate tests to local data](#step-3--migrate-tests-to-local-data)
6. [Step 4 — Fix the speed regression](#step-4--fix-the-speed-regression)
7. [Step 5 — Delete the fixture](#step-5--delete-the-fixture)
8. [Before / After](#before--after)
9. [Measuring the Win](#measuring-the-win)
10. [Common Mistakes](#common-mistakes)
11. [Summary](#summary)
12. [Related Topics](#related-topics)

---

## The suite we inherited

A pricing-and-orders suite. Every test reads from one session-scoped fixture, `standard_data`, seeded into a real database. It's ~180 tests; here are three representative ones.

```python
# conftest.py
@pytest.fixture(scope="session")          # ONE instance for the whole run
def standard_data(db):
    org      = make_org(db, name="Acme")
    gold     = make_customer(db, org=org, tier="gold", country="UK")
    standard = make_customer(db, org=org, tier="standard", country="US")
    catalog  = [make_product(db, sku=f"SKU-{i}", price=10.0 * i) for i in range(1, 21)]
    sub      = make_subscription(db, customer=gold, plan="pro")
    return Namespace(org=org, gold=gold, standard=standard, catalog=catalog, sub=sub)


# test_pricing.py
def test_gold_discount(standard_data):
    price = quote(standard_data.gold, standard_data.catalog[8])   # SKU-9, price 90
    assert price == 81.00                                         # why 81? off-screen

def test_standard_no_discount(standard_data):
    price = quote(standard_data.standard, standard_data.catalog[8])
    assert price == 90.00

def test_loyalty_upgrade(standard_data):
    standard_data.gold.tier = "platinum"        # MUTATES the shared customer
    assert upgrade_reward(standard_data.gold) == "lounge_access"
```

Everything wrong with a Mystery Guest, industrialized:

- **Mysterious:** `gold`, `catalog[8]`, and the prices are defined in `conftest.py`, far from every assertion. `81.00` is underivable on screen.
- **Coupled:** `scope="session"` means one shared instance; `test_loyalty_upgrade` mutates `gold.tier` to `"platinum"`, poisoning every later test that reads `standard_data.gold`.
- **Slow & un-parallelizable:** the fixture seeds an org, two customers, a 20-product catalog, and a subscription into a real DB — and because tests share mutable state, you *cannot* run them in parallel.
- **Bloated (General Fixture):** most tests use one customer and one product, but every test pays to build all 24 rows.

---

## Step 0 — Characterize: prove the coupling exists

Before changing anything, make the coupling *fail loudly* so you have a backlog and a safety signal. Run the suite in randomized order:

```bash
pytest -p randomly        # randomize test order
```

```
FAILED test_pricing.py::test_gold_discount        - assert 73.00 == 81.00
FAILED test_pricing.py::test_standard_no_discount - assert 81.00 == 90.00
```

The failures appear *only* when `test_loyalty_upgrade` runs first: it sets `gold.tier = "platinum"`, so `test_gold_discount` now prices a platinum customer (73.00, not 81.00). The shuffle just converted a silent landmine into a visible test list. **Those failing tests are your migration backlog**, and the shuffle run is the regression check you'll re-run after each step.

> This is the senior move: don't trust your reading of the coupling — *prove* it with `-shuffle`/`-p randomly`. The set that fails under shuffle is exactly the set depending on hidden shared state.

---

## Step 1 — Stop the bleeding

The pile grows every sprint as new tests bolt onto `standard_data`. Freeze it first, so you're draining a bucket that isn't refilling. A review rule (or a lint check) does it:

```python
# conftest.py — deprecate, don't delete yet
@pytest.fixture(scope="session")
def standard_data(db):
    warnings.warn(
        "standard_data is deprecated: new tests must build local data via builders "
        "(see tests/builders.py). Do not add fields here.",
        DeprecationWarning, stacklevel=2,
    )
    ...   # unchanged for now
```

New tests can't use it without tripping the warning in review. The migration now has a finish line.

---

## Step 2 — Introduce builders

Give tests a cheap way to make local, minimal, fresh data — so "build your own" doesn't mean "write twelve lines per test." Builders with sensible defaults:

```python
# tests/builders.py — fresh objects, sensible defaults, override only what matters
def make_customer(db, *, tier="standard", country="US"):
    c = Customer(tier=tier, country=country)
    db.add(c); db.flush()
    return c

def make_product(db, *, sku="SKU-TEST", price=1.00):
    p = Product(sku=sku, price=price)
    db.add(p); db.flush()
    return p
```

These produce a *fresh* object per call (no sharing) and surface only the field a test cares about (the rest defaulted). Unlike the shared `standard_data`, nothing they create is visible to another test.

---

## Step 3 — Migrate tests to local data

Now rewrite each backlog test to own its data. The asserted facts become visible; the dependency on `standard_data` disappears.

```python
# BEFORE — mysterious + coupled
def test_gold_discount(standard_data):
    price = quote(standard_data.gold, standard_data.catalog[8])
    assert price == 81.00

# AFTER — local, explicit, derivable, isolated
def test_gold_discount(db):
    gold    = make_customer(db, tier="gold")    # the fact under test, visible
    product = make_product(db, price=90.00)     # the base, visible
    assert quote(gold, product) == 81.00        # 90 − 10%, checkable on sight
```

```python
# BEFORE — mutates shared state, poisons the run
def test_loyalty_upgrade(standard_data):
    standard_data.gold.tier = "platinum"
    assert upgrade_reward(standard_data.gold) == "lounge_access"

# AFTER — owns its customer; the mutation harms nobody
def test_loyalty_upgrade(db):
    gold = make_customer(db, tier="gold")       # its own customer
    gold.tier = "platinum"                      # safe: no other test can see it
    assert upgrade_reward(gold) == "lounge_access"
```

Re-run `pytest -p randomly` after each test migrates. As tests move off `standard_data`, the shuffle failures disappear one by one — your progress bar.

---

## Step 4 — Fix the speed regression

Here's the trap that makes teams give up. Migrating to per-test data **regresses suite time**, because each test now creates its own rows in the real database instead of reusing the one shared seed:

```
Before (shared session fixture):   12.4 s   (built the 24 rows once)
After  (naive per-test creation):  48.1 s   (each test inserts its own rows, committed)
```

A 4× slowdown will get the migration reverted unless you address it. The fix is **not** to go back to sharing — it's to make per-test data cheap and to share only the expensive *immutable* layer. Two moves:

**Move 1 — wrap each test in a transaction and roll it back.** Set up the schema once; each test's rows are created and discarded in-memory-fast, with perfect isolation:

```python
# conftest.py — the database schema exists once; data is per-test and cheap
@pytest.fixture(scope="function")
def db(database_engine):                 # database_engine is session-scoped (schema built once)
    conn = database_engine.connect()
    txn = conn.begin()                   # start a transaction...
    try:
        yield Session(bind=conn)
    finally:
        txn.rollback()                   # ...roll it back: no commit, no cleanup, fully isolated
        conn.close()
```

**Move 2 — push tests that don't need persistence down the pyramid.** Many of the 180 tests test *pure pricing logic* and never needed a database at all. For those, build the object graph in memory — local, explicit, *and* fast:

```python
def test_gold_discount():                       # no db fixture at all
    gold    = Customer(tier="gold", country="UK")   # in-memory, instant
    product = Product(sku="SKU-9", price=90.00)
    assert quote(gold, product) == 81.00            # pure logic, microseconds
```

After both moves:

```
After (txn rollback + in-memory where possible):  9.8 s   — and now parallelizable
```

Faster than the original *and* isolated. The transaction rollback erased the per-test insert cost; moving pure-logic tests off the DB removed it entirely; and because tests no longer share mutable state, you can finally parallelize:

```bash
pytest -n auto        # parallel workers — impossible with the old shared mutable fixture
```

> **The key insight (`professional.md`):** the answer to "fresh fixtures are slow" is *share the infrastructure, not the data*. Share the schema/engine once (expensive, immutable); keep each test's *data* fresh via rollback or in-memory construction. You get the shared fixture's speed and the fresh fixture's isolation.

---

## Step 5 — Delete the fixture

As each test leaves `standard_data`, delete the fields nothing else uses. When the last test migrates, delete the fixture entirely:

```python
# conftest.py — gone. The suite is now 180 self-contained tests.
```

The General Fixture withered as tests left it, and the deprecation warning from Step 1 guaranteed nothing new latched on. The suite no longer has a single shared point of failure.

---

## Before / After

| Property | Before (shared `standard_data`) | After (local builders) |
|---|---|---|
| **Readability** | `81.00` defined off-screen in `conftest.py` | `81.00` derivable in the test (`90 − 10%`) |
| **Isolation** | Session-scoped; one test mutates `gold`, poisons others | Each test owns fresh data; mutation is harmless |
| **Order-coupling** | Fails under `-p randomly` | Passes in any order |
| **Parallelism** | Impossible (shared mutable state) | `pytest -n auto` works |
| **Suite time** | 12.4 s | 9.8 s (and parallelizable to less) |
| **Fixture bloat** | Builds 24 rows for every test | Each test builds only what it needs |
| **Failure diagnosis** | "Why is `gold` platinum?" → hunt | Everything the test needs is in the test |

The migration removed the mystery, the coupling, *and* — after Step 4 — the slowness, simultaneously. They were never independent problems: the shared fixture caused all three.

---

## Measuring the Win

Don't claim victory by feel — measure the three axes the shared fixture degraded:

- **Mystery → readability.** Pick five migrated tests at random and cover everything but the test body. Can a teammate state what each proves and why? Before: no. After: yes.
- **Coupling → order-independence.** `pytest -p randomly` (and `go test -shuffle=on`, JUnit random orderer) must pass green, repeatedly. This is the objective coupling test; keep it in CI permanently so coupling can't creep back.
- **Slowness → wall-clock time.** `pytest --durations=20` shows the slowest tests; total suite time before vs. after; and the parallel time (`-n auto`) the old fixture forbade. Record the numbers in the PR so the win is defensible.

> Keep the randomized-order run in CI forever. It's the regression test for *this entire class of problem* — the moment someone reintroduces a shared mutable fixture, the shuffle goes red.

---

## Common Mistakes

1. **Reverting at Step 4.** The speed regression is real but solvable (rollback + in-memory + parallelism). Reverting to the shared fixture trades a fixable CPU cost for permanent mystery, coupling, and flakiness.
2. **Big-bang rewriting all 180 tests at once.** You'll be red for a week. Migrate behind the deprecation warning, test by test, re-running the shuffle each time.
3. **Skipping Step 0.** Without the randomized-order run you don't know which tests are coupled, you have no regression signal, and you'll "fix" tests that were fine while missing the dangerous ones.
4. **Committing per-test data instead of rolling it back.** Committed rows leak across tests (re-introducing coupling) and require cleanup (slow). Transaction rollback is both faster and isolating.
5. **Leaving pure-logic tests on the database.** A pricing-formula test that touches Postgres is needlessly slow *and* a candidate Mystery Guest. Push it down the pyramid to in-memory construction.
6. **Building a new shared fixture "but immutable."** Acceptable only for genuinely frozen reference data — and even then keep it small and named. The instant it's mutable, you've rebuilt the original problem.

---

## Summary

- A suite built on one big shared fixture is the Mystery Guest at scale: **mysterious** (data off-screen), **coupled** (shared mutable state, order-dependent), **slow**, and **bloated** — and these are one problem, not four.
- Refactor it as a disciplined migration: **characterize** the coupling with a randomized-order run (your backlog *and* regression signal), **stop the bleeding** with a deprecation warning, **introduce builders**, **migrate tests** to local explicit data, **fix the speed regression**, and **delete the fixture**.
- The speed regression is the step that defeats most teams. Beat it by **sharing the infrastructure, not the data**: build the schema/engine once, give each test fresh data via **transaction rollback** or **in-memory construction**, and unlock **parallelism** that the shared mutable fixture forbade. The result is faster *and* isolated.
- Measure the win on all three axes — readability (cover-the-body test), order-independence (shuffle in CI forever), wall-clock time (`--durations`, parallel run) — and keep the randomized-order run as the permanent guard against regression.

---

## Related Topics

- [`senior.md`](senior.md) — the migration strategy this file executes.
- [`professional.md`](professional.md) — the shared-vs-fresh cost model and "share infrastructure, not data."
- [`tasks.md`](tasks.md) — smaller, focused versions of these refactors.
- [Slow Tests](../05-slow-tests/optimize.md) — the speed side, in depth.
- [Flaky Tests](../02-flaky-tests/optimize.md) — order-coupling as a flakiness root cause.
- [Fragile Tests](../01-fragile-tests/optimize.md) — change amplification from shared fixtures.
- [Over-Mocking](../06-over-mocking/optimize.md) — the complementary "tests stop testing behavior" refactor.
- [Bad Structure → Development Anti-Patterns](../../01-development/01-bad-structure/optimize.md) — refactoring tangled production structure.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — shared state and coupling at the system level.
