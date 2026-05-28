# Big-O Notation -- Find the Bug (Wrong Complexity Claims)

## Instructions

Each exercise contains code with a **claimed Big-O complexity** that is **wrong**. Your task is to:

1. Identify the actual Big-O complexity.
2. Explain why the original claim is incorrect.
3. Suggest how to fix the code to match the claimed complexity (where applicable).

---

## Exercise 1: "This is O(n)"

**Claim:** The following function runs in O(n) time.

**Go:**
```go
// CLAIMED: O(n)
func findDuplicates(arr []int) []int {
    duplicates := []int{}
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i] == arr[j] {
                duplicates = append(duplicates, arr[i])
            }
        }
    }
    return duplicates
}
```

**Java:**
```java
// CLAIMED: O(n)
public static List<Integer> findDuplicates(int[] arr) {
    List<Integer> duplicates = new ArrayList<>();
    for (int i = 0; i < arr.length; i++) {
        for (int j = i + 1; j < arr.length; j++) {
            if (arr[i] == arr[j]) {
                duplicates.add(arr[i]);
            }
        }
    }
    return duplicates;
}
```

**Python:**
```python
# CLAIMED: O(n)
def find_duplicates(arr):
    duplicates = []
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                duplicates.append(arr[i])
    return duplicates
```

**Bug:** The actual complexity is **O(n^2)** due to nested loops. The inner loop iterates roughly n(n-1)/2 times total.

**Fix:** Use a hash set to track seen elements, achieving true O(n):
```go
func findDuplicatesFixed(arr []int) []int {
    seen := make(map[int]bool)
    added := make(map[int]bool)
    duplicates := []int{}
    for _, v := range arr {
        if seen[v] && !added[v] {
            duplicates = append(duplicates, v)
            added[v] = true
        }
        seen[v] = true
    }
    return duplicates
}
```

---

## Exercise 2: "This is O(n)"

**Claim:** String building runs in O(n) time.

**Go:**
```go
// CLAIMED: O(n)
func repeatChar(ch byte, n int) string {
    result := ""
    for i := 0; i < n; i++ {
        result += string(ch) // Concatenation in a loop
    }
    return result
}
```

**Java:**
```java
// CLAIMED: O(n)
public static String repeatChar(char ch, int n) {
    String result = "";
    for (int i = 0; i < n; i++) {
        result += ch; // Concatenation in a loop
    }
    return result;
}
```

**Python:**
```python
# CLAIMED: O(n)
def repeat_char(ch, n):
    result = ""
    for i in range(n):
        result += ch  # Concatenation in a loop
    return result
```

**Bug:** The actual complexity is **O(n^2)** in the worst case. Each string concatenation creates a new string and copies all previous characters. Iteration i copies i characters, so total copies = 1 + 2 + 3 + ... + n = n(n+1)/2 = O(n^2).

**Fix (Go):**
```go
func repeatCharFixed(ch byte, n int) string {
    var sb strings.Builder
    sb.Grow(n)
    for i := 0; i < n; i++ {
        sb.WriteByte(ch)
    }
    return sb.String() // True O(n)
}
```

**Fix (Java):** Use `StringBuilder`. **Fix (Python):** Use `"".join(["a"] * n)`.

---

## Exercise 3: "This is O(log n)"

**Claim:** The following search runs in O(log n) time.

**Go:**
```go
// CLAIMED: O(log n)
func search(arr []int, target int) int {
    for i := 0; i < len(arr); i++ {
        if arr[i] == target {
            return i
        }
    }
    return -1
}
```

**Java:**
```java
// CLAIMED: O(log n)
public static int search(int[] arr, int target) {
    for (int i = 0; i < arr.length; i++) {
        if (arr[i] == target) return i;
    }
    return -1;
}
```

**Python:**
```python
# CLAIMED: O(log n)
def search(arr, target):
    for i in range(len(arr)):
        if arr[i] == target:
            return i
    return -1
```

