# Constant Time O(1) -- Find the Bug

## Instructions

Each exercise contains code that **claims** to be O(1) but actually has a hidden
complexity issue (O(n), O(n^2), etc.). Your job is to:

1. Identify the bug that makes the code NOT O(1).
2. Explain what the actual complexity is.
3. Fix the code to make it truly O(1) (if possible).

---

## Exercise 1: "O(1) Array Contains"

**Claim:** This function checks if an element exists in O(1) time.

### Go

```go
// BUG: Claims O(1) but is actually O(n)
func contains(arr []int, target int) bool {
    for _, v := range arr {
        if v == target {
            return true
        }
    }
    return false
}
```

### Java

```java
// BUG: Claims O(1) but is actually O(n)
static boolean contains(int[] arr, int target) {
    for (int v : arr) {
        if (v == target) return true;
    }
    return false;
}
```

### Python

```python
# BUG: Claims O(1) but is actually O(n)
def contains(arr, target):
    for v in arr:
        if v == target:
            return True
    return False
```

**Bug:** Linear scan through the entire array is O(n), not O(1). The loop iterates up
to `n` times. **Fix:** Use a hash set for O(1) average lookup: `target in set(arr)`.
Note that building the set is O(n), but once built, each lookup is O(1).

---

## Exercise 2: "O(1) String Comparison"

**Claim:** Comparing two strings is O(1).

### Go

```go
// BUG: Claims O(1) but is actually O(n)
func isEqual(a, b string) bool {
    if len(a) != len(b) {
        return false
    }
    for i := range a {
        if a[i] != b[i] {
            return false
        }
    }
    return true
}
```

### Java

```java
// BUG: Claims O(1) but is actually O(n)
static boolean isEqual(String a, String b) {
    return a.equals(b); // equals() compares character by character
}
```

### Python

```python
# BUG: Claims O(1) but is actually O(n)
def is_equal(a, b):
    return a == b  # Compares character by character
```

**Bug:** String comparison is O(k) where k is the length of the strings. In the worst
case (equal strings or strings that differ only in the last character), every character
must be compared. **Fix:** There is no general O(1) fix for string equality. If you
need O(1), precompute hashes and compare hashes (with collision risk). The length check
`len(a) != len(b)` is O(1) and can short-circuit some comparisons.

---

## Exercise 3: "O(1) List Removal by Value"

**Claim:** Removing an element from a list by value is O(1).

### Go

```go
// BUG: Claims O(1) but is actually O(n)
func removeValue(arr []int, val int) []int {
    for i, v := range arr {
        if v == val {
            return append(arr[:i], arr[i+1:]...)
        }
    }
    return arr
}
```

### Java

```java
// BUG: Claims O(1) but is actually O(n)
static void removeValue(ArrayList<Integer> list, int val) {
    list.remove(Integer.valueOf(val));
}
```

### Python

```python
# BUG: Claims O(1) but is actually O(n)
def remove_value(arr, val):
    arr.remove(val)
```

**Bug:** Two O(n) operations hidden here: (1) finding the element requires linear search
O(n), and (2) removing from the middle requires shifting all subsequent elements O(n).
Total: O(n). **Fix:** Use a hash set if you only need membership, or use the swap-with-last
trick (swap the target with the last element, then pop) for O(1) removal when order
does not matter -- but you still need O(1) lookup to find the element's index.

---

## Exercise 4: "O(1) Stack with Size Tracking"

**Claim:** Getting the size of this custom stack is O(1).

### Go

```go
type BadStack struct {
    data []int
}

// BUG: Claims O(1) but is actually O(n)
func (s *BadStack) Size() int {
    count := 0
    for range s.data {
        count++
    }
    return count
}
```

### Java

```java
class BadStack {
    private LinkedList<Integer> data = new LinkedList<>();

    // BUG: Claims O(1) but is actually O(n) for some implementations
    int size() {
        int count = 0;
        for (int ignored : data) count++;
        return count;
    }
}
```

### Python

```python
class BadStack:
    def __init__(self):
        self.data = []

    # BUG: Claims O(1) but manually counts -- O(n)
    def size(self):
        count = 0
        for _ in self.data:
            count += 1
        return count
```

**Bug:** Manually iterating to count elements is O(n). **Fix:** Maintain a `size` field
that increments on push and decrements on pop, or simply use the built-in `len()`
function which is O(1) for all standard collections.

---

## Exercise 5: "O(1) Hash Map with String Keys"

**Claim:** This hash map lookup is O(1).

### Go

