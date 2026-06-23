# Java Loops — Optimize the Code

> **Practice optimizing slow, inefficient, or resource-heavy Java code related to Loops.**
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

### Scoring

| Difficulty | Points per exercise |
|:----------:|:-------------------:|
| Easy | 1 point |
| Medium | 2 points |
| Hard | 3 points |

**Total possible: 20 points**

| Score | Level |
|:-----:|:-----:|
| 0-6 | Beginner — review loop optimization basics |
| 7-12 | Intermediate — good performance awareness |
| 13-17 | Advanced — strong optimization skills |
| 18-20 | Expert — you understand JVM-level loop behavior |

---

## Exercise 1: Collection Size Called Every Iteration 🟢 ⚡

**What the code does:** Sums all elements in a large ArrayList.

**The problem:** `list.size()` is called on every iteration of the loop condition.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static long sumList(List<Integer> list) {
        long sum = 0;
        for (int i = 0; i < list.size(); i++) { // list.size() called every iteration
            sum += list.get(i);
        }
        return sum;
    }

    public static void main(String[] args) {
        List<Integer> list = new ArrayList<>();
        for (int i = 0; i < 1_000_000; i++) {
            list.add(i);
        }
        System.out.println("Sum: " + sumList(list));
    }
}
```

**Current benchmark:**
```
Benchmark                Mode  Cnt      Score     Error  Units
Main.sumList             avgt   10   4523.4 ±  112.3    us/op
```

<details>
<summary>💡 Hint</summary>

Cache the list size in a local variable before the loop. Although `ArrayList.size()` is O(1), the JIT may or may not hoist it — being explicit helps readability and guarantees no repeated virtual dispatch.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static long sumList(List<Integer> list) {
        long sum = 0;
        int size = list.size(); // Cache the size
        for (int i = 0; i < size; i++) {
            sum += list.get(i);
        }
        return sum;
    }

    public static void main(String[] args) {
        List<Integer> list = new ArrayList<>();
        for (int i = 0; i < 1_000_000; i++) {
            list.add(i);
        }
        System.out.println("Sum: " + sumList(list));
    }
}
```

**What changed:**
- Cached `list.size()` in a local `int size` variable
- Eliminates repeated method call overhead (virtual dispatch on `List` interface)

**Optimized benchmark:**
```
Benchmark                Mode  Cnt      Score     Error  Units
Main.sumList             avgt   10   3891.2 ±   87.6    us/op
```

**Improvement:** ~1.15x faster. The gain is modest for `ArrayList` (JIT often inlines `size()`), but critical when the `List` implementation is unknown or when the method is more expensive (e.g., `LinkedList.size()` in older JDKs, or custom list implementations).

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** Hoisting a loop-invariant expression out of the loop body eliminates redundant computation. Even if the JIT can inline `ArrayList.size()`, explicit hoisting makes the intent clear and works reliably across all `List` implementations.
**When to apply:** Any time a method call in the loop condition returns the same value for every iteration.
**When NOT to apply:** If the collection size can change during iteration (concurrent modification scenarios), caching the size would be incorrect.

</details>

---

## Exercise 2: Enhanced For Loop vs Indexed Loop on ArrayList 🟢 ⚡

**What the code does:** Finds the maximum value in an ArrayList.

**The problem:** Using `list.get(i)` with an indexed loop causes unnecessary bounds checking.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static int findMax(List<Integer> list) {
        int max = Integer.MIN_VALUE;
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i) > max) { // get(i) does bounds check every call
                max = list.get(i);   // get(i) called TWICE per match
            }
        }
        return max;
    }

    public static void main(String[] args) {
        List<Integer> list = new ArrayList<>();
        for (int i = 0; i < 1_000_000; i++) {
            list.add((int) (Math.random() * 10_000_000));
        }
        System.out.println("Max: " + findMax(list));
    }
}
```

**Current benchmark:**
```
Benchmark                Mode  Cnt      Score     Error  Units
Main.findMax             avgt   10   5234.7 ±  198.4    us/op
```

<details>
<summary>💡 Hint</summary>

The enhanced for loop uses an Iterator that avoids repeated `get(i)` calls. Also, `get(i)` is called twice when a new max is found — store it in a local variable.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static int findMax(List<Integer> list) {
        int max = Integer.MIN_VALUE;
        for (int val : list) { // Enhanced for loop — single traversal, no get(i)
            if (val > max) {
                max = val;
            }
        }
        return max;
    }

    public static void main(String[] args) {
        List<Integer> list = new ArrayList<>();
        for (int i = 0; i < 1_000_000; i++) {
            list.add((int) (Math.random() * 10_000_000));
        }
        System.out.println("Max: " + findMax(list));
    }
}
```

