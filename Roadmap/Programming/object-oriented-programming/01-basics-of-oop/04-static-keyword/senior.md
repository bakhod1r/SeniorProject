# Static Keyword — Senior

> **How to optimize?** Use `static` for things that are *genuinely* class-scoped — constants, immutable factories, pure utilities — and aggressively avoid it for anything that could be a dependency. The biggest wins come from *removing* `static` from places it doesn't belong.
> **How to architect?** Treat `static` as the keyword that breaks dependency injection. Whenever you see `static` on a method that does I/O or mutates shared state, you've found an architectural debt — turn it into an injectable dependency or move it to a clear boundary class.

---

## 1. Static = no DI

Dependency injection works because every collaborator a class needs comes through its constructor (or a setter). Tests can substitute fakes; production wires real implementations.

`static` short-circuits this. A static call reaches across the wiring and grabs whatever the static refers to — usually a global or a class-level helper. The collaborator is invisible in the constructor; the only way to substitute it is to mock the static method itself (Mockito's `mockStatic`, PowerMock).

Senior architectural rule: **public APIs should be instance methods invoked through DI, not static methods invoked through the class name.**

The legitimate exceptions are pure functions (`Math.abs`), trivial factories (`List.of`), and constants (`HttpStatus.OK`). Anything else — and especially anything that does I/O, modifies shared state, or has variability — should be an instance.

---

## 2. The "fat utility class" smell

A class with 30 static methods that calls a database is not a utility class. It's a service in disguise.

```java
public class OrderUtils {
    public static Order findById(long id)         { return DB.connection().query(...); }
    public static void  cancel(Order o)            { DB.connection().update(...);     }
    public static Money totalFor(long userId)     { /* loops over orders */            }
}
```

Symptoms:

- `OrderUtils.findById` cannot be tested without a real (or heavily mocked) database.
- The DB connection is itself a global singleton, multiplying the problem.
- Refactoring the DB choice (e.g., adding caching, switching to read replicas) requires changing every static method's body.

The senior fix: convert it to a service:

```java
public class OrderService {
    private final OrderRepository repository;

    public OrderService(OrderRepository repository) { this.repository = repository; }

    public Order findById(long id)        { return repository.findById(id); }
    public void cancel(Order o)            { repository.cancel(o); }
    public Money totalFor(long userId)    { return repository.totalFor(userId); }
}
```

Now the dependency is explicit, testable, and substitutable.

---

## 3. Static factories — the *good* kind of static

The *useful* kind of static method: a factory that returns an immutable value.

```java
public static List<E> of(E... elems);          // List.of(...)
public static Optional<T> empty();             // Optional.empty()
public static Money usd(long cents);           // your domain factory
```

These are pure: same input → same output, no side effects. They:

- Have meaningful names (`Money.usd(cents)` is clearer than `new Money(cents, "USD")`).
- Can return cached instances (`Optional.empty()` returns the same object every call).
- Can return subtypes — the API is the static method's return type, not a class.

For library APIs, prefer static factories over public constructors. Constructors lock you into:
- Allocating a new object every time.
- Returning the exact declaring class.
- Having no name for the constructor itself.

Static factories give you flexibility in all three.

---

## 4. The "singleton" tradeoff

Three reasons people reach for singletons:

1. **A genuinely global resource.** A connection pool, a metric registry, a JVM-wide cache. Real constraint.
2. **Avoiding parameter plumbing.** The "current user," "current request," "default config." Looks pragmatic; *creates global state*.
3. **Confused dependency.** "It's hard to inject this everywhere." Symptom of an architecture problem; static is not the cure.

Only (1) survives senior review.

For (1), prefer DI-managed singletons (`@Singleton` in Guice/Spring) over hand-rolled `static INSTANCE` — same effect, but injectable and substitutable in tests.

For (2) and (3), find the right boundary class and inject. The pain of "carrying things through constructors" is usually a sign that you're missing a class, not that you need a static.

---

## 5. Architecture: the "service registry" antipattern

Some codebases have a `ServiceRegistry`:

```java
public class ServiceRegistry {
    private static final Map<Class<?>, Object> services = new HashMap<>();

    public static <T> void register(Class<T> iface, T impl) { services.put(iface, impl); }
    public static <T> T get(Class<T> iface) { return (T) services.get(iface); }
}
```

It's a global service locator. Code calls `ServiceRegistry.get(EmailSender.class).send(...)` instead of declaring `EmailSender` as a dependency.

Problems:

- Every class is implicitly coupled to every service. The dependency graph is invisible.
- Tests must populate the registry before each run; forget to clean up → contaminated state.
- Replacing a service in a subset of tests requires more setup than just constructor injection.
- IDE refactoring (find usages, rename) misses string- or class-keyed lookups.

Senior architects replace service locators with explicit DI. The locator is "convenient" only because the explicit graph is undocumented.

---

## 6. Class initialization deadlocks

When two classes have static initializers that depend on each other, you can deadlock:

```java
public class A {
    static final int X = B.Y + 1;
}
public class B {
    static final int Y = A.X + 1;
}
```

If thread T1 starts initializing `A` (acquires A's init lock), and thread T2 simultaneously starts initializing `B` (acquires B's lock), they wait for each other forever.

Senior diagnosis: `jstack` shows two threads in `IN_PROGRESS` initialization state, each waiting for a `Class init` lock. The fix is to break the cycle — usually by computing the values in a `static {}` block on one class only, or by deferring the dependency to a method call.

A general rule: **static initializers should be self-contained**. Reaching across to another class's statics during initialization is a hazard.

---

## 7. Static + class loading lifecycle

Static state is tied to a `Class<?>`, which is tied to a `ClassLoader`. Two classes with the same name from two different loaders are *different* runtime classes with *separate* static state.

This matters in:

- **App servers** (Tomcat, Jetty): each webapp has its own classloader. Static singletons are *per-webapp*, not JVM-global. Surprising for newcomers.
- **Hot reload** (Spring DevTools, JRebel): reloading a class via a fresh loader resets its statics. Code holding a reference to an "old" version may still see the old statics.
- **Plugin systems** (OSGi): bundles have their own loaders. Cross-bundle static sharing requires explicit service mechanisms.

If you're designing a framework or a multi-tenant system, understand classloader isolation deeply. Static state isn't as "global" as it looks.

---

## 8. Static `final` in records and immutable types

Records can have static fields and static methods, but no instance fields beyond the components.

```java
public record Money(long cents, Currency currency) {
    public static final Money ZERO_USD = new Money(0, Currency.getInstance("USD"));

    public static Money usd(long cents) { return new Money(cents, Currency.getInstance("USD")); }
}
```

This is the canonical pattern for immutable types: instance state in components, common values and factories as static. The record gets `equals`/`hashCode`/`toString` automatically; the statics provide ergonomic construction.

---

## 9. Static methods on interfaces (Java 8+)

Java 8 added static methods on interfaces:

```java
public interface PaymentMethod {
    void charge(Money amount);

    static PaymentMethod of(String name) {
        return switch (name) {
            case "CARD"   -> new CreditCard();
            case "WALLET" -> new Wallet();
            default       -> throw new IllegalArgumentException();
        };
    }
}

PaymentMethod m = PaymentMethod.of("CARD");
```

This is the "interface as both API and factory" pattern. The interface owns its construction logic; users don't need a separate factory class.

`Comparator`, `Stream`, `Predicate`, `Function`, `Optional`, `List`, `Map`, `Set` all use this pattern in modern JDK APIs.

Static methods on interfaces are *not* inherited by implementing classes — you call them only via the interface name.

---

## 10. Compile-time constants and binary compatibility

A `public static final` primitive or `String` whose initializer is a constant expression is *inlined* by `javac` into reading bytecode.

This means: changing the constant in the defining class **does not** propagate to consumers without recompilation.

Library authors should know this. If you publish:

```java
public class Limits {
    public static final int MAX_BATCH_SIZE = 100;
}
```

…and consumers compile against your library, every read of `Limits.MAX_BATCH_SIZE` becomes the literal `100` in the consumer's class file. If you ship a new version where `MAX_BATCH_SIZE = 200`, old consumers still see `100` until rebuilt.

For values that may change between releases, prefer:

```java
public static final int maxBatchSize() { return 100; }
```

or store in a non-final static + getter. The trade-off is one extra method call per read — usually negligible.

---

## 11. Static + JIT — a small but real win

The JIT inlines `static` method calls easily because there's no virtual dispatch:

- `invokestatic` is a direct call. The JIT inlines the body if size limits permit.
- No CHA dependency, no inline cache, no megamorphic fallback.

A `final` instance method gets the same treatment. But if you have a *truly* stateless utility, `static` is more honest about its lack of dependency on `this`.

For hot paths in framework / library code, a private static helper is a lightweight performance choice. Don't over-rotate to it for application code — DI-friendly instance methods are usually the right call.

---

## 12. The "constants class" antipattern

A class that's nothing but constants:

```java
public class Constants {
    public static final int MAX_USERS = 1000;
    public static final String DEFAULT_LANG = "en";
    public static final int MIN_AGE = 13;
    public static final Duration TIMEOUT = Duration.ofSeconds(30);
    // 50 more...
}
```

Two problems:

- The constants are scattered without context. Why is `MIN_AGE` here? Whose age?
- Changes ripple — touching one constant invalidates the whole class for compilation.

Better: group constants with their domain.

```java
public class UserPolicy {
    public static final int MIN_AGE = 13;
    public static final int MAX_USERS = 1000;
}

public class HttpClientConfig {
    public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);
}
```

Or, even better, model them as configuration objects loaded from external sources.

---

## 13. Static methods and equals/hashCode contracts

Easy to forget: `Objects.equals(a, b)` and `Objects.hash(a, b, c)` are static utility methods. They're the *recommended* way to implement `equals`/`hashCode` because they handle nulls correctly:

```java
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Money m)) return false;
    return cents == m.cents && Objects.equals(currency, m.currency);
}

@Override public int hashCode() {
    return Objects.hash(cents, currency);
}
```

The `Objects.hash` form has a small allocation cost (varargs `Object[]`). For hot paths, hand-roll:

```java
@Override public int hashCode() {
    int h = Long.hashCode(cents);
    h = 31 * h + currency.hashCode();
    return h;
}
```

The static helpers are great for clarity; the manual version is great for hot paths. Use the right tool.

---

## 14. The senior architecture decisions

When designing a new module:

1. **No mutable static state**, except for genuinely global resources (connection pools, metrics) — and those should be DI-managed, not hand-rolled singletons.
2. **Constants in their domain class**, not a `Constants` god class.
3. **Static factory methods** for immutable types (records, enums, value classes).
4. **Static utility classes** only for truly pure functions. The rule of thumb: if the method needs *any* configuration or external dependency, it doesn't belong as a `static`.
5. **Static nested classes** by default for nested types; non-static inner classes only when the enclosing-instance reference is genuinely needed.
6. **No service locators** — use DI.
7. **Lazy holder idiom** for any static singleton that has expensive initialization.
8. **Initialization-order discipline**: declare dependent statics top-down, or use `static {}` blocks for explicit ordering.

When refactoring legacy code:

- Identify static methods that do I/O or mutate shared state.
- Extract them into instance methods on services.
- Inject those services through constructors.
- Track the diff in test coverage — it almost always goes up, because the now-injectable dependencies enable real unit tests.

---

## 15. The senior checklist

For each `static` member in code review:

1. **Pure?** No I/O, no clock, no random, no mutable state.
2. **Class-scoped?** Conceptually belongs to the class, not an instance.
3. **Substitutable?** Or are tests forced to mock statics?
4. **Thread-safe?** If mutable, what's the policy?
5. **Initialization-safe?** No forward references, no cyclic dependencies.
6. **Inlined?** If a constant, is consumer-recompile-required-after-change documented?
7. **Necessary?** Or could it be an instance method on a DI-managed service?

The senior pattern: aggressive `static` for true constants, factories, and pure utilities. Aggressive *avoidance* of `static` for anything else. The codebase's static-method count tells you a lot about how testable, modular, and maintainable it really is.
