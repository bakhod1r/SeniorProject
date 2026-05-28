# Insertion Sort — Find the Bug

## Bug 1: Used `>=` (Loses Stability)
```python
while j >= 0 and arr[j] >= x:  # BUG
```
**Fix:** `arr[j] > x`. With `>=`, equal elements get re-arranged.

## Bug 2: Forgot to Save `x` Before Shift
```python
def insertion_sort(arr):
    for i in range(1, len(arr)):
        j = i - 1
        while j >= 0 and arr[j] > arr[i]:  # BUG: arr[i] gets overwritten
            arr[j+1] = arr[j]; j -= 1
        arr[j+1] = arr[i]  # arr[i] is now wrong
```
**Fix:** `x = arr[i]` BEFORE the inner loop.

## Bug 3: Off-by-One — Inner Writes `arr[j]` Instead of `arr[j+1]`
```python
arr[j] = arr[j-1]  # BUG: should be arr[j+1] = arr[j]
```
**Fix:** Write to `arr[j+1]`.

## Bug 4: Outer Starts at 0
```python
for i in range(0, len(arr)):  # BUG: should start at 1
    x = arr[i]; j = i - 1  # j = -1 → no shift, ok... but useless work
    while j >= 0 and arr[j] > x: ...
```
**Fix:** `range(1, len(arr))` — skip the 0th iteration.

## Bug 5: Forgot `j >= 0` Guard
```python
while arr[j] > x:  # BUG: no bound check
    arr[j+1] = arr[j]; j -= 1
```
**Fix:** `while j >= 0 and arr[j] > x:` — IndexError otherwise.

## Bug 6: Wrong Direction (Sorts Descending Accidentally)
```python
while j >= 0 and arr[j] < x:  # BUG: should be >
```
**Fix:** `>` for ascending.

## Bug 7: Used Swap (3× More Writes)
```python
while j >= 0 and arr[j] > arr[j+1]:
    arr[j], arr[j+1] = arr[j+1], arr[j]
    j -= 1
```
This works but is 3× slower. **Fix:** Use the shift pattern (assignment).

## Bug 8: Didn't Decrement `j`
```python
while j >= 0 and arr[j] > x:
    arr[j+1] = arr[j]
    # BUG: forgot j -= 1 → infinite loop
arr[j+1] = x
```
**Fix:** `j -= 1` at end of inner loop.

## Bug 9: NaN Causes Silent Failure
```python
import math
data = [3.0, math.nan, 1.0]
insertion_sort(data)  # NaN comparisons all return False
```
**Fix:** Pre-filter NaN.

## Bug 10: Comparator Subtraction Overflow (Java)
```java
Arrays.sort(arr, (a, b) -> a - b);  // BUG: Integer.MIN_VALUE - MAX overflows
```
**Fix:** `Integer::compare`.

## Bug 11: Linked-List Insertion Forgets to Update Tail
```python
def linked_insert(head, new_node):
    # ... insert new_node somewhere
    # BUG: didn't update the previous node's .next
```
**Fix:** Always re-link both `prev.next = new_node` and `new_node.next = old_next`.

## Bug 12: Online Insert Doesn't Handle Empty List
```python
def online_insert(arr, x):
    arr.append(0)
    i = len(arr) - 2
    while arr[i] > x:  # BUG: when arr was empty, i = -1, IndexError
        arr[i+1] = arr[i]; i -= 1
```
**Fix:** Add `if not arr: arr.append(x); return` early-out, or `while i >= 0 and arr[i] > x:`.

---

## Summary
| # | Bug | Severity |
|---|-----|----------|
| 1 | `>=` for stability | Silent |
| 2 | Lost `x` | Wrong output |
| 3 | Wrong write index | Wrong output |
| 4 | i=0 start | Wasteful (not bug) |
| 5 | No j>=0 | Crash |
| 6 | Wrong direction | Wrong order |
| 7 | Swap not shift | Slow |
| 8 | No j-- | Infinite loop |
| 9 | NaN | Silent corruption |
| 10 | x-y overflow | Edge bug |
| 11 | Linked-list re-link | Crash |
| 12 | Empty list | Crash |
