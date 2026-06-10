# Escape Analysis and Scalar Replacement — Optimize

> EA is a runtime optimization with design-time consequences. The shapes that EA can eliminate — small final value carriers, monomorphic call chains, non-capturing lambdas — are the same shapes that good design pushes you toward. This file shows how to deliberately design for EA wins, how to verify them, and how to think about the cost when EA inevitably fails on some path.

---

## 1. Records + EA = allocation-free pipelines

A pipeline-style transform — read input, derive an intermediate, derive another, output — is EA's best case if every intermediate is a `record` consumed by the next stage and nothing escapes:

```java
public record Coord(double lat, double lon) {}
public record Polar(double r, double theta) {}

double bearing(Coord origin, Coord destination) {
    Polar p = toPolar(destination.lat() - origin.lat(),
                      destination.lon() - origin.lon());
    return Math.toDegrees(p.theta());
}

private static Polar toPolar(double dx, double dy) {
    return new Polar(Math.hypot(dx, dy), Math.atan2(dy, dx));
}
```

`Polar` is constructed inside `toPolar`, returned to `bearing`, and read once. If `toPolar` inlines into `bearing` (it will — small `static` method, monomorphic, hot), the `Polar` allocation is NoEscape and gets scalar-replaced. The two `double` fields live in registers from `Math.hypot`/`Math.atan2` straight through to the `Math.toDegrees` call. Zero heap allocation, fully readable code.

```
bearing:gc.alloc.rate.norm    avgt    5   0.0     0.0     B/op
```

This is the optimisation target: pipelines that read like algebraic transformations, where every "object" is a name for a tuple the JIT actually keeps in registers.

---

## 2. JMH baseline with `-prof gc`

The verification ritual for any EA claim is the same shape:

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
public class BearingBench {
    @Param({"100"})
    int n;
    double[] lats, lons;

    @Setup
    public void setup() {
        Random r = new Random(42);
        lats = new double[n]; lons = new double[n];
        for (int i = 0; i < n; i++) { lats[i] = r.nextDouble(); lons[i] = r.nextDouble(); }
    }

    @Benchmark
    public double sumBearings() {
        Coord origin = new Coord(0, 0);
        double sum = 0;
        for (int i = 0; i < n; i++) {
            sum += bearing(origin, new Coord(lats[i], lons[i]));
        }
        return sum;
    }
}
```

Run:

```bash
java -jar bench.jar BearingBench -prof gc \
     -jvmArgsAppend '-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations'