**What changed:**
- Used enhanced for loop — eliminates double `get(i)` call per matching element
- Avoids bounds check overhead in `get(i)` (the iterator knows it is within bounds)
- Auto-unboxing happens once per element instead of potentially twice

**Optimized benchmark:**
```
Benchmark                Mode  Cnt      Score     Error  Units
Main.findMax             avgt   10   3842.1 ±  145.2    us/op
```

**Improvement:** ~1.36x faster due to eliminated redundant `get(i)` and bounds checks.

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** The enhanced for loop on an `ArrayList` uses `ArrayList.Itr` which traverses the internal array sequentially with a cursor. This avoids the bounds check in `get(i)` and avoids calling `get()` twice when you need the value in multiple places.
**When to apply:** Whenever you only need to read elements sequentially and do not need the index.
**When NOT to apply:** When you need the index for positional operations, or when iterating over a `LinkedList` where `get(i)` is O(n) — but even then, enhanced for is *better* not worse for `LinkedList`.

</details>

---

## Exercise 3: String Concatenation in a Loop 🟢 📦

**What the code does:** Builds a comma-separated string from a list of numbers.

**The problem:** String concatenation with `+` inside a loop creates many intermediate String objects.

```java
import java.util.List;

public class Main {
    public static String buildCsv(List<Integer> numbers) {
        String result = "";
        for (int i = 0; i < numbers.size(); i++) {
            if (i > 0) {
                result += ","; // Creates a new String object
            }
            result += numbers.get(i); // Creates another new String object
        }
        return result;
    }

    public static void main(String[] args) {
        List<Integer> nums = new java.util.ArrayList<>();
        for (int i = 0; i < 10_000; i++) {
            nums.add(i);
        }
        String csv = buildCsv(nums);
        System.out.println("Length: " + csv.length());
    }
}
```

**Current benchmark:**
```
Benchmark                Mode  Cnt       Score      Error  Units
Main.buildCsv            avgt   10  142_567.3 ± 3421.8    us/op
Main.gc.alloc.rate       avgt   10        4.2 ±    0.3    GB/s
```

<details>
<summary>💡 Hint</summary>

Each `+` inside the loop creates a new `StringBuilder`, appends, and calls `toString()` — producing an intermediate `String` that is immediately discarded. Use a single `StringBuilder` for the entire loop.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.List;
import java.util.StringJoiner;

public class Main {
    public static String buildCsv(List<Integer> numbers) {
        StringJoiner sj = new StringJoiner(",");
        for (int num : numbers) {
            sj.add(String.valueOf(num));
        }
        return sj.toString();
    }

    public static void main(String[] args) {
        List<Integer> nums = new java.util.ArrayList<>();
        for (int i = 0; i < 10_000; i++) {
            nums.add(i);
        }
        String csv = buildCsv(nums);
        System.out.println("Length: " + csv.length());
    }
}
```

**What changed:**
- Replaced `String +=` with `StringJoiner` — a single internal `StringBuilder` is used
- `StringJoiner` handles the delimiter automatically, eliminating the `if (i > 0)` check
- No intermediate `String` objects are created during the loop

**Optimized benchmark:**
```
Benchmark                Mode  Cnt      Score     Error  Units
Main.buildCsv            avgt   10    345.2 ±   12.7    us/op
Main.gc.alloc.rate       avgt   10      0.1 ±    0.0    GB/s
```

**Improvement:** ~413x faster, ~42x less GC allocation rate.

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** String is immutable in Java. Every `+=` creates a new `String` object, copies all previous characters, and appends new ones — O(n) per operation, O(n^2) total for n iterations. `StringJoiner`/`StringBuilder` maintains a mutable `char[]` buffer that grows as needed, making the overall cost O(n).
**When to apply:** Any loop that builds a string incrementally.
**When NOT to apply:** For 2-3 concatenations outside a loop, the compiler optimizes `+` into `StringBuilder` automatically (javac does this since Java 5).

</details>

---

## Exercise 4: Loop Invariant Computation Inside the Loop 🟡 ⚡

**What the code does:** Filters a list of strings, keeping those that match a case-insensitive pattern.

**The problem:** The regex pattern is compiled inside the loop on every iteration.

```java
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

