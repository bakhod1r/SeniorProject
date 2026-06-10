# Reflection and Annotations — Practice Tasks

Eight exercises that force the parts of reflection and annotations that bite in production: caching, MethodHandle, VarHandle, JPMS, annotation processing, and the design of custom annotations that drive behaviour. Each task names the smell, gives the constraints, and lists the acceptance criteria you can check yourself.

Work each task in three passes: (1) read the snippet and decide which tool is right — reflection, `MethodHandle`, `VarHandle`, or a processor; (2) sketch the API surface before writing implementation; (3) measure once the code works — a passing test plus a JMH benchmark for hot-path tasks.

---

## Task 1 — Tiny JSON serialiser using reflection

Build a 50-line JSON serialiser. The goal is not to compete with Jackson — it is to internalise the scan + cache + call pattern every serialiser uses.

```java
public final class TinyJson {
    public String toJson(Object o) { /* TODO */ }
}
```

Requirements:

- Walk `getClass().getDeclaredFields()`. Skip `static` fields. Handle `transient` by ignoring (your call, but document it).
- Support: `String` (quoted), primitives and their wrappers (raw), `null` (literal), nested objects (recursive), and `Collection<?>` and `Map<String,?>` (with String keys).
- Use `setAccessible(true)` to read non-public fields.
- Cache the *field list* per class in a `ClassValue<List<Field>>`.

**Acceptance criteria.**

- A test serialises a `record User(String name, int age, List<String> tags) { }` to `{"name":"Ada","age":36,"tags":["math","logic"]}`.
- Adding 10 000 distinct users with different ages reuses the same cached `Field[]` (verify by counting `computeValue` invocations).
- A second test passes an unsupported type (e.g., `LocalDate`) and gets a clear `IllegalArgumentException` mentioning the field name.
- The serialiser is safe to call from multiple threads concurrently.

---

## Task 2 — Custom `@Cached` annotation + simple caching interceptor

Design an annotation that marks methods whose result should be cached, and write a `CachingProxy` that wraps an object and reads the annotation.

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Cached {
    long ttlMillis() default 60_000;
}

public interface Prices {
    @Cached(ttlMillis = 5_000)
    BigDecimal priceFor(String sku);
}
```

Requirements:

- The proxy implements the same interface as its target (use `Proxy.newProxyInstance` or write a small generated class).
- Reads `@Cached` from the method; caches results by argument list (use `List.of(args)` as the key).
- Returns the cached value if not expired; otherwise calls the real method and stores.
- Reject cases where the proxy can't be built (target's class is `final`, method is not `interface`).

**Acceptance criteria.**

- Calling `priceFor("ABC")` twice within 5 s invokes the real method once.
- Calling `priceFor("XYZ")` then `priceFor("ABC")` invokes the real method twice (different keys).
- A method without `@Cached` is always delegated.
- The proxy unwraps `InvocationTargetException` correctly — if the real method throws, the proxy throws the same exception.

---

## Task 3 — Replace reflective dispatch with `MethodHandle`

You have a working `Method.invoke`-based dispatcher:

```java
public final class EventBus {
    private final Map<Class<?>, List<Map.Entry<Object, Method>>> handlers = new HashMap<>();

    public void register(Object listener) {
        for (Method m : listener.getClass().getDeclaredMethods()) {
            if (m.getParameterCount() != 1) continue;
            handlers.computeIfAbsent(m.getParameterTypes()[0], k -> new ArrayList<>())
                    .add(Map.entry(listener, m));
        }
    }

