# OO Abusers — Interview Q&A

> 50 questions across all skill levels.

---

## Junior level (15 questions)

### Q1. Name the four OO Abusers.
Switch Statements, Temporary Field, Refused Bequest, Alternative Classes with Different Interfaces.

### Q2. What's the basic Switch Statements smell?
A `switch` (or `if-else` chain) on a type code (`int`, `String`, enum) where each branch does something type-specific. The smell deepens when the same switch repeats in multiple methods.

### Q3. Why is Switch Statements bad?
Adding a new variant requires editing every place that switches. Open/Closed violation. Code duplication. Missing cases easy to overlook.

### Q4. What replaces Switch Statements?
Polymorphism: each variant becomes a class implementing a shared interface; methods that switched on type now call methods on the interface. Compiler ensures every variant implements every operation.

### Q5. Define Temporary Field.
A field on a class that is meaningful only sometimes — `null` (or empty, or default) the rest of the time. Readers can't tell when the field is valid.

### Q6. Cure for Temporary Field?
Extract Class — move the temporary fields into a class that exists only when they're meaningful. Or Replace Method with Method Object when the temporary is local to one long method.

### Q7. What's Refused Bequest?
A subclass that inherits a parent it doesn't fully need: ignores some methods, overrides others to throw, or just doesn't honor the parent's contract.

### Q8. Why is `Penguin extends Bird` problematic?
`Bird.fly()` doesn't apply to penguins. Code that takes a `Bird` and calls `fly()` is broken for penguins. Liskov violation.

### Q9. What's the Liskov Substitution Principle?
If a function works for type T, it must work for any subtype of T. No surprises. Refused Bequest is a Liskov violation.

### Q10. What does Alternative Classes with Different Interfaces mean?
Two classes do similar work but expose unrelated APIs (different method names, parameters, return types). Polymorphism is impossible.

### Q11. Cure for Alternative Classes?
Rename Method to align names; Move Method to align responsibilities; Extract Superclass / Extract Interface to formalize the shared contract.

### Q12. Why is "switch on type" different from "switch on enum"?
"Switch on type" treats type as data. "Switch on enum" treats data as data. The former is the smell; the latter is fine for finite, stable, disjoint values (HTTP status, parser tokens).

### Q13. What's a sealed type?
A type whose set of subtypes is fixed at compile time. The compiler verifies exhaustive pattern matching. Java 17+ `sealed`, Kotlin `sealed class`, Scala `sealed trait`, Rust `enum`.

### Q14. Composition vs inheritance — which to prefer?
Default to composition. Inheritance is right when the relationship is genuinely "is-a" *and* the parent's contract fits exactly. Refused Bequest signals inheritance was wrong.

### Q15. A subclass throws `UnsupportedOperationException` for one parent method. What's that called?
Refused Bequest. Cure: Push Down Method (move that method down to subclasses that support it), Replace Inheritance with Delegation (compose instead), or split the parent.

---

## Middle level (15 questions)

### Q16. When is a switch *not* a smell?
- The values are inherently disjoint (HTTP status, opcode, tag).
- The switch is in one place; no duplication.
- The language has good pattern matching with sealed types (compiler verifies exhaustiveness).
- It's truly performance-critical and benchmarked.

### Q17. Pattern matching on sealed types — same as Switch Statements smell?
Often the *cure*, not the smell. Sealed types are closed; pattern matching is verified exhaustive; adding a variant is a compile error in unmodified call sites — forcing you to think about the new case.

### Q18. Strategy pattern vs Switch Statements — relationship?
Strategy is the polymorphic resolution of "switch on what algorithm." Each branch becomes a Strategy class. The host holds a current strategy and delegates.

### Q19. State pattern vs Switch Statements — relationship?
State is for "switch on what mode the object is in" — the modes change at runtime. Each mode becomes a class; the host delegates to the current state and transitions by swapping it.

### Q20. A class has `passwordResetToken: String?` (nullable). Smell?
Yes — Temporary Field. Cure: extract `PasswordResetSession` value object, created when reset starts, deleted when consumed. Long-lived `User` doesn't hold the temporary.

### Q21. Why is `Stack extends Vector` (Java) a textbook Refused Bequest?
`Stack` exposes `push`/`pop`/`peek`, but inherits all of `Vector`'s 50+ methods (`get`, `set`, `add(int, E)`, etc.). You can mutate a stack via inherited methods, breaking LIFO. JDK kept it for compatibility but recommends `Deque` + `ArrayDeque`.

