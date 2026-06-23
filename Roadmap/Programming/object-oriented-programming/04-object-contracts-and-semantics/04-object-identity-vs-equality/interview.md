# Object Identity vs Equality — Interview Q&A

20 questions covering identity vs equality from first principles to spec hooks: definitions, the Integer cache, the string pool, classloader effects, sentinel patterns, identity collections, and common bugs.

---

## Q1. What's the difference between `==` and `.equals()` in Java?

`==` is the equality operator. On *primitive* operands (`int`, `long`, `boolean`, etc.) it is value comparison. On *reference* operands it is **identity comparison** — `true` only if both references point to the same Java object. `.equals()` is a method defined on `Object`, defaulting to identity, that classes typically override to express **value (logical) equality**. `String.equals` compares characters; `Integer.equals` compares the wrapped int; `BigDecimal.equals` compares value *and* scale; a record's auto-generated `equals` compares all components.

The classic trap: `String a = "abc"; String b = new String("abc");` — `a == b` is `false` (different objects), `a.equals(b)` is `true` (same characters).

**Follow-up:** "Which one would you use to compare two `LocalDate` values?" `.equals` — or, more idiomatically, `LocalDate.isEqual`, but `.equals` is correct.

---

## Q2. Why does `Integer.valueOf(127) == Integer.valueOf(127)` return `true` but `Integer.valueOf(128) == Integer.valueOf(128)` return `false`?

JLS §5.1.7 (Boxing Conversion) mandates a cache for `Integer` boxes in the range `-128..127`. Calls to `Integer.valueOf(int)` return the cached instance for any value in this range — so two such calls return the *same Java object*, and `==` (which is reference identity) is `true`. Outside the range, every call allocates a fresh `Integer` object; two such allocations are *different objects*, and `==` is `false`.

The same applies to `Byte` (full range), `Short` (`-128..127`), `Long` (`-128..127`), `Character` (`0..127`). `Boolean` has just `TRUE` and `FALSE`. `Float` and `Double` are *not* cached.

**Trap:** "Why does Java cache integers?" — performance. Loop counters, status codes, small numbers dominate; caching saves allocations.

**Follow-up:** "Can I configure the cache?" Yes — `-XX:AutoBoxCacheMax=N` raises the positive upper bound. The negative lower bound is fixed at `-128`. Don't write code that *requires* the extended cache; it's a JVM knob, not a contract.

---

## Q3. Why is comparing strings with `==` sometimes correct and sometimes wrong?

Java interns string literals (JLS §3.10.5). Every compile-time `String` literal goes into the JVM-wide string pool, and the same literal across different files refers to the same `String` object. So `"abc" == "abc"` is `true` because both literals share the pooled instance.

But strings built at runtime — from `new String(...)`, concatenation of non-constants, `String.format`, `Reader.readLine`, JSON parsing, database rows — are *not* in the pool. Two such strings with equal content are distinct objects; `==` returns `false`.

The bug surfaces when test data is hard-coded literals (works) and production data comes from any non-literal source (fails). The cure: use `.equals` (or `Objects.equals`) everywhere except `null` checks.

**Trap:** "But I see `"abc" == s` in some code." That's still `==` between two references; the `"abc"` happens to be pooled. If `s` is also pooled (e.g., `s = otherString.intern()`), `==` returns `true`. Otherwise, it doesn't. The code is brittle.

---

## Q4. What does `System.identityHashCode(obj)` return?

It returns the hash code that `obj.hashCode()` would return *if* `obj`'s class hadn't overridden `hashCode`. So for a `String` (which overrides `hashCode`), `s.hashCode()` is content-based, but `System.identityHashCode(s)` is the identity-based hash. For a class that doesn't override, both return the same value.

The identity hash is computed lazily on first call, stored in the object's mark word (on HotSpot), and stable for the object's lifetime. `System.identityHashCode(null)` returns `0` by spec.

`IdentityHashMap` uses `System.identityHashCode` as its hash function — combined with `==` for key equality, it gives "same Java object" lookup semantics.

