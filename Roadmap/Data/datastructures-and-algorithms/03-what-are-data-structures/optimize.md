# What are Data Structures? — Optimize the Code

## Table of Contents

1. [How to Use This File](#how-to-use-this-file)
2. [Exercise 1: Linear Search to Hash Set O(1)](#exercise-1-linear-search-to-hash-set-o1)
3. [Exercise 2: Nested Duplicate Check to Hash Set O(n)](#exercise-2-nested-duplicate-check-to-hash-set-on)
4. [Exercise 3: String Concatenation to StringBuilder O(n)](#exercise-3-string-concatenation-to-stringbuilder-on)
5. [Exercise 4: Array Insert at Start to Linked List O(1)](#exercise-4-array-insert-at-start-to-linked-list-o1)
6. [Exercise 5: Sort for Min/Max to Single Pass O(n)](#exercise-5-sort-for-minmax-to-single-pass-on)
7. [Exercise 6: Nested Frequency Count to Hash Map O(n)](#exercise-6-nested-frequency-count-to-hash-map-on)
8. [Exercise 7: Queue Array Shift to Deque O(1)](#exercise-7-queue-array-shift-to-deque-o1)
9. [Exercise 8: Check Sorted via Sort to Single Pass O(n)](#exercise-8-check-sorted-via-sort-to-single-pass-on)
10. [Exercise 9: Adjacency Matrix to Adjacency List](#exercise-9-adjacency-matrix-to-adjacency-list)
11. [Exercise 10: Recursive Fibonacci to DP O(n)](#exercise-10-recursive-fibonacci-to-dp-on)
12. [Exercise 11: Two Sum Brute Force to Hash Map O(n)](#exercise-11-two-sum-brute-force-to-hash-map-on)

---

## How to Use This File

Each exercise shows **slow code** that works but is inefficient, followed by **optimized code** that produces the same result with better time or space complexity. For each exercise:

1. Read the slow version and identify the bottleneck.
2. Think about what data structure or technique would eliminate it.
3. Compare your idea to the optimized version.
4. Verify that both versions produce the same output.

---

## Exercise 1: Linear Search to Hash Set O(1)

**Problem:** Check if a value exists in a collection. Called many times.

**Bottleneck:** Scanning the entire list for each lookup is O(n).

### Slow Version — O(n) per lookup

**Go:**
```go
func contains(items []int, target int) bool {
    for _, item := range items {
        if item == target {
            return true
        }
    }
    return false
}

// Called in a loop: O(n) * O(m) = O(n*m)
func main() {
    allowList := []int{1, 5, 10, 15, 20, 25, 30}
    requests := []int{3, 5, 10, 99, 20}
    for _, r := range requests {
        if contains(allowList, r) {
            fmt.Println(r, "allowed")
        }
    }
}
```

**Java:**
```java
public static boolean contains(List<Integer> items, int target) {
    for (int item : items) {
        if (item == target) return true;
    }
    return false;
}
```

**Python:**
```python
def contains(items, target):
    for item in items:
        if item == target:
            return True
    return False
```

### Optimized Version — O(1) per lookup

**Go:**
```go
func main() {
    allowSet := map[int]struct{}{
        1: {}, 5: {}, 10: {}, 15: {}, 20: {}, 25: {}, 30: {},
    }
    requests := []int{3, 5, 10, 99, 20}
    for _, r := range requests {
        if _, ok := allowSet[r]; ok { // O(1) lookup
            fmt.Println(r, "allowed")
        }
    }
}
```

**Java:**
```java
Set<Integer> allowSet = new HashSet<>(Arrays.asList(1, 5, 10, 15, 20, 25, 30));
for (int r : requests) {
    if (allowSet.contains(r)) { // O(1) lookup
        System.out.println(r + " allowed");
    }
}
```

**Python:**
```python
allow_set = {1, 5, 10, 15, 20, 25, 30}
for r in requests:
    if r in allow_set:  # O(1) lookup
        print(r, "allowed")
```

### Analysis

| Version | Per Lookup | Total (m lookups, n items) |
|---|---|---|
| Slow (list scan) | O(n) | O(n * m) |
| Optimized (hash set) | O(1) | O(n + m) |

**Key insight:** Convert the list to a set once (O(n)), then all subsequent lookups are O(1).

---

## Exercise 2: Nested Duplicate Check to Hash Set O(n)

**Problem:** Check if an array contains any duplicate values.

**Bottleneck:** Comparing every pair of elements is O(n^2).

### Slow Version — O(n^2)

**Go:**
```go
func hasDuplicate(arr []int) bool {
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

**Java:**
```java
public static boolean hasDuplicate(int[] arr) {
    for (int i = 0; i < arr.length; i++) {
        for (int j = i + 1; j < arr.length; j++) {
            if (arr[i] == arr[j]) return true;
        }
    }
    return false;
}
```

**Python:**
```python
def has_duplicate(arr):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                return True
    return False
```

### Optimized Version — O(n)

**Go:**
```go
func hasDuplicate(arr []int) bool {
    seen := make(map[int]struct{})
    for _, val := range arr {
        if _, exists := seen[val]; exists {
            return true
        }
        seen[val] = struct{}{}
    }
    return false
}
```

**Java:**
```java
public static boolean hasDuplicate(int[] arr) {
    Set<Integer> seen = new HashSet<>();
    for (int val : arr) {
        if (!seen.add(val)) return true; // add returns false if already present
    }
    return false;
}
```

**Python:**
```python
def has_duplicate(arr):
    return len(arr) != len(set(arr))

# Or short-circuit version:
def has_duplicate(arr):
    seen = set()
    for val in arr:
        if val in seen:
            return True
        seen.add(val)
    return False
```

### Analysis

| Version | Time | Space |
|---|---|---|
| Slow (nested loops) | O(n^2) | O(1) |
| Optimized (hash set) | O(n) | O(n) |

**Trade-off:** We use O(n) extra space to get O(n) time. Almost always worth it.

---

## Exercise 3: String Concatenation to StringBuilder O(n)

**Problem:** Build a large string by concatenating many small strings.

**Bottleneck:** In most languages, strings are immutable. Each concatenation creates a new string and copies all previous characters.

### Slow Version — O(n^2)

**Go:**
```go
func buildString(words []string) string {
    result := ""
    for _, word := range words {
        result += word + " " // Creates a new string each time
    }
    return result
}
```

**Java:**
```java
public static String buildString(String[] words) {
    String result = "";
    for (String word : words) {
        result += word + " "; // Creates new String object each time
    }
    return result;
}
```

**Python:**
```python
def build_string(words):
    result = ""
    for word in words:
        result += word + " "  # Creates new string each time
    return result
```

### Optimized Version — O(n)

**Go:**
```go
import "strings"

func buildString(words []string) string {
    var sb strings.Builder
    for _, word := range words {
        sb.WriteString(word)
        sb.WriteString(" ")
    }
    return sb.String()
}
```

**Java:**
```java
public static String buildString(String[] words) {
    StringBuilder sb = new StringBuilder();
    for (String word : words) {
        sb.append(word).append(" ");
    }
    return sb.toString();
}
```

**Python:**
```python
def build_string(words):
    return " ".join(words)

# Or with explicit list:
def build_string(words):
    parts = []
    for word in words:
        parts.append(word)
    return " ".join(parts)
```

### Analysis

| Version | Time | Why |
|---|---|---|
| Slow (string concat) | O(n^2) | Each concat copies all previous characters: 1+2+3+...+n = n(n+1)/2 |
| Optimized (builder) | O(n) | Builder/list amortizes appends, join copies once at the end |

For 100,000 words of length 10: slow = ~50 billion character copies. Optimized = ~1 million.

---

## Exercise 4: Array Insert at Start to Linked List O(1)

**Problem:** Maintain a log of events where the most recent event must be first.

**Bottleneck:** Inserting at index 0 in an array shifts all elements.

### Slow Version — O(n) per insert

**Go:**
```go
func main() {
    events := []string{}
    for i := 0; i < 100000; i++ {
        event := fmt.Sprintf("event-%d", i)
        events = append([]string{event}, events...) // O(n) shift every time
    }
}
```

**Java:**
```java
ArrayList<String> events = new ArrayList<>();
for (int i = 0; i < 100000; i++) {
    events.add(0, "event-" + i); // O(n) shift
}
```

**Python:**
```python
events = []
for i in range(100_000):
    events.insert(0, f"event-{i}")  # O(n) shift
```

### Optimized Version — O(1) per insert

**Go:**
```go
import "container/list"

func main() {
    events := list.New()
    for i := 0; i < 100000; i++ {
        events.PushFront(fmt.Sprintf("event-%d", i)) // O(1)
    }
}
```

**Java:**
```java
LinkedList<String> events = new LinkedList<>();
for (int i = 0; i < 100000; i++) {
    events.addFirst("event-" + i); // O(1)
}
```

**Python:**
```python
from collections import deque

events = deque()
for i in range(100_000):
    events.appendleft(f"event-{i}")  # O(1)
```

### Analysis

| Version | Per Insert | Total (n inserts) |
|---|---|---|
| Slow (array insert at 0) | O(n) | O(n^2) |
| Optimized (linked list / deque) | O(1) | O(n) |

**Note:** If you also need random access, consider appending to the end and reversing once, or using a deque.

---

## Exercise 5: Sort for Min/Max to Single Pass O(n)

**Problem:** Find the minimum and maximum values in an array.

**Bottleneck:** Sorting the entire array just to get two values is overkill.

### Slow Version — O(n log n)

**Go:**
```go
import "sort"

func minMax(arr []int) (int, int) {
    sorted := make([]int, len(arr))
    copy(sorted, arr)
    sort.Ints(sorted)
    return sorted[0], sorted[len(sorted)-1]
}
```

**Java:**
```java
public static int[] minMax(int[] arr) {
    int[] sorted = arr.clone();
    Arrays.sort(sorted);
    return new int[]{sorted[0], sorted[sorted.length - 1]};
}
```

**Python:**
```python
def min_max(arr):
    sorted_arr = sorted(arr)
    return sorted_arr[0], sorted_arr[-1]
```

### Optimized Version — O(n)

**Go:**
```go
func minMax(arr []int) (int, int) {
    if len(arr) == 0 {
        panic("empty array")
    }
    min, max := arr[0], arr[0]
    for _, val := range arr[1:] {
        if val < min {
            min = val
        }
        if val > max {
            max = val
        }
    }
    return min, max
}
```

**Java:**
```java
public static int[] minMax(int[] arr) {
    int min = arr[0], max = arr[0];
    for (int i = 1; i < arr.length; i++) {
        if (arr[i] < min) min = arr[i];
        if (arr[i] > max) max = arr[i];
    }
    return new int[]{min, max};
}
```

**Python:**
```python
def min_max(arr):
    return min(arr), max(arr)

# Or single pass:
def min_max(arr):
    lo, hi = arr[0], arr[0]
    for val in arr[1:]:
        if val < lo:
            lo = val
        if val > hi:
            hi = val
    return lo, hi
```

### Analysis

| Version | Time | Space |
|---|---|---|
| Slow (sort) | O(n log n) | O(n) copy |
| Optimized (single pass) | O(n) | O(1) |

---

## Exercise 6: Nested Frequency Count to Hash Map O(n)

**Problem:** Count how many times each element appears in an array.

**Bottleneck:** For each element, scanning the entire array to count occurrences is O(n^2).

### Slow Version — O(n^2)

**Go:**
```go
func frequency(arr []int) map[int]int {
    result := map[int]int{}
    for _, val := range arr {
        if _, exists := result[val]; exists {
            continue // Already counted
        }
        count := 0
        for _, v := range arr {
            if v == val {
                count++
            }
        }
        result[val] = count
    }
    return result
}
```

**Java:**
```java
public static Map<Integer, Integer> frequency(int[] arr) {
    Map<Integer, Integer> result = new HashMap<>();
    for (int val : arr) {
        if (result.containsKey(val)) continue;
        int count = 0;
        for (int v : arr) {
            if (v == val) count++;
        }
        result.put(val, count);
    }
    return result;
}
```

**Python:**
```python
def frequency(arr):
    result = {}
    for val in arr:
        if val in result:
            continue
        count = 0
        for v in arr:
            if v == val:
                count += 1
        result[val] = count
    return result
```

### Optimized Version — O(n)

**Go:**
```go
func frequency(arr []int) map[int]int {
    result := map[int]int{}
    for _, val := range arr {
        result[val]++ // O(1) hash map increment
    }
    return result
}
```

**Java:**
```java
public static Map<Integer, Integer> frequency(int[] arr) {
    Map<Integer, Integer> result = new HashMap<>();
    for (int val : arr) {
        result.merge(val, 1, Integer::sum); // O(1)
    }
    return result;
}
```

**Python:**
```python
from collections import Counter

def frequency(arr):
    return dict(Counter(arr))

# Or manually:
def frequency(arr):
    result = {}
    for val in arr:
        result[val] = result.get(val, 0) + 1
    return result
```

### Analysis

| Version | Time | Space |
|---|---|---|
| Slow (nested scan) | O(n^2) | O(k) where k = unique values |
| Optimized (hash map) | O(n) | O(k) |

---

## Exercise 7: Queue Array Shift to Deque O(1)

**Problem:** Implement a queue using an array where dequeue removes from the front.

**Bottleneck:** Removing from the front of an array shifts all remaining elements.

### Slow Version — O(n) per dequeue

**Go:**
```go
type SlowQueue struct {
    data []int
}

func (q *SlowQueue) Enqueue(val int) {
    q.data = append(q.data, val)
}

func (q *SlowQueue) Dequeue() int {
    val := q.data[0]
    q.data = q.data[1:] // Looks O(1) in Go due to slice header, but...
    // Actually, this leaks memory — the underlying array never shrinks.
    // In other languages, this is a full O(n) shift.
    return val
}
```

**Java:**
```java
ArrayList<Integer> queue = new ArrayList<>();
queue.add(val);         // enqueue: O(1)
queue.remove(0);        // dequeue: O(n) — shifts all elements left
```

**Python:**
```python
queue = []
queue.append(val)       # enqueue: O(1)
queue.pop(0)            # dequeue: O(n) — shifts all elements left
```

### Optimized Version — O(1) per dequeue

**Go:**
```go
import "container/list"

queue := list.New()
queue.PushBack(val)                    // enqueue: O(1)
front := queue.Front()
queue.Remove(front)                    // dequeue: O(1)
```

**Java:**
```java
Deque<Integer> queue = new ArrayDeque<>();
queue.offer(val);       // enqueue: O(1)
queue.poll();           // dequeue: O(1)
```

**Python:**
```python
from collections import deque

queue = deque()
queue.append(val)       # enqueue: O(1)
queue.popleft()         # dequeue: O(1)
```

### Analysis

| Version | Enqueue | Dequeue |
|---|---|---|
| Slow (array) | O(1) | O(n) |
| Optimized (deque / circular buffer) | O(1) | O(1) |

For 1,000,000 dequeue operations: slow = ~500 billion shifts. Optimized = 1 million.

---

## Exercise 8: Check Sorted via Sort to Single Pass O(n)

**Problem:** Check if an array is already sorted in ascending order.

**Bottleneck:** Sorting a copy and comparing is O(n log n) when a single pass suffices.

### Slow Version — O(n log n)

**Go:**
```go
import "sort"

func isSorted(arr []int) bool {
    sorted := make([]int, len(arr))
    copy(sorted, arr)
    sort.Ints(sorted)
    for i := range arr {
        if arr[i] != sorted[i] {
            return false
        }
    }
    return true
}
```

**Java:**
```java
public static boolean isSorted(int[] arr) {
    int[] sorted = arr.clone();
    Arrays.sort(sorted);
    return Arrays.equals(arr, sorted);
}
```

**Python:**
```python
def is_sorted(arr):
    return arr == sorted(arr)
```

### Optimized Version — O(n)

**Go:**
```go
func isSorted(arr []int) bool {
    for i := 1; i < len(arr); i++ {
        if arr[i] < arr[i-1] {
            return false
        }
    }
    return true
}
```

**Java:**
```java
public static boolean isSorted(int[] arr) {
    for (int i = 1; i < arr.length; i++) {
        if (arr[i] < arr[i - 1]) return false;
    }
    return true;
}
```

**Python:**
```python
def is_sorted(arr):
    return all(arr[i] <= arr[i + 1] for i in range(len(arr) - 1))
```

### Analysis

| Version | Time | Space |
|---|---|---|
| Slow (sort and compare) | O(n log n) | O(n) |
| Optimized (single pass) | O(n) | O(1) |

**Bonus:** The optimized version can also short-circuit — it returns `False` the moment it finds one out-of-order pair.

---

## Exercise 9: Adjacency Matrix to Adjacency List

**Problem:** Represent a sparse graph with 10,000 nodes and 20,000 edges.

**Bottleneck:** An adjacency matrix uses O(V^2) space. For a sparse graph, most entries are 0.

### Slow Version — O(V^2) space

**Go:**
```go
// Adjacency matrix: 10000 x 10000 = 100,000,000 entries
// Each int = 8 bytes → 800 MB of memory!
matrix := make([][]int, 10000)
for i := range matrix {
    matrix[i] = make([]int, 10000)
}

// Add edge
matrix[u][v] = 1
matrix[v][u] = 1

// Get neighbors: must scan entire row O(V)
func neighbors(matrix [][]int, u int) []int {
    result := []int{}
    for v := 0; v < len(matrix[u]); v++ {
        if matrix[u][v] != 0 {
            result = append(result, v)
        }
    }
    return result
}
```

**Java:**
```java
int[][] matrix = new int[10000][10000]; // 800 MB
matrix[u][v] = 1;

// Neighbors: O(V) scan
List<Integer> neighbors = new ArrayList<>();
for (int v = 0; v < 10000; v++) {
    if (matrix[u][v] != 0) neighbors.add(v);
}
```

**Python:**
```python
matrix = [[0] * 10000 for _ in range(10000)]  # 800 MB+
matrix[u][v] = 1

# Neighbors: O(V) scan
neighbors = [v for v in range(10000) if matrix[u][v] != 0]
```

### Optimized Version — O(V + E) space

**Go:**
```go
// Adjacency list: only stores actual edges
adj := make(map[int][]int)

func addEdge(adj map[int][]int, u, v int) {
    adj[u] = append(adj[u], v)
    adj[v] = append(adj[v], u)
}

// Get neighbors: O(degree) — typically much less than V
func neighbors(adj map[int][]int, u int) []int {
    return adj[u]
}
```

**Java:**
```java
Map<Integer, List<Integer>> adj = new HashMap<>();

void addEdge(int u, int v) {
    adj.computeIfAbsent(u, k -> new ArrayList<>()).add(v);
    adj.computeIfAbsent(v, k -> new ArrayList<>()).add(u);
}

List<Integer> neighbors = adj.getOrDefault(u, Collections.emptyList());
```

**Python:**
```python
from collections import defaultdict

adj = defaultdict(list)

def add_edge(u, v):
    adj[u].append(v)
    adj[v].append(u)

neighbors = adj[u]  # O(degree)
```

### Analysis

| Version | Space | Neighbor Query | Add Edge |
|---|---|---|---|
| Matrix | O(V^2) = 800 MB | O(V) = O(10,000) | O(1) |
| Adjacency List | O(V + E) = ~240 KB | O(degree) = O(4) avg | O(1) |

For sparse graphs (E << V^2), the adjacency list uses orders of magnitude less memory and faster neighbor traversal.

---

## Exercise 10: Recursive Fibonacci to DP O(n)

**Problem:** Compute the nth Fibonacci number.

**Bottleneck:** Naive recursion recomputes the same subproblems exponentially.

### Slow Version — O(2^n)

**Go:**
```go
func fib(n int) int {
    if n <= 1 {
        return n
    }
    return fib(n-1) + fib(n-2) // Exponential: each call branches into two
}
// fib(50) takes minutes. fib(100) never finishes.
```

**Java:**
```java
public static int fib(int n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}
```

**Python:**
```python
def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)
```

### Optimized Version — O(n) with DP

**Go:**
```go
func fib(n int) int {
    if n <= 1 {
        return n
    }
    a, b := 0, 1
    for i := 2; i <= n; i++ {
        a, b = b, a+b
    }
    return b
}
// fib(50) is instant. fib(1000000) completes in milliseconds (with big int).
```

**Java:**
```java
public static long fib(int n) {
    if (n <= 1) return n;
    long a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        long temp = a + b;
        a = b;
        b = temp;
    }
    return b;
}
```

**Python:**
```python
def fib(n):
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
```

### Analysis

| Version | Time | Space | fib(50) calls |
|---|---|---|---|
| Slow (recursion) | O(2^n) | O(n) stack | ~25 billion |
| Optimized (DP) | O(n) | O(1) | 49 iterations |

---

## Exercise 11: Two Sum Brute Force to Hash Map O(n)

**Problem:** Given an array and a target sum, find two indices whose values add up to the target.

**Bottleneck:** Checking every pair is O(n^2).

### Slow Version — O(n^2)

**Go:**
```go
func twoSum(nums []int, target int) (int, int) {
    for i := 0; i < len(nums); i++ {
        for j := i + 1; j < len(nums); j++ {
            if nums[i]+nums[j] == target {
                return i, j
            }
        }
    }
    return -1, -1
}
```

**Java:**
```java
public static int[] twoSum(int[] nums, int target) {
    for (int i = 0; i < nums.length; i++) {
        for (int j = i + 1; j < nums.length; j++) {
            if (nums[i] + nums[j] == target) {
                return new int[]{i, j};
            }
        }
    }
    return new int[]{-1, -1};
}
```

**Python:**
```python
def two_sum(nums, target):
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                return [i, j]
    return [-1, -1]
```

### Optimized Version — O(n)

**Go:**
```go
func twoSum(nums []int, target int) (int, int) {
    seen := make(map[int]int) // value -> index
    for i, num := range nums {
        complement := target - num
        if j, exists := seen[complement]; exists {
            return j, i
        }
        seen[num] = i
    }
    return -1, -1
}
```

**Java:**
```java
public static int[] twoSum(int[] nums, int target) {
    Map<Integer, Integer> seen = new HashMap<>(); // value -> index
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

**Python:**
```python
def two_sum(nums, target):
    seen = {}  # value -> index
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return [-1, -1]
```

### Analysis

| Version | Time | Space |
|---|---|---|
| Slow (brute force) | O(n^2) | O(1) |
| Optimized (hash map) | O(n) | O(n) |

**Key insight:** For each number, we need to check if `target - number` exists. A hash map answers that in O(1). We build it as we go, so we only need one pass.

---

## Summary of Optimization Patterns

| Pattern | From | To | Key Data Structure |
|---|---|---|---|
| Membership check | O(n) list scan | O(1) lookup | Hash Set |
| Duplicate detection | O(n^2) nested loop | O(n) single pass | Hash Set |
| String building | O(n^2) concat | O(n) join/builder | StringBuilder / List |
| Insert at front | O(n) array shift | O(1) prepend | Linked List / Deque |
| Find min/max | O(n log n) sort | O(n) single pass | Two variables |
| Frequency count | O(n^2) nested scan | O(n) single pass | Hash Map |
| Queue dequeue | O(n) array shift | O(1) popleft | Deque / Circular Buffer |
| Check sorted | O(n log n) sort+compare | O(n) pairwise check | Adjacent comparison |
| Sparse graph | O(V^2) matrix | O(V+E) list | Adjacency List |
| Fibonacci | O(2^n) recursion | O(n) DP | Two variables |
| Pair finding | O(n^2) brute force | O(n) complement lookup | Hash Map |

### The Universal Optimization Principle

> **When you see O(n^2) caused by repeated searching, the fix is almost always a hash table.**

Hash tables convert O(n) lookups into O(1) lookups. Trading O(n) space for an order-of-magnitude time improvement is nearly always the right choice.

---

> **Tip:** Before optimizing, always measure. Use benchmarks (see tasks.md) to confirm the bottleneck and verify the improvement.
