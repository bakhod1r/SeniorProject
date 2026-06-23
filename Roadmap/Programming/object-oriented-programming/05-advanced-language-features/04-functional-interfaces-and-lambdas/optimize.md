# Functional Interfaces and Lambdas — Optimize

> Lambdas are not magic and not slow by default — but they have three measurable costs (cold-start linkage, allocation per capture, virtual dispatch) and a long list of small choices (primitive specialization, method-reference equivalence, hoisting) that decide whether your stream pipeline runs at C-speed or 5× slower. All numbers below are illustrative; verify with JMH on your hardware and JDK.

---

## 1. The three costs at a glance

| Cost                        | When it happens                                | Order of magnitude              |
|-----------------------------|-------------------------------------------------|----------------------------------|
| Cold-start linkage          | First execution of a lambda's `invokedynamic`  | ~1–5 µs *once* per call site     |
| Capture allocation          | Each evaluation of a *capturing* lambda         | 16–24 bytes per object           |
| Virtual dispatch            | Each SAM invocation                             | 0–15 ns (mono/bi/megamorphic)    |

Steady-state, the only one that matters in most code is the capture allocation, and it disappears if the JIT proves the lambda doesn't escape. The cold-start and dispatch costs are real in benchmarks and microservice warmup; they're noise in long-running CPU loops.

---

## 2. Cold-start cost: the metafactory bootstrap

The *first* time a lambda's `invokedynamic` site executes, the JVM calls `LambdaMetafactory.metafactory` (JEP 126), which spins a class, loads it, and produces a `CallSite`. Order of magnitude: a few microseconds.

```java
// First call to this method pays ~5 µs for the metafactory; subsequent calls pay ~nothing.
Function<String, Integer> length = String::length;
length.apply("hello");
```

This matters for:

- **Microbenchmarks.** A JMH benchmark that creates the lambda *inside* the measured method overstates the cost by including linkage on every iteration. JMH's `@Setup` is the right place to construct the lambda.
- **Microservice startup.** A service that lazily creates 1 000 lambda call sites at first request pays ~5 ms of one-time linkage. Use `CDS` (Class Data Sharing) and AOT (`jlink --compress`, GraalVM native-image) to amortise.
- **Serverless cold start.** Every Lambda function on AWS Lambda pays this when it first runs. Reach for non-lambda alternatives only if profiling proves it dominates; usually it doesn't.

`-Xlog:class+load=info` shows spun lambda classes loading; `jcmd <pid> VM.classloader_stats` summarises them. If a process spawns thousands of distinct lambda sites at startup, you'll see the metafactory cost in the GC logs as Metaspace pressure.

---

## 3. Steady-state cost: no slower than anonymous classes

Once the call site is linked and the JIT has profiled it, a lambda's invocation cost is the same as an anonymous inner class's invocation cost — *not* a magical free call. Both go through `invokeinterface` (or `invokevirtual` for a few specific lambda forms), both are subject to the same monomorphic/bimorphic/megamorphic JIT profile.

```java
// Two equivalent shapes in steady state:
Function<String, Integer> a = s -> s.length();
Function<String, Integer> b = new Function<>() { public Integer apply(String s) { return s.length(); } };
```

At a monomorphic call site, C2 inlines the SAM body and erases the dispatch — both shapes become as fast as a direct call. At a megamorphic call site (many distinct lambda instances flowing through `forEach`), both fall back to a real virtual call with the same cost.

The thing lambdas have over anonymous classes is: **no separate class file per occurrence**. Anonymous classes inflate the class count (and Metaspace) once per source location; lambdas share one spun class per *site*. For a project with thousands of small callbacks, that's measurable.

---

## 4. Capture allocation: the 16-byte tax

A *non-capturing* lambda is a singleton. Allocation cost: zero.

A *capturing* lambda allocates a small object every time the lambda expression is evaluated. The object holds the captured values plus the standard 12-byte object header:

```java
Runnable nonCapturing = () -> System.out.println("hi");      // singleton, 0 bytes per use

String prefix = "log: ";
Runnable capturing = () -> System.out.println(prefix);       // ~16 bytes per evaluation
```

For a typical small capture (one reference, padded), that's ~16 bytes per evaluation; for two references, ~24; for one `long`/`double`, ~24. In a hot loop that creates the lambda each iteration, you'll see allocation pressure that wasn't obvious in source.

