# How to Calculate Complexity? -- Optimization Exercises

## Instructions

Each exercise shows a "Before" version with suboptimal complexity and an "After" version with improved complexity. Study the transformation, understand WHY the optimization works, and verify the complexity claims.

---

## Exercise 1: Two Sum -- O(n^2) to O(n)

**Technique**: Replace nested loop with hash map lookup.

### Before -- O(n^2)

#### Go

```go
func twoSumBefore(arr []int, target int) (int, int) {
    n := len(arr)
    for i := 0; i < n; i++ {
        for j := i + 1; j < n; j++ {
            if arr[i]+arr[j] == target {
                return i, j
            }
        }
    }
    return -1, -1
}
```

#### Java

```java
public static int[] twoSumBefore(int[] arr, int target) {
    for (int i = 0; i < arr.length; i++)
        for (int j = i + 1; j < arr.length; j++)
            if (arr[i] + arr[j] == target)
                return new int[]{i, j};
    return new int[]{-1, -1};
}
```

#### Python

```python
def two_sum_before(arr, target):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] + arr[j] == target:
                return i, j
    return -1, -1
```

### After -- O(n)

#### Go

```go
func twoSumAfter(arr []int, target int) (int, int) {
    seen := make(map[int]int) // value -> index
    for i, val := range arr {
        complement := target - val
        if idx, ok := seen[complement]; ok {
            return idx, i
        }
        seen[val] = i
    }
    return -1, -1
}
```

#### Java

```java
public static int[] twoSumAfter(int[] arr, int target) {
    Map<Integer, Integer> seen = new HashMap<>();
    for (int i = 0; i < arr.length; i++) {
        int complement = target - arr[i];
        if (seen.containsKey(complement))
            return new int[]{seen.get(complement), i};
        seen.put(arr[i], i);
    }
    return new int[]{-1, -1};
}
```

#### Python

```python
def two_sum_after(arr, target):
    seen = {}
    for i, val in enumerate(arr):
        complement = target - val
        if complement in seen:
            return seen[complement], i
        seen[val] = i
    return -1, -1
```

**Why it works**: Hash map lookups are O(1) amortized. One pass through the array: O(n). Trade O(n) space for O(n) time.

---

## Exercise 2: Duplicate Detection -- O(n^2) to O(n)

**Technique**: Use a set instead of pairwise comparison.

### Before -- O(n^2)

#### Go

```go
func hasDupBefore(arr []int) bool {
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

#### Java

```java
public static boolean hasDupBefore(int[] arr) {
    for (int i = 0; i < arr.length; i++)
        for (int j = i + 1; j < arr.length; j++)
            if (arr[i] == arr[j]) return true;
    return false;
}
```

#### Python

```python
def has_dup_before(arr):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                return True
    return False
```

### After -- O(n)

#### Go

```go
func hasDupAfter(arr []int) bool {
    seen := make(map[int]bool)
    for _, val := range arr {
        if seen[val] {
            return true
        }
        seen[val] = true
    }
    return false
}
```

#### Java

```java
public static boolean hasDupAfter(int[] arr) {
    Set<Integer> seen = new HashSet<>();
    for (int val : arr) {
        if (!seen.add(val)) return true;
    }
    return false;
}
```

#### Python

```python
def has_dup_after(arr):
    return len(arr) != len(set(arr))
```

**Why it works**: Set insertion and lookup are O(1) amortized. Single pass: O(n).

---

## Exercise 3: String Building -- O(n^2) to O(n)

**Technique**: Use a builder/buffer instead of string concatenation.

### Before -- O(n^2)

#### Go

```go
func buildStringBefore(n int) string {
    result := ""
    for i := 0; i < n; i++ {
        result += "x"  // creates new string each time, copies old content
    }
    return result
}
```

#### Java

```java
public static String buildStringBefore(int n) {
    String result = "";
    for (int i = 0; i < n; i++) {
        result += "x";  // immutable String, copies each time
    }
    return result;
}
```

#### Python

```python
def build_string_before(n):
    result = ""
    for i in range(n):
        result += "x"  # may copy on each concat
    return result
```

### After -- O(n)

#### Go

```go
func buildStringAfter(n int) string {
    var builder strings.Builder
    builder.Grow(n)  // pre-allocate
    for i := 0; i < n; i++ {
        builder.WriteByte('x')  // O(1) amortized
    }
    return builder.String()
}
```

#### Java

```java
public static String buildStringAfter(int n) {
    StringBuilder sb = new StringBuilder(n);
    for (int i = 0; i < n; i++) {
        sb.append('x');  // O(1) amortized
    }
    return sb.toString();
}
```

#### Python

```python
def build_string_after(n):
    parts = []
    for i in range(n):
        parts.append("x")
    return "".join(parts)  # single allocation
