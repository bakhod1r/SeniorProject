# Cohesion and Coupling — Middle

> **What?** At the middle level you stop spotting "this class is too big" and start *measuring* cohesion and coupling concretely. You learn LCOM (Lack of Cohesion of Methods), afferent/efferent coupling (Ca/Ce), and how to read a class's *change history* — `git log` is your real cohesion metric. You also learn three mechanical refactor recipes: extract a cohesive sub-class, invert a dependency to lower coupling, and replace stamp coupling with data coupling.
> **How?** Each refactor follows the same recipe: name the change axes that touch this class, group methods by which axis touches them, split or rejoin until each class has one axis. For coupling, identify the *direction* of the dependency, invert it through an interface so the high-level policy doesn't depend on low-level details.

---

## 1. LCOM — the cohesion metric

*Lack of Cohesion of Methods* (Chidamber & Kemerer, 1991) is the classic numeric measure. Several variants exist; the most common is LCOM4:

> Count the connected components of a graph where nodes are methods and edges connect methods that share a field or call each other.

- **LCOM4 = 1** — every method is reachable from every other through shared state or call chain. Fully cohesive.
- **LCOM4 = 2+** — methods form two or more disconnected groups. The class can be split along those groups.

```java
public class UserService {
    private String currentUserId;
    private List<Order> ordersCache;
    private SmtpClient smtp;

    public void login(User u)          { currentUserId = u.id(); }            // touches currentUserId
    public List<Order> orders()        { return ordersCache; }                 // touches ordersCache
    public void refreshOrders()        { ordersCache = repo.findFor(currentUserId); } // both
    public void sendEmail(String body) { smtp.send(currentUserId, body); }     // touches smtp + currentUserId
    public String slugify(String text) { return text.toLowerCase().replace(" ", "-"); } // touches nothing
}
```

Run LCOM4:

- `slugify` shares nothing with anyone → one component.
- `login`, `refreshOrders`, `orders`, `sendEmail` are connected through `currentUserId` and `ordersCache` → one component.

LCOM4 = 2. The class is two cohesive pieces stuck together. The slug method belongs elsewhere.

**Tools that compute it:** SonarQube (`java:S1448`), JArchitect, ckjm. They're approximations — the human reading is the ground truth — but they catch the egregious cases.

---

## 2. Afferent / efferent coupling (Ca / Ce)

Two numbers per class:

- **Efferent coupling (Ce)** — how many *other* classes this class depends on (outgoing arrows).
- **Afferent coupling (Ca)** — how many *other* classes depend on this class (incoming arrows).
- **Instability (I) = Ce / (Ca + Ce)** — between 0 and 1.

High Ce, low Ca → the class depends on many things, few depend on it → it's *unstable*; changes elsewhere force it to change. Common for service classes.

Low Ce, high Ca → many depend on it, it depends on little → *stable*; you shouldn't change it carelessly because every dependent breaks. Common for domain types like `Money`, `OrderId`.

```
OrderService    Ce = 8 (DB, mail, audit, validator, …)   Ca = 3 (only controllers use it)   I ≈ 0.73
Money           Ce = 0                                    Ca = 35                            I = 0
```

**Stable Dependency Principle:** depend in the direction of stability. `OrderService` (unstable) depends on `Money` (stable). Reverse → fragile.

Tools: SonarQube `java:S1200` (class coupled to too many others), ArchUnit dependency rules.

---

## 3. The cohesion-restoring split

The mechanical recipe to lift LCOM4 from N back down to 1:

1. **List all methods and fields.**
2. **Draw the connectivity graph** (which methods touch which fields).
3. **Find the connected components.**
4. **Each component becomes a class.**
5. **The original class becomes either gone, or a small orchestrator that holds the new classes.**

Worked example:

```java
public class CustomerHandler {
    private final DataSource ds;
    private final SmtpClient smtp;
    private final Cache<String, Customer> cache;

    public Customer load(long id)                        { /* uses ds + cache */ }
    public void save(Customer c)                         { /* uses ds */ }
    public Customer findByEmail(String e)                { /* uses ds */ }
    public void notify(Customer c, String msg)           { /* uses smtp */ }
    public void notifyAll(List<Customer> cs, String msg) { /* uses smtp */ }
    public void invalidate(long id)                      { /* uses cache */ }
}
```

Three connected components:
- `load`, `save`, `findByEmail` → share `ds`, and `load` also touches `cache`.
- `notify`, `notifyAll` → share `smtp`.
- `invalidate` → touches `cache` only.

