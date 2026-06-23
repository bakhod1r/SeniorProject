# Responsibility-Driven Design — Interview Q&A

> Pragmatic questions you should expect when a senior interviewer wants to know whether you actually *think* in objects, or just spell Java correctly. Answers are short, opinionated, and aimed at real Java codebases.

---

## Q1. What is Responsibility-Driven Design, and who invented it?

Responsibility-Driven Design (RDD) is an object design method introduced by **Rebecca Wirfs-Brock** in the late 1980s and developed further in her book *Object Design: Roles, Responsibilities, and Collaborations* (2003, with Alan McKean). Instead of starting from data (nouns → classes → fields), RDD starts from behavior: "what does the system have to do, and which object should be responsible for it?" Each class is then assigned a *role* (stereotype) and a small, coherent set of responsibilities. Objects collaborate by delegating to whoever already holds the information needed for a decision. The output is a model where business logic lives on domain objects, not in service classes that orbit anemic records.

**Trap:** Candidates often credit "Uncle Bob" or "GoF" — Wirfs-Brock's work predates SOLID's popularization and is more foundational than the patterns book.

---

## Q2. Name the six classic stereotypes and give one example of each.

The six stereotypes Wirfs-Brock catalogued are:

- **Information Holder** — knows facts and answers questions about itself. Example: `Money`, `InvoiceLine`.
- **Service Provider** — performs a focused computation on request. Example: `PasswordHasher`, `TaxCalculator`.
- **Structurer** — maintains relationships between other objects. Example: `RouteGraph`, `ProductCatalog`.
- **Coordinator** — reacts to events, routes work across collaborators. Example: `LoanOriginationSaga`, `PaymentOrchestrator`.
- **Controller** — makes decisions that govern other objects' behavior. Example: `Order.place()`, `ReservationGuard`.
- **Interfacer** — translates between the system and the outside world. Example: `OrderHttpController`, `KafkaInvoiceConsumer`.

A class's *primary* stereotype tells you what it should do and — equally important — what it shouldn't.

**Follow-up:** Interviewers may ask which two are most often confused; answer **Coordinator vs Controller** (the former routes events between peers, the latter governs by deciding).

---

## Q3. What is the "who knows" test?

When you don't know where a method belongs, ask: *which object already holds all the information needed to perform this work?* That object is almost always the correct owner. Computing an order total needs the line items — the order already has them, so `order.total()` beats `TotalCalculator.compute(order)`. Checking whether a reservation expired needs the expiry timestamp — the reservation has it, so `reservation.isExpired(clock)` beats `ExpiryChecker.isExpired(reservation, clock)`. The test prevents you from extracting "convenient" service methods that drag data out of objects only to make decisions about that data elsewhere.

```java
// "Who knows" answer: the cart knows its items, so the cart can decide.
boolean canCheckout = cart.satisfiesMinimum(MIN_ORDER); // good
boolean canCheckout = checkoutPolicy.allows(cart);      // worse — data tour
```

**Trap:** If *two* objects share the data equally, the "who knows" test may point to a third role-player (often a Coordinator), not to a coin flip between the two.

---

## Q4. How does RDD differ from SOLID?

SOLID gives you five orthogonal class-design principles; RDD gives you a *method* for arriving at well-designed classes in the first place. SOLID's Single Responsibility Principle says "one reason to change" but doesn't tell you how to find that reason — RDD does, by forcing you to name a stereotype and list the responsibilities that fit it. SOLID is largely about *coupling and substitutability* (LSP, DIP); RDD is about *role assignment and collaboration*. In practice, code produced by RDD tends to satisfy SOLID naturally — small role-players with clear jobs are SRP-compliant by construction. The reverse is not true: SOLID-compliant code can still be a procedural script if you only thought about interfaces.

**Follow-up:** "Is RDD compatible with hexagonal architecture?" Yes — RDD designs the domain core; hexagonal positions Interfacers at the boundary.

---

## Q5. How does RDD relate to DDD and aggregates?

Domain-Driven Design borrowed heavily from RDD: tactical DDD's *entity*, *value object*, *domain service*, and *application service* are essentially refinements of RDD's stereotypes. An **Aggregate** is an RDD Controller — it owns invariants for a cluster of objects and decides what is allowed. **Value Objects** are pure Information Holders. **Domain Services** are Service Providers, used only when a computation legitimately belongs to no single entity (currency conversion, FX rate lookups). **Repositories** are Interfacers. RDD is the underlying *thinking technique*; DDD is the strategic + tactical vocabulary that lets you talk about the same ideas at architecture-meeting scale.

**Trap:** Don't say "DDD replaces RDD" — DDD presupposes RDD-style reasoning inside each aggregate.

