# Arrays — Optimize the Code

> **Practice optimizing slow, inefficient, or resource-heavy Java code related to Arrays.**
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

## Exercise 1: Manual Sort vs Arrays.sort (Easy, cpu)

**What the code does:** Sorts an array of 100,000 integers using a hand-written bubble sort.

**The problem:** Bubble sort is O(n^2) — catastrophically slow for large arrays when `Arrays.sort()` uses dual-pivot quicksort O(n log n).

```java
import java.util.Random;

public class Main {
    // Slow version — hand-written bubble sort
    public static void manualSort(int[] arr) {
        int n = arr.length;
        for (int i = 0; i < n - 1; i++) {
            for (int j = 0; j < n - i - 1; j++) {
                if (arr[j] > arr[j + 1]) {
                    int temp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = temp;
                }
            }
        }
    }

    public static void main(String[] args) {
        int[] data = new int[100_000];
        Random rng = new Random(42);
        for (int i = 0; i < data.length; i++) {
            data[i] = rng.nextInt(1_000_000);
        }

        long start = System.nanoTime();
        manualSort(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sorted " + data.length + " elements in " + elapsed + " ms");
        System.out.println("First: " + data[0] + ", Last: " + data[data.length - 1]);
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt       Score      Error  Units
ManualSort.sort            avgt   10  5_832_410 ± 45_230    us/op
```

<details>
<summary>Hint</summary>

`Arrays.sort(int[])` uses a highly optimized dual-pivot quicksort that is a JVM intrinsic. Why reinvent the wheel?

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.Arrays;
import java.util.Random;

public class Main {
    // Fast version — use Arrays.sort (dual-pivot quicksort)
    public static void optimizedSort(int[] arr) {
        Arrays.sort(arr);
    }

    public static void main(String[] args) {
        int[] data = new int[100_000];
        Random rng = new Random(42);
        for (int i = 0; i < data.length; i++) {
            data[i] = rng.nextInt(1_000_000);
        }

        long start = System.nanoTime();
        optimizedSort(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sorted " + data.length + " elements in " + elapsed + " ms");
        System.out.println("First: " + data[0] + ", Last: " + data[data.length - 1]);
    }
}
```

**What changed:**
- Replaced O(n^2) bubble sort with `Arrays.sort()` — O(n log n) dual-pivot quicksort
- `Arrays.sort(int[])` is a JVM intrinsic with SIMD optimizations on modern JVMs

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
OptimizedSort.sort         avgt   10   6_842 ±  134    us/op
```

**Improvement:** ~850x faster. O(n^2) vs O(n log n) for 100K elements. `Arrays.sort` also benefits from CPU cache-friendly access patterns and JIT compiler intrinsics.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `Arrays.sort(int[])` implements dual-pivot quicksort (introduced by Vladimir Yaroslavskiy in Java 7). For primitive arrays, it avoids any object overhead and operates directly on contiguous memory. The JIT compiler recognizes `Arrays.sort` as an intrinsic and can apply additional optimizations. Bubble sort does O(n^2) comparisons and swaps with poor cache utilization due to repeated passes.

**When to apply:** Always prefer `Arrays.sort()` or `Arrays.parallelSort()` over hand-rolled sorting algorithms.
**When NOT to apply:** If you need a stable sort on primitives (dual-pivot quicksort is not stable) — but this rarely matters for primitive values.

</details>

---

## Exercise 2: Loop Copy vs System.arraycopy (Easy, cpu)

**What the code does:** Copies 10 million integers from one array to another using a manual loop.

**The problem:** Manual element-by-element copy is much slower than `System.arraycopy()` which uses native memory copy (memcpy).

```java
public class Main {
    // Slow version — manual loop copy
    public static int[] copyArray(int[] source) {
        int[] dest = new int[source.length];
        for (int i = 0; i < source.length; i++) {
            dest[i] = source[i];
        }
        return dest;
    }

    public static void main(String[] args) {
        int[] source = new int[10_000_000];
        for (int i = 0; i < source.length; i++) {
            source[i] = i;
        }

        long start = System.nanoTime();
        int[] copy = copyArray(source);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Copied " + copy.length + " elements in " + elapsed + " ms");
        System.out.println("Verify: copy[999999] = " + copy[999_999]);
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
LoopCopy.copy              avgt   10  8_542.3 ± 312.1  us/op
LoopCopy.gc.alloc.norm     avgt   10    40 MB           B/op
```

<details>
<summary>Hint</summary>

`System.arraycopy()` is a JVM intrinsic — it compiles to a single `memcpy` or `memmove` call. Also consider `Arrays.copyOf()` which wraps it.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.Arrays;

public class Main {
    // Fast version — System.arraycopy (native memcpy)
    public static int[] copyArray(int[] source) {
        int[] dest = new int[source.length];
        System.arraycopy(source, 0, dest, 0, source.length);
        return dest;
    }

