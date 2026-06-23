# Escape Analysis and Scalar Replacement — Find the Bug

> 10 snippets where Escape Analysis silently fails, succeeds in confusing ways, or interacts with surrounding code in ways that surprise engineers who learned EA from one blog post. For each: identify what the JIT actually does (allocation eliminated or not), the runtime symptom, and the smallest fix.

---

## Bug 1 — Benchmark "proves" Integer boxing is free

```java
@State(Scope.Benchmark)
public class BoxingBench {
    @Param({"42"})
    int n;

    @Benchmark
    public int boxAndUnbox() {
        Integer boxed = Integer.valueOf(n);
        return boxed.intValue();
    }
}
```

A new engineer runs this with `-prof gc` and sees:

```
boxAndUnbox:gc.alloc.rate.norm    avgt    5   0.0     0.0     B/op
```

They conclude: "boxing is free, the JIT handles it". They go and write code that boxes liberally on the hot path.

**What's really happening.** Two reasons the benchmark shows zero allocations: (1) `Integer.valueOf(42)` returns a *cached* `Integer` (the `IntegerCache` covers −128 to 127), no allocation in the first place; (2) even if the value were 200, EA would scalar-replace the local `boxed` because it doesn't escape — `boxed.intValue()` reads the field locally and returns the primitive.

**Symptom in production.** Real code that boxes `Integer` and stores it in a `List<Integer>`, `Map<String, Integer>`, or returns it across a megamorphic call allocates *every time*. The benchmark didn't measure the real case.

**Fix.** Either make the benchmark match the real shape (`Blackhole.consume(Integer.valueOf(n + 1000))` for non-cached values that escape), or *don't generalise from one benchmark*. EA's success is per-call-site, not per-type.

---

## Bug 2 — Storing in a field defeats EA across every caller

```java
public class PathTracer {
    private Point cursor;                                 // mutable field

    public double walk(double[] xs, double[] ys) {
        double dist = 0;
        for (int i = 0; i < xs.length; i++) {
            Point next = new Point(xs[i], ys[i]);
            if (cursor != null) {
                dist += cursor.distanceTo(next);
            }
            cursor = next;                                 // <-- GlobalEscape
        }
        return dist;
    }
}
```

`async-profiler -e alloc` flags `walk` as the top allocator: 16 bytes per iteration. The `cursor` field reaches outside the method, so every `next` reference must be valid on the heap.

**Symptom.** A long-running path-tracing service shows 200 MB/sec of allocation rate, GC pause time dominating its SLA. Same code in a synthetic benchmark (without the field) showed `0.0 B/op`.

**Fix.** Store the values, not the object:

```java
public class PathTracer {
    private double cursorX, cursorY;
    private boolean hasCursor;

    public double walk(double[] xs, double[] ys) {
        double dist = 0;
        for (int i = 0; i < xs.length; i++) {
            Point next = new Point(xs[i], ys[i]);
            if (hasCursor) {
                dist += new Point(cursorX, cursorY).distanceTo(next);
            }
            cursorX = next.x(); cursorY = next.y(); hasCursor = true;
        }
        return dist;
    }
}
```

Both `Point` allocations are NoEscape (the constructed `Point` from `cursorX/cursorY` and the `next` Point). EA eliminates both. The field still tracks position, but as scalars.

---

## Bug 3 — `record` stored in a `final` field still escapes

```java
public final class Aggregator {
    private final List<Point> history = new ArrayList<>();

    public void track(double x, double y) {
        Point p = new Point(x, y);
        history.add(p);                                    // GlobalEscape via list
    }
}
```

The record helps — it would be EA-friendly *if* `p` stayed local. But adding to `history` writes the reference into a field of `ArrayList`, which is reachable from outside the method. GlobalEscape.

**Symptom.** Engineers see "I used a record, EA should win" in the PR description; the production allocation rate disagrees.

**Fix.** If you actually need the history, the allocation is unavoidable — `ArrayList` stores references, period. The fix is either to *not store history* (do you need it?) or to store the components in a primitive-backed structure:

```java
public final class Aggregator {
    private final DoubleArrayList xs = new DoubleArrayList();
    private final DoubleArrayList ys = new DoubleArrayList();

    public void track(double x, double y) {
        xs.add(x);                                          // primitives — no Point allocation
        ys.add(y);
    }
}
```

Same data, no Point objects, no EA dependency.

---

## Bug 4 — Lambda capturing `this` escapes the enclosing instance

```java
public class EventDispatcher {
    private final List<Listener> listeners = new ArrayList<>();
    private int counter;

    public void publish(Event e) {
        listeners.forEach(l -> {
            counter++;                                       // captures `this` via field write
            l.onEvent(e);
        });
    }
}
```

