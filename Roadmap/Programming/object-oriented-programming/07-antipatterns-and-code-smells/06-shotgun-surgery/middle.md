# Shotgun Surgery — Middle

> **What?** Why Shotgun Surgery emerges, four worked refactors against real domains (pricing, audit, validation, persistence), and the three Fowler moves that actually fix it: **Move Method**, **Inline Class**, and **Extract Class**. The middle level is where you stop *recognising* the smell and start *removing* it.
> **How?** Each section walks through one cluster of scattered code, names the root cause, and applies the smallest refactor that pulls the scattered logic into one cohesive unit — without producing a new god class.

---

## 1. The four causes worth knowing

Shotgun Surgery is a *symptom*. To remove it, you need to recognise which of these underlying patterns produced it. Almost every real case in a Java codebase falls into one (or a mix) of:

1. **Scattered responsibility.** A concept (currency, status, tenant) has no owner. Each caller re-implements a small piece of it. Add a variant → edit every caller.
2. **Copy-paste of behaviour.** A snippet of logic — regex, format string, validation — was duplicated rather than extracted. Each change of the rule has to chase every copy.
3. **Missing abstraction.** Two or three implementations exist in the same shape, but no interface or base type names the shared role. A new implementation forces N call-site edits.
4. **Leaky data shape.** A data structure exposes its fields, and dozens of clients do their own thing with those fields. Add a field → every client edits.

These four blur into each other in practice. The refactor moves that fix them are mostly the same — Fowler's *Move Method*, *Inline Class*, *Extract Class*, plus *Replace Conditional with Polymorphism* and *Replace Type Code with Subclass* (now usually a sealed type).

---

## 2. Cause 1 — Scattered responsibility (pricing across services)

A retail backend has four services that each need pricing rules: cart, order, invoice, refund. Each was written by a different person at a different time. None owns the concept of "price".

```java
// File: CartCalculator.java
BigDecimal price = item.basePrice();
if (item.onSale()) price = price.multiply(new BigDecimal("0.85"));
if (customer.isLoyalty()) price = price.multiply(new BigDecimal("0.95"));

// File: OrderTotaller.java
BigDecimal price = item.basePrice();
if (item.onSale()) price = price.multiply(new BigDecimal("0.85"));
if (customer.isLoyalty()) price = price.multiply(new BigDecimal("0.95"));

// File: InvoiceLineItem.java
BigDecimal price = item.basePrice();
if (item.onSale()) price = price.multiply(new BigDecimal("0.85"));
if (customer.isLoyalty()) price = price.multiply(new BigDecimal("0.95"));

// File: RefundCalculator.java
BigDecimal price = item.basePrice();
if (item.onSale()) price = price.multiply(new BigDecimal("0.85"));
// — and this one forgot loyalty entirely
```

A new "VIP" discount means editing four files. One of them already disagreed with the others. That last bug existed for nine months.

The smell is *scattered responsibility*: pricing is a concept, but it has no owner. The refactor is **Extract Class** plus **Move Method**:

```java
public final class PriceCalculator {
    public BigDecimal priceFor(Item item, Customer customer) {
        BigDecimal price = item.basePrice();
        if (item.onSale())           price = price.multiply(new BigDecimal("0.85"));
        if (customer.isLoyalty())    price = price.multiply(new BigDecimal("0.95"));
        return price;
    }
}
```

Every caller now reads:

```java
BigDecimal price = priceCalculator.priceFor(item, customer);
```

Adding "VIP" edits exactly one file. The drift bug becomes impossible because there is no second copy to drift against. Note the move was *minimal* — we extracted a class, not an abstraction hierarchy. Generalise only when the second variant arrives.

---

## 3. Cause 2 — Copy-paste of behaviour (validation rules)

A REST service validates user input in three layers — controller, service, repository — "for defence in depth". Each layer copy-pasted the same regex.

```java
// UserController.java
if (!email.matches("^[A-Za-z0-9+_.-]+@(.+)$")) throw new BadRequest();

// UserService.java
if (!user.email().matches("^[A-Za-z0-9+_.-]+@(.+)$")) throw new IllegalArgumentException();

// UserRepository.java
public void insert(User u) {
    if (!u.email().matches("^[A-Za-z0-9+_.-]+@(.+)$")) throw new DataException();
    /* INSERT ... */
}
```

Security wants to tighten the regex. There are now three regex strings to find, plus six tests that hard-coded the old one, plus a JavaScript client that has its own copy. The "defence" was theatrical — each layer pretended to validate but in fact shared the same brittle constant.

The refactor is **Extract Class** plus **Move Method** onto a value type:

```java
public record Email(String value) {
    private static final Pattern RFC = Pattern.compile("^[A-Za-z0-9+_.-]+@(.+)$");
    public Email {
        Objects.requireNonNull(value);
        if (!RFC.matcher(value).matches())
            throw new IllegalArgumentException("invalid email: " + value);
    }
}
```

Now every layer accepts `Email`, not `String`. Construction is the only place the regex appears. Tightening the rule edits one file. The compiler enforces that no one accidentally smuggles in a raw `String` past validation — see [`../09-primitive-obsession/`](../09-primitive-obsession/) for the dual smell.

This is the most repeatable cure for Shotgun Surgery in the Java ecosystem: **wrap the primitive in a type and put the rule in the constructor**. Anywhere you find the same regex, the same length check, the same range — there is a type wanting to be born.

---

## 4. Cause 3 — Missing abstraction (audit logging)

Every domain operation needs an audit entry. The pattern is everywhere:

```java
// PlaceOrderHandler.java
auditLog.write("order.placed", Map.of("orderId", o.id(), "user", u.id(), "at", clock.now()));

// CancelOrderHandler.java
auditLog.write("order.cancelled", Map.of("orderId", o.id(), "user", u.id(), "at", clock.now()));

// RefundOrderHandler.java
auditLog.write("order.refunded", Map.of("orderId", o.id(), "user", u.id(), "at", clock.now()));
```

Compliance wants to add `tenantId` and `requestId` to every audit entry. That is N edits across all handlers, all tests, and the front-end logging proxy. Forget any one and the audit trail is broken — which compliance will discover during a quarterly review.

The missing abstraction here is "an audit event for an order". Each handler is hand-rolling the same shape. The refactor is **Extract Class** for the event, plus a *single chokepoint* for writing it:

```java
public sealed interface OrderEvent {
    long orderId();
    long userId();
    Instant at();
    String tenantId();
    String requestId();
}
public record OrderPlaced   (long orderId, long userId, Instant at, String tenantId, String requestId) implements OrderEvent {}
public record OrderCancelled(long orderId, long userId, Instant at, String tenantId, String requestId) implements OrderEvent {}
public record OrderRefunded (long orderId, long userId, Instant at, String tenantId, String requestId) implements OrderEvent {}

public final class OrderAuditor {
    private final AuditLog log;
    public void record(OrderEvent e) {
        log.write(typeOf(e), Map.of(
            "orderId",   e.orderId(),
            "user",      e.userId(),
            "at",        e.at(),
            "tenantId",  e.tenantId(),
            "requestId", e.requestId()));
    }
    private static String typeOf(OrderEvent e) {
        return switch (e) {
            case OrderPlaced p    -> "order.placed";
            case OrderCancelled c -> "order.cancelled";
            case OrderRefunded r  -> "order.refunded";
        };
    }
}
```

Adding `correlationId` is one edit on the sealed parent. The exhaustive switch is OCP-friendly — the compiler tells you exactly which records to update. Handlers no longer touch `Map.of(...)` at all:

```java
auditor.record(new OrderPlaced(o.id(), u.id(), clock.now(), tenant, requestId));
```

This is *Replace Conditional with Polymorphism* in modern Java clothing. The sealed type names the role, the records carry the data, the auditor owns the format. Three Fowler moves — Extract Class, Move Method, Replace Conditional with Polymorphism — fold into one coherent shape.

---

## 5. Cause 4 — Leaky data shape (DTO field sprawl)

A monolith has a `User` JPA entity and a parallel `UserDto` for the API. Each new field — `phone`, `timezone`, `mfaEnabled`, `lastLogin` — appears in:

- the entity
- the DTO
- the mapper (`entity → dto` and `dto → entity`)
- the JSON schema / OpenAPI spec
- the database migration
- the integration test fixtures
- the front-end TypeScript model

Seven places per field. Adding three fields in one ticket means 21 edits, and at least one of them will be missed. Fowler calls this *Data Class* feeding *Shotgun Surgery*; the modern variant is *DTO sprawl*.

The honest fix is structural: **stop hand-coding the mapping**. The mapping itself is duplicated logic, and every field in the system is an instance of the duplication. Two realistic options:

1. **Reflective mapping** (MapStruct, ModelMapper) generates the mapper from the field list. Adding a field stops triggering hand-edits in the mapper — *some* of the surgery vanishes.
2. **Collapse the boundary**. If the entity and DTO carry the same fields and the DTO is just "the entity with the password removed", you don't need two types. Use one type with a JSON view, or use a record projection.

```java
@Entity
public class User {
    @Id long id;
    String email, name, phone, timezone;
    boolean mfaEnabled;
    Instant lastLogin;
    @JsonIgnore String passwordHash;       // the only real difference
}
```

