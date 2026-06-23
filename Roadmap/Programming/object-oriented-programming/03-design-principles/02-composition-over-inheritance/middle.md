# Composition Over Inheritance — Middle

> **What?** At this level you stop reciting the slogan and start *refactoring* real hierarchies. The middle skill is mechanical: take a tree of classes, identify the axes of variation, lift each axis into an interface, and inject the chosen implementation as a field. The result is a flat class with replaceable parts instead of a deep tree with frozen choices.
> **How?** Each refactor follows the same recipe. Find the methods that vary across subclasses. Group them by *reason to change*. Turn each group into an interface with a small implementation set. Replace the subclass switch with constructor injection. Test that the original public behaviour survives, then delete the now-empty hierarchy.

---

## 1. Flattening a deep hierarchy of vehicles

A common shape in legacy code: a four-level inheritance tree that tries to encode every product variant as a class.

```java
abstract class Vehicle { /* fuel, drive, log */ }
abstract class LandVehicle extends Vehicle { /* wheels, brakes */ }
abstract class Car extends LandVehicle { /* doors, seats */ }
class GasolineCar extends Car { /* petrol engine */ }
class DieselCar   extends Car { /* diesel engine */ }
class ElectricCar extends Car { /* electric motor + battery */ }
class HybridCar   extends Car { /* both, somehow */ }
```

The trouble with `HybridCar` is the giveaway: it needs *two* engines, but Java gives it one parent. Either you duplicate engine code in `HybridCar`, or you add fake hooks into `Car`. Both paths rot.

The axis of variation is the engine, not the car. Lift it out:

```java
public interface Engine {
    void start();
    void stop();
    double fuelRate();        // litres or kWh per hour
}

public final class GasolineEngine implements Engine { /* ... */ }
public final class DieselEngine   implements Engine { /* ... */ }
public final class ElectricEngine implements Engine { /* ... */ }

public final class HybridEngine implements Engine {
    private final Engine primary;
    private final Engine backup;
    public HybridEngine(Engine primary, Engine backup) {
        this.primary = primary;
        this.backup = backup;
    }
    public void start()       { primary.start(); }
    public void stop()        { primary.stop(); backup.stop(); }
    public double fuelRate()  { return primary.fuelRate() + backup.fuelRate(); }
}

public final class Car {
    private final Engine engine;
    private final int doors;

    public Car(Engine engine, int doors) {
        this.engine = engine;
        this.doors = doors;
    }
    public void start() { engine.start(); }
}
```

`Car` is now one final class. Hybrid is just `new Car(new HybridEngine(gas, electric), 4)`. The tree collapsed because there was no real "is-a" — only "has-an engine".

---

## 2. The Decorator chain in depth

The junior file showed Notifier decoration as the shape. In middle code the harder skill is building decorators that compose *without* knowing about each other.

Take a `PaymentGateway` that has three orthogonal concerns: idempotency, retries, and audit logging. None of them should know the others exist.

```java
public interface PaymentGateway {
    Receipt charge(PaymentRequest request);
}

public final class StripeGateway implements PaymentGateway {
    public Receipt charge(PaymentRequest request) { /* real HTTP call */ }
}

public final class RetryingGateway implements PaymentGateway {
    private final PaymentGateway delegate;
    private final int maxAttempts;
    public RetryingGateway(PaymentGateway delegate, int maxAttempts) {
        this.delegate = delegate;
        this.maxAttempts = maxAttempts;
    }
    public Receipt charge(PaymentRequest request) {
        RuntimeException last = null;
        for (int i = 0; i < maxAttempts; i++) {
            try { return delegate.charge(request); }
            catch (TransientException e) { last = e; }
        }
        throw last;
    }
}

public final class IdempotentGateway implements PaymentGateway {
    private final PaymentGateway delegate;
    private final Map<String, Receipt> seen = new ConcurrentHashMap<>();
    public IdempotentGateway(PaymentGateway delegate) { this.delegate = delegate; }
    public Receipt charge(PaymentRequest request) {
        return seen.computeIfAbsent(request.idempotencyKey(),
                                    k -> delegate.charge(request));
    }
}

public final class AuditingGateway implements PaymentGateway {
    private final PaymentGateway delegate;
    private final AuditLog audit;
    public AuditingGateway(PaymentGateway delegate, AuditLog audit) {
        this.delegate = delegate;
        this.audit = audit;
    }
    public Receipt charge(PaymentRequest request) {
        audit.record("charge.start", request);
        Receipt r = delegate.charge(request);
        audit.record("charge.ok", r);
        return r;
    }
}

PaymentGateway production = new AuditingGateway(
    new IdempotentGateway(
        new RetryingGateway(
            new StripeGateway(), 3)),
    auditLog);
```

