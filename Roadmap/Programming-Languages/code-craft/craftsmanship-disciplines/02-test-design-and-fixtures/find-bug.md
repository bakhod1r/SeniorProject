# Test Design & Fixtures — Find the Bug

> **Category:** [Craftsmanship Disciplines](../README.md) — design tests that read clearly, run fast, and manage their own data, so a failing test names a single broken behavior.

12 buggy *test* snippets — tests that are wrong, flaky, or misleading even when the production code is fine. Spot the bug, then expand the fix and the lesson.

---

## Table of Contents

1. [Bug 1: The Assertion-Free Test](#bug-1-the-assertion-free-test)
2. [Bug 2: Shared Mutable Fixture](#bug-2-shared-mutable-fixture)
3. [Bug 3: Order-Dependent Tests](#bug-3-order-dependent-tests)
4. [Bug 4: Time-Dependent Test](#bug-4-time-dependent-test)
5. [Bug 5: The Mystery Guest](#bug-5-the-mystery-guest)
6. [Bug 6: Teardown That Never Runs](#bug-6-teardown-that-never-runs)
7. [Bug 7: Asserting on Random Data](#bug-7-asserting-on-random-data)
8. [Bug 8: Logic in the Test](#bug-8-logic-in-the-test)
9. [Bug 9: Sleep-Based Async Wait](#bug-9-sleep-based-async-wait)
10. [Bug 10: Over-Mocked, Refactor-Hostile Test](#bug-10-over-mocked-refactor-hostile-test)
11. [Bug 11: Multi-Concept Test](#bug-11-multi-concept-test)
12. [Bug 12: The Dishonest Fake](#bug-12-the-dishonest-fake)
13. [Practice Tips](#practice-tips)

---

## Bug 1: The Assertion-Free Test

```python
def test_process_order():
    order = make_order()
    process(order)          # BUG: no assertion — passes unless it throws
```

**Symptoms:** Always green. Could return the wrong total, wrong status, anything — the test never checks.

<details><summary>Find the bug</summary>

There is no assertion. The test only verifies "didn't crash," not "did the right thing." It silently passes for any output.

</details>

### Fix

```python
def test_process_marks_order_paid():
    order = make_order()
    process(order)
    assert order.status == "PAID"   # verify the actual outcome
```

### Lesson

A test with no assertion is not Self-validating (the **S** in F.I.R.S.T.). Every test must assert a concrete outcome.

---

## Bug 2: Shared Mutable Fixture

```python
@pytest.fixture(scope="module")
def account():
    return Account(balance=100)     # BUG: ONE account shared by all tests

def test_withdraw(account):
    account.withdraw(40)
    assert account.balance == 60

def test_balance_unchanged(account):
    assert account.balance == 100   # FAILS — test_withdraw already took 40
```

**Symptoms:** `test_balance_unchanged` passes alone but fails when `test_withdraw` runs first.

<details><summary>Find the bug</summary>

The `scope="module"` fixture is shared *and mutated*. The withdrawal in one test leaks into the next, coupling them through shared state.

</details>

### Fix

```python
@pytest.fixture                     # default scope="function" → fresh per test
def account():
    return Account(balance=100)
```

### Lesson

Share a fixture only if it's immutable or reset between tests. A shared *mutable* fixture violates Independence. (See [Senior](senior.md).)

---

## Bug 3: Order-Dependent Tests

```python
seeded_user_id = None

def test_a_create_user():
    global seeded_user_id
    seeded_user_id = create_user("ada").id    # BUG: stores state for later

def test_b_user_can_login():
    assert login(seeded_user_id)              # depends on test_a running first
```

**Symptoms:** Passes in file order; fails under `pytest -p randomly` or when `test_b` runs alone (`seeded_user_id` is `None`).

<details><summary>Find the bug</summary>

`test_b` depends on a side effect of `test_a` via a module global. The tests are not independent — they form a hidden sequence.

</details>

### Fix

```python
def test_user_can_login():
    user = create_user("ada")        # build its own prerequisite
    assert login(user.id)
```

### Lesson

Each test sets up its own world. Tests that pass a baton via shared state break the moment the runner shuffles or you run one in isolation. Run `-shuffle`/`randomly` in CI to expose this.

---

## Bug 4: Time-Dependent Test

```java
@Test void created_today() {
    Order order = service.create();
    assertEquals(LocalDate.now(), order.createdDate());   // BUG: straddles midnight
}
```

**Symptoms:** Passes all day, fails in the nightly run that crosses midnight — `create()` captured one date, the assertion computes another.

<details><summary>Find the bug</summary>

Both the SUT and the assertion read the wall clock independently. Near a date boundary they disagree. The test is not Repeatable.

</details>

### Fix

```java
@Test void created_today() {
    Clock fixed = Clock.fixed(Instant.parse("2025-01-01T10:00:00Z"), ZoneOffset.UTC);
    Order order = new OrderService(fixed).create();
    assertEquals(LocalDate.of(2025, 1, 1), order.createdDate());  // deterministic
}
```

### Lesson

Treat time as an injected dependency, controlled by a fixed clock in tests. Any test reading `now()` twice can straddle a boundary. (See [Senior](senior.md).)

---

## Bug 5: The Mystery Guest

```python
def test_vip_gets_free_shipping():
    order = place_order(customer_id=7, total=50)   # BUG: customer 7 from seed.sql
    assert order.shipping == 0                       # why free? invisible
```

**Symptoms:** A reader can't tell why shipping is free. Editing the seed file's customer 7 silently breaks this test (and any other relying on row 7).

<details><summary>Find the bug</summary>

The test depends on data it didn't create and doesn't show — the *mystery guest*. The fixture's relevant property (customer 7 is VIP) lives in an invisible seed file.

</details>

### Fix

```python
def test_vip_gets_free_shipping(db):
    customer = a_customer().vip().build()
    db.save(customer)
    order = place_order(customer_id=customer.id, total=50)
    assert order.shipping == 0   # VIP → free shipping is now visible
```

### Lesson

Each test builds and shows its own data. Shared seed files create mystery guests, interdependence, and untouchable "don't edit row 7" landmines.

---

## Bug 6: Teardown That Never Runs

```python
def test_writes_file():
    f = open("/tmp/out.txt", "w")
    f.write("data")
    assert os.path.getsize("/tmp/out.txt") > 0   # if this fails ↓
    f.close()                                      # BUG: skipped on failure → leak
```

**Symptoms:** When the assertion fails, `f.close()` never runs. After many failures the process leaks file descriptors and unrelated tests start failing with "too many open files."

<details><summary>Find the bug</summary>

Teardown (`f.close()`) sits *after* the assertion. A failed assertion aborts the test before cleanup runs, leaking the handle.

</details>

### Fix

```python
@pytest.fixture
def out_file(tmp_path):
    f = open(tmp_path / "out.txt", "w")
    yield f
    f.close()                  # runs on pass AND failure

def test_writes_file(out_file):
    out_file.write("data"); out_file.flush()
    assert os.path.getsize(out_file.name) > 0
```

### Lesson

Teardown must run via a hook (`yield`, `@AfterEach`, `t.Cleanup`), never as a trailing statement — a failed assertion would skip it. Leaks surface far from their cause.

---

## Bug 7: Asserting on Random Data

```python
def test_user_name():
    user = UserFactory()                      # name = faker.name() (random)
    assert user.name == "Allison Hill"        # BUG: asserting a random value
```

**Symptoms:** Passes only while the seed/faker version happens to produce that name; a faker upgrade or seed change reds the test with no code change.

<details><summary>Find the bug</summary>

The test asserts on a *generated* (random) value. Factory output is for *construction*, never for *expectation*. The assertion is coupled to the RNG state.

</details>

### Fix

```python
def test_user_uses_given_name():
    user = UserFactory(name="Ada")            # set the field you assert on
    assert user.name == "Ada"
# or assert a property, not the value:
def test_user_has_nonempty_name():
    assert UserFactory().name                  # asserts the invariant, not the value
```

### Lesson

Never assert on Faker/random-generated data. Set explicitly what you assert on, or assert a property. Always seed the generator for Repeatable runs. (See [Professional](professional.md).)

---

## Bug 8: Logic in the Test

```python
def test_total():
    order = make_order([("book", 12), ("pen", 3)])
    expected = sum(price for _, price in order.raw_items)   # BUG: re-implements logic
    assert order.total() == expected
```

**Symptoms:** If `total()` and the test share the same bug (e.g., both forget tax), the test still passes. The test isn't an independent oracle.

<details><summary>Find the bug</summary>

The test computes its expected value by re-implementing the logic under test. A bug present in both the code and the test cancels out, hiding it.

</details>

### Fix

```python
def test_total_sums_item_prices():
    order = make_order([("book", 12), ("pen", 3)])
    assert order.total() == 15      # known, literal expectation
```

### Lesson

Keep expected values literal. A test with logic can carry the same bug as the code and silently agree with it. No `if`, no loops computing expectations, no shared formula.

---

## Bug 9: Sleep-Based Async Wait

```go
func TestJobCompletes(t *testing.T) {
    StartJob("export")
    time.Sleep(2 * time.Second)          // BUG: fixed sleep
    if !JobDone("export") { t.Fatal("not done") }
}
```

**Symptoms:** Slow (always waits 2s) *and* flaky — under CI load the job sometimes takes longer than 2s and the test fails despite correct code.

<details><summary>Find the bug</summary>

A fixed `sleep` both wastes time when the job is fast and fails when the job is slow. It's a guess about timing, not a synchronization.

</details>

### Fix

```go
func TestJobCompletes(t *testing.T) {
    StartJob("export")
    waitUntil(t, 5*time.Second, func() bool { return JobDone("export") })  // poll
}
func waitUntil(t *testing.T, timeout time.Duration, cond func() bool) {
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        if cond() { return }
        time.Sleep(10 * time.Millisecond)
    }
    t.Fatal("condition not met before timeout")
}
```

### Lesson

Poll for the condition with a timeout instead of sleeping a fixed duration. The test returns as soon as the condition holds (fast) and only fails if it genuinely never holds (not flaky). Better still, inject a deterministic scheduler.

---

## Bug 10: Over-Mocked, Refactor-Hostile Test

```python
def test_checkout():
    repo = Mock(); cache = Mock(); logger = Mock()
    Checkout(repo, cache, logger).run(cart)
    repo.find.assert_called_once()         # BUG: pins implementation
    cache.put.assert_called_once()
    logger.info.assert_called_once()       # asserting a log line!
```

**Symptoms:** Reds on every refactor — add a log line, reorder a cache write, and the test fails though checkout's *behavior* is unchanged.

<details><summary>Find the bug</summary>

The test verifies internal *interactions* (which methods were called) rather than the *outcome*. It pins the implementation, so behavior-preserving refactors break it.

</details>

### Fix

```python
def test_checkout_produces_receipt():
    repo = InMemoryRepo(seed=[item("book", 12)])
    receipt = Checkout(repo, NullCache(), NullLogger()).run(cart_with("book"))
    assert receipt.total == 12             # assert the OUTCOME
```

### Lesson

Prefer state verification (assert on the result) over behavior verification (assert on calls). Mock at I/O boundaries; verify interactions only when the interaction *is* the requirement. Over-mocking taxes refactoring. (See [Senior](senior.md).)

---

## Bug 11: Multi-Concept Test

```python
def test_register():
    user = register("ada@x.com")
    assert user.active                       # concept 1
    assert mailer.sent == ["ada@x.com"]      # concept 2
    assert audit.last == "REGISTER"          # concept 3
```

**Symptoms:** When it fails, you don't know which of three behaviors broke without reading the line numbers. A break in auditing reports as a generic `test_register` failure.

<details><summary>Find the bug</summary>

Three unrelated behaviors (user state, email, audit) are asserted in one test. It has three reasons to fail, so a failure doesn't self-diagnose. It also stops at the first failing assert, hiding the others.

</details>

### Fix

```python
def test_register_creates_active_user(): assert register("ada@x.com").active
def test_register_sends_welcome_email(): register("ada@x.com"); assert mailer.sent == ["ada@x.com"]
def test_register_writes_audit_entry():  register("ada@x.com"); assert audit.last == "REGISTER"
```

### Lesson

One *concept* per test. Several asserts about *one* outcome are fine; asserts about *separate* behaviors must be split so each failure names one broken behavior. (See [Middle](middle.md).)

---

## Bug 12: The Dishonest Fake

```python
class InMemoryUserRepo:               # used in fast unit tests
    def __init__(self): self._d = {}
    def save(self, u): self._d[u.id] = u     # BUG: no unique-email enforcement
    def get(self, id): return self._d[id]

def test_register_rejects_duplicate_email():
    repo = InMemoryUserRepo()
    register("ada@x.com", repo)
    register("ada@x.com", repo)        # passes! real Postgres would reject this
    # ...no error, false green
```

**Symptoms:** The unit test using the fake passes, but production (with a real unique constraint) throws — a false green that hides a missing duplicate check.

<details><summary>Find the bug</summary>

The fake doesn't honor the real repo's contract (unique emails). Tests against it pass for cases the real implementation would reject. The fake has drifted from reality.

</details>

### Fix

Add a **contract test** run against both the fake and the real repo, forcing the fake to enforce the same rule:

```python
class UserRepoContract:
    def make_repo(self): raise NotImplementedError
    def test_duplicate_email_rejected(self):
        repo = self.make_repo()
        repo.save(User(1, "a@x.com"))
        with pytest.raises(DuplicateEmail):
            repo.save(User(2, "a@x.com"))     # both impls MUST satisfy this

class TestInMemoryUserRepo(UserRepoContract):
    def make_repo(self): return InMemoryUserRepo()   # now forced to enforce uniqueness
class TestPostgresUserRepo(UserRepoContract):
    def make_repo(self): return PostgresUserRepo(test_db())
```

### Lesson

A fake without a contract test silently diverges from reality and produces false greens. Run one contract suite against both the fake and the real thing to keep the fake honest. (See [Senior](senior.md).)

---

## Practice Tips

1. **Look for missing assertions** — does the test verify an outcome, or just "didn't throw"?
2. **Check fixture scope** — is a mutable fixture shared across tests?
3. **Run shuffled/parallel** (`-shuffle`, `-p randomly`) to expose order dependence.
4. **Grep for `now()`, `random()`, `uuid4()`, `sleep`** in tests — all flakiness sources.
5. **Trace where test data comes from** — is there a mystery guest from a seed file?
6. **Verify teardown is in a hook**, not a trailing statement.
7. **Count `assert_called`/`verify`** — many means over-mocking.
8. **Count concepts** — one behavior per test, or split.
9. **Contract-test every fake** so it can't drift into false greens.

---

[← Tasks](tasks.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
