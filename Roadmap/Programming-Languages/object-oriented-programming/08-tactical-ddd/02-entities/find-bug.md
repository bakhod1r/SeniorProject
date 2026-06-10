# Entities — Find the Bug

Ten production-grade entity bugs you will encounter (and probably write at least once). Each scenario shows the broken code, the symptom, the diagnosis, and the fix.

---

## 1. Lombok `@EqualsAndHashCode` on every field

```java
@Entity
@Data                                // <-- the trap
public class Customer {
    @Id private UUID id;
    private String email;
    private Money balance;
}
```

**Symptom.** Tests pass in isolation. In production, after a customer's email changes, `customers.remove(c)` silently fails. `HashSet<Customer>` accumulates duplicates. Caches behave oddly.

**Diagnosis.** Lombok's `@Data` generates `@EqualsAndHashCode` over **all** fields. When `email` changes, the hash code changes, so the entity is now in the *wrong* hash bucket. The set has lost the entity even though the reference is still there.

**Fix.** Replace `@Data` with explicit annotations and key equality on the id:

```java
@Entity
@Getter @Setter
@EqualsAndHashCode(onlyExplicitlyIncluded = true)
public class Customer {
    @Id
    @EqualsAndHashCode.Include
    private UUID id;
    private String email;
    private Money balance;
}
```

Or — better — hand-write `equals`/`hashCode` so the rule is visible in the file.

---

## 2. HashSet with transient entity (id assigned later)

```java
@Entity
public class Order {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
}

Set<Order> queue = new HashSet<>();
Order o = new Order();
queue.add(o);              // id is null → hashCode = null.hashCode() ... NPE or 0
em.persist(o);             // id assigned, hashCode now changes
queue.contains(o);         // false — entity is "lost" in the set it's in
```

**Symptom.** `contains` returns false for an object that is provably in the set.

**Diagnosis.** Hash-based containers cache the bucket on insert based on `hashCode()` at insert time. When the id changes from null to 42, the hash changes, but the bucket assignment doesn't move.

**Fix.** Choose one of:

- Use UUID assigned at construction (id never null). Best fix.
- Use a constant hash code: `return getClass().hashCode();`. Survives id assignment.
- Avoid putting transient entities into hash containers.

---

## 3. Mutable `@Id`

```java
@Entity
public class User {
    @Id private String email;     // natural key as PK
    private String fullName;
}

user.setEmail("new@x.com");       // user PK just changed
```

**Symptom.** Hibernate may issue an UPDATE that fails, or it might INSERT a new row leaving the old one orphaned. Foreign keys pointing at the old email now dangle. The application appears to "duplicate" users.

**Diagnosis.** Primary keys must be immutable. The `@Column(updatable = false)` is missing; even with it, the entity's setter has corrupted the in-memory id.

**Fix.** Surrogate UUID as PK + email as a unique constraint:

```java
@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = "email"))
public class User {
    @Id @Column(updatable = false) private UUID id;
    @Column(nullable = false) private String email;
}
```

Now changing email is a normal UPDATE, not a PK migration.

---

## 4. Public setters bypassing invariants

```java
@Entity
public class Account {
    @Id private UUID id;
    @Getter @Setter private Money balance;     // public setter
    @Getter @Setter private Status status;

    public void debit(Money amount) {
        requireActive();
        if (amount.isGreaterThan(balance))
            throw new InsufficientFundsException(id);
        balance = balance.subtract(amount);
    }
}

account.setBalance(Money.of(-1_000_000));      // invariant bypassed
account.setStatus(Status.CLOSED);
account.debit(Money.of(50));                   // now in inconsistent state
```

**Symptom.** Account balance goes negative; closed accounts process debits; production correctness rules are violated by callers who didn't even know they had to call the right method.

**Diagnosis.** Public setters exist for fields that have invariants. The Lombok `@Setter` cannot distinguish "this field is safe to set" from "this field is governed by behaviour methods".

**Fix.** Remove setters; mutate only through behaviour methods:

```java
@Entity
public class Account {
    @Id private UUID id;
    @Getter private Money balance;
    @Getter private Status status;

    public void debit(Money amount) { ... }      // only legitimate path
    public void freeze() { ... }
    public void close() { ... }
}
```

---

## 5. Missing `@Version` — lost update

```java
@Entity
public class Inventory {
    @Id private UUID productId;
    private int stock;
    // no @Version
}

// Tx A: read stock = 10, decrement by 3 → write 7
// Tx B: read stock = 10, decrement by 2 → write 8
// Final: stock = 8. Three sold. One unit is lost.
```

**Symptom.** Inventory drifts; double-bookings; "where did that unit go?" tickets.

**Diagnosis.** Without `@Version`, both transactions UPDATE successfully, and the last writer wins. The system has no idea a concurrent modification happened.

**Fix.**

```java
@Entity
public class Inventory {
    @Id private UUID productId;
    @Version private long version;
    private int stock;
}
```

The second UPDATE now matches zero rows (`WHERE version = ?`) and throws `OptimisticLockException`. The application retries with fresh state.

---

## 6. `toString` triggers lazy loading → N+1

```java
@Entity
public class Order {
    @Id private UUID id;
    @OneToMany(fetch = FetchType.LAZY) private List<LineItem> items;

    @Override
    public String toString() {
        return "Order{id=" + id + ", items=" + items + "}";   // <-- loads items
    }
}

log.info("Processing {} orders", orders);   // logs 1,000 orders → 1,001 queries
```

