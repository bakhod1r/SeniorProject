# Fragile Tests — Exercises

> **Category:** [Testing Anti-Patterns](../README.md) → **Fragile Tests** — *hands-on practice making tests survive a refactor.*

---

These are **fix-it** exercises, not recognition quizzes. For each one you get a problem statement, a brittle starting test (in Go, Java, or Python — the language varies on purpose), acceptance criteria, and a collapsible solution. The point is to *make the change*: turn a test that pins implementation details into one that pins the contract, so a behavior-preserving refactor leaves it green.

> **How to use this file.** Read the problem, rewrite the test in your editor *before* opening the solution, then compare. The "why it's better" note matters more than the diff — a robust test is one that fails for exactly one reason: the behavior broke. Refer back to [`junior.md`](junior.md) for the shapes and [`middle.md`](middle.md) for the countermoves.

---

## Table of Contents

| # | Exercise | Fragility source | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Stop reading private state](#exercise-1--stop-reading-private-state) | Private state | Python | ★ easy |
| 2 | [Drop the over-specified equals](#exercise-2--drop-the-over-specified-equals) | Over-specification | Java | ★ easy |
| 3 | [Parse, don't string-match the JSON](#exercise-3--parse-dont-string-match-the-json) | Output format | Go | ★★ medium |
| 4 | [Outcome over interaction](#exercise-4--outcome-over-interaction) | Mock interactions | Java | ★★ medium |
| 5 | [Kill the order and log assertions](#exercise-5--kill-the-order-and-log-assertions) | Order + log text | Python | ★★ medium |
| 6 | [Replace the god mock with a fake + contract test](#exercise-6--replace-the-god-mock-with-a-fake--contract-test) | White-box mocking | Go | ★★★ hard |

---

## Exercise 1 — Stop reading private state

**Fragility source:** private state · **Language:** Python · **Difficulty:** ★ easy

The test reaches into `_balance` and `_history`. A behavior-preserving change to how the account stores its data breaks it.

```python
class Account:
    def __init__(self):
        self._balance = 0
        self._history = []

    def deposit(self, amount):
        self._balance += amount
        self._history.append(("deposit", amount))

    def balance(self):
        return self._balance


# The brittle test:
def test_deposit_brittle():
    acc = Account()
    acc.deposit(100)
    assert acc._balance == 100                       # private field
    assert acc._history == [("deposit", 100)]        # private field, exact shape
```

**Acceptance criteria**
- No access to `_`-prefixed names.
- The test still verifies that a deposit increases the balance.
- The test would survive changing `_history` to a different structure (e.g. a list of dataclass events) or dropping it entirely.

**Hint:** drive the object through its public methods and assert on the public result.

<details>
<summary>Solution</summary>

```python
def test_deposit_increases_balance():
    acc = Account()
    acc.deposit(100)
    assert acc.balance() == 100      # public contract only
```

**Why it's better.** The robust test exercises `deposit` and asserts on `balance()` — the only thing a caller can observe. The internal `_history` list is an implementation detail with no public promise, so the test says nothing about it. You can now refactor storage freely (record events as objects, drop history, cache the balance) and this test stays green — it fails only if a deposit *actually* stops increasing the balance.

If history is genuinely part of the contract (e.g. there's a public `statement()`), test *that* public method, not the private list.

</details>

---

## Exercise 2 — Drop the over-specified equals

**Fragility source:** over-specification · **Language:** Java · **Difficulty:** ★ easy

The test asserts the whole `User` object, including a generated id, a timestamp, and a `version` field that the "registration sets status ACTIVE" behavior doesn't promise.

```java
record User(long id, String email, Status status, Instant createdAt, int version) {}

class Registration {
    User register(String email) {
        return new User(IdGen.next(), email, Status.ACTIVE, Clock.now(), 1);
    }
}

// The brittle test:
@Test
void register_brittle() {
    User u = new Registration().register("sam@x.io");
    assertThat(u).isEqualTo(
        new User(1L, "sam@x.io", Status.ACTIVE, Instant.parse("2026-06-10T00:00:00Z"), 1));
}
```

**Acceptance criteria**
- The test passes regardless of the generated id value, the current time, and the `version` scheme.
- It still verifies the two things registration actually promises: the email is carried through and the status is `ACTIVE`.
- It would survive adding a new field to `User`.

**Hint:** assert field-by-field on only the fields this behavior is responsible for; assert *existence* (not value) for generated ones.

<details>
<summary>Solution</summary>

```java
@Test
void register_carriesEmailAndActivates() {
    User u = new Registration().register("sam@x.io");
    assertThat(u.email()).isEqualTo("sam@x.io");   // input echoed — a real promise
    assertThat(u.status()).isEqualTo(Status.ACTIVE); // the behavior under test
    assertThat(u.id()).isPositive();                // an id was assigned (value not pinned)
    // createdAt and version are incidental to THIS behavior → not asserted here.
}
```

**Why it's better.** The over-specified `isEqualTo` pinned three volatile/incidental things — the generated id (breaks if the sequence shifts), the timestamp (also flaky), and `version` (unrelated). The robust test names exactly the behavior — "registration carries the email and sets status ACTIVE" — and asserts only that. Adding a field to `User` no longer breaks it, time no longer makes it flaky, and the test fails for one reason: registration stopped doing what it promises. Id-generation and timestamping, if they matter, are *other* tests' concerns.

</details>

---

## Exercise 3 — Parse, don't string-match the JSON

**Fragility source:** output format · **Language:** Go · **Difficulty:** ★★ medium

The test compares the serialized JSON byte-for-byte, pinning key order and whitespace — both of which a serializer can change without altering the data.

```go
type Cart struct {
    Items []Item `json:"items"`
    Total int    `json:"total"`
}
type Item struct {
    SKU string `json:"sku"`
    Qty int    `json:"qty"`
}

func Serialize(c Cart) ([]byte, error) { return json.Marshal(c) }

// The brittle test:
func TestSerialize_brittle(t *testing.T) {
    out, _ := Serialize(Cart{Items: []Item{{SKU: "A", Qty: 2}}, Total: 20})
    assert.Equal(t, `{"items":[{"sku":"A","qty":2}],"total":20}`, string(out))
}
```

**Acceptance criteria**
- The test passes regardless of key order or whitespace in the output.
- It still verifies that `total` and the items serialize with the right values.
- It would survive adding a new (optional) field to the JSON.

**Hint:** unmarshal the output into a `map[string]any` (or a struct) and assert on the parsed values.

<details>
<summary>Solution</summary>

```go
func TestSerialize_includesItemsAndTotal(t *testing.T) {
    out, err := Serialize(Cart{Items: []Item{{SKU: "A", Qty: 2}}, Total: 20})
    require.NoError(t, err)

    var got map[string]any
    require.NoError(t, json.Unmarshal(out, &got))

    assert.EqualValues(t, 20, got["total"])
    assert.Equal(t, []any{
        map[string]any{"sku": "A", "qty": float64(2)},
    }, got["items"])
}
```

**Why it's better.** The brittle test pinned the *serialized representation* — key order and the absence of spaces — neither of which is the contract. Go's `encoding/json` happens to emit struct fields in declaration order today, but a switch to a different encoder, a struct reorder, or an added field would all break the string match though the *data* is identical. Parsing first decouples the test from the byte layout: it asserts on the *values* a consumer would read after parsing, which is the real contract. Adding an optional field no longer breaks it.

> If the byte-for-byte format genuinely *is* a published contract (a fixed wire protocol), then pinning it is correct — but assert it deliberately and document why, rather than as an accident of `assert.Equal`.

</details>

---

## Exercise 4 — Outcome over interaction

**Fragility source:** mock interactions · **Language:** Java · **Difficulty:** ★★ medium

The test verifies *that* the repository and mailer were called, in order — pinning the internal choreography. It would pass even if the user were saved with the wrong data, and it breaks the moment you reorder or batch the internal calls.

```java
class Signup {
    private final UserRepo repo;
    private final Mailer mailer;
    Signup(UserRepo repo, Mailer mailer) { this.repo = repo; this.mailer = mailer; }

    void register(String email) {
        repo.save(new User(email, Status.ACTIVE));
        mailer.sendWelcome(email);
    }
}

// The brittle test:
@Test
void register_brittle() {
    UserRepo repo = mock(UserRepo.class);
    Mailer mailer = mock(Mailer.class);

    new Signup(repo, mailer).register("sam@x.io");

    InOrder o = inOrder(repo, mailer);
    o.verify(repo).save(any(User.class));     // asserts the call, not the data
    o.verify(mailer).sendWelcome("sam@x.io"); // asserts call order
    verifyNoMoreInteractions(repo, mailer);   // freezes the implementation
}
```

**Acceptance criteria**
- The test asserts on observable *outcomes*: the user is persisted as ACTIVE, and a welcome email exists for the address.
- It would survive reordering the two internal calls, or sending the welcome via a different mechanism that still results in a welcome email.
- It would *fail* if the user were saved with the wrong email or status (the brittle one wouldn't catch that).

**Hint:** replace the verifying mocks with simple in-memory fakes that record state, then assert on that state.

<details>
<summary>Solution</summary>

```java
// Simple fakes — real, inspectable implementations of the seams.
class FakeUserRepo implements UserRepo {
    private final Map<String, User> byEmail = new HashMap<>();
    public void save(User u) { byEmail.put(u.email(), u); }
    Optional<User> findByEmail(String e) { return Optional.ofNullable(byEmail.get(e)); }
}
class FakeMailer implements Mailer {
    final List<String> welcomed = new ArrayList<>();
    public void sendWelcome(String email) { welcomed.add(email); }
}

@Test
void register_persistsActiveUserAndSendsWelcome() {
    FakeUserRepo repo = new FakeUserRepo();
    FakeMailer mailer = new FakeMailer();

    new Signup(repo, mailer).register("sam@x.io");

    // Outcome 1: the user is persisted, ACTIVE, with the right email.
    assertThat(repo.findByEmail("sam@x.io"))
        .get()
        .extracting(User::status)
        .isEqualTo(Status.ACTIVE);
    // Outcome 2: a welcome email exists for that address.
    assertThat(mailer.welcomed).containsExactly("sam@x.io");
}
```

**Why it's better.** The brittle test pinned the *call pattern* (`save` then `sendWelcome`, nothing else) — exactly what a refactor changes. Worse, it never checked the saved *data*, so a bug that saved the wrong status would slip through. The robust version asserts on **outcomes**: the persisted user's status and the recorded welcome. It catches a wrong-status bug the brittle test missed, and it survives any reordering or re-plumbing of the internal calls as long as the observable result holds. Fakes also validate naturally — you can extend them with a contract test (see Exercise 6) to prove they behave like the real implementations.

</details>

---

## Exercise 5 — Kill the order and log assertions

**Fragility source:** order + log text · **Language:** Python · **Difficulty:** ★★ medium

Two fragilities in one test: it pins the *order* of a result whose contract is "the set of notified users," and it greps the *log prose*, which any rewording breaks.

```python
def notify_active(users, notifier, logger):
    notified = []
    for u in users:
        if u.active:
            notifier.send(u.id)
            notified.append(u.id)
    logger.info(f"Notified {len(notified)} active users: {notified}")
    return notified

# The brittle test:
def test_notify_brittle(caplog):
    users = [User(1, True), User(2, False), User(3, True)]
    notifier = FakeNotifier()
    result = notify_active(users, notifier, logging.getLogger())
    assert result == [1, 3]                                  # pins order
    assert notifier.sent == [1, 3]                           # pins order
    assert "Notified 2 active users: [1, 3]" in caplog.text  # pins exact log prose
```

**Acceptance criteria**
- The test verifies the *set* of notified users (1 and 3), not a specific order.
- It does not assert on the log message text at all.
- It would survive changing iteration order, reformatting the log, or switching the log to structured fields.

**Hint:** compare as sets (or use `sorted`), and drop the log assertion — assert the behavior the log *describes* instead.

<details>
<summary>Solution</summary>

```python
def test_notify_sends_to_active_users():
    users = [User(1, True), User(2, False), User(3, True)]
    notifier = FakeNotifier()

    result = notify_active(users, notifier, logging.getLogger())

    assert set(result) == {1, 3}          # the SET notified — order is incidental
    assert set(notifier.sent) == {1, 3}   # same, on the observable side effect
    # No log-text assertion: the count/list is already covered by `result`.
```

**Why it's better.** The contract is "active users get notified" — a *set* membership fact. The brittle test pinned an *order* the function never promised (refactor the loop, use a set internally, parallelize, and it breaks) and it pinned the *log string* (reword "Notified" to "Sent," or change formatting, and it breaks) though neither changes behavior. The robust test compares as sets and drops the log assertion entirely — the information the log carried (*how many, which ids*) is already verified through the return value. If the *emission* of an audit log were a real requirement, you'd assert on a structured event's fields (`event.count == 2`), never the human-readable prose.

</details>

---

## Exercise 6 — Replace the god mock with a fake + contract test

**Fragility source:** white-box mocking · **Language:** Go · **Difficulty:** ★★★ hard

A service is tested with a mock `Store` that scripts return values and verifies the exact call sequence. The test is a transcript of the implementation: every refactor retranscribes it. Replace the god mock with a fake, and add a **contract test** so the fake is proven equivalent to the real store.

```go
type Store interface {
    Get(key string) (int, bool)
    Set(key string, val int)
    Incr(key string) int
}

// Subject: a counter service that increments and returns the new value.
type Counter struct{ store Store }
func (c *Counter) Bump(key string) int { return c.store.Incr(key) }

// The brittle test — scripts and verifies the exact interaction:
func TestBump_brittle(t *testing.T) {
    store := new(MockStore)
    store.On("Get", "x").Return(0, false)   // mirrors internal calls...
    store.On("Set", "x", 1).Return()        // ...that Bump might not even make
    store.On("Incr", "x").Return(1)
    c := &Counter{store: store}

    got := c.Bump("x")

    assert.Equal(t, 1, got)
    store.AssertExpectations(t)             // fails if internal call pattern changes
}
```

**Acceptance criteria**
- `TestBump` asserts on the *outcome* (the returned counter value, and the stored state), not on which `Store` methods were called.
- A `FakeStore` (real in-memory implementation) replaces the mock.
- A reusable `StoreContract(t, newStore)` runs against *both* `FakeStore` and the real implementation, proving they agree — so fake-based tests aren't lying.

**Hint:** write the fake as a plain `map`-backed `Store`; write the contract test once and parameterize it over a `func() Store` factory.

<details>
<summary>Solution</summary>

```go
// 1. A real, inspectable fake.
type FakeStore struct{ m map[string]int }
func NewFakeStore() *FakeStore { return &FakeStore{m: map[string]int{}} }
func (f *FakeStore) Get(k string) (int, bool) { v, ok := f.m[k]; return v, ok }
func (f *FakeStore) Set(k string, v int)      { f.m[k] = v }
func (f *FakeStore) Incr(k string) int        { f.m[k]++; return f.m[k] }

// 2. The subject test — asserts OUTCOME, not interaction.
func TestBump_returnsIncrementedValue(t *testing.T) {
    store := NewFakeStore()
    c := &Counter{store: store}

    assert.Equal(t, 1, c.Bump("x"))   // first bump → 1
    assert.Equal(t, 2, c.Bump("x"))   // second  → 2

    got, ok := store.Get("x")         // observable state in the store
    assert.True(t, ok)
    assert.Equal(t, 2, got)
}

// 3. The contract test — run against EVERY Store implementation.
func StoreContract(t *testing.T, newStore func() Store) {
    t.Run("incr from absent starts at 1", func(t *testing.T) {
        s := newStore()
        assert.Equal(t, 1, s.Incr("k"))
    })
    t.Run("incr accumulates", func(t *testing.T) {
        s := newStore()
        s.Incr("k")
        assert.Equal(t, 2, s.Incr("k"))
    })
    t.Run("set then get round-trips", func(t *testing.T) {
        s := newStore()
        s.Set("k", 42)
        v, ok := s.Get("k")
        assert.True(t, ok)
        assert.Equal(t, 42, v)
    })
}

func TestFakeStore_satisfiesContract(t *testing.T)  { StoreContract(t, func() Store { return NewFakeStore() }) }
func TestRedisStore_satisfiesContract(t *testing.T) { StoreContract(t, func() Store { return NewRedisStore(testClient) }) }
```

**Why it's better.** The brittle test scripted `Get`/`Set`/`Incr` in a fixed order — a transcript of one possible implementation of `Bump`. Any refactor (drop the `Get`, change to a single `Incr`, add caching) breaks it, and it never actually verified the counter *value* was right beyond the scripted return. The robust design has three parts:

1. **`TestBump`** asserts on the **outcome** — the returned value and the resulting store state — so the implementation is free to change.
2. **`FakeStore`** is a real implementation, fast and inspectable, with no scripted expectations to maintain.
3. **`StoreContract`** runs the *same* behavioral checks against the fake and the real store, **proving the fake doesn't lie**. This is the key senior move: it lets every other test use the fast fake with confidence, because the fake is held to the same contract as production.

The result: no test in the suite couples to `Bump`'s internal call pattern, the fast fake is trustworthy, and the only way to make `TestBump` red is to break the counter's actual behavior.

</details>

---

## Summary — the moves you practiced

Across these six exercises, the same handful of transformations turn fragile into robust:

- **Drive through the public API; never read private state** (Ex. 1). The internal data structure is not the contract.
- **Assert the minimum the behavior promises** (Ex. 2). Drop incidental fields — generated ids, timestamps, versions — and assert *existence* not value for generated ones.
- **Parse, don't string-match** serialized output (Ex. 3). Pin values, not byte layout, unless the wire format genuinely is the contract.
- **Assert outcomes, not interactions** (Ex. 4). Replace verifying mocks with fakes that record state; this also catches wrong-data bugs the interaction test missed.
- **Compare sets when order isn't the contract, and don't assert on log prose** (Ex. 5). Assert the behavior the log describes, through the return value or structured fields.
- **Replace god mocks with a fake + a contract test** (Ex. 6). The contract test proves the fake matches the real implementation, so fast fake-based tests stay trustworthy *and* refactor-resilient.

The unifying check, applied to every solution: *would this test survive a behavior-preserving refactor, and would it still fail if the behavior actually broke?* A robust test answers **yes** to both.

---

## Related Topics

- [`junior.md`](junior.md) — what a fragile test looks like and the three first habits.
- [`middle.md`](middle.md) — the four creep patterns and the contract-vs-implementation rule.
- [`find-bug.md`](find-bug.md) — spot the coupling in brittle test snippets.
- [`optimize.md`](optimize.md) — refactor a whole over-specified test file end-to-end.
- [Over-Mocking](../06-over-mocking/tasks.md) — exercises on mock-induced fragility.
- The `mocking-strategies`, `unit-testing-patterns`, and `test-data-management` skills — fakes vs mocks, contract tests, builders.
