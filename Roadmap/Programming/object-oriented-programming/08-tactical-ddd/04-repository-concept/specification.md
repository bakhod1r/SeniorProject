# Repository Concept — Specification

> **What?** This file states the *formal contract* of a Repository as Eric Evans laid it out in *Domain-Driven Design* (2003) and Vaughn Vernon refined in *Implementing Domain-Driven Design* (2013) — what behaviours every implementation must honour, regardless of whether the backing store is JPA, JOOQ, MongoDB, or a `HashMap`. It also formalises the **Specification** pattern, which serves as the standard extension point when callers need to fetch aggregates by criteria more complex than identity.
> **How?** Treat the four properties — collection semantics, aggregate-scoped fetching, identity-based access, and persistence transparency — as the *acceptance criteria* for any new repository implementation. Treat the Specification pattern as the canonical alternative to a forest of `findByXAndYAndZ` methods.

---

## 1. The four properties of a Repository

A class satisfies the Repository contract if and only if it exhibits the following four properties. Together they distinguish a repository from a DAO, a query service, or a generic CRUD wrapper.

### 1.1 Collection semantics

The repository presents itself to callers as if it were an in-memory collection of aggregates that happens to persist between application runs.

- **Membership** — an aggregate is either *in* the repository or *not*; there is no half-state.
- **Identity uniqueness** — at most one aggregate per identity is in the collection.
- **Add/remove vocabulary** — the public methods read like operations on a `Set`: `add`/`save` to include, `remove`/`delete` to exclude, `findById` to look up.
- **Iteration is optional** — unlike a `Collection<T>`, a repository may legitimately refuse to enumerate all members (a billion orders shouldn't fit in memory).

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);   // look up
    void save(Order order);                  // include / update
    void delete(Order order);                // exclude
    OrderId nextIdentity();                  // mint a new identity
}
```

### 1.2 Aggregate-scoped fetching

A repository returns or stores **whole aggregates**, never internal entities or partial slices. The unit of fetch is the aggregate root and everything inside its consistency boundary.

- `OrderRepository.findById(id)` returns an `Order` with its `OrderLine`s and `ShippingAddress` already inside.
- It does *not* return an `OrderLine` directly — that would let the caller mutate a part of the aggregate without going through the root, breaking invariants.
- It does *not* return a flat DTO for screen display — that's a query service's job (see `senior.md`).

The corollary: **one repository per aggregate root**, not per entity, not per table.

### 1.3 Identity-based access

The repository's primary lookup is by the aggregate's identity. Every aggregate root has a stable identity value object (`OrderId`, `CustomerId`, …), and `findById` is the canonical fetch.

```java
OrderId id = new OrderId(UUID.fromString("..."));
Order o = orders.findById(id).orElseThrow();
```

Other lookups exist (by domain-meaningful keys, by Specification, by query service), but identity is the privileged path — it's what makes the repository a *collection* rather than a *query engine*.

### 1.4 Persistence transparency

The repository's public interface must not expose persistence-mechanism details. Callers must not learn whether the backing store is SQL, NoSQL, in-memory, or remote.

- No `Connection`, `EntityManager`, `Session`, `MongoCollection` on method signatures or return types.
- No SQL strings, JPQL strings, or Mongo query documents in the contract.
- No `Optional<EntityClass>` — the return type names domain types only.
- Exceptions thrown from the contract are domain exceptions (`OrderNotFoundException`) or generic infrastructure exceptions wrapped to be substitutable across implementations.

This is what makes substitution possible: swapping `JpaOrderRepository` for `InMemoryOrderRepository` doesn't ripple through callers.

---

## 2. Required method semantics

A conforming implementation must honour these behavioural contracts. They form the LSP test (see `../../03-design-principles/01-solid-principles/`): any implementation passing the same test suite as the reference can substitute for it.

### 2.1 `findById(Id) : Optional<T>`

- Returns the unique aggregate with the given identity, fully hydrated, ready to enforce its invariants.
- Returns `Optional.empty()` if no such aggregate exists.
- Never returns a partial aggregate.
- Reads visible to the caller within the same transaction are visible.

### 2.2 `save(T) / add(T)`

- Includes the aggregate in the collection (insert if absent, update if present, under persistence-oriented semantics).
- Under collection-oriented semantics, `add` is required only the first time; subsequent mutations are tracked.
- After a successful return, `findById(aggregate.id())` returns an equivalent aggregate.
- Idempotent under identical state: calling `save(o)` twice with the same `o` is observationally equivalent to calling it once.

### 2.3 `delete(T) / remove(T)`

- Excludes the aggregate from the collection.
- After a successful return, `findById(aggregate.id())` returns `Optional.empty()`.
- Deleting a non-member is implementation-defined: either a silent no-op or a domain exception, but not a silent corruption.

### 2.4 `nextIdentity() : Id`

- Returns an identity that is *not* currently in use.
- Pure: does not by itself store anything.
- Independent of the database: the implementation may use UUIDs, a pre-allocated sequence, or a snowflake-style generator, but the contract returns a usable identity *before* any aggregate has been stored under it.

---

## 3. The Specification pattern — the standard extension

Eric Evans introduces the Specification pattern in *DDD* §6.5 as the formal answer to the question *"how do we let callers describe a subset of aggregates without growing the repository interface forever?"*

A Specification is a value object that encapsulates a single yes/no test on a candidate aggregate.

```java
public interface Specification<T> {
    boolean isSatisfiedBy(T candidate);
}
```

It composes via Boolean operations:

```java
public interface Specification<T> {
    boolean isSatisfiedBy(T candidate);
    default Specification<T> and(Specification<T> other) {
        return c -> isSatisfiedBy(c) && other.isSatisfiedBy(c);
    }
    default Specification<T> or(Specification<T> other) {
        return c -> isSatisfiedBy(c) || other.isSatisfiedBy(c);
    }
    default Specification<T> negate() {
        return c -> !isSatisfiedBy(c);
    }
}
```

Concrete specifications live in the domain and use domain vocabulary:

```java
public final class OpenOrders implements Specification<Order> {
    @Override public boolean isSatisfiedBy(Order o) {
        return o.status() == OrderStatus.OPEN;
    }
}