**Bug:** This is a **linear search**, not binary search. The actual complexity is **O(n)**. Every element is checked sequentially in the worst case.

**Fix:** Use binary search (requires sorted input):
```go
func searchFixed(arr []int, target int) int {
    lo, hi := 0, len(arr)-1
    for lo <= hi {
        mid := lo + (hi-lo)/2
        if arr[mid] == target { return mid }
        if arr[mid] < target { lo = mid + 1 } else { hi = mid - 1 }
    }
    return -1
}
```

---

## Exercise 4: "This is O(n)"

**Claim:** Checking if a list contains a value inside a loop is O(n) total.

**Go:**
```go
// CLAIMED: O(n) total
func removeDuplicates(arr []int) []int {
    result := []int{}
    for _, v := range arr {
        found := false
        for _, r := range result { // Hidden O(n) search!
            if r == v {
                found = true
                break
            }
        }
        if !found {
            result = append(result, v)
        }
    }
    return result
}
```

**Java:**
```java
// CLAIMED: O(n) total
public static List<Integer> removeDuplicates(int[] arr) {
    List<Integer> result = new ArrayList<>();
    for (int v : arr) {
        if (!result.contains(v)) { // Hidden O(n) search!
            result.add(v);
        }
    }
    return result;
}
```

**Python:**
```python
# CLAIMED: O(n) total
def remove_duplicates(arr):
    result = []
    for v in arr:
        if v not in result:  # Hidden O(n) search!
            result.append(v)
    return result
```

**Bug:** The actual complexity is **O(n^2)**. The `contains`/`in` check on a list is O(n), and it is called for each of the n elements. Total: O(n) * O(n) = O(n^2).

**Fix:** Use a hash set for O(1) lookups:
```go
func removeDuplicatesFixed(arr []int) []int {
    seen := make(map[int]bool)
    result := []int{}
    for _, v := range arr {
        if !seen[v] {
            seen[v] = true
            result = append(result, v)
        }
    }
    return result
}
```

---

## Exercise 5: "This is O(n log n)"

**Claim:** The following function is O(n log n).

**Go:**
```go
// CLAIMED: O(n log n)
func sortAndSearch(arr []int, targets []int) []bool {
    sort.Ints(arr) // O(n log n)
    results := make([]bool, len(targets))
    for i, t := range targets { // O(m) where m = len(targets)
        // Linear search instead of binary search!
        for _, v := range arr {
            if v == t {
                results[i] = true
                break
            }
        }
    }
    return results
}
```

**Java:**
```java
// CLAIMED: O(n log n)
public static boolean[] sortAndSearch(int[] arr, int[] targets) {
    Arrays.sort(arr); // O(n log n)
    boolean[] results = new boolean[targets.length];
    for (int i = 0; i < targets.length; i++) {
        for (int v : arr) { // Linear search!
            if (v == targets[i]) { results[i] = true; break; }
        }
    }
    return results;
}
```

**Python:**
```python
# CLAIMED: O(n log n)
def sort_and_search(arr, targets):
    arr.sort()  # O(n log n)
    results = []
    for t in targets:
        results.append(t in arr)  # Linear search! O(n) per target
    return results
```

**Bug:** The actual complexity is **O(n log n + m * n)** where m = len(targets). The array is sorted (good), but then linear search is used instead of binary search. If m is comparable to n, this becomes O(n^2).

**Fix:** Use binary search after sorting:
```go
func sortAndSearchFixed(arr []int, targets []int) []bool {
    sort.Ints(arr) // O(n log n)
    results := make([]bool, len(targets))
    for i, t := range targets {
        results[i] = binarySearch(arr, t) // O(log n) per target
    }
    return results // Total: O(n log n + m log n)
}
```

---

## Exercise 6: "This is O(n)"

**Claim:** Processing each element once is O(n).

**Go:**
```go
// CLAIMED: O(n)
func flattenAndSort(matrix [][]int) []int {
    flat := []int{}
    for _, row := range matrix {
        flat = append(flat, row...)
    }
    sort.Ints(flat) // This is NOT O(n)!
    return flat
}
```

