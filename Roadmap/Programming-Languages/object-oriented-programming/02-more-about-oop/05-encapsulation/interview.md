# Encapsulation — Interview Q&A

50 questions on hiding state, controlling mutation, and modern Java's encapsulation toolkit.

---

## Section A — Basics (1-10)

**Q1. What is encapsulation?**
A: Bundling data with the methods that operate on it, hiding internal state behind a controlled public API. Mutation goes only through methods that can validate and enforce invariants.

**Q2. Why use encapsulation?**
A: Protects invariants, enables safe refactoring, simplifies thread safety, makes the code testable.

**Q3. What's the difference between encapsulation and abstraction?**
A: Encapsulation hides internal state; abstraction hides implementation choices. Both shrink the public surface.

**Q4. What are Java's access modifiers?**
A: `public`, `protected`, package-private (default), `private`. Listed from most to least visible.

**Q5. What's the default access in Java?**
A: Package-private — accessible from the same package only, not from outside.

**Q6. What's the rule of thumb for choosing access modifiers?**
A: Default everything to `private`. Make it `public` only if it's part of the API. Use `protected` only when truly needed by subclasses.

**Q7. Should fields be public?**
A: Almost never. Public fields commit you to a representation and prevent validation. Use private fields with public methods.

**Q8. What are getters and setters?**
A: Methods that read (getter) or write (setter) a private field, often with validation. Sometimes called accessors and mutators.

**Q9. Should every field have a getter?**
A: No. Only fields that callers genuinely need to read should have getters. Each getter is a public commitment.

**Q10. Are records a form of encapsulation?**
A: Yes. They auto-generate private final fields and accessors but no setters, giving immutable encapsulation.

---

## Section B — Design (11-20)

**Q11. What's the "tell, don't ask" principle?**
A: Tell objects what to do (`account.withdraw(amount)`) instead of asking them for data and deciding externally (`if (account.balance() >= amount) ...`). Keeps rules inside the object.

**Q12. What's defensive copying?**
A: Copying mutable inputs/outputs to prevent callers from mutating internal state. `this.list = List.copyOf(list);` in a constructor.

**Q13. What's an invariant?**
A: A property that always holds for valid instances. E.g., "balance is non-negative." Encapsulation exists to protect invariants.

**Q14. Why are immutable types easier to encapsulate?**
A: No mutation means no invariant-breaking after construction. Validation happens once. Thread-safe automatically. Can be safely shared.

**Q15. What's the cost of public mutable fields?**
A: Anyone can modify them. Invariants can't be enforced. Refactoring is impossible (callers depend on the field). Threads can race.

**Q16. How does the Builder pattern relate to encapsulation?**
A: Provides controlled construction for complex objects. The Builder collects state via chained setters; `build()` produces an immutable target with all validation done.

**Q17. What's a "leaking abstraction" via encapsulation?**
A: When implementation details escape — e.g., returning a mutable internal collection. The class can't change its impl without breaking callers.

**Q18. Should classes default to `final`?**
A: Yes, per Effective Java. Design for inheritance explicitly or forbid it. Records are final by default.

**Q19. What's the Single Responsibility Principle for encapsulation?**
A: A class should have one reason to change. If it has many unrelated responsibilities, encapsulation breaks (every change risks every responsibility).

**Q20. How does dependency injection support encapsulation?**
A: DI passes collaborators in via constructor. Collaborators are private fields. The class hides which DB, mailer, cache it uses.

---

## Section C — Java mechanics (21-30)

**Q21. Can you access a private field via reflection?**
A: Yes, after `setAccessible(true)`. With JPMS, the package must also be `opens` to your module.

**Q22. What's `setAccessible(true)` for?**
A: Tells reflection to skip the access check. Used by frameworks (Hibernate, Jackson, Spring) and tests.

**Q23. What's a nestmate?**
A: A class in the same nest (same top-level class + nested types). Java 11+ allows direct access between nestmates without bridge methods.

**Q24. How does JPMS strengthen encapsulation?**
A: Modules declare which packages are exported. Non-exported packages are inaccessible to other modules even if classes are public. Reflection requires `opens`.

**Q25. What's the difference between `exports` and `opens`?**
A: `exports` allows compile-time dependency; `opens` allows reflective access. Together: full access. Either alone is restrictive.

**Q26. Can a `private` method be overridden?**
A: No. Private methods aren't visible to subclasses, so they're never overridden — same-named subclass methods are independent.

**Q27. What are sealed types?**
A: Classes/interfaces with a `permits` clause restricting which types can extend them. Encapsulates the hierarchy itself.

**Q28. How do records prevent breakage?**
A: Auto-generated, immutable, final. No setters, so invariants set in constructor stay valid forever.

**Q29. What's a compact constructor in records?**
A: A shortened constructor form that lets you validate or normalize parameters before they're assigned to components.

**Q30. Why is `protected` tricky?**
A: It's accessible to subclasses *and* the same package. Once you publish a `protected` member, every subclass depends on it. Use sparingly.

---

## Section D — Modern Java (31-40)

