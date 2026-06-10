# DDD Tactical: Aggregates — Find the Bug

> **What?** Ten production scenarios where the aggregate contract has been silently broken. Each scenario shows the symptom, the buggy code, the diagnosis (which rule of `specification.md` is violated), and a corrected version. Most aggregate bugs are not crashes — they are *quiet* data corruption that surfaces weeks later when accountants question a total.
> **How?** Read the symptom first, predict the fault, then check the diagnosis. A pattern emerges quickly: the same four mistakes (skipping the root, holding object references across boundaries, multi-aggregate transactions, missing invariant check) account for most production aggregate bugs.

---

## Scenario 1 — Modifying a child directly bypasses the root

**Symptom:** Order totals drift; the sum of `line_items.subtotal` no longer equals `orders.total` for ~3% of rows.

**Code:**
```java
Order order = orderRepository.findById(id).orElseThrow();
LineItem firstItem = order.items().get(0);
firstItem.setQuantity(99);                   // public setter on child
orderRepository.save(order);
```

**Diagnosis:** Violates C2 (encapsulation) and C3 (root-enforced invariants). The line item's quantity changed without the root recomputing the total. JPA saves the new quantity, but `Order.total` is stale.

**Fix:** Remove the public setter from `LineItem`. Add a root method that performs both changes:

```java
public void changeItemQuantity(LineItemId itemId, int newQuantity) {
    LineItem item = items.stream()
        .filter(i -> i.id().equals(itemId))
        .findFirst()
        .orElseThrow(() -> new DomainException("Item not found"));
    item.changeQuantity(newQuantity);   // package-private mutator
    recomputeTotal();
}
```

---

## Scenario 2 — Holding an object reference across an aggregate boundary

**Symptom:** A "ghost write" to `Customer` happens whenever an order is saved. Customers' updated_at jumps without any user action on the customer.

**Code:**
```java
@Entity
public class Order {
    @ManyToOne(cascade = CascadeType.PERSIST)
    private Customer customer;             // object reference to another aggregate
}
```

**Diagnosis:** Violates C5 (id references only) and, because of `cascade = PERSIST`, transitively saves the customer. The order is now coupled to the customer's lifecycle.

**Fix:**
```java
@Entity
public class Order {
    @Embedded
    private CustomerId customerId;         // id-only reference
}
```

If you need customer data, load it via `customerRepository` in the application layer.

---

## Scenario 3 — Multi-aggregate transaction

**Symptom:** Under load, ~1% of "place order" requests fail with a deadlock exception that no user-visible code created.

**Code:**
```java
@Transactional
public void placeOrder(OrderId orderId, ProductId productId, int qty) {
    Order order = orderRepository.findById(orderId).orElseThrow();
    Inventory inv = inventoryRepository.findByProduct(productId).orElseThrow();
    inv.reserve(qty);
    order.place();
    orderRepository.save(order);
    inventoryRepository.save(inv);
}
```

**Diagnosis:** Violates C4 (one aggregate per transaction). Two aggregates are locked in the same transaction, and the lock order depends on which `findById` was first — different requests acquire locks in different orders and deadlock.

**Fix:** Split into two transactions, glued by a domain event:

```java
@Transactional
public void placeOrder(OrderId orderId) {
    Order order = orderRepository.findById(orderId).orElseThrow();
    order.place();
    orderRepository.save(order);
    publisher.publishAll(order.pullEvents());   // OrderPlacedEvent
}

@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void on(OrderPlacedEvent e) {
    Inventory inv = inventoryRepository.findByProduct(e.productId()).orElseThrow();
    inv.reserve(e.quantity());
    inventoryRepository.save(inv);
}
```

---

## Scenario 4 — Missing invariant check at the root

**Symptom:** A customer service ticket: "I added 200 items to my order and the UI exploded." Database shows an order with 213 line items.

**Code:**
```java
public class Order {
    private final List<LineItem> items = new ArrayList<>();
    public void addItem(ProductId pid, int qty, Money price) {
        items.add(new LineItem(pid, qty, price));
    }
}
```

**Diagnosis:** Violates C3 — the "max 50 items per order" invariant is not enforced on the root. The UI was relying on the backend to refuse; the backend was relying on the UI.

**Fix:**
```java
public void addItem(ProductId pid, int qty, Money price) {
    if (items.size() >= 50) throw new DomainException("Order exceeds 50 items");
    items.add(new LineItem(pid, qty, price));
    recomputeTotal();
}
```

---

## Scenario 5 — Exposing the mutable internal collection

**Symptom:** A reporting script "filters" an order by mutating `order.getItems()`. Subsequent saves persist the filtered list.

**Code:**
```java
public List<LineItem> getItems() { return items; }   // returns the internal list
```

Reporting:
```java
order.getItems().removeIf(i -> i.unitPrice().lessThan(Money.of("USD", 10)));
orderRepository.save(order);
```

**Diagnosis:** Violates C2. The internal list is exposed, so any caller can mutate it. The root has no chance to validate or recompute the total.

**Fix:**
```java
public List<LineItem> items() {
    return Collections.unmodifiableList(items);
}
```

Reporting must use a separate read model that returns DTOs, not the aggregate.

---

## Scenario 6 — Reading half an aggregate to mutate it

**Symptom:** A scheduled job runs `UPDATE orders SET status = 'EXPIRED' WHERE placed_at < ?`. Two days later, totals are wrong because business rules attached to "expire" never ran.

