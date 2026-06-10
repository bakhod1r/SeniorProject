# Reflection and Annotations — Senior

> **What?** The runtime characteristics of reflection vs `MethodHandle` vs direct invocation, `VarHandle` for atomic access, what JPMS `opens` actually means for reflective callers, the full annotation processor pipeline including incremental compilation, `ServiceLoader` as the modular successor to ad-hoc `Class.forName`, classloader pitfalls in server containers, and the security implications of `setAccessible`.
> **How?** Each section pairs the API surface with the JVM-level mechanism that explains *why* the API behaves the way it does — so you can reason about novel situations rather than memorise rules.

---

## 1. Reflection vs MethodHandle vs direct — a mental model

There are three Java-level ways to invoke a method by indirection. They differ in *when* the cost is paid.

```java
// Direct
target.doWork(arg);

// Reflection
Method m = target.getClass().getMethod("doWork", String.class);
m.invoke(target, arg);

// MethodHandle
MethodHandle mh = MethodHandles.lookup().findVirtual(
        target.getClass(), "doWork", MethodType.methodType(void.class, String.class));
mh.invokeExact(target, arg);
```

Conceptually:

| Mechanism       | Lookup cost                                  | Per-call cost (after JIT)              | JIT inlining        |
| --------------- | -------------------------------------------- | --------------------------------------- | ------------------- |
| Direct          | None (resolved at compile time)              | Bytecode `invokevirtual`/`invokestatic` | Yes, freely         |
| `Method.invoke` | Hash lookup on name+params; access check     | Boxed varargs, security check, dispatch | Limited; treats `invoke` as opaque |
| `MethodHandle`  | Lookup at link time; security check once     | Direct call after JIT warms up         | Yes, like a `static final` handle |

The historical answer "reflection is 10–100× slower than direct" is approximate. JDK 18 (JEP 416) reimplemented core reflection on top of `MethodHandle` so that long-lived reflective call sites converge to the speed of `MethodHandle` invocation — but the *first hundred* invocations of a freshly looked-up `Method` still go through the slow path.

The rule that matters: **the cost of building a `Method` or `MethodHandle` is real; the cost of invoking a *cached* `MethodHandle` is close to direct; the cost of invoking a *cached* `Method.invoke` is somewhere in between**.

---

## 2. When to choose `MethodHandle`

The decision is rarely "I should make my framework faster" — it is "this call site is invoked enough times per second to justify a more complex API."

Choose `MethodHandle` when:

- The same method will be invoked many times against many receivers — caches like Jackson's per-property accessors.
- You want the JVM to inline the indirection — `static final MethodHandle` is treated as a constant after class loading.
- You need composition (`MethodHandle.bindTo`, `asType`, `dropArguments`, `filterArguments`) — these are not available on `Method`.
- You generate `invokedynamic`-style call sites yourself — lambdas, `String` concat, switch on patterns all do this internally.

Keep `Method.invoke` when:

- The lookup is one-shot (loading a single class on startup, running a script).
- Argument types are unknown at compile time (e.g., truly dynamic dispatch). `MethodHandle` enforces signatures at the call site; `invokeExact` will throw `WrongMethodTypeException` if the casts don't line up.
- The code is clearer with reflection and the call frequency does not matter.

**Pattern: hold the handle as a `static final` field for inlining.**

```java
private static final MethodHandle CHARGE;
static {
    try {
        CHARGE = MethodHandles.lookup().findVirtual(
                PaymentGateway.class, "charge",
                MethodType.methodType(void.class, BigDecimal.class));
    } catch (ReflectiveOperationException e) {
        throw new ExceptionInInitializerError(e);
    }
}
```

The JIT treats a `static final MethodHandle` as a constant and inlines through it. The same handle stored in an instance field is *not* a constant and gets full virtual dispatch — see `optimize.md`.

---

## 3. `VarHandle` — the typed `Unsafe` you can use

`VarHandle` (Java 9, JEP 193) is to fields what `MethodHandle` is to methods: a typed, directly-usable handle that supports atomic operations. It replaces most legitimate uses of `sun.misc.Unsafe` and the older `AtomicXxxFieldUpdater`.

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

public final class Counter {
    private volatile int value;