**Q31. How does `java.lang.invoke.MethodHandles.privateLookupIn` work?**
A: Returns a `Lookup` with full access to a target class's private members. Requires the source module to have `opens` to the target's module.

**Q32. What's the difference between `unmodifiableList` and `List.copyOf`?**
A: `unmodifiableList` returns a view — reads pass through to the underlying list. `List.copyOf` returns a snapshot — independent of future mutations to the source.

**Q33. Why are records preferred over POJOs with getters?**
A: Less boilerplate, immutable, auto equals/hashCode/toString, JIT-friendly. POJOs require manual maintenance.

**Q34. Why are static factories sometimes preferred over public constructors?**
A: Can return cached instances, can return subclass types, have meaningful names. Effective Java Item 1.

**Q35. What's the lazy holder idiom for singletons?**
A: A static nested class holds the instance; loading the holder triggers initialization. Thread-safe, lazy, no synchronization.

**Q36. What's the anemic domain model anti-pattern?**
A: Classes with only data and getters/setters, no behavior. The data goes through "service" classes for logic. Violates encapsulation — invariants can't be enforced.

**Q37. What's the rich domain model?**
A: Classes that own both data and behavior. `account.withdraw(amount)` rather than `accountService.withdraw(account, amount)`.

**Q38. How does pattern matching change encapsulation?**
A: Sealed types + pattern matching enable exhaustive case handling without exposing internals. The variants are type-safe.

**Q39. What does `var` have to do with encapsulation?**
A: Nothing directly — `var` is just type inference. But it can make code less verbose, encouraging better encapsulation by avoiding boilerplate.

**Q40. Should you use `final` on local variables?**
A: It's optional but often beneficial. Communicates "this won't be reassigned." Doesn't affect performance — locals are usually optimized regardless.

---

## Section E — Edge cases (41-50)

**Q41. Can a record be mutable?**
A: Strictly no — components are private final. But if a component is itself mutable (e.g., `List<String>`), the record can be mutated through that reference. Defensive copy in compact constructor solves this.

**Q42. What's wrong with `Cloneable`?**
A: Marker interface with no methods. The actual `clone()` is on `Object` and behaves strangely (shallow copy, careful subclass overrides). Effective Java says don't use it.

**Q43. Why is serialization a threat to encapsulation?**
A: It reads/writes private fields, bypassing constructors and validation. Custom `readObject` / `writeReplace` can mitigate; or use serialization proxy idiom.

**Q44. How do you protect against subclasses violating invariants?**
A: Make the class `final` if subclassing isn't intended. If subclassing is needed, document the invariants and which methods subclasses must respect.

**Q45. What's a "smart enum"?**
A: An enum that encapsulates per-constant behavior:
```java
enum Op { PLUS { int apply(int a, int b) { return a+b; } }, MINUS { int apply(int a, int b) { return a-b; } }; abstract int apply(int a, int b); }
```
Each constant's behavior is co-located with its data, fully encapsulated.

**Q46. How do you encapsulate concurrent access?**
A: Hide synchronized state. Provide methods that lock internally. Callers don't see locks; they just call methods that are guaranteed safe.

**Q47. What's the law of Demeter?**
A: Don't talk to strangers — only call methods on your direct collaborators, not on objects returned from them. `order.customer().address().city()` is a violation.

**Q48. What's the difference between a record's accessor and a getter?**
A: Records use the field name as the accessor name (`x()`, not `getX()`). Pre-record getter conventions used `getX`/`isX`.

**Q49. How does `volatile` relate to encapsulation?**
A: `volatile` is part of how a class encapsulates its threading guarantees. Callers don't see `volatile`; they just see thread-safe methods.

**Q50. What's the future of encapsulation in Java?**
A: Trends: more declarative tools (records, sealed, modules). More compiler-enforced invariants (compact constructors, pattern matching exhaustiveness). Strong encapsulation by default in JPMS.

---

## Bonus — staff/architect (51-55)

**Q51. How do you balance strict encapsulation against framework needs?**
A: Use `opens` (JPMS) for packages frameworks need. Keep purely internal packages strict. Document framework requirements clearly. For DI containers, prefer constructor injection — works with private final fields.

**Q52. What's your strategy for legacy code with public fields everywhere?**
A: Branch by abstraction. Step 1: introduce getters/setters. Step 2: change callers. Step 3: make fields private. Step 4: add validation. Don't try to do all four at once.

**Q53. When does over-encapsulation hurt?**
A: When every getter/setter just delegates without real behavior. When DTOs have validation logic that doesn't belong. When frameworks fight you constantly. When tests have to mock the world.

**Q54. How do you encapsulate a long-running operation?**
A: Hide it behind a method that returns a Future or async result. The object encapsulates threading, error handling, retries. Callers wait on the result.

**Q55. What's the relationship between encapsulation and microservices?**
A: Microservices encapsulate at the network boundary instead of class boundary. Each service has private state (database, in-memory) and a public API (HTTP/gRPC). Same principle, different scope.

---

**Use this list:** mix one Q from each section. Strong candidates apply the principles to design problems, not just memorize definitions.
