# What are Data Structures? — Specification & Reference

## Table of Contents

1. [Overview](#overview)
2. [Python Collections Module](#python-collections-module)
3. [Go Container Package](#go-container-package)
4. [Java Collections Framework](#java-collections-framework)
5. [API Reference for Built-in Data Structures](#api-reference-for-built-in-data-structures)
6. [Core Rules](#core-rules)
7. [Behavioral Specification](#behavioral-specification)
8. [Edge Cases](#edge-cases)
9. [Version Compatibility](#version-compatibility)
10. [Official Examples](#official-examples)

---

## Overview

Every major language provides a standard library of data structures. Understanding their APIs, guarantees, and edge cases is essential for writing correct and efficient code.

This document covers:
- **Python** — `collections` module and built-in types
- **Go** — `container` package and built-in types
- **Java** — `java.util` Collections Framework

---

## Python Collections Module

**Module:** `collections` (standard library, no install needed)

**Import:** `from collections import deque, Counter, defaultdict, OrderedDict, namedtuple, ChainMap`

### Key Types

| Type | Description | Use Case |
|---|---|---|
| `deque` | Double-ended queue with O(1) append/pop on both ends | Queue, BFS, sliding window |
| `Counter` | Dict subclass for counting hashable objects | Frequency analysis, top-K |
| `defaultdict` | Dict with default factory for missing keys | Grouping, adjacency lists |
| `OrderedDict` | Dict that remembers insertion order | LRU cache (before Python 3.7) |
| `namedtuple` | Immutable tuple with named fields | Lightweight records |
| `ChainMap` | Groups multiple dicts into a single view | Scope/context layering |

### deque API

```python
from collections import deque

d = deque()              # Empty deque
d = deque([1, 2, 3])    # From iterable
d = deque(maxlen=100)   # Bounded: auto-evicts oldest when full

# Add elements
d.append(x)             # Add to right: O(1)
d.appendleft(x)         # Add to left: O(1)
d.extend(iterable)      # Extend right: O(k)
d.extendleft(iterable)  # Extend left (reversed): O(k)

# Remove elements
d.pop()                 # Remove from right: O(1)
d.popleft()             # Remove from left: O(1)
d.remove(x)             # Remove first occurrence: O(n)
d.clear()               # Remove all: O(n)

# Access
d[0]                    # First element: O(1)
d[-1]                   # Last element: O(1)
d[i]                    # Random access: O(n) — NOT O(1)

# Rotate
d.rotate(n)             # Rotate right by n steps: O(k)
d.rotate(-n)            # Rotate left by n steps: O(k)

# Info
len(d)                  # Length: O(1)
x in d                  # Membership: O(n)
d.count(x)              # Count occurrences: O(n)
d.index(x)              # First index of x: O(n)
```

### Counter API

```python
from collections import Counter

c = Counter("abracadabra")  # Counter({'a': 5, 'b': 2, 'r': 2, 'c': 1, 'd': 1})
c = Counter([1, 1, 2, 3])   # Counter({1: 2, 2: 1, 3: 1})
c = Counter(a=4, b=2)       # Counter({'a': 4, 'b': 2})

c.most_common(2)             # [('a', 5), ('b', 2)] — top K elements
c.elements()                 # Iterator: 'a', 'a', 'a', 'a', 'a', 'b', 'b', ...
c.update(iterable)           # Add counts from iterable
c.subtract(iterable)         # Subtract counts
c.total()                    # Sum of all counts (Python 3.10+)

# Arithmetic
c1 + c2                      # Add counts
c1 - c2                      # Subtract (keep positive)
c1 & c2                      # Intersection (min of each)
c1 | c2                      # Union (max of each)
```

### defaultdict API

```python
from collections import defaultdict

d = defaultdict(list)        # Missing key → empty list
d = defaultdict(int)         # Missing key → 0
d = defaultdict(set)         # Missing key → empty set

d["new_key"].append(1)       # Auto-creates list, appends 1
d["counter"] += 1            # Auto-creates 0, increments to 1
```

---

## Go Container Package

**Package:** `container/list`, `container/heap`, `container/ring`

**Import:** `import "container/list"`

Go's standard library provides three container types. For most use cases, developers use slices and maps (built-in) instead.

### Built-in Types

| Type | Description | Operations |
|---|---|---|
| `[]T` (slice) | Dynamic array | `append`, indexing, slicing |
| `map[K]V` | Hash table | `m[k]`, `m[k]=v`, `delete(m, k)` |
| `[N]T` (array) | Fixed-size array | Indexing only |
| `chan T` | Channel (concurrent queue) | `<-ch`, `ch <- v` |

### Slice API

```go
// Creation
s := []int{}                    // Empty slice
s := []int{1, 2, 3}           // Literal
s := make([]int, length)       // With length (zeroed)
s := make([]int, length, cap)  // With length and capacity

// Add
s = append(s, 4)               // Append single: amortized O(1)
s = append(s, 4, 5, 6)        // Append multiple
s = append(s, other...)        // Append another slice

// Remove
s = s[1:]                      // Remove first (slice header update)
s = s[:len(s)-1]              // Remove last
s = append(s[:i], s[i+1:]...) // Remove at index i: O(n)

// Access
s[i]                           // Index: O(1)
s[low:high]                    // Sub-slice: O(1) — shares underlying array

// Info
len(s)                         // Length: O(1)
cap(s)                         // Capacity: O(1)

// Copy
dst := make([]int, len(src))
copy(dst, src)                 // Deep copy: O(n)

// Sort
import "sort"
sort.Ints(s)                   // In-place sort: O(n log n)
sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
```

### Map API

```go
// Creation
m := map[string]int{}              // Empty map
m := map[string]int{"a": 1}       // Literal
m := make(map[string]int)         // With make
m := make(map[string]int, hint)   // With size hint

// Insert/Update
m["key"] = value                   // O(1) average

// Access
val := m["key"]                    // O(1) — returns zero value if missing
val, ok := m["key"]               // O(1) — ok is false if missing

// Delete
delete(m, "key")                   // O(1) average

// Iterate
for key, val := range m { ... }   // O(n) — unordered

// Info
len(m)                             // Number of entries: O(1)
```

### container/list (Doubly Linked List)

```go
import "container/list"

l := list.New()                    // Empty list

// Add
e := l.PushBack(val)              // Append: O(1), returns *Element
e := l.PushFront(val)             // Prepend: O(1)
l.InsertAfter(val, mark)          // Insert after element: O(1)
l.InsertBefore(val, mark)         // Insert before element: O(1)

// Remove
l.Remove(e)                        // Remove element: O(1)

// Access
l.Front()                          // First element: O(1)
l.Back()                           // Last element: O(1)
e.Value                            // Element's value (interface{})
e.Next()                           // Next element
e.Prev()                           // Previous element

// Info
l.Len()                            // Length: O(1)

// Move
l.MoveToFront(e)                   // O(1)
l.MoveToBack(e)                    // O(1)
l.MoveBefore(e, mark)              // O(1)
l.MoveAfter(e, mark)               // O(1)
```

### container/heap (Priority Queue Interface)

```go
import "container/heap"

// You must implement the heap.Interface:
type Interface interface {
    sort.Interface          // Len, Less, Swap
    Push(x interface{})     // Add element
    Pop() interface{}       // Remove and return min/max
}

// Then use:
heap.Init(&h)              // Establish heap ordering: O(n)
heap.Push(&h, val)         // Add and fix: O(log n)
heap.Pop(&h)               // Remove min and fix: O(log n)
heap.Fix(&h, i)            // Fix position after value change: O(log n)
heap.Remove(&h, i)         // Remove element at index: O(log n)
```

---

## Java Collections Framework

**Package:** `java.util`

### Interface Hierarchy

```
Iterable
└── Collection
    ├── List          (ordered, indexed)
    │   ├── ArrayList
    │   ├── LinkedList
    │   └── Vector (legacy)
    ├── Set           (unique elements)
    │   ├── HashSet
    │   ├── LinkedHashSet
    │   └── TreeSet (sorted)
    └── Queue         (FIFO)
        ├── LinkedList
        ├── ArrayDeque
        └── PriorityQueue

Map                   (key-value, separate hierarchy)
├── HashMap
├── LinkedHashMap
├── TreeMap (sorted)
└── Hashtable (legacy)
```

### List Interface

```java
List<E> list = new ArrayList<>();      // Dynamic array
List<E> list = new LinkedList<>();     // Doubly linked list

// Add
list.add(e);                           // Append: O(1) amortized
list.add(index, e);                    // Insert at index: O(n) for ArrayList
list.addAll(collection);               // Append all: O(k)

// Remove
list.remove(index);                    // By index: O(n) for ArrayList
list.remove(object);                   // By value (first occurrence): O(n)
list.clear();                          // Remove all: O(n)

// Access
list.get(index);                       // O(1) ArrayList, O(n) LinkedList
list.set(index, e);                    // O(1) ArrayList, O(n) LinkedList
list.indexOf(e);                       // First index: O(n)
list.contains(e);                      // Membership: O(n)

// Info
list.size();                           // O(1)
list.isEmpty();                        // O(1)

// Iterate
for (E e : list) { ... }
list.forEach(e -> { ... });
list.iterator();
list.listIterator();                   // Bidirectional

// Convert
list.toArray();                        // To Object[]
list.toArray(new String[0]);          // To typed array
list.subList(from, to);               // View (not copy)

// Sort
list.sort(Comparator.naturalOrder());
Collections.sort(list);
```

### Set Interface

```java
Set<E> set = new HashSet<>();          // O(1) add/remove/contains, unordered
Set<E> set = new LinkedHashSet<>();    // O(1) operations, insertion-ordered
Set<E> set = new TreeSet<>();          // O(log n) operations, sorted

// Add
set.add(e);                            // Returns false if already present

// Remove
set.remove(e);
set.clear();

// Query
set.contains(e);
set.size();
set.isEmpty();

// Set operations
set.addAll(other);                     // Union
set.retainAll(other);                  // Intersection
set.removeAll(other);                  // Difference
set.containsAll(other);               // Subset check

// Iterate
for (E e : set) { ... }
```

### Map Interface

```java
Map<K, V> map = new HashMap<>();       // O(1), unordered
Map<K, V> map = new LinkedHashMap<>(); // O(1), insertion-ordered
Map<K, V> map = new TreeMap<>();       // O(log n), sorted by key

// Insert/Update
map.put(key, value);                   // Returns previous value or null
map.putIfAbsent(key, value);          // Only if key not present
map.putAll(otherMap);
map.merge(key, value, (v1, v2) -> v1 + v2); // Merge with function

// Access
map.get(key);                          // Returns null if missing
map.getOrDefault(key, defaultVal);    // Returns default if missing

// Remove
map.remove(key);
map.remove(key, expectedValue);       // Conditional remove

// Query
map.containsKey(key);
map.containsValue(value);             // O(n)
map.size();
map.isEmpty();

// Views
map.keySet();                          // Set<K>
map.values();                          // Collection<V>
map.entrySet();                        // Set<Map.Entry<K,V>>

// Iterate
for (Map.Entry<K, V> entry : map.entrySet()) {
    entry.getKey();
    entry.getValue();
}
map.forEach((k, v) -> { ... });

// Compute
map.compute(key, (k, v) -> newValue);
map.computeIfAbsent(key, k -> expensiveComputation(k));
map.computeIfPresent(key, (k, v) -> v + 1);
```

### Queue / Deque Interface

```java
// Queue (FIFO)
Queue<E> queue = new LinkedList<>();
Queue<E> queue = new ArrayDeque<>();   // Preferred (faster, no null elements)

queue.offer(e);        // Add to tail: O(1). Returns false if full (bounded).
queue.poll();          // Remove from head: O(1). Returns null if empty.
queue.peek();          // View head: O(1). Returns null if empty.
queue.add(e);          // Like offer, but throws on full.
queue.remove();        // Like poll, but throws on empty.
queue.element();       // Like peek, but throws on empty.

// Deque (double-ended)
Deque<E> deque = new ArrayDeque<>();

deque.offerFirst(e);   // Add to front: O(1)
deque.offerLast(e);    // Add to back: O(1)
deque.pollFirst();     // Remove from front: O(1)
deque.pollLast();      // Remove from back: O(1)
deque.peekFirst();     // View front: O(1)
deque.peekLast();      // View back: O(1)

// Use as Stack
deque.push(e);         // = addFirst(e)
deque.pop();           // = removeFirst()
deque.peek();          // = peekFirst()
```

### PriorityQueue

```java
PriorityQueue<E> pq = new PriorityQueue<>();                  // Min-heap (natural order)
PriorityQueue<E> pq = new PriorityQueue<>(Comparator.reverseOrder()); // Max-heap

pq.offer(e);           // Add: O(log n)
pq.poll();             // Remove min/max: O(log n)
pq.peek();             // View min/max: O(1)
pq.size();
pq.contains(e);        // O(n) — not O(log n)!
pq.remove(e);          // O(n) — linear scan
```

---

## API Reference for Built-in Data Structures

### Complexity Quick Reference

| Operation | Python list | Python deque | Python dict | Python set |
|---|---|---|---|---|
| Append / Add | O(1)* | O(1) | O(1)* | O(1)* |
| Prepend | O(n) | O(1) | — | — |
| Pop last | O(1) | O(1) | — | — |
| Pop first | O(n) | O(1) | — | — |
| Index access | O(1) | O(n) | O(1)* | — |
| Search | O(n) | O(n) | O(1)* | O(1)* |
| Delete by value | O(n) | O(n) | O(1)* | O(1)* |

*\* amortized*

| Operation | Go slice | Go map | Java ArrayList | Java HashMap |
|---|---|---|---|---|
| Append | O(1)* | — | O(1)* | — |
| Put | — | O(1)* | — | O(1)* |
| Index access | O(1) | O(1)* | O(1) | O(1)* |
| Search | O(n) | O(1)* | O(n) | O(1)* |
| Delete by index | O(n) | — | O(n) | — |
| Delete by key | — | O(1)* | — | O(1)* |

---

## Core Rules

### Rule 1: Choose the Right Data Structure

The data structure must match your dominant operation:

| Dominant Operation | Best DS | Avoid |
|---|---|---|
| Lookup by key | Hash Map | List, Array |
| Ordered iteration | Sorted Array, BST, TreeMap | Hash Map |
| FIFO processing | Queue (Deque) | Array with shift |
| LIFO processing | Stack (Deque) | Queue |
| Unique membership | Set | List with manual dedup |
| Priority access | Heap / Priority Queue | Sorted Array |
| Frequent insert/delete | Linked List | Array (if at start/middle) |

### Rule 2: Understand Amortized vs Worst Case

| Operation | Amortized | Worst Case | When Worst Case Hits |
|---|---|---|---|
| Hash map insert | O(1) | O(n) | Rehash triggered |
| Dynamic array append | O(1) | O(n) | Resize triggered |
| BST insert (balanced) | O(log n) | O(log n) | Always (balanced) |
| BST insert (unbalanced) | O(log n) | O(n) | Sorted input |

### Rule 3: Prefer Standard Library Implementations

Standard libraries are:
- Battle-tested by millions of users
- Optimized by language experts
- Correct for edge cases
- Thread-safety documented

Do **not** implement your own hash table, sort, or tree in production unless you have a measured performance reason.

### Rule 4: Immutable Keys in Hash-Based Structures

Any object used as a key in a hash map or element in a hash set must be immutable (or at least must not change its hash code while stored). Violating this causes lost entries.

### Rule 5: Null/Nil Handling

| Language | Hash Map: null key | Hash Map: null value | Set: null element |
|---|---|---|---|
| Python | Unhashable (no None key issue) | Allowed | `None` is hashable, allowed |
| Go | Zero value used for nil | Zero value | N/A (no built-in set) |
| Java HashMap | 1 null key allowed | Allowed | 1 null element in HashSet |
| Java TreeMap | No null key (NPE) | Allowed | No null in TreeSet |
| Java ArrayDeque | No null elements | — | — |

---

## Behavioral Specification

### Iteration Order Guarantees

| DS | Language | Order Guarantee |
|---|---|---|
| `dict` | Python 3.7+ | Insertion order |
| `set` | Python | No guarantee |
| `map` | Go | **No guarantee** (randomized) |
| `HashMap` | Java | No guarantee |
| `LinkedHashMap` | Java | Insertion order |
| `TreeMap` | Java | Sorted (natural or comparator) |
| `ArrayList` | Java | Index order |

### Thread Safety

| DS | Language | Thread Safe? |
|---|---|---|
| `list`, `dict`, `set` | Python | GIL protects individual operations |
| `slice`, `map` | Go | **NOT thread safe** — use `sync.Map` or mutex |
| `ArrayList`, `HashMap` | Java | **NOT thread safe** |
| `ConcurrentHashMap` | Java | Thread safe |
| `CopyOnWriteArrayList` | Java | Thread safe (for read-heavy) |
| `Collections.synchronizedList()` | Java | Wrapper for thread safety |

### Equality and Hashing Contract

**Java:** If `a.equals(b)` is true, then `a.hashCode() == b.hashCode()` must be true. The reverse is not required (collisions are allowed). Violating this breaks HashMap/HashSet.

**Python:** If `a == b` is true, then `hash(a) == hash(b)` must be true. Same rule.

**Go:** Map keys must be comparable (support `==`). Slices, maps, and functions cannot be map keys.

---

## Edge Cases

### Empty Collections

```python
# Python
[].pop()              # IndexError
{}.popitem()          # KeyError (Python 3.9+: last item)
deque().popleft()     # IndexError
```

```go
// Go
var s []int
s[0]                  // panic: index out of range
len(s)                // 0 (safe)
var m map[string]int
m["key"]              // 0 (zero value, safe)
m["key"] = 1          // panic: assignment to nil map
```

```java
// Java
new ArrayList<>().get(0);     // IndexOutOfBoundsException
new ArrayDeque<>().poll();    // null (no exception)
new ArrayDeque<>().remove();  // NoSuchElementException
new HashMap<>().get("x");     // null (no exception)
```

### Single Element

```python
# Python: list with one element
[1].pop()     # Returns 1, list is now []
[1].pop()     # Then: IndexError
```

### Large Collections

- Python `list`: Max ~536 million elements (64-bit, limited by `sys.maxsize`)
- Go `slice`: Limited by available memory. Max `int` elements.
- Java `ArrayList`: Max `Integer.MAX_VALUE - 8` = 2,147,483,639 elements

### Hash Collision Behavior

- **Python dict:** Open addressing with probing. Load factor ~66%.
- **Go map:** Hash table with buckets of 8. Grows when average bucket fullness exceeds 6.5.
- **Java HashMap:** Separate chaining. Default load factor 0.75. Chains become red-black trees at 8 entries (Java 8+).

---

## Version Compatibility

### Python

| Feature | Version | Notes |
|---|---|---|
| `dict` preserves insertion order | 3.7+ | Implementation detail in 3.6, guaranteed in 3.7 |
| `collections.OrderedDict` | 2.7+ | Still useful for `move_to_end()` and equality |
| `Counter.total()` | 3.10+ | Sum of counts |
| `dict | other_dict` (merge) | 3.9+ | Returns new dict |
| `dict |= other_dict` (update) | 3.9+ | In-place merge |
| Walrus operator in comprehensions | 3.8+ | `[y := f(x) for x in ...]` |
| `collections.abc` | 3.3+ | Abstract base classes moved here |

### Go

| Feature | Version | Notes |
|---|---|---|
| Generic containers (`slices`, `maps`) | 1.21+ | `slices.Sort`, `maps.Keys` |
| `sync.Map` | 1.9+ | Concurrent map |
| `container/list` | 1.0+ | Stable since Go 1 |
| `container/heap` | 1.0+ | Stable since Go 1 |
| `cmp.Or`, `cmp.Compare` | 1.21+ | Comparison utilities |
| `slices.Contains` | 1.21+ | Generic slice membership |

### Java

| Feature | Version | Notes |
|---|---|---|
| `HashMap` tree bins | 8+ | Chains → red-black tree at 8 collisions |
| `Map.of()`, `List.of()`, `Set.of()` | 9+ | Immutable factory methods |
| `List.copyOf()` | 10+ | Immutable copy |
| `Stream.toList()` | 16+ | Unmodifiable list from stream |
| Sequenced Collections | 21+ | `SequencedCollection`, `SequencedMap` interfaces |
| `Collections.unmodifiableList()` | 2+ | Unmodifiable wrapper |
| `ConcurrentHashMap` | 5+ | Thread-safe map |

---

## Official Examples

### Python: Using deque as a Queue

```python
from collections import deque

# BFS traversal
def bfs(graph, start):
    visited = set()
    queue = deque([start])
    visited.add(start)
    result = []

    while queue:
        node = queue.popleft()  # O(1)
        result.append(node)
        for neighbor in graph[node]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)  # O(1)

    return result

graph = {
    'A': ['B', 'C'],
    'B': ['D', 'E'],
    'C': ['F'],
    'D': [], 'E': [], 'F': []
}
print(bfs(graph, 'A'))  # ['A', 'B', 'C', 'D', 'E', 'F']
```

### Go: Using container/heap for Priority Queue

```go
package main

import (
    "container/heap"
    "fmt"
)

type Item struct {
    value    string
    priority int
    index    int
}

type PriorityQueue []*Item

func (pq PriorityQueue) Len() int { return len(pq) }
func (pq PriorityQueue) Less(i, j int) bool {
    return pq[i].priority < pq[j].priority // min-heap
}
func (pq PriorityQueue) Swap(i, j int) {
    pq[i], pq[j] = pq[j], pq[i]
    pq[i].index = i
    pq[j].index = j
}
func (pq *PriorityQueue) Push(x interface{}) {
    n := len(*pq)
    item := x.(*Item)
    item.index = n
    *pq = append(*pq, item)
}
func (pq *PriorityQueue) Pop() interface{} {
    old := *pq
    n := len(old)
    item := old[n-1]
    old[n-1] = nil
    item.index = -1
    *pq = old[:n-1]
    return item
}

func main() {
    pq := &PriorityQueue{}
    heap.Init(pq)

    heap.Push(pq, &Item{value: "low", priority: 3})
    heap.Push(pq, &Item{value: "high", priority: 1})
    heap.Push(pq, &Item{value: "medium", priority: 2})

    for pq.Len() > 0 {
        item := heap.Pop(pq).(*Item)
        fmt.Printf("priority=%d value=%s\n", item.priority, item.value)
    }
    // Output:
    // priority=1 value=high
    // priority=2 value=medium
    // priority=3 value=low
}
```

### Java: Using TreeMap for Sorted Key-Value Store

```java
import java.util.TreeMap;
import java.util.Map;

public class TreeMapExample {
    public static void main(String[] args) {
        TreeMap<String, Integer> scores = new TreeMap<>();
        scores.put("Charlie", 85);
        scores.put("Alice", 92);
        scores.put("Bob", 78);
        scores.put("Diana", 95);

        // Sorted iteration (by key)
        for (Map.Entry<String, Integer> entry : scores.entrySet()) {
            System.out.printf("%s: %d%n", entry.getKey(), entry.getValue());
        }
        // Alice: 92, Bob: 78, Charlie: 85, Diana: 95

        // Navigation methods
        System.out.println("First: " + scores.firstKey());          // Alice
        System.out.println("Last: " + scores.lastKey());            // Diana
        System.out.println("Floor of 'Cat': " + scores.floorKey("Cat")); // Charlie
        System.out.println("Ceiling of 'Cat': " + scores.ceilingKey("Cat")); // Charlie

        // Range view
        Map<String, Integer> range = scores.subMap("Bob", true, "Diana", false);
        System.out.println("Range [Bob, Diana): " + range); // {Bob=78, Charlie=85}
    }
}
```

### Java: Using ArrayDeque as Stack and Queue

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class DequeExample {
    public static void main(String[] args) {
        // As a Stack (LIFO)
        Deque<String> stack = new ArrayDeque<>();
        stack.push("first");
        stack.push("second");
        stack.push("third");
        System.out.println(stack.pop());  // third
        System.out.println(stack.pop());  // second

        // As a Queue (FIFO)
        Deque<String> queue = new ArrayDeque<>();
        queue.offer("first");
        queue.offer("second");
        queue.offer("third");
        System.out.println(queue.poll()); // first
        System.out.println(queue.poll()); // second
    }
}
```

---

## Official Documentation Links

- **Python:** https://docs.python.org/3/library/collections.html
- **Go:** https://pkg.go.dev/container/list, https://pkg.go.dev/container/heap
- **Java:** https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/package-summary.html

---

> **Remember:** The standard library is your first choice. Understand its guarantees, limitations, and edge cases. Only build custom data structures when benchmarks prove the standard ones are insufficient for your specific workload.
