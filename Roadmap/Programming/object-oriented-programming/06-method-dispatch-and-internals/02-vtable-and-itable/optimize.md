# vtable and itable — Optimize

> The cost model of vtable and itable dispatch in concrete numbers, the levers the JIT uses to remove that cost, JMH benchmarks that measure it, and a recipe for keeping hot polymorphic code monomorphic. Numbers here are order-of-magnitude on modern x86-64 (Intel Ice Lake / AMD Zen 3) running JDK 21; relative differences are stable across hardware.

---

## 1. The cost units

When discussing dispatch overhead, work in *cycles* or *nanoseconds*, not abstract complexity classes. Useful baselines:

| Operation                                | Latency      |
| ---------------------------------------- | ------------ |
| L1 cache hit                              | ~1 ns         |
| L2 cache hit                              | ~3 ns         |
| L3 cache hit                              | ~12 ns        |
| Main memory                               | ~80-120 ns    |
| Branch (predicted)                        | <1 ns         |
| Branch (mispredicted)                     | ~5-15 ns      |
| Direct call                               | ~1 ns         |
| Indirect call (well-predicted target)     | ~1-2 ns       |
| Indirect call (target prediction miss)    | ~10-15 ns     |

Vtable and itable dispatch translate into combinations of these. The dispatch *itself* is cheap; the *consequence* — preventing inlining of the callee — is usually the bigger cost.

---

## 2. The vtable call — measured

A `invokevirtual` to a method that the JIT did not devirtualize:

```
1. load klass*    [obj+8]            ; L1 hit if obj is hot, ~1 ns
2. load method*   [klass+vt_off+i*8] ; L1 hit if Klass is hot, ~1 ns
3. indirect call  [method*]          ; ~1-2 ns
```

Total: ~3-4 ns when warm. Compared to a direct call (~1 ns), the indirection costs ~2-3 ns per call. In a tight loop running a billion times, that's 2-3 seconds of CPU.

The *real* cost is the foregone inlining: if the callee is a one-line accessor (`return this.x;`), inlining replaces the call with the field load and enables constant folding, scalar replacement, and loop optimisations. A 1 ns dispatch becomes a 0.1 ns inlined load, plus second-order optimisations. Devirtualization is worth more than its raw cycle saving.

---

## 3. The itable call — measured

A `invokeinterface` that the JIT did not devirtualize and where the inline cache misses:

```
1. load klass*                      ~1 ns
2. compare secondary super cache    ~1 ns
3. on hit: load itable offset       ~1 ns
4. load method* from itable         ~1 ns
5. indirect call                    ~1-2 ns
```

Total: ~5-6 ns warm, with a cache hit. On a cache miss (rare with the JDK 21+ packed cache; common on JDK 17 for classes with 10+ interfaces): add 5-20 ns for the linear scan. So `invokeinterface` is roughly *1.5x to 4x* the cost of `invokevirtual` in the megamorphic case. Bimorphic and monomorphic via inline cache: identical to vtable.

A monomorphic `invokeinterface` after inline-cache promotion:

```
1. load klass*                      ~1 ns
2. compare to expected klass        ~1 ns (predicted equal)
3. direct call                       ~1 ns
```

Total: ~3 ns. Almost the same as `invokevirtual`. This is the hot-path case the JIT optimises for.

---

## 4. JMH benchmark — monomorphic vs. polymorphic loops

```java
@State(Scope.Benchmark)
public class DispatchBench {
    interface Shape { double area(); }
    static final class Circle    implements Shape { double r;  Circle(double r){this.r=r;}    public double area(){return Math.PI*r*r;} }
    static final class Rectangle implements Shape { double w,h;Rectangle(double w,double h){this.w=w;this.h=h;}public double area(){return w*h;} }
    static final class Triangle  implements Shape { double b,h;Triangle(double b,double h){this.b=b;this.h=h;}public double area(){return 0.5*b*h;} }

    Shape[] mono, bi, mega;

    @Setup public void setup() {
        int n = 10_000;
        mono = new Shape[n]; bi = new Shape[n]; mega = new Shape[n];
        for (int i = 0; i < n; i++) {
            mono[i] = new Circle(i);
            bi[i]   = (i % 2 == 0) ? new Circle(i) : new Rectangle(i, i);
            mega[i] = switch (i % 3) {
                case 0 -> new Circle(i);
                case 1 -> new Rectangle(i, i);
                default -> new Triangle(i, i);
            };
        }
    }

    @Benchmark public double monomorphic() { double s=0; for (Shape sh : mono) s += sh.area(); return s; }
    @Benchmark public double bimorphic()    { double s=0; for (Shape sh : bi)   s += sh.area(); return s; }
    @Benchmark public double megamorphic() { double s=0; for (Shape sh : mega) s += sh.area(); return s; }
}
```

