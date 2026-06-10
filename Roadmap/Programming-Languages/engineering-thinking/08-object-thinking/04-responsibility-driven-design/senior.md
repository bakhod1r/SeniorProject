# Responsibility-Driven Design — Senior

> **What?** At senior level, RDD stops being a class-naming exercise and becomes an *architectural* discipline. Stereotypes are not labels you stick on classes after the fact — they are the vocabulary you use to talk about *where work lives* across a layered system, across services, and across the boundary between domain and infrastructure.
> **How?** You learn to read RDD next to SOLID, DDD, hexagonal architecture, and functional/data-oriented styles, and decide where each is the better lens. You catch god Coordinators before they form, you keep cross-cutting concerns out of Information Holders, and you know when a stereotype is the wrong answer.

---

## 1. RDD vs SOLID — overlap and difference

SOLID and RDD answer different questions. SOLID asks *what makes a class healthy?* RDD asks *what is the class for?* Most well-formed SOLID classes are also well-formed RDD role-players, but the two diverge at the edges.

| Concern                         | SOLID's answer                            | RDD's answer                                                  |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| "Should this class be split?"   | SRP: one reason to change.                | Stereotype: one role to play.                                 |
| "Should this dependency exist?" | DIP: depend on abstractions.              | Collaboration: who do you call on to help fulfill your role? |
| "Why this method here?"         | Cohesion of behavior with data.           | The object that *already knows* owns the decision.            |
| "How do I extend?"              | OCP via polymorphism.                     | Add a new role-player; existing collaborators don't change.   |

SOLID is *structural* — it constrains class shape. RDD is *intentional* — it talks about purpose. SOLID will tell you a `LoanApplication` class has too many responsibilities; RDD will tell you *which two stereotypes* it has confused (Information Holder of borrower data, Controller of underwriting state) and how to peel them apart.

Stronger lens for RDD: large domains, mixed teams, lots of business rules.
Stronger lens for SOLID: library APIs, framework code, pure structural review.

---

## 2. RDD and DDD — stereotypes map to tactical patterns

Domain-Driven Design's tactical patterns are not a different theory; they are RDD with a *bounded-context* hat on. The stereotypes line up cleanly.

| RDD stereotype       | DDD pattern                                  | Example in loan origination                                    |
| -------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| Information Holder   | Value Object (immutable)                     | `Money`, `CreditScore`, `BorrowerName`, `LoanTerm`             |
| Information Holder + Controller | Entity / Aggregate Root             | `LoanApplication`, `Borrower`                                  |
| Controller           | Aggregate root behavior                      | `loanApplication.submit()`, `loanApplication.approve(...)`     |
| Service Provider     | Domain Service                               | `RiskScoringService`, `AmortizationCalculator`                 |
| Coordinator          | Application Service / Saga / Process Manager | `LoanOriginationWorkflow`                                      |
| Interfacer           | Repository / Anti-Corruption Layer / Adapter | `LoanApplicationRepository`, `BureauClient`                    |
| Structurer           | Aggregate-of-aggregates view (rare)          | `LoanPortfolio`                                                |

```java
public record Money(BigDecimal amount, Currency currency) {       // Value Object
    public Money plus(Money other) { /* ... */ }
}

public final class LoanApplication {                              // Aggregate root
    private LoanApplicationId id;
    private BorrowerSnapshot borrower;
    private Money requestedAmount;
    private LoanStatus status;

    public void approve(Underwriter who, CreditScore score) {     // Controller behavior
        if (status != LoanStatus.UNDER_REVIEW) throw new IllegalStateException();
        if (score.value() < 620) throw new InsufficientCreditException();
        this.status = LoanStatus.APPROVED;
        // emit ApplicationApproved domain event
    }
}
```

If you already speak DDD, RDD is the *behavioral grammar* underneath it. If you start with RDD and grow into a domain-heavy codebase, DDD is the natural next vocabulary.

---

## 3. Designing for testability — each stereotype has its own test style

A surprising payoff of clean stereotypes is that *test strategy* follows. The shape of the test matches the shape of the role.

