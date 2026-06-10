# Over-Mocking — Exercises

> **Category:** [Testing Anti-Patterns](../README.md) → **Over-Mocking** — *hands-on practice replacing mock-soup with behavior tests.*

---

These are **fix-it** exercises, not recognition quizzes. Each gives a problem statement, starting code (Go, Java, or Python — the language varies on purpose), acceptance criteria, and a collapsible solution. The point is to *make the change*: replace a mock-heavy test with a fake and a state assertion, remove the verification of an internal call, wrap a third-party type instead of mocking it, and choose the right double for a given collaborator.

> **How to use this file.** Read the problem, do it in your editor *before* opening the solution, then compare. The "why it's better" note matters more than the diff. Refer back to [`middle.md`](middle.md) for the decision rules and [`senior.md`](senior.md) for fakes and contract tests.

---

## Table of Contents

| # | Exercise | Skill | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Replace the mock with a fake + state assertion](#exercise-1--replace-the-mock-with-a-fake--state-assertion) | Fakes / state | Python | ★ easy |
| 2 | [Remove the verification of an internal call](#exercise-2--remove-the-verification-of-an-internal-call) | Outcome vs interaction | Java | ★ easy |
| 3 | [Stop mocking the value object](#exercise-3--stop-mocking-the-value-object) | Don't mock values | Go | ★★ medium |
| 4 | [Wrap the third-party type instead of mocking it](#exercise-4--wrap-the-third-party-type-instead-of-mocking-it) | Don't mock what you don't own | Go | ★★ medium |
| 5 | [Choose the right double for each collaborator](#exercise-5--choose-the-right-double-for-each-collaborator) | Double selection | Python | ★★ medium |
| 6 | [Make the mocked boundary honest with a contract test](#exercise-6--make-the-mocked-boundary-honest-with-a-contract-test) | Contract tests | Java | ★★★ hard |

---

## Exercise 1 — Replace the mock with a fake + state assertion

**Skill:** Fakes / state · **Language:** Python · **Difficulty:** ★ easy

This test mocks the repository and only checks that `save` was called. It passes even if the discount math is wrong. Rewrite it with an in-memory fake and a state assertion.

```python
# Code under test
class Cart:
    def __init__(self, repo):
        self.repo = repo

    def apply_discount(self, cart_id, percent):
        cart = self.repo.get(cart_id)
        cart.total = cart.total * (1 - percent / 100)
        self.repo.save(cart)
        return cart.total
```

```python
# The over-mocked test
from unittest.mock import MagicMock

def test_apply_discount():
    repo = MagicMock()
    cart = MagicMock(total=200)
    repo.get.return_value = cart
    Cart(repo).apply_discount("c1", 10)
    repo.save.assert_called_once_with(cart)
```

**Acceptance criteria**
- The test uses a real (in-memory) fake repository, not `MagicMock`.
- It asserts on the resulting **total** (state), not on whether `save` was called.
- If `apply_discount` is changed to ignore `percent`, the new test must **fail**.

<details>
<summary>Solution</summary>

```python
class FakeCartRepo:
    def __init__(self, carts):
        self._carts = {c.id: c for c in carts}
    def get(self, cart_id):
        return self._carts[cart_id]
    def save(self, cart):
        self._carts[cart.id] = cart

def test_apply_discount_reduces_total():
    repo = FakeCartRepo([CartData(id="c1", total=200)])
    Cart(repo).apply_discount("c1", 10)
    assert repo.get("c1").total == 180     # state: real outcome
```

**Why it's better.** The fake runs real `get`/`save` semantics, so the test reads the *actual* total back out. A `MagicMock` cart let `cart.total * (1 - percent/100)` run against a mock attribute that nobody checked. Now if `apply_discount` ignores `percent` (`cart.total = cart.total`), the assertion `== 180` fails immediately — the test depends on the behavior being correct, which is the whole point.

</details>

---

## Exercise 2 — Remove the verification of an internal call

**Skill:** Outcome vs interaction · **Language:** Java (JUnit 5 + Mockito) · **Difficulty:** ★ easy

This test verifies a *query* call (`findById`) and stubs the same call it verifies. The verification adds nothing and couples the test to the implementation. Strip the redundant interaction checks and assert on the outcome instead.

```java
// Code under test
class PricingService {
    private final ProductRepository repo;
    PricingService(ProductRepository repo) { this.repo = repo; }

    BigDecimal priceWithTax(String productId) {
        Product p = repo.findById(productId);
        return p.basePrice().multiply(new BigDecimal("1.20"));   // 20% tax
    }
}
```

```java
// The over-mocked test
@Test void priceWithTax_mocked() {
    ProductRepository repo = mock(ProductRepository.class);
    Product p = mock(Product.class);
    when(p.basePrice()).thenReturn(new BigDecimal("100"));
    when(repo.findById("p1")).thenReturn(p);

    new PricingService(repo).priceWithTax("p1");

    verify(repo).findById("p1");       // verifying a query — pointless
    verify(p).basePrice();             // verifying a getter — pointless
}
```

**Acceptance criteria**
- No `verify(...)` calls remain (the collaborators here are queries, not commands).
- The test asserts on the **returned price**.
- `Product` is a real value object, not a mock (it's pure data).

<details>
<summary>Solution</summary>

```java
@Test void priceWithTax_applies_20_percent() {
    var repo = new InMemoryProductRepository();
    repo.save(new Product("p1", new BigDecimal("100")));   // real value object

    BigDecimal price = new PricingService(repo).priceWithTax("p1");

    assertThat(price).isEqualByComparingTo("120");   // outcome
}
```

**Why it's better.** `findById` and `basePrice()` are *queries* — they have no side effects, so verifying them asserts pure implementation detail and breaks on any harmless refactor (e.g. caching the product locally). The real behavior — applying 20% tax — was never checked. The rewrite uses a fake repo and a real `Product`, and asserts the only thing that matters: the price came out to 120. Verify *commands*, never queries.

</details>

---

## Exercise 3 — Stop mocking the value object

**Skill:** Don't mock value objects · **Language:** Go (testify) · **Difficulty:** ★★ medium

This test mocks `Money`, a pure value object, so the addition logic is never actually exercised. Replace the mock with the real value type.

```go
// Value object — pure data + behavior, no I/O
type Money struct{ Cents int64 }

func (m Money) Add(o Money) Money { return Money{Cents: m.Cents + o.Cents} }

// Code under test
type Invoice struct{ lines []Money }

func (inv *Invoice) Total() Money {
	sum := Money{}
	for _, line := range inv.lines {
		sum = sum.Add(line)
	}
	return sum
}
```

```go
// The over-mocked test (using a hand-rolled mock of Money)
type MockMoney struct{ mock.Mock }
func (m *MockMoney) Add(o Money) Money {
	args := m.Called(o)
	return args.Get(0).(Money)
}

func TestInvoiceTotal_Mocked(t *testing.T) {
	// ...elaborate setup stubbing Add() to return canned sums...
	// asserts Add was called twice; never checks the real total
}
```

**Acceptance criteria**
- No mock of `Money` (it's a value object).
- The test constructs real `Money` values and asserts on the real `Total()`.
- The test would catch a bug in `Add` (e.g. subtracting instead of adding).

<details>
<summary>Solution</summary>

```go
func TestInvoiceTotal(t *testing.T) {
	inv := &Invoice{lines: []Money{{Cents: 1000}, {Cents: 250}, {Cents: 99}}}

	total := inv.Total()

	require.Equal(t, int64(1349), total.Cents)   // real summation
}
```

**Why it's better.** `Money` has no boundary to isolate — it's pure data and arithmetic, and that arithmetic is exactly what `Total()` relies on. Mocking `Add` to return canned sums meant the test asserted "`Add` was called twice" while *never summing anything*. With real `Money`, a bug in `Add` (say, `m.Cents - o.Cents`) makes the total wrong and the assertion fails. **Never mock value objects — construct them and let their real behavior participate in the test.**

</details>

---

## Exercise 4 — Wrap the third-party type instead of mocking it

**Skill:** Don't mock what you don't own · **Language:** Go · **Difficulty:** ★★ medium

`NotificationService` mocks a third-party `twilio.Client` directly. That couples the test to Twilio's API and bakes in a guess about its behavior. Introduce a port you own, wrap Twilio behind it, and make the test mock *your* interface.

```go
// Code under test — depends directly on the third-party SDK type.
type NotificationService struct{ tw *twilio.Client }

func (s *NotificationService) AlertLowBalance(phone string, balanceCents int64) error {
	msg := fmt.Sprintf("Low balance: $%.2f", float64(balanceCents)/100)
	_, err := s.tw.Messages.Create(&twilio.MessageParams{To: phone, Body: msg})
	return err
}
```

```go
// The over-mocked test — mocks the Twilio SDK directly (don't!)
func TestAlert_MockingTwilio(t *testing.T) {
	mockTwilio := new(MockTwilioClient)   // a mock of a type we don't own
	mockTwilio.On("Messages.Create", mock.Anything).Return(&twilio.Message{}, nil)
	// ...assert Messages.Create was called...
}
```

**Acceptance criteria**
- A new interface (port) owned by your package expresses what *your* code needs (e.g. `SMSSender`).
- `NotificationService` depends on the port, not on `twilio.Client`.
- The unit test mocks/fakes *your* port and asserts on the message content.
- You note where an **integration test** for the real Twilio adapter belongs.

<details>
<summary>Solution</summary>

```go
// Port your package owns — in YOUR terms, not Twilio's.
type SMSSender interface {
	Send(to, body string) error
}

// Adapter — the ONLY place that touches the third-party SDK.
type twilioSender struct{ client *twilio.Client }

func (s *twilioSender) Send(to, body string) error {
	_, err := s.client.Messages.Create(&twilio.MessageParams{To: to, Body: body})
	if err != nil {
		return fmt.Errorf("twilio send: %w", err)
	}
	return nil
}

// Service now depends on the port.
type NotificationService struct{ sms SMSSender }

func (s *NotificationService) AlertLowBalance(phone string, balanceCents int64) error {
	body := fmt.Sprintf("Low balance: $%.2f", float64(balanceCents)/100)
	return s.sms.Send(phone, body)
}
```

```go
// Unit test: a recording fake of OUR port — assert on the message.
type fakeSMS struct{ sent []struct{ to, body string } }

func (f *fakeSMS) Send(to, body string) error {
	f.sent = append(f.sent, struct{ to, body string }{to, body})
	return nil
}

func TestAlertLowBalance(t *testing.T) {
	sms := &fakeSMS{}
	svc := &NotificationService{sms: sms}

	require.NoError(t, svc.AlertLowBalance("+15551234", 999))

	require.Len(t, sms.sent, 1)
	require.Equal(t, "+15551234", sms.sent[0].to)
	require.Equal(t, "Low balance: $9.99", sms.sent[0].body)   // behavior: correct formatting
}
```

**Why it's better.** The unit test now verifies *your* logic — phone routing and message formatting — against a tiny interface you fully understand, with no dependency on Twilio's API shape. The `$9.99` formatting bug would be caught. The seam that actually crosses into Twilio lives in `twilioSender`, which gets one **integration test** against Twilio's test credentials (the `integration-testing` skill) — so the real boundary is verified exactly once, in the right place, instead of being faked-and-guessed in every unit test.

</details>

---

## Exercise 5 — Choose the right double for each collaborator

**Skill:** Double selection · **Language:** Python · **Difficulty:** ★★ medium

`CheckoutService` has five collaborators. For each, decide the correct treatment (real / stub / fake / mock-and-verify) and justify it, then write the test.

```python
class CheckoutService:
    def __init__(self, order_repo, pricing, clock, payment_gateway, receipt_emailer):
        self.order_repo = order_repo          # stateful: save/get orders
        self.pricing = pricing                # pure: computes totals from items
        self.clock = clock                    # non-deterministic: now()
        self.payment_gateway = payment_gateway  # external service (you own the port)
        self.receipt_emailer = receipt_emailer  # side-effect-only outbound port

    def checkout(self, cart):
        total = self.pricing.total(cart.items)
        order = Order(id=new_id(), total=total, placed_at=self.clock.now())
        self.payment_gateway.charge(total, cart.payment_token)
        self.order_repo.save(order)
        self.receipt_emailer.send(cart.email, order)
        return order
```

**Acceptance criteria**
- For each of the five collaborators, name the treatment and a one-line reason.
- Write a test that uses those treatments and asserts on outcomes where possible.

<details>
<summary>Solution</summary>

| Collaborator | Treatment | Reason |
|---|---|---|
| `pricing` | **Real** (or a trivial real impl) | Pure logic with no I/O — exercising it is the point |
| `order_repo` | **Fake** (in-memory) | Stateful — assert the saved order's state by reading it back |
| `clock` | **Stub** (fixed time) | Non-determinism is the only thing to isolate |
| `payment_gateway` | **Mock/fake your port** + verify the charge | External boundary; the charge is a command with no local state |
| `receipt_emailer` | **Recording fake** (or mock + args) | Side-effect-only outbound port; the email *is* the behavior |

```python
def test_checkout():
    repo = InMemoryOrderRepo()
    clock = FixedClock(datetime(2026, 1, 1, 12, 0))
    gateway = RecordingGateway()      # records charges; a fake, not a magic mock
    emailer = RecordingEmailer()      # records sent emails
    svc = CheckoutService(
        order_repo=repo, pricing=RealPricing(), clock=clock,
        payment_gateway=gateway, receipt_emailer=emailer,
    )
    cart = Cart(items=[Item(price=10, qty=2)], payment_token="tok", email="a@b.com")

    order = svc.checkout(cart)

    # outcome / state
    assert order.total == 20
    assert repo.get(order.id).placed_at == datetime(2026, 1, 1, 12, 0)
    # boundary command — verify it happened with right args (no local state to read)
    assert gateway.charges == [(20, "tok")]
    # side-effect-only port — the email is the behavior
    assert emailer.sent == [("a@b.com", order.id)]
```

**Why it's better.** Each collaborator gets the *least powerful* double that fits: real pricing exercises real math; the fake repo lets us assert the persisted order's state; the stubbed clock makes the timestamp deterministic; and the two outbound effects (charge, email) are recorded and asserted by *content*, not just occurrence. No `MagicMock` reflex, no value-object mocking, and every assertion is on observable behavior. This is the [`middle.md`](middle.md) decision table applied end to end.

</details>

---

## Exercise 6 — Make the mocked boundary honest with a contract test

**Skill:** Contract tests · **Language:** Java (JUnit 5) · **Difficulty:** ★★★ hard

Your suite uses an `InMemoryAccountRepository` fake everywhere for speed. Good — but how do you know the fake behaves like the real `JdbcAccountRepository`? Write a **contract test** that runs the same behavioral expectations against both implementations, so the fake can't drift.

```java
public interface AccountRepository {
    Optional<Account> findById(String id);
    void save(Account a);                  // upsert
}
```

**Acceptance criteria**
- An abstract contract class encodes the port's behavioral guarantees (save-then-find, upsert overwrites, missing → empty).
- Two concrete subclasses run that contract against the fake and the real JDBC repo.
- The JDBC subclass is tagged so it runs only in the integration stage.

<details>
<summary>Solution</summary>

```java
// The contract: behavioral guarantees every AccountRepository must satisfy.
abstract class AccountRepositoryContract {

    protected abstract AccountRepository newRepository();

    @Test void save_then_find_returns_the_saved_account() {
        var repo = newRepository();
        repo.save(new Account("a", 100));
        assertThat(repo.findById("a"))
            .get().extracting(Account::balance).isEqualTo(100);
    }

    @Test void save_is_an_upsert_overwriting_by_id() {
        var repo = newRepository();
        repo.save(new Account("a", 100));
        repo.save(new Account("a", 250));     // same id
        assertThat(repo.findById("a"))
            .get().extracting(Account::balance).isEqualTo(250);
    }

    @Test void find_missing_returns_empty() {
        assertThat(newRepository().findById("nope")).isEmpty();
    }
}

// Runs the contract against the FAST fake (unit stage).
class InMemoryAccountRepositoryTest extends AccountRepositoryContract {
    protected AccountRepository newRepository() {
        return new InMemoryAccountRepository();
    }
}

// Runs the SAME contract against the real DB (integration stage).
@Tag("integration")
class JdbcAccountRepositoryTest extends AccountRepositoryContract {
    protected AccountRepository newRepository() {
        return new JdbcAccountRepository(TestDataSource.freshSchema());
    }
}
```

**Why it's better.** Every fast unit test in the suite leans on the fake. The contract test is what *earns* that trust: it proves the fake and the real JDBC repo agree on exactly the behaviors tests depend on (save-then-find, upsert, missing → empty). If someone "optimizes" the fake and accidentally makes `save` *insert* instead of *upsert*, the contract's `save_is_an_upsert` test fails against the fake — caught before any downstream unit test silently relies on wrong behavior. This is the senior-level move that makes "mock at the boundary, fake the rest" safe at scale: the seam the fake hides is *verified against reality*, not assumed. (See [`senior.md`](senior.md) on contract-test layering.)

</details>

---

## Where to Go Next

- [`find-bug.md`](find-bug.md) — spot over-mocking in code that looks fine at a glance.
- [`optimize.md`](optimize.md) — refactor a brittle mock-everything test end to end, with a contract test for the boundary.
- [`interview.md`](interview.md) — articulate the judgment these exercises build.

---

## Related Topics

- [`junior.md`](junior.md) / [`middle.md`](middle.md) / [`senior.md`](senior.md) / [`professional.md`](professional.md) — the level files.
- [Fragile Tests](../01-fragile-tests/tasks.md) — the sibling exercises.
- The `mocking-strategies`, `dependency-injection`, and `integration-testing` skills.