**Follow-up:** "Is the identity hash unique?" No — it's a 32-bit value; collisions are rare but possible. Don't persist it across JVM runs; the value isn't reproducible.

---

## Q5. When should you use `==` instead of `.equals()`?

Five legitimate cases:

1. **`null` checks** — `if (x == null)`. `.equals` would throw NPE.
2. **Enum constants** — `if (status == OrderStatus.OPEN)`. Enums are JVM singletons (JLS §8.9); `==` is faster, NPE-safe (on the right side at least), and the idiomatic style. *Effective Java* Item 4 recommends it.
3. **Sentinel objects** — a library defines `public static final Object MISSING = new Object();` and asks you to check `if (result == MISSING)`. Identity is the contract.
4. **Identity-based collections** — `IdentityHashMap` lookups are inherently `==`-based.
5. **Cycle detection in object graphs** — two equal nodes are still distinct vertices; you must compare by identity.

Outside these cases, `.equals` (or `Objects.equals`) is the right tool.

**Trap:** "What about performance?" — `==` is faster than `.equals` by a few nanoseconds, but modern JITs inline `.equals` to nearly the same cost. Don't trade correctness for nanoseconds.

---

## Q6. What's `Objects.equals` and when should you prefer it over `.equals`?

`java.util.Objects.equals(a, b)` (since Java 7) is a null-safe wrapper:

```java
public static boolean equals(Object a, Object b) {
    return (a == b) || (a != null && a.equals(b));
}
```

It returns `true` if both are `null`, `false` if exactly one is `null`, and otherwise delegates to `a.equals(b)`. It's the default equality call in modern Java when either side could be `null`.

`a.equals(b)` is fine if `a` is *guaranteed* non-null (e.g., a literal or after `Objects.requireNonNull`). `Objects.equals(a, b)` is fine even if both are unknown. The two-line static method also gets a fast-path `==` check for free.

**Follow-up:** "What's the performance overhead?" Negligible — the JIT inlines `Objects.equals` to the same code as the inlined fast-path inside `String.equals`.

---

## Q7. Are records `equals` and `hashCode` always content-based?

Yes. Records (JLS §8.10, JEP 395) auto-generate `equals` and `hashCode` based on all components. The generated `equals` compares each component: primitives with `==`, references with `.equals`. The generated `hashCode` combines per-component hash codes.

You *can* override the generated `equals` (records permit it), but that's almost always a mistake. The auto-generation is correct by construction — symmetric, transitive, consistent, reflexive. Overriding usually introduces a bug.

One subtlety: if a record component is an `Object[]` or `byte[]`, the auto-generated `equals` uses `Object.equals` for the array, which is *identity*. Two records with equal-content arrays would compare unequal. If array fields are part of equality, override `equals` and use `Arrays.equals` (or use `List` instead of an array).

**Trap:** "Records use `==` internally?" — only for primitive components and for the `this == anObject` identity fast path. Reference components use `.equals`.

---

## Q8. What's the contract guarantee for enum constants?

JLS §8.9 guarantees that an `enum` class has no instances other than those defined by its enum constants — one per name, per JVM (per classloader, more precisely). So `Status.OPEN == anotherStatus` is reliable for any `anotherStatus` returned by code that uses the same `Status` enum.

The JVM enforces this:
- Reflection-based construction (`Constructor.newInstance` on an enum class) throws `IllegalArgumentException`.
- Deserialisation resolves enum constants by name via `Enum.valueOf` — no fresh allocation.
- `clone()` is final on `Enum`, returning the same instance.

The classloader caveat: two classloaders both loading `OrderStatus` produce two *different* `OrderStatus` classes and two *different* sets of constants. Cross-classloader comparison of `OrderStatus.OPEN` with `==` fails. In well-architected systems, enum types live in a shared parent classloader.

---

## Q9. Why is `Boolean` comparison with `==` subtly wrong?