The order matters. Audit sits outermost because we want to log the user's intent and the final outcome. Idempotency sits next because we want to deduplicate before paying the retry cost. Retry sits closest to the network. Try the same with inheritance and you get `RetryingAuditingIdempotentStripeGateway` — and a different class for every order you might prefer.

---

## 3. Strategy pattern: replaceable algorithms

Strategy is composition applied to a single method. A class holds an interface field, the interface has one method, and at runtime the holder picks which implementation to use.

A pricing engine that supports multiple discount rules:

```java
public interface DiscountRule {
    BigDecimal applyTo(BigDecimal subtotal, Customer customer);
}

public final class PercentageDiscount implements DiscountRule {
    private final BigDecimal percent;
    public PercentageDiscount(BigDecimal percent) { this.percent = percent; }
    public BigDecimal applyTo(BigDecimal subtotal, Customer c) {
        return subtotal.multiply(BigDecimal.ONE.subtract(percent));
    }
}

public final class TieredDiscount implements DiscountRule {
    public BigDecimal applyTo(BigDecimal subtotal, Customer c) {
        BigDecimal cut = switch (c.tier()) {
            case BRONZE -> new BigDecimal("0.02");
            case SILVER -> new BigDecimal("0.05");
            case GOLD   -> new BigDecimal("0.10");
        };
        return subtotal.multiply(BigDecimal.ONE.subtract(cut));
    }
}

public final class NoDiscount implements DiscountRule {
    public BigDecimal applyTo(BigDecimal subtotal, Customer c) { return subtotal; }
}

public final class Checkout {
    private DiscountRule rule;
    public Checkout(DiscountRule rule) { this.rule = rule; }
    public void useRule(DiscountRule rule) { this.rule = rule; }
    public BigDecimal total(BigDecimal subtotal, Customer c) {
        return rule.applyTo(subtotal, c);
    }
}
```

Switching from tiered pricing to a flash promotion is one assignment: `checkout.useRule(new PercentageDiscount(new BigDecimal("0.20")))`. With inheritance you'd subclass `Checkout` three times and pick one at construction — locking the rule in for the object's lifetime.

A practical middle-level trick: keep a `NoDiscount` as the default so callers never have to null-check the rule. This is the *Null Object* pattern, which is composition's answer to "no behaviour".

---

## 4. Mixing behaviour with default methods

Java has no traits, but default methods on interfaces give you a usable approximation. The trick is to keep each interface tiny and focused on *one* capability.

```java
public interface Timestamped {
    Instant createdAt();
    default Duration age() { return Duration.between(createdAt(), Instant.now()); }
    default boolean olderThan(Duration d) { return age().compareTo(d) > 0; }
}

public interface Identifiable {
    UUID id();
    default String shortId() { return id().toString().substring(0, 8); }
}

public interface SoftDeletable {
    Instant deletedAt();
    default boolean isDeleted() { return deletedAt() != null; }
}

public final class Document
        implements Timestamped, Identifiable, SoftDeletable {
    private final UUID id;
    private final Instant createdAt;
    private final Instant deletedAt;
    /* constructor, accessors implementing the three interfaces */
    public UUID id()           { return id; }
    public Instant createdAt() { return createdAt; }
    public Instant deletedAt() { return deletedAt; }
}
```

`Document` picks up `age()`, `shortId()`, and `isDeleted()` without any class hierarchy. Tomorrow a `Photo` class can implement the same three interfaces and gain the same helpers. Compare this to a `BaseEntity` abstract class that bundles all three — every entity in the system is forced to take all three concepts, whether it needs them or not.

Default methods carry one risk: the *diamond* where two interfaces ship the same-named default. The compiler forces you to resolve it, which is good, but it means default methods are best when each interface owns a clearly different vocabulary.

---

## 5. Refactoring "Animal then Dog" via behaviour interfaces

The textbook example for inheritance is always `Animal -> Dog -> Labrador`. It looks clean until requirements arrive.

