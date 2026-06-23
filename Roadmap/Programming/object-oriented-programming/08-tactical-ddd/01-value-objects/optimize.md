# Value Objects — Optimize

Ten performance angles on Value Objects, ordered from "easiest, biggest win" to "advanced". Each entry: the cost, what HotSpot/JIT/GC do today, and how to make the code friendlier to those optimizations. Most VOs do not need optimization — but when a VO sits on a hot path (Money in a high-frequency pricing engine, a cache key, a comparator) the difference between "naive" and "optimization-aware" can be ten times.

---

## 1. Record header overhead vs. primitive fields

Every `Money(long cents, String currency)` instance on the heap today costs:

- An object header (12 bytes with compressed oops, 16 without).
- A reference to the `String currency`.
- The `long cents` (8 bytes).

A `Money[]` of one million entries occupies ~24 MB of object headers alone. Where memory matters:

- Prefer `long` over `BigDecimal` for amounts (no extra heap allocation).
- Prefer `Currency` enum or interned `String` for currency (one shared reference).
- Consider a *flat columnar* layout — two parallel arrays `long[] cents; String[] currencies;` — when you process millions of money values in tight loops.

JEP 401 (Value Classes and Objects, preview) erases the header for value classes when flattened, which makes this concern disappear for code targeting that JEP.

## 2. Escape Analysis and scalar replacement

HotSpot's *Escape Analysis* (EA) inspects every allocation. If a `Money` instance does not escape its enclosing method, the JIT can **scalar-replace** it: the object is never allocated; its components live in registers/stack slots.

```java
long total = 0;
for (var item : cart) {
    var line = new Money(item.cents(), "USD");   // does not escape
    total += line.cents();
}
```

This loop allocates zero `Money` objects after warm-up, because the JIT sees `line` is local. EA succeeds when:

- The VO is small and `final`.
- The VO is not stored in a field, returned, or passed to a virtual call.
- The VO is not synchronized on or `==`-compared with another non-local reference.

Records satisfy all four naturally. Defensive `synchronized` blocks on a VO would defeat EA — never lock on a VO.

## 3. JEP 401 — value classes and flattening

When you mark a class `value`, the JVM is allowed to:

- Lay it out *inline* inside arrays (`Money[]` becomes ~12 bytes/element, not ~36).
- Pass it in registers across method boundaries.
- Skip allocation entirely for short-lived instances (more aggressive than today's EA).

The migration is mechanical: add the `value` modifier; drop any `==`, `synchronized(vo)`, or no-arg construction reliance. If you've followed the senior-level rules, your code is already JEP 401-ready.

```java
public value record Money(long cents, String currency) { /* same body */ }
```

JEP 401 is preview at the time of writing; design for it now so the day it ships your code benefits immediately.

## 4. Intern cache for frequently constructed VOs

For VOs with a small value space and high construction rate — `Currency.USD`, common HTTP status codes, common time zones — keep a one-element-per-value cache:

```java
public record Currency(String code) {
    private static final java.util.concurrent.ConcurrentMap<String, Currency> POOL =
        new java.util.concurrent.ConcurrentHashMap<>();

    public static Currency of(String code) {
        return POOL.computeIfAbsent(code.toUpperCase(java.util.Locale.ROOT), Currency::new);
    }
}
```

Trade-offs:

- Eliminates per-construction allocation and validation cost in the hot path.
- Requires that the value space is *bounded* — interning unbounded user input leaks memory.
- The constructor must still validate; the factory just memoizes.

A common Java idiom — `Integer.valueOf(int)` caches `-128..127` for the same reason.

## 5. JIT inlining of `equals` and `hashCode`

HotSpot inlines `equals` aggressively *if* the call site is *monomorphic* (always the same concrete type). Records help because they're implicitly `final` — no virtual dispatch.

Two things that defeat inlining:

- **Megamorphic call sites.** If `equals` is invoked via `Object#equals` across many runtime types, the JIT keeps it virtual. Avoid generic helpers that erase the concrete type.
- **Custom `equals` with branches/loops.** A record's generated `equals` is a flat conjunction over components — easy to inline. A hand-rolled `equals` that walks a `List<String>` defeats inlining.

Where `equals` is on a hot path (cache keys, dedup), prefer a record with primitive components.

## 6. Autoboxing on primitive-only VOs

```java
Map<Money, BigDecimal> rates = new HashMap<>();
```

This causes no autoboxing — `Money` is a reference type. But:

```java
Map<Integer, Money> counts = new HashMap<>();
counts.put(42, new Money(0, "USD"));   // 42 autoboxed
```

If your VO wraps a primitive and you map *by* that primitive, switch to a primitive-keyed map (Eclipse Collections, fastutil, or HPPC) to avoid the boxed `Integer`. Likewise, if a VO has many integer-typed components and you serialize as an `Object[]`, every primitive gets boxed.

## 7. `hashCode` stability and caching

A `String`-heavy VO recomputes its hash on every map lookup unless the JVM caches it. `String.hashCode` *is* cached (`private int hash;`). A record's `hashCode` is *not* cached — it recomputes from components each call.

For VOs used heavily as map keys, cache `hashCode` in a non-record `final class`:

```java
public final class CacheKey {
    private final String region;
    private final long userId;
    private final int hash;
    public CacheKey(String region, long userId) {
        this.region = region; this.userId = userId;
        this.hash   = java.util.Objects.hash(region, userId);
    }
    @Override public int hashCode() { return hash; }
    @Override public boolean equals(Object o) {
        return o instanceof CacheKey k && k.userId == userId && k.region.equals(region);
    }
}
```

This sacrifices the record's terseness for measurable speedup on a hot map.

## 8. String interning for high-cardinality string components

If your `Money` codebase routinely sees only ~10 distinct currency strings but millions of instances, each instance still holds a distinct `String` reference unless you intern. Two cures:

- Use `java.util.Currency` (already interned by the JDK).
- Intern via a dedicated pool (`String.intern()` is global and slow; build your own `Map<String,String>`).

The same idea applies to product codes, country codes, region names — any low-cardinality `String` component of a hot VO.

## 9. Avoid wide reflection at the boundary

A common slowdown for VOs is the *boundary*: Jackson, MapStruct, ORM. Reflection-based field setters bypass the canonical constructor and skip validation, but they're also slow.

Configure each tool for *constructor-based* instantiation:

- Jackson: register the parameter-names module, mark the canonical constructor `@JsonCreator`.
- MapStruct: use constructor-based mapping, no `@Setter`.
- Hibernate: enable byte-code enhancement and the records API; or use `@Embeddable` with field access.

The win is twofold: correctness (constructor runs, validation runs) and speed (Jackson's compiled deserializer is faster than reflective field-setting in modern versions).

## 10. Lazy / cached derived fields

A VO whose method is expensive (`Email.domain()` parses the substring; `Money.formatted()` builds a localized string) and is called repeatedly on the same instance can cache the derived value *if* the cache is computed lazily and immutably observable.

A naive cache breaks immutability:

```java
private String cachedDomain;   // mutable !
```

Two safer patterns:

- **Stable lambda + `Suppliers.memoize`** (Guava): pre-computed at construction, costs one allocation up front.
- **`final` cache field set in the constructor**: pre-compute the derived value once and store it.

```java
public final class Email {
    private final String value;
    private final String domain;       // derived but final
    public Email(String value) {
        if (...) throw new IllegalArgumentException();
        this.value = value.toLowerCase(java.util.Locale.ROOT);
        this.domain = this.value.substring(this.value.indexOf('@') + 1);
    }
    public String domain() { return domain; }
}
```

This costs one extra reference per instance and pays off if `domain()` is called more than once per VO lifetime.

---

## Quick rules

- Don't optimize a VO until profiling shows it on the hot path. Most VOs cost nothing measurable.
- Records are EA-friendly and JIT-friendly by default; prefer them over hand-written classes.
- Use `long` cents over `BigDecimal` for money where the currency permits it.
- Intern bounded value spaces (currencies, country codes, status codes) via a per-VO factory cache.
- Never `synchronized(vo)` — it defeats EA and is forbidden under JEP 401.
- Cache `hashCode` only in a non-record `final class`, only when the VO is a hot map key.
- Push validation to the constructor; deserializers should call the constructor, not reflective field setters.
- Pre-compute expensive derived fields in the constructor and store in `final` fields.
- For huge homogeneous collections of VOs, consider a columnar layout (two parallel primitive arrays) instead of `Vo[]`.
- Migrate to `value record` (JEP 401) the moment your target JDK enables it; the code change is a single keyword.

---

## Memorize this

- The default cost of a record VO is one object header per instance and a recomputed `hashCode` per lookup — both small, but they add up at scale.
- **Escape Analysis + scalar replacement** is the JIT's gift to small immutable VOs; the cost of `new Money(...)` in a tight loop is near zero after warm-up, provided the VO doesn't escape.
- **JEP 401** value classes promise true flattening into arrays and across method boundaries; design every VO so adding the `value` modifier is the only change needed.
- Cache `hashCode` only when profiling demands it; **never** introduce a mutable cache field that breaks immutability.
- Intern factory pools win big for bounded value spaces, but leak memory for unbounded ones.
- Reflection-based deserialization is both slower and unsafer than constructor-based; configure every boundary tool to call the canonical constructor.
- Reference: JEP 395 (records); JEP 401 (value classes); HotSpot Escape Analysis docs; Aleksey Shipilev's "Black Magic of (Java) Method Dispatch".
