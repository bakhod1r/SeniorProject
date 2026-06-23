# DRY, KISS, YAGNI — Practice Tasks

Eight exercises that force the three slogans into real Java code. Each is a refactor that compiles cleanly under speculation but bites the moment requirements change or the team grows. Work each in three passes: (1) name which rule was violated and how, (2) sketch the lean version on paper, (3) write code and a test that catches the original failure.

---

## Task 1 — Strip the YAGNI plugin registry

```java
public class OrderHandler {
    private final Map<String, OrderHook> hooks = new ConcurrentHashMap<>();
    public void registerHook(String name, OrderHook hook) { hooks.put(name, hook); }

    public void handle(Order order) {
        hooks.values().forEach(h -> h.fire(order));
        save(order);
    }
}

// Production wiring:
handler.registerHook("audit", new AuditHook());
// No other hook anywhere.
```

**Objective.** Eliminate the speculation. One hook means no hook system.

**Constraints.**
- `OrderHandler` accepts the `AuditHook` via constructor.
- The `register` method is gone.
- A test for `OrderHandler` mocks one collaborator and verifies `audit.fire(order)` is called.
- When a second hook arrives, refactor to a list (or strategy), informed by the second hook's needs.

**Acceptance criteria.**
- `OrderHandler.java` has no `Map`, no `register*` method, no `forEach` over hooks.
- A missing-wiring bug becomes a compile-time error (constructor refuses `null` via `Objects.requireNonNull`).
- Searching for `OrderHandler.*register` returns zero hits.

---

## Task 2 — Un-extract the wrong abstraction

You inherited a system where someone DRY'd two email validation rules into one helper:

```java
public final class EmailValidators {
    public static boolean isValid(String email) {
        return email != null && email.matches("^[^@+]+(\\+[^@]+)?@[^@]+\\..+$");
    }
}

public class OrderValidator {
    public void validate(Order o) {
        if (!EmailValidators.isValid(o.email())) throw new InvalidEmailException();
    }
}

public class CustomerValidator {
    public void validate(Customer c) {
        if (!EmailValidators.isValid(c.email())) throw new InvalidEmailException();
    }
}
```

Marketing says: "customers should not accept `+` aliases; orders should." Currently the helper accepts `+`, so customer signup is too permissive.

**Objective.** Recognize that the shared helper was the wrong abstraction. Un-extract.

**Constraints.**
- Each validator owns its rule.
- `EmailValidators.java` is deleted (or left only as forwarding code during migration).
- A test for each validator confirms its specific rule.

**Acceptance criteria.**
- `OrderValidator` accepts `orders+xyz@example.com`.
- `CustomerValidator` rejects `customers+xyz@example.com`.
- The two rules can diverge independently in future without merge conflicts in a shared helper.

---

## Task 3 — Replace the god config

```java
public class AppConfig {
    public int dbPoolSize = 10;
    public int dbTimeoutMs = 5000;
    public String dbUrl = "jdbc:postgres://...";
    public int smtpPort = 587;
    public String smtpHost = "mail.acme.com";
    public boolean smtpTls = true;
    public int kafkaMaxBatch = 1000;
    public String kafkaBootstrap = "kafka:9092";
    public int httpThreads = 50;
    public boolean enableTracing = true;
    // ...60 more fields
}
```

Every class depends on `AppConfig` to read three fields out of seventy.

**Objective.** Split the god config into focused records.

**Constraints.**
- One record per concern (`DbConfig`, `SmtpConfig`, `KafkaConfig`, `HttpConfig`, `TracingConfig`).
- Each record is immutable, named after its purpose.
- Consumers depend on only the records they need.
- A composition root assembles the records from a single source (yml file, env vars).

**Acceptance criteria.**
- `DbConnector` no longer imports `AppConfig`; it imports `DbConfig`.
- Tests for `DbConnector` construct a `DbConfig` in 3 lines, not 70.
- Changing the SMTP port in production code doesn't trigger recompilation of database tests.

---

## Task 4 — KISS the configurable loader

```java
public final class ConfigLoader {
    public Config load(String source, Format format, Charset charset,
                       boolean validate, boolean cache, Class<?> target) {
        // 200 lines of branching
    }
}

// All real callers:
Config c1 = loader.load("orders.yaml", Format.YAML, UTF_8, true, true, OrdersConfig.class);
Config c2 = loader.load("payments.yaml", Format.YAML, UTF_8, true, true, PaymentsConfig.class);
```