```java
abstract class Animal {
    abstract void move();
    abstract void speak();
    abstract void eat();
}
class Dog extends Animal {
    void move()  { /* run */ }
    void speak() { /* bark */ }
    void eat()   { /* chew */ }
}
class Fish extends Animal {
    void move()  { /* swim */ }
    void speak() { throw new UnsupportedOperationException(); }
    void eat()   { /* nibble */ }
}
class Snake extends Animal {
    void move()  { /* slither */ }
    void speak() { /* hiss, sort of */ }
    void eat()   { /* swallow */ }
}
```

The hierarchy is already broken: `Fish.speak()` throws, which is an LSP violation. The real problem is that "Animal" is not one type — it is a bag of independent capabilities (move, vocalize, feed) that different species combine differently.

```java
public interface Locomotion { void move(); }
public interface Vocalization { void vocalize(); }
public interface Feeder { void eat(Food f); }

public final class Running    implements Locomotion   { public void move() { /* run */ } }
public final class Swimming   implements Locomotion   { public void move() { /* swim */ } }
public final class Slither    implements Locomotion   { public void move() { /* slither */ } }
public final class Barking    implements Vocalization { public void vocalize() { /* bark */ } }
public final class Silent     implements Vocalization { public void vocalize() { } }
public final class Chewing    implements Feeder       { public void eat(Food f) { /* chew */ } }
public final class Swallowing implements Feeder       { public void eat(Food f) { /* swallow */ } }

public final class Animal {
    private final String species;
    private final Locomotion locomotion;
    private final Vocalization vocalization;
    private final Feeder feeder;

    public Animal(String species, Locomotion l, Vocalization v, Feeder f) {
        this.species = species;
        this.locomotion = l;
        this.vocalization = v;
        this.feeder = f;
    }
    public void move()       { locomotion.move(); }
    public void vocalize()   { vocalization.vocalize(); }
    public void eat(Food f)  { feeder.eat(f); }
}

Animal dog   = new Animal("dog",   new Running(),  new Barking(), new Chewing());
Animal fish  = new Animal("fish",  new Swimming(), new Silent(),  new Chewing());
Animal snake = new Animal("snake", new Slither(),  new Silent(),  new Swallowing());
```

A frog that swims as a tadpole and hops as an adult? Swap its `Locomotion` at metamorphosis time. With inheritance you'd need a new subclass per life stage.

---

## 6. The Builder pattern as composition

Constructors with many parameters age badly. Inheritance is a tempting "fix" — subclass for each common combination — but it explodes into `OrderForRegisteredCustomerWithGiftCardAndExpressShipping`. The Builder pattern is composition applied to *construction*: a separate object accumulates the parts, then produces the final immutable result.

```java
public final class Order {
    private final UUID id;
    private final Customer customer;
    private final List<LineItem> items;
    private final ShippingAddress shipping;
    private final BillingAddress billing;
    private final DiscountRule discount;
    private final boolean giftWrap;

    private Order(Builder b) {
        this.id       = b.id;
        this.customer = Objects.requireNonNull(b.customer, "customer");
        this.items    = List.copyOf(b.items);
        this.shipping = Objects.requireNonNull(b.shipping, "shipping");
        this.billing  = b.billing != null ? b.billing : b.shipping.asBilling();
        this.discount = b.discount != null ? b.discount : new NoDiscount();
        this.giftWrap = b.giftWrap;
    }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private UUID id = UUID.randomUUID();
        private Customer customer;
        private final List<LineItem> items = new ArrayList<>();
        private ShippingAddress shipping;
        private BillingAddress billing;
        private DiscountRule discount;
        private boolean giftWrap;

        public Builder customer(Customer c)        { this.customer = c; return this; }
        public Builder item(LineItem i)            { this.items.add(i); return this; }
        public Builder shipping(ShippingAddress s) { this.shipping = s; return this; }
        public Builder billing(BillingAddress b)   { this.billing = b; return this; }
        public Builder discount(DiscountRule d)    { this.discount = d; return this; }
        public Builder giftWrap(boolean g)         { this.giftWrap = g; return this; }
        public Order build()                       { return new Order(this); }
    }
}

Order o = Order.builder()
    .customer(alice)
    .item(new LineItem(book, 1))
    .item(new LineItem(pen, 3))
    .shipping(home)
    .discount(new TieredDiscount())
    .giftWrap(true)
    .build();
```

Note how the Builder is itself a small example of composition: it *holds* the future fields, validates them, and constructs the immutable `Order`. The Order has no parent class. New variants are new builder calls, not new subclasses.

---

## 7. JPA: from inheritance to single-table plus composition

JPA actively pushes you toward inheritance with `@Inheritance(strategy = ...)`. It works, but it bakes the type tree into the schema.

