# Fragile Base Class Problem — Practice Tasks

Eight exercises that force FBCP into focus. Each is a refactor that compiles cleanly under inheritance but breaks the moment the parent evolves, the framework upgrades, or `equals` semantics start to matter. Work each in three passes: (1) name which FBCP form is in play, (2) sketch the safe shape (composition, `final`, sealed) on paper, (3) write code and a test that catches the original failure.

---

## Task 1 — Replace the deep inheritance chain

```java
abstract class BaseProcessor {
    public final void process() { before(); doWork(); after(); }
    protected void before() {}
    protected void after()  {}
    protected abstract void doWork();
}
abstract class AbstractDomainProcessor extends BaseProcessor {
    @Override protected void before() { super.before(); acquireLock(); }
    @Override protected void after()  { releaseLock(); super.after(); }
}
abstract class AbstractCommandProcessor extends AbstractDomainProcessor {
    @Override protected void before() { super.before(); startTimer(); }
}
public class OrderProcessor extends AbstractCommandProcessor {
    @Override protected void doWork() { /* place order */ }
}
```

**Objective.** Flatten the 4-level chain. Each former subclass becomes a `final` class composing focused collaborators.

**Constraints.**
- `OrderProcessor` is `final` and has no `extends` clause.
- The cross-cutting responsibilities (lock, timer, audit) become `final` collaborator classes injected via constructor.
- The workflow lives in one method on `OrderProcessor`, readable top-to-bottom.

**Acceptance criteria.**
- `extends` keyword does not appear in the refactored code (except where framework requires).
- A bug fix in `acquireLock` doesn't recompile `OrderProcessor` — only the `LockAcquisition` class.
- A test exercises `OrderProcessor` with stub collaborators in <10 lines.
- Adding a new processor (`RefundProcessor`) is one new `final` class, no parent edits.

---

## Task 2 — Fix the FBCP via self-use change

```java
public class Account {
    public void deposit(BigDecimal amount) {
        balance = balance.add(amount);
        notifyChange();                   // self-use of overridable method
    }
    protected void notifyChange() { /* default no-op */ }
}

public class AuditedAccount extends Account {
    @Override protected void notifyChange() {
        super.notifyChange();
        audit.record("change");
    }
}
```

The Account team wants to refactor `deposit` to publish a `BalanceChanged` event instead of calling `notifyChange`.

**Objective.** Make the refactor safe for `AuditedAccount`.

**Constraints.**
- `AuditedAccount` should not be silently broken by the parent's refactor.
- The audit step should still fire when balance changes.
- The transition uses a deprecation cycle: `notifyChange` is `@Deprecated(since="5.0", forRemoval=true)` in v5, removed in v6.
- `AuditedAccount` migrates to subscribing to a `BalanceChanged` event.

**Acceptance criteria.**
- `AuditedAccount` compiles in v5 with deprecation warnings.
- The event-based replacement (`AuditingSubscriber`) is wired in the composition root.
- In v6, `notifyChange` is removed; `AuditedAccount` no longer extends `Account`.
- An integration test verifies the audit fires on `account.deposit(...)`.

---

## Task 3 — Stop the constructor virtual call

```java
public class HealthCheckedService {
    public HealthCheckedService() {
        registerHealthCheck();           // virtual call in constructor
    }
    protected void registerHealthCheck() { /* default */ }
}

public class PaymentService extends HealthCheckedService {
    private final URL endpoint;
    public PaymentService(URL endpoint) {
        super();                          // PaymentService.registerHealthCheck runs here
        this.endpoint = endpoint;
    }
    @Override protected void registerHealthCheck() {
        HealthRegistry.register(() -> ping(endpoint));   // endpoint is null!
    }
}
```

**Objective.** Eliminate the NPE while keeping the registration behavior.

**Constraints.**
- No virtual calls in any constructor.
- Construction is two-phase: assign fields, then register externally.
- A static factory method (`PaymentService.create(...)`) is the only public entry point; the constructor is `private`.

