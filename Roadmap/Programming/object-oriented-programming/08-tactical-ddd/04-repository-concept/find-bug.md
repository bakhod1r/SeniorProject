# Repository Concept — Find the Bug

Ten realistic repository smells, each with a symptom, a diagnosis, and a concrete fix. The bugs are ordered roughly by frequency in real Spring Boot codebases.

---

## Bug 1 — A repository per entity instead of per aggregate root

```java
// Aggregate: Order { OrderLine[], ShippingAddress }
public interface OrderRepository       extends JpaRepository<Order, UUID> {}
public interface OrderLineRepository   extends JpaRepository<OrderLine, UUID> {}
public interface ShippingAddressRepository extends JpaRepository<ShippingAddress, UUID> {}
```

**Symptom:** Code paths mutate `OrderLine` directly via `orderLineRepository.save(...)`, bypassing the `Order` root. Invariants enforced in `Order.confirm()` are silently skipped. Data is inconsistent (an order with no lines flips to `CONFIRMED`).

**Diagnosis:** One repository per *table* or per *JPA `@Entity`*. The aggregate boundary is invisible in the code.

**Fix:** Delete `OrderLineRepository` and `ShippingAddressRepository`. Force every line-item mutation through the aggregate root (`order.addLine(...)`, `order.removeLine(...)`) and save the whole `Order`. One repository per aggregate root. See `middle.md` §1.

---

## Bug 2 — Leaking `EntityManager` through the contract

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void saveWithSession(EntityManager em, Order order);   // leak
}
```

**Symptom:** Application service code now imports `jakarta.persistence.EntityManager`. Unit tests need a real persistence context to even compile. Mocking the repository requires producing an `EntityManager`.

**Diagnosis:** Persistence transparency violated (`specification.md` §1.4). The infrastructure type is part of the public contract.

**Fix:** Remove the `EntityManager` parameter. The repository implementation injects its own `EntityManager`; callers pass only domain types. Transaction context flows in via Spring's `@Transactional`, not through method arguments.

---

## Bug 3 — N+1 inside the repository

```java
@Override public List<Order> findByCustomer(CustomerId customer) {
    return em.createQuery(
        "select o from Order o where o.customer.id = :c", Order.class)
        .setParameter("c", customer.value())
        .getResultList();
}
// Order has @OneToMany(fetch = LAZY) List<OrderLine> lines
```

**Symptom:** The endpoint times out for customers with many orders. The database log shows one `SELECT … FROM orders WHERE customer_id = ?` followed by *N* `SELECT … FROM order_lines WHERE order_id = ?`.

**Diagnosis:** Lazy associations are accessed during serialisation or aggregate-rule enforcement; each access fires a query.

**Fix:** Add a `join fetch` for the lines (this is the right place — *inside* the repository implementation, hidden from the contract):

```java
return em.createQuery(
    "select distinct o from Order o left join fetch o.lines where o.customer.id = :c",
    Order.class)
    .setParameter("c", customer.value())
    .getResultList();
```

For collections of collections (`Order.lines` *and* `Order.payments`), one fetch-join per query — JPA cannot fetch two `@OneToMany`s in one query without a Cartesian explosion. See `optimize.md` §1.

---

## Bug 4 — Anemic repository, only `save` and `findById`

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
}
```

**Symptom:** Every use case starts with `findAll` and filters in Java because the repository can't express any query. Reports load 200k rows. Latency is awful and the database is bored.

**Diagnosis:** Repository is *too* thin. Callers compensate by doing database work in Java memory.

**Fix:** Add the *domain-meaningful* lookups that real use cases need, *or* introduce a Specification (`specification.md` §3). The interface should grow until callers stop reaching for `findAll`. Anything not aggregate-shaped (reports, summaries, search) belongs on a separate query service.

---

## Bug 5 — Missing transaction boundary

```java
@Service
public class PlaceOrderUseCase {
    private final OrderRepository orders;
    private final InventoryRepository inventory;

    public OrderId place(...) {                 // no @Transactional
        OrderId id = orders.nextIdentity();
        Order o = new Order(id, ...);
        inventory.reserve(o);
        orders.save(o);
        return id;
    }
}
```

