# Law of Demeter — Senior

> **What?** The edge cases of the Law of Demeter: where strict adherence pushes responsibility into the wrong object, what "object" actually means for the dot count (instance vs class vs package vs module), how LoD interacts with DDD aggregates and CQRS, the role of static factories and helpers, where streams/builders/fluent APIs legitimately chain, and the codebases that *look* LoD-compliant but smuggle coupling through facades.
> **How?** By treating LoD as a *coupling minimizer*, not a literal grammar rule. Apply it where structural coupling is the real cost; bend it where the alternative is responsibility creep, anaemic models, or pointless ceremony.

---

## 1. LoD is about coupling, not dot count

The "one dot per line" heuristic is a teaching shortcut. The actual principle (Lieberherr & Holland, 1989) is: *a method `m` of object `O` should only invoke methods of `O`, its parameters, its fields, objects created in `m`, and global utility objects.* Note the qualifier "global utility" — even the original formulation gave an exemption to ubiquitously shared helpers.

The real cost LoD targets is *structural coupling*: a method that knows the shape of three classes' fields will break when any of those shapes change. Counting dots is a proxy; counting *distinct types whose internal structure your method now depends on* is the truth.

```java
// Three dots, three types — real LoD violation
order.getCustomer().getAddress().getCountry().taxFor(order);

// Three dots, one type — not a violation
order.lineItems().stream().filter(...).map(...).toList();
```

The first method couples `OrderProcessor` to `Order`, `Customer`, `Address`, `Country` *as structures*. The second method couples it to `Order` and `Stream` *as types*. Reshape the type space, not the dot count.

---

## 2. The aggregate boundary — DDD and LoD

In domain-driven design, an *aggregate* is a cluster of objects treated as a unit, with one *aggregate root* as the only entry point. LoD aligns naturally with the aggregate boundary: external code talks to the root; the root talks to its internal entities.

```java
public class Order {                              // aggregate root
    private final List<LineItem> lineItems;
    private final ShippingPolicy shippingPolicy;

    public Money total() {                        // root method, fine
        return lineItems.stream().map(LineItem::price).reduce(Money.ZERO, Money::plus);
    }
    public void applyDiscount(Discount d) { /* root mutates internal items */ }
}

// External — LoD-compliant
order.applyDiscount(discount);
order.total();

// External — LoD violation, and an aggregate-boundary violation
order.lineItems().forEach(li -> li.applyDiscount(discount));
```

The DDD lens makes LoD violations look like *aggregate-boundary leakage*: external code is reaching past the root to mutate an internal entity. The fix isn't "add a forwarder"; it's "respect the aggregate". The root owns its internals; external code asks the root.

This connects LoD to **encapsulation at scale**: instead of "every class hides its fields", "every aggregate hides its internal entities and value objects".

---

## 3. The trade-off — responsibility creep on the aggregate root

Strict LoD compliance can produce a *god aggregate root*: every operation the system needs becomes a method on `Order`, because `Order` is the only entry point. `Order` ends up with 60 methods, knows about pricing, shipping, taxes, fulfilment, refunds, and audit.

The senior balance: when a behaviour is genuinely *about* the aggregate, it lives on the root. When it's a *cross-aggregate operation* (e.g., assigning a courier from a fleet to a shipment), it belongs in a *domain service* that orchestrates between aggregates. Such a service is allowed to know multiple aggregate roots — but not their internals.

```java
public final class ShipmentAssignmentService {
    private final Fleet fleet;
    public void assign(Order order) {
        fleet.assignNearest(order.deliveryAddress())     // talk to fleet root
             .pickUp(order.shipment());                  // talk to driver via truck
    }
}
```

`ShipmentAssignmentService` knows about `Order`, `Fleet`, `Truck`, and `Shipment` as *aggregates*. It doesn't reach into any of their internals. The dot count is high; the coupling is to *intents*, not to *structure*.

The rule of thumb: LoD on internals is strict. LoD on cross-aggregate orchestration is bent — by design.

---

## 4. LoD vs CQRS — read sides get exempted

Command-Query Responsibility Segregation separates the *write model* (commands that mutate state) from the *read model* (queries that produce views). The read model exists *to produce a denormalized view*; walking the domain graph to build it is exactly what it does.

```java
// Command side — strict LoD
public class CheckoutCommandHandler {
    public void handle(Checkout cmd) {
        Order o = orders.byId(cmd.orderId());
        o.checkOut(clock.now());
    }
}

// Query side — LoD intentionally loose
public class OrderSummaryQuery {
    public OrderSummary query(OrderId id) {
        Order o = orders.byId(id);
        return new OrderSummary(
            o.id().toString(),
            o.customer().name(),
            o.customer().address().city(),
            o.lineItems().size(),
            o.total().toString()
        );
    }
}
```

