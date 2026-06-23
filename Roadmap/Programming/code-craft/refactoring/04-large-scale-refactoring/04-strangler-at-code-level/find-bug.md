# Strangler at the Code Level — Find the Bug

> **Source:** Martin Fowler, "StranglerFigApplication", martinfowler.com/bliki/StranglerFigApplication.html

Each scenario shows a strangler that was misapplied. Diagnose the defect, then fix it. The failures here are the ones that actually happen: old paths that never die, parity claimed but never proven, seams that leak state, and shadows that cause real effects.

---

## Scenario 1 — The old path that never dies

```java
public double calculate(Order order) {
    if (flags.isOn("pricing.new")) {
        return newPricer.calculate(order);
    }
    return legacyPricer.calculate(order);   // flag has been ON for 6 months
}
```

The flag has been forced on in every environment for six months. The legacy class is still in the codebase, still maintained, still considered when reviewing changes to this area.

<details><summary>Diagnosis & fix</summary>

**Bug:** the strangle stalled at the delete step. The slice reached 100% half a year ago, but nobody removed the legacy branch, the flag, or `LegacyPricer`. This is the "orphaned old code" anti-pattern: permanent double-maintenance with no payoff. Every reader still has to wonder whether the dead path is live.

**Fix:** confirm the legacy path is truly dead (static find-usages clean, flag forced on with no config path back, tombstone shows zero hits over a full business cycle), then delete the branch, the flag, and the class:

```java
public double calculate(Order order) {
    return newPricer.calculate(order);
}
// Delete LegacyPricer and the pricing.new flag.
```

The delete is part of the work, not a someday cleanup. A strangle isn't done until the scaffolding is gone.

</details>

---

## Scenario 2 — Parity assumed, not verified

```java
public Score score(Application app) {
    // "The new scorer is basically the same logic, just cleaner."
    return flags.isOn("scoring.new") ? newScorer.score(app) : legacyScorer.score(app);
}
```

The team flipped `scoring.new` to 100% on launch day. A week later, finance reports that borderline applications are being approved at a higher rate than before.

<details><summary>Diagnosis & fix</summary>

**Bug:** parity was *assumed*, never *demonstrated*. There was no diff test and no shadow period, so a behavioral difference (a changed rounding or threshold in the "cleaner" rewrite) shipped straight to 100% of traffic. "Basically the same" is exactly how subtle divergences reach production.

**Fix:** roll back via the flag immediately, then establish parity properly before re-launching:

```java
// 1. Roll back now — no deploy.
flags.force("scoring.new", false);
```

```java
// 2. Diff test on real samples.
@ParameterizedTest @MethodSource("prodApplications")
void newScorerMatchesLegacy(Application app) {
    assertEquals(legacyScorer.score(app), newScorer.score(app),
        () -> "score mismatch for " + app.id());
}

// 3. Shadow in prod (read-only), watch the diff rate, THEN canary 1%→100%.
```

The diff test on real applications would have surfaced the borderline divergence before any customer was affected.

</details>

---

## Scenario 3 — The seam leaks state

```java
public class TaxSeam {
    public Money tax(Invoice inv) {
        if (flags.isOn("tax.new")) {
            return newTax.compute(inv);     // reads CurrentUser.threadLocal.region()
        }
        return legacyTax.compute(inv);      // reads inv.region()
    }
}
```

The new tax path passes its diff tests in CI but produces wrong amounts intermittently in production.

<details><summary>Diagnosis & fix</summary>

**Bug:** the seam is in the wrong place — the new code needs the region, but instead of taking it from the invoice (which the seam has), it reaches up the stack for `CurrentUser.threadLocal.region()`. In CI the thread-local is set consistently; in production, async processing and thread reuse mean the thread-local sometimes holds a *different* user's region. The divert smuggles context through a back channel instead of through the seam's data.

**Fix:** pass everything the new path needs through the seam's explicit inputs; never read ambient state the seam doesn't own.

```java
public Money tax(Invoice inv) {
    Region region = inv.region();                 // explicit, from the seam's data
    return flags.isOn("tax.new")
        ? newTax.compute(inv, region)             // no thread-local
        : legacyTax.compute(inv, region);
}
```

If the new code genuinely needs data the seam doesn't have, the seam is at the wrong layer — relocate it to where that data is available, don't paper over it with a thread-local.

</details>

---

## Scenario 4 — Shadowing with side effects

```java
public Receipt checkout(Cart cart) {
    Receipt real = legacyCheckout.process(cart);
    if (flags.isOn("checkout.shadow")) {
        Receipt candidate = newCheckout.process(cart);   // for comparison only
        diffLog.compare(real, candidate);
    }
    return real;
}
```

After enabling shadow mode, customers report being charged twice and receiving duplicate confirmation emails.

