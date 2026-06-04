# Binary Trie & XOR Linear Basis — Senior Level

> **One-line summary:** Production and competitive concerns — choosing bit-width and node representation (pointer vs array-pooled) to control memory and cache behavior; persistent and offline-sorted tries for *constrained* max-XOR (value ≤ limit, index in a range); the linear basis in streaming/online/segment-tree settings; and disciplined testing of both structures against brute-force oracles plus their realistic failure modes.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Bit-Width and Memory Layout of Tries](#2-bit-width-and-memory-layout-of-tries)
3. [Constrained Max-XOR: Offline and Persistent](#3-constrained-max-xor-offline-and-persistent)
4. [The Linear Basis in Streaming and Online Settings](#4-the-linear-basis-in-streaming-and-online-settings)
5. [Basis over Segment Trees and Ranges](#5-basis-over-segment-trees-and-ranges)
6. [Persistent Trie Implementation](#6-persistent-trie-implementation)
7. [Numerical and Correctness Failure Modes](#7-numerical-and-correctness-failure-modes)
8. [Testing Against Brute Force](#8-testing-against-brute-force)
9. [Code Examples](#9-code-examples)
10. [Tuning Decisions and Trade-offs](#10-tuning-decisions-and-trade-offs)
11. [Operational Checklist](#11-operational-checklist)
12. [Summary](#12-summary)

---

## 1. Introduction

A senior engineer or competitive programmer reaching for these XOR structures cares less about *what* they do and more about *how they behave at scale*: how many bytes per node, whether the allocator thrashes, how to add constraints (only consider values ≤ a limit, or only indices in `[l, r]`), how to keep a basis correct under a stream or inside a segment tree, and how to prove an implementation right when `n` is too large to brute-force directly. This file treats each of those.

Two recurring tensions shape the engineering. First, the **trie trades memory for generality**: it stores every value as a path and so costs `O(n·B)` nodes, which is large; the basis stores only `O(B)` words but answers a narrower (subset-only) class of questions. Second, **constraints change everything**: "max XOR" is trivial with one trie, but "max XOR using only values ≤ limit" or "...only indices in `[l, r]`" forces offline sorting, persistence, or a mergeable basis. We work through the standard, battle-tested resolutions.

---

## 2. Bit-Width and Memory Layout of Tries

### 2.1 Choosing `B`

`B` must satisfy `2^B > max_value`. For values `< 10^9`, `B = 30`; for 32-bit unsigned, `B = 32`; for 64-bit, `B = 64`. Every wasted high bit multiplies both time and node count. If values are bounded tightly (say `< 10^6`), use `B = 20` and save a third of the work versus `B = 30`.

### 2.2 Pointer nodes vs array-pooled nodes

A naive `struct Node { Node* child[2]; int cnt; }` allocated with `new`/`make` per node is correct but slow: each allocation hits the allocator, scatters nodes across memory, and pressures the garbage collector. The production pattern is an **array pool**: store all nodes in one flat array (`ch[node][bit]` as integer indices, `cnt[node]`), pre-sized to the worst case `n·B + 1`. Index `0` is the root and doubles as the "null child" sentinel (since the root is never a child). Benefits: one allocation, contiguous memory, cache-friendly traversal, trivial reset (`size = 1`).

| Representation | Bytes/node (approx) | Allocations | Cache | Reset |
|----------------|---------------------|-------------|-------|-------|
| Pointer objects | 24–48 + header | n·B | poor | GC churn |
| Array pool (int indices) | ~12 (2×int4 + cnt) | 1 | excellent | `size = 1` |

### 2.3 Memory budget arithmetic

With `n = 2·10^5` and `B = 30`, the worst case is `6·10^6` nodes. At ~12 bytes each that is ~72 MB — comfortable. At `n = 10^6, B = 30` it is `3·10^7` nodes (~360 MB) — borderline; consider a smaller `B`, a basis instead, or path compression. **Path-compressed (radix) tries** collapse single-child chains, but the bit-by-bit greedy walk loses its simplicity; in practice the flat array pool with a tight `B` is the standard competitive choice.

### 2.4 Resetting between test cases

Do not reallocate. Reset by zeroing only the used prefix: `for k in 0..size: ch[k] = {0,0}; cnt[k] = 0; size = 1`. Zeroing the whole capacity each test is a common TLE cause when there are many small test cases.

### 2.5 Sizing the node pool exactly

Pre-allocating the worst case avoids reallocation mid-run. The bound per structure:

| Structure | Worst-case nodes | Note |
|-----------|------------------|------|
| Plain trie of `n` values | `n·B + 1` | each value adds ≤ `B` |
| Counting trie | same | counts add no nodes |
| Persistent trie | `(n + 1)·B + 1` | one path cloned per insert |

For competitive use, allocate `n*B + 5` to be safe and never grow. In Go, `make([][2]int, 1, n*B+5)` reserves capacity so `append` never reallocates the backing array.

### 2.6 Cache behavior of the walk

The greedy walk follows pointer-like indices that jump around the node array, so it is not perfectly sequential. Two mitigations help in practice:

- Insert in an order that keeps shared prefixes contiguous (e.g. insert sorted), improving locality for the common high-bit nodes near the root.
- Keep the node struct small (two `int32` children plus an `int32` count fits in 12 bytes), so more nodes share a cache line.

These are constant-factor wins; the asymptotic cost stays `O(B)` per operation.

---

## 3. Constrained Max-XOR: Offline and Persistent

The plain trie answers "max XOR of `x` against the whole set." Real problems add constraints.

### 3.1 Constraint: only values ≤ limit (offline incremental insertion)

LeetCode 1707 *Maximum XOR With an Element From Array* asks, for each query `(x, m)`, the maximum `x ^ a` over array elements `a ≤ m`. The trick is **offline sorting**:

1. Sort the array ascending.
2. Sort the queries by `m` ascending, remembering original positions.
3. Sweep queries in order; before answering query `(x, m)`, insert all array elements `≤ m` into the trie (a monotone pointer that only advances).
4. Answer `maxXor(x)`; if no element was eligible, output `-1`.

Each element is inserted once and each query answered once, so total `O((n + q)·B + sorting)`. The monotone insertion pointer is the heart of the technique — it works because the constraint `a ≤ m` is a prefix of the sorted order.

### 3.2 Constraint: only indices in a range `[l, r]` (persistent trie)

When the constraint is positional — "max `x ^ a[i]` for `i ∈ [l, r]`" — sorting by value is useless. Build a **persistent binary trie**: maintain `root[i]` = a trie of `a[0..i-1]`, where inserting `a[i]` creates only the `O(B)` nodes on the changed path and shares everything else with `root[i]`. To query range `[l, r]`, walk `root[r+1]` and `root[l]` in lockstep; the count of values in the range that pass through a child is `cnt_{r+1}[child] - cnt_l[child]`. A child "exists in the range" iff that difference is `> 0`. This gives `O(B)` per range query with `O(n·B)` total nodes.

The persistent trie is also the route to "k-th smallest XOR in a range" and "count in range with XOR < k" — all by replacing single counts with the version-difference of counts.

### 3.3 Constraint: prefix-XOR transform

Many "subarray XOR" problems convert to "pair XOR" via the prefix-XOR array `P` where `P[i] = a[0] ^ ... ^ a[i-1]`, since `xor(l..r) = P[r+1] ^ P[l]`. Then "max XOR subarray" becomes "max XOR pair over `P`" — a plain trie problem. Recognizing this transform turns a whole class of subarray problems into the canonical trie task.

The transform pipeline, step by step:

1. Build `P[0..n]` with `P[0] = 0` and `P[i] = P[i-1] ^ a[i-1]`.
2. Insert `P[0]` into the trie first (the empty-prefix sentinel matters — it represents subarrays starting at index 0).
3. For each `j` from `1` to `n`: query `maxXor(P[j])` against the trie, update the answer, then insert `P[j]`.
4. The maximum found is the maximum XOR over all subarrays.

A subtle correctness point: inserting `P[0] = 0` before any query is essential, otherwise prefixes starting at the very beginning are missed. Forgetting it is a frequent off-by-one.

### 3.4 Combining constraints

Real problems sometimes combine constraints — e.g. "max `x ^ a[i]` for `i ∈ [l, r]` *and* `a[i] ≤ m`." These generally require a 2D structure (persistent trie keyed by index with values inserted in sorted order, or a wavelet tree). The rule of thumb: each independent constraint dimension multiplies the structure complexity, so push as many constraints as possible into offline ordering before resorting to a heavier 2D structure.

---

## 4. The Linear Basis in Streaming and Online Settings

### 4.1 Streaming insert-only

The basis shines on streams: it never exceeds `B` vectors, so a billion-element stream costs `O(B)` memory and `O(B)` per element. There is no deletion in a plain basis — once a vector is absorbed, you cannot remove its contribution without rebuilding. If deletions are required, you need a different design (below).

### 4.2 The "time-stamped" basis for deletions / sliding windows

To support a sliding window (insert at the front, drop from the back), keep, alongside each pivot, the **index/timestamp of the latest element that set it**. When inserting a new element, if it competes for an occupied pivot, keep whichever vector has the *newer* timestamp and continue reducing the older one downward (greedy "keep the most recent" rule). For a max-XOR query over the window `[l, r]`, only use pivots whose timestamp `≥ l`. This supports queries over suffix windows without rebuilds and is the standard online-basis trick.

### 4.3 Online "is `v` representable so far" / incremental rank

Because `add` returns whether the rank grew, you can answer "is the new element independent of all previous?" and maintain a running rank (= `log2` of distinct XORs) in `O(B)` per element — useful for problems like "size of the largest subset with distinct XOR span" or counting linearly independent vectors online.

### 4.4 Memory profile across stream sizes

The basis's headline advantage is that memory is flat regardless of stream length:

| Stream length `n` | Trie nodes (B=30) | Basis words |
|-------------------|-------------------|-------------|
| `10^3` | up to `3·10^4` | ≤ 30 |
| `10^6` | up to `3·10^7` | ≤ 30 |
| `10^9` | up to `3·10^{10}` | ≤ 30 |

Whenever the question is subset-shaped, the basis turns an unbounded-memory problem into a constant-memory one.

### 4.5 What the basis cannot do online

The plain basis is **monotone**: rank only grows. It cannot:

- Remove an element's contribution (no deletion) without the timestamped variant.
- Report *which* original elements form a witnessing subset, unless you track contributions per pivot.
- Answer pair or per-element queries — it has discarded element identity.

Knowing these limits prevents reaching for the basis on problems it structurally cannot solve.

---

## 5. Basis over Segment Trees and Ranges

For arbitrary range queries "max subset-XOR using `a[l..r]`," build a **segment tree of bases**: each node stores the basis of its segment, and `merge` combines children. A query merges `O(log n)` node bases (each merge is `O(B²)`), giving `O(B² log n)` per query and `O(n·B)` space (each level stores total `B` per node). This is the canonical structure for offline-or-online range subset-XOR maxima where a persistent trie does not apply (subset, not pair).

| Structure | Question | Build | Query |
|-----------|----------|-------|-------|
| Persistent trie | range *pair* max-XOR / k-th / count<k | O(n·B) | O(B) |
| Segment tree of bases | range *subset* max-XOR / rank | O(n·B²) | O(B² log n) |
| Single basis | global subset max-XOR / count | O(n·B) | O(B) |
| Offline-sorted trie | value-constrained max-XOR | O((n+q)·B) | amortized O(B) |

---

## 6. Persistent Trie Implementation

A persistent binary trie is the standard answer to index-range-constrained max-XOR. The key idea: `insert` returns a *new* root and clones only the `O(B)` nodes on the changed path, sharing the rest with the previous version. We keep `root[i]` for the prefix `a[0..i-1]` and answer a query on `[l, r]` by walking versions `r+1` and `l` together, using the count difference to test child presence within the range.

### 6.1 Node layout for persistence

Each node stores two child indices and a subtree count:

```
node:  { ch[0], ch[1], cnt }
root[i] = trie containing a[0..i-1]
```

Persistence means we never mutate an existing node; `insert` allocates fresh nodes along one path.

### 6.2 Worked range query intuition

To find `max(x ^ a[i])` for `i ∈ [l, r]`:

- At each bit, compute `wantCnt = cnt_{r+1}[child_opposite] − cnt_l[child_opposite]`.
- If `wantCnt > 0`, an in-range value takes the opposite branch → descend it, bank a `1`.
- Otherwise descend the same-bit branch in both versions and bank a `0`.

The subtraction isolates exactly the values inserted between version `l` and version `r+1`, i.e. indices in `[l, r]`.

### 6.3 Reference persistent-trie (Python)

```python
B = 30
CH = [[0, 0]]   # ch[node] = [left, right]
CNT = [0]


def _new(c0, c1, cnt):
    CH.append([c0, c1])
    CNT.append(cnt)
    return len(CH) - 1


def insert(prev, x):
    cur = _new(CH[prev][0], CH[prev][1], CNT[prev] + 1)
    root = cur
    for i in range(B - 1, -1, -1):
        b = (x >> i) & 1
        old = CH[cur][b]
        nn = _new(CH[old][0], CH[old][1], CNT[old] + 1)
        CH[cur][b] = nn
        cur = nn
    return root


def max_xor_range(rl, rr, x):
    # rl = root[l], rr = root[r+1]
    res = 0
    for i in range(B - 1, -1, -1):
        b = (x >> i) & 1
        want = 1 - b
        cl = CH[rl][want]
        cr = CH[rr][want]
        if CNT[cr] - CNT[cl] > 0:
            res |= 1 << i
            rl, rr = CH[rl][want], CH[rr][want]
        else:
            rl, rr = CH[rl][b], CH[rr][b]
    return res


def build(a):
    roots = [0]  # root[0] = empty trie (node 0)
    for v in a:
        roots.append(insert(roots[-1], v))
    return roots


if __name__ == "__main__":
    a = [3, 10, 5, 25, 2, 8]
    roots = build(a)
    # max x^a[i] for i in [1,3] (values 10,5,25), x = 5
    print(max_xor_range(roots[1], roots[4], 5))  # 28 (5 ^ 25)
```

This gives `O(B)` per range query with `O(n·B)` total node allocations. The same version-difference trick extends to range count-with-XOR-`< k` and range k-th-XOR.

---

## 7. Numerical and Correctness Failure Modes

- **Bit-width underflow.** A value with a set bit above `B-1` silently loses it; answers come back too small with no error. Always assert `max(values) < (1 << B)`.
- **Signed shifts.** In Java/Go, `1 << i` is `int` (32-bit); for `B = 32` or wide values use `1L << i` / `int64`. A `1 << 31` overflow flips sign and corrupts the walk.
- **Sentinel collision.** Using `0` as both root and "null child" requires real nodes to start at index `1`; a bug that hands out index `0` as a child silently merges subtrees.
- **Forgotten reset.** Reusing a global trie/basis across test cases without resetting leaks state from the previous case — a classic wrong-answer source.
- **Basis non-determinism.** `maxXor` is well-defined, but the *stored vectors* differ depending on insertion order (the span is identical). Tests must compare spans/results, not raw `basis[]` contents.
- **k-th on un-reduced basis.** `kthXor` requires reduced echelon form; an un-reduced basis returns wrong (unsorted) results.
- **Empty-subset accounting.** Distinct XOR count `2^rank` includes the empty subset (value 0). Off-by-one if the problem excludes 0.
- **Persistent count subtraction.** Range counts use `cnt_{r+1} - cnt_l`; mixing up which version is which yields negative or inflated counts.

---

## 8. Testing Against Brute Force

Both structures have small, cheap oracles — use them.

- **Max XOR pair:** `O(n²)` double loop. Run the trie against it on thousands of random arrays with small `n` and small `B`.
- **Count pairs XOR < k:** `O(n²)` double loop counting `nums[i]^nums[j] < k`.
- **Max subset XOR:** enumerate all `2^n` subsets for `n ≤ 18`; compare the OR-of-all-XORs maximum to the basis result.
- **Distinct subset XORs:** collect all `2^n` subset XORs into a set; its size must equal `2^rank`.
- **k-th XOR:** sort the deduplicated subset-XOR set; index `k` must equal `kthXor(k)`.
- **Persistent / range:** brute the range with a fresh small trie or a double loop.

Use property-based testing: random `n`, random `B`, random values, random queries; assert structure == oracle. Seed the RNG so failures are reproducible. This catches sentinel bugs, off-by-one bit loops, and reduction errors that example tests miss.

---

## 9. Code Examples

### 9.1 Go — array-pooled trie with reset, offline value-constrained max-XOR

```go
package main

import (
	"fmt"
	"sort"
)

const B = 30

var ch [][2]int
var size int

func reset(cap int) {
	if cap > len(ch) {
		ch = make([][2]int, cap)
	}
	for i := 0; i < size; i++ {
		ch[i] = [2]int{0, 0}
	}
	size = 1 // node 0 = root
}

func insert(x int) {
	node := 0
	for i := B - 1; i >= 0; i-- {
		b := (x >> i) & 1
		if ch[node][b] == 0 {
			ch[size] = [2]int{0, 0}
			ch[node][b] = size
			size++
		}
		node = ch[node][b]
	}
}

func maxXor(x int) int {
	node, res := 0, 0
	for i := B - 1; i >= 0; i-- {
		b := (x >> i) & 1
		want := 1 - b
		if ch[node][want] != 0 {
			res |= 1 << i
			node = ch[node][want]
		} else if ch[node][b] != 0 {
			node = ch[node][b]
		} else {
			return -1 // empty trie
		}
	}
	return res
}

// For each query (x, m): max x^a over a <= m, else -1.
func maximizeXor(nums []int, queries [][2]int) []int {
	reset(len(nums)*B + 1)
	sort.Ints(nums)
	idx := make([]int, len(queries))
	for i := range idx {
		idx[i] = i
	}
	sort.Slice(idx, func(a, b int) bool { return queries[idx[a]][1] < queries[idx[b]][1] })
	ans := make([]int, len(queries))
	j := 0
	for _, qi := range idx {
		x, m := queries[qi][0], queries[qi][1]
		for j < len(nums) && nums[j] <= m {
			insert(nums[j])
			j++
		}
		if j == 0 {
			ans[qi] = -1
		} else {
			ans[qi] = maxXor(x)
		}
	}
	return ans
}

func main() {
	nums := []int{0, 1, 2, 3, 4}
	queries := [][2]int{{3, 1}, {1, 3}, {5, 6}}
	fmt.Println(maximizeXor(nums, queries)) // [3 3 7]
}
```

### 9.2 Java — time-stamped basis for suffix-window max-XOR

```java
public class TimedBasis {
    static final int B = 30;
    long[] vec = new long[B];   // pivot vectors
    int[] when = new int[B];    // index that last set this pivot

    // insert value with timestamp t (keep newest at each pivot)
    void add(long x, int t) {
        for (int i = B - 1; i >= 0; i--) {
            if (((x >> i) & 1) == 0) continue;
            if (vec[i] == 0) { vec[i] = x; when[i] = t; return; }
            if (when[i] < t) {           // keep the newer vector here
                long tmpV = vec[i]; int tmpT = when[i];
                vec[i] = x; when[i] = t;
                x = tmpV; t = tmpT;      // push the older one down
            }
            x ^= vec[i];
        }
    }

    // max XOR using only elements with timestamp >= l
    long maxXorSuffix(int l) {
        long res = 0;
        for (int i = B - 1; i >= 0; i--)
            if (vec[i] != 0 && when[i] >= l && (res ^ vec[i]) > res) res ^= vec[i];
        return res;
    }

    public static void main(String[] args) {
        TimedBasis tb = new TimedBasis();
        int[] a = {3, 10, 5, 25, 2, 8};
        for (int t = 0; t < a.length; t++) tb.add(a[t], t);
        System.out.println("max XOR over suffix from index 2 = " + tb.maxXorSuffix(2));
    }
}
```

### 9.3 Python — property-based test of basis vs brute force

```python
import random
from itertools import combinations

B = 16


class Basis:
    def __init__(self):
        self.b = [0] * B
        self.rank = 0

    def add(self, x):
        for i in range(B - 1, -1, -1):
            if not (x >> i) & 1:
                continue
            if self.b[i] == 0:
                self.b[i] = x
                self.rank += 1
                return
            x ^= self.b[i]

    def max_xor(self):
        r = 0
        for i in range(B - 1, -1, -1):
            if self.b[i] and (r ^ self.b[i]) > r:
                r ^= self.b[i]
        return r


def brute(nums):
    seen = {0}
    for k in range(1, len(nums) + 1):
        for c in combinations(nums, k):
            x = 0
            for v in c:
                x ^= v
            seen.add(x)
    return max(seen), len(seen)


def test():
    random.seed(42)
    for _ in range(2000):
        n = random.randint(0, 12)
        nums = [random.randrange(1 << B) for _ in range(n)]
        bs = Basis()
        for v in nums:
            bs.add(v)
        bmax, bcount = brute(nums)
        assert bs.max_xor() == bmax, (nums, bs.max_xor(), bmax)
        assert (1 << bs.rank) == bcount, (nums, 1 << bs.rank, bcount)
    print("all basis tests passed")


if __name__ == "__main__":
    test()
```

**Run:** `go run main.go` | `javac TimedBasis.java && java TimedBasis` | `python test_basis.py`

---

## 10. Tuning Decisions and Trade-offs

This section collects the recurring "which variant?" decisions a senior must make under contest or production constraints.

### 10.1 Decision table: which structure for which constraint

| Question shape | Constraint | Structure | Cost |
|----------------|-----------|-----------|------|
| max XOR of a pair | none | single trie | `O(n·B)` |
| max XOR of `x` vs set | online inserts | single trie | `O(B)`/op |
| max XOR of `x` vs set | online + deletes | trie + counts | `O(B)`/op |
| max XOR, value ≤ m | offline queries | sorted trie + sweep | `O((n+q)·B)` |
| max XOR, index ∈ [l,r] | range | persistent trie | `O(B)`/query |
| max XOR of any subset | none | single basis | `O(B)` |
| max XOR of subset, index ∈ [l,r] | range | segtree of bases | `O(B² log n)` |
| count distinct subset XORs | streaming | single basis | `O(B)`/elt |
| max XOR over sliding window | window | timed basis | `O(B)`/op |

### 10.2 Memory vs generality

The fundamental trade is memory for question-generality:

- A **trie** costs `O(n·B)` but answers element/pair/range questions and supports deletion.
- A **basis** costs `O(B)` but answers only subset-span questions and cannot delete (without timestamps).
- A **persistent trie** costs `O(n·B)` and unlocks index-range pair questions.
- A **segment tree of bases** costs `O(n·B)` and unlocks index-range subset questions.

When both a trie and a basis could answer a problem (rare), prefer the basis for its `O(B)` footprint unless you need pairs, deletion, or per-element identity.

### 10.3 Constant-factor levers

For the hot inner loops:

- Pool nodes in a flat array; avoid per-node heap objects.
- Hoist `(x >> i) & 1` out where possible; some compilers do not.
- Prefer iterative bit loops over recursion for the trie walk.
- Batch queries and reuse a single trie/basis instance; never rebuild per query.
- For many test cases, reset by zeroing only the `size` used nodes.

### 10.4 When to abandon these structures

Reach for something else when:

- `V` (distinct values) is tiny and `n` huge → a frequency map plus brute pair scan may win on constants.
- The query is about *sums* or *products*, not XOR → these structures do not apply at all.
- You need *simple-subset* constraints (e.g. "subset of size exactly `k` maximizing XOR") → that is a different, often NP-hard, problem.

---

## 11. Operational Checklist

- Size `B` to the data; assert `max(values) < (1 << B)`.
- Use an array-pooled node layout; index `0` = root = null sentinel; real nodes start at `1`.
- Reset by zeroing the used prefix only, not the whole capacity.
- Use 64-bit shifts (`1L`/`int64`) when `B ≥ 32` or values exceed 31 bits.
- For value constraints, sort offline and use a monotone insertion pointer.
- For index-range constraints on *pair* XOR, use a persistent trie with version-difference counts.
- For range *subset* XOR, use a segment tree of bases (`O(B² log n)` per query).
- For sliding windows on the basis, store per-pivot timestamps and keep the newest.
- Test both structures with property-based randomized comparison to brute force.

---

## 12. Summary

At senior scale the binary trie's cost is memory: `O(n·B)` nodes, so an array-pooled layout with a tightly chosen `B`, a `0`-as-root-and-null sentinel, and prefix-only resets are non-negotiable for performance. Constraints reshape the problem: value constraints (≤ limit) fall to offline sorting with a monotone insertion pointer; index-range constraints on pair-XOR fall to a persistent trie with version-difference counts; range subset-XOR falls to a segment tree of bases. The linear basis dominates streaming with `O(B)` memory and supports sliding windows via per-pivot timestamps that keep the newest vector. Across all of it, the discipline that keeps you correct is property-based testing against tiny brute-force oracles, plus vigilance over the recurring failure modes: bit-width underflow, signed-shift overflow, sentinel collisions, missing resets, and k-th queries on an un-reduced basis.
