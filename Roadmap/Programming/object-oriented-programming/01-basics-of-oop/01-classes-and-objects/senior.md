# Classes and Objects — Senior

> **How to optimize?** Pick the cheapest representation that still owns its invariants — fewer fields, smaller objects, less indirection, less garbage. Allocation is rarely free, references are never free, and most "performance" wins start with object design, not micro-tuning.
> **How to architect?** Decide for each class whether it is a value, an entity, or a service; let that choice dictate equality, mutability, identity, lifetime, and dependency rules. Architecture failures usually trace back to one class trying to be all three.

---

## 1. Three archetypes — every class is exactly one

| Archetype | Purpose                          | Mutability      | Equality      | Lifetime          | Examples                       |
|-----------|----------------------------------|-----------------|---------------|-------------------|--------------------------------|
| **Value** | Represent a number, label, fact  | Immutable       | By fields     | Short, allocate freely | `Money`, `Email`, `LocalDate`   |
| **Entity**| Has identity and state over time | Mutable, controlled | By ID    | Long, repository-managed | `Order`, `User`, `BankAccount`  |
| **Service** | Stateless behavior              | Effectively immutable | Identity | Singleton-ish     | `EmailSender`, `PriceCalculator`|

Architectural sins almost always trace back to **mixing archetypes**:

- A `User` class that is also a service (carries an `EmailSender` field) → can't serialize, can't compare, can't migrate.
- An `Order` value object with mutable state → identity bugs, cache poisoning, equals-changes-after-insertion.
- A `PriceCalculator` with mutable instance fields → race conditions and order-of-call bugs.

Whenever a class hurts, ask: *which archetype was it supposed to be, and where did it accidentally pick up a second job?*

---

## 2. Value types — small, immutable, comparable

Treat values like primitives. They are cheap to create, cheap to compare, and trivially correct in concurrent code.

```java
public final class Money {
    private final long cents;
    private final Currency currency;

    private Money(long cents, Currency currency) {
        this.cents = cents;
        this.currency = currency;
    }

    public static Money of(long cents, Currency currency) {
        return new Money(cents, Objects.requireNonNull(currency));
    }

    public Money plus(Money other) {
        if (!currency.equals(other.currency))
            throw new IllegalArgumentException("currency mismatch");
        return new Money(Math.addExact(cents, other.cents), currency);
    }

    @Override public boolean equals(Object o) { ... }
    @Override public int hashCode() { ... }
    @Override public String toString() { ... }
}
```

Architectural rules for values:

1. **`final` class.** Subclassing a value object breaks `equals` symmetry.
2. **All fields `final`** and of immutable types (or defensively copied).
3. **No setters.** Mutating operations return a new instance.
4. **No services as fields.** A `Money` does not own a `CurrencyConverter`.
5. **Total functions when possible.** Validate at the boundary, then operate freely.

Java 16+ `record` was made for these:

```java
public record Money(long cents, Currency currency) {
    public Money {
        Objects.requireNonNull(currency);
    }
    public Money plus(Money other) { ... }
}
```

A record gets `equals`/`hashCode`/`toString` for free, and the compact constructor lets you validate. Prefer it for values unless you genuinely need a non-final class or hidden representation.

---

## 3. Entities — identity over equality

```java
public class Order {                         // not final — extending may be valid
    private final OrderId id;                // identity, set once
    private OrderStatus status;
    private final List<OrderLine> lines = new ArrayList<>();

    public Order(OrderId id) { this.id = id; }

    @Override public boolean equals(Object o) {
        return o instanceof Order other && id.equals(other.id);
    }
    @Override public int hashCode() { return id.hashCode(); }
}
```

Entities live longer, mutate, and are usually loaded/saved by a repository. Their equality is by **identifier**, not by field-by-field comparison — two different in-memory copies of the same database row are still "the same order."

Common architectural decisions for entities:

- **Aggregate root**: only this class can be loaded directly; child entities (`OrderLine`) are reached through it. Repositories return aggregates, never their internals.
- **Encapsulated state changes**: instead of `setStatus(SHIPPED)`, expose `ship()`, which validates the prior state, mutates, and emits a domain event.
- **Invariant guard at the aggregate boundary**: `order.totalCents()` is computed from `lines`, not stored, so it cannot drift out of sync.

A common smell: an entity with 30 setters. That's a database row pretending to be an object — every caller can break invariants because the entity has none.

---

## 4. Services — behavior without state

Services should be either:

- **Singletons** registered with the DI container, with all dependencies in `final` fields.
- **Static utility classes** (private constructor) for pure stateless work.

```java
public final class PriceCalculator {
    private final TaxTable taxes;             // injected, immutable

    public PriceCalculator(TaxTable taxes) { this.taxes = taxes; }

    public Money priceFor(Cart cart) { ... }
}
```

Hard rules:

1. No mutable instance fields.
2. No reaching into static singletons from inside methods (hidden dependency → untestable).
3. Methods are pure or have explicit side effects (e.g., named `send`, `save`, `publish`).
4. Constructor takes everything it needs. No `setXxx` for collaborators after construction.

