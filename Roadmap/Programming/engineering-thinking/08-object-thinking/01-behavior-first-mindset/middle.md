# Behavior-First Mindset — Middle

> **What?** The mindset applied in practice — a step-by-step refactoring of an anemic class into a behavior-first object, the moves that get you there, and the points where you stop pulling behavior in.
> **How?** By following a real order-processing class through Move Method, Replace Conditional with Polymorphism, and Encapsulate Collection — and by watching where each move lands.

---

## 1. The starting point — an anemic order

A typical "Spring-shaped" service layer looks like this. `Order` is data; `OrderService` does everything.

```java
public class Order {
    private Long id;
    private Long customerId;
    private List<OrderLine> lines = new ArrayList<>();
    private String status;          // "DRAFT", "PLACED", "PAID", "SHIPPED", "CANCELLED"
    private BigDecimal total;
    private Instant placedAt;
    private String currency;

    // getters and setters for all fields
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public List<OrderLine> getLines() { return lines; }
    public void setLines(List<OrderLine> lines) { this.lines = lines; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public BigDecimal getTotal() { return total; }
    public void setTotal(BigDecimal total) { this.total = total; }
    // ...
}
```

```java
public class OrderService {

    public void place(Order order) {
        if (!"DRAFT".equals(order.getStatus())) {
            throw new IllegalStateException("only drafts can be placed");
        }
        if (order.getLines().isEmpty()) {
            throw new IllegalStateException("empty order");
        }
        BigDecimal sum = BigDecimal.ZERO;
        for (OrderLine line : order.getLines()) {
            sum = sum.add(line.getUnitPrice().multiply(BigDecimal.valueOf(line.getQty())));
        }
        order.setTotal(sum);
        order.setStatus("PLACED");
        order.setPlacedAt(Instant.now());
    }

    public void cancel(Order order) {
        if ("SHIPPED".equals(order.getStatus())) {
            throw new IllegalStateException("shipped orders cannot be cancelled");
        }
        order.setStatus("CANCELLED");
    }

    public void addLine(Order order, OrderLine line) {
        if (!"DRAFT".equals(order.getStatus())) {
            throw new IllegalStateException("can only modify drafts");
        }
        order.getLines().add(line);
    }
}
```

Symptoms, before we change a line:

- Every rule lives in the service. `Order` is unable to refuse anything.
- `getStatus()` is consulted from outside. `setStatus()` lets anyone write any string.
- The collection of lines leaks: `order.getLines().add(...)` mutates internal state without the order knowing.
- The total is stored, then recomputed externally, then written back. Two sources of truth.

This is the **anemic domain model** — see `[../../07-antipatterns-and-code-smells/02-anemic-domain-model/](../../07-antipatterns-and-code-smells/02-anemic-domain-model/)`. The refactor below is the antidote.

---

## 2. Move 1 — Move Method: pull `place` into the order

The first move is mechanical. `OrderService.place(order)` works exclusively on `order` and its lines. That's the textbook signal for **Move Method**: the method belongs on the data it operates on.

```java
public class Order {
    // fields unchanged for now

    public void place() {
        if (!"DRAFT".equals(status)) {
            throw new IllegalStateException("only drafts can be placed");
        }
        if (lines.isEmpty()) {
            throw new IllegalStateException("empty order");
        }
        BigDecimal sum = BigDecimal.ZERO;
        for (OrderLine line : lines) {
            sum = sum.add(line.getUnitPrice().multiply(BigDecimal.valueOf(line.getQty())));
        }
        this.total = sum;
        this.status = "PLACED";
        this.placedAt = Instant.now();
    }
}
```

```java
public class OrderService {
    public void place(Order order) { order.place(); }
}
```

The service is now a one-line forwarder. That's a smell of its own — but a useful one, because it tells you the service has no reason to exist for this method. Apply the same move to `cancel` and `addLine`.

---

## 3. Move 2 — Extract Method: name the steps

`place()` does three things: validate, compute the total, transition the state. Extract them so each step has a name.

