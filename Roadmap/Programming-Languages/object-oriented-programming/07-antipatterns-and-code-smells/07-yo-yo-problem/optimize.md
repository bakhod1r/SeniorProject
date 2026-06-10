# Yo-Yo Problem — Optimize

Deep inheritance is not only a comprehension tax — it is a performance tax. The JIT compiler in HotSpot (C2) and GraalVM treats virtual call sites very differently depending on the depth and shape of the hierarchy. This document covers the performance consequences and the optimization levers.

---

## 1. vtable depth and virtual call dispatch

Every Java class has a virtual method table (vtable) — a per-class array of method pointers. A virtual call (`obj.method()`) is:

```
1. Load obj's class pointer (klass)
2. Load method pointer from klass.vtable[method_index]
3. Call that pointer
```

This is O(1) regardless of inheritance depth in cache-hot conditions. **Depth does not directly slow dispatch.**

However, depth indirectly hurts via:

- **vtable cache locality.** Deep hierarchies produce larger vtables (every inherited virtual method occupies a slot). A 30-method vtable fits in one cache line; a 200-method vtable spans multiple. Cache misses on the second access pattern dominate.
- **Type guard cost in inlined call sites.** When C2 inlines a virtual call, it inserts a type guard. Deep hierarchies make the guard slower because the compiler must enumerate more receiver types during profiling.

---

## 2. Virtual call latency in tight loops

Measured on a typical Skylake-class CPU with JDK 21:

| Call shape | ns/call (warm) | Comment |
|---|---|---|
| Final method, monomorphic | 0.3 | Fully inlined |
| Virtual, monomorphic (one receiver type seen) | 0.4 | Inlined with type guard |
| Virtual, bimorphic (two receiver types seen) | 1.5 | Two guards |
| Virtual, megamorphic (3+ receiver types) | 6–12 | vtable lookup, no inlining |

A tight loop calling a virtual method 10^9 times that becomes megamorphic costs ~10 seconds vs ~0.3 seconds for the monomorphic case. **That is a 30x slowdown.**

Deep hierarchies push call sites toward megamorphism because each subclass adds a potential receiver type. By DIT = 5 with NOC = 3 at each level, you have 3^4 = 81 leaf types, and any base-class method called polymorphically will see many of them.

**Optimization lever:**
- Keep hot-path method declarations `final` or in `final` classes.
- For non-final hot methods, watch the JIT log (`-XX:+PrintInlining -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation`) for "failed: already compiled into a big method" or "callee is too large" — these correlate with deep hierarchies.

---

## 3. Inlining limits at depth

HotSpot inlines aggressively but has limits:

| Limit | Default | Flag |
|---|---|---|
| MaxInlineLevel | 15 | `-XX:MaxInlineLevel=15` |
| MaxInlineSize | 35 bytes | `-XX:MaxInlineSize=35` |
| FreqInlineSize | 325 bytes | `-XX:FreqInlineSize=325` |
| MaxRecursiveInlineLevel | 1 | `-XX:MaxRecursiveInlineLevel=1` |

A Template Method chain where `render()` calls `header()` which calls `super.header()` which calls `formatHeader()`... each `super` call is one inline level consumed. By DIT = 5 with `super` calls in each level, you have spent 5 of your 15 inline budget before any real work happens. Combine with framework calls (Spring proxies eat 3–4 levels alone) and you blow the budget on plumbing.

**Symptom:** the JIT log shows `inlining too deep` on hot paths.

**Fix:** Flatten the chain or raise `MaxInlineLevel` — but raising the flag is a workaround, not a solution. Flattening is correct.

---

## 4. Escape analysis losing across hops

C2's escape analysis (EA) decides whether an object can be stack-allocated (scalar replacement) instead of heap-allocated. EA requires:
- The object's full lifecycle is visible to the compiler.
- All methods it is passed to are inlined.

Yo-yo chains break EA because:
1. Each level introduces a `super.x(this)` call.
2. If any link in the chain is not inlined (size limit, megamorphic call), EA gives up.
3. The object is heap-allocated, GC pressure rises.

**Measurement:** use JMH with `-prof gc` to compare allocation rate before and after flattening a hierarchy. A real refactoring of a 5-deep chain to a 2-deep one often reduces allocation rate by 20–40% on hot paths.

