# Covariant Returns and Bridge Methods — Optimize

> Bridges add one extra method call between caller and implementation. At cold paths and reflective invocation, that costs one extra frame. At hot paths, the JIT inlines through the bridge and the cost vanishes. This file quantifies both ends and shows when bridges genuinely matter (rarely) vs. when they're a non-issue (almost always).

---

## 1. The cost in one sentence

A bridge invocation is **one extra `invokevirtual` instruction** plus a `checkcast` on each reference parameter that was erased. At the JVM's interpreter level that's a handful of nanoseconds; at C2-compiled level it disappears entirely once HotSpot inlines both frames.

```
Caller's invokevirtual → bridge frame:
    checkcast       (for each erased reference parameter)
    invokevirtual   (to the real method)
    ireturn/areturn

Real frame:
    actual logic
```

C2 typically inlines bridge → real if the call site is monomorphic, then inlines the combined body into the caller if budget allows. Result: zero extra ops in the optimised machine code.

---

## 2. Benchmark — typed call vs. bridge call

A JMH micro-benchmark to compare invocation costs:

```java
@State(Scope.Thread)
public class BridgeBench {
    Comparable<Score> raw;
    Score             typed;

    @Setup public void setup() {
        Score s = new Score(42);
        this.raw   = s;          // goes through bridge on raw call
        this.typed = s;
    }

    @Benchmark public int viaTyped() { return typed.compareTo(typed); }
    @Benchmark public int viaBridge() { return raw.compareTo((Object) typed); }
}
```

Typical results on a recent OpenJDK 21 / x86_64 box (your numbers will differ, run JMH yourself):

| Benchmark   | ns/op  | Notes                                       |
| ----------- | ------ | ------------------------------------------- |
| `viaTyped`  | ~1.0   | C2 inlines fully; effectively a static call |
| `viaBridge` | ~1.1   | One extra frame at the bytecode level, both inlined |

The 0.1 ns difference is noise on most hardware. Conclusion: at hot paths, bridges are free.

---

## 3. Where bridges cost more — interpreter and tiered comp boundaries

In the interpreter (before tier-1 compilation kicks in), each method invocation is a real frame push: the cost of going through the bridge *is* an extra method call. On startup, with thousands of cold calls through generic interfaces, that adds up to milliseconds — not microseconds. For a server warming up, this is invisible. For a short-lived CLI tool that processes a million `Comparable.compareTo` calls before C2 even runs, it can matter.

Mitigations if it matters:

- **AOT compilation** (GraalVM Native Image, project Leyden) eliminates the interpreter phase. Bridges compile to direct jumps from day one.
- **`-XX:TieredStopAtLevel=1`** keeps tier-1 in play earlier; cheap if the workload is short-lived.
- **`-XX:CompileThreshold`** lowering forces compilation earlier. Rarely necessary.

In practice, if you're worrying about bridge overhead during startup, you have bigger startup-time issues to address first.

---

## 4. HotSpot's vtable / itable handling of bridges

The bridge occupies a real vtable (or itable, when the parent is an interface) slot. From the JVM's perspective, the bridge is just another method. C2's *type profiling* records the receiver class at the call site; once it's stable, C2 emits a direct call to the bridge — and the same profiling inside the bridge selects the real method as the inlining target.

The chain becomes:

1. Caller's `invokevirtual Comparable.compareTo:(Object)I`.
2. Profiled monomorphic at `Score`. C2 emits: `cmpTo bridge → inlined`.
3. Bridge's `invokevirtual Score.compareTo:(LScore;)I`.
4. Also monomorphic. C2 inlines the real body.

Net machine code: one `checkcast` (which often folds away if the receiver type is statically known) plus the real method's body. The bridge effectively disappears.

**Inspect** with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`. You'll see:

```
@ 5  Score::compareTo (5 bytes)  inline (hot)
@ 1  Score::compareTo (12 bytes) inline (hot)   // the bridge
```

The bridge's bytecode is small (often 5 bytes: aload_0, aload_1, checkcast, invokevirtual, areturn), well under the default inlining threshold (`MaxInlineSize=35`). It is always inlined when its callee is.

---

## 5. Reflection over bridges — the real cost

Where bridges actually cost CPU is in **reflection**, not in regular method calls.

```java
// Filtering bridges at startup:
List<Method> realMethods = Arrays.stream(clazz.getDeclaredMethods())
                                 .filter(m -> !m.isBridge())
                                 .toList();
