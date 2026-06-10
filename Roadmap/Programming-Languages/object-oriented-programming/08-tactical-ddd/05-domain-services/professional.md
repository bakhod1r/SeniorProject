# DDD Tactical: Domain Services — Professional

> **What?** At the professional level, Domain Services stop being a Java idiom and become an *architectural* concern: where do they sit in a hexagonal layout, what is their relationship with Spring's `@Service` annotation, who owns the transaction boundary, how do they participate in distributed sagas, and how do you make them idempotent under retry? The answers determine whether your bounded context can scale beyond a single team and a single deployment.
> **How?** Treat the Spring `@Service` annotation as a *technology marker*, not a design pattern. Place the transaction boundary at the Application Service, never inside the Domain Service. When operations cross bounded contexts, lift the orchestration out of the domain into a saga coordinator, leaving each Domain Service responsible for its local step only. Design every command-style Domain Service to be replay-safe — because in production, retries are not optional.

---

## 1. Spring `@Service` vs Domain Service — they are not the same thing

`@Service` is a Spring stereotype that does two things:

- Marks a class for component scanning so the container can instantiate it.
- Hints "this is service-layer logic" for tools, AOP, and humans.

That's it. The annotation says nothing about layering, dependencies, or DDD roles. You can put `@Service` on a Domain Service, on an Application Service, or on an Infrastructure adapter — Spring doesn't care.

The trap: developers see `@Service` and assume "this is a service in the DDD sense". They start cramming domain logic, transactions, and JdbcTemplate calls into the same class because Spring labelled it a service. The annotation is innocent; the conflation is the bug.

Three workable conventions:

**(a) Keep `@Service` off the Domain Service entirely.** The domain is framework-free; Spring instantiates it via a `@Configuration` class:

```java
// domain/service/TransferService.java — no annotation
public final class TransferService { ... }

// infrastructure/config/DomainConfig.java
@Configuration
public class DomainConfig {
    @Bean
    TransferService transferService(ExchangeRatePolicy rates) {
        return new TransferService(rates);
    }
}
```

This is the purest hexagonal style. It keeps `domain/` import-clean of Spring.

**(b) Annotate the Domain Service with `@Service`, accept the leakage.** Pragmatic; most production codebases do this. The cost: an `org.springframework.stereotype` import in your domain package. The benefit: less boilerplate.

**(c) Use a custom stereotype.**

```java
@Service
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface DomainService { }
```

This documents the role explicitly. Worth it on large codebases.

Pick one and apply it consistently within a bounded context. Inconsistency is worse than any of the three choices.

---

## 2. Hexagonal placement — Domain Service is *inside the hexagon*

Cockburn's ports-and-adapters layout:

```
                ┌──────── Adapters (in) ────────┐
                │   REST controllers, CLI,      │
                │   message consumers           │
                └─────────────┬─────────────────┘
                              │
                ┌─────────────▼─────────────────┐
                │     Application Services      │   ← orchestration, @Transactional
                │  (use cases / command handlers)│
                └─────────────┬─────────────────┘
                              │
                ┌─────────────▼─────────────────┐
                │           DOMAIN              │
                │   Entities, VOs, Aggregates,  │
                │   DOMAIN SERVICES,            │   ← stateless domain logic
                │   Domain Events, Ports        │
                └─────────────┬─────────────────┘
                              │
                ┌─────────────▼─────────────────┐
                │   Adapters (out)              │
                │   JPA repos, SMTP, S3, Kafka, │
                │   external HTTP clients       │
                └───────────────────────────────┘
```

Domain Services live in the *domain* layer — they're part of the model, not a separate "service layer". The "service layer" Fowler describes in *PoEAA* is what DDD calls the *application layer*; the two vocabularies clash, which is a major source of confusion.

A consequence: a Domain Service can be unit-tested with nothing but JUnit and stub implementations of its ports. No `@SpringBootTest`, no in-memory database, no Testcontainers. If you can't test it that way, something has leaked.

---

## 3. Transaction management — at the application boundary, never in the domain

Transactions are an infrastructure concept (a guarantee provided by a database). They have no place in the domain model. Spring's `@Transactional` therefore belongs on application services and *only* there.

```java
// application/PlaceOrderUseCase.java
@Component
public final class PlaceOrderUseCase {

    private final OrderRepository orders;
    private final PricingService pricer;
    private final InventoryReservationService reservation;
    private final ApplicationEventPublisher events;

    @Transactional
    public OrderId execute(PlaceOrderCommand cmd) {
        Order order = Order.create(cmd.customerId(), cmd.lines());
        Money total = pricer.price(order.basket(), cmd.pricingRules());
        order.applyTotal(total);
        reservation.reserve(order);
        orders.save(order);
        events.publishEvent(new OrderPlaced(order.id()));
        return order.id();
    }
}
```

`PricingService` and `InventoryReservationService` are Domain Services and have no `@Transactional`. They run *inside* the application service's transaction, which is correct — every domain call that participates in the same business operation should be part of the same transaction (or explicitly orchestrated via events).

Two anti-patterns to refuse:

- `@Transactional` on a Domain Service. Locks scope to that one method, fragments the boundary, surprises future readers.
- `@Transactional(propagation = REQUIRES_NEW)` deep in a Domain Service to "make sure this part commits". If you need that, you actually need two use cases.

---

## 4. Idempotency — design for retries

In production, every command will eventually be retried. Network blips, broker redeliveries, user double-clicks. A Domain Service that *processes* commands (debits accounts, charges cards, ships orders) must produce the same result whether called once or three times. Idempotency is a domain concern; the technique is, too.