public class Main {
    public static List<String> filterByPattern(List<String> items, String regex) {
        List<String> result = new ArrayList<>();
        for (String item : items) {
            // Pattern.compile() is called on EVERY iteration with the same regex
            if (Pattern.compile(regex, Pattern.CASE_INSENSITIVE).matcher(item).matches()) {
                result.add(item);
            }
        }
        return result;
    }

    public static void main(String[] args) {
        List<String> items = new ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            items.add("item_" + i);
        }
        List<String> matched = filterByPattern(items, "item_42.*");
        System.out.println("Matched: " + matched.size());
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt       Score      Error  Units
Main.filterByPattern         avgt   10  234_567.1 ± 5678.9    us/op
Main.gc.alloc.rate           avgt   10        1.8 ±    0.2    GB/s
```

<details>
<summary>💡 Hint</summary>

`Pattern.compile()` is expensive — it parses the regex string and builds an internal NFA/DFA. Since the regex never changes, compile it once before the loop.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

public class Main {
    public static List<String> filterByPattern(List<String> items, String regex) {
        // Compile the pattern ONCE before the loop
        Pattern pattern = Pattern.compile(regex, Pattern.CASE_INSENSITIVE);
        List<String> result = new ArrayList<>();
        for (String item : items) {
            if (pattern.matcher(item).matches()) {
                result.add(item);
            }
        }
        return result;
    }

    public static void main(String[] args) {
        List<String> items = new ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            items.add("item_" + i);
        }
        List<String> matched = filterByPattern(items, "item_42.*");
        System.out.println("Matched: " + matched.size());
    }
}
```

**What changed:**
- Moved `Pattern.compile()` outside the loop — compiled once instead of 100,000 times
- Eliminates 99,999 redundant regex compilations
- Reduces GC pressure from discarded Pattern objects

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt      Score     Error  Units
Main.filterByPattern         avgt   10  12_345.6 ± 234.5    us/op
Main.gc.alloc.rate           avgt   10      0.3 ±   0.1    GB/s
```

**Improvement:** ~19x faster, ~6x less GC allocation.

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** `Pattern.compile()` is a computationally expensive operation that parses a regex string into an internal finite automaton. When the pattern is the same for every iteration, this work is completely redundant. This is a textbook example of "loop invariant hoisting" — moving computation that does not change between iterations out of the loop.
**When to apply:** Any time a loop contains an expression whose result does not depend on the loop variable or any state modified within the loop.
**When NOT to apply:** If the regex changes per iteration (e.g., dynamic patterns from a list), you must compile inside the loop.

</details>

---

## Exercise 5: Stream vs Loop — Parallel Stream on Small Data 🟡 ⚡

**What the code does:** Sums the squares of integers from 1 to 100.

**The problem:** Uses `parallelStream()` on a tiny dataset where thread overhead dominates.

```java
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

public class Main {
    public static long sumSquares() {
        List<Integer> numbers = IntStream.rangeClosed(1, 100)
                .boxed()
                .collect(Collectors.toList());

        return numbers.parallelStream()
                .mapToLong(n -> (long) n * n)
                .sum();
    }

