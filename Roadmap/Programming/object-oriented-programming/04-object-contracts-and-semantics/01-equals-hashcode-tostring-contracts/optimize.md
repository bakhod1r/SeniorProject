# equals / hashCode / toString — Optimize

> The equality contracts are correctness-first; performance is a near-second concern that bites in hot paths — hash-based collections under load, key-heavy caches, deep-equality checks inside tight loops, and `toString` calls that allocate megabytes per second in log-heavy services. This file walks ten optimization angles: where `Objects.hash` allocates, how to cache `hashCode` for immutable types, ordering of short-circuit checks in `equals`, JIT behaviour for `instanceof` chains, sealed types + pattern matching as JIT-friendly equality, records and escape analysis, identity-based collections, lazy `toString` for log-heavy paths, GC pressure from `Objects.hash`, and a JMH harness comparing hand-written hash with `Objects.hash`. All numbers are illustrative; verify in your environment.

---

## 1. The cost of `Objects.hash` — varargs allocation

`Objects.hash(field1, field2, field3)` is the idiomatic recipe for combining field hashes. Its implementation, from JDK 21:

```java
public static int hash(Object... values) {
    return Arrays.hashCode(values);
}
```

The `Object...` varargs parameter is desugared by `javac` into an `Object[]` allocation at every call site. For a `hashCode` call inside a hash-table get/put, that means one heap allocation per hash. Boxing of primitives is the second cost:

```java
@Override public int hashCode() {
    return Objects.hash(id, name, age);   // allocates Object[3]; boxes id (long) and age (int)
}
```

Bytecode at the call site:

```
bipush 3
anewarray Object              ; allocate Object[3]
dup
iconst_0
aload_0
getfield #1 id (long)
invokestatic Long.valueOf      ; box long → Long
aastore
dup
iconst_1
aload_0
getfield #2 name (String)
aastore
dup
iconst_2
aload_0
getfield #3 age (int)
invokestatic Integer.valueOf   ; box int → Integer
aastore
invokestatic Objects.hash
```

