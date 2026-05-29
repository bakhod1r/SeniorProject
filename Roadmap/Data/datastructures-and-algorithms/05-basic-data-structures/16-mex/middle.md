# MEX — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [Dynamic MEX with Ordered Sets](#dynamic-mex-with-ordered-sets)
4. [Range MEX Queries](#range-mex-queries)
5. [MEX in Game Theory — Sprague-Grundy](#mex-in-game-theory--sprague-grundy)
6. [Comparison with Alternatives](#comparison-with-alternatives)
7. [Advanced Patterns](#advanced-patterns)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

> Focus: "Why is the bound MEX ≤ n tight?" and "When does MEX get hard?"

At the middle level, you stop treating MEX as a single algorithm and start treating it as a problem family:
1. **Static whole-array MEX** — O(n) bucket
2. **Dynamic MEX with insert/delete** — O(log n) per operation via ordered sets or segment trees
3. **Range MEX on subarrays** — O((n + q) log n) via persistent segment tree or offline Mo's
4. **MEX in game theory** — the operation that makes Sprague-Grundy work

You should be able to defend the algorithmic choice for any of these and avoid the classic competitive-programming mistake of "I'll just compute MEX from scratch on every query."

---

## Deeper Concepts

### Invariant: MEX ≤ n

For an input set `S` of size `n` (or array of length `n` with duplicates), `MEX(S) ≤ n`. The proof: the set `{0, 1, ..., n}` has `n+1` elements. By pigeonhole at least one is missing from `S`. So you only need to track values in `[0, n]`.

This is the structural invariant powering every MEX algorithm. Any approach that scales with `max(S)` instead of `n` is wasting work for static MEX.

### When MEX bound changes

For **dynamic MEX** the bound is the current set size `|S|`. After deletes, MEX may drop below the historical max-MEX. After inserts, it may rise but never above `|S|`.

For **range MEX** the bound is the subarray length, not the array length. `MEX(a[l..r]) ≤ r - l + 1`.

### MEX is not monotone under insertions

A common bug: assuming `MEX(S ∪ {v}) ≥ MEX(S)`. Counter-example:

```text
S = {0, 1, 2, 4}     →  MEX = 3
S ∪ {3} = {0,1,2,3,4} → MEX = 5
```

That direction does hold (`MEX` cannot decrease on insert). But **deletes** can drop MEX, sometimes drastically. Tracking MEX under arbitrary updates requires a structure, not a counter.

### Recurrence: amortized MEX over a stream

If you add elements one at a time and want MEX after each add, the total work using a "scan from current MEX upward" trick is **O(n + max-final-MEX)** = O(n), amortized O(1) per insert. The MEX pointer monotonically increases under insert-only workloads.

```text
For inserts only: MEX is monotone non-decreasing.
After each insert: advance MEX while seen[MEX] is true.
Total advances across n inserts: O(n).
```

---

## Dynamic MEX with Ordered Sets

When the set supports `insert(v)`, `delete(v)`, and `query_mex()`, you need a structure better than a bucket scan from 0.

### Approach 1: TreeSet of "missing" values

Maintain a `TreeSet<int>` containing every non-negative integer **not** currently in the set, capped at some upper bound (e.g., n+1 or 2×|S|).

- `insert(v)`: remove `v` from the missing set
- `delete(v)`: add `v` to the missing set
- `mex()`: return the minimum of the missing set — O(log n)

#### Java

```java
import java.util.TreeSet;
import java.util.HashSet;

public class DynamicMEX {
    private final TreeSet<Integer> missing = new TreeSet<>();
    private final HashSet<Integer> present = new HashSet<>();
    private final int cap;

    public DynamicMEX(int cap) {
        this.cap = cap;
        for (int i = 0; i <= cap; i++) missing.add(i);
    }

    public void insert(int v) {
        if (v < 0 || v > cap) return;
        if (present.add(v)) missing.remove(v);
    }

    public void delete(int v) {
        if (v < 0 || v > cap) return;
        if (present.remove(v)) missing.add(v);
    }

    public int mex() {
        return missing.first();
    }
}
```

### Approach 2: Segment tree over `[0, n]`

Each leaf `i` is 1 if `i` is missing, else 0. Internal nodes store the sum or min-index of a missing value. `mex()` is a descent on the tree:
- If left subtree has at least one missing value, go left.
- Else go right and add `mid+1` offset.

Both insert/delete and mex are O(log n).

#### Python: segment tree on missing flags

```python
class MEXSegTree:
    def __init__(self, cap):
        self.cap = cap
        self.size = 1
        while self.size <= cap:
            self.size *= 2
        # Each node stores count of *missing* values in its range
        self.tree = [0] * (2 * self.size)
        # Initially every value 0..cap is missing
        for i in range(cap + 1):
            self.tree[self.size + i] = 1
        for i in range(self.size - 1, 0, -1):
            self.tree[i] = self.tree[2*i] + self.tree[2*i+1]
        self.count = [0] * (cap + 1)  # multiplicity per value

    def insert(self, v):
        if not (0 <= v <= self.cap):
            return
        self.count[v] += 1
        if self.count[v] == 1:
            self._set(v, 0)

    def delete(self, v):
        if not (0 <= v <= self.cap) or self.count[v] == 0:
            return
        self.count[v] -= 1
        if self.count[v] == 0:
            self._set(v, 1)

    def _set(self, i, val):
        i += self.size
        self.tree[i] = val
        i //= 2
        while i:
            self.tree[i] = self.tree[2*i] + self.tree[2*i+1]
            i //= 2

    def mex(self):
        # Descend: leftmost leaf with value 1
        node = 1
        while node < self.size:
            if self.tree[2*node] > 0:
                node = 2*node
            else:
                node = 2*node + 1
        return node - self.size
```

`insert`, `delete`, `mex` are all O(log n).

---

## Range MEX Queries

**Problem:** given a static array `a[0..n-1]` and many queries `(l, r)`, compute MEX of `a[l..r]`.

This is much harder than whole-array MEX because the answer depends on the chosen subrange.

### Approach 1: Offline, Mo's algorithm

Sort queries by Mo's block ordering. Maintain a frequency array and a `mex` pointer that you advance/retreat as elements enter/leave the window. Total complexity: **O((n + q) · √n · log n)** — the log factor comes from maintaining the missing-min via a structure.

A cleaner variant uses a sqrt-decomposition over value buckets so each insert/delete is O(√n) and `mex` is O(√n), giving **O((n + q) · √n)** total.

### Approach 2: Persistent segment tree

For each prefix `a[0..i]`, store a persistent segment tree mapping value `v` to its **last occurrence index**. To answer `(l, r)`, descend the segment tree of prefix `r`: a value `v` is **missing** in `[l, r]` iff its last occurrence < l. Find the leftmost such value. Query: **O(log n)**. Total: **O((n + q) log n)**.

#### Python (sketch — persistent seg tree)

```python
# pseudo-code: a persistent segment tree over values 0..n.
# Each version is the state after seeing a[0..i].
# leaf v stores: last index j where a[j] = v (or -1 if none).
# internal nodes store: min of leaf values in their subtree.
# Query (l, r): descend version r; at each node, if left subtree's min < l,
# go left; else go right. Leaf v with min < l is missing.

def range_mex(versions, l, r):
    node = versions[r]
    lo, hi = 0, len(versions)
    while lo < hi:
        mid = (lo + hi) // 2
        if node.left.min < l:
            node = node.left
            hi = mid
        else:
            node = node.right
            lo = mid + 1
    return lo
```

### Approach 3: Wavelet tree / merge sort tree

Variations exist with `O(log² n)` per query and O(n log n) build. In contest contexts, persistent seg tree wins.

---

## MEX in Game Theory — Sprague-Grundy

The **Sprague-Grundy theorem** says every impartial game position has a non-negative integer called its **Grundy number** (or Nim value), and:

```text
G(position) = MEX({ G(p) : p reachable from position })
```

A position is **losing** for the player to move iff `G(position) = 0`. The XOR of Grundy numbers tells you the value of a sum of games.

### Example: Subtraction game

You have a pile of `n` stones. On each turn, remove 1, 3, or 4. Last to move wins.

```python
from functools import lru_cache

@lru_cache(maxsize=None)
def grundy(n):
    if n == 0:
        return 0
    reach = set()
    for move in (1, 3, 4):
        if n >= move:
            reach.add(grundy(n - move))
    g = 0
    while g in reach:
        g += 1
    return g

print([grundy(i) for i in range(15)])
# [0, 1, 0, 1, 2, 3, 2, 0, 1, 0, 1, 2, 3, 2, 0]
```

You will write this `mex of reachable grundies` pattern in **every** Sprague-Grundy problem. Master it.

### Why MEX specifically?

The MEX choice is not arbitrary. It makes Sprague-Grundy compose with **XOR** under game-sum. If `G` were some other function (e.g., max + 1), the elegant XOR equivalence with Nim would fail. The Bouton/Sprague proof uses MEX's "first missing" property to construct a winning strategy.

---

## Comparison with Alternatives

| Setting | Best Structure | Time/op | Space |
|---------|----------------|---------|-------|
| Static whole-array MEX | Bucket array | O(n) total | O(n) |
| Dynamic insert/delete | TreeSet of missing OR seg tree | O(log n) | O(n) |
| Range MEX (offline) | Mo's + sqrt-decomp | O((n+q)√n) | O(n) |
| Range MEX (online) | Persistent seg tree | O(log n) per query | O(n log n) |
| Sprague-Grundy small states | Memoized recursion + set scan | O(states · max-G) | O(states) |

**Choose static bucket** when MEX is computed once.
**Choose ordered set / seg tree** when the underlying set changes between MEX calls.
**Choose persistent seg tree** when the array is fixed and many range queries hit it.
**Choose offline Mo's** when range queries are not interleaved with updates and you want simpler code.

---

## Advanced Patterns

### Pattern: Incremental MEX under insert-only workloads

When you only insert (never delete) and want MEX after each insert, keep a single `int mex` and a bucket. After each insert, advance `mex` while `seen[mex]` is true. Total work O(n) amortized.

#### Go

```go
type IncMEX struct {
    seen []bool
    mex  int
}

func NewIncMEX(cap int) *IncMEX {
    return &IncMEX{seen: make([]bool, cap+2)}
}

func (m *IncMEX) Insert(v int) {
    if v >= 0 && v < len(m.seen) {
        m.seen[v] = true
    }
    for m.mex < len(m.seen) && m.seen[m.mex] {
        m.mex++
    }
}

func (m *IncMEX) MEX() int { return m.mex }
```

Amortized O(1) per insert.

### Pattern: MEX over multisets with counters

For a multiset, track multiplicity per value. MEX still depends only on which values are **present** (count ≥ 1), so the structures above adapt by toggling presence on `0 → 1` and `1 → 0` transitions.

### Pattern: Bitset MEX with hardware speedup

For very large bucket arrays, use a bitset and `__builtin_ffsll` (C/C++) or `BitSet.nextClearBit` (Java) to find the first zero bit in O(n/64) words.

#### Java

```java
import java.util.BitSet;

public static int mexBitset(int[] arr) {
    int n = arr.length;
    BitSet seen = new BitSet(n + 1);
    for (int v : arr) if (v >= 0 && v <= n) seen.set(v);
    return seen.nextClearBit(0);
}
```

`nextClearBit` is hardware-accelerated and beats a manual scan.

---

## Code Examples

### Full dynamic MEX in three languages

#### Go: TreeSet via `sort.Search` on a sorted slice (toy)

For Go without a built-in TreeSet, use `github.com/emirpasic/gods` or a segment tree. Below is a segment-tree-based dynamic MEX.

```go
package main

import "fmt"

type DynMEX struct {
    cap   int
    size  int
    tree  []int
    count map[int]int
}

func NewDynMEX(cap int) *DynMEX {
    sz := 1
    for sz <= cap {
        sz *= 2
    }
    m := &DynMEX{cap: cap, size: sz, tree: make([]int, 2*sz), count: map[int]int{}}
    for i := 0; i <= cap; i++ {
        m.tree[sz+i] = 1
    }
    for i := sz - 1; i > 0; i-- {
        m.tree[i] = m.tree[2*i] + m.tree[2*i+1]
    }
    return m
}

func (m *DynMEX) set(i, val int) {
    i += m.size
    m.tree[i] = val
    for i /= 2; i > 0; i /= 2 {
        m.tree[i] = m.tree[2*i] + m.tree[2*i+1]
    }
}

func (m *DynMEX) Insert(v int) {
    if v < 0 || v > m.cap {
        return
    }
    m.count[v]++
    if m.count[v] == 1 {
        m.set(v, 0)
    }
}

func (m *DynMEX) Delete(v int) {
    if v < 0 || v > m.cap || m.count[v] == 0 {
        return
    }
    m.count[v]--
    if m.count[v] == 0 {
        m.set(v, 1)
    }
}

func (m *DynMEX) MEX() int {
    node := 1
    for node < m.size {
        if m.tree[2*node] > 0 {
            node = 2 * node
        } else {
            node = 2*node + 1
        }
    }
    return node - m.size
}

func main() {
    m := NewDynMEX(10)
    m.Insert(0); m.Insert(1); m.Insert(2)
    fmt.Println(m.MEX()) // 3
    m.Insert(4)
    fmt.Println(m.MEX()) // 3
    m.Delete(1)
    fmt.Println(m.MEX()) // 1
}
```

#### Java: TreeSet-of-missing

```java
import java.util.TreeSet;
import java.util.HashMap;

public class DynamicMEXTreeSet {
    private final TreeSet<Integer> missing = new TreeSet<>();
    private final HashMap<Integer, Integer> count = new HashMap<>();
    private final int cap;

    public DynamicMEXTreeSet(int cap) {
        this.cap = cap;
        for (int i = 0; i <= cap; i++) missing.add(i);
    }

    public void insert(int v) {
        if (v < 0 || v > cap) return;
        int c = count.getOrDefault(v, 0);
        if (c == 0) missing.remove(v);
        count.put(v, c + 1);
    }

    public void delete(int v) {
        if (v < 0 || v > cap) return;
        Integer c = count.get(v);
        if (c == null || c == 0) return;
        count.put(v, c - 1);
        if (c - 1 == 0) missing.add(v);
    }

    public int mex() {
        return missing.first();
    }

    public static void main(String[] args) {
        DynamicMEXTreeSet m = new DynamicMEXTreeSet(10);
        m.insert(0); m.insert(1); m.insert(2);
        System.out.println(m.mex()); // 3
        m.insert(4);
        System.out.println(m.mex()); // 3
        m.delete(1);
        System.out.println(m.mex()); // 1
    }
}
```

#### Python: SortedList-of-missing

```python
from sortedcontainers import SortedList
from collections import Counter

class DynamicMEX:
    def __init__(self, cap):
        self.cap = cap
        self.missing = SortedList(range(cap + 1))
        self.count = Counter()

    def insert(self, v):
        if not (0 <= v <= self.cap):
            return
        if self.count[v] == 0:
            self.missing.discard(v)
        self.count[v] += 1

    def delete(self, v):
        if not (0 <= v <= self.cap) or self.count[v] == 0:
            return
        self.count[v] -= 1
        if self.count[v] == 0:
            self.missing.add(v)

    def mex(self):
        return self.missing[0]

if __name__ == "__main__":
    m = DynamicMEX(10)
    for v in (0, 1, 2):
        m.insert(v)
    print(m.mex())  # 3
    m.insert(4)
    print(m.mex())  # 3
    m.delete(1)
    print(m.mex())  # 1
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|----------------|-----------------|
| Insert value outside cap | Out-of-bounds in bucket / tree | Guard with `0 ≤ v ≤ cap` |
| Delete value not present | Counter goes negative | Check `count[v] > 0` first |
| `mex()` on empty multiset | Different from MEX(∅) of "values 0..cap missing" | Initialize missing set with `{0..cap}` so empty multiset has `mex = 0` |
| Cap too small | Real MEX exceeds tracked range | Grow cap or use unbounded structure |
| Recomputing MEX each query in a dynamic setting | O(n) per query, TLE | Use TreeSet-of-missing or seg tree |

---

## Performance Analysis

Benchmark: 100k inserts, then 100k MEX queries.

| Approach | Build | Per-op MEX |
|----------|-------|-----------|
| Recompute bucket on each query | — | O(n) |
| TreeSet of missing | O(n log n) | O(log n) |
| Segment tree | O(n) | O(log n) |
| BitSet `nextClearBit` (static) | O(n/64) | O(n/64) |

For dynamic workloads with `n = 10^5` and `q = 10^5`, TreeSet/seg-tree solutions complete in ~0.2 s. Recompute fails (~10+ s).

### Python benchmark sketch

```python
import time
from sortedcontainers import SortedList

def bench(n=100_000):
    m = SortedList(range(n + 1))
    count = [0] * (n + 1)
    t0 = time.time()
    for i in range(n):
        v = i % (n // 2)
        if count[v] == 0:
            m.discard(v)
        count[v] += 1
    for _ in range(n):
        _ = m[0]
    print(f"{n} mixed ops in {(time.time() - t0)*1000:.1f} ms")

bench()
```

---

## Best Practices

- **Pick the structure once you know the workload pattern.** If it's just one MEX call, bucket. If many under updates, TreeSet/seg tree.
- **Cap the value range** explicitly at construction. Lazily growing the structure adds complexity for little gain.
- **Wrap with a unit test** that exercises empty, full-coverage, all-zero, and worst-case-after-deletes inputs.
- **In contests, prefer TreeSet** when the language has one (Java, C++ STL `std::set`, Python `SortedList`). Less code than a custom segment tree, same complexity.
- **For Sprague-Grundy**, memoize the recursion and keep state compact — Grundy tables explode otherwise.
- **Profile before reaching for persistent segment trees.** They are powerful but heavy; offline Mo's is often simpler and fast enough.

---

## Visual Animation

> See [`animation.html`](./animation.html) for interactive MEX variants.
>
> Middle-level animation includes:
> - Dynamic MEX: insert/delete and live MEX update
> - Side-by-side: bucket recompute vs TreeSet-of-missing
> - Range MEX query on a fixed array (Mo's window movement)
> - Sprague-Grundy table buildup for a subtraction game
> - Cap-overflow demonstration: what happens when MEX > tracked range

---

## Summary

At middle level, MEX is no longer one algorithm but a family selected by workload. For static, bucket; for dynamic, TreeSet-of-missing or segment tree; for range queries, persistent segment tree or Mo's; for game theory, the MEX-of-reachable pattern. The invariant `MEX ≤ |S|` keeps every variant in linear space, and most dynamic operations land at O(log n) per call. The hardest part is recognizing **which** MEX problem you actually have.
