# Over-Mocking — Refactoring Practice

> **Category:** [Testing Anti-Patterns](../README.md) → **Over-Mocking** — *mocking so much that the test verifies the mocks, not the behavior.*

---

This file is not "spot the smell" — [`find-bug.md`](find-bug.md) does that. Here you take a **brittle, mock-everything test that already passes** and refactor it into a test that verifies *behavior*: fakes for stateful collaborators, outcome/state assertions, interaction checks only at the genuine boundaries — plus a **contract test** so the boundary the fake hides is verified against reality. The skill on display is the *transformation* and the *trade-off reasoning*, not just the destination.

The discipline:

1. **Name what each collaborator is** — value object, stateful port, boundary you own, third-party, side-effect-only port. The treatment follows from the kind (the [`middle.md`](middle.md) decision table).
2. **Replace mocks with the least powerful double that works** — real object > fake > stub > mock. Pull the assertion toward observable state.
3. **Back the remaining boundary doubles with a higher-fidelity test** — an integration or contract test — so the fast test's speed doesn't cost you fidelity.
4. **Prove the new test is stronger:** introduce a real production bug and confirm the *new* test reds where the *old* one stayed green.

Each solution weighs the **classicist/mockist** trade-off explicitly, because right-sizing doubles is a judgment call, not a rule you can apply blind.

> **How to use this file:** read the "Before" test, plan your move sequence *yourself* before expanding the solution, then compare. The gap between your plan and the worked one is where the learning is.

---

## Table of Contents

