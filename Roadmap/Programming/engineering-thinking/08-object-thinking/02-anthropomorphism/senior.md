# Anthropomorphism — Senior

> **What?** At senior level, anthropomorphism stops being a teaching trick and becomes a *design lens you can switch on and off*. You know when "the invoice totals itself" is the right frame and when it is actively misleading — because of JPA, because of DTO boundaries, because of cross-cutting concerns, or because the class in front of you is a *stateless agent* whose only "identity" is a strategy.
> **How?** You learn to assign each class to a *role* (Information Holder, Service Provider, Coordinator, Controller, Interfacer, Structurer), and you anthropomorphize each role differently. You sharpen the language at module boundaries, you let sealed types and pattern matching restore polymorphism where the metaphor breaks, and you stop pretending a `JpaOrderEntity` is a person.

This page assumes you've read `junior.md` and `middle.md`. It builds the *engineering* judgment that decides when the agent metaphor earns its keep and when it has to step aside.

---

## 1. Where the metaphor fails in real codebases

Three places anthropomorphism breaks down in production Java systems:

**JPA entities.** A `@Entity` is half-object, half-row. The persistence context owns its identity, lifecycle, and dirty tracking. If you ask "what can the entity say about itself?" the honest answer is "whatever Hibernate lets me say while I'm still attached to a session." The metaphor leaks: an `Order` that is *detached* can't lazy-load its lines and will throw if you ask. The agent has amnesia depending on who's holding it.

**DTOs and API contracts.** A `CreateOrderRequest` is not an agent — it is a *message*. Anthropomorphizing it produces methods like `request.validate()` that bleed validation rules into a transport type and tie your domain to the shape of HTTP payloads.

**Cross-cutting concerns.** Logging, metrics, retry, authorization, transactions — these are not behaviors of any single agent. An `Invoice` does not "log itself". When you try to push these into agents, you get tangled methods and unstable tests.

```java
// Anti-pattern: the agent does too much because the metaphor tempts you.
public void markPaid(Payment p) {
    log.info("paying invoice {}", id);             // cross-cutting
    if (!securityCtx.canPay(this)) throw new ...;  // cross-cutting
    metrics.counter("invoice.paid").increment();   // cross-cutting
    this.status = PAID;                            // actual domain
    events.publish(new InvoicePaid(id));           // infrastructure
}
```

Senior move: keep the agent narrow. The *only* line that is truly the `Invoice`'s job is `this.status = PAID`. Everything else belongs to middleware, decorators, or an application service.

---

## 2. Object roles taxonomy (preview of RDD)

Rebecca Wirfs-Brock's Responsibility-Driven Design names six roles. Each role earns a different shape of "personhood".

```java
// Information Holder — knows facts, answers questions, guards invariants.
public record Money(BigDecimal amount, Currency currency) {
    public Money plus(Money other) {
        if (!currency.equals(other.currency)) throw new CurrencyMismatch();
        return new Money(amount.add(other.amount), currency);
    }
}
```

```java
// Service Provider — performs a focused computation on demand. Often stateless.
public interface TaxCalculator {
    Money taxFor(Money subtotal, Jurisdiction j);
}
```

```java
// Coordinator — orchestrates a workflow across other objects. Speaks in verbs.
public final class PlaceOrderCoordinator {
    public OrderId place(Cart cart, Customer c, PaymentMethod pm) {
        var order  = Order.from(cart, c);
        var charge = payments.authorize(pm, order.total());
        order.confirm(charge);
        orders.save(order);
        return order.id();
    }
}
```

```java
// Controller — decides what should happen next given an input event.
public final class CheckoutController {
    @PostMapping("/checkout")
    ResponseEntity<?> checkout(@RequestBody CheckoutRequest req) {
        var id = coordinator.place(req.toCart(), me(), req.payment());
        return ResponseEntity.created(uri(id)).build();
    }
}
```

```java
// Interfacer — translates between the domain and a foreign world.
public final class StripePaymentGateway implements PaymentGateway {
    public ChargeId authorize(Card c, Money amount) { /* HTTP to Stripe */ }
}
```

```java
// Structurer — maintains relationships between other objects.
public final class Schedule {
    private final NavigableMap<Instant, Appointment> slots = new TreeMap<>();
    public void book(Instant when, Appointment a) { /* ... */ }
    public Optional<Appointment> at(Instant when) { return Optional.ofNullable(slots.get(when)); }
}
```

The lesson: an Information Holder *is* a person; a Coordinator *acts like* a manager; an Interfacer *is* a translator at a border crossing. Anthropomorphizing all six the same way collapses the distinctions.

---

## 3. Stateless agents — can you anthropomorphize a `TaxRule`?

A Strategy or Specification has no state, no identity, no lifecycle. Is it still an agent?

Yes — a *role-shaped* agent. Think of a clerk who has no memory between customers but has expertise. The strategy speaks: "Show me the input; I'll tell you the answer." The first-person test still works:

```java
public interface ShippingStrategy {
    Money quote(Parcel p, Address dest);
}

public final class FlatRateShipping implements ShippingStrategy {
    private final Money flat;
    public FlatRateShipping(Money flat) { this.flat = flat; }
    @Override public Money quote(Parcel p, Address dest) { return flat; }
}

public final class WeightBasedShipping implements ShippingStrategy {
    @Override public Money quote(Parcel p, Address dest) {
        return Money.of(p.kilograms() * 4.50, USD);
    }
}
```

Read aloud: "I am Flat Rate Shipping. I always quote the same number." "I am Weight-Based Shipping. I charge \$4.50 per kilo." Both sentences are natural. Both objects have a *role* even though they have almost no state. Specifications behave the same way:

```java
public interface Specification<T> { boolean isSatisfiedBy(T candidate); }

public final class IsAdult implements Specification<Person> {
    public boolean isSatisfiedBy(Person p) { return p.age() >= 18; }
}
```

Stateless agents are still agents — they just have no biography.

---

## 4. The anti-anthropomorphism critique

Steve Yegge ("Execution in the Kingdom of Nouns") and Joe Armstrong (the Erlang viewpoint) push back hard:

- Yegge: forcing everything to be a noun produces classes like `OrderProcessorFactoryFactory` that exist only to host one verb. The verb should have been a function.
- Armstrong: "I wanted a banana but I got a gorilla holding the banana and the entire jungle." Anthropomorphism encourages bundling unrelated state with one verb.
- Data-oriented critics: agents *hide* state, but the actual problem is *transforming* state; visible transformations compose, hidden behaviors don't.

Take the critique seriously. The resolution is not "abandon objects" but "stop anthropomorphizing things that aren't agents":

- Pure functions should remain functions (Java: static methods, lambdas, `Function<A,B>`).
- Plain data should remain data (records).
- Pipelines should remain pipelines (streams, transducers).
- *Domain objects with invariants* — those are where anthropomorphism earns its keep.

A senior codebase is mixed: records and pure functions where state is incidental, agents where state has rules. The metaphor is a tool, not a worldview.

---

## 5. Designing for testability under the metaphor

If an `Order` is an agent, you test it by *asking it questions* and *observing what it says back* — including the events it emits. Two tactics:

**1. Make the agent emit events rather than call collaborators.**

```java
public final class Order {
    private final List<DomainEvent> events = new ArrayList<>();
    public void confirm(ChargeId charge) {
        if (status != PENDING) throw new IllegalState();
        this.status = CONFIRMED;
        events.add(new OrderConfirmed(id, charge, Instant.now()));
    }
    public List<DomainEvent> pullEvents() {
        var out = List.copyOf(events); events.clear(); return out;
    }
}
```

The test never mocks an email service or a payment gateway — it asserts on the event list. The agent's "speech" is observable directly.

**2. Use command objects to make verbs first-class.**

```java
public sealed interface OrderCommand {
    record Confirm(ChargeId charge)        implements OrderCommand {}
    record Cancel(String reason)            implements OrderCommand {}
    record Ship(TrackingNumber tracking)    implements OrderCommand {}
}

public List<DomainEvent> handle(OrderCommand cmd) {
    return switch (cmd) {
        case OrderCommand.Confirm c -> confirm(c.charge());
        case OrderCommand.Cancel  c -> cancel(c.reason());
        case OrderCommand.Ship    c -> ship(c.tracking());
    };
}
```

Tests then read as: "Given an order in PENDING, when handed a `Confirm`, it says `OrderConfirmed`." Pure input -> output. Integration tests sit one layer up and verify that the coordinator actually wires events to outbound adapters — that boundary, not the agent itself, is where infrastructure assertions live.

---

## 6. Sealed types + pattern matching (Java 21)

Polymorphism is the classical way to let agents "speak for themselves" (each subclass overrides a method). But pure polymorphism scatters logic across files and hides totality. Sealed types restore *closed-world* anthropomorphism: a finite set of agents, each with its own voice, and the compiler enforces exhaustiveness.

```java
public sealed interface Shape permits Circle, Square, Triangle {}
public record Circle(double r)                  implements Shape {}
public record Square(double side)               implements Shape {}
public record Triangle(double base, double h)   implements Shape {}

double area(Shape s) {
    return switch (s) {
        case Circle c   -> Math.PI * c.r() * c.r();
        case Square sq  -> sq.side() * sq.side();
        case Triangle t -> 0.5 * t.base() * t.h();
    };
}
```

Is the `Circle` an agent? In the old "tell, don't ask" reading, yes — it should have its own `area()`. In the sealed reading, the *family* is the agent: shapes as a closed alliance answering one question. The senior judgment is contextual:

- One verb, closed set, used in many places -> polymorphism (each agent owns its method).
- Many verbs, closed set, mostly read in one consumer -> sealed + pattern matching (the consumer narrates).

Pattern matching is not anti-OO — it is *anthropomorphism at the family level*.

---

## 7. The "rich object" trap

A class with twenty verbs is not an agent — it is a corporation pretending to be a person. Smell signals:

- Methods that take different sets of collaborators (some need a clock, some need a repository, some need nothing).
- Verbs at different abstraction levels (`addLine`, `recalculate`, `submitToFinanceMinistry`).
- Tests that drag in five mocks to exercise one method.

Splits to consider:

```java
// Before: Order does everything.
class Order { addLine(); removeLine(); confirm(); ship(); refund(); export(); /* ... */ }

// After: split by lifecycle phase and by audience.
final class Cart            { void add(Line l); void remove(LineId id); Order checkout(); }
final class Order           { void confirm(ChargeId c); void cancel(); }   // domain agent
final class Shipment        { void dispatch(Address a); }                  // separate lifecycle
final class OrderExporter   { String toCsv(Order o); }                     // outbound adapter
```

Each resulting class passes the role-play test cleanly: the `Cart` is a shopper-assistant, the `Order` is a contract, the `Shipment` is a parcel, the `OrderExporter` is a clerk. None of them owns "everything an order ever does".

---

## 8. Boundary-crossing without leaking identity

When a domain agent must reach the outside world (HTTP, DB, queue), how do you preserve the metaphor without letting transport leak in?

The senior pattern: agents speak to *ports* in their own language; *adapters* translate to and from the foreign language.

```java
// Domain port — phrased in the agent's vocabulary.
public interface InventoryReservations {
    ReservationId reserve(Sku sku, int qty);
    void release(ReservationId id);
}

// Adapter — implements the port using a queue. The Order never knows.
public final class KafkaInventoryReservations implements InventoryReservations {
    private final KafkaTemplate<String, byte[]> kafka;
    @Override public ReservationId reserve(Sku sku, int qty) {
        var id = ReservationId.fresh();
        kafka.send("reservations", id.value(), encode(new ReserveCmd(sku, qty, id)));
        return id;
    }
    @Override public void release(ReservationId id) { /* ... */ }
}
```

The `Order` calls `reservations.reserve(sku, qty)`. It does not know there's a Kafka topic, a serializer, or a retry policy. The agent stays in its own identity; the adapter takes the impact of the foreign protocol.

The litmus test: can you swap Kafka for an in-memory test fake without changing one line of the domain? If yes, identity is preserved. If no, the transport has leaked into the agent.

---

## 9. Tradeoffs vs functional / data-oriented styles

| Concern                  | Anthropomorphic OO                          | Data-oriented / functional               |
| ------------------------ | ------------------------------------------- | ---------------------------------------- |
| Where invariants live    | Inside the agent (constructor + methods)    | At validation boundaries                 |
| Where logic lives        | Methods on the agent                        | Pure functions over plain data           |
| Adding a new operation   | Adds a method to N classes                  | Adds one function                        |
| Adding a new variant     | Adds one class                              | Updates every function over the variant  |
| Testability              | Strong if events/commands are used          | Strong by default (no hidden state)      |
| Persistence fit          | Friction with ORMs and detached entities    | Maps cleanly to records and rows         |
| Concurrency              | Risky if agents are mutable                 | Easier — values are immutable            |
| Domain readability       | High when the domain is *agent-shaped*      | High when the domain is *transformation-shaped* |

This is the *expression problem* in disguise. Choose anthropomorphism when the set of operations is stable but the set of variants grows. Choose data-oriented style when the set of variants is stable but the set of operations grows. Real systems are mixed — one module is agent-shaped, the next is pipeline-shaped, and that is fine.

---

## 10. Quick rules

- [ ] Tag every class with a role (Information Holder / Service Provider / Coordinator / Controller / Interfacer / Structurer). The role decides how much personhood it gets.
- [ ] Don't anthropomorphize JPA entities, DTOs, or transport types — they have no autonomous identity.
- [ ] Push cross-cutting concerns out of the agent and into decorators or middleware.
- [ ] Prefer events over direct collaborator calls inside domain agents; integration tests sit at the boundary.
- [ ] Use sealed types + pattern matching when the agent family is closed and consumers want exhaustiveness; use classical polymorphism when the verb is the same across the family.
- [ ] Watch for the "rich object" trap: if an agent needs more than three collaborators, it has multiple personalities.
- [ ] Talk to infrastructure through ports phrased in the domain's voice; adapters absorb the foreign accent.
- [ ] When the metaphor strains, switch to records + functions for that slice. Don't moralize about it.

---

## 11. What's next

| Topic                                                                | File              |
| -------------------------------------------------------------------- | ----------------- |
| Driving the vocabulary across a team and code review                 | `professional.md` |
| Hands-on role-play exercises                                         | `tasks.md`        |
| Interview Q&A                                                        | `interview.md`    |
| Responsibility-Driven Design — full role taxonomy                    | `../03-responsibility-driven-design/` |
| Sealed types, pattern matching, and closed-world modeling            | `../../02-polymorphism/` |

---

**Memorize this:** anthropomorphism is a *lens*, not a law — switch it on for domain agents with invariants, switch it off for DTOs, JPA entities, and cross-cutting concerns, and let roles, sealed types, and ports keep each agent's identity intact at every boundary.