```java
public class Order {
    public void place() {
        requireDraft();
        requireNonEmpty();
        this.total    = computeTotal();
        this.status   = "PLACED";
        this.placedAt = Instant.now();
    }

    private void requireDraft() {
        if (!"DRAFT".equals(status))
            throw new IllegalStateException("only drafts can be placed");
    }
    private void requireNonEmpty() {
        if (lines.isEmpty())
            throw new IllegalStateException("empty order");
    }
    private BigDecimal computeTotal() {
        BigDecimal sum = BigDecimal.ZERO;
        for (OrderLine line : lines) {
            sum = sum.add(line.subtotal());     // note: pushed into OrderLine
        }
        return sum;
    }
}
```

Two side-effects of this small step:

1. `OrderLine.subtotal()` appears naturally. The line knows its own price and quantity — it should compute its own subtotal. Behavior follows data.
2. The validation methods are named. `requireDraft()` is a domain phrase, not an `if`.

---

## 4. Move 3 — Replace primitive status with a real type

`status` is a `String`. Any string compiles. The compiler can't help when someone writes `"PAYED"` instead of `"PAID"`, or compares against `"placed"` instead of `"PLACED"`.

Replace it with an enum:

```java
public enum OrderStatus { DRAFT, PLACED, PAID, SHIPPED, CANCELLED }

public class Order {
    private OrderStatus status = OrderStatus.DRAFT;

    private void requireDraft() {
        if (status != OrderStatus.DRAFT)
            throw new IllegalStateException("only drafts can be placed");
    }
}
```

The enum is a small step, but it eliminates an entire class of typo bugs and gives the IDE something to autocomplete. It also sets up Move 5 (polymorphism).

---

## 5. Move 4 — Encapsulate Collection: stop leaking `lines`

`order.getLines().add(line)` is a hole in the encapsulation: the caller mutates the internal list directly. The order can neither validate nor react. Close the hole.

```java
public class Order {
    private final List<OrderLine> lines = new ArrayList<>();

    public void add(Product product, int qty) {
        requireDraft();
        if (qty <= 0) throw new IllegalArgumentException("qty must be positive");
        lines.add(new OrderLine(product, qty));
    }

    public void remove(Product product) {
        requireDraft();
        lines.removeIf(l -> l.product().equals(product));
    }

    public List<OrderLine> lines() {
        return List.copyOf(lines);     // read-only snapshot
    }
}
```

Now there is no way for a caller to add a line to a non-draft order — the rule is enforced by the only path into the collection. `lines()` returns a snapshot, not the internal reference; callers can iterate but not mutate.

This is also where **Law of Demeter** stops being violated — see `[../../03-design-principles/03-law-of-demeter/](../../03-design-principles/03-law-of-demeter/)`. Callers no longer reach `order.getLines().add(...)`; they tell the order what to do.

---

## 6. Move 5 — Replace Conditional with Polymorphism

After a few rounds, the order looks like this:

```java
public void cancel() {
    switch (status) {
        case DRAFT, PLACED -> status = OrderStatus.CANCELLED;
        case PAID          -> { status = OrderStatus.CANCELLED; refund(); }
        case SHIPPED       -> throw new IllegalStateException("already shipped");
        case CANCELLED     -> throw new IllegalStateException("already cancelled");
    }
}

public void ship() {
    if (status != OrderStatus.PAID)
        throw new IllegalStateException("must be paid to ship");
    status = OrderStatus.SHIPPED;
}

public void pay(Payment p) {
    if (status != OrderStatus.PLACED)
        throw new IllegalStateException("must be placed to pay");
    // ...
    status = OrderStatus.PAID;
}
```

Every transition starts with `if (status != ...)`. That repetition is the smell. The rules are about *what each status allows*. Push them onto the status itself:

```java
public enum OrderStatus {
    DRAFT     { @Override boolean canPlace()  { return true; }  },
    PLACED    { @Override boolean canPay()    { return true; }
                @Override boolean canCancel() { return true; }  },
    PAID      { @Override boolean canShip()   { return true; }
                @Override boolean canCancel() { return true; }  },
    SHIPPED   { /* terminal for happy path */                   },
    CANCELLED { /* terminal */                                   };

    boolean canPlace()  { return false; }
    boolean canPay()    { return false; }
    boolean canShip()   { return false; }
    boolean canCancel() { return false; }
}
```

```java
public class Order {
    public void ship() {
        if (!status.canShip())
            throw new IllegalStateException("cannot ship from " + status);
        status = OrderStatus.SHIPPED;
    }
    // pay(), cancel() similar
}
```

