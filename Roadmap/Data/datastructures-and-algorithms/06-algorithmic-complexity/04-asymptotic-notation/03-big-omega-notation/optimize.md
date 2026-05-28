# Big-Omega Notation — Optimization Exercises

## Overview

Each exercise presents code with a suboptimal algorithm. Your task is to optimize
it closer to (or matching) the known lower bound for the problem. The lower bound
is given for each exercise — your goal is to approach it.

---

## Exercise 1: Find Maximum — Target: Omega(n) = n-1 Comparisons

### Suboptimal Code (Go)

```go
package main

import "fmt"

// This uses 2*(n-1) comparisons — double the lower bound.
func findMax(arr []int) int {
    max := arr[0]
    for i := 1; i < len(arr); i++ {
        if arr[i] > max {
            max = arr[i]
        }
        if arr[i] > max { // Redundant second comparison!
            max = arr[i]
        }
    }
    return max
}

func main() {
    arr := []int{3, 7, 1, 9, 4, 6, 8, 2}
    fmt.Println("Max:", findMax(arr))
}
```

### Optimized Code (Go)

```go
package main

import "fmt"

// Optimal: exactly n-1 comparisons, matching Omega(n).
func findMax(arr []int) int {
    max := arr[0]
    for i := 1; i < len(arr); i++ {
        if arr[i] > max {
            max = arr[i]
        }
    }
    return max
}

func main() {
    arr := []int{3, 7, 1, 9, 4, 6, 8, 2}
    fmt.Println("Max:", findMax(arr))
}
```

**Analysis:** Removed the redundant comparison. Now uses exactly n-1 comparisons,
matching the Omega(n) lower bound.

---

## Exercise 2: Find Min and Max — Target: Omega(ceil(3n/2) - 2)

### Suboptimal Code (Java)

```java
public class MinMax {
    // Uses 2*(n-1) comparisons — far above the lower bound.
    public static int[] findMinMax(int[] arr) {
        int min = arr[0], max = arr[0];
        for (int i = 1; i < arr.length; i++) {
            if (arr[i] < min) min = arr[i];   // n-1 comparisons
            if (arr[i] > max) max = arr[i];   // n-1 comparisons
        }                                      // Total: 2(n-1)
        return new int[]{min, max};
    }
    
    public static void main(String[] args) {
        int[] arr = {3, 7, 1, 9, 4, 6, 8, 2, 5};
        int[] result = findMinMax(arr);
        System.out.printf("Min=%d, Max=%d%n", result[0], result[1]);
    }
}
```

### Optimized Code (Java)

```java
public class MinMax {
    // Uses ceil(3n/2) - 2 comparisons — matches the lower bound!
    public static int[] findMinMax(int[] arr) {
        int n = arr.length;
        int min, max;
        int start;
        
        if (n % 2 == 0) {
            if (arr[0] < arr[1]) { min = arr[0]; max = arr[1]; }
            else { min = arr[1]; max = arr[0]; }
            start = 2;
        } else {
            min = max = arr[0];
            start = 1;
        }
        
        // Process pairs: 3 comparisons per pair instead of 4
        for (int i = start; i + 1 < n; i += 2) {
            int small, large;
            if (arr[i] < arr[i + 1]) {          // 1 comparison
                small = arr[i]; large = arr[i + 1];
            } else {
                small = arr[i + 1]; large = arr[i];
            }
            if (small < min) min = small;        // 1 comparison
            if (large > max) max = large;        // 1 comparison
        }
        
        return new int[]{min, max};
    }
    
    public static void main(String[] args) {
        int[] arr = {3, 7, 1, 9, 4, 6, 8, 2, 5};
        int[] result = findMinMax(arr);
        System.out.printf("Min=%d, Max=%d%n", result[0], result[1]);
    }
}
```

**Analysis:** By comparing pairs first, we use 3 comparisons per 2 elements instead
of 4, achieving ceil(3n/2) - 2 which matches the proven lower bound.

---

## Exercise 3: Check if Array Is Sorted — Target: Omega(n)

### Suboptimal Code (Python)

```python
# Uses O(n^2) — compares all pairs, far above Omega(n) lower bound.
def is_sorted(arr):
    n = len(arr)
    for i in range(n):
        for j in range(i + 1, n):
            if arr[i] > arr[j]:
                return False
    return True

data = list(range(10000))
print(is_sorted(data))  # Very slow for large arrays
```

### Optimized Code (Python)

```python
# Uses O(n) — checks consecutive pairs only. Matches Omega(n).
def is_sorted(arr):
    for i in range(len(arr) - 1):
        if arr[i] > arr[i + 1]:
            return False
    return True

data = list(range(10000))
print(is_sorted(data))  # Fast — exactly n-1 comparisons
```

