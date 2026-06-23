# Law of Demeter — Practice Tasks

Eight exercises that force LoD-shaped thinking onto real Java code. Each is a refactor that compiles but breaks when the model reshapes, when tests need too many mocks, or when a database walks too far. Work each in three passes: (1) name the chain and the types it couples to, (2) sketch a forwarder-shaped solution on paper, (3) write code and a test that catches the original failure.

---

## Task 1 — Eliminate the tax chain

```java
public class CheckoutService {
    public Money totalDue(Order order) {
        Money subtotal = order.getCart().getSubtotal();
        Money tax = order.getCustomer().getAddress().getCountry().taxFor(order);
        return subtotal.plus(tax);
    }
}
```

**Objective.** `CheckoutService` should not know about the structure of customers, addresses, or countries.

**Constraints.**
- `CheckoutService.totalDue` becomes a one-line method.
- Every chain through internal structure becomes a method on the immediate owner.
- A unit test for `CheckoutService` mocks `Order` only — no `Customer`, `Address`, or `Country` mocks.

**Acceptance criteria.**
- `CheckoutService` has no import of `Customer`, `Address`, or `Country`.
- `Order.taxAmount()` (or similar) exists and is used in place of the chain.
- A model change that adds `Region` between `Address` and `Country` requires zero edits to `CheckoutService`.
- Deep-stubbing (`Answers.RETURNS_DEEP_STUBS`) is no longer needed in the test.

---

## Task 2 — Aggregate boundary on the order

```java
public class DiscountService {
    public void applyHolidayDiscount(Order order) {
        for (LineItem item : order.getLineItems()) {
            item.setPrice(item.getPrice().multiply(new BigDecimal("0.85")));
        }
    }
}
```

A second team writes:

```java
public class CouponService {
    public void applyCoupon(Order order, Coupon c) {
        order.getLineItems().forEach(li ->
            li.setPrice(li.getPrice().multiply(c.factor())));
    }
}
```

Both teams ship; promotions stack uncontrollably (1 − 0.85 × 0.90 = 0.235 off).

**Objective.** Prevent discounts from stacking by making `Order` the aggregate root.

**Constraints.**
- `LineItem` becomes package-private — invisible to callers outside the order package.
- `Order.applyDiscount(Discount)` is the only way to apply a discount; it enforces "at most one active discount".
- Both `DiscountService` and `CouponService` call `order.applyDiscount(...)`.

**Acceptance criteria.**
- Calling `order.applyDiscount(d1)` then `order.applyDiscount(d2)` throws or returns a failure indicator.
- `order.getLineItems()` no longer returns mutable items; callers cannot mutate prices directly.
- A test confirms that two services applying discounts in sequence produces a deterministic, non-stacking result.

---

## Task 3 — Stop walking JPA lazy graphs

```java
public class OrderReportService {
    @Transactional(readOnly = true)
    public List<ReportRow> report(LocalDate from, LocalDate to) {
        return orderRepo.findByPlacedAtBetween(from, to).stream()
            .map(o -> new ReportRow(
                o.getId(),
                o.getCustomer().getName(),
                o.getCustomer().getAddress().getCity(),
                o.getLineItems().size(),
                o.getTotal()))
            .toList();
    }
}
```

**Symptom.** With 10k orders, the report takes 90 seconds. DB logs show N+1: one query per order for customer, one per order for address, one per order for line items.

**Objective.** One SQL query, one network round-trip.

**Constraints.**
- Add a repository method that returns `ReportRow` directly via JPQL/SQL projection.
- The service no longer walks `Order -> Customer -> Address` or `Order.getLineItems()` for counting.
- The repository method JOINs the needed tables and aggregates server-side.

**Acceptance criteria.**
- The DB logs show one query for the entire report.
- The report runs in <500 ms for 10k orders.
- `OrderReportService` no longer imports `Customer` or `Address`.
- The report's wire-format mapper lives at the system boundary (it's the only LoD-exempt class).

---

## Task 4 — Replace the singleton chain

