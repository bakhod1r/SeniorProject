# DDD Tactical: Aggregates — Tasks

> **What?** Eight progressive exercises that walk you from "design a small aggregate" to "fix a multi-aggregate transaction, add optimistic locking, and implement a snapshot strategy". Each task has clear inputs, a validation table you can run as JUnit tests, and a worked solution at the end. The exercises mirror real production scenarios drawn from Vaughn Vernon's *Effective Aggregate Design* examples.
> **How?** Work each task in order. Try to make every row of the validation table pass before reading the worked solution. If you get stuck, re-read the corresponding section of `senior.md` or `professional.md` first — most exercises map directly to one rule from those files.

---

## Task 1 — Design the `Order` aggregate from scratch

**Goal:** Implement an `Order` aggregate root with `LineItem` children and an `Address` value object. External code can only obtain references to `Order`.

**Requirements:**
- Constructor: `Order(OrderId, CustomerId, Address)`.
- Methods on root: `addItem(ProductId, int qty, Money unitPrice)`, `removeItem(LineItemId)`, `changeShippingAddress(Address)`, `place()`.
- Invariants:
  - Only DRAFT orders are mutable.
  - At most 50 line items.
  - Total never exceeds 100,000 USD.
  - Cannot place an empty order.
- `LineItem` constructor and mutators must be package-private.
- `items()` returns an unmodifiable view.

**Validation table:**

| Test                                                       | Expected                                |
| ---------------------------------------------------------- | --------------------------------------- |
| Add item to DRAFT order, total updates                     | `total == subtotal`                     |
| Add 51st item to DRAFT order                                | `DomainException("max 50 items")`        |
| Add item to PLACED order                                    | `DomainException("Order is not DRAFT")` |
| `place()` on empty order                                    | `DomainException`                       |
| External code calls `items().add(...)`                      | `UnsupportedOperationException`         |
| External code calls `new LineItem(...)` from another package | compile error                          |

---

## Task 2 — Fix a cross-aggregate transaction

**Goal:** Replace a multi-aggregate transaction with eventual consistency via a domain event.

**Starting code:**
```java
@Transactional
public void placeOrder(OrderId orderId) {
    Order order = orders.findById(orderId).orElseThrow();
    Inventory inv = inventories.findByProduct(order.firstProductId()).orElseThrow();
    inv.reserve(order.firstQuantity());
    order.place();
    orders.save(order);
    inventories.save(inv);
}
```

**Requirements:**
- One aggregate per transaction.
- `Order.place()` emits `OrderPlacedEvent`.
- A listener handles inventory reservation in its own transaction, after commit.

**Validation table:**

| Test                                                        | Expected                                       |
| ----------------------------------------------------------- | ---------------------------------------------- |
| `placeOrder` commits the order even if inventory listener fails later | order is PLACED in DB                          |
| Inventory eventually reflects reservation                    | inventory rows reduced after async dispatch    |
| No deadlock under load (2 concurrent placements)             | both succeed without timeout                   |
| No `@ManyToOne` between Order and Inventory                   | grep returns empty                             |

---

## Task 3 — Add optimistic locking

**Goal:** Add `@Version` to `Order` and a retry policy to the command handler.

**Requirements:**
- `@Version long version` on the `Order` entity.
- Application service retries on `OptimisticLockException` up to 3 times with exponential backoff (50ms, 100ms, 200ms).
- After 3 failures, the exception propagates to the caller.

**Validation table:**

| Test                                                       | Expected                                       |
| ---------------------------------------------------------- | ---------------------------------------------- |
| Two concurrent `addItem` calls, no conflict                | both items present after both commit            |
| Two concurrent `addItem` calls that conflict               | the second triggers retry, succeeds            |
| 4 conflicting commands                                     | fourth throws `OptimisticLockException`         |
| Single command, no conflict                                | no retry, single SQL UPDATE                    |

---

## Task 4 — ID-only reference between aggregates

**Goal:** Convert a model with `@ManyToOne Customer customer` on `Order` to an id-only reference.

**Starting code:**
```java
@Entity
public class Order {
    @ManyToOne(cascade = CascadeType.PERSIST) private Customer customer;
}
```

**Requirements:**
- Replace with `@Embedded CustomerId customerId`.
- Update application code that previously called `order.getCustomer().getName()` to load the customer via `CustomerRepository`.
- No cascade between `Order` and `Customer`.

**Validation table:**

| Test                                                  | Expected                                     |
| ----------------------------------------------------- | -------------------------------------------- |
| Saving an order does not write to the customer table  | `customers.updated_at` unchanged             |
| `OrderView` includes customer name                    | loaded via two queries, joined in DTO        |
| Schema has `orders.customer_id UUID NOT NULL`         | DDL inspection                               |
| No `@ManyToOne(Customer.class)` anywhere on `Order`   | grep returns empty                           |

---

## Task 5 — Implement a snapshot for an event-sourced aggregate

**Goal:** Take an existing event-sourced `Order` and add a snapshot strategy. The repository should write a snapshot every 100 events.

**Requirements:**
- `Snapshot` table stores `aggregate_id, version, payload (JSON), created_at`.
- On load: read latest snapshot, then events with version > snapshot.version.
- On save: if the new version crosses a multiple of 100, write a snapshot.

**Validation table:**

| Test                                                       | Expected                                       |
| ---------------------------------------------------------- | ---------------------------------------------- |
| Load aggregate with 250 events, snapshot at v200            | replay starts at v200, applies 50 events       |
| Save command that takes version from 199 to 200             | snapshot row written                           |
| Save command that takes version from 200 to 201             | no new snapshot                                |
| Load with no snapshot, all 250 events replayed              | matches load via snapshot path                 |

