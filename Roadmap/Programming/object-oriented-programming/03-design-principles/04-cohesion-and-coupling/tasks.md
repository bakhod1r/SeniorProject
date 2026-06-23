# Cohesion and Coupling — Practice Tasks

Eight exercises that force "high cohesion, low coupling" into Java code. Each is a refactor that compiles under the existing shape but breaks the moment the model evolves, the team grows, or tests need to run without infrastructure. Work each in three passes: (1) name the cohesion type (Constantine) and coupling type (Page-Jones), (2) sketch the new class boundaries on paper, (3) write code and a test that catches the original failure mode.

---

## Task 1 — Split the `Utils` graveyard

```java
public final class Utils {
    public static String formatDate(LocalDate d)              { /* ... */ }
    public static String slugify(String s)                    { /* ... */ }
    public static byte[] hashPwd(String pwd)                  { /* ... */ }
    public static int gcd(int a, int b)                       { /* ... */ }
    public static String escapeHtml(String s)                 { /* ... */ }
    public static UUID newId()                                { /* ... */ }
    public static BigDecimal moneyFromMinor(long minor)       { /* ... */ }
    public static boolean isValidEmail(String e)              { /* ... */ }
}
```

**Objective.** Eliminate coincidental cohesion by splitting into purpose-bearing classes.

**Constraints.**
- Each new class has one purpose, namable in one sentence.
- Callers of `Utils.formatDate(...)` change to `DateFormatter.format(...)`.
- A change to one purpose (e.g., upgrading password hashing) recompiles only its callers, not the whole codebase.

**Acceptance criteria.**
- `Utils.java` no longer exists (or is left only as a deprecated forwarder during migration).
- 8 new classes, each with one purpose; classnames carry the purpose.
- A `git log -- DateFormatter.java` shows zero edits from the security team.
- A grep for `import.*Utils;` returns zero hits in production code.

---

## Task 2 — Slim a fat-argument calculator

```java
public class TaxCalculator {
    public BigDecimal taxFor(Order order) {
        return order.getCustomer().getAddress().getCountry().rate()
            .multiply(order.subtotal().value());
    }
}
```

A test fixture builds a 50-line `Order`. Adding `Order.promoCode` breaks 30 tests.

**Objective.** Reduce stamp coupling: `taxFor` should declare what it actually needs.

**Constraints.**
- `taxFor(Money subtotal, Country country)` — only what's used.
- A test builds two values, not a full `Order`.
- The caller (controller / service) extracts the two values from `Order`.

**Acceptance criteria.**
- `TaxCalculator.java` does not import `Order` or any of its subtypes.
- Test fixtures for `TaxCalculator` are 2–3 lines.
- Adding a new field to `Order` does not break any `TaxCalculator` test.

---

## Task 3 — Break a cyclic dependency

```java
// com.acme.billing
public class BillingService {
    private final OrderService orders;
    public void chargeAfterShip(OrderId id) { Order o = orders.find(id); charge(o); }
}

// com.acme.orders
public class OrderService {
    private final BillingService billing;
    public Receipt placeAndCharge(Order o) { save(o); return billing.charge(o); }
}
```

ArchUnit's cycle test fails.

**Objective.** Break the cycle without merging the two services.

**Constraints.**
- Introduce a domain event (`OrderPlaced`) or an interface-shaped seam in the *domain* module.
- One of the two services no longer imports the other directly.
- Both services remain testable without the other.

**Acceptance criteria.**
- `ArchUnit`'s `slices().beFreeOfCycles()` test passes.
- A unit test for `OrderService` mocks one collaborator; the test for `BillingService` does the same.
- The event bus / interface lives in the domain module, depended on by both services but depending on neither.

---

## Task 4 — Replace boolean flags with explicit operations

```java
public class OrderProcessor {
    public void process(Order o, boolean async, boolean retry, boolean audit) {
        // 60 lines of if/else over the three flags
    }
}
```

