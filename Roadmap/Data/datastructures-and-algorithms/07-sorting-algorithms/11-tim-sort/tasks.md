# Tim Sort — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.

## Beginner Tasks

---

### Task 1: Detect a Single Run

Implement `detect_run(arr, lo)` that returns the length of the maximal run (ascending or strictly descending) starting at index `lo`. If descending, **reverse it in place** and return the (now ascending) length.

#### Go

```go
package main

import "fmt"

func detectRun(arr []int, lo int) int {
    // TODO: implement
    return 0
}

func main() {
    arr := []int{5, 4, 3, 1, 2, 6}
    n := detectRun(arr, 0)
    fmt.Println(arr[:n]) // expected [1 3 4 5]? No -> [1 3 4 5] is ascending after reversal of [5,4,3] then continues. Trace carefully.
}
```

#### Java

```java
public class Task1 {
    public static int detectRun(int[] arr, int lo) {
        // TODO: implement
        return 0;
    }

    public static void main(String[] args) {
        int[] arr = {5, 4, 3, 1, 2, 6};
        int n = detectRun(arr, 0);
        for (int i = 0; i < n; i++) System.out.print(arr[i] + " ");
        System.out.println();
    }
}
```

#### Python

```python
def detect_run(arr, lo):
    # TODO: implement
    return 0


if __name__ == "__main__":
    arr = [5, 4, 3, 1, 2, 6]
    n = detect_run(arr, 0)
    print(arr[:n])
```

- **Constraints:** O(run length) time, O(1) extra space, stable (use strict `<` for descending).
- **Test:** empty, single, ascending only, descending only, mixed.

---

### Task 2: Binary Insertion Sort on `arr[lo:hi]` Knowing `arr[lo:start]` Is Sorted

Implement the function TimSort uses to extend a short run.

#### Python

```python
def binary_insertion_sort(arr, lo, hi, start):
    """Sort arr[lo:hi] in place, assuming arr[lo:start] is already sorted."""
    # TODO: implement


arr = [3, 5, 7, 9, 2, 4, 6, 8]
binary_insertion_sort(arr, 0, len(arr), 4)  # first 4 are sorted; sort rest in
print(arr)  # [2, 3, 4, 5, 6, 7, 8, 9]
```

- **Constraints:** O((hi - start) · log(hi - lo)) comparisons; O(n²) shifts (worst). Stable.

Provide Go and Java starter code analogously.

---

### Task 3: Compute `minrun` from `n`

Implement `compute_min_run(n)` returning a value in `[32, 64]` such that `n / minrun` is just under a power of 2.

#### Python

```python
def compute_min_run(n):
    # TODO: implement
    return 0


for n in [32, 64, 65, 100, 1000, 10_000, 1_000_000]:
    print(n, compute_min_run(n))
```

- **Constraints:** O(log n) time, O(1) space.
- **Test:** values `< 32` (return `n`), powers of 2, primes.

---

### Task 4: Reverse a Subarray In Place

Used by TimSort to convert descending runs to ascending.

#### Go

```go
package main

func reverseSubarray(arr []int, lo, hi int) {
    // TODO: implement (reverse arr[lo:hi] in place)
}
```

- **Constraints:** O(n) time, O(1) space.

---

### Task 5: Count Natural Runs

Return the number of runs in an array (the same way TimSort would detect them — ascending non-strict, descending strict).

#### Python

```python
def count_natural_runs(arr):
    # TODO: implement
    return 0


print(count_natural_runs([1, 2, 3, 4, 5]))           # 1
print(count_natural_runs([5, 4, 3, 2, 1]))           # 1
print(count_natural_runs([1, 2, 5, 4, 3, 6, 7]))     # 3
print(count_natural_runs([1, 2, 2, 2, 3, 1]))        # 2
```

- **Constraints:** O(n) time.

---

## Intermediate Tasks

---

### Task 6: Simplified TimSort (No Galloping)

Implement TimSort omitting galloping mode and the depth-4 invariant patch. Should still be correct and adaptive.

Reuse Tasks 1-4 as helpers.

```python
def simple_tim_sort(arr):
    # TODO: combine: detect runs, pad to minrun via binary insertion,
    # push to stack, merge per invariants.
    pass
```

- **Constraints:** in-place sort (well, with an auxiliary merge buffer). O(n log n) worst, O(n) best.
- **Test:** random, sorted, reverse-sorted, all-equal, sizes 0, 1, 32, 33, 1000, 100_000.
- **Verify stability:** sort tuples `[(a_i, i)]` and check that for equal `a_i`, the index order is preserved.

---

### Task 7: Galloping Search

Implement `gallop_right(arr, key, lo, hi)` returning the first index in `arr[lo:hi]` strictly greater than `key`.

```python
def gallop_right(arr, key, lo=0, hi=None):
    if hi is None:
        hi = len(arr)
    # TODO: exponential search then binary search
    return lo
```

- **Constraints:** O(log k) where `k` is the gap from `lo` to the answer. Should outperform pure binary search when the answer is near `lo`.

