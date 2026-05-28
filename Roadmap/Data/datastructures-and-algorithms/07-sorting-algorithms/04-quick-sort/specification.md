# Quick Sort — Specification

> Source: [Hoare, "Quicksort" Computer Journal 1962](https://academic.oup.com/comjnl/article/5/1/10/395338),
> [CLRS Chapter 7](https://mitpress.mit.edu/9780262046305/),
> [Pdqsort paper, Peters 2021](https://arxiv.org/abs/2106.05123)

## 1. Algorithm Reference

| Property | Value |
|----------|-------|
| **Inventor** | Tony Hoare (1959) |
| **Class** | Comparison-based, divide-and-conquer, in-place |
| **Best Time** | O(n log n) — balanced partitions |
| **Average Time** | O(n log n) |
| **Worst Time** | O(n²) — vanilla; O(n log n) — Pdqsort/Introsort |
| **Auxiliary Space** | O(log n) — recursion stack |
| **Stable** | No (typical) |
| **In-place** | Yes |
| **Adaptive** | Pdqsort: yes; vanilla: no |

## 2. API

```text
QUICK_SORT(A: array of T, cmp: (T,T) → int) → void
  Sorts A in place using cmp.

PARTITION(A, lo, hi) → q
  Rearrange A[lo..hi] so that:
    A[lo..q-1] all ≤ A[q]
    A[q+1..hi] all ≥ A[q]
```

### Production Sort Functions

| Language | Function | Algorithm |
|----------|----------|-----------|
| Go | `slices.Sort` | **Pdqsort** |
| Rust | `slice::sort_unstable` | **Pdqsort** |
| Java (primitives) | `Arrays.sort(int[])` | **Dual-Pivot Quicksort** |
| C++ | `std::sort` | **Introsort** |
| Python | `sorted` | TimSort (NOT Quick Sort) |

## 3. Core Rules

### Rule 1: Pivot Choice

> Use random or median-of-three. NEVER first/last on possibly-sorted input.

```python
# ✅ Random
idx = random.randint(lo, hi)
arr[idx], arr[hi] = arr[hi], arr[idx]
pivot = arr[hi]

# ❌ First element on sorted → O(n²)
pivot = arr[lo]
```

### Rule 2: Recurse on Smaller Side First

> Bounds recursion stack to O(log n) even with bad pivots.

```python
if p - lo < hi - p:
    quicksort(arr, lo, p - 1); lo = p + 1
else:
    quicksort(arr, p + 1, hi); hi = p - 1
```

### Rule 3: Insertion Sort Cutoff

> For n ≤ 16-32, switch to Insertion Sort.

### Rule 4: 3-Way Partition for Duplicates

> If many equal elements, vanilla Quick Sort is O(n²). Use 3-way (Dutch flag).

## 4. Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| array | mutable T[] | ✅ | Input |
| cmp | (T,T)→int | ❌ | Comparator |
| pivot_strategy | string | ❌ | "first", "last", "random", "median3" |

## 5. Behavior

For input of length n ≥ 2:
1. Choose pivot per strategy.
2. Partition: rearrange so elements ≤ pivot are left, ≥ pivot are right.
3. Recursively sort left and right partitions.

## 6. Edge Cases

| Case | Behavior |
|------|----------|
| Empty | Return immediately |
| Single | Return immediately |
| All equal | O(n²) vanilla; O(n) with 3-way partition |
| Already sorted | O(n²) with first-as-pivot; O(n log n) with random |
| Reverse sorted | O(n²) with last-as-pivot; O(n log n) with random |
| Duplicates | Use 3-way partition |
| Linked list | Use Merge Sort instead |

## 7. Complexity

| n | Pdqsort | Vanilla Quick (random pivot) | Vanilla Quick (worst case) |
|---|---------|------------------------------|----------------------------|
| 1,000 | 0.05 ms | 0.07 ms | 1 ms |
| 10,000 | 0.5 ms | 0.8 ms | 100 ms |
| 100,000 | 5 ms | 10 ms | 10 s |
| 1,000,000 | 38 ms | 90 ms | 1000 s |

## 8. Reference Implementations

### CLRS Lomuto

```text
PARTITION(A, p, r):
  x = A[r]
  i = p - 1
  for j = p to r - 1:
    if A[j] <= x:
      i = i + 1
      exchange A[i] with A[j]
  exchange A[i+1] with A[r]
  return i + 1
```

### Hoare Original

```text
PARTITION(A, p, r):
  x = A[(p+r)/2]
  i = p - 1; j = r + 1
  loop:
    repeat i = i + 1 until A[i] >= x
    repeat j = j - 1 until A[j] <= x
    if i >= j: return j
    exchange A[i] with A[j]
```

## 9. Compliance Checklist

- [ ] Uses random or median-of-three pivot
- [ ] Implements Insertion Sort cutoff at n ≤ 16-32
- [ ] Recurses on smaller side first (tail-recursion optimization)
- [ ] Uses 3-way partition if duplicates expected
- [ ] Has introsort fallback (Heap Sort) if recursion depth excessive
- [ ] Handles empty array and single element
- [ ] Documents that the sort is NOT stable
- [ ] For production: use language built-in (Pdqsort/Dual-Pivot)

## 10. Related

- `../02-merge-sort/` — Stable, predictable O(n log n)
- `../03-insertion-sort/` — Quick Sort's small-array fallback
- `../06-heap-sort/` — Introsort's worst-case fallback
- `../05-selection-sort/` — Different O(n²) approach
- External: [Pdqsort paper](https://arxiv.org/abs/2106.05123), [Yaroslavskiy Dual-Pivot](https://web.archive.org/web/20151002230717/http://iaroslavski.narod.ru/quicksort/DualPivotQuicksort.pdf)