```

**Why it works**: Builder/buffer uses a dynamic array internally. Appending is O(1) amortized (like dynamic arrays). Final string creation is O(n). Total: O(n) vs O(n^2) for repeated concatenation.

---

## Exercise 4: Finding Max in Sorted Windows -- O(n*k) to O(n)

**Technique**: Use a deque (monotonic queue) for sliding window maximum.

### Before -- O(n*k)

#### Go

```go
func maxSlidingBefore(arr []int, k int) []int {
    n := len(arr)
    result := make([]int, 0, n-k+1)
    for i := 0; i <= n-k; i++ {
        maxVal := arr[i]
        for j := i + 1; j < i+k; j++ {
            if arr[j] > maxVal {
                maxVal = arr[j]
            }
        }
        result = append(result, maxVal)
    }
    return result
}
```

#### Java

```java
public static int[] maxSlidingBefore(int[] arr, int k) {
    int n = arr.length;
    int[] result = new int[n - k + 1];
    for (int i = 0; i <= n - k; i++) {
        int max = arr[i];
        for (int j = i + 1; j < i + k; j++)
            if (arr[j] > max) max = arr[j];
        result[i] = max;
    }
    return result;
}
```

#### Python

```python
def max_sliding_before(arr, k):
    n = len(arr)
    result = []
    for i in range(n - k + 1):
        result.append(max(arr[i:i+k]))  # max scans k elements
    return result
```

### After -- O(n)

#### Go

```go
func maxSlidingAfter(arr []int, k int) []int {
    n := len(arr)
    deque := make([]int, 0)    // stores indices
    result := make([]int, 0, n-k+1)

    for i := 0; i < n; i++ {
        // Remove elements outside the window
        for len(deque) > 0 && deque[0] < i-k+1 {
            deque = deque[1:]
        }
        // Remove smaller elements from back
        for len(deque) > 0 && arr[deque[len(deque)-1]] <= arr[i] {
            deque = deque[:len(deque)-1]
        }
        deque = append(deque, i)

        if i >= k-1 {
            result = append(result, arr[deque[0]])
        }
    }
    return result
}
```

#### Java

```java
public static int[] maxSlidingAfter(int[] arr, int k) {
    int n = arr.length;
    int[] result = new int[n - k + 1];
    Deque<Integer> dq = new ArrayDeque<>();

    for (int i = 0; i < n; i++) {
        while (!dq.isEmpty() && dq.peekFirst() < i - k + 1)
            dq.pollFirst();
        while (!dq.isEmpty() && arr[dq.peekLast()] <= arr[i])
            dq.pollLast();
        dq.offerLast(i);
        if (i >= k - 1)
            result[i - k + 1] = arr[dq.peekFirst()];
    }
    return result;
}
```

#### Python

```python
from collections import deque

def max_sliding_after(arr, k):
    dq = deque()  # stores indices
    result = []
    for i in range(len(arr)):
        while dq and dq[0] < i - k + 1:
            dq.popleft()
        while dq and arr[dq[-1]] <= arr[i]:
            dq.pop()
        dq.append(i)
        if i >= k - 1:
            result.append(arr[dq[0]])
    return result
```

**Why it works**: Each element is added to and removed from the deque at most once. Total operations across all iterations: O(n). The deque maintains a decreasing order, so the front is always the maximum.

---

## Exercise 5: Fibonacci -- O(2^n) to O(n)

**Technique**: Memoization / dynamic programming.

### Before -- O(2^n)

#### Go

```go
func fibBefore(n int) int {
    if n <= 1 { return n }
    return fibBefore(n-1) + fibBefore(n-2)
}
```

#### Java

```java
public static int fibBefore(int n) {
    if (n <= 1) return n;
    return fibBefore(n - 1) + fibBefore(n - 2);
}
```

#### Python

```python
def fib_before(n):
    if n <= 1: return n
    return fib_before(n - 1) + fib_before(n - 2)
```

### After -- O(n) time, O(1) space

#### Go

```go
func fibAfter(n int) int {
    if n <= 1 { return n }
    a, b := 0, 1
    for i := 2; i <= n; i++ {
        a, b = b, a+b
    }
    return b
}
```

#### Java

```java
public static int fibAfter(int n) {
    if (n <= 1) return n;
    int a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        int temp = a + b;
        a = b;
        b = temp;
    }
    return b;
}
```

#### Python

```python
def fib_after(n):
    if n <= 1: return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
