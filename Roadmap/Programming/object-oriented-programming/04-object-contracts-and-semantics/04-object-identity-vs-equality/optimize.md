# Object Identity vs Equality — Optimize

> Where identity and equality meet the JVM: `==` compiles to one bytecode (`if_acmpeq`), `.equals` is a virtual call that the JIT *usually* inlines, the intern pool costs RAM, the Integer cache size is tunable, and `HashMap.get` short-circuits to `==` before calling `.equals`. This file maps each angle to a measurable cost or saving, with JMH-style sketches. All numbers are illustrative; profile in your environment.

---

## 1. `==` is one machine instruction; `.equals` is a virtual call

The bytecode-level difference (see `specification.md` §8):

- `==` between two reference operands compiles to `if_acmpeq`. On x86-64, that lowers to a single `cmp` + `je`. Two operands, one comparison, branch-predictable. ~0.3 ns warm.
- `.equals(other)` compiles to `invokevirtual` on `java/lang/Object` (or the actual class, if statically known). The JVM does a vtable lookup and calls into the method body. For a monomorphic call site, the JIT inlines the body; for megamorphic, it dispatches through the vtable.

Concrete cost in JMH (Intel, JDK 21, C2):

| Comparison                          | Time/op   |
|-------------------------------------|-----------|
| `ref1 == ref2`                      | ~0.3 ns   |
| `String.equals` (10-char, equal)    | ~3 ns     |
| `String.equals` (10-char, unequal length) | ~1 ns (length check fails first) |
| `String.equals` (32-char, identity-hit) | ~0.5 ns (the `this == anObject` fast path inside `equals`) |
| `Objects.equals(s1, s2)`            | ~0.6 ns + delegate cost |
| `Integer.equals(other)`             | ~1 ns (unboxes & compares) |
| `record.equals(other)` (3 components, mixed) | ~3 ns |

The headline: for *correct* equality, `.equals` is not free, but it's also not measurable in any application code outside microbenchmarks. **Don't trade correctness for ~3 nanoseconds.**

---

## 2. The `==` fast path inside `String.equals`

`String.equals` checks identity first:

```java
public boolean equals(Object anObject) {
    if (this == anObject) return true;          // (*)
    if (anObject instanceof String anotherString) {
        ...
    }
    return false;
}
```

For interned or shared strings, line `(*)` returns `true` in one instruction. The body that compares characters never runs. So *interning a hot-path key* makes `.equals` cost the same as `==` for cache hits — without forcing your code to use `==` everywhere.

This is the right model: **use `.equals` in your code; intern the canonical instances so the fast path fires.** You get correctness everywhere and speed where it matters.

A typical interning pattern:

```java
private static final String STATUS_OK = "OK".intern();
private static final String STATUS_FAIL = "FAIL".intern();

public boolean isOk(String status) {
    return STATUS_OK.equals(status);     // fast path if status was also interned
}
```

For status values, you might intern them on insert into a status registry:

```java
public Status register(String raw) {
    return statuses.computeIfAbsent(raw.intern(), Status::new);
}
```

The pool grows by *one* entry per distinct status (a small, bounded number). Don't do this for unbounded inputs (Bug 4 in `find-bug.md`).

---

## 3. `HashMap.get` identity fast path

`HashMap`'s lookup is even more identity-friendly:

```java
// from HashMap.getNode
if (first.hash == hash &&
    ((k = first.key) == key || (key != null && key.equals(k))))
    return first;
```

The condition reads "hash matches AND (same object OR `.equals`)". If `key == first.key`, the lookup returns immediately without invoking `.equals` at all. This is the identity fast path inside the equality-keyed map.

Practical effect: putting the exact same `String` reference back into `Map.get` is faster than putting an equal-but-distinct reference. For high-traffic lookups (e.g., header parsing where a few dozen distinct names are looked up millions of times), interning the names — *once*, into a small bounded table — turns every `Map.get` into a one-instruction `==` hit.

The Hadoop / Spark codebases use this trick aggressively. So does Tomcat for HTTP header names.

---

## 4. Identity hash cost — first-call vs subsequent

`System.identityHashCode(obj)` on an object whose hash hasn't been computed yet:

1. Read the object's mark word (`mov` instruction).
2. Branch on whether the hash bits are set.
3. If unset, generate a hash, attempt CAS into the mark word, retry on contention.

The first call is ~10–30 ns depending on cache state and contention. Subsequent calls are a single read: ~1 ns.

