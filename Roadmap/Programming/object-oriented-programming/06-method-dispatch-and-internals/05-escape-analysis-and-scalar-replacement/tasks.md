# Escape Analysis and Scalar Replacement — Practice Tasks

Eight exercises that force EA's mechanics to bite. Each task asks you to either *prove* an allocation is eliminated (via JMH and JIT logs), *refactor* code to enable elimination, or *predict* the JIT's behaviour and verify. Work each task in three passes: (1) read and predict the outcome, (2) write and run, (3) compare your prediction to the measurement and reconcile the difference.

You will need: JDK 21+, JMH (Maven artefact `org.openjdk.jmh:jmh-core` + the `jmh-generator-annprocess`), and a build that can run with diagnostic flags.

---

## Task 1 — Verify zero allocation with `-prof gc`

```java
public record Point(double x, double y) {
    double distanceTo(Point other) {
        double dx = x - other.x;
        double dy = y - other.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}
```

**Objective.** Write a JMH benchmark that constructs `Point` instances in a loop, computes distances, and *verify* that `gc.alloc.rate.norm` reports `0.0 B/op` after warmup. Hand in the JMH output.

**Constraints.**
- Benchmark must consume the result via `Blackhole.consume(double)` (the primitive overload), not via return — returning a `Point` would force escape.
- Use at least 5 warmup iterations and 5 measurement iterations.
- Run with `-prof gc`.

**Acceptance criteria.**
- `gc.alloc.rate.norm` is `0.0 ± 0.0 B/op`.
- Also run with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations` and find the `Eliminated allocation: Point` lines for your benchmark method.
- Bonus: re-run with `-XX:-DoEscapeAnalysis` and report the allocation rate (should now show `16 B/op` per `Point`).

---

## Task 2 — Refactor escaping code

Below is a method that allocates one `Point` per loop iteration despite "looking" EA-friendly. Identify the escape vector and refactor.

```java
public class TrackBuffer {
    private Point lastSeen;

    public double totalDistance(double[] xs, double[] ys) {
        double total = 0;
        for (int i = 0; i < xs.length; i++) {
            Point next = new Point(xs[i], ys[i]);
            if (lastSeen != null) {
                total += lastSeen.distanceTo(next);
            }
            lastSeen = next;
            sink(next);
        }
        return total;
    }

    private void sink(Point p) {
        // intentionally empty — but the JIT doesn't know that yet
    }
}
```

**Objective.** Make `totalDistance` allocation-free in JMH, while preserving observable behaviour (the same final value of `lastSeen` and `total`, and `sink` still gets called per iteration).

**Constraints.**
- You may change fields, add fields, change `sink`'s signature, but you may not delete the `sink` call.
- The refactored code must JMH-verify at `0.0 B/op`.

**Acceptance criteria.**
- The `Point` allocation is eliminated.
- `lastSeen` (or its replacement) carries the same information after the loop.
- Document which escape vector you removed and why.

---

## Task 3 — Read `PrintEliminateAllocations`

**Objective.** Run any non-trivial JMH benchmark with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations -XX:+PrintEscapeAnalysis -XX:CompileCommand='print,com/yourpkg/*'`. Extract every line referring to your benchmark methods and classify each allocation site as one of:

1. Eliminated (NoEscape).
2. Kept (ArgEscape — escapes into a called method).
3. Kept (GlobalEscape — escapes the method).

**Constraints.**
- Use a benchmark with at least three different allocation shapes (e.g., a `record` consumed locally, a `record` returned, a `record` stored in a field).
- Submit the *raw* log lines plus your classification.

**Acceptance criteria.**
- Each allocation site is correctly classified, with a one-sentence justification.
- For ArgEscape sites, identify the call that caused the escape.

---

## Task 4 — Records vs classes vs primitive tuples

**Objective.** Benchmark three implementations of a simple aggregator that computes the centroid of a list of points: (a) using `record Point(double x, double y)`, (b) using a non-final `class Point { double x, y; }` with getters, (c) using two parallel `double[]` arrays. Compare `ns/op` and `gc.alloc.rate.norm` across the three.

**Constraints.**
- Same input size (e.g., 1 000 points) across all three.
- Same accumulation logic — only the data shape differs.
- Run all three with `-prof gc`.

**Acceptance criteria.**
- A small table summarising `ns/op` and `B/op` for each variant.
- A one-paragraph explanation of why the numbers differ. Cover at least: EA success/failure per variant, inlining, vtable cost for the non-final class.
- Predict which one wins before you run; reconcile with the measurement.

---

## Task 5 — Design a Stream-like pipeline that EA can fully eliminate

**Objective.** Design and benchmark a *hand-rolled* pipeline that mirrors the shape of `Stream.map(...).filter(...).reduce(...)` but is allocation-free. For example: read a `double[]`, apply two transforms, sum the result.

