# State — Optimize

> **Source:** [refactoring.guru/design-patterns/state](https://refactoring.guru/design-patterns/state)

Each section presents a State pattern that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Singleton stateless states](#optimization-1-singleton-stateless-states)
2. [Optimization 2: Enum-based FSM for tight loops](#optimization-2-enum-based-fsm-for-tight-loops)
3. [Optimization 3: Sealed types for compile-time exhaustiveness](#optimization-3-sealed-types-for-compile-time-exhaustiveness)
4. [Optimization 4: CAS-based atomic transitions](#optimization-4-cas-based-atomic-transitions)
5. [Optimization 5: Hierarchical states for shared behavior](#optimization-5-hierarchical-states-for-shared-behavior)
6. [Optimization 6: Optimistic locking instead of transactions](#optimization-6-optimistic-locking-instead-of-transactions)
7. [Optimization 7: Type-specialized branches for monomorphic dispatch](#optimization-7-type-specialized-branches-for-monomorphic-dispatch)
8. [Optimization 8: Bounded transition history](#optimization-8-bounded-transition-history)
9. [Optimization 9: Drop State for trivial 2-state machine](#optimization-9-drop-state-for-trivial-2-state-machine)
10. [Optimization 10: Workflow engine for long-running FSMs](#optimization-10-workflow-engine-for-long-running-fsms)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Singleton stateless states

### Before

```java
public void tick() {
    state = state.next();   // each next() returns new state instance
}

class Red implements Light {
    public Light next() { return new Green(); }   // allocation per transition
}
```

For a high-frequency FSM (e.g., game character animation at 60 fps), allocations stack up.

### After

```java
class Red implements Light {
    public static final Red INSTANCE = new Red();
    public Light next() { return Green.INSTANCE; }
}

class Green implements Light {
    public static final Green INSTANCE = new Green();
    public Light next() { return Yellow.INSTANCE; }
}
```

Or use Java enum:

```java
public enum Light {
    RED { public Light next() { return GREEN; } },
    GREEN { public Light next() { return YELLOW; } },
    YELLOW { public Light next() { return RED; } };

    public abstract Light next();
}
```

**Measurement.** Allocation rate drops to zero. GC pressure removed. ~ns saved per transition.

**Lesson:** Stateless states should be singletons. Allocation per transition is wasteful.

---

## Optimization 2: Enum-based FSM for tight loops

### Before

```java
public sealed interface State permits Idle, Active, Done {}
// Multi-class hierarchy; vtable dispatch.

state.handle(this);   // polymorphic; megamorphic if many states
```

For 10+ states in a tight inner loop, vtable cost is visible.

### After

```java
public enum State {
    IDLE, ACTIVE, DONE;
}

State current = State.IDLE;

void handle() {
    switch (current) {
        case IDLE -> startActivity();
        case ACTIVE -> tick();
        case DONE -> noop();
    }
}
```

**Measurement.** Switch on enum compiles to jump table. Each branch monomorphic; JIT inlines. ~2-3ns saved vs vtable dispatch.

**Trade-off.** Logic in switch statements, not in state classes. Less object-oriented; more procedural.

**Lesson:** For performance-critical inner loops with stable state set, enum + switch beats class hierarchy.

---

## Optimization 3: Sealed types for compile-time exhaustiveness

### Before

```java
public interface State {}
public class Draft implements State {}
public class Published implements State {}

// Switch:
if (state instanceof Draft) ...
else if (state instanceof Published) ...
// missing case: silently does nothing
```

Adding a new state doesn't force code updates.

### After (Java 17+)

```java
public sealed interface State permits Draft, Moderation, Published {}

// Compile-time exhaustive:
String name = switch (state) {
    case Draft d -> "draft";
    case Moderation m -> "moderation";
    case Published p -> "published";
};
```

Adding a new state to `permits` forces compile errors at all dispatch sites.

**Measurement.** Bugs caught at compile time, not runtime. Refactoring safe.

**Lesson:** Sealed types make State pattern type-safe and refactor-friendly. Use when language supports.

---

## Optimization 4: CAS-based atomic transitions

### Before

```java
public synchronized void pay() {
    if (state instanceof Cart) state = new Paid();
}
```

Lock per transition. Under contention, throughput collapses.

### After

```java
private final AtomicReference<State> state = new AtomicReference<>(new Cart());

public boolean pay() {
    State current = state.get();
    if (!(current instanceof Cart)) return false;
    return state.compareAndSet(current, new Paid());
}
```

Lock-free. Failed CAS = concurrent transition; caller retries with current state.

**Measurement.** Throughput scales with cores; no lock contention.

**Lesson:** Lock-free transitions via CAS. Suitable for hot in-memory FSMs.

---

## Optimization 5: Hierarchical states for shared behavior

### Before (flat)

```java
class Playing implements State {
    public void powerOff(Player p) { p.setState(new Off()); }
    public void play(Player p) { /* already playing */ }
    public void pause(Player p) { p.setState(new Paused()); }
}

class Paused implements State {
    public void powerOff(Player p) { p.setState(new Off()); }   // duplicated
    public void play(Player p) { p.setState(new Playing()); }
    public void pause(Player p) { /* already paused */ }
}

class Standby implements State {
    public void powerOff(Player p) { p.setState(new Off()); }   // duplicated
    public void play(Player p) { p.setState(new Playing()); }
    public void pause(Player p) { /* nothing */ }
}
```

`powerOff` duplicated everywhere.

### After (hierarchical)

```java
public abstract class On implements State {
    public void powerOff(Player p) { p.setState(new Off()); }   // shared
}

public class Playing extends On {
    public void pause(Player p) { p.setState(new Paused()); }
}

public class Paused extends On {
    public void play(Player p) { p.setState(new Playing()); }
}

public class Standby extends On {
    public void play(Player p) { p.setState(new Playing()); }
}

public class Off implements State {}
```

**Measurement.** Duplication eliminated. Adding a "powerOff" rule = one class.

**Lesson:** Hierarchical states extract shared behavior. Sealed types support this naturally.

---

## Optimization 6: Optimistic locking instead of transactions

### Before

```java
@Transactional
public void pay(String id) {
    Order o = repo.findById(id);
    if (!"cart".equals(o.status())) throw new IllegalStateException();
    o.setStatus("paid");
    repo.save(o);
}
```

Long transaction holds locks; concurrent calls block.

### After

```java
public void pay(String id) {
    int rows = jdbc.update(
        "UPDATE orders SET status = 'paid', version = version + 1 " +
        "WHERE id = ? AND status = 'cart'",
        id
    );
    if (rows == 0) throw new ConcurrentModificationException();
}
```

Single atomic UPDATE. No transaction needed. Concurrent attempts fail; caller retries.

**Measurement.** Throughput rises sharply under contention. Lock-free at the DB level.

**Lesson:** For state transitions, optimistic locking via WHERE clause is cheaper than full transactions.

---

## Optimization 7: Type-specialized branches for monomorphic dispatch

### Before (megamorphic)

```java
for (Order o : orders) {
    o.state.process(o);   // 10+ state types at this site → vtable
}
```

JIT can't inline; ~2-3ns per call.

### After (group by state type)

```java
Map<Class<?>, List<Order>> grouped = orders.stream()
    .collect(Collectors.groupingBy(o -> o.state.getClass()));

for (var entry : grouped.entrySet()) {
    State stateInstance = ...;   // representative
    for (Order o : entry.getValue()) stateInstance.process(o);
    // Inner loop is monomorphic; JIT inlines
}
```

**Measurement.** Per-call cost drops from ~3ns (vtable) to ~0ns (inlined).

**Trade-off.** Outer loop adds overhead. Worth it for very large batches.

**Lesson:** Splitting megamorphic call sites into monomorphic ones unlocks JIT inlining.

---

## Optimization 8: Bounded transition history

### Before

```java
private final List<State> history = new ArrayList<>();   // unbounded

public void transition(State next) {
    history.add(state);
    state = next;
}
```

Long sessions accumulate history; OOM.

### After

```java
private final Deque<State> history = new ArrayDeque<>();
private static final int MAX_HISTORY = 100;

public void transition(State next) {
    history.push(state);
    while (history.size() > MAX_HISTORY) history.removeLast();
    state = next;
}
```

**Measurement.** Memory bounded. Old history dropped.

**Lesson:** State histories must be bounded. Always.

---

## Optimization 9: Drop State for trivial 2-state machine

### Before

```java
public sealed interface ToggleState permits On, Off {
    void toggle(Toggle t);
}

public final class On implements ToggleState {
    public void toggle(Toggle t) { t.setState(new Off()); }
}

public final class Off implements ToggleState {
    public void toggle(Toggle t) { t.setState(new On()); }
}

public final class Toggle {
    private ToggleState state = new Off();
    public void setState(ToggleState s) { this.state = s; }
    public void toggle() { state.toggle(this); }
}
```

Lots of code for a binary flag.

### After

```java
public final class Toggle {
    private boolean on = false;
    public void toggle() { on = !on; }
    public boolean isOn() { return on; }
}
```

**Measurement.** Less code. Less indirection. Easier to read.

**Lesson:** State pattern earns its weight at 3+ states with non-trivial logic. Two states with trivial transition = boolean.

---

## Optimization 10: Workflow engine for long-running FSMs

### Before

```java
@Scheduled(cron = "0 0 * * *")
public void checkExpired() {
    List<Order> expiring = repo.findExpiring();
    for (Order o : expiring) {
        if (o.status().equals("pending") && o.createdAt().isBefore(yesterday())) {
            o.setStatus("expired");
            repo.save(o);
        }
    }
}
```

Custom code for FSM transitions over time. Brittle; hand-rolled retries; no audit.

### After (Temporal)

```java
@Workflow.defn
public class OrderWorkflow {
    @WorkflowMethod
    public void run(Order order) {
        try {
            Workflow.await(Duration.ofDays(1), order::isPaid);
        } catch (TimeoutException e) {
            workflow.execute_activity(MarkExpired.class, order.id());
        }
    }
}
```

Temporal handles persistence, timeouts, retries, observability.

**Measurement.** Code drops dramatically. Reliability improves; tooling provided.

**Trade-off.** Operational complexity (running Temporal cluster).

**Lesson:** Long-running FSMs benefit from workflow engines. Don't reinvent persistence + retries.

---

## Optimization Tips

- **Singleton stateless states.** Zero allocation per transition.
- **Enum-based FSM for tight loops.** Compiles to jump table.
- **Sealed types for exhaustiveness.** Refactor-safe; compile-time bug catching.
- **CAS for lock-free transitions.** Suitable for in-memory hot FSMs.
- **Hierarchical states for shared behavior.** Reduces duplication.
- **Optimistic locking for DB-backed FSMs.** Beats transactions under contention.
- **Type-specialized batches** for megamorphic call sites.
- **Bound histories.** Always.
- **Drop State pattern when overkill.** 2 states = boolean.
- **Workflow engines for long-running FSMs.** Outsource durability.
- **Profile before optimizing.** State dispatch is rarely the bottleneck.

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