### Q22. ISP — what is it, how does it relate?
Interface Segregation Principle: don't force clients to depend on methods they don't use. A 30-method interface where most implementations only fill 5 is the smell. Cure: split the interface into smaller cohesive ones.

### Q23. Visitor pattern — when is it the right tool?
When (a) your language lacks pattern matching with sealed types, (b) you can't modify the AST classes, or (c) you have many operations and few stable types — Visitor centralizes the operations. In modern Java/Kotlin/Scala/Rust, sealed + pattern matching often replaces Visitor.

### Q24. A subclass overrides `equals` and forgets `hashCode`. Smell?
Refused Bequest variant — the parent's contract requires `equals` and `hashCode` to be consistent. Tools like SonarQube flag this; the cure is to override both.

### Q25. The Open/Closed Principle in 2024.
"Open for extension, closed for modification" — but with sealed types and pattern matching, "modification" can be safe: adding a variant to a sealed type is a compile error in every match site, *forcing* deliberate change. The principle now reads as "the system should make changes deliberate, not accidental."

### Q26. A 50-field god class with one nullable field. Which smell to fix first?
Probably the field — Temporary Field is local; a 50-field god class is a much bigger refactor (Large Class). Fix the small smell first to build confidence; tackle the god class iteratively.

### Q27. Compose-then-extract or extract-then-compose?
For Refused Bequest: **Replace Inheritance with Delegation** — first introduce a delegate field, then move the parent's behavior to it, then delete the inheritance. Mechanical, low-risk steps.

