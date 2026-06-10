# DDD Tactical: Domain Services — Find the Bug

> **What?** Ten scenarios drawn from real production Domain Services that *look* fine on first read and *fail* in subtle ways once you understand the contract. Each scenario contains the broken code, a diagnosis tied to one of the five specification properties (statelessness, naming, signatures, persistence-free, transport-free), and a minimal fix. The bugs cover both behavioural defects (the service computes the wrong thing) and architectural defects (the service violates layering and creates long-range trouble).
> **How?** Read each snippet, write down what you think is wrong, then read the diagnosis. The goal is to develop pattern recognition — these ten archetypes cover ~80% of the Domain Service bugs you will see in code review.

---

## Bug 1 — Service that mutates passed entities by direct field access

```java
public final class DiscountService {
    public void applyDiscount(Order order, BigDecimal percent) {
        for (LineItem line : order.lines()) {
            line.price = line.price.multiply(BigDecimal.ONE.subtract(percent));
        }
    }
}
```

**Diagnosis.** The service reaches into `LineItem` and mutates its `price` field directly. Even if `price` happens to be package-private and the access compiles, the entity is the guardian of its own invariants — bypassing its methods means no validation, no audit, no domain event. The service has effectively turned `LineItem` into a data carrier (anaemic model). This violates Property 3 morally even though it compiles.

**Fix.** Give the entity a method, let the service ask:

```java
public final class LineItem {
    public void applyDiscount(BigDecimal percent) {
        if (percent.signum() < 0 || percent.compareTo(BigDecimal.ONE) > 0) {
            throw new IllegalArgumentException("percent out of [0,1]");
        }
        this.price = price.multiply(BigDecimal.ONE.subtract(percent));
    }
}

public final class DiscountService {
    public void applyDiscount(Order order, BigDecimal percent) {
        order.lines().forEach(line -> line.applyDiscount(percent));
    }
}
```

---

## Bug 2 — Leaking JDBC into the Domain Service

```java
public final class TransferService {
    private final JdbcTemplate jdbc;

    public TransferService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void transfer(Long fromId, Long toId, BigDecimal amount) {
        jdbc.update("UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, fromId);
        jdbc.update("UPDATE accounts SET balance = balance + ? WHERE id = ?", amount, toId);
    }
}
```

**Diagnosis.** Violates Property 4 (no persistence) outright. The "service" is really a persistence adapter pretending to be domain logic. It bypasses all aggregate invariants — overdraft checks, currency mismatches, frozen-account rules — because the SQL goes straight to the table. It is also not idempotent and not testable without a database.

**Fix.** Move SQL behind a repository port, restore behaviour to entities:

```java
public final class TransferService {
    public void transfer(Account from, Account to, Money amount) {
        from.withdraw(amount);
        to.deposit(amount);
    }
}
```

The application service loads the aggregates via `AccountRepository` and persists after the call.

---

## Bug 3 — Stateful "service" with a mutable field

```java
public final class PricingService {
    private Money lastPrice;            // mutable

    public Money price(Basket basket) {
        Money total = basket.lines().stream()
            .map(Line::amount)
            .reduce(Money.zero(basket.currency()), Money::plus);
        this.lastPrice = total;
        return total;
    }

    public Money getLastPrice() { return lastPrice; }
}
```

**Diagnosis.** Violates Property 1 (statelessness). Two threads sharing this singleton corrupt each other's `lastPrice`. The "feature" of remembering the last price is not the service's job — if a caller wants to remember the result, the caller stores it.

**Fix.** Drop the field. Return the value, end of story.

```java
public final class PricingService {
    public Money price(Basket basket) {
        return basket.lines().stream()
            .map(Line::amount)
            .reduce(Money.zero(basket.currency()), Money::plus);
    }
}
```

---

## Bug 4 — Service replacing entity behaviour (anaemic model)

```java
public class Account {
    public BigDecimal balance;
    public Currency currency;
}

public final class AccountService {
    public void withdraw(Account a, BigDecimal amount) {
        if (a.balance.compareTo(amount) < 0) {
            throw new IllegalStateException("insufficient");
        }
        a.balance = a.balance.subtract(amount);
    }
    public void deposit(Account a, BigDecimal amount) {
        a.balance = a.balance.add(amount);
    }
}
```

**Diagnosis.** Classic anaemic domain model (Fowler, 2003). `Account` is a public-field bag; `AccountService` does all the work. Any caller can write `account.balance = ...` and bypass every rule. This is the *opposite* of what a Domain Service is for.

**Fix.** Move behaviour onto `Account`; drop the service entirely.

```java
public final class Account {
    private Money balance;
    public void withdraw(Money amount) {
        if (balance.lessThan(amount)) throw new InsufficientFundsException(id, amount);
        this.balance = balance.minus(amount);
    }
    public void deposit(Money amount) { this.balance = balance.plus(amount); }
}
```

A `TransferService` for moving between two accounts remains legitimate; per-account operations do not.

---

## Bug 5 — Missing transaction boundary

```java
// Application service
public void execute(AccountId fromId, AccountId toId, Money amount) {
    Account from = accounts.findById(fromId).orElseThrow();
    Account to   = accounts.findById(toId).orElseThrow();
    transferService.transfer(from, to, amount);
    accounts.save(from);
    accounts.save(to);
}
```

**Diagnosis.** No `@Transactional`. If `accounts.save(to)` throws (constraint violation, broker outage), the first save has already committed and money has vanished. Not a Domain Service bug per se — the service is fine — but a *use of* the service that ignores transactional context.

**Fix.** Wrap the application call.

```java
@Transactional
public void execute(AccountId fromId, AccountId toId, Money amount) { ... }
```

The transaction lives at the application boundary, never inside `TransferService`.

---

## Bug 6 — Spring `@Transactional` on the Domain Service

```java
@Service
public final class TransferService {

    @Transactional   // ← in the domain layer
    public void transfer(Account from, Account to, Money amount) {
        from.withdraw(amount);
        to.deposit(amount);
    }
}
```

**Diagnosis.** Violates Property 5 morally — the domain now knows transactions exist — and creates fragmenting transaction scopes. Worse, `@Transactional` on a self-injected method does nothing through Spring AOP unless the call comes from outside the class, which is a famous source of "but I added `@Transactional` and it still doesn't roll back" bugs.

**Fix.** Remove the annotation; put it on the application service.

---

## Bug 7 — Returning a DTO from the Domain Service

```java
public final class QuoteService {
    public QuoteResponseDto quote(Basket basket) {
        Money total = ...;
        return new QuoteResponseDto(total.value(), total.currency().getCurrencyCode(),
                                    Instant.now().toString());
    }
}
```

**Diagnosis.** Violates Property 3. `QuoteResponseDto` is a transport type. The domain has no business knowing the wire shape. Worse, the service now embeds `Instant.now()` inline — non-deterministic, non-testable.

**Fix.** Return a domain value; let the application/web layer map.

```java
public final class QuoteService {
    public Quote quote(Basket basket, Clock clock) {
        return new Quote(totalOf(basket), clock.instant());
    }
}
```

`Quote` is a domain value object; `Clock` is the standard dependency-injectable time source.

---

## Bug 8 — Using `@Autowired` field injection inside the Domain Service

```java
@Service
public class RoutingService {
    @Autowired private GraphRepository graphs;
    @Autowired private TollPolicy tolls;

    public Route route(Address from, Address to) { ... }
}
```

**Diagnosis.** Two problems. First, field injection blocks `final` and hides dependencies — the class cannot be constructed in a unit test without reflection or a Spring container, violating the spirit of Property 5. Second, the class is mutable in principle (the fields could be reassigned via reflection or by Spring during refresh), which collides with Property 1.

**Fix.** Constructor injection with `final`:

```java
public final class RoutingService {
    private final GraphRepository graphs;
    private final TollPolicy tolls;

    public RoutingService(GraphRepository graphs, TollPolicy tolls) {
        this.graphs = graphs;
        this.tolls = tolls;
    }

    public Route route(Address from, Address to) { ... }
}
```

---

## Bug 9 — Calling another bounded context's REST API directly

