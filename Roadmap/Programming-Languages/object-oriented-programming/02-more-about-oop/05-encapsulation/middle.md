# Encapsulation — Middle

> **What?** Beyond getters and setters: invariants, defensive copying, immutability, package-private design, JPMS module boundaries, and the deeper question of *what* to encapsulate vs *what* to expose.
> **How?** By treating encapsulation as a design discipline — every public member is a commitment; every private member is freedom to change.

---

## 1. Invariants drive encapsulation

An *invariant* is a property that always holds for valid instances of a class. Encapsulation exists to protect invariants.

Examples:
- `BankAccount.balance >= 0`
- `Date.day in [1, 31]`, `month in [1, 12]`
- `ConnectionPool.activeConnections <= maxConnections`

If a field is public, the language can't enforce invariants — anyone can break them. Encapsulation is the only mechanism Java offers for runtime invariant enforcement.

---

## 2. The Effective Java rule

Item 16 of *Effective Java*: "In public classes, use accessor methods, not public fields."

Reasoning:
- Public fields commit you to a specific representation forever.
- You can't add validation later.
- You can't change the type.
- You can't compute the value lazily.
- You can't make it thread-safe by adding synchronization.

The exception: package-private classes. If a class is private to its package, you can use public fields freely — refactoring is local.

---

## 3. Defensive copying

If a constructor takes mutable input or a method returns mutable state, copy:

```java
public final class Period {
    private final Date start;
    private final Date end;

    public Period(Date start, Date end) {
        this.start = new Date(start.getTime());   // defensive in
        this.end = new Date(end.getTime());
        if (this.start.after(this.end)) throw new IllegalArgumentException();
    }

    public Date start() { return new Date(start.getTime()); }   // defensive out
    public Date end() { return new Date(end.getTime()); }
}
```

Note: validation happens *after* the copy, since validating the caller's reference and then storing it allows a "TOCTOU" attack — caller mutates between validation and storage.

For modern code, prefer immutable types: `LocalDate`, `Instant`, etc. Then no defensive copying is needed.

---

## 4. Immutability eliminates many encapsulation worries

```java
public final class Point {
    private final double x;
    private final double y;
    public Point(double x, double y) { this.x = x; this.y = y; }
    public double x() { return x; }
    public double y() { return y; }
}
```

- No setters → no mutation
- `final` fields → safe publication across threads
- Accessors are safe — caller can't change what they return

For data, immutability is the simplest encapsulation strategy. Records make it nearly free.

---

## 5. Package-private as a tool

The default access (no modifier) makes a member visible to the same package only. Use it for:

- Helper classes that support a public class but aren't themselves API
- Methods that should be testable but not user-facing (debatable; some prefer fully testing through public API)
- Constants shared across a package

Public is for the *world*. Package-private is for *collaborators*. Treat them differently in evolution.

```
com.example.banking
    BankAccount.java        // public
    AccountValidator.java   // package-private
    InterestCalculator.java // package-private
```

External code uses `BankAccount`. Validators and calculators are implementation details that change freely.

---

## 6. JPMS modules: encapsulation at scale

Java 9+ Modules add a layer above packages:

```java
module com.example.banking {
    exports com.example.banking;
    // not exported: com.example.banking.internal
}
```

Even `public` classes in non-exported packages are invisible outside the module. This is true *strong* encapsulation — the JVM enforces it at runtime.

JPMS is heavyweight; many apps don't use it. But for libraries and platforms, it's the modern way to lock down internals.

---

## 7. The "open" problem

Some languages (Kotlin, Swift) require classes to be marked `open` before subclasses can extend them; Java is the opposite. Effective Java Item 19: "Design and document for inheritance or else prohibit it."

If a class isn't designed for extension, mark it `final`:

```java
public final class StringId { ... }
```

This prevents accidental extension that could break invariants. Records are `final` by default — one of their many wins.

---

## 8. Hiding implementation behind interfaces

```java
public interface UserRepository {
    User findById(long id);
    void save(User u);
}

class JpaUserRepository implements UserRepository { ... }   // package-private
```

Callers depend only on the interface. The implementation is hidden. Combined with DI, callers get an instance without knowing the impl class.

---

## 9. Constructor visibility