    private static final VarHandle VALUE;
    static {
        try {
            VALUE = MethodHandles.lookup().findVarHandle(
                    Counter.class, "value", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public int incrementAndGet() {
        // Lock-free CAS loop.
        int prev, next;
        do {
            prev = (int) VALUE.getVolatile(this);
            next = prev + 1;
        } while (!VALUE.compareAndSet(this, prev, next));
        return next;
    }
}
```

What `VarHandle` gives you that plain field access does not:

- **Memory ordering modes:** `getPlain`, `getOpaque`, `getAcquire`, `getVolatile`, and the matching setters. You choose the cost.
- **Atomic operations:** `compareAndSet`, `getAndAdd`, `weakCompareAndSet`.
- **Array element access:** `MethodHandles.arrayElementVarHandle(int[].class)` gives you per-element atomics on a plain Java array.

Use it where you would have reached for `AtomicReferenceFieldUpdater` (verbose, reflective, slow path) or `Unsafe.compareAndSwapInt` (unsupported, broken on JPMS, removed in Java 23). `AtomicInteger` is still appropriate for a single counter; `VarHandle` shines when you need atomics on fields of objects you don't want to box.

---

## 4. JPMS and reflection — what `opens` really means

Before Java 9, `setAccessible(true)` worked on any package the caller could load. After Java 9 (JEP 261, modules) and especially Java 16 (JEP 396, strong encapsulation by default), JDK internal packages are *closed* to outside reflection unless their module explicitly opens them.

The three relevant directives in `module-info.java`:

```java
module my.domain {
    exports my.domain.api;                            // compile-time and runtime access to public types
    opens   my.domain.entity;                         // runtime reflective access to all types
    opens   my.domain.entity to com.fasterxml.jackson.databind;  // qualified open: only Jackson
}
```

| Directive             | Allows what                                       |
| --------------------- | ------------------------------------------------- |
| `exports`             | Compile-time + runtime access to *public* members of the package's *public* types.       |
| `opens`               | Runtime reflective access to *all* members (public and non-public) via `setAccessible(true)`. |
| `opens … to module.X` | Same as `opens` but only the named modules may reflect in.                                |

What this means in practice:

- A Jackson serialiser reflecting into your private fields needs the package `open` to it.
- Spring's `@Autowired` into private fields needs the package open to Spring.
- A library on the *classpath* (no module) is in the *unnamed module* — `opens … to ALL-UNNAMED` is the equivalent.

If you're not yet modular, you'll see this as the runtime flag `--add-opens java.base/java.lang=ALL-UNNAMED` in build scripts. Each one is a JPMS encapsulation hole punched at startup. The signal is: someone, somewhere, is reflecting into `java.lang` from a non-modular library.

The error message you actually see when this fails:

```
java.lang.reflect.InaccessibleObjectException: Unable to make field java.lang.String.value
accessible: module java.base does not "opens java.lang" to unnamed module @...
```

The fix is *not* `setAccessible(true).setAccessible(true)`. It is to add the `opens` directive in `module-info.java` for your own module, or `--add-opens` at the JVM command line for a third-party module. See [../02-jpms-modules/](../02-jpms-modules/) for the broader story.

---

## 5. The annotation processor pipeline

`javax.annotation.processing` (JSR 269) defines the API; `javac` is the host. The pipeline:

1. **Source parsing.** `javac` parses `.java` files into a tree.
2. **Round 1.** Annotation processors registered on the processor path are loaded. `javac` calls `process(...)` on each, passing the set of source elements that carry annotations the processor declared via `@SupportedAnnotationTypes`.
3. **Code generation.** A processor may emit new source files via `Filer.createSourceFile(...)` or class files via `createClassFile(...)`. Newly generated sources go back to the front of the compilation queue.
4. **Round N.** If round N–1 generated new sources, processors run again on the newer elements. Continue until a round produces nothing new.
5. **Final compilation.** `javac` compiles all sources, original + generated, to bytecode.

Two pieces matter for production hygiene:

**Incremental compilation.** Gradle's incremental compiler invalidates the smallest set of `.java` files affected by a change — *but* annotation processors that don't declare which elements they observe force a full recompile. The `@SupportedAnnotationTypes` annotation tells the build which annotations matter, and the `IncrementalAnnotationProcessor` Gradle service annotation declares the processor as either `isolating` (touches only its own annotated elements), `aggregating` (touches a set), or `dynamic`. Misclassifying a processor makes every change recompile the world.

**Testing processors.** Use the [`compile-testing`](https://github.com/google/compile-testing) library (Google) or `javax.tools.JavaCompiler` directly to run the processor on a synthetic source and assert on the generated output. `JavaCompiler` is the in-JVM `javac` API — give it source strings, a `DiagnosticListener`, and your processor instance; assert that the resulting `Filer` produced the expected files.

```java
JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
StandardJavaFileManager fm = javac.getStandardFileManager(null, null, null);
JavaCompiler.CompilationTask task = javac.getTask(
        null, fm, diagnostics, List.of("-proc:only"), null, sources);
task.setProcessors(List.of(new BuilderProcessor()));
task.call();
```

This is how Lombok, Dagger, AutoValue, and MapStruct keep their processor logic under test without spinning up a full Gradle build.

---

## 6. `ServiceLoader` + reflection — the modular plugin point

If you find yourself writing `Class.forName(System.getProperty("my.driver"))`, you have reinvented `ServiceLoader` badly. `ServiceLoader` (Java 6, JPMS-aware since Java 9) is the JDK's standard way to discover implementations of a service interface across the classpath and the module path.

The service interface:

```java
public interface PaymentGateway {
    void charge(BigDecimal amount, String reference);
}
```

A provider declares itself in *either*:

- `META-INF/services/com.example.PaymentGateway` containing a line per impl class (classpath style), **or**
- `provides com.example.PaymentGateway with com.example.stripe.StripeGateway;` in `module-info.java` (modular style).

The consumer:

```java
ServiceLoader<PaymentGateway> loader = ServiceLoader.load(PaymentGateway.class);
for (PaymentGateway g : loader) {
    g.charge(...);
}
```

`ServiceLoader.load` discovers the providers, the JVM loads them through the right class loader, and reflection happens once at startup — no `Class.forName` strings, no broken class-loader paths.

Why this matters at the senior level:

- **No reflective glue code.** The whole discovery is hidden behind `Iterable<T>`.
- **Module-graph aware.** A modular provider must `requires` the service module and declare `provides`; the runtime refuses to load a provider whose graph is broken.
- **First-class JPMS.** `module-info.java` syntax is the only way to *export an implementation* without exposing the package.

The decision tree: a fixed set of impls = sealed types and direct construction. An *open* set discovered at runtime = `ServiceLoader`. Ad-hoc `Class.forName` + `newInstance` over a list of strings = never; that pattern is the legacy thing you replace.

---

## 7. Cross-classloader reflection — Tomcat, OSGi, Spring Boot fat jars

In any environment with more than one class loader, reflection acquires a new failure mode: *the class you found is not the class the caller expects*.

```java
// In a Tomcat app, plugin classes are loaded by a child loader.
Class<?> pluginClass = Class.forName("com.acme.PluginImpl");      // uses caller's loader
Plugin p = (Plugin) pluginClass.getDeclaredConstructor().newInstance();
//        ^ ClassCastException: PluginImpl cannot be cast to Plugin
```

If `Plugin` is loaded by loader A and `PluginImpl` is loaded by loader B (even if B is a child of A), `B.PluginImpl implements A.Plugin` is *not* the same `Plugin` as `B.Plugin`. The `instanceof` test fails. The cast throws `ClassCastException`.

The fix is to load the class through the *correct* loader explicitly:

```java
ClassLoader pluginLoader = pluginClassLoaderFor(extension);
Class<?> implClass = Class.forName(extension.implClassName(), true, pluginLoader);
// Use the Plugin interface from the *same* loader as the consumer:
Class<?> ifaceFromImplLoader = implClass.getInterfaces()[0];
// Or do the discovery via ServiceLoader, which gets the loaders right by construction:
ServiceLoader.load(Plugin.class, pluginLoader);
```

The senior reflex: when adding reflection to a multi-classloader environment, ask "which loader will load each class?" *before* writing `Class.forName`. The error messages — `ClassCastException`, `LinkageError`, `NoClassDefFoundError` with subtly different package paths in the message — are otherwise opaque.

---

## 8. `setAccessible` and security

Before Java 17, the security model was the `SecurityManager` — a runtime-installed object that vetoed sensitive operations including `setAccessible(true)` on non-public members. JEP 411 (Java 17) deprecated the SecurityManager for removal; JEP 486 (Java 24) finalised that path. In modern Java, the SecurityManager is not your tool.

What remains:

- **JPMS encapsulation.** `setAccessible(true)` on a member of a closed package throws `InaccessibleObjectException`, regardless of any security manager. The module system is now the enforcement layer.
- **Native access.** Java 22+ requires `--enable-native-access` for the Foreign Function & Memory API (JEP 454) — a separate enforcement layer for native calls, often confused with reflection.
- **Implementation choice.** A library can keep its internals truly private by declaring them in a *non-opened* package within its module. Even reflective callers — including frameworks — cannot reach in.

A senior-level takeaway: `setAccessible(true)` is not a *security* bypass any more; it is an *encapsulation* hole that JPMS may or may not allow. If you're writing a library, design your module-info to expose what frameworks need (`opens entity to jackson-databind`) and keep the rest closed.

---

## 9. Performance: caching, escape analysis, and the cost of failure

Three patterns from production reflective code:

**Cache by `Class<?>` with a `ConcurrentHashMap`.** Every framework does it. Computing the cache value is expensive (reflection); reading the cache value is a hash lookup — already a thousand times faster.

```java
private final Map<Class<?>, BeanDescriptor> cache = new ConcurrentHashMap<>();
public BeanDescriptor describe(Class<?> c) {
    return cache.computeIfAbsent(c, this::buildDescriptor);
}
```

**Hold `MethodHandle` in `static final` fields.** As mentioned, the JIT inlines through them. Hot reflection paths that survive escape-analysis hostility become invisible.

**Beware reflective `newInstance` allocating exception arrays.** Every call to `Constructor.newInstance` checks the declared exception list and may allocate. In tight loops this allocation shows up on flame graphs as `NewInstance`. The fix: pre-build a `MethodHandle` to the constructor and call it directly.

```java
MethodHandle ctor = MethodHandles.lookup().findConstructor(
        Order.class, MethodType.methodType(void.class));
Order o = (Order) ctor.invokeExact();   // no exception-array allocation
```

The performance section in `optimize.md` lays out actual JMH numbers; here it's enough to know the *shape* of the cost.

---

## 10. Annotation propagation — `@Inherited` and the interface gap

`@Inherited` only walks the *superclass* chain. Interfaces are excluded. This is documented but counter-intuitive enough that it's worth re-stating at the senior level, because Spring, Hibernate, and JUnit each work around it differently.

```java
@Inherited
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Auditable { }

@Auditable
public interface Trackable { }

public class Order implements Trackable { }

Order.class.isAnnotationPresent(Auditable.class);   // false — interfaces don't propagate
```

Spring's `AnnotationUtils.findAnnotation(...)` walks both superclasses *and* interfaces, even *meta-annotations* (an annotation that carries another annotation). This is why `@Service` "is a" `@Component` — `@Service` is itself annotated `@Component` and Spring searches recursively. The JDK's `getAnnotation` does *not* do this; the JDK rule is "direct annotations + `@Inherited` superclass annotations only."

If you build framework-style code and rely on annotation propagation, use the Spring AnnotationUtils class or write the recursive walk yourself. Don't rely on `@Inherited` to do something it does not do.

---

## 11. Quick rules

- [ ] Direct < cached `MethodHandle` ≈ JIT-warmed `Method.invoke` (JDK 18+) < cold `Method.invoke`. Cache lookups.
- [ ] Hold `MethodHandle` in `static final` fields when you want JIT inlining.
- [ ] `VarHandle` replaces `AtomicXxxFieldUpdater` and most legitimate `Unsafe` uses.
- [ ] `opens` opens a package to reflection; `exports` exposes public types to compilation.
- [ ] On Java 9+, plan for `InaccessibleObjectException` from any reflection into someone else's module.
- [ ] Annotation processors run in rounds; declare `IncrementalAnnotationProcessor` if you ship a processor.
- [ ] Discover plugins with `ServiceLoader`, not ad-hoc `Class.forName` over strings.
- [ ] In multi-classloader environments, load classes through the *expected* loader; otherwise expect `ClassCastException`.
- [ ] `setAccessible` is now encapsulation, not security — JPMS is the gate.
- [ ] `@Inherited` walks superclasses only — not interfaces, not meta-annotations. Use framework helpers when needed.

---

## 12. What's next

| Topic                                                  | File              |
| ------------------------------------------------------ | ----------------- |
| Mentoring "no reflection unless necessary"; ArchUnit   | `professional.md`  |
| JLS/JEP references for reflection and annotations      | `specification.md` |
| Ten reflection bugs, stack traces, fixes               | `find-bug.md`      |
| JMH benchmarks, caching, `LambdaMetafactory`           | `optimize.md`      |
| Hands-on exercises                                     | `tasks.md`         |
| Interview Q&A                                          | `interview.md`     |

---

**Memorize this:** senior reflection is *systems thinking* — when JIT can inline, when JPMS lets you through, which loader holds each class, where caches live, and which slow operations happen on startup vs per call. Choose `MethodHandle` for reuse, `VarHandle` for atomics, annotation processors for compile-time work, and `ServiceLoader` for plugin discovery. The JVM gives you levers; reflection without those levers is a rake you step on.
