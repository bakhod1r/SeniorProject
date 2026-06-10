# Repository Concept — Senior

> **What?** At the senior level, the repository becomes a design *decision space* rather than a single pattern. The two flavours — *collection-oriented* and *persistence-oriented* — encode different assumptions about how the persistence mechanism behaves; in-memory implementations become a first-class test tool; complex queries split off into Specifications or query services; and CQRS read models live deliberately outside the repository abstraction so neither side compromises the other.
> **How?** Pick the flavour that matches your ORM's behaviour (collection-oriented for unit-of-work tracking like JPA's persistence context, persistence-oriented for explicit-`save` engines like MyBatis/JDBC). Provide an `InMemoryFooRepository` for tests. Push multi-criteria queries through the Specification pattern or a dedicated query service. Keep the transaction boundary on the application service, not on the repository.

---

## 1. The two flavours: collection-oriented vs persistence-oriented

Vaughn Vernon distinguishes two repository styles in *Implementing Domain-Driven Design*:

**Collection-oriented repository** behaves like a `Set<T>`. You add an aggregate once; subsequent mutations are picked up automatically because the underlying ORM tracks them.

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void add(Order order);          // first time only
    void remove(Order order);
    OrderId nextIdentity();
}

// usage
Order o = orders.findById(id).orElseThrow();
o.confirm();                         // no explicit save — JPA dirty-checking handles it
```

The "no explicit save" property works under JPA, EclipseLink, or any other engine with a persistence context that flushes at transaction commit. It does *not* work under JDBC or MyBatis, where the database has no way to know an in-memory object changed.

**Persistence-oriented repository** behaves like a key-value store. Every change requires an explicit `save`.

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);          // always — covers insert and update
    void delete(Order order);
    OrderId nextIdentity();
}

// usage
Order o = orders.findById(id).orElseThrow();
o.confirm();
orders.save(o);                      // mandatory — JDBC has no dirty-checking
```

Persistence-oriented is honest with non-tracking engines and survives changes of ORM. Collection-oriented is cleaner where it works. Many teams adopt persistence-oriented even with JPA, treating the explicit `save` as documentation: *this is the moment a change is meant to be observable*.

| Property                            | Collection-oriented           | Persistence-oriented              |
| ----------------------------------- | ----------------------------- | --------------------------------- |
| Method shape                        | `add` / `remove`              | `save` / `delete`                 |
| Requires unit-of-work tracking      | Yes (JPA/Hibernate)           | No                                |
| Survives ORM swap                   | Painful                       | Easy                              |
| Code reads as                       | "this is a collection"        | "this is a store"                 |
| Risk: silent persistence            | High — forget save = no-op    | Low — explicit                    |

The teams I'd trust most pick *one* style and apply it consistently across the bounded context. Mixing the two on different aggregates is a maintenance trap.

---

## 2. In-memory implementations for tests

Because the interface lives in the domain layer, you can hand-write an `InMemoryOrderRepository` that uses a `ConcurrentHashMap`. Unit tests for application services then need no database at all.

```java
public final class InMemoryOrderRepository implements OrderRepository {
    private final Map<OrderId, Order> store = new ConcurrentHashMap<>();

    @Override public Optional<Order> findById(OrderId id) {
        return Optional.ofNullable(store.get(id)).map(this::deepCopy);
    }
    @Override public void save(Order order) {
        store.put(order.id(), deepCopy(order));      // store a copy, not the live reference
    }
    @Override public void delete(Order order) { store.remove(order.id()); }
    @Override public OrderId nextIdentity() { return new OrderId(UUID.randomUUID()); }

    private Order deepCopy(Order o) { /* serialize-roundtrip or manual copy */ }
}
```