Autoboxing always returns `Boolean.TRUE` or `Boolean.FALSE` — the two static singletons. So `Boolean b = true; Boolean c = true; b == c` is `true`. The same applies to `Boolean.valueOf(boolean)`.

But fresh `Boolean` objects *can* exist through other paths: `new Boolean(true)` (deprecated since Java 9, removed in Java 16), `Constructor.newInstance` via reflection, some JSON deserialisers (Jackson respects the singletons; Gson may not in older versions). If any of these is in play, `==` between booleans can return `false`.

In modern code (Java 16+), the bug is hard to trigger because `new Boolean(...)` is gone. But the contract is still "use `.equals` or `Objects.equals` on wrappers" — don't depend on the singleton.

**Follow-up:** "What about `Boolean.TRUE` and `Boolean.FALSE` literally?" Those are the canonical singletons; comparing `b == Boolean.TRUE` is fine if you know `b` came from autoboxing. But the discipline of "always `.equals` on wrappers" doesn't reward exception-making.

---

## Q10. What is `IdentityHashMap` and when should you use it?

`IdentityHashMap` is a `Map` implementation that uses `==` for key comparison and `System.identityHashCode` for hashing — both *identity*-based instead of *equality*-based. Two equal-but-distinct keys are treated as *separate* entries; only the same Java object is treated as the same key.

Legitimate uses:

- **Cycle detection in object graphs** (the canonical example — Jackson uses it for serialisation).
- **Per-instance tracking** where the object's identity matters more than its content — e.g., `Map<Thread, ConnectionState>`.
- **Visitor patterns** where you mark each visited node.

Misuses:

- **General-purpose caching** keyed by domain objects — usually you want value equality, not identity.
- **Token registries** keyed by `Session` records — different `Session` reconstructions are equal by content but distinct by identity; identity-based caching misses every time.

`IdentityHashMap` is also slightly faster than `HashMap` for lookups (no `.equals` call), but speed is irrelevant if the contract is wrong.

---

## Q11. What's the difference between `String.intern()` and `String` pool?

The **string pool** is a JVM-wide hash table maintained by `java.lang.String`. Compile-time string literals are automatically interned on class load (JLS §3.10.5) — so `"abc" == "abc"` across files is `true`.

**`String.intern()`** is the API to add a runtime-built string to the pool. It returns the canonical pooled instance: if the pool already contains a string `.equals` to the argument, return that; otherwise add this string and return it.

The contract: `s.intern() == t.intern()` iff `s.equals(t)`. So `intern()` enables `==` comparison of strings that came from non-literal sources.

The cost:

- Each `intern()` call is a pool lookup, ~50 ns warm.
- The pool is not garbage-collected — interned strings live until JVM exit.
- For unbounded inputs (user IDs, UUIDs), `intern()` leaks memory.

Use `intern()` for a *bounded* set of canonical keys (HTTP header names, XML namespaces, status codes), not for arbitrary input.

---

## Q12. Why is `BigDecimal.equals` a common pitfall?

