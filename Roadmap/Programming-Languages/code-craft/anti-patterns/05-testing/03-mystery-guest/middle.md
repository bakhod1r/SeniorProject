# Mystery Guest — Middle Level

> **Category:** [Testing Anti-Patterns](../README.md) → **Mystery Guest** — *a test whose inputs or expected results come from outside the test, where the reader cannot see them.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Four Sources of a Mystery Guest](#the-four-sources-of-a-mystery-guest)
4. [Source 1 — The Shared Fixture and the Far-Away setUp](#source-1--the-shared-fixture-and-the-far-away-setup)
5. [Source 2 — The Seeded Database Row](#source-2--the-seeded-database-row)
6. [Source 3 — The Golden File](#source-3--the-golden-file)
7. [The Cure: Local, Explicit, Minimal](#the-cure-local-explicit-minimal)
8. [Test Data Builders](#test-data-builders)
9. [The Test Should Read Top-to-Bottom](#the-test-should-read-top-to-bottom)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Where does the hidden data come from?** and **What do you do instead?**

`junior.md` taught you to spot a Mystery Guest and to inline trivial inputs. Real projects make it harder: the hidden data isn't a two-line CSV you can just paste in — it's a 200-row shared fixture three files away, a database seeded by a migration, or a golden file checked in two years ago. You can't always "just inline it," and sometimes you shouldn't. This level is about **diagnosing where the guest comes from** and applying the right countermove — usually moving the relevant setup *into the test* and reaching for a **Test Data Builder** when the objects are big.

The governing principle, which everything below serves: **a test should read top-to-bottom, and the relevant data should be visible at the point where it matters.** When you can't make *all* the data local (some really must be external — a large realistic payload, a contract fixture), the next-best thing is to make it **honest and discoverable**, never silent and magic. That distinction — local-and-explicit versus external-but-honest — is the whole job, and `professional.md` pushes it further.

> Two SDK-level skills are relevant throughout this file: **test-data-management** (how to build and manage fixtures and factories) and **integration-testing** (how to handle the real databases and external services that breed seeded-row Mystery Guests). Reach for them when the fixture is bigger than a builder can comfortably handle.

---

## Prerequisites

- **Required:** You can write and run unit tests with setup/teardown (`@BeforeEach`/`setUp`/table-driven Go tests).
- **Required:** You've read [`junior.md`](junior.md) — you can spot a Mystery Guest and inline a small input.
- **Required:** You've worked with at least one shared fixture or test database, even briefly.
- **Helpful:** You've debugged a test that broke because *someone else* changed a fixture — the experience this file is designed to prevent.

---

## The Four Sources of a Mystery Guest

Every Mystery Guest you'll meet comes from one of four places. Naming the source tells you the fix:

| Source | How it arrives | The countermove |
|---|---|---|
| **Shared fixture / far-away `setUp`** | Objects built once for the whole class, reused by every test | Move the *relevant* setup into the test; minimize the shared part |
| **Seeded database row** | A "magic" record inserted by a migration or seed script | Create the row the test needs, in the test (or a factory called from it) |
| **Golden / snapshot file** | The *expected output* lives in a checked-in blob | Inline if small; if not, make it discoverable and explain how it's generated |
| **Inline literal with no derivation** | `assert x == 42` where 42 came from nowhere | Derive the expectation from named, on-screen inputs |

The first three are about *inputs and expectations living off-screen*. The fourth is subtler — the data is technically present, but its *meaning* is hidden. All four break the top-to-bottom read.

---

## Source 1 — The Shared Fixture and the Far-Away setUp

The most common Mystery Guest in a maturing codebase is the **Shared Fixture**: objects built once and reused by every test in a class. It starts as a kindness ("don't repeat the setup") and ends as a maze.

```java
// Java (JUnit 5) — the fixture is built far from the tests that use it
class PricingTest {
    Customer customer;
    Product product;

    @BeforeEach
    void setUp() {
        customer = new Customer("Ada", "UK", Tier.GOLD, 1990);  // built here...
        product  = new Product("SKU-9", new BigDecimal("99.00"), Category.BOOKS);
    }

    @Test
    void goldGetsDiscount() {
        BigDecimal price = pricer.quote(customer, product);
        assertEquals(new BigDecimal("89.10"), price);   // ...used here. Why 89.10?
    }

    @Test
    void booksAreTaxExempt() {
        BigDecimal tax = pricer.taxFor(customer, product);
        assertEquals(BigDecimal.ZERO, tax);   // is it exempt because UK? because BOOKS? both?
    }
}
```

Each test reads a fixture set up somewhere else. `goldGetsDiscount` depends on `Tier.GOLD` — but that fact is in `setUp`, not in the test, so the *reason* the discount applies is invisible. Worse, `booksAreTaxExempt` and `goldGetsDiscount` share one `customer` and one `product`, so they're coupled: tweak the shared `product` to fix one test and you may silently break the other. This is exactly how a Shared Fixture becomes a [Fragile Test](../01-fragile-tests/middle.md) generator.

**The cure** is to move the *test-relevant* part of the setup into each test, so the property under test is visible right next to the assertion that depends on it:

```java
@Test
void goldGetsTenPercentOff() {
    Customer gold = aCustomer().withTier(Tier.GOLD).build();   // the relevant fact, local
    Product p     = aProduct().withListPrice("99.00").build();
    assertEquals(new BigDecimal("89.10"), pricer.quote(gold, p));  // 99.00 − 10% — derivable
}

@Test
void booksAreTaxExempt() {
    Product book = aProduct().inCategory(Category.BOOKS).build();  // the cause is now named
    assertEquals(BigDecimal.ZERO, pricer.taxFor(anyCustomer(), book));
}
```

Now each test states exactly the fact it depends on — `GOLD`, `BOOKS` — and nothing else. (`aCustomer()` / `aProduct()` are **Test Data Builders**, covered below.)

> Not all shared setup is evil. Setup that is *truly* the same for every test and *not* the thing under test — a configured `Pricer` with no interesting state — can stay in `setUp`. The rule: **whatever a test's assertion depends on must be visible in that test.** The discriminator is data the *next* file (`senior.md`) calls "interesting": if changing it would change the expected result, it belongs in the test.

---

## Source 2 — The Seeded Database Row

Integration tests breed a particular Mystery Guest: the **magic record**. A migration or a `seeds.sql` inserts "well-known" rows, and tests reach for them by id.

```python
# Python (pytest) — what is customer 4071? you have to find the seed script.
def test_loyalty_discount(db):
    customer = db.query(Customer).get(4071)        # the magic record
    cart = Cart([CartItem("SKU-9", qty=1)])
    assert checkout(db, customer, cart).total == 89.10
```

The reader can't see that `4071` is a gold-tier UK customer — that lives in `seeds.sql`. And it's brittle: edit the seed (change `4071`'s tier for *another* test), and this one breaks for a reason invisible from here. Seeded rows also create **test-order coupling**: one test mutates `4071`, the next test assumes the original, and they pass or fail depending on run order.

**The cure** is to create the row the test needs, in the test, against a clean database — a factory the test calls explicitly, so the relevant fields are on screen:

```python
def test_loyalty_discount(db):
    customer = make_customer(db, tier="gold", country="UK")   # relevant facts, visible
    product  = make_product(db, sku="SKU-9", list_price=99.00)
    cart     = Cart([CartItem(product.sku, qty=1)])
    assert checkout(db, customer, cart).total == 89.10        # 99.00 − 10%, derivable
```

The test now owns its data, the gold/UK facts are explicit, and nothing it touches is shared with another test. Pair this with a **fresh database per test** (a transaction rolled back in teardown, or a truncate) so order-coupling can't occur — this is squarely the **integration-testing** and **test-data-management** territory. The cost is speed; `senior.md` and `professional.md` weigh that trade-off.

---

## Source 3 — The Golden File

A **golden file** (or snapshot) stores the *expected output* in a checked-in file, and the test compares against it:

```go
// Go — the expectation lives in testdata/report.golden, off-screen
func TestRenderReport(t *testing.T) {
    got := RenderReport(sampleData())
    want, _ := os.ReadFile("testdata/report.golden")   // expected output: unseen
    if got != string(want) {
        t.Errorf("report mismatch")
    }
}
```

Two mysteries: `sampleData()` (what's the input?) and `report.golden` (what's the expected output, and *why*?). When this fails, `report mismatch` tells you nothing, and you can't tell whether the code regressed or the golden file is stale.

Golden files aren't always wrong — for a large rendered artifact (a 200-line report, an HTML page), inlining the expected string would be unreadable, and a golden file is the *right* tool. The sin is making it **silent**. Make it honest:

- **Co-locate and name it** so it's obviously the expectation for *this* test (`testdata/render_report/weekly.golden`).
- **Make the input visible** — `sampleData()` should be a small, readable builder, not another mystery.
- **Support regeneration with a documented flag** so the file is reproducible, not hand-edited:

```go
var update = flag.Bool("update", false, "regenerate golden files")

func TestRenderReport(t *testing.T) {
    got := RenderReport(weeklySample())          // input: a visible builder
    golden := "testdata/render_report/weekly.golden"
    if *update {
        os.WriteFile(golden, []byte(got), 0o644)   // `go test -run TestRenderReport -update`
    }
    want, _ := os.ReadFile(golden)
    if got != string(want) {
        t.Errorf("report mismatch (run with -update to refresh):\n%s", diff(string(want), got))
    }
}
```

Now the golden file is *discoverable* (named for the test), *reproducible* (`-update` regenerates it visibly), and *diagnosable* (the failure prints a diff). It's external, but it's no longer mysterious. `professional.md` covers when external data like this is genuinely the right call.

---

## The Cure: Local, Explicit, Minimal

Across all four sources, the cure is the same triad:

- **Local** — the data the test depends on lives *in the test*, not in a shared fixture, seed script, or distant `setUp`.
- **Explicit** — the *interesting* properties (`GOLD`, `BOOKS`, `UK`) are named and visible, not buried in an id or a literal.
- **Minimal** — set up *only* what this test needs. A 50-field object where one field matters is a Mystery Guest about which field is doing the work.

The tension this creates is duplication: if every test builds its own `Customer`, you repeat the construction. The answer isn't a shared fixture (that brings back the guest) — it's a **builder** that makes per-test construction cheap and readable.

---

## Test Data Builders

A **Test Data Builder** is a small helper that constructs a valid default object and lets each test override just the fields it cares about. It gives you local, explicit, minimal data *without* the duplication that pushes people back toward shared fixtures.

```java
// Java — a builder: valid defaults, override only what matters
public class CustomerBuilder {
    private Tier tier = Tier.STANDARD;     // sensible defaults so tests stay short
    private String country = "US";
    private int birthYear = 1990;

    public static CustomerBuilder aCustomer() { return new CustomerBuilder(); }
    public CustomerBuilder withTier(Tier t)   { this.tier = t; return this; }
    public CustomerBuilder inCountry(String c){ this.country = c; return this; }
    public Customer build() { return new Customer(country, tier, birthYear); }
}

// In the test — only the relevant fact appears; everything else is a sane default
Customer gold = aCustomer().withTier(Tier.GOLD).build();
```

The win: the test mentions *only* `GOLD`, so the reader instantly sees what makes this case special. The defaults handle the boring fields. Compare this to a shared `GOLD_CUSTOMER` constant — the builder gives the same brevity but keeps the relevant fact *in the test*, and each test gets a fresh object, so there's no coupling.

```python
# Python — the same idea with a factory function and keyword overrides
def make_customer(*, tier="standard", country="US", birth_year=1990):
    return Customer(country=country, tier=tier, birth_year=birth_year)

# test:
gold = make_customer(tier="gold")   # one fact, visible; the rest defaulted
```

```go
// Go — functional options or a struct literal both work
func aCustomer(opts ...func(*Customer)) *Customer {
    c := &Customer{Country: "US", Tier: Standard, BirthYear: 1990}  // defaults
    for _, o := range opts { o(c) }
    return c
}
func WithTier(t Tier) func(*Customer) { return func(c *Customer) { c.Tier = t } }

// test:
gold := aCustomer(WithTier(Gold))   // relevant fact named; rest defaulted
```

> **Builder vs. shared constant:** both reduce duplication. The shared constant reintroduces the Mystery Guest (where is `GOLD_CUSTOMER` defined? who else uses it? is it safe to change?). The builder keeps construction *in the test* and gives a *fresh* object every time. Prefer the builder. (`senior.md` contrasts builders with the **Object Mother** pattern, which is a builder's heavier cousin.)

---

## The Test Should Read Top-to-Bottom

Every technique here serves one readability goal: a test should read like a paragraph, in order.

```
Arrange:  build the specific input this test needs (local, explicit, minimal)
Act:      run the one thing under test
Assert:   check a result you can derive from the Arrange step
```

When all three are on screen and the Assert follows from the Arrange, the test *is* its own documentation — you learn the behavior by reading it. The instant any of the three points off-screen — to a file, a seed, a far-away `setUp`, an unexplained literal — the read breaks and the Mystery Guest is back.

A quick self-check for any test: **cover everything except the test body. Can you still tell what it proves and why?** If yes, no guest. If you need to uncover a fixture, a CSV, or a seed to answer, you've found one.

---

## Common Mistakes

1. **"Extracting" a builder into a shared object that *is* the data.** A builder produces fresh, parameterized objects; a shared `GOLD_CUSTOMER` is just the Mystery Guest with a nicer name. The difference is freshness and locality.
2. **Moving setup to `setUp` to "reduce duplication."** It reduces typing and increases hunting. Duplication of *construction* is cheap to fix with a builder; duplication is not the enemy — hidden coupling is.
3. **Inlining a golden file that's genuinely huge.** A 300-line expected report pasted into the test is *also* unreadable. Some expectations belong in a golden file — just make it discoverable and regenerable.
4. **Leaving `sampleData()` as a second mystery.** Fixing the golden file but leaving the *input* off-screen only solves half the problem. Both sides of a golden test must be honest.
5. **Sharing a database across tests without isolation.** Seeded rows plus shared state equals test-order coupling and flakiness. Fresh-per-test (transaction rollback or truncate) is the price of trustworthy integration tests.
6. **Over-specifying the builder.** If a test sets ten fields to reach the one it cares about, your defaults are wrong. Good defaults mean tests mention only what's interesting.

---

## Test Yourself

1. Name the four sources a Mystery Guest comes from, and the countermove for each.
2. What's the difference between a **Test Data Builder** and a **shared fixture constant**, and why does it matter for Mystery Guest?
3. When is a golden file an acceptable choice, and what three things make it *honest* rather than mysterious?
4. A `@BeforeEach` builds a `customer` and a `product` reused by twelve tests. One test needs the customer to be gold-tier. Where should "gold-tier" live, and why?
5. Refactor so the expectation is derivable:
   ```python
   def test_total(db):
       order = db.query(Order).get(900)
       assert order_total(order) == 256.00
   ```

<details>
<summary>Answers</summary>

1. **Shared fixture / far-away `setUp`** → move the relevant setup into the test, minimize the shared part. **Seeded DB row** → create the row the test needs in the test (factory), with a fresh DB. **Golden file** → inline if small; otherwise make it discoverable + regenerable + show the input. **Unexplained literal** → derive the expectation from named, on-screen inputs.
2. A builder constructs a *fresh, parameterized* object inside the test, exposing only the fields a test overrides; a shared constant is a single off-screen object reused everywhere. The builder keeps the relevant data *local and explicit* (no Mystery Guest) and gives each test an isolated object (no coupling); the shared constant reintroduces both problems.
3. Acceptable when the expected output is large enough that inlining would be unreadable (a rendered report, an HTML page, a serialized payload). It's honest when: (a) it's **co-located and named** for the specific test, (b) the **input is visible** (a readable builder, not a second mystery), and (c) it's **regenerable via a documented flag** with a diff on failure.
4. "Gold-tier" should live **in the one test that depends on it**, not in `@BeforeEach`. The assertion's correctness depends on the tier, so the tier must be visible next to the assertion. The shared `setUp` can keep the boring, identical-for-all setup; build the gold customer locally (ideally via a builder).
5. Build the order with the line items that sum to the total, in the test:
   ```python
   def test_total_sums_line_items(db):
       order = make_order(db, items=[
           make_item(qty=2, unit_price=100.00),   # 200.00
           make_item(qty=1, unit_price=56.00),    #  56.00
       ])
       assert order_total(order) == 256.00         # 200 + 56 — derivable, no magic row
   ```

</details>

---

## Cheat Sheet

| Source | Tell | Countermove |
|---|---|---|
| Shared fixture / far-away `setUp` | The interesting fact is in `setUp`, not the test | Move per-test, relevant setup into the test; keep only neutral setup shared |
| Seeded DB row (`findById(4071)`) | Magic id; fields live in `seeds.sql` | Create the row in the test via a factory; fresh DB per test |
| Golden / snapshot file | Expected output is an unseen blob | Co-locate + name + regenerate via flag; show the input; diff on failure |
| Unexplained literal expectation | `== 42` with no derivation | Compute from named inputs the test builds |
| Duplication tempting you to share | Same construction in many tests | Use a **Test Data Builder**, not a shared constant |

> **One rule to remember:** *make the test's data local, explicit, and minimal. When data must be external, make it honest — discoverable, regenerable, and paired with a visible input — never silent and magic.*

---

## Summary

- A Mystery Guest in a real codebase comes from four sources: a **shared fixture / far-away `setUp`**, a **seeded "magic" DB row**, a **golden/snapshot file**, or an **unexplained literal**. Naming the source tells you the fix.
- The cure is always **local, explicit, minimal**: build exactly what *this* test needs, in the test, naming the properties that make the case interesting and defaulting the rest.
- **Test Data Builders** make local construction cheap and readable, defeating the duplication argument that pushes teams toward shared fixtures — and, unlike a shared constant, they keep the data in the test and give each test a fresh object.
- Some data genuinely belongs outside the test (large golden files, real databases). Then the goal shifts from *local* to **honest**: discoverable, regenerable, paired with a visible input, never silent. The **test-data-management** and **integration-testing** skills are your tools here.
- Next: [`senior.md`](senior.md) — *untangling a General/Shared Fixture across an entire suite: migrating to fresh-per-test, builders and object mothers, the speed trade-off, and making necessary external data honest at scale.*

---

## Further Reading

- **xUnit Test Patterns: Refactoring Test Code** — Gerard Meszaros (2007) — **Mystery Guest**, **Shared Fixture**, **General Fixture**, **Obscure Test**, and the **Fresh Fixture** / **Test Data Builder** remedies. The primary source.
- **Growing Object-Oriented Software, Guided by Tests** — Freeman & Pryce (2009) — the canonical treatment of Test Data Builders with sensible defaults.
- **Unit Testing Principles, Practices, and Patterns** — Vladimir Khorikov (2020) — readable tests, the arrange step, and fixture management.

---

## Related Topics

- [Fragile Tests](../01-fragile-tests/middle.md) — what shared fixtures break when they change.
- [Flaky Tests](../02-flaky-tests/middle.md) — the order-coupling and shared-state instability seeded rows cause.
- [Over-Mocking](../06-over-mocking/middle.md) — another route to tests that stop testing real behavior.
- [Bad Structure → Development Anti-Patterns](../../01-development/01-bad-structure/middle.md) — the production-code cousin and its countermoves.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — hidden coupling at the system level.