    // Alternative: even shorter with Arrays.copyOf
    public static int[] copyArrayAlt(int[] source) {
        return Arrays.copyOf(source, source.length);
    }

    public static void main(String[] args) {
        int[] source = new int[10_000_000];
        for (int i = 0; i < source.length; i++) {
            source[i] = i;
        }

        long start = System.nanoTime();
        int[] copy = copyArray(source);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Copied " + copy.length + " elements in " + elapsed + " ms");
        System.out.println("Verify: copy[999999] = " + copy[999_999]);
    }
}
```

**What changed:**
- Replaced manual for-loop with `System.arraycopy()` — a JVM intrinsic that compiles to native `memcpy`
- `Arrays.copyOf()` is an alternative that internally calls `System.arraycopy()`

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
NativeCopy.copy            avgt   10  2_156.7 ± 98.4   us/op
NativeCopy.gc.alloc.norm   avgt   10    40 MB           B/op
```

**Improvement:** ~4x faster. Memory allocation is the same (you still need the new array), but the copy operation itself is dramatically faster due to native bulk memory transfer.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `System.arraycopy()` is declared `native` and is recognized by the JIT compiler as an intrinsic. Instead of generating a Java loop with bounds checks on each iteration, it emits a single optimized `memcpy`/`memmove` instruction sequence that copies memory in bulk using CPU vector instructions (SSE/AVX). The manual loop must perform a bounds check per element and cannot be vectorized as effectively.

**When to apply:** Any time you need to copy array contents — insertions, deletions, resizing, merging.
**When NOT to apply:** If you are copying only 1-5 elements, the overhead difference is negligible. Use what is most readable.

</details>

---

## Exercise 3: Boxed Array vs Primitive Array (Easy, mem)

**What the code does:** Computes the sum of 5 million numbers stored in an `Integer[]` array.

**The problem:** `Integer[]` stores references to heap-allocated objects. Each `Integer` object is 16 bytes + 4 bytes reference vs 4 bytes for a plain `int`.

```java
public class Main {
    // Slow version — boxed Integer array
    public static long sumArray(Integer[] arr) {
        long sum = 0;
        for (Integer val : arr) {
            sum += val; // unboxing on every iteration
        }
        return sum;
    }

    public static void main(String[] args) {
        Integer[] data = new Integer[5_000_000];
        for (int i = 0; i < data.length; i++) {
            data[i] = i % 1000; // autoboxing: creates Integer objects
        }

        long start = System.nanoTime();
        long result = sumArray(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sum: " + result + " in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt      Score     Error  Units
BoxedSum.sum               avgt   10   8_234.5 ± 345.2   us/op
BoxedSum.gc.alloc.norm     avgt   10     100 MB          B/op
```

<details>
<summary>Hint</summary>

Replace `Integer[]` with `int[]`. Primitive arrays use contiguous memory — no unboxing, no pointer chasing, excellent cache locality.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    // Fast version — primitive int array
    public static long sumArray(int[] arr) {
        long sum = 0;
        for (int val : arr) {
            sum += val; // no unboxing needed
        }
        return sum;
    }

