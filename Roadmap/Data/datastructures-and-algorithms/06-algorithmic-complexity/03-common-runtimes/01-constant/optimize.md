# Constant Time O(1) -- Optimize

## Instructions

Each exercise starts with code that uses O(n), O(log n), or worse complexity. Your
goal is to **optimize** the critical operation to O(1) (or amortized O(1)). For each
exercise, the "Before" code is provided and you must write the "After" version.

---

## Exercise 1: Check Membership -- O(n) to O(1)

**Before:** Linear search through a list to check if a user is active.

### Go -- Before

```go
// O(n) -- linear scan
func isActive(activeUsers []string, username string) bool {
    for _, u := range activeUsers {
        if u == username {
            return true
        }
    }
    return false
}
```

### Go -- After

```go
// O(1) average -- use a hash set
func isActive(activeUsers map[string]bool, username string) bool {
    return activeUsers[username]
}

// Setup: convert slice to map once (O(n)), then all lookups are O(1)
func buildActiveSet(users []string) map[string]bool {
    set := make(map[string]bool, len(users))
    for _, u := range users {
        set[u] = true
    }
    return set
}
```

### Java -- Before

```java
// O(n) -- linear scan
static boolean isActive(List<String> activeUsers, String username) {
    return activeUsers.contains(username);
}
```

### Java -- After

```java
// O(1) average -- use a HashSet
static boolean isActive(Set<String> activeUsers, String username) {
    return activeUsers.contains(username);
}

// Setup: new HashSet<>(activeUsersList)
```

### Python -- Before

```python
# O(n) -- linear scan
def is_active(active_users, username):
    return username in active_users  # active_users is a list
```

### Python -- After

```python
# O(1) average -- use a set
def is_active(active_users_set, username):
    return username in active_users_set  # 'in' on a set is O(1)

# Setup: active_users_set = set(active_users_list)
```

---

## Exercise 2: Get Frequency Count -- O(n) to O(1)

**Before:** Count occurrences of an element by scanning the entire collection each time.

### Go -- Before

```go
// O(n) per query
func countOccurrences(arr []int, target int) int {
    count := 0
    for _, v := range arr {
        if v == target {
            count++
        }
    }
    return count
}
```

### Go -- After

```go
// O(1) per query -- precompute frequency map
type FrequencyCounter struct {
    freq map[int]int
}

func NewFrequencyCounter(arr []int) *FrequencyCounter {
    freq := make(map[int]int)
    for _, v := range arr {
        freq[v]++
    }
    return &FrequencyCounter{freq: freq}
}

func (fc *FrequencyCounter) Count(target int) int {
    return fc.freq[target] // O(1) lookup
}
```

### Java -- Before

```java
// O(n) per query
static int countOccurrences(int[] arr, int target) {
    int count = 0;
    for (int v : arr) {
        if (v == target) count++;
    }
    return count;
}
```

### Java -- After

```java
// O(1) per query -- precompute frequency map
class FrequencyCounter {
    private Map<Integer, Integer> freq = new HashMap<>();

    FrequencyCounter(int[] arr) {
        for (int v : arr) freq.merge(v, 1, Integer::sum);
    }

    int count(int target) {
        return freq.getOrDefault(target, 0); // O(1)
    }
}
```

### Python -- Before

```python
# O(n) per query
def count_occurrences(arr, target):
    return arr.count(target)
```

### Python -- After

```python
from collections import Counter

# O(1) per query -- precompute frequency map
freq = Counter(arr)  # O(n) once
count = freq[target]  # O(1) per query
```

---

## Exercise 3: Find Pair Sum -- O(n^2) to O(n)

**Before:** Check all pairs with nested loops.

### Go -- Before

```go
// O(n^2)
func hasPairSum(arr []int, target int) bool {
    for i := 0; i < len(arr); i++ {
        for j := i + 1; j < len(arr); j++ {
            if arr[i]+arr[j] == target {
                return true
            }
        }
    }
    return false
}
```

### Go -- After

```go
// O(n) -- use hash set for O(1) complement lookup
func hasPairSum(arr []int, target int) bool {
    seen := make(map[int]bool)
    for _, v := range arr {
        complement := target - v
        if seen[complement] {
            return true
        }
        seen[v] = true
    }
    return false
}
```

### Java -- Before

```java
// O(n^2)
static boolean hasPairSum(int[] arr, int target) {
    for (int i = 0; i < arr.length; i++)
        for (int j = i + 1; j < arr.length; j++)
            if (arr[i] + arr[j] == target) return true;
    return false;
}
```

### Java -- After

```java
// O(n) -- O(1) lookup per element
static boolean hasPairSum(int[] arr, int target) {
    Set<Integer> seen = new HashSet<>();
    for (int v : arr) {
        if (seen.contains(target - v)) return true;
        seen.add(v);
    }
    return false;
}
```

