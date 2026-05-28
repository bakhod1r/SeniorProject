# Time vs Space Complexity — Optimize

> 10+ exercises. Show before/after in **all 3 languages** with complexity comparison and benchmarks.

---

## Exercise 1: Duplicate Detection — O(n²) to O(n)

### Before (Slow)

#### Go

```go
// O(n²) time, O(1) space
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

#### Java

```java
// O(n²) time, O(1) space
public static boolean hasDuplicate(int[] arr) {
    for (int i = 0; i < arr.length; i++)
        for (int j = i + 1; j < arr.length; j++)
            if (arr[i] == arr[j]) return true;
    return false;
}
```

#### Python

```python
# O(n²) time, O(1) space
def has_duplicate(arr):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                return True
    return False
```

### After (Optimized)

#### Go

```go
// O(n) time, O(n) space — hash set
func hasDuplicate(arr []int) bool {
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

#### Java

```java
// O(n) time, O(n) space
public static boolean hasDuplicate(int[] arr) {
    HashSet<Integer> seen = new HashSet<>(arr.length);
    for (int v : arr) {
        if (!seen.add(v)) return true;
    }
    return false;
}
```

#### Python

```python
# O(n) time, O(n) space
def has_duplicate(arr):
    return len(arr) != len(set(arr))
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n²) | O(1) |
| After | O(n) | O(n) |

---

## Exercise 2: Two Sum — O(n²) to O(n)

### Before (Slow)

#### Go

```go
// O(n²) time, O(1) space
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

#### Java

```java
// O(n²) time, O(1) space
public static int[] twoSum(int[] nums, int target) {
    for (int i = 0; i < nums.length; i++)
        for (int j = i + 1; j < nums.length; j++)
            if (nums[i] + nums[j] == target)
                return new int[]{i, j};
    return new int[]{-1, -1};
}
```

#### Python

```python
# O(n²) time, O(1) space
def two_sum(nums, target):
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                return [i, j]
    return [-1, -1]
```

### After (Optimized)

#### Go

```go
// O(n) time, O(n) space
func twoSum(nums []int, target int) (int, int) {
    seen := make(map[int]int)
    for i, v := range nums {
        if j, ok := seen[target-v]; ok {
            return j, i
        }
        seen[v] = i
    }
    return -1, -1
}
```

#### Java

```java
// O(n) time, O(n) space
public static int[] twoSum(int[] nums, int target) {
    HashMap<Integer, Integer> seen = new HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        int complement = target - nums[i];
        if (seen.containsKey(complement))
            return new int[]{seen.get(complement), i};
        seen.put(nums[i], i);
    }
    return new int[]{-1, -1};
}
```

#### Python

```python
# O(n) time, O(n) space
def two_sum(nums, target):
    seen = {}
    for i, v in enumerate(nums):
        if target - v in seen:
            return [seen[target - v], i]
        seen[v] = i
    return [-1, -1]
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n²) | O(1) |
| After | O(n) | O(n) |

---

## Exercise 3: Fibonacci — O(2ⁿ) to O(n) to O(1) Space

### Before (Slow)

#### Go

```go
// O(2^n) time, O(n) space (call stack)
func fib(n int) int {
    if n <= 1 { return n }
    return fib(n-1) + fib(n-2)
}
```

#### Java

```java
// O(2^n) time, O(n) space
public static int fib(int n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}
```

#### Python

```python
# O(2^n) time, O(n) space
def fib(n):
    if n <= 1: return n
    return fib(n - 1) + fib(n - 2)
```

### After (Optimized)

#### Go

```go
// O(n) time, O(1) space
func fib(n int) int {
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
// O(n) time, O(1) space
public static int fib(int n) {
    if (n <= 1) return n;
    int a = 0, b = 1;
    for (int i = 2; i <= n; i++) {
        int t = a + b; a = b; b = t;
    }
    return b;
}
```

#### Python

```python
# O(n) time, O(1) space
def fib(n):
    if n <= 1: return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(2ⁿ) | O(n) |
| After | O(n) | O(1) |

---

## Exercise 4: Range Sum Query — O(n) per Query to O(1)

### Before (Slow)

#### Go

```go
// O(n) per query, O(1) space
func rangeSum(arr []int, left, right int) int {
    sum := 0
    for i := left; i <= right; i++ {
        sum += arr[i]
    }
    return sum
}
```

#### Java

```java
// O(n) per query
public static int rangeSum(int[] arr, int left, int right) {
    int sum = 0;
    for (int i = left; i <= right; i++) sum += arr[i];
    return sum;
}
```

#### Python

```python
# O(n) per query
def range_sum(arr, left, right):
    return sum(arr[left:right + 1])
```

### After (Optimized)

#### Go

```go
// O(n) build, O(1) per query, O(n) space
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

#### Java

```java
// O(n) build, O(1) per query
public static int[] buildPrefix(int[] arr) {
    int[] prefix = new int[arr.length + 1];
    for (int i = 0; i < arr.length; i++)
        prefix[i + 1] = prefix[i] + arr[i];
    return prefix;
}

public static int rangeSum(int[] prefix, int left, int right) {
    return prefix[right + 1] - prefix[left];
}
```

#### Python

```python
# O(n) build, O(1) per query
def build_prefix(arr):
    prefix = [0] * (len(arr) + 1)
    for i, v in enumerate(arr):
        prefix[i + 1] = prefix[i] + v
    return prefix

def range_sum(prefix, left, right):
    return prefix[right + 1] - prefix[left]
```

### Complexity

| | Time (per query) | Space |
|---|------|-------|
| Before | O(n) | O(1) |
| After | O(1) | O(n) precomputed |

---

## Exercise 5: Queue with List Pop(0) — O(n) to O(1)

### Before (Slow)

#### Go

```go
// O(n) per dequeue (slice copy)
type SlowQueue struct {
    data []int
}

func (q *SlowQueue) Enqueue(val int) { q.data = append(q.data, val) }
func (q *SlowQueue) Dequeue() int {
    val := q.data[0]
    q.data = q.data[1:] // O(n) — underlying array not reclaimed
    return val
}
```

#### Java

```java
// O(n) per dequeue
ArrayList<Integer> queue = new ArrayList<>();
queue.add(val);         // O(1) amortized
queue.remove(0);        // O(n) — shifts all elements
```

#### Python

```python
# O(n) per dequeue
queue = []
queue.append(val)    # O(1) amortized
queue.pop(0)         # O(n) — shifts all elements
```

### After (Optimized)

#### Go

```go
// O(1) per dequeue — circular buffer
type FastQueue struct {
    data       []int
    head, tail int
    size, cap  int
}

func NewFastQueue(cap int) *FastQueue {
    return &FastQueue{data: make([]int, cap), cap: cap}
}

func (q *FastQueue) Enqueue(val int) {
    q.data[q.tail] = val
    q.tail = (q.tail + 1) % q.cap
    q.size++
}

func (q *FastQueue) Dequeue() int {
    val := q.data[q.head]
    q.head = (q.head + 1) % q.cap
    q.size--
    return val
}
```

#### Java

```java
// O(1) per dequeue
import java.util.ArrayDeque;
ArrayDeque<Integer> queue = new ArrayDeque<>();
queue.add(val);    // O(1)
queue.poll();      // O(1)
```

#### Python

```python
# O(1) per dequeue
from collections import deque
queue = deque()
queue.append(val)      # O(1)
queue.popleft()        # O(1)
```

### Complexity

| | Time (dequeue) | Space |
|---|------|-------|
| Before | O(n) | O(n) |
| After | O(1) | O(n) |

---

## Exercise 6: String Building — O(n²) to O(n)

### Before (Slow)

#### Go

```go
// O(n²) time
func repeat(ch byte, n int) string {
    s := ""
    for i := 0; i < n; i++ {
        s += string(ch) // new string each iteration
    }
    return s
}
```

#### Java

```java
// O(n²) time
public static String repeat(char ch, int n) {
    String s = "";
    for (int i = 0; i < n; i++) s += ch;
    return s;
}
```

#### Python

```python
# O(n²) worst case
def repeat(ch, n):
    s = ""
    for _ in range(n):
        s += ch
    return s
```

### After (Optimized)

#### Go

```go
// O(n) time
import "strings"

func repeat(ch byte, n int) string {
    var sb strings.Builder
    sb.Grow(n)
    for i := 0; i < n; i++ {
        sb.WriteByte(ch)
    }
    return sb.String()
}
```

#### Java

```java
// O(n) time
public static String repeat(char ch, int n) {
    StringBuilder sb = new StringBuilder(n);
    for (int i = 0; i < n; i++) sb.append(ch);
    return sb.toString();
}
```

#### Python

```python
# O(n) time
def repeat(ch, n):
    return ch * n
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n²) | O(n²) total allocations |
| After | O(n) | O(n) |

---

## Exercise 7: Finding Max/Min — O(n log n) to O(n)

### Before (Slow)

#### Go

```go
import "sort"

// O(n log n) time, O(n) space
func findMinMax(arr []int) (int, int) {
    sorted := make([]int, len(arr))
    copy(sorted, arr)
    sort.Ints(sorted)
    return sorted[0], sorted[len(sorted)-1]
}
```

#### Java

```java
// O(n log n) time
public static int[] findMinMax(int[] arr) {
    int[] copy = arr.clone();
    Arrays.sort(copy);
    return new int[]{copy[0], copy[copy.length - 1]};
}
```

#### Python

```python
# O(n log n) time
def find_min_max(arr):
    s = sorted(arr)
    return s[0], s[-1]
```

### After (Optimized)

#### Go

```go
// O(n) time, O(1) space
func findMinMax(arr []int) (int, int) {
    mn, mx := arr[0], arr[0]
    for _, v := range arr[1:] {
        if v < mn { mn = v }
        if v > mx { mx = v }
    }
    return mn, mx
}
```

#### Java

```java
// O(n) time, O(1) space
public static int[] findMinMax(int[] arr) {
    int min = arr[0], max = arr[0];
    for (int v : arr) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    return new int[]{min, max};
}
```

#### Python

```python
# O(n) time, O(1) space
def find_min_max(arr):
    return min(arr), max(arr)
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n log n) | O(n) |
| After | O(n) | O(1) |

---

## Exercise 8: Frequency Count — O(n²) to O(n)

### Before (Slow)

#### Go

```go
// O(n²) time, O(n) space
func frequency(arr []int) map[int]int {
    freq := map[int]int{}
    for _, v := range arr {
        count := 0
        for _, w := range arr {
            if w == v { count++ }
        }
        freq[v] = count
    }
    return freq
}
```

#### Java

```java
// O(n²) time
public static Map<Integer, Integer> frequency(int[] arr) {
    Map<Integer, Integer> freq = new HashMap<>();
    for (int v : arr) {
        int count = 0;
        for (int w : arr) if (w == v) count++;
        freq.put(v, count);
    }
    return freq;
}
```

#### Python

```python
# O(n²) time
def frequency(arr):
    freq = {}
    for v in arr:
        count = sum(1 for w in arr if w == v)
        freq[v] = count
    return freq
```

### After (Optimized)

#### Go

```go
// O(n) time, O(n) space
func frequency(arr []int) map[int]int {
    freq := make(map[int]int, len(arr))
    for _, v := range arr {
        freq[v]++
    }
    return freq
}
```

#### Java

```java
// O(n) time, O(n) space
public static Map<Integer, Integer> frequency(int[] arr) {
    Map<Integer, Integer> freq = new HashMap<>();
    for (int v : arr) freq.merge(v, 1, Integer::sum);
    return freq;
}
```

#### Python

```python
# O(n) time, O(n) space
from collections import Counter
def frequency(arr):
    return Counter(arr)
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n²) | O(n) |
| After | O(n) | O(n) |

