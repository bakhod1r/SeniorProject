# Object Identity vs Equality — Find the Bug

> 10 buggy snippets, each illustrating a silent identity-vs-equality defect that compiles, passes the developer's test, and only breaks under specific production conditions: data from a non-pooled source, integer boundary, deserialised singleton, classloader split, identity-keyed map with logical-equality keys. For each: read the code, locate the contract mismatch, identify the *runtime symptom*, and write the fix.

---

## Bug 1 — Two customer IDs compared with `==`

```java
public final class OrderLookup {
    private final OrderRepository repo;

    public List<Order> ordersForCustomer(String customerId) {
        List<Order> all = repo.findAll();
        List<Order> result = new ArrayList<>();
        for (Order o : all) {
            if (o.customerId() == customerId) {            // (*)
                result.add(o);
            }
        }
        return result;
    }
}
```

The class has a unit test with hard-coded customer IDs that pass `==` (string pool coincidence). A second test, also passing literals, also succeeds. The class ships.

**Symptom.** In production, `customerId` arrives via an HTTP query parameter. `request.getParameter("customerId")` returns a fresh `String` object. `Order.customerId()` returns the value stored on the `Order`, also a fresh string (loaded from the database). Line `(*)` compares two distinct objects with equal content; `==` returns `false`. The result list is empty for *every* request. No exception, no log line — customer queries silently return zero orders, and the support team thinks "the new release deleted everyone's orders".

```
[INFO]  GET /customers/U-42/orders -> 200 OK  (0 results)
[INFO]  GET /customers/U-42/orders -> 200 OK  (0 results)
[INFO]  GET /customers/U-42/orders -> 200 OK  (0 results)
```

**Violation.** Reference equality (`==`) used where value equality (`.equals`) was meant. The bug works only when *both* operands happen to be the same pooled string — never in a real request path.

**Fix.** Use `.equals` (with null-safety) and let the standard library do the work for you:

```java
public List<Order> ordersForCustomer(String customerId) {
    Objects.requireNonNull(customerId);
    return repo.findAll().stream()
               .filter(o -> customerId.equals(o.customerId()))
               .toList();
}
```

`customerId.equals(o.customerId())` reads the value comparison. `customerId` on the left guarantees the receiver is non-null (asserted at entry). For a wider null-tolerance, `Objects.equals(customerId, o.customerId())` instead.

The deeper fix: don't filter in Java if you can filter in SQL — `repo.findByCustomerId(customerId)` avoids the loop entirely.

---

## Bug 2 — Integer cache boundary

```java
public final class CouponRedemption {
    public boolean isFirstUsage(Integer userId, Integer couponCode) {
        return userId == couponCode;       // (*)
    }
}

// caller
boolean fresh = redemption.isFirstUsage(
    request.userId(),
    coupon.code());
```

The test does `redemption.isFirstUsage(7, 7)` — both inside the cache, both pooled, `==` returns `true`. Passes. The class ships.

**Symptom.** Production user IDs are 6-digit numbers. `Integer.valueOf(421337) == Integer.valueOf(421337)` is `false` — these allocate fresh boxes. The method returns `false` for any pair of user IDs over 127. The check that ought to be "is the user ID the same as the coupon code" never fires. Coupons that should be redeemed once per user are redeemed unlimited times.

Worse, the test is *not* representative. Small numbers cache; large numbers don't. The developer would have to remember to test with at least one number above 127 to notice.

**Violation.** Identity comparison on boxed integers. The Integer cache (JLS §5.1.7) coincidentally makes `==` work inside `-128..127` and fail outside. Code reviewed under the small-number assumption silently breaks once production data is bigger.

**Fix.**

```java
public boolean isFirstUsage(Integer userId, Integer couponCode) {
    return Objects.equals(userId, couponCode);
}
```

Or, if both parameters are guaranteed non-null:

```java
public boolean isFirstUsage(int userId, int couponCode) {
    return userId == couponCode;
}
```

Switch to primitive parameters when nullity isn't part of the contract — `==` on primitives is value comparison and is the right tool. This also avoids the *autoboxing-at-call-site* tax in hot paths.

---

