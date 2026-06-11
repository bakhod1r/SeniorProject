# Strangler at the Code Level — Tasks

> **Source:** Martin Fowler, "StranglerFigApplication", martinfowler.com/bliki/StranglerFigApplication.html

Work each task before reading its solution. Most are design exercises; some ask for code. The goal is the *sequence of behavior-preserving moves*, not just the end state.

---

## Task 1 — Introduce the seam

You have `LegacyShipping.cost(Order)` called directly in 9 places. Before you can strangle it, introduce a seam. Write the seam class and describe the caller migration.

<details><summary>Solution</summary>

```java
public class ShippingCalculator {          // the seam
    private final LegacyShipping legacy = new LegacyShipping();
    public double cost(Order order) {
        return legacy.cost(order);          // pure pass-through
    }
}
```

Migrate the 9 callers from `legacyShipping.cost(o)` to `shippingCalculator.cost(o)`. Each edit is same-in/same-out, so tests stay green. This is the only "wide" change, and it's mechanical. Behavior is unchanged; you've now created a single choke point to divert at later.

**Check:** if some callers reach `LegacyShipping` via reflection or DI config, find those too — a seam that only some callers pass through can't give trustworthy parity.

</details>

---

## Task 2 — Slice by behavior

`LegacyShipping.cost` does: zone lookup, weight surcharge, then a fuel adjustment. You want to replace only the fuel adjustment. Show the diverted seam behind a flag.

<details><summary>Solution</summary>

```java
public double cost(Order order) {
    double zone = legacy.zoneRate(order);
    double weighted = legacy.weightSurcharge(zone, order);
    double fuel = flags.isOn("shipping.new-fuel")
        ? newFuel.adjust(weighted, order)     // new step
        : legacy.fuelAdjustment(weighted, order);
    return fuel;
}
```

The slice is one step. The rest still flows through legacy helpers. The flag defaults to off (legacy). You can verify just the fuel step in isolation and roll it back without touching the other two steps.

</details>

---

## Task 3 — Write the parity check

For Task 2's fuel slice, write an offline diff test that proves `newFuel.adjust` matches `legacy.fuelAdjustment` across realistic inputs.

<details><summary>Solution</summary>

```java
@ParameterizedTest
@MethodSource("realShippingSamples")     // pulled from anonymized prod data
void newFuelMatchesLegacy(double weighted, Order order) {
    double oldV = legacy.fuelAdjustment(weighted, order);
    double newV = newFuel.adjust(weighted, order);
    assertEquals(oldV, newV, 0.001,
        () -> "fuel mismatch for order " + order.id() + " weighted=" + weighted);
}
```

Key points: use a *representative* input set (production samples beat invented ones), an explicit tolerance for floating point, and a failure message that lets you reproduce. The test is only as strong as `realShippingSamples`.

</details>

---

## Task 4 — Slice by data with a canary ramp

You're replacing a fraud-scoring module. The new scorer should behave identically but you want to limit exposure. Design a slice-by-data divert that ramps by percentage.

<details><summary>Solution</summary>

```java
public Score score(Transaction tx) {
    // Slice by data: a deterministic percentage of standard transactions.
    if (flags.isOn("fraud.new") && tx.isStandard()
            && bucket(tx.id()) < flags.percent("fraud.new.ramp")) {
        return newScorer.score(tx);
    }
    return legacyScorer.score(tx);
}

private int bucket(String id) {            // stable 0..99 per transaction
    return Math.floorMod(id.hashCode(), 100);
}
```

`bucket` is deterministic so the *same* transaction always lands in the same group — a given tx doesn't flip between paths on retries. Start `fraud.new.ramp` at 1, watch the diff rate and fraud metrics, then raise to 10, 50, 100. Edge cases (`!isStandard`) stay on legacy until last.

</details>

---

## Task 5 — Shadow a pure computation safely

You want to shadow the new fraud scorer before making it authoritative. The scorer is pure (no writes). Write the shadow harness so it can't slow or break the real request.

<details><summary>Solution</summary>

```java
public Score score(Transaction tx) {
    Score authoritative = legacyScorer.score(tx);
    if (flags.isOn("fraud.shadow")) {
        shadowPool.submit(() -> {                 // off the request thread
            try {
                Score candidate = newScorer.score(tx);
                if (!candidate.equals(authoritative)) {
                    diffLog.record(tx, authoritative, candidate);
                }
            } catch (Exception e) {
                diffLog.recordError(tx, e);        // never propagates to caller
            }
        });
    }
    return authoritative;                          // legacy stays authoritative
}
```

Because the scorer is pure, running it twice is safe. The shadow runs on a separate pool so it can't add latency, and its exceptions are swallowed into the diff log, never the response.

**Trap:** if the scorer had a side effect (e.g., incrementing a per-customer counter), this harness would double-count. You'd have to make it pure first or shadow on a copy.

</details>

---

## Task 6 — Handle shared state

A `LoyaltyAccrual` step mutates `cart.points`. You want to strangle it but both old and new versions write `cart.points`. Redesign so old/new can coexist without double-mutation.

<details><summary>Solution</summary>

Make both implementations **pure** — return the value, let the seam commit it once.