The query side is a *projection*. Forbidding it from walking the domain would force the domain to know every report's shape. CQRS makes the distinction explicit: writes obey LoD; reads are projection code, exempt by design.

The cleaner extreme: have a separate *read database* (denormalized table or document store) that the query reads directly. No domain walk needed because the projection lives in storage.

---

## 5. Static factories, helpers, and global utilities

The original LoD formulation exempted *globally shared helper objects* — `Math`, `Collections`, `Files`, `Strings`. These don't carry hidden coupling because the program-wide consensus says they don't change.

```java
String trimmed = Strings.nullToEmpty(input).strip();   // chain through utility — fine
Math.min(a, Math.abs(b));                              // chain through utility — fine
```

LoD-violation territory:

- A "utility class" that actually owns mutable state (`AppContext.getInstance().getCurrentUser()` — secret coupling through a singleton).
- A "helper" that walks domain structure (`OrderHelper.totalTax(order)` calling `order.getCustomer().getAddress()...`). The helper is now the strangers' friend.

The senior test: does the static helper carry *domain knowledge*, or only *pure-function knowledge*? Pure functions over values (math, string formatting, collection algorithms) are fine. Domain orchestration via static helpers is a LoD violation in disguise.

---

## 6. Module boundaries — package-private and the natural LoD seam

Java's package access provides a clean way to enforce LoD at the structural level: only the *package* may see internal classes; external callers must go through the public root.

```java
package com.acme.order;

public final class Order {
    private final List<LineItem> lineItems;   // LineItem is package-private
    public Money total() { /* uses lineItems internally */ }
}

final class LineItem { /* package-private — not exported */ }
```

External packages cannot import `LineItem`. They cannot write `order.getLineItems().get(0).getPrice()` because they cannot name `LineItem` even if `Order` returned one. The compiler enforces the aggregate boundary.

At module scale (JPMS), `module-info.java` makes this even stricter:

```java
module com.acme.order {
    exports com.acme.order;           // only the public surface
    // com.acme.order.internal is not exported — strongly encapsulated
}
```

Internal entities live in `com.acme.order.internal`; the runtime, not just the compiler, refuses access. LoD becomes a *deployment-level property*.

---

## 7. Streams, optionals, futures — same-type chains

A chain through the *same collaborator type* is not a LoD violation:

```java
order.lineItems()
     .stream()
     .filter(LineItem::isShippable)
     .map(LineItem::weight)
     .reduce(Weight.ZERO, Weight::plus);
```

Each call returns `Stream<X>`. The chain is operating on *the stream*, not navigating an object graph. Same for `Optional`, `CompletableFuture`, `Mono`/`Flux`, `Function<A,B>`.

The senior judgement: when designing your own pipeline type (a builder, a query DSL), make it *recognisably a pipeline type*. Same return type or same role through the chain. Don't mix `builder.tag(...)` (returns builder) with `builder.tag(...).peek().something()` (returns internal state).

The reader's rule of thumb: *if the type after every dot is the same, you're driving a pipeline; if it changes, you're navigating structure*.

---

## 8. Facade pattern — LoD or LoD-laundering?

The Facade pattern provides a unified interface to a subsystem. Done right, it's LoD-compliant: callers talk to the facade, the facade talks to subsystem components.

Done wrong, it's *LoD laundering*: the facade is a god class that has every getter, so callers chain `facade.getOrderService().getCustomerRepository().getCache().getStats()` — and now the facade has leaked the entire subsystem topology.

The senior test: does the facade expose *intents* (verbs — `placeOrder`, `refundOrder`, `cancelOrder`) or *structure* (getters returning collaborators — `getOrderService`, `getRepository`)? Intents are LoD-friendly; structure is not.

```java
// LoD-compliant facade
public final class CheckoutFacade {
    public Receipt place(Order order, PaymentInfo payment)  { /* ... */ }
    public void     cancel(OrderId id, Reason reason)       { /* ... */ }
    public Refund   refund(OrderId id, Money amount)        { /* ... */ }
}

// LoD-laundering facade
public class ShopFacade {
    public OrderService    getOrderService()    { return os; }
    public CartService     getCartService()     { return cs; }
    public PaymentService  getPaymentService()  { return ps; }
    // ...
}
```

The first facade hides the subsystem. The second is a typed registry — and the caller will inevitably chain through it.

---

## 9. The cost of LoD — knowledge migration

LoD says *push the operation to the data*. Done well, that's a good move. Done blindly, it migrates *cross-cutting concerns* into domain types where they don't belong.

```java
// Strict LoD pushes "email the customer" onto Customer
public class Customer {
    public void emailWelcomeMessage() {
        Mailer.smtp().send(email, "Welcome!", greeting());   // Customer now knows SMTP
    }
}
```