The lambda `l -> { counter++; l.onEvent(e); }` captures both `this` (for `counter`) and `e`. Even though the lambda *body* is small, the captured `this` reference is itself a long-lived field — the enclosing `EventDispatcher` instance. The lambda allocation is a `Consumer` instance that holds `this` and `e`; both are observable through the listener chain.

**Symptom.** A profile shows `EventDispatcher$$Lambda$1` allocations matching `publish` call rate. Memory churn that wasn't expected for a "just iterate" method.

**Fix.** Hoist the work out of the lambda; use the index-based `for` loop:

```java
public void publish(Event e) {
    for (int i = 0; i < listeners.size(); i++) {
        counter++;
        listeners.get(i).onEvent(e);
    }
}
```

Same behaviour, no lambda, no capture, no allocation per `publish`.

---

## Bug 5 — Final field of outer class still escapes

```java
public final class Cache {
    private final ConcurrentHashMap<Long, Entry> map = new ConcurrentHashMap<>();

    public Entry getOrCompute(long key) {
        return map.computeIfAbsent(key, k -> new Entry(k, System.nanoTime()));
    }
}
```

Reasonable code. But every cache miss allocates an `Entry`, and the lambda captures `this` to reach `System.nanoTime()` indirectly through the enclosing class's class-loading context. (In practice the lambda captures only `k` — but the *Entry* it constructs goes straight into the map.)

**What EA does here.** It can't help. The `Entry` is stored in the map, the map is a heap-reachable field, the entry must reach the heap. The lambda itself may scalar-replace if it doesn't capture `this`, but the `Entry` allocation always happens.

**Symptom.** Engineer expects "EA will eliminate the Entry because it's a record". It doesn't, because the Entry is *supposed* to be stored in the cache.

**Fix.** This is the correct behaviour — caches *need* heap entries. The lesson is "EA is not the right tool here; minimise allocation through cache hit rate, or use primitive-keyed primitive-valued caches like Eclipse Collections' `LongLongHashMap`".

---

## Bug 6 — Non-final method blocks the inlining chain

```java
public class Calculator {
    public double compute(Range r) {                       // not final
        return helper(r).value() * 2;
    }

    public Range helper(Range r) {                         // not final
        return r.shift(1);
    }
}
```

`r.shift(1)` returns a fresh `Range` record. The hope: EA across the call chain sees the `Range` as NoEscape and eliminates it. The reality: `helper` is not `final`, the call site sees `Calculator.helper` as virtual, and if any subclass loads at any time, CHA invalidates the inline. If the inline fails, EA across the boundary fails.

**Symptom.** Sometimes EA wins (when no subclass has loaded), sometimes it doesn't (after a plugin loads). The allocation rate oscillates inexplicably.

**Fix.** Mark `Calculator` and/or `helper` `final`. Removes the CHA fragility, locks the inline, EA succeeds reliably:

```java
public final class Calculator {
    public double compute(Range r) { return helper(r).value() * 2; }
    public Range helper(Range r) { return r.shift(1); }
}
```

---

## Bug 7 — `@FunctionalInterface` with many call sites becomes megamorphic

```java
public interface Transform {
    Point apply(Point p);
}

public Point process(Point p, Transform t1, Transform t2, Transform t3) {
    return t3.apply(t2.apply(t1.apply(p)));                // three Transform.apply call sites
}
```

Each `apply` call site sees a different concrete implementation across the codebase — `Translate`, `Scale`, `Rotate`, `Reflect`, ... — and quickly accumulates more than two observed types. C2 marks each site megamorphic, doesn't inline, EA can't see across the call. Every intermediate `Point` allocates on the heap.

**Symptom.** A transform pipeline allocates `~3 * 16 = 48` bytes per call. Across a million-point dataset that's 48 MB of allocation pressure — visible in GC.

**Fix.** Reduce megamorphism. Options: combine `t1`/`t2`/`t3` upfront into a single composite (`Transform composed = t1.andThen(t2).andThen(t3);` — still megamorphic but one indirection), or templatise via generics + `final` classes for the common cases. The cleanest fix is often to inline the transforms by hand on the hot path: write `process(Translate t1, Scale t2, Rotate t3)` overloads that the JIT can specialise.

---

## Bug 8 — Arrays don't scalar-replace in HotSpot C2

```java
public double[] minMax(double[] xs) {
    double[] result = new double[2];
    result[0] = xs[0]; result[1] = xs[0];
    for (double x : xs) {
        if (x < result[0]) result[0] = x;
        if (x > result[1]) result[1] = x;
    }
    return result;
}
```