**Analysis:** Only consecutive pairs need checking. Reduced from O(n^2) to O(n),
matching the Omega(n) lower bound (must examine all elements).

---

## Exercise 4: Search in Sorted Array — Target: Omega(log n)

### Suboptimal Code (Go)

```go
package main

import "fmt"

// Uses O(n) — linear scan on SORTED data. Lower bound is Omega(log n).
func search(arr []int, target int) int {
    for i, v := range arr {
        if v == target {
            return i
        }
    }
    return -1
}

func main() {
    arr := make([]int, 1000000)
    for i := range arr { arr[i] = i * 2 }
    fmt.Println(search(arr, 999998)) // Scans nearly all elements
}
```

### Optimized Code (Go)

```go
package main

import "fmt"

// Uses O(log n) — binary search. Matches Omega(log n) lower bound.
func search(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == target {
            return mid
        } else if arr[mid] < target {
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return -1
}

func main() {
    arr := make([]int, 1000000)
    for i := range arr { arr[i] = i * 2 }
    fmt.Println(search(arr, 999998)) // ~20 comparisons instead of 500000
}
```

**Analysis:** Replaced O(n) linear scan with O(log n) binary search, matching the
Omega(log n) information-theoretic lower bound.

---

## Exercise 5: Find Duplicates — Target: Omega(n)

### Suboptimal Code (Java)

```java
public class Duplicates {
    // O(n^2) — checks all pairs. Lower bound is Omega(n).
    public static boolean hasDuplicate(int[] arr) {
        for (int i = 0; i < arr.length; i++) {
            for (int j = i + 1; j < arr.length; j++) {
                if (arr[i] == arr[j]) return true;
            }
        }
        return false;
    }
    
    public static void main(String[] args) {
        int[] arr = {1, 5, 3, 8, 2, 5, 9};
        System.out.println(hasDuplicate(arr));
    }
}
```

### Optimized Code (Java)

```java
import java.util.HashSet;

public class Duplicates {
    // O(n) average — hash set. Matches Omega(n) lower bound.
    public static boolean hasDuplicate(int[] arr) {
        HashSet<Integer> seen = new HashSet<>();
        for (int val : arr) {
            if (!seen.add(val)) return true;
        }
        return false;
    }
    
    public static void main(String[] args) {
        int[] arr = {1, 5, 3, 8, 2, 5, 9};
        System.out.println(hasDuplicate(arr));
    }
}
```

**Analysis:** Hash set gives O(n) average time, matching the Omega(n) lower bound
(must examine every element at least once).

---

## Exercise 6: Sort Nearly Sorted Array — Target: Omega(n)

### Suboptimal Code (Python)

```python
# Array where each element is at most k positions from its sorted position.
# Using general O(n log n) sort — but we can exploit the structure.
def sort_nearly_sorted(arr, k):
    return sorted(arr)  # O(n log n) — ignores the k constraint

data = [2, 1, 4, 3, 6, 5, 8, 7]  # k=1
print(sort_nearly_sorted(data, 1))
```

### Optimized Code (Python)

```python
import heapq

# Uses a min-heap of size k+1: O(n log k). When k is constant, this is O(n).
# Lower bound: Omega(n) — must read all elements.
def sort_nearly_sorted(arr, k):
    heap = arr[:k + 1]
    heapq.heapify(heap)
    result = []
    
    for i in range(k + 1, len(arr)):
        result.append(heapq.heappushpop(heap, arr[i]))
    
    while heap:
        result.append(heapq.heappop(heap))
    
    return result

data = [2, 1, 4, 3, 6, 5, 8, 7]  # k=1
print(sort_nearly_sorted(data, 1))  # O(n log 1) = O(n)
```

**Analysis:** By exploiting the k-sorted property, we achieve O(n log k) instead of
O(n log n). When k is a constant, this is O(n), matching Omega(n).

---

## Exercise 7: Matrix Diagonal Sum — Target: Omega(n)

### Suboptimal Code (Go)

```go
package main

import "fmt"

// O(n^2) — scans entire matrix for a diagonal sum. Lower bound: Omega(n).
func diagonalSum(matrix [][]int) int {
    n := len(matrix)
    sum := 0
    for i := 0; i < n; i++ {
        for j := 0; j < n; j++ {
            if i == j {
                sum += matrix[i][j]
            }
        }
    }
    return sum
}

func main() {
    m := [][]int{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}
    fmt.Println("Diagonal sum:", diagonalSum(m))
}
```

### Optimized Code (Go)

```go
package main

import "fmt"

// O(n) — only access diagonal elements. Matches Omega(n).
func diagonalSum(matrix [][]int) int {
    sum := 0
    for i := 0; i < len(matrix); i++ {
        sum += matrix[i][i]
    }
    return sum
}

func main() {
    m := [][]int{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}
    fmt.Println("Diagonal sum:", diagonalSum(m))
}
```

