# Time vs Space Complexity — Find the Bug

> 10+ exercises. Each shows buggy code in **all 3 languages** — find, explain, and fix.

---

## Exercise 1: Claiming O(1) Space When It's O(n)

### Go (Buggy)

```go
func removeDuplicates(arr []int) []int {
    result := []int{} // BUG: this is O(n) space, not O(1)
    seen := map[int]bool{}
    for _, v := range arr {
        if !seen[v] {
            seen[v] = true
            result = append(result, v)
        }
    }
    return result
    // Comment says: "O(n) time, O(1) space" — WRONG!
}
```

### Java (Buggy)

```java
// Comment: O(n) time, O(1) space — WRONG!
public static List<Integer> removeDuplicates(int[] arr) {
    List<Integer> result = new ArrayList<>(); // BUG: O(n) space
    Set<Integer> seen = new HashSet<>();      // BUG: O(n) space
    for (int v : arr) {
        if (seen.add(v)) result.add(v);
    }
    return result;
}
```

### Python (Buggy)

```python
def remove_duplicates(arr):
    """O(n) time, O(1) space"""  # BUG: wrong claim
    seen = set()       # O(n) space
    result = []        # O(n) space
    for v in arr:
        if v not in seen:
            seen.add(v)
            result.append(v)
    return result
```

**Bug:** The function uses a hash set AND a result list — both O(n) space. The comment claims O(1) space, which is wrong.

### Fix

#### Go

```go
// O(n) time, O(n) space — corrected comment
func removeDuplicates(arr []int) []int {
    result := []int{}
    seen := map[int]bool{}
    for _, v := range arr {
        if !seen[v] {
            seen[v] = true
            result = append(result, v)
        }
    }
    return result
}

// True O(1) auxiliary space version (modifies input, requires sorted)
func removeDuplicatesInPlace(arr []int) int {
    if len(arr) == 0 {
        return 0
    }
    writeIdx := 1
    for i := 1; i < len(arr); i++ {
        if arr[i] != arr[i-1] {
            arr[writeIdx] = arr[i]
            writeIdx++
        }
    }
    return writeIdx
}
```

#### Java

```java
// O(n) time, O(n) space — corrected
public static List<Integer> removeDuplicates(int[] arr) {
    Set<Integer> seen = new HashSet<>();
    List<Integer> result = new ArrayList<>();
    for (int v : arr) {
        if (seen.add(v)) result.add(v);
    }
    return result; // Space: O(n) for seen + result
}
```

#### Python

```python
def remove_duplicates(arr):
    """O(n) time, O(n) space"""  # corrected
    seen = set()
    result = []
    for v in arr:
        if v not in seen:
            seen.add(v)
            result.append(v)
    return result
```

---

## Exercise 2: Ignoring Recursion Stack Space

### Go (Buggy)

```go
// Comment: O(n) time, O(1) space — WRONG!
func sum(arr []int, i int) int {
    if i == len(arr) {
        return 0
    }
    return arr[i] + sum(arr, i+1) // BUG: O(n) stack frames
}
```

### Java (Buggy)

```java
// O(n) time, O(1) space — WRONG!
public static int sum(int[] arr, int i) {
    if (i == arr.length) return 0;
    return arr[i] + sum(arr, i + 1); // BUG: O(n) call stack
}
```

### Python (Buggy)

```python
# O(n) time, O(1) space — WRONG!
def sum_arr(arr, i=0):
    if i == len(arr):
        return 0
    return arr[i] + sum_arr(arr, i + 1)  # BUG: O(n) stack frames
```

**Bug:** Each recursive call adds a frame to the call stack. For an array of size n, there are n recursive calls → O(n) space on the stack.

### Fix

#### Go

```go
// O(n) time, O(1) space — iterative version
func sum(arr []int) int {
    total := 0
    for _, v := range arr {
        total += v
    }
    return total
}
```

#### Java

```java
// O(n) time, O(1) space — iterative
public static int sum(int[] arr) {
    int total = 0;
    for (int v : arr) total += v;
    return total;
}
```

#### Python

```python
# O(n) time, O(1) space — iterative
def sum_arr(arr):
    total = 0
    for v in arr:
        total += v
    return total
```

---

## Exercise 3: O(n²) String Concatenation

### Go (Buggy)

```go
func buildString(n int) string {
    s := ""
    for i := 0; i < n; i++ {
        s += "a" // BUG: creates new string each time → O(n²) time AND space
    }
    return s
}
```

### Java (Buggy)

```java
public static String buildString(int n) {
    String s = "";
    for (int i = 0; i < n; i++) {
        s += "a"; // BUG: O(n²) time and space (String is immutable)
    }
    return s;
}
```

### Python (Buggy)