C2's **escape analysis** often saves you: if the lambda is created inside a method and doesn't escape, EA scalar-replaces the capture object — fields live in registers, no heap allocation. Verify with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`. EA succeeds when:

- The lambda's lifetime is bounded by the method's stack frame.
- The lambda isn't stored in a heap field, passed to a method the JIT can't see through, or returned.

When EA fails, **hoist** the lambda:

```java
// Bad — fresh lambda per call, EA may fail across the loop boundary:
void process(List<Order> orders) {
    orders.forEach(o -> log.info("processing {}", o.id()));
}

// Better — non-capturing static method reference:
void process(List<Order> orders) {
    orders.forEach(MyClass::logProcessing);
}
private static void logProcessing(Order o) { /* log */ }

// Best when you want capture but only once:
private static final Consumer<Order> LOGGER = o -> log.info("processing {}", o.id());
void process(List<Order> orders) { orders.forEach(LOGGER); }
```

The third form turns "N lambda evaluations per call" into "one lambda evaluation ever" — the consumer is reused.

---

## 5. Primitive specializations — skip the boxing tax

A `Function<Integer, Integer>` boxes `int` to `Integer` on the way in and unboxes on the way out. In a tight loop over millions of elements, that's millions of `Integer` allocations (mitigated by the small-value cache, but still a measurable hit).

```java
// Generic — boxes:
Function<Integer, Integer> square = x -> x * x;
int total = 0;
for (int x : xs) total += square.apply(x);    // box-call-unbox per element

// Primitive specialization — no boxing:
IntUnaryOperator square = x -> x * x;
int total = 0;
for (int x : xs) total += square.applyAsInt(x);
```

JMH shows a typical 2–5× speedup in this shape — but the JIT can often optimise the boxed version too once EA proves the `Integer` doesn't escape. Don't switch on faith; measure first and verify with `-XX:+PrintEliminateAllocations`.

The stream API mirrors the same idea:

```java
int sum = orders.stream().mapToInt(Order::lineCount).sum();   // IntStream, no boxing
```

versus

```java
int sum = orders.stream().map(Order::lineCount).reduce(0, Integer::sum);   // boxes
```

Reach for `IntStream`, `LongStream`, `DoubleStream` and the primitive `*Function` types whenever you're in a hot path over primitives.

---

## 6. Method references and lambdas compile to the same bytecode

There is no runtime difference between `s -> s.length()` and `String::length` — both compile to `invokedynamic` against `LambdaMetafactory.metafactory` with the same `instantiatedMethodType` and an `implMethod` handle pointing at `String.length`. The bytecode is identical; the JIT decisions are identical.

```
invokedynamic #N, 0   // apply: ()LFunction;
                      //   BSM: LambdaMetafactory.metafactory
                      //   args: ( (Ljava/lang/Object;)Ljava/lang/Object;,
                      //           String.length()I,
                      //           (Ljava/lang/String;)Ljava/lang/Integer; )
```

Picking between them is purely a *readability* decision (professional.md). Don't profile-tune on the assumption one is faster than the other.

---

## 7. Megamorphic call sites — when polymorphism stops being free

HotSpot's type profiler at a SAM call site tracks observed receiver types. The three states:

- **Monomorphic** (one observed type): C2 inlines the SAM body. ~0 ns extra over a direct call.
- **Bimorphic** (two types): C2 emits a type check + two inlined bodies. ~1–2 ns extra per call.
- **Megamorphic** (≥ three): falls back to a real `invokeinterface` through the itable. ~5–15 ns extra, and the secondary wins of inlining (escape analysis, constant folding) collapse.

A `forEach` over a list of mostly-identical lambda receivers stays monomorphic. A pipeline dispatch that sees dozens of distinct lambda classes goes megamorphic — and lambdas are particularly easy to make megamorphic because each *capturing* lambda evaluation produces a new instance of a distinct class.

```java
// Likely megamorphic — each call site sees a fresh capture class:
Map<String, Function<Order, String>> handlers = ...;
orders.forEach(o -> handlers.get(o.type()).apply(o));
```

**Inspect:** `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` prints `(virtual call)` vs `(inline)` vs `(bimorphic)` decisions at each callsite.

Mitigations are the usual ones: reduce the number of distinct receivers, pre-resolve dispatch to a small enum, or accept the cost (often the readability is worth more than 10 ns per call).

---

## 8. Recycle vs allocate per call site

For long-lived lambda registrations (event listeners, comparator constants, filter predicates), allocate **once** and reuse:

```java
public final class OrderFilters {
    public static final Predicate<Order> IS_PAID      = Order::isPaid;
    public static final Predicate<Order> IS_OVERDUE   = o -> o.due().isBefore(LocalDate.now());
    public static final Predicate<Order> NEEDS_REVIEW = IS_OVERDUE.and(IS_PAID.negate());
}
```

Compared to constructing the same predicate at each call site:

```java
// Three allocations per call:
orders.stream()
      .filter(o -> o.due().isBefore(LocalDate.now()))
      .filter(o -> !o.isPaid())
      .toList();
