# Binary Search — Find the Bug

> 12 buggy implementations across **Go**, **Java**, **Python**.

---

## Bug 1: Integer Overflow in `mid` Calculation

### Java (Buggy)

```java
int mid = (lo + hi) / 2;  // BUG: lo + hi can overflow when both are near Integer.MAX_VALUE
```

**Symptom:** For arrays with > 2³⁰ elements, `lo + hi` becomes negative → `mid` is negative → `IndexOutOfBoundsException`.

**Fix:** Use difference-based:
```java
int mid = lo + (hi - lo) / 2;
```

The Go and Python equivalents have the same fix. (Python ints don't overflow, but the pattern is still recommended for portability.)

---

## Bug 2: `lo <= hi` vs `lo < hi`

### Python (Buggy)

```python
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo < hi:  # BUG: should be <=
        mid = lo + (hi - lo) // 2
        if arr[mid] == target: return mid
        elif arr[mid] < target: lo = mid + 1
        else: hi = mid - 1
    return -1
```

**Symptom:** When target is the last unchecked element with `lo == hi`, loop exits without checking it → returns -1 even when target is present.

**Fix:**
```python
while lo <= hi:
```

---

## Bug 3: Infinite Loop When `mid` Doesn't Advance

### Go (Buggy)

```go
func binarySearch(arr []int, target int) int {
    lo, hi := 0, len(arr)
    for lo < hi {
        mid := (lo + hi) / 2
        if arr[mid] == target { return mid
        } else if arr[mid] < target { lo = mid  // BUG: should be mid + 1
        } else { hi = mid }
    }
    return -1
}
```

**Symptom:** When `lo + 1 == hi`, `mid == lo`. If `arr[lo] < target`, `lo = mid = lo` — infinite loop.

**Fix:** `lo = mid + 1` (always advance past mid).

---

## Bug 4: Returns Wrong Index for Duplicates

### Python (Buggy)

```python
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target: return mid  # BUG: returns ANY occurrence, not first
        elif arr[mid] < target: lo = mid + 1
        else: hi = mid - 1
    return -1
```

**Symptom:** For `[1, 2, 2, 2, 3]`, searching for `2` may return index 1, 2, or 3 — not necessarily the first.

**Fix (find first occurrence):**
```python
def find_first(arr, target):
    lo, hi = 0, len(arr) - 1
    result = -1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            result = mid
            hi = mid - 1  # keep searching left
        elif arr[mid] < target: lo = mid + 1
        else: hi = mid - 1
    return result
```

---

## Bug 5: Empty Array Handling

### Java (Buggy)

```java
public static int binarySearch(int[] arr, int target) {
    int lo = 0, hi = arr.length - 1;  // hi = -1 if empty
    while (lo <= hi) { ... }
    return -1;
}
```

**Symptom:** With empty array: `hi = -1`, `lo = 0`. The condition `lo <= hi` is false (0 ≤ -1 is false), so loop is skipped. Returns -1 correctly **by luck**. But some impls compute `mid` first and crash.

**Fix:** Explicit guard:
```java
if (arr.length == 0) return -1;
```

---

## Bug 6: Recursive Stack Overflow on Bad Bounds

### Python (Buggy)

```python
def binary_search_rec(arr, target, lo=None, hi=None):
    if lo is None: lo = 0
    if hi is None: hi = len(arr) - 1
    if lo > hi: return -1
    mid = (lo + hi) // 2
    if arr[mid] == target: return mid
    if arr[mid] < target:
        return binary_search_rec(arr, target, mid, hi)  # BUG: should be mid+1
    return binary_search_rec(arr, target, lo, mid)      # BUG: should be mid-1
```

**Symptom:** Same as Bug 3 — infinite recursion → `RecursionError`.

**Fix:** `mid + 1` and `mid - 1`.

---

## Bug 7: Wrong Direction (`lo = mid` vs `lo = mid + 1`)

Same root cause as Bug 3 — must always advance past the tested mid.

```python
elif arr[mid] < target:
    lo = mid  # BUG → infinite loop
```

**Fix:** `lo = mid + 1`.

---

## Bug 8: Comparator NaN Issue (Floats)

### Python (Buggy)

```python
import math
data = [1.0, 2.0, math.nan, 4.0]  # NOT actually sorted because NaN
result = bisect.bisect_left(data, 3.0)  # undefined
```

**Symptom:** Binary search relies on total order. NaN breaks transitivity (`NaN < x` and `x < NaN` both False). Result is undefined.

**Fix:** Filter NaN before sorting/searching.

---

## Bug 9: Search on Unsorted Data — Silent Failure

### Go (Buggy)

```go
arr := []int{5, 2, 8, 1, 9}  // NOT sorted!
idx := binarySearch(arr, 1)  // returns -1 even though 1 is present
```

**Symptom:** Binary search precondition violated. Returns wrong answer with no error.

**Fix:** Sort first, OR validate the precondition:
```go
if !sort.IntsAreSorted(arr) {
    panic("binary search requires sorted input")
}
```

In production, document the precondition rigorously and rely on caller correctness.

---

## Bug 10: `-1` vs Insertion Point Inconsistency

### Java (Buggy)

```java
// java.util.Arrays.binarySearch returns:
//   - non-negative index if found
//   - -(insertion_point) - 1 if NOT found
int idx = Arrays.binarySearch(arr, target);
if (idx >= 0) {
    System.out.println("Found at " + idx);
} else {
    System.out.println("Not found, would insert at " + (-idx));  // BUG: off by 1
}
```

**Symptom:** Insertion point is `-idx - 1`, not `-idx`.

**Fix:**
```java
int insertionPoint = -idx - 1;
```

This is the standard contract — easy to misread.

---

## Bug 11: Ternary Tree Confusion

### Python (Buggy)

```python
def buggy_ternary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if arr[m1] == target: return m1
        if arr[m2] == target: return m2
        if target < arr[m1]: hi = m1 - 1
        elif target > arr[m2]: lo = m2 + 1
        else:
            lo = m1 + 1
            hi = m2 - 1  # OK — search middle third
    return -1
```

**Issue:** Ternary search works for **unimodal functions**, NOT for sorted-array search. For sorted arrays, ternary search does MORE comparisons than binary search (3 vs 2 per third, log₃ levels but more work per level → log₃(n) × 2 ≈ log₂(n) × 1.26 — strictly worse).

**Fix:** Use binary search for sorted arrays. Use ternary search only for finding extrema of unimodal functions.

---

## Bug 12: Search Rotated Array — Off-by-One with Duplicates

### Python (Buggy)

```python
def search_rotated(arr, target):
    """Search in rotated sorted array; assume distinct elements."""
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target: return mid
        # determine sorted half
        if arr[lo] <= arr[mid]:  # BUG: with duplicates, this assumption fails
            if arr[lo] <= target < arr[mid]: hi = mid - 1
            else: lo = mid + 1
        else:
            if arr[mid] < target <= arr[hi]: lo = mid + 1
            else: hi = mid - 1
    return -1
```

**Symptom:** With duplicates like `[1, 1, 1, 0, 1]`, `arr[lo] == arr[mid]` doesn't tell us which half is sorted → wrong direction taken → wrong result.

**Fix:** Add a special case for `arr[lo] == arr[mid]`:
```python
if arr[lo] == arr[mid] == arr[hi]:
    lo += 1; hi -= 1  # can't decide; shrink window
    continue
```

This makes worst case O(n) with duplicates (LeetCode 81).

---

## Summary

| # | Bug | Severity |
|---|-----|----------|
| 1 | mid overflow | Crash on huge n |
| 2 | `<` vs `<=` | Misses last element |
| 3 | `lo = mid` | Infinite loop |
| 4 | Returns any-occurrence | Wrong for duplicates |
| 5 | Empty array | Crash (sometimes) |
| 6 | Recursive bad bounds | Stack overflow |
| 7 | Direction wrong | Infinite loop |
| 8 | NaN | Undefined behavior |
| 9 | Unsorted input | Silent wrong answer |
| 10 | Insertion point off-by-one | Wrong index returned |
| 11 | Ternary on sorted | Slower than binary |
| 12 | Rotated + duplicates | Wrong direction |

**Lessons:**
1. Use `lo + (hi - lo) // 2` to avoid overflow.
2. Use `<=` and `mid+1`/`mid-1` to ensure progress.
3. For duplicates, write explicit "find first" / "find last" variants.
4. Always document and check sortedness precondition.
5. Use language built-ins (`bisect`, `Arrays.binarySearch`, `slices.BinarySearch`) — they have these bugs already fixed.
