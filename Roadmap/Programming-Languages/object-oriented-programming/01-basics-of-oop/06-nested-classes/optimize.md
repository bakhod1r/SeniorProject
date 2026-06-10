# Nested Classes — Optimize the Code

> 12 exercises showing how nested-class choices affect performance and correctness. Numbers illustrative — confirm with JMH.

---

## Optimization 1 — Replace anonymous class with lambda

**Slow:**

```java
list.forEach(new Consumer<>() {
    @Override public void accept(String s) {
        System.out.println(s);
    }
});
```

Allocates a Consumer per call site, captures enclosing `this`.

**Better:**

```java
list.forEach(s -> System.out.println(s));
list.forEach(System.out::println);
```

The JIT often scalar-replaces the lambda's capture object — zero allocation per use.

**Why.** Lambdas use `invokedynamic` + `LambdaMetafactory`; the JIT can inline and eliminate allocation. Anonymous classes always allocate.

---

## Optimization 2 — Add `static` to memory-leaking inner

**Slow:**

```java
public class Window {
    private final byte[] heavyData = new byte[10_000_000];
    public class RefreshTask implements Runnable {
        public void run() { /* does not use Window state */ }
    }
}
```

Each `RefreshTask` retains a reference to the 10 MB `Window`.

**Better:**

```java
public static class RefreshTask implements Runnable {
    public void run() { /* explicit state if needed, no implicit Window */ }
}
```

**Why.** Removes the `this$0` retention. A long-lived `RefreshTask` no longer pins the `Window` for GC.

---

## Optimization 3 — Lazy holder for class init optimization

**Slow:**

```java
public class Service {
    private static final ExpensiveResource RESOURCE = new ExpensiveResource();

    public static void doWork() { RESOURCE.use(); }
    public static int unrelated() { return 42; }
}

Service.unrelated();        // initializes RESOURCE even though we didn't need it
```

**Better:**

```java
public class Service {
    private static class Holder { static final ExpensiveResource RESOURCE = new ExpensiveResource(); }

    public static void doWork() { Holder.RESOURCE.use(); }
    public static int unrelated() { return 42; }
}
```

`Holder` initializes only when `RESOURCE` is first accessed.

**Why.** Lazy init avoids the cost when the resource isn't needed. Plus thread-safe by JVM class-init lock; no explicit synchronization.

---

## Optimization 4 — Sealed + pattern matching over instanceof chain

**Slow:**

```java
public Object handle(Event e) {
    if (e instanceof Login)  return handleLogin((Login) e);
    if (e instanceof Logout) return handleLogout((Logout) e);
    if (e instanceof Error)  return handleError((Error) e);
    throw new IllegalStateException();
}
```

**Better:**

```java
public sealed interface Event permits Event.Login, Event.Logout, Event.Error {
    record Login(String user) implements Event {}
    record Logout(String user) implements Event {}
    record Error(String msg) implements Event {}
}

public Object handle(Event e) {
    return switch (e) {
        case Login l   -> handleLogin(l);
        case Logout l  -> handleLogout(l);
        case Error err -> handleError(err);
    };
}
```

**Why.** Pattern matching `switch` is slightly faster (single dispatch) and the compiler enforces exhaustiveness.

---

## Optimization 5 — Static factory caching

**Slow:**

```java
public final class Money {
    public static final Money zero(Currency c) {
        return new Money(0, c);                // allocates each call
    }
}
```

**Better:**

```java
public final class Money {
    public static final Money ZERO_USD = new Money(0, Currency.getInstance("USD"));
    public static final Money ZERO_EUR = new Money(0, Currency.getInstance("EUR"));

    public static Money zero(Currency c) {
        if (c.getCurrencyCode().equals("USD")) return ZERO_USD;
        if (c.getCurrencyCode().equals("EUR")) return ZERO_EUR;
        return new Money(0, c);
    }
}
```

**Why.** Common `zero()` calls return a cached instance — no allocation. Same pattern as `Optional.empty()`, `Boolean.valueOf(true)`.

---

## Optimization 6 — Records for value-shaped nested types

**Slow (in maintenance):**

```java
public class Order {
    public static final class Line {
        private final String sku;
        private final int qty;
        public Line(String sku, int qty) { this.sku = sku; this.qty = qty; }
        public String sku() { return sku; }
        public int qty() { return qty; }
        @Override public boolean equals(Object o) { ... }
        @Override public int hashCode() { ... }
        @Override public String toString() { ... }
    }
}
```

**Better:**

```java
public class Order {
    public record Line(String sku, int qty) {}
}
```

15 lines → 1 line. Records get auto `equals`/`hashCode`/`toString` via `invokedynamic` (JIT-friendly).

