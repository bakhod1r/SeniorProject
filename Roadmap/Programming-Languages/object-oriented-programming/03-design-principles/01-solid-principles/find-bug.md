# SOLID Principles — Find the Bug

> 10 buggy snippets, each illustrating a silent SOLID violation that compiles, looks fine in review, and only bites in production or under test. For each: read the code, decide which letter is being violated, identify the *runtime symptom* (stack trace, wrong value, untestable code, crashing batch job), and write down the fix.

---

## Bug 1 — `UnmodifiableList extends ArrayList`

```java
public class UnmodifiableList<E> extends ArrayList<E> {
    public UnmodifiableList(Collection<? extends E> seed) {
        super(seed);
    }

    @Override public boolean add(E e) {
        throw new UnsupportedOperationException("read-only");
    }
    @Override public boolean addAll(Collection<? extends E> c) {
        throw new UnsupportedOperationException("read-only");
    }
    @Override public E remove(int index) {
        throw new UnsupportedOperationException("read-only");
    }
}
```

```java
// Caller: a perfectly innocent bulk-import job.
List<Customer> customers = customerRepo.findAll();   // returns UnmodifiableList
customers.addAll(importedFromCsv);                   // boom
```

**Symptom.** A nightly bulk-import job that has run successfully for two years suddenly throws after `customerRepo` switched to returning the new "safe" type:

```
Exception in thread "import-worker" java.lang.UnsupportedOperationException: read-only
    at com.acme.UnmodifiableList.addAll(UnmodifiableList.java:18)
    at com.acme.CustomerImporter.run(CustomerImporter.java:64)
```

**Violation.** **L** — Liskov Substitution. `UnmodifiableList` *is-a* `ArrayList` to the type system, but it actively breaks the documented contract of `add`/`addAll`/`remove`. Any code holding a `List<E>` reference that legitimately calls those methods crashes.

**Fix.** Don't extend `ArrayList`. Implement a narrower interface or wrap an `ArrayList` and expose only the operations you support:

```java
public final class ReadOnlyList<E> implements Iterable<E> {
    private final List<E> backing;
    public ReadOnlyList(Collection<? extends E> seed) {
        this.backing = List.copyOf(seed);
    }
    public int size() { return backing.size(); }
    public E get(int i) { return backing.get(i); }
    public Iterator<E> iterator() { return backing.iterator(); }
}
```

Callers can no longer accidentally call `add`. The type itself communicates the contract.

---

## Bug 2 — `save` that also sends an email

```java
public class UserService {
    private final UserRepository repo;
    private final EmailGateway email;

    public UserService(UserRepository repo, EmailGateway email) {
        this.repo = repo;
        this.email = email;
    }

    public void save(User user) {
        repo.save(user);
        email.send(user.email(), "Welcome to Acme",
                   "Hi " + user.name() + ", thanks for joining!");
    }
}
```

```java
// In a unit test for an unrelated feature:
@Test void updatingPasswordPersists() {
    userService.save(userWithNewPassword);    // also sends an email, every test run
    assertEquals(...);
}
```

**Symptom.** Two failures, often weeks apart.

1. The test suite occasionally fails with `SocketTimeoutException` from the SMTP client when CI's network blip kicks in. Re-running passes.
2. After a real outage, an SMTP retry sees the same `save` called twice and emails the user "Welcome to Acme" *during a password change*. Customer support complains.

**Violation.** **S** — Single Responsibility. `save` has two reasons to change: persistence rules and customer-communication rules. Worse, they're in the same transaction-shaped method, so a slow email blocks the DB commit (or vice versa).

**Fix.** Split. Persistence is one responsibility; user lifecycle notifications are another. Publish an event the notifier subscribes to:

```java
public void save(User user) {
    repo.save(user);
    events.publish(new UserSaved(user.id()));
}
```

A `WelcomeMailer` subscribes to `UserCreated` (not every `UserSaved`) and decides on its own when to send the email. Tests for `save` don't touch SMTP at all.

---

## Bug 3 — The switch that someone forgot to update

