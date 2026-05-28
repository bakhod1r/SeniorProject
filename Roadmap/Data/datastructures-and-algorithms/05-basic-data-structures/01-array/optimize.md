# Array -- Optimization Exercises

Each exercise starts with a correct but slow implementation. Your goal is to optimize it for better time complexity, space complexity, or practical performance.

## Table of Contents

- [Exercise 1: Contains Duplicate -- O(n^2) to O(n)](#exercise-1-contains-duplicate-on2-to-on)
- [Exercise 2: Two Sum -- O(n^2) to O(n)](#exercise-2-two-sum-on2-to-on)
- [Exercise 3: Max Subarray Sum -- O(n^3) to O(n)](#exercise-3-max-subarray-sum-on3-to-on)
- [Exercise 4: Range Sum Queries -- O(n) to O(1) per query](#exercise-4-range-sum-queries-on-to-o1-per-query)
- [Exercise 5: Remove Duplicates -- O(n^2) to O(n)](#exercise-5-remove-duplicates-on2-to-on)
- [Exercise 6: Matrix Row-Column Sum -- Fix Cache Performance](#exercise-6-matrix-row-column-sum-fix-cache-performance)
- [Exercise 7: Intersection of Two Arrays -- O(n*m) to O(n+m)](#exercise-7-intersection-of-two-arrays-onm-to-onm)
- [Exercise 8: Frequent Resize -- Eliminate Unnecessary Allocation](#exercise-8-frequent-resize-eliminate-unnecessary-allocation)
- [Exercise 9: Find Pair With Difference K -- O(n^2) to O(n)](#exercise-9-find-pair-with-difference-k-on2-to-on)
- [Exercise 10: Rotate Array -- O(n*k) to O(n)](#exercise-10-rotate-array-onk-to-on)
- [Exercise 11: Count Inversions -- O(n^2) to O(n log n)](#exercise-11-count-inversions-on2-to-on-log-n)
- [Exercise 12: Majority Element -- O(n) Space to O(1) Space](#exercise-12-majority-element-on-space-to-o1-space)

---

## Exercise 1: Contains Duplicate -- O(n^2) to O(n)

### Slow Version

```go
// O(n^2): compare every pair
func containsDuplicate(arr []int) bool {
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i] == arr[j] {
                return true
            }
        }
    }
    return false
}
```

### Optimized Version

```go
// O(n): use a hash set
func containsDuplicate(arr []int) bool {
    seen := make(map[int]bool, len(arr))
    for _, v := range arr {
        if seen[v] {
            return true
        }
        seen[v] = true
    }
    return false
}
```

```java
// O(n)
public static boolean containsDuplicate(int[] arr) {
    java.util.HashSet<Integer> seen = new java.util.HashSet<>();
    for (int v : arr) {
        if (!seen.add(v)) return true;
    }
    return false;
}
```

```python
# O(n)
def contains_duplicate(arr):
    return len(arr) != len(set(arr))
```

**Optimization:** Replace nested loop with hash set lookup. Time: O(n^2) -> O(n). Space: O(1) -> O(n).

---

## Exercise 2: Two Sum -- O(n^2) to O(n)

### Slow Version

```java
// O(n^2): brute force all pairs
public static int[] twoSum(int[] nums, int target) {
    for (int i = 0; i < nums.length; i++) {
        for (int j = i + 1; j < nums.length; j++) {
            if (nums[i] + nums[j] == target) {
                return new int[]{i, j};
            }
        }
    }
    return new int[]{};
}
```

### Optimized Version

```java
// O(n): one-pass hash map
public static int[] twoSum(int[] nums, int target) {
    java.util.HashMap<Integer, Integer> map = new java.util.HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        int complement = target - nums[i];
        if (map.containsKey(complement)) {
            return new int[]{map.get(complement), i};
        }
        map.put(nums[i], i);
    }
    return new int[]{};
}
```

```go
func twoSum(nums []int, target int) []int {
    seen := make(map[int]int)
    for i, v := range nums {
        if j, ok := seen[target-v]; ok {
            return []int{j, i}
        }
        seen[v] = i
    }
    return nil
}
```

```python
def two_sum(nums, target):
    seen = {}
    for i, v in enumerate(nums):
        if target - v in seen:
            return [seen[target - v], i]
        seen[v] = i
    return []
```

**Optimization:** Store seen values in a hash map. For each element, check if its complement exists. Time: O(n^2) -> O(n).

---

## Exercise 3: Max Subarray Sum -- O(n^3) to O(n)

### Slow Version

```python
# O(n^3): check all subarrays, compute sum for each
def max_subarray_sum(arr):
    n = len(arr)
    max_sum = arr[0]
    for i in range(n):
        for j in range(i, n):
            current_sum = 0
            for k in range(i, j + 1):  # O(n) per subarray
                current_sum += arr[k]
            max_sum = max(max_sum, current_sum)
    return max_sum
```

### Intermediate Version -- O(n^2)

```python
# O(n^2): maintain running sum
def max_subarray_sum(arr):
    n = len(arr)
    max_sum = arr[0]
    for i in range(n):
        current_sum = 0
        for j in range(i, n):
            current_sum += arr[j]
            max_sum = max(max_sum, current_sum)
    return max_sum
```

### Optimized Version -- O(n) (Kadane)

```python
# O(n): Kadane's algorithm
def max_subarray_sum(arr):
    max_so_far = max_ending_here = arr[0]
    for v in arr[1:]:
        max_ending_here = max(v, max_ending_here + v)
        max_so_far = max(max_so_far, max_ending_here)
    return max_so_far
```

```go
func maxSubarraySum(arr []int) int {
    maxSoFar, maxEndingHere := arr[0], arr[0]
    for _, v := range arr[1:] {
        if maxEndingHere+v > v {
            maxEndingHere += v
        } else {
            maxEndingHere = v
        }
        if maxEndingHere > maxSoFar {
            maxSoFar = maxEndingHere
        }
    }
    return maxSoFar
}
```

```java
public static int maxSubarraySum(int[] arr) {
    int maxSoFar = arr[0], maxEndingHere = arr[0];
    for (int i = 1; i < arr.length; i++) {
        maxEndingHere = Math.max(arr[i], maxEndingHere + arr[i]);
        maxSoFar = Math.max(maxSoFar, maxEndingHere);
    }
    return maxSoFar;
}
```

**Optimization:** O(n^3) -> O(n^2) by removing inner sum loop. O(n^2) -> O(n) with Kadane's algorithm.

---

## Exercise 4: Range Sum Queries -- O(n) to O(1) per query

### Slow Version

```go
// O(n) per query, O(q*n) total for q queries
func rangeSum(arr []int, left, right int) int {
    sum := 0
    for i := left; i <= right; i++ {
        sum += arr[i]
    }
    return sum
}
```

### Optimized Version

```go
// O(n) preprocessing, O(1) per query
func buildPrefix(arr []int) []int {
    prefix := make([]int, len(arr)+1)
    for i, v := range arr {
        prefix[i+1] = prefix[i] + v
    }
    return prefix
}

func rangeSum(prefix []int, left, right int) int {
    return prefix[right+1] - prefix[left]
}
```

```java
public static long[] buildPrefix(int[] arr) {
    long[] prefix = new long[arr.length + 1];
    for (int i = 0; i < arr.length; i++) {
        prefix[i + 1] = prefix[i] + arr[i];
    }
    return prefix;
}

public static long rangeSum(long[] prefix, int left, int right) {
    return prefix[right + 1] - prefix[left];
}
```

```python
from itertools import accumulate

def build_prefix(arr):
    return [0] + list(accumulate(arr))

def range_sum(prefix, left, right):
    return prefix[right + 1] - prefix[left]
```

**Optimization:** Precompute prefix sums. Trade O(n) space for O(1) per query instead of O(n).

---

## Exercise 5: Remove Duplicates -- O(n^2) to O(n)

### Slow Version

```python
# O(n^2): for each element, check all previous elements
def remove_duplicates(arr):
    result = []
    for v in arr:
        if v not in result:  # O(n) search in list
            result.append(v)
    return result
```

### Optimized Version

```python
# O(n): use a set for O(1) lookup, preserve order
def remove_duplicates(arr):
    seen = set()
    result = []
    for v in arr:
        if v not in seen:
            seen.add(v)
            result.append(v)
    return result

# Python 3.7+: dict preserves insertion order
def remove_duplicates(arr):
    return list(dict.fromkeys(arr))
```

```go
func removeDuplicates(arr []int) []int {
    seen := make(map[int]bool)
    result := make([]int, 0)
    for _, v := range arr {
        if !seen[v] {
            seen[v] = true
            result = append(result, v)
        }
    }
    return result
}
```

```java
public static List<Integer> removeDuplicates(int[] arr) {
    java.util.LinkedHashSet<Integer> set = new java.util.LinkedHashSet<>();
    for (int v : arr) set.add(v);
    return new java.util.ArrayList<>(set);
}
```

**Optimization:** Replace O(n) list search with O(1) set lookup. Total: O(n^2) -> O(n).

---

## Exercise 6: Matrix Row-Column Sum -- Fix Cache Performance

### Slow Version (cache-hostile)

```go
// Iterating column-by-column on a row-major array causes cache misses
func columnSums(matrix [][]int, rows, cols int) []int {
    sums := make([]int, cols)
    for j := 0; j < cols; j++ {        // outer loop over columns
        for i := 0; i < rows; i++ {    // inner loop over rows
            sums[j] += matrix[i][j]    // jumps across rows in memory
        }
    }
    return sums
}
```

### Optimized Version (cache-friendly)

```go
// Iterate row-by-row; accumulate into column sums
func columnSums(matrix [][]int, rows, cols int) []int {
    sums := make([]int, cols)
    for i := 0; i < rows; i++ {        // outer loop over rows
        for j := 0; j < cols; j++ {    // inner loop over columns (contiguous)
            sums[j] += matrix[i][j]    // sequential access within a row
        }
    }
    return sums
}
```

```java
public static int[] columnSums(int[][] matrix) {
    int rows = matrix.length, cols = matrix[0].length;
    int[] sums = new int[cols];
    for (int i = 0; i < rows; i++) {       // row-major order
        for (int j = 0; j < cols; j++) {
            sums[j] += matrix[i][j];
        }
    }
    return sums;
}
```

```python
def column_sums(matrix):
    cols = len(matrix[0])
    sums = [0] * cols
    for row in matrix:           # iterate row-by-row
        for j in range(cols):
            sums[j] += row[j]
    return sums

# Or using zip:
# sums = [sum(col) for col in zip(*matrix)]
```

**Optimization:** Same Big-O, but 2-5x faster in practice due to cache locality. Row-by-row access reads contiguous memory, matching CPU cache line fetches.

---

## Exercise 7: Intersection of Two Arrays -- O(n*m) to O(n+m)

### Slow Version

```python
# O(n*m): for each element in a, scan all of b
def intersection(a, b):
    result = []
    for v in a:
        if v in b and v not in result:
            result.append(v)
    return result
```

### Optimized Version

```python
# O(n+m): convert both to sets
def intersection(a, b):
    return list(set(a) & set(b))
```

```go
func intersection(a, b []int) []int {
    setB := make(map[int]bool, len(b))
    for _, v := range b {
        setB[v] = true
    }
    seen := make(map[int]bool)
    var result []int
    for _, v := range a {
        if setB[v] && !seen[v] {
            result = append(result, v)
            seen[v] = true
        }
    }
    return result
}
```

```java
public static int[] intersection(int[] a, int[] b) {
    java.util.HashSet<Integer> setB = new java.util.HashSet<>();
    for (int v : b) setB.add(v);
    java.util.HashSet<Integer> result = new java.util.HashSet<>();
    for (int v : a) {
        if (setB.contains(v)) result.add(v);
    }
    return result.stream().mapToInt(Integer::intValue).toArray();
}
```

**Optimization:** O(n*m) -> O(n+m) using hash sets.

---

## Exercise 8: Frequent Resize -- Eliminate Unnecessary Allocation

### Slow Version

```go
// Rebuilds the result slice in every function call (no pre-allocation)
func filterPositive(data []int) []int {
    var result []int // starts at capacity 0
    for _, v := range data {
        if v > 0 {
            result = append(result, v) // may resize many times
        }
    }
    return result
}
```

### Optimized Version

```go
// Pre-allocate with estimated capacity
func filterPositive(data []int) []int {
    result := make([]int, 0, len(data)) // allocate once with max possible size
    for _, v := range data {
        if v > 0 {
            result = append(result, v) // no resizes
        }
    }
    return result
}
```

```java
// Pre-size the ArrayList
public static List<Integer> filterPositive(int[] data) {
    ArrayList<Integer> result = new ArrayList<>(data.length);
    for (int v : data) {
        if (v > 0) result.add(v);
    }
    return result;
}
```

```python
# List comprehension (single allocation internally)
def filter_positive(data):
    return [v for v in data if v > 0]

# Instead of:
# result = []
# for v in data:
#     if v > 0:
#         result.append(v)
```

**Optimization:** Same Big-O, but 1.5-3x faster by avoiding repeated resize-copy cycles. Pre-allocation is especially impactful in Go and Java.

---

## Exercise 9: Find Pair With Difference K -- O(n^2) to O(n)

### Slow Version

```python
# O(n^2): check all pairs
def has_pair_with_diff(arr, k):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if abs(arr[i] - arr[j]) == k:
                return True
    return False
```

### Optimized Version

```python
# O(n): use hash set
def has_pair_with_diff(arr, k):
    seen = set()
    for v in arr:
        if v + k in seen or v - k in seen:
            return True
        seen.add(v)
    return False
```

```go
func hasPairWithDiff(arr []int, k int) bool {
    seen := make(map[int]bool)
    for _, v := range arr {
        if seen[v+k] || seen[v-k] {
            return true
        }
        seen[v] = true
    }
    return false
}
```

```java
public static boolean hasPairWithDiff(int[] arr, int k) {
    java.util.HashSet<Integer> seen = new java.util.HashSet<>();
    for (int v : arr) {
        if (seen.contains(v + k) || seen.contains(v - k)) return true;
        seen.add(v);
    }
    return false;
}
```

---

## Exercise 10: Rotate Array -- O(n*k) to O(n)

### Slow Version

```go
// O(n*k): rotate one position at a time, k times
func rotateRight(arr []int, k int) {
    n := len(arr)
    k = k % n
    for step := 0; step < k; step++ {
        last := arr[n-1]
        for i := n - 1; i > 0; i-- {
            arr[i] = arr[i-1]
        }
        arr[0] = last
    }
}
```

### Optimized Version

```go
// O(n): three reverses
func rotateRight(arr []int, k int) {
    n := len(arr)
    k = k % n
    reverse(arr, 0, n-1)
    reverse(arr, 0, k-1)
    reverse(arr, k, n-1)
}

func reverse(arr []int, l, r int) {
    for l < r {
        arr[l], arr[r] = arr[r], arr[l]
        l++
        r--
    }
}
```

```java
public static void rotateRight(int[] arr, int k) {
    int n = arr.length;
    k = k % n;
    reverse(arr, 0, n - 1);
    reverse(arr, 0, k - 1);
    reverse(arr, k, n - 1);
}
```

```python
def rotate_right(arr, k):
    n = len(arr)
    k = k % n
    arr[:] = arr[-k:] + arr[:-k]  # Pythonic, O(n) time and space

# Or in-place with three reverses:
def rotate_right_inplace(arr, k):
    n = len(arr)
    k = k % n
    def rev(l, r):
        while l < r:
            arr[l], arr[r] = arr[r], arr[l]
            l += 1; r -= 1
    rev(0, n - 1)
    rev(0, k - 1)
    rev(k, n - 1)
```

**Optimization:** O(n*k) -> O(n) using the three-reverse trick. Space remains O(1).

---

## Exercise 11: Count Inversions -- O(n^2) to O(n log n)

### Slow Version

```python
# O(n^2): count all pairs (i, j) where i < j and arr[i] > arr[j]
def count_inversions(arr):
    count = 0
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] > arr[j]:
                count += 1
    return count
```

### Optimized Version (merge sort based)

```python
# O(n log n): count inversions during merge sort
def count_inversions(arr):
    if len(arr) <= 1:
        return arr, 0
    mid = len(arr) // 2
    left, left_inv = count_inversions(arr[:mid])
    right, right_inv = count_inversions(arr[mid:])
    merged = []
    inversions = left_inv + right_inv
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i])
            i += 1
        else:
            merged.append(right[j])
            inversions += len(left) - i  # all remaining in left are inversions
            j += 1
    merged.extend(left[i:])
    merged.extend(right[j:])
    return merged, inversions

_, inv_count = count_inversions([5, 3, 2, 4, 1])
print(inv_count)  # 8
```

**Optimization:** Piggyback on merge sort to count cross-partition inversions during the merge step. O(n^2) -> O(n log n).

---

## Exercise 12: Majority Element -- O(n) Space to O(1) Space

### O(n) Space Version

```go
func majorityElement(arr []int) int {
    counts := make(map[int]int)
    for _, v := range arr {
        counts[v]++
        if counts[v] > len(arr)/2 {
            return v
        }
    }
    return -1
}
```

### O(1) Space Version (Boyer-Moore Voting)

```go
func majorityElement(arr []int) int {
    candidate, count := 0, 0
    for _, v := range arr {
        if count == 0 {
            candidate = v
        }
        if v == candidate {
            count++
        } else {
            count--
        }
    }
    // Verify (optional, needed if majority may not exist)
    count = 0
    for _, v := range arr {
        if v == candidate {
            count++
        }
    }
    if count > len(arr)/2 {
        return candidate
    }
    return -1
}
```

```java
public static int majorityElement(int[] arr) {
    int candidate = 0, count = 0;
    for (int v : arr) {
        if (count == 0) candidate = v;
        count += (v == candidate) ? 1 : -1;
    }
    return candidate; // assumes majority always exists
}
```

```python
def majority_element(arr):
    candidate, count = None, 0
    for v in arr:
        if count == 0:
            candidate = v
        count += 1 if v == candidate else -1
    return candidate
```

**Optimization:** Boyer-Moore voting algorithm. Same O(n) time, but O(n) space -> O(1) space.