<details><summary>Diagnosis & fix</summary>

**Bug:** `newCheckout.process` has side effects — it charges the card and sends email. Running it "just to compare" executes those effects for real. Shadowing is only safe for *pure* computations.

**Fix:** separate computation from effects so the shadow runs only the pure part; or don't shadow at all and go straight to a tiny canary with real rollback.

```java
public Receipt checkout(Cart cart) {
    PricedOrder real = legacyCheckout.price(cart);        // pure: compute amounts
    if (flags.isOn("checkout.shadow")) {
        PricedOrder candidate = newCheckout.price(cart);  // pure: no charge, no email
        diffLog.compare(real, candidate);
    }
    legacyCheckout.commit(real);                          // single place for effects
    return legacyCheckout.receipt(real);
}
```

Now shadowing compares prices without charging anyone. The actual charge/email happens once, on the chosen path only.

</details>

---

## Scenario 5 — Both paths mutate shared state

```java
public void process(Cart cart) {
    legacyLoyalty.apply(cart);                  // cart.points += earned
    if (flags.isOn("loyalty.shadow")) {
        newLoyalty.apply(cart);                 // cart.points += earned (again!)
    }
    persist(cart);
}
```

With shadow mode on, customers earn roughly double the loyalty points they should.

<details><summary>Diagnosis & fix</summary>

**Bug:** both implementations *mutate* the shared `cart.points`. Shadowing runs both, so the field is incremented twice. Output parity is irrelevant here — the corruption is in shared state, not in a returned value. This is the code-level strangler's signature hazard.

**Fix:** make both implementations pure and give the seam single-writer ownership of `cart.points`.

```java
public void process(Cart cart) {
    int legacyPts = legacyLoyalty.compute(cart);          // pure
    if (flags.isOn("loyalty.shadow")) {
        int candidate = newLoyalty.compute(cart);         // pure
        if (candidate != legacyPts) diffLog.record(cart, legacyPts, candidate);
    }
    cart.points = flags.isOn("loyalty.new") ? newLoyalty.compute(cart) : legacyPts;
    persist(cart);                                        // single writer: the seam
}
```

Exactly one writer touches `cart.points`. Shadowing computes a candidate without mutating shared state.

</details>

---

## Scenario 6 — Partial seam, untrustworthy parity

```java
public class Pricer {
    public double calculate(Order order) {
        return flags.isOn("pricing.new") ? newPricer.calc(order) : legacy.calc(order);
    }
}

// elsewhere, a batch job:
double total = new LegacyPricer().calc(order);   // bypasses the seam entirely
```

The dashboards show `pricing.new` at 100% and the diff rate at zero, yet a nightly batch produces totals that don't match the live system.

<details><summary>Diagnosis & fix</summary>

**Bug:** the seam isn't the *only* path to the old code. A batch job constructs `LegacyPricer` directly and bypasses `Pricer` entirely. So the routing metrics and parity claims only describe the traffic that goes through the seam; the batch runs old code regardless of the flag. The seam isn't a true choke point.

**Fix:** route *every* caller — including batch jobs, schedulers, and reflection/DI-instantiated ones — through the seam before claiming parity.

```java
// Batch job uses the seam, not the raw legacy class.
double total = pricer.calculate(order);
```

Then enforce it: make `LegacyPricer`'s constructor package-private so nothing outside the seam can instantiate it, and grep the whole tree (not just the obvious module) for direct references. A strangler's guarantees are only as good as the completeness of its choke point.

</details>

---

## Scenario 7 — Deleted too early

```java
public double calculate(Order order) {
    return newPricer.calculate(order);
}
// LegacyPricer deleted last sprint. Flag removed. Done!
```

Two weeks later, the quarter-end revenue-recognition job throws `MethodNotFound`-style errors and the close is blocked.

<details><summary>Diagnosis & fix</summary>

**Bug:** the old code was deleted on static evidence alone, without runtime confirmation across a full business cycle. The quarter-end job ran a route that the team's static analysis missed (it resolved `LegacyPricer` reflectively from config), and that route only fires at quarter-end — long after the "looks unused" judgment was made.

**Fix:** restore the legacy path, then follow the tombstone-and-wait discipline before re-deleting.

```java
private double legacyPath(Order order) {
    metrics.counter("strangler.legacy.hit", "slice", "pricing").increment();
    log.warn("LEGACY pricing REACHED for {} — investigate", order.id());
    return legacy.calculate(order);
}
```

Run the tombstone in production across at least one quarter-end (the rare path's actual cadence). Only after zero hits over a *representative* cycle — not two weeks — is deletion safe. Static "find usages" is necessary but never sufficient when reflection, DI-by-config, or rare batch jobs are in play.

</details>
