# Composition Over Inheritance — Practice Tasks

Eight exercises that force the heuristic into real Java code. Each is a refactor that compiles under inheritance but bites the moment a second variant arrives or a wrapper is added. Work each in three passes: (1) name the smell (`extends` for reuse, fragile base, leaked API, broken substitutability), (2) sketch the new shape on paper, (3) write code and a test that catches the original failure mode.

---

## Task 1 — Flatten the `Vehicle` tree

```java
abstract class Vehicle {
    abstract void start();
    abstract void stop();
}
abstract class LandVehicle extends Vehicle {
    int wheels;
}
abstract class Car extends LandVehicle {
    int doors;
}
class GasolineCar extends Car { /* petrol */ }
class DieselCar   extends Car { /* diesel */ }
class ElectricCar extends Car { /* battery */ }
class HybridCar   extends Car { /* gas + electric, somehow */ }
```

**Objective.** Replace the four-level hierarchy with a `final` class `Car` that composes its variable parts (engine, drivetrain).

**Constraints.**
- `Car` becomes a single `final` class with `final` fields.
- The variation axis (engine) becomes an interface with three or four implementations, including `HybridEngine` that *composes* two engines.
- A new engine type (say, `HydrogenEngine`) is one new file, no edit to `Car`.

**Acceptance criteria.**
- `new Car(new HybridEngine(new GasolineEngine(), new ElectricEngine()), 4)` works.
- A unit test substitutes a `FakeEngine` and verifies `Car.start()` calls `engine.start()` exactly once.
- The string `extends` does not appear in the refactored file except on records implementing the engine interface.
- Adding a hybrid plug-in scenario doesn't require any new class — `new HybridEngine(...)` covers it.

---

## Task 2 — Replace the `BaseService` reuse

```java
abstract class BaseService {
    protected final Logger log = LoggerFactory.getLogger(getClass());
    protected void audit(String action, String entity) {
        log.info("[AUDIT] action={} entity={}", action, entity);
    }
    protected void emit(DomainEvent e) { EventBus.global().publish(e); }
}

class CheckoutService extends BaseService {
    public void checkout(Cart c) { audit("checkout", c.id()); emit(new Checkout(c.id())); }
}
class RefundService extends BaseService {
    public void refund(Order o)  { audit("refund", o.id());  emit(new Refund(o.id()));   }
}
class CancelService extends BaseService {
    public void cancel(Order o)  { audit("cancel", o.id());  emit(new Cancel(o.id()));   }
}
```

**Objective.** Replace inheritance-for-reuse with composition. No service should extend any base class.

**Constraints.**
- The two reused behaviours (`audit`, `emit`) become a single `final class ServiceTelemetry` injected via constructor.
- Static singletons (`LoggerFactory.getLogger(getClass())`, `EventBus.global()`) become injected collaborators.
- Each service class is `final` and has no `extends` clause.

**Acceptance criteria.**
- No `BaseService` in the codebase after the refactor.
- A test for `CheckoutService` substitutes a fake `ServiceTelemetry` and asserts both `audit("checkout", …)` and `emit(new Checkout(…))` are called.
- Adding a new service (`PromotionService`) requires no new base class — it just takes a `ServiceTelemetry` in its constructor.
- Searching for `getClass()` in service files returns no hits.

---

## Task 3 — Stop extending `ArrayList`

```java
public class TaskQueue<T> extends ArrayList<T> {
    private final long createdAt = System.currentTimeMillis();
    public void enqueue(T t) { add(t); }
    public T dequeue()       { return remove(0); }
    public long ageMs()      { return System.currentTimeMillis() - createdAt; }
}
```

**Objective.** A `TaskQueue<T>` is not a `List<T>`. Callers should not be able to `add(0, t)`, `remove(i)`, `subList(...)`, etc.

**Constraints.**
- `TaskQueue` becomes `final` and *does not* implement `List<T>`.
- It holds an `ArrayList<T>` (or `ArrayDeque<T>`, your choice) as a `private final` field.
- It exposes only `enqueue`, `dequeue`, `size`, `isEmpty`, `ageMs`.

