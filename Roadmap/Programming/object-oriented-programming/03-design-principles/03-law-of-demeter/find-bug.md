# Law of Demeter — Find the Bug

> 10 buggy snippets where reaching past immediate collaborators causes silent failures. For each: read the code, decide which navigation step crosses a boundary it shouldn't, identify the *runtime symptom* (NPE deep in the chain, stale data, mock cascade in tests, broken refactor), and write the fix.

---

## Bug 1 — `NullPointerException` mid-chain

```java
public class CheckoutService {
    public Money totalDue(Order order) {
        return order.getCustomer().getAddress().getCountry().taxFor(order);
    }
}
```

```java
// Caller — completely innocent:
Money tax = checkout.totalDue(guestOrder);   // guestOrder has no Customer
```

**Symptom.**

```
Exception in thread "checkout-worker" java.lang.NullPointerException
    Cannot invoke "Customer.getAddress()" because the return value of "Order.getCustomer()" is null
    at com.acme.CheckoutService.totalDue(CheckoutService.java:4)
```

The NPE message names the link `getAddress()` — but the *real* failure is one step earlier: the order had no customer. The stack trace lies about which class is wrong.

**Violation.** Train-wreck chain. `CheckoutService` is reaching through three classes' structures. Any null in the chain produces a generic NPE; the caller can't recover.

**Fix.** Push the intent to `Order`. The order knows whether it has a customer and how to compute its tax in both cases.

```java
public class Order {
    public Money taxAmount() {
        return customer
            .map(c -> c.address().country().taxFor(this))
            .orElse(Money.ZERO);
    }
}

public class CheckoutService {
    public Money totalDue(Order order) {
        return order.taxAmount();
    }
}
```

The branch is explicit, named, and tested at one place. The chain through `Optional<Customer>` is intentional pipeline-style.

---

## Bug 2 — Mock cascade in tests

```java
@Test void totalIncludesTax() {
    Order order = mock(Order.class);
    Customer customer = mock(Customer.class);
    Address address = mock(Address.class);
    Country country = mock(Country.class);

    when(order.getCustomer()).thenReturn(customer);
    when(customer.getAddress()).thenReturn(address);
    when(address.getCountry()).thenReturn(country);
    when(country.taxFor(order)).thenReturn(Money.of(10));
    when(order.subtotal()).thenReturn(Money.of(100));

    Money total = checkout.totalDue(order);

    assertThat(total).isEqualTo(Money.of(110));
}
```

**Symptom.** The test passes. Then `Address` is refactored to hold `Region` first and `Country` second, with the country derivable from the region. The production code still works (`address.country()` becomes `address.region().country()`). The test breaks because `address.getCountry()` no longer matches the mocked call.

The team's response: add another `when()`, or switch to `RETURNS_DEEP_STUBS`. Production stays brittle.

**Violation.** The production code's LoD violation surfaces as a test that mocks four objects to exercise one assertion. The test shape is the production shape inverted.

**Fix.** Same as Bug 1: push to `Order`. The test reduces to one mock plus one assertion:

```java
@Test void totalIncludesTax() {
    Order order = mock(Order.class);
    when(order.subtotal()).thenReturn(Money.of(100));
    when(order.taxAmount()).thenReturn(Money.of(10));
    assertThat(checkout.totalDue(order)).isEqualTo(Money.of(110));
}
```

The mock surface is the LoD-respected API; the test follows.

---

## Bug 3 — Refactor breaks every walker

```java
// Original model
public class Order {
    public Customer getCustomer() { return customer; }
}
public class Customer {
    public Address getAddress() { return address; }
}

// 20 places in the codebase do:
String city = order.getCustomer().getAddress().city();
```

```java
// New model — customers may now have multiple addresses
public class Customer {
    public List<Address> getAddresses() { return addresses; }
    public Address getDefaultAddress()  { return addresses.get(0); }
}
```

**Symptom.** Twenty compile errors. Twenty places had to change. Each one had its own opinion: some used `getAddresses().get(0)`, some `getDefaultAddress()`, some asserted the list was non-empty, some didn't.

**Violation.** Every walker had committed to the old model's shape. The shape changed; every walker broke.

**Fix.** Push the intent. `order.shippingCity()` is a single method on `Order` that handles the multi-address world centrally. After the refactor, *one* method changes, not twenty.

```java
public class Order {
    public String shippingCity() {
        return customer.defaultAddress().city();    // one place to update on model change
    }
}
```

---

## Bug 4 — Stale data through a chain

```java
public class DashboardService {
    public List<TopCustomerRow> topCustomers(Region region) {
        return repository.allCustomers().stream()
            .filter(c -> c.address().region().equals(region))
            .sorted(comparing(c -> c.orderHistory().totalSpent()))
            .limit(10)
            .map(c -> new TopCustomerRow(c.id(), c.name(), c.orderHistory().totalSpent()))
            .toList();
    }
}
```

**Symptom.** The dashboard intermittently shows old `totalSpent` values for some customers. New orders aren't reflected for ~5 minutes.

