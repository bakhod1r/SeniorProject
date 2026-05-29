# Set (Set ADT) — Practice Tasks

> Every task must be solved in **Go**, **Java**, and **Python**. Use the from-scratch HashSet from `junior.md` for the beginner tasks; the standard library is fine for intermediate and advanced.

## Beginner Tasks

### Task 1 — Build a HashSet from Scratch

**Description**: Implement a `Set` type with `Add`, `Remove`, `Contains`, `Size`. Internally use the language's built-in hash map; expose only the Set ADT.

**I/O example**: `Add(1); Add(2); Add(1); Size()` returns `2`.

**Approach**: Wrap `map[int]struct{}` / `HashMap` / `dict`. Return `bool` from `Add` and `Remove` to signal "newly added" / "was present".

**Hint**: In Go, use `struct{}` as the value type (zero bytes). In Java, use a sentinel `Object`. In Python, `None` is conventional.

#### Go

```go
type Set struct{ data map[int]struct{} }
func New() *Set { return &Set{data: make(map[int]struct{})} }
func (s *Set) Add(x int) bool   { /* TODO */ return false }
func (s *Set) Remove(x int) bool{ /* TODO */ return false }
func (s *Set) Contains(x int) bool { /* TODO */ return false }
func (s *Set) Size() int { return len(s.data) }
```

#### Java

```java
import java.util.HashMap;
public class MySet {
    private static final Object PRESENT = new Object();
    private final HashMap<Integer, Object> data = new HashMap<>();
    public boolean add(int x)    { /* TODO */ return false; }
    public boolean remove(int x) { /* TODO */ return false; }
    public boolean contains(int x){ /* TODO */ return false; }
    public int size() { return data.size(); }
}
```

#### Python

```python
class MySet:
    def __init__(self): self._d = {}
    def add(self, x: int) -> bool: ...     # TODO
    def remove(self, x: int) -> bool: ...  # TODO
    def contains(self, x: int) -> bool: ...# TODO
    def __len__(self): return len(self._d)
```

---

### Task 2 — Deduplicate an Array

**Description**: Given an integer array, return a new array containing each distinct value once.

**I/O example**: `[3, 1, 4, 1, 5, 9, 2, 6, 5, 3]` → `[3, 1, 4, 5, 9, 2, 6]` (any order).

**Approach**: Iterate and add to a set; return the set's contents.

**Hint**: Pre-size the set: `len(input)` is an upper bound on its final size.

---

### Task 3 — Check if Two Strings Have Common Characters

**Description**: Return `true` iff strings `a` and `b` share at least one character.

**I/O example**: `("hello", "world")` → `true` (shares 'l' and 'o'); `("abc", "xyz")` → `false`.

**Approach**: Build a set of characters from the shorter string, scan the longer string.

**Hint**: This is exactly `isDisjoint`. Walking the longer string is wasteful — walk the shorter once you have the set, exit early on first hit.

---

### Task 4 — Find Unique Elements Across Two Arrays

**Description**: Return all values that appear in exactly one of two input arrays (symmetric difference).

**I/O example**: `a = [1,2,3,4]`, `b = [3,4,5,6]` → `[1, 2, 5, 6]` (any order).

**Approach**: `(A \ B) ∪ (B \ A)`. Implement difference twice, then union.

**Hint**: Bonus — implement this in one pass over the union using a counter.

---

### Task 5 — Implement `isSubset`

**Description**: Return `true` iff every element of `A` is in `B`.

**I/O example**: `A = {1, 2}, B = {1, 2, 3}` → `true`; `A = {1, 4}, B = {1, 2, 3}` → `false`.

**Approach**: Short-circuit on the first miss. If `|A| > |B|`, immediately return `false`.

**Hint**: This is `containsAll` in Java. Iterate the smaller candidate (A); never iterate the larger needlessly.

---

## Intermediate Tasks

### Task 6 — Intersection of Two Sorted Arrays in O(n + m)

**Description**: Given two sorted arrays, return their intersection (each common element once) in linear total time.

**I/O example**: `[1,2,3,5,8]`, `[2,4,5,7,8]` → `[2, 5, 8]`.

**Approach**: Two pointers `i`, `j`. If `a[i] == b[j]` emit; if `a[i] < b[j]` advance `i`; else advance `j`. Skip duplicates in inputs.