```java
public final class ShippingCalculator {
    public BigDecimal cost(Parcel p) {
        switch (p.carrier()) {
            case "DHL":    return p.weightKg().multiply(new BigDecimal("4.20"));
            case "UPS":    return p.weightKg().multiply(new BigDecimal("3.95"));
            case "FEDEX":  return p.weightKg().multiply(new BigDecimal("4.10"));
            case "USPS":   return p.weightKg().multiply(new BigDecimal("3.50"));
        }
        return BigDecimal.ZERO;   // "shouldn't happen"
    }
}
```

```java
// Meanwhile, six months later, someone adds a new carrier in the order form:
parcel.setCarrier("ARAMEX");
```

**Symptom.** No exception. No log line. Customers shipping via ARAMEX are simply charged `0.00` for shipping. Finance notices six weeks later when reconciling the carrier invoices.

**Violation.** **O** — Open/Closed. Adding a carrier requires editing this class, and the type code (`String`) gave the compiler no way to enforce that the switch was updated.

**Fix.** Replace the string-keyed switch with a polymorphic dispatch — or, in modern Java, a sealed type and exhaustive pattern matching that the compiler will check.

```java
public sealed interface Carrier permits Dhl, Ups, FedEx, Usps, Aramex {
    BigDecimal ratePerKg();
}

public BigDecimal cost(Parcel p) {
    return p.weightKg().multiply(p.carrier().ratePerKg());
}
```

Adding ARAMEX is now a new `record Aramex(...) implements Carrier`. The compiler refuses to forget the switch — there is no switch.

---

## Bug 4 — The fat interface and seven `UnsupportedOperationException`s

```java
public interface VehicleControl {
    void accelerate(double mps2);
    void brake(double force);
    void steer(double angleRad);
    void engageReverse();
    void deployParachute();
    void lowerLandingGear();
    void retractLandingGear();
    void fireRcsThruster(int id, double mns);
    void openCargoBay();
}

public class CityCar implements VehicleControl {
    public void accelerate(double mps2) { /* ... */ }
    public void brake(double force)     { /* ... */ }
    public void steer(double angleRad)  { /* ... */ }

    public void engageReverse()             { /* ... */ }
    public void deployParachute()           { throw new UnsupportedOperationException(); }
    public void lowerLandingGear()          { throw new UnsupportedOperationException(); }
    public void retractLandingGear()        { throw new UnsupportedOperationException(); }
    public void fireRcsThruster(int i, double m) { throw new UnsupportedOperationException(); }
    public void openCargoBay()              { throw new UnsupportedOperationException(); }
}
```

**Symptom.** A generic `AutopilotTester` written to exercise *all* `VehicleControl` methods produces a baffling stack trace on a city car:

```
java.lang.UnsupportedOperationException
    at com.acme.CityCar.deployParachute(CityCar.java:21)
    at com.acme.AutopilotTester.runFullSweep(AutopilotTester.java:88)
```

The error message is empty. A new engineer spends an afternoon chasing a "missing parachute" before realising the interface is the problem.

**Violation.** **I** — Interface Segregation. One interface bundles roles that don't belong together. Every implementation is forced to either implement methods it doesn't have, or lie by throwing.

**Fix.** Split the interface by *role*:

```java
public interface RoadVehicle { void accelerate(double a); void brake(double f); void steer(double r); void engageReverse(); }
public interface Aircraft    { void lowerLandingGear(); void retractLandingGear(); }
public interface Spacecraft  { void fireRcsThruster(int id, double mns); void deployParachute(); }
public interface CargoCarrier { void openCargoBay(); }

public class CityCar implements RoadVehicle { /* only the methods that make sense */ }
```

The `AutopilotTester` now accepts a `RoadVehicle` and the compiler refuses to ask a city car to deploy a parachute.

---

## Bug 5 — Concrete `PostgresConn` baked into the domain

```java
public class OrderService {
    public void place(Order o) {
        try (PostgresConn conn = new PostgresConn("jdbc:postgresql://prod-db:5432/orders")) {
            conn.insertOrder(o);
            conn.appendToLedger(o);
        }
    }
}
```