## Bug 3 — Boolean comparison with `==`

```java
public final class FeatureFlagCheck {
    private final Map<String, Boolean> flags = new ConcurrentHashMap<>();

    public boolean isFlagEnabled(String name, Boolean defaultValue) {
        Boolean current = flags.get(name);
        if (current == defaultValue) return defaultValue;  // (*)
        return current != null ? current : defaultValue;
    }
}
```

`Boolean` has exactly two non-null instances: `Boolean.TRUE` and `Boolean.FALSE`. Autoboxing of `true`/`false` always returns those singletons (JLS §5.1.7). So *if* both sides are autoboxed booleans, `==` happens to work. The trap is that *the caller passes `Boolean.valueOf(boolean)`*, which is the same singleton; or *the caller passes `new Boolean(true)`* (deprecated since Java 9, removed in Java 16), which is a *fresh object*.

**Symptom.** On a JVM with the legacy `new Boolean(true)` constructor still in use, `current == defaultValue` is `false` even when both are logically `true`. The method returns `false` for an enabled feature flag. A subset of code paths bypass the flag check. Bug discovered by a customer who reports that a feature is "intermittent" — it's actually flipped on the small set of test/dev paths that still use `new Boolean(...)`.

In modern code (Java 16+), the bug is harder to trigger because `new Boolean(...)` is gone — but Reflection (`Boolean.class.getDeclaredConstructor(boolean.class).newInstance(true)`) still creates fresh instances. Some XML / JSON libraries that deserialise into `Boolean` may also bypass the cache.

**Violation.** Identity comparison on a wrapper type. Even for `Boolean`, which has a JVM-guaranteed singleton for the autoboxed cases, `==` is not safe — *any* fresh object created via reflection or non-standard parsing breaks the singleton.

**Fix.**

```java
public boolean isFlagEnabled(String name, Boolean defaultValue) {
    Boolean current = flags.get(name);
    return current != null ? current : Boolean.TRUE.equals(defaultValue);
}
```

Or unbox explicitly:

```java
public boolean isFlagEnabled(String name, boolean defaultValue) {
    Boolean current = flags.get(name);
    return current != null ? current : defaultValue;
}
```

Primitive parameter, primitive return — no Boolean identity question at all. The trap simply doesn't exist.

---

## Bug 4 — Intern-pool pollution from user input

```java
public final class SessionRegistry {
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    public Session register(String userIdRaw) {
        String userId = userIdRaw.intern();         // (*) cache the canonical key
        return sessions.computeIfAbsent(userId, Session::new);
    }
}
```

The developer's reasoning: "Interning the key makes `HashMap.get` use the `==` fast path; performance win." For a fixed set of well-known keys, this would be correct. For *arbitrary user input*, it's a disaster.

**Symptom.** The string pool lives on the heap (since Java 7) but is *never garbage collected* — interned strings live until the JVM exits. After the service runs for a week, the pool holds millions of unique user IDs (UUIDs, session tokens, randomly-generated keys). Heap usage climbs; `-XX:StringTableSize=...` warnings appear; old-gen GC time triples.

```
[INFO] StringTable statistics:
   Number of buckets       :     60013
   Average bucket size     :    47.2
   Variance of bucket size :   149.8
   Std. dev. of bucket size:    12.2
   Maximum bucket size     :       89
   Number of entries       :   2,835,200    # was 60,000 last week
```

Eventually, the JVM exits with `OutOfMemoryError: GC overhead limit exceeded`. The fix isn't obvious from a stack trace; you have to know to look at `jcmd <pid> VM.stringtable`.

**Violation.** Interning a stream of unbounded values. The string pool's contract is "the JVM keeps these alive forever". Don't push arbitrary input into it.

**Fix.** Use a regular `HashMap` (or `ConcurrentHashMap`) for the cache; *do not* intern.

```java
public Session register(String userId) {
    return sessions.computeIfAbsent(userId, Session::new);
}
```

`computeIfAbsent` uses `.equals` + `.hashCode` for lookup. The lookup is one `.hashCode` call (fast for `String`) and one `.equals` call (fast on a hash-table hit). The `==` fast path inside `HashMap.get` still fires on the *exact* string instance you originally put in, which is the typical case for a session that gets read multiple times within the same request.