Callers write `processor.process(order, true, false, true)`. Reviews can't read intent.

**Objective.** Remove control coupling.

**Constraints.**
- Either expose four explicit methods (`processSync`, `processAsync`, `processWithRetry`, …), or introduce a `ProcessOptions` value record.
- Each call site reads as the verb it actually performs.
- The body of `process` is split into smaller methods, each focused.

**Acceptance criteria.**
- Greppin for `process(.*, *true|false.*,)` returns zero hits.
- Reviewers can tell what the call does without reading the method signature.
- A misuse (e.g., `processSync` called from a context expecting async) is a *compile error*, not a runtime bug.

---

## Task 5 — Split the god service by change axis

```java
public class OrderService {
    // 800 lines, 12 contributors in the last 6 months
    public void placeOrder(...)         { /* payments team */ }
    public void cancelOrder(...)        { /* support team */ }
    public Receipt computeReceipt(...)  { /* finance team */ }
    public void generateInvoice(...)    { /* finance team */ }
    public void sendTrackingEmail(...)  { /* comms team */ }
    public void rebalanceInventory(...) { /* warehouse team */ }
}
```

**Objective.** Split by *change axis* (= team owning the methods).

**Constraints.**
- One new class per team: `OrderPlacer`, `OrderCanceller`, `OrderInvoicer`, `TrackingNotifier`, `InventoryRebalancer`.
- Each class lives in its own package (`com.acme.order.placement`, etc.).
- Each class has 3–5 collaborators, not 12.
- Existing public APIs are preserved as thin forwarders during migration, then deleted.

**Acceptance criteria.**
- `git log --author com.acme.order.placement` shows only the payments team.
- A change to invoicing recompiles only `OrderInvoicer` and its callers, not the entire order package.
- Merge conflicts between teams in `order.*` drop to near zero.

---

## Task 6 — Replace singleton coupling with constructor injection

```java
public class PaymentService {
    public Receipt charge(Money amount) {
        int timeoutMs = Settings.get().paymentTimeoutMs();
        String url = ConfigRegistry.getInstance().paymentGatewayUrl();
        Logger log = LoggerFactory.getLogger(PaymentService.class);
        // ...
    }
}
```

**Objective.** Eliminate common coupling through singletons.

**Constraints.**
- `PaymentService` accepts a `PaymentSettings`, a `PaymentGatewayConfig`, and a `Logger` via constructor.
- All three are interfaces (or domain records).
- Production wiring happens at a single composition root, not scattered.
- Tests construct `PaymentService` with stub values, no `System.setProperty` or `Settings.get().setX(...)`.

**Acceptance criteria.**
- Searching `PaymentService.java` for `getInstance`, `LoggerFactory`, or `static .* INSTANCE` returns zero hits.
- A unit test runs in <10 ms and depends on no global state.
- Test parallelism works — two tests running in different threads don't contaminate each other.

---

## Task 7 — Module-level decoupling with `module-info.java`

You have a multi-package codebase under `com.acme.shop`:

```
com.acme.shop.domain        (Order, Customer, Money)
com.acme.shop.persistence   (JpaOrderRepository)
com.acme.shop.web           (OrderController)
com.acme.shop.email         (WelcomeMailer)
```

Today every package can `import` everything. Domain accidentally imports persistence; web imports email's internals.

**Objective.** Use JPMS to enforce hexagonal-architecture-style dependency directions.

**Constraints.**
- Four modules: `shop.domain`, `shop.persistence`, `shop.web`, `shop.email`.
- `shop.domain` does not `requires` any other shop module.
- `shop.persistence` `requires shop.domain`.
- `shop.web` and `shop.email` `requires shop.domain` and (if needed) `shop.persistence` via an interface only.
- Each module exports its public API and hides everything else.

**Acceptance criteria.**
- `jdeps` reports zero forbidden dependencies.
- An attempt to `import com.acme.shop.persistence.internal.X` from `shop.domain` fails compilation.
- ArchUnit's `slices().beFreeOfCycles()` passes at the module level.
- Adding a Postgres-specific adapter is an edit in `shop.persistence` only.

