# Attributes and Methods — Optimize the Code

> 12 exercises: each one a slow piece of code, the diagnosis, and a measurably better rewrite. Numbers are illustrative — confirm in your environment with JMH and JFR.

---

## Optimization 1 — Remove unnecessary getter call in a hot loop

**Slow:**

```java
for (int i = 0; i < list.size(); i++) {                // size() called each iteration
    process(list.get(i));
}
```

`ArrayList.size()` is a field read — but the JIT can't always hoist it out, especially if the list type is interface-typed (`List<T>`) and the call site is megamorphic.

**Better:**

```java
final int n = list.size();
for (int i = 0; i < n; i++) {
    process(list.get(i));
}
```

Or just use the enhanced for loop (which the JIT optimizes well):

```java
for (T item : list) process(item);
```

**Why.** A monomorphic hot call site usually inlines fine. But interface-typed loops in mixed-implementation codebases stay polymorphic. Hoisting the size manually is a guaranteed win that costs nothing in readability.

---

## Optimization 2 — Avoid autoboxing in arithmetic loops

**Slow:**

```java
Long sum = 0L;
for (Long x : longList) sum += x;     // boxing on every iteration
```

Each `sum += x` unboxes both operands, adds, and *boxes* the result back into a fresh `Long` (16 B + alignment). For a million-element list, that's 16+ MB of garbage and a million heap allocations.

**Better:**

```java
long sum = 0L;
for (Long x : longList) sum += x;     // unboxes x once, no result boxing
```

Even better — drop the `List<Long>` for `long[]` or `LongStream` if the data structure can change.

**Why.** `Long sum` is a reference; `sum += x` is `sum = Long.valueOf(sum.longValue() + x.longValue())`. `long sum` is a primitive; the JIT generates two integer adds.

---

## Optimization 3 — Cache `String.length()` in a hot regex-like loop

**Slow:**

```java
for (int i = 0; i < s.length(); i++) {       // length() may not be hoisted
    if (s.charAt(i) == '.') return i;
}
```

`String.length()` is a field read; HotSpot's intrinsic for it usually inlines. But on cold paths or under interpretation, every call still goes through method dispatch.

**Better:**

```java
final int n = s.length();
for (int i = 0; i < n; i++) {
    if (s.charAt(i) == '.') return i;
}
```

Or, if you really want speed: `s.indexOf('.')` — uses an intrinsic vectorized scan.

**Why.** Consistent: hoist invariants out of loop conditions explicitly. The JIT may optimize, but you don't have to depend on it.

---

## Optimization 4 — Stop boxing primitives in `Map` keys

**Slow:**

```java
Map<Integer, Order> ordersById = new HashMap<>();
ordersById.put(1234, order);              // box int → Integer
ordersById.get(1234);                      // box again
```