```

Expected output:

```
Benchmark                            Mode  Cnt   Score   Error  Units
sumBearings                          avgt    5  42.3    1.2    ns/op
sumBearings:gc.alloc.rate.norm       avgt    5   0.0    0.0    B/op
```

Two Coords per iteration would be 32 bytes/op; the `Polar` inside `toPolar` would be another 16. Total un-optimized: 48 B/op. We measure `0.0 B/op` — EA eliminated all three allocations. The `PrintEliminateAllocations` log shows `Eliminated allocation: Coord` and `Eliminated allocation: Polar` lines for `sumBearings`.

---

## 3. `final` + CHA: the inlining chain EA depends on

Inlining is the foundation EA builds on. The inliner uses Class Hierarchy Analysis (CHA) to determine whether a virtual call has only one possible target. When CHA says "yes, exactly one", the inliner inlines unconditionally and EA can see across the call.

A `final` class (or `final` method) gives CHA an *unconditional* yes — no subclass can ever exist, no future class load can invalidate the inline. This is the strongest signal you can give the inliner:

```java
public final class Distance {                              // final — no subclass possible
    public static double euclidean(Coord a, Coord b) {     // static + final class = monomorphic
        double dx = a.lat() - b.lat();
        double dy = a.lon() - b.lon();
        return Math.sqrt(dx * dx + dy * dy);
    }
}
```

Static methods on final classes are the easiest things to inline. Wrap your pipeline transforms in classes like this and EA across the chain becomes reliable. Non-final classes work too in the steady state — CHA proves "no subclass has loaded yet" — but a new class load can deoptimise the inline.

---

## 4. Design for short-lived objects

The design discipline that makes EA pay off:

- **Construct close to use.** Don't construct an object and pass it through five layers before using it. Construct it at the deepest point that needs it.
- **Don't store transient state in fields.** If the value lives for one method call, it's a local variable, not a field.
- **One constructor call per logical operation.** A `record Rect(Coord topLeft, Coord size)` constructed once in a method is one EA target. The same `Rect` re-built three times across helpers is three EA targets — each independent, each subject to its own escape proof.
- **Prefer pure functions on hot paths.** Pure functions don't mutate anything, don't escape anything, are easy to inline, and let EA work.

The shape that emerges from these rules is functional-style code with explicit data flow. That isn't a coincidence — EA is, in essence, a compiler optimization that pays off most when your code is already shaped like a dataflow pipeline.

---

## 5. The cost when EA fails

When EA fails, you pay:

- **Allocation cost.** A 16-byte object costs ~5–10 ns of allocator + TLAB bump time. Negligible per call, painful at 10 million calls per second.
- **GC pressure.** Allocation rate of 200 MB/sec means young gen fills in seconds. GC pauses multiply.
- **Cache misses.** A heap-allocated object lives at some heap address that's probably cold in L1. A scalar-replaced object lives in a register — zero cache cost.
- **Inlining domino.** If EA fails for one object passed through a chain, the compiler often gives up on other optimizations downstream — loss of constant folding, loss of loop unrolling around the call.

The compound cost for a hot path that lost EA is rarely "just 16 bytes". A hot loop that was 3 ns/op with EA can become 25 ns/op without it, between the allocator, GC noise, and lost downstream optimizations. The 8× factor isn't EA itself; it's everything EA was holding together.

---

## 6. Graal's partial-escape analysis vs C2

Graal's PEA is the most interesting EA development of the last decade. Where C2 gives up on the whole allocation if any path escapes, Graal splits per control-flow path:

```java
Result run(int x) {
    Box b = new Box(x);
    return (x % 1000 == 0)
        ? slowPath(b)                                       // escapes (1 in 1000)
        : Result.of(b.value() * 2);                         // does not escape (999 in 1000)
}
```

C2 sees the `slowPath(b)` call, can't inline it, and gives up — `b` is GlobalEscape, every call allocates. Graal sees that on the *common* path `b` never escapes; it scalar-replaces on the common path and *materialises* the allocation lazily only when the slow path is taken. Throughput on the common path: identical to a method without the allocation. Throughput on the slow path: identical to the C2 baseline. The 999/1000 case is free.

Running on Graal (`-XX:+UnlockExperimentalVMOptions -XX:+UseJVMCICompiler -XX:+EnableJVMCI`) often produces 10–30% throughput improvements on allocation-heavy code without any source changes. PEA is the single biggest reason to consider Graal for allocation-sensitive workloads.

---

## 7. Valhalla as the guaranteed alternative

EA is best-effort. Valhalla's value classes are *contractual*:

```java
value class Point {                                         // future syntax (JEP 401 preview)
    int x;
    int y;
}
```

A `Point` declared as a value class has no identity — `==` compares fields. The VM is free to flatten the layout into a field of another value class, into an array slot, into a register, or to heap-allocate if it really must. There is no allocation site to eliminate, because there is no allocation in the first place — the value lives where its container puts it.

The migration path: today's `record` is the closest available approximation. The records you write today will, in many cases, be eligible to become value classes when Valhalla ships, with no source change beyond replacing `record` with `value class` (and possibly `Point!` for non-null fields). The discipline you build with EA-friendly records is the discipline you'll need with value classes — except the JIT's heuristic becomes a language guarantee.

Until Valhalla, EA + records is the production option. Once Valhalla ships, the same code becomes faster and EA can be repurposed to remaining identity-bearing classes.

---

## 8. The optimization triangle

For an allocation site, three things determine whether it costs heap bytes:

1. **Does the reference escape?** If no, EA can eliminate it.
2. **Is the call chain inlineable?** If no, EA can't see across it.
3. **Is the JIT willing to specialise?** If the call site is megamorphic or the method too large, optimization stops.

You optimize for EA by simultaneously: keeping references local (1), keeping classes `final` and methods small (2), and keeping call sites monomorphic (3). Failing any of the three leaves an allocation on the heap. The good news is the three rules align with general OO design discipline — small classes, narrow interfaces, immutability — so the price isn't paid in code complexity.

---

## 9. Quick rules

- [ ] Design pipelines as record-carrying transformations; EA loves them.
- [ ] Verify with `-prof gc` + `-XX:+PrintEliminateAllocations` — `0.0 B/op` is the target.
- [ ] Final classes + static methods give the inliner the strongest possible CHA signal.
- [ ] Don't store transient state in fields; that's what local variables are for.
- [ ] When EA fails, the cost is rarely "just bytes" — downstream optimizations collapse too.
- [ ] Graal's partial-escape analysis handles mixed hot/cold paths that C2 can't.
- [ ] Valhalla value classes will replace EA's heuristic with a language contract; design as if it's already here.

---

## 10. What's next

| Topic                                                                | File                |
| -------------------------------------------------------------------- | ------------------- |
| Hands-on JMH exercises                                               | `tasks.md`          |
| 20 interview Q&A                                                     | `interview.md`      |

See also: [../04-object-memory-layout/](../04-object-memory-layout/) for what an un-eliminated allocation costs in bytes and cache pressure, [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/) for the inlining mechanics EA depends on, and [../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/](../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/) for why immutability is both a correctness tool and an EA enabler.

---

**Memorize this:** EA pays off when three things align — references stay local, calls inline, dispatch is monomorphic. Design for that alignment with records, `final` classes, and pipeline-style transforms. Verify every claim with `-prof gc`. Graal's PEA is the next-generation answer for mixed paths; Valhalla is the contractual answer for the language. Build the discipline now and it carries through both.
