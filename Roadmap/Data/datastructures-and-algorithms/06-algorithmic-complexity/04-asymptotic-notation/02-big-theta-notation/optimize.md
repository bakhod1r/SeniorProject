# Big-Theta Notation -- Optimize

## Table of Contents

1. Exercise 1: Reduce Theta(n^2) to Theta(n)
2. Exercise 2: Reduce Theta(n^2) to Theta(n log n)
3. Exercise 3: Reduce Theta(n^3) to Theta(n^2)
4. Exercise 4: Reduce Theta(n) to Theta(log n)
5. Exercise 5: Redundant Recomputation
6. Exercise 6: Optimize String Building
7. Exercise 7: Matrix Search Optimization
8. Exercise 8: Reduce Theta(2^n) to Theta(n)
9. Exercise 9: Hash Map vs Nested Loop
10. Exercise 10: Sliding Window
11. Exercise 11: Prefix Sum Optimization
12. Exercise 12: Sorting-Based Optimization

---

## Exercise 1: Reduce Theta(n^2) to Theta(n)

**Problem**: Find if an array contains any duplicate. The naive approach uses
two nested loops: Theta(n^2). Optimize to Theta(n) using a hash set.

**Go (Unoptimized -- Theta(n^2)):**

```go
package main

import "fmt"

// containsDuplicate checks for duplicates using nested loops
// Time: Theta(n^2) -- compares every pair
func containsDuplicateSlow(arr []int) bool {
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i] == arr[j] {
                return true
            }
        }
    }
    return false
}

func main() {
    data := []int{1, 5, 3, 9, 7, 5, 2}
    fmt.Println("Has duplicate:", containsDuplicateSlow(data))
}
```

**Go (Optimized -- Theta(n)):**

```go
package main

import "fmt"

// containsDuplicate uses a hash set for O(1) lookups
// Time: Theta(n) -- single pass, hash set operations are Theta(1) amortized
// Space: Theta(n) -- hash set stores up to n elements
func containsDuplicate(arr []int) bool {
    seen := make(map[int]bool)
    for _, v := range arr {
        if seen[v] {
            return true
        }
        seen[v] = true
    }
    return false
}

func main() {
    data := []int{1, 5, 3, 9, 7, 5, 2}
    fmt.Println("Has duplicate:", containsDuplicate(data))
}
```

**Java (Unoptimized -- Theta(n^2)):**

```java
public class Exercise1 {
    // Theta(n^2) -- nested loops
    public static boolean containsDuplicateSlow(int[] arr) {
        for (int i = 0; i < arr.length; i++) {
            for (int j = i + 1; j < arr.length; j++) {
                if (arr[i] == arr[j]) return true;
            }
        }
        return false;
    }
}
```

**Java (Optimized -- Theta(n)):**

```java
import java.util.HashSet;
import java.util.Set;

public class Exercise1Opt {
    // Theta(n) -- hash set for O(1) lookups
    public static boolean containsDuplicate(int[] arr) {
        Set<Integer> seen = new HashSet<>();
        for (int v : arr) {
            if (!seen.add(v)) return true;
        }
        return false;
    }
}
```

**Python (Unoptimized -- Theta(n^2)):**

```python
def contains_duplicate_slow(arr: list[int]) -> bool:
    """Theta(n^2) -- nested loops."""
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                return True
    return False
```

**Python (Optimized -- Theta(n)):**

```python
def contains_duplicate(arr: list[int]) -> bool:
    """Theta(n) -- hash set."""
    return len(arr) != len(set(arr))
```

**Analysis**: Theta(n^2) -> Theta(n). Trade-off: Theta(n) extra space.

---

## Exercise 2: Reduce Theta(n^2) to Theta(n log n)

**Problem**: Find the closest pair of numbers in an array. Naive: compare all
pairs Theta(n^2). Optimized: sort first, then check adjacent elements.

**Go (Unoptimized -- Theta(n^2)):**