```

**Why it works**: The naive approach recomputes the same subproblems exponentially many times. The iterative approach computes each value once, keeping only the last two values.

---

## Exercise 6: Prefix Sum -- O(n*q) to O(n+q)

**Technique**: Precompute prefix sums for range queries.

### Before -- O(n*q) where q = number of queries

#### Go

```go
func rangeSumBefore(arr []int, queries [][2]int) []int {
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

#### Java

```java
public static int[] rangeSumBefore(int[] arr, int[][] queries) {
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

#### Python

```python
def range_sum_before(arr, queries):
    results = []
    for l, r in queries:
        results.append(sum(arr[l:r+1]))
    return results
```

### After -- O(n + q)

#### Go

```go
func rangeSumAfter(arr []int, queries [][2]int) []int {
    // Precompute prefix sums: O(n)
    n := len(arr)
    prefix := make([]int, n+1)
    for i := 0; i < n; i++ {
        prefix[i+1] = prefix[i] + arr[i]
    }

    // Answer each query in O(1)
    results := make([]int, len(queries))
    for q, query := range queries {
        results[q] = prefix[query[1]+1] - prefix[query[0]]
    }
    return results
}
```

#### Java

```java
public static int[] rangeSumAfter(int[] arr, int[][] queries) {
    int n = arr.length;
    int[] prefix = new int[n + 1];
    for (int i = 0; i < n; i++)
        prefix[i + 1] = prefix[i] + arr[i];

    int[] results = new int[queries.length];
    for (int q = 0; q < queries.length; q++)
        results[q] = prefix[queries[q][1] + 1] - prefix[queries[q][0]];
    return results;
}
```

#### Python

```python
def range_sum_after(arr, queries):
    # Precompute prefix sums: O(n)
    prefix = [0]
    for x in arr:
        prefix.append(prefix[-1] + x)

    # Each query: O(1)
    return [prefix[r + 1] - prefix[l] for l, r in queries]
```

**Why it works**: Prefix sum precomputation costs O(n). Each range query then becomes a simple subtraction: O(1). Total for q queries: O(n + q) instead of O(n * q).

---

## Exercise 7: Sorted Array Search -- O(n) to O(log n)

**Technique**: Binary search on sorted data.

### Before -- O(n)

#### Go

```go
func searchBefore(arr []int, target int) int {
    for i, v := range arr {
        if v == target { return i }
    }
    return -1
}
```

#### Java

```java
public static int searchBefore(int[] arr, int target) {
    for (int i = 0; i < arr.length; i++)
        if (arr[i] == target) return i;
    return -1;
}
```

#### Python

```python
def search_before(arr, target):
    for i, v in enumerate(arr):
        if v == target: return i
    return -1
```

### After -- O(log n)

#### Go

```go
func searchAfter(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == target { return mid }
        if arr[mid] < target { lo = mid + 1 } else { hi = mid - 1 }
    }
    return -1
}
```

#### Java

```java
public static int searchAfter(int[] arr, int target) {
    int lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}
