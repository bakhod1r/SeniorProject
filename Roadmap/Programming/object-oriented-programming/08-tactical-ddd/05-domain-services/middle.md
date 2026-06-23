# DDD Tactical: Domain Services — Middle

> **What?** Three different things in a typical layered application get called "service": **Domain Services**, **Application Services**, and **Infrastructure Services**. They sit in different layers, have different dependencies, and are written in different styles. Confusing them is the single most common DDD mistake on real projects — Vaughn Vernon devotes most of *IDDD* Chapter 7 to untangling them.
> **How?** For every "service" class you write, answer three questions: *which layer am I in?*, *what types appear in my signatures?*, and *do I manage transactions or external I/O?* The answers route the class into exactly one of the three buckets, and that bucket dictates how the class is named, where it lives, and what it may depend on.

---

## 1. Three services, three jobs

| Service kind   | Lives in       | Job                                                                       | Allowed dependencies                                  | Stateful? |
| -------------- | -------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- | --------- |
| Domain         | `domain`       | Domain logic that doesn't belong to a single Entity/VO.                   | Other domain types, domain-defined ports.             | No        |
| Application    | `application`  | Orchestrates a use case end-to-end: load, call domain, persist, notify.   | Domain types, domain services, repositories, ports.   | No        |
| Infrastructure | `infrastructure`| Wraps a piece of technology (JDBC, SMTP, S3, Kafka) behind a domain port. | Driver/SDK + the port interface it implements.        | Mostly no |

The dependency arrows point *inwards*: infrastructure depends on domain ports; application depends on domain (and on ports); domain depends on *nothing outside itself*. This is the hexagonal rule — Alistair Cockburn's "Ports and Adapters" — and Domain Services live deep inside the hexagon.

---

## 2. The same feature, three classes

Let's implement *international transfer*: move money between two accounts that may hold different currencies, applying an FX rate fetched from a third-party provider, then sending a confirmation email.

### 2.1 Domain Service — pure logic

```java
// domain/service/InternationalTransferService.java
public final class InternationalTransferService {

    private final ExchangeRatePolicy rates;          // domain-defined port

    public InternationalTransferService(ExchangeRatePolicy rates) {
        this.rates = rates;
    }

    public void transfer(Account from, Account to, Money amount) {
        if (!from.canWithdraw(amount)) {
            throw new InsufficientFundsException(from.id(), amount);
        }
        Money converted = rates.convert(amount, to.currency());
        from.withdraw(amount);
        to.deposit(converted);
    }
}
```

Notes:

- The constructor takes an `ExchangeRatePolicy`, but that's an *interface defined in the domain*, not a `RestTemplate`. The domain knows it needs an FX rate; it doesn't know HTTP exists.
- Signature uses `Account` and `Money` — domain types.
- No transactions, no logging, no email.

### 2.2 Application Service — orchestration

```java
// application/InternationalTransferUseCase.java
public final class InternationalTransferUseCase {

    private final AccountRepository accounts;
    private final InternationalTransferService transfers;
    private final NotificationPort notifications;

    public InternationalTransferUseCase(AccountRepository accounts,
                                        InternationalTransferService transfers,
                                        NotificationPort notifications) {
        this.accounts = accounts;
        this.transfers = transfers;
        this.notifications = notifications;
    }

    @Transactional
    public void execute(AccountId fromId, AccountId toId, Money amount) {
        Account from = accounts.findById(fromId).orElseThrow();
        Account to   = accounts.findById(toId).orElseThrow();

        transfers.transfer(from, to, amount);

        accounts.save(from);
        accounts.save(to);

        notifications.notifyTransfer(from.id(), to.id(), amount);
    }
}
```

Notes:

- `@Transactional` sits *here*, at the use-case boundary. The domain doesn't know about transactions.
- It loads aggregates by id, calls the domain service, then persists. Vernon calls this pattern "the thin application service".
- It coordinates *side effects* (email) but does not implement them.

### 2.3 Infrastructure Service — adapter

```java
// infrastructure/fx/HttpExchangeRateAdapter.java
@Component
public final class HttpExchangeRateAdapter implements ExchangeRatePolicy {

    private final RestClient http;

    public HttpExchangeRateAdapter(RestClient http) {
        this.http = http;
    }

    @Override
    public Money convert(Money amount, Currency target) {
        BigDecimal rate = http.get()
            .uri("/rates?from={f}&to={t}", amount.currency(), target)
            .retrieve()
            .body(BigDecimal.class);
        return new Money(amount.value().multiply(rate), target);
    }
}
```

Notes:

- Implements a *domain-defined* port (`ExchangeRatePolicy`).
- Returns a domain type (`Money`), not a `RatesResponseDto`. The mapping is the adapter's job.
- All HTTP, retry, deserialization concerns live *here*, never leaking into the domain.

---

## 3. Naming: capability first, never `Manager`

Avoid words that mean nothing: `Manager`, `Helper`, `Util`, `Processor`. They describe code, not domain language. Vernon (*IDDD* p. 263) recommends names that *belong in the conversation between developers and domain experts* — the Ubiquitous Language.

Compare:

| Vague                  | Better (capability-named)        |
| ---------------------- | -------------------------------- |
| `AccountManager`       | `TransferService`                |
| `OrderHelper`          | `OrderPricingService`            |
| `PaymentProcessor`     | `PaymentAuthorizationService`    |
| `CustomerUtil`         | `CustomerLoyaltyService`         |
| `InvoiceService` (anaemic dumping ground) | `InvoiceTotalCalculator`, `InvoiceDispatchService` |

A name should make the *capability* readable in a sentence: "Use `TransferService` to transfer money", not "Use `AccountManager` to manage accounts".

---

## 4. Statelessness is non-negotiable

A Domain Service has *no mutable state*. None. Constructor-injected dependencies (the FX policy above) are fine — they're not "state" in the sense that matters, because they're set once and never change.

The reason: a Domain Service is conceptually a *function*. Two invocations with the same inputs must behave the same way (modulo what the injected ports do). If the service has a mutable counter, a cache, a "last result", you've created an entity in disguise — and you've created a concurrency hazard, because services are typically singletons shared by many threads.

```java
// WRONG — mutable field
public final class PricingService {
    private BigDecimal lastTotal;   // not OK

    public BigDecimal price(Basket b) {
        lastTotal = b.lines().stream().map(Line::amount).reduce(...);
        return lastTotal;
    }
}
```

Two threads sharing this singleton will corrupt `lastTotal`. The fix is trivial: don't store it. If a caller wants the result, return it.

If you genuinely need caching, push it behind a *port* (`PricingCache`) whose implementation is in infrastructure — keep the domain service stateless.

---

## 5. Dependencies — only domain abstractions

A Domain Service depends only on:

- Other domain types (entities, value objects).
- Interfaces defined *inside the domain* — the ports the domain owns.

It must not depend on:

- `org.springframework.*` (except possibly `@Service` if you accept that level of leakage — many teams put the annotation only on the application service).
- `javax.persistence.*` / `jakarta.persistence.*`.
- `java.sql.*`, `java.net.http.*`, anything I/O.
- Concrete adapter classes from `infrastructure/`.

The litmus test: *Could I run this Domain Service in a unit test with zero frameworks and zero `@SpringBootTest`?* If not, something has leaked in.

---

## 6. A worked refactor

You're handed this class:

```java
@Service
public class TransferManager {

    @Autowired private JdbcTemplate jdbc;
    @Autowired private JavaMailSender mail;

    @Transactional
    public void transfer(Long fromId, Long toId, BigDecimal amount) {
        BigDecimal fromBal = jdbc.queryForObject("SELECT balance FROM accounts WHERE id = ?",
            BigDecimal.class, fromId);
        if (fromBal.compareTo(amount) < 0) {
            throw new RuntimeException("insufficient");
        }
        jdbc.update("UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, fromId);
        jdbc.update("UPDATE accounts SET balance = balance + ? WHERE id = ?", amount, toId);
        mail.send(buildConfirmation(fromId, toId, amount));
    }
}
```

It's *one* class doing three jobs. Refactored:

- **Domain Service** `TransferService` — `transfer(Account, Account, Money)`, no SQL, no email.
- **Application Service** `TransferUseCase` — `@Transactional`, loads via repository, calls `TransferService`, saves, fires notification.
- **Infrastructure** — `JpaAccountRepository implements AccountRepository`; `SmtpNotificationAdapter implements NotificationPort`.

The Domain Service now has *zero* framework dependencies. It is unit-testable in milliseconds, expressible in the Ubiquitous Language, and reusable across any application service that needs to move money (a daily batch transfer, a scheduled payroll run, a manual operator override).

---

## 7. When the boundary blurs

Some classes feel like they could go either way. Heuristics:

- **It loads or saves data → Application Service.** Domain Services don't talk to repositories directly. They receive already-loaded aggregates.
- **It sends an email, calls an external API, writes a file → either Application or Infrastructure.** Never Domain.
- **It enforces a domain invariant or computes a domain quantity → Domain Service** (or, better, an Entity/VO method if there's a clear owner).
- **It coordinates *multiple* domain calls within a single business transaction → Application Service.**

When in doubt, sketch the call graph on paper. The arrow always points *into* the domain, never out of it.

---

## 8. Quick rules

- [ ] Three layers, three kinds of "service" — name them differently in your head.
- [ ] Domain Service: no transactions, no I/O, no DTOs, only domain types and domain ports.
- [ ] Application Service: thin, transactional, orchestrates loads/saves/notifications.
- [ ] Infrastructure Service: implements a domain port using a specific technology.
- [ ] If your "service" has a mutable field, it's not a service.
- [ ] If your "service" name ends in `Manager`/`Helper`/`Util`, rename it after a capability.

---

## 9. What's next

| Topic                                                            | File               |
| ---------------------------------------------------------------- | ------------------ |
| When to extract a Domain Service; anaemic-model trap             | `senior.md`        |
| Spring `@Service`, hexagonal, transactions, sagas, idempotency   | `professional.md`  |
| Formal contract                                                  | `specification.md` |
| Buggy services and fixes                                         | `find-bug.md`      |
| Performance angles                                               | `optimize.md`      |
| Exercises                                                        | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

Related: [`../02-entities/`](../02-entities/), [`../03-aggregates/`](../03-aggregates/), [`../04-repository-concept/`](../04-repository-concept/).

---

**Memorize this:** Domain Services *think*, Application Services *coordinate*, Infrastructure Services *talk to the outside*. The three never share a class. The Domain Service's signatures contain only domain types and never the words `@Transactional`, `JdbcTemplate`, or `RestClient`. Get those two rules right and the rest of the layering falls into place.
