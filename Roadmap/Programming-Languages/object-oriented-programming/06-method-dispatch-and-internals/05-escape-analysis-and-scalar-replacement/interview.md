# Escape Analysis and Scalar Replacement — Interview Q&A

20 questions covering EA's definition, scalar replacement, lock elision, the C2/Graal comparison, what defeats EA, Valhalla, JMH verification, and hot-path design.

---

## Q1. What is escape analysis, in one sentence?

A JIT-time analysis that asks, for each allocation site, whether the object's reference is observable outside the method that created it; if not, the allocator and the heap can be skipped.

**Follow-up.** "Is it part of the JLS?" No. EA is an implementation matter, not a language feature. The JLS permits it by *omission* — nothing in the spec requires `new` to reach the heap if the observable behaviour is preserved.

---

## Q2. What are the three escape states C2 distinguishes?

- **NoEscape** — reference does not leave the method, not stored in any heap-reachable location. Eligible for scalar replacement.
- **ArgEscape** — passed as an argument to a method the JIT can't inline through. Not scalar-replaceable, but eligible for lock elision and some partial optimisations.
- **GlobalEscape** — returned, stored in a reachable field, passed to native code, or otherwise made visible outside the method. No optimisation possible.

---

## Q3. What is scalar replacement?

When EA proves an allocation is NoEscape, scalar replacement is the follow-up pass that rewrites the SSA graph: instead of allocating an object with fields, the JIT creates one scalar SSA value per field. Those scalars are then assigned to registers (or stack slots if register pressure is high) by the register allocator. No object exists on the heap; the fields exist as individual variables.

**Trap.** Saying "the object is allocated on the stack". HotSpot doesn't actually stack-allocate; it scalar-replaces. The observable effect is the same — no heap allocation — but the mechanism is different.

---

## Q4. How does lock elision relate to EA?

A `synchronized` block on a NoEscape object protects against threads that, by EA's proof, cannot exist. The JIT eliminates both the `monitorenter` and `monitorexit` since the lock cannot be contended. This is why `synchronized (new StringBuilder())` compiles to the same machine code as the unsynchronized version — EA proves the StringBuilder is thread-local.

---

## Q5. Why might EA fail on a record that "should" be EA-friendly?

Common reasons:

- The record is stored in a field reachable from outside the method.
- The record is returned.
- The record is passed to a method the JIT cannot inline (megamorphic call, too-large method, native call, reflective call).
- The record has a `volatile` field.
- The record is captured by a long-lived lambda.

EA is a property of the *call site*, not the type. A record helps but doesn't guarantee.

---

## Q6. Why doesn't a `synchronized` block on a local object cost anything?

Two reasons combined: (1) EA proves the object is NoEscape, so no other thread can possibly see it; (2) the lock-elision pass uses that proof to eliminate `monitorenter` and `monitorexit`. The result is identical machine code to the non-synchronized version. If EA fails on the object, the lock becomes a real lock — which is why you shouldn't *rely* on elision stylistically.

---

## Q7. Show a code snippet that allocates millions of objects per second yet has zero allocation rate in `-prof gc`.

```java
public record Point(double x, double y) {}

@Benchmark
public double consume(Blackhole bh) {
    double sum = 0;
    for (int i = 0; i < 1_000_000; i++) {
        Point p = new Point(i, i);
        sum += p.x() + p.y();
    }
    return sum;
}
```

Despite a million `new Point(...)` per benchmark op, EA eliminates every allocation — `p` is NoEscape because only its fields are read. `gc.alloc.rate.norm` reports `0.0 B/op`.

**Trap.** Concluding "allocation is free". It is free *here* because EA succeeded. Add `bh.consume(p)` instead of `p.x() + p.y()` and the allocation comes back as 16 B/op.

---

## Q8. What's the difference between C2's EA and Graal's partial-escape analysis?

C2 classifies the whole allocation: NoEscape or escape. If any code path escapes, the allocation stays on the heap on *every* path.

Graal's PEA splits per control-flow path. An object that escapes only on a rare error path is scalar-replaced on the common path; the allocation is *materialised* lazily on the escaping path, reconstructed from the scalar values. The hot path runs allocation-free; the cold path takes the C2-style hit.

For mixed hot/cold paths this is a significant win — often 10–30% on allocation-heavy workloads.

---

## Q9. Why don't arrays scalar-replace in HotSpot C2?

Scalar replacement works field-by-field: each field of the object becomes an SSA value. Array elements are accessed by index, not by static name; the analysis can't enumerate them at compile time, and the result needs contiguous indexable storage. C2 doesn't handle this. Graal's PEA handles some constant-index array cases. Valhalla's value classes will give arrays of value types flat layout by spec.

**Workaround.** Replace small fixed-size arrays with records: `new double[]{ min, max }` becomes `new MinMax(min, max)` and EA-replaces.

---

## Q10. What does `-XX:+PrintEliminateAllocations` print?

For each allocation site C2 eliminated, a log line giving the allocation type, the compiling method, and the bytecode index of the `new` instruction. Sample:

```
++++ Eliminated: 156 Allocate
  Type:      Point
  In method: com/acme/Geometry::sumDistances
  Bytecode:  bci 17
```

If you expected an elimination and don't see it, EA failed. Pair with `-XX:+PrintEscapeAnalysis` to see the *reason* (GlobalEscape via field, return, etc.).

---

## Q11. What's the relationship between inlining and EA?

