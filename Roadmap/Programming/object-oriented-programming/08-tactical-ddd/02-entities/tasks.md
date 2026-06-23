# Entities — Tasks

Eight exercises that exercise the key entity skills: identity, equality, invariants, JPA mapping, versioning, lifecycle. Each lists the requirement, the validation criteria, and a worked solution.

---

## Task 1 — Design a `Customer` entity

**Requirement.** Build a `Customer` entity with:

- Surrogate UUID id, assigned at construction.
- Mutable `email` and `fullName` (changed via behaviour methods).
- An invariant: a customer cannot be `deactivated` and then have `changeEmail` succeed.
- Identity-based equality and hash code.
- A no-arg protected constructor for JPA.

**Validation.**

- Constructor throws on null arguments.
- `customer1.equals(customer2)` iff their ids are equal.
- `customer.hashCode()` does not change when `email` changes.
- `customer.deactivate(); customer.changeEmail("x")` throws `IllegalStateException`.

**Worked solution.**

```java
@Entity
@Table(name = "customers")
public class Customer {

    @Id
    @Column(updatable = false)
    private UUID id;

    @Column(nullable = false) private String email;
    @Column(nullable = false) private String fullName;
    @Enumerated(EnumType.STRING) private Status status = Status.ACTIVE;
    @Version private long version;

    protected Customer() { }

    public Customer(String email, String fullName) {
        this.id       = UUID.randomUUID();
        this.email    = Objects.requireNonNull(email);
        this.fullName = Objects.requireNonNull(fullName);
    }

    public UUID id()         { return id; }
    public String email()    { return email; }
    public String fullName() { return fullName; }
    public Status status()   { return status; }

    public void changeEmail(String newEmail) {
        if (status != Status.ACTIVE) {
            throw new IllegalStateException("Inactive customer cannot change email");
        }
        this.email = Objects.requireNonNull(newEmail);
    }

    public void deactivate() { this.status = Status.INACTIVE; }

    public enum Status { ACTIVE, INACTIVE }

    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Customer that)) return false;
        return id.equals(that.id);
    }
    @Override public int hashCode() { return id.hashCode(); }
}
```

---

## Task 2 — Fix a `Set<Order>` identity bug

**Given.**

```java
public class Order {
    @Id private Long id;            // IDENTITY, null until persist
    private String description;

    @Override public int hashCode() { return Objects.hash(id, description); }
    @Override public boolean equals(Object o) {
        return o instanceof Order other && Objects.equals(id, other.id)
                                        && Objects.equals(description, other.description);
    }
}

Set<Order> orders = new HashSet<>();
Order o = new Order();
o.setDescription("blue mug");
orders.add(o);
em.persist(o);                       // id assigned
o.setDescription("blue mug, large"); // attribute changed
orders.contains(o);                  // returns false
```

**Fix the entity** so `orders.contains(o)` returns true regardless of id assignment and attribute changes.

**Validation.**

- `hashCode` does not depend on mutable attributes.
- After `em.persist(o)` and after later attribute changes, `contains` still returns true.

**Worked solution.**

```java
public class Order {
    @Id private Long id;
    private String description;

    @Override public int hashCode() { return getClass().hashCode(); }  // stable
    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Order other)) return false;
        return id != null && id.equals(other.id);
    }
}
```

Note: with `IDENTITY`, two transient orders are unequal (id is null) — equality requires `==`. Once persisted, equality is by id. Long-term fix: switch to UUID assigned at construction.

---

## Task 3 — Add `@Version` and exercise optimistic locking

**Requirement.**

- Add `@Version` to the `Account` entity.
- Write a JUnit test that simulates two parallel transactions debiting the same account.
- Verify the second transaction throws `OptimisticLockException`.

**Validation.**

- Without `@Version`, both transactions succeed; final balance is wrong.
- With `@Version`, only one succeeds; the other throws.

**Worked solution.**