If a service has a setter for one of its dependencies, it stops being a service and starts being a stateful object — you've lost thread-safety and made testing painful.

---

## 5. Object size: what it actually costs

Every object on the heap has a header (8–16 bytes on 64-bit HotSpot, depending on `-XX:+UseCompressedOops` and whether biased locking is on), then padded fields, then 8-byte alignment.

```
class Point { int x; int y; }
            ↓
header(12) | x(4) | y(4) | pad(4)        →  24 bytes
```

```
class Box  { Point topLeft; Point bottomRight; }
            ↓
header(12) | ref(4) | ref(4) | pad(4)    →  24 bytes for the Box itself
                                          + 24 bytes per Point  =  72 bytes total
```

Practical implications:

- **Field ordering matters** under default `FieldsAllocationStyle`: longs and doubles get aligned, references compressed, and you may end up with hidden padding. Use `jol-cli` (`OpenJDK Object Layout`) to inspect when it counts.
- **Boxing is expensive.** `Integer` is at minimum 16 bytes plus alignment, vs. 4 bytes for `int`. `List<Integer>` of a million items is roughly 24 MB, not 4 MB. For hot paths use primitive arrays or specialized libraries (`Eclipse Collections`, `fastutil`, JEP 401 value classes when available).
- **Reference indirection** kills cache locality. An `Order` with `List<OrderLine>` of 100 lines pointing to 100 separate heap objects will touch ~100 cache lines for a single iteration. If iteration speed matters, store data in a flat array of records or in columnar arrays.

Object design is performance design. Most "make this faster" PRs end up changing how data is laid out, not how it's processed.

---

## 6. Allocation strategy and lifetime

The cheapest object is the one you didn't allocate. The next cheapest is the one that dies young.

Patterns from cheapest to most expensive:

1. **Stack-allocated by escape analysis**. The JVM proves the object never escapes its method and elides the allocation entirely (scalar replacement). Common for tiny short-lived objects.
2. **Young-generation allocation**. Bump-pointer allocation in a TLAB, sub-nanosecond. Dies before the next GC and never gets copied.
3. **Tenured / long-lived**. Survived enough young GCs to be promoted. Now contributes to old-generation GC pressure.
4. **Off-heap / direct buffers**. Outside the GC's purview, but you manage lifetime manually.

Architectural levers:

- **Don't keep a global cache of short-lived results.** Promotion turns cheap objects into expensive ones.
- **Pool only when allocation is genuinely the bottleneck.** Object pools are notoriously easy to misuse and frequently *slower* than fresh allocation because of synchronization, leak risk, and worse locality.
- **Prefer factory methods that can return shared instances** (`List.of()`, `Optional.empty()`, `Boolean.TRUE`) for common cases.

---

## 7. Encapsulation past the textbook

Textbook encapsulation: "make fields private." Senior encapsulation: **the class is the only place that can place this object in an inconsistent state**.

Tests:

- Could a caller, by combining public methods, produce an `Order` whose total disagrees with the sum of its lines? If yes, encapsulation is broken.
- Could a caller, by holding onto a returned reference, mutate internal state later? If yes, you forgot a defensive copy.
- Could a subclass observe a half-constructed instance? If yes, you have an overridable call from a constructor.

A useful gauge: count the public methods. If the count grows with the class size in a roughly linear way, the class probably exposes its data shape rather than its capability. Refactor toward fewer, more meaningful operations (`order.ship()`, not `order.setStatus(...)`).

---

## 8. Class design vs database design

A persistent entity is *not* the same shape as its database row.

| Concern              | Database row                   | Domain class                          |
|----------------------|--------------------------------|---------------------------------------|
| Identity             | Surrogate `id` column           | Domain identity (`OrderId(UUID)`)      |
| Nullability          | NULL columns are common        | `null` should be rare; use `Optional`  |
| Field meaning        | `status TEXT`                  | `OrderStatus` enum or sealed class     |
| Composition          | Rows in another table          | Embedded value objects                 |
| Invariants           | Constraints, triggers          | Methods + private fields               |

Letting JPA/Hibernate dictate the class shape (public setters for every column, no-arg constructor, mutable collections) is a common cause of anemic domain models. Either:

- Keep the persistence model separate from the domain model and translate at the boundary.
- Or use a persistence layer that respects immutability (jOOQ, MyBatis, manual mapping) so the domain class can stay clean.

---

## 9. Sealed hierarchies — closed sets of types

Java 17's sealed classes/interfaces let you say "these are *all* the possible subtypes."

```java
public sealed interface PaymentResult permits Approved, Declined, Pending {}

public record Approved(TransactionId txId)        implements PaymentResult {}
public record Declined(String reason)              implements PaymentResult {}
public record Pending(Duration expectedDelay)      implements PaymentResult {}
```

Combined with pattern matching:

```java
String summary = switch (result) {
    case Approved(var id)        -> "OK " + id;
    case Declined(var reason)    -> "Failed: " + reason;
    case Pending(var delay)      -> "Pending " + delay;
};
```

