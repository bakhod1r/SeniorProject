# Nested Classes — Interview

> 50+ Q&A across all levels. Each answer concise enough for an interview but specific enough to demonstrate depth.

---

## Junior (1–15)

### Q1. What are the four kinds of nested classes in Java?
1. **Static nested class** — declared inside another class, no implicit reference to outer instance.
2. **Inner class** (non-static nested) — implicit reference to outer instance.
3. **Local class** — declared inside a method.
4. **Anonymous class** — declared and instantiated in a single `new` expression.

### Q2. What's the difference between static nested and inner class?
- Static nested: no `this$0` reference; instantiated as `new Outer.Nested()`.
- Inner: has `this$0` reference to the enclosing `Outer` instance; instantiated as `outerInstance.new Inner()`.

### Q3. When would you use a static nested class?
- For builders, helpers, data types tightly coupled to the outer.
- When the type doesn't need access to outer-instance state.
- This should be the default for any nested class.

### Q4. When would you use an inner class?
- When the nested class genuinely needs access to enclosing-instance state — typically for iterators or views over the outer's data.

### Q5. Why default to `static` for nested classes?
- Avoids hidden references to the outer instance (memory leak risk).
- Simpler instantiation: `new Outer.Nested()`, no enclosing instance needed.
- Cleaner serialization (no spurious outer reference to serialize).
- Most use cases don't need outer access.

### Q6. What is an anonymous class?
A class declared as part of a `new` expression that instantiates it. Used for one-off implementations of an interface or extensions of a class.

### Q7. What's the difference between an anonymous class and a lambda?
- Anonymous class: a real class file, always allocated, can implement multi-method interfaces or extend classes.
- Lambda: implemented via `invokedynamic`, often scalar-replaced (no allocation), only for single-method functional interfaces.

### Q8. Why is `Map.Entry` declared as a nested interface inside `Map`?
Because `Entry` is meaningful only in the context of a `Map`. Nesting it expresses that relationship; external code uses `Map.Entry<K,V>`.

### Q9. Can a static nested class access non-static members of the outer class?
No. A static nested class has no implicit outer-instance reference. It can access static members of the outer (and private members of the outer if in the same nest, since Java 11+).

### Q10. Can an inner class be declared `static`?
A "static nested class" is *not* an inner class — Java terminology distinguishes them. If you declare a class `static` inside another class, it's a static nested class. Inner classes are by definition non-static nested.

### Q11. Can you instantiate an inner class without an outer instance?
No. Inner classes require an enclosing instance. The syntax `outer.new Inner()` provides one explicitly.

### Q12. What's the syntax to access the outer class's `this` from an inner class?
`Outer.this`. Used to disambiguate from a same-named field in the inner class, or to pass the outer reference explicitly.

### Q13. Can a local class access local variables of its enclosing method?
Yes — but only **effectively final** ones. The variable's value is captured into the local class's constructor; reassigning the variable would break consistency.

### Q14. Why must captured variables be final or effectively final?
The captured value is copied into the local/anonymous class's instance (or lambda's environment). If the original variable could be reassigned, the captured copy would diverge. Java prevents this at compile time.

### Q15. What's a builder pattern, and how does it use nested classes?
A `static` nested `Builder` class provides fluent setters and a `build()` method. The outer class has a private constructor that takes the builder. Example: `HttpRequest.newBuilder().uri(...).build()`.

---

## Middle (16–30)

### Q16. Why do anonymous inner classes cause memory leaks?
They capture an implicit reference to the enclosing instance. If the anonymous class is registered as a long-lived listener, the enclosing instance can't be GC'd. Even if the listener doesn't use any outer state, the implicit reference keeps the outer alive.

### Q17. How do lambdas avoid this leak?
Lambdas only capture what they explicitly reference. If the lambda doesn't access `this` or instance members, no enclosing reference is captured. Plus, the JIT often scalar-replaces the capture, eliminating allocation entirely.

### Q18. What's a "nest mate" in Java 11+?
Classes that share a `NestHost` and can directly access each other's `private` members at the JVM level — without compiler-generated bridge methods. Typically the outer class and its nested types.

### Q19. Pre-Java 11, how did inner classes access outer's private fields?
The compiler generated synthetic package-private bridge methods (`access$000`, etc.) that forwarded the access. Visible in `javap`. Java 11's nest mates eliminated this overhead.

### Q20. Can you declare a nested type inside an interface?
Yes. Nested types in interfaces are implicitly `public` and `static`. Used for `Map.Entry`, `Comparator.naturalOrder()`, etc.

### Q21. Are records implicitly final?
Yes. Records cannot be subclassed. They're also implicitly `static` when nested.

### Q22. What's a sealed nested hierarchy?
A `sealed` outer interface with `permits` listing nested record subtypes:

```java
public sealed interface Result permits Result.Ok, Result.Err {
    record Ok(Object value) implements Result {}
    record Err(String error) implements Result {}
}
```

The compiler enforces exhaustive `switch` over the variants.

### Q23. Why prefer `static` nested for builders?
- The builder doesn't need to hold a reference to a specific outer instance.
- Each builder is independent.
- Eliminates the memory-retention risk of inner classes.

