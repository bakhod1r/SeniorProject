# Initializer Block — Senior

> **What?** Real-world considerations: when initializer blocks help or hurt, the cost of class initialization, lazy alternatives (lazy holder, `volatile` double-checked locking, `LongAdder`-style lazy fields), and how class init failures affect production systems.
> **How?** By understanding the JVM's class init contract, the cost of `<clinit>` per class, and the patterns that defer expensive work to first use.

---

## 1. Class initialization is once, lazy, thread-safe

The JVM guarantees:
- A class is initialized at most once.
- Initialization is triggered by certain events (new, static read/write, etc.).
- Concurrent threads triggering initialization synchronize via a per-class lock; only one thread runs `<clinit>`.
- Other threads wait until initialization completes (or fails).

This makes static initializer blocks naturally thread-safe. Singletons via static blocks "just work."

---

## 2. Class init cost

Each class's `<clinit>` runs once. The cost depends on what's in it:
- Simple field assignments: nanoseconds.
- Complex setup (load file, parse JSON, register with a framework): milliseconds.
- Worst case: I/O failures, infinite loops.

For a typical app, total class init time is a significant fraction of startup time. Tools like AppCDS, native-image (GraalVM), and lazy class loading optimize this.

---

## 3. Lazy holder idiom

Defer expensive init via a nested class:

```java
public class Heavy {
    private Heavy() { /* expensive */ }

    private static class Holder {
        static final Heavy INSTANCE = new Heavy();
    }

    public static Heavy get() { return Holder.INSTANCE; }
}
```

`Heavy` is loaded but not initialized at startup. `Holder` is loaded only when `Heavy.get()` is called. The class init lock provides thread safety.

This is the preferred pattern for lazy singletons in modern Java.

---

## 4. Static block alternatives

Replace static blocks with:

| Use case                    | Modern alternative                       |
|-----------------------------|------------------------------------------|
| Building a Map               | `Map.of(...)` or `Map.entry(...) + Map.ofEntries(...)` |
| Building a List              | `List.of(...)`                           |
| Loading a file               | Lazy: read on first call                 |
| Native library load          | Still need static block (`System.loadLibrary`) |
| Singleton                    | Lazy holder idiom                        |

Static blocks are still useful for native libraries, complex init that depends on environment, and fail-fast checks.

---

## 5. Static block exception handling

```java
static {
    try {
        Files.readString(Paths.get("config.txt"));
    } catch (IOException e) {
        throw new ExceptionInInitializerError(e);
    }
}
```

If the static block throws (checked or unchecked), the class becomes erroneous. Subsequent uses fail with `NoClassDefFoundError`. The first failure shows `ExceptionInInitializerError` with the cause; later failures don't.

Production lesson: failed init can be hard to diagnose if you only see the second failure. Log the first error.

---

## 6. Initializer blocks in records

Records cannot have instance initializer blocks. The compact constructor handles this role:

```java
public record User(String name, int age) {
    public User {
        // validation here
    }
}
```

Records can have static initializer blocks for static fields, like any class.

---

## 7. Initializer blocks in enums

Enums can have static blocks. Useful when the static initialization depends on the constants:

```java
public enum Currency {
    USD, EUR, GBP;
    static final Map<String, Currency> BY_CODE;
    static {
        BY_CODE = Arrays.stream(values()).collect(Collectors.toMap(Enum::name, c -> c));
    }
}
```

Enums also have instance initializer blocks (rarely used).

---

## 8. Cost of poorly designed static init

A real production hazard: a class's `<clinit>` does:
- Database connection
- Network call to fetch config
- File system scan

If any of these fail at deployment (DB unreachable, file missing), the class fails to initialize. Every subsequent use fails. Service can't start.

Fix: defer to lazy init. Fail at first actual use, not at class load. This makes the failure mode clearer and easier to recover.

---

## 9. Static blocks and tests

Tests often load classes in unusual orders. If `Foo`'s static block depends on `Bar` being already loaded (or a system property being set), the test order matters.

Best practice: avoid cross-class static dependencies. Each class should initialize independently.

---

## 10. Static blocks and reflection

`Class.forName("X")` triggers class init by default. `Class.forName("X", false, classLoader)` doesn't.

If you want to inspect a class without initializing it:
```java
Class<?> clazz = Class.forName("X", false, getClassLoader());
```

Useful for tools (debuggers, code analyzers, frameworks scanning classes).

---

## 11. Initializer blocks and JIT

The JIT compiles `<clinit>` and `<init>` like any other methods. There's no special path for init. Optimizations:
- Field initializers are inlined into all `<init>` methods (per JIT inlining).
- Static blocks can be optimized after warmup.
- `<clinit>` is rarely hot, so JIT doesn't aggressively compile it.

---

## 12. Initialization of generic classes

Generics are erased; `List<String>.class` is `List.class`. Static blocks of `List<T>` (if `List` were a generic class with a static block) would run once per class, not per type parameter.

This is fine in practice; you rarely have static state in generic classes.

---

## 13. Static block design checklist

- [ ] Is the work necessary at class load, or can it be deferred?
- [ ] What happens if it fails? Is the error message clear?
- [ ] Does it depend on external state (file, env var, network)?
- [ ] Could lazy holder idiom replace it?
- [ ] Could `Map.of(...)` / `List.of(...)` replace it?
- [ ] Is testing easy with this init?

If most answers point to "could be deferred or replaced," consider doing so.

---

## 14. Initialization of concurrent collections

Common pattern in static blocks:

```java
private static final ConcurrentMap<String, X> CACHE = new ConcurrentHashMap<>();
static {
    // populate
}
```

Or the equivalent without a block:
```java
private static final ConcurrentMap<String, X> CACHE = buildCache();
```

Where `buildCache()` is a static method. Cleaner, more testable.

---

## 15. What's next

| Topic                         | File              |
|-------------------------------|-------------------|
| Bytecode of init blocks        | `professional.md`  |
| JLS initialization rules       | `specification.md` |
| Interview prep                 | `interview.md`     |
| Common bugs                    | `find-bug.md`      |

---

**Memorize this**: static blocks run once per class load, thread-safe by JVM contract. Use them for unavoidable init (native libs, complex computed state). Prefer lazy alternatives for expensive or fail-prone work. Modern factories (`Map.of`, `List.of`) replace many old static block uses. Failed static init poisons the class for the JVM's lifetime.