If you really want canonical-key behaviour, use a bounded cache (Caffeine, Guava `CacheBuilder`) with eviction.

---

## Bug 5 — `BigDecimal.equals` and the silent monetary bug

```java
public boolean isTotalCorrect(BigDecimal expected, BigDecimal actual) {
    return expected.equals(actual);            // (*)
}

// caller:
boolean ok = isTotalCorrect(new BigDecimal("100.00"),
                            new BigDecimal("100.0"));
```

The test (`isTotalCorrect("100.00", "100.0")`) was written against integers (`100` and `100`) and passed. The class shipped.

**Symptom.** In production, totals come from different sources. The order subsystem computes totals to two decimal places (`100.00`); the legacy ledger computes them to one decimal place (`100.0`). Both represent the same amount of money. `expected.equals(actual)` returns `false` because `BigDecimal.equals` considers *scale* as well as value. The reconciliation job that runs nightly flags thousands of "mismatched totals" — but they're not actually mismatched.

```
[WARN] Order ORD-2026-0114: expected 100.00, got 100.0 — TOTAL MISMATCH
[WARN] Order ORD-2026-0115: expected 50.00,  got 50.0  — TOTAL MISMATCH
[WARN] Order ORD-2026-0116: expected 75.00,  got 75.0  — TOTAL MISMATCH
```

**Violation.** This is not an identity-vs-equality bug per se — both sides go through `.equals`. But it's a sibling: the *type's* notion of equality (`BigDecimal.equals` = value AND scale) is narrower than the *domain's* notion (same amount of money). The reviewer who replaced `==` with `.equals` thinking "now it's correct" introduced the bug.

**Fix.** Use `compareTo(...) == 0` for numerical equality of `BigDecimal`:

```java
public boolean isTotalCorrect(BigDecimal expected, BigDecimal actual) {
    return expected.compareTo(actual) == 0;
}
```

Or normalise the scale before comparing:

```java
return expected.stripTrailingZeros().equals(actual.stripTrailingZeros());
```

The general rule: when wrapping a value type into a domain comparison, check the type's `equals` semantics. `BigDecimal`, `URI`, `Pattern`, and a handful of others have surprising `equals` definitions. See [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/) for the broader contract.

---

## Bug 6 — `IdentityHashMap` for logical equality keys

```java
public final class PriceCache {
    private final Map<Product, Money> prices =
        new IdentityHashMap<>();              // (*)

    public Money priceOf(Product p) {
        Money cached = prices.get(p);
        if (cached != null) return cached;
        Money fresh = computePrice(p);
        prices.put(p, fresh);
        return fresh;
    }
}
```

The developer chose `IdentityHashMap` because it's "faster" and "avoids equality bugs". `Product` is a record (`record Product(String sku, String name)`), so `.equals` is auto-generated and correct.

**Symptom.** Every cache lookup misses. `Product` is reconstructed for each request from the database. A fresh `new Product("SKU-1", "Widget")` is a different Java object than the one cached on the previous request — `IdentityHashMap`'s `==` returns `false` — the cache returns `null` — `computePrice` runs every time. The cache hit rate is `0%`. Performance is identical to no cache at all, but the team thinks the cache is working ("we put entries in it!"). Memory grows because cached entries are never reused.

```
[DEBUG] cache.size = 1421     # all unique objects, none reused
[DEBUG] cache.size = 1422
[DEBUG] cache.size = 1423
```

**Violation.** `IdentityHashMap` is the wrong contract here. The cache wants "same product (by `equals`)" but is implemented as "same Java object (by `==`)". `Product`'s auto-generated `equals` exists precisely so two reconstructions of `Product("SKU-1", "Widget")` are considered the same key.

**Fix.**

```java
private final Map<Product, Money> prices = new ConcurrentHashMap<>();
```

`HashMap`/`ConcurrentHashMap` uses `.equals` + `.hashCode`. The record's auto-generated `equals`/`hashCode` make the cache work correctly. The `IdentityHashMap` was a misapplied optimisation.

For a stronger fix, cache by `Product.sku()` instead of `Product` itself:

```java
private final Map<String, Money> prices = new ConcurrentHashMap<>();
public Money priceOf(Product p) {
    return prices.computeIfAbsent(p.sku(), sku -> computePrice(p));
}
```

This decouples the cache from the `Product` type's lifecycle — neat in long-running services.

---

## Bug 7 — `switch` on `Integer` autoboxing

```java
public final class HttpStatusHandler {
    private static final Integer OK            = 200;
    private static final Integer NOT_FOUND     = 404;
    private static final Integer SERVER_ERROR  = 500;

    public Response handle(Integer status, Body body) {
        if (status == OK)            return Response.ok(body);
        if (status == NOT_FOUND)     return Response.notFound();
        if (status == SERVER_ERROR)  return Response.internalError();
        return Response.unknown(status);
    }
}
```

The test uses `handle(200, ...)` — `Integer.valueOf(200)` against `OK = 200`. `200` is *outside* the cache, so both autoboxes produce *different* `Integer` objects; `==` is `false`. *But* the test was the developer's first version, with `handle(100, ...)` — `100` is in the cache, `==` returns `true`, the test passed, the snippet was generalised to other codes.

**Symptom.** Every status code over 127 (`200`, `404`, `500`) falls through to `Response.unknown(status)`. Every status code under 128 (`100` Continue, `101` Switching Protocols, `127` undefined) is handled correctly. The team puzzles for a day over why most HTTP responses are tagged `unknown`.

The constants `OK = 200`, etc. *are* cached as fields, but `status` comes from outside — a parameter, an HTTP library, a deserialised JSON — and is allocated fresh.

**Violation.** Identity comparison on `Integer`. The `static final` constants don't help — they're cached on the class side, but the parameter is a separate object.

**Fix.** Compare with `intValue` or use a primitive `int`:

```java
public Response handle(int status, Body body) {
    return switch (status) {
        case 200 -> Response.ok(body);
        case 404 -> Response.notFound();
        case 500 -> Response.internalError();
        default  -> Response.unknown(status);
    };
}
```

`switch` on `int` is the right tool. The pattern-matching `switch` (Java 21+) over an enum would be even better if HTTP statuses are modelled as `enum HttpStatus { OK, NOT_FOUND, ... }` — then the comparison is enum-identity, which `==` handles correctly and the compiler verifies exhaustiveness.

---

## Bug 8 — `==` is preferred for enums, but the team used `.equals`

```java
public final class OrderStateMachine {
    public boolean canTransition(OrderStatus from, OrderStatus to) {
        if (from.equals(OrderStatus.OPEN) && to.equals(OrderStatus.PACKED)) return true;
        if (from.equals(OrderStatus.PACKED) && to.equals(OrderStatus.SHIPPED)) return true;
        if (from.equals(OrderStatus.SHIPPED) && to.equals(OrderStatus.DELIVERED)) return true;
        return false;
    }
}
```

This isn't strictly a bug — `from.equals(OrderStatus.OPEN)` returns the same value as `from == OrderStatus.OPEN`. But it's a *code smell* that a code reviewer should flag.

**Symptom.** Two:

1. **NPE on null `from`.** `null.equals(OrderStatus.OPEN)` throws. With `==`, `null == OrderStatus.OPEN` is `false` cleanly.
2. **Performance**: `.equals` is `invokevirtual`; `==` is `if_acmpeq`. For an enum, the spec guarantees one instance per name, so `==` always returns the right answer.

The first is the real bug. A caller that passes a `null` from-state because the order is brand-new gets:

```
java.lang.NullPointerException
    at com.acme.OrderStateMachine.canTransition(OrderStateMachine.java:3)
```

**Violation.** Subtle: using `.equals` on enums *isn't* identity-vs-equality misuse — both work — but it's the wrong idiom. Senior reviewers and `Effective Java` Item 4 recommend `==` for enums precisely for the NPE-safety and clarity.

**Fix.**

```java
public boolean canTransition(OrderStatus from, OrderStatus to) {
    if (from == OrderStatus.OPEN     && to == OrderStatus.PACKED)    return true;
    if (from == OrderStatus.PACKED   && to == OrderStatus.SHIPPED)   return true;
    if (from == OrderStatus.SHIPPED  && to == OrderStatus.DELIVERED) return true;
    return false;
}
```