```java
public final class OrderConfirmationService {
    private final RestClient inventoryApi;

    public void confirm(Order order) {
        for (LineItem line : order.lines()) {
            inventoryApi.post().uri("/reserve")
                .body(Map.of("sku", line.sku(), "qty", line.qty()))
                .retrieve().toBodilessEntity();
        }
        order.confirm();
    }
}
```

**Diagnosis.** Violates Properties 4 and 5. The domain service is performing HTTP calls and inlining wire shapes. Cross-context coordination belongs in an Application Service or a saga, behind a port.

**Fix.** Introduce a domain port and an infrastructure adapter:

```java
// domain
public interface InventoryReservationGateway {
    void reserve(Sku sku, Quantity qty);
}

// domain
public final class OrderConfirmationService {
    private final InventoryReservationGateway inventory;

    public OrderConfirmationService(InventoryReservationGateway inventory) {
        this.inventory = inventory;
    }

    public void confirm(Order order) {
        order.lines().forEach(l -> inventory.reserve(l.sku(), l.qty()));
        order.confirm();
    }
}

// infrastructure
@Component
public final class HttpInventoryReservationAdapter implements InventoryReservationGateway {
    private final RestClient client;
    @Override public void reserve(Sku sku, Quantity qty) { ... }
}
```

The domain now coordinates conceptually with inventory; how that coordination happens (HTTP, Kafka, in-process) is an adapter decision.

---

## Bug 10 — Service that secretly depends on `Instant.now()`

```java
public final class InterestAccrualService {
    public Money accrue(Account a, InterestRate rate) {
        LocalDate today = LocalDate.now();          // hidden dependency
        long days = ChronoUnit.DAYS.between(a.lastAccrualDate(), today);
        return rate.over(a.balance(), days);
    }
}
```

**Diagnosis.** The service is *not* a pure function of its arguments — it secretly depends on the system clock. Tests are flaky, time-travel scenarios impossible, and any retry behaves differently each time. The violation is of determinism (Property 1 in spirit) plus untestability.

**Fix.** Inject a `Clock`:

```java
public final class InterestAccrualService {
    private final Clock clock;

    public InterestAccrualService(Clock clock) { this.clock = clock; }

    public Money accrue(Account a, InterestRate rate) {
        LocalDate today = LocalDate.now(clock);
        long days = ChronoUnit.DAYS.between(a.lastAccrualDate(), today);
        return rate.over(a.balance(), days);
    }
}
```

In production, wire `Clock.systemUTC()`; in tests, wire `Clock.fixed(...)`. The same applies to random number generators, UUID generators, and any other hidden source of non-determinism.

---

## Pattern recap

| Bug                                          | Property violated     | Detection heuristic                                |
| -------------------------------------------- | --------------------- | -------------------------------------------------- |
| 1. Direct field mutation through entity      | Naming / cohesion     | Service writes to entity fields                    |
| 2. JDBC in service                           | No persistence        | Imports `javax.sql.*`, `JdbcTemplate`              |
| 3. Mutable field                             | Statelessness         | Non-`final` instance field                         |
| 4. Anaemic model                             | Naming / cohesion     | Entity has public fields, service does all work    |
| 5. Missing `@Transactional` at boundary      | (Caller bug)          | App service loads/saves without transaction        |
| 6. `@Transactional` on domain service        | No transport leakage  | Annotation in `domain/`                            |
| 7. DTO return type                           | Domain-typed signature| `*Dto` in `domain/` signature                      |
| 8. Field injection                           | Statelessness / DI    | `@Autowired` on field                              |
| 9. Direct HTTP in service                    | No persistence/transport | `RestClient`/`WebClient` in domain               |
| 10. Hidden `LocalDate.now()` / `UUID.randomUUID()` | Determinism      | Direct static call to a non-deterministic source   |

Run a static-analysis scan for these patterns in `domain/service/` packages. Most are mechanically detectable.

---

**Related sections.** Entity-design failures are addressed in [`../02-entities/find-bug.md`](../02-entities/find-bug.md); aggregate-boundary failures in [`../03-aggregates/find-bug.md`](../03-aggregates/find-bug.md); repository contract failures in [`../04-repository-concept/find-bug.md`](../04-repository-concept/find-bug.md).
