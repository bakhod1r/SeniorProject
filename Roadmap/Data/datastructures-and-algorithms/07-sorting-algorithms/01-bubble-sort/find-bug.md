# Bubble Sort — Find the Bug

> 12 buggy implementations across **Go**, **Java**, **Python**. Find, explain, and fix.

---

## Exercise 1: Off-by-One in Inner Loop

### Go (Buggy)

```go
func bubbleSort(arr []int) {
    n := len(arr)
    for i := 0; i < n-1; i++ {
        for j := 0; j < n; j++ {  // BUG
            if arr[j] > arr[j+1] {
                arr[j], arr[j+1] = arr[j+1], arr[j]
            }
        }
    }
}
```

### Java (Buggy)

```java
public static void bubbleSort(int[] arr) {
    int n = arr.length;
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n; j++) {  // BUG
            if (arr[j] > arr[j + 1]) {
                int t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t;
            }
        }
    }
}
```

### Python (Buggy)

```python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        for j in range(n):  # BUG
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
```

**Bug:** Inner loop accesses `arr[j+1]` when `j = n-1`, going out of bounds.

**Symptom:** `IndexError` / `panic: runtime error: index out of range` / `ArrayIndexOutOfBoundsException`.

### Fix

```python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        for j in range(n - 1 - i):  # Fixed: shrinking bound
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
```

```go
for j := 0; j < n-1-i; j++ {
```

```java
for (int j = 0; j < n - 1 - i; j++) {
```

---

## Exercise 2: Early-Exit Flag Never Reset

### Go (Buggy)

```go
func bubbleSort(arr []int) {
    n := len(arr)
    swapped := false  // BUG: declared outside outer loop
    for i := 0; i < n-1; i++ {
        for j := 0; j < n-1-i; j++ {
            if arr[j] > arr[j+1] {
                arr[j], arr[j+1] = arr[j+1], arr[j]
                swapped = true
            }
        }
        if !swapped {
            return
        }
    }
}
```

### Python (Buggy)

```python
def bubble_sort(arr):
    n = len(arr)
    swapped = False  # BUG
    for i in range(n - 1):
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        if not swapped:
            return
```

**Bug:** `swapped` is initialized once at the start. After the first swap it stays `True` forever — early exit never triggers.

**Symptom:** Sort works correctly but never benefits from early exit. Performance same as no-early-exit version.

### Fix

```python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        swapped = False  # Fixed: reset each outer iteration
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        if not swapped:
            return
```

---

## Exercise 3: Unstable Sort (Used `>=` Instead of `>`)

### Go (Buggy)

```go
func bubbleSort(arr []int) {
    n := len(arr)
    for i := 0; i < n-1; i++ {
        for j := 0; j < n-1-i; j++ {
            if arr[j] >= arr[j+1] {  // BUG: should be >
                arr[j], arr[j+1] = arr[j+1], arr[j]
            }
        }
    }
}
```

### Python (Buggy)

```python
def bubble_sort_pairs(pairs):
    """Sort by first element of each tuple."""
    n = len(pairs)
    for i in range(n - 1):
        for j in range(n - 1 - i):
            if pairs[j][0] >= pairs[j + 1][0]:  # BUG
                pairs[j], pairs[j + 1] = pairs[j + 1], pairs[j]
```

**Bug:** Strict `>` keeps equal elements in place (stable). `>=` swaps them, breaking stability.

**Symptom:** With duplicate keys, original order is reversed. Test:
```python
data = [(1, 'A'), (1, 'B'), (1, 'C')]
# Expected (stable):  [(1,'A'), (1,'B'), (1,'C')]
# Buggy result:       [(1,'C'), (1,'B'), (1,'A')]
```

### Fix

```python
if pairs[j][0] > pairs[j + 1][0]:  # strict greater than only
```

---

## Exercise 4: Wrong Loop Variable in Comparison

### Go (Buggy)

```go
func bubbleSort(arr []int) {
    n := len(arr)
    for i := 0; i < n-1; i++ {
        for j := 0; j < n-1-i; j++ {
            if arr[i] > arr[i+1] {  // BUG: should be arr[j] and arr[j+1]
                arr[j], arr[j+1] = arr[j+1], arr[j]
            }
        }
    }
}
```

### Python (Buggy)

```python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        for j in range(n - 1 - i):
            if arr[i] > arr[i + 1]:  # BUG
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
```

**Bug:** Compares `arr[i]` and `arr[i+1]` (outer loop variable!) instead of `arr[j]` and `arr[j+1]`.

**Symptom:** Output is wildly incorrect. Either no swaps (if `arr[i] <= arr[i+1]` happens to hold) or many wrong swaps.

### Fix

```python
if arr[j] > arr[j + 1]:  # use INNER loop variable
    arr[j], arr[j + 1] = arr[j + 1], arr[j]
```

---

## Exercise 5: Inner Loop Starts at 1 Instead of 0

### Java (Buggy)

```java
public static void bubbleSort(int[] arr) {
    int n = arr.length;
    for (int i = 0; i < n - 1; i++) {
        for (int j = 1; j < n - 1 - i; j++) {  // BUG: starts at 1
            if (arr[j] > arr[j + 1]) {
                int t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t;
            }
        }
    }
}
```

### Python (Buggy)

```python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        for j in range(1, n - 1 - i):  # BUG: range(1, ...)
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
```

**Bug:** Inner loop skips index 0. The pair `(arr[0], arr[1])` is never compared, so the array's first two elements may end up out of order.

**Symptom:** `[5, 3, 1, 2, 4]` → `[5, 1, 2, 3, 4]` (the leading `5` and `1` never swap).

### Fix

```python
for j in range(0, n - 1 - i):
```

---

## Exercise 6: Swap That Doesn't Swap (Aliasing Bug)

### Java (Buggy)

```java
public static void bubbleSort(int[] arr) {
    int n = arr.length;
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - 1 - i; j++) {
            if (arr[j] > arr[j + 1]) {
                arr[j] = arr[j + 1];      // BUG: lost original arr[j]
                arr[j + 1] = arr[j];      // now both equal
            }
        }
    }
}
```

### Go (Buggy)

```go
func bubbleSort(arr []int) {
    n := len(arr)
    for i := 0; i < n-1; i++ {
        for j := 0; j < n-1-i; j++ {
            if arr[j] > arr[j+1] {
                arr[j] = arr[j+1]   // BUG
                arr[j+1] = arr[j]   // both = original arr[j+1]
            }
        }
    }
}
```

### Python (Buggy)

```python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                arr[j] = arr[j + 1]   # BUG
                arr[j + 1] = arr[j]
```

**Bug:** Without a temporary variable (or tuple-assignment), the second assignment uses the *new* value of `arr[j]`. Both elements become the smaller value; the larger is lost.

**Symptom:** `[5, 1, 4, 2, 8]` → `[1, 1, 4, 2, 8]` (lost the `5`).

### Fix (all three languages)

```python
arr[j], arr[j + 1] = arr[j + 1], arr[j]  # tuple assignment
```

```go
arr[j], arr[j+1] = arr[j+1], arr[j]
```

```java
int tmp = arr[j];
arr[j] = arr[j + 1];
arr[j + 1] = tmp;
```

---

## Exercise 7: Outer Loop Off-By-One

### Python (Buggy)

```python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n):  # BUG: should be n-1
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
```

**Bug:** When `i = n-1`, inner range is `range(n-1-(n-1)) = range(0)` — empty, harmless.

**Symptom:** No actual error, but one extra useless outer iteration. Wastes a tiny amount of time.

**Why it's still a bug:** It signals that the developer doesn't understand "we need at most n-1 passes." In code review this should be flagged for clarity.

### Fix

```python
for i in range(n - 1):
```

---

## Exercise 8: Modifying List During Iteration (Python)

### Python (Buggy)

```python
def remove_duplicates_then_sort(arr):
    """Remove duplicates and sort with bubble sort."""
    for x in arr:
        if arr.count(x) > 1:
            arr.remove(x)  # BUG: modifying list during iteration
    bubble_sort(arr)

def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
```

**Bug:** `arr.remove(x)` while iterating `arr` skips elements. Also, it's O(n²) just for dedup.

**Symptom:** Some duplicates remain; then bubble sort works on the half-deduped array.

### Fix

```python
def remove_duplicates_then_sort(arr):
    arr[:] = list(set(arr))  # dedup via set, then assign back
    bubble_sort(arr)
```

Or, preserving order:
```python
seen = set()
arr[:] = [x for x in arr if not (x in seen or seen.add(x))]
```

---

## Exercise 9: Comparator Returns Boolean Instead of Int (Java)

### Java (Buggy)

