# Mystery Guest — Find the Bug

> **Category:** [Testing Anti-Patterns](../README.md) → **Mystery Guest** — *a test whose inputs or expected results come from outside the test, where the reader cannot see them.*

---

This file is **critical-reading practice**. Each snippet is a plausible test in Go, Java, or Python. The "bug" here is rarely a crash — it's that **the real input or expected result is off-screen**, so the test can't be understood or trusted, and that hidden data often hides (or causes) a *functional* problem too. For each snippet, answer three questions before opening the answer:

> **Where is the Mystery Guest — what data is off-screen? What concrete problem does it cause (including any real bug it hides)? How would you make the test honest?**

Some snippets are traps: data that *looks* hidden but is actually a legitimate, honest fixture. Read slowly — the skill is telling mystery from deliberate.

---

## Table of Contents

1. [The total that comes from nowhere](#snippet-1--the-total-that-comes-from-nowhere)
2. [The magic customer](#snippet-2--the-magic-customer)
3. [The fixture two tests share](#snippet-3--the-fixture-two-tests-share)
4. [The golden file nobody reads](#snippet-4--the-golden-file-nobody-reads)
5. [The env-var account](#snippet-5--the-env-var-account)
6. [The Object Mother discount](#snippet-6--the-object-mother-discount)
7. [The contract fixture (trap)](#snippet-7--the-contract-fixture-trap)

---

## Snippet 1 — The total that comes from nowhere

```python
# Python (pytest) — sums line items, then applies tax
def test_invoice_total():
    invoice = load_invoice("testdata/invoices/inv_2207.json")
    assert invoice_total(invoice) == 1340.50
```

> Where is the Mystery Guest? What problem does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Mystery Guest — external file.** Both the input (`inv_2207.json`) and the expected `1340.50` are off-screen. Nobody can tell whether `1340.50` is right without opening the JSON, summing the lines, and applying whatever tax `invoice_total` uses. The number is a *guess the reader can't check*.

**Concrete problem:** when `invoice_total` regresses (say, tax rounding changes), the failure is `1340.50 != 1351.20` with no way to tell whether the *code* broke or the *fixture* drifted — and anyone editing `inv_2207.json` for another test silently breaks this one. The test documents nothing.

**Fix — inline the minimal input so the expectation is derivable:**

```python
def test_invoice_total_applies_8_percent_tax():
    invoice = Invoice(lines=[
        Line(qty=2, unit_price=500.00),   # 1000.00
        Line(qty=1, unit_price=241.20),   #  241.20  → subtotal 1241.20
    ], tax_rate=0.08)
    assert invoice_total(invoice) == 1340.50   # 1241.20 × 1.08, checkable on sight
```

Now the lines and tax rate are visible, `1340.50` is derivable, and no file can break the test.

</details>

---

## Snippet 2 — The magic customer

```java
// Java (JUnit 5) — integration test against a seeded database
@Test
void platinumCustomerSkipsShippingFee() {
    Customer c = repo.findById(8801L);              // seeded in V3__seed.sql
    Order o = orderService.place(c, basket("SKU-1"));
    assertEquals(BigDecimal.ZERO, o.shippingFee());
}
```

> Where is the Mystery Guest? What problem does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Mystery Guest — seeded "magic" row.** Customer `8801` lives in a migration (`V3__seed.sql`). The test asserts that a *platinum* customer skips shipping, but **nothing on screen shows that `8801` is platinum** — the link between the assertion and the data is invisible. The reader must open the seed file to trust the test.

**Concrete problem and hidden bug:** seeded rows are shared across the suite. If another test (or a later migration) changes `8801`'s tier to "gold," *this* test starts failing for a reason that has nothing to do with shipping logic — and the failure points at the wrong place. Worse, if a test *mutates* `8801`, pass/fail becomes order-dependent (flakiness). The test is also passing for an unverifiable reason: maybe `8801` isn't platinum at all and the fee is zero for some other reason.

**Fix — create the customer the test needs, with the driving fact visible, against an isolated DB:**

```java
@Test
void platinumCustomerSkipsShippingFee() {
    Customer platinum = makeCustomer(db, Tier.PLATINUM);   // the fact under test, visible
    Order o = orderService.place(platinum, basket("SKU-1"));
    assertEquals(BigDecimal.ZERO, o.shippingFee());        // now obviously a tier rule
}
```

Wrap the test in a rolled-back transaction so the created row can't leak to other tests.

</details>

---

## Snippet 3 — The fixture two tests share

```python
# Python (pytest)
@pytest.fixture
def account():
    return Account(balance=100, status="active", overdraft_limit=50)

def test_withdraw_reduces_balance(account):
    account.withdraw(30)
    assert account.balance == 70

def test_withdraw_into_overdraft_is_allowed(account):
    account.withdraw(120)                 # 100 balance + 50 overdraft
    assert account.balance == -20
    assert account.in_overdraft is True
```

> Where is the Mystery Guest? What problem does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Mystery Guest — far-away fixture, and a *partial* one.** The fixture isn't catastrophic (pytest builds it fresh per test by default, so there's no order-coupling), but it *is* a readability Mystery Guest: each test's expected value depends on numbers — `balance=100`, `overdraft_limit=50` — defined elsewhere. In `test_withdraw_into_overdraft_is_allowed`, the `-20` and the `120` only make sense if you know the balance *and* the limit, both off-screen. The reader has to scroll up to the fixture to verify either assertion.

**Concrete problem:** the *interesting* numbers for each test (the overdraft limit matters only to the second test; the balance to both) are pooled in one shared fixture, so neither test states what *it* depends on. Tweak `overdraft_limit` to fix the second test and you might not realize the first is unaffected — the relationship is invisible. This is a General-Fixture-in-miniature.

**Fix — give each test the data its assertion depends on, locally:**

```python
def test_withdraw_reduces_balance():
    acct = Account(balance=100, status="active")
    acct.withdraw(30)
    assert acct.balance == 70                      # 100 − 30, derivable here

def test_withdraw_into_overdraft_is_allowed():
    acct = Account(balance=100, overdraft_limit=50)  # both numbers the assertion needs, local
    acct.withdraw(120)
    assert acct.balance == -20                       # 100 − 120, within −50 limit
    assert acct.in_overdraft is True
```

Each test now reads top-to-bottom. (If construction gets repetitive, use a builder with defaults — *not* a shared fixture.)

</details>

---

## Snippet 4 — The golden file nobody reads

```go
// Go — snapshot test for a serializer
func TestSerialize(t *testing.T) {
    out := Serialize(buildThing())
    want, _ := os.ReadFile("testdata/snap.json")
    if !bytes.Equal(out, want) {
        t.Fatal("snapshot mismatch")
    }
}
```

> Where is the Mystery Guest? What problem does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Mystery Guest on both sides — *plus* the snapshot trap.** The input (`buildThing()`) is hidden behind a helper, and the expected output (`snap.json`) is an opaque blob. The failure message — `snapshot mismatch` — is useless. Neither what's being serialized nor what's expected is on screen.

**Concrete problem and the real danger:** because regenerating `snap.json` is trivial (and often a one-liner in the snapshot tooling), when this test fails a developer's reflex is to regenerate the snapshot, not investigate. So a *genuine serialization bug* — say, a field silently dropped — gets baked into the new snapshot and the test goes green. The Mystery Guest here doesn't just obscure; it can **certify a regression**. That's the worst case: a hidden *expectation* that lies while passing.

**Fix — make the input visible, name the golden file for the case, diff on failure, and (in review) actually read snapshot changes:**

```go
var update = flag.Bool("update", false, "regenerate golden files")

func TestSerialize_OrderWithTwoLines(t *testing.T) {
    thing := anOrder().                         // INPUT visible
        WithLine("SKU-1", 2).
        WithLine("SKU-2", 1).
        Build()
    out := Serialize(thing)

    golden := "testdata/serialize/order_two_lines.json"   // named for the case
    if *update {
        os.WriteFile(golden, out, 0o644)
    }
    want, err := os.ReadFile(golden)
    if err != nil {
        t.Fatalf("read golden: %v (run -update to create)", err)
    }
    if !bytes.Equal(out, want) {
        t.Errorf("serialized output differs (run -update to refresh):\n%s",
            unifiedDiff(string(want), string(out)))      // shows WHAT changed
    }
}
```

The golden file is fine for a large serialized blob; the discipline (visible input, named file, diff, reviewed regeneration) is what stops it certifying a bug.

</details>

---

## Snippet 5 — The env-var account

```python
# Python (pytest) — runs in CI and on developer laptops
def test_balance_lookup():
    account_id = os.environ["TEST_ACCOUNT_ID"]   # different value per machine
    balance = lookup_balance(account_id)
    assert balance > 0
```

> Where is the Mystery Guest? What problem does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Mystery Guest — environment variable input, *and* a near-worthless assertion.** The input (`TEST_ACCOUNT_ID`) comes from outside the test *and outside the repo* — it's whatever the machine's environment says. The reader has no idea what account is being tested or what data it holds.

**Concrete problems:** (1) the test is **non-reproducible** — it tests a different account on CI than on your laptop, so "passes on my machine" means nothing; (2) it's **flaky by construction** — if the env var is unset or points at a deleted account, it fails for environmental reasons unrelated to `lookup_balance`; (3) the assertion `balance > 0` is so weak it would pass for almost any account, so even when green it barely tests the function. This is a Mystery Guest whose source is the *host*, which is the least controllable place data can live.

**Fix — create a known account with a known balance, in the test; assert the exact value:**

```python
def test_balance_lookup_returns_stored_balance(db):
    account = make_account(db, balance=250.00)        # known input, visible
    assert lookup_balance(account.id) == 250.00       # exact, derivable, reproducible
```

Now the test is deterministic across machines, the expected value is exact, and there's no dependence on the environment.

</details>

---

## Snippet 6 — The Object Mother discount

```java
// Java (JUnit 5)
@Test
void loyalDiscountApplied() {
    Customer c = CustomerMother.standard();    // a "standard" customer
    Order o = OrderMother.bigOrder();          // a "big" order
    BigDecimal total = pricer.total(c, o);
    assertEquals(new BigDecimal("450.00"), total);
}
```

> Where is the Mystery Guest? What problem does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Mystery Guest — Object Mothers hiding the asserted facts.** Object Mothers aren't inherently bad — they're fine for *incidental context*. The problem here is that the assertion (`450.00`) depends entirely on what `standard()` and `bigOrder()` contain, and **neither is visible**. Why `450.00`? You'd have to open both Mothers, read the subtotal `bigOrder()` produces, and apply whatever discount `standard` implies. The asserted value is derived from off-screen state.

**Concrete problem:** the test name says "loyal discount applied," but a `standard` customer isn't loyal — so either the test is misnamed or the Mother's `standard()` secretly sets a loyalty flag. Either way the reader can't tell, and a change to `bigOrder()`'s total (made for some *other* test) silently changes `450.00`, breaking this one for an unrelated reason.

**Fix — surface the facts the assertion depends on, ideally via Mothers that return builders:**

```java
@Test
void loyalCustomerGetsTenPercentOffBigOrder() {
    Customer loyal = aCustomer().withLoyaltyYears(5).build();   // the driving fact, visible
    Order order    = anOrder().withSubtotal("500.00").build();  // the base, visible
    assertEquals(new BigDecimal("450.00"), pricer.total(loyal, order));  // 500 − 10%, derivable
}
```

If the team is committed to Mothers, make them return builders — `CustomerMother.loyal()` → `aCustomer().withLoyaltyYears(5)` — so the test can still surface the subtotal and the loyalty fact at the call site.

</details>

---

## Snippet 7 — The contract fixture (trap)

```go
// Go — a consumer-side contract test against a shared Pact file
func TestUserClient_ParsesContractResponse(t *testing.T) {
    body := loadPact(t, "pacts/user-service-getUser.json") // shared, versioned contract
    server := stubServer(body)
    defer server.Close()

    user, err := NewUserClient(server.URL).GetUser("u-1")
    require.NoError(t, err)
    assert.Equal(t, "u-1", user.ID)          // assert on NAMED facts from the contract
    assert.Equal(t, "active", user.Status)
}
```

> Where is the Mystery Guest? What problem does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Trap — this is NOT a Mystery Guest.** It *looks* like one (data loaded from a file the test doesn't show), but it's a **deliberate, honest fixture**, and you should leave it alone.

Why it's honest, not mysterious:
- **Sharedness is the point.** A Pact contract is the *single source of truth* the consumer and provider both test against. Inlining a per-test copy of the response would let the two drift — the exact failure the contract test exists to prevent. Here, shared is *correct*.
- **It's owned and named.** `pacts/user-service-getUser.json` is versioned, owned by the contract, and named for the interaction — its origin and authority are knowable.
- **The assertion is on named facts.** The test asserts `user.ID == "u-1"` and `user.Status == "active"` — visible, specific facts — not "equals the whole opaque blob." The reader sees exactly what's being verified.

**The lesson:** a fixture is judged by *ownership, authority, mutability, and call-site honesty* — not by "is it in a file." This one is owned, authoritative, immutable (a versioned contract), and its assertions are visible. Don't "fix" it by inlining; that would *break* the contract guarantee. (If anything, the only nit is the file naming convention — keep contract fixtures clearly separated under `pacts/`, which this does.)

</details>

---

## Summary — patterns of spotting

You don't spot a Mystery Guest by recognizing one bad line — you spot it by **asking where the data came from**. The repeatable moves from these seven snippets:

- **Try to derive the expected value from the test body alone.** If you can't check `1340.50` / `450.00` / `-20` without scrolling away or opening a file, the input is off-screen (Snippets 1, 3, 6).
- **For every literal id, ask "where are its fields defined?"** A `findById(8801)` whose tier lives in a seed file is a magic record — and it's shared, so it breeds fragility and order-coupling (Snippet 2).
- **On golden/snapshot tests, check both sides *and* the failure message.** Hidden input + opaque blob + `mismatch` is the snapshot trap, where regeneration can certify a regression (Snippet 4).
- **Distrust data sourced from the host.** Env vars and machine state make tests non-reproducible and flaky, and the asserts are often weak to compensate (Snippet 5).
- **Object Mothers are fine for context, mysterious for the thing under test.** If the assertion depends on a field the Mother hides, surface it — ideally with a Mother that returns a builder (Snippets 3, 6).
- **Resist false positives.** A shared, named, owned, versioned contract fixture asserted on named facts is *deliberate and honest*, not a Mystery Guest. Judge by ownership/authority/mutability/call-site honesty, not by "is it in a file" (Snippet 7).

The meta-lesson: **the enemy is mystery, not externality.** A hidden CSV made a total uncheckable; a magic row coupled a shipping test to a seed file; a silent snapshot could certify a dropped field; an env var made a test pass differently on every machine. When you can't tell *where the data came from or why the answer is right*, look hard — the broken trust (and often a real bug) is hiding exactly there.

---

## Related Topics

- [`junior.md`](junior.md) — what a Mystery Guest looks like and why it's bad.
- [`middle.md`](middle.md) — the sources of hidden data and the local/explicit/minimal cure.
- [`senior.md`](senior.md) — untangling shared fixtures across a suite.
- [`professional.md`](professional.md) — the snapshot trap, contract fixtures, and when external data is right.
- [`tasks.md`](tasks.md) — the same muscles from the writing side · [`optimize.md`](optimize.md) — refactor a slow shared-fixture suite.
- [Fragile Tests](../01-fragile-tests/find-bug.md) · [Flaky Tests](../02-flaky-tests/find-bug.md) · [Over-Mocking](../06-over-mocking/find-bug.md) — sibling find-bug files.
- [Bad Structure → Development Anti-Patterns](../../01-development/01-bad-structure/find-bug.md) — the production-code cousin.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — shared state and coupling at the system level.
