# Why are Data Structures Important? — Find the Bug

## Table of Contents

1. [How to Use This File](#how-to-use-this-file)
2. [Bug 1: Using Array for Frequent Lookups](#bug-1-using-array-for-frequent-lookups)
3. [Bug 2: Using Linked List for Random Access](#bug-2-using-linked-list-for-random-access)
4. [Bug 3: Using Unsorted Array for Frequent Min Queries](#bug-3-using-unsorted-array-for-frequent-min-queries)
5. [Bug 4: Using Array Instead of Set for Deduplication](#bug-4-using-array-instead-of-set-for-deduplication)
6. [Bug 5: Using List as Queue (Removing from Front)](#bug-5-using-list-as-queue-removing-from-front)
7. [Bug 6: Nested Loop Instead of Hash Map for Two Sum](#bug-6-nested-loop-instead-of-hash-map-for-two-sum)
8. [Bug 7: Sorting Every Time to Find Maximum](#bug-7-sorting-every-time-to-find-maximum)
9. [Bug 8: Using Array of Pairs Instead of Hash Map for Config](#bug-8-using-array-of-pairs-instead-of-hash-map-for-config)
10. [Bug 9: Using String Concatenation in Loop](#bug-9-using-string-concatenation-in-loop)
11. [Bug 10: Linear Search in Sorted Data](#bug-10-linear-search-in-sorted-data)
12. [Bug 11: Using Map When Array Index Suffices](#bug-11-using-map-when-array-index-suffices)
13. [Bug 12: Rebuilding Frequency Map on Every Query](#bug-12-rebuilding-frequency-map-on-every-query)

---

## How to Use This File

Each exercise contains **code with a performance bug** — the code produces correct results but is unnecessarily slow due to a wrong data structure choice. Your job:

1. **Read the code** and understand what it does.
2. **Identify the wrong DS choice** that causes poor performance.
3. **Explain** the performance impact (what is the actual complexity vs what it should be).
4. **Fix it** by switching to the correct data structure.

Try to identify the bug yourself before reading the fix.

---

## Bug 1: Using Array for Frequent Lookups

**Description:** A server checks if incoming request IPs are in a blocklist. The blocklist has 100,000 IPs and the server processes 10,000 requests per second.

### Go (Buggy):

```go
func isBlocked(blocklist []string, ip string) bool {
    for _, blocked := range blocklist {
        if blocked == ip {
            return true
        }
    }
    return false
}

func handleRequest(blocklist []string, requestIP string) {
    if isBlocked(blocklist, requestIP) { // O(n) per request!
        fmt.Println("Blocked:", requestIP)
        return
    }
    fmt.Println("Allowed:", requestIP)
}
```

### Java (Buggy):

```java
public static boolean isBlocked(List<String> blocklist, String ip) {
    for (String blocked : blocklist) {
        if (blocked.equals(ip)) {
            return true;
        }
    }
    return false;
}

public static void handleRequest(List<String> blocklist, String requestIP) {
    if (isBlocked(blocklist, requestIP)) { // O(n) per request!
        System.out.println("Blocked: " + requestIP);
        return;
    }
    System.out.println("Allowed: " + requestIP);
}
```

### Python (Buggy):

```python
def is_blocked(blocklist, ip):
    for blocked in blocklist:
        if blocked == ip:
            return True
    return False

def handle_request(blocklist, request_ip):
    if is_blocked(blocklist, request_ip):  # O(n) per request!
        print(f"Blocked: {request_ip}")
        return
    print(f"Allowed: {request_ip}")
```

### Bug

Using an **array/list for membership checking**. Each lookup scans all 100,000 entries = O(n). With 10,000 requests/sec, that is 10^9 comparisons/sec.

### Fix

Use a **hash set** for O(1) lookups.

**Go:**
```go
func handleRequest(blocklist map[string]struct{}, requestIP string) {
    if _, blocked := blocklist[requestIP]; blocked { // O(1)
        fmt.Println("Blocked:", requestIP)
        return
    }
    fmt.Println("Allowed:", requestIP)
}
```

**Java:**
```java
public static void handleRequest(Set<String> blocklist, String requestIP) {
    if (blocklist.contains(requestIP)) { // O(1)
        System.out.println("Blocked: " + requestIP);
        return;
    }
    System.out.println("Allowed: " + requestIP);
}
```

**Python:**
```python
def handle_request(blocklist_set, request_ip):
    if request_ip in blocklist_set:  # O(1)
        print(f"Blocked: {request_ip}")
        return
    print(f"Allowed: {request_ip}")
```

---

## Bug 2: Using Linked List for Random Access

**Description:** A function accesses elements by index frequently in a linked list.

### Go (Buggy):

```go
func getElement(ll *list.List, index int) interface{} {
    current := ll.Front()
    for i := 0; i < index; i++ {
        current = current.Next() // O(n) traversal per access!
    }
    return current.Value
}

func processData(ll *list.List) {
    for i := 0; i < ll.Len(); i++ {
        val := getElement(ll, i) // O(n) per call = O(n^2) total!
        fmt.Println(val)
    }
}
```

### Java (Buggy):

```java
// LinkedList.get(i) is O(n) — it traverses from head each time!
public static void processData(LinkedList<Integer> list) {
    for (int i = 0; i < list.size(); i++) {
        int val = list.get(i); // O(n) per call = O(n^2) total!
        System.out.println(val);
    }
}
```

### Python (Buggy):

```python
class Node:
    def __init__(self, val, next_node=None):
        self.val = val
        self.next = next_node

def get_element(head, index):
    current = head
    for _ in range(index):
        current = current.next  # O(n) per access!
    return current.val

def process_data(head, length):
    for i in range(length):
        val = get_element(head, i)  # O(n) per call = O(n^2) total!
        print(val)
```

### Bug

Using a **linked list for indexed access**. Each `get(i)` traverses i nodes. Accessing all n elements via index is O(n^2).

### Fix

Use an **array** for O(1) indexed access, or iterate with a pointer/iterator instead of indexing.

**Go:**
```go
func processData(items []interface{}) {
    for _, val := range items { // O(n) total
        fmt.Println(val)
    }
}
```

**Java:**
```java
// Option 1: Use ArrayList
public static void processData(ArrayList<Integer> list) {
    for (int i = 0; i < list.size(); i++) {
        System.out.println(list.get(i)); // O(1) per call
    }
}

// Option 2: Use iterator on LinkedList
public static void processData(LinkedList<Integer> list) {
    for (int val : list) { // Iterator: O(1) per step, O(n) total
        System.out.println(val);
    }
}
```

**Python:**
```python
# Use a list (array) instead
def process_data(items):
    for val in items:  # O(n) total
        print(val)
```

---

## Bug 3: Using Unsorted Array for Frequent Min Queries

**Description:** A system tracks sensor values and frequently needs the minimum value. It scans the entire array each time.

### Go (Buggy):

```go
type SensorTracker struct {
    values []float64
}

func (st *SensorTracker) Add(val float64) {
    st.values = append(st.values, val)
}

func (st *SensorTracker) GetMin() float64 {
    min := st.values[0]
    for _, v := range st.values[1:] { // O(n) every time!
        if v < min {
            min = v
        }
    }
    return min
}
```

### Java (Buggy):

```java
public class SensorTracker {
    private List<Double> values = new ArrayList<>();

    public void add(double val) {
        values.add(val);
    }

    public double getMin() {
        double min = values.get(0);
        for (double v : values) { // O(n) every time!
            if (v < min) min = v;
        }
        return min;
    }
}
```

### Python (Buggy):

```python
class SensorTracker:
    def __init__(self):
        self.values = []

    def add(self, val):
        self.values.append(val)

    def get_min(self):
        return min(self.values)  # O(n) every time!
```

### Bug

Scanning the entire array for minimum on every query. If getMin() is called frequently, each call is O(n).

### Fix

Use a **min-heap** for O(1) peek and O(log n) insert.

**Go:**
```go
import "container/heap"

type MinHeap []float64
func (h MinHeap) Len() int            { return len(h) }
func (h MinHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h MinHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *MinHeap) Push(x interface{}) { *h = append(*h, x.(float64)) }
func (h *MinHeap) Pop() interface{} {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[:n-1]
    return x
}

type SensorTracker struct {
    h *MinHeap
}

func (st *SensorTracker) Add(val float64) {
    heap.Push(st.h, val) // O(log n)
}

func (st *SensorTracker) GetMin() float64 {
    return (*st.h)[0] // O(1)
}
```

**Java:**
```java
public class SensorTracker {
    private PriorityQueue<Double> heap = new PriorityQueue<>();

    public void add(double val) { heap.offer(val); } // O(log n)
    public double getMin() { return heap.peek(); }     // O(1)
}
```

**Python:**
```python
import heapq

class SensorTracker:
    def __init__(self):
        self.heap = []

    def add(self, val):
        heapq.heappush(self.heap, val)  # O(log n)

    def get_min(self):
        return self.heap[0]  # O(1)
```

---

## Bug 4: Using Array Instead of Set for Deduplication

**Description:** A function removes duplicates from a list by checking if each element was already seen using another list.

### Go (Buggy):

```go
func removeDuplicates(arr []int) []int {
    var seen []int
    var result []int
    for _, val := range arr {
        found := false
        for _, s := range seen { // O(n) search per element!
            if s == val {
                found = true
                break
            }
        }
        if !found {
            seen = append(seen, val)
            result = append(result, val)
        }
    }
    return result // Total: O(n^2)
}
```

### Java (Buggy):

```java
public static List<Integer> removeDuplicates(int[] arr) {
    List<Integer> seen = new ArrayList<>();
    List<Integer> result = new ArrayList<>();
    for (int val : arr) {
        if (!seen.contains(val)) { // O(n) per check!
            seen.add(val);
            result.add(val);
        }
    }
    return result; // Total: O(n^2)
}
```

### Python (Buggy):

```python
def remove_duplicates(arr):
    seen = []
    result = []
    for val in arr:
        if val not in seen:  # O(n) per check on a list!
            seen.append(val)
            result.append(val)
    return result  # Total: O(n^2)
```

### Bug

Using a **list** for the "seen" check. `val in list` is O(n). Total deduplication is O(n^2).

### Fix

Use a **hash set** for O(1) membership check.

**Go:**
```go
func removeDuplicates(arr []int) []int {
    seen := make(map[int]struct{})
    var result []int
    for _, val := range arr {
        if _, exists := seen[val]; !exists { // O(1)
            seen[val] = struct{}{}
            result = append(result, val)
        }
    }
    return result // Total: O(n)
}
```

**Java:**
```java
public static List<Integer> removeDuplicates(int[] arr) {
    Set<Integer> seen = new HashSet<>();
    List<Integer> result = new ArrayList<>();
    for (int val : arr) {
        if (seen.add(val)) { // O(1) — add returns false if already present
            result.add(val);
        }
    }
    return result; // Total: O(n)
}
```

**Python:**
```python
def remove_duplicates(arr):
    seen = set()
    result = []
    for val in arr:
        if val not in seen:  # O(1) on a set!
            seen.add(val)
            result.append(val)
    return result  # Total: O(n)
```

---

## Bug 5: Using List as Queue (Removing from Front)

**Description:** A BFS implementation uses a Python list as a queue, removing from the front with `pop(0)`.

### Go (Buggy):

```go
func bfs(graph map[int][]int, start int) []int {
    var queue []int
    queue = append(queue, start)
    visited := map[int]bool{start: true}
    var result []int

    for len(queue) > 0 {
        node := queue[0]
        queue = queue[1:] // O(n) — shifts all elements!
        result = append(result, node)
        for _, neighbor := range graph[node] {
            if !visited[neighbor] {
                visited[neighbor] = true
                queue = append(queue, neighbor)
            }
        }
    }
    return result
}
```

### Java (Buggy):

```java
public static List<Integer> bfs(Map<Integer, List<Integer>> graph, int start) {
    List<Integer> queue = new ArrayList<>(); // Wrong DS!
    queue.add(start);
    Set<Integer> visited = new HashSet<>();
    visited.add(start);
    List<Integer> result = new ArrayList<>();

    while (!queue.isEmpty()) {
        int node = queue.remove(0); // O(n) — shifts all elements!
        result.add(node);
        for (int neighbor : graph.getOrDefault(node, List.of())) {
            if (visited.add(neighbor)) {
                queue.add(neighbor);
            }
        }
    }
    return result;
}
```

### Python (Buggy):

```python
def bfs(graph, start):
    queue = [start]  # Using list as queue!
    visited = {start}
    result = []

    while queue:
        node = queue.pop(0)  # O(n) — shifts all elements!
        result.append(node)
        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return result
```

### Bug

Using an **array/list as a queue**. Removing from the front (`pop(0)`, `remove(0)`, `queue[1:]`) is O(n) because all remaining elements must shift left. BFS visits each node once but each dequeue is O(n), making total BFS O(n^2).

### Fix

Use a **deque** (double-ended queue) for O(1) dequeue from front.

**Go:**
```go
import "container/list"

func bfs(graph map[int][]int, start int) []int {
    queue := list.New()
    queue.PushBack(start)
    // ... queue.Front() and queue.Remove(front) are O(1)
}
```

**Java:**
```java
Queue<Integer> queue = new LinkedList<>(); // O(1) poll()
```

**Python:**
```python
from collections import deque
queue = deque([start])
node = queue.popleft()  # O(1)
```

---

## Bug 6: Nested Loop Instead of Hash Map for Two Sum

**Description:** Finding two numbers that sum to a target using brute force.

### Go (Buggy):

```go
func twoSum(nums []int, target int) (int, int) {
    for i := 0; i < len(nums); i++ {
        for j := i + 1; j < len(nums); j++ { // O(n^2)!
            if nums[i]+nums[j] == target {
                return i, j
            }
        }
    }
    return -1, -1
}
```

### Java (Buggy):

```java
public static int[] twoSum(int[] nums, int target) {
    for (int i = 0; i < nums.length; i++) {
        for (int j = i + 1; j < nums.length; j++) { // O(n^2)!
            if (nums[i] + nums[j] == target) {
                return new int[]{i, j};
            }
        }
    }
    return new int[]{-1, -1};
}
```

### Python (Buggy):

```python
def two_sum(nums, target):
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):  # O(n^2)!
            if nums[i] + nums[j] == target:
                return (i, j)
    return (-1, -1)
```

### Bug

Nested loop checks every pair — O(n^2). For n=100,000, that is 5 billion comparisons.

### Fix

Use a **hash map** to store seen values. For each number, check if `target - number` exists in the map. O(n) total.

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

**Python:**
```python
def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return (seen[complement], i)
        seen[num] = i
    return (-1, -1)
```

---

## Bug 7: Sorting Every Time to Find Maximum

**Description:** A dashboard tracks scores and displays the top score. It sorts the entire list every time the top score is needed.

### Go (Buggy):

```go
func getTopScore(scores []int) int {
    sort.Ints(scores) // O(n log n) every time!
    return scores[len(scores)-1]
}
```

### Java (Buggy):

```java
public static int getTopScore(List<Integer> scores) {
    Collections.sort(scores); // O(n log n) every time!
    return scores.get(scores.size() - 1);
}
```

### Python (Buggy):

```python
def get_top_score(scores):
    scores.sort()  # O(n log n) every time!
    return scores[-1]
```

### Bug

Sorting O(n log n) on every query when only the maximum is needed. Also mutates the original list.

### Fix

Use `max()` for O(n), or maintain a **max-heap** for O(1) peek and O(log n) insert.

**Go:**
```go
// Simple: O(n) scan
func getTopScore(scores []int) int {
    max := scores[0]
    for _, s := range scores[1:] {
        if s > max {
            max = s
        }
    }
    return max
}
```

**Java:**
```java
// O(n) stream
public static int getTopScore(List<Integer> scores) {
    return Collections.max(scores);
}
```

**Python:**
```python
def get_top_score(scores):
    return max(scores)  # O(n), does not mutate
```

---

## Bug 8: Using Array of Pairs Instead of Hash Map for Config

**Description:** Configuration values stored as an array of key-value pairs. Looking up a config value requires scanning all pairs.

### Go (Buggy):

```go
type ConfigEntry struct {
    Key   string
    Value string
}

func getConfig(configs []ConfigEntry, key string) string {
    for _, entry := range configs { // O(n) per lookup!
        if entry.Key == key {
            return entry.Value
        }
    }
    return ""
}
```

### Java (Buggy):

```java
// Using List<String[]> where each String[] is {key, value}
public static String getConfig(List<String[]> configs, String key) {
    for (String[] entry : configs) { // O(n) per lookup!
        if (entry[0].equals(key)) return entry[1];
    }
    return "";
}
```

### Python (Buggy):

```python
configs = [("db_host", "localhost"), ("db_port", "5432"), ("timeout", "30")]

def get_config(configs, key):
    for k, v in configs:  # O(n) per lookup!
        if k == key:
            return v
    return ""
```

### Bug

O(n) lookup per config access. Config is accessed frequently throughout the application.

### Fix

Use a **hash map/dictionary** for O(1) lookup.

**Go:** `configs := map[string]string{"db_host": "localhost", ...}`

**Java:** `Map<String, String> configs = Map.of("db_host", "localhost", ...);`

**Python:** `configs = {"db_host": "localhost", "db_port": "5432", "timeout": "30"}`

---

## Bug 9: Using String Concatenation in Loop

**Description:** Building a large string by concatenating in a loop. This creates a new string (and copies all previous content) on every iteration.

### Go (Buggy):

```go
func buildReport(lines []string) string {
    result := ""
    for _, line := range lines {
        result += line + "\n" // O(n) copy per iteration!
    }
    return result // Total: O(n^2)
}
```

### Java (Buggy):

```java
public static String buildReport(List<String> lines) {
    String result = "";
    for (String line : lines) {
        result += line + "\n"; // O(n) copy per iteration!
    }
    return result; // Total: O(n^2)
}
```

### Python (Buggy):

```python
def build_report(lines):
    result = ""
    for line in lines:
        result += line + "\n"  # O(n) copy per iteration!
    return result  # Total: O(n^2)
```

### Bug

Strings are immutable. Each `+=` allocates a new string and copies all previous content. For n lines of average length k, total work is O(n^2 * k).

### Fix

Use a **StringBuilder** (Java), **strings.Builder** (Go), or **list + join** (Python).

**Go:**
```go
func buildReport(lines []string) string {
    var b strings.Builder
    for _, line := range lines {
        b.WriteString(line)
        b.WriteString("\n")
    }
    return b.String() // Total: O(n)
}
```

**Java:**
```java
public static String buildReport(List<String> lines) {
    StringBuilder sb = new StringBuilder();
    for (String line : lines) {
        sb.append(line).append("\n");
    }
    return sb.toString(); // Total: O(n)
}
```

**Python:**
```python
def build_report(lines):
    return "\n".join(lines) + "\n"  # Total: O(n)
```

---

## Bug 10: Linear Search in Sorted Data

**Description:** Searching for a value in a sorted array using linear scan instead of binary search.

### Go (Buggy):

```go
func findInSorted(arr []int, target int) int {
    for i, val := range arr { // O(n) — ignores sorted property!
        if val == target {
            return i
        }
    }
    return -1
}
```

### Java (Buggy):

```java
public static int findInSorted(int[] arr, int target) {
    for (int i = 0; i < arr.length; i++) { // O(n)!
        if (arr[i] == target) return i;
    }
    return -1;
}
```

### Python (Buggy):

```python
def find_in_sorted(arr, target):
    for i, val in enumerate(arr):  # O(n)!
        if val == target:
            return i
    return -1
```

### Bug

Linear search O(n) on sorted data when binary search O(log n) is available.

### Fix

**Go:** `sort.SearchInts(arr, target)` — O(log n)

**Java:** `Arrays.binarySearch(arr, target)` — O(log n)

**Python:** `bisect.bisect_left(arr, target)` — O(log n)

---

## Bug 11: Using Map When Array Index Suffices

**Description:** Counting occurrences of values in range [0, 100] using a hash map instead of a simple array.

### Go (Buggy):

```go
func countScores(scores []int) map[int]int {
    counts := make(map[int]int) // Overkill for [0, 100] range!
    for _, s := range scores {
        counts[s]++
    }
    return counts
}
```

### Bug

Using a hash map for a small, dense range. A hash map has ~50 bytes overhead per entry. An array of 101 ints uses ~800 bytes total and has O(1) access with no hashing overhead.

### Fix

```go
func countScores(scores []int) [101]int {
    var counts [101]int
    for _, s := range scores {
        counts[s]++
    }
    return counts
}
```

This is faster (no hashing, better cache locality) and uses less memory.

---

## Bug 12: Rebuilding Frequency Map on Every Query

**Description:** A system that answers "how many times has word X appeared?" but rebuilds the frequency map from scratch on every query.

### Go (Buggy):

```go
var allWords []string // grows over time

func getFrequency(word string) int {
    freq := make(map[string]int)
    for _, w := range allWords { // O(n) rebuild every query!
        freq[w]++
    }
    return freq[word]
}
```

### Java (Buggy):

```java
static List<String> allWords = new ArrayList<>();

public static int getFrequency(String word) {
    Map<String, Integer> freq = new HashMap<>();
    for (String w : allWords) { // O(n) rebuild every query!
        freq.merge(w, 1, Integer::sum);
    }
    return freq.getOrDefault(word, 0);
}
```

### Python (Buggy):

```python
all_words = []

def get_frequency(word):
    freq = {}
    for w in all_words:  # O(n) rebuild every query!
        freq[w] = freq.get(w, 0) + 1
    return freq.get(word, 0)
```

### Bug

Rebuilding the entire frequency map on every query is O(n). With m queries, total work is O(n * m).

### Fix

Maintain the frequency map **incrementally**. Update it when words are added, not when queries arrive.

**Go:**
```go
var freq = make(map[string]int) // maintained incrementally

func addWord(word string) {
    freq[word]++ // O(1)
}

func getFrequency(word string) int {
    return freq[word] // O(1)
}
```

**Java:**
```java
static Map<String, Integer> freq = new HashMap<>();

public static void addWord(String word) {
    freq.merge(word, 1, Integer::sum); // O(1)
}

public static int getFrequency(String word) {
    return freq.getOrDefault(word, 0); // O(1)
}
```

**Python:**
```python
freq = {}

def add_word(word):
    freq[word] = freq.get(word, 0) + 1  # O(1)

def get_frequency(word):
    return freq.get(word, 0)  # O(1)
```
