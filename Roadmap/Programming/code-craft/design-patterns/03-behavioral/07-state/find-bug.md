# State — Find the Bug

> **Source:** [refactoring.guru/design-patterns/state](https://refactoring.guru/design-patterns/state)

Each section presents a State pattern that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Hidden state mutation outside FSM](#bug-1-hidden-state-mutation-outside-fsm)
2. [Bug 2: New state allocation per transition](#bug-2-new-state-allocation-per-transition)
3. [Bug 3: Concurrent transitions race](#bug-3-concurrent-transitions-race)
4. [Bug 4: Initial state is null](#bug-4-initial-state-is-null)
5. [Bug 5: State holds per-Context data](#bug-5-state-holds-per-context-data)
6. [Bug 6: Missing transition silently no-ops](#bug-6-missing-transition-silently-no-ops)
7. [Bug 7: Cyclic transitions infinite loop](#bug-7-cyclic-transitions-infinite-loop)
8. [Bug 8: Persistence loses state on crash](#bug-8-persistence-loses-state-on-crash)
9. [Bug 9: String-based state, typo at runtime](#bug-9-string-based-state-typo-at-runtime)
10. [Bug 10: Transition during transition (re-entry)](#bug-10-transition-during-transition-re-entry)
11. [Bug 11: Schema migration breaks old state values](#bug-11-schema-migration-breaks-old-state-values)
12. [Bug 12: Optimistic locking forgotten](#bug-12-optimistic-locking-forgotten)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Hidden state mutation outside FSM

```java
public final class Order {
    public String status = "cart";   // public
    private OrderState state = new Cart();
}

// Elsewhere:
order.status = "delivered";   // bypasses FSM
```

State and status field disagree.

<details><summary>Reveal</summary>

**Bug:** Public string field bypasses the State pattern. Code can mutate state without going through valid transitions. The `state` object and `status` string drift apart.

**Fix:** make state private; expose getters.

```java
private OrderState state = new Cart();
public String status() { return state.name(); }
```

Or: drop the redundant string field; derive from `state.name()`.

**Lesson:** State pattern requires all transitions to go through the FSM API. Direct mutation defeats the pattern.

</details>

---

## Bug 2: New state allocation per transition

```java
public void tick() {
    if (state instanceof Red) state = new Green();
    else if (state instanceof Green) state = new Yellow();
    else if (state instanceof Yellow) state = new Red();
}
```

For a high-frequency FSM (millions of ticks/sec), GC pressure visible.

<details><summary>Reveal</summary>

**Bug:** Each transition allocates a new state object. For stateless states, wasteful.

**Fix:** singleton states.

```java
public static final OrderState RED = new Red();
public static final OrderState GREEN = new Green();
public static final OrderState YELLOW = new Yellow();

public void tick() {
    if (state == RED) state = GREEN;
    else if (state == GREEN) state = YELLOW;
    else state = RED;
}
```

Or use enum:

```java
public enum Color { RED, GREEN, YELLOW;
    public Color next() { return values()[(ordinal() + 1) % 3]; }
}
```

**Lesson:** Stateless states should be singletons. No allocation per transition.

</details>

---

## Bug 3: Concurrent transitions race

```java
public void publish() {
    state.publish(this);   // not synchronized
}

// Threads A and B both call publish; both see "draft"; both transition; one wins, other's effect lost.
```

<details><summary>Reveal</summary>

**Bug:** Two threads read state simultaneously, both transition. State change is not atomic.

**Fix:** synchronize the Context.

```java
public synchronized void publish() { state.publish(this); }
public synchronized void approve() { state.approve(this); }
```

For higher throughput: optimistic locking with `AtomicReference`.

```java
private final AtomicReference<DocumentState> state;

public void publish() {
    DocumentState current = state.get();
    DocumentState next = current.publish();
    if (next != null && !state.compareAndSet(current, next)) {
        // retry or surface error
    }
}
```

**Lesson:** Multi-threaded FSM transitions must be atomic. Synchronize or use CAS.

</details>

---

## Bug 4: Initial state is null

```java
public final class Order {
    private OrderState state;   // not initialized

    public void pay() { state.pay(this); }   // NPE
}
```

<details><summary>Reveal</summary>

**Bug:** No initial state. First method call fails with NullPointerException.

**Fix:** initialize in constructor.

```java
public final class Order {
    private OrderState state = new Cart();   // explicit initial
}
```

Or require it as parameter:

```java
public Order(OrderState initialState) {
    this.state = Objects.requireNonNull(initialState);
}
```

**Lesson:** Context must always have a valid state. No null initial.

</details>

---

## Bug 5: State holds per-Context data

```java
public final class Active implements OrderState {
    private final List<Item> items;   // BUG: state-scoped data

    public Active(List<Item> items) { this.items = items; }
}

// Singleton instance shared:
public static final OrderState ACTIVE = new Active(...);
```

Two different orders share the same items list.

<details><summary>Reveal</summary>

**Bug:** Singleton state holding per-Context data. All Contexts using this singleton share the data — corruption.

**Fix:** move data to the Context. State must be stateless to be a singleton.

```java
public final class Order {
    private List<Item> items = new ArrayList<>();
    private OrderState state = Active.INSTANCE;
}

public final class Active implements OrderState {
    public static final Active INSTANCE = new Active();
    private Active() {}
    // operates on order.items() via Context
}
```

**Lesson:** Singleton states must be stateless. Per-Context data lives in the Context.

</details>

---

## Bug 6: Missing transition silently no-ops

```java
public interface State {
    default void publish(Doc d) {}   // default: no-op
}

public final class Published implements State {
    // doesn't override publish; silently does nothing
}
```

User clicks "publish" on already-published doc; nothing happens; no feedback.

<details><summary>Reveal</summary>

**Bug:** Default no-op masks invalid operations. User has no feedback.

**Fix:** decide explicitly: throw, log, or return false.

```java
default void publish(Doc d) {
    throw new IllegalStateException("can't publish in " + getClass().getSimpleName());
}

public final class Published implements State {
    @Override public void publish(Doc d) { System.out.println("already published"); }
}
```

For user-facing actions: log a warning. For internal bugs: throw.

**Lesson:** Decide consciously what invalid operations do. Silent no-ops hide bugs.

</details>

---

## Bug 7: Cyclic transitions infinite loop

```java
public final class A implements State {
    public void event(Context c) { c.setState(B.INSTANCE); }
}

public final class B implements State {
    public void event(Context c) {
        c.setState(A.INSTANCE);
        c.event();   // BUG: triggers A's event, which goes to B, infinite recursion
    }
}
```

<details><summary>Reveal</summary>

**Bug:** State A and B cycle through each other. `c.event()` from B triggers A's event, which transitions to B, which calls event again.

**Fix:** detect cycles or restructure to avoid them.

```java
public final class B implements State {
    public void event(Context c) {
        c.setState(A.INSTANCE);
        // Don't call c.event() again
    }
}
```

If a transition naturally needs follow-up, model as separate explicit calls.

**Lesson:** Cycles in transitions can produce infinite recursion. Avoid implicit re-fires; use explicit events.

</details>

---

## Bug 8: Persistence loses state on crash

```java
public final class Order {
    private OrderState state = new Cart();   // in-memory only
}
```

Process restart loses all order states.

<details><summary>Reveal</summary>

**Bug:** State lives only in memory. Crash or restart = data loss.

**Fix:** persist state. Status column in DB:

```java
public final class Order {
    private final String id;
    private OrderState state;

    public void persist(JdbcTemplate jdbc) {
        jdbc.update("UPDATE orders SET status = ? WHERE id = ?", state.name(), id);
    }

    public static Order load(JdbcTemplate jdbc, String id) {
        String status = jdbc.queryForObject("SELECT status FROM orders WHERE id = ?", String.class, id);
        return new Order(id, fromName(status));
    }

    private static OrderState fromName(String name) {
        return switch (name) {
            case "cart" -> new Cart();
            case "paid" -> new Paid();
            // ...
            default -> throw new IllegalArgumentException("unknown status: " + name);
        };
    }
}
```

**Lesson:** Long-lived FSMs must persist their state. In-memory only = data loss on restart.

</details>

---

## Bug 9: String-based state, typo at runtime

```java
public void transition(String to) {
    if (!to.equals("paid") && !to.equals("shipped")) throw new IllegalArgumentException();
    this.status = to;
}

// Caller:
order.transition("payed");   // typo; throws at runtime
```

<details><summary>Reveal</summary>

**Bug:** String-based states are fragile. Typos compile fine; only fail at runtime. No autocomplete, no rename refactoring.

**Fix:** enum or sealed types.

```java
public enum Status {
    CART, CHECKOUT, PAID, SHIPPED, DELIVERED, CANCELLED;
}

public void transition(Status to) { /* ... */ }

order.transition(Status.PAID);   // compile-time check
```

**Lesson:** Use type-safe representations for state. Strings rot.

</details>

---

## Bug 10: Transition during transition (re-entry)

```java
public final class Cart implements State {
    public void pay(Order o) {
        o.setState(new Checkout());   // transition
        sendNotification(o);           // BUG: notification triggers another state-affecting call
    }
}

// sendNotification eventually calls o.cancel(), which transitions to Cancelled;
// but we're still in Cart's pay method, expecting Checkout.
```

<details><summary>Reveal</summary>

**Bug:** Side effects during transition cause re-entry. The order ends up in an unexpected state.

**Fix:** complete the transition first; emit events afterward.

```java
public final class Cart implements State {
    public void pay(Order o) {
        o.setState(new Checkout());
        o.queueEvent("payment-started");   // queue, don't execute now
    }
}

// Order processes events after the current method returns.
```

Or model side effects as transitions themselves: `Cart.pay` → `Checkout` → emits event externally.

**Lesson:** Beware re-entrant calls during transitions. Queue side effects; process after.

</details>

---

## Bug 11: Schema migration breaks old state values

```python
# v1: states are Cart, Checkout, Paid
# v2: rename "Cart" to "Pending"

class Order:
    @classmethod
    def from_status(cls, status: str) -> "Order":
        if status == "Pending": return cls(state=Pending())
        elif status == "Checkout": return cls(state=Checkout())
        # BUG: no handling of old "Cart" value
```

V1 orders in DB have `status = "Cart"`; loading throws.

<details><summary>Reveal</summary>

**Bug:** Renaming a state breaks loading of old data. Migration not handled.

**Fix:** migration logic.

```python
@classmethod
def from_status(cls, status: str) -> "Order":
    # Migration: old "Cart" → new "Pending"
    if status == "Cart": status = "Pending"

    if status == "Pending": return cls(state=Pending())
    elif status == "Checkout": return cls(state=Checkout())
```

Or: data migration: `UPDATE orders SET status = 'Pending' WHERE status = 'Cart'`. Then remove migration code.

**Lesson:** State renames require migrations. Either at-load or as DB migration. Don't break old data.

</details>

---

## Bug 12: Optimistic locking forgotten

```java
public void pay(String id) {
    Order o = repo.findById(id);
    if (!"cart".equals(o.status())) throw new IllegalStateException();
    o.setStatus("paid");
    repo.save(o);
}
```

Two concurrent calls both see "cart"; both proceed; both write "paid"; one's effect dominates the other.

<details><summary>Reveal</summary>

**Bug:** Read-modify-write with no atomic check. Race condition; lost updates.

**Fix:** optimistic locking with version or status check in WHERE clause.

```java
public void pay(String id) {
    int rows = jdbc.update(
        "UPDATE orders SET status = 'paid', version = version + 1 " +
        "WHERE id = ? AND status = 'cart'",
        id
    );
    if (rows == 0) throw new ConcurrentModificationException("status changed");
}
```

DB enforces atomicity; concurrent attempts fail.

**Lesson:** Persistent FSM transitions must be atomic at DB level. Optimistic locking with status / version in WHERE.

</details>

---

## Practice Tips

- **Public state fields = anti-pattern.** Make state private; expose getter.
- **Singleton stateless states.** No allocation per transition.
- **Synchronize concurrent transitions.** Or use CAS / optimistic locking.
- **Initialize the initial state.** Never null.
- **Singleton states must be stateless.** Per-Context data → Context.
- **Decide invalid operation behavior explicitly.** Throw, log, no-op — but consciously.
- **Avoid transition cycles.** Implicit re-fires cause infinite recursion.
- **Persist long-lived FSM state.** In-memory = data loss on restart.
- **Type-safe states.** Enums or sealed types over strings.
- **Beware re-entrant transitions.** Queue side effects.
- **Schema migrations for renamed states.** Don't break old data.
- **DB-level atomicity for persistent transitions.** Optimistic locking.

[← Tasks](tasks.md) · [Optimize →](optimize.md)