**Acceptance criteria.**
- The line `taskQueue.add(0, t)` no longer compiles.
- `taskQueue.dequeue()` returns elements in enqueue order.
- A test exercises FIFO behaviour and confirms `size()` shrinks as expected.
- Replacing the backing storage from `ArrayList` to `ArrayDeque` requires zero edits to any caller — only `TaskQueue` itself.

---

## Task 4 — Compose a decorator chain (cross-cutting on `Repository`)

```java
public interface OrderRepository {
    Order load(OrderId id);
    void save(Order o);
}

public class JdbcOrderRepository implements OrderRepository { /* ... */ }
```

You need to add three cross-cutting concerns: structured logging, timing metrics, and retry on transient failures. The team's first attempt:

```java
public class LoggingOrderRepository extends JdbcOrderRepository { /* ... */ }    // wrong: extends concrete
public class TimingOrderRepository  extends LoggingOrderRepository { /* ... */ } // wrong: chains via extension
```

**Objective.** Build the three concerns as composable wrappers that work for *any* `OrderRepository`, not just `JdbcOrderRepository`.

**Constraints.**
- Each wrapper is a `final class` implementing `OrderRepository`, holding `private final OrderRepository delegate`.
- No wrapper extends another wrapper or the JDBC class.
- The chain is wired in a single `CompositionRoot` method.
- Order matters: retry must be *innermost*, so failed attempts are timed and logged for each retry.

**Acceptance criteria.**
- `new LoggingRepository(new TimingRepository(new RetryingRepository(new JdbcOrderRepository(...))))` is the chain produced by the composition root.
- A test substitutes an `InMemoryOrderRepository` and confirms `load()` still works through all four layers.
- The `LoggingRepository` can wrap an `InMemoryOrderRepository` directly — proof that the wrapper composes with anything implementing the interface.
- Removing the `RetryingRepository` from the chain doesn't break any other wrapper.

---

## Task 5 — `Customer` is not an `Account`

A junior wrote:

```java
public class Account {
    private String id;
    private BigDecimal balance;
    /* getters, setters */
}

public class Customer extends Account {
    private String name;
    private String email;
    /* getters, setters */
}
```

The reasoning: "a customer has an account, so customer is an account". The runtime symptom: `Customer.getId()` returns the *account* id, not a customer id. Every place that used `getId()` mixed the two meanings.

**Objective.** Re-model as composition: a `Customer` *has* an `Account` (or even *has many*), and each has its own identity.

**Constraints.**
- `Customer` and `Account` become two unrelated `final` classes.
- `Customer` holds an `Account` (or `List<Account>`) as a field.
- Each has its own `id` of a distinct type (`CustomerId`, `AccountId`) — no string overlap.

**Acceptance criteria.**
- `customer.getId()` returns a `CustomerId`; `customer.account().getId()` returns an `AccountId`. The two types are not assignable.
- A test enforces that you can't pass a `CustomerId` to a method expecting `AccountId` at compile time.
- Searching the codebase for `extends Account` returns zero hits in production code.
- Adding a second account per customer (joint accounts) requires no schema change to `Customer` — just changing the field type to `List<Account>`.

---

## Task 6 — Replace `getClass()` equality with composition

```java
public class Point {
    private final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Point p = (Point) o;
        return x == p.x && y == p.y;
    }
}

public class ColoredPoint extends Point {
    private final Color color;
    public ColoredPoint(int x, int y, Color c) { super(x, y); color = c; }
    public boolean equals(Object o) {
        if (!super.equals(o)) return false;
        if (!(o instanceof ColoredPoint cp)) return false;
        return color.equals(cp.color);
    }
}
```

**Symptom.** `new Point(1,2).equals(new ColoredPoint(1,2,RED))` is `false` (different `getClass()`). The two types share a parent but cannot be substituted in a `HashSet<Point>`.

