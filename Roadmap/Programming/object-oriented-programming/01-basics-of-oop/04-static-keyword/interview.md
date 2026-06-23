# Static Keyword — Interview

> 50+ Q&A across all levels. Each answer short enough to deliver in a real interview but specific enough to demonstrate depth.

---

## Junior (1–15)

### Q1. What does `static` mean in Java?
A `static` member belongs to the class itself, not to any instance. There is one copy, shared by all instances. You access it via the class name: `ClassName.member`.

### Q2. What can be marked `static`?
Fields, methods, nested classes, and initializer blocks. Top-level classes, local variables, and constructors cannot be `static`.

### Q3. What's the difference between a static field and an instance field?
Instance fields exist per object; each instance has its own copy. Static fields exist once per class; all instances share the same copy.

### Q4. Why is `main` declared `static`?
The JVM needs to call `main` to start the program, but no instance exists yet. `static` lets the JVM call it via the class name (`MyClass.main(args)`) without instantiating anything.

### Q5. Can a static method access instance fields?
No. A static method has no `this` reference; it doesn't know which instance to use. To access instance state, the method must take an instance as a parameter.

### Q6. Can an instance method access static fields?
Yes. Instance methods can read and write static fields freely. The static field is visible from anywhere — instance methods, static methods, even other classes (subject to access modifiers).

### Q7. What is a `static` initializer block?
A `static { ... }` block that runs once when the class is first loaded. Used to initialize static fields with logic that doesn't fit in a single expression (loops, conditionals, exception handling).

### Q8. When does a static initializer block run?
When the class is first initialized — typically on first instantiation, first static method call, first non-final static field access, `Class.forName(...)` with `initialize=true`, or initialization of a subclass.

### Q9. Can `static` blocks throw checked exceptions?
No. The `<clinit>` method has no `throws` clause. If a static initializer throws a checked exception, you must catch it inside the block or wrap in a `RuntimeException`. Uncaught exceptions cause class initialization to fail with `ExceptionInInitializerError`.

### Q10. What's the difference between `static final` and `final`?
- `static final` is a class-level constant — one copy.
- `final` (without `static`) is an instance-level constant — one per instance, but cannot be reassigned.

### Q11. Can you call a static method using an instance reference?
Yes — but it's misleading. `obj.staticMethod()` resolves at compile time to `Class.staticMethod()` based on the static type of `obj`. Tools warn about this. Always call statics via the class name.

### Q12. Are static methods inherited?
Static methods are accessible to subclasses through the parent's class name and through the subclass's name. But they're not "inherited" in the polymorphic sense — they're not virtual. A subclass's `static` method with the same signature **hides** the parent's, not overrides.

### Q13. Can constructors be static?
No. A constructor's job is to initialize an instance, which inherently requires `this`. Java rejects `static` on constructors at compile time. Use static factory methods if you want a static way to create instances.

### Q14. What is a static nested class?
A class declared `static` inside another class. It does not hold a reference to the enclosing instance (unlike a non-static *inner* class). Useful for builders, helper types, and any nested type that doesn't need outer-instance access.

### Q15. Can interfaces have static methods?
Yes — since Java 8. They're called via the interface name (`MyInterface.staticMethod()`). They're not inherited by implementing classes.

---

## Middle (16–30)

### Q16. Why is `Math.PI` declared `public static final double`?
Because:
- It's a class-level constant, not tied to an instance — `static`.
- It never changes — `final`.
- Anyone can read it — `public`.
- It's a primitive — the compiler may inline its value at compile time.

### Q17. What happens if you try to assign a static field before it's been initialized?
You see the default value (`0`, `null`, `false`). Static fields are *prepared* (set to defaults) before `<clinit>` runs. So a forward reference reads the default, not the initialized value.

### Q18. Why is `static` mutable state an antipattern?
- Cannot be substituted in tests.
- Concurrent access requires explicit thread-safety.
- Lifecycle is tied to class loading, not to an injectable scope.
- Couples every reader to the class without an explicit dependency declaration.

The fix is dependency injection — make state an instance field of an injectable class.

### Q19. What's the lazy holder idiom?
A pattern for thread-safe lazy singletons:

```java
public class Config {
    private Config() { /* expensive */ }
    private static class Holder { static final Config INSTANCE = new Config(); }
    public static Config getInstance() { return Holder.INSTANCE; }
}
```

`Holder` initializes only on first call to `getInstance()`. The JVM's class init lock guarantees thread-safe one-time creation. No explicit synchronization, no double-checked locking.

### Q20. What's the difference between an enum singleton and a static-field singleton?
Enum singletons:
- Reflection-resistant (`Constructor.setAccessible(true)` is rejected for enums).
- Serialization-safe.
- Concise.

Static-field singletons require careful handling of these issues. For new code, prefer enum unless lazy initialization or other features are needed (use lazy holder idiom in that case).

### Q21. What is a static factory method?
A static method that returns an instance — replacing or supplementing constructors. Examples: `List.of(...)`, `Optional.empty()`, `Integer.valueOf(int)`. Advantages: meaningful names, optional caching, ability to return subtypes.

### Q22. Why does `Optional.empty()` always return the same object?
It caches a single instance via a `static final EMPTY` field. Since `Optional` is immutable and `Optional.empty()` is called frequently, returning a cached instance avoids unnecessary allocation.

### Q23. How is class initialization order determined?
Source order. Static field initializers and `static {}` blocks execute in the order they appear in the source code. Forward references compile but may read default values.

### Q24. What's the difference between `Foo.class` and `Class.forName("Foo")`?
- `Foo.class`: a class literal. Evaluated at compile time; does **not** initialize `Foo`.
- `Class.forName("Foo")`: runtime lookup with default `initialize=true`. Triggers `Foo`'s initialization.
- `Class.forName("Foo", false, loader)`: runtime lookup without initialization.

### Q25. Why might a static block deadlock?
If two classes have static initializers that depend on each other, and two threads simultaneously initialize them, each holds one class init lock and waits for the other. `jstack` reveals it as two threads blocked in `Class init` state.

### Q26. What's the Java Memory Model guarantee for `static final` fields?
The JLS §17.5 freeze rule: once `<clinit>` finishes without leaking the class reference, all threads observing the class as initialized see fully-initialized `static final` fields, without any explicit synchronization. This is the safe-publication mechanism for class-level constants.

### Q27. What does `static` mean for nested classes?
`static class Nested {}` declares a *static nested class*. It doesn't carry a reference to the enclosing instance. It can be instantiated standalone. Without `static`, you have an *inner class* — an instance is bound to an outer instance and carries an implicit `Outer.this`.

### Q28. Can a static method access static fields of the same class?
Yes. Static methods can read and write static fields freely; they're in the same class scope.

### Q29. What's the difference between an instance method and a static method that takes the receiver as a parameter?
Functionally similar, but:
- Instance method: `obj.method()`. Subject to virtual dispatch (polymorphism).
- Static method: `Class.method(obj)`. Direct dispatch; no polymorphism. Easier to inline.

For pure utilities or factories, static is fine. For domain operations, prefer instance methods — they integrate with OOP.

### Q30. Why prefer `static final` over a `static` getter for constants?
- `static final` primitives/strings are inlined at compile time — zero runtime cost.
- A static getter (`public static int getMax()`) is a method call, slightly more expensive (though usually inlined by JIT).
- Constants signal intent: "this won't change." A getter doesn't.

The case for a getter: when consumers shouldn't recompile on value changes (e.g., across jar boundaries).

---

## Senior (31–42)

### Q31. How does class initialization interact with inheritance?
Initialization triggers cascade: instantiating a subclass forces the parent to initialize first (per JLS §12.4.1). Static initializers run top-down through the hierarchy: parents first, then children. Each class's `<clinit>` runs once.

### Q32. Why might a `static final` constant not behave as expected after a library upgrade?
`static final` primitives/strings are *inlined* by `javac`. If `lib.jar` defines `MAX = 100` and `app.jar` is compiled against it, `app.jar`'s bytecode contains literal `100`. Updating `lib.jar` to `MAX = 200` doesn't propagate until `app.jar` is recompiled. For values that may change across releases, use a static getter instead.

