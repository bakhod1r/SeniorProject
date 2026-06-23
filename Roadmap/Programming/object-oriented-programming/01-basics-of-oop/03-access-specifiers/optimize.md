# Access Specifiers — Optimize the Code

> 12 exercises where access modifier choices have measurable impact on performance, maintainability, or both. Numbers illustrative — confirm with JMH and your build pipeline.

---

## Optimization 1 — `final` class for JIT-friendly dispatch

**Slow (in tight loops):**

```java
public class PriceFormatter {
    public String format(long cents) { ... }
}

PriceFormatter f = new PriceFormatter();
for (long c : pricesArray) result.add(f.format(c));   // virtual dispatch every call
```

The JIT needs Class Hierarchy Analysis (CHA) to inline. If a subclass appears later, the compiled code is invalidated.

**Better:**

```java
public final class PriceFormatter { ... }
```

Now the JIT inlines without CHA dependency. Slightly faster; more importantly, the JIT decision is stable.

**Why.** `final` removes the "subclass might appear" speculation. Smaller wins per call (~ns), but no recompilation surprises. Free win if you weren't going to subclass anyway.

---

## Optimization 2 — Hide implementation classes via package-private

**Slow (process):**

Public class `RetryPolicyImpl` is exposed in your library. Two years later you want to rename it to `ExponentialBackoffPolicy`. Three customer projects depend on it. You publish a deprecation cycle, document the migration, ship a 2.0 with a breaking change. Six months of cleanup.

**Better:**

```java
package com.lib.api;
public interface RetryPolicy { ... }

package com.lib.internal;
final class ExponentialBackoffPolicy implements RetryPolicy { ... }
```

Customers see only `RetryPolicy`. Internally, you rename the impl, swap algorithms, add new ones — none breaks them.

**Why.** Maintenance cost of public API is *much* higher than implementation classes. Hiding implementation is the cheapest long-term performance optimization (developer time per release).

---

## Optimization 3 — Replace `setAccessible(true)` with `MethodHandle`

**Slow:**

```java
private static final Field FIELD;
static {
    try { FIELD = Account.class.getDeclaredField("balance"); FIELD.setAccessible(true); }
    catch (Exception e) { throw new ExceptionInInitializerError(e); }
}

public static long balanceOf(Account a) {
    try { return FIELD.getLong(a); } catch (Exception e) { throw new RuntimeException(e); }
}
```

Each call goes through `Field.get` reflection (with security check + boxing for primitives + exception handling).

**Better:**

```java
private static final VarHandle BALANCE;
static {
    try {
        var lookup = MethodHandles.privateLookupIn(Account.class, MethodHandles.lookup());
        BALANCE = lookup.findVarHandle(Account.class, "balance", long.class);
    } catch (Exception e) { throw new ExceptionInInitializerError(e); }
}

public static long balanceOf(Account a) { return (long) BALANCE.get(a); }
```

The JIT compiles `BALANCE.get(a)` as if it were a direct `getfield`. No boxing, no per-call reflection cost, no checked exceptions.

**Why.** ~10–100x faster on hot paths. Plus JPMS-compatible.

---

## Optimization 4 — Reduce class loading by hiding helpers

**Slow:**

```
com/example/PaymentService.class    (public)
com/example/PaymentValidator.class   (public)
com/example/RetryPolicy.class        (public)
com/example/TransactionLog.class     (public)
... 12 more classes
```

If `PaymentService` is the only entry point, but all the helpers are `public`, every consumer that imports the package brings in metadata for all 16 classes.

**Better:**

Make the helpers package-private. The compiler doesn't load classes that aren't referenced. Public API stays smaller.

**Why.** Class loading takes time. Class metadata occupies metaspace. Public-but-unused helpers contribute to startup time and metaspace pressure (especially in serverless / fast-start scenarios). With AOT or CDS, the cost compounds.

