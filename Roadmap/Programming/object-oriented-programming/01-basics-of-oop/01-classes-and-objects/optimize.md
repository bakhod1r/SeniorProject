# Classes and Objects — Optimize the Code

> 12 exercises in making class- and object-level code run faster, allocate less, and play nicely with the JIT and GC. Each shows the slow version, the bottleneck, and a measurably better rewrite. Numbers are illustrative — always confirm in your environment with JMH.

---

## Optimization 1 — Hot-path allocation in `equals`

**Slow:**

```java
public final class Money {
    private final long cents;
    private final String currency;
    @Override public int hashCode() {
        return Objects.hash(cents, currency);     // boxes both args + allocates Object[]
    }
}
```

**Why it's slow.** `Objects.hash` takes `Object...` — it boxes the `long` to `Long` and allocates a varargs `Object[]` on every call. In a hot path (`HashMap.get`, sort, dedup) this is dominant cost.

**Better:**

```java
@Override public int hashCode() {
    int h = Long.hashCode(cents);
    h = 31 * h + currency.hashCode();
    return h;
}
```

No boxing, no array. Roughly 3–5× faster on JMH benchmarks for two-field types.

**Even better.** Use a `record` — `javac` generates exactly this style of `hashCode` automatically.

---

## Optimization 2 — Stop boxing in collections

**Slow:**

```java
List<Integer> ids = new ArrayList<>();
for (int i = 0; i < 1_000_000; i++) ids.add(i);
long sum = 0;
for (Integer id : ids) sum += id;
```

**Why it's slow.** Every `ids.add(i)` boxes an `int` to `Integer` (16 B + alignment). The `ArrayList` holds 1 M references, plus 1 M `Integer` objects. Memory: ~24 MB. Iteration touches 1 M cache lines.

**Better — primitive array:**

```java
int[] ids = new int[1_000_000];
for (int i = 0; i < ids.length; i++) ids[i] = i;
long sum = 0;
for (int id : ids) sum += id;
```

Memory: ~4 MB. Iteration is sequential, branch-predictor friendly, vectorizable. ~5–10× faster.

**Even better — `IntStream` or `eclipse-collections.IntList`:**

```java
long sum = IntStream.range(0, 1_000_000).sum();
```

The JIT vectorizes this to SIMD on modern x86.

---

## Optimization 3 — Replace `Date` with `LocalDate`

**Slow:**

```java
public class Booking {
    private Date checkIn;
    public Date getCheckIn() { return new Date(checkIn.getTime()); }   // defensive copy
}
```

**Why it's slow.** `Date` is mutable; every getter must copy (extra allocation). `Date` is also notoriously inefficient to format and compare; it carries a thread-shared internal calendar.

**Better:**

```java
public final class Booking {
    private final LocalDate checkIn;
    public LocalDate checkIn() { return checkIn; }    // no copy needed — immutable
}
```

