# Initializer Block — Interview Q&A

50 questions on instance/static initializer blocks, class init order, and modern alternatives.

---

## Section A — Basics (1-10)

**Q1. What is an instance initializer block?**
A: A `{ ... }` block in a class body that runs as part of every constructor (after `super(...)` returns, before the constructor body).

**Q2. What is a static initializer block?**
A: A `static { ... }` block that runs once when the class is initialized.

**Q3. When does a static initializer run?**
A: On first triggering event — `new`, static method call, static field read/write (except constants), subclass init, etc.

**Q4. When does an instance initializer run?**
A: On every `new`, after `super(...)`, before the constructor body.

**Q5. Can a static block throw an exception?**
A: Yes — but unchecked. Checked exceptions are forbidden in static blocks (must be wrapped or caught).

**Q6. Can an instance block throw a checked exception?**
A: Only if all constructors of the class declare it (the throws clause).

**Q7. Can a class have multiple static blocks?**
A: Yes. They run in source order, interleaved with static field initializers.

**Q8. Can a class have multiple instance blocks?**
A: Yes. They run in source order, interleaved with instance field initializers.

**Q9. Are blocks run on subclasses' parents?**
A: Yes. Parent's static block runs before subclass's static block. Parent's instance block runs before subclass's instance block (per `new`).

**Q10. What's the difference between a constructor and an instance block?**
A: Constructor takes parameters and is selected per `new` call. Instance block has no parameters and runs for every constructor.

---

## Section B — Order (11-20)

**Q11. What's the full order for `new SubClass()`?**
A: For each class top-down: parent's static (once) → child's static (once). Then for the new: parent's super → parent's field inits → parent's blocks → parent's ctor body → child's field inits → child's blocks → child's ctor body.

**Q12. Is class loading triggered by reading a `static final int` constant?**
A: No, if it's a *constant variable* (primitive or String, initialized to a constant expression). Such reads are inlined at compile time.

**Q13. Is class loading thread-safe?**
A: Yes, by JVM contract (JLS §12.4.2). At most one thread runs `<clinit>`; others wait.

**Q14. What if `<clinit>` throws?**
A: Class is marked erroneous. First throw produces `ExceptionInInitializerError`; subsequent uses produce `NoClassDefFoundError`.

**Q15. Is this thread-safe?**
```java
class Singleton {
    static final Singleton INSTANCE = new Singleton();
    private Singleton() { }
}
```
A: Yes. Class init is synchronized; only one thread runs `<clinit>`.

**Q16. What's the lazy holder idiom?**
A: A static nested class holds the instance. Loading the holder triggers init. Lazy + thread-safe.

**Q17. What's the difference between a static block and a static method called from another static method?**
A: Static block runs at class init (once). Static method runs each time it's called. Use static blocks for one-time setup; use methods for repeatable computations.

**Q18. Can an instance block reference a constructor parameter?**
A: No. Parameters are local to the constructor. Instance blocks share scope with field initializers, not constructor params.

**Q19. Can an instance block be `synchronized`?**
A: No. Synchronization is on methods or explicit blocks within methods. Instance blocks aren't methods.

**Q20. Can a static block declare local variables?**
A: Yes. They're scoped to the block.

---

## Section C — Modern alternatives (21-30)

**Q21. What's a modern alternative to static block for building an immutable map?**
A: `Map.of(...)` or `Map.ofEntries(...)`. For larger maps, a private static method that returns the map.

**Q22. When is a static block still necessary?**
A: Loading native libraries (`System.loadLibrary`), complex setup that must be eager, integration with frameworks that scan static state at class load.

**Q23. Can records have static blocks?**
A: Yes. Records can have static fields and static blocks like any class.

**Q24. Can records have instance blocks?**
A: No. Records use compact constructors for that role.

**Q25. Can enums have static blocks?**
A: Yes. Often used for building lookup maps from constants.

**Q26. Why prefer the lazy holder idiom over a static block?**
A: Defers expensive init until first use. Class loading stays fast. Still thread-safe.

**Q27. What replaces double-brace initialization in modern Java?**
A: `Map.of(...)`, `List.of(...)`, builders, factories. Avoid double-brace (creates anonymous class, pins outer reference).

**Q28. Can a static block call instance methods?**
A: No, not on `this` (no instance exists). Can call static methods, or instance methods on objects it has references to (rare).

**Q29. Can you use `try-with-resources` in a static block?**
A: Yes. Common pattern for loading config/resources at class init.

**Q30. Can a static block use lambdas?**
A: Yes. Lambdas in static blocks work normally; they capture variables from the enclosing scope (which is the block).

