# Cohesion and Coupling — Junior

> **What?** *Cohesion* measures how strongly the responsibilities *inside* a module belong together. *Coupling* measures how strongly two modules depend *on each other*. The rule of thumb you'll hear repeated for the rest of your career: **high cohesion, low coupling**. Cohesive code reads like a single idea per file; loosely coupled code lets you change one module without dragging others along.
> **How?** When you read a class, ask: *do these methods belong on the same name?* That's cohesion. When you read between classes, ask: *if I changed this class, how many others would I have to touch?* That's coupling. Both questions are about *change cost*, not about abstract beauty.

---

## 1. The two ideas in one snippet

A **low-cohesion** class collects things that don't belong together:

```java
public class Utils {
    public static String formatMoney(BigDecimal amount, Currency currency) { /* ... */ }
    public static boolean isWeekend(LocalDate date)                        { /* ... */ }
    public static String generateUuid()                                    { /* ... */ }
    public static byte[] hashPassword(String pwd)                          { /* ... */ }
    public static String slugify(String text)                              { /* ... */ }
}
```

Five methods. Five different reasons to change. `formatMoney` changes when locale rules shift; `hashPassword` changes when crypto policy shifts. The class is a bag.

A **high-cohesion** alternative splits them by purpose:

```java
public final class MoneyFormatter { public static String format(BigDecimal a, Currency c) { /* ... */ } }
public final class Calendar       { public static boolean isWeekend(LocalDate d)          { /* ... */ } }
public final class IdGenerator    { public static String generateUuid()                   { /* ... */ } }
public final class PasswordHasher { public static byte[] hash(String pwd)                 { /* ... */ } }
public final class TextSlugifier  { public static String slugify(String text)             { /* ... */ } }
```

Each name now describes one purpose. Each file changes for one reason.

**High coupling** appears across class boundaries when one class knows too much about another:

```java
public class OrderProcessor {
    public void process(Order order, EmailService email, SmsService sms,
                        DbConnection db, AuditLogger audit, MetricsRegistry metrics) {
        // every method in process needs at least three of these
    }
}
```

Six parameters, six external dependencies. Any one of them changes signature → `OrderProcessor` recompiles → every caller of `process` recompiles. That's the coupling cost.

---

## 2. Everyday analogy

Imagine a kitchen.

- **High cohesion:** the knife drawer holds knives, the spice rack holds spices, the fridge holds perishables. One drawer, one purpose. If you reorganize the knife drawer, the spice rack is untouched.
- **Low cohesion:** a junk drawer with knives, spice jars, batteries, takeaway menus, screws, and string. Reorganizing requires touching everything.
- **High coupling:** the toaster is hard-wired to one specific outlet, and that outlet is shared with the fridge. Replacing the toaster means rewiring the kitchen.
- **Low coupling:** the toaster has a standard plug. Replace it without touching anything else. The wiring is hidden behind a single, documented contract.

Code reads the same way. Cohesion is *what's together*; coupling is *what depends on what*.

---

## 3. The two metrics in code review

You don't compute cohesion and coupling numerically — you *spot* them.

**Cohesion smell:** *And* in the class name. `UserAndOrderService`, `EmailUtilsAndValidation`, `MiscHelpers`. Each `and` is a different reason to change.

**Coupling smell:** A change to class A's signature breaks ten unrelated test files. You opened up a Pandora's box because A was depended on by everyone.

```java
// Cohesion smell — every method serves a different concern
public class CustomerHandlerAndExporter {
    public void register(Customer c) { /* ... */ }
    public CSV exportAll()           { /* ... */ }
    public void notifyAll(String msg){ /* ... */ }
    public Stats lifetimeValue(Long id) { /* ... */ }
}

// Coupling smell — every caller forms a fragile chain
public void place(Cart cart) {
    OrderService.getInstance()
        .with(DB.get())
        .using(MailService.get())
        .check(Validator.get())
        .place(cart);
}
```

Both are diagnoseable in seconds. Both will cost a sprint each to clean up later.

---

## 4. A worked example — splitting a god service

```java
// Low cohesion + high coupling — typical "service" class in a junior codebase
public class OrderService {
    private final DbConnection db = DbConnection.create("jdbc:postgresql://...");
    private final SmtpClient mail = new SmtpClient("smtp.acme.com", 587);
    private final AmqpClient queue = new AmqpClient("amqp://...");

    public void placeOrder(Order order) {
        validate(order);                       // validation rules
        try (PreparedStatement st = db.prepare("INSERT INTO orders ...")) {
            /* JDBC code */                    // persistence
        }
        mail.send(order.email(), "Order received", "Thanks");   // notification
        queue.publish("orders.created", order.id());            // event publishing
        Files.writeString(Path.of("/var/log/audit.log"),
                          order.id() + "\n", APPEND);           // audit
    }

    private void validate(Order o) { /* ... */ }
}
```

This class does five things. Five reasons to change. Three hard-wired collaborators. To test it you need a database, an SMTP server, and a message queue.

**High-cohesion + low-coupling refactor:**

```java
public final class OrderPlacer {
    private final OrderValidator validator;
    private final OrderRepository repo;
    private final OrderNotifier notifier;
    private final DomainEvents events;
    private final AuditLog audit;

    public OrderPlacer(OrderValidator v, OrderRepository r, OrderNotifier n,
                       DomainEvents e, AuditLog a) {
        this.validator = v; this.repo = r; this.notifier = n;
        this.events = e; this.audit = a;
    }

    public void place(Order order) {
        validator.validate(order);
        repo.save(order);
        notifier.notify(order);
        events.publish(new OrderPlaced(order.id()));
        audit.record("orderPlaced", order.id().toString());
    }
}
```

