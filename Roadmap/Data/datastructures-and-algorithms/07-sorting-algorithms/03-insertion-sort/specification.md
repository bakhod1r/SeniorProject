# Insertion Sort — Specification

> Source: [CLRS §2.1](https://mitpress.mit.edu/9780262046305/), [Knuth TAOCP Vol. 3 §5.2.1](https://www-cs-faculty.stanford.edu/~knuth/taocp.html)

## 1. Algorithm Reference

| Property | Value |
|----------|-------|
| **Class** | Comparison-based, in-place, stable, adaptive, online |
| **Best Time** | O(n) — already sorted |
| **Average Time** | O(n²) |
| **Worst Time** | O(n²) — reverse sorted |
| **Auxiliary Space** | O(1) |
| **Stable** | Yes (with strict `>`) |
| **In-place** | Yes |
| **Adaptive** | Yes — Θ(n + I) where I = inversions |
| **Online** | Yes — can sort streaming data |

## 2. API

```text
INSERTION_SORT(A: array of T, cmp: (T,T) → int) → void
  Sorts A in place ascending per cmp.
```

## 3. Core Rules

### Rule 1: Strict `>` for Stability

```python
# ✅ Stable
while j >= 0 and arr[j] > x:

# ❌ Unstable
while j >= 0 and arr[j] >= x:
```

### Rule 2: Save Element Before Shifting

```python
# ✅
x = arr[i]
# ... shift loop
arr[j+1] = x

# ❌
# Forgetting `x = arr[i]` before the shift loop loses the original value.
```

### Rule 3: Shift, Don't Swap

```python
# ✅ One write per shift
arr[j+1] = arr[j]

# ❌ Three writes per swap
tmp = arr[j+1]; arr[j+1] = arr[j]; arr[j] = tmp
```

## 4. Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| array | mutable array of T | ✅ | Input |
| cmp | (T,T) → int | ❌ | Comparator (default: natural order) |

## 5. Behavior

For input of length n ≥ 2:
1. For each i from 1 to n-1: insert A[i] into sorted prefix A[0..i-1] by shifting larger elements right.

## 6. Edge Cases

| Case | Behavior |
|------|----------|
| Empty `[]` | Outer loop body skipped |
| Single `[x]` | Loop body executes 0 iterations |
| Already sorted | O(n) — best case |
| Reverse sorted | O(n²) — worst case |
| All equal | O(n) — strict `>` triggers no shifts |
| With duplicates | Stable: original order preserved |

## 7. Complexity

| n | Best | Worst |
|---|------|-------|
| 100 | < 1 µs | 30 µs |
| 1,000 | 5 µs | 600 µs |
| 10,000 | 50 µs | 60 ms |
| 100,000 | 500 µs | 6 s |

## 8. Reference Implementations

### CLRS Reference

```text
INSERTION-SORT(A)
  for i = 1 to A.length - 1
    key = A[i]
    j = i - 1
    while j >= 0 and A[j] > key
      A[j + 1] = A[j]
      j = j - 1
    A[j + 1] = key
```

### Knuth Algorithm S (TAOCP)

```text
S1. [Loop on j.] For j = 2, 3, ..., N do steps S2 through S5.
S2. [Set up i, K, R.] i ← j - 1; K ← K_j; R ← R_j.
S3. [Compare K : K_i.] If K >= K_i, go to S5.
S4. [Move R_i, decrease i.] R_{i+1} ← R_i. i ← i - 1. If i > 0 go to S3.
S5. [R into R_{i+1}.] R_{i+1} ← R.
```

## 9. Compliance Checklist

- [ ] Strict `>` for stability
- [ ] Save key BEFORE shift loop
- [ ] Use shift (not swap)
- [ ] Handle empty/single base cases
- [ ] For production: use as small-array fallback, not standalone

## 10. Related

- `../01-bubble-sort/` — Slower O(n²) sibling
- `../05-selection-sort/` — Same Big-O, fewer writes
- `../02-merge-sort/` — TimSort hybrid uses Insertion for small arrays
- `../04-quick-sort/` — Pdqsort hybrid uses Insertion below 24