`Object.hashCode()` for a class that doesn't override has the same cost. For a class that overrides (e.g., `String`, records), the override runs instead — typically O(n) in the data, but cached by the JIT after warmup.

For `IdentityHashMap.put` on a fresh object, the first lookup pays the identity-hash compute. Subsequent lookups are cheap. So *bulk loading* an `IdentityHashMap` is slightly slower than bulk-loading a regular `HashMap` of records (whose `hashCode` is amortised). But individual hot-path lookups are faster on `IdentityHashMap`, because the lookup is `==` (one cmp) vs `.equals` (a method body).

JMH-style measurement:

```java
@Benchmark
public Value hashMapGet(BenchmarkState s) {
    return s.hashMap.get(s.key);            // ~12 ns (hashCode + equals)
}

@Benchmark
public Value identityHashMapGet(BenchmarkState s) {
    return s.identityMap.get(s.key);        // ~4 ns (identity hash + ==)
}
```

`IdentityHashMap.get` is roughly 3x faster for the same key on a warm cache. But: only if identity is the *right contract*. Using `IdentityHashMap` with a logically-equal-but-distinct key returns `null` (Bug 6 in `find-bug.md`). The performance is meaningless if the answer is wrong.

---

## 5. Intern pool memory cost

The string pool lives on the heap (since Java 7). The runtime structure is a hash table; each entry holds a `String` reference. The default size is `60013` buckets (`-XX:StringTableSize=60013`). Each interned string occupies:

- One pool entry (`~16 bytes`)
- The `String` object header + char array (`~40 + 2*length` bytes for non-Latin-1 strings; `40 + length` bytes for Latin-1 via Compact Strings, JEP 254)

For 1 million interned strings averaging 32 characters, the pool consumes ~80 MB (Latin-1 + headers + entries). The strings are *never collected* — interned strings are reachable from the pool's strong references.

**Inspection commands:**

```
jcmd <pid> VM.stringtable        # show pool stats
jcmd <pid> GC.run                # force GC; pool is not affected
java -XX:+PrintStringTableStatistics MyApp
```

A pool that grows past ~1 million entries usually indicates programmatic interning of user input — which is almost always a bug.

The performance trade-off of `intern()`:

- **Win:** repeated lookups against the canonical instance take the `==` fast path inside `String.equals` and inside `HashMap.get`. For URI strings looked up millions of times, this saves measurable time.
- **Loss:** every `intern()` call is a hash-table lookup + possibly a contended insert under a lock. The cost is ~50 ns per call on a warm pool, ~hundreds of ns on a cold one. Don't intern on the hot path; intern once at startup, reuse the canonical reference.

---

## 6. Integer cache size and `-XX:AutoBoxCacheMax`

The default `Integer` cache spans `-128..127`. You can extend the *positive* end with `-XX:AutoBoxCacheMax=N`. Setting it to `1024`:

```
java -XX:AutoBoxCacheMax=1024 MyApp
```

Allocates 1024 + 129 = 1153 `Integer` instances at class load, occupying ~18 KB of heap. Autoboxing values in `[-128, 1024]` returns the cached instance; values outside still allocate.

When does this matter?

- **Domain with small but >127 IDs.** Status codes 200/404/500, year-of-birth (1900–2100), grade levels — if your codebase passes these as `Integer` (instead of `int`), the cache extension turns `valueOf` into a no-op for the common cases.
- **Hot loops with boxed integers.** A pipeline that boxes every counter is hostile to GC; raising `AutoBoxCacheMax` to cover the loop's range removes the allocations.

The trade-off:

- Each cached `Integer` is ~16 bytes (header + `int` field). 1024 extras = 16 KB. Negligible.
- `Integer.valueOf(i)` becomes a single array load instead of an allocation.
- **Don't write code that *relies* on the cache extension.** If your code only works under `-XX:AutoBoxCacheMax=1024`, you've shipped a bug — the next JVM upgrade may break you. Treat the cache as a perf knob, not a contract.

The mandate-vs-permit distinction (JLS §5.1.7): the `-128..127` range is *mandated*; anything beyond is JVM discretion. Your code must work correctly with the minimum cache.

---

## 7. `IdentityHashMap` internal structure

Unlike `HashMap`, `IdentityHashMap` uses *open addressing* with linear probing. The internal table is a single `Object[]` where keys and values alternate:

```
table = [k0, v0, k1, v1, k2, v2, ...]
```

Compared to `HashMap`'s array-of-buckets (each bucket a linked list / red-black tree):