**Objective.** Re-model so that "a coloured point is not a kind of point; it has a point and a colour". Composition replaces the broken inheritance.

**Constraints.**
- `Point` becomes a `record`.
- `ColoredPoint` becomes a `record` holding a `Point` and a `Color`.
- Neither extends the other.

**Acceptance criteria.**
- `Point.equals` is correct by value.
- `ColoredPoint.equals` is correct by value (both fields).
- `coloredPoint.point().equals(plainPoint)` works as expected — *one* axis of equality is preserved without the inheritance trap.
- A test puts a `Point` and a `ColoredPoint(samePoint, RED)` into separate sets and confirms they don't accidentally collide.

---

## Task 7 — Plug a Strategy into `PricingEngine`

```java
public class PricingEngine {
    public BigDecimal price(Order order, String type) {
        return switch (type) {
            case "STANDARD" -> order.subtotal().multiply(new BigDecimal("1.10"));
            case "PROMO"    -> order.subtotal().multiply(new BigDecimal("0.85"));
            case "VIP"      -> order.subtotal().multiply(new BigDecimal("0.70"));
            default         -> throw new IllegalArgumentException(type);
        };
    }
}
```

A teammate proposes:

```java
abstract class PricingEngine {
    public abstract BigDecimal price(Order o);
}
class StandardPricingEngine extends PricingEngine { /* ... */ }
class PromoPricingEngine    extends PricingEngine { /* ... */ }
class VipPricingEngine      extends PricingEngine { /* ... */ }
```

**Objective.** This is closer, but still inheritance-for-strategy. Refactor into composition: `PricingEngine` *has* a `PricingStrategy`.

**Constraints.**
- `PricingStrategy` is an interface with one method, `BigDecimal apply(Order o)`.
- `PricingEngine` is a `final` class with a `PricingStrategy` field.
- Three strategies (`Standard`, `Promo`, `Vip`) implement the interface; each is `final`.
- The engine can switch strategies *at runtime* by being reconstructed (or, if you must, by injection of a new engine instance).

**Acceptance criteria.**
- Adding a "BLACK_FRIDAY" strategy is one new class, zero edits to `PricingEngine`.
- A test passes a fake `PricingStrategy` that returns a sentinel and verifies the engine returns the sentinel.
- The class diagram has one `PricingEngine`, three `PricingStrategy` implementations, and zero `extends` between any two.
- Strategies can be composed: `new ChainedStrategy(promo, vip)` applies both discounts in sequence.

---

## Task 8 — Untangle the framework-mandated `extends`

```java
@WebServlet("/checkout")
public class CheckoutServlet extends HttpServlet {
    private DataSource ds = new HikariDataSource(/* prod URL */);
    private OkHttpClient http = new OkHttpClient();

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        // 60 lines: parse body, validate, charge payment, write to DB, render JSON
    }
}
```

**Symptom.** Tests can't run without a Servlet container, the prod DB URL is baked in, retry/timing logic is buried inside one method, and the servlet "is" the application.

**Objective.** The `extends HttpServlet` cannot be removed — the framework demands it. Move *everything else* to composition so the servlet is a thin adapter.

**Constraints.**
- `CheckoutServlet` becomes the smallest possible adapter: parses input, calls one collaborator, writes output. ~10 lines.
- The collaborator (`CheckoutFlow`) is a `final` class composed from `OrderRepository`, `PaymentGateway`, `Validator`. No `extends` anywhere in its tree.
- Tests exercise `CheckoutFlow` directly with in-memory fakes — no Servlet container needed.
- The servlet builds the flow once in `init()`, holds it in a `final` field, and reuses it across requests.

**Acceptance criteria.**
- A unit test for `CheckoutFlow` runs in milliseconds without any HTTP, JDBC, or HTTP-client classes on the test classpath.
- The servlet class is under 20 lines (excluding annotations and imports).
- The servlet's `doPost` does no business logic — it only marshals between HTTP and the domain.
- Swapping `HttpServlet` for Spring's `@RestController` later is purely a different adapter; `CheckoutFlow` is unchanged.