```java
import java.util.Comparator;

public class BubbleSortGeneric<T> {
    public static <T> void sort(T[] arr, Comparator<T> cmp) {
        int n = arr.length;
        for (int i = 0; i < n - 1; i++) {
            boolean swapped = false;
            for (int j = 0; j < n - 1 - i; j++) {
                if (cmp.compare(arr[j], arr[j + 1]) > 0) {
                    T t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t;
                    swapped = true;
                }
            }
            if (!swapped) return;
        }
    }

    public static void main(String[] args) {
        Integer[] a = {3, 1, 2};
        // BUG: this comparator subtracts which can overflow
        sort(a, (x, y) -> x - y);
        System.out.println(java.util.Arrays.toString(a));
    }
}
```

**Bug:** `(x, y) -> x - y` works for small ints but **overflows for `Integer.MIN_VALUE - Integer.MAX_VALUE`**, returning a positive number when it should be negative. Sort silently incorrect for extreme values.

**Symptom:** Sorting `[Integer.MIN_VALUE, Integer.MAX_VALUE, 0]` produces wrong order.

### Fix

```java
sort(a, Integer::compare);  // safe — uses Integer.compare which avoids overflow
```

Or:
```java
sort(a, (x, y) -> Integer.compare(x, y));
```

---

## Exercise 10: Recursive Bubble Sort with Wrong Base Case

### Python (Buggy)

```python
def bubble_sort_recursive(arr, n=None):
    if n is None:
        n = len(arr)
    if n == 0:  # BUG: should be n <= 1
        return
    # One pass: bubble largest to end
    for j in range(n - 1):
        if arr[j] > arr[j + 1]:
            arr[j], arr[j + 1] = arr[j + 1], arr[j]
    bubble_sort_recursive(arr, n - 1)
```

### Go (Buggy)

```go
func bubbleSortRec(arr []int, n int) {
    if n == 0 {  // BUG
        return
    }
    for j := 0; j < n-1; j++ {
        if arr[j] > arr[j+1] {
            arr[j], arr[j+1] = arr[j+1], arr[j]
        }
    }
    bubbleSortRec(arr, n-1)
}
```

**Bug:** When `n = 0`, the loop `range(n-1) = range(-1)` is empty, so we don't crash — but for `n = 1`, the inner loop is also empty, then we recurse with `n = 0`. So it terminates, just inefficient: one extra recursion.

A subtler issue: if you typo it as `if n < 0:`, you'd recurse with `n = 0`, then `n = -1`, then `range(-2)` (still empty) — and then `n = -2`, infinite recursion → stack overflow.

**Symptom (with `n < 0`):** `RecursionError: maximum recursion depth exceeded`.

### Fix

```python
if n <= 1:  # base case: 0 or 1 element is sorted
    return
```

---

## Exercise 11: NaN-in-Input Silent Corruption

### Python (Buggy)

```python
import math

def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]

data = [3.0, math.nan, 1.0, 2.0]
bubble_sort(data)
print(data)  # might print [1.0, nan, 2.0, 3.0] or some other arrangement
```

**Bug:** `nan > x` is always `False`, and `x > nan` is always `False`. So `nan` is never swapped, but elements around it are shuffled inconsistently. Result is **not sorted** and depends on `nan`'s position.

**Symptom:** Sort silently produces an unsorted array when NaN is present. No error raised.

### Fix

Pre-filter or detect NaN:
```python
import math
def bubble_sort_safe(arr):
    if any(isinstance(x, float) and math.isnan(x) for x in arr):
        raise ValueError("NaN in input — sort order undefined")
    bubble_sort(arr)
```

Or push NaNs to the end:
```python
nans = [x for x in arr if isinstance(x, float) and math.isnan(x)]
real = [x for x in arr if not (isinstance(x, float) and math.isnan(x))]
bubble_sort(real)
arr[:] = real + nans
```

---

## Exercise 12: Cocktail Sort Wrong Direction Bound

### Python (Buggy)

```python
def cocktail_sort(arr):
    n = len(arr)
    start, end = 0, n - 1
    swapped = True
    while swapped:
        swapped = False
        # Forward pass
        for j in range(start, end):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        # BUG: should decrement end here
        if not swapped:
            break
        # Backward pass
        for j in range(end, start, -1):
            if arr[j - 1] > arr[j]:
                arr[j - 1], arr[j] = arr[j], arr[j - 1]
                swapped = True
        # BUG: should increment start here
```

### Go (Buggy)

