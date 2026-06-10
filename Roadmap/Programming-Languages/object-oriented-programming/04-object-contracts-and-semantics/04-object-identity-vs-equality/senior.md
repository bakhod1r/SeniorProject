# Object Identity vs Equality — Senior

> **What?** The edge cases where identity is the *correct* contract: cache keys, singletons, sentinels, intern pools. The intern-pool design across `String`, `Integer`, `Long`, and `enum`. `System.identityHashCode` semantics. Identity surviving (or not) deserialisation. Identity across classloaders. Identity in concurrent code.
> **How?** By reading every `==` in your codebase as a *deliberate* choice, not a leftover from a refactor. Identity is a contract, and the parts of the JDK that lean on it (enums, the string pool, `ConcurrentHashMap` segments, `MethodHandles`) are designed to make that contract reliable. Most identity bugs come from accidentally relying on a contract you didn't establish.

---

## 1. Identity as a deliberate contract

The junior rule "always use `.equals()`" is correct as a default. The senior version is: **identity is a contract you can opt into for specific reasons, and when you do, you commit to keeping it.** Forgetting that commitment is the dominant source of identity-related bugs in mature systems.

Concrete opt-in cases:

- A `Map<Thread, Connection>` that tracks per-thread connections — identity is the *natural* key; two `Thread` objects holding the same name are not the same thread.
- A graph-walk algorithm that uses an `IdentityHashMap<Node, Boolean>` to mark visited nodes — two nodes with equal payloads are still two separate vertices.
- A singleton registry (`enum Singleton { INSTANCE; }`) where the JVM guarantees exactly one instance per classloader, and callers compare with `==`.
- A sentinel like `Optional.empty()` — there is exactly one `Optional.EMPTY` per JVM, and `someOptional == Optional.empty()` is a valid identity probe (though `Optional.isEmpty()` is the idiomatic check).

In all four cases, *equality wouldn't make sense*. There is no value to compare; the only useful comparison is "is this the same instance?". If you tried to give these types `.equals()` semantics, you'd either get the same answer (`Thread.equals` falls back to `==` anyway) or break tooling that already relies on the identity contract.

The mistake juniors make is using identity *accidentally*. The mistake seniors make is using identity *intentionally* but failing to maintain the singleton property — usually around deserialisation or classloading boundaries (§7, §8).

---

## 2. Cache keys — identity or equality?

A cache's key contract decides whether two logically-equal-but-distinct objects share a cache slot.

```java
Map<String, Result> cache = new ConcurrentHashMap<>();
cache.computeIfAbsent("user-42", this::compute);     // equality-based (correct for strings)

Map<Document, ParsedAst> astCache = new IdentityHashMap<>();
astCache.computeIfAbsent(document, this::parse);     // identity-based
```

**Equality cache** is the right default. Two strings `"user-42"` are interchangeable; you don't care which physical object you cached against. Most caches you write are equality caches.

**Identity cache** is right when *the identity of the input object matters more than its content*. The compiler's `MethodHandles.Lookup` cache is keyed by `Class<?>` identity — two `Class` objects for the same class from different classloaders are deliberately separate cache entries because the methods they expose may differ. Jackson's `JavaType` cache is keyed by identity in the same spirit.

The trade-offs:

| Aspect            | Equality cache (`HashMap`)        | Identity cache (`IdentityHashMap`)               |
|-------------------|-----------------------------------|--------------------------------------------------|
| Key contract      | `.equals` + `.hashCode`           | `==` + `System.identityHashCode`                 |
| Reusable across instances? | Yes — equal keys hit the same slot | No — only the same Java object reuses a slot     |
| Risk on bad `equals` | Wrong hits / wrong misses      | Immune — identity has no programmer-supplied logic |
| Risk of memory leak | Equal keys stay alive forever  | Holds *strong* references to keys; pair with `WeakIdentityHashMap` for short-lived objects |
| Thread safety     | `ConcurrentHashMap` available     | No JDK concurrent identity map; wrap with `Collections.synchronizedMap` |

If your key type's `equals` is fragile (mutable fields, broken inheritance, default `Object.equals`), an identity cache *seems* safer, but you're masking a deeper problem. Fix the equality contract instead. See [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/).

---

## 3. Intern pools — string, integer, long, enum

Java has four built-in intern pools, each with subtly different semantics.