---

## Task 6 — Compute aggregate-local invariant from a derived value

**Goal:** Add an invariant: "no more than 3 items of the same product per order". Implement it correctly.

**Requirements:**
- The check happens at `addItem` time.
- Counts items by `ProductId`.
- The check is part of the *would-be* new state (validate before mutate).

**Validation table:**

| Test                                                       | Expected                                       |
| ---------------------------------------------------------- | ---------------------------------------------- |
| Add 3 items of product A                                    | succeeds                                       |
| Add 4th item of product A                                   | `DomainException("max 3 per product")`         |
| Add 3 items of A, then 3 of B                               | both succeed                                   |
| Add and then remove an item of A; add a 4th of A            | succeeds (because removed first)               |

---

## Task 7 — Spot the boundary mistake

**Goal:** Given a `Project` aggregate that contains `Task` entities and *also* references a `Team` aggregate by `@ManyToOne`, identify which rule is broken and propose a fix.

```java
@Entity
public class Project {
    @Id private UUID id;
    @OneToMany(cascade = ALL, orphanRemoval = true) private List<Task> tasks;
    @ManyToOne(cascade = PERSIST) private Team team;       // <-- problem
}
```

**Requirements:**
- Write a short diagnosis (1-2 sentences) and identify the violated rule from `specification.md`.
- Provide corrected code.
- Explain how cross-aggregate effects (e.g., "team renamed") should propagate.

**Validation table:**

| Test                                                       | Expected                                       |
| ---------------------------------------------------------- | ---------------------------------------------- |
| Diagnosis names C5 (id-only references)                    | yes                                            |
| Corrected code has `@Embedded TeamId teamId`                | yes                                            |
| Solution uses an event for "team renamed"                  | yes (e.g., `TeamRenamedEvent`)                 |

---

## Task 8 — End-to-end command flow

**Goal:** Build a `PlaceOrderCommandHandler` that exercises every rule from `senior.md`.

**Requirements:**
- Loads exactly one aggregate.
- Calls one root method (`Order.place()`).
- Saves the aggregate.
- Publishes domain events after commit.
- Retries on optimistic-lock conflicts up to 3 times.
- Logs each retry attempt.

**Validation table:**

| Test                                                       | Expected                                       |
| ---------------------------------------------------------- | ---------------------------------------------- |
| Happy path, no contention                                  | 1 SQL UPDATE, 1 event published                |
| One conflict, then success                                  | retry log present, 1 event published           |
| Three conflicts                                            | `OptimisticLockException` propagates           |
| Order load uses `@EntityGraph` to fetch items eagerly       | one SQL with join                              |

---

## Worked solution: Task 1

```java
public final class OrderId {
    private final UUID value;
    private OrderId(UUID value) { this.value = Objects.requireNonNull(value); }
    public static OrderId of(UUID value) { return new OrderId(value); }
    @Override public boolean equals(Object o) {
        return o instanceof OrderId other && other.value.equals(this.value);
    }
    @Override public int hashCode() { return value.hashCode(); }
}

public final class LineItemId {
    private final UUID value;
    public static LineItemId newId() { return new LineItemId(UUID.randomUUID()); }
    private LineItemId(UUID value) { this.value = value; }
}

public final class Order {
    private final OrderId id;
    private final CustomerId customerId;
    private final List<LineItem> items = new ArrayList<>();
    private Address shippingAddress;
    private OrderStatus status;
    private Money total;

    private static final int MAX_ITEMS = 50;
    private static final Money MAX_TOTAL = Money.of("USD", 100_000);

    public Order(OrderId id, CustomerId customerId, Address shippingAddress) {
        this.id = id;
        this.customerId = customerId;
        this.shippingAddress = shippingAddress;
        this.status = OrderStatus.DRAFT;
        this.total = Money.zero(Currency.USD);
    }

    public void addItem(ProductId pid, int qty, Money unitPrice) {
        requireDraft();
        if (items.size() >= MAX_ITEMS)
            throw new DomainException("max " + MAX_ITEMS + " items");
        var item = new LineItem(LineItemId.newId(), pid, qty, unitPrice);
        var next = total.add(item.subtotal());
        if (next.greaterThan(MAX_TOTAL))
            throw new DomainException("Total exceeds " + MAX_TOTAL);
        items.add(item);
        total = next;
    }

    public void place() {
        requireDraft();
        if (items.isEmpty()) throw new DomainException("Cannot place empty order");
        this.status = OrderStatus.PLACED;
    }

    public List<LineItem> items() { return Collections.unmodifiableList(items); }

    private void requireDraft() {
        if (status != OrderStatus.DRAFT)
            throw new DomainException("Order is not DRAFT");
    }
}

public final class LineItem {
    private final LineItemId id;
    private final ProductId productId;
    private int quantity;
    private final Money unitPrice;

    LineItem(LineItemId id, ProductId productId, int quantity, Money unitPrice) {
        this.id = id;
        this.productId = productId;
        this.quantity = quantity;
        this.unitPrice = unitPrice;
    }
    Money subtotal() { return unitPrice.multiply(quantity); }
}
```

Note the package-private `LineItem` constructor and `subtotal()`. External code cannot construct or read a line item except through the root.

---

## What's next

- `interview.md` — how interviewers test these same skills.
- `find-bug.md` — bug scenarios that exercise the same muscles.
- `optimize.md` — performance angles on these exercises.
