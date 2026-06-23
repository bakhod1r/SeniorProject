# Variables and Scopes — Optimize the Code

> **Practice optimizing slow, inefficient, or resource-heavy Java code related to Variables and Scopes.**
> Each exercise contains working but suboptimal code — your job is to make it faster, leaner, or more efficient.

---

## How to Use

1. Read the slow code and understand what it does
2. Identify the performance bottleneck
3. Write your optimized version
4. Compare with the solution and benchmark results
5. Understand **why** the optimization works

### Difficulty Levels

| Level | Focus |
|:-----:|:------|
| Easy | Obvious inefficiencies — unnecessary field access, missing final, wrong variable scope |
| Medium | Algorithmic improvements — primitive vs wrapper, scope narrowing, allocation reduction |
| Hard | JIT-aware code — escape analysis, stack allocation, GC pressure from scope misuse |

### Optimization Categories

| Category | Icon | Description |
|:--------:|:----:|:-----------|
| **Memory** | Memory | Reduce allocations, reuse objects, avoid copies |
| **CPU** | CPU | Better algorithms, fewer operations, cache efficiency |
| **Scope** | Scope | Narrow variable scope, reduce field access overhead |
| **GC** | GC | Reduce garbage collection pressure |

---

## Exercise 1: Field Access vs Local Cache — Easy / CPU

**What the code does:** Computes the sum of an array by repeatedly accessing an instance field.

**The problem:** Each field access requires an indirect memory load through `this`.

```java
public class Main {
    int[] data;

    public Main(int size) {
        data = new int[size];
        for (int i = 0; i < size; i++) {
            data[i] = i + 1;
        }
    }

    public long computeSum() {
        long sum = 0;
        for (int i = 0; i < data.length; i++) {
            sum += data[i]; // field access on every iteration
        }
        return sum;
    }

    public static void main(String[] args) {
        Main obj = new Main(10_000_000);
        long start = System.nanoTime();
        long result = 0;
        for (int iter = 0; iter < 100; iter++) {
            result = obj.computeSum();
        }
        long elapsed = (System.nanoTime() - start) / 100;
        System.out.println("Sum: " + result);
        System.out.println("Avg time: " + elapsed + " ns");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
SlowFieldAccess.compute    avgt   10  8542.3 ±  112.5  us/op
```

<details>
<summary>Hint</summary>

Cache the field reference in a local variable before the loop. The JIT can keep locals in registers, but field access requires loading from heap memory.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    int[] data;

    public Main(int size) {
        data = new int[size];
        for (int i = 0; i < size; i++) {
            data[i] = i + 1;
        }
    }

    public long computeSum() {
        // Cache field in local variable — JIT can register-allocate locals
        int[] localData = data;
        int len = localData.length;
        long sum = 0;
        for (int i = 0; i < len; i++) {
            sum += localData[i];
        }
        return sum;
    }

    public static void main(String[] args) {
        Main obj = new Main(10_000_000);
        long start = System.nanoTime();
        long result = 0;
        for (int iter = 0; iter < 100; iter++) {
            result = obj.computeSum();
        }
        long elapsed = (System.nanoTime() - start) / 100;
        System.out.println("Sum: " + result);
        System.out.println("Avg time: " + elapsed + " ns");
    }
}
```

**What changed:**
- Cached `data` in a local variable `localData` — avoids repeated field dereference
- Cached `localData.length` in `len` — avoids array length check per iteration

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastLocalAccess.compute    avgt   10  6234.7 ±   88.1  us/op
```

**Improvement:** ~1.4x faster due to register allocation of local variable.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** The JIT compiler can keep local variables in CPU registers, but instance field access requires loading from heap memory through the `this` pointer. In tight loops, this overhead adds up.
**When to apply:** Hot loops that access the same field repeatedly.
**When NOT to apply:** For a field accessed once or twice, the JIT will optimize it anyway.

</details>

---

## Exercise 2: Unnecessary Wrapper Objects — Easy / Memory

**What the code does:** Counts how many numbers in a range are divisible by 3.

**The problem:** Uses `Integer` wrapper instead of `int` primitive, causing autoboxing on every increment.

```java
public class Main {
    public static void main(String[] args) {
        Integer count = 0;
        Integer limit = 10_000_000;

        long start = System.nanoTime();
        for (Integer i = 0; i < limit; i++) {
            if (i % 3 == 0) {
                count++;
            }
        }
        long elapsed = System.nanoTime() - start;

        System.out.println("Count: " + count);
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
SlowWrapper.count          avgt   10  285.4 ±   12.3  ms/op
```

