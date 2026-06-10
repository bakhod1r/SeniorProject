# Feature Envy — Senior

> **What?** The cases where Feature Envy is not a smell but a *design*: Strategy, Visitor, cross-cutting concerns, mappers, comparators. The tooling that gets it right (IntelliJ's *Feature Envy* inspection, SonarJava's correlated rules) and the tooling that gets it wrong. A real refactoring walkthrough on a 400-line god-method, broken into seven commits with the reasoning on each.
> **How?** Treat Feature Envy as a *score*, not a binary verdict. Some methods score high and are bugs. Some score high and are correct designs. The senior skill is telling them apart on sight and citing the design pattern (or anti-pattern) that explains the verdict.

---

## 1. Envy as a numerical signal, not a binary

The junior file said "count foreign accesses". The middle file said "compute LAA". The senior reality is that *every* method has *some* foreign access — the question is whether the ratio sits in a normal band for the method's role.

A rough mental model:

| Method role                    | Expected LAA  | Expected ATFD | Verdict if exceeded   |
| ------------------------------ | ------------- | ------------- | --------------------- |
| Domain method on entity        | > 0.5         | < 3           | Feature Envy          |
| Mapper / projector             | ~0.0          | high          | By design             |
| Visitor `visit(X)`             | ~0.0          | high          | By design             |
| Comparator                     | ~0.0          | exactly 2 sources | By design          |
| Service-layer orchestration    | < 0.3         | 3–7           | Acceptable if shallow |
| DTO assembler                  | ~0.0          | very high     | By design             |
| Validator                      | low           | low           | Investigate           |

A single ATFD or LAA threshold catches all of these as "envious". A senior reviewer reads the *role* the method plays before treating the metric as a verdict. The tool's job is to surface candidates; the human's job is to classify each one as bug, by-design, or borderline.

---

## 2. Strategy — envy that is the point of the pattern

A Strategy *exists* to operate on another object's data. That's literally the GoF definition: encapsulate an algorithm, vary it independently from the data it acts on.

```java
public interface PricingStrategy {
    BigDecimal price(Cart cart, Customer customer);
}

public class StandardPricing implements PricingStrategy {
    @Override
    public BigDecimal price(Cart cart, Customer customer) {
        BigDecimal subtotal = cart.subtotal();
        BigDecimal discount = customer.loyaltyPoints() * 0.01;
        return subtotal.subtract(BigDecimal.valueOf(discount));
    }
}

public class BlackFridayPricing implements PricingStrategy {
    @Override
    public BigDecimal price(Cart cart, Customer customer) {
        BigDecimal subtotal = cart.subtotal();
        return subtotal.multiply(new BigDecimal("0.70")); // flat 30% off
    }
}
```

Every `price` method reads `Cart` and `Customer` — high ATFD by construction. A naive metric calls this envy and asks you to move `price` onto `Cart` or `Customer`. Doing so would *destroy* the pattern: you'd have to fork `Cart` into `StandardCart` and `BlackFridayCart`, or sprinkle `if (strategy == ...)` through `Cart.price()`. The whole point of Strategy is that the algorithm varies while the data stays put.

**How to recognise a legitimate Strategy:** (a) the envious class implements an interface whose name is an algorithm or rule, (b) multiple sibling classes exist with the same interface and signature, (c) the call site chooses *which* sibling to use at runtime. Three checks; if all three pass, the envy is the design.

---

## 3. Visitor — envy formalised as a pattern

The Visitor pattern is Feature Envy *as a deliberate architectural choice*. You have a stable data structure (an AST, a document tree, an account hierarchy) and many operations you want to add without modifying the data classes. Each operation becomes a Visitor; each `visit` method reads the visited object's fields.

```java
public sealed interface FinancialAsset permits CashAccount, StockHolding, RealEstate {
    <R> R accept(AssetVisitor<R> v);
}

public record CashAccount(BigDecimal balance) implements FinancialAsset {
    @Override public <R> R accept(AssetVisitor<R> v) { return v.visit(this); }
}
public record StockHolding(int shares, BigDecimal pricePerShare) implements FinancialAsset {
    @Override public <R> R accept(AssetVisitor<R> v) { return v.visit(this); }
}

public interface AssetVisitor<R> {
    R visit(CashAccount c);
    R visit(StockHolding s);
    R visit(RealEstate r);
}

public class MarketValueVisitor implements AssetVisitor<BigDecimal> {
    @Override public BigDecimal visit(CashAccount c)  { return c.balance(); }
    @Override public BigDecimal visit(StockHolding s) { return s.pricePerShare().multiply(BigDecimal.valueOf(s.shares())); }
    @Override public BigDecimal visit(RealEstate r)   { return r.appraisedValue(); }
}
```