**Code:**
```java
@Modifying
@Query("UPDATE Order o SET o.status = 'EXPIRED' WHERE o.placedAt < :cutoff")
int expireOldOrders(@Param("cutoff") Instant cutoff);
```

**Diagnosis:** Violates the entire aggregate contract — the root's `expire()` method was bypassed by a raw UPDATE. Any side effects (event emission, invariant checks, total recomputation) are lost.

**Fix:** Load the aggregate, call the root method, save it:
```java
@Scheduled(cron = "...")
public void expireOldOrders() {
    List<OrderId> stale = orderRepository.findIdsPlacedBefore(cutoff);
    for (OrderId id : stale) {
        Order order = orderRepository.findById(id).orElseThrow();
        order.expire();
        orderRepository.save(order);
    }
}
```

Use bulk SQL only for read models or projections, never for aggregate state.

---

## Scenario 7 — Missing `@Version`, silent overwrite

**Symptom:** Two simultaneous "add item" requests on the same order. One item ends up missing from the database, but no error was logged.

**Code:**
```java
@Entity
public class Order {
    @Id private UUID id;
    // no @Version field
    @OneToMany(...) private List<LineItem> items;
}
```

**Diagnosis:** Violates C7. Without `@Version`, two concurrent transactions both compute the new state from the same starting point and overwrite each other. Last write wins, silently.

**Fix:**
```java
@Entity
public class Order {
    @Id private UUID id;
    @Version private long version;
    @OneToMany(...) private List<LineItem> items;
}
```

Plus `@Retryable(retryFor = OptimisticLockException.class)` on the command handler.

---

## Scenario 8 — Catching `OptimisticLockException` and ignoring it

**Symptom:** Conflict rate logged as zero. Customers periodically report "I added an item but it didn't show up."

**Code:**
```java
@Transactional
public void addItem(OrderId id, ProductId pid, int qty, Money price) {
    try {
        Order order = orders.findById(id).orElseThrow();
        order.addItem(pid, qty, price);
        orders.save(order);
    } catch (OptimisticLockException e) {
        log.warn("conflict, ignored");   // <-- silently drops the command
    }
}
```

**Diagnosis:** The exception was treated as harmless. It is not. A conflict means *this command did not happen* — and the user thinks it did.

**Fix:** Retry the command (re-load, re-apply, re-save). After N attempts, propagate to the caller:
```java
@Retryable(retryFor = OptimisticLockException.class,
           maxAttempts = 3,
           backoff = @Backoff(delay = 50, multiplier = 2))
@Transactional
public void addItem(...) { /* as before, no catch */ }
```

---

## Scenario 9 — Loading lots of aggregates and looping mutations

**Symptom:** A "close all pending orders" admin button takes 90s and times out, but the DB load looks light.

**Code:**
```java
List<Order> orders = orderRepository.findAllPending();   // 5000 orders
for (Order o : orders) {
    o.close();
    orderRepository.save(o);
}
```

**Diagnosis:** Not strictly an aggregate violation, but a misuse — N small transactions where each load triggers N+1 queries for lazy-loaded line items, plus N round-trips per save. Also, the *whole batch* is in one transaction if the method is `@Transactional`, violating C4 across 5000 aggregates.

**Fix:**
```java
@Transactional(propagation = REQUIRES_NEW)
public void closeOne(OrderId id) {
    Order order = orderRepository.findFullById(id).orElseThrow();   // entity graph
    order.close();
    orderRepository.save(order);
}

public void closeAll() {
    List<OrderId> ids = orderRepository.findIdsPending();
    ids.forEach(this::closeOne);   // each in its own transaction
}
```

Each aggregate gets its own transaction; `findFullById` uses `@EntityGraph` to avoid N+1.

---

## Scenario 10 — Domain event handler that re-enters the same aggregate

**Symptom:** `StackOverflowError` deep in event dispatch when placing an order.

**Code:**
```java
public class OrderEventHandler {
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void on(OrderPlacedEvent e) {
        Order order = orders.findById(e.orderId()).orElseThrow();
        order.markNotifiedToCustomer();     // emits another event
        orders.save(order);                 // re-enters the same transaction
    }
}
```

**Diagnosis:** Violates C4 (the same aggregate is touched twice in one transaction) and C6 (the handler runs *before* commit, recreating a synchronous coupling).

**Fix:** Either move the side effect into the original aggregate method:
```java
public void place() {
    /* ... */
    status = OrderStatus.PLACED;
    events.add(new OrderPlacedEvent(...));
    markNotifiedToCustomer();                // already inside the same root method
}
```
…or run the handler after commit, in its own transaction:
```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
@Transactional(propagation = REQUIRES_NEW)
public void on(OrderPlacedEvent e) { ... }
```

---

## Pattern recap

Four causes account for the majority of these bugs:

1. **Skipping the root** (Scenarios 1, 5, 6) — internal state mutated without root validation.
2. **Object references across boundaries** (Scenario 2) — cascade and ghost-writes.
3. **Multi-aggregate transactions** (Scenarios 3, 9, 10) — deadlocks, slow batches, cycles.
4. **Missing invariant or concurrency control** (Scenarios 4, 7, 8) — silent data corruption.

When debugging suspected aggregate bugs, scan the code for these four patterns first. Most fixes are mechanical once the pattern is identified.

---

## What's next

- `optimize.md` — performance angles on aggregate persistence.
- `tasks.md` — exercises that exercise these bug patterns deliberately.
- `interview.md` — how interviewers ask about these scenarios.