Or, better, a sealed-type / table-driven transition map. But the `==`-on-enums style is the senior idiom for the simple version.

---

## Bug 9 — Thread-local cache identity drift

```java
public final class ConnectionPool {
    private static final ThreadLocal<Connection> LOCAL = ThreadLocal.withInitial(
        ConnectionPool::newConnection);

    private static final Set<Connection> tracked =
        Collections.synchronizedSet(new HashSet<>());     // (*)

    public static Connection get() {
        Connection c = LOCAL.get();
        if (!tracked.contains(c)) {                       // (**)
            tracked.add(c);
        }
        return c;
    }
}
```

The intent: track every `Connection` that has been handed out, so a metrics job can count them. `Connection` is a custom class without a custom `.equals` — it inherits `Object.equals`, which is identity.

**Symptom.** The code *works*. It tracks every distinct `Connection` object. But the tracking is *implicitly identity-based*, not by explicit declaration. The next maintainer sees `HashSet<Connection>` and thinks "value-based set", refactors `Connection` to add an `.equals` that compares by underlying socket, and suddenly the tracker collapses: two `Connection` objects sharing the same socket count as one, the count is wrong, the metric is wrong.

The bug doesn't show up immediately — it shows up the day someone "fixes" `Connection.equals`.

**Violation.** Implicit identity contract that isn't named in the code. The set's behaviour depends on `Connection` *not* overriding `equals`. The dependency is invisible to future maintainers.

**Fix.** Make the identity contract *explicit*:

```java
private static final Set<Connection> tracked =
    Collections.synchronizedSet(
        Collections.newSetFromMap(new IdentityHashMap<>()));
```

Now the type system documents the intent. A future maintainer who reads `IdentityHashMap`-backed set knows the contract is identity-by-object, not equality-by-content. The refactor that adds `Connection.equals` doesn't break the tracker.

For documentation, add a comment too:

```java
// identity by design: track each distinct Connection instance, regardless
// of whether two Connections happen to share a socket
```

---

## Bug 10 — Deserialised singleton with `==`

```java
public final class FeatureFlagRegistry implements Serializable {
    public static final FeatureFlagRegistry INSTANCE = new FeatureFlagRegistry();
    private FeatureFlagRegistry() {}

    public boolean isEnabled(String name) { /* ... */ }
}

public boolean shouldUse(String feature, FeatureFlagRegistry registry) {
    if (registry == FeatureFlagRegistry.INSTANCE) {          // (*)
        return registry.isEnabled(feature);
    }
    throw new IllegalArgumentException("Use the canonical FeatureFlagRegistry");
}
```

The singleton pattern is wired correctly: private constructor, static field, `==` comparison. The test passes because no serialisation happens during the test.

**Symptom.** A different team caches the `FeatureFlagRegistry` to a distributed cache (Redis) using Java serialisation. When the registry is read back on another node, `ObjectInputStream` allocates a *fresh* `FeatureFlagRegistry` instance via `Unsafe.allocateInstance`, bypassing the private constructor entirely. Now there are *two* registries: `INSTANCE` (original) and the deserialised copy.

Code that compares with `==` against the canonical `INSTANCE` rejects the deserialised registry with `IllegalArgumentException`. Half the cluster works; the half that touched Redis explodes:

```
java.lang.IllegalArgumentException: Use the canonical FeatureFlagRegistry
    at com.acme.FeatureGate.shouldUse(FeatureGate.java:5)
    at com.acme.OrderProcessor.run(OrderProcessor.java:42)
```

The bug only appears under serialisation — local tests, integration tests, single-node tests all pass.

**Violation.** Identity contract violated by deserialisation. The `==` against `INSTANCE` assumes a single instance, but the deserialiser allocates more without consulting the singleton pattern.

**Fix.** Either defend the singleton or switch to an enum (the recommended idiom):

```java
// Option 1 — readResolve
private Object readResolve() {
    return INSTANCE;          // substitute the canonical instance after deserialise
}
```