```java
// BEFORE: both mutate shared state.
void accrue(Cart cart) {
    legacy.accruePoints(cart);                 // writes cart.points
    if (shadow) next.accruePoints(cart);       // BUG: writes cart.points again
}

// AFTER: each computes; the seam owns the single write.
void accrue(Cart cart) {
    int legacyPoints = legacy.computePoints(cart);     // pure
    if (flags.isOn("loyalty.shadow")) {
        int candidate = next.computePoints(cart);      // pure
        if (candidate != legacyPoints) diffLog.record(cart, legacyPoints, candidate);
    }
    int chosen = flags.isOn("loyalty.new") ? next.computePoints(cart) : legacyPoints;
    cart.points = chosen;                              // single writer
}
```

Now `cart.points` has exactly one writer (the seam). Shadowing computes a candidate without mutating shared state, so it's safe to run alongside. This is the single-writer-ownership rule from the senior page.

</details>

---

## Task 7 — Sequence a subsystem strangle

A `BillingEngine` has four entry points: `invoice()` (read-only), `applyCredit()` (writes balance), `accrueInterest()` (reads balance, writes ledger), `closeMonth()` (rare, reads everything, writes balance + ledger). Propose a migration order with justification.

<details><summary>Solution</summary>

Order: **`invoice()` → `accrueInterest()` (read side first) → `applyCredit()` → `closeMonth()`**.

Reasoning:
1. **`invoice()` first** — read-only, high frequency, low risk. Perfect plumbing slice to prove seam/flags/shadow/metrics/rollback.
2. **Reads before writes** — migrate the read parts before the write parts. `accrueInterest` reads `balance` (written by `applyCredit`); migrate its *read* behavior and shadow it while `applyCredit` is still legacy and authoritative for the write.
3. **`applyCredit()`** — a write to shared `balance`; do it after read-only slices have de-risked the seam and after you've established single-writer ownership of `balance`.
4. **`closeMonth()` last and smallest** — rare and touches everything; migrate when the machinery is battle-tested. Crucially, *tombstone-and-wait must span a month-end* before you can call the old `closeMonth` dead.

Watch for the cycle: if `accrueInterest`'s new write depends on `applyCredit`'s new output and vice versa, break it by extracting the shared balance calculation into its own seam first.

</details>

---

## Task 8 — Declare the old code dead

You believe the `closeMonth` slice has been at 100% for three weeks. Write the steps and code to confirm the legacy path is truly dead before deleting it.

<details><summary>Solution</summary>

```java
private Statement legacyCloseMonth(Period p) {
    metrics.counter("strangler.legacy.hit", "slice", "closeMonth").increment();
    log.warn("LEGACY closeMonth REACHED for {} — should be impossible", p);
    return legacy.closeMonth(p);
}
```

Steps:
1. Confirm no static callers (IDE find-usages), accounting for reflection/DI-config callers.
2. Confirm the flag is forced on in *all* environments with no config that can flip it back.
3. Tombstone the legacy path (above) and wait a **full business cycle** — for `closeMonth` that means at least one real month-end close, ideally a quarter-end too. Three weeks is *not enough* if the slice only runs at month-end.
4. Zero hits over that period → delete the legacy class, the dead branch, the flag, the shadow harness, and the old-vs-new parity tests (keep tests pinning the new behavior).

The whole point of the tombstone is to catch a route you didn't know about *before* deletion makes it a production incident.

</details>

---

## Task 9 — Argue for cutover instead

A teammate proposes strangling a 60-line `DateFormatter` utility that has 100% test coverage and is called from 12 places. Make the case for a direct cutover.

<details><summary>Solution</summary>

Cut over. The strangler's machinery — seam, flag, shadow harness, diff metrics, ramp, tombstone — is far more code and process than the 60 lines being replaced, and it buys safety you already have:

- **Tests already cover it 100%**, so a clean swap will catch regressions in CI; you don't need production shadowing to gain confidence.
- **No shared mutable state** in a pure formatter, so the multi-writer risk the strangler protects against doesn't exist.
- **Small and bounded** — 60 lines, 12 callers — so a single reviewed commit keeps the build green and is easy to revert with `git revert`.

The strangler is for *risky, large, hard-to-test* replacements. This is none of those. Spending its carrying cost here is over-engineering. Write the new formatter behind the existing tests, swap it, delete the old one — one PR.

</details>

---

## Task 10 — Remove the scaffolding

A strangle of the pricing tax slice reached 100% a month ago and the legacy tax path is confirmed dead. The code still has: the `pricing.new-tax` flag, a `legacy ? : new` branch, a shadow block, and a parity test. List exactly what to delete and what to keep.

<details><summary>Solution</summary>

**Delete:**
- The `pricing.new-tax` flag (config and code references) — a flag with one live branch is dead weight.
- The `legacy ? new` branch — collapse to just the new call.
- The shadow block and its diff logging/metrics for this slice.
- The `LegacyTax` class/method, now unreferenced.
- The parity test that compared `newTax` against `legacyTax` — its baseline (the old code) no longer exists.

**Keep:**
- Tests that pin the *new* tax behavior directly (these are now your regression suite).
- General routing metrics infrastructure if other slices still use it.

```java
// AFTER cleanup — the seam wraps a single implementation.
public double calculate(Order order) {
    double base = sumLineItems(order);
    double discounted = applyQuantityDiscount(base, order);
    double taxed = newTax.tax(discounted, order.region());   // no flag, no branch
    return addShipping(applyLoyalty(taxed, order), order);
}
```

If the seam now wraps a single implementation everywhere, consider whether the seam class itself can be removed. "Done" means the code reads as if the strangle never happened — only cleaner.

</details>
