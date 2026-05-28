# Why are Data Structures Important? — Optimize the Code

## Table of Contents

1. [How to Use This File](#how-to-use-this-file)
2. [Exercise 1: List Membership to Set — O(n) to O(1)](#exercise-1-list-membership-to-set-on-to-o1)
3. [Exercise 2: Nested Duplicate Check to Hash Set — O(n^2) to O(n)](#exercise-2-nested-duplicate-check-to-hash-set-on2-to-on)
4. [Exercise 3: Array Queue to Deque — O(n) to O(1) Dequeue](#exercise-3-array-queue-to-deque-on-to-o1-dequeue)
5. [Exercise 4: Nested Loop Frequency to Hash Map — O(n^2) to O(n)](#exercise-4-nested-loop-frequency-to-hash-map-on2-to-on)
6. [Exercise 5: Linear Search to Binary Search — O(n) to O(log n)](#exercise-5-linear-search-to-binary-search-on-to-olog-n)
7. [Exercise 6: Repeated Min to Heap — O(n*k) to O(n + k log n)](#exercise-6-repeated-min-to-heap-onk-to-on-k-log-n)
8. [Exercise 7: String Concatenation to Builder — O(n^2) to O(n)](#exercise-7-string-concatenation-to-builder-on2-to-on)
9. [Exercise 8: Array Insert-at-Front to Deque — O(n^2) to O(n)](#exercise-8-array-insert-at-front-to-deque-on2-to-on)
10. [Exercise 9: Brute Force Intersection to Set — O(n*m) to O(n+m)](#exercise-9-brute-force-intersection-to-set-onm-to-onm)
11. [Exercise 10: Linear Search for Range to BST — O(n) to O(log n + k)](#exercise-10-linear-search-for-range-to-bst-on-to-olog-n-k)
12. [Exercise 11: Brute Force Anagram Check to Hash Map — O(n log n) to O(n)](#exercise-11-brute-force-anagram-check-to-hash-map-on-log-n-to-on)

---

## How to Use This File

Each exercise shows **slow code** that works but is inefficient, followed by **optimized code** that produces the same result with better time or space complexity. For each exercise:

1. Read the slow version and identify the bottleneck.
2. Think about what data structure or technique would eliminate it.
3. Compare your idea to the optimized version.
4. Verify that both versions produce the same output.

---

## Exercise 1: List Membership to Set — O(n) to O(1)

**Problem:** Filter a stream of events, keeping only events whose category is in an allowed list. Called millions of times.

**Bottleneck:** Checking membership in a list is O(n) per check.

### Slow Version — O(n) per check

**Go:**
```go
func isAllowed(categories []string, category string) bool {
    for _, c := range categories {
        if c == category {
            return true
        }
    }
    return false
}

func filterEvents(events []Event, allowedCategories []string) []Event {
    var result []Event
    for _, e := range events {
        if isAllowed(allowedCategories, e.Category) { // O(n) per event
            result = append(result, e)
        }
    }
    return result
}
```

**Java:**
```java
public static List<Event> filterEvents(List<Event> events, List<String> allowed) {
    List<Event> result = new ArrayList<>();
    for (Event e : events) {
        if (allowed.contains(e.category)) { // O(n) per event
            result.add(e);
        }
    }
    return result;
}
```

**Python:**
```python
def filter_events(events, allowed_categories):
    result = []
    for e in events:
        if e.category in allowed_categories:  # O(n) if list
            result.append(e)
    return result
```

### Optimized Version — O(1) per check

**Go:**
```go
func filterEvents(events []Event, allowedCategories []string) []Event {
    allowed := make(map[string]struct{}, len(allowedCategories))
    for _, c := range allowedCategories {
        allowed[c] = struct{}{}
    }
    var result []Event
    for _, e := range events {
        if _, ok := allowed[e.Category]; ok { // O(1) per event
            result = append(result, e)
        }
    }
    return result
}
```

**Java:**
```java
public static List<Event> filterEvents(List<Event> events, List<String> allowed) {
    Set<String> allowedSet = new HashSet<>(allowed); // O(n) once
    List<Event> result = new ArrayList<>();
    for (Event e : events) {
        if (allowedSet.contains(e.category)) { // O(1) per event
            result.add(e);
        }
    }
    return result;
}
```

**Python:**
```python
def filter_events(events, allowed_categories):
    allowed_set = set(allowed_categories)  # O(n) once
    return [e for e in events if e.category in allowed_set]  # O(1) per check
```

**Improvement:** From O(events * categories) to O(events + categories).

---

## Exercise 2: Nested Duplicate Check to Hash Set — O(n^2) to O(n)

**Problem:** Find all duplicate values in an array.

**Bottleneck:** For each element, scanning the rest of the array to check for duplicates.

### Slow Version — O(n^2)

**Go:**
```go
func findDuplicates(arr []int) []int {
    var duplicates []int
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i] == arr[j] {
                duplicates = append(duplicates, arr[i])
                break
            }
        }
    }
    return duplicates
}
```

**Java:**
```java
public static List<Integer> findDuplicates(int[] arr) {
    List<Integer> duplicates = new ArrayList<>();
    for (int i = 0; i < arr.length; i++) {
        for (int j = i + 1; j < arr.length; j++) {
            if (arr[i] == arr[j]) {
                duplicates.add(arr[i]);
                break;
            }
        }
    }
    return duplicates;
}
```

**Python:**
```python
def find_duplicates(arr):
    duplicates = []
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                duplicates.append(arr[i])
                break
    return duplicates
```

### Optimized Version — O(n)

**Go:**
```go
func findDuplicates(arr []int) []int {
    seen := make(map[int]struct{})
    added := make(map[int]struct{})
    var duplicates []int
    for _, val := range arr {
        if _, exists := seen[val]; exists {
            if _, alreadyAdded := added[val]; !alreadyAdded {
                duplicates = append(duplicates, val)
                added[val] = struct{}{}
            }
        }
        seen[val] = struct{}{}
    }
    return duplicates
}
```

**Java:**
```java
public static List<Integer> findDuplicates(int[] arr) {
    Set<Integer> seen = new HashSet<>();
    Set<Integer> added = new HashSet<>();
    List<Integer> duplicates = new ArrayList<>();
    for (int val : arr) {
        if (!seen.add(val) && added.add(val)) {
            duplicates.add(val);
        }
    }
    return duplicates;
}
```

**Python:**
```python
def find_duplicates(arr):
    seen = set()
    duplicates = set()
    for val in arr:
        if val in seen:
            duplicates.add(val)
        seen.add(val)
    return list(duplicates)
```

**Improvement:** From O(n^2) to O(n) using hash sets for O(1) lookups.

---

## Exercise 3: Array Queue to Deque — O(n) to O(1) Dequeue

**Problem:** Process tasks in FIFO order. New tasks are added to the back, processed from the front.

**Bottleneck:** Removing from the front of an array shifts all elements — O(n).

### Slow Version — O(n) dequeue

**Go:**
```go
func processTasks(tasks []string) {
    queue := make([]string, 0)
    queue = append(queue, tasks...)
    for len(queue) > 0 {
        task := queue[0]
        queue = queue[1:] // O(n) — creates new underlying array reference
        fmt.Println("Processing:", task)
    }
}
```

**Java:**
```java
public static void processTasks(List<String> tasks) {
    List<String> queue = new ArrayList<>(tasks);
    while (!queue.isEmpty()) {
        String task = queue.remove(0); // O(n) — shifts all elements!
        System.out.println("Processing: " + task);
    }
}
```

**Python:**
```python
def process_tasks(tasks):
    queue = list(tasks)
    while queue:
        task = queue.pop(0)  # O(n) — shifts all elements!
        print(f"Processing: {task}")
```

### Optimized Version — O(1) dequeue

**Go:**
```go
import "container/list"

func processTasks(tasks []string) {
    queue := list.New()
    for _, t := range tasks {
        queue.PushBack(t)
    }
    for queue.Len() > 0 {
        front := queue.Front()
        queue.Remove(front) // O(1)
        fmt.Println("Processing:", front.Value)
    }
}
```

**Java:**
```java
public static void processTasks(List<String> tasks) {
    Queue<String> queue = new LinkedList<>(tasks);
    while (!queue.isEmpty()) {
        String task = queue.poll(); // O(1)
        System.out.println("Processing: " + task);
    }
}
```

**Python:**
```python
from collections import deque

def process_tasks(tasks):
    queue = deque(tasks)
    while queue:
        task = queue.popleft()  # O(1)
        print(f"Processing: {task}")
```

**Improvement:** Dequeue from O(n) to O(1) by using a proper queue DS.

---

## Exercise 4: Nested Loop Frequency to Hash Map — O(n^2) to O(n)

**Problem:** Count how many times each word appears in a list.

**Bottleneck:** For each word, scanning the entire list to count.

### Slow Version — O(n^2)

**Go:**
```go
func wordFrequency(words []string) map[string]int {
    result := make(map[string]int)
    for _, word := range words {
        if _, counted := result[word]; counted {
            continue
        }
        count := 0
        for _, w := range words { // Scan all words for each unique word
            if w == word {
                count++
            }
        }
        result[word] = count
    }
    return result
}
```

**Java:**
```java
public static Map<String, Integer> wordFrequency(String[] words) {
    Map<String, Integer> result = new HashMap<>();
    for (String word : words) {
        if (result.containsKey(word)) continue;
        int count = 0;
        for (String w : words) {
            if (w.equals(word)) count++;
        }
        result.put(word, count);
    }
    return result;
}
```

**Python:**
```python
def word_frequency(words):
    result = {}
    for word in words:
        if word in result:
            continue
        count = sum(1 for w in words if w == word)
        result[word] = count
    return result
```

### Optimized Version — O(n)

**Go:**
```go
func wordFrequency(words []string) map[string]int {
    result := make(map[string]int)
    for _, word := range words {
        result[word]++ // O(1) per word
    }
    return result
}
```

**Java:**
```java
public static Map<String, Integer> wordFrequency(String[] words) {
    Map<String, Integer> result = new HashMap<>();
    for (String word : words) {
        result.merge(word, 1, Integer::sum); // O(1) per word
    }
    return result;
}
```

**Python:**
```python
from collections import Counter

def word_frequency(words):
    return dict(Counter(words))  # O(n) single pass
```

**Improvement:** From O(n * unique) ≈ O(n^2) to O(n) with a single pass hash map.

---

## Exercise 5: Linear Search to Binary Search — O(n) to O(log n)

**Problem:** Find a user by ID in a sorted list of users.

**Bottleneck:** Scanning the entire sorted list when binary search is available.

### Slow Version — O(n)

**Go:**
```go
func findUser(users []User, targetID int) *User {
    for i := range users {
        if users[i].ID == targetID {
            return &users[i]
        }
    }
    return nil
}
```

**Java:**
```java
public static User findUser(List<User> users, int targetId) {
    for (User u : users) {
        if (u.id == targetId) return u;
    }
    return null;
}
```

**Python:**
```python
def find_user(users, target_id):
    for user in users:
        if user.id == target_id:
            return user
    return None
```

### Optimized Version — O(log n)

**Go:**
```go
import "sort"

func findUser(users []User, targetID int) *User {
    idx := sort.Search(len(users), func(i int) bool {
        return users[i].ID >= targetID
    })
    if idx < len(users) && users[idx].ID == targetID {
        return &users[idx]
    }
    return nil
}
```

**Java:**
```java
public static User findUser(List<User> users, int targetId) {
    int lo = 0, hi = users.size() - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (users.get(mid).id == targetId) return users.get(mid);
        else if (users.get(mid).id < targetId) lo = mid + 1;
        else hi = mid - 1;
    }
    return null;
}
```

**Python:**
```python
import bisect

def find_user(users, target_id):
    ids = [u.id for u in users]  # pre-build if called often
    idx = bisect.bisect_left(ids, target_id)
    if idx < len(users) and users[idx].id == target_id:
        return users[idx]
    return None
```

**Improvement:** From O(n) to O(log n). For 1 million users, from 1,000,000 comparisons to 20.

---

## Exercise 6: Repeated Min to Heap — O(n*k) to O(n + k log n)

**Problem:** Find the K smallest elements from an unsorted array.

**Bottleneck:** Finding and removing the min element K times, each requiring a full scan.

### Slow Version — O(n*k)

**Go:**
```go
func kSmallest(arr []int, k int) []int {
    result := make([]int, 0, k)
    used := make([]bool, len(arr))
    for i := 0; i < k; i++ {
        minIdx := -1
        for j := 0; j < len(arr); j++ {
            if !used[j] && (minIdx == -1 || arr[j] < arr[minIdx]) {
                minIdx = j
            }
        }
        result = append(result, arr[minIdx])
        used[minIdx] = true
    }
    return result
}
```

**Java:**
```java
public static List<Integer> kSmallest(int[] arr, int k) {
    boolean[] used = new boolean[arr.length];
    List<Integer> result = new ArrayList<>();
    for (int i = 0; i < k; i++) {
        int minIdx = -1;
        for (int j = 0; j < arr.length; j++) {
            if (!used[j] && (minIdx == -1 || arr[j] < arr[minIdx])) {
                minIdx = j;
            }
        }
        result.add(arr[minIdx]);
        used[minIdx] = true;
    }
    return result;
}
```

**Python:**
```python
def k_smallest(arr, k):
    result = []
    used = [False] * len(arr)
    for _ in range(k):
        min_idx = -1
        for j in range(len(arr)):
            if not used[j] and (min_idx == -1 or arr[j] < arr[min_idx]):
                min_idx = j
        result.append(arr[min_idx])
        used[min_idx] = True
    return result
```

### Optimized Version — O(n + k log n) with heap

**Go:**
```go
import "container/heap"

type IntHeap []int
func (h IntHeap) Len() int            { return len(h) }
func (h IntHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x interface{}) { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() interface{} {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[:n-1]
    return x
}

func kSmallest(arr []int, k int) []int {
    h := IntHeap(append([]int{}, arr...))
    heap.Init(&h) // O(n)
    result := make([]int, 0, k)
    for i := 0; i < k; i++ {
        result = append(result, heap.Pop(&h).(int)) // O(log n)
    }
    return result
}
```

**Java:**
```java
public static List<Integer> kSmallest(int[] arr, int k) {
    PriorityQueue<Integer> heap = new PriorityQueue<>();
    for (int val : arr) heap.offer(val); // O(n) with heapify
    List<Integer> result = new ArrayList<>();
    for (int i = 0; i < k; i++) {
        result.add(heap.poll()); // O(log n)
    }
    return result;
}
```

**Python:**
```python
import heapq

def k_smallest(arr, k):
    return heapq.nsmallest(k, arr)  # O(n + k log n) internally
```

**Improvement:** From O(n*k) to O(n + k log n). For n=1M, k=10: from 10M ops to ~1M + 40 ops.

---

## Exercise 7: String Concatenation to Builder — O(n^2) to O(n)

**Problem:** Build a CSV row from an array of values.

**Bottleneck:** Each string concatenation creates a new string and copies all previous content.

### Slow Version — O(n^2)

**Go:**
```go
func toCSV(values []string) string {
    result := ""
    for i, v := range values {
        if i > 0 {
            result += ","
        }
        result += v // Copies entire string each time!
    }
    return result
}
```

**Java:**
```java
public static String toCSV(String[] values) {
    String result = "";
    for (int i = 0; i < values.length; i++) {
        if (i > 0) result += ",";
        result += values[i]; // Creates new String object each time!
    }
    return result;
}
```

**Python:**
```python
def to_csv(values):
    result = ""
    for i, v in enumerate(values):
        if i > 0:
            result += ","
        result += v  # Creates new string each time!
    return result
```

### Optimized Version — O(n)

**Go:**
```go
import "strings"

func toCSV(values []string) string {
    return strings.Join(values, ",") // O(n) — single allocation
}
```

**Java:**
```java
public static String toCSV(String[] values) {
    return String.join(",", values); // O(n) — single allocation
}
```

**Python:**
```python
def to_csv(values):
    return ",".join(values)  # O(n) — single allocation
```

**Improvement:** From O(n^2) to O(n). For 10,000 fields of average length 20, from ~1 billion char copies to ~200,000.

---

## Exercise 8: Array Insert-at-Front to Deque — O(n^2) to O(n)

**Problem:** Build a result list where new items must be prepended (added to the front).

**Bottleneck:** Inserting at index 0 of an array shifts all existing elements.

### Slow Version — O(n^2)

**Go:**
```go
func buildReversed(items []int) []int {
    var result []int
    for _, item := range items {
        result = append([]int{item}, result...) // O(n) per insert!
    }
    return result
}
```

**Java:**
```java
public static List<Integer> buildReversed(int[] items) {
    List<Integer> result = new ArrayList<>();
    for (int item : items) {
        result.add(0, item); // O(n) — shifts all elements!
    }
    return result;
}
```

**Python:**
```python
def build_reversed(items):
    result = []
    for item in items:
        result.insert(0, item)  # O(n) — shifts all elements!
    return result
```

### Optimized Version — O(n)

**Go:**
```go
func buildReversed(items []int) []int {
    result := make([]int, 0, len(items))
    for _, item := range items {
        result = append(result, item) // O(1) amortized
    }
    // Reverse in place
    for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
        result[i], result[j] = result[j], result[i]
    }
    return result
}
```

**Java:**
```java
public static List<Integer> buildReversed(int[] items) {
    LinkedList<Integer> result = new LinkedList<>();
    for (int item : items) {
        result.addFirst(item); // O(1) — linked list prepend
    }
    return result;
}
// Or: append to ArrayList then Collections.reverse()
```

**Python:**
```python
from collections import deque

def build_reversed(items):
    result = deque()
    for item in items:
        result.appendleft(item)  # O(1)
    return list(result)
```

**Improvement:** From O(n^2) to O(n) using deque or append-then-reverse.

---

## Exercise 9: Brute Force Intersection to Set — O(n*m) to O(n+m)

**Problem:** Find common elements between two arrays.

**Bottleneck:** For each element in array A, scanning all of array B.

### Slow Version — O(n*m)

**Go:**
```go
func intersection(a, b []int) []int {
    var result []int
    for _, x := range a {
        for _, y := range b {
            if x == y {
                result = append(result, x)
                break
            }
        }
    }
    return result
}
```

**Java:**
```java
public static List<Integer> intersection(int[] a, int[] b) {
    List<Integer> result = new ArrayList<>();
    for (int x : a) {
        for (int y : b) {
            if (x == y) { result.add(x); break; }
        }
    }
    return result;
}
```

**Python:**
```python
def intersection(a, b):
    result = []
    for x in a:
        for y in b:
            if x == y:
                result.append(x)
                break
    return result
```

### Optimized Version — O(n+m)

**Go:**
```go
func intersection(a, b []int) []int {
    setB := make(map[int]struct{}, len(b))
    for _, val := range b {
        setB[val] = struct{}{}
    }
    var result []int
    for _, val := range a {
        if _, exists := setB[val]; exists {
            result = append(result, val)
            delete(setB, val) // prevent duplicates
        }
    }
    return result
}
```

**Java:**
```java
public static List<Integer> intersection(int[] a, int[] b) {
    Set<Integer> setB = new HashSet<>();
    for (int val : b) setB.add(val);
    List<Integer> result = new ArrayList<>();
    for (int val : a) {
        if (setB.remove(val)) result.add(val);
    }
    return result;
}
```

**Python:**
```python
def intersection(a, b):
    return list(set(a) & set(b))  # O(n + m)
```

**Improvement:** From O(n*m) to O(n+m). For n=m=100,000: from 10 billion ops to 200,000.

---

## Exercise 10: Linear Search for Range to BST — O(n) to O(log n + k)

**Problem:** Find all values in a sorted collection within a range [lo, hi].

**Bottleneck:** Scanning from the beginning even when the collection is sorted.

### Slow Version — O(n)

**Go:**
```go
func rangeQuery(sorted []int, lo, hi int) []int {
    var result []int
    for _, val := range sorted {
        if val >= lo && val <= hi {
            result = append(result, val)
        }
    }
    return result
}
```

**Java:**
```java
public static List<Integer> rangeQuery(int[] sorted, int lo, int hi) {
    List<Integer> result = new ArrayList<>();
    for (int val : sorted) {
        if (val >= lo && val <= hi) result.add(val);
    }
    return result;
}
```

**Python:**
```python
def range_query(sorted_arr, lo, hi):
    return [val for val in sorted_arr if lo <= val <= hi]  # O(n)
```

### Optimized Version — O(log n + k) where k = number of results

**Go:**
```go
import "sort"

func rangeQuery(sorted []int, lo, hi int) []int {
    left := sort.SearchInts(sorted, lo)       // O(log n)
    right := sort.SearchInts(sorted, hi+1)    // O(log n)
    if left >= len(sorted) || left >= right {
        return nil
    }
    return sorted[left:right] // O(k) — just a slice
}
```

**Java:**
```java
import java.util.*;

public static List<Integer> rangeQuery(int[] sorted, int lo, int hi) {
    TreeSet<Integer> tree = new TreeSet<>();
    for (int val : sorted) tree.add(val); // O(n log n) — do once
    return new ArrayList<>(tree.subSet(lo, true, hi, true)); // O(log n + k)
}
// Or use binary search on the sorted array
```

**Python:**
```python
import bisect

def range_query(sorted_arr, lo, hi):
    left = bisect.bisect_left(sorted_arr, lo)   # O(log n)
    right = bisect.bisect_right(sorted_arr, hi)  # O(log n)
    return sorted_arr[left:right]  # O(k)
```

**Improvement:** From O(n) full scan to O(log n + k) binary search + slice. For n=1M and k=100: from 1M ops to ~20 + 100 ops.

---

## Exercise 11: Brute Force Anagram Check to Hash Map — O(n log n) to O(n)

**Problem:** Check if two strings are anagrams (contain the same characters in different order).

**Bottleneck:** Sorting both strings O(n log n) when character counting O(n) suffices.

### Slow Version — O(n log n)

**Go:**
```go
import "sort"

func isAnagram(s1, s2 string) bool {
    a := []byte(s1)
    b := []byte(s2)
    sort.Slice(a, func(i, j int) bool { return a[i] < a[j] })
    sort.Slice(b, func(i, j int) bool { return b[i] < b[j] })
    return string(a) == string(b) // O(n log n) sorting
}
```

**Java:**
```java
public static boolean isAnagram(String s1, String s2) {
    char[] a = s1.toCharArray();
    char[] b = s2.toCharArray();
    Arrays.sort(a); // O(n log n)
    Arrays.sort(b);
    return Arrays.equals(a, b);
}
```

**Python:**
```python
def is_anagram(s1, s2):
    return sorted(s1) == sorted(s2)  # O(n log n)
```

### Optimized Version — O(n)

**Go:**
```go
func isAnagram(s1, s2 string) bool {
    if len(s1) != len(s2) {
        return false
    }
    counts := make(map[byte]int)
    for i := 0; i < len(s1); i++ {
        counts[s1[i]]++
        counts[s2[i]]--
    }
    for _, count := range counts {
        if count != 0 {
            return false
        }
    }
    return true // O(n) single pass
}
```

**Java:**
```java
public static boolean isAnagram(String s1, String s2) {
    if (s1.length() != s2.length()) return false;
    int[] counts = new int[26]; // fixed-size array for lowercase letters
    for (int i = 0; i < s1.length(); i++) {
        counts[s1.charAt(i) - 'a']++;
        counts[s2.charAt(i) - 'a']--;
    }
    for (int c : counts) {
        if (c != 0) return false;
    }
    return true; // O(n)
}
```

**Python:**
```python
from collections import Counter

def is_anagram(s1, s2):
    return Counter(s1) == Counter(s2)  # O(n)
```

**Improvement:** From O(n log n) to O(n). Uses character frequency counting via hash map or fixed-size array instead of sorting.
