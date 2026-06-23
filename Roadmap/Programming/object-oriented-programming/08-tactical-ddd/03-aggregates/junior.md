# DDD Tactical: Aggregates — Junior

> **What?** An *Aggregate* is a cluster of related domain objects — entities and value objects — that are treated as a single unit for the purpose of data changes. Every aggregate has exactly one designated entity called the **Aggregate Root**. External code may hold references to, and invoke methods on, the *root only*; internal members are reached only through the root. The term comes from Eric Evans's *Domain-Driven Design* (2003), and was refined by Vaughn Vernon in *Implementing Domain-Driven Design* (2013) and the essay *Effective Aggregate Design* (2011).
> **How?** Pick the entity whose identity outsiders care about — that's the root. Hide the children behind it: never let a `LineItem` be loaded or mutated except through its `Order`. The root is responsible for keeping the whole cluster's invariants true after any change.

---

## 1. Why aggregates exist

Domain models without aggregates rot fast. Imagine an `Order` with `LineItem`s and a `ShippingAddress`. If any class can grab a `LineItem` directly, mutate its quantity, and save it, then the order's total, the inventory reservation, and the "no more than 50 items per order" rule live nowhere — they're scattered. Worse: two threads can change two line items at the same time and leave the order in a state no business rule allows.

The aggregate pattern says: pick one entity (the **root**), funnel *all* writes through it, and let it enforce the rules of the whole cluster. The aggregate becomes the unit of consistency.

---

## 2. The three vocabulary words

- **Entity** — has identity that persists across changes. `Order` with id `O-123` is still the same order even if every line item changes.
- **Value Object** — defined by its attributes, no identity. `Money(USD, 50.00)` and `Money(USD, 50.00)` are the same value.
- **Aggregate Root** — the *one* entity in the aggregate that external code is allowed to reference. It owns the lifecycle of everything inside.

An aggregate may contain multiple entities and value objects, but only one root.

---

## 3. The canonical example: `Order`

```java
public class Order {                       // <-- Aggregate Root (entity)
    private final OrderId id;
    private final CustomerId customerId;   // ID reference to another aggregate
    private final List<LineItem> items = new ArrayList<>();
    private Address shippingAddress;       // value object
    private OrderStatus status;
    private Money total;

    public Order(OrderId id, CustomerId customerId, Address shippingAddress) {
        this.id = id;
        this.customerId = customerId;
        this.shippingAddress = shippingAddress;
        this.status = OrderStatus.DRAFT;
        this.total = Money.zero(Currency.USD);
    }

    // Mutations go through the root; the root enforces invariants.
    public void addItem(ProductId productId, int quantity, Money unitPrice) {
        if (status != OrderStatus.DRAFT) {
            throw new IllegalStateException("Cannot modify a non-draft order");
        }
        if (items.size() >= 50) {
            throw new IllegalStateException("An order cannot exceed 50 line items");
        }
        items.add(new LineItem(productId, quantity, unitPrice));
        recomputeTotal();
    }

    public void changeShippingAddress(Address newAddress) {
        if (status == OrderStatus.SHIPPED) {
            throw new IllegalStateException("Cannot change address after shipping");
        }
        this.shippingAddress = newAddress;
    }

    private void recomputeTotal() {
        this.total = items.stream()
            .map(LineItem::subtotal)
            .reduce(Money.zero(Currency.USD), Money::add);
    }

    // No setter for items. No public access to the list — only an unmodifiable view.
    public List<LineItem> items() { return Collections.unmodifiableList(items); }
}
```

```java
public class LineItem {                    // <-- Entity inside the aggregate
    private final ProductId productId;
    private int quantity;
    private final Money unitPrice;

    LineItem(ProductId productId, int quantity, Money unitPrice) {  // package-private!
        this.productId = productId;
        this.quantity = quantity;
        this.unitPrice = unitPrice;
    }

    Money subtotal() {                     // package-private!
        return unitPrice.multiply(quantity);
    }
}
```

```java
public record Address(String street, String city, String country, String postalCode) {}
//                                       value object
```

Note: `LineItem`'s constructor and methods are *package-private*. The only way to create or modify a line item is to call `order.addItem(...)`. The `Order` is the gatekeeper for the entire cluster.

---

## 4. What external code can — and cannot — do

