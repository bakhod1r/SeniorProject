# Repository Concept — Professional

> **What?** At the professional level the question is no longer *what* a repository is, but *how* an entire team should choose, layer, and govern its repositories across a Spring Boot codebase with real persistence concerns: how much of Spring Data to adopt, when QueryDSL or JOOQ is the right escape hatch, when to split a *query service* off the repository surface, and how the pattern fits into a hexagonal/ports-and-adapters architecture so the domain stays genuinely independent of the database. The discussions here are about *trade-offs* — pretty much every choice has a defensible counter-position.
> **How?** Frame each decision in terms of three forces: domain purity (can I read the domain package without learning Spring Data?), engineering velocity (how much boilerplate per repository?), and query expressiveness (can I handle the complex read path without giving up?). Match the answer to the team and the bounded context, not to a global rule. Use Spring Data where boilerplate dominates; reach for QueryDSL/JOOQ where the SQL is the value; keep ports in the domain so adapters are swappable.

---

## 1. Spring Data: the leaky abstraction in detail

Spring Data is the default choice in most Spring Boot codebases. It's also a *partial* abstraction — it solves boilerplate but introduces several leaks that bite teams 18 months in.

```java
public interface OrderRepository extends JpaRepository<Order, UUID>,
                                         JpaSpecificationExecutor<Order> {
    Optional<Order> findByCustomerIdAndStatus(UUID customerId, OrderStatus status);
    @Query("select o from Order o where o.placedAt > :since")
    List<Order> recentlyPlaced(@Param("since") Instant since);
}
```

What you actually adopt when you extend `JpaRepository`:

| Surface area exposed                            | Why it leaks                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `findAll(Sort)`                                 | Callers can scan every row, killing pagination discipline                    |
| `getReferenceById` (proxy)                       | Returns a stand-in that throws when accessed outside the persistence context |
| `flush`, `saveAndFlush`                         | Transactional behaviour now configurable per-call from the application       |
| `Page<T>` return types                          | Spring's `Page` and its `Pageable` cross every layer they touch              |
| Derived query method parsing                    | A typo in the method name produces a runtime error, not a compile error      |

The pragmatic stance: Spring Data is fine — **wrap it behind your own domain interface** so the leaks stop at one infrastructure-layer class.

```java
// domain
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
    OrderId nextIdentity();
    List<Order> recentlyPlaced(Instant since);
}

// infrastructure
interface SpringDataOrderRepository extends JpaRepository<Order, UUID>,
                                            JpaSpecificationExecutor<Order> {
    @Query("select o from Order o where o.placedAt > :since")
    List<Order> recentlyPlaced(@Param("since") Instant since);
}

@Component
class JpaOrderRepository implements OrderRepository {
    private final SpringDataOrderRepository spring;
    public JpaOrderRepository(SpringDataOrderRepository spring) { this.spring = spring; }
    @Override public Optional<Order> findById(OrderId id) { return spring.findById(id.value()); }
    @Override public void save(Order order) { spring.save(order); }
    @Override public OrderId nextIdentity() { return new OrderId(UUID.randomUUID()); }
    @Override public List<Order> recentlyPlaced(Instant since) { return spring.recentlyPlaced(since); }
}
```

You keep the productivity of Spring Data and pay one wrapper class per repository.

---

## 2. Derived query method risks

Spring Data parses method names into queries: `findByCustomerIdAndStatusOrderByPlacedAtDesc` becomes a JPQL with `where customer_id = ? and status = ? order by placed_at desc`. This is impressive — and dangerous.

- **Refactoring breaks queries silently.** Rename `placedAt` to `placedOn` and every derived method using `OrderByPlacedAt…` fails at boot or, worse, at runtime on first call.
- **Names get long.** `findByCustomerIdAndStatusAndPlacedAtBetweenAndAmountGreaterThanEqualsOrderByPlacedAtDesc` is real code in real codebases.
- **No optimisation hooks.** You can't add an index hint, can't choose between an `EXISTS` and a `JOIN`, can't fetch-join children.

Rule of thumb: **derived query methods are fine for 2–3 simple predicates.** Anything more, switch to `@Query` (explicit JPQL/SQL) or a Specification, or move the query out of Spring Data entirely.

---

## 3. QueryDSL and JOOQ — when SQL is the value

For complex read paths — search screens, reporting endpoints, exports — JPQL stops being expressive enough and developers reach for native SQL strings. That's the moment QueryDSL or JOOQ pays off.