- **Information Holder.** Test as a pure function of constructor args. No mocks. Round-trip serialization, equality, invariants.
  ```java
  @Test void money_addition_preserves_currency() {
      assertEquals(new Money(BigDecimal.TEN, USD),
                   new Money(BigDecimal.valueOf(7), USD).plus(new Money(BigDecimal.valueOf(3), USD)));
  }
  ```
- **Controller / Aggregate.** Test state transitions and invariants. No mocks for collaborators it owns; only for outbound interfaces. Given–when–then on the aggregate.
- **Service Provider.** Test as a focused calculation. Parameterised tests on inputs/outputs; deterministic.
- **Coordinator.** Test the *script*: given these collaborator responses, the right calls happen in the right order. Mocks/fakes are appropriate here — they are the things being coordinated.
- **Interfacer.** Test the *translation*. Either contract tests against a real or fake counterparty, or schema tests for serialization. The domain behind it is not what you're testing.
- **Structurer.** Property-based tests on relationships (an item added is reachable; removing it removes it everywhere).

If you find a test that mocks everything to verify a single arithmetic, the unit under test is wearing the wrong stereotype — it is being tested as a Coordinator but should be a Service Provider or Information Holder.

---

## 4. When a Coordinator becomes too smart

The most common failure mode in a large RDD codebase is a Coordinator that quietly absorbs business rules until it is a god class with a saga-shaped name. Symptoms:

- Methods named with conjunctions (`processAndNotifyAndAudit`).
- Branching on the state of other aggregates ("if loan is approved AND borrower has KYC AND ...").
- Test setups that mock five collaborators just to enter the function.

Refactoring path:

1. **Push decisions back into Information Holders.** If the Coordinator decides "is this claim payable?", the Claim should decide it.
2. **Extract a Mediator** when many peer collaborators talk through one hub: the Coordinator routes messages without deciding their content.
3. **Promote the Coordinator to a Saga / Process Manager** when long-running, durable state across aggregates is involved — the workflow itself becomes a first-class persistent object.

```java
// Before: smart coordinator
public final class ClaimWorkflow {
    public void process(Claim c, Policy p, Adjuster a) {
        if (p.isExpired()) { c.reject("policy expired"); return; }
        if (!a.isCertifiedFor(c.type())) { c.escalate(); return; }
        if (c.amount().compareTo(p.deductible()) <= 0) { c.closeAsBelowDeductible(); return; }
        // ... 80 more lines
    }
}

// After: thin coordinator, smart collaborators
public final class ClaimWorkflow {
    public ClaimOutcome process(Claim claim, Policy policy, Adjuster adjuster) {
        return policy.coverage(claim)                // Policy decides coverage
                     .assignedTo(adjuster)           // Adjuster verifies certification
                     .evaluate();                    // Returns a sealed ClaimOutcome
    }
}
```

The workflow now *describes* a path through the domain; the rules live with the data.

---

## 5. RDD across microservices

In a monolith, a stereotype is a class. In a distributed system, a stereotype is often a *service*. The same vocabulary scales up.

- **Information-Holder service.** Owns a slice of state and exposes queries (a "Customer Profile" service).
- **Service-Provider service.** Stateless computation (a "Fraud Scoring" service).
- **Coordinator service.** Drives a saga across other services ("Order Fulfillment Orchestrator").
- **Interfacer service.** Bridges to external systems (a "Carrier Integration" service that adapts FedEx/UPS/DHL APIs into a single internal contract).
- **Structurer service.** Owns relationships (a "Catalog" service that links SKUs to categories and bundles).

Mistakes at the service level mirror class-level mistakes: an Information-Holder service that starts orchestrating others becomes a distributed god object; a Coordinator that starts caching domain facts duplicates ownership.

A useful test: for each service, write a one-line responsibility statement. *"The Inventory service is the authoritative source of stock-on-hand."* If a teammate cannot say it in one sentence, the service is wearing too many hats.

---

## 6. Cross-cutting concerns — Interfacers or Decorators, not Information Holders

Logging, audit, retries, metrics, tracing, authorization checks: these *cross* every domain method but belong to *none* of them. Pushing them into Information Holders is the fastest way to ruin a domain model.

The clean placement options, in order of preference:

1. **Decorator** around a Service Provider or Repository interface.
2. **Interfacer** at the system boundary (a controller/consumer that audits before delegating).
3. **Aspect / interceptor** for truly orthogonal concerns (Spring AOP, CDI interceptor), used sparingly.

```java
public interface PayoutGateway {
    PayoutReceipt pay(PayoutRequest req);
}

public final class AuditingPayoutGateway implements PayoutGateway {
    private final PayoutGateway delegate;
    private final AuditLog audit;

    @Override public PayoutReceipt pay(PayoutRequest req) {
        audit.record("payout.requested", req.id());
        PayoutReceipt r = delegate.pay(req);
        audit.record("payout.completed", r.id());
        return r;
    }
}
```

`PayoutRequest` (an Information Holder) and the core `PayoutGateway` (a Service Provider) stay untouched. Auditing is a separate role, fulfilled by a Decorator that *is* an Interfacer to the audit subsystem.

A domain class that calls `logger.info(...)` is leaking its role: it is now also an Interfacer to the logging system.

---

## 7. Double-dispatch and visitor-style RDD

Some responsibilities depend on *two* types simultaneously — "how do I tax this kind of product in this kind of jurisdiction?" Putting the logic in only one of them privileges one axis and forces `instanceof` chains in the other.

Classical OO answer: **double dispatch**, often via the Visitor pattern. RDD reframes it: the *responsibility itself* is the role-player.

```java
public sealed interface FulfillmentMethod permits Ship, Pickup, Digital {}
public record Ship(Address to)      implements FulfillmentMethod {}
public record Pickup(StoreId store) implements FulfillmentMethod {}
public record Digital(Email to)     implements FulfillmentMethod {}

public sealed interface OrderLine permits Physical, EBook, GiftCard {}

public interface FulfillmentPlanner {                       // the responsibility
    FulfillmentPlan plan(OrderLine line, FulfillmentMethod method);
}
```

With sealed types and pattern matching, the dispatch is explicit and exhaustive:

```java
public final class StandardFulfillmentPlanner implements FulfillmentPlanner {
    @Override public FulfillmentPlan plan(OrderLine line, FulfillmentMethod method) {
        return switch (line) {
            case Physical p -> switch (method) {
                case Ship s     -> FulfillmentPlan.shipFrom(p.warehouse(), s.to());
                case Pickup pk  -> FulfillmentPlan.reserveAt(pk.store(), p);
                case Digital d  -> throw new IncompatibleFulfillmentException();
            };
            case EBook e    -> requireDigital(method, e);
            case GiftCard g -> requireDigital(method, g);
        };
    }
}
```

The classes (`Physical`, `Ship`, ...) stay clean Information Holders. The cross-cutting behavior lives in a Service Provider named after the responsibility — `FulfillmentPlanner`. This is RDD's answer to Visitor: name the *job*, not the traversal.

---

## 8. Layered vs hexagonal — distributing the stereotypes

In a classic layered architecture, stereotypes pile up by tier:

```
Controllers   (Interfacers)
Services      (Service Providers + Coordinators)
Entities      (Information Holders + Controllers)
Repositories  (Interfacers)
```

This works, but it tempts the Service layer to absorb Controller responsibilities ("anemic domain model").

In hexagonal/ports-and-adapters, the same stereotypes redistribute:

```
Inbound adapters    (Interfacers) ─┐
                                   ├─→ Application services (Coordinators only)
Outbound adapters   (Interfacers) ─┘            │
                                                ▼
                       Domain: Information Holders + Controllers + Service Providers
```

Two practical consequences for a senior engineer:

- **Coordinators belong in the application layer, never in the domain.** A `LoanApplication` aggregate must not import an `EmailGateway`.
- **Interfacers live on the rim**, behind ports defined by the domain. The domain says *"I need a `CreditBureau`"*; the adapter is an Interfacer that knows Experian's HTTP API.
- **Service Providers can live in either domain or application layer** depending on whether the computation is pure domain logic (amortization) or coordination logic (sending a templated email).

If you can draw your hexagon and label every box with a stereotype, your architecture document is half-written.

---

## 9. Anti-patterns — three to recognize at a glance