```python
def build_string(n):
    s = ""
    for _ in range(n):
        s += "a"  # BUG: O(n²) in worst case (though CPython may optimize)
    return s
```

**Bug:** Strings are immutable in all 3 languages. Each `+=` creates a new string of length 1, 2, 3, ..., n. Total characters copied: 1+2+...+n = n(n+1)/2 = O(n²).

### Fix

#### Go

```go
import "strings"

func buildString(n int) string {
    var sb strings.Builder
    sb.Grow(n)
    for i := 0; i < n; i++ {
        sb.WriteByte('a')
    }
    return sb.String() // O(n) time and space
}
```

#### Java

```java
public static String buildString(int n) {
    StringBuilder sb = new StringBuilder(n);
    for (int i = 0; i < n; i++) {
        sb.append('a');
    }
    return sb.toString(); // O(n) time and space
}
```

#### Python

```python
def build_string(n):
    return "".join("a" for _ in range(n))  # O(n) time and space
```

---

## Exercise 4: Wrong Complexity for Nested But Independent Loops

### Go (Buggy)

```go
// Comment: O(n²) — WRONG!
func process(n int) {
    for i := 0; i < n; i++ { // O(n)
        fmt.Println(i)
    }
    for j := 0; j < n; j++ { // O(n)
        fmt.Println(j)
    }
    // Total: O(n) + O(n) = O(2n) = O(n), NOT O(n²)
}
```

### Java (Buggy)

```java
// O(n²) — WRONG!
public static void process(int n) {
    for (int i = 0; i < n; i++) System.out.println(i); // O(n)
    for (int j = 0; j < n; j++) System.out.println(j); // O(n)
    // Total: O(n), NOT O(n²)
}
```

### Python (Buggy)

```python
# O(n²) — WRONG!
def process(n):
    for i in range(n):  # O(n)
        print(i)
    for j in range(n):  # O(n)
        print(j)
    # Total: O(n), NOT O(n²)
```

**Bug:** Sequential (non-nested) loops are additive: O(n) + O(n) = O(2n) = O(n). Only NESTED loops give O(n²). The comment incorrectly claims O(n²).

### Fix

#### Go

```go
// O(n) time — two sequential loops
func process(n int) {
    for i := 0; i < n; i++ {
        fmt.Println(i)
    }
    for j := 0; j < n; j++ {
        fmt.Println(j)
    }
}
```

#### Java

```java
// O(n) time — sequential, not nested
public static void process(int n) {
    for (int i = 0; i < n; i++) System.out.println(i);
    for (int j = 0; j < n; j++) System.out.println(j);
}
```

#### Python

```python
# O(n) time — sequential, not nested
def process(n):
    for i in range(n):
        print(i)
    for j in range(n):
        print(j)
```

---

## Exercise 5: Forgetting HashMap's Worst Case

### Go (Buggy)

```go
// "Guaranteed O(1) lookup" — WRONG in worst case
func findElement(data map[int]bool, target int) bool {
    return data[target] // Usually O(1), but O(n) worst case with hash collisions
}
```

### Java (Buggy)

```java
// "Guaranteed O(1)" — WRONG
public static boolean findElement(HashMap<Integer, Boolean> data, int target) {
    return data.containsKey(target); // O(1) average, O(n) worst case (pre-Java 8)
}
```

### Python (Buggy)

```python
# "Guaranteed O(1)" — WRONG
def find_element(data, target):
    return target in data  # O(1) average, O(n) worst case
```

**Bug:** Hash map operations are O(1) **average/amortized**, not guaranteed. With adversarial or poorly distributed keys, hash collisions degrade to O(n).

### Fix

#### Go

```go
// O(1) average, O(n) worst case — corrected comment
func findElement(data map[int]bool, target int) bool {
    return data[target]
}
```

#### Java

```java
// O(1) average, O(log n) worst case (Java 8+ with tree bins)
public static boolean findElement(HashMap<Integer, Boolean> data, int target) {
    return data.containsKey(target);
}
```

#### Python

```python
# O(1) average, O(n) worst case with pathological hash collisions
def find_element(data, target):
    return target in data
```

---

## Exercise 6: Memory Leak from Unbounded Cache

### Go (Buggy)

```go
var cache = map[string][]byte{} // BUG: grows forever!

func getData(key string) []byte {
    if val, ok := cache[key]; ok {
        return val
    }
    val := fetchFromDB(key) // expensive
    cache[key] = val        // BUG: never evicts → memory grows without bound
    return val
}
```

### Java (Buggy)

```java
static HashMap<String, byte[]> cache = new HashMap<>(); // BUG: unbounded

public static byte[] getData(String key) {
    if (cache.containsKey(key)) return cache.get(key);
    byte[] val = fetchFromDB(key);
    cache.put(key, val); // BUG: never evicts
    return val;
}
```