**Bug:** If the matrix has n total elements, flattening is O(n) but sorting is O(n log n). The actual complexity is **O(n log n)**, not O(n).

**Fix:** If O(n) is truly needed, use a merge-based approach on already-sorted rows (O(rows * n)), or accept that the function is O(n log n) and update the documentation.

---

## Exercise 7: "This is O(1) space"

**Claim:** The function uses O(1) auxiliary space.

**Go:**
```go
// CLAIMED: O(1) space
func mergeSort(arr []int) []int {
    if len(arr) <= 1 {
        return arr
    }
    mid := len(arr) / 2
    left := mergeSort(arr[:mid])
    right := mergeSort(arr[mid:])
    
    merged := make([]int, 0, len(arr)) // Allocates new array!
    i, j := 0, 0
    for i < len(left) && j < len(right) {
        if left[i] <= right[j] {
            merged = append(merged, left[i]); i++
        } else {
            merged = append(merged, right[j]); j++
        }
    }
    merged = append(merged, left[i:]...)
    merged = append(merged, right[j:]...)
    return merged
}
```

**Bug:** Merge sort uses **O(n) auxiliary space** for the merged arrays, plus **O(log n) stack space** for recursion. The total space is O(n), not O(1).

**Fix:** If O(1) space is required, use an in-place sorting algorithm like heap sort.

---

## Exercise 8: "This is O(V + E)"

**Claim:** The graph traversal is O(V + E).

**Go:**
```go
// CLAIMED: O(V + E)
func bfsAllPaths(graph map[int][]int, start int) [][]int {
    paths := [][]int{{start}}
    result := [][]int{}
    
    for len(paths) > 0 {
        path := paths[0]
        paths = paths[1:]
        node := path[len(path)-1]
        
        if len(graph[node]) == 0 {
            result = append(result, path)
            continue
        }
        
        for _, neighbor := range graph[node] {
            newPath := make([]int, len(path))
            copy(newPath, path)
            newPath = append(newPath, neighbor)
            paths = append(paths, newPath)
        }
    }
    return result
}
```

**Bug:** This function finds ALL paths, not just BFS traversal. Without a visited check, it can revisit nodes and explore exponentially many paths. In a graph with cycles, it will loop infinitely. Even in a DAG, the number of paths can be exponential: **O(2^V)** in the worst case.

**Fix:** If BFS is the goal, add a visited set and do not track full paths:
```go
func bfsFixed(graph map[int][]int, start int) []int {
    visited := map[int]bool{start: true}
    queue := []int{start}
    result := []int{}
    for len(queue) > 0 {
        node := queue[0]; queue = queue[1:]
        result = append(result, node)
        for _, neighbor := range graph[node] {
            if !visited[neighbor] {
                visited[neighbor] = true
                queue = append(queue, neighbor)
            }
        }
    }
    return result // True O(V + E)
}
```

---

## Exercise 9: "This is O(n)"

**Claim:** The sliding window approach is O(n).

**Go:**
```go
// CLAIMED: O(n)
func maxSubarraySum(arr []int, k int) int {
    n := len(arr)
    maxSum := 0
    for i := 0; i <= n-k; i++ {
        sum := 0
        for j := i; j < i+k; j++ { // Recomputing sum from scratch each time!
            sum += arr[j]
        }
        if sum > maxSum {
            maxSum = sum
        }
    }
    return maxSum
}
```

**Java:**
```java
// CLAIMED: O(n)
public static int maxSubarraySum(int[] arr, int k) {
    int n = arr.length;
    int maxSum = 0;
    for (int i = 0; i <= n - k; i++) {
        int sum = 0;
        for (int j = i; j < i + k; j++) { // Recomputing!
            sum += arr[j];
        }
        maxSum = Math.max(maxSum, sum);
    }
    return maxSum;
}
```

