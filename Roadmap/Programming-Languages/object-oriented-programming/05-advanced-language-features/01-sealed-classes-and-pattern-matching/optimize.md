# Sealed Classes and Pattern Matching — Optimize

> Sealed types and pattern matching are not only design tools — they reshape what the JIT can do. This file walks the runtime mechanics: how pattern-match `switch` lowers through `invokedynamic` to `SwitchBootstraps.typeSwitch`, why sealed-plus-final hierarchies let HotSpot devirtualize completely, what record-pattern destructuring costs at the allocation level, how Class Hierarchy Analysis interacts with `permits`, and how to benchmark sealed switches against polymorphic dispatch with JMH. All numbers are illustrative; verify on your hardware and JDK.

---

## 1. typeswitch lowering — what `javac` emits

A pattern-match `switch` over a sealed type lowers to an `invokedynamic` call bound to `java.lang.runtime.SwitchBootstraps.typeSwitch`. The bootstrap method receives the case label list and returns a `CallSite` whose `MethodHandle` answers "given this scrutinee, which case matches first?"

For:

```java
public sealed interface Op permits Add, Sub, Mul {}
public record Add(long a, long b) implements Op {}
public record Sub(long a, long b) implements Op {}
public record Mul(long a, long b) implements Op {}

public static long eval(Op op) {
    return switch (op) {
        case Add a -> a.a() + a.b();
        case Sub s -> s.a() - s.b();
        case Mul m -> m.a() * m.b();
    };
}
```

`javap -c` shows roughly:

```
0:  aload_0                                   ; load op
1:  iconst_0                                  ; start index
2:  invokedynamic typeSwitch:(LOp;I)I         ; → matching case index
7:  tableswitch
        0:  goto add_branch
        1:  goto sub_branch
        2:  goto mul_branch
        default: athrow MatchException
```

The bootstrap is invoked *once* — subsequent calls reuse the cached `MethodHandle`. The actual dispatch inside the call site is, after JIT compilation, a chain of `instanceof` checks plus type-specific branches.

---

## 2. Sealed + final + monomorphic = full devirtualization

When the sealed type is closed and every permit is `final`, HotSpot's Class Hierarchy Analysis (CHA) can prove the *exact* set of receivers. The C2 compiler then:

- Eliminates the `typeSwitch` indirection — each `case` becomes a direct `instanceof` check.
- Inlines the body of each case using the record's accessors.
- Constant-folds the accessor calls when the receiver type is known.
- Eliminates the heap allocation for the record when escape analysis proves the record doesn't escape.

The compiled code for `eval` ends up roughly:

```
if (op.getClass() == Add.class)      return ((Add)op).a + ((Add)op).b;
else if (op.getClass() == Sub.class) return ((Sub)op).a - ((Sub)op).b;
else                                 return ((Mul)op).a * ((Mul)op).b;   // exhaustive
```

No virtual call, no itable walk, no allocation for the operation results. This is the *full* devirtualization payoff. An open `interface Op` with three implementations achieves the same shape *only if* CHA proves no other implementation exists at JIT time — and the moment a new implementation loads, the code deoptimizes. Sealed + final pins this CHA assumption permanently.