---

### Task 8: TimSort With Galloping

Extend Task 6 with galloping mode:

- During merge, track wins per side.
- After `min_gallop` wins, switch to `gallop_right`/`gallop_left` to bulk-copy.
- Adapt `min_gallop` up/down based on whether galloping pays off.

- **Constraints:** comparator call count should drop significantly on dominated-run inputs.
- **Test:** merge `[1..1000]` with `[500, 501, 502]` — count comparator calls. Without galloping: ~1003. With galloping: ~30.

---

### Task 9: Stack Invariant Checker

Given a list of run lengths, decide whether the stack satisfies TimSort invariants `A > B + C` and `B > C` at every depth.

```python
def invariants_hold(lengths):
    # lengths[0] is the bottom of the stack
    # TODO: check (I1) and (I2) at every position
    return True


print(invariants_hold([100, 50, 20]))  # True (100 > 70, 50 > 20)
print(invariants_hold([50, 60, 20]))   # False (50 < 60 + 20)
```

- **Constraints:** O(k) time where k is stack depth.

---

### Task 10: Adversarial Input Generator

Given `n` and desired number of runs `R`, generate an array of length `n` with exactly `R` natural runs (alternating ascending and descending of roughly equal sizes).

```python
def adversarial_input(n, R):
    # TODO: return list of length n with exactly R runs
    pass


arr = adversarial_input(100, 5)
assert count_natural_runs(arr) == 5
```

- **Constraints:** O(n) time. Use for benchmarking — show TimSort's runtime grows with `R`.

---

## Advanced Tasks

---

### Task 11: External TimSort

Sort a file too large for RAM:

1. Read fixed-size chunks (e.g., 100k lines of integers).
2. TimSort each chunk in memory; write to a temp file.
3. K-way merge temp files using a heap.
4. Write final sorted output.

```python
def external_tim_sort(input_path, output_path, chunk_size=100_000):
    # TODO: implement
    pass
```

- **Constraints:** Memory ≤ `chunk_size + k * sizeof(line)`. Total I/O ≤ 4 × input size.
- **Test:** generate a 1GB file of random ints, sort it, verify with `sort -c` or equivalent.

---

### Task 12: Parallel TimSort

Sort an array of `n = 10^7` elements in parallel:

1. Split into `4 * num_cores` chunks.
2. Sort each chunk in a thread (use TimSort).
3. Pairwise merge in a tree pattern using more threads.

```python
# Go is easiest for this with goroutines; Java with ForkJoinPool; Python with multiprocessing.
def parallel_tim_sort(arr):
    # TODO
    pass
```

- **Constraints:** 3-5× speedup on 8 cores expected.
- **Test:** measure speedup vs single-threaded baseline.

---

### Task 13: Stable Sort Verification

Given a sort implementation, verify it's stable by sorting `[(key, original_index)]` and checking that equal keys preserve original index order.

```python
def is_sort_stable(sort_fn, test_input):
    # TODO: tag each element with original index, sort by key, check stability
    pass


print(is_sort_stable(sorted, [(1, "a"), (2, "b"), (1, "c"), (2, "d")]))
```

- **Constraints:** O(n) verification.
- **Use:** to confirm your TimSort port preserves stability.

---

### Task 14: Reproduce the 2015 OpenJDK Bug

Construct a sequence of run lengths that, when fed to the original OpenJDK TimSort (with `MAX_MERGE_PENDING = 40` and depth-3-only invariant check), violates the invariant at depth ≥ 4. Show that the fixed version (depth-4 check + stack size 49) handles it correctly.

Reference: de Gouw et al., "OpenJDK's java.utils.Collection.sort() is broken" (CAV 2015).

- **Constraints:** This is a research-level task. Cite the paper. Construct the input mathematically; run it through both a buggy and a fixed implementation.

---

### Task 15: PowerSort vs TimSort Benchmark

Implement PowerSort (Munro & Wild, 2018) and benchmark against TimSort on:

- Random data
- Nearly-sorted data (1% perturbed)
- Many small runs (R = n/10)
- Few large runs (R = 5)

Compare on:

- Wall-clock time
- Comparator call count
- Max stack depth

```python
def power_sort(arr):
    # TODO: assign node power based on run boundaries
    # merge runs in power order
    pass
```

- **Constraints:** Both algorithms are O(n + n log R). PowerSort should have a simpler invariant structure.
- **Goal:** decide which is faster on your machine on which inputs. Write up findings.

---

## Benchmark Task

> Compare TimSort (built-in) performance across all 3 languages and against random vs adaptive inputs.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "sort"
    "time"
)

