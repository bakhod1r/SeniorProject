# The Three Laws of TDD — Optimization Drills

> **Category:** [Craftsmanship Disciplines](../README.md) — write production code only to make a failing test pass, in the tightest possible loop.

10 drills to sharpen your TDD loop and your test suite. The optimization target here is the **feedback loop** — keeping the nano-cycle in seconds, keeping the suite fast, trustworthy, and non-brittle. A slow or brittle suite makes the three laws impossible to follow, so optimizing the suite *is* optimizing TDD.

---

## Table of Contents

1. [Drill 1: Make a Slow Test Suite Fast](#drill-1-make-a-slow-test-suite-fast)
2. [Drill 2: Remove a Brittle Implementation-Coupled Test](#drill-2-remove-a-brittle-test)
3. [Drill 3: De-Mock Toward Sociable Tests](#drill-3-de-mock-toward-sociable-tests)
4. [Drill 4: Tighten the Cycle (Smaller Steps)](#drill-4-tighten-the-cycle)
5. [Drill 5: Replace a Real Boundary with a Fast Fake](#drill-5-replace-a-real-boundary-with-a-fast-fake)
6. [Drill 6: Collapse Triangulated Tests into a Table](#drill-6-collapse-triangulated-tests-into-a-table)
7. [Drill 7: Kill a Flaky Test](#drill-7-kill-a-flaky-test)
8. [Drill 8: Add the Missing Assertion (Coverage → Verification)](#drill-8-add-the-missing-assertion)
9. [Drill 9: Re-Tier — Move Slow Tests Out of the Unit Suite](#drill-9-re-tier)
10. [Drill 10: Parallelize and Isolate](#drill-10-parallelize-and-isolate)
11. [Optimization Tips](#optimization-tips)
12. [Summary](#summary)

---

## Drill 1: Make a Slow Test Suite Fast

### Before — every test spins up the whole application context

```java
@SpringBootTest                          // boots the FULL context: DB, web, beans
class DiscountTest {
    @Autowired DiscountCalculator calc;  // ~4s startup PER test class
    @Test void goldTierGetsTenPercent() {
        assertThat(calc.forOrder(goldOrder)).isEqualTo(money(10));
    }
}
```

### After — test the pure logic with a plain object, no framework

```java
class DiscountTest {
    DiscountCalculator calc = new DiscountCalculator();   // microseconds
    @Test void goldTierGetsTenPercent() {
        assertThat(calc.forOrder(goldOrder)).isEqualTo(money(10));
    }
}
```

**Gain:** A real win — the per-class 4-second context boot disappears. `DiscountCalculator` is pure logic; it needs no Spring context. **Reserve `@SpringBootTest` for the handful of integration tests that genuinely wire components.** A unit suite that boots a framework per test cannot sustain a seconds-long nano-cycle.

---

## Drill 2: Remove a Brittle Test

### Before — asserts the call sequence; breaks on any refactor

```java
@Test void processesPayment() {
    new Checkout(gateway, ledger).pay(order);
    InOrder inOrder = inOrder(gateway, ledger);
    inOrder.verify(gateway).authorize(any());
    inOrder.verify(gateway).capture(any());      // couples to exact internal steps
    inOrder.verify(ledger).record(any());
}
```

### After — assert the observable outcome

```java
@Test void successfulPaymentIsRecordedAsPaid() {
    var ledger = new InMemoryLedger();
    new Checkout(new FakeGateway(SUCCESS), ledger).pay(order);
    assertThat(ledger.entryFor(order).status()).isEqualTo(PAID);  // outcome, not steps
}
```

**Gain:** The test now survives any behavior-preserving refactor (merging authorize+capture, reordering internal calls). Brittle interaction tests turn the suite into an anchor that punishes refactoring — the opposite of what TDD is for. Assert *what* happened, not *how*.

---

## Drill 3: De-Mock Toward Sociable Tests

### Before — three mocks for collaborators that are fast and pure

```python
def test_total():
    tax = Mock(); tax.compute.return_value = 8
    disc = Mock(); disc.compute.return_value = 5
    fmt = Mock(); fmt.render.side_effect = lambda x: f"${x}"
    cart = Cart(tax, disc, fmt)
    assert cart.total_str(100) == "$103"   # really just testing the mock wiring
```

### After — use the real, fast collaborators (classicist / sociable)

```python
def test_total():
    cart = Cart(TaxRule(0.08), PercentDiscount(0.05), MoneyFormatter())
    assert cart.total_str(100) == "$103"   # exercises the real computation
```

**Gain:** The mocked version tested that you wired mocks correctly; the sociable version tests the *actual arithmetic* end-to-end through real, fast objects. Fewer mocks means fewer false greens and a test that catches real bugs in `TaxRule`/`PercentDiscount`. Mock only slow/external/non-deterministic boundaries — not pure value logic. See [Senior](senior.md) on classicist vs mockist.

---

## Drill 4: Tighten the Cycle

### Before — one giant leap (red to green took 25 minutes of debugging)

```text
Test list (attempted in one step):
  [ ] parse a full config file with sections, comments, includes, and overrides
→ wrote 80 lines, ran, 6 failures, no idea which part is wrong, 25 min debugging
```

### After — decompose into nano-sized steps

```text
Test list (one failing test at a time):
  [ ] empty input -> empty config
  [ ] single "k=v" -> {k: v}
  [ ] comment line ignored
  [ ] two keys
  [ ] [section] prefixes keys
  [ ] include directive merges another file
→ each step: 2-5 lines, red→green in <60s, failures localized to the last step
```

**Gain:** No runtime change, but a massive **loop** improvement — debugging drops from 25 minutes to seconds because every failure is caused by the last 2–5 lines. The three laws *force* this; the optimization is recognizing when your step was too big and breaking it down. Big steps are the #1 reason TDD "feels slow."

---

## Drill 5: Replace a Real Boundary with a Fast Fake

### Before — the test sleeps to wait for a real timer/clock

```go
func TestSessionExpires(t *testing.T) {
    s := NewSession(100 * time.Millisecond)
    time.Sleep(150 * time.Millisecond)        // real wall-clock wait — slow + flaky
    if !s.Expired() { t.Fail() }
}
```

### After — inject the clock; advance it instantly

```go
func TestSessionExpires(t *testing.T) {
    clock := &FakeClock{now: t0}
    s := NewSessionWithClock(100*time.Millisecond, clock)
    clock.Advance(150 * time.Millisecond)     // instant, deterministic
    if !s.Expired() { t.Fatal("should be expired") }
}
```

**Gain:** Eliminates a 150ms-per-run sleep *and* the flakiness of timing-dependent tests. Time, randomness, network, and the filesystem are the four boundaries that make tests slow and non-deterministic — inject them so tests control them. The design improves too: the session is now testable against any clock.

---

## Drill 6: Collapse Triangulated Tests into a Table

### Before — five near-identical tests left over from triangulation

```python
def test_1(): assert fizzbuzz(1) == "1"
def test_2(): assert fizzbuzz(2) == "2"
def test_3(): assert fizzbuzz(3) == "Fizz"
def test_5(): assert fizzbuzz(5) == "Buzz"
def test_15(): assert fizzbuzz(15) == "FizzBuzz"
```

### After — one parametrized test (a refactor of the TESTS, on green)

```python
@pytest.mark.parametrize("n,expected", [
    (1,"1"), (2,"2"), (3,"Fizz"), (5,"Buzz"), (15,"FizzBuzz"),
])
def test_fizzbuzz(n, expected):
    assert fizzbuzz(n) == expected
```

**Gain:** Same coverage, far less duplication, and a single place to add the next case. **Important sequencing:** you write these one at a time during red-green (Law 2 forbids ten failing tests at once), then collapse them into the table *during the refactor beat*. The test suite is code — deduplicate it on green like any other code.

---

## Drill 7: Kill a Flaky Test

### Before — passes ~90% of the time, depends on real "now" and ordering

```python
def test_recent_events():
    log_event("a")
    log_event("b")
    events = recent(within_seconds=1)
    assert events == ["b", "a"]   # flaky: depends on system clock + insertion timing
```

### After — control time, assert on a stable property

```python
def test_recent_events():
    clock = FakeClock(t0)
    log = EventLog(clock)
    log.record("a"); clock.advance(0.1)
    log.record("b")
    assert log.recent(within_seconds=1) == ["b", "a"]   # deterministic ordering
```

**Gain:** A flaky test is worse than no test — it trains the team to ignore red, which destroys the trust the whole loop depends on. Removing nondeterminism (injected clock, fixed seeds for RNG, no reliance on real timing/ordering) makes the test trustworthy. **Treat flakes as sev events**, not annoyances. See [Professional](professional.md).

---

## Drill 8: Add the Missing Assertion

### Before — coverage theater: runs the code, checks nothing

```java
@Test void exportRuns() {
    exporter.export(report);   // green if it doesn't throw; verifies no behavior
}
```

### After — assert the actual output

```java
@Test void exportWritesCsvHeader() {
    var sink = new StringWriter();
    exporter.export(report, sink);
    assertThat(sink.toString()).startsWith("id,name,total\n");  // real verification
}
```

**Gain:** Converts a line-coverage placebo into a real test. The "before" version inflates coverage while a mutation test would show every mutant surviving (mutation score 0%). The optimization that matters is **verification, not execution** — assert behavior. See [find-bug](find-bug.md), Bug 2.

---

## Drill 9: Re-Tier

### Before — the "unit" suite is 9 minutes because tests hit Postgres

```python
# tests/unit/test_repo.py  (mislabeled — really integration)
def test_save_and_find():
    repo = UserRepo(real_postgres())   # 600ms each, ×400 tests = minutes
    ...
```

### After — split the tiers

```python
# tests/unit/test_repo.py — fast, in-memory fake (milliseconds)
def test_save_and_find():
    repo = UserRepo(InMemoryStore())
    repo.save(User("alice")); assert repo.find("alice")

# tests/integration/test_repo_postgres.py — a FEW real-DB tests for SQL mapping
@pytest.mark.integration
def test_sql_mapping_round_trips():
    repo = UserRepo(real_postgres()); ...
```

**Gain:** The unit suite drops from 9 minutes to seconds, restoring the nano-cycle, while a small integration suite still verifies the real SQL. Developers run unit tests on every save again. This is the single highest-leverage fix when "TDD stopped working" on a team — the loop was killed by slow tests mislabeled as units. See [Professional](professional.md), Incident 1.

---

## Drill 10: Parallelize and Isolate

### Before — tests can't run in parallel because of shared global state

```python
TEMP_DIR = "/tmp/test"          # shared by all tests → collisions in parallel

def test_writes_file():
    write(TEMP_DIR + "/out.txt", data)
    assert read(TEMP_DIR + "/out.txt") == data
```

### After — per-test isolation enables parallelism

```python
def test_writes_file(tmp_path):           # pytest gives each test a fresh dir
    out = tmp_path / "out.txt"
    write(out, data)
    assert read(out) == data
```

**Gain:** With no shared mutable state, the runner can execute tests in parallel (`pytest -n auto`, `go test -parallel`, JUnit parallel) — often a multiplicative speedup on a multicore machine. Isolation is a prerequisite: parallelism on shared state produces flakiness, not speed. Isolated tests are both faster (parallel) and more trustworthy (order-independent). See [Test Design & Fixtures](../02-test-design-and-fixtures/junior.md).

---

## Optimization Tips

### Where TDD optimization actually pays off

1. **Suite speed is the master metric.** The three laws require a seconds-long loop; anything that slows the unit suite (framework boot, real I/O, sleeps) directly attacks TDD. Optimize speed first.
2. **Trust beats coverage.** A fast, flake-free, assertion-rich suite that you believe is worth more than a slow one with a high coverage number. Audit with mutation testing, not the coverage gauge.
3. **Brittleness is a hidden cost.** Implementation-coupled and over-mocked tests block the refactoring the loop is supposed to enable — de-couple them to assert behavior.
4. **Smaller steps localize failure.** When red→green takes more than a minute, your step is too big; decompose the test list.

### Optimization checklist

- [ ] Unit suite runs in **seconds** (no framework boot, no real I/O in unit tests).
- [ ] No `sleep`s — inject the clock and advance it instantly.
- [ ] Slow DB/network/fs tests live in the **integration tier**, not "unit."
- [ ] Tests assert **behavior/outcomes**, not call sequences or private state.
- [ ] Mocks limited to true boundaries; default to real (sociable) objects.
- [ ] Every test has a real, **falsifiable** assertion (no coverage theater).
- [ ] Tests are **isolated** (own fixtures, no shared mutable state) → parallelizable.
- [ ] Triangulated tests collapsed into **tables** during refactor.
- [ ] Flakes treated as **sev events** and removed, not retried.
- [ ] Critical modules audited with **mutation testing**.

### Anti-optimizations

- ❌ **Chasing a coverage number** — produces assertion-free tests; optimize trust (mutation score) instead.
- ❌ **Mocking to make a slow test fast** when the real object is already fast — you trade speed you didn't need for brittleness you don't want.
- ❌ **Deleting "annoying" tests** to speed up the suite — fix or re-tier them; don't lose the verification.
- ❌ **One huge end-to-end test** "to cover everything" — slow, brittle, and it can't drive the inner loop.

---

## Summary

TDD optimization is overwhelmingly about the **feedback loop**: keep the unit suite fast enough that the nano-cycle stays in seconds. The big levers are removing framework boot and real I/O from unit tests (re-tier them), injecting boundaries (clock, RNG, network) so tests are fast and deterministic, de-coupling brittle implementation/mock-heavy tests to assert behavior instead, and isolating tests so they parallelize. The metric to chase is **trust** (mutation score, flake rate, suite wall-clock), never raw coverage — because a slow or untrustworthy suite makes the three laws unfollowable, and an unfollowable discipline delivers nothing.

---

[← Find-Bug](find-bug.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md)

**The Three Laws of TDD suite complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next discipline:** [Test Design & Fixtures](../02-test-design-and-fixtures/junior.md).