**Inspect:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` shows `(inline)` decisions per case; `-XX:+PrintAssembly` (HSDIS plugin) shows the final machine code.

---

## 3. Bootstrap cost — pay once per call site

The first invocation of a pattern-match `switch` site triggers the `typeSwitch` bootstrap:

```java
SwitchBootstraps.typeSwitch(lookup, name, type, Add.class, Sub.class, Mul.class)
```

Cost of the bootstrap is in the microsecond range — class lookups, `MethodHandle` construction, `CallSite` installation. After installation, the call site is a regular `invokedynamic` invocation with the resolved handle.

This means:

- **Cold start** for a class with many sealed switches pays a small one-time cost per call site.
- **Hot loops** see no bootstrap cost after the first iteration. The JIT then inlines the call site fully, as section 2 describes.
- **Reflection-heavy paths** (e.g., proxies, frameworks that build classes at runtime) need to be careful about call-site churn. A short-lived class with one pattern switch pays the bootstrap and never amortises it.

The bootstrap is a constant overhead, not a per-call cost. Don't optimise against it in steady state.

---

## 4. Record-pattern destructuring — allocation cost

A record pattern like `case Add(long a, long b) -> a + b` calls the record's accessors (`a()`, `b()`). For records with primitive components, this is free — the accessor returns the field directly, no boxing, no allocation.

For records with reference components, the accessors return the reference. No allocation in the destructuring itself.

What *does* allocate is *constructing* records, not destructuring them:

```java
new Add(x, y)         // one allocation
new Sub(a, b)         // one allocation
```

In a hot loop, these constructions might appear expensive — but C2's *escape analysis* often proves the record never escapes and *scalar-replaces* it: the two `long` fields live in registers, no heap allocation occurs. Records cooperate with EA for the same reasons they cooperate with devirtualization:

- Implicitly `final`.
- All fields final.
- No way to leak `this` from an accessor.

```java
public static long sumPairs(long[] xs, long[] ys) {
    long sum = 0;
    for (int i = 0; i < xs.length; i++) {
        Add a = new Add(xs[i], ys[i]);         // logically allocates
        sum += eval(a);                        // EA proves a doesn't escape
    }
    return sum;
}
```

With EA, the loop allocates zero records — `Add` is scalar-replaced. **Confirm:** `-XX:+PrintEliminateAllocations` lists eliminated allocations; `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` shows the inlining decisions.

---

## 5. CHA's role for sealed vs open hierarchies

HotSpot's Class Hierarchy Analysis tracks, per loaded class, the set of currently-known subtypes. It uses this to:

- Decide whether a virtual call is monomorphic, bimorphic, or megamorphic at JIT time.
- Install *dependencies* that the JIT-compiled code's assumptions remain valid — if a new subtype loads that would invalidate an inlining decision, the code is deoptimized and recompiled.

For an **open** `interface Foo`:

- CHA tracks every loaded implementer.
- The JIT inlines monomorphic and bimorphic calls under a dependency on the set being stable.
- A new implementer loaded later triggers deoptimization.

For a **sealed** `interface Foo permits A, B, C` with all permits final:

- CHA knows the set is closed at compile time — no new implementer can appear, ever.
- The JIT inlines without a CHA dependency. The compiled code is permanent until the method is unloaded.
- No deoptimization is triggered by class loading.

This is more than a microoptimisation. A sealed-final hierarchy gives the JIT a *static* dispatch guarantee, which means the assembly for hot paths is shorter, the safepoint handling is simpler, and the inlining decisions are stable across the program's lifetime.

For a sealed type with one or more `non-sealed` permits, CHA still has to track that branch open-world. The `non-sealed` branch loses the full optimisation; the `final` branches keep it.

---

## 6. HotSpot specialization for `tableswitch`-shaped patterns

When a pattern-match `switch` has many cases (say, > 8) and the cases are simple type patterns over sealed leaves, the compiler may lower the `typeSwitch` call to a hash-based dispatch internally. The hash uses the class identity (effectively the address of the `Class<?>` metadata) and the bootstrap precomputes a perfect hash table for the case labels.

The crossover point is implementation-defined. On modern JDK 21+:

- 2–4 cases: linear chain of `instanceof` checks, branch-predicted.
- 5–10 cases: linear chain, still branch-predicted but with cold-path costs starting to show.
- > 10 cases: hash-based dispatch via the bootstrap, near-O(1) lookup.

For typical sealed types (3–6 variants), the linear chain is fastest. Hash dispatch wins when the variant count grows. Don't optimise this by hand — trust the bootstrap; it picks the right shape.

---

## 7. Allocation cost of record-pattern destructuring inside a `switch`

Each `case` arm of a pattern-match `switch` is its own scope. Variables bound by a record pattern live only in that scope. The JIT sees:

```java
case Add(long a, long b) -> a + b;
```

as approximately:

```
if (scrutinee.getClass() == Add.class) {
    Add tmp = (Add) scrutinee;
    long a = tmp.a();
    long b = tmp.b();
    return a + b;
}
```

The accessors are inlined, the locals live in registers, no boxing. For primitive components, this is a couple of `mov` instructions. For reference components, the accessor returns the reference and the cost is identical to a field load.

**Where it gets expensive:** when a record carries collections or other objects, and the destructured value is then passed to a method that escapes it. Then EA cannot prove non-escape, and any temporary records you construct inside the `case` arm allocate normally. Hot-loop record destructuring is cheap *only when* the destructured values do not escape.

---

## 8. Benchmark — sealed switch vs polymorphic dispatch

A worked JMH harness comparing three OCP-respecting styles for the same dispatch.

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
@State(Scope.Benchmark)
@Fork(value = 2)
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
public class SealedBench {

    public sealed interface Op permits Add, Sub, Mul {}
    public record Add(long a, long b) implements Op {}
    public record Sub(long a, long b) implements Op {}
    public record Mul(long a, long b) implements Op {}

    public interface PolyOp { long apply(); }
    public static final class PolyAdd implements PolyOp {
        private final long a, b;
        public PolyAdd(long a, long b) { this.a = a; this.b = b; }
        public long apply() { return a + b; }
    }
    public static final class PolySub implements PolyOp {
        private final long a, b;
        public PolySub(long a, long b) { this.a = a; this.b = b; }
        public long apply() { return a - b; }
    }
    public static final class PolyMul implements PolyOp {
        private final long a, b;
        public PolyMul(long a, long b) { this.a = a; this.b = b; }
        public long apply() { return a * b; }
    }

    @Param({"ADD", "SUB", "MUL"}) String which;
    Op    sealedOp;
    PolyOp polyOp;

    @Setup public void init() {
        sealedOp = switch (which) {
            case "ADD" -> new Add(3L, 5L);
            case "SUB" -> new Sub(7L, 4L);
            case "MUL" -> new Mul(6L, 9L);
            default    -> throw new IllegalStateException();
        };
        polyOp = switch (which) {
            case "ADD" -> new PolyAdd(3L, 5L);
            case "SUB" -> new PolySub(7L, 4L);
            case "MUL" -> new PolyMul(6L, 9L);
            default    -> throw new IllegalStateException();
        };
    }

    @Benchmark public long sealedSwitch() {
        return switch (sealedOp) {
            case Add(long a, long b) -> a + b;
            case Sub(long a, long b) -> a - b;
            case Mul(long a, long b) -> a * b;
        };
    }

    @Benchmark public long polymorphic() {
        return polyOp.apply();
    }
}
```