### Python -- Before

```python
# O(n^2)
def has_pair_sum(arr, target):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] + arr[j] == target:
                return True
    return False
```

### Python -- After

```python
# O(n) -- O(1) lookup per element
def has_pair_sum(arr, target):
    seen = set()
    for v in arr:
        if target - v in seen:
            return True
        seen.add(v)
    return False
```

---

## Exercise 4: Track Running Maximum -- O(n) to O(1) per Query

**Before:** Recompute max from scratch on every query.

### Go -- Before

```go
// O(n) per query
type Tracker struct {
    values []int
}

func (t *Tracker) Add(val int) {
    t.values = append(t.values, val)
}

func (t *Tracker) Max() int {
    max := t.values[0]
    for _, v := range t.values[1:] {
        if v > max {
            max = v
        }
    }
    return max
}
```

### Go -- After

```go
// O(1) per query -- maintain running max
type Tracker struct {
    values []int
    maxVal int
}

func NewTracker() *Tracker {
    return &Tracker{maxVal: math.MinInt64}
}

func (t *Tracker) Add(val int) {
    t.values = append(t.values, val)
    if val > t.maxVal {
        t.maxVal = val
    }
}

func (t *Tracker) Max() int {
    return t.maxVal // O(1)
}
```

### Java -- Before

```java
// O(n) per query
class Tracker {
    List<Integer> values = new ArrayList<>();
    void add(int val) { values.add(val); }
    int max() { return Collections.max(values); }
}
```

### Java -- After

```java
// O(1) per query
class Tracker {
    List<Integer> values = new ArrayList<>();
    int maxVal = Integer.MIN_VALUE;
    void add(int val) {
        values.add(val);
        if (val > maxVal) maxVal = val;
    }
    int max() { return maxVal; } // O(1)
}
```

### Python -- Before

```python
# O(n) per query
class Tracker:
    def __init__(self):
        self.values = []
    def add(self, val):
        self.values.append(val)
    def max(self):
        return max(self.values)  # O(n)
```

### Python -- After

```python
# O(1) per query
class Tracker:
    def __init__(self):
        self.values = []
        self.max_val = float('-inf')
    def add(self, val):
        self.values.append(val)
        if val > self.max_val:
            self.max_val = val
    def get_max(self):
        return self.max_val  # O(1)
```

---

## Exercise 5: Anagram Check -- O(n log n) to O(n)

**Before:** Sort both strings and compare.

### Go -- Before

```go
// O(n log n) due to sorting
func isAnagram(s1, s2 string) bool {
    a := []byte(s1)
    b := []byte(s2)
    sort.Slice(a, func(i, j int) bool { return a[i] < a[j] })
    sort.Slice(b, func(i, j int) bool { return b[i] < b[j] })
    return string(a) == string(b)
}
```

### Go -- After

```go
// O(n) -- use frequency counting with O(1) array access
func isAnagram(s1, s2 string) bool {
    if len(s1) != len(s2) {
        return false
    }
    var freq [26]int
    for i := 0; i < len(s1); i++ {
        freq[s1[i]-'a']++ // O(1) array access
        freq[s2[i]-'a']-- // O(1) array access
    }
    for _, f := range freq {
        if f != 0 {
            return false
        }
    }
    return true
}
```

### Java -- Before

```java
// O(n log n)
static boolean isAnagram(String s1, String s2) {
    char[] a = s1.toCharArray(), b = s2.toCharArray();
    Arrays.sort(a); Arrays.sort(b);
    return Arrays.equals(a, b);
}
```

### Java -- After

```java
// O(n) -- frequency array with O(1) access
static boolean isAnagram(String s1, String s2) {
    if (s1.length() != s2.length()) return false;
    int[] freq = new int[26];
    for (int i = 0; i < s1.length(); i++) {
        freq[s1.charAt(i) - 'a']++;
        freq[s2.charAt(i) - 'a']--;
    }
    for (int f : freq) if (f != 0) return false;
    return true;
}
```

### Python -- Before

```python
# O(n log n)
def is_anagram(s1, s2):
    return sorted(s1) == sorted(s2)
```

### Python -- After

```python
from collections import Counter

# O(n) -- Counter uses O(1) hash map operations
def is_anagram(s1, s2):
    return Counter(s1) == Counter(s2)
```

---

## Exercise 6: Fibonacci Nth Term -- O(n) to O(1)

**Before:** Compute iteratively.

### Go -- Before

