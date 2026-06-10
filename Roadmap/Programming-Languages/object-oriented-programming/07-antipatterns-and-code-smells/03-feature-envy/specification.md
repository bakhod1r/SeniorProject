# Feature Envy — Specification

This file gives the objective definition of Feature Envy. "Looks envious" is opinion. **Metrics with thresholds** turn opinion into a falsifiable claim a tool can check. The canonical reference is Michele Lanza and Radu Marinescu, *Object-Oriented Metrics in Practice* (Springer, 2006), Chapter 4, which defines the three metrics every detector uses today: ATFD, FDP, and LAA.

## 1. The three metrics

### 1.1 ATFD — Access To Foreign Data

**Definition.** The number of distinct attributes from unrelated classes that a method accesses, either directly (field reference) or through accessor methods (getters).

**Formula.**

```
ATFD(m) = | { a : a is an attribute, a is declared in class C', C' != C(m),
              and m reads a directly or via a getter } |
```

where `C(m)` is the class declaring method `m`. Counting is **distinct attributes**, not call sites — reading `customer.getName()` four times counts as one.

**What it captures.** How many pieces of someone else's state this method depends on. High ATFD means the method's purpose is glued to another class's data shape.

### 1.2 FDP — Foreign Data Providers

**Definition.** The number of distinct classes (other than the method's own) from which the method accesses attributes.

**Formula.**

```
FDP(m) = | { C' : C' is a class, C' != C(m),
             and m accesses at least one attribute of C' } |
```

**What it captures.** How spread out the envy is. ATFD high but FDP = 1 means envy targeted at one specific class (Move Method candidate). ATFD high with FDP high means the method is a coordinator pulling from many sources — possibly a service method that is fine, or possibly an envious God Method.

### 1.3 LAA — Locality of Attribute Accesses

**Definition.** The ratio of attribute accesses to the method's own class against total attribute accesses (own + foreign).

**Formula.**

```
LAA(m) = AOWN(m) / ( AOWN(m) + AFOR(m) )
```

where:
- `AOWN(m)` = count of accesses to attributes of `C(m)` (the method's own class).
- `AFOR(m)` = count of accesses to attributes of any other class.

Range: `0.0` (pure envy — touches nothing of its own) to `1.0` (no envy — only touches own state).

**What it captures.** Where the method's *centre of gravity* lies. A method with LAA = 0.2 spends 80% of its access budget on other people's data — it lives in the wrong class.

## 2. Lanza & Marinescu thresholds

The book defines a method as **Feature Envy** when **all three** of the following hold:

| Metric | Threshold | Meaning |
|--------|-----------|---------|
| ATFD   | > 5       | Touches many foreign attributes |
| LAA    | < 1/3 (≈0.33) | Centre of gravity outside own class |
| FDP    | ≤ 5 (FEW) | Envy concentrated on a small number of providers |

The conjunction matters. **Any single threshold alone is insufficient.**

- High ATFD with high LAA → method accesses lots of foreign data but mostly works with its own state. It is a coordinator, not envious.
- Low LAA with high FDP → the method spreads across many classes. It is a God Method or a transaction script, not Feature Envy. The fix is different (Extract Class), not Move Method.
- High ATFD with low LAA and **few** providers → classic Feature Envy. Move the method to the dominant provider.

The "FEW" cap on FDP is what makes Move Method viable. If a method envies 12 different classes you cannot move it anywhere sensible.

## 3. Identifying the move target

Once a method is flagged, the **target class** for Move Method is the foreign class with the highest contribution to ATFD.

```
target(m) = argmax_{C' != C(m)} | { a : a is an attribute of C',
                                       and m accesses a } |
```

If two classes tie, prefer the one with which the method shares its strongest behavioural cohesion (calls to that class's non-accessor methods).

## 4. Worked example

```java
public class OrderService {
    public Money calculateOrderTotal(Order order) {       // method m
        Money subtotal = Money.ZERO;
        for (LineItem item : order.getItems()) {           // Order.items, LineItem
            BigDecimal qty = item.getQuantity();           // LineItem.quantity
            Money price = item.getUnitPrice();             // LineItem.unitPrice
            subtotal = subtotal.plus(price.times(qty));
        }
        Customer c = order.getCustomer();                  // Order.customer
        BigDecimal disc = c.getDiscountRate();             // Customer.discountRate
        BigDecimal tax = c.getTaxRate();                   // Customer.taxRate
        return subtotal
            .times(BigDecimal.ONE.subtract(disc))
            .times(BigDecimal.ONE.add(tax));
    }
}
```

Counting:

- Foreign attributes accessed: `Order.items`, `Order.customer`, `LineItem.quantity`, `LineItem.unitPrice`, `Customer.discountRate`, `Customer.taxRate`. **ATFD = 6.**
- Distinct foreign classes: `Order`, `LineItem`, `Customer`. **FDP = 3.**
- Own attribute accesses: zero (`OrderService` has no relevant state). **AOWN = 0.**
- Foreign accesses (count call sites): roughly 6 distinct + the loop multiplier; counting distinct sites: 6. **AFOR ≈ 6.**
- LAA = 0 / (0 + 6) = **0.0.**

Check thresholds: ATFD = 6 > 5; LAA = 0 < 0.33; FDP = 3 ≤ 5. **All three pass — this is Feature Envy.**

Target class: `LineItem` contributes 2 attributes, `Order` contributes 2, `Customer` contributes 2. Tied. Behavioural cohesion: the loop body is dominated by `LineItem` math, so move `lineTotal` to `LineItem`, then move `calculateOrderTotal` to `Order`. Two Move Method refactorings, applied in order.

## 5. Tool implementations

Most static analysers implement these metrics:

- **inFusion / iPlasma** (Marinescu's own tools) — direct implementation of the book's definitions.
- **JArchitect** — query language exposes `FeatureEnvyMethods` based on identical thresholds.
- **SonarJava S3398** — uses a simplified ATFD-based heuristic. Default threshold flags methods reading more than 4 distinct attributes from a single other class.
- **IntelliJ IDEA "Feature envy" inspection** — under *Class metrics*. Configurable thresholds, default close to Lanza & Marinescu.
- **PMD** — does not implement directly; the closest is `LawOfDemeter`, which catches a related shape.
- **DesigniteJava** — open-source design smell detector implementing the full Lanza & Marinescu suite.

When you change thresholds, change them deliberately. Lowering ATFD to 3 will flood your dashboard with false positives. Raising to 8 will miss real envy. Defaults are calibrated on large empirical corpora; deviate only with evidence.

## 6. Calibration tips

- **Exclude generated code** (`@Generated`, MapStruct output, JPA static metamodel). Generated mappers are envious by design.
- **Exclude `equals`, `hashCode`, `toString`, `compareTo`**. These legitimately read all fields.
- **Exclude test classes** if your tests use builders or DTO assemblers heavily.
- **Treat record accessors as field access**, not method calls — most tools already do.

## 7. Related metrics that are not Feature Envy

To prevent confusion, three commonly cited metrics that catch *different* smells:

- **CBO (Coupling Between Object classes)** — measures class-level coupling, not method-level envy.
- **LCOM (Lack of Cohesion of Methods)** — flags God Classes, not envious methods.
- **NOAM (Number of Accessor Methods)** — flags Data Classes (the *target* of envy, not the envier).

Feature Envy is a **method-level** smell, defined by ATFD, FDP, and LAA together. Class-level smells need their own metrics.

## Memorize this

Feature Envy is defined by three metrics together: **ATFD > 5**, **LAA < 1/3**, and **FDP ≤ 5** (Lanza & Marinescu, 2006). ATFD counts distinct foreign attributes accessed; FDP counts the distinct foreign classes; LAA is the ratio of own-attribute accesses to total accesses. All three must hold — any single threshold alone catches a different smell. The move target is the foreign class contributing the most to ATFD. Tools: JArchitect, SonarJava S3398, IntelliJ "Feature envy" inspection, DesigniteJava. Calibrate by excluding generated code, `equals`/`hashCode`, and tests.