Now adding `locale` is one edit on the entity, one on the migration, one on the front end. Three places, not seven. The remaining three places are not Shotgun Surgery — they are the legitimate cost of crossing a real boundary (database, API contract, foreign language).

The rule of thumb: **Shotgun Surgery on data shapes is solved by removing fake boundaries, not by adding mapping cleverness.**

---

## 6. The three Fowler moves, in order

When you decide to attack a Shotgun Surgery cluster, the order matters.

### Step 1 — Move Method

Find the scattered behaviour. For each piece, identify which data it operates on. *Move the method to that data*. This is the cheapest move because it doesn't introduce new types. Often it eliminates the smell on its own.

```java
// Before — switch lives outside the enum
String description(Status s) {
    return switch (s) {
        case OPEN -> "still going";
        case CLOSED -> "done";
        case CANCELLED -> "abandoned";
    };
}

// After — behaviour lives on the enum
public enum Status {
    OPEN("still going"),
    CLOSED("done"),
    CANCELLED("abandoned");
    private final String description;
    Status(String d) { this.description = d; }
    public String description() { return description; }
}
```

Any other `switch (Status)` in the codebase can now be replaced with `status.description()`. The shotgun has fewer barrels.

### Step 2 — Inline Class

After moving methods, you sometimes find a helper class that no longer holds anything interesting — three one-line delegations. Inline it. A class that just forwards is friction without benefit.

```java
// Before
public class CurrencyFormatter {
    public String format(BigDecimal a, Currency c) { return c.format(a); }
}

// After — inline the only callsite
formatter.format(amount, currency);  →  currency.format(amount);
```

### Step 3 — Extract Class

When the *Move Method* targets don't yet exist — when there is no `Currency` class, only a `Currency` enum and a pile of switches — *Extract Class* first, then move. This is the most common starting point.

```java
// Before — concept has no home, behaviour is scattered
enum Currency { USD, EUR }
// switches in MoneyFormatter, TaxCalculator, ExchangeRateClient

// After — concept owns its behaviour
public interface Currency {
    String format(BigDecimal amount);
    BigDecimal vatRate();
    BigDecimal exchangeRateToBase();
}
public final class USD implements Currency { /* ... */ }
public final class EUR implements Currency { /* ... */ }
```

The order is: **extract a home → move methods into it → inline the helpers that became trivial**. That is *the* refactor against Shotgun Surgery. Everything else is a variation.

---

## 7. When not to consolidate

Shotgun Surgery is a smell, not a rule. Not every cluster of co-changing files is a problem to refactor away.

- **Real boundaries.** A change that crosses a microservice boundary (deploying a producer and a consumer together) is not Shotgun Surgery — it is the cost of distribution.
- **Cross-cutting concerns done right.** Logging and metrics often touch many places because they *are* everywhere. AOP, decorators, or middleware can reduce the surface area; don't try to "gather" them into one class.
- **Tests of behaviour at multiple levels.** A change in a domain rule legitimately changes the unit test, the integration test, and the contract test. That is the testing pyramid working, not Shotgun Surgery.
- **Configuration in multiple environments.** Bumping a version may legitimately touch dev, staging, and prod configs. That is governance, not a smell.

The bar is: *does the same conceptual change land in N places* with *no clear owner for the concept*? If yes, refactor. If the N places are different bounded contexts each with a legitimate stake, leave them alone.

---

## 8. Quick rules

- [ ] **Move Method onto the data first** — most shotgun clusters collapse before you need a new class.
- [ ] **Extract Class only when no home exists** — don't manufacture homes for behaviour that already has one.
- [ ] **Wrap primitives in types when validation is duplicated** — the rule moves into the constructor.
- [ ] **Use sealed types for closed sets of variants** — exhaustive switch becomes a compile-time checklist.
- [ ] **Inline trivial helpers after moving** — pass-through classes are residue, not architecture.

---

## 9. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Git churn / temporal coupling, Strategy/Visitor cures            | `senior.md`        |
| Event-driven amplifiers, microservice versioning                 | `professional.md`  |
| Change-coupling metrics, CodeScene, mining co-changes            | `specification.md` |
| Ten scattered-change scenarios diagnosed and fixed               | `find-bug.md`      |
| Build/CI/test cost of shotgun changes                            | `optimize.md`      |
| Eight hands-on exercises                                         | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

---

**Memorize this:** The cure for Shotgun Surgery is always *gathering* — Extract Class for the missing home, Move Method to put behaviour next to data, Inline Class for the helpers that go quiet. Apply the moves in that order, refactor on the second occurrence, and stop before you build a god class on the other side.
