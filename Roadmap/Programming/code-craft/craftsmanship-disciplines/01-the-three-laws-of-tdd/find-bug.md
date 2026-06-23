# The Three Laws of TDD — Find the Bug

> **Category:** [Craftsmanship Disciplines](../README.md) — write production code only to make a failing test pass, in the tightest possible loop.

12 snippets where TDD is done *wrong* — tests that can't fail, tests that assert nothing, tests coupled to implementation, over-mocking, skipped refactor, and law violations. Spot the problem, then expand the fix and the lesson. Most of these are **law-compliant but harmful** — a reminder that the laws are mechanics, not a quality guarantee.

---

## Table of Contents

1. [Bug 1: The Test That Can Never Fail](#bug-1-the-test-that-can-never-fail)
2. [Bug 2: The Test That Asserts Nothing](#bug-2-the-test-that-asserts-nothing)
3. [Bug 3: Testing the Implementation, Not the Behavior](#bug-3-testing-the-implementation-not-the-behavior)
4. [Bug 4: Over-Mocking Until the Test Is Meaningless](#bug-4-over-mocking-until-the-test-is-meaningless)
5. [Bug 5: Code Written Before the Test](#bug-5-code-written-before-the-test)
6. [Bug 6: Never Watched It Fail](#bug-6-never-watched-it-fail)
7. [Bug 7: The Skipped Refactor](#bug-7-the-skipped-refactor)
8. [Bug 8: Tautological Assertion](#bug-8-tautological-assertion)
9. [Bug 9: Interdependent Tests](#bug-9-interdependent-tests)
10. [Bug 10: A "Unit" Test That Hits the Database](#bug-10-a-unit-test-that-hits-the-database)
11. [Bug 11: Assertion in the Wrong Place (No Failure Message)](#bug-11-assertion-in-the-wrong-place)
12. [Bug 12: Refactoring on Red](#bug-12-refactoring-on-red)
13. [Practice Tips](#practice-tips)

---

## Bug 1: The Test That Can Never Fail

```python
def test_discount_is_positive():
    discount = compute_discount(order)
    assert discount >= 0 or discount < 0   # always true!
```

**Symptoms:** The test is permanently green. It passes whether `compute_discount` returns 5, -5, or `None`.

<details><summary>Find the bug</summary>

The assertion is a tautology — `x >= 0 or x < 0` is true for every number. The test exercises the code but can never fail, so it verifies nothing. Had it been written test-first and *seen to fail*, this would have been caught immediately (it would have passed on the first run with no implementation).

</details>

### Fix

```python
def test_gold_tier_gets_ten_percent():
    order = Order(total=100, tier="gold")
    assert compute_discount(order) == 10.0   # a real, falsifiable expectation
```

### Lesson

A test must be able to fail. "See it fail first" exists to catch exactly this — a test that's green before any code is written is asserting nothing real.

---

## Bug 2: The Test That Asserts Nothing

```java
@Test
void processesOrder() {
    service.process(order);   // no assertion at all
}
```

**Symptoms:** Counts toward coverage (the line ran), passes unless `process` *throws*, but verifies no behavior whatsoever.

<details><summary>Find the bug</summary>

There's no assertion. The test only proves `process` doesn't throw — it says nothing about what `process` is *supposed to do*. This is the #1 form of coverage theater: green dashboard, zero verification.

</details>

### Fix

```java
@Test
void processMarksOrderComplete() {
    service.process(order);
    assertThat(order.status()).isEqualTo(COMPLETE);   // verify the actual effect
}
```

### Lesson

Coverage measures whether code *ran*, not whether anything was *checked*. Every test must assert behavior. (Mutation testing would flag this instantly — every mutant survives.)

---

## Bug 3: Testing the Implementation, Not the Behavior

```python
def test_uses_quicksort_internally():
    sorter = Sorter()
    sorter.sort([3, 1, 2])
    assert sorter._last_algorithm == "quicksort"   # asserts HOW, not WHAT
```

**Symptoms:** Switching the internal sort to mergesort breaks the test, even though the output is identical and correct.

<details><summary>Find the bug</summary>

The test asserts an *implementation detail* (which algorithm ran) instead of the *behavior* (the list is sorted). It couples the test to internals, so any refactor that preserves behavior still breaks it — the suite becomes an anchor against improvement.

</details>

### Fix

```python
def test_sorts_ascending():
    assert Sorter().sort([3, 1, 2]) == [1, 2, 3]   # asserts WHAT, survives refactor
```

### Lesson

Test behavior (observable outputs/effects), not implementation (private fields, which method ran). Behavior-tests survive refactoring; implementation-tests punish it. This is the line between TDD that *enables* refactoring and TDD that *blocks* it.

---

## Bug 4: Over-Mocking Until the Test Is Meaningless

```java
@Test
void calculatesTotal() {
    var calc = mock(Calculator.class);
    when(calc.add(2, 3)).thenReturn(5);     // we mocked the thing under test!
    assertThat(calc.add(2, 3)).isEqualTo(5);
}
```

**Symptoms:** Always green. It tests that Mockito returns what you told it to — not that `Calculator` adds correctly.

<details><summary>Find the bug</summary>

The unit under test (`Calculator`) is itself mocked. The test verifies the mock, not the real code. More broadly: when you mock everything, the test asserts your *assumptions about collaborators* rather than real behavior, and passes even when the real system is broken.

</details>

### Fix

```java
@Test
void addsTwoNumbers() {
    assertThat(new Calculator().add(2, 3)).isEqualTo(5);   // real object, real behavior
}
```

### Lesson

Never mock the thing under test, and mock only true boundaries (slow/external/non-deterministic). Default to real objects (classicist style). Over-mocking is the leading cause of suites that are green while the product is broken. See [Senior](senior.md) on test-induced design damage.

---

## Bug 5: Code Written Before the Test

```python
# The production code was written first; THEN this test was added to "cover" it.
def parse(s):
    # 60 lines of parsing logic written all at once...
    ...

def test_parse():
    assert parse("a=1") == {"a": "1"}   # one happy-path test, after the fact
```

**Symptoms:** 60 lines of untested-until-now logic, "covered" by a single happy-path assertion. Edge cases (empty, malformed, duplicate keys) are untested because the code, not tests, drove the work.

<details><summary>Find the bug</summary>

This violates Law 1 (no production code without a failing test). Writing all the code first and bolting on one test inverts TDD — the test confirms the code rather than driving it, and only the path the author happened to think of gets checked.

</details>

### Fix

Drive the parser test-first, one case at a time: `""` → `{}`, `"a=1"` → `{"a":"1"}`, `"a=1&b=2"` → two keys, malformed → error. Each red forces one more piece, and edge cases get tests *because they're how you reach the next red*.

### Lesson

Test-first produces edge-case coverage as a byproduct of the loop. Test-after produces happy-path coverage and forgotten edges. The three laws exist to make the test *drive* the code, not chase it.

---

## Bug 6: Never Watched It Fail

```go
// Author wrote Reverse, then wrote this test. It passed first try. Shipped.
func TestReverse(t *testing.T) {
    if Reverse("abc") != "cba" {
        t.Fail()
    }
}
// ...but Reverse actually had a bug for unicode, untested, and this test
// was later silently weakened by a refactor so it no longer called Reverse.
```

**Symptoms:** A test that "passes" but, after a later edit, no longer actually exercises `Reverse` — and nobody notices because it was never seen failing.

<details><summary>Find the bug</summary>

The test was never observed in a failing state, so there's no proof it ever exercised the behavior. A test you've never seen fail can silently stop testing anything (here, a refactor detached it) and stay green forever.

</details>

### Fix

Periodically **sabotage** the production code and confirm the test goes red:

```go
// Temporarily: func Reverse(s string) string { return s }   // identity
// Run tests → TestReverse MUST go red. If it stays green, the test is broken.
// Restore Reverse afterward.
```

### Lesson

"See it fail first" (and re-confirm it can still fail) is the only proof a test actually tests something. Test-after suites accumulate tests that can't fail; a sabotage drill flushes them out. (See [Professional](professional.md), Incident 4.)

---

## Bug 7: The Skipped Refactor

```python
# Green, but the refactor beat was skipped on every cycle for a month.
def price(item, user, promo, region, season, bulk):
    if user.tier == "gold" and promo and not promo.expired and region == "US":
        if season == "holiday":
            if bulk > 100:
                return item.base * 0.5
            else:
                return item.base * 0.6
        # ... 40 more lines of nested conditionals accreted one green at a time
```

**Symptoms:** The tests all pass, but the function has become an unreadable, deeply nested mess — each TDD cycle added a branch and never cleaned up.

<details><summary>Find the bug</summary>

Red-green was followed; **refactor was skipped**. The three laws get you to green; without the refactor beat, green code accretes into legacy one passing test at a time. The laws don't *require* refactor — the discipline does.

</details>

### Fix

On green, refactor: extract the pricing rules into named, testable pieces (a rules table, polymorphic strategies, or guard clauses). The passing tests are your safety net — that's the entire reason refactor is safe.

### Lesson

Red-green-**refactor**. The third beat is not optional. Skipping it turns TDD into "test-first spaghetti." See [Refactoring as a Discipline](../03-refactoring-as-a-discipline/junior.md) and [Simple Design](../04-simple-design/junior.md).

---

## Bug 8: Tautological Assertion

```java
@Test
void computesTax() {
    Money tax = calc.tax(order);
    assertThat(tax).isEqualTo(calc.tax(order));   // compares the method to itself
}
```

**Symptoms:** Always green, regardless of what `tax` returns.

<details><summary>Find the bug</summary>

The expected value is computed by calling the same method under test. The assertion compares `tax(order)` to `tax(order)` — trivially equal (assuming determinism), so it can never fail. The test encodes no independent expectation.

</details>

### Fix

```java
@Test
void taxIsTenPercentInCA() {
    Order order = orderTotaling(money(100)).inState("CA");
    assertThat(calc.tax(order)).isEqualTo(money(10));   // independent expected value
}
```

### Lesson

The expected value must be computed *independently* of the code under test — a literal, a hand-computed value, or a different method. Re-using the SUT to compute the expectation is a hidden tautology.

---

## Bug 9: Interdependent Tests

```python
shared_account = Account(balance=100)   # module-level shared state!

def test_withdraw():
    shared_account.withdraw(40)
    assert shared_account.balance == 60

def test_balance_after():
    assert shared_account.balance == 60   # only passes if test_withdraw ran first
```

**Symptoms:** Tests pass in order but fail when run individually, in parallel, or reordered. Flaky and order-dependent.

<details><summary>Find the bug</summary>

The two tests share mutable state. `test_balance_after` depends on `test_withdraw` having mutated `shared_account` first. Tests must be independent — order-dependence makes failures non-reproducible and breaks parallel runs.

</details>

### Fix

```python
def test_withdraw_reduces_balance():
    account = Account(balance=100)     # fresh fixture per test
    account.withdraw(40)
    assert account.balance == 60
```

### Lesson

Each test owns its fixtures and shares no mutable state. Isolation is what lets you trust a single red and run tests in parallel. See [Test Design & Fixtures](../02-test-design-and-fixtures/junior.md).

---

## Bug 10: A "Unit" Test That Hits the Database

```python
def test_user_is_saved():
    db = PostgresConnection("postgres://prod-replica/...")   # real DB!
    repo = UserRepo(db)
    repo.save(User("alice"))
    assert repo.find("alice").name == "alice"   # 800ms per run
```

**Symptoms:** The "unit" test takes ~800ms, needs network and a live database, and is flaky when the DB is slow. The nano-cycle (which must be seconds) is destroyed; developers stop running tests locally.

<details><summary>Find the bug</summary>

This is an *integration* test mislabeled as a unit test. Real DB I/O is too slow for the inner loop. A suite full of these makes the three laws' second-scale loop impossible, and TDD quietly dies.

</details>

### Fix

```python
# Unit test: fast, in-memory fake repo — milliseconds, no network.
def test_repo_returns_saved_user():
    repo = InMemoryUserRepo()
    repo.save(User("alice"))
    assert repo.find("alice").name == "alice"

# Keep ONE real-DB test in the INTEGRATION tier to verify the SQL mapping.
```

### Lesson

Anything touching DB/network/filesystem belongs in the integration tier, not the unit tier. The unit suite must run in seconds or the nano-cycle breaks. See [Professional](professional.md), Incident 1.

---

## Bug 11: Assertion in the Wrong Place

```python
def test_all_items_priced():
    for item in catalog:
        if price(item) <= 0:
            print(f"bad price for {item}")   # prints instead of asserting!
    # no assert reaches the runner → test always "passes"
```

**Symptoms:** Bad prices print to stdout, but the test passes. The failure is invisible to CI.

<details><summary>Find the bug</summary>

The check `print`s instead of asserting. Nothing ever fails the test, so a real defect (non-positive prices) produces green CI with a buried log line nobody reads.

</details>

### Fix

```python
def test_all_items_priced():
    bad = [item for item in catalog if price(item) <= 0]
    assert bad == [], f"items with non-positive price: {bad}"
```

### Lesson

A check that doesn't `assert` (or otherwise fail the runner) is not a test. Collect violations and assert on them with a message — and never substitute logging for assertion.

---

## Bug 12: Refactoring on Red

```text
1. Test A is red (feature half-built).
2. Developer starts "cleaning up" the function while A is still failing.
3. Test A turns green.
4. Question: did the refactor fix it, or did the half-built feature finally work?
   → Unknowable.
```

**Symptoms:** A change is made while a test is red; when it goes green, you can't tell whether your *refactor* introduced the fix, your *feature work* did, or whether a *new* bug is hiding behind the now-green test.

<details><summary>Find the bug</summary>

Refactoring happened on **red**. The whole safety of refactoring depends on "green before, green after" — if you start on red, a passing test afterward is ambiguous: feature-complete, refactor-correct, and refactor-broke-something-else all look identical.

</details>

### Fix

Finish the feature to green *first* (small step), confirm green, *then* refactor — running tests after each refactoring move. If a test goes red during refactor, the *last move* caused it; undo and retry smaller.

### Lesson

Refactor only on green. Green is the unambiguous baseline that makes "did my change break behavior?" answerable. Refactoring on red destroys that signal. (See [Middle](middle.md).)

---

## Practice Tips

1. **Can this test fail?** Mentally (or actually) break the code and confirm the test goes red. Tautologies and assertion-free tests can't.
2. **Does it assert behavior or implementation?** Implementation-coupled tests block refactoring; rewrite to assert outputs/effects.
3. **Is the expected value independent of the SUT?** Re-using the method under test to compute the expectation is a hidden tautology.
4. **Count the mocks.** Many mocks → over-mocking → test verifies assumptions, not behavior.
5. **Is this actually a unit test?** DB/network/fs → integration tier; it's too slow for the loop.
6. **Are tests isolated?** Shared mutable state → order-dependent flakiness.
7. **Was refactor skipped or done on red?** The third beat must happen, and only on green.
8. **Audit with mutation testing** on critical modules — surviving mutants reveal exactly the assertions these bugs are missing.

---

[← Tasks](tasks.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
