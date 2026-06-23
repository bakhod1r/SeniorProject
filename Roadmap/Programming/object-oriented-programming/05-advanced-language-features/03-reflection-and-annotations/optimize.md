# Reflection and Annotations — Optimize

> Reflection has three speeds: cold reflection (first hundred calls), warmed reflection (after JIT inlining), and direct invocation. The gap between them used to be 50–100×; since JEP 416 (JDK 18) it has shrunk to roughly 2–5× for warmed call sites. This file gives you the JMH harness to measure it, the caching idioms that close the gap, and the design moves that avoid reflection entirely (`LambdaMetafactory`, `VarHandle`, annotation processors).

---

## 1. Costs to keep in mind

Three operations sit on the critical path of any reflective call:

1. **Lookup** — `Class.getDeclaredMethod(...)`. Hash-table walk; one-shot cost; cacheable.
2. **Access check** — does the caller have permission? `setAccessible(true)` disables it; the check is cheap once disabled.
3. **Dispatch** — `Method.invoke(target, args)` does argument boxing into `Object[]`, return-value unboxing, and exception bookkeeping.

The first call to a `Method` goes through a "native method accessor" backed by a JNI call (slow). After about 15 invocations, the JVM switches to a "generated method accessor" — a synthetic class with direct bytecode that calls the target. After a few hundred more calls, the JIT compiles the surrounding method and may inline through the accessor.

JEP 416 (JDK 18) replaced this two-phase scheme with a single `MethodHandle`-backed implementation. The shape is now: `Method.invoke` is, under the hood, `MethodHandle.invokeExact` on a cached handle. A warmed-up reflective call site is within 2–5× of a direct call instead of 50–100×.

---

## 2. JMH baseline — direct vs reflection vs MethodHandle

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
@Fork(value = 2, jvmArgsAppend = "-XX:+UseG1GC")
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
public class InvocationBench {

    public static int square(int x) { return x * x; }