```java
// The unit test someone tried to write:
@Test void placingOrderAppendsLedger() {
    new OrderService().place(sampleOrder);   // attempts to dial prod-db
}
```

**Symptom.** On the developer's laptop, the test hangs for thirty seconds and then:

```
java.net.UnknownHostException: prod-db
    at com.acme.db.PostgresConn.<init>(PostgresConn.java:42)
    at com.acme.OrderService.place(OrderService.java:7)
```

CI fails the same way. Nobody can run the test without a live production database, so nobody writes more tests, so the service grows untested.

**Violation.** **D** — Dependency Inversion. The high-level policy (`OrderService.place`) directly depends on a low-level detail (`PostgresConn`) and on the production hostname.

**Fix.** Depend on an abstraction; inject the implementation:

```java
public interface OrderRepository {
    void insert(Order o);
    void appendToLedger(Order o);
}

public class OrderService {
    private final OrderRepository repo;
    public OrderService(OrderRepository repo) { this.repo = repo; }
    public void place(Order o) {
        repo.insert(o);
        repo.appendToLedger(o);
    }
}
```

Tests inject an in-memory `OrderRepository`. Production wires `PostgresOrderRepository`. The domain class no longer knows what a JDBC URL is.

---

## Bug 6 — A subclass throws what the parent never could

```java
public class ConfigLoader {
    public Config load(String path) {
        return parseInMemory(path);
    }
}

public class RemoteConfigLoader extends ConfigLoader {
    @Override
    public Config load(String path) {
        try {
            return parseRemote(path);
        } catch (IOException e) {
            throw new UncheckedIOException(e);   // parent never threw this
        }
    }
}
```

```java
// Caller — written assuming the parent contract:
try {
    Config c = configLoader.load(path);
    apply(c);
} catch (IllegalArgumentException bad) {
    log.warn("bad path", bad);
}
// Nothing else is caught. UncheckedIOException sails up.
```

**Symptom.** The caller's `try/catch` was designed for the parent's contract (only `IllegalArgumentException`). With the subclass installed, an intermittent network blip propagates an `UncheckedIOException` all the way to the request thread, which logs a generic 500. The bug only surfaces under partial network failure — never reproducible on demand.

**Violation.** **L** — Liskov Substitution (exception side). A subtype may throw *fewer* exceptions than the supertype, never *more*. Strengthening the failure mode breaks every caller that wrote a `catch` against the parent's contract.

**Fix.** Either (a) widen the parent contract to declare the new failure mode (everyone updates their `catch` blocks deliberately), or (b) handle the error inside the subclass and return a documented sentinel (`Optional<Config>`, `ConfigResult.failure(...)`), or (c) reconsider whether `RemoteConfigLoader` *should* extend `ConfigLoader` at all.

---

## Bug 7 — Subclass refuses inputs the parent accepted

```java
public class Account {
    /** Transfers any non-negative amount. Zero is allowed and is a no-op. */
    public void deposit(BigDecimal amount) {
        if (amount.signum() < 0) throw new IllegalArgumentException();
        balance = balance.add(amount);
    }
}

public class PremiumAccount extends Account {
    @Override
    public void deposit(BigDecimal amount) {
        if (amount.compareTo(new BigDecimal("10")) < 0)
            throw new IllegalArgumentException("premium accounts: min deposit 10");
        super.deposit(amount);
    }
}
```

```java
// Existing batch reconciliation, written against Account:
for (Account a : todaysAccounts) {
    a.deposit(BigDecimal.ZERO);     // legal for Account, throws for PremiumAccount
}
```

**Symptom.** A nightly job that posts a `BigDecimal.ZERO` heartbeat to every account starts to fail two weeks after premium accounts ship:

```
IllegalArgumentException: premium accounts: min deposit 10
    at com.acme.PremiumAccount.deposit(PremiumAccount.java:6)
    at com.acme.NightlyReconciliation.run(NightlyReconciliation.java:31)
```

