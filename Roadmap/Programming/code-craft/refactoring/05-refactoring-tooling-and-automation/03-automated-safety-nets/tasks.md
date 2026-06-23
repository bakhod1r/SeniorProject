# Automated Safety Nets for Refactoring — Tasks

> **Source:** Michael Feathers, *Working Effectively with Legacy Code*; Martin Fowler, *Refactoring* (2nd ed.)

Eight exercises. Try each before reading the worked solution. The goal is the *judgment* — what net, where, why — not just the code.

---

## Task 1 — Write a characterization test for legacy code (warm-up)

Given this untested, unspecified method, build a characterization test before any refactoring.

```java
public class TaxBracket {
    public int taxCents(int incomeCents) {
        if (incomeCents <= 1_000_000) return 0;
        if (incomeCents <= 4_000_000) return (incomeCents - 1_000_000) / 10;     // 10%
        return 3_000_000 / 10 + (incomeCents - 4_000_000) * 2 / 10;              // 20% over 4M
    }
}
```

<details><summary>Worked solution</summary>

Use the golden-master loop: placeholder → read actual → pin. Hit each bracket *and its boundaries*.

```java
@Test
void characterizeTax() {
    TaxBracket t = new TaxBracket();
    assertEquals(0,        t.taxCents(1_000_000));   // boundary, still 0%
    assertEquals(1,        t.taxCents(1_000_010));   // just into 10%: 10/10
    assertEquals(300_000,  t.taxCents(4_000_000));   // top of 10% bracket
    assertEquals(300_002,  t.taxCents(4_000_010));   // just into 20%: 300000 + 10*2/10
    assertEquals(500_000,  t.taxCents(5_000_000));   // 300000 + 1000000*2/10
}
```

How you *got* the numbers matters: you wrote placeholders (e.g. `assertEquals(0, t.taxCents(1_000_010))`), ran the test, read `expected:<0> but was:<1>` from the failure, and pinned `1`. You did **not** judge whether integer-division truncation is "correct" — it's the current behavior, so you pinned it. Note the boundary pairs (`4_000_000` / `4_000_010`) — without them, a mutant that shifts a bracket edge would survive.

</details>

---

## Task 2 — Spot the net hole (mutation reasoning by hand)

This suite claims to protect `clamp`. Find at least two behavior changes it would **not** catch — surviving mutants — then add tests to kill them.

```java
static int clamp(int x, int lo, int hi) {
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
}

@Test void inRange()  { assertEquals(5, clamp(5, 0, 10)); }
@Test void belowLo()  { assertEquals(0, clamp(-3, 0, 10)); }
```

<details><summary>Worked solution</summary>

Surviving mutants this suite misses:

1. **The `x > hi` branch is unprotected.** Mutating `return hi` to `return x`, or deleting the upper clamp entirely, keeps both tests green — no input exceeds `hi`.
2. **Boundary `<` vs `<=`.** Changing `x < lo` to `x <= lo` is not caught — no test pins `clamp(0, 0, 10)`.

Kill them:

```java
@Test void aboveHi()      { assertEquals(10, clamp(13, 0, 10)); }  // kills upper-branch mutant
@Test void atLoBoundary() { assertEquals(0,  clamp(0, 0, 10)); }   // kills < vs <= mutant
@Test void atHiBoundary() { assertEquals(10, clamp(10, 0, 10)); }  // kills > vs >= mutant
```

Lesson: line coverage alone hides these holes. Boundary + each-branch reasoning — exactly what a mutation tester automates — is what closes them.

</details>

---

## Task 3 — Generate a golden master for a big, non-deterministic output

`InvoiceRenderer.toText(Invoice)` returns ~60 lines including a header with `LocalDateTime.now()` and a random `confirmationId`. Write an approval test that won't be flaky.

<details><summary>Worked solution</summary>

You cannot snapshot the raw output — the timestamp and id change every run, so it fails every time and trains the team to rubber-stamp. **Scrub the non-determinism**, then approve:

```java
@Test
void rendersInvoice() {
    String out = new InvoiceRenderer().toText(sampleInvoice())
        .replaceAll("Generated: .*",         "Generated: <TS>")
        .replaceAll("Confirmation: [A-Z0-9]+","Confirmation: <ID>");
    Approvals.verify(out);   // first run -> .received; inspect; approve -> .approved
}
```

Workflow: the first run produces `rendersInvoice.received.txt`. You **read** it (the non-skippable step), confirm it is the correct current output, and rename it to `.approved.txt`, committing it as a reviewed artifact. From then on any real behavior change shows up as a diff; the scrubbed fields never cause spurious failures. If you *cannot* scrub a field cleanly, do not snapshot it — assert it separately (e.g., "confirmationId matches `[A-Z0-9]{8}`").

</details>

---

## Task 4 — Choose the right net for four changes

For each, name the cheapest adequate net and justify it.

a) Rename `getTotal()` → `getGrandTotal()` across a typed Java codebase via the IDE.
b) Extract a 40-line method out of a `PricingEngine` that already has solid unit tests.
c) Restructure a 500-line legacy `ReportBuilder` with no tests and no documentation.
d) Swap a hand-rolled sort for the library sort inside a hot path; behavior must be identical.

<details><summary>Worked solution</summary>

- **(a) Compiler only.** A type-aware IDE rename plus a clean compile *is* the net; the compiler finds every call site. Adding tests purely for this rename is gold-plating.
- **(b) Existing unit tests.** Intent is already pinned; run them after the extract. Extract Method is mechanical and the suite catches any slip. No new net needed.
- **(c) Characterization first, then refactor.** No intent is known, so you cannot write should-be tests. Golden-master the observable output over a wide input sweep, *then* restructure under that net. If the report is critical, run mutation testing on the new characterization suite first to confirm it has teeth.
- **(d) Property-based / oracle test.** Keep the old sort, assert the new one always agrees with it over thousands of generated arrays, plus the invariant "result is sorted and a permutation of the input." An algorithm swap is exactly where invariants beat fixed examples.