```java
public final class FundsCaptureService {

    private final PaymentRepository payments;
    private final PspPort psp;

    public CaptureResult capture(PaymentIntent intent) {
        Optional<Payment> existing = payments.findByIdempotencyKey(intent.idempotencyKey());
        if (existing.isPresent()) {
            return CaptureResult.alreadyCaptured(existing.get());
        }
        PspChargeResult result = psp.charge(intent);
        Payment payment = Payment.from(intent, result);
        payments.save(payment);
        return CaptureResult.fresh(payment);
    }
}
```

The *idempotency key* is a domain primitive — typically generated by the caller. The service looks it up first; if seen before, it returns the prior result instead of re-charging. This pattern shows up in Stripe's API, AWS APIs, and any production payment system.

Storing the result of every command keyed by its idempotency key is sometimes called an *idempotent receiver* — Vernon discusses it in *IDDD* Chapter 13 (Integrating Bounded Contexts). It is the single most important reliability pattern for command-style Domain Services.

---

## 5. Sagas — orchestrating across bounded contexts

A *saga* is a sequence of local transactions, each in its own bounded context, coordinated either by an orchestrator or by event choreography. Sagas exist because you cannot — and should not — span a database transaction across services.

A Domain Service plays *one* step of a saga. It is *not* the saga.

```java
// In the Order context — one step
public final class OrderConfirmationService {
    public void confirm(Order order) {
        order.confirm();
    }
}

// In the Payment context — another step
public final class PaymentCaptureService {
    public void capture(PaymentIntent intent) { ... }
}

// In an orchestrator (application service or dedicated saga coordinator)
@Component
public final class PlaceOrderSaga {

    public void on(OrderPlaced event) {
        try {
            paymentCaptureService.capture(event.paymentIntent());
            orderConfirmationService.confirm(orders.byId(event.orderId()));
        } catch (PaymentFailed ex) {
            orders.byId(event.orderId()).cancel();   // compensating action
        }
    }
}
```

Compensation, not rollback, is the saga model. Each step that runs successfully but later needs reversal does so via a *compensating* domain operation (`cancel`, `refund`, `release`), defined as a method on the relevant entity or as another Domain Service. Pat Helland's "Life beyond Distributed Transactions" (2007) is the foundational reference; Vernon's *IDDD* Chapter 13 walks through process-manager and event-choreography variants.

---

## 6. Choreography vs orchestration

Two saga styles:

| Style          | How                                                                   | Pro                                  | Con                                              |
| -------------- | --------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| Choreography   | Each context reacts to events; no central coordinator.                | Maximally decoupled.                 | Flow is implicit, hard to read or debug.         |
| Orchestration  | A coordinator (process manager) calls each step explicitly.           | Flow is explicit, easy to monitor.   | Coordinator becomes a hotspot of business logic. |

Domain Services in *both* styles look the same — they expose a capability. What changes is the *caller*: an event handler (choreography) or an orchestrator (orchestration). Don't bake the choice into the service; keep it neutral.

---

## 7. Concurrency — services are singletons, design accordingly

Spring instantiates `@Service` beans as singletons by default. Many threads call the same Domain Service instance simultaneously. This is fine if and only if the service is truly stateless. A single mutable field, a single non-thread-safe dependency, and you have a production-grade race condition.

Checklist:

- All fields `private final`.
- All dependencies thread-safe (or documented if not).
- No `static` mutable state.
- No `ThreadLocal` unless you can articulate exactly why and how it's cleaned up.

If a service genuinely needs per-invocation state, model that state as a local variable or as a freshly created value object inside the method. The instance stays clean.

---

## 8. Observability — but at the boundary

You want metrics: how long does a transfer take? You want logs: who initiated it? You want traces: which call chain led here? Resist the temptation to scatter logging and metrics inside Domain Services. Instead, instrument at the application-service boundary:

```java
@Component
public final class TransferUseCase {
    private final Tracer tracer;
    private final MeterRegistry meters;
    ...

    public void execute(...) {
        Span span = tracer.spanBuilder("transfer").startSpan();
        try (Scope s = span.makeCurrent()) {
            Timer.Sample t = Timer.start(meters);
            try {
                transferService.transfer(...);
            } finally {
                t.stop(meters.timer("transfer.duration"));
            }
        } finally {
            span.end();
        }
    }
}
```

The Domain Service stays pure. Cross-cutting concerns live where they belong — outside the domain.

---

## 9. Quick rules

- [ ] `@Service` is a Spring marker, not a DDD pattern — don't conflate.
- [ ] Domain Services live inside the hexagon; no Spring, no JPA, no I/O.
- [ ] `@Transactional` on the application service; never on the domain service.
- [ ] Every command-style Domain Service is idempotent via an idempotency key check.
- [ ] Sagas live in orchestrators (or event flows), not inside Domain Services.
- [ ] All Domain Service fields `final`; instances are singletons, design for concurrency.
- [ ] Instrument at the boundary, keep the domain code clean.

---

## 10. What's next

| Topic                                                | File               |
| ---------------------------------------------------- | ------------------ |
| Formal contract                                      | `specification.md` |
| 10 buggy services and fixes                          | `find-bug.md`      |
| JIT, EA, batching, parallelism                       | `optimize.md`      |
| Exercises                                            | `tasks.md`         |
| Interview Q&A                                        | `interview.md`     |

Related: [`../02-entities/`](../02-entities/), [`../01-value-objects/`](../01-value-objects/), [`../03-aggregates/`](../03-aggregates/), [`../04-repository-concept/`](../04-repository-concept/).

---

**Memorize this:** A Domain Service is a piece of *pure domain logic* hosted inside the hexagon. Spring's `@Service` is a wiring tool, not a layering decision. Transactions belong at the application boundary; sagas belong above the domain; idempotency and observability are bolted on at the edges. Keep these four concerns *out* of your Domain Service code and it will survive every architectural change short of rewriting the bounded context.
