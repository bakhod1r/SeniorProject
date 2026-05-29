# Set (Set ADT) — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Choosing an Implementation](#choosing-an-implementation)
   - [HashSet](#hashset)
   - [TreeSet](#treeset)
   - [BitSet](#bitset)
   - [LinkedHashSet](#linkedhashset)
3. [Performance Comparison](#performance-comparison)
4. [Set-Algebra Implementation Patterns](#set-algebra-implementation-patterns)
5. [The equals / hashCode Contract](#the-equals--hashcode-contract)
6. [Iteration Order Hazards](#iteration-order-hazards)
7. [Integration with Other Data Structures](#integration-with-other-data-structures)
8. [Code Examples](#code-examples)
9. [Benchmarks](#benchmarks)
10. [Best Practices](#best-practices)
11. [Summary](#summary)

---

## Introduction

At the junior level, a set is "a thing you call `add` and `contains` on". At the middle level, the question becomes *which* set, *under what load*, and *with what trade-offs*. This page is about choosing the right implementation, understanding its failure modes, and integrating sets into real algorithms.

We assume you can already read the HashSet implementation from `junior.md`. Here we go one layer up: when does it dominate, when does it lose, and what should you reach for instead?

---

## Choosing an Implementation

### HashSet

- **Backing structure**: a hash table (see topic `05-hash-tables` for internals).
- **Average complexity**: O(1) for `add`, `remove`, `contains`.
- **Worst-case**: O(n) when every element hashes to the same bucket. With a cryptographic or randomized hash this is practically impossible; with a weak hash and adversarial input it is achievable (this is the **hash-flooding** attack).
- **Memory**: O(n) plus per-bucket overhead. Each entry typically costs 32–64 bytes in addition to the element itself.
- **Iteration order**: unspecified. Go randomizes; Java is bucket-order; Python preserves insertion order (since 3.7) but this is an implementation guarantee, not an ADT guarantee.

Pick HashSet whenever you need maximum throughput on `contains`, have no ordering requirement, and your elements have a good hash.

### TreeSet

- **Backing structure**: a self-balancing BST (red-black tree in Java; skip list in C++ `std::set` is technically not a tree but offers the same guarantees).
- **Complexity**: O(log n) for `add`, `remove`, `contains`.
- **Memory**: O(n) plus three pointers per node.
- **Iteration order**: sorted, in O(n) time.
- **Bonus operations**: `first`, `last`, `floor(x)`, `ceiling(x)`, `headSet(x)`, `tailSet(x)`, `subSet(lo, hi)` — these range queries cost O(log n + k) where k is the result size.

Pick TreeSet when you need sorted iteration, range queries, or "nearest-neighbor" lookups. Schedulers, leaderboards (often as a sorted set with scores), and stream-deduplication windows are typical homes.

### BitSet

- **Backing structure**: an array of machine words (typically 64-bit `uint64`).
- **Complexity**: O(1) per element for `add`, `remove`, `contains`; O(U/64) for union/intersection/difference where U is the universe size.
- **Memory**: U bits — one bit per possible element. 1 million possible IDs costs only 125 KB.
- **Iteration order**: by element value, ascending. A single 64-bit word can be iterated in constant time using `bits.TrailingZeros` / `Long.numberOfTrailingZeros` / `(x & -x)`.
- **Constraint**: elements must be small non-negative integers (or be mappable to such).

Pick BitSet when the universe is bounded and small enough to fit in memory, and when you want lightning-fast bulk set algebra. Database query planners, Sieve of Eratosthenes, Bloom filters (internally), and graph adjacency-matrix style work all use bitsets.

### LinkedHashSet

- **Backing structure**: a hash table plus a doubly-linked list threading through entries in insertion order.
- **Complexity**: same as HashSet plus O(1) overhead per operation to maintain the list.
- **Iteration order**: insertion order, deterministically.

Pick LinkedHashSet when test fixtures need stable ordering, when you serialize the set and want diff-friendly output, or when you build an LRU cache (Java's `LinkedHashSet` and `LinkedHashMap` support `accessOrder` mode).

---

## Performance Comparison

| Attribute | HashSet | TreeSet | BitSet | LinkedHashSet |
|---|---|---|---|---|
| `add` average | O(1) | O(log n) | O(1) | O(1) |
| `add` worst | O(n) | O(log n) | O(1) | O(n) |
| `contains` average | O(1) | O(log n) | O(1) | O(1) |
| Sorted iteration | O(n log n) | O(n) | O(U) | O(n log n) |
| Range query | O(n) | O(log n + k) | O(U/64) | O(n) |
| Memory per element | ~50–100 B | ~40–80 B | 1 bit | ~70–120 B |
| Cache locality | poor | poor | excellent | poor |
| Hash dependence | yes | no | n/a | yes |
| Mutable elements safe? | no | no | n/a | no |

The headline trade-off: HashSet is fast on average, TreeSet is consistent and ordered, BitSet is unbeatable when applicable. Reach for HashSet by default; switch only with cause.

---

## Set-Algebra Implementation Patterns

### Iterate-smaller-probe-larger

The single most important optimization for `A ∩ B`:

```text
small, large = (A, B) if |A| <= |B| else (B, A)
result = {x in small : x in large}
cost   = O(|small|)   instead of O(|A| + |B|)
```

This pattern appears in `intersect`, `isDisjoint`, and `containsAll` — anywhere you walk one set probing into another. Always pick the smaller side to walk.

### Three-Way Merge for Sorted Sets

When both sets are TreeSets (sorted), you can compute union, intersection, and difference in O(|A| + |B|) using a merge-like sweep without any hashing:

```text
i, j = 0, 0
while i < |A| and j < |B|:
    if A[i] < B[j]: emit-to-difference A[i]; i++
    elif A[i] > B[j]: skip B[j]; j++
    else: emit-to-intersection A[i]; i++; j++
```

This is the algorithm relational databases use for sort-merge joins on indexed columns.

### Bit-Parallel Algebra on BitSets

For BitSets, all four operations are simple word-wise loops:

```text
union:        out[i] = A[i] | B[i]
intersection: out[i] = A[i] & B[i]
difference:   out[i] = A[i] & ^B[i]
symmetric:    out[i] = A[i] ^ B[i]
```

Each iteration handles 64 elements at once. Modern CPUs run hundreds of words per nanosecond. A BitSet over a million elements does union in microseconds.

### Lazy Set Algebra

For very large sets, building a materialized result is wasteful if the caller only iterates once. Returning a lazy iterator avoids the temporary set:

```text
lazyIntersect(A, B) -> for x in A: if x in B yield x
```

This is what Python's `set.intersection` would *not* do, but what generator expressions like `(x for x in A if x in B)` do. Stream-style APIs (Java `Stream`, Go channels, Python generators) make this pattern free.

---

## The equals / hashCode Contract

The most subtle bug in set code lives in this two-method contract.

**The rule**: if `a.equals(b)`, then `hash(a) == hash(b)`. Equals must be reflexive, symmetric, transitive, and consistent across calls (until the object mutates). The hash code must be consistent with equals.

A textbook violation in Java:

```java
class Point {
    int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Point)) return false;
        Point p = (Point) o;
        return x == p.x && y == p.y;
    }
    // Forgot to override hashCode! Defaults to Object.hashCode() (identity).
}

Set<Point> s = new HashSet<>();
s.add(new Point(1, 2));
s.contains(new Point(1, 2));  // false — different identity hash!
```

Two `Point(1,2)` instances are `equals`, so the set should treat them as one element. But they hash differently, so `contains` searches the wrong bucket. The fix is to override both:

```java
@Override
public int hashCode() {
    return Objects.hash(x, y);   // any deterministic function of equality-relevant fields
}
```

Go avoids this by only allowing comparable types as map keys (the compiler enforces it), but structs with unexported fields or pointer types can subtly compare by identity. Python enforces consistency at runtime: if you override `__eq__` you should override `__hash__`, otherwise the type becomes unhashable.

### Mutability and Hashing

```text
s = set()
key = MutablePoint(1, 2)
s.add(key)          # hashes by (1, 2)
key.x = 999         # mutates after insertion
s.contains(key)     # False — searches bucket for (999, 2)
                    # but key still sits in bucket for (1, 2)
                    # The set is now corrupted.
```

This is why Python's built-in `set` rejects mutable elements (`list`, `dict`, `set`) with a `TypeError`. Use immutable wrappers (`tuple`, `frozenset`) or freeze the relevant fields before insertion.

---

## Iteration Order Hazards

A few hard-won lessons from production bugs:

1. **Go intentionally randomizes** map iteration order to discourage accidental dependence. Test code that compares set iteration to a fixed expected order will pass locally for years and then fail in CI.
2. **Java HashSet** depends on element hash and table capacity. Resizing changes the order. Adding entries can change the order. Never test against a specific order.
3. **Python dict / set** preserve insertion order *for dict* since 3.7 — but `set` does **not** make this guarantee. Use `dict.fromkeys(iterable)` if you need order-preserving uniqueness.
4. **JSON and YAML serialization** of a set typically produces lists. Sorted serialization makes diffs readable: `sorted(set_value)`.
5. **Hash randomization** in Python (`PYTHONHASHSEED`) changes iteration order across runs unless the seed is fixed. Crucial when reproducing bugs.

When ordering matters: use `TreeSet`, `LinkedHashSet`, or sort the output explicitly.

---

## Integration with Other Data Structures

### Set + Map = LRU Cache

The canonical LRU cache combines:
- A **map** keyed by cache key for O(1) lookup.
- A **doubly linked list** for O(1) eviction of the least recent.

The map's *key set* behaves like a HashSet of resident keys. Many libraries expose this via a `keys()` view. See topic `08-map-dictionary` for the full pattern.

### Set + Graph = Visited Tracking

BFS and DFS need a visited set to avoid revisiting cycles. For a graph with N vertices, a BitSet over `[0, N)` beats a HashSet by 10–50x on speed and memory. Most graph libraries (NetworkX, JGraphT, gonum/graph) let you supply a custom visited container for this reason.

### Set + Bloom Filter = Fast Negative Tests

A Bloom filter (see topic `21-advanced-structures`) gives you O(1) "definitely not present" with low false-positive rate using a tiny amount of memory. Pair it with a real set as a two-tier check: hit the Bloom filter first; only consult the authoritative set on a positive answer. RocksDB, Cassandra, and many caches use this pattern.

### Set + Sorted Index = Skip List

Redis sorted sets pair a hash table (key -> score) with a skip list ordered by score. The hash table gives O(1) score lookup; the skip list gives O(log n) range queries. The result is a multi-purpose data structure used for leaderboards, time-series indexes, and rate limiters.

---

## Code Examples

### Pattern: Deduplication preserving first occurrence

#### Go

```go
func dedupKeepingOrder(xs []string) []string {
    seen := make(map[string]struct{}, len(xs))
    out := xs[:0] // reuse backing array
    for _, x := range xs {
        if _, ok := seen[x]; ok {
            continue
        }
        seen[x] = struct{}{}
        out = append(out, x)
    }
    return out
}
```

#### Java

```java
import java.util.*;

public static List<String> dedupKeepingOrder(List<String> xs) {
    return new ArrayList<>(new LinkedHashSet<>(xs));
}
```

#### Python

```python
def dedup_keeping_order(xs: list[str]) -> list[str]:
    # Python 3.7+ dict preserves insertion order; set does not.
    return list(dict.fromkeys(xs))
```

### Pattern: Set algebra against a stream

#### Go

```go
// Returns the count of items in stream that already exist in `known`.
// Avoids materializing the stream as a set.
func countOverlapsWithStream(known map[int]struct{}, stream <-chan int) int {
    hits := 0
    for x := range stream {
        if _, ok := known[x]; ok {
            hits++
        }
    }
    return hits
}
```

#### Java

```java
import java.util.Set;
import java.util.stream.Stream;

public static long countOverlapsWithStream(Set<Integer> known, Stream<Integer> stream) {
    return stream.filter(known::contains).count();
}
```

#### Python

```python
def count_overlaps_with_stream(known: set[int], stream) -> int:
    return sum(1 for x in stream if x in known)
```

### Pattern: BitSet for a dense integer universe

#### Go

```go
// BitSet over a fixed universe [0, U).
type BitSet struct {
    bits []uint64
    U    int
}

func NewBitSet(U int) *BitSet { return &BitSet{bits: make([]uint64, (U+63)/64), U: U} }

func (b *BitSet) Add(x int)      { b.bits[x>>6] |= 1 << uint(x&63) }
func (b *BitSet) Remove(x int)   { b.bits[x>>6] &^= 1 << uint(x&63) }
func (b *BitSet) Contains(x int) bool { return b.bits[x>>6]&(1<<uint(x&63)) != 0 }

func (a *BitSet) UnionInto(b *BitSet) {
    for i := range a.bits { a.bits[i] |= b.bits[i] }
}
```

#### Java

```java
import java.util.BitSet;

public class BitSetDemo {
    public static void main(String[] args) {
        BitSet a = new BitSet(1_000_000);
        BitSet b = new BitSet(1_000_000);
        a.set(42); a.set(100); a.set(999);
        b.set(100); b.set(500);

        BitSet inter = (BitSet) a.clone();
        inter.and(b);                   // intersection
        System.out.println(inter);      // {100}

        BitSet uni = (BitSet) a.clone();
        uni.or(b);                      // union
        System.out.println(uni);        // {42, 100, 500, 999}
    }
}
```

#### Python

```python
# Python's int is an arbitrary-precision bit vector — perfect for BitSet.
class BitSet:
    __slots__ = ("_bits",)
    def __init__(self) -> None: self._bits = 0
    def add(self, x: int)      -> None: self._bits |= (1 << x)
    def remove(self, x: int)   -> None: self._bits &= ~(1 << x)
    def contains(self, x: int) -> bool: return bool(self._bits & (1 << x))
    def union(self, other)        : out = BitSet(); out._bits = self._bits | other._bits; return out
    def intersection(self, other) : out = BitSet(); out._bits = self._bits & other._bits; return out
    def difference(self, other)   : out = BitSet(); out._bits = self._bits & ~other._bits; return out
    def __len__(self) -> int: return bin(self._bits).count("1")
```

---

## Benchmarks

The numbers below are representative (single core, in-memory) and meant to ground intuition, not to be cited verbatim. Run your own — micro-architecture matters.

| n | HashSet contains | TreeSet contains | BitSet contains |
|---|---|---|---|
| 10³ | ~25 ns | ~80 ns | ~3 ns |
| 10⁵ | ~30 ns | ~140 ns | ~3 ns |
| 10⁷ | ~50 ns (cache miss) | ~280 ns | ~3 ns |

| n | HashSet union | TreeSet union | BitSet union |
|---|---|---|---|
| 10³ | ~30 μs | ~200 μs | ~0.1 μs |
| 10⁵ | ~5 ms | ~30 ms | ~10 μs |
| 10⁷ | ~700 ms | ~5 s | ~2 ms |

Key takeaways:
- BitSet wins by **2–3 orders of magnitude** on bulk operations.
- HashSet wins single-element ops over TreeSet by ~3–5x at small n and ~10x at large n.
- TreeSet's predictable O(log n) is its real selling point — no worst-case spikes from hash collisions or rehashing.

---

## Best Practices

1. **Default to HashSet**. Switch only when you have a concrete reason: ordering, ranges, or a dense integer universe.
2. **Pre-size when known**. `make(map[T]struct{}, n)` / `new HashSet<>(n)` / `set(range(n))` avoids costly rehashes.
3. **Never override `equals` without `hashCode`** (and vice versa). Use IDE-generated implementations or libraries (Lombok, Java records).
4. **Freeze elements before insertion** when working with mutable types. Convert lists to tuples, dicts to frozendicts.
5. **Iterate the smaller set** in intersection and disjoint checks.
6. **Sort for serialization**. Set output to JSON, YAML, or logs should be sorted for diff stability.
7. **Use BitSet for dense integer universes** like graph vertex IDs or interned tokens. The speedup is enormous.
8. **Document the iteration-order assumption** at any call site that depends on it. Better yet, use a `TreeSet` or `LinkedHashSet` and make the dependency explicit in the type.
9. **Measure `contains` cost on realistic input**. Hash-collision attacks are real (the JVM and Python ship hash randomization to mitigate them).
10. **Prefer the standard library** over your own HashSet. The from-scratch version in `junior.md` is for understanding, not for production.

---

## Anti-Patterns and How to Recognize Them

### Using a Set as a Map

```text
# Bad — values lost because you only stored keys:
seen_users = set()
seen_users.add(user_id)
# now you need the timestamp too... but it's gone.
```

If you need to store auxiliary information per element, you want a **Map / Dictionary** (topic `08-map-dictionary`). A set is for "is x present?", not "what data is attached to x?".

### Repeatedly Materializing Intersections

```text
# Bad — temporary sets cost O(N) each:
common_in_all = sets[0]
for s in sets[1:]:
    common_in_all = common_in_all & s  # builds a new set every iteration
```

Better: sort sets by size ascending so each successive intersection shrinks the working set as fast as possible. Or use a single-pass approach: scan the smallest set and probe every other set for each candidate.

### Iteration Order in Tests

```text
# Bad — fragile assertion:
assert list(my_set) == [1, 2, 3]
```

Use `assert sorted(my_set) == [1, 2, 3]` or `assert my_set == {1, 2, 3}`. Set equality is content-based; list equality is positional.

### Set of Floats with Rounding

`{0.1 + 0.2, 0.3}` has size 2, not 1, because `0.1 + 0.2 != 0.3` in IEEE-754. Round to a fixed scale before insertion if numerical tolerance matters, or use `decimal` / `BigDecimal` for exact arithmetic.

### Forgetting `__hash__` After `__eq__` in Python

```text
class Point:
    def __init__(self, x, y): self.x, self.y = x, y
    def __eq__(self, other): return (self.x, self.y) == (other.x, other.y)

s = set()
s.add(Point(1, 2))   # TypeError: unhashable type: 'Point'
```

Python forbids putting un-hashable objects in a set. Fix: implement `__hash__` consistently with `__eq__`, or use a `@dataclass(frozen=True)` to get both for free.

---

## Concurrency Cheat Sheet (Middle Level)

| Language | Single-thread set | Concurrent set | Notes |
|---|---|---|---|
| Go | `map[T]struct{}` | `sync.Map` or `RWMutex`-wrapped map | `sync.Map` shines for stable keys + lots of reads |
| Java | `HashSet<T>` | `ConcurrentHashMap.newKeySet()` | uses fine-grained locking + CAS |
| Python | `set` | None built-in; use `threading.Lock` | GIL makes individual ops atomic; compound ops are not |

A common mistake is assuming `Collections.synchronizedSet(new HashSet<>())` is enough for concurrent traffic. It is not — it serializes every operation through a single monitor, which kills throughput. Use `ConcurrentHashMap.newKeySet()` in Java for any production workload above trivial thread counts.

---

## Summary

At middle level, the question is no longer "what is a set?" but "which set, and why?". The decision tree is short: HashSet by default, TreeSet when you need order or ranges, BitSet when the universe is dense and small, LinkedHashSet when you need deterministic iteration. Master the `equals`/`hashCode` contract, beware iteration-order dependence, and learn the iterate-smaller-probe-larger pattern. The rest is library knowledge.