```

#### Python

```python
def search_after(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target: return mid
        if arr[mid] < target: lo = mid + 1
        else: hi = mid - 1
    return -1
```

**Why it works**: Each comparison eliminates half the search space. Requires the array to be sorted.

---

## Exercise 8: Matrix Search -- O(n*m) to O(n+m)

**Technique**: Start from top-right corner of a sorted matrix.

### Before -- O(n*m)

#### Go

```go
func matrixSearchBefore(matrix [][]int, target int) bool {
    for i := range matrix {
        for j := range matrix[i] {
            if matrix[i][j] == target { return true }
        }
    }
    return false
}
```

#### Java

```java
public static boolean matrixSearchBefore(int[][] matrix, int target) {
    for (int[] row : matrix)
        for (int val : row)
            if (val == target) return true;
    return false;
}
```

#### Python

```python
def matrix_search_before(matrix, target):
    for row in matrix:
        for val in row:
            if val == target: return True
    return False
```

### After -- O(n+m) (for row-and-column sorted matrix)

#### Go

```go
// Matrix where each row and column is sorted in ascending order
func matrixSearchAfter(matrix [][]int, target int) bool {
    if len(matrix) == 0 { return false }
    rows, cols := len(matrix), len(matrix[0])
    r, c := 0, cols-1  // start top-right

    for r < rows && c >= 0 {
        if matrix[r][c] == target {
            return true
        } else if matrix[r][c] < target {
            r++  // target is below, eliminate this row
        } else {
            c--  // target is to the left, eliminate this column
        }
    }
    return false
}
```

#### Java

```java
public static boolean matrixSearchAfter(int[][] matrix, int target) {
    int rows = matrix.length, cols = matrix[0].length;
    int r = 0, c = cols - 1;
    while (r < rows && c >= 0) {
        if (matrix[r][c] == target) return true;
        else if (matrix[r][c] < target) r++;
        else c--;
    }
    return false;
}
```

#### Python

```python
def matrix_search_after(matrix, target):
    if not matrix: return False
    rows, cols = len(matrix), len(matrix[0])
    r, c = 0, cols - 1
    while r < rows and c >= 0:
        if matrix[r][c] == target: return True
        elif matrix[r][c] < target: r += 1
        else: c -= 1
    return False
```

**Why it works**: Starting from the top-right, each comparison eliminates either a row or a column. At most n + m steps total.

---

## Exercise 9: Counting Sort -- O(n log n) to O(n+k)

**Technique**: When values are bounded integers, counting sort avoids comparisons.

### Before -- O(n log n)

#### Go

```go
import "sort"

func sortBefore(arr []int) []int {
    sorted := make([]int, len(arr))
    copy(sorted, arr)
    sort.Ints(sorted)  // comparison-based: O(n log n)
    return sorted
}
```

#### Java

```java
public static int[] sortBefore(int[] arr) {
    int[] sorted = arr.clone();
    Arrays.sort(sorted);  // O(n log n)
    return sorted;
}
```

#### Python

```python
def sort_before(arr):
    return sorted(arr)  # O(n log n)
```

### After -- O(n + k) where k = range of values

#### Go

```go
func countingSortAfter(arr []int, maxVal int) []int {
    count := make([]int, maxVal+1)
    for _, v := range arr {
        count[v]++
    }
    result := make([]int, 0, len(arr))
    for val, cnt := range count {
        for i := 0; i < cnt; i++ {
            result = append(result, val)
        }
    }
    return result
}
```

#### Java

```java
public static int[] countingSortAfter(int[] arr, int maxVal) {
    int[] count = new int[maxVal + 1];
    for (int v : arr) count[v]++;
    int[] result = new int[arr.length];
    int idx = 0;
    for (int val = 0; val <= maxVal; val++)
        for (int i = 0; i < count[val]; i++)
            result[idx++] = val;
    return result;
}
```

#### Python

```python
def counting_sort_after(arr, max_val):
    count = [0] * (max_val + 1)
    for v in arr:
        count[v] += 1
    result = []
    for val, cnt in enumerate(count):
        result.extend([val] * cnt)
    return result
```

**Why it works**: Counting sort is not comparison-based, so it bypasses the O(n log n) lower bound. It works in O(n + k) where k is the range of values. Best when k = O(n).

---

## Exercise 10: Graph Shortest Path -- O(V^2) to O((V+E) log V)

**Technique**: Use a priority queue (min-heap) for Dijkstra's algorithm.

### Before -- O(V^2) with adjacency matrix

#### Python

```python
import math

def dijkstra_before(graph, src):
    """graph is V x V adjacency matrix, 0 means no edge."""
    V = len(graph)
    dist = [math.inf] * V
    dist[src] = 0
    visited = [False] * V

    for _ in range(V):
        # Find unvisited vertex with minimum distance: O(V)
        u = -1
        for v in range(V):
            if not visited[v] and (u == -1 or dist[v] < dist[u]):
                u = v
        visited[u] = True

        # Update neighbors: O(V)
        for v in range(V):
            if graph[u][v] > 0 and dist[u] + graph[u][v] < dist[v]:
                dist[v] = dist[u] + graph[u][v]

    return dist
# Total: V iterations * O(V) per iteration = O(V^2)
```

### After -- O((V+E) log V) with adjacency list and heap

#### Python

```python
import heapq

def dijkstra_after(adj, src):
    """adj is adjacency list: adj[u] = [(v, weight), ...]"""
    V = len(adj)
    dist = [float('inf')] * V
    dist[src] = 0
    heap = [(0, src)]

    while heap:
        d, u = heapq.heappop(heap)  # O(log V)
        if d > dist[u]:
            continue  # stale entry
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                heapq.heappush(heap, (dist[v], v))  # O(log V)

    return dist
# Total: O((V + E) log V)
```

**Why it works**: The min-heap replaces the O(V) linear scan for the minimum with O(log V) extraction. Each edge is processed at most once with an O(log V) heap operation.