**(a) God Coordinator.** A `*Workflow` / `*Orchestrator` / `*Manager` class with hundreds of lines, dozens of injected dependencies, and conditional logic that quietly encodes business rules.

*Fix:* push each decision into the aggregate that has the data; the workflow should read like a table of contents.

**(b) Anemic Information Holder.** Records that hold data but expose no behavior; every operation lives in a sibling service.

```java
// Smell:
public record Invoice(InvoiceId id, List<Line> lines, BigDecimal taxRate) {}

public final class InvoiceCalculator {
    public BigDecimal total(Invoice i) { /* ... */ }
    public boolean isOverdue(Invoice i, LocalDate today) { /* ... */ }
}
```

*Fix:* move `total()` and `isOverdue(today)` onto `Invoice`. Records *can* have methods.

**(c) Role-leaking Interfacer.** An adapter that secretly contains business logic — for example, an `OrderRepository` that *decides* an order is "stale" and silently archives it inside `findById`.

*Fix:* Interfacers translate, they don't decide. Move the staleness rule into the `Order` (Information Holder) or an `ArchivePolicy` (Service Provider); the repository only persists and retrieves.

A useful linting rule: an Interfacer's method names should be verbs from the *technology* (`save`, `findById`, `publish`), not from the *domain* (`approve`, `mature`, `escalate`). If you see domain verbs on a repository, something has leaked.

---

## 10. Trade-offs vs functional / data-oriented approaches

RDD is not the only valid lens. Two strong alternatives, each pulling in a different direction:

- **Functional style.** Data is plain immutable records; behavior is free functions that transform them. *Strength:* simple to reason about, trivial to test, no hidden state. *Weakness:* "where does this rule live?" becomes a module-organization question rather than an OO question, and discoverability suffers as the codebase grows.
- **Data-oriented design (Java 21+ records + sealed types + pattern matching).** Embraces algebraic data types: model the *shape* of the data exhaustively, write functions that switch over it. *Strength:* total handling of every case, great for protocols and pipelines. *Weakness:* polymorphism by `switch` rather than by dispatch; adding a new variant touches every switch.

RDD shines when:

- The domain has rich behavior tightly coupled to data (banking, claims, fulfillment, scheduling).
- Multiple teams need to talk about *who owns what*.
- Long-lived codebases need a vocabulary that survives reorgs.

Functional / data-oriented styles shine when:

- The work is fundamentally a pipeline of transformations.
- The data shapes are stable, and the operations vary.
- Concurrency/immutability dominate the design.

A pragmatic Java codebase often mixes them: RDD for the domain core (aggregates own their rules), functional/data-oriented for protocol layers, pipelines, and ETL paths. The lens is a tool, not a tribe.

---

## 11. Quick rules

- [ ] Name the stereotype of every class on a whiteboard before you defend it.
- [ ] If a Coordinator has more than ~7 collaborators or more than one screen of code, push decisions back into the aggregates.
- [ ] Cross-cutting concerns never live in Information Holders. Decorate or adapt.
- [ ] Repositories translate; they don't decide. Domain verbs on a repository = leak.
- [ ] In hexagonal layouts, the domain knows no Interfacers — only ports.
- [ ] When dispatch depends on two types, name the *responsibility* and make it a Service Provider with pattern matching; don't push it into either type.
- [ ] At service-boundary scale, the same stereotypes apply: one responsibility per service, written as one sentence.

---

## 12. What's next

| Topic                                                          | File              |
| -------------------------------------------------------------- | ----------------- |
| Reintroduction to RDD — vocabulary and worked example          | `junior.md`        |
| Collaborations, walk-throughs, stereotype tables               | `middle.md`        |
| Driving RDD across a team and codebase                         | `professional.md`  |
| Hands-on RDD exercises                                         | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

---

**Memorize this:** stereotypes are an architectural vocabulary, not a class-naming convention. Coordinators stay thin, Information Holders stay rich, Interfacers stay at the rim, and cross-cutting concerns never bleed into the domain. RDD is strongest where behavior and data are tightly coupled; reach for functional or data-oriented lenses where the work is a pipeline. The lens you choose decides what becomes easy to change later.
