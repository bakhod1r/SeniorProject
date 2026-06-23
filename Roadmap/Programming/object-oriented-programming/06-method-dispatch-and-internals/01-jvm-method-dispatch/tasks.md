# JVM Method Dispatch — Practice Tasks

Eight exercises that force you to *read* dispatch behaviour rather than reason about it abstractly. Most involve `javap`, JMH, or `-XX:+PrintInlining`. The goal: by the end you can predict the opcode emitted for any source-level call, measure the cost of each dispatch shape, and prove the effect of `final` and `sealed` on JIT decisions.

Work each task in three passes: (1) read the snippet and predict what the bytecode will look like, (2) actually compile and run the tool, (3) compare your prediction against reality and write down what surprised you.

---

## Task 1 — Compile and read `javap -c -v` for each opcode

```java
public class DispatchDemo {

    public static int doubled(int n) { return n * 2; }

    private void log()     { System.out.println("log"); }
    public  final int rpm() { return 800; }
    public  void speak()    { System.out.println("..."); }

    public void run(java.util.List<String> list) {
        doubled(7);                       // expect invokestatic
        log();                            // expect invokespecial (private)
        rpm();                            // expect invokevirtual (final method)
        speak();                          // expect invokevirtual
        list.add("hi");                   // expect invokeinterface
        Runnable r = () -> log();         // expect invokedynamic for lambda creation
        r.run();                          // expect invokeinterface
    }
}
```

**Objective.** Confirm by direct inspection that every line above produces the predicted opcode.

**Steps.**
1. `javac DispatchDemo.java`
2. `javap -c -v DispatchDemo > demo.txt`
3. Open `demo.txt` and find the `run(java.util.List)` method.
4. For each numbered comment in the source, find the matching bytecode line and identify the opcode.
5. Note the constant-pool entry referenced — does it say `Methodref`, `InterfaceMethodref`, or `InvokeDynamic`?

**Acceptance criteria.**
- You can read the disassembly without running it through an explainer.
- You correctly predicted all seven opcodes.
- For each `invokevirtual`, you can point at where the receiver was loaded.
- You can locate the `BootstrapMethods` attribute for the lambda's `invokedynamic`.
- Bonus: try changing `log()` from `private` to `public` and re-run `javap`. The opcode for the call changes from `invokespecial` to `invokevirtual`.

---

## Task 2 — JMH benchmark: four dispatch shapes

Build a JMH benchmark comparing:

1. **Static** — `staticAdd(3, 4)`.
2. **Final virtual** — `finalAdder.apply(3, 4)` where `finalAdder` is `final class` implementing `apply`.
3. **Monomorphic interface** — one `Op` implementer at the call site.
4. **Megamorphic interface** — three `Op` implementers rotated round-robin.

**Objective.** Measure the cost gap between the four shapes on your machine.

**Constraints.**
- JMH with `-Xmx2g`, `-Fork 2`, `-Warmup 5x1s`, `-Measurement 10x1s`.
- Avoid dead-code elimination: use `Blackhole.consume(result)` or return the result.
- Disable inlining one of the runs as a control: `-XX:-Inline`. Compare against the default.

**Acceptance criteria.**
- Numeric results for all four benchmarks.
- The static and monomorphic cases are within ~10% of each other.
- The megamorphic case is at least 3× slower than monomorphic.
- The `-XX:-Inline` variant is uniformly 5–10× slower across all four.
- You can explain *why* monomorphic interface dispatch is as fast as static.

Reference numbers (illustrative, your hardware may differ):

| Bench               | Default JIT  | `-XX:-Inline` |
| ------------------- | ------------ | ------------- |
| Static              | ~0.4 ns      | ~3 ns         |
| Final virtual       | ~0.4 ns      | ~5 ns         |
| Monomorphic iface   | ~0.4 ns      | ~7 ns         |
| Megamorphic iface   | ~6–10 ns     | ~12 ns        |

---

## Task 3 — Refactor a megamorphic stream pipeline to monomorphic

Starting code:

```java
public final class Aggregator {
    public <T> long sumOf(List<T> items, ToLongFunction<T> projector) {
        return items.stream().mapToLong(projector).sum();
    }
}

// Called from many places:
agg.sumOf(orders, Order::amount);
agg.sumOf(events, Event::timestamp);
agg.sumOf(users, u -> u.metadata().score());
agg.sumOf(transactions, Transaction::cents);
// ... 12 callers, 12 different projectors
```

**Objective.** Identify why this is profile-polluted, and refactor so each caller sees a monomorphic call site for `applyAsLong`.

**Constraints.**
- Don't add type-specific methods to `Aggregator` (that defeats reuse).
- The fix should change how callers *use* the helper, not what `Aggregator` does internally.

**Acceptance criteria.**
- After refactoring, `-XX:+PrintInlining` shows each caller's stream pipeline inlining the projector directly.
- A JMH benchmark comparing before/after shows ≥30% throughput improvement on a hot caller.
- You can explain why a 12-line shared utility goes megamorphic when each individual caller is monomorphic in isolation.

Hint: the answer is probably "inline the utility into each caller". The JIT typically inlines `Aggregator.sumOf` per caller, which makes the call site internal to that caller — and therefore monomorphic on that caller's projector. If `Aggregator.sumOf` is too big to inline, the call site stays shared and pollutes. Make `Aggregator.sumOf` small enough to inline (under ~35 bytes by default), or eliminate it entirely.

---

## Task 4 — Force CHA invalidation and observe deoptimization

Build a test program that:

1. Defines an interface `Encoder` with one method `String encode(Object)`.
2. Defines one implementation `JsonEncoder`.
3. Constructs a hot loop calling `encoder.encode(...)` a million times (warmup).
4. After warmup, dynamically loads a second implementation `XmlEncoder` (via `ClassLoader.loadClass` or `ServiceLoader`).
5. Runs another million iterations.

```java
public class Demo {
    public static void main(String[] args) throws Exception {
        Encoder e = new JsonEncoder();
        long warmup = hotLoop(e, 1_000_000);
        System.out.println("warmup: " + warmup + " ns/op");

        // Now load XmlEncoder reflectively
        Class<?> cls = Class.forName("com.example.XmlEncoder");
        // Force it to be loaded; we don't actually use it.

        long after = hotLoop(e, 1_000_000);
        System.out.println("after class load: " + after + " ns/op");
    }
    static long hotLoop(Encoder e, int n) { ... }
}
```

**Objective.** Observe CHA invalidation: the second loop should show measurably worse performance, and the compile log should show `made not entrant` for the hot loop method.

**Constraints.**
- Run with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation -XX:+TraceDeoptimization`.
- Run a second variant where you replace `Encoder` with `sealed interface Encoder permits JsonEncoder, XmlEncoder`. The deopt does not happen.

**Acceptance criteria.**
- First variant logs show `made not entrant` near the `Class.forName` line.
- First variant timing shows ~10–50% slowdown after class load.
- Second variant (sealed) shows no deopt and no slowdown.
- You can articulate the difference: CHA's invariant is *speculative* for open interfaces, *permanent* for sealed ones.

---

## Task 5 — Convert an open hierarchy to sealed and measure the speedup

Starting code:

```java
public abstract class Animal { public abstract String speak(); }
public class Dog  extends Animal { public String speak() { return "woof"; } }
public class Cat  extends Animal { public String speak() { return "meow"; } }
public class Bird extends Animal { public String speak() { return "tweet"; } }

public class Demo {
    public long count(List<Animal> animals) {
        long total = 0;
        for (var a : animals) total += a.speak().length();
        return total;
    }
}
```

**Objective.** Convert to `sealed Animal permits Dog, Cat, Bird` with each concrete `final`. Measure the throughput change.

**Constraints.**
- JMH benchmark with a fixed-size list of mixed `Animal` types.
- Compare the original open hierarchy against the sealed version.
- Try a third variant using pattern-match `switch` instead of polymorphic call:

```java
return switch (a) {
    case Dog d  -> 4;   // "woof"
    case Cat c  -> 4;   // "meow"
    case Bird b -> 5;   // "tweet"
};
```

**Acceptance criteria.**
- Sealed version is within ~5% of open version when receiver types are evenly distributed (the JIT bimorphic-inlines two of the three).
- Pattern-switch version is measurably faster (often 20–40%) because all three branches are inlined and no virtual call happens.
- `-XX:+PrintInlining` shows different decisions for each variant.

---

## Task 6 — Read `-XX:+PrintInlining` for a real pipeline

```java
public interface Stage<T, R> { R run(T input); }
public final class UpperCaseStage implements Stage<String, String> {
    public String run(String s) { return s.toUpperCase(); }
}
public final class LengthStage implements Stage<String, Integer> {
    public Integer run(String s) { return s.length(); }
}