public final class ForCustomer implements Specification<Order> {
    private final CustomerId customer;
    public ForCustomer(CustomerId c) { this.customer = c; }
    @Override public boolean isSatisfiedBy(Order o) { return o.customer().equals(customer); }
}

public final class PlacedAfter implements Specification<Order> {
    private final Instant cutoff;
    public PlacedAfter(Instant cutoff) { this.cutoff = cutoff; }
    @Override public boolean isSatisfiedBy(Order o) { return o.placedAt().isAfter(cutoff); }
}
```

Callers compose them in the application service:

```java
Specification<Order> spec = new OpenOrders()
    .and(new ForCustomer(customerId))
    .and(new PlacedAfter(yesterday));
List<Order> result = orders.findSatisfying(spec);
```

The repository's surface stays small:

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    List<Order> findSatisfying(Specification<Order> spec);
    void save(Order order);
    OrderId nextIdentity();
}
```

### 3.1 Persistence translation

A Specification that *only* runs in-memory (`isSatisfiedBy`) forces the repository to load every aggregate before filtering — fatal at scale. The pragmatic version exposes a translation hook:

```java
public interface JpaSpecification<T> extends Specification<T> {
    Predicate toPredicate(Root<T> root, CriteriaBuilder cb);
}
```

The JPA repository implementation calls `toPredicate` and builds a `where` clause; the in-memory implementation falls back to `isSatisfiedBy`. The contract from the domain's point of view is unchanged.

Spring Data offers an idiomatic version with `org.springframework.data.jpa.domain.Specification<T>` and `JpaSpecificationExecutor<T>` — covered in `professional.md`.

### 3.2 When Specification is *not* the right tool

- **Sorting and pagination** — Specifications are predicate-shaped, not ordering-shaped. Sort + page belong on separate parameters.
- **Aggregations** — sums, averages, counts are *projections*, not selections. Put them on a query service.
- **Cross-aggregate joins** — if you need `Order` joined with `Customer.name`, that's a read model. Don't twist a Specification into producing it.

---

## 4. Equality and identity for repositories

A repository is *itself* a domain service (in Evans' wider taxonomy), so it has no identity of its own and need not implement `equals`/`hashCode`. The aggregates it holds, however, are entities — they have identity, and equality is by `id`, never by field values.

```java
public class Order {
    private final OrderId id;
    // ...
    @Override public boolean equals(Object o) {
        return o instanceof Order other && other.id.equals(this.id);
    }
    @Override public int hashCode() { return id.hashCode(); }
}
```

This matters for repositories because two `Order` references with the same `id` must be treated as the *same* aggregate even if a field differs in memory (one is stale). Implementations that compare by content silently break this.

---

## 5. Concurrency contract

A repository may be called from multiple threads (Spring services are singletons by default). The contract:

- **Implementations must be thread-safe** for *read* methods.
- **Write methods are serialised by the surrounding transaction**, not by the repository.
- **Optimistic locking is the aggregate's concern**, not the repository's — the aggregate carries the version field; the repository merely participates.

A `ConcurrentHashMap`-based in-memory repository should use the map's atomic operations (`compute`, `computeIfAbsent`) for `save` to honour this without explicit locks.

---

## 6. Lifecycle contract

A repository is a stateless service for the lifetime of the application. Specifically:

- Constructed once (typically via Spring DI), shared everywhere.
- No `init` / `close` semantics on the contract — the implementation's resources (pool, session factory) are managed by the framework.
- The contract does not pin the caller to any particular transactional or session lifecycle. Use cases own transactions.

This is what keeps the repository a *collection* abstraction rather than a *connection* abstraction.

---

## 7. Conformance checklist

Use this as a yes/no review on any new or refactored repository:

- [ ] Interface lives in the **domain** layer, not infrastructure.
- [ ] Method signatures mention **only domain types** (or `Optional`/`List` of them).
- [ ] No `EntityManager`, `Connection`, `Session`, `Page<EntityClass>` on the contract.
- [ ] **One repository per aggregate root** (count roots, count repositories).
- [ ] `findById` returns a **complete aggregate** when present.
- [ ] `nextIdentity` is **independent** of the database.
- [ ] Complex queries arrive via **Specification** or a *query service*, not as ten `findBy…` methods.
- [ ] Implementation is **thread-safe** for reads; writes rely on the surrounding transaction.

---

## 8. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| 10 bug scenarios with diagnosis and fix                     | `find-bug.md`      |
| Fetch joins, projections, second-level cache                | `optimize.md`      |
| 8 hands-on exercises with worked solution                   | `tasks.md`         |
| 20 numbered interview Q&A                                   | `interview.md`     |
| Aggregates this contract is built around                    | `../03-aggregates/` |
| Entities that live inside aggregates                        | `../02-entities/`  |
| Domain services for cross-aggregate logic                   | `../05-domain-services/` |

---

**Memorize this:** Four properties define a Repository — collection semantics, aggregate-scoped fetching, identity-based access, persistence transparency. The Specification pattern is the canonical extension when callers need criteria beyond identity. Anything that fails the four-property test is either a DAO, a query service, or a misnamed CRUD bag.
