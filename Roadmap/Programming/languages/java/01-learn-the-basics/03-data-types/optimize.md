# Data Types — Optimize the Code

> **Practice optimizing slow, inefficient, or resource-heavy Java code related to Data Types.**
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
| Easy | Obvious inefficiencies, simple fixes |
| Medium | Algorithmic improvements, allocation reduction |
| Hard | GC tuning, zero-allocation patterns, JIT-aware code |

### Optimization Categories

| Category | Icon | Description |
|:--------:|:----:|:-----------|
| **Memory** | mem | Reduce allocations, reuse objects, avoid copies |
| **CPU** | cpu | Better algorithms, fewer operations, cache efficiency |
| **Concurrency** | conc | Better parallelism, reduce contention |
| **I/O** | io | Batch operations, buffering |

---

## Exercise 1: The Boxing Accumulator (Easy, mem)

**What the code does:** Sums all numbers from 0 to 999,999.

**The problem:** Excessive object allocation from autoboxing.

```java
public class SlowSum {
    public static long calculateSum() {
        Long sum = 0L;
        for (Integer i = 0; i < 1_000_000; i++) {
            sum += i;
        }
        return sum;
    }

    public static void main(String[] args) {
        long result = calculateSum();
        System.out.println("Sum: " + result);
    }
}
```

**Current benchmark:**
```
Benchmark                Mode  Cnt       Score     Error  Units
SlowSum.calculateSum     avgt   10  12_456.7 ± 234.5    us/op
SlowSum.gc.alloc.rate    avgt   10       2.8 ±   0.1    GB/s
```

<details>
<summary>Hint</summary>

How many objects are created per iteration? Both `sum` and `i` are wrappers.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class FastSum {
    public static long calculateSum() {
        long sum = 0L;     // primitive long — no boxing
        for (int i = 0; i < 1_000_000; i++) {  // primitive int
            sum += i;
        }
        return sum;
    }

    public static void main(String[] args) {
        long result = calculateSum();
        System.out.println("Sum: " + result);
    }
}
```

**What changed:**
- `Long sum` → `long sum` — eliminates ~1M Long autoboxing operations
- `Integer i` → `int i` — eliminates ~1M Integer autoboxing operations

**Optimized benchmark:**
```
Benchmark                Mode  Cnt     Score   Error  Units
FastSum.calculateSum     avgt   10   412.3 ±  8.7    us/op
FastSum.gc.alloc.rate    avgt   10     0.0 ±  0.0    GB/s
```

**Improvement:** ~30x faster, zero allocations (0 GB/s vs 2.8 GB/s)

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Each `sum += i` with wrapper types involves: unbox `sum` → `long`, unbox `i` → `int`, widen `i` → `long`, add, rebox result → `Long`. That's 2 unboxing calls + 1 boxing call per iteration = ~3M method calls + ~2M heap allocations eliminated.

**When to apply:** Any loop that accumulates numeric values.
**When NOT to apply:** If the loop body is dominated by I/O or database calls, boxing overhead is negligible.

</details>

---

## Exercise 2: The Unnecessary Wrapper Array (Easy, mem)

**What the code does:** Stores 1 million temperature readings and calculates the average.

**The problem:** Uses `Integer[]` instead of `int[]`.

```java
public class SlowTemperature {
    public static double averageTemperature(Integer[] readings) {
        long sum = 0;
        for (Integer reading : readings) {
            sum += reading; // unboxing on every iteration
        }
        return (double) sum / readings.length;
    }