```go
// BUG: Ignores the cost of hashing a long string
func lookup(m map[string]int, key string) int {
    // "O(1)" lookup -- but the key could be 1 million characters long
    return m[key]
}

func main() {
    m := make(map[string]int)
    longKey := strings.Repeat("a", 1_000_000)
    m[longKey] = 42
    fmt.Println(lookup(m, longKey))
}
```

### Java

```java
// BUG: Ignores the cost of hashing a long string
static int lookup(HashMap<String, Integer> m, String key) {
    return m.get(key); // hashCode() is O(k) for string of length k
}
```

### Python

```python
# BUG: Ignores the cost of hashing a long string
def lookup(m, key):
    return m[key]  # hash(key) is O(k) for string of length k

long_key = "a" * 1_000_000
m = {long_key: 42}
print(lookup(m, long_key))
```

**Bug:** Hash map lookup is O(1) assuming the hash computation is O(1). But hashing a
string of length `k` is O(k). For very long strings, the hash computation dominates.
**Fix:** If keys are long strings, precompute and cache their hashes. In Java,
`String.hashCode()` is cached after the first call. In Python, string hashes are also
cached (strings are immutable).

---

## Exercise 6: "O(1) Deduplication"

**Claim:** This function deduplicates an array in O(1).

### Go

```go
// BUG: Claims O(1) but is actually O(n^2)
func deduplicate(arr []int) []int {
    result := []int{}
    for _, v := range arr {
        found := false
        for _, r := range result {
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

### Java

```java
// BUG: Claims O(1) but is actually O(n^2)
static List<Integer> deduplicate(int[] arr) {
    List<Integer> result = new ArrayList<>();
    for (int v : arr) {
        if (!result.contains(v)) { // contains() is O(n) on ArrayList!
            result.add(v);
        }
    }
    return result;
}
```

### Python

```python
# BUG: Claims O(1) but is actually O(n^2)
def deduplicate(arr):
    result = []
    for v in arr:
        if v not in result:  # 'in' on a list is O(n)!
            result.append(v)
    return result
```

**Bug:** The inner check (`v in result`) is O(n) on a list, making the overall algorithm
O(n^2). **Fix:** Use a hash set for O(1) membership checks:

```python
def deduplicate(arr):
    seen = set()
    result = []
    for v in arr:
        if v not in seen:  # O(1) with set
            seen.add(v)
            result.append(v)
    return result
```

---

## Exercise 7: "O(1) Copy"

**Claim:** This copies an array in O(1).

### Go

```go
// BUG: Claims O(1) but is actually O(n)
func copyArray(src []int) []int {
    dst := make([]int, len(src))
    copy(dst, src) // copy() copies each element -- O(n)
    return dst
}
```

### Java

```java
// BUG: Claims O(1) but is actually O(n)
static int[] copyArray(int[] src) {
    return Arrays.copyOf(src, src.length); // Copies each element -- O(n)
}
```

### Python

```python
# BUG: Claims O(1) but is actually O(n)
def copy_array(src):
    return src[:]  # Slice copy copies each element -- O(n)
```

**Bug:** Copying `n` elements requires visiting each one, so it is O(n), not O(1).
**Fix:** There is no O(1) way to create a true deep copy of an array. If you need O(1),
use a reference (shallow assignment) -- but then mutations affect the original. For
immutable-style O(1) "copies," consider persistent data structures or copy-on-write.

---

## Exercise 8: "O(1) Linked List Length"

**Claim:** Getting the length of a linked list is O(1).

### Go

```go
type Node struct {
    Value int
    Next  *Node
}

// BUG: Claims O(1) but is actually O(n)
func length(head *Node) int {
    count := 0
    current := head
    for current != nil {
        count++
        current = current.Next
    }
    return count
}
```

### Java

```java
class Node {
    int value;
    Node next;
}

// BUG: Claims O(1) but is actually O(n)
static int length(Node head) {
    int count = 0;
    Node current = head;
    while (current != null) {
        count++;
        current = current.next;
    }
    return count;
}
```

### Python

```python
class Node:
    def __init__(self, value, next_node=None):
        self.value = value
        self.next = next_node

# BUG: Claims O(1) but is actually O(n)
def length(head):
    count = 0
    current = head
    while current:
        count += 1
        current = current.next
    return count
```

**Bug:** Traversing the entire linked list to count nodes is O(n). **Fix:** Maintain a
`size` field in a wrapper class that increments/decrements on insert/delete. Then
`getSize()` is O(1).

---

## Exercise 9: "O(1) Flatten Nested List"

**Claim:** Accessing elements of a "flattened" nested list is O(1).

### Python

```python
# BUG: Claims O(1) access but flatten() itself is O(n)
class FlatList:
    def __init__(self, nested):
        self.data = []
        self._flatten(nested)  # O(n) -- visits every element!

    def _flatten(self, lst):
        for item in lst:
            if isinstance(item, list):
                self._flatten(item)
            else:
                self.data.append(item)

    def get(self, index):
        return self.data[index]  # O(1) -- but construction was O(n)
