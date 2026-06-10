# Object Lifecycle — Optimization

Twelve before/after exercises focused on *when allocation matters and when it doesn't*. Each pair shows a "default" implementation and an "optimized" alternative, with a short explanation of *why* the change pays off and how to measure.

> Always measure first. Random "optimization" guesses regress more often than they help.

---

## Optimization 1 — Avoid temporary boxing

**Before:**
```java
long sum = 0;
for (Integer x : list) sum += x;
```

**After:**
```java
long sum = 0;
for (int x : list) sum += x;
```

Or better, use a primitive stream:
```java
long sum = list.stream().mapToInt(Integer::intValue).sum();
```

**Why:** if `list` is `List<Integer>`, you can't avoid boxing the elements. But if your loop accidentally boxes — e.g. `Long sum = 0L; sum += x;` — every iteration allocates a new `Long`. Profile with `-XX:+PrintCompilation`; auto-boxing in hot loops is a frequent allocation hotspot.

**Measure:** JFR `jdk.ObjectAllocationInNewTLAB` filtered by `java.lang.Integer` / `Long`.

---

## Optimization 2 — Use static factories that cache

**Before:**
```java
Boolean b = new Boolean(true);            // deprecated; allocates
Integer x = new Integer(0);                // deprecated; allocates
```

**After:**
```java
Boolean b = Boolean.TRUE;
Integer x = Integer.valueOf(0);            // cached for -128..127
```

**Why:** wrapper-type constructors are deprecated for removal. `valueOf` returns shared instances for common values (cached at class init time).

**Measure:** trivial; use `==` to verify cached identity.

---

## Optimization 3 — Lazy initialization for heavyweight singletons

**Before:**
```java
public class App {
    private static final HeavyService SVC = new HeavyService(); // builds eagerly at class load
}
```

**After:**
```java
public class App {
    private App() {}
    private static class Holder { static final HeavyService SVC = new HeavyService(); }
    public static HeavyService svc() { return Holder.SVC; }
}
```

**Why:** the eager version pays the construction cost at App's class init, even if `SVC` is never used. The holder idiom defers it until first use, with no synchronization cost.

**Measure:** startup time; `-Xlog:class+init=info` to see when classes initialize.

---

## Optimization 4 — Don't allocate inside hot loops

**Before:**
```java
for (Item it : items) {
    var result = new Calculator(config).run(it);
    accumulate(result);
}
```

**After:**
```java
var calc = new Calculator(config);
for (Item it : items) {
    accumulate(calc.run(it));
}
```

**Why:** if `Calculator` is reusable, you've turned N allocations into 1. Even if escape analysis would eliminate them, why force the JIT to prove it?

**Measure:** `async-profiler -e alloc -d 30 -f alloc.html <pid>`.

---

## Optimization 5 — Use `Cleaner`, not `finalize`

**Before:**
```java
class Native {
    private final long handle = nalloc();
    @Override protected void finalize() throws Throwable {
        try { nfree(handle); } finally { super.finalize(); }
    }
}
```

**After:**
```java
class Native implements AutoCloseable {
    private static final Cleaner C = Cleaner.create();
    private final State state;
    private final Cleaner.Cleanable cleanable;
    private static class State implements Runnable {
        final long handle;
        State(long h) { handle = h; }
        public void run() { nfree(handle); }
    }
    public Native() {
        this.state = new State(nalloc());
        this.cleanable = C.register(this, state);
    }
    public void close() { cleanable.clean(); }
}
```

**Why:** finalizers double GC pause time, can resurrect, run on a low-priority thread. Cleaners are lighter, simpler, safer. Plus you get explicit `close()` for prompt cleanup.

**Measure:** GC pause histogram before/after; old-gen survivors should drop.

---

## Optimization 6 — Stack allocation via escape analysis

**Before (defeats EA):**
```java
double dist(double x1, double y1, double x2, double y2) {
    Point a = new Point(x1, y1);
    GLOBAL_LIST.add(a);                       // escape!
    return Math.hypot(a.x - x2, a.y - y2);
}
```

**After:**
```java
double dist(double x1, double y1, double x2, double y2) {
    Point a = new Point(x1, y1);
    return Math.hypot(a.x - x2, a.y - y2);    // no escape — C2 can scalarize
}
```

**Why:** if `Point` doesn't escape, C2 may eliminate the allocation entirely. Verify with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`.

**Measure:** look for `Replaced unscalarizable...` / `Eliminated allocation` lines in PrintCompilation output.

---

## Optimization 7 — Avoid defensive copies when caller is trusted

**Before:**
```java
public class Polygon {
    private final List<Point> points;
    public Polygon(List<Point> pts) {
        this.points = new ArrayList<>(pts);    // defensive copy
    }
    public List<Point> points() {
        return new ArrayList<>(points);        // defensive copy
    }
}
```

**After:**
```java
public class Polygon {
    private final List<Point> points;
    public Polygon(List<Point> pts) {
        this.points = List.copyOf(pts);        // immutable, single copy at most
    }
    public List<Point> points() {
        return points;                          // already immutable
    }
}
```

**Why:** `List.copyOf` returns the input directly if it's already immutable, otherwise creates an immutable copy. The accessor needs no defensive copy because the list can't be mutated. Two allocations → potentially zero.

**Measure:** allocation flame graph; look for `ArrayList.<init>` calls.

---

