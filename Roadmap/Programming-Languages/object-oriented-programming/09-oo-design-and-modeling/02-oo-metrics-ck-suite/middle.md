# OO Metrics — the CK Suite — Middle

> **What?** This file moves from "what each metric means" to "how each is actually defined, computed, and varied in practice". The CK definitions in the 1994 paper are *informal* — every tool resolves the ambiguities differently. Knowing the variants is the difference between trusting a report and being misled by it.
> **How?** We work through the four LCOM variants (the metric with the most disagreement), the exact definition of cyclomatic complexity and how it rolls into WMC, fan-in/fan-out, and the full instability/abstractness math behind Robert C. Martin's Main Sequence — each on concrete Java with the numbers computed by hand.

---

## 1. WMC and cyclomatic complexity, precisely

WMC's weight is a free choice; the paper says "weighting factors". Two standard instantiations:

- **WMC-unweighted** (weight = 1): WMC = number of methods. Trivial, what `ck` calls `wmc` is often actually the CC-weighted sum, so check your tool's docs.
- **WMC-CC** (weight = McCabe cyclomatic complexity): WMC = Σ CC of each method.

**Cyclomatic complexity (CC)** of a method = `E − N + 2P` on its control-flow graph (edges, nodes, connected components), which for a single method reduces to a count you can do by eye: **1 + the number of decision points**. Decision points: `if`, `for`, `while`, `case`, `catch`, `&&`, `||`, and the `?:` ternary.

```java
public String grade(int score, boolean curve) {
    if (score >= 90 || curve && score >= 85) return "A";  // if=+1, ||=+1, &&=+1
    if (score >= 80) return "B";                          // if=+1
    for (int i = 0; i < 3; i++) { log(i); }               // for=+1
    return "F";
}
// CC = 1 (base) + 5 (decision points) = 6
```

CC > 10 is McCabe's classic "restructure or test heavily" threshold; CC > 15 is hard to unit-test fully (you need 15+ test cases for path coverage). A class's WMC-CC is the sum, so a class of ten CC-2 methods (WMC 20) is very different from two CC-10 methods (WMC 20) even at equal WMC — the second is denser and worse.