**Violation.** `c.orderHistory().totalSpent()` walks into the customer's order history — which is a *lazy* collection backed by a cache. The cache TTL is 5 minutes. The chain hides this from `DashboardService`, which then can't reason about cache invalidation.

**Fix.** Move the computation to a query that the persistence layer can satisfy freshly:

```java
public class DashboardService {
    public List<TopCustomerRow> topCustomers(Region region) {
        return repository.topCustomersBySpend(region, limit: 10);   // server-side, fresh
    }
}
```

The repository becomes responsible for freshness; the service doesn't navigate object graphs to compute aggregates. LoD removed the chain *and* removed the staleness window.

---

## Bug 5 — Aggregate boundary leakage

```java
public class DiscountService {
    public void applyHolidayDiscount(Order order) {
        for (LineItem item : order.getLineItems()) {
            item.setPrice(item.getPrice().multiply(new BigDecimal("0.85")));
        }
    }
}
```

**Symptom.** The discount applies. So does the *next* discount applied by another team. And the next. Discounts stack uncontrollably. A customer who triggers two promotions sees 27.7% off (1 − 0.85²); a customer with three sees 38.6%.

**Violation.** `DiscountService` reaches past `Order` (the aggregate root) into `LineItem` (an internal entity) and mutates its price directly. No invariant — "no more than one discount per item" — can be enforced because mutations bypass the root.

**Fix.** Let the root own its invariants.

```java
public class Order {
    public void applyDiscount(Discount d) {
        if (this.activeDiscount != null) throw new DiscountAlreadyApplied();
        this.activeDiscount = d;
        lineItems.forEach(li -> li.applyDiscount(d));
    }
}

public class DiscountService {
    public void applyHolidayDiscount(Order order) {
        order.applyDiscount(Discounts.HOLIDAY_2025);
    }
}
```

The invariant lives on `Order`. The service talks to one collaborator. The double-discount bug becomes a thrown exception.

---

## Bug 6 — Returning a mutable list

```java
public class TaskBoard {
    private final List<Task> tasks = new ArrayList<>();
    public List<Task> getTasks() { return tasks; }
}
```

```java
// Random caller:
board.getTasks().clear();                    // wipes the board
board.getTasks().add(new Task("rogue"));     // bypasses any validation
```

**Symptom.** The board occasionally loses tasks. Logs show no `delete` operation, no audit entry. The state diverges from what anyone intended.

**Violation.** The getter returns the *backing* list — a live collaborator the caller can drive. Every caller has reach into `TaskBoard`'s internals.

**Fix.** Return an unmodifiable view, or — better — expose intent-named methods.

```java
public class TaskBoard {
    private final List<Task> tasks = new ArrayList<>();

    public List<Task> tasks() { return Collections.unmodifiableList(tasks); }
    public void add(Task t)   { /* validates, then adds */ tasks.add(t); }
    public void remove(TaskId id) { tasks.removeIf(t -> t.id().equals(id)); }
}
```

The list is read-only from outside; modifications go through `add`/`remove`. The board enforces its own invariants.

---

## Bug 7 — LoD-laundering through a static helper

```java
public class CheckoutService {
    public Money totalDue(Order order) {
        Country country = OrderHelpers.countryOf(order);
        return country.taxFor(order);
    }
}

public final class OrderHelpers {
    public static Country countryOf(Order order) {
        return order.getCustomer().getAddress().getCountry();
    }
}
```

**Symptom.** The chain hasn't gone away; it has moved to `OrderHelpers`. When `Address` changes its shape, the helper breaks. Every method that called `OrderHelpers.countryOf(...)` is now broken — and `OrderHelpers` itself has accumulated 30 similar methods, each violating LoD.

**Violation.** The smell relocated. `OrderHelpers` is the new offender.

**Fix.** Eliminate the chain by giving `Order` the answer.

```java
public class Order {
    public Money taxAmount() { return customer.address().country().taxFor(this); }
}

public class CheckoutService {
    public Money totalDue(Order order) {
        return order.taxAmount();
    }
}
```

`OrderHelpers` disappears. The chain still exists physically, but inside `Order` — where it belongs because `Order` owns the path through its own data. Callers don't see it.

---

## Bug 8 — Driving a returned record's collaborator

```java
public record Cart(Customer customer, List<LineItem> items) { }

public class CartUpdater {
    public void markItemsBackorderedFor(Cart cart) {
        cart.customer().notifyAccount("backorder");      // driving a returned entity
        cart.items().forEach(li -> li.markBackordered());// driving returned entities
    }
}
```

**Symptom.** `Cart` looks like a record, suggesting value semantics. But `Customer` is a live entity with side-effecting methods (`notifyAccount`), and `LineItem`s are mutable. The `record` accidentally publishes two live collaborators.

The bug: a refactor adds a customer-state invariant (`notifyAccount` requires the customer to be in `ACTIVE` state), but `CartUpdater` doesn't know about state; it bulldozes through and triggers a `IllegalStateException` for inactive customers.