- **Cache locality:** linear probing has better cache behaviour than chasing pointers through buckets. Adjacent slots in `IdentityHashMap` share a cache line.
- **Memory:** lower per-entry overhead. No `Entry` object, no `next` pointer. ~50% of `HashMap`'s memory for the same load factor.
- **Collisions:** linear probing degrades badly under high load. `IdentityHashMap`'s default load factor target is 2/3; expansion occurs at that threshold.
- **No tree-fallback.** `HashMap` (JDK 8+) converts a heavily-collided bucket to a red-black tree. `IdentityHashMap` doesn't. Pathological identity-hash collisions are theoretically possible but extremely rare (System.identityHashCode is reasonably random).

In micro-benchmarks, `IdentityHashMap` is ~30% faster than `HashMap` *when identity is the right contract*. For typical workloads, the speedup doesn't show up in application-level metrics.

`IdentityHashMap` is *not* concurrent. If you need concurrent identity-keyed lookup, wrap in `Collections.synchronizedMap` (coarse-grained) or roll your own striped-lock version. There is no `ConcurrentIdentityHashMap` in the JDK.

---

## 8. JIT identity-equality fast paths in pattern matching

Pattern matching (`instanceof X x`) and `switch` over sealed types include a *null check*, which the JIT lowers to `if_acmpeq` against `null`. The same applies to `Optional.isEmpty()`:

```java
public boolean isEmpty() {
    return value == null;
}
```

`== null` is the fastest possible "is this absent?" check. Don't write `value.equals(null)` (would NPE) or `Objects.equals(value, null)` (works but allocates the static method call). The `== null` idiom is correct and as fast as any code can be.

Modern pattern matching unifies this:

```java
return switch (result) {
    case null      -> Result.empty();
    case Success s -> s.value();
    case Failure f -> f.fallback();
};
```

The `case null` branch is a single `if_acmpeq null` followed by a jump. The compiler's exhaustiveness check makes this idiom hard to misuse. As of Java 21 (JEP 441), this is the recommended pattern for `switch`-based dispatch over a sealed type with null-handling.

---

## 9. `==` as a defensive coding choice

There's one pattern where `==` is *specifically* the right tool *for performance*:

```java
public Object getOrDefault(Object key, Object defaultValue) {
    Object v = internalGet(key);
    return v == NOT_FOUND ? defaultValue : v;     // (*)
}

private static final Object NOT_FOUND = new Object();
```

