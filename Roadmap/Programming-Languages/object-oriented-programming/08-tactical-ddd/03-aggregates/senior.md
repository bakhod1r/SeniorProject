# DDD Tactical: Aggregates — Senior

> **What?** The senior view of aggregate design is anchored in Vaughn Vernon's *Effective Aggregate Design* (a three-part essay, 2011, later integrated into *Implementing Domain-Driven Design*, 2013). Vernon distilled the principle into four hard rules: protect invariants inside aggregates, design small aggregates, reference other aggregates by identity, update other aggregates with eventual consistency. Add concurrency control (`@Version`) and you have the operating manual for production-grade aggregates.
> **How?** Apply Vernon's rules in order. Rule 1 tells you the *purpose* of the boundary. Rule 2 keeps the cost manageable. Rule 3 enforces decoupling between aggregates. Rule 4 wires them back together asynchronously. Then add optimistic locking so concurrent writers can't silently corrupt the cluster.

---

## 1. Rule 1 — Protect invariants inside the aggregate boundary

The whole reason an aggregate exists is to *enforce a set of invariants*. The boundary contains exactly the state needed to evaluate those rules, and the root is the only mutator. Outside the boundary, the rule can be eventually consistent; inside, it must hold after every commit.

```java
public class Order {
    private OrderStatus status;
    private final List<LineItem> items = new ArrayList<>();
    private Money total = Money.zero(Currency.USD);

    public void addItem(ProductId pid, int qty, Money unitPrice) {
        requireDraft();                                            // invariant
        if (items.size() >= 50) throw new DomainException("max 50 items");
        var item = new LineItem(pid, qty, unitPrice);
        var next = total.add(item.subtotal());
        if (next.greaterThan(Money.of("USD", 100_000)))
            throw new DomainException("total cap exceeded");
        items.add(item);
        total = next;
    }

    private void requireDraft() {
        if (status != OrderStatus.DRAFT)
            throw new DomainException("Order is not DRAFT");
    }
}
```

If a candidate invariant can't be expressed using only fields of `Order` and its children, it doesn't belong here. It's either a different aggregate's concern or a cross-aggregate concern enforced via events (Rule 4).

---

## 2. Rule 2 — Design small aggregates

Large aggregates are the most common DDD anti-pattern. They look "natural" — *all orders for a customer* — but they:

- Load more data per request, including parts the use case doesn't need.
- Have more concurrent-write contention (more fields → more updaters → more `OptimisticLockException`).
- Are harder to test (more setup, more mocks).
- Defeat the purpose of the aggregate, which is to be a small consistency unit.

A *good* aggregate is typically a root entity plus a handful of value objects, or a root entity with a small collection of child entities. If you see a `List<Customer>` inside an aggregate, you almost certainly have the boundary wrong.

```java
// BAD — one Customer aggregate that holds all orders
public class Customer {
    private List<Order> orders = new ArrayList<>();   // unbounded growth, heavy load
}

// GOOD — two aggregates linked by id
public class Customer { /* customer data */ }
public class Order { private final CustomerId customerId; }
```

Rule of thumb: an aggregate's storage footprint should fit comfortably in memory, and you should be willing to load the *whole* aggregate on every command that touches it. If "load the whole thing" feels expensive, the aggregate is too big.

---

## 3. Rule 3 — Reference other aggregates by identity

Inside an aggregate, you have direct object references (root → child). Across aggregates, you have **id references only**.

```java
public class Order {
    private final OrderId id;
    private final CustomerId customerId;     // id, not Customer
    private final List<LineItem> items;       // internal — object refs OK
}
```

In JPA, this means avoiding `@ManyToOne Customer customer`. Persist a `UUID customerId` column or embed a `CustomerId` value object.

Why it matters:

- **Decoupling lifecycles.** `Customer` and `Order` can be loaded, edited, and persisted independently. Their lifecycles don't tangle.
- **Avoiding accidental joint transactions.** With an object reference, it's tempting to do `order.getCustomer().setEmail(...)`. With an id reference, that mutation is structurally impossible from inside the order code path.
- **Scalability.** Aggregates referenced by id can be split across databases, services, or bounded contexts without rewriting models.

If you need data from another aggregate when working with this one, the application layer loads it explicitly — that's a feature, not a bug.

---

## 4. Rule 4 — Update other aggregates with eventual consistency

Inside an aggregate: transactional consistency (commits atomically). Across aggregates: **eventual consistency** via domain events.

```java
public class Order {
    private final List<DomainEvent> events = new ArrayList<>();

    public void place() {
        if (status != OrderStatus.DRAFT)
            throw new DomainException("Cannot place a non-draft order");
        if (items.isEmpty())
            throw new DomainException("Cannot place an empty order");
        status = OrderStatus.PLACED;
        events.add(new OrderPlacedEvent(id, customerId, total, Instant.now()));
    }

    public List<DomainEvent> pullEvents() {
        var copy = List.copyOf(events);
        events.clear();
        return copy;
    }
}
```

The application service saves the aggregate, then publishes the events:

```java
@Transactional
public void placeOrder(OrderId id) {
    Order order = orders.findById(id).orElseThrow();
    order.place();
    orders.save(order);
    publisher.publishAll(order.pullEvents());   // outside aggregate, after save
}
```