Typical results on a modern x64 JDK 21:

| Bench                       | ns/op  | Notes                                              |
|-----------------------------|--------|----------------------------------------------------|
| `sealedSwitch` (monomorphic per @Param) | ~0.5 | typeSwitch inlined, record pattern scalarised  |
| `polymorphic` (monomorphic per @Param)  | ~0.5 | CHA proves single impl per param, fully inlined |
| `sealedSwitch` (all three mixed in one run) | ~1.5 | type-check chain, still inlined per case      |
| `polymorphic` (all three mixed in one run)  | ~6.0 | megamorphic invokeinterface, no inlining        |

The headline: **polymorphism is fastest when monomorphic and slowest when megamorphic.** Sealed switch is consistently fast regardless of the type distribution because the JIT has the closed set baked in and can keep the dispatch as a static type-check chain.

For *open* hierarchies where the runtime distribution is unknown, sealed types are the strict win. For closed hierarchies where you can already prove monomorphic, they tie. Sealed types are *never slower* in this comparison.

---

## 9. When polymorphism wins

Sealed switches lose to polymorphism in one situation: when the *operation* is also a closed set and the implementation is naturally a per-type method. Then a virtual call has a single inlining target and the switch is redundant.

```java
public sealed interface Shape permits Circle, Square, Triangle {
    double area();
}
public record Circle(double r) implements Shape {
    public double area() { return Math.PI * r * r; }
}
// etc.

public double total(List<Shape> shapes) {
    double sum = 0;
    for (Shape s : shapes) sum += s.area();   // virtual call, monomorphic per element
    return sum;
}
```

The virtual `s.area()` call is monomorphic at each iteration if the list is type-mixed; the JIT inlines per inline cache slot (bimorphic up to two types). For a list with one shape type, it's faster than the equivalent `switch` because there's no type-check chain — just the direct dispatch on the receiver.

The rule of thumb:

- **Operations on the type** (one method per variant) — polymorphism.
- **Operations from outside** (a third party wants to dispatch on the variant) — sealed + switch.
- **Both** — define the method on the type for the natural cases and use a `switch` for the outside-defined operations.

Sealed types and polymorphism are complementary, not competing. Choose by where the operations live.

---

## 10. Quick rules — performance-oriented sealed design

- [ ] Keep permits `final`. The JIT optimises the closure best when no branch is open.
- [ ] Use record patterns for destructuring. Records cooperate with escape analysis; no boxing, no allocation.
- [ ] Avoid `non-sealed` in performance-critical code. It reintroduces CHA dependencies.
- [ ] For 2–6 variants, the typeswitch chain is fastest. Don't try to hand-roll a hash.
- [ ] Constructions of records inside hot loops often get scalar-replaced by EA. Confirm with `PrintEliminateAllocations`.
- [ ] For operations natural to the type, prefer polymorphism (virtual call) over a sealed switch. For operations defined outside the type, prefer the switch.
- [ ] Bootstrap cost is paid once per call site. Don't measure it in microbenchmarks unless cold start matters.
- [ ] When benchmarking, separate monomorphic and megamorphic test cases. Sealed switch is consistent; polymorphism varies wildly.
- [ ] Inspect with `-XX:+PrintInlining`, `-XX:+PrintEliminateAllocations`, and JFR. Don't guess; measure.
- [ ] The performance gap between sealed switch and polymorphism is small in monomorphic code. The gap is *large* (5–10x) in megamorphic code. Design accordingly.

The general law: sealed + record + pattern switch is the JIT-friendliest shape for closed-world dispatch. The JIT can do for sealed types what it cannot do for open hierarchies — *prove* the closure and bake it into the compiled code. Where performance matters, sealing is not a performance cost; it is a performance lever.
