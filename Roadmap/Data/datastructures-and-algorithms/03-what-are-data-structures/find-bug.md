# What are Data Structures? — Find the Bug

## Table of Contents

1. [How to Use This File](#how-to-use-this-file)
2. [Bug 1: Off-by-One Array Access](#bug-1-off-by-one-array-access)
3. [Bug 2: Null Pointer on Empty List](#bug-2-null-pointer-on-empty-list)
4. [Bug 3: Stack Overflow in Recursion](#bug-3-stack-overflow-in-recursion)
5. [Bug 4: Queue Underflow](#bug-4-queue-underflow)
6. [Bug 5: Wrong Collision Handling in Hash Table](#bug-5-wrong-collision-handling-in-hash-table)
7. [Bug 6: Modifying Collection While Iterating](#bug-6-modifying-collection-while-iterating)
8. [Bug 7: Memory Leak in Linked List](#bug-7-memory-leak-in-linked-list)
9. [Bug 8: Incorrect Linked List Insertion](#bug-8-incorrect-linked-list-insertion)
10. [Bug 9: Binary Search Bounds Error](#bug-9-binary-search-bounds-error)
11. [Bug 10: Mutable Hash Key](#bug-10-mutable-hash-key)
12. [Bug 11: Circular Reference in Linked List](#bug-11-circular-reference-in-linked-list)
13. [Bug 12: Parentheses Checker Edge Case](#bug-12-parentheses-checker-edge-case)

---

## How to Use This File

Each exercise contains **buggy code** in Go, Java, and Python. Your job:

1. **Read the code** and the description of what it should do.
2. **Find the bug** without running the code.
3. **Explain** what goes wrong and under what conditions.
4. **Fix it** — the corrected version is in the "Fix" section (hidden below the buggy code).

Try to find the bug yourself before reading the fix.

---

## Bug 1: Off-by-One Array Access

**Description:** A function that finds the maximum value in an array. It crashes or returns the wrong result.

### Go (Buggy):

```go
func findMax(arr []int) int {
    max := arr[0]
    for i := 1; i <= len(arr); i++ { // BUG
        if arr[i] > max {
            max = arr[i]
        }
    }
    return max
}
```

### Java (Buggy):

```java
public static int findMax(int[] arr) {
    int max = arr[0];
    for (int i = 1; i <= arr.length; i++) { // BUG
        if (arr[i] > max) {
            max = arr[i];
        }
    }
    return max;
}
```

### Python (Buggy):

```python
def find_max(arr):
    max_val = arr[0]
    for i in range(1, len(arr) + 1):  # BUG
        if arr[i] > max_val:
            max_val = arr[i]
    return max_val
```

### What Goes Wrong

The loop condition uses `<=` (or `len(arr) + 1` in Python) instead of `<`. When `i` equals `len(arr)`, it accesses one element past the end of the array. In Go, this causes an index-out-of-range panic. In Java, an `ArrayIndexOutOfBoundsException`. In Python, an `IndexError`.

### Fix

Change the loop bound to `< len(arr)`:

**Go:**
```go
for i := 1; i < len(arr); i++ {
```

**Java:**
```java
for (int i = 1; i < arr.length; i++) {
```

**Python:**
```python
for i in range(1, len(arr)):
```

### Additional Bug: Empty Array

The code also crashes on an empty array because `arr[0]` fails. Add a guard:

```go
if len(arr) == 0 {
    return 0, errors.New("empty array")
}
```

---

## Bug 2: Null Pointer on Empty List

**Description:** A linked list's `pop_front` method that crashes when the list is empty.

### Go (Buggy):

```go
func (ll *LinkedList) PopFront() int {
    val := ll.Head.Val   // BUG: Head may be nil
    ll.Head = ll.Head.Next
    ll.Count--
    return val
}
```

### Java (Buggy):

```java
public int popFront() {
    int val = head.val;    // BUG: head may be null
    head = head.next;
    count--;
    return val;
}
```

### Python (Buggy):

```python
def pop_front(self):
    val = self.head.val    # BUG: head may be None
    self.head = self.head.next
    self.count -= 1
    return val
```

### What Goes Wrong

If the list is empty, `head` is `nil`/`null`/`None`. Accessing `.Val` on a nil pointer causes a nil pointer dereference (Go), `NullPointerException` (Java), or `AttributeError` (Python).

### Fix

Check for empty list before accessing head:

**Go:**
```go
func (ll *LinkedList) PopFront() (int, error) {
    if ll.Head == nil {
        return 0, errors.New("list is empty")
    }
    val := ll.Head.Val
    ll.Head = ll.Head.Next
    ll.Count--
    if ll.Count == 0 {
        ll.Tail = nil
    }
    return val, nil
}
```

**Java:**
```java
public int popFront() {
    if (head == null) {
        throw new NoSuchElementException("list is empty");
    }
    int val = head.val;
    head = head.next;
    count--;
    if (count == 0) tail = null;
    return val;
}
```

**Python:**
```python
def pop_front(self):
    if self.head is None:
        raise IndexError("list is empty")
    val = self.head.val
    self.head = self.head.next
    self.count -= 1
    if self.count == 0:
        self.tail = None
    return val
```

---

## Bug 3: Stack Overflow in Recursion

**Description:** A recursive function to compute the sum of a linked list. It works for small lists but crashes on large ones.

### Go (Buggy):

```go
func sumList(node *Node) int {
    if node == nil {
        return 0
    }
    return node.Val + sumList(node.Next) // BUG: no tail call optimization
}
```

### Java (Buggy):

```java
public static int sumList(Node node) {
    if (node == null) return 0;
    return node.val + sumList(node.next); // BUG: stack overflow on large lists
}
```

### Python (Buggy):

```python
def sum_list(node):
    if node is None:
        return 0
    return node.val + sum_list(node.next)  # BUG: RecursionError for large lists
```

### What Goes Wrong

Each recursive call adds a frame to the call stack. For a list with 100,000 nodes, this creates 100,000 stack frames. Go and Java will eventually get a stack overflow. Python has a default recursion limit of 1,000 and will raise `RecursionError`.

### Fix

Use an iterative approach:

**Go:**
```go
func sumList(head *Node) int {
    total := 0
    for node := head; node != nil; node = node.Next {
        total += node.Val
    }
    return total
}
```

**Java:**
```java
public static int sumList(Node node) {
    int total = 0;
    while (node != null) {
        total += node.val;
        node = node.next;
    }
    return total;
}
```

**Python:**
```python
def sum_list(node):
    total = 0
    while node is not None:
        total += node.val
        node = node.next
    return total
```

---

## Bug 4: Queue Underflow

**Description:** A circular queue that returns garbage data when dequeuing from an empty queue.

### Go (Buggy):

```go
func (q *CircularQueue) Dequeue() int {
    val := q.data[q.head]  // BUG: no empty check
    q.head = (q.head + 1) % q.capacity
    q.count--               // BUG: count goes negative
    return val
}
```

### Java (Buggy):

```java
public int dequeue() {
    int val = data[head];   // BUG: no empty check
    head = (head + 1) % capacity;
    count--;                // BUG: count goes negative
    return val;
}
```

### Python (Buggy):

```python
def dequeue(self):
    val = self._data[self._head]  # BUG: no empty check
    self._head = (self._head + 1) % self._capacity
    self._count -= 1              # BUG: count goes negative
    return val
```

### What Goes Wrong

When the queue is empty, `count` is 0. Dequeuing reads stale data from the array (whatever was left there from a previous enqueue) and decrements `count` to -1. Subsequent operations produce corrupt behavior: the queue thinks it has negative elements.

### Fix

Check for empty before dequeuing:

**Go:**
```go
func (q *CircularQueue) Dequeue() (int, error) {
    if q.count == 0 {
        return 0, errors.New("queue is empty")
    }
    val := q.data[q.head]
    q.head = (q.head + 1) % q.capacity
    q.count--
    return val, nil
}
```

**Java:**
```java
public int dequeue() {
    if (count == 0) {
        throw new NoSuchElementException("queue is empty");
    }
    int val = data[head];
    head = (head + 1) % capacity;
    count--;
    return val;
}
```

**Python:**
```python
def dequeue(self):
    if self._count == 0:
        raise IndexError("queue is empty")
    val = self._data[self._head]
    self._head = (self._head + 1) % self._capacity
    self._count -= 1
    return val
```

---

## Bug 5: Wrong Collision Handling in Hash Table

**Description:** A hash table with separate chaining that fails to update existing keys.

### Go (Buggy):

```go
func (ht *HashTable) Put(key string, value int) {
    idx := ht.hash(key)
    newEntry := &Entry{Key: key, Value: value, Next: ht.buckets[idx]}
    ht.buckets[idx] = newEntry // BUG: always prepends, never updates existing
    ht.size++
}
```

### Java (Buggy):

```java
public void put(String key, int value) {
    int idx = hash(key);
    Entry newEntry = new Entry(key, value);
    newEntry.next = buckets[idx];
    buckets[idx] = newEntry; // BUG: always prepends
    size++;
}
```

### Python (Buggy):

```python
def put(self, key, value):
    idx = self._hash(key)
    self._buckets[idx].append((key, value))  # BUG: always appends
    self._size += 1
```

### What Goes Wrong

If you `put("alice", 1)` then `put("alice", 2)`, the table now has two entries for "alice". The `size` is incremented twice. When you `get("alice")`, you find the first occurrence (value 2), but the stale entry (value 1) wastes memory and causes `size` to be wrong.

### Fix

Walk the chain first. If the key exists, update its value:

**Go:**
```go
func (ht *HashTable) Put(key string, value int) {
    idx := ht.hash(key)
    // Check if key already exists
    for entry := ht.buckets[idx]; entry != nil; entry = entry.Next {
        if entry.Key == key {
            entry.Value = value // Update existing
            return
        }
    }
    // Key not found, prepend new entry
    newEntry := &Entry{Key: key, Value: value, Next: ht.buckets[idx]}
    ht.buckets[idx] = newEntry
    ht.size++
}
```

**Java:**
```java
public void put(String key, int value) {
    int idx = hash(key);
    for (Entry e = buckets[idx]; e != null; e = e.next) {
        if (e.key.equals(key)) {
            e.value = value;
            return;
        }
    }
    Entry newEntry = new Entry(key, value);
    newEntry.next = buckets[idx];
    buckets[idx] = newEntry;
    size++;
}
```

**Python:**
```python
def put(self, key, value):
    idx = self._hash(key)
    for i, (k, v) in enumerate(self._buckets[idx]):
        if k == key:
            self._buckets[idx][i] = (key, value)
            return
    self._buckets[idx].append((key, value))
    self._size += 1
```

---

## Bug 6: Modifying Collection While Iterating

**Description:** Code that removes even numbers from a list while iterating over it.

### Go (Buggy):

```go
func removeEvens(nums []int) []int {
    for i := 0; i < len(nums); i++ {
        if nums[i]%2 == 0 {
            nums = append(nums[:i], nums[i+1:]...) // BUG: skips next element
        }
    }
    return nums
}
```

### Java (Buggy):

```java
public static List<Integer> removeEvens(List<Integer> nums) {
    for (int i = 0; i < nums.size(); i++) {
        if (nums.get(i) % 2 == 0) {
            nums.remove(i); // BUG: skips next element after removal
        }
    }
    return nums;
}
```

### Python (Buggy):

```python
def remove_evens(nums):
    for num in nums:
        if num % 2 == 0:
            nums.remove(num)  # BUG: modifying list during iteration
    return nums
```

### What Goes Wrong

**Go/Java:** After removing element at index `i`, all subsequent elements shift left. The loop increments `i`, so the element that moved into position `i` is never checked. Input `[2, 4, 6]` gives `[4]` instead of `[]`.

**Python:** Modifying a list during iteration causes unpredictable behavior. The iterator's internal index gets out of sync with the list contents. Some elements are skipped.

### Fix

**Option 1: Iterate backwards:**

**Go:**
```go
func removeEvens(nums []int) []int {
    for i := len(nums) - 1; i >= 0; i-- {
        if nums[i]%2 == 0 {
            nums = append(nums[:i], nums[i+1:]...)
        }
    }
    return nums
}
```

**Java:**
```java
public static List<Integer> removeEvens(List<Integer> nums) {
    for (int i = nums.size() - 1; i >= 0; i--) {
        if (nums.get(i) % 2 == 0) {
            nums.remove(i);
        }
    }
    return nums;
}
```

**Option 2: Build a new list (recommended):**

**Python:**
```python
def remove_evens(nums):
    return [num for num in nums if num % 2 != 0]
```

---

## Bug 7: Memory Leak in Linked List

**Description:** A linked list delete function that leaves orphaned nodes.

### Go (Buggy):

```go
func (ll *LinkedList) DeleteAt(index int) {
    if index == 0 {
        ll.Head = ll.Head.Next
        ll.Count--
        return
    }
    curr := ll.Head
    for i := 0; i < index-1; i++ {
        curr = curr.Next
    }
    curr.Next = curr.Next.Next // BUG: doesn't update Tail if deleting last node
    ll.Count--
}
```

### Java (Buggy):

```java
public void deleteAt(int index) {
    if (index == 0) {
        head = head.next;
        count--;
        return;
    }
    Node curr = head;
    for (int i = 0; i < index - 1; i++) {
        curr = curr.next;
    }
    curr.next = curr.next.next; // BUG: tail not updated
    count--;
}
```

### Python (Buggy):

```python
def delete_at(self, index):
    if index == 0:
        self.head = self.head.next
        self.count -= 1
        return
    curr = self.head
    for _ in range(index - 1):
        curr = curr.next
    curr.next = curr.next.next  # BUG: tail not updated
    self.count -= 1
```

### What Goes Wrong

1. **Tail pointer not updated:** If you delete the last node, `curr.next` becomes `None`, but `self.tail` still points to the deleted node. Future `push_back` operations will add nodes to a detached node.

2. **No bounds check:** If `index` is out of range, `curr.Next` might be `nil`, causing a null pointer dereference.

3. **Deleting head when list has one element:** `Head` becomes `nil` but `Tail` still points to the old node.

### Fix

**Go:**
```go
func (ll *LinkedList) DeleteAt(index int) error {
    if index < 0 || index >= ll.Count {
        return errors.New("index out of range")
    }
    if index == 0 {
        ll.Head = ll.Head.Next
        ll.Count--
        if ll.Count == 0 {
            ll.Tail = nil
        }
        return nil
    }
    curr := ll.Head
    for i := 0; i < index-1; i++ {
        curr = curr.Next
    }
    if curr.Next == ll.Tail {
        ll.Tail = curr // Update tail if deleting last node
    }
    curr.Next = curr.Next.Next
    ll.Count--
    return nil
}
```

---

## Bug 8: Incorrect Linked List Insertion

**Description:** Inserting a node after a given node, but the order of pointer assignments is wrong.

### Go (Buggy):

```go
func insertAfter(node *Node, val int) {
    newNode := &Node{Val: val}
    node.Next = newNode     // BUG: loses reference to rest of list
    newNode.Next = node.Next // BUG: now points to itself!
}
```

### Java (Buggy):

```java
public static void insertAfter(Node node, int val) {
    Node newNode = new Node(val);
    node.next = newNode;       // BUG: loses rest of list
    newNode.next = node.next;  // BUG: circular reference
}
```

### Python (Buggy):

```python
def insert_after(node, val):
    new_node = Node(val)
    node.next = new_node        # BUG: loses rest of list
    new_node.next = node.next   # BUG: points to itself
```

### What Goes Wrong

The assignment order is backwards. When you do `node.next = newNode` first, you lose the reference to the rest of the list. Then `newNode.next = node.next` sets `newNode.next` to `newNode` (since `node.next` is now `newNode`), creating a circular reference.

### Fix

Set the new node's next first, then link it in:

**Go:**
```go
func insertAfter(node *Node, val int) {
    newNode := &Node{Val: val}
    newNode.Next = node.Next   // Point new node to rest of list
    node.Next = newNode        // Link new node into chain
}
```

**Java:**
```java
public static void insertAfter(Node node, int val) {
    Node newNode = new Node(val);
    newNode.next = node.next;
    node.next = newNode;
}
```

**Python:**
```python
def insert_after(node, val):
    new_node = Node(val)
    new_node.next = node.next
    node.next = new_node
```

---

## Bug 9: Binary Search Bounds Error

**Description:** A binary search that has an integer overflow bug and an off-by-one error.

### Go (Buggy):

```go
func binarySearch(arr []int, target int) int {
    low := 0
    high := len(arr) // BUG: should be len(arr) - 1
    for low <= high {
        mid := (low + high) / 2 // BUG: integer overflow for large arrays
        if arr[mid] == target {
            return mid
        } else if arr[mid] < target {
            low = mid + 1
        } else {
            high = mid - 1
        }
    }
    return -1
}
```

### Java (Buggy):

```java
public static int binarySearch(int[] arr, int target) {
    int low = 0;
    int high = arr.length; // BUG: should be arr.length - 1
    while (low <= high) {
        int mid = (low + high) / 2; // BUG: overflow when low + high > Integer.MAX_VALUE
        if (arr[mid] == target) return mid;
        else if (arr[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    return -1;
}
```

### Python (Buggy):

```python
def binary_search(arr, target):
    low = 0
    high = len(arr)  # BUG: should be len(arr) - 1
    while low <= high:
        mid = (low + high) // 2  # No overflow in Python, but high is wrong
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1
```

### What Goes Wrong

**Bug 1: `high = len(arr)` instead of `len(arr) - 1`.** When `low = high = len(arr)`, `arr[mid]` accesses one past the end, causing an index out of range error.

**Bug 2 (Go/Java): Integer overflow.** If `low + high > 2^31 - 1`, the sum overflows to a negative number, producing a negative `mid`. This is the famous binary search bug found in nearly all implementations for decades (discovered by Joshua Bloch in 2006).

### Fix

**Go:**
```go
func binarySearch(arr []int, target int) int {
    low := 0
    high := len(arr) - 1
    for low <= high {
        mid := low + (high-low)/2 // Overflow-safe
        if arr[mid] == target {
            return mid
        } else if arr[mid] < target {
            low = mid + 1
        } else {
            high = mid - 1
        }
    }
    return -1
}
```

**Java:**
```java
int mid = low + (high - low) / 2; // Overflow-safe
```

**Python:**
```python
high = len(arr) - 1  # Fix bounds
# Python integers don't overflow, but fix high anyway
```

---

## Bug 10: Mutable Hash Key

**Description:** Using a mutable object as a hash map key, causing entries to "disappear."

### Go (Buggy):

Go maps do not allow mutable keys (slices, maps) — this is a compile-time error. But using a pointer as a key can have similar issues:

```go
type Point struct {
    X, Y int
}

func main() {
    m := map[*Point]string{}
    p := &Point{1, 2}
    m[p] = "origin-ish"

    // Later, someone modifies p
    p.X = 100
    // The key is still the same pointer, so lookup works
    // But if you expected to find by value {1,2}, you can't
    fmt.Println(m[&Point{1, 2}]) // "" — not found! Different pointer
}
```

### Java (Buggy):

```java
import java.util.*;

public class MutableKey {
    static class Point {
        int x, y;
        Point(int x, int y) { this.x = x; this.y = y; }

        @Override
        public int hashCode() { return x * 31 + y; }

        @Override
        public boolean equals(Object o) {
            if (!(o instanceof Point)) return false;
            Point p = (Point) o;
            return x == p.x && y == p.y;
        }
    }

    public static void main(String[] args) {
        Map<Point, String> map = new HashMap<>();
        Point p = new Point(1, 2);
        map.put(p, "origin-ish");

        p.x = 100; // BUG: mutating key after insertion

        System.out.println(map.get(p));              // null!
        System.out.println(map.get(new Point(1, 2))); // null!
        System.out.println(map.size());               // 1 — entry exists but unreachable
    }
}
```

### Python (Buggy):

```python
# Lists are mutable and unhashable — Python prevents this at runtime:
# d = {}
# d[[1, 2]] = "test"  # TypeError: unhashable type: 'list'

# But you CAN mutate an object if __hash__ is defined:
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __hash__(self):
        return hash((self.x, self.y))

    def __eq__(self, other):
        return self.x == other.x and self.y == other.y

p = Point(1, 2)
d = {p: "origin-ish"}

p.x = 100  # BUG: mutating key after insertion

print(d.get(p))              # None — hash changed
print(d.get(Point(1, 2)))    # None — old hash bucket
print(len(d))                # 1 — entry exists but unreachable
```

### What Goes Wrong

When you mutate an object used as a hash map key, its hash code changes. The entry was stored in a bucket based on the **old** hash. Lookups use the **new** hash and go to a different bucket. The entry becomes permanently unreachable (a phantom entry), causing a memory leak.

### Fix

1. Make key objects **immutable** (use `final` fields in Java, frozen dataclass in Python, value types in Go).
2. Never modify an object after using it as a map key.
3. Use value types as keys (strings, integers, tuples).

**Python fix:**
```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Point:
    x: int
    y: int
```

---

## Bug 11: Circular Reference in Linked List

**Description:** A function that detects the length of a linked list enters an infinite loop.

### Go (Buggy):

```go
func length(head *Node) int {
    count := 0
    curr := head
    for curr != nil {
        count++
        curr = curr.Next
    }
    return count
    // BUG: If the list has a cycle, this loops forever
}
```

### Java (Buggy):

```java
public static int length(Node head) {
    int count = 0;
    Node curr = head;
    while (curr != null) { // BUG: infinite loop if cycle exists
        count++;
        curr = curr.next;
    }
    return count;
}
```

### Python (Buggy):

```python
def length(head):
    count = 0
    curr = head
    while curr is not None:  # BUG: infinite loop if cycle
        count += 1
        curr = curr.next
    return count
```

### What Goes Wrong

If the linked list has a cycle (e.g., the last node's `next` points back to some earlier node), the traversal never reaches `nil`/`null`/`None`. The function loops forever.

### Fix

Use Floyd's cycle detection (slow/fast pointers) before counting, or incorporate it into the counting:

**Go:**
```go
func length(head *Node) (int, bool) {
    slow, fast := head, head
    for fast != nil && fast.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
        if slow == fast {
            return 0, true // Cycle detected
        }
    }
    // No cycle — safe to count
    count := 0
    for curr := head; curr != nil; curr = curr.Next {
        count++
    }
    return count, false
}
```

---

## Bug 12: Parentheses Checker Edge Case

**Description:** A function that checks whether parentheses in a string are balanced. It has multiple edge case bugs.

### Go (Buggy):

```go
func isBalanced(s string) bool {
    stack := []rune{}
    pairs := map[rune]rune{')': '(', ']': '[', '}': '{'}

    for _, ch := range s {
        if ch == '(' || ch == '[' || ch == '{' {
            stack = append(stack, ch)
        } else if ch == ')' || ch == ']' || ch == '}' {
            top := stack[len(stack)-1]           // BUG 1: panics if stack is empty
            stack = stack[:len(stack)-1]
            if top != pairs[ch] {
                return false
            }
        }
    }
    return true // BUG 2: should check stack is empty
}
```

### Java (Buggy):

```java
public static boolean isBalanced(String s) {
    Deque<Character> stack = new ArrayDeque<>();
    Map<Character, Character> pairs = Map.of(')', '(', ']', '[', '}', '{');

    for (char ch : s.toCharArray()) {
        if (ch == '(' || ch == '[' || ch == '{') {
            stack.push(ch);
        } else if (ch == ')' || ch == ']' || ch == '}') {
            char top = stack.pop();               // BUG 1: throws if empty
            if (top != pairs.get(ch)) {
                return false;
            }
        }
    }
    return true; // BUG 2: should check stack.isEmpty()
}
```

### Python (Buggy):

```python
def is_balanced(s):
    stack = []
    pairs = {')': '(', ']': '[', '}': '{'}

    for ch in s:
        if ch in '([{':
            stack.append(ch)
        elif ch in ')]}':
            top = stack.pop()              # BUG 1: IndexError if empty
            if top != pairs[ch]:
                return False
    return True  # BUG 2: should check len(stack) == 0
```

### What Goes Wrong

**Bug 1:** Input `")"` (closing bracket with no opening) causes a pop on an empty stack, which panics/throws/raises an error.

**Bug 2:** Input `"((("` (only opening brackets) returns `True` because the function only checks if all closing brackets matched. It never verifies that all opening brackets were closed.

### Fix

**Go:**
```go
func isBalanced(s string) bool {
    stack := []rune{}
    pairs := map[rune]rune{')': '(', ']': '[', '}': '{'}

    for _, ch := range s {
        if ch == '(' || ch == '[' || ch == '{' {
            stack = append(stack, ch)
        } else if ch == ')' || ch == ']' || ch == '}' {
            if len(stack) == 0 {       // Fix Bug 1: check empty
                return false
            }
            top := stack[len(stack)-1]
            stack = stack[:len(stack)-1]
            if top != pairs[ch] {
                return false
            }
        }
    }
    return len(stack) == 0 // Fix Bug 2: ensure all opened brackets are closed
}
```

**Java:**
```java
public static boolean isBalanced(String s) {
    Deque<Character> stack = new ArrayDeque<>();
    Map<Character, Character> pairs = Map.of(')', '(', ']', '[', '}', '{');

    for (char ch : s.toCharArray()) {
        if (ch == '(' || ch == '[' || ch == '{') {
            stack.push(ch);
        } else if (ch == ')' || ch == ']' || ch == '}') {
            if (stack.isEmpty()) return false;     // Fix Bug 1
            char top = stack.pop();
            if (top != pairs.get(ch)) return false;
        }
    }
    return stack.isEmpty(); // Fix Bug 2
}
```

**Python:**
```python
def is_balanced(s):
    stack = []
    pairs = {')': '(', ']': '[', '}': '{'}

    for ch in s:
        if ch in '([{':
            stack.append(ch)
        elif ch in ')]}':
            if not stack:              # Fix Bug 1
                return False
            top = stack.pop()
            if top != pairs[ch]:
                return False
    return len(stack) == 0  # Fix Bug 2
```

---

## Summary of Bug Patterns

| Bug | Pattern | Prevention |
|---|---|---|
| Off-by-one | `<=` instead of `<` in loop | Always verify loop bounds with edge cases |
| Null pointer | Accessing member of nil/null/None | Always check for empty before accessing |
| Stack overflow | Unbounded recursion | Use iteration or limit recursion depth |
| Queue underflow | Dequeue without empty check | Guard all removal operations |
| Stale hash entry | Not checking for existing key | Walk chain before inserting |
| ConcurrentModification | Modifying during iteration | Build new collection or iterate backwards |
| Memory leak | Not updating tail pointer | Track all reference-holding pointers |
| Wrong pointer order | Overwriting next before saving it | Always save the reference first |
| Integer overflow | `(low + high) / 2` | Use `low + (high - low) / 2` |
| Mutable key | Mutating object used as map key | Use immutable keys only |
| Infinite loop | Cycle in linked list | Use Floyd's cycle detection |
| Missing edge case | Not checking stack empty or non-empty at end | Test empty input, single element, and trailing state |

---

> **Rule of thumb:** If your code accesses `node.next`, `arr[i]`, `stack.pop()`, or `map[key]`, ask yourself: "What if it is empty/null/out of bounds?" That single question prevents the majority of data structure bugs.