`Customer` is a *domain entity*; SMTP is *infrastructure*. The LoD-forced method makes `Customer` depend on the mail subsystem, which is the opposite of what you want.

The senior corrective: LoD is one of several forces. When LoD says "put it on `Customer`" and DIP/cohesion says "infrastructure stays out of domain", the latter wins. Compromise: `Customer.welcomeMessage()` returns the *content* of the email as a value (subject, body) and an external `WelcomeMailer` sends it.

```java
public class Customer {
    public WelcomeMessage welcomeMessage() {
        return new WelcomeMessage(email, "Welcome!", greeting());
    }
}

public final class WelcomeMailer {
    public void send(Customer c) {
        WelcomeMessage msg = c.welcomeMessage();
        smtp.send(msg.to(), msg.subject(), msg.body());
    }
}
```

`Customer` knows what its welcome message *is*; the mailer knows how to send mail. LoD is preserved (no chain through `Customer`'s internals), cohesion is preserved (SMTP stays in the infrastructure class), DIP is preserved (the domain doesn't depend on SMTP).

---

## 10. LoD-aware testing

A method that respects LoD is straightforward to test: it has few collaborators, each is a parameter or field, mocks are small.

```java
// LoD-compliant: two collaborators visible at the surface
public final class CheckoutService {
    private final OrderRepository repo;
    private final PaymentGateway gateway;
    public void place(Order o) {
        repo.save(o);
        gateway.charge(o.totalDue(), o.payment());
    }
}

// Test: two mocks, three lines
@Test void placesOrderAndCharges() {
    CheckoutService svc = new CheckoutService(repo, gateway);
    svc.place(order);
    verify(repo).save(order);
    verify(gateway).charge(order.totalDue(), order.payment());
}
```

A LoD-violating method is the opposite — every chain through structure requires a chain of mocks:

```java
when(order.getCustomer()).thenReturn(customer);
when(customer.getAddress()).thenReturn(address);
when(address.getCountry()).thenReturn(country);
when(country.taxFor(order)).thenReturn(tax);
```

This *deep stubbing* is the test-suite shape of a LoD violation. When you see it, the production code has the same shape.

Mockito's `RETURNS_DEEP_STUBS` makes deep stubbing one annotation away — and many teams use it to make tests pass without fixing the design. That's mock cheating, not test improvement.

---

## 11. Anti-patterns and "fake LoD"

Codebases that *claim* LoD but don't have it:

- **The getter forwarder.** `order.getCountry()` returns `customer.address().country()`. The chain is hidden inside `Order`; LoD is satisfied at the call site, violated at the producer. The smell moves, doesn't go.
- **The data DTO.** A "domain object" that exposes every field. Every caller chains through getters because there are no methods to call. The structure leaks one level wide.
- **The Service god.** All behaviour lives in services that walk every domain class. Each service is one big LoD violation; the entities are anaemic.
- **The deep-stubbed test.** Tests pass with `RETURNS_DEEP_STUBS`; production has the same chain you're stubbing.
- **The mapper-as-domain.** Mappers (allowed to walk structure for projection) gain behaviour and become god classes. The exemption metastasizes.

The honest test: read a method's surface signatures. The set of types it mentions in fields, parameters, and return values should equal the set of types it touches. If the method *touches* more types than its signature names, it's reaching through.

---

## 12. Quick rules

- LoD targets *structural coupling*, not dot count.
- Same-type chains (streams, optionals, builders) are exempt.
- Aggregate roots are the LoD seams in DDD — externals talk to roots; roots own internals.
- Read-side projections (CQRS, mappers) are intentionally exempt.
- Static helpers over *values* are fine; static helpers over *domain* are LoD violations in disguise.
- Package and module visibility make LoD a compiler-enforced property.
- Facades expose *intents*; facades exposing *getters* are LoD-laundering.
- When LoD fights cohesion (forcing SMTP into Customer), cohesion wins — return values, don't reach.
- Deep-stubbed tests are LoD's reverse symptom: see them, fix the production code.
- Count *distinct types this method touches via field navigation*; that's the real metric.

---

## 13. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Driving LoD across a team and code review                   | `professional.md`  |
| JLS / module-level vocabulary for LoD                       | `specification.md` |
| Spotting subtle LoD violations and runtime symptoms         | `find-bug.md`      |
| Cost of indirection: dispatch, allocation, JIT inlining     | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** LoD is a coupling minimizer. Apply it where structural coupling is the cost; bend it where the alternative is responsibility creep, anaemic models, or pointless ceremony. The senior heuristic: count distinct types your method *touches* via field navigation, not dots. That count is the coupling you've signed up for.