`MarketValueVisitor.visit(StockHolding)` is 100% envious by metric. It's also correct. New operations (`TaxBasisVisitor`, `ReportVisitor`, `InsuranceVisitor`) plug in without touching `CashAccount`, `StockHolding`, or `RealEstate`. That's OCP via Visitor.

**Modern Java alternative.** With sealed types and pattern matching (JEP 441), Visitor's verbosity collapses to:

```java
public static BigDecimal marketValue(FinancialAsset a) {
    return switch (a) {
        case CashAccount c  -> c.balance();
        case StockHolding s -> s.pricePerShare().multiply(BigDecimal.valueOf(s.shares()));
        case RealEstate r   -> r.appraisedValue();
    };
}
```

Same envy, simpler shape. The senior question is: do you have *many* operations or *few*? Many → Visitor (or pattern-match function). Few → put the methods on the asset types directly.

---

## 4. Cross-cutting concerns — logging, security, auditing

A `SecurityAuditor.canAccess(Resource r, Principal p)` reads everything off both objects. It's envious of both. It's also exactly where authorisation logic should live — *not* on `Resource`, *not* on `Principal`, but in a third place that joins them.

The same applies to:

- **Persistence mappers** (`OrderEntity` → `OrderRow`) — by-design envy at the layer boundary.
- **Logging formatters** — read the object, render text. Putting `toLogString()` on every domain class is a worse design.
- **Validators** — sometimes belong on the validated type (preconditions), sometimes belong in a separate validator (cross-field rules across multiple aggregates).
- **Authorisation policies** — must join multiple objects' state to render a verdict; the verdict-rendering doesn't belong on any single object.

A heuristic: if the "envy" is *bilateral* (the method reads from two equally-important objects), it usually belongs in a third class. If the envy is *unilateral* (heavily reads one, lightly uses the other), it usually belongs on the heavily-read object.

---

## 5. IntelliJ IDEA's Feature Envy inspection

IntelliJ ships a *Feature Envy* inspection under *Settings → Editor → Inspections → Class structure*. It is *off by default* — turn it on.

The default heuristic, in IntelliJ's terms:

- A method `m` on class `C` is flagged if it accesses `≥ N` distinct members of *another class* `D`, and accesses fewer members of `C` itself.
- Default `N` is 4. You can tighten to 3 or loosen to 5 depending on signal-to-noise.

What IntelliJ does well:

- Suggests *Move Method* via the *Refactor → Move Method* action, with `D` as the target class.
- Counts both field accesses and method calls, including chained calls.
- Reports per-method, with the source and target classes shown.

What IntelliJ does poorly:

- Cannot distinguish a Strategy implementer from a buggy envious method — both look the same.
- Misses envy through generics (`List<Customer>.get(0).getX()` may not trip).
- False-positive on Visitor `visit` methods and on Comparators.

Use the inspection to surface candidates in a sweep; *never* run an automatic refactor without reading each result.

---

## 6. SonarJava rules that correlate

SonarJava does not ship a rule explicitly named "Feature Envy", but several rules fire on the same code shapes:

| Sonar rule | What it catches                                              | Envy correlation                |
| ---------- | ------------------------------------------------------------ | ------------------------------- |
| **S3398**  | "Methods should not have too many parameters" — but the named smell in the long description is parameter-object/envy. | High when envy passes the foreign object plus its disassembled state. |
| **S1448**  | "Methods should not be too long".                            | Long methods often hide envy.   |
| **S3776**  | "Cognitive Complexity of methods should not be too high".    | Nested envy raises this.        |
| **S1820**  | "Classes should not have too many fields".                   | God-class symptom adjacent.     |
| **S1192**  | "String literals should not be duplicated".                  | Indicates envy on a `String`-typed foreign field. |
| **S2384**  | "Mutable members should not be stored or returned directly". | Tied to over-exposing internal state — the precondition for envy. |
| **S1213**  | "Modifiers should be declared in the correct order".         | Not relevant — listed only because some teams treat *every* Sonar issue as equal; this one isn't envy. |

The most-honest single rule is **squid:S3398** when its description is read carefully — Sonar's text explicitly mentions "should be moved to the class on which it operates".

---

## 7. A real refactoring — seven-commit walkthrough