`BigDecimal.equals(other)` returns `true` only if the two `BigDecimal`s have *both* the same numeric value *and* the same scale. So:

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00"))   // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00")) // 0
```

The scale-sensitive equality is a documented `BigDecimal` choice. For *numerical* equality, use `compareTo(other) == 0`, or normalise both sides with `stripTrailingZeros()` first.

This bites code that compares monetary totals from different sources (one computes to two decimals, another to one). Even though both sides went through `.equals`, the equality is narrower than the domain's notion of "same amount of money".

**Follow-up:** "Why isn't `BigDecimal.equals` value-only?" — Joshua Bloch's explanation: `BigDecimal` is used in contexts (database mapping, configuration) where scale carries meaning. Splitting the equality from `compareTo` lets both contracts coexist.

---

## Q13. What happens to a singleton across serialisation?

A naïve singleton (`public static final Foo INSTANCE = new Foo()`) does *not* survive deserialisation. `ObjectInputStream` allocates a fresh `Foo` object via `Unsafe`, bypassing the constructor. The deserialised object is `!=` to `INSTANCE`. Code that compares singletons with `==` now has two "singletons" coexisting.

Two fixes:

```java
// Option 1 — readResolve
private Object readResolve() {
    return INSTANCE;
}
```

`ObjectInputStream` calls `readResolve` after allocation; the returned object replaces the freshly built one. Identity is preserved.

```java
// Option 2 — enum singleton (recommended)
public enum Foo { INSTANCE; }
```

Enums get correct deserialisation by spec. *Effective Java* Item 3 calls this "the best way to implement a singleton" — handles serialisation, reflection, and cloning without effort.

Beyond serialisation, classloader splits also break singletons — see Q14.

---

## Q14. How do classloaders affect identity comparison?

Two classloaders loading the same `.class` file produce *two distinct* `Class<?>` objects, with two distinct static-field sets, two distinct enum-constant sets. Identity across classloader boundaries doesn't hold:

- `OrderStatus.OPEN` from classloader L1 is *not* `==` to `OrderStatus.OPEN` from L2.
- `Foo.INSTANCE` from L1 is *not* `==` to `Foo.INSTANCE` from L2.
- `instanceof Foo` (where `Foo` is loaded by L2) on an object created via L1's `Foo` class is `false`.

This is the canonical trap in plugin systems, OSGi, application servers. The cure: shared types (enums, interfaces, sentinel constants) live in a *shared parent classloader*; plugins use child classloaders for their private types. The hexagonal-architecture domain module is exactly this shared parent in modern systems.

**Follow-up:** "How do you debug this?" Log `obj.getClass().getClassLoader()` and `instanceof` results. When `obj instanceof X` is `false` but `obj.getClass().getName().equals(X.class.getName())`, you have a classloader split.

---

## Q15. Why might `==` between `String` constants work in one JVM and fail in another?

Two scenarios:

1. **Compile-time constants get pool-interned**, but only if the JLS recognises them as compile-time constants (`final String x = "abc"; final String y = "abc"; x == y` — true, both pool-interned). A non-final variable holding the same value is not necessarily pooled, depending on optimisation.
2. **Different JVMs may differ in how the pool is implemented** — pre-Java 7 the pool lived in PermGen with a fixed size; post-Java 7 in the regular heap. The pool's *contents* are stable per JVM session but not stable across JVM versions or across processes.

The bug: code that runs locally on the developer's JVM (with one pool state) passes; CI on another JVM version (with a different pool state) fails. The fix is the same — never use `==` on strings.

---

## Q16. How does `HashMap.get` interact with identity?

`HashMap.get` (and `put`) checks `==` *before* `.equals`. The inner condition is:

```java
if (e.hash == hash && ((k = e.key) == key || (key != null && key.equals(k))))
    return e;
```

The `(k = e.key) == key` short-circuits to `true` if the looked-up key is the *exact same object* as the stored key — `.equals` is never called.

This is why interning a canonical key (e.g., status names, HTTP header names) speeds up high-traffic map lookups: every probe takes the `==` fast path.

The same pattern exists in `LinkedHashMap`, `ConcurrentHashMap`, and `IdentityHashMap` (where `==` is the *only* check, never falling through to `.equals`).

---

## Q17. What's the difference between `WeakHashMap` and `IdentityHashMap`?

Different axes:

- `WeakHashMap` — equality-based keys (`.equals` + `.hashCode`), but keys are held via `WeakReference`. When the GC clears a key, the entry disappears.
- `IdentityHashMap` — identity-based keys (`==` + `System.identityHashCode`), strong references.

The combinations:

| Map                            | Key equality | Reference strength |
|--------------------------------|--------------|--------------------|
| `HashMap` / `ConcurrentHashMap` | `.equals`    | strong             |
| `WeakHashMap`                  | `.equals`    | weak               |
| `IdentityHashMap`              | `==`         | strong             |
| *(no JDK type)*                | `==`         | weak               |

For the last cell — identity + weak — you roll your own using `WeakReference` + `IdentityHashMap`, or use Guava's `MapMaker.weakKeys()`.

**Use case:** plugin/classloader caches that should free up entries when the plugin is unloaded — typically identity + weak.

---

## Q18. What's a sentinel object and how do you compare with it?

A sentinel is a single, pre-allocated marker object used to signal a state that doesn't have a natural representation among regular values. The canonical example:

```java
public static final Object NOT_FOUND = new Object();