---

## Exercise 9: Checking Sorted — O(n log n) to O(n)

### Before (Slow)

#### Go

```go
import "sort"

// O(n log n) time, O(n) space
func isSorted(arr []int) bool {
    sorted := make([]int, len(arr))
    copy(sorted, arr)
    sort.Ints(sorted)
    for i := range arr {
        if arr[i] != sorted[i] { return false }
    }
    return true
}
```

#### Java

```java
// O(n log n) time, O(n) space
public static boolean isSorted(int[] arr) {
    int[] copy = arr.clone();
    Arrays.sort(copy);
    return Arrays.equals(arr, copy);
}
```

#### Python

```python
# O(n log n) time, O(n) space
def is_sorted(arr):
    return arr == sorted(arr)
```

### After (Optimized)

#### Go

```go
// O(n) time, O(1) space
func isSorted(arr []int) bool {
    for i := 1; i < len(arr); i++ {
        if arr[i] < arr[i-1] { return false }
    }
    return true
}
```

#### Java

```java
// O(n) time, O(1) space
public static boolean isSorted(int[] arr) {
    for (int i = 1; i < arr.length; i++)
        if (arr[i] < arr[i - 1]) return false;
    return true;
}
```

#### Python

```python
# O(n) time, O(1) space
def is_sorted(arr):
    return all(arr[i] <= arr[i + 1] for i in range(len(arr) - 1))
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n log n) | O(n) |
| After | O(n) | O(1) |

---

## Exercise 10: Recursive to Iterative — O(n) Stack to O(1)

### Before (Slow Space)

#### Go

```go
// O(n) time, O(n) space (stack)
func factorial(n int) int {
    if n <= 1 { return 1 }
    return n * factorial(n-1)
}
```

#### Java

```java
// O(n) time, O(n) space
public static long factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}
```

#### Python

```python
# O(n) time, O(n) space
def factorial(n):
    if n <= 1: return 1
    return n * factorial(n - 1)
