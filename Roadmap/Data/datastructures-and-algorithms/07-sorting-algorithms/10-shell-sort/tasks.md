# Shell Sort — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Test with the inputs given and your own edge cases (empty, single, duplicates, sorted, reverse-sorted).

---

## Beginner Tasks

### Task 1: Implement Shell Sort with Shell's Original Gap Sequence

Implement Shell Sort using the gap sequence `n/2, n/4, ..., 1`.

#### Go

```go
package main

import "fmt"

func ShellSort(arr []int) {
    // TODO: implement
}

func main() {
    data := []int{9, 8, 7, 6, 5, 4, 3, 2, 1, 0}
    ShellSort(data)
    fmt.Println(data) // expected: [0 1 2 3 4 5 6 7 8 9]
}
```

#### Java

```java
import java.util.Arrays;

public class Task1 {
    public static void shellSort(int[] arr) {
        // TODO
    }

    public static void main(String[] args) {
        int[] data = {9, 8, 7, 6, 5, 4, 3, 2, 1, 0};
        shellSort(data);
        System.out.println(Arrays.toString(data));
    }
}
```

#### Python

```python
def shell_sort(arr):
    # TODO
    pass

if __name__ == "__main__":
    data = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
    shell_sort(data)
    print(data)
```

- **Constraints:** in-place; no allocation; gap sequence must end at 1.
- **Evaluation:** correctness on sorted, reverse-sorted, all-equal, and random inputs.

### Task 2: Implement Shell Sort with Knuth's Gap Sequence

Use the recurrence `g_{i+1} = 3 g_i + 1` to build descending gaps `..., 40, 13, 4, 1`.

- Constraint: largest gap must satisfy `gap < n / 3`.
- Expected: works for `n = 100` in under 1 ms.

### Task 3: Verify h-sortedness

Write a helper `is_h_sorted(arr, h)` that returns `true` iff `arr[i] <= arr[i + h]` for every valid `i`. Use it to assert intermediate states of your Shell Sort:

```text
after pass at gap g, assert is_h_sorted(arr, g)
```

Run this assertion in all three languages on `[5, 3, 8, 1, 9, 2, 7, 4]`.

### Task 4: Compare Shell vs Insertion Sort on the Same Input

For `n = 1000` random integers:

1. Sort once with Insertion Sort, count comparisons and shifts.
2. Sort once with Shell Sort (Knuth gaps), count comparisons and shifts.
3. Print both counts side by side.

Verify Shell Sort uses fewer total operations.

### Task 5: Plot Operations vs n

For `n in [100, 200, 500, 1000, 2000, 5000, 10000]`:

1. Generate a random array.
2. Run Shell Sort (Knuth gaps) and count operations.
3. Print a CSV with columns `n, compares, shifts`.