> **Cognitive complexity** (SonarQube's metric) is CC's successor: it penalizes *nesting* and rewards linear code, so a flat `switch` scores low while deeply nested `if`s score high. Prefer it over raw CC for "how hard is this to read".

---

## 2. The four LCOMs — why cohesion is the messiest metric

LCOM is the CK metric people get wrong most, because there are at least four incompatible definitions all called "LCOM".

**LCOM1 (CK 1994).** P = method-pairs sharing no field, Q = pairs sharing ≥1 field. `LCOM1 = max(P − Q, 0)`. Range 0..(n choose 2). Problem: it can't distinguish degrees above its floor of 0, and a single utility field touched by all methods drives it to 0 regardless of real cohesion.

**LCOM2 (CK revised).** Same P, Q; reported as `max(P − Q, 0)` but normalized differently across tools. Same weaknesses.

**LCOM3 / LCOM* (Henderson-Sellers).** A normalized version: with `m` methods, `a` fields, and `μ(f)` = number of methods accessing field `f`:

```
LCOM3 = ( (1/a) * Σ μ(f)  −  m ) / ( 1 − m )
```

Range 0..1; 0 = perfectly cohesive (every method touches every field), 1 = no cohesion. Stable and comparable, but still a single aggregate number.

**LCOM4 (Hitz & Montazeri) — the one to use.** Model the class as a **graph**: nodes = methods; draw an edge between two methods if they share a field *or* one calls the other. **LCOM4 = the number of connected components.**

```java
public class AccountAndReport {
    private double balance;     // group A
    private List<String> rows;  // group B

    void deposit(double d)  { balance += d; }        // touches balance
    void withdraw(double d) { balance -= d; }        // touches balance
    void addRow(String r)   { rows.add(r); }         // touches rows
    String render()         { return String.join(",", rows); } // touches rows
}
```

Component 1 = {`deposit`, `withdraw`} (share `balance`). Component 2 = {`addRow`, `render`} (share `rows`). No edge between the groups → **LCOM4 = 2** → split into `Account` and `Report`. **LCOM4 = 1** is the goal; **≥ 2** literally tells you "there are N independent classes hiding in here".

| Variant | Range      | Reads as                          | Verdict           |
| ------- | ---------- | --------------------------------- | ----------------- |
| LCOM1/2 | 0..(n²)    | higher = worse, floors at 0       | noisy, avoid      |
| LCOM3   | 0..1       | 0 cohesive, 1 incohesive          | usable aggregate  |
| LCOM4   | 1..n       | count of hidden classes           | **best, actionable** |

---

## 3. CBO, fan-in, and fan-out

CBO counts distinct classes coupled to a class, in *either* direction, excluding inheritance ancestors and (usually) the JDK. Most tools let you split it:

- **Fan-out (efferent, Ce at class level):** classes *this* class depends on. High fan-out = this class breaks when others change.
- **Fan-in (afferent, Ca at class level):** classes that depend on *this* one. High fan-in = changing this class breaks many others.

```java
public class TaxRules {           // fan-in is high: many callers
    public Rate rateFor(Region r, Category c) { ... }   // fan-out 2: Region, Category
}
```

A class wants **low fan-out** (cheap to change) and is *allowed* high fan-in only if it's **stable and well-tested** — high fan-in on a churny class is a shotgun-surgery generator ([shotgun surgery](../../07-antipatterns-and-code-smells/06-shotgun-surgery/)). The combination **high fan-in + high fan-out** is the worst: a hub that both breaks easily and breaks everything.

---

## 4. Instability — the package-level coupling metric

Robert C. Martin lifted afferent/efferent coupling to the **package** scale (in *Agile Software Development, Principles, Patterns, and Practices*, 2002):

- **Ca (afferent coupling):** number of classes *outside* the package that depend on classes *inside* it.
- **Ce (efferent coupling):** number of classes *inside* the package that depend on classes *outside* it.

**Instability:**

```
I = Ce / (Ca + Ce)        range 0..1
```

- **I = 0** → maximally **stable**: nothing inside depends outward, lots depends on it. Hard to change (many would break), so it *should* be hard to change — make it abstract.
- **I = 1** → maximally **unstable**: depends on everything, nothing depends on it. Easy to change — fine for leaf/application code.

```
package com.acme.domain   : Ca = 40, Ce = 2  → I = 2/42  ≈ 0.05   (very stable)
package com.acme.web       : Ca = 1,  Ce = 30 → I = 30/31 ≈ 0.97   (very unstable)
```

The dependency rule (and the Stable Dependencies Principle): **depend in the direction of stability** — unstable packages should point at stable ones, never the reverse. `web` depending on `domain` is healthy; `domain` depending on `web` is an architectural inversion.

---

## 5. Abstractness and the Main Sequence

A stable package is dangerous if it's also *concrete* — you can't extend it without modifying it, yet everyone depends on it (the "zone of pain"). Martin's fix pairs instability with **abstractness**:

```
A = (abstract classes + interfaces in package) / (total classes in package)    range 0..1
```

- **A = 0** → fully concrete.
- **A = 1** → fully abstract (all interfaces / abstract classes).

The **Main Sequence** is the line **A + I = 1**. Good packages sit near it:

- Stable + abstract (top-left, I≈0, A≈1) — a package of interfaces everyone implements. Healthy.
- Unstable + concrete (bottom-right, I≈1, A≈0) — application glue code. Healthy.

The two danger zones:

| Zone              | Position        | Meaning                                                  |
| ----------------- | --------------- | -------------------------------------------------------- |
| **Zone of Pain**  | I≈0, A≈0        | stable *and* concrete — rigid, hard to extend, everyone depends on it |
| **Zone of Uselessness** | I≈1, A≈1  | unstable *and* abstract — abstractions nobody uses        |

**Distance from the main sequence:**

```
D = | A + I − 1 |       range 0..1, lower is better
```

`D` near 0 = on the sequence (healthy). `D` near 1 = deep in a danger zone. JDepend computes `D` for every package — sort by it descending and the worst-placed packages float to the top. Refactoring toward the line is the subject of [`optimize.md`](optimize.md).

---

## 6. A full worked computation

Take this package `com.acme.billing` with three classes:

```java
public interface Invoice { Money total(); }                 // abstract

public final class StandardInvoice implements Invoice {     // concrete
    private final List<LineItem> items;                     // depends: LineItem (in-package)
    public Money total() { /* sum items, call TaxRules */ }  // depends: TaxRules (out-of-package)
}

public final class InvoicePrinter {                          // concrete
    public void print(Invoice i, Printer p) { ... }          // depends: Printer (out-of-package)
}
```

Assume `LineItem` is in-package; `TaxRules`, `Printer`, `Money` are out-of-package; and three external classes (`OrderService`, `Report`, `Api`) import `Invoice`.

- **Abstractness:** 1 abstract (`Invoice`) / 3 total = **A = 0.33**.
- **Ce:** in-package classes depending outward → `StandardInvoice`→`TaxRules`, `InvoicePrinter`→`Printer` (+`Money`) → distinct external classes = `TaxRules`, `Printer`, `Money` → **Ce = 3**.
- **Ca:** external classes depending in → `OrderService`, `Report`, `Api` → **Ca = 3**.
- **Instability:** I = 3/(3+3) = **0.5**.
- **Distance:** D = |0.33 + 0.5 − 1| = **0.17** — close to the main sequence, healthy.

Now compare a hypothetical `com.acme.util` with A = 0 (all concrete), Ca = 60, Ce = 1 → I ≈ 0.016, D = |0 + 0.016 − 1| ≈ **0.98**. Deep in the **zone of pain**: a concrete utility everyone depends on. That's your refactor target, and the numbers said so before you opened a file.

---

## 7. How tools differ (and why your numbers won't match a paper)

The 1994 definitions leave choices that every tool resolves differently:

| Ambiguity                              | Common resolutions                                   |
| -------------------------------------- | ---------------------------------------------------- |
| Are constructors counted in WMC/RFC?   | Some yes, some no                                    |
| Are inherited methods in WMC?          | CK says *defined in the class*; some tools include inherited |
| Does RFC count *all* called methods or one level? | CK: methods called by the class's methods (one level); some tools go transitive (RFC′) |
| Are JDK / `java.*` classes in CBO?     | Usually excluded; some include them                  |
| Are interfaces counted in DIT?         | Class-only vs class+interface depth                  |
| Static methods in LCOM?                | Often excluded (no instance fields to share)         |

**Consequence:** never compare absolute metric values across tools or across the literature. Compare **within one tool, over time, on your codebase**. A class whose CBO rose from 6 to 18 over six months is a signal regardless of how the tool counts; a single absolute "CBO = 12" is meaningless without the tool's definition.

---

## 8. Putting metrics together — composite smells

No single metric diagnoses a smell; *combinations* do. The patterns worth memorizing:

| Smell                         | Metric signature                                   |
| ----------------------------- | -------------------------------------------------- |
| **God class**                 | high WMC + high CBO + high RFC + high LCOM together |
| **Data class / anemic**       | many fields, near-zero WMC, near-zero CC            |
| **Feature envy**              | a method with high coupling to *one other* class    |
| **Deep, fragile hierarchy**   | high DIT + high NOC + refused-bequest signs         |
| **Zone of pain (package)**    | low I + low A + high Ca + high D                    |
| **Shotgun-surgery hub**       | very high fan-in on a frequently-changed class      |

See [`find-bug.md`](find-bug.md) for reading these from real reports, and cross-reference [god class](../../07-antipatterns-and-code-smells/01-god-class/) and [feature envy](../../07-antipatterns-and-code-smells/03-feature-envy/).

---

## 9. What's next

| Topic                                                      | File               |
| --------------------------------------------------------- | ------------------ |
| Why metrics mislead, statistical validity, threshold lore | `senior.md`        |
| CI gates, review use, ratchets that work                  | `professional.md`  |
| CK 1994 / Martin / McCabe — canonical text                | `specification.md` |
| Diagnose smells from reports                               | `find-bug.md`      |
| Refactor toward the main sequence / lower CBO              | `optimize.md`      |

---

**Memorize this:** every CK metric has implementation variants — especially LCOM, where **LCOM4 (connected components, 1 = good, ≥2 = split)** is the only actionable version. Cyclomatic complexity (1 + decision points) feeds WMC. At the package level, **I = Ce/(Ca+Ce)**, **A = abstract/total**, and the **Main Sequence A + I = 1** with **distance D = |A + I − 1|** locate the zone-of-pain and zone-of-uselessness packages. Compare metrics *within one tool over time*, never as absolutes — and read combinations, because single metrics never diagnose a smell.