---

## Validation

| Task | How to verify the fix                                                              |
|------|------------------------------------------------------------------------------------|
| 1    | `new Car(engine, 4)` works for every engine variant; `extends` count in the file is 0. |
| 2    | `BaseService` does not appear in the codebase; service tests use a fake `ServiceTelemetry`. |
| 3    | `taskQueue.add(0, x)` does not compile.                                            |
| 4    | The composition root assembles four layers in one method, all tests pass.          |
| 5    | `CustomerId` and `AccountId` are not interchangeable at compile time.              |
| 6    | `Point` and `ColoredPoint` are independent records; equality is exactly the components. |
| 7    | Adding a "Black Friday" strategy requires one new file.                            |
| 8    | `CheckoutFlow` test runs without `javax.servlet.*` on the classpath.               |

---

## Worked solution sketch — Task 4 (Repository decorator chain)

```java
public interface OrderRepository {
    Order load(OrderId id);
    void  save(Order o);
}

public final class JdbcOrderRepository implements OrderRepository {
    private final DataSource ds;
    public JdbcOrderRepository(DataSource ds) { this.ds = ds; }
    public Order load(OrderId id) { /* JDBC */ return null; }
    public void  save(Order o)    { /* JDBC */ }
}

public final class RetryingRepository implements OrderRepository {
    private final OrderRepository delegate;
    private final int maxAttempts;
    public RetryingRepository(OrderRepository d, int n) { delegate = d; maxAttempts = n; }
    public Order load(OrderId id) { return run(() -> delegate.load(id)); }
    public void  save(Order o)    { run(() -> { delegate.save(o); return null; }); }
    private <T> T run(Supplier<T> work) {
        RuntimeException last = null;
        for (int i = 0; i < maxAttempts; i++) {
            try { return work.get(); } catch (TransientException e) { last = e; }
        }
        throw last;
    }
}

public final class TimingRepository implements OrderRepository {
    private final OrderRepository delegate;
    private final MetricsRegistry metrics;
    public TimingRepository(OrderRepository d, MetricsRegistry m) { delegate = d; metrics = m; }
    public Order load(OrderId id) { return timed("load",  () -> delegate.load(id)); }
    public void  save(Order o)    { timed("save",  () -> { delegate.save(o); return null; }); }
    private <T> T timed(String op, Supplier<T> work) {
        long t = System.nanoTime();
        try { return work.get(); }
        finally { metrics.recordNanos("repo." + op, System.nanoTime() - t); }
    }
}

public final class LoggingRepository implements OrderRepository {
    private final OrderRepository delegate;
    private final Logger log;
    public LoggingRepository(OrderRepository d, Logger l) { delegate = d; log = l; }
    public Order load(OrderId id) { log.info("load {}", id); return delegate.load(id); }
    public void  save(Order o)    { log.info("save {}", o.id()); delegate.save(o); }
}

// Composition root
public final class CompositionRoot {
    public static OrderRepository buildRepository(DataSource ds, MetricsRegistry m, Logger l) {
        return new LoggingRepository(
                   new TimingRepository(
                       new RetryingRepository(
                           new JdbcOrderRepository(ds), 3),
                       m),
                   l);
    }
}
```

Notice four things in the sketch:
1. Each wrapper is `final` and implements `OrderRepository` by holding a `final` delegate.
2. Wrappers compose with *any* `OrderRepository` — including `InMemoryOrderRepository` for tests.
3. The retry layer is the innermost: each retry attempt is timed and logged independently. A reordering would change semantics.
4. The composition root is the *only* place that knows the layer order. Changing it is a one-method edit, reviewed in isolation.

---

**Memorize this:** inheritance problems don't show up as compiler errors — they show up the second time someone needs to add a wrapper, swap an implementation, or test a class without spinning up a database. Each task above gives you that "second time" up front. If, after the refactor, the next plausible change touches *one* class instead of every level of a hierarchy, you have applied the heuristic correctly.
