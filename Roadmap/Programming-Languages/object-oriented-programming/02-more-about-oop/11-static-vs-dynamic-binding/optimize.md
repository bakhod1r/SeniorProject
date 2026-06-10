# Static vs Dynamic Binding — Optimization

Twelve before/after exercises focused on dispatch performance.

---

## Optimization 1 — `final` for hot dispatch

**Before:**
```java
public class Money {
    public long cents() { return cents; }
}
```

**After:**
```java
public final class Money {
    public long cents() { return cents; }
}
```

JIT can devirtualize all calls on Money references without CHA + deopt support. Especially valuable for value types accessed millions of times.

---

## Optimization 2 — Sealed types over open hierarchy

**Before:**
```java
public abstract class Shape { abstract double area(); }
```

**After:**
```java
public sealed interface Shape permits Circle, Square, Triangle { double area(); }
```

Closed set lets the JIT specialize. Pattern matching gives exhaustive checks.

---

## Optimization 3 — Pattern matching over instanceof chain

**Before:**
```java
if (s instanceof Circle) return Math.PI * ((Circle) s).r() * ((Circle) s).r();
if (s instanceof Square) return ((Square) s).s() * ((Square) s).s();
return 0;
```

**After:**
```java
return switch (s) {
    case Circle(var r) -> Math.PI * r * r;
    case Square(var side) -> side * side;
    default -> 0;
};
```

`typeSwitch` indy is faster than chained instanceof; pattern with deconstruction avoids manual cast.

---

## Optimization 4 — Direct call when type is known

**Before:**
```java
Shape s = ...;
s.area();
```

If `s` is always `Circle` in this code path:

**After:**
```java
Circle c = ...;
c.area();
```

Static type narrows; JIT inlines without CHA.

But: don't do this unless the type really is fixed. Premature commitment to concrete types hurts evolution.

---

## Optimization 5 — Reduce decorator stacking

**Before:**
```java
service = new LoggingDecorator(new MetricsDecorator(new RetryDecorator(new TimeoutDecorator(realService))));
```

5 levels of dispatch per call.

**After:** combine cross-cutting concerns into one decorator:
```java
service = new ObservabilityDecorator(realService);   // logging + metrics + retry + timeout in one
```

Or use AOP / aspect to inject all at once with a single proxy.

---

## Optimization 6 — Avoid megamorphic call sites

Profile with `-XX:+PrintInlining`. If you see `not inlineable, megamorphic`, refactor:
- Reduce the number of implementations on this hot path.
- Specialize the hot loop to call concrete types.
- Use sealed types if the variants are closed.

---

## Optimization 7 — Cache MethodHandle for late binding

**Before (reflection):**
```java
Method m = obj.getClass().getMethod("compute");
m.invoke(obj);
```

**After:**
```java
private static final MethodHandle COMPUTE = MethodHandles.lookup()
    .findVirtual(I.class, "compute", MethodType.methodType(int.class));

int result = (int) COMPUTE.invokeExact((I) obj);
```

`MethodHandle.invokeExact` can be JIT-inlined. Cache the handle once.

---

## Optimization 8 — Avoid stacked lambdas

Each lambda is a virtual `apply` call. Stacked:
```java
Function<X, Y> a = ...;
Function<Y, Z> b = ...;
Function<X, Z> composed = a.andThen(b);   // two virtual calls per element
```

For very hot paths, write directly:
```java
Function<X, Z> direct = x -> b.apply(a.apply(x));   // still two calls; JIT inlines
```

JIT often handles both. Profile to verify.

---

## Optimization 9 — Records over classes for value types

**Before:**
```java
public class Point { /* getters, equals, hashCode */ }
```

**After:**
```java
public record Point(double x, double y) { }
```

Records are final by default; JIT-friendly; less code. Often inlined into surrounding methods via escape analysis.

---

## Optimization 10 — `private` for hot helpers

Internal helpers should be `private`:

```java
public void process() {
    helper();
}
private void helper() { ... }    // direct dispatch (invokespecial or invokevirtual since J11)
```

Public helpers are `invokevirtual` and may need CHA for devirtualization. Private ones are direct from compile time.

---

## Optimization 11 — Avoid `instanceof` chains for closed hierarchies

If `Shape` is sealed with 5 variants:

**Before:**
```java
if (s instanceof Circle) ...
else if (s instanceof Square) ...
else if (s instanceof Triangle) ...
```

**After:**
```java
return switch (s) {
    case Circle c -> ...;
    case Square sq -> ...;
    case Triangle t -> ...;
};   // exhaustive
```

JIT-friendly typeSwitch; compile-time exhaustiveness.

---

## Optimization 12 — Profile-guided inlining hints

For very hot code paths, you can hint the JIT:

```java
@CompilerControl(CompilerControl.Mode.INLINE)
public void hotMethod() { ... }
```

Or use `-XX:CompileCommand=inline,X.method`.

These hints are rarely needed; usually JIT decides correctly. But for critical microbenchmarks, you can guide.

---

## Tools cheat sheet

| Tool                                          | Purpose                                |
|-----------------------------------------------|----------------------------------------|
| `-XX:+PrintInlining`                          | Inlining decisions                     |
| `-XX:+PrintCompilation`                       | What got JIT'd                         |
| `-XX:CompileCommand=print,X.method`           | Disassemble specific method            |
| `async-profiler -e cycles`                    | CPU flame graph                        |
| `jol-cli`                                     | Object layout                          |
| `jmh`                                         | Microbenchmark                         |
| `-XX:+PrintAssembly` (with hsdis)             | Generated machine code                 |

---

## When to apply

- Hot inner loops with many dispatch sites
- High-throughput services where ns matter
- Profile shows megamorphic dispatch as bottleneck
- Framework proxies adding measurable overhead

## When not to

- Cold paths (config, startup)
- Code clarity matters more
- JIT already devirtualizes (verify with PrintInlining)

---

**Memorize this**: dynamic dispatch is fast in modern JVMs *when monomorphic*. The JIT inlines well-warmed virtual calls. `final`, sealed types, records, and pattern matching all help the optimizer. Profile before optimizing.