## Optimization 8 — Object pooling done correctly (or skipped)

**Before (naive pooling — usually a regression):**
```java
public byte[] borrow() {
    byte[] b = pool.poll();
    return b != null ? b : new byte[1024];
}
```

**After (most cases — just allocate):**
```java
public byte[] fresh() { return new byte[1024]; }
```

**Why:** modern GCs make small-object allocation ~5 ns. A pool adds atomic ops, mutex contention, and complicates correctness (was the buffer cleared? did anyone retain it?). Pool only when allocation is large or expensive (multi-MB byte arrays, native handles, DB connections).

**Rule of thumb:** if the object holds a kernel-level resource, pool. Otherwise, don't.

---

## Optimization 9 — Pre-size collections

**Before:**
```java
List<String> items = new ArrayList<>();
for (var x : input) items.add(transform(x));
```

**After:**
```java
List<String> items = new ArrayList<>(input.size());
for (var x : input) items.add(transform(x));
```

**Why:** `ArrayList` doubles its internal array when it overflows. For a 1024-element output, it allocates 8 internal arrays (1, 2, 4, ..., 1024). Pre-sizing → 1 allocation. For `HashMap`, account for load factor: `new HashMap<>(expectedSize * 4 / 3 + 1)`.

**Measure:** allocation profiler should show only one `Object[]` allocation per list.

---

## Optimization 10 — Reuse exceptions for hot-path errors

**Before:**
```java
if (!isValid(x)) throw new ValidationException("invalid");
```

**After (when stack trace doesn't matter — e.g. control-flow exceptions in parsers):**
```java
private static final ValidationException CACHED = new ValidationException("invalid") {
    @Override public synchronized Throwable fillInStackTrace() { return this; }
};
if (!isValid(x)) throw CACHED;
```

**Why:** building a stack trace costs ~1-10 µs depending on depth — huge in a parser hot path. Cached exceptions skip stack capture entirely.

**Caveat:** loses debuggability. Only use when the exception is genuinely a control-flow signal (e.g., `EOFException` in some parsers). Don't apply to genuine errors that operators need to diagnose.

---

## Optimization 11 — Deduplicate strings in long-running services

**Before:**
```java
String name = readField();    // many distinct headers, but only ~50 unique values
cache.put(key, new Entry(name));
```

**After:**
```java
private static final ConcurrentHashMap<String, String> POOL = new ConcurrentHashMap<>();
String name = POOL.computeIfAbsent(readField(), Function.identity());
cache.put(key, new Entry(name));
```

**Why:** services that store millions of `User-Agent` or `Content-Type` strings often have very few distinct values. Manual dedup or `String.intern()` (the JVM's built-in) collapses them.

**Caveat:** `String.intern()` uses a JVM-internal native hash table that can be slow under contention. Hand-rolled `ConcurrentHashMap` is safer.

**Measure:** heap dump → look at `String` retained size; deduplication should reduce by 80%+ in typical workloads.

---

## Optimization 12 — Cleaner-aware vs eager close

**Before (relies only on cleaner — late cleanup):**
```java
public class Resource {
    private final Cleaner.Cleanable cleanable;
    public Resource() { /* register cleaner */ }
    // no close()
}
```

**After:**
```java
public class Resource implements AutoCloseable {
    private final Cleaner.Cleanable cleanable;
    public Resource() { /* register */ }
    public void close() { cleanable.clean(); }
}

try (var r = new Resource()) { ... }
```

**Why:** the cleaner is a *safety net*, not a primary release strategy. Without `close()` and try-with-resources, you may hit OOM long before the cleaner runs.

**Measure:** load-test with thousands of resources; with try-with-resources, native memory should not climb.

---

## Tools cheat sheet

| Tool                                              | What it shows                              |
|---------------------------------------------------|--------------------------------------------|
| JFR (`-XX:StartFlightRecording`)                  | Allocations, GC pauses, locks, IO          |
| `async-profiler -e alloc`                         | Allocation flame graph                     |
| `jcmd <pid> GC.heap_dump`                         | Heap snapshot for MAT                      |
| Eclipse MAT                                       | Dominator trees, leak suspects             |
| `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations` | EA decisions               |
| `-XX:+PrintInlining`                              | JIT inlining decisions                     |
| `-Xlog:gc*` (J9+)                                 | Detailed GC logs                           |
| `jhsdb hsdb`                                      | Live JVM inspection (advanced)             |
| `-Xlog:class+init=info`                           | Class initialization timing                |

---

## When to skip allocation optimization

- The hot path is < 5% of total CPU time. Optimize the 80%, not this.
- The allocation count is < 10 K/s. GC won't even notice.
- The objects are short-lived and stay in eden. Young GC handles them at 1-10 µs.
- You haven't profiled. Don't guess.

---

## When allocation optimization is worth it

- TPS is allocation-bound (clear from JFR allocation rate vs throughput).
- Old-gen pressure causes major GCs every minute. Reduce promotion.
- Latency tail is dominated by GC pauses. Switch to ZGC or reduce live set.
- A specific service shows 70%+ time in `Object.<init>` paths.

---

**Memorize this**: the fastest object is the one not allocated, but proving it isn't allocated is harder than not allocating it in the first place. Profile, then prefer: (1) reuse, (2) primitives, (3) immutability + safe sharing, (4) escape-analysis-friendly code, (5) bounded pools — in that order.