---

## Q6. Critique a class that mixes every stereotype.

```java
public class Order {
    public BigDecimal total() { /* Information Holder */ }
    public void place() { /* Controller */ }
    public void chargeCard(CardGateway gw) { /* Coordinator + Interfacer */ }
    public void emailCustomer(Mailer m) { /* Coordinator + Interfacer */ }
    public OrderDto toDto() { /* Interfacer */ }
    public void saveToDb(JdbcTemplate t) { /* Interfacer */ }
    public BigDecimal shippingCost(RatesApi api) { /* Service Provider via I/O */ }
}
```

This class plays five roles. The Information Holder + Controller parts (`total`, `place`) are fine — they belong to an order. Everything else should be peeled off: persistence into an `OrderRepository`, mailing into a `CustomerNotifier` Coordinator, card charging into a `PaymentGateway` Service Provider, DTO conversion into a presentation-layer mapper, and shipping rates into a domain service that the order *consults*, not owns. After refactoring, `Order` keeps its identity ("a placed customer purchase with invariants") and stops being the universal junk drawer of the order package.

**Follow-up:** Watch for `saveToDb` — it imports `JdbcTemplate` into the domain. That's a layering violation; the domain must not know SQL.

---

## Q7. Critique a coordinator that's secretly a god class.

```java
@Service
public class OrderProcessor {
    public void process(Order o, Customer c, Payment p) {
        if (c.isBlocked()) throw new BlockedException();
        if (o.items().stream().anyMatch(i -> !inv.has(i))) throw new OutOfStock();
        if (p.amount().compareTo(o.total()) < 0) throw new Underpaid();
        if (o.shippingAddress().country().isEmbargoed()) throw new Embargo();
        repo.save(o); mailer.send(...); ledger.post(...); auditor.log(...);
    }
}
```

This *looks* like a Coordinator but is a god class: every business rule lives here, while `Order`, `Customer`, and `Payment` are anemic. A real Coordinator routes calls and reacts to outcomes; it does not *contain* the rules. The fix is to push each check onto the object that has the data — `c.assertNotBlocked()`, `o.assertItemsAvailable(inv)`, `p.assertCovers(o.total())`, `o.shippingAddress().assertNotEmbargoed()` — and let the Coordinator simply sequence the steps and handle cross-cutting effects (events, persistence, audit).

**Trap:** Don't be fooled by `@Service` annotations — many "services" are anemic-domain garbage trucks. Stereotype is determined by responsibilities, not Spring stereotypes.

---

## Q8. How do you decide whether a responsibility belongs to an existing class or a new one?

Three questions, in order. First, does the responsibility fit the **stereotype** of an existing class? If `Order` is a Controller and the new responsibility is decisional ("can this be cancelled?"), it fits. Second, can the existing class fulfill the responsibility using *only* its own data or its tight collaborators, without dragging in a new dependency? If yes, it belongs there. Third, would adding this responsibility make the class's *purpose* harder to state in one sentence? If yes, extract a new class. The new class often plays a different stereotype — e.g. extracting `RefundProcess` (Coordinator) from `Reservation` (Controller) because cancellation involves multiple actors over time.

**Follow-up:** A useful smell — if you have to invent an unrelated adjective to describe the class ("`Order` is a customer purchase *that also* schedules emails"), you've added a second responsibility; split it.

---

## Q9. When should a Coordinator be introduced?

Introduce a Coordinator when **a workflow spans multiple stateful objects and unfolds over time**, especially when failure of one step requires compensating others. A single method call that delegates to two entities is *not* a workflow — it's just polite delegation. But a "loan origination" that runs credit checks, reserves funds, captures signatures, schedules disbursement, and rolls back on any failure is a clear Coordinator. The Coordinator owns the *sequence* and the *compensation logic*; the entities own their own invariants. Premature Coordinators are a smell — if `OrderCoordinator.place()` just calls `order.place()`, delete the Coordinator.

```java
public final class LoanOriginationSaga {
    public LoanDecision originate(Application app) {
        var credit = bureau.check(app.applicant());
        var reservation = treasury.reserve(app.amount());
        try { return underwriter.decide(app, credit, reservation); }
        catch (RuntimeException e) { reservation.release(); throw e; }
    }
}
```

**Trap:** A Coordinator that holds long-lived state across method calls is becoming an Aggregate; promote it.

---

## Q10. What is the "anemic Information Holder" trap?