**Why.** Less code to maintain, fewer chances for bugs in equals/hashCode, JIT-friendlier dispatch.

---

## Optimization 7 — Avoid double-brace initialization

**Slow:**

```java
List<String> list = new ArrayList<>() {{
    add("a");
    add("b");
    add("c");
}};
```

This is "double-brace initialization" — outer `{}` is an anonymous subclass; inner `{ ... }` is an instance initializer.

Problems:
- Creates an anonymous subclass. Adds metaspace pressure.
- Holds a reference to the enclosing instance.
- Not equal to a plain `ArrayList` for `equals`-on-class checks.

**Better:**

```java
List<String> list = new ArrayList<>(List.of("a", "b", "c"));
// or:
List<String> list = List.of("a", "b", "c");      // immutable
```

**Why.** Avoids anonymous subclass, no enclosing capture, idiomatic.

---

## Optimization 8 — Lambda over anonymous inner for stream operations

**Slow:**

```java
list.stream().filter(new Predicate<String>() {
    public boolean test(String s) { return s.length() > 5; }
}).count();
```

**Better:**

```java
list.stream().filter(s -> s.length() > 5).count();
```

**Why.** The lambda compiles to a method on the enclosing class plus a tiny `invokedynamic` call site. The JIT inlines the predicate body into the stream pipeline.

---

## Optimization 9 — Nested class for test fixtures

**Slow (in test maintenance):**

```java
@Test
void test1() {
    Order o = new Order();
    o.setX(...);
    o.setY(...);
    o.setZ(...);
    // ... 20 lines of setup
}

@Test
void test2() {
    Order o = new Order();
    // ... same 20 lines
}
```

**Better:**

```java
class OrderFixtures {
    static Order standard() {
        return Order.builder().x(...).y(...).z(...).build();
    }
}

@Test
void test1() { Order o = OrderFixtures.standard(); ... }
@Test
void test2() { Order o = OrderFixtures.standard(); ... }
```

If `OrderFixtures` is only used by `OrderTest`, declare it as a `private static class` inside `OrderTest`.

**Why.** Less duplication, one place to update. Nested static class keeps the fixture scoped.

---

## Optimization 10 — Use static for serialization-friendly nested types

**Slow:**

```java
public class Order {
    public class Line {        // non-static inner
        public String sku;
        public int qty;
    }
}

// Jackson tries to serialize the outer Order along with each Line
```

**Better:**

```java
public class Order {
    public static class Line {  // static nested
        public String sku;
        public int qty;
    }
}
```

**Why.** Jackson and similar serializers handle static nested cleanly. Non-static inner causes implicit-outer-reference issues.

---

## Optimization 11 — Avoid synchronized lazy init in favor of holder

**Slow:**

```java
public class Service {
    private static volatile ExpensiveResource resource;

    public static ExpensiveResource get() {
        ExpensiveResource r = resource;
        if (r == null) {
            synchronized (Service.class) {
                r = resource;
                if (r == null) {
                    r = resource = new ExpensiveResource();
                }
            }
        }
        return r;
    }
}
```

Double-checked locking; verbose; needs `volatile`.

**Better:**

```java
public class Service {
    private static class Holder { static final ExpensiveResource RESOURCE = new ExpensiveResource(); }
    public static ExpensiveResource get() { return Holder.RESOURCE; }
}
```

**Why.** The JVM's class-init lock provides thread-safe lazy init. No `volatile`, no double-check, no `synchronized`. Cleaner and equivalent in performance.

---

## Optimization 12 — Use top-level interface + static factory

**Slow:**

```java
public class PaymentService {
    public PaymentResult pay(...) { ... }
}

// usage: new PaymentService(...).pay(...);
```

**Better:**

```java
public interface PaymentService {
    PaymentResult pay(...);

    static PaymentService create(TaxClient tax, TransactionLog log) {
        return new DefaultPaymentService(tax, log);
    }
}

final class DefaultPaymentService implements PaymentService { ... }      // package-private impl
```

**Why.** Users see the interface; the implementation is hidden. The static factory on the interface is a clean entry point. Refactoring the implementation doesn't break callers.

---

## Methodology recap

For every change:

1. **Profile.** `async-profiler -e alloc` for allocation hotspots; JFR for retention.
2. **Confirm with JIT.** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations` to see lambda scalar replacement.
3. **Heap dump.** Check for `this$0` retention from anonymous classes.
4. **Measure JMH.** Lambda vs anonymous for hot paths.

The biggest wins from nested-class discipline are *qualitative*: cleaner code, no leaks, easier maintenance. Per-call performance gains are real but secondary to architectural clarity.
