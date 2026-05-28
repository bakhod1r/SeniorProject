# Polynomial Time O(n^2), O(n^3) -- Find the Bug

## Table of Contents

1. [Exercise 1: Bubble Sort Off-by-One](#exercise-1-bubble-sort-off-by-one)
2. [Exercise 2: Selection Sort Wrong Swap](#exercise-2-selection-sort-wrong-swap)
3. [Exercise 3: Insertion Sort Key Overwrite](#exercise-3-insertion-sort-key-overwrite)
4. [Exercise 4: Two Sum Returns Wrong Indices](#exercise-4-two-sum-returns-wrong-indices)
5. [Exercise 5: Matrix Multiplication Index Error](#exercise-5-matrix-multiplication-index-error)
6. [Exercise 6: Floyd-Warshall Overflow](#exercise-6-floyd-warshall-overflow)
7. [Exercise 7: Three Sum Duplicate Results](#exercise-7-three-sum-duplicate-results)
8. [Exercise 8: Closest Pair Missing Update](#exercise-8-closest-pair-missing-update)
9. [Exercise 9: Count Inversions Double Counting](#exercise-9-count-inversions-double-counting)
10. [Exercise 10: Max Subarray Wrong Initialization](#exercise-10-max-subarray-wrong-initialization)
11. [Exercise 11: Matrix Transpose Corruption](#exercise-11-matrix-transpose-corruption)
12. [Exercise 12: Pairwise Distance NaN](#exercise-12-pairwise-distance-nan)

---

## Exercise 1: Bubble Sort Off-by-One

The following bubble sort does not fully sort the array. Find the bug.

### Go

```go
func bubbleSort(arr []int) {
    n := len(arr)
    for i := 0; i < n; i++ {         // BUG IS HERE
        for j := 0; j < n-i; j++ {   // BUG IS HERE
            if arr[j] > arr[j+1] {
                arr[j], arr[j+1] = arr[j+1], arr[j]
            }
        }
    }
}
```

### Java

```java
void bubbleSort(int[] arr) {
    int n = arr.length;
    for (int i = 0; i < n; i++) {         // BUG IS HERE
        for (int j = 0; j < n - i; j++) { // BUG IS HERE
            if (arr[j] > arr[j + 1]) {
                int temp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = temp;
            }
        }
    }
}
```

### Python

```python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n):              # BUG IS HERE
        for j in range(n - i):     # BUG IS HERE
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
```

<details>
<summary>Solution</summary>

**Bug:** The inner loop goes up to `n - i`, but `arr[j+1]` accesses index `n-i`
which is out of bounds. The outer loop should go to `n-1`, and the inner loop
should go to `n-1-i`.

**Fix:** Change `for i := 0; i < n; i++` to `for i := 0; i < n-1; i++` and
change `j < n-i` to `j < n-1-i`.

```go
// Go -- Fixed
func bubbleSort(arr []int) {
    n := len(arr)
    for i := 0; i < n-1; i++ {
        for j := 0; j < n-1-i; j++ {
            if arr[j] > arr[j+1] {
                arr[j], arr[j+1] = arr[j+1], arr[j]
            }
        }
    }
}
```
</details>

---

## Exercise 2: Selection Sort Wrong Swap

The selection sort sometimes produces incorrect results. Find the bug.

### Go

```go
func selectionSort(arr []int) {
    n := len(arr)
    for i := 0; i < n-1; i++ {
        minIdx := i
        for j := i + 1; j < n; j++ {
            if arr[j] < arr[minIdx] {
                minIdx = j
            }
        }
        arr[i], arr[i+1] = arr[i+1], arr[i] // BUG IS HERE
    }
}
```

### Java

```java
void selectionSort(int[] arr) {
    int n = arr.length;
    for (int i = 0; i < n - 1; i++) {
        int minIdx = i;
        for (int j = i + 1; j < n; j++) {
            if (arr[j] < arr[minIdx]) minIdx = j;
        }
        int temp = arr[i];
        arr[i] = arr[i + 1];   // BUG IS HERE
        arr[i + 1] = temp;     // BUG IS HERE
    }
}
```

### Python

```python
def selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]:
                min_idx = j
        arr[i], arr[i + 1] = arr[i + 1], arr[i]  # BUG IS HERE
```

<details>
<summary>Solution</summary>

**Bug:** The swap uses `i+1` instead of `minIdx`. It swaps with the adjacent
element instead of the minimum element.

**Fix:** Change `arr[i], arr[i+1]` to `arr[i], arr[minIdx]`.

```go
// Go -- Fixed
arr[i], arr[minIdx] = arr[minIdx], arr[i]
```
</details>

---

## Exercise 3: Insertion Sort Key Overwrite

The insertion sort corrupts data. Find the bug.

### Go

```go
func insertionSort(arr []int) {
    for i := 1; i < len(arr); i++ {
        j := i - 1
        for j >= 0 && arr[j] > arr[j+1] { // BUG IS HERE
            arr[j+1] = arr[j]
            j--
        }
        arr[j+1] = arr[j+1] // BUG IS HERE
    }
}
```

### Java

```java
void insertionSort(int[] arr) {
    for (int i = 1; i < arr.length; i++) {
        int j = i - 1;
        while (j >= 0 && arr[j] > arr[j + 1]) { // BUG IS HERE
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = arr[j + 1]; // BUG IS HERE
    }
}
```

### Python

```python
def insertion_sort(arr):
    for i in range(1, len(arr)):
        j = i - 1
        while j >= 0 and arr[j] > arr[j + 1]:  # BUG IS HERE
            arr[j + 1] = arr[j]
            j -= 1
        arr[j + 1] = arr[j + 1]  # BUG IS HERE
```

<details>
<summary>Solution</summary>

**Bug:** The key value `arr[i]` is never saved before shifting. The comparison
should be `arr[j] > key` (not `arr[j] > arr[j+1]`), and the final assignment
should place `key` (not `arr[j+1]`). Without saving the key, it gets overwritten
by the shifting.

**Fix:**

```go
// Go -- Fixed
func insertionSort(arr []int) {
    for i := 1; i < len(arr); i++ {
        key := arr[i]              // Save the key
        j := i - 1
        for j >= 0 && arr[j] > key { // Compare with key
            arr[j+1] = arr[j]
            j--
        }
        arr[j+1] = key             // Place the key
    }
}
```
</details>

---

## Exercise 4: Two Sum Returns Wrong Indices

The two sum function sometimes returns incorrect indices. Find the bug.

### Go

```go
func twoSum(nums []int, target int) [2]int {
    for i := 0; i < len(nums); i++ {
        for j := 0; j < len(nums); j++ { // BUG IS HERE
            if nums[i]+nums[j] == target {
                return [2]int{i, j}
            }
        }
    }
    return [2]int{-1, -1}
}
```

### Java

```java
int[] twoSum(int[] nums, int target) {
    for (int i = 0; i < nums.length; i++) {
        for (int j = 0; j < nums.length; j++) { // BUG IS HERE
            if (nums[i] + nums[j] == target) {
                return new int[]{i, j};
            }
        }
    }
    return new int[]{-1, -1};
}
```

### Python

```python
def two_sum(nums, target):
    for i in range(len(nums)):
        for j in range(len(nums)):  # BUG IS HERE
            if nums[i] + nums[j] == target:
                return [i, j]
    return [-1, -1]
```

<details>
<summary>Solution</summary>

**Bug:** The inner loop starts at `j = 0` instead of `j = i + 1`. This allows:
1. An element to pair with itself (i == j), giving false positives
   (e.g., `[3, 5]` with target 6 returns `[0, 0]`)
2. Duplicate pairs returned in both orders

**Fix:** Change `j := 0` to `j := i + 1`.

```go
// Go -- Fixed
for j := i + 1; j < len(nums); j++ {
```
</details>

---

## Exercise 5: Matrix Multiplication Index Error

The matrix multiplication produces wrong results. Find the bug.

### Go

```go
func matMul(a, b [][]int) [][]int {
    n := len(a)
    c := make([][]int, n)
    for i := 0; i < n; i++ {
        c[i] = make([]int, n)
        for j := 0; j < n; j++ {
            for k := 0; k < n; k++ {
                c[i][j] += a[i][j] * b[j][k] // BUG IS HERE
            }
        }
    }
    return c
}
```

### Java

```java
int[][] matMul(int[][] a, int[][] b) {
    int n = a.length;
    int[][] c = new int[n][n];
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) {
            for (int k = 0; k < n; k++) {
                c[i][j] += a[i][j] * b[j][k]; // BUG IS HERE
            }
        }
    }
    return c;
}
```

### Python

```python
def mat_mul(a, b):
    n = len(a)
    c = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            for k in range(n):
                c[i][j] += a[i][j] * b[j][k]  # BUG IS HERE
    return c
```

<details>
<summary>Solution</summary>

**Bug:** The inner product uses `a[i][j] * b[j][k]` instead of `a[i][k] * b[k][j]`.
The correct formula for matrix multiplication is `c[i][j] = sum(a[i][k] * b[k][j])`.

**Fix:**

```go
// Go -- Fixed
c[i][j] += a[i][k] * b[k][j]
```
</details>

---

## Exercise 6: Floyd-Warshall Overflow

The Floyd-Warshall algorithm gives wrong shortest paths for some graphs. Find the bug.

### Go

```go
func floydWarshall(graph [][]int) [][]int {
    n := len(graph)
    dist := make([][]int, n)
    for i := 0; i < n; i++ {
        dist[i] = make([]int, n)
        copy(dist[i], graph[i])
    }
    for k := 0; k < n; k++ {
        for i := 0; i < n; i++ {
            for j := 0; j < n; j++ {
                if dist[i][k]+dist[k][j] < dist[i][j] { // BUG IS HERE
                    dist[i][j] = dist[i][k] + dist[k][j]
                }
            }
        }
    }
    return dist
}
// Assume INF = math.MaxInt64 is used for "no edge"
```

### Java

```java
int[][] floydWarshall(int[][] graph) {
    int n = graph.length;
    int[][] dist = new int[n][n];
    for (int i = 0; i < n; i++) {
        System.arraycopy(graph[i], 0, dist[i], 0, n);
    }
    for (int k = 0; k < n; k++) {
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (dist[i][k] + dist[k][j] < dist[i][j]) { // BUG IS HERE
                    dist[i][j] = dist[i][k] + dist[k][j];
                }
            }
        }
    }
    return dist;
}
// Assume Integer.MAX_VALUE is used for "no edge"
```

### Python

```python
def floyd_warshall(graph):
    n = len(graph)
    dist = [row[:] for row in graph]
    for k in range(n):
        for i in range(n):
            for j in range(n):
                if dist[i][k] + dist[k][j] < dist[i][j]:  # BUG IS HERE
                    dist[i][j] = dist[i][k] + dist[k][j]
    return dist
# Assume float('inf') is used for "no edge"
```

<details>
<summary>Solution</summary>

**Bug:** When INF is `math.MaxInt64` or `Integer.MAX_VALUE`, adding two INF values
causes integer overflow, producing a negative number which then appears "shorter"
than valid paths.

In Python, `float('inf') + float('inf')` is `float('inf')` so there is no overflow,
but in Go/Java you must guard against it.

**Fix:** Check if either operand is INF before adding:

```go
// Go -- Fixed
if dist[i][k] != math.MaxInt64 && dist[k][j] != math.MaxInt64 &&
    dist[i][k]+dist[k][j] < dist[i][j] {
    dist[i][j] = dist[i][k] + dist[k][j]
}
```

Or use `math.MaxInt32 / 2` as INF to avoid overflow:

```go
const INF = math.MaxInt32 / 2
```
</details>

---

## Exercise 7: Three Sum Duplicate Results

The three sum function returns duplicate triplets. Find the bug.

### Go

```go
func threeSum(nums []int) [][]int {
    sort.Ints(nums)
    result := [][]int{}
    n := len(nums)
    for i := 0; i < n-2; i++ {
        for j := i + 1; j < n-1; j++ {
            for k := j + 1; k < n; k++ {
                if nums[i]+nums[j]+nums[k] == 0 {
                    result = append(result, []int{nums[i], nums[j], nums[k]})
                }
            }
        }
    }
    return result
}
// Input: [-1, 0, 1, 2, -1, -4]
// Returns: [[-1, -1, 2], [-1, 0, 1], [-1, 0, 1]]  <- duplicate!
```

### Java

```java
List<List<Integer>> threeSum(int[] nums) {
    Arrays.sort(nums);
    List<List<Integer>> result = new ArrayList<>();
    int n = nums.length;
    for (int i = 0; i < n - 2; i++) {
        for (int j = i + 1; j < n - 1; j++) {
            for (int k = j + 1; k < n; k++) {
                if (nums[i] + nums[j] + nums[k] == 0) {
                    result.add(Arrays.asList(nums[i], nums[j], nums[k]));
                }
            }
        }
    }
    return result;
}
```

### Python

```python
def three_sum(nums):
    nums.sort()
    result = []
    n = len(nums)
    for i in range(n - 2):
        for j in range(i + 1, n - 1):
            for k in range(j + 1, n):
                if nums[i] + nums[j] + nums[k] == 0:
                    result.append([nums[i], nums[j], nums[k]])
    return result
```

<details>
<summary>Solution</summary>

**Bug:** No deduplication. After sorting, duplicate values at the same position
produce duplicate triplets. For example, `[-1, -1, 0, 1, 2]` has two `-1`s at
positions 0 and 1, so `[-1, 0, 1]` is found twice.

**Fix:** Skip duplicate values at each level:

```go
// Go -- Fixed
for i := 0; i < n-2; i++ {
    if i > 0 && nums[i] == nums[i-1] { continue }
    for j := i + 1; j < n-1; j++ {
        if j > i+1 && nums[j] == nums[j-1] { continue }
        for k := j + 1; k < n; k++ {
            if k > j+1 && nums[k] == nums[k-1] { continue }
            if nums[i]+nums[j]+nums[k] == 0 {
                result = append(result, []int{nums[i], nums[j], nums[k]})
            }
        }
    }
}
```
</details>

---

## Exercise 8: Closest Pair Missing Update

The closest pair function returns the wrong minimum distance. Find the bug.

### Go

```go
func closestPair(points [][2]float64) float64 {
    n := len(points)
    minDist := 0.0 // BUG IS HERE
    for i := 0; i < n; i++ {
        for j := i + 1; j < n; j++ {
            dx := points[i][0] - points[j][0]
            dy := points[i][1] - points[j][1]
            dist := math.Sqrt(dx*dx + dy*dy)
            if dist < minDist {
                minDist = dist
            }
        }
    }
    return minDist
}
```

### Java

```java
double closestPair(double[][] points) {
    int n = points.length;
    double minDist = 0.0; // BUG IS HERE
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            double dx = points[i][0] - points[j][0];
            double dy = points[i][1] - points[j][1];
            double dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) minDist = dist;
        }
    }
    return minDist;
}
```

### Python

```python
def closest_pair(points):
    n = len(points)
    min_dist = 0.0  # BUG IS HERE
    for i in range(n):
        for j in range(i + 1, n):
            dx = points[i][0] - points[j][0]
            dy = points[i][1] - points[j][1]
            dist = (dx * dx + dy * dy) ** 0.5
            if dist < min_dist:
                min_dist = dist
    return min_dist
```

<details>
<summary>Solution</summary>

**Bug:** `minDist` is initialized to `0.0`. Since all distances are non-negative,
no distance will be less than 0, so `minDist` is never updated. The function
always returns 0.

**Fix:** Initialize to infinity:

```go
// Go -- Fixed
minDist := math.MaxFloat64
```

```java
// Java -- Fixed
double minDist = Double.MAX_VALUE;
```

```python
# Python -- Fixed
min_dist = float('inf')
```
</details>

---

## Exercise 9: Count Inversions Double Counting

The inversion count is too high. Find the bug.

### Go

```go
func countInversions(arr []int) int {
    count := 0
    for i := 0; i < len(arr); i++ {
        for j := 0; j < len(arr); j++ { // BUG IS HERE
            if arr[i] > arr[j] {
                count++
            }
        }
    }
    return count
}
```

### Java

```java
int countInversions(int[] arr) {
    int count = 0;
    for (int i = 0; i < arr.length; i++) {
        for (int j = 0; j < arr.length; j++) { // BUG IS HERE
            if (arr[i] > arr[j]) count++;
        }
    }
    return count;
}
```

### Python

```python
def count_inversions(arr):
    count = 0
    for i in range(len(arr)):
        for j in range(len(arr)):  # BUG IS HERE
            if arr[i] > arr[j]:
                count += 1
    return count
```

<details>
<summary>Solution</summary>

**Bug:** The inner loop starts at `j = 0` instead of `j = i + 1`. An inversion
is defined as a pair (i, j) where `i < j` and `arr[i] > arr[j]`. Starting j at 0
counts non-inversions (i > j cases) and self-comparisons, effectively double
counting every inversion and counting reverse pairs too.

**Fix:** Change `j := 0` to `j := i + 1`.

```go
// Go -- Fixed
for j := i + 1; j < len(arr); j++ {
```
</details>

---

## Exercise 10: Max Subarray Wrong Initialization

The max subarray sum returns wrong results for all-negative arrays. Find the bug.

### Go

```go
func maxSubarraySum(arr []int) int {
    maxSum := 0 // BUG IS HERE
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
// Input: [-3, -2, -5, -1]
// Expected: -1 (single element -1)
// Returns: 0 (wrong!)
```

### Java

```java
int maxSubarraySum(int[] arr) {
    int maxSum = 0; // BUG IS HERE
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

### Python

```python
def max_subarray_sum(arr):
    max_sum = 0  # BUG IS HERE
    for i in range(len(arr)):
        total = 0
        for j in range(i, len(arr)):
            total += arr[j]
            max_sum = max(max_sum, total)
    return max_sum
```

<details>
<summary>Solution</summary>

**Bug:** `maxSum` is initialized to `0`. For all-negative arrays, no subarray sum
exceeds 0, so the function returns 0 instead of the least negative element.

**Fix:** Initialize to the first element or negative infinity:

```go
// Go -- Fixed
maxSum := arr[0]
```

```python
# Python -- Fixed
max_sum = arr[0]
```
</details>

---

## Exercise 11: Matrix Transpose Corruption

The in-place transpose corrupts the matrix. Find the bug.

### Go

```go
func transpose(matrix [][]int) {
    n := len(matrix)
    for i := 0; i < n; i++ {
        for j := 0; j < n; j++ { // BUG IS HERE
            matrix[i][j], matrix[j][i] = matrix[j][i], matrix[i][j]
        }
    }
}
```

### Java

```java
void transpose(int[][] matrix) {
    int n = matrix.length;
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) { // BUG IS HERE
            int temp = matrix[i][j];
            matrix[i][j] = matrix[j][i];
            matrix[j][i] = temp;
        }
    }
}
```

### Python

```python
def transpose(matrix):
    n = len(matrix)
    for i in range(n):
        for j in range(n):  # BUG IS HERE
            matrix[i][j], matrix[j][i] = matrix[j][i], matrix[i][j]
```

<details>
<summary>Solution</summary>

**Bug:** The inner loop starts at `j = 0` instead of `j = i + 1`. This swaps
each pair twice, which undoes the transpose. The result is the original matrix.

**Fix:** Change `j := 0` to `j := i + 1`:

```go
// Go -- Fixed
for j := i + 1; j < n; j++ {
```
</details>

---

## Exercise 12: Pairwise Distance NaN

The pairwise distance function returns NaN for some inputs. Find the bug.

### Go

```go
func pairwiseDistance(points [][2]float64) [][]float64 {
    n := len(points)
    dist := make([][]float64, n)
    for i := 0; i < n; i++ {
        dist[i] = make([]float64, n)
        for j := 0; j < n; j++ {
            dx := points[i][0] - points[j][0]
            dy := points[i][1] - points[j][1]
            dist[i][j] = math.Sqrt(dx*dx - dy*dy) // BUG IS HERE
        }
    }
    return dist
}
```

### Java

```java
double[][] pairwiseDistance(double[][] points) {
    int n = points.length;
    double[][] dist = new double[n][n];
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) {
            double dx = points[i][0] - points[j][0];
            double dy = points[i][1] - points[j][1];
            dist[i][j] = Math.sqrt(dx * dx - dy * dy); // BUG IS HERE
        }
    }
    return dist;
}
```

### Python

```python
def pairwise_distance(points):
    n = len(points)
    dist = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            dx = points[i][0] - points[j][0]
            dy = points[i][1] - points[j][1]
            dist[i][j] = (dx * dx - dy * dy) ** 0.5  # BUG IS HERE
    return dist
```

<details>
<summary>Solution</summary>

**Bug:** The formula uses `dx*dx - dy*dy` instead of `dx*dx + dy*dy`. When
`dy > dx`, the expression under the square root is negative, producing NaN.

The Euclidean distance formula is `sqrt(dx^2 + dy^2)`, not `sqrt(dx^2 - dy^2)`.

**Fix:** Change `-` to `+`:

```go
// Go -- Fixed
dist[i][j] = math.Sqrt(dx*dx + dy*dy)
```
</details>
