# Reflection and Annotations — Interview Q&A

20 questions covering reflection mechanics, `MethodHandle` / `VarHandle`, annotation retention/target/inheritance, processors, JPMS interactions, performance characteristics, and the frameworks that depend on all of it.

---

## Q1. What is reflection and what is the canonical starting point?

Reflection is the JDK's runtime API for inspecting and invoking program elements (classes, methods, fields, constructors) by name. The canonical entry point is `java.lang.Class<?>`. You obtain a `Class` via `MyType.class`, `instance.getClass()`, or `Class.forName("fully.qualified.Name")`, then ask it for `Method`, `Field`, `Constructor`, or `Parameter` objects. Those objects in turn support `invoke`, `get`, `set`, and `newInstance` for runtime indirection. Reflection lives in `java.lang` and `java.lang.reflect`.

**Trap:** Confusing `Class.forName(...)` (uses the caller's loader, *initialises* the class) with `Class.forName(name, false, loader)` (controlled initialisation and loader).

---

## Q2. What is the difference between `getMethod` and `getDeclaredMethod`?

`getMethod(name, paramTypes...)` returns a *public* method, including ones inherited from supertypes (including interfaces). `getDeclaredMethod(name, paramTypes...)` returns a method declared *on this class only*, of any visibility (public, package-private, protected, private), but does **not** walk supertypes.

```java
Object.class.getMethod("toString");          // OK
Object.class.getDeclaredMethod("toString");  // OK — Object declares it
String.class.getDeclaredMethod("hashCode");  // OK — String declares it
String.class.getDeclaredMethod("equals", Object.class); // OK
String.class.getDeclaredMethod("clone");     // NoSuchMethodException — declared on Object
```

**Follow-up:** "How do you find a private method declared on a parent class?" Walk `c.getSuperclass()` and call `getDeclaredMethod` on each until you find it, or use Spring's `ReflectionUtils.findMethod`.

---

## Q3. What does `setAccessible(true)` actually do?

It disables Java's runtime access check for that specific `Method`, `Field`, or `Constructor` instance. Without it, calling `Method.invoke` on a non-public method throws `IllegalAccessException` even if you found the method by reflection. With it, the JVM skips the access check. On Java 9+, it is also gated by the module system — calling it on a member of a closed (non-`opens`) package throws `InaccessibleObjectException` regardless of the visibility modifier.

**Trap:** Believing `setAccessible(true)` is a "security bypass." It is an *encapsulation* bypass; the security model has moved to JPMS and (formerly) the `SecurityManager`.

---

## Q4. Why does `Method.invoke` throw `InvocationTargetException` instead of the underlying exception?

To distinguish "the reflective call itself failed" (`IllegalAccessException`, `IllegalArgumentException`) from "the target method ran and threw something." `InvocationTargetException` wraps any exception thrown *by* the invoked method; its `getCause()` returns the real exception. Without this distinction, a caller could not tell whether the failure was a reflection problem (bug in the reflective code) or a domain problem (bug in the called method).

```java
try { m.invoke(t, args); }
catch (InvocationTargetException wrapped) { throw wrapped.getCause(); }
catch (IllegalAccessException blocked)    { /* the reflective call was disallowed */ }
```

**Follow-up:** "What about `MethodHandle.invoke`?" It throws the underlying exception directly — no wrapping. One of the reasons it's friendlier.

---

## Q5. What is the difference between `Method.invoke` and `MethodHandle.invokeExact`?

`Method.invoke(target, args)` takes a varargs `Object[]`, boxes primitives, performs access checks, dispatches, and wraps any thrown exception in `InvocationTargetException`. It is dynamic and slow (historically 50–100× slower than a direct call; on JDK 18+ closer to 5× after JIT warmup).

`MethodHandle.invokeExact(target, args)` has a fixed `MethodType` checked at link time. It throws the target's exception directly. It is *constant-foldable* by the JIT when the handle is in a `static final` field — the JIT inlines through it almost as if it were a direct call.

For a single one-shot call, `Method.invoke` is simpler. For a per-call hot path that runs millions of times, `MethodHandle.invokeExact` is dramatically faster.

**Trap:** Calling `invokeExact` with wrong types — it throws `WrongMethodTypeException` immediately. Use `invoke` (without `Exact`) for relaxed type matching.

---

## Q6. What is `VarHandle` and when should I use it?

`VarHandle` is the typed atomic-access API introduced in Java 9 (JEP 193). It provides atomic operations (`compareAndSet`, `getAndAdd`, `getAcquire`, `setRelease`, `getVolatile`, etc.) on object fields, static fields, and array elements. It replaces `sun.misc.Unsafe` (banned in modular Java) and `AtomicReferenceFieldUpdater` (reflective, slower).

```java
private static final VarHandle COUNT;
static { COUNT = MethodHandles.lookup().findVarHandle(Counter.class, "count", int.class); }
COUNT.compareAndSet(this, expect, update);
```

Use it when:

- You need atomics on a field of an object you don't want to wrap in `AtomicInteger`/`AtomicReference`.
- You want explicit memory ordering (`acquire`/`release` instead of full `volatile`).
- You need per-element atomics on a plain `int[]`/`long[]`/`Object[]`.

For a single counter, `AtomicInteger` is still simpler. `VarHandle` shines for high-performance concurrent data structures.

---

## Q7. What's the difference between `@Retention(SOURCE)`, `CLASS`, and `RUNTIME`?

`SOURCE` — javac discards the annotation after annotation processing. Not in the class file. Examples: `@Override`, `@SuppressWarnings`, Lombok's `@Getter`.

`CLASS` — kept in the class file but not loaded into the runtime. Visible to bytecode tools like ASM and ByteBuddy. This is the default if you don't specify `@Retention`. Examples: JSR 305 nullability annotations.

`RUNTIME` — kept in the class file *and* loaded into the runtime; visible to reflection (`Class.getAnnotation(...)`). Examples: `@Test`, `@Component`, `@Entity`, your own runtime-read annotations.

**Trap:** Writing a custom annotation, reading it reflectively, getting `null`, and not realising the retention is the default `CLASS`. Choose retention based on *who reads it*: javac, bytecode tools, or runtime.

---

## Q8. What does `@Target` do, and what targets exist?

`@Target` constrains where an annotation may appear. Without it, an annotation is legal almost everywhere (but not on packages or modules; those need explicit targets). The values come from `ElementType`:

| ElementType         | Where the annotation may go                      |
| ------------------- | ------------------------------------------------ |
| `TYPE`              | Class, interface, enum, record, annotation type  |
| `FIELD`             | Field declaration                                |
| `METHOD`            | Method declaration                               |
| `PARAMETER`         | Method parameter                                 |
| `CONSTRUCTOR`       | Constructor                                      |
| `LOCAL_VARIABLE`    | Local variable                                   |
| `ANNOTATION_TYPE`   | Another annotation type (meta-annotation)        |
| `PACKAGE`           | `package-info.java`                              |
| `TYPE_PARAMETER`    | Generic type parameter (Java 8+, JEP 104)        |
| `TYPE_USE`          | Any use of a type — `@NonNull String` etc.       |
| `MODULE`            | Module declaration                               |
| `RECORD_COMPONENT`  | Record components (Java 14+)                     |

`@Target({METHOD, FIELD})` lets the annotation appear on both. `@Target({})` means "nowhere directly applicable; this is a meta-annotation only."

---

## Q9. What does `@Inherited` do? What is the common gotcha?

`@Inherited` on an annotation declaration means: if a class carries this annotation, its subclasses are considered to carry it too. The gotcha is that `@Inherited` only walks the *superclass* chain — interfaces are excluded. An annotation on an interface is not propagated to implementors via `@Inherited`.

```java
@Inherited @Retention(RUNTIME) @Target(TYPE)
public @interface Auditable { }

@Auditable public interface Trackable { }
public class Order implements Trackable { }

Order.class.isAnnotationPresent(Auditable.class);   // false — interface, not superclass
```

Spring's `AnnotationUtils.findAnnotation(...)` walks superclasses *and* interfaces *and* meta-annotations, which is why Spring annotations like `@Service` (itself annotated `@Component`) work; the plain JDK `getAnnotation` does not.

---

## Q10. Explain `@Repeatable` with an example.

Before Java 8, the same annotation could appear at most once per element. `@Repeatable` lets you declare an annotation that can repeat, paired with a *container* annotation:

```java
@Retention(RUNTIME) @Target(METHOD) @Repeatable(Schedules.class)
public @interface Schedule { String cron(); }

@Retention(RUNTIME) @Target(METHOD)
public @interface Schedules { Schedule[] value(); }

class Job {
    @Schedule(cron = "0 0 * * *")
    @Schedule(cron = "0 12 * * *")
    public void run() { }
}

Schedule[] schedules = Job.class
    .getMethod("run")
    .getAnnotationsByType(Schedule.class);  // both — the container is unwrapped
```

`getAnnotationsByType` (Java 8+) handles the container indirection. `getAnnotation(Schedule.class)` returns `null` because the *direct* annotation on the method is `@Schedules`, not `@Schedule`.

---

## Q11. What does `Class.forName` do, and what's the loader pitfall?

`Class.forName(String name)` loads the named class using the *defining class loader* of the *caller* and *initialises* it (runs `<clinit>`). The loader pitfall is environments where the caller's loader cannot see the named class — Tomcat webapps, OSGi bundles, Spring DevTools — leading to `ClassNotFoundException` even when the class exists in a different loader.

The robust form: `Class.forName(name, true, loader)` with an explicit loader (often `Thread.currentThread().getContextClassLoader()`). The robust *design*: avoid `Class.forName` for plugin discovery and use `ServiceLoader<T>` instead — it handles loaders correctly by construction.

---

## Q12. What is JPMS doing to my reflection, and how do I fix `InaccessibleObjectException`?

The Java Module System (JEP 261, Java 9) introduced *strong encapsulation*. Reflective access into a package across module boundaries requires the target module to declare the package `opens`:

```java
module my.entities {
    opens my.entities to com.fasterxml.jackson.databind;   // qualified open
    opens my.entities;                                     // unqualified open
}
```

Without `opens`, `setAccessible(true)` throws `InaccessibleObjectException`. The fixes in order of preference:

1. Make the consumer modular and declare `opens` in the producer's `module-info.java`.
2. For legacy code, add `--add-opens module/package=ALL-UNNAMED` to JVM args.
3. Avoid the reflection — use the documented API or, for serialisation, configure the framework's modular access mode.

**Trap:** Adding `--add-opens java.base/...` flags to "fix" the problem without realising you've punched holes in JDK encapsulation. JDK 16+ no longer permits unrestricted `--illegal-access`.

---

## Q13. What's an annotation processor and what does it do?

An annotation processor (JSR 269) is a Java class implementing `javax.annotation.processing.Processor` that `javac` runs during compilation. It receives the source-level model (`javax.lang.model`), inspects elements carrying its declared annotations, and may generate new source files via `Filer.createSourceFile(...)`. Generated sources participate in subsequent compilation rounds. The processor pattern moves work from runtime to compile time — no reflection at runtime, no startup cost.

Examples: Lombok (bytecode-time, technically not a pure processor), Dagger (DI without runtime reflection), MapStruct (compile-time bean mapping), Hibernate JPA modelgen (typed metamodel for criteria queries), Google AutoValue, Immutables.

**Follow-up:** "Why isn't Spring a processor?" Spring discovers components dynamically at runtime (you can scan any classpath). Dagger requires all bindings known at compile time. The trade is dynamism vs startup speed.

---

## Q14. Compare runtime reflection with annotation processing.

| Aspect              | Runtime reflection                          | Annotation processor                              |
| ------------------- | ------------------------------------------- | ------------------------------------------------- |
| When work happens   | At runtime, per call (cached)               | At compile time                                   |
| Discoverability     | IDE shows reflective calls; rename unsafe   | Generated code is real Java; IDE handles it fully |
| Runtime cost        | 5–10 ns per cached call                     | Zero — generated code calls directly              |
| Build cost          | Zero                                        | Slower compile                                    |
| Flexibility         | Works on any class at runtime               | Only classes available at compile time            |
| Errors              | At runtime                                  | At compile time                                   |
| Best for            | Framework discovery of user code            | Boilerplate elimination, codegen                  |

Dagger 2 and Spring sit on opposite ends of this trade. JUnit 5 uses both — annotation processing for some discovery, reflection for invoking test methods.

---

## Q15. What is `ServiceLoader` and when do I prefer it to `Class.forName`?

`ServiceLoader<T>` is the JDK's standard mechanism for discovering implementations of a service interface across the classpath and the module path. Providers declare themselves in `META-INF/services/<service-interface-fqn>` (classpath style) or via `provides X with Y;` in `module-info.java` (modular style). Consumers call `ServiceLoader.load(T.class)` and iterate.

Prefer it to `Class.forName(stringFromConfig)` because:

- The contract is typed (`T`), not string.
- The JDK handles class loading with the correct loader.
- Multiple providers are first-class — adding one is a config-file change, no source edit.
- JPMS-aware — modular providers are checked against the module graph at startup.

---

## Q16. How does Spring's `@Component` scan work under the hood?

At startup, Spring walks the configured base packages and for each `.class` file, reads the bytecode (using ASM, not full reflection) to check whether `@Component` (or a meta-annotation like `@Service`, `@Repository`, `@Controller`) is present in the constant pool. For classes that pass, Spring loads them via `Class.forName(name, false, classLoader)`, then reflectively inspects constructors to find the bean's dependencies. Beans are instantiated via `Constructor.newInstance(...)` and stored in the application context. Spring extends this with `@Configuration` + `@Bean` factory methods, AOP proxies (CGLIB or JDK `Proxy`), and lazy initialisation.

The bytecode-level scan is essential — using reflection for discovery would force every class to be loaded just to be inspected, multiplying startup time. The bytecode read pays off when 10 000 classes are scanned but only 200 are components.

---

## Q17. When does reflection break JIT inlining?

`Method.invoke` is treated as opaque by the JIT — it sees a generic method that boxes arguments, performs access checks, and dispatches indirectly. The JIT cannot inline the *target* method through `invoke` in a useful way; the indirection survives.

`MethodHandle` in a *static final* field is JIT-friendly — the handle is treated as a class-load-time constant, and the JIT inlines its target almost as if it were a direct call. Hold a handle in an *instance* field and the JIT loses the constant-folding optimisation.

In hot loops with millions of calls per second, the difference is dramatic: `Method.invoke` shows up at 30% of CPU time; `MethodHandle.invokeExact` shows up at 1–2%. JEP 416 (JDK 18) reimplemented core reflection on top of `MethodHandle`, closing most of the gap for *warmed* `Method.invoke` — but `static final MethodHandle` is still the fastest.

**Trap:** Believing JDK 18+ makes reflection "fast." It's faster *after warmup* and *when cached*. Cold paths and uncached reflection are still slow.

---

## Q18. How do you cache reflection without leaking class loaders?

Use `java.lang.ClassValue<V>`. It is the JDK's purpose-built per-class cache that participates correctly in class unloading — when a class is unloaded (e.g., a webapp redeploys), the cached value goes with it. A `ConcurrentHashMap<Class<?>, V>` would pin the class forever via a strong reference, preventing class loader unloading and leaking the entire app's classes.

```java
private static final ClassValue<List<Method>> CACHE = new ClassValue<>() {
    @Override protected List<Method> computeValue(Class<?> c) {
        return Arrays.stream(c.getDeclaredMethods()).toList();
    }
};
```

`ClassValue.get(class)` is also lock-free for repeat reads of the same class — competitive with a manual `ConcurrentHashMap.computeIfAbsent` and correct on unload.

**Follow-up:** "What about a `WeakHashMap<Class<?>, V>`?" Works for unload semantics but lock-protects the whole map; not as fast as `ClassValue` under contention.

---

## Q19. What does `LambdaMetafactory` give you over `MethodHandle`?

`LambdaMetafactory.metafactory(...)` is the bootstrap used by every Java lambda. Given a `MethodHandle` to a target method and a functional interface, it synthesises a class implementing that interface whose single method calls the target. The result is indistinguishable from a hand-written lambda — same JIT treatment, same inlinability, same near-zero per-call cost.

Frameworks use it to *replace* hot-path reflection with synthesised, JIT-friendly lambdas:

```java
Function<Order, BigDecimal> totalGetter = ... // synthesised once
for (Order o : orders) total = totalGetter.apply(o);   // ~1 ns
```

Jackson 2.12+ uses this idiom for bean property access; throughput jumped 30–50% over reflection-based getters. The cost is paid once at setup; the per-call cost matches a written lambda.

---

## Q20. Why is reflection considered a code smell when it appears in application code?

Three reasons. **One:** it bypasses the compiler — string-typed lookups (`getMethod("findById", long.class)`) are not refactored by the IDE, so a method rename silently breaks them at runtime. **Two:** it defeats `static` analysis — ArchUnit, Sonar, Find usages, and dependency tools all undercount reflective callers. **Three:** it is slow at the call site (per-call boxing, exception bookkeeping, access checks) and slow at startup (class scanning, processor rounds).

Reflection is appropriate in *infrastructure* — framework discovery, plugin loading, test runners, serialisation. It is rarely appropriate in *application* code. The "no reflection unless necessary" rule, enforced with ArchUnit, keeps the seam between business logic and framework glue visible.

**Trap:** Believing the rule means "never reflect." It means "confine reflection to a named layer, cache lookups, hold MethodHandles in static final fields, and choose ServiceLoader or annotation processors when they fit."

---

**Use this list:** rotate one question from each cluster — basics (Q1–Q3), exceptions and behaviour (Q4, Q9, Q10), `MethodHandle`/`VarHandle` (Q5–Q6, Q17), annotations (Q7, Q8, Q11), modules and discovery (Q12, Q15, Q16), processors and performance (Q13, Q14, Q18, Q19), code review judgement (Q20). Strong candidates explain *why* the runtime behaves the way it does — wrapped exceptions, JPMS encapsulation, JIT inlinability — not just *how* to call the API.