**Constraints.**
- You may use lambdas or method references, but if you do, demonstrate (via `-prof gc`) that the lambda is non-capturing and EA-friendly.
- Compare against the equivalent `DoubleStream` version of the same computation.
- Both versions verified with `-prof gc`.

**Acceptance criteria.**
- The hand-rolled version is `0.0 B/op`.
- The `DoubleStream` version's allocation rate is reported and explained (it may or may not be `0.0` depending on the JDK version and how aggressively the stream is fused).
- A short note on when the readability advantage of `DoubleStream` justifies any allocation cost.

---

## Task 6 — Demonstrate lock elision

**Objective.** Construct a method that uses `synchronized` on a *local* object (e.g., a `StringBuilder` or a `ReentrantLock` you allocate inside the method) and demonstrate that the JIT elides the lock.

**Constraints.**
- Two variants: one with `synchronized` on a local object, one without `synchronized`. Both compute the same result.
- Benchmark both at the same input size.
- Use `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminatedLocks` (the flag exists in modern JDKs) to confirm.

**Acceptance criteria.**
- Both benchmarks have nearly identical `ns/op` (within JMH noise).
- The diagnostic log shows lock elimination for the `synchronized` variant.
- Explain in 2-3 sentences why elision is safe here.

---

## Task 7 — Partial-escape analysis with Graal

**Objective.** Identify a method where C2 fails to eliminate an allocation but Graal succeeds via partial-escape analysis. A reasonable shape: hot path consumes a record locally; rare error path passes the record to a logger.

**Constraints.**
- Run the benchmark on the default C2 compiler, recording `gc.alloc.rate.norm`.
- Re-run on Graal (`-XX:+UnlockExperimentalVMOptions -XX:+UseJVMCICompiler -XX:+EnableJVMCI` on a JDK that supports Graal as a JIT, or use GraalVM Community Edition).
- Same code, same input, same warmup configuration.

**Acceptance criteria.**
- C2 reports a non-zero allocation rate; Graal reports a meaningfully lower (often zero) rate on the hot path.
- A one-paragraph explanation of why Graal's PEA succeeds where C2's EA fails.
- If you cannot install Graal, document the attempted setup and predict the result based on the senior-level material.

---

## Task 8 — Predict EA outcome for 5 snippets

For each of the snippets below, predict (before running) whether the `Point` allocation in the marked method will be (a) eliminated, (b) kept (ArgEscape), or (c) kept (GlobalEscape). Then write a JMH benchmark for each and verify with `-prof gc`.

```java
// Snippet 1
double a(double x, double y) {
    Point p = new Point(x, y);
    return p.x() + p.y();
}

// Snippet 2
static Point cached;
void b(double x, double y) {
    Point p = new Point(x, y);
    cached = p;
}

// Snippet 3
double c(double x, double y, java.util.function.ToDoubleFunction<Point> f) {
    Point p = new Point(x, y);
    return f.applyAsDouble(p);
}

// Snippet 4
double d(double x, double y) {
    Point p = new Point(x, y);
    synchronized (p) {
        return p.x() - p.y();
    }
}

// Snippet 5
Point e(double x, double y) {
    Point p = new Point(x, y);
    return p;
}
```

**Constraints.**
- Submit your predictions *before* running the benchmarks.
- Then submit the JMH measurements (`B/op` per snippet).
- Reconcile any mismatch with the senior-level material.

**Acceptance criteria.**
- Predictions are explicit and ordered.
- Measurements match predictions, or any divergence is explained.
- Snippet 1: NoEscape, eliminated. Snippet 2: GlobalEscape (field). Snippet 3: depends on whether `f` is monomorphic and inlines — likely Arg/Global escape in practice. Snippet 4: NoEscape with lock elision. Snippet 5: GlobalEscape (return). Verify against this answer key only *after* you've measured.

---

## Working principles for all tasks

- **Predict first, measure second.** The point of these tasks is to calibrate your intuition. Skipping the prediction step turns the exercise into a verification ritual without the learning.
- **Use the same JDK across measurements.** EA wins shift between JDK minor versions. Pin the version and report it.
- **Quiet machine.** Run benchmarks on an otherwise-idle system; close browsers, disable energy-saving, pin CPU frequency if possible. JMH catches most of this with its variance reporting — if `Error` is large, retry.
- **Read the JIT log slowly.** The first time you see `PrintEliminateAllocations` output it looks like noise. The second time it's a map. The third time it's a debugger.

---

## What's next

| Topic                                                                | File                |
| -------------------------------------------------------------------- | ------------------- |
| 20 interview Q&A                                                     | `interview.md`      |

See also: [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/) for the inlining mechanics these tasks depend on, and [../04-object-memory-layout/](../04-object-memory-layout/) for the heap layout of allocations that EA didn't eliminate.

---

**Memorize this:** the point of these tasks is not to win EA on a contrived example. It is to develop a *reflex* — when you see a method, you can predict EA's outcome from the code shape alone. That reflex is what lets you write allocation-free hot paths the first time, instead of refactoring after profiling.
