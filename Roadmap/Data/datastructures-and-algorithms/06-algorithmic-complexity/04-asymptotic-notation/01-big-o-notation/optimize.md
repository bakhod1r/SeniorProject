# Big-O Notation -- Optimization Exercises

## Instructions

Each exercise presents a working but inefficient solution. Your task is to:
1. Identify the current Big-O complexity (time and space).
2. Rewrite the solution with a better Big-O complexity.
3. Verify correctness by testing with the same inputs.

---

## Exercise 1: Contains Duplicate

**Current complexity:** O(n^2) time, O(1) space

**Go:**
```go
// O(n^2) time, O(1) space
func containsDuplicate(arr []int) bool {
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
public static boolean containsDuplicate(int[] arr) {
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
def contains_duplicate(arr):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] == arr[j]:
                return True
    return False
```

**Target:** O(n) time, O(n) space

**Optimized Solution (Go):**
```go
func containsDuplicateOptimized(arr []int) bool {
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

**Optimized Solution (Java):**
```java
public static boolean containsDuplicateOptimized(int[] arr) {
    Set<Integer> seen = new HashSet<>();
    for (int v : arr) {
        if (!seen.add(v)) return true;
    }
    return false;
}
```

**Optimized Solution (Python):**
```python
def contains_duplicate_optimized(arr):
    return len(arr) != len(set(arr))
```

---

## Exercise 2: Two Sum (Return Indices)

**Current complexity:** O(n^2) time, O(1) space

**Go:**
```go
func twoSum(arr []int, target int) (int, int) {
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i]+arr[j] == target {
                return i, j
            }
        }
    }
    return -1, -1
}
```

**Java:**
```java
public static int[] twoSum(int[] arr, int target) {
    for (int i = 0; i < arr.length; i++) {
        for (int j = i + 1; j < arr.length; j++) {
            if (arr[i] + arr[j] == target) return new int[]{i, j};
        }
    }
    return new int[]{-1, -1};
}
```

**Python:**
```python
def two_sum(arr, target):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] + arr[j] == target:
                return (i, j)
    return (-1, -1)
```

**Target:** O(n) time, O(n) space

**Optimized Solution (Go):**
```go
func twoSumOptimized(arr []int, target int) (int, int) {
    indexMap := make(map[int]int)
    for i, v := range arr {
        complement := target - v
        if j, ok := indexMap[complement]; ok {
            return j, i
        }
        indexMap[v] = i
    }
    return -1, -1
}
```

**Optimized Solution (Java):**
```java
public static int[] twoSumOptimized(int[] arr, int target) {
    Map<Integer, Integer> indexMap = new HashMap<>();
    for (int i = 0; i < arr.length; i++) {
        int complement = target - arr[i];
        if (indexMap.containsKey(complement)) {
            return new int[]{indexMap.get(complement), i};
        }
        indexMap.put(arr[i], i);
    }
    return new int[]{-1, -1};
}
```

**Optimized Solution (Python):**
```python
def two_sum_optimized(arr, target):
    index_map = {}
    for i, v in enumerate(arr):
        complement = target - v
        if complement in index_map:
            return (index_map[complement], i)
        index_map[v] = i
    return (-1, -1)