<details>
<summary>Hint</summary>

Each `i++` and `count++` on an `Integer` triggers unboxing, incrementing, and reboxing — creating a new `Integer` object each time.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int count = 0;
        int limit = 10_000_000;

        long start = System.nanoTime();
        for (int i = 0; i < limit; i++) {
            if (i % 3 == 0) {
                count++;
            }
        }
        long elapsed = System.nanoTime() - start;

        System.out.println("Count: " + count);
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**What changed:**
- Replaced all `Integer` with `int` — eliminates autoboxing/unboxing
- Loop counter is now a stack-allocated primitive

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastPrimitive.count        avgt   10   18.2 ±    1.1  ms/op
```

**Improvement:** ~15x faster, zero object allocations in the loop (no GC pressure).

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `Integer` is a heap-allocated object. Every `i++` creates a new `Integer` object (autoboxing). With 10 million iterations, that is 10+ million short-lived objects for the GC to clean up. Primitives (`int`) live on the stack and require no allocation.
**When to apply:** Always prefer primitives for loop counters and accumulators.
**When NOT to apply:** When you need nullability (e.g., database columns) or when working with generic collections (e.g., `List<Integer>`).

</details>

---

## Exercise 3: Scope Too Wide — Holding References Too Long — Easy / GC

**What the code does:** Processes data in two phases: first loads a large dataset, then performs a separate computation.

**The problem:** The large dataset reference stays in scope during the second phase, preventing GC.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        // Phase 1: Load and process large data
        List<byte[]> bigData = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            bigData.add(new byte[1024 * 1024]); // 1 MB each = 100 MB total
        }
        long phase1Result = bigData.size();
        System.out.println("Phase 1 loaded: " + phase1Result + " chunks");

        // Phase 2: Different computation that does NOT need bigData
        // But bigData is still in scope — GC cannot reclaim 100 MB
        long sum = 0;
        for (int i = 0; i < 50_000_000; i++) {
            sum += i;
        }
        System.out.println("Phase 2 result: " + sum);

        // Memory usage check
        Runtime rt = Runtime.getRuntime();
        System.out.println("Memory used: " + (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024) + " MB");
    }
}
```

**Current benchmark:**
```
Memory used during Phase 2: ~105 MB (bigData still held)
```

<details>
<summary>Hint</summary>

Narrow the scope of `bigData` so the GC can reclaim it before Phase 2 begins. Use blocks or separate methods.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        long phase1Result;

        // Phase 1: Scoped in a block — bigData is GC-eligible when block ends
        {
            List<byte[]> bigData = new ArrayList<>();
            for (int i = 0; i < 100; i++) {
                bigData.add(new byte[1024 * 1024]);
            }
            phase1Result = bigData.size();
            System.out.println("Phase 1 loaded: " + phase1Result + " chunks");
        }
        // bigData reference is now out of scope — GC can reclaim 100 MB

        System.gc(); // Suggest GC (for demonstration)

        // Phase 2: Runs with freed memory
        long sum = 0;
        for (int i = 0; i < 50_000_000; i++) {
            sum += i;
        }
        System.out.println("Phase 2 result: " + sum);

        Runtime rt = Runtime.getRuntime();
        System.out.println("Memory used: " + (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024) + " MB");
    }
}
```

**What changed:**
- Wrapped Phase 1 in a block `{ }` to limit `bigData`'s scope
- `bigData` becomes eligible for GC as soon as the block exits

**Optimized benchmark:**
```
Memory used during Phase 2: ~5 MB (bigData reclaimed)
```

**Improvement:** ~100 MB memory saved during Phase 2. Prevents OutOfMemoryError in memory-constrained environments.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** When a reference goes out of scope, the GC is free to reclaim the object (if no other references exist). Narrowing scope lets the GC work sooner.
**When to apply:** Whenever you have temporary large objects that are only needed for part of a method.
**When NOT to apply:** For small objects, the JIT and GC are efficient enough — manual scope narrowing adds unnecessary complexity.

</details>

---

## Exercise 4: Repeated String Concatenation in Wide Scope — Medium / Memory

**What the code does:** Builds a report from multiple data sources, accumulating results into a field-level string.

**The problem:** Uses string concatenation (`+=`) on an instance field, creating O(n^2) garbage.

```java
import java.util.List;

public class Main {
    String report = "";

    public void addSection(String title, List<String> items) {
        report += "=== " + title + " ===\n";
        for (String item : items) {
            report += "  - " + item + "\n";
        }
        report += "\n";
    }