The transition rule lives next to the state it concerns. Adding a new status (say `RETURNED`) means editing one enum constant, not hunting `switch` statements across the codebase.

For richer state machines, sealed types per state (`DraftOrder`, `PlacedOrder`, `PaidOrder`) make illegal transitions un-callable at compile time. That's a senior-level refactor; the enum form is the right pragmatic stop for most code.

---

## 7. Move 6 — Inline the dead service

After moves 1–5, `OrderService` looks like this:

```java
public class OrderService {
    public void place(Order o)                  { o.place(); }
    public void cancel(Order o)                 { o.cancel(); }
    public void addLine(Order o, OrderLine l)   { o.add(l.product(), l.qty()); }
}
```

It's pure forwarding. Delete it. Have callers talk to `Order` directly.

What stays in service-shaped classes:

| Concern                                           | Belongs in service? |
|---------------------------------------------------|---------------------|
| Business rules of one order                       | No — on `Order`     |
| Coordinating multiple orders / aggregates         | Yes                 |
| Calling external systems (payment gateway, email) | Yes                 |
| Loading and saving from a repository              | Yes                 |
| Transactions, retries, locking                    | Yes                 |

A leaner `OrderingService` survives — but it orchestrates, it doesn't enforce rules.

---

## 8. The cohesion lens — does this method belong here?

After each move, ask:

1. Does the method use mostly this object's fields? If yes, it belongs.
2. Does it need to reach into another object's internals to work? If yes, it probably belongs there instead.
3. Does it need *external* services (DB, HTTP, queue) to do its job? Then it doesn't belong on the domain object — it belongs on something that can hold collaborators.

For `Order.computeTotal()`: uses `lines`, calls `OrderLine.subtotal()`. Belongs on `Order`. Good.

For `Order.sendConfirmationEmail()`: would need an `EmailService`. Doesn't belong on `Order`. The order can *return* a `ConfirmationRequest`; the orchestrator sends it.

For `Order.save()`: would need a database connection. Doesn't belong on `Order`. The repository handles persistence; the order knows nothing about it.

This is the cohesion test in one line: **a method belongs where its data lives, not where its side-effects fire.**

---

## 9. Mistakes that look like progress

**Mistake 1: methods that wrap a single setter.**

```java
public void changeStatus(OrderStatus s) { this.status = s; }
```

You renamed `setStatus`. The object still has no opinion about which transitions are legal. This is **setter cosplay**, not behavior. A real method names a domain operation (`ship`, `cancel`) and enforces the rule.

**Mistake 2: getters in disguise.**

```java
public boolean hasStatus(OrderStatus s) { return this.status == s; }
```

If callers are constantly asking `hasStatus(SHIPPED)` and branching on the answer, you haven't moved the rule into the object — you've just changed the syntax of the leak. Replace `if (order.hasStatus(PLACED)) order.pay(p);` with `order.pay(p);` and let the order refuse if it must.

**Mistake 3: "do everything" methods.**

```java
public void update(Map<String, Object> changes) { ... }
```

A god-method that takes a bag of fields and applies whatever's inside. The caller decides what to change; the object obeys. This is a setter for every field, wearing one signature. Split into named operations: `add`, `remove`, `applyDiscount`, `changeShippingAddress`.

**Mistake 4: stripping getters too aggressively.**

You still need a few. `total()`, `status()`, `lines()` — a UI has to render *something*. The rule isn't *no getters*; it's *no getters that exist only so external code can decide on the object's behalf*. A getter that exposes a value for display is fine. A getter that exists so a service can read, branch, and write back is not.

**Mistake 5: pulling persistence in.**

```java
public void place() {
    // ... rules ...
    repository.save(this);    // NO
}
```

The order now needs a repository to exist. Tests need a fake. The aggregate has grown a tentacle into infrastructure. Keep `place()` pure; let the caller save. Behavior-first does not mean *everything* on the object — only behavior that depends on the object's own state.

---

## 10. The result, side by side

| Aspect                       | Before                                | After                                                    |
|------------------------------|----------------------------------------|----------------------------------------------------------|
| Lines on `Order`             | 12 fields, mostly setters              | 6 fields, ~10 named operations                           |
| Rules location               | `OrderService` + caller code           | `Order` + `OrderStatus`                                  |
| Status type                  | `String`                               | `OrderStatus` enum                                       |
| Total                        | Stored, recomputed externally          | Computed by `computeTotal()`, single source              |
| Lines collection             | Exposed via `getLines()`               | `add` / `remove` / `lines()` snapshot                    |
| Service                      | Holds all logic                        | Orchestrates persistence + integrations only             |
| Adding a state               | Change `switch` in N service methods   | Add one enum constant                                    |
| Test setup                   | Mock service, set fields, assert       | New `Order`, call methods, assert state via accessors    |