    public void publish(Object event) throws Throwable {
        for (var entry : handlers.getOrDefault(event.getClass(), List.of())) {
            entry.getValue().invoke(entry.getKey(), event);
        }
    }
}
```

Migrate it to `MethodHandle`. Measure the difference with JMH.

Requirements:

- Replace `Method` with `MethodHandle` in the storage map.
- Use `MethodHandles.publicLookup().unreflect(m)` then `mh.bindTo(listener)` so each entry stores a *bound* handle taking only the event.
- Use `invokeExact` when possible — wrap the event in the exact type expected.

**Acceptance criteria.**

- A correctness test registers a listener and publishes an event; the handler runs.
- A JMH benchmark shows the `MethodHandle` version at least 2× faster than the `Method.invoke` version on a 1 M-event run.
- Exceptions thrown by handlers propagate cleanly — no `InvocationTargetException` wrapping in the caller's stack trace.
- The bound handles survive across thousands of `publish` calls; no per-call allocation.

---

## Task 4 — `VarHandle` for compare-and-set on a lock-free counter

Implement a `StripedCounter` using `VarHandle` for lock-free atomic updates on an `int[]` of stripes.

```java
public final class StripedCounter {
    private final int[] stripes;
    public StripedCounter(int numStripes) { stripes = new int[numStripes]; }
    public void increment() { /* TODO: pick a stripe by ThreadLocalRandom, CAS-update */ }
    public long sum() { /* TODO: read all stripes with acquire semantics */ }
}
```

Requirements:

- Obtain a `VarHandle` for `int[]` element access via `MethodHandles.arrayElementVarHandle(int[].class)`.
- `increment` uses `getAndAdd` (or a CAS loop with `compareAndSet`).
- `sum` reads each stripe with `getAcquire` (so it observes recent updates without forcing full `volatile` semantics).
- The class is thread-safe with no `synchronized`, no `Atomic` types.

**Acceptance criteria.**

- A correctness test runs 16 threads, each calling `increment` 100 000 times; `sum` returns 1 600 000.
- A JMH benchmark shows higher throughput than an equivalent `LongAdder` only marginally (your goal is correctness; `LongAdder` is already striped CAS).
- The class size is under 30 lines.

---

## Task 5 — Runtime validation via annotations

Design an annotation `@Range(min, max)` and a validator that reads it off `int` and `long` fields.

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.FIELD)
public @interface Range {
    long min();
    long max();
}

public record Loan(@Range(min = 100, max = 1_000_000) long amountCents,
                   @Range(min = 1, max = 60)          int  termMonths) { }
```

Requirements:

- Validator scans `getDeclaredFields()`, finds `@Range`, reads the value, checks bounds.
- Returns a `List<Violation>` describing each failure with field name, value, and bounds.
- Caches the per-class field list (use `ClassValue`).
- Works on records — careful with private final fields, you need `setAccessible(true)`.

**Acceptance criteria.**

- `new Validator().validate(new Loan(50, 12))` returns one violation on `amountCents`.
- `new Validator().validate(new Loan(500_000, 12))` returns no violations.
- The validator handles non-numeric fields by ignoring them (no `@Range` means no check).
- A 1 M-call benchmark shows the cache is effective: second-and-later calls are >10× faster than the first.

---

## Task 6 — Debug a JPMS-blocked reflection call

You inherit a serialiser that worked on Java 8:

```java
public final class StructLogger {
    public String render(Object o) throws Exception {
        StringBuilder sb = new StringBuilder("{");
        for (Field f : o.getClass().getDeclaredFields()) {
            f.setAccessible(true);                                // (*)
            sb.append(f.getName()).append("=").append(f.get(o)).append(", ");
        }
        return sb.append('}').toString();
    }
}

// Usage:
new StructLogger().render(java.time.Instant.now());
```

On Java 17 it fails:

```
java.lang.reflect.InaccessibleObjectException: Unable to make field private final long
java.time.Instant.seconds accessible: module java.base does not "opens java.time" to
unnamed module @5e91993f
```

Requirements:

- Identify exactly which package needs to be opened and to whom.
- Add the *minimum* `--add-opens` JVM flag that makes the code work.
- Then propose a *better* fix that doesn't require opening any JDK package.

**Acceptance criteria.**

- You can recite the three valid responses: (1) `--add-opens java.base/java.time=ALL-UNNAMED`; (2) make the consumer modular and use `requires java.base; opens java.base/java.time;` (the latter is impossible — `java.base` cannot be re-opened from outside, and you should articulate why); (3) don't reflect into `java.time` at all — use its documented API.
- The "better fix" treats JDK types specially: check `o instanceof Instant` and delegate to `toString()`; for non-JDK objects, use the reflective path but only on packages the consumer controls.
- A test confirms the better fix works without any `--add-opens` flag.

---

## Task 7 — Cache reflection lookups for a hot path

You profile an event processor and find this hot loop:

```java
public final class FieldExtractor {
    public Object extract(Object event, String fieldName) throws Exception {
        Field f = event.getClass().getDeclaredField(fieldName);   // (*)
        f.setAccessible(true);                                    // (**)
        return f.get(event);
    }
}
```

The flame graph shows 25% of CPU time inside `Class.getDeclaredField` and `Field.copy`.

Requirements:

- Build a cache keyed by `(Class<?>, String fieldName)` mapping to a `MethodHandle` (getter).
- Use `ClassValue<Map<String, MethodHandle>>` so the cache scopes to the JVM lifetime and unloads with the class.
- Use `MethodHandles.lookup().unreflectGetter(field)` to get a getter handle.
- Call with `invokeExact` where the field type allows.

**Acceptance criteria.**