    private static final Method METHOD;
    private static final MethodHandle HANDLE;
    static {
        try {
            METHOD = InvocationBench.class.getDeclaredMethod("square", int.class);
            METHOD.setAccessible(true);
            HANDLE = MethodHandles.lookup().findStatic(
                InvocationBench.class, "square",
                MethodType.methodType(int.class, int.class));
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    @Benchmark public int direct() { return square(7); }

    @Benchmark public int reflectionCached() throws Throwable {
        return (int) METHOD.invoke(null, 7);
    }

    @Benchmark public int methodHandleExact() throws Throwable {
        return (int) HANDLE.invokeExact(7);
    }

    @Benchmark public int methodHandleInvoke() throws Throwable {
        return (int) HANDLE.invoke(7);
    }
}
```

Typical JDK 21 numbers on a modern x64 box (illustrative — verify in your environment):

| Bench                | Time per call | Notes                                        |
| -------------------- | ------------- | -------------------------------------------- |
| `direct`             | ~0.5 ns       | Inlined to a `lea` + `imul` by C2.           |
| `methodHandleExact`  | ~1.0 ns       | `static final` handle, JIT inlines through it. |
| `reflectionCached`   | ~5–8 ns       | Per-call int-boxing; JEP 416 closes most of the historical gap. |
| `methodHandleInvoke` | ~8–15 ns      | `invoke` rather than `invokeExact` allows type conversion at the call site. |

Two observations matter for design:

- **`static final MethodHandle` is what you want.** A handle in an instance field doesn't get inlined.
- **`invokeExact` is dramatically faster than `invoke`.** Whenever you can express the exact `MethodType` at the call site, use `invokeExact`.

---

## 3. Caching `Method` and `Field` lookups

The reflective lookup (`getDeclaredMethod`, `getDeclaredField`) is far more expensive than the call itself — typically tens of microseconds on a cold class. Cache it.

```java
public final class GetterCache {
    private static final ClassValue<Map<String, MethodHandle>> CACHE = new ClassValue<>() {
        @Override
        protected Map<String, MethodHandle> computeValue(Class<?> c) {
            Map<String, MethodHandle> getters = new HashMap<>();
            MethodHandles.Lookup lookup = MethodHandles.publicLookup();
            for (Method m : c.getMethods()) {
                if (m.getParameterCount() != 0) continue;
                String name = m.getName();
                if (!name.startsWith("get") || name.length() <= 3) continue;
                try {
                    MethodHandle mh = lookup.unreflect(m);
                    getters.put(Character.toLowerCase(name.charAt(3))
                                + name.substring(4), mh);
                } catch (IllegalAccessException ignored) { }
            }
            return Map.copyOf(getters);
        }
    };

    public static MethodHandle getterFor(Class<?> c, String property) {
        return CACHE.get(c).get(property);
    }
}
```

What this idiom buys:

- **One pass per class.** Subsequent calls hit a `Map` lookup.
- **`ClassValue` is the JDK's purpose-built cache.** It handles class unloading correctly; a `ConcurrentHashMap<Class<?>, …>` would pin classes alive forever.
- **`MethodHandle` instead of `Method`.** The handle is faster to call, supports `invokeExact`, and the JIT can fold through it.

This is the spine of Jackson's `BeanDeserializer`, Hibernate's `PropertyAccess`, and Spring's `BeanWrapper`.

---

## 4. `LambdaMetafactory` — the fastest "reflection" of all

If you need to call the same method many times with the same shape, the cheapest indirection is *no* indirection: synthesize a lambda whose body is the target.

```java
import java.lang.invoke.*;
import java.util.function.*;

public final class LambdaFactory {

    /**
     * Build a Function<T,R> that calls `getter` on its argument.
     * The cost is paid once; the returned Function calls at lambda speed.
     */
    public static <T, R> Function<T, R> getter(Method getter) throws Throwable {
        MethodHandles.Lookup lookup = MethodHandles.lookup();
        MethodHandle target = lookup.unreflect(getter);

        CallSite cs = LambdaMetafactory.metafactory(
                lookup,
                "apply",
                MethodType.methodType(Function.class),
                MethodType.methodType(Object.class, Object.class),
                target,
                target.type());

        @SuppressWarnings("unchecked")
        Function<T, R> fn = (Function<T, R>) cs.getTarget().invokeExact();
        return fn;
    }
}
```

Used:

```java
Function<Order, BigDecimal> totalGetter = LambdaFactory.getter(
        Order.class.getMethod("total"));

for (Order o : orders) {
    BigDecimal t = totalGetter.apply(o);    // ~1 ns; no reflection on the call path
}
```

What just happened:

- `LambdaMetafactory.metafactory` is the bootstrap used by every `lambda` expression in Java 8+. It synthesises a class implementing `Function`, whose `apply` method directly invokes `target`.
- The returned `Function` is indistinguishable from `o -> o.total()` written by hand.
- The JIT inlines `apply` because `target` is a direct method handle to a known method.

This is the technique Jackson 2.12+ uses when running on JDK 9+; serialisation throughput jumped 30–50% over reflection-based getters. The setup cost is in the microseconds; the per-call cost is in the nanoseconds.

The catch: `LambdaMetafactory` only works for *functional* signatures. If you need to call a four-argument method, you build a custom `@FunctionalInterface` and pass it as the *interface method type* to `metafactory`.

---

## 5. `VarHandle` for atomic field access

For field-level atomics, `VarHandle` is the fast path. It replaces `AtomicReferenceFieldUpdater` (reflective, allocates) and `sun.misc.Unsafe` (banned in modular Java).

```java
public final class LockFreeStack<E> {
    private static final VarHandle HEAD;
    static {
        try {
            HEAD = MethodHandles.lookup().findVarHandle(
                    LockFreeStack.class, "head", Node.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    private volatile Node<E> head;

    public void push(E v) {
        Node<E> n = new Node<>(v, null);
        Node<E> prev;
        do {
            prev = (Node<E>) HEAD.getVolatile(this);
            n.next = prev;
        } while (!HEAD.compareAndSet(this, prev, n));
    }
}
```

Performance characteristics:

- `VarHandle.getVolatile` ≈ a plain `volatile` field read. No extra cost.
- `VarHandle.compareAndSet` ≈ a single `cmpxchg` instruction. Same as a CAS through `AtomicReference`.
- No allocation per call. No reflection per call.

`AtomicInteger` is still appropriate for a single counter — it boxes nothing because the value type is primitive. `VarHandle` wins when you need atomics on fields of objects you don't want to wrap in a boxing helper.

---

## 6. MethodHandle warm-up cost

`MethodHandle` is fast *after warm-up*. The warm-up itself is more expensive than the first `Method.invoke` call:

- `MethodHandles.lookup().findVirtual(...)` allocates and verifies type compatibility.
- The first invocation goes through a generic adapter chain that the JIT specialises.
- Real speed shows up after ~10 000 invocations of the same call site.

Implications for startup:

- A framework that builds thousands of `MethodHandle`s at startup pays a one-time cost (typically 50–200 ms for a 1000-class scan). After that, throughput beats `Method.invoke` by 2–4×.
- For a CLI that runs once and exits, `MethodHandle` is not worth the setup. Use `Method.invoke` or a direct call.

Measure: `-Xlog:class+load=info` shows the synthetic classes the `MethodHandle` machinery generates; `-XX:+PrintCompilation` shows the JIT compiling them.

---

## 7. Reflection vs annotation processing — move the work to compile time

The cheapest reflection is no reflection. If you can read the annotation at compile time and generate code, you pay zero runtime cost.

| Approach              | When the work happens | Runtime cost                     | Build cost              | Best for                                |
| --------------------- | --------------------- | -------------------------------- | ----------------------- | --------------------------------------- |
| Runtime reflection    | Per call (cached)     | Lookup amortised, call ~5–10 ns | Zero                    | Frameworks discovering arbitrary user classes |
| `MethodHandle` cache  | Per call (cached)     | ~1 ns after warmup              | Zero                    | Hot paths in reflective frameworks      |
| `LambdaMetafactory`   | Per call (warmed)     | Equivalent to a written lambda  | Zero                    | High-throughput serialisers, mappers    |
| Annotation processor  | At compile            | Zero — direct calls in generated code | Slower compile    | Fixed-shape codegen (Dagger, MapStruct) |

Dagger 2's whole pitch is "DI without runtime reflection." It generates a `Component` class at compile time whose `inject` method is a chain of direct constructor calls. Spring uses reflection (more flexibility, slower startup); Dagger uses processors (less flexibility, faster startup, fits Android). Neither is universally better — they trade dynamism for startup speed.

If you find yourself reflecting over a fixed set of annotated types known at compile time, a processor is the cheaper answer.

---

## 8. Avoiding `setAccessible` overhead

Calling `setAccessible(true)` is not free — there is a one-time access check against the module system. In a tight loop creating thousands of `Field` objects per second, that check shows up:

```java
// Slow: setAccessible on every field, every call.
for (Field f : c.getDeclaredFields()) {
    f.setAccessible(true);
    f.get(target);
}

// Fast: setAccessible once per Field instance, cached.
private static final List<Field> FIELDS;
static {
    FIELDS = Arrays.stream(MyClass.class.getDeclaredFields())
            .peek(f -> f.setAccessible(true))
            .toList();
}
```

The `Field` instance is small and the JVM keeps the "accessible" flag on it. Cache the `Field` (or, better, build a `MethodHandle` to the accessor via `lookup.unreflectGetter(f)`).

---

## 9. Allocation: the silent reflection cost

Every `Method.invoke` allocates:

- An `Object[]` for the arguments (even for `invoke(target)` with no args — actually a shared empty array since JDK 8, but every multi-arg call allocates).
- Boxed primitives (`Integer.valueOf(7)`) for any primitive parameter.
- An `InvocationTargetException` if the target throws — even on success, the JVM may pre-allocate exception-related metadata.

In a million-call-per-second loop, that's a noticeable allocation rate. The fixes (in order of preference):

1. **`MethodHandle.invokeExact`** with primitives in the signature — no boxing.
2. **`LambdaMetafactory`** to synthesise a `Function`-like wrapper — no varargs array.
3. **Pre-allocated argument arrays** if you must use `Method.invoke`:

```java
private final Object[] args = new Object[1];   // reused across calls; not thread-safe
public Object call(Object target, Object arg) throws Exception {
    args[0] = arg;
    return method.invoke(target, args);
}
```

The pre-allocated-array trick is fragile (not thread-safe; an `Object[]` shared across threads breaks). Prefer `MethodHandle`.

---

## 10. Quick rules — when to optimise reflection

A short checklist for when reflection actually matters.

- [ ] **Profile first.** A flame graph showing `Method.invoke` or `NativeMethodAccessorImpl` justifies optimisation; "reflection is slow" without numbers does not.
- [ ] **Cache lookups by class.** Use `ClassValue` for cache liveness with class unloading.
- [ ] **Hold `MethodHandle` in `static final` fields** for JIT inlining.
- [ ] **Use `invokeExact`** when the `MethodType` is known statically.
- [ ] **Reach for `LambdaMetafactory`** for high-throughput getter/setter/method dispatch.
- [ ] **Use `VarHandle`** for atomic field access; it is the modern `Unsafe` replacement.
- [ ] **Avoid `Method.invoke` in hot paths**; if you can't, pre-allocate argument arrays.
- [ ] **Move codegen to compile time** with annotation processors when the set of types is fixed.
- [ ] **Measure JEP 416 effect.** On JDK 18+, cached `Method.invoke` is closer to `MethodHandle` than on JDK 11 — re-benchmark when you upgrade.
- [ ] **Don't reach for `Unsafe`.** Whatever you need, `MethodHandle`/`VarHandle` covers it for JPMS-compatible code.

The general law: design with reflection first, measure, then move hot paths to `MethodHandle` or `LambdaMetafactory`. Most code never reaches the threshold where reflection overhead matters. For the 1% that does, the techniques above buy back most of the loss without sacrificing the dynamism that justified reflection in the first place.
