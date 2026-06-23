# Object Lifecycle — Practice Tasks

Twelve exercises, ordered easiest to hardest. Each tests a different aspect of construction, reachability, or cleanup. Solve them in your IDE; verify with `javap`, JFR, or a debugger.

---

## Task 1 — Trace the order

Without running it, predict the output:

```java
class A {
    int x = print("A.x");
    { print("A {}"); }
    A() { print("A()"); }
    static int print(String s) { System.out.println(s); return 0; }
}
class B extends A {
    int y = print("B.y");
    { print("B {}"); }
    B() { print("B()"); }
}

new B();
```

**Goal:** write the expected output line by line. Then run it. If you missed any, re-read `middle.md` §1.

---

## Task 2 — Defensive constructor

Implement a class `ImmutablePolygon` whose constructor takes a `List<Point>` and stores it such that:

- The class is truly immutable (the caller cannot mutate the polygon afterwards).
- Iteration works (`for (Point p : polygon.points())`).
- The class is safe to share between threads without synchronization.

**Hint:** what does `List.copyOf(...)` give you? What does `final` give you?

---

## Task 3 — Counter without leaks

Build a `Counter` class:

- Each `Counter` instance has a unique increasing `id`.
- The total count of *living* `Counter` instances is queryable via `Counter.alive()`.
- When a `Counter` is garbage-collected, the count must decrease.

**Constraint:** do not use `finalize()`. Use `Cleaner`. Verify with a small program that creates 1000 counters in a loop, drops them, and calls `System.gc()`; `Counter.alive()` should approach 0.

---

## Task 4 — Find the leak

This code "should" allow short-lived `Listener` objects to be collected. Run it under `jconsole`/`VisualVM` and watch the heap. What's wrong?

```java
class EventBus {
    private final List<Consumer<String>> subs = new ArrayList<>();
    public void subscribe(Consumer<String> s) { subs.add(s); }
    public void emit(String s) { subs.forEach(c -> c.accept(s)); }
}

class Listener {
    Listener(EventBus bus) {
        bus.subscribe(s -> handle(s));
    }
    void handle(String s) { /* ... */ }
}

void burst(EventBus bus) {
    for (int i = 0; i < 1_000_000; i++) {
        new Listener(bus);
    }
}
```

**Goal:** identify the leak, propose two distinct fixes (a weak-ref subscription mechanism vs. an explicit unsubscribe contract), and implement one.

---

## Task 5 — Constructor exception safety

Write `ParserPair` that opens **two** files in its constructor and stores them as `final` fields. If the second open fails, the first must be closed.

```java
public final class ParserPair implements AutoCloseable {
    private final InputStream a, b;
    public ParserPair(Path pathA, Path pathB) throws IOException { /* ... */ }
    @Override public void close() throws IOException { /* ... */ }
}
```

**Constraint:** do this without `var` mutability tricks — either use a static factory or carefully order operations within the constructor with try/catch.

---

## Task 6 — Lazy holder idiom

Implement a thread-safe singleton `Config` that:

- Loads from disk on first use.
- Never loads twice, even under concurrent access.
- Doesn't use `synchronized` in the access path.
- Doesn't use `volatile`.

**Hint:** the lazy holder idiom uses class-loading semantics for free thread-safety.

---

## Task 7 — Track allocation

For the following code, predict whether C2's escape analysis will eliminate the `new Point` allocation. Verify with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations -XX:+PrintInlining`.

```java
double dist(double x1, double y1, double x2, double y2) {
    Point a = new Point(x1, y1);
    Point b = new Point(x2, y2);
    return Math.hypot(a.x - b.x, a.y - b.y);
}
```

**Bonus:** modify the code so EA *does not* eliminate the allocation, while keeping the same observable result. (Hint: store one of them in a field somewhere.)

---

## Task 8 — Two-phase construction

Some objects need expensive setup that depends on partially-built state. Refactor:

```java
class Server {
    private final HttpHandler handler;
    private final Logger log;
    public Server(Config c) {
        this.log = new Logger(c.logFile());
        this.handler = createHandler(c, log);   // calls back through 'this' indirectly
        log.info("Server ready: " + this);      // OOPS — toString may NPE
    }
}
```

into a form that:
1. Doesn't escape `this` from the constructor.
2. Has clear "constructed" / "started" phases.
3. Is testable (the handler can be injected).

---

## Task 9 — `static` initialization gotcha

This is a real-world bug pattern. Predict the output:

```java
public class Bad {
    public static final Bad INSTANCE = new Bad();
    public static final int LIMIT = 100;
    private int count = LIMIT;
    private Bad() {
        System.out.println("count=" + count);
    }
    public static void main(String[] a) {
        System.out.println("INSTANCE.count=" + INSTANCE.count);
    }
}
```

What's printed? Why? How would you fix it so `count` is always 100 when the constructor reads it?

---

## Task 10 — Cleaner pattern

Implement `NativeBuffer` that:

- Allocates 1 MB of off-heap memory in its constructor (use `ByteBuffer.allocateDirect`).
- Tracks total native memory in a static `LongAdder`.
- Decrements the counter when the buffer is closed *or* when it becomes phantom-reachable.
- Does not retain a reference to `this` from the cleanup runnable.

Verify by allocating 1000 buffers, dropping references, calling `System.gc()`, and asserting the counter goes back to 0.

---

## Task 11 — Order-dependent fields

```java
class Order {
    private final long itemCost;
    private final double tax = computeTax();
    private double computeTax() { return itemCost * 0.1; }

    Order(long cost) { this.itemCost = cost; }
}
```

What does `new Order(100).tax` equal? Why? Restructure so it works as intended without using a setter.

---

## Task 12 — Memory-leak detective

Given a heap dump file `app.hprof` (assume you have one), describe the steps to:

1. Identify the dominator that holds the most retained heap.
2. Find which GC root pins that dominator.
3. Distinguish whether the leak is a class-loader leak, a static collection leak, or a listener leak.
4. Propose a fix and a regression test.

This is open-ended — write the procedure as a checklist, not just for one specific tool.

---

## How to validate your answers

| Task | How to verify |
|------|---------------|
| 1, 9 | Compile and run; compare expected vs actual output |
| 2 | Try mutating the input list after construction; verify polygon is unchanged |
| 3, 10 | Run with `-Xms256m -Xmx256m -verbose:gc`; observe counter approach 0 |
| 4 | `jcmd <pid> GC.heap_info` before/after the burst; heap should not grow unboundedly |
| 5 | Throw from `Files.newInputStream` of `pathB` deliberately; verify `pathA` was closed |
| 6 | Concurrent test with 100 threads racing to call `Config.get()`; should produce one load |
| 7 | `-XX:+PrintEliminateAllocations` should mention `Point` |
| 8 | Add an assertion `assertNotNull(this.handler)` in any callback path |
| 11 | `assertEquals(10.0, new Order(100).tax)` should pass after fix |
| 12 | Use Eclipse MAT or `jhat`; verify the dominator-tree path you found |

---

## Solutions sketch (for reference)

> Don't read this until you've attempted the tasks. Spoilers ahead.

**Task 1** answer: `A.x`, `A {}`, `A()`, `B.y`, `B {}`, `B()`.

**Task 2** answer: `this.points = List.copyOf(points);` plus expose via `points()` returning the same immutable list. `final` field gives JMM safe publication.

**Task 3** sketch: register a `Cleaner.Cleanable` whose cleanup decrements an `AtomicInteger`. State must be a static nested class.

**Task 4** issue: each `new Listener` registers a lambda that captures `this` (via `s -> handle(s)`). The bus's list keeps growing forever; nothing is unsubscribed.

**Task 6** sketch:
```java
public final class Config {
    private Config() { /* load */ }
    private static class Holder { static final Config INSTANCE = new Config(); }
    public static Config get() { return Holder.INSTANCE; }
}
```

**Task 9** answer: prints `count=0` (because `LIMIT` is read during static init *while `Bad.<clinit>` is still running* — but actually no, that's fine since LIMIT is a constant variable and is inlined). Actually reads `LIMIT=100` at compile time, so output is `count=100`. Trick is more subtle when the order is reversed. Re-trace via `javap -c`.

**Task 11** answer: `tax = 0.0`. Because field initializers run in source order, `tax = computeTax()` runs *before* the constructor body sets `itemCost`. Fix: move `tax` to constructor body, or compute lazily.

**Task 12** answer: open dump → MAT → "Find Leak Suspects" → dominator tree → trace path to GC root via "Path to GC Roots → exclude weak/soft refs."

---

**Memorize this**: Lifecycle bugs are subtle but always traceable. Use `javap` to see what `<init>` actually does. Use JFR/MAT to find leaks. Use `Cleaner` not `finalize`. Don't leak `this` from constructors.
