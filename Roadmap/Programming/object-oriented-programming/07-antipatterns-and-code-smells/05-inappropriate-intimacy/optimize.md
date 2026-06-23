# Inappropriate Intimacy — Optimize

Ten optimisation angles that arise specifically because two classes are too close. Each is a concrete pattern with the rule it makes safe.

## 1. JPA bidirectional fetch joins instead of cascading lazy loads

Bidirectional `@OneToMany`/`@ManyToOne` is convenient but tempts code to walk back and forth, triggering N+1.

```java
// Read path that genuinely needs both sides — fetch them in one shot
@Query("""
    select distinct o from Order o
    left join fetch o.lines l
    left join fetch l.product
    where o.id = :id
""")
Optional<Order> findWithLines(Long id);
```

Rule: every read path either uses a `join fetch` or accepts that the collection stays lazy and untouched.

## 2. Break equals/hashCode infinite recursion by anchoring identity on the id

```java
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Order other)) return false;
    return id != null && id.equals(other.id);
}
@Override public int hashCode() { return getClass().hashCode(); }
```

Rule: `equals` on a JPA entity uses `id` only; `hashCode` is constant per class (Vlad Mihalcea's pattern). Never include associations.

## 3. Serialization cycles — use `@JsonManagedReference` / `@JsonBackReference`

```java
class Department {
    @JsonManagedReference List<Employee> employees;
}
class Employee {
    @JsonBackReference Department department;
}
```

The `BackReference` side is silently dropped from the JSON output, breaking the cycle.

Rule: pick one side as the owner of serialisation. Better still — return DTOs, never entities, from controllers.

## 4. `@JsonIdentityInfo` when both sides must serialise

When the same graph contains the same object twice and you cannot drop a side:

```java
@JsonIdentityInfo(generator = ObjectIdGenerators.PropertyGenerator.class, property = "id")
class Node { Long id; List<Node> neighbours; }
```

Jackson writes the full object the first time and a reference (`{"@id":1}`) afterwards. No recursion.

Rule: prefer references over duplicated subtrees in serialised graphs.

## 5. Lazy proxies and `Hibernate.initialize` to defuse cascade walks

Inside a transaction:

```java
Hibernate.initialize(order.getLines());
order.getLines().forEach(l -> Hibernate.initialize(l.getProduct()));
```

You explicitly choose what to materialise; nothing else triggers a load.

Rule: control materialisation explicitly at the query boundary, never let view rendering pull lazy collections.

## 6. Eviction without coupling — domain events instead of cross-service `cache.remove`

```java
@Component
class UserChangedListener {
    private final CacheManager cacheManager;
    @EventListener
    void on(UserChangedEvent e) { cacheManager.getCache("users").evict(e.userId()); }
}
```

Rule: caches are private state; let owners invalidate their own caches in response to events.

## 7. Replace bidirectional service calls with a mediator

Two services calling each other become three classes: `A`, `B`, and `Mediator` that orchestrates them. CBO of `A` and `B` drops, MPC drops, the bidirectional edge disappears.

```java
class TransferMediator {
    private final AccountService accounts;
    private final LedgerService ledger;
    void transfer(TransferCmd cmd) {
        accounts.debit(cmd.from(), cmd.amount());
        ledger.record(cmd);
        accounts.credit(cmd.to(), cmd.amount());
    }
}
```

Rule: when two collaborators must coordinate, extract a third class that owns the coordination.

## 8. Replace boolean-trail returns with intent-revealing immutable results

A common intimacy pattern: caller reads several fields after each call to figure out what happened.

```java
// Before — caller must read state on the service
service.process(x);
if (service.lastFailed()) ...
if (service.lastWarning() != null) ...

// After — return a value object
ProcessResult r = service.process(x);
if (r.failed()) ...
```

Rule: a method's outcome belongs in its return value, not in mutable fields of the callee.

## 9. Pre-compute on the owning side to remove "peek" calls

If `OrderReport` repeatedly asks `Order` for line totals, give `Order` a method that returns the total once.

```java
class Order {
    public Money totalForReport() { return lines.stream().map(OrderLine::total).reduce(Money.ZERO, Money::plus); }
}
```

Rule: the loop belongs on the side that owns the data; reports consume one number, not n.

## 10. Snapshot DTOs at the boundary to stop deep walks

Returning a deep entity graph from a `@RestController` is an open invitation for Inappropriate Intimacy — every consumer learns the whole shape.

```java
record OrderView(Long id, BigDecimal total, List<OrderLineView> lines) {}
record OrderLineView(String sku, int qty, BigDecimal lineTotal) {}

@GetMapping("/orders/{id}")
public OrderView get(@PathVariable Long id) {
    return mapper.toView(repo.findWithLines(id).orElseThrow());
}
```

The DTO contains exactly what the API promises and nothing else; entity internals stay inside the persistence boundary.

Rule: never expose an `@Entity` over HTTP, gRPC, or any external boundary.

## Quick rules

- Pick one direction as the navigable one; mark the other read-only or drop it.
- `equals`/`hashCode` on entities depend on `id` only; `toString` excludes collections.
- Use `@JsonManagedReference` + `@JsonBackReference` or `@JsonIdentityInfo` — never both at once.
- Add `join fetch` to the small number of read paths that need it; leave the rest lazy.
- Default `@ManyToOne` to `FetchType.LAZY` everywhere on the project.
- Replace cross-service cache pokes with events or owner-side `invalidate` methods.
- Promote coordination between two intimate services to a mediator.
- Return DTOs from controllers, not entities.
- Audit `cascade = CascadeType.ALL` — assign one aggregate root per relationship.
- Compute on the owning side; expose the result, not the fields.

## Memorize this

- The fix for bidirectional intimacy is almost never "tune the framework" — it is "remove a direction".
- Bidirectional + Jackson + Lombok is a recursion-bug triangle; break it before the first feature ships.
- Two services with bidirectional MPC > 10 each are one mediator away from being clean.
- DTOs are not boilerplate; they are the moat around your domain.
- Every "evict the other guy's cache" call is a future bug; replace with events.
- Pre-compute on the owner; reports consume results, not internals.
