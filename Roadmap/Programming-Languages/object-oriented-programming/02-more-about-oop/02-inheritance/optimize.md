# Inheritance — Optimization

Twelve before/after patterns where inheritance choices affect runtime performance, JIT effectiveness, or design extensibility.

---

## Optimization 1 — Use `final` for hot dispatch

**Before:**
```java
public class JsonNode {
    public boolean isNumber() { return false; }
    public boolean isText() { return false; }
}
```

Every call site emits `invokevirtual`, which the JIT may or may not devirtualize.

**After:**
```java
public final class JsonNode {           // closed for extension
    public boolean isNumber() { return false; }
}
```

The JIT can immediately devirtualize and inline. Especially valuable for tiny "is-this-type" predicates called millions of times per request.

**Measure:** `-XX:+PrintInlining`; look for `inline (hot)` vs `failed: too big`.

---

## Optimization 2 — Sealed types for closed unions

**Before:** open hierarchy + visitor pattern + manual dispatch tables.

**After:**
```java
sealed interface Json permits JsonNull, JsonBool, JsonNum, JsonStr, JsonArr, JsonObj {}
record JsonNull() implements Json {}
record JsonBool(boolean v) implements Json {}
// ...

double sum(Json j) {
    return switch (j) {
        case JsonNum n -> n.value();
        case JsonArr a -> a.items().stream().mapToDouble(this::sum).sum();
        default -> 0.0;
    };
}
```

The JIT can specialize each case branch. Plus you gain compile-time exhaustiveness.

---

## Optimization 3 — Avoid deep wrappers in hot paths

**Before:** seven-layer decorator chain `LoggingDecorator(MetricsDecorator(CachingDecorator(RetryDecorator(...))))`.

**After:** flatten where possible. Each layer is a virtual call; depth × cost. If the decorator does nothing on the hot path (e.g., logging at TRACE level), check the level inline rather than through a virtual call.

```java
if (LOG.isTraceEnabled()) LOG.trace("...");   // cheap when off
```

---

## Optimization 4 — Make leaf classes `final`

**Before:**
```java
public class CircleShape extends Shape { /* ... */ }
```

**After:**
```java
public final class CircleShape extends Shape { /* ... */ }
```

`final` on the leaf makes its methods automatically devirtualizable wherever the JIT can prove the receiver is `CircleShape`. Combined with sealed parents, this gives full closed-world dispatch.

---

## Optimization 5 — Composition for forwarding

**Before:**
```java
class CountingList<E> extends ArrayList<E> {
    int count;
    @Override public boolean add(E e) { count++; return super.add(e); }
}
```

Subtle bug: `addAll` doesn't necessarily call `add` (depends on implementation), so count may be wrong.

**After:**
```java
class CountingList<E> implements List<E> {
    private final List<E> delegate;
    int count;
    public CountingList(List<E> d) { this.delegate = d; }
    public boolean add(E e) { count++; return delegate.add(e); }
    // ... all other List methods explicitly forwarded
}
```

You control exactly which methods are counted. The JIT can still inline forwarding methods because they're tiny.

---

## Optimization 6 — Avoid bridge methods in hot paths

**Before:**
```java
class Box<T extends Number> {
    T get() { return value; }
}
class IntBox extends Box<Integer> {
    @Override Integer get() { return 42; }
}
```

The compiler generates a bridge `Number get()` that delegates to `Integer get()`. Two virtual calls instead of one if the call site uses the parent type.

**After:**
- Make the parent type `Number get()` directly (no covariance) for hot paths, or
- Always call through the most specific type (`IntBox.get()` not `Box.get()`).

This is a micro-optimization; most code shouldn't bother.

---

## Optimization 7 — Pattern-matching switch over `instanceof` chain

**Before:**
```java
double area(Shape s) {
    if (s instanceof Circle) {
        Circle c = (Circle) s;
        return Math.PI * c.r() * c.r();
    } else if (s instanceof Square) {
        Square sq = (Square) s;
        return sq.s() * sq.s();
    }
    return 0;
}
```

**After:**
```java
double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.s() * sq.s();
        default -> 0;
    };
}
```

The compiler emits a lookupswitch / typeSwitch indy that's faster than chained instanceof and gives exhaustive checking with sealed types.

---

## Optimization 8 — Don't pay for `protected` you don't need

