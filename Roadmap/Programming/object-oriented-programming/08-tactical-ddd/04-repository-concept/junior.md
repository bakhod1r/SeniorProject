# Repository Concept — Junior

> **What?** A *Repository* is a Domain-Driven Design pattern that gives the rest of the application the illusion of an in-memory *collection* of aggregates — you ask it for an aggregate by ID, you add a new one to it, you remove one — and behind the scenes it hides whatever persistence machinery (JDBC, JPA, MongoDB, a remote service) actually stores those aggregates.
> **How?** Define a small interface in the *domain* layer (`OrderRepository`) with collection-like verbs (`findById`, `save`, `delete`, `nextIdentity`). Put the database-specific implementation (`JpaOrderRepository`) in the *infrastructure* layer. Application services depend on the interface, never on the implementation. The domain code never sees a `Connection`, an `EntityManager`, or an SQL string.

---

## 1. Why repositories exist at all

In Eric Evans' original *Domain-Driven Design* (2003), the repository pattern solves one specific friction: **domain code shouldn't have to know how aggregates are persisted, but it does have to be able to get them back.** Without a repository, the application service ends up writing JDBC or JPA calls inline, mixing business rules with `SELECT` statements. Six months later, the rules are buried under query code, and nobody can tell what the domain actually *does*.

A repository pushes all of that infrastructure noise to the edge of the system. Inside the domain, you think in terms of `Order`, `Customer`, `Invoice` — not `ResultSet`, `EntityManager`, or `MongoCollection`.

```java
// Without a repository — domain logic tangled with persistence:
public class OrderApplicationService {
    private final DataSource dataSource;

    public void confirm(long orderId) {
        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement("SELECT * FROM orders WHERE id = ?")) {
            ps.setLong(1, orderId);
            // ... 30 lines of ResultSet parsing into an Order ...
            order.confirm();
            // ... 20 more lines of UPDATE statements ...
        }
    }
}

// With a repository — domain logic is what's left:
public class OrderApplicationService {
    private final OrderRepository orders;

    public void confirm(OrderId orderId) {
        Order order = orders.findById(orderId)
            .orElseThrow(() -> new OrderNotFoundException(orderId));
        order.confirm();
        orders.save(order);
    }
}
```

The second version reads like a business sentence: *find this order, confirm it, save it*. The persistence is somewhere else.

---

## 2. The collection illusion

The mental model Evans pushes is: **pretend the repository is a `Set<Order>` that happens to survive between application runs.** That framing drives almost every design decision:

- You don't "open" or "close" it — it's just there.
- You don't paginate over the whole thing — you ask by identity.
- You don't think about SQL — you think about *which order do I want*.

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
    void delete(Order order);
    OrderId nextIdentity();
}
```

That's the whole shape of a junior-level repository. Four methods, all phrased in domain language. No `Connection`, no `EntityManager`, no `@Transactional` annotation — those belong in the implementation, not the contract.

---

## 3. Repository is not a DAO

This is the number-one confusion for newcomers. *Repository* and *Data Access Object* (DAO) look superficially alike — both encapsulate database access — but they sit at different abstraction levels:

| Concern               | DAO                                             | Repository                                                |
| --------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| Unit of work          | A *table row* or *result set*                   | An *aggregate root* (a whole consistent cluster)          |
| Vocabulary            | `insertRow`, `updateRow`, `selectByColumn`      | `save`, `findById`, `findActiveCustomersForRegion`        |
| Lives in              | The persistence/infrastructure layer            | The domain layer (interface) + infrastructure (impl)      |
| Knows about DB        | Yes — that's its job                            | No — the *implementation* knows, the contract doesn't     |
| Granularity           | Often one DAO per table                         | One repository per aggregate root                          |

A DAO that reads `order_lines` and another that reads `orders` reflects table structure. A `OrderRepository` that returns a fully-hydrated `Order` *including* its lines reflects the domain model. The repository may *use* multiple DAOs internally, but its public contract is aggregate-shaped.

---

## 4. A tiny end-to-end example

Imagine an Order aggregate with line items:

```java
// domain layer
public class Order {
    private final OrderId id;
    private final CustomerId customer;
    private final List<OrderLine> lines = new ArrayList<>();
    private OrderStatus status = OrderStatus.DRAFT;

    public Order(OrderId id, CustomerId customer) {
        this.id = id; this.customer = customer;
    }
    public void addLine(ProductId p, int qty, Money price) {
        if (status != OrderStatus.DRAFT) throw new IllegalStateException();
        lines.add(new OrderLine(p, qty, price));
    }
    public void confirm() {
        if (lines.isEmpty()) throw new IllegalStateException("empty order");
        this.status = OrderStatus.CONFIRMED;
    }
    public OrderId id() { return id; }
}

// domain layer — the repository interface
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
    void delete(Order order);
    OrderId nextIdentity();
}

// infrastructure layer — one possible implementation
public class JpaOrderRepository implements OrderRepository {
    private final EntityManager em;
    public JpaOrderRepository(EntityManager em) { this.em = em; }

