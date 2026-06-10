# Test Design & Fixtures — Interview Questions

> **Category:** [Craftsmanship Disciplines](../README.md) — design tests that read clearly, run fast, and manage their own data, so a failing test names a single broken behavior.

Conceptual and coding questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What are the three phases of a test?

**Answer:** **Arrange** (build the fixture / known starting state), **Act** (call the one thing under test), **Assert** (verify the one expected outcome). Also called Given-When-Then.

### J2. What is a fixture?

**Answer:** The known starting state a test needs to run — objects, data, files, fake dependencies. The "Given" of Given-When-Then.

### J3. Why should the Act block contain only one action?

**Answer:** So a failure points at exactly one behavior. Multiple actions mean the test can fail for several reasons and you can't tell which from the failure alone.

### J4. What's wrong with a test that has no assertion?

**Answer:** It can only fail by throwing an exception, never by producing a wrong-but-valid result. It silently passes regardless of the code's output, so it verifies nothing (violates Self-validating).

### J5. What should a test name describe?

**Answer:** The **behavior** being verified (`total_sums_item_prices`), and ideally the **condition** (`withdraw_rejects_overdraft`). Never the implementation (`test_uses_hashmap`), which lies after a refactor.

### J6. What's the difference between a unit test and an integration test?

**Answer:** A unit test verifies one piece of code in isolation with an in-memory fixture (fast). An integration test verifies multiple components together — e.g., service + real database — with real data (slower).

### J7. What does "one concept per test" mean?

**Answer:** A test should verify a single behavior. Several asserts that together describe one outcome are fine; asserting about *separate* behaviors should be separate tests.

### J8. Why shouldn't you put logic (`if`, loops) in a test?

**Answer:** Logic can have its own bugs, so the test stops being a trustworthy oracle. Keep expected values literal and the test straight-line.

### J9. What is teardown?

**Answer:** The phase that releases what setup acquired — close files, drop DB rows, reset the clock. It must run even when the test fails, via a framework hook.

### J10. Give a simple example of AAA.

**Answer:** `account = Account(100)` (Arrange); `account.withdraw(30)` (Act); `assert account.balance == 70` (Assert).

---

## Middle Questions

### M1. What are the four phases of a test, and which do juniors forget?

**Answer:** Setup, Exercise, Verify, **Teardown**. Teardown is the forgotten one — it only matters when the fixture touches the outside world (file, DB, global), and it must run via a hook (`@AfterEach`, fixture `yield`, `t.Cleanup`) so it fires even when an assertion fails.

### M2. What does F.I.R.S.T. stand for?

**Answer:** **F**ast, **I**ndependent, **R**epeatable, **S**elf-validating, **T**imely. Fast and Independent decide whether the suite gets used at all (slow → unrun; coupled → cascading failures).

### M3. Object Mother vs Test Data Builder — when do you use each?

**Answer:** **Object Mother** = a factory returning canned named instances (`aVipCustomer()`); great for a few fixed scenarios. **Test Data Builder** = a fluent builder with defaults you override per field (`aCustomer().vip().balance(-50).build()`); use it when tests vary *different* fields, since a Mother would need a method per combination.

### M4. Name the five test doubles and the key distinction.

**Answer:** Dummy (fills a slot, unused), Stub (canned answers fed into the SUT), Spy (stub that records calls), Mock (pre-set expectations, self-verifying), Fake (working lite implementation). Key split: stubs/fakes → **state** verification (assert on result); mocks/spies → **behavior** verification (assert on interactions).

### M5. Fresh vs shared fixtures — what's the default and why?

**Answer:** **Fresh per test** is the default because it guarantees Independence for free. Share only when setup is expensive *and* the fixture is immutable or reset between tests.

### M6. When is "one assert per test" wrong?