```go
package main

import (
    "fmt"
    "math"
)

func closestPairSlow(arr []int) (int, int, int) {
    minDiff := math.MaxInt64
    a, b := 0, 0
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            diff := arr[i] - arr[j]
            if diff < 0 {
                diff = -diff
            }
            if diff < minDiff {
                minDiff = diff
                a, b = arr[i], arr[j]
            }
        }
    }
    return a, b, minDiff
}

func main() {
    data := []int{23, 5, 17, 42, 9, 31, 8}
    a, b, diff := closestPairSlow(data)
    fmt.Printf("Closest pair: %d and %d (diff=%d)\n", a, b, diff)
}
```

**Go (Optimized -- Theta(n log n)):**

```go
package main

import (
    "fmt"
    "math"
    "sort"
)

// closestPair sorts first then checks adjacent elements
// Time: Theta(n log n) -- dominated by the sort
// Space: Theta(1) extra (in-place sort) or Theta(n) depending on sort impl
func closestPair(arr []int) (int, int, int) {
    sorted := make([]int, len(arr))
    copy(sorted, arr)
    sort.Ints(sorted)

    minDiff := math.MaxInt64
    a, b := 0, 0
    for i := 1; i < len(sorted); i++ {
        diff := sorted[i] - sorted[i-1]
        if diff < minDiff {
            minDiff = diff
            a, b = sorted[i-1], sorted[i]
        }
    }
    return a, b, minDiff
}

func main() {
    data := []int{23, 5, 17, 42, 9, 31, 8}
    a, b, diff := closestPair(data)
    fmt.Printf("Closest pair: %d and %d (diff=%d)\n", a, b, diff)
}
```

**Java (Optimized -- Theta(n log n)):**

```java
import java.util.Arrays;

public class Exercise2 {
    public static void closestPair(int[] arr) {
        int[] sorted = arr.clone();
        Arrays.sort(sorted); // Theta(n log n)

        int minDiff = Integer.MAX_VALUE;
        int a = 0, b = 0;
        for (int i = 1; i < sorted.length; i++) {
            int diff = sorted[i] - sorted[i - 1];
            if (diff < minDiff) {
                minDiff = diff;
                a = sorted[i - 1];
                b = sorted[i];
            }
        }
        System.out.printf("Closest pair: %d and %d (diff=%d)%n", a, b, minDiff);
    }

    public static void main(String[] args) {
        closestPair(new int[]{23, 5, 17, 42, 9, 31, 8});
    }
}
```

**Python (Optimized -- Theta(n log n)):**

```python
def closest_pair(arr: list[int]) -> tuple[int, int, int]:
    """Theta(n log n) -- sort then scan adjacent."""
    sorted_arr = sorted(arr)  # Theta(n log n)
    min_diff = float("inf")
    a, b = 0, 0
    for i in range(1, len(sorted_arr)):
        diff = sorted_arr[i] - sorted_arr[i - 1]
        if diff < min_diff:
            min_diff = diff
            a, b = sorted_arr[i - 1], sorted_arr[i]
    return a, b, min_diff
```

---

## Exercise 3: Reduce Theta(n^3) to Theta(n^2)

**Problem**: Naive matrix multiplication is Theta(n^3). For the specific case
of multiplying a matrix by a vector, optimize to Theta(n^2).

**Go (Theta(n^2) for matrix-vector):**

```go
package main

import "fmt"

// matVecMultiply: multiply n*n matrix by n-vector
// Time: Theta(n^2) -- two nested loops (not three)
func matVecMultiply(mat [][]int, vec []int) []int {
    n := len(vec)
    result := make([]int, n)
    for i := 0; i < n; i++ {
        sum := 0
        for j := 0; j < n; j++ {
            sum += mat[i][j] * vec[j]
        }
        result[i] = sum
    }
    return result
}

func main() {
    mat := [][]int{{1, 2, 3}, {4, 5, 6}, {7, 8, 9}}
    vec := []int{1, 0, 1}
    result := matVecMultiply(mat, vec)
    fmt.Println("Result:", result) // [4, 10, 16]
}
```