Typical results on JDK 21, Linux x86-64:

```
Benchmark                  Mode  Cnt   Score    Error  Units
DispatchBench.monomorphic  avgt    5   8.2 ±   0.1   us/op
DispatchBench.bimorphic    avgt    5  11.7 ±   0.2   us/op
DispatchBench.megamorphic  avgt    5  28.3 ±   0.4   us/op
```

That's: monomorphic ~free (inlined), bimorphic ~40% slower (two guarded calls, partial inlining), megamorphic ~3.5x slower (full itable lookup per iteration, no inlining).

The takeaway: shape your data and your loops so polymorphic call sites stay monomorphic *per call site location*, even if the program as a whole handles many types.

---

## 5. CHA + final + sealed for devirtualization

The JIT's Class Hierarchy Analysis (CHA) inspects loaded classes to decide whether a virtual call can be replaced with a direct call. Three things help CHA succeed:

- **`final` class.** No subclass exists. The call has exactly one target.
- **`final` method.** The slot can't be overridden further. If the static type is `Parent` and `m` is `final` in `Parent`, devirtualization is unconditional.
- **`sealed` interface or class with a small `permits` list.** CHA can enumerate all targets; bimorphic/trimorphic inlining becomes possible.

CHA-based devirtualization is *speculative*: if a new class loads later that adds a target, the JIT deoptimises the affected method. This is rare in production (class loading after warmup is usually done) but possible with dynamic frameworks. Hence the JIT often emits a *guard* (a Klass check) before the direct call so it can fall back without recompiling.

The combination `sealed interface + record implementations` is unusually JIT-friendly because:

- Records are `final`. No subclass surprises.
- Sealed enumerates the set. CHA is complete.
- The JIT can emit a Klass-pointer switch with N direct calls, fully inlined.

---

## 6. Class loading time vs. hierarchy depth

A simple measurement: load a synthetic class hierarchy of depth N and measure load+link time.

```java
// Generate classes at runtime with bytecode library:
//   Lvl0, Lvl1 extends Lvl0, Lvl2 extends Lvl1, ..., LvlN extends Lvl(N-1)
// Each declares 5 methods.

long t0 = System.nanoTime();
Class.forName("LvlN");      // triggers loading of the whole chain
long t1 = System.nanoTime();
```

Rough measurement on JDK 21 (loading + linking, no `<clinit>`):

| Depth | Total methods | Linking time (μs) |
| ----- | ------------- | ------------------ |
| 1     | 5             | ~50                |
| 5     | 25            | ~250               |
| 10    | 50            | ~620               |
| 20    | 100           | ~1800              |
| 50    | 250           | ~7500              |

Vtable construction is roughly O(parent_vtable_size + new_methods) per class, so cumulative cost across the chain is quadratic in depth when every level adds methods. Twenty levels is already noticeable; fifty is a startup tax.

This is *one* component of class loading; field layout, constant-pool resolution, and `<clinit>` run separately. But for hierarchical metaspace-heavy frameworks, vtable construction shows up in startup profiles.

---

## 7. Metaspace footprint of vtables

Each vtable slot is one `Method*` (8 bytes on 64-bit JVMs without compressed oops, sometimes 4 bytes with compressed class pointers). Each itable entry is similar plus a small header.

For a typical Spring Boot application:

- ~8,000 classes loaded.
- Average vtable: 15 class-specific slots + 12 Object slots = 27 slots * 8 B = 216 B per class.
- Average itable: 3 interfaces * (~5 methods each + header) = ~150 B per class.
- Total vtable + itable footprint: ~3 MB.

That's not catastrophic, but in a 256 MB heap container with 200 MB of metaspace, it's a measurable fraction. Larger applications (>30,000 classes) push this to 20-30 MB. AppCDS precomputes much of this and shares it across processes, reducing per-instance cost.

---

## 8. Inlining and the `-XX:MaxInlineLevel` ceiling

The JIT will inline a virtual call only when it can prove (or speculate with a guard) that the target is unique. Even then, inlining respects budgets:

- `-XX:MaxInlineLevel=15` — depth of inlining call chains.
- `-XX:FreqInlineSize=325` — bytecode size cap for hot methods.
- `-XX:MaxInlineSize=35` — bytecode size cap for cold methods.

A deeply nested polymorphic call chain (`a.foo() -> b.bar() -> c.baz() -> ...`) can hit the inline-level cap and stop inlining even if every call is monomorphic. Symptom: a flame graph showing a long pillar of small frames in a hot path.