```java
// Allowed:
Order order = orderRepository.findById(orderId);
order.addItem(productId, 2, Money.of("USD", 25));
order.changeShippingAddress(newAddress);
orderRepository.save(order);

// Forbidden — external code should NOT do this:
LineItem item = order.items().get(0);
item.setQuantity(99);     // <-- bypasses Order's invariants. The compile error
                          //     (no public setter) is the design protecting you.
```

External code goes through the root or not at all. The root is the *only* public API of the aggregate.

---

## 5. Why one root, not many

Two roots inside the same cluster would mean two places that can mutate the cluster. The first time two requests touch different "roots" in parallel, you get a state no invariant allows — say, an order with five items but a total of zero. The single-root rule turns the cluster into a single critical section that the root's methods protect.

---

## 6. ID references to other aggregates

`Order` doesn't hold a `Customer` reference — it holds a `CustomerId`. Why? Because `Customer` is a *separate aggregate* with its own root. If `Order` contained a live `Customer` object, you'd be:

- Loading the full customer graph every time you load an order (slow).
- Tempted to mutate the customer through the order (corrupting the customer's invariants).
- Pulling two aggregates into one transaction (defeating the design).

Across aggregate boundaries, you reference by **identity only**.

```java
public class Order {
    private CustomerId customerId;   // GOOD — reference by ID
    // private Customer customer;    // BAD  — reference by object
}
```

If you need data from the customer, the application layer loads the customer aggregate separately.

---

## 7. The aggregate as a transactional boundary

The rule of thumb (Vernon, *Effective Aggregate Design*): **one aggregate per transaction**. Why? Because the aggregate is the unit the root keeps consistent. If a transaction touches two aggregates, you've broken the contract — the second aggregate might be in an inconsistent state until the transaction commits, and worse, you've coupled their lifecycles.

When two aggregates *must* be related (e.g., placing an order reserves stock in `Inventory`), use **eventual consistency**: one aggregate emits a domain event, the other reacts asynchronously. We'll cover that in `senior.md`.

---

## 8. Common newcomer mistakes

**Mistake 1: treating every entity as an aggregate root.**

A `LineItem` is an entity (has identity within the order), but it is *not* an aggregate root. There is no `LineItemRepository`. You find line items by going `order.items()`, not by id directly.

**Mistake 2: exposing the internal collection.**

```java
public List<LineItem> getItems() { return items; }   // <-- caller can .add() / .remove()
```

Return an unmodifiable view, or better, a defensive copy. The root must remain the only mutator.

**Mistake 3: holding object references across aggregates.**

```java
public class Order {
    private Customer customer;   // <-- BAD
}
```

This lets `Order` mutate `Customer` and forces them to be loaded together. Reference by id.

**Mistake 4: anaemic root.**

```java
public class Order {
    public List<LineItem> items;
    public Money total;
    public void setTotal(Money t) { this.total = t; }
}
```

If the root is just getters and setters and the *service layer* computes the total, you don't have an aggregate — you have a data bag. Behaviour belongs on the root.

---

## 9. Quick checklist

- [ ] Exactly one entity in the cluster is the root.
- [ ] All public methods that change the aggregate live on the root.
- [ ] Internal entities are package-private or have package-private mutators.
- [ ] Collections are exposed only through unmodifiable views.
- [ ] References to other aggregates use ids, not object references.
- [ ] No transaction touches more than one aggregate.

---

## 10. What's next

| Topic                                                                | File                                     |
| -------------------------------------------------------------------- | ---------------------------------------- |
| Boundaries, invariants, transactional consistency                    | `middle.md`                              |
| Vernon's four rules, small aggregates, concurrency                   | `senior.md`                              |
| Repositories, event sourcing, snapshots, JPA persistence             | `professional.md`                        |
| Formal aggregate contract                                            | `specification.md`                       |
| Aggregate bugs and their cures                                       | `find-bug.md`                            |
| Aggregate-load cost, fetch graphs, snapshot strategies               | `optimize.md`                            |
| Hands-on exercises                                                   | `tasks.md`                               |
| Interview Q&A                                                        | `interview.md`                           |
| Entities (deeper)                                                    | `../01-entities/`                        |
| Value objects                                                        | `../02-value-objects/`                   |
| Repository concept                                                   | `../04-repository-concept/`              |
| Domain services                                                      | `../05-domain-services/`                 |

---

**Memorize this:** An aggregate is a *cluster* of entities and value objects with *exactly one root*. External code touches the root and nothing else. The root enforces the cluster's invariants and is the transactional unit. References to other aggregates are by id, never by object. If two things must change together, they're one aggregate; if they can change separately, they're two — talking by events, not by sharing memory.
