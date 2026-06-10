# Cohesion and Coupling — Find the Bug

> 10 buggy snippets where weak cohesion or excessive coupling causes silent failures. For each: read the code, decide which kind of cohesion failure (coincidental, logical, temporal, …) or coupling type (content, common, control, stamp, …) is showing up, identify the *runtime symptom* (untestable code, cascading recompilation, ripple bug, hidden global), and write the fix.

---

## Bug 1 — Shared singleton, common coupling

```java
public final class Settings {
    private static final Settings INSTANCE = new Settings();
    public static Settings get() { return INSTANCE; }
    private int batchSize = 100;
    public int batchSize() { return batchSize; }
    public void setBatchSize(int n) { this.batchSize = n; }
}

public class OrderImporter {
    public void run() {
        for (int i = 0; i < Settings.get().batchSize(); i++) { /* ... */ }
    }
}
public class CustomerImporter {
    public void run() {
        int n = Settings.get().batchSize();
        for (int i = 0; i < n; i++) { /* ... */ }
    }
}
```

**Symptom.** A test for `OrderImporter` sets `Settings.get().setBatchSize(5)`. A later test for `CustomerImporter` reads the same global and expects 100. Test order matters; CI flakes randomly.

**Violation.** *Common coupling* — two unrelated classes coupled through a shared global. The coupling is invisible: nothing in the code says `OrderImporter` and `CustomerImporter` are related.

**Fix.** Inject the abstraction. Each importer gets its own value:

```java
public interface Settings { int batchSize(); }

public final class OrderImporter {
    private final Settings settings;
    public OrderImporter(Settings s) { this.settings = s; }
    public void run() { for (int i = 0; i < settings.batchSize(); i++) /* ... */; }
}
```

Tests construct each importer with a stub `Settings`. No global; no cross-test contamination.

---

## Bug 2 — `Utils` graveyard, coincidental cohesion

```java
public final class Utils {
    public static String formatDate(LocalDate d)  { /* ... */ }
    public static String slugify(String s)        { /* ... */ }
    public static byte[] hashPwd(String pwd)      { /* ... */ }
    public static int gcd(int a, int b)           { /* ... */ }
    public static String escapeHtml(String s)     { /* ... */ }
    public static UUID uuid()                     { /* ... */ }
}
```

**Symptom.** Six months later, the security team upgrades password hashing from BCrypt to Argon2. Their PR touches one method in `Utils.java` — and triggers a recompile of every class that imports `Utils` for any reason (date formatting, slugifying, html escaping). CI rebuilds 200 classes for a localised change.

**Violation.** *Coincidental cohesion*. The methods share a class for no reason; consumers of `formatDate` are also consumers of `Utils`, and so are coupled to `hashPwd` even though they never call it.

**Fix.** Split by purpose-bearing name:

```java
public final class DateFormatter { public static String format(LocalDate d) { /* ... */ } }
public final class Slugifier     { public static String slugify(String s)   { /* ... */ } }
public final class PasswordHasher{ public static byte[] hash(String pwd)    { /* ... */ } }
public final class GcdComputer   { public static int gcd(int a, int b)      { /* ... */ } }
public final class HtmlEscaper   { public static String escape(String s)    { /* ... */ } }
public final class IdGenerator   { public static UUID newId()               { /* ... */ } }
```

Each class has one purpose. Security can change `PasswordHasher` without recompiling 200 unrelated callers.

---

## Bug 3 — Control coupling via boolean flags

```java
public class OrderProcessor {
    public void process(Order o, boolean async, boolean retry, boolean audit) {
        if (async) executor.submit(() -> doProcess(o, retry, audit));
        else       doProcess(o, retry, audit);
    }
    private void doProcess(Order o, boolean retry, boolean audit) {
        if (retry) /* ... */ ; else /* ... */ ;
        if (audit) /* ... */ ;
    }
}
```

**Symptom.** Callers write `process(o, false, true, false)`, `process(o, true, false, true)`, etc. Reviews can't tell at a glance what each call does. A test that exercises the "sync, no retry, audit" path accidentally exercises a different combination because the third boolean flipped without anyone noticing.

**Violation.** *Control coupling*. The caller's flags control the callee's branching. The callee's logic is shaped by the caller, but neither owns the whole.

**Fix.** Replace flags with explicit methods or with a single options object:

```java
public class OrderProcessor {
    public void processSync(Order o)          { doProcess(o, false, true); }
    public void processAsyncWithRetry(Order o) { executor.submit(() -> doProcess(o, true, false)); }
}

// Or, if there are many options:
public record ProcessOptions(boolean async, boolean retry, boolean audit) {
    public static final ProcessOptions DEFAULT = new ProcessOptions(false, false, true);
}
public void process(Order o, ProcessOptions opts) { /* ... */ }
```

Callers write `processSync(o)` or `process(o, new ProcessOptions(true, true, true))`. Intent is visible at the call site.

---

## Bug 4 — Stamp coupling — fat argument hides intent

```java
public class TaxCalculator {
    public BigDecimal taxFor(Order order) {
        return order.getCustomer().getAddress().getCountry().rate()
            .multiply(order.subtotal().value());
    }
}
```

