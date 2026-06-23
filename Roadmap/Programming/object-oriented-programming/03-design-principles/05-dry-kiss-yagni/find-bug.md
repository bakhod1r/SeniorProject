# DRY, KISS, YAGNI — Find the Bug

> 10 buggy snippets where over-engineering or premature abstraction caused silent failures. For each: read the code, decide which rule was violated (and *how*: premature DRY, fake KISS, ignored YAGNI), pinpoint the runtime symptom, and write the fix.

---

## Bug 1 — The wrong abstraction silently diverges

```java
public final class Validators {
    public static boolean isValidEmail(String email) {
        return email != null && email.matches("^[^@]+@[^@]+\\..+$");
    }
}

// Order code
boolean valid = Validators.isValidEmail(order.email());

// Customer signup code
boolean valid = Validators.isValidEmail(customer.email());
```

```java
// Three months later: business says "orders accept catch-all aliases like orders+xyz@..."
// Someone "fixes" Validators.isValidEmail to accept the alias.
// Effect: customer signup now also accepts the alias — wrong for marketing.
```

**Symptom.** Customer signups stop being rejected for aliases; the marketing team gets spam-list subscriptions; the metrics drift downward. The change wasn't tested against the customer use case because it was filed as an "order fix".

**Violation.** Sandi Metz's *wrong abstraction*. `isValidEmail` looked like a shared rule; really, orders and customers have different rules. DRY was applied to apparent (shape) duplication, not meaning duplication.

**Fix.** Un-extract.

```java
public final class OrderValidator {
    public boolean isValidEmail(String e) {
        return e != null && e.matches("^[^@+]+(\\+[^@]+)?@[^@]+\\..+$");  // allow +
    }
}
public final class CustomerValidator {
    public boolean isValidEmail(String e) {
        return e != null && e.matches("^[^@+]+@[^@]+\\..+$");              // no +
    }
}
```

Each owner has their rule. Changes are local.

---

## Bug 2 — Plugin registry with one plugin

```java
public class OrderHandler {
    private final Map<String, OrderHook> hooks = new ConcurrentHashMap<>();
    public void register(String name, OrderHook h) { hooks.put(name, h); }

    public void handle(Order o) {
        hooks.values().forEach(h -> h.fire(o));
        save(o);
    }
}
```

`grep -r 'OrderHandler.*register' src/` returns one hit, in the production wiring: `handler.register("audit", new AuditHook())`.

**Symptom.** A NullPointerException at startup: the wiring file forgot to register the audit hook in one environment. The "plugin" silently doesn't run, audit records go missing, compliance discovers it two quarters later.

**Violation.** YAGNI. The hook system was built for a future that never arrived; the registration step became a hidden failure mode.

**Fix.** Inline the one hook.

```java
public final class OrderHandler {
    private final OrderRepository repo;
    private final AuditHook audit;
    public OrderHandler(OrderRepository repo, AuditHook audit) { this.repo = repo; this.audit = audit; }
    public void handle(Order o) {
        audit.fire(o);
        repo.save(o);
    }
}
```

Both dependencies are constructor args — missing wiring is a compile-time-visible failure (the constructor refuses null). When a second hook arrives, refactor with knowledge of what *it* needs.

---

## Bug 3 — "Configurable" loader with one config

```java
public final class ConfigLoader {
    public Config load(String source, Format format, Charset charset,
                       boolean validate, boolean cache, Class<?> target) {
        // 200 lines of branching
    }
}

// Every caller
Config c = loader.load("config.yaml", Format.YAML, UTF_8, true, true, Config.class);
```

**Symptom.** Every caller passes the same six arguments. A bug in the `cache=false` path lives undetected because no test exercises it. When someone changes the order of parameters, half the codebase mis-binds and ships silent regressions.

**Violation.** YAGNI plus stamp coupling. The configurability speculation introduced a 6-parameter method when one is needed.

**Fix.** Specific methods.

```java
public final class ConfigLoader {
    public Config loadYaml(Path path) {
        // ...one method, one job
    }
}
```

When JSON arrives, you'll add `loadJson(Path)` — informed by what JSON loading actually needs.

---

## Bug 4 — `Object` and reflection-based dispatch

```java
public class GenericProcessor {
    public Object process(Object input, Map<String, Object> options) {
        Class<?> type = input.getClass();
        if (type == Order.class) return processOrder((Order) input, options);
        if (type == Customer.class) return processCustomer((Customer) input, options);
        // ...4 more types
        throw new IllegalArgumentException("unknown type: " + type);
    }
}
```