</details>

---

## Task 5 — Turn a coverage-only test into a real net

This test exists only to hit a coverage target. Make it an actual net without changing the production code.

```java
@Test
void covered() {
    DiscountPolicy p = new DiscountPolicy();
    p.apply(new Cart(120.0, "GOLD"));   // 100% line coverage, asserts nothing
}
```

<details><summary>Worked solution</summary>

The test runs the method but a mutant changing the discount math survives — it is a false net. Replace coverage with *catch* by asserting the observable result and pinning the branches:

```java
@Test
void goldOverHundredGetsFifteenPercent() {
    assertEquals(102.0, new DiscountPolicy().apply(new Cart(120.0, "GOLD")), 1e-9);
}
@Test
void standardTierNoDiscount() {
    assertEquals(120.0, new DiscountPolicy().apply(new Cart(120.0, "STANDARD")), 1e-9);
}
@Test
void goldUnderThresholdNoDiscount() {
    assertEquals(80.0, new DiscountPolicy().apply(new Cart(80.0, "GOLD")), 1e-9);
}
```

If `DiscountPolicy` is legacy with unknown intent, write these as *characterization* tests (placeholder, read actual, pin) instead of asserting values you assume. The point: coverage was already 100%; what was missing was *assertions that fail when behavior changes* — net catch, not net reach.

</details>

---

## Task 6 — Run mutation testing and act on a survivor

You run PIT on `ShippingCalculator` and get:

```
>> Generated 22 mutations Killed 19 (86%)
>> SURVIVED: ShippingCalculator.java:9  removed conditional - replaced equality check with true (country.equals("CA"))
```

Explain what the survivor means and write the test that kills it.

<details><summary>Worked solution</summary>

The mutant forced the `country.equals("CA")` branch to always be taken. No test failed, which means **no test exercises a non-CA, non-US country** — the `else` multiplier path is unprotected. Anyone refactoring the country logic could break the default multiplier and the suite would stay green.

Kill it by pinning a country in *each* multiplier branch:

```java
@Test void canadaMultiplier()  { assertEquals(9.75, calc.cost(1500, "CA", false), 1e-9); } // 7.5 * 1.3
@Test void defaultMultiplier() { assertEquals(13.5, calc.cost(1500, "DE", false), 1e-9); } // 7.5 * 1.8  <-- kills survivor
```

`defaultMultiplier` now fails if the CA condition is forced true (DE would wrongly get 1.3), killing the mutant. General rule: a surviving conditional-boundary mutant points at an untested branch *or* an untested boundary; add the input that distinguishes the two sides.

</details>

---

## Task 7 — Build a contract test for a service boundary

`checkout` calls `orders-api` at `GET /orders/{id}` and reads `id`, `status`, `totalCents`. The teams deploy independently. Sketch the consumer-side contract that prevents a silent break, and explain what catches a provider mistake.

<details><summary>Worked solution</summary>

The consumer declares what it needs; a broker shares that expectation; the provider is verified against it.

```java
@Pact(consumer = "checkout", provider = "orders-api")
public RequestResponsePact orderExists(PactDslWithProvider b) {
    return b.given("order 42 exists")
        .uponReceiving("get order 42")
        .path("/orders/42").method("GET")
        .willRespondWith().status(200)
        .body(newJsonBody(o -> {
            o.numberType("id", 42);
            o.stringType("status", "PAID");
            o.numberType("totalCents", 1080);
        }).build())
        .toPact();
}
```

The consumer's test runs against a mock obeying this contract. The provider runs the **same** pact against its real implementation. If the provider team refactors and renames `totalCents` → `total_cents` or drops `status`, the *provider's* contract verification goes red **before deploy** — the break is caught on the side that caused it, without an end-to-end environment. This is the net the compiler cannot give you, because the seam crosses the network. (For two services owned by one team that ship together, a single integration test is cheaper than the broker machinery — reach for contract tests when deploys are independent.)

</details>

---

## Task 8 — Diagnose an over-pinned characterization test

A teammate wrote this before refactoring `OrderProcessor`. Their refactoring is behavior-preserving, yet the test fails. Diagnose and fix.

```java
@Test
void characterize() {
    var spy = new SpyDb();
    new OrderProcessor(spy).process(sampleOrder());
    assertEquals(List.of(
        "BEGIN", "INSERT order", "INSERT line", "INSERT line", "UPDATE total", "COMMIT"),
        spy.methodCallLog());   // pins the exact internal call sequence
}
```

<details><summary>Worked solution</summary>

This test pins **internals** — the exact sequence of DB calls — not **observable behavior**. A legitimate refactoring (batching the two line inserts, reordering the total update before commit, using an upsert) changes the call log without changing the *result* in the database. So the net fails on a good refactoring: it has inverted its purpose and now *blocks* the change it was meant to protect. This is over-pinning.

Fix: pin the **observable effect** — the final state of the data — not how it got there:

```java
@Test
void characterize() {
    var db = new InMemoryDb();
    new OrderProcessor(db).process(sampleOrder());
    Approvals.verify(db.dumpAllTablesSortedByPk());   // final rows, order-independent
}
```

Now any refactoring that produces the same final rows passes, and any that changes the data fails. The net watches behavior, ignores structure — which is the entire definition of a refactoring safety net.

</details>
