# Bubble Sort — Specification

> **Algorithm Specification — Reference Standard**
>
> Source: [Knuth, *The Art of Computer Programming, Vol. 3* — Section 5.2.2](https://www-cs-faculty.stanford.edu/~knuth/taocp.html)
> Source: [CLRS, *Introduction to Algorithms* — Problem 2-2](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/)

---

## Table of Contents

1. [Algorithm Reference](#1-algorithm-reference)
2. [API / Interface Reference](#2-api-interface-reference)
3. [Core Rules and Behavioral Specification](#3-core-rules-and-behavioral-specification)
4. [Schema / Parameters Reference](#4-schema-parameters-reference)
5. [Behavioral Specification](#5-behavioral-specification)
6. [Edge Cases](#6-edge-cases)
7. [Complexity Compatibility Matrix](#7-complexity-compatibility-matrix)
8. [Reference Implementations](#8-reference-implementations)
9. [Compliance & Best Practices Checklist](#9-compliance-best-practices-checklist)
10. [Related Documentation](#10-related-documentation)

---

## 1. Algorithm Reference

| Property | Value |
|----------|-------|
| **Name** | Bubble Sort (a.k.a. Sinking Sort, Comparison Sort) |
| **Inventor** | Studied since 1956 (origin debated); name first used by Iverson, 1962 |
| **Reference** | Knuth TAOCP Vol. 3 §5.2.2 (Algorithm B); CLRS Problem 2-2 |
| **Class** | Comparison-based, in-place, stable |
| **Best Time** | O(n) — already-sorted input with early-exit optimization |
| **Average Time** | O(n²) |
| **Worst Time** | O(n²) |
| **Auxiliary Space** | O(1) |
| **Adaptive** | Yes (with early-exit) |
| **Stable** | Yes |
| **Comparison Sort** | Yes |

---

## 2. API / Interface Reference

### Standard Function Signature

```text
BUBBLE_SORT(A: array of T, cmp: (T, T) → int) → void
  Sorts A in place using cmp, where cmp(a, b) returns:
    < 0  if a should come before b
    = 0  if a and b are equivalent
    > 0  if a should come after b

Postcondition:
  ∀ i ∈ [0, n-2]: cmp(A[i], A[i+1]) ≤ 0
  AND A is a permutation of the original input.
```

### Language-Specific Equivalents

| Language | Built-in Sort | Notes |
|----------|--------------|-------|
| Go | [`sort.Slice`](https://pkg.go.dev/sort#Slice), [`slices.Sort`](https://pkg.go.dev/slices#Sort) | Pdqsort, NOT Bubble Sort |
| Java | [`Arrays.sort`](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Arrays.html#sort(int%5B%5D)), [`Collections.sort`](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Collections.html#sort(java.util.List)) | Dual-Pivot Quicksort (primitives), TimSort (objects) |
| Python | [`sorted`](https://docs.python.org/3/library/functions.html#sorted), [`list.sort`](https://docs.python.org/3/library/stdtypes.html#list.sort) | TimSort |
| C++ | [`std::sort`](https://en.cppreference.com/w/cpp/algorithm/sort), [`std::stable_sort`](https://en.cppreference.com/w/cpp/algorithm/stable_sort) | Introsort / TimSort |
| Rust | [`slice::sort`](https://doc.rust-lang.org/std/primitive.slice.html#method.sort) | TimSort-like |

> **None of the standard libraries use Bubble Sort.** Bubble Sort is taught, not deployed.

---

## 3. Core Rules and Behavioral Specification

### Rule 1: Adjacent-Pair Compare-and-Swap

> *Knuth TAOCP §5.2.2:* "On each pass, compare each adjacent pair and exchange if out of order."

```python
# ✅ Correct — adjacent pair, in-place swap
if A[j] > A[j + 1]:
    A[j], A[j + 1] = A[j + 1], A[j]

# ❌ Incorrect — non-adjacent comparison (not Bubble Sort)
if A[j] > A[k]:  # k != j+1
    A[j], A[k] = A[k], A[j]
```

### Rule 2: Strict Greater-Than for Stability

> *Specification:* Bubble Sort must use **strict** `>` (not `>=`) to be stable.

```python
# ✅ Correct — stable
if A[j] > A[j + 1]:
    swap()

# ❌ Incorrect — destroys stability
if A[j] >= A[j + 1]:
    swap()
```

### Rule 3: Shrinking Inner Loop Bound

> *Optimization:* After pass `i`, the last `i+1` elements are in final sorted positions. Inner loop must not revisit them.

```python
# ✅ Correct
for j in range(0, n - 1 - i):
    ...

# ❌ Incorrect — wastes O(n) comparisons per pass (still correct, just slow)
for j in range(0, n - 1):
    ...
```

### Rule 4: Early-Exit Flag

> *Optimization:* If a complete pass performs no swaps, the array is sorted; terminate immediately.

```python
# ✅ Correct — adaptive
swapped = False
for j in range(...):
    if A[j] > A[j + 1]:
        swap()
        swapped = True
if not swapped:
    break
```

### Rule 5: Total Order Required

> *Precondition:* The comparison function must define a **total order** — reflexive, antisymmetric, transitive, and total. Non-total orders cause undefined behavior.

| Property | Requirement |
|----------|-------------|
| Reflexive | `cmp(a, a) = 0` |
| Antisymmetric | `cmp(a, b) < 0 ⇒ cmp(b, a) > 0` |
| Transitive | `cmp(a, b) < 0 ∧ cmp(b, c) < 0 ⇒ cmp(a, c) < 0` |
| Total | `∀ a, b: cmp(a, b)` is well-defined |

---

## 4. Schema / Parameters Reference

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `array` | mutable sequence of comparable elements | ✅ | — | Input to be sorted in place |
| `cmp` | function `(a, b) → int` | ❌ | natural order | Comparison function |
| `key` | function `T → K` (where K comparable) | ❌ | identity | Extract sort key from each element |
| `reverse` | boolean | ❌ | `false` | If true, sort descending |

**Returns:** `void` (in-place); some APIs return the array for chaining.

---

## 5. Behavioral Specification

### Normal Operation

For input `A` of length `n ≥ 2`:

1. **Pass 1:** Compare every adjacent pair from index 0 to n-2. Swap when out of order. The maximum reaches index n-1.
2. **Pass i (1 ≤ i ≤ n-2):** Compare adjacent pairs from 0 to n-1-i. Swap when out of order. The i-th largest reaches index n-i.
3. **Termination:** When pass i performs zero swaps (early-exit) OR i = n-1.

For inputs of length 0 or 1: return immediately, no work done.

### Documented Limitations

| Limitation | Details | Workaround |
|------------|---------|------------|
| O(n²) average case | Cannot beat Ω(n²) for adjacent-swap sorts | Use Insertion Sort (faster constant), Merge/Quick Sort (better Big-O) |
| Cache behavior | O(n²/B) cache misses on large n | Switch to cache-aware sort for n > L1/L2 size |
| No parallelism (sequential form) | Each pass depends on previous | Use Odd-Even Transposition variant for parallelism |
| Floating-point NaN | Undefined ordering with NaN | Filter NaN before sorting |

### Error / Failure Conditions

| Error | Condition | Resolution |
|-------|-----------|------------|
| `IndexOutOfBoundsException` / `IndexError` | Inner loop bound off by one (`j < n` instead of `j < n-1`) | Use `j < n - 1 - i` |
| Infinite loop | Comparator violates antisymmetry/transitivity | Verify comparator with property-based tests |
| Wrong order | Comparison operator reversed | Test with known input/output pairs |
| `NullPointerException` (Java) | Sorting array with null elements | Use `Comparator.nullsFirst(...)` or filter |
| Sort instability when expected | `>=` used instead of `>` | Replace with strict `>` |

---

## 6. Edge Cases

| Edge Case | Specified Behavior | Rationale |
|-----------|-------------------|-----------|
| Empty array `[]` | Return immediately, no operations | Outer loop body executes 0 times |
| Single element `[x]` | Return immediately | n-1 = 0 outer iterations |
| All equal `[5,5,5,5]` | One pass, zero swaps, early exit (O(n)) | No element > next; flag never set |
| Already sorted `[1,2,3,4]` | One pass, zero swaps, early exit (O(n)) | Best case |
| Reverse sorted `[5,4,3,2,1]` | Maximum swaps n(n-1)/2 (O(n²)) | Worst case |
| Two elements `[2,1]` | One swap, sorted | |
| Duplicates `[3,1,3,2,3]` | Stable: original order of 3s preserved | Strict `>` only |
| NaN in input | Undefined behavior | Comparison with NaN returns false |
| Integer overflow in swap-by-arithmetic | Possible | Use temp variable, not arithmetic |

---

## 7. Complexity Compatibility Matrix

| Input Size | Time (Worst) | Time (Best) | Memory | Notes |
|-----------|--------------|-------------|--------|-------|
| n ≤ 10 | < 0.1 µs | < 0.1 µs | O(1) | Competitive on tiny n |
| n = 100 | ~10 µs | ~1 µs | O(1) | Still tolerable |
| n = 1,000 | ~1 ms | ~10 µs | O(1) | Noticeable |
| n = 10,000 | ~100 ms | ~100 µs | O(1) | Slow |
| n = 100,000 | ~10 s | ~1 ms | O(1) | Unacceptable |
| n = 1,000,000 | ~17 min | ~10 ms | O(1) | Catastrophic |

### Comparator Compatibility

| Comparator Type | Compatible? | Notes |
|----------------|-------------|-------|
| Total order on integers | ✅ | Standard |
| Total order on strings (lex) | ✅ | |
| Floating-point (IEEE 754, no NaN) | ✅ | |
| Floating-point with NaN | ⚠️ | Behavior undefined; filter first |
| Custom comparator (transitive) | ✅ | Must satisfy total order axioms |
| Hash-code-based comparator | ❌ | Not transitive in general |
| Random comparator | ❌ | Causes infinite loops or wrong results |

---

## 8. Reference Implementations

### Knuth Algorithm B (TAOCP Vol. 3)

```text
Algorithm B (Bubble sort).
  Records R_1, R_2, ..., R_n with keys K_1, K_2, ..., K_n.
  This algorithm rearranges them so K_1 ≤ K_2 ≤ ... ≤ K_n.

B1. [Initialize BOUND.]   BOUND ← N.
B2. [Loop on j.]          t ← 0.
                          For j = 1, 2, ..., BOUND - 1, do step B3:
B3. [Compare/exchange R_j : R_{j+1}.]
                          If K_j > K_{j+1}, then exchange R_j ↔ R_{j+1},
                          and set t ← j.
B4. [Any exchanges?]      If t = 0, terminate.
                          Otherwise BOUND ← t and go back to B2.
```

This is the **adaptive** Bubble Sort (using last-swap-position to set the next bound) — slightly more efficient than the textbook "shrink by 1 per pass" variant.

### Reference: Knuth's Adaptive Variant

#### Go

```go
package main

import "fmt"

// BubbleSortKnuth implements Knuth's Algorithm B from TAOCP Vol. 3 §5.2.2.
func BubbleSortKnuth(arr []int) {
    n := len(arr)
    bound := n
    for {
        t := 0
        for j := 0; j < bound-1; j++ {
            if arr[j] > arr[j+1] {
                arr[j], arr[j+1] = arr[j+1], arr[j]
                t = j + 1
            }
        }
        if t == 0 {
            return
        }
        bound = t
    }
}

func main() {
    data := []int{5, 1, 4, 2, 8}
    BubbleSortKnuth(data)
    fmt.Println(data)
}
```

#### Java

```java
public class BubbleSortKnuth {
    public static void sort(int[] arr) {
        int n = arr.length;
        int bound = n;
        while (true) {
            int t = 0;
            for (int j = 0; j < bound - 1; j++) {
                if (arr[j] > arr[j + 1]) {
                    int tmp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = tmp;
                    t = j + 1;
                }
            }
            if (t == 0) return;
            bound = t;
        }
    }
}
```

#### Python

```python
def bubble_sort_knuth(arr):
    """Knuth's Algorithm B from TAOCP Vol. 3 §5.2.2."""
    n = len(arr)
    bound = n
    while True:
        t = 0
        for j in range(bound - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                t = j + 1
        if t == 0:
            return
        bound = t
```

---

## 9. Compliance & Best Practices Checklist

- [ ] Uses **strict `>`** comparison (preserves stability)
- [ ] Implements **early-exit flag** (achieves O(n) on sorted input)
- [ ] Implements **shrinking inner-loop bound** (avoids redundant comparisons)
- [ ] Handles **empty array** and **single element** safely
- [ ] Comparator (if custom) defines a **total order** (transitive, antisymmetric)
- [ ] Documents **in-place mutation** in function comment/docstring
- [ ] Does not use Bubble Sort for **n > 50** in production paths
- [ ] Includes **regression test** with adversarial input (reverse-sorted, all-equal, with duplicates)
- [ ] Uses language-native sort (`sort.Slice`, `Arrays.sort`, `sorted`) for production

---

## 10. Related Documentation

| Topic | Section | Reference |
|-------|---------|-----------|
| Insertion Sort | `../03-insertion-sort/` | Faster O(n²) alternative |
| Merge Sort | `../02-merge-sort/` | O(n log n), stable |
| Quick Sort | `../04-quick-sort/` | O(n log n) average, in-place |
| Selection Sort | `../05-selection-sort/` | Minimum-write O(n²) sort |
| Heap Sort | `../06-heap-sort/` | O(n log n), in-place |
| Big-O Notation | `../../06-algorithmic-complexity/04-asymptotic-notation/01-big-o-notation/` | Complexity foundations |
| Sorting Networks | (External) | [Knuth Vol. 3 §5.3.4](https://www-cs-faculty.stanford.edu/~knuth/taocp.html) |
| Pdqsort (Go's sort) | (External) | [Pdqsort paper, Peters 2021](https://arxiv.org/abs/2106.05123) |
| TimSort (Python/Java) | (External) | [TimSort original spec](https://github.com/python/cpython/blob/main/Objects/listsort.txt) |

---

> **Specification Notes:**
> - The "canonical" Bubble Sort is the textbook 2-loop form (CLRS Problem 2-2), but Knuth's Algorithm B (using the last-swap-position) is strictly faster on most inputs and is the recommended reference.
> - Standard library sorts in every major language are **NOT** Bubble Sort — they are O(n log n) hybrids (TimSort, Pdqsort, Dual-Pivot Quicksort).
> - Bubble Sort's only legitimate production niche is detecting "is this array already sorted?" in a single O(n) pass — and even there, a direct linear scan is more idiomatic.
