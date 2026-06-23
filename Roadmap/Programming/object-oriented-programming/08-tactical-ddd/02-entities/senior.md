# Entities — Senior

> **What?** The edge cases of entities in production: when *Entity* is the wrong choice (and *Value Object* would have served better), how to design invariants that survive concurrent mutation, the ORM-leaking quirks of `equals`/`hashCode` for detached entities, lazy-loading traps that turn entity methods into N+1 disasters, and the architecture-scale question of whether a *domain entity* should be the same class as a *JPA entity*.
> **How?** By treating identity as a *first-class modelling decision* — not a side-effect of "everything in the database needs a primary key" — and by recognising that the JPA persistence model and the domain model serve different masters; sometimes one class can wear both hats, sometimes you need two.

---

## 1. Entity vs Value Object — the senior-level decision

Eric Evans's heuristic ("identity matters → Entity") is correct but underspecified. The deeper question is *who else cares about this thing's identity?* — because identity is meaningful only across some boundary of reference.

```java
// Order has identity — referenced by Payment, Refund, Shipment, audit logs ...
public class Order { private final OrderId id; ... }

// LineItem on an Order — does identity matter?
// → If it's referenced from outside the Order (returned in isolation, audited
//   independently, edited concurrently), it's an Entity.
// → If it lives and dies with its parent Order and is never referenced from
//   outside, model it as a Value Object: Order changes its list of LineItems
//   by replacing the list, not by mutating items in place.
```

This is the *aggregate boundary question* in disguise — covered fully in `03-aggregates/`. The senior insight: **defaulting everything to Entity is a smell**. Many things people instinctively model as entities (line items, address lines, audit details) are values inside a parent aggregate. Promoting them to entities costs you ids, repositories, lifecycle, and concurrency design — for no gain.

**Default Value Object; promote to Entity only when identity has a concrete consumer.**

---

## 2. Identity strategies — the trade-off matrix you actually need

| Strategy             | Generated where? | Visible before persist? | Index locality | Migration safety | Notes |
| -------------------- | ---------------- | ----------------------- | -------------- | ---------------- | ----- |
| UUID v4 (random)     | App              | Yes                     | Poor (random)  | Excellent        | Default for distributed systems |
| UUID v7 (time-sortable) | App           | Yes                     | Good           | Excellent        | Best of both, JDK 21+ libs |
| Auto-increment Long  | DB               | No (null until flush)   | Excellent      | Painful (renumbering on import) | Single-DB monoliths |
| Sequence Long        | DB               | Yes (allocator pre-fetch) | Excellent    | Painful          | Postgres, Oracle |
| Natural key          | World            | Yes                     | Variable       | Excellent until the world changes | Avoid unless truly immutable |
| Composite key        | DB or app        | Yes                     | Variable       | Painful          | Legacy schemas; needs `@IdClass` or `@EmbeddedId` |

A senior code base usually settles on **one** strategy and applies it everywhere. Mixing UUID and `Long` ids across entities makes every cross-entity join awkward and every test fixture inconsistent.

