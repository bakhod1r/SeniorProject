# OO Metrics — the CK Suite — Junior

> **What?** *OO metrics* are numbers you can compute from source code that estimate how complex, coupled, and cohesive your classes are. The most famous set is the **Chidamber & Kemerer (CK) suite** of six metrics — **WMC, DIT, NOC, CBO, RFC, LCOM** — published in 1994 and still the backbone of tools like SonarQube. Each one turns a design intuition ("this class is doing too much", "this hierarchy is too deep") into a countable value.
> **How?** A tool parses your code, walks each class, and counts things: methods, parents, children, the classes it touches, the methods it can reach, the pairs of methods that share no fields. You read the numbers as *smoke detectors* — a high value points you at a class worth a second look. The number is never the verdict; it's the prompt to go read the code.

---

## 1. Why count anything at all?

Designs rot silently. A class gains a method here, a dependency there, a third reason to change next sprint — and no single commit looks alarming. By the time it's a 2,000-line god class, the damage is done. Metrics give you an **early warning that scales**: a tool can scan ten thousand classes in seconds and hand you the twenty worst, ranked. You'd never read ten thousand classes by hand.

The CK suite, from Chidamber & Kemerer's 1994 paper *A Metrics Suite for Object Oriented Design*, was the first set designed specifically for OO code (earlier metrics like lines-of-code ignored inheritance and message passing). Six metrics, each tied to one OO concept:

| Metric   | Full name                          | Concept it measures                      |
| -------- | ---------------------------------- | ---------------------------------------- |
| **WMC**  | Weighted Methods per Class         | Class complexity / size                  |
| **DIT**  | Depth of Inheritance Tree          | How deep in a hierarchy                  |
| **NOC**  | Number of Children                 | Direct subclasses                        |
| **CBO**  | Coupling Between Objects           | How many other classes it's coupled to   |
| **RFC**  | Response For a Class               | How many methods can be invoked in response to a message |
| **LCOM** | Lack of Cohesion in Methods        | How poorly the methods share state       |

The rest of this file defines each one on a real Java class.

---

## 2. WMC — Weighted Methods per Class

**Definition.** Sum of the *complexities* of a class's methods. If every method's complexity is taken as 1, WMC is simply **the method count**. In practice tools weight each method by its **cyclomatic complexity** (McCabe — the number of decision points + 1), so WMC ≈ total branching in the class.

```java
public class PricingService {
    public Money basePrice(Item i)         { return i.price(); }              // CC 1
    public Money withTax(Money m, Tax t) {                                    // CC 2
        if (t.exempt()) return m;
        return m.plus(m.times(t.rate()));
    }
    public Money withDiscount(Money m, Customer c) {                         // CC 3
        if (c.isVip())      return m.times(0.8);
        if (c.isEmployee()) return m.times(0.7);
        return m;
    }
}
```

WMC (unweighted) = 3 methods. WMC (CC-weighted) = 1 + 2 + 3 = **6**.

**Intuition.** A high WMC means a class with many methods or very branchy methods — more to test, more to understand, more reasons to change. Chidamber & Kemerer argued high WMC predicts more defects and limits reuse.

**Healthy range.** Unweighted: roughly ≤ 20 methods. CC-weighted: watch above ~50. A class at WMC 200 is almost always a [god class](../../07-antipatterns-and-code-smells/01-god-class/).

---

## 3. DIT — Depth of Inheritance Tree

**Definition.** The length of the longest path from the class **up to the root** of its inheritance tree. In Java, every class extends `Object`, so `Object` is at DIT 0 and a direct subclass is at DIT 1.

```java
class Object {}                 // DIT 0
class Animal extends Object {}  // DIT 1
class Mammal extends Animal {}  // DIT 2
class Dog    extends Mammal {}  // DIT 3
```

`Dog` has **DIT 3**.

**Intuition.** Deeper means more inherited behaviour to reason about (you must understand all the parents to understand the child) but potentially more reuse. Shallow means simpler but possibly less factored.

**Healthy range.** DIT of 2–4 is comfortable in typical business code. Beyond ~6 you're often in [yo-yo problem](../../07-antipatterns-and-code-smells/07-yo-yo-problem/) territory — you bounce up and down the hierarchy to follow one call. Framework classes (Swing, exceptions) legitimately run deeper.

> Java's single inheritance caps the *class* DIT, but interfaces add their own depth that some tools count separately.

---

## 4. NOC — Number of Children

**Definition.** The count of **direct** subclasses of a class (immediate children only, not all descendants).

```java
abstract class Shape {}
class Circle    extends Shape {}
class Rectangle extends Shape {}
class Triangle  extends Shape {}
```

`Shape` has **NOC 3**.