---

## Task 8 — Promote a fixed group of values to a record

A method's signature has grown organically:

```java
public Receipt placeOrder(String customerId, String paymentToken, BigDecimal amount,
                          String currency, String shippingMethod, String promoCode,
                          String idempotencyKey, Locale locale) { ... }
```

Callers must remember positional order; the next addition breaks every call site.

**Objective.** Replace position-connascent argument lists with a cohesive record.

**Constraints.**
- A new `PlaceOrderCommand` record captures the eight fields.
- The method becomes `placeOrder(PlaceOrderCommand cmd)`.
- The record has a static factory or builder if construction is non-trivial.
- A new field added to `PlaceOrderCommand` doesn't break existing call sites (callers use the builder or named constructor).

**Acceptance criteria.**
- Method signature has one parameter.
- A test for the happy path builds `PlaceOrderCommand` with named-component initialization.
- Adding `boolean isPriority` to the command doesn't break existing tests (default `false` via builder).
- Searching the codebase for `placeOrder(.*,.*,.*,.*)` returns zero hits.

---

## Validation

| Task | How to verify the fix                                                              |
|------|------------------------------------------------------------------------------------|
| 1    | `git log` on each new class shows one team / one purpose.                          |
| 2    | `TaxCalculator.java` has no `Order` import; tests build two values only.           |
| 3    | ArchUnit `beFreeOfCycles()` test passes.                                           |
| 4    | No call site passes positional booleans; reviewers read intent.                    |
| 5    | Merge conflicts drop; one team owns each new class.                                |
| 6    | `PaymentService` test runs without globals; parallel tests don't contaminate.      |
| 7    | `jdeps` is clean; cross-module forbidden imports don't compile.                    |
| 8    | New field on `PlaceOrderCommand` doesn't break any caller.                         |

---

## Worked solution sketch — Task 3 (break the cycle)

```java
// In shop.domain — the event abstraction
public record OrderPlaced(OrderId id, Money total, Instant placedAt) { }

public interface DomainEvents {
    void publish(Object event);
    <T> void subscribe(Class<T> type, Consumer<T> handler);
}

// In shop.orders — depends only on domain
public final class OrderService {
    private final OrderRepository repo;
    private final DomainEvents events;
    public OrderService(OrderRepository r, DomainEvents e) { repo = r; events = e; }

    public Receipt place(Order o) {
        repo.save(o);
        events.publish(new OrderPlaced(o.id(), o.total(), Instant.now()));
        return Receipt.pending(o.id());           // no direct billing call
    }
}

// In shop.billing — depends on domain, subscribes via the event abstraction
public final class BillingService {
    private final PaymentGateway gateway;
    public BillingService(PaymentGateway g, DomainEvents events) {
        this.gateway = g;
        events.subscribe(OrderPlaced.class, this::onOrderPlaced);
    }
    private void onOrderPlaced(OrderPlaced event) {
        gateway.charge(event.id(), event.total());
    }
}
```

Notice three things in the sketch:

1. The cycle is broken because `OrderService` no longer imports `BillingService`. They communicate through the event bus, defined in the shared `domain` module.
2. Both services are unit-testable in isolation. A test for `OrderService` injects a fake `DomainEvents`; a test for `BillingService` verifies `onOrderPlaced` calls `gateway.charge`.
3. Adding a third subscriber (e.g., `AnalyticsService` recording the order) is one new class, zero edits to `OrderService` or `BillingService`. Cohesion intact; coupling reduced.

---

**Memorize this:** cohesion and coupling problems don't show up as compile errors — they show up as merge conflicts, flaky tests, recompile cascades, and god classes everyone fears. Each task above gives you that pain up front. If, after the refactor, the next plausible change touches *one* class in *one* team's package, you have applied the heuristics correctly.
