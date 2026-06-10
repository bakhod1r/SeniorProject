# Slow Tests — Exercises

> **Category:** [Testing Anti-Patterns](../README.md) → **Slow Tests** — *hands-on practice making a slow suite fast without losing coverage or gaining flakiness.*

---

These are **make-it-fast** exercises. Each gives you a slow test (or set of tests) in Go, Java (JUnit 5), or Python (pytest), a goal, acceptance criteria, and a collapsible solution. The point is to *make the change* — replace real I/O with a fake, convert a sleep to an await, parallelize an isolated set, and slice a full-context test — and to understand *why the fix is faster without being less correct*.

> **How to use this file.** Read the problem and try it in your editor *before* opening the solution. The "why it's faster *and still correct*" note under each solution matters more than the diff: speed bought with lost coverage or new flakiness is not a win. Refer back to [`middle.md`](middle.md) for the causes and [`senior.md`](senior.md) for parallelism/isolation and slicing.

---

## Table of Contents

| # | Exercise | Cause → Fix | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Replace a real-DB unit test with a fake](#exercise-1--replace-a-real-db-unit-test-with-a-fake) | Real I/O → fake | Java | ★ easy |
| 2 | [Convert a sleep to an await](#exercise-2--convert-a-sleep-to-an-await) | `sleep` → await | Go | ★ easy |
| 3 | [Shrink an oversized fixture & combinatorics](#exercise-3--shrink-an-oversized-fixture--combinatorics) | Big fixture / cross-product | Python | ★★ medium |
| 4 | [Move per-test setup to shared, isolated setup](#exercise-4--move-per-test-setup-to-shared-isolated-setup) | Per-test heavy setup → share + isolate | Python | ★★ medium |
| 5 | [Parallelize an isolated test set](#exercise-5--parallelize-an-isolated-test-set) | Serial → parallel-with-isolation | Go | ★★★ hard |
| 6 | [Slice a full-context test](#exercise-6--slice-a-full-context-test) | Full boot → slice | Java | ★★★ hard |
| 7 | [Stage the suite into fast and slow gates](#exercise-7--stage-the-suite-into-fast-and-slow-gates) | Segregate slow tests | (process) | ★★ medium |

---

## Exercise 1 — Replace a real-DB unit test with a fake

**Cause → Fix:** Real I/O → fake · **Language:** Java (JUnit 5) · **Difficulty:** ★ easy

This "unit" test connects to a real database to verify a pure business rule. Make it a true unit test: no I/O, data visible in the test, microseconds not milliseconds. You may change the production code's seam.

```java
// Before — ~40 ms per run, needs a running Postgres.
class DiscountServiceTest {
    @Test
    void goldMembersGet20Percent() throws Exception {
        try (Connection c = DriverManager.getConnection("jdbc:postgresql://localhost/test")) {
            c.createStatement().execute("INSERT INTO members(id, tier) VALUES (1, 'gold')");
            DiscountService svc = new DiscountService(c);   // talks to the DB directly
            assertEquals(0.20, svc.discountFor(1));
            c.createStatement().execute("DELETE FROM members WHERE id = 1");
        }
    }
}
```

**Acceptance criteria:** no database connection in the test; the test data is constructed in the test body; the discount rule is still verified; the real DB query gets a (separate) integration test in your plan.

<details>
<summary>Solution</summary>

Introduce a boundary the service depends on (`MemberRepository`), inject it, and fake it in the test.

```java
// Production: the service depends on an interface, not on java.sql.Connection.
interface MemberRepository {
    String tierOf(long id);
}

class DiscountService {
    private final MemberRepository members;
    DiscountService(MemberRepository members) { this.members = members; }

    double discountFor(long memberId) {
        return switch (members.tierOf(memberId)) {
            case "gold"   -> 0.20;
            case "silver" -> 0.10;
            default       -> 0.0;
        };
    }
}

// Test: a fake — a real, working, in-memory implementation. No I/O.
class FakeMemberRepository implements MemberRepository {
    private final Map<Long, String> tiers = new HashMap<>();
    void put(long id, String tier) { tiers.put(id, tier); }
    @Override public String tierOf(long id) { return tiers.get(id); }
}

class DiscountServiceTest {
    @Test
    void goldMembersGet20Percent() {
        FakeMemberRepository repo = new FakeMemberRepository();
        repo.put(1, "gold");                                 // data visible in the test
        DiscountService svc = new DiscountService(repo);
        assertEquals(0.20, svc.discountFor(1));
    }

    @Test
    void silverMembersGet10Percent() {
        FakeMemberRepository repo = new FakeMemberRepository();
        repo.put(2, "silver");
        assertEquals(0.10, new DiscountService(repo).discountFor(2));
    }
}
```

**Why it's faster *and still correct*.** The test now exercises the discount *rule* in memory — microseconds, not 40 ms, and no running Postgres needed. The data is in the test body, not hidden in a database (no [Mystery Guest](../03-mystery-guest/junior.md)). **Coverage isn't lost**: the real SQL behind `MemberRepository` still needs *one* integration test (`@DataJpaTest` against a real DB, in the slow gate) to verify the query — but you no longer re-pay that I/O in every test that merely needs a member to exist. That's the pyramid: verify the boundary a few times, test the logic many times with a fake.

</details>

---

## Exercise 2 — Convert a sleep to an await

**Cause → Fix:** `sleep` → await · **Language:** Go · **Difficulty:** ★ easy

This test sleeps to wait for an async job. Make it return the instant the job is done, while still failing if the job genuinely hangs.

```go
// Before — pays 2s every run, and flaky if the job is slow under load.
func TestJobCompletes(t *testing.T) {
    q := NewQueue()
    job := q.Submit(work)
    time.Sleep(2 * time.Second)
    if !job.Done() {
        t.Fatal("job did not complete")
    }
}
```

**Acceptance criteria:** the test returns as soon as the job is done; a real hang still fails (with a timeout); no fixed full-duration wait.

<details>
<summary>Solution</summary>

Two options, best first.

**Option A — inject a completion signal (best when you control the job).** Block on the exact event with zero polling.

```go
// Job exposes a channel that closes on completion.
func TestJobCompletes(t *testing.T) {
    q := NewQueue()
    job := q.Submit(work)

    select {
    case <-job.DoneChan():           // returns the instant work finishes
    case <-time.After(2 * time.Second):
        t.Fatal("job did not complete within 2s")
    }
}
```

**Option B — poll the condition (when you can't see inside).**

```go
func TestJobCompletes(t *testing.T) {
    q := NewQueue()
    job := q.Submit(work)
    waitUntil(t, 2*time.Second, job.Done)
}

// waitUntil returns the moment cond() is true, or fails at the deadline.
func waitUntil(t *testing.T, timeout time.Duration, cond func() bool) {
    t.Helper()
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(5 * time.Millisecond) // cheap poll, not the whole wait
    }
    t.Fatalf("condition not met within %s", timeout)
}
```

**Why it's faster *and still correct*.** On the happy path the test returns in milliseconds (Option A: the instant the channel closes; Option B: within one 5 ms poll) instead of always paying 2 seconds. The 2-second timeout is now a *ceiling* that still fails a genuine hang — so correctness is preserved, not weakened. It's also **less flaky**: a job that takes 1.8 s on a loaded machine still passes (the old fixed `sleep(2s)` would too, but a tighter fixed sleep would have failed). The poll interval and timeout are the only tunables, and both are forgiving.

</details>

---

## Exercise 3 — Shrink an oversized fixture & combinatorics

**Cause → Fix:** Big fixture / Cartesian product → minimal data + representative cases · **Language:** Python (pytest) · **Difficulty:** ★★ medium

Two slownesses in one. The first test parses a 5 MB fixture to check one rule; the second crosses every dimension. Make both fast without losing the coverage that matters.

```python
# Before — slow setup, opaque, and a 240-case cross product.
def test_rejects_negative_price():
    catalog = load_fixture("full_catalog_5mb.json")        # ~800 ms to parse
    assert any(e for e in validate(catalog).errors if "price" in e)

@pytest.mark.parametrize("currency", ["USD", "EUR", "GBP", "JPY"])
@pytest.mark.parametrize("tier", ["gold", "silver", "none"])
@pytest.mark.parametrize("country", ["US", "UK", "DE", "FR"])
@pytest.mark.parametrize("express", [True, False])
def test_total_is_non_negative(currency, tier, country, express):
    assert total(currency, tier, country, express) >= 0   # 4*3*4*2 = 96 cases
```

**Acceptance criteria:** the first test builds only the data its assertion needs; the second covers the branches that matter without the Cartesian product; the same bugs are still caught.

<details>
<summary>Solution</summary>

```python
# After — one crafted item; the rule is obvious and the test is ~microseconds.
def test_rejects_negative_price():
    item = {"sku": "X", "price": -1}
    errors = validate_item(item).errors
    assert "price must be >= 0" in errors

# After — parametrize the branches that matter (tier drives the discount),
# fix the others to a representative value. 3 cases, not 96.
@pytest.mark.parametrize("tier,expected_min", [
    ("gold",   0.0),
    ("silver", 0.0),
    ("none",   0.0),
])
def test_total_is_non_negative_by_tier(tier, expected_min):
    assert total("USD", tier, "US", express=False) >= expected_min

# If the real goal is "non-negative for ANY input", that's a property test, not a cross-product:
from hypothesis import given, strategies as st

@given(
    currency=st.sampled_from(["USD", "EUR", "GBP", "JPY"]),
    tier=st.sampled_from(["gold", "silver", "none"]),
    country=st.sampled_from(["US", "UK", "DE", "FR"]),
    express=st.booleans(),
)
def test_total_never_negative(currency, tier, country, express):
    assert total(currency, tier, country, express) >= 0   # generated + shrunk on failure
```

**Why it's faster *and still correct*.** The first test drops from ~800 ms to microseconds by constructing the *one* item that triggers the rule instead of parsing a 5 MB file the rule never needed — and it's now readable: you can see exactly what's being validated. For the second, the 96-case cross-product mostly re-tested the *same* branches; parametrizing only the dimension that actually branches (tier) keeps the meaningful coverage at 3 cases. If you genuinely want broad input coverage of the `>= 0` invariant, **property-based testing** (`hypothesis`, the `property-based-testing` skill) is the right tool: one test, generated inputs, automatic shrinking — far more coverage than a hand-rolled cross-product, and it runs in a bounded time you control.

</details>

---

## Exercise 4 — Move per-test setup to shared, isolated setup

**Cause → Fix:** Per-test heavyweight setup → share the immutable part, isolate the mutable part · **Language:** Python (pytest) · **Difficulty:** ★★ medium

Every test boots a database container and applies migrations — seconds, ×N tests. Pay the expensive setup once *without* letting tests see each other's data.

```python
# Before — a fresh container + migrations PER TEST. ~2 s each.
def test_finds_pending_orders():
    container = start_postgres()
    apply_migrations(container)
    db = connect(container)
    db.insert_order("o-1", status="pending")
    assert len(db.find_by_status("pending")) == 1
    container.stop()

def test_finds_shipped_orders():
    container = start_postgres()
    apply_migrations(container)
    db = connect(container)
    db.insert_order("o-2", status="shipped")
    assert len(db.find_by_status("shipped")) == 1
    container.stop()
```

**Acceptance criteria:** the container + migrations are paid once for the module; each test still starts from clean data (no cross-test leakage); tests remain independent of execution order.

<details>
<summary>Solution</summary>

Share the **expensive, immutable engine** (container + schema) once; isolate the **mutable data** with a transaction that rolls back per test.

```python
import pytest

# Expensive + immutable → once per module.
@pytest.fixture(scope="module")
def engine():
    container = start_postgres()
    apply_migrations(container)          # paid ONCE for the whole module
    yield container
    container.stop()

# Cheap + mutable + per-test → a transaction that rolls back, so tests can't see each other.
@pytest.fixture
def db(engine):
    conn = connect(engine)
    tx = conn.begin()
    try:
        yield conn                       # the test runs inside the transaction
    finally:
        tx.rollback()                    # all writes vanish → next test starts clean
        conn.close()

def test_finds_pending_orders(db):
    db.insert_order("o-1", status="pending")   # data built IN the test
    assert len(db.find_by_status("pending")) == 1

def test_finds_shipped_orders(db):
    db.insert_order("o-2", status="shipped")
    assert len(db.find_by_status("shipped")) == 1
```

**Why it's faster *and still correct*.** The 2-second container boot + migrations happen **once per module** instead of once per test — for 20 tests that's ~2 s instead of ~40 s. Isolation is preserved by the **per-test transaction rollback**: each test's writes disappear before the next runs, so there's no order-coupling and no [flakiness](../02-flaky-tests/middle.md), and no shared mutable data hides as a [Mystery Guest](../03-mystery-guest/middle.md) — the data each test asserts on is created in its own body. This is the senior rule in miniature: **share the warm engine, isolate the data.**

</details>

---

## Exercise 5 — Parallelize an isolated test set

**Cause → Fix:** Serial → parallel-with-isolation · **Language:** Go · **Difficulty:** ★★★ hard

These tests run serially and each starts a server on a fixed port and writes a fixed temp file. Make them run in parallel — which first requires fixing the shared state that would otherwise race.

```go
// Before — serial; each test grabs port 8080 and writes /tmp/out.json.
func TestUploadA(t *testing.T) {
    srv := startServer(":8080")          // fixed port
    defer srv.Close()
    writeReport("/tmp/out.json", dataA)  // fixed path
    got := postFile(t, "http://localhost:8080/upload", "/tmp/out.json")
    if got != "ok-A" { t.Fatalf("got %q", got) }
}

func TestUploadB(t *testing.T) {
    srv := startServer(":8080")
    defer srv.Close()
    writeReport("/tmp/out.json", dataB)
    got := postFile(t, "http://localhost:8080/upload", "/tmp/out.json")
    if got != "ok-B" { t.Fatalf("got %q", got) }
}
```

**Acceptance criteria:** both tests call `t.Parallel()` and pass reliably when run concurrently; no fixed port and no shared file path; correctness unchanged.

<details>
<summary>Solution</summary>

Remove the two shared resources (fixed port, fixed file), *then* opt into parallelism. The order matters: parallelizing first would just expose the races as flakes.

```go
func TestUploadA(t *testing.T) {
    t.Parallel()                                   // safe ONLY after isolation below
    srv := startServer(":0")                       // :0 → OS assigns a free port
    defer srv.Close()

    path := filepath.Join(t.TempDir(), "out.json") // unique dir per test, auto-cleaned
    writeReport(path, dataA)

    got := postFile(t, srv.URL()+"/upload", path)  // use the server's actual URL
    if got != "ok-A" {
        t.Fatalf("got %q", got)
    }
}

func TestUploadB(t *testing.T) {
    t.Parallel()
    srv := startServer(":0")
    defer srv.Close()

    path := filepath.Join(t.TempDir(), "out.json")
    writeReport(path, dataB)

    got := postFile(t, srv.URL()+"/upload", path)
    if got != "ok-B" {
        t.Fatalf("got %q", got)
    }
}
```

**Why it's faster *and still correct*.** With the shared port and shared file removed, the two tests touch *no* common mutable state, so they can run concurrently and complete in the time of the *slower* one rather than the *sum*. The isolation fixes are exactly what prevents flakiness: **`:0`** lets the OS hand each server a free port (no "address already in use" race), and **`t.TempDir()`** gives each test a unique directory that Go cleans up automatically (no file-clobbering race). Note the lesson: *parallelism didn't break these tests — running them serially merely hid that they were never isolated.* The same isolation work is the cure for [Flaky Tests](../02-flaky-tests/senior.md). Run with `go test -race ./...` to confirm no data races remain.

</details>

---

## Exercise 6 — Slice a full-context test

**Cause → Fix:** Full application boot → slice · **Language:** Java (JUnit 5 / Spring) · **Difficulty:** ★★★ hard

This test boots the entire Spring application context to verify a single repository query and a single controller route. Split it into two sliced tests that each boot only the layer they exercise.

```java
// Before — full @SpringBootTest (~4 s boot) for two narrow checks.
@SpringBootTest
@AutoConfigureMockMvc
class OrderTest {
    @Autowired OrderRepository repo;
    @Autowired MockMvc mvc;

    @Test
    void repositoryFindsPendingOrders() {
        repo.save(new Order("o-1", PENDING));
        assertEquals(1, repo.findByStatus(PENDING).size());
    }

    @Test
    void controllerReturns200ForKnownOrder() throws Exception {
        // relies on a service + repo wired in the full context
        mvc.perform(get("/orders/o-1")).andExpect(status().isOk());
    }
}
```

**Acceptance criteria:** the repository test uses a persistence slice; the controller test uses a web slice with the service mocked; neither boots the full application; the same behaviors are verified.

<details>
<summary>Solution</summary>

```java
// Persistence slice — boots only JPA + a real DB (Testcontainers), not the web layer.
@DataJpaTest
@Transactional                              // per-test rollback isolation on the cached slice
class OrderRepositoryTest {
    @Autowired OrderRepository repo;

    @Test
    void findsPendingOrders() {
        repo.save(new Order("o-1", PENDING));   // data built in the test
        assertEquals(1, repo.findByStatus(PENDING).size());
    }
}

// Web slice — boots only the MVC layer; the service is mocked, so no DB at all.
@WebMvcTest(OrderController.class)
class OrderControllerTest {
    @Autowired MockMvc mvc;
    @MockBean OrderService service;             // the controller's collaborator, faked

    @Test
    void returns200ForKnownOrder() throws Exception {
        when(service.find("o-1")).thenReturn(Optional.of(new Order("o-1", PENDING)));
        mvc.perform(get("/orders/o-1")).andExpect(status().isOk());
    }
}
```

**Why it's faster *and still correct*.** Each test now boots **only the layer it exercises** — `@DataJpaTest` starts the JPA infrastructure + a database (hundreds of ms, and Spring *caches* the sliced context across tests with the same config), and `@WebMvcTest` starts only the MVC machinery with the service mocked (no DB, ~tens of ms) — instead of the full ~4 s application context. **Coverage is preserved and arguably sharpened**: the repository test verifies the *real SQL* against a real DB (so dialect bugs are caught), and the controller test verifies *routing/serialization/status* in isolation, so a failure points at exactly one layer (smaller blast radius). The repository slice still hits a real database where it matters — slicing makes that integration test cheap to keep, it doesn't fake away the boundary you meant to test.

</details>

---

## Exercise 7 — Stage the suite into fast and slow gates

**Cause → Fix:** Segregate slow tests → fast gate + slow gate · **(process)** · **Difficulty:** ★★ medium

Your suite mixes ~600 fast unit/sliced tests (≈ 12 s total, parallel) with ~40 integration/e2e tests that need Testcontainers (≈ 90 s). Right now everything runs on every push and the slow part trains people to stop running it locally. Tag the tests and design a two-stage pipeline plus local commands.

**Acceptance criteria:** the fast set runs on every push under ~60 s; the slow set runs only after the fast set is green, pre-merge; locally the default command runs only the fast set; nothing is deleted.

<details>
<summary>Solution</summary>

**1. Tag the slow tests** so they can be selected in or out.

```java
@Tag("integration")     // JUnit 5
class OrderRepositoryIT { /* Testcontainers */ }
```
```python
@pytest.mark.integration   # pytest, registered in pytest.ini markers
def test_real_db_round_trip(): ...
```
```go
//go:build integration      // Go build tag at the top of the file
package orders_test
```

**2. Local commands** — fast by default, everything on demand.

```makefile
test:        ## fast feedback — runs on every push and pre-commit
	pytest -m "not integration" -n auto      # or: go test -short ./...
test-all:    ## everything, including real-infra tests
	pytest -n auto                            # or: go test ./... -tags=integration
```

**3. Two-stage CI** — fast gate first, slow gate only if it's green.

```yaml
jobs:
  fast-gate:                         # every push
    steps:
      - run: pytest -m "not integration" -n auto   # ~12 s, the gate developers feel
  slow-gate:                         # only after fast-gate passes
    needs: fast-gate
    steps:
      - run: pytest -m integration -n 4            # Testcontainers, ~90 s, pre-merge
```

**Why it's better.** The fast gate gives sub-minute feedback on every push, so running tests stays a frictionless habit — the slow tests no longer punish the common case. The slow gate runs **only after the fast gate is green** (`needs: fast-gate`), so you never pay to boot Testcontainers on a PR a unit test already failed — saving CI minutes and queue time. Nothing is deleted: the integration coverage still runs pre-merge, guaranteeing the real boundaries before anything reaches `main`. This is the staging principle: **fast gate optimizes engineer flow; slow gate optimizes confidence** — tune each for its own job instead of forcing one global "make CI fast."

</details>

---

## The Routine — a Recap

Every exercise above runs the same loop:

```text
profile (rank by time)  →  attack the dominant cost  →  measure the delta  →  keep isolation intact
```

- **Profile first.** `pytest --durations`, `go test -json`, JUnit timing. Test time is power-law distributed — fix the top of the list, not everything.
- **Match the fix to the cause.** Real I/O → fake; `sleep` → await; per-test setup → share+isolate; serial → parallel+isolate; full boot → slice; legitimately slow → tag and stage.
- **Never buy speed with isolation.** The work that makes tests parallelizable (DB-per-worker, rollback, `:0`, `TempDir`, injected clock) is the same work that removes flakiness. They share a cure.
- **Never buy speed with coverage.** Moving a real-DB test to a fake means the real boundary gets a *separate* integration test — relocate the coverage, don't drop it.

| Fix | Cures | Exercises |
|---|---|---|
| Fake at the boundary | Real I/O in unit tests | 1 |
| Await the condition | `sleep` waiting | 2 |
| Minimal fixtures / representative cases / property tests | Big fixtures, combinatorics | 3 |
| Share immutable engine + rollback | Per-test heavy setup | 4 |
| Parallel + isolation (`:0`, `TempDir`) | Serial execution | 5 |
| Slice (`@DataJpaTest`, `@WebMvcTest`) | Full-context boot | 6 |
| Tag + stage CI | Legitimately slow tests | 7 |

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — recognize → fix → speed up a real suite → trade-offs at scale.
- [`find-bug.md`](find-bug.md) — spot *why* a test is slow without fixing it.
- [`optimize.md`](optimize.md) — the worked before/after speed-up with timing numbers.
- [Flaky Tests](../02-flaky-tests/tasks.md) — the isolation work in Exercises 4 and 5 is the same cure for flakiness.
- [Mystery Guest](../03-mystery-guest/tasks.md) — keeping shared-fixture data visible (Exercise 4).
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — system-level structures that resist change.
