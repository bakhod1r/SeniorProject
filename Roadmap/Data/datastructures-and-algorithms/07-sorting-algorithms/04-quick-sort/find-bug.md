# Quick Sort — Find the Bug

## Bug 1: First-Element Pivot on Sorted Input (O(n²))
```python
def partition(arr, lo, hi):
    pivot = arr[lo]  # BUG: O(n²) on sorted
```
**Fix:** Random or median-of-three.

## Bug 2: Off-by-One in Recursion Bounds
```python
quick_sort(arr, lo, p)      # BUG: includes pivot
quick_sort(arr, p, hi)
```
**Fix:** `quick_sort(arr, lo, p-1)` and `quick_sort(arr, p+1, hi)`.

## Bug 3: Hoare Partition Returns Wrong Boundary
```python
quick_sort(arr, lo, p-1)    # BUG: Hoare returns inside-partition index
quick_sort(arr, p+1, hi)    #      Should be (lo, p) and (p+1, hi)
```
**Fix:** Use `(lo, p)` and `(p+1, hi)` for Hoare partition.

## Bug 4: Lomuto Partition Off-by-One
```python
def partition(arr, lo, hi):
    pivot = arr[hi]
    i = lo  # BUG: should be lo - 1
    for j in range(lo, hi):
        if arr[j] <= pivot:
            arr[i], arr[j] = arr[j], arr[i]
            i += 1
    arr[i+1], arr[hi] = arr[hi], arr[i+1]  # wrong index
```
**Fix:** `i = lo - 1`, then increment before swap.

## Bug 5: Forgetting to Place Pivot Correctly (Lomuto)
```python
def partition(arr, lo, hi):
    pivot = arr[hi]
    i = lo - 1
    for j in range(lo, hi):
        if arr[j] <= pivot:
            i += 1
            arr[i], arr[j] = arr[j], arr[i]
    return i + 1  # BUG: forgot to swap pivot to position i+1
```
**Fix:** Add `arr[i+1], arr[hi] = arr[hi], arr[i+1]` before return.

## Bug 6: Infinite Loop in Hoare (Bad Pivot Choice)
```python
def hoare(arr, lo, hi):
    pivot = arr[hi]  # BUG: using hi as pivot can cause infinite loop in Hoare
    i, j = lo - 1, hi + 1
    while True:
        i += 1
        while arr[i] < pivot: i += 1
        # ...
```
**Fix:** Hoare needs `pivot = arr[(lo+hi)//2]` (or similar middle); `arr[hi]` causes infinite loop.

## Bug 7: O(n²) on All-Equal Input (No 3-Way Partition)
```python
data = [5] * 10000
quick_sort(data)  # O(n²) — vanilla Quick Sort on all equal
```
**Fix:** Use 3-way partition.

## Bug 8: Stack Overflow on Bad Pivot
```python
import sys
sys.setrecursionlimit(2000)
quick_sort(list(range(10000)))  # RecursionError
```
**Fix:** Tail-recursion optimization (recurse on smaller side).

## Bug 9: Comparator Subtraction Overflow (Java)
```java
Arrays.sort(arr, (a, b) -> a - b);  // overflow on extreme values
```
**Fix:** `Integer::compare`.

## Bug 10: Modifying Slice Aliases (Go)
```go
func quickSort(arr []int) {
    if len(arr) <= 1 { return }
    p := partition(arr, 0, len(arr)-1)
    quickSort(arr[:p])      // ok — modifies same underlying
    quickSort(arr[p+1:])    // ok
}
```
This actually WORKS but is subtle. Bug-prone if you start passing copies — be consistent.

## Bug 11: 3-Way Partition Wrong Pointer Update
```python
while i <= gt:
    if arr[i] < pivot:
        arr[lt], arr[i] = arr[i], arr[lt]
        lt += 1  # BUG: forgot to advance i
```
**Fix:** Advance `i` AND `lt` when swapping with lt region.

## Bug 12: Random Pivot Not Re-Seeded for Tests
```python
import random
random.seed(42)
# Result is deterministic; "random" pivot doesn't help against adversarial input
```
**Fix:** Don't seed in production. Use `random.SystemRandom()` for cryptographic security.

---

## Summary
| # | Bug | Severity |
|---|-----|----------|
| 1 | First as pivot | O(n²) on sorted |
| 2 | Off-by-one bounds | Wrong sort or infinite recursion |
| 3 | Hoare bound mismatch | Wrong sort |
| 4 | Lomuto i init | Wrong pivot position |
| 5 | Missing pivot swap | Wrong sort |
| 6 | Hoare bad pivot | Infinite loop |
| 7 | All-equal | O(n²) |
| 8 | Stack overflow | Crash |
| 9 | Comparator overflow | Edge case wrong |
| 10 | Slice aliasing | Subtle |
| 11 | 3-way pointer bug | Wrong sort |
| 12 | Seeded random | No DoS protection |
