# Hash Table — Language Specifications & API Reference

## Table of Contents

1. [Go: map](#go-map)
2. [Java: HashMap](#java-hashmap)
3. [Java: HashSet](#java-hashset)
4. [Java: ConcurrentHashMap](#java-concurrenthashmap)
5. [Python: dict](#python-dict)
6. [Python: set](#python-set)
7. [Comparison Table](#comparison-table)

---

## Go: map

### Declaration and Initialization

```go
// Declare with make (preferred for non-empty maps)
m := make(map[string]int)          // empty map
m := make(map[string]int, 100)     // empty map with capacity hint (avoids early resizes)

// Literal initialization
m := map[string]int{
    "alice": 95,
    "bob":   82,
}

// Declare nil map (reads return zero value; writes panic)
var m map[string]int  // m is nil
```

### Operations

| Operation | Syntax | Time Complexity |
|-----------|--------|----------------|
| Insert / Update | `m[key] = value` | O(1) avg |
| Lookup | `val := m[key]` | O(1) avg |
| Lookup (check existence) | `val, ok := m[key]` | O(1) avg |
| Delete | `delete(m, key)` | O(1) avg |
| Length | `len(m)` | O(1) |
| Iterate | `for k, v := range m { }` | O(n) |

### Key Constraints

Valid key types must be **comparable** (`==` and `!=` are defined):
- All numeric types, `string`, `bool`, pointers, channels, arrays (of comparable elements), structs (of comparable fields).
- **Not valid**: slices, maps, functions.

### Internal Implementation

- Go maps use a hash table with **buckets of 8 key-value pairs** each.
- Overflow buckets are chained when a bucket is full.
- **Growth trigger**: Average entries per bucket > 6.5, or too many overflow buckets.
- **Incremental rehashing**: Growth happens gradually during map operations (not all at once).
- **Iteration order**: Deliberately randomized (do not rely on order).
- **Not goroutine-safe**: Concurrent read+write causes `fatal error: concurrent map read and map write`. Use `sync.RWMutex` or `sync.Map`.

### Zero Value Behavior

```go
m := make(map[string]int)
fmt.Println(m["missing"]) // 0 (zero value for int)

// Distinguish "missing" from "exists with zero value":
val, ok := m["missing"]
// val = 0, ok = false
```

---

## Java: HashMap

### Declaration and Initialization

```java
import java.util.HashMap;
import java.util.Map;

// Default capacity 16, load factor 0.75
Map<String, Integer> map = new HashMap<>();

// Custom initial capacity
Map<String, Integer> map = new HashMap<>(1000);

// Custom capacity and load factor
Map<String, Integer> map = new HashMap<>(1000, 0.5f);

// Initialize from another map
Map<String, Integer> map = new HashMap<>(existingMap);

// Immutable map (Java 9+)
Map<String, Integer> map = Map.of("alice", 95, "bob", 82);
```

### Core Methods

| Method | Description | Returns | Time |
|--------|-------------|---------|------|
| `put(K, V)` | Insert or update | Previous value or null | O(1) avg |
| `get(K)` | Lookup | Value or null | O(1) avg |
| `getOrDefault(K, V)` | Lookup with default | Value or default | O(1) avg |
| `containsKey(K)` | Check key existence | boolean | O(1) avg |
| `containsValue(V)` | Check value existence | boolean | O(n) |
| `remove(K)` | Delete by key | Previous value or null | O(1) avg |
| `remove(K, V)` | Delete only if value matches | boolean | O(1) avg |
| `size()` | Entry count | int | O(1) |
| `isEmpty()` | Check if empty | boolean | O(1) |
| `clear()` | Remove all entries | void | O(n) |
| `keySet()` | Set of keys | Set<K> | O(1) (view) |
| `values()` | Collection of values | Collection<V> | O(1) (view) |
| `entrySet()` | Set of entries | Set<Entry<K,V>> | O(1) (view) |

### Atomic Compound Methods (Java 8+)

| Method | Description |
|--------|-------------|
| `putIfAbsent(K, V)` | Insert only if key is absent |
| `compute(K, BiFunction)` | Compute new value from key and current value |
| `computeIfAbsent(K, Function)` | Compute and insert if key is absent |
| `computeIfPresent(K, BiFunction)` | Compute and update if key is present |
| `merge(K, V, BiFunction)` | Merge value with existing (or insert if absent) |
| `replace(K, V)` | Replace value only if key is present |
| `replace(K, oldV, newV)` | Replace only if current value matches |
| `forEach(BiConsumer)` | Iterate over all entries |
| `replaceAll(BiFunction)` | Replace all values using a function |

### Internal Implementation

- Array of `Node` entries (linked list buckets).
- Default capacity: 16. Always a power of 2.
- Load factor: 0.75 (configurable).
- **Treeification** (Java 8+): When a chain exceeds **8 entries** AND table capacity >= 64, the chain converts to a **red-black tree** (O(log n) worst case per bucket). Un-treeifies when chain drops below 6.
- **Hash spreading**: `h = key.hashCode(); h ^= (h >>> 16);` — spreads high bits to low bits.
- **Null keys**: One null key is allowed (hashes to bucket 0).
- **Not thread-safe**: Use `Collections.synchronizedMap()` or `ConcurrentHashMap` for concurrency.
- **Iteration order**: Not guaranteed (use `LinkedHashMap` for insertion order).

### Key Requirements

- Must implement `hashCode()` and `equals()` consistently.
- **Contract**: If `a.equals(b)`, then `a.hashCode() == b.hashCode()`.
- The reverse is NOT required (different objects may share a hash code).

---

## Java: HashSet

### Declaration and Initialization

```java
import java.util.HashSet;
import java.util.Set;

Set<String> set = new HashSet<>();
Set<String> set = new HashSet<>(Arrays.asList("a", "b", "c"));
Set<String> set = Set.of("a", "b", "c"); // Java 9+, immutable
```

### Core Methods

| Method | Description | Returns | Time |
|--------|-------------|---------|------|
| `add(E)` | Add element | true if new | O(1) avg |
| `remove(E)` | Remove element | true if found | O(1) avg |
| `contains(E)` | Check membership | boolean | O(1) avg |
| `size()` | Element count | int | O(1) |
| `isEmpty()` | Check if empty | boolean | O(1) |
| `clear()` | Remove all | void | O(n) |
| `iterator()` | Iterate | Iterator<E> | - |
| `toArray()` | Convert to array | Object[] | O(n) |

### Set Operations

```java
Set<String> a = new HashSet<>(Arrays.asList("1", "2", "3"));
Set<String> b = new HashSet<>(Arrays.asList("2", "3", "4"));

// Union
Set<String> union = new HashSet<>(a);
union.addAll(b);  // {"1", "2", "3", "4"}

// Intersection
Set<String> inter = new HashSet<>(a);
inter.retainAll(b);  // {"2", "3"}

// Difference
Set<String> diff = new HashSet<>(a);
diff.removeAll(b);  // {"1"}
```

### Internal Implementation

- Backed by a `HashMap<E, Object>` where every value is a static `PRESENT` object.
- All HashMap properties apply (load factor, treeification, etc.).

---

## Java: ConcurrentHashMap

### Declaration

```java
import java.util.concurrent.ConcurrentHashMap;

ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();
ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>(1000);
ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>(1000, 0.75f, 16);
// Third arg: concurrencyLevel (estimated concurrent writers; hint only)
```

### Key Differences from HashMap

| Feature | HashMap | ConcurrentHashMap |
|---------|---------|-------------------|
| Thread safety | Not safe | Safe (lock-free reads, fine-grained write locks) |
| Null keys | Allowed (1) | Not allowed |
| Null values | Allowed | Not allowed |
| Iteration | Fail-fast (ConcurrentModificationException) | Weakly consistent (no exception) |
| Bulk operations | No | Yes (forEach, search, reduce with parallelism) |

### Atomic Operations

```java
// All of these are atomic (thread-safe compound operations):
map.putIfAbsent("key", 1);
map.compute("key", (k, v) -> v == null ? 1 : v + 1);
map.merge("key", 1, Integer::sum);
```

### Bulk Parallel Operations (Java 8+)

```java
// Parallel forEach with parallelism threshold
map.forEach(10_000, (key, value) -> {
    System.out.println(key + ": " + value);
});

// Parallel search: returns first match or null
String found = map.search(10_000, (key, value) ->
    value > 90 ? key : null
);

// Parallel reduce
int total = map.reduceValues(10_000, Integer::sum);
```

The `long` parameter is the **parallelism threshold**: if the map has more elements than this, operations run in parallel using the ForkJoinPool.

---

## Python: dict

### Declaration and Initialization

```python
# Literal
d = {"alice": 95, "bob": 82}

# Constructor
d = dict(alice=95, bob=82)
d = dict([("alice", 95), ("bob", 82)])

# Comprehension
d = {k: v for k, v in zip(keys, values)}

# fromkeys (all values same)
d = dict.fromkeys(["a", "b", "c"], 0)  # {"a": 0, "b": 0, "c": 0}
```

### Core Methods

| Method | Description | Returns | Time |
|--------|-------------|---------|------|
| `d[key]` | Lookup (raises KeyError if missing) | value | O(1) avg |
| `d[key] = value` | Insert or update | - | O(1) avg |
| `d.get(key, default)` | Lookup with default | value or default | O(1) avg |
| `d.setdefault(key, default)` | Get or insert default | value | O(1) avg |
| `del d[key]` | Delete (raises KeyError if missing) | - | O(1) avg |
| `d.pop(key, default)` | Remove and return value | value or default | O(1) avg |
| `d.popitem()` | Remove and return last inserted pair | (key, value) | O(1) |
| `key in d` | Check membership | bool | O(1) avg |
| `len(d)` | Entry count | int | O(1) |
| `d.keys()` | View of keys | dict_keys | O(1) (view) |
| `d.values()` | View of values | dict_values | O(1) (view) |
| `d.items()` | View of pairs | dict_items | O(1) (view) |
| `d.update(other)` | Merge another dict | None | O(len(other)) |
| `d | other` | Merge (Python 3.9+) | new dict | O(n+m) |
| `d |= other` | In-place merge (Python 3.9+) | None | O(len(other)) |
| `d.clear()` | Remove all | None | O(n) |
| `d.copy()` | Shallow copy | dict | O(n) |

### Internal Implementation

- **Open addressing** with probing (not chaining).
- Hash table stores indices into a compact array of (hash, key, value) tuples.
- **Insertion order preserved** since Python 3.7 (language guarantee).
- **Load factor threshold**: 2/3 (~0.67).
- **Growth**: Approximately 2x (to next power of 2, times 2/3 threshold).
- **Hash randomization**: Hash seed randomized per process (since Python 3.3) to prevent hash-flooding attacks. Set `PYTHONHASHSEED=0` for deterministic behavior.

### Key Requirements

Keys must be **hashable**: implement `__hash__()` and `__eq__()`.
- Built-in hashable types: `int`, `float`, `str`, `bytes`, `tuple` (if all elements are hashable), `frozenset`, `None`.
- **Not hashable**: `list`, `dict`, `set`, `bytearray`.

### collections Module Extensions

```python
from collections import defaultdict, OrderedDict, Counter

# defaultdict: auto-creates missing keys with a factory
dd = defaultdict(list)
dd["key"].append(1)  # No KeyError

# Counter: frequency counting
c = Counter("aabbbcccc")
c.most_common(2)  # [('c', 4), ('b', 3)]

# OrderedDict: remembers insertion order (mostly superseded by dict in 3.7+)
# Still useful for: move_to_end(), equality considers order
```

---

## Python: set

### Declaration and Initialization

```python
s = {1, 2, 3}
s = set([1, 2, 3])
s = set()  # Empty set (NOT {}, which is an empty dict)
fs = frozenset([1, 2, 3])  # Immutable set (hashable, usable as dict key)
```

### Core Methods

| Method | Description | Returns | Time |
|--------|-------------|---------|------|
| `s.add(x)` | Add element | None | O(1) avg |
| `s.remove(x)` | Remove (raises KeyError) | None | O(1) avg |
| `s.discard(x)` | Remove (no error if missing) | None | O(1) avg |
| `s.pop()` | Remove and return arbitrary element | element | O(1) |
| `x in s` | Membership test | bool | O(1) avg |
| `len(s)` | Count | int | O(1) |

### Set Operations

| Operation | Operator | Method | Time |
|-----------|----------|--------|------|
| Union | `a | b` | `a.union(b)` | O(len(a) + len(b)) |
| Intersection | `a & b` | `a.intersection(b)` | O(min(len(a), len(b))) |
| Difference | `a - b` | `a.difference(b)` | O(len(a)) |
| Symmetric Diff | `a ^ b` | `a.symmetric_difference(b)` | O(len(a) + len(b)) |
| Subset | `a <= b` | `a.issubset(b)` | O(len(a)) |
| Superset | `a >= b` | `a.issuperset(b)` | O(len(b)) |
| Disjoint | - | `a.isdisjoint(b)` | O(min(len(a), len(b))) |

---

## Comparison Table

| Feature | Go `map` | Java `HashMap` | Python `dict` |
|---------|----------|----------------|---------------|
| Collision strategy | Bucket chaining (8 per bucket) | Chaining + treeification | Open addressing |
| Default capacity | Runtime-managed | 16 | 8 |
| Load factor threshold | ~6.5 per bucket | 0.75 | 0.67 |
| Growth factor | 2x | 2x | ~2x |
| Null keys | N/A (zero value) | 1 allowed | N/A |
| Iteration order | Random | Unordered | Insertion order (3.7+) |
| Thread safety | Not safe | Not safe | GIL-atomic for single ops |
| Concurrent variant | `sync.Map` | `ConcurrentHashMap` | `threading.Lock` + dict |
| Hash randomization | Per-process seed | No (but SipHash planned) | Per-process seed (3.3+) |
| Key requirements | Comparable types | `hashCode()` + `equals()` | `__hash__()` + `__eq__()` |
