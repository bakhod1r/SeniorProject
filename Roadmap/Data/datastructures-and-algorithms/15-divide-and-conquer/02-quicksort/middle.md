# Quicksort (Divide and Conquer by Partitioning) — Middle Level

> **Focus:** The two classic partition schemes (Lomuto vs Hoare) and why they differ, the full menu of pivot-selection strategies, three-way partitioning for duplicate-heavy data, quickselect for order statistics, tail-call elimination to bound stack depth, and a head-to-head comparison with merge sort.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Advanced Patterns](#advanced-patterns)
5. [Three-Way Partitioning (Dutch National Flag)](#three-way-partitioning-dutch-national-flag)
6. [Quickselect: k-th Order Statistic](#quickselect-k-th-order-statistic)
7. [Code Examples](#code-examples)
8. [Error Handling](#error-handling)
9. [Performance Analysis](#performance-analysis)
10. [Best Practices](#best-practices)
11. [Visual Animation](#visual-animation)
12. [Summary](#summary)

---

## Introduction

At junior level the message was a single idea: partition around a pivot, recurse on both sides, no merge. At middle level you confront the engineering decisions that make quicksort correct *and* fast in practice:

- There are two famous partition schemes — **Lomuto** and **Hoare**. They behave differently on duplicates and do different numbers of swaps. Which one, and why?
- Pivot selection is the whole ballgame. First, last, random, median-of-three, median-of-medians — what are the trade-offs?
- When the array is full of **duplicate keys**, plain quicksort degrades. The **Dutch National Flag** three-way partition fixes it. How?
- Quicksort recurses into *both* sides; **quickselect** recurses into only *one* and finds the k-th smallest in expected `O(n)`. Why does dropping one recursion drop the complexity from `n log n` to `n`?
- Bad splits make recursion `O(n)` deep. **Tail-call elimination** (recurse small side, loop large side) caps it at `O(log n)`. How?

These are the questions that separate "I can write quicksort" from "I can write a quicksort that survives sorted input, duplicate-heavy input, and a deep call stack."

---

## Deeper Concepts

### Lomuto vs Hoare partition

Both schemes rearrange a subarray around a pivot in `O(n)`, but they work differently.

**Lomuto** (single index, pivot at the end):

```
partition_lomuto(a, lo, hi):    # pivot = a[hi]
    pivot = a[hi]
    i = lo - 1
    for j = lo to hi - 1:
        if a[j] <= pivot:
            i++; swap(a[i], a[j])
    swap(a[i+1], a[hi])
    return i + 1                 # pivot's FINAL index
```

**Hoare** (two pointers moving inward, pivot at the start — the *original* 1961 scheme):

```
partition_hoare(a, lo, hi):     # pivot = a[lo]
    pivot = a[lo]
    i = lo - 1; j = hi + 1
    loop:
        do i++ while a[i] < pivot
        do j-- while a[j] > pivot
        if i >= j: return j      # a SPLIT POINT, not the pivot's index
        swap(a[i], a[j])
```

The crucial differences:

| Aspect | Lomuto | Hoare |
|--------|--------|-------|
| Pointers | one moving index `i` plus scan `j` | two pointers `i`, `j` moving toward each other |
| Pivot position | last element; ends in final sorted slot | first element; **not** placed in final slot |
| Return value | pivot's final index `p` | a split point `j`; recurse `[lo,j]` and `[j+1,hi]` |
| Swaps (typical) | more swaps | ~3× fewer swaps on average |
| Equal elements | sends `== pivot` to one side; degrades to `O(n²)` on all-equal | splits equal elements *across* both sides — stays balanced on all-equal |
| Recursion call | `(lo, p-1)`, `(p+1, hi)` | `(lo, j)`, `(j+1, hi)` — note `j`, not `j-1` |

The classic Lomuto bug: on an **all-equal** array, every element is `≤ pivot`, so `i` advances every step, the pivot lands at the far right, and you recurse on `n-1` elements — `O(n²)`. **Hoare's scheme handles all-equal arrays gracefully** because its two pointers meet in the middle, splitting equal elements evenly. This is why production code prefers Hoare (or three-way) over naive Lomuto. Lomuto's compensating virtue is that it is simpler to get right and returns the pivot's *exact* final index, which makes quickselect cleaner.

> **Watch the recursion bounds.** Hoare returns a split point `j` such that `a[lo..j] ≤ a[j+1..hi]` (loosely), so you recurse on `(lo, j)` and `(j+1, hi)` — never `(lo, j-1)`, which would drop an element and can loop. Mixing up the bounds is the #1 Hoare bug.

### Why pivot quality controls the recurrence

The running time obeys the recurrence `T(n) = T(|left|) + T(|right|) + O(n)`, where the `O(n)` is the partition pass:

- **Balanced split** (`|left| ≈ |right| ≈ n/2`): `T(n) = 2T(n/2) + O(n) = O(n log n)`.
- **Unbalanced split** (`|left| = 0`, `|right| = n-1`): `T(n) = T(n-1) + O(n) = O(n²)`.

A *constant-fraction* split — say always 90/10 — is still `O(n log n)` (just with a larger constant), because `log_{10/9} n` is still logarithmic. The worst case requires splits that are unbalanced *every single time*, which is exactly what a fixed pivot on sorted input produces and what randomization prevents.

### Tail-call elimination caps stack depth

Plain recursion on both sides can reach depth `O(n)` if the smaller side is always tiny. The fix: **recurse on the smaller partition, and loop (iterate) on the larger one.**

```
quicksort(a, lo, hi):
    while lo < hi:
        p = partition(a, lo, hi)
        if (p - lo) < (hi - p):       # left side smaller
            quicksort(a, lo, p - 1)   # recurse on the SMALL side
            lo = p + 1                # loop on the LARGE side
        else:
            quicksort(a, p + 1, hi)
            hi = p - 1
```

Because each recursive call now handles at most half the elements, the recursion depth is `O(log n)` **even in the worst case for time**. (The time can still be `O(n²)`, but the *stack* stays `O(log n)`.) This is essential for sorting large arrays without a stack overflow.

---

## Comparison with Alternatives

### Quicksort vs Merge Sort

| Property | Quicksort | Merge Sort (`01-merge-sort`) |
|----------|-----------|------------------------------|
| Average time | `O(n log n)` | `O(n log n)` |
| Worst time | `O(n²)` | `O(n log n)` **guaranteed** |
| Extra space | `O(log n)` (in place) | `O(n)` (needs a scratch array) |
| Stable? | No | **Yes** |
| Cache behavior | Excellent (sequential partition scan) | Good, but extra array hurts |
| Where work happens | the **divide** (partition) | the **combine** (merge) |
| Linked lists | awkward | natural fit |
| Typical constant factor | smaller — usually wins wall-clock | larger |

**Rule of thumb:** quicksort for in-memory arrays where speed and memory matter and stability does not; merge sort when you need stability or a worst-case guarantee, or when sorting linked lists or external (on-disk) data.

### Quicksort vs Heapsort

| Property | Quicksort | Heapsort |
|----------|-----------|----------|
| Average time | `O(n log n)` (smaller constant) | `O(n log n)` |
| Worst time | `O(n²)` | `O(n log n)` guaranteed |
| Space | `O(log n)` | `O(1)` |
| Stable? | No | No |
| Cache behavior | Excellent | Poor (jumps around the heap) |

Heapsort's guaranteed `O(n log n)` makes it the **fallback** in introsort: start with quicksort, but if recursion gets too deep (a sign of bad pivots), switch to heapsort to guarantee `O(n log n)`. (Full treatment in `senior.md`.)

### Pivot strategies compared

| Strategy | Extra cost per call | Sorted-input behavior | Worst case |
|----------|---------------------|-----------------------|------------|
| First or last element | `O(1)` | `O(n²)` — the classic trap | `O(n²)` |
| Random element | `O(1)` (one RNG call) | expected `O(n log n)` | `O(n²)` but vanishingly unlikely |
| Median-of-three | `O(1)` (3 comparisons) | `O(n log n)` on sorted/reverse | `O(n²)` on crafted "median-of-three killer" inputs |
| Ninther (median of 3 medians-of-3) | `O(1)` (more comparisons) | very robust | `O(n²)` extremely rarely |
| Median-of-medians | `O(n)` per call | guaranteed good | `O(n log n)` worst — but large constant |

**Median-of-three** picks the median of `a[lo]`, `a[mid]`, `a[hi]`. It is the practical sweet spot: nearly free, kills the sorted-input trap, and as a bonus sorting those three elements lets you skip them in the partition. **Median-of-medians** guarantees a good pivot (and `O(n log n)` worst case) but its `O(n)` overhead per call makes it slower in practice — it is mostly used to give *quickselect* a worst-case `O(n)` guarantee, not for sorting.

---

## Advanced Patterns

### Pattern: Hoare partition with correct recursion bounds

#### Go

```go
package main

import "fmt"

func hoarePartition(a []int, lo, hi int) int {
	pivot := a[lo] // pivot = first element
	i, j := lo-1, hi+1
	for {
		for {
			i++
			if a[i] >= pivot {
				break
			}
		}
		for {
			j--
			if a[j] <= pivot {
				break
			}
		}
		if i >= j {
			return j // split point
		}
		a[i], a[j] = a[j], a[i]
	}
}

func quicksortHoare(a []int, lo, hi int) {
	if lo < hi {
		p := hoarePartition(a, lo, hi)
		quicksortHoare(a, lo, p)   // note: p, NOT p-1
		quicksortHoare(a, p+1, hi)
	}
}

func main() {
	a := []int{3, 7, 8, 5, 2, 1, 9, 5, 4}
	quicksortHoare(a, 0, len(a)-1)
	fmt.Println(a) // [1 2 3 4 5 5 7 8 9]
}
```

#### Java

```java
public class HoareQuicksort {
    static int hoarePartition(int[] a, int lo, int hi) {
        int pivot = a[lo];
        int i = lo - 1, j = hi + 1;
        while (true) {
            do { i++; } while (a[i] < pivot);
            do { j--; } while (a[j] > pivot);
            if (i >= j) return j;          // split point
            int t = a[i]; a[i] = a[j]; a[j] = t;
        }
    }

    static void quicksort(int[] a, int lo, int hi) {
        if (lo < hi) {
            int p = hoarePartition(a, lo, hi);
            quicksort(a, lo, p);            // p, not p-1
            quicksort(a, p + 1, hi);
        }
    }

    public static void main(String[] args) {
        int[] a = {3, 7, 8, 5, 2, 1, 9, 5, 4};
        quicksort(a, 0, a.length - 1);
        System.out.println(java.util.Arrays.toString(a));
    }
}
```

#### Python

```python
def hoare_partition(a, lo, hi):
    pivot = a[lo]                  # pivot = first element
    i, j = lo - 1, hi + 1
    while True:
        i += 1
        while a[i] < pivot:
            i += 1
        j -= 1
        while a[j] > pivot:
            j -= 1
        if i >= j:
            return j               # split point
        a[i], a[j] = a[j], a[i]


def quicksort_hoare(a, lo, hi):
    if lo < hi:
        p = hoare_partition(a, lo, hi)
        quicksort_hoare(a, lo, p)        # p, not p-1
        quicksort_hoare(a, p + 1, hi)


if __name__ == "__main__":
    a = [3, 7, 8, 5, 2, 1, 9, 5, 4]
    quicksort_hoare(a, 0, len(a) - 1)
    print(a)
```

### Pattern: Median-of-three pivot

**Intent:** Choose the median of `a[lo]`, `a[mid]`, `a[hi]` as the pivot to dodge the sorted-input worst case nearly for free.

```python
def median_of_three(a, lo, hi):
    mid = (lo + hi) // 2
    # sort the three so a[lo] <= a[mid] <= a[hi]
    if a[mid] < a[lo]:
        a[lo], a[mid] = a[mid], a[lo]
    if a[hi] < a[lo]:
        a[lo], a[hi] = a[hi], a[lo]
    if a[hi] < a[mid]:
        a[mid], a[hi] = a[hi], a[mid]
    # now a[mid] is the median; move it to hi-1 (or hi) for Lomuto
    a[mid], a[hi] = a[hi], a[mid]
    return a[hi]   # the pivot value, now at the end
```

After sorting the three sentinels, the median sits in the middle; swapping it to `hi` lets the standard Lomuto partition run unchanged.

### Pattern: Insertion-sort cutoff for small subarrays

**Intent:** Recursion overhead dominates for tiny ranges. Switch to insertion sort below a threshold (typically 10–16). Every production hybrid does this.

```python
CUTOFF = 16

def quicksort_cutoff(a, lo, hi):
    if hi - lo + 1 <= CUTOFF:
        insertion_sort(a, lo, hi)     # cheap on small/nearly-sorted ranges
        return
    p = partition(a, lo, hi)
    quicksort_cutoff(a, lo, p - 1)
    quicksort_cutoff(a, p + 1, hi)
```

---

## Three-Way Partitioning (Dutch National Flag)

When the array has **many duplicate keys**, two-way partitioning is wasteful: equal elements get shuffled into one side and re-partitioned repeatedly. Edsger Dijkstra's **Dutch National Flag** algorithm partitions into *three* regions in a single pass — `< pivot`, `== pivot`, `> pivot` — and then recurses only on the `<` and `>` regions. Elements equal to the pivot are placed and **never touched again**.

The invariant uses three pointers `lt`, `i`, `gt`:

```
a[lo..lt-1]  < pivot
a[lt..i-1]   == pivot
a[i..gt]     unknown (still to scan)
a[gt+1..hi]  > pivot
```

```
three_way(a, lo, hi):
    pivot = a[lo]
    lt = lo; i = lo; gt = hi
    while i <= gt:
        if a[i] < pivot:
            swap(a[lt], a[i]); lt++; i++
        elif a[i] > pivot:
            swap(a[i], a[gt]); gt--        # do NOT advance i: new a[i] is unscanned
        else:                              # a[i] == pivot
            i++
    quicksort(a, lo, lt - 1)
    quicksort(a, gt + 1, hi)
```

The key subtlety: when `a[i] > pivot` you swap it to the `>` region and **do not advance `i`**, because the element just swapped in from `gt` has not been examined yet.

On an array of all-equal keys, three-way partition finishes the whole range in **one `O(n)` pass** (the `==` region swallows everything), turning the catastrophic `O(n²)` Lomuto case into `O(n)`. This is the foundation of the production "3-way quicksort" used for keys with few distinct values.

---

## Quickselect: k-th Order Statistic

**Quickselect** finds the k-th smallest element (the k-th *order statistic*) without fully sorting. It uses the *same* partition step, but after partitioning it recurses into **only one** side — the side that contains rank `k`.

```
quickselect(a, lo, hi, k):        # find element of rank k (0-indexed) in a[lo..hi]
    if lo == hi: return a[lo]
    p = partition(a, lo, hi)       # pivot lands at p (its final rank)
    if k == p: return a[p]         # pivot IS the answer
    elif k < p: return quickselect(a, lo, p - 1, k)
    else:        return quickselect(a, p + 1, hi, k)
```

**Why expected `O(n)` and not `O(n log n)`?** Quicksort recurses into *both* sides, costing `T(n) = 2T(n/2) + O(n) = O(n log n)`. Quickselect recurses into *one* side, costing `T(n) = T(n/2) + O(n)`. That recurrence solves to `O(n) (1 + 1/2 + 1/4 + …) = O(2n) = O(n)` — the geometric series of partition costs converges to a constant times `n`. Dropping one of the two recursive calls collapses the `log n` factor.

Quickselect's worst case is still `O(n²)` (bad pivots), but **median-of-medians** pivot selection guarantees a constant-fraction split and gives quickselect a **worst-case `O(n)`** — the famous BFPRT algorithm (Blum-Floyd-Pratt-Rivest-Tarjan, 1973). In practice a random pivot is used (expected `O(n)`, much smaller constant); median-of-medians is reserved for when a worst-case guarantee is required. The full expected-time proof is in [`professional.md`](./professional.md).

---

## Code Examples

### Three-way quicksort + quickselect (random pivot)

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
)

// Three-way (Dutch National Flag) quicksort: robust on duplicate keys.
func quicksort3(a []int, lo, hi int) {
	if lo >= hi {
		return
	}
	r := lo + rand.Intn(hi-lo+1)
	a[lo], a[r] = a[r], a[lo] // random pivot to front
	pivot := a[lo]
	lt, i, gt := lo, lo, hi
	for i <= gt {
		if a[i] < pivot {
			a[lt], a[i] = a[i], a[lt]
			lt++
			i++
		} else if a[i] > pivot {
			a[i], a[gt] = a[gt], a[i]
			gt--
		} else {
			i++
		}
	}
	quicksort3(a, lo, lt-1)
	quicksort3(a, gt+1, hi)
}

// Quickselect: k-th smallest (0-indexed), expected O(n).
func quickselect(a []int, k int) int {
	lo, hi := 0, len(a)-1
	for lo < hi {
		r := lo + rand.Intn(hi-lo+1)
		a[r], a[hi] = a[hi], a[r]
		pivot := a[hi]
		i := lo - 1
		for j := lo; j < hi; j++ {
			if a[j] <= pivot {
				i++
				a[i], a[j] = a[j], a[i]
			}
		}
		i++
		a[i], a[hi] = a[hi], a[i]
		if k == i {
			return a[i]
		} else if k < i {
			hi = i - 1
		} else {
			lo = i + 1
		}
	}
	return a[lo]
}

func main() {
	a := []int{5, 5, 2, 8, 5, 1, 9, 5, 4}
	quicksort3(a, 0, len(a)-1)
	fmt.Println(a) // [1 2 4 5 5 5 5 8 9]

	b := []int{7, 2, 9, 4, 1, 8, 3}
	fmt.Println(quickselect(b, 2)) // 3rd smallest (0-indexed rank 2) = 3
}
```

#### Java

```java
import java.util.Random;

public class ThreeWayAndSelect {
    static final Random rng = new Random();

    static void quicksort3(int[] a, int lo, int hi) {
        if (lo >= hi) return;
        int r = lo + rng.nextInt(hi - lo + 1);
        int t = a[lo]; a[lo] = a[r]; a[r] = t;       // random pivot to front
        int pivot = a[lo];
        int lt = lo, i = lo, gt = hi;
        while (i <= gt) {
            if (a[i] < pivot) {
                int s = a[lt]; a[lt] = a[i]; a[i] = s; lt++; i++;
            } else if (a[i] > pivot) {
                int s = a[i]; a[i] = a[gt]; a[gt] = s; gt--;
            } else {
                i++;
            }
        }
        quicksort3(a, lo, lt - 1);
        quicksort3(a, gt + 1, hi);
    }

    static int quickselect(int[] a, int k) {
        int lo = 0, hi = a.length - 1;
        while (lo < hi) {
            int r = lo + rng.nextInt(hi - lo + 1);
            int t = a[r]; a[r] = a[hi]; a[hi] = t;
            int pivot = a[hi], i = lo - 1;
            for (int j = lo; j < hi; j++)
                if (a[j] <= pivot) { i++; int s = a[i]; a[i] = a[j]; a[j] = s; }
            i++;
            int s = a[i]; a[i] = a[hi]; a[hi] = s;
            if (k == i) return a[i];
            else if (k < i) hi = i - 1;
            else lo = i + 1;
        }
        return a[lo];
    }

    public static void main(String[] args) {
        int[] a = {5, 5, 2, 8, 5, 1, 9, 5, 4};
        quicksort3(a, 0, a.length - 1);
        System.out.println(java.util.Arrays.toString(a));

        int[] b = {7, 2, 9, 4, 1, 8, 3};
        System.out.println(quickselect(b, 2)); // 3
    }
}
```

#### Python

```python
import random


def quicksort3(a, lo, hi):
    """Three-way (Dutch National Flag) quicksort; robust on duplicates."""
    if lo >= hi:
        return
    r = random.randint(lo, hi)
    a[lo], a[r] = a[r], a[lo]            # random pivot to front
    pivot = a[lo]
    lt, i, gt = lo, lo, hi
    while i <= gt:
        if a[i] < pivot:
            a[lt], a[i] = a[i], a[lt]
            lt += 1
            i += 1
        elif a[i] > pivot:
            a[i], a[gt] = a[gt], a[i]
            gt -= 1
        else:
            i += 1
    quicksort3(a, lo, lt - 1)
    quicksort3(a, gt + 1, hi)


def quickselect(a, k):
    """k-th smallest (0-indexed), expected O(n)."""
    lo, hi = 0, len(a) - 1
    while lo < hi:
        r = random.randint(lo, hi)
        a[r], a[hi] = a[hi], a[r]
        pivot = a[hi]
        i = lo - 1
        for j in range(lo, hi):
            if a[j] <= pivot:
                i += 1
                a[i], a[j] = a[j], a[i]
        i += 1
        a[i], a[hi] = a[hi], a[i]
        if k == i:
            return a[i]
        elif k < i:
            hi = i - 1
        else:
            lo = i + 1
    return a[lo]


if __name__ == "__main__":
    a = [5, 5, 2, 8, 5, 1, 9, 5, 4]
    quicksort3(a, 0, len(a) - 1)
    print(a)                       # [1, 2, 4, 5, 5, 5, 5, 8, 9]

    b = [7, 2, 9, 4, 1, 8, 3]
    print(quickselect(b, 2))       # 3
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|-----------------|------------------|
| Hoare returns wrong bounds | Recursing `(lo, p-1)` instead of `(lo, p)` drops the split element. | Hoare recurses on `(lo, p)` and `(p+1, hi)`; Lomuto on `(lo, p-1)` and `(p+1, hi)`. |
| Three-way `i` advanced after `>` swap | Skips an unscanned element. | After swapping into the `>` region, do **not** advance `i`. |
| All-equal array is `O(n²)` | Using two-way Lomuto. | Use three-way partition; equal keys finish in one pass. |
| Quickselect returns wrong rank | Off-by-one between 0-indexed `k` and pivot rank `p`. | Compare `k == p`, recurse `k < p` left, `k > p` right; keep both 0-indexed. |
| Stack overflow on bad splits | Recursing both sides without small-side-first. | Recurse smaller side, loop larger (tail-call elimination). |
| Median-of-three on size-1/2 ranges | `mid` index coincides with `lo`/`hi`. | Guard tiny ranges (cutoff to insertion sort handles this). |

---

## Performance Analysis

| Input pattern | Two-way Lomuto (fixed pivot) | Two-way (random pivot) | Three-way (random pivot) |
|---------------|------------------------------|------------------------|--------------------------|
| Random distinct | `O(n log n)` | `O(n log n)` | `O(n log n)` |
| Already sorted | **`O(n²)`** | `O(n log n)` | `O(n log n)` |
| Reverse sorted | **`O(n²)`** | `O(n log n)` | `O(n log n)` |
| All equal | **`O(n²)`** | **`O(n²)`** | **`O(n)`** |
| Few distinct values | poor | mediocre | **`O(n·#distinct)`** ≈ `O(n log n)` |

The table makes the engineering decisions concrete: **randomize the pivot** to fix the sorted-input columns, and **three-way partition** to fix the duplicate-heavy columns. A production quicksort does both.

Swap counts: Hoare does roughly `n/6` swaps per partition pass on random data, versus Lomuto's `n/2` — a constant-factor win that adds up. This, plus Hoare's graceful handling of duplicates, is why the original Hoare scheme (or three-way) underlies most library implementations rather than the textbook Lomuto.

```python
# Quick empirical check of the all-equal pathology
import time

def time_sort(sort_fn, a):
    b = a[:]
    t = time.perf_counter()
    sort_fn(b, 0, len(b) - 1)
    return time.perf_counter() - t

# all-equal: two-way Lomuto is O(n^2); three-way is O(n)
alleq = [7] * 5000
# time_sort(lomuto_quicksort, alleq)   -> slow
# time_sort(quicksort3, alleq)         -> fast
```

---

## Best Practices

- **Pick the partition for your data:** Hoare or three-way for general/duplicate-heavy input; Lomuto only when you want the pivot's exact index (e.g. for quickselect) or for teaching.
- **Always randomize or median-of-three the pivot.** Fixed pivots are an `O(n²)` time bomb on sorted input.
- **Three-way partition when keys repeat.** It turns the all-equal `O(n²)` disaster into `O(n)`.
- **Recurse small side first, loop the large side** to keep the stack at `O(log n)`.
- **Cut off to insertion sort** for subarrays of size ≤ ~16.
- **Reuse one tested `partition`** and parameterize the pivot choice; most bugs live in the partition and its recursion bounds.
- **Use quickselect, not a full sort,** when you only need an order statistic — expected `O(n)` beats `O(n log n)`.

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive view.
>
> The middle-level animation highlights:
> - The Lomuto partition scan with the `i` (boundary) and `j` (scan) pointers, and each swap that grows the `≤ pivot` region.
> - The pivot landing in its final position and the array splitting into left and right subproblems.
> - The recursion tree forming as each partition spawns two smaller partitions, and how a balanced split (good pivot) keeps the tree shallow.

---

## Summary

The two partition schemes — **Lomuto** (one index, pivot last, returns the pivot's final position) and **Hoare** (two pointers, pivot first, returns a split point, ~3× fewer swaps and graceful on duplicates) — are the two ways to do the `O(n)` divide step. **Pivot selection** is the dominant performance lever: random or median-of-three keeps splits balanced and dodges the sorted-input `O(n²)` trap; median-of-medians guarantees it at a higher constant. **Three-way partitioning** (Dutch National Flag) turns the catastrophic all-equal case from `O(n²)` into `O(n)` by isolating keys equal to the pivot in one pass. **Quickselect** reuses the partition but recurses into only one side, finding the k-th order statistic in expected `O(n)` instead of `O(n log n)`. **Tail-call elimination** (recurse small, loop large) bounds the stack at `O(log n)`. Compared to merge sort, quicksort trades a guaranteed worst case for in-place sorting and a smaller constant — the right trade for most in-memory array sorting.
