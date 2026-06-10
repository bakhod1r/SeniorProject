# Encapsulation — Optimization

Twelve before/after patterns showing how to keep encapsulation strict without paying runtime cost.

---

## Optimization 1 — Records replace getter boilerplate

**Before:** 50 lines of POJO with getters, equals, hashCode, toString.

**After:**
```java
public record User(String name, int age) { }
```

**Why:** less code, immutable, JIT-friendly, automatic correct equals/hashCode.

---

## Optimization 2 — `final` fields enable scalar replacement

**Before:**
```java
public class Point {
    private double x, y;
}
```

**After:**
```java
public final class Point {
    private final double x, y;
}
```

**Why:** `final` fields support escape analysis. C2 can scalarize non-escaping `Point` instances.

---

## Optimization 3 — `List.copyOf` over `Collections.unmodifiableList(new ArrayList<>(src))`

**Before:**
```java
public List<Item> items() {
    return Collections.unmodifiableList(new ArrayList<>(items));
}
```

**After:**
```java
public List<Item> items() { return List.copyOf(items); }
```

**Why:** `List.copyOf` returns the source unchanged if it's already immutable; otherwise creates a single immutable copy. Skips the wrapper layer.

---

## Optimization 4 — Cached static factories

**Before:**
```java
public Currency(String code) { ... }
```

Every call allocates.

**After:**
```java
private Currency(String code) { ... }
public static Currency of(String code) {
    return CACHE.computeIfAbsent(code, Currency::new);
}
```

**Why:** for value-like types with limited cardinality, caching eliminates allocation entirely.

---

## Optimization 5 — Lazy holder over double-checked locking

**Before:**
```java
private static volatile Singleton instance;
public static Singleton get() {
    if (instance == null) {
        synchronized (Singleton.class) {
            if (instance == null) instance = new Singleton();
        }
    }
    return instance;
}
```

**After:**
```java
private static class H { static final Singleton I = new Singleton(); }
public static Singleton get() { return H.I; }
```

**Why:** lazy holder uses class-loading semantics for thread-safety. No `volatile` reads on hot path.

---

## Optimization 6 — `LongAdder` over `AtomicLong` for counters

**Before:**
```java
private final AtomicLong count = new AtomicLong();
public void inc() { count.incrementAndGet(); }
```

**After:**
```java
private final LongAdder count = new LongAdder();
public void inc() { count.increment(); }
public long count() { return count.sum(); }
```

**Why:** `LongAdder` uses striped per-thread cells, scaling much better under heavy contention. The encapsulation hides which counter type is used.

---

## Optimization 7 — `Map.copyOf` for immutable maps

**Before:**
```java
public Map<String, X> snapshot() {
    return Collections.unmodifiableMap(new HashMap<>(internal));
}
```

**After:**
```java
public Map<String, X> snapshot() { return Map.copyOf(internal); }
```

Same benefit as `List.copyOf`.

---

## Optimization 8 — Avoid wrapper allocation in setters

**Before:**
```java
public void setX(int x) { this.x = x; logger.debug("x set to " + x); }
```

The `+ x` boxes the int (sometimes; depending on logger interface) and concatenates a String.

**After:**
```java
public void setX(int x) {
    this.x = x;
    if (logger.isDebugEnabled()) logger.debug("x set to {}", x);
}
```

**Why:** SLF4J-style placeholders skip String concatenation when level is off.

---

## Optimization 9 — `final` class for hot-path inlining

**Before:**
```java
public class Money { ... }
```

**After:**
```java
public final class Money { ... }
```

**Why:** the JIT can fully devirtualize methods on `final` classes. Useful for value types accessed millions of times per second.

---

## Optimization 10 — Module exports as soft contract

JPMS:
```java
module com.example.api {
    exports com.example.api;
}
```

**Why:** the API package is exported; everything else is hidden, even from reflection (without `opens`). Strong encapsulation that the JVM enforces.

---

## Optimization 11 — Private static helpers

**Before:**
```java
public class Calculator {
    public int compute() { /* big method with many helpers inlined */ }
}
```

**After:**
```java
public class Calculator {
    public int compute() { return phaseB(phaseA()); }
    private int phaseA() { ... }
    private int phaseB(int x) { ... }
}
```

**Why:** the JIT inlines private final/static methods readily. Code stays readable; performance is unchanged.

---

## Optimization 12 — Avoid reflection in hot paths

**Before:**
```java
Field f = obj.getClass().getDeclaredField("name");
f.setAccessible(true);
f.get(obj);
```

**After:**
```java
MethodHandle mh = MethodHandles.lookup().findGetter(Foo.class, "name", String.class);
String name = (String) mh.invokeExact((Foo) obj);
```

**Why:** `MethodHandle` lookups can be cached and JIT-inlined; `Field.get` cannot.

For framework code (Spring, Hibernate), reflection is unavoidable; cache the handles.

---

## Tools cheat sheet

| Tool                                          | Purpose                                |
|-----------------------------------------------|----------------------------------------|
| `-XX:+PrintInlining`                          | Inlining decisions                     |
| `jol-cli`                                     | Object layout                          |
| `async-profiler -e alloc`                     | Allocation profile                     |
| `jdeps`                                       | Module dependency analysis             |
| JFR                                           | GC, allocation, JIT                    |
| `jmh`                                         | Microbenchmark                         |

---

## When to apply

- Hot paths where allocation/dispatch is profiled bottleneck
- Frameworks/libraries with strict encapsulation requirements
- Production services where startup time matters (lazy holder, modules)

## When not to

- Cold paths where readability matters more
- Code where the encapsulation choice is already optimal
- Premature optimization based on intuition, not measurement

---

**Memorize this**: encapsulation is free in modern JVMs. The cost is design effort, not runtime. Records, sealed types, modules, and `final` fields are JIT-friendly *and* improve correctness. The few real costs (reflection, volatile, synchronization) are measurable; profile before changing.