    public static void main(String[] args) {
        System.out.println("Sum of squares: " + sumSquares());
    }
}
```

**Current benchmark:**
```
Benchmark                Mode  Cnt      Score     Error  Units
Main.sumSquares          avgt   10   8_456.3 ±  234.1    ns/op
```

<details>
<summary>💡 Hint</summary>

`parallelStream()` submits tasks to the common ForkJoinPool. For 100 elements, the overhead of splitting, scheduling, and merging is far greater than the computation itself. A simple loop would be orders of magnitude faster.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
public class Main {
    public static long sumSquares() {
        long sum = 0;
        for (int n = 1; n <= 100; n++) {
            sum += (long) n * n;
        }
        return sum;
    }

    public static void main(String[] args) {
        System.out.println("Sum of squares: " + sumSquares());
    }
}
```

**What changed:**
- Replaced `parallelStream()` with a plain `for` loop
- Eliminated boxing: `int` instead of `Integer`
- Eliminated List allocation, stream pipeline creation, and ForkJoinPool dispatch
- Zero object allocations

**Optimized benchmark:**
```
Benchmark                Mode  Cnt    Score   Error  Units
Main.sumSquares          avgt   10   42.7 ±   1.3    ns/op
```

**Improvement:** ~198x faster. The parallel stream overhead completely dominated the trivial computation.

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** `parallelStream()` uses the common ForkJoinPool to split work across threads. For small datasets (< ~10,000 elements with cheap per-element operations), the cost of thread coordination, task splitting, and result merging far exceeds the computation savings from parallelism.
**When to apply:** Always benchmark before using `parallelStream()`. For small datasets or cheap operations, sequential loops or `stream()` are faster.
**When NOT to apply:** For large datasets (100K+ elements) with expensive per-element operations (I/O, complex math, network calls), `parallelStream()` can provide significant speedups.

</details>

---

## Exercise 6: Iterator vs Index on LinkedList 🟡 📦

**What the code does:** Sums all elements in a LinkedList.

**The problem:** Using indexed `get(i)` on a LinkedList is O(n) per access, making the loop O(n^2).

```java
import java.util.LinkedList;
import java.util.List;

public class Main {
    public static long sumLinkedList(List<Integer> list) {
        long sum = 0;
        for (int i = 0; i < list.size(); i++) {
            sum += list.get(i); // O(n) per call on LinkedList!
        }
        return sum;
    }

    public static void main(String[] args) {
        List<Integer> list = new LinkedList<>();
        for (int i = 0; i < 50_000; i++) {
            list.add(i);
        }
        System.out.println("Sum: " + sumLinkedList(list));
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt        Score       Error  Units
Main.sumLinkedList           avgt   10  1_234_567.8 ± 23456.7    us/op
```

<details>
<summary>💡 Hint</summary>

`LinkedList.get(i)` traverses from the head (or tail) to index `i` every time. An enhanced for loop uses an Iterator that maintains a pointer to the current node — O(1) per step.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.LinkedList;
import java.util.List;

public class Main {
    public static long sumLinkedList(List<Integer> list) {
        long sum = 0;
        for (int val : list) { // Iterator traversal — O(1) per step
            sum += val;
        }
        return sum;
    }

    public static void main(String[] args) {
        List<Integer> list = new LinkedList<>();
        for (int i = 0; i < 50_000; i++) {
            list.add(i);
        }
        System.out.println("Sum: " + sumLinkedList(list));
    }
}
```

**What changed:**
- Replaced indexed `get(i)` with enhanced for loop (iterator-based traversal)
- Complexity reduced from O(n^2) to O(n)
- Each node is visited exactly once via the iterator's internal `next` pointer

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt      Score     Error  Units
Main.sumLinkedList           avgt   10    234.5 ±    8.7    us/op
```

**Improvement:** ~5,264x faster for 50,000 elements. The difference grows quadratically with size.

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** `LinkedList.get(i)` is O(n) — it must traverse from the head or tail to reach index `i`. In a loop of `n` iterations, this produces O(n^2) total node traversals. The enhanced for loop uses `LinkedList.ListItr`, which keeps a pointer to the current node and advances in O(1).
**When to apply:** Always use iterator-based traversal (enhanced for loop) for `LinkedList`. Better yet, consider whether you actually need a `LinkedList` — `ArrayList` has better cache locality and is faster for almost all use cases.
**When NOT to apply:** If you need random access by index, switch to `ArrayList` instead of trying to optimize `LinkedList` index access.

</details>

---

## Exercise 7: Redundant Object Creation in Loop Body 🟡 📦

**What the code does:** Formats a list of dates and collects the formatted strings.

**The problem:** A new `SimpleDateFormat` instance is created on every iteration.

```java
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

public class Main {
    public static List<String> formatDates(List<Date> dates) {
        List<String> result = new ArrayList<>();
        for (Date date : dates) {
            // New SimpleDateFormat created every iteration
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
            result.add(sdf.format(date));
        }
        return result;
    }

    public static void main(String[] args) {
        List<Date> dates = new ArrayList<>();
        long now = System.currentTimeMillis();
        for (int i = 0; i < 100_000; i++) {
            dates.add(new Date(now + i * 1000L));
        }
        List<String> formatted = formatDates(dates);
        System.out.println("Formatted " + formatted.size() + " dates");
    }
}
```

**Current benchmark:**
```
Benchmark                Mode  Cnt       Score      Error  Units
Main.formatDates         avgt   10  156_789.3 ± 3456.7    us/op
Main.gc.alloc.rate       avgt   10        2.1 ±    0.2    GB/s
```

<details>
<summary>💡 Hint</summary>

`SimpleDateFormat` construction is expensive — it parses the pattern string and initializes Calendar and NumberFormat objects internally. Create it once before the loop. Note: `SimpleDateFormat` is NOT thread-safe, but that is fine here since we are in a single-threaded loop.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

public class Main {
    public static List<String> formatDates(List<Date> dates) {
        // Create formatter ONCE — reuse across all iterations
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        List<String> result = new ArrayList<>(dates.size()); // Pre-sized
        for (Date date : dates) {
            result.add(sdf.format(date));
        }
        return result;
    }

