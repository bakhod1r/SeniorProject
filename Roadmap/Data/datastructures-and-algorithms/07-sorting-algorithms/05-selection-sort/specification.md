# Selection Sort — Specification

> Source: [CLRS Problem 2-2 variant](https://mitpress.mit.edu/9780262046305/), [Knuth TAOCP Vol. 3 §5.2.3](https://www-cs-faculty.stanford.edu/~knuth/taocp.html)

## 1. Algorithm Reference

| Property | Value |
|----------|-------|
| **Class** | Comparison-based, in-place, NOT stable, NOT adaptive |
| **Best Time** | Θ(n²) |
| **Average Time** | Θ(n²) |
| **Worst Time** | Θ(n²) |
| **Auxiliary Space** | O(1) |
| **Swaps** | n - 1 (minimum among non-cycle-sort algorithms) |
| **Stable** | No (typical) |

## 2. API

```text
SELECTION_SORT(A, cmp) → void
  Sorts A in place ascending per cmp.
```

**Note:** No standard library uses Selection Sort as the default — it's a teaching/embedded-systems algorithm only.

## 3. Core Rules

### Rule 1: Find Minimum, Then Swap

```python
min_idx = i
for j in range(i + 1, n):
    if arr[j] < arr[min_idx]: min_idx = j
if min_idx != i:
    arr[i], arr[min_idx] = arr[min_idx], arr[i]
```

### Rule 2: Inner Loop Starts at `i + 1`

> Don't compare `arr[i]` with itself.

```python
for j in range(i + 1, n):  # not range(i, n)
```

### Rule 3: Skip Self-Swap

> Saves one no-op write when min is already in place.

## 4. Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| array | mutable T[] | ✅ | Input |
| cmp | (T,T)→int | ❌ | Comparator |

## 5. Behavior

For input of length n ≥ 2:
1. For i = 0 to n-2: find min of A[i..n-1], swap to A[i].

## 6. Edge Cases

| Case | Behavior |
|------|----------|
| Empty | Return immediately |
| Single | No-op |
| All equal | No swaps; n²/2 comparisons |
| Already sorted | No swaps; n²/2 comparisons |
| Reverse sorted | n-1 swaps; n²/2 comparisons |
| Duplicates | Not stable; relative order may change |

## 7. Complexity

| n | Time | Swaps |
|---|------|-------|
| 100 | 30 µs | 99 |
| 1,000 | 600 µs | 999 |
| 10,000 | 80 ms | 9,999 |
| 100,000 | 8 s | 99,999 |

## 8. Reference Implementation

```text
SELECTION-SORT(A):
  for i = 0 to length(A) - 2:
    smallest = i
    for j = i + 1 to length(A) - 1:
      if A[j] < A[smallest]:
        smallest = j
    exchange A[i] with A[smallest]
```

## 9. Compliance Checklist

- [ ] Inner loop starts at `i + 1`
- [ ] Skip self-swap when `min_idx == i`
- [ ] Documents that sort is NOT stable
- [ ] For production: prefer Insertion Sort (faster) or built-in
- [ ] Use Selection Sort only when minimizing writes is critical

## 10. Related

- `../03-insertion-sort/` — Same Big-O, faster on most data
- `../06-heap-sort/` — Selection Sort with a heap → O(n log n)
- `../01-bubble-sort/` — Slower O(n²) sibling
- External: Cycle Sort (true minimum-write sort)