```java
// QueryDSL — type-safe JPA queries
QOrder o = QOrder.order;
QCustomer c = QCustomer.customer;

List<Order> result = new JPAQuery<>(em)
    .select(o)
    .from(o)
    .join(o.customer, c)
    .where(c.region.eq(region)
        .and(o.status.eq(OrderStatus.OPEN))
        .and(o.placedAt.after(since)))
    .orderBy(o.placedAt.desc())
    .limit(50)
    .fetch();
```

```java
// JOOQ — typed SQL directly
List<OrderSummaryDTO> result = dsl
    .select(ORDERS.ID, CUSTOMERS.NAME, ORDERS.TOTAL)
    .from(ORDERS).join(CUSTOMERS).on(ORDERS.CUSTOMER_ID.eq(CUSTOMERS.ID))
    .where(CUSTOMERS.REGION.eq(region))
      .and(ORDERS.STATUS.eq("OPEN"))
      .and(ORDERS.PLACED_AT.greaterThan(since))
    .orderBy(ORDERS.PLACED_AT.desc())
    .limit(50)
    .fetchInto(OrderSummaryDTO.class);
```

| Aspect                          | JPA `@Query` (JPQL)       | QueryDSL                 | JOOQ                          |
| ------------------------------- | ------------------------- | ------------------------ | ----------------------------- |
| Type safety at compile time     | None (string)             | Strong                   | Strong                        |
| Maps to JPA entities            | Yes                       | Yes                      | No — to records/DTOs          |
| Native SQL features (CTE, window) | Limited                 | Limited                  | Full                          |
| Best for                        | Simple typed queries      | Complex dynamic JPA queries | Reporting, analytics, search |
| Migration cost                  | Minimal                   | Code generation step     | Code generation step          |

The combination I've seen work best in big codebases: **JPA + Spring Data for the write side, JOOQ for the read side.** Aggregates load via Spring Data; reports and search use JOOQ against the same database. The two never get tangled because they sit on opposite sides of CQRS (see `senior.md`).

---

## 4. Repository vs query service — the split

This separation matters enough to make explicit. Anything that *fetches a whole aggregate for a write* is a repository concern. Anything that *projects data for a screen or report* is a query service concern.

```java
// Write side
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
    OrderId nextIdentity();
}

// Read side
public interface OrderQueryService {
    List<OrderSummary> listForCustomer(CustomerId customer, Pageable page);
    OrderDetailsView details(OrderId id);
    Page<OrderSearchResult> search(OrderSearchCriteria c, Pageable page);
    long countByStatus(OrderStatus status);
}
```

The benefits compound:

- The repository stays small. Six methods, not thirty.
- The query service can use JOOQ, raw SQL, a read replica, or a materialised view — whatever the read path needs.
- Read DTOs are explicit; nobody accidentally returns a hydrated aggregate from a list endpoint.
- The two interfaces evolve independently: a new search filter doesn't touch the repository at all.

Some teams resist the split because "now I have two classes for one entity". The answer is: yes, because writes and reads have *different shapes*. Forcing them into one interface is the false economy.

---

## 5. Hexagonal architecture — port in domain, adapter in infrastructure

The hexagonal (ports-and-adapters) framing makes the repository's layering explicit. The repository interface is a *port* — a hole in the wall of the domain that the outside world plugs adapters into.

```
                        +-------------------+
   inbound port  --->  | Application layer  | <--- inbound adapter (REST, GraphQL)
                       |                    |
                       |   uses             |
                       |    v               |
                       | +--------------+   |
                       | | Domain layer |   |
                       | | (ports here) |   |
                       | +--------------+   |
                        +---------|---------+
                                  | outbound port (OrderRepository interface)
                                  v
                        +-------------------+
                        | Infrastructure    |  outbound adapter
                        | JpaOrderRepository|
                        +-------------------+
```

In code:

```java
// domain — defines the port
package com.shop.sales.domain;
public interface OrderRepository { ... }

// infrastructure — provides an adapter
package com.shop.sales.infrastructure.persistence.jpa;
public class JpaOrderRepository implements com.shop.sales.domain.OrderRepository { ... }

// could also have
package com.shop.sales.infrastructure.persistence.mongo;
public class MongoOrderRepository implements com.shop.sales.domain.OrderRepository { ... }
```

You can switch adapters for tests (`InMemoryOrderRepository`), for migration (run JPA and Mongo side-by-side via a `DualWriteOrderRepository`), or for new bounded contexts that prefer a different store — the domain doesn't change. This is the value the hexagonal frame gives you: *the domain owns the abstraction; the infrastructure pays the cost.*

---

## 6. Mapping: domain object vs JPA entity

