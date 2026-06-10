# Static Keyword — Middle

> **Why?** `static` exists for things that genuinely belong to the *class* — constants, factories, utilities — and for cases where you need a single coordination point. Used correctly, it makes APIs cleaner and faster. Used as a global-variable shortcut, it produces fragile, untestable, race-prone code.
> **When?** Reach for `static` only when you can answer "this datum/operation has nothing to do with any specific instance." If you're using `static` to *avoid passing parameters*, you've smuggled in a global.

---

## 1. The static-vs-instance test

For every member, ask: **does this depend on an instance's state?**

- *Yes* → instance member.
- *No* → static is allowed.

But "*allowed*" is not "*required*." Adding `static` carries downsides — testability, threading, lifecycle — that you should weigh.

Two follow-up questions:

- *Will multiple threads read or write this?* → static mutable state needs a thread-safety story.
- *Will tests want to substitute this?* → static dependencies are hard to mock.

Static is right for `Math.abs`. It is *wrong* for `UserService.findById(id)` if `UserService` reaches into a global database — that's untestable.

---

## 2. The four legitimate uses of `static`

Most well-designed Java code uses `static` for one of these:

**(a) Compile-time constants.**

```java
public static final int MAX_RETRIES = 5;
public static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);
```

**(b) Pure utility methods.**

```java
public static int compareSemver(String a, String b) { ... }
public static String slugify(String text) { ... }
```

**(c) Factory methods.**

```java
public static List<T> of(T... elems) { ... }
public static Optional<T> empty() { ... }
public static Money usd(long cents) { ... }
```

**(d) Static nested classes.**

```java
public static class Builder { ... }
```

If your `static` doesn't fall into one of these four buckets, audit it carefully — you're likely creating global state.

---

## 3. Why `static` mutable state is an antipattern

```java
public class UserCache {
    private static Map<Long, User> cache = new HashMap<>();

    public static User find(long id) {
        return cache.computeIfAbsent(id, k -> loadFromDb(k));
    }
}
```

Looks innocent. But:

1. **Testability**: a test for `UserService.greet(userId)` cannot substitute the cache. The static field is reachable from anywhere; no test isolation.
2. **Threading**: `HashMap` is not thread-safe. Concurrent calls corrupt the structure (use `ConcurrentHashMap` instead).
3. **Lifecycle**: when a test wants to start fresh, it must remember to call `UserCache.reset()`. Forgetting → flaky tests.
4. **Coupling**: every reader is now coupled to `UserCache`. The dependency is invisible — no constructor declares it.

The fix is *dependency injection*. The cache becomes an instance field of a service:

```java
public class UserService {
    private final UserCache cache;
    public UserService(UserCache cache) { this.cache = cache; }
    public User find(long id) { return cache.find(id); }
}
```

The cache is now explicitly owned by the service; tests can pass a fake; threading is a property of the cache instance, not a global.

---

## 4. Singletons — done right

If you genuinely need exactly one instance, use the **enum singleton**:

```java
public enum DatabaseConnection {
    INSTANCE;

    private final HikariDataSource pool = new HikariDataSource(...);

    public Connection get() { return pool.getConnection(); }
}

DatabaseConnection.INSTANCE.get();
```

Why enum?

- The JVM guarantees exactly one instance.
- Reflection cannot break it (`Constructor.setAccessible(true)` is rejected for enums).
- Serialization is automatic and safe.
- It's the simplest correct singleton implementation.

The classic "static field + private constructor" works but has subtleties (double-checked locking, lazy initialization holder idiom, reflection attacks). Use enum unless you have a reason not to.

In a DI-driven app, you probably *don't* want a singleton in code at all — let your DI container manage lifecycle. `@Singleton` (Guice, Spring) achieves the same thing without the static.

---

## 5. Lazy holder idiom

When you do want a static singleton with lazy initialization (e.g., expensive to construct):

```java
public class Config {
    private Config() { ... loads files, parses ... }

    private static class Holder {
        static final Config INSTANCE = new Config();
    }

    public static Config getInstance() {
        return Holder.INSTANCE;
    }
}
```