    public static void main(String[] args) {
        Integer[] readings = new Integer[1_000_000];
        for (int i = 0; i < readings.length; i++) {
            readings[i] = 20 + (i % 30); // autoboxing
        }
        System.out.println("Average: " + averageTemperature(readings));
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
SlowTemperature.average       avgt   10  3456.2 ± 89.3    us/op
SlowTemperature.gc.alloc.norm avgt   10   20 MB            B/op
```

<details>
<summary>Hint</summary>

What's the memory difference between `Integer[]` and `int[]` for 1M elements?

</details>

<details>
<summary>Optimized Code</summary>

```java
public class FastTemperature {
    public static double averageTemperature(int[] readings) {
        long sum = 0;
        for (int reading : readings) {
            sum += reading; // no unboxing needed
        }
        return (double) sum / readings.length;
    }

    public static void main(String[] args) {
        int[] readings = new int[1_000_000];
        for (int i = 0; i < readings.length; i++) {
            readings[i] = 20 + (i % 30); // no autoboxing
        }
        System.out.println("Average: " + averageTemperature(readings));
    }
}
```

**What changed:**
- `Integer[]` → `int[]` — 5x less memory (4 MB vs 20 MB)
- No autoboxing during array fill, no unboxing during sum

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
FastTemperature.average       avgt   10   567.8 ± 12.1    us/op
FastTemperature.gc.alloc.norm avgt   10    4 MB            B/op
```

**Improvement:** 6x faster, 5x less memory

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `int[]` stores values contiguously in memory (cache-friendly). `Integer[]` stores pointers to scattered heap objects (cache-unfriendly). Modern CPUs are extremely sensitive to cache locality — contiguous data can be prefetched, while scattered objects cause cache misses.

**When to apply:** Any large numeric dataset where values are never null.
**When NOT to apply:** When null is a valid value representing missing data.

</details>

---

## Exercise 3: The String Concatenation Trap (Easy, cpu)

**What the code does:** Builds a CSV string from numeric values.

**The problem:** String concatenation with `+` in a loop creates many intermediate String objects.

```java
public class SlowCsv {
    public static String buildCsv(int[] values) {
        String result = "";
        for (int i = 0; i < values.length; i++) {
            result += values[i];
            if (i < values.length - 1) {
                result += ",";
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[] values = new int[10_000];
        for (int i = 0; i < values.length; i++) values[i] = i;
        System.out.println(buildCsv(values).substring(0, 50) + "...");
    }
}
```

**Current benchmark:**
```
Benchmark               Mode  Cnt       Score      Error  Units
SlowCsv.buildCsv       avgt   10  45_678.9 ± 1234.5    us/op
```

<details>
<summary>Hint</summary>

Each `+=` creates a new `String` object and copies all previous characters.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.StringJoiner;

public class FastCsv {
    public static String buildCsv(int[] values) {
        StringJoiner joiner = new StringJoiner(",");
        for (int value : values) {
            joiner.add(String.valueOf(value));
        }
        return joiner.toString();
    }

    public static void main(String[] args) {
        int[] values = new int[10_000];
        for (int i = 0; i < values.length; i++) values[i] = i;
        System.out.println(buildCsv(values).substring(0, 50) + "...");
    }
}
```

**What changed:**
- Used `StringJoiner` instead of `+=` — single buffer, no intermediate copies
- `StringJoiner` handles delimiter insertion automatically

**Optimized benchmark:**
```
Benchmark               Mode  Cnt     Score    Error  Units
FastCsv.buildCsv        avgt   10   234.5 ±  12.3    us/op
```

**Improvement:** ~195x faster for 10K elements. O(n) vs O(n^2).

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `String +=` is O(n) per concatenation (copies entire string). In a loop of n iterations, total copies = n(n+1)/2 = O(n^2). `StringJoiner`/`StringBuilder` appends to a resizable buffer — each append is amortized O(1), total is O(n).

**When to apply:** Any loop that builds a string from many parts.
**When NOT to apply:** Single concatenation outside a loop — `a + b + c` is already optimized by the compiler.

</details>

---

## Exercise 4: The HashMap Boxing Tax (Medium, mem)

**What the code does:** Counts frequency of each number in an array.

**The problem:** `HashMap<Integer, Integer>` boxes every key and value.

```java
import java.util.HashMap;
import java.util.Map;

public class SlowFrequency {
    public static Map<Integer, Integer> countFrequency(int[] data) {
        Map<Integer, Integer> freq = new HashMap<>();
        for (int value : data) {
            freq.merge(value, 1, Integer::sum); // autoboxing: value, 1, and sum result
        }
        return freq;
    }

    public static void main(String[] args) {
        int[] data = new int[5_000_000];
        for (int i = 0; i < data.length; i++) {
            data[i] = i % 1000; // 1000 unique values
        }
        Map<Integer, Integer> freq = countFrequency(data);
        System.out.println("Unique values: " + freq.size());
        System.out.println("Freq of 0: " + freq.get(0));
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt     Score     Error  Units
SlowFrequency.count          avgt   10  234.5  ±  12.3    ms/op
SlowFrequency.gc.alloc.norm  avgt   10   180 MB           B/op
```

<details>
<summary>Hint</summary>

If unique values are in a known range (0..999), you can use an `int[]` as a direct-indexed map.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class FastFrequency {
    public static int[] countFrequency(int[] data, int maxValue) {
        int[] freq = new int[maxValue + 1]; // direct-indexed "map"
        for (int value : data) {
            freq[value]++;
        }
        return freq;
    }

    public static void main(String[] args) {
        int[] data = new int[5_000_000];
        for (int i = 0; i < data.length; i++) {
            data[i] = i % 1000;
        }
        int[] freq = countFrequency(data, 999);
        System.out.println("Freq of 0: " + freq[0]);
    }
}
```

**What changed:**
- Replaced `HashMap<Integer, Integer>` with `int[]` — zero boxing
- Direct array indexing instead of hash computation

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt    Score    Error  Units
FastFrequency.count          avgt   10   8.7  ±  0.3    ms/op
FastFrequency.gc.alloc.norm  avgt   10    4 KB          B/op
```

**Improvement:** ~27x faster, ~45000x less memory allocated

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Array indexing is O(1) with no hash computation, no Entry object allocation, and no boxing. For small integer ranges, `int[]` is the most cache-friendly data structure possible.

**When to apply:** When keys are non-negative integers in a bounded range.
**When NOT to apply:** When key range is large/sparse (e.g., user IDs from 0 to 1 billion) — array would be too large.

</details>

---

## Exercise 5: The BigDecimal Misuse (Medium, cpu)

**What the code does:** Calculates compound interest over 100 years.

**The problem:** Using `BigDecimal(double)` constructor and unnecessary precision.

```java
import java.math.BigDecimal;
import java.math.MathContext;

public class SlowInterest {
    public static BigDecimal calculateCompoundInterest(
            double principal, double rate, int years) {
        BigDecimal balance = new BigDecimal(principal); // BAD: double constructor
        BigDecimal annualRate = new BigDecimal(1.0 + rate); // BAD: double constructor

        for (int i = 0; i < years; i++) {
            balance = balance.multiply(annualRate); // precision grows exponentially!
        }
        return balance;
    }

    public static void main(String[] args) {
        BigDecimal result = calculateCompoundInterest(1000.0, 0.05, 100);
        System.out.println("Final balance: $" + result.setScale(2, java.math.RoundingMode.HALF_UP));
    }
}
```

**Current benchmark:**
```
Benchmark                       Mode  Cnt     Score     Error  Units
SlowInterest.calculate          avgt   10  4567.8  ± 123.4    us/op
```

<details>
<summary>Hint</summary>

`BigDecimal.multiply()` without a `MathContext` creates results with ever-increasing precision. After 100 multiplications, the number has hundreds of decimal digits.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;

public class FastInterest {
    private static final MathContext MC = new MathContext(10, RoundingMode.HALF_UP);

    public static BigDecimal calculateCompoundInterest(
            String principal, String rate, int years) {
        BigDecimal balance = new BigDecimal(principal);            // String constructor
        BigDecimal annualRate = BigDecimal.ONE.add(new BigDecimal(rate)); // String constructor

        for (int i = 0; i < years; i++) {
            balance = balance.multiply(annualRate, MC); // bounded precision
        }
        return balance.setScale(2, RoundingMode.HALF_UP);
    }

    public static void main(String[] args) {
        BigDecimal result = calculateCompoundInterest("1000.00", "0.05", 100);
        System.out.println("Final balance: $" + result);
    }
}
```

**What changed:**
- String constructors instead of double (exact initial values)
- `MathContext(10)` limits precision per operation — prevents exponential growth
- Fixed precision means constant-time multiplications

**Optimized benchmark:**
```
Benchmark                       Mode  Cnt    Score    Error  Units
FastInterest.calculate          avgt   10   45.6  ±  2.3    us/op
```

**Improvement:** ~100x faster due to bounded precision

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Without `MathContext`, `BigDecimal.multiply()` produces a result with `scale = a.scale() + b.scale()`. After 100 multiplications, the scale is ~200 digits. Arithmetic on 200-digit numbers is much slower than on 10-digit numbers. Bounding precision with `MathContext` keeps computation fast.

**When to apply:** Any iterative BigDecimal computation (interest, amortization, compound calculations).
**When NOT to apply:** When maximum precision is required (cryptography, arbitrary-precision math).

</details>

---

## Exercise 6: The Stream Boxing Pipeline (Medium, mem)

**What the code does:** Filters and transforms a large list of integers.

**The problem:** `Stream<Integer>` boxes/unboxes at every step.

```java
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

public class SlowPipeline {
    public static long processData(List<Integer> data) {
        return data.stream()
            .filter(n -> n % 2 == 0)           // unboxing for %
            .map(n -> n * n)                    // unboxing, multiply, rebox
            .filter(n -> n > 100)               // unboxing for >
            .mapToLong(n -> (long) n)           // unboxing, widen
            .sum();
    }

    public static void main(String[] args) {
        List<Integer> data = new ArrayList<>(10_000_000);
        for (int i = 0; i < 10_000_000; i++) data.add(i);
        System.out.println("Result: " + processData(data));
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt     Score     Error  Units
SlowPipeline.process         avgt   10   234.5  ±  12.3    ms/op
SlowPipeline.gc.alloc.norm   avgt   10   120 MB           B/op
```

<details>
<summary>Hint</summary>

Use `IntStream` to avoid boxing in the entire pipeline.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.stream.IntStream;

public class FastPipeline {
    public static long processData(int size) {
        return IntStream.range(0, size)
            .filter(n -> n % 2 == 0)        // no boxing — int throughout
            .mapToLong(n -> (long) n * n)    // int to long, no boxing
            .filter(n -> n > 100)            // long comparison, no boxing
            .sum();
    }

    public static void main(String[] args) {
        System.out.println("Result: " + processData(10_000_000));
    }
}
```

**What changed:**
- `List<Integer>` → `IntStream.range()` — eliminates initial boxing
- Entire pipeline stays in primitive types
- No intermediate `List` allocation

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt    Score    Error  Units
FastPipeline.process         avgt   10   34.5  ±  1.2    ms/op
FastPipeline.gc.alloc.norm   avgt   10    0 B            B/op
```

**Improvement:** ~7x faster, zero allocations

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `IntStream` keeps all values as `int` primitives throughout the pipeline. `Stream<Integer>` must unbox for every `filter`/`map` predicate and rebox for every intermediate result. With 10M elements and 4 stream operations, that's ~40M unnecessary boxing/unboxing operations.

**When to apply:** Any numeric stream pipeline with multiple transformations.
**When NOT to apply:** When you need to collect into `List<Integer>` or `Map<Integer, X>` — the final collection requires boxing anyway.

</details>

---

## Exercise 7: The Constant Recalculation (Medium, cpu)

**What the code does:** Checks if numbers fall within configurable ranges.

**The problem:** Parses range strings on every method call.

```java
public class SlowRangeChecker {
    private final String minValue;
    private final String maxValue;

    public SlowRangeChecker(String min, String max) {
        this.minValue = min;
        this.maxValue = max;
    }

    public boolean isInRange(int value) {
        int min = Integer.parseInt(minValue);  // parsing on every call!
        int max = Integer.parseInt(maxValue);  // parsing on every call!
        return value >= min && value <= max;
    }

    public static void main(String[] args) {
        SlowRangeChecker checker = new SlowRangeChecker("0", "1000");
        int count = 0;
        for (int i = 0; i < 10_000_000; i++) {
            if (checker.isInRange(i % 2000)) count++;
        }
        System.out.println("In range: " + count);
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt    Score    Error  Units
SlowRangeChecker.check       avgt   10   89.3  ±  3.4    ms/op
```

<details>
<summary>Hint</summary>

Parse once in the constructor, not on every call.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class FastRangeChecker {
    private final int min;
    private final int max;

    public FastRangeChecker(String minStr, String maxStr) {
        this.min = Integer.parseInt(minStr);  // parse once
        this.max = Integer.parseInt(maxStr);  // parse once
    }

    public boolean isInRange(int value) {
        return value >= min && value <= max;  // pure primitive comparison
    }

    public static void main(String[] args) {
        FastRangeChecker checker = new FastRangeChecker("0", "1000");
        int count = 0;
        for (int i = 0; i < 10_000_000; i++) {
            if (checker.isInRange(i % 2000)) count++;
        }
        System.out.println("In range: " + count);
    }
}
```

**What changed:**
- Parse strings to `int` once in constructor
- Store as primitive `int` fields
- `isInRange` is now two primitive comparisons (nanoseconds)

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt    Score   Error  Units
FastRangeChecker.check       avgt   10   12.3 ±  0.5    ms/op
```

**Improvement:** ~7x faster — eliminated 20M `parseInt` calls

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `Integer.parseInt()` allocates char arrays, validates characters, and performs digit-by-digit conversion. This is ~100ns per call. With 10M iterations and 2 calls each, that's ~20M unnecessary parse operations. Storing as `int` fields makes the hot path a simple register comparison.

**When to apply:** Any configuration value that's read frequently but changes rarely.
**When NOT to apply:** When values change dynamically (e.g., live-reloading config).

</details>

---

## Exercise 8: The Overflow-Unsafe Buffer (Hard, cpu)

**What the code does:** Allocates a buffer for image processing.

**The problem:** No overflow check — can cause under-allocation or crash.

```java
public class SlowBuffer {
    public static byte[] allocateImageBuffer(int width, int height, int channels) {
        int size = width * height * channels; // potential overflow!
        return new byte[size];
    }

    public static void main(String[] args) {
        // Works for small images
        byte[] small = allocateImageBuffer(1920, 1080, 4);
        System.out.println("Small buffer: " + small.length + " bytes");

        // Overflows for large images!
        byte[] large = allocateImageBuffer(50000, 50000, 4);
        System.out.println("Large buffer: " + large.length + " bytes");
    }
}
```

<details>
<summary>Hint</summary>

50000 * 50000 * 4 = 10,000,000,000 which overflows `int`. Use `long` and `Math.multiplyExact`.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class FastBuffer {
    public static byte[] allocateImageBuffer(int width, int height, int channels) {
        // Validate inputs
        if (width <= 0 || height <= 0 || channels <= 0) {
            throw new IllegalArgumentException("Dimensions must be positive");
        }

        // Overflow-safe calculation using long
        long size;
        try {
            size = Math.multiplyExact((long) width, height);
            size = Math.multiplyExact(size, channels);
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException(
                String.format("Image too large: %dx%dx%d", width, height, channels), e);
        }

        // Check array size limit
        if (size > Integer.MAX_VALUE) {
            throw new IllegalArgumentException(
                "Buffer size exceeds max array size: " + size + " bytes");
        }

        return new byte[(int) size];
    }

    public static void main(String[] args) {
        byte[] small = allocateImageBuffer(1920, 1080, 4);
        System.out.println("Small buffer: " + small.length + " bytes");

        try {
            byte[] large = allocateImageBuffer(50000, 50000, 4);
        } catch (IllegalArgumentException e) {
            System.out.println("Caught: " + e.getMessage());
        }
    }
}
```

**What changed:**
- Cast first operand to `long` before multiplication
- `Math.multiplyExact` for overflow detection
- Input validation
- Array size limit check

**Improvement:** Correctness fix — prevents silent data corruption from integer overflow

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `Math.multiplyExact` throws `ArithmeticException` on overflow instead of wrapping silently. Promoting to `long` first ensures the intermediate result doesn't overflow. This is a security fix as much as a performance fix — integer overflow in buffer allocation is a common attack vector (CWE-190).

**When to apply:** Any buffer/array allocation where dimensions come from user input.
**When NOT to apply:** When dimensions are compile-time constants or already validated.

</details>

---

## Exercise 9: The Collection Pre-sizing (Hard, mem)

**What the code does:** Reads IDs from a data source and collects unique ones.

**The problem:** Default-sized collections cause many resizing operations.

```java
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class SlowCollect {
    public static Set<Integer> collectUniqueIds(int totalRecords) {
        List<Integer> allIds = new ArrayList<>(); // default capacity 10
        Set<Integer> uniqueIds = new HashSet<>();  // default capacity 16

        for (int i = 0; i < totalRecords; i++) {
            int id = i % (totalRecords / 2); // ~50% unique
            allIds.add(id);       // grows: 10 → 15 → 22 → 33 → ... many resizes
            uniqueIds.add(id);    // rehashes multiple times
        }

        return uniqueIds;
    }

    public static void main(String[] args) {
        Set<Integer> result = collectUniqueIds(2_000_000);
        System.out.println("Unique: " + result.size());
    }
}
```

**Current benchmark:**
```
Benchmark                   Mode  Cnt     Score     Error  Units
SlowCollect.collect         avgt   10   456.7  ±  23.4    ms/op
SlowCollect.gc.alloc.norm   avgt   10   180 MB           B/op
```

<details>
<summary>Hint</summary>

Pre-size collections when you know the approximate size. For `HashSet`, account for load factor (0.75 default).

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.HashSet;
import java.util.Set;

public class FastCollect {
    public static Set<Integer> collectUniqueIds(int totalRecords) {
        int expectedUnique = totalRecords / 2;

        // Pre-size HashSet: capacity = expected / load_factor + 1
        Set<Integer> uniqueIds = new HashSet<>((int)(expectedUnique / 0.75) + 1);

        // Skip the ArrayList entirely — we don't need it
        for (int i = 0; i < totalRecords; i++) {
            int id = i % expectedUnique;
            uniqueIds.add(id);
        }

        return uniqueIds;
    }

    public static void main(String[] args) {
        Set<Integer> result = collectUniqueIds(2_000_000);
        System.out.println("Unique: " + result.size());
    }
}
```

**What changed:**
- Removed unnecessary `ArrayList` (data was never used)
- Pre-sized `HashSet` with capacity accounting for 0.75 load factor
- Zero resizing operations

**Optimized benchmark:**
```
Benchmark                   Mode  Cnt     Score    Error  Units
FastCollect.collect         avgt   10   178.9  ±  8.7    ms/op
FastCollect.gc.alloc.norm   avgt   10    65 MB          B/op
```

**Improvement:** 2.5x faster, 2.8x less memory

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `ArrayList` without initial capacity starts at 10 and grows by 50% each time (10→15→22→33→...). For 2M elements, that's ~30 resize operations, each copying the entire array. `HashSet` has similar rehashing overhead. Pre-sizing eliminates all resize/rehash operations.

Formula for HashSet capacity: `(int)(expectedSize / loadFactor) + 1` where default loadFactor = 0.75.

**When to apply:** Any collection that you can estimate the final size of.
**When NOT to apply:** When size is truly unknown and varies wildly.

</details>

---

## Exercise 10: The Type-Unsafe Comparison (Hard, cpu)

**What the code does:** Sorts a list of numeric IDs and performs binary search.

**The problem:** Uses `Integer` sorting with unnecessary boxing overhead.

```java
import java.util.*;

public class SlowSearch {
    public static int findId(List<Integer> ids, int target) {
        Collections.sort(ids); // sorts Integer objects — comparison involves unboxing
        return Collections.binarySearch(ids, target); // autoboxing target, unboxing comparisons
    }

    public static void main(String[] args) {
        List<Integer> ids = new ArrayList<>(5_000_000);
        Random random = new Random(42);
        for (int i = 0; i < 5_000_000; i++) {
            ids.add(random.nextInt(10_000_000)); // autoboxing
        }

        long start = System.nanoTime();
        int index = findId(ids, 5_000_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Found at index: " + index + " in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt      Score      Error  Units
SlowSearch.findId          avgt   10  1234.5  ±  56.7    ms/op
```

<details>
<summary>Hint</summary>

Use `int[]` with `Arrays.sort()` and `Arrays.binarySearch()` — no boxing anywhere.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.Arrays;
import java.util.Random;

public class FastSearch {
    public static int findId(int[] ids, int target) {
        Arrays.sort(ids);                      // sorts primitives — no boxing
        return Arrays.binarySearch(ids, target); // primitive comparison
    }

    public static void main(String[] args) {
        int[] ids = new int[5_000_000];
        Random random = new Random(42);
        for (int i = 0; i < ids.length; i++) {
            ids[i] = random.nextInt(10_000_000); // no autoboxing
        }

        long start = System.nanoTime();
        int index = findId(ids, 5_000_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Found at index: " + index + " in " + elapsed + " ms");
    }
}
```

**What changed:**
- `List<Integer>` → `int[]` — no boxing
- `Collections.sort()` → `Arrays.sort()` — dual-pivot quicksort on primitives
- `Collections.binarySearch()` → `Arrays.binarySearch()` — primitive comparisons

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastSearch.findId          avgt   10   345.6  ±  12.3    ms/op
```

**Improvement:** ~3.5x faster. `Arrays.sort(int[])` uses dual-pivot quicksort (intrinsic), while `Collections.sort` uses TimSort on objects (comparison involves virtual dispatch + unboxing).

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `Arrays.sort(int[])` is a JVM intrinsic — it uses a highly optimized dual-pivot quicksort that operates directly on contiguous memory. `Collections.sort()` uses TimSort which compares objects via `Comparable.compareTo()` — each comparison involves virtual dispatch, unboxing, and pointer chasing.

Additionally, `int[]` has better cache locality than `Integer[]` — the CPU can prefetch contiguous int values but not scattered Integer heap objects.

**When to apply:** Any sorting/searching on large numeric datasets.
**When NOT to apply:** When you need stable sort (TimSort is stable; quicksort is not) or when data is already in `List<Integer>`.

</details>

---

## Score Card

Track your progress:

| Exercise | Difficulty | Category | Identified bottleneck? | Optimized correctly? | Understood why? |
|:--------:|:---------:|:--------:|:---------------------:|:-------------------:|:---------------:|
| 1 | Easy | mem | ☐ | ☐ | ☐ |
| 2 | Easy | mem | ☐ | ☐ | ☐ |
| 3 | Easy | cpu | ☐ | ☐ | ☐ |
| 4 | Medium | mem | ☐ | ☐ | ☐ |
| 5 | Medium | cpu | ☐ | ☐ | ☐ |
| 6 | Medium | mem | ☐ | ☐ | ☐ |
| 7 | Medium | cpu | ☐ | ☐ | ☐ |
| 8 | Hard | cpu | ☐ | ☐ | ☐ |
| 9 | Hard | mem | ☐ | ☐ | ☐ |
| 10 | Hard | cpu | ☐ | ☐ | ☐ |

### Rating:
- **10/10 optimized** → Senior-level Java performance skills
- **7-9/10** → Solid middle-level understanding
- **4-6/10** → Good foundation, practice more
- **< 4/10** → Review Data Types fundamentals first
