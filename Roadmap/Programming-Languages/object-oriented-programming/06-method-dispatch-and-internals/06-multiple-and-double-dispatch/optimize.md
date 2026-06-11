# Multiple & Double Dispatch — Optimize

> Performance and design-quality optimization for the two-type-dispatch problem. The headline result is counter-intuitive: the "elegant" Visitor is frequently the *slowest* option on real (heterogeneous) data, while the pattern switch you were told to avoid is a flat jump table. This file covers the cost model, a JMH harness, and the design-quality axis (coupling, exhaustiveness, evolvability).

---

## 1. The cost model — what each encoding actually executes

| Encoding              | Per-call work                                         | JIT behaviour                                  |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| Visitor               | 2 virtual calls (`accept`, `visitXxx`)                | Inlines if **mono/bimorphic**; falls off a cliff when **megamorphic** |
| Pattern switch (21)   | 1 `invokedynamic`→`typeSwitch` (amortized), 1 `lookupswitch` jump | Bootstrap runs once; thereafter a JIT-friendly jump table |
| `instanceof` chain    | up to N sequential type tests                         | Each test cheap + predictable; linear in arm count |
| Handler map (`Map<Pair,..>`) | 1 hash + 1 virtual call                         | Hash + megamorphic-ish virtual; allocation if key boxed |

The decisive factor for Visitor is **call-site shape**:

- **Monomorphic** (one runtime type at the site): HotSpot inlines `accept` *and* the inner `visitXxx`. The two hops collapse to near-zero. Fastest case for Visitor.
- **Bimorphic** (two types): still inlined with a type guard.
- **Megamorphic** (3+ types interleaved): exceeds HotSpot's inline-cache capacity. The `accept` site can no longer be inlined; every call is a full itable lookup. This is the case that loses.

A tree walk or a `List<Shape>` with mixed elements drives the `accept` site straight to megamorphic. That is the *normal* case for Visitor, not an edge case.

---

## 2. JMH harness

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Thread)
@Fork(value = 2) @Warmup(iterations = 5) @Measurement(iterations = 5)
public class DispatchBench {

    Shape[] data;     // heterogeneous: Circle/Square/Group interleaved
    final Visitor<Double> areaVisitor = new AreaVisitor();

    @Setup public void setup() {
        var rnd = new Random(42);
        data = new Shape[10_000];
        for (int i = 0; i < data.length; i++)
            data[i] = switch (rnd.nextInt(3)) {
                case 0 -> new Circle(rnd.nextDouble());
                case 1 -> new Square(rnd.nextDouble());
                default -> new Group(List.of(new Circle(1)));
            };
    }

    @Benchmark public double visitor() {
        double s = 0; for (Shape x : data) s += x.accept(areaVisitor); return s;
    }
    @Benchmark public double patternSwitch() {
        double s = 0; for (Shape x : data) s += area(x); return s;   // sealed switch
    }
    @Benchmark public double instanceofChain() {
        double s = 0; for (Shape x : data) s += areaChain(x); return s;
    }
}
```

Run with `-prof gc` and `-prof perfasm`, and separately with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` to *see* whether the `accept` site inlined.

---

## 3. Representative results and how to read them

Exact numbers depend on JDK and hardware — **run it yourself** — but the *shape* of the result is robust across JDK 17–21 on x86-64:

| Benchmark        | Heterogeneous (3 types) | Monomorphic (1 type) |
| ---------------- | ----------------------- | -------------------- |
| `patternSwitch`  | fastest / tied          | fast                 |
| `instanceofChain`| close (few arms)        | fast                 |
| `visitor`        | **slowest** (megamorphic, no inline) | fast (inlined) |

Two takeaways:

1. **In the monomorphic case, all three are close** — the JIT inlines everything; the abstraction is free. So Visitor's overhead is *not* intrinsic; it's a function of call-site polymorphism.
2. **In the heterogeneous case, Visitor loses** because its `accept` site goes megamorphic while the switch stays a jump table. The gap widens as you add more subtypes.

Confirm the *cause*, don't just trust the number: `-XX:+PrintInlining` will show the `accept` call site as `not inlined (megamorphic)` in the heterogeneous run and inlined in the monomorphic run. That line is the actual explanation.

---

## 4. Allocation: a hidden cost of the handler-map approach

The `Map<Pair<Class,Class>, Handler>` collision dispatcher (senior.md §4) allocates a `Pair` key per call unless you cache it, and may box. Under `-prof gc` you'll see allocation pressure the Visitor and switch don't have. Mitigations:

- Use a flattened `IdentityHashMap` or a 2-D array indexed by a small per-type `int` tag (assign each `Body` subtype an ordinal).
- For a *closed* symmetric matrix, a `Handler[][]` indexed by type ordinals is allocation-free and O(1) — the fastest symmetric-dispatch structure, at the cost of a dense table.

```java
// each Body subtype returns a stable small ordinal
Handler[][] table = new Handler[N][N];
Event collide(Body a, Body b) { return table[a.tag()][b.tag()].apply(a, b); }
```

This is what high-performance physics/collision engines actually do — multiple dispatch as array indexing, not virtual calls.

---

## 5. The design-quality axis — "optimize" beyond nanoseconds

For most code, the right optimization target is *cost of change*, not ns/op. Score each encoding on the expression-problem axes and on coupling:

| Criterion                              | Visitor              | Pattern switch (sealed) | `instanceof` chain |
| -------------------------------------- | -------------------- | ----------------------- | ------------------ |
| Add an **operation**                   | cheap (new class)    | cheap (new method)      | cheap (new method) |
| Add a **type**                         | expensive, all visitors recompile | expensive, but **compiler finds every site** | expensive, **silent miss** |
| Exhaustiveness guaranteed              | no                   | **yes** (sealed)        | no                 |
| Coupling of operation to type set      | high (Visitor knows all types) | medium             | medium             |
| Boilerplate                            | high (`accept` ×N)   | none                    | none               |
| Works across module/API boundary       | **yes** (operations added externally) | no (must edit switches) | no |

The single biggest design win available post-Java-21: **seal the hierarchy and use a pattern switch.** It deletes the `accept` boilerplate, makes "add a type" a *compile error* at every stale switch (instead of a silent bug or a recompilation cascade), and removes the megamorphic performance cliff. Visitor's *only* remaining structural advantage is the cross-boundary case — operations contributed by code that cannot edit your switches.

---

## 6. Before / after: a real refactor

**Before** — Visitor over an AST, 9 node types, 4 operations = 1 `Visitor` interface (9 methods) + 4 visitor classes (36 methods) + 9 `accept` methods. Adding a 10th node touches all 4 visitors + the interface + the new node = 6 files, and any forgotten visitor is a recompilation error at best.

**After** — seal the node hierarchy; each operation is one method with a pattern switch. Adding a 10th node: add the record, then every one of the 4 switch methods that isn't exhaustive becomes a **compile error** pointing you exactly where to add a case. Net: ~45 boilerplate methods deleted, `accept` gone, and the compiler became the "find all sites" tool.

When *not* to do this refactor: the node set is a published API others extend with their own node types — then it isn't sealable, and Visitor's open-operation model is correct. Don't seal what you don't own.

---

## 7. Micro-optimizations that actually matter

- **Make leaf types `final` / records.** A `final` element type makes its `accept` (or the switch arm's `instanceof`) monomorphic at that point — the JIT devirtualizes hard. Records are implicitly final.
- **Keep visitors stateless and reused.** A fresh visitor allocation per call adds GC pressure and prevents the JIT from treating the visitor type as stable at the `accept` site.
- **Order `instanceof`-chain arms by frequency.** If you must use a chain, put the hot type first — branch prediction and early exit reward it. Profile the type distribution.
- **Don't reach for `MethodHandle`/reflection-based dispatch tables** unless you've proven the switch/Visitor is the bottleneck — they defeat inlining and rarely win against a `lookupswitch`.

---

## 8. The optimization checklist

- [ ] Is the `accept` call site **megamorphic**? Confirm with `-XX:+PrintInlining` before blaming Visitor.
- [ ] Is the type set **closed**? If yes and you own it → seal + pattern switch; the megamorphic cliff disappears and the compiler enforces exhaustiveness.
- [ ] For **symmetric** dispatch, is the matrix dense? Dense → `Handler[][]` by ordinal (allocation-free). Sparse → `Map<Pair,..>` with a symmetry fallback.
- [ ] Are leaf types `final`/records so the JIT can devirtualize?
- [ ] Did you **measure** before refactoring for speed? Monomorphic Visitor is already free.
- [ ] For design, is the cheap axis (add-type vs add-operation) aligned with expected change? That, not ns/op, is usually the real optimization.

---

**Memorize this:** Visitor's cost is entirely about call-site shape — free when monomorphic, a megamorphic cliff on heterogeneous data, which is the *normal* case for tree/collection walks. A sealed pattern switch lowers to a flat `lookupswitch` with no megamorphic virtual site and gets compiler-checked exhaustiveness for free, making it the default modern choice for closed models. For dense symmetric dispatch, a `Handler[][]` indexed by type ordinals beats everything. Profile with `-XX:+PrintInlining` before assuming, and optimize for *cost of change* unless you're on a proven hot path.