**Java (Theta(n^2)):**

```java
import java.util.Arrays;

public class Exercise3 {
    public static int[] matVecMultiply(int[][] mat, int[] vec) {
        int n = vec.length;
        int[] result = new int[n];
        for (int i = 0; i < n; i++) {
            int sum = 0;
            for (int j = 0; j < n; j++) {
                sum += mat[i][j] * vec[j];
            }
            result[i] = sum;
        }
        return result;
    }

    public static void main(String[] args) {
        int[][] mat = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
        int[] vec = {1, 0, 1};
        System.out.println(Arrays.toString(matVecMultiply(mat, vec)));
    }
}
```

**Python (Theta(n^2)):**

```python
def mat_vec_multiply(mat: list[list[int]], vec: list[int]) -> list[int]:
    """Theta(n^2) -- matrix-vector product."""
    n = len(vec)
    return [sum(mat[i][j] * vec[j] for j in range(n)) for i in range(n)]
```

---

## Exercise 4: Reduce Theta(n) to Theta(log n)

**Problem**: Find an element in a sorted array. Linear scan is Theta(n).
Binary search is Theta(log n) worst case.

**Go (Optimized -- Theta(log n) worst case):**

```go
package main

import "fmt"

// binarySearch in sorted array
// Time: Theta(log n) worst case -- halves search space each step
func binarySearch(arr []int, target int) int {
    low, high := 0, len(arr)-1
    for low <= high {
        mid := low + (high-low)/2
        if arr[mid] == target {
            return mid
        } else if arr[mid] < target {
            low = mid + 1
        } else {
            high = mid - 1
        }
    }
    return -1
}

func main() {
    sorted := []int{2, 5, 8, 12, 16, 23, 38, 56, 72, 91}
    fmt.Println("Index of 23:", binarySearch(sorted, 23))
    fmt.Println("Index of 99:", binarySearch(sorted, 99))
}
```

**Java (Optimized -- Theta(log n)):**

```java
public class Exercise4 {
    public static int binarySearch(int[] arr, int target) {
        int low = 0, high = arr.length - 1;
        while (low <= high) {
            int mid = low + (high - low) / 2;
            if (arr[mid] == target) return mid;
            else if (arr[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        return -1;
    }

    public static void main(String[] args) {
        int[] sorted = {2, 5, 8, 12, 16, 23, 38, 56, 72, 91};
        System.out.println("Index of 23: " + binarySearch(sorted, 23));
    }
}
```

**Python (Optimized -- Theta(log n)):**

```python
def binary_search(arr: list[int], target: int) -> int:
    """Theta(log n) worst case."""
    low, high = 0, len(arr) - 1
    while low <= high:
        mid = (low + high) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1
```

---

## Exercise 5: Redundant Recomputation

**Problem**: Computing Fibonacci naively is Theta(2^n) (exponential). Use
memoization to reduce to Theta(n).

**Go (Unoptimized -- Theta(2^n)):**

```go
func fibSlow(n int) int {
    if n <= 1 {
        return n
    }
    return fibSlow(n-1) + fibSlow(n-2) // Theta(2^n) -- massive redundancy
}
```

**Go (Optimized -- Theta(n)):**

```go
package main

import "fmt"

// fibFast uses bottom-up DP
// Time: Theta(n) -- single loop
// Space: Theta(1) -- only two variables
func fibFast(n int) int {
    if n <= 1 {
        return n
    }
    a, b := 0, 1
    for i := 2; i <= n; i++ {
        a, b = b, a+b
    }
    return b
}

func main() {
    for i := 0; i <= 10; i++ {
        fmt.Printf("fib(%d) = %d\n", i, fibFast(i))
    }
}
```

**Java (Optimized -- Theta(n)):**

