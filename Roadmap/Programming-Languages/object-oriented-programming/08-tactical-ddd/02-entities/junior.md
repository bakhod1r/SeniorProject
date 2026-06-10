# Entities — Junior

> **What?** An *Entity* is a domain object whose identity matters more than its attribute values. Two entities with the same name, address, and balance are still two different things — a `Customer` named "Alice" yesterday and a `Customer` named "Alice" today are the same person if they share the same `customerId`, even if her email and phone have changed in between.
> **How?** By giving the object an explicit identity field (`id`) and basing equality on that field — never on the rest of the state. Entities are *mutable through time*: attributes change, behaviour runs, lifecycle events happen, but the identity stays put. They live, they update, they retire — they don't get replaced.

---

## 1. The minimal Entity

```java
import java.util.Objects;
import java.util.UUID;

public class Customer {
    private final UUID id;          // identity — never changes
    private String email;           // attribute — can change
    private String fullName;        // attribute — can change

    public Customer(UUID id, String email, String fullName) {
        this.id       = Objects.requireNonNull(id);
        this.email    = Objects.requireNonNull(email);
        this.fullName = Objects.requireNonNull(fullName);
    }

    public UUID id()           { return id; }
    public String email()      { return email; }
    public String fullName()   { return fullName; }

    public void changeEmail(String newEmail) {
        this.email = Objects.requireNonNull(newEmail);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Customer that)) return false;
        return id.equals(that.id);              // identity only
    }

    @Override
    public int hashCode() {
        return id.hashCode();                   // identity only
    }
}
```

Two customer rows in the database with the same `id` are *the same customer* even if their emails differ. Two customer rows with different `id`s are *different customers* even if every other field matches.

---

## 2. Entity vs Value Object — the one-line contrast

| Aspect            | Value Object                     | Entity                                 |
| ----------------- | -------------------------------- | -------------------------------------- |
| Identity          | None — equal by all attributes   | Explicit `id` — equal by id only       |
| Mutability        | Immutable                        | Mutable through behaviour              |
| Replacement       | Replace whole object to "change" | Update in place, identity stays        |
| Examples          | `Money`, `Address`, `EmailAddr`  | `Customer`, `Order`, `Account`         |
| Lifecycle         | None — exists when constructed   | Created, updated, retired, archived    |

If you can ask "*which* one is this?" and the answer matters, it's an Entity. If only "*what* is this?" matters, it's a Value Object.

A bank account is an Entity — Alice's account #12345 is a specific account, distinguishable from Bob's even if both have a £0 balance and the same opening date. The £100 *balance itself* is a Value Object — every £100 note is equivalent to every other £100.

---

## 3. Why identity, not attributes, defines equality

```java
Customer alice = new Customer(UUID.fromString("aaaaaaaa-..."),
                              "alice@example.com",
                              "Alice Smith");

alice.changeEmail("alice@newjob.com");   // attribute changed
alice.changeEmail("alice.s@example.com"); // attribute changed again

// Is she still "the same Alice"? Yes — same UUID throughout.
```

If equality depended on `email`, then changing Alice's email would *destroy* the old Alice and *create* a new one. The HR system would think she'd resigned and a new hire arrived. The order history would be orphaned. The login session would break.

Entities exist because the real world has things that *persist through change*. People, accounts, contracts, vehicles, orders — they all change attributes while staying the same thing. Identity is the modelling tool that captures "same thing".

---

## 4. The `id` field — what goes in it

The id has two requirements: **uniqueness** (no two distinct entities ever share an id) and **stability** (the id never changes for the lifetime of the entity).

Three common choices for a junior to know:

```java
// 1. UUID — generated in code, no database round-trip needed
private final UUID id = UUID.randomUUID();

// 2. Database auto-increment — assigned by the database on insert
private Long id;                 // null until persisted, then stable

// 3. Natural key — a real-world identifier (passport number, ISBN)
private final String isbn;       // "978-0-13-468599-1" — never changes
```

Each has trade-offs you'll meet in `middle.md`. For now: use UUID by default if you're starting fresh; you avoid all the "id is null until save" headaches.

---

## 5. Entities have lifecycle

A Value Object pops into existence and is done. An Entity is *born*, *lives*, *acts*, and *retires*:

```java
Order o = Order.place(customerId, lineItems);     // born
o.addLineItem(extraItem);                          // lives — state changes
o.applyDiscount(promoCode);                        // acts
o.markPaid(paymentRef);                            // milestone
o.cancel(reason);                                  // retires (logically)
```

Each operation is a *method on the entity*, not a free function reaching in to mutate fields. The entity protects its own invariants (e.g., "a cancelled order cannot be marked paid"):

```java
public void markPaid(PaymentRef ref) {
    if (status == Status.CANCELLED) {
        throw new IllegalStateException("Cancelled orders cannot be paid");
    }
    this.paymentRef = ref;
    this.status     = Status.PAID;
}
```

This is the key behavioural difference: an entity *guards its own rules*. It's not a data bag; it's a thing that *knows what it's allowed to do*.

---

## 6. A second example — `Order`

```java
public class Order {
    private final OrderId id;
    private final CustomerId customerId;
    private final List<LineItem> items = new ArrayList<>();
    private Status status = Status.DRAFT;
    private Money total = Money.ZERO;

    public Order(OrderId id, CustomerId customerId) {
        this.id         = Objects.requireNonNull(id);
        this.customerId = Objects.requireNonNull(customerId);
    }

    public OrderId id() { return id; }

    public void addItem(LineItem item) {
        if (status != Status.DRAFT) {
            throw new IllegalStateException("Cannot edit non-draft order");
        }
        items.add(item);
        total = total.add(item.subtotal());
    }

    public void submit() {
        if (items.isEmpty()) {
            throw new IllegalStateException("Cannot submit empty order");
        }
        this.status = Status.SUBMITTED;
    }

    @Override public boolean equals(Object o) {
        return o instanceof Order other && id.equals(other.id);
    }
    @Override public int hashCode() { return id.hashCode(); }
}
```

Notice the pattern repeating: `id` is final, attributes are mutable, equality compares `id` only, methods enforce rules before mutating.

---

## 7. Storing entities in collections

Because equality is by id, `HashSet<Order>` and `Map<Order, …>` work as you expect — *as long as the id is set before the entity goes in.*

```java
Set<Order> orders = new HashSet<>();
Order o = new Order(new OrderId("O-001"), customerId);
orders.add(o);

o.addItem(item1);                  // mutates state
orders.contains(o);                // still true — id unchanged
```

The classic bug: putting an entity in a `HashSet` *before* its id is assigned, then assigning it, then trying to find it back. The set's stored hash uses the old (null/zero) id; the lookup hash uses the new id; the entity is "lost" inside the set it sits in. (You'll diagnose this in `find-bug.md`.)

---

## 8. Common shapes you'll see (preview)

| Shape                     | Where you'll meet it           |
| ------------------------- | ------------------------------ |
| `@Entity` JPA class       | Hibernate-mapped persistence    |
| Domain entity (POJO)      | Hexagonal domain layer          |
| Aggregate root entity     | Cluster of related entities     |
| Audit trail entity        | Append-only history records     |

For now, an Entity is just a plain Java class with an `id` field and identity-based equality. JPA, aggregates, repositories all build *on top of* this idea — covered in `middle.md`, `professional.md`, and the sibling `03-aggregates/` folder.

---

## 9. The litmus test

When designing a class, ask: *"If I built two of these with identical attributes, would they be the same thing or two different things?"*

- "*Two different things*" → Entity → give it an id, identity-based equality.
- "*The same thing*" → Value Object → no id, value-based equality (covered in `01-value-objects/`).

```java
// Two payments of £50 from Alice to Bob on 2026-01-15 — same thing or two things?
//   "Two things" — they're two distinct payment transactions → Entity (PaymentId).
//
// Two £50 notes — same thing or two things?
//   "Same thing" for accounting purposes → Value Object (Money).
```

This question, applied repeatedly to every domain concept, is most of what tactical DDD is — separating the world into entities (things with identity) and values (things without).

---

**Memorize this:** an Entity is a domain object with an explicit, stable identity (`id`) that *persists through state changes*. Its equality and hashcode are based on the id alone — never on its attributes. Entities are mutable, have lifecycle (created, updated, retired), and guard their own invariants through behaviour-bearing methods. The everyday examples — `Customer`, `Order`, `Account`, `Vehicle` — are all things you can distinguish from siblings even when they look identical, because each one *is* a specific one. Eric Evans (*Domain-Driven Design*, 2003) names them; Vaughn Vernon (*Implementing DDD*, 2013) shows how to wield them.
