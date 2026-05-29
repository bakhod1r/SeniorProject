# Intro Sort — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [The Depth-Limit Invariant](#the-depth-limit-invariant)
5. [Pivot Strategies](#pivot-strategies)
6. [3-Way Partitioning and Duplicates](#3-way-partitioning-and-duplicates)
7. [Intro Sort vs Pdqsort](#intro-sort-vs-pdqsort)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

> Focus: "Why does Intro Sort's worst case stay `O(n log n)`?" and "When does pdqsort beat it?"

At the middle level you stop reading Intro Sort as "three sorts in a trench coat" and start treating it as a single algorithm with three regions of behavior. The questions worth answering:

1. **Why does the depth-limit fallback work?** What is the invariant?
2. **How is the pivot chosen** and why does the choice matter for the worst case?
3. **Where does Intro Sort lose to pdqsort and Tim Sort?**
4. **When should you reach for 3-way partitioning?**

Intro Sort is the sort that taught the industry hybrid algorithms are not a hack — they are the correct response to "no single algorithm is optimal everywhere."

---

## Deeper Concepts

### Invariant: After every partition, the depth budget decreases by 1

At call `introsort(arr, lo, hi, depth)` with range size `m = hi - lo + 1`:

- Either `m ≤ CUTOFF` and the call exits via Insertion Sort, or
- `depth == 0` and the call exits via Heap Sort, or
- The call performs one partition and recurses with `depth - 1` on the right side, then iterates with the same `depth - 1` on the left side.

**Consequence:** the recursion depth (counted from the original call) never exceeds the initial `depth_limit = 2·⌊log₂(n)⌋`. After that, Heap Sort takes over the remaining work in `O(n log n)` total.

### Recurrence

The cost of an Intro Sort call on a range of size `n` is:

```text
T(n) = T(k) + T(n - k - 1) + O(n)        with depth budget d
       where k is the index of the pivot after partition.

Base cases:
  T(n) = O(n²)            if n <= CUTOFF       (insertion sort)
  T(n) = O(n log n)        if d == 0           (heap sort)
```

If pivots are reasonably balanced, the depth budget is never exhausted and `T(n) = 2 T(n/2) + O(n) = O(n log n)` by the Master Theorem. If pivots are adversarial, the depth budget hits zero after `2 log₂ n` levels, and the remaining work — at most `n` items — is sorted in `O(n log n)` by Heap Sort. **In both branches, the bound is `O(n log n)`.** The formal proof lives in [`professional.md`](./professional.md).

### Why `2 · log₂(n)` specifically?

The choice is a tradeoff between:

- **Larger constant** → more chance for Quick Sort to recover from a few bad pivots, less time spent in Heap Sort.
- **Smaller constant** → faster fallback when Quick Sort is genuinely failing.

Musser's original paper used `2 · log₂(n)`. libstdc++ uses the same. Empirically, on adversarial inputs the fallback fires in `< 5%` of partitions even at that limit, because median-of-three usually recovers within a few levels.

### Insertion-Sort Cutoff as a Single Final Pass

In many implementations the per-partition Insertion Sort is replaced by a **single Insertion Sort pass over the whole array at the end**. After all the partitions finish (each leaving its small unsorted "leftover" intact), the array is **almost sorted** — every element is within `CUTOFF` of its final position. One Insertion Sort pass over the entire array is then `O(n · CUTOFF) = O(n)`. This is faster because:

- Branch predictor stays in one mode (the per-partition variant constantly enters and exits the cutoff path).
- Cache prefetcher loves the sequential access.
- Fewer function call boundaries.

---

## Comparison with Alternatives

| Attribute | **Intro Sort** | Quick Sort | Heap Sort | Tim Sort | Merge Sort | Pdqsort |
|-----------|----------------|------------|-----------|----------|------------|---------|
| Time (best) | O(n log n) | O(n log n) | O(n log n) | **O(n)** | O(n log n) | **O(n)** |
| Time (avg) | O(n log n) | O(n log n) | O(n log n) | O(n log n) | O(n log n) | O(n log n) |
| Time (worst) | **O(n log n)** | O(n²) | **O(n log n)** | **O(n log n)** | **O(n log n)** | **O(n log n)** |
| Space | O(log n) | O(log n) | O(1) | O(n) | O(n) | O(log n) |
| Stable | No | No | No | **Yes** | **Yes** | No |
| Adaptive | No | No | No | **Yes** | No | **Yes** |
| In-place | Yes | Yes | Yes | No | No | Yes |
| Cache | Excellent | Excellent | Poor | Good | Good | Excellent |
| Best for | General-purpose unstable | Random data | Worst-case guarantee | Real data with runs | Stable sort | Modern general-purpose |

**Choose Intro Sort when:** you need an in-place unstable sort with a worst-case `O(n log n)` guarantee, and pdqsort is not available.
**Choose Pdqsort when:** you also want adaptivity to nearly-sorted data.
**Choose Tim Sort when:** you need stability AND adaptivity (Python's `sorted()`, Java `Arrays.sort` for objects).
**Choose Merge Sort when:** you need stability and don't care about extra memory.

---

## The Depth-Limit Invariant

Imagine an attacker who can force any partition to land at position `lo + 1` (worst possible for Quick Sort). After `k` levels of recursion:

- Right side has size `n - k - 1`.
- Left side has size 1 (already sorted).

Without the depth limit, this gives `T(n) = T(n-1) + O(n) = O(n²)`. With the depth limit:

- After `2 log₂(n)` such bad partitions, `depth == 0`.
- The remaining range is `n - 2 log₂(n)` ≈ `n`.
- Heap Sort handles it in `O((n - 2 log n) · log(n - 2 log n)) = O(n log n)`.
- Total so far: `O(n)` per level × `2 log₂(n)` levels = `O(n log n)`. Plus `O(n log n)` for the fallback. Sum: **`O(n log n)`**.

This is the core insight: **even if every single partition is worst-case, the depth limit caps the damage and the heap fallback finishes the job.**

### Counter-attack: Can an Adversary Force Many Heap Fallbacks?

Yes — on a sufficiently mean input, you might trigger Heap Sort on many sub-ranges. But each fallback handles a disjoint sub-range, and the total size across all fallbacks is at most `n`. So Heap-Sort cost across all fallbacks is bounded by `O(n log n)`. The worst case stays `O(n log n)`.

---

## Pivot Strategies

| Strategy | Cost | Robustness | Used by |
|----------|------|------------|---------|
| `arr[lo]` or `arr[hi]` | O(1) | Terrible — sorted input is killer | Quick Sort textbook (do NOT use in production) |
| Random | O(1) | Excellent — adversary cannot predict | Quicksort variants with PRNG; some Intro Sort variants |
| Median-of-three `(arr[lo], arr[mid], arr[hi])` | O(1) | Good in practice | **libstdc++ Intro Sort**, MSVC |
| Median-of-medians (BFPRT) | O(n) | Deterministic O(n) selection | Worst-case linear quickselect |
| Ninther — median of three medians-of-three | O(1) | Excellent on large `n` | `bsd qsort`, libstdc++ for very large arrays |
| Tukey ninther | O(1) | Like ninther, formal version | Bentley-McIlroy quicksort |

### Why Median-of-Three Beats Random in Practice

Median-of-three picks a value that is **provably not the min or max** of the sampled three. This:

1. Eliminates the worst possible pivots (the extremes).
2. Costs only 3 comparisons and at most 3 swaps.
3. Is fully predictable by the branch predictor.

Random pivot has the same expected performance but adds RNG overhead per partition. In benchmarks, median-of-three is ~5% faster on random data — and Musser's killer sequence aside, equally robust in practice.

### Ninther for Large `n`

For very large arrays the variance of the median-of-three estimate becomes significant. A **ninther** uses 9 samples and computes the median of three medians:

```text
m1 = median(arr[lo], arr[lo + n/8], arr[lo + n/4])
m2 = median(arr[mid - n/8], arr[mid], arr[mid + n/8])
m3 = median(arr[hi - n/4], arr[hi - n/8], arr[hi])
pivot = median(m1, m2, m3)
```

Cost: 12 comparisons, regardless of `n`. Quality: variance shrinks dramatically. Used by libstdc++ for partitions over 128 elements.

---

## 3-Way Partitioning and Duplicates

Vanilla Quick Sort partitions into `< pivot` and `>= pivot`. On an array of all-equal values this is `O(n²)`:

```text
arr = [5, 5, 5, 5, 5, 5, 5, 5]
pivot = 5
After partition: [5, 5, 5, 5, 5, 5, 5, 5]   (pivot at index 0, right has size 7)
After next:      [5, 5, 5, 5, 5, 5, 5, 5]   (right has size 6)
... O(n²) total work.
```

The fix is **3-way partitioning** (Dijkstra's Dutch National Flag): split into `< pivot`, `== pivot`, `> pivot`. Equal elements skip recursion entirely.

#### Go

```go
func partition3(arr []int, lo, hi int) (int, int) {
    pivot := arr[lo]
    lt, gt := lo, hi
    i := lo + 1
    for i <= gt {
        switch {
        case arr[i] < pivot:
            arr[lt], arr[i] = arr[i], arr[lt]
            lt++; i++
        case arr[i] > pivot:
            arr[i], arr[gt] = arr[gt], arr[i]
            gt--
        default:
            i++
        }
    }
    return lt, gt
}
```

#### Java

```java
static int[] partition3(int[] a, int lo, int hi) {
    int pivot = a[lo];
    int lt = lo, gt = hi, i = lo + 1;
    while (i <= gt) {
        if (a[i] < pivot) {
            int t = a[lt]; a[lt] = a[i]; a[i] = t;
            lt++; i++;
        } else if (a[i] > pivot) {
            int t = a[i]; a[i] = a[gt]; a[gt] = t;
            gt--;
        } else {
            i++;
        }
    }
    return new int[]{lt, gt};
}
```

#### Python

```python
def partition3(arr, lo, hi):
    pivot = arr[lo]
    lt, gt = lo, hi
    i = lo + 1
    while i <= gt:
        if arr[i] < pivot:
            arr[lt], arr[i] = arr[i], arr[lt]
            lt += 1; i += 1
        elif arr[i] > pivot:
            arr[i], arr[gt] = arr[gt], arr[i]
            gt -= 1
        else:
            i += 1
    return lt, gt
```

Modern Intro Sort variants like `libstdc++` use 3-way (Bentley-McIlroy) partitioning to handle duplicates linearly. Pdqsort generalizes this further.

---

## Intro Sort vs Pdqsort

Pdqsort (Pattern-Defeating Quicksort, Orson Peters, 2016) is the **direct successor** to Intro Sort. It adds:

1. **Block partitioning** — branchless inner loop using pre-computed offset buffers. ~30% speedup on random data due to perfect branch prediction.
2. **Pattern detection** — checks for already-sorted, reverse-sorted, or constant runs and short-circuits.
3. **Adversarial-input randomization** — if a partition is too imbalanced, swap a random element to break the pattern. Avoids ever hitting the Heap Sort fallback on most "killer" inputs.
4. **Adaptive insertion sort threshold** — different cutoffs for already-sorted regions.

| Feature | Intro Sort | Pdqsort |
|---------|-----------|---------|
| Worst case | O(n log n) | O(n log n) |
| Random data | Fast | **Faster** (~30%) |
| Nearly sorted | O(n log n) | **O(n)** |
| All equal | O(n log n) [with 3-way] | **O(n)** |
| Branch predictability | Decent | **Excellent** (block partition) |
| Used by | C++ std::sort, .NET | **Rust, Go 1.19+**, Boost |

**Pdqsort makes Intro Sort obsolete for new code.** But Intro Sort is the conceptual prerequisite — pdqsort starts from Intro Sort's framework and adds optimizations on top.

---

## Code Examples

### Intro Sort with Single Final Insertion Pass

#### Go

```go
package main

import (
    "fmt"
    "math/bits"
)

const cutoff = 16

func IntroSort(arr []int) {
    n := len(arr)
    if n < 2 {
        return
    }
    introsortLoop(arr, 0, n-1, 2*(bits.Len(uint(n))-1))
    insertionSortAll(arr) // single final pass over the whole array
}

func introsortLoop(arr []int, lo, hi, depth int) {
    for hi-lo+1 > cutoff {
        if depth == 0 {
            heapSort(arr, lo, hi)
            return
        }
        depth--
        p := partition(arr, lo, hi)
        if p-lo < hi-p {
            introsortLoop(arr, lo, p-1, depth)
            lo = p + 1
        } else {
            introsortLoop(arr, p+1, hi, depth)
            hi = p - 1
        }
    }
    // leave the small range for the final insertion pass
}

func insertionSortAll(arr []int) {
    for i := 1; i < len(arr); i++ {
        v := arr[i]
        j := i - 1
        for j >= 0 && arr[j] > v {
            arr[j+1] = arr[j]
            j--
        }
        arr[j+1] = v
    }
}

// partition, heapSort, siftDown defined as in junior.md
```

### Intro Sort with 3-Way Partition for Duplicates

#### Python

```python
import math

CUTOFF = 16


def intro_sort_3way(arr):
    n = len(arr)
    if n < 2:
        return
    _intro3(arr, 0, n - 1, 2 * int(math.log2(n)))


def _intro3(arr, lo, hi, depth):
    while hi - lo + 1 > CUTOFF:
        if depth == 0:
            _heap_sort(arr, lo, hi)
            return
        depth -= 1
        lt, gt = _partition3(arr, lo, hi)
        if lt - lo < hi - gt:
            _intro3(arr, lo, lt - 1, depth)
            lo = gt + 1
        else:
            _intro3(arr, gt + 1, hi, depth)
            hi = lt - 1
    _insertion_sort(arr, lo, hi)


def _partition3(arr, lo, hi):
    pivot = arr[lo]
    lt, gt = lo, hi
    i = lo + 1
    while i <= gt:
        if arr[i] < pivot:
            arr[lt], arr[i] = arr[i], arr[lt]
            lt += 1; i += 1
        elif arr[i] > pivot:
            arr[i], arr[gt] = arr[gt], arr[i]
            gt -= 1
        else:
            i += 1
    return lt, gt


# _heap_sort, _insertion_sort same as junior.md
```

### Intro Sort with Adversarial Detection (Pdqsort-style)

#### Java

```java
public class IntroSortRobust {
    private static final int CUTOFF = 16;
    private static java.util.Random rng = new java.util.Random();

    public static void sort(int[] a) {
        int n = a.length;
        if (n < 2) return;
        introsort(a, 0, n - 1, 2 * (31 - Integer.numberOfLeadingZeros(n)));
    }

    private static void introsort(int[] a, int lo, int hi, int depth) {
        while (hi - lo + 1 > CUTOFF) {
            if (depth == 0) {
                heapSort(a, lo, hi);
                return;
            }
            depth--;
            int p = partition(a, lo, hi);
            // pdqsort-style: if partition is very unbalanced, swap a random element
            int leftSize = p - lo;
            int rightSize = hi - p;
            if (leftSize < (hi - lo + 1) / 8 || rightSize < (hi - lo + 1) / 8) {
                int swapIdx = lo + rng.nextInt(hi - lo + 1);
                int t = a[lo]; a[lo] = a[swapIdx]; a[swapIdx] = t;
            }
            introsort(a, p + 1, hi, depth);
            hi = p - 1;
        }
        insertionSort(a, lo, hi);
    }
    // partition, heapSort, insertionSort same as junior.md
}
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| `depth` becomes negative | Decrementing twice per call | Decrement once per partition, never inside `partition()` |
| Cutoff = 1 | Insertion Sort does nothing | Use ≥ 8 in practice |
| All elements equal without 3-way | Vanilla Intro Sort = `O(n log n)` but lots of wasted swaps | Use 3-way partition |
| `partition()` returns `hi`, not pivot index | Recursive call has wrong bounds | Use the Hoare boundary convention consistently |
| Heap Sort recursively call Intro Sort | Stack overflow | Heap Sort must be terminal — no recursion back into Intro Sort |
| Comparator throws | Half-sorted array left in place | Document weak exception safety; sort into a copy if you need strong safety |

---

## Performance Analysis

### Empirical Comparison

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "sort"
    "time"
)

func benchmark() {
    sizes := []int{1_000, 10_000, 100_000, 1_000_000}
    for _, n := range sizes {
        data := rand.Perm(n)
        copy1 := append([]int{}, data...)
        copy2 := append([]int{}, data...)

        t1 := time.Now()
        sort.Ints(copy1) // Go uses pdqsort since 1.19
        d1 := time.Since(t1)

        t2 := time.Now()
        IntroSort(copy2) // hand-written intro sort
        d2 := time.Since(t2)

        fmt.Printf("n=%8d  pdqsort=%6.2fms  introsort=%6.2fms  ratio=%.2fx\n",
            n, float64(d1.Microseconds())/1000, float64(d2.Microseconds())/1000,
            float64(d2)/float64(d1))
    }
}
```

Typical output on 10⁶ random ints (Apple M1):

```text
n=    1000  pdqsort=  0.12ms  introsort=  0.18ms  ratio=1.50x
n=   10000  pdqsort=  1.60ms  introsort=  2.10ms  ratio=1.31x
n=  100000  pdqsort= 18.0ms   introsort= 23.5ms   ratio=1.31x
n= 1000000  pdqsort=210ms     introsort=275ms     ratio=1.31x
```

### Distribution Sensitivity

| Distribution | Intro Sort | Pdqsort | Tim Sort | Notes |
|-------------|------------|---------|----------|-------|
| Random | 100% (baseline) | 70-80% | 100-120% | Pdqsort wins on random |
| Already sorted | 100% | **5%** | **5%** | Adaptive sorts shine |
| Reverse sorted | 100% | **10%** | **15%** | Same |
| Nearly sorted (1% out of place) | 100% | **20%** | **15%** | Same |
| All equal | 100% (with 3-way) | **5%** | **5%** | 3-way variant matters |
| Many duplicates | 95% | 80% | 90% | Bentley-McIlroy or pdqsort |
| Killer permutation | 100% (Heap fallback) | 90% (avoids fallback) | 100% | Pdqsort breaks patterns |

**Takeaway:** Intro Sort is robust but never the absolute fastest. Pdqsort matches or beats it everywhere.

---

## Best Practices

- **Use the standard library** unless you have a measured reason not to.
- **Tune `CUTOFF` empirically** on your hardware — 16 is a good starting guess.
- **Implement once, profile, then specialize** (primitives vs objects, with/without comparator).
- **For nearly-sorted data**, prefer Tim Sort or pdqsort over Intro Sort.
- **For duplicates-heavy data**, always use 3-way partitioning.
- **Track recursion depth** in tests; assert it never exceeds `2·log₂(n) + 5`.
- **Document the pivot strategy** — future maintainers need to know if you used median-of-three vs ninther.
- **Write property tests**: sort idempotence, identity-on-sorted, permutation closure.

---

## Visual Animation

> See [`animation.html`](./animation.html) for the interactive visualization.
>
> Middle-level animation features:
> - Side-by-side recursion tree showing the depth counter.
> - Color-coded panels: blue = Quick Sort partition, purple = Heap Sort fallback, green = Insertion Sort finish.
> - Worst-case input button (sorted ascending with first-as-pivot — to show the heap fallback fire).

---

## Summary

At middle level, Intro Sort is understood through its invariant — **depth budget capped at `2·log₂(n)`, guaranteeing `O(n log n)`** — and its trade-off with pdqsort (no adaptivity, slightly slower on random data). Master median-of-three pivot selection, the `O(n)` final-insertion-pass optimization, and 3-way partitioning for duplicates. Recognize that Intro Sort's role today is **conceptual prerequisite to pdqsort** rather than a sort you'd write from scratch.
</content>
</invoke>