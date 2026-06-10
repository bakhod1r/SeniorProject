# DDD Tactical: Domain Services — Specification

> **What?** A precise contract for what makes a class a *Domain Service* in the sense intended by Eric Evans (*Domain-Driven Design*, 2003, Chapter 5) and refined by Vaughn Vernon (*Implementing Domain-Driven Design*, 2013, Chapter 7). The specification fixes five non-negotiable properties — statelessness, capability naming, domain-typed signatures, no persistence, no UI/transport concerns — and turns them into testable invariants that a code reviewer or static-analysis check can verify.
> **How?** Treat each property as a *necessary condition*. A class missing any one is not a Domain Service. Use the property list as the checklist on every code review where a `*Service`, `*Policy`, or `*Pricer` lands in the `domain/` package.

---

## 1. The five defining properties

A class `S` is a **Domain Service** if and only if all five of the following hold:

1. **Stateless** — `S` declares no mutable instance fields. All non-static fields are `final` and refer to other domain types or to ports declared in the domain layer.
2. **Capability-named** — `S`'s name denotes a *verb-shaped* domain capability (`TransferService`, `PricingService`, `RoutingService`, `LoyaltyDiscountPolicy`). Names that denote *data* (`OrderManager`, `AccountHelper`, `CustomerUtil`) are forbidden.
3. **Domain-typed signatures** — Every parameter and return type of every public method of `S` is a domain type (Entity, Value Object, Domain Event, domain primitive) or a Java collection thereof. Framework types, DTOs, transport types, and SQL/JDBC types are forbidden in the signature.
4. **No persistence** — `S` performs no read or write to a database, file system, message broker, or remote service directly. It may depend on a *repository or gateway interface defined in the domain*, but never on a concrete implementation of such an interface.
5. **No UI / no transport** — `S` is unaware of any user interface, HTTP, RPC, GraphQL, CLI, scheduling framework, or other delivery mechanism. It contains no annotations, types, or strings that reveal how it is invoked.

A class that satisfies four of the five is *not* a Domain Service — it is something else (an Application Service, an Infrastructure adapter, an Entity, or a misnamed god class). Apply the all-or-nothing rule strictly.

---

## 2. Property 1 — Stateless

Formally: for any two threads `T1` and `T2` calling any sequence of methods on the *same instance* of `S`, the observable result depends only on (a) the arguments each thread passes and (b) the state of the *passed-in domain objects* and *injected ports*, never on prior calls to `S`.

Permitted fields:

```java
public final class TransferService {
    private final ExchangeRatePolicy rates;          // OK: final, port
    private final OverdraftPolicy overdraft;         // OK: final, port
    private final Clock clock;                       // OK: final, dependency
}
```

Forbidden fields:

```java
public final class TransferService {
    private BigDecimal lastAmount;                   // FAIL: mutable
    private List<Transfer> recent = new ArrayList<>();// FAIL: mutable, shared
    private static int counter;                      // FAIL: mutable static
    private ThreadLocal<Account> current;            // FAIL: hidden state
}
```

Compiler-enforceable check: every non-static field must be `final` and must not refer to a mutable container.

---

## 3. Property 2 — Capability-named

The class name denotes the *capability* the service exposes, expressible as a sentence in the Ubiquitous Language. Acceptable forms:

- `*Service` — a generic capability container (`TransferService`).
- `*Policy` — a polymorphic strategy (`ShippingCostPolicy`).
- `*Strategy` — synonymous with `*Policy`; pick one per bounded context.
- A capability noun derived from the verb (`Pricer`, `Router`, `Discounter`).

Forbidden forms:

- `*Manager`, `*Helper`, `*Util`, `*Processor`, `*Handler` (when used inside the domain) — none describe a domain capability.
- Names that refer purely to data (`AccountService`, `OrderHelper`).

The name must be a phrase the domain expert would recognise. If the domain expert says "we *transfer* funds", a `TransferService` is correctly named. If they say "we *manage* accounts", press for a more specific verb — *manage* almost never survives Ubiquitous Language scrutiny.

---

## 4. Property 3 — Domain-typed signatures

Every public method signature of `S` may contain:

- Entities (`Account`, `Order`).
- Value Objects (`Money`, `EmailAddress`, `Address`).
- Domain Events (`OrderPlaced`).
- Domain primitives (typed wrappers around `String`/`long` — `AccountId`, `Sku`).
- Java collections of the above (`List<Order>`, `Set<Sku>`).
- `void`, primitive types, `Optional<T>` of a permitted type.

Forbidden in signatures:

- DTOs (`OrderResponseDto`, `TransferRequest`).
- Framework types (`HttpServletRequest`, `ResponseEntity<?>`, `ResultSet`).
- Wire types (`JSONObject`, `XmlElement`, Protobuf message types).
- Generic `Map<String, Object>`, `Object[]`.

Mechanical test: scan all public methods of every class under `domain/service/`; flag any signature mentioning a type from `org.springframework.*`, `javax.servlet.*`, `java.sql.*`, `com.fasterxml.jackson.*`, your `*.dto.*` packages, or your `*.web.*` packages.

---

## 5. Property 4 — No persistence

`S` must not contain:

- A field of type `JdbcTemplate`, `EntityManager`, `Session`, `MongoTemplate`, `RedisTemplate`, `Connection`, `DataSource`, or any concrete persistence type.
- A method body that calls `entityManager.persist(...)`, `repository.save(...)` *on a concrete adapter type*, executes SQL strings, or opens files.
- An annotation like `@Transactional`, `@PersistenceContext`, `@Query` — these are persistence concerns.

