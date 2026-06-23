# Composing Methods — Professional Level

> Focus: bytecode and IR effects, JIT inlining, escape analysis, allocation patterns. **What actually happens** when you Extract Method or Replace Temp with Query?

---

## Table of Contents

1. [Extract Method at the bytecode level](#extract-method-at-the-bytecode-level)
2. [JIT inlining: the hidden default](#jit-inlining-the-hidden-default)
3. [Escape analysis and Method Object](#escape-analysis-and-method-object)
4. [Replace Temp with Query — the real cost](#replace-temp-with-query-the-real-cost)
5. [Inline Method — when it's a perf win](#inline-method-when-its-a-perf-win)
6. [Polymorphic call sites & monomorphic optimization](#polymorphic-call-sites-monomorphic-optimization)
7. [Substitute Algorithm — micro-benchmarks lie](#substitute-algorithm-micro-benchmarks-lie)
8. [Go: SSA, mid-stack inlining, PGO](#go-ssa-mid-stack-inlining-pgo)
9. [Python: bytecode, no inlining, but…](#python-bytecode-no-inlining-but)
10. [Profile-guided refactoring](#profile-guided-refactoring)
11. [Review questions](#review-questions)

---

## Extract Method at the bytecode level

Extract Method adds a method invocation. In the JVM, that's an `invokevirtual` / `invokespecial` / `invokestatic` opcode where there used to be no opcode at all.

**Before:**

```java
int total = a + b;
```

Bytecode:
```
iload_1
iload_2
iadd
istore_3
```

**After Extract Method:**

```java
int total = sum(a, b);
private int sum(int x, int y) { return x + y; }
```

Bytecode at the call site:
```
aload_0
iload_1
iload_2
invokevirtual #sum
istore_3
```

In raw bytecode, you've added an `aload_0` (load `this`), and a method dispatch.

### So Extract Method costs a method call?

In **interpreted** mode, yes. Once HotSpot's C1/C2 JIT compiler runs (after ~1.5k–10k invocations of the enclosing method), the called method gets **inlined** — the call disappears entirely.

This is the deal: you write the code as if every Extract Method costs a call; the JIT erases that cost at runtime. **Composing Methods refactorings are essentially free in steady state.**

---

## JIT inlining: the hidden default

HotSpot's inlining heuristics (defaults shown):

| Flag | Default | Meaning |
|---|---|---|
| `-XX:MaxInlineSize` | 35 bytes | Inline any method up to this many bytecode bytes. |
| `-XX:FreqInlineSize` | 325 bytes | Inline hot methods up to this size. |
| `-XX:MaxInlineLevel` | 15 | Recursive inlining depth. |
| `-XX:InlineSmallCode` | varies | Inline if the compiled-code size is below this threshold. |

What this means practically:

- A 5-line getter? Inlined unconditionally.
- A 20-line helper? Inlined if hot, otherwise inlined-when-small.
- A 200-line monster method? **Not inlined**. Long Method is a perf smell, too.

### Verifying inlining

```bash
java -XX:+UnlockDiagnosticVMOptions \
     -XX:+PrintInlining \
     -XX:+PrintCompilation \
     YourMain
```

You'll see lines like:

```
@ 12   com.example.Order::subtotal (28 bytes)   inline (hot)
@ 17   com.example.Order::loyaltyDiscount (35 bytes)   inline (hot)
```

Or, when the JIT *refuses* to inline:

```
@ 12   com.example.Order::process (812 bytes)   too big
```

This is the most useful debugging tool for "is my refactoring slow?" Always check before optimizing.

### The inlining cliff

When a method exceeds `MaxInlineSize`/`FreqInlineSize`, inlining stops abruptly. A method that grows from 320 bytes to 330 bytes can suddenly become 5–10× slower in a tight loop.

> **Senior heuristic:** If you see a perf regression after a refactoring that *added* lines to a hot method, check if the method crossed the inlining threshold. The fix is often to Extract Method back out, so the hot path is below threshold.

---

## Escape analysis and Method Object

The classic worry: "Won't a Method Object allocate a new object every call? That's GC pressure."

In modern JVMs, **escape analysis** + **scalar replacement** make this fear largely obsolete:

1. **Escape analysis** — does the new `Gamma` object reference *escape* the caller? If not, it's stack-allocatable.
2. **Scalar replacement** — if the object's fields are simple (no references stored long-term), replace the object entirely with locals on the stack.

For a Method Object used like `new Gamma(...).compute()`, both conditions are typically met. The JIT compiles it to:

```
// Pseudo-IR
locals: a, q, ytd, iv1, iv2, iv3
... computation ...
return iv3 - 2*iv1
```

No heap allocation. **Method Object is free in steady state.**

### When escape analysis fails

- Object stored in a field, returned, or passed to an unknown method.
- Synchronization on the object (`synchronized(gamma) { ... }`).
- Reflection accessing the object.
- The method is too large to inline (so EA can't see the lifecycle).

### Verification

```bash
java -XX:+UnlockDiagnosticVMOptions \
     -XX:+PrintEscapeAnalysis \
     -XX:+PrintEliminateAllocations \
     YourMain
```

> Project Valhalla (in development) will eventually let you mark types as `value class`, making non-escape behavior explicit and removing the dependence on JIT heuristics.

---

## Replace Temp with Query — the real cost

```java
double basePrice = quantity * itemPrice;
return basePrice > 1000 ? basePrice * 0.95 : basePrice * 0.98;
```

After replacing the temp with a `basePrice()` query, called 3 times:

```java
return basePrice() > 1000 ? basePrice() * 0.95 : basePrice() * 0.98;

private double basePrice() {
    return quantity * itemPrice;
}
```

### Steady-state perf

- `basePrice()` is 2 bytecode ops. JIT inlines it. The 3 multiplications collapse to 3 inlined `(quantity * itemPrice)` expressions.
- Common subexpression elimination (CSE) at the JIT level *may* notice the 3 repeated expressions and compute once. (HotSpot C2 does this for pure expressions.)
- **Net cost: zero** for arithmetic.

### When the cost is real

If `basePrice()` calls `db.lookupPrice(itemId)`, the JIT cannot CSE through I/O. Three calls = three round trips. **You must memoize manually.**

### Memoization strategies

```java
// Lazy field
private Double basePriceCache;
private double basePrice() {
    if (basePriceCache == null)
        basePriceCache = quantity * db.lookupPrice(itemId);
    return basePriceCache;
}

// Java's @MemoizedFunction (some libs), or Guava's Suppliers.memoize:
private final Supplier<Double> basePrice =
    Suppliers.memoize(() -> quantity * db.lookupPrice(itemId));
```

For Method Objects, the cache field is natural — you already have a class to put it in.

---

## Inline Method — when it's a perf win

Inlining a method has zero perf benefit in steady state — JIT was already inlining it. So why do it?

### 1. Reduce indirection for the JIT

A small method buried under several layers of polymorphism (interface → abstract → concrete) may *just barely* be missing inlining due to depth limits. Inlining manually flattens the path.

### 2. Devirtualize

```java
interface Discount { double rate(); }
class FlatRate implements Discount { public double rate() { return 0.1; } }
```

If `discount.rate()` is called in a hot loop and the JIT detects it's always `FlatRate` (monomorphic), it inlines and optimizes. If polymorphism is genuine (multiple types), the JIT installs a small inline cache (bimorphic) or punts to a virtual call (megamorphic). Inlining the method into a hot caller can collapse the polymorphism.

### 3. Avoid deopt

JIT optimistically inlines based on observed types. If a new type appears, the JIT *deoptimizes* and recompiles. If you know your call site is monomorphic, manual inlining removes the deopt risk.

> See [OO Abusers — Switch Statements](../../01-code-smells/02-oo-abusers/professional.md) for the full polymorphism perf treatment.

---

## Polymorphic call sites & monomorphic optimization

A call site has a "shape":

| Shape | Receivers seen | JIT response | Cost |
|---|---|---|---|
| Uninitialized | 0 | Slow path | Highest |
| Monomorphic | 1 | Inline cache, often inlined | ~1× direct call |
| Bimorphic | 2 | Two-entry cache | ~1.5× direct call |
| Polymorphic | 3 | Polymorphic IC | ~3× direct call |
| Megamorphic | 4+ | vtable lookup | ~5–10× direct call |

When you Extract Method, you are *creating* a call site. Whether it's mono- or megamorphic depends on whether the new method is overridden anywhere.

### Implication for refactoring

`private` methods are always monomorphic (no override possible). `final` methods on a class are always monomorphic.

Extracting to a `private` helper inside the same class? Practically free.
Extracting to a method that gets overridden by 6 subclasses? You've added a megamorphic site.

Match the visibility to the use. Default to `private` until you need otherwise.

---

## Substitute Algorithm — micro-benchmarks lie

You replace algorithm A (40-line loop) with algorithm B (3-line stream pipeline). Bench shows B is "100ns slower." Should you keep A?

### What the bench probably missed

- **Warmup.** First 10k calls are interpreted; only after that does the JIT compile. JMH or `Benchmark.warmup()` are mandatory.
- **Dead code elimination.** If the result isn't consumed, the JIT deletes the whole computation. Use `Blackhole.consume(result)`.
- **Inlining decisions.** Adding lines may push a caller over the inline threshold. Use `-XX:+PrintInlining`.
- **GC.** Stream ops allocate iterators. In a single-shot bench you don't see GC; in production, billions of allocations matter.
- **Branch prediction warm-up.** B may benefit from skewed input patterns A doesn't see.

### Required tooling

For Java: **JMH** (Java Microbenchmark Harness). Anything else is misleading.

```java
@Benchmark
public Money totalA() { return computeA(input); }

@Benchmark
public Money totalB() { return computeB(input); }
```

Run with multiple input sizes, multiple JVM versions, on actual hardware.

### Counter-rule

Most "cleaner" algorithms are also faster *or* equivalent. Cases where simplicity costs perf are real but rare. Profile, don't predict.

---

## Go: SSA, mid-stack inlining, PGO

Go's compiler is simpler than HotSpot but still does meaningful inlining.

### Inlining budget

- Functions are inlined if their cost (a static metric) is < 80 (default; configurable with `-l` flag).
- A `for` loop, defer, recover, or closure typically *blocks* inlining.
- `go build -gcflags='-m -m'` shows decisions.

```bash
$ go build -gcflags='-m=2' ./...
./order.go:14:6: can inline (*Order).subtotal
./order.go:23:18: inlining call to (*Order).subtotal
./order.go:8:6: cannot inline (*Order).Total: function too complex
```

### Mid-stack inlining

Go 1.10+ added mid-stack inlining: a small caller of a small callee can inline both into the outermost frame. Effect: many Extract Method-style refactorings cost zero in Go.

### Profile-Guided Optimization (Go 1.21+)

Capture a real-world profile (`go test -cpuprofile`) and pass it to `go build`. The compiler now knows which call sites are hot and inlines aggressively at those sites. PGO can recover much of the polymorphism perf you'd otherwise lose to interface dispatch.

### Interface dispatch

Calling through a Go interface is **always** a virtual call (itab lookup, indirect). Unlike Java's HotSpot, the Go compiler historically didn't devirtualize. PGO changes this for hot sites.

---

## Python: bytecode, no inlining, but…

CPython has no inliner. Every method call goes through the standard call protocol (`CALL_FUNCTION` opcode → `PyEval_EvalFrameEx` → frame creation → execution).

### Cost

A Python method call costs ~50–500ns of pure overhead, *before* the body runs. For tight loops, this dominates.

### Implications for refactoring

- Extract Method: a hot loop calling an extracted helper N times pays N × 100ns. For N=10M, that's a second of overhead.
- Replace Temp with Query: same — each query call adds overhead.
- Inline Method: a real perf win in tight Python loops.

### Tools

- **PyPy** — JIT-compiled CPython subset. Composing Methods refactorings are roughly free under PyPy. If your code runs on PyPy, ignore this section.
- **Cython** — annotate hot paths with C types. Inlining works.
- **Numba** — JIT for numerical Python.
- **C extensions** — for any hot inner loop.

> Practical Python rule: write clear code (Extract Method liberally) for the 99% of code that isn't hot. Profile, find the 1%, and either drop to C / use Numba / vectorize with NumPy.

---

## Profile-guided refactoring

The discipline of **measuring before refactoring** for performance reasons:

### The flow

1. Measure: profile prod (or a realistic load test).
2. Identify the hot path (10% of code that runs 90% of the time — Pareto holds).
3. Apply Composing Methods refactorings to the hot path with **special** considerations:
   - Inline rather than Extract.
   - Avoid Replace Temp with Query for non-pure expressions.
   - Avoid allocations even if escape analysis "should" handle them.
4. Re-measure.
5. Apply normal Composing Methods refactorings to everything else, freely.

### What this prevents

The two biggest mistakes:

- **Optimizing cold code.** Writing convoluted versions of code that runs once a day.
- **Pessimizing hot code.** "Cleaning up" a tight loop into a stream pipeline that allocates 3 iterators per iteration.

### Tools

| Language | Profiler |
|---|---|
| Java | JFR (built-in), async-profiler, VisualVM |
| Go | `pprof` (built-in) |
| Python | `cProfile`, `py-spy`, `scalene` |
| Native | perf, Instruments, VTune |

---

## Review questions

1. What does Extract Method cost in JVM bytecode? In steady-state JIT?
2. Explain `MaxInlineSize` and `FreqInlineSize`.
3. How do escape analysis and scalar replacement make Method Object free?
4. When does Replace Temp with Query become a real perf cost?
5. Why might you Inline Method even if JIT was already inlining it?
6. What's the difference between monomorphic and megamorphic call sites for perf?
7. What does `-XX:+PrintInlining` tell you?
8. Why do most micro-benchmarks of Substitute Algorithm lie?
9. How does Go's PGO interact with these refactorings?
10. Why is Inline Method sometimes the best refactoring in CPython hot loops?