```java
public class Exercise5 {
    public static long fibFast(int n) {
        if (n <= 1) return n;
        long a = 0, b = 1;
        for (int i = 2; i <= n; i++) {
            long temp = b;
            b = a + b;
            a = temp;
        }
        return b;
    }

    public static void main(String[] args) {
        for (int i = 0; i <= 10; i++) {
            System.out.printf("fib(%d) = %d%n", i, fibFast(i));
        }
    }
}
```

**Python (Optimized -- Theta(n)):**

```python
def fib_fast(n: int) -> int:
    """Theta(n) -- iterative with two variables."""
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
```

**Analysis**: Theta(2^n) -> Theta(n). Exponential to linear improvement.

---

## Exercise 6: Optimize String Building

**Problem**: Concatenating strings in a loop creates a new string each time.
In many languages, this is Theta(n^2) total. Use a builder for Theta(n).

**Go (Unoptimized -- Theta(n^2)):**

```go
// Theta(n^2) -- string concatenation creates new string each time
func buildStringSlow(n int) string {
    result := ""
    for i := 0; i < n; i++ {
        result += "a" // copies entire string each time
    }
    return result
}
```

**Go (Optimized -- Theta(n)):**

```go
package main

import (
    "fmt"
    "strings"
)

// Theta(n) -- strings.Builder appends in amortized O(1)
func buildStringFast(n int) string {
    var sb strings.Builder
    sb.Grow(n) // pre-allocate
    for i := 0; i < n; i++ {
        sb.WriteByte('a')
    }
    return sb.String()
}

func main() {
    result := buildStringFast(1000)
    fmt.Println("Length:", len(result))
}
```

**Java (Optimized -- Theta(n)):**

```java
public class Exercise6 {
    public static String buildStringFast(int n) {
        StringBuilder sb = new StringBuilder(n);
        for (int i = 0; i < n; i++) {
            sb.append('a');
        }
        return sb.toString();
    }
}
```

**Python (Optimized -- Theta(n)):**

```python
def build_string_fast(n: int) -> str:
    """Theta(n) -- join a list instead of concatenating."""
    return "".join("a" for _ in range(n))
```

---

## Exercise 7: Matrix Search Optimization

**Problem**: Search for a value in a sorted matrix (rows and columns sorted).
Naive: Theta(n^2). Optimized: Theta(n) using staircase search.

**Go (Optimized -- Theta(n)):**

```go
package main

import "fmt"

// searchMatrix uses staircase search from top-right corner
// Time: Theta(n) worst case -- at most 2n steps
func searchMatrix(matrix [][]int, target int) (int, int, bool) {
    if len(matrix) == 0 {
        return -1, -1, false
    }
    rows, cols := len(matrix), len(matrix[0])
    r, c := 0, cols-1

    for r < rows && c >= 0 {
        if matrix[r][c] == target {
            return r, c, true
        } else if matrix[r][c] > target {
            c-- // eliminate column
        } else {
            r++ // eliminate row
        }
    }
    return -1, -1, false
}

func main() {
    matrix := [][]int{
        {1, 4, 7, 11},
        {2, 5, 8, 12},
        {3, 6, 9, 16},
        {10, 13, 14, 17},
    }
    r, c, found := searchMatrix(matrix, 9)
    fmt.Printf("Found 9 at (%d,%d): %v\n", r, c, found)
}
```

**Java (Optimized -- Theta(n)):**

```java
public class Exercise7 {
    public static int[] searchMatrix(int[][] matrix, int target) {
        int rows = matrix.length, cols = matrix[0].length;
        int r = 0, c = cols - 1;
        while (r < rows && c >= 0) {
            if (matrix[r][c] == target) return new int[]{r, c};
            else if (matrix[r][c] > target) c--;
            else r++;
        }
        return new int[]{-1, -1};
    }

    public static void main(String[] args) {
        int[][] matrix = {{1,4,7,11},{2,5,8,12},{3,6,9,16},{10,13,14,17}};
        int[] result = searchMatrix(matrix, 9);
        System.out.printf("Found at (%d,%d)%n", result[0], result[1]);
    }
}
```

**Python (Optimized -- Theta(n)):**

