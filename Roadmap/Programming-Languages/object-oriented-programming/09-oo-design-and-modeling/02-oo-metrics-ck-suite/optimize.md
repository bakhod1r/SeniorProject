# OO Metrics — the CK Suite — Optimize

> For a *design* topic, "optimize" does not mean making code faster — it means **improving the design the metrics point at**: lowering CBO, raising cohesion, and moving packages toward the Main Sequence, with the numbers as *measurable evidence the design improved*, not as the goal. The discipline is always **change the design, let the metrics follow** — never edit to move a number. Every refactor below is before/after with the metric deltas shown.

---

## 1. The golden rule of metric-driven refactoring

```
WRONG:  number is bad  →  edit until number is good   (Goodhart — you'll game it)
RIGHT:  number flags a class  →  read it  →  fix the real design problem  →  number follows
```

If a refactor moves a metric but you can't articulate *why the design is genuinely better*, you did it backwards. Every section here states the design improvement first and treats the metric drop as confirmation.

---

## 2. Lowering CBO — inject abstractions instead of constructing concretes

**Before** — `OrderProcessor` couples to seven concrete classes by `new`-ing them:

```java
public class OrderProcessor {                       // CBO 7
    public void process(Order o) {
        new PriceCalculator().total(o);             // -> PriceCalculator (concrete)
        new InventoryService().reserve(o);          // -> InventoryService (concrete)
        new EmailSender().confirm(o.customer());    // -> EmailSender, Customer
        new AuditLog().record(o.id());              // -> AuditLog, OrderId
    }
}
```

It's coupled to *concrete implementations*, untestable without all four real services, and breaks when any of their constructors change.

**After** — depend on narrow interfaces, injected:

```java
public final class OrderProcessor {                 // CBO drops to the interfaces it needs
    private final Pricer pricer;
    private final Inventory inventory;
    private final Notifier notifier;
    private final Audit audit;

    public OrderProcessor(Pricer p, Inventory i, Notifier n, Audit a) {
        this.pricer = p; this.inventory = i; this.notifier = n; this.audit = a;
    }
    public void process(Order o) {
        pricer.total(o);
        inventory.reserve(o);
        notifier.confirm(o.customer());
        audit.record(o.id());
    }
}
```

| Metric          | Before | After | Why it improved (the real reason)                       |
| --------------- | ------ | ----- | ------------------------------------------------------- |
| CBO (concrete)  | 7      | ~4–5  | now coupled to *interfaces*, not implementations         |
| Testability     | none   | full  | each collaborator is a one-line mock                     |
| Fan-out volatility | high | low  | interface signatures change far less than impl internals |

The design win — depend on abstractions, inject at construction ([Dependency Inversion](../../03-design-principles/01-solid-principles/)) — *causes* the CBO drop. We didn't chase the number. See [cohesion and coupling](../../03-design-principles/04-cohesion-and-coupling/).

---

## 3. Raising cohesion — split along the LCOM4 components

**Before** — `LCOM4 = 2`: two field-groups, two hidden classes:

```java
public class CustomerAccount {                       // LCOM4 = 2
    private double balance;                           // group A
    private List<String> auditTrail;                  // group B

    void deposit(double d)  { balance += d; }         // touches balance
    void withdraw(double d) { balance -= d; }         // touches balance
    void log(String s)      { auditTrail.add(s); }    // touches auditTrail
    String history()        { return String.join("\n", auditTrail); } // auditTrail
}
```

LCOM4 = 2 *named the seam*: `{deposit, withdraw}` over `balance`, `{log, history}` over `auditTrail` — two responsibilities.

**After** — split into the two real classes:

```java
public final class Account {           // LCOM4 = 1
    private double balance;
    void deposit(double d)  { balance += d; }
    void withdraw(double d) { balance -= d; }
}
public final class AuditTrail {        // LCOM4 = 1
    private final List<String> entries = new ArrayList<>();
    void log(String s) { entries.add(s); }
    String history()   { return String.join("\n", entries); }
}
```

| Metric        | Before | After (each)         | Why                                            |
| ------------- | ------ | -------------------- | ---------------------------------------------- |
| LCOM4         | 2      | 1 and 1              | each class now has one cohesive field-group     |
| WMC per class | 4      | 2 and 2              | each is smaller, fully understandable           |
| Reasons to change | 2  | 1 each               | SRP restored                                    |

LCOM4 is the most *actionable* CK metric precisely because **the component count tells you where to cut**.

---

## 4. Moving a package off the Zone of Pain — raise abstractness

**Before** — `com.acme.util`: Ca 72, Ce 1 → I ≈ 0.01 (stable), A = 0.0 (concrete) → **D = 0.99**. Everyone depends on a concrete grab-bag.

```java
package com.acme.util;
public final class PriceFormatter { public String format(Money m) { /* concrete */ } }
// 71 other classes call `new PriceFormatter().format(...)` directly
```

**After** — extract an interface so dependents bind to an abstraction, and let the concrete impl live behind it:

```java
package com.acme.format;
public interface PriceFormatter { String format(Money m); }      // abstract — A rises

package com.acme.format.impl;
public final class LocalePriceFormatter implements PriceFormatter {
    public String format(Money m) { /* concrete, depended on by no one directly */ }
}
```

The 71 callers now depend on the `format` package's *interface*. That package's abstractness rises (it contains interfaces), its instability stays low (still widely depended on), so **A + I → 1** and **D drops toward 0** — it moves onto the Main Sequence.

| Package metric | Before | After | Why                                               |
| -------------- | ------ | ----- | ------------------------------------------------- |
| A (abstractness) | 0.0  | high  | dependents bind to interfaces                      |
| I (instability)  | 0.01 | ~0.01 | still stable (good — it *should* be hard to change)|
| D (distance)     | 0.99 | ~0.1  | now near the Main Sequence                          |

The design win — *stable things should be abstract* (Stable Abstractions Principle) — is what lowers D. Also split the grab-bag `util` package itself, so the 72 incoming dependencies spread across cohesive packages.

---

## 5. Lowering RFC — collapse a fan-out chain with a façade

**Before** — `Checkout.run` fans out to a dozen low-level methods across several services, inflating RFC and making any single call a debugging maze:

```java
public class Checkout {                              // RFC ~ 30
    void run(Cart c) {
        inventory.check(c); inventory.lock(c); inventory.decrement(c);
        gateway.authorize(c); gateway.capture(c); gateway.receipt(c);
        ledger.debit(c); ledger.credit(c); ledger.post(c);
        // ...
    }
}
```

**After** — give each subsystem a cohesive operation; `Checkout` calls *one* method per concern:

```java
public final class Checkout {                        // RFC drops sharply
    void run(Cart c) {
        inventory.reserve(c);   // was check+lock+decrement
        payments.charge(c);     // was authorize+capture+receipt
        ledger.record(c);       // was debit+credit+post
    }
}
```

| Metric | Before | After | Why                                                      |
| ------ | ------ | ----- | -------------------------------------------------------- |
| RFC    | ~30    | ~9    | each subsystem exposes one cohesive op, not three primitives |
| Readability | low | high | `run` reads as the business workflow, not plumbing       |

The design win is **raising the abstraction level of each collaborator's interface** (don't make callers orchestrate primitives). RFC falls because the response set genuinely shrank — fewer distinct methods are reachable.

---

## 6. The before/after protocol that keeps you honest

For any metric-driven refactor, run this loop — and never skip step 4:

1. **Measure** — `ck` / SonarQube baseline. Identify the worst class by *combination* (see [`find-bug.md`](find-bug.md)).
2. **Read** — open the file; form a design hypothesis (god class? feature envy? zone of pain?).
3. **Refactor the design** — split by LCOM4 components, inject abstractions, raise interface level, invert a dependency.
4. **Re-measure and sanity-check** — confirm the *target* metric improved **and no other metric regressed** (splitting a god class can spike CBO between the fragments if you cut along the wrong seam — that's a sign you split wrong).
5. **Justify in words** — write one sentence on why the design is better *independent of the numbers*. If you can't, revert.

Step 4 catches the classic failure: "I lowered LCOM but tripled inter-class CBO" means you sliced a cohesive class into coupled fragments. The metrics, read *as a set*, keep refactors honest.

---

## 7. What you must NOT do

| Anti-optimization                          | Why it's wrong                                          |
| ------------------------------------------ | ------------------------------------------------------- |
| Add a field every method touches to drop LCOM | Goodhart — cohesion number moves, design unchanged/worse |
| Split a method into helpers to drop per-method CC | Total complexity unchanged, RFC up, harder to read   |
| Bundle dependencies into a `context` to drop CBO | Coupling hidden in a god-object, not removed           |
| Split a class purely to get under a length gate | Creates coupled fragments, CBO up, cohesion down       |
| Add a token interface nobody uses to raise A | Zone of uselessness — abstraction with no purpose       |

Every one *moves the metric the right way while making the design worse*. The tell is always the same: you optimized the *number*, not the *design*.

---

## 8. The measurable definition of "better"

For design refactors, "optimized" has a concrete, checkable meaning:

- **Lower coupling** — CBO / fan-out down, *and* the class is now testable with mocks.
- **Higher cohesion** — LCOM4 → 1, *and* the class answers "what is this for?" in one sentence.
- **On the Main Sequence** — package D → 0, *and* you can extend stable code without modifying it.
- **Smaller response set** — RFC down, *and* a single call no longer fans across the codebase.

The metric is the *measurable proxy*; the parenthetical is the *real* goal. When both move together, the refactor is real. When only the metric moves, you gamed it. Optimize the design; let the numbers prove it.

---

**Memorize this:** metric-driven optimization runs design-first — lower CBO by injecting abstractions, raise cohesion by splitting along LCOM4 components, move packages onto the Main Sequence by making stable code abstract, shrink RFC by raising collaborators' interface level. After every refactor, re-measure *the whole set* (a lone metric improving while others regress means you cut the wrong seam) and justify the win in words independent of the numbers. Change the design and let the metrics follow; the instant you edit to move a number, you've gamed it (Goodhart) and made the design worse.