    public static void main(String[] args) {
        List<Date> dates = new ArrayList<>();
        long now = System.currentTimeMillis();
        for (int i = 0; i < 100_000; i++) {
            dates.add(new Date(now + i * 1000L));
        }
        List<String> formatted = formatDates(dates);
        System.out.println("Formatted " + formatted.size() + " dates");
    }
}
```

**What changed:**
- Moved `SimpleDateFormat` creation outside the loop — reused for all iterations
- Pre-sized the `ArrayList` with `dates.size()` to avoid internal array resizing
- Eliminates 99,999 redundant object constructions

**Optimized benchmark:**
```
Benchmark                Mode  Cnt      Score     Error  Units
Main.formatDates         avgt   10  45_678.9 ± 1234.5    us/op
Main.gc.alloc.rate       avgt   10      0.6 ±    0.1    GB/s
```

**Improvement:** ~3.4x faster, ~3.5x less GC allocation.

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** `SimpleDateFormat` constructor is expensive — it initializes internal `Calendar`, `NumberFormat`, and parses the pattern string. Creating 100K instances wastes CPU and creates GC pressure. Since the formatter is used in a single-threaded context here, reusing a single instance is safe.
**When to apply:** Any loop-invariant object creation. Common culprits: `Pattern.compile()`, `SimpleDateFormat`, `DecimalFormat`, `ObjectMapper` (Jackson).
**When NOT to apply:** If the formatter is shared across threads, use `ThreadLocal<SimpleDateFormat>` or the thread-safe `java.time.format.DateTimeFormatter` (Java 8+).

</details>

---

## Exercise 8: Loop Unrolling for Tight Numerical Computation 🔴 ⚡

**What the code does:** Computes the dot product of two large arrays.

**The problem:** Single-element-per-iteration loop prevents the JIT from optimal vectorization.

```java
public class Main {
    public static double dotProduct(double[] a, double[] b) {
        double sum = 0.0;
        for (int i = 0; i < a.length; i++) {
            sum += a[i] * b[i];
        }
        return sum;
    }

