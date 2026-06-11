# GRASP — Junior

> **What?** *GRASP* — **G**eneral **R**esponsibility **A**ssignment **S**oftware **P**atterns — is a set of nine named answers to one question that haunts every OO design: *which class should do this job?* Coined by Craig Larman in *Applying UML and Patterns*, GRASP is not a library or a framework; it is vocabulary for the single most common design decision you make: deciding where a method, a field, or a piece of logic belongs.
> **How?** When you're holding a responsibility — "compute the order total", "decide which discount applies", "talk to the database" — and you don't know which class should own it, you run the GRASP checklist: who has the *information* to do it (Information Expert)? Who *creates* the object (Creator)? Who *coordinates* the use case (Controller)? Will this assignment *couple* things tightly or *scatter* a concern (Low Coupling / High Cohesion)? GRASP turns "where does this go?" from a gut feeling into a reasoned choice you can defend in review.

---

## 1. The one question GRASP answers

Every class diagram you've ever drawn was the result of hundreds of micro-decisions: *this* method goes on `Order`, *that* field goes on `Customer`, *this* logic goes in a new `PricingService`. Most developers make these decisions by reflex, and most of the time the reflex is wrong in some small way that compounds into a tangled codebase six months later.

GRASP gives names to the *good* reflexes. There are nine patterns, but they fall into two groups:

- **Five "where does it go" patterns** — Information Expert, Creator, Controller, Polymorphism, Pure Fabrication. These tell you *which class* should hold a responsibility.
- **Two "is this a good assignment" evaluators** — Low Coupling and High Cohesion. These are the *scoring functions* you apply to any candidate placement.
- **Two "decouple this" patterns** — Indirection and Protected Variations. These tell you how to insert a buffer when a responsibility would otherwise create a brittle dependency.

You don't "apply GRASP" as a ritual. You reach for the relevant pattern when you're stuck on a placement decision, then check the result against Low Coupling and High Cohesion.

---

## 2. Information Expert — give the job to whoever has the data

> **Assign a responsibility to the class that has the information needed to fulfil it.**

This is the workhorse. Nine times out of ten, the question "which class should do X?" answers itself once you ask "which class already holds the data X needs?"

```java
// Who should compute an order's total? The Order — it holds the line items.
public record OrderLine(String sku, int qty, BigDecimal unitPrice) {
    BigDecimal subtotal() { return unitPrice.multiply(BigDecimal.valueOf(qty)); }
}

public class Order {
    private final List<OrderLine> lines;

    public Order(List<OrderLine> lines) { this.lines = List.copyOf(lines); }

    // Information Expert: Order owns the lines, so Order computes the total.
    public BigDecimal total() {
        return lines.stream()
                    .map(OrderLine::subtotal)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

Compare the anti-pattern, where the data lives in one place but the logic lives somewhere else:

```java
// Anemic: Order is a dumb data bag; an external service does the work.
public class Order { public List<OrderLine> getLines() { return lines; } }

