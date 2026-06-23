# DDD Tactical: Aggregates — Professional

> **What?** Professional aggregate work is about **persistence and infrastructure**: one repository per aggregate, JPA mappings that respect aggregate boundaries (`@OneToMany(cascade = ALL, orphanRemoval = true)`), optimistic locking (`@Version`), event sourcing where appropriate, snapshot strategies for long-lived aggregates, and command/query separation (CQRS) so reads don't deform write-side designs. The architectural backbone is Eric Evans (*DDD*, 2003), Vaughn Vernon (*Implementing Domain-Driven Design*, 2013, especially Ch. 10 and the *Effective Aggregate Design* essay), and Greg Young's CQRS / event-sourcing writing.
> **How?** Pin one repository to one aggregate root. Map persistence so the aggregate loads and saves as a unit. Pick storage strategy per aggregate: classic CRUD with JPA for most, event sourcing for high-history aggregates, snapshots when replays grow expensive. Keep reads on a separate, denormalised model.

---

## 1. One repository per aggregate root

The repository abstraction (covered in depth in `../04-repository-concept/`) gives the illusion of a collection of aggregates. Each aggregate root gets exactly one repository; child entities never get their own.

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
    void delete(OrderId id);
}
```

There is *no* `LineItemRepository`. You retrieve line items by going through the order:

```java
Order order = orderRepository.findById(orderId).orElseThrow();
List<LineItem> items = order.items();
```

If you ever feel the urge to write a child-entity repository, the child is probably a root in disguise — bump it out into its own aggregate.

---

## 2. JPA mapping that respects the boundary

A clean JPA mapping for the `Order` aggregate:

```java
@Entity
@Table(name = "orders")
public class Order {

    @EmbeddedId
    private OrderId id;

    @Embedded
    private CustomerId customerId;          // ID reference to another aggregate

    @Enumerated(EnumType.STRING)
    private OrderStatus status;

    @Version
    private long version;                   // optimistic locking

    @Embedded
    private Address shippingAddress;

    @OneToMany(
        mappedBy = "order",
        cascade = CascadeType.ALL,
        orphanRemoval = true,
        fetch = FetchType.LAZY
    )
    private List<LineItem> items = new ArrayList<>();

    protected Order() {}                    // JPA only

    public Order(OrderId id, CustomerId customerId, Address shippingAddress) {
        this.id = id;
        this.customerId = customerId;
        this.shippingAddress = shippingAddress;
        this.status = OrderStatus.DRAFT;
    }
    // ... methods from senior.md
}

@Entity
@Table(name = "order_line_items")
public class LineItem {

    @EmbeddedId
    private LineItemId id;

    @ManyToOne
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;                    // back-reference to root (within aggregate, OK)

    @Embedded
    private ProductId productId;

    private int quantity;

    @Embedded
    private Money unitPrice;

    protected LineItem() {}                 // JPA only
    LineItem(Order order, ProductId pid, int qty, Money price) {  // package-private
        this.id = LineItemId.newId();
        this.order = order;
        this.productId = pid;
        this.quantity = qty;
        this.unitPrice = price;
    }
}
```

Key choices:

- **`cascade = ALL, orphanRemoval = true`** — saving the order saves the line items, deleting an item from the list removes its row. The aggregate is the unit of persistence.
- **`fetch = LAZY`** — the order header loads alone; line items load on access. Combine with an explicit `EntityGraph` for command paths that need everything.
- **`@Version`** — every save bumps version, blocking concurrent overwrites.
- **`@ManyToOne` back-reference inside the aggregate** — this is fine; it's a within-aggregate link, not a cross-aggregate one.

**Cross-aggregate reference**: `CustomerId` is `@Embedded`, *not* `@ManyToOne Customer`. The persistence model mirrors the domain rule.

---

## 3. Loading the whole aggregate in one query

`LAZY` collections risk N+1 queries. For command handlers that need the full aggregate, use an entity graph:

```java
public interface OrderRepository extends JpaRepository<Order, OrderId> {