Subtler benefit: a smaller public surface keeps `jdeps` and `jlink` outputs cleaner — you can produce smaller distributions.

---

## Optimization 5 — Use `private static final` for inlined constants

**Slow:**

```java
public class Constants {
    public static int MAX = 100;             // not final → not inlined
    public static int MIN = 0;
}

if (value > Constants.MAX) throw new ...;     // each read goes through getstatic
```

Each `Constants.MAX` is a `getstatic` bytecode + memory load.

**Better:**

```java
public class Constants {
    public static final int MAX = 100;       // compile-time constant
    public static final int MIN = 0;
}
```

Compile-time constants of primitive or `String` type are *inlined* by `javac` into reading code. The bytecode at the use site has the literal `100` baked in — no `getstatic`.

**Why.** Compile-time constants get inlined. Removing one indirection per read; the JIT also can constant-fold conditions.

Caveat: when you change `Constants.MAX`, every consumer must recompile. Otherwise they keep the old inlined value. This is a real maintenance hazard for cross-jar compile-time constants.

---

## Optimization 6 — Mark hot leaf methods `final`

**Slow:**

```java
public class StringBuilderUtil {
    public boolean isEmpty(StringBuilder sb) { return sb.length() == 0; }
}
```

Even if no subclass exists, `isEmpty` is a virtual call. JIT inlines via CHA — but if a subclass appears later, the compiled code may be deoptimized.

**Better:**

```java
public class StringBuilderUtil {
    public final boolean isEmpty(StringBuilder sb) { return sb.length() == 0; }
}
```

Or mark the class `final`.

**Why.** `final` methods are inlined directly. No CHA, no deopt risk. Pre-emptive `final` on classes/methods that aren't designed for extension is a free, stable inlining hint.

---

## Optimization 7 — Use module `opens` instead of broad classpath reflection

**Slow:**

```bash
java --add-opens java.base/java.lang=ALL-UNNAMED \
     --add-opens java.base/java.util=ALL-UNNAMED \
     --add-opens java.base/java.lang.reflect=ALL-UNNAMED \
     ...
```

Frequent across ML / metaprogramming / migration tools. Each opens a JDK package to *all* unnamed-module code — no encapsulation left.

**Better:**

```java
module my.app {
    requires com.fasterxml.jackson.databind;
    opens com.example.entities to com.fasterxml.jackson.databind;     // targeted opens
}
```

Only the framework module gets reflective access. The rest of the JDK is still locked down.

**Why.** Targeted opens preserve module strong encapsulation while letting the framework do what it needs. Broad opens are a mainentance time bomb.

---

## Optimization 8 — Avoid `protected` methods for hot internal helpers

**Slow:**

```java
public abstract class HttpHandler {
    protected int parseStatus(byte[] line) { ... }
}
```

Every subclass call to `parseStatus` is virtual. The JIT inlines if monomorphic, but generic frameworks load many handlers — call sites become megamorphic.

**Better:**

```java
public abstract class HttpHandler {
    private int parseStatus(byte[] line) { ... }   // private — only this class
}
```

Or `protected final` if subclasses must call but never override.

**Why.** Private/final methods are direct calls. Open `protected` methods invite polymorphism. If subclasses don't actually need to override, don't grant the access.

---

## Optimization 9 — Replace public mutable static fields with private + accessor

**Slow:**

```java
public class Cache {
    public static Map<String, Object> data = new HashMap<>();
}
```

- Anyone can replace the map (`Cache.data = new HashMap<>()`) — instantly invalidates everyone's view.
- Concurrent access is unsafe; you can't add `volatile` retroactively without changing every read site.
- Refactoring to `ConcurrentHashMap` requires every caller to drop assumptions.

**Better:**

```java
public class Cache {
    private static final ConcurrentMap<String, Object> data = new ConcurrentHashMap<>();
    public static Object get(String k)             { return data.get(k); }
    public static void   put(String k, Object v)   { data.put(k, v); }
}
```