The deep-copy detail matters. If `save` stores the same reference the test code is mutating, you accidentally simulate dirty-checking — your tests pass on the fake but fail on a JDBC-backed implementation. Copy on both *write* (so the store can't be mutated through the caller's reference) and *read* (so the caller can't mutate the stored copy). Without the copy, the fake silently becomes a *collection-oriented* repository even when production is persistence-oriented.

This is the cleanest application of LSP (see `../../03-design-principles/01-solid-principles/`): the fake honours the same behavioural contract as the production implementation. Tests trust it.

---

## 3. Query methods vs Specification pattern

A pile of `findBy…` methods is a classic anti-shape:

```java
public interface OrderRepository {
    List<Order> findByCustomer(CustomerId c);
    List<Order> findByCustomerAndStatus(CustomerId c, OrderStatus s);
    List<Order> findByCustomerAndStatusAndDateRange(CustomerId c, OrderStatus s, DateRange r);
    List<Order> findByStatusAndAmountGreaterThan(OrderStatus s, Money min);
    // ... twenty more ...
}
```

Each combination is a different method; new screens grow the interface forever. The Specification pattern (Evans, *DDD* §6.5) reverses the relationship: the *caller* describes what it wants as a value object, and the repository runs it.

```java
public interface Specification<T> {
    boolean isSatisfiedBy(T candidate);
    // implementations also expose a translation to a query — see professional.md
}

public final class OpenOrdersForCustomer implements Specification<Order> {
    private final CustomerId customer;
    public OpenOrdersForCustomer(CustomerId customer) { this.customer = customer; }
    @Override public boolean isSatisfiedBy(Order o) {
        return o.customer().equals(customer) && o.status() == OrderStatus.OPEN;
    }
}

public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    List<Order> findSatisfying(Specification<Order> spec);
    void save(Order order);
    OrderId nextIdentity();
}
```

The interface stops growing. New queries become new `Specification` classes. The same specification can be reused in-memory (`stream().filter(spec::isSatisfiedBy)`), as a JPA criteria query, or as a JOOQ condition (Spring Data offers `JpaSpecificationExecutor` for this). See `specification.md` for the formal version and `professional.md` for the translation strategy.

---

## 4. CQRS read models — bypassing the repository

The repository is a *write-side* abstraction. It returns whole aggregates, hydrated with their internal entities and value objects, ready to enforce invariants. That's expensive — and wrong-shaped — when all the screen needs is *"a list of order summaries with customer name and total"*.

CQRS (Command Query Responsibility Segregation) acknowledges this asymmetry. Reads have a different shape from writes, so they get a different code path.

```java
// write side
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
}

// read side — bypasses the repository entirely
public interface OrderQueryService {
    List<OrderSummary> listForCustomer(CustomerId customer);
    OrderDetailsView detailsFor(OrderId id);                   // flat DTO, not the aggregate
    Page<OrderSummary> search(OrderSearchCriteria criteria, Pageable page);
}

public record OrderSummary(UUID orderId, String customerName,
                           BigDecimal total, OrderStatus status, Instant placedAt) {}
```

The query service is free to:

- Read from a denormalised view (`order_summary` table refreshed by triggers or an event handler).
- Read across multiple aggregates in a single SQL `JOIN` — *which a repository should never do*.
- Use any tool: JOOQ, JDBC templates, even raw SQL.

The repository stays small and aggregate-shaped; the query service stays focused on screens. They never share methods. The naming convention I prefer: anything returning `Order` (the aggregate) lives on the repository; anything returning `OrderSummary` / `OrderView` (a DTO) lives on a query service.

---

## 5. Transactional boundary belongs to the application service

This is one of the most common senior-level mistakes: putting `@Transactional` on the repository.

```java
// wrong — every save is its own transaction
public class JpaOrderRepository implements OrderRepository {
    @Override @Transactional
    public void save(Order order) { em.merge(order); }
}

// wrong — the use case can leave the system in an inconsistent state if a later save fails
```

The transactional boundary is the *use case*, not the *persistence call*. A use case may call several repositories (e.g., decrement inventory *and* save the order) and must commit atomically.

```java
@Service
public class PlaceOrderUseCase {
    private final OrderRepository orders;
    private final InventoryRepository inventory;

    @Transactional                          // here — one transaction per use case
    public OrderId place(...) {
        OrderId id = orders.nextIdentity();
        Order order = new Order(id, ...);
        inventory.reserveFor(order);        // may throw — transaction rolls back
        orders.save(order);
        return id;
    }
}
```

Put another way: the repository participates in a transaction; it does not *own* one.

---

## 6. Aggregate-load granularity

A senior decision that often gets skipped: *how much* of the aggregate do you hydrate per call? Three positions exist:

- **Always full.** Simplest. Fits aggregates that are bounded in size (Vernon's guideline: a few hundred entities at most).
- **Lazy.** JPA lazy associations. Works for read paths but is poison for command paths because invariants may depend on data that isn't loaded — a partial aggregate cannot enforce a whole-aggregate rule.
- **Multiple fetch profiles.** `findById(id)` returns the full aggregate; `findByIdLight(id)` returns only the root. Useful when one use case truly never touches the children.

The discipline that matters: **for command paths, never return a partial aggregate.** The point of the aggregate is that its root sees all the data it needs to enforce invariants. Loading half of it and then calling `confirm()` is asking for a quiet bug.

---

## 7. Optimistic locking lives on the aggregate, not the repository

Concurrent updates are a write-side concern. The aggregate root carries a version field; the repository participates by reading and asserting it.

```java
public class Order {
    @Version private long version;       // JPA marker; in pure domain you can model this yourself
}
```

When two transactions read the same order and both try to save, the second commit fails with an `OptimisticLockingFailureException` (Spring) or `OptimisticLockException` (JPA). The use case decides whether to retry or surface the conflict — the repository's job is just to honour the version check.

This is one of the few places where infrastructure detail (`@Version`) is acceptably close to the domain. Some teams keep it on a separate `OrderEntity` and map; others tolerate the annotation on the aggregate. Both are defensible — pick once, stay consistent.

---

## 8. Senior-level pitfalls

**Pitfall 1: returning `Order` from a query service.** If the query service returns the aggregate, callers will mutate it and lose changes — there's no `save`. Return DTOs.

**Pitfall 2: writing a `Specification` that translates to a `Cartesian product`.** Specifications that compose well in-memory can produce ugly SQL. Always look at the generated query under load.

**Pitfall 3: hand-rolling an in-memory fake that doesn't deep-copy.** Tests pass; production breaks because dirty-checking was an accident.

**Pitfall 4: spreading `@Transactional` everywhere.** Nested transactions and self-invocation issues. Keep `@Transactional` on the use case, period.

**Pitfall 5: making the repository return `Stream<Order>` for "performance".** Streams from JPA queries hold the connection open and bleed through every layer that consumes them. Return `List<Order>` (or a paginated wrapper) at the application boundary.

---

## 9. Quick rules

- [ ] Pick **one flavour** (collection-oriented or persistence-oriented) per bounded context and stick to it.
- [ ] Ship an **in-memory implementation** for tests; deep-copy on read and write.
- [ ] Beyond 4–6 query methods, switch to the **Specification** pattern or split a *query service*.
- [ ] **CQRS read paths** never go through the repository — they return DTOs.
- [ ] `@Transactional` lives on the **application service**, never on the repository.
- [ ] **Never return a partial aggregate** from a command path.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Spring Data trade-offs, QueryDSL, hexagonal layering        | `professional.md`  |
| Formal contract and Specification pattern in depth          | `specification.md` |
| 10 bug scenarios with diagnosis and fix                     | `find-bug.md`      |
| Fetch joins, projections, second-level cache                | `optimize.md`      |
| Aggregates the repository wraps                              | `../03-aggregates/` |
| Entities that live inside aggregates                        | `../02-entities/`  |
| Domain services for cross-aggregate logic                   | `../05-domain-services/` |

---

**Memorize this:** Pick collection-oriented or persistence-oriented and stay consistent. Ship an in-memory fake. Push complex queries through Specifications or split a query service. CQRS reads bypass the repository — they're a different shape and a different code path. Transactions wrap *use cases*, not individual `save` calls.
