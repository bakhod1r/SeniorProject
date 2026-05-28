# Logarithmic Time O(log n) — Standard Library Specification

## Table of Contents

- [Overview](#overview)
- [Go: sort.Search and sort.SearchInts](#go-sortsearch-and-sortsearchints)
- [Java: Arrays.binarySearch and Collections.binarySearch](#java-arraysbinarysearch-and-collectionsbinarysearch)
- [Python: bisect Module](#python-bisect-module)
- [Comparison Table](#comparison-table)
- [Common Pitfalls](#common-pitfalls)
- [Practical Usage Patterns](#practical-usage-patterns)
- [References](#references)

---

## Overview

Every major language provides built-in binary search implementations. These are heavily tested,
optimized, and handle edge cases correctly. Understanding their APIs, return value conventions,
and subtle differences is essential for writing correct and efficient code.

---

## Go: sort.Search and sort.SearchInts

### sort.Search

```go
func Search(n int, f func(int) bool) int
```

**Description:** `sort.Search` uses binary search to find the smallest index `i` in `[0, n)` for
which `f(i)` is true, assuming that on the range `[0, n)`, `f(i) == true` implies
`f(i+1) == true` (i.e., f transitions from false to true at most once).

**Returns:** The smallest index i where `f(i)` is true. If no such index exists, returns `n`.

**Time complexity:** O(log n).

**Key behavior:**
- This is a **generalized binary search** — it does not search an array directly but searches
  over a predicate.
- The predicate must be monotonic: false, false, ..., false, true, true, ..., true.
- If `f` is always false, returns `n`.
- If `f` is always true, returns `0`.

### Example Usage

```go
package main

import (
    "fmt"
    "sort"
)

func main() {
    // Basic: find index of value 6 in sorted slice
    arr := []int{1, 3, 5, 6, 8, 10, 12}

    idx := sort.Search(len(arr), func(i int) bool {
        return arr[i] >= 6
    })

    if idx < len(arr) && arr[idx] == 6 {
        fmt.Printf("Found 6 at index %d\n", idx) // Found 6 at index 3
    } else {
        fmt.Println("Not found")
    }

    // Find insertion point for 7
    insertIdx := sort.Search(len(arr), func(i int) bool {
        return arr[i] >= 7
    })
    fmt.Printf("Insert 7 at index %d\n", insertIdx) // Insert 7 at index 4
}
```

### sort.SearchInts

```go
func SearchInts(a []int, x int) int
```

**Description:** Convenience wrapper around `sort.Search` for `[]int`. Equivalent to:

```go
sort.Search(len(a), func(i int) bool { return a[i] >= x })
```

**Returns:** The smallest index where `a[i] >= x`. If x is greater than all elements, returns
`len(a)`.

**Important:** This is a **lower bound**, not an exact search. To check if the value exists:

```go
idx := sort.SearchInts(arr, target)
found := idx < len(arr) && arr[idx] == target
```

### sort.SearchFloat64s and sort.SearchStrings

Analogous functions exist for `[]float64` and `[]string`:

```go
func SearchFloat64s(a []float64, x float64) int
func SearchStrings(a []string, x string) int
```

### Slices Package (Go 1.21+)

Go 1.21 introduced the `slices` package with a more ergonomic API:

```go
import "slices"

// Returns index and whether the value was found
idx, found := slices.BinarySearch(arr, 6)

// For custom comparison
idx, found = slices.BinarySearchFunc(arr, target, func(a, b int) int {
    return a - b
})
```

---

## Java: Arrays.binarySearch and Collections.binarySearch

### Arrays.binarySearch

```java
public static int binarySearch(int[] a, int key)
public static int binarySearch(int[] a, int fromIndex, int toIndex, int key)
public static <T> int binarySearch(T[] a, T key, Comparator<? super T> c)
```

**Description:** Searches a sorted array for the specified key using binary search.

**Returns:**
- The index of the key if found.
- If NOT found: `-(insertion point) - 1`, where insertion point is the index at which the key
  would be inserted to keep the array sorted.

**Time complexity:** O(log n).

**Key behavior:**
- The array MUST be sorted in ascending order. If not sorted, the result is undefined.
- If the array contains multiple elements equal to the key, there is no guarantee which one will
  be found (it is not necessarily the first or last).
- The negative return value encoding is the most common source of bugs.

### Decoding the Return Value

```java
int[] arr = {2, 4, 6, 8, 10};

int idx = Arrays.binarySearch(arr, 6);
// idx = 2 (found at index 2)

idx = Arrays.binarySearch(arr, 5);
// idx = -3 (not found, would insert at index 2, so -(2) - 1 = -3)

// To get the insertion point from a negative result:
int insertionPoint = -(idx + 1);  // = 2
```

### Example Usage

```java
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.ArrayList;

public class BinarySearchSpec {
    public static void main(String[] args) {
        // Primitive array
        int[] arr = {2, 4, 6, 8, 10, 12, 14};

        System.out.println(Arrays.binarySearch(arr, 8));    // 3
        System.out.println(Arrays.binarySearch(arr, 5));    // -3

        // Range search (fromIndex inclusive, toIndex exclusive)
        System.out.println(Arrays.binarySearch(arr, 2, 5, 8));  // 3

        // Object array with Comparator
        String[] names = {"alice", "bob", "charlie", "dave"};
        System.out.println(Arrays.binarySearch(names, "charlie")); // 2

        // Collections.binarySearch for List
        List<Integer> list = new ArrayList<>(List.of(2, 4, 6, 8, 10));
        System.out.println(Collections.binarySearch(list, 6));  // 2
        System.out.println(Collections.binarySearch(list, 7));  // -4
    }
}
```

### Collections.binarySearch

```java
public static <T> int binarySearch(List<? extends Comparable<? super T>> list, T key)
public static <T> int binarySearch(List<? extends T> list, T key, Comparator<? super T> c)
```

**Description:** Same semantics as `Arrays.binarySearch` but for `List`.

**Performance note:** If the list implements `RandomAccess` (e.g., `ArrayList`), binary search
runs in O(log n). For linked lists (`LinkedList`), it degrades to O(n) because each index access
is O(n). The implementation detects this and falls back to an iterator-based approach.

### TreeMap and TreeSet

Java's `TreeMap` and `TreeSet` (backed by Red-Black trees) provide O(log n) operations:

```java
TreeMap<Integer, String> map = new TreeMap<>();
map.put(10, "ten");
map.put(20, "twenty");
map.put(30, "thirty");

map.get(20);              // O(log n) lookup
map.floorKey(25);         // 20 — largest key <= 25
map.ceilingKey(25);       // 30 — smallest key >= 25
map.subMap(10, 30);       // range query [10, 30)
```

---

## Python: bisect Module

### Module Functions

```python
bisect.bisect_left(a, x, lo=0, hi=len(a), *, key=None)
bisect.bisect_right(a, x, lo=0, hi=len(a), *, key=None)
bisect.bisect(a, x, lo=0, hi=len(a), *, key=None)       # alias for bisect_right
bisect.insort_left(a, x, lo=0, hi=len(a), *, key=None)
bisect.insort_right(a, x, lo=0, hi=len(a), *, key=None)
bisect.insort(a, x, lo=0, hi=len(a), *, key=None)        # alias for insort_right
```

### bisect_left

**Description:** Find the leftmost position where `x` can be inserted in `a` to keep it sorted.
Equivalent to the **lower bound** — the first index where `a[i] >= x`.

**Returns:** An index in `[lo, hi]`.

**Time complexity:** O(log n) for the search. Note that `insort_left` is O(n) due to the
insertion shifting elements.

### bisect_right / bisect

**Description:** Find the rightmost position where `x` can be inserted in `a` to keep it sorted.
Equivalent to the **upper bound** — the first index where `a[i] > x`.

**Returns:** An index in `[lo, hi]`.

### key Parameter (Python 3.10+)

The `key` parameter allows searching by a transformation of the elements:

```python
import bisect

# Search by absolute value
data = [-10, -5, 0, 3, 7, 12]
idx = bisect.bisect_left(data, 4, key=abs)
# Finds position based on |data[i]| >= 4
```

### Example Usage

```python
import bisect

arr = [1, 3, 3, 5, 7, 9, 11]

# Find first index >= 3 (lower bound)
print(bisect.bisect_left(arr, 3))   # 1

# Find first index > 3 (upper bound)
print(bisect.bisect_right(arr, 3))  # 3

# Check if value exists
def binary_search(a, x):
    i = bisect.bisect_left(a, x)
    return i < len(a) and a[i] == x

print(binary_search(arr, 5))   # True
print(binary_search(arr, 6))   # False

# Count occurrences
def count(a, x):
    return bisect.bisect_right(a, x) - bisect.bisect_left(a, x)

print(count(arr, 3))  # 2

# Insert maintaining order
bisect.insort(arr, 4)
print(arr)  # [1, 3, 3, 4, 5, 7, 9, 11]

# Range query: find all elements in [3, 7]
lo = bisect.bisect_left(arr, 3)
hi = bisect.bisect_right(arr, 7)
print(arr[lo:hi])  # [3, 3, 4, 5, 7]
```

### Implementation Note

The `bisect` module is implemented in C (in CPython), making it significantly faster than a
pure-Python binary search. For performance-critical code, always prefer `bisect` over manual
implementation.

### SortedContainers (Third-Party)

For a full sorted data structure (like Java's TreeMap), Python developers commonly use
`sortedcontainers`:

```python
from sortedcontainers import SortedList

sl = SortedList([3, 1, 4, 1, 5, 9])
# Automatically sorted: [1, 1, 3, 4, 5, 9]

sl.add(2)        # O(log n) insertion
sl.remove(4)     # O(log n) removal
sl.bisect_left(3) # O(log n) search
```

---

## Comparison Table

| Feature                | Go (sort.Search)      | Java (Arrays.binarySearch)   | Python (bisect)         |
|------------------------|-----------------------|------------------------------|-------------------------|
| Return (found)         | index of first >= x   | index of element             | index of first >= x     |
| Return (not found)     | insertion point       | -(insertion point) - 1       | insertion point         |
| Duplicates behavior    | first >= x            | any matching element         | leftmost/rightmost      |
| Custom comparator      | predicate function    | Comparator object            | key function (3.10+)    |
| Range search           | pass slice bounds     | fromIndex, toIndex params    | lo, hi params           |
| Sorted container       | N/A (use a library)   | TreeMap / TreeSet            | sortedcontainers        |
| Implementation         | Pure Go               | Pure Java                    | C extension (CPython)   |

---

## Common Pitfalls

### 1. Forgetting to sort first

All binary search functions require sorted input. Calling them on unsorted data produces
undefined results without any error or warning.

### 2. Java's negative return value

```java
int idx = Arrays.binarySearch(arr, target);
// WRONG: if (idx != -1) → -1 is actually a valid "not found" only if insertion point is 0
// RIGHT: if (idx >= 0)
```

### 3. Go's Search returns insertion point, not exact match

```go
idx := sort.SearchInts(arr, target)
// WRONG: assuming arr[idx] == target
// RIGHT: check idx < len(arr) && arr[idx] == target
```

### 4. Python's bisect does not tell you if the element exists

```python
idx = bisect.bisect_left(arr, target)
# WRONG: assuming arr[idx] == target
# RIGHT: idx < len(arr) and arr[idx] == target
```

### 5. Duplicates with Java's binarySearch

`Arrays.binarySearch` does NOT guarantee finding the first or last occurrence. Use manual lower
bound / upper bound if you need that guarantee.

---

## Practical Usage Patterns

### Pattern 1: Existence Check

```go
// Go
idx := sort.SearchInts(arr, target)
exists := idx < len(arr) && arr[idx] == target
```

```java
// Java
boolean exists = Arrays.binarySearch(arr, target) >= 0;
```

```python
# Python
idx = bisect.bisect_left(arr, target)
exists = idx < len(arr) and arr[idx] == target
```

### Pattern 2: Range Count (how many elements in [lo, hi])

```go
// Go
start := sort.SearchInts(arr, lo)
end := sort.Search(len(arr), func(i int) bool { return arr[i] > hi })
count := end - start
```

```java
// Java
int start = lowerBound(arr, lo);    // custom implementation needed
int end = upperBound(arr, hi);      // custom implementation needed
int count = end - start;
```

```python
# Python
count = bisect.bisect_right(arr, hi) - bisect.bisect_left(arr, lo)
```

### Pattern 3: Insert While Maintaining Order

```go
// Go — manual (no built-in insort)
idx := sort.SearchInts(arr, val)
arr = append(arr, 0)
copy(arr[idx+1:], arr[idx:])
arr[idx] = val
```

```java
// Java — use TreeSet or manual insertion
TreeSet<Integer> set = new TreeSet<>();
set.add(val);  // O(log n)
```

```python
# Python — elegant with bisect
bisect.insort(arr, val)  # O(log n) search + O(n) shift
```

---

## References

1. Go Documentation — [sort package](https://pkg.go.dev/sort).
2. Go Documentation — [slices package](https://pkg.go.dev/slices) (Go 1.21+).
3. Java Documentation — [Arrays.binarySearch](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Arrays.html).
4. Java Documentation — [Collections.binarySearch](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Collections.html).
5. Python Documentation — [bisect module](https://docs.python.org/3/library/bisect.html).
6. Bloch, J. "Extra, Extra — Read All About It: Nearly All Binary Searches and Mergesorts are Broken," 2006.