public final class Pipeline {
    public static <T, R> R execute(T input, Stage<T, ?> a, Stage<?, R> b) {
        Object mid = a.run(input);
        @SuppressWarnings("unchecked")
        R out = ((Stage<Object, R>) b).run(mid);
        return out;
    }
}
```

**Objective.** Run a hot loop calling `Pipeline.execute(...)` with `UpperCaseStage` then `LengthStage`. Capture `-XX:+PrintInlining` output. Identify which calls were inlined and which weren't.

**Steps.**
1. Compile and run with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`.
2. Find the section for `Pipeline::execute`.
3. For each `a.run` and `b.run`, classify the decision: `inline (hot)`, `virtual call`, `too big`, etc.

**Acceptance criteria.**
- You can identify each line of the inlining output and explain it.
- If both `a.run` and `b.run` were inlined, why? (Monomorphic per call site, given the calling code.)
- If one was inlined and the other was `virtual call`, why? (Profile pollution from a different caller, or a size threshold tripped.)
- Bonus: change `Pipeline.execute` to take concrete `UpperCaseStage` and `LengthStage` parameters instead of `Stage<?, ?>`. Confirm both `run` calls inline.

---

## Task 7 — Demonstrate `final`'s effect on bytecode + JIT

```java
public class Engine {
    public int rpm() { return 800; }
}

public class FinalEngine {
    public final int rpm() { return 800; }
}

public class Demo {
    public int useEngine(Engine e)           { return e.rpm() + 1; }
    public int useFinalEngine(FinalEngine e) { return e.rpm() + 1; }
}
```

**Objective.** Compare the bytecode emitted for `useEngine` vs `useFinalEngine` (should be identical: both `invokevirtual`). Then compare JIT behaviour at runtime.

**Steps.**
1. `javac` both classes; `javap -c Demo` shows both methods are `invokevirtual`.
2. Build a hot loop calling `useEngine` and `useFinalEngine` from a million-iteration JMH benchmark.
3. Run with `-XX:+PrintInlining` and compare.