Each put/get autoboxes the int. With 100k operations, you allocate 100k transient `Integer` objects (or hit the cached range, but that's only `-128..127`).

**Better — primitive map (Eclipse Collections or fastutil):**

```java
import org.eclipse.collections.impl.map.mutable.primitive.IntObjectHashMap;

IntObjectHashMap<Order> ordersById = new IntObjectHashMap<>();
ordersById.put(1234, order);              // no boxing
```

Throughput improvement on million-key benchmarks: typically 2–3×, plus dramatic reduction in GC pressure.

---

## Optimization 5 — Make small leaf methods `final` for inlining

**Slow:**

```java
public class Discount {
    public double rate() { return 0.1; }   // virtual; subclasses might override
}

public double apply(double price) {
    return price * (1 - rate());
}
```

If `Discount` has multiple subclasses loaded, `rate()` becomes polymorphic at this call site, preventing direct inlining.

**Better:**

```java
public class Discount {
    public final double rate() { return 0.1; }    // can't be overridden; JIT inlines freely
}
```

Or mark the class `final` if there's no subclass.

**Why.** `final` removes Class Hierarchy Analysis dependency tracking. The JIT can inline without installing a "if a new subclass loads, recompile" hook. Marginal gain individually; meaningful in tight loops.

---

## Optimization 6 — Replace string-indexed lookup with enum

**Slow:**

```java
private final Map<String, Handler> handlers = new HashMap<>();

handlers.put("start", new StartHandler());
handlers.put("stop",  new StopHandler());

public void handle(String command) {
    handlers.get(command).run();
}
```

String hashing + map lookup + handler dispatch. ~30 ns per call.

**Better:**

```java
public enum Command {
    START { @Override void run() { ... } },
    STOP  { @Override void run() { ... } };

    abstract void run();
}

public void handle(Command c) { c.run(); }
```

Now the call is a polymorphic invocation on a fixed-arity enum — the JIT often produces a tableswitch and inlines branches.

**Why.** Enums dispatch via direct `invokevirtual`. The lookup phase is gone entirely. ~5 ns per call. Plus exhaustiveness — the compiler tells you when you forget a new enum constant.

---

## Optimization 7 — Replace boxed `Optional<Integer>` field

**Slow:**

```java
public class Counter {
    private Optional<Integer> latest = Optional.empty();
    public Optional<Integer> latest()        { return latest; }
    public void setLatest(int v)             { latest = Optional.of(v); }
}
```

Every `setLatest` allocates an `Optional` (16 B header + 4 B reference + padding) and an `Integer` (16 B + 4 B + padding). Two allocations per call.

**Better:**

```java
public class Counter {
    private static final int UNSET = Integer.MIN_VALUE;
    private int latest = UNSET;

    public OptionalInt latest()      { return latest == UNSET ? OptionalInt.empty() : OptionalInt.of(latest); }
    public void setLatest(int v)      { latest = v; }
}
```

The field is a primitive — no allocation per write. The getter returns a (often scalar-replaced) `OptionalInt`.

**Why.** `Optional` as a *field* costs you one allocation per state transition. As a *return value*, the JIT often scalar-replaces it. Use `Optional` at the API boundary, not inside.

---

## Optimization 8 — Memoize an expensive `hashCode` in a value object

**Slow:**

```java
public final class CompoundKey {
    private final String a, b, c;
    @Override public int hashCode() {
        return Objects.hash(a, b, c);                 // boxes everything + array allocation
    }
}
```

In a `HashMap` with millions of operations, this is dominated by `hashCode`.

**Better:**

```java
public final class CompoundKey {
    private final String a, b, c;
    private final int hash;
    public CompoundKey(String a, String b, String c) {
        this.a = a; this.b = b; this.c = c;
        int h = a.hashCode();
        h = 31 * h + b.hashCode();
        h = 31 * h + c.hashCode();
        this.hash = h;
    }
    @Override public int hashCode() { return hash; }
}
```

Hash is computed once, in the constructor, no boxing, no varargs allocation. Subsequent calls are field reads.

**Why.** Two wins — eliminate the boxing/varargs allocation in `Objects.hash`, and avoid recomputing for the same immutable object.

---

## Optimization 9 — Stop allocating in defensive copies when the input is already immutable

**Slow:**

```java
public Order(List<OrderLine> lines) {
    this.lines = new ArrayList<>(lines);     // always copies, even if input is List.of(...)
}
```

If the caller passes an immutable list, you've allocated unnecessarily.

**Better:**

```java
public Order(List<OrderLine> lines) {
    this.lines = List.copyOf(lines);         // copies if mutable; reuses if already immutable
}
```

`List.copyOf` checks the input's class; if already an unmodifiable `List` from `List.of`/`copyOf`/etc., it returns the input as-is.

**Why.** Avoids redundant allocation in the common case. `List.copyOf` is the Java 10+ canonical defensive copy. Use it.

---

## Optimization 10 — Hot-path `synchronized` to `VarHandle` CAS

**Slow:**

```java
public class Counter {
    private long count;
    public synchronized void increment() { count++; }
    public synchronized long get()       { return count; }
}
```

Each increment is a CAS-on-mark-word + the actual increment. Under contention, the lock inflates and increments cost ~100+ ns each.

**Better:**

```java
public class Counter {
    private static final VarHandle COUNT;
    static {
        try { COUNT = MethodHandles.lookup().findVarHandle(Counter.class, "count", long.class); }
        catch (ReflectiveOperationException e) { throw new ExceptionInInitializerError(e); }
    }

    private volatile long count;
    public void increment() { COUNT.getAndAdd(this, 1L); }
    public long get()       { return count; }
}
```

`getAndAdd` becomes a single `LOCK XADD` on x86 — atomic, lock-free, ~5–10 ns even under heavy contention.

**Why.** `synchronized` on a single-counter class is overkill. CAS is the natural primitive for atomic counters. Effectively the same as `LongAdder` for this case (and `LongAdder` is even faster under heavy contention via per-thread cells).

---

## Optimization 11 — Remove unused fields after refactoring

**Slow:**

```java
public class Order {
    private final long id;
    private final long createdAt;
    private final long modifiedAt;
    private final long shippedAt;          // never read after a refactor
    private final long deliveredAt;        // never read either
    private final long cancelledAt;        // ditto
    // 12 more fields...
}
```

Object size grows as fields accumulate. JOL output shows 100+ B per `Order`. Multiplied by millions, GC pressure rises and cache locality drops.

**Better.** Run an unused-field analyzer (IntelliJ "Unused declaration", SpotBugs `URF`, Error Prone `UnusedVariable`). Delete what's unread. For data fields needed only in some scenarios, consider extracting them to a separate "details" object loaded on demand.

**Why.** The biggest win in object-size optimization is usually not "pack better" but "stop carrying unused data." A field that nobody reads is pure overhead — heap memory, GC scan time, serializer work.

---

## Optimization 12 — Right-size collection capacity

**Slow:**

```java
List<User> users = new ArrayList<>();         // default capacity 10
for (int i = 0; i < 100_000; i++) users.add(new User());
```

`ArrayList` grows by ~50% (newCapacity = oldCapacity + (oldCapacity >> 1)). For 100k elements, ~17 reallocations + array copies. The total work is `O(n)` but the constant factor is high — and large arrays go to old generation.

**Better:**

```java
List<User> users = new ArrayList<>(100_000);
for (int i = 0; i < 100_000; i++) users.add(new User());
```

Same for `HashMap`:

```java
Map<K,V> m = HashMap.newHashMap(expectedSize);   // Java 19+
// or pre-19:
Map<K,V> m = new HashMap<>((int)(expectedSize / 0.75f) + 1);
```

**Why.** Avoids reallocating and rehashing. For known-size loads, this is the cheapest performance win in your toolkit.

---

## Methodology recap

For every change above:

1. **Profile.** Don't guess. `async-profiler -e cpu` for CPU; `-e alloc` for allocation. The top 5–10% by samples is where to focus.
2. **Benchmark with JMH.** `@State`, `@Warmup`, `@Measurement`, `Blackhole.consume(...)`. Trust the relative numbers, not the absolute ones.
3. **Measure allocation.** `-prof gc` in JMH reports `alloc.rate.norm` (bytes per op). The real win is often there, not in CPU time.
4. **Confirm with the JIT.** `-XX:+PrintInlining`, `-XX:+PrintEliminateAllocations`, `-XX:+PrintAssembly` (with hsdis). The 5% you can't profile away usually shows up here.
5. **Test invariants didn't change.** A faster method that breaks the contract is a corrupted dataset waiting to happen.

The dominant performance lever at the field-and-method level is **fewer allocations**, followed by **smaller working sets**, then **better dispatch behavior** (mono-/poly-morphic call sites). Tweaking individual lines after these is rarely worth your time.
