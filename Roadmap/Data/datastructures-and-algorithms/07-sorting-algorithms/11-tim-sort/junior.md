# Tim Sort — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#real-world-analogies)
7. [Pros & Cons](#pros--cons)
8. [Step-by-Step Walkthrough](#step-by-step-walkthrough)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Error Handling](#error-handling)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation](#visual-animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

## Introduction

> Focus: "What is Tim Sort?" and "Why is it the production default in Python and Java?"

**Tim Sort** is a hybrid, adaptive, stable sorting algorithm designed by **Tim Peters in 2002** for the CPython interpreter. He had one goal: make Python's `sorted()` and `list.sort()` as fast as possible on the kinds of arrays real programs actually pass — which, it turns out, are rarely random. Real-world arrays are full of already-sorted (or reverse-sorted) **runs**: a log file sorted by timestamp with a few late arrivals, a list of users mostly sorted by name with new sign-ups appended, a partially merged dataset, and so on. Tim Sort detects these runs and exploits them, getting **O(n)** time on already-sorted input and **O(n log n)** worst case.

Tim Sort is now the **production default** in:

- **Python** — `sorted()`, `list.sort()` (CPython since 2.3, 2002).
- **Java** — `Arrays.sort(Object[])` and `Collections.sort` (since Java 7, 2011). For primitive arrays Java uses Dual-Pivot Quicksort because primitives don't need stability.
- **Android** — system-wide default for object arrays.
- **JavaScript (V8)** — `Array.prototype.sort` since 2018. Before that, V8 used a non-stable QuickSort and the language spec didn't require stability.
- **Octave**, **Swift** (`sort(by:)` for stable variant), and many other runtimes.

What makes Tim Sort different from plain Merge Sort:

1. **Run detection** — scan the array once, find existing ascending and (reversed) descending runs. Reverse the descending ones in place so all runs are ascending.
2. **`minrun` padding** — short runs are extended to a minimum length (typically 32-64) using Binary Insertion Sort, which is very fast for tiny arrays.
3. **Strategic merging** — runs are pushed onto a stack and merged in a specific order that maintains stack invariants (lengths satisfy `A > B + C` and `B > C`), bounding stack size at `O(log n)` and balancing merge sizes.
4. **Galloping mode** — when one run consistently "wins" the merge, switch from one-by-one to exponential search, copying long stretches in O(log k) comparisons instead of O(k).

The cost: more complex code than vanilla Merge Sort. The win: best-of-both-worlds performance on real data, plus stability.

---

## Prerequisites

- **Required:** Merge Sort fundamentals — see [`02-merge-sort/junior.md`](../02-merge-sort/junior.md)
- **Required:** Insertion Sort and Binary Insertion Sort — see [`03-insertion-sort/junior.md`](../03-insertion-sort/junior.md)
- **Required:** Stack data structure — push/pop/peek
- **Required:** Binary search basics — `bisect`/`Arrays.binarySearch`
- **Helpful:** Familiarity with "adaptive sorts" (sorts whose runtime depends on input shape)
- **Helpful:** Understanding of cache locality and why touching contiguous memory is fast

---

## Glossary

| Term | Definition |
|------|-----------|
| **Run** | A maximal already-sorted (ascending or strictly descending) subsequence in the input |
| **Natural Run** | A run detected directly in the input — no work required to create it |
| **minrun** | Minimum allowed run length; short runs are extended with Binary Insertion Sort. Typically 32-64 |
| **Binary Insertion Sort** | Insertion Sort that uses binary search to find the position, then shifts |
| **Run Stack** | Stack of `(start, length)` pairs for runs awaiting merge |
| **Stack Invariants** | Length constraints between adjacent stack entries: `A > B + C` and `B > C` |
| **Galloping Mode** | Exponential search used during merge when one run is winning streaks |
| **`min_gallop`** | Threshold of consecutive wins before galloping kicks in (starts at 7, adapts) |
| **Adaptive Sort** | A sort whose runtime depends on input order (faster on near-sorted data) |
| **Stable Sort** | Preserves relative order of elements that compare equal |
| **TimSort Invariant Bug** | A 2015 paper proved the invariants `A > B + C` and `B > C` were insufficient; OpenJDK and CPython both patched |

---

## Core Concepts

### Concept 1: Real-World Arrays Have Runs

Tim Peters' key observation: programmers rarely sort random data. They sort log entries (mostly already sorted by timestamp), user records (appended to a sorted list), merged datasets, reversed lists. A pure Merge Sort treats all input the same and runs in `n log n` regardless. Tim Sort scans once, finds these **natural runs**, and exploits them. On a sorted array of 1M elements, Tim Sort returns in O(n) time while pure Merge Sort still does `n log n`.

### Concept 2: Detect, Reverse, Extend

The first pass does three things in one walk:

1. **Detect** a run: advance while `arr[i+1] >= arr[i]` (ascending) or `arr[i+1] < arr[i]` (strictly descending — `<` not `<=`, for stability).
2. **Reverse** descending runs in place so all runs are ascending. Strict `<` ensures equal elements never get reversed.
3. **Extend** short runs with Binary Insertion Sort until they have at least `minrun` elements.

### Concept 3: Why `minrun`?

Tiny runs (1-2 elements) → `n/2` runs → too many merge passes. Huge runs (`n/2`) → Insertion Sort dominates → O(n²). The sweet spot is 32-64: TimSort computes `minrun` so that `n / minrun` is just under a power of 2, perfectly balancing the merge tree.

### Concept 4: The Run Stack and Invariants

Each detected/padded run is pushed onto a stack. TimSort enforces **invariants** on the top three lengths A (third-from-top), B (second), C (top):

- **A > B + C**
- **B > C**

After each push, check invariants. If violated, merge B with the smaller of A and C. This bounds stack depth at `O(log n)` and keeps merges balanced.

### Concept 5: Galloping Mode

During a merge, count how many elements come from each side. If one side wins `min_gallop` times in a row (default 7), switch to **galloping**: use exponential search to find how many of the winner's elements are less than the loser's head, bulk-copy them, then drop back. Galloping pays off when one run dominates the other (e.g., long sorted list + few new appended elements).

### Concept 6: Stability + Adaptivity

**Stable** because: merge uses `<=` (left wins on ties); descending uses strict `<` (equals stay ascending). **Adaptive** because: sorted → one run → O(n); reverse → one reverse → O(n); nearly-sorted → few runs → fast merge via galloping.

---

## Big-O Summary

| Case | Time | Notes |
|------|------|-------|
| Best (sorted or reverse-sorted) | **O(n)** | One run, no merges |
| Average | **O(n log n)** | Random data |
| Worst | **O(n log n)** | Provable upper bound |
| Adaptive bound | **O(n + n log R)** | R = number of natural runs |
| Space | **O(n)** worst | Merge buffer; much less on near-sorted data |
| Stable | **Yes** | |
| In-place | **No** | Needs auxiliary buffer of size `min(|L|, |R|)` |
| Adaptive | **Yes** | Runs detected and exploited |

---

## Real-World Analogies

| Concept | Analogy |
|---------|--------|
| **Run detection** | Sorting playing cards already grouped in suits — keep groups intact, merge groups |
| **Reversing descending runs** | Pile of receipts in reverse-date order — flip the pile, then merge with others |
| **`minrun` padding** | Too few books on a shelf? Bundle them with the next batch before re-shelving |
| **Stack invariants** | Pancake stacking rules: never put a much bigger pancake on a tiny one |
| **Galloping** | Two queues at the bank, one moves fast — leap ahead to skip past the slow side |

> **Where the analogies break:** real-world card sorting doesn't have `minrun` — you just merge whatever you have. Tim Sort's `minrun` exists to keep the merge tree balanced and to amortize the cost of binary insertion.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| **Best-case O(n)** on sorted / reverse-sorted input | Complex implementation (~1000 lines in CPython) |
| **Stable** — preserves order of equal keys | O(n) auxiliary space in worst case |
| **Adaptive** — exploits existing order | Slower than Quick Sort on truly random small arrays |
| **Production default** in Python, Java (objects), JS V8, Android | Not in-place |
| **Good cache behavior** on real data | Galloping has constant overhead for random data |
| **Predictable O(n log n) worst case** | Hidden constant ~1.5-2× plain Merge Sort on random input |

**When to use:**

- **Default choice** in Python (just call `sorted` / `list.sort`) and Java (just call `Arrays.sort` on `Object[]` / `Collections.sort`).
- Sorting **partially ordered data** — logs, time series, append-only datasets.
- Whenever **stability matters** and you can't afford O(n²) Quick Sort tails.
- Sorting **object arrays** where comparisons are expensive (Tim Sort minimizes comparisons via galloping).

**When NOT to use:**

- **Truly random primitive arrays** — Dual-Pivot Quicksort or pdqsort is ~30% faster (no stability tax).
- **Memory-constrained embedded systems** — O(n) buffer may not fit.
- **Extremely small arrays (n < 32)** — pure Insertion Sort is simpler and equally fast.

---

## Step-by-Step Walkthrough

Sort `[3, 1, 2, 5, 4, 9, 8, 7, 6, 10, 11, 12]` with a toy `minrun = 3`:

**Phase 1 — Run detection (walk left to right):**

```text
i=0: arr[0..1]=[3,1] descending → reverse → [1,3]. Len 2 < minrun.
     Pad with Binary Insertion of arr[2]=2 → run #1 = [1,2,3] at [0..3).
i=3: arr[3..4]=[5,4] descending → reverse → [4,5]. Len 2 < minrun.
     Pad with arr[5]=9 → run #2 = [4,5,9] at [3..6).
i=6: arr[6..8]=[8,7,6] strict descending → reverse → [6,7,8]. Len 3 = minrun.
     Run #3 = [6,7,8] at [6..9).
i=9: arr[9..12]=[10,11,12] ascending, len 3 = minrun.
     Run #4 = [10,11,12] at [9..12).
```

**Phase 2 — Push and merge per invariants (sizes shown):**

```text
push #1 → stack [3]                    (1 entry, ok)
push #2 → stack [3, 3]                 (B=3 ≤ C=3, merge) → [6]
push #3 → stack [6, 3]                 (B=6 > C=3 ok)
push #4 → stack [6, 3, 3]              (A=6, B=3, C=3: A > B+C? 6 > 6 NO. Merge)
        → merge B+C → stack [6, 6]     (B=6 ≤ C=6, merge) → [12]
End → merge-force: merge run #1 with [12] → [1..12].
```

**Result:** `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]`. ~4 binary insertions, 3 reversals, 3 merges. Pure Merge Sort would need ~43 comparisons on this input; TimSort wins on partially ordered data.

---

## Code Examples

### Example 1: Use the Production Built-In

#### Go

```go
package main

import (
    "fmt"
    "sort"
)

// Go's standard library uses pattern-defeating quicksort (pdqsort) since Go 1.19.
// It is NOT TimSort. For a true TimSort port in Go, see Example 2.
// Go's sort.SliceStable IS guaranteed stable — uses symmetric merge sort.
func main() {
    data := []int{3, 1, 2, 5, 4, 9, 8, 7, 6, 10, 11, 12}
    sort.SliceStable(data, func(i, j int) bool { return data[i] < data[j] })
    fmt.Println(data) // [1 2 3 4 5 6 7 8 9 10 11 12]
}
```

#### Java

```java
import java.util.Arrays;

public class TimSortBuiltIn {
    public static void main(String[] args) {
        Integer[] boxed = {3, 1, 2, 5, 4, 9, 8, 7, 6, 10, 11, 12};
        Arrays.sort(boxed); // TimSort — stable, adaptive
        System.out.println(Arrays.toString(boxed));

        int[] prims = {3, 1, 2, 5, 4, 9, 8, 7, 6, 10, 11, 12};
        Arrays.sort(prims); // Dual-Pivot Quicksort — NOT TimSort
        System.out.println(Arrays.toString(prims));
    }
}
```

#### Python

```python
data = [3, 1, 2, 5, 4, 9, 8, 7, 6, 10, 11, 12]
print(sorted(data))            # new list
data.sort()                    # in-place
print(data)

# Stability: equal keys preserve insertion order.
people = [("Alice", 30), ("Bob", 25), ("Charlie", 30)]
people.sort(key=lambda p: p[1])
print(people)  # [('Bob', 25), ('Alice', 30), ('Charlie', 30)]
```

**What it does:** Demonstrates the production path. **Java**: `Arrays.sort(Object[])` is TimSort; `Arrays.sort(int[])` is Dual-Pivot Quicksort. **Python**: every built-in sort is TimSort. **Go**: `sort.SliceStable` is a related stable merge sort; `sort.Slice` (1.19+) is `pdqsort` — see [`12-intro-sort/`](../12-intro-sort/).

---

### Example 2: TimSort From Scratch (Educational)

A faithful port. Real CPython is ~1000 lines of C; this is the algorithm without micro-optimizations.

#### Go

```go
package main

import "fmt"

const minMerge = 32

type run struct{ start, length int }

func computeMinRun(n int) int {
    r := 0
    for n >= minMerge {
        r |= n & 1
        n >>= 1
    }
    return n + r
}

func binaryInsertionSort(a []int, lo, hi, start int) {
    if start == lo {
        start++
    }
    for ; start < hi; start++ {
        pivot := a[start]
        left, right := lo, start
        for left < right {
            mid := (left + right) >> 1
            if pivot < a[mid] {
                right = mid
            } else {
                left = mid + 1
            }
        }
        copy(a[left+1:start+1], a[left:start])
        a[left] = pivot
    }
}

func countRun(a []int, lo, hi int) int {
    r := lo + 1
    if r == hi {
        return 1
    }
    if a[r] < a[lo] {
        for r < hi && a[r] < a[r-1] {
            r++
        }
        for i, j := lo, r-1; i < j; i, j = i+1, j-1 {
            a[i], a[j] = a[j], a[i]
        }
    } else {
        for r < hi && a[r] >= a[r-1] {
            r++
        }
    }
    return r - lo
}

func mergeRuns(a []int, lo, mid, hi int) {
    left := append([]int{}, a[lo:mid]...)
    i, j, k := 0, mid, lo
    for i < len(left) && j < hi {
        if left[i] <= a[j] { // <= preserves stability
            a[k] = left[i]; i++
        } else {
            a[k] = a[j]; j++
        }
        k++
    }
    for i < len(left) {
        a[k] = left[i]; i++; k++
    }
}

func collapse(a []int, st []run) []run {
    for len(st) >= 2 {
        top := len(st) - 1
        if len(st) >= 3 && st[top-2].length <= st[top-1].length+st[top].length {
            x := top - 1
            if st[top-2].length >= st[top].length {
                x = top
            }
            mergeRuns(a, st[x-1].start, st[x].start, st[x].start+st[x].length)
            st[x-1] = run{st[x-1].start, st[x-1].length + st[x].length}
            if x == top-1 {
                st[top-1] = st[top]
            }
            st = st[:top]
        } else if st[top-1].length <= st[top].length {
            mergeRuns(a, st[top-1].start, st[top].start, st[top].start+st[top].length)
            st[top-1] = run{st[top-1].start, st[top-1].length + st[top].length}
            st = st[:top]
        } else {
            break
        }
    }
    return st
}

func TimSort(a []int) {
    n := len(a)
    if n < 2 {
        return
    }
    if n < minMerge {
        binaryInsertionSort(a, 0, n, 0)
        return
    }
    minRun := computeMinRun(n)
    var st []run
    lo := 0
    for lo < n {
        rl := countRun(a, lo, n)
        if rl < minRun {
            force := minRun
            if n-lo < force {
                force = n - lo
            }
            binaryInsertionSort(a, lo, lo+force, lo+rl)
            rl = force
        }
        st = append(st, run{lo, rl})
        lo += rl
        st = collapse(a, st)
    }
    for len(st) > 1 {
        top := len(st) - 1
        mergeRuns(a, st[top-1].start, st[top].start, st[top].start+st[top].length)
        st[top-1] = run{st[top-1].start, st[top-1].length + st[top].length}
        st = st[:top]
    }
}

func main() {
    data := []int{3, 1, 2, 5, 4, 9, 8, 7, 6, 10, 11, 12}
    TimSort(data)
    fmt.Println(data)
}
```

#### Java

```java
import java.util.Arrays;

public class TimSortFromScratch {
    static final int MIN_MERGE = 32;

    static int computeMinRun(int n) {
        int r = 0;
        while (n >= MIN_MERGE) { r |= (n & 1); n >>= 1; }
        return n + r;
    }

    static void binaryInsertionSort(int[] a, int lo, int hi, int start) {
        if (start == lo) start++;
        for (; start < hi; start++) {
            int pivot = a[start];
            int left = lo, right = start;
            while (left < right) {
                int mid = (left + right) >>> 1;
                if (pivot < a[mid]) right = mid; else left = mid + 1;
            }
            System.arraycopy(a, left, a, left + 1, start - left);
            a[left] = pivot;
        }
    }

    static int countRun(int[] a, int lo, int hi) {
        int r = lo + 1;
        if (r == hi) return 1;
        if (a[r++] < a[lo]) {
            while (r < hi && a[r] < a[r - 1]) r++;
            for (int i = lo, j = r - 1; i < j; i++, j--) { int t = a[i]; a[i] = a[j]; a[j] = t; }
        } else {
            while (r < hi && a[r] >= a[r - 1]) r++;
        }
        return r - lo;
    }

    static void mergeRuns(int[] a, int lo, int mid, int hi) {
        int[] left = Arrays.copyOfRange(a, lo, mid);
        int i = 0, j = mid, k = lo;
        while (i < left.length && j < hi)
            a[k++] = (left[i] <= a[j]) ? left[i++] : a[j++];
        while (i < left.length) a[k++] = left[i++];
    }

    public static void sort(int[] a) {
        int n = a.length;
        if (n < 2) return;
        if (n < MIN_MERGE) { binaryInsertionSort(a, 0, n, 0); return; }
        int minRun = computeMinRun(n);
        int[][] st = new int[64][2];  // [start, length]
        int top = -1, lo = 0;
        while (lo < n) {
            int rl = countRun(a, lo, n);
            if (rl < minRun) {
                int force = Math.min(minRun, n - lo);
                binaryInsertionSort(a, lo, lo + force, lo + rl);
                rl = force;
            }
            st[++top] = new int[]{lo, rl};
            lo += rl;
            top = collapse(a, st, top);
        }
        while (top >= 1) {
            mergeRuns(a, st[top - 1][0], st[top][0], st[top][0] + st[top][1]);
            st[top - 1] = new int[]{st[top - 1][0], st[top - 1][1] + st[top][1]};
            top--;
        }
    }

    private static int collapse(int[] a, int[][] st, int top) {
        while (top >= 1) {
            if (top >= 2 && st[top - 2][1] <= st[top - 1][1] + st[top][1]) {
                int x = st[top - 2][1] < st[top][1] ? top - 1 : top;
                mergeRuns(a, st[x - 1][0], st[x][0], st[x][0] + st[x][1]);
                st[x - 1] = new int[]{st[x - 1][0], st[x - 1][1] + st[x][1]};
                if (x == top - 1) st[top - 1] = st[top];
                top--;
            } else if (st[top - 1][1] <= st[top][1]) {
                mergeRuns(a, st[top - 1][0], st[top][0], st[top][0] + st[top][1]);
                st[top - 1] = new int[]{st[top - 1][0], st[top - 1][1] + st[top][1]};
                top--;
            } else break;
        }
        return top;
    }

    public static void main(String[] args) {
        int[] data = {3, 1, 2, 5, 4, 9, 8, 7, 6, 10, 11, 12};
        sort(data);
        System.out.println(Arrays.toString(data));
    }
}
```

#### Python

```python
MIN_MERGE = 32


def compute_min_run(n):
    r = 0
    while n >= MIN_MERGE:
        r |= n & 1
        n >>= 1
    return n + r


def binary_insertion_sort(a, lo, hi, start):
    if start == lo:
        start += 1
    for i in range(start, hi):
        pivot = a[i]
        left, right = lo, i
        while left < right:
            mid = (left + right) >> 1
            if pivot < a[mid]:
                right = mid
            else:
                left = mid + 1
        a[left + 1:i + 1] = a[left:i]
        a[left] = pivot


def count_run(a, lo, hi):
    r = lo + 1
    if r == hi:
        return 1
    if a[r] < a[lo]:
        r += 1
        while r < hi and a[r] < a[r - 1]:
            r += 1
        a[lo:r] = a[lo:r][::-1]
    else:
        r += 1
        while r < hi and a[r] >= a[r - 1]:
            r += 1
    return r - lo


def merge_runs(a, lo, mid, hi):
    left = a[lo:mid]
    i, j, k = 0, mid, lo
    while i < len(left) and j < hi:
        if left[i] <= a[j]:  # <= for stability
            a[k] = left[i]; i += 1
        else:
            a[k] = a[j]; j += 1
        k += 1
    while i < len(left):
        a[k] = left[i]; i += 1; k += 1


def _collapse(a, st):
    while len(st) >= 2:
        if len(st) >= 3 and st[-3][1] <= st[-2][1] + st[-1][1]:
            if st[-3][1] < st[-1][1]:
                A, B, C = st[-3], st[-2], st[-1]
                merge_runs(a, A[0], B[0], B[0] + B[1])
                st[-3:] = [(A[0], A[1] + B[1]), C]
            else:
                B, C = st[-2], st[-1]
                merge_runs(a, B[0], C[0], C[0] + C[1])
                st[-2:] = [(B[0], B[1] + C[1])]
        elif st[-2][1] <= st[-1][1]:
            B, C = st[-2], st[-1]
            merge_runs(a, B[0], C[0], C[0] + C[1])
            st[-2:] = [(B[0], B[1] + C[1])]
        else:
            break


def tim_sort(a):
    n = len(a)
    if n < 2:
        return
    if n < MIN_MERGE:
        binary_insertion_sort(a, 0, n, 0)
        return
    min_run = compute_min_run(n)
    st = []
    lo = 0
    while lo < n:
        rl = count_run(a, lo, n)
        if rl < min_run:
            force = min(min_run, n - lo)
            binary_insertion_sort(a, lo, lo + force, lo + rl)
            rl = force
        st.append((lo, rl))
        lo += rl
        _collapse(a, st)
    while len(st) > 1:
        B, C = st[-2], st[-1]
        merge_runs(a, B[0], C[0], C[0] + C[1])
        st[-2:] = [(B[0], B[1] + C[1])]


if __name__ == "__main__":
    data = [3, 1, 2, 5, 4, 9, 8, 7, 6, 10, 11, 12]
    tim_sort(data)
    print(data)
```

**What it does:** A simplified TimSort. Detects runs, extends short ones, pushes onto a stack, merges per invariants. Omits galloping mode and the 2015 invariant patch for readability — see `senior.md` for those.

---

## Coding Patterns

### Pattern 1: Run Detection With Strict Descending

```mermaid
graph TD
    A[Start at i] --> B{arr[i+1] < arr[i]?}
    B -- yes --> C[Strictly descending — extend while strict]
    B -- no --> D[Ascending — extend while non-strict]
    C --> E[Reverse range in place]
    D --> F[Run ready]
    E --> F
```

The key subtlety: **descending uses strict `<`** (equals are not part of a descending run). Equal elements never participate in a reverse, so stability is preserved.

### Pattern 2: Stack Invariants Enforcement

```text
After every push:
  while stack has >= 2 entries:
    if violation (A <= B+C  or  B <= C):
      merge B with smaller of A, C  (or top-2 if no A)
    else: break
```

Keeps stack depth at `O(log n)` and merge sizes balanced.

### Pattern 3: `minrun` Computation

Already shown in Example 2. The trick: `compute_min_run(n)` returns the low-order 5-6 bits of `n` plus `1` if any other bit was set, so `n / minrun` is just under a power of 2. For `n = 1_000_000` it returns `32`; for `n = 64` it returns `32`.

---

## Error Handling

| Error | Cause | Fix |
|-------|-------|-----|
| Lost stability | Descending check used `<=` instead of `<` | Use strict `<` so equals stay in ascending runs |
| Lost stability | Merge used `<` instead of `<=` | Use `<=` so left side wins on ties |
| `IndexError` in binary insertion | `start == lo` not handled | Increment `start` if equal to `lo` |
| Stack overflow on huge input | Recursion depth | TimSort is iterative — should not happen; check that you're not recursing in your run-detection helper |
| Wrong invariant violation handling | Merging wrong pair | When `A <= B + C`, merge B with the SMALLER of A and C |
| Comparator violates total order | Non-transitive `compare` | Java throws `IllegalArgumentException`; Python silently sorts wrong — audit comparator |

---

## Performance Tips

- **Don't reimplement** — use built-ins; they're faster than any hand-written port.
- In **Java**, prefer `Arrays.sort(int[])` over `Arrays.sort(Integer[])` on primitives (avoids boxing + cache-friendlier).
- For **partial sort**, Python's `heapq.nsmallest(k, iter)` beats `sorted(iter)[:k]` when `k << n`.
- For expensive **`key=` functions**, the built-in already caches keys; just use `key=` cleanly.

---

## Best Practices

- Use `sorted()` / `list.sort()` / `Collections.sort` / `Arrays.sort` — never reimplement for production.
- Specify a `key` when sorting tuples / objects with ambiguous natural order.
- Document stability assumptions when downstream code depends on them.
- Test on partially-sorted, reverse, all-equal, already-sorted input — adaptivity is the whole point.
- In **Go**, use `sort.SliceStable` for stability; `sort.Slice` is `pdqsort` and NOT stable.

---

## Edge Cases & Pitfalls

- **Empty / single element** → `n < 2` short-circuit. ✓
- **All equal** → one ascending run (non-strict `>=`), no reversal, no merges, O(n).
- **Already / reverse sorted** → one run, O(n).
- **n < 32** → pure Binary Insertion Sort path, no run logic.
- **Non-deterministic comparator** → Java throws `IllegalArgumentException: Comparison method violates its general contract`; Python silently sorts wrong. Audit the comparator.

---

## Common Mistakes

1. **`<=` in descending detection** → equals reversed, stability lost.
2. **`<` in merge** → right wins on ties, stability lost.
3. **Forgetting to reverse descending runs** → merge produces wrong order.
4. **Hard-coding `minrun = 32`** instead of computing from `n` → unbalanced merge tree on large `n`.
5. **Not handling `start == lo`** in binary insertion → infinite loop.
6. **Merging the wrong pair** on invariant violation → should be B with SMALLER of A, C.
7. **Assuming Java's `Arrays.sort(int[])` is TimSort** — it isn't. Only object arrays use TimSort.
8. **Reimplementing TimSort in production** — use the built-in.

---

## Cheat Sheet

```text
Tim Sort — Quick Reference

PHASES:
  1. Compute minrun from n (32-64 typical)
  2. Walk array left-to-right:
       a. Find next run (ascending or strictly descending)
       b. Reverse descending runs in place
       c. Extend short runs to minrun via Binary Insertion Sort
       d. Push run onto stack
       e. Merge runs while stack invariants violated
  3. Final "merge force" — merge all remaining stack runs

INVARIANTS:
  A > B + C   AND   B > C    (top-3 stack entries; lengths)
  If violated: merge B with smaller of A, C.

GALLOPING (advanced):
  After min_gallop wins from one side, switch to exponential search.
  Default min_gallop = 7. Adapts based on data.

COMPLEXITY:
  Best:   O(n)        sorted / reverse-sorted / one run
  Avg:    O(n log n)
  Worst:  O(n log n)
  Adaptive: O(n + n log R)   where R = number of runs
  Space:  O(n) worst, much less for near-sorted
  Stable: YES
  In-place: NO

PRODUCTION USAGE:
  Python   sorted(), list.sort()                — TimSort
  Java     Arrays.sort(Object[]), Collections.sort — TimSort
  Java     Arrays.sort(int[])                   — Dual-Pivot Quicksort (NOT TimSort)
  Android  default sort                          — TimSort
  V8 (JS)  Array.prototype.sort (since 2018)     — TimSort
  Go       sort.SliceStable                      — symmetric merge sort (related)
  Go       sort.Slice (since 1.19)               — pdqsort (see topic 12)
```

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visual animation of Tim Sort.
>
> The animation demonstrates:
>
> - **Run detection** — ascending runs highlighted in blue, descending in orange, then reversed.
> - **`minrun` padding** — short runs extended with Binary Insertion Sort (green-shifting cells).
> - **Run stack visualization** — sidebar showing pushed runs and invariant checks.
> - **Merge phase** — two runs merged with left-right pointers; equal-color cells preserved in order (stability).
> - **Live stats** — comparisons, reverses, insertions, merges, max stack depth.

---

## Summary

Tim Sort is a **hybrid, adaptive, stable** sort built on top of **Merge Sort + Binary Insertion Sort**. Its three innovations — **natural run detection**, **`minrun` padding**, and **stack-invariant-driven merging** — turn pure Merge Sort's `O(n log n)` worst case into `O(n)` on already-sorted input and into the **fastest general-purpose sort on real-world data**. That's why it's the production default in Python, Java (objects), JavaScript V8, and Android.

Three things to remember:

1. **TimSort is adaptive.** Sorted input → O(n). Random input → O(n log n). The runtime depends on the number of natural runs `R`: O(n + n log R).
2. **TimSort is stable**, and the trick is in two places: descending runs use **strict `<`**, the merge uses `<=`.
3. **Don't reimplement TimSort in production.** Use the built-in. Reimplement once to understand it, then forget it exists and call `sorted()` or `Arrays.sort` like everyone else.

Move next to [`12-intro-sort/`](../12-intro-sort/) to see the QuickSort-based alternative used in C++, Rust, and Go's `sort.Slice`. For the formal correctness analysis of the stack invariants (including the famous 2015 bug), see `senior.md` and `professional.md` in this folder.

---

## Further Reading

- **Tim Peters' original spec** — [`Objects/listsort.txt`](https://github.com/python/cpython/blob/main/Objects/listsort.txt) in CPython source. The primary source. Read this.
- **CPython implementation** — [`Objects/listobject.c`](https://github.com/python/cpython/blob/main/Objects/listobject.c) — production reference, ~1000 lines of C.
- **OpenJDK `TimSort.java`** — [`java.util.TimSort`](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/TimSort.java).
- **2015 Invariant Bug paper** — De Gouw, Rot, de Boer, Bubel, Hähnle. *"OpenJDK's `java.utils.Collection.sort()` is broken: The good, the bad and the worst case."* CAV 2015.
- **V8 TimSort blog post** — [v8.dev/blog/array-sort](https://v8.dev/blog/array-sort) (2018).
- **CLRS — Introduction to Algorithms**, §2.3 (Merge Sort) and §2.1 (Insertion Sort) — the building blocks.
- Python: [`sorted`](https://docs.python.org/3/library/functions.html#sorted) and [`list.sort`](https://docs.python.org/3/library/stdtypes.html#list.sort) — official docs.
- Java: [`Arrays.sort`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Arrays.html#sort(java.lang.Object%5B%5D)) — uses TimSort for object arrays.
