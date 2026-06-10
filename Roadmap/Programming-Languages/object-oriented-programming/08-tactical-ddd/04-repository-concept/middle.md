# Repository Concept — Middle

> **What?** At the middle level the focus shifts from *what a repository is* to *how many you need, where they live, and how they interact with the framework you're most likely using* — Spring Data. The single most important rule remains: **one repository per aggregate root**. This file makes that rule concrete by walking through aggregate boundaries, the domain-vs-infrastructure split, and the trade-off Spring Data `JpaRepository` makes when it merges the two.
> **How?** First, enumerate the aggregate roots in your bounded context. Each gets exactly one repository. Second, place the interface in the domain package and the implementation in the infrastructure package. Third, decide whether to bind your domain interface to a Spring Data `JpaRepository` or to keep the two layers cleanly separated — both are defensible, and the choice has real consequences for testability and abstraction leakage.

---

## 1. One repository per aggregate root — and only the root

In Vaughn Vernon's *Implementing Domain-Driven Design* (2013), the rule is stated bluntly: *"There should be only one repository for each aggregate type."* The reason is that an aggregate is the *unit of transactional consistency*. If you could fetch one of its internal entities directly from a separate repository, you would also be able to modify it directly — and the aggregate's invariants (the rules guaranteed by the root) would have no place to run.

```java
// Aggregate boundary
public class Order {                       // aggregate root
    private final OrderId id;
    private final List<OrderLine> lines;   // internal entity
    private final ShippingAddress address; // value object
    // invariants enforced here, on the root
}

public class OrderLine { ... }             // internal — not independently addressable
```

The rule that follows:

- `OrderRepository` — yes, exists.
- `OrderLineRepository` — **no**. To touch an `OrderLine`, you go through its `Order`.
- `ShippingAddressRepository` — no; a value object has no identity.