```

Hoisting also helps the JIT: a constant-static-final lambda's class profile is stable across the whole program, so monomorphism is much more likely. The cost is one constant per lambda; the savings are one allocation per call.

When *not* to hoist:

- The lambda captures call-site-specific state (a local variable, a method parameter).
- The lambda is used in exactly one place; the hoist is over-engineering.
- The codebase favours readability over micro-optimisation and the call site reads better in-place.

---

## 9. Bench checklist — do these before claiming "lambdas are slow"

1. **Confirm steady state.** Run the JMH benchmark with `@Warmup(iterations = 10)` minimum. Cold-start linkage shows in first-iteration numbers and disappears after warmup.
2. **Hoist construction.** Create the lambda in `@Setup`, not inside `@Benchmark`. Otherwise you're benchmarking `LambdaMetafactory`.
3. **Pin the receivers.** A megamorphic site is the *actual* bottleneck in a lot of "lambdas are slow" reports — and it would be slow with anonymous classes too.
4. **Check escape analysis.** `-XX:+PrintEliminateAllocations` says whether the capture allocations are being eliminated.
5. **Compare apples to apples.** A boxed `Function<Integer, Integer>` vs a `for`-loop with `int` is not a lambda problem — it's a boxing problem. Use `IntUnaryOperator` for the lambda side too.
6. **Profile with `async-profiler`.** Wall-clock and CPU profiles will show whether time is in the lambda body, the dispatch, or somewhere unrelated.

A typical "lambdas are 30× slower" report turns out to be: a JMH that builds the lambda inside the loop (cold + allocation), with no warmup, comparing against a hand-inlined integer expression. Fix any of those and the ratio collapses.

---

## 10. Quick rules

- [ ] Cold-start linkage is ~µs and one-time per call site — irrelevant in long-running code, real in benchmarks and serverless.
- [ ] Non-capturing lambdas are singletons; capturing ones allocate ~16–24 bytes per evaluation unless EA eliminates them.
- [ ] In hot paths over primitives, use `IntStream`/`IntUnaryOperator`/`ToIntFunction` — skip the boxing tax.
- [ ] Method references and lambdas compile to the same bytecode — pick by readability, not by performance.
- [ ] Megamorphic SAM call sites cost ~5–15 ns extra plus loss of inlining; rein in the receiver set or accept the cost.
- [ ] Hoist long-lived lambdas to `static final` constants for stable JIT profiles and zero re-allocation.
- [ ] Before claiming "lambdas are slow", check warmup, megamorphism, boxing, and escape analysis in that order.

---

## 11. What's next

| Topic                                                              | File              |
|--------------------------------------------------------------------|-------------------|
| Hands-on exercises (some include JMH targets)                       | `tasks.md`        |
| Interview Q&A                                                       | `interview.md`    |

See also: [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/) for the JIT side of `invokeinterface`/`invokedynamic`, [../03-reflection-and-annotations/](../03-reflection-and-annotations/) for the `MethodHandle` and `Lookup` mechanics, and [../05-default-methods-and-diamond-problem/](../05-default-methods-and-diamond-problem/) for how `default` methods interact with hot-path dispatch.

---

**Memorize this:** the three costs are linkage (one-time, µs), allocation (per-evaluation, bytes), and dispatch (per-call, ns). Linkage is irrelevant in steady state; allocation often disappears under EA; dispatch is monomorphic unless you actively scatter receivers. Boxing — not lambda dispatch — is the usual real slowdown. Reach for primitive specializations and hoisted constants before reaching for "I'll just write the for-loop".