**Symptom.** A single log statement causes an N+1 query storm. APM shows seconds spent in `OrderRepository.findItems`.

**Diagnosis.** `toString` references `items`, which is a lazy proxy. Resolving it triggers a SELECT per order.

**Fix.** `toString` may dereference only primitive fields and the id:

```java
@Override
public String toString() {
    return "Order[id=" + id + ", status=" + status + "]";
}
```

Same rule for `equals` and `hashCode` — never touch lazy collections.

---

## 7. `getClass() ==` in equals breaks for Hibernate proxies

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;   // <-- trap
    Customer that = (Customer) o;
    return id.equals(that.id);
}

Customer ref  = em.getReference(Customer.class, id);   // proxy: class Customer$$EnhancerByHibernate
Customer real = em.find(Customer.class, id);           // managed instance
ref.equals(real);   // false — proxy's class is a subclass of Customer
```

**Symptom.** Two views of the same entity (one a proxy, one fully loaded) compare unequal. `Set.contains` fails. Cache lookups miss.

**Diagnosis.** Hibernate's proxy is an enhanced subclass; `getClass()` returns `Customer$HibernateProxy$xxx`, not `Customer`. The strict `getClass()` check rejects proxies.

**Fix.** Use `instanceof` and unwrap if needed:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Customer)) return false;
    Customer that = (Customer) Hibernate.unproxy(o);
    return id != null && id.equals(that.id);
}
```

---

## 8. Cascade across aggregate boundaries

```java
@Entity
public class Customer {
    @Id private UUID id;
    @OneToMany(mappedBy = "customer", cascade = CascadeType.ALL)   // <-- trap
    private List<Order> orders = new ArrayList<>();
}

em.remove(customer);   // ON DELETE CASCADES THROUGH ALL OF THE CUSTOMER'S ORDERS
                       // including paid ones, including refunds in-flight ...
```

**Symptom.** Deleting a customer wipes years of order history. Refund processes break. Auditors notice.

**Diagnosis.** Cascade was set across an aggregate boundary. Customer and Order are two aggregates; one's lifecycle is not the other's.

**Fix.** Remove cascade; reference by id:

```java
@Entity
public class Customer { @Id private UUID id; /* no orders collection */ }

@Entity
public class Order {
    @Id private UUID id;
    @Column(name = "customer_id") private UUID customerId;   // foreign key by id
}
```

Loading customer's orders is a repository query, not a JPA navigation.

---

## 9. `Set<Order>` with hashCode based on attributes

```java
public class Order {
    private UUID id;
    private OrderStatus status;
    private Money total;

    @Override public int hashCode() {
        return Objects.hash(id, status, total);   // <-- mutable fields
    }
}

Set<Order> orders = new HashSet<>();
orders.add(order);
order.markPaid(ref);          // mutates status → hashCode changes
orders.contains(order);       // false — lost in the set
```

**Symptom.** After mutation, the entity is no longer findable in its containing set.

**Diagnosis.** Hash code includes mutable state. The HashSet's bucket assignment is stale.

**Fix.** Identity-only equality and hashing:

```java
@Override public int hashCode() { return id.hashCode(); }
@Override public boolean equals(Object o) {
    return o instanceof Order other && id.equals(other.id);
}
```

---

## 10. Sharing one persistence context across threads

```java
@Service
public class OrderService {
    @PersistenceContext(type = PersistenceContextType.EXTENDED)
    private EntityManager em;          // shared across requests
}

// Thread A loads Customer c, mutates email.
// Thread B simultaneously loads Customer c via em.find — returns A's in-flight reference.
// Both threads now mutate the same Customer instance.
```

**Symptom.** Random `ConcurrentModificationException`s. Mysteriously stale data. Tests pass under load = 1, fail under load = 10.

**Diagnosis.** `EntityManager` is **not** thread-safe (JPA spec §3.2). Extended persistence contexts shared across threads are a data race.

**Fix.** Transaction-scoped EM (default for Spring), one per request:

```java
@Service
public class OrderService {
    @PersistenceContext        // default = TRANSACTION
    private EntityManager em;
}
```

Or in plain JPA, use `EntityManagerFactory.createEntityManager()` per unit of work and close it.

---

## Cross-bug pattern

Most entity bugs cluster around three failure modes:

1. **Identity broken by attribute equality** — Lombok `@Data`, mutable hashCode (#1, #9).
2. **Identity broken by null id** — IDENTITY-strategy entities in hash collections (#2, #3).
3. **Boundaries violated** — cascade across aggregates, leaking lazy associations across detach (#6, #8, #10).

Recognising the pattern is half the speed-up: when an entity-shaped bug appears, ask first which of these three it is.

---

**Memorize this:** entity bugs are usually identity bugs in disguise. `@Data` on a JPA entity, mutable `@Id`, missing `@Version`, `toString` touching lazy collections, `getClass() ==` in equals, cascade across aggregate boundaries — these are the recurring suspects. The systematic fix is always: id is final and immutable, equals/hashCode key on id alone, behaviour methods guard invariants, no cascade across aggregates, no lazy access on detached entities. Get that right and 90% of the production fires don't start.
