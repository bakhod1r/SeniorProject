# GRASP — Tasks

> Design exercises, graded easy → hard. GRASP is a *reasoning* skill, so these tasks ask you to make placement decisions and *defend them by pattern*, not just produce code that compiles. For each task, the acceptance criteria include naming the GRASP pattern(s) that justify your design — a design that works but can't be justified by a pattern hasn't met the bar. One task uses a metrics tool to *measure* coupling/cohesion before and after.

---

## Easy

### Task 1 — Restore Information Expert

You inherit this code:
```java
public record OrderLine(String sku, int qty, BigDecimal unitPrice) {}
public class Order { public List<OrderLine> getLines() { return lines; } private List<OrderLine> lines; }

public class OrderTotalCalculator {
    public BigDecimal total(Order o) {
        return o.getLines().stream()
                .map(l -> l.unitPrice().multiply(BigDecimal.valueOf(l.qty())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```
**Do:** Move the total computation to its rightful owner.
**Acceptance:**
- [ ] `total()` lives on `Order`; `OrderTotalCalculator` is deleted.
- [ ] `OrderLine` gains a `subtotal()` method (recursive Information Expert).
- [ ] `Order` no longer needs `getLines()` for this purpose (encapsulation improved).
- [ ] You can state in one sentence why each method is on the class it's on.

### Task 2 — Apply Creator

You have a `ShoppingCart` and `CartItem`. Currently a `CartController` does `new CartItem(...)` and adds it to the cart's internal list via a setter.
**Do:** Reassign creation per the Creator pattern.
**Acceptance:**
- [ ] `ShoppingCart.addItem(Product p, int qty)` creates the `CartItem` internally.
- [ ] No external class calls `new CartItem(...)`.
- [ ] State which Creator condition applies (aggregates? contains? has initializing data?).

### Task 3 — Replace a type-switch with Polymorphism

```java
public BigDecimal fee(String accountType, BigDecimal balance) {
    switch (accountType) {
        case "BASIC":   return new BigDecimal("5.00");
        case "PREMIUM": return BigDecimal.ZERO;
        case "STUDENT": return balance.signum() > 0 ? BigDecimal.ZERO : new BigDecimal("2.00");
        default: throw new IllegalArgumentException();
    }
}
```
**Do:** Turn `accountType` into a polymorphic hierarchy.
**Acceptance:**
- [ ] A `sealed interface AccountType` with a `monthlyFee(BigDecimal balance)` method.
- [ ] One record/class per type; the `switch` and the `default` exception are gone.
- [ ] Adding a fourth account type requires adding a class and editing *no* existing method.

---

## Medium

### Task 4 — Extract a Pure Fabrication + Indirection

This entity persists itself:
```java
public class Customer {
    private Long id; private String email;
    public void save() {
        try (var c = DriverManager.getConnection("jdbc:postgresql://localhost/app")) {
            /* INSERT/UPDATE */
        }
    }
}
```
**Do:** Remove persistence from the domain.
**Acceptance:**
- [ ] `Customer` has *no* `import java.sql.*` and no `save()`.
- [ ] A `CustomerRepository` *interface* (Indirection) and a `JdbcCustomerRepository` (Pure Fabrication) exist.
- [ ] The concrete repo is injected at a composition root, not constructed inside the domain.
- [ ] Write a unit test for `Customer` that needs *no* database.

### Task 5 — Thin a bloated Controller

Given a `RegistrationController.register(SignupDto)` that (a) validates the email format, (b) checks the password strength, (c) hashes the password, (d) inserts a row, (e) sends a welcome email — all inline.
**Do:** Reduce it to delegation.
**Acceptance:**
- [ ] Each of the five responsibilities is reassigned to its rightful owner; name the GRASP pattern for each.
- [ ] The controller method body is a sequence of delegations with no business `if`-chains, no SQL, no SMTP.
- [ ] Identify which responsibilities went to domain objects (Expert) and which to Pure Fabrications, and why.

### Task 6 — Design the POS `enterItem` flow from scratch