```

`getDeclaredMethods()` itself is O(n) and allocates a `Method[]`. The filter adds an `isBridge()` check per method, which is a bitmask test (`flags & 0x0040`) — sub-nanosecond per call.

For a Spring application scanning thousands of beans, the cost is:

- Spring's `BridgeMethodResolver.findBridgedMethod` walks the class hierarchy looking for the bridged method. For each bridge, that's a tree traversal — O(depth × methods per level).
- Cached after the first scan. The startup cost is amortised over the application lifetime.

If startup is critical (serverless, CLI), reduce reflection overall — not specifically bridge handling — by using compile-time annotation processors (Micronaut, Quarkus) instead of runtime scanning.

---

## 6. Cost comparison — covariant return chain vs. cast-based access

Without covariant returns:

```java
Animal a = new Dog();
Dog d = (Dog) a.copy();   // explicit checkcast
```

With covariant returns:

```java
Dog d = new Dog().copy(); // no cast in source
```

The bytecode for the second is `invokevirtual Dog.copy:()LDog;` — no `checkcast`. For the first, it's `invokevirtual Animal.copy:()LAnimal;` followed by `checkcast Dog`. *More* bytecode, *more* operations.

But: when calling through a parent-typed reference *with* covariant returns, you still have:

```java
Animal a = new Dog();
Animal a2 = a.copy();   // goes through the bridge on Dog
```

`a.copy()` dispatches to Dog's bridge `Animal copy()`, which `invokevirtual`s the real `Dog copy()`. One extra frame, no explicit cast. The cast-based pre-Java-5 version had no bridge but had a `checkcast` instruction in the caller. The total work is roughly equivalent.

The win of covariant returns is **caller convenience**, not raw performance.

---

## 7. Memory cost — metaspace, not heap

Each bridge adds:

- A `method_info` entry in the class file (typically 30-60 bytes).
- A bytecode body (typically 5-10 bytes).
- A vtable / itable slot (one pointer, 4-8 bytes).
- Reflection metadata when `Class.getDeclaredMethods()` is first called (one `Method` object, ~150 bytes).

For a class with two bridges, that's a few hundred bytes in metaspace. Not on the heap, not per-instance. Negligible at any reasonable class count.

**Where it adds up:** dynamically generated classes — Hibernate proxies, CGLIB subclasses, ByteBuddy-generated mocks. A test suite that spawns 100,000 mock classes can see metaspace pressure. But the bridges are a small fraction of the total; the real methods, fields, and proxy infrastructure dominate.

---

## 8. JIT escape analysis is unaffected by bridges

A common worry: "Does the bridge prevent C2 from doing scalar replacement on my returned object?"

No. EA operates on the *callee*'s allocations and tracks how they escape from *the inlined call tree*. Once C2 inlines through the bridge into the real method, the bridge is invisible to EA — the analysis is identical to calling the real method directly.

```java
public class Pair<L, R> {
    private final L left; private final R right;
    public Pair(L l, R r) { this.left = l; this.right = r; }
    public L getLeft() { return left; }
}

public class IntPair extends Pair<Integer, Integer> {
    public IntPair(int l, int r) { super(l, r); }
    @Override public Integer getLeft() { return super.getLeft(); }
}

// Hot loop:
for (int i = 0; i < 1_000_000; i++) {
    int sum = new IntPair(i, i + 1).getLeft();   // boxed Integer
}
```

The `new IntPair` and the inner `Pair` boxes are subject to EA. Bridges on `IntPair.getLeft` (forwarding `Object getLeft` to `Integer getLeft`) are inlined and contribute no extra allocations. The intermediate `Integer` boxes are the real performance concern, not the bridges.

---

## 9. When bridges *do* surface in profiles

Three uncommon but real situations:

**Megamorphic call sites.** If `Comparable.compareTo` is called on twenty different concrete classes from one site, C2 falls back to `invokeinterface` through the itable. Each invocation pays the dispatch cost plus the bridge's one-instruction body. async-profiler or JFR will show frames named `<ClassName>.compareTo(java.lang.Object)` — the bridge frame. The fix is not "remove the bridge" (you can't); it's "make the call site less megamorphic" — sort by class, or split.

**`MethodHandle.invokeExact` on a bridge.** If your code generates method handles to bridges explicitly (because of incomplete `MethodType` specification), each invocation pays the bridge frame even after JIT. Specify the typed `MethodType` instead.

**Reflection (`Method.invoke`) on a bridge.** Each invocation through `Method.invoke` goes through the JVM's reflection layer, which is heavier than direct invokevirtual. If the chosen method is the bridge, you also pay the bridge frame inside. Filter bridges before invoking.

---

## 10. Practical checklist

- [ ] At hot paths, do not optimise for bridges — JIT inlines them away.
- [ ] At startup, prefer compile-time annotation processors over runtime reflection if startup time matters; bridge filtering is amortised but reflection itself is the bigger cost.
- [ ] Profile with `-XX:+PrintInlining` if you suspect bridge dispatch is a bottleneck; if you see `inline (hot)` on both frames, the bridge is free.
- [ ] Use `Method.isBridge()` (bitmask test, sub-nanosecond) to filter; don't roll your own logic.
- [ ] On megamorphic call sites, bridge frames show up in stack traces — diagnose the megamorphism, not the bridge.
- [ ] Metaspace cost per bridge is ~30-60 bytes; only matters for million-class-generation scenarios.
- [ ] Don't avoid covariant returns or generics for performance reasons. The compiler handles bridges; the JIT handles inlining; the design wins outweigh the cycle differences.

---

## 11. What's next

| Topic                                                  | File              |
| ------------------------------------------------------ | ----------------- |
| Hands-on exercises                                     | `tasks.md`         |
| Interview Q&A                                          | `interview.md`     |

Cross-references: vtable / itable dispatch costs in [../02-vtable-and-itable/](../02-vtable-and-itable/); general inlining mechanics in [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/).

---

**Memorize this:** at the JIT-compiled hot path, bridges cost zero — they inline through. At cold paths and through reflection, they cost one frame. Optimise for clarity (use covariant returns and generics freely); the runtime cost is paid only where reflection or megamorphism would have cost you anyway.
