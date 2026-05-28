# Why are Data Structures Important? — Specification & Reference

## Table of Contents

1. [Overview](#overview)
2. [Go Built-in Data Structures](#go-built-in-data-structures)
3. [Java Collections Framework](#java-collections-framework)
4. [Python Built-in Data Structures](#python-built-in-data-structures)
5. [Performance Guarantees](#performance-guarantees)
6. [When to Use Which DS — Official Recommendations](#when-to-use-which-ds-official-recommendations)
7. [Core Rules](#core-rules)
8. [Edge Cases and Gotchas](#edge-cases-and-gotchas)
9. [Version Compatibility](#version-compatibility)
10. [Official References](#official-references)

---

## Overview

Each language provides built-in data structures with specific performance guarantees. Choosing the right one requires knowing:

- **What operations are O(1), O(log n), O(n)?**
- **What are the memory characteristics?**
- **What are the official recommendations for common use cases?**

This document covers the built-in DS for Go, Java, and Python with their guarantees, trade-offs, and official guidance.

---

## Go Built-in Data Structures

### Slice (`[]T`)

The primary sequential container in Go. Backed by a contiguous array with length and capacity.

```go
s := make([]int, 0, 10)  // length 0, capacity 10
s = append(s, 1, 2, 3)   // append grows as needed
```

| Operation | Complexity | Notes |
|---|---|---|
| Index access `s[i]` | O(1) | Bounds checked at runtime |
| Append `append(s, x)` | O(1) amortized | Doubles capacity when full |
| Insert at index | O(n) | Requires shifting elements |
| Delete at index | O(n) | Requires shifting elements |
| Length `len(s)` | O(1) | |
| Slice `s[i:j]` | O(1) | Shares underlying array |
| Copy `copy(dst, src)` | O(n) | |

**Growth strategy:** When capacity is exceeded, Go allocates a new backing array. For slices smaller than 256, capacity doubles. For larger slices, capacity grows by ~25% plus some additional space (as of Go 1.18+).

### Map (`map[K]V`)

Go's built-in hash table. Keys must be comparable (`==` operator).

```go
m := make(map[string]int)
m["key"] = 42
val, ok := m["key"]  // ok is false if key not found
delete(m, "key")
```

| Operation | Complexity | Notes |
|---|---|---|
| Lookup `m[k]` | O(1) average | Returns zero value if missing |
| Insert `m[k] = v` | O(1) average | |
| Delete `delete(m, k)` | O(1) average | |
| Length `len(m)` | O(1) | |
| Iteration `for k, v := range m` | O(n) | **Order is randomized** |

**Key constraint:** Keys must be comparable. Slices, maps, and functions cannot be keys. Structs with only comparable fields can be keys.

**Concurrency:** Maps are NOT safe for concurrent read/write. Use `sync.RWMutex` or `sync.Map` for concurrent access.

### Container Package

Go's `container` package provides additional data structures:

| Package | DS | Use Case |
|---|---|---|
| `container/list` | Doubly linked list | Queue, LRU cache |
| `container/heap` | Binary heap (interface) | Priority queue |
| `container/ring` | Circular list | Ring buffer, round-robin |

```go
import "container/heap"
// Implement heap.Interface: Len, Less, Swap, Push, Pop
// Then use heap.Init, heap.Push, heap.Pop
```

### sync.Map

Thread-safe map optimized for two use cases: (1) a key is written once and read many times, (2) multiple goroutines read/write disjoint key sets.

```go
var m sync.Map
m.Store("key", 42)
val, ok := m.Load("key")
m.Delete("key")
m.Range(func(key, value interface{}) bool { return true })
```

**Not recommended for:** General-purpose concurrent maps with overlapping key sets under heavy write contention. Use sharded maps instead.

---

## Java Collections Framework

### Interface Hierarchy

```
Collection
├── List
│   ├── ArrayList       (array-backed, O(1) random access)
│   ├── LinkedList      (doubly linked, O(1) add/remove at ends)
│   └── Vector          (legacy, synchronized — avoid)
├── Set
│   ├── HashSet         (hash table, O(1) operations)
│   ├── LinkedHashSet   (insertion-ordered hash set)
│   └── TreeSet         (Red-Black tree, O(log n), sorted)
└── Queue
    ├── ArrayDeque      (resizable array deque)
    ├── LinkedList      (also implements Queue)
    └── PriorityQueue   (binary heap)

Map (not a Collection)
├── HashMap             (hash table, O(1) average)
├── LinkedHashMap       (insertion-ordered hash map)
├── TreeMap             (Red-Black tree, O(log n), sorted)
├── ConcurrentHashMap   (thread-safe, segmented)
└── Hashtable           (legacy, synchronized — avoid)
```

### ArrayList

```java
List<Integer> list = new ArrayList<>();
list.add(42);           // O(1) amortized
list.get(0);            // O(1)
list.set(0, 99);        // O(1)
list.add(0, 10);        // O(n) — shifts elements
list.remove(0);         // O(n) — shifts elements
list.contains(42);      // O(n)
list.size();            // O(1)
```

**Growth strategy:** Initial capacity 10. Grows by 50% when full (`newCapacity = oldCapacity + (oldCapacity >> 1)`).

### HashMap

```java
Map<String, Integer> map = new HashMap<>();
map.put("key", 42);              // O(1) average
map.get("key");                  // O(1) average
map.containsKey("key");          // O(1) average
map.remove("key");               // O(1) average
map.size();                      // O(1)
map.getOrDefault("missing", 0);  // O(1) average
map.computeIfAbsent("key", k -> expensive(k)); // O(1) average
```

**Load factor:** Default 0.75. Resizes when `size > capacity * loadFactor`.

**Treeification (Java 8+):** When a bucket exceeds 8 entries (and table size >= 64), the bucket converts from a linked list to a Red-Black tree, improving worst case from O(n) to O(log n).

### TreeMap

```java
TreeMap<Integer, String> map = new TreeMap<>();
map.put(5, "five");             // O(log n)
map.get(5);                     // O(log n)
map.firstKey();                 // O(log n)
map.lastKey();                  // O(log n)
map.floorKey(4);                // O(log n) — largest key <= 4
map.ceilingKey(6);              // O(log n) — smallest key >= 6
map.subMap(2, 8);               // O(log n + k) — range view
```

**Backed by:** Red-Black tree. All operations are O(log n) worst case.

### PriorityQueue

```java
PriorityQueue<Integer> pq = new PriorityQueue<>(); // min-heap
pq.offer(42);        // O(log n)
pq.peek();           // O(1)
pq.poll();           // O(log n)
pq.size();           // O(1)
pq.contains(42);     // O(n)
```

**Custom ordering:** `new PriorityQueue<>(Comparator.reverseOrder())` for max-heap.

### ArrayDeque

```java
Deque<Integer> deque = new ArrayDeque<>();
deque.offerFirst(1);  // O(1) amortized
deque.offerLast(2);   // O(1) amortized
deque.pollFirst();    // O(1)
deque.pollLast();     // O(1)
deque.peekFirst();    // O(1)
deque.peekLast();     // O(1)
```

**Recommended over:** `Stack` (legacy) and `LinkedList` (as deque). ArrayDeque is faster due to cache locality.

### ConcurrentHashMap

```java
ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();
map.put("key", 42);
map.get("key");
map.computeIfAbsent("key", k -> expensive(k)); // atomic
map.merge("key", 1, Integer::sum);             // atomic increment
```

**Thread safety:** Lock striping (segments). Multiple threads can read/write different segments concurrently. No global lock.

---

## Python Built-in Data Structures

### list

Python's primary sequence type. Backed by a dynamic array of pointers.

```python
lst = [1, 2, 3]
lst.append(4)         # O(1) amortized
lst[0]                # O(1)
lst.insert(0, 99)     # O(n)
lst.pop()             # O(1)
lst.pop(0)            # O(n) — shifts all elements
lst.remove(2)         # O(n) — finds and removes first occurrence
x in lst              # O(n) — linear scan
len(lst)              # O(1)
lst.sort()            # O(n log n) — Timsort
lst.reverse()         # O(n)
lst[1:3]              # O(k) — creates new list
```

**Growth strategy:** Over-allocates by ~12.5% on append. Pattern: 0, 4, 8, 16, 24, 32, 40, 52, 64, 76, ...

### dict

Hash table with open addressing (since CPython 3.6+, insertion order is preserved).

```python
d = {"key": 42}
d["key"]              # O(1) average
d.get("key", default) # O(1) average
d["key"] = 99         # O(1) average
del d["key"]          # O(1) average
"key" in d            # O(1) average
len(d)                # O(1)
d.keys()              # O(1) — view object
d.values()            # O(1) — view object
d.items()             # O(1) — view object
```

**Insertion order:** Guaranteed since Python 3.7 (CPython implementation detail since 3.6).

### set

Hash table storing only keys (no values).

```python
s = {1, 2, 3}
s.add(4)              # O(1) average
s.remove(2)           # O(1) average, raises KeyError if missing
s.discard(2)          # O(1) average, no error if missing
2 in s                # O(1) average
len(s)                # O(1)
s1 & s2               # O(min(len(s1), len(s2))) — intersection
s1 | s2               # O(len(s1) + len(s2)) — union
s1 - s2               # O(len(s1)) — difference
s1 ^ s2               # O(len(s1) + len(s2)) — symmetric difference
```

### collections Module

| Type | Description | Key Operations |
|---|---|---|
| `deque` | Double-ended queue | `append`, `appendleft`, `pop`, `popleft` — all O(1) |
| `Counter` | Frequency counter | `Counter(iterable)` O(n), `most_common(k)` O(n log k) |
| `defaultdict` | Dict with default factory | Same as dict + auto-creates missing keys |
| `OrderedDict` | Insertion-ordered dict | `move_to_end(key)` O(1) — useful for LRU |

```python
from collections import deque, Counter, defaultdict

dq = deque([1, 2, 3])
dq.appendleft(0)   # O(1)
dq.popleft()        # O(1)
dq[5]               # O(n) — indexed access is slow!

freq = Counter("hello world")  # {'l': 3, 'o': 2, ...}
freq.most_common(2)             # [('l', 3), ('o', 2)]

graph = defaultdict(list)
graph["a"].append("b")  # auto-creates list for missing key
```

### heapq Module

Min-heap operations on a regular list.

```python
import heapq

h = [3, 1, 4, 1, 5]
heapq.heapify(h)          # O(n) — in-place
heapq.heappush(h, 2)      # O(log n)
heapq.heappop(h)           # O(log n) — returns smallest
heapq.nsmallest(3, h)      # O(n + k log n)
heapq.nlargest(3, h)       # O(n + k log n)
h[0]                       # O(1) — peek at smallest
```

**No max-heap:** Negate values to simulate max-heap: `heapq.heappush(h, -val)`.

---

## Performance Guarantees

### Summary Table: All Three Languages

| DS | Language | Lookup | Insert | Delete | Sorted? | Thread-safe? |
|---|---|---|---|---|---|---|
| Slice/Array | Go | O(1) index | O(1)* append | O(n) | No | No |
| ArrayList | Java | O(1) index | O(1)* append | O(n) | No | No |
| list | Python | O(1) index | O(1)* append | O(n) | No | GIL |
| Map | Go | O(1) avg | O(1) avg | O(1) avg | No | No |
| HashMap | Java | O(1) avg | O(1) avg | O(1) avg | No | No |
| dict | Python | O(1) avg | O(1) avg | O(1) avg | Insertion order | GIL |
| Set (map) | Go | O(1) avg | O(1) avg | O(1) avg | No | No |
| HashSet | Java | O(1) avg | O(1) avg | O(1) avg | No | No |
| set | Python | O(1) avg | O(1) avg | O(1) avg | No | GIL |
| — | — | — | — | — | — | — |
| TreeMap | Java | O(log n) | O(log n) | O(log n) | Yes | No |
| TreeSet | Java | O(log n) | O(log n) | O(log n) | Yes | No |
| PriorityQueue | Java | O(1) peek | O(log n) | O(log n) | Partial | No |
| heapq | Python | O(1) peek | O(log n) | O(log n) | Partial | GIL |
| container/heap | Go | O(1) peek | O(log n) | O(log n) | Partial | No |
| sync.Map | Go | O(1) avg | O(1) avg | O(1) avg | No | Yes |
| ConcurrentHashMap | Java | O(1) avg | O(1) avg | O(1) avg | No | Yes |

*\* Amortized O(1) — occasional O(n) resize.*

---

## When to Use Which DS — Official Recommendations

### Go (from Effective Go and Go Blog)

| Need | Use | Avoid |
|---|---|---|
| Ordered collection | `[]T` (slice) | `container/list` (unless frequent insert at head) |
| Key-value lookup | `map[K]V` | Slice of structs with linear scan |
| Concurrent map | `sync.Map` (read-heavy) or sharded map | Plain `map` with goroutines |
| Queue | `container/list` or channel | Slice with `s = s[1:]` in hot path |
| Priority queue | `container/heap` interface | Sorting on every access |
| Set | `map[T]struct{}` | `map[T]bool` (wastes 1 byte per entry) |

### Java (from Java Collections Framework Javadoc)

| Need | Use | Avoid |
|---|---|---|
| General-purpose list | `ArrayList` | `LinkedList` (poor cache, higher overhead) |
| Stack | `ArrayDeque` | `java.util.Stack` (legacy, synchronized) |
| Queue | `ArrayDeque` or `LinkedList` | `ArrayList` with `remove(0)` |
| Key-value lookup | `HashMap` | `Hashtable` (legacy, synchronized) |
| Sorted map | `TreeMap` | Manually sorting HashMap entries |
| Thread-safe map | `ConcurrentHashMap` | `Collections.synchronizedMap` (global lock) |
| Priority queue | `PriorityQueue` | Sorting on every access |
| Set | `HashSet` | `ArrayList` with `contains()` |

### Python (from Python Documentation)

| Need | Use | Avoid |
|---|---|---|
| General-purpose sequence | `list` | `tuple` for mutable data |
| Queue (FIFO) | `collections.deque` | `list` with `pop(0)` — O(n) |
| Frequency counting | `collections.Counter` | Manual dict counting |
| Default values for missing keys | `collections.defaultdict` | Manual `if key not in dict` |
| Priority queue | `heapq` | Sorting on every access |
| Set operations | `set` | `list` with `in` operator for membership |
| Immutable set | `frozenset` | `set` when hashability is needed |
| Named records | `dataclass` or `namedtuple` | Dicts with string keys for structured data |

---

## Core Rules

1. **Default to arrays/slices/lists.** They are cache-friendly, low-overhead, and sufficient for most use cases.
2. **Switch to hash maps/sets for O(1) lookup.** The moment you find yourself writing `for x in collection: if x == target`, use a set.
3. **Use deque for queues.** Never use `list.pop(0)` in Python or `ArrayList.remove(0)` in Java.
4. **Use heapq/PriorityQueue for priority.** Never sort the entire collection to find the min/max.
5. **Use TreeMap/sorted structures for range queries.** Hash maps cannot answer "find all keys between A and B."
6. **Thread safety is never free.** Use concurrent DS only when needed. Prefer sharding over global locks.

---

## Edge Cases and Gotchas

| Language | Gotcha | Impact |
|---|---|---|
| Go | Map iteration order is randomized | Do not rely on order; sort keys if needed |
| Go | Slice append may change underlying array | Slices sharing an array may see unexpected mutations |
| Go | Maps are not safe for concurrent access | Data race → crash. Use sync.RWMutex or sync.Map |
| Java | HashMap allows one null key | TreeMap does NOT allow null keys (NullPointerException) |
| Java | ArrayList.subList returns a view, not a copy | Modifying the sublist modifies the original |
| Java | PriorityQueue iterator does NOT return sorted order | Only `poll()` returns elements in priority order |
| Python | dict keys must be hashable | Lists and dicts cannot be keys; use tuples or frozensets |
| Python | `deque[i]` is O(n) for middle elements | Use list for random access, deque for ends only |
| Python | `set` is unordered | Do not rely on iteration order |
| Python | `heapq` is a min-heap only | Negate values for max-heap |

---

## Version Compatibility

### Go

| Feature | Since Version |
|---|---|
| Maps, slices | Go 1.0 |
| `container/heap`, `container/list` | Go 1.0 |
| `sync.Map` | Go 1.9 |
| Generics (`comparable` constraint) | Go 1.18 |
| Revised slice growth policy | Go 1.18 |

### Java

| Feature | Since Version |
|---|---|
| Collections Framework | Java 1.2 |
| `ConcurrentHashMap` | Java 1.5 |
| `ArrayDeque` | Java 1.6 |
| HashMap treeification | Java 8 |
| `Map.of()`, `List.of()` immutable factories | Java 9 |
| `Map.copyOf()` | Java 10 |
| Record classes (for DS elements) | Java 16 |
| Sequenced Collections | Java 21 |

### Python

| Feature | Since Version |
|---|---|
| `dict`, `list`, `set`, `tuple` | Python 2.x |
| `collections.deque` | Python 2.4 |
| `collections.Counter` | Python 2.7 |
| `collections.OrderedDict` | Python 2.7 |
| `dict` preserves insertion order | Python 3.7 (spec), 3.6 (CPython impl) |
| `dataclasses` | Python 3.7 |
| `dict` union operator `d1 \| d2` | Python 3.9 |

---

## Official References

### Go

- **Effective Go — Maps:** https://go.dev/doc/effective_go#maps
- **Effective Go — Slices:** https://go.dev/doc/effective_go#slices
- **Go Blog — Slices Internals:** https://go.dev/blog/slices-intro
- **Go Blog — Maps in Action:** https://go.dev/blog/maps
- **container/heap:** https://pkg.go.dev/container/heap
- **container/list:** https://pkg.go.dev/container/list
- **sync.Map:** https://pkg.go.dev/sync#Map

### Java

- **Collections Framework Overview:** https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/doc-files/coll-overview.html
- **HashMap Javadoc:** https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/HashMap.html
- **TreeMap Javadoc:** https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/TreeMap.html
- **ConcurrentHashMap Javadoc:** https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html
- **PriorityQueue Javadoc:** https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/PriorityQueue.html
- **ArrayDeque Javadoc:** https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/ArrayDeque.html

### Python

- **Built-in Types:** https://docs.python.org/3/library/stdtypes.html
- **collections Module:** https://docs.python.org/3/library/collections.html
- **heapq Module:** https://docs.python.org/3/library/heapq.html
- **Time Complexity Wiki:** https://wiki.python.org/moin/TimeComplexity
- **Sorting HOW TO:** https://docs.python.org/3/howto/sorting.html
- **Data Structures Tutorial:** https://docs.python.org/3/tutorial/datastructures.html