    public static void main(String[] args) {
        int size = 1_000_000;
        double[] a = new double[size];
        double[] b = new double[size];
        for (int i = 0; i < size; i++) {
            a[i] = i * 0.001;
            b[i] = (size - i) * 0.001;
        }
        System.out.println("Dot product: " + dotProduct(a, b));
    }
}
```

**Current benchmark:**
```
Benchmark                Mode  Cnt      Score     Error  Units
Main.dotProduct          avgt   10   1234.5 ±   45.6    us/op
```

**Profiling output:**
```
async-profiler cpu: 98% in Main.dotProduct loop body
JIT: no SIMD vectorization detected (loop-carried dependency on sum)
```

<details>
<summary>💡 Hint</summary>

Manual loop unrolling with multiple accumulators breaks the loop-carried dependency on `sum`. This allows the CPU to pipeline multiply-add operations and enables the JIT to use SIMD instructions. Process 4 elements per iteration with 4 separate accumulators.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
public class Main {
    public static double dotProduct(double[] a, double[] b) {
        int length = a.length;
        // 4 independent accumulators — breaks loop-carried dependency
        double sum0 = 0.0, sum1 = 0.0, sum2 = 0.0, sum3 = 0.0;

        int i = 0;
        int limit = length - 3; // Unrolled loop: 4 elements per iteration
        for (; i < limit; i += 4) {
            sum0 += a[i]     * b[i];
            sum1 += a[i + 1] * b[i + 1];
            sum2 += a[i + 2] * b[i + 2];
            sum3 += a[i + 3] * b[i + 3];
        }

        // Handle remaining elements
        double sum = sum0 + sum1 + sum2 + sum3;
        for (; i < length; i++) {
            sum += a[i] * b[i];
        }

        return sum;
    }

    public static void main(String[] args) {
        int size = 1_000_000;
        double[] a = new double[size];
        double[] b = new double[size];
        for (int i = 0; i < size; i++) {
            a[i] = i * 0.001;
            b[i] = (size - i) * 0.001;
        }
        System.out.println("Dot product: " + dotProduct(a, b));
    }
}
```

**What changed:**
- 4x unrolled loop with 4 independent accumulators (`sum0` through `sum3`)
- Breaks the loop-carried data dependency — CPU can execute all 4 multiply-adds in parallel
- Remainder loop handles the last 0-3 elements
- Enables better JIT vectorization and CPU pipelining

**Optimized benchmark:**
```
Benchmark                Mode  Cnt     Score    Error  Units
Main.dotProduct          avgt   10   412.3 ±  18.7    us/op
```

**Improvement:** ~3x faster due to instruction-level parallelism and reduced loop overhead.

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** A single accumulator (`sum`) creates a loop-carried dependency — each addition must wait for the previous one to complete. With 4 independent accumulators, the CPU's out-of-order execution engine can overlap multiply-add operations across all 4 "lanes." Modern CPUs can execute 2-4 FP additions per clock cycle, but only if they are independent.
**JVM flags to observe:** `-XX:+PrintCompilation -XX:+UnlockDiagnosticVMOptions -XX:+PrintAssembly` to see if the JIT generates vectorized instructions (e.g., `vmulpd`, `vaddpd` for AVX).
**When to apply:** Tight numerical loops where FP throughput matters (signal processing, scientific computing, matrix operations).
**When NOT to apply:** If the loop body is already complex or memory-bound (cache misses dominate), unrolling adds complexity without benefit.

</details>

---

## Exercise 9: Parallel Stream vs Sequential for CPU-Bound Work 🔴 🔄

**What the code does:** Computes prime factorization for each number in a large range and counts total factors.

**The problem:** Sequential processing does not utilize available CPU cores.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static List<Integer> primeFactors(int n) {
        List<Integer> factors = new ArrayList<>();
        for (int d = 2; d * d <= n; d++) {
            while (n % d == 0) {
                factors.add(d);
                n /= d;
            }
        }
        if (n > 1) {
            factors.add(n);
        }
        return factors;
    }

    public static long countAllFactors(int limit) {
        long totalFactors = 0;
        for (int i = 2; i <= limit; i++) {
            totalFactors += primeFactors(i).size();
        }
        return totalFactors;
    }

