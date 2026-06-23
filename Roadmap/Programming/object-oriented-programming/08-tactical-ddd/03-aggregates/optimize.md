# DDD Tactical: Aggregates — Optimize

> **What?** Ten angles for keeping aggregate operations fast at production scale. The aggregate is the unit of *load* and *write*: if it's too big, every command pays the price; if its fetch plan is wrong, you get N+1 queries; if you event-source it without snapshots, replay cost grows unbounded. This file collects the levers that matter, with measurable trade-offs and JPA-specific guidance from Hibernate's behaviour.
> **How?** Measure first — the slow path is almost never where you guessed. Then apply the smallest lever that closes the gap, prefer aggregate redesign over JPA tuning, and remember that *every* command-side optimisation must preserve the aggregate's invariants. Reads can take shortcuts that writes cannot.

---

## 1. Aggregate size determines load cost

The first and biggest lever: **make the aggregate smaller**.

A `Customer` aggregate that owns "all orders ever placed" will load megabytes of history on every command. A `Customer` aggregate with just identity, profile, and preferences loads in microseconds.

| Aggregate shape                                   | Load size  | Conflict rate | Notes                              |
| ------------------------------------------------- | ---------- | ------------- | ---------------------------------- |
| Customer + all Orders (lifetime)                  | ~MB        | High          | Don't.                             |
| Customer header only; Orders separate aggregate   | ~KB        | Low           | The right answer in most cases.    |
| Order with line items (typical ≤ 50)              | ~KB        | Low           | Fits comfortably in one round-trip.|

Before tuning JPA, ask: *am I loading data this command does not need?* If yes, the boundary is wrong; no fetch plan will save you.

---

## 2. Lazy loading on collections

JPA's `FetchType.LAZY` defers loading children until they're touched. This is the right *default* but it must be paired with explicit eager loading for commands that need the whole aggregate.

```java
@OneToMany(mappedBy = "order", cascade = ALL, orphanRemoval = true, fetch = FetchType.LAZY)
private List<LineItem> items = new ArrayList<>();
```

If your command path is "load the order, mutate one field, save", lazy is perfect — children never load. If your command path is "load the order, add an item, recompute the total", you need the items eagerly. Don't toggle `fetch = EAGER` globally — that creates large cartesian products on multi-collection roots. Use `@EntityGraph` per query.

---

## 3. Entity graphs for whole-aggregate loads

`@EntityGraph` tells the persistence provider what to fetch for *this* query, leaving the field's default `LAZY` alone everywhere else.

```java
public interface OrderRepository extends JpaRepository<Order, OrderId> {
    @EntityGraph(attributePaths = {"items"})
    Optional<Order> findFullById(OrderId id);
}
```

For commands, this produces one SQL with a join — no N+1. For queries that only need the header, use the default `findById`.

Trade-off: joining several collections in one query causes Cartesian explosion (rows = n1 × n2 × ...). With two or more child collections, prefer two queries with batching over one mega-join.

---

## 4. Batch fetching for collection traversals

When you must process many aggregates, `@BatchSize` on collections turns N+1 into N/batch+1.

```java
@OneToMany(mappedBy = "order", fetch = FetchType.LAZY)
@BatchSize(size = 100)
private List<LineItem> items;
```