Every caller passes the same shape.

**Objective.** Replace the configurability with one specific method.

**Constraints.**
- `ConfigLoader.loadYaml(Path file, Class<T> target) -> T`.
- No `Format` enum, no `Charset` parameter, no `boolean validate / cache` flags.
- Behaviour stays the same: YAML, UTF-8, validate, cache. Those are the *defaults* hard-coded inside.
- When JSON loading is needed (if ever), add `loadJson(Path, Class)` — informed by JSON needs.

**Acceptance criteria.**
- Method signature is two parameters.
- Existing callers shrink to `loader.loadYaml(path, OrdersConfig.class)`.
- `ConfigLoader.java` is under 80 lines (vs the original 200+).
- The cache-disable path (which no caller used) is removed; if proven needed later, add it back with measurement.

---

## Task 5 — Replace `Object` and `instanceof` with sealed switch

```java
public class GenericProcessor {
    public Object process(Object input) {
        if (input instanceof Order o) return processOrder(o);
        if (input instanceof Customer c) return processCustomer(c);
        if (input instanceof Refund r) return processRefund(r);
        if (input instanceof Shipment s) return processShipment(s);
        throw new IllegalArgumentException("unknown: " + input.getClass());
    }
}
```

A new type (`Adjustment`) was added; someone forgot the `if` branch; production crashed.

**Objective.** Make the dispatch exhaustive at compile time.

**Constraints.**
- Introduce a `sealed interface Processable permits Order, Customer, Refund, Shipment` (and add new variants as needed).
- Use pattern-match `switch` for the dispatch.
- The compiler refuses to build when a new variant is added without updating the switch.

**Acceptance criteria.**
- Removing a `case` from the switch causes a compile error.
- Adding `Adjustment` to `permits` without adding a switch case causes a compile error.
- The method signature returns the sealed type, not `Object`.
- The `throw new IllegalArgumentException` is gone — no unreachable default.

---

## Task 6 — Remove the speculative cache

```java
public class CountryService {
    private final Map<String, Country> cache = new ConcurrentHashMap<>();
    public Country byCode(String code) {
        return cache.computeIfAbsent(code, this::loadFromDb);
    }
    private Country loadFromDb(String code) {
        // SELECT * FROM countries WHERE code = ?  -- 0.5 ms against a 200-row table
    }
}
```

A migration adds three countries; the JVM serves old data until restart.

**Objective.** Remove the cache. Add it back only if profiling shows it's needed.

**Constraints.**
- `CountryService` has no `Map` and no `cache` field.
- The DB query is the source of truth; updates are visible immediately.
- A simple JMH benchmark measures the cost of the un-cached call (expect ~0.5 ms).

**Acceptance criteria.**
- New countries appear in production within seconds of the DB migration.
- The benchmark shows the cost is acceptable (≤ a few ms per checkout).
- If profiling later identifies a hot path that *needs* caching, add it with TTL and invalidation, informed by the measurement.

---

## Task 7 — DRY a *real* shared rule (Rule of Three)

In one codebase, three callers each compute a percentage discount:

```java
// File A
Money discount = subtotal.multiply(new BigDecimal("0.10"));
Money afterDiscount = subtotal.minus(discount);

// File B
Money discount = subtotal.multiply(new BigDecimal("0.10"));
Money afterDiscount = subtotal.minus(discount);

// File C
Money discount = subtotal.multiply(new BigDecimal("0.10"));
Money afterDiscount = subtotal.minus(discount);
```