Given domain nouns `Sale`, `SaleLineItem`, `ProductDescription`, `ProductCatalog`, design the handling of the system event `enterItem(itemId, quantity)`.
**Do:** Produce a class design and a one-line GRASP justification for each responsibility.
**Acceptance:**
- [ ] A Controller receives `enterItem` and only delegates.
- [ ] `ProductCatalog` is the Expert for looking up a `ProductDescription`.
- [ ] `Sale` is the Creator of `SaleLineItem`.
- [ ] `SaleLineItem` and `Sale` are the (recursive) Experts for `subtotal()`/`total()`.
- [ ] You can name the pattern behind every method placement.

---

## Hard

### Task 7 — Resolve an Expert/Coupling conflict

Requirement: compute an order's shipping cost, which depends on the order's total weight (the order knows this) *and* on live rates from a `CarrierRateService` (an external HTTP API).
**Do:** Decide where the responsibility goes when Information Expert and Low Coupling conflict.
**Acceptance:**
- [ ] `Order` remains the Expert for `totalWeight()` and `destination()` — no HTTP coupling on the entity.
- [ ] A Pure Fabrication owns the part that calls the carrier; it depends on a `CarrierRateService` *interface* (Indirection).
- [ ] Write a 3-sentence justification explaining *why* the responsibility was split rather than placed wholly on `Order` or wholly on the service.
- [ ] The fabrication is unit-testable with a stubbed `CarrierRateService`.

### Task 8 — Protect a predicted variation

The business has confirmed: they will add a second payment provider next quarter, and tax rules differ by country and change yearly.
**Do:** Apply Protected Variations to *exactly these two* variation points — and to nothing else.
**Acceptance:**
- [ ] `PaymentGateway` and `TaxPolicy` interfaces wrap the two predicted variations; concrete impls sit at the edge.
- [ ] No *other* speculative interfaces are introduced (justify, per YAGNI, why you stopped where you did).
- [ ] Adding the second payment provider requires a new class and *zero* edits to existing payment-using code.
- [ ] State how this maps to OCP and DIP (PV as the superpattern).

### Task 9 — Encode GRASP boundaries as ArchUnit tests

For a layered project (`..domain..`, `..application..`, `..infrastructure..`):
**Do:** Write ArchUnit rules that make the key GRASP placements unbreakable.
**Acceptance:**
- [ ] A rule: no `..domain..` class depends on `java.sql..`, `javax.persistence..`, or `..infrastructure..`.
- [ ] A rule: classes named `*Controller` don't depend on `java.sql..`.
- [ ] A rule: `..domain..` depends on repository *interfaces*, never on `Jdbc*` classes.
- [ ] A deliberately-bad commit (drag JDBC into the domain) makes the test *fail*, proving it works.

### Task 10 — Metrics-driven refactor (tooling)

Take a god `OrderService` (≥ 8 responsibilities, ≥ 10 collaborators).
**Do:** Measure, refactor by GRASP, measure again.
**Acceptance:**
- [ ] **Before:** run a metrics tool (ckjm, Metrics Reloaded, or SonarQube) and record **CBO**, **WMC**, and **LCOM4** for `OrderService`.
- [ ] Refactor: split by responsibility (High Cohesion), extract Pure Fabrications, inject interfaces (Low Coupling).
- [ ] **After:** record the same three metrics for each resulting class.
- [ ] Demonstrate that **LCOM4** dropped (cohesion up) and that no single resulting class has the original CBO (coupling redistributed, not just moved).
- [ ] Write 4–5 sentences interpreting the numbers — *why* did LCOM fall, and where did the coupling go?

---

## Stretch — design critique

### Task 11 — Critique a GoF pattern choice in GRASP terms

Find (or write) a class that uses the Strategy or Adapter pattern.
**Do:** Justify *or refute* the pattern choice purely in GRASP forces.
**Acceptance:**
- [ ] Name the GRASP forces the pattern embodies (e.g. Strategy = Polymorphism + Protected Variations + Pure Fabrication).
- [ ] Decide whether the variation it protects is *real/predicted* or *speculative*.
- [ ] If speculative, propose the simpler direct design and state when you'd introduce the pattern instead.
- [ ] Conclusion in one sentence: "this pattern is/ isn't earned because the GRASP force behind it is/ isn't present."