**Intuition.** High NOC means the class is a heavily-reused base — which is good (factored abstraction) *and* risky (a change to the base ripples to every child, and each child must honour the base's contract per Liskov). Chidamber & Kemerer noted high NOC may indicate misuse of subclassing or a need for more testing of the base.

**Healthy range.** No hard cap; a well-designed `sealed` base with 3–7 variants is fine. Dozens of children can mean the base is doing too much or that subclassing was used where composition fit better.

---

## 5. CBO — Coupling Between Objects

**Definition.** The number of **other classes** a class is coupled to — it uses their methods or fields, or they use its. Coupling is bidirectional and counted once per distinct class.

```java
public class OrderProcessor {
    public void process(Order o) {              // -> Order
        var total = new PriceCalculator().total(o);   // -> PriceCalculator
        new InventoryService().reserve(o);            // -> InventoryService
        new EmailSender().confirm(o.customer());      // -> EmailSender, Customer
        new AuditLog().record(o.id());                // -> AuditLog, OrderId
    }
}
```

`OrderProcessor` touches `Order`, `PriceCalculator`, `InventoryService`, `EmailSender`, `Customer`, `AuditLog`, `OrderId` → **CBO 7** (excluding `java.*` types, which most tools ignore).

**Intuition.** This is the metric for the principle you already know: **low coupling**. High CBO means the class is hard to change, hard to test in isolation, and fragile to changes elsewhere. See [cohesion and coupling](../../03-design-principles/04-cohesion-and-coupling/).

**Healthy range.** CBO ≤ ~5 is comfortable; above ~10–14 the class is a coupling hotspot. Orchestrators legitimately run higher than leaf classes.

---

## 6. RFC — Response For a Class

**Definition.** The size of the **response set**: the methods of the class itself **plus** all the distinct methods those methods call (the first level of calls out). RFC = |local methods ∪ methods invoked by them|.

```java
public class Checkout {
    public void run(Cart c) {        // local method
        validate(c);                 // local
        var total = price(c);        // local
        gateway.charge(total);       // remote: Gateway.charge
        receipts.email(c.user());    // remote: Receipts.email, Cart.user
    }
    private void validate(Cart c) { c.assertNotEmpty(); }   // remote: Cart.assertNotEmpty
    private Money price(Cart c)   { return c.subtotal(); }  // remote: Cart.subtotal
}
```

Response set = {`run`, `validate`, `price`} (local) ∪ {`Gateway.charge`, `Receipts.email`, `Cart.user`, `Cart.assertNotEmpty`, `Cart.subtotal`} → **RFC 8**.

**Intuition.** RFC estimates how much can happen in response to a single message to this class — and therefore how hard it is to test and debug. A high RFC means many code paths fan out from this class.

**Healthy range.** RFC ≤ ~50 is typical for a focused class. Above ~100 the class coordinates a lot; that may be fine for a top-level controller but is a smell on a domain object.

---

## 7. LCOM — Lack of Cohesion in Methods

**Definition (CK original, "LCOM1/2").** Take every pair of methods. Count **P** = pairs that share *no* instance field, and **Q** = pairs that share *at least one*. LCOM = `max(P − Q, 0)`. Higher = less cohesive (the name is *Lack* of cohesion).

```java
public class Mixed {
    private int a, b;          // group 1 fields
    private String x, y;       // group 2 fields

    void incA() { a++; }       // uses a
    void incB() { b += a; }    // uses a, b
    void setX(String s) { x = s; }  // uses x
    void setY(String s) { y = x; }  // uses x, y
}
```

`incA`/`incB` share `a`; `setX`/`setY` share `x`. But `{incA,incB}` share nothing with `{setX,setY}`. The pairs across the two groups are the non-sharing pairs → P > Q → LCOM > 0. This class is really **two classes glued together**.

**Intuition.** High LCOM means the methods don't operate on the same data — the class lacks a single purpose and probably should be split. It's the numeric form of "low cohesion".

**Healthy range.** LCOM near 0 is ideal. The original LCOM1 metric is noisy (see [`middle.md`](middle.md)); modern tools prefer **LCOM4** (count of connected components — covered below), where **1** = cohesive and **≥ 2** = should split.

---

## 8. The practical complements

The CK six aren't the whole story. Four widely-used companions:

| Metric                          | What it adds                                                            |
| ------------------------------- | ---------------------------------------------------------------------- |
| **Cyclomatic Complexity (CC)**  | McCabe's count of decision points + 1, per method. Feeds WMC. CC > 10 = hard to test. |
| **LCOM4**                       | Cohesion as graph connected-components. 1 = cohesive, ≥ 2 = split candidate. |
| **Fan-in / Fan-out**            | How many classes call *into* you (fan-in) vs how many you call *out* to (fan-out). |
| **Instability / Abstractness**  | Package-level: are you stable & abstract, or unstable & concrete? (the *Main Sequence*). |

**Afferent coupling (Ca)** = incoming dependencies (fan-in). **Efferent coupling (Ce)** = outgoing (fan-out). From these, **Instability I = Ce / (Ca + Ce)**, between 0 (nothing depends on you, you depend on others — stable) and 1 (everyone depends on you... wait, reversed) — precisely: **I = 0 means maximally stable** (hard to change because many depend on it), **I = 1 means maximally unstable** (easy to change, depends on much). Robert C. Martin's *Main Sequence* (in *Agile Software Development*) says good packages sit on the line **A + I = 1**: stable packages should be abstract, unstable ones concrete. Full treatment in [`middle.md`](middle.md).

---

## 9. The cardinal rule — don't optimize the number

Every metric becomes a lie the moment it becomes a target. This is **Goodhart's law**: *when a measure becomes a target, it ceases to be a good measure.* If your CI fails builds for LCOM > 0, engineers will add a dummy field that every method touches — cohesion metric satisfied, design unchanged.

```java
// "Fixing" LCOM by cheating — every method now touches `tag`, LCOM drops, design untouched
public class Mixed {
    private int a, b; private String x, y;
    private final String tag = "mixed";
    void incA() { use(tag); a++; }
    void setX(String s) { use(tag); x = s; }
    private void use(String t) {}
}
```

Metrics **locate** problems. They never **diagnose** them and never **fix** them. A class with high CBO might be a perfectly reasonable orchestrator; a class with LCOM 0 might still be badly designed. Always open the file.

---

## 10. How to actually compute these

You won't count by hand on real code. Tools do it:

- **ck** (open-source, github.com/mauricioaniche/ck) — a JAR that emits a CSV of all CK metrics per class. The quickest start.
- **SonarQube** — computes CC, cognitive complexity, coupling, and tracks them over time on a dashboard.
- **JDepend** — package-level Ca, Ce, instability, abstractness, distance-from-main-sequence.
- **Metrics / MetricsReloaded** (Eclipse / IntelliJ plugins) — per-class CK metrics in the IDE.
- **PMD** — rule-based (e.g. `ExcessiveClassLength`, `CyclomaticComplexity`) rather than raw numbers.

Hands-on runs are in [`tasks.md`](tasks.md).

---

## 11. Reading a metrics report — a worked example

A `ck` CSV row for one class:

```
class,                wmc, dit, noc, cbo, rfc, lcom
com.acme.OrderManager, 87,  1,   0,  19,  142, 612
```

How to read it, in order:

1. **WMC 87** — large. Many methods or branchy ones. Likely doing several jobs.
2. **CBO 19** — high coupling. Touches 19 other classes; hard to test in isolation.
3. **RFC 142** — huge response set. A single call fans out across the codebase.
4. **LCOM 612** — very low cohesion. The methods barely share state.
5. **DIT 1, NOC 0** — flat, no subclasses. Not an inheritance problem.

**Verdict:** WMC + CBO + RFC + LCOM all elevated together is the classic **god class** signature. This is the first class to refactor. The metrics didn't tell you *that* — they told you *where to look*, and you confirmed it by reading.

---

## 12. Quick rules

- [ ] **WMC** high → class too big or too branchy → split by responsibility.
- [ ] **DIT** > 5 → inheritance too deep → prefer composition.
- [ ] **NOC** very high → base may be overloaded or wrongly subclassed.
- [ ] **CBO** > ~10 → coupling hotspot → introduce interfaces, inject dependencies.
- [ ] **RFC** > ~100 → does too much per message → decompose.
- [ ] **LCOM** high (or LCOM4 ≥ 2) → no single purpose → split the class.
- [ ] Several metrics elevated *together* on one class = god class. Refactor first.
- [ ] Never fail a build solely on a metric threshold. Metrics point; humans decide.

---

## 13. What's next

| Topic                                                          | File               |
| ------------------------------------------------------------- | ------------------ |
| LCOM1–4 in depth, fan-in/out, the Main Sequence, worked math  | `middle.md`        |
| Metric internals, statistical validity, when they mislead      | `senior.md`        |
| Running metrics in CI, gates that work, review vocabulary      | `professional.md`  |
| Canonical sources: CK 1994, Martin, McCabe                     | `specification.md` |
| Spotting design smells from a metrics report                   | `find-bug.md`      |
| Refactoring toward the Main Sequence / lower CBO               | `optimize.md`      |
| Run ck / SonarQube / JDepend on a real project                 | `tasks.md`         |
| Interview Q&A                                                   | `interview.md`     |

---

**Memorize this:** the CK suite is six numbers — **WMC** (class complexity), **DIT** (inheritance depth), **NOC** (subclasses), **CBO** (coupling), **RFC** (response-set size), **LCOM** (lack of cohesion) — each turning one OO intuition into something a tool can rank across a whole codebase. Add **cyclomatic complexity**, **LCOM4**, **fan-in/out**, and **instability/abstractness** (the Main Sequence) and you can locate every design hotspot in seconds. But metrics only *locate*; they never *diagnose*. The moment you make a metric a target, it stops measuring anything (Goodhart). Read the number, then read the code.