| # | Exercise | Move | Lang |
|---|---|---|---|
| 1 | [From verify-the-save to assert-the-state](#exercise-1--from-verify-the-save-to-assert-the-state) | Mock → fake + state | Python |
| 2 | [Un-mock the value object](#exercise-2--un-mock-the-value-object) | Mock → real object | Java |
| 3 | [Wrap the third party, then contract-test it](#exercise-3--wrap-the-third-party-then-contract-test-it) | Mock SDK → port + fake + integration | Go |
| 4 | [Right-size a mock-everything service test](#exercise-4--right-size-a-mock-everything-service-test) | Whole-suite right-sizing | Java |
| 5 | [Make the boundary honest with a consumer-driven contract](#exercise-5--make-the-boundary-honest-with-a-consumer-driven-contract) | Mock → CDC | (process + pseudocode) |

---

## Exercise 1 — From verify-the-save to assert-the-state

**Move:** mock → fake + state assertion. **Goal:** a test that fails when the deposit math is wrong.

### Before — mock-everything, green over a real bug

```python
from unittest.mock import MagicMock

def test_deposit():
    repo = MagicMock()
    account = MagicMock(); account.balance = 100
    repo.get.return_value = account

    Wallet(repo).deposit("acc-1", 50)

    repo.get.assert_called_once_with("acc-1")
    repo.save.assert_called_once_with(account)     # only checks calls
```

This passes even if `deposit` does `account.balance += 0`. It asserts the *conversation* (`get`, `save`), never the *result* (balance == 150).

<details>
<summary>Refactored solution</summary>

**Plan:** (1) replace the `MagicMock` repo with an in-memory **fake** that holds real state; (2) drop the `assert_called` interaction checks; (3) assert on the balance read back from the fake; (4) prove it by breaking the production line.

```python
class FakeAccountRepo:
    def __init__(self, accounts):
        self._a = {a.id: a for a in accounts}
    def get(self, account_id):
        return self._a[account_id]
    def save(self, account):
        self._a[account.id] = account

def test_deposit_increases_balance():
    repo = FakeAccountRepo([Account(id="acc-1", balance=100)])

    new_balance = Wallet(repo).deposit("acc-1", 50)

    assert new_balance == 150                  # outcome
    assert repo.get("acc-1").balance == 150    # state, read back from the fake
```

**Proof it's stronger.** Break the production code:

```python
def deposit(self, account_id, amount):
    account = self.repo.get(account_id)
    account.balance += 0          # BUG injected
    self.repo.save(account)
    return account.balance
```

The *old* test stays green (`get` and `save` are still called). The *new* test fails on `new_balance == 150`. That delta is the entire value of the refactor.

**Trade-off note.** This is the classicist move: real(ish) collaborator, assert on state, ignore the call shape. The fake is written once and reused across every wallet test. The only thing we gave up — the ability to assert *exactly which* repo methods were called — was never worth asserting here, because `get`/`save` are queries and commands whose *effect* (the balance) is observable.

</details>

---

## Exercise 2 — Un-mock the value object

**Move:** mock → real object. **Goal:** test the actual computation, not a scripted return.

### Before — mocks the `Money` value object

```java
@Test void invoiceTotal_mocked() {
    Money line1 = mock(Money.class);
    Money line2 = mock(Money.class);
    Money partial = mock(Money.class);
    when(line1.add(line2)).thenReturn(partial);
    when(partial.amount()).thenReturn(new BigDecimal("30"));

    Invoice inv = new Invoice(List.of(line1, line2));

    assertThat(inv.total().amount()).isEqualByComparingTo("30");   // tests the stub
}
```

The "total" is whatever `partial.amount()` was stubbed to return. The real summation never runs.

<details>
<summary>Refactored solution</summary>

**Plan:** (1) `Money` is a value object — delete every mock of it; (2) construct real `Money` values; (3) assert on the real `total()`; (4) prove it by breaking `Money.add` or `Invoice.total`.

```java
@Test void invoiceTotal_sums_lines() {
    Invoice inv = new Invoice(List.of(Money.of("10.00"), Money.of("20.00")));

    assertThat(inv.total()).isEqualTo(Money.of("30.00"));   // real arithmetic
}
```

**Proof it's stronger.** Inject a bug into `Invoice.total()` — skip the last line, or into `Money.add` — subtract instead of add. The old test can't notice (it scripted `30`); the new test fails because the real sum is now wrong.

**Trade-off note.** There is *no* trade-off here — mocking a value object is never the right call. It has no boundary to isolate and no I/O to avoid; the arithmetic *is* the unit under test. Both schools (classicist and disciplined mockist) agree: **don't mock value objects.** If mocking `Money` felt necessary, that was a signal the test was reaching for `mock()` reflexively rather than asking "is this a boundary?"

</details>

---

## Exercise 3 — Wrap the third party, then contract-test it

**Move:** mock the SDK → own a port, fake it in unit tests, integration-test the adapter.

### Before — mocks the third-party S3 client directly

```go
// Production code touches the AWS SDK type directly.
type ReportArchiver struct{ s3 *awss3.Client }

func (a *ReportArchiver) Archive(name string, data []byte) (string, error) {
	_, err := a.s3.PutObject(context.TODO(), &awss3.PutObjectInput{
		Bucket: aws.String("reports"), Key: aws.String(name), Body: bytes.NewReader(data),
	})
	if err != nil {
		return "", err
	}
	return "s3://reports/" + name, nil
}

// Test mocks the AWS SDK — a type we don't own.
func TestArchive_MockingS3(t *testing.T) {
	m := new(MockS3Client)
	m.On("PutObject", mock.Anything, mock.Anything).Return(&awss3.PutObjectOutput{}, nil)
	// ...assert PutObject was called with some input...
}
```

The test freezes a guess about the AWS SDK and never proves the real upload works.

<details>
<summary>Refactored solution</summary>

**Plan:** (1) define a narrow port `BlobStore` in *our* terms; (2) move the SDK call into an adapter that's the only place importing the AWS SDK; (3) unit-test `ReportArchiver` against a **fake** `BlobStore` and assert behavior (the returned URL, the stored bytes); (4) write one **integration test** for the adapter against real S3 / LocalStack.

```go
// 1. Port we own.
type BlobStore interface {
	Put(ctx context.Context, key string, data []byte) error
}

// 2. Adapter — the ONLY file importing the AWS SDK.
type s3BlobStore struct{ client *awss3.Client; bucket string }

func (s *s3BlobStore) Put(ctx context.Context, key string, data []byte) error {
	_, err := s.client.PutObject(ctx, &awss3.PutObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(key), Body: bytes.NewReader(data),
	})
	if err != nil {
		return fmt.Errorf("s3 put %q: %w", key, err)
	}
	return nil
}

// Production code now depends on the port.
type ReportArchiver struct{ store BlobStore }

func (a *ReportArchiver) Archive(ctx context.Context, name string, data []byte) (string, error) {
	if err := a.store.Put(ctx, name, data); err != nil {
		return "", err
	}
	return "s3://reports/" + name, nil
}
```

```go
// 3. Unit test: a recording FAKE of our port. Fast, honest, asserts behavior.
type fakeBlobStore struct{ puts map[string][]byte }

func newFakeBlobStore() *fakeBlobStore { return &fakeBlobStore{puts: map[string][]byte{}} }
func (f *fakeBlobStore) Put(_ context.Context, key string, data []byte) error {
	f.puts[key] = data
	return nil
}

func TestArchive_ReturnsURLAndStoresBytes(t *testing.T) {
	store := newFakeBlobStore()
	arch := &ReportArchiver{store: store}

	url, err := arch.Archive(context.Background(), "q1.pdf", []byte("PDFDATA"))

	require.NoError(t, err)
	require.Equal(t, "s3://reports/q1.pdf", url)             // behavior: URL shape
	require.Equal(t, []byte("PDFDATA"), store.puts["q1.pdf"]) // behavior: stored content
}
```

```go
// 4. Integration test: the adapter against real S3 / LocalStack. Verifies the seam.
//go:build integration
func TestS3BlobStore_Put(t *testing.T) {
	store := &s3BlobStore{client: localStackClient(t), bucket: "reports"}
	require.NoError(t, store.Put(context.Background(), "k", []byte("x")))
	require.Equal(t, []byte("x"), getObject(t, "reports", "k"))   // real round-trip
}
```

**Proof it's stronger.** The unit test now verifies *our* archiver logic (URL construction, that the right bytes/key are stored) against an interface we fully understand — and a formatting bug in the URL is caught. The *real* S3 behavior (auth, bucket, key encoding) is verified once, in the integration test, where it belongs. The old approach verified neither: it asserted a mocked `PutObject` was called and proved nothing about the actual upload.

**Trade-off note.** We split one fast-but-dishonest test into a fast honest unit test plus one slow honest integration test. That's the deliberate classicist+boundary structure: *mock/fake your own narrow port; integration-test the adapter.* The cost is one extra (slow, tagged) test; the benefit is that nothing in the suite encodes a frozen guess about the AWS SDK.

</details>

---

## Exercise 4 — Right-size a mock-everything service test

**Move:** whole-suite right-sizing — pick the correct double per collaborator.

### Before — five mocks, asserts only interactions

```java
@Test void checkout_mocked() {
    OrderRepository repo = mock(OrderRepository.class);
    PricingService pricing = mock(PricingService.class);
    Clock clock = mock(Clock.class);
    PaymentGateway payment = mock(PaymentGateway.class);
    EmailSender emailer = mock(EmailSender.class);
    when(pricing.total(any())).thenReturn(new BigDecimal("20"));
    when(clock.instant()).thenReturn(Instant.parse("2026-01-01T12:00:00Z"));

    new CheckoutService(repo, pricing, clock, payment, emailer)
        .checkout(new Cart(List.of(new Item("widget", 10, 2)), "tok", "a@b.com"));

    verify(payment).charge(any());
    verify(repo).save(any());
    verify(emailer).send(any());     // all interaction, no outcome
}
```

Five mocks, including `pricing` (pure logic) and `repo` (stateful). Every assertion is `verify(...any())` — wrong totals, wrong recipients, wrong persisted state all pass.

<details>
<summary>Refactored solution</summary>

**Plan — classify each collaborator and assign the right double:**

| Collaborator | Was | Should be | Why |
|---|---|---|---|
| `pricing` | mock | **real** | pure logic — exercise it |
| `repo` | mock | **fake** | stateful — assert persisted state |
| `clock` | mock | **stub** (fixed) | non-determinism only |
| `payment` | mock | **mock + args** | boundary command, no local state |
| `emailer` | mock | **mock + args** (or recording fake) | side-effect-only port |

```java
@Test void checkout_charges_persists_and_emails_with_correct_data() {
    var repo = new InMemoryOrderRepository();
    var pricing = new RealPricingService();                 // real pure logic
    var clock = Clock.fixed(Instant.parse("2026-01-01T12:00:00Z"), UTC);
    var payment = mock(PaymentGateway.class);               // boundary
    var emailer = mock(EmailSender.class);                  // side-effect-only port
    var svc = new CheckoutService(repo, pricing, clock, payment, emailer);
    var cart = new Cart(List.of(new Item("widget", 10, 2)), "tok", "a@b.com");

    Order order = svc.checkout(cart);

    // outcomes / state
    assertThat(order.total()).isEqualByComparingTo("20");
    assertThat(repo.findById(order.id()).placedAt())
        .isEqualTo(Instant.parse("2026-01-01T12:00:00Z"));
    // boundary command — pin the ARGUMENTS, not mere occurrence
    verify(payment).charge(argThat(c -> c.amount().compareTo(new BigDecimal("20")) == 0
                                     && c.token().equals("tok")));
    // side-effect-only port — pin recipient
    verify(emailer).send(argThat(e -> e.to().equals("a@b.com")));
}
```

**Proof it's stronger.** Break the production code in any of three ways and a *specific* assertion fails: wrong total → `order.total()` and the `charge` matcher fail; wrong timestamp → `placedAt()` fails; wrong email → the `send` matcher fails. The old test, asserting only `verify(...any())`, survived all three.

**Trade-off note (the heart of right-sizing).** This is *not* "use fewer mocks for its own sake." It's matching the double to what's observable: pure logic and stateful work become **state** assertions (classicist), while the two effects that genuinely *leave the system* (charge, email) keep **interaction** assertions — but now pinned to arguments (disciplined mockist). We rejected dogma in both directions: a pure-classicist would struggle to assert the email (it has no local state), and a pure-mockist would needlessly mock pricing and the repo. The right answer is mixed, chosen per collaborator.

</details>

---

## Exercise 5 — Make the boundary honest with a consumer-driven contract

**Move:** a lone mock of an external service → a consumer-driven contract the provider verifies.

### Before — a mock of another team's API, standing alone

```python
# Your service calls the Inventory team's HTTP API.
def test_reserve_stock():
    inventory_api = MagicMock()
    inventory_api.reserve.return_value = {"status": "reserved", "ref": "R1"}

    result = FulfillmentService(inventory_api).fulfill(order_id="o1", sku="s1", qty=2)

    assert result.reservation_ref == "R1"
```

This encodes *your guess* about the Inventory API's response shape (`status`, `ref`). Nothing checks that the real service still returns that shape. When Inventory renames `ref` → `reservation_id`, your suite stays green and production breaks.

<details>
<summary>Refactored solution</summary>

**Plan:** keep the fast test, but turn the mock's assumptions into a **consumer-driven contract** (Pact-style) that the *provider* verifies against their real service in *their* pipeline. Now the mock can't silently drift.

```python
# Consumer side: define the interaction as a contract, run the test against
# Pact's local mock server (which RECORDS the contract), then publish it.
def test_reserve_stock_contract(pact):
    (pact
        .given("sku s1 has stock")
        .upon_receiving("a reserve request for 2 units of s1")
        .with_request("POST", "/reservations", body={"sku": "s1", "qty": 2})
        .will_respond_with(200, body={"status": "reserved", "ref": Like("R1")}))

    with pact:
        client = InventoryClient(pact.uri)          # points at the mock server
        result = FulfillmentService(client).fulfill(order_id="o1", sku="s1", qty=2)
        assert result.reservation_ref == "R1"
    # On success, Pact writes the contract (the request/response shape) to the broker.
```

```text
Provider side (Inventory team's CI, separate repo):
  - Pull every consumer contract from the broker.
  - Replay each recorded request against the REAL Inventory service.
  - Assert the real responses satisfy the consumers' expectations.
  - If they rename `ref` -> `reservation_id`, the provider build FAILS here,
    telling them — before deploy — that they'd break Fulfillment.
```

**Proof it's stronger.** With the bare mock, an Inventory API change ships and *your* production breaks with a green suite. With the contract, the change makes the *provider's* build red against the recorded expectation — the drift is caught at its source, continuously, before deploy. The mock's assumption is no longer a frozen guess; it's a verified promise.

**Trade-off note.** A consumer-driven contract costs real setup (a broker, provider-side verification, coordination between teams) and is only worth it at *cross-team service boundaries* — exactly where a lone mock's false-confidence risk is highest. For an in-process adapter you own, the cheaper in-process contract test from [`senior.md`](senior.md) (fake vs real, same abstract suite) is the right tool. The judgment: **the higher the cost of the mock being wrong, the more fidelity you buy behind it** — CDC for external services, integration tests for owned adapters, nothing extra for value objects and pure logic.

</details>

---

## Summary — the refactoring playbook

Across all five, the transformation followed the same shape:

1. **Classify the collaborator** (value object / pure logic / stateful port / owned boundary / third-party / side-effect-only port). The kind dictates the double.
2. **Downgrade to the least powerful double** that lets you assert behavior: real > fake > stub > mock. Most mocks become fakes or disappear.
3. **Pull the assertion onto observable behavior** — return value, fake state, persisted row — and where the effect leaves the system, verify the interaction **with its arguments**, never bare `any()`.
4. **Back each remaining boundary double with higher fidelity** proportional to the cost of it being wrong: nothing for values/logic, an in-process contract for owned adapters, an integration test for the real seam, a consumer-driven contract for external services.
5. **Prove the new test is stronger** by injecting a real production bug and watching the new test red where the old one stayed green. If breaking the logic doesn't break a test, the test was never testing the logic.

The trade-off you weigh every time is **isolation vs fidelity** — the classicist/mockist axis. The professional answer is never global ("always mock" / "never mock") but per-collaborator: assert state where there's state, verify interactions only where the interaction is the whole point, and never let a boundary double stand without something honest behind it.

---

## Related Topics

- [`junior.md`](junior.md) / [`middle.md`](middle.md) / [`senior.md`](senior.md) / [`professional.md`](professional.md) — the level files.
- [`find-bug.md`](find-bug.md) — spot the over-mocking these refactor away.
- [`tasks.md`](tasks.md) — smaller, focused versions of these moves.
- [Fragile Tests](../01-fragile-tests/optimize.md) — refactoring the closely related anti-pattern.
- [Design → Coupling and State](../../02-design/02-coupling-and-state/senior.md) — when the refactor must reach into production design.
- The `mocking-strategies`, `dependency-injection`, and `integration-testing` skills.