```go
// O(n) iterative
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

### Go -- After

```go
// O(1) using Binet's formula (approximate for large n due to floating point)
func fibonacci(n int) int {
    phi := (1 + math.Sqrt(5)) / 2
    psi := (1 - math.Sqrt(5)) / 2
    return int(math.Round((math.Pow(phi, float64(n)) - math.Pow(psi, float64(n))) / math.Sqrt(5)))
}
// Note: This is O(1) for fixed-precision floating point.
// For exact results with large n, the matrix exponentiation method is O(log n).
```

### Java -- After

```java
// O(1) using Binet's formula
static long fibonacci(int n) {
    double phi = (1 + Math.sqrt(5)) / 2;
    double psi = (1 - Math.sqrt(5)) / 2;
    return Math.round((Math.pow(phi, n) - Math.pow(psi, n)) / Math.sqrt(5));
}
```

### Python -- After

```python
import math

# O(1) using Binet's formula (approximate for large n)
def fibonacci(n):
    phi = (1 + math.sqrt(5)) / 2
    psi = (1 - math.sqrt(5)) / 2
    return round((phi**n - psi**n) / math.sqrt(5))
```

---

## Exercise 7: Stack getMin -- O(n) to O(1)

**Before:** Scan the entire stack to find the minimum.

### Go -- Before

```go
// O(n) per getMin call
type Stack struct {
    data []int
}

func (s *Stack) GetMin() int {
    min := s.data[0]
    for _, v := range s.data[1:] {
        if v < min {
            min = v
        }
    }
    return min
}
```

### Go -- After

```go
// O(1) per getMin call -- auxiliary min stack
type MinStack struct {
    data []int
    mins []int
}

func (s *MinStack) Push(val int) {
    s.data = append(s.data, val)
    if len(s.mins) == 0 || val <= s.mins[len(s.mins)-1] {
        s.mins = append(s.mins, val)
    }
}

func (s *MinStack) Pop() int {
    top := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    if top == s.mins[len(s.mins)-1] {
        s.mins = s.mins[:len(s.mins)-1]
    }
    return top
}

func (s *MinStack) GetMin() int {
    return s.mins[len(s.mins)-1] // O(1)
}
```

### Java -- After

```java
class MinStack {
    private Stack<Integer> data = new Stack<>();
    private Stack<Integer> mins = new Stack<>();

    void push(int val) {
        data.push(val);
        if (mins.isEmpty() || val <= mins.peek()) mins.push(val);
    }

    int pop() {
        int top = data.pop();
        if (top == mins.peek()) mins.pop();
        return top;
    }

    int getMin() { return mins.peek(); } // O(1)
}
```

### Python -- After

```python
class MinStack:
    def __init__(self):
        self.data = []
        self.mins = []

    def push(self, val):
        self.data.append(val)
        if not self.mins or val <= self.mins[-1]:
            self.mins.append(val)

    def pop(self):
        top = self.data.pop()
        if top == self.mins[-1]:
            self.mins.pop()
        return top

    def get_min(self):
        return self.mins[-1]  # O(1)
```

---

## Exercise 8: Remove Last Element -- O(n) to O(1)

**Before:** Linked list traversal to find the node before the last.

### Go -- Before

```go
// O(n) -- must traverse to find second-to-last node
func removeLast(head *Node) *Node {
    if head == nil || head.Next == nil {
        return nil
    }
    current := head
    for current.Next.Next != nil {
        current = current.Next
    }
    current.Next = nil
    return head
}
```

### Go -- After

```go
// O(1) -- use a doubly-linked list with tail pointer
type DNode struct {
    Value      int
    Prev, Next *DNode
}

type DoublyLinkedList struct {
    Head, Tail *DNode
    Size       int
}

func (dll *DoublyLinkedList) RemoveLast() *DNode {
    if dll.Tail == nil {
        return nil
    }
    removed := dll.Tail
    dll.Tail = removed.Prev
    if dll.Tail != nil {
        dll.Tail.Next = nil
    } else {
        dll.Head = nil
    }
    dll.Size--
    return removed // O(1)
}
```

### Java -- After

```java
// O(1) -- use LinkedList which is doubly-linked with tail pointer
LinkedList<Integer> list = new LinkedList<>();
list.removeLast(); // O(1) because Java's LinkedList is doubly-linked
```

### Python -- After

```python
from collections import deque

# O(1) -- deque has O(1) removal from both ends
d = deque([1, 2, 3, 4, 5])
d.pop()  # O(1) -- removes from right end
```

---

## Exercise 9: Check Balanced Parentheses at Position -- O(n) to O(1)

**Before:** Recompute running balance up to position `i` each time.

### Go -- Before

```go
// O(n) per query -- recalculates balance each time
func balanceAt(s string, pos int) int {
    balance := 0
    for i := 0; i <= pos; i++ {
        if s[i] == '(' {
            balance++
        } else {
            balance--
        }
    }
    return balance
}
```

### Go -- After

```go
// O(1) per query -- precompute prefix sums
func precomputeBalance(s string) []int {
    prefix := make([]int, len(s)+1)
    for i, c := range s {
        if c == '(' {
            prefix[i+1] = prefix[i] + 1
        } else {
            prefix[i+1] = prefix[i] - 1
        }
    }
    return prefix
}