Zero defensive copies. Smaller object (LocalDate is ~24 B vs Date's ~40 B + Calendar). Comparison is direct field comparison rather than going through milliseconds + timezone.

---

## Optimization 4 — Cache identity hash on long-lived objects

**Slow (when invoked very frequently):**

```java
public final class Url {
    private final String value;
    @Override public int hashCode() { return value.hashCode(); }   // recomputes each time
}
```

For a `String` of length 50, `hashCode()` is ~50 ALU ops. If your URL appears as a key in a `HashMap` accessed millions of times, that adds up.

**Better — memoize:**

```java
public final class Url {
    private final String value;
    private int cachedHash;        // 0 means "not computed" — String uses the same trick
    @Override public int hashCode() {
        int h = cachedHash;
        if (h == 0 && !value.isEmpty()) {
            h = value.hashCode();
            cachedHash = h;        // benign race — recomputation gives the same answer
        }
        return h;
    }
}
```

After the first call, subsequent calls are a single field read. `String` itself uses this exact pattern.

**Caveat.** Only do this for *immutable* keys, and only if profiling shows `hashCode` is hot. Otherwise the extra field hurts more than it helps (more memory per object).

---

## Optimization 5 — Pre-size collections to avoid rehashing

**Slow:**

```java
Map<UserId, User> map = new HashMap<>();
for (User u : users) map.put(u.id(), u);     // 100k users → ~6 internal resizes
```

**Why it's slow.** Default capacity 16; load factor 0.75. Rehashes at 12, 24, 48, 96, ... For a million entries, ~17 reallocations and full rehashes.

**Better:**

```java
Map<UserId, User> map = new HashMap<>((int)(users.size() / 0.75f) + 1);
```

Or, since Java 19:

```java
Map<UserId, User> map = HashMap.newHashMap(users.size());
```

No rehashing during fill. ~2× faster for million-element loads.

---

## Optimization 6 — Use `EnumMap` / `EnumSet` for enum keys

**Slow:**

```java
Map<DayOfWeek, List<Event>> events = new HashMap<>();
```

**Why it's slow.** General-purpose `HashMap`: hashing, bucket lookup, indirection. `DayOfWeek` has only 7 values — a tiny dense int range.

**Better:**

```java
Map<DayOfWeek, List<Event>> events = new EnumMap<>(DayOfWeek.class);
```

`EnumMap` is backed by an `Object[]` indexed by the enum's `ordinal()`. No hashing. No collisions. Smaller, faster, GC-friendlier. Same goes for `EnumSet` vs `HashSet`.

---

## Optimization 7 — Help escape analysis by keeping objects local

**Slow:**

```java
public int count(List<String> words, String prefix) {
    return (int) words.stream()
                      .filter(new PrefixFilter(prefix))      // captures prefix
                      .count();
}
```

`PrefixFilter` is an explicit class instance; depending on shape, the JIT may not scalar-replace it.

**Better — lambda:**

```java
public int count(List<String> words, String prefix) {
    return (int) words.stream()
                      .filter(w -> w.startsWith(prefix))
                      .count();
}
```

The lambda is implemented via `invokedynamic` + `LambdaMetafactory` — the JIT readily inlines and (often) scalar-replaces the captured environment for small lambdas.

**Confirm with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`** — you should see the capture object eliminated.

---

## Optimization 8 — Final classes for the JIT

**Slow (in tight loops):**

```java
public class PriceFormatter { public String format(long cents) { ... } }

PriceFormatter f = new PriceFormatter();
for (long c : cents) result.add(f.format(c));   // virtual dispatch
```

**Better:**

```java
public final class PriceFormatter { ... }
```

Marking the class `final` removes the need for CHA dependency tracking; the JIT can inline directly. The win is small (microseconds across millions of calls), but it's free if you weren't going to subclass anyway.

**Even better.** Make the method `final`, or `static` if it doesn't depend on instance state.

---

## Optimization 9 — Avoid `Optional` in hot fields

**Slow:**

```java
class Cache {
    private Optional<String> latestKey = Optional.empty();   // field
    public Optional<String> latestKey() { return latestKey; }
}
```

**Why it's slow.** Every access pays one extra reference dereference and one extra object allocation when transitioning to a present value (`Optional.of(...)`). And `Optional` doesn't serialize cleanly with most frameworks.

**Better:**

```java
class Cache {
    private @Nullable String latestKey;
    public Optional<String> latestKey() { return Optional.ofNullable(latestKey); }
}
```

Hold the value as `null`-able internally; only build an `Optional` when handing it out. The `Optional` becomes a short-lived object the JIT can scalar-replace.

---

## Optimization 10 — Replace inheritance with composition for cold-path classes

**Slow:**

```java
public class TimedHashMap<K,V> extends HashMap<K,V> {
    private final Map<K, Instant> insertedAt = new HashMap<>();
    @Override public V put(K k, V v) { insertedAt.put(k, Instant.now()); return super.put(k, v); }
    // putAll, putIfAbsent, compute, merge, ... none get timestamped
}
```

**Why it's slow (and broken).** Subclassing `HashMap` exposes 30+ inherited methods, most of which bypass your override (`putAll` calls `put` only sometimes, depending on internal implementation). You either over-override or under-override, both wrong.

**Better:**

```java
public final class TimedMap<K,V> {
    private final Map<K, V> data = new HashMap<>();
    private final Map<K, Instant> insertedAt = new HashMap<>();
    public V put(K k, V v) { insertedAt.put(k, Instant.now()); return data.put(k, v); }
    public V get(K k) { return data.get(k); }
    // expose only what you need
}
```

Smaller surface, no inherited surprises. The JIT inlines the small wrappers, and you control the contract.

---

## Optimization 11 — Use primitives in object headers via `record` packing

**Slow:**

```java
public class Pair {
    Object first;
    Object second;
}
Pair[] arr = new Pair[1_000_000];   // 1M Pair objects + their fields = high GC pressure
```

**Why it's slow.** Each `Pair` is its own heap object (24 B header + fields), each `Object` field points to yet another heap object. Iterating an array of these is ~3 cache lines per element.

**Better — use primitive types directly:**

```java
record IntPair(int a, int b) {}
IntPair[] arr = new IntPair[1_000_000];
```

Now each `IntPair` is 12 (header) + 4 + 4 + 4 (pad) = 24 B with no further pointers — half the cost.

**Even better (Valhalla preview):**

```java
value record IntPair(int a, int b) {}
IntPair[] arr = new IntPair[1_000_000];   // flat: 8 B per element, no header
```

When stable, this brings array-of-tuple performance to within ~10% of two parallel `int[]` arrays.

---

## Optimization 12 — Replace string-keyed switch with enum

**Slow:**

```java
public Money applyDiscount(String type, Money amount) {
    switch (type) {
        case "WELCOME": return amount.times(0.9);
        case "BLACK_FRIDAY": return amount.times(0.5);
        case "VIP": return amount.times(0.8);
        default: return amount;
    }
}
```

**Why it's slow.** String-keyed `switch` (since Java 7) compiles to `hashCode + equals` on the strings — two indirections per case, plus the original string was likely allocated from JSON parsing or a database read.

**Better:**

```java
public enum DiscountType { WELCOME, BLACK_FRIDAY, VIP, NONE }

public Money applyDiscount(DiscountType type, Money amount) {
    return switch (type) {
        case WELCOME      -> amount.times(0.9);
        case BLACK_FRIDAY -> amount.times(0.5);
        case VIP          -> amount.times(0.8);
        case NONE         -> amount;
    };
}
```

Enum `switch` compiles to a single `tableswitch` bytecode based on `ordinal()`. One ALU op vs two hash + compare. Plus exhaustiveness checking (must handle every enum constant) catches "I added a discount type and forgot to handle it" at compile time.

---

## Methodology

For every change in this file, the discipline is the same:

1. **Profile first.** `async-profiler -e alloc` for allocation hotspots; `-e cpu` for CPU hotspots. If your "optimization" target isn't in the top 5%, you're polishing a non-bottleneck.
2. **Benchmark with JMH.** Microbenchmarks are easy to fool yourself with — `@State`, `@Warmup`, `@Measurement`, `Blackhole.consume`. Numbers below 1 ns/op or above 1 ms/op should make you suspicious.
3. **Measure both throughput and allocation.** `-prof gc` in JMH reports `alloc.rate.norm` — bytes allocated per operation. Often the real win.
4. **Confirm with the JIT.** `-XX:+PrintInlining`, `-XX:+PrintEliminateAllocations`, `-XX:+PrintAssembly` (with hsdis). For 95% of code you don't need these — but for the hot 5% they're decisive.
5. **Test invariants didn't change.** A faster `equals` that breaks the contract is not an optimization; it's a corrupted dataset waiting to happen.

The biggest performance wins from class design — by far — are **fewer allocations**, **better locality**, and **smaller objects**. Tweaking individual methods rarely moves the needle. Restructuring the data does.