### Q24. What's the difference between `Outer.this` and `this` in an inner class?
- `this` refers to the inner class instance.
- `Outer.this` refers to the enclosing outer instance.

Use `Outer.this` when you need to disambiguate or pass the outer reference explicitly.

### Q25. Can you have `static` members in an inner class?
Pre-Java 16: only `static final` compile-time constants. Java 16+ relaxed this — inner classes can have any static members.

### Q26. When is an anonymous class still preferable to a lambda?
When you need:
- Multiple methods (lambdas only implement single-method interfaces).
- An explicit class extension (lambdas can't extend classes).
- Initialization logic that doesn't fit in a single expression.
- Type capture for generics: `new TypeReference<List<String>>() {}`.

### Q27. What's the cost of an inner class instance?
Same as a top-level class plus the synthetic `this$0` field — typically 4 bytes (compressed reference) or 8 bytes uncompressed. Plus alignment padding.

### Q28. How does serialization handle nested classes?
Static nested: serialized like a top-level class.
Inner: serialized along with the outer (the implicit `this$0` reference). Often surprising — Jackson and similar libraries may try to serialize the outer, causing infinite loops or bloated JSON.
Anonymous and local: usually problematic; class names are compiler-generated and unstable.

### Q29. What does `Class.getEnclosingClass()` return?
For nested types: the outer class. For anonymous and local: the lexically enclosing class. For top-level: `null`.

### Q30. Why does the JLS allow only `final` (or effectively final) variable capture?
Because the captured value is copied into the inner/anonymous/local instance. Reassigning the original variable would create inconsistency between the original and the copy. Java prevents this confusion at compile time.

---

## Senior (31–42)

### Q31. How does an anonymous class capture differ from a lambda capture at the bytecode level?
- Anonymous class: a real class file with a synthetic constructor taking the captured values; one allocation per `new`.
- Lambda: an `invokedynamic` instruction with the captured values as static arguments; the JIT often scalar-replaces, eliminating allocation.

### Q32. When would you choose an inner class over a static nested + reference parameter?
For iterators where the close coupling to a specific outer instance is the entire point. The implicit `Outer.this` makes the relationship clear. For most other cases, static nested + explicit reference is cleaner.

### Q33. How would you refactor 50 anonymous classes scattered across a codebase?
- For single-method interfaces: convert to lambdas. IDE refactoring tools do this in bulk.
- For multi-method interfaces: keep as anonymous, or extract to top-level if the implementation is reused.
- For listener/callback abuse: redesign the API to use functional interfaces (`Consumer`, `Function`).

### Q34. What's the JIT story for lambda allocation?
Modern HotSpot's escape analysis often proves that captured lambda state never escapes the call site. When this proof succeeds, the JIT performs *scalar replacement* — the captured values become local variables on the stack, eliminating heap allocation.

Confirm with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`.

### Q35. How do sealed classes interact with nested types?
Sealed classes commonly use nested permits:

```java
public sealed interface Result permits Result.Ok, Result.Err { ... }
```

The nesting expresses "these are the variants of Result." The compiler enforces exhaustive switches and prevents external classes from implementing `Result`.

### Q36. What's the metaspace impact of lambdas vs anonymous classes?
- Anonymous classes: one `.class` file per anonymous class, loaded normally into metaspace.
- Lambdas (Java 15+): hidden classes generated at runtime, unloadable when their `MethodHandles.Lookup` is GC'd. Less metaspace pressure for short-lived lambdas.

### Q37. How do nested classes interact with reflection in JPMS?
Each nested class is a separate runtime class. JPMS access rules apply: a `private` nested class in a non-`opens` package isn't accessible via `setAccessible(true)` from another module. Cross-module reflection on nested types requires either `exports` or `opens`.

### Q38. What's the right way to design a "fluent builder" for an immutable type?
- Outer type: `final class` with `private` constructor.
- `Builder`: `public static final class` with mutable fields and fluent setters returning `this`.
- Factory method: `static Builder newBuilder()` on the outer.
- `build()` validates and constructs the outer via the private constructor.

This is the canonical pattern in `HttpRequest`, `Stream.Builder`, and many JDK APIs.

### Q39. How would you implement a thread-safe lazy holder using a nested class?
The "Initialization-On-Demand Holder" idiom:

```java
public class Service {
    private Service() { /* expensive */ }
    private static class Holder { static final Service INSTANCE = new Service(); }
    public static Service getInstance() { return Holder.INSTANCE; }
}
```

The nested `Holder` class is initialized on first access, leveraging the JVM's class-init lock for thread safety. No explicit synchronization.

### Q40. What's the cost of `Outer.this` in tight loops?
A non-static inner class accesses outer fields via `this$0.field`. That's one extra indirection (a `getfield` to read `this$0`, then another to read the field). The JIT often inlines this, but in tight loops it can show up.

For hot paths, prefer static nested + explicit reference, or — better — flatten the design (no nesting at all).

### Q41. How does the `EnclosingMethod` attribute help debugging?
Local and anonymous classes have an `EnclosingMethod` attribute pointing to the method that declared them. Stack traces and reflection (`Class.getEnclosingMethod()`) use it to identify the source location. Without it, tracking down "where did this class come from?" is harder.

### Q42. When would you use a sealed nested interface vs a sealed nested abstract class?
- Sealed nested interface: when permits are records (the most common case for ADTs).
- Sealed nested abstract class: when permits need shared mutable state or non-trivial constructor logic.

Most modern designs use sealed interfaces with record permits.

---

## Professional (43–52)

### Q43. Walk through the bytecode `new Outer().new Inner()`.
```
new Outer; dup; invokespecial Outer.<init>;       // create Outer
new Outer$Inner; dup_x1; swap;                     // create Inner, position outer as ctor arg
invokespecial Outer$Inner.<init>(Outer);           // pass outer to Inner's ctor
```

The Inner's constructor takes the outer as a hidden first parameter; the bytecode passes it explicitly.

### Q44. What's an `EnclosingMethod` attribute and when does it appear?
A class file attribute on local and anonymous classes (JVMS §4.7.7) recording the method that declared them. Used by reflection (`Class.getEnclosingMethod()`) and for stack-trace attribution. Doesn't appear on static nested or top-level classes.

### Q45. How does the JIT handle a polymorphic call site that targets multiple anonymous-class implementations?
With 2-3 different receiver classes: polymorphic inline cache (fast). With more: megamorphic, falls back to vtable lookup. Each anonymous class is a distinct runtime type, so a callback heavy with `new SomeListener() { ... }` instances at different sites can become megamorphic.

Lambdas often fare better — the JIT may identify them as a single generated implementation per source location, keeping the call site monomorphic.

### Q46. What are nest members and how does the verifier check them?
Java 11+ classes have `NestHost` (pointing to the nest leader) and `NestMembers` (on the leader). The verifier accepts `private` access between classes that share a nest. JVMS §5.4.4 specifies the rules.

### Q47. How does the `LambdaMetafactory` bootstrap work?
At each `invokedynamic` site for a lambda:
1. First execution: JVM calls `LambdaMetafactory.metafactory` with the target functional interface, the lambda's implementation method handle, and other metadata.
2. The factory returns a `CallSite` (typically `ConstantCallSite`) wrapping a `MethodHandle` that produces lambda instances.
3. The `CallSite` is cached for subsequent uses — no further bootstrap calls.

The actual lambda implementation is a hidden class generated by the factory.

### Q48. What's the metaspace cost of an anonymous class vs a lambda's hidden class?
- Anonymous class: a normal `.class` loaded into metaspace; ~1-2 KB per class.
- Lambda hidden class: generated lazily, unloadable when the defining `MethodHandles.Lookup` is GC'd. Eligible for unload if no longer referenced.

For long-lived lambdas in long-running services, both end up similar. For short-lived lambdas, hidden classes can be reclaimed; anonymous classes stay loaded.

### Q49. How does Jackson handle deserialization of nested types?
Jackson uses reflection (`Class.getDeclaredClasses()`, `Class.getNestMembers()`, `Class.getEnclosingClass()`) to navigate the type structure. For nested static classes / records, deserialization is straightforward. For non-static inner classes, Jackson would need to find an outer instance — typically a problem; recommend making nested types static or top-level.

### Q50. What's the relationship between `MethodHandles.Lookup` and nested types?
A `Lookup` carries access privileges. `Lookup.in(otherClass)` switches the lookup's target — privileges may drop. For nested types, the same-nest property allows lookups across nest mates without crossing a privacy boundary (Java 11+). `MethodHandles.privateLookupIn(target, originalLookup)` provides explicit cross-class access.

### Q51. How does ASM (or another bytecode tool) emit nested classes?
The tool emits separate `.class` files for each nested type. The outer class's `InnerClasses` attribute lists them; each inner class's `InnerClasses` attribute repeats the relationship; `NestHost`/`NestMembers` attributes (Java 11+) link nest mates.

Without correctly emitting these attributes, the verifier may reject the classes (e.g., refuse private access between nest members that aren't declared as such).

### Q52. What's the right migration path from anonymous classes to lambdas in legacy code?
1. Identify single-method-interface anonymous classes.
2. Use IDE refactoring (IntelliJ, Eclipse) to convert in bulk.
3. Run tests after each batch.
4. For multi-method anonymous classes: leave as-is or refactor the API to use functional interfaces.
5. Profile before/after for hot paths — confirm lambda scalar replacement is succeeding.

The migration is typically low-risk and produces measurably cleaner code.

---

## Behavioral / Design Round (bonus)

- *"How do you decide between nesting and a top-level class?"* — Conceptual coupling. If the type is meaningful only with the outer, nest. If it could grow independently, top-level.
- *"Tell me about a memory leak from inner classes."* — Specific story: an event listener as anonymous inner class held a reference to a Dialog window, preventing GC. Fix: static + explicit ref, or lambda.
- *"What's your take on anonymous classes in 2025?"* — Largely obsolete for single-method interfaces; lambdas are cleaner. Multi-method or class-extension cases are rare and usually better as named top-level classes.

The pattern: senior answers are *concrete* and *trade-off-aware*, not academic.