The `result` array is small, fixed-size, and obviously local — *until* it is returned. Returning makes it GlobalEscape. Even without the return, C2's EA does not scalar-replace arrays. The allocation always happens.

**Symptom.** Engineer reads "EA handles small local objects" and expects the array case to work the same way. It doesn't.

**Fix.** Don't use an array as a "small tuple". Use a record:

```java
public record MinMax(double min, double max) {}

public MinMax minMax(double[] xs) {
    double mn = xs[0], mx = xs[0];
    for (double x : xs) {
        if (x < mn) mn = x;
        if (x > mx) mx = x;
    }
    return new MinMax(mn, mx);                              // scalar-replaceable IF inlined into caller
}
```

The `MinMax` record can be scalar-replaced in the *caller* if `minMax` is inlined; the array version cannot. Note Graal's PEA *can* scalar-replace some array cases C2 cannot.

---

## Bug 9 — Large record exceeds scalar replacement budget

```java
public record Vec16(
    double x0, double x1, double x2, double x3,
    double x4, double x5, double x6, double x7,
    double x8, double x9, double xa, double xb,
    double xc, double xd, double xe, double xf
) {}

double process() {
    Vec16 v = new Vec16(...);                              // 128 bytes of payload
    return v.x0() + v.x1() + ... + v.xf();
}
```

The record is NoEscape. But scalar replacement needs to assign 16 `double` fields to SSA values, and register allocation has to find homes for all 16. On x86-64, that's all 16 XMM registers — and there are usually other live values too. The result: register pressure forces spills, and in some cases C2 just gives up and keeps the allocation.

**Symptom.** A medium-size record that the engineer expected to scalar-replace shows up in `PrintEliminateAllocations` as *not* eliminated (or appears in allocation profiling).

**Fix.** Break large value types into smaller pieces — process 4 at a time as a `Vec4`, accumulate into scalars. Or accept the allocation: 128 bytes once per call is not a meaningful cost unless the call rate is very high.

---

## Bug 10 — `synchronized` on non-escaping object — lock elision works

```java
public String render(int x, int y) {
    StringBuilder sb = new StringBuilder();
    synchronized (sb) {                                    // synchronization on NoEscape object
        sb.append("x=").append(x).append(", y=").append(y);
    }
    return sb.toString();
}
```

Out of context, this looks like a performance bug: `synchronized` is expensive, and `sb` is local — why lock at all? But C2 proves `sb` is NoEscape and the lock is on a thread-local object, so it elides both the `monitorenter` and `monitorexit`. The compiled code is identical to the non-synchronized version.

**The "bug" is the developer's confusion**, not the runtime cost. A code reviewer sees the `synchronized` and recommends removing it; the developer protests "but EA handles this". Both are right: the lock is free *today*, but it's also misleading (signals shared mutation that doesn't exist) and depends on EA succeeding. If the surrounding code ever changes to make `sb` escape, the lock suddenly costs real cycles.

**Symptom.** No runtime symptom; a maintainability symptom. The next engineer wastes 20 minutes wondering what `sb` is shared with.

**Fix.** Remove the `synchronized`. Trust EA where it helps; don't depend on lock elision to clean up code-smell locks.

---

## Quick takeaways

- A benchmark showing `0.0 B/op` proves EA succeeded *on that benchmark*, not in production.
- Storing an object reference in any heap-reachable location is GlobalEscape — no EA help.
- Records help; `final` classes help; non-final classes and megamorphic call sites hurt.
- Lambdas without captures are static singletons; lambdas with captures can still escape.
- Arrays don't scalar-replace in HotSpot C2 (Graal can do some cases). Use records for small fixed tuples.
- Large records hit register-allocation pressure; break them up if scalar replacement matters.
- Lock elision rescues `synchronized` on NoEscape objects — but don't *rely* on it stylistically.

---

## What's next

| Topic                                                                | File                |
| -------------------------------------------------------------------- | ------------------- |
| Records + EA pipelines, Graal PEA, Valhalla future                   | `optimize.md`       |
| Hands-on JMH exercises                                               | `tasks.md`          |
| 20 interview Q&A                                                     | `interview.md`      |

See also: [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/) for why megamorphic calls defeat the inliner that EA depends on, and [../04-object-memory-layout/](../04-object-memory-layout/) for what an un-eliminated allocation actually costs in bytes.

---

**Memorize this:** EA failures are silent — the code still works, it just allocates. The cheapest detection is `-prof gc` in CI on every hot benchmark. The 10 bugs above are not exotic; they are the common shapes you will encounter in real codebases. Recognise the smell (field store, return, lambda capture, megamorphic call, large array, large record) and fix the smell, not the symptom.