```java
@Entity
public class Account {
    @Id private UUID id;
    @Version private long version;
    private Money balance;

    protected Account() { }
    public Account(UUID id, Money initial) {
        this.id = id; this.balance = initial;
    }
    public void debit(Money amount) {
        if (amount.isGreaterThan(balance)) throw new InsufficientFundsException();
        this.balance = balance.subtract(amount);
    }
}

@Test
void concurrentDebitsRaiseOptimisticLock() {
    UUID id = UUID.randomUUID();
    inTx(em -> em.persist(new Account(id, Money.of(100))));

    EntityManager em1 = emf.createEntityManager();
    EntityManager em2 = emf.createEntityManager();
    em1.getTransaction().begin();
    em2.getTransaction().begin();

    Account a1 = em1.find(Account.class, id);
    Account a2 = em2.find(Account.class, id);   // same version

    a1.debit(Money.of(30));
    a2.debit(Money.of(40));

    em1.getTransaction().commit();              // succeeds: version 0 → 1
    assertThrows(OptimisticLockException.class, em2.getTransaction()::commit);
}
```

---

## Task 4 — Migrate from natural key to surrogate key

**Given.** Existing schema uses `email` as PK on `users` table; legacy data must be preserved; foreign keys from other tables reference `users.email`.

**Requirement.** Migrate to UUID surrogate PK with email kept as a unique column. Provide:

- The SQL migration steps.
- The new JPA entity.
- A backfill plan that maintains FK integrity.

**Validation.**

- Old `email` references continue to resolve to the same user post-migration.
- Email can now change without breaking FKs.
- No duplicate UUIDs.

**Worked solution.**

```sql
-- Step 1: add nullable UUID column
ALTER TABLE users ADD COLUMN id UUID;

-- Step 2: backfill
UPDATE users SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE users ALTER COLUMN id SET NOT NULL;

-- Step 3: add new FK columns to dependent tables
ALTER TABLE orders ADD COLUMN user_id UUID;
UPDATE orders o SET user_id = u.id FROM users u WHERE o.user_email = u.email;

-- Step 4: switch constraints
ALTER TABLE orders DROP CONSTRAINT orders_user_email_fkey;
ALTER TABLE users  DROP CONSTRAINT users_pkey;
ALTER TABLE users  ADD PRIMARY KEY (id);
ALTER TABLE users  ADD CONSTRAINT users_email_unique UNIQUE (email);
ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

-- Step 5: drop the old email columns from dependents (after release)
ALTER TABLE orders DROP COLUMN user_email;
```

```java
@Entity
@Table(name = "users", uniqueConstraints = @UniqueConstraint(columnNames = "email"))
public class User {
    @Id @Column(updatable = false) private UUID id;
    @Column(nullable = false) private String email;
    @Column(nullable = false) private String fullName;
    @Version private long version;
    // ...
}
```

---

## Task 5 — Implement soft delete

**Requirement.** Add soft-delete to `Customer`: `em.remove(customer)` should set `deleted_at = NOW()` instead of physically deleting. Subsequent queries should not return deleted customers.

**Validation.**

- After `em.remove(c)`, the row still exists with `deleted_at` set.
- `em.find(Customer.class, c.id())` returns null (because `@Where` filters).
- Email uniqueness still works for a re-created customer with the same email.

**Worked solution.**

```java
@Entity
@Table(name = "customers")
@SQLDelete(sql = "UPDATE customers SET deleted_at = NOW() WHERE id = ? AND version = ?")
@Where(clause = "deleted_at IS NULL")
public class Customer {
    @Id private UUID id;
    @Version private long version;
    @Column(name = "deleted_at") private Instant deletedAt;
    @Column(nullable = false) private String email;
    // ...
}
```

Partial unique index on email to allow re-creation:

```sql
CREATE UNIQUE INDEX customers_email_active_unique
ON customers(email) WHERE deleted_at IS NULL;
```