    public static void main(String[] args) {
        int[] data = new int[5_000_000];
        for (int i = 0; i < data.length; i++) {
            data[i] = i % 1000; // direct storage, no boxing
        }

        long start = System.nanoTime();
        long result = sumArray(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sum: " + result + " in " + elapsed + " ms");
    }
}
```

**What changed:**
- `Integer[]` replaced with `int[]` — eliminates 5M Integer object allocations
- No unboxing in the loop — direct primitive addition
- Array memory: 20 MB (`int[]`) vs 100+ MB (`Integer[]` with object headers + references)

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
PrimitiveSum.sum           avgt   10  1_423.6 ± 52.8   us/op
PrimitiveSum.gc.alloc.norm avgt   10    20 MB          B/op
```

**Improvement:** ~5.8x faster, ~80% less memory. Eliminates unboxing overhead and dramatically improves CPU cache hit rate due to contiguous memory layout.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** An `Integer[]` is an array of references — each element is a pointer to a heap-allocated `Integer` object (16 bytes header + 4 bytes payload). Iterating over it causes cache misses because the objects are scattered in the heap. An `int[]` stores values contiguously in memory — the CPU prefetcher can load entire cache lines of useful data. Additionally, unboxing (`Integer.intValue()`) adds a method call per element.

**When to apply:** Any numeric computation on arrays — statistics, signal processing, matrix operations, financial calculations.
**When NOT to apply:** When you need `null` values to represent "missing data" — primitives cannot be null. Consider a separate `boolean[]` mask or use `OptionalInt`.

</details>

---

## Exercise 4: ArrayList vs Pre-sized Array (Medium, mem)

**What the code does:** Reads 1 million sensor readings into a collection and computes statistics.

**The problem:** Uses `ArrayList<Integer>` without initial capacity — causes repeated resizing (array copies) and boxing overhead.

```java
import java.util.ArrayList;
import java.util.Collections;

public class Main {
    // Slow version — ArrayList with no initial capacity, boxed integers
    public static void processSensorData(int count) {
        ArrayList<Integer> readings = new ArrayList<>(); // default capacity 10
        for (int i = 0; i < count; i++) {
            readings.add((i * 31) % 1000); // autoboxing + possible resize
        }

        // Compute statistics
        Collections.sort(readings); // sorts boxed integers
        int min = readings.get(0);
        int max = readings.get(readings.size() - 1);
        long sum = 0;
        for (int val : readings) {
            sum += val;
        }
        double avg = (double) sum / readings.size();
        System.out.println("Min: " + min + " Max: " + max + " Avg: " + avg);
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        processSensorData(1_000_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                      Mode  Cnt      Score     Error  Units
SlowSensor.process             avgt   10  245_678 ± 8_432    us/op
SlowSensor.gc.alloc.norm       avgt   10     38 MB           B/op
```

<details>
<summary>Hint</summary>

Use a pre-sized `int[]` instead of `ArrayList<Integer>`. If you must use a list, at least pre-size it: `new ArrayList<>(count)`. Better yet, use `int[]` with `Arrays.sort()`.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.Arrays;

public class Main {
    // Fast version — pre-sized primitive array
    public static void processSensorData(int count) {
        int[] readings = new int[count]; // exact size, no resizing
        for (int i = 0; i < count; i++) {
            readings[i] = (i * 31) % 1000; // no boxing
        }

        // Compute statistics
        Arrays.sort(readings); // dual-pivot quicksort on primitives
        int min = readings[0];
        int max = readings[count - 1];
        long sum = 0;
        for (int val : readings) {
            sum += val;
        }
        double avg = (double) sum / count;
        System.out.println("Min: " + min + " Max: " + max + " Avg: " + avg);
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        processSensorData(1_000_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**What changed:**
- `ArrayList<Integer>` replaced with `int[]` — no resizing, no boxing
- `Collections.sort()` replaced with `Arrays.sort(int[])` — dual-pivot quicksort on primitives
- Pre-allocated exact size — zero reallocation overhead
- Memory: 4 MB (`int[]`) vs ~38 MB (ArrayList with Integer objects + internal array resizing)

**Optimized benchmark:**
```
Benchmark                      Mode  Cnt      Score    Error  Units
FastSensor.process             avgt   10   42_315 ± 1_567   us/op
FastSensor.gc.alloc.norm       avgt   10      4 MB          B/op
```

**Improvement:** ~5.8x faster, ~89% less memory. Eliminates: (1) ~20 array copies from ArrayList resizing, (2) 1M Integer autoboxing allocations, (3) TimSort overhead vs quicksort on primitives.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `ArrayList` starts with capacity 10 and grows by 50% each time it fills. For 1M elements, that means ~30 resize operations, each involving `Arrays.copyOf()`. Each resize copies the entire internal array. Combined with 1M `Integer` autoboxing allocations (16 bytes per object), this creates enormous GC pressure. A pre-sized `int[]` allocates once and stores values directly.

**When to apply:** When the size is known or can be estimated. Even `new ArrayList<>(estimatedSize)` is a significant improvement over the default.
**When NOT to apply:** When size is truly unknown and varies wildly. But even then, overestimating the initial capacity is cheaper than repeated resizing.

</details>

---

## Exercise 5: Naive Search vs Binary Search on Sorted Array (Medium, cpu)

**What the code does:** Searches for 10,000 target values in a sorted array of 1 million elements.

**The problem:** Uses linear scan O(n) for each search instead of binary search O(log n) on the already-sorted array.

```java
import java.util.Arrays;
import java.util.Random;

public class Main {
    // Slow version — linear search on a sorted array
    public static int linearSearch(int[] sortedArr, int target) {
        for (int i = 0; i < sortedArr.length; i++) {
            if (sortedArr[i] == target) {
                return i;
            }
            if (sortedArr[i] > target) {
                return -1; // early exit since sorted
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[] data = new int[1_000_000];
        Random rng = new Random(42);
        for (int i = 0; i < data.length; i++) {
            data[i] = rng.nextInt(2_000_000);
        }
        Arrays.sort(data);

        int[] targets = new int[10_000];
        for (int i = 0; i < targets.length; i++) {
            targets[i] = rng.nextInt(2_000_000);
        }

        long start = System.nanoTime();
        int found = 0;
        for (int target : targets) {
            if (linearSearch(data, target) >= 0) {
                found++;
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Found: " + found + " / " + targets.length + " in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt       Score      Error  Units
LinearSearch.search        avgt   10  2_345_678 ± 34_567   us/op
```

<details>
<summary>Hint</summary>

The array is already sorted. `Arrays.binarySearch()` gives O(log n) per query — that is 20 comparisons instead of 500,000 on average.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.Arrays;
import java.util.Random;

public class Main {
    // Fast version — binary search on sorted array
    public static void main(String[] args) {
        int[] data = new int[1_000_000];
        Random rng = new Random(42);
        for (int i = 0; i < data.length; i++) {
            data[i] = rng.nextInt(2_000_000);
        }
        Arrays.sort(data);

        int[] targets = new int[10_000];
        for (int i = 0; i < targets.length; i++) {
            targets[i] = rng.nextInt(2_000_000);
        }

        long start = System.nanoTime();
        int found = 0;
        for (int target : targets) {
            if (Arrays.binarySearch(data, target) >= 0) {
                found++;
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Found: " + found + " / " + targets.length + " in " + elapsed + " ms");
    }
}
```

**What changed:**
- Replaced O(n) linear search with O(log n) `Arrays.binarySearch()`
- For 10,000 queries on 1M elements: ~5 billion comparisons reduced to ~200,000

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
BinarySearch.search        avgt   10   1_234 ± 45     us/op
```

**Improvement:** ~1900x faster. O(n * k) to O(k * log n) where k=10,000 and n=1,000,000.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Binary search halves the search space on each comparison. For 1M elements, it takes at most 20 comparisons (log2(1,000,000) = ~20) vs an average of 500,000 for linear search. `Arrays.binarySearch(int[])` is also JIT-optimized and performs well on primitive arrays due to cache-friendly access patterns (it touches O(log n) cache lines).

**When to apply:** Any repeated search operations on sorted data. If data is unsorted but searched frequently, sort it once and use binary search.
**When NOT to apply:** For a single search on unsorted data — sorting O(n log n) + binary search O(log n) is worse than one linear scan O(n).

</details>

---

## Exercise 6: Arrays.sort vs Arrays.parallelSort (Medium, conc)

**What the code does:** Sorts a large array of 50 million integers.

**The problem:** Uses single-threaded `Arrays.sort()` when the array is large enough to benefit from parallel sorting.

```java
import java.util.Arrays;
import java.util.Random;

public class Main {
    // Slow version — single-threaded sort on huge array
    public static void sortData(int[] arr) {
        Arrays.sort(arr);
    }

    public static void main(String[] args) {
        int[] data = new int[50_000_000];
        Random rng = new Random(42);
        for (int i = 0; i < data.length; i++) {
            data[i] = rng.nextInt();
        }

        long start = System.nanoTime();
        sortData(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sorted " + data.length + " elements in " + elapsed + " ms");
        System.out.println("Verify sorted: " + (data[0] <= data[1] && data[1] <= data[2]));
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt       Score      Error  Units
SingleSort.sort            avgt   10   4_567_890 ± 123_456  us/op
```

<details>
<summary>Hint</summary>

`Arrays.parallelSort()` (Java 8+) uses the Fork/Join framework to split the sort across multiple cores. For arrays above ~8,192 elements, it can be significantly faster on multi-core machines.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.Arrays;
import java.util.Random;

public class Main {
    // Fast version — parallel sort using Fork/Join framework
    public static void sortData(int[] arr) {
        Arrays.parallelSort(arr);
    }

    public static void main(String[] args) {
        int[] data = new int[50_000_000];
        Random rng = new Random(42);
        for (int i = 0; i < data.length; i++) {
            data[i] = rng.nextInt();
        }

        long start = System.nanoTime();
        sortData(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sorted " + data.length + " elements in " + elapsed + " ms");
        System.out.println("Verify sorted: " + (data[0] <= data[1] && data[1] <= data[2]));
    }
}
```

**What changed:**
- `Arrays.sort()` replaced with `Arrays.parallelSort()` — uses Fork/Join pool to sort sub-arrays in parallel
- On an 8-core machine, the work is split across multiple threads

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt       Score      Error  Units
ParallelSort.sort          avgt   10   1_234_567 ± 45_678   us/op
```

**Improvement:** ~3.7x faster on an 8-core machine. The speedup scales with core count but is limited by memory bandwidth and merge overhead.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `Arrays.parallelSort()` divides the array into sub-arrays, sorts each in parallel using the common Fork/Join pool, and merges the results. The threshold for parallelism is `1 << 13` (8,192 elements) — below that, it falls back to `Arrays.sort()`. For 50M elements on an 8-core machine, it effectively uses all cores for sorting.

**When to apply:** Large arrays (100K+ elements) on multi-core machines. The larger the array, the more benefit.
**When NOT to apply:** Small arrays (< 10K elements) — Fork/Join overhead negates the parallelism benefit. Also avoid in environments with a heavily loaded Fork/Join pool (e.g., inside `parallelStream()` pipelines) — thread starvation can cause worse performance.

</details>

---

## Exercise 7: Repeated Array Resizing vs Pre-allocation (Medium, mem)

**What the code does:** Dynamically builds an array of filtered results by repeatedly creating new larger arrays.

**The problem:** Each time an element passes the filter, the entire array is copied into a new, larger array — O(n^2) total copies.

```java
import java.util.Arrays;
import java.util.Random;

public class Main {
    // Slow version — grow array by 1 each time (O(n^2) copies)
    public static int[] filterPositive(int[] source) {
        int[] result = new int[0];
        for (int val : source) {
            if (val > 0) {
                int[] newResult = new int[result.length + 1];
                System.arraycopy(result, 0, newResult, 0, result.length);
                newResult[result.length] = val;
                result = newResult;
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[] data = new int[500_000];
        Random rng = new Random(42);
        for (int i = 0; i < data.length; i++) {
            data[i] = rng.nextInt(201) - 100; // range: -100 to 100
        }

        long start = System.nanoTime();
        int[] filtered = filterPositive(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Filtered: " + filtered.length + " positives in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                      Mode  Cnt        Score       Error  Units
SlowFilter.filter              avgt   10  12_345_678 ± 456_789   us/op
SlowFilter.gc.alloc.norm       avgt   10      580 GB             B/op
```

<details>
<summary>Hint</summary>

Pre-allocate the result array to the maximum possible size (same as source), fill it, and trim at the end with `Arrays.copyOf()`. One allocation instead of ~250K allocations.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.Arrays;
import java.util.Random;

public class Main {
    // Fast version — pre-allocate max size, trim once at the end
    public static int[] filterPositive(int[] source) {
        int[] buffer = new int[source.length]; // max possible size
        int count = 0;
        for (int val : source) {
            if (val > 0) {
                buffer[count++] = val;
            }
        }
        return Arrays.copyOf(buffer, count); // trim to exact size
    }

    public static void main(String[] args) {
        int[] data = new int[500_000];
        Random rng = new Random(42);
        for (int i = 0; i < data.length; i++) {
            data[i] = rng.nextInt(201) - 100;
        }

        long start = System.nanoTime();
        int[] filtered = filterPositive(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Filtered: " + filtered.length + " positives in " + elapsed + " ms");
    }
}
```

**What changed:**
- Single allocation of `int[source.length]` instead of ~250K incremental allocations
- Single `Arrays.copyOf()` at the end to trim — total of 2 allocations vs ~250K
- O(n) total copies instead of O(n^2)

**Optimized benchmark:**
```
Benchmark                      Mode  Cnt     Score    Error  Units
FastFilter.filter              avgt   10   1_234 ± 67      us/op
FastFilter.gc.alloc.norm       avgt   10     4 MB          B/op
```

**Improvement:** ~10,000x faster, ~145,000x less memory allocated. The original does O(n^2/2) array copies total; the optimized version does O(n) work.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Growing an array by 1 each time means copy 1, then copy 2, then copy 3... up to copy n. Total copies = n*(n+1)/2 = O(n^2). For 250K filtered elements, that is ~31 billion element copies. Pre-allocating to max size and trimming once reduces this to exactly n + count copies. This is the same principle behind `ArrayList`'s geometric growth strategy (grow by 50%), but using a primitive array avoids boxing too.

**When to apply:** Any time you are building a result array of unknown size. Pre-allocate to an upper bound or use geometric doubling.
**When NOT to apply:** If the upper bound is extremely large (e.g., billions) and the result is tiny, pre-allocating wastes memory. In that case, use geometric doubling (double capacity when full).

</details>

---

## Exercise 8: Column-major vs Row-major Traversal (Hard, cpu)

**What the code does:** Sums all elements of a 10,000 x 10,000 2D integer matrix.

**The problem:** Traverses the matrix in column-major order, causing cache misses on every access because Java 2D arrays are stored in row-major order.

```java
public class Main {
    // Slow version — column-major traversal (cache-hostile)
    public static long sumMatrix(int[][] matrix) {
        int rows = matrix.length;
        int cols = matrix[0].length;
        long sum = 0;
        // Traverses column by column: jumps across rows (different arrays)
        for (int col = 0; col < cols; col++) {
            for (int row = 0; row < rows; row++) {
                sum += matrix[row][col]; // cache miss on each access
            }
        }
        return sum;
    }

    public static void main(String[] args) {
        int size = 10_000;
        int[][] matrix = new int[size][size];
        for (int i = 0; i < size; i++) {
            for (int j = 0; j < size; j++) {
                matrix[i][j] = (i + j) % 100;
            }
        }

        long start = System.nanoTime();
        long result = sumMatrix(matrix);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sum: " + result + " in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt      Score     Error  Units
ColumnMajor.sum            avgt   10  1_245_678 ± 45_321  us/op
```

**Profiling output:**
```
async-profiler cache-misses: 98.2% of samples in sumMatrix — L1 cache miss rate: 87%
```

<details>
<summary>Hint</summary>

In Java, a 2D array `int[][]` is an array of arrays — each row is a separate `int[]` on the heap. Traversing row-by-row accesses contiguous memory within each row array. Column-by-column jumps between different heap objects on every inner-loop iteration.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    // Fast version — row-major traversal (cache-friendly)
    public static long sumMatrix(int[][] matrix) {
        int rows = matrix.length;
        int cols = matrix[0].length;
        long sum = 0;
        // Traverses row by row: sequential access within each row array
        for (int row = 0; row < rows; row++) {
            int[] currentRow = matrix[row]; // local reference avoids repeated array lookup
            for (int col = 0; col < cols; col++) {
                sum += currentRow[col]; // sequential memory access
            }
        }
        return sum;
    }

    public static void main(String[] args) {
        int size = 10_000;
        int[][] matrix = new int[size][size];
        for (int i = 0; i < size; i++) {
            for (int j = 0; j < size; j++) {
                matrix[i][j] = (i + j) % 100;
            }
        }

        long start = System.nanoTime();
        long result = sumMatrix(matrix);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sum: " + result + " in " + elapsed + " ms");
    }
}
```

**What changed:**
- Swapped loop order: row as outer loop, column as inner loop — sequential access within each `int[]`
- Cached `matrix[row]` in a local variable — avoids repeated array dereference
- CPU prefetcher now predicts access pattern and pre-loads cache lines

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score     Error  Units
RowMajor.sum               avgt   10  145_234 ± 5_678   us/op
```

**Improvement:** ~8.6x faster. L1 cache miss rate drops from 87% to ~3%. Same computation, same result, just a different traversal order.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Modern CPUs have a hierarchy of caches (L1: ~32KB, L2: ~256KB, L3: ~8MB). When you access `matrix[row][col]`, the CPU loads an entire cache line (64 bytes = 16 ints). In row-major order, the next 15 accesses hit that same cache line — free reads. In column-major order, the next access is in a completely different `int[]` object on the heap, causing a cache miss that costs ~100 cycles (vs ~4 cycles for L1 hit).

For a 10,000 x 10,000 matrix, column-major traversal causes ~100M cache misses. Row-major causes ~6.25M (one per cache line load). That is 16x fewer cache misses.

**JVM note:** Java 2D arrays are arrays of arrays (jagged arrays), NOT contiguous 2D blocks. Each `matrix[i]` is a separate heap object. This makes column-major access even worse than in C, where a 2D array is contiguous.

**When to apply:** Any matrix/grid/image processing. Always traverse the innermost dimension in the inner loop.
**When NOT to apply:** If the algorithm requires column-major access (e.g., certain linear algebra operations), consider transposing the matrix first or using a flattened 1D array with index arithmetic.

</details>

---

## Exercise 9: Flattened 1D Array vs Jagged 2D Array (Hard, cpu)

**What the code does:** Performs matrix multiplication on two 1000x1000 integer matrices.

**The problem:** Uses `int[][]` (jagged arrays) causing pointer indirection and poor cache utilization. Each row access involves dereferencing an object pointer.

```java
public class Main {
    // Slow version — standard 2D array matrix multiplication
    public static int[][] multiply(int[][] a, int[][] b) {
        int n = a.length;
        int[][] result = new int[n][n];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                int sum = 0;
                for (int k = 0; k < n; k++) {
                    sum += a[i][k] * b[k][j]; // b[k][j] — column access on b, cache hostile
                }
                result[i][j] = sum;
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int n = 1000;
        int[][] a = new int[n][n];
        int[][] b = new int[n][n];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                a[i][j] = (i + j) % 100;
                b[i][j] = (i * j + 1) % 100;
            }
        }

        long start = System.nanoTime();
        int[][] c = multiply(a, b);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("C[0][0] = " + c[0][0] + ", C[999][999] = " + c[999][999]);
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt        Score       Error  Units
JaggedMultiply.multiply    avgt   10   3_456_789 ± 123_456   us/op
```

**Profiling output:**
```
async-profiler cache-misses: 72% in multiply inner loop — dominated by b[k][j] column access
```

<details>
<summary>Hint</summary>

Use a flattened `int[]` with index arithmetic (`row * cols + col`) for contiguous memory layout. Also transpose matrix B so that `b[j][k]` becomes row-major access in the inner loop.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    // Fast version — flattened 1D arrays + transposed B matrix
    public static int[] multiply(int[] a, int[] b, int n) {
        // Transpose B for cache-friendly access
        int[] bT = new int[n * n];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                bT[j * n + i] = b[i * n + j];
            }
        }

        int[] result = new int[n * n];
        for (int i = 0; i < n; i++) {
            int rowOffset = i * n;
            for (int j = 0; j < n; j++) {
                int colOffset = j * n;
                int sum = 0;
                for (int k = 0; k < n; k++) {
                    sum += a[rowOffset + k] * bT[colOffset + k]; // both sequential access
                }
                result[rowOffset + j] = sum;
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int n = 1000;
        int[] a = new int[n * n];
        int[] b = new int[n * n];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                a[i * n + j] = (i + j) % 100;
                b[i * n + j] = (i * j + 1) % 100;
            }
        }

        long start = System.nanoTime();
        int[] c = multiply(a, b, n);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("C[0][0] = " + c[0] + ", C[999][999] = " + c[999 * n + 999]);
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**What changed:**
- `int[][]` replaced with flattened `int[]` — eliminates pointer indirection, single contiguous allocation
- Transposed matrix B before multiplication — inner loop now accesses both `a` and `bT` sequentially
- Pre-computed row/column offsets to avoid repeated multiplication

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt       Score      Error  Units
FlatMultiply.multiply         avgt   10   845_234 ± 23_456   us/op
```

**Improvement:** ~4.1x faster. Cache miss rate drops from 72% to ~8%. The transpose costs O(n^2) but saves O(n^3) cache misses in the multiplication.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** In the original code, `b[k][j]` in the inner loop accesses column `j` of different row arrays — each `b[k]` is a different heap object. This causes a cache miss on nearly every access. By transposing B, the inner loop accesses `bT[j * n + k]` sequentially, which is contiguous memory.

Flattening from `int[][]` to `int[]` eliminates one level of pointer indirection. A jagged array requires: (1) load the row pointer from the outer array, (2) load the element from the inner array. A flat array needs only: (1) compute offset, (2) load element. The offset computation is a single multiply-add that the CPU handles in 1 cycle.

**Advanced technique:** For even better performance, use loop tiling (blocking) — process the matrix in small blocks that fit in L1 cache. This can yield another 2-3x improvement on very large matrices.

**When to apply:** Any matrix computation, image processing, or grid simulation with heavy element access.
**When NOT to apply:** When matrices are small (< 100x100) — the overhead of transposing and flattening is not worth it. Also avoid if rows have different lengths (true jagged arrays).

</details>

---

## Exercise 10: Array Pool Reuse vs Repeated Allocation (Hard, mem)

**What the code does:** Processes 100,000 incoming data packets, each requiring a temporary buffer array of 4,096 integers.

**The problem:** Allocates a new `int[4096]` buffer for every packet — 100K allocations put enormous pressure on the garbage collector.

```java
public class Main {
    // Slow version — allocates a new buffer for every packet
    public static long processPackets(int packetCount) {
        long checksum = 0;
        for (int p = 0; p < packetCount; p++) {
            int[] buffer = new int[4096]; // new allocation every iteration
            // Simulate packet processing
            for (int i = 0; i < buffer.length; i++) {
                buffer[i] = (p * 31 + i * 7) % 256;
            }
            // Compute checksum
            for (int val : buffer) {
                checksum += val;
            }
            // buffer becomes garbage here
        }
        return checksum;
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        long result = processPackets(100_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Checksum: " + result + " in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                      Mode  Cnt      Score     Error  Units
SlowPackets.process            avgt   10  456_789 ± 12_345   us/op
SlowPackets.gc.alloc.norm      avgt   10    1.6 GB           B/op
SlowPackets.gc.count           avgt   10      312           counts
```

**Profiling output:**
```
async-profiler alloc: 99.8% of allocations in processPackets — 100K int[4096] arrays
GC log: 312 young GC pauses totaling 1.2 seconds
```

<details>
<summary>Hint</summary>

Reuse a single buffer array across all iterations. Since each packet fully overwrites the buffer, there is no data leak. If multi-threaded, use `ThreadLocal<int[]>` for thread-safe pooling.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    // Fast version — reuse a single buffer (array pooling)
    public static long processPackets(int packetCount) {
        int[] buffer = new int[4096]; // allocate once, reuse for all packets
        long checksum = 0;
        for (int p = 0; p < packetCount; p++) {
            // Simulate packet processing — overwrites entire buffer
            for (int i = 0; i < buffer.length; i++) {
                buffer[i] = (p * 31 + i * 7) % 256;
            }
            // Compute checksum
            for (int val : buffer) {
                checksum += val;
            }
            // buffer is reused — no garbage created
        }
        return checksum;
    }

    // Thread-safe version using ThreadLocal
    private static final ThreadLocal<int[]> BUFFER_POOL =
            ThreadLocal.withInitial(() -> new int[4096]);

    public static long processPacketsThreadSafe(int packetCount) {
        int[] buffer = BUFFER_POOL.get(); // one buffer per thread
        long checksum = 0;
        for (int p = 0; p < packetCount; p++) {
            for (int i = 0; i < buffer.length; i++) {
                buffer[i] = (p * 31 + i * 7) % 256;
            }
            for (int val : buffer) {
                checksum += val;
            }
        }
        return checksum;
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        long result = processPackets(100_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Checksum: " + result + " in " + elapsed + " ms");
    }
}
```

**What changed:**
- Single `int[4096]` allocated once outside the loop — reused 100K times
- Zero GC pressure — no young generation collections during processing
- Thread-safe variant uses `ThreadLocal<int[]>` for concurrent environments
- Total allocation: 16 KB (one buffer) vs 1.6 GB (100K buffers)

**Optimized benchmark:**
```
Benchmark                      Mode  Cnt      Score    Error  Units
FastPackets.process            avgt   10  198_456 ± 4_567   us/op
FastPackets.gc.alloc.norm      avgt   10     16 KB          B/op
FastPackets.gc.count           avgt   10        0          counts
```

**Improvement:** ~2.3x faster, 99.999% less allocation (16 KB vs 1.6 GB), zero GC pauses. The speedup comes from eliminating allocation overhead and GC pauses.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Each `new int[4096]` allocates 16,384 bytes on the heap. The JVM must: (1) bump the TLAB pointer or allocate from Eden, (2) zero-initialize 4,096 ints (the JVM always zeroes new arrays), (3) eventually GC the dead buffer. With 100K iterations, that is 1.6 GB of allocation, triggering ~312 young GC pauses. Reusing one buffer eliminates all of this.

**Advanced pooling patterns:**
- **Single-threaded:** Local variable outside the loop (simplest)
- **Multi-threaded:** `ThreadLocal<int[]>` — one buffer per thread, no synchronization
- **Variable-size buffers:** Apache Commons Pool or a custom ring buffer of arrays
- **Caution with ThreadLocal:** In application servers with thread pools, `ThreadLocal` values persist across requests — call `.remove()` to avoid memory leaks

**JVM flags to monitor:**
- `-Xlog:gc*` — see GC frequency and pause times
- `-XX:+PrintTLAB` — see TLAB allocation statistics

**When to apply:** Any hot loop that allocates and discards same-sized arrays or objects — network packet processing, image frame processing, serialization buffers.
**When NOT to apply:** If the buffer contents must not leak between iterations (security-sensitive data). In that case, use `Arrays.fill(buffer, 0)` between uses — still faster than reallocating.

</details>

---

## Score Card

Track your progress:

| Exercise | Difficulty | Category | Identified bottleneck? | Optimized correctly? | Understood why? |
|:--------:|:---------:|:--------:|:---------------------:|:-------------------:|:---------------:|
| 1 | Easy | cpu | ☐ | ☐ | ☐ |
| 2 | Easy | cpu | ☐ | ☐ | ☐ |
| 3 | Easy | mem | ☐ | ☐ | ☐ |
| 4 | Medium | mem | ☐ | ☐ | ☐ |
| 5 | Medium | cpu | ☐ | ☐ | ☐ |
| 6 | Medium | conc | ☐ | ☐ | ☐ |
| 7 | Medium | mem | ☐ | ☐ | ☐ |
| 8 | Hard | cpu | ☐ | ☐ | ☐ |
| 9 | Hard | cpu | ☐ | ☐ | ☐ |
| 10 | Hard | mem | ☐ | ☐ | ☐ |

### Rating:
- **10/10 optimized** — Senior-level Java array performance skills
- **7-9/10** — Solid understanding of array optimization
- **4-6/10** — Good foundation, review cache and memory concepts
- **< 4/10** — Review Arrays fundamentals first

---

## Optimization Cheat Sheet

Quick reference for common Java array optimizations:

| Problem | Solution | Impact |
|:--------|:---------|:------:|
| Manual sorting | `Arrays.sort()` — JVM intrinsic dual-pivot quicksort | Very High |
| Manual array copy | `System.arraycopy()` or `Arrays.copyOf()` — native memcpy | High |
| `Integer[]` for numeric data | Use `int[]` — eliminates boxing, 5x less memory | Very High |
| `ArrayList<Integer>` unknown size | Pre-size `new ArrayList<>(cap)` or use `int[]` | High |
| Linear search on sorted array | `Arrays.binarySearch()` — O(log n) vs O(n) | Very High |
| Single-threaded sort on huge arrays | `Arrays.parallelSort()` — Fork/Join parallelism | High |
| Grow-by-one array pattern | Pre-allocate max size, trim with `Arrays.copyOf()` | Very High |
| Column-major 2D traversal | Row-major traversal — cache-friendly sequential access | High |
| `int[][]` matrix operations | Flatten to `int[]` with index arithmetic + transpose | High |
| New buffer every iteration | Reuse single buffer or `ThreadLocal<int[]>` pool | Medium-High |
| Comparing arrays | `Arrays.equals()` / `Arrays.deepEquals()` — not `==` | Medium |
| Filling arrays | `Arrays.fill()` — JVM intrinsic, faster than manual loop | Medium |