**Symptom.** Every test for `taxFor` builds a full `Order` with customer, address, country, subtotal. Fixtures balloon. When `Order` gains a new required field, every existing test breaks.

**Violation.** *Stamp coupling*. `taxFor` declares it needs `Order`, but really needs `Country` and `Money`. The full `Order` is too much information.

**Fix.** Pass only what the method actually consumes:

```java
public class TaxCalculator {
    public BigDecimal taxFor(Money subtotal, Country country) {
        return country.rate().multiply(subtotal.value());
    }
}
```

Tests now build a `Money` and a `Country` — two objects, no `Order` graph. Adding a field to `Order` doesn't touch `TaxCalculator`.

---

## Bug 5 — Cyclic dependency between two services

```java
// com.acme.billing.BillingService
public class BillingService {
    private final OrderService orders;
    public void chargeAfterShip(OrderId id) {
        Order o = orders.find(id);                  // dep: billing → order
        charge(o);
    }
}

// com.acme.orders.OrderService
public class OrderService {
    private final BillingService billing;
    public Receipt placeAndCharge(Order o) {
        save(o);
        return billing.charge(o);                   // dep: order → billing
    }
}
```

**Symptom.** Compile order is fragile (only works because Java tolerates cycles unlike C). A change to `OrderService` cascades into `BillingService` recompilation, and vice versa. Test isolation is impossible — mocking one requires creating the other. ArchUnit reports a cycle.

**Violation.** *Cyclic dependency*. Two modules that depend on each other. Always a smell.

**Fix.** Invert one edge through an interface or event.

```java
// Option A — Domain event breaks the cycle
public final class OrderService {
    private final OrderRepository repo;
    private final DomainEvents events;
    public Receipt place(Order o) {
        repo.save(o);
        events.publish(new OrderPlaced(o.id()));    // no direct billing dep
        return Receipt.pending(o.id());
    }
}

// BillingService subscribes to OrderPlaced events
public final class BillingService {
    @EventListener
    public void onOrderPlaced(OrderPlaced event) { charge(event.orderId()); }
}
```

Now `OrderService` depends on the event abstraction, not on `BillingService`. The cycle is broken; both services can be tested independently.

---

## Bug 6 — God class growing through `git log`

```java
public class OrderService {
    // 800 lines, edited by 12 contributors in the last quarter
    public void placeOrder(...)       { /* payments team */ }
    public void cancelOrder(...)      { /* support team */ }
    public Receipt computeReceipt(...){ /* finance team */ }
    public void generateInvoice(...)  { /* finance team */ }
    public void sendTrackingEmail(...){ /* comms team */ }
    public void rebalanceInventory(...) { /* warehouse team */ }
    // ...
}
```

**Symptom.** Every sprint, multiple teams modify the same file. Merge conflicts are routine. Bugs introduced by one team affect features owned by another. The class is "everything orders". `git log --author` shows 12 distinct authors.

**Violation.** *Coincidental/logical cohesion* at scale. The class has one *name* (orders) but six change axes (payments, support, finance, comms, warehouse).

**Fix.** Split by change axis. Each new class is owned by one team:

```java
package com.acme.order.placement;    public final class OrderPlacer { ... }
package com.acme.order.cancellation; public final class OrderCanceller { ... }
package com.acme.order.invoicing;    public final class OrderInvoicer { ... }
package com.acme.order.tracking;     public final class TrackingNotifier { ... }
package com.acme.order.fulfillment;  public final class InventoryRebalancer { ... }
```

Each team owns one package. Merge conflicts disappear. Bugs stay scoped.

---

## Bug 7 — Test cascade reveals stamp coupling

```java
@Test void totalIncludesShipping() {
    Order order = new Order();
    order.setCustomer(new Customer("a", new Address("...")));
    order.setShippingAddress(new Address("..."));
    order.setLineItems(List.of(new LineItem("...")));
    order.setPaymentMethod(new PaymentMethod("..."));
    order.setShippingMethod(new ShippingMethod("..."));
    order.setCurrency(Currency.USD);
    order.setPromoCode("...");
    // ...12 more required fields...

    Money total = totalCalculator.total(order);

    assertEquals(...);
}
```

**Symptom.** Every test for `total()` builds a 50-line `Order` fixture. The fixtures duplicate across tests. Adding a field to `Order` breaks 30 tests.

**Violation.** *Stamp coupling* across the boundary between the test and the SUT. The SUT requires a full `Order` to compute a total.

**Fix.** `total()` should declare what it needs.

```java
public Money total(LineItems items, ShippingCost shipping, Optional<Discount> discount) {
    Money sub = items.subtotal();
    Money disc = discount.map(d -> d.apply(sub)).orElse(Money.ZERO);
    return sub.minus(disc).plus(shipping.amount());
}
```

The test builds three small values instead of a full `Order`. Adding a `promoCode` field to `Order` doesn't touch `total()` or its tests.

---

## Bug 8 — Cohesion fail: helper holds three unrelated concerns