**Symptom:** Random inconsistencies — inventory reserved but order not saved, or vice versa, because each repository call is its own transaction (Spring's default per-method autocommit when no boundary exists).

**Diagnosis:** No transactional boundary on the use case.

**Fix:** Annotate the use case method `@Transactional`. The transaction now wraps both repository calls and rolls back as a unit. See `senior.md` §5.

---

## Bug 6 — `@Transactional` on the repository instead of the use case

```java
public class JpaOrderRepository implements OrderRepository {
    @Override @Transactional
    public void save(Order order) { em.merge(order); }
}
```

**Symptom:** Use cases that call `save` then `inventory.reserve(...)` then `save` again experience intermediate commits. A failure after the first `save` leaves a half-baked order in the database.

**Diagnosis:** Transaction boundary is inside the repository, so each `save` commits immediately. The use case has no atomic boundary.

**Fix:** Remove `@Transactional` from the repository. Add it on the application/use-case service. The repository participates in whatever transaction the caller started.

---

## Bug 7 — Returning a JPA proxy outside the transaction

```java
@Override public Optional<Order> findById(OrderId id) {
    return Optional.ofNullable(em.getReference(Order.class, id.value()));
}
```

**Symptom:** Callers get an `Order` back, but accessing `order.lines()` later throws `LazyInitializationException`. Or the controller serialises the proxy and ships a half-empty JSON.

**Diagnosis:** `getReference` returns an *uninitialised proxy*. Outside the persistence context (i.e., after the transaction commits), it can't load anything.

**Fix:** Use `em.find(...)` (eager) for the aggregate root and `join fetch` for required associations. Never return a proxy from a repository that's expected to be used outside the transaction. If the use case is read-only, mark it `@Transactional(readOnly = true)` so the persistence context stays open for the duration.

---

## Bug 8 — Mutating an aggregate via a repository query method

```java
public interface OrderRepository extends JpaRepository<Order, UUID> {
    @Modifying
    @Query("update Order o set o.status = :s where o.id = :id")
    int updateStatus(UUID id, OrderStatus s);
}
```

**Symptom:** Status is updated but the aggregate's invariants (e.g., "can only confirm if at least one line exists") are not checked. The `placedAt` timestamp set by `Order.confirm()` doesn't get written. Cache and persistence context drift apart.

**Diagnosis:** Bulk update bypasses the aggregate root. Repositories are not allowed to mutate fields directly; mutations go through the root.

**Fix:** Replace the bulk update with a load–mutate–save sequence:

```java
@Transactional
public void confirm(OrderId id) {
    Order o = orders.findById(id).orElseThrow();
    o.confirm();                       // invariants enforced
    orders.save(o);
}
```

Bulk updates are reserved for *administrative* operations that legitimately operate outside the aggregate (e.g., a nightly status backfill) and live in a separate admin service, not in the application repository.

---

## Bug 9 — In-memory fake that shares references with the test

```java
public class InMemoryOrderRepository implements OrderRepository {
    private final Map<OrderId, Order> store = new ConcurrentHashMap<>();
    @Override public void save(Order order) { store.put(order.id(), order); }   // no copy
    @Override public Optional<Order> findById(OrderId id) { return Optional.ofNullable(store.get(id)); }
}
```

**Symptom:** Unit tests pass; integration tests against JPA fail. Specifically, a test asserts a mutation persists after a *second* `findById` call — but the in-memory fake returns the same reference the test mutated, accidentally implementing dirty-checking.

**Diagnosis:** Reference identity instead of value identity. The fake honours different semantics from the real implementation.

**Fix:** Deep-copy on `save` and on `findById`. Either via serialisation round-trip or an explicit copy constructor on the aggregate. The fake now behaves like persistence-oriented storage (no implicit dirty-checking) — same as a JDBC-backed implementation. See `senior.md` §2.

---

## Bug 10 — Exposing `Page<EntityClass>` from the contract

```java
public interface OrderRepository {
    Page<OrderEntity> search(OrderSearchCriteria c, Pageable page);  // both types leak
}
```

**Symptom:** The controller imports `OrderEntity` (a JPA-mapped class meant to stay in infrastructure) and Spring's `Page` / `Pageable`. Tests that wanted to fake the repository now need to fake `Page<T>`, which is non-trivial. Any future swap to JOOQ or MongoDB ripples through.

**Diagnosis:** Two leaks at once — the infrastructure entity type and the framework's pagination type are part of the contract.

**Fix:** Two parts:

1. Decide whether this is a *repository* method or a *query service* method. Search-with-pagination is almost always a query service concern (read side, projects to DTOs). Move it.
2. If it stays on the repository, return a domain-shaped pagination wrapper:

```java
public record Slice<T>(List<T> content, int page, int size, long total) {}

public interface OrderRepository {
    Slice<Order> findRecent(int page, int size);   // returns Order, not OrderEntity
}
```

The implementation translates Spring's `Page<OrderEntity>` to `Slice<Order>` internally. Persistence transparency restored.

---

## How to spot these in code review

A quick checklist when reviewing a repository PR:

- [ ] Is the count of repositories equal to the count of aggregate roots?
- [ ] Does any method signature mention `EntityManager`, `Connection`, `Session`, `Page<EntityClass>`?
- [ ] Are there any `@Modifying` queries that bypass the aggregate?
- [ ] Is `@Transactional` on the use case (not on the repository)?
- [ ] Does the in-memory fake deep-copy?
- [ ] Are read-only screens going through the repository or a query service?
- [ ] Are `findBy…` method names accumulating past 4–5? Consider Specification.
- [ ] Are lazy associations safe for callers (read-only transaction, fetch joins)?

Most production repository bugs fall under one of these ten. The fix is rarely subtle once you've named the smell.

---

## What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Fetch joins, projections, second-level cache                | `optimize.md`      |
| 8 hands-on exercises with worked solution                   | `tasks.md`         |
| 20 numbered interview Q&A                                   | `interview.md`     |
| Aggregates the repository wraps                              | `../03-aggregates/` |
| Domain services for cross-aggregate logic                   | `../05-domain-services/` |