`NOT_FOUND` is a sentinel — there is exactly one instance, by construction, and `==` against it is unambiguous. Using `.equals` here would be wrong (the sentinel's `Object.equals` is identity anyway, so it'd be equivalent — but it'd also be slower due to the virtual call).

Sentinels are exactly the case where `==` is *both* the contract *and* the optimisation. Document them with a comment to short-circuit the next reviewer's reflex to "fix" them.

`Collections.emptyList()`, `Collections.emptyMap()`, `Optional.empty()` are all sentinels you can compare with `==` for the same reason — but the idiomatic check is `.isEmpty()`, not `== Optional.empty()`. The cleanliness of API beats the nanosecond.

---

## 10. The wrapper-decorator allocation cost

DIP and the decorator pattern often layer multiple wrappers, each holding a reference to the next:

```java
new RetryingRepo(
    new LoggingRepo(
        new MetricsRepo(
            new JdbcRepo(...))));
```

Each layer is an object: header + one reference field. Calling `save(...)` on the outermost wrapper goes through four virtual calls before reaching the JDBC layer. *Identity* is preserved: every call dispatches against the same wrapper chain.

The cost:

- **4 virtual calls** per `save`. Each is `invokeinterface` (most repos are interfaces). HotSpot's class-hierarchy analysis can devirtualise if it sees only one concrete per layer; the call chain inlines to one machine call. If any layer is megamorphic (multiple impls observed), inlining stops there.
- **4 object allocations** at construction time. Permanent, never garbage-collected if the wrappers are wired into a long-lived singleton — fine.

The optimisation: wire wrappers *once*, at startup, into a `final` field. The JIT picks up the type profile after a few thousand calls and can inline through the entire chain. Avoid the anti-pattern of building wrappers per-call:

```java
public void save(Order o) {
    new RetryingRepo(new LoggingRepo(repo)).save(o);  // allocates two wrappers per call
}
```

This allocates two objects per `save`. In a hot path, that's measurable garbage; in a cold path, it's wasted CPU.

---

## 11. Microbenchmark — `String ==`, `.equals`, interned `.equals`

A JMH harness comparing the three styles:

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
public class StringEqualityBench {

    String a, b, interned1, interned2;

    @Setup public void init() {
        a = new String("status-active");           // fresh
        b = new String("status-active");           // fresh, different object
        interned1 = "status-active";               // pool
        interned2 = "status-active";               // same pool entry
    }

    @Benchmark public boolean refEqUnpooled()       { return a == b; }                  // false
    @Benchmark public boolean refEqPooled()         { return interned1 == interned2; }   // true
    @Benchmark public boolean equalsUnpooled()      { return a.equals(b); }              // true
    @Benchmark public boolean equalsPooled()        { return interned1.equals(interned2); }
    @Benchmark public boolean objectsEqualsPooled() { return Objects.equals(interned1, interned2); }
}
```

Typical results:

| Bench                  | Time/op  | Notes                                              |
|------------------------|----------|----------------------------------------------------|
| `refEqUnpooled`        | ~0.3 ns  | One `if_acmpeq`, returns `false` (and is wrong)    |
| `refEqPooled`          | ~0.3 ns  | One `if_acmpeq`, returns `true` (coincidentally)   |
| `equalsUnpooled`       | ~3 ns    | Falls through identity check; compares 13 chars    |
| `equalsPooled`         | ~0.5 ns  | The `this == anObject` fast path inside `equals`   |
| `objectsEqualsPooled`  | ~0.5 ns  | `Objects.equals` is inlined to the same path       |

The takeaways:

- `==` is fastest but *only correct for interned/identical inputs*. The unpooled case returns the wrong answer.
- `.equals` on pooled strings is *nearly as fast* as `==` because of the `==` fast path inside `.equals`.
- `Objects.equals` adds a null check; in pooled equal cases, the JIT inlines through to the same fast path. Negligible overhead.

The right strategy: write `.equals` (or `Objects.equals`), intern the canonical instances on the hot path, get the same performance as `==` without the correctness bug.

---

## 12. Quick rules — when identity helps performance, and when it doesn't

- [ ] **Profile first.** Don't denormalize comparison style without a flame graph that names the call site.
- [ ] **For correctness, use `.equals`.** The JIT inlines monomorphic `.equals` to nearly the same cost as `==`.
- [ ] **Intern canonical keys.** A bounded set of canonical instances (status codes, HTTP header names, XML namespaces) lets the `==` fast path inside `String.equals` and `HashMap.get` fire on every lookup.
- [ ] **Never `intern()` unbounded input.** The pool is never GC'd; user input or UUIDs fill it.
- [ ] **`IdentityHashMap` is ~3x faster than `HashMap`** when identity is the right contract. When it isn't, it returns wrong answers — speed is irrelevant.
- [ ] **`-XX:AutoBoxCacheMax=N`** extends the `Integer` cache to `N`. Useful for domain ranges (status codes, years). Don't write code that *requires* it.
- [ ] **Sentinel objects** are the right place for `==`. One instance per JVM, identity is the contract, comment it.
- [ ] **`== null`** is the fastest absence check. Pattern matching's `case null` lowers to the same instruction.
- [ ] **Wire decorators once.** Per-call allocation of wrappers turns DIP into a GC burden.
- [ ] **Don't trade correctness for nanoseconds.** `==` instead of `.equals` "for speed" is almost always wrong outside the explicit sentinel/enum/identity-contract cases.

---

## 13. What's next

| Topic                                                          | File              |
|----------------------------------------------------------------|-------------------|
| The canonical `==` vs `.equals()` traps for newcomers          | `junior.md`        |
| Refactoring `==` to `.equals`, identity collections            | `middle.md`        |
| When identity is the right contract, intern pools, classloaders | `senior.md`        |
| Code-review vocabulary, Sonar/ArchUnit, mentoring              | `professional.md`  |
| JLS §15.21, §5.1.7 boxing cache, identityHashCode spec         | `specification.md` |
| 10 buggy snippets, identity-vs-equality bug taxonomy           | `find-bug.md`      |
| 8 hands-on refactors and design exercises                      | `tasks.md`         |
| 20 interview Q&A                                               | `interview.md`     |

---

**Memorize this:** `==` is one bytecode; `.equals` is a virtual call with an `==` fast path. For most code, the difference is invisible. For hot paths, interning canonical keys turns `.equals` into `==`-speed without sacrificing the value-equality contract. `IdentityHashMap` is a real performance win when identity is the right contract — and a real correctness bug when it isn't. The Integer cache is tunable but never contractual. Profile, then optimise; never optimise by switching from `.equals` to `==`.