Each collaborator is an *interface* the placer doesn't own. Each one can be swapped in a test. Each one changes for its own reason. The placer's job is *orchestration*, which is one reason to change.

The total line count went up. The cost of change went down. That's the trade you make every time.

---

## 5. Coupling types — a quick taxonomy

Software engineering literature names different coupling levels, worst-first:

- **Content coupling** — one module modifies the internals of another. Almost impossible in modern Java without reflection.
- **Common coupling** — modules share a global mutable state (`public static` fields). Avoid; very fragile.
- **External coupling** — modules share an external resource (a file format, a database schema, an API). Inherent; manage at boundaries.
- **Control coupling** — passing flags to control branching in another module (`process(order, true, false)`). Usually a SRP smell.
- **Stamp coupling** — passing a big object when only a field is needed. Inflates the API surface.
- **Data coupling** — passing exactly what's needed. The good shape.

You'll mostly meet data and stamp coupling in everyday code. The goal is to drift toward data; the smells of stamp and control are easy to spot.

---

## 6. Cohesion types — same exercise

Cohesion has its own ladder, worst-first:

- **Coincidental** — methods are in the same class for no reason. `Utils`, `Helpers`, `Misc`. Most painful.
- **Logical** — methods share a category but not a workflow (`StringFunctions` doing format, parse, validate, sanitize). Better than coincidental but still loose.
- **Temporal** — methods called at the same lifecycle moment (`startup()`, `shutdown()`). Acceptable for lifecycle classes.
- **Procedural** — methods participating in a sequence (`prepare`, `execute`, `cleanup`). Common in pipelines.
- **Communicational** — methods operate on the same data. Common in data-driven classes.
- **Sequential** — output of one is input of the next.
- **Functional** — every method contributes to a single, well-defined purpose. The ideal.

A class that calculates tax has *functional* cohesion. A class that "handles users" probably has *logical* — refactor it.

---

## 7. The two metrics relate — but they aren't the same

A class can be **highly cohesive** *and* **highly coupled**. Example: a `TaxCalculator` that's tightly focused (one job) but reaches into five other services to get input data. The class itself is cohesive; its dependency graph is heavy.

A class can be **low cohesion** *and* **low coupling**. Example: a `Utils` class with five unrelated static methods that takes no parameters from outside. Bad cohesion, fine coupling — but still bad code because future readers can't tell what it's for.

The two metrics are *independent forces*. You aim for *high cohesion + low coupling*. Optimize one without the other and you've solved half the problem.

---

## 8. Common newcomer mistakes

**Mistake 1: counting class sizes blindly.**

```java
public class TaxCalculator { /* 800 lines, all about tax */ }
```

This is fine. High cohesion = single purpose; the size is the size of the purpose. *Long* and *low-cohesion* are different smells.

**Mistake 2: extracting helpers to "reduce coupling".**

```java
public class OrderHelpers { /* now 1500 lines of "helpers" */ }
```

Moving methods out of `Order` into `OrderHelpers` doesn't reduce coupling — it just spreads it. `OrderHelpers` is the new coupling site. Real low coupling means *fewer cross-class calls*, not more files.

**Mistake 3: treating "no dependencies" as the goal.**

```java
public class OrderService {
    public void place(Order order) { /* hardcoded everything */ }
}
```

Zero dependencies — and impossible to test or evolve. The goal is *the right* dependencies, expressed as interfaces, injected at construction. Low coupling means *narrow, explicit, replaceable* — not *absent*.

**Mistake 4: confusing high cohesion with "one method per class".**

```java
public class OrderIdGenerator { public OrderId next() { /* ... */ } }
public class OrderValidator   { public void validate(Order o) { /* ... */ } }
public class OrderRepository  { public void save(Order o) { /* ... */ } }
// fine — each has one purpose
public class OrderTotalCalculator { public Money calc(Order o) { /* ... */ } }
// also fine — but if you split Order itself into OrderId + OrderTotal + OrderItems...
public class OrderId    { ... }
public class OrderTotal { ... }
public class OrderItems { ... }
// ...you've shattered cohesion. An order is one concept.
```

High cohesion isn't one-method-per-class; it's one-purpose-per-class. Sometimes the purpose has ten methods.

---

## 9. Quick rules

- [ ] Class name with `And`, `Misc`, `Helpers`, `Utils` → low cohesion. Split.
- [ ] One change in `A.java` forces edits in five unrelated files → high coupling. Decouple.
- [ ] Constructor with 8+ parameters → SRP/cohesion smell. The class does too many things.
- [ ] Static singletons reached via `getInstance()` → hidden coupling. Inject through constructor.
- [ ] Methods that don't share fields or call each other → low cohesion. Split.
- [ ] A class that survives "what is this for?" with a one-sentence answer is cohesive.
- [ ] If you can't unit-test a class without spinning up a database, coupling is too high.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Worked refactors: split low cohesion, inject coupling out   | `middle.md`        |
| Connascence, the seven levels of cohesion in depth          | `senior.md`        |
| Driving cohesion/coupling reviews across a team             | `professional.md`  |
| JLS access control, modules, package design                 | `specification.md` |
| Spotting hidden coupling and cohesion drift                 | `find-bug.md`      |
| Performance impact of indirection layers                    | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** cohesion is *what's together*; coupling is *what depends on what*. The rule is high cohesion + low coupling. Both are about *change cost*: cohesive code limits the surface that changes when one concept evolves; loosely coupled code limits the cascading effects across modules. They are independent forces — optimize both, not one.