```python
def search_matrix(matrix: list[list[int]], target: int) -> tuple[int, int] | None:
    """Theta(n) -- staircase search from top-right corner."""
    if not matrix:
        return None
    rows, cols = len(matrix), len(matrix[0])
    r, c = 0, cols - 1
    while r < rows and c >= 0:
        if matrix[r][c] == target:
            return (r, c)
        elif matrix[r][c] > target:
            c -= 1
        else:
            r += 1
    return None
```

---

## Exercise 8: Reduce Theta(2^n) to Theta(n)

**Problem**: Count the number of ways to climb n stairs (1 or 2 steps at a
time). Naive recursion: Theta(2^n). DP: Theta(n).

**Go (Optimized -- Theta(n)):**

```go
package main

import "fmt"

// climbStairs counts ways using bottom-up DP
// Time: Theta(n) -- single loop
// Space: Theta(1) -- two variables
func climbStairs(n int) int {
    if n <= 2 {
        return n
    }
    a, b := 1, 2
    for i := 3; i <= n; i++ {
        a, b = b, a+b
    }
    return b
}

func main() {
    for n := 1; n <= 10; n++ {
        fmt.Printf("Stairs(%d) = %d ways\n", n, climbStairs(n))
    }
}
```

**Java (Optimized -- Theta(n)):**

```java
public class Exercise8 {
    public static int climbStairs(int n) {
        if (n <= 2) return n;
        int a = 1, b = 2;
        for (int i = 3; i <= n; i++) {
            int temp = b;
            b = a + b;
            a = temp;
        }
        return b;
    }
}
```

**Python (Optimized -- Theta(n)):**

```python
def climb_stairs(n: int) -> int:
    """Theta(n) -- bottom-up DP."""
    if n <= 2:
        return n
    a, b = 1, 2
    for _ in range(3, n + 1):
        a, b = b, a + b
    return b
```

---

## Exercise 9: Hash Map vs Nested Loop

**Problem**: Two Sum -- find two numbers that add to a target. Naive nested
loop is Theta(n^2). Hash map approach is Theta(n).

**Go (Optimized -- Theta(n)):**

```go
package main

import "fmt"

// twoSum finds indices of two numbers adding to target
// Time: Theta(n) -- single pass with hash map
func twoSum(nums []int, target int) (int, int) {
    seen := make(map[int]int) // value -> index
    for i, num := range nums {
        complement := target - num
        if j, ok := seen[complement]; ok {
            return j, i
        }
        seen[num] = i
    }
    return -1, -1
}

func main() {
    nums := []int{2, 7, 11, 15}
    i, j := twoSum(nums, 9)
    fmt.Printf("Indices: %d, %d\n", i, j) // 0, 1
}
```

**Java (Optimized -- Theta(n)):**

```java
import java.util.HashMap;
import java.util.Map;

public class Exercise9 {
    public static int[] twoSum(int[] nums, int target) {
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
}
```

**Python (Optimized -- Theta(n)):**

```python
def two_sum(nums: list[int], target: int) -> tuple[int, int]:
    """Theta(n) -- hash map for complement lookup."""
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return seen[complement], i
        seen[num] = i
    return -1, -1
```

---

## Exercise 10: Sliding Window

**Problem**: Find the maximum sum of k consecutive elements. Naive recomputation
is Theta(n*k). Sliding window is Theta(n).

**Go (Optimized -- Theta(n)):**

```go
package main

import "fmt"

// maxSumSubarray uses sliding window
// Time: Theta(n) -- single pass
func maxSumSubarray(arr []int, k int) int {
    if len(arr) < k {
        return 0
    }
    windowSum := 0
    for i := 0; i < k; i++ {
        windowSum += arr[i]
    }
    maxSum := windowSum
    for i := k; i < len(arr); i++ {
        windowSum += arr[i] - arr[i-k] // slide: add new, remove old
        if windowSum > maxSum {
            maxSum = windowSum
        }
    }
    return maxSum
}

func main() {
    arr := []int{1, 4, 2, 10, 23, 3, 1, 0, 20}
    fmt.Println("Max sum of 4 elements:", maxSumSubarray(arr, 4)) // 39
}
```

