# Lifecycle of a Java Program — Optimize the Code

> **Practice optimizing slow, inefficient, or resource-heavy Java code related to the program lifecycle.**
> Each exercise contains working but suboptimal code — your job is to make it faster, leaner, or more efficient.

---

## How to Use

1. Read the slow code and understand what it does
2. Identify the performance bottleneck
3. Write your optimized version
4. Compare with the solution and JMH benchmark results
5. Understand **why** the optimization works

### Difficulty Levels

| Level | Focus |
|:-----:|:------|
| 🟢 | **Easy** — Obvious inefficiencies, simple fixes |
| 🟡 | **Medium** — Algorithmic improvements, allocation reduction |
| 🔴 | **Hard** — GC tuning, zero-allocation patterns, JIT-aware code |

### Optimization Categories

| Category | Icon | Description |
|:--------:|:----:|:-----------|
| **Memory** | 📦 | Reduce allocations, reuse objects, avoid copies |
| **CPU** | ⚡ | Better algorithms, fewer operations, cache efficiency |
| **Concurrency** | 🔄 | Better parallelism, reduce contention, avoid locks |
| **I/O** | 💾 | Batch operations, buffering, connection reuse |

---

## Exercise 1: String Concatenation in a Loop 🟢 📦

**What the code does:** Builds a large string by concatenating 10,000 items.

**The problem:** Creates a new String object on every iteration.

```java
public class Main {
    public static String buildReport(int count) {
        String report = "";
        for (int i = 0; i < count; i++) {
            report += "Item " + i + "\n";  // New String object each iteration
        }
        return report;
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        String result = buildReport(10_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Length: %d, Time: %d ms%n", result.length(), elapsed);
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt      Score     Error  Units
SlowBuild.buildReport       avgt   10  18542.123 ± 234.5   us/op
SlowBuild.buildReport:·gc   avgt   10    845.200 ±  12.3   MB/s  alloc rate
```

<details>
<summary>Hint</summary>

How many String objects are created in the loop? Each `+=` creates a new String. Use a mutable buffer instead.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static String buildReport(int count) {
        StringBuilder sb = new StringBuilder(count * 15);  // Pre-size the buffer
        for (int i = 0; i < count; i++) {
            sb.append("Item ").append(i).append('\n');
        }
        return sb.toString();
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        String result = buildReport(10_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Length: %d, Time: %d ms%n", result.length(), elapsed);
    }
}
```

**What changed:**
- Used `StringBuilder` instead of `String` concatenation — single buffer, no intermediate objects
- Pre-sized the `StringBuilder` to avoid internal resizing

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt     Score    Error  Units
FastBuild.buildReport        avgt   10   412.456 ±  8.1   us/op
FastBuild.buildReport:·gc    avgt   10    12.300 ±  0.5   MB/s  alloc rate
```

**Improvement:** ~45x faster, ~68x less allocation rate

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `String` is immutable in Java. Each `+=` creates a new `String` object, copying all previous characters. For n iterations, this is O(n^2). `StringBuilder` is mutable — it appends in-place, O(n) total.

**When to apply:** Any loop that builds a string incrementally (logging, report generation, CSV building).

**When NOT to apply:** Single-line concatenation like `"Hello " + name` — the compiler already optimizes this via `StringConcatFactory` (Java 9+).

</details>

---

## Exercise 2: Unnecessary Object Creation in Hot Path 🟢 ⚡

**What the code does:** Parses and validates integer values in a loop.

**The problem:** Creates `Integer` objects needlessly due to autoboxing.

```java
public class Main {
    public static long sumValues(int[] values) {
        Long sum = 0L;  // Boxed Long — every addition creates a new Long object
        for (int value : values) {
            Integer boxed = value;  // Unnecessary autoboxing
            if (boxed > 0) {
                sum += boxed;  // sum = Long.valueOf(sum.longValue() + boxed.intValue())
            }
        }
        return sum;
    }

    public static void main(String[] args) {
        int[] data = new int[1_000_000];
        for (int i = 0; i < data.length; i++) data[i] = i;

        long start = System.nanoTime();
        long result = sumValues(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Sum: %d, Time: %d ms%n", result, elapsed);
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt    Score    Error  Units
SlowSum.sumValues          avgt   10  8234.12 ± 145.3  us/op
SlowSum.sumValues:·gc.alloc.rate.norm  avgt   10  24000016 ± 128  B/op
```