**Acceptance criteria.**
- Bytecode is *identical* (both `invokevirtual rpm`); the `final` modifier is invisible at the bytecode level.
- Inlining behaviour is identical at warmup (CHA proves both monomorphic).
- The interesting case: subclass `Engine` (not `FinalEngine` — it can't be subclassed) and re-run. The `useEngine` deopts; `useFinalEngine` cannot, because no subclass is possible.
- You can explain why `final` is a JIT hint even though the bytecode looks the same.

---

## Task 8 — Build a sealed `switch` faster than open-class polymorphism

You are asked to dispatch on `Decision { Allow, Deny, Challenge }` returning a `Response`. Three approaches:

```java
// Approach A — open polymorphism
public interface Decision { Response handle(Request r); }
public class Allow     implements Decision { public Response handle(Request r) { return ok(r); } }
public class Deny      implements Decision { public Response handle(Request r) { return forbid(r); } }
public class Challenge implements Decision { public Response handle(Request r) { return mfa(r); } }

Decision d = ...;
Response resp = d.handle(req);

// Approach B — sealed polymorphism
public sealed interface Decision permits Allow, Deny, Challenge { Response handle(Request r); }
// (impls become final)
Decision d = ...;
Response resp = d.handle(req);

// Approach C — sealed + pattern switch
public sealed interface Decision permits Allow, Deny, Challenge {}
public record Allow()              implements Decision {}
public record Deny(String reason)  implements Decision {}
public record Challenge(String t)  implements Decision {}

Response resp = switch (d) {
    case Allow a     -> ok(req);
    case Deny x      -> forbid(req, x.reason());
    case Challenge c -> mfa(req, c.t());
};
```

**Objective.** Benchmark all three approaches. Approach C should be fastest. Explain why in writing.

**Constraints.**
- JMH benchmark with three iterations of each approach, evenly distributed.
- Use `Blackhole` to consume the response.
- Capture `-XX:+PrintInlining` for each approach.

**Acceptance criteria.**
- Numeric results showing C is ≥2× faster than A on a megamorphic distribution.
- A short writeup (5–10 sentences) explaining:
  - A is megamorphic: the JIT falls back to itable lookup.
  - B is closed-CHA: CHA fully devirtualizes, but the call is still `invokeinterface`.
  - C is a `tableswitch` over types: all branches inlined, no virtual call at all.
- Bonus: examine the bytecode for C with `javap -c`. The `switch` over a sealed type compiles via `invokedynamic` to a `typeSwitch` bootstrap. Trace through how it dispatches.

---

## Worked solution — Task 4 (CHA invalidation)

The hot-loop method:

```java
static long hotLoop(Encoder e, int n) {
    long sum = 0;
    for (int i = 0; i < n; i++) {
        sum += e.encode("payload-" + i).length();
    }
    return sum;
}
```

Run:

```
$ java -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation \
       -XX:+TraceDeoptimization Demo
```

Expected output (trimmed):

```
   ...
   1234 12 % 4   Demo::hotLoop @ 14 (54 bytes)
warmup: 5.2 ns/op
   1500 12  4   Demo::hotLoop (54 bytes)   made not entrant
[Deoptimization] reason=class_loaded
   compile_id=12  bci=14  method=Demo.hotLoop
   1510 13 % 4   Demo::hotLoop @ 14 (54 bytes)
after class load: 12.8 ns/op
```

The sealed variant:

```java
public sealed interface Encoder permits JsonEncoder, XmlEncoder { String encode(Object o); }
public final class JsonEncoder implements Encoder { public String encode(Object o) { ... } }
public final class XmlEncoder  implements Encoder { public String encode(Object o) { ... } }
```

Run the same program. The output:

```
   1234 12 % 4   Demo::hotLoop @ 14 (54 bytes)
warmup: 5.4 ns/op
[no deopt log]
after class load: 5.5 ns/op
```

The difference: in the open-interface variant, CHA had devirtualized `encoder.encode(...)` based on the (now-violated) assumption "only `JsonEncoder` implements `Encoder`". When `XmlEncoder` loaded, the assumption broke; HotSpot invalidated `hotLoop` and recompiled with a bimorphic call site.

In the sealed variant, CHA from the start saw two implementers. The compiled `hotLoop` is bimorphic from compile time — no deopt is needed when `XmlEncoder` actually loads (it was already accounted for).

The lesson: `sealed` converts CHA's *speculative* invariant into a *permanent* one. The JIT loses no expressiveness — both variants are equally polymorphic — but the deopt risk is eliminated.

---

## Validation

| Task | How to verify the fix                                                              |
|------|------------------------------------------------------------------------------------|
| 1    | `javap -c` output matches your predictions; all seven opcodes are correctly identified |
| 2    | JMH numeric results; megamorphic ≥3× monomorphic                                   |
| 3    | `-XX:+PrintInlining` shows projector inlined per caller after refactor             |
| 4    | Deopt log shows `made not entrant` on open variant, no deopt on sealed             |
| 5    | Pattern-switch variant is 20–40% faster than open-polymorphism baseline            |
| 6    | You can explain each `(inline (hot))` or `(virtual call)` annotation in the output |
| 7    | `final` doesn't change bytecode but eliminates deopt risk under future subclassing |
| 8    | Sealed + pattern switch ≥2× faster than open polymorphism on megamorphic load      |

---

**Memorize this:** dispatch is not abstract. Compile the class, run `javap`, run JMH, read `-XX:+PrintInlining`. Every claim about dispatch speed in this section becomes obvious after one measurement. Most surprises in production come from making assumptions about what the JIT does without ever looking. The tools above are the cure.