```

### Go

```go
// BUG: Claims O(1) but flatten is O(n)
func flatten(nested []interface{}) []int {
    result := []int{}
    for _, item := range nested {
        switch v := item.(type) {
        case int:
            result = append(result, v)
        case []interface{}:
            result = append(result, flatten(v)...)
        }
    }
    return result
}
// After flattening, arr[i] is O(1), but the setup is O(n).
```

### Java

```java
// BUG: Claims O(1) but flatten is O(n)
static List<Integer> flatten(List<Object> nested) {
    List<Integer> result = new ArrayList<>();
    for (Object item : nested) {
        if (item instanceof List) {
            result.addAll(flatten((List<Object>) item));
        } else {
            result.add((Integer) item);
        }
    }
    return result;
}
```

**Bug:** The claim "O(1) access" is misleading. While `get(i)` is O(1) after
construction, the construction itself is O(n). The total work is O(n) + O(1) per access.
This is fine if you access many times, but calling it "O(1)" hides the setup cost.
**Fix:** Be honest about the complexity: "O(n) construction, O(1) per access."

---

## Exercise 10: "O(1) Max of Array"

**Claim:** This function returns the maximum in O(1) time.

### Go

```go
// BUG: Claims O(1) but is actually O(n)
func maxElement(arr []int) int {
    max := arr[0]
    for _, v := range arr[1:] {
        if v > max {
            max = v
        }
    }
    return max
}
```

### Java

```java
// BUG: Claims O(1) but is actually O(n)
static int maxElement(int[] arr) {
    int max = arr[0];
    for (int i = 1; i < arr.length; i++) {
        if (arr[i] > max) max = arr[i];
    }
    return max;
}
```

### Python

```python
# BUG: Claims O(1) but is actually O(n)
def max_element(arr):
    return max(arr)  # max() iterates through entire array -- O(n)
```

**Bug:** Finding the maximum of an unsorted collection requires examining every element,
which is O(n). **Fix:** If you need O(1) max, maintain a separate variable that tracks
the maximum as elements are inserted (like a max-heap or the MinStack pattern from the
tasks). The `max()` built-in hides the O(n) traversal.

---

## Exercise 11: "O(1) Dictionary Merge"

**Claim:** Merging two dictionaries is O(1).

### Python

```python
# BUG: Claims O(1) but is actually O(n + m)
def merge_dicts(a, b):
    return {**a, **b}  # Creates new dict, copies all entries
```

### Go

```go
// BUG: Claims O(1) but is actually O(n + m)
func mergeMaps(a, b map[string]int) map[string]int {
    result := make(map[string]int)
    for k, v := range a {
        result[k] = v
    }
    for k, v := range b {
        result[k] = v
    }
    return result
}
```

### Java

```java
// BUG: Claims O(1) but is actually O(n + m)
static Map<String, Integer> mergeMaps(Map<String, Integer> a, Map<String, Integer> b) {
    Map<String, Integer> result = new HashMap<>(a);
    result.putAll(b);
    return result;
}
```

**Bug:** Merging copies all entries from both maps: O(|a| + |b|). **Fix:** There is no
general O(1) merge. If you need O(1), use a layered/chained map that defers to the
underlying maps on lookup (lazy merge). But each lookup then checks multiple maps.

---

## Exercise 12: "O(1) Slice Reversal"

**Claim:** Reversing a slice is O(1) because it is "just swapping pointers."

### Go

```go
// BUG: Claims O(1) but is actually O(n)
func reverse(arr []int) {
    for i, j := 0, len(arr)-1; i < j; i, j = i+1, j-1 {
        arr[i], arr[j] = arr[j], arr[i] // O(1) per swap, but n/2 swaps
    }
}
```

### Java

```java
// BUG: Claims O(1) but is actually O(n)
static void reverse(int[] arr) {
    for (int i = 0, j = arr.length - 1; i < j; i++, j--) {
        int temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
}
```

### Python

```python
# BUG: Claims O(1) but is actually O(n)
def reverse(arr):
    arr.reverse()  # Swaps n/2 pairs -- O(n)
```

**Bug:** Reversing requires n/2 swaps, each O(1), for a total of O(n). **Fix:** If you
need O(1) "reversal," use a direction flag and adjust indexing:
`arr[i]` becomes `arr[n-1-i]` when reversed. This is a logical reversal without moving
data.
