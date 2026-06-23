# Flaky Tests — Find the Bug

> **Category:** [Testing Anti-Patterns](../README.md) → **Flaky Tests** — *the same test, on the same code, passes sometimes and fails sometimes.*
> **Also known as:** non-deterministic tests · intermittent tests · heisentests

---

This file is **diagnostic practice**. Each snippet below is a plausible test (or a test-plus-production pair) that is **flaky** — it passes sometimes and fails sometimes on unchanged code. Your job is to read it like a reviewer hunting non-determinism and answer three questions:

> **What is the source of non-determinism? What concrete failure does it produce? How do you make it deterministic?**

The source is always one (or more) of the seven from [`middle.md`](middle.md): timing, async race, shared state, randomness, real clock, external dependency, ordering. The skill is *naming which one* on sight — because the cure follows directly from the cause.

> **How to use this file:** read each snippet, write your own answer *before* expanding the collapsible. Some snippets look perfectly innocent and would pass a casual review; the flake lives in an *uncontrolled input*, not a syntax error.

---

## Table of Contents

1. [The async wait that guesses](#snippet-1--the-async-wait-that-guesses)
2. [The token that expires too soon](#snippet-2--the-token-that-expires-too-soon)
3. [The two tests that hate each other](#snippet-3--the-two-tests-that-hate-each-other)
4. [The order that came back wrong](#snippet-4--the-order-that-came-back-wrong)
5. [The price from the internet](#snippet-5--the-price-from-the-internet)
6. [The counter that lost count](#snippet-6--the-counter-that-lost-count)
7. [The random sample that sometimes breaks](#snippet-7--the-random-sample-that-sometimes-breaks)
8. [The "today" report](#snippet-8--the-today-report)

---

## Snippet 1 — The async wait that guesses

```go
// Go — a test for an event bus that delivers on a background goroutine.
func TestPublish_Delivers(t *testing.T) {
    bus := NewBus()
    var received string
    bus.Subscribe("topic", func(msg string) { received = msg })

    bus.Publish("topic", "hello")     // delivered asynchronously
    time.Sleep(10 * time.Millisecond) // give it "time to arrive"

    if received != "hello" {
        t.Fatalf("got %q", received)
    }
}
```

> What is the source of non-determinism? What concrete failure does it produce? How do you make it deterministic?

<details>
<summary>Answer</summary>

**Source: timing** (a `sleep`-based wait racing async delivery) — *plus* a latent **data race**, since `received` is written on the bus goroutine and read on the test goroutine with no synchronization.

**Failure:** `10ms` is a guess that delivery completes within 10ms. On a loaded CI box the goroutine isn't scheduled in time → `received` is still `""` → fail. Even when it "passes," the unsynchronized read/write is undefined behavior (`go test -race` flags it).

**Fix — synchronize on the actual delivery, don't sleep.** Use a channel the handler sends on:

```go
func TestPublish_Delivers(t *testing.T) {
    bus := NewBus()
    got := make(chan string, 1)
    bus.Subscribe("topic", func(msg string) { got <- msg })   // signal, not shared var

    bus.Publish("topic", "hello")

    select {
    case msg := <-got:
        require.Equal(t, "hello", msg)
    case <-time.After(2 * time.Second):
        t.Fatal("message never delivered")
    }
}
```

The test now blocks until delivery actually happens (fast), fails cleanly only if it *never* does, and has no shared-memory race.

</details>

---

## Snippet 2 — The token that expires too soon

```python
# Python — production reads the wall clock; the test waits real time.
class AuthToken:
    def __init__(self, ttl_seconds):
        self.expires_at = time.time() + ttl_seconds

    def valid(self):
        return time.time() < self.expires_at

def test_token_validity():
    token = AuthToken(ttl_seconds=2)
    assert token.valid()
    time.sleep(2)
    assert not token.valid()
```

> What is the source of non-determinism? What concrete failure does it produce? How do you make it deterministic?

<details>
<summary>Answer</summary>

**Source: the real clock** (production calls `time.time()`; the test races a real `sleep` against a real TTL).

**Failure:** the `sleep(2)` and the 2-second TTL race each other at the boundary. If the OS sleeps a hair under 2s, or scheduling delays the `valid()` call, the assertion lands on the wrong side of the boundary → intermittent fail. It's also *slow* (a real 2-second wait per run).

**Fix — inject the clock; control time in the test.**

```python
class AuthToken:
    def __init__(self, ttl_seconds, clock):
        self.clock = clock
        self.expires_at = clock.now() + ttl_seconds
    def valid(self):
        return self.clock.now() < self.expires_at

class FakeClock:
    def __init__(self, t=0.0): self.t = t
    def now(self): return self.t
    def advance(self, dt): self.t += dt

def test_token_validity():
    clock = FakeClock()
    token = AuthToken(ttl_seconds=2, clock=clock)
    assert token.valid()
    clock.advance(2)                 # exactly at boundary; "<" → invalid
    assert not token.valid()         # deterministic, instant, exact
```

No real waiting, no boundary race — the test owns time.

</details>

---

## Snippet 3 — The two tests that hate each other

```python
# Python — a module-level cache, plus two tests that share it.
_user_cache = {}

def get_user(uid):
    if uid not in _user_cache:
        _user_cache[uid] = db.load(uid)
    return _user_cache[uid]

def test_loads_from_db(mocker):
    spy = mocker.patch("mod.db.load", return_value=User(1, "Ada"))
    assert get_user(1).name == "Ada"
    spy.assert_called_once()             # expects exactly one DB load

def test_returns_cached(mocker):
    spy = mocker.patch("mod.db.load", return_value=User(1, "Ada"))
    get_user(1)
    get_user(1)
    assert spy.call_count == 1           # expects the cache to serve the 2nd call
```

> What is the source of non-determinism? What concrete failure does it produce? How do you make it deterministic?

<details>
<summary>Answer</summary>

**Source: shared mutable state / test-order dependence** — the module-level `_user_cache` persists across tests.

**Failure:** if `test_returns_cached` runs *first*, it populates `_user_cache[1]`. Then `test_loads_from_db` runs, `get_user(1)` hits the cache, `db.load` is **never called**, and `spy.assert_called_once()` fails (0 calls). Reverse the order and both pass. Under randomized order (pytest-randomly), it's flaky. Each test "looks fine" alone — the bug is the leaked global.

**Fix — reset the shared cache between tests** (and ideally stop using a module global):

```python
import pytest

@pytest.fixture(autouse=True)
def clear_cache():
    _user_cache.clear()                  # fresh cache for every test
    yield
    _user_cache.clear()
```

Better still, make the cache an injected object constructed per test, so there's no global to leak. Verify with `pytest -p randomly` — green in every order.

</details>

---

## Snippet 4 — The order that came back wrong

```java
// Java (JUnit 5) — verifying which permissions a role grants.
@Test
void editorPermissions() {
    Set<String> perms = roleService.permissionsFor("editor");   // backed by a HashSet
    assertEquals(List.of("read", "write", "comment"),
                 new ArrayList<>(perms));                        // order from the set
}
```

> What is the source of non-determinism? What concrete failure does it produce? How do you make it deterministic?

<details>
<summary>Answer</summary>

**Source: ordering assumption** — `perms` is a `HashSet`, whose iteration order is unspecified, but the test asserts a specific *ordered* `List`.

**Failure:** `new ArrayList<>(perms)` yields the elements in `HashSet` iteration order, which depends on hash codes and capacity and is *not* `["read","write","comment"]` in general. The test passes only when the set happens to iterate in that order — flaky across JVM versions, element sets, and `-XX` flags. (It can also flip if a string is added/removed elsewhere, changing the set's internal layout.)

**Fix — assert membership, not order.**

```java
@Test
void editorPermissions() {
    Set<String> perms = roleService.permissionsFor("editor");
    assertEquals(Set.of("read", "write", "comment"), perms);   // set equality: order-free
    // or: assertThat(perms).containsExactlyInAnyOrder("read", "write", "comment");
}
```

Compare as a set (the real intent — *these three permissions*), or sort both sides before comparing. Don't assert an order the producer never promised.

</details>

---

## Snippet 5 — The price from the internet

```go
// Go — a test for the pricing client.
func TestGetPrice(t *testing.T) {
    client := NewPriceClient("https://api.exchange.example/v1")  // real endpoint
    price, err := client.GetPrice("BTC")
    require.NoError(t, err)
    require.Greater(t, price, 0.0)
}
```

> What is the source of non-determinism? What concrete failure does it produce? How do you make it deterministic?

<details>
<summary>Answer</summary>

**Source: external dependency** — the test hits a real, remote HTTP API over the network.

**Failure:** every non-deterministic property of the outside world becomes a flake: a DNS hiccup, a rate-limit (429), a 200ms latency spike past the client timeout, the API being briefly down during *their* deploy, or simply running CI offline. None of these are bugs in *your* code, yet they turn the build red intermittently. It's also slow.

**Fix — fake the boundary with an in-process server returning a fixed response.**

```go
func TestGetPrice(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(
        func(w http.ResponseWriter, r *http.Request) {
            require.Equal(t, "/v1/price/BTC", r.URL.Path)   // assert the request too
            fmt.Fprint(w, `{"price": 42000.0}`)             // fixed, instant
        }))
    defer srv.Close()

    client := NewPriceClient(srv.URL + "/v1")
    price, err := client.GetPrice("BTC")
    require.NoError(t, err)
    require.Equal(t, 42000.0, price)        // exact and repeatable
}
```

No network, no latency, no flake — and you can now assert *exactly* what the client sends and how it parses the response. Keep any genuine live-API check in a separate, clearly-labeled integration test.

</details>

---

## Snippet 6 — The counter that lost count

```go
// Go — test for a metrics counter incremented from many goroutines.
func TestCounter_Concurrent(t *testing.T) {
    c := &Counter{}
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Inc()              // c.value++  (plain int, no synchronization)
        }()
    }
    wg.Wait()
    require.Equal(t, 1000, c.value)   // sometimes 994, 997, 1000...
}
```

> What is the source of non-determinism? What concrete failure does it produce? How do you make it deterministic — *and where is the real bug*?

<details>
<summary>Answer</summary>

**Source: an async race — but the race is in the *production* code, not the test.** This is the important case from `professional.md`: a flaky test that is a **correct report of a real bug**.

**Failure:** `c.Inc()` does `c.value++`, a non-atomic read-modify-write. 1000 goroutines racing it lose updates (two read 500, both write 501), so `c.value` ends up *below* 1000 intermittently. The test correctly synchronizes (`wg.Wait()` guarantees all goroutines finished) yet still flakes — because the bug is the data race in `Inc`.

**Do NOT "fix" the test** by sleeping, retrying, or asserting `>= 990`. That hides a real data-loss bug (undefined behavior that worsens under different CPUs/load). **Make the race deterministic and fix production:**

```go
// Surface it deterministically:  go test -race  → "DATA RACE" every run.

// Fix the PRODUCTION code:
type Counter struct{ value int64 }
func (c *Counter) Inc()       { atomic.AddInt64(&c.value, 1) }
func (c *Counter) Value() int64 { return atomic.LoadInt64(&c.value) }
```

Now the test passes deterministically *because the code is correct*. The flaky test did its job: it found a concurrency bug.

</details>

---

## Snippet 7 — The random sample that sometimes breaks

```python
# Python — testing a percentile function on random data.
def test_p95_is_within_range():
    data = [random.random() for _ in range(1000)]   # fresh random data each run
    p95 = percentile(data, 95)
    assert 0.90 <= p95 <= 1.0                        # "should usually be high"
```

> What is the source of non-determinism? What concrete failure does it produce? How do you make it deterministic?

<details>
<summary>Answer</summary>

**Source: unseeded randomness** — the input is fresh random data every run, *and* the assertion encodes a probabilistic assumption about it.

**Failure:** the p95 of 1000 uniform(0,1) samples is *usually* near 0.95, but it varies run to run; occasionally it dips below 0.90 (or the assumption is just statistically wrong for some draws) → intermittent fail you can't reproduce, because next run draws different data.

**Fix — pick the right cure for the intent:**

- If you're testing the **percentile algorithm**, use *fixed, known* input and assert the exact answer — no randomness at all:
  ```python
  def test_p95_exact():
      data = list(range(1, 101))          # 1..100, known distribution
      assert percentile(data, 95) == 95   # deterministic, exact
  ```
- If you genuinely want randomized inputs (property-style), **seed a local RNG** so failures reproduce, and assert a *true invariant* (e.g. `min(data) <= p95 <= max(data)`), not a probabilistic guess:
  ```python
  def test_p95_invariant():
      rng = random.Random(42)             # seeded → reproducible
      data = [rng.random() for _ in range(1000)]
      p = percentile(data, 95)
      assert min(data) <= p <= max(data)  # always true, never flaky
  ```

The flake came from *unseeded* randomness combined with a *probabilistic* assertion. Seed it, and assert what's actually invariant.

</details>

---

## Snippet 8 — The "today" report

```java
// Java — a report that filters records "from this month".
List<Record> thisMonth(List<Record> all) {
    YearMonth now = YearMonth.now();                 // reads the real clock
    return all.stream()
              .filter(r -> YearMonth.from(r.date()).equals(now))
              .collect(toList());
}

@Test
void filtersCurrentMonth() {
    var records = List.of(
        new Record(LocalDate.now()),                 // "this month" — usually
        new Record(LocalDate.now().minusMonths(2)));
    assertEquals(1, thisMonth(records).size());
}
```

> What is the source of non-determinism? What concrete failure does it produce? How do you make it deterministic?

<details>
<summary>Answer</summary>

**Source: the real clock / date boundary.** Both production (`YearMonth.now()`) and the test (`LocalDate.now()`) read the real calendar.

**Failure:** the test silently assumes the two `LocalDate.now()` calls land in the *same* month as `YearMonth.now()`. Run the test at **23:59:59 on the last day of the month** and the clock can roll over between the calls, putting the "current" record in a different month → the filter returns 0 → fail. It's a once-a-month, time-of-day flake nobody can reproduce on demand.

**Fix — inject a `Clock`; build test data relative to a *fixed* date.**

```java
List<Record> thisMonth(List<Record> all, Clock clock) {
    YearMonth now = YearMonth.now(clock);            // controllable
    return all.stream()
              .filter(r -> YearMonth.from(r.date()).equals(now))
              .collect(toList());
}

@Test
void filtersCurrentMonth() {
    Clock clock = Clock.fixed(Instant.parse("2026-06-15T12:00:00Z"), ZoneOffset.UTC);
    LocalDate today = LocalDate.now(clock);          // fixed: 2026-06-15
    var records = List.of(
        new Record(today),                           // June 2026
        new Record(today.minusMonths(2)));           // April 2026
    assertEquals(1, thisMonth(records, clock).size());   // deterministic, any time of day
}
```

With a fixed clock there's no month boundary to fall across — the test gives the same answer at any moment, including midnight on the 31st.

</details>

---

## Summary — patterns of spotting

You diagnose a flake by asking *"what uncontrolled input does this test's result secretly depend on?"* The repeatable tells from these eight snippets:

- **A `sleep` before an assertion** is almost always a timing flake racing async work (Snippet 1). Replace it with a condition wait or a synchronization signal — and check for an accompanying data race on the shared variable.
- **A real `sleep`/TTL pair, or `now()`/`today`/`YearMonth.now()`** is a clock flake — fails at boundaries (midnight, month-end, DST, CI's timezone) (Snippets 2, 8). Inject a clock.
- **Two tests that pass in one order and fail in the other** is shared mutable state — a module global, static field, or unreset cache (Snippet 3). Reset in teardown, or stop sharing.
- **Asserting an *ordered* result from a set/map/dict** is an ordering flake (Snippet 4). Compare as a set, or sort first — the producer never promised order.
- **A real network/DB/filesystem call in a unit test** inherits the outside world's non-determinism (Snippet 5). Fake the boundary.
- **A flaky concurrency test may be reporting a real production race** (Snippet 6) — don't stabilize the test; run under `-race` and fix the code. The flake is a true bug report.
- **Unseeded randomness plus a probabilistic assertion** is irreproducible by construction (Snippet 7). Seed a local RNG and assert a real invariant — or use fixed known input.

The meta-lesson: a flaky test is never "just flaky." It depends on an input it should control — and sometimes (Snippet 6) it's correctly reporting that the *system* is the non-deterministic one. Name the input, then either control it (fix the test) or fix the code it's exposing.

---

## Related Topics

- [`junior.md`](junior.md) — the seven sources of non-determinism, defined.
- [`middle.md`](middle.md) — the worked cure for each source.
- [`tasks.md`](tasks.md) — fix these same flakes hands-on, end to end.
- [`professional.md`](professional.md) — Snippet 6's deeper lesson: when the flaky test means the *system* is flaky.
- [Concurrency Anti-Patterns → Shared State](../../03-concurrency/03-shared-state/senior.md) — the production races behind Snippets 1 and 6.
- [Testing Anti-Patterns → Mystery Guest](../03-mystery-guest/find-bug.md) — hidden shared fixtures, a common cause of Snippet 3's order-dependence.
