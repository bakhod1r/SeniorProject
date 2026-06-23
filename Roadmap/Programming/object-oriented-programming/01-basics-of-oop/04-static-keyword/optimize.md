# Static Keyword — Optimize the Code

> 12 exercises around `static` performance and correctness. Each shows the slow/wrong version, the diagnosis, and a measurably better rewrite.

---

## Optimization 1 — Inline simple static getters via `static final`

**Slow:**

```java
public class Config {
    public static int max() { return 100; }
}

if (count > Config.max()) ...           // method call every check
```

**Better:**

```java
public class Config {
    public static final int MAX = 100;
}

if (count > Config.MAX) ...             // inlined as literal 100 by javac
```

**Why.** Compile-time constant inlining eliminates the method call entirely — the consumer's bytecode contains the literal. JIT couldn't get any better than "no call at all."

Caveat: cross-jar inlining is permanent until consumer recompiles. For values that may change between releases, accept the method call.

---

## Optimization 2 — Cache common factory results

**Slow:**

```java
public static Money zero(Currency c) {
    return new Money(0, c);              // allocates each call
}
```

**Better:**

```java
private static final Map<Currency, Money> ZEROES = ...;
public static Money zero(Currency c) {
    return ZEROES.computeIfAbsent(c, k -> new Money(0, k));
}
```

Or for a small fixed set:

```java
public static final Money ZERO_USD = new Money(0, USD);
public static final Money ZERO_EUR = new Money(0, EUR);
public static Money zero(Currency c) {
    return c.equals(USD) ? ZERO_USD : c.equals(EUR) ? ZERO_EUR : new Money(0, c);
}
```

**Why.** `Optional.empty()`, `Boolean.valueOf(true)`, `Integer.valueOf(42)` all use this pattern. Frequent factory calls return a cached instance — zero allocation, faster.

---

## Optimization 3 — Use `static` final method handles for hot reflection

**Slow:**

```java
public Object invoke(String methodName, Object obj) throws Exception {
    Method m = obj.getClass().getDeclaredMethod(methodName);   // lookup every call
    return m.invoke(obj);
}
```

**Better:**

```java
private static final ConcurrentMap<String, MethodHandle> HANDLES = new ConcurrentHashMap<>();

public Object invoke(String methodName, Object obj) throws Throwable {
    MethodHandle mh = HANDLES.computeIfAbsent(methodName, n -> {
        try {
            return MethodHandles.lookup().findVirtual(obj.getClass(), n, MethodType.methodType(Object.class));
        } catch (Exception e) { throw new RuntimeException(e); }
    });
    return mh.invoke(obj);
}
```

**Why.** `Class.getDeclaredMethod` is microseconds per call. `MethodHandle.invoke` is nanoseconds after warmup. Cache the handle in a static map; the hot path is one map lookup + direct call.

---

## Optimization 4 — Lazy holder for expensive singletons

**Slow:**

```java
public class Service {
    private static final Service INSTANCE = new Service();    // allocates at class load
    private Service() { /* connects to remote, parses 100MB config */ }
    public static Service get() { return INSTANCE; }
}
```

The expensive work runs the moment any code touches `Service` — even a `Service.class` literal access (well, almost — see specification.md). For batch jobs that don't need the service, you've paid for nothing.

**Better:**

```java
public class Service {
    private Service() { /* expensive */ }
    private static class Holder { static final Service INSTANCE = new Service(); }
    public static Service get() { return Holder.INSTANCE; }
}
```

**Why.** `Holder` is initialized only when `get()` is first called. Code paths that don't need `Service` skip the initialization entirely.

---

## Optimization 5 — Replace static `synchronized` with finer locking

**Slow:**

```java
public class Cache {
    private static final Map<String, Object> data = new HashMap<>();
    public static synchronized Object get(String k) { return data.get(k); }
    public static synchronized void put(String k, Object v) { data.put(k, v); }
}
```

Every static synchronized method on `Cache` shares the same lock — `Cache.class`. High contention.

**Better:**

```java
private static final Map<String, Object> data = new ConcurrentHashMap<>();
public static Object get(String k) { return data.get(k); }
public static void put(String k, Object v) { data.put(k, v); }
```

`ConcurrentHashMap` uses internal partitioning; concurrent reads and writes from different threads don't block each other.

**Why.** Coarse `synchronized` is a single bottleneck. Concurrent collections scale horizontally with thread count.

---

## Optimization 6 — Avoid static state for testability

**Slow (process-wise):**

```java
public class OrderService {
    public static void place(Order o) {
        Validator.validate(o);            // hidden static dependency
        OrderRepository.save(o);           // another
        EmailSender.notify(o);             // another
    }
}
```

Tests for `place` need either real implementations or static mocking (Mockito 3.4+, PowerMock). Slow, fragile, awkward.

**Better:**

```java
public class OrderService {
    private final Validator validator;
    private final OrderRepository repo;
    private final EmailSender sender;

    public OrderService(Validator v, OrderRepository r, EmailSender s) { ... }

    public void place(Order o) {
        validator.validate(o);
        repo.save(o);
        sender.notify(o);
    }
}
```

**Why.** "Performance" here is measured in test cycle time and developer hours. Refactoring static dependencies into injected ones makes tests faster, more isolated, and substantially easier to maintain.

---

## Optimization 7 — Use `static` factory methods to enable specialization

**Slow:**

```java
public class List {
    public List(int initialCapacity) { ... }
}

new List(10);              // always allocates a 10-slot ArrayList
new List(0);               // wasteful if you'll never add
```

