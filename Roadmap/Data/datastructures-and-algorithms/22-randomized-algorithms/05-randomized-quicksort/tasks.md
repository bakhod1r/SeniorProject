# Randomized Quicksort — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Build on the base [Quick Sort tasks](../../07-sorting-algorithms/04-quick-sort/junior.md). Here the focus is **randomization, expected analysis, duplicates, and worst-case avoidance.**

---

## Beginner Tasks

**Task 1:** Implement Randomized Quicksort from scratch (random pivot + Lomuto partition), in place, no library sort.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
)

func RandomizedQuickSort(arr []int) {
    // implement: random pivot per call, Lomuto partition
}

func main() {
    data := []int{3, 8, 2, 5, 1, 4, 7, 6}
    RandomizedQuickSort(data)
    fmt.Println(data) // [1 2 3 4 5 6 7 8]
    _ = rand.Intn
}
```

#### Java

```java
public class Task1 {
    public static void sort(int[] arr) {
        // implement: random pivot per call, Lomuto partition
    }

    public static void main(String[] args) {
        int[] data = {3, 8, 2, 5, 1, 4, 7, 6};
        sort(data);
        System.out.println(java.util.Arrays.toString(data));
    }
}
```

#### Python

```python
import random

def randomized_quick_sort(arr):
    # implement: random pivot per call, Lomuto partition
    pass

if __name__ == "__main__":
    data = [3, 8, 2, 5, 1, 4, 7, 6]
    randomized_quick_sort(data)
    print(data)  # [1, 2, 3, 4, 5, 6, 7, 8]
```

- **Constraints:** correct expected O(n log n); in place; test empty/single/duplicate inputs.
- **Expected Output:** sorted ascending.
- **Evaluation:** correctness, edge cases, that the pivot is actually randomized every call.

**Task 2:** Implement the **random-shuffle-then-sort** variant: Fisher–Yates shuffle the whole array once, then run plain Quicksort with a fixed last-element pivot. Verify it is fast on already-sorted input.
- Provide starter code in all 3 languages.
- Constraints: the shuffle must be an unbiased Fisher–Yates (`j ∈ [i, n)`); no library shuffle for the implementation (you may use one to cross-check).

**Task 3:** Add an **instrumentation counter** to Task 1 that counts the total number of element comparisons. Sort a random array of n = 1000 and confirm the count is close to `1.39 · n · log₂ n`.
- Print both the measured count and the predicted `1.39 n log₂ n`.
- Constraints: count only comparisons inside partition.

**Task 4:** Write a function `isSorted(arr) bool` and use it to assert correctness (the Las Vegas property) across 100 random runs of Task 1 on random inputs of random sizes 0..50.
- Provide starter code in all 3 languages.
- Constraints: must never fail — if it does, your partition has a bug.

**Task 5:** Demonstrate the worst case disappearing. Sort an already-sorted array of n = 5000 with (a) a fixed-last-pivot Quicksort and (b) Randomized Quicksort, and print the wall-clock time of each.
- Constraints: (a) should be dramatically slower (O(n²)); (b) should be fast (O(n log n)).
- Expected Output: a clear timing gap demonstrating randomization's benefit.

---

## Intermediate Tasks

**Task 6:** Implement **3-way (Dutch National Flag) Randomized Quicksort**. Test it on an all-equal array of n = 100000 and confirm it runs in O(n) (compare timing against your 2-way version, which should blow up).
- Provide starter code in all 3 languages.
- Constraints: random pivot; partition into `<`, `==`, `>`; recurse only on the `<` and `>` regions.

**Task 7:** Implement **Randomized Quickselect** (`kthSmallest(arr, k)`) returning the k-th smallest (1-indexed) in expected O(n). Reuse your randomized partition; recurse on a single side only.
- Constraints: in place; handle duplicates; validate `1 ≤ k ≤ len(arr)`.
- Expected Output: `kthSmallest([7,10,4,3,20,15], 3) == 7`.

**Task 8:** Implement **tail-recursion-optimized** Randomized Quicksort that always recurses on the smaller partition and loops on the larger. Add an assertion (or counter) showing the recursion depth never exceeds `~2·log₂ n`.
- Provide starter code in all 3 languages.
- Constraints: must not overflow the stack on a sorted input of n = 10⁶.

**Task 9:** Implement **randomized median-of-three** pivot selection (sample 3 *random* indices, use their median as pivot) and an **insertion-sort cutoff** at n ≤ 16. Benchmark against plain random-pivot Quicksort on random data.
- Constraints: report comparison counts for both; the median-of-three version should do slightly fewer.

**Task 10:** Build a **reproducibility harness**: make your Randomized Quicksort accept an explicit seed. Show that the *same seed* produces the *same sequence of pivot choices* (instrument and print them), while *different seeds* produce different sequences — yet all produce the identical sorted output.
- Provide starter code in all 3 languages.
- Constraints: pivot log must match exactly for equal seeds.

---

## Advanced Tasks

**Task 11:** Implement **Introsort**: Randomized Quicksort with an Insertion-Sort cutoff and a **Heap Sort fallback** when recursion depth exceeds `2·⌊log₂ n⌋`. Prove empirically it stays O(n log n) on an adversarial sorted input where bare 2-way Quicksort with a bad RNG would struggle.
- Provide starter code in all 3 languages.
- Constraints: the heap fallback must sort a *subrange* `[lo, hi]` in place.

**Task 12:** Implement **worst-case-linear Quickselect** using **median-of-medians (BFPRT)** as the pivot. Verify it returns the correct k-th smallest and that, even on a sorted adversarial input, it never degrades (instrument the number of partition calls).
- Constraints: groups of 5; recursive median-of-medians; recurrence `T(n)=T(n/5)+T(7n/10)+O(n)`.

**Task 13:** Build a **comparison-count experiment**: for n ∈ {10², 10³, 10⁴, 10⁵}, run Randomized Quicksort 30 times each on random inputs, record the comparison count distribution, and report the mean and the maximum observed. Confirm the mean ≈ `2n ln n` and that the max stays within a small constant factor of the mean (a concentration / high-probability demonstration).
- Provide starter code in all 3 languages.
- Constraints: report mean, max, and `max/mean` ratio per n.

**Task 14:** Implement a **parallel Randomized Quicksort** (sort the two partitions concurrently, with a sequential cutoff for small subarrays). Benchmark single-threaded vs parallel on n = 10⁷ random integers and report the speedup.
- Constraints: Go goroutines + WaitGroup; Java ForkJoin or threads; Python `concurrent.futures` or `multiprocessing` (note the GIL caveat — explain why threads may not speed up CPU-bound Python and use processes instead).
- Expected Output: a speedup figure and a one-line explanation of why it is below the core count (partition is sequential; load imbalance).

**Task 15:** Implement an **adversary / antiquicksort experiment**: write a "killer" input generator that defeats a *fixed* median-of-three pivot (or simply use a sorted array against a fixed-last-pivot sort) and show it forces O(n²). Then show that switching to a *randomized* pivot (with an unpredictable seed) neutralizes the attack. Discuss in comments why a *predictable* seed would still be vulnerable.
- Provide starter code in all 3 languages.
- Constraints: print timing for fixed-pivot-vs-adversary, randomized-pivot-vs-adversary; include the security discussion.

---

## Benchmark Task

> Compare performance across all 3 languages and across input shapes.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func main() {
    sizes := []int{10, 100, 1000, 10000, 100000}
    builders := map[string]func(int) []int{
        "random":   func(n int) []int { a := make([]int, n); for i := range a { a[i] = rand.Intn(n) }; return a },
        "sorted":   func(n int) []int { a := make([]int, n); for i := range a { a[i] = i }; return a },
        "allequal": func(n int) []int { a := make([]int, n); for i := range a { a[i] = 7 }; return a },
    }
    for name, build := range builders {
        for _, n := range sizes {
            base := build(n)
            start := time.Now()
            for i := 0; i < 20; i++ {
                tmp := make([]int, n)
                copy(tmp, base)
                yourRandomizedQuickSort(tmp) // your implementation
            }
            elapsed := time.Since(start)
            fmt.Printf("%-9s n=%7d: %.3f ms\n", name, n, float64(elapsed.Milliseconds())/20.0)
        }
    }
}
```

