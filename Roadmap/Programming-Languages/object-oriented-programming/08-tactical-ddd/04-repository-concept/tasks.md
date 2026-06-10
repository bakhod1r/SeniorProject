# Repository Concept — Tasks

Eight exercises that walk from designing a clean interface to layering a query side in CQRS. Each task lists the inputs, the constraints, and how to know you're done. A worked solution for Task 1 is at the end.

---

## Validation table — read this first

Every exercise is "done" when *all* of these hold:

| Check                                                                  | How to verify                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| The interface lives in the domain package                              | `import` line: no `jakarta.persistence.*`, no Spring Data    |
| Methods speak the domain vocabulary, not SQL                           | Read the method names aloud — do they sound like business?   |
| One repository per aggregate root in the bounded context               | Count roots, count repositories — they match                 |
| In-memory implementation deep-copies aggregates                        | Mutating the aggregate after `save` does not affect the store |
| Application service owns `@Transactional`                              | Repository has no `@Transactional`                           |
| Reads for screens go through a query service, not the repository       | `findAll`/`Page` on the repository is rare                   |
| Specification translates to SQL when row count > 1k                    | Profiler shows DB filtering, not Java filtering              |
| No `EntityManager`, `Connection`, `Page<EntityClass>` in the contract  | Grep the domain package — should be empty of those tokens    |

---

## Task 1 — Design the `OrderRepository` interface

**Setup.** A `Sales` bounded context with an `Order` aggregate root containing `OrderLine` entities and a `ShippingAddress` value object. Status transitions: `DRAFT → CONFIRMED → SHIPPED → DELIVERED`, with `CANCELLED` accessible from `DRAFT` or `CONFIRMED`.

**Your task.** Write the interface `com.shop.sales.domain.OrderRepository`. Decide on the flavour (collection-oriented vs persistence-oriented) and justify it. Include only the methods that real use cases need. Do not add `findAll`, `count`, or anything that doesn't fit the aggregate-as-collection model.

**Done when.**
- Interface has at most six methods.
- Every method takes or returns domain types only.
- A `placeOrder`, `confirmOrder`, and `cancelOrder` use case can each be expressed using only these methods.

Worked solution at the bottom.

---

## Task 2 — Build an in-memory test implementation

**Setup.** The `OrderRepository` from Task 1.

**Your task.** Implement `InMemoryOrderRepository` backed by a `ConcurrentHashMap<OrderId, Order>`. Deep-copy aggregates on both `save` (so callers can't mutate the store via their reference) and `findById` (so test mutations don't affect later reads).

**Done when.**
- A unit test mutates an `Order`, calls `save`, mutates the same reference again, then calls `findById` and observes the *first* state.
- A test calls `save`, then `delete`, then `findById` and gets `Optional.empty()`.
- The same `InMemoryOrderRepository` instance is reused across two threads with one writing and one reading — no `ConcurrentModificationException`.

Hint: a copy-constructor on `Order` is the cleanest path. Serialization round-trip works but is slow for tests.

---

## Task 3 — Fix an N+1 in `findByCustomer`

**Setup.** The current implementation:

```java
@Override public List<Order> findByCustomer(CustomerId c) {
    return em.createQuery(
        "select o from Order o where o.customer.id = :c", Order.class)
        .setParameter("c", c.value())
        .getResultList();
}
```

`Order.lines` is `FetchType.LAZY`. The endpoint that returns `findByCustomer(...)` followed by serialisation issues N+1 SELECTs to the database — one for the order list, one for each order's lines.

**Your task.** Fix the query to load orders and their lines in a single round trip. Identify what changes if the order has *two* `@OneToMany` collections (`lines` and `payments`) and propose a solution that keeps row count bounded.

**Done when.**
- Query log shows one SQL statement for a customer with five orders, not six.
- The fix handles `distinct` correctly so duplicate `Order` rows from the join are collapsed.
- For the two-collection variant, you've documented why `@BatchSize` (or two queries) beats two `join fetch`s.

---

## Task 4 — Introduce a Specification

**Setup.** Use cases want orders matching:

- "open orders for this customer"
- "orders placed in the last 30 days with total > 1000 USD"
- "cancelled orders for region X this quarter"

The team is considering five `findByXAndYAndZ` methods.

**Your task.** Define a `Specification<Order>` interface in the domain layer. Implement three concrete specifications: `OpenOrders`, `PlacedAfter`, `ForCustomer`. Add `findSatisfying(Specification<Order>)` to the repository. Compose the first two use cases using `and(...)`.

**Done when.**
- The repository interface still has ≤ 6 methods.
- A new use case ("open orders for region X with total > 5000") can be expressed without changing the repository at all.
- The in-memory implementation runs `isSatisfiedBy` over its values. The JPA implementation translates the Specification to a `CriteriaQuery` predicate.

---

## Task 5 — Split a query service for the order list screen

**Setup.** A new screen shows: *order ID, customer name, total amount, status, placed-at timestamp* for the most recent 50 orders. Currently the controller calls `orders.findAll()`, hydrates 50 full `Order` aggregates with their lines, and serialises five fields.