```

---

## Exercise 3: Find Common Elements in Two Arrays

**Current complexity:** O(n * m) time, O(min(n, m)) space

**Go:**
```go
func commonElements(a, b []int) []int {
    result := []int{}
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
public static List<Integer> commonElements(int[] a, int[] b) {
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
def common_elements(a, b):
    result = []
    for x in a:
        for y in b:
            if x == y:
                result.append(x)
                break
    return result
```

**Target:** O(n + m) time, O(min(n, m)) space

**Optimized Solution (Go):**
```go
func commonElementsOptimized(a, b []int) []int {
    set := make(map[int]bool)
    for _, v := range b {
        set[v] = true
    }
    result := []int{}
    for _, v := range a {
        if set[v] {
            result = append(result, v)
            delete(set, v) // Avoid duplicates
        }
    }
    return result
}
```

---

## Exercise 4: Fibonacci Number

**Current complexity:** O(2^n) time, O(n) space (call stack)

**Go:**
```go
func fib(n int) int {
    if n <= 1 {
        return n
    }
    return fib(n-1) + fib(n-2)
}
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

**Target:** O(n) time, O(1) space

**Optimized Solution (Go):**
```go
func fibOptimized(n int) int {
    if n <= 1 {
        return n
    }
    prev, curr := 0, 1
    for i := 2; i <= n; i++ {
        prev, curr = curr, prev+curr
    }
    return curr
}
```

**Optimized Solution (Java):**
```java
public static int fibOptimized(int n) {
    if (n <= 1) return n;
    int prev = 0, curr = 1;
    for (int i = 2; i <= n; i++) {
        int next = prev + curr;
        prev = curr;
        curr = next;
    }
    return curr;
}
```

**Optimized Solution (Python):**
```python
def fib_optimized(n):
    if n <= 1:
        return n
    prev, curr = 0, 1
    for _ in range(2, n + 1):
        prev, curr = curr, prev + curr
    return curr
```

---

## Exercise 5: Maximum Subarray Sum of Size k

**Current complexity:** O(n * k) time, O(1) space

**Go:**
```go
func maxSubarraySum(arr []int, k int) int {
    maxSum := 0
    for i := 0; i <= len(arr)-k; i++ {
        sum := 0
        for j := i; j < i+k; j++ {
            sum += arr[j]
        }
        if sum > maxSum {
            maxSum = sum
        }
    }
    return maxSum
}
```

**Target:** O(n) time, O(1) space

**Optimized Solution (Go):**
```go
func maxSubarraySumOptimized(arr []int, k int) int {
    windowSum := 0
    for i := 0; i < k; i++ {
        windowSum += arr[i]
    }
    maxSum := windowSum
    for i := k; i < len(arr); i++ {
        windowSum += arr[i] - arr[i-k]
        if windowSum > maxSum {
            maxSum = windowSum
        }
    }
    return maxSum
}
```

**Optimized Solution (Java):**
```java
public static int maxSubarraySumOptimized(int[] arr, int k) {
    int windowSum = 0;
    for (int i = 0; i < k; i++) windowSum += arr[i];
    int maxSum = windowSum;
    for (int i = k; i < arr.length; i++) {
        windowSum += arr[i] - arr[i - k];
        maxSum = Math.max(maxSum, windowSum);
    }
    return maxSum;
}
```

**Optimized Solution (Python):**
```python
def max_subarray_sum_optimized(arr, k):
    window_sum = sum(arr[:k])
    max_sum = window_sum
    for i in range(k, len(arr)):
        window_sum += arr[i] - arr[i - k]
        max_sum = max(max_sum, window_sum)
    return max_sum
```

---

## Exercise 6: Reverse Words in a String

**Current complexity:** O(n^2) due to string concatenation

**Go:**
```go
func reverseWords(s string) string {
    words := strings.Fields(s)
    result := ""
    for i := len(words) - 1; i >= 0; i-- {
        result += words[i]
        if i > 0 {
            result += " "
        }
    }
    return result
}
```

**Target:** O(n) time

**Optimized Solution (Go):**
```go
func reverseWordsOptimized(s string) string {
    words := strings.Fields(s)
    for i, j := 0, len(words)-1; i < j; i, j = i+1, j-1 {
        words[i], words[j] = words[j], words[i]
    }
    return strings.Join(words, " ")
}
```

---

## Exercise 7: Check if Two Strings are Anagrams

**Current complexity:** O(n * m) or O(n^2) with sorting

**Go:**
```go
// O(n log n) with sorting -- but can we do better?
func isAnagram(s, t string) bool {
    if len(s) != len(t) {
        return false
    }
    sBytes := []byte(s)
    tBytes := []byte(t)
    sort.Slice(sBytes, func(i, j int) bool { return sBytes[i] < sBytes[j] })
    sort.Slice(tBytes, func(i, j int) bool { return tBytes[i] < tBytes[j] })
    return string(sBytes) == string(tBytes)
}
```

**Target:** O(n) time, O(1) space (fixed 26-letter alphabet)

**Optimized Solution (Go):**
```go
func isAnagramOptimized(s, t string) bool {
    if len(s) != len(t) {
        return false
    }
    var counts [26]int
    for i := 0; i < len(s); i++ {
        counts[s[i]-'a']++
        counts[t[i]-'a']--
    }
    for _, c := range counts {
        if c != 0 {
            return false
        }
    }
    return true
}
```

**Optimized Solution (Java):**
```java
public static boolean isAnagramOptimized(String s, String t) {
    if (s.length() != t.length()) return false;
    int[] counts = new int[26];
    for (int i = 0; i < s.length(); i++) {
        counts[s.charAt(i) - 'a']++;
        counts[t.charAt(i) - 'a']--;
    }
    for (int c : counts) {
        if (c != 0) return false;
    }
    return true;
}
```

**Optimized Solution (Python):**
```python
def is_anagram_optimized(s, t):
    if len(s) != len(t):
        return False
    counts = [0] * 26
    for sc, tc in zip(s, t):
        counts[ord(sc) - ord('a')] += 1
        counts[ord(tc) - ord('a')] -= 1
    return all(c == 0 for c in counts)
```

---

## Exercise 8: Flatten Nested Lists

**Current complexity:** O(n * d) where d is max nesting depth (due to repeated copying)

**Go:**
```go
// Inefficient: creates many intermediate slices
func flatten(nested []interface{}) []int {
    result := []int{}
    for _, item := range nested {
        switch v := item.(type) {
        case int:
            result = append(result, v)
        case []interface{}:
            sub := flatten(v)
            // This creates a new slice each time
            newResult := make([]int, len(result)+len(sub))
            copy(newResult, result)
            copy(newResult[len(result):], sub)
            result = newResult
        }
    }
    return result
}
```

**Target:** O(n) total time where n is total number of elements

**Optimized Solution (Go):**
```go
func flattenOptimized(nested []interface{}) []int {
    result := []int{}
    var helper func([]interface{})
    helper = func(items []interface{}) {
        for _, item := range items {
            switch v := item.(type) {
            case int:
                result = append(result, v) // Amortized O(1)
            case []interface{}:
                helper(v)
            }
        }
    }
    helper(nested)
    return result
}
```

---

## Exercise 9: Find Kth Largest Element

**Current complexity:** O(n * k) time

**Go:**
```go
// Sort fully then return kth element: O(n log n)
// Or worse: find max k times: O(n * k)
func kthLargest(arr []int, k int) int {
    for i := 0; i < k; i++ {
        maxIdx := 0
        for j := 1; j < len(arr)-i; j++ {
            if arr[j] > arr[maxIdx] {
                maxIdx = j
            }
        }
        arr[maxIdx], arr[len(arr)-1-i] = arr[len(arr)-1-i], arr[maxIdx]
    }
    return arr[len(arr)-k]
}
```

**Target:** O(n) average time using Quickselect

**Optimized Solution (Go):**
```go
func kthLargestOptimized(arr []int, k int) int {
    target := len(arr) - k
    return quickSelect(arr, 0, len(arr)-1, target)
}

func quickSelect(arr []int, lo, hi, target int) int {
    if lo == hi {
        return arr[lo]
    }
    pivotIdx := partition(arr, lo, hi)
    if target == pivotIdx {
        return arr[pivotIdx]
    } else if target < pivotIdx {
        return quickSelect(arr, lo, pivotIdx-1, target)
    }
    return quickSelect(arr, pivotIdx+1, hi, target)
}

func partition(arr []int, lo, hi int) int {
    pivot := arr[hi]
    i := lo
    for j := lo; j < hi; j++ {
        if arr[j] <= pivot {
            arr[i], arr[j] = arr[j], arr[i]
            i++
        }
    }
    arr[i], arr[hi] = arr[hi], arr[i]
    return i
}
```

**Optimized Solution (Java):**
```java
public static int kthLargestOptimized(int[] arr, int k) {
    int target = arr.length - k;
    return quickSelect(arr, 0, arr.length - 1, target);
}

private static int quickSelect(int[] arr, int lo, int hi, int target) {
    if (lo == hi) return arr[lo];
    int pivotIdx = partition(arr, lo, hi);
    if (target == pivotIdx) return arr[pivotIdx];
    else if (target < pivotIdx) return quickSelect(arr, lo, pivotIdx - 1, target);
    return quickSelect(arr, pivotIdx + 1, hi, target);
}

private static int partition(int[] arr, int lo, int hi) {
    int pivot = arr[hi], i = lo;
    for (int j = lo; j < hi; j++) {
        if (arr[j] <= pivot) {
            int tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
            i++;
        }
    }
    int tmp = arr[i]; arr[i] = arr[hi]; arr[hi] = tmp;
    return i;
}
```

**Optimized Solution (Python):**
```python
import random

def kth_largest_optimized(arr, k):
    target = len(arr) - k

    def quick_select(lo, hi):
        pivot_idx = random.randint(lo, hi)
        arr[pivot_idx], arr[hi] = arr[hi], arr[pivot_idx]
        pivot = arr[hi]
        i = lo
        for j in range(lo, hi):
            if arr[j] <= pivot:
                arr[i], arr[j] = arr[j], arr[i]
                i += 1
        arr[i], arr[hi] = arr[hi], arr[i]

        if i == target:
            return arr[i]
        elif i < target:
            return quick_select(i + 1, hi)
        else:
            return quick_select(lo, i - 1)

    return quick_select(0, len(arr) - 1)
```

---

## Exercise 10: Group Anagrams

**Current complexity:** O(n^2 * m) where n = number of words, m = average word length

**Go:**
```go
// Brute force: compare every pair of words
func groupAnagrams(words []string) [][]string {
    used := make([]bool, len(words))
    groups := [][]string{}

    for i := 0; i < len(words); i++ {
        if used[i] {
            continue
        }
        group := []string{words[i]}
        for j := i + 1; j < len(words); j++ {
            if !used[j] && areAnagrams(words[i], words[j]) {
                group = append(group, words[j])
                used[j] = true
            }
        }
        groups = append(groups, group)
    }
    return groups
}

func areAnagrams(a, b string) bool {
    if len(a) != len(b) { return false }
    counts := [26]int{}
    for i := 0; i < len(a); i++ {
        counts[a[i]-'a']++
        counts[b[i]-'a']--
    }
    for _, c := range counts {
        if c != 0 { return false }
    }
    return true
}
```

**Target:** O(n * m) time where n = number of words, m = average word length (or O(n * m log m) with sorting keys)

**Optimized Solution (Go):**
```go
func groupAnagramsOptimized(words []string) [][]string {
    groups := make(map[string][]string)
    for _, word := range words {
        // Create a canonical key by sorting characters: O(m log m)
        key := sortString(word)
        groups[key] = append(groups[key], word)
    }
    result := make([][]string, 0, len(groups))
    for _, group := range groups {
        result = append(result, group)
    }
    return result
}

func sortString(s string) string {
    b := []byte(s)
    sort.Slice(b, func(i, j int) bool { return b[i] < b[j] })
    return string(b)
}

// Even better: O(n * m) using character count as key
func groupAnagramsOptimal(words []string) [][]string {
    groups := make(map[[26]int][]string)
    for _, word := range words {
        var key [26]int
        for _, ch := range word {
            key[ch-'a']++
        }
        groups[key] = append(groups[key], word)
    }
    result := make([][]string, 0, len(groups))
    for _, group := range groups {
        result = append(result, group)
    }
    return result
}
```

**Optimized Solution (Java):**
```java
public static List<List<String>> groupAnagramsOptimized(String[] words) {
    Map<String, List<String>> groups = new HashMap<>();
    for (String word : words) {
        char[] chars = word.toCharArray();
        Arrays.sort(chars);
        String key = new String(chars);
        groups.computeIfAbsent(key, k -> new ArrayList<>()).add(word);
    }
    return new ArrayList<>(groups.values());
}
```

**Optimized Solution (Python):**
```python
from collections import defaultdict

def group_anagrams_optimized(words):
    groups = defaultdict(list)
    for word in words:
        key = tuple(sorted(word))  # O(m log m) per word
        groups[key].append(word)
    return list(groups.values())

# O(n * m) version using character counts as key
def group_anagrams_optimal(words):
    groups = defaultdict(list)
    for word in words:
        key = [0] * 26
        for ch in word:
            key[ord(ch) - ord('a')] += 1
        groups[tuple(key)].append(word)
    return list(groups.values())
```

---

## Summary Table

| Exercise | Problem              | Before        | After         | Technique                 |
|----------|----------------------|---------------|---------------|---------------------------|
| 1        | Contains Duplicate   | O(n^2)        | O(n)          | Hash set                  |
| 2        | Two Sum              | O(n^2)        | O(n)          | Hash map                  |
| 3        | Common Elements      | O(n * m)      | O(n + m)      | Hash set                  |
| 4        | Fibonacci            | O(2^n)        | O(n)          | Iterative DP              |
| 5        | Max Subarray Sum k   | O(n * k)      | O(n)          | Sliding window            |
| 6        | Reverse Words        | O(n^2)        | O(n)          | strings.Join / StringBuilder |
| 7        | Anagram Check        | O(n log n)    | O(n)          | Character counting        |
| 8        | Flatten Nested       | O(n * d)      | O(n)          | Single result slice       |
| 9        | Kth Largest          | O(n * k)      | O(n) avg      | Quickselect               |
| 10       | Group Anagrams       | O(n^2 * m)    | O(n * m)      | Hash map with count key   |
