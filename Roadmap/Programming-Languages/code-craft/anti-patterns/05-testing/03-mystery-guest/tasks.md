# Mystery Guest — Exercises

> **Category:** [Testing Anti-Patterns](../README.md) → **Mystery Guest** — *hands-on practice making test data local, explicit, and honest.*

---

These are **fix-it** exercises. Each gives you a test that leans on off-screen data — a hidden CSV, a far-away `setUp`, a shared fixture, a magic DB row, a silent golden file — and asks you to refactor it so the test reads top-to-bottom and you can trust it. Try each *before* opening the solution; the "why it's better" note matters more than the diff.

> **How to use this file.** Refer back to [`middle.md`](middle.md) for the local/explicit/minimal cure and Test Data Builders, and [`senior.md`](senior.md) for shared-fixture migration and the speed trade-off. The **test-data-management** and **integration-testing** skills are the real-world tools behind these patterns.

---

## Table of Contents

| # | Exercise | Source of mystery | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Inline the hidden CSV](#exercise-1--inline-the-hidden-csv) | External file | Python | ★ easy |
| 2 | [Pull the fixture into the test](#exercise-2--pull-the-fixture-into-the-test) | Far-away `setUp` | Java | ★ easy |
| 3 | [Replace the shared fixture with a builder](#exercise-3--replace-the-shared-fixture-with-a-builder) | Shared/General Fixture | Go | ★★ medium |
| 4 | [Kill the magic database row](#exercise-4--kill-the-magic-database-row) | Seeded DB row | Python | ★★ medium |
| 5 | [Make the golden-file test self-explanatory](#exercise-5--make-the-golden-file-test-self-explanatory) | Golden file | Go | ★★ medium |
| 6 | [Builder vs. Object Mother for the asserted property](#exercise-6--builder-vs-object-mother-for-the-asserted-property) | Object Mother hiding the asserted field | Java | ★★★ hard |

---

## Exercise 1 — Inline the hidden CSV

**Source:** external file · **Language:** Python · **Difficulty:** ★ easy

This test passes, but you can't tell why `42` is correct without opening a file nobody opens.

```python
# compute_total(orders) sums qty * unit_price over all orders.
def test_order_total():
    orders = load_orders("testdata/orders.csv")
    assert compute_total(orders) == 42
```

**Your task:** refactor so the input and the expected `42` are both derivable from the test body alone. No file I/O.

<details>
<summary>Solution</summary>

```python
def test_order_total_sums_qty_times_price():
    orders = [
        Order(qty=2, unit_price=10),   # 20
        Order(qty=1, unit_price=22),   # 22
    ]
    assert compute_total(orders) == 42   # 20 + 22 — checkable on sight
```

**Why it's better.** The two line items are on screen, so `42` is *derivable* — you can verify the arithmetic yourself. The test no longer touches the filesystem (faster, no fixture to drift), shares nothing with other tests, and the name says what it proves. Anyone editing `testdata/orders.csv` for some other test can no longer break this one. The hidden guest is now sitting at the table.

</details>

---

## Exercise 2 — Pull the fixture into the test

**Source:** far-away `setUp` · **Language:** Java (JUnit 5) · **Difficulty:** ★ easy

The `@BeforeEach` builds objects every test silently relies on. Read `goldGetsDiscount` alone: why should the discount apply?

```java
class PricingTest {
    Customer customer;
    Product product;

    @BeforeEach
    void setUp() {
        customer = new Customer("Ada", "UK", Tier.GOLD, 1990);
        product  = new Product("SKU-9", new BigDecimal("99.00"), Category.BOOKS);
    }

    @Test
    void goldGetsDiscount() {
        assertEquals(new BigDecimal("89.10"), pricer.quote(customer, product));
    }
}
```

**Your task:** make the fact that drives the discount (the tier) and the base price visible *in the test*, so `89.10` is derivable. Keep only neutral setup (if any) shared.

<details>
<summary>Solution</summary>

```java
class PricingTest {
    private final Pricer pricer = new Pricer();   // neutral: no interesting state, fine to share

    @Test
    void goldCustomerGetsTenPercentOff() {
        Customer gold = aCustomer().withTier(Tier.GOLD).build();   // the driving fact, local
        Product  p    = aProduct().withListPrice("99.00").build(); // the base, visible
        assertEquals(new BigDecimal("89.10"), pricer.quote(gold, p));  // 99.00 − 10%, derivable
    }

    // --- Test Data Builders ---
    static CustomerBuilder aCustomer() { return new CustomerBuilder(); }
    static ProductBuilder  aProduct()  { return new ProductBuilder(); }

    static final class CustomerBuilder {
        private Tier tier = Tier.STANDARD;           // sensible defaults
        private String country = "US";
        CustomerBuilder withTier(Tier t) { this.tier = t; return this; }
        Customer build() { return new Customer("test", country, tier, 1990); }
    }
    static final class ProductBuilder {
        private BigDecimal listPrice = new BigDecimal("1.00");
        ProductBuilder withListPrice(String p) { this.listPrice = new BigDecimal(p); return this; }
        Product build() { return new Product("SKU-TEST", listPrice, Category.BOOKS); }
    }
}
```

**Why it's better.** The test now states exactly the fact it depends on — `GOLD` — right beside the assertion, and the base `99.00` is on screen, so `89.10` checks out. The `Pricer` (no interesting state) can stay shared; the *interesting* data moved local. Builders keep this short despite being explicit, and each test gets a fresh object, so two pricing tests can no longer interfere.

</details>

---

## Exercise 3 — Replace the shared fixture with a builder

**Source:** Shared/General Fixture · **Language:** Go · **Difficulty:** ★★ medium

A package-level fixture serves every test. It's bloated, it's shared, and the tests read off-screen.

```go
// fixture.go
var standard = struct {
    Gold    *Customer
    Catalog []*Product
}{
    Gold:    &Customer{Tier: "gold", Country: "UK"},
    Catalog: buildCatalog(20), // SKU-1..SKU-20, price = 10*i
}

// pricing_test.go
func TestGoldDiscount(t *testing.T) {
    price := Quote(standard.Gold, standard.Catalog[8]) // which SKU? what price?
    if price != 81.00 {                                // why 81?
        t.Fatalf("got %v, want 81.00", price)
    }
}
```

**Your task:** give the test its own local, minimal data via a builder, so the tier and price are visible and `81.00` is derivable. Drop the dependency on `standard`.

<details>
<summary>Solution</summary>

```go
// builders.go — fresh, parameterized, sensible defaults
func aCustomer(opts ...func(*Customer)) *Customer {
    c := &Customer{Tier: "standard", Country: "US"}
    for _, o := range opts {
        o(c)
    }
    return c
}
func withTier(t string) func(*Customer) { return func(c *Customer) { c.Tier = t } }

func aProduct(opts ...func(*Product)) *Product {
    p := &Product{SKU: "SKU-TEST", Price: 1.00}
    for _, o := range opts {
        o(p)
    }
    return p
}
func withPrice(p float64) func(*Product) { return func(pr *Product) { pr.Price = p } }

// pricing_test.go
func TestGoldDiscount(t *testing.T) {
    gold := aCustomer(withTier("gold")) // the fact under test, local
    item := aProduct(withPrice(90.00))  // base price, visible
    got := Quote(gold, item)
    if got != 81.00 { // 90.00 − 10%, derivable
        t.Fatalf("Quote(gold, 90.00) = %v, want 81.00 (90 − 10%%)", got)
    }
}
```

**Why it's better.** The test owns its data: `gold` and `90.00` are on screen, so `81.00` is derivable, and the test can't be broken by another test mutating `standard.Gold` or by re-pricing `Catalog[8]`. The builder defaults the boring fields (`Country`, `SKU`) so only the *interesting* ones appear. The bloated `standard` fixture loses a consumer; once every test migrates, delete it. The failure message also now explains the expected value.

</details>

---

## Exercise 4 — Kill the magic database row

**Source:** seeded DB row · **Language:** Python (pytest) · **Difficulty:** ★★ medium

An integration test reaches for a "well-known" customer by id, seeded in `seeds.sql`. You can't see that `4071` is gold-tier, and another test mutating it would break this one by run order.

```python
def test_loyalty_discount(db):
    customer = db.query(Customer).get(4071)   # magic record; fields live in seeds.sql
    cart = Cart([CartItem("SKU-9", qty=1)])
    assert checkout(db, customer, cart).total == 89.10
```

**Your task:** create the data the test needs inside the test via a factory, name the fields that matter, and ensure isolation. Show how you'd keep it fast.

<details>
<summary>Solution</summary>

```python
import pytest

@pytest.fixture
def db():
    conn = connect_test_db()
    txn = conn.begin()          # one transaction per test...
    try:
        yield Session(conn)
    finally:
        txn.rollback()          # ...rolled back: fast + perfectly isolated
        conn.close()

def make_customer(db, *, tier="standard", country="US"):
    c = Customer(tier=tier, country=country)
    db.add(c); db.flush()
    return c

def make_product(db, *, sku, list_price):
    p = Product(sku=sku, list_price=list_price)
    db.add(p); db.flush()
    return p

def test_loyalty_discount(db):
    customer = make_customer(db, tier="gold", country="UK")     # facts that matter, visible
    product  = make_product(db, sku="SKU-9", list_price=99.00)  # base price, visible
    cart     = Cart([CartItem(product.sku, qty=1)])
    assert checkout(db, customer, cart).total == 89.10          # 99.00 − 10%, derivable
```

**Why it's better.** The gold/UK facts and the base price are on screen, so `89.10` is derivable; the test no longer depends on `seeds.sql` or on which other tests ran first. The per-test transaction-and-rollback gives total isolation (no order-coupling) while keeping it fast — the schema exists once, only the cheap rows are created and discarded. This is the standard integration-testing factoring: **share the database, keep the data fresh.**

</details>

---

## Exercise 5 — Make the golden-file test self-explanatory

**Source:** golden file · **Language:** Go · **Difficulty:** ★★ medium

A golden-file test hides *both* the input and the expected output, and tells you nothing on failure.

```go
func TestRenderReport(t *testing.T) {
    got := RenderReport(sampleData())                  // what input?
    want, _ := os.ReadFile("testdata/report.golden")   // what expected output?
    if got != string(want) {
        t.Errorf("report mismatch")                    // useless on failure
    }
}
```

**Your task:** the report really is large, so keep the *expected output* in a golden file — but make it **honest**: visible input, a named/co-located golden file, regeneration via a flag, and a diff on failure.

<details>
<summary>Solution</summary>

```go
var update = flag.Bool("update", false, "regenerate golden files")

func TestRenderReport_Weekly(t *testing.T) {
    // INPUT is a visible builder, not a second mystery:
    data := aReport().
        ForTeam("payments").
        WithMetric("deploys", 12).
        WithMetric("incidents", 1).
        Build()

    got := RenderReport(data)

    golden := filepath.Join("testdata", "render_report", "weekly.golden") // named for the test
    if *update {
        if err := os.WriteFile(golden, []byte(got), 0o644); err != nil { // go test -run X -update
            t.Fatal(err)
        }
    }
    want, err := os.ReadFile(golden)
    if err != nil {
        t.Fatalf("read golden: %v (run with -update to create it)", err)
    }
    if got != string(want) {
        t.Errorf("rendered report differs from golden (run -update to refresh):\n%s",
            unifiedDiff(string(want), got)) // shows WHAT changed
    }
}
```

**Why it's better.** The expected output stays external — correct, because a full rendered report is too large to inline — but the test is no longer a Mystery Guest: the *input* is a readable builder (you can see what's being rendered), the golden file is named for the specific test (`render_report/weekly.golden`, not `report.golden`), it's regenerable with a documented `-update` flag (so it's reproducible, never hand-edited), and a failure prints a diff a reviewer can judge. External, but honest. The one remaining discipline lives in review: a regenerated golden must be *read*, not rubber-stamped — see [`professional.md`](professional.md) on the snapshot trap.

</details>

---

## Exercise 6 — Builder vs. Object Mother for the asserted property

**Source:** Object Mother hiding the asserted field · **Language:** Java (JUnit 5) · **Difficulty:** ★★★ hard

A team uses Object Mothers everywhere. This test asserts on the *discount*, but the property that drives it (the tier) is hidden inside the Mother — so the reader can't tell why `89.10` is right.

```java
@Test
void goldGetsDiscount() {
    Customer c = CustomerMother.goldUkCustomer();      // tier hidden inside the Mother
    Product  p = ProductMother.standardBook();         // price hidden inside the Mother
    assertEquals(new BigDecimal("89.10"), pricer.quote(c, p));   // why 89.10?
}
```

**Your task:** the Object Mother is *fine for incidental context* but a *Mystery Guest for the asserted property*. Refactor so the asserted property (tier) and the base price are visible at the call site, while keeping the Mother's convenience. Explain the rule you applied.

<details>
<summary>Solution</summary>

```java
// Make Mothers RETURN BUILDERS, so a test can surface the property it asserts on.
final class CustomerMother {
    static CustomerBuilder gold() { return aCustomer().withTier(Tier.GOLD); } // named start...
}
final class ProductMother {
    static ProductBuilder book()  { return aProduct().inCategory(Category.BOOKS); }
}

@Test
void goldCustomerGetsTenPercentOff() {
    // The asserted property (GOLD) and the base price are now VISIBLE at the call site:
    Customer gold = CustomerMother.gold().build();                    // tier visible via name
    Product  book = ProductMother.book().withListPrice("99.00").build(); // base price visible
    assertEquals(new BigDecimal("89.10"), pricer.quote(gold, book)); // 99.00 − 10%, derivable
}

// Where the customer is mere CONTEXT (not asserted on), the bare Mother is fine:
@Test
void anyCustomerCanViewPublicCatalog() {
    Customer anyone = CustomerMother.gold().build();   // tier irrelevant here → hiding it is OK
    assertTrue(catalog.isViewableBy(anyone));
}
```

**The rule applied.** *Data a test's assertion depends on must be visible in the test; data that is mere context may be hidden.* In `goldCustomerGetsTenPercentOff` the discount *depends on* the tier and the base price, so both must be visible — achieved by a Mother that returns a builder (`gold()` names the tier; `.withListPrice("99.00")` surfaces the base). In `anyCustomerCanViewPublicCatalog` the customer is just *some valid user* — the tier is irrelevant, so the concise `CustomerMother.gold()` is fine. The Mother-returning-builder hybrid gives a named, intent-revealing starting point *and* the ability to make the asserted property explicit — the best of both, per [`senior.md`](senior.md).

</details>

---

## Wrap-Up

The same move solved all six: **set up exactly what this test needs, name the property under test, and when data must stay external, make it honest (named, input-visible, regenerable, diffed) rather than silent.** A test you can read top-to-bottom is a test you can trust — and one nobody else can break from across the repo.

- Recognize the shapes: [`junior.md`](junior.md)
- Sources and the local/explicit/minimal cure: [`middle.md`](middle.md)
- Untangling shared fixtures at suite scale: [`senior.md`](senior.md)
- Trade-offs and legitimate external data: [`professional.md`](professional.md)
- Spot the guest in code: [`find-bug.md`](find-bug.md) · Refactor a slow shared-fixture suite: [`optimize.md`](optimize.md)

---

## Related Topics

- [Fragile Tests](../01-fragile-tests/tasks.md) · [Flaky Tests](../02-flaky-tests/tasks.md) · [Over-Mocking](../06-over-mocking/tasks.md) — sibling testing anti-patterns.
- [Bad Structure → Development Anti-Patterns](../../01-development/01-bad-structure/tasks.md) — the production-code cousin's exercises.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — shared state and coupling at the system level.