**Your task.** Add a query service `OrderQueryService` in the read side. Define a DTO `OrderSummary` with exactly the five fields. Implement the query with a JPQL projection or JOOQ.

**Done when.**
- `OrderRepository` no longer exposes `findAll`.
- The new query runs a single SQL statement with the five columns selected directly.
- The endpoint response size shrinks (measure with the network tab or `curl -w '%{size_download}'`).
- Adding a sixth field to the screen requires changing only `OrderSummary` and the query — not the aggregate.

---

## Task 6 — Add optimistic locking

**Setup.** Two parallel HTTP requests confirm the same order. Without locking, both succeed and the audit log records two `OrderConfirmed` events.

**Your task.** Add a `@Version` field on `Order` (or wherever your mapping policy prefers). Adjust the use case to catch `OptimisticLockingFailureException` and either retry once or surface a `ConcurrentModificationException` to the caller.

**Done when.**
- A test that races two confirmations observes exactly one success and one conflict.
- The retry policy is in the use case, not in the repository.
- The aggregate's `version` is incremented on every save, visible in the database.

---

## Task 7 — Migrate from Spring Data leak to wrapped interface

**Setup.** The current code:

```java
// in com.shop.sales.domain
public interface OrderRepository extends JpaRepository<Order, UUID> {
    Optional<Order> findByCustomerIdAndStatus(UUID customerId, OrderStatus status);
}
```

**Your task.** Refactor so that `com.shop.sales.domain.OrderRepository` is a clean domain interface, and a new `JpaOrderRepository` (in infrastructure) implements it by delegating to a `SpringDataOrderRepository extends JpaRepository<...>` interface that lives next to the implementation.

**Done when.**
- The domain package does not depend on Spring Data or JPA.
- The application service still compiles unchanged (it always referenced the domain interface).
- A unit test of the application service uses an in-memory implementation and runs without a Spring context.

---

## Task 8 — Add a CQRS read model with materialised view

**Setup.** A reporting team wants daily aggregates: orders per region per day, broken down by status. The current code computes this in Java by hydrating thousands of `Order` aggregates per request.

**Your task.** Design a materialised `order_daily_summary` view (one row per region, day, status) maintained by either (a) a database trigger, (b) a domain-event handler that updates the table on every `OrderStatusChanged`, or (c) a nightly batch job. Add a query service `OrderReportingQueryService` that reads from the view.

**Done when.**
- The reporting endpoint runs in O(rows-in-view), not O(orders-in-system).
- The maintenance strategy (a/b/c) is documented with its trade-off (latency, complexity, accuracy under back-fills).
- The view is never read by the write-side repository — it's a strictly read-side artifact.

---

## Worked solution — Task 1

The repository for `Order`:

```java
package com.shop.sales.domain;

import java.util.Optional;
import java.util.List;

public interface OrderRepository {

    /** Mint a new identity. Independent of the database. */
    OrderId nextIdentity();

    /** Load the complete aggregate by identity. */
    Optional<Order> findById(OrderId id);

    /** Persistence-oriented: every change requires an explicit save. */
    void save(Order order);

    /** Remove the aggregate from the collection. */
    void delete(Order order);

    /** Domain-meaningful traversal: a customer's order history.
     *  Returns whole aggregates; for screen-sized lists use a query service. */
    List<Order> findByCustomer(CustomerId customer);

    /** Filter by Specification. Keeps the interface stable as use cases grow. */
    List<Order> findSatisfying(Specification<Order> spec);
}
```

Justification for choosing **persistence-oriented**:

- The codebase already has parts that use JDBC + MyBatis (no implicit dirty-checking), so making `save` explicit keeps semantics consistent across the bounded context.
- Explicit `save` documents the *moment* a change is meant to be observable — useful for code review.
- Switching ORM later is cheaper because no code relies on auto-tracking.

How each use case uses only these methods:

```java
@Transactional
public OrderId placeOrder(CustomerId customer, List<NewLine> requested) {
    OrderId id = orders.nextIdentity();
    Order o = new Order(id, customer);
    requested.forEach(l -> o.addLine(l.productId(), l.qty(), l.price()));
    orders.save(o);
    return id;
}

@Transactional
public void confirmOrder(OrderId id) {
    Order o = orders.findById(id).orElseThrow(() -> new OrderNotFoundException(id));
    o.confirm();
    orders.save(o);
}

@Transactional
public void cancelOrder(OrderId id, String reason) {
    Order o = orders.findById(id).orElseThrow(() -> new OrderNotFoundException(id));
    o.cancel(reason);
    orders.save(o);
}
```

No method exposes infrastructure. No `findAll`. No partial fetches. The interface scales by adding Specifications — not new `findBy…` methods — so a new "open orders this week" use case ships without changing the interface at all.

---

## What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| 20 numbered interview Q&A                                   | `interview.md`     |
| Aggregates the repository wraps                              | `../03-aggregates/` |
| Entities that live inside aggregates                        | `../02-entities/`  |
| Domain services for cross-aggregate logic                   | `../05-domain-services/` |