**Violation.** **L** — Liskov Substitution (precondition side). A subtype may *weaken* preconditions (accept more inputs), never *strengthen* them. `PremiumAccount` refuses inputs `Account` accepted, so any caller holding an `Account` is now wrong.

**Fix.** Don't model "premium" as a subtype of `Account`. Model it as a *policy* the account composes:

```java
public final class Account {
    private final DepositPolicy policy;
    public void deposit(BigDecimal amount) {
        policy.check(amount);
        balance = balance.add(amount);
    }
}
```

Or, if you must keep inheritance, make `PremiumAccount` widen the parent (e.g., accept the deposit and *queue* it as pending) rather than narrowing it.

---

## Bug 8 — `switch` on `getClass().getSimpleName()`

```java
public BigDecimal taxFor(Product p) {
    String type = p.getClass().getSimpleName();
    switch (type) {
        case "Book":       return ZERO_TAX;
        case "Food":       return REDUCED_TAX;
        case "Electronic": return STANDARD_TAX;
        default:           return STANDARD_TAX;
    }
}
```

```java
// Two months later, a refactor introduces:
public final class FoodProduct extends Product { /* renamed from Food */ }
```

**Symptom.** No compiler warning. No test failure (the test fixture wasn't renamed). Food items silently start being taxed at the *standard* rate because the simple name no longer matches the literal `"Food"`. The accounting team notices when quarterly tax filings are off by a five-figure sum.

**Violation.** **O** — Open/Closed (with a side of LSP). Behaviour is keyed on a string that the compiler doesn't police, so renaming a class — a refactor the IDE swears is "safe" — silently changes business logic.

**Fix.** Move the behaviour onto the type itself. Polymorphism is the OCP-friendly choice:

```java
public sealed interface Product permits Book, Food, Electronic {
    BigDecimal taxRate();
}
public record Book(String isbn)        implements Product { public BigDecimal taxRate() { return ZERO_TAX; } }
public record Food(String sku)         implements Product { public BigDecimal taxRate() { return REDUCED_TAX; } }
public record Electronic(String model) implements Product { public BigDecimal taxRate() { return STANDARD_TAX; } }

BigDecimal taxFor(Product p) { return p.taxRate(); }
```

Rename `Food` to `FoodProduct`: the IDE renames it everywhere because the compiler sees the symbol, not a string.

---

## Bug 9 — Singleton baked into business logic

```java
public class PricingService {
    public BigDecimal quote(Cart cart) {
        BigDecimal subtotal = cart.subtotal();
        BigDecimal vat = TaxRegistry.getInstance().rateFor(cart.region());
        return subtotal.multiply(BigDecimal.ONE.add(vat));
    }
}

public class TaxRegistry {
    private static final TaxRegistry INSTANCE = new TaxRegistry(load("/etc/tax.yml"));
    public static TaxRegistry getInstance() { return INSTANCE; }
    /* ... */
}
```

```java
// Test:
@Test void quoteAppliesGermanVat() {
    BigDecimal q = new PricingService().quote(cart("DE", BigDecimal.TEN));
    // expected: 10 * 1.19 = 11.90
}
```

**Symptom.** Two problems.

1. In CI the test fails with `NoSuchFileException: /etc/tax.yml` — the singleton initializer runs eagerly on class load, before any test code runs:

```
java.lang.ExceptionInInitializerError
    at com.acme.PricingService.quote(PricingService.java:5)
Caused by: java.nio.file.NoSuchFileException: /etc/tax.yml
    at com.acme.TaxRegistry.<clinit>(TaxRegistry.java:9)
```

2. After a teammate puts a sample file at `/etc/tax.yml`, the test passes locally but fails on macOS where the file is at a different path. The test is sensitive to a global the test author never touched.

**Violation.** **D** — Dependency Inversion. The singleton is a global concrete dependency, hidden inside a static factory, that cannot be swapped at construction time.

**Fix.** Inject a `TaxRegistry` interface; let production wire one instance through your composition root (or a DI container). The class no longer has any opinion about whether a registry is global, per-request, or stubbed in a test:

```java
public class PricingService {
    private final TaxRegistry tax;
    public PricingService(TaxRegistry tax) { this.tax = tax; }
    public BigDecimal quote(Cart c) { /* uses this.tax */ }
}
```

Tests build a `Map<Region, BigDecimal>`-backed registry in a single line. No `/etc/tax.yml`, no global state.

---

## Bug 10 — A "SOLID refactor" that introduced two new violations

A senior dev claims they fixed the original `OrderService` (Bug 5) by introducing this:

```java
public abstract class AbstractEntityService<E> {
    protected final Connection conn;

    protected AbstractEntityService(Connection conn) { this.conn = conn; }

    public final void save(E entity) {
        beforeSave(entity);
        doSave(entity);
        afterSave(entity);
        Notifier.getInstance().notifyOfSave(entity);   // (*)
    }

    protected void beforeSave(E entity) {}
    protected abstract void doSave(E entity);
    protected void afterSave(E entity) {}
}

public class OrderService extends AbstractEntityService<Order> {
    public OrderService(Connection conn) { super(conn); }

    @Override
    protected void doSave(Order o) {
        // INSERT ...
    }

    @Override
    protected void afterSave(Order o) {
        emailWelcomePack(o.customer());                // (**)
    }
}
```

**Symptom.** Three flavours of failure show up in the next sprint.

1. Tests still can't run without a network — `Notifier.getInstance()` (line `*`) loads SMTP config statically.
2. Adding a *non-notifying* `DraftOrderService` is impossible: the `notifyOfSave` call is hard-coded into the `final save`.
3. The `afterSave` hook (line `**`) sends the welcome email — the same SRP smell from Bug 2, now hidden one inheritance level deep where the stack trace is harder to read:

```
at com.acme.OrderService.afterSave(OrderService.java:14)
at com.acme.AbstractEntityService.save(AbstractEntityService.java:8)
```

**Violations.** Multiple.

- **D** — `Notifier.getInstance()` is the same hidden global as Bug 9, re-introduced.
- **O** — `save` is `final` and contains a hard-coded notify call: extending the class with a non-notifying variant requires editing the base.
- **S** — `OrderService.afterSave` couples persistence to user-communication, the original smell from Bug 2.
- **L** — Subclasses of `AbstractEntityService` are forced to inherit the notifier even when it doesn't make sense (e.g., draft orders), tempting them to throw or no-op from hooks (creeping toward Bug 4).

**Fix.** The "template method + abstract base" was the wrong frame. Compose, don't inherit:

```java
public final class OrderService {
    private final OrderRepository repo;
    private final DomainEvents events;
    public OrderService(OrderRepository repo, DomainEvents events) {
        this.repo = repo; this.events = events;
    }
    public void place(Order o) {
        repo.insert(o);
        events.publish(new OrderPlaced(o.id()));
    }
}
```

A `WelcomeMailer` subscribes to `OrderPlaced` separately; a `DraftOrderService` doesn't publish that event at all. Tests pass a fake `DomainEvents`. Every letter of SOLID is now respected, and the code is shorter.

---

## Pattern summary

| Violation type                                | What to look for                                                |
|-----------------------------------------------|-----------------------------------------------------------------|
| LSP — subclass breaks contract (Bugs 1, 6, 7) | `throw new UnsupportedOperationException`; new exception types; stricter input checks |
| SRP — multi-purpose methods (Bugs 2, 10)      | One method calling both `repo.save` *and* `email.send`/`http.post` |
| OCP — type-code dispatch (Bugs 3, 8)          | `switch` on strings, enum values, or `getClass()`; default branches that "shouldn't happen" |
| ISP — fat interface (Bug 4)                   | Implementations with multiple `UnsupportedOperationException`s; empty methods |
| DIP — hidden concrete dependency (Bugs 5, 9, 10) | `new SomeDriver()` in constructors; `XxxRegistry.getInstance()` in business methods |

These violations rarely produce a clean compile error. They show up as test environments that won't start, batch jobs that crash on inputs they used to handle, refactors that change behaviour, or — worst — silent zeros and wrong taxes. Train your eye to spot them in review: the compiler will not.
