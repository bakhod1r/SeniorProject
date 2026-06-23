# Entities — Professional

> **What?** The JPA/Hibernate machinery a working backend engineer must control: `@Id` and the four `@GeneratedValue` strategies (IDENTITY, SEQUENCE, AUTO, UUID), surrogate vs. natural key in real schemas, optimistic locking via `@Version`, soft delete with `@SQLDelete` and `@Where`, and the architecturally important question of whether to keep the domain entity and the JPA entity as one class or two.
> **How?** By choosing each annotation deliberately — knowing what SQL Hibernate will emit, when ids are assigned, what happens on flush, what optimistic locking actually checks — and by separating domain concerns from persistence concerns when the codebase justifies the cost.

---

## 1. `@Id` and `@GeneratedValue` strategies in depth

```java
@Entity
public class Customer {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
}
```

There are four strategies. Each has different timing and SQL behaviour:

### a. `IDENTITY` — column auto-increment

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

- DB column is `BIGINT AUTO_INCREMENT` (MySQL) or `BIGSERIAL` (Postgres) or `IDENTITY` (SQL Server, H2).
- Id is assigned **after** the INSERT — Hibernate must execute the INSERT immediately on `persist()` to get the id back. This **disables batch inserts** for that entity.
- Simple, fast for low-volume writes, awkward at scale.

### b. `SEQUENCE` — database sequence

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "cust_seq")
@SequenceGenerator(name = "cust_seq", sequenceName = "customer_seq", allocationSize = 50)
private Long id;
```

- Hibernate pre-fetches `allocationSize` ids in one round-trip and assigns them client-side.
- Id is known **before** INSERT — batch inserts work.
- Postgres and Oracle native; emulated on others.
- `allocationSize = 50` means one sequence call per 50 entities (huge throughput win).

### c. `AUTO` — let the provider decide

```java
@Id
@GeneratedValue(strategy = GenerationType.AUTO)
private Long id;
```

- Hibernate picks based on dialect. On Postgres, it used to mean SEQUENCE (with a shared `hibernate_sequence`) — that legacy default has bitten many teams. **Avoid `AUTO` in new code**; be explicit.

### d. `UUID` — application-generated

```java
@Id
@GeneratedValue(strategy = GenerationType.UUID)   // since JPA 3.1
private UUID id;
```

- Hibernate assigns at `persist()` time (or you can pre-assign yourself).
- Available as `@org.hibernate.annotations.UuidGenerator` on Hibernate 6 with `style = TIME` for UUID v7.
- 128 bits per id; mitigate with binary representation:

```java
@Id
@Column(columnDefinition = "BINARY(16)")
private UUID id;
```

Or with Postgres-native UUID type, which stores it as 16 bytes natively.

| Strategy | Id known before INSERT? | Batch insert? | Default index locality | Notes |
| -------- | ----------------------- | ------------- | ---------------------- | ----- |
| IDENTITY | No                      | No            | Excellent              | Disables batching |
| SEQUENCE | Yes (pre-fetch)         | Yes           | Excellent              | Postgres/Oracle |
| AUTO     | Depends                 | Depends       | Depends                | Avoid |
| UUID v7  | Yes                     | Yes           | Good                   | Best of both worlds |
| UUID v4  | Yes                     | Yes           | Poor                   | Avoid for high-write tables |

---

## 2. Surrogate vs natural key — schema reality

A **surrogate** key has no meaning outside the system (a number/UUID assigned for our own convenience). A **natural** key is something the world already uses to identify the thing (ISBN, VIN, email).

```java
// Surrogate primary key, natural unique constraint on top
@Entity
@Table(name = "users",
       uniqueConstraints = @UniqueConstraint(columnNames = "email"))