    @EntityGraph(attributePaths = {"items"})
    @Query("select o from Order o where o.id = :id")
    Optional<Order> findFullById(@Param("id") OrderId id);
}
```

This forces one SQL with a join. For larger aggregates, consider `@BatchSize(size = 100)` on the collection to avoid per-row roundtrips when iterating multiple aggregates.

---

## 4. Optimistic locking in practice

`@Version` raises `OptimisticLockException` on conflict. The application layer retries the *command*, not the save:

```java
@Service
public class OrderApplicationService {

    private final OrderRepository orders;

    @Retryable(
        retryFor = OptimisticLockException.class,
        maxAttempts = 3,
        backoff = @Backoff(delay = 50, multiplier = 2)
    )
    @Transactional
    public void addItem(OrderId id, ProductId pid, int qty, Money price) {
        Order order = orders.findFullById(id).orElseThrow();
        order.addItem(pid, qty, price);
        orders.save(order);
    }
}
```

If conflicts dominate (measured, not guessed), switch to pessimistic locking:

```java
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("select o from Order o where o.id = :id")
Optional<Order> findByIdForUpdate(@Param("id") OrderId id);
```

Pessimistic locking serialises access — fewer retries, lower throughput. Use it only where the math works out.

---

## 5. Event sourcing as an alternative persistence model

Instead of storing the *current state* of the aggregate, event sourcing stores the *sequence of events* that produced it. The aggregate is rehydrated by replaying its events.

```java
public class Order {
    private OrderId id;
    private OrderStatus status;
    private final List<LineItem> items = new ArrayList<>();

    private final List<DomainEvent> pendingEvents = new ArrayList<>();
    private long version = 0;

    public static Order createNew(OrderId id, CustomerId customerId) {
        var order = new Order();
        order.apply(new OrderCreatedEvent(id, customerId));
        return order;
    }

    public void addItem(ProductId pid, int qty, Money price) {
        if (status != OrderStatus.DRAFT) throw new DomainException("not draft");
        apply(new ItemAddedEvent(id, pid, qty, price));
    }

    private void apply(DomainEvent event) {
        mutate(event);
        pendingEvents.add(event);
        version++;
    }

    public void rehydrateFrom(List<DomainEvent> history) {
        for (DomainEvent e : history) {
            mutate(e);
            version++;
        }
    }

    private void mutate(DomainEvent e) {
        switch (e) {
            case OrderCreatedEvent oc -> { this.id = oc.id(); this.status = OrderStatus.DRAFT; }
            case ItemAddedEvent ia    -> items.add(new LineItem(ia.productId(), ia.quantity(), ia.unitPrice()));
            default -> throw new IllegalStateException("unknown event " + e);
        }
    }
}
```

The repository writes the *new* events and reads the *history*:

```java
public class EventSourcedOrderRepository implements OrderRepository {
    private final EventStore store;

    public Optional<Order> findById(OrderId id) {
        var history = store.loadEvents(id.value());
        if (history.isEmpty()) return Optional.empty();
        var order = new Order();
        order.rehydrateFrom(history);
        return Optional.of(order);
    }