Fix: flatten the call chain, or raise the limit if you've measured the benefit and accepted the code-size trade-off. Don't raise it by default — bigger inlined code blows the instruction cache.

---

## 9. When `final` is and isn't a real win

`final` on a class:

- *Helps* if the JIT couldn't already prove monomorphism via CHA + profiling. In well-profiled, well-warmed code, this is rare.
- Always helps *startup* (CHA can fold immediately, without warmup).
- Helps AOT compilation (GraalVM Native Image) because there's no speculative-guard fallback needed.

`final` on a method:

- Removes the method from the vtable's overridable slot list. Calls via the declaring class type are direct. Calls via a parent type still go through the parent's slot (which now points unconditionally at the final method).
- Symbolic only when the JIT can't prove monomorphism otherwise.

Bottom line: `final` is *design intent first, optimisation hint second*. The cases where it gives a measurable JIT improvement are narrow.

---

## 10. Refactoring a megamorphic site

A practical recipe when async-profiler shows `itable_stub` in your hot loop:

1. **Identify the site.** `-XX:+PrintInlining` will tell you which `(megamorphic)` call is the offender.
2. **Profile receiver types.** Add temporary logging or use JFR's `MethodSample` events to find the type distribution.
3. **Decide the refactor:**
   - If the loop iterates over heterogeneous types, group by type before the loop.
   - If the types are a closed set, seal the interface.
   - If the call is across a true plugin boundary, accept the cost and look elsewhere.
4. **Validate.** Re-run JMH. Compare flame graphs. Confirm `itable_stub` is gone or the loop body is now inlined.
5. **Document.** Add a comment explaining the structure ("intentionally per-type loops to keep dispatch monomorphic") so a future refactor doesn't re-introduce the megamorphic pattern.

---

## 11. JIT compilation tiers and dispatch

OpenJDK has multiple tiers:

- **Tier 0:** interpreter. Vtable lookup per call. Profiles call sites.
- **Tier 3 (C1 with profiling):** uses interpreter's profile to emit guarded inline caches.
- **Tier 4 (C2):** full optimization, including aggressive devirtualization and inlining.

A method that only runs briefly never reaches Tier 4 — it dispatches via Tier 0/3 throughout. For very hot methods, you want Tier 4 promotion: confirm with `-XX:+PrintCompilation` (look for `4` in the tier column).

If a method *should* be Tier 4 but isn't, the usual cause is the method being too large (`-XX:CompileThreshold`, `-XX:HotMethodDetectionLimit`) or being deoptimised repeatedly. The latter often points at unstable inline-cache patterns — a megamorphic call site causing repeated invalidation.

---

## 12. Don't optimize what you haven't measured

A common trap: refactoring polymorphism out of code "for performance" without ever profiling. The cost in many cases is below noise, and the refactor harms readability and design. The rule:

- Profile first (async-profiler, JFR).
- Find dispatch in the top 5% of CPU.
- Apply the smallest fix that restores monomorphism.
- Re-measure.
- Stop.

If dispatch is at 2% of total CPU, fixing it gives you 2% throughput improvement — and even that only if the fix doesn't slow something else down. Compared with database, network, GC, or allocation costs, dispatch is rarely the bottleneck in modern Java.

See [../05-escape-analysis-and-scalar-replacement/](../../06-method-dispatch-and-internals/05-escape-analysis-and-scalar-replacement/) for the related JIT optimisations that compound with devirtualization.

---

## 13. Quick rules

- [ ] Vtable call: ~3-4 ns warm; the *real* cost is the foregone inlining.
- [ ] Itable call: ~5-6 ns megamorphic; ~3 ns monomorphic via inline cache.
- [ ] CHA + `final` + `sealed` are the JIT's friends; records are sealed-and-final by design.
- [ ] JMH benchmarks reveal the monomorphic/bimorphic/megamorphic step function clearly.
- [ ] Class loading time grows roughly quadratically with hierarchy depth at constant methods-per-level.
- [ ] Metaspace footprint of vtables is meaningful at scale (MB-range in large apps).
- [ ] Refactor megamorphic sites by grouping by type or sealing the hierarchy.
- [ ] Profile before refactoring. Most code doesn't need dispatch tuning.

---

## 14. What's next

| Topic                                    | File              |
| ---------------------------------------- | ----------------- |
| Hands-on HSDB / JOL / JMH exercises      | `tasks.md`         |
| Interview Q&A                            | `interview.md`     |

---

**Memorize this:** the cost difference is monomorphic ~free, bimorphic ~40% slower, megamorphic ~3-4x slower than the inlined baseline. Sealed types + records + `final` are how you keep call sites monomorphic. JMH and async-profiler are how you confirm it. Don't tune dispatch without numbers.