public class User {
    @Id private UUID id;                           // surrogate — never changes
    @Column(nullable = false) private String email; // natural — may change
}
```

This is the canonical professional pattern: surrogate PK + uniqueness constraint on the human identifier. You get:

- Stable foreign keys (no cascading updates when someone changes email).
- A short, indexable PK column.
- A queryable natural identifier with database-enforced uniqueness.

The mistake is using the natural key *as* the PK and then discovering, three years in, that it has to change. Surrogate is almost always the right call.

---

## 3. Optimistic locking with `@Version`

```java
@Entity
public class Account {
    @Id private UUID id;
    @Version private long version;
    private Money balance;
}
```

What Hibernate emits:

```sql
UPDATE account SET balance = ?, version = ? WHERE id = ? AND version = ?
```

If two transactions both loaded `version = 7`, both modified, and both flushed, only the first's UPDATE matches (rows affected = 1, version becomes 8). The second's UPDATE matches zero rows; Hibernate throws `OptimisticLockException` (wrapped as `StaleObjectStateException`). The application typically retries.

```java
@Transactional
public void debit(UUID accountId, Money amount) {
    int attempts = 0;
    while (true) {
        try {
            Account a = accountRepo.findById(accountId).orElseThrow();
            a.debit(amount, TransactionReason.PURCHASE);
            accountRepo.save(a);
            return;
        } catch (OptimisticLockException ex) {
            if (++attempts >= 3) throw ex;
            // retry with fresh state
        }
    }
}
```

Use `@Version` *on every entity that gets updated*, not just on a chosen few. The cost is one extra column (`bigint` or `int`) and one `AND version = ?` predicate per UPDATE.

Versioning columns can be:

- `long` / `int` — incrementing counter (default).
- `Instant` / `Timestamp` — last-modified time. Less reliable on systems where two updates can land in the same clock tick.

Numeric is strongly preferred.

---

## 4. Soft delete — `@SQLDelete` and `@Where`

For audit/compliance reasons, many systems never physically `DELETE` rows. Instead, they set a `deleted = true` (or `deleted_at = NOW()`) flag.

```java
@Entity
@Table(name = "customers")
@SQLDelete(sql = "UPDATE customers SET deleted_at = NOW() WHERE id = ?")
@Where(clause = "deleted_at IS NULL")
public class Customer {
    @Id private UUID id;
    @Column(name = "deleted_at") private Instant deletedAt;
    // ...
}
```

- `@SQLDelete` rewrites `em.remove(c)` into the UPDATE statement.
- `@Where` filters every SELECT to exclude already-deleted rows.
- `@SQLDelete` is Hibernate-specific (no JPA equivalent).

Caveats:

- `@Where` applies to associations too — eager-loading a deleted child will return null/empty, which is usually correct.
- Unique constraints on natural keys must accommodate "deleted then re-created" — typically by indexing `(email) WHERE deleted_at IS NULL` (partial unique index in Postgres) or by appending the deleted timestamp to the unique column.
- "Restore deleted" requires raw SQL (bypassing `@Where`).

---

## 5. Domain Entity vs JPA Entity — when to split

Two valid choices, each appropriate in different contexts:

### Single-class (domain == JPA entity)

```java
package shop.order;

@Entity
@Table(name = "orders")
public class Order {
    @Id private UUID id;
    @Version private long version;
    @Enumerated(EnumType.STRING) private OrderStatus status;
    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
    @JoinColumn(name = "order_id")
    private List<LineItem> items = new ArrayList<>();

    public void addItem(ProductId p, int qty, Money price) {
        requireDraft();
        items.add(new LineItem(p, qty, price));
    }
    public void submit() {
        requireDraft();
        if (items.isEmpty()) throw new IllegalStateException("Empty order");
        this.status = OrderStatus.SUBMITTED;
    }
    private void requireDraft() {
        if (status != OrderStatus.DRAFT) throw new IllegalStateException("Not draft");
    }
}
```

Pros: one file, no mapper, easy to onboard. Cons: domain depends on JPA; can't unit-test without `EntityManagerFactory` mock; harder to swap persistence.

### Two-class (domain pure POJO; JPA record mirrors it)

```java
// shop/order/Order.java — pure domain, no jakarta.* imports
package shop.order;
public final class Order { ... }

// shop/order/infrastructure/OrderRecord.java — JPA-only
package shop.order.infrastructure;
@Entity @Table(name = "orders")
public class OrderRecord {
    @Id private UUID id;
    @Version private long version;
    private String status;
    // ... no behaviour, only mapping
}

// shop/order/infrastructure/JpaOrderRepository.java
package shop.order.infrastructure;
public class JpaOrderRepository implements OrderRepository {
    public Optional<Order> find(OrderId id) {
        return em.find(OrderRecord.class, id.value())
                 .map(OrderMapper::toDomain);
    }
    public void save(Order o) {
        OrderRecord r = OrderMapper.toRecord(o);
        em.merge(r);
    }
}
```

Pros: domain depends on no framework; trivial to test; persistence swappable. Cons: mapper drift (one field added, mapper forgotten); two test surfaces; slower to write.

**Senior rule:** start single-class. Split into two only when (a) you have evidence you need ORM-free domain tests, or (b) the JPA mapping is contorting the domain model (e.g., you need a child entity in the database for performance but it doesn't belong in the domain). Splitting prematurely is a top cause of "the boring code is in the mapper, the interesting code is buried" syndrome.

---

## 6. Equality and identity inside Hibernate's persistence context

Hibernate guarantees that within one persistence context, two loads of the same id return *the same Java reference*:

```java
Customer a = em.find(Customer.class, id);
Customer b = em.find(Customer.class, id);
a == b;                       // true — identity map
```

This is the **first-level cache** (or identity map). It means that *within a single session*, `==` and `equals` agree. Across sessions, `==` no longer holds; you rely on `equals` by id.

This is also why a session-scoped entity is unsafe to leak across request threads — two threads using the same persistence context end up sharing mutable entities, and Hibernate's session is documented as not thread-safe.

---

## 7. Cascade and orphan-removal — entity-level decisions

```java
@OneToMany(
    mappedBy = "order",
    cascade = CascadeType.ALL,
    orphanRemoval = true,
    fetch = FetchType.LAZY)
