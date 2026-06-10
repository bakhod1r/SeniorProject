# DDD Tactical: Domain Services — Interview

> **What?** Twenty questions and answers covering the conceptual, architectural, and Java-specific aspects of Domain Services. Designed to cover what a senior interviewer probes for: do you understand *when* a Domain Service is the right tool, *where* it sits in the architecture, *why* the contract is what it is, and *how* it interacts with frameworks, transactions, sagas, and the rest of the DDD tactical toolbox.
> **How?** Read each answer, then close the page and try to reproduce the key points in your own words. The hardest questions are the ones that ask you to *refuse* to create a Domain Service — those are the ones senior interviewers care about most.

---

**1. What is a Domain Service, in one sentence?**

A *stateless, domain-typed operation* that expresses a piece of domain logic which doesn't naturally belong to any single Entity or Value Object — introduced by Eric Evans in *Domain-Driven Design* (2003), Chapter 5.

---

**2. When should you create a Domain Service?**

When (a) the operation crosses two or more aggregates, or (b) the data needed comes from multiple sources and the result belongs to none of them, or (c) the operation is a policy/strategy with polymorphic variants. If none of these apply, the behaviour belongs on an Entity or Value Object instead.

---

**3. When should you *refuse* to create a Domain Service?**

When the operation reads or mutates only one entity's state. That is a method on the entity, not a service. Reaching for a service in this case produces the *anaemic domain model* (Fowler, 2003) — entities become data carriers and the model loses its domain language.

---

**4. How is a Domain Service different from an Application Service?**

Domain Services compute domain logic; Application Services orchestrate use cases. Application Services own the transaction boundary (`@Transactional`), load and save via repositories, publish events, and coordinate notifications. Domain Services receive already-loaded aggregates and contain no I/O, no transactions, no transport concerns.

---

**5. How is a Domain Service different from an Infrastructure Service?**

Infrastructure Services *implement* a port defined in the domain (e.g., `SmtpNotificationAdapter implements NotificationPort`). They wrap a technology — JDBC, SMTP, S3, Kafka. A Domain Service depends on the port but never on the implementation; it doesn't know which technology is on the other side.

---

**6. Is Spring's `@Service` annotation the same as a DDD Domain Service?**

No. `@Service` is a Spring stereotype meaning "component-scan this and treat it as service-layer". The annotation is about wiring, not layering. You can put `@Service` on a Domain Service, an Application Service, or an Infrastructure adapter and Spring won't object — the conflation is purely human.

---

**7. Why must a Domain Service be stateless?**

Two reasons. Conceptually, a Domain Service is a function from domain inputs to domain outputs; mutable state contradicts that. Practically, services are typically singletons shared across threads, so any mutable field is a race condition waiting to happen.

---

**8. Where do you put `@Transactional` — on the Domain Service or on the Application Service?**

On the Application Service, always. Transactions are an infrastructure concern; the domain shouldn't know they exist. Putting `@Transactional` on the Domain Service fragments the transaction boundary, surprises future readers, and often fails silently due to Spring's self-injection AOP quirks.

---

**9. Can a Domain Service depend on a repository?**

It can depend on the *repository interface* defined in the domain layer. It must not depend on a concrete implementation like `JpaAccountRepository`. Many practitioners (Vernon included) prefer to keep loading out of the Domain Service entirely — pass already-loaded aggregates in. Both styles are defensible; depending on a concrete adapter is not.

---

**10. What types are allowed in a Domain Service's method signatures?**

Only domain types: Entities, Value Objects, Domain Events, domain primitives, and Java collections of these. Forbidden: DTOs, framework types (`HttpServletRequest`, `ResponseEntity`), persistence types (`ResultSet`, `EntityManager`), wire formats (Jackson nodes, Protobuf messages).

---

**11. What is the anaemic domain model and how do Domain Services contribute to it?**

Fowler's term (2003) for a model where entities are bags of getters/setters with no behaviour, and all logic lives in `*Service` classes. Developers slide into it by reflexively creating a service every time they need to do something with an entity. The cure: behaviour on entities first; services only when no single entity is the natural owner.

---

**12. Should a Domain Service be pure (no side effects)?**

Where the domain permits, yes. Pure services compose, parallelise, and test trivially. When mutation is necessary — `TransferService.transfer(...)` mutates two accounts — the mutation should happen via methods on the entities, not by direct field access from the service.

---

