# Couplers — Interview Q&A

> 50 questions across all skill levels.

---

## Junior (15 questions)

### Q1. Name the four Couplers.
Feature Envy, Inappropriate Intimacy, Message Chains, Middle Man.

### Q2. What is Feature Envy?
A method more interested in another class's data than its own. Cure: Move Method to where the data lives.

### Q3. What is Inappropriate Intimacy?
Two classes that know too much about each other's internals — direct field access, override of protected methods, shared private state.

### Q4. What's a Message Chain?
A long chain of method calls navigating object structure: `a.getB().getC().getD()`.

### Q5. Cure for Message Chains?
Hide Delegate — add a method on the first object that does the navigation internally, returning the final value.

### Q6. What's a Middle Man?
A class whose only role is forwarding methods to another. No value-add.

### Q7. Cure for Middle Man?
Remove Middle Man — let callers use the delegate directly. Or, if some forwards add value (caching, validation), keep those and remove the rest.

### Q8. What's "Tell, Don't Ask"?
Don't ask an object for its data and act on it; tell it what to do. Cures Feature Envy. Object encapsulates its own behavior.

### Q9. Demeter's Law — what does it say?
"Talk only to your immediate friends." A method should call: itself, its fields, its parameters, locally created objects. Not friends-of-friends.

### Q10. Builder pattern chain — Message Chain smell?
No. Builders are designed for chaining; each call returns the same builder. The smell is *navigating others' structure*, not using a fluent API.

### Q11. Why is Feature Envy bad?
- Logic lives apart from its data → harder to maintain.
- Donor object can't enforce its invariants if external code does the work.
- Tests have to set up the donor extensively to test the envious method.

### Q12. Cure for Inappropriate Intimacy?
Move Method / Move Field — put behavior with its data. Or Hide Delegate when intimacy is via long chains. Or Replace Inheritance with Delegation when intimacy is via subclass.

### Q13. Adapter class — Middle Man smell?
No. An adapter translates between interfaces — that's value-add. Pure forwarding without translation is the smell.

### Q14. A cure for Message Chain adds delegate methods. Could that create Middle Man?
Yes. Hide Delegate aggressively → wrapper class with only delegates → Middle Man. Balance: forward what callers genuinely use as a single conceptual call.

### Q15. Inappropriate Intimacy in Python — possible despite no `private`?
Yes. Convention-private fields (`_name`) reached into by other classes are still the smell. Python relies on conventions, not enforcement.

---

## Middle (15 questions)

### Q16. When does Feature Envy *not* apply (genuinely)?
When a method coordinates 3+ objects equally — no single class is the "envied" one. Coordinator methods on a service class are valid.

### Q17. Bidirectional association — when to keep, when to break?
Keep when both sides genuinely query the relationship. Break (Change Bidirectional to Unidirectional) when only one side queries. Reduces intimacy.

### Q18. Hide Delegate cures Message Chains. When does it harm?
When applied aggressively without judgment, it produces Middle Man. Hide what callers conceptually use; expose what the abstraction is for.

### Q19. Anemic Domain Model and Couplers — connection.
Anemic models (data without behavior) cause Feature Envy in service classes. Cure both with Move Method onto the domain.

### Q20. What's the "Tell, Don't Ask" decision criterion?
If the action depends primarily on the object's state, the object should perform the action. If the caller has additional context the object doesn't know, the caller may legitimately ask first and act.

### Q21. Architectural Coupler at service level — example?
ServiceA reading from ServiceB's database directly = Inappropriate Intimacy at architecture scale. Cure: A consumes B via API; B owns its schema.

### Q22. Distributed Message Chain — diagnostic tool?
Distributed tracing (Jaeger, Datadog APM, OpenTelemetry). Look for spans with depth > 3.

### Q23. CQRS — does it reduce Couplers?
Yes. Separating reads and writes lets each model evolve for its own reasons. Read model can denormalize away from the write model — reducing intimacy between them.

### Q24. Inappropriate Intimacy via inheritance — cure pattern?
Replace Inheritance with Delegation. Subclass becomes a wrapper that holds the parent as a field, exposing only what's needed.

### Q25. A method calls 3 collaborators' getters once each, then does work. Feature Envy?
Borderline. If the work uses each result equally, it's a coordinator (legit). If one collaborator is dominant, Move Method to that one.

### Q26. `customer.getOrder()` — chain or method?
One call. Not yet a chain. Becomes a chain at 2+ chained calls.

### Q27. Why is "Inappropriate Intimacy via friend declaration" (C++) a code smell?
`friend` lets one class access another's private members — exactly the smell. C++ is honest about it; many languages just discourage the practice via convention.