The honest UUID v7 line: it gives you index locality close to a serial column while keeping the "id at construction" property. If your stack supports it (Hibernate 6.2+, Java's `UUIDv7Generator`, libraries like `uuid-creator`), it's the modern default.

---

## 3. Invariants — what an Entity is *for*

An anaemic entity is a glorified row. A real entity is a *guard* over its own state — it accepts behaviour calls and either applies them (state changes legally) or refuses them (throws). The invariants are what make the type *trustworthy*: any caller that holds an instance can rely on it being in a valid state.

```java
public class BankAccount {
    private final AccountId id;
    private Money balance;
    private Status status;
    private List<Transaction> recent = new ArrayList<>();

    // Invariants this class enforces:
    //   1. balance is never negative (for non-credit accounts)
    //   2. status transitions only ACTIVE → FROZEN → CLOSED
    //   3. closed account → no further transactions
    //   4. recent transactions list is at most 100 (older purged)

    public void debit(Money amount, TransactionReason reason) {
        requireActive();
        if (amount.isGreaterThan(balance)) {
            throw new InsufficientFundsException(id, balance, amount);
        }
        balance = balance.subtract(amount);
        record(new Transaction(TransactionType.DEBIT, amount, reason, Instant.now()));
    }

    public void freeze(FreezeReason reason) {
        if (status != Status.ACTIVE) {
            throw new IllegalStateException("Only active accounts can be frozen");
        }
        this.status = Status.FROZEN;
        record(new Transaction(TransactionType.FREEZE, Money.ZERO, reason, Instant.now()));
    }

    private void requireActive() {
        if (status != Status.ACTIVE) {
            throw new IllegalStateException("Account not active: " + status);
        }
    }

    private void record(Transaction t) {
        recent.add(t);
        if (recent.size() > 100) recent.remove(0);
    }
}
```

The senior-level point: the *list of invariants the entity guards* is **part of its public contract** even though it's not in the method signatures. Document them at the class level. Test them. When a new requirement arrives, the question "does it fit the invariants or does it violate them?" is answerable.

---

## 4. `equals` / `hashCode` for detached entities — the real story

The middle-level pattern (`hashCode = constant` while id is null) works, but a senior should know *why* the alternatives fail:

```java
// VARIANT A — return id.hashCode() when id != null, else super.hashCode()
@Override public int hashCode() {
    return id != null ? id.hashCode() : super.hashCode();
}
// Problem: an entity put in HashSet when transient ends up in bucket A;
// after persist, id is assigned and hashCode shifts to bucket B;
// HashSet.contains(c) now returns false even though c is still in the set.
// Classic "lost in the set" bug.

// VARIANT B — return a constant when id == null
@Override public int hashCode() {
    return id != null ? id.hashCode() : 31;
}
// Problem: all transient entities land in one bucket — but that's OK if
// the set has only a handful of them at once.

// VARIANT C — return a constant always (recommended by Vlad Mihalcea)
@Override public int hashCode() {
    return getClass().hashCode();
}
// Problem: hashing degrades to O(n) inside a HashSet of one entity type.
// Acceptable for entities you rarely put in big hash structures.
```

Variant B is the pragmatic winner for most teams. Variant C is correct under JPA's spec but slow at scale. The deeper answer: **don't put transient entities in large hash collections in the first place** — work with persisted entities (id assigned) or use UUIDs (id assigned at construction).

This whole problem evaporates if you choose UUID over `IDENTITY`.

---

## 5. ORM lazy-loading pitfalls

A field declared `@OneToMany(fetch = LAZY)` is a proxy until first accessed. Three traps:

### a. `toString` triggering loads

```java
@Override
public String toString() {
    return "Order{id=" + id + ", items=" + items + "}";   // <-- items lazy-loaded
}
```

Logging an Order now silently issues an extra SELECT for line items. Multiply by 1,000 orders in a list page → N+1.

**Fix:** in `toString`, dereference only the id and primitive fields:

```java
@Override public String toString() { return "Order[id=" + id + "]"; }
```

### b. `LazyInitializationException` on detached entities

```java
Order o = repo.findById(id);    // persistent
em.close();                     // detached
o.getItems().forEach(...);      // BOOM — proxy can't load, session is gone
```

**Fix:** explicit fetch joins (`JOIN FETCH`), entity graphs, or DTO projections at the boundary. Never let the controller call lazy associations on a detached entity.

### c. `equals` on a proxy

```java
Order proxy = em.getReference(Order.class, id);  // proxy, not loaded
proxy.equals(realOrder);                          // works if you used id-based equals
proxy.getClass() == Order.class;                  // false — it's an enhanced subclass
```

**Fix:** in `equals`, prefer `instanceof` over `getClass() ==`, *and* unwrap with `Hibernate.unproxy()` if you must compare classes:

```java
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Order)) return false;
    Order that = (Order) Hibernate.unproxy(o);
    return id != null && id.equals(that.id);
}
```

---

## 6. Domain entity vs JPA entity — same class or two?

Two schools of thought:

**Single class.** The domain entity *is* the JPA entity. One file, one mapping, fewer translations. Works well when the domain isn't strict about ORM-free purity and the team is small.

```java
@Entity public class Order { ... }   // both domain model and persistence model
```

**Two classes (mapper between).** A pure POJO `Order` lives in `domain/`, a `OrderRecord` lives in `infrastructure/persistence/` with JPA annotations, and a mapper translates. Used by teams pursuing hexagonal architecture strictly.

```java
package shop.domain;
public final class Order { /* no JPA, no Hibernate, JDK only */ }

package shop.infrastructure.persistence;
@Entity public class OrderRecord { /* JPA-annotated, mirror of Order */ }

public final class OrderMapper { /* Order ⇄ OrderRecord */ }
```

- Single-class pros: fewer files, no mapper drift, fewer tests duplicated.
- Two-class pros: domain is testable without a database, you can swap JPA for jOOQ or MyBatis without touching domain code, design discussions don't get bogged down in `@JoinColumn`.

The senior judgement: **start single-class** unless you already know you'll swap persistence or you have a large team that needs the boundary enforced. Splitting later when you actually need it is cheap; carrying a duplicate model from day one is expensive.

---

## 7. Concurrent mutation — optimistic vs pessimistic

Two transactions both load the same `Account`, both call `debit(100)`, both write. Without protection, the last write wins, and the entity now reflects only one of the two debits.

**Optimistic locking** (`@Version`) — Hibernate adds `WHERE version = ?` to UPDATE; the second transaction sees zero rows updated and throws `OptimisticLockException`. Cheap, no DB locks held; assumes conflicts are rare.

**Pessimistic locking** — `em.find(Account.class, id, LockModeType.PESSIMISTIC_WRITE)` issues `SELECT … FOR UPDATE`. Second reader blocks. Expensive, but the right call when conflicts are frequent (high-traffic accounts).

```java
@Entity
public class Account {
    @Id private UUID id;
    @Version private long version;          // optimistic
    private Money balance;
}

// pessimistic at query time
Account a = em.find(Account.class, id, LockModeType.PESSIMISTIC_WRITE);
a.debit(amount, reason);
em.flush();
```

**Rule of thumb:** start optimistic; escalate to pessimistic only for hotspots backed by metrics.

---

## 8. Entities, repositories, and aggregate boundaries

An entity rarely lives alone. It usually sits inside an *aggregate* — a cluster of entities and value objects with one *root* through which all access flows. The root is the only thing repositories load and save; non-root entities are reached via the root.

```java
// Order is the aggregate root; LineItem is an internal entity (or VO)
public class Order {
    private final OrderId id;
    private final List<LineItem> items = new ArrayList<>();

    public void addItem(ProductId p, int qty, Money price) {
        // outside code never gets a LineItem reference — only the root mediates
        items.add(new LineItem(p, qty, price));
    }
}

public interface OrderRepository {
    Optional<Order> find(OrderId id);
    void save(Order o);
    // NO findLineItem(...) — line items are accessed via the order
}
```

The senior rule: **repositories work in aggregate roots, not in every entity**. A repository per entity is a code smell that betrays missing aggregate design. Covered in detail in `03-aggregates/` and `04-repository-concept/`.

---

## 9. Quick rules

- Default Value Object; promote to Entity only when identity has external consumers.
- One id strategy per codebase. UUID v7 is the modern default; auto-increment `Long` for legacy.
- `equals`/`hashCode` use `id` *only*. Constant hashcode while id is null; never include mutable fields.
- Behaviour goes on the entity, not in services. Invariants live in methods.
- `toString` dereferences only primitive fields and id — never lazy associations.
- `@Version` by default on every entity that gets updated; escalate to pessimistic locks for proven hotspots.
- Don't make every entity a repository target — load via aggregate roots.
- Single-class domain/JPA entity is fine to start; split into two classes only when you have evidence you need the boundary.
- Detached entities are normal in web/REST flows — your `equals`/`hashCode` must survive detach/merge cycles.
- N+1 from entity methods (`toString`, `equals` on lazy children) is the most common production bug pattern.

---

## 10. What's next

| Topic                                                                    | File              |
| ------------------------------------------------------------------------ | ----------------- |
| JPA deep dive: `@GeneratedValue` strategies, `@Version`, soft delete     | `professional.md`  |
| Formal Entity contract — stable id, equality-by-id, invariant guards     | `specification.md` |
| 10 entity bugs you will write at least once                              | `find-bug.md`      |
| Hibernate caches, dirty checking, N+1, hashcode stability                | `optimize.md`      |
| 8 hands-on exercises with validation                                     | `tasks.md`         |
| 20 Q&A typical of senior-level interviews                                | `interview.md`     |
| Value Objects — the immutable partner of every Entity                    | `../01-value-objects/` |
| Aggregates — clusters of entities with one root                          | `../03-aggregates/` |
| Repositories — collection-like access to aggregate roots                 | `../04-repository-concept/` |

---

**Memorize this:** an Entity is a *guarded* domain object whose identity outlives every attribute it carries — but it earns the cost of identity (id strategy, repositories, lifecycle, locking) only when something *outside it* needs to reference it by id. Default Value Object, promote on evidence. Get equals/hashCode by id right once. Push invariants into methods so the type is trustworthy. Choose your id strategy once and apply it everywhere. Lazy loading and detached state are not bugs — they are facts of life that your `equals`, `toString`, and `equals/hashCode` must survive. Eric Evans gave us the concept; Vaughn Vernon (*Implementing DDD*, 2013) and Vlad Mihalcea (*High-Performance Java Persistence*, 2016) gave us the production playbook.