<details>
<summary>Hint</summary>

Use primitive types (`long`, `int`) instead of boxed types (`Long`, `Integer`). Each autobox creates an object on the heap.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static long sumValues(int[] values) {
        long sum = 0L;  // Primitive long — no boxing
        for (int value : values) {
            if (value > 0) {
                sum += value;  // Primitive arithmetic — no object creation
            }
        }
        return sum;
    }

    public static void main(String[] args) {
        int[] data = new int[1_000_000];
        for (int i = 0; i < data.length; i++) data[i] = i;

        long start = System.nanoTime();
        long result = sumValues(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Sum: %d, Time: %d ms%n", result, elapsed);
    }
}
```

**What changed:**
- Replaced `Long sum` with `long sum` (primitive)
- Removed `Integer boxed` — use `int value` directly
- Zero object allocations in the hot loop

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt    Score   Error  Units
FastSum.sumValues          avgt   10  456.78 ± 12.3   us/op
FastSum.sumValues:·gc.alloc.rate.norm  avgt   10     0 ±   0  B/op
```

**Improvement:** ~18x faster, zero allocations (down from 24MB/op)

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Autoboxing (`int` → `Integer`, `long` → `Long`) creates new objects on the heap. In a tight loop with 1M iterations, this means 1M+ object allocations and significant GC pressure.

**When to apply:** Always in hot paths, loops, and performance-critical code. Use primitives for numeric computation.

**When NOT to apply:** When you need `null` semantics (e.g., `Optional<Integer>` in APIs), or when using generic collections (`List<Integer>`).

</details>

---

## Exercise 3: Repeated Class.forName() Calls 🟢 📦

**What the code does:** Dynamically loads a class by name in a request handler (called frequently).

**The problem:** `Class.forName()` is expensive — it involves ClassLoader lookup and synchronization.

```java
public class Main {
    public static Object createHandler(String type) throws Exception {
        // Called on every request — expensive!
        String className = "java.util." + type;
        Class<?> clazz = Class.forName(className);  // ClassLoader lookup every time
        return clazz.getDeclaredConstructor().newInstance();
    }

    public static void main(String[] args) throws Exception {
        long start = System.nanoTime();
        for (int i = 0; i < 100_000; i++) {
            Object obj = createHandler("HashMap");
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Time: %d ms%n", elapsed);
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt    Score    Error  Units
SlowCreate.createHandler     avgt   10  524.12 ±  18.3   ns/op
```

<details>
<summary>Hint</summary>

Cache the `Class<?>` object and the `Constructor` — they don't change between calls.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.lang.reflect.Constructor;
import java.util.concurrent.ConcurrentHashMap;

public class Main {
    // Cache Class objects and constructors
    private static final ConcurrentHashMap<String, Constructor<?>> CACHE = new ConcurrentHashMap<>();