**Analysis:** Only n elements are on the diagonal. Reduced from O(n^2) to O(n),
matching the Omega(n) lower bound.

---

## Exercise 8: Count Occurrences in Sorted Array — Target: Omega(log n)

### Suboptimal Code (Java)

```java
public class CountOccurrences {
    // O(n) linear scan on sorted data. Can do better!
    public static int count(int[] arr, int target) {
        int count = 0;
        for (int val : arr) {
            if (val == target) count++;
        }
        return count;
    }
    
    public static void main(String[] args) {
        int[] arr = {1, 2, 2, 2, 2, 3, 4, 5};
        System.out.println("Count of 2: " + count(arr, 2));
    }
}
```

### Optimized Code (Java)

```java
public class CountOccurrences {
    // O(log n) — two binary searches. Matches Omega(log n) lower bound
    // for finding position in sorted data.
    public static int count(int[] arr, int target) {
        int left = lowerBound(arr, target);
        int right = upperBound(arr, target);
        return right - left;
    }
    
    private static int lowerBound(int[] arr, int target) {
        int lo = 0, hi = arr.length;
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2;
            if (arr[mid] < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }
    
    private static int upperBound(int[] arr, int target) {
        int lo = 0, hi = arr.length;
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2;
            if (arr[mid] <= target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }
    
    public static void main(String[] args) {
        int[] arr = {1, 2, 2, 2, 2, 3, 4, 5};
        System.out.println("Count of 2: " + count(arr, 2)); // 4
    }
}
```

**Analysis:** Two binary searches find the range in O(log n), versus O(n) linear scan.
Note: if the count itself is large (k occurrences), reading all k is Omega(k),
but just counting requires only Omega(log n) via binary search.

---

## Exercise 9: Find Second Largest — Target: Omega(n + ceil(log n) - 2)

### Suboptimal Code (Python)

```python
# O(2n) approach — two separate passes.
def second_largest(arr):
    # Pass 1: find max (n-1 comparisons)
    first = max(arr)
    
    # Pass 2: find max excluding first (n-1 comparisons)
    second = float('-inf')
    for val in arr:
        if val != first and val > second:
            second = val
    return second

data = [3, 7, 1, 9, 4, 6, 8, 2]
print(f"Second largest: {second_largest(data)}")
```

### Optimized Code (Python)

```python
import math

# Tournament method: n + ceil(log2(n)) - 2 comparisons — optimal!
def second_largest(arr):
    n = len(arr)
    if n < 2:
        raise ValueError("need at least 2 elements")
    
    # Build tournament tree, tracking who each element lost to
    losers = {i: [] for i in range(n)}
    
    # Tournament: pair up elements and advance winners
    current = list(range(n))
    values = list(arr)
    
    while len(current) > 1:
        next_round = []
        for i in range(0, len(current) - 1, 2):
            a, b = current[i], current[i + 1]
            if values[a] >= values[b]:
                losers[a].append(b)
                next_round.append(a)
            else:
                losers[b].append(a)
                next_round.append(b)
        if len(current) % 2 == 1:
            next_round.append(current[-1])
        current = next_round
    
    winner = current[0]
    
    # Second largest is the max among elements that lost to the winner
    second = max(values[l] for l in losers[winner])
    return second

data = [3, 7, 1, 9, 4, 6, 8, 2]
print(f"Second largest: {second_largest(data)}")
# Uses n + ceil(log2(n)) - 2 = 8 + 3 - 2 = 9 comparisons (optimal)
```

**Analysis:** The tournament method uses exactly n + ceil(log2(n)) - 2 comparisons,
matching the proven lower bound.

---

## Exercise 10: Merge Two Sorted Arrays — Target: Omega(m + n - 1)

### Suboptimal Code (Go)

```go
package main

import (
    "fmt"
    "sort"
)

// O((m+n) log(m+n)) — concatenates and sorts. Lower bound: Omega(m+n).
func mergeSorted(a, b []int) []int {
    result := append(a, b...)
    sort.Ints(result)
    return result
}

func main() {
    a := []int{1, 3, 5, 7, 9}
    b := []int{2, 4, 6, 8, 10}
    fmt.Println(mergeSorted(a, b))
}
```

### Optimized Code (Go)

```go
package main

import "fmt"

// O(m+n) — standard merge. Matches Omega(m+n) lower bound.
func mergeSorted(a, b []int) []int {
    result := make([]int, 0, len(a)+len(b))
    i, j := 0, 0
    
    for i < len(a) && j < len(b) {
        if a[i] <= b[j] {
            result = append(result, a[i])
            i++
        } else {
            result = append(result, b[j])
            j++
        }
    }
    result = append(result, a[i:]...)
    result = append(result, b[j:]...)
    return result
}

func main() {
    a := []int{1, 3, 5, 7, 9}
    b := []int{2, 4, 6, 8, 10}
    fmt.Println(mergeSorted(a, b))
}
```

