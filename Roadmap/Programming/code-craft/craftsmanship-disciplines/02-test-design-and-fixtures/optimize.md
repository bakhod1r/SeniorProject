# Test Design & Fixtures — Optimization Drills

> **Category:** [Craftsmanship Disciplines](../README.md) — design tests that read clearly, run fast, and manage their own data, so a failing test names a single broken behavior.

10 drills to make a test suite faster, more isolated, and cheaper to maintain. The dominant payoff here is **suite speed** (the **F** in F.I.R.S.T.) and **maintainability** — a slow or brittle suite is one that stops getting run.

---

## Table of Contents

1. [Drill 1: Replace a Real DB with In-Memory Builders](#drill-1-replace-a-real-db-with-in-memory-builders)
2. [Drill 2: Share the Expensive Setup, Isolate with Transactions](#drill-2-share-the-expensive-setup-isolate-with-transactions)
3. [Drill 3: Shrink a General Fixture to Minimal Local Fixtures](#drill-3-shrink-a-general-fixture-to-minimal-local-fixtures)
4. [Drill 4: Reduce Setup Duplication with a Builder](#drill-4-reduce-setup-duplication-with-a-builder)
5. [Drill 5: Replace Sleep with Polling](#drill-5-replace-sleep-with-polling)
6. [Drill 6: Parallelize an Isolated Suite](#drill-6-parallelize-an-isolated-suite)
7. [Drill 7: Push a Test Down the Pyramid](#drill-7-push-a-test-down-the-pyramid)
8. [Drill 8: Lazy / Scoped Fixtures for Expensive Resources](#drill-8-lazy-scoped-fixtures-for-expensive-resources)
9. [Drill 9: Parameterize to Kill Copy-Paste](#drill-9-parameterize-to-kill-copy-paste)
10. [Drill 10: Stop Rebuilding Immutable Data](#drill-10-stop-rebuilding-immutable-data)
11. [Optimization Tips](#optimization-tips)
12. [Summary](#summary)

---

## Drill 1: Replace a Real DB with In-Memory Builders

### Before — every unit test hits a real database

```python
def test_discount_for_premium(db):       # spins up DB, inserts, queries: ~80ms
    db.execute("INSERT INTO customers ...")
    customer = db.query("SELECT * FROM customers WHERE id=1")
    assert discount(customer) == 0.1
```

### After — pure logic tested with an in-memory object

```python
def test_discount_for_premium():         # no I/O: ~0.05ms
    customer = a_customer().premium().build()
    assert discount(customer) == 0.1
```

**Gain:** ~1,600× faster per test. `discount()` is pure logic — it never needed a database. Keep one *integration* test to prove the DB wiring; test the *logic* in memory. Across a suite this is the single biggest speed win.

---

## Drill 2: Share the Expensive Setup, Isolate with Transactions

### Before — each integration test creates and drops the schema

```python
@pytest.fixture
def db():
    create_schema()         # ~500ms EVERY test
    yield connect()
    drop_schema()
```

### After — schema once per session, transaction rollback per test

```python
@pytest.fixture(scope="session")
def engine():
    create_schema()         # paid ONCE for the whole suite
    yield create_engine(URL)
    drop_schema()

@pytest.fixture
def db(engine):
    conn = engine.connect(); txn = conn.begin()
    yield conn
    txn.rollback()          # fast reset; full isolation
    conn.close()
```

**Gain:** Schema creation drops from once-per-test to once-per-suite; per-test isolation comes from a cheap transaction rollback instead of a costly schema rebuild. Both Fast *and* Independent. (See [Senior](senior.md).)

---

## Drill 3: Shrink a General Fixture to Minimal Local Fixtures

### Before — one fixture builds six subsystems for every test

```python
@pytest.fixture
def world():
    return {
        "user": make_user(), "admin": make_admin(), "catalog": make_catalog(),
        "orders": make_orders(50), "cart": make_cart(), "promos": make_promos(),
    }   # built for EVERY test; most tests use one or two keys

def test_login(world):
    assert login(world["user"])    # used 1 of 6; paid for all 6
```

### After — each test builds only what it uses

```python
@pytest.fixture
def user():
    return make_user()

def test_login(user):
    assert login(user)             # fast, and the dependency is obvious
```

**Gain:** Faster (no building five unused subsystems) and clearer (the fixture *is* the documentation of what the test needs). A schema change to `catalog` no longer breaks `test_login`'s setup. (See [Senior](senior.md) on the general fixture.)

---

## Drill 4: Reduce Setup Duplication with a Builder

### Before — the same 7-line construction copy-pasted across tests

```java
@Test void a() {
    Customer c = new Customer("x", "x@y.z", Tier.GOLD, true, 0, "US", LocalDate.now());
    /* ... */
}
@Test void b() {
    Customer c = new Customer("x", "x@y.z", Tier.GOLD, true, 0, "US", LocalDate.now());  // dup
    /* ... */
}
```

### After — a builder centralizes construction; tests state only the difference

```java
@Test void a() { Customer c = aCustomer().gold().build(); /* ... */ }
@Test void b() { Customer c = aCustomer().gold().balance(-50).build(); /* ... */ }
```

**Gain:** Maintainability, not runtime. When `Customer` gains a required field, *one* builder default changes instead of every test. The duplicated construction can't drift. This is the strongest practical reason to adopt builders. (See [Middle](middle.md).)

---

## Drill 5: Replace Sleep with Polling

### Before — fixed sleep: slow AND flaky

```go
StartJob()
time.Sleep(3 * time.Second)        // always 3s; fails under load if job is slower
if !Done() { t.Fatal("not done") }
```

### After — poll until the condition holds, with a timeout

```go
StartJob()
waitUntil(t, 5*time.Second, Done)  // returns the instant Done() is true
```

**Gain:** Two wins at once. **Speed:** the test returns as soon as the job finishes (often well under a second) instead of always waiting the full sleep. **Reliability:** it only fails if the condition genuinely never holds, removing the load-sensitive flake. A fixed sleep is the worst of both worlds. (See [Find-Bug](find-bug.md) Bug 9.)

---

## Drill 6: Parallelize an Isolated Suite

### Before — serial execution; suite takes 8 minutes

```bash
go test ./...                      # one test at a time
pytest                             # serial
```

### After — parallel, once tests are independent

```bash
go test -race -shuffle=on -parallel 8 ./...   # 8-way; race + shuffle catch coupling
pytest -n auto -p randomly                     # one worker per core
```

**Gain:** Near-linear speedup (8 cores → roughly 8× faster) — but *only if* tests are Independent. Parallelism is the payoff for isolation discipline; it also *enforces* it, because shared mutable state now fails non-deterministically and gets caught. If parallel runs fail, the bug is coupling, not parallelism — fix the fixtures (per-worker DB, unique temp dirs, fresh fixtures). (See [Professional](professional.md).)

---

## Drill 7: Push a Test Down the Pyramid

### Before — a pure rule tested end-to-end through HTTP + DB

```python
def test_premium_gets_discount(client, db):     # ~400ms, occasionally flaky
    db.save(a_customer().premium().build())
    resp = client.post("/orders", json={"customer": 1, "total": 100})
    assert resp.json()["discount"] == 10
```

### After — the rule tested as pure logic; one thin test proves the wiring

```python
def test_premium_discount_rule():               # ~0.05ms, never flaky
    assert discount(a_customer().premium().build(), total=100) == 10

def test_order_endpoint_applies_discount(client):  # ONE integration test for wiring
    resp = client.post("/orders", json={"customer": premium_id, "total": 100})
    assert resp.status_code == 200
```

**Gain:** The discount *rule* — pure logic — moves to a microsecond unit test; a single integration test still proves the endpoint wires it up. Dozens of slow, flaky E2E variations collapse into many fast unit cases plus one wiring check. Same coverage, fraction of the runtime. (See [Senior](senior.md) on the pyramid.)

---

## Drill 8: Lazy / Scoped Fixtures for Expensive Resources

### Before — a Docker container started per test

```python
@pytest.fixture
def kafka():
    with KafkaContainer() as k:    # ~6s startup EVERY test
        yield k
```

### After — start it once per session, share read-only access

```python
@pytest.fixture(scope="session")
def kafka():
    with KafkaContainer() as k:    # ~6s ONCE for the whole suite
        yield k

# per-test isolation comes from unique topic names, not a new container
@pytest.fixture
def topic(kafka):
    name = f"test-{uuid4()}"       # each test gets its own topic
    kafka.create_topic(name); yield name; kafka.delete_topic(name)
```

**Gain:** A 6-second container start paid once instead of N times. Isolation is restored at a *cheaper* granularity (per-test topic) rather than per-test container. The rule: share the expensive thing, isolate at the cheapest level that still guarantees independence. (See [Professional](professional.md).)

---

## Drill 9: Parameterize to Kill Copy-Paste

### Before — six near-identical tests

```java
@Test void free_under_threshold()     { assertEquals("free", tier(0)); }
@Test void standard_at_50()           { assertEquals("standard", tier(50)); }
@Test void premium_at_500()           { assertEquals("premium", tier(500)); }
// ...three more
```

### After — one parameterized test

```java
@ParameterizedTest
@CsvSource({ "0,free", "50,standard", "500,premium", "-1,invalid" })
void tier_for_amount(int amount, String expected) {
    assertEquals(expected, Tier.of(amount));
}
```

**Gain:** Maintainability and coverage. One body to change when the signature evolves; adding a case is one CSV row. Each case still reports independently. Don't mix *different behaviors* into one parameterized test — that reintroduces the multi-concept smell. (See [Middle](middle.md).)

---

## Drill 10: Stop Rebuilding Immutable Data

### Before — a costly, never-mutated fixture rebuilt every test

```python
@pytest.fixture
def tax_tables():
    return load_tax_tables_from_disk()   # parses a big file EVERY test; never mutated
```

### After — build the immutable fixture once and share it

```python
@pytest.fixture(scope="session")         # safe: tax_tables is read-only
def tax_tables():
    return load_tax_tables_from_disk()   # parsed ONCE for the whole suite
```

**Gain:** The file is parsed once, not per test. This is the *one* shared-fixture case that's unconditionally safe — the data is immutable, so no test can corrupt it for another. (Contrast with sharing *mutable* state, which is the interdependence trap.) Verify immutability before widening scope.

---

## Optimization Tips

### Where the speed actually comes from

1. **Eliminate I/O from unit tests** — the biggest win by far. Pure logic needs no DB/network/disk (Drill 1, 7).
2. **Pay expensive setup once** — schema, containers, immutable data at session scope, with cheap per-test isolation (Drills 2, 8, 10).
3. **Parallelize** — near-linear, but only after Independence is real (Drill 6).
4. **Poll, don't sleep** — removes both wasted time and load-flakiness (Drill 5).

### Where the maintainability comes from

5. **Builders/factories** centralize construction so one production change touches one fixture (Drill 4).
6. **Minimal local fixtures** shrink blast radius and document dependencies (Drill 3).
7. **Parameterize** to collapse copy-paste (Drill 9).

### Optimization checklist

- [ ] No real I/O in unit tests — replace with in-memory builders/fakes.
- [ ] Expensive setup (schema, container, big file) at session scope.
- [ ] Per-test isolation via transaction rollback / unique names, not full rebuild.
- [ ] No fixed `sleep` — poll for the condition with a timeout.
- [ ] Suite runs in parallel (`-parallel`/`-n auto`) and shuffled (`-shuffle`/`randomly`).
- [ ] Heavy behaviors pushed down the pyramid; few E2E tests.
- [ ] Construction via builders so changes are one-place.
- [ ] General fixtures shrunk to minimal local ones.
- [ ] Copy-pasted tests parameterized.
- [ ] Shared fixtures are immutable or reset.

### Anti-optimizations

- ❌ **Sharing a *mutable* fixture for speed** — buys speed with interdependence; the flakes cost more than the seconds saved.
- ❌ **Replacing a real DB with a dishonest fake** — fast but false greens; the fake needs a [contract test](senior.md#contract-tests-keeping-fakes-honest).
- ❌ **Auto-retrying flakes** instead of fixing them — masks real intermittent bugs.
- ❌ **Caching mutable state across tests** to avoid rebuild — the classic order-dependence trap.

---

## Summary

Test-suite optimization is mostly about **removing I/O** and **paying expensive setup once**, then **parallelizing** what isolation allows. The microsecond unit test beats the millisecond integration test thousands of times a day, so the deepest optimization is *level selection*: test each behavior at the lowest level that can, with the lightest fixture that suffices. Share only immutable or reset state; poll instead of sleep; centralize construction in builders so the suite stays cheap to maintain as the code evolves. A fast, isolated suite is one developers run constantly — and an unrun test catches nothing.

---

[← Find-Bug](find-bug.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md)

**Test Design & Fixtures suite complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next discipline:** [Refactoring as a Discipline](../03-refactoring-as-a-discipline/junior.md).