**Acceptance criteria.**
- `PaymentService.create(endpoint)` registers the health check correctly with `endpoint` already assigned.
- A test that calls `create(...)` and then `HealthRegistry.list()` finds the registered check.
- Calling `new PaymentService(...)` directly no longer compiles (private constructor).
- The `extends HealthCheckedService` is removed; `PaymentService` is `final`.

---

## Task 4 — Convert to a sealed family

```java
public abstract class Shape {
    public abstract double area();
}
public class Circle extends Shape { double r; public double area() { return Math.PI * r * r; } }
public class Square extends Shape { double s; public double area() { return s * s; } }
public class Triangle extends Shape { double b, h; public double area() { return 0.5 * b * h; } }
```

Multiple `instanceof` checks scattered through the codebase do work specific to each shape.

**Objective.** Promote to a sealed family with exhaustive pattern matching.

**Constraints.**
- `Shape` becomes `sealed interface Shape permits Circle, Square, Triangle`.
- Each variant is a `record` (or `final class`).
- All `instanceof` cascades become exhaustive `switch` on `Shape`.
- The compiler refuses to build if a `case` is missing.

**Acceptance criteria.**
- Adding a new shape (`Pentagon`) requires updating `permits` plus every `switch`.
- A test confirms a missing `case` is a compile error.
- The `Shape` class has no methods; the variants own their `area()` (or the switch does).
- `Shape s = ...; double a = switch (s) { case Circle c -> ...; ... };` compiles and works.

---

## Task 5 — Replace `Cloneable` with copy constructor

```java
public class Order implements Cloneable {
    private List<LineItem> items;
    private Customer customer;
    @Override public Order clone() throws CloneNotSupportedException {
        Order o = (Order) super.clone();
        o.items = new ArrayList<>(this.items);       // partial deep copy
        // customer is shared — defensive copy?
        return o;
    }
}
```

`Cloneable` is FBCP-prone (every subclass needs the protocol right) and has shallow-copy hazards.

**Objective.** Replace with a `copy` static factory or constructor.

**Constraints.**
- `Order` becomes `final` and no longer implements `Cloneable`.
- A `static Order copy(Order other)` (or `Order(Order other)` copy constructor) provides the copy.
- Defensive copies of mutable fields are explicit.
- Subclasses are disallowed (`final`).

**Acceptance criteria.**
- `Order.copy(o)` returns a new instance with copied fields.
- Modifying the copy's items doesn't affect the original.
- `o.clone()` doesn't compile (`Cloneable` removed).
- A test verifies isolation: mutating copy's items, customer's address, etc., doesn't affect the original.

---

## Task 6 — Fix `equals` symmetry across inheritance

```java
public class Point {
    int x, y;
    @Override public boolean equals(Object o) {
        if (!(o instanceof Point)) return false;
        Point p = (Point) o;
        return x == p.x && y == p.y;
    }
}

public class ColoredPoint extends Point {
    Color color;
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColoredPoint)) return false;
        ColoredPoint cp = (ColoredPoint) o;
        return super.equals(cp) && color.equals(cp.color);
    }
}
```

**Objective.** Restore equality symmetry.