**Analysis:** Standard merge uses at most m + n - 1 comparisons, matching the
Omega(m + n - 1) lower bound proven by adversary argument.

---

## Exercise 11: Find k-th Smallest — Target: Omega(n)

### Suboptimal Code (Java)

```java
import java.util.Arrays;

public class KthSmallest {
    // O(n log n) — sorts entire array. Lower bound: Omega(n).
    public static int kthSmallest(int[] arr, int k) {
        int[] sorted = arr.clone();
        Arrays.sort(sorted);
        return sorted[k - 1];
    }
    
    public static void main(String[] args) {
        int[] arr = {7, 10, 4, 3, 20, 15};
        System.out.println("3rd smallest: " + kthSmallest(arr, 3)); // 7
    }
}
```

### Optimized Code (Java)

```java
public class KthSmallest {
    // O(n) average — quickselect. Matches Omega(n) lower bound.
    public static int kthSmallest(int[] arr, int k) {
        return quickselect(arr.clone(), 0, arr.length - 1, k - 1);
    }
    
    private static int quickselect(int[] arr, int lo, int hi, int k) {
        if (lo == hi) return arr[lo];
        
        int pivotIdx = partition(arr, lo, hi);
        
        if (k == pivotIdx) return arr[k];
        else if (k < pivotIdx) return quickselect(arr, lo, pivotIdx - 1, k);
        else return quickselect(arr, pivotIdx + 1, hi, k);
    }
    
    private static int partition(int[] arr, int lo, int hi) {
        int pivot = arr[hi];
        int i = lo - 1;
        for (int j = lo; j < hi; j++) {
            if (arr[j] <= pivot) {
                i++;
                int tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
            }
        }
        int tmp = arr[i + 1]; arr[i + 1] = arr[hi]; arr[hi] = tmp;
        return i + 1;
    }
    
    public static void main(String[] args) {
        int[] arr = {7, 10, 4, 3, 20, 15};
        System.out.println("3rd smallest: " + kthSmallest(arr, 3));
    }
}
```

**Analysis:** Quickselect runs in O(n) average (O(n) worst case with
median-of-medians), matching the Omega(n) lower bound.

---

## Exercise 12: Sum of Array — Target: Omega(n)

### Suboptimal Code (Python)

```python
# O(n^2) — re-sums prefix for each element. Lower bound: Omega(n).
def array_sum(arr):
    total = 0
    for i in range(len(arr)):
        # Re-sum from 0 to i each iteration (unnecessary)
        partial = 0
        for j in range(i + 1):
            partial += arr[j]
    return partial  # Also buggy: only returns last partial sum

data = [1, 2, 3, 4, 5]
print(f"Sum: {array_sum(data)}")  # Returns 15, but takes O(n^2)
```

### Optimized Code (Python)

```python
# O(n) — single pass. Matches Omega(n) lower bound.
def array_sum(arr):
    total = 0
    for val in arr:
        total += val
    return total

data = [1, 2, 3, 4, 5]
print(f"Sum: {array_sum(data)}")  # 15, in O(n)
```

**Analysis:** Simple accumulation in one pass. Matches Omega(n) since every element
must be read at least once.

---

## Summary Table

| Exercise | Problem              | Before    | After        | Lower Bound         | Optimal? |
|----------|----------------------|-----------|--------------|---------------------|----------|
| 1        | Find max             | O(2n)     | O(n)         | Omega(n)            | Yes      |
| 2        | Find min and max     | O(2n)     | O(3n/2)      | Omega(3n/2 - 2)     | Yes      |
| 3        | Check sorted         | O(n^2)    | O(n)         | Omega(n)            | Yes      |
| 4        | Sorted search        | O(n)      | O(log n)     | Omega(log n)        | Yes      |
| 5        | Find duplicates      | O(n^2)    | O(n)         | Omega(n)            | Yes      |
| 6        | k-sorted sort        | O(n log n)| O(n log k)   | Omega(n)            | Yes (k const) |
| 7        | Diagonal sum         | O(n^2)    | O(n)         | Omega(n)            | Yes      |
| 8        | Count occurrences    | O(n)      | O(log n)     | Omega(log n)        | Yes      |
| 9        | Second largest       | O(2n)     | O(n + log n) | Omega(n + log n -2) | Yes      |
| 10       | Merge sorted         | O(n log n)| O(n)         | Omega(n)            | Yes      |
| 11       | k-th smallest        | O(n log n)| O(n)         | Omega(n)            | Yes      |
| 12       | Array sum            | O(n^2)    | O(n)         | Omega(n)            | Yes      |

Every optimized solution matches its problem's lower bound, proving optimality.