**Symptom.** A bug introduced when a new type was added: someone forgot the `if (type == Refund.class)` branch. The new refund object reaches the `throw` and crashes a customer-facing endpoint. Type safety was forfeit.

**Violation.** Fake KISS. The `Object`-typed signature looks "general" but produces unsafe code; the *if-cascade* is what cohesion fails look like.

**Fix.** Sealed types + pattern-match switch.

```java
public sealed interface Processable permits Order, Customer, Refund, Shipment, ... { }

public final class TypedProcessor {
    public Processable process(Processable input, Options options) {
        return switch (input) {
            case Order o -> processOrder(o, options);
            case Customer c -> processCustomer(c, options);
            case Refund r -> processRefund(r, options);
            // compiler enforces exhaustiveness
        };
    }
}
```

Add a new variant and the compiler refuses to build until every switch handles it. KISS *and* type-safe.

---

## Bug 5 — Premature singleton

```java
public class TaxRateRegistry {
    private static TaxRateRegistry INSTANCE;
    public static synchronized TaxRateRegistry getInstance() {
        if (INSTANCE == null) INSTANCE = loadFromFile("/etc/tax.yml");
        return INSTANCE;
    }
}

public class OrderService {
    public Money taxFor(Order o) {
        return TaxRateRegistry.getInstance().rateFor(o.country()).multiply(o.subtotal());
    }
}
```

**Symptom.** Tests fail with `NoSuchFileException: /etc/tax.yml` because the singleton lazily loads on first access. CI doesn't have the file. The fix-attempts (mocking statics, setting properties) cascade into a Mockito-PowerMock dependency. Tests slow down.

**Violation.** YAGNI + KISS. The singleton was speculation (one process, one config — no real reason for a singleton). The static factory pattern made testing hard.

**Fix.** Inject.

```java
public interface TaxRates { BigDecimal rateFor(Country country); }

public final class OrderService {
    private final TaxRates rates;
    public OrderService(TaxRates rates) { this.rates = rates; }
    public Money taxFor(Order o) { return rates.rateFor(o.country()).multiply(o.subtotal()); }
}
```

Tests pass an in-memory `TaxRates`. Production wires the yml-loaded one. No singleton.

---

## Bug 6 — Inheritance for "DRY"

```java
public abstract class BaseValidator<T> {
    protected void notNull(Object o, String name) {
        if (o == null) throw new IllegalArgumentException(name + " required");
    }
    protected void notBlank(String s, String name) {
        if (s == null || s.isBlank()) throw new IllegalArgumentException(name + " blank");
    }
    public abstract void validate(T entity);
}

public class OrderValidator extends BaseValidator<Order> {
    public void validate(Order o) {
        notNull(o.customer(), "customer");
        notBlank(o.id(), "id");
    }
}
public class CustomerValidator extends BaseValidator<Customer> {
    public void validate(Customer c) {
        notNull(c.email(), "email");
        notBlank(c.name(), "name");
    }
}
```

**Symptom.** A change to `BaseValidator.notNull` (the message format, the exception type) silently changes every validator's error behaviour. Tests for `OrderValidator` pass; tests for `CustomerValidator` fail in a different module due to format expectations. The inheritance has *coupled* the two.

**Violation.** Fake DRY through inheritance. The shared utility (one-line null check) didn't justify a base class.