### Python (Buggy)

```python
cache = {}  # BUG: unbounded

def get_data(key):
    if key in cache:
        return cache[key]
    val = fetch_from_db(key)
    cache[key] = val  # BUG: never evicts
    return val
```

**Bug:** Cache grows without bound → eventual OutOfMemoryError. No eviction policy, no size limit, no TTL.

### Fix

#### Go

```go
import (
    "container/list"
    "sync"
)

type BoundedCache struct {
    mu       sync.Mutex
    capacity int
    cache    map[string]*list.Element
    order    *list.List
}

func (c *BoundedCache) Get(key string) ([]byte, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if elem, ok := c.cache[key]; ok {
        c.order.MoveToFront(elem)
        return elem.Value.([]byte), true
    }
    return nil, false
}
```

#### Java

```java
import java.util.LinkedHashMap;
import java.util.Map;

// LRU cache with bounded size
static LinkedHashMap<String, byte[]> cache = new LinkedHashMap<>(100, 0.75f, true) {
    @Override
    protected boolean removeEldestEntry(Map.Entry<String, byte[]> eldest) {
        return size() > 1000; // evict when over 1000 entries
    }
};
```

#### Python

```python
from functools import lru_cache

@lru_cache(maxsize=1000)  # bounded — evicts LRU when full
def get_data(key):
    return fetch_from_db(key)
```

---

## Exercise 7: Accidentally Quadratic Slice/Sublist Operations

### Go (Buggy)

```go
func processQueue(items []int) {
    for len(items) > 0 {
        item := items[0]
        items = items[1:] // BUG: doesn't free memory — underlying array persists
        process(item)
        // Memory: O(n) even though slice shrinks
        // Time per dequeue: O(1), but total GC pressure: O(n)
    }
}
```

### Java (Buggy)

```java
public static void processQueue(ArrayList<Integer> items) {
    while (!items.isEmpty()) {
        int item = items.remove(0); // BUG: O(n) per remove — shifts all elements
        process(item);
    }
    // Total: O(n²) time!
}
```

### Python (Buggy)

```python
def process_queue(items):
    while items:
        item = items.pop(0)  # BUG: O(n) per pop — shifts all elements
        process(item)
    # Total: O(n²) time!
```

**Bug:** Removing from the front of an ArrayList/list is O(n) because all remaining elements must shift. Total for n removals: O(n²).

### Fix

#### Go

```go
func processQueue(items []int) {
    for _, item := range items { // iterate without modifying
        process(item)
    }
}
// Or use a proper queue with index:
func processQueueIdx(items []int) {
    for i := 0; i < len(items); i++ {
        process(items[i])
    }
}
```

#### Java

```java
import java.util.LinkedList;
import java.util.Queue;

public static void processQueue(Queue<Integer> items) {
    while (!items.isEmpty()) {
        int item = items.poll(); // O(1) for LinkedList
        process(item);
    }
}
```

#### Python

```python
from collections import deque

def process_queue(items):
    q = deque(items)
    while q:
        item = q.popleft()  # O(1) for deque
        process(item)
```

---

## Exercise 8: Incorrect Binary Search Space Analysis

### Go (Buggy)

```go
// "O(log n) time, O(log n) space" — WRONG for iterative
func binarySearch(arr []int, target int) int {
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
    // This is iterative → O(1) space, NOT O(log n)
}
```

### Java (Buggy)

```java
// "O(log n) space" — WRONG for iterative version
public static int binarySearch(int[] arr, int target) {
    int left = 0, right = arr.length - 1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (arr[mid] == target) return mid;
        else if (arr[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1; // Iterative: O(1) space, NOT O(log n)
}
```

### Python (Buggy)

```python
# "O(log n) space" — WRONG for iterative
def binary_search(arr, target):
    left, right = 0, len(arr) - 1
    while left <= right:
        mid = left + (right - left) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1  # Iterative → O(1) space
```

**Bug:** Iterative binary search uses O(1) space (just left, right, mid variables). O(log n) space applies only to the **recursive** version (call stack depth). The comment confuses the two.

### Fix

Correct the comments:

```text
Iterative binary search: O(log n) time, O(1) space
Recursive binary search: O(log n) time, O(log n) space (call stack)
```

---

## Exercise 9: Exponential Time from Redundant Computation

### Go (Buggy)

```go
// "O(n) time" — WRONG!
func fibonacci(n int) int {
    if n <= 1 {
        return n
    }
    return fibonacci(n-1) + fibonacci(n-2) // BUG: O(2^n) time!
}
```

### Java (Buggy)

```java
// "O(n) time" — WRONG!
public static int fibonacci(int n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2); // BUG: O(2^n)
}
```

