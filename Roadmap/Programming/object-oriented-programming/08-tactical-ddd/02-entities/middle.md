# Entities — Middle

> **What?** The mechanics of running entities in real Java code: choosing an identity strategy (UUID vs surrogate vs natural key), writing correct `equals`/`hashCode` that survives ORM, mapping with JPA `@Entity`/`@Id`, and understanding the three lifecycle states Hibernate puts your entity through (transient, persistent, detached).
> **How?** By treating the id as the only stable thing about the object — equality, hashing, identity maps, and ORM caching all key off it — and by being deliberate about *when* the id exists (before persist? after persist? at construction?), because that decision shapes everything else.

---

## 1. Identity strategies — three choices, three trade-offs

### a. UUID (client-assigned)

```java
public class Customer {
    private final UUID id;
    public Customer() { this.id = UUID.randomUUID(); }
    public Customer(UUID id) { this.id = id; }
}
```

- **Pros:** id exists *at construction time* — no nulls, no "is this saved yet?", safe in `HashSet` immediately. Distributed-system friendly (no central allocator). Stable across databases (export/import keeps ids).
- **Cons:** 128 bits is larger than a `Long`. UUID v4 is random, which hurts B-tree index locality (writes scatter across the index). UUID v7 (time-ordered) fixes most of this.
- **Use when:** distributed creation, microservices, anywhere ids must be known before round-tripping to a DB.

### b. Database surrogate (auto-increment / sequence)

```java
@Entity
public class Customer {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;          // null until persist
}
```

- **Pros:** small (8 bytes), monotonically increasing → great index locality. Cheap to generate.
- **Cons:** id is `null` until the database assigns it — `equals`/`hashCode` get awkward (see §4). Can't move data between databases without renumbering. Coupling between domain and persistence.
- **Use when:** single-database monoliths, schemas that already use them, performance-critical OLTP.

### c. Natural key

```java
public class Book {
    private final Isbn isbn;       // "978-0-13-468599-1"
    public Book(Isbn isbn) { this.isbn = Objects.requireNonNull(isbn); }
}
```

- **Pros:** human-readable, no extra column, joins are obvious in queries.
- **Cons:** real-world identifiers *do change*. ISBNs get reassigned. National IDs get reissued. Email addresses become primary keys for users — then someone changes their email and every foreign key dangles. *"Natural keys are stable until they aren't."*
- **Use when:** you control the identifier and it's truly immutable (e.g., your own purchase-order numbers).

**Default for new systems:** UUID (v7 if possible). It avoids the entire "id is null" problem and keeps the domain ORM-independent.

---

## 2. `equals` and `hashCode` — the only safe pattern

For entities, both methods are based on the id, and *only* the id:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Customer that)) return false;
    return Objects.equals(this.id, that.id);
}

@Override
public int hashCode() {
    return Objects.hash(id);
}
```

Three rules to internalise:

1. **Never include mutable attributes** (email, status, balance) — they change, breaking `HashSet`/`HashMap` invariants.
2. **Never use the entire object** (Lombok's `@EqualsAndHashCode` without `onlyExplicitlyIncluded`) — same problem, magnified, and `@Data` on a JPA entity is a well-known landmine.
3. **Handle null id carefully** if you use database-assigned ids — two transient entities (`id == null`) are *not* equal to each other unless they're `this == o`. The standard fix:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Customer that)) return false;
    return id != null && id.equals(that.id);   // null id ≠ any other id
}
@Override
public int hashCode() {
    return 31;                                  // constant — see §4
}
```

The constant hashcode looks crazy but is correct: until you have an id, all transient entities should fall into the same hash bucket so they don't get "lost" when their id is finally assigned. Equality still uses `==` for the transient case.

---

## 3. JPA `@Entity` — the basic mapping

```java
import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "customers")
public class Customer {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "email", nullable = false)
    private String email;

    @Column(name = "full_name", nullable = false)
    private String fullName;

    @Version
    private long version;            // optimistic locking — see professional.md

    protected Customer() { }         // JPA needs no-arg constructor

    public Customer(UUID id, String email, String fullName) {
        this.id       = id;
        this.email    = email;
        this.fullName = fullName;
    }

    // getters, behaviour methods, equals/hashCode by id …
}
```

What each annotation means:

- `@Entity` — Hibernate manages this class; instances become rows.
- `@Table(name = ...)` — explicit table name; without it, defaults to the class name.
- `@Id` — this field is the primary key. Required exactly once.
- `@Column(updatable = false)` — once set, the id column will never be issued an UPDATE for. Belt-and-braces protection against accidental id mutation.
- `@Version` — optimistic locking marker; Hibernate increments on every flush.
- `protected Customer()` — JPA reflects on a no-arg constructor; `protected` is enough (it doesn't have to be `public`).

---

## 4. The transient/persistent/detached lifecycle

Hibernate puts your entity into one of four states. Knowing them is half the battle:

```
        new()                em.persist()           em.detach() or
   --------------------->  ------------------->   close session
   :     TRANSIENT      :  :   PERSISTENT     :   ------------>   DETACHED
   :  (not yet known    :  :  (managed by     :                  :  (known once,
   :   to Hibernate)    :  :   session, will  :                  :   no longer
   :                    :  :   be flushed)    :                  :   tracked)
        em.remove()                                                  em.merge()
   <----------------------------    REMOVED   <---------------------
```

| State        | Has DB row? | In persistence context? | id assigned? |
| ------------ | ----------- | ----------------------- | ------------ |
| Transient    | No          | No                      | Maybe (UUID) or no (IDENTITY) |
| Persistent   | Yes         | Yes                     | Yes          |
| Detached     | Yes         | No                      | Yes          |
| Removed      | Being deleted | Yes (until flush)    | Yes          |

```java
// Transient
Customer c = new Customer(UUID.randomUUID(), "alice@x.com", "Alice");

// Becomes persistent
em.persist(c);

// Modify while persistent — dirty checking will UPDATE on flush
c.changeEmail("alice@new.com");

// Becomes detached after the session closes
em.close();

// Re-attach by merge
Customer merged = newEm.merge(c);   // merged is persistent; c is still detached
```

The detached state is where many `equals`/`hashCode` bugs originate — see §6.

---

## 5. Behaviour-bearing entities (not anaemic)

A common rookie mistake is making JPA entities into plain data carriers with getters and setters everywhere. Eric Evans calls this the **anaemic domain model**. The fix is to push invariants into methods on the entity itself:

```java
@Entity
public class Account {
    @Id private UUID id;
    private Money balance;
    private Status status;

    // No public setter for balance — only behaviour methods
    public void deposit(Money amount) {
        if (status != Status.ACTIVE)        throw new IllegalStateException("Inactive");
        if (amount.isNegativeOrZero())      throw new IllegalArgumentException("Positive only");
        this.balance = this.balance.add(amount);
    }

    public void withdraw(Money amount) {
        if (status != Status.ACTIVE)        throw new IllegalStateException("Inactive");
        if (amount.isGreaterThan(balance))  throw new IllegalStateException("Insufficient");
        this.balance = this.balance.subtract(amount);
    }

    public void close() {
        if (!balance.isZero()) throw new IllegalStateException("Non-zero balance");
        this.status = Status.CLOSED;
    }
}
```

Notice: no `setBalance`. Outside code can't drop the balance to `-£1,000,000` by mistake. The Account is *the* place where money rules live.

---

## 6. Detached entities and the `HashSet` trap

```java
Set<Customer> seen = new HashSet<>();
Customer c = repo.findById(id);     // persistent, id != null
seen.add(c);

em.detach(c);                       // now detached — id unchanged
seen.contains(c);                   // still true: equals/hashCode keyed on id
```

This *works* — because identity-based equality keeps working across the lifecycle. Compare with the disaster you get if `equals` used `email`:

```java
seen.contains(c);                   // initially true
c.changeEmail("new@x.com");         // mutate
seen.contains(c);                   // now false — same object, new hash
seen.remove(c);                     // can't remove it either
```

This is why "identity, not attributes" matters so much for entities: the entity *survives* its own attribute changes.

---

## 7. Generated UUIDs vs database-allocated ids — practical chooser

```java
// Style A — UUID, no null id, no surprises
@Entity
public class Order {
    @Id
    private UUID id = UUID.randomUUID();   // assigned at construction
    // ...
}

// Style B — Long IDENTITY, null until persist
@Entity
public class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
}
```

Style A produces simpler equals/hashCode and lets you put new entities into sets immediately. Style B requires the constant-hash trick (§2) and is harder to test in isolation.

For new projects, lean Style A unless you have a strong reason (legacy schema, BIGINT-keyed reports, etc.) to pick B.

---

## 8. Mini-checklist — entity hygiene

- `id` field is final, or at least never reassigned after first set.
- `equals` and `hashCode` consult only `id`.
- No Lombok `@Data` on a JPA entity — it generates a recursive equals over all fields.
- A no-arg constructor exists (can be `protected`).
- Mutators are domain operations (`deposit`, `cancel`), not blind `setX`.
- The entity has at least one invariant it actively enforces in its own methods.
- The id is generated *outside* the database when possible (UUID).

---

**Memorize this:** an Entity's identity is the only stable thing about it, so equality and hashing must use the id and nothing else; everything else can change. Pick an id strategy deliberately — UUID for distributed and ORM-independent code, surrogate `Long` for legacy or perf-critical schemas, natural key only when it's truly immutable. Map with JPA `@Entity`/`@Id`, add `@Version` for optimistic locking, give the entity behaviour methods that enforce its invariants, and accept that Hibernate will move it through transient → persistent → detached states across its life. Get the equals/hashCode pair right once, and most of the rest follows. Vaughn Vernon (*Implementing DDD*, ch. 5) is the canonical reference.