**String pool.** Every compile-time `String` literal goes into a JVM-wide pool. Two distinct source-code literals with the same character sequence reference the same `String` object. Programmatic interning is done via `String.intern()`:

```java
String a = "abc";
String b = new String("abc");
System.out.println(a == b);              // false
System.out.println(a == b.intern());     // true — b.intern() returns the pooled instance
```

`intern()` has runtime cost (a hash-table lookup, possibly an insert under a lock). Use it only when you really need identity-based comparison of strings — e.g., as `IdentityHashMap` keys. Production examples: XML namespace URIs (limited set, looked up millions of times), keyword symbols in a parser. Don't intern arbitrary user input — the pool grows unboundedly.

**Integer cache.** `Integer.valueOf(i)` returns a cached instance for `i ∈ [-128, IntegerCache.high]`. The upper bound defaults to `127` but can be raised with `-XX:AutoBoxCacheMax=N` for the *positive* end (the negative end is fixed at `-128` by spec, JLS §5.1.7). The cache exists per JVM, populated eagerly at class load.

```java
Integer a = Integer.valueOf(127);
Integer b = Integer.valueOf(127);
System.out.println(a == b);              // true
```

Same machinery for `Byte` (always cached `-128..127`), `Short` (`-128..127`), `Long` (`-128..127`), and `Character` (`0..127`). `Boolean.TRUE` and `Boolean.FALSE` are the *only* boxed booleans; `Boolean.valueOf` returns one of those two singletons. `Float` and `Double` are *not* cached — there is no cache because the value space is too dense.

Never write code that *requires* the cache. Always use `.equals` or `Objects.equals` for wrapper comparisons. The cache is a memory-saving implementation detail, not a contract.

**Enum identity.** Enum constants are spec-guaranteed singletons (JLS §8.9). `Status.OPEN == anotherStatus` is reliable, fast, and idiomatic. Even after deserialisation, the JVM resolves enum constants by name back to the canonical instance — `==` continues to work. (More on this in §7.)

**Class objects.** `Foo.class` is cached per classloader. Two classloaders both loading `com.example.Foo` produce two *different* `Class` objects, both with the same fully-qualified name. Comparing them with `==` is a valid identity check, but assuming "same name = same class object" across classloaders is wrong. See §8.

---

## 4. `System.identityHashCode` internals

`Object.hashCode()` can be overridden. `System.identityHashCode(obj)` returns the value `hashCode()` *would* return if the class didn't override it. Same value for the same object every time it's asked in the same JVM; *different* values are highly likely for different objects (collisions are rare).

```java
String s = "abc";
s.hashCode();                          // 96354 (content-based, overridden)
System.identityHashCode(s);            // some random-looking int
```

`IdentityHashMap` uses `System.identityHashCode` as its hash function. The value is computed lazily — the first call to `hashCode` on an object that hasn't been hashed yet picks a random-ish integer, stores it in a word of the object's header (on most JVM layouts), and returns it. Subsequent calls return the stored value. This is why identity-hash codes can be reused if the object is garbage-collected and a new one happens to receive the same hash on first access.

Two consequences:

- **An object's identity hash is stable for its lifetime.** You can put it in a hash map without worrying that GC or compaction will rehash it (the JVM preserves the header bits across most GCs; ZGC and Shenandoah have special handling).
- **Two objects can share an identity hash code.** It's a 32-bit value over the full reference space; collisions exist. `IdentityHashMap` handles them with linear probing (open addressing) — read the source for details.

`System.identityHashCode(null)` returns `0`, by spec. So does `Objects.hashCode(null)` — be careful not to confuse the two when null-safety matters.

---

## 5. The object header and where the identity hash lives

On HotSpot, every Java object has a *mark word* (8 bytes on 64-bit) at the start of its header. The mark word stores GC state, biased-lock metadata, and — when the object has been queried via `hashCode` — the identity hash. The hash takes 25–31 bits depending on the JVM.

This has practical consequences:

- **Calling `hashCode()` once mutates the object's header.** No visible effect for callers, but it commits a hash value for the lifetime of the object.
- **An object's mark word can be displaced** during lock contention (the JVM moves the mark to the stack, replaces it with a pointer). The identity hash is preserved through this dance.
- **Some GC schemes** (ZGC's coloured pointers, Shenandoah's forwarding pointers) store metadata in alternative places. The identity hash contract still holds — same object, same hash for life — but the storage location differs.