It's the class that *only* stores data and exposes it through getters and setters, with all decisions about that data living elsewhere. Such a class is an Information Holder in shape but provides no *answers* — only raw facts. The trap is two-fold: business rules drift into services (creating the god-service problem from Q7) and changes to the data shape force shotgun edits across many service classes that read the holder's getters. The fix is to add *answering* methods: not just `getStatus()` and `getDueDate()`, but `isOverdue(Clock now)` and `canBeRenewed()`. An Information Holder that doesn't answer questions about itself is just a DTO wearing a domain object's hat.

**Trap:** Lombok `@Data` is the express train to this antipattern — generated setters invite mutation from anywhere, generated getters invite outside reasoning over the object's data.

---

## Q11. How do you enforce stereotype direction in code review?

Enforce it as **a single sentence at the top of each class** stating the stereotype and the responsibilities, and review every PR against it. If a PR adds a method that doesn't match the declared stereotype, that's a blocker — either the method goes elsewhere or the class's declared role changes (and the rest of its responsibilities are reviewed for fit). Code-review checklist items I use: (1) does this class have one stereotype I can name? (2) are all public methods consistent with it? (3) is any domain rule expressed in a service that could live on an entity? (4) does any class import infrastructure (JDBC, Kafka, HTTP) it shouldn't? (5) is there a Coordinator that's secretly a god class? Pair this with ArchUnit tests that forbid `org.springframework.jdbc` imports inside `domain.*` and you get *mechanical* enforcement of the most painful stereotype violation.

**Follow-up:** When you reject a PR for stereotype drift, suggest the better home — reviewers who only say "no" without redirecting create resentment.

---

## Q12. Walk through designing a `LoanOrigination` flow using RDD.

Start by listing responsibilities, not classes. The flow must: receive a loan application; verify applicant identity; pull a credit score; calculate maximum eligible amount; reserve funds; underwrite; produce a decision; notify the applicant; and persist the outcome. Now assign each to a stereotype.

| Responsibility                          | Owner                           | Stereotype          |
| --------------------------------------- | ------------------------------- | ------------------- |
| Knowing applicant facts                 | `Applicant`                     | Information Holder  |
| Knowing loan parameters                 | `LoanApplication`               | Information Holder  |
| Computing eligibility                   | `LoanApplication.eligibility()` | Information Holder  |
| Verifying identity                      | `IdentityVerifier`              | Service Provider    |
| Pulling credit score                    | `CreditBureauClient`            | Interfacer          |
| Reserving treasury funds                | `Treasury.reserve()`            | Controller          |
| Making the underwriting decision        | `Underwriter.decide()`          | Controller          |
| Sequencing the flow + compensation      | `LoanOriginationSaga`           | Coordinator         |
| Notifying applicant of outcome          | `ApplicantNotifier`             | Coordinator         |
| Persisting the decision                 | `LoanRepository`                | Interfacer          |

```java
public final class LoanOriginationSaga {
    public LoanDecision originate(LoanApplication app) {
        verifier.verify(app.applicant());
        var score = bureau.scoreOf(app.applicant());
        var reservation = treasury.reserve(app.requestedAmount());
        try {
            var decision = underwriter.decide(app, score);
            if (decision.approved()) reservation.commit(); else reservation.release();
            loans.save(decision); notifier.notify(app.applicant(), decision);
            return decision;
        } catch (RuntimeException e) { reservation.release(); throw e; }
    }
}
```

Note what the saga *doesn't* do: it doesn't compute eligibility (the application does), it doesn't decide approval (the underwriter does), and it doesn't format the notification body (the notifier does). It *sequences* and *compensates*.

**Follow-up:** Where do retries belong? In the Interfacer that talks to the credit bureau, not in the Saga — retry is an outbound-call concern, not a workflow concern.

---

## Q13. How does RDD interact with frameworks like Spring and JPA?

Frameworks pull you toward two anti-patterns: anemic JPA entities (all data, no behavior) and god `@Service` beans (all behavior, no data). RDD pushes back by keeping the domain framework-agnostic — entities are Information Holders + Controllers with real methods, and Spring `@Service` beans are restricted to genuine Coordinators or Interfacers. JPA entities can carry domain behavior as long as you accept the constraints: no-arg constructors, mutability for the ORM, careful equals/hashCode. For aggregates that resist JPA mapping, use a **separate persistence model** (mapping-only `@Entity` POJOs) and reconstitute domain objects from them — protecting the domain from the framework. Spring's stereotype annotations (`@Service`, `@Component`, `@Repository`) accidentally map onto RDD's stereotypes; use the alignment: `@Repository` = Interfacer, `@Service` = Coordinator/Service Provider, `@RestController` = Interfacer.

```java
@Entity
public class Reservation {
    @Id private UUID id;
    private Instant expiresAt;
    public boolean isExpired(Clock c) { return Instant.now(c).isAfter(expiresAt); }
}
```