```java
public final class Currency {
    private final String code;
    private Currency(String c) { this.code = c; }   // private!

    private static final Map<String, Currency> CACHE = new ConcurrentHashMap<>();

    public static Currency of(String code) {
        return CACHE.computeIfAbsent(code, Currency::new);
    }
}
```

Private constructor + static factory = total control over instantiation. Common patterns:
- **Singleton** — only one instance ever
- **Multiton** — one instance per key (like Currency above)
- **Caching** — return existing instance when possible
- **Validation in factory** — ensures all instances are valid

Static factory methods (Effective Java Item 1) often beat constructors for non-trivial classes.

---

## 10. Read-only views

```java
public class TodoList {
    private final List<String> items = new ArrayList<>();
    public List<String> items() { return Collections.unmodifiableList(items); }
}
```

`unmodifiableList` returns a view: reading goes through to the underlying list, writing throws. The caller can't mutate, but if the underlying list changes (because the owning class mutates it), the view reflects the change.

If you want a snapshot (independent of future mutations), use `List.copyOf(items)`.

---

## 11. Encapsulation in inheritance hierarchies

`protected` is a delicate access modifier. It exposes a member to *all* subclasses, in any package. Once you publish a `protected` member:

- Every subclass can rely on it.
- You can't change its signature without breaking subclasses.
- It's implicitly part of the inheritance contract.

Use `protected` sparingly. Prefer `private` + a `protected` accessor if subclasses genuinely need access:

```java
public abstract class Service {
    private final Logger log;
    protected Service() { this.log = ...; }
    protected final Logger log() { return log; }   // controlled access
}
```

---

## 12. Sealed types narrow encapsulation

```java
sealed interface Shape permits Circle, Square { }
```

Now only `Circle` and `Square` can implement `Shape`. The hierarchy is closed. Combined with private/package-private impl:

```java
public sealed interface Result<T> permits Success, Failure { }
public record Success<T>(T value) implements Result<T> { }
public record Failure<T>(String error) implements Result<T> { }
```

Callers know exactly the variants. They can't add their own (which would violate Result's invariants).

---

## 13. Encapsulation vs flexibility trade-offs

Strict encapsulation makes change easier *for the maintainer* but harder *for callers* who want to do something not anticipated. Real-world choice:

- Library/framework: high encapsulation. Internal flexibility >> caller convenience.
- Application code: medium encapsulation. Less ceremony; refactoring is internal.
- Quick scripts: low encapsulation. Get it done.

Don't apply library-grade encapsulation to a 200-line script.

---

## 14. Encapsulating concurrency

If multiple threads access an object, encapsulate the synchronization:

```java
public class Counter {
    private final AtomicLong count = new AtomicLong();
    public void inc() { count.incrementAndGet(); }
    public long value() { return count.get(); }
}
```

Don't expose `count`. Callers shouldn't have to know there's an `AtomicLong` inside; they shouldn't have to synchronize. The class encapsulates the thread-safety mechanism.

---

## 15. Builder + immutable target

```java
public final class HttpRequest {
    private final String url;
    private final Map<String, String> headers;

    private HttpRequest(Builder b) {
        this.url = b.url;
        this.headers = Map.copyOf(b.headers);
    }
    public static Builder builder(String url) { return new Builder(url); }
    public static class Builder { ... }
}
```

The Builder is the *only* path to construct `HttpRequest`. The constructor is private. The result is fully immutable. Encapsulation by design.

---

## 16. Documenting the contract

A class's encapsulation is only as good as its documented invariants:

```java
/**
 * A {@code Money} value with currency.
 * <p>
 * Invariants:
 * - amount is in cents (long, exact)
 * - currency is a 3-letter ISO 4217 code
 * <p>
 * Money is immutable and thread-safe.
 */
public final class Money { ... }
```

Without this documentation, callers can't know what guarantees they're getting.

---

## 17. What's next

| Topic                                  | File              |
|----------------------------------------|-------------------|
| JIT view, hidden classes, performance  | `senior.md`        |
| Bytecode of access modifiers           | `professional.md`  |
| JLS access rules                       | `specification.md` |
| Encapsulation bug patterns             | `find-bug.md`      |

---

**Memorize this**: encapsulation protects invariants; abstraction separates contract; both shrink the public surface. Defaults: `private`, `final`, immutable. Use records for data. Use sealed types for closed hierarchies. Use builders for complex construction. Use modules for the largest scale.