`ObjectInputStream` calls `readResolve` if the class defines it, and uses the returned object instead of the freshly allocated one. After this, `deserialise(serialise(INSTANCE)) == INSTANCE` is `true`.

```java
// Option 2 — enum
public enum FeatureFlagRegistry {
    INSTANCE;
    public boolean isEnabled(String name) { /* ... */ }
}
```

Enums get the right deserialisation behaviour for free (JLS §8.9). Joshua Bloch's *Effective Java* Item 3 recommends this as "the best way to implement a singleton" precisely because it handles serialisation, reflection, and cloning without any extra work.

---

## Pattern summary

| Bug type                                              | What to look for                                              |
|-------------------------------------------------------|--------------------------------------------------------------|
| `==` on `String` (Bug 1)                              | String literal works in test, fresh object from DB/HTTP fails |
| Wrapper `==` outside cache (Bug 2)                    | Test uses small numbers; production has IDs over 127         |
| `Boolean ==` with reflective/legacy construction (Bug 3) | Subset of code paths bypass the value comparison             |
| Intern-pool pollution (Bug 4)                         | `s.intern()` on user input; heap grows, StringTable balloons  |
| `BigDecimal.equals` for money (Bug 5)                 | False mismatches when scale differs                          |
| `IdentityHashMap` for logical keys (Bug 6)            | Cache hit rate is 0%, memory grows                           |
| `Integer ==` switch-like dispatch (Bug 7)             | Codes < 128 work, codes >= 128 fall through to default       |
| `.equals` on enums (Bug 8)                            | NPE when one side is null, otherwise OK                      |
| Implicit identity in `HashSet` (Bug 9)                | Refactor that adds `.equals` to the element type breaks it   |
| Deserialised singleton (Bug 10)                       | `IllegalArgumentException`, only across nodes / serialisation  |

These violations rarely produce compile errors. The Java compiler will not warn about `==` on reference types; the IDE inspections must be turned on; the static analysers must be wired (Sonar `S4973`, Error Prone `ReferenceEquality`, SpotBugs `ES_COMPARING_STRINGS_WITH_EQ`). See [`professional.md`](./professional.md) for tooling. Without tooling, identity-vs-equality bugs ship; with tooling, they're caught at compile time.

---

## How to debug an identity-vs-equality bug

When you suspect identity vs equality:

1. **Add `System.identityHashCode(x)` to your logs.** If two values are `equals` but have different identity hashes, they're distinct Java objects — and any code comparing them with `==` is wrong.
2. **Diff the object graphs.** `System.out.println(obj1 + " | " + obj2)` and `System.out.println(System.identityHashCode(obj1) + " | " + System.identityHashCode(obj2))`. The first should match (value); the second should *not* match for two distinct allocations.
3. **Grep for `==` near the suspicious type.** Lines like `if (s == ` for `String s`, or `== INSTANCE` for any singleton, are prime suspects.
4. **Check the static analyser report.** Sonar S4973, SpotBugs ES_COMPARING_STRINGS_WITH_EQ, Error Prone ReferenceEquality — if any are configured, the bug usually has a finding logged.
5. **For collection bugs (Bugs 4, 6, 9)**, log the map's `size()` after each insertion. Unbounded growth = wrong contract; zero hit rate = wrong contract.
6. **For singleton bugs (Bug 10)**, log `System.identityHashCode(INSTANCE)` at startup on every JVM node. Identity hashes differ across JVMs naturally, but within one JVM they should be stable. If you see different hashes for "the same" singleton on the same node, you have multiple instances.

---

**Memorize this:** identity-vs-equality bugs are *silent*. They don't throw, they don't log, they just return the wrong answer. Train your eye on `==` between two reference variables that *should* be value-equal: that's the canonical defect. Train your eye on `IdentityHashMap` (and `Collections.newSetFromMap(new IdentityHashMap<>())`) used for logical keys: that's the canonical mis-optimisation. Train your eye on singletons that participate in serialisation without `readResolve`: that's the canonical broken-by-deserialise defect. Run Sonar, Error Prone, and SpotBugs to catch the mechanical cases. The judgement cases — identity *intentionally* — get commented and reviewed by humans.