All three callers use the same 10% rule, but for different stakeholders (orders, refunds, promotions). The rule is *one piece of knowledge* (the company's standard discount percentage).

**Objective.** Apply DRY *now* (third occurrence) — but only if the rule is genuinely shared.

**Constraints.**
- Introduce a `DiscountPolicy` interface (or a `final` class) representing the discount rule.
- The percentage lives in *one* place.
- Each caller depends on `DiscountPolicy` (injected) and applies it via a named method (`policy.applyTo(subtotal)`).

**Acceptance criteria.**
- Changing the percentage from 10% to 15% requires *one* file change.
- A test for each caller substitutes a fake policy and verifies behavior.
- If two callers' rules later diverge, splitting back is mechanical: introduce a second policy class.

---

## Task 8 — De-engineer a framework-heavy service

```java
@Service
public class OrderHandlerImpl implements OrderHandler {
    @Autowired private OrderRepository repository;
    @Autowired private EmailService emailService;
    @Autowired private AuditLogger auditLogger;
    @Autowired private ApplicationContext context;     // for "dynamic strategy lookup"

    @PostConstruct public void init() {
        context.getBean("orderProcessor", OrderProcessor.class).register(this);
    }

    @Transactional
    public void handle(Order order) {
        OrderStrategy strategy = context.getBean("orderStrategy_" + order.type(), OrderStrategy.class);
        strategy.execute(order);
        repository.save(order);
        emailService.send(order.customer().email(), "Order processed");
        auditLogger.log("order_processed", order.id().toString());
    }
}
```

The codebase has *one* `OrderStrategy` impl (`orderStrategy_default`). The dynamic lookup is speculation.

**Objective.** Remove the framework speculation while keeping Spring's wiring.

**Constraints.**
- No `ApplicationContext` injection.
- No `getBean(...)` calls in business logic.
- The single `OrderStrategy` is constructor-injected directly.
- `@Autowired` becomes `@Autowired` on the constructor (or removed for an explicit constructor).
- Field injection is replaced with constructor injection.

**Acceptance criteria.**
- A unit test (no Spring context) constructs `OrderHandlerImpl` and exercises `handle(...)`.
- `OrderHandlerImpl.java` has no `ApplicationContext` reference.
- `@PostConstruct init()` is gone.
- The "dynamic strategy lookup" becomes a direct method call.

---

## Validation

| Task | How to verify the fix                                                              |
|------|------------------------------------------------------------------------------------|
| 1    | `OrderHandler` has no `Map` and no `register*` method.                             |
| 2    | Two diverging email rules; tests for each verify the specific rule.                |
| 3    | `DbConnector` test constructs `DbConfig` in 3 lines.                               |
| 4    | `ConfigLoader.loadYaml` is a two-arg method.                                       |
| 5    | Adding a variant to the sealed type without a `case` is a compile error.           |
| 6    | New DB rows appear in production within seconds; benchmark proves acceptable cost. |
| 7    | Changing the discount percentage is a one-file edit.                               |
| 8    | A unit test runs `OrderHandlerImpl` without a Spring context.                      |

---

## Worked solution sketch — Task 5 (sealed switch)

```java
// 1. Declare the closed family
public sealed interface Processable permits Order, Customer, Refund, Shipment, Adjustment { }

// 2. Each variant implements the interface (records are ideal)
public record Order(...) implements Processable { }
public record Customer(...) implements Processable { }
public record Refund(...) implements Processable { }
public record Shipment(...) implements Processable { }
public record Adjustment(...) implements Processable { }

// 3. The processor uses exhaustive pattern-match switch
public final class TypedProcessor {
    public Result process(Processable input) {
        return switch (input) {
            case Order o      -> processOrder(o);
            case Customer c   -> processCustomer(c);
            case Refund r     -> processRefund(r);
            case Shipment s   -> processShipment(s);
            case Adjustment a -> processAdjustment(a);
        };
    }
    // ... five specific methods
}

// 4. Test
@Test void addingNewVariantWithoutSwitchCaseFailsToCompile() {
    // This test doesn't run — it's a compile-time assertion.
    // If you add a new variant to permits and forget the switch case,
    // TypedProcessor.java will not compile.
}
```

Notice three things in the sketch:

1. The `permits` clause is the YAGNI seam: today you have five variants; adding a sixth is a *deliberate* edit, not an accidental extension. KISS preserved.
2. The compiler enforces exhaustiveness — no `default` case, no `throw new IllegalArgumentException`. The dispatch is total.
3. Each variant's logic stays in `processX`; the switch is the routing layer. DRY *and* type-safe.

---

**Memorize this:** over-engineering doesn't show up as compile errors — it shows up as silent staleness, missing wiring, divergence between callers, unreadable type signatures, and frameworks that no one fully understands. Each task above gives you a piece of that pain to fix. After each refactor, the next plausible change should touch *one* file, not the speculative scaffolding.
