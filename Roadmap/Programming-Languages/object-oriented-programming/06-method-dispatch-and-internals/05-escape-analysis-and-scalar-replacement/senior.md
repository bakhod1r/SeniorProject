# Escape Analysis and Scalar Replacement — Senior

> **What?** The internals: how C2 classifies escape state into NoEscape / ArgEscape / GlobalEscape, how scalar replacement is implemented on top of that, how lock elision falls out of EA for free, the differences between C1, C2, and Graal in EA strength, and the specific situations where C2's EA is known to be incomplete. Plus Graal's partial-escape analysis, the most interesting recent advance.
> **How?** Treat EA as a fixed-point dataflow analysis on the SSA graph: each reference flows through nodes (stores, loads, calls, returns) and accumulates an escape state. Scalar replacement is what the optimizer does *after* the analysis tells it an allocation is safe. Lock elision is the same machinery, applied to monitor enter/exit on the same SSA value.

---

## 1. The three escape states in C2

C2's escape analysis (in `escape.cpp` and `escape.hpp` inside `share/opto/`) classifies every allocation into one of three states:

- **NoEscape** — the reference does not leave the method *and* is not assigned to any heap-reachable location. The object's lifetime is bounded by the compiling method's stack frame.
- **ArgEscape** — the reference is passed as an argument to a method that the compiler could not inline, *or* is assigned to a field of another NoEscape object. The reference is observable inside the callee but does not (provably) escape *globally*. ArgEscape allocations are not scalar-replaced but can still be eligible for lock elision and partial optimisations.
- **GlobalEscape** — the reference is returned, written to a static field or instance field of a heap object, or passed to a method that stores it somewhere observable. The object must be heap-allocated, no optimisations apply.

The analysis is iterative — a fixed-point computation over a graph of `PointsTo` nodes. Each allocation starts at NoEscape, and the analysis propagates upward toward ArgEscape and GlobalEscape until the graph stabilises. Only NoEscape allocations are candidates for scalar replacement; ArgEscape allocations are candidates for lock elision; GlobalEscape allocations get no relief.

---

## 2. Scalar replacement, mechanically

Once C2 has tagged an `AllocateNode` as NoEscape, it runs `PhaseMacroExpand::scalar_replacement` (in `macro.cpp`). The high-level moves:

1. Walk every use of the allocation result. Each use must be a load from a field of the object or a store to a field. (Anything else — a `Phi`, a `CmpP`, a `CastPP` whose result is captured — would imply the reference is being treated as an aggregate, which prevents scalar replacement.)
2. For each field of the allocated type, create a new SSA value that represents the field. Loads of `obj.f` are rewritten to read the corresponding SSA value; stores of `obj.f` are rewritten to *define* a new SSA value.
3. The `AllocateNode` is replaced with no allocation at all. Register allocation then assigns each scalar SSA value to a register (or, if pressure is high, a spill slot).

There is no contiguous "object on the stack"; the fields are unrelated scalars from the point of view of code generation. This is why arrays don't scalar-replace in C2: the indexing operation requires a contiguous layout, and the analysis is per-field, not per-element.

```java
class Vec3 { double x, y, z; }                    // 3 fields → 3 scalars after replacement
class Buf  { int[] data = new int[16]; }          // array field → cannot scalar-replace
```

---

## 3. Lock elision falls out for free

A `synchronized` block on an object reference is compiled into a `monitorenter` / `monitorexit` pair around the body. The monitor operations target a *specific object*. If EA proves that object is NoEscape, no other thread can ever see it, so the lock is provably uncontended. The `monitorenter` / `monitorexit` pair can be eliminated entirely.

```java
double area() {
    StringBuilder sb = new StringBuilder();           // NoEscape
    synchronized (sb) {                                // lock on a NoEscape object
        sb.append("hello");
        return sb.length();
    }
}
```

C2 eliminates both the allocation and the monitor operations. The `synchronized` block compiles to the same code as the non-synchronized version. This is sometimes called *lock coarsening's cousin*: lock coarsening merges adjacent synchronized blocks on the same monitor; lock elision removes synchronized blocks that protect nothing.

`StringBuffer` (synchronized) became near-equivalent to `StringBuilder` (non-synchronized) on hot paths the day lock elision shipped, which is around the same time JDK 6 introduced biased locking. For most allocation-free hot paths, the lock is gone before the runtime sees it.

---

## 4. C1, C2, and Graal — different EA strengths