**Before:**
```java
public class Service {
    protected final Map<String, X> cache = new ConcurrentHashMap<>();
}
```

Every subclass can mutate the cache directly, breaking invariants. Plus the field can't be replaced by a different cache impl.

**After:**
```java
public class Service {
    private final Map<String, X> cache = new ConcurrentHashMap<>();
    protected void putInCache(String k, X v) { cache.put(k, v); }
    protected X getFromCache(String k) { return cache.get(k); }
}
```

You control the contract. Bonus: subclasses can't accidentally hold a reference to `cache` after a swap, which could cause leaks.

---

## Optimization 9 — Object layout: parent fields first

The JVM lays out fields parent-first, then subclass. For best cache behavior:

- **Hot fields in the parent** if multiple subclasses share access patterns.
- **Independent subclass-only fields** in the subclass — they don't share cache lines with parent's hot data.

You can hint with `@Contended` (in `jdk.internal.vm.annotation`) to prevent false sharing on heavily-contended fields, but this requires `--add-opens` for normal applications.

---

## Optimization 10 — Reduce vtable pressure with delegation

**Before:** every API call goes through a polymorphic `BackendDriver` interface, even when only one implementation is used.

**After:**
```java
public final class FastService {
    private final PostgresDriver driver;   // concrete, final
    public FastService(PostgresDriver d) { this.driver = d; }
}
```

Direct concrete reference enables aggressive inlining. Use the interface in tests / mocking where you actually need polymorphism.

---

## Optimization 11 — Lazy class loading via leaf packages

**Before:**
```java
public class App {
    private final List<Plugin> plugins = List.of(
        new SlackPlugin(),
        new EmailPlugin(),
        new SmsPlugin()
    );
}
```

Loading `App` triggers loading of all plugins, even unused ones.

**After:**
```java
public class App {
    private List<Plugin> plugins;
    public synchronized void initPlugins(Set<String> enabled) {
        plugins = new ArrayList<>();
        if (enabled.contains("slack")) plugins.add(new SlackPlugin());
        // ...
    }
}
```

Only the enabled plugins are loaded. Saves memory + startup time, especially with `ServiceLoader` for plugin discovery.

---

## Optimization 12 — Replace abstract class with interface + record

**Before:**
```java
public abstract class Money {
    private final long cents;
    private final String currency;
    public Money(long c, String cur) { this.cents = c; this.currency = cur; }
    public long cents() { return cents; }
    public String currency() { return currency; }
    public abstract Money add(Money other);
}
```

Subclasses inherit constructor logic, fields, and override `add`. Boilerplate.

**After:**
```java
public record Money(long cents, String currency) {
    public Money add(Money other) {
        if (!currency.equals(other.currency)) throw new IllegalArgumentException();
        return new Money(cents + other.cents, currency);
    }
}
```

Records are final by default, immutable, with auto-generated equals/hashCode/toString. No subclass needed; no abstract method needed.

---

## When inheritance optimization is worth it

- The hierarchy is on the hot path of a high-throughput service.
- Profiling shows megamorphic dispatch.
- Code is hard to evolve due to deep coupling.
- Inheritance is preventing inlining you need.

## When it isn't

- The hierarchy is in cold code (config loading, startup).
- The hierarchy is small (≤ 3 leaves).
- The JIT already devirtualizes (check PrintInlining).
- Refactoring would break public API contracts.

---

## Tools cheat sheet

| Tool                                          | Purpose                                |
|-----------------------------------------------|----------------------------------------|
| `-XX:+PrintInlining`                          | Inlining decisions                     |
| `-XX:+PrintCompilation`                       | What got JIT'd and when                |
| `-XX:CompileCommand=print,Class.method`       | Disassemble specific method            |
| `async-profiler -e cycles`                    | CPU flame graph including dispatch     |
| `jol-cli`                                     | Object layout inspection               |
| `jdeps` / `jdeprscan`                         | Dependency analysis on hierarchies     |

---

**Memorize this**: Inheritance is fast in modern JITs *when monomorphic*. Break monomorphism with deep hierarchies, broad interfaces, and many implementations. Use `final` and `sealed` to give the JIT closed-world information. Composition costs almost nothing at runtime and far less at evolution time. The fastest hierarchy is the one the JIT can flatten into direct calls.