**Trap:** Adding `setStatus(String)` to a JPA entity so Hibernate can hydrate it opens the door for any service to mutate state — restrict setters to package-private and let the entity expose meaningful state transitions instead.

---

## Q14. What are the trade-offs of RDD versus functional designs?

RDD distributes state and behavior across many objects that *own* their data; functional designs separate immutable data from pure functions that *transform* it. RDD wins when the domain has rich invariants, long-lived identity, and behavior that varies with state (chess clocks, reservations, accounts) — the encapsulation prevents invalid states by construction. Functional designs win when transformations dominate, identity is irrelevant, and parallelism matters (analytics pipelines, ETL, compilers). The two are not mutually exclusive: Java domains often use RDD at the aggregate boundary and functional style inside computations (stream pipelines, pure helpers). The pragmatic rule: model state with RDD, model computation with functions, and don't confuse the two by writing "services" that pretend to be either.

**Follow-up:** Records + sealed interfaces give you near-functional ergonomics in Java 21 — use them for Information Holders, keep Controllers and Coordinators as classes.

---

## Q15. Should every class declare its stereotype explicitly?

Not by annotation, but **yes by clarity** — every class should have a stereotype that a reviewer can name within ten seconds of reading the type. Adding a `@Stereotype("Controller")` annotation gives you nothing the class's contents don't already convey; it becomes documentation that drifts. What pays off is the *discipline* of being able to answer "what role does this play?" for every class, and rejecting classes that can't answer it. Borderline cases (a class that's *mostly* an Information Holder but has one Controller method) are fine if the secondary role is genuinely small; they become problems when secondary roles accumulate. So: declare stereotypes mentally and in design discussions, write them at the top of complex classes as a one-line javadoc, but don't mechanize them into formal annotations — that's process theatre that the codebase will outlive and ignore.

**Trap:** A team that argues for an hour about whether `Cart` is a Controller or an Information Holder is missing the point — the stereotype is a *tool* for finding good designs, not a label to litigate.

---

## Q16. How do you migrate a legacy anemic-domain Spring application toward RDD?

Strangle, don't rewrite. Pick one aggregate (start with the most rule-heavy — `Order`, `Reservation`, `Subscription`), inventory the business rules currently scattered across its services, and pull them onto the entity one method at a time. Each migration step: identify a service method that uses only one entity's data → add an equivalent method on the entity → update one caller → run tests → commit. The entity grows behavior; the services shrink. When a service is reduced to "delegate to the entity, then save", convert it into a thin Coordinator or fold the save into a repository call. Resist the urge to "fix everything" — the domain you build *next to* the legacy code teaches the team the new style without freezing a six-month rewrite. Within a quarter, the second aggregate is easier than the first; within a year, "no rules in services" becomes a code-review convention.

**Follow-up:** Tests must come first — without characterization tests around the service methods, every responsibility move risks behavior change.

---

## Q17. What if a responsibility seems to belong to *no* domain object?

You have three legitimate options. **First**, the responsibility may genuinely belong to a Service Provider — currency conversion, password hashing, PDF rendering have no domain entity that should own them, so a stateless service class is the right home. **Second**, the responsibility may indicate a *missing concept* in the model — if "checking whether an order is fraudulent" doesn't fit `Order`, `Customer`, or `Payment`, perhaps `FraudAssessment` is a domain concept you haven't named yet, with its own identity and rules. **Third**, the responsibility may legitimately span entities and belong to a Coordinator — multi-step workflows, cross-aggregate consistency, saga compensation. The wrong answer is to default to "stick it in a service" without asking which of the three applies — that's how you end up with `BusinessLogicService` containing six unrelated methods.

**Trap:** A responsibility "no one owns" is often a signal that you're missing a concept; resist the urge to invent a service and instead invent the concept.

---

## Q18. What's the single most important habit to develop?

Before writing any method, finish the sentence **"This is the responsibility of ____."** out loud or in a comment. If the blank fills with an existing domain object's name, write the method there. If it fills with a service name you just made up, stop — you're about to externalize a rule that probably belongs on the entity. If it fills with two names, you've probably found a Coordinator. This one habit, practiced every day, will produce more correct designs over a career than any pattern catalogue. Patterns describe what good designs look like; the "who is responsible" question is how you *get* there.

**Follow-up:** Pair this with the inverse habit — when reading existing code, ask of every method "is this where this responsibility should live?" That's how you spot legacy drift before it metastasizes.

---

**Remember:** RDD is not a notation, a framework, or a checklist — it is the habit of asking *who is responsible for what* before writing the first line of code, and refusing to write that line until you can answer.