Two clear splits: a `CustomerRepository` (CRUD over `ds`, optionally with cache), and a `CustomerNotifier` (SMTP). The cache becomes a *decorator* on the repository, not a separate class.

```java
public interface CustomerRepository {
    Customer load(long id);
    void save(Customer c);
    Customer findByEmail(String e);
}

public final class CustomerNotifier {
    private final SmtpClient smtp;
    public CustomerNotifier(SmtpClient smtp) { this.smtp = smtp; }
    public void notify(Customer c, String msg) { /* ... */ }
    public void notifyAll(List<Customer> cs, String msg) { /* ... */ }
}

public final class CachingCustomerRepository implements CustomerRepository {
    private final CustomerRepository delegate;
    private final Cache<Long, Customer> cache;
    /* ... */
}
```

LCOM4 = 1 in each new class. Coupling is local — each class talks to one infrastructure dependency.

---

## 4. Lowering coupling — invert the dependency

The mechanical recipe for high coupling:

1. **Identify the dependency direction.** `A → B → C` (A depends on B depends on C).
2. **Decide which class is the high-level policy.** Usually A.
3. **Identify the abstraction A actually needs.** Often "saves orders" or "sends notifications".
4. **Define an interface** in A's package, named after the abstraction.
5. **Make C (or B) implement the interface.**
6. **A depends on the interface, not the concrete.**

```java
// Before
public class OrderService {
    public void place(Order o) {
        PostgresOrderTable.insert(o);                    // direct concrete dependency
        SmtpMailer.connect("smtp.acme.com").send(...);   // direct + hardcoded
    }
}
```

`OrderService` depends on `PostgresOrderTable` (low-level) and `SmtpMailer` (low-level). Inverted:

```java
public interface OrderRepository {  void save(Order o); }
public interface Notifier        {  void notify(NotificationRequest req); }

public final class OrderService {
    private final OrderRepository repo;
    private final Notifier notifier;
    public OrderService(OrderRepository r, Notifier n) { repo = r; notifier = n; }

    public void place(Order o) {
        repo.save(o);
        notifier.notify(NotificationRequest.confirm(o));
    }
}

public final class PostgresOrderRepository implements OrderRepository { /* JDBC */ }
public final class SmtpNotifier implements Notifier { /* SMTP */ }
```

`OrderService` now depends on *two interfaces* — its efferent coupling is 2 (the two interfaces, which are stable abstractions). The concretes depend on the interfaces, not the reverse.

---

## 5. Stamp coupling → data coupling

```java
public BigDecimal taxFor(Order order) {
    return order.customer().address().country().taxRateFor(order.subtotal());
}
```

`taxFor` accepts a fat `Order` but only needs three pieces: subtotal, country, and maybe the buyer's tax exemption status. The argument's surface is far wider than the method's actual needs — *stamp coupling*.

Reduce to data coupling by passing only what's needed:

```java
public BigDecimal taxFor(Money subtotal, Country country, boolean exempt) {
    if (exempt) return BigDecimal.ZERO;
    return country.taxRateFor(subtotal);
}
```

The method now declares its real input. Callers extract the three values explicitly. Test cases become trivial: pick any three values, no mock `Order` needed.

**Trap:** Over-decomposing into eight scalar parameters. If a group of values *always* travels together (subtotal + currency + tax-exemption flag), bundle them into a value record:

```java
public record TaxableSale(Money subtotal, Country country, boolean exempt) { }
public BigDecimal taxFor(TaxableSale sale) { /* ... */ }
```

The record is *cohesive data*. The argument is small. Both coupling and cohesion improve.

---

## 6. Reading `git log` as a cohesion metric

The most honest cohesion measure: **`git log --pretty=format:"%h %s" -- src/main/java/com/acme/OrderService.java`**.

If the recent commit messages are:
- "Add SCA card-3DS handling"
- "Bump SMTP timeout"
- "Refactor invoice PDF rendering"
- "Lower tax rate for EE region"

…that's four reasons to change `OrderService` — four stakeholders. The class isn't cohesive; it serves payments, mail, invoicing, and tax. The commit log shows what static analysis can't: who's *editing* this class, and why.

The mechanical refactor: pick the change axis that fires the *most* commits and split that out first. After three sprints of "most-frequent axis", the class is cohesive by attrition.

---

## 7. Refactoring a stamp-coupled chain

The middle-level case: a controller and three services that all accept the same fat `Order`:

```java
@PostMapping("/orders")
public Receipt place(@RequestBody Order order) {
    validator.validate(order);
    repo.save(order);
    return invoicer.issueFor(order);
}

public class OrderValidator   { public void validate(Order o)     { /* uses o.lineItems, o.customer */ } }
public class OrderRepository  { public void save(Order o)         { /* uses o everywhere */ } }
public class Invoicer         { public Receipt issueFor(Order o)  { /* uses o.total, o.customer */ } }
```

Each service takes the whole order; each uses a different slice. Stamp coupling across the board. Worse: changing `Order`'s structure forces edits in all four classes.

Resolution: keep `OrderRepository.save(Order)` (it really does need everything), but slim the others:

```java
public class OrderValidator { public void validate(LineItems items, Customer c) { /* ... */ } }
public class Invoicer       { public Receipt issueFor(Money total, Customer c)  { /* ... */ } }
```

Validator and invoicer now declare their actual inputs. Changing `Order`'s internal shape doesn't force changes in them. The controller extracts the slices once:

```java
public Receipt place(@RequestBody Order order) {
    validator.validate(order.lineItems(), order.customer());
    repo.save(order);
    return invoicer.issueFor(order.total(), order.customer());
}
```

The controller is the *only* place that knows the relationship between `Order` and its parts. The three services depend on *what they need*, nothing more.

---

## 8. The "common coupling" trap — singletons and globals

Singletons couple every consumer to *the same instance*:

```java
public class Settings {
    private static final Settings INSTANCE = new Settings();
    public static Settings get() { return INSTANCE; }
    public int timeoutMs() { /* ... */ }
}

public class PaymentService {
    public void charge() {
        int t = Settings.get().timeoutMs();   // global coupling
        // ...
    }
}
```

Three problems:
1. *Testing* — substituting a different `Settings` requires reflection or a special accessor.
2. *Lifetime* — the singleton's lifecycle is the JVM's; reconfiguration requires JVM restart.
3. *Latent coupling* — every class that touches the singleton is invisibly coupled to every other class through it. A change to `Settings.timeoutMs()`'s default ripples invisibly across the codebase.

The mid-level fix: inject the abstraction.

```java
public interface Settings { int timeoutMs(); }

public final class PaymentService {
    private final Settings settings;
    public PaymentService(Settings settings) { this.settings = settings; }
    public void charge() { int t = settings.timeoutMs(); /* ... */ }
}
```

The coupling is now explicit at the constructor — visible in the surface signature.

---

## 9. The cohesion/coupling trade-off

Sometimes cohesion and coupling fight. Pulling related behaviour into one cohesive class can *raise* coupling — the class now needs collaborators it didn't before. Splitting a coupled class can *lower* cohesion — each piece does less but the system has more parts.

The middle judgement: aim for *small, cohesive units with few, explicit dependencies*. When the two forces conflict, prefer **cohesion** at the class scale, **decoupling** at the package/module scale. Internally: methods that belong together stay together. Externally: classes that don't need to know about each other don't.

```
+-------------------------+      +------------------+
|  PricingPackage         |      |  BillingPackage  |
|  - PriceCalculator      |----->|  - Invoicer      |
|  - DiscountPolicy       |      |  - Receipt       |
|  - TaxRule              |      +------------------+
+-------------------------+
```

High cohesion *inside* each package; thin coupling *between* packages. That's the shape.

---

## 10. Quick rules

- LCOM4 > 1 → class can be split along the connected components.
- Ce > ~10 → class is unstable; depends on too many concretes.
- Ca > 0 and `final` not used → public surface is widely consumed; lock it down.
- Constructor with 8+ args → the class does too much.
- Singleton + static state → common coupling. Inject via constructor.
- Fat-argument method (`process(Order o)` reading three fields) → reduce to those fields.
- Same data always travels together → make it a record.
- `git log` showing four different stakeholders → split by axis.
- Cohesion at class scale; decoupling at package scale.

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Connascence, the seven levels of cohesion in depth          | `senior.md`        |
| Driving cohesion/coupling reviews across a team             | `professional.md`  |
| JLS access control, modules, package design                 | `specification.md` |
| Spotting hidden coupling and cohesion drift                 | `find-bug.md`      |
| Performance impact of indirection layers                    | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** the mid-level skills are *measure* and *split*. LCOM4 names cohesion failures; afferent/efferent coupling names dependency direction. The split recipe is mechanical — connected components, change axes, `git log`. Cohesion wins inside the class; decoupling wins at the package boundary.
