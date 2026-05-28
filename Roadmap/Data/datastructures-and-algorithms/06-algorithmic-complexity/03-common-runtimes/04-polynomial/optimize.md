# Polynomial Time O(n^2), O(n^3) -- Optimization Exercises

## Table of Contents

1. [Exercise 1: Two Sum O(n^2) to O(n)](#exercise-1-two-sum-on2-to-on)
2. [Exercise 2: Contains Duplicate O(n^2) to O(n)](#exercise-2-contains-duplicate-on2-to-on)
3. [Exercise 3: Max Subarray O(n^2) to O(n)](#exercise-3-max-subarray-on2-to-on)
4. [Exercise 4: Count Inversions O(n^2) to O(n log n)](#exercise-4-count-inversions-on2-to-on-log-n)
5. [Exercise 5: Closest Pair O(n^2) to O(n log n)](#exercise-5-closest-pair-on2-to-on-log-n)
6. [Exercise 6: Three Sum O(n^3) to O(n^2)](#exercise-6-three-sum-on3-to-on2)
7. [Exercise 7: Polynomial Evaluation O(n^2) to O(n)](#exercise-7-polynomial-evaluation-on2-to-on)
8. [Exercise 8: Range Sum Queries O(n*q) to O(n+q)](#exercise-8-range-sum-queries-onq-to-onq)
9. [Exercise 9: Duplicate Distance O(n^2) to O(n)](#exercise-9-duplicate-distance-on2-to-on)
10. [Exercise 10: Matrix Chain Order O(n^3) Space to O(n^2)](#exercise-10-matrix-chain-order-space-optimization)
11. [Exercise 11: All Pairs Sorted O(n^2 log n) to O(n^2)](#exercise-11-all-pairs-sorted)
12. Exercise 12: Count Pairs Less Than Target O(n^2) to O(n log n)

---

## Exercise 1: Two Sum O(n^2) to O(n)

**Problem:** Given an array and a target, find two indices whose elements sum to target.

### O(n^2) -- Brute Force

```go
// Go
func twoSumBrute(nums []int, target int) [2]int {
    for i := 0; i < len(nums); i++ {
        for j := i + 1; j < len(nums); j++ {
            if nums[i]+nums[j] == target {
                return [2]int{i, j}
            }
        }
    }
    return [2]int{-1, -1}
}
```

```java
// Java
int[] twoSumBrute(int[] nums, int target) {
    for (int i = 0; i < nums.length; i++)
        for (int j = i + 1; j < nums.length; j++)
            if (nums[i] + nums[j] == target)
                return new int[]{i, j};
    return new int[]{-1, -1};
}
```

```python
# Python
def two_sum_brute(nums, target):
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                return [i, j]
    return [-1, -1]
```

### O(n) -- Hash Map

```go
// Go
func twoSum(nums []int, target int) [2]int {
    seen := make(map[int]int) // value -> index
    for i, num := range nums {
        complement := target - num
        if j, ok := seen[complement]; ok {
            return [2]int{j, i}
        }
        seen[num] = i
    }
    return [2]int{-1, -1}
}
```

```java
// Java
int[] twoSum(int[] nums, int target) {
    Map<Integer, Integer> seen = new HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        int complement = target - nums[i];
        if (seen.containsKey(complement)) {
            return new int[]{seen.get(complement), i};
        }
        seen.put(nums[i], i);
    }
    return new int[]{-1, -1};
}
```

```python
# Python
def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return [-1, -1]
```

**Key insight:** Replace the inner linear search with an O(1) hash map lookup.

---

## Exercise 2: Contains Duplicate O(n^2) to O(n)

**Problem:** Determine if an array contains any duplicate values.

### O(n^2) -- Check All Pairs

```go
// Go
func containsDupBrute(arr []int) bool {
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

```java
// Java
boolean containsDupBrute(int[] arr) {
    for (int i = 0; i < arr.length; i++)
        for (int j = i + 1; j < arr.length; j++)
            if (arr[i] == arr[j]) return true;
    return false;
}
```

```python
# Python
def contains_dup_brute(arr):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                return True
    return False
```

### O(n) -- Hash Set

```go
// Go
func containsDup(arr []int) bool {
    seen := make(map[int]bool)
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
// Java
boolean containsDup(int[] arr) {
    Set<Integer> seen = new HashSet<>();
    for (int v : arr) {
        if (!seen.add(v)) return true;
    }
    return false;
}
```

```python
# Python
def contains_dup(arr):
    return len(arr) != len(set(arr))
```

**Key insight:** A hash set provides O(1) membership testing.

---

## Exercise 3: Max Subarray O(n^2) to O(n)

**Problem:** Find the contiguous subarray with the maximum sum.

### O(n^2) -- Check All Subarrays

```go
// Go
func maxSubBrute(arr []int) int {
    maxSum := arr[0]
    for i := 0; i < len(arr); i++ {
        sum := 0
        for j := i; j < len(arr); j++ {
            sum += arr[j]
            if sum > maxSum {
                maxSum = sum
            }
        }
    }
    return maxSum
}
```

```java
// Java
int maxSubBrute(int[] arr) {
    int maxSum = arr[0];
    for (int i = 0; i < arr.length; i++) {
        int sum = 0;
        for (int j = i; j < arr.length; j++) {
            sum += arr[j];
            maxSum = Math.max(maxSum, sum);
        }
    }
    return maxSum;
}
```

```python
# Python
def max_sub_brute(arr):
    max_sum = arr[0]
    for i in range(len(arr)):
        total = 0
        for j in range(i, len(arr)):
            total += arr[j]
            max_sum = max(max_sum, total)
    return max_sum
```

### O(n) -- Kadane's Algorithm

```go
// Go
func maxSub(arr []int) int {
    maxSum, currentSum := arr[0], arr[0]
    for i := 1; i < len(arr); i++ {
        if currentSum < 0 {
            currentSum = arr[i]
        } else {
            currentSum += arr[i]
        }
        if currentSum > maxSum {
            maxSum = currentSum
        }
    }
    return maxSum
}
```

```java
// Java
int maxSub(int[] arr) {
    int maxSum = arr[0], current = arr[0];
    for (int i = 1; i < arr.length; i++) {
        current = Math.max(arr[i], current + arr[i]);
        maxSum = Math.max(maxSum, current);
    }
    return maxSum;
}
```

```python
# Python
def max_sub(arr):
    max_sum = current = arr[0]
    for num in arr[1:]:
        current = max(num, current + num)
        max_sum = max(max_sum, current)
    return max_sum
```

**Key insight:** At each position, either extend the current subarray or start
a new one. The running sum carries all the information we need.

---

## Exercise 4: Count Inversions O(n^2) to O(n log n)

**Problem:** Count pairs (i, j) where i < j but arr[i] > arr[j].

### O(n^2) -- Check All Pairs

```go
// Go
func countInvBrute(arr []int) int {
    count := 0
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i] > arr[j] {
                count++
            }
        }
    }
    return count
}
```

```java
// Java
int countInvBrute(int[] arr) {
    int count = 0;
    for (int i = 0; i < arr.length; i++)
        for (int j = i + 1; j < arr.length; j++)
            if (arr[i] > arr[j]) count++;
    return count;
}
```

```python
# Python
def count_inv_brute(arr):
    return sum(1 for i in range(len(arr)) for j in range(i+1, len(arr)) if arr[i] > arr[j])
```

### O(n log n) -- Modified Merge Sort

```go
// Go
func countInv(arr []int) int {
    _, count := mergeSortCount(arr)
    return count
}

func mergeSortCount(arr []int) ([]int, int) {
    if len(arr) <= 1 {
        return append([]int{}, arr...), 0
    }
    mid := len(arr) / 2
    left, lc := mergeSortCount(arr[:mid])
    right, rc := mergeSortCount(arr[mid:])
    merged := make([]int, 0, len(arr))
    count := lc + rc
    i, j := 0, 0
    for i < len(left) && j < len(right) {
        if left[i] <= right[j] {
            merged = append(merged, left[i])
            i++
        } else {
            merged = append(merged, right[j])
            count += len(left) - i
            j++
        }
    }
    merged = append(merged, left[i:]...)
    merged = append(merged, right[j:]...)
    return merged, count
}
```

```java
// Java
int countInv(int[] arr) {
    int[] temp = new int[arr.length];
    return mergeSortCount(arr, temp, 0, arr.length - 1);
}

int mergeSortCount(int[] arr, int[] temp, int left, int right) {
    if (left >= right) return 0;
    int mid = left + (right - left) / 2;
    int count = mergeSortCount(arr, temp, left, mid)
              + mergeSortCount(arr, temp, mid + 1, right);
    int i = left, j = mid + 1, k = left;
    while (i <= mid && j <= right) {
        if (arr[i] <= arr[j]) temp[k++] = arr[i++];
        else { temp[k++] = arr[j++]; count += mid - i + 1; }
    }
    while (i <= mid) temp[k++] = arr[i++];
    while (j <= right) temp[k++] = arr[j++];
    System.arraycopy(temp, left, arr, left, right - left + 1);
    return count;
}
```

```python
# Python
def count_inv(arr):
    if len(arr) <= 1:
        return arr[:], 0
    mid = len(arr) // 2
    left, lc = count_inv(arr[:mid])
    right, rc = count_inv(arr[mid:])
    merged, sc = [], 0
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i]); i += 1
        else:
            merged.append(right[j]); sc += len(left) - i; j += 1
    merged.extend(left[i:]); merged.extend(right[j:])
    return merged, lc + rc + sc
```

**Key insight:** During the merge step, when a right element is placed before
remaining left elements, ALL remaining left elements form inversions with it.

---

## Exercise 5: Closest Pair O(n^2) to O(n log n)

**Problem:** Find the minimum distance between any two points in 2D.

### O(n^2) -- Check All Pairs

```go
// Go
func closestBrute(points [][2]float64) float64 {
    minDist := math.MaxFloat64
    for i := 0; i < len(points); i++ {
        for j := i + 1; j < len(points); j++ {
            dx := points[i][0] - points[j][0]
            dy := points[i][1] - points[j][1]
            d := math.Sqrt(dx*dx + dy*dy)
            if d < minDist { minDist = d }
        }
    }
    return minDist
}
```

```java
// Java
double closestBrute(double[][] points) {
    double min = Double.MAX_VALUE;
    for (int i = 0; i < points.length; i++)
        for (int j = i + 1; j < points.length; j++) {
            double dx = points[i][0] - points[j][0];
            double dy = points[i][1] - points[j][1];
            min = Math.min(min, Math.sqrt(dx*dx + dy*dy));
        }
    return min;
}
```

```python
# Python
import math
def closest_brute(points):
    min_d = float('inf')
    for i in range(len(points)):
        for j in range(i+1, len(points)):
            dx = points[i][0] - points[j][0]
            dy = points[i][1] - points[j][1]
            min_d = min(min_d, math.sqrt(dx*dx + dy*dy))
    return min_d
```

### O(n log n) -- Divide and Conquer

```python
# Python -- Divide and conquer closest pair
import math

def closest_pair(points):
    points_sorted_x = sorted(points, key=lambda p: p[0])
    return closest_rec(points_sorted_x)

def closest_rec(px):
    n = len(px)
    if n <= 3:
        return closest_brute(px)

    mid = n // 2
    mid_x = px[mid][0]
    left = px[:mid]
    right = px[mid:]

    dl = closest_rec(left)
    dr = closest_rec(right)
    d = min(dl, dr)

    # Build strip of points within distance d of midline
    strip = [p for p in px if abs(p[0] - mid_x) < d]
    strip.sort(key=lambda p: p[1])

    # Check strip points (at most 7 comparisons per point)
    for i in range(len(strip)):
        j = i + 1
        while j < len(strip) and strip[j][1] - strip[i][1] < d:
            dx = strip[i][0] - strip[j][0]
            dy = strip[i][1] - strip[j][1]
            d = min(d, math.sqrt(dx*dx + dy*dy))
            j += 1
    return d
```

**Key insight:** After dividing, only points in a narrow strip near the midline
can form cross-boundary pairs. Each point compares with at most 7 others in the
strip.

---

## Exercise 6: Three Sum O(n^3) to O(n^2)

**Problem:** Find all unique triplets that sum to zero.

### O(n^3) -- Brute Force

```go
// Go -- shown in previous exercises
```

### O(n^2) -- Sort + Two Pointers

```go
// Go
func threeSum(nums []int) [][]int {
    sort.Ints(nums)
    result := [][]int{}
    for i := 0; i < len(nums)-2; i++ {
        if i > 0 && nums[i] == nums[i-1] { continue }
        left, right := i+1, len(nums)-1
        for left < right {
            sum := nums[i] + nums[left] + nums[right]
            if sum == 0 {
                result = append(result, []int{nums[i], nums[left], nums[right]})
                for left < right && nums[left] == nums[left+1] { left++ }
                for left < right && nums[right] == nums[right-1] { right-- }
                left++
                right--
            } else if sum < 0 {
                left++
            } else {
                right--
            }
        }
    }
    return result
}
```

```java
// Java
List<List<Integer>> threeSum(int[] nums) {
    Arrays.sort(nums);
    List<List<Integer>> result = new ArrayList<>();
    for (int i = 0; i < nums.length - 2; i++) {
        if (i > 0 && nums[i] == nums[i - 1]) continue;
        int left = i + 1, right = nums.length - 1;
        while (left < right) {
            int sum = nums[i] + nums[left] + nums[right];
            if (sum == 0) {
                result.add(Arrays.asList(nums[i], nums[left], nums[right]));
                while (left < right && nums[left] == nums[left + 1]) left++;
                while (left < right && nums[right] == nums[right - 1]) right--;
                left++; right--;
            } else if (sum < 0) left++;
            else right--;
        }
    }
    return result;
}
```

```python
# Python
def three_sum(nums):
    nums.sort()
    result = []
    for i in range(len(nums) - 2):
        if i > 0 and nums[i] == nums[i - 1]:
            continue
        left, right = i + 1, len(nums) - 1
        while left < right:
            s = nums[i] + nums[left] + nums[right]
            if s == 0:
                result.append([nums[i], nums[left], nums[right]])
                while left < right and nums[left] == nums[left + 1]: left += 1
                while left < right and nums[right] == nums[right - 1]: right -= 1
                left += 1; right -= 1
            elif s < 0:
                left += 1
            else:
                right -= 1
    return result
```

**Key insight:** Fix one element, then use two pointers to find the other two
in O(n). Total: O(n) * O(n) = O(n^2).

---

## Exercise 7: Polynomial Evaluation O(n^2) to O(n)

**Problem:** Evaluate p(x) = a0 + a1*x + a2*x^2 + ... + an*x^n.

### O(n^2) -- Recompute Powers

```go
// Go
func evalNaive(coeffs []float64, x float64) float64 {
    result := 0.0
    for i, c := range coeffs {
        power := 1.0
        for j := 0; j < i; j++ {
            power *= x
        }
        result += c * power
    }
    return result
}
```

```java
// Java
double evalNaive(double[] coeffs, double x) {
    double result = 0;
    for (int i = 0; i < coeffs.length; i++) {
        double power = 1;
        for (int j = 0; j < i; j++) power *= x;
        result += coeffs[i] * power;
    }
    return result;
}
```

```python
# Python
def eval_naive(coeffs, x):
    result = 0
    for i, c in enumerate(coeffs):
        result += c * x**i  # x**i recomputes from scratch
    return result
```

### O(n) -- Horner's Method

```go
// Go
func evalHorner(coeffs []float64, x float64) float64 {
    result := 0.0
    for i := len(coeffs) - 1; i >= 0; i-- {
        result = result*x + coeffs[i]
    }
    return result
}
```

```java
// Java
double evalHorner(double[] coeffs, double x) {
    double result = 0;
    for (int i = coeffs.length - 1; i >= 0; i--) {
        result = result * x + coeffs[i];
    }
    return result;
}
```

```python
# Python
def eval_horner(coeffs, x):
    result = 0
    for c in reversed(coeffs):
        result = result * x + c
    return result
```

**Key insight:** Horner's method rewrites a0 + a1*x + a2*x^2 as
a0 + x*(a1 + x*(a2 + ...)), evaluating from inside out with one multiply per step.

---

## Exercise 8: Range Sum Queries O(n*q) to O(n+q)

**Problem:** Given an array and q queries, each asking for the sum of a range
[left, right], answer all queries.

### O(n*q) -- Recompute Each Query

```go
// Go
func rangeSumsBrute(arr []int, queries [][2]int) []int {
    results := make([]int, len(queries))
    for q, query := range queries {
        sum := 0
        for i := query[0]; i <= query[1]; i++ {
            sum += arr[i]
        }
        results[q] = sum
    }
    return results
}
```

```java
// Java
int[] rangeSumsBrute(int[] arr, int[][] queries) {
    int[] results = new int[queries.length];
    for (int q = 0; q < queries.length; q++) {
        int sum = 0;
        for (int i = queries[q][0]; i <= queries[q][1]; i++)
            sum += arr[i];
        results[q] = sum;
    }
    return results;
}
```

```python
# Python
def range_sums_brute(arr, queries):
    return [sum(arr[l:r+1]) for l, r in queries]
```

### O(n + q) -- Prefix Sum

```go
// Go
func rangeSums(arr []int, queries [][2]int) []int {
    // Build prefix sum O(n)
    prefix := make([]int, len(arr)+1)
    for i, v := range arr {
        prefix[i+1] = prefix[i] + v
    }
    // Answer each query O(1)
    results := make([]int, len(queries))
    for q, query := range queries {
        results[q] = prefix[query[1]+1] - prefix[query[0]]
    }
    return results
}
```

```java
// Java
int[] rangeSums(int[] arr, int[][] queries) {
    int[] prefix = new int[arr.length + 1];
    for (int i = 0; i < arr.length; i++)
        prefix[i + 1] = prefix[i] + arr[i];
    int[] results = new int[queries.length];
    for (int q = 0; q < queries.length; q++)
        results[q] = prefix[queries[q][1] + 1] - prefix[queries[q][0]];
    return results;
}
```

```python
# Python
def range_sums(arr, queries):
    prefix = [0] * (len(arr) + 1)
    for i, v in enumerate(arr):
        prefix[i + 1] = prefix[i] + v
    return [prefix[r + 1] - prefix[l] for l, r in queries]
```

**Key insight:** Precompute cumulative sums once, then any range sum is a
single subtraction.

---

## Exercise 9: Duplicate Distance O(n^2) to O(n)

**Problem:** Check if any two equal elements are within k indices of each other.

### O(n^2) -- Check All Pairs

```go
// Go
func containsNearbyDupBrute(nums []int, k int) bool {
    for i := 0; i < len(nums); i++ {
        for j := i + 1; j < len(nums); j++ {
            if nums[i] == nums[j] && j-i <= k {
                return true
            }
        }
    }
    return false
}
```

```java
// Java
boolean containsNearbyDupBrute(int[] nums, int k) {
    for (int i = 0; i < nums.length; i++)
        for (int j = i + 1; j < nums.length; j++)
            if (nums[i] == nums[j] && j - i <= k) return true;
    return false;
}
```

```python
# Python
def contains_nearby_dup_brute(nums, k):
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] == nums[j] and j - i <= k:
                return True
    return False
```

### O(n) -- Sliding Window Hash Set

```go
// Go
func containsNearbyDup(nums []int, k int) bool {
    window := make(map[int]bool)
    for i, num := range nums {
        if window[num] {
            return true
        }
        window[num] = true
        if i >= k {
            delete(window, nums[i-k])
        }
    }
    return false
}
```

```java
// Java
boolean containsNearbyDup(int[] nums, int k) {
    Set<Integer> window = new HashSet<>();
    for (int i = 0; i < nums.length; i++) {
        if (!window.add(nums[i])) return true;
        if (i >= k) window.remove(nums[i - k]);
    }
    return false;
}
```

```python
# Python
def contains_nearby_dup(nums, k):
    window = set()
    for i, num in enumerate(nums):
        if num in window:
            return True
        window.add(num)
        if i >= k:
            window.remove(nums[i - k])
    return False
```

**Key insight:** Maintain a sliding window of size k as a hash set.

---

## Exercise 10: Matrix Chain Order Space Optimization

**Problem:** Find the optimal parenthesization for matrix chain multiplication.
The standard DP is O(n^3) time and O(n^2) space. Optimize the constant factor.

### Standard O(n^3) Time, O(n^2) Space

```go
// Go
func matrixChainOrder(dims []int) int {
    n := len(dims) - 1
    dp := make([][]int, n)
    for i := range dp {
        dp[i] = make([]int, n)
    }
    for length := 2; length <= n; length++ {
        for i := 0; i <= n-length; i++ {
            j := i + length - 1
            dp[i][j] = math.MaxInt64
            for k := i; k < j; k++ {
                cost := dp[i][k] + dp[k+1][j] + dims[i]*dims[k+1]*dims[j+1]
                if cost < dp[i][j] {
                    dp[i][j] = cost
                }
            }
        }
    }
    return dp[0][n-1]
}
```

```java
// Java
int matrixChainOrder(int[] dims) {
    int n = dims.length - 1;
    int[][] dp = new int[n][n];
    for (int len = 2; len <= n; len++) {
        for (int i = 0; i <= n - len; i++) {
            int j = i + len - 1;
            dp[i][j] = Integer.MAX_VALUE;
            for (int k = i; k < j; k++) {
                int cost = dp[i][k] + dp[k+1][j] + dims[i]*dims[k+1]*dims[j+1];
                dp[i][j] = Math.min(dp[i][j], cost);
            }
        }
    }
    return dp[0][n - 1];
}
```

```python
# Python
def matrix_chain_order(dims):
    n = len(dims) - 1
    dp = [[0] * n for _ in range(n)]
    for length in range(2, n + 1):
        for i in range(n - length + 1):
            j = i + length - 1
            dp[i][j] = float('inf')
            for k in range(i, j):
                cost = dp[i][k] + dp[k+1][j] + dims[i]*dims[k+1]*dims[j+1]
                dp[i][j] = min(dp[i][j], cost)
    return dp[0][n - 1]
```

**Optimization note:** The time complexity O(n^3) cannot be improved for this
problem (it is optimal under standard assumptions). However, you can improve
cache performance by iterating diagonals and using 1D arrays where possible.

---

## Exercise 11: All Pairs Sorted

**Problem:** Given a sorted array, generate all pair sums in sorted order.

### O(n^2 log n) -- Generate All + Sort

```python
# Python
def all_pair_sums_slow(arr):
    pairs = []
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            pairs.append(arr[i] + arr[j])
    pairs.sort()  # O(n^2 log n)
    return pairs
```

### O(n^2) -- Min-Heap (n-way merge)

```python
# Python
import heapq

def all_pair_sums_fast(arr):
    n = len(arr)
    if n < 2:
        return []
    # Each "row" i has sums arr[i]+arr[j] for j > i, already sorted
    # Use a min-heap to merge n rows
    heap = []
    for i in range(n - 1):
        heapq.heappush(heap, (arr[i] + arr[i + 1], i, i + 1))

    result = []
    while heap:
        val, i, j = heapq.heappop(heap)
        result.append(val)
        if j + 1 < n:
            heapq.heappush(heap, (arr[i] + arr[j + 1], i, j + 1))
    return result
```

**Key insight:** Since the input array is sorted, each "row" of pair sums is
already sorted. Use a heap to merge them without sorting all n^2 sums.

---

## Exercise 12: Count Pairs Less Than Target O(n^2) to O(n log n)

**Problem:** Count pairs (i, j) where i < j and arr[i] + arr[j] < target.

### O(n^2) -- Check All Pairs

```go
// Go
func countPairsBrute(arr []int, target int) int {
    count := 0
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i]+arr[j] < target {
                count++
            }
        }
    }
    return count
}
```

```java
// Java
int countPairsBrute(int[] arr, int target) {
    int count = 0;
    for (int i = 0; i < arr.length; i++)
        for (int j = i + 1; j < arr.length; j++)
            if (arr[i] + arr[j] < target) count++;
    return count;
}
```

```python
# Python
def count_pairs_brute(arr, target):
    return sum(1 for i in range(len(arr)) for j in range(i+1, len(arr))
               if arr[i] + arr[j] < target)
```

### O(n log n) -- Sort + Two Pointers

```go
// Go
func countPairs(arr []int, target int) int {
    sorted := make([]int, len(arr))
    copy(sorted, arr)
    sort.Ints(sorted)
    count := 0
    left, right := 0, len(sorted)-1
    for left < right {
        if sorted[left]+sorted[right] < target {
            count += right - left
            left++
        } else {
            right--
        }
    }
    return count
}
```

```java
// Java
int countPairs(int[] arr, int target) {
    int[] sorted = arr.clone();
    Arrays.sort(sorted);
    int count = 0, left = 0, right = sorted.length - 1;
    while (left < right) {
        if (sorted[left] + sorted[right] < target) {
            count += right - left;
            left++;
        } else {
            right--;
        }
    }
    return count;
}
```

```python
# Python
def count_pairs(arr, target):
    s = sorted(arr)
    count = 0
    left, right = 0, len(s) - 1
    while left < right:
        if s[left] + s[right] < target:
            count += right - left
            left += 1
        else:
            right -= 1
    return count
```

**Key insight:** If `arr[left] + arr[right] < target`, then all pairs
`(left, left+1), (left, left+2), ..., (left, right)` also satisfy the condition
since `arr[left+1..right] <= arr[right]`. We count all `right - left` pairs at once.