If you find yourself wanting an `OrderLineRepository`, it usually means one of two things: either `OrderLine` is actually its own aggregate (and you've drawn the boundary wrong), or you need a read-only *query service* for line-item reports (which is not a repository at all — see `senior.md`).

---

## 2. Counting your repositories

A quick way to audit a bounded context: list the aggregate roots, count them, and that's exactly how many repositories you should have.

```
Bounded context: Sales
  - Order            (root)        -> OrderRepository
  - Order.OrderLine  (internal)    -> no repository
  - Customer         (root)        -> CustomerRepository
  - Product          (root)        -> ProductRepository
  - PriceList        (root)        -> PriceListRepository
                                      4 repositories total
```

If your project has 40 repositories for 12 aggregate roots, something has gone wrong — usually one of three things: people created a repository per table, per JPA `@Entity` annotation, or per UI screen. None of those is a valid criterion. The criterion is the aggregate boundary.

---

## 3. The domain–infrastructure split

The interface belongs in the domain layer because it's part of the *language* the domain speaks. The implementation belongs in the infrastructure layer because it knows about JDBC, JPA, MongoDB, or whatever store you happen to use.

```java
// com.shop.sales.domain
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
    void delete(Order order);
    OrderId nextIdentity();
    List<Order> findByCustomer(CustomerId customer);   // domain-meaningful query
}

// com.shop.sales.infrastructure.persistence
public class JpaOrderRepository implements OrderRepository {
    private final EntityManager em;
    public JpaOrderRepository(EntityManager em) { this.em = em; }

    @Override public Optional<Order> findById(OrderId id) {
        return Optional.ofNullable(em.find(Order.class, id.value()));
    }
    @Override public void save(Order order) { em.merge(order); }
    @Override public void delete(Order order) {
        em.remove(em.contains(order) ? order : em.merge(order));
    }
    @Override public OrderId nextIdentity() {
        return new OrderId(UUID.randomUUID());
    }
    @Override public List<Order> findByCustomer(CustomerId customer) {
        return em.createQuery(
            "select o from Order o where o.customer = :c", Order.class)
            .setParameter("c", customer)
            .getResultList();
    }
}
```

The application service depends on the interface, Spring wires in the implementation:

```java
@Service
public class OrderApplicationService {
    private final OrderRepository orders;
    public OrderApplicationService(OrderRepository orders) { this.orders = orders; }

    @Transactional
    public OrderId place(CustomerId customer, List<NewLine> requested) {
        OrderId id = orders.nextIdentity();
        Order order = new Order(id, customer);
        requested.forEach(l -> order.addLine(l.productId(), l.qty(), l.price()));
        orders.save(order);
        return id;
    }
}
```

If you wanted to swap the database to Mongo, you'd write `MongoOrderRepository implements OrderRepository`, change one `@Bean` definition, and the application service wouldn't notice.

---

## 4. Spring Data `JpaRepository` — the convenient shortcut

Spring Data offers a tempting alternative: declare an interface that extends `JpaRepository<Order, UUID>` and skip writing an implementation at all. Spring generates one at runtime.

```java
public interface OrderRepository extends JpaRepository<Order, UUID> {
    List<Order> findByCustomerId(UUID customerId);
    Optional<Order> findByIdAndStatus(UUID id, OrderStatus status);
}
```

You get `save`, `findById`, `findAll`, `deleteById` for free, plus derived query methods that parse the method name (`findByCustomerId` becomes `SELECT ... WHERE customer_id = ?`). For CRUD-heavy applications this saves a lot of code.

The trade-off:

| Aspect                                       | Hand-rolled interface + JPA impl                                | Spring Data `JpaRepository`                                       |
| -------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Lines of code per repository                 | High — interface + implementation                               | Low — one interface, often no implementation needed                |
| Domain purity                                | Pure — domain doesn't see Spring Data                            | Leaky — `JpaRepository` imports leak into the domain package       |
| Discoverability of queries                   | All in one implementation file                                   | Spread across method-name parsing rules and `@Query` annotations   |
| Substitutability (in-memory fake for tests)  | Trivial — implement four methods                                 | Hard — `JpaRepository` has dozens of methods (a fake is painful)   |
| Risk of accidental "anti-pattern" methods    | Low — every method is reviewed by hand                           | High — autocomplete leads to `findByCustomerAndStatusOrderByDate…` |

A common middle-ground in real codebases: keep the domain interface (`OrderRepository` in `com.shop.sales.domain`), but back it with a Spring Data interface in infrastructure:

```java
// domain — clean
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
    OrderId nextIdentity();
    List<Order> findByCustomer(CustomerId customer);
}

// infrastructure
interface SpringDataOrderRepository extends JpaRepository<Order, UUID> {
    List<Order> findByCustomerId(UUID customerId);
}

@Component
public class JpaOrderRepository implements OrderRepository {
    private final SpringDataOrderRepository spring;
    public JpaOrderRepository(SpringDataOrderRepository spring) { this.spring = spring; }

    @Override public Optional<Order> findById(OrderId id) { return spring.findById(id.value()); }
    @Override public void save(Order order) { spring.save(order); }
    @Override public OrderId nextIdentity() { return new OrderId(UUID.randomUUID()); }
    @Override public List<Order> findByCustomer(CustomerId customer) {
        return spring.findByCustomerId(customer.value());
    }
}
```

You get Spring Data's productivity *and* keep the domain dependency-free. The cost is one extra wiring class per repository — usually worth it past the toy-project stage.

---

## 5. What goes on the repository interface, and what doesn't

The interface should hold *only* methods that make domain sense for fetching/storing *the aggregate as a whole*. Anything else is a smell.

| Method                                       | Belongs on `OrderRepository`?                                |
| -------------------------------------------- | ------------------------------------------------------------ |
| `findById(OrderId)`                          | Yes — identity-based fetch                                   |
| `save(Order)` / `delete(Order)`              | Yes — collection-style mutation                              |
| `nextIdentity()`                             | Yes — identity allocation belongs with the collection        |
| `findByCustomer(CustomerId)`                 | Usually yes — domain-meaningful traversal                    |
| `findOpenOrdersForReport(DateRange)`         | No — that's a query service / read model                     |
| `updateStatus(OrderId, OrderStatus)`         | No — mutation must go through the aggregate root             |
| `countOrders()`                              | No — analytics belongs in a query service                    |
| `findOrCreate(CustomerId)`                   | No — that's a *factory* responsibility                       |

The line that holds: every method should either *fetch a complete aggregate by some domain key* or *store/remove a complete aggregate*. Reporting, partial updates, and statistics belong elsewhere.

---

## 6. Transactions and the unit of work

A single repository call is rarely a transaction boundary on its own. The transaction wraps the *application service method* — the use case — so that the aggregate's mutation and any related repository calls commit together.

```java
@Transactional                            // transaction here, not on the repository
public void confirm(OrderId id) {
    Order order = orders.findById(id)
        .orElseThrow(() -> new OrderNotFoundException(id));
    order.confirm();
    orders.save(order);                   // implementation may even be a no-op under JPA dirty-tracking
}
```

Under JPA with dirty checking, `save` is sometimes redundant — the persistence context flushes changes at commit. That's *implementation* detail; the contract still says "you must call `save`", so that the domain code remains independent of the implementation's flushing behaviour.

---

## 7. Common mid-level mistakes

**Mistake 1: making the domain depend on `JpaRepository`.** Once `OrderRepository extends JpaRepository<Order, UUID>` sits in the domain package, your domain layer transitively depends on Spring and JPA. Swapping persistence becomes "rewrite the application".

**Mistake 2: creating a repository for every JPA `@Entity`.** A line item, an address, a price-history row — none of them deserve their own repository if they live inside an aggregate.

**Mistake 3: leaking infrastructure types in return values.** `List<OrderEntity>` instead of `List<Order>` poisons every caller with infrastructure detail. Map at the implementation boundary.

**Mistake 4: leaving the transaction boundary inside the repository.** A `@Transactional` on `save` doesn't compose — multiple `save` calls in one use case can produce inconsistent state. Put `@Transactional` on the application service.

**Mistake 5: combining read-side and write-side responsibilities.** `findActiveOrdersWithLineCountGreaterThanThreeForReportScreen()` is a read concern. It does not belong on the same interface that stores aggregates.

---

## 8. Quick rules

- [ ] **One repository per aggregate root.** Count roots, count repositories — they should match.
- [ ] **Interface in `domain`, implementation in `infrastructure`.** Arrow points inward.
- [ ] **No infrastructure types in the contract.** No `EntityManager`, no `Connection`, no `Page<EntityClass>`.
- [ ] **Spring Data is fine if you wrap it.** Don't let `JpaRepository` leak into the domain package.
- [ ] **Reports and analytics belong on a query service**, not on the repository.

---

## 9. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Collection vs persistence-oriented, in-memory fakes, CQRS   | `senior.md`        |
| Spring Data trade-offs in depth, QueryDSL, hexagonal layering | `professional.md`  |
| Formal repository contract and Specification                | `specification.md` |
| Aggregates the repository wraps                              | `../03-aggregates/` |
| Domain services for cross-aggregate logic                   | `../05-domain-services/` |

---

**Memorize this:** Count the aggregate roots in your bounded context — that's the exact number of repositories you should have. Interface in the domain, implementation in the infrastructure. Spring Data `JpaRepository` is a productivity tool; wrap it behind your domain interface so its dependencies don't leak inward.