---

## Task 6 — Write `equals`/`hashCode` that survives Hibernate proxies

**Requirement.** Make `Customer`'s equals/hashCode work for both fully-loaded entities and `em.getReference` proxies.

**Validation.**

- `proxy.equals(fullEntity)` returns true when they share the same id.
- `fullEntity.equals(proxy)` returns true symmetrically.
- Works without `Hibernate.unproxy` calls leaking into application code.

**Worked solution.**

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Customer)) return false;
    Customer that = (Customer) Hibernate.unproxy(o);
    return id != null && id.equals(that.id);
}
@Override public int hashCode() { return getClass().hashCode(); }
```

The key: `instanceof` (accepts proxies, since the proxy is a subclass) + `Hibernate.unproxy` before accessing fields on `that`.

---

## Task 7 — Detect N+1 in a test

**Requirement.** Add an integration test that fails when `findAllOrders()` exhibits N+1.

**Validation.** Test passes when the implementation uses `JOIN FETCH`; test fails when it relies on lazy loading.

**Worked solution.**

```java
@Test
void findAllOrdersDoesNotNPlusOne() {
    // arrange — 10 orders, each with 5 items
    inTx(em -> {
        for (int i = 0; i < 10; i++) {
            Order o = new Order();
            for (int j = 0; j < 5; j++) o.addItem(productId(), 1, Money.of(10));
            em.persist(o);
        }
    });

    SQLStatementCountValidator.reset();
    List<Order> orders = orderRepo.findAllWithItems();
    orders.forEach(o -> o.getItems().size());
    SQLStatementCountValidator.assertSelectCount(1);   // exactly 1 SELECT
}
```

```java
@Query("SELECT o FROM Order o LEFT JOIN FETCH o.items")
List<Order> findAllWithItems();
```

---

## Task 8 — Detect identity-vs-value-object misclassification

**Requirement.** Given a list of candidate concepts, classify each as Entity or Value Object and justify.

| Concept                              | Entity or VO? | Why? |
| ------------------------------------ | ------------- | ---- |
| `Money` (an amount + currency)       |               |      |
| `BankAccount`                        |               |      |
| `Address` (lines, city, country)     |               |      |
| `Customer`                           |               |      |
| `EmailAddress`                       |               |      |
| `OrderLineItem` (in an order)        |               |      |
| `ShippingLabel` (assigned to parcel) |               |      |
| `Country` (ISO-3166)                 |               |      |

**Worked answers.**

| Concept           | Verdict | Justification |
| ----------------- | ------- | ------------- |
| `Money`           | VO      | £100 is interchangeable with any other £100 — no identity. |
| `BankAccount`     | Entity  | "Alice's account 12345" is a specific account, distinguishable. |
| `Address`         | VO      | Two `(10 Downing St, London)` records are interchangeable. |
| `Customer`        | Entity  | Persons have identity across attribute changes. |
| `EmailAddress`    | VO      | Two `alice@x.com` strings are equal by value. |
| `OrderLineItem`   | VO inside Order, Entity if independently referenced | Depends on the aggregate design. |
| `ShippingLabel`   | Entity  | Each label has a unique tracking number referenced by carriers. |
| `Country`         | VO (or *reference data entity*) | `GB` is `GB` everywhere. If queried by id with no behaviour, often VO. |

The pattern: ask "do siblings with identical attributes count as the same thing or different things?" Same → VO. Different → Entity.

---

**Memorize this:** the entity tasks recur in every backend project — design the entity, fix its equals/hashCode, add versioning, migrate keys, soft-delete, detect N+1, classify entity vs value. Master each once with a working solution in hand, and you carry a template for the next project. The validation criteria are not arbitrary — they are the *evidence* that the entity contract holds: identity is stable, equality is by id, invariants are enforced, lifecycle transitions don't break the equals/hashCode pair, and Hibernate doesn't burn you on lazy loads or batching.