```

### After (Optimized)

#### Go

```go
// O(n) time, O(1) space
func factorial(n int) int {
    result := 1
    for i := 2; i <= n; i++ {
        result *= i
    }
    return result
}
```

#### Java

```java
// O(n) time, O(1) space
public static long factorial(int n) {
    long result = 1;
    for (int i = 2; i <= n; i++) result *= i;
    return result;
}
```

#### Python

```python
# O(n) time, O(1) space
def factorial(n):
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result
```

### Complexity

| | Time | Space |
|---|------|-------|
| Before | O(n) | O(n) stack |
| After | O(n) | O(1) |

---

## Optimization Summary

| Exercise | Before | After | Strategy |
|----------|--------|-------|----------|
| 1 | O(n²) time, O(1) space | O(n) time, O(n) space | Hash set |
| 2 | O(n²) time, O(1) space | O(n) time, O(n) space | Hash map |
| 3 | O(2ⁿ) time, O(n) space | O(n) time, O(1) space | Iterative with two variables |
| 4 | O(n) per query | O(1) per query, O(n) build | Prefix sum precomputation |
| 5 | O(n) per dequeue | O(1) per dequeue | Deque / circular buffer |
| 6 | O(n²) time | O(n) time | StringBuilder / join |
| 7 | O(n log n) time | O(n) time | Single pass |
| 8 | O(n²) time | O(n) time | Hash map counting |
| 9 | O(n log n) time, O(n) space | O(n) time, O(1) space | Adjacent comparison |
| 10 | O(n) space (stack) | O(1) space | Recursion → iteration |