// O(1) lookup
func balanceAt(prefix []int, pos int) int {
    return prefix[pos+1]
}
```

### Java -- After

```java
// O(1) per query -- precompute prefix sums
int[] precompute(String s) {
    int[] prefix = new int[s.length() + 1];
    for (int i = 0; i < s.length(); i++) {
        prefix[i + 1] = prefix[i] + (s.charAt(i) == '(' ? 1 : -1);
    }
    return prefix;
}
// balanceAt(pos) = prefix[pos + 1]  -- O(1)
```

### Python -- After

```python
# O(1) per query -- precompute prefix sums
def precompute_balance(s):
    prefix = [0] * (len(s) + 1)
    for i, c in enumerate(s):
        prefix[i + 1] = prefix[i] + (1 if c == '(' else -1)
    return prefix

# balance_at(pos) = prefix[pos + 1]  -- O(1)
```

---

## Exercise 10: Range Sum Query -- O(n) to O(1)

**Before:** Sum a subarray by iterating through it each time.

### Go -- Before

```go
// O(n) per query
func rangeSum(arr []int, left, right int) int {
    sum := 0
    for i := left; i <= right; i++ {
        sum += arr[i]
    }
    return sum
}
```

### Go -- After

```go
// O(1) per query -- prefix sum array
func buildPrefixSum(arr []int) []int {
    prefix := make([]int, len(arr)+1)
    for i, v := range arr {
        prefix[i+1] = prefix[i] + v
    }
    return prefix
}

// O(1) range sum query
func rangeSum(prefix []int, left, right int) int {
    return prefix[right+1] - prefix[left]
}
```

### Java -- Before

```java
// O(n) per query
static int rangeSum(int[] arr, int left, int right) {
    int sum = 0;
    for (int i = left; i <= right; i++) sum += arr[i];
    return sum;
}
```

### Java -- After

```java
// O(1) per query -- prefix sum
int[] prefix = new int[arr.length + 1];
for (int i = 0; i < arr.length; i++) prefix[i + 1] = prefix[i] + arr[i];
// rangeSum(left, right) = prefix[right + 1] - prefix[left]
```

### Python -- Before

```python
# O(n) per query
def range_sum(arr, left, right):
    return sum(arr[left:right + 1])
```

### Python -- After

```python
from itertools import accumulate

# O(n) precomputation, O(1) per query
prefix = [0] + list(accumulate(arr))

def range_sum(left, right):
    return prefix[right + 1] - prefix[left]
```

---

## Exercise 11: Detect Duplicate -- O(n log n) to O(n)

**Before:** Sort and check adjacent elements.

### Python -- Before

```python
# O(n log n)
def has_duplicate(arr):
    arr.sort()
    for i in range(1, len(arr)):
        if arr[i] == arr[i - 1]:
            return True
    return False
```

### Python -- After

```python
# O(n) -- set construction with O(1) membership
def has_duplicate(arr):
    seen = set()
    for v in arr:
        if v in seen:
            return True
        seen.add(v)
    return False

# Or even simpler:
def has_duplicate(arr):
    return len(arr) != len(set(arr))
```

### Go -- After

```go
func hasDuplicate(arr []int) bool {
    seen := make(map[int]bool)
    for _, v := range arr {
        if seen[v] {
            return true
        }
        seen[v] = true
    }
    return false
}
```

### Java -- After

```java
static boolean hasDuplicate(int[] arr) {
    Set<Integer> seen = new HashSet<>();
    for (int v : arr) {
        if (!seen.add(v)) return true; // add returns false if already present
    }
    return false;
}
```

---

## Exercise 12: Matrix Diagonal Sum -- O(n) Already, But Access is O(1)

**Before:** Using a 2D list of lists where row access may cache-miss.

### Python -- Before

```python
# O(n) with potentially poor cache behavior for large n
def diagonal_sum(matrix, n):
    total = 0
    for i in range(n):
        total += matrix[i][i]  # Row access then column access
    return total
```

### Python -- After

```python
# O(n) but stored as 1D array for better cache behavior
# matrix[i][j] = flat[i * n + j]  -- O(1) access with better locality
def diagonal_sum(flat, n):
    total = 0
    for i in range(n):
        total += flat[i * n + i]  # Single O(1) access, contiguous memory
    return total
```

This optimization does not change the asymptotic complexity (still O(n) for the loop)
but the O(1) access pattern is more cache-friendly with a flat array layout.