A handler in *another* bounded context (or another aggregate's update path) reacts:

```java
public class InventoryEventHandler {
    @TransactionalEventListener
    public void on(OrderPlacedEvent e) {
        Inventory inv = inventories.findByProduct(e.firstProductId()).orElseThrow();
        inv.reserve(e.firstQuantity());
        inventories.save(inv);
    }
}
```

The order is saved first, the inventory is updated second, in its own transaction. There's a window — milliseconds typically — where the order is placed but the inventory hasn't reserved yet. That window is acceptable for the inventory rule; if it isn't, the rule belongs inside the order aggregate (and you need to merge them).

**The crucial trade-off:** giving up immediate consistency between aggregates buys you small aggregates, no joint transactions, and independent scaling. Vernon's argument throughout *Effective Aggregate Design* is that *most* cross-aggregate rules tolerate a few seconds of staleness, and refusing to admit this is the root cause of overgrown aggregates.

---

## 5. Concurrency control: `@Version`

When two requests load the same aggregate, modify it, and save concurrently, the second save would overwrite the first — silent data loss. **Optimistic locking** with `@Version` prevents this.

```java
@Entity
public class Order {
    @Id
    private UUID id;

    @Version
    private long version;       // JPA increments on every persist

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<LineItem> items = new ArrayList<>();
}
```

JPA appends `WHERE version = ?` to every UPDATE. If another transaction has already incremented it, this UPDATE matches zero rows and JPA throws `OptimisticLockException`. The caller retries (re-reads, re-applies the command, saves).

```java
@Retryable(value = OptimisticLockException.class, maxAttempts = 3, backoff = @Backoff(delay = 50))
@Transactional
public void addItem(OrderId id, ProductId pid, int qty, Money price) {
    Order order = orders.findById(id).orElseThrow();
    order.addItem(pid, qty, price);
    orders.save(order);
}
```

Pessimistic locking (`SELECT ... FOR UPDATE`) is an alternative when contention is high and retries waste work — but it serialises access to the aggregate and hurts throughput. Default to optimistic; reach for pessimistic only when measured contention demands it.

---

## 6. Aggregates and CAP

A single aggregate, locked in one transaction, gives you CP (consistent + partition-tolerant; availability suffers during partition because the database refuses to commit). Across aggregates, by choosing eventual consistency, you trade C for A — the system stays available even when aggregates can't all be reached simultaneously. Vernon's four rules are, in CAP terms, a deliberate "C inside the boundary, A across boundaries" choice.

---

## 7. Common senior-level mistakes

**Mistake 1 — Aggregate "by team ownership".**
Teams sometimes draw aggregate boundaries to match org charts. Aggregates are *invariant* boundaries, not *ownership* boundaries. Two teams can own the same aggregate. One team can own three aggregates.

**Mistake 2 — Using @ManyToOne to other aggregates.**
The moment you write `@ManyToOne Customer customer` on `Order`, Hibernate will happily traverse the customer and even cascade saves. You've collapsed two aggregates into one. Use id-only references and load the other aggregate via its own repository.

**Mistake 3 — Loading the aggregate piecemeal.**
"I only need the order header, not the line items." That's a *read model* concern, not an aggregate concern. The aggregate is the unit of *write*. For read-side display, build dedicated read models / projections (CQRS). Loading a half-aggregate to mutate it is a bug.

**Mistake 4 — Events as a hidden synchronous coupling.**
If your "domain event" handler is `@TransactionalEventListener(phase = BEFORE_COMMIT)` and synchronously updates another aggregate, you've recreated a multi-aggregate transaction. Use `AFTER_COMMIT`, or publish to a real message bus.

**Mistake 5 — Ignoring version conflicts.**
A try/catch that swallows `OptimisticLockException` is data corruption disguised as resilience. Always retry the *whole command* — re-read, re-apply, re-save.

---

## 8. Quick rules

- [ ] **Inside the boundary:** transactional consistency. **Across the boundary:** eventual consistency.
- [ ] One aggregate per transaction. No exceptions in normal flow.
- [ ] Other aggregates are referenced by id only. No `@ManyToOne` across boundaries.
- [ ] Default to small aggregates; merge only when you find an invariant you can't enforce otherwise.
- [ ] Use `@Version` for optimistic locking on every aggregate root.
- [ ] Domain events leave the aggregate; the application layer publishes them post-commit.
- [ ] Retry on `OptimisticLockException` — never swallow it.

---

## 9. What's next

| Topic                                                                       | File                          |
| --------------------------------------------------------------------------- | ----------------------------- |
| Repositories, JPA persistence, event sourcing, snapshots                    | `professional.md`             |
| Formal aggregate contract                                                   | `specification.md`            |
| Aggregate bugs and diagnoses                                                | `find-bug.md`                 |
| Aggregate cost model, fetch graphs, snapshots                               | `optimize.md`                 |
| Hands-on exercises                                                          | `tasks.md`                    |
| Interview Q&A                                                               | `interview.md`                |
| Entities                                                                    | `../01-entities/`             |
| Value objects                                                               | `../02-value-objects/`        |
| Repository concept                                                          | `../04-repository-concept/`   |
| Domain services                                                             | `../05-domain-services/`      |

---

**Memorize this:** Vernon's four rules: (1) invariants live inside the boundary; (2) keep aggregates small; (3) reference other aggregates by id; (4) update other aggregates with eventual consistency. Add `@Version` for optimistic locking, publish domain events after commit, and retry on conflict. Inside the boundary you're CP; across boundaries you're AP — that trade-off is the entire point of the pattern.