A debate that keeps recurring in mature codebases: should the domain `Order` *be* the JPA `@Entity`, or should there be a separate `OrderEntity` that the repository maps to and from?

**Option A — domain object is the entity.** Annotations sit directly on the aggregate root. Fast to write, low ceremony, but JPA semantics leak into the domain (`@Version`, `@Embedded`, default no-arg constructor, lazy loading concerns).

**Option B — separate JPA entity + mapper.** The domain `Order` is pure Java. `OrderEntity` is a mirror in the infrastructure package. The repository implementation maps between them.

```java
// Option B — adapter pattern
class JpaOrderRepository implements OrderRepository {
    private final SpringDataOrderRepository spring;
    private final OrderMapper mapper;       // domain <-> entity

    @Override public Optional<Order> findById(OrderId id) {
        return spring.findById(id.value()).map(mapper::toDomain);
    }
    @Override public void save(Order order) {
        spring.save(mapper.toEntity(order));
    }
}
```

| Aspect                | Option A — entity is domain         | Option B — separate entity + mapper      |
| --------------------- | ----------------------------------- | ---------------------------------------- |
| Lines of code          | Minimal                            | Higher (a mapper per aggregate)          |
| Domain purity          | Leaky (JPA annotations everywhere)  | Pure                                     |
| Refactoring friction   | Low while the team is small         | Lower at scale                           |
| Performance overhead   | None                                | Mapping is cheap but non-zero            |
| Suited to              | CRUD-shaped apps, MVPs              | Long-lived domains, multiple persistence variants |

There's no universal answer. The decision is *per bounded context*. Boring CRUD: Option A. Long-lived, deeply-modelled domain: Option B.

---

## 7. Specification pattern with persistence translation

The Specification pattern (formalised in `specification.md`) only earns its keep when the same specification can both filter in-memory *and* push down to the database. With Spring Data:

```java
public interface OrderSpecifications {
    static org.springframework.data.jpa.domain.Specification<OrderEntity> openForCustomer(CustomerId c) {
        return (root, query, cb) -> cb.and(
            cb.equal(root.get("customerId"), c.value()),
            cb.equal(root.get("status"), OrderStatus.OPEN)
        );
    }
}

List<OrderEntity> open = spring.findAll(OrderSpecifications.openForCustomer(customerId));
```

With QueryDSL it's an `OrderPredicate` returning a `BooleanExpression`. Either way, the *contract* of `findSatisfying(Specification<Order>)` on the repository stays clean, while the *implementation* pushes the predicate into the database. See `specification.md` for the abstract version and `optimize.md` for the cost analysis.

---

## 8. Governance — keeping the team consistent

At the professional level, the repository pattern is as much a *team agreement* as a design choice. The decisions worth writing down:

- One flavour per bounded context (collection-oriented or persistence-oriented).
- Mapping policy (domain-is-entity, or separate entity + mapper).
- Whether `JpaRepository` is allowed to leak into the domain package or always wrapped.
- The boundary at which a query method moves from the repository to a query service.
- The list of approved query tools (JPQL, Spec, QueryDSL, JOOQ) and when to use which.
- The transactional boundary (always on application service; document the rule).

Code review without these agreements ends up bikeshedding the same questions on every PR. Write the rules once.

---

## 9. Quick rules

- [ ] **Wrap `JpaRepository`** behind a domain interface — never let it leak inward.
- [ ] **Derived query methods are fine for ≤3 predicates.** Past that, switch to `@Query`, Specification, or split a query service.
- [ ] For complex reads use **QueryDSL or JOOQ**, not string SQL or derived names.
- [ ] **Repository = write side, query service = read side.** Don't mix them.
- [ ] **Port in domain, adapter in infrastructure.** This is the same shape as Dependency Inversion.
- [ ] Decide **domain-is-entity vs separate entity + mapper** per bounded context, and document the choice.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Formal repository contract and Specification                | `specification.md` |
| 10 bug scenarios with diagnosis and fix                     | `find-bug.md`      |
| Fetch joins, projections, second-level cache                | `optimize.md`      |
| 8 hands-on exercises with worked solution                   | `tasks.md`         |
| 20 numbered interview Q&A                                   | `interview.md`     |
| Aggregates the repository wraps                              | `../03-aggregates/` |
| Domain services for cross-aggregate logic                   | `../05-domain-services/` |

---

**Memorize this:** Spring Data is productive but leaky — wrap it. QueryDSL and JOOQ buy you compile-time safety where SQL is the value. Repository = write side, query service = read side; never merge them. Hexagonal layering makes the repository a port in the domain and an adapter in the infrastructure — and the domain pays nothing for the persistence choice.