```go
func cocktailSort(arr []int) {
    n := len(arr)
    start, end := 0, n-1
    swapped := true
    for swapped {
        swapped = false
        for j := start; j < end; j++ {
            if arr[j] > arr[j+1] {
                arr[j], arr[j+1] = arr[j+1], arr[j]
                swapped = true
            }
        }
        // BUG: end not decremented
        for j := end; j > start; j-- {
            if arr[j-1] > arr[j] {
                arr[j-1], arr[j] = arr[j], arr[j-1]
                swapped = true
            }
        }
        // BUG: start not incremented
    }
}
```

**Bug:** Without shrinking `start`/`end`, the algorithm still works (it's just slower — passes traverse already-sorted elements). But: in the **wrong** order or with a missing `if not swapped: break` between passes, we may also get a subtle infinite-loop risk.

The deeper cocktail-sort bug: after a forward pass the largest is at `end`. We should decrement `end` so we don't waste a backward pass on it. Similarly, after a backward pass, increment `start`.

### Fix

```python
def cocktail_sort(arr):
    n = len(arr)
    start, end = 0, n - 1
    while start < end:
        swapped = False
        for j in range(start, end):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        if not swapped:
            break
        end -= 1  # Fixed
        for j in range(end, start, -1):
            if arr[j - 1] > arr[j]:
                arr[j - 1], arr[j] = arr[j], arr[j - 1]
                swapped = True
        start += 1  # Fixed
```

---

## Bonus Exercise: Subtle Concurrency Bug

### Go (Buggy — race condition)

```go
package main

import (
    "fmt"
    "sync"
)

var sharedArr = []int{5, 1, 4, 2, 8}

func bubbleSortConcurrent(wg *sync.WaitGroup) {
    defer wg.Done()
    n := len(sharedArr)
    for i := 0; i < n-1; i++ {
        for j := 0; j < n-1-i; j++ {
            if sharedArr[j] > sharedArr[j+1] {
                sharedArr[j], sharedArr[j+1] = sharedArr[j+1], sharedArr[j]
            }
        }
    }
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 4; i++ {  // BUG: 4 goroutines mutating same slice
        wg.Add(1)
        go bubbleSortConcurrent(&wg)
    }
    wg.Wait()
    fmt.Println(sharedArr)
}
```

**Bug:** Multiple goroutines mutate `sharedArr` without synchronization. Run with `go run -race main.go` — race detector will flag it.

**Symptom:** Non-deterministic output. Sometimes sorted, sometimes corrupted, sometimes panic.

### Fix

```go
var (
    sharedArr = []int{5, 1, 4, 2, 8}
    mu        sync.Mutex
)

func bubbleSortConcurrent(wg *sync.WaitGroup) {
    defer wg.Done()
    mu.Lock()
    defer mu.Unlock()
    // ... existing sort
}
```

Or better: don't share — give each goroutine its own copy.

---

## Summary of Bugs

| # | Bug | Severity | Detectability |
|---|-----|----------|--------------|
| 1 | Inner loop off-by-one | Crash | High (test crashes) |
| 2 | Early-exit flag never reset | Performance | Low (passes correctness) |
| 3 | `>=` instead of `>` (instability) | Correctness (silent) | Medium (stability tests) |
| 4 | Wrong loop variable in comparison | Logic error | High (output wrong) |
| 5 | Inner loop starts at 1 | Logic error | Medium (some inputs OK) |
| 6 | Aliasing in swap | Data loss | High (visible in output) |
| 7 | Outer loop off-by-one | Performance | Low (one extra useless pass) |
| 8 | Modifying list during iteration | Correctness | Medium (some elements skipped) |
| 9 | Comparator overflow (`x - y`) | Edge case | Low (extreme values only) |
| 10 | Wrong recursive base case | Stack overflow | Medium (test on small inputs) |
| 11 | NaN in input | Silent corruption | Low (no error raised) |
| 12 | Cocktail sort wrong bounds | Performance | Low (still correct) |
| Bonus | Concurrent mutation | Race condition | High (with `-race`) |

**Lessons:**
1. Always include the **shrinking inner-loop bound** AND **early-exit flag**.
2. Use **strict `>`** for stability.
3. Use **tuple-swap** (Python/Go) or **tempvar swap** (Java/C) — never two-step assignment.
4. **Run race detectors** for any concurrent code.
5. **Use comparators** that don't overflow (`Integer.compare`, not `x - y`).
6. **Filter NaN** before sorting floats.