For application code, none of this matters except in one scenario: **micro-benchmarks of hash-based collections**. Allocating an object and immediately putting it in a `HashMap` triggers the hash compute on `put`; allocating, calling `toString`, then `put`ting may have the hash already materialised. JMH-level differences. Mention here only because the question "where does identity hash live?" comes up in senior interviews.

---

## 6. Identity in deserialisation — singletons that aren't

Java's standard serialisation breaks identity for non-enum singletons unless you take action.

```java
public final class FeatureFlags implements Serializable {
    public static final FeatureFlags INSTANCE = new FeatureFlags();
    private FeatureFlags() { }
    // ...
}

FeatureFlags before = FeatureFlags.INSTANCE;
FeatureFlags after  = deserialise(serialise(before));
System.out.println(before == after);              // false
```

Deserialisation allocates a *new* instance, bypassing the constructor. The singleton property is lost: `before != after`, but the type system happily lets both circulate. Any code that compares with `==` (the standard idiom for singletons) is now wrong.

The two fixes:

```java
// Option 1 — readResolve
private Object readResolve() {
    return INSTANCE;
}
```

`readResolve` is called by `ObjectInputStream` after the new object is built, and lets you substitute the canonical instance. Now `after == INSTANCE` survives the round trip.

```java
// Option 2 — make it an enum
public enum FeatureFlags { INSTANCE; }
```

Enums are deserialised specially: the JVM resolves the constant by name back to the same instance. Joshua Bloch's *Effective Java*, Item 3, recommends enum as "the best way to implement a singleton" precisely because it cleanly handles serialisation, reflection, and cloning.

Library implementations of this pattern include `Boolean.TRUE/FALSE` (which use `readResolve`), `Collections.EMPTY_LIST`/`EMPTY_SET` (`readResolve`), `Optional.empty()` (`readResolve`), and every modern singleton-by-enum.

---

## 7. Identity across classloaders

Two classloaders can load the same `.class` file independently. The result: two distinct `Class<?>` objects, two distinct sets of `static` fields, two distinct enum-constant sets — *for the same fully-qualified type name*.

```java
ClassLoader l1 = new URLClassLoader(new URL[]{ jar }, null);
ClassLoader l2 = new URLClassLoader(new URL[]{ jar }, null);
Class<?> a = l1.loadClass("com.example.Status");
Class<?> b = l2.loadClass("com.example.Status");
System.out.println(a == b);            // false
System.out.println(a.getName().equals(b.getName())); // true
```

The fully-qualified name matches, but the class objects are different — they live in different namespaces. Consequences:

- **Enum singleton breaks.** `Status.OPEN` loaded by `l1` is not `==` to `Status.OPEN` loaded by `l2`. If you cross the classloader boundary (e.g., a plugin returns one, the host expects the other), `==` fails and probably no developer noticed during testing.
- **Static caches are duplicated.** Each classloader gets its own copy of every `static final` field. If you cached `Pattern.compile("...")` in a utility class loaded by two classloaders, you allocated two `Pattern` objects.
- **`instanceof` lies.** An object of type `com.example.Foo` (loaded by `l1`) is *not* `instanceof com.example.Foo` (the class loaded by `l2`). The check returns `false`. `ClassCastException`s downstream.

This is the canonical "works in unit tests, fails in production" trap for plugin architectures, application servers, and OSGi. The cure is **strict classloader hygiene**: agree on a parent classloader where shared types live, and load them *only* from there. Plugins use a child classloader for their private types, but the shared API (`Status` enum, sentinel constants, framework interfaces) is loaded by the parent and shared across plugins.

In a hexagonal architecture (see [../../03-design-principles/](../../03-design-principles/)), the domain module is exactly this kind of "shared parent" — every adapter sees the same domain types because they all share the same classloader for `shop.domain`.

---

## 8. Identity in concurrent code

Identity has a useful property under concurrency: **it doesn't change**. Once a reference is published safely, every thread that observes it sees the same object — and `==` against any other observation of *that* object is `true`.

This makes identity-based singletons and sentinels concurrency-friendly:

```java
private static final Object SHUTTING_DOWN = new Object();

public Object pollOrShutdown() {
    Object next = queue.poll();
    return next == null ? SHUTTING_DOWN : next;
}

void worker() {
    while (true) {
        Object item = pollOrShutdown();
        if (item == SHUTTING_DOWN) break;        // identity check, no equals needed
        process(item);
    }
}
```