    public static void main(String[] args) {
        Main builder = new Main();
        long start = System.nanoTime();

        for (int section = 0; section < 1000; section++) {
            builder.addSection("Section " + section,
                List.of("Item A", "Item B", "Item C", "Item D", "Item E"));
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Report length: " + builder.report.length());
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt      Score     Error  Units
SlowConcat.build           avgt   10  1842.5 ±   124.7  ms/op
Allocations per op:        ~3.5 million String objects
```

<details>
<summary>Hint</summary>

Replace the `String` field with `StringBuilder`. Each `+=` creates a new String object, copying the entire accumulated content each time.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.List;

public class Main {
    StringBuilder report = new StringBuilder(1024 * 64); // Pre-sized

    public void addSection(String title, List<String> items) {
        report.append("=== ").append(title).append(" ===\n");
        for (String item : items) {
            report.append("  - ").append(item).append('\n');
        }
        report.append('\n');
    }

    public static void main(String[] args) {
        Main builder = new Main();
        long start = System.nanoTime();

        for (int section = 0; section < 1000; section++) {
            builder.addSection("Section " + section,
                List.of("Item A", "Item B", "Item C", "Item D", "Item E"));
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Report length: " + builder.report.length());
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**What changed:**
- Replaced `String report` with `StringBuilder report` — appends in O(1) amortized
- Pre-sized the `StringBuilder` to avoid resizing

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastBuilder.build          avgt   10    8.3 ±    0.4  ms/op
Allocations per op:        ~5 (StringBuilder resize events)
```

**Improvement:** ~220x faster, ~700,000x fewer allocations.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** String `+=` creates a new `String` object each time, copying the entire previous content. For a report of N characters, total work is O(N^2). `StringBuilder` uses a resizable buffer and appends in O(1) amortized.
**When to apply:** Any loop that concatenates strings, especially into a field or variable that accumulates.
**When NOT to apply:** Single-line concatenation like `"Hello, " + name + "!"` — the compiler already optimizes this.

</details>

---

## Exercise 5: Recomputing Derived Values — Medium / CPU

**What the code does:** A pricing engine computes total price with tax, called repeatedly with the same tax rate.

**The problem:** Tax multiplier is recomputed from fields on every single call instead of being cached.

```java
public class Main {
    double basePrice;
    double taxPercent;
    String currency;

    public Main(double basePrice, double taxPercent, String currency) {
        this.basePrice = basePrice;
        this.taxPercent = taxPercent;
        this.currency = currency;
    }

    public double getTotalPrice() {
        // Recomputes tax multiplier every call
        double taxMultiplier = 1.0 + (taxPercent / 100.0);
        return basePrice * taxMultiplier;
    }

    public String getFormattedPrice() {
        // Calls getTotalPrice() and formats — double computation
        return String.format("%s %.2f", currency, getTotalPrice());
    }

    public static void main(String[] args) {
        Main item = new Main(99.99, 20.0, "USD");
        long start = System.nanoTime();

        String result = "";
        for (int i = 0; i < 5_000_000; i++) {
            result = item.getFormattedPrice();
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Price: " + result);
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
SlowPricing.format         avgt   10  4215.3 ±   87.6  ms/op
```

<details>
<summary>Hint</summary>

Precompute the tax multiplier and total price once (in the constructor or when values change). Cache derived values in a field.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    final double basePrice;
    final double taxPercent;
    final String currency;
    final double taxMultiplier;  // Precomputed
    final double totalPrice;     // Cached

    public Main(double basePrice, double taxPercent, String currency) {
        this.basePrice = basePrice;
        this.taxPercent = taxPercent;
        this.currency = currency;
        this.taxMultiplier = 1.0 + (taxPercent / 100.0); // Compute once
        this.totalPrice = basePrice * taxMultiplier;       // Cache result
    }

    public double getTotalPrice() {
        return totalPrice; // Simple field read
    }

    public String getFormattedPrice() {
        return String.format("%s %.2f", currency, totalPrice);
    }

    public static void main(String[] args) {
        Main item = new Main(99.99, 20.0, "USD");
        long start = System.nanoTime();

        String result = "";
        for (int i = 0; i < 5_000_000; i++) {
            result = item.getFormattedPrice();
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Price: " + result);
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**What changed:**
- Precomputed `taxMultiplier` and `totalPrice` in the constructor
- Made all fields `final` — signals immutability to the JIT, enabling further optimizations
- `getTotalPrice()` is now a simple field read

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastPricing.format         avgt   10  3842.1 ±   62.3  ms/op
```

**Improvement:** ~1.1x faster for this case (String.format dominates), but the pattern matters much more when the computation is heavier. For truly expensive derived values, this can yield 10-100x improvement.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Computing derived values once and caching them eliminates redundant work. The `final` keyword helps the JIT because it knows the field value will not change, enabling constant folding.
**When to apply:** Immutable objects with values derived from constructor parameters. Configuration objects, price calculations, mathematical constants.
**When NOT to apply:** When the underlying data changes frequently and caching would produce stale results.

</details>

---

## Exercise 6: Autoboxing in Collections — Medium / Memory

**What the code does:** Maintains a frequency map of sensor readings and computes statistics.

**The problem:** Uses `Integer` keys and values, causing heavy autoboxing in a hot loop.

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Random;

public class Main {
    public static void main(String[] args) {
        Map<Integer, Integer> frequency = new HashMap<>();
        Random random = new Random(42);

        long start = System.nanoTime();

        // Simulate 10 million sensor readings in range 0-999
        for (int i = 0; i < 10_000_000; i++) {
            Integer reading = random.nextInt(1000);
            Integer count = frequency.get(reading);
            if (count == null) {
                frequency.put(reading, 1);
            } else {
                frequency.put(reading, count + 1); // unbox, increment, rebox
            }
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Distinct values: " + frequency.size());
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
SlowFrequency.compute      avgt   10   892.4 ±   34.2  ms/op
Allocations:               ~30 million Integer objects
```

<details>
<summary>Hint</summary>

Use `merge()` or `compute()` to avoid double lookups. For ultimate performance, consider an `int[]` array instead of a `Map` since the key range is known.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.Random;

public class Main {
    public static void main(String[] args) {
        // Key range is 0-999 — use a primitive array instead of Map<Integer, Integer>
        int[] frequency = new int[1000];
        Random random = new Random(42);

        long start = System.nanoTime();

        for (int i = 0; i < 10_000_000; i++) {
            int reading = random.nextInt(1000);
            frequency[reading]++; // No boxing, no hashing, no Map overhead
        }

        long elapsed = System.nanoTime() - start;

        int distinct = 0;
        for (int count : frequency) {
            if (count > 0) distinct++;
        }

        System.out.println("Distinct values: " + distinct);
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**What changed:**
- Replaced `Map<Integer, Integer>` with `int[]` — zero boxing, O(1) direct indexing
- No `Integer` objects created — all primitives on the stack
- `frequency[reading]++` is a single array access

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastFrequency.compute      avgt   10    52.1 ±    2.8  ms/op
Allocations:               1 int[] array (4 KB)
```

**Improvement:** ~17x faster, ~30 million fewer object allocations.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `HashMap<Integer, Integer>` requires boxing every key and value. Each `put()` involves hashing, bucket lookup, and potentially creating `Entry` objects. A flat array with direct indexing avoids all of this overhead.
**When to apply:** When the key is an integer within a known bounded range.
**When NOT to apply:** When the key range is very large or sparse (e.g., 0 to 1 billion), an array would waste memory.

</details>

---

## Exercise 7: Unnecessary Object Creation in Loop — Medium / GC

**What the code does:** Formats and logs timestamps for a batch of events.

**The problem:** Creates a new `SimpleDateFormat` and `Date` object on every iteration.

```java
import java.text.SimpleDateFormat;
import java.util.Date;

public class Main {
    public static void main(String[] args) {
        long[] eventTimestamps = new long[1_000_000];
        long baseTime = System.currentTimeMillis();
        for (int i = 0; i < eventTimestamps.length; i++) {
            eventTimestamps[i] = baseTime + (i * 1000L);
        }

        long start = System.nanoTime();

        String lastFormatted = "";
        for (long timestamp : eventTimestamps) {
            // Creates new objects every iteration
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
            Date date = new Date(timestamp);
            lastFormatted = sdf.format(date);
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Last: " + lastFormatted);
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt      Score     Error  Units
SlowFormat.run             avgt   10  3421.5 ±   184.2  ms/op
Allocations:               2 million objects (SDF + Date per iteration)
```

<details>
<summary>Hint</summary>

Hoist the `SimpleDateFormat` out of the loop — it is reusable. Reuse a single `Date` object by calling `setTime()`.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.text.SimpleDateFormat;
import java.util.Date;

public class Main {
    public static void main(String[] args) {
        long[] eventTimestamps = new long[1_000_000];
        long baseTime = System.currentTimeMillis();
        for (int i = 0; i < eventTimestamps.length; i++) {
            eventTimestamps[i] = baseTime + (i * 1000L);
        }

        long start = System.nanoTime();

        // Hoist reusable objects out of the loop
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        Date date = new Date();

        String lastFormatted = "";
        for (long timestamp : eventTimestamps) {
            date.setTime(timestamp); // Reuse Date object
            lastFormatted = sdf.format(date);
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Last: " + lastFormatted);
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**What changed:**
- Moved `SimpleDateFormat` creation before the loop — created once, reused 1 million times
- Reuse single `Date` object via `setTime()` instead of creating a new one each iteration

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt      Score     Error  Units
FastFormat.run             avgt   10  1842.7 ±   102.1  ms/op
Allocations:               2 objects total (SDF + Date)
```

**Improvement:** ~1.9x faster, ~2 million fewer allocations. Note: For even better performance, use `java.time.DateTimeFormatter` (thread-safe, immutable).

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Object creation has a cost: memory allocation, constructor execution, and eventual GC. When an object can be reused across iterations, hoisting it out of the loop eliminates these costs.
**When to apply:** Any loop that creates the same type of object with predictable reuse patterns.
**When NOT to apply:** When the object is stateful in a way that makes reuse incorrect, or in multi-threaded contexts where `SimpleDateFormat` is not thread-safe (use `DateTimeFormatter` instead).

</details>

---

## Exercise 8: Escape Analysis Defeat — Wide Scope Forces Heap Allocation — Hard / GC

**What the code does:** Computes the distance between pairs of 2D points in a hot path.

**The problem:** Points are stored in a field-level list, defeating escape analysis — JVM cannot stack-allocate them.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    List<double[]> points = new ArrayList<>(); // Field holds references

    public void addPoint(double x, double y) {
        points.add(new double[]{x, y}); // Escapes to heap via field
    }

    public double totalDistance() {
        double total = 0;
        for (int i = 1; i < points.size(); i++) {
            double[] p1 = points.get(i - 1);
            double[] p2 = points.get(i);
            double dx = p2[0] - p1[0];
            double dy = p2[1] - p1[1];
            total += Math.sqrt(dx * dx + dy * dy);
        }
        return total;
    }

    public static void main(String[] args) {
        Main calc = new Main();
        for (int i = 0; i < 1_000_000; i++) {
            calc.addPoint(i * 0.1, i * 0.2);
        }

        long start = System.nanoTime();
        double result = 0;
        for (int iter = 0; iter < 10; iter++) {
            result = calc.totalDistance();
        }
        long elapsed = (System.nanoTime() - start) / 10;

        System.out.println("Total distance: " + result);
        System.out.println("Avg time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
SlowPoints.distance        avgt   10   42.3 ±    2.1  ms/op
Memory:                    ~24 MB for double[] objects + ArrayList overhead
```

**Profiling output:**
```
async-profiler alloc: 1,000,000 double[2] arrays (16 bytes each + 16 bytes header = 32 MB)
```

<details>
<summary>Hint</summary>

Use parallel arrays (`double[] xs, double[] ys`) instead of an array-of-arrays. This avoids per-point object allocation, improves cache locality, and enables SIMD auto-vectorization.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    double[] xs; // Parallel arrays — no per-point object
    double[] ys;
    int size = 0;

    public Main(int capacity) {
        xs = new double[capacity];
        ys = new double[capacity];
    }

    public void addPoint(double x, double y) {
        xs[size] = x;
        ys[size] = y;
        size++;
    }

    public double totalDistance() {
        double total = 0;
        // Cache fields in locals for tight loop
        double[] localXs = xs;
        double[] localYs = ys;
        int localSize = size;

        for (int i = 1; i < localSize; i++) {
            double dx = localXs[i] - localXs[i - 1];
            double dy = localYs[i] - localYs[i - 1];
            total += Math.sqrt(dx * dx + dy * dy);
        }
        return total;
    }

    public static void main(String[] args) {
        Main calc = new Main(1_000_000);
        for (int i = 0; i < 1_000_000; i++) {
            calc.addPoint(i * 0.1, i * 0.2);
        }

        long start = System.nanoTime();
        double result = 0;
        for (int iter = 0; iter < 10; iter++) {
            result = calc.totalDistance();
        }
        long elapsed = (System.nanoTime() - start) / 10;

        System.out.println("Total distance: " + result);
        System.out.println("Avg time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**What changed:**
- Replaced `List<double[]>` with parallel primitive arrays `double[] xs, ys`
- Eliminated 1 million `double[2]` object allocations — data stored in two contiguous arrays
- Better cache locality — sequential reads from contiguous memory
- Cached field references in locals for the hot loop

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastPoints.distance        avgt   10   11.2 ±    0.8  ms/op
Memory:                    ~16 MB (two double[] arrays, no per-element objects)
```

**Improvement:** ~3.8x faster, 50% less memory, 1 million fewer object headers.

</details>

<details>
<summary>Learn More</summary>

**Advanced concept:** Escape analysis (EA) allows the JVM to stack-allocate objects that do not escape their creating method. When objects are stored in a field or collection, they "escape" and must be heap-allocated. Parallel arrays bypass this by not creating per-element objects at all.
**JVM flags to investigate:** `-XX:+PrintEscapeAnalysis` (debug JDK), `-XX:+DoEscapeAnalysis` (on by default).
**When NOT to apply:** When each element has complex behavior (methods, inheritance). Parallel arrays sacrifice OOP for performance.

</details>

---

## Exercise 9: Static Final vs Instance Field — Constant Folding — Hard / CPU

**What the code does:** Applies a configuration-based multiplier to an array of values.

**The problem:** The multiplier is an instance field, preventing the JIT from constant-folding it into the computation.

```java
public class Main {
    double multiplier;
    double offset;

    public Main(double multiplier, double offset) {
        this.multiplier = multiplier;
        this.offset = offset;
    }

    public void transform(double[] values) {
        for (int i = 0; i < values.length; i++) {
            values[i] = values[i] * multiplier + offset; // Field reads each iteration
        }
    }

    public static void main(String[] args) {
        Main transformer = new Main(2.5, 10.0);
        double[] data = new double[10_000_000];
        for (int i = 0; i < data.length; i++) {
            data[i] = i * 0.01;
        }

        long start = System.nanoTime();
        for (int iter = 0; iter < 50; iter++) {
            transformer.transform(data);
        }
        long elapsed = (System.nanoTime() - start) / 50;

        System.out.println("First: " + data[0] + ", Last: " + data[data.length - 1]);
        System.out.println("Avg time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
SlowTransform.run          avgt   10   18.4 ±    0.9  ms/op
```

<details>
<summary>Hint</summary>

If the multiplier and offset never change, make them `static final`. The JIT can fold static final constants directly into the generated machine code, eliminating field reads entirely.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    // If values are truly constant, use static final — JIT can inline them
    static final double MULTIPLIER = 2.5;
    static final double OFFSET = 10.0;

    public static void transform(double[] values) {
        // Cache length for loop bound
        int len = values.length;
        for (int i = 0; i < len; i++) {
            values[i] = values[i] * MULTIPLIER + OFFSET; // Constant-folded by JIT
        }
    }

    public static void main(String[] args) {
        double[] data = new double[10_000_000];
        for (int i = 0; i < data.length; i++) {
            data[i] = i * 0.01;
        }

        long start = System.nanoTime();
        for (int iter = 0; iter < 50; iter++) {
            transform(data);
        }
        long elapsed = (System.nanoTime() - start) / 50;

        System.out.println("First: " + data[0] + ", Last: " + data[data.length - 1]);
        System.out.println("Avg time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**What changed:**
- Made `multiplier` and `offset` `static final` constants
- JIT can now embed the literal values 2.5 and 10.0 directly in machine code
- Method made `static` — no `this` pointer needed

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastTransform.run          avgt   10   12.1 ±    0.5  ms/op
```

**Improvement:** ~1.5x faster. The JIT can auto-vectorize with known constants (SIMD), which is harder with field reads.

</details>

<details>
<summary>Learn More</summary>

**Advanced concept:** The JIT compiler treats `static final` primitive and String fields as compile-time constants. It can fold them into computations, eliminate branches that depend on them, and enable auto-vectorization. Instance fields cannot be constant-folded because the JIT cannot prove they will not be modified via reflection.
**JVM flags to investigate:** `-XX:+PrintCompilation`, `-XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly` to see the generated native code.
**When NOT to apply:** When the values genuinely vary per instance (e.g., user-configurable settings). In that case, cache them in final instance fields and use local variables in hot loops.

</details>

---

## Exercise 10: Thread-Local Variable Scope — Avoiding Contention — Hard / Scope

**What the code does:** Multiple threads format numbers using a shared `NumberFormat`.

**The problem:** `NumberFormat` is not thread-safe; synchronizing it creates a bottleneck.

```java
import java.text.NumberFormat;
import java.util.Locale;

public class Main {
    // Shared mutable formatter — requires synchronization
    static final NumberFormat formatter = NumberFormat.getCurrencyInstance(Locale.US);

    public static String formatPrice(double price) {
        synchronized (formatter) { // Lock contention under high concurrency
            return formatter.format(price);
        }
    }

    public static void main(String[] args) throws InterruptedException {
        int threadCount = 8;
        int iterationsPerThread = 1_000_000;
        Thread[] threads = new Thread[threadCount];

        long start = System.nanoTime();

        for (int t = 0; t < threadCount; t++) {
            threads[t] = new Thread(() -> {
                for (int i = 0; i < iterationsPerThread; i++) {
                    formatPrice(i * 1.01);
                }
            });
            threads[t].start();
        }

        for (Thread thread : threads) {
            thread.join();
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Total: " + (threadCount * iterationsPerThread) + " formats");
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
SlowSharedFormat.run       avgt   10  4821.3 ±  215.6  ms/op (8 threads)
Lock contention:           ~65% of time spent waiting
```

<details>
<summary>Hint</summary>

Use `ThreadLocal<NumberFormat>` to give each thread its own formatter instance. Zero contention, zero synchronization.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.text.NumberFormat;
import java.util.Locale;

public class Main {
    // Each thread gets its own formatter — no synchronization needed
    static final ThreadLocal<NumberFormat> formatter =
        ThreadLocal.withInitial(() -> NumberFormat.getCurrencyInstance(Locale.US));

    public static String formatPrice(double price) {
        return formatter.get().format(price); // Thread-local access, no lock
    }

    public static void main(String[] args) throws InterruptedException {
        int threadCount = 8;
        int iterationsPerThread = 1_000_000;
        Thread[] threads = new Thread[threadCount];

        long start = System.nanoTime();

        for (int t = 0; t < threadCount; t++) {
            threads[t] = new Thread(() -> {
                for (int i = 0; i < iterationsPerThread; i++) {
                    formatPrice(i * 1.01);
                }
                formatter.remove(); // Clean up to prevent memory leak
            });
            threads[t].start();
        }

        for (Thread thread : threads) {
            thread.join();
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Total: " + (threadCount * iterationsPerThread) + " formats");
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**What changed:**
- Replaced shared `NumberFormat` + `synchronized` with `ThreadLocal<NumberFormat>`
- Each thread has its own formatter — zero lock contention
- Added `formatter.remove()` to prevent memory leaks in thread pools

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastThreadLocal.run        avgt   10   782.5 ±   41.3  ms/op (8 threads)
Lock contention:           0%
```

**Improvement:** ~6.2x faster with 8 threads. Scales linearly with thread count.

</details>

<details>
<summary>Learn More</summary>

**Advanced concept:** `ThreadLocal` stores a separate value per thread in a `ThreadLocalMap` attached to each `Thread` object. Access is O(1) with no synchronization. This is a scope optimization — narrowing the variable's scope from "shared across all threads" to "per-thread."
**JVM internals:** `Thread.threadLocals` is a `ThreadLocal.ThreadLocalMap` — a hash table with linear probing. Access cost is ~2-3 ns vs ~50+ ns for an uncontended `synchronized` block.
**When NOT to apply:** With virtual threads (Java 21+), prefer scoped values (`ScopedValue`) as ThreadLocals can leak and each virtual thread carries its own map.

</details>

---

## Exercise 11: Boxed Boolean in Hot Path — Hard / Memory

**What the code does:** Validates a batch of transactions with multiple boolean conditions.

**The problem:** Uses `Boolean` wrappers and creates unnecessary intermediate objects.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static Boolean isValid(Integer amount, Boolean isActive, String type) {
        Boolean result = Boolean.FALSE;
        if (amount != null && amount > 0) {
            if (isActive != null && isActive.booleanValue()) {
                if (type != null && !type.isEmpty()) {
                    result = Boolean.TRUE;
                }
            }
        }
        return result;
    }

    public static void main(String[] args) {
        List<Boolean> results = new ArrayList<>();

        long start = System.nanoTime();
        for (int i = 0; i < 5_000_000; i++) {
            Boolean valid = isValid(
                Integer.valueOf(i % 1000),
                Boolean.valueOf(i % 2 == 0),
                "purchase"
            );
            results.add(valid);
        }
        long elapsed = System.nanoTime() - start;

        long validCount = results.stream().filter(Boolean::booleanValue).count();
        System.out.println("Valid: " + validCount);
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
SlowValidation.run         avgt   10  1245.6 ±   67.3  ms/op
Allocations:               ~15 million objects (Integer, Boolean, ArrayList growth)
```

<details>
<summary>Hint</summary>

Use primitives (`int`, `boolean`) for the method parameters and return type. Use a `boolean[]` array or `BitSet` instead of `List<Boolean>` for bulk results.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.BitSet;

public class Main {
    static boolean isValid(int amount, boolean isActive, String type) {
        return amount > 0 && isActive && type != null && !type.isEmpty();
    }

    public static void main(String[] args) {
        int count = 5_000_000;
        BitSet results = new BitSet(count); // 1 bit per result vs 16+ bytes per Boolean

        long start = System.nanoTime();
        for (int i = 0; i < count; i++) {
            if (isValid(i % 1000, i % 2 == 0, "purchase")) {
                results.set(i);
            }
        }
        long elapsed = System.nanoTime() - start;

        System.out.println("Valid: " + results.cardinality());
        System.out.println("Time: " + elapsed / 1_000_000 + " ms");
    }
}
```

**What changed:**
- Method uses primitive `int` and `boolean` — no boxing
- Simplified condition logic into a single boolean expression
- Replaced `List<Boolean>` with `BitSet` — 1 bit per result instead of ~16 bytes per `Boolean` object
- Eliminated `Integer.valueOf()` and `Boolean.valueOf()` calls

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastValidation.run         avgt   10    42.3 ±    3.1  ms/op
Allocations:               1 BitSet object (~625 KB)
```

**Improvement:** ~29x faster, ~99.9% fewer allocations. `BitSet` uses ~0.6 MB vs ~80+ MB for `List<Boolean>`.

</details>

<details>
<summary>Learn More</summary>

**Advanced concept:** Each `Boolean` object is 16 bytes on a 64-bit JVM (12 byte header + 1 byte value + 3 bytes padding). Storing 5 million of them in an `ArrayList` also requires pointer storage and array resizing. A `BitSet` stores the same information in a `long[]` array — 1 bit per boolean, ~8,000x denser.
**JVM flags to investigate:** `-verbose:gc` to observe GC frequency difference, `-XX:+PrintGCDetails` for allocation rates.
**When NOT to apply:** When you need null tri-state semantics (`null`, `true`, `false`) for database mapping or when the collection is small enough that readability outweighs performance.

</details>

---

## Score Card

| Exercise | Difficulty | Category | Found bottleneck? | Your improvement | Target improvement |
|:--------:|:---------:|:--------:|:-----------------:|:----------------:|:-----------------:|
| 1 | Easy | CPU | ☐ | ___ x | 1.4x |
| 2 | Easy | Memory | ☐ | ___ x | 15x |
| 3 | Easy | GC | ☐ | ___ x | 20x (memory) |
| 4 | Medium | Memory | ☐ | ___ x | 220x |
| 5 | Medium | CPU | ☐ | ___ x | 1.1x |
| 6 | Medium | Memory | ☐ | ___ x | 17x |
| 7 | Medium | GC | ☐ | ___ x | 1.9x |
| 8 | Hard | GC | ☐ | ___ x | 3.8x |
| 9 | Hard | CPU | ☐ | ___ x | 1.5x |
| 10 | Hard | Scope | ☐ | ___ x | 6.2x |
| 11 | Hard | Memory | ☐ | ___ x | 29x |

---

## Optimization Cheat Sheet

Quick reference for variable and scope optimizations:

| Problem | Solution | Impact |
|:--------|:---------|:------:|
| Repeated field access in loop | Cache in local variable | Medium |
| `Integer`/`Boolean` in hot loop | Use `int`/`boolean` primitives | High |
| Wide variable scope holds references | Narrow scope with blocks or methods | Medium-High |
| String `+=` in loop | Use `StringBuilder` | Very High |
| Recomputing derived values | Cache in `final` field | Medium |
| `Map<Integer, Integer>` with bounded keys | Use `int[]` array | High |
| Object creation inside loop | Hoist reusable objects out | Medium |
| Per-element objects (Point, Pair) | Parallel arrays | High |
| Instance field for constant | `static final` for constant folding | Medium |
| Shared mutable state + synchronization | `ThreadLocal` per-thread scope | High |
| `List<Boolean>` bulk storage | `BitSet` | Very High |

### Rating:
- **11/11 bottlenecks found** — Senior-level Java performance awareness
- **8-10/11** — Solid understanding of JVM performance
- **5-7/11** — Good foundation, study GC and JIT behavior
- **< 5/11** — Start with the Easy exercises and review primitives vs wrappers