- A correctness test extracts a field; matches the original behaviour.
- A JMH benchmark on a 1 M-event run shows at least 10× improvement over the original (cold reflection per call).
- The cache survives across instances of `FieldExtractor` (it's `static`).
- Adding a new event type for the first time pays the lookup cost once; subsequent calls hit the cached handle.

---

## Task 8 — Benchmark reflection vs MethodHandle vs LambdaMetafactory

Build a JMH harness with four benchmarks invoking the same method `int square(int)`:

1. Direct call.
2. `Method.invoke` with cached `Method`.
3. `MethodHandle.invokeExact` with cached `static final` handle.
4. `Function<Integer, Integer>` produced by `LambdaMetafactory` (you'll need to lower the primitive into `Integer`).

Requirements:

- Each benchmark has the same input and same output.
- Warm-up for at least 5 iterations × 1 second.
- Measure on JDK 17 *and* JDK 21 (or whatever pair you have). Note the difference around JEP 416 (JDK 18).
- Include `-prof gc` to track allocation rates per benchmark.

**Acceptance criteria.**

- A short report (in comments or a `BENCHMARK.md`) listing the four numbers and the GC allocation rates.
- The expected ordering: `direct < methodHandle ≤ lambdaMetafactory < reflectionCached`.
- The allocation rate is ~0 for `direct`, `methodHandle`, and `lambdaMetafactory`; non-zero for `reflectionCached` (the argument array).
- You can articulate why `LambdaMetafactory` is roughly equal to `MethodHandle` here (it generates a class whose `apply` body calls the same handle).

---

## Validation

| Task | How to verify the fix |
| ---- | --------------------- |
| 1    | `toJson(new User(...))` returns the documented string; cache hit count grows logarithmically with class count. |
| 2    | Calling a `@Cached` method twice returns the same instance; calling an un-`@Cached` method always delegates. |
| 3    | JMH shows ≥2× throughput on the `MethodHandle` version; no `InvocationTargetException` in stack traces. |
| 4    | 16 threads × 100 000 increments sum to exactly 1 600 000 across many runs. |
| 5    | The validator reports a violation for out-of-range, zero allocations on the cached path. |
| 6    | The "better fix" works with no `--add-opens` flags; reading a `LocalDate` field via the original path requires the flag. |
| 7    | Hot loop shows ≥10× improvement on JMH; `Class.getDeclaredField` no longer in the flame graph. |
| 8    | The expected ordering holds; `-prof gc` shows the allocation profile you predicted. |

---

## Worked solution sketch — Task 7 (cached field extraction)

```java
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.Map;

public final class CachingFieldExtractor {

    private static final ClassValue<Map<String, MethodHandle>> CACHE =
        new ClassValue<>() {
            @Override
            protected Map<String, MethodHandle> computeValue(Class<?> c) {
                MethodHandles.Lookup lookup = MethodHandles.lookup();
                Map<String, MethodHandle> getters = new HashMap<>();
                for (Field f : c.getDeclaredFields()) {
                    if (java.lang.reflect.Modifier.isStatic(f.getModifiers())) continue;
                    try {
                        f.setAccessible(true);
                        getters.put(f.getName(), lookup.unreflectGetter(f));
                    } catch (IllegalAccessException ignored) {
                        // package-private / module-closed; skip
                    }
                }
                return Map.copyOf(getters);
            }
        };

    public Object extract(Object event, String fieldName) throws Throwable {
        MethodHandle getter = CACHE.get(event.getClass()).get(fieldName);
        if (getter == null) {
            throw new IllegalArgumentException(
                "no such field: " + fieldName + " on " + event.getClass());
        }
        return getter.invoke(event);   // not invokeExact: return type is Object
    }
}
```

Three things to notice:

1. **`ClassValue` instead of `ConcurrentHashMap<Class<?>, ...>`.** This gives the JDK's purpose-built per-class cache with correct unloading semantics. Don't ever cache by `Class<?>` in a long-lived `HashMap` if you care about class unloading.
2. **`setAccessible(true)` inside the cache builder.** Done once per `Field`, then the `MethodHandle` keeps the access intact. The hot path never calls `setAccessible`.
3. **`invoke` rather than `invokeExact`.** Because the return type varies per field, the signature isn't known statically. The cost is small here (a single type cast on the boxed return); for a primitive-only field, use `invokeExact` with a specialised cache.

The cache turns "look up the field every call" (microseconds per call on the cold path) into "hash a string" (nanoseconds). On a 10 M-event run that's the difference between a CPU-bound and a memory-bound bottleneck.

---

**Memorize this:** reflection problems do not show up as compile errors. They show up as null annotations (wrong retention), wrong receivers (wrong loader), wrapped exceptions (`InvocationTargetException`), JPMS rejections (`InaccessibleObjectException`), or hot loops at 1/30th the throughput of a direct call. Each task above gives you one of those failures. If, after the fix, the next plausible production change costs you one line instead of ten, you have applied the right tool — `MethodHandle`, `VarHandle`, `ClassValue`, `ServiceLoader`, or an annotation processor.