---

## Section D — Edge cases (31-40)

**Q31. Can a static block reference instance fields?**
A: No — there's no `this`. Only static fields are accessible.

**Q32. Can an instance block reference static fields?**
A: Yes. Static fields are accessible from any context.

**Q33. What if the static block references a static field declared *after* it?**
A: It's a forward reference. Allowed if the field is read *and* assigned before the block uses it. Otherwise compile error per JLS §8.3.3.

**Q34. Can a static block initialize a `final` static field?**
A: Yes — that's a common use case. The field must be assigned exactly once across all paths.

**Q35. What if a static block doesn't initialize a `final` static field?**
A: The field is treated as initialized to its default. But if any path in the static block doesn't assign, compile error.

**Q36. Are static blocks inherited?**
A: Static state belongs to the declaring class. Subclasses don't "inherit" static blocks; the parent's runs once when the parent's class is initialized.

**Q37. Does invoking a static method in an interface trigger the interface's init?**
A: Yes. Interfaces with default methods have full init (with `<clinit>`). Pure-abstract interfaces only initialize on first reference to a non-constant static field.

**Q38. Can an interface have a static block?**
A: Yes, since Java 8. Used for static fields (since Java 8 allowed static methods on interfaces).

**Q39. Can you reference local variables in an instance block?**
A: There are no "local" variables in an instance block — it's not in a method context. You can reference fields and class members.

**Q40. What's the relationship between constructor and instance block?**
A: Constructor includes the instance block in its prologue. Compiler synthesizes: super() → instance prologue (field inits + blocks) → ctor body.

---

## Section E — Real-world (41-50)

**Q41. Should you use a static block for database connection?**
A: No — defer to lazy init. If DB is unreachable at startup, the class poisons; service can't start. Lazy gives you control.

**Q42. Should you use a static block for native library loading?**
A: Often yes. JNI `System.loadLibrary` must run before native methods are called. Static block is the natural place.

**Q43. Why might a Spring app fail with `NoClassDefFoundError` on startup?**
A: A class's `<clinit>` threw during eager initialization (component scan, bean creation). The wrapping `ExceptionInInitializerError` may be in the logs; subsequent failures show `NoClassDefFoundError`.

**Q44. What's the cost of eagerly initializing all classes?**
A: Adds startup time. AppCDS, GraalVM native-image, and lazy-class-loading frameworks help. For typical apps, static block costs are negligible.

**Q45. Is there a way to defer class loading?**
A: Yes. Don't reference the class at startup; use lazy patterns (factories, holders). The JVM only loads on first reference.

**Q46. How do tests interact with static blocks?**
A: Test runners may load classes in unpredictable orders. Static blocks that depend on external state (system properties, files) are fragile. Make tests independent of class load order.

**Q47. Can a static block be `private`?**
A: Static blocks have no access modifier — they're not methods or fields. Treat them as implicitly part of the class's `<clinit>`.

**Q48. What's the difference between a `synchronized` static method and a static block?**
A: A `synchronized static` method locks on `Class`. A static block runs during class init (synchronized via JVM's class-init lock). The class-init lock is more efficient and at-most-once.

**Q49. Why is the double-brace pattern considered bad?**
A: Creates an anonymous subclass per use site. Pins outer instance via implicit reference. Bloats class count. Confuses serialization.

**Q50. Can a static block be `final`?**
A: No — `final` doesn't apply to blocks. Each `<clinit>` runs once anyway.

---

## Bonus — staff (51-55)

**Q51. How would you debug "class not initializing" issues?**
A: Add `-Xlog:class+init=info` to JVM args. Watch for which classes are loaded but not initialized. Check `<clinit>` for exceptions.

**Q52. Why did Java 8 add static methods on interfaces but not allow static blocks initially?**
A: Static fields and blocks were already supported on interfaces (Java 1.0). Java 8 added default methods (instance) and allowed *static methods* with bodies (previously only abstract).

**Q53. Should a library's classes have eager static init?**
A: Generally no. Eager init can be triggered by reflection scanners (Spring, Hibernate) at unexpected times. Lazy init is more predictable.

**Q54. What's the cost of `Class.forName(name)`?**
A: Loads + initializes the class. Can be slow for complex classes. Use `Class.forName(name, false, loader)` to load without init.

**Q55. How do native-image / GraalVM treat static blocks?**
A: They run `<clinit>` at build time (where possible), baking the result into the image. This shifts cost from runtime to build time. Side effects in static blocks need careful handling.

---

**Use this list:** strong candidates explain *when* to use vs avoid initializer blocks, not just memorize the rules.
