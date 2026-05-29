# Multiset / Bag — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Set vs. Multiset](#set-vs-multiset)
3. [Real-World Analogies](#real-world-analogies)
4. [Core Concepts](#core-concepts)
   - [Element and Multiplicity](#element-and-multiplicity)
   - [Size vs. Distinct Count](#size-vs-distinct-count)
5. [Operations](#operations)
6. [Big-O Summary](#big-o-summary)
7. [Underlying Implementations](#underlying-implementations)
   - [Hash-Backed](#hash-backed)
   - [Tree-Backed](#tree-backed)
8. [Full Implementation — Hash Multiset](#full-implementation-hash-multiset)
   - [Go](#go-implementation)
   - [Java](#java-implementation)
   - [Python](#python-implementation)
9. [Worked Examples](#worked-examples)
10. [Pros & Cons](#pros--cons)
11. [Common Mistakes](#common-mistakes)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)

---

## Introduction

A **multiset** (also called a **bag**) is a collection that allows **duplicate elements**. It is the close cousin of the set: where a set asks "is this element present?", a multiset asks "how many times is this element present?".

Internally a multiset is almost always represented as a map from element to non-negative integer count: `element -> count`. If you have already met `HashMap`, `dict`, or `Counter`, you already know 90% of how multisets work — the rest is naming and a handful of dedicated operations.

This topic builds on:
- [06-sets](../06-sets/junior.md) — for the contrast between set and multiset semantics.
- [08-map-dictionary](../08-map-dictionary/junior.md) — for the underlying `key -> value` machinery.

Here we focus on what makes a multiset its own data structure: multiplicity, multiset algebra, and the "counter pattern" that shows up everywhere in interviews and production code.

---

## Set vs. Multiset

| Aspect | Set | Multiset (Bag) |
|--------|-----|----------------|
| Duplicates allowed? | No | Yes |
| Stored per element | Presence (yes/no) | Count (0, 1, 2, ...) |
| `add(x)` on existing | No-op | Increments count |
| `remove(x)` | Removes entry | Decrements count (entry stays if count > 0) |
| `size()` | Number of distinct elements | Total elements **with duplicates** |
| Mathematical model | Characteristic function `f: U -> {0, 1}` | Multiplicity function `f: U -> N` |

A set is just a multiset whose counts are capped at 1. A list/array is a multiset that also remembers insertion order. A multiset sits in the middle: it cares about quantity but not order.

---

## Real-World Analogies

### 1. Grocery Cart

You can have three apples, two cartons of milk, and one loaf of bread in your cart. The cart does not care which apple you picked up first — only that there are **three apples**. That is exactly a multiset: `{apple: 3, milk: 2, bread: 1}`.

### 2. Ballot Box

After an election the ballot box contains one vote per voter, but the **count** of votes per candidate is what matters. The tally is a multiset: `{Alice: 1287, Bob: 1042, Carol: 894}`.

### 3. Word Frequency

A book is a sequence of words, but for analysis you often want the multiset `{the: 12_403, of: 9_812, and: 8_211, ...}`. This is the foundation of every "word cloud," every spam filter, every tf-idf computation.

### 4. Inventory

A warehouse holds 47 widgets, 12 gadgets, 3 sprockets. Reorder triggers fire when a count drops below a threshold. The inventory is a multiset over SKUs.

> Where the analogy breaks: a real cart has a fixed capacity and physical position; a multiset is purely abstract — it stores only `(element, count)` pairs.

---

## Core Concepts

### Element and Multiplicity

For every element `x`, the multiset stores a **multiplicity** `count(x) >= 0`. By convention, elements absent from the multiset have multiplicity 0 — they are not stored, but `count(x)` is still defined.

```
M = { apple: 3, milk: 2, bread: 1 }
count(apple) = 3
count(banana) = 0     <-- not stored, but defined
```

### Size vs. Distinct Count

Two different notions of "how many":

| Method | Returns | Example for `{apple:3, milk:2, bread:1}` |
|--------|---------|-----------------------------------------|
| `size()` (a.k.a. `total()`) | Sum of all counts | `3 + 2 + 1 = 6` |
| `distinct()` (a.k.a. `entrySize()`) | Number of distinct elements | `3` |

Confusing these two is a leading cause of subtle bugs (see [Common Mistakes](#common-mistakes)).

---

## Operations

| Operation | Description |
|-----------|-------------|
| `add(x)` | Increments `count(x)` by 1 |
| `add(x, k)` | Increments `count(x)` by `k` |
| `remove(x)` | Decrements `count(x)` by 1 (no-op if count is 0) |
| `removeAll(x)` | Sets `count(x)` to 0 (removes the key entirely) |
| `count(x)` | Returns `count(x)` (0 if absent) |
| `contains(x)` | Returns `count(x) > 0` |
| `size()` / `total()` | Sum of all counts (with duplicates) |
| `distinct()` | Number of distinct elements |
| `iterate()` | Yields each element, repeated `count(x)` times |
| `iterateDistinct()` | Yields each distinct element exactly once |
| `mostCommon(k)` | Returns the `k` elements with highest counts |

---

## Big-O Summary

For a hash-backed multiset of `n` distinct elements:

| Operation | Average | Worst | Notes |
|-----------|---------|-------|-------|
| `add(x)` | O(1) | O(n) | Same as `HashMap.put` |
| `remove(x)` | O(1) | O(n) | Decrement and maybe delete key |
| `count(x)` | O(1) | O(n) | Pure map lookup |
| `distinct()` | O(1) | O(1) | Tracked as `map.size()` |
| `size()` / `total()` | O(1) | O(1) | Cached separately as a running sum |
| `iterate()` | O(N) | O(N) | N = total count including duplicates |
| `mostCommon(k)` | O(n log k) | O(n log k) | Min-heap of size k over n distinct |

For a tree-backed multiset (red-black tree / std::multiset) replace average O(1) with worst-case O(log n) but gain sorted iteration.

---

## Underlying Implementations

### Hash-Backed

A `HashMap<T, int>` is the default. Constant-time add/remove/count. No ordering. Used by Python's `collections.Counter`, Guava's `HashMultiset`, and any idiomatic Go `map[T]int`.

### Tree-Backed

A balanced BST (`TreeMap<T, int>`) keeps elements sorted by key. `add/remove/count` become O(log n) but you get bonus operations: smallest element, largest element, range queries like "how many elements between 10 and 20?", in-order iteration. Used by C++ `std::multiset` (the standard library actually stores each duplicate as a separate node) and Guava's `TreeMultiset`.

A briefly-used third option is the **sorted array with run-length encoding** — store `[(elem1, n1), (elem2, n2), ...]` sorted by element. Compact and cache-friendly when reads dominate but writes are O(n). Useful only when the element set is small and rarely changes.

---

## Full Implementation — Hash Multiset

Below is a complete `Multiset<String>` with `add`, `remove`, `count`, `size`, `distinct`, and iteration. It maintains a cached `total` so `size()` stays O(1) regardless of the number of distinct elements.

### Go Implementation

```go
package multiset

import "fmt"

// Multiset is a hash-backed bag of strings.
type Multiset struct {
	counts map[string]int
	total  int
}

// New creates an empty Multiset.
func New() *Multiset {
	return &Multiset{counts: make(map[string]int)}
}

// Add increments the count of x by 1.
func (m *Multiset) Add(x string) {
	m.AddN(x, 1)
}

// AddN increments the count of x by n (n must be >= 0).
func (m *Multiset) AddN(x string, n int) {
	if n <= 0 {
		return
	}
	m.counts[x] += n
	m.total += n
}

// Remove decrements the count of x by 1.
// Returns true if an element was actually removed.
// Deletes the key entirely once count reaches 0.
func (m *Multiset) Remove(x string) bool {
	c, ok := m.counts[x]
	if !ok || c == 0 {
		return false
	}
	if c == 1 {
		delete(m.counts, x) // critical: avoid memory leak of zero-count keys
	} else {
		m.counts[x] = c - 1
	}
	m.total--
	return true
}

// RemoveAll removes every occurrence of x.
func (m *Multiset) RemoveAll(x string) int {
	c := m.counts[x]
	if c > 0 {
		delete(m.counts, x)
		m.total -= c
	}
	return c
}

// Count returns the multiplicity of x (0 if absent).
func (m *Multiset) Count(x string) int {
	return m.counts[x]
}

// Contains reports whether x has count > 0.
func (m *Multiset) Contains(x string) bool {
	return m.counts[x] > 0
}

// Size returns the total number of elements including duplicates.
func (m *Multiset) Size() int {
	return m.total
}

// Distinct returns the number of unique elements.
func (m *Multiset) Distinct() int {
	return len(m.counts)
}

// Each calls fn(element, count) for every distinct element.
func (m *Multiset) Each(fn func(elem string, count int)) {
	for k, v := range m.counts {
		fn(k, v)
	}
}

// String returns a deterministic-ish debug representation.
func (m *Multiset) String() string {
	return fmt.Sprintf("Multiset%v", m.counts)
}

// Usage example:
// func main() {
//     m := multiset.New()
//     m.Add("apple")
//     m.Add("apple")
//     m.Add("banana")
//     fmt.Println(m.Count("apple"))   // 2
//     fmt.Println(m.Size())           // 3
//     fmt.Println(m.Distinct())       // 2
//     m.Remove("apple")
//     fmt.Println(m.Count("apple"))   // 1
// }
```

### Java Implementation

```java
import java.util.HashMap;
import java.util.Map;
import java.util.function.BiConsumer;

/**
 * Hash-backed multiset of strings.
 * Maintains a running total so size() is O(1).
 */
public class Multiset {

    private final Map<String, Integer> counts = new HashMap<>();
    private int total = 0;

    /** Increment count of x by 1. */
    public void add(String x) {
        addN(x, 1);
    }

    /** Increment count of x by n (n >= 0). */
    public void addN(String x, int n) {
        if (n <= 0) return;
        counts.merge(x, n, Integer::sum);
        total += n;
    }

    /**
     * Decrement count of x by 1.
     * Returns true if an occurrence was removed.
     * Removes the key entirely once count reaches 0 to avoid memory leaks.
     */
    public boolean remove(String x) {
        Integer c = counts.get(x);
        if (c == null || c == 0) return false;
        if (c == 1) {
            counts.remove(x);
        } else {
            counts.put(x, c - 1);
        }
        total--;
        return true;
    }

    /** Remove every occurrence of x. Returns the count that was removed. */
    public int removeAll(String x) {
        Integer c = counts.remove(x);
        if (c == null) return 0;
        total -= c;
        return c;
    }

    /** Returns the multiplicity of x (0 if absent). */
    public int count(String x) {
        return counts.getOrDefault(x, 0);
    }

    public boolean contains(String x) {
        return counts.containsKey(x);
    }

    /** Total elements including duplicates. */
    public int size() {
        return total;
    }

    /** Number of distinct elements. */
    public int distinct() {
        return counts.size();
    }

    public void each(BiConsumer<String, Integer> fn) {
        counts.forEach(fn);
    }

    @Override
    public String toString() {
        return "Multiset" + counts;
    }

    // Usage example:
    // public static void main(String[] args) {
    //     Multiset m = new Multiset();
    //     m.add("apple");
    //     m.add("apple");
    //     m.add("banana");
    //     System.out.println(m.count("apple"));   // 2
    //     System.out.println(m.size());           // 3
    //     System.out.println(m.distinct());       // 2
    //     m.remove("apple");
    //     System.out.println(m.count("apple"));   // 1
    // }
}
```

### Python Implementation

```python
"""Hash-backed multiset of arbitrary hashable elements."""

from typing import Callable, Hashable, Iterator


class Multiset:
    """A bag that allows duplicate elements.

    All count-mutating operations preserve the invariant:
        total == sum(counts.values())
    """

    __slots__ = ("_counts", "_total")

    def __init__(self) -> None:
        self._counts: dict[Hashable, int] = {}
        self._total: int = 0

    def add(self, x: Hashable, n: int = 1) -> None:
        """Increment count of x by n. n must be >= 0."""
        if n <= 0:
            return
        self._counts[x] = self._counts.get(x, 0) + n
        self._total += n

    def remove(self, x: Hashable) -> bool:
        """Decrement count of x by 1. Returns True if removed."""
        c = self._counts.get(x, 0)
        if c == 0:
            return False
        if c == 1:
            del self._counts[x]  # avoid lingering zero-count keys
        else:
            self._counts[x] = c - 1
        self._total -= 1
        return True

    def remove_all(self, x: Hashable) -> int:
        c = self._counts.pop(x, 0)
        self._total -= c
        return c

    def count(self, x: Hashable) -> int:
        return self._counts.get(x, 0)

    def __contains__(self, x: Hashable) -> bool:
        return self._counts.get(x, 0) > 0

    def __len__(self) -> int:
        """Total elements including duplicates."""
        return self._total

    def distinct(self) -> int:
        return len(self._counts)

    def __iter__(self) -> Iterator[Hashable]:
        """Iterate elements WITH duplicates."""
        for elem, c in self._counts.items():
            for _ in range(c):
                yield elem

    def distinct_iter(self) -> Iterator[Hashable]:
        return iter(self._counts)

    def each(self, fn: Callable[[Hashable, int], None]) -> None:
        for k, v in self._counts.items():
            fn(k, v)

    def __repr__(self) -> str:
        return f"Multiset({self._counts!r})"


# Usage example:
# if __name__ == "__main__":
#     m = Multiset()
#     m.add("apple")
#     m.add("apple")
#     m.add("banana")
#     print(m.count("apple"))   # 2
#     print(len(m))             # 3
#     print(m.distinct())       # 2
#     m.remove("apple")
#     print(m.count("apple"))   # 1
```

---

## Worked Examples

### Example 1: Character Frequency

Count how many times each letter appears in a string.

#### Go

```go
package main

import "fmt"

func charFrequency(s string) map[rune]int {
	freq := map[rune]int{}
	for _, r := range s {
		freq[r]++
	}
	return freq
}

func main() {
	fmt.Println(charFrequency("hello")) // map[e:1 h:1 l:2 o:1]
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class CharFrequency {
    public static Map<Character, Integer> charFrequency(String s) {
        Map<Character, Integer> freq = new HashMap<>();
        for (char c : s.toCharArray()) {
            freq.merge(c, 1, Integer::sum);
        }
        return freq;
    }

    public static void main(String[] args) {
        System.out.println(charFrequency("hello")); // {h=1, e=1, l=2, o=1}
    }
}
```

#### Python

```python
from collections import Counter

def char_frequency(s: str) -> dict[str, int]:
    return dict(Counter(s))

if __name__ == "__main__":
    print(char_frequency("hello"))  # {'h': 1, 'e': 1, 'l': 2, 'o': 1}
```

**What it does:** Iterates once, incrementing the count for each character. This is the bedrock "counter pattern" we will revisit at every level.

### Example 2: Multiset Equality (Anagram Check)

Two strings are anagrams when their **character multisets are equal**.

#### Go

```go
package main

import "fmt"

func areAnagrams(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	counts := map[rune]int{}
	for _, r := range a {
		counts[r]++
	}
	for _, r := range b {
		counts[r]--
		if counts[r] < 0 {
			return false
		}
	}
	return true
}

func main() {
	fmt.Println(areAnagrams("listen", "silent")) // true
	fmt.Println(areAnagrams("hello", "world"))   // false
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class Anagram {
    public static boolean areAnagrams(String a, String b) {
        if (a.length() != b.length()) return false;
        Map<Character, Integer> counts = new HashMap<>();
        for (char c : a.toCharArray()) counts.merge(c, 1, Integer::sum);
        for (char c : b.toCharArray()) {
            int next = counts.getOrDefault(c, 0) - 1;
            if (next < 0) return false;
            counts.put(c, next);
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(areAnagrams("listen", "silent")); // true
        System.out.println(areAnagrams("hello", "world"));   // false
    }
}
```

#### Python

```python
from collections import Counter

def are_anagrams(a: str, b: str) -> bool:
    return Counter(a) == Counter(b)

if __name__ == "__main__":
    print(are_anagrams("listen", "silent"))  # True
    print(are_anagrams("hello", "world"))    # False
```

**What it does:** Build the multiset for `a`, then decrement for each character of `b`. If any count ever goes negative we have a mismatch. Python collapses this into a single `Counter` equality comparison.

---

## Pros & Cons

| Pros | Cons |
|------|------|
| O(1) average add/remove/count | Hash version has no ordering |
| Memory proportional to distinct elements, not total count | Mutable keys break the structure |
| Maps directly to a familiar `HashMap` | Forgetting to delete zero-count keys leaks memory |
| Library support everywhere (`Counter`, `Multiset`, `std::multiset`) | Tree version pays O(log n) per op |

**When to use a multiset:**
- Frequency counting (characters, words, log lines, requests).
- Anagram / permutation checks.
- Maintaining a "remaining inventory" you decrement.
- Tracking how many copies of each value live in a sliding window.

**When NOT to use:**
- You need to preserve insertion order -> use a list.
- You only care about presence -> use a set (no counts needed).
- The element domain is small and dense (`0..255`) -> a plain array of counters is faster and lower-memory.

---

## Common Mistakes

| Mistake | Why It Breaks |
|---------|--------------|
| Leaving `count == 0` entries in the map | Memory grows without bound in long-running counters. Always `delete` once count hits 0. |
| Confusing `size()` with `distinct()` | `{apple:3}` has size 3 but only 1 distinct element. |
| Allowing `remove` to push count below 0 | Underflow corrupts the running `total` and produces phantom "negative bags." |
| Mutating an element after insertion | If the element is the map key, its hash changes and the entry becomes unreachable. |
| Iterating with duplicates when you meant distinct | A 1-million-count entry yields 1 million iterations, not one. |
| Comparing two multisets with `==` on the wrong types | `Counter == Counter` works in Python; `HashMap == HashMap` in Java works **only** if zero-count entries are removed in both. |

---

## Cheat Sheet

| Operation | Time | Space | Notes |
|-----------|------|-------|-------|
| `add(x)` | O(1) avg | O(1) per distinct element | Hash-backed |
| `remove(x)` | O(1) avg | -- | Delete key on zero |
| `count(x)` | O(1) avg | -- | Pure lookup |
| `size()` / `total()` | O(1) | -- | Maintain running sum |
| `distinct()` | O(1) | -- | `map.size()` |
| Iterate all | O(N) | -- | N = total count |
| Iterate distinct | O(n) | -- | n = distinct count |
| `mostCommon(k)` | O(n log k) | O(k) | Min-heap of size k |

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive multiset visualization.
>
> The animation displays each distinct element as a bar whose height is its count. Buttons let you add elements, remove elements, query a count, and ask for the most-common item. The stats bar tracks `distinct` and `total` in real time so you can build intuition for the two-faced size question.

---

## Summary

| Concept | Key Point |
|---------|-----------|
| **Multiset (Bag)** | Set + duplicate-tracking via per-element counts |
| **Storage** | `map[element] -> count`, with `count > 0` |
| **size vs distinct** | size = sum of counts; distinct = number of keys |
| **Default backend** | `HashMap` for O(1); `TreeMap` for sorted O(log n) |
| **Core operations** | `add`, `remove`, `count`, `size`, `distinct`, `mostCommon` |
| **Bedrock pattern** | "Counter pattern" — anagrams, word frequency, top-k |
| **Watch out for** | Zero-count keys, mutable keys, negative counts |

Multisets feel like a small generalization of sets, but the "count, don't just check" mindset unlocks an outsized fraction of real interview problems and production data tasks. Master the counter pattern here at the junior level; in middle.md we will see it inside sliding windows, frequency-difference algorithms, and multiset algebra.

---

## Further Reading

- Python: `collections.Counter` docs.
- Java: Google Guava `Multiset` (`HashMultiset`, `TreeMultiset`, `LinkedHashMultiset`).
- C++: `std::multiset`, `std::unordered_multiset`.
- *Introduction to Algorithms* (CLRS) — Chapter 11 on hash tables (the foundation).
- visualgo.net — hash table visualizer (same backbone).