The JVM only initializes `Holder` on the first call to `getInstance()`. Class initialization is thread-safe per the JLS (the JVM holds an init lock per class). So `INSTANCE` is created exactly once, lazily, with no explicit synchronization.

This is the cleanest lazy-static pattern in Java.

---

## 6. Static initialization order — the gotcha

Static initializers (and static field initializers) run **in textual order**:

```java
public class Constants {
    public static final int A = B + 1;       // sees B at default value 0
    public static final int B = 10;
}

System.out.println(Constants.A);   // 1, not 11
```

This is one of the most common silent bugs. The compiler can't reorder; it must execute as written. Forward references compile but read defaults.

Two safer patterns:

**(a)** Declare in dependency order (top-down).

**(b)** Use a `static {}` block to compute everything in one place.

```java
public class Constants {
    public static final int B;
    public static final int A;

    static {
        B = 10;
        A = B + 1;
    }
}
```

Now the order is explicit and visually obvious.

---

## 7. Class initialization is *triggered* — not arbitrary

A class's static initializer runs when (per JLS §12.4.1):

1. An instance is created (`new MyClass()`).
2. A static method is called.
3. A non-`final` static field is read or written.
4. `Class.forName("MyClass")` is called (with default `initialize=true`).
5. A subclass is initialized (parent must be initialized first).

It does **not** run for:

- A class literal: `MyClass.class` does not initialize.
- A `Class.forName("MyClass", false, loader)` call (explicit no-init).
- Reading a `static final` *constant expression* — that value was inlined at compile time.

This last point trips people up. If you have:

```java
public class A {
    public static final int VALUE = 42;        // compile-time constant
    static { System.out.println("A loaded"); }
}

System.out.println(A.VALUE);    // prints 42 — but does NOT print "A loaded"
```

Reading `A.VALUE` doesn't initialize `A` because the compiler inlined `42` into the call site. To force initialization in such cases, use a non-`final` static, a method call, or `Class.forName(...)`.

---

## 8. The lifecycle of static state

Static state lives:

- From: class loading (which itself is triggered as in §7).
- To: class unloading. In most apps, classes never unload — the lifetime is the JVM's lifetime.

Class unloading happens when:

- The defining class loader becomes unreachable (a webapp redeploy, an OSGi bundle reload, a custom URL classloader being garbage-collected).
- The runtime then unloads classes loaded by it.

So in a typical standalone app, static fields are effectively permanent. In a container or hot-reload environment, they have a defined but unusual lifecycle. **Don't rely on static fields in code that may be hot-reloaded** without understanding the loader story.

---

## 9. `static final` constants — when the compiler inlines

A `static final` field whose initializer is a *constant expression* (per JLS §15.28) is treated specially:

```java
public class Config {
    public static final int MAX = 100;             // inlined at every read site
    public static final String NAME = "myapp";     // inlined
    public static final int[] PRIMES = {2, 3, 5};   // NOT inlined — array literals aren't constant expressions
}
```

For inlined constants, every reading bytecode contains the literal value — not a `getstatic`. The implication: **changing the constant requires recompiling every reader**. Otherwise readers keep the old value baked in.

This is mostly an issue across jars: if `lib.jar` defines `MAX = 100` and `app.jar` reads it, then a new `lib.jar` with `MAX = 200` won't update `app.jar` until `app.jar` is recompiled.

Workarounds:

- For values that may change between releases, use a non-`final` static (or a getter method).
- For true constants, accept that recompiling consumers is fine.

---

## 10. Static methods and dispatch

Static methods are *not* virtual. They are dispatched at compile time based on the static type of the call:

```java
class A { static String hi() { return "A"; } }
class B extends A { static String hi() { return "B"; } }   // hides A.hi, doesn't override

A a = new B();
a.hi();                  // "A" — by static type of `a`
B.hi();                  // "B"
```

This is **method hiding**, not overriding. It's a common source of bugs. A subclass can have a `static` method with the same signature, but polymorphism doesn't apply.

Practical advice: **don't introduce a `static` method on a subclass with the same name as a parent's `static`.** It compiles, it's confusing, and there is essentially no reason to do it.