The codebase grew shorter, not longer. The shape of "what an order is" became visible from one file.

---

## 11. Where to stop — honest limits

Behavior-first is a direction, not a religion. Real Java code has constraints:

- **JPA / Hibernate** wants a no-arg constructor and field access. You can keep that and still avoid public setters — use package-private setters for the ORM only, or use field access mode.
- **Jackson / serialization** can deserialize via constructors (records do this for free). You don't need setters to deserialize.
- **Validation frameworks** (`@NotNull`, `@Min`) expect fields. Compatible with behavior-first — the object still owns its rules; the annotations are a redundant safety net.
- **DTOs at the edge of your system** *should* be anemic. A `CreateOrderRequest` from a controller is a transport object — it has no behavior because it has no domain meaning. Convert it to a domain `Order` at the boundary. Don't apply behavior-first to DTOs; they're not objects in West's sense.
- **Read models / projections** for queries are also fine as records of fields. Read-side and write-side have different shapes — that's CQRS, and it's compatible with behavior-first on the write side.

The rule of thumb: **behavior-first applies to objects that own decisions**. It does not apply to objects whose only job is to cross a boundary.

---

## 12. A second example — Subscription

To see the pattern transfer, here is the same refactor compressed for a different domain.

Before:

```java
public class Subscription {
    public Long planId;
    public Instant startedAt;
    public Instant cancelledAt;
    public String state;          // ACTIVE, PAUSED, CANCELLED
    // getters/setters
}

public class SubscriptionService {
    public void pause(Subscription s) {
        if (!"ACTIVE".equals(s.getState())) throw new IllegalStateException();
        s.setState("PAUSED");
    }
    public void resume(Subscription s) { ... }
    public void cancel(Subscription s) { ... }
}
```

After:

```java
public final class Subscription {
    private final Plan plan;
    private final Instant startedAt;
    private SubscriptionState state = SubscriptionState.ACTIVE;
    private Instant cancelledAt;

    public Subscription(Plan plan, Clock clock) {
        this.plan = plan;
        this.startedAt = clock.instant();
    }

    public void pause()  { state = state.pause();  }
    public void resume() { state = state.resume(); }
    public void cancel(Clock clock) {
        state = state.cancel();
        cancelledAt = clock.instant();
    }

    public boolean isActive() { return state == SubscriptionState.ACTIVE; }
    public Plan plan() { return plan; }
}
```

The state transitions live in `SubscriptionState`; the `Subscription` exposes domain verbs. No `SubscriptionService` survives — only an orchestrator that loads, calls, and saves.

---

## 13. Recap — the moves in order

When you face an anemic class, the refactor is mechanical:

1. **Move Method** — pull each service method onto the object that owns its data.
2. **Extract Method** — name the steps inside the now-on-object operation.
3. **Replace Primitive with Type** — strings become enums, doubles become `Money`, longs become `OrderId`.
4. **Encapsulate Collection** — replace `getLines()` with `add` / `remove` / read-only snapshot.
5. **Replace Conditional with Polymorphism** — push state-specific behavior onto the state.
6. **Inline / shrink the service** — what's left is orchestration, not rules.

Each move is small. Each move is safe under tests. The aggregate isn't done — it's just *moving toward behavior-first*. Stop when the next move would drag infrastructure into the object.

---

## 14. What's next

| Topic                                                     | File              |
|-----------------------------------------------------------|-------------------|
| Behavior-first under ORM, performance, framework pressure | `senior.md`        |
| Driving the mindset across a team and a codebase          | `professional.md`  |
| Hands-on exercises                                        | `tasks.md`         |
| Interview Q&A                                             | `interview.md`     |

---

**Memorize this:** behavior-first refactoring is six moves — Move Method, Extract Method, Replace Primitive, Encapsulate Collection, Replace Conditional with Polymorphism, Inline Service. Stop where infrastructure begins. The object owns its rules; the orchestrator owns its collaborators.