EA across a call boundary requires the call to be inlined. If `compute(p)` is not inlined, the JIT treats `p` as potentially escaping inside `compute`; even if the body of `compute` is harmless, the analysis is conservative. Inlining is gated by method size (`MaxInlineSize`, `FreqInlineSize`), depth (`MaxInlineLevel`), and dispatch resolvability (monomorphic call sites inline freely; megamorphic ones don't).

Practically: a megamorphic call defeats both inlining *and* EA on any argument passing through it.

---

## Q12. Does EA happen in C1?

Effectively no. C1 (the client compiler) prioritises compile speed over optimization. EA is a C2 optimization. Methods that warm up but never reach C2 — short-lived hot spots — miss EA. This is one reason tiered compilation matters: C1 first for warmup, C2 promotion for full optimization.

---

## Q13. Will Valhalla replace EA?

No — Valhalla makes EA *less necessary* for value classes by guaranteeing flat layout, but it doesn't remove EA for identity-bearing classes. After Valhalla:

- Value classes (declared `value class Point`) are flat by contract — no allocation to eliminate.
- Identity classes (today's normal classes) still benefit from EA for short-lived locals.

So EA remains the optimization for "should-have-been-a-value-class-but-isn't" code.

---

## Q14. How do you verify a method is allocation-free?

Three signals, in increasing order of cost and reliability:

1. **JMH `-prof gc`** — `gc.alloc.rate.norm: 0.0 B/op` is the cheap, automated signal.
2. **`-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`** — the compiler's own log, confirming which sites were eliminated.
3. **`async-profiler -e alloc` or JFR's `jdk.ObjectAllocationInNewTLAB`** — production-grade verification on the *real* workload, not a synthetic benchmark.

A claim of allocation-free hot path must come with at least one of these. "I think EA handles it" is not evidence.

---

## Q15. What's a common JMH mistake that misleads about allocation cost?

A benchmark that consumes the result locally and reports `0 B/op`, leading the engineer to conclude allocation is free. Example:

```java
@Benchmark
public double allocate() {
    Point p = new Point(1, 2);
    return p.x + p.y;                         // EA eliminates the allocation
}
```

The benchmark measures the scalar-replaced case. Real call sites that store the result in a field or pass it across a megamorphic call allocate normally. The fix: match the benchmark to the real escape pattern, or use `Blackhole.consume(p)` to force escape.

---

## Q16. How does `final` help EA?

A `final` class cannot be subclassed, so the JIT's Class Hierarchy Analysis returns an unconditional answer for virtual calls on it — they inline unconditionally. Inlining is the precondition for cross-method EA. Records are implicitly `final`; explicit `final` classes provide the same signal.

For non-final classes, CHA can sometimes prove "no subclass has loaded yet" and inline speculatively, but this is fragile — a future class load can deoptimise the inline and bring allocations back.

---

## Q17. Why do lambdas with captures often escape?

A lambda with captures is a synthetic class instance whose fields hold the captures. If the lambda is stored in a collection, returned, or passed across a method boundary the JIT can't see through, the lambda instance escapes — and so do its captures. Non-capturing lambdas are static singletons and never allocate.

The pragmatic rule: lambdas used immediately in a stream or `forEach` often EA-eliminate via inlining; lambdas stored or passed to async APIs do not.

---

## Q18. Critique this snippet from an EA standpoint.

```java
public class TransformPipeline {
    private final List<Function<Point, Point>> transforms;

    public Point apply(Point p) {
        for (Function<Point, Point> t : transforms) {
            p = t.apply(p);
        }
        return p;
    }
}
```

Two problems: (1) the call site `t.apply(p)` is *interface* dispatch on `Function`, and with arbitrary transforms in the list it's likely megamorphic — no inlining, no cross-call EA. Every intermediate `Point` allocates on the heap. (2) The method returns `p`, so even the final `Point` is GlobalEscape.

The fix: replace the generic `Function`-list with a small set of concrete, `final` transform classes (or codegen a fused pipeline), make the dispatch monomorphic, and consider whether the caller really needs the `Point` or just its fields.

---

## Q19. When is it wrong to optimise for EA?

When the method isn't hot. A method that runs 100 times a day allocates trivially regardless of EA. EA-friendly code can be more constrained (smaller methods, final classes, no captures) and that constraint has design costs. Apply EA discipline only where:

- The method is on a hot path (≥ 1 000 calls/sec).
- The allocation rate is visible in `gc.alloc.rate` or GC pause time.
- The performance budget actually depends on it.

Otherwise, optimise for readability. Records and streams are fine even with some allocation.

---

## Q20. What's the future of EA?

Three threads:

- **Graal's partial-escape analysis** is the immediate next step — strictly stronger than C2's whole-object EA. Already available in GraalVM.
- **Valhalla's value classes** (JEP 401 preview) replace EA's heuristic with a layout *contract* for types that opt in.
- **Project Panama** indirectly: value types over foreign memory remove some boxing patterns EA was working around.

The trend is: EA stays for identity-bearing classes that happen to be local, while value classes and primitives eliminate the *need* for EA on value carriers entirely.

---

## What's next

This was the final file for `05-escape-analysis-and-scalar-replacement`. Continue to `06-method-dispatch-and-internals/06-...` once added, or return to the section index.

See also: [../04-object-memory-layout/](../04-object-memory-layout/), [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/), [../../03-design-principles/](../../03-design-principles/), and [../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/](../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/).

---

**Memorize this:** EA in interview terms is one paragraph (does the reference escape? if not, no heap allocation), one trio (NoEscape / ArgEscape / GlobalEscape), three precondtions (locality, inlining, monomorphism), three failure modes (field store, return, megamorphic call), and one future (Graal PEA + Valhalla). Tie every answer to verifiable evidence — `-prof gc`, `PrintEliminateAllocations`, or a production profile.
