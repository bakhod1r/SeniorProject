# Anemic Domain Model — Interview

> Reference: Martin Fowler, *AnemicDomainModel* (https://martinfowler.com/bliki/AnemicDomainModel.html), 2003.

Twenty questions ordered roughly by difficulty. Read the question, answer aloud or on paper, then check.

## 1. What is the Anemic Domain Model antipattern in one sentence?

A domain class that holds state through public getters and setters but has no behavior — all business rules live in service classes, so the class itself cannot defend its invariants.

## 2. Who named it and where?

Martin Fowler, on his bliki at `martinfowler.com/bliki/AnemicDomainModel.html`, 2003. He attributes the underlying critique to Eric Evans's *Domain-Driven Design* (2003).

## 3. Why is it considered an antipattern if so many production systems use it?

Because it spreads invariants across many service classes; a new caller can mutate the object into an invalid state by missing one of the rules. The class advertises that it's an object but behaves like a struct, violating the encapsulation contract OOP is built on.

## 4. Isn't a JavaBean with getters and setters the canonical Java style?

The JavaBean spec was designed for visual editors and reflection-based frameworks, not for domain modeling. Using JavaBeans for DTOs, configuration, and serialization is fine. Using them for the domain layer is the anemic antipattern.

## 5. Can you give a concrete example of anemia causing a bug?

`Order` exposes `setStatus(OrderStatus)`. The `OrderService.ship()` method checks that the order is paid before setting status to `SHIPPED`. A new feature in `RefundService` calls `order.setStatus(OrderStatus.SHIPPED)` directly to "fix" a state — bypassing the check. Result: a refunded order goes back to shipped without payment.

## 6. What's the cure?

Move behavior onto the class. Replace setters with intent methods (`ship()`, `cancel(Reason)`, `markPaid()`) that check preconditions before mutating. Validate invariants in the constructor or static factory so the object cannot exist in an invalid state.

## 7. Define Value Object and give a Java example.

A Value Object is immutable, has no identity, and is equal by its components. Example:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        if (amount == null || currency == null) throw new NullPointerException();
        if (amount.scale() > currency.getDefaultFractionDigits())
            throw new IllegalArgumentException("scale");
    }
    public Money add(Money other) { /* same-currency check, return new Money */ }
}
```

## 8. Define Entity vs Aggregate Root.

An Entity has identity that persists across state changes (`equals` based on ID). An Aggregate Root is an Entity that guards a consistency boundary — the only entry point for modifications to entities inside the aggregate. External code talks to the root, not to nested entities.

## 9. How do you persist a rich aggregate with JPA when JPA wants setters?

JPA needs a no-arg constructor and field access — both can be non-public. Make the no-arg constructor `protected`, use field access (`@Access(AccessType.FIELD)`), and never declare public setters. Hibernate populates fields through reflection without setters.

## 10. How do you map DTOs to entities without exposing setters?

Use MapStruct or hand-written mappers that call the entity's static factory and behavior methods. For records and DTOs, Jackson 2.12+ uses canonical constructors via reflection — no setters needed in either direction.

## 11. What's the relationship between Anemic Domain Model and the Transaction Script pattern?

Anemic Domain Model is what you get when you combine OO classes with Transaction Script logic. Transaction Script (procedural code organized around use cases) is a *legitimate pattern* for simple CRUD apps — Fowler doesn't object to it. He objects to dressing it up in classes-with-only-getters-and-setters and calling it "OOP".

## 12. When is an anemic data class the right answer?

DTOs at API boundaries; read models / projections in CQRS; event payloads; configuration property holders; entities for legacy schemas you can't refactor; reference data tables that never change.

## 13. How does CQRS change the conversation?

CQRS separates write and read sides. Write side uses rich aggregates that enforce invariants. Read side uses flat, anemic projections optimized for display. Anemia is correct on the read side because there are no invariants to protect — the data is already validated when it was written.

## 14. What ArchUnit rule would you add to a project to prevent anemia?

A test that forbids public methods starting with `set` in the domain package, plus a check that every `@Entity` class declares at least one non-accessor public method.

```java
methods()
    .that().arePublic().and().haveNameStartingWith("set")
    .should().notBeDeclaredInClassesThat().resideInAPackage("..domain..");
```

## 15. How do you measure anemia quantitatively?

Method-to-field ratio (MFR) below 0.3 in a domain class is a red flag. LCOM4 close to the field count is another. Mutator-to-invariant ratio above 1 means at least one invariant is unguarded.

## 16. What's the performance cost of immutable Value Objects allocating per mutation?

Negligible in hot paths because escape analysis stack-allocates short-lived records and young-gen GC reclaims survivors in nanoseconds. JMH benchmarks routinely show rich-model code performing within 5–15% of anemic code, often faster due to better cache locality and predictable branches.

## 17. Why are records especially good for Value Objects?

Records have final fields, generated `equals/hashCode/toString`, a canonical constructor (where you put validation), and a flat memory layout. They are EA-friendly, and serialization frameworks (Jackson 2.12+, MapStruct) treat them as first-class.

## 18. How do domain events fit into rich models?

A behavior method on an aggregate registers an event on itself when state changes (`registerEvent(new OrderCancelledEvent(...))`). The repository publishes registered events on save — typically through Spring's `ApplicationEventPublisher` or a transactional outbox. Anemic models can't host events because they have no behavior methods to attach the registration to.

## 19. What about validation libraries like Bean Validation (`@NotNull`, `@Email`)?

Bean Validation is excellent at the DTO boundary (incoming HTTP requests). It's a poor substitute for domain invariants because it runs only when explicitly invoked and only on annotated objects. Put `@Email` on the request DTO; put validation logic inside the `Email` Value Object's constructor. Both layers, different concerns.

## 20. If a senior engineer in your team says "anemic models are fine, services keep things simple", how do you respond?

Agree they're fine for genuinely procedural domains (CRUD, ETL, reporting). Push back when the domain has invariants — show concrete bugs caused by service-scattered validation. Offer the CQRS framing: keep services for the read/orchestration side; introduce rich aggregates for the write side where invariants matter. The argument isn't religious; it's about defect rates and the cost of distributed invariants.

## Memorize this

- **One sentence definition:** data class with getters/setters, behavior in services, invariants unenforced.
- **Cure:** intent methods, factory creation, immutable VOs, validation at construction.
- **Acceptable anemia:** DTOs, read models, events, config. Not domain entities.
- **JPA + rich:** non-public no-arg constructor, field access, no public setters.
- **CQRS split:** rich write, anemic read.
- **Metrics:** MFR < 0.3 → red flag; mutators > invariants → unguarded rule.
- **Enforce in CI:** ArchUnit rules ban setters in domain package.
- **Performance:** records + EA make rich models cost-competitive with anemic models.
- **Domain events** require behavior methods — anemia kills them.
- **Bean Validation at boundaries; VO validation in the domain.** Different layers, not substitutes.