### Q33. How would you implement a thread-safe, lazy, expensive-to-construct singleton?
Lazy holder idiom — leverages the JVM's class init lock for thread safety with no explicit synchronization:

```java
public class Cache {
    private Cache() { /* expensive */ }
    private static class Holder { static final Cache INSTANCE = new Cache(); }
    public static Cache getInstance() { return Holder.INSTANCE; }
}
```

The JLS guarantees `<clinit>` runs once and that observers of the initialized class see fully-constructed `final` fields.

### Q34. What's wrong with `static synchronized` methods?
- The lock is on `Class<?>` itself — every static synchronized method on the class shares the same lock.
- Contention scales poorly across many synchronized statics.
- Coarse: any thread on any static synchronized method blocks every other.

For better scalability: use private static `Lock`s, `ConcurrentHashMap`, `Atomic*`, or DI-managed instances with per-instance synchronization.

### Q35. How does the `<clinit>` method differ from a constructor?
- `<clinit>` runs once per class loader, automatically. Initializes static state.
- `<init>` runs per instance, triggered by `new`. Initializes instance state.
- `<clinit>` is invoked by the JVM (you cannot call it directly).
- `<clinit>` may not throw checked exceptions; uncaught throws cause `ExceptionInInitializerError`.

### Q36. How do static methods affect testability?
Static methods are hidden dependencies — calls bypass DI. Tests cannot substitute them without mocking libraries (Mockito 3.4+, PowerMock). Senior practice: refactor static methods that do I/O or mutate state into instance methods on injectable services.

### Q37. What's the difference between a static cache and a DI-managed cache?
- **Static cache**: lifetime tied to the class loader; reachable from anywhere; no test isolation; thread-safety is your problem.
- **DI-managed cache**: lifetime tied to the container (request, session, application); injectable; substitutable in tests; container-managed thread-safety.

For new code, prefer DI-managed. Static caches are a legacy holdover.

### Q38. How do you debug a class initialization failure?
- Watch for `ExceptionInInitializerError` in logs — the wrapped cause names the static initializer that threw.
- Run with `-Xlog:class+init=info` to see initialization events.
- For deadlocks, `jstack <pid>` shows threads in `Class init` state.
- Avoid complex logic in `<clinit>` — keep it simple, push expensive work into lazy holders.

### Q39. What is the "Initialization-On-Demand Holder" idiom?
The same as the lazy holder idiom (Q33). Sometimes called "Pugh's idiom" or "InitializationOnDemandHolder." It exploits the JVM's class loader to do thread-safe lazy init without explicit synchronization.