### Q28. Sandi Metz: "Acting on object's representation" — relate?
"Acting on representation" = Feature Envy — the caller knows the donor's internal structure and operates on it. The cure is to act through the donor's interface (Tell, Don't Ask).

### Q29. Streams API in Java — does it inherently violate Demeter?
No. `list.stream().filter().map().collect()` is a fluent API on the Stream. The chain doesn't navigate someone else's structure; it's the Stream's designed surface.

### Q30. Message Chains in microservices — fix with what pattern?
Event-driven architecture. Replace synchronous chains with event publication and subscription. Each service reacts independently. Latency drops; coupling becomes temporal (via events) instead of structural.

---

## Senior (10 questions)

### Q31. Hexagonal architecture — Coupler relevance?
Cures Inappropriate Intimacy at architectural scale. The domain core is isolated; adapters wrap infrastructure. Domain doesn't know about databases, queues, or HTTP — they're outside the hexagon.

### Q32. DDD aggregate boundaries — relate to Demeter?
DDD's aggregate root mediates external access to the aggregate's children. External code only talks to the root — Demeter at architectural scale.

### Q33. Saga pattern — when?
For distributed operations that must be transactional but can't fit in one ACID transaction. Replaces sync chains with event-driven workflows + compensating actions.

### Q34. Distributed monolith — symptom and cure?
Symptom: services that always deploy together. Cure: redraw boundaries (often via Conway's Law: services match teams), decouple via events.

### Q35. JDepend's afferent and efferent coupling — what to monitor?
- High Ca (many depend on this): foundational packages; refactoring risky but high-value.
- High Ce (this depends on many): "leaf" packages; refactoring local but reveals architectural rot.
- Both high: tangled hotspot; biggest refactoring opportunity.

### Q36. Refactoring Inappropriate Intimacy at DB level — playbook.
1. Choose owner of the table.
2. Define API contract for the data.
3. Migrate non-owners to consume via API.
4. Eventually, table is fully owned; non-owners no longer touch it directly.

Months-long process; each step incremental.

### Q37. ArchUnit fitness function for Demeter?
```java
methods().that().areDeclaredInClassesThat().resideInAPackage("..domain..")
         .should().notCallMethod(/* via reflection on parameter classes */ ...);
```

Demeter is hard to enforce purely via static rules; useful approximations include "no chained method calls > 2" and "no public fields."

### Q38. Repository pattern — Middle Man or legitimate?
Legitimate. The repository abstracts persistence — its forwarding (`save`, `findById`) is value-add (encapsulating ORM details, allowing test mocks). The smell is when the repository adds *zero* value beyond what the underlying ORM provides.

### Q39. Why does "shared mutable state" between services manifest as Coupler?
Two services modifying the same data create temporal coupling: order matters, race conditions appear, deployments must coordinate. Same as Inappropriate Intimacy at architecture level.

### Q40. Event sourcing — relate to Couplers.
Event sourcing makes events the source of truth. Services consume events to derive state. This decouples *temporal* dependencies (services don't synchronously call each other) but creates *event* coupling (everyone depends on the event schema). Trade-off, not free.

---

## Professional (10 questions)

### Q41. JIT inlining for Hide Delegate methods — cost?
If the delegating method is small and monomorphic, JIT inlines into callers; chain links also inline. Net machine code = same as the original chain. Hide Delegate is a *human* improvement, not a runtime change.

### Q42. `final` for delegate fields — why important?
Allows JIT to assume the field doesn't change post-construction; can devirtualize calls through it. Without `final`, the JIT may treat the call as dynamic dispatch.

### Q43. `@Contended` for Inappropriate Intimacy — when?
When two threads modify different fields on the same object frequently. Padding via `@Contended` puts each field in its own cache line, eliminating false sharing.

### Q44. Distributed tracing chain depth — what's a healthy max?
Subjective, but ~3-4 sync hops is a soft ceiling. Beyond, latency tail multiplies; reliability decreases. Asynchronous fan-out trees can go deeper without the latency penalty.

### Q45. Idempotency keys — why mandatory in distributed chains?
Retries are inevitable in distributed systems. Without idempotency, retries cause duplicate work (charge twice, ship twice). Keys let consumers dedupe by ID.

### Q46. Caffeine vs hand-rolled cache for Middle-Man caching wrapper?
Use Caffeine (or similar mature library). Hand-rolled caches usually have bugs (concurrency, TTL, invalidation). Caffeine handles them correctly with high performance.

### Q47. PGO in Go — relate to Couplers?
PGO devirtualizes hot interface calls. A Go interface used for Strategy or DI (forms of decoupling) becomes monomorphic after PGO if profiles show one type dominates. Decoupling is "free" with PGO.

### Q48. False sharing in immutable data — possible?
No (immutable can't be written). False sharing requires concurrent *writes*. Immutable data structures + functional updates eliminate the class of problems.

### Q49. Method chain optimization in browsers (V8) — analogous?
V8 inlines monomorphic call sites similarly to HotSpot. A chain `a.b().c().d()` is fully optimized if all sites are mono. Megamorphic sites pay the penalty.

### Q50. Why does Demeter at runtime hardly matter, but at design time it does?
Runtime: inlining, devirtualization, modern hardware all collapse the perf cost of "chain vs delegate." Design time: humans suffer when changes ripple through chained dependencies. Demeter is for human readers, not the CPU.

---

## Cheat sheet

| Smell | Telltale | Primary cure |
|---|---|---|
| **Feature Envy** | Method uses another class's getters more than its own fields | [Move Method](../../02-refactoring-techniques/02-moving-features/junior.md) |
| **Inappropriate Intimacy** | Two classes share each other's private state | [Move Method](../../02-refactoring-techniques/02-moving-features/junior.md), [Hide Delegate](../../02-refactoring-techniques/02-moving-features/junior.md) |
| **Message Chains** | `a.b().c().d()` | [Hide Delegate](../../02-refactoring-techniques/02-moving-features/junior.md) |
| **Middle Man** | Class forwards most calls without value-add | [Remove Middle Man](../../02-refactoring-techniques/02-moving-features/junior.md) |

> **Demeter + Tell-Don't-Ask** are the two principles behind cures for all four smells.