**Java (Optimized -- Theta(n)):**

```java
public class Exercise10 {
    public static int maxSumSubarray(int[] arr, int k) {
        int windowSum = 0;
        for (int i = 0; i < k; i++) windowSum += arr[i];
        int maxSum = windowSum;
        for (int i = k; i < arr.length; i++) {
            windowSum += arr[i] - arr[i - k];
            maxSum = Math.max(maxSum, windowSum);
        }
        return maxSum;
    }
}
```

**Python (Optimized -- Theta(n)):**

```python
def max_sum_subarray(arr: list[int], k: int) -> int:
    """Theta(n) -- sliding window."""
    window_sum = sum(arr[:k])
    max_sum = window_sum
    for i in range(k, len(arr)):
        window_sum += arr[i] - arr[i - k]
        max_sum = max(max_sum, window_sum)
    return max_sum
```

---

## Exercise 11: Prefix Sum Optimization

**Problem**: Answer many range sum queries. Naive per-query is Theta(n). With
Theta(n) preprocessing, each query becomes Theta(1).

**Go (Optimized):**

```go
package main

import "fmt"

// PrefixSum enables Theta(1) range sum queries after Theta(n) preprocessing
type PrefixSum struct {
    prefix []int
}

// NewPrefixSum builds the prefix sum array: Theta(n)
func NewPrefixSum(arr []int) *PrefixSum {
    prefix := make([]int, len(arr)+1)
    for i, v := range arr {
        prefix[i+1] = prefix[i] + v
    }
    return &PrefixSum{prefix: prefix}
}

// RangeSum returns sum of arr[left..right] inclusive: Theta(1)
func (ps *PrefixSum) RangeSum(left, right int) int {
    return ps.prefix[right+1] - ps.prefix[left]
}

func main() {
    arr := []int{3, 1, 4, 1, 5, 9, 2, 6}
    ps := NewPrefixSum(arr)

    fmt.Println("Sum [1..4]:", ps.RangeSum(1, 4)) // 1+4+1+5 = 11
    fmt.Println("Sum [0..7]:", ps.RangeSum(0, 7)) // 31
    fmt.Println("Sum [3..5]:", ps.RangeSum(3, 5)) // 1+5+9 = 15
}
```

**Java (Optimized):**

```java
public class Exercise11 {
    private int[] prefix;

    public Exercise11(int[] arr) {
        prefix = new int[arr.length + 1];
        for (int i = 0; i < arr.length; i++) {
            prefix[i + 1] = prefix[i] + arr[i];
        }
    }

    public int rangeSum(int left, int right) {
        return prefix[right + 1] - prefix[left];
    }

    public static void main(String[] args) {
        int[] arr = {3, 1, 4, 1, 5, 9, 2, 6};
        Exercise11 ps = new Exercise11(arr);
        System.out.println("Sum [1..4]: " + ps.rangeSum(1, 4));
    }
}
```

**Python (Optimized):**

```python
class PrefixSum:
    """Theta(n) preprocessing, Theta(1) per query."""

    def __init__(self, arr: list[int]):
        self.prefix = [0] * (len(arr) + 1)
        for i, v in enumerate(arr):
            self.prefix[i + 1] = self.prefix[i] + v

    def range_sum(self, left: int, right: int) -> int:
        return self.prefix[right + 1] - self.prefix[left]
```

---

## Exercise 12: Sorting-Based Optimization

**Problem**: Find the kth largest element. Naive: sort entire array Theta(n log n).
Optimized: use quickselect for Theta(n) average case.

**Go (Optimized -- Theta(n) average):**