**Hint**: This is the database sort-merge join. No hash table needed.

---

### Task 7 — Group Anagrams

**Description**: Given a list of strings, group those that are anagrams of each other. Each group's signature is the multiset of characters.

**I/O example**: `["eat","tea","tan","ate","nat","bat"]` → `[["eat","tea","ate"], ["tan","nat"], ["bat"]]`.

**Approach**: Use sorted character string as the key into a map of sets. Equal sorted strings = anagrams.

**Hint**: For ASCII input, a 26-int count array as a tuple key is faster than sort.

---

### Task 8 — Find All Duplicates in O(n) Time and O(1) Extra Space

**Description**: Given an integer array of length `n` where each value is in `[1, n]`, return all values that appear at least twice.

**I/O example**: `[4,3,2,7,8,2,3,1]` → `[2, 3]`.

**Approach**: Use the array itself as a BitSet — negate `arr[abs(arr[i]) - 1]` to mark visits.

**Hint**: This is technically O(1) extra space — the "set" lives inside the input array via sign bits.

---

### Task 9 — Implement a BitSet for Universe [0, U)

**Description**: Implement `Add`, `Remove`, `Contains`, `Union`, `Intersect` over a fixed integer universe, using a slice of 64-bit words.

**I/O example**: `bs = BitSet(100); bs.Add(7); bs.Add(64); bs.Contains(64)` → `true`.

**Approach**: `word = x >> 6`, `bit = x & 63`. Union/intersect are word-wise `|`/`&`.

**Hint**: Iterating elements uses `bits.TrailingZeros64(word)` / `Long.numberOfTrailingZeros` / `(x & -x).bit_length() - 1`.

---

### Task 10 — Longest Substring Without Repeating Characters

**Description**: Given a string, return the length of the longest substring with all distinct characters.

**I/O example**: `"abcabcbb"` → `3` (`"abc"`).

**Approach**: Sliding window with a set. Expand right; on duplicate, shrink left until the duplicate is removed.

**Hint**: A map from char to last-seen index lets you jump left directly rather than slide one step at a time.

---

## Advanced Tasks

### Task 11 — Implement a Probabilistic Set (Bloom Filter)

**Description**: Implement a Bloom filter with configurable false-positive rate `p`. Support `Add` and `Contains`. No `Remove`.

**I/O example**: `bf = BloomFilter(n=10_000, p=0.01); bf.Add("alice"); bf.Contains("alice")` → `true`; `bf.Contains("zzz")` → likely `false` (~1% chance of FP).

**Approach**: Bit array `m = -(n · ln p) / (ln 2)²`. Number of hashes `k = (m / n) · ln 2`. Use double hashing: `h_i(x) = h₁(x) + i · h₂(x)` to derive `k` hashes from two real ones.

**Hint**: For h₁ and h₂ in Go use `hash/fnv`; in Java use `MessageDigest("MD5")` split into two ints; in Python use `hashlib.md5` split.

---

### Task 12 — Find Pairs With Given Sum Using a Set

**Description**: Given an integer array and target `K`, return all unordered pairs `(a, b)` with `a + b == K`, each pair listed once.

**I/O example**: `[1, 5, 7, -1, 5]`, `K=6` → `[(1, 5), (7, -1)]`.

**Approach**: Iterate the array once. For each `x`, check if `K - x` is already in `seen`. Add `x` after the check to avoid pairing an element with itself.

**Hint**: Use a result-set keyed by sorted pair to deduplicate `(1, 5)` and `(5, 1)`.

---

### Task 13 — Word Ladder (BFS with Visited Set)

**Description**: Given two words and a dictionary, return the shortest transformation sequence length from `start` to `end` where each step changes one letter and every intermediate word is in the dictionary.

**I/O example**: `start="hit"`, `end="cog"`, dict=`{hot,dot,dog,lot,log,cog}` → `5` (`hit → hot → dot → dog → cog`).

**Approach**: BFS. Build a dictionary set for O(1) membership. For each word in the queue, generate all one-letter-different candidates and enqueue those present in the dictionary and not yet visited.

**Hint**: Pre-compute a map of pattern (`h*t`, `*ot`, `ho*`) → word list for O(1) neighbor lookup instead of O(26 · L) per word.

