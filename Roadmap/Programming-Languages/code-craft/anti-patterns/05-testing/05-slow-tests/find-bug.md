# Slow Tests — Find the Bug

> **Category:** [Testing Anti-Patterns](../README.md) → **Slow Tests** — *a suite so slow the team stops running it before pushing.*

---

This file is **critical-reading practice for test speed.** Each snippet is a plausible test (or fixture) in Go, Java, or Python that passes and looks reasonable — but is **needlessly slow**, and the slowness will compound across a suite until nobody runs it. Read each the way a reviewer who cares about feedback time would, and answer three questions:

> **Where is the time going? Why is it slow (which cause)? How would you make it fast without losing coverage or gaining flakiness?**

The "bug" here is rarely a crash — it's a *cost*. A 2-second test sails through review because it's green; the problem only appears multiplied across the suite. Train your eye to see the I/O, the sleep, the per-test boot, the giant fixture *before* it becomes 40 minutes of CI.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill is noticing the cost, not recalling the name.

---

## Table of Contents

1. [The thorough little unit test](#snippet-1--the-thorough-little-unit-test)
2. [Waiting for the worker](#snippet-2--waiting-for-the-worker)
3. [A fresh start every time](#snippet-3--a-fresh-start-every-time)
4. [The realistic fixture](#snippet-4--the-realistic-fixture)
5. [The thorough parametrization](#snippet-5--the-thorough-parametrization)
6. [The end-to-end calculator](#snippet-6--the-end-to-end-calculator)
7. [The shared speed-up that went wrong](#snippet-7--the-shared-speed-up-that-went-wrong)
8. [The retry that sleeps](#snippet-8--the-retry-that-sleeps)

---

## Snippet 1 — The thorough little unit test

```python
# Python — a unit test for a caching rule
import redis

def test_cache_returns_stored_value():
    r = redis.Redis(host="localhost", port=6379)   # real Redis
    cache = TtlCache(r)
    cache.set("k", "v", ttl=60)
    assert cache.get("k") == "v"
    r.flushdb()
```

<details>
<summary>Answer</summary>

**Where the time goes:** a real Redis round-trip per `set`/`get`/`flushdb` — milliseconds each, plus a network connection. **Cause:** *real I/O in a unit test.* The rule under test ("a stored value comes back") is pure logic; Redis is just where it happens to live.

**Fix:** fake the cache backend with an in-memory map implementing the small interface `TtlCache` uses (`set`/`get`), and inject it. The test drops to microseconds and needs no running Redis:

```python
class FakeKV:
    def __init__(self): self._d = {}
    def set(self, k, v, ttl=None): self._d[k] = v
    def get(self, k): return self._d.get(k)

def test_cache_returns_stored_value():
    cache = TtlCache(FakeKV())
    cache.set("k", "v", ttl=60)
    assert cache.get("k") == "v"
```

**Coverage isn't lost:** the *real* Redis adapter (and TTL-expiry behavior, which a naive fake won't model) gets one focused integration test in the slow gate. Don't re-pay Redis I/O in every test that just needs a value to be present.

</details>

---

## Snippet 2 — Waiting for the worker

```go
// Go — verifying an async email send
func TestSignupSendsEmail(t *testing.T) {
    svc := NewSignupService(mailer)
    svc.Signup("a@b.com")
    time.Sleep(3 * time.Second) // give the worker time
    if !mailer.Sent("a@b.com") {
        t.Fatal("no email sent")
    }
}
```

<details>
<summary>Answer</summary>

**Where the time goes:** a flat 3 seconds, every run, even when the email is sent in 2 ms. **Cause:** *`sleep`-based waiting.* It's also latently **flaky** — under load the worker might exceed 3 s and the test fails for no real reason (this is why the same snippet would fit [Flaky Tests](../02-flaky-tests/find-bug.md)).

**Fix:** await the condition with a timeout ceiling — returns the instant the email is sent, still fails a real hang:

```go
func TestSignupSendsEmail(t *testing.T) {
    svc := NewSignupService(mailer)
    svc.Signup("a@b.com")

    deadline := time.Now().Add(3 * time.Second)
    for time.Now().Before(deadline) {
        if mailer.Sent("a@b.com") {
            return // success — milliseconds, not 3 seconds
        }
        time.Sleep(5 * time.Millisecond)
    }
    t.Fatal("no email sent within 3s")
}
```

Better still, if `mailer` can expose a completion channel, `select` on it and drop polling entirely.

</details>

---

## Snippet 3 — A fresh start every time

```java
// Java (JUnit 5) — repository tests
class OrderRepositoryTest {
    private ApplicationContext ctx;

    @BeforeEach
    void setUp() {
        ctx = SpringApplication.run(Application.class);   // boots the whole app
    }

    @Test void findsPending()  { /* uses ctx.getBean(...) */ }
    @Test void findsShipped()  { /* uses ctx.getBean(...) */ }
    @Test void findsCancelled(){ /* uses ctx.getBean(...) */ }
}
```

<details>
<summary>Answer</summary>

**Where the time goes:** the **entire Spring application context boots in `@BeforeEach`** — once *per test method*. At ~4 s a boot × 3 tests that's ~12 s of pure setup, and it grows linearly with every test added. **Cause:** *per-test heavyweight setup,* compounded by *no slicing* (booting the whole app to test one repository).

**Fix (both moves):** **slice** to `@DataJpaTest` so only the JPA layer + a DB start, and let Spring **cache** the sliced context across tests instead of re-booting it — never boot a context in `@BeforeEach`:

```java
@DataJpaTest
@Transactional                         // per-test rollback keeps tests isolated on the cached context
class OrderRepositoryTest {
    @Autowired OrderRepository repo;
    @Test void findsPending()   { /* ... */ }
    @Test void findsShipped()   { /* ... */ }
    @Test void findsCancelled() { /* ... */ }
}
```

Boots drop from O(tests) to one cached slice; the real SQL is still verified.

</details>

---

## Snippet 4 — The realistic fixture

```python
# Python — validating a discount rule
def test_gold_members_get_discount():
    db = load_production_snapshot("prod_dump_2024.sql")   # 1.2 GB, ~25 s to import
    members = MemberService(db)
    gold = members.find_one(tier="gold")
    assert members.discount_for(gold.id) == 0.20
```

<details>
<summary>Answer</summary>

**Where the time goes:** importing a **1.2 GB production snapshot** (~25 s) to find *one* gold member. **Cause:** *oversized fixture* (and a real DB import). The test also has a hidden [Mystery Guest](../03-mystery-guest/find-bug.md): which gold member `find_one` returns depends on opaque dump data, so the test is both slow *and* unclear.

**Fix:** build the *one* member the assertion needs, in memory, against a fake — microseconds, and self-explanatory:

```python
def test_gold_members_get_discount():
    members = MemberService(FakeMembers({1: "gold"}))
    assert members.discount_for(1) == 0.20
```

The realism of a production snapshot belongs (if anywhere) in a *deliberate* data-shape or migration test, not in a unit test of a discount rule. A unit test's realism is its logic coverage, not its data volume.

</details>

---

## Snippet 5 — The thorough parametrization

```python
# Python — "covering all the cases"
@pytest.mark.parametrize("year",  range(2000, 2025))   # 25
@pytest.mark.parametrize("month", range(1, 13))        # 12
@pytest.mark.parametrize("day",   range(1, 29))        # 28
def test_is_weekday_runs(year, month, day):
    # 25 * 12 * 28 = 8400 cases
    assert is_weekday(year, month, day) in (True, False)
```

<details>
<summary>Answer</summary>

**Where the time goes:** **8,400 generated cases** for a function whose behavior depends only on day-of-week, and an assertion (`in (True, False)`) that **proves nothing** — every boolean satisfies it. **Cause:** *combinatorial explosion,* made worse by a vacuous assertion. It's slow and tests nothing.

**Fix:** test the *meaningful* cases with *real* expected values — one per branch and the boundaries:

```python
@pytest.mark.parametrize("date,expected", [
    ((2024, 6, 7),  True),   # a known Friday
    ((2024, 6, 8),  False),  # a known Saturday
    ((2024, 6, 9),  False),  # a known Sunday
    ((2024, 6, 10), True),   # a known Monday
])
def test_is_weekday(date, expected):
    assert is_weekday(*date) is expected
```

Four real assertions catch bugs the 8,400 vacuous ones never could. If you want broad input coverage of an *invariant*, that's property-based testing — but you still need a real property, not `in (True, False)`.

</details>

---

## Snippet 6 — The end-to-end calculator

```java
// Java — testing a tax calculation through the HTTP API
@SpringBootTest(webEnvironment = RANDOM_PORT)
class TaxTest {
    @Autowired TestRestTemplate rest;

    @Test
    void taxIsEightPercent() {
        var resp = rest.postForObject("/checkout",
            new Cart(List.of(new Line("sku-1", 100))), Receipt.class);   // full stack + DB
        assertEquals(8.0, resp.tax());
    }
}
```

<details>
<summary>Answer</summary>

**Where the time goes:** a **full application boot + real HTTP round-trip + database** to verify a pure arithmetic rule (`tax == 8%`). **Cause:** *inverted pyramid* — an end-to-end test doing the job of a unit test. The tax rule is `subtotal * 0.08`; none of HTTP, persistence, or wiring is relevant to it.

**Fix:** test the rule where it lives — a plain unit test on the tax function — and keep e2e for genuine *journeys*:

```java
class TaxCalculatorTest {
    @Test
    void taxIsEightPercent() {
        assertEquals(8.0, new TaxCalculator().tax(100.0));   // microseconds, no boot
    }
}
```

Push the rule **down** to the cheapest layer that catches its bug. Reserve one e2e `/checkout` test for "a purchase completes through the whole stack," not for re-checking the tax percentage.

</details>

---

## Snippet 7 — The shared speed-up that went wrong

```python
# Python — someone made the DB tests "fast" by sharing one connection
@pytest.fixture(scope="session")
def db():
    conn = connect(start_postgres())
    apply_migrations(conn)
    yield conn                     # shared across ALL tests, no cleanup
    conn.close()

def test_count_starts_at_zero(db):
    assert db.count_orders() == 0          # passes... sometimes

def test_insert_increments_count(db):
    db.insert_order("o-1")
    assert db.count_orders() == 1
```

<details>
<summary>Answer</summary>

**The trap:** this *looks* like the right speed fix — share the expensive container once (`scope="session"`). But it shares **mutable data** too: `test_insert_increments_count` leaves a row behind, so `test_count_starts_at_zero` sees count 1 if it runs *after* it. **Cause:** a per-test-setup fix that traded slowness for **order-coupling** → [flakiness](../02-flaky-tests/find-bug.md). It's fast and *wrong*.

**Fix:** share the **immutable engine** but isolate the **mutable data** with per-test rollback (the senior rule: *share the warm engine, isolate the data*):

```python
@pytest.fixture(scope="session")
def engine():                       # expensive + immutable → once
    conn = connect(start_postgres())
    apply_migrations(conn)
    yield conn
    conn.close()

@pytest.fixture
def db(engine):                     # mutable → per test, rolled back
    tx = engine.begin()
    try:
        yield engine
    finally:
        tx.rollback()               # each test starts clean → no order-coupling

def test_count_starts_at_zero(db):     assert db.count_orders() == 0
def test_insert_increments_count(db):
    db.insert_order("o-1")
    assert db.count_orders() == 1
```

Now it's fast **and** isolated — speed without flakiness.

</details>

---

## Snippet 8 — The retry that sleeps

```go
// Go — testing retry-with-backoff against a flaky dependency
func TestRetriesThreeTimes(t *testing.T) {
    dep := &flakyDep{failTimes: 2}            // fails twice, then succeeds
    client := NewClient(dep, WithBackoff(time.Second)) // 1s, 2s real backoff
    err := client.Call()                       // sleeps ~3s total during real backoff
    if err != nil {
        t.Fatalf("expected success, got %v", err)
    }
}
```

<details>
<summary>Answer</summary>

**Where the time goes:** the retry uses **real wall-clock backoff** (1 s + 2 s), so the test sleeps ~3 s inside `client.Call()`. **Cause:** *real time in a test* — a disguised `sleep`, hidden in the production backoff. Correct, but slow on every run.

**Fix:** **inject the clock / sleeper** so the test controls time, advancing it instantly instead of waiting:

```go
// Production: the client sleeps via an injected interface, not time.Sleep directly.
type sleeper interface{ Sleep(d time.Duration) }

func TestRetriesThreeTimes(t *testing.T) {
    dep := &flakyDep{failTimes: 2}
    fake := &fakeSleeper{}                      // records durations, returns instantly
    client := NewClient(dep, WithBackoff(time.Second), WithSleeper(fake))

    err := client.Call()                        // no real waiting — microseconds
    if err != nil {
        t.Fatalf("expected success, got %v", err)
    }
    if got := len(fake.slept); got != 2 {       // and we can assert the backoff happened
        t.Fatalf("expected 2 backoff sleeps, got %d", got)
    }
}
```

Injecting the clock makes the test fast **and** lets it *assert on the backoff schedule* — more coverage, not less. This is the same control-the-clock technique that cures time-based [Flaky Tests](../02-flaky-tests/senior.md).

</details>

---

## What to Train Your Eye On

| You see… | Suspect | Fix |
|---|---|---|
| `connect(...)`, `redis.Redis(...)`, `requests.post(real-url)` in a unit test | real I/O | fake the boundary; integration-test the real adapter |
| `sleep` / `Thread.sleep` / `time.After` waiting | fixed wait | await the condition; inject a signal |
| context/container/app boot in `@BeforeEach`/per test | per-test heavy setup | share immutable engine; rollback per test |
| `@SpringBootTest` for one query/route | no slicing | `@DataJpaTest` / `@WebMvcTest` |
| a giant fixture/snapshot loaded | oversized fixture | build the minimal data the assertion needs |
| nested/triple `parametrize`, 100s of cases | combinatorial explosion | representative/boundary cases; property test |
| e2e/HTTP test asserting a calculation | inverted pyramid | push the rule down to a unit test |
| `scope="session"` fixture with mutable writes | shared mutable state | share engine, isolate data (rollback/unique keys) |
| real backoff/retry/`time` in production path | disguised sleep | inject the clock/sleeper |

> **The reviewer's reflex:** when a test does I/O, waits on the clock, or boots the world, ask *"what is this test actually verifying, and what's the cheapest layer that catches that bug?"* The answer is almost always faster — and the speed-up should never cost coverage or isolation.

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — the progression behind every fix here.
- [`tasks.md`](tasks.md) — fix these patterns yourself, with solutions.
- [`optimize.md`](optimize.md) — a full slow suite profiled and sped up with timing numbers.
- [Flaky Tests](../02-flaky-tests/find-bug.md) — sleeps, shared state, and real time cause both slowness and flakiness.
- [Mystery Guest](../03-mystery-guest/find-bug.md) — giant fixtures and shared data hide test inputs *and* slow tests down.
- [Over-Mocking](../06-over-mocking/find-bug.md) — the opposite hazard when faking goes too far.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — system structures that resist change.