**Violation.** `Cart` exposes entity collaborators as record components. Callers drive them past whatever invariants the cart wanted to enforce.

**Fix.** A cart shouldn't be a record holding live entities; it should be an entity itself with explicit operations.

```java
public final class Cart {
    private final Customer customer;
    private final List<LineItem> items;
    public Cart(Customer customer, List<LineItem> items) { /* ... */ }

    public void markBackordered() {
        customer.handleBackorderNotice();
        items.forEach(LineItem::markBackordered);
    }
}

public class CartUpdater {
    public void markItemsBackorderedFor(Cart cart) {
        cart.markBackordered();
    }
}
```

`Cart` owns the operation; invariants are checked on the way in.

---

## Bug 9 — A `getInstance().getRegistry().get(key)` chain

```java
public class TaxCalculator {
    public BigDecimal taxFor(Region region, BigDecimal subtotal) {
        BigDecimal rate = ServiceLocator.getInstance().getTaxRegistry().get(region);
        return subtotal.multiply(BigDecimal.ONE.add(rate));
    }
}
```

**Symptom.** Tests fail because `ServiceLocator.getInstance()` lazily loads `/etc/tax.yml` on first access. The path doesn't exist on the developer's machine. Mocking the chain requires four `when()` calls. After a teammate ships `ServiceLocator2` (a refactored locator), `getInstance()` returns the wrong type and the chain produces a `ClassCastException`.

**Violation.** Triple chain through a singleton: locator → registry → map. The class knows about all three and depends on each of their lifecycles. It's also a covert DIP violation — the *high-level* policy (compute tax) reaches into a *low-level* implementation (a yml-loaded map).

**Fix.** Constructor injection of the abstraction.

```java
public class TaxCalculator {
    private final TaxRegistry registry;
    public TaxCalculator(TaxRegistry registry) { this.registry = registry; }

    public BigDecimal taxFor(Region region, BigDecimal subtotal) {
        return subtotal.multiply(BigDecimal.ONE.add(registry.rateFor(region)));
    }
}
```

`TaxCalculator` now talks to *one* collaborator. Tests pass an in-memory `TaxRegistry`. The yml-load lifecycle stays in the registry's adapter.

---

## Bug 10 — Walking JPA lazy associations

```java
public class OrderReportService {
    @Transactional(readOnly = true)
    public List<ReportRow> report() {
        return orderRepo.findAll().stream()
            .map(o -> new ReportRow(
                o.getCustomer().getName(),
                o.getCustomer().getAddress().getCity(),
                o.getLineItems().size(),
                o.getTotal()))
            .toList();
    }
}
```

**Symptom.** The report runs slowly. With 10,000 orders, the request takes 90 seconds. The DB logs show N×3 SELECT statements: one for orders, one for each customer, one for each address, one for each line-item collection. Classic N+1.

**Violation.** Each chain step (`getCustomer()`, `getAddress()`, `getLineItems()`) triggers a *lazy load* — a new SQL query per call. The chain looks innocent; the runtime issues 30,001 queries.

**Fix.** Push the projection to the persistence layer. Either:

(a) A JPQL/SQL query that JOINs the needed tables and returns a `ReportRow` directly:

```java
public interface OrderReportRepository {
    @Query("""
           select new com.acme.ReportRow(c.name, a.city, size(o.lineItems), o.total)
           from Order o join o.customer c join c.address a
           """)
    List<ReportRow> report();
}
```

(b) An entity-graph hint that tells JPA to fetch everything in one query.

Either way, the service stops walking the structure and asks the repository for the *answer*. LoD eliminated the chain and eliminated the N+1.

---

## Pattern summary

| Bug | LoD smell                                          | Fix                                                  |
|-----|----------------------------------------------------|------------------------------------------------------|
| 1   | NPE deep in a getter chain                          | Push intent to root; use `Optional` pipeline         |
| 2   | Test mocks four objects to assert one fact          | Same fix; mock surface shrinks with production       |
| 3   | Model reshape breaks twenty walkers                 | Method on root encapsulates the path                 |
| 4   | Stale data through a cached chain                   | Move computation to the query layer                  |
| 5   | Service mutates internal entity past root          | Root owns invariants; service talks to root          |
| 6   | Getter returns mutable backing collection           | Unmodifiable view + intent methods                   |
| 7   | Helper hides the chain                              | Eliminate the chain on the root                      |
| 8   | Record exposes live entity collaborators            | Promote to a class with explicit operations          |
| 9   | Singleton → registry → map chain                    | Inject the abstraction                               |
| 10  | JPA lazy chain produces N+1                         | Push projection to the persistence layer             |

LoD violations rarely produce a clean compile error. They show up as NPEs that lie about which class is wrong, tests that mock five objects, refactors that break twenty call sites, slow queries hidden in lazy chains, and discounts that stack uncontrollably. Train your eye for chains that touch more than two types — that's the signature.
