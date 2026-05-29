# Map / Dictionary — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Choosing an Implementation](#choosing-an-implementation)
3. [Iteration Order — Formal Guarantees](#iteration-order--formal-guarantees)
4. [The Key Contract — Deeper](#the-key-contract--deeper)
5. [Default-Value Patterns and APIs](#default-value-patterns-and-apis)
6. [Multimap Pattern](#multimap-pattern)
7. [Map as Building Block for Other ADTs](#map-as-building-block-for-other-adts)
8. [Mutable-Key Footguns](#mutable-key-footguns)
9. [Integration Patterns](#integration-patterns)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Summary](#summary)

---

## Introduction

> Focus: "Why this implementation?" and "When does the wrong choice hurt?"

At the middle level we move past "use a HashMap." We compare implementations under real workloads, study iteration-order guarantees that vary by language version, build multimaps from primitive Maps, and avoid the bugs that come from misunderstanding the key contract.

---

## Choosing an Implementation

The Map ADT is one interface with many backings. Match the backing to the workload.

| Workload | Best Choice | Why |
|----------|------------|-----|
| Pure get/put, order irrelevant | HashMap / `map` / `dict` | O(1) average; lowest constant factors |
| Sorted iteration needed | TreeMap / `std::map` | Tree gives sorted order for free |
| Range queries (`floorKey`, `ceilingKey`, `subMap`) | TreeMap | Tree supports them; hash cannot |
| Preserve insertion order | LinkedHashMap / Py `dict` | Hash + linked list |
| LRU eviction policy | LinkedHashMap (`accessOrder=true`) | Reorders on access |
| Many writers, many readers | ConcurrentHashMap | Lock striping, lock-free reads |
| Memory-constrained, small N (< 32) | Plain array of pairs | No hash overhead; linear scan is fine |
| Integer keys in tight range | Array indexed by key | Map overhead is wasted |

### Comparison: HashMap vs TreeMap vs LinkedHashMap

| Attribute | HashMap | TreeMap | LinkedHashMap |
|-----------|---------|---------|---------------|
| `get` (avg) | O(1) | O(log n) | O(1) |
| `get` (worst) | O(n) | O(log n) | O(n) |
| Iteration order | undefined | sorted | insertion / access |
| Range queries | no | yes | no |
| Null key allowed | one | no | one |
| Memory per entry | ~48 bytes (JVM) | ~64 bytes (JVM) | ~56 bytes (JVM) |
| Cache locality | mixed | poor | mixed |
| Best for | general lookups | sorted reports | LRU / FIFO caches |

**Decision rule:** Default to HashMap. Upgrade to LinkedHashMap if order matters. Upgrade to TreeMap only when you need sorted iteration or range queries — the log n cost is rarely worth it for plain lookups.

---

## Iteration Order — Formal Guarantees

Iteration order is one of the most error-prone parts of the Map ADT.

| Type | Order Guarantee |
|------|-----------------|
| Java `HashMap` | **None**. Order may change on resize or between JVMs. |
| Java `TreeMap` | **Sorted** by natural order or comparator. Guaranteed by interface. |
| Java `LinkedHashMap` | **Insertion order**, or **access order** if `accessOrder=true`. |
| Java `ConcurrentHashMap` | **None**. Order may change concurrently with iteration. |
| Go `map` | **Randomized** intentionally. The runtime adds randomness so code does not depend on order. |
| Python `dict` (≥ 3.7) | **Insertion order**, guaranteed by the language spec. |
| Python `dict` (< 3.7, CPython 3.6) | Insertion order in CPython only; not portable. |
| Python `OrderedDict` | Insertion order; also supports `move_to_end`. |
| C++ `std::map` | **Sorted** by `Compare`. |
| C++ `unordered_map` | **None**. |

### Practical implication

```python
# This test passes on Python 3.7+ but failed on Python 3.5
d = {}
d["b"] = 1
d["a"] = 2
assert list(d.keys()) == ["b", "a"]   # OK on 3.7+
```

```go
// Go map iteration is randomized — this test is brittle by design
m := map[string]int{"a": 1, "b": 2}
for k := range m {  // order varies between runs!
    fmt.Println(k)
}
```

---

## The Key Contract — Deeper

### Java: `equals` and `hashCode`

The contract: if `a.equals(b)` is true, then `a.hashCode() == b.hashCode()` must hold. Violating this breaks lookup.

```java
// BROKEN: equals overridden, hashCode forgotten
class Person {
    String name;
    Person(String n) { this.name = n; }

    @Override
    public boolean equals(Object o) {
        return o instanceof Person && ((Person)o).name.equals(this.name);
    }
    // hashCode not overridden — defaults to Object.hashCode (identity)
}

Map<Person, Integer> m = new HashMap<>();
m.put(new Person("alice"), 95);
m.get(new Person("alice")); // returns null! Different hashCode -> different bucket.
```

Fix: always override both, or use `record` (Java 14+) which generates them.

### Go: comparable types only

Go forbids using slices, maps, and functions as keys at compile time. Structs are valid keys if all fields are comparable.

```go
// OK: struct of comparable types
type Coord struct{ X, Y int }
m := map[Coord]string{}
m[Coord{1, 2}] = "origin shift"

// COMPILE ERROR: slice is not comparable
// m := map[[]int]string{}
```

### Python: `__hash__` and `__eq__`

A class with custom `__eq__` must also define `__hash__` (or be marked unhashable). `@dataclass(frozen=True)` is the easiest correct path.

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Coord:
    x: int
    y: int

m = {Coord(1, 2): "origin shift"}
print(m[Coord(1, 2)])  # works: dataclass generates __hash__ and __eq__
```

---

## Default-Value Patterns and APIs

Each language ships an idiomatic "get-or-default" tool. Knowing them removes a lot of boilerplate.

### Go

```go
// Comma-ok is the idiom; there is no getOrDefault.
v, ok := m[k]
if !ok {
    v = defaultValue
}
m[k] = v + 1

// For counters, just rely on zero value:
m[k]++ // m[k] is 0 if absent

// For map of slice: append works on nil slice
m := map[string][]int{}
m["k"] = append(m["k"], 1)
```

### Java

```java
// getOrDefault — safe read with fallback
int count = freq.getOrDefault(k, 0);

// computeIfAbsent — lazy initialization, returns the value
List<String> bucket = groups.computeIfAbsent(k, key -> new ArrayList<>());
bucket.add("item");

// merge — counter / combine pattern
freq.merge(k, 1, Integer::sum);

// putIfAbsent — only insert if missing, returns existing or null
cache.putIfAbsent("default", computeExpensive());

// compute — read-modify-write atomically (for ConcurrentHashMap)
map.compute(k, (key, v) -> v == null ? 1 : v + 1);
```

### Python

```python
# .get(k, default) — safe read
count = freq.get(k, 0)

# setdefault — insert default if missing, return current value
groups.setdefault(k, []).append("item")

# defaultdict — auto-create default on missing access
from collections import defaultdict
counts = defaultdict(int)
counts[k] += 1   # works even if k absent

# Counter — purpose-built for counting
from collections import Counter
c = Counter(["a", "b", "a"])
print(c["a"])    # 2
print(c["z"])    # 0 (does not insert)
```

---

## Multimap Pattern

A **multimap** is "one key, many values." Built from a primitive Map by storing a List/Set as the value.

#### Go

```go
package main

import "fmt"

func groupByFirstLetter(words []string) map[byte][]string {
	groups := map[byte][]string{}
	for _, w := range words {
		if len(w) == 0 {
			continue
		}
		k := w[0]
		groups[k] = append(groups[k], w) // append to nil slice is OK
	}
	return groups
}

func main() {
	groups := groupByFirstLetter([]string{"apple", "ant", "banana", "berry"})
	for k, vs := range groups {
		fmt.Printf("%c: %v\n", k, vs)
	}
}
```

#### Java

```java
import java.util.*;

public class Multimap {
    public static Map<Character, List<String>> groupByFirstLetter(List<String> words) {
        Map<Character, List<String>> groups = new HashMap<>();
        for (String w : words) {
            if (w.isEmpty()) continue;
            groups.computeIfAbsent(w.charAt(0), k -> new ArrayList<>()).add(w);
        }
        return groups;
    }

    public static void main(String[] args) {
        var g = groupByFirstLetter(List.of("apple", "ant", "banana", "berry"));
        g.forEach((k, v) -> System.out.println(k + ": " + v));
    }
}
```

#### Python

```python
from collections import defaultdict

def group_by_first_letter(words: list[str]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for w in words:
        if w:
            groups[w[0]].append(w)
    return dict(groups)

if __name__ == "__main__":
    for k, v in group_by_first_letter(["apple", "ant", "banana", "berry"]).items():
        print(f"{k}: {v}")
```

> For Java, Guava's `Multimap` and `MultimapBuilder` are battle-tested alternatives.

---

## Map as Building Block for Other ADTs

Many ADTs are thin wrappers over a Map.

| ADT | Map encoding |
|-----|--------------|
| **Set** | `Map<K, ()>` — value is a unit type or constant `true`. See `06-sets`. |
| **Multiset / Bag** | `Map<K, Integer>` — value is the count. See `07-multiset-bag`. |
| **Cache** | `Map<K, V>` + eviction policy (LRU, LFU, TTL). |
| **Index** | `Map<AttrValue, List<Record>>` — for fast lookup by non-key fields. |
| **Adjacency list** | `Map<Node, List<Edge>>` — graph representation. |
| **Dispatch table** | `Map<Command, Handler>` — replaces switch statements. |
| **Symbol table** | `Map<Name, Binding>` — compiler / interpreter. |

### Dispatch table example

#### Go

```go
type Handler func(args []string) error

func main() {
	dispatch := map[string]Handler{
		"start": func(args []string) error { return nil },
		"stop":  func(args []string) error { return nil },
		"info":  func(args []string) error { return nil },
	}

	cmd := "start"
	if h, ok := dispatch[cmd]; ok {
		_ = h(nil)
	}
}
```

#### Java

```java
import java.util.Map;
import java.util.function.Function;

Map<String, Function<String[], Integer>> dispatch = Map.of(
    "start", args -> 0,
    "stop",  args -> 0,
    "info",  args -> 0
);
dispatch.getOrDefault("start", a -> -1).apply(new String[]{});
```

#### Python

```python
def start(args): return 0
def stop(args):  return 0
def info(args):  return 0

dispatch = {"start": start, "stop": stop, "info": info}
dispatch.get("start", lambda a: -1)([])
```

---

## Mutable-Key Footguns

The most subtle Map bug: **changing a key after it has been inserted**.

```python
class Box:
    def __init__(self, items):
        self.items = items
    def __hash__(self):
        return hash(tuple(self.items))
    def __eq__(self, o):
        return isinstance(o, Box) and self.items == o.items

m = {}
b = Box([1, 2, 3])
m[b] = "value"

b.items.append(4)        # mutate the key
print(m.get(b))          # None — hash changed; entry unreachable
print(list(m.keys())[0]) # still the same b object, but at the OLD hash bucket
```

**Rules**:

1. Prefer **immutable keys**: strings, ints, tuples, frozen records.
2. If you must use mutable objects as keys, **deep-copy** on insertion or do not mutate after insertion.
3. In Java, never insert an object whose `hashCode` can change.

### Go's protection

Go forbids slices and maps as keys at compile time. But you can still shoot yourself: a struct with a pointer field is comparable, but if you mutate what it points to (and your hash logic uses dereferenced data), you have the same bug.

---

## Integration Patterns

### Pattern 1: Caching with a Map + TTL

```text
map: K -> (V, expiry_timestamp)
get(k):
  if expired or absent -> miss
  else                  -> hit
```

### Pattern 2: Two-Way Map (BiMap)

When you need `K -> V` AND `V -> K` lookups: maintain two Maps. Insertions and deletions must update both atomically.

### Pattern 3: Memoization

```python
from functools import lru_cache

@lru_cache(maxsize=1024)
def fib(n):
    if n < 2: return n
    return fib(n-1) + fib(n-2)
```

Internally `lru_cache` uses an OrderedDict-style Map with access-order eviction.

### Pattern 4: Index into a List

```text
items:    [User(id=7), User(id=3), User(id=12)]
by_id:    Map<int, *User>  -> by_id[7] = &items[0]
```

The Map stores **references** into the canonical list. Mutating users via the list updates the references; deletions must remove from both.

### Pattern 5: Grouping / GROUP BY in SQL

`Map<GroupKey, Aggregate>` is the in-memory equivalent of SQL `GROUP BY`.

```python
from collections import defaultdict
totals = defaultdict(int)
for order in orders:
    totals[order.customer_id] += order.amount
```

---

## Performance Analysis

#### Go

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	sizes := []int{1_000, 10_000, 100_000, 1_000_000}
	for _, n := range sizes {
		m := make(map[int]int, n)
		start := time.Now()
		for i := 0; i < n; i++ {
			m[i] = i
		}
		writeMs := time.Since(start).Milliseconds()

		start = time.Now()
		for i := 0; i < n; i++ {
			_ = m[i]
		}
		readMs := time.Since(start).Milliseconds()

		fmt.Printf("n=%d  write=%dms  read=%dms\n", n, writeMs, readMs)
	}
}
```

#### Java

```java
import java.util.*;

public class MapBench {
    public static void main(String[] args) {
        int[] sizes = {1_000, 10_000, 100_000, 1_000_000};
        for (int n : sizes) {
            Map<Integer, Integer> m = new HashMap<>(n);
            long t0 = System.nanoTime();
            for (int i = 0; i < n; i++) m.put(i, i);
            long write = System.nanoTime() - t0;

            t0 = System.nanoTime();
            for (int i = 0; i < n; i++) m.get(i);
            long read = System.nanoTime() - t0;

            System.out.printf("n=%d  write=%dms  read=%dms%n",
                n, write/1_000_000, read/1_000_000);
        }
    }
}
```

#### Python

```python
import time

for n in [1_000, 10_000, 100_000, 1_000_000]:
    d = {}
    t0 = time.perf_counter()
    for i in range(n):
        d[i] = i
    write = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    for i in range(n):
        _ = d[i]
    read = (time.perf_counter() - t0) * 1000

    print(f"n={n}  write={write:.1f}ms  read={read:.1f}ms")
```

Expected pattern: write and read scale linearly with n; HashMap stays roughly constant per-operation, TreeMap grows log n per operation (visible at large n).

---

## Best Practices

- **Pre-size when N is known.** `make(map[K]V, n)`, `new HashMap<>(n)`, `dict.fromkeys(...)` cut resize cost.
- **Pick the right backing.** HashMap by default, TreeMap for sorted/range, LinkedHashMap for ordered iteration.
- **Use `getOrDefault` / `computeIfAbsent` / `defaultdict` / merge / `setdefault`.** They cut boilerplate and atomicize updates.
- **Make keys immutable.** Strings, ints, tuples, frozen dataclasses, records.
- **Document iteration order assumptions.** If your code depends on insertion order, say so in a comment.
- **Do not mutate during iteration.** Collect changes, apply after.
- **Snapshot keys for safe iteration:** `for k in list(d):` in Python, `new ArrayList<>(m.keySet())` in Java.
- **For wide-fanout maps in Java**, set the initial capacity above the load factor threshold to avoid early resizes.

---

## Summary

The Map ADT comes with three first-class backings and one common compound (insertion-ordered hash). At middle level you stop reaching for `HashMap` reflexively and start asking: do I need order? do I need range queries? do many threads touch this? what's the key contract for my type?

Master the default-value APIs in your language — they cut the most boilerplate and prevent the most bugs. Treat the multimap and bimap patterns as standard tools. Never trust iteration order without checking the spec.