**Python:**
```python
# CLAIMED: O(n)
def max_subarray_sum(arr, k):
    n = len(arr)
    max_sum = 0
    for i in range(n - k + 1):
        current_sum = sum(arr[i:i+k])  # Recomputing!
        max_sum = max(max_sum, current_sum)
    return max_sum
```

**Bug:** The actual complexity is **O(n * k)**. For each of the (n - k + 1) windows, the inner loop sums k elements. If k is proportional to n, this becomes O(n^2).

**Fix:** Use a true sliding window that adds the new element and removes the old:
```go
func maxSubarraySumFixed(arr []int, k int) int {
    windowSum := 0
    for i := 0; i < k; i++ { windowSum += arr[i] }
    maxSum := windowSum
    for i := k; i < len(arr); i++ {
        windowSum += arr[i] - arr[i-k] // Slide: add new, remove old
        if windowSum > maxSum { maxSum = windowSum }
    }
    return maxSum // True O(n)
}
```

---

## Exercise 10: "This is O(n log n)"

**Claim:** Sorting and then removing duplicates is O(n log n).

**Go:**
```go
// CLAIMED: O(n log n)
func uniqueSorted(arr []int) []int {
    sort.Ints(arr) // O(n log n) -- correct
    result := []int{}
    for i := 0; i < len(arr); i++ {
        // Check if already in result using linear search
        found := false
        for _, v := range result {
            if v == arr[i] { found = true; break }
        }
        if !found {
            result = append(result, arr[i])
        }
    }
    return result
}
```

**Bug:** The actual complexity is **O(n log n + n^2) = O(n^2)**. After sorting, the uniqueness check uses a linear scan of the result slice for each element. Since the array is already sorted, adjacent duplicates can be detected in O(1).

**Fix:**
```go
func uniqueSortedFixed(arr []int) []int {
    sort.Ints(arr) // O(n log n)
    result := []int{arr[0]}
    for i := 1; i < len(arr); i++ {
        if arr[i] != arr[i-1] { // O(1) check against previous element
            result = append(result, arr[i])
        }
    }
    return result // Total: O(n log n) as claimed
}
```

---

## Exercise 11: "This recursive function is O(n)"

**Claim:** The function computes power in O(n) time.

**Go:**
```go
// CLAIMED: O(n)
func power(base, exp int) int {
    if exp == 0 { return 1 }
    if exp%2 == 0 {
        half := power(base, exp/2)
        return half * half
    }
    return base * power(base, exp-1)
}
```

**Bug:** This is actually **O(log n)**, which is better than claimed. The exponent is halved at each even step, and the odd step reduces it by 1 (making it even for the next call). The recursion depth is O(log n). The claim of O(n) is technically correct (it is an upper bound) but it is a misleadingly loose bound. The tight bound is O(log n).

**Note:** This is a different kind of "bug" -- the claim is not wrong, but it is misleading. In code reviews, always provide the tightest correct bound.

---

## Exercise 12: "HashMap gives us O(1)"

**Claim:** The entire function is O(1) because it uses a hash map.

**Go:**
```go
// CLAIMED: O(1)
func buildIndex(words []string) map[string][]int {
    index := make(map[string][]int)
    for i, word := range words { // This loop is O(n)!
        index[word] = append(index[word], i)
    }
    return index
}
```

**Java:**
```java
// CLAIMED: O(1)
public static Map<String, List<Integer>> buildIndex(String[] words) {
    Map<String, List<Integer>> index = new HashMap<>();
    for (int i = 0; i < words.length; i++) {
        index.computeIfAbsent(words[i], k -> new ArrayList<>()).add(i);
    }
    return index;
}
```

**Python:**
```python
# CLAIMED: O(1)
def build_index(words):
    index = {}
    for i, word in enumerate(words):
        if word not in index:
            index[word] = []
        index[word].append(i)
    return index
```

**Bug:** The actual complexity is **O(n)** where n = len(words). Hash map operations are O(1) per operation, but the function iterates over all n words. O(1) per operation does not mean O(1) total when there are n operations.

**Fix:** Update the documentation to O(n). The code itself is already optimal for building an index.
