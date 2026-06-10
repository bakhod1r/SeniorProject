# Escape Analysis and Scalar Replacement — Junior

> **What?** *Escape analysis* (EA) is a JIT compiler optimization. While compiling a method, the JIT asks: "does any reference to this object leave the method?" If the answer is no — the object is provably *local* — the JIT can erase the heap allocation entirely. *Scalar replacement* is the follow-up: instead of allocating an object, the JIT promotes its fields to local variables that live in CPU registers or on the stack. From the program's perspective the object existed and behaved correctly; from the runtime's perspective no bytes were ever written to the heap.
> **How?** Write small, short-lived objects (records and `final` classes), keep them inside the method that creates them, don't store them in fields or return them out, and let the JIT do the rest. Verify with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations` and JMH's `-prof gc` profiler.

---

## 1. Escape analysis in one paragraph

When C2 (HotSpot's optimizing JIT) compiles a hot method, it inspects every object allocated inside it. For each allocation, it asks a question with three possible answers: does the object reference *not escape* this method, *escape* into a method we're calling, or *escape globally* (return, write to a field, hand to another thread)? If the answer is "doesn't escape", C2 doesn't need to allocate the object on the heap. It can keep the object's fields in registers, never construct a real Java object at all. The garbage collector never sees it, the allocator never touches it, and the program runs as if you had written the same logic with raw local variables. That's the entire idea.

The optimization is on by default in any modern HotSpot. You don't enable it; you accidentally defeat it by writing code that prevents it from succeeding.

---

## 2. The canonical example — a record allocated and immediately consumed

```java
public record Point(double x, double y) {
    double distanceTo(Point other) {
        double dx = x - other.x;
        double dy = y - other.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}

double sumDistances(double[] xs, double[] ys) {
    Point origin = new Point(0, 0);
    double sum = 0;
    for (int i = 0; i < xs.length; i++) {
        Point p = new Point(xs[i], ys[i]);   // allocates one Point per iteration?
        sum += p.distanceTo(origin);
    }
    return sum;
}
```

A naive reader counts `xs.length` allocations of `Point` plus one for `origin`. Run this through C2 with `-XX:+PrintEliminateAllocations` and the output reads:

```
Eliminated allocation: Point [x, y] in sumDistances
Eliminated allocation: Point [x, y] in sumDistances
```

Both allocations are gone. The two fields of each `Point` live in registers. The `distanceTo` call is inlined. The loop compiles to roughly the same machine code you'd get from writing it with plain `double` variables. The "free allocation" is real — the JIT proves the objects never escape the method and skips the allocator entirely.

---

## 3. What "escape" means in practice

Three escape levels matter for a Junior:

- **NoEscape** — the reference stays inside the method. `Point p = new Point(1, 2); return p.x + p.y;` is NoEscape. The fields are read locally, the object dies at the end of the method.
- **ArgEscape** — the reference is passed to another method as an argument, but doesn't escape *globally*. If the JIT can inline that method, ArgEscape often degrades to NoEscape.
- **GlobalEscape** — the reference is returned, stored in a static or instance field, or handed to another thread. Once a reference goes global, EA cannot help; the object must be allocated on the heap.

```java
Point local() {
    Point p = new Point(1, 2);
    return p;                     // GlobalEscape — returned. Heap-allocated.
}

double consumed() {
    Point p = new Point(1, 2);
    return p.x + p.y;             // NoEscape — scalar-replaced. No heap allocation.
}

class Holder { Point field; }
void leak(Holder h) {
    h.field = new Point(1, 2);    // GlobalEscape — stored in a field reachable from outside.
}
```

The escape level is a property of the *allocation site* in a *specific method*, not of the type. The same `Point` allocation can be NoEscape in one method and GlobalEscape in another.

---

## 4. Free allocation — when allocation costs nothing

The JVM does not allocate on the heap "for free", but a *scalar-replaced* allocation is effectively free:

- No call into the allocator.
- No write to the TLAB (thread-local allocation buffer).
- No GC bookkeeping — the object never reaches the heap, never sits in young gen, never gets promoted.
- The object's lifetime is just a register lifetime.

This is why a hot loop that *looks* like it allocates millions of objects per second can show zero allocations in `-prof gc`:

```
Benchmark                  Mode  Cnt  Score   Error   Units
sumDistances              avgt    5  3.2     0.1    ns/op
sumDistances:gc.alloc.rate    avgt    5  0.0   0.0   MB/sec
sumDistances:gc.alloc.rate.norm    avgt    5  0.0   0.0   B/op
```

`gc.alloc.rate.norm` is "bytes allocated per benchmark operation". When EA eliminates everything, this number is `0.0`. When something escapes, it jumps to 16 bytes (the size of a two-field `Point`) or higher.

---

## 5. The common newcomer surprise — "Why doesn't my benchmark show allocation?"

```java
@Benchmark
public Point allocate() {
    return new Point(1, 2);            // returned — escapes
}

@Benchmark
public double consume() {
    Point p = new Point(1, 2);         // doesn't escape — scalar-replaced
    return p.x + p.y;
}
```

A new engineer writes the second benchmark to "measure allocation cost", runs it with `-prof gc`, and sees zero allocations. They conclude the JVM "doesn't actually allocate small objects". That's the wrong lesson. The right lesson is: *the JIT erased the allocation because the object didn't escape this method*. The first benchmark, where the object is returned, *does* allocate — 16 bytes per call — because the result escapes.

If you want to measure raw allocation cost, you must defeat EA on purpose: store the object in a `@State`-scoped field, return it, or pass it to `Blackhole.consume`:

```java
@Benchmark
public void measured(Blackhole bh) {
    bh.consume(new Point(1, 2));       // Blackhole.consume(Object) forces escape
}
```

Now the allocation is observable in profilers.

---

## 6. What EA does and doesn't promise

EA is a *best-effort* optimization. The JIT will try; sometimes it succeeds, sometimes it gives up. Things that help it succeed:

- **Small objects.** Records, single-purpose value carriers.
- **`final` classes and fields.** Less aliasing, less escape risk to reason about.
- **Short methods that get inlined.** If a method is too big to inline, the JIT can't see what happens to the object after the call.
- **Monomorphic call sites.** When only one receiver type has been seen, the JIT can inline the call.

Things that defeat it:

- Storing the object in a heap-reachable field.
- Returning the object.
- Capturing the object in a lambda that may escape.
- Passing the object through `synchronized`/`volatile` in ways that prevent the JIT from reasoning about it.
- Polymorphic call sites the JIT can't inline.

You don't need to memorise this list yet — the middle and senior files cover each case. For now, internalise the headline: **short-lived local objects are usually free**.

---

## 7. Stack allocation vs scalar replacement

You may read older blog posts saying "HotSpot stack-allocates objects when EA succeeds". That's not quite accurate. HotSpot does not actually emit `subq $16, %rsp` and lay out an object on the stack. Instead, it does **scalar replacement**: the object's fields become separate scalar variables. Those scalars may live in registers or in stack slots, but there is no contiguous "object" on the stack — the object simply does not exist as an aggregate. Other JVMs (GraalVM's Native Image, sometimes Graal JIT) do somewhat different things, but for HotSpot C2 the operation is *scalar replacement*, not stack allocation. The end effect — no heap allocation — is the same.

---

## 8. How to see EA in action

```bash
java -XX:+UnlockDiagnosticVMOptions \
     -XX:+PrintEliminateAllocations \
     -XX:+DoEscapeAnalysis \
     -jar your-benchmark.jar
```

`PrintEliminateAllocations` prints a line for every allocation site that EA was able to eliminate. `DoEscapeAnalysis` is on by default — only useful when you want to *disable* it (`-XX:-DoEscapeAnalysis`) to measure the difference.

For a higher-level view, JMH's GC profiler tells you bytes allocated per operation:

```bash
java -jar your-benchmark.jar -prof gc
```

If `gc.alloc.rate.norm` is `0.0 B/op`, every allocation in your hot path got eliminated. That's the result you're aiming for in performance-critical code.

---

## 9. Common newcomer mistakes

**Mistake 1: "Allocation is always cheap, so I can ignore EA."**

Scalar-replaced allocation is essentially free; *heap* allocation is cheap-but-not-free. The difference shows up in tight loops. Three nanoseconds of allocation per iteration becomes 30 milliseconds across a 10-million-element pipeline. EA either erases the cost or doesn't — measure, don't assume.

**Mistake 2: "I'll force stack allocation with a flag."**

There is no such flag. EA is on by default and is the entire mechanism. You don't ask for it; you write code it can succeed on.

**Mistake 3: "My benchmark shows zero allocations, so I've optimised."**

Maybe. EA succeeded on the synthetic benchmark. Whether it succeeds on the *real* call site depends on how that call site uses the result. EA wins are fragile — a refactor that stores the result in a field can flip a hot path from 0 to 16 bytes per call. Re-measure when the surrounding code changes.

**Mistake 4: "Records always get scalar-replaced."**

Records *help* EA, they don't guarantee it. A record that is returned, stored, captured, or passed through a megamorphic call site will still allocate. Records are a *hint* to the JIT (small, final, immutable), not a contract.

---

## 10. Quick rules

- [ ] EA is on by default. You don't enable it; you protect it.
- [ ] Short-lived local objects are usually allocation-free.
- [ ] Returning, storing, or capturing an object defeats EA at that site.
- [ ] Records and `final` classes help EA; mutable shared state hurts it.
- [ ] Verify with `-XX:+PrintEliminateAllocations` and JMH `-prof gc`.
- [ ] A benchmark showing zero allocations is real, but fragile — re-measure after refactors.
- [ ] HotSpot does *scalar replacement*, not literal stack allocation. The effect is the same.

---

## 11. What's next

| Topic                                                                | File                |
| -------------------------------------------------------------------- | ------------------- |
| Reading `PrintEliminateAllocations`, helping EA succeed              | `middle.md`         |
| Three escape levels, lock elision, Graal partial-escape analysis     | `senior.md`         |
| Team policy, code-review vocabulary, mentoring                       | `professional.md`   |
| Where EA lives (HotSpot source) — JEPs and Valhalla                  | `specification.md`  |
| 10 cases where EA silently fails or surprises                        | `find-bug.md`       |
| Records + EA pipelines, partial-escape analysis, Valhalla            | `optimize.md`       |
| Hands-on JMH exercises                                               | `tasks.md`          |
| Interview Q&A                                                        | `interview.md`      |

See also: [../04-object-memory-layout/](../04-object-memory-layout/) for what an object *would* look like if EA didn't eliminate it, and [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/) for why inlining (a prerequisite for EA across call sites) depends on monomorphic dispatch.

---

**Memorize this:** EA asks "does this object's reference leave the method?" If no, the JIT scalar-replaces it and the allocation costs nothing. Short-lived local records and `final` classes are EA's best friends; fields, returns, lambda captures, and megamorphic calls are its enemies. Verify, don't assume — `-XX:+PrintEliminateAllocations` and JMH `-prof gc` will tell you the truth.