The sentinel comparison is wait-free, branch-predictable, and immune to *any* race in the sentinel definition (because it's a final static reference, safely published before any thread starts).

The trap: **`Integer.valueOf` cache size can change across JVMs**. If you write code that relies on `==` between cached integers and run it on a JVM with `-XX:AutoBoxCacheMax=4096`, your tests behave one way; production with default `127` behaves another. Concurrency makes this worse: a thread on the developer's laptop has the cached value; a thread on a production node doesn't; identity comparison flips between the two. This is one variant of "tests pass in dev, fail in prod" — the cure is *don't use `==` on boxed types*, ever.

A more subtle trap: **double-checked locking with `==`**.

```java
private volatile Config config;

public Config get() {
    Config local = config;
    if (local == null) {
        synchronized (this) {
            if (config == null) {
                config = loadConfig();
            }
            local = config;
        }
    }
    return local;
}
```

Here `== null` is correct — `null` is a singleton, and identity is the right contract for "have we initialised this?". The `volatile` ensures the publication; the `==` does the right comparison. This idiom is correct and fast.

---

## 9. `WeakReference`, `SoftReference`, `PhantomReference`, identity

The reference-type hierarchy in `java.lang.ref` is identity-aware all the way down. A `WeakReference<T>` holds a reference to an object that the GC may collect once no strong references remain. The reference's `get()` returns *that specific object* — not a copy, not an equal object — and `==` is the right comparison for the result:

```java
WeakReference<Document> ref = new WeakReference<>(doc);
Document maybe = ref.get();
if (maybe == doc) { ... }       // identity — by design
```

`WeakHashMap` exploits this. Its keys are wrapped in `WeakReference`; when the GC clears a key, the entry is removed. Two equal-but-distinct keys behave correctly because `WeakHashMap` uses `.equals` + `.hashCode` for lookup, but it tracks each key by *its own* weak reference — identity at the GC level, equality at the lookup level.

If you want pure identity-and-weak semantics — a common case for plugin caches that should free up entries when the plugin is unloaded — there is no JDK type. Roll your own using `WeakReference` + `IdentityHashMap`, or use Guava's `MapMaker.weakKeys()`.

---

## 10. The `==` fast path inside `HashMap`

A subtle place where identity pays off without you asking: `HashMap.get` and `HashMap.put` *check identity first* before falling back to `equals`.

From `java.util.HashMap` (slightly simplified):

```java
if (e.hash == hash && ((k = e.key) == key || (key != null && key.equals(k))))
    return e;
```

The condition is "hash matches AND (same object OR equals)". If the looked-up key is the *very same object* that was inserted, `==` returns `true` immediately and `.equals` is never called. This is why caching a single canonical key — `String.intern()`, `Integer.valueOf` for small ints — speeds up high-traffic lookups: every probe takes the `==` fast path.

The cost of `.equals` for `String` is O(n) in the length; the cost of `==` is one machine instruction. For long keys (URIs, hashes), interning the key gives noticeable wins on millions of lookups. *Optimize for the equality path first* and the identity path is a bonus — that's the right way around. Pre-interning everything is a foot-gun (the pool fills up).

This same trick exists in `ConcurrentHashMap`, `LinkedHashMap`, and `IdentityHashMap` (where `==` is the *only* check).

---

## 11. Identity vs equality in `Optional`, `Map.Entry`, value-like records

The JDK has many small types that look like values but might (or might not) intern.

- **`Optional.empty()`** returns the same instance every call, by spec — a sentinel. `Optional.of(value)` always allocates fresh. `Optional` has a sensible `.equals` (based on the wrapped value), so prefer `.equals` over `==` for non-empty optionals.
- **`Map.Entry`** — `entry.equals(other)` compares keys and values; identity comparison is a bug.
- **Records** auto-generate `equals` and `hashCode` over all their components. Identity-based comparison of records is almost always wrong. `record Money(long cents, Currency c)` — two `Money(100, USD)` instances are *equal* but not *identical*.

A common interview question: *"Are records cached?"* No. `new Money(100, USD)` and `new Money(100, USD)` are two distinct objects with `equals` returning `true`. Future Java (Project Valhalla, value classes) may permit JVM-level deduplication of identity-free values, at which point identity stops being a meaningful question — see `optimize.md`.

---

## 12. Anti-patterns and "fake identity"

- **The intern-everything cache.** Calling `String.intern()` on every string from the network. The pool grows without bound. Use a *bounded* `Map<String, String>` (Caffeine, Guava) if you want canonicalisation with eviction.
- **`identityHashCode` as a hash function.** Tempting (no collisions for distinct objects), but the value isn't deterministic across JVM runs. Don't persist `identityHashCode` to disk, log files, distributed caches, or any cross-process comparison. Use a content-based hash (`md5`, `sha`, content `hashCode`) for those.
- **Using `==` "because it's faster".** For one comparison, `==` is one instruction. For correct equality, `.equals` is the contract. Saving a nanosecond by getting the wrong answer is not an optimisation.
- **Deserialised singletons compared with `==`.** Covered in §6 — `readResolve` or enum, otherwise the singleton lie shows up post-restore.
- **Identity through reflection.** `Field.get` and `Method.invoke` return whatever the field/method has — they don't intern, don't dedupe, don't promise identity. Reflective callers must use `.equals` like everyone else.

---

## 13. When to introduce identity into a previously equality-based design

The conversion is rare but real. Triggers:

- **You discover your `equals` contract is broken** (mutable keys in a `HashMap`, inheritance + `equals` symmetry violations). Switching to `IdentityHashMap` *labels the contract* as "I track specific objects, not values" — sometimes the *right* domain answer.
- **You want lifetime-bound deduplication** of a stream of objects. An `IdentityHashSet` says "I've seen *this* object before"; useful in stream processors that emit each input once.
- **You add cycle detection** to a serialiser, deep-copier, equality-comparer, or printer that walks an object graph.
- **A `Class<?>`-keyed or `Thread`-keyed map** has been silently identity-based (because those types don't override `equals`); making the contract explicit with `IdentityHashMap` clarifies the code.

The conversion the other way — from identity to equality — usually happens when you introduce a value-object refactor (replace `Customer` references with `CustomerId` value records) and discover that downstream code was treating the reference as a key. Replace `IdentityHashMap<Customer, X>` with `HashMap<CustomerId, X>` and the bug-prone identity dependency is gone.

---

## 14. Quick rules

- [ ] Identity is a *contract*, not a leftover from refactoring. Make every `==` a deliberate choice.
- [ ] Cache keys: equality by default, identity when the input object's *identity itself* is what matters.
- [ ] Singletons must defend identity through serialisation (`readResolve`) or be enums.
- [ ] Classloader boundaries break identity for *every* type, including enums. Shared types must live in a shared parent classloader.
- [ ] `System.identityHashCode` is stable for an object's lifetime and lives in the object header on HotSpot.
- [ ] `WeakHashMap` is *equality*-keyed with weak refs; for *identity*-keyed weak refs, roll your own (`WeakReference` + `IdentityHashMap`).
- [ ] `HashMap.get` checks `==` before `.equals` — interning canonical keys takes the fast path.
- [ ] Records, `Optional`, `Map.Entry`, `BigDecimal`, `String` — every common "value" type has well-defined `.equals`; identity comparison is a bug.
- [ ] Avoid persisting `identityHashCode` to anything outside the current JVM run — it's not stable across processes.

---

## 15. What's next

| Topic                                                          | File              |
|----------------------------------------------------------------|-------------------|
| Code-review vocabulary, Sonar/ArchUnit, mentoring              | `professional.md`  |
| JLS §15.21, §5.1.7 boxing cache, identityHashCode spec         | `specification.md` |
| 10 buggy snippets, identity-vs-equality bug taxonomy           | `find-bug.md`      |
| Cost of `==` vs `.equals`, intern footprint, JIT fast-paths    | `optimize.md`      |
| 8 hands-on refactors and design exercises                      | `tasks.md`         |
| 20 interview Q&A                                               | `interview.md`     |

---

**Memorize this:** identity is a contract — when you commit to it, defend it across serialisation, classloaders, and concurrency. The string and integer caches are *implementation*, not contract; never let `==` rely on them. Enum constants, sentinel objects, and graph-walk visited-sets are the *legitimate* identity-comparison cases. Everywhere else, `.equals()` (or `Objects.equals`) is the contract and the only safe choice.
