# Strangler at the Code Level — Junior

> **Source:** Martin Fowler, "StranglerFigApplication", martinfowler.com/bliki/StranglerFigApplication.html

You have a class, a module, or a calculation that everyone is afraid to touch. It works, sort of, but it is tangled, and you need to replace it. You could rewrite it in one heroic weekend and pray the tests catch everything. Or you could grow a new implementation *around* the old one, move callers over a few at a time, and delete the old code only once nothing reaches it anymore. The second approach is the **Strangler Fig** pattern, applied not to whole services but to code inside a single running program.

This page teaches the in-process, code-level mechanics: where to cut, how to divert callers, how to prove the new code behaves like the old code, and how to know when the old code is safe to delete.

---

## Table of Contents

1. [The name, and why it fits](#1-the-name-and-why-it-fits)
2. [The core idea in one sentence](#2-the-core-idea-in-one-sentence)
3. [The three moves: seam, divert, delete](#3-the-three-moves-seam-divert-delete)
4. [A worked example: strangling a price calculator](#4-a-worked-example-strangling-a-price-calculator)
5. [Proving parity: shadowing and diff testing](#5-proving-parity-shadowing-and-diff-testing)
6. [Feature-flagged routing](#6-feature-flagged-routing)
7. [Strangler vs Branch by Abstraction](#7-strangler-vs-branch-by-abstraction)
8. [When NOT to use the strangler](#8-when-not-to-use-the-strangler)
9. [Glossary](#9-glossary)
10. [Review questions](#10-review-questions)
11. [Next](#11-next)

---

## 1. The name, and why it fits

A strangler fig is a plant that starts life in the branches of a host tree. It sends roots down around the trunk, slowly wraps the host, and grows its own structure. Eventually the fig is self-supporting and the original tree, now hollow inside, dies and rots away — leaving a fig-shaped lattice standing on its own.

Fowler borrowed the image for software migration: build the new system *around* the old one, route traffic to the new parts as they become ready, and the old system shrinks until it can be removed. Keep the analogy tight, because it can mislead in one way: the fig is passive and slow, but **you** are in control of every diversion. Nothing moves to the new code unless you route it there, and you can route it back instantly if something goes wrong.

The key property — the thing that makes this worth learning — is that **the system works at every single step**. You never have a half-migrated state that won't compile or won't ship. After each small move, all tests pass and the program runs.

---

## 2. The core idea in one sentence

> Grow the new implementation alongside the old one, divert callers from old to new in small slices, verify each slice behaves identically, and delete the old code once nothing calls it.

Three verbs do the work: **grow**, **divert**, **delete**. Everything else is detail about *where* to divert and *how* to be sure the new code is correct.

---

## 3. The three moves: seam, divert, delete

A **seam** is a place where you can change behavior without editing the code on either side of it — a point you can intercept. Michael Feathers coined the term in *Working Effectively with Legacy Code*. The strangler needs a seam: a single choke point where calls to the old code pass through, so you can redirect some of them to the new code.

### Move 1 — Introduce the seam (interception point)

If the old code is called directly all over the place, you first funnel every caller through one entry point. The cheapest seam is usually a **facade** or an **adapter**: a thin wrapper with the same signature as the old code, which (for now) just forwards to it.

```java
// BEFORE: callers reach the old calculator directly.
double total = legacyPricer.calculate(order);   // in 14 places
```

```java
// AFTER step 1: a facade with the same signature, forwarding to old code.
public class PricingFacade {
    private final LegacyPricer legacy;

    public double calculate(Order order) {
        return legacy.calculate(order);   // pure pass-through for now
    }
}
```

Behavior is unchanged — `PricingFacade.calculate` does exactly what `legacyPricer.calculate` did. You then update the 14 callers to go through the facade. This is the only "big bang" edit, and it is mechanical and safe: same input, same output.

### Move 2 — Divert a slice

Now you build a new implementation and route *part* of the work to it from inside the seam.

```java
public class PricingFacade {
    private final LegacyPricer legacy;
    private final NewPricer next;

    public double calculate(Order order) {
        // Divert one slice: orders from the new "digital goods" line use the new code.
        if (order.isDigitalGoods()) {
            return next.calculate(order);
        }
        return legacy.calculate(order);
    }
}
```

You picked the smallest slice that is meaningful — here, digital-goods orders. Everything else still flows to the old code. If the new path misbehaves, only that slice is affected, and you can flip the condition off in seconds.

### Move 3 — Expand, then delete

You widen the slice — more order types, more conditions — verifying parity each time (see §5). When the condition that selects "old" can never be true, the old branch is **dead**. Now, and only now, you delete it.

```java
// AFTER: nothing reaches the old path. Delete it.
public class PricingFacade {
    private final NewPricer next;

    public double calculate(Order order) {
        return next.calculate(order);
    }
}
// LegacyPricer is now unreferenced — remove the class.
```

### The numbered, behavior-preserving recipe

1. Find or create a single seam through which all callers reach the old code.
2. Route every caller through that seam (each edit is a same-in/same-out swap).
3. Build the new implementation for one small slice of behavior.
4. Inside the seam, divert that slice to the new code behind a condition or flag.
5. Verify parity for the slice (tests, then shadowing in production if needed).
6. Expand the slice; repeat steps 4–5 until the old branch is never taken.
7. Confirm the old code is dead (no callers, no slice routes to it).
8. Delete the old code and simplify the seam.

> **When NOT to (for this whole approach):** if you can swap the old code for the new one in a single safe, well-tested commit — a *clean cutover* — the strangler is overhead you do not need. See §8.

---

## 4. A worked example: strangling a price calculator

Suppose `LegacyPricer` is a 400-line class that computes order totals: base price, quantity discounts, regional tax, loyalty points, and shipping. It is correct in production but impossible to extend. We will strangle it slice by slice.

### Starting point

```java
public class LegacyPricer {
    public double calculate(Order order) {
        double base = sumLineItems(order);
        double discounted = applyQuantityDiscount(base, order);
        double taxed = applyTax(discounted, order.region());
        double withLoyalty = applyLoyaltyAdjustment(taxed, order.customer());
        return addShipping(withLoyalty, order);
        // ...400 lines of helpers below...
    }
}
```

Callers do `new LegacyPricer().calculate(order)` in many places.

### Step 1 — Seam

Introduce a facade and route all callers through it.

```java
public class Pricer {                 // the seam
    private final LegacyPricer legacy = new LegacyPricer();
    public double calculate(Order order) {
        return legacy.calculate(order);
    }
}
```

Find-and-replace callers to use `Pricer`. Tests stay green; behavior identical.

### Step 2 — Carve out the first slice (tax)

Tax is self-contained and easy to test. Build `NewTaxRule`, then divert *only the tax computation* — not the whole calculation.

```java
public class Pricer {
    private final LegacyPricer legacy = new LegacyPricer();
    private final NewTaxRule newTax = new NewTaxRule();
    private final boolean useNewTax;   // flag

    public double calculate(Order order) {
        if (useNewTax) {
            double base = legacy.sumLineItems(order);
            double discounted = legacy.applyQuantityDiscount(base, order);
            double taxed = newTax.tax(discounted, order.region());   // NEW
            double withLoyalty = legacy.applyLoyaltyAdjustment(taxed, order.customer());
            return legacy.addShipping(withLoyalty, order);
        }
        return legacy.calculate(order);
    }
}
```

The slice here is *one helper*, not one order type. Both are valid ways to slice — by data (digital-goods orders) or by behavior (the tax step). Pick whichever gives you a small, verifiable change.

### Step 3 — Verify parity for the tax slice

Run both old and new tax for the same inputs and assert they agree (details in §5). Once they match across your test set and a shadow period, set `useNewTax = true` permanently.

### Step 4 — Next slice, repeat

Strangle `applyQuantityDiscount`, then `applyLoyaltyAdjustment`, then shipping, each behind its own flag, each verified, each expanded. After the last slice, `calculate` orchestrates only new components and never calls `legacy.calculate`.

### Step 5 — Delete

`LegacyPricer.calculate` has no callers. Its helpers may still be referenced by the seam during transition; once you have replaced every helper, the whole class is dead. Delete it and inline the orchestration into `Pricer`.

At no point did the build break or a release stall. That is the entire value proposition.

### Why slice by slice instead of all at once?

It is tempting to build the whole `NewPricer` in one go, wire it in, and flip. The slice-by-slice approach buys three things a big-bang rewrite cannot:

1. **Small, attributable failures.** If diverting the tax slice breaks something, the cause is one of a few dozen lines you just changed — not 400 lines of new code where the bug could be anywhere.
2. **Continuous evidence.** Each slice that runs cleanly in production for a while *increases your confidence* in the seam, the flags, and the team's process before you risk the harder slices.
3. **A real rollback at every step.** Because only a slice moved, flipping it off returns you to known-good behavior in seconds. After a big-bang flip, "rollback" is a frantic revert-and-redeploy.

The cost is patience: a strangle takes more elapsed time than a rewrite that goes well. You are trading speed-when-lucky for safety-always.

---

## 5. Proving parity: shadowing and diff testing

Diverting is easy. Being *sure* the new code matches the old is the hard part. Two techniques, both in-process:

### Diff testing (offline)

Feed the same inputs to old and new, compare outputs, fail loudly on mismatch.

```java
@Test
void newTaxMatchesLegacyAcrossRegions() {
    var legacy = new LegacyPricer();
    var next = new NewTaxRule();
    for (Order order : sampleOrders()) {        // a big, representative set
        double oldT = legacy.taxOnly(order);
        double newT = next.tax(order.subtotal(), order.region());
        assertEquals(oldT, newT, 0.001,
            "tax mismatch for order " + order.id());
    }
}
```

The quality of this test is only as good as `sampleOrders()`. Pull real (anonymized) production orders if you can; they contain the edge cases your imagination misses.

### Shadowing (online)

Run the new code alongside the old *in production*, but only the old result is used. Log disagreements; do not act on the new result yet.

```java
public double calculate(Order order) {
    double result = legacy.calculate(order);     // this is what we return
    try {
        double shadow = next.calculate(order);   // computed, not returned
        if (Math.abs(shadow - result) > 0.001) {
            log.warn("strangler diff: order={} legacy={} new={}",
                     order.id(), result, shadow);
        }
    } catch (Exception e) {
        log.warn("strangler shadow failed for {}", order.id(), e);
    }
    return result;   // old path still authoritative
}
```

Shadowing catches the inputs you never tested. You watch the diff log; when it goes quiet across enough real traffic, you trust the new path and flip the flag.

> **When NOT to shadow:** if the new code has side effects (writes to a DB, charges a card, sends email), running it "for comparison" will cause those effects for real. Shadow only pure computations, or carefully stub every side effect.

---

## 6. Feature-flagged routing

The condition that selects old vs new should be a **flag** you can change without redeploying, not a hard-coded `if`. This lets you turn a slice on, watch, and turn it off instantly if metrics go bad.

```java
public double calculate(Order order) {
    if (flags.isOn("pricing.new-tax")) {
        return calculateWithNewTax(order);
    }
    return legacy.calculate(order);
}
```

Roll out gradually: 1% of orders, then 10%, then 50%, then 100%. Each step is a chance to catch a problem cheaply. The flag is also your rollback button — flip it off and you are back on the old code with no deploy.

> **When NOT to flag:** flags are not free. Each one is a branch you must test and eventually *remove*. A slice you can verify fully offline and flip in one commit may not need a runtime flag at all. And never leave a strangler flag in the code after the old path is deleted — a flag with only one live branch is dead weight.

---

## 7. Strangler vs Branch by Abstraction

These two large-scale techniques are siblings and are easy to confuse. The sibling topic *Branch by Abstraction* covers it in full; here is the distinction.

**Branch by Abstraction** puts an abstraction (an interface) over the thing you want to change, makes everyone depend on the abstraction, builds a new implementation *behind the same interface*, and swaps the implementation. There is **one seam**, and you flip which implementation sits behind it.

**Strangler** grows a **parallel** new implementation and **diverts** callers slice by slice. The old and new can have *different* shapes; you are not forced to make the new code fit an interface the old code defined.

| | Branch by Abstraction | Strangler |
|---|---|---|
| Structure | One interface, swap impl behind it | Two implementations, divert between them |
| Granularity | Usually all-or-nothing per abstraction | Slice by slice (by data or behavior) |
| Best when | A clean interface already fits both | The new design differs from the old; you want partial rollout |
| Rollback | Swap impl back | Flip routing |

A rough rule: if a single clean interface naturally describes both old and new, branch by abstraction is simpler. If the new design wants a different shape, or you need to migrate *part* of the traffic and watch it, strangle.

In practice they combine: the seam you introduce for a strangler is often an abstraction, and the divert condition is the "branch."

---

## 8. When NOT to use the strangler

The strangler is a tool for **risky, large, or hard-to-test** replacements. It is overkill — sometimes outright harmful — when:

- **A clean cutover is cheap and safe.** If you have solid tests and can replace the old code in one reviewed commit that keeps the build green, do that. The strangler's machinery (seam, flags, shadowing) is pure cost you do not need.
- **There is no stable seam to intercept at.** If callers reach the old code through a dozen tangled paths with no single choke point, you may have to *create* a seam first — and that work might be the whole job. Sometimes the honest move is to characterize the code with tests and cut over.
- **Running two implementations doubles maintenance unacceptably.** While both paths are live, every bug fix and every new requirement may need doing twice. If the transition will drag on for months, that double-maintenance tax can exceed the risk it was meant to reduce.
- **The slices are not independent.** If you cannot carve out a piece that works on its own, you cannot divert a slice, and the pattern does not apply.

> The strangler buys *safety and shippability* at the price of *temporary duplication and routing complexity*. Use it when that trade is worth it; skip it when it is not.

---

## 9. Glossary

- **Strangler Fig pattern** — incrementally replacing code by growing the new around the old, diverting callers, and removing the old when unused.
- **Seam** — a place where you can change behavior without editing either side; the interception point a strangler diverts at.
- **Divert** — route a slice of calls from the old implementation to the new one.
- **Slice** — the smallest meaningful unit you migrate at once, chosen by data (which inputs) or by behavior (which step).
- **Parity** — old and new produce the same output for the same input.
- **Diff testing** — running old and new on the same inputs and asserting equal results (offline).
- **Shadowing** — running the new code in production alongside the old, using only the old result, logging disagreements.
- **Feature flag** — a runtime switch that selects old vs new without redeploying; also your rollback.
- **Dead code** — code no caller can reach; the only code that is safe to delete.
- **Clean cutover** — replacing the old code in a single safe step instead of incrementally.

---

## 10. Review questions

1. State the strangler in one sentence using the three verbs.
2. Why must you introduce a seam before you can divert?
3. Give one example of slicing by data and one of slicing by behavior.
4. What does shadowing catch that an offline diff test might miss?
5. Why is shadowing dangerous for code that has side effects?
6. What makes the old code safe to delete, and how do you confirm it?
7. In one line each, how do strangler and branch-by-abstraction differ in structure?
8. Name two situations where you should *not* strangle and should cut over instead.
9. Why should a strangler flag be removed after the old path is deleted?
10. The system must work after which steps of the strangler? (Trick question.)

---

## 11. Next

- Sibling topic **Branch by Abstraction** (`../01-branch-by-abstraction/`) — the swap-behind-one-seam alternative compared in §7.
- Sibling topic **Parallel Change (Expand/Contract)** (`../02-parallel-change-expand-contract/`) — the same expand-migrate-contract rhythm applied to interfaces.
- Sibling topic **The Mikado Method** (`../03-mikado-method/`) — how to discover the prerequisites before a large strangle.
- Sibling topic **Keeping the System Shippable** (`../05-keeping-the-system-shippable/`) — the shippability discipline the strangler depends on.
- The seam is usually a **Facade** or **Adapter** — see [Refactoring to Patterns: Structural](../../03-refactoring-to-patterns/03-structural/junior.md) and the design-pattern pages for [Facade](../../../design-patterns/02-structural/05-facade/junior.md) and [Adapter](../../../design-patterns/02-structural/01-adapter/junior.md).
- Carving slices out of a god-class draws on [Moving Features Between Objects](../../02-refactoring-techniques/02-moving-features/junior.md).
- Continue to [middle.md](middle.md) for choosing the interception point and slice.