---

## 5. JIT log reading for yo-yo diagnosis

Run with:
```
java -XX:+UnlockDiagnosticVMOptions \
     -XX:+PrintCompilation \
     -XX:+PrintInlining \
     -XX:+LogCompilation \
     -XX:LogFile=jit.log \
     -jar app.jar
```

Search the log for:

| Marker | Meaning |
|---|---|
| `inline (hot)` | Good — call was inlined |
| `not inlineable` | Method too large or megamorphic |
| `callee is too large` | Method exceeds FreqInlineSize |
| `recursive inlining too deep` | Chain depth limit hit |
| `virtual call` | Did not inline — likely megamorphic |
| `unloaded signature classes` | Class hierarchy not yet loaded — common in deep hierarchies during warmup |

For yo-yo chains, the smoking gun is repeated `not inlineable` entries for chain-internal `super.x()` calls.

---

## 6. Microbenchmark — the cost of depth

```java
@State(Scope.Benchmark)
public class DepthBenchmark {

    static abstract class L0 { abstract int compute(int x); }
    static abstract class L1 extends L0 {}
    static abstract class L2 extends L1 {}
    static abstract class L3 extends L2 {}
    static abstract class L4 extends L3 {}
    static final class Leaf extends L4 {
        @Override int compute(int x) { return x * 2; }
    }

    static final class Flat {
        int compute(int x) { return x * 2; }
    }

    L0 deep = new Leaf();
    Flat flat = new Flat();

    @Benchmark public int callDeep()  { return deep.compute(42); }
    @Benchmark public int callFlat()  { return flat.compute(42); }
}
```

Typical results on JDK 21 with default settings (warm, monomorphic):
- `callDeep`: ~0.4 ns/op
- `callFlat`: ~0.3 ns/op

The deep case is only marginally slower when monomorphic — HotSpot devirtualizes. **But** introduce a second leaf type and re-run:

```java
static final class Leaf2 extends L4 {
    @Override int compute(int x) { return x * 3; }
}
// alternate deep between Leaf and Leaf2 instances in the @Setup
```

Now `callDeep` jumps to ~1.5–2 ns/op (bimorphic), and with 3+ types it hits ~6–8 ns/op. The flat case, called as `Flat` directly (not as a supertype), stays at 0.3 ns/op because there is no virtual dispatch.

---

## 7. Quick rules

1. **Mark hot-path classes `final`.** Devirtualization is the single biggest JIT win.
2. **Hot-path methods are `final` or `private`.** Either prevents override.
3. **Keep call sites monomorphic.** If a hot loop iterates over a `List<Animal>`, profile what's actually in the list — if it's always `Cat`, declare the field as `List<Cat>`.
4. **Avoid `super.x()` chains in hot paths.** Each level burns inline budget.
5. **Use `sealed` to bound polymorphism.** Tells the JIT the exhaustive set of receivers; enables more aggressive devirtualization in newer JDKs.
6. **Measure before flattening for perf.** Cognitive load is always a reason to flatten; performance is only a reason if JMH confirms it.
7. **GraalVM is more aggressive than C2.** If you cannot flatten and need performance, GraalVM EE often devirtualizes what C2 cannot.

---

## 8. When not to optimize

Most code is not hot enough for vtable depth to matter. Do not flatten hierarchies "for performance" without:
1. A profiler (async-profiler, JFR) confirming the method is hot.
2. A JMH benchmark showing the call cost is significant relative to method body.
3. JIT logs confirming megamorphism or inlining failures.

Flattening a hierarchy for **comprehension** is always justified. Flattening for **performance** requires evidence.

---

## 9. What's next

| Topic | Why |
|---|---|
| [Fragile Base Class Problem](../06-fragile-base-class-problem/) | Performance optimizations in base classes break subclasses |
| [Composition Over Inheritance](../../../03-design-principles/02-composition-over-inheritance/) | Composition typically inlines better than deep inheritance |
| [Refused Bequest](../05-refused-bequest/) | Refused overrides leave dead vtable slots |

The performance argument against the yo-yo is real but secondary. The cognitive argument is primary. Both point to the same fix.