The inheritance approach for a payment system:

```java
@Entity
@Inheritance(strategy = InheritanceType.JOINED)
@DiscriminatorColumn(name = "kind")
public abstract class Payment {
    @Id UUID id;
    BigDecimal amount;
    Instant createdAt;
}

@Entity @DiscriminatorValue("CARD")
public class CardPayment extends Payment {
    String maskedPan;
    String network;
}

@Entity @DiscriminatorValue("BANK")
public class BankPayment extends Payment {
    String iban;
    String swift;
}

@Entity @DiscriminatorValue("WALLET")
public class WalletPayment extends Payment {
    String walletProvider;
    String accountRef;
}
```

You now have three tables joined by `id`. Adding a new payment kind means a schema migration and a new entity. Querying "all payments for customer X" needs joins or `TABLE_PER_CLASS` tricks.

The composed approach: one entity, one table, the variant data lives in an embedded value object selected by a discriminator.

```java
public enum PaymentKind { CARD, BANK, WALLET }

@Embeddable
public class PaymentInstrument {
    @Enumerated(EnumType.STRING) PaymentKind kind;
    String maskedPan;       // for CARD
    String network;         // for CARD
    String iban;            // for BANK
    String swift;           // for BANK
    String walletProvider;  // for WALLET
    String accountRef;      // for WALLET
}

@Entity
public class Payment {
    @Id UUID id;
    BigDecimal amount;
    Instant createdAt;
    @Embedded PaymentInstrument instrument;
}
```

One table, simple queries, sparse nullable columns. The trade is that the schema does not enforce "card payments have a PAN" — your domain layer does, with validation on `PaymentInstrument`. For most CRUD-style services this is the better deal: schema simplicity beats schema-encoded polymorphism.

If you genuinely need per-kind columns to be non-null at the DB level, JPA inheritance still earns its keep. The question is whether your domain has *behavioural* differences between kinds, or just *data* differences. Data differences belong in a composed value object.

---

## 8. Mistakes you make at this level

**Mistake 1: Decorator chains nobody can read.** Five decorators deep, declared inline in an injection method. Solution: name the chain in a factory method, return the configured object, and document the order.

```java
public PaymentGateway productionGateway(AuditLog audit) {
    return new AuditingGateway(
        new IdempotentGateway(
            new RetryingGateway(new StripeGateway(), 3)),
        audit);
}
```

**Mistake 2: Interfaces with one implementation.** Strategy is useless if there is only one strategy. Wait until you have two real cases before extracting the interface. Premature strategies become noise.

**Mistake 3: Mixing inheritance and composition for the same axis.** A class `extends BaseService` *and* takes a `ServiceHelper` field that does the same job. Pick one path per concern.

**Mistake 4: Forwarding methods that drift.** When you delegate, you write `public void x() { delegate.x(); }`. If the delegate gains a method tomorrow, you do not. That is sometimes the *point*, but other times it is a bug. Decide consciously which methods to expose, and add a comment if the choice is non-obvious.

**Mistake 5: Builders without `requireNonNull` or invariant checks.** A Builder that produces invalid `Order` objects defeats the pattern. Validate in `build()`, not at every setter.

---

## 9. Quick rules

- [ ] When a subclass overrides three or more methods, the parent is doing the wrong job — extract the variation as an interface and inject.
- [ ] One interface, one reason to change. Multiple capabilities on one interface push consumers toward inheritance again.
- [ ] Decorate from inside out: closest-to-resource innermost, most user-facing outermost.
- [ ] Provide a Null Object for every Strategy so callers never null-check.
- [ ] In JPA, prefer single-table plus `@Embedded` value object over `@Inheritance` unless behaviour (not just data) differs per kind.
- [ ] Builders return immutable objects and validate in `build()`.
- [ ] If two unrelated classes need the same helper, that helper is a *field*, not a superclass.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Framework-driven inheritance, dispatch trade-offs           | `senior.md`        |
| Driving the rule across a team and a codebase               | `professional.md`  |
| JLS support for sealed types, final, interfaces             | `specification.md` |
| Spotting subtle "is-a" abuse in code review                 | `find-bug.md`      |
| JIT, dispatch cost, allocation: composition vs inheritance  | `optimize.md`      |
| Hands-on refactoring exercises                              | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** find the axis of variation, lift it into a small interface, inject one implementation per case. A class with three replaceable fields beats a tree with three frozen subclasses every time.