#### Java

```java
import java.util.function.IntFunction;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {10, 100, 1000, 10000, 100000};
        var builders = new java.util.LinkedHashMap<String, IntFunction<int[]>>();
        builders.put("random",   n -> { int[] a = new int[n]; var r = new java.util.Random();
                                         for (int i = 0; i < n; i++) a[i] = r.nextInt(n); return a; });
        builders.put("sorted",   n -> { int[] a = new int[n]; for (int i = 0; i < n; i++) a[i] = i; return a; });
        builders.put("allequal", n -> { int[] a = new int[n]; java.util.Arrays.fill(a, 7); return a; });
        builders.forEach((name, build) -> {
            for (int n : sizes) {
                int[] base = build.apply(n);
                long start = System.nanoTime();
                for (int i = 0; i < 20; i++) yourRandomizedQuickSort(base.clone()); // your impl
                long elapsed = System.nanoTime() - start;
                System.out.printf("%-9s n=%7d: %.3f ms%n", name, n, elapsed / 20.0 / 1_000_000);
            }
        });
    }
}
```

#### Python

```python
import random, timeit

sizes = [10, 100, 1_000, 10_000, 100_000]
builders = {
    "random":   lambda n: [random.randint(0, n) for _ in range(n)],
    "sorted":   lambda n: list(range(n)),
    "allequal": lambda n: [7] * n,
}

for name, build in builders.items():
    for n in sizes:
        base = build(n)
        t = timeit.timeit(lambda: your_randomized_quick_sort(list(base)), number=20)  # your impl
        print(f"{name:<9} n={n:>7}: {t/20*1000:.3f} ms")
```

> Expected findings: the `sorted` column should stay flat for Randomized Quicksort (no O(n²) blow-up). The `allequal` column will blow up for a 2-way version and stay flat only for your **3-way** version — run the benchmark with both to see the difference.