```java
public class TaxCalculator {
    public BigDecimal taxFor(Region region, BigDecimal subtotal) {
        BigDecimal rate = ServiceLocator.getInstance().getTaxRegistry().rateFor(region);
        return subtotal.multiply(BigDecimal.ONE.add(rate));
    }
}
```

**Objective.** `TaxCalculator` should talk to one collaborator (a `TaxRegistry` interface), and that collaborator should be injected.

**Constraints.**
- `ServiceLocator` does not appear in `TaxCalculator`.
- `TaxRegistry` is an interface in the same package as `TaxCalculator`.
- Tests pass an `InMemoryTaxRegistry`; production wires the yml-backed one in the composition root.

**Acceptance criteria.**
- `TaxCalculator` has exactly one field (`TaxRegistry`), `final`, set in the constructor.
- The test classpath does not include the yml-loader.
- Searching `TaxCalculator.java` for `ServiceLocator`, `getInstance`, or `static .* registry` returns zero hits.
- Swapping the yml backend for a Postgres backend is a one-class change.

---

## Task 5 — Untrain the wrecking notifier

```java
public class IncidentService {
    public void escalate(Incident incident) {
        if (incident.getOwner().getTeam().getSchedule().isOnCall(incident.getOwner())) {
            incident.getOwner().getContact().getPagerDuty().notify(incident);
        } else {
            incident.getOwner().getTeam().getNextOnCall().getContact().getEmail().send(
                "ESCALATION: " + incident.getId(), incident.summary());
        }
    }
}
```

**Objective.** Push the escalation logic onto the objects that own the data.

**Constraints.**
- `IncidentService.escalate(incident)` is one line.
- `Incident.escalate()`, `Team.notifyOnCallAbout(...)`, `Member.alertAbout(...)` exist and each has one collaborator.
- Pager vs email is a decision local to `Contact`, not to `IncidentService`.

**Acceptance criteria.**
- A test for `IncidentService` mocks only `Incident` and verifies `escalate()` is called.
- A test for `Team.notifyOnCallAbout(...)` mocks `Schedule` and the on-call `Member`, no further chain.
- Adding a third contact method (Slack) is a change to `Contact`, not to `Incident`, `Team`, or `Member`.

---

## Task 6 — Hide the cart's line items

```java
public class Cart {
    private final List<LineItem> items = new ArrayList<>();
    public List<LineItem> getItems() { return items; }   // returns the backing list
}
```

Callers do:

```java
cart.getItems().add(rogueItem);                 // bypasses validation
cart.getItems().remove(0);                      // removes without audit
cart.getItems().clear();                        // wipes silently
```

**Objective.** Callers cannot bypass `Cart`'s rules.

**Constraints.**
- `cart.items()` returns an `Iterable<LineItem>` (or a `List<LineItem>` that is unmodifiable).
- `cart.add(LineItem)` and `cart.remove(LineItemId)` are the only ways to mutate.
- `Cart` enforces invariants on add/remove (max 100 items, no duplicates by SKU).

