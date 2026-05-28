# Merge Sort — Specification

> **Algorithm Specification — Reference Standard**
>
> Source: [Knuth, *TAOCP Vol. 3* — Section 5.2.4](https://www-cs-faculty.stanford.edu/~knuth/taocp.html) (sorting by merging)
> Source: [CLRS, *Introduction to Algorithms* — Chapter 2.3 (Merge Sort) and Chapter 4 (Master Theorem)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/)
> Source: [TimSort original spec](https://github.com/python/cpython/blob/main/Objects/listsort.txt)

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
| **Name** | Merge Sort |
| **Inventor** | John von Neumann (1945) |
| **Reference** | Knuth TAOCP Vol. 3 §5.2.4; CLRS §2.3 |
| **Class** | Divide-and-conquer, comparison-based, stable |
| **Best Time** | O(n log n) — same as average/worst (vanilla); O(n) for TimSort variant |
| **Average Time** | O(n log n) |
| **Worst Time** | O(n log n) |
| **Auxiliary Space (array)** | O(n) |
| **Auxiliary Space (linked list)** | O(log n) — recursion stack only |
| **Adaptive** | No (vanilla); Yes (TimSort variant) |
| **Stable** | Yes |
| **External-friendly** | Yes — standard external sort algorithm |

---

## 2. API / Interface Reference

### Standard Function Signature

```text
MERGE_SORT(A: array of T, cmp: (T, T) → int) → array of T  [or in-place]
  Sorts A using cmp.
  
Postcondition:
  ∀ i ∈ [0, n-2]: cmp(A[i], A[i+1]) ≤ 0
  AND A is a permutation of the original input.
  AND for any two equal elements, original order is preserved (stability).
```

### Language-Specific Implementations

| Language | Standard Sort | Algorithm |
|----------|--------------|-----------|
| Python | [`sorted`](https://docs.python.org/3/library/functions.html#sorted), [`list.sort`](https://docs.python.org/3/library/stdtypes.html#list.sort) | **TimSort** (Merge + Insertion hybrid) |
| Java | [`Arrays.sort(Object[])`](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Arrays.html#sort(java.lang.Object%5B%5D)), [`Collections.sort`](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Collections.html#sort(java.util.List)) | **TimSort** |
| Java (primitives) | [`Arrays.sort(int[])`](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Arrays.html#sort(int%5B%5D)) | Dual-Pivot Quicksort (NOT Merge Sort) |
| Go | [`slices.SortStableFunc`](https://pkg.go.dev/slices#SortStableFunc) | **Stable Quicksort** with Merge for stability |
| Rust | [`slice::sort`](https://doc.rust-lang.org/std/primitive.slice.html#method.sort) | **TimSort-like** (default is stable) |
| C++ | [`std::stable_sort`](https://en.cppreference.com/w/cpp/algorithm/stable_sort) | **Merge Sort** |
| C++ | [`std::sort`](https://en.cppreference.com/w/cpp/algorithm/sort) | Introsort (Quick + Heap, NOT stable) |
| JavaScript | [`Array.prototype.sort`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort) | **TimSort** (V8, since 2018) |

> **Pattern:** All major stable sorts in modern runtimes are based on Merge Sort (TimSort or vanilla).

---

## 3. Core Rules and Behavioral Specification

### Rule 1: Recursive Structure (Top-Down)

> *CLRS §2.3:* "If the input length is greater than one, divide it in half, recursively sort the two halves, and then merge them."

```python
# ✅ Correct
def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    return merge(merge_sort(arr[:mid]), merge_sort(arr[mid:]))

# ❌ Incorrect — wrong base case
def merge_sort(arr):
    if len(arr) == 0:  # missing single-element case
        return arr
    mid = len(arr) // 2
    return merge(merge_sort(arr[:mid]), merge_sort(arr[mid:]))
    # infinite recursion on single-element arrays
```

### Rule 2: Stability via `<=` in Merge

> *Specification:* The merge step must use `<=` (not `<`) to preserve stability.

```python
# ✅ Correct — stable
if left[i] <= right[j]:
    result.append(left[i]); i += 1

# ❌ Incorrect — unstable
if left[i] < right[j]:
    result.append(left[i]); i += 1
# When left[i] == right[j], takes from right first → reverses original order
```

### Rule 3: Avoid Integer Overflow in Mid Calculation

> *CLRS errata:* `(low + high) / 2` overflows for arrays of size > 2³¹/2 = ~10⁹ on 32-bit ints.

```text
# ✅ Correct — overflow-safe
mid = low + (high - low) / 2

# ❌ Incorrect — overflow risk
mid = (low + high) / 2
```

### Rule 4: Single Auxiliary Buffer for Performance

> *Sedgewick Algorithms 4ed §2.2:* "Allocating the auxiliary array as a local variable in the merge() method is a wasteful practice... allocate space for the auxiliary array in the public sort() method just once."

```python
# ✅ Correct — one allocation
def merge_sort(arr):
    aux = [0] * len(arr)
    _sort(arr, aux, 0, len(arr) - 1)

# ❌ Incorrect — allocates per recursive call
def merge_sort(arr):
    if len(arr) <= 1: return arr
    return merge(merge_sort(arr[:mid]), merge_sort(arr[mid:]))
    # [:mid] and [mid:] create new arrays at every recursion level
```

### Rule 5: Comparator Must Define a Total Order

> *Java Comparator contract:* "The implementor must ensure that sgn(compare(x, y)) == -sgn(compare(y, x)) ... and ((compare(x, y)>0) && (compare(y, z)>0)) implies compare(x, z)>0."

| Property | Required |
|----------|----------|
| Reflexive | cmp(a, a) == 0 |
| Antisymmetric | sign(cmp(a, b)) == -sign(cmp(b, a)) |
| Transitive | cmp(a, b) ≤ 0 ∧ cmp(b, c) ≤ 0 → cmp(a, c) ≤ 0 |
| Total | cmp(a, b) defined for all a, b |

Violating these causes undefined behavior (may infinite-loop, may produce wrong order).

---

## 4. Schema / Parameters Reference

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `array` | mutable sequence of T | ✅ | — | Input to be sorted |
| `cmp` | function (T, T) → int | ❌ | natural order | Comparison function |
| `key` | function T → K | ❌ | identity | Extract sort key from each element |
| `reverse` | boolean | ❌ | false | If true, sort descending (Python convention) |
| `aux_buffer` | optional T[] of size n | ❌ | allocated internally | Preallocated auxiliary buffer for in-place variant |

**Returns:** Either the sorted array (functional style) or `void` (in-place mutation). Convention varies by language.

---

## 5. Behavioral Specification

### Normal Operation

For input `A` of length `n ≥ 2`:

1. Split A into A_left (first ⌈n/2⌉ elements) and A_right (last ⌊n/2⌋ elements).
2. Recursively merge_sort(A_left) → sorted L.
3. Recursively merge_sort(A_right) → sorted R.
4. Merge L and R into output, taking smaller of L[i] and R[j] at each step (taking from L on ties).

For inputs of length 0 or 1: return immediately, no work done.

### Documented Limitations

| Limitation | Details | Workaround |
|------------|---------|------------|
| O(n) auxiliary space | Always allocates buffer for merge | Use in-place merge sort (block sort) — slower in practice |
| Stack overflow on huge n | Recursion depth = log n; ~10⁹ elements may exceed Python default | Use bottom-up iterative merge sort |
| Not adaptive (vanilla) | O(n log n) even on sorted input | Use TimSort variant (detects runs) |
| Memory bandwidth bound | Writes O(n log n) bytes | Use Quick Sort for cache-bound numeric sorts |
| Float NaN handling | Undefined ordering with NaN | Pre-filter NaN |

### Error / Failure Conditions

| Error | Condition | Resolution |
|-------|-----------|------------|
| `RecursionError` / `StackOverflowError` | Recursion depth exceeded | Switch to iterative bottom-up merge sort |
| `MemoryError` / `OutOfMemoryError` | n too large to allocate aux buffer | Use external merge sort (chunks on disk) |
| `IndexError` / `panic: index out of range` | Off-by-one in merge bounds | Check `i < len(L)` AND `j < len(R)` |
| Sort instability | Used `<` instead of `<=` | Replace with `<=` in merge condition |
| Wrong order on duplicates | Comparator returns inconsistent result | Verify comparator total order |

---

## 6. Edge Cases

| Edge Case | Specified Behavior | Rationale |
|-----------|-------------------|-----------|
| Empty array `[]` | Return immediately | Base case `len <= 1` |
| Single element `[x]` | Return immediately | Base case |
| Two elements `[2, 1]` | Split into `[2]`, `[1]`, merge → `[1, 2]` | |
| All equal `[5, 5, 5, 5]` | Sort O(n log n); stability preserved | Each merge has all ties |
| Already sorted | Sort O(n log n) (vanilla); O(n) (TimSort) | Vanilla doesn't detect |
| Reverse sorted | Sort O(n log n); maximum number of merges with full work | |
| Duplicates | Stable: original order of equals preserved | Use `<=` |
| Floating-point with NaN | Undefined behavior | Filter NaN before sorting |
| Sorting `null` (Java) | NullPointerException by default | Use `Comparator.nullsFirst(...)` |
| Generic types in Go | Use generics (Go 1.18+) or `sort.Interface` | |
| Linked list | Use slow/fast pointer to find midpoint | O(log n) recursion stack only |

---

## 7. Complexity Compatibility Matrix

| Input Size | Time | Memory (Aux) | Notes |
|-----------|------|--------------|-------|
| n ≤ 16 | < 0.1 ms | O(n) | Switch to Insertion Sort for speedup |
| n = 1,000 | ~0.1 ms | 8 KB | Trivial |
| n = 100,000 | ~10 ms | 800 KB | Standard production case |
| n = 10,000,000 | ~1 s | 80 MB | Memory-aware code needed |
| n = 1,000,000,000 (in RAM) | ~120 s | 8 GB | Requires large-heap JVM / 64-bit Python |
| n = 10,000,000,000 (> RAM) | hours | external sort | Use external merge sort |

### Comparator Compatibility

| Comparator Type | Compatible? | Notes |
|----------------|-------------|-------|
| Total order on integers | ✅ | Standard |
| Total order on strings | ✅ | Lexicographic |
| Floating-point (IEEE 754) | ⚠️ | NaN problematic — filter first |
| Custom transitive comparator | ✅ | Must satisfy total order axioms |
| Comparator using subtraction (`x - y`) | ❌ | Overflow risk — use `Integer.compare` |
| Random comparator | ❌ | Causes infinite recursion or wrong order |

---

## 8. Reference Implementations

### CLRS Reference (Sentinel-Based Merge)

```text
MERGE-SORT(A, p, r):
  if p < r:
      q = ⌊(p + r) / 2⌋
      MERGE-SORT(A, p, q)
      MERGE-SORT(A, q + 1, r)
      MERGE(A, p, q, r)

MERGE(A, p, q, r):
  n₁ = q - p + 1
  n₂ = r - q
  let L[1..n₁ + 1] and R[1..n₂ + 1] be new arrays
  for i = 1 to n₁: L[i] = A[p + i - 1]
  for j = 1 to n₂: R[j] = A[q + j]
  L[n₁ + 1] = ∞
  R[n₂ + 1] = ∞
  i = 1; j = 1
  for k = p to r:
      if L[i] ≤ R[j]:
          A[k] = L[i]; i = i + 1
      else:
          A[k] = R[j]; j = j + 1
```

### Sedgewick Reference (No Sentinels)

#### Java

```java
public class MergeSort {
    private static int[] aux;

    public static void sort(int[] a) {
        aux = new int[a.length];
        sort(a, 0, a.length - 1);
    }

    private static void sort(int[] a, int lo, int hi) {
        if (hi <= lo) return;
        int mid = lo + (hi - lo) / 2;
        sort(a, lo, mid);
        sort(a, mid + 1, hi);
        merge(a, lo, mid, hi);
    }

    private static void merge(int[] a, int lo, int mid, int hi) {
        for (int k = lo; k <= hi; k++) aux[k] = a[k];
        int i = lo, j = mid + 1;
        for (int k = lo; k <= hi; k++) {
            if      (i > mid)         a[k] = aux[j++];
            else if (j > hi)          a[k] = aux[i++];
            else if (aux[j] < aux[i]) a[k] = aux[j++];
            else                      a[k] = aux[i++];
        }
    }
}
```

### TimSort Reference

See [TimSort original specification](https://github.com/python/cpython/blob/main/Objects/listsort.txt) for the complete algorithm including:
- Run detection
- minrun calculation
- Merge stack invariants (`A > B + C` and `B > C`)
- Galloping mode

---

## 9. Compliance & Best Practices Checklist

- [ ] Uses `<=` (not `<`) in merge to preserve **stability**
- [ ] Uses `mid = lo + (hi - lo) / 2` to **avoid integer overflow**
- [ ] Allocates **single auxiliary buffer** in the public entry point, not per recursive call
- [ ] Switches to **Insertion Sort** for subarrays smaller than ~16 elements (cutoff)
- [ ] Skips merge step when `arr[mid] <= arr[mid+1]` (already sorted detection)
- [ ] Handles **empty array** and **single element** as base cases
- [ ] Comparator (if custom) defines a **total order**
- [ ] Documents **mutation** vs. **return new array** convention
- [ ] For huge n, uses **bottom-up iterative** to avoid stack overflow
- [ ] For data > RAM, uses **external merge sort** with k-way merge
- [ ] For linked lists, uses **slow/fast pointer** to find midpoint (no array conversion)

---

## 10. Related Documentation

| Topic | Section | Reference |
|-------|---------|-----------|
| Bubble Sort | `../01-bubble-sort/` | O(n²) ancestor |
| Insertion Sort | `../03-insertion-sort/` | TimSort's small-array fallback |
| Quick Sort | `../04-quick-sort/` | In-memory alternative |
| Heap Sort | `../06-heap-sort/` | O(1) space alternative |
| Big-O Notation | `../../06-algorithmic-complexity/04-asymptotic-notation/` | |
| Master Theorem | (External) | [CLRS §4.5](https://mitpress.mit.edu/9780262046305/) |
| TimSort | (External) | [Tim Peters' notes](https://github.com/python/cpython/blob/main/Objects/listsort.txt) |
| External Sort | (External) | [Garcia-Molina, "Database Systems"](https://www.pearson.com/) |
| Cache-Oblivious Merge Sort | (External) | [Frigo, Leiserson, et al., 1999](https://www.cs.cmu.edu/~guyb/papers/oblivious.pdf) |

---

> **Specification Notes:**
> - Merge Sort is the **only** standard sort that's both **stable** and **worst-case O(n log n)**. This combination is why it (or its hybrid TimSort) dominates production runtimes.
> - For arrays in dense numeric workloads, Quick Sort variants (Pdqsort, Dual-Pivot QS) often beat Merge Sort due to cache locality.
> - For object arrays with comparator-based sort, TimSort dominates because it's stable, predictable, and adaptive.
> - For external sort (data > RAM), Merge Sort is the *de facto* standard — there is no practical competitor.
> - The `<=` vs `<` choice in the merge step is the **single most important detail** — it's the difference between stable and unstable.