`S` *may* depend on a repository or gateway *interface* declared in the domain layer (`AccountRepository`, `ExchangeRatePolicy`), provided that interface itself does not leak persistence concepts (no `EntityManager` in its method signatures, no `Query` annotations on its methods).

```java
// domain/AccountRepository.java   ← interface, in domain
public interface AccountRepository {
    Optional<Account> findById(AccountId id);
    void save(Account account);
}
```

A Domain Service that depends on this interface is fine. A Domain Service that depends on `JpaAccountRepository` (the concrete class) is not.

---

## 6. Property 5 — No UI, no transport

`S` must not contain or import:

- Servlet API, Spring MVC, JAX-RS, GraphQL Java, gRPC stubs.
- HTTP clients (`RestTemplate`, `WebClient`, `HttpClient`, OkHttp).
- Message-broker SDKs (Kafka, RabbitMQ, JMS).
- Scheduling frameworks (`@Scheduled`, Quartz).
- CLI parsers, logging *configuration*, environment-variable readers.

The litmus test: I can unit-test `S` in a vanilla JUnit class with `@BeforeEach` that constructs an instance using `new`, passing in hand-rolled stub implementations of its port dependencies — *no Spring container, no embedded database, no Testcontainers, no mock HTTP server*. If this is impossible, `S` violates Property 5.

---

## 7. Methods — semantics

Methods on `S` should:

- Be **public** (the service is the API).
- Return either `void` (for command-shaped operations) or a domain value (for query-shaped operations).
- Have **no checked exceptions** unless they model a domain failure (`InsufficientFundsException`, `InvalidRouteException`). Plumbing exceptions (`SQLException`, `IOException`) must not appear on the service's public surface.
- Be **deterministic** modulo their ports — given the same inputs and the same port behaviour, two calls yield the same output.

Pure (no-mutation) services are preferred where the domain semantics allow it. Command-shaped services that mutate passed-in aggregates are valid; mutation must occur via methods on the aggregate, not by direct field assignment.

---

## 8. Lifecycle

A Domain Service has *no* lifecycle hooks: no `@PostConstruct`, no `@PreDestroy`, no `init()`, no `start()`/`stop()`. It is constructed once via its constructor, used many times, and discarded with the JVM. Lifecycle concerns belong to infrastructure adapters.

Construction:

```java
public TransferService(ExchangeRatePolicy rates, OverdraftPolicy overdraft) {
    this.rates = Objects.requireNonNull(rates);
    this.overdraft = Objects.requireNonNull(overdraft);
}
```

All dependencies in the constructor; nulls explicitly rejected; no setters; no default constructor.

---

## 9. Equality and identity

A Domain Service is *not* a value object. It does not override `equals` or `hashCode`. Two instances of the same Domain Service class are *interchangeable* if and only if they were constructed with equal ports — but identity comparison is meaningless because the service is a function, not a value. Production typically has exactly one instance per bounded context.

---

## 10. Worked compliance check

Class under review:

```java
@Service
public class OrderPricingService {
    private final PricingRulesRepository rules;

    public OrderPricingService(PricingRulesRepository rules) {
        this.rules = rules;
    }

    public Money price(Order order, Customer customer) {
        PricingRules r = rules.activeRulesFor(customer);
        return order.basket().lines().stream()
            .map(line -> r.priceLine(line))
            .reduce(Money.zero(order.currency()), Money::plus);
    }
}
```

Property-by-property:

1. **Stateless** — `rules` is `final`; no mutation. *Pass*.
2. **Capability-named** — `OrderPricingService` describes the capability *pricing an order*. *Pass*.
3. **Domain-typed signature** — `Order`, `Customer`, `Money` are all domain types. *Pass*.
4. **No persistence** — depends on `PricingRulesRepository`, which must be a domain-defined interface returning a `PricingRules` value object. If so, *pass*. If `PricingRulesRepository` is actually `org.springframework.data.jpa.repository.JpaRepository<PricingRulesEntity, Long>`, *fail*.
5. **No UI/transport** — no servlet, no HTTP. The `@Service` annotation is a Spring marker; debatable but acceptable under convention (b) from `professional.md`. *Pass under convention (b)*, fail under convention (a).

The class is a valid Domain Service under typical conventions.

---

## 11. Quick rules

- [ ] All instance fields `final`; no mutable static state.
- [ ] Name expresses a verb-shaped capability or a `Policy`/`Strategy`.
- [ ] Every signature contains only domain types.
- [ ] No `@Transactional`, no persistence types, no SQL, no broker SDKs.
- [ ] No servlet, HTTP, RPC, scheduling, or CLI imports.
- [ ] Constructor-only injection; no setters; no lifecycle hooks.
- [ ] No `equals`/`hashCode` override.

---

## 12. What's next

| Topic                                       | File             |
| ------------------------------------------- | ---------------- |
| Bugs that violate one or more properties    | `find-bug.md`    |
| Performance tuning                          | `optimize.md`    |
| Exercises with validation                   | `tasks.md`       |
| Interview Q&A                               | `interview.md`   |

Related: [`../01-value-objects/`](../01-value-objects/), [`../02-entities/`](../02-entities/), [`../03-aggregates/`](../03-aggregates/), [`../04-repository-concept/`](../04-repository-concept/).

---

**Memorize this:** Five properties define a Domain Service — *stateless, capability-named, domain-typed, persistence-free, transport-free*. All five are necessary; none alone is sufficient. The strict test is a unit test with no framework: if you can `new` the class, hand-stub its ports, and exercise its API in vanilla JUnit, it is a Domain Service. If you can't, it is something else wearing a `*Service` suffix.