The three JIT tiers in modern HotSpot differ significantly in how aggressive their EA is:

- **C1 (the client compiler)** — minimal EA. C1's purpose is fast compilation, not aggressive optimisation. You see almost no allocation elimination in code that hasn't reached C2 yet. Methods that warm up briefly and then are abandoned often miss EA entirely.
- **C2 (the server compiler)** — full classical EA: NoEscape / ArgEscape / GlobalEscape, with scalar replacement and lock elision. This is what most production JDK installs use for hot methods.
- **Graal** — adds *partial-escape analysis*: an object that escapes on *one* code path but not another can be allocated lazily on the escaping path only. C2 cannot do this; for C2 an object either NoEscapes everywhere or is heap-allocated.

For a tiered-compiled application (`-XX:+TieredCompilation`, default since JDK 8), a method is compiled by C1 first and re-compiled by C2 once it crosses the C2 threshold. EA wins only kick in after the C2 re-compilation. Cold methods, methods just past warm-up, and methods that thrash compile-deopt cycles never see EA at all.

---

## 5. Graal's partial-escape analysis

The classical C2 analysis is *whole-object*: an allocation is either NoEscape (eliminated entirely) or escapes (kept on the heap entirely). Real code often has a mix: an object is constructed in a method, used as scalars on the hot path, and only escapes on a rare error path.

```java
Result compute(int x) {
    Box b = new Box(x);
    if (x < 0) {
        log.error("negative", b);                    // escapes only on error path
        return Result.failure();
    }
    return Result.of(b.value() * 2);                 // hot path — b doesn't escape here
}
```

C2 sees the `log.error` call, can't prove `log` doesn't store `b`, and gives up. The object is always heap-allocated, paying the cost on every call even though 99.99% of calls take the hot path.

Graal's partial-escape analysis (PEA) splits the analysis per path: on the hot path, `b` is scalar-replaced; on the error path, an actual allocation is inserted at the point of escape, restoring the object's state from the scalars. The compiler effectively rewrites the method to:

```java
Result compute(int x) {
    int bValue = x;                                  // scalar
    if (x < 0) {
        Box b = new Box(bValue);                     // materialise lazily on escape
        log.error("negative", b);
        return Result.failure();
    }
    return Result.of(bValue * 2);                    // hot path — no Box allocation
}
```

PEA is a major win for code that mixes hot and cold paths through the same allocation site. It is the single biggest reason GraalVM often outperforms HotSpot C2 on allocation-heavy workloads.

---

## 6. Volatile fields prevent EA

If an object has a `volatile` field, EA conservatively assumes the field could be observed by another thread at any moment — even if the object reference is NoEscape from the compiler's perspective.

```java
class Latch {
    volatile boolean ready;                          // volatile blocks EA
}

double compute() {
    Latch l = new Latch();                           // NoEscape... but volatile field present
    l.ready = true;
    return l.ready ? 1.0 : 0.0;
}
```

The `volatile` semantics include a *happens-before* obligation that requires the write to be observable across threads. The compiler can't prove the object is truly thread-local in a way that lets it skip the memory fence. Result: the allocation is kept, even though every read/write is within one method.

The fix, when you need volatile semantics on a *visible* shared object but want EA on a *local* one: don't put a volatile field on something you allocate as a local. Use separate types for "transit" (non-volatile, EA-friendly) and "shared" (volatile, on the heap intentionally).

---

## 7. Method size and the inlining budget

EA across a call requires the call to be inlined. Inlining is bounded by HotSpot's *budget*:

- `MaxInlineSize` (default 35 bytecodes) — methods up to this size are inlined even if not hot.
- `FreqInlineSize` (default 325 bytecodes) — *hot* methods up to this size are inlined.
- `MaxInlineLevel` (default 15) — maximum inlining depth from a single root method.
- `InlineSmallCode` (default 2 000) — the maximum size of the *generated machine code* before inlining stops.

A method just over the budget is the cliff: it doesn't get inlined, EA can't see through it, and any object passed in is treated as potentially escaping. Two patterns trip this in real code:

```java
// Pattern 1: a "helper" method that does too much.
private void process(Point p) {
    // 50 lines of validation, logging, conversion...
}
// → process is > FreqInlineSize, EA fails for callers passing local Points.

// Pattern 2: deep delegation chains.
methodA → methodB → methodC → methodD → ... → methodP   // depth > MaxInlineLevel
// → EA fails somewhere down the chain even though every individual method is tiny.
```

