# Map / Dictionary (Associative Array ADT) — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [What Is a Map?](#what-is-a-map)
5. [The Map ADT — Operations](#the-map-adt--operations)
6. [Real-World Analogies](#real-world-analogies)
7. [Implementations of the Map ADT](#implementations-of-the-map-adt)
8. [Big-O Summary](#big-o-summary)
9. [Built-In Map Types in Go, Java, Python](#built-in-map-types-in-go-java-python)
10. [Code Examples](#code-examples)
11. [Iteration and Ordering](#iteration-and-ordering)
12. [Default Value Patterns](#default-value-patterns)
13. [The Key Contract](#the-key-contract)
14. [Pros and Cons](#pros-and-cons)
15. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
16. [Common Mistakes](#common-mistakes)
17. [Cheat Sheet](#cheat-sheet)
18. [Visual Animation](#visual-animation)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

## Introduction

> Focus: "What is a Map ADT?" and "How is it different from a Hash Table?"

A **Map** (also called **Dictionary**, **Associative Array**, or just **table**) is one of the most useful data structures in everyday programming. It stores **key-value pairs** and lets you look up a value by its key.

This topic is about the **Map ADT** — the **contract**, not any single implementation. A Map can be **backed by** a hash table, a balanced binary search tree, a skip list, or even a sorted array. Each backing has different trade-offs, but the **interface** stays the same.

> The hash-table topic (`05-hash-tables`) teaches one **implementation**. This topic teaches the **interface** and how to choose between implementations.

---

## Prerequisites

- **Required:** Basic programming — variables, loops, functions, conditionals
- **Required:** Familiarity with arrays and lists
- **Helpful:** Read `05-hash-tables/junior.md` first — it covers the most common backing
- **Helpful:** Big-O notation basics (`06-algorithmic-complexity`)

---

## Glossary

| Term | Definition |
|------|-----------|
| **Map / Dictionary** | An abstract data type that stores key-value pairs and supports lookup by key |
| **ADT** | Abstract Data Type — a specification of operations, not an implementation |
| **Key** | The identifier used to find a value |
| **Value** | The data associated with a key |
| **Entry** | A `(key, value)` pair |
| **Backing** | The concrete data structure that implements the ADT (hash table, BST, etc.) |
| **Unordered map** | A map with no defined key iteration order |
| **Ordered map** | A map whose keys iterate in sorted order |
| **Insertion-ordered map** | A map whose keys iterate in the order they were inserted |
| **Key contract** | The rules a key type must satisfy (equality, hashability, comparability) |
| **Comma-ok idiom** | Go's pattern: `value, ok := m[key]` — distinguishes "absent" from "present with zero value" |

---

## What Is a Map?

A Map is a **partial function** from keys to values. "Partial" means not every possible key has a value — only keys that have been inserted do.

```text
m: Key -> Value | absent

m("alice") = 95
m("bob")   = 82
m("carol") = absent   <-- never inserted
```

Three properties define a Map:

1. **Keys are unique.** Inserting `("alice", 100)` after `("alice", 95)` **replaces** the old value.
2. **Lookup is by key, not by position.** Unlike an array, you do not access `m[0]` — you access `m["alice"]`.
3. **No defined order** (in the basic ADT). Some implementations add ordering as an extra guarantee.

A Map is the right tool whenever you think "given X, what is Y?":
- Given a **username**, what is the **user record**?
- Given a **word**, what is its **frequency**?
- Given a **product SKU**, what is the **price**?
- Given an **HTTP status code**, what is the **status message**?

---

## The Map ADT — Operations

The Map ADT defines a set of operations. Different languages name them differently, but the contract is the same.

| Operation | Description | Returns |
|-----------|------------|---------|
| `put(k, v)` | Insert or update entry for key `k` | previous value, or absent |
| `get(k)` | Look up value by key | value, or absent |
| `remove(k)` | Delete entry for key `k` | removed value, or absent |
| `containsKey(k)` | Test whether key `k` is present | boolean |
| `size()` | Number of entries | integer |
| `isEmpty()` | Is size zero? | boolean |
| `keys()` | All keys (as collection) | iterable |
| `values()` | All values (as collection) | iterable |
| `entries()` | All `(key, value)` pairs | iterable |
| `clear()` | Remove all entries | void |

### "Absent" vs "null value"

There is a subtle but important distinction:

- **Key not present** — `containsKey(k)` returns false
- **Key present, value is null/None/nil** — `containsKey(k)` returns true

Languages handle this differently:

| Language | Distinguishes? | Mechanism |
|----------|----------------|-----------|
| **Go** | Yes | Comma-ok: `v, ok := m[k]` |
| **Java** | Sometimes | `get` returns `null` for both; use `containsKey` to distinguish |
| **Python** | Yes | `KeyError` on `d[k]`, or use `in` / `get(k, default)` |

This matters when `null` is a valid value:

```text
m["alice"] = null   <-- present, value is null
m["bob"]   = absent <-- never inserted

get(m, "alice") -> null (Java: ambiguous!)
get(m, "bob")   -> null
```

---

## Real-World Analogies

### 1. Phone Book

A phone book maps **names** to **phone numbers**. You look up by name. Some phone books are sorted (ordered map); a digital contact list might be insertion-ordered.

### 2. English Dictionary

A dictionary maps **words** to **definitions**. Real dictionaries are **sorted alphabetically** — an example of an ordered map. You scan by word, not by page number.

### 3. Library Catalog

A catalog maps **call numbers** to **books**. Given the call number you can locate the book. The catalog itself does not store books in call-number order — it just records the mapping.

### 4. Environment Variables

`os.environ` maps **variable names** to **string values**. The OS gives you `PATH`, `HOME`, `USER`. You query by name.

### 5. Restaurant Menu

A menu maps **dish names** to **prices and descriptions**. You order by name; the kitchen looks up what to prepare. Menus often have an order (appetizers, mains, desserts) — an insertion-ordered map.

> Where the analogy breaks: real-world objects (a book, a dish) are physical; a Map entry is just a binding. Deleting a Map entry does not destroy the value — other references may still hold it.

---

## Implementations of the Map ADT

The same Map interface can be implemented several ways. The choice affects performance and ordering.

### 1. Hash-Backed (Unordered Map)

- **Backing:** Hash table (see `05-hash-tables`)
- **Examples:** Go's `map`, Java's `HashMap`, Python's `dict`, C++ `unordered_map`
- **Big-O:** O(1) average for get/put/remove; O(n) worst case
- **Iteration order:** Undefined (or insertion-ordered as an implementation detail in Python 3.7+)

### 2. Tree-Backed (Ordered Map)

- **Backing:** Balanced BST (red-black tree usually)
- **Examples:** Java's `TreeMap`, C++ `std::map`, Python's `sortedcontainers.SortedDict`
- **Big-O:** O(log n) for get/put/remove
- **Iteration order:** Sorted by key
- **Extras:** Range queries, `firstKey`, `lastKey`, `floorKey`, `ceilingKey`

### 3. Insertion-Ordered Map

- **Backing:** Hash table + doubly-linked list of entries
- **Examples:** Java's `LinkedHashMap`, Python's `dict` (3.7+ guarantees this), PHP's array
- **Big-O:** O(1) average for get/put/remove
- **Iteration order:** Insertion order

### 4. Access-Ordered Map (LRU Pattern)

- **Backing:** Hash table + doubly-linked list, reordered on access
- **Examples:** Java's `LinkedHashMap` with `accessOrder=true`, Python's `OrderedDict.move_to_end`
- **Use:** Building blocks for LRU caches (see `21-advanced-structures/lru-cache`)

---

## Big-O Summary

| Operation | HashMap | TreeMap | LinkedHashMap |
|-----------|---------|---------|---------------|
| `get(k)` | O(1) avg / O(n) worst | O(log n) | O(1) avg |
| `put(k, v)` | O(1) avg | O(log n) | O(1) avg |
| `remove(k)` | O(1) avg | O(log n) | O(1) avg |
| `containsKey(k)` | O(1) avg | O(log n) | O(1) avg |
| Iterate all | O(n) | O(n) | O(n) |
| `firstKey` / `lastKey` | not supported | O(log n) | O(1) |
| Range query | not supported | O(log n + k) | not supported |

`k` = number of entries returned by the range query.

---

## Built-In Map Types in Go, Java, Python

| Language | Hash-Backed | Tree-Backed | Insertion-Ordered |
|----------|------------|-------------|-------------------|
| **Go** | `map[K]V` (builtin) | `github.com/google/btree` (3rd party) | manual: `map[K]V` + slice of keys |
| **Java** | `HashMap<K,V>` | `TreeMap<K,V>` | `LinkedHashMap<K,V>` |
| **Python** | `dict` (insertion-ordered since 3.7) | `sortedcontainers.SortedDict` (3rd party) | `dict` or `collections.OrderedDict` |

---

## Code Examples

### Example 1: Word Frequency Counter

We count how many times each word appears in a sentence. Classic Map use case.

#### Go

```go
package main

import (
	"fmt"
	"strings"
)

func wordFreq(text string) map[string]int {
	freq := make(map[string]int)
	for _, w := range strings.Fields(text) {
		freq[w]++ // zero value of int is 0; increment works on absent key
	}
	return freq
}

func main() {
	text := "the quick brown fox the lazy dog the fox"
	for w, n := range wordFreq(text) {
		fmt.Printf("%s: %d\n", w, n)
	}
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class WordFreq {
    public static Map<String, Integer> wordFreq(String text) {
        Map<String, Integer> freq = new HashMap<>();
        for (String w : text.split("\\s+")) {
            freq.merge(w, 1, Integer::sum); // 'merge' is idiomatic for counters
        }
        return freq;
    }

    public static void main(String[] args) {
        String text = "the quick brown fox the lazy dog the fox";
        wordFreq(text).forEach((w, n) -> System.out.println(w + ": " + n));
    }
}
```

#### Python

```python
from collections import Counter

def word_freq(text: str) -> dict[str, int]:
    return dict(Counter(text.split()))

if __name__ == "__main__":
    text = "the quick brown fox the lazy dog the fox"
    for w, n in word_freq(text).items():
        print(f"{w}: {n}")
```

**What it does:** Builds a Map from word to count. Uses each language's idiom for "increment-or-insert."
**Run:** `go run main.go` | `javac WordFreq.java && java WordFreq` | `python wordfreq.py`

---

### Example 2: Phone Book — Add, Lookup, Delete

A small phone book showing the basic CRUD operations of a Map.

#### Go

```go
package main

import "fmt"

func main() {
	phones := map[string]string{}

	// put
	phones["alice"] = "555-1234"
	phones["bob"] = "555-5678"

	// get with comma-ok: distinguishes absent from empty string
	if num, ok := phones["alice"]; ok {
		fmt.Println("alice:", num)
	}
	if _, ok := phones["carol"]; !ok {
		fmt.Println("carol not found")
	}

	// remove
	delete(phones, "bob")

	// size
	fmt.Println("entries:", len(phones))
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class PhoneBook {
    public static void main(String[] args) {
        Map<String, String> phones = new HashMap<>();

        phones.put("alice", "555-1234");
        phones.put("bob", "555-5678");

        // Distinguish absent vs null-valued with containsKey
        if (phones.containsKey("alice")) {
            System.out.println("alice: " + phones.get("alice"));
        }
        if (!phones.containsKey("carol")) {
            System.out.println("carol not found");
        }

        phones.remove("bob");
        System.out.println("entries: " + phones.size());
    }
}
```

#### Python

```python
phones: dict[str, str] = {}
phones["alice"] = "555-1234"
phones["bob"] = "555-5678"

# Use 'in' to test membership, get(k, default) to avoid KeyError
if "alice" in phones:
    print("alice:", phones["alice"])
if "carol" not in phones:
    print("carol not found")

del phones["bob"]
print("entries:", len(phones))
```

---

### Example 3: Ordered Map — Sorted Iteration

Iterate keys in sorted order. Hash-backed maps cannot do this; tree-backed can.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func main() {
	scores := map[string]int{"bob": 82, "alice": 95, "carol": 91}

	// Go's map iteration order is randomized. To iterate sorted,
	// extract keys, sort, then look up values.
	keys := make([]string, 0, len(scores))
	for k := range scores {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Printf("%s: %d\n", k, scores[k])
	}
}
```

#### Java

```java
import java.util.TreeMap;

public class SortedScores {
    public static void main(String[] args) {
        // TreeMap iterates keys in natural sorted order.
        TreeMap<String, Integer> scores = new TreeMap<>();
        scores.put("bob", 82);
        scores.put("alice", 95);
        scores.put("carol", 91);

        scores.forEach((k, v) -> System.out.println(k + ": " + v));
        // alice: 95, bob: 82, carol: 91
    }
}
```

#### Python

```python
scores = {"bob": 82, "alice": 95, "carol": 91}

# Plain dict preserves insertion order; sort keys for sorted iteration.
for k in sorted(scores):
    print(f"{k}: {scores[k]}")
```

---

## Iteration and Ordering

Iteration order is the **most surprising** aspect of Maps for new programmers.

| Backing | Iteration order |
|---------|-----------------|
| `HashMap` (Java) | Undefined — may change between runs |
| `Go map` | **Randomized intentionally** (Go does this so you do not depend on it) |
| `dict` (Python 3.7+) | Insertion order (CPython guarantee, then official spec) |
| `TreeMap` (Java), `std::map` (C++) | Sorted by key |
| `LinkedHashMap` (Java) | Insertion order |

> Rule: never rely on iteration order **unless the implementation documents one**. Code that "accidentally works" because keys happen to print alphabetically will break in production.

---

## Default Value Patterns

A common need: "get the value for key K, or some default if K is absent."

#### Go

```go
// Go does not have a built-in getOrDefault, but the comma-ok idiom is clean.
freq := map[string]int{}
count, ok := freq["apple"]
if !ok {
	count = 0
}
freq["apple"] = count + 1

// Shorter: zero value of int is 0, so for counters:
freq["apple"]++
```

#### Java

```java
// getOrDefault
int count = freq.getOrDefault("apple", 0);
freq.put("apple", count + 1);

// computeIfAbsent — for List<V> values
map.computeIfAbsent("apple", k -> new ArrayList<>()).add("red");

// merge — for counters
freq.merge("apple", 1, Integer::sum);
```

#### Python

```python
# .get() with default
count = freq.get("apple", 0)
freq["apple"] = count + 1

# collections.defaultdict — creates the default on missing access
from collections import defaultdict
freq = defaultdict(int)
freq["apple"] += 1   # int() returns 0

groups = defaultdict(list)
groups["fruit"].append("apple")
```

---

## The Key Contract

For a Map to work, the key type must satisfy certain rules.

| Language | Rules for key types |
|----------|--------------------|
| **Go** | Type must be **comparable** with `==`. Slices, maps, and functions are **not** comparable and cannot be keys. |
| **Java** | Must implement `equals()` and `hashCode()` consistently. If `a.equals(b)` then `a.hashCode() == b.hashCode()`. |
| **Python** | Must be **hashable** — implement `__hash__` and `__eq__`. Built-in immutable types (str, int, tuple of hashables) are hashable; lists and dicts are not. |

**Rule of thumb across all three:** Use **immutable keys**. Strings, integers, and tuples of immutables are safe. Mutable keys (lists, mutable objects) cause bugs if changed after insertion.

---

## Pros and Cons

| Pros | Cons |
|------|------|
| Average O(1) lookup with hash backing | Worst case O(n) under adversarial input |
| Clean intent: "map X to Y" | Memory overhead vs raw arrays |
| Built into every language | Hash-backed has unpredictable iteration order |
| Many implementations to fit needs | Tree-backed costs O(log n) per op |
| Composable: `Map<K, Map<K2, V>>`, `Map<K, List<V>>` | Mutable keys break the data structure |

**When to use:** Lookups by an identifier. Counting. Caching. Indexing. Configuration.
**When NOT to use:** Sequential numeric access (use array). When you need both ordering AND O(1) (use LinkedHashMap or accept the tree's log n).

---

## Edge Cases and Pitfalls

- **Mutating keys after insertion:** Changes hash/equality; entry becomes unreachable
- **Iterating while modifying:** `ConcurrentModificationException` in Java; undefined in Go
- **Null keys/values:** `HashMap` allows one null key and null values; `TreeMap` does not allow null keys; Go's `map` does not allow nil for non-pointer types as keys; Python forbids unhashable keys
- **Hash collisions degrading performance:** Bad hash function or adversarial input flips O(1) to O(n)
- **Assuming iteration order:** Tests that pass locally but fail in CI due to different order

---

## Common Mistakes

- Using a Map when an array would do (e.g., `map[int]string` for indices 0..n-1)
- Using `HashMap` when you need sorted iteration — pick `TreeMap`
- Calling `get()` and `containsKey()` twice instead of one comma-ok / `getOrDefault`
- Using a mutable object as a key
- Relying on Python 3.7+ dict ordering for cross-version code (older Pythons may not preserve it)
- Returning `null` from `get()` and not handling it
- Mutating a Map during iteration

---

## Cheat Sheet

| Need | Choose |
|------|--------|
| Fastest lookup, order does not matter | HashMap / `map` / `dict` |
| Sorted iteration / range queries | TreeMap / `std::map` |
| Remember insertion order | LinkedHashMap / Python `dict` |
| LRU eviction | LinkedHashMap (accessOrder) / `OrderedDict` |
| Counter | `Map<K, Integer>` with merge / `defaultdict(int)` / `Counter` |
| Group by key | `Map<K, List<V>>` with computeIfAbsent / `defaultdict(list)` |
| Set semantics | `Map<K, ()>` (see `06-sets`) |

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive Map visualization. The animation shows put / get / remove against three ordering variants (unordered, sorted, insertion-ordered) so you can compare iteration behavior side-by-side.

---

## Summary

The Map ADT is a contract: store key-value pairs, look up values by key. The hash-table topic teaches **one** implementation; this topic teaches that there are **many**. Pick by ordering needs and complexity budget:

- **Unordered + fast:** HashMap / `map` / `dict`
- **Sorted:** TreeMap / `std::map`
- **Insertion-ordered:** LinkedHashMap / Python `dict`
- **Access-ordered:** LinkedHashMap with accessOrder=true / `OrderedDict`

Master the key contract, the absent-vs-null distinction, and the default-value patterns — they show up in every codebase.

---

## Further Reading

- *Introduction to Algorithms* (CLRS) — Chapter 11: Hash Tables
- Java `Map` interface JavaDoc
- Python: `collections` module, PEP 468 (insertion-ordered dict)
- Go: language spec on map types and iteration
- `05-hash-tables` (this section) — the most common backing
- `21-advanced-structures/lru-cache` — building eviction on top of a Map