Take this CSV and plot it on a log-log scale (any tool). You should see roughly slope 1.25 → 1.5 (Knuth's empirical O(n^(5/4)) to O(n^(3/2))).

---

## Intermediate Tasks

### Task 6: Implement Shell Sort with Ciura's Gap Sequence

```text
Base gaps: 1, 4, 10, 23, 57, 132, 301, 701
For n > 701, extrapolate with g_{k+1} = floor(2.25 * g_k)
```

Implement the gap-generator function as well as the sort, in all three languages.

#### Go

```go
package main

func CiuraGaps(n int) []int {
    base := []int{701, 301, 132, 57, 23, 10, 4, 1}
    gaps := []int{}
    g := base[0]
    for g < n {
        gaps = append([]int{g}, gaps...)
        g = int(float64(g) * 2.25)
    }
    return append(gaps, base...)
}

func ShellCiura(arr []int) {
    // TODO: iterate over CiuraGaps(len(arr)) and apply gapped insertion sort
}
```

#### Java

```java
import java.util.*;

public class Task6 {
    public static int[] ciuraGaps(int n) {
        int[] base = {701, 301, 132, 57, 23, 10, 4, 1};
        List<Integer> gaps = new ArrayList<>();
        int g = base[0];
        while (g < n) { gaps.add(0, g); g = (int) (g * 2.25); }
        int[] out = new int[gaps.size() + base.length];
        int idx = 0;
        for (int x : gaps) out[idx++] = x;
        for (int x : base) out[idx++] = x;
        return out;
    }

    public static void shellCiura(int[] arr) {
        // TODO
    }
}
```

#### Python

```python
def ciura_gaps(n):
    base = [701, 301, 132, 57, 23, 10, 4, 1]
    gaps = []
    g = base[0]
    while g < n:
        gaps.insert(0, g)
        g = int(g * 2.25)
    return gaps + base

def shell_ciura(arr):
    # TODO
    pass
```

### Task 7: Configurable Gap Sequence Driver

Refactor your Shell Sort so it takes a gap-sequence function as a parameter:

```text
shell_sort(arr, gap_seq_fn)
```

Implement `shell_seq_fn`, `hibbard_seq_fn`, `knuth_seq_fn`, `ciura_seq_fn`. Run all four on the same input and compare runtimes.

### Task 8: Adversarial Input for Shell's Gap Sequence

Construct an input of size 16 that forces Shell Sort with Shell's `n/2, n/4, ...` sequence into O(n²) behavior. Hint: place small values at even indices and large values at odd indices.

Verify by running both Shell n/2 and Hibbard on the input and counting operations.

### Task 9: Compare Gap Sequences on a Fixed Input

For `n = 10000` random integers, run Shell Sort with each of Shell n/2, Hibbard, Knuth, Sedgewick, and Ciura. Print a sorted table of `(sequence, comparisons, shifts, time_ms)`.

Expected ranking (best to worst by time): Ciura < Sedgewick < Knuth ≤ Hibbard < Shell.

### Task 10: Empirical Worst Case

Generate the worst possible random input for each sequence by running 1000 random permutations and keeping the one that took the most operations. Compare worst-case operation counts across sequences.

This empirical exercise illustrates why proven worst-case bounds matter.

---

## Advanced Tasks

### Task 11: Implement Shell Sort with Pratt's `2^a · 3^b` Gap Sequence

Generate all integers of the form `2^a · 3^b` up to n, in decreasing order. Implement Shell Sort with that sequence. Verify on random inputs that it sorts correctly, and measure the number of passes — should be roughly `(log_2 n) * (log_3 n)`.

#### Go

```go
package main

import "sort"

func PrattGaps(n int) []int {
    seen := map[int]bool{}
    a := 1
    for a < n {
        b := a
        for b < n {
            seen[b] = true
            b *= 3
        }
        a *= 2
    }
    out := make([]int, 0, len(seen))
    for k := range seen { out = append(out, k) }
    sort.Sort(sort.Reverse(sort.IntSlice(out)))
    return out
}

func ShellPratt(arr []int) {
    // TODO: apply gapped insertion sort using PrattGaps(len(arr))
}
```

#### Java

```java
import java.util.*;

public class Task11 {
    public static int[] prattGaps(int n) {
        TreeSet<Integer> seen = new TreeSet<>(Comparator.reverseOrder());
        for (int a = 1; a < n; a *= 2) {
            for (int b = a; b < n; b *= 3) {
                seen.add(b);
            }
        }
        return seen.stream().mapToInt(Integer::intValue).toArray();
    }

    public static void shellPratt(int[] arr) {
        // TODO
    }
}
```

#### Python

```python
def pratt_gaps(n):
    """Return all 2^a * 3^b values < n, in decreasing order."""
    gaps = set()
    a = 1
    while a < n:
        b = a
        while b < n:
            gaps.add(b)
            b *= 3
        a *= 2
    return sorted(gaps, reverse=True)

def shell_pratt(arr):
    # TODO
    pass
```

### Task 12: Hybrid Shell + Insertion Sort

For arrays where `n <= 32`, skip Shell Sort and use plain Insertion Sort directly. For larger arrays, use Shell Sort (Ciura gaps). Benchmark across `n ∈ [10, 1000]` and find the crossover point on your machine.

### Task 13: Sort a Custom Struct Type (Stability Demonstration)

Sort an array of records `{key, original_index}` by `key` using Shell Sort. Verify that the result is **not stable** by finding two records with equal `key` that ended up with swapped `original_index` values.

Repeat with Merge Sort and confirm stability.

#### Go

```go
package main

type Record struct {
    Key  int
    Idx  int
}

func ShellSortRecords(arr []Record) {
    // TODO: same kernel, compare on Key
}

// Drive: create records [(3,0),(1,1),(3,2),(2,3),(3,4)], sort, check Idx order
// of records with Key == 3
```

#### Java

```java
public class Task13 {
    static class Record {
        int key, idx;
        Record(int k, int i) { key = k; idx = i; }
    }

    public static void shellSortRecords(Record[] arr) {
        // TODO
    }
}
```

#### Python

```python
def shell_sort_records(arr):
    """arr is a list of (key, idx) tuples; sort by key."""
    n = len(arr)
    gap = n // 2
    while gap > 0:
        for i in range(gap, n):
            x = arr[i]
            j = i
            while j >= gap and arr[j - gap][0] > x[0]:
                arr[j] = arr[j - gap]
                j -= gap
            arr[j] = x
        gap //= 2

# Verify instability: after sorting [(3,0),(1,1),(3,2),(2,3),(3,4)],
# the records with key 3 may appear in any order of original idx.
```

### Task 14: WCET Analysis

For Shell Sort with Knuth gaps on `n = 256`, derive an upper bound on the number of comparisons:

1. Number of passes: `log_3(n) + 1`.
2. Per-pass comparisons: bounded by `n^(3/2) / g_i` (sketch).
3. Sum to get an upper bound.

Compare with the empirical maximum from 10000 random permutations. Report the ratio `empirical / theoretical`.

### Task 15: Embedded Code-Size Estimation

Write Shell Sort with Knuth gaps in C-style Go (no slice tricks, no allocations). Compile with `go build -ldflags="-s -w"` and report the binary size delta vs. a stub program. The increment should be roughly the size of Shell Sort's machine code.

For Java, use `javac -g:none` and `javap -c` to count instructions.

For Python, use `dis.dis(shell_sort)` to count bytecodes.

Report all three.

---

## Benchmark Task

> Compare Shell Sort performance across all 3 languages.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

var ciuraGaps = []int{701, 301, 132, 57, 23, 10, 4, 1}

func ShellCiura(arr []int) {
    n := len(arr)
    for _, gap := range ciuraGaps {
        if gap >= n { continue }
        for i := gap; i < n; i++ {
            x := arr[i]
            j := i
            for j >= gap && arr[j-gap] > x {
                arr[j] = arr[j-gap]
                j -= gap
            }
            arr[j] = x
        }
    }
}

func main() {
    rand.Seed(42)
    sizes := []int{1000, 10000, 100000, 1000000}
    for _, n := range sizes {
        data := make([]int, n)
        for i := range data { data[i] = rand.Intn(n) }
        runs := 10
        start := time.Now()
        for i := 0; i < runs; i++ {
            tmp := make([]int, n)
            copy(tmp, data)
            ShellCiura(tmp)
        }
        elapsed := time.Since(start)
        fmt.Printf("n=%8d: %.3f ms/run\n", n, float64(elapsed.Milliseconds())/float64(runs))
    }
}
```

#### Java

```java
import java.util.Random;

public class ShellBench {
    static final int[] CIURA = {701, 301, 132, 57, 23, 10, 4, 1};

    public static void shellCiura(int[] arr) {
        int n = arr.length;
        for (int gap : CIURA) {
            if (gap >= n) continue;
            for (int i = gap; i < n; i++) {
                int x = arr[i];
                int j = i;
                while (j >= gap && arr[j - gap] > x) {
                    arr[j] = arr[j - gap];
                    j -= gap;
                }
                arr[j] = x;
            }
        }
    }

    public static void main(String[] args) {
        int[] sizes = {1000, 10000, 100000, 1000000};
        Random rng = new Random(42);
        for (int n : sizes) {
            int[] data = new int[n];
            for (int i = 0; i < n; i++) data[i] = rng.nextInt(n);
            int runs = 10;
            long start = System.nanoTime();
            for (int i = 0; i < runs; i++) {
                shellCiura(data.clone());
            }
            long elapsed = System.nanoTime() - start;
            System.out.printf("n=%8d: %.3f ms/run%n", n, elapsed / runs / 1_000_000.0);
        }
    }
}
```

#### Python

```python
import random
import time

CIURA_GAPS = [701, 301, 132, 57, 23, 10, 4, 1]

def shell_ciura(arr):
    n = len(arr)
    for gap in CIURA_GAPS:
        if gap >= n:
            continue
        for i in range(gap, n):
            x = arr[i]
            j = i
            while j >= gap and arr[j - gap] > x:
                arr[j] = arr[j - gap]
                j -= gap
            arr[j] = x

if __name__ == "__main__":
    random.seed(42)
    for n in [1000, 10000, 100000, 1000000]:
        data = [random.randint(0, n) for _ in range(n)]
        runs = 10
        start = time.perf_counter()
        for _ in range(runs):
            shell_ciura(data.copy())
        elapsed = time.perf_counter() - start
        print(f"n={n:>8}: {elapsed / runs * 1000:.3f} ms/run")
```

### Expected Results

Approximate (depends on hardware):

```text
Go    n=1000:    0.15 ms     n=10000:    2.5 ms    n=100000:   45 ms    n=1000000:  900 ms
Java  n=1000:    0.20 ms     n=10000:    3.0 ms    n=100000:   55 ms    n=1000000: 1100 ms
Python n=1000:   3.0 ms      n=10000:   55 ms      n=100000: 1200 ms    n=1000000:   25 s
```

Go and Java are typically within 20% of each other; Python is 20–40× slower because the inner loop is interpreted. For Python at `n = 10^6`, prefer `arr.sort()` (TimSort) — Shell Sort is purely educational here.

---

## Evaluation Rubric

For each task, expect:

- **Correctness** on edge cases: `[]`, `[42]`, `[1,1,1,1]`, sorted, reverse-sorted, random.
- **Big-O analysis** in the comments matching the empirical operation count.
- **Idiomatic code**: Go idioms for Go, Java idioms for Java, Pythonic Python.
- **Documentation**: brief docstring/comment explaining gap sequence and stability.
- **Test coverage**: at minimum 5 test cases per implementation.

Tasks 11–15 should be accompanied by short written notes (one paragraph) explaining the result.