### Q40. How does the JIT optimize static method calls?
`invokestatic` is a direct call — no virtual dispatch. The JIT inlines unless the method exceeds size limits (`MaxInlineSize` ~35 bytes for cold, `FreqInlineSize` ~325 for hot). Confirm with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`. For pure static functions, the JIT typically eliminates the call entirely.

### Q41. What are the GC implications of static fields?
Every reference field in a class's static area is a GC root. Objects reachable from those fields are pinned for the class's lifetime (typically the JVM's lifetime). Static caches that grow unboundedly are a classic memory leak. Use weak references, manual eviction, or DI-managed instances with proper lifecycle.

### Q42. How does class unloading interact with static state?
Classes are unloaded only when their defining class loader becomes unreachable. In container/multi-classloader environments (app servers, OSGi, hot reload), static state can be reset by reloading. In standalone apps, static state effectively lives forever. Frameworks and libraries should plan for both scenarios.

---

## Professional (43–52)

### Q43. Walk through what happens when a class is initialized at the JVM level.
Per JVMS §5.5:
1. Acquire the class init lock.
2. If already initialized, release and return. If being initialized by current thread, release (recursive entry) and continue.
3. If being initialized by another thread, wait on the lock.
4. Mark as in-progress; release lock.
5. Initialize parent (recursively) and superinterfaces (if any have a `<clinit>`).
6. Run `<clinit>`.
7. Acquire lock again, mark fully initialized, notifyAll waiters, release.

### Q44. Why does `static final int MAX = 100` not trigger class initialization when read?
Because `MAX = 100` is a compile-time constant expression. `javac` inlines the value `100` at every read site, removing the `getstatic` bytecode. Without `getstatic`, the JVM has no trigger to initialize the class. To force initialization, use a non-final static, a method call, or `Class.forName(...)`.

### Q45. What's the cost of `static synchronized` vs `synchronized` instance methods?
- `static synchronized` locks on `Class<?>`. All static synchronized methods on that class share one lock.
- `synchronized` instance methods lock on `this`. Each instance has its own lock; threads on different instances proceed independently.

For high-throughput scenarios, instance-level locking scales linearly with instances; class-level locking is a single bottleneck.

### Q46. How does the `ConstantValue` attribute work in a class file?
A `static final` field with a primitive or `String` initializer that's a constant expression gets a `ConstantValue` attribute (JVMS §4.7.2). At class linking, the JVM uses this attribute to set the field's value — no `<clinit>` involvement. So such fields are initialized **before** `<clinit>` runs. Inspect with `javap -v`.

### Q47. How does `MethodHandle.findStatic` differ from `Method.invoke` for static methods?
- `Method.invoke` uses reflective dispatch — security check + bytecode-generated accessor (after warmup) + boxing for primitives.
- `MethodHandle.invoke` (after `findStatic`) is JIT-friendly. The handle is type-checked once at lookup; the call site is compiled like a direct call.

For frameworks, `MethodHandle` is the preferred API. ~10x faster on hot paths.

### Q48. What's the metaspace cost of a class's static fields?
Static fields live in the static field area attached to the class's `InstanceKlass` in metaspace. The cost per field is the field's size (4–8 bytes) plus the slot in the static area. References stored in static fields don't add metaspace cost — the *referenced objects* live on the heap. Inspect with `jcmd <pid> VM.metaspace`.

### Q49. How does the JVM handle a `static final` field whose initializer throws?
The exception propagates out of `<clinit>`, wrapped in `ExceptionInInitializerError`. The class is marked as **erroneous** and **never** retries initialization in the same JVM. Subsequent attempts to use the class throw `NoClassDefFoundError` with the original `ExceptionInInitializerError` as the cause.

### Q50. What's the relationship between hidden classes and static fields?
Hidden classes (JEP 371, Java 15+) are dynamically created classes that the JVM doesn't link to any name. They can have static fields like normal classes. Their lifecycle is bound to the `MethodHandles.Lookup` that defined them — when the lookup is GC'd, the hidden class (and its static state) can be unloaded.

This fixes a long-standing issue with bytecode-generation tools: their generated classes used to leak metaspace because they never unloaded. Hidden classes can.

### Q51. How would you diagnose a slow `<clinit>`?
- `-Xlog:class+init=info` logs each class initialization with elapsed time.
- JFR records `jdk.ClassInitialization` events.
- Static analysis: look for I/O, network calls, or heavy loops in `static {}` blocks. Move them to lazy holders.
- For libraries: ensure `<clinit>` is fast — slow init blocks startup of every consumer.

### Q52. How do `static` fields interact with class data sharing (CDS / AppCDS)?
CDS dumps loaded class metadata to a shared archive (`classes.jsa`) that future JVMs mmap to skip loading and verification. Static fields' values are *not* archived — they're set at class init time, which still runs on each JVM startup. CDS speeds up class loading and linking, but `<clinit>` still executes per-run.

---

## Behavioral / Design Round (bonus)

- *"How do you avoid `static` mutable state in a legacy codebase?"* — incrementally extract services. Introduce a façade as an instance, route all callers through it, migrate the static implementation behind the façade, eventually delete the static.
- *"When is a singleton the right choice?"* — for genuine global resources (connection pools, metric registries) where lifecycle is JVM-wide. Otherwise, prefer DI-managed scope.
- *"Tell me about a bug caused by static state."* — concrete: a static `SimpleDateFormat` shared across threads → thread-unsafety → corrupted parses. Fix: `DateTimeFormatter` (immutable) or `ThreadLocal<SimpleDateFormat>`.

The pattern across all of these: senior answers are *specific*, name trade-offs, and acknowledge what the listener can verify. Generic platitudes ("avoid statics") are filler. Concrete observations ("the static SimpleDateFormat caused a Friday-afternoon outage when traffic spiked") are signal.