**Fix.** Use `Objects.requireNonNull` (the JDK's real DRY) plus composition.

```java
public final class OrderValidator {
    public void validate(Order o) {
        Objects.requireNonNull(o.customer(), "customer");
        if (o.id() == null || o.id().isBlank()) throw new IllegalArgumentException("id blank");
    }
}
```

Two lines duplicated across validators — fine. Each evolves independently. No inheritance.

---

## Bug 7 — God configuration object

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

public class DbConnector {
    public Connection connect(AppConfig config) { /* uses dbUrl, dbPoolSize, dbTimeoutMs */ }
}
```

**Symptom.** Every class that consumes any config field depends on the entire `AppConfig`. Recompiling triggers a cascade. Tests have to instantiate the whole config (or a stub) for every test. Changing the SMTP port in dev accidentally affects the database tests because both files import `AppConfig`.

**Violation.** Stamp coupling + fake DRY. "All config in one place" looked DRY; really, it bundled unrelated concerns into one type.

**Fix.** Split by concern.

```java
public record DbConfig(int poolSize, int timeoutMs, String url) { }
public record SmtpConfig(int port, String host, boolean tls) { }
public record KafkaConfig(int maxBatch, String bootstrap) { }
public record HttpConfig(int threads) { }
public record TracingConfig(boolean enabled) { }

public class DbConnector {
    public Connection connect(DbConfig config) { /* ... */ }
}
```

Each consumer depends on its narrow config. Tests construct the relevant record only.

---

## Bug 8 — `try/catch (Exception e)` swallow

```java
public class ImportService {
    public void importCsv(Path file) {
        try {
            // 30 lines: read file, parse, validate, write to DB
        } catch (Exception e) {
            log.error("import failed", e);
        }
    }
}
```

**Symptom.** Imports silently "succeed" with zero records imported. The log line exists but no alerting fires (the method returned normally). A finance team discovers the missing records two weeks later.

**Violation.** Fake KISS. The catch-all looks "simple" — one error path for everything — but it conceals every kind of failure. The handler returns without indicating failure to the caller.

**Fix.** Throw a domain exception; let the caller decide.

```java
public class ImportService {
    public ImportResult importCsv(Path file) {
        // No top-level try/catch. Specific exceptions where they matter.
        List<Row> rows = parse(file);                          // throws IOException
        ValidationReport vr = validate(rows);                  // accumulates failures
        if (vr.hasFailures()) throw new ImportValidationException(vr);
        repo.saveAll(rows);
        return ImportResult.ok(rows.size());
    }
}
```

The caller gets a typed return on success or a typed exception on failure. No silent swallowing.

---

## Bug 9 — Speculative generic parameters

```java
public class Pipeline<T, R, C extends PipelineConfig<T>, M extends Metadata<T, R>> {
    public R execute(T input, C config, M meta) { /* ... */ }
}

// All concrete usages
Pipeline<Order, Receipt, OrderConfig, OrderMetadata> p = new Pipeline<>();
```

**Symptom.** Every consumer wrestles with the four type parameters. Compile errors are unintelligible. A new developer spends a day understanding the type variance before writing any business code. The four-param generic adds zero behaviour; it just documents speculation.

**Violation.** YAGNI. The generics speculate that someone will instantiate the pipeline with different types. They never do.

**Fix.** Concrete.

```java
public final class OrderPipeline {
    public Receipt execute(Order input, OrderConfig config, OrderMetadata meta) { /* ... */ }
}
```

When a second pipeline appears (`PaymentPipeline`?), it'll be a separate `final` class — the genericization gains nothing.

---

## Bug 10 — Caching that didn't need caching

```java
public class CountryService {
    private final Map<String, Country> cache = new ConcurrentHashMap<>();
    public Country byCode(String code) {
        return cache.computeIfAbsent(code, this::loadFromDb);
    }
    private Country loadFromDb(String code) { /* SELECT * FROM countries WHERE code = ? */ }
}
```

**Symptom.** A migration adds three new countries; the running JVM still serves the old set. Customers in the new countries can't check out. The cache has no TTL, no invalidation, no admin endpoint to clear. The JVM must restart.

**Violation.** YAGNI plus KISS. The cache was added "for performance"; the underlying `SELECT` was a 0.5 ms lookup against a 200-row table. The cache solved no actual problem and introduced a real one (stale data).

**Fix.** Remove the cache.

```java
public final class CountryService {
    private final CountryRepository repo;
    public CountryService(CountryRepository r) { this.repo = r; }
    public Country byCode(String code) { return repo.findByCode(code); }
}
```

If profiling later proves the lookup is a bottleneck, add caching *with* TTL and invalidation, informed by what the system actually needs.

---

## Pattern summary

| Bug | Smell                                                       | Fix                                          |
|-----|-------------------------------------------------------------|----------------------------------------------|
| 1   | DRY-merge of similar-looking rules that diverge later       | Un-extract; each owner has their rule         |
| 2   | YAGNI plugin registry with one plugin                       | Inline; refactor when 2nd plugin arrives      |
| 3   | "Configurable" loader with 6 args, one combination used    | Specific methods per case                     |
| 4   | Fake KISS via `Object` + `instanceof` cascade               | Sealed types + pattern-match switch           |
| 5   | Premature singleton makes tests hard                        | Inject via constructor; remove static        |
| 6   | Inheritance as DRY for one-line helpers                     | `Objects.requireNonNull` + composition        |
| 7   | God config with 60 fields couples everything                | Split into per-concern records                |
| 8   | `catch (Exception e)` swallow loses failures                | Specific exceptions; typed return             |
| 9   | Speculative generic parameters with one concrete use        | Concrete class; refactor on second case       |
| 10  | YAGNI cache solving no real performance problem             | Remove; add caching with measurement          |

Each bug compiles cleanly. Each looked "DRY", "KISS", or "YAGNI-respectful" to the original author. The lessons: DRY-merge after the third occurrence, KISS means *fit-for-purpose* not *minimal*, YAGNI strips speculation but not real requirements (security, observability, error handling).