In a hot loop calling `map.get(key)` a million times per second, this becomes measurable — perhaps 5-15% of CPU in pathological cases. Escape analysis *sometimes* eliminates the allocation (the array doesn't escape `Objects.hash`), but EA is heuristic — it succeeds in tight loops with monomorphic call sites and fails in megamorphic ones.

**Mitigation 1: Hand-write the hash for known field counts.**

```java
@Override public int hashCode() {
    int h = Long.hashCode(id);
    h = 31 * h + name.hashCode();
    h = 31 * h + age;
    return h;
}
```

No varargs allocation, no boxing. This is the form `String.hashCode` uses internally. For a *single* field, `Objects.hashCode(field)` is fine — no varargs.

**Mitigation 2: Use records.** The compiler generates an `invokedynamic` call site that the JIT specialises into a non-allocating hash. Records are typically as fast or faster than `Objects.hash` and as fast as a hand-written `31 * h + field` chain.

**Mitigation 3: Cache the hash code** (section 2).

For most domain code the varargs cost is *not* worth optimising — the readability win of `Objects.hash` exceeds the throughput loss. Optimise only when JMH points at the `hashCode` call site.

---

## 2. Cached `hashCode` for immutable types

If a class is immutable, its `hashCode` is invariant — compute it once, cache the result. The cost of *one* hash computation is the same; the cost of *N* hash computations becomes the cost of *one*.

```java
public final class CompoundKey {
    private final String tenantId;
    private final String resourceId;
    private final String region;
    private final int hash;                  // computed once, in the constructor

    public CompoundKey(String tenantId, String resourceId, String region) {
        this.tenantId   = Objects.requireNonNull(tenantId);
        this.resourceId = Objects.requireNonNull(resourceId);
        this.region     = Objects.requireNonNull(region);
        this.hash       = Objects.hash(tenantId, resourceId, region);
    }

    @Override public int hashCode() { return hash; }
    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CompoundKey k)) return false;
        if (hash != k.hash) return false;     // (*) fast inequality short-circuit
        return tenantId.equals(k.tenantId)
            && resourceId.equals(k.resourceId)
            && region.equals(k.region);
    }
}
```

Notice the line marked `(*)`: when two cached hashes differ, the objects *cannot* be equal (by the `hashCode` contract). The full field comparison is skipped, often hiding the cost of three `String.equals` calls behind one `int` comparison. This is the *cached-hash short-circuit*, the same trick `String` uses with its `hash` field (though `String` does it lazily — see `String.java` in the JDK).

The trade: one extra `int` field per instance (4 bytes plus possibly padding) for amortised O(1) hash and faster inequality. For value types that are heavily used as map keys (compound keys, complex IDs, cache keys), the trade is usually worth it. For records, this pattern requires writing a custom record with a derived component — easier to leave to a `final` class.

**Caveat: the lazy-hash variant.**

```java
private int hashCache;       // not final; lazily computed

@Override public int hashCode() {
    int h = hashCache;
    if (h == 0) {            // sentinel: 0 means "not computed yet"
        h = Objects.hash(tenantId, resourceId, region);
        hashCache = h;
    }
    return h;
}
```

The lazy variant trades constructor cost for first-call cost. It is *not thread-safe in the strict sense* — two threads may compute the hash concurrently and race the write — but both will compute the same value, so the race is benign. `String` uses this exact pattern. The cost: the sentinel `0` collides with legitimately-zero hashes (one in 2^32 keys recompute every time). For most code this is acceptable.

---

## 3. Equals short-circuit ordering

`equals` is called for every key collision in a hash table and for every `contains` walk in a list. The body's execution time matters. Order the comparisons by *cost* (cheap first) and *selectivity* (most-likely-to-differ first):

```java
@Override public boolean equals(Object o) {
    if (this == o) return true;                          // 1. identity — 1 ns
    if (!(o instanceof Customer other)) return false;    // 2. instanceof — 2 ns
    return id == other.id                                // 3. cheap primitive compare
        && status == other.status                        // 4. enum compare
        && Objects.equals(email, other.email)            // 5. string compare (medium)
        && Objects.equals(profile, other.profile);       // 6. deep object compare (heavy)
}
```

Three principles:

- **Identity first.** `this == o` is the cheapest possible check and is true for many hot-path scenarios (objects compared to themselves, e.g., during iteration).
- **Type check second.** Required for correctness; `instanceof` is a single-instruction check with a class pointer comparison.
- **Field comparisons in cost order: primitives → enums → small strings → large strings → deep objects.** A `false` answer from a cheap comparison short-circuits the chain.

When you have multiple plausible orderings, profile a representative workload. For keys where the *identifier* field differs most often, place it first; for keys where a small enum (`status`, `type`) is the discriminator, place that first.

Records auto-generate `equals` with components in declaration order. If you care about short-circuit selectivity, *declare the most-differentiating component first*. The trade is: declaration order also drives `toString` order and constructor signatures, so the discriminating-first rule has UX consequences.

---

## 4. JIT and `instanceof` chains

The pattern-match `switch` over a sealed type compiles to a bytecode `typeswitch` that the JIT lowers to a chain of `instanceof` checks (or, when shapes line up, a tableswitch indexed by class tag). For a small sealed hierarchy (~3-5 leaves), this is comparable to a `switch` on an enum tag.

```java
public sealed interface Shape permits Circle, Square, Triangle {}

public static double area(Shape s) {
    return switch (s) {
        case Circle c    -> Math.PI * c.r() * c.r();
        case Square sq   -> sq.s() * sq.s();
        case Triangle t  -> 0.5 * t.b() * t.h();
    };
}
```

C2 inlines each branch, devirtualizes the accessor calls (records are `final`), and constant-folds the arithmetic where possible. For a `Shape` argument with a stable runtime type, the entire method compiles to a single inlined branch.

The cost grows linearly in the number of permitted subtypes. For 50 permits, the chain becomes long enough that the JIT may emit a table jump instead of a chain. The threshold depends on JDK version and the C2 heuristics; in JDK 21, expect a chain for ≤ 5 leaves and a table for ≥ 7.

**Comparison to `Object.equals`.** `equals` is a virtual call (`invokevirtual` or `invokeinterface`); the JIT inlines it when the receiver type is monomorphic. For megamorphic call sites (e.g., a `HashSet<Object>` holding many distinct types), each `equals` call costs a full virtual dispatch. Sealed-type pattern matching is *always* monomorphic at each branch — the type is known statically inside the case.

---

## 5. Records and escape analysis

Records are the cleanest value carriers for the JIT:

- Implicitly `final`. No subclass can override `equals`/`hashCode`/`toString`.
- Components are `final`. No setter can leak `this`.
- Accessors are tiny one-line getters. Inlinable.
- `equals`/`hashCode`/`toString` generated through `invokedynamic` with a known bootstrap; the JIT specialises the call site once.

Escape analysis often eliminates short-lived record allocations entirely:

```java
public record Money(long cents, Currency currency) {
    public Money plus(Money other) {
        if (currency != other.currency) throw new IllegalArgumentException();
        return new Money(cents + other.cents, currency);
    }
}

// Hot loop:
Money total = new Money(0, USD);
for (Order o : orders) {
    total = total.plus(o.amount());
}
```

The intermediate `new Money(...)` calls allocate ~24 bytes each on a 64-bit JVM. With many orders, that's MB/sec of garbage. But the JIT's escape analysis often proves the intermediate `Money` does not escape the loop body — the components are read once, combined into the next `Money`, and the previous one is dead. C2 performs *scalar replacement*: the `cents` and `currency` live in registers, no heap allocation.

**Confirm with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`** — the output names each allocation site that EA eliminated.

EA is heuristic. It works when:

- The record has few components (≤ ~4 reference fields, more primitives fine).
- The constructor is simple (no work beyond field assignment).
- The hot loop is small enough to fit in C2's inlining budget.

EA fails when:

- The record escapes via a field, a return value, or a collection.
- The hot method is too large; C2 abandons EA for inlining budget reasons.
- The record's `equals` or `hashCode` is called inside the loop with an unknown receiver type — `invokeinterface` on `Object` may not inline.

For domain code with many small immutable value classes, records + EA give you allocation-free pipelines without manual mutable-builder gymnastics.

---

## 6. Identity-based collections vs equality-based

Some collections key on *identity* (`==`), not `equals`:

- `IdentityHashMap` — explicitly identity-keyed.
- `ConcurrentHashMap`'s internal `compareAndSet` operations on nodes.
- Reference-based caches (`WeakHashMap` keys via `WeakReference`, but the comparison is still identity-equal).

When you have a hot path where every key is *guaranteed unique by identity* (e.g., a per-thread cache of one-per-thread objects), `IdentityHashMap` skips the `equals` call entirely:

```java
Map<Connection, ConnectionStats> stats = new IdentityHashMap<>();

stats.computeIfAbsent(conn, c -> new ConnectionStats());
```

Lookup is one pointer comparison plus the bucket walk. No virtual call to `equals`, no field comparisons. For high-throughput coordination structures, this can be measurably faster.

The trade: *no* value-equality. Two structurally identical objects (e.g., two `Connection` instances pointing to the same logical connection) are distinct keys. Use `IdentityHashMap` only when this is the intended semantics.

**`Set<T>` from identity:** there is no `IdentityHashSet` in the JDK, but you can build one from `Collections.newSetFromMap(new IdentityHashMap<>())` — the standard adapter pattern.

---

## 7. `toString` allocation in log-heavy paths

Every `log.info("foo {}", obj)` call eventually invokes `obj.toString()`. For a verbose `toString` over many fields, this is a `StringBuilder` allocation, a series of `append` calls, and a final `toString()` that allocates the resulting `String`.

Most logging frameworks (SLF4J + Logback, Log4j2) defer the substitution until the level is enabled — `log.debug` won't call `toString` if `DEBUG` is disabled, because the `{}` substitution is lazy. But `log.info` calls `toString` for every message at INFO level, which means every `User`, `Order`, `Cart` your service produces.

**Mitigation 1: cheap `toString`.** For value classes, a one-line `toString` is essentially free — a record's auto-generated `toString` does one `StringBuilder` + ~5 appends. For domain aggregates, summarise:

```java
@Override public String toString() {
    return "Cart[id=" + id + ", items=" + items.size() + ", total=" + total + "]";
}
```

Don't iterate large collections; print the size. Don't traverse object graphs; print the root identifier.

**Mitigation 2: lazy `toString` for expensive cases.** Wrap the object in a `Supplier`:

```java
log.info("processing {}", (Supplier<String>) () -> expensiveSummary(order));
```

(SLF4J supports `Supplier` arguments via `org.slf4j.helpers.MessageFormatter` in newer versions. Log4j2 has `LambdaUtil`.) The supplier is invoked only if the level is enabled.

**Mitigation 3: cache `toString` for immutable types.** Same pattern as cached `hashCode`:

```java
private final String cachedToString;

public Money(long cents, Currency currency) {
    /* ... */
    this.cachedToString = formatted(cents, currency);
}

@Override public String toString() { return cachedToString; }
```

Trades constructor cost for `toString` cost. Worth it for types that appear in many log lines per second.

**Mitigation 4: don't `toString` in tight loops at all.** If a hot method logs every iteration, the log itself becomes the bottleneck regardless of `toString` cost. Aggregate first, log the summary.

---

## 8. GC pressure from `Objects.hash` in collection hot paths

A `HashMap<K, V>` with `Objects.hash`-based keys allocates one `Object[]` per `hashCode` call. For a map with 1M ops/sec, that's 1M allocations/sec — roughly 16-24 MB/sec of garbage on most JVMs.

The GC handles this gracefully (young gen, cheap allocation, cheap collection), but the *cost shows up in three places*:

1. **Minor GC frequency.** More short-lived garbage → more frequent young-gen collections → more pauses (G1 / ZGC keep pauses in single-digit ms, but the throughput cost is real).
2. **TLAB exhaustion.** Each thread has a *Thread-Local Allocation Buffer* for fast object creation. Heavy allocation refills TLABs more often, taking a slow path.
3. **Cache pressure.** Allocations evict useful data from L1/L2.

**Measurement: JMH `-prof gc`.**

```
Benchmark                          Mode   Score      Units     gc.alloc.rate
HashCodeBench.objectsHash         avgt   12.3 ns/op           1024 MB/sec
HashCodeBench.handWritten         avgt    8.7 ns/op              0 MB/sec
HashCodeBench.cachedHash          avgt    1.2 ns/op              0 MB/sec
```

The hand-written and cached variants allocate nothing. The `Objects.hash` variant allocates ~1 GB/sec at the throughput shown — measurable in any production-shaped workload.

**Decision tree:**

- For 99% of code, `Objects.hash` is fine. Maintainability dominates.
- For map keys hammered at millions of ops/sec, hand-write the hash chain or cache the hash.
- For domain values in pipelines (no map-key role), let EA eliminate the allocation; records are the right shape.

---

## 9. A JMH harness — `Objects.hash` vs hand-written vs cached

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
@Fork(value = 2, jvmArgsAppend = "-XX:+UseG1GC")
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
public class HashCodeBench {

    record ObjectsHashKey(long id, String name, int region) {
        @Override public int hashCode() { return Objects.hash(id, name, region); }
    }

    record HandWrittenKey(long id, String name, int region) {
        @Override public int hashCode() {
            int h = Long.hashCode(id);
            h = 31 * h + name.hashCode();
            h = 31 * h + region;
            return h;
        }
    }

    static final class CachedKey {
        final long id;
        final String name;
        final int region;
        final int hash;
        CachedKey(long id, String name, int region) {
            this.id = id; this.name = name; this.region = region;
            int h = Long.hashCode(id);
            h = 31 * h + name.hashCode();
            h = 31 * h + region;
            this.hash = h;
        }
        @Override public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof CachedKey k)) return false;
            if (hash != k.hash) return false;
            return id == k.id && region == k.region && name.equals(k.name);
        }
        @Override public int hashCode() { return hash; }
    }

    @Param({"1", "8", "64"}) int fields;
    ObjectsHashKey   ohk;
    HandWrittenKey   hwk;
    CachedKey        ck;

    @Setup public void init() {
        ohk = new ObjectsHashKey(42L, "alpha", 1);
        hwk = new HandWrittenKey(42L, "alpha", 1);
        ck  = new CachedKey(42L, "alpha", 1);
    }

    @Benchmark public int objectsHash()   { return ohk.hashCode(); }
    @Benchmark public int handWritten()   { return hwk.hashCode(); }
    @Benchmark public int cachedHash()    { return ck.hashCode(); }
}
```

Typical results on JDK 21, x86-64:

| Benchmark         | Throughput | gc.alloc.rate    | Notes                                |
|-------------------|-----------|--------------------|--------------------------------------|
| `objectsHash`     | ~12 ns/op | ~1 GB/sec          | Object[] varargs + boxing            |
| `handWritten`     | ~8 ns/op  | 0                  | inlined arithmetic, no allocation    |
| `cachedHash`      | ~1 ns/op  | 0                  | one field load, no work              |

For a hot map key, the cached form is ~10× faster than `Objects.hash`. For a domain value occasionally compared, the difference is in the noise. **Profile your specific use case before changing.**

---

## 10. When to break the contract for performance

Almost never. The equality contract is *correctness*, and breaking it produces silent collection corruption that no profiler catches. The three legitimate exceptions:

**A — Identity-keyed maps.** When equality semantics aren't needed, `IdentityHashMap` (or `IdentityHashSet` via the adapter) is faster than `HashMap`. Not a contract break — a different contract.

**B — `hashCode` caching in immutable types.** A cached hash is *contract-compatible* (returns the same value every call) and faster. No trade-off.

**C — Reduced-precision `equals` in pipelines.** If a stage of a pipeline only needs *approximate* equality (e.g., "same order ID, ignore the audit timestamp"), the value class can expose a separate `equalsByContent` / `equalsByIdentity` method. Don't override `equals` to mean something other than what the contract says.

```java
public record Order(long id, BigDecimal total, Instant placedAt) {
    public boolean sameOrder(Order other) {
        return id == other.id;     // identity-shaped check; doesn't override equals
    }
}
```

Hot paths use `sameOrder`; collections use the auto-generated `equals`. Two different contracts, two different method names, no surprise.

The senior temptation — "this `equals` is too slow, I'll just compare IDs" — is the classic source of the bugs in [./find-bug.md](./find-bug.md). Resist. Profile, then choose between caching, hand-written hash, or identity-keyed collections.

---

## 11. Quick rules — when to optimise the contracts

- [ ] **Profile first.** The default (records + `Objects.hash`) is fast enough for 99% of code. Don't optimise without JMH evidence.
- [ ] **Cache `hashCode`** in immutable types used heavily as map keys. The cached-hash short-circuit also speeds up `equals`.
- [ ] **Order `equals` comparisons** by cost (cheap first) and selectivity (discriminating first). Identity check first, always.
- [ ] **Hand-write the hash chain** when `Objects.hash` allocation shows up in `-prof gc`. Use `31 * h + field` arithmetic.
- [ ] **Records over hand-written classes** for value types. EA gives you allocation-free pipelines; the auto-generated methods are JIT-friendly.
- [ ] **Sealed types + pattern matching** for closed-set equality dispatch. Monomorphic per branch, JIT-friendly.
- [ ] **`IdentityHashMap`** when key semantics are identity, not content. Faster, smaller, no `equals` call.
- [ ] **Cheap `toString`**. Print sizes, not contents; cache for immutable types; lazy-supply for expensive cases.
- [ ] **Don't break the contract for performance.** Cache, restructure, or use a different collection type — never violate the five clauses.
- [ ] **Document the trade.** `// hand-written for hot map-key path, see profile X` keeps the next maintainer honest.

---

## 12. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Plain English with examples                                 | `junior.md`        |
| Mechanical recipe, hash quality                             | `middle.md`        |
| Inheritance, proxies, classloaders                          | `senior.md`        |
| Code review, ArchUnit, Lombok policy                        | `professional.md`  |
| JLS sections, JEP 395, `Objects` class                      | `specification.md` |
| Ten buggy snippets                                          | `find-bug.md`      |
| Hands-on refactors                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** the equality contracts are correctness-first. Records + `Objects.hash` are fast enough for almost everything. When profiling demands more, cache the hash on immutable types (free win, no contract change), hand-write the hash chain (no varargs allocation), order `equals` comparisons cheap-and-selective-first, and lean on sealed types + records for JIT-friendly dispatch. Never break the contract for performance — break the *implementation*, never the *meaning*. Measure with JMH and `-prof gc`; the production cost lives in allocation rate as much as in latency.
