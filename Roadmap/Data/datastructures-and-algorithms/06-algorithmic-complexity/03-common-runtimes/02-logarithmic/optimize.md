# Logarithmic Time O(log n) — Optimization Exercises

## Table of Contents

- [Exercise 1: Find Target in Sorted Array](#exercise-1-find-target-in-sorted-array)
- [Exercise 2: Count Occurrences of a Value](#exercise-2-count-occurrences-of-a-value)
- [Exercise 3: Check if Value Exists in BST](#exercise-3-check-if-value-exists-in-bst)
- [Exercise 4: Compute x^n](#exercise-4-compute-xn)
- [Exercise 5: Find Insertion Point](#exercise-5-find-insertion-point)
- [Exercise 6: Find Floor and Ceiling](#exercise-6-find-floor-and-ceiling)
- [Exercise 7: Search in Sorted Matrix Row](#exercise-7-search-in-sorted-matrix-row)
- [Exercise 8: Find Peak in Mountain Array](#exercise-8-find-peak-in-mountain-array)
- [Exercise 9: Minimum Pages Allocation](#exercise-9-minimum-pages-allocation)
- [Exercise 10: Frequency Lookup System](#exercise-10-frequency-lookup-system)
- [Exercise 11: Find Closest Value in Sorted Array](#exercise-11-find-closest-value-in-sorted-array)
- [Exercise 12: Compute GCD](#exercise-12-compute-gcd)

---

## Exercise 1: Find Target in Sorted Array

### Slow Version — O(n)

```go
// Go — O(n) linear scan
func findTarget(arr []int, target int) int {
    for i, v := range arr {
        if v == target {
            return i
        }
    }
    return -1
}
```

```java
// Java — O(n) linear scan
public static int findTarget(int[] arr, int target) {
    for (int i = 0; i < arr.length; i++) {
        if (arr[i] == target) return i;
    }
    return -1;
}
```

```python
# Python — O(n) linear scan
def find_target(arr: list[int], target: int) -> int:
    for i, v in enumerate(arr):
        if v == target:
            return i
    return -1
```

### Optimized Version — O(log n)

The array is sorted. Use binary search to eliminate half the search space each step.

```go
// Go — O(log n) binary search
func findTarget(arr []int, target int) int {
    left, right := 0, len(arr)-1
    for left <= right {
        mid := left + (right-left)/2
        if arr[mid] == target {
            return mid
        } else if arr[mid] < target {
            left = mid + 1
        } else {
            right = mid - 1
        }
    }
    return -1
}
```

```java
// Java — O(log n) binary search
public static int findTarget(int[] arr, int target) {
    int left = 0, right = arr.length - 1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (arr[mid] == target) return mid;
        else if (arr[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1;
}
```

```python
# Python — O(log n) binary search
def find_target(arr: list[int], target: int) -> int:
    left, right = 0, len(arr) - 1
    while left <= right:
        mid = left + (right - left) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1
```

**Why it is faster:** Binary search halves the search space each iteration. For n = 1,000,000,
linear scan does up to 1,000,000 comparisons; binary search does at most 20.

---

## Exercise 2: Count Occurrences of a Value

### Slow Version — O(n)

```go
func countOccurrences(arr []int, target int) int {
    count := 0
    for _, v := range arr {
        if v == target {
            count++
        }
    }
    return count
}
```

```java
public static int countOccurrences(int[] arr, int target) {
    int count = 0;
    for (int v : arr) {
        if (v == target) count++;
    }
    return count;
}
```

```python
def count_occurrences(arr: list[int], target: int) -> int:
    return arr.count(target)  # O(n) internally
```

### Optimized Version — O(log n)

Use two binary searches: lower bound (first occurrence) and upper bound (first element after).

```go
func countOccurrences(arr []int, target int) int {
    lo := lowerBound(arr, target)
    if lo == len(arr) || arr[lo] != target {
        return 0
    }
    hi := upperBound(arr, target)
    return hi - lo
}

func lowerBound(arr []int, target int) int {
    left, right := 0, len(arr)
    for left < right {
        mid := left + (right-left)/2
        if arr[mid] < target {
            left = mid + 1
        } else {
            right = mid
        }
    }
    return left
}

func upperBound(arr []int, target int) int {
    left, right := 0, len(arr)
    for left < right {
        mid := left + (right-left)/2
        if arr[mid] <= target {
            left = mid + 1
        } else {
            right = mid
        }
    }
    return left
}
```

```java
public static int countOccurrences(int[] arr, int target) {
    int lo = lowerBound(arr, target);
    if (lo == arr.length || arr[lo] != target) return 0;
    int hi = upperBound(arr, target);
    return hi - lo;
}
// lowerBound and upperBound as defined previously
```

```python
import bisect

def count_occurrences(arr: list[int], target: int) -> int:
    lo = bisect.bisect_left(arr, target)
    hi = bisect.bisect_right(arr, target)
    return hi - lo
```

**Why it is faster:** Two O(log n) searches instead of one O(n) scan. Even if the target appears
k times, we do not iterate over them.

---

## Exercise 3: Check if Value Exists in BST

### Slow Version — O(n)

Traversing every node to find the target ignores the BST property.

```go
func existsInBST(root *Node, target int) bool {
    if root == nil {
        return false
    }
    if root.Val == target {
        return true
    }
    // O(n): checking BOTH subtrees instead of leveraging BST ordering
    return existsInBST(root.Left, target) || existsInBST(root.Right, target)
}
```

```java
static boolean existsInBST(Node root, int target) {
    if (root == null) return false;
    if (root.val == target) return true;
    return existsInBST(root.left, target) || existsInBST(root.right, target);
}
```

```python
def exists_in_bst(root, target):
    if root is None:
        return False
    if root.val == target:
        return True
    return exists_in_bst(root.left, target) or exists_in_bst(root.right, target)
```

### Optimized Version — O(log n)

Use the BST ordering property to go left or right, eliminating half the tree each step.

```go
func existsInBST(root *Node, target int) bool {
    current := root
    for current != nil {
        if target == current.Val {
            return true
        } else if target < current.Val {
            current = current.Left
        } else {
            current = current.Right
        }
    }
    return false
}
```

```java
static boolean existsInBST(Node root, int target) {
    Node current = root;
    while (current != null) {
        if (target == current.val) return true;
        else if (target < current.val) current = current.left;
        else current = current.right;
    }
    return false;
}
```

```python
def exists_in_bst(root, target):
    current = root
    while current:
        if target == current.val:
            return True
        elif target < current.val:
            current = current.left
        else:
            current = current.right
    return False
```

**Why it is faster:** Only visits one path from root to leaf — O(h) where h = O(log n) for a
balanced tree. The slow version visits every node.

---

## Exercise 4: Compute x^n

### Slow Version — O(n)

```go
func power(base, exp int) int {
    result := 1
    for i := 0; i < exp; i++ {
        result *= base
    }
    return result
}
```

```java
public static long power(long base, int exp) {
    long result = 1;
    for (int i = 0; i < exp; i++) {
        result *= base;
    }
    return result;
}
```

```python
def power(base: int, exp: int) -> int:
    result = 1
    for _ in range(exp):
        result *= base
    return result
```

### Optimized Version — O(log n)

Exponentiation by squaring: if exp is even, x^n = (x^(n/2))^2.

```go
func power(base, exp int) int {
    result := 1
    for exp > 0 {
        if exp%2 == 1 {
            result *= base
        }
        base *= base
        exp /= 2
    }
    return result
}
```

```java
public static long power(long base, int exp) {
    long result = 1;
    while (exp > 0) {
        if (exp % 2 == 1) result *= base;
        base *= base;
        exp /= 2;
    }
    return result;
}
```

```python
def power(base: int, exp: int) -> int:
    result = 1
    while exp > 0:
        if exp % 2 == 1:
            result *= base
        base *= base
        exp //= 2
    return result
```

**Why it is faster:** For exp = 1,000,000, linear version does 1,000,000 multiplications.
Squaring version does about 20.

---

## Exercise 5: Find Insertion Point

### Slow Version — O(n)

Find where to insert a value in a sorted array to keep it sorted.

```go
func insertionPoint(arr []int, target int) int {
    for i, v := range arr {
        if v >= target {
            return i
        }
    }
    return len(arr)
}
```

```java
public static int insertionPoint(int[] arr, int target) {
    for (int i = 0; i < arr.length; i++) {
        if (arr[i] >= target) return i;
    }
    return arr.length;
}
```

```python
def insertion_point(arr: list[int], target: int) -> int:
    for i, v in enumerate(arr):
        if v >= target:
            return i
    return len(arr)
```

### Optimized Version — O(log n)

This is exactly the lower bound operation.

```go
import "sort"

func insertionPoint(arr []int, target int) int {
    return sort.SearchInts(arr, target)
}
```

```java
import java.util.Arrays;

public static int insertionPoint(int[] arr, int target) {
    int idx = Arrays.binarySearch(arr, target);
    return idx >= 0 ? idx : -(idx + 1);
}
```

```python
import bisect

def insertion_point(arr: list[int], target: int) -> int:
    return bisect.bisect_left(arr, target)
```

---

## Exercise 6: Find Floor and Ceiling

### Slow Version — O(n)

Given a sorted array and a target, find the largest element <= target (floor) and smallest
element >= target (ceiling).

```go
func floorAndCeiling(arr []int, target int) (int, int) {
    floor, ceiling := -1, -1
    for _, v := range arr {
        if v <= target {
            floor = v
        }
        if v >= target && ceiling == -1 {
            ceiling = v
        }
    }
    return floor, ceiling
}
```

```java
public static int[] floorAndCeiling(int[] arr, int target) {
    int floor = -1, ceiling = -1;
    for (int v : arr) {
        if (v <= target) floor = v;
        if (v >= target && ceiling == -1) ceiling = v;
    }
    return new int[]{floor, ceiling};
}
```

```python
def floor_and_ceiling(arr: list[int], target: int) -> tuple[int, int]:
    floor_val = ceiling_val = -1
    for v in arr:
        if v <= target:
            floor_val = v
        if v >= target and ceiling_val == -1:
            ceiling_val = v
    return floor_val, ceiling_val
```

### Optimized Version — O(log n)

Use lower bound to find ceiling, and the element before it for floor.

```go
import "sort"

func floorAndCeiling(arr []int, target int) (int, int) {
    idx := sort.SearchInts(arr, target) // first >= target

    ceiling := -1
    if idx < len(arr) {
        ceiling = arr[idx]
    }

    floor := -1
    if idx > 0 && (idx == len(arr) || arr[idx] != target) {
        floor = arr[idx-1]
    } else if idx < len(arr) && arr[idx] == target {
        floor = target
    }

    return floor, ceiling
}
```

```java
public static int[] floorAndCeiling(int[] arr, int target) {
    int idx = Arrays.binarySearch(arr, target);
    if (idx >= 0) return new int[]{target, target};

    int insertPos = -(idx + 1);
    int floor = insertPos > 0 ? arr[insertPos - 1] : -1;
    int ceiling = insertPos < arr.length ? arr[insertPos] : -1;
    return new int[]{floor, ceiling};
}
```

```python
import bisect

def floor_and_ceiling(arr: list[int], target: int) -> tuple[int, int]:
    idx = bisect.bisect_left(arr, target)

    ceiling = arr[idx] if idx < len(arr) else -1
    if idx < len(arr) and arr[idx] == target:
        floor_val = target
    elif idx > 0:
        floor_val = arr[idx - 1]
    else:
        floor_val = -1

    return floor_val, ceiling
```

---

## Exercise 7: Search in Sorted Matrix Row

### Slow Version — O(rows * cols)

```python
def search_matrix(matrix: list[list[int]], target: int) -> bool:
    for row in matrix:
        for val in row:
            if val == target:
                return True
    return False
```

### Optimized Version — O(log(rows * cols))

Treat the matrix as a flat sorted array and binary search on it.

```python
def search_matrix(matrix: list[list[int]], target: int) -> bool:
    if not matrix:
        return False
    rows, cols = len(matrix), len(matrix[0])
    left, right = 0, rows * cols - 1

    while left <= right:
        mid = left + (right - left) // 2
        val = matrix[mid // cols][mid % cols]
        if val == target:
            return True
        elif val < target:
            left = mid + 1
        else:
            right = mid - 1

    return False
```

**Why it is faster:** One binary search over the entire matrix instead of checking every cell.

---

## Exercise 8: Find Peak in Mountain Array

### Slow Version — O(n)

```go
func findPeak(arr []int) int {
    for i := 1; i < len(arr)-1; i++ {
        if arr[i] > arr[i-1] && arr[i] > arr[i+1] {
            return i
        }
    }
    return -1
}
```

```java
public static int findPeak(int[] arr) {
    for (int i = 1; i < arr.length - 1; i++) {
        if (arr[i] > arr[i - 1] && arr[i] > arr[i + 1]) return i;
    }
    return -1;
}
```

```python
def find_peak(arr: list[int]) -> int:
    for i in range(1, len(arr) - 1):
        if arr[i] > arr[i - 1] and arr[i] > arr[i + 1]:
            return i
    return -1
```

### Optimized Version — O(log n)

The mountain property guarantees a single peak. If `arr[mid] < arr[mid+1]`, the peak is to the
right; otherwise it is to the left.

```go
func findPeak(arr []int) int {
    left, right := 0, len(arr)-1
    for left < right {
        mid := left + (right-left)/2
        if arr[mid] < arr[mid+1] {
            left = mid + 1
        } else {
            right = mid
        }
    }
    return left
}
```

```java
public static int findPeak(int[] arr) {
    int left = 0, right = arr.length - 1;
    while (left < right) {
        int mid = left + (right - left) / 2;
        if (arr[mid] < arr[mid + 1]) left = mid + 1;
        else right = mid;
    }
    return left;
}
```

```python
def find_peak(arr: list[int]) -> int:
    left, right = 0, len(arr) - 1
    while left < right:
        mid = left + (right - left) // 2
        if arr[mid] < arr[mid + 1]:
            left = mid + 1
        else:
            right = mid
    return left
```

---

## Exercise 9: Minimum Pages Allocation

### Problem

Given n books with pages[i] pages and m students, allocate contiguous books to students such that
the maximum pages assigned to any student is minimized.

### Slow Version — O(sum * n)

Try every possible max from 1 to sum(pages), check feasibility.

```python
def min_pages_slow(pages: list[int], m: int) -> int:
    for max_pages in range(max(pages), sum(pages) + 1):
        if can_allocate(pages, m, max_pages):
            return max_pages
    return -1

def can_allocate(pages, m, max_pages):
    students, current = 1, 0
    for p in pages:
        if current + p > max_pages:
            students += 1
            current = p
        else:
            current += p
    return students <= m
```

### Optimized Version — O(n * log(sum))

Binary search on the answer: the minimum max-pages is between max(pages) and sum(pages).

```python
def min_pages(pages: list[int], m: int) -> int:
    left, right = max(pages), sum(pages)

    while left < right:
        mid = left + (right - left) // 2
        if can_allocate(pages, m, mid):
            right = mid
        else:
            left = mid + 1

    return left

def can_allocate(pages, m, max_pages):
    students, current = 1, 0
    for p in pages:
        if current + p > max_pages:
            students += 1
            current = p
        else:
            current += p
    return students <= m

print(min_pages([12, 34, 67, 90], 2))  # 113
```

**Why it is faster:** The feasibility check is O(n), and we binary search over the answer space
of size sum - max. This gives O(n * log(sum)) instead of O(n * sum).

---

## Exercise 10: Frequency Lookup System

### Slow Version — O(n) per query

```python
class FrequencyLookup:
    def __init__(self, data: list[int]):
        self.data = sorted(data)

    def count(self, value: int) -> int:
        # O(n) linear scan each time
        return self.data.count(value)
```

### Optimized Version — O(log n) per query

```python
import bisect

class FrequencyLookup:
    def __init__(self, data: list[int]):
        self.data = sorted(data)  # O(n log n) once

    def count(self, value: int) -> int:
        # O(log n) per query
        lo = bisect.bisect_left(self.data, value)
        hi = bisect.bisect_right(self.data, value)
        return hi - lo

lookup = FrequencyLookup([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5])
print(lookup.count(5))  # 3
print(lookup.count(7))  # 0
```

**Why it is faster:** O(n log n) preprocessing, then each query is O(log n) instead of O(n).
For Q queries, total cost is O(n log n + Q * log n) vs O(Q * n).

---

## Exercise 11: Find Closest Value in Sorted Array

### Slow Version — O(n)

```go
func closestValue(arr []int, target int) int {
    closest := arr[0]
    for _, v := range arr {
        if abs(v-target) < abs(closest-target) {
            closest = v
        }
    }
    return closest
}
```

### Optimized Version — O(log n)

Binary search to find the insertion point, then check the two neighbors.

```go
import "sort"

func closestValue(arr []int, target int) int {
    idx := sort.SearchInts(arr, target)

    if idx == 0 {
        return arr[0]
    }
    if idx == len(arr) {
        return arr[len(arr)-1]
    }

    if target-arr[idx-1] <= arr[idx]-target {
        return arr[idx-1]
    }
    return arr[idx]
}
```

```python
import bisect

def closest_value(arr: list[int], target: int) -> int:
    idx = bisect.bisect_left(arr, target)
    if idx == 0:
        return arr[0]
    if idx == len(arr):
        return arr[-1]
    if target - arr[idx - 1] <= arr[idx] - target:
        return arr[idx - 1]
    return arr[idx]

print(closest_value([1, 3, 5, 8, 12, 15], 10))  # 8 or 12
```

---

## Exercise 12: Compute GCD

### Slow Version — O(min(a, b))

```python
def gcd_slow(a: int, b: int) -> int:
    result = 1
    for i in range(1, min(a, b) + 1):
        if a % i == 0 and b % i == 0:
            result = i
    return result
```

### Optimized Version — O(log(min(a, b)))

The Euclidean algorithm repeatedly replaces the larger number with the remainder, halving the
problem size every two steps.

```go
func gcd(a, b int) int {
    for b != 0 {
        a, b = b, a%b
    }
    return a
}
```

```java
public static int gcd(int a, int b) {
    while (b != 0) {
        int temp = b;
        b = a % b;
        a = temp;
    }
    return a;
}
```

```python
def gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a

print(gcd(48, 18))  # 6
```

**Why it is faster:** The Euclidean algorithm's time complexity is O(log(min(a, b))) because the
remainder decreases by at least half every two steps (by the Fibonacci argument).