### Python (Buggy)

```python
# "O(n) time" — WRONG!
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)  # BUG: O(2^n) time
```

**Bug:** Without memoization, each call branches into two, creating a binary tree of calls. Total calls ≈ 2ⁿ. The comment claims O(n) which is wrong.

### Fix

#### Go

```go
// O(n) time, O(1) space — iterative
func fibonacci(n int) int {
    if n <= 1 {
        return n
    }
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
public static int fibonacci(int n) {
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
# O(n) time, O(1) space
def fibonacci(n):
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
```

---

## Exercise 10: Sorting to Check Membership — Overkill

### Go (Buggy)

```go
import "sort"

// "O(n log n) is the best we can do" — WRONG!
func contains(arr []int, target int) bool {
    sort.Ints(arr) // O(n log n) time, O(log n) space
    idx := sort.SearchInts(arr, target)
    return idx < len(arr) && arr[idx] == target
}
```

### Java (Buggy)

```java
import java.util.Arrays;

// "O(n log n) is optimal" — WRONG for single query
public static boolean contains(int[] arr, int target) {
    Arrays.sort(arr);
    return Arrays.binarySearch(arr, target) >= 0;
}
```

### Python (Buggy)

```python
# "O(n log n) is the best we can do" — WRONG
def contains(arr, target):
    arr.sort()  # O(n log n)
    # binary search...
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target: return True
        elif arr[mid] < target: lo = mid + 1
        else: hi = mid - 1
    return False
```

**Bug:** For a single membership query, linear scan O(n) beats sort+binary search O(n log n). Sorting is only worthwhile for **multiple** queries on the same data.

### Fix

#### Go

```go
// O(n) time, O(1) space — simple linear scan
func contains(arr []int, target int) bool {
    for _, v := range arr {
        if v == target {
            return true
        }
    }
    return false
}

// Or O(1) amortized with hash set if queried multiple times
```

#### Java

```java
// O(n) time for single query
public static boolean contains(int[] arr, int target) {
    for (int v : arr) {
        if (v == target) return true;
    }
    return false;
}
```

#### Python

```python
# O(n) time for single query
def contains(arr, target):
    return target in arr  # Python's `in` is O(n) for lists
```

---

## Exercise 11: Integer Overflow in Complexity Calculation

### Go (Buggy)

```go
func midpoint(left, right int) int {
    return (left + right) / 2 // BUG: overflow if left + right > MaxInt
}
```

### Java (Buggy)

```java
public static int midpoint(int left, int right) {
    return (left + right) / 2; // BUG: overflow for large left + right
}
```

### Python (Buggy)

```python
def midpoint(left, right):
    return (left + right) // 2  # No bug in Python (arbitrary precision)
    # But WATCH OUT: if porting to Go/Java, this overflows!
```

**Bug:** In Go and Java, if `left + right` exceeds `int` max value (~2.1 billion), it overflows and produces a negative number.

### Fix

#### Go

```go
func midpoint(left, right int) int {
    return left + (right-left)/2 // safe: no overflow
}
```

#### Java

```java
public static int midpoint(int left, int right) {
    return left + (right - left) / 2; // safe
    // Or: (left + right) >>> 1  // unsigned right shift
}
```

#### Python

```python
# Python has arbitrary precision — no overflow
# But use safe formula for portability:
def midpoint(left, right):
    return left + (right - left) // 2
```

---

## Exercise 12: Wrong Space Complexity for Slice/Subarray

### Go (Buggy)

```go
func firstHalf(arr []int) []int {
    return arr[:len(arr)/2] // BUG claim: "O(n/2) new space"
    // Reality: Go slices share underlying array — O(1) extra space
    // BUT: prevents GC of full array — effective O(n) memory retention
}
```

### Java (Buggy)

```java
public static List<Integer> firstHalf(List<Integer> arr) {
    return arr.subList(0, arr.size() / 2); // BUG claim: "O(n/2) new space"
    // Reality: subList is a VIEW — O(1) space, but holds reference to original
}
```

### Python (Buggy)

```python
def first_half(arr):
    return arr[:len(arr)//2]  # BUG claim: "O(1) space — just a view"
    # Reality: Python slices CREATE A COPY — O(n/2) = O(n) space
```

**Bug:** Each language handles slices differently. Go slices share memory (O(1) but retains original). Java subList is a view (O(1)). Python slices copy (O(n)). Misunderstanding these leads to wrong space analysis.

### Fix

Document the correct behavior per language:

```text
Go:     arr[:n/2] → O(1) extra space (shared), but O(n) memory retention
Java:   subList()  → O(1) extra space (view), original list must stay alive
Python: arr[:n/2] → O(n) extra space (new list created)
```