func main() {
    sizes := []int{1000, 10_000, 100_000, 1_000_000}
    for _, n := range sizes {
        randomData := make([]int, n)
        for i := range randomData {
            randomData[i] = rand.Intn(n)
        }
        sortedData := make([]int, n)
        for i := range sortedData {
            sortedData[i] = i
        }

        runs := func(label string, data []int) {
            start := time.Now()
            for i := 0; i < 10; i++ {
                c := make([]int, n)
                copy(c, data)
                sort.SliceStable(c, func(i, j int) bool { return c[i] < c[j] })
            }
            fmt.Printf("n=%-8d %-12s: %.2f ms/op\n", n,
                label, float64(time.Since(start).Milliseconds())/10.0)
        }
        runs("random", randomData)
        runs("sorted", sortedData)
    }
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1000, 10_000, 100_000, 1_000_000};
        Random rng = new Random(42);
        for (int n : sizes) {
            Integer[] random = new Integer[n];
            Integer[] sorted = new Integer[n];
            for (int i = 0; i < n; i++) {
                random[i] = rng.nextInt(n);
                sorted[i] = i;
            }
            run(n, "random", random);
            run(n, "sorted", sorted);
        }
    }

    static void run(int n, String label, Integer[] data) {
        long start = System.nanoTime();
        for (int i = 0; i < 10; i++) {
            Integer[] copy = data.clone();
            Arrays.sort(copy);
        }
        long elapsedMs = (System.nanoTime() - start) / 1_000_000 / 10;
        System.out.printf("n=%-8d %-12s: %d ms/op%n", n, label, elapsedMs);
    }
}
```

#### Python

```python
import random
import timeit

sizes = [1000, 10_000, 100_000, 1_000_000]
random.seed(42)
for n in sizes:
    random_data = [random.randint(0, n) for _ in range(n)]
    sorted_data = list(range(n))
    for label, data in [("random", random_data), ("sorted", sorted_data)]:
        t = timeit.timeit(lambda: sorted(data), number=10) * 1000 / 10
        print(f"n={n:<8} {label:<12}: {t:.2f} ms/op")
```

**Expected pattern:**

- Sorted input should be **10-100× faster** than random — TimSort's adaptive payoff.
- Java's `Arrays.sort(Integer[])` is similar to Python's `sorted()` (both TimSort).
- Java's `Arrays.sort(int[])` (Dual-Pivot Quicksort) on random data is ~2× faster than `Arrays.sort(Integer[])` (TimSort) — primitives win on cache locality.
- Go's `sort.SliceStable` uses a related stable merge sort, faster than pure TimSort on random data due to lower constants but slower on highly adaptive inputs.

---

## Evaluation Criteria

| Criterion | Beginner | Intermediate | Advanced |
|-----------|----------|--------------|----------|
| Correctness | Passes basic tests | Passes edge cases | Passes adversarial inputs |
| Complexity | Stated and matches | Analyzed with recurrences | Proven via invariants |
| Stability | Verified by tests | Verified by tagged inputs | Argued from code |
| Adaptive behavior | Demonstrated | Measured on sorted input | Compared with non-adaptive baseline |
| Code quality | Readable | Idiomatic per language | Production-grade |

Solving Tasks 1-5 gives you the building blocks. Tasks 6-10 produce a working TimSort. Tasks 11-15 take you to production and research territory.

---

## Bonus Stretch Goals

### Stretch 1: Visualize Stack Evolution

Modify your Task 6 TimSort to log the run stack after every push/merge. Plot stack depth over time on inputs of various shapes (random, sorted, reverse, near-sorted, adversarial). Confirm:

- Stack depth stays at `O(log n)` for all valid inputs.
- Number of merges correlates with `R = number of natural runs`.

### Stretch 2: Compare Against Python's C Implementation

Run your pure-Python TimSort (Task 8) against CPython's built-in `sorted()` on the same inputs. Measure:

- Wall-clock ratio (CPython C is typically 30-50× faster).
- Comparator call ratio (should be nearly identical — same algorithm).

If your call count is much higher, debug your galloping logic.

### Stretch 3: Add `key=` Support

Extend Task 8 to accept a `key` argument (like Python's `sorted(key=...)`). Implement the Decorate-Sort-Undecorate pattern internally: compute keys once, sort key-value pairs, return values in sorted-key order. Verify stability is preserved.

### Stretch 4: Write a Property-Based Test

Use Hypothesis (Python) / quick-check style testing to assert TimSort properties:

- Output is a permutation of input.
- Output is sorted ascending.
- Output preserves order of equal keys (stability).
- Sorting twice = sorting once (idempotent).

Run on millions of random inputs to flush out bugs.

### Stretch 5: Compare With Other Adaptive Sorts

Implement Natural Merge Sort (no `minrun`, no galloping) and compare to your TimSort on:

- Random data (TimSort should be slightly slower due to overhead).
- Highly-runned data (TimSort should match — both adaptive).
- Adversarial input matching the 2015 bug pattern (TimSort handles it, Natural Merge does not).

Document your findings.

---

## Reading Companion

Each task references concepts from:

- [`junior.md`](./junior.md) — for Tasks 1-5 (basic mechanics).
- [`middle.md`](./middle.md) — for Tasks 6-10 (galloping, invariants).
- [`senior.md`](./senior.md) — for Tasks 11-13 (production patterns).
- [`professional.md`](./professional.md) — for Tasks 14-15 (formal analysis, adversarial constructions).