**Better:**

```java
public interface List<E> {
    static <E> List<E> of()                 { return Collections.emptyList(); }
    static <E> List<E> of(E e1)              { return new SingletonList<>(e1); }
    static <E> List<E> of(E e1, E e2)        { return new Pair<>(e1, e2); }
    static <E> List<E> of(E... es)           { return new ArrayList<>(es); }
}
```

`List.of()` returns the global empty-list singleton. `List.of(e1)` returns a tight, allocation-light singleton implementation. The factory specializes by argument count.

**Why.** Static factories return *the most efficient* implementation for the given inputs. The user never sees the underlying type; you can change implementations freely.

---

## Optimization 8 — Use `static final` arrays carefully

**Slow:**

```java
public static final int[] PRIMES = {2, 3, 5, 7, 11};

public boolean isPrime(int n) {
    for (int p : PRIMES) if (n == p) return true;
    return false;
}
```

The array is shared, but **mutable** — any caller can write `Constants.PRIMES[0] = -1` and break everyone.

**Better:**

```java
private static final int[] PRIMES_INTERNAL = {2, 3, 5, 7, 11};
public static List<Integer> primes() { return List.of(2, 3, 5, 7, 11); }
```

Or, since arrays of primitives are cheap and bounded:

```java
private static final int[] PRIMES_INTERNAL = {2, 3, 5, 7, 11};
public static int prime(int i) { return PRIMES_INTERNAL[i]; }
```

**Why.** `static final` does not make the array immutable. Expose immutable views (`List.of`, custom getter) instead of the raw array.

---

## Optimization 9 — Class-init time matters for startup

**Slow:**

```java
public class Catalog {
    private static final Map<String, Item> ALL = loadAll();   // reads 1GB file

    private static Map<String, Item> loadAll() {
        // 5 seconds of I/O
    }
}
```

Application startup blocks for 5 seconds the moment anyone touches `Catalog`.

**Better:**

```java
public class Catalog {
    private static volatile Map<String, Item> all;

    public static Map<String, Item> all() {
        Map<String, Item> result = all;
        if (result == null) {
            synchronized (Catalog.class) {
                result = all;
                if (result == null) {
                    all = result = loadAll();
                }
            }
        }
        return result;
    }
}
```

Or use the lazy holder idiom (cleaner; same effect).

**Why.** `<clinit>` runs synchronously on first class use, blocking the triggering thread. Defer expensive work to first call instead.

---

## Optimization 10 — Use `enum` for closed sets

**Slow:**

```java
public class Status {
    public static final int ACTIVE = 1;
    public static final int INACTIVE = 2;
    public static final int PENDING = 3;
}

public Status getStatus(int code) { ... }
```

Type-unsafe; wrong-int silently passes through; no exhaustiveness checking on `switch`.

**Better:**

```java
public enum Status { ACTIVE, INACTIVE, PENDING; }

switch (status) {
    case ACTIVE   -> ...;
    case INACTIVE -> ...;
    case PENDING  -> ...;
    // compiler enforces exhaustiveness
}
```

**Why.** `enum` provides type safety, exhaustiveness checking (with `switch`), serialization safety, and a convenient `values()` static method. `int` constants are 1990s Java.

---

## Optimization 11 — Profile-guided removal of static calls in hot paths

**Slow:**

```java
public int hash(String s) {
    return Hash.hash(s);                 // static call — many hops?
}

public class Hash {
    public static int hash(String s) {
        return s.hashCode() ^ MagicConstants.SEED;
    }
}
```

If `Hash.hash` and `MagicConstants.SEED` are in different classes, the JIT may load several classes before inlining.

**Better:**

For truly hot paths, move the work inline:

```java
public int hash(String s) {
    return s.hashCode() ^ SEED;
}
```

Or mark `Hash.hash` `final` (already enforced for static, but emphasize) and `MagicConstants.SEED` as `static final` primitive (so the JIT inlines).

**Why.** The JIT is good at inlining, but each hop costs class-loading and verification overhead at first invocation. Hot paths benefit from minimal hop count.

---

## Optimization 12 — Use `static` factories for diamond elision

**Slow:**

```java
List<Map<String, List<Integer>>> deep = new ArrayList<Map<String, List<Integer>>>();
```

Verbose and unnecessary. Java 7+ allows the diamond, but you may still see verbose code in older codebases.

**Better:**

```java
List<Map<String, List<Integer>>> deep = new ArrayList<>();
```

Or use static factories:

```java
List<Map<String, List<Integer>>> deep = List.of(...);
```

**Why.** Static factories often hide generic types. Less ceremony at the call site; the implementation can choose specialized types (e.g., `Collections.emptyList()` returns a singleton; `List.of()` does too).

---

## Methodology recap

For every change:

1. **Profile first.** `static` performance issues rarely show up directly. They show up as memory leaks (heap dumps), startup delays (JFR ClassLoad events), or threading issues (jstack).
2. **Measure JIT behavior.** `-XX:+PrintInlining` confirms `static` methods inline.
3. **Measure class-init time.** `-Xlog:class+init=info` for slow `<clinit>`.
4. **Measure metaspace.** `jcmd <pid> VM.metaspace` for static-state growth.
5. **Trust DI for testability.** The "performance" of testable code is measured in cycle time.

The biggest performance wins from `static` come from *removing* it where it doesn't belong (mutable global state, hidden dependencies) and *embracing* it where it does (constants, pure factories, lazy holders).