Loading 1000 orders without batching = 1001 queries (one for orders, one per order's items). With `@BatchSize(100)`, you get 11 queries (1 + 10). For read paths only — write paths should already be one-aggregate-per-transaction.

---

## 5. Event sourcing: replay cost

Event-sourced aggregates rebuild state by replaying events. For an aggregate with N events, replay is O(N) — fine at N=10, painful at N=10,000.

| Event count | Naive replay time | With snapshot every 100 |
| ----------- | ----------------- | ----------------------- |
| 10          | < 1 ms            | < 1 ms                  |
| 1,000       | ~10 ms            | ~1 ms                   |
| 10,000      | ~100 ms           | ~1 ms                   |
| 100,000     | ~1 s              | ~1 ms                   |

The numbers above are rough; real measurements depend on event size and the cost of `mutate()`. The shape of the curve is the point: without snapshots, replay cost grows linearly with the aggregate's history.

---

## 6. Snapshot strategies

Three common strategies for event-sourced aggregates:

1. **Every N events** — straightforward, predictable storage growth. N=100 is a common default.
2. **Time-based** — write a snapshot every M minutes if the aggregate has changed since the last snapshot. Better for low-throughput aggregates.
3. **Read-triggered** — when a load notices a long replay, persist the resulting state as a snapshot. Self-tuning but bursty.

```java
public Optional<Order> findById(OrderId id) {
    Optional<Snapshot> snap = snapshots.latest(id.value());
    long since = snap.map(Snapshot::version).orElse(0L);
    List<DomainEvent> tail = events.loadSince(id.value(), since);
    Order order = snap.map(Order::fromSnapshot).orElseGet(Order::new);
    order.rehydrateFrom(tail);
    if (tail.size() > SNAPSHOT_THRESHOLD) snapshots.save(Snapshot.of(order));
    return Optional.of(order);
}
```

Storage cost: a snapshot is roughly the size of the aggregate state; events are usually smaller individually but accumulate. Snapshots trade storage for replay time.

---

## 7. JPA `@OneToMany` vs `@ElementCollection`

For child entities with identity, use `@OneToMany`. For value-object collections (no identity, no lifecycle of their own), use `@ElementCollection` — Hibernate manages it with a delete-and-re-insert strategy by default, which is fine for small collections but expensive for large ones.

```java
// Value objects — collection
@ElementCollection
@CollectionTable(name = "order_tags")
private Set<Tag> tags = new HashSet<>();

// Entities — child rows with their own ids
@OneToMany(mappedBy = "order", cascade = ALL, orphanRemoval = true)
private List<LineItem> items = new ArrayList<>();
```

Sizes: aggregates with more than ~100 child rows should think hard about whether those children are really children, or really a separate aggregate referenced by id.

---

## 8. Hydrating without Hibernate proxies (read side)

For read-heavy aggregates, the cost of Hibernate proxies, dirty checking, and the first-level cache is real. For read paths, bypass JPA:

```java
public OrderView findOrderView(OrderId id) {
    return jdbc.queryForObject(
        "SELECT id, status, total_cents, placed_at FROM order_view WHERE id = ?",
        new OrderViewRowMapper(),
        id.value());
}
```

This is CQRS in practice — the write side uses JPA aggregates; the read side uses raw SQL into DTOs. Reads do not need invariants. Don't pay for what you don't use.

---

## 9. Pessimistic vs optimistic locking under contention

Optimistic locking is cheaper in the happy path (no DB lock, just a version check). It becomes expensive when conflict rate is high — every conflict pays the cost of load + apply + fail + retry.

Rule of thumb:
- Conflict rate < 1% → optimistic, retry 3x.
- Conflict rate 1–10% → still optimistic, but tune retry backoff (e.g., 50ms × 2).
- Conflict rate > 10% → consider pessimistic, or *more importantly*, ask whether the aggregate is too big or the workload is misshapen.

Pessimistic locking caps throughput at the rate at which the slowest command completes — but eliminates retry waste.

---

## 10. Write batching and connection pooling

For bulk-create operations (importing 10,000 customers), turn on Hibernate's batch inserts:

```yaml
spring.jpa.properties.hibernate.jdbc.batch_size: 50
spring.jpa.properties.hibernate.order_inserts: true
spring.jpa.properties.hibernate.order_updates: true
```

But: still one transaction per aggregate. Bulk-create *N* aggregates with *N* transactions, each batched internally. Do not lump 10,000 aggregates into one transaction even when bulk-inserting — that's a different rule violation (one aggregate per transaction).

---

## Quick rules

- [ ] Make the aggregate smaller before tuning the fetch plan.
- [ ] Default collections to `LAZY`; use `@EntityGraph` for commands that need the whole aggregate.
- [ ] `@BatchSize` for read-side traversals of many aggregates; never relied on by write paths.
- [ ] Event-sourced aggregates need snapshots once history exceeds ~1000 events.
- [ ] CQRS reads bypass JPA: raw SQL into DTOs is fine when invariants don't apply.
- [ ] Optimistic locking by default; pessimistic only when measured conflict rate justifies it.
- [ ] One transaction per aggregate, even during bulk operations. Batching is intra-transaction, not cross-aggregate.
- [ ] Avoid `@ManyToOne` across aggregate boundaries — it tempts cascade and lazy-load chains that cross the boundary.

---

## What's next

| Topic                                                | File                          |
| ---------------------------------------------------- | ----------------------------- |
| Hands-on exercises                                   | `tasks.md`                    |
| Interview Q&A                                        | `interview.md`                |
| Bug catalogue                                        | `find-bug.md`                 |
| Entities                                             | `../01-entities/`             |
| Value objects                                        | `../02-value-objects/`        |
| Repository concept                                   | `../04-repository-concept/`   |
| Domain services                                      | `../05-domain-services/`      |

---

**Memorize this:** Optimising aggregates is mostly about *size* — small aggregates are cheap to load, cheap to lock, cheap to event-source. After that, the levers are entity graphs (avoid N+1 on the write path), batch fetching (avoid N+1 on the read path), snapshots (cap event-replay cost), CQRS (don't pay JPA tax on reads), and lock-mode choice (optimistic by default, pessimistic only under measured contention). Always preserve invariants — fast invalid code is not progress.