Tuning the flags is a last resort. Splitting the helper into hot and cold halves so the hot half stays under `MaxInlineSize`, or flattening the call chain, is usually the right fix.

---

## 8. C2's known EA limitations

C2's EA is mature but not complete. Known limitations:

- **Arrays do not scalar-replace.** A `new int[4]` inside a NoEscape scope is still heap-allocated. Graal handles some array cases; C2 does not.
- **Iteration with Phi merges across loops sometimes defeats EA**, even when the merged values are all NoEscape. C2 has incrementally improved this across JDK versions, but corner cases remain.
- **Reflective access** — even a method that *might* be invoked reflectively (no inlining target known) blocks EA. This is one reason proxy-heavy frameworks miss EA opportunities even when the underlying code looks clean.
- **`finalize()` and `Cleaner` references** — any object with a non-trivial finalisation path escapes, because the finaliser thread must reach the object.
- **Native method calls** — anything passed across JNI is treated as GlobalEscape.

The pragma is: EA succeeds on the *common shape* of small, immutable, locally-consumed objects in pure Java code. The moment you mix in arrays, reflection, finalisers, native calls, or unusual control flow, expect EA to silently give up.

---

## 9. Verifying escape state directly

```bash
java -XX:+UnlockDiagnosticVMOptions \
     -XX:+PrintEscapeAnalysis \
     -XX:+PrintEliminateAllocations \
     -XX:CompileCommand='print,com/acme/Geometry::*' \
     -jar app.jar
```

Sample output:

```
======== Connection graph for  com/acme/Geometry::sumDistances
JavaObject NoEscape(NoEscape) [ 145F [ ] ]   25 Allocate ...
JavaObject NoEscape(NoEscape) [ 138F [ ] ]   17 Allocate ...
LocalVar [ 25P [ ] ] 144 Proj
LocalVar [ 17P [ ] ] 137 Proj
```

Each `JavaObject` line shows the escape state. `NoEscape(NoEscape)` means both the analysis result and the post-analysis classification agree it's NoEscape — scalar replacement will run. `ArgEscape` and `GlobalEscape` lines tell you exactly which allocation didn't make it.

The same machinery exists in IntelliJ + JITWatch for a graphical view — useful when you want to walk through a method's allocation sites without grepping the textual log.

---

## 10. Quick rules

- [ ] Three escape states: NoEscape (scalar-replaced), ArgEscape (lock-elided), GlobalEscape (full heap allocation).
- [ ] C2 EA is whole-object; Graal PEA can split by control-flow path.
- [ ] Lock elision is EA applied to monitor operations; uses the same NoEscape proof.
- [ ] Volatile fields, finalisers, native calls, and reflection block EA.
- [ ] Inlining is the precondition for cross-method EA; the budget is `MaxInlineSize` / `FreqInlineSize` / `MaxInlineLevel`.
- [ ] Arrays don't scalar-replace in C2 (yet); fixed-size records do.
- [ ] Tiered compilation: only C2-compiled methods see EA. C1 doesn't.
- [ ] Verify with `-XX:+PrintEscapeAnalysis` and `-XX:+PrintEliminateAllocations`.

---

## 11. What's next

| Topic                                                                | File                |
| -------------------------------------------------------------------- | ------------------- |
| Team policy, code review, mentoring                                  | `professional.md`   |
| HotSpot source pointers, JEPs, Valhalla                              | `specification.md`  |
| 10 silent-failure case studies                                       | `find-bug.md`       |
| Records + EA pipelines, Graal PEA, Valhalla                          | `optimize.md`       |
| Hands-on JMH exercises                                               | `tasks.md`          |
| 20 interview Q&A                                                     | `interview.md`      |

See also: [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/) for inlining mechanics, [../04-object-memory-layout/](../04-object-memory-layout/) for what a heap-allocated object actually costs, and [../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/](../../04-object-contracts-and-semantics/05-immutability-and-defensive-copying/) for why immutability is both a correctness *and* an EA tool.

---

**Memorize this:** C2 classifies allocations into NoEscape / ArgEscape / GlobalEscape; only NoEscape gets scalar-replaced, ArgEscape gets lock-elided, and GlobalEscape gets nothing. Graal's partial-escape analysis is strictly stronger because it can split per control-flow path. EA's worst enemies are volatile fields, finalisers, native calls, reflection, and call boundaries the inliner can't cross. Read `PrintEscapeAnalysis` to see the analysis result before you optimise.