**Acceptance criteria.**
- `cart.items().add(rogueItem)` throws `UnsupportedOperationException` (or doesn't compile).
- A test confirms that adding 101 items via `cart.add(...)` raises a domain exception.
- Audit logging happens inside `cart.add` and `cart.remove`, not at every caller.

---

## Task 7 — Make `Optional` chains real, not faked

```java
public class ShippingAddressFinder {
    public Address findFor(Order order) {
        if (order.getCustomer() != null) {
            if (order.getCustomer().getAddresses() != null
                && !order.getCustomer().getAddresses().isEmpty()) {
                return order.getCustomer().getAddresses().get(0);
            }
        }
        return null;
    }
}
```

**Objective.** Refactor into an `Optional` pipeline that respects LoD (chain through `Optional`, not through entities).

**Constraints.**
- `Order` returns `Optional<Customer>`.
- `Customer` returns `Optional<Address>` (or a `List` exposed only through a defaulting method).
- The finder uses `.map(...)` / `.flatMap(...)` exclusively; no `.isPresent()` / `.get()` pairs.

**Acceptance criteria.**
- `findFor` returns `Optional<Address>`.
- The pipeline is one expression; no nested `if` statements.
- The test "guest order with no customer" passes without throwing.
- A model change where `Customer` adds a primary-address flag doesn't change `ShippingAddressFinder`.

---

## Task 8 — Module-level LoD enforcement

You have an aggregate `com.acme.invoice` with internals (`LineItem`, `TaxLine`, `DiscountLine`) currently `public`. Other packages have been reaching into them:

```java
import com.acme.invoice.Invoice;
import com.acme.invoice.LineItem;       // shouldn't be importable

public class InvoiceReporter {
    public List<String> summarize(Invoice inv) {
        return inv.getLineItems().stream()
            .map(li -> li.getSku() + ":" + li.getPrice())
            .toList();
    }
}
```

**Objective.** Make the aggregate's internals *unreachable* from outside the package and, ideally, outside the module.

**Constraints.**
- `LineItem`, `TaxLine`, `DiscountLine` become package-private (no `public` modifier).
- `Invoice` exposes intent methods (`Invoice.summaryRows()` returning a `List<SummaryRow>` value record) instead of raw line-item access.
- The `module-info.java` for `com.acme.invoice` exports only `com.acme.invoice` (not `com.acme.invoice.internal` if you create one).
- `InvoiceReporter` is rewritten to use the new API.

**Acceptance criteria.**
- `import com.acme.invoice.LineItem` no longer compiles in `InvoiceReporter`.
- The `Invoice` API surface has *intent methods*, not getters for collaborators.
- `InvoiceReporter.summarize` is two lines.
- An ArchUnit test enforces no external package depends on `com.acme.invoice.internal`.

---

## Validation

| Task | How to verify the fix                                                                |
|------|---------------------------------------------------------------------------------------|
| 1    | `CheckoutService.java` has no import of customer/address/country.                     |
| 2    | Two consecutive `applyDiscount` calls produce a deterministic, non-stacking result.   |
| 3    | DB logs show 1 query for the entire report.                                           |
| 4    | Test classpath has no yml-loader; `TaxCalculator` test runs without disk I/O.         |
| 5    | `IncidentService` test mocks one object; adding a Slack contact is a Contact change.  |
| 6    | `cart.items().add(...)` fails at compile or runtime.                                  |
| 7    | `findFor` is one expression; no `null` checks.                                        |
| 8    | `import com.acme.invoice.LineItem` does not compile from outside the invoice package. |

---

## Worked solution sketch — Task 1 (eliminate the tax chain)

```java
// 1. Push the intent to Order; let the chain live inside its owner.
public final class Order {
    private final Cart cart;
    private final Customer customer;

    public Money totalDue() {
        return cart.subtotal().plus(taxAmount());
    }

    public Money taxAmount() {
        return customer.taxAmount(this);    // delegate one level deeper
    }
}

// 2. Customer delegates to its address.
public final class Customer {
    private final Address address;
    Money taxAmount(Order order) { return address.taxAmount(order); }
}

// 3. Address delegates to its country.
public final class Address {
    private final Country country;
    Money taxAmount(Order order) { return country.taxFor(order); }
}

// 4. CheckoutService becomes trivial.
public final class CheckoutService {
    public Money totalDue(Order order) { return order.totalDue(); }
}

// 5. The test shrinks to one mock.
@Test void totalIncludesTax() {
    Order order = mock(Order.class);
    when(order.totalDue()).thenReturn(Money.of(110));
    assertThat(checkout.totalDue(order)).isEqualTo(Money.of(110));
}
```

Notice three things in the sketch:

1. The chain still exists *physically* — inside `Order`, then inside `Customer`, then inside `Address`. The difference is that no method touches more than one collaborator.
2. `Customer.taxAmount` and `Address.taxAmount` are package-private (or could be) — the chain is an implementation detail.
3. A model reshape (e.g., adding `Region` between `Address` and `Country`) is one method change inside `Address`, not 20 changes spread across the codebase.

---

**Memorize this:** LoD violations don't show up as compiler errors — they show up the second time the model is reshaped, the second time a test needs five mocks, the second time the database returns 30,000 lazy queries. Each task above gives you that "second time" up front. If, after the refactor, the next plausible change touches *one* method on *one* class, you have applied the law correctly.
