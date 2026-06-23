# OO Abusers — Professional Level

> Focus: runtime cost of polymorphism vs. switch, JIT devirtualization, vtables, pattern matching internals.

---

## Table of Contents

1. [The cost of virtual dispatch](#the-cost-of-virtual-dispatch)
2. [JIT devirtualization](#jit-devirtualization)
3. [Inline caches: monomorphic, bimorphic, megamorphic](#inline-caches-monomorphic-bimorphic-megamorphic)
4. [Pattern matching at the bytecode level](#pattern-matching-at-the-bytecode-level)
5. [Sealed types — what the JVM actually checks](#sealed-types-what-the-jvm-actually-checks)
6. [Switch optimizations: tableswitch vs lookupswitch](#switch-optimizations-tableswitch-vs-lookupswitch)
7. [Go interfaces and itable cost](#go-interfaces-and-itable-cost)
8. [Composition vs inheritance — runtime costs](#composition-vs-inheritance-runtime-costs)
9. [Profiling polymorphic code](#profiling-polymorphic-code)
10. [Review questions](#review-questions)

---

## The cost of virtual dispatch

A virtual method call has these costs:

1. **Vtable lookup**: 1 indirection to find the vtable, 1 to load the function pointer.
2. **Indirect branch**: the CPU branches to a computed address — harder to predict than a direct call.
3. **Cache miss**: if the target hasn't been recently called, the icache may not have its instructions warm.

In a hot loop calling `shape.area()` over a list of shapes, this can be ~3–10x slower than a direct call to a single function — *if* the JIT can't optimize.

But: modern JITs *can* optimize, often eliminating most of the cost. The Switch Statements smell isn't really about performance — it's about maintainability.

---

## JIT devirtualization

HotSpot, V8, and modern JITs perform **devirtualization**: at runtime, they observe what concrete types actually appear at a call site and rewrite the virtual call to a direct call (with a guard).

```java
for (Shape s : shapes) {
    total += s.area();  // virtual call
}
```

If the JIT observes that `s` is always a `Circle`:

```java
// JIT-compiled equivalent:
for (Shape s : shapes) {
    if (s.getClass() == Circle.class) {
        total += /* inlined Circle.area body */;
    } else {
        // deopt; recompile
    }
}
```

Now the call is direct *and* inlinable. Cost approaches the manually-coded switch.

### When devirtualization works

- **Monomorphic** call site: 1 type observed → direct call + guard.
- **Bimorphic**: 2 types → 2-way branch with 2 inlined bodies.
- **Megamorphic**: 4+ types → falls back to vtable lookup.

The threshold (4 types in HotSpot) is in `vm/code/codeCache.cpp` — not user-tunable in production.

### Verifying with `-XX:+PrintInlining`

```
@ 12 com.example.Geometry::area (5 bytes)   inline (hot)
  @ 1 com.example.Shape::area (-1 bytes)    monomorphic call site (Circle)
  @ 5 com.example.Circle::area (15 bytes)   inline (hot)
```

`monomorphic call site` confirms devirtualization happened. `megamorphic call site` would mean the JIT gave up on direct inlining.

---

## Inline caches: monomorphic, bimorphic, megamorphic

The above is implemented via **inline caches** (ICs) — small per-call-site state machines.

| State | Behavior |
|---|---|
| **Uninitialized** | First call — patch IC with the receiver type. |
| **Monomorphic** | One type seen — direct call to that type's method. Guard on type. |
| **Bimorphic** | Two types — branch on which, direct call to either. |
| **Polymorphic (or "Polymorphic Inline Cache")** | 3 types in HotSpot's case — small switch. |
| **Megamorphic** | 4+ types — vtable lookup, no inlining. |

V8 has the same architecture (4 stages: uninitialized, monomorphic, polymorphic, megamorphic).

### Practical implication for OO Abusers

If `shape.area()` is called over a `List<Shape>` containing 10 different shape types, the call site is megamorphic. Performance:

| Implementation | Throughput (relative) |
|---|---|
| Switch with 10 cases | 100% (baseline) |
| Polymorphism, monomorphic in benchmarks | 100% (devirtualized) |
| Polymorphism, megamorphic | ~30-60% (vtable cost) |

In *realistic* code, where each shape type is used in different code paths, most call sites are mono or bimorphic. The megamorphic case is rare. Don't sacrifice maintainability for perf you don't need.

> **Empirical guideline:** profile before deciding. The "polymorphism is slow" intuition usually misleads.

---

## Pattern matching at the bytecode level

Java 21's pattern matching in `switch` compiles down to a sequence of `instanceof` checks plus method calls. For sealed types, the compiler emits an *exhaustive* check.

```java
sealed interface Shape permits Circle, Square {}
record Circle(double r) implements Shape {}
record Square(double s) implements Shape {}

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.s() * sq.s();
    };
}
```

Bytecode (simplified):

```
aload_1
instanceof Circle
ifeq L_square
checkcast Circle
invokevirtual Circle.r()
... compute area ...
return

L_square:
aload_1
instanceof Square
ifeq L_else
checkcast Square
... compute area ...
return

L_else:
new MatchException
... throw ...
```

For 2 cases, this is competitive with manual `instanceof` chains. For many cases, the compiler may use `tableswitch`-like techniques (especially when the patterns are on integers/strings).

### Indify pattern matching (JDK internals)

Java 21+ uses **indy** (`invokedynamic`) for pattern matching to support future optimizations — including potentially generating a faster dispatch based on observed types at runtime. This is similar to how `String.format` and lambdas work.

---

## Sealed types — what the JVM actually checks

`sealed interface Shape permits Circle, Square` adds a `PermittedSubclasses` attribute to the class file. At class-load time, the JVM verifies:

1. Each `permits` entry exists.
2. Each `permits` entry's superclass/superinterface is exactly the sealed type.
3. No other class declares the sealed type as a parent (would be `IncompatibleClassChangeError`).

After load, sealed types behave like regular polymorphism — there's no runtime cost difference vs. an unsealed type.

The compile-time exhaustiveness check is **only at compile time**. At runtime, the JVM doesn't recheck — it trusts the compiler. (If you load classes via reflection that violate sealing, the verifier catches it at load.)

---

## Switch optimizations: tableswitch vs lookupswitch

JVM bytecode has two switch instructions:

- **`tableswitch`**: O(1) jump via index. Used when cases are dense (e.g., 1, 2, 3, 4, 5).
- **`lookupswitch`**: O(log n) binary search. Used when cases are sparse (e.g., 1, 100, 9000).

A modern compiler picks based on case density. A `switch (color) { case RED, GREEN, BLUE: ... }` (enum ordinals 0, 1, 2) generates `tableswitch` — single-instruction dispatch.

### Comparison

| Operation | Cost (rough) |
|---|---|
| Direct call | 1 cycle |
| `tableswitch` jump | 1-2 cycles + indirect branch |
| `lookupswitch` binary search | log(n) compare-and-branch |
| Vtable call (monomorphic via IC) | 1-2 cycles + guard |
| Vtable call (megamorphic) | 5-15 cycles + cache miss |

For dense cases, switch is roughly equivalent to monomorphic virtual dispatch — confirming "polymorphism vs switch" is mostly a maintainability question, not a perf question.

---

## Go interfaces and itable cost

Go interfaces are implemented via **itables** (interface tables): a pair `(type pointer, function pointers)`. Calling an interface method:

1. Dereference the interface to get the itable.
2. Look up the method pointer.
3. Indirect call.

Cost: ~2-3 cache-friendly indirections. Like JVM virtual calls, modern Go has speculative devirtualization in some cases (especially with PGO).

### Profile-guided optimization (Go 1.21+)

Go 1.21+ supports PGO. Compile with `-pgo=profile.pprof`; the compiler devirtualizes hot interface calls based on profiles. A megamorphic interface call observed in the profile becomes a switch with monomorphic fast paths.

### Concrete vs interface — measure

```go
type Shape interface { Area() float64 }

func Sum(shapes []Shape) float64 {
    total := 0.0
    for _, s := range shapes { total += s.Area() }
    return total
}

func SumCircles(circles []Circle) float64 {
    total := 0.0
    for _, c := range circles { total += c.Area() }
    return total
}
```

Without PGO, `Sum` is ~30% slower than `SumCircles` in tight loops. With PGO and a profile dominated by `Circle`, `Sum` matches `SumCircles`. Verify with `go test -bench`.

---

## Composition vs inheritance — runtime costs

Replacing inheritance with delegation often *adds* indirection:

```java
// Before (inheritance)
class Bird {
    public void fly() { /* ... */ }
}
class Eagle extends Bird {
    @Override public void fly() { /* eagle fly */ }
}

// Eagle.fly() — direct call after devirtualization

// After (delegation)
class Bird {
    private final Flyability flyability;
    public void fly() { flyability.fly(); }
}

// bird.fly() — extra method dispatch through flyability
```

In hot paths, the extra dispatch may matter. In practice:

- **HotSpot** inlines `Flyability` interface calls if the IC is monomorphic — no extra cost.
- **Go** without PGO: extra interface dispatch, ~30% slower in microbenchmarks.
- **Go** with PGO: ~no overhead.
- **Python**: every attribute access is dict lookup; delegation adds another lookup. ~10-20% overhead.

**Decision:** for normal code, prefer composition (clarity wins). For ultra-hot paths, profile and consider keeping inheritance.

---

## Profiling polymorphic code

### Async-profiler with `-e wallclock`

Identifies which call sites are spending time in vtable dispatch vs. inlined code. Look for:

- Frames named `vtable_call` or `interface_call`
- Wide stacks at the call site (not inlined → frame visible)

### JFR with "TLAB and Allocation Profiling"

Indirectly: megamorphic call sites often defeat escape analysis (the JIT can't prove the receiver type). Watch for unexpected allocations on what should be allocation-free code paths.

### Linux perf with `perf record -g`

System-wide; can identify branch mispredictions:

```bash
perf stat -e branch-misses,instructions ./my-app
```

A 5%+ branch-miss rate on hot code may indicate megamorphic calls.

---

## Review questions

1. **Why is `switch` sometimes faster than polymorphism in microbenchmarks but not in production?**
   Microbenchmarks usually have one type at the call site → JIT devirtualizes → polymorphism matches switch. In production, behaviour depends on the actual mix of types — usually still mono/bimorphic at most call sites. The "switch is faster" intuition comes from bad benchmarks (megamorphic) or pre-JIT code.

2. **Inline cache states — how do you observe them in HotSpot?**
   `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`. Look for `monomorphic call site`, `bimorphic call site`, `megamorphic call site` annotations on the call.

3. **What's the cost of `instanceof` in modern JVMs?**
   For final classes (or in sealed contexts with the runtime knowing the closed set): essentially free — single class-pointer compare. For non-final classes, a small subtype-check (constant-time for the standard JVM hierarchy with display tables).

4. **Pattern matching with sealed types — what happens at runtime?**
   The compiler emits `instanceof` chains (or `tableswitch` for some patterns). The JVM doesn't have first-class pattern-matching bytecode — Project Amber's "primitive patterns" may add it later. For now, sealed + switch is sugar over conventional dispatch.

5. **Why might Replace Conditional with Polymorphism *hurt* performance?**
   If the call site becomes megamorphic (4+ types), the JIT can't devirtualize — vtable cost per call. If the original switch was over 3-4 dense cases (compiled as `tableswitch`), it was ~free. Verify with `-XX:+PrintInlining` before assuming polymorphism is faster.

6. **Go's interface dispatch vs. Java's vtable — which is faster?**
   Roughly equivalent. Java has slightly faster monomorphic ICs (HotSpot is very mature). Go has a simpler dispatch model (no class hierarchy, no abstract methods, no interface-vs-virtual distinction). Both are dominated by cache and branch prediction at the limits.

7. **PGO in Go — does it eliminate the need to refactor switches?**
   PGO devirtualizes hot interface calls based on observed profiles. For switch-vs-polymorphism, PGO closes the gap. But PGO doesn't help maintainability — the code still has the switch smell. Refactor for the human readers; trust the JIT/PGO for performance.

8. **Project Valhalla and switches — any interaction?**
   Not directly. Valhalla introduces value classes; switches don't change. But pattern matching on value classes (Project Amber) becomes more efficient because no boxing is needed. Modern Java is converging on a clean fusion of value types + sealed types + pattern matching.

9. **Why does V8 have "MegaMorphic Call Stub"?**
   Same idea as JVM's vtable fallback. When V8 observes 4+ shape transitions at a property access or call, it falls back to a generic stub that does a hash lookup. Polymorphism in JS is structurally similar to JVM polymorphism in this regard.

10. **A profiler shows 8% time in interface dispatch. Refactor strategy?**
    Diagnose first: which call site is hot? Is it megamorphic or just slow due to deeper issues (large objects, GC)? Cures, in order: (a) ensure the call site is actually hot (8% time at the dispatch instruction is rare); (b) try PGO if available; (c) consider monomorphizing — extract a specialized version for the dominant type, fall back to generic for others; (d) only as last resort, replace polymorphism with switch.

---

> **Next:** [interview.md](interview.md) — Q&A across all levels.