public class OrderTotalCalculator {
    public BigDecimal total(Order order) {
        return order.getLines().stream()          // reaches into Order's data
                    .map(l -> l.unitPrice().multiply(BigDecimal.valueOf(l.qty())))
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

The calculator has to *pull* `Order`'s data out through getters to do a job `Order` is best placed to do. That's a classic sign you've ignored the Information Expert. The fix: move `total()` onto `Order`, where the data is.

**Pitfall:** Information Expert is a *default*, not a law. If putting the logic on the data-holder would force that class to depend on a database, a network, or a UI framework, the expert is the *wrong* place — see Pure Fabrication (§7) and Low Coupling (§5).

---

## 3. Creator — who gets to `new` it?

> **Assign class B the responsibility of creating instances of class A if B aggregates, contains, records, closely uses, or has the initializing data for A.**

The most common right answer: the *container* creates the *contained*. An `Order` creates its `OrderLine`s because it aggregates them; a `Game` creates its `Board`; a `Document` creates its `Paragraph`s.

```java
public class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    // Creator: Order contains OrderLines, so Order creates them.
    public void addLine(String sku, int qty, BigDecimal price) {
        lines.add(new OrderLine(sku, qty, price));   // Order is the natural creator
    }
}
```

Why does this matter? Because creation is a *coupling decision*. Whoever calls `new OrderLine(...)` is now coupled to `OrderLine`'s constructor signature. If you scatter `new OrderLine(...)` across ten classes, changing the constructor breaks ten classes. Concentrating creation in the container limits the blast radius and keeps the invariant ("an order line only exists inside an order") enforceable.

**Pitfall:** When creation is *complicated* (many constructor variants, conditional logic, object pools), Creator points you away from the container and toward a dedicated **Factory** — which is a **Pure Fabrication** (§7). GRASP's Creator and the GoF Factory pattern are the same instinct at two scales.

---

## 4. Controller — the first object behind the UI

> **Assign the responsibility of handling a system event to a class that represents the overall system, a root object, a device, or a use-case scenario.**

When a request arrives from outside the system (a button click, an HTTP call, a message), *something* has to receive it and coordinate the response. That something is the **Controller**. Its job is not to *do* the work — it's to *delegate* the work to the domain objects that should do it.

```java
// A use-case controller: receives the system event, delegates to the domain.
public class PlaceOrderController {
    private final OrderRepository orders;
    private final InventoryService inventory;

    public PlaceOrderController(OrderRepository orders, InventoryService inventory) {
        this.orders = orders;
        this.inventory = inventory;
    }

    // System operation handler. Note: no business rules live here — only orchestration.
    public OrderId placeOrder(Cart cart) {
        Order order = Order.fromCart(cart);   // delegate creation
        inventory.reserve(order);             // delegate to a collaborator
        orders.save(order);                   // delegate persistence
        return order.id();
    }
}
```

A Controller is a thin coordination layer. The classic failure mode is the **bloated controller** — one that grows business logic, validation, and calculation until it's a god object. When you see an HTTP handler with three hundred lines of `if` statements, that's a Controller that forgot its job is *delegation*.

**Pitfall:** A Controller is *not* the same as a web-framework `@Controller`. The GRASP Controller is a design role (the first domain object that handles a system event); a Spring `@Controller` is one *implementation* of it. Don't put domain logic in the Spring class — let it call a GRASP Controller / use-case object.

---

## 5. Low Coupling — the scoring function for "is this a good place?"

> **Assign responsibilities so that coupling (the degree to which one element depends on, or knows about, others) stays low.**

Low Coupling is not a placement pattern — it's an *evaluator*. After Information Expert or Creator hands you a candidate, you ask: *does this assignment make one class depend on more things?* If yes, look for a placement that depends on fewer.

```java
// High coupling: Order must know about Postgres to save itself.
public class Order {
    public void save() {
        try (var conn = DriverManager.getConnection("jdbc:postgresql://...")) { /* ... */ }
    }
}
```

`Order` is now coupled to JDBC, a driver, and a connection URL. Change the database and you edit the domain. Information Expert *suggested* `Order` (it has the data), but Low Coupling *overrules* it — persistence is a different concern. Move it to a repository (a Pure Fabrication, §7) and `Order` couples to nothing infrastructural.

The whole topic of [../../03-design-principles/04-cohesion-and-coupling/](../../03-design-principles/04-cohesion-and-coupling/) is the deep dive; here it's enough to know GRASP uses coupling as the tie-breaker between candidate placements.

---

## 6. High Cohesion — the other scoring function

> **Assign responsibilities so that each class stays focused, with strongly related responsibilities.**

High Cohesion is the second evaluator. It asks: *do the responsibilities on this class belong together?* A class that handles orders *and* sends emails *and* writes audit logs has low cohesion — three unrelated jobs on one name.

```java
// Low cohesion: Order does pricing AND persistence AND notification.
public class Order {
    public BigDecimal total()       { /* pricing — belongs here */ }
    public void saveToDatabase()    { /* persistence — does NOT belong here */ }
    public void emailConfirmation() { /* notification — does NOT belong here */ }
}
```

Low Coupling and High Cohesion almost always move together: when you pull persistence and notification off `Order` to reduce coupling, you also *raise* `Order`'s cohesion (it's now purely about order data and pricing). Larman treats these two as the master evaluators — every other GRASP pattern is in service of keeping coupling low and cohesion high.

---

## 7. Pure Fabrication — invent a class that isn't in the domain

> **Assign a cohesive set of responsibilities to an artificial class that does not represent a domain concept, in order to support High Cohesion and Low Coupling.**

Sometimes *no* domain object is the right home. Persistence doesn't belong on `Order`. Mapping a DTO doesn't belong on `Customer`. So you *fabricate* a class — `OrderRepository`, `OrderMapper`, `PricingService` — that exists purely to hold that responsibility cleanly.

```java
// Pure Fabrication: a class with no real-world counterpart, invented for clean design.
public interface OrderRepository {
    void save(Order order);
    Optional<Order> findById(OrderId id);
}

public class JdbcOrderRepository implements OrderRepository {
    // all the database coupling lives HERE, away from the domain
    public void save(Order order) { /* JDBC */ }
    public Optional<Order> findById(OrderId id) { /* JDBC */ }
}
```

`OrderRepository` is not a noun your business analyst would recognise — there's no "repository" in the real world of ordering. It's a *fabrication* that keeps `Order` pure and concentrates the database coupling in one place. Repositories, services, factories, mappers, controllers: most of the "...er" and "...Service" classes in a clean codebase are Pure Fabrications.

**Pitfall:** Pure Fabrication is *not* a licence to drain logic out of domain objects into services (that's the **anemic domain model** anti-pattern). Fabricate a class only when the responsibility genuinely doesn't belong on any domain object — usually because it's infrastructural or cross-cutting.

---

## 8. Polymorphism — replace type-checks with dispatch

> **When behaviour varies by type, assign the responsibility — using polymorphic operations — to the types for which the behaviour varies. Do not test for the type with conditional logic.**

The smell: a `switch` or `if/else` chain on a type code or `instanceof`. The GRASP answer: give each type its own implementation and let dynamic dispatch choose.

```java
// Not polymorphic: every new shape edits this method (OCP violation).
public double area(Shape s) {
    if (s instanceof Circle c)      return Math.PI * c.radius() * c.radius();
    else if (s instanceof Square q) return q.side() * q.side();
    else throw new IllegalArgumentException();
}

// Polymorphic: each type owns its behaviour; adding a type adds a class, edits nothing.
public sealed interface Shape permits Circle, Square {
    double area();
}
public record Circle(double radius) implements Shape {
    public double area() { return Math.PI * radius * radius; }
}
public record Square(double side) implements Shape {
    public double area() { return side * side; }
}
```

This is GRASP Polymorphism and SOLID's Open/Closed Principle describing the same move from two angles. (See [../../03-design-principles/01-solid-principles/](../../03-design-principles/01-solid-principles/).)

---

## 9. Indirection — insert a middleman to decouple

> **Assign the responsibility to an intermediate object to mediate between two components so they stay decoupled.**

When two classes shouldn't know about each other directly, you insert a third class that *both* know about, breaking the direct dependency.

```java
// Direct coupling: domain logic talks straight to the SMS vendor SDK.
public class OrderService {
    public void confirm(Order o) { TwilioApi.sendSms(o.phone(), "Confirmed"); }
}

// Indirection: a Notifier interface mediates. OrderService never names Twilio.
public interface Notifier { void notify(String to, String message); }

public class OrderService {
    private final Notifier notifier;
    public OrderService(Notifier notifier) { this.notifier = notifier; }
    public void confirm(Order o) { notifier.notify(o.phone(), "Confirmed"); }
}
```

The `Notifier` interface is the indirection. `OrderService` depends on it; `TwilioNotifier implements Notifier` lives at the edge. Adapters, facades, bridges, and dependency-inversion interfaces are all Indirection in action.

---

## 10. Protected Variations — wrap the things that change

> **Identify points of predicted variation or instability; assign responsibilities to create a stable interface around them.**

This is the most strategic GRASP pattern: it tells you to *predict* where change will come from and build a stable boundary there before the change arrives. A stable interface around a volatile detail means the volatility can't leak into the rest of the system.

```java
// The tax rules WILL change (new regions, rate changes, new product categories).
// Protect the rest of the system behind a stable interface.
public interface TaxPolicy {
    BigDecimal taxFor(Order order);
}

// Variation lives behind the boundary; Order and OrderService never change when rules do.
public class EuVatPolicy   implements TaxPolicy { /* ... */ }
public class UsSalesTaxPolicy implements TaxPolicy { /* ... */ }
```

Protected Variations is the *umbrella* over Polymorphism, Indirection, and Pure Fabrication — they're all techniques for building the stable interface it asks for. It's also the same idea as SOLID's Open/Closed Principle and Dependency Inversion. The judgement call is *where* to protect: wrap the variations you can actually predict, not every conceivable one (over-wrapping is its own smell — see [../../03-design-principles/05-dry-kiss-yagni/](../../03-design-principles/05-dry-kiss-yagni/)).

---

## 11. The nine, on one page

| Pattern | Question it answers | Typical Java shape |
| --- | --- | --- |
| **Information Expert** | Who has the data to do this? | a method on the data-holding class |
| **Creator** | Who should `new` this? | the container/aggregator creates its parts |
| **Controller** | Who handles a system event? | a use-case / facade object behind the UI |
| **Low Coupling** | Is this placement minimising dependencies? | *evaluator* — fewer arrows between classes |
| **High Cohesion** | Do these responsibilities belong together? | *evaluator* — one focused purpose per class |
| **Polymorphism** | Behaviour varies by type — where? | sealed interface + per-type implementations |
| **Pure Fabrication** | No domain object fits — now what? | invented `Repository`/`Service`/`Mapper` |
| **Indirection** | How do I stop A and B coupling directly? | an interface/mediator between them |
| **Protected Variations** | Where will change come from? | a stable interface around the volatile part |

---

## 12. Common newcomer mistakes

**Mistake 1: treating GRASP as a code generator.** GRASP is a vocabulary for *reasoning*, not a recipe. You don't "implement Information Expert"; you *use it to decide* where a method goes, then sanity-check with Low Coupling and High Cohesion.

**Mistake 2: Information Expert at all costs → fat domain objects.** Blindly piling every method onto the data-holder gives you a 2,000-line `Order` that also does persistence and notification. Low Coupling and Pure Fabrication exist precisely to overrule the expert when the data-holder is the wrong home.

**Mistake 3: confusing Pure Fabrication with anemic domain.** A repository is a healthy Pure Fabrication. An `OrderService` that holds *all* the order logic while `Order` is a struct of getters is the *anemic domain* anti-pattern. The difference: fabricate for *infrastructural/cross-cutting* concerns; keep *business* logic on the experts.

**Mistake 4: making everything an interface for "Protected Variations".** Wrapping every class in an interface "just in case" is speculative generality. Protect the variations you can *name and predict* — payment providers, tax regimes, storage backends — not the ones you're imagining.

---

## 13. Quick rules

- [ ] **Information Expert** — put the method where the data already is, unless that creates infrastructural coupling.
- [ ] **Creator** — let the container create its parts; promote to a Factory when creation gets complex.
- [ ] **Controller** — one thin coordinator per system event; it delegates, it doesn't compute.
- [ ] **Low Coupling / High Cohesion** — the two evaluators every placement must pass.
- [ ] **Polymorphism** — replace `switch`/`instanceof` on type with per-type implementations.
- [ ] **Pure Fabrication** — invent a class for concerns no domain object should own (persistence, mapping).
- [ ] **Indirection** — insert an interface to break a direct A→B dependency.
- [ ] **Protected Variations** — build a stable boundary around the change you can predict.

---

## 14. What's next

| Topic | File |
| --- | --- |
| Worked end-to-end design of a small system using all nine | `middle.md` |
| Tensions between patterns, judgement calls, history | `senior.md` |
| Reviewing responsibility assignment across a team | `professional.md` |
| Larman, GoF, SOLID — the canonical sources mapped | `specification.md` |
| Interview Q&A | `interview.md` |
| Design exercises | `tasks.md` |
| Spot the misassigned responsibility | `find-bug.md` |
| Reduce coupling / raise cohesion, measured | `optimize.md` |

---

**Memorize this:** GRASP answers one question — *which class should own this responsibility?* Default to **Information Expert** (the data-holder), let the **Creator** build its parts, route system events through a thin **Controller**, and replace type-switches with **Polymorphism**. Always score the result against **Low Coupling** and **High Cohesion** — and when no domain object fits, **fabricate** one. **Indirection** and **Protected Variations** are how you build the stable boundaries that absorb predicted change.
