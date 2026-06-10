# Over-Mocking — Find the Bug

> **Category:** [Testing Anti-Patterns](../README.md) → **Over-Mocking** — *mocking so much that the test verifies the mocks, not the behavior.*

---

This file is **critical-reading practice**. Each snippet is a plausible test in Go, Java, or Python. Read it the way a good reviewer does and answer three questions:

> **Is this test over-mocked? What real bug could ship past it (or what refactor would needlessly break it)? How would you fix the test?**

The "bug" here is rarely a crash — it's a test that *looks* like it's doing its job while asserting on the wrong thing. Several snippets contain a real production bug that the over-mocked test cannot catch. One or two are deliberately innocent — a test that uses interaction verification *correctly*. Read slowly, then open the answer.

> **How to use this file:** write your own answer *before* expanding the collapsible. The skill you're training is noticing that a green test proves nothing.

---

## Table of Contents

1. [The deposit that never adds up](#snippet-1--the-deposit-that-never-adds-up)
2. [Verifying the save](#snippet-2--verifying-the-save)
3. [The mocked Money](#snippet-3--the-mocked-money)
4. [Mocking the database driver](#snippet-4--mocking-the-database-driver)
5. [The stub you then verify](#snippet-5--the-stub-you-then-verify)
6. [The email test that's actually fine](#snippet-6--the-email-test-thats-actually-fine)
7. [The deep stub chain](#snippet-7--the-deep-stub-chain)
8. [verifyNoMoreInteractions](#snippet-8--verifynomoreinteractions)

---

## Snippet 1 — The deposit that never adds up

```python
# Python — testing a wallet deposit
from unittest.mock import MagicMock

def test_deposit():
    repo = MagicMock()
    account = MagicMock()
    account.balance = 100
    repo.get.return_value = account

    Wallet(repo).deposit("acc-1", 50)

    repo.get.assert_called_once_with("acc-1")
    repo.save.assert_called_once_with(account)
```

> Is this test over-mocked? What bug could ship past it? How would you fix the test?

<details>
<summary>Answer</summary>

**Over-mocked — and it would pass over a complete failure of the deposit logic.**

The test asserts only that `get` and `save` were *called*. It never reads `account.balance` after the deposit, and `account` is a `MagicMock`, so `account.balance += 50` runs against a mock attribute nobody inspects. The one thing a deposit must do — increase the balance by the amount — is never checked.

**The bug it hides:** change `deposit` to `account.balance += 0` (or to subtract, or to ignore `amount`) and this test **stays green**. It depends on the *call shape*, not the behavior.

**Fix — fake the repo, assert the resulting state:**

```python
def test_deposit_increases_balance():
    repo = FakeAccountRepo({"acc-1": Account(id="acc-1", balance=100)})
    Wallet(repo).deposit("acc-1", 50)
    assert repo.get("acc-1").balance == 150     # behavior, not calls
```

Now a broken deposit fails immediately, and renaming `save` internally doesn't break the test.

</details>

---

## Snippet 2 — Verifying the save

```java
// Java — testing that an order's total is computed and persisted
@Test void placeOrder_persists() {
    OrderRepository repo = mock(OrderRepository.class);
    OrderService svc = new OrderService(repo);

    svc.place(new Order(List.of(new Item("widget", 10, 3))));   // price 10, qty 3

    verify(repo).save(any(Order.class));
}
```

> Is this test over-mocked? What bug could ship past it? How would you fix the test?

<details>
<summary>Answer</summary>

**Over-mocked.** `verify(repo).save(any(Order.class))` asserts an order was saved — *any* order. The expected total (30) is never checked.

**The bug it hides:** if `place` computes the total wrong — `price + qty` instead of `price * qty`, or forgets tax — the saved order has the wrong total and this test still passes, because `any(Order.class)` matches it. The test proves "something got saved," which is almost never the behavior you care about.

**Fix — either pin the argument, or (better) fake and read back:**

```java
// Option A: pin the argument with a captor
var captor = ArgumentCaptor.forClass(Order.class);
verify(repo).save(captor.capture());
assertThat(captor.getValue().total()).isEqualByComparingTo("30");

// Option B (preferred): fake the repo, assert on stored state
var repo = new InMemoryOrderRepository();
Order placed = new OrderService(repo).place(order);
assertThat(repo.findById(placed.id()).total()).isEqualByComparingTo("30");
```

Option B also survives refactoring of *how* the order is saved.

</details>

---

## Snippet 3 — The mocked Money

```go
// Go — testing an invoice total
func TestInvoiceTotal(t *testing.T) {
	m1 := new(MockMoney)
	m2 := new(MockMoney)
	m1.On("Add", m2).Return(Money{Cents: 1500})   // stubbed sum

	inv := &Invoice{lines: []Moneyer{m1, m2}}
	total := inv.Total()

	require.Equal(t, int64(1500), total.Cents)
	m1.AssertCalled(t, "Add", m2)
}
```

> Is this test over-mocked? What bug could ship past it? How would you fix the test?

<details>
<summary>Answer</summary>

**Over-mocked — it mocks a value object, so the arithmetic under test is faked away.**

`Money` is a pure value object: data plus arithmetic, no I/O, no boundary. The test stubs `Add` to *return* `1500`, then asserts the total is `1500` — it's testing its own stub. The real summation logic in `Total()` and in `Money.Add` never runs.

**The bug it hides:** if `Money.Add` is wrong (`m.Cents - o.Cents`), or `Total()` skips a line, the test can't tell — it scripted the answer. Worse, to even mock `Money` someone had to introduce a `Moneyer` interface, which is over-abstraction created *solely* to enable mocking (the over-mocking ↔ over-abstraction link).

**Fix — use real `Money`, drop the needless interface:**

```go
func TestInvoiceTotal(t *testing.T) {
	inv := &Invoice{lines: []Money{{Cents: 1000}, {Cents: 500}}}
	require.Equal(t, int64(1500), inv.Total().Cents)   // real arithmetic
}
```

Never mock value objects — construct them and let their behavior participate.

</details>

---

## Snippet 4 — Mocking the database driver

```java
// Java — testing a repository that queries Postgres
@Test void findActiveUsers_runsQuery() throws Exception {
    Connection conn = mock(Connection.class);
    PreparedStatement stmt = mock(PreparedStatement.class);
    ResultSet rs = mock(ResultSet.class);
    when(conn.prepareStatement(anyString())).thenReturn(stmt);
    when(stmt.executeQuery()).thenReturn(rs);
    when(rs.next()).thenReturn(true, false);
    when(rs.getString("name")).thenReturn("Ada");
    when(rs.getBoolean("active")).thenReturn(true);

    List<User> users = new UserRepository(conn).findActiveUsers();

    assertThat(users).extracting(User::name).containsExactly("Ada");
}
```

> Is this test over-mocked? What bug could ship past it? How would you fix the test?

<details>
<summary>Answer</summary>

**Over-mocked — it mocks JDBC, a third-party API you don't own,** reconstructing the entire `Connection → PreparedStatement → ResultSet` dance from memory.

**The bug it hides:** the test encodes *your guess* about JDBC and SQL. It never runs the actual SQL string, so a malformed query, a wrong column name, a missing `WHERE active = true`, or a type mismatch all pass — the mocks happily return `"Ada"`/`active=true` regardless of what the query says. You could test a SQL statement that throws against a real database and this green test would never know.

**Fix — don't mock the driver; test the repository against a real database.** This is a *boundary adapter*: its whole job is to talk to Postgres correctly, so the only meaningful test runs the real SQL.

```java
// Integration test against a real (or Testcontainers) Postgres.
@Tag("integration")
@Test void findActiveUsers_returns_only_active() {
    var repo = new UserRepository(testDataSource());
    seed("INSERT INTO users(name, active) VALUES ('Ada', true), ('Bob', false)");

    assertThat(repo.findActiveUsers()).extracting(User::name).containsExactly("Ada");
}
```

For the *callers* of the repository, hide it behind your own `UserRepository` interface and use an in-memory **fake** — never the mocked JDBC chain.

</details>

---

## Snippet 5 — The stub you then verify

```python
# Python — testing a service that reads config then acts
def test_apply_settings():
    config = MagicMock()
    config.get.return_value = {"retries": 3}

    SettingsApplier(config).apply()

    config.get.assert_called_once_with("network")   # verifying the stubbed read
```

> Is this test over-mocked? What bug could ship past it? How would you fix the test?

<details>
<summary>Answer</summary>

**Over-mocked — it stubs `config.get` and then verifies the very same call,** which is testing the test's own setup.

`config.get` is a **query** (it reads, no side effect). The test feeds it a value *and* asserts it was called with `"network"` — but the stub already guaranteed the call would return `{"retries": 3}`; verifying it adds nothing except coupling to the exact key string. Meanwhile, the actual behavior of `apply()` — what it *does* with `retries: 3` — is never asserted.

**The bug it hides:** `apply()` could ignore `retries` entirely, or apply 0 retries, and the test passes. It checks that config was *read*, not that the settings were *applied*.

**Fix — drop the verification; assert on the effect of applying the settings.**

```python
def test_apply_settings_sets_retries():
    applier = SettingsApplier(FakeConfig({"network": {"retries": 3}}))
    applier.apply()
    assert applier.network.retry_count == 3     # the actual outcome
```

Stub a query to *feed* input; never *verify* a query. Verify only commands with no observable result.

</details>

---

## Snippet 6 — The email test that's actually fine

```java
// Java — testing that a password reset sends an email
@Test void resetPassword_sends_email_with_token() {
    EmailSender emailer = mock(EmailSender.class);          // outbound port we own
    var users = new InMemoryUserRepository();
    users.save(new User("u1", "ada@example.com"));
    var svc = new PasswordResetService(users, emailer, () -> "TOKEN123");

    svc.requestReset("u1");

    var captor = ArgumentCaptor.forClass(Email.class);
    verify(emailer).send(captor.capture());
    assertThat(captor.getValue().to()).isEqualTo("ada@example.com");
    assertThat(captor.getValue().body()).contains("TOKEN123");
}
```

> Is this test over-mocked? What bug could ship past it? How would you fix the test?

<details>
<summary>Answer</summary>

**Trick snippet: this is NOT over-mocking. This is interaction testing done correctly.**

The email sender is a **side-effect-only outbound port we own** — the email *leaves* the system, so there's no local state to read back. Sending the email *is* the behavior, so verifying the `send` call is exactly right. Crucially, the test does it well:

- It mocks only the genuine boundary (`EmailSender`) and uses a **real** `UserRepository` fake and a real token generator stub.
- It **captures and asserts the arguments** — the recipient and that the body contains the token — not just `verify(emailer).send(any())`. A wrong recipient or a missing token would fail it.
- It doesn't over-specify (no `verifyNoMoreInteractions`, no call-ordering constraints).

**What would make it over-mocking:** if it mocked the `User`/`Email` value objects, mocked the repository instead of faking it, or asserted only `verify(emailer).send(any())` without checking the payload. As written, it's the textbook *legitimate* use of interaction verification.

**Lesson:** interaction testing isn't the anti-pattern — *unconstrained* interaction testing is. When the only observable effect is a call across a boundary you own, verify the call **with its arguments**.

</details>

---

## Snippet 7 — The deep stub chain

```python
# Python — testing tax calculation
def test_tax_rate():
    order = MagicMock()
    order.customer.address.country.code = "US"

    rate = TaxService().rate_for(order)

    assert rate == 0.0875
```

> Is this test over-mocked? What bug could ship past it (and what refactor would break it)? How would you fix the test?

<details>
<summary>Answer</summary>

**Over-mocked via a deep stub chain** — `order.customer.address.country.code` mocks an entire navigation path.

`MagicMock` auto-creates every attribute in the chain, so the test silently freezes the exact structure `order → customer → address → country → code`. Two problems:

1. **Fragility:** any refactor of how an order reaches a country code — flattening to `order.shipping_country`, renaming `address`, moving country onto the customer — breaks this test even though tax behavior is unchanged. It's coupled to the object graph's shape (a Law-of-Demeter / train-wreck smell).
2. **It hides a real-structure bug:** because `MagicMock` invents whatever attribute you access, the test passes even if the *real* `Order` has no such chain (e.g. the real attribute is `country_code`, not `country.code`). The production call would `AttributeError`, but the mock cheerfully returns `"US"`. The green test guarantees nothing about the real object.

**Fix — use a real (or builder-built) `Order`, and ideally simplify the production call.**

```python
def test_tax_rate_for_us():
    order = make_order(shipping_country="US")   # real object via a builder
    assert TaxService().rate_for(order) == 0.0875
```

If the chain is awkward to build, that's design feedback: have `Order` expose `order.shipping_country()` so neither the production code nor the test threads the chain.

</details>

---

## Snippet 8 — verifyNoMoreInteractions

```java
// Java — testing an order processor
@Test void process_order() {
    InventoryService inventory = mock(InventoryService.class);
    PaymentGateway payment = mock(PaymentGateway.class);
    when(inventory.reserve("sku-1", 2)).thenReturn(true);

    new OrderProcessor(inventory, payment).process(new Order("sku-1", 2));

    verify(inventory).reserve("sku-1", 2);
    verify(payment).charge(anyLong());
    verifyNoMoreInteractions(inventory, payment);   // <-- note this
}
```

> Is this test over-mocked? What bug could ship past it (or what refactor would break it)? How would you fix the test?

<details>
<summary>Answer</summary>

**Over-specified interaction testing — the `verifyNoMoreInteractions` is the over-mocking tell.**

Verifying `reserve` and `charge` happened isn't unreasonable here (both are boundary commands). The problem is `verifyNoMoreInteractions(inventory, payment)`: it asserts that *no other call of any kind* is made to those collaborators, freezing the exact call set.

**The refactor it needlessly breaks:** add a legitimate `inventory.log()` call, a metrics increment, a defensive `payment.validateToken()`, or split `charge` into `authorize` + `capture` — all behavior-preserving — and the test reds, because it forbade *any* additional interaction. The test now obstructs refactoring instead of protecting behavior.

**There's also a hidden gap:** the test never checks the *outcome* — whether the order ended up in a "paid" or "reserved" state. It pins the conversation but not the result, so a processor that calls `reserve` and `charge` but forgets to mark the order placed would pass.

**Fix — verify only the calls the contract requires, and assert the outcome.**

```java
@Test void process_order_reserves_charges_and_marks_placed() {
    var inventory = new FakeInventory(Map.of("sku-1", 5));
    var payment = mock(PaymentGateway.class);
    var orders = new InMemoryOrderRepository();
    var processor = new OrderProcessor(inventory, payment, orders);

    Order result = processor.process(new Order("sku-1", 2));

    assertThat(inventory.reservedFor("sku-1")).isEqualTo(2);   // state via fake
    verify(payment).charge(anyLong());                          // boundary command
    assertThat(orders.findById(result.id()).status()).isEqualTo(PLACED);  // outcome
    // no verifyNoMoreInteractions — incidental calls are allowed
}
```

Drop strict no-more-interactions checks unless "no other call" is genuinely part of the contract.

</details>

---

## Summary — patterns of spotting

You don't catch over-mocking by counting `mock()` calls — you catch it by asking *"could the production code be wrong while this test stays green?"* The repeatable moves from these eight snippets:

- **Find the last assertion.** If it's `verify(...)` / `assert_called(...)` with no check on a return value or final state, the test asserts calls, not behavior — and a broken implementation ships past it (Snippets 1, 2, 5).
- **Check what's mocked.** A mocked **value object** (Snippet 3) deletes the arithmetic under test; a mocked **third-party driver/SDK** (Snippet 4) freezes a guess about an API you don't own and never runs the real query.
- **Watch for stub-then-verify of a query** (Snippet 5). Stubbing feeds input; verifying the same query tests your own setup and couples to a key/argument for nothing.
- **Treat deep stub chains as a graph snapshot** (Snippet 7). `a.b.c.d` mocks freeze structure, break on refactor, and pass even when the real object's shape differs — a false green.
- **Distinguish legitimate interaction tests** (Snippet 6). When the effect leaves the system (email, event) and you verify it **with arguments**, that's correct — not over-mocking. The anti-pattern is the *unconstrained* version.
- **Resist over-specification** (Snippet 8). `verifyNoMoreInteractions` and strict ordering freeze the whole conversation; they break harmless refactors and still miss the outcome. Verify only contractually required calls, and assert the result.

The meta-lesson: **a green over-mocked test is a lie of omission.** It says "the calls I scripted happened," and you read it as "the behavior is correct." Whenever a test mocks the thing it was supposed to verify, the latent bug is hiding in exactly the place the mock made invisible.

---

## Related Topics

- [`junior.md`](junior.md) — state vs interaction; why mocking-everything stays green over real bugs.
- [`middle.md`](middle.md) — what to mock vs fake; don't mock value objects or what you don't own.
- [`tasks.md`](tasks.md) — fix these from the writing side.
- [`optimize.md`](optimize.md) — refactor a mock-everything test end to end.
- [Fragile Tests](../01-fragile-tests/find-bug.md) — the sibling find-bug file; over-mocking's nearest relative.
- The `mocking-strategies` and `integration-testing` skills.
