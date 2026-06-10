# Test Design & Fixtures — Practice Tasks

> **Category:** [Craftsmanship Disciplines](../README.md) — design tests that read clearly, run fast, and manage their own data, so a failing test names a single broken behavior.

10 graded hands-on tasks with full Go, Java, and Python solutions. Try each before expanding the solution.

---

## Table of Contents

1. [Task 1: Refactor a Tangled Test to AAA](#task-1-refactor-a-tangled-test-to-aaa)
2. [Task 2: Split a Multi-Concept Test](#task-2-split-a-multi-concept-test)
3. [Task 3: Build a Test Data Builder](#task-3-build-a-test-data-builder)
4. [Task 4: Write an Object Mother](#task-4-write-an-object-mother)
5. [Task 5: Eliminate a Mystery Guest](#task-5-eliminate-a-mystery-guest)
6. [Task 6: Make a Flaky Time Test Deterministic](#task-6-make-a-flaky-time-test-deterministic)
7. [Task 7: Add Teardown That Runs on Failure](#task-7-add-teardown-that-runs-on-failure)
8. [Task 8: Pick the Right Test Double](#task-8-pick-the-right-test-double)
9. [Task 9: Parameterize a Copy-Pasted Test](#task-9-parameterize-a-copy-pasted-test)
10. [Task 10: Break a Test Interdependence](#task-10-break-a-test-interdependence)
11. [Practice Tips](#practice-tips)

---

## Task 1: Refactor a Tangled Test to AAA

**Goal:** Rewrite a one-blob test into clear Arrange-Act-Assert, separated by blank lines, with one Act.

**Given (Python):**

```python
def test_account():
    a = Account(100); a.withdraw(30); assert a.balance == 70; a.deposit(10); assert a.balance == 80
```

<details><summary>Solution</summary>

### Python
```python
def test_withdraw_reduces_balance():
    account = Account(balance=100)   # Arrange
    account.withdraw(30)             # Act
    assert account.balance == 70     # Assert

def test_deposit_increases_balance():
    account = Account(balance=100)   # Arrange
    account.deposit(10)              # Act
    assert account.balance == 110    # Assert
```

### Java
```java
@Test void withdraw_reduces_balance() {
    Account account = new Account(100);   // Arrange
    account.withdraw(30);                 // Act
    assertEquals(70, account.balance());  // Assert
}
@Test void deposit_increases_balance() {
    Account account = new Account(100);
    account.deposit(10);
    assertEquals(110, account.balance());
}
```

### Go
```go
func TestWithdrawReducesBalance(t *testing.T) {
    account := Account{Balance: 100}   // Arrange
    account.Withdraw(30)               // Act
    if account.Balance != 70 {         // Assert
        t.Errorf("balance = %d, want 70", account.Balance)
    }
}
```

**Why:** Two actions on one account become two single-Act tests, each failing for one reason, each with a behavior-naming name.
</details>

---

## Task 2: Split a Multi-Concept Test

**Goal:** A test asserts about three unrelated behaviors. Split it so each failure names one concept.

**Given (Python):**

```python
def test_register():
    user = register("ada@x.com")
    assert user.active                      # user state
    assert mailer.last_sent == "ada@x.com"  # welcome email
    assert audit.last == "REGISTER"         # auditing
```

<details><summary>Solution</summary>

### Python
```python
def test_register_creates_active_user():
    user = register("ada@x.com")
    assert user.active

def test_register_sends_welcome_email():
    register("ada@x.com")
    assert mailer.last_sent == "ada@x.com"

def test_register_writes_audit_entry():
    register("ada@x.com")
    assert audit.last == "REGISTER"
```

**Why:** Three concepts (user state, email, audit) become three tests. Now a broken welcome email reports as `test_register_sends_welcome_email`, not a generic failure. Note: asserting several fields of *one* concept (the created user) in a single test is fine — only *separate behaviors* get split.
</details>

---

## Task 3: Build a Test Data Builder

**Goal:** Replace noisy 8-argument constructor calls in tests with a fluent builder that has valid defaults; each test overrides only the field it cares about.

**Given (Java) — every test repeats the full constructor:**

```java
Customer c = new Customer("Ada", "ada@x.com", Tier.GOLD, true, 0, "US", LocalDate.now());
```

<details><summary>Solution</summary>

### Java
```java
class CustomerBuilder {
    private String name = "Test";
    private String email = "test@x.com";
    private Tier tier = Tier.STANDARD;
    private boolean verified = true;
    private int balance = 0;

    static CustomerBuilder aCustomer() { return new CustomerBuilder(); }
    CustomerBuilder gold()         { this.tier = Tier.GOLD; return this; }
    CustomerBuilder unverified()   { this.verified = false; return this; }
    CustomerBuilder balance(int b) { this.balance = b; return this; }
    Customer build() { return new Customer(name, email, tier, verified, balance, "US", LocalDate.EPOCH); }
}

// Tests now show ONLY what matters:
Customer vip       = aCustomer().gold().build();
Customer suspicious = aCustomer().unverified().balance(-50).build();
```

### Python
```python
from dataclasses import dataclass, replace

@dataclass
class Customer:
    name: str = "Test"
    email: str = "test@x.com"
    tier: str = "STANDARD"
    verified: bool = True
    balance: int = 0

A_CUSTOMER = Customer()
vip        = replace(A_CUSTOMER, tier="GOLD")
suspicious = replace(A_CUSTOMER, verified=False, balance=-50)
```

### Go
```go
type CustomerBuilder struct{ c Customer }
func ACustomer() *CustomerBuilder { return &CustomerBuilder{Customer{Tier: "STANDARD", Verified: true}} }
func (b *CustomerBuilder) Gold() *CustomerBuilder       { b.c.Tier = "GOLD"; return b }
func (b *CustomerBuilder) Unverified() *CustomerBuilder { b.c.Verified = false; return b }
func (b *CustomerBuilder) Balance(n int) *CustomerBuilder { b.c.Balance = n; return b }
func (b *CustomerBuilder) Build() Customer              { return b.c }

// vip := ACustomer().Gold().Build()
```

**Why:** Defaults absorb the irrelevant; the test states only the meaningful field. When the constructor gains a field, one builder default changes — not every test.
</details>

---

## Task 4: Write an Object Mother

**Goal:** For a small set of fixed, well-known scenarios, provide named canned instances that read like English.

**Given:** tests repeatedly need "a verified VIP," "an unverified newcomer," "a banned user."

<details><summary>Solution</summary>

### Python
```python
class Customers:
    @staticmethod
    def vip():        return Customer(tier="GOLD", verified=True)
    @staticmethod
    def newcomer():   return Customer(tier="NONE", verified=False)
    @staticmethod
    def banned():
        c = Customers.vip(); c.banned = True; return c

# Usage reads like a sentence:
order = Order(customer=Customers.vip())
```

### Java
```java
class Customers {
    static Customer vip()      { return aCustomer().gold().build(); }
    static Customer newcomer() { return aCustomer().unverified().build(); }
    static Customer banned()   { Customer c = vip(); c.ban(); return c; }
}
```

**Why:** For a handful of fixed shapes, an Object Mother is the least code and the most readable. Reach for a **builder** instead the moment tests need arbitrary *combinations* of fields (then a Mother would need a method per combination). A common hybrid: Mother methods that return a *builder* so callers can still tweak.
</details>

---

## Task 5: Eliminate a Mystery Guest

**Goal:** A test relies on data from a shared seed file. Make it build and show its own data.

**Given (Python) — buggy: where did customer 42 come from?**

```python
def test_premium_discount():
    order = place_order(customer_id=42, total=100)  # 42 lives in seed.sql
    assert order.discount == 10                      # why 10? invisible
```

<details><summary>Solution</summary>

### Python
```python
def test_premium_discount(db):
    customer = a_customer().premium().build()   # build it here, visibly
    db.save(customer)
    order = place_order(customer_id=customer.id, total=100)
    assert order.discount == 10   # premium → 10% is now obvious from the fixture
```

### Java
```java
@Test void premium_discount(@Autowired CustomerRepo repo) {
    Customer customer = repo.save(aCustomer().gold().build());
    Order order = orders.place(customer.id(), 100);
    assertEquals(10, order.discount());   // the 'why' is in the test
}
```

### Go
```go
func TestPremiumDiscount(t *testing.T) {
    db := newTestDB(t)
    customer := db.Save(ACustomer().Gold().Build())
    order := PlaceOrder(db, customer.ID, 100)
    if order.Discount != 10 {
        t.Errorf("discount = %d, want 10", order.Discount)
    }
}
```

**Why:** The reader now sees that the customer is premium, which explains the expected 10% discount. No external seed file, no "don't touch row 42," no silent breakage when the seed changes.
</details>

---

## Task 6: Make a Flaky Time Test Deterministic

**Goal:** A test depends on the wall clock and can straddle a date boundary. Inject a clock so it's Repeatable.

**Given (Python) — flaky:**

```python
def test_token_expired():
    token = Token(created=datetime.now() - timedelta(hours=2))
    assert token.is_expired()   # depends on now(); fragile near boundaries
```

<details><summary>Solution</summary>

### Python
```python
class Token:
    def __init__(self, created): self.created = created
    def is_expired(self, now):                    # time injected
        return (now - self.created) > timedelta(hours=1)

def test_token_expired():
    created = datetime(2025, 1, 1, 10, 0)
    now     = datetime(2025, 1, 1, 12, 30)        # fixed
    assert Token(created).is_expired(now)
```

### Java
```java
class Token {
    private final Instant created;
    Token(Instant c) { this.created = c; }
    boolean isExpired(Clock clock) {
        return Duration.between(created, clock.instant()).toHours() >= 1;
    }
}
@Test void token_expired() {
    Clock fixed = Clock.fixed(Instant.parse("2025-01-01T12:30:00Z"), ZoneOffset.UTC);
    Token token = new Token(Instant.parse("2025-01-01T10:00:00Z"));
    assertTrue(token.isExpired(fixed));
}
```

### Go
```go
type Token struct{ Created time.Time }
func (t Token) Expired(now time.Time) bool { return now.Sub(t.Created) > time.Hour }

func TestTokenExpired(t *testing.T) {
    created := time.Date(2025, 1, 1, 10, 0, 0, 0, time.UTC)
    now     := time.Date(2025, 1, 1, 12, 30, 0, 0, time.UTC)
    if !(Token{created}).Expired(now) { t.Fatal("want expired") }
}
```

**Why:** Time is now an injected input, not a hidden call to `now()`. The test gives identical results every run, on any machine, at any hour. Same seam applies to `random()` and ID generation.
</details>

---

## Task 7: Add Teardown That Runs on Failure

**Goal:** A test opens a resource and closes it only on the happy path. Move cleanup into a hook so it runs even when an assertion fails.

**Given (Python) — buggy: leaks on failure:**

```python
def test_export():
    f = open("out.csv", "w")
    write_report(f)
    assert f.tell() > 0    # if this fails ↓
    f.close()              # skipped → leaked file handle
```

<details><summary>Solution</summary>

### Python
```python
@pytest.fixture
def out_file(tmp_path):
    f = open(tmp_path / "out.csv", "w")
    yield f
    f.close()              # teardown — runs on pass AND failure

def test_export(out_file):
    write_report(out_file)
    assert out_file.tell() > 0
```

### Java
```java
class ExportTest {
    Path tmp; Writer w;
    @BeforeEach void setUp() throws IOException {
        tmp = Files.createTempFile("out", ".csv");
        w = Files.newBufferedWriter(tmp);
    }
    @AfterEach void tearDown() throws IOException { w.close(); Files.deleteIfExists(tmp); }

    @Test void export_writes_data() throws IOException {
        writeReport(w); w.flush();
        assertTrue(Files.size(tmp) > 0);
    }
}
```

### Go
```go
func TestExport(t *testing.T) {
    f, err := os.CreateTemp(t.TempDir(), "out-*.csv")
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { f.Close() })   // runs even if the test fails
    writeReport(f)
    if info, _ := f.Stat(); info.Size() == 0 {
        t.Error("want non-empty file")
    }
}
```

**Why:** A failed assertion throws/aborts. Cleanup placed in a hook (`yield`, `@AfterEach`, `t.Cleanup`) runs regardless, so a failure can't leak a handle into the next test.
</details>

---

## Task 8: Pick the Right Test Double

**Goal:** For two specs, choose between a stub (state verification) and a mock (behavior verification), and justify the choice.

**Spec A:** "`late_fee(due, clock)` returns 110 when overdue." **Spec B:** "`notify(user, mailer)` sends exactly one email."

<details><summary>Solution</summary>

### Spec A — the clock is just an input → STUB + assert on the result
```python
class StubClock:
    def __init__(self, t): self._t = t
    def now(self): return self._t

def test_late_fee_when_overdue():
    fee = late_fee(due=date(2025, 1, 1), clock=StubClock(date(2025, 2, 1)))
    assert fee == 110            # state verification: assert the OUTCOME
```

### Spec B — sending the email IS the behavior → MOCK + assert on the interaction
```python
def test_notify_sends_one_email():
    mailer = Mock()
    notify(user("ada@x.com"), mailer)
    mailer.send.assert_called_once_with("ada@x.com", "alert")   # behavior verification
```

**Why:** Use a **stub** when the double merely feeds data and you assert on the result — this survives refactoring. Use a **mock** only when the *interaction itself* is the requirement (an email must be sent). Mocking Spec A's clock and verifying `clock.now()` was called would pin implementation for no benefit.
</details>

---

## Task 9: Parameterize a Copy-Pasted Test

**Goal:** Five near-identical tests differ only in input/expected. Collapse them into one parameterized test that reports each case independently.

**Given (Python):**

```python
def test_tier_free():     assert tier(0) == "free"
def test_tier_standard(): assert tier(50) == "standard"
def test_tier_premium():  assert tier(500) == "premium"
def test_tier_negative(): assert tier(-1) == "invalid"
```

<details><summary>Solution</summary>

### Python
```python
@pytest.mark.parametrize("amount, expected", [
    (0,   "free"),
    (50,  "standard"),
    (500, "premium"),
    (-1,  "invalid"),
])
def test_tier_for_amount(amount, expected):
    assert tier(amount) == expected
```

### Java
```java
@ParameterizedTest
@CsvSource({ "0, free", "50, standard", "500, premium", "-1, invalid" })
void tier_for_amount(int amount, String expected) {
    assertEquals(expected, Tier.of(amount));
}
```

### Go
```go
func TestTier(t *testing.T) {
    for name, tc := range map[string]struct{ amount int; want string }{
        "free": {0, "free"}, "standard": {50, "standard"},
        "premium": {500, "premium"}, "invalid": {-1, "invalid"},
    } {
        t.Run(name, func(t *testing.T) {
            if got := Tier(tc.amount); got != tc.want {
                t.Errorf("Tier(%d) = %q, want %q", tc.amount, got, tc.want)
            }
        })
    }
}
```

**Why:** One behavior across many inputs, one body to maintain, and each case still reports independently (`test_tier_for_amount[500-premium]`). Don't mix *different* behaviors into one parameterized test — that's a multi-concept smell.
</details>

---

## Task 10: Break a Test Interdependence

**Goal:** Two tests share a mutable fixture; the second passes only if the first ran. Make each independent.

**Given (Python) — buggy: order-dependent:**

```python
@pytest.fixture(scope="module")
def cart():
    return Cart()                      # ONE cart shared by all tests

def test_add_item(cart):
    cart.add("book")
    assert len(cart.items) == 1

def test_empty_cart(cart):
    assert len(cart.items) == 0        # FAILS if test_add_item ran first
```

<details><summary>Solution</summary>

### Python
```python
@pytest.fixture                        # default scope="function" → fresh per test
def cart():
    return Cart()

def test_add_item(cart):
    cart.add("book")
    assert len(cart.items) == 1

def test_empty_cart(cart):
    assert len(cart.items) == 0        # always passes — its own clean cart
```

### Java
```java
class CartTest {
    Cart cart;
    @BeforeEach void setUp() { cart = new Cart(); }   // fresh per test

    @Test void add_item()   { cart.add("book"); assertEquals(1, cart.size()); }
    @Test void empty_cart() { assertEquals(0, cart.size()); }
}
```

### Go
```go
func TestAddItem(t *testing.T) {
    cart := NewCart()                  // fresh inside each test
    cart.Add("book")
    if cart.Size() != 1 { t.Errorf("size = %d, want 1", cart.Size()) }
}
func TestEmptyCart(t *testing.T) {
    cart := NewCart()
    if cart.Size() != 0 { t.Errorf("size = %d, want 0", cart.Size()) }
}
```

**Why:** A module-scoped mutable fixture couples tests through shared state — the classic interdependence flake. A fresh fixture per test restores Independence; the tests now pass alone, in any order, and in parallel. Verify with `pytest -p randomly` / `go test -shuffle=on`.
</details>

---

## Practice Tips

1. **Mark Arrange-Act-Assert** until it's automatic; one Act per test.
2. **Split by concept** — one reason to fail per test.
3. **Build objects with a builder/factory**; let defaults hide the irrelevant.
4. **Each test builds its own data, visibly** — no mystery guests.
5. **Inject time/random/IDs** through a seam; never call `now()`/`random()` in testable logic.
6. **Put teardown in a hook** so it runs on failure.
7. **Stub when feeding data, mock only when the interaction is the requirement.**
8. **Default to fresh fixtures**; run shuffled/parallel to catch interdependence.

---

[← Interview](interview.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