**13. What's the difference between a Domain Service and a Policy in DDD?**

A *Policy* (Evans Chapter 10) is a Domain Service shaped as a Strategy pattern — same interface, multiple implementations encoding different domain rules. `ShippingCostPolicy` with `DomesticShippingCostPolicy` and `InternationalShippingCostPolicy` is the canonical shape. So a Policy is a *kind of* Domain Service, named with the `Policy` suffix for clarity.

---

**14. How do Domain Services participate in sagas?**

They play *one step* of the saga, not the saga itself. Each Domain Service implements a local capability (`capture`, `confirm`, `reserve`, `cancel`); the saga coordinator — usually an Application Service or a dedicated process manager — sequences the steps and triggers compensating actions on failure. The pattern is from Pat Helland's "Life beyond Distributed Transactions" (2007) and elaborated by Vernon in *IDDD* Chapter 13.

---

**15. How do you make a Domain Service idempotent?**

Adopt the *idempotent receiver* pattern: the caller supplies an idempotency key (typically a UUID); the service looks up prior results keyed by that idempotency key before performing the side effect; if a prior result exists, it returns that result instead of repeating the work. This is the standard approach in payment systems (Stripe, AWS) and is essential for any command-style Domain Service that can be retried.

---

**16. Can a Domain Service be a static method?**

Mechanically yes — a static method is stateless. But you lose dependency injection (hard to swap an `ExchangeRatePolicy` for testing), polymorphism (no `interface` for variants), and testability (callers couple to the exact static symbol). Use an instance class with `final` fields and constructor injection; the JVM treats singleton invocation essentially the same as a static call after warm-up.

---

**17. How do you name a Domain Service?**

After the *capability*, expressed as a verb in the Ubiquitous Language. `TransferService`, `PricingService`, `RoutingService`. Avoid noun-based names that describe data (`AccountService`, `OrderHelper`) and meaningless suffixes (`Manager`, `Util`, `Processor`). For polymorphic strategies, use the `Policy` or `Strategy` suffix.

---

**18. How do you unit-test a Domain Service?**

With vanilla JUnit, no Spring container, no embedded database. Construct the service with `new`, passing in hand-rolled stub or lambda implementations of its ports. If the test requires `@SpringBootTest` or Testcontainers, the service has leaked infrastructure and needs refactoring. This is the strictest test for whether a class is *really* a Domain Service.

---

**19. What's the relationship between Domain Services and Aggregates?**

Aggregates own their internal consistency; Domain Services coordinate *across* aggregates. The classic example: `TransferService` mutates two `Account` aggregates, but each `Account` enforces its own invariants (no negative balance, currency rules) — the service only orchestrates the dual operation. If you find a Domain Service reaching inside an aggregate to mutate fields, you've broken encapsulation; the service should ask the aggregate to do the work.

---

**20. Give an example where extracting a Domain Service is wrong, and one where it's right.**

*Wrong:* `OrderStatusService.markShipped(Order o)`. The order owns its status; the transition belongs on `Order.markShipped()`. Extracting it as a service makes `Order` anaemic and fragments behaviour for no gain.

*Right:* `RoutingService.shortestRoute(Graph g, Node from, Node to)`. The result (a `Route`) belongs to neither the graph nor either node; the algorithm is a domain capability (and is polymorphic via different `CostPolicy` implementations); no single entity is the natural owner. Domain Service it is.

---

**Bonus pointers.**

- Read Eric Evans, *Domain-Driven Design* (2003), Chapter 5 ("A Model Expressed in Software") and Chapter 10 ("Supple Design"). The original treatment is short and worth reading carefully.
- Read Vaughn Vernon, *Implementing Domain-Driven Design* (2013), Chapter 7 ("Services") and Chapter 13 ("Integrating Bounded Contexts"). Vernon's chapter is the practical complement to Evans.
- Martin Fowler, "Anemic Domain Model" (2003) — short essay, named the most common misuse.
- Pat Helland, "Life beyond Distributed Transactions" (2007) — the saga / compensating-action foundation.

---

**Memorize this:** A Domain Service is a *stateless verb in the Ubiquitous Language*. Default to behaviour on entities; reach for a service when the verb has no clear noun owner. Keep transactions, persistence, and transport out of it. Singletons, `final` fields, port-only dependencies, and unit-testable without a framework — those five traits separate a real Domain Service from a `*Service`-suffixed god class.
