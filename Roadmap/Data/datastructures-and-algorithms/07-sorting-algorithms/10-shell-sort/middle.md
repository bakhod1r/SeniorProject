# Shell Sort — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Gap Sequence Deep Dive](#gap-sequence-deep-dive)
4. [Comparison with Alternatives](#comparison-with-alternatives)
5. [Advanced Patterns](#advanced-patterns)
6. [Benchmark Methodology](#benchmark-methodology)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

> Focus: "Why does Shell Sort work, why is its complexity tied to the gap sequence, and when do I choose it over Insertion / Merge / Quick?"

At the middle level we move past "Shell Sort is insertion sort with a gap" and ask three sharper questions:

1. **What invariants do `h`-sorting passes preserve?** Knowing this lets us reason about why later passes need less work.
2. **Why does the gap sequence dominate complexity?** It is the only knob we have, and it changes the algorithm from O(n²) (Shell's original) to O(n log² n) (Pratt).
3. **When do we pick Shell Sort over insertion / merge / quick sort?** Middle engineers need to make this call quickly based on n, memory budget, stack depth, and whether stability is required.

This document assumes you have read the [junior](./junior.md) introduction.

---

## Deeper Concepts

### Invariant: After `h`-sorting, the Array Stays `h`-sorted Forever

After we finish a pass at gap `h`, the array is **`h`-sorted**: for every valid index `i`, `arr[i] <= arr[i + h]`.

**Key theorem (Knuth, TAOCP Vol. 3):** if an array is **`h`-sorted** and we then run a pass at gap `k < h`, the array remains `h`-sorted after the `k`-sort.

This is why later passes do less work: each new pass adds a new ordering constraint without destroying the previous ones. By the time `g = 1` runs, the array satisfies many ordering constraints simultaneously — every gap in the sequence has been applied — so the final insertion sort is nearly linear.

### Invariant: Final Pass Is Plain Insertion Sort

The final pass at `g = 1` **is** insertion sort. Therefore Shell Sort is guaranteed correct: insertion sort over a near-sorted array always produces a fully sorted array. Everything before the final pass is "preparation" — it doesn't have to produce a sorted array, only one that the final pass can finish cheaply.

### Recurrence Sketch — Why Gap Choice Matters

Plain insertion sort: `T(n) = O(n²)` because each element may travel O(n) positions, and there are n elements.

Shell Sort at gap `g`: each subsequence has length `n / g`, and `h`-sorting a subsequence costs O((n/g)²) in the worst case. There are `g` subsequences, so one pass costs `g · (n/g)² = n² / g`.

Sum over all gaps `g₁ > g₂ > ... > g_t = 1`:

```text
T_total ≤ Σ n² / g_i
```

If gaps are powers of 2: `T = n² · (1/n + 1/(n/2) + ... + 1) = n² · (2 - 1/n) ≈ 2n²`. Not great.

But if the **`h`-sorted invariants compound**, later passes do much less than n² / g work. The exact bound depends on how the gaps share common factors. Hibbard's `2^k - 1` chooses **pairwise coprime** gaps so that each pass adds independent ordering constraints, leading to O(n^(3/2)).

### Why Shell's `n/2, n/4, ...` Sequence Is Bad

Shell's original sequence has the property that **even-indexed elements never compare with odd-indexed elements until gap = 1**. If you place small values at all even positions and large values at all odd positions, every pass at even gap sorts these two interleaved sets independently — the merging only happens at `g = 1`, forcing the final insertion sort to do O(n²) work.

Adversarial example for Shell's sequence on `n = 16`:

```text
input: [1, 9, 2, 10, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15, 8, 16]
```

After `g = 8, 4, 2`: array is unchanged (already h-sorted for all even h).
At `g = 1`: insertion sort runs in O(n²).

Hibbard's `2^k - 1` sequence avoids this because odd and even indices mix at every pass.

### Why Pratt's O(n log² n) Works

Pratt's sequence uses **all integers of the form `2^a · 3^b`**: `1, 2, 3, 4, 6, 8, 9, 12, 16, 18, ...`. There are O(log² n) such integers below n, and each pass costs O(n). Total: O(n log² n).

The proof relies on a "3-smooth" property: any inversion is fixed within O(log² n) passes because the gap sequence covers every meaningful distance.

**Trade-off:** Pratt's sequence has the **best provable bound** but **most passes** in practice (~log² n vs. ~log n for Knuth/Hibbard), so the constant factor is high. It's almost never the fastest in benchmarks.

### Why Ciura's Empirical Sequence Wins in Practice

Ciura ran exhaustive Monte-Carlo benchmarks over millions of random inputs of various sizes and **searched** for the gap sequence that minimized average runtime. The result: `1, 4, 10, 23, 57, 132, 301, 701, ...`.

No proof of asymptotic complexity exists. The sequence is "magic" — it just empirically beats every closed-form sequence on n ≤ a few million. Conjectured: between O(n^(5/4)) and O(n^(4/3)).

For n > 701, extrapolate with `g_{k+1} = ⌊2.25 · g_k⌋`.

---

## Gap Sequence Deep Dive

| Sequence | Generator | Asymptotic | Pass count | Notes |
|----------|-----------|-----------|-----------|-------|
| Shell `n/2` | `g = n/2`; halve | **O(n²)** | log₂ n | Avoid; only educational |
| Hibbard | `2^k − 1` | **O(n^(3/2))** | ~log₂ n | Coprime gaps mix odd/even |
| Knuth `(3^k−1)/2` | `g = 3g + 1` | ~O(n^(3/2)) practical | ~log₃ n | Simple, decent, widely used |
| Sedgewick (1986) | Mixed two formulas | **O(n^(4/3))** | ~log₂ n | Best closed-form among proven |
| Pratt | All `2^a · 3^b` ≤ n | **O(n log² n)** | O(log² n) | Best proven bound; many passes |
| Ciura | Empirical: 1,4,10,23,57,132,301,701 + ×2.25 extension | unproven (~O(n^(5/4))) | O(log_{2.25} n) | Fastest in practice |

### Choosing a Sequence in Production

```mermaid
graph TD
    A[Need Shell Sort?] --> B{n known?}
    B -->|n ≤ 10^4| C[Ciura — fastest]
    B -->|n unknown, embedded| D[Knuth — simple closed form]
    B -->|need proof| E[Pratt — provable n log² n]
    B -->|need O(n^4/3) guarantee| F[Sedgewick]
    C --> G[Done]
    D --> G
    E --> G
    F --> G
```

### Adversarial Inputs

Each sequence has worst-case inputs:

| Sequence | Adversarial input shape | Resulting time |
|----------|------------------------|---------------|
| Shell n/2 | Interleaved small/large at even/odd positions | O(n²) |
| Hibbard | Specific permutations exploiting coprimality | O(n^(3/2)) |
| Pratt | None known better than O(n log² n) | O(n log² n) |
| Ciura | Random and adversarial both fast; no known bad case below threshold | empirical |

---

## Comparison with Alternatives

| Attribute | Shell Sort | Insertion Sort | Merge Sort | Quick Sort | Heap Sort |
|-----------|------------|----------------|------------|-----------|-----------|
| Time (best) | O(n log n) | **O(n)** | O(n log n) | O(n log n) | O(n log n) |
| Time (avg) | O(n^(4/3))–O(n^(3/2)) | O(n²) | **O(n log n)** | **O(n log n)** | O(n log n) |
| Time (worst) | O(n^(3/2))–O(n log² n) depending on gaps | O(n²) | **O(n log n)** | O(n²) | **O(n log n)** |
| Space | **O(1)** | **O(1)** | O(n) | O(log n) stack | **O(1)** |
| Stable | No | **Yes** | **Yes** | No | No |
| Adaptive | Yes | Yes | No | Partial | No |
| In-place | **Yes** | **Yes** | No (array) | **Yes** | **Yes** |
| Recursive | No | No | Yes | Yes | No |
| Cache-friendly | Mostly (small gaps) | **Yes** | No | Mostly | No (heap structure) |
| Code size | **Tiny** | **Tiniest** | Medium | Medium | Medium |

**Choose Shell Sort when:**

- You need **in-place + no recursion + small code size** (embedded, firmware, kernel).
- n is **medium** (a few hundred to a few thousand).
- Stability is **not** required.

**Choose Insertion Sort when:**

- n is **very small** (≤ 32) — Shell Sort's outer loop overhead doesn't pay off.
- Data is **nearly sorted** — insertion sort is already O(n) there.

**Choose Merge Sort when:**

- Stability is required.
- Worst-case guarantee matters more than speed.
- Memory is available.

**Choose Quick Sort when:**

- Large n (n > 10^5) and stability not needed.
- Cache locality matters.

---

## Advanced Patterns

### Pattern: Hybrid — Shell Sort + Insertion Sort Switch

For very small subsequences within a pass (length ≤ 8 or so), the pass is just plain insertion sort regardless of gap. Skipping the gap loop overhead for small `n / g` saves time.

#### Go

```go
func ShellHybrid(arr []int) {
    n := len(arr)
    for gap := n / 2; gap > 0; gap /= 2 {
        if gap == 1 || n/gap <= 8 {
            // Small subsequences: plain insertion sort with this gap
            for i := gap; i < n; i++ {
                x := arr[i]
                j := i
                for j >= gap && arr[j-gap] > x {
                    arr[j] = arr[j-gap]
                    j -= gap
                }
                arr[j] = x
            }
        } else {
            // Larger subsequences: same kernel, branch hint stays warm
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
}
```

#### Java

```java
public class ShellHybrid {
    public static void sort(int[] arr) {
        int n = arr.length;
        for (int gap = n / 2; gap > 0; gap /= 2) {
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
}
```

#### Python

```python
def shell_hybrid(arr):
    n = len(arr)
    gap = n // 2
    while gap > 0:
        for i in range(gap, n):
            x = arr[i]
            j = i
            while j >= gap and arr[j - gap] > x:
                arr[j] = arr[j - gap]
                j -= gap
            arr[j] = x
        gap //= 2
```

### Pattern: Configurable Gap Sequence Driver

#### Go

```go
type GapSequence func(n int) []int

func ShellGeneric(arr []int, seq GapSequence) {
    n := len(arr)
    for _, gap := range seq(n) {
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

func KnuthGaps(n int) []int {
    out := []int{}
    g := 1
    for g < n {
        out = append([]int{g}, out...) // prepend for descending order
        g = 3*g + 1
    }
    return out
}

func CiuraGapsFn(n int) []int {
    base := []int{701, 301, 132, 57, 23, 10, 4, 1}
    // Extend upward for large n
    out := []int{}
    g := base[0]
    for g < n {
        out = append([]int{g}, out...)
        g = int(float64(g) * 2.25)
    }
    return append(out, base...)
}
```

#### Java

```java
import java.util.*;
import java.util.function.IntFunction;

public class ShellGeneric {
    public static void sort(int[] arr, IntFunction<int[]> seq) {
        int n = arr.length;
        for (int gap : seq.apply(n)) {
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

    public static int[] knuthGaps(int n) {
        List<Integer> out = new ArrayList<>();
        int g = 1;
        while (g < n) { out.add(0, g); g = 3 * g + 1; }
        return out.stream().mapToInt(Integer::intValue).toArray();
    }
}
```

#### Python

```python
def shell_generic(arr, sequence_fn):
    n = len(arr)
    for gap in sequence_fn(n):
        if gap >= n:
            continue
        for i in range(gap, n):
            x = arr[i]
            j = i
            while j >= gap and arr[j - gap] > x:
                arr[j] = arr[j - gap]
                j -= gap
            arr[j] = x

def knuth_gaps(n):
    out = []
    g = 1
    while g < n:
        out.insert(0, g)
        g = 3 * g + 1
    return out

def ciura_gaps(n):
    base = [701, 301, 132, 57, 23, 10, 4, 1]
    out = []
    g = base[0]
    while g < n:
        out.insert(0, g)
        g = int(g * 2.25)
    return out + base
```

### Pattern: Counting Operations for Empirical Analysis

Wrap comparisons and shifts in counters; plot against n on a log-log scale to estimate the empirical exponent.

```python
class Counter:
    def __init__(self):
        self.compares = 0
        self.shifts = 0

def shell_count(arr, gaps):
    c = Counter()
    n = len(arr)
    for gap in gaps:
        for i in range(gap, n):
            x = arr[i]
            j = i
            while j >= gap:
                c.compares += 1
                if arr[j - gap] > x:
                    arr[j] = arr[j - gap]; c.shifts += 1
                    j -= gap
                else:
                    break
            arr[j] = x
    return c
```

---

## Benchmark Methodology

To meaningfully compare Shell Sort variants:

1. Run on **multiple input shapes**: random, sorted, reverse-sorted, partially sorted (95% sorted), many duplicates.
2. Run on **multiple sizes**: n ∈ {10³, 10⁴, 10⁵, 10⁶}.
3. **Warm up** the JIT (Java) / type cache (Python) with 100 throwaway iterations.
4. **Take the median** of 50 runs to filter GC noise.
5. **Clone the input** before each run — sorting is destructive.

A representative result on random integers (numbers approximate, depend on hardware):

| n | Shell (n/2) | Hibbard | Knuth | Ciura | Quick Sort |
|---|-------------|---------|-------|-------|------------|
| 1,000 | 0.7 ms | 0.45 ms | 0.4 ms | **0.30 ms** | 0.15 ms |
| 10,000 | 9.5 ms | 6.5 ms | 5.5 ms | **4.0 ms** | 1.5 ms |
| 100,000 | 220 ms | 130 ms | 95 ms | **65 ms** | 15 ms |
| 1,000,000 | 5400 ms | 2800 ms | 1900 ms | **1300 ms** | 180 ms |

Takeaway: Ciura > Knuth > Hibbard > Shell; Quick Sort dominates all of them at large n.

---

## Code Examples

### Full Implementation: Shell Sort with All Three Sequences

#### Go

```go
package main

import "fmt"

func shellPass(arr []int, gap int) {
    n := len(arr)
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

func ShellOriginal(arr []int) {
    for gap := len(arr) / 2; gap > 0; gap /= 2 {
        shellPass(arr, gap)
    }
}

func ShellKnuth(arr []int) {
    n := len(arr)
    gap := 1
    for gap < n/3 { gap = 3*gap + 1 }
    for ; gap > 0; gap = (gap - 1) / 3 {
        shellPass(arr, gap)
    }
}

var ciuraGaps = []int{701, 301, 132, 57, 23, 10, 4, 1}

func ShellCiura(arr []int) {
    n := len(arr)
    for _, gap := range ciuraGaps {
        if gap < n {
            shellPass(arr, gap)
        }
    }
}

func main() {
    data := []int{12, 34, 54, 2, 3, 1, 7, 19, 8, 25, 11, 4, 100, 50, 70}
    ShellCiura(data)
    fmt.Println(data)
}
```

#### Java

```java
import java.util.Arrays;

public class ShellSortAll {
    static void shellPass(int[] arr, int gap) {
        for (int i = gap; i < arr.length; i++) {
            int x = arr[i];
            int j = i;
            while (j >= gap && arr[j - gap] > x) {
                arr[j] = arr[j - gap];
                j -= gap;
            }
            arr[j] = x;
        }
    }

    public static void shellOriginal(int[] arr) {
        for (int gap = arr.length / 2; gap > 0; gap /= 2) shellPass(arr, gap);
    }

    public static void shellKnuth(int[] arr) {
        int n = arr.length, gap = 1;
        while (gap < n / 3) gap = 3 * gap + 1;
        for (; gap > 0; gap = (gap - 1) / 3) shellPass(arr, gap);
    }

    private static final int[] CIURA = {701, 301, 132, 57, 23, 10, 4, 1};

    public static void shellCiura(int[] arr) {
        for (int gap : CIURA) if (gap < arr.length) shellPass(arr, gap);
    }

    public static void main(String[] args) {
        int[] data = {12, 34, 54, 2, 3, 1, 7, 19, 8, 25, 11, 4, 100, 50, 70};
        shellCiura(data);
        System.out.println(Arrays.toString(data));
    }
}
```

#### Python

```python
def shell_pass(arr, gap):
    n = len(arr)
    for i in range(gap, n):
        x = arr[i]
        j = i
        while j >= gap and arr[j - gap] > x:
            arr[j] = arr[j - gap]
            j -= gap
        arr[j] = x

def shell_original(arr):
    gap = len(arr) // 2
    while gap > 0:
        shell_pass(arr, gap)
        gap //= 2

def shell_knuth(arr):
    n = len(arr)
    gap = 1
    while gap < n // 3:
        gap = 3 * gap + 1
    while gap > 0:
        shell_pass(arr, gap)
        gap = (gap - 1) // 3

CIURA_GAPS = [701, 301, 132, 57, 23, 10, 4, 1]

def shell_ciura(arr):
    n = len(arr)
    for gap in CIURA_GAPS:
        if gap < n:
            shell_pass(arr, gap)

if __name__ == "__main__":
    data = [12, 34, 54, 2, 3, 1, 7, 19, 8, 25, 11, 4, 100, 50, 70]
    shell_ciura(data)
    print(data)
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|----------------|------------------|
| Gap never reaches 1 | Final pass missing → only partially sorted | Ensure formula terminates at exactly 1; assert in tests |
| Gap stays ≥ n forever | All passes skipped → unsorted output | Always include `gap = 1` in sequence |
| Integer overflow in `g = 3g + 1` | UB / wrong index on 32-bit | Use 64-bit indices for huge arrays |
| Negative gap (signed overflow) | Inner loop goes wild | Validate sequence before use |
| Empty array | Some sequences compute `g = n/2 = 0` and exit early | Test with `[]` explicitly |
| Concurrent mutation | Race conditions | Shell Sort is single-threaded; clone before sharing |

---

## Performance Analysis

### Empirical Comparison Across Languages

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func benchmark(fn func([]int), name string, n int) {
    rand.Seed(42)
    data := make([]int, n)
    for i := range data { data[i] = rand.Intn(n) }
    runs := 20
    start := time.Now()
    for i := 0; i < runs; i++ {
        tmp := append([]int{}, data...)
        fn(tmp)
    }
    elapsed := time.Since(start)
    fmt.Printf("%-15s n=%6d : %.2f ms/run\n", name, n, float64(elapsed.Milliseconds())/float64(runs))
}
```

#### Java

```java
import java.util.Random;

public class ShellBench {
    public static void benchmark(java.util.function.Consumer<int[]> fn, String name, int n) {
        Random rng = new Random(42);
        int[] data = new int[n];
        for (int i = 0; i < n; i++) data[i] = rng.nextInt(n);
        int runs = 20;
        long start = System.nanoTime();
        for (int i = 0; i < runs; i++) fn.accept(data.clone());
        long elapsed = System.nanoTime() - start;
        System.out.printf("%-15s n=%6d : %.2f ms/run%n", name, n, elapsed / runs / 1_000_000.0);
    }
}
```

#### Python

```python
import random
import time

def benchmark(fn, name, n):
    random.seed(42)
    data = [random.randint(0, n) for _ in range(n)]
    runs = 20
    start = time.perf_counter()
    for _ in range(runs):
        tmp = data.copy()
        fn(tmp)
    elapsed = time.perf_counter() - start
    print(f"{name:<15} n={n:>6} : {elapsed / runs * 1000:.2f} ms/run")
```

### Theoretical Bounds Recap

| Sequence | Proven worst | Average (empirical) |
|----------|-------------|--------------------|
| Shell n/2 | O(n²) | ~O(n^(3/2)) |
| Hibbard | O(n^(3/2)) | O(n^(5/4)) |
| Knuth | unproven | ~O(n^(5/4)) |
| Sedgewick | O(n^(4/3)) | O(n^(7/6)) |
| Pratt | O(n log² n) | O(n log² n) |
| Ciura | unproven | empirically the best |

---

## Best Practices

- Pick **Ciura** for max speed, **Knuth** for simple production code, **Pratt** when you must prove the bound.
- Always **terminate the gap sequence at 1**. Make this part of your unit tests.
- For **embedded code**, hardcode the gap array as a `const int[]` — avoids runtime computation.
- For **kernel / interrupt context**, profile carefully — stack and code size budgets are tight.
- **Document why Shell Sort and not Merge/Quick.** A future maintainer will ask.
- Add a **`debug_assert!` / `assert`** that the input is sorted after the final pass during development. Remove for production hot paths.
- **Do not** use Shell Sort when stability matters; switch to TimSort or Merge Sort.

---

## Visual Animation

> See [`animation.html`](./animation.html) for interactive visualization.
>
> Middle-level animation includes:
> - Color-coded **subsequences** for the current gap, each in a distinct hue.
> - Live highlighting of the gapped-insertion kernel (shift / insert).
> - Pass counter, current gap, and operation counters (comparisons, shifts).
> - Drop-down to switch gap sequence (Shell, Knuth, Ciura) and watch the resulting pass count change.
> - "Adversarial input" button to see how Shell's original sequence degrades to O(n²) on interleaved input.

---

## Summary

At the middle level, Shell Sort becomes a study in **how the gap sequence drives complexity**:

- The algorithm preserves `h`-sorted invariants across passes, so later passes do less work.
- Shell's original `n/2, n/4, ...` is **O(n²)** worst-case because even/odd indices never mix until `g = 1`.
- Hibbard's `2^k − 1` gives **O(n^(3/2))** by using coprime gaps.
- Sedgewick's mixed sequence improves to **O(n^(4/3))**.
- Pratt's `2^a · 3^b` gives the best provable **O(n log² n)** at the cost of many passes.
- Ciura's empirically tuned sequence is the **fastest in practice** despite no proven bound.

**When to choose Shell Sort:** in-place, no-recursion, medium n, stability not required, code-size matters. Otherwise reach for Quick Sort / Merge Sort / TimSort.

The next level — [`senior.md`](./senior.md) — explores Shell Sort's role in embedded firmware, kernel context, cache behavior, and modern relevance.
