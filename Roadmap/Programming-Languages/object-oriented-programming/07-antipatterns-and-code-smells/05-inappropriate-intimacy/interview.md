# Inappropriate Intimacy — Interview

Twenty questions and crisp answers. Use them to rehearse for design rounds and senior code-review conversations.

### Q1. What is Inappropriate Intimacy in your own words?

Two classes that depend on each other's internals — fields, helpers, or private state — instead of communicating through a small public protocol. The symptom is that you cannot change one without dragging the other along.

### Q2. How does it differ from Feature Envy?

Feature Envy is one-directional: class `A` reaches into class `B` because `A`'s logic really belongs on `B`. Inappropriate Intimacy is mutual — both `A` and `B` reach into each other. The fix for Feature Envy is "move method"; the fix for Intimacy is "rebalance behaviour or insert a mediator".

### Q3. What are the most common signals in Java code?

Bidirectional `@OneToMany`/`@ManyToOne`, mutually recursive `equals`/`toString`, services holding direct references to each other's caches, `@Data` on entities, public fields on collaborating classes, and ArchUnit rules failing with cyclic dependencies between packages.

### Q4. Why is `@Data` on a JPA entity dangerous?

Lombok generates `toString`, `equals`, and `hashCode` over every field, including lazy collections. Result: `StackOverflowError` on bidirectional `toString`, `LazyInitializationException` on `hashCode`, and `O(n)` set operations once the collection is loaded.

### Q5. How do you correctly implement equals/hashCode on a JPA entity?

Compare by id only; return a constant hashCode per class. Vlad Mihalcea's pattern:

```java
@Override public boolean equals(Object o) {
    return o instanceof Order other && id != null && id.equals(other.id);
}
@Override public int hashCode() { return getClass().hashCode(); }
```

This is safe before and after persistence and never triggers a fetch.

### Q6. What does JPMS give you that package-private access does not?

JPMS makes visibility cross-module. A `public` class in a non-exported package is invisible outside the module. Package-private only protects within a single classloader/package boundary and is easily bypassed by placing a class in the same package name in another JAR.

### Q7. When should you use a qualified export in `module-info.java`?

When one specific friend module needs access to an otherwise hidden package — typical examples are integration test modules or sibling adapters that share infrastructure. `exports com.shop.spi to com.shop.tests;` makes the trust explicit and reviewable.

### Q8. How do you encode "domain has no framework imports" as a test?

```java
@ArchTest static final ArchRule pure = noClasses()
    .that().resideInAPackage("..domain..")
    .should().dependOnClassesThat().resideInAnyPackage(
        "javax.persistence..", "jakarta.persistence..",
        "org.springframework..", "com.fasterxml.jackson..");
```

ArchUnit runs as a JUnit test; the CI build fails on the first import.

### Q9. What is CBO and what threshold do you treat as a warning?

Coupling Between Objects — number of distinct classes a class is coupled to. For a domain class anything above 8 is a warning; for orchestrators 12–15; above 20 needs refactoring.

### Q10. What is MPC and when does it signal intimacy?

Message Passing Coupling — the number of method calls a class makes to others. High MPC with low CBO is the classic intimacy footprint: many messages directed at a small set of partners.

### Q11. A bidirectional `@OneToMany`/`@ManyToOne` is suddenly causing infinite JSON output. What do you change?

Add `@JsonManagedReference` on the parent side, `@JsonBackReference` on the child side; or stop returning the entity and map to a DTO. Long-term: do not return entities from controllers.

### Q12. Why do you discourage entities at the API boundary?

The API contract becomes a copy of the persistence schema. Every change to a column triggers a breaking change for clients, and every detail that the entity carries leaks to consumers. DTOs decouple the schema from the contract.

### Q13. How does the hexagonal architecture prevent intimacy?

The domain depends only on outbound ports (interfaces it defines). Adapters depend on ports. The domain never imports persistence or framework code, so it cannot reach into infrastructure even by accident. ArchUnit makes the rule executable.

### Q14. What is the difference between fan-in and fan-out?

Fan-out is how many classes a class depends on (outgoing edges). Fan-in is how many classes depend on a class (incoming edges). High fan-out is a needy class. High fan-in on a stable abstraction is fine; high fan-in on a volatile class is a maintenance nightmare.

### Q15. What does a bidirectional edge between two domain entities tell you?

That the design treats them as one aggregate but pretends they are two, or that some helper method ended up on the wrong side. Either merge the responsibility into one aggregate root or extract a third class that owns the coordination.

### Q16. Two services need to invalidate each other's caches. How do you decouple them?

Publish a domain event from the side that changed and let the cache owner subscribe and evict itself. Neither service references the other; the event bus is the boundary.

### Q17. Default fetch for `@ManyToOne` is EAGER. What is the recommendation?

Set `fetch = FetchType.LAZY` on every `@ManyToOne` and `@OneToOne`. Add explicit `join fetch` to the read paths that genuinely need the parent. Default-eager turns intimate bidirectional models into N+1 query storms.

### Q18. A test sets a private field by reflection. Why is that an intimacy bug?

The test now depends on the implementation detail. Renaming the field breaks the test silently; refactoring is harder than it should be. Inject the value the same way production does — through the constructor or a setter — and the test stays stable.

### Q19. Two classes are tightly coupled but conceptually belong together (e.g., `Order` and `OrderLine`). Is that Inappropriate Intimacy?

No. They form an aggregate. The aggregate root (`Order`) controls the lifecycle of its parts (`OrderLine`). Intimacy refers to coupling *across* aggregate or module boundaries, not within them.

### Q20. How do you measure success after a decoupling refactor?

- CBO and MPC for the targeted classes drop.
- The bidirectional edge between them disappears.
- The number of classes that need recompilation when one changes drops measurably.
- New ArchUnit/JPMS rules guard the boundary in CI.
- Tests for the surviving classes can run in isolation, without spinning up the other side.

## Memorize this

- Intimacy is mutual; Feature Envy is one-way — fixes differ.
- `@Data` on entities is a recursion bug waiting to happen.
- Identity (`equals`/`hashCode`) on entities is the `id` only.
- JPMS hides packages; ArchUnit forbids intent; together they make boundaries real.
- DTOs at the API boundary; ports at the persistence boundary.
- Track CBO and MPC over time — slope matters more than any single reading.
