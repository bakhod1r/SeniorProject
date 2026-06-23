# Repository Concept — Optimize

Ten optimization angles for repository implementations. Each pairs a measurement with a concrete change. Order is roughly cost-vs-impact: cheap wins first, structural changes later.

---

## 1. Fetch join vs batch fetch vs select-by-id

The most common repository performance failure is the N+1 query. Three tools, used appropriately:

- **`join fetch`** in JPQL — one SQL round trip, one query, all rows. Good when the association is bounded (≤100 rows per parent).
- **`@BatchSize(size = 50)`** on the association — JPA collects parent IDs and issues *one* `WHERE child.parent_id IN (...)` query per batch. Good when the same association is touched across many parents and you can't predict which ones in advance.
- **Pre-loaded ID lookup** — fetch IDs first (`SELECT id FROM …`), then issue a single `WHERE id IN (...)` to hydrate. Good for very large parent sets where `join fetch` would multiply rows.

```java
// fetch join — known scope
em.createQuery("select distinct o from Order o left join fetch o.lines where o.id = :id", Order.class)
  .setParameter("id", id.value())
  .getSingleResult();

// batch size — annotation
@OneToMany(mappedBy = "order", fetch = FetchType.LAZY)
@BatchSize(size = 50)
private List<OrderLine> lines;
```

Rule: **one fetch join per `@OneToMany` per query**. JPA cannot fetch two collections in one query without a Cartesian product. Use a batch fetch for the second one.

---

## 2. Pagination over `findAll`

`findAll()` on a 10-million-row table will eventually OOM the JVM. The repository should never expose unbounded reads in production.

```java
// dangerous
List<Order> all = orders.findAll();

// safer
Slice<Order> page = orders.findAll(PageRequest.of(0, 100));
```

If the repository genuinely needs to stream all rows for a background job, use a `Stream<T>` *inside a transaction* and process in chunks — but do not return the `Stream` from the repository interface, the persistence-context lifetime gets confusing.

---

## 3. Read-only transaction for queries

Marking a transaction read-only lets the JPA provider skip dirty-check work, the database can use lighter locks, and read replicas can pick up the load.

```java
@Transactional(readOnly = true)
public List<OrderSummary> listForCustomer(CustomerId c) { ... }
```

For read-heavy controllers, set the class-level default to `readOnly = true` and override it on the few write methods. The performance difference is small per call (5–15%) but compounds at scale.

---

## 4. Projection DTOs for the read side

A repository fetching whole aggregates for a screen that displays five fields is wasted work. Project to a DTO in the SQL itself.

```java
public record OrderSummary(UUID id, String customerName, BigDecimal total, OrderStatus status) {}

public interface OrderQueryRepository {
    @Query("""
        select new com.shop.read.OrderSummary(o.id, c.name, o.total, o.status)
        from Order o join o.customer c
        where o.customer.id = :customerId
        """)
    List<OrderSummary> summariesForCustomer(@Param("customerId") UUID customerId);
}
```

The database returns rows already shaped for the screen. No aggregate construction, no lazy-loading dance, half the bytes over the wire. Move this kind of query out of the write-side repository (see `senior.md` §4).

---

## 5. Second-level cache for read-mostly aggregates

Reference data — product catalogues, pricing rules, country codes — is read frequently and changed rarely. JPA's second-level cache (Hibernate `@Cache`, EclipseLink `@Cacheable`) holds parsed aggregates across sessions.

```java
@Entity
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE, region = "products")
public class Product { ... }
```

Cache hits skip the database entirely. Cache misses do one read and populate. Invalidation must be wired (e.g., via Spring `@CacheEvict` on the write path, or distributed invalidation if multiple JVMs).

Caveats: do **not** cache aggregates whose invariants depend on cross-aggregate state, do **not** cache user-specific data, and measure — cache overhead can exceed the database win for tiny aggregates.

---

## 6. Query method vs JPQL vs Criteria API performance

| Approach                              | Compile-time safety | Runtime overhead | Best for                              |
| ------------------------------------- | ------------------- | ---------------- | ------------------------------------- |
| Derived query method (`findByX`)      | No (parses name)    | Tiny             | Simple 1–3 predicate lookups          |
| `@Query` (JPQL string)                | No (string)         | Tiny             | Most write-side repository methods    |
| Criteria API (`CriteriaBuilder`)      | Partial             | Higher (object construction) | Truly dynamic queries           |
| QueryDSL (`Q*` classes)               | Strong              | Tiny             | Dynamic queries that must stay fast   |
| JOOQ (typed SQL)                      | Strong              | Tiny             | Read-side complex queries             |

The runtime cost of the Criteria API is occasionally meaningful — every call constructs a tree of objects. For hot paths, prefer `@Query` or QueryDSL. For occasional admin queries, Criteria is fine.