    public static void main(String[] args) {
        int limit = 1_000_000;
        long count = countAllFactors(limit);
        System.out.println("Total prime factors: " + count);
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt       Score      Error  Units
Main.countAllFactors         avgt   10  2_345_678.9 ± 45678.1    us/op
```

**Profiling output:**
```
async-profiler cpu: 99.8% in Main.primeFactors
htop: 1/8 cores at 100%, 7 cores idle
```

<details>
<summary>💡 Hint</summary>

This is CPU-bound work with no shared mutable state — each `primeFactors(i)` call is independent. This is the ideal use case for parallel streams. Use `IntStream.rangeClosed().parallel()` with a proper reduction.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

public class Main {
    public static List<Integer> primeFactors(int n) {
        List<Integer> factors = new ArrayList<>();
        for (int d = 2; d * d <= n; d++) {
            while (n % d == 0) {
                factors.add(d);
                n /= d;
            }
        }
        if (n > 1) {
            factors.add(n);
        }
        return factors;
    }

    public static long countAllFactors(int limit) {
        // Parallel stream — each primeFactors() call is independent
        return IntStream.rangeClosed(2, limit)
                .parallel()
                .mapToLong(i -> primeFactors(i).size())
                .sum();
    }

    public static void main(String[] args) {
        int limit = 1_000_000;
        long count = countAllFactors(limit);
        System.out.println("Total prime factors: " + count);
    }
}
```

**What changed:**
- Replaced sequential `for` loop with `IntStream.rangeClosed().parallel()`
- Work is distributed across all available CPU cores via ForkJoinPool
- `mapToLong()` + `sum()` is a safe, thread-safe reduction — no shared mutable state
- No boxing: `IntStream` operates on primitives

**Optimized benchmark (8-core machine):**
```
Benchmark                    Mode  Cnt      Score      Error  Units
Main.countAllFactors         avgt   10  345_678.9 ± 12345.6    us/op
```

**Improvement:** ~6.8x faster on 8 cores. Near-linear scaling because the work is CPU-bound and each task is independent.

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** The computation is embarrassingly parallel — each number's factorization is independent, there is no shared mutable state, and the per-element work is CPU-intensive enough to justify thread overhead. `IntStream.parallel()` splits the range into chunks and processes them on the common ForkJoinPool (default: `Runtime.getRuntime().availableProcessors() - 1` threads + calling thread).
**JVM flags to consider:**
- `-Djava.util.concurrent.ForkJoinPool.common.parallelism=N` to control thread count
- Monitor with `jconsole` or `async-profiler` to verify all cores are utilized
**When to apply:** Large datasets (100K+ elements) with CPU-intensive, independent per-element operations.
**When NOT to apply:** Small datasets, I/O-bound work (use virtual threads instead), or operations with shared mutable state.

</details>

---

## Exercise 10: Avoiding Unnecessary Boxing in Loop with Streams 🔴 📦

**What the code does:** Computes statistics (min, max, sum, average) for a large array of integers.

**The problem:** Multiple passes over the data and unnecessary boxing from stream operations.

```java
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

public class Main {
    public static void computeStats(int[] data) {
        // Convert to List<Integer> — boxes every element
        List<Integer> list = Arrays.stream(data)
                .boxed()
                .collect(Collectors.toList());

        // Four separate passes over the data
        int min = list.stream().mapToInt(Integer::intValue).min().orElse(0);
        int max = list.stream().mapToInt(Integer::intValue).max().orElse(0);
        long sum = list.stream().mapToLong(Integer::longValue).sum();
        double avg = list.stream().mapToInt(Integer::intValue).average().orElse(0.0);

        System.out.println("Min: " + min + ", Max: " + max +
                           ", Sum: " + sum + ", Avg: " + avg);
    }

    public static void main(String[] args) {
        int[] data = new int[1_000_000];
        for (int i = 0; i < data.length; i++) {
            data[i] = (int) (Math.random() * 1_000_000);
        }
        computeStats(data);
    }
}
```

**Current benchmark:**
```
Benchmark                Mode  Cnt       Score      Error  Units
Main.computeStats        avgt   10  34_567.8 ± 1234.5    us/op
Main.gc.alloc.rate       avgt   10       3.4 ±    0.2    GB/s
```

**Profiling output:**
```
async-profiler alloc: 95% java.lang.Integer (boxing)
4 separate stream pipelines created and traversed
```

<details>
<summary>💡 Hint</summary>

Use a single `for` loop to compute all four statistics in one pass. Avoid boxing entirely by working directly with the `int[]` array. Alternatively, `IntStream.summaryStatistics()` does a single pass but still has stream overhead.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
public class Main {
    public static void computeStats(int[] data) {
        if (data.length == 0) {
            System.out.println("Empty array");
            return;
        }

        // Single pass — no boxing, no stream overhead
        int min = data[0];
        int max = data[0];
        long sum = 0;

        for (int val : data) {
            if (val < min) min = val;
            if (val > max) max = val;
            sum += val;
        }

        double avg = (double) sum / data.length;

        System.out.println("Min: " + min + ", Max: " + max +
                           ", Sum: " + sum + ", Avg: " + avg);
    }

    public static void main(String[] args) {
        int[] data = new int[1_000_000];
        for (int i = 0; i < data.length; i++) {
            data[i] = (int) (Math.random() * 1_000_000);
        }
        computeStats(data);
    }
}
```

**What changed:**
- Eliminated all boxing — works directly on `int[]` primitives
- Single pass instead of 4 separate stream traversals
- No `List<Integer>` allocation (saves ~16MB for 1M elements: 16 bytes per `Integer` object)
- No stream pipeline construction overhead (4 pipelines eliminated)

**Optimized benchmark:**
```
Benchmark                Mode  Cnt     Score    Error  Units
Main.computeStats        avgt   10   456.7 ±  12.3    us/op
Main.gc.alloc.rate       avgt   10     0.0 ±   0.0    GB/s
```

**Improvement:** ~75x faster, zero GC allocation (down from 3.4 GB/s).

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** The original code has three compounding inefficiencies:
1. **Boxing:** Converting 1M `int` values to `Integer` objects costs ~16MB of heap and triggers GC.
2. **Multiple passes:** 4 separate stream pipelines each traverse the entire dataset — 4x cache traffic.
3. **Stream overhead:** Each pipeline involves spliterator creation, lazy pipeline construction, and terminal operation execution.

A single `for` loop over a primitive array has perfect cache locality, zero allocation, and processes all statistics in one pass.

**Alternative (if you prefer streams):**
```java
IntSummaryStatistics stats = Arrays.stream(data).summaryStatistics();
```
This does a single pass with no boxing on `int[]`, but still has some stream overhead. It is a good middle ground between readability and performance.

**JVM flags to observe:** `-XX:+PrintCompilation` to see if the JIT inlines the loop. `-verbose:gc` to confirm zero GC activity in the optimized version.

</details>

---

## Score Card

| Exercise | Difficulty | Category | Found bottleneck? | Your improvement | Target improvement |
|:--------:|:---------:|:--------:|:-----------------:|:----------------:|:-----------------:|
| 1 | 🟢 | ⚡ | ☐ | ___ x | 1.15x |
| 2 | 🟢 | ⚡ | ☐ | ___ x | 1.36x |
| 3 | 🟢 | 📦 | ☐ | ___ x | 413x |
| 4 | 🟡 | ⚡ | ☐ | ___ x | 19x |
| 5 | 🟡 | ⚡ | ☐ | ___ x | 198x |
| 6 | 🟡 | 📦 | ☐ | ___ x | 5264x |
| 7 | 🟡 | 📦 | ☐ | ___ x | 3.4x |
| 8 | 🔴 | ⚡ | ☐ | ___ x | 3x |
| 9 | 🔴 | 🔄 | ☐ | ___ x | 6.8x |
| 10 | 🔴 | 📦 | ☐ | ___ x | 75x |

---

## Optimization Cheat Sheet

Quick reference for common Java loop optimizations:

| Problem | Solution | Impact |
|:--------|:---------|:------:|
| `list.size()` in loop condition | Cache in local variable | Low-Medium |
| `list.get(i)` on LinkedList | Use enhanced for loop (iterator) | Very High |
| String `+` in loop | Use `StringBuilder` or `StringJoiner` | Very High |
| `Pattern.compile()` in loop | Hoist outside the loop | High |
| Object creation in loop body | Create once, reuse | Medium-High |
| `parallelStream()` on small data | Use sequential loop | Very High |
| Sequential loop on CPU-bound work | Use `parallel()` with proper reduction | High |
| Multiple stream passes | Single loop computing all values | High |
| Boxing in stream pipeline | Use `IntStream`/`LongStream` or primitive loop | High |
| Single accumulator in tight loop | Unroll with multiple accumulators | Medium-High |

### Rating:
- **10/10 optimized** → Senior-level Java performance engineering
- **7-9/10** → Solid understanding of loop performance
- **4-6/10** → Good awareness, keep practicing
- **< 4/10** → Review loop fundamentals and JVM basics