Object result = lookup(key);
if (result == NOT_FOUND) { /* miss */ }
```

You compare with `==` because identity is the contract — there is exactly one `NOT_FOUND`, and equality on `Object` (without `.equals` override) would collapse to identity anyway.

Sentinels are useful when:

- `null` is a valid value (so it can't double as "missing").
- The state has no value (just a marker).
- You want a single instruction comparison (`if_acmpeq`) and branch prediction.

`Collections.emptyList()`, `Optional.empty()`, the array sentinel `OBJ_NOT_FOUND` inside `ConcurrentHashMap` — all sentinels. Document each with a comment to short-circuit the next reviewer's "use `.equals`" reflex.

**Trap:** "Why not use an enum sentinel?" Enums are the same idiom for *named* sentinels. `enum Marker { NOT_FOUND }` and `if (result == Marker.NOT_FOUND)` is equally valid; pick the style that reads better in context.

---

## Q19. What are the most common identity-vs-equality bugs in production?

In order of frequency:

1. **Strings compared with `==`** — works in test (literals are pooled), fails in production (data from DB/HTTP/JSON is non-pooled). The Sonar `S4973` violation.
2. **Wrappers compared with `==`** — works for values in `-128..127` (cached), fails outside. The `find-bug.md` §2 case.
3. **`IdentityHashMap` used for value-equality** — every lookup misses, cache hit rate is 0%, memory grows unboundedly.
4. **Deserialised singletons compared with `==`** — two "singletons" coexist after a round-trip through `ObjectInputStream`.
5. **`.equals` on enums** — works, but throws NPE if one side is `null`. The cure is `==`.

All five are mechanically detectable (Sonar, Error Prone, SpotBugs). Wire them into CI; they vanish.

---

## Q20. How does Project Valhalla change the identity-vs-equality story?

Project Valhalla introduces *value classes* (JEP 401, preview as of Java 23) — types that have *no identity*. For a value class:

- `==` is *defined* as value comparison (not identity).
- `IdentityHashMap` *rejects* value-class keys (or treats them as if they had implicit identity, depending on the spec).
- The JVM is free to dedupe instances — two `new Money(100, USD)` may be the same object behind the scenes, or different, with no observable difference.
- Allocation is essentially free; the value lives in registers, fits inline in arrays (`Money[]` is `[cents,curr,cents,curr,...]` not pointers).

For value classes, the identity-vs-equality question collapses: there is no identity to ask about. The question becomes "are these the same value?", and `==` is the right operator.

Existing types annotated with `@ValueBased` (`Optional`, `LocalDate`, `BigInteger`, etc.) are the spiritual predecessors: their Javadoc warns "do not rely on identity" because future JVMs may treat them as value classes.

The trajectory: identity will become the *exceptional* contract, value equality the default. The senior advice — "use `.equals` everywhere except identity contracts" — already aligns with this future.

**Follow-up:** "When does Valhalla ship?" Preview features in 2024–2026; final shipment dependent on JEP progress. Treat as imminent and shape your designs accordingly.

---

**Use this list:** rotate at least one question from each cluster: definition (Q1, Q5, Q6), spec mechanics (Q2, Q3, Q11), platform behaviours (Q4, Q14, Q15), collections (Q10, Q16, Q17), patterns (Q13, Q18), and direction (Q20). Strong candidates can articulate when identity is *the contract* (enums, sentinels, cycle detection) vs when it's an *accidental optimisation* (boxed integer cache, string pool) vs when it's a *bug* (everything else). The principle to memorise: `==` asks "same object?", `.equals` asks "same value?". For reference types, those questions are *almost always different*, and the second one is what you mean.