The fictional but representative target: a 400-line `OrderProcessor.process(Order)` method that does validation, pricing, tax, inventory check, payment, persistence, notification, and audit logging — and reads from `Customer`, `Cart`, `Address`, `PaymentMethod`, and `TaxRegime` along the way.

The full code would consume this whole file. Instead, here is the *commit ladder* a senior engineer would follow.

**Commit 1 — Extract Method, no moves.**
Break `process` into seven private methods: `validate`, `priceCart`, `applyTax`, `reserveInventory`, `chargeCard`, `persist`, `notify`. The class is still bloated, but each piece is now a candidate for the next step.

**Commit 2 — Move Method: pricing onto `Cart`.**
`priceCart(Cart c)` is 100% envious of `Cart`. Move it, rename to `Cart.subtotal()`. Delete `Cart.getItems()` if no other caller used it.

**Commit 3 — Move Method: tax onto `TaxRegime`.**
`applyTax(BigDecimal base, TaxRegime regime, Address shippingTo)` reads `regime` heavily. Move to `regime.amountOn(base, shippingTo)`. The processor now reads `regime.amountOn(...)` — one line, no envy.

**Commit 4 — Extract Class: `InventoryReservation`.**
The inventory-check block is too big to live on `Order` and not envious of any single class — it coordinates `Cart`, `Warehouse`, `ReservationLog`. Extract as `class InventoryReservation`, inject through the processor's constructor.

**Commit 5 — Replace Method with Method Object: `PaymentExecution`.**
Card charging mixes three foreign objects (`Cart`, `PaymentMethod`, `Customer`). Use Fowler's *Replace Method with Method Object* (ch. 6) — turn the block into its own class with the three parameters as fields and a single `execute()` method.

**Commit 6 — Move Method: persistence onto `OrderRepository`.**
The processor was building SQL strings inside itself. Move all persistence behind `OrderRepository.save(Order)` (DIP cleanup).

**Commit 7 — Audit + notification through events.**
Audit logging and "send confirmation email" were the last envy hot spots — both reading `Order` and `Customer`. Refactor to event publication: the processor publishes `OrderPlaced(orderId)`; an `AuditListener` and a `ConfirmationMailer` subscribe.

**End state.** `OrderProcessor.process(Order)` is 30 lines: validate, compute, reserve, charge, persist, publish. Every step is a single call on a collaborator. Every collaborator owns its own envy-free behaviour. The 400 lines didn't shrink — they redistributed.

This is what a senior reviewer means by "extract and move iteratively". Not one heroic PR, but a sequence of mechanical commits, each of which is independently testable, reviewable, and revertable.

---

## 8. The envy that *should* stay

Five concrete cases where a junior or a metric will scream "envy" and the senior answer is "leave it":

**Case 1 — Pure functional projection.**

```java
public static OrderSummary summarise(Order o) {
    return new OrderSummary(o.id(), o.customer().name(), o.total(), o.status());
}
```

A static projection. No behaviour, just packaging. Putting `toSummary()` on `Order` is acceptable but adds nothing; leaving it static is also acceptable, especially if the summary lives in a different module that `Order` shouldn't know about.

**Case 2 — DSL builder.**

```java
public class QueryBuilder {
    public QueryBuilder where(Column c, Object value) { ... }
}
```

`where` reads `c.name()`, `c.type()`, `c.tableAlias()`. By design.

**Case 3 — Spec / matcher.**

```java
public class IsAdultCustomer implements Specification<Customer> {
    @Override public boolean isSatisfiedBy(Customer c) {
        return c.age() >= 18 && c.country().allowsAdultsAt(18);
    }
}
```

The Specification pattern (Eric Evans, *Domain-Driven Design*, 2003) is envy-by-design. Putting `isAdult()` on `Customer` is also fine, but specs let you compose (`adult.and(verified).and(notBanned)`) cheaply.

**Case 4 — Renderers and exporters.**

```java
public class HtmlInvoiceRenderer {
    public String render(Invoice i) { ... }
}
```

Format conversion belongs at the edge of the domain. Don't move it inside.

**Case 5 — Algorithms parameterised by data.**

```java
public class KMeansClustering {
    public List<Cluster> cluster(List<DataPoint> points, int k) { ... }
}
```

An algorithm reads its inputs. Moving `cluster()` onto `DataPoint` would be absurd.

If you can name the pattern (Strategy, Visitor, Specification, Builder, Renderer, Algorithm), the envy is the design. If you can't, it's a smell.

---

## 9. Anti-patterns that hide envy

Three coding styles that *conceal* Feature Envy from tooling and reviewers:

**The "manager" or "helper" class.** `OrderManager.processOrder(Order o)` reads `Order` exhaustively. The "manager" name disguises the fact that this is `Order`'s own behaviour wearing a costume. Same for `OrderHelper`, `OrderUtils`, `OrderService` when "service" means "thing that does what `Order` should do".

**Static utility classes full of foreign access.**

```java
public final class CustomerUtils {
    public static BigDecimal discountFor(Customer c) { ... }
    public static boolean isPremium(Customer c) { ... }
    public static String shippingLabel(Customer c) { ... }
}
```

Every method is envious of `Customer`. The `Utils` suffix is admitting it; the static modifier is the disguise. Move them onto `Customer`.

**Deeply-nested parameter passing.** A method that takes `Customer c` and immediately calls a private helper with `c.getName(), c.getTier(), c.getPoints()` — and the helper takes three primitives. The envy has been *flattened* into the parameter list to dodge IDE inspection. Worse: now you can't pass a `Customer` subtype polymorphically. Re-aggregate the parameters into the original object.

---

## 10. Refactoring tools and their limits

IDEs can do mechanical *Move Method* for you, but they cannot decide *whether* to move. The decisions you must make manually:

- Should this method be `public`, `protected`, `package-private` on the target class? (IDE picks `public` by default; it's often wrong.)
- Should the parameter list of the moved method change? (Often the original first parameter becomes `this` and disappears; the IDE handles this.)
- Are there call sites that should *also* move? (Sometimes one envious method is a member of a cluster; move them as a set.)
- Does the move break the target class's invariants? (E.g., moving a state-mutating method onto a record breaks immutability.)
- Will the move create a new circular dependency between two packages?

IntelliJ's *Move Method* refactor handles the mechanical parts (signature, references, imports). The five questions above are still on you.

---

## 11. Envy and module boundaries

In a modular codebase (Java Platform Module System or just well-disciplined Maven modules), Feature Envy across a *module boundary* is a stronger smell than envy inside one module. It often means the module's exported surface is wrong — you exported raw state when you should have exported behaviour.

```java
// module shop.customer exports raw data
module shop.customer {
    exports shop.customer.api;     // Customer with getters
}

// module shop.checkout reads everything off Customer
module shop.checkout {
    requires shop.customer;
    // CheckoutService computes discount from customer.tier(), customer.points(), ...
}
```

The fix isn't to move `CheckoutService` to `shop.customer` — that's a layering violation in the other direction. The fix is to publish *behaviour* on `Customer` (`discountOn(BigDecimal)`) and stop exporting the raw fields:

```java
public final class Customer {
    private final Tier tier;
    private final int points;

    public BigDecimal discountOn(BigDecimal subtotal) { ... }
    // no getters for tier or points
}
```

`shop.checkout` calls `customer.discountOn(subtotal)`. The module boundary now carries behaviour, not data. The envy is impossible because the data isn't reachable.

---

## 12. Quick rules

- **Score, don't binary.** Envy is a numerical signal; classify each high-scoring method by role before refactoring.
- **Know the patterns.** Strategy, Visitor, Specification, Mapper, Comparator, Builder — all "envious" by design. Memorise the list.
- **Bilateral envy belongs in a third class.** Unilateral envy belongs on the heavily-read class.
- **IntelliJ surfaces candidates; you classify.** Never auto-refactor without a per-result review.
- **Static "Utils" classes full of foreign access are envy wearing a disguise.** Move the methods.
- **Module-boundary envy is the strongest signal.** Fix by exporting behaviour, not data.
- **Refactor in commits, not in PRs.** Seven small reviewable moves beat one heroic rewrite.
- **Records and sealed types should carry behaviour.** Anaemic records that exist for outside computation are envy bait.

---

## 13. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Architectural variants — anaemic services, DTOs, DDD aggregates    | `professional.md`  |
| Metrics — ATFD, FDP, LAA — Lanza & Marinescu thresholds            | `specification.md` |
| 10 numbered scenarios — diagnose and fix                           | `find-bug.md`      |
| Performance angles — getter chains, JIT inlining, cache locality   | `optimize.md`      |
| 8 exercises with worked solutions                                  | `tasks.md`         |
| Interview Q&A                                                      | `interview.md`     |

---

**Memorize this:** envy is not always a bug — it's a *score*. Patterns that exist to operate on another class's data (Strategy, Visitor, Specification, Mapper) score high and stay. Methods that score high without a pattern name are bugs. Senior judgement is naming the difference on sight.