---

## 7. Connection pool sizing

Repository latency is sometimes really *connection pool* latency. A small pool under high concurrency queues threads waiting for a connection — the SQL is fast, but the *acquire* is slow.

The rule of thumb (Brett Wooldridge, HikariCP author): `pool_size = ((core_count * 2) + effective_spindle_count)` — usually 10–20 for a typical OLTP service.

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20
      connection-timeout: 3000
      leak-detection-threshold: 30000
```

Measure with HikariCP's metrics (`hikaricp_connections_pending`, `hikaricp_connections_usage_seconds`). If pending > 0 sustainedly, the pool is too small *or* there's a leak (transactions held too long).

---

## 8. Avoid loading the aggregate when you only need an ID check

If a use case only needs to know *"does an order with this ID exist?"*, loading the whole `Order` aggregate is wasteful.

```java
// expensive
boolean exists = orders.findById(id).isPresent();

// cheap
boolean exists = spring.existsById(id.value());
```

Similarly, for "the count of open orders for this customer":

```java
@Query("select count(o) from Order o where o.customer.id = :c and o.status = 'OPEN'")
long countOpenForCustomer(@Param("c") UUID customerId);
```

`existsById` and `count` queries don't hydrate aggregates and don't fire lazy loads.

---

## 9. Specification translation cost

A Specification that runs `isSatisfiedBy` in Java is O(N) over the *entire* aggregate set — it forces a `findAll` and a Java filter. Always translate to SQL when the count of rows justifies it.

```java
// in-memory only — loads everything
return orders.findAll().stream()
    .filter(spec::isSatisfiedBy)
    .toList();

// translated to SQL — database does the work
return em.createQuery(buildQueryFor(spec)).getResultList();
```

A composite Specification (`A and B and C`) translates to a `WHERE a AND b AND c`. The translation visitor lives in the repository implementation; the domain Specification stays pure.

When the translation is non-trivial, consider QueryDSL — it composes predicates and translates them automatically.

---

## 10. Avoid the `OPEN_SESSION_IN_VIEW` anti-idiom

Spring Boot's default has been `spring.jpa.open-in-view=true`. This keeps the persistence context open from the controller's entry to its exit, "fixing" lazy-load exceptions — and silently issuing N+1 queries during view rendering or JSON serialisation.

```yaml
spring:
  jpa:
    open-in-view: false
```

Turn it off. The application boots with explicit transaction boundaries. You will get `LazyInitializationException` on first run — that's the point. Fix the boundaries explicitly (fetch joins in the repository, `@Transactional(readOnly = true)` on the use case) and your queries are visible and bounded. See `find-bug.md` Bug 3 / Bug 7.

---

## Measuring matters more than tuning

Every optimisation here needs a baseline measurement. The tools to keep handy:

- **`spring.jpa.show-sql=true`** + a log filter — count the queries per request.
- **`p6spy`** or **`datasource-proxy`** — wrap the DataSource and log timings.
- **Hibernate Statistics** (`hibernate.generate_statistics=true`) — counts second-level cache hits and lazy loads.
- **`EXPLAIN ANALYZE`** in the database — once you have a slow query, the optimiser plan is the authority.

Optimising blind makes things worse more often than not. The repository's job is to be *boring* and *fast*; the only way to know which it is, is to measure.

---

## Quick rules

- [ ] **One fetch join per `@OneToMany` per query.** Use `@BatchSize` for the second collection.
- [ ] **Never expose `findAll` to production callers** of large tables. Paginate.
- [ ] **`@Transactional(readOnly = true)`** on every read-only use case.
- [ ] **Project to DTOs** for screen data — don't ship aggregates to the UI.
- [ ] **Second-level cache only for read-mostly reference data**, never for user-specific state.
- [ ] **`existsById` / `count` over `findById().isPresent`** — don't hydrate to check.
- [ ] **Translate Specifications to SQL**, don't filter in Java memory.
- [ ] **`spring.jpa.open-in-view=false`** — surface boundary problems instead of hiding them.
- [ ] **Size the connection pool by measurement**, not by guess.
- [ ] **Profile before you tune.** Log queries, count round trips, read EXPLAIN.

---

## What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| 8 hands-on exercises with worked solution                   | `tasks.md`         |
| 20 numbered interview Q&A                                   | `interview.md`     |
| Aggregates the repository wraps                              | `../03-aggregates/` |
| Entities that live inside aggregates                        | `../02-entities/`  |
| Domain services for cross-aggregate logic                   | `../05-domain-services/` |

---

**Memorize this:** Repository performance is about *count of round trips*, not clever SQL. Fetch joins for known scope, batch fetch for unpredictable scope, projections for screens. Cache only what is read often and changes rarely. Turn `open-in-view` off so the problems show up in tests, not in production at 3 a.m.