private List<LineItem> items = new ArrayList<>();
```

- `CascadeType.PERSIST` — saving the parent saves new children.
- `CascadeType.MERGE` — merging the parent merges children.
- `CascadeType.REMOVE` — deleting the parent deletes children.
- `CascadeType.ALL` — all of the above plus refresh/detach.
- `orphanRemoval = true` — removing a child from the collection issues DELETE for that row.

The combination `ALL + orphanRemoval = true` matches the *aggregate ownership* semantics: child entities live and die with their parent. This is exactly the JPA-level encoding of "non-root entity inside an aggregate" from senior-level DDD.

Cascade across aggregate boundaries (Customer ↔ Order) is **a design mistake**; cross-aggregate references should be by id, with the other aggregate loaded separately via its own repository.

---

## 8. Auditing — `@CreatedDate`, `@LastModifiedDate`, `@Version`

```java
@Entity
@EntityListeners(AuditingEntityListener.class)
public class Customer {
    @Id private UUID id;
    @Version private long version;

    @CreatedDate
    @Column(updatable = false)
    private Instant createdAt;

    @LastModifiedDate
    private Instant updatedAt;

    @CreatedBy
    @Column(updatable = false)
    private String createdBy;

    @LastModifiedBy
    private String lastModifiedBy;
}
```

Spring Data's auditing populates these automatically when paired with `@EnableJpaAuditing`. They are operational metadata — not domain attributes — and belong on every persistent entity, much like `@Version`.

---

## 9. Quick rules

- Choose one id strategy per codebase. UUID v7 default; SEQUENCE for legacy `Long` schemas; never `AUTO`.
- Surrogate PK + unique constraint on natural identifier — almost always the right call.
- `@Version` on every entity that gets UPDATEs. Numeric, not timestamp.
- Soft delete via `@SQLDelete + @Where`; index unique columns partially to allow recreation.
- Start single-class (domain == JPA entity); split only on evidence.
- `@OneToMany` for owned children: `CascadeType.ALL + orphanRemoval = true + LAZY` is the default for aggregate-internal entities.
- Never cascade across aggregate boundaries; reference other aggregates by id.
- `equals`/`hashCode` by id only; constant hashcode while id is null; UUID at construction eliminates that whole problem.
- `IDENTITY` disables batch inserts — for write-heavy tables prefer SEQUENCE or UUID.
- Spring Data auditing fields (`@CreatedDate`, `@LastModifiedDate`) plus `@Version` belong on every entity by default.

---

## 10. What's next

| Topic                                                                  | File              |
| ---------------------------------------------------------------------- | ----------------- |
| Formal Entity contract — JLS/JPA spec references                       | `specification.md` |
| Bugs around `@Id`, `@Version`, Lombok @Data, lazy proxies              | `find-bug.md`      |
| Hibernate caches, dirty checking, batch hints                          | `optimize.md`      |
| Hands-on exercises                                                     | `tasks.md`         |
| Interview Q&A                                                          | `interview.md`     |
| Value Objects — what JPA `@Embeddable` is for                          | `../01-value-objects/` |
| Aggregates — entity clusters with one root                             | `../03-aggregates/` |
| Repositories — how aggregate roots are loaded and stored               | `../04-repository-concept/` |

---

**Memorize this:** at the JPA layer, an entity is `@Id` + an id strategy + `@Version` + behaviour-bearing methods + the persistence annotations that mirror your aggregate ownership. Pick UUID v7 (or SEQUENCE with `allocationSize`) over `IDENTITY` whenever you can; always carry a surrogate PK with the human identifier as a unique constraint; soft-delete via `@SQLDelete`/`@Where`; audit via Spring Data listeners. Start with one class that's both domain and JPA entity; split only when the evidence justifies the cost. The JPA professional knows what SQL each annotation emits, when ids are assigned, what optimistic locking actually checks, and why `AUTO` is a footgun. Vlad Mihalcea's *High-Performance Java Persistence* (2016, 2nd ed.) is the canonical reference.
