# Set (Set ADT) — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [What is a Set?](#what-is-a-set)
3. [ADT vs Implementation](#adt-vs-implementation)
4. [Real-World Analogies](#real-world-analogies)
5. [Core Concepts](#core-concepts)
   - [Distinct Elements](#distinct-elements)
   - [No Defined Order](#no-defined-order)
   - [Membership Test](#membership-test)
   - [Equality and Hashing](#equality-and-hashing)
6. [Core Operations](#core-operations)
7. [Set-Algebra Operations](#set-algebra-operations)
8. [Big-O Summary](#big-o-summary)
9. [Pros and Cons](#pros-and-cons)
10. [Full Implementation — HashSet](#full-implementation--hashset)
    - [Go](#go-implementation)
    - [Java](#java-implementation)
    - [Python](#python-implementation)
11. [Worked Examples](#worked-examples)
12. [Common Mistakes](#common-mistakes)
13. [Cheat Sheet](#cheat-sheet)
14. [Visual Animation](#visual-animation)
15. [Summary](#summary)

---

## Introduction

A **set** is one of the oldest ideas in mathematics and one of the most useful tools in everyday programming. It is a collection of **distinct elements** with **no inherent order**. If you have ever written `if user_id in banned_users`, removed duplicates from a list, or computed the intersection of two collections, you have used a set.

This topic introduces the **Set Abstract Data Type (ADT)** — the contract — and three concrete implementations: `HashSet`, `TreeSet`, and `BitSet`. We focus on what a set *is*, not just how one particular library represents one. By the end of this page you will be able to choose the right set implementation for the job and write one yourself.

We deliberately keep hash-table internals (chaining, probing, hash-function design) out of scope here — those live in topic `05-hash-tables`. A `HashSet` simply *uses* a hash table; we treat it as a building block.

---

## What is a Set?

Formally, a set `S` over some universe `U` is a subset of `U` where each element appears at most once. Sets answer two questions extremely well:

1. **Membership**: "Is `x` in `S`?"
2. **Uniqueness**: "Have I seen `x` before?"

```text
S = { 3, 7, 1, 9 }       ← order does not matter
{1, 3, 7, 9} == {3, 7, 1, 9}   ← these are the same set
{1, 1, 2, 3} == {1, 2, 3}      ← duplicates collapse
```

A set has **no notion of position**. You cannot ask for "element 0" or "the third element"; you can only ask whether something is a member, iterate over all members, or combine sets with set-algebra operations like union and intersection.

---

## ADT vs Implementation

This is the single most important distinction in this topic.

| Layer | Concern | Example |
|-------|--------|---------|
| **ADT (interface)** | What operations exist and what they mean | `add`, `remove`, `contains`, `size`, `union` |
| **Implementation** | How operations are realized in memory | `HashSet`, `TreeSet`, `BitSet`, `LinkedHashSet` |

The Set ADT promises:
- `add(x)`: insert `x`; no effect if already present.
- `remove(x)`: delete `x`; no effect if absent.
- `contains(x)`: returns true iff `x` is currently a member.
- `size()`: number of distinct elements.
- `iterate()`: visit every member exactly once, in some order.

Three different implementations all satisfy this contract but trade off speed, memory, and ordering differently:

| Implementation | Backing structure | Membership | Iteration order | Best when |
|---|---|---|---|---|
| **HashSet** | Hash table | O(1) average | Undefined | General-purpose, big data |
| **TreeSet** | Balanced BST | O(log n) | Sorted | Need sorted output or range queries |
| **BitSet** | Bit vector | O(1) | Index order | Small dense integer universe |
| **LinkedHashSet** | Hash table + linked list | O(1) average | Insertion order | Need predictable iteration |

You should always reach for the ADT first ("I need a set") and pick the implementation last ("this set should preserve insertion order, so LinkedHashSet").

---

## Real-World Analogies

### 1. Guest List for a Party

A guest list tells you whether someone is invited (membership) but does not order anyone. Inviting Alice twice does not put her on the list twice. Two guest lists can be combined (union for a joint party) or intersected (who is invited to both parties).

### 2. The Set of Books You Own

You either own a particular book or you do not. Owning a book "twice" is meaningless for the question "do I own this book?". Two collectors can ask which books they both own (intersection) or which books one has that the other does not (difference).

### 3. Tags on a Blog Post

A post is tagged `["python", "performance", "python"]` — the duplicate `python` is redundant. The effective tag set is `{python, performance}`. Searching for posts tagged `python` is a membership query.

### 4. Visited Locations on a Map

While exploring a maze, the squares you have already visited form a set. Order does not matter — you only need to ask "have I been here?". Without this set, graph search algorithms (BFS, DFS) loop forever on cycles.

### 5. Bouncer at a Nightclub

The bouncer holds a banned-list. When someone tries to enter, the bouncer checks the list: present means rejected. They do not care how many times you have shown up before; you are either banned or you are not.

> Where analogies break: real-world lists often *do* care about order or duplicates. The mathematical set is a strict abstraction — push that abstraction onto the data and the right code falls out.

---

## Core Concepts

### Distinct Elements

A set never stores two equal elements. Adding an element that is already present is a no-op (the set is unchanged, though some APIs return `false` to indicate "already there"). This is the **uniqueness invariant**.

```text
S = {} ; S.add(5) -> {5} ; S.add(5) -> {5} ; S.size() == 1
```

### No Defined Order

The Set ADT promises *iteration*, but does not promise an order. Two important pitfalls:

- A `HashSet`'s iteration order is unspecified and may change between versions of the language, JVM, runtime, or even between runs (Go intentionally randomizes map iteration).
- A `TreeSet`'s iteration order *is* defined — sorted by the comparator — but only because the implementation goes further than the ADT requires.

If your code depends on iteration order, write that requirement down and pick a `TreeSet` or `LinkedHashSet` explicitly.

### Membership Test

`contains(x)` is the central operation. Most other set operations are built on top of it. For example, computing `A ∩ B` reduces to iterating one set and testing membership in the other.

### Equality and Hashing

How does the set decide that two elements are "the same"? Through two related contracts:

- **Equality**: two elements are equal iff they compare as equal under the language's equality operator (`==` in Go for primitives, `.equals()` in Java, `__eq__` in Python).
- **Hashing**: two equal elements must produce the same hash code (Java/Python). If `a.equals(b)` then `hash(a) == hash(b)`, but the converse need not hold.

Break either contract and the set silently misbehaves: elements get lost, duplicates appear, or `contains` returns `false` for elements you just inserted. This is the single biggest source of bugs in set code.

```text
// Java: bad — hashCode() uses field x, equals() uses fields x AND y.
// Two objects with same x but different y compare unequal yet hash equal.
// HashSet stores both, but contains() of one finds the other. Chaos.
```

---

## Core Operations

| Operation | Description |
|---|---|
| `add(x)` | Insert `x`. No effect if already present. |
| `remove(x)` | Delete `x`. No effect if absent. |
| `contains(x)` | True iff `x` is currently a member. |
| `size()` | Number of distinct elements. |
| `isEmpty()` | Equivalent to `size() == 0`. |
| `clear()` | Remove all elements. |
| `iterate()` | Visit each member once. |
| `equals(other)` | True iff the two sets have exactly the same members. |
| `isSubset(other)` | True iff every member of `self` is in `other`. |
| `isDisjoint(other)` | True iff no member of `self` is in `other`. |

---

## Set-Algebra Operations

Sets combine to form new sets through algebra borrowed straight from mathematics.

| Operation | Symbol | Meaning |
|---|---|---|
| **Union** | A ∪ B | members of A or B (or both) |
| **Intersection** | A ∩ B | members of both A and B |
| **Difference** | A \ B | members of A that are not in B |
| **Symmetric difference** | A △ B | members of exactly one of A or B |
| **Cartesian product** | A × B | set of ordered pairs (a, b) |

A worked example:

```text
A = {1, 2, 3, 4}
B = {3, 4, 5, 6}
A ∪ B = {1, 2, 3, 4, 5, 6}
A ∩ B = {3, 4}
A \ B = {1, 2}
A △ B = {1, 2, 5, 6}
A × B = {(1,3),(1,4),(1,5),(1,6),(2,3),...,(4,6)}   ← 16 pairs
```

These mirror SQL's `UNION`, `INTERSECT`, and `EXCEPT` — relational databases are themselves built around set algebra.

---

## Big-O Summary

For a HashSet (assuming a good hash function and load factor below ~0.75):

| Operation | Average | Worst |
|---|---|---|
| `add(x)` | O(1) | O(n) |
| `remove(x)` | O(1) | O(n) |
| `contains(x)` | O(1) | O(n) |
| `size()` | O(1) | O(1) |
| `iterate()` | O(n) | O(n) |
| `A ∪ B` | O(|A| + |B|) | O((|A|+|B|)²) |
| `A ∩ B` | O(min(|A|, |B|)) | O(|A| · |B|) |
| `A \ B` | O(|A|) | O(|A| · |B|) |
| `A △ B` | O(|A| + |B|) | — |

For union/intersection, the trick is always to iterate the *smaller* set and probe the *larger* one — that is what gives `O(min(|A|, |B|))` for intersection on average.

For a TreeSet, replace average and worst with O(log n) per operation, and add O(n) for iteration in sorted order. For a BitSet over universe size U, each operation is O(U/64) — usually treated as O(1) for fixed-size universes.

---

## Pros and Cons

| Pros | Cons |
|---|---|
| O(1) average membership tests | No ordering (unless you choose TreeSet / LinkedHashSet) |
| Automatic deduplication | Cannot index by position |
| Direct mapping to set algebra | Elements must be hashable (HashSet) or comparable (TreeSet) |
| Composes cleanly with other sets | Mutable elements break the contract silently |

**Use a set when:** the question is "have I seen this?", "is this unique?", "what do these collections have in common?", or "what is the union/intersection?".

**Do not use a set when:** you need ordering by insertion, positional access, duplicates that count (use a **multiset / bag** — see topic `07-multiset-bag`), or key-value pairs (use a **map** — see topic `08-map-dictionary`).

---

## Full Implementation — HashSet

Below is a from-scratch HashSet that delegates collision handling to a built-in hash table (`map`, `HashMap`, `dict`). The point is to study the **set** layer, not to re-implement the hash table.

### Go Implementation

```go
package set

import "fmt"

// HashSet is a generic-by-string set built on Go's built-in map.
// We use struct{} as the value type because it occupies zero bytes.
type HashSet struct {
	data map[string]struct{}
}

// New returns an empty HashSet.
func New() *HashSet {
	return &HashSet{data: make(map[string]struct{})}
}

// Add inserts x. Returns true if x was newly added, false if already present.
func (s *HashSet) Add(x string) bool {
	if _, ok := s.data[x]; ok {
		return false
	}
	s.data[x] = struct{}{}
	return true
}

// Remove deletes x. Returns true if x was present.
func (s *HashSet) Remove(x string) bool {
	if _, ok := s.data[x]; !ok {
		return false
	}
	delete(s.data, x)
	return true
}

// Contains reports whether x is a member.
func (s *HashSet) Contains(x string) bool {
	_, ok := s.data[x]
	return ok
}

// Size returns the number of elements.
func (s *HashSet) Size() int { return len(s.data) }

// Clear removes all elements.
func (s *HashSet) Clear() { s.data = make(map[string]struct{}) }

// ForEach calls f for each member. Iteration order is intentionally random.
func (s *HashSet) ForEach(f func(string)) {
	for k := range s.data {
		f(k)
	}
}

// Union returns a new set containing all members of s or other.
func (s *HashSet) Union(other *HashSet) *HashSet {
	out := New()
	s.ForEach(func(x string) { out.Add(x) })
	other.ForEach(func(x string) { out.Add(x) })
	return out
}

// Intersect returns a new set containing members in both s and other.
// We iterate the smaller set for efficiency.
func (s *HashSet) Intersect(other *HashSet) *HashSet {
	small, large := s, other
	if other.Size() < s.Size() {
		small, large = other, s
	}
	out := New()
	small.ForEach(func(x string) {
		if large.Contains(x) {
			out.Add(x)
		}
	})
	return out
}

// Difference returns s \ other.
func (s *HashSet) Difference(other *HashSet) *HashSet {
	out := New()
	s.ForEach(func(x string) {
		if !other.Contains(x) {
			out.Add(x)
		}
	})
	return out
}

// SymmetricDifference returns (s \ other) ∪ (other \ s).
func (s *HashSet) SymmetricDifference(other *HashSet) *HashSet {
	out := s.Difference(other)
	other.Difference(s).ForEach(func(x string) { out.Add(x) })
	return out
}

// Equals reports whether s and other have exactly the same members.
func (s *HashSet) Equals(other *HashSet) bool {
	if s.Size() != other.Size() {
		return false
	}
	for k := range s.data {
		if !other.Contains(k) {
			return false
		}
	}
	return true
}

// IsSubset reports whether every member of s is in other.
func (s *HashSet) IsSubset(other *HashSet) bool {
	for k := range s.data {
		if !other.Contains(k) {
			return false
		}
	}
	return true
}

// IsDisjoint reports whether s and other share no members.
func (s *HashSet) IsDisjoint(other *HashSet) bool {
	small, large := s, other
	if other.Size() < s.Size() {
		small, large = other, s
	}
	for k := range small.data {
		if large.Contains(k) {
			return false
		}
	}
	return true
}

// String renders the set for debugging.
func (s *HashSet) String() string {
	return fmt.Sprintf("Set%v", s.data)
}
```

### Java Implementation

```java
import java.util.HashMap;
import java.util.Iterator;
import java.util.function.Consumer;

/**
 * A minimal HashSet built on top of Java's HashMap.
 * Demonstrates the Set ADT contract — the underlying hash table
 * is treated as a black box.
 */
public class MyHashSet<E> implements Iterable<E> {

    private static final Object PRESENT = new Object();
    private final HashMap<E, Object> data = new HashMap<>();

    public boolean add(E x) {
        return data.put(x, PRESENT) == null;
    }

    public boolean remove(E x) {
        return data.remove(x) != null;
    }

    public boolean contains(E x) {
        return data.containsKey(x);
    }

    public int size() { return data.size(); }
    public boolean isEmpty() { return data.isEmpty(); }
    public void clear() { data.clear(); }

    @Override
    public Iterator<E> iterator() { return data.keySet().iterator(); }

    public void forEach(Consumer<E> f) { data.keySet().forEach(f); }

    public MyHashSet<E> union(MyHashSet<E> other) {
        MyHashSet<E> out = new MyHashSet<>();
        this.forEach(out::add);
        other.forEach(out::add);
        return out;
    }

    public MyHashSet<E> intersect(MyHashSet<E> other) {
        MyHashSet<E> small = this, large = other;
        if (other.size() < this.size()) { small = other; large = this; }
        MyHashSet<E> out = new MyHashSet<>();
        for (E x : small) if (large.contains(x)) out.add(x);
        return out;
    }

    public MyHashSet<E> difference(MyHashSet<E> other) {
        MyHashSet<E> out = new MyHashSet<>();
        for (E x : this) if (!other.contains(x)) out.add(x);
        return out;
    }

    public MyHashSet<E> symmetricDifference(MyHashSet<E> other) {
        MyHashSet<E> out = this.difference(other);
        for (E x : other.difference(this)) out.add(x);
        return out;
    }

    public boolean equalsSet(MyHashSet<E> other) {
        if (this.size() != other.size()) return false;
        for (E x : this) if (!other.contains(x)) return false;
        return true;
    }

    public boolean isSubset(MyHashSet<E> other) {
        for (E x : this) if (!other.contains(x)) return false;
        return true;
    }

    public boolean isDisjoint(MyHashSet<E> other) {
        MyHashSet<E> small = this, large = other;
        if (other.size() < this.size()) { small = other; large = this; }
        for (E x : small) if (large.contains(x)) return false;
        return true;
    }

    @Override
    public String toString() { return "Set" + data.keySet(); }
}
```

### Python Implementation

```python
"""A minimal HashSet built on top of Python's dict."""

from typing import Generic, Iterable, Iterator, TypeVar

T = TypeVar("T")


class MyHashSet(Generic[T]):
    """Set ADT backed by a dict. dict keys already guarantee uniqueness."""

    __slots__ = ("_data",)

    def __init__(self, iterable: Iterable[T] | None = None) -> None:
        self._data: dict[T, None] = {}
        if iterable is not None:
            for x in iterable:
                self._data[x] = None

    # --- core operations ---

    def add(self, x: T) -> bool:
        """Insert x. Return True if newly added, False if already present."""
        if x in self._data:
            return False
        self._data[x] = None
        return True

    def remove(self, x: T) -> bool:
        """Delete x. Return True if it was present."""
        return self._data.pop(x, _MISSING) is not _MISSING

    def contains(self, x: T) -> bool:
        return x in self._data

    def __contains__(self, x: T) -> bool:
        return x in self._data

    def __len__(self) -> int:
        return len(self._data)

    def __iter__(self) -> Iterator[T]:
        return iter(self._data)

    def clear(self) -> None:
        self._data.clear()

    # --- set algebra ---

    def union(self, other: "MyHashSet[T]") -> "MyHashSet[T]":
        out = MyHashSet[T]()
        out._data.update(self._data)
        out._data.update(other._data)
        return out

    def intersect(self, other: "MyHashSet[T]") -> "MyHashSet[T]":
        small, large = (self, other) if len(self) <= len(other) else (other, self)
        out = MyHashSet[T]()
        for x in small:
            if x in large:
                out.add(x)
        return out

    def difference(self, other: "MyHashSet[T]") -> "MyHashSet[T]":
        out = MyHashSet[T]()
        for x in self:
            if x not in other:
                out.add(x)
        return out

    def symmetric_difference(self, other: "MyHashSet[T]") -> "MyHashSet[T]":
        out = self.difference(other)
        for x in other.difference(self):
            out.add(x)
        return out

    # --- predicates ---

    def equals(self, other: "MyHashSet[T]") -> bool:
        return len(self) == len(other) and all(x in other for x in self)

    def is_subset(self, other: "MyHashSet[T]") -> bool:
        return all(x in other for x in self)

    def is_disjoint(self, other: "MyHashSet[T]") -> bool:
        small, large = (self, other) if len(self) <= len(other) else (other, self)
        return all(x not in large for x in small)

    def __repr__(self) -> str:
        return "Set{" + ", ".join(repr(x) for x in self._data) + "}"


_MISSING = object()
```

---

## Worked Examples

### Example: Deduplicate a list

```text
Input:  [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]
Output: {3, 1, 4, 5, 9, 2, 6}        ← order unspecified
Size:   7
```

This is one line in every modern language:

```go
out := set.New()
for _, x := range input { out.Add(x) }
```

```java
MyHashSet<Integer> out = new MyHashSet<>();
for (int x : input) out.add(x);
```

```python
out = MyHashSet(input)
```

### Example: Common interests between two users

```text
alice_likes = {"hiking", "python", "coffee", "jazz"}
bob_likes   = {"coffee", "tea", "python", "running"}
common      = alice_likes ∩ bob_likes = {"coffee", "python"}
```

### Example: BFS visited-set

```text
visited = ∅
queue   = [start]
while queue:
    v = queue.pop()
    if v in visited: continue
    visited.add(v)
    for n in neighbors(v):
        if n not in visited: queue.push(n)
```

Without the `visited` set, the algorithm loops forever on any cyclic graph.

---

## Common Mistakes

| Mistake | Why it goes wrong |
|---|---|
| Storing mutable objects whose fields participate in hashing | After mutation, `contains` cannot find the object — it now hashes to a different bucket. |
| Implementing `equals` without `hashCode` (or vice versa) | Two equal objects with different hashes can both live in the set; `contains` finds neither reliably. |
| Assuming iteration order is stable | `HashSet` in Go, Java, and Python may return elements in different orders on different runs. |
| Using `==` (reference equality) when `equals` is needed | Two `new Integer(5)` references are not `==`, but they should be set-equal. |
| Forgetting that `add(x)` is a no-op if `x` is already present | Sets do not bump a counter — use a **multiset** for that. |
| Storing `NaN` in a HashSet | `NaN != NaN`, so the same `NaN` value may insert twice (Java/Python behave differently). |
| Including `null`/`nil` accidentally | Some implementations forbid it (Java `TreeSet` throws); others permit one entry. |
| Computing intersection by iterating the *larger* set | Twice the work; always iterate the smaller side. |

---

## Cheat Sheet

| Need | Pick |
|---|---|
| Fastest membership, no ordering needed | **HashSet** |
| Sorted iteration / range queries | **TreeSet** |
| Tight memory over a dense integer range | **BitSet** |
| Predictable insertion-order iteration | **LinkedHashSet** |
| Distributed / approximate membership | **Bloom filter**, **HyperLogLog**, **Redis SET** |
| Element counts matter | **Multiset / Bag** (see topic 07) |

| Operation | HashSet | TreeSet | BitSet |
|---|---|---|---|
| `add` | O(1) avg | O(log n) | O(1) |
| `remove` | O(1) avg | O(log n) | O(1) |
| `contains` | O(1) avg | O(log n) | O(1) |
| iteration | O(n) unordered | O(n) sorted | O(U) |
| memory | O(n) | O(n) | O(U/8 bytes) |

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive visualization of two side-by-side sets with `Add`, `Remove`, `Contains` controls and `Union`, `Intersect`, `Difference`, `Symmetric Difference` buttons that compute a result set.

The animation demonstrates:
- Two sets `A` and `B` rendered as element pills.
- Live size statistics and the last operation performed.
- A Big-O table for set-algebra operations.
- An operation log that records every action.

---

## Summary

A **set** is a collection of distinct elements with no defined order. Treat it as an **ADT** first — `add`, `remove`, `contains`, plus the algebra of union, intersection, and difference — and pick an implementation second. `HashSet` is the default; reach for `TreeSet` when you need ordering and `BitSet` when the universe is small and dense. Master the `equals`/`hashCode` contract and iteration-order pitfalls early, and the rest of your career will be set up for clean set code.
