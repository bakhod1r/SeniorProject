# Entities — Optimize

Ten performance angles for entities in JPA/Hibernate systems. Each section names a mechanism, the cost it imposes, the optimisation, and the trade-off.

---

## 1. First-level cache (identity map)

Within one persistence context, `em.find(E.class, id)` returns the same Java reference on repeated calls. The first call hits the DB; subsequent calls return the cached instance — zero queries.

```java
Customer a = em.find(Customer.class, id);   // SELECT
Customer b = em.find(Customer.class, id);   // no SELECT — identity map hit
a == b;                                     // true
```

**Win.** Avoiding repeated lookups within a request is automatic and free.

**Cost.** The persistence context grows as you load entities. Long-lived sessions leak memory. **Rule:** keep sessions request-scoped (Spring default) or unit-of-work-scoped.

---

## 2. Second-level cache (process-wide)

The L2 cache lives outside the persistence context and can be shared across sessions/threads.

```java
@Entity
@Cacheable
@org.hibernate.annotations.Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
public class Country {
    @Id private String iso2;
    private String name;
}
```

Combine with a provider (Ehcache, Caffeine, Infinispan, Hazelcast) in `persistence.xml`/`application.yml`:

```yaml
spring.jpa.properties.hibernate.cache.use_second_level_cache: true
spring.jpa.properties.hibernate.cache.region.factory_class: jcache
```

**Win.** Read-heavy reference data (countries, currencies, product catalogue) loads from in-memory cache, not DB.

**Cost.** Invalidation is hard. Use L2 only for entities that change rarely. Never put a high-write entity in L2 — invalidation chatter kills the benefit.

**Strategies:**
- `READ_ONLY` — fastest, no invalidation; truly immutable data.
- `NONSTRICT_READ_WRITE` — eventual consistency; OK for tolerated stale reads.
- `READ_WRITE` — soft locks during write; correct, slower.
- `TRANSACTIONAL` — full XA transaction; rarely used.

---

## 3. Query cache — different from L2

```yaml
spring.jpa.properties.hibernate.cache.use_query_cache: true
```

```java
em.createQuery("FROM Country WHERE region = :r")
  .setParameter("r", region)
  .setHint("org.hibernate.cacheable", true)
  .getResultList();
```

Caches the *list of ids* returned by a query. Each id is then resolved through the L2 cache.

**Win.** Frequently re-issued lookup queries (with the same parameters) skip the database.

**Cost.** Cache invalidation triggers on every write to any of the involved tables. Useless if the table is written to frequently. Use only for genuinely read-heavy lookup queries.

---

## 4. Dirty checking — how it actually works

When you mutate a managed entity and flush, Hibernate compares the current field values to the *snapshot* it took at load time. Changed fields → UPDATE.

```java
Customer c = em.find(Customer.class, id);   // snapshot taken
c.changeEmail("new@x.com");                  // field changed
em.flush();                                   // diff → UPDATE customers SET email = ?
```

**Cost.** Hibernate keeps a copy of every loaded entity. Two memory copies per managed entity. For 10,000 entities in one session, this matters.

**Optimization.** Use `hibernate.bytecode.use_reference_optimization` (default true in Hibernate 6) — bytecode-enhanced entities track dirty fields directly without a snapshot. Requires the Hibernate Gradle/Maven plugin.

Alternative: read-only mode skips dirty checking entirely.

```java
em.createQuery("FROM Customer")
  .setHint("org.hibernate.readOnly", true)
  .getResultList();
```

Now no snapshot is kept; updates are not propagated. Great for reporting reads.

---

## 5. Lazy load — N+1 detection and fix

The N+1 query pattern: load 1 parent + 1 SELECT per parent child collection. Classic killer of throughput.

```java
List<Order> orders = em.createQuery("FROM Order", Order.class).getResultList();
for (Order o : orders) {
    o.getItems().size();             // 1 SELECT per order
}
```

**Detection.** Hibernate's `org.hibernate.stat.Statistics` exposes query counts:

```java
SessionFactory sf = ...;
sf.getStatistics().setStatisticsEnabled(true);
// after request: sf.getStatistics().getQueryExecutionCount();
```

Tools: `datasource-proxy` for SQL logging, `p6spy` for transparent JDBC interception, Hypersistence Utils for query-count assertions in tests.

**Fixes:**

- **`JOIN FETCH`:**
  ```java
  em.createQuery("FROM Order o JOIN FETCH o.items WHERE o.status = :s", Order.class)
    .setParameter("s", OrderStatus.SUBMITTED);
  ```
- **Entity graphs:**
  ```java
  @NamedEntityGraph(name = "Order.withItems", attributeNodes = @NamedAttributeNode("items"))
  ```
  ```java
  em.find(Order.class, id, Map.of("jakarta.persistence.loadgraph", graph));
  ```
- **DTO projection** — skip the entity entirely:
  ```java
  em.createQuery("SELECT new OrderDTO(o.id, COUNT(i)) FROM Order o JOIN o.items i GROUP BY o.id");
  ```

---

## 6. Batch fetch — multiplexed lazy loads

```java
@Entity
@BatchSize(size = 50)             // Hibernate-specific
public class Order { ... }
```

Or globally:

```yaml
spring.jpa.properties.hibernate.default_batch_fetch_size: 25
```