    public void save(Order order) {
        store.appendEvents(order.id().value(), order.pendingEvents(), order.expectedVersion());
    }
}
```

Trade-offs:

- **Pro:** complete audit history, ability to rebuild read models from scratch, naturally supports temporal queries.
- **Con:** replays grow O(events) — use snapshots. More moving parts. Schema changes mean event versioning.

Event sourcing is most useful for aggregates with rich history (orders, accounts, conversations) and least useful for aggregates that are mostly snapshots of current state (user profiles, configuration).

---

## 6. Snapshots for long-lived aggregates

When an event-sourced aggregate accumulates thousands of events, replaying from scratch becomes slow. Snapshot strategies cache the rehydrated state periodically.

```java
public Optional<Order> findById(OrderId id) {
    Optional<Snapshot> snap = snapshotStore.latest(id.value());
    long startVersion = snap.map(Snapshot::version).orElse(0L);
    var history = store.loadEventsSince(id.value(), startVersion);
    var order = snap.map(s -> Order.fromSnapshot(s)).orElseGet(Order::new);
    order.rehydrateFrom(history);
    return Optional.of(order);
}
```

Strategies:

1. **Periodic** — every N events (e.g., 100), save a snapshot.
2. **Time-based** — every M minutes during idle periods.
3. **On-demand** — when a query notices a long replay, persist the result as a snapshot.

For CRUD-persisted aggregates, the equivalent is *the current row in the table* — JPA already gives you a "permanent snapshot". Snapshots only matter when you've chosen event sourcing.

---

## 7. Command/query separation (CQRS)

Aggregate roots are optimised for *commands* (writes) — they enforce invariants, they're loaded as a whole, they're small. Reads, especially list / dashboard views, want denormalised projections, joins, and shape-fitted DTOs.

The CQRS pattern says: *don't read through your aggregates*. Maintain a separate read model.

```java
// Write side
@Service
public class PlaceOrderHandler {
    public void handle(PlaceOrderCommand cmd) {
        Order order = orders.findById(cmd.orderId()).orElseThrow();
        order.place();
        orders.save(order);
        publisher.publishAll(order.pullEvents());
    }
}

// Read side
@Service
public class OrderQueryService {
    private final JdbcTemplate jdbc;
    public List<OrderListRow> listOrdersForCustomer(CustomerId id) {
        return jdbc.query(
            "SELECT id, status, total_cents, placed_at FROM order_list_view WHERE customer_id = ?",
            (rs, n) -> new OrderListRow(...),
            id.value());
    }
}
```

Benefits:

- Aggregates stay focused on writes; they don't need fields just for display.
- Reads can use raw SQL, joins, materialised views — whatever is fastest.
- Read models can be rebuilt from events (event sourcing) or maintained via change-data-capture (CRUD).

Pitfall: CQRS is *not* required for every aggregate. Small systems can read through repositories. Reach for CQRS when read shape and write shape genuinely diverge.

---

## 8. Quick rules

- [ ] One repository per aggregate root. No child-entity repositories.
- [ ] `@OneToMany(cascade = ALL, orphanRemoval = true)` for child entities inside the aggregate.
- [ ] Cross-aggregate links: id-only (`@Embedded` value object), never `@ManyToOne`.
- [ ] `@Version` on every aggregate root.
- [ ] Default to LAZY collections; load aggressively with `@EntityGraph` when the command needs the whole aggregate.
- [ ] Pick storage per aggregate: CRUD for most, event sourcing for history-heavy.
- [ ] Use snapshots when replay cost grows; CQRS when read and write shapes diverge.
- [ ] Retry commands on `OptimisticLockException`; pessimistic lock only when measured contention demands it.

---

## 9. What's next

| Topic                                                | File                          |
| ---------------------------------------------------- | ----------------------------- |
| Formal aggregate contract                            | `specification.md`            |
| Aggregate bugs                                       | `find-bug.md`                 |
| Cost models                                          | `optimize.md`                 |
| Hands-on exercises                                   | `tasks.md`                    |
| Interview Q&A                                        | `interview.md`                |
| Entities                                             | `../01-entities/`             |
| Value objects                                        | `../02-value-objects/`        |
| Repository concept                                   | `../04-repository-concept/`   |
| Domain services                                      | `../05-domain-services/`      |

---

**Memorize this:** Aggregate persistence is one repository per root, `cascade = ALL` + `orphanRemoval = true` for children inside the boundary, id-only references (never `@ManyToOne`) across boundaries, `@Version` for concurrency, optionally event sourcing with snapshots when history matters, and CQRS-style read models when reads and writes have different shapes. The persistence model mirrors the domain rule — let the aggregate boundary determine the schema, not the other way around.