### Q28. Two services have similar APIs but slightly different — Alternative Classes?
Yes if both are inside one organization and you control both. No if one is third-party (you can't change). For the latter, introduce an adapter on your side.

### Q29. Why is Visitor often called "double dispatch"?
Two virtual calls per visit: `node.accept(visitor)` (resolves on node type) → `visitor.visitX(this)` (resolves on visitor type). The combination resolves both axes — the operation and the data type — at runtime.

### Q30. Sealed types in Kotlin vs. Scala vs. Java — differences?
Similar concept, different syntax and tooling. Kotlin's `sealed class` allows nested subclasses in the same file. Scala's `sealed trait` allows subclasses in the same file. Java's `sealed interface` requires explicit `permits` (subclasses can be in different files, but must be listed). All three give the compiler the closed-set guarantee.

---

## Senior level (10 questions)

### Q31. How do OO Abusers manifest at architectural scale?
- Switch Statements → API gateway with `if (route == ...)` per route
- Temporary Field → service with mutable global state populated in some endpoints
- Refused Bequest → microservice "extending" a base service via shared base image, ignoring most
- Alternative Classes → two microservices solving the same problem with different APIs

### Q32. SOLID and OO Abusers — map principle to smell.
- O (Open/Closed) → Switch Statements
- L (Liskov) → Refused Bequest
- I (Interface Segregation) → Refused Bequest (over-broad interface)
- D (Dependency Inversion) → Alternative Classes (concrete dependencies that should be interfaces)

### Q33. Strangler Fig for migrating switches — how?
Convert one variant at a time to a subclass. The switch keeps a default routing legacy strings to legacy code; new variants use polymorphism. Switch shrinks per migration.

### Q34. Capability-based design — what is it?
Each capability is its own interface; classes declare only what they support. `class C implements Drawable, Resizable {}` — class is honest about what it can do. No "is-a" forced; nothing to refuse.

### Q35. A linter blanket-bans `switch`. Reasonable?
Too strict. Switching on stable enums/sealed types is fine. The smell is *duplicated* switches and *type-code* switches. A blanket ban replaces one smell with overengineering (Visitor pattern when not needed).

### Q36. Migrating away from `Stack extends Vector` — how?
Strangler fig: introduce `Deque<E>` typed wrappers for new code. Migrate stack users one at a time. Eventually deprecate the old `Stack` references. Don't try a big-bang replacement.

### Q37. Anemic Domain Model — relate to OO Abusers.
Anemic Domain Model is data-only classes (Data Class smell from Dispensables) often combined with switch-on-type in service classes. The cure is Move Method onto domain classes — turning service-side switches into polymorphism.

### Q38. ArchUnit fitness function for Refused Bequest?
```java
methods().that().areAnnotatedWith(Override.class)
         .should(notThrowExceptionType(UnsupportedOperationException.class));
```

Fails the build if any override throws `UnsupportedOperationException` — clear Refused Bequest signal.

### Q39. Sealed types for migration-friendly architecture?
Yes — sealed events / sealed responses make API evolution explicit. Adding a new variant is a compile error in every consumer; consumers must handle it. Contrasts with stringly-typed events where new types silently unhandled.

### Q40. When to use Visitor vs sealed pattern matching?
- **Visitor:** language without pattern matching, third-party types, many operations + few stable types.
- **Sealed pattern matching:** modern Java/Kotlin/Scala/Rust/Swift, types you control, good when types stabilize.

For new Java code (17+), default to sealed. Use Visitor only if forced by language version or third-party constraints.

---

## Professional level (10 questions)

### Q41. JIT inline caches — describe the states.
- **Uninitialized:** first call, no observation yet.
- **Monomorphic:** one type seen → direct call + guard.
- **Bimorphic:** two types → two-way branch with two inlined bodies.
- **Polymorphic / Megamorphic:** many types → fallback to vtable lookup.

HotSpot transitions to megamorphic at 4+ types.

### Q42. Tableswitch vs lookupswitch in JVM bytecode.
- **Tableswitch:** O(1) jump via index. Used for dense cases (consecutive integers).
- **Lookupswitch:** O(log n) binary search. Used for sparse cases.

The compiler picks based on case density. Enum switches typically generate tableswitch.

### Q43. Why is Java sealed pattern matching faster than Visitor?
Visitor is double dispatch: two virtual calls per visit. Sealed pattern matching is single dispatch with `instanceof` chain (or jump table). Half the indirection, half the cache pressure.

### Q44. Project Amber — pattern-matching evolution in Java.
Pattern matching was added incrementally:
- 16: `instanceof` with binding
- 17: sealed types (preview)
- 21: pattern matching for `switch` (final), record deconstruction patterns
- Future: primitive type patterns, pattern matching for `String` template

### Q45. Go's interface dispatch overhead — measured?
~30% slower than concrete-type dispatch in tight loops without PGO. With PGO (Go 1.21+), JIT-style devirtualization closes the gap. Measure with `go test -bench=. -cpuprofile=cpu.pprof`.

### Q46. Composition runtime cost vs inheritance — concrete numbers?
JVM: HotSpot inlines monomorphic interface calls; ~zero overhead. Megamorphic: 2-5x slower than inheritance (which has its own indirection but is more aggressively optimized in some cases).

### Q47. Reflection-based dispatch — why is it slow?
- `Class.forName` walks the classloader hierarchy.
- `getDeclaredConstructor().newInstance()` involves access checks.
- The resulting object isn't the same as compile-time-known types — JIT can't optimize as aggressively.

Total: ~1000x slower than direct dispatch. Avoid in hot paths; use registry initialized at startup.

### Q48. Java records vs classes for sealed types — performance difference?
Same. Records are syntactic sugar for classes with auto-generated accessors, equals, hashCode, toString. Pattern matching uses generated accessors, which the JIT inlines. No runtime difference.

### Q49. Sealed type pattern matching — how does the JVM verify exhaustiveness?
Compile-time only. The compiler reads the `PermittedSubclasses` attribute, checks that every permitted subtype has a case in the switch. At runtime, the JVM trusts the compiler — no re-verification.

If you load classes via reflection that violate sealing, the verifier catches it at class-load time.

### Q50. Why might megamorphism be unavoidable in production?
Plugin architectures, dependency injection, entity stores with many types — these naturally produce megamorphic call sites. Mitigation: PGO (where available), per-type processing groups, or accepting the cost (often <10% in real workloads).

---

## Cheat sheet

| Smell | Telltale sign | Primary cure |
|---|---|---|
| **Switch Statements** | Same switch on type repeated in multiple methods | [Replace Conditional with Polymorphism](../../02-refactoring-techniques/04-simplifying-conditionals/junior.md) |
| **Temporary Field** | Field is null/stale outside one method's execution | [Extract Class](../../02-refactoring-techniques/02-moving-features/junior.md) |
| **Refused Bequest** | Subclass throws on inherited methods or no-ops them | [Replace Inheritance with Delegation](../../02-refactoring-techniques/06-dealing-with-generalization/junior.md) |
| **Alternative Classes** | Two classes, same intent, different APIs | [Rename Method](../../02-refactoring-techniques/05-simplifying-method-calls/junior.md) + [Extract Superclass](../../02-refactoring-techniques/06-dealing-with-generalization/junior.md) |

> **Modern shortcut:** in Java 17+ / Kotlin / Scala / Rust, **sealed types + pattern matching** elegantly replaces both Switch Statements and many Visitor uses — the compiler verifies exhaustiveness, adding a variant forces deliberate updates.