---

### Task 14 — Implement an OR-Set CRDT

**Description**: Implement an Observed-Remove Set with operations `Add(x)`, `Remove(x)`, `Contains(x)`, and `Merge(other)`. After any merge between any two replicas, all replicas must converge.

**I/O example**:
```text
A.Add("x");  B.Add("y");  A.Merge(B);  B.Merge(A);
A.Contains("x") && A.Contains("y") && B.Contains("x") && B.Contains("y")  // true
```

**Approach**: Each add tags `x` with `(replicaId, counter)`. The set stores `(x, tag)` pairs. Remove deletes all currently-observed tags for `x`. Merge unions the tagged pairs.

**Hint**: For garbage collection of removed tags, track a "tombstone" set of removed tags. Implementations like Akka Distributed Data and Riak provide reference behavior.

---

### Task 15 — Range Set with Sorted Intervals

**Description**: Maintain a set over a sparse integer universe by storing only the *intervals* of present values. Support `Add(x)`, `Remove(x)`, `Contains(x)`, `AddRange(lo, hi)`, and `Iterate()` in sorted order.

**I/O example**:
```text
s.AddRange(1, 5); s.AddRange(10, 12); s.Add(6); s.Iterate()
// 1, 2, 3, 4, 5, 6, 10, 11, 12
```

**Approach**: Maintain a sorted structure of non-overlapping intervals. On insert, merge with adjacent intervals; on remove, possibly split. Use TreeMap / `sortedcontainers.SortedDict` / Go's `bst` package for O(log n) interval lookup.

**Hint**: For 1-million-element ranges with mostly-contiguous structure, this beats a BitSet on memory and beats a HashSet on iteration order. Used in Java's `RangeSet` (Guava) and PostgreSQL `int4range`.

---

## Benchmark Task

> Compare HashSet, TreeSet, and BitSet `contains` performance for n = 10³, 10⁵, 10⁷.

#### Go

```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func main() {
    sizes := []int{1_000, 100_000, 10_000_000}
    for _, n := range sizes {
        m := make(map[int]struct{}, n)
        for i := 0; i < n; i++ {
            m[rand.Intn(n*2)] = struct{}{}
        }
        queries := make([]int, 1_000_000)
        for i := range queries {
            queries[i] = rand.Intn(n * 2)
        }
        start := time.Now()
        hits := 0
        for _, q := range queries {
            if _, ok := m[q]; ok { hits++ }
        }
        elapsed := time.Since(start)
        fmt.Printf("n=%9d  hits=%d  contains=%.2f ns/op\n",
            n, hits, float64(elapsed.Nanoseconds())/float64(len(queries)))
    }
}
```

#### Java

```java
import java.util.*;

public class Benchmark {
    public static void main(String[] args) {
        int[] sizes = {1_000, 100_000, 10_000_000};
        Random rng = new Random(42);
        for (int n : sizes) {
            HashSet<Integer> s = new HashSet<>(n);
            for (int i = 0; i < n; i++) s.add(rng.nextInt(n * 2));
            int[] q = new int[1_000_000];
            for (int i = 0; i < q.length; i++) q[i] = rng.nextInt(n * 2);
            long t0 = System.nanoTime();
            int hits = 0;
            for (int x : q) if (s.contains(x)) hits++;
            long elapsed = System.nanoTime() - t0;
            System.out.printf("n=%9d  hits=%d  contains=%.2f ns/op%n",
                n, hits, (double) elapsed / q.length);
        }
    }
}
```

#### Python

```python
import random, time

sizes = [1_000, 100_000, 10_000_000]
for n in sizes:
    s = {random.randrange(n * 2) for _ in range(n)}
    q = [random.randrange(n * 2) for _ in range(1_000_000)]
    t0 = time.perf_counter()
    hits = sum(1 for x in q if x in s)
    elapsed = time.perf_counter() - t0
    print(f"n={n:>9}  hits={hits}  contains={elapsed*1e9/len(q):.2f} ns/op")
```

Expected ratio: HashSet wins on throughput; BitSet would win for dense integer universes but cannot represent sparse ones; TreeSet would lose to HashSet by 3–10x and to BitSet by 30–100x. Run on your machine to ground the numbers in real cache and TLB behavior.