The compiler enforces exhaustiveness — add a new `permits` member and every `switch` without a matching case fails to compile. This turns a runtime risk ("did I forget a case?") into a build error. Use it for state machines, result types, AST nodes — anywhere the universe of types is genuinely closed.

---

## 10. Composition over inheritance — the architectural reason

Inheritance binds you to:

1. **The superclass's interface.** Every public method is now part of yours.
2. **The superclass's implementation.** Internal calls between superclass methods are the *Liskov substitution* trap (`HashSet#addAll` calling `add` was the canonical pitfall).
3. **A single hierarchy.** No multiple inheritance of state in Java.

Composition gives you:

1. **A small surface area.** You expose only what you choose to delegate.
2. **Substitutable internals.** Swap implementations through the interface boundary.
3. **Testability.** Inject a fake collaborator instead of patching a base class.

```java
// inheritance: brittle
public class TimedHashMap<K,V> extends HashMap<K,V> {
    private final Map<K, Instant> insertedAt = new HashMap<>();
    @Override public V put(K k, V v) {
        insertedAt.put(k, Instant.now());
        return super.put(k, v);
    }
}
// breaks the moment HashMap.putAll bypasses put()

// composition: explicit
public final class TimedMap<K,V> {
    private final Map<K, V>      data       = new HashMap<>();
    private final Map<K, Instant> insertedAt = new HashMap<>();
    public V put(K k, V v) { insertedAt.put(k, Instant.now()); return data.put(k, v); }
    ...
}
```

Inherit when you genuinely *are* a kind of the parent and the parent was designed to be extended (`Reader`, `AbstractList`, `AbstractMap`). Otherwise, compose.

---

## 11. Concurrency design starts at the class

Three rough categories for thread safety:

1. **Immutable** — safe to share across threads with no extra work. Aim here whenever possible.
2. **Confined** — instances are accessed from a single thread or actor only. Document loudly.
3. **Synchronized internally** — uses locks, `Atomic*`, `volatile`, or `java.util.concurrent` collections.

Each comes with rules at the class level:

- Immutable: every field `final`, every reachable object also immutable, no leaking `this` from constructor.
- Confined: don't pass `this` to async APIs, callbacks, or executors.
- Synchronized: pick **one** policy (intrinsic lock vs `ReentrantLock` vs lock-free). Mixing within the same class is how deadlocks happen.

The `@GuardedBy` annotation (or just a Javadoc convention) on each mutable field documents which lock protects it. Without that, every reader of the class has to reverse-engineer the policy.

---

## 12. API stability — every public class is a contract

Once a class is public and consumed outside your module, every detail becomes a maintenance commitment:

- Public field → caller code reads it. Removing it is a breaking change.
- Public constructor → callers `new` it. Adding required parameters breaks them.
- Public method → callers call it. Renaming, changing return type, throwing new checked exceptions: all breaking.
- Public class → callers may subclass it. Adding non-final methods that they could now override may change their behavior.

Defensive options for a stable surface:

- **Static factories** instead of public constructors → you can switch to a subtype later.
- **`final` classes** → subclassing isn't part of the contract.
- **Interfaces** for the API + package-private impls → free hand to refactor.
- **`sealed` types** → constrained extension within your module, none outside.

Library and SDK design lives or dies on these decisions. Application code can be looser, but the same principles apply at module boundaries.

---

## 13. Refactoring patterns at the class level

Recurring moves you'll do over and over:

| Smell                                            | Refactoring                                  |
|--------------------------------------------------|----------------------------------------------|
| 5+ primitive parameters travel together         | **Introduce parameter object** (a record)    |
| One class does X *and* Y                         | **Extract class**                            |
| Class accesses another's data more than its own  | **Move method**                              |
| Long `if/else` on a `String` or `int` field      | **Replace type code with class / sealed**    |
| Subclasses differ only by a constant             | **Replace subclass with field**              |
| Same fields appear in two unrelated classes      | **Pull up field to a shared type**           |
| Three constructors with overlapping parameters   | **Introduce builder** or static factories    |
| Method returns/accepts a tuple                   | **Define a value record**                    |

Refactoring is not a special activity. It is what you do every PR — the moment a class starts to violate one of these, fix it before it grows.

---

## 14. The senior checklist for any class you touch

1. Which archetype is it (value / entity / service)? Does the implementation match?
2. What invariants does it own? Are they enforced by every public method, including via aliasing?
3. Is `equals`/`hashCode` consistent with the archetype, and stable under any mutation?
4. Are constructors strict, no overridable calls, no leaking `this`?
5. Is the field set minimal — anything that can be derived, dropped?
6. Is mutability deliberately chosen and documented?
7. Is concurrency policy stated and consistent across the class?
8. Are public surface decisions (final, factory vs ctor, sealed, generics) intentional?
9. Could a record / enum / lambda / static method replace this class?
10. Has GC / object size been considered if this class is allocated in a hot path?

Senior class design is mostly **negative**: removing fields, removing setters, removing constructors, removing public surface — until what's left is the smallest object that still carries its invariant alone.