```go
package main

import (
    "fmt"
    "math/rand"
)

// quickSelect finds the kth smallest element
// Time: Theta(n) average case (but Theta(n^2) worst case)
func quickSelect(arr []int, k int) int {
    if len(arr) == 1 {
        return arr[0]
    }
    pivot := arr[rand.Intn(len(arr))]

    var less, equal, greater []int
    for _, v := range arr {
        if v < pivot {
            less = append(less, v)
        } else if v == pivot {
            equal = append(equal, v)
        } else {
            greater = append(greater, v)
        }
    }

    if k < len(less) {
        return quickSelect(less, k)
    } else if k < len(less)+len(equal) {
        return pivot
    }
    return quickSelect(greater, k-len(less)-len(equal))
}

func kthLargest(arr []int, k int) int {
    return quickSelect(arr, len(arr)-k)
}

func main() {
    arr := []int{3, 2, 1, 5, 6, 4}
    fmt.Println("2nd largest:", kthLargest(arr, 2)) // 5
}
```

**Java (Optimized -- Theta(n) average):**

```java
import java.util.*;

public class Exercise12 {
    public static int quickSelect(List<Integer> arr, int k) {
        if (arr.size() == 1) return arr.get(0);
        int pivot = arr.get(new Random().nextInt(arr.size()));

        List<Integer> less = new ArrayList<>(), equal = new ArrayList<>(), greater = new ArrayList<>();
        for (int v : arr) {
            if (v < pivot) less.add(v);
            else if (v == pivot) equal.add(v);
            else greater.add(v);
        }

        if (k < less.size()) return quickSelect(less, k);
        else if (k < less.size() + equal.size()) return pivot;
        return quickSelect(greater, k - less.size() - equal.size());
    }

    public static int kthLargest(int[] arr, int k) {
        List<Integer> list = new ArrayList<>();
        for (int v : arr) list.add(v);
        return quickSelect(list, arr.length - k);
    }

    public static void main(String[] args) {
        System.out.println("2nd largest: " + kthLargest(new int[]{3,2,1,5,6,4}, 2));
    }
}
```

**Python (Optimized -- Theta(n) average):**

```python
import random


def quick_select(arr: list[int], k: int) -> int:
    """Theta(n) average case."""
    if len(arr) == 1:
        return arr[0]
    pivot = random.choice(arr)
    less = [x for x in arr if x < pivot]
    equal = [x for x in arr if x == pivot]
    greater = [x for x in arr if x > pivot]

    if k < len(less):
        return quick_select(less, k)
    elif k < len(less) + len(equal):
        return pivot
    return quick_select(greater, k - len(less) - len(equal))


def kth_largest(arr: list[int], k: int) -> int:
    return quick_select(arr, len(arr) - k)
```

---

## Optimization Summary Table

| # | Problem                    | Before         | After            | Technique               |
|---|----------------------------|----------------|------------------|-------------------------|
| 1 | Duplicate detection        | Theta(n^2)     | Theta(n)         | Hash set                |
| 2 | Closest pair               | Theta(n^2)     | Theta(n log n)   | Sort first              |
| 3 | Matrix-vector multiply     | Theta(n^3)     | Theta(n^2)       | Exploit structure       |
| 4 | Search in sorted array     | Theta(n)       | Theta(log n)     | Binary search           |
| 5 | Fibonacci                  | Theta(2^n)     | Theta(n)         | DP / memoization        |
| 6 | String building            | Theta(n^2)     | Theta(n)         | StringBuilder           |
| 7 | Sorted matrix search       | Theta(n^2)     | Theta(n)         | Staircase search        |
| 8 | Staircase counting         | Theta(2^n)     | Theta(n)         | DP                      |
| 9 | Two Sum                    | Theta(n^2)     | Theta(n)         | Hash map                |
| 10| Max sum subarray           | Theta(n*k)     | Theta(n)         | Sliding window          |
| 11| Range sum queries          | Theta(n) each  | Theta(1) each    | Prefix sum              |
| 12| Kth largest                | Theta(n log n) | Theta(n) avg     | Quickselect             |

---

*Next: Continue to [Specification](specification.md) for references.*