Instead of N queries (`WHERE id = ?`), Hibernate issues `WHERE id IN (?, ?, ?, ...)` for up to 25 ids at a time.

**Win.** N+1 becomes (N/25)+1 with no code change.

**Cost.** Less surgical than JOIN FETCH; large IN-lists strain the query planner on some databases. Postgres handles up to a few thousand fine; Oracle has a hard 1,000 limit.

---

## 7. Batch inserts and updates

```yaml
spring.jpa.properties.hibernate.jdbc.batch_size: 50
spring.jpa.properties.hibernate.order_inserts: true
spring.jpa.properties.hibernate.order_updates: true
```

Hibernate groups consecutive INSERTs / UPDATEs into a single JDBC batch. 50× fewer round-trips.

**Caveat.** `GenerationType.IDENTITY` **disables** batch inserts because Hibernate needs the id back per row. Use `SEQUENCE` (with `allocationSize >= batch_size`) or `UUID` for write-heavy tables.

---

## 8. Identity hashcode stability

A subtle perf concern: `HashSet` performance degrades if many entities share a hash code.

```java
@Override public int hashCode() { return getClass().hashCode(); }   // constant
```

This is correct (stable across lifecycle), but means a `HashSet<Order>` with 10,000 distinct orders has them all in one bucket — `contains` becomes O(n).

**Fix at scale.** Use `id.hashCode()` from construction by switching to UUID. Now every entity has a distinct hash code, the constant-hash trick is unneeded, and large sets perform like normal.

```java
@Id
@org.hibernate.annotations.UuidGenerator(style = UuidGenerator.Style.TIME)
private UUID id = UUID.randomUUID();    // assigned at construction

@Override public int hashCode() { return id.hashCode(); }
```

---

## 9. Read-only paths and stateless sessions

For pure read paths (reports, exports), the persistence context is overhead.

```java
StatelessSession ss = sessionFactory.openStatelessSession();
try {
    try (Stream<Order> orders = ss.createQuery("FROM Order", Order.class).getResultStream()) {
        orders.forEach(this::process);
    }
} finally {
    ss.close();
}
```

`StatelessSession`:

- No persistence context (no identity map).
- No dirty checking (no snapshots).
- No lazy loading (no proxies).
- No cascading.

For bulk processing of millions of rows, this is the difference between OOM and steady throughput.

---

## 10. Connection-level optimizations that affect entities

The entity tier sits on top of JDBC; entity perf isn't isolated from connection settings.

- **HikariCP `maximumPoolSize`** — too small: queries queue; too large: DB context-switches. Start at `(2 × cores) + spindles` and measure.
- **Prepared statement cache** — `hibernate.query.plan_cache_max_size` controls Hibernate-side; `pgjdbc`'s `prepareThreshold` controls server-side. Hot queries must be prepared.
- **Fetch size** — `hibernate.jdbc.fetch_size: 100` for large result sets — fewer round-trips to retrieve N rows.
- **Auto-commit off** — Hibernate handles this, but raw JDBC misuse around entities can re-enable autocommit per statement and 10× the round-trips.

---

## Profiling checklist

Before optimizing, prove a bottleneck exists:

```java
// 1. Enable Hibernate stats
hibernate.generate_statistics: true

// 2. Log slow queries
hibernate.session.events.log.LOG_QUERIES_SLOWER_THAN_MS: 100

// 3. Count queries per request
sessionFactory.getStatistics().getQueryExecutionCount();

// 4. Use Hypersistence Utils in tests:
SQLStatementCountValidator.reset();
performWorkUnit();
SQLStatementCountValidator.assertSelectCount(1);   // FAIL if any N+1
```

The fastest entity is the one whose performance you've actually measured.

---

## Quick rules

- L1 cache is automatic; keep sessions request-scoped so it doesn't leak.
- L2 cache is for slow-changing reference data only; never high-write tables.
- Dirty checking costs memory — use `readOnly` query hint for reporting reads.
- N+1 is the dominant entity perf bug; detect with statistics, fix with `JOIN FETCH` / entity graph / DTO.
- `@BatchSize` is a no-code fallback for N+1 you can't surgically fix.
- `IDENTITY` disables batch inserts; pick `SEQUENCE` or `UUID` for write-heavy tables.
- UUID v7 ids at construction make `hashCode = id.hashCode()` stable and fast.
- For bulk reads, `StatelessSession` skips the persistence context entirely.
- Always profile before optimizing — Hibernate statistics + SQL logging tell you which bug you actually have.
- The biggest entity perf win is usually not "make the entity faster"; it's "don't load the entity at all" (DTO projection).

---

**Memorize this:** entity performance is governed by three caches (L1, L2, query), one bookkeeping cost (dirty checking via snapshots), and one query pattern (N+1 via lazy associations). Most production entity slowness is N+1 in disguise — detect with statistics, fix with JOIN FETCH, entity graphs, batch size, or DTO projection. Choose `SEQUENCE` or `UUID v7` over `IDENTITY` for write-heavy tables to keep batching alive. Use `StatelessSession` for bulk reads. Use L2 only for slow-changing reference data. Always profile; the answer to "where is the bottleneck?" is rarely where you'd guess. Vlad Mihalcea's *High-Performance Java Persistence* gives the deep playbook.