    @Override public Optional<Order> findById(OrderId id) {
        return Optional.ofNullable(em.find(Order.class, id.value()));
    }
    @Override public void save(Order order) {
        em.merge(order);
    }
    @Override public void delete(Order order) {
        em.remove(em.contains(order) ? order : em.merge(order));
    }
    @Override public OrderId nextIdentity() {
        return new OrderId(UUID.randomUUID());
    }
}
```

The domain layer doesn't import `javax.persistence` or `jakarta.persistence`. The interface mentions only domain types. Swap JPA for MongoDB by writing `MongoOrderRepository` — `OrderApplicationService` doesn't change.

---

## 5. `nextIdentity()` — IDs come from the repository

A subtle but important rule: the repository, not the database, owns the *identity generation strategy*. Why? Because the domain needs an ID *before* the aggregate touches the database — to publish domain events, to log, to hand back to the caller.

```java
public OrderId placeOrder(CustomerId customer) {
    OrderId id = orders.nextIdentity();     // ID exists in memory first
    Order order = new Order(id, customer);
    orders.save(order);
    return id;
}
```

Letting the database assign an auto-increment ID and then reading it back after `INSERT` works, but it ties domain logic to the moment of persistence. UUIDs (or a sequence pre-allocated by the repository) keep the domain independent.

---

## 6. What a repository is *not*

- **Not a query builder.** If you find yourself adding `findByCustomerAndStatusAndDateBetween(...)`, you're sliding into DAO territory. For complex queries that aren't naturally aggregate-shaped, use a separate *query service* (covered in `senior.md`).
- **Not a place for business rules.** `OrderRepository.save(order)` doesn't validate the order — `Order.confirm()` does. The repository stores whatever you give it.
- **Not one-per-entity.** It's *one per aggregate root*. If `OrderLine` is part of the `Order` aggregate, there is no `OrderLineRepository`. You go through `Order`. (See `middle.md`.)
- **Not always JPA.** Spring Data `JpaRepository` is one popular implementation strategy, but a repository can be backed by JDBC, MyBatis, MongoDB, Redis, an HTTP client, or even an `in-memory ConcurrentHashMap` (for tests).

---

## 7. The two-package layout

A typical Java module ends up with two packages:

```
com.shop.order.domain
   |-- Order.java                  // aggregate root
   |-- OrderLine.java              // part of the aggregate
   |-- OrderId.java                // value object
   |-- OrderRepository.java        // interface only

com.shop.order.infrastructure
   |-- JpaOrderRepository.java     // implementation
   |-- OrderEntity.java            // optional JPA-mapped class if you keep domain pure
```

The arrow points *inward*: `infrastructure` depends on `domain`, never the reverse. This is the same shape as Dependency Inversion from SOLID (see `../../03-design-principles/01-solid-principles/`) — the domain owns the abstraction, the infrastructure provides the detail.

---

## 8. Common newcomer mistakes

**Mistake 1: putting the repository interface in the infrastructure package.** Then the domain layer ends up depending on infrastructure to declare its own contract — the arrow flips and DIP collapses.

**Mistake 2: leaking `EntityManager` or `Session` through the interface.** Once a domain method takes an `EntityManager`, every test needs a real JPA context. Keep the contract clean.

**Mistake 3: one repository per table.** If `Order` and `OrderLine` are one aggregate, there is one `OrderRepository`. Loading `OrderLine` without its parent breaks the aggregate's invariants.

**Mistake 4: putting query methods for read screens on the repository.** Reports, dashboards, search pages — these are read-only views. Put them on a separate query service (CQRS-lite). The repository stays focused on the *write* side.

---

## 9. Quick rules

- [ ] One repository per **aggregate root**, not per entity, not per table.
- [ ] Interface in the **domain**, implementation in the **infrastructure**.
- [ ] Methods speak the **domain's language** (`findById`, `save`), not SQL.
- [ ] No `EntityManager`, `Connection`, or persistence type **on the public contract**.
- [ ] IDs are minted via **`nextIdentity()`**, not by the database.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Repository per aggregate root, Spring Data contrast         | `middle.md`        |
| Collection vs persistence-oriented, in-memory tests, CQRS   | `senior.md`        |
| Spring Data trade-offs, QueryDSL, hexagonal layering        | `professional.md`  |
| Formal contract, Specification pattern                      | `specification.md` |
| 10 bug scenarios with diagnosis and fix                     | `find-bug.md`      |
| Fetch joins, projections, second-level cache                | `optimize.md`      |
| 8 hands-on exercises with worked solution                   | `tasks.md`         |
| 20 numbered interview Q&A                                   | `interview.md`     |
| Aggregates the repository is built around                   | `../03-aggregates/` |
| Entities that live inside aggregates                        | `../02-entities/`  |
| Domain services for cross-aggregate logic                   | `../05-domain-services/` |

---

**Memorize this:** A repository is a *collection of aggregates* with an interface in the domain and an implementation in the infrastructure. One per aggregate root, not per entity. It hides persistence; it doesn't add business rules. The domain code never sees an `EntityManager` — the implementation does.