**Constraints.**
- `ColoredPoint` is *not* a subclass of `Point` — composition instead.
- Both become `record`.
- Two `Point`s with same coordinates are equal; two `ColoredPoint`s with same point + colour are equal; a `Point` is never equal to a `ColoredPoint` (they're different types).

**Acceptance criteria.**
- A test verifies: `point.equals(coloredPoint)` is false (asymmetric problem is gone — neither is equal to the other).
- A `HashSet<Point>` containing point doesn't accidentally find a coloured point.
- Adding a `WeightedColoredPoint` (point + colour + weight) is a new record, not an extension.

---

## Task 7 — Add `japicmp` to CI

You maintain a library `acme-common` published to other teams. The build pipeline currently doesn't check for binary compatibility. Recent releases have caused downstream failures.

**Objective.** Add binary-compatibility checks to CI, enforce a deprecation cycle.

**Constraints.**
- `japicmp-maven-plugin` (or `revapi`) runs on every release build.
- The build fails if a binary-incompatible change ships without a major-version bump.
- The team policy: deprecate hooks for one minor version, remove in the next major.

**Acceptance criteria.**
- A PR that adds `final` to a previously-non-final method fails CI with a clear error message.
- A PR that deprecates a method, ships the deprecation, then removes the method in the next major version is accepted.
- A documentation file (`COMPATIBILITY.md`) explains the policy to consumers.

---

## Task 8 — Replace the framework subclass with composition

```java
@Service
public class OrderEventListener extends AbstractRabbitMqListener<OrderEvent> {
    @Override protected void process(OrderEvent event) {
        orderService.handle(event);
        auditLogger.log(event);
    }
    @Override protected void onError(Throwable t, OrderEvent event) {
        deadLetterQueue.send(event);
    }
}
```

The framework requires `extends AbstractRabbitMqListener`. The two overridden methods contain real business logic that you want to test without the framework.

**Objective.** Keep the framework's required `extends` minimal; move logic to a composed collaborator.

**Constraints.**
- The framework subclass (`OrderEventListener`) is the smallest possible adapter — ~10 lines.
- The business logic lives in `OrderEventHandler`, a `final` class with no framework dependency.
- A unit test for `OrderEventHandler` runs without spinning up a RabbitMQ container.

**Acceptance criteria.**
- The subclass's `process` is one line: `handler.handle(event)`.
- The subclass's `onError` is one line: `handler.handleError(t, event)`.
- A unit test instantiates `OrderEventHandler`, calls its methods directly, and verifies behaviour with mocks.
- A framework version upgrade affects only `OrderEventListener` (the adapter), not `OrderEventHandler`.

---

## Validation

| Task | How to verify the fix                                                              |
|------|------------------------------------------------------------------------------------|
| 1    | `extends` count in the refactored code is 0 (or only framework-mandated).         |
| 2    | `AuditedAccount` doesn't compile in v6; replacement subscribes to events.         |
| 3    | `new PaymentService(...)` doesn't compile (private constructor).                  |
| 4    | Removing a `case` from the sealed `switch` is a compile error.                    |
| 5    | `o.clone()` doesn't compile.                                                       |
| 6    | `point.equals(coloredPoint)` is false; `HashSet` semantics are consistent.        |
| 7    | A binary-incompatible PR fails CI.                                                 |
| 8    | Unit test for `OrderEventHandler` runs without RabbitMQ.                          |

---

## Worked solution sketch — Task 1 (flatten the chain)

```java
// Composed collaborators
public final class LockAcquisition {
    public void acquire() { /* ... */ }
    public void release() { /* ... */ }
}
public final class Timing {
    private long startNs;
    public void start() { startNs = System.nanoTime(); }
    public void stopAndReport(String op) { metrics.record(op, System.nanoTime() - startNs); }
}
public final class Audit {
    public void before(String op) { /* ... */ }
    public void after(String op)  { /* ... */ }
}

// Flat, final processor
public final class OrderProcessor {
    private final LockAcquisition lock;
    private final Timing timing;
    private final Audit audit;
    private final OrderRepository repo;

    public OrderProcessor(LockAcquisition lock, Timing timing, Audit audit, OrderRepository repo) {
        this.lock = lock; this.timing = timing; this.audit = audit; this.repo = repo;
    }

    public void process(Order order) {
        audit.before("order");
        lock.acquire();
        timing.start();
        try {
            repo.save(order);
        } finally {
            timing.stopAndReport("order");
            lock.release();
            audit.after("order");
        }
    }
}
```

Notice three things in the sketch:

1. The workflow lives in one method, readable top-to-bottom. The four collaborators' roles are explicit at the constructor.
2. Each collaborator is a `final` class with one purpose. A bug fix in `LockAcquisition.acquire` recompiles only `LockAcquisition` and its direct callers, not every former subclass.
3. Adding a `RefundProcessor` is a new `final` class — same shape, same collaborators, different `process` body. No inheritance, no FBCP.

---

**Memorize this:** FBCP doesn't show up as compile errors — it shows up as silent broken overrides, surprising NPEs in constructors, framework-mandated subclasses that explode on upgrade, `equals` asymmetry that breaks `HashSet` semantics. Each task above gives you that pain up front. After each refactor, the next plausible change touches *one* class, not every level of a hierarchy.