**Answer:** When several asserts describe one concept (a correctly-registered user's fields). The real rule is **one concept per test** — one reason to fail.

### M7. What does a parameterized test give you?

**Answer:** One test body run across many inputs, with each case reporting independently. Use it for one behavior across many inputs; don't mix different behaviors into one parameterized test.

### M8. Why prefer state verification over behavior verification?

**Answer:** State verification (assert on the outcome) survives refactoring. Behavior verification (assert on which methods were called) pins the implementation and breaks on refactors that preserve behavior. Use behavior verification only when the interaction *is* the requirement (send an email, charge a card once).

### M9. What's the danger of a shared mutable fixture?

**Answer:** Test interdependence — test B passes only because test A left the fixture in some state. It fails when run alone or in a shuffled order. The fix: fresh per test, or make the shared fixture immutable/reset.

### M10. How do you keep a unit test Fast?

**Answer:** No real I/O — no DB, network, filesystem, or `sleep`. Replace those dependencies with stubs/fakes so the test runs in milliseconds.

---

## Senior Questions

### S1. Solitary vs sociable tests — explain the trade-off.

**Answer:** **Solitary (mockist)** treats one *class* as the unit and mocks every collaborator — precise localization but pins call structure, so refactors break it. **Sociable (classical)** treats one *behavior* as the unit, using real in-process collaborators and faking only awkward dependencies (DB, clock) — refactor-resistant (asserts outcomes) but broader failure localization. The usual senior stance: sociable by default, solitary at the I/O seams.

### S2. How do you make time-dependent code testable?

**Answer:** Treat time as a dependency. Inject a clock (`Clock`/`func() time.Time`/`now` callable) instead of calling `datetime.now()` deep in logic. Tests pass a fixed clock; the code becomes deterministic (Repeatable). Same seam for randomness and ID generation.

### S3. What is the mystery guest anti-pattern?

**Answer:** A test depends on data it didn't create and that isn't visible in the test (e.g., "customer 42" from a shared seed file). The reader can't tell why the assertion expects what it does, and changing the seed silently breaks unrelated tests. Cure: each test builds its own data, visibly.

### S4. How do you get both speed and isolation from a real database?

**Answer:** Share the expensive connection across the suite (built once), but run each test inside a **transaction that's rolled back** in teardown. Every test sees a clean DB, nothing persists, and setup cost is paid once.

### S5. What's a contract test and why does it matter for fakes?

**Answer:** A single suite of behaviors run against *both* the real implementation and the fake, asserting they behave identically. It keeps a fake honest — without it, a fake drifts from reality (e.g., doesn't enforce unique keys) and produces false greens. Contract tests are how you earn the right to use fakes in fast tests.

### S6. What is over-mocking and why is it bad?

**Answer:** Verifying every internal interaction so the test pins the implementation, not the behavior. The suite reds on every behavior-preserving refactor, so the team stops refactoring and the code rots. Mock at architectural boundaries (DB, gateway), verify interactions only when the interaction is the requirement, and prefer asserting outcomes.

### S7. What's the general fixture anti-pattern?

**Answer:** One oversized `setUp` that builds everything any test might need. It violates Fast (every test pays for unused data) and obscures intent (the reader can't tell what *this* test depends on). Cure: minimal local fixtures, each test building only what it uses.

### S8. How does the test pyramid relate to fixture weight?

**Answer:** Fixture weight rises with test level: unit (light, in-memory) → integration (real DB) → E2E (whole system). The pyramid says write many light-fixture unit tests and few heavy-fixture E2E tests, and **push fixture weight down** — test a behavior at the lowest level that can. An inverted pyramid (mostly heavy tests) makes the suite slow and flaky.

---

## Professional Questions

### P1. How do you isolate test data across parallel CI workers?

**Answer:** Give each worker its own DB/schema (or a transaction it rolls back) and unique temp dirs/ports, so workers can't see each other's state. Combined with "each test builds its own data," this lets the suite run in parallel without collisions.

### P2. How should you use Faker without breaking Repeatable?

**Answer:** Seed it (`Faker.seed(0)`) so it produces the same "random" data every run, and **never assert on a Faker-generated value** — use it only for construction/defaults, assert only on fields you set explicitly. Use deterministic sequences for any value you assert on.

### P3. Walk me through triaging a flaky test.

**Answer:** Quarantine it (with a ticket — don't ignore). Reproduce deterministically: run it 1,000×, under `-shuffle` and `-race`. Classify the cause — it's always time, test order, async timing, randomness, a shared external resource, or a leak. Fix the root cause (inject a clock, isolate the fixture, poll instead of sleep), not the symptom. De-quarantine after 1,000 clean runs.

### P4. Why is an auto-retry a bad permanent fix for a flake?

**Answer:** A retry hides the flake *and* hides real intermittent bugs — a genuine race that fails 1/50 will pass on retry and ship to production. Retries are a stopgap; the deliverable is the root-cause fix.

### P5. Why test against a real Postgres instead of an in-memory DB like H2/SQLite?

**Answer:** Dialect and constraint differences cause false greens — a query that works on H2 may fail on Postgres, or vice versa. Use the same engine as production (via Testcontainers), built from the same migrations, so tests exercise the real behavior.

### P6. What's the maintenance argument for builders/factories?

**Answer:** They centralize object construction. When a constructor gains a required field, one builder default absorbs it instead of editing hundreds of tests that called the constructor directly. A single production change should touch one fixture, not many tests.

### P7. How do you enforce test-design standards across a large team?

**Answer:** A style guide (AAA, one naming convention, one concept per test, builders for construction, no sleep/now/random) plus review checklist enforcement, plus CI gates: run shuffled and in parallel (`-shuffle`, `-n auto`) so interdependence fails loudly, run `-race`, and treat a flake as a P2 bug, not a re-run.

### P8. Transaction-rollback vs truncate for DB isolation — when each?

**Answer:** Transaction rollback is faster and cleaner, but breaks when the code under test commits its own transactions (you can't roll back a commit). Use truncate-between-tests for tests that exercise transaction boundaries themselves; use rollback for everything else.

---

## Coding Tasks

### C1. Refactor this tangled test into clean AAA (Python).

**Before:**

```python
def test_stuff():
    o = Order(); o.add("book", 12); o.add("pen", 3)
    assert o.total() == 15 and len(o.items) == 2 and o.status == "OPEN"
```

**After:**

```python
def make_order():
    o = Order()
    o.add("book", price=12)
    o.add("pen", price=3)
    return o

def test_total_sums_item_prices():
    order = make_order()
    assert order.total() == 15

def test_new_order_is_open():
    assert make_order().status == "OPEN"
```

The original mixed three concepts; split them so each failure names one behavior.

### C2. Write a Test Data Builder (Java).

```java
class OrderBuilder {
    private Customer customer = aCustomer().build();
    private List<Item> items = new ArrayList<>();
    private int total = 0;

    static OrderBuilder anOrder() { return new OrderBuilder(); }
    OrderBuilder forCustomer(Customer c) { this.customer = c; return this; }
    OrderBuilder withItem(String n, int p) { items.add(new Item(n, p)); return this; }
    OrderBuilder withTotal(int t) { this.total = t; return this; }
    Order build() { return new Order(customer, items, total); }
}

// Usage — the test states only what it cares about
Order o = anOrder().withTotal(100).build();
```

### C3. Make this time-dependent test deterministic (Go).

**Before (flaky):**

```go
func TestOverdue(t *testing.T) {
    inv := Invoice{Due: time.Now().Add(-time.Hour)}
    if !inv.Overdue() { t.Fatal("want overdue") }  // depends on wall clock
}
```

**After:**

```go
type Invoice struct {
    Due time.Time
    Now func() time.Time   // injected seam
}
func (i Invoice) Overdue() bool { return i.Due.Before(i.Now()) }

func TestOverdue(t *testing.T) {
    fixed := func() time.Time { return time.Date(2025,1,2,0,0,0,0,time.UTC) }
    inv := Invoice{Due: time.Date(2025,1,1,0,0,0,0,time.UTC), Now: fixed}
    if !inv.Overdue() { t.Fatal("want overdue") }
}
```

### C4. Eliminate the mystery guest (Python).

**Before:**

```python
def test_premium_discount():
    order = place_order(customer_id=42, total=100)  # 42 from a seed file
    assert order.discount == 10
```

**After:**

```python
def test_premium_discount(db):
    customer = a_customer().premium().build()
    db.save(customer)
    order = place_order(customer_id=customer.id, total=100)
    assert order.discount == 10   # premium → 10% now visible in the test
```

### C5. Pick the right test double (Python).

**Spec:** test that `notify()` sends exactly one email to the user — the *interaction is the requirement*, so use behavior verification.

```python
def test_notify_sends_one_email():
    mailer = Mock()                      # mock: the send IS the behavior
    notify(user("ada@x.com"), mailer)
    mailer.send.assert_called_once_with("ada@x.com", "alert")
```

**Spec:** test that `invoice_with_late_fee()` computes the right total — the clock is just an input, so use a *stub* and assert on the *result* (state verification).

```python
def test_late_fee():
    clock = StubClock(datetime(2025, 2, 1))   # stub feeds time IN
    total = invoice_with_late_fee(due=datetime(2025, 1, 1), clock=clock)
    assert total == 110                        # assert on outcome, not interaction
```

---

## Trick Questions

### T1. "Always one assert per test." True?

**No.** The real rule is **one *concept* per test**. Several asserts that together verify one outcome (a user's fields after registration) are fine. What you split out is asserts about *different* behaviors.

### T2. A test passes. Does that mean the code is correct?

**No.** A test with no assertion passes regardless; a test asserting the wrong thing passes wrongly; a fake that drifted from reality gives a false green. A passing test means only "this specific check held" — its value depends entirely on its design.

### T3. Mocks make tests better, so mock everything?

**No.** Over-mocking pins the implementation, so the suite reds on every behavior-preserving refactor and the team stops refactoring. Mock at I/O boundaries; prefer asserting outcomes (state verification).

### T4. Is hitting a real database ever acceptable in a "unit" test?

**By definition, no** — that makes it an integration test (slower, needs isolation). It's fine to *have* integration tests; just don't call them unit tests or run thousands of them, or you violate Fast.

### T5. "We re-run flaky tests automatically, so they're handled." Right?

**No.** A retry masks the flake and any real intermittent bug it was catching. A retry is a stopgap; the fix is removing the non-determinism (inject the clock, isolate the fixture, seed the RNG).

### T6. A stub and a mock are interchangeable, right?

**No.** A stub *feeds* canned data into the SUT (you assert on the result); a mock has *expectations* and verifies the SUT called it as required (you assert on the interaction). Using a mock where a stub suffices over-couples the test to implementation.

---

## Behavioral Questions

### B1. Tell me about a flaky test you fixed.

**Sample:** "A test asserted `created_at == today()` and failed only in the nightly run that crossed midnight — setup captured 'today,' the assertion recomputed it on the other side of the date boundary. I injected a frozen clock so setup and assertion shared one 'now,' then ran it 1,000× across a simulated midnight to confirm. The broader fix was a team rule: no `now()` in testable logic, always an injected clock."

### B2. Describe a time test design saved or cost you.

**Sample:** "A module used one giant shared fixture. A schema change to one entity broke setup for forty unrelated tests, and each test was so slow we only ran the suite in CI. We moved to minimal per-test builders; setup got faster, the blast radius of a change shrank to the tests that actually used the field, and we could finally run the suite locally."

### B3. How do you handle a teammate who mocks everything?

**Sample:** "I'd agree mocks are essential at I/O boundaries, then show that mocking pure in-process collaborators pins our call structure — I'd point to a recent refactor that reddened twenty tests despite unchanged behavior. I'd propose: mock the DB/gateway/clock, use real objects for pure logic, and verify interactions only when the interaction itself is the requirement. The metric I care about is whether a behavior-preserving refactor keeps the suite green."

### B4. When did you decide *not* to write a test at a given level?

**Sample:** "A pricing rule was being tested end-to-end through HTTP and a real DB — slow and flaky. The logic was pure, so I pushed the test down to the unit level with an in-memory builder, kept one thin integration test to prove the wiring, and deleted the redundant E2E cases. Same coverage, a fraction of the runtime, no flakes."

---

## Tips for Answering

1. **Lead with structure:** Arrange-Act-Assert, one Act, one concept, name the behavior.
2. **Recite F.I.R.S.T.** and note Fast + Independent drive adoption.
3. **Nail the doubles taxonomy** — dummy/stub/spy/mock/fake, and state vs behavior verification.
4. **Name the anti-patterns:** mystery guest, general fixture, over-mocking, flaky/interdependent.
5. **Show the determinism seam:** inject time/random/IDs, transaction-per-test for DBs.
6. **Treat the suite as production infra:** flake triage, parallel isolation, the pyramid.

---

[← Professional](professional.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)
