# State — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/state](https://refactoring.guru/design-patterns/state)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Traffic light FSM](#task-1-traffic-light-fsm)
2. [Task 2: Order lifecycle](#task-2-order-lifecycle)
3. [Task 3: Vending machine](#task-3-vending-machine)
4. [Task 4: Media player](#task-4-media-player)
5. [Task 5: Wizard form](#task-5-wizard-form)
6. [Task 6: Transition table FSM](#task-6-transition-table-fsm)
7. [Task 7: Hierarchical states](#task-7-hierarchical-states)
8. [Task 8: Persistent FSM with optimistic locking](#task-8-persistent-fsm-with-optimistic-locking)
9. [Task 9: Singleton states](#task-9-singleton-states)
10. [Task 10: CAS-based state transitions](#task-10-cas-based-state-transitions)
11. [How to Practice](#how-to-practice)

---

## Task 1: Traffic light FSM

**Brief.** Red → Green → Yellow → Red. `tick()` advances.

### Solution (Java)

```java
public sealed interface Light permits Red, Green, Yellow {
    Light next();
    String color();
}

public final class Red implements Light {
    public Light next() { return new Green(); }
    public String color() { return "red"; }
}

public final class Green implements Light {
    public Light next() { return new Yellow(); }
    public String color() { return "green"; }
}

public final class Yellow implements Light {
    public Light next() { return new Red(); }
    public String color() { return "yellow"; }
}

public final class TrafficLight {
    private Light state = new Red();
    public void tick() { state = state.next(); }
    public String color() { return state.color(); }
}

class Demo {
    public static void main(String[] args) {
        var tl = new TrafficLight();
        for (int i = 0; i < 6; i++) {
            System.out.println(tl.color());
            tl.tick();
        }
    }
}
```

Sealed interface — compile-time exhaustiveness.

---

## Task 2: Order lifecycle

**Brief.** Cart → Checkout → Paid → Shipped → Delivered. Cancel from Cart, Checkout, or Paid.

### Solution (Java)

```java
public sealed interface OrderState permits Cart, Checkout, Paid, Shipped, Delivered, Cancelled {
    default void pay(Order o) { throw new IllegalStateException("can't pay in " + getClass().getSimpleName()); }
    default void ship(Order o) { throw new IllegalStateException("can't ship in " + getClass().getSimpleName()); }
    default void deliver(Order o) { throw new IllegalStateException("can't deliver in " + getClass().getSimpleName()); }
    default void cancel(Order o) { o.setState(new Cancelled()); }
}

public final class Cart implements OrderState {
    public void pay(Order o) { o.setState(new Checkout()); }
}
public final class Checkout implements OrderState {
    public void pay(Order o) { o.setState(new Paid()); }
}
public final class Paid implements OrderState {
    public void ship(Order o) { o.setState(new Shipped()); }
}
public final class Shipped implements OrderState {
    public void deliver(Order o) { o.setState(new Delivered()); }
    public void cancel(Order o) { throw new IllegalStateException("can't cancel after shipping"); }
}
public final class Delivered implements OrderState {
    public void cancel(Order o) { throw new IllegalStateException("can't cancel after delivery"); }
}
public final class Cancelled implements OrderState {
    public void cancel(Order o) { /* idempotent */ }
}

public final class Order {
    private OrderState state = new Cart();
    public void setState(OrderState s) { this.state = s; }
    public void pay() { state.pay(this); }
    public void ship() { state.ship(this); }
    public void deliver() { state.deliver(this); }
    public void cancel() { state.cancel(this); }
    public String state() { return state.getClass().getSimpleName(); }
}
```

Default methods enforce invalid transitions. Cancel allowed from most states; not after delivery / shipping.

---

## Task 3: Vending machine

**Brief.** Idle / Selecting / Dispensing / OutOfStock. Insert coin, select product, dispense.

### Solution (Python)

```python
from typing import Protocol


class State(Protocol):
    def insert_coin(self, m: "Machine") -> None: ...
    def select(self, m: "Machine", p: str) -> None: ...
    def dispense(self, m: "Machine") -> None: ...


class Idle:
    def insert_coin(self, m: "Machine") -> None:
        print("coin accepted")
        m.set_state(Selecting())
    def select(self, m, p): print("insert coin first")
    def dispense(self, m): print("nothing to dispense")


class Selecting:
    def insert_coin(self, m): print("coin already inserted")
    def select(self, m: "Machine", p: str) -> None:
        if p in m.stock and m.stock[p] > 0:
            print(f"selected {p}")
            m.set_state(Dispensing(p))
        else:
            print(f"{p} not available")
    def dispense(self, m): print("select something first")


class Dispensing:
    def __init__(self, product: str) -> None: self.product = product
    def insert_coin(self, m): print("wait for dispensing")
    def select(self, m, p): print("wait for dispensing")
    def dispense(self, m: "Machine") -> None:
        print(f"dispensing {self.product}")
        m.stock[self.product] -= 1
        m.set_state(Idle() if any(v > 0 for v in m.stock.values()) else OutOfStock())


class OutOfStock:
    def insert_coin(self, m): print("out of stock; refunding")
    def select(self, m, p): print("out of stock")
    def dispense(self, m): print("out of stock")


class Machine:
    def __init__(self, stock: dict) -> None:
        self.stock = stock
        self._state: State = Idle() if any(v > 0 for v in stock.values()) else OutOfStock()
    def set_state(self, s: State) -> None: self._state = s
    def insert_coin(self): self._state.insert_coin(self)
    def select(self, p: str): self._state.select(self, p)
    def dispense(self): self._state.dispense(self)


m = Machine({"cola": 1, "chips": 0})
m.insert_coin()        # coin accepted
m.select("cola")       # selected cola
m.dispense()           # dispensing cola
m.insert_coin()        # out of stock; refunding
```

---

## Task 4: Media player

**Brief.** Stopped / Playing / Paused. Play / Pause / Stop methods.

### Solution (Java with sealed interface)

```java
public sealed interface PlayerState permits Stopped, Playing, Paused {
    default void play(Player p) {}
    default void pause(Player p) {}
    default void stop(Player p) {}
    String name();
}

public final class Stopped implements PlayerState {
    public void play(Player p) { System.out.println("starting playback"); p.setState(new Playing()); }
    public String name() { return "stopped"; }
}

public final class Playing implements PlayerState {
    public void pause(Player p) { System.out.println("pausing"); p.setState(new Paused()); }
    public void stop(Player p) { System.out.println("stopping"); p.setState(new Stopped()); }
    public String name() { return "playing"; }
}

public final class Paused implements PlayerState {
    public void play(Player p) { System.out.println("resuming"); p.setState(new Playing()); }
    public void stop(Player p) { System.out.println("stopping"); p.setState(new Stopped()); }
    public String name() { return "paused"; }
}

public final class Player {
    private PlayerState state = new Stopped();
    public void setState(PlayerState s) { this.state = s; }
    public void play() { state.play(this); }
    public void pause() { state.pause(this); }
    public void stop() { state.stop(this); }
    public String state() { return state.name(); }
}
```

Default methods make invalid operations no-ops; concrete states override what's allowed.

---

## Task 5: Wizard form

**Brief.** 3 steps; Next / Back. Step 2 conditional based on step 1's choice.

### Solution (TypeScript)

```typescript
interface WizardState {
    next(w: Wizard): void;
    back(w: Wizard): void;
    name(): string;
}

class Step1 implements WizardState {
    next(w: Wizard) {
        w.setState(w.data.userType === "enterprise" ? new Step2Enterprise() : new Step3());
    }
    back(w: Wizard) { /* no-op */ }
    name() { return "step-1"; }
}

class Step2Enterprise implements WizardState {
    next(w: Wizard) { w.setState(new Step3()); }
    back(w: Wizard) { w.setState(new Step1()); }
    name() { return "step-2-enterprise"; }
}

class Step3 implements WizardState {
    next(w: Wizard) { /* finish */ console.log("done"); }
    back(w: Wizard) {
        w.setState(w.data.userType === "enterprise" ? new Step2Enterprise() : new Step1());
    }
    name() { return "step-3"; }
}

class Wizard {
    private state: WizardState = new Step1();
    data: any = {};
    setState(s: WizardState) { this.state = s; }
    next() { this.state.next(this); }
    back() { this.state.back(this); }
    currentStep() { return this.state.name(); }
}
```

Step 2 only appears for enterprise users; transitions skip it otherwise.

---

## Task 6: Transition table FSM

**Brief.** Same Order FSM but driven by a transition table.

### Solution (Python)

```python
from enum import Enum, auto


class S(Enum):
    CART = auto(); CHECKOUT = auto(); PAID = auto()
    SHIPPED = auto(); DELIVERED = auto(); CANCELLED = auto()


class E(Enum):
    PAY = auto(); SHIP = auto(); DELIVER = auto(); CANCEL = auto()


TRANSITIONS = {
    (S.CART, E.PAY): S.CHECKOUT,
    (S.CHECKOUT, E.PAY): S.PAID,
    (S.PAID, E.SHIP): S.SHIPPED,
    (S.SHIPPED, E.DELIVER): S.DELIVERED,
    (S.CART, E.CANCEL): S.CANCELLED,
    (S.CHECKOUT, E.CANCEL): S.CANCELLED,
    (S.PAID, E.CANCEL): S.CANCELLED,
}


class Order:
    def __init__(self) -> None: self.state = S.CART

    def fire(self, event: E) -> None:
        key = (self.state, event)
        if key not in TRANSITIONS: raise ValueError(f"can't fire {event} in {self.state}")
        self.state = TRANSITIONS[key]


o = Order()
o.fire(E.PAY); o.fire(E.PAY); o.fire(E.SHIP); o.fire(E.DELIVER)
print(o.state)   # S.DELIVERED
```

Lightweight; declarative.

---

## Task 7: Hierarchical states

**Brief.** Player FSM: On (Standby / Active.Playing / Active.Paused) / Off. PowerOff applies to all of On.

### Solution (Kotlin)

```kotlin
sealed class State {
    sealed class On : State() {
        object Standby : On()
        sealed class Active : On() {
            object Playing : Active()
            object Paused : Active()
        }
    }
    object Off : State()
}

class Player {
    var state: State = State.Off
        private set

    fun powerOn() {
        state = if (state is State.Off) State.On.Standby else state
    }

    fun powerOff() {
        state = if (state is State.On) State.Off else state   // applies to ALL On
    }

    fun play() {
        state = when (state) {
            State.On.Standby, State.On.Active.Paused -> State.On.Active.Playing
            else -> state
        }
    }

    fun pause() {
        state = if (state is State.On.Active.Playing) State.On.Active.Paused else state
    }
}

fun main() {
    val p = Player()
    p.powerOn(); println(p.state)   // Standby
    p.play(); println(p.state)      // Playing
    p.pause(); println(p.state)     // Paused
    p.powerOff(); println(p.state)  // Off (from any substate of On)
}
```

Sealed hierarchy; type-narrowed transitions.

---

## Task 8: Persistent FSM with optimistic locking

**Brief.** Order with status in DB. Optimistic locking on transitions.

### Solution (pseudo-Java + SQL)

```java
public final class OrderRepo {
    private final JdbcTemplate jdbc;

    public boolean transition(String id, String fromStatus, String toStatus, int expectedVersion) {
        int rows = jdbc.update(
            "UPDATE orders SET status = ?, version = version + 1 " +
            "WHERE id = ? AND status = ? AND version = ?",
            toStatus, id, fromStatus, expectedVersion
        );
        return rows == 1;
    }

    public Order load(String id) {
        return jdbc.queryForObject(
            "SELECT id, status, version FROM orders WHERE id = ?",
            (rs, rn) -> new Order(rs.getString("id"), rs.getString("status"), rs.getInt("version")),
            id
        );
    }
}

public final class OrderService {
    private final OrderRepo repo;

    public void pay(String id) {
        Order o = repo.load(id);
        if (!"cart".equals(o.status())) throw new IllegalStateException();
        if (!repo.transition(id, "cart", "paid", o.version())) {
            throw new ConcurrentModificationException("retry");
        }
    }
}
```

CAS at DB level. Concurrent transitions fail; caller retries.

---

## Task 9: Singleton states

**Brief.** Traffic light with Red/Yellow/Green singletons. Zero allocation per transition.

### Solution (Java)

```java
public final class TrafficLight {
    public enum Color {
        RED { public Color next() { return GREEN; } },
        GREEN { public Color next() { return YELLOW; } },
        YELLOW { public Color next() { return RED; } };

        public abstract Color next();
    }

    private Color state = Color.RED;
    public void tick() { state = state.next(); }
    public Color color() { return state; }
}

class Demo {
    public static void main(String[] args) {
        var tl = new TrafficLight();
        for (int i = 0; i < 6; i++) {
            System.out.println(tl.color());
            tl.tick();
        }
    }
}
```

Java enum: methods on enum constants. Zero allocation; type-safe; fast.

---

## Task 10: CAS-based state transitions

**Brief.** Lock-free FSM via AtomicReference + immutable record.

### Solution (Java)

```java
public final class CounterFSM {
    public sealed interface State permits Idle, Active, Done {}
    public record Idle() implements State {}
    public record Active(int count) implements State {}
    public record Done() implements State {}

    private final AtomicReference<State> state = new AtomicReference<>(new Idle());

    public boolean start() {
        return state.compareAndSet(new Idle(), new Active(0));
    }

    public void tick() {
        state.updateAndGet(s -> s instanceof Active a ? new Active(a.count() + 1) : s);
    }

    public boolean finish() {
        State current = state.get();
        return current instanceof Active && state.compareAndSet(current, new Done());
    }

    public State current() { return state.get(); }
}
```

CAS for atomic transitions. Lock-free; safe for concurrent access.

---

## How to Practice

- **Build the traffic light first.** Three states, one transition method — perfect intro.
- **Order lifecycle next.** Real-world; non-trivial; covers invalid transitions.
- **Try sealed interfaces.** Compile-time exhaustiveness is addictive.
- **Implement transition tables.** Compare ergonomics with object dispatch.
- **Persist a state.** Round-trip through DB; observe optimistic locking conflicts.
- **Read XState examples.** Statecharts in production-grade form.
- **Read Erlang gen_statem.** State machines as language primitives.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