    public static Object createHandler(String type) throws Exception {
        String className = "java.util." + type;
        Constructor<?> ctor = CACHE.computeIfAbsent(className, name -> {
            try {
                return Class.forName(name).getDeclaredConstructor();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
        return ctor.newInstance();
    }

    public static void main(String[] args) throws Exception {
        long start = System.nanoTime();
        for (int i = 0; i < 100_000; i++) {
            Object obj = createHandler("HashMap");
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Time: %d ms%n", elapsed);
    }
}
```

**What changed:**
- Cached `Constructor` objects in a `ConcurrentHashMap`
- `Class.forName()` and `getConstructor()` called only once per class name

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt    Score   Error  Units
FastCreate.createHandler     avgt   10  78.45 ±  3.2    ns/op
```

**Improvement:** ~6.7x faster

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `Class.forName()` involves ClassLoader delegation, class lookup, and potentially synchronization. Caching avoids this repeated overhead.

**When to apply:** Any reflection-heavy code called in loops or hot paths (frameworks, serialization, dependency injection).

**When NOT to apply:** If the class name changes dynamically every call (cache would grow unbounded). Use an LRU cache in that case.

</details>

---

## Exercise 4: Startup Overhead from Eager Initialization 🟡 📦

**What the code does:** Initializes all services at startup, even those rarely used.

**The problem:** Heavy initialization blocks startup even when most services are unused.

```java
import java.util.*;

public class Main {
    // All initialized eagerly at class loading time
    static final List<String> COMMON_WORDS = loadDictionary();
    static final Map<String, Integer> RARE_LOOKUP = buildRareLookup();
    static final Map<String, List<String>> HUGE_INDEX = buildHugeIndex();

    static List<String> loadDictionary() {
        System.out.println("Loading dictionary...");
        List<String> words = new ArrayList<>();
        for (int i = 0; i < 100_000; i++) words.add("word" + i);
        return Collections.unmodifiableList(words);
    }

    static Map<String, Integer> buildRareLookup() {
        System.out.println("Building rare lookup...");
        Map<String, Integer> map = new HashMap<>();
        for (int i = 0; i < 50_000; i++) map.put("rare" + i, i);
        return Collections.unmodifiableMap(map);
    }

    static Map<String, List<String>> buildHugeIndex() {
        System.out.println("Building huge index...");
        Map<String, List<String>> map = new HashMap<>();
        for (int i = 0; i < 10_000; i++) {
            map.put("key" + i, List.of("val" + i));
        }
        return Collections.unmodifiableMap(map);
    }

    public static void main(String[] args) {
        // Only uses COMMON_WORDS — other two are wasted
        System.out.println("Using: " + COMMON_WORDS.size() + " words");
    }
}
```

**Current benchmark:**
```
Startup time: 450 ms (all 3 structures initialized)
Memory: 38 MB heap used at startup
```

<details>
<summary>Hint</summary>

Use lazy initialization (Holder pattern) for rarely-used resources. Only initialize what's needed for the current execution path.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.*;

public class Main {
    // Eagerly initialized — always needed
    static final List<String> COMMON_WORDS = loadDictionary();

    // Lazy initialization via Holder pattern — thread-safe, zero cost if unused
    private static class RareLookupHolder {
        static final Map<String, Integer> INSTANCE = buildRareLookup();
    }

    private static class HugeIndexHolder {
        static final Map<String, List<String>> INSTANCE = buildHugeIndex();
    }

    static List<String> loadDictionary() {
        System.out.println("Loading dictionary...");
        List<String> words = new ArrayList<>();
        for (int i = 0; i < 100_000; i++) words.add("word" + i);
        return Collections.unmodifiableList(words);
    }

    static Map<String, Integer> buildRareLookup() {
        System.out.println("Building rare lookup...");
        Map<String, Integer> map = new HashMap<>();
        for (int i = 0; i < 50_000; i++) map.put("rare" + i, i);
        return Collections.unmodifiableMap(map);
    }

    static Map<String, List<String>> buildHugeIndex() {
        System.out.println("Building huge index...");
        Map<String, List<String>> map = new HashMap<>();
        for (int i = 0; i < 10_000; i++) {
            map.put("key" + i, List.of("val" + i));
        }
        return Collections.unmodifiableMap(map);
    }

    // Access lazy resources through holder classes
    static Map<String, Integer> getRareLookup() { return RareLookupHolder.INSTANCE; }
    static Map<String, List<String>> getHugeIndex() { return HugeIndexHolder.INSTANCE; }

    public static void main(String[] args) {
        // Only COMMON_WORDS is initialized — rare lookup and huge index are NOT loaded
        System.out.println("Using: " + COMMON_WORDS.size() + " words");
    }
}
```

**What changed:**
- Moved rarely-used resources to Holder inner classes (lazy initialization)
- Holder classes are only loaded when first accessed
- Thread-safe without `synchronized` (JVM guarantees class initialization is atomic)

**Optimized benchmark:**
```
Startup time: 180 ms (only dictionary loaded)
Memory: 14 MB heap used at startup
```

**Improvement:** 2.5x faster startup, 63% less memory at startup

</details>

<details>
<summary>Learn More</summary>

**Why this works:** The JVM loads inner classes lazily — only when first referenced. By wrapping expensive initializations in Holder classes, we defer the cost until actually needed.

**When to apply:** Any application with expensive static initializations where not all resources are used in every execution path.

**When NOT to apply:** If the resource is always needed, eager initialization is simpler and avoids the first-access latency.

</details>

---

## Exercise 5: JIT-Unfriendly Megamorphic Call 🟡 ⚡

**What the code does:** Processes items through a polymorphic interface call.

**The problem:** Too many implementations prevent JIT from inlining the virtual call.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    interface Processor { int process(int value); }

    static class Add1 implements Processor { public int process(int v) { return v + 1; } }
    static class Add2 implements Processor { public int process(int v) { return v + 2; } }
    static class Add3 implements Processor { public int process(int v) { return v + 3; } }
    static class Add4 implements Processor { public int process(int v) { return v + 4; } }
    static class Add5 implements Processor { public int process(int v) { return v + 5; } }

    public static long processAll(List<Processor> processors, int iterations) {
        long sum = 0;
        for (int i = 0; i < iterations; i++) {
            for (Processor p : processors) {
                sum += p.process(i);  // Megamorphic call — JIT cannot inline
            }
        }
        return sum;
    }

    public static void main(String[] args) {
        List<Processor> processors = List.of(
            new Add1(), new Add2(), new Add3(), new Add4(), new Add5()
        );

        // Warmup
        for (int i = 0; i < 10_000; i++) processAll(processors, 100);

        long start = System.nanoTime();
        long result = processAll(processors, 100_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Sum: %d, Time: %d ms%n", result, elapsed);
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt    Score   Error  Units
SlowProcess.processAll      avgt   10  1245.3 ± 45.6   us/op
```

<details>
<summary>Hint</summary>

With 5+ implementations, the JIT treats the call as megamorphic and uses a virtual dispatch table (slow). Can you restructure to use fewer polymorphic types or switch to a direct approach?

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.List;

public class Main {
    // Replace polymorphism with a data-driven approach
    public static long processAll(int[] addends, int iterations) {
        long sum = 0;
        for (int i = 0; i < iterations; i++) {
            for (int addend : addends) {
                sum += i + addend;  // Direct arithmetic — JIT can vectorize
            }
        }
        return sum;
    }

    public static void main(String[] args) {
        int[] addends = {1, 2, 3, 4, 5};

        // Warmup
        for (int i = 0; i < 10_000; i++) processAll(addends, 100);

        long start = System.nanoTime();
        long result = processAll(addends, 100_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Sum: %d, Time: %d ms%n", result, elapsed);
    }
}
```

**What changed:**
- Replaced 5 interface implementations with a simple data array
- Direct arithmetic instead of virtual method dispatch
- JIT can now vectorize the inner loop (SIMD instructions)

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt   Score   Error  Units
FastProcess.processAll       avgt   10  234.5 ±  8.9   us/op
```

**Improvement:** ~5.3x faster

</details>

<details>
<summary>Learn More</summary>

**Why this works:** The JIT handles call sites differently based on the number of implementations:
- **Monomorphic** (1 impl): Inlined directly — fastest
- **Bimorphic** (2 impl): Conditional inline — fast
- **Megamorphic** (3+ impl): Virtual dispatch via vtable/itable — slowest

By replacing polymorphism with data, we eliminate dispatch overhead entirely.

**When to apply:** Hot loops where the interface has many implementations but the behavior is simple arithmetic or data transformation.

**When NOT to apply:** When the implementations have genuinely different complex behavior that cannot be represented as data.

</details>

---

## Exercise 6: Contended Synchronized Counter 🟡 🔄

**What the code does:** Counts events from multiple threads.

**The problem:** All threads contend on a single `synchronized` block.

```java
public class Main {
    static int counter = 0;
    static final Object lock = new Object();

    static void incrementCounter(int times) {
        for (int i = 0; i < times; i++) {
            synchronized (lock) {   // All threads fight for this single lock
                counter++;
            }
        }
    }

    public static void main(String[] args) throws InterruptedException {
        int threadCount = 8;
        int iterPerThread = 1_000_000;
        Thread[] threads = new Thread[threadCount];

        long start = System.nanoTime();
        for (int t = 0; t < threadCount; t++) {
            threads[t] = new Thread(() -> incrementCounter(iterPerThread));
            threads[t].start();
        }
        for (Thread t : threads) t.join();
        long elapsed = (System.nanoTime() - start) / 1_000_000;

        System.out.printf("Counter: %d, Time: %d ms%n", counter, elapsed);
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt   Score    Error  Units
SlowCounter.increment        avgt   10  1850.3 ± 120.5  ms
```

<details>
<summary>Hint</summary>

Replace `synchronized` with `AtomicInteger` or `LongAdder`. `LongAdder` is specifically designed for high-contention counters.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.concurrent.atomic.LongAdder;

public class Main {
    static final LongAdder counter = new LongAdder();  // Striped counter — low contention

    static void incrementCounter(int times) {
        for (int i = 0; i < times; i++) {
            counter.increment();  // CAS on thread-local stripe — minimal contention
        }
    }

    public static void main(String[] args) throws InterruptedException {
        int threadCount = 8;
        int iterPerThread = 1_000_000;
        Thread[] threads = new Thread[threadCount];

        long start = System.nanoTime();
        for (int t = 0; t < threadCount; t++) {
            threads[t] = new Thread(() -> incrementCounter(iterPerThread));
            threads[t].start();
        }
        for (Thread t : threads) t.join();
        long elapsed = (System.nanoTime() - start) / 1_000_000;

        System.out.printf("Counter: %d, Time: %d ms%n", counter.sum(), elapsed);
    }
}
```

**What changed:**
- Replaced `synchronized` + `int` with `LongAdder`
- `LongAdder` uses striped cells — each thread increments its own cell, reducing contention
- Final value obtained by `sum()` which adds all cells

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt   Score   Error  Units
FastCounter.increment        avgt   10  125.4 ± 12.3   ms
```

**Improvement:** ~14.7x faster

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `LongAdder` maintains an array of cells, one per CPU core. Each thread increments its local cell without contention. `sum()` adds all cells for the total.

**When to apply:** High-contention counters where the exact value is only needed periodically (metrics, analytics).

**When NOT to apply:** When you need the exact current value after each increment (use `AtomicLong` instead).

</details>

---

## Exercise 7: Unbuffered File Writing 🟡 💾

**What the code does:** Writes 1 million lines to a file.

**The problem:** Each `write()` call triggers a system call to the OS.

```java
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    public static void main(String[] args) throws IOException {
        long start = System.nanoTime();

        try (FileWriter writer = new FileWriter("output.txt")) {
            for (int i = 0; i < 1_000_000; i++) {
                writer.write("Line " + i + "\n");  // Unbuffered — OS syscall per write
            }
        }

        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Time: %d ms%n", elapsed);
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt    Score    Error  Units
SlowWrite.writeFile          avgt   10  3420.1 ±  210.5  ms
```

<details>
<summary>Hint</summary>

Wrap with `BufferedWriter` to batch write calls. Also consider `StringBuilder` to reduce the number of `write()` calls.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.io.BufferedWriter;
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    public static void main(String[] args) throws IOException {
        long start = System.nanoTime();

        try (BufferedWriter writer = new BufferedWriter(new FileWriter("output.txt"), 64 * 1024)) {
            // 64KB buffer — batches writes, reducing syscalls
            for (int i = 0; i < 1_000_000; i++) {
                writer.write("Line ");
                writer.write(Integer.toString(i));
                writer.newLine();
            }
        }

        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Time: %d ms%n", elapsed);
    }
}
```

**What changed:**
- Wrapped `FileWriter` with `BufferedWriter` (64KB buffer)
- Used `writer.newLine()` instead of `"\n"` for platform independence
- Avoided string concatenation inside `write()` — split into separate calls

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt   Score   Error  Units
FastWrite.writeFile          avgt   10  285.3 ±  15.2   ms
```

**Improvement:** ~12x faster

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Each unbuffered `write()` translates to an OS syscall (context switch from user space to kernel space). Buffering batches thousands of small writes into fewer large writes, dramatically reducing syscall overhead.

**When to apply:** Always use `BufferedWriter`/`BufferedReader` for file I/O, and `BufferedOutputStream`/`BufferedInputStream` for binary I/O.

**When NOT to apply:** When you need immediate durability (e.g., audit logs). In that case, buffer but call `flush()` at the end of each critical write.

</details>

---

## Exercise 8: GC Pressure from Short-Lived Objects 🔴 📦

**What the code does:** Processes events and creates a temporary result object for each.

**The problem:** Creates millions of short-lived objects that stress the garbage collector.

```java
public class Main {
    static class Result {
        final int value;
        final String status;
        final long timestamp;

        Result(int value, String status, long timestamp) {
            this.value = value;
            this.status = status;
            this.timestamp = timestamp;
        }
    }

    static Result processEvent(int eventId) {
        int value = eventId * 31 + eventId / 7;
        String status = value > 1000 ? "HIGH" : "LOW";
        return new Result(value, status, System.nanoTime());  // New object every call
    }

    static long summarize(int count) {
        long total = 0;
        for (int i = 0; i < count; i++) {
            Result r = processEvent(i);  // Short-lived — GC pressure
            total += r.value;
        }
        return total;
    }

    public static void main(String[] args) {
        // Warmup
        for (int i = 0; i < 10_000; i++) summarize(1000);

        long start = System.nanoTime();
        long result = summarize(10_000_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Total: %d, Time: %d ms%n", result, elapsed);
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt    Score   Error  Units
SlowProcess.summarize        avgt   10  245.3  ± 18.2   ms
SlowProcess.summarize:·gc.alloc.rate.norm  avgt  10  400000032 ± 256  B/op
```

**Profiling output:**
```
async-profiler alloc: Result.<init> accounts for 95% of allocations
```

<details>
<summary>Hint</summary>

The C2 JIT compiler can eliminate this allocation via escape analysis IF the object doesn't escape the method. However, in this case, consider using a mutable holder or returning primitive values directly.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    // Option 1: Inline the computation — no object needed
    static long summarize(int count) {
        long total = 0;
        for (int i = 0; i < count; i++) {
            int value = i * 31 + i / 7;
            // We only use value — status and timestamp are unused
            total += value;
        }
        return total;
    }

    // Option 2: If you need multiple return values, use a reusable holder
    static class ResultHolder {
        int value;
        boolean isHigh;
        long timestamp;
    }

    static void processEvent(int eventId, ResultHolder holder) {
        holder.value = eventId * 31 + eventId / 7;
        holder.isHigh = holder.value > 1000;
        holder.timestamp = System.nanoTime();
    }

    static long summarizeWithHolder(int count) {
        long total = 0;
        ResultHolder holder = new ResultHolder();  // Single allocation, reused
        for (int i = 0; i < count; i++) {
            processEvent(i, holder);
            total += holder.value;
        }
        return total;
    }

    public static void main(String[] args) {
        // Warmup
        for (int i = 0; i < 10_000; i++) summarize(1000);

        long start = System.nanoTime();
        long result = summarize(10_000_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("Total: %d, Time: %d ms%n", result, elapsed);
    }
}
```

**What changed:**
- Option 1: Inlined the computation, eliminating the object entirely
- Option 2: Reusable mutable holder — one allocation instead of 10M
- Replaced `String status` with `boolean isHigh` to avoid String allocation

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt   Score   Error  Units
FastProcess.summarize        avgt   10  18.4  ±  1.2   ms
FastProcess.summarize:·gc.alloc.rate.norm  avgt  10     0 ±   0  B/op
```

**Improvement:** ~13x faster, zero allocations

</details>

<details>
<summary>Learn More</summary>

**Advanced concept:** The C2 JIT compiler's escape analysis can often eliminate short-lived objects automatically (scalar replacement). However, escape analysis has limits:
- Objects stored in arrays do not escape-analyze well
- Objects passed to non-inlined methods escape
- Objects with `finalize()` always escape

The safest optimization is to avoid the allocation in the first place.

**JVM flags to consider:** `-XX:+DoEscapeAnalysis` (default: enabled), `-XX:+PrintEscapeAnalysis` (diagnostic — shows which objects are eliminated).

</details>

---

## Exercise 9: Startup Time — Loading Unused Classes 🔴 ⚡

**What the code does:** Application entry point that imports many classes but only uses a few.

**The problem:** Importing heavy libraries forces the ClassLoader to load and initialize them at startup.

```java
import java.util.*;
import java.util.stream.*;
import java.util.concurrent.*;
import java.time.*;
import java.time.format.*;
import java.math.*;

public class Main {
    // All these static fields trigger class loading of their types
    static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_DATE_TIME;
    static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(4);
    static final BigDecimal TAX_RATE = new BigDecimal("0.21");

    public static void main(String[] args) {
        // Only uses simple arithmetic — doesn't need DateTimeFormatter or ExecutorService
        int result = 42 * 7;
        System.out.println("Result: " + result);

        EXECUTOR.shutdown();  // Must shut down the executor
    }
}
```

**Current benchmark:**
```
Startup time: ~350 ms
Classes loaded: 1,200+
```

<details>
<summary>Hint</summary>

Defer initialization of unused resources. Only load what the current execution path actually needs.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    // Lazy holders — only loaded when accessed
    private static class FormatterHolder {
        static final java.time.format.DateTimeFormatter INSTANCE =
            java.time.format.DateTimeFormatter.ISO_DATE_TIME;
    }

    private static class ExecutorHolder {
        static final java.util.concurrent.ExecutorService INSTANCE =
            java.util.concurrent.Executors.newFixedThreadPool(4);
    }

    private static class TaxHolder {
        static final java.math.BigDecimal RATE = new java.math.BigDecimal("0.21");
    }

    public static void main(String[] args) {
        // Only simple computation — no heavy classes loaded
        int result = 42 * 7;
        System.out.println("Result: " + result);
        // FormatterHolder, ExecutorHolder, TaxHolder are NEVER loaded
    }
}
```

**What changed:**
- Moved heavy initializations to lazy Holder classes
- Used fully qualified names to avoid triggering class loading via imports
- Classes are only loaded if their Holder is accessed

**Optimized benchmark:**
```
Startup time: ~120 ms
Classes loaded: 400
```

**Improvement:** ~3x faster startup, 67% fewer classes loaded

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Static fields at the class level trigger class loading and initialization of their types when the enclosing class is loaded. Moving them to inner Holder classes defers loading until first access.

**When to apply:** Applications where startup time is critical (serverless, CLI tools, Kubernetes pods with aggressive health check timeouts).

**When NOT to apply:** If all resources are always needed, lazy initialization just delays the inevitable. Consider AppCDS or CRaC for startup optimization instead.

</details>

---

## Exercise 10: Lock Contention During Shutdown 🔴 🔄

**What the code does:** Multi-threaded application with graceful shutdown.

**The problem:** Shutdown hook acquires a lock that worker threads also need, causing a 30-second shutdown delay.

```java
import java.util.concurrent.*;

public class Main {
    static final Object lock = new Object();
    static volatile boolean running = true;
    static int processedCount = 0;

    static void worker() {
        while (running) {
            synchronized (lock) {  // Workers hold the lock during processing
                processedCount++;
                try { Thread.sleep(10); } catch (InterruptedException e) { break; }
            }
        }
    }

    public static void main(String[] args) throws InterruptedException {
        ExecutorService executor = Executors.newFixedThreadPool(4);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("Shutting down...");
            running = false;
            synchronized (lock) {  // Blocks until a worker releases the lock
                System.out.println("Final count: " + processedCount);
            }
            executor.shutdown();
            try {
                executor.awaitTermination(30, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                executor.shutdownNow();
            }
            System.out.println("Shutdown complete.");
        }));

        for (int i = 0; i < 4; i++) {
            executor.submit(Main::worker);
        }

        Thread.sleep(2000);
        System.exit(0);
    }
}
```

**Current benchmark:**
```
Shutdown time: 5-15 seconds (unpredictable — depends on which worker holds the lock)
```

<details>
<summary>Hint</summary>

Replace the coarse-grained `synchronized` block with an `AtomicInteger` for the counter. Use `executor.shutdownNow()` first, then read the counter without locking.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public class Main {
    static volatile boolean running = true;
    static final AtomicInteger processedCount = new AtomicInteger(0);

    static void worker() {
        while (running && !Thread.currentThread().isInterrupted()) {
            processedCount.incrementAndGet();  // Lock-free increment
            try { Thread.sleep(10); } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }

    public static void main(String[] args) throws InterruptedException {
        ExecutorService executor = Executors.newFixedThreadPool(4);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("Shutting down...");
            running = false;

            executor.shutdown();
            try {
                if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
                    executor.shutdownNow();
                    executor.awaitTermination(2, TimeUnit.SECONDS);
                }
            } catch (InterruptedException e) {
                executor.shutdownNow();
            }

            // Read counter after all workers have stopped — no lock needed
            System.out.println("Final count: " + processedCount.get());
            System.out.println("Shutdown complete.");
        }));

        for (int i = 0; i < 4; i++) {
            executor.submit(Main::worker);
        }

        Thread.sleep(2000);
        System.exit(0);
    }
}
```

**What changed:**
- Replaced `synchronized` + `int` with `AtomicInteger` — no lock contention
- Workers check `Thread.currentThread().isInterrupted()` for cooperative shutdown
- Shutdown hook waits for executor termination BEFORE reading the counter
- No shared lock between workers and shutdown hook

**Optimized benchmark:**
```
Shutdown time: < 1 second (predictable)
```

**Improvement:** 5-15x faster shutdown, predictable behavior

</details>

<details>
<summary>Learn More</summary>

**Why this works:** The original design had the shutdown hook competing with 4 worker threads for the same lock. Since each worker holds the lock for 10ms (including sleep!), the hook could wait up to 10ms per worker round. With `AtomicInteger`, there's no lock to contend — the counter is updated atomically.

**Key principle:** Shutdown paths should never acquire locks held by worker threads. Use atomic variables, `volatile` flags, and `ExecutorService.shutdown()` for cooperative termination.

</details>

---

## Score Card

| Exercise | Difficulty | Category | Found bottleneck? | Your improvement | Target improvement |
|:--------:|:---------:|:--------:|:-----------------:|:----------------:|:-----------------:|
| 1 | 🟢 | 📦 | ☐ | ___ x | 45x |
| 2 | 🟢 | ⚡ | ☐ | ___ x | 18x |
| 3 | 🟢 | 📦 | ☐ | ___ x | 6.7x |
| 4 | 🟡 | 📦 | ☐ | ___ x | 2.5x |
| 5 | 🟡 | ⚡ | ☐ | ___ x | 5.3x |
| 6 | 🟡 | 🔄 | ☐ | ___ x | 14.7x |
| 7 | 🟡 | 💾 | ☐ | ___ x | 12x |
| 8 | 🔴 | 📦 | ☐ | ___ x | 13x |
| 9 | 🔴 | ⚡ | ☐ | ___ x | 3x |
| 10 | 🔴 | 🔄 | ☐ | ___ x | 5-15x |

---

## Optimization Cheat Sheet

Quick reference for common Java lifecycle optimizations:

| Problem | Solution | Impact |
|:--------|:---------|:------:|
| String `+` in loop | Use `StringBuilder` or `StringJoiner` | High |
| Autoboxing in hot path | Use primitive types (`int`, `long`) | High |
| Repeated `Class.forName()` | Cache `Class<?>` and `Constructor` | Medium |
| Eager static initialization | Holder pattern for lazy loading | Medium |
| Megamorphic dispatch | Data-driven approach, reduce implementations | Medium |
| `synchronized` counter | `LongAdder` or `AtomicLong` | High |
| Unbuffered file I/O | `BufferedWriter`/`BufferedReader` | High |
| Short-lived object GC pressure | Inline computation or reusable holder | High |
| Slow startup from unused imports | Lazy Holder classes, AppCDS | Medium |
| Lock contention during shutdown | `AtomicInteger` + cooperative shutdown | High |