---

## 11. Threading: visibility, atomicity, ordering

Three separate concerns for any static mutable field:

**(a) Visibility.** Without `volatile` or synchronization, a write from one thread may never be observed by another. Plain `static int count = 5` followed by `count = 6` may leave readers seeing `5` indefinitely.

**(b) Atomicity.** `count++` is read-modify-write. Even with `volatile`, two threads can race.

**(c) Ordering.** Without explicit synchronization, the JVM/CPU may reorder reads and writes around static accesses.

Toolbox:

- **`volatile`**: cheap visibility for *single-variable* reads/writes. Doesn't make compound operations atomic.
- **`AtomicInteger` / `AtomicLong` / `AtomicReference`**: lock-free atomicity for single fields.
- **`LongAdder`**: optimized for high-contention counters.
- **`synchronized`**: coarse but reliable. Fine for low-contention paths.
- **`ConcurrentHashMap`**: replaces `synchronized(map)` with internal partitioning.

For static fields specifically, `volatile` + `final` references (after construction) is a common idiom: the reference itself is immutable, the underlying object is concurrent.

---

## 12. Static methods make testing harder

A method that calls another static method has a hidden dependency:

```java
public class OrderService {
    public void place(Order o) {
        Validator.validate(o);            // static call
        OrderRepository.save(o);           // static call
        EmailSender.notify(o);             // static call
    }
}
```

To test `place(...)`, you must:

- Either let the real validator/repository/sender run — and now your "unit" test depends on them all.
- Or use a mocking library that can mock static methods (Mockito 3.4+, PowerMock).

The cleaner alternative is dependency injection:

```java
public class OrderService {
    private final Validator validator;
    private final OrderRepository repo;
    private final EmailSender sender;

    public OrderService(Validator v, OrderRepository r, EmailSender s) {
        this.validator = v; this.repo = r; this.sender = s;
    }

    public void place(Order o) {
        validator.validate(o);
        repo.save(o);
        sender.notify(o);
    }
}
```

Now tests substitute fakes through the constructor. No magic, no global state. The static API was *ergonomic*; the instance API is *testable*.

---

## 13. When `static` *is* the right call — checklist

Reach for `static` when *all* of these are true:

1. The member doesn't depend on any instance state.
2. It's a pure function, a constant, a factory, or class-scoped metadata.
3. There's no foreseeable need to substitute it in tests.
4. There's no hidden global mutable state behind it.
5. It doesn't reach into the network/database/clock — those are dependencies.

`Math.abs(int)` passes all five.
`UserService.findById(long)` (if it secretly hits a database) fails 3, 4, and 5.

---

## 14. Static nested vs inner — performance and clarity

A non-static *inner* class:

- Holds an implicit reference to the enclosing instance (`Outer.this`).
- Cannot be instantiated without an outer instance.
- Keeps the outer alive even if logically done with it (memory leak risk).

A *static* nested class:

- No implicit reference.
- Can be instantiated standalone (`new Outer.Nested()`).
- Has no lifecycle coupling to the enclosing instance.

**Default to static.** Make the nested class non-static only if it genuinely needs to access enclosing-instance state.

Common bug: forgetting `static` on a `Builder` nested class causes every `Builder` to retain the enclosing instance — a slow leak in long-running services that build many objects.

---

## 15. The middle-level checklist

For every `static` declaration you introduce:

1. Is this *truly* class-scoped, or am I avoiding instance plumbing?
2. Is the value immutable, or is this a global counter / cache?
3. Could a DI container or factory replace this?
4. Will tests need to substitute it?
5. If mutable: what's the thread-safety contract?
6. If a constant: is it inlined? Will cross-jar recompilation be an issue?
7. If a static method: am I introducing a hidden dependency?
8. If a static nested class: should it really be static? (Almost always yes.)
9. If a singleton: is enum the right choice?
10. Is this `static` because the JVM requires it (`main`), because the language requires it (constants), or because I picked it?

When `static` survives all ten questions, it's the right call. When you can't justify one of them, refactor — usually toward dependency injection or instance state.