```java
public final class CheckoutHelper {
    public static boolean isValidEmail(String e)               { /* ... */ }
    public static BigDecimal calculateTax(Order o)             { /* ... */ }
    public static String renderInvoicePdf(Order o)             { /* ... */ }
}
```

**Symptom.** A tax-rate change triggers a PDF rendering regression. Reason: the helper's tests didn't isolate the concerns; a tax test exercised the email validator (no-op assertion) and PDF rendering (no-op assertion). When tax changed, the test still passed because the PDF assertion was hollow.

**Violation.** *Logical cohesion* at best. The methods share the "checkout" theme but nothing else. Tests can't isolate failures.

**Fix.** Split into three classes, each with focused tests:

```java
public final class EmailValidator   { public boolean isValid(String e) { ... } }
public final class TaxCalculator    { public BigDecimal compute(Order o) { ... } }
public final class InvoiceRenderer  { public String renderPdf(Order o) { ... } }
```

Each test exercises one purpose. Regressions surface immediately.

---

## Bug 9 — Hidden infrastructure coupling through `static`

```java
public class OrderService {
    public void place(Order o) {
        repo.save(o);
        Logger log = LoggerFactory.getLogger(OrderService.class);      // hidden lookup
        log.info("placed: {}", o.id());

        MetricsRegistry.INSTANCE.increment("orders.placed");           // hidden global
        TracingContext.current().addEvent("placed");                   // ThreadLocal
    }
}
```

**Symptom.** Three hidden couplings to infrastructure: SLF4J's static lookup, a metrics singleton, and a tracing `ThreadLocal`. Tests run fine in isolation, but the tracing assertion fails sometimes when the thread changes (test runner reuses threads with leftover state).

**Violation.** *Common coupling* through statics. The "dependency direction" appears clean (one repo injected), but the static collaborators are invisible in the constructor signature.

**Fix.** Inject every collaborator. Statics belong only at the application's outermost boundary.

```java
public final class OrderService {
    private final OrderRepository repo;
    private final Logger logger;
    private final Metrics metrics;
    private final Tracer tracer;
    public OrderService(OrderRepository r, Logger l, Metrics m, Tracer t) {
        this.repo = r; this.logger = l; this.metrics = m; this.tracer = t;
    }
    public void place(Order o) {
        repo.save(o);
        logger.info("placed: {}", o.id());
        metrics.increment("orders.placed");
        tracer.addEvent("placed");
    }
}
```

Now the constructor surface declares every dependency. Tests inject fakes. No surprises from `ThreadLocal`.

---

## Bug 10 — Logical-cohesion test class with deep mocks

```java
public class OrderServiceTest {
    @Test void placeAndChargeAndShipAndAuditAndNotify() {
        OrderRepository repo = mock(...);
        PaymentGateway gw = mock(...);
        ShippingClient ship = mock(...);
        AuditLog audit = mock(...);
        Notifier notify = mock(...);

        when(repo.save(any())).thenReturn(SAMPLE_ORDER);
        when(gw.charge(any(), any())).thenReturn(Receipt.ok());
        when(ship.book(any())).thenReturn(WAYBILL);

        // 80 lines of setup
        // 5 different verify() calls
    }
}
```

**Symptom.** One test asserts five different behaviours: persist, charge, ship, audit, notify. The mock setup is 80 lines. A change to `OrderService.place()` that breaks any one of the five fails the test with one giant message; figuring out which behaviour broke takes 20 minutes.

**Violation.** The test mirrors the production code's *low cohesion*. Both have too much going on.

**Fix.** Split the production class first; tests follow.

```java
@Test void placeOrderPersists()  { /* repo only, 1 mock */ }
@Test void placeOrderCharges()   { /* gateway only, 1 mock */ }
@Test void placeOrderShips()     { /* shipping only, 1 mock */ }
```

If you can't split the test, the SUT isn't cohesive. The test is the symptom; the SUT is the cause.

---

## Pattern summary

| Bug | Smell                                                    | Fix                                                  |
|-----|----------------------------------------------------------|------------------------------------------------------|
| 1   | Common coupling through `Settings.get()` singleton       | Inject the abstraction                                |
| 2   | Coincidental cohesion in `Utils`                         | Split by purpose-bearing name                         |
| 3   | Control coupling via boolean flags                       | Replace with explicit methods or options record       |
| 4   | Stamp coupling — fat `Order` argument                    | Declare only what the method consumes                 |
| 5   | Cyclic dependency between two services                   | Invert one edge through event/interface               |
| 6   | God class edited by 12 teams                             | Split by change axis, one package per team            |
| 7   | Test fixtures balloon because the SUT needs everything   | Slim the method's argument list                       |
| 8   | Logical-cohesion helper allows hollow tests              | Split into three focused classes                      |
| 9   | Hidden coupling through statics, ThreadLocal             | Inject every collaborator                             |
| 10  | One test asserts five behaviours                          | Split SUT first; tests follow                         |

Cohesion and coupling violations rarely produce clean compile errors. They show up as flaky tests, merge conflicts, recompile cascades, regression bugs that escape because tests were hollow, and god classes that nobody understands. Train your eye to spot them in review: the compiler will not.
