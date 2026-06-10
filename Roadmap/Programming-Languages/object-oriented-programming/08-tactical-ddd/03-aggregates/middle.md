# DDD Tactical: Aggregates — Middle

> **What?** Going beyond "the root is the entry point", the middle-level view of aggregates is about **boundaries**: where one aggregate ends and the next begins, which **invariants** live inside which boundary, and why each aggregate must be a **transactional consistency boundary**. Eric Evans's original framing (*DDD*, 2003, Ch. 6) treats the aggregate as the unit of *change*; Vaughn Vernon (*Implementing Domain-Driven Design*, 2013) sharpens this to "one aggregate per transaction".
> **How?** When you draw an aggregate boundary, ask: *which business rules become false if I cross this line and commit halfway?* Those rules define the boundary. Then enforce them on the root. References across the line become id-only. Persistence saves the whole aggregate as one transaction.

---

## 1. The boundary defines the invariant set

An aggregate boundary is not a UML drawing convenience — it is the line that says: *everything inside must be consistent when a transaction commits*. The boundary is chosen to enclose exactly the data your business rules check together.

For an `Order` with `LineItem`s, the invariant "total = sum of line subtotals" is checked using *only* data inside the aggregate. That rule lives at the root, runs after every mutation, and is the reason `LineItem` is inside the boundary, not a separate aggregate.

Compare with "an order's customer must be active". This rule involves `Customer`, a different aggregate. You can't enforce it transactionally without locking both aggregates — so you don't. You either check it at command time (read the customer, then place the order) or react to a `CustomerSuspended` event by cancelling open orders. The boundary chose where you spend transactional cost.

---

## 2. Invariants enforced at the root

A rule is an **aggregate invariant** when it can be checked using only the aggregate's own state. Such rules live as guards in the root's methods.

```java
public class Order {
    private static final int MAX_ITEMS = 50;
    private static final Money MAX_TOTAL = Money.of("USD", 100_000);

    private OrderStatus status;
    private final List<LineItem> items = new ArrayList<>();
    private Money total = Money.zero(Currency.USD);

    public void addItem(ProductId productId, int qty, Money unitPrice) {
        // Invariant 1: only DRAFT orders are mutable.
        if (status != OrderStatus.DRAFT)
            throw new DomainException("Order is not in DRAFT state");

        // Invariant 2: never more than MAX_ITEMS lines.
        if (items.size() >= MAX_ITEMS)
            throw new DomainException("Order exceeds " + MAX_ITEMS + " items");

        var newItem = new LineItem(productId, qty, unitPrice);
        var newTotal = total.add(newItem.subtotal());

        // Invariant 3: total never exceeds MAX_TOTAL.
        if (newTotal.greaterThan(MAX_TOTAL))
            throw new DomainException("Order total cannot exceed " + MAX_TOTAL);

        items.add(newItem);
        total = newTotal;
    }
}
```

Note the pattern: compute the *would-be* new state, validate, then mutate. This keeps the aggregate in a valid state at every observable moment. A partial update that leaves the aggregate inconsistent is a bug, not a transient state — clients must never see it.

---

## 3. Transactional consistency boundary

Vernon's *Effective Aggregate Design* makes this rule explicit:

> *A properly designed aggregate is one that can be modified in any way required by the business with its invariants completely consistent within a single transaction.*

This has two consequences:

1. **One transaction = one aggregate.** When `application.placeOrder(...)` runs, exactly *one* aggregate's state changes inside the database transaction. The transaction loads the `Order`, mutates it, and saves it. Inventory, Customer, Payment — those are *other* transactions, possibly on *other* aggregates, possibly asynchronous.
2. **No partial commit.** If `addItem(...)` would violate an invariant, the whole mutation fails. Either every part of the aggregate change happens, or none does. The database transaction guarantees atomicity, but only because we restrict ourselves to *one* aggregate per transaction.

Multi-aggregate transactions look easy at first — "I'll just wrap two saves in `@Transactional`". But you've now created:

- A lock-ordering deadlock surface (whichever aggregate happens to be locked first wins, and the order can vary).
- A scaling problem (two aggregates means more contention, and refactoring to two databases later is painful).
- A modelling lie (the rule you thought you were enforcing was actually a different aggregate's concern).

---

## 4. ID references between aggregates

If `Order` needs to know who placed it, it stores a `CustomerId`, not a `Customer` object.

```java
public class Order {
    private final OrderId id;
    private final CustomerId customerId;   // ID reference — different aggregate
    private final List<LineItem> items;

    public Order(OrderId id, CustomerId customerId) {
        this.id = id;
        this.customerId = customerId;
        this.items = new ArrayList<>();
    }

    public CustomerId customerId() { return customerId; }
}
```

When the application needs both:

```java
public OrderView showOrder(OrderId orderId) {
    Order order = orderRepository.findById(orderId).orElseThrow();
    Customer customer = customerRepository.findById(order.customerId()).orElseThrow();
    return OrderView.of(order, customer);
}
```

Two loads, two aggregates, *no* implicit traversal. This is verbose by design — it makes it obvious that two aggregates are involved, and it discourages careless "let me just edit the customer while I'm here".

In JPA terms, this means **no `@ManyToOne Customer customer`** on `Order`. You store a `UUID customerId` column or wrap it in a `@Embeddable CustomerId`.

---

## 5. Designing the boundary: a worked example

Suppose you're modelling a payroll system. You have `Employee`, `TimeSheet`, and `Payment`. Where do the aggregate boundaries go?

**Candidate A — one big aggregate:** `Employee` contains `TimeSheet`s and `Payment`s.

Problems:
- Loading any employee pulls years of timesheets — heavy.
- Two HR users editing payments for the same employee in parallel always conflict.
- The invariant "total payments ≤ approved budget" applies *across employees*, so it's not an aggregate invariant anyway.

**Candidate B — three aggregates:** `Employee`, `TimeSheet`, `Payment`, each with its own root.

- `TimeSheet` and `Payment` reference `Employee` by `EmployeeId`.
- A timesheet's "hours ≤ 168 per week" invariant is internal — perfect aggregate-local rule.
- A payment can be issued for a non-existent employee? Check that at command time, not as a foreign key.

**Candidate B is usually correct.** Small aggregates, id references, eventual consistency between them via events ("`EmployeeTerminated` → cancel pending payments").

The rule of thumb: if a business invariant *must* hold across two clusters at every instant, they're probably one aggregate; if it's allowed a few seconds of staleness, they're two.

---

## 6. The size principle (preview of senior.md)

Aggregates should be small. The temptation to lump everything related into one cluster is strong but harmful:

- Larger aggregates load more data per request.
- Larger aggregates have more concurrent-update conflicts.
- Larger aggregates are harder to test (more state, more setup).

Vernon's rule of thumb: **a few entities at most**. Many aggregates are just *one root entity + a handful of value objects*. That's a healthy size.

---

## 7. Domain events at the boundary

When aggregate A needs to "tell" aggregate B something, the root of A publishes a domain event. The application layer (not the aggregate) dispatches it. Eventually, aggregate B is updated in its own transaction.

```java
public class Order {
    private final List<DomainEvent> events = new ArrayList<>();

    public void place() {
        if (status != OrderStatus.DRAFT)
            throw new DomainException("Cannot place a non-draft order");
        if (items.isEmpty())
            throw new DomainException("Cannot place an empty order");
        this.status = OrderStatus.PLACED;
        events.add(new OrderPlacedEvent(id, customerId, total, Instant.now()));
    }

    public List<DomainEvent> pullEvents() {
        var copy = List.copyOf(events);
        events.clear();
        return copy;
    }
}
```

The application service drains events after saving and hands them to an event publisher:

```java
@Transactional
public void placeOrder(OrderId id) {
    Order order = orderRepository.findById(id).orElseThrow();
    order.place();
    orderRepository.save(order);
    eventPublisher.publishAll(order.pullEvents());   // outside the aggregate, after save
}
```

This keeps `Order` ignorant of the messaging layer and keeps the aggregate the sole writer of its own state.

---

## 8. Three rules of thumb for choosing boundaries

1. **Find the invariant first.** What rule, if broken for one millisecond, would make a domain expert say "that's not allowed"? That rule defines a boundary.
2. **Default to small.** Start with the smallest plausible aggregate. Merge later if you discover an invariant you can't enforce otherwise — it's easier than splitting.
3. **Cross with events, not references.** When two aggregates seem to need each other, ask if an event would do. The answer is almost always yes.

---

## 9. Quick checklist

- [ ] Each invariant is enforced inside *one* aggregate, by the root.
- [ ] Mutator methods validate the *new* state before mutating.
- [ ] At most one aggregate per transaction.
- [ ] Cross-aggregate references are by id.
- [ ] Aggregates are small — root + a handful of children.
- [ ] Cross-aggregate consistency is achieved by events, not by joint transactions.

---

## 10. What's next

| Topic                                                              | File                          |
| ------------------------------------------------------------------ | ----------------------------- |
| Vernon's four rules, eventual consistency, `@Version`              | `senior.md`                   |
| JPA, repositories, snapshots, event sourcing                       | `professional.md`             |
| Formal contract                                                    | `specification.md`            |
| Aggregate bugs                                                     | `find-bug.md`                 |
| Cost models                                                        | `optimize.md`                 |
| Entities                                                           | `../01-entities/`             |
| Value objects                                                      | `../02-value-objects/`        |
| Repository concept                                                 | `../04-repository-concept/`   |
| Domain services                                                    | `../05-domain-services/`      |

---

**Memorize this:** The aggregate boundary is the line your invariants need to be true across. One transaction touches one aggregate; one aggregate references others only by id; one aggregate is mutated only through its root, which validates the *would-be* new state before committing it. Cross-aggregate consistency happens through events, not through shared transactions.