**Why.** Mutable shared state must go through a managed boundary. Public mutable static fields are global variables in disguise — undesigned-for, untested-for concurrent access.

---

## Optimization 10 — Trim transitive `requires` in modules

**Slow:**

```java
module com.app {
    requires transitive com.lib.full;       // pulls in 50 transitive types
}
```

Consumers of `com.app` automatically `requires` everything in `com.lib.full`. Their compilation pulls in all the metadata.

**Better:**

```java
module com.app {
    requires com.lib.api;                   // narrower, only the API
    requires transitive com.lib.types;      // only the types our API exposes
}
```

**Why.** Compile-time scope shrinks. Faster builds. Smaller dependency graph for end users. `jlink` produces smaller runtime images.

---

## Optimization 11 — Cache `Class<?>` lookups instead of repeated `forName`

**Slow:**

```java
public Object handle(String typeName, Object data) throws Exception {
    Class<?> c = Class.forName(typeName);             // every call
    return c.getDeclaredMethod("process").invoke(data);
}
```

`Class.forName` does a class loader lookup, security check, possibly initialization. ~µs per call.

**Better:**

```java
private static final ConcurrentMap<String, Class<?>> classCache = new ConcurrentHashMap<>();
public Object handle(String typeName, Object data) throws Exception {
    Class<?> c = classCache.computeIfAbsent(typeName, n -> {
        try { return Class.forName(n); } catch (ClassNotFoundException e) { throw new RuntimeException(e); }
    });
    return c.getDeclaredMethod("process").invoke(data);
}
```

Even better — if you know the types ahead of time, register them once at startup with a `MethodHandle` and skip reflection entirely.

**Why.** Reflection is expensive per call. Cache aggressively. For framework code with known types, prefer `MethodHandle` over `Class.forName + Method.invoke`.

---

## Optimization 12 — Use sealed types for compile-time exhaustiveness instead of runtime instanceof chains

**Slow:**

```java
public Object handle(Event event) {
    if (event instanceof PaymentEvent) return handle((PaymentEvent) event);
    if (event instanceof RefundEvent)  return handle((RefundEvent) event);
    if (event instanceof CancelEvent)  return handle((CancelEvent) event);
    throw new IllegalStateException("unknown event: " + event);
}
```

If you add a new event type and forget to add a branch here, you don't find out until runtime.

**Better:**

```java
public sealed interface Event permits PaymentEvent, RefundEvent, CancelEvent {}

public Object handle(Event event) {
    return switch (event) {
        case PaymentEvent p -> handlePayment(p);
        case RefundEvent  r -> handleRefund(r);
        case CancelEvent  c -> handleCancel(c);
    };
}
```

The compiler enforces exhaustiveness; adding a new permitted subtype forces every `switch` to update.

**Why.** Compile-time guarantee replaces runtime checks. Fewer bugs make production. Plus pattern-matching `switch` is slightly more efficient than a chain of `instanceof`.

---

## Methodology recap

For every change in this file:

1. **Profile first.** Access-modifier choices rarely show up in CPU profiles directly, but they show up in *churn* — diff your release branches and look for "make X public" commits. Each is a future maintenance cost.
2. **Measure compile times.** Module restructuring affects build speed. Time `mvn compile` before and after.
3. **Measure JIT behavior.** `-XX:+PrintInlining` to confirm `final` methods inline directly. `-XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation` for compile events.
4. **Measure metaspace / class loading.** `jcmd <pid> VM.classloader_stats`, `-Xlog:class+load`. Hidden classes contribute to metaspace; reducing public surface can reduce class loading by trimming dependencies.
5. **Trust the build, not the runtime.** Most access-control "optimizations" are compile-time / shipping-time wins — fewer breaking changes, smaller artifacts, simpler dependency graphs. The runtime gains are real but secondary.

The biggest performance win from access modifiers is **time you don't spend dealing with breakage** in your future releases. Tighten by default; loosen only when forced.
