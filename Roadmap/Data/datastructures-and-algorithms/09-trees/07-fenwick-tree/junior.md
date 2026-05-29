# Fenwick Tree (Binary Indexed Tree) — Junior Level

> **Read time: ~35 minutes** · **Audience:** Engineers who know arrays, loops, and basic bit operations and want to learn the single most elegant data structure for prefix-sum maintenance.

A **Fenwick tree** — equivalently a **binary indexed tree (BIT)** — is a data structure that maintains a sequence of numbers under two operations: **point update** (add a delta to one position) and **prefix-sum query** (the sum of the first `i` elements), both in **O(log n)** time. It is the most memory-efficient and lines-of-code-efficient solution to this problem. A segment tree solves the same problem, but uses roughly twice as much memory and roughly four times as much code; for the common case of an invertible aggregate (sum, XOR, count), a BIT wins on every practical axis.

The structure was introduced by **Peter Fenwick** in 1994 in the paper *"A New Data Structure for Cumulative Frequency Tables"* (Software — Practice and Experience, 24(3):327–336). Fenwick designed it for **arithmetic coding** in data compression: an arithmetic coder needs cumulative frequency counts that change as each symbol is encoded, and those counts must be queried millions of times per second. A segment tree was overkill; a sorted array was too slow to update. Fenwick observed that the binary representation of an index naturally partitions a range into power-of-two pieces, and built a structure where prefix sums are computed in `O(log n)` operations against a single array of size `n`. The result is now standard equipment in competitive programming, time-series databases, statistical accelerators, and inverted-index implementations.

This document teaches you the BIT **so thoroughly** that you understand why `i & -i` is the heart of the algorithm, why the tree is 1-indexed, why updates propagate "upward" and queries "downward", and why you cannot use it for `min`/`max` queries even though you can for `sum`/`xor`.

---

## Table of Contents

1. [Introduction — Prefix Sums Under Updates](#introduction)
2. [Prerequisites — `i & -i` Returns the Lowest Set Bit](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Responsibility Ranges and `lowbit`](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons vs Segment Tree](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — 1-Indexed Convention](#patterns)
11. [Error Handling — Off-by-One and Index 0](#errors)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Prefix Sums Under Updates

You have an array `A` of `n` numbers. You want to support two operations:

- `update(i, delta)`: add `delta` to `A[i]`.
- `prefix(i)`: return `A[1] + A[2] + ... + A[i]`.

**Static prefix sums** (no updates) are trivial: precompute `P[i] = A[1] + ... + A[i]` once in O(n) and answer every query in O(1). The catch is that **a single update to `A[k]` invalidates `P[k], P[k+1], ..., P[n]`** — O(n) prefix entries change for a single point update. So if updates are frequent, the static technique collapses.

The other extreme: don't precompute anything. Each `prefix(i)` walks `A[1..i]` and sums — O(n) per query but O(1) per update. For a mix of `q` queries and `u` updates, total cost is `O(q · n + u)`.

A Fenwick tree gives you **O(log n) for both operations**. On a million-element array, that is 20 cycles per operation instead of one million. For competitive programming where `n = 10^5` and operations are `10^5`, the difference is `10^10` total comparisons (impossible) versus `10^6` (instant).

A segment tree solves the same problem in O(log n) per op, but uses an array of size `2n` to `4n` and roughly 60–80 lines of code. The Fenwick tree uses an array of size `n+1` and **six lines** for update and **six lines** for query. The catch: a BIT only supports **invertible aggregates** — operations where range query reduces to `prefix(r) - prefix(l-1)`. Sum is invertible. XOR is invertible. Count is invertible. `min` and `max` are **not** invertible; you cannot subtract a min from a min. For min/max range queries, you need a segment tree, sparse table, or related structure.

For competitive programmers, Fenwick trees are the first tool out of the box. They appear in `LC 307`, `LC 308`, `LC 315`, `LC 327`, `LC 493`, and countless Codeforces and ICPC problems. They also appear in production: **InfluxDB** uses BIT-like structures for histogram queries; **arithmetic coders** in deflate/bzip2 use the original Fenwick design.

---

<a name="prerequisites"></a>
## 2. Prerequisites — `i & -i` Returns the Lowest Set Bit

The Fenwick tree's elegance depends entirely on one bit trick. For any positive integer `i`, the expression `i & -i` produces a power of two equal to the **lowest set bit** of `i`. Examples on 8-bit signed integers:

| `i` | binary | `-i` (two's complement) | `i & -i` | decimal |
|---|---|---|---|---|
| 1 | `00000001` | `11111111` | `00000001` | 1 |
| 2 | `00000010` | `11111110` | `00000010` | 2 |
| 3 | `00000011` | `11111101` | `00000001` | 1 |
| 4 | `00000100` | `11111100` | `00000100` | 4 |
| 5 | `00000101` | `11111011` | `00000001` | 1 |
| 6 | `00000110` | `11111010` | `00000010` | 2 |
| 7 | `00000111` | `11111001` | `00000001` | 1 |
| 8 | `00001000` | `11111000` | `00001000` | 8 |
| 12 | `00001100` | `11110100` | `00000100` | 4 |

**Why does this work?** In two's complement, `-i` is `~i + 1`. Adding 1 to `~i` ripples through the trailing zeros of `~i` (which are the trailing ones of `i`... wait, the trailing zeros of `i` become trailing ones in `~i`, and adding 1 flips them back to zeros while flipping the next bit). After all the dust settles, `-i` agrees with `i` on the lowest set bit and disagrees everywhere else above it. ANDing keeps only the agreement: a single bit, the lowest set bit.

We call this function **`lowbit(i)`**:

```
lowbit(i) = i & -i
```

It is the only "trick" the BIT uses. Update walks upward by `i += lowbit(i)`. Query walks downward by `i -= lowbit(i)`. Each step strips one bit from the binary representation, so both loops terminate in O(log i) steps.

**Note on Python:** Python's integers are arbitrary precision, but `-i` still computes the conceptual two's complement, and `i & -i` returns the correct lowest set bit for all positive integers. In Go and Java this works directly on the native `int`. In all three languages: `lowbit(0) == 0` (which is why the loops never start at index 0 — see `errors` section).

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Fenwick tree** | A 1-indexed array `BIT[1..n]` where each cell `BIT[i]` stores the sum of a contiguous range of original-array elements ending at index `i`. |
| **Binary indexed tree (BIT)** | Synonym for Fenwick tree. The name emphasizes that the binary representation of `i` determines the structure. |
| **`lowbit(i)`** | `i & -i`. The largest power of two that divides `i`. Equals the lowest set bit of `i`. |
| **Responsibility range of `i`** | The contiguous index range `[i - lowbit(i) + 1, i]` whose sum is stored in `BIT[i]`. Has length `lowbit(i)`. |
| **Point update** | Modify a single position in the underlying array. `BIT.update(i, delta)` adds `delta` to `A[i]`. |
| **Prefix sum** | `A[1] + A[2] + ... + A[i]`, written `prefix(i)`. |
| **Range sum** | `A[l] + ... + A[r] = prefix(r) - prefix(l-1)` for invertible aggregates. |
| **Invertible aggregate** | An operation `op` with an inverse `op^{-1}`, so `op(a, op^{-1}(a, b)) = b`. Sum (inverse: subtraction) and XOR (inverse: XOR itself) are invertible. Min, max, gcd, and bitwise OR are not. |
| **1-indexed** | Indices start at 1, not 0. Forced by the algorithm because `lowbit(0) = 0` would cause an infinite loop. Allocate `BIT` of size `n+1` and ignore `BIT[0]`. |
| **Build** | The act of constructing the BIT from an existing array. Naive: O(n log n). Optimal: O(n) by absorbing children. |
| **Difference BIT** | A BIT storing differences `d[i] = A[i] - A[i-1]`. Used to support range-update + point-query. |
| **Two-BIT trick** | Two parallel BITs that together support range-update + range-query in O(log n). |
| **2D BIT** | A BIT of BITs. Each row is a BIT; the array of rows is also organized as a BIT. Supports point update + rectangle prefix sum in O(log² n). |
| **Binary lifting on BIT** | A technique to find the smallest `i` with `prefix(i) >= k` in O(log n) by descending the implicit tree level by level. Used for order-statistic queries. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Responsibility Ranges and `lowbit`

### 4.1 The shape of the tree

Forget the word "tree" for a moment. The Fenwick tree is **just one array**, `BIT[1..n]`, the same size as the input array (we ignore `BIT[0]`). The "tree" is implicit in how indices relate to each other through `lowbit`.

Each index `i` is **responsible for** a range of length `lowbit(i)` ending at `i`:

```
BIT[i] = A[i - lowbit(i) + 1] + A[i - lowbit(i) + 2] + ... + A[i]
```

For `n = 8`, the responsibility ranges are:

| `i` | binary | `lowbit(i)` | responsibility range | `BIT[i]` stores |
|---|---|---|---|---|
| 1 | `001` | 1 | `[1, 1]` | A[1] |
| 2 | `010` | 2 | `[1, 2]` | A[1] + A[2] |
| 3 | `011` | 1 | `[3, 3]` | A[3] |
| 4 | `100` | 4 | `[1, 4]` | A[1]+A[2]+A[3]+A[4] |
| 5 | `101` | 1 | `[5, 5]` | A[5] |
| 6 | `110` | 2 | `[5, 6]` | A[5] + A[6] |
| 7 | `111` | 1 | `[7, 7]` | A[7] |
| 8 | `1000` | 8 | `[1, 8]` | A[1]+...+A[8] |

Notice the pattern: **odd indices store only themselves**; powers of two store the entire prefix; everything else stores a power-of-two-length range ending at itself.

Visually, the implicit "tree" looks like a bracket:

```
                    [---------- BIT[8] ----------]
                    [-- BIT[4] --]
                    [BIT[2]] [BIT[6]]
                    B1 B3 B5 B7
positions:          1  2  3  4  5  6  7  8
```

`BIT[8]` covers `[1..8]`, `BIT[4]` covers `[1..4]`, `BIT[6]` covers `[5..6]`, and so on. The "parent" of each cell `BIT[i]` is `BIT[i + lowbit(i)]` — adding the lowest bit jumps to the cell that *contains* the current responsibility range. The "previous sibling" used during query is `BIT[i - lowbit(i)]` — subtracting the lowest bit jumps left to the cell whose responsibility range ends just before yours.

### 4.2 Prefix-sum query: walk down

To compute `prefix(i) = A[1] + ... + A[i]`, decompose `[1..i]` into a disjoint union of responsibility ranges and sum them.

```
i = 7  =  111 binary
prefix(7) = BIT[7] + BIT[6] + BIT[4]
          = A[7] + (A[5]+A[6]) + (A[1]+A[2]+A[3]+A[4])
          = A[1]+A[2]+A[3]+A[4]+A[5]+A[6]+A[7]   ✓
```

The walk: start at `i`, add `BIT[i]`, then `i -= lowbit(i)`. Repeat until `i == 0`.

```
i=7  (111): add BIT[7], i = 7 - 1 = 6
i=6  (110): add BIT[6], i = 6 - 2 = 4
i=4  (100): add BIT[4], i = 4 - 4 = 0
done
```

Each step strips one set bit. The number of steps equals the number of set bits in `i`, at most `⌈log₂ n⌉`. So `prefix` is O(log n).

### 4.3 Point update: walk up

To update `A[i] += delta`, we must update **every** `BIT[j]` whose responsibility range includes `i`. Those are `BIT[i]`, `BIT[i + lowbit(i)]`, `BIT[i + lowbit(i + lowbit(i))]`, and so on, until we exceed `n`.

```
i=3 (011), n=8:
  BIT[3] += delta, i = 3 + lowbit(3) = 3 + 1 = 4
  BIT[4] += delta, i = 4 + lowbit(4) = 4 + 4 = 8
  BIT[8] += delta, i = 8 + lowbit(8) = 8 + 8 = 16 > 8, stop
```

Three cells updated, matching the three steps from `3 (011) → 4 (100) → 8 (1000)`. Each step at most doubles `i`, so the loop runs at most `log₂ n` times. O(log n).

### 4.4 Range sum

For any invertible aggregate (sum, xor, count):

```
rangeSum(l, r) = prefix(r) - prefix(l-1)
```

This is why min and max do **not** work — `min(A[l..r])` is not `min(A[1..r]) - min(A[1..l-1])` because subtraction is not the inverse of min. A segment tree handles min/max because it can pick the smaller side directly without subtraction.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Operation | Time | Space |
|---|---|---|
| Build (naive) | O(n log n) | O(n) |
| Build (optimal, offline) | O(n) | O(n) |
| `update(i, delta)` | O(log n) | O(1) |
| `prefix(i)` | O(log n) | O(1) |
| `rangeSum(l, r)` | O(log n) | O(1) |
| Memory total | n+1 cells (vs ~4n for segment tree) | |

For `n = 10^6`: each operation is about 20 cycles. The whole BIT fits in 8 MB of `int64`, well within L3 cache. A segment tree for the same `n` would be 32 MB, easily spilling out of L3.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 Tournament bracket where each node sums its leaves

In a single-elimination tournament, each match-node represents a subset of original participants. Imagine instead that each node tracks the **total wins** of all participants in its subtree. To update one participant's win count, you walk up the bracket, incrementing each ancestor. To query the total wins of the left half of the tournament, you sum the appropriate subtree roots. That is exactly the BIT structure, except the "tree" lives implicitly inside the index arithmetic.

### 6.2 Layered partial sums in a spreadsheet

Imagine a spreadsheet where row 1 has 8 numbers, row 2 has 4 numbers (each is the sum of two consecutive row-1 entries), row 3 has 2 numbers, and row 4 has 1 number (the grand total). Updating a row-1 cell requires updating one cell in each row above — log₂ updates. Querying the prefix sum at position `i` requires picking at most one cell from each row and adding them — log₂ reads. A BIT is this layered structure stored in a single flat array.

### 6.3 Coin denominations

If you only have coins of denominations 1, 2, 4, 8, 16, …, any positive amount can be written as a sum of distinct denominations (the binary representation). The BIT decomposes the prefix `[1..i]` into ranges whose lengths are the distinct denominations summing to `i`. Updating one cell means contributing to every "denomination bucket" that contains it.

### 6.4 Arithmetic coding (the original use case)

In **arithmetic coding** (the algorithm behind formats like CABAC in H.264 video compression), the encoder maintains the cumulative frequency of each symbol seen so far. When a symbol is encoded, its frequency is incremented and the cumulative frequencies of all symbols ranked higher must be updated. Querying `cumFreq(symbol)` happens many times per byte. Fenwick's 1994 paper proposed the BIT precisely to make these queries and updates both O(log Σ) where Σ is the alphabet size.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons vs Segment Tree

### Pros of Fenwick tree

- **Half the memory.** `n+1` cells vs `2n`–`4n` for a segment tree.
- **One-third the code.** Update and prefix are six lines each; segment tree builds and queries are 30–40 lines.
- **Fewer branches.** Both loops are a single comparison and arithmetic — branch predictors love them.
- **Better cache locality.** Sequential memory layout exactly matches the input; segment trees have indirection.
- **Faster constant factor in practice.** Benchmarks consistently show 2–3× speedup over segment tree on identical workloads (see `middle.md`).
- **Easier to extend to higher dimensions.** 2D BIT is two nested loops of 1D BIT logic. 2D segment trees are notoriously painful.

### Cons of Fenwick tree

- **Only invertible aggregates.** Sum, XOR, count, modular sum — yes. Min, max, gcd, bitwise OR — no. For min/max range queries, use segment tree or sparse table.
- **No lazy propagation in the classic form.** Range update + range query needs the two-BIT trick (which is elegant but feels like a hack).
- **1-indexed.** Easy to get wrong if you copy from a 0-indexed source.
- **Harder to extend to non-commutative operations.** Order-of-operations matters in some applications; segment tree handles this more naturally.
- **No order-statistic in O(log n) without binary lifting.** Two-pass `kth` is O(log² n); binary lifting on BIT gets you O(log n) but is trickier to code.

### When to use which

| Need | Use |
|---|---|
| Point update + prefix/range sum | Fenwick |
| Point update + prefix XOR / count | Fenwick |
| Range update + point query | Difference Fenwick |
| Range update + range sum | Two Fenwicks |
| Range update + range min/max | Segment tree with lazy propagation |
| Order statistic (kth smallest) on a stream | Fenwick + binary lifting |
| 2D point update + rectangle sum | 2D Fenwick |
| 2D range update + rectangle query | 4-BIT trick or segment tree on segment tree |
| Static range min/max | Sparse table |
| Range min/max with updates | Segment tree |

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

We use `A = [3, 2, -1, 6, 5, 4, -3, 3]` (1-indexed: `A[1..8]`). Goal: build the BIT, query `prefix(5)`, update `A[4] += 2`, re-query `prefix(5)`.

### 8.1 Build (naive: call `update` for each element)

```
BIT initialized to [0,0,0,0,0,0,0,0,0] (size 9, ignore BIT[0])
update(1, 3): BIT[1]+=3, BIT[2]+=3, BIT[4]+=3, BIT[8]+=3
update(2, 2): BIT[2]+=2, BIT[4]+=2, BIT[8]+=2
update(3,-1): BIT[3]-=1, BIT[4]-=1, BIT[8]-=1
update(4, 6): BIT[4]+=6, BIT[8]+=6
update(5, 5): BIT[5]+=5, BIT[6]+=5, BIT[8]+=5
update(6, 4): BIT[6]+=4, BIT[8]+=4
update(7,-3): BIT[7]-=3, BIT[8]-=3
update(8, 3): BIT[8]+=3
```

Final BIT:

```
i:     1  2  3  4   5  6  7  8
BIT:   3  5 -1 10   5  9 -3 19
```

Verify: `BIT[8]` should equal A[1]+...+A[8] = 3+2-1+6+5+4-3+3 = 19. ✓

### 8.2 Query `prefix(5)`

We want A[1]+A[2]+A[3]+A[4]+A[5] = 3+2-1+6+5 = 15.

```
i=5 (101): add BIT[5]=5, i -= lowbit(5)=1, so i=4
i=4 (100): add BIT[4]=10, i -= lowbit(4)=4, so i=0
done. sum = 5 + 10 = 15  ✓
```

### 8.3 Update `A[4] += 2`

```
i=4 (100): BIT[4] += 2 → BIT[4] = 12, i += lowbit(4)=4, so i=8
i=8 (1000): BIT[8] += 2 → BIT[8] = 21, i += lowbit(8)=8, so i=16
16 > n=8, stop
```

New BIT: `[3, 5, -1, 12, 5, 9, -3, 21]`.

### 8.4 Re-query `prefix(5)`

```
i=5: add BIT[5]=5, i=4
i=4: add BIT[4]=12, i=0
done. sum = 5 + 12 = 17  ✓
```

Expected: `A[1..5]` was 15, plus 2 = 17. The update propagated correctly. Total work: 2 BIT cells touched for the update, 2 cells touched for the query. On a million-element array the math is identical, capped at 20 cells each.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Basic Fenwick tree

**Go:**
```go
package fenwick

// Fenwick is a 1-indexed Binary Indexed Tree supporting point updates and
// prefix-sum queries in O(log n). Indexing convention: 1..n.
type Fenwick struct {
    n    int
    tree []int64
}

func New(n int) *Fenwick {
    return &Fenwick{n: n, tree: make([]int64, n+1)}
}

// Update adds delta to position i (1-indexed). O(log n).
func (f *Fenwick) Update(i int, delta int64) {
    for ; i <= f.n; i += i & -i {
        f.tree[i] += delta
    }
}

// Prefix returns A[1] + A[2] + ... + A[i] (1-indexed). O(log n).
func (f *Fenwick) Prefix(i int) int64 {
    var s int64
    for ; i > 0; i -= i & -i {
        s += f.tree[i]
    }
    return s
}

// RangeSum returns A[l] + A[l+1] + ... + A[r]. O(log n).
func (f *Fenwick) RangeSum(l, r int) int64 {
    return f.Prefix(r) - f.Prefix(l-1)
}
```

**Java:**
```java
public final class Fenwick {
    private final int n;
    private final long[] tree;

    public Fenwick(int n) {
        this.n = n;
        this.tree = new long[n + 1];   // 1-indexed; index 0 unused
    }

    /** Add delta to position i (1-indexed). O(log n). */
    public void update(int i, long delta) {
        for (; i <= n; i += i & -i) {
            tree[i] += delta;
        }
    }

    /** Sum of A[1..i] (1-indexed). O(log n). */
    public long prefix(int i) {
        long s = 0;
        for (; i > 0; i -= i & -i) {
            s += tree[i];
        }
        return s;
    }

    /** Sum of A[l..r] (1-indexed, inclusive). O(log n). */
    public long rangeSum(int l, int r) {
        return prefix(r) - prefix(l - 1);
    }
}
```

**Python:**
```python
class Fenwick:
    """1-indexed Binary Indexed Tree. Point update + prefix sum in O(log n)."""

    def __init__(self, n: int) -> None:
        self.n = n
        self.tree = [0] * (n + 1)     # index 0 unused

    def update(self, i: int, delta: int) -> None:
        """Add delta at position i (1-indexed)."""
        while i <= self.n:
            self.tree[i] += delta
            i += i & -i

    def prefix(self, i: int) -> int:
        """Sum of A[1..i]."""
        s = 0
        while i > 0:
            s += self.tree[i]
            i -= i & -i
        return s

    def range_sum(self, l: int, r: int) -> int:
        return self.prefix(r) - self.prefix(l - 1)
```

### 9.2 O(n) build by absorbing children

The naive build calls `update` n times, costing O(n log n). The optimal build runs in O(n) by copying the array into the BIT and then **absorbing each cell into its parent**.

**Go:**
```go
// Build constructs a Fenwick tree from a 1-indexed slice in O(n).
// The slice must have length n+1 with index 0 unused; arr[1..n] holds the values.
func Build(arr []int64) *Fenwick {
    n := len(arr) - 1
    tree := make([]int64, n+1)
    copy(tree, arr)
    for i := 1; i <= n; i++ {
        parent := i + (i & -i)
        if parent <= n {
            tree[parent] += tree[i]
        }
    }
    return &Fenwick{n: n, tree: tree}
}
```

**Java:**
```java
public static Fenwick build(long[] arr) {     // arr is 1-indexed, length n+1
    int n = arr.length - 1;
    Fenwick f = new Fenwick(n);
    System.arraycopy(arr, 0, f.tree, 0, n + 1);
    for (int i = 1; i <= n; i++) {
        int parent = i + (i & -i);
        if (parent <= n) f.tree[parent] += f.tree[i];
    }
    return f;
}
```

**Python:**
```python
@classmethod
def build(cls, arr: list[int]) -> "Fenwick":
    """arr is 1-indexed: arr[0] is unused, arr[1..n] are values."""
    n = len(arr) - 1
    f = cls(n)
    f.tree = arr[:]
    for i in range(1, n + 1):
        parent = i + (i & -i)
        if parent <= n:
            f.tree[parent] += f.tree[i]
    return f
```

**Why it works.** When you process `i` from left to right, `tree[i]` currently holds `A[i]`. Its parent `tree[i + lowbit(i)]` is supposed to hold the sum of its responsibility range, which includes `tree[i]`'s responsibility range. By the time we reach `i`, `tree[i]` has already absorbed the contributions of all smaller children in its responsibility range. Adding `tree[i]` to the parent passes that accumulated sum upward in O(1). One sweep is O(n).

### 9.3 Using a 0-indexed external interface

Most callers prefer 0-indexed arrays. Wrap the 1-indexed core:

**Go:**
```go
func (f *Fenwick) Update0(i int, delta int64) { f.Update(i+1, delta) }
func (f *Fenwick) Prefix0(i int) int64        { return f.Prefix(i + 1) }
func (f *Fenwick) RangeSum0(l, r int) int64   { return f.RangeSum(l+1, r+1) }
```

**Python:**
```python
def update0(self, i, delta): self.update(i + 1, delta)
def prefix0(self, i):       return self.prefix(i + 1)
```

The 1-indexed core stays clean; the conversion is an external concern.

---

<a name="patterns"></a>
## 10. Coding Patterns — 1-Indexed Convention

Every BIT in this document and in nearly every paper, textbook, and library is **1-indexed**. The reason is mechanical: the update loop `while i <= n: i += i & -i` cannot start at `i = 0` because `lowbit(0) == 0`, so `i` never changes and the loop spins forever. The query loop `while i > 0: i -= i & -i` cannot terminate if we allow `i = 0` as a legal index either.

The fix is to shift every external index by +1 when entering the BIT and shift back by –1 when leaving. Allocate `tree` of size `n + 1` and ignore `tree[0]`. If you embed a BIT in a larger system, document the indexing convention loudly. The single biggest source of BIT bugs is forgetting the shift.

The standard 6-line idioms:

```
update:  while i <= n: BIT[i] += d; i += i & -i
prefix:  while i >  0: s += BIT[i]; i -= i & -i
```

Once you know these two lines, you know the BIT. Everything else — 2D, range update, kth smallest — is a composition of these primitives.

---

<a name="errors"></a>
## 11. Error Handling — Off-by-One and Index 0

### 11.1 The index-0 infinite loop

```
def update_bad(self, i, delta):
    while i <= self.n:
        self.tree[i] += delta
        i += i & -i           # if i == 0, lowbit = 0, loop spins forever
```

Calling `update_bad(0, 5)` hangs the program. Solution: shift the external index by +1, or assert `i >= 1`.

### 11.2 Off-by-one on bounds

`prefix(0)` should return 0 (empty prefix). The query loop terminates immediately when `i == 0`, so it does return 0. But beware: in some translations of BIT, you'll see `prefix(i)` meaning "sum of first `i` elements (i.e., A[0..i-1])" instead of "sum of A[1..i]". Pick one convention per file and stay with it.

### 11.3 Allocating too small

`tree` must be size `n + 1`, not `n`. A common bug is `tree = make([]int64, n)`, which makes `tree[n]` out-of-bounds. The update loop hits `i == n` when updating index n, and crashes.

### 11.4 Integer overflow

If individual values are within `int32` but their cumulative sum exceeds `2^31 - 1`, the BIT will silently overflow. Use `int64` (Go), `long` (Java), or Python int. For n = 10⁵ values up to 10⁹, the prefix sum can reach 10¹⁴ — way beyond int32.

### 11.5 Wrong direction of `lowbit` step

A classic bug is writing the update loop as `i -= i & -i` (a "query" step) instead of `i += i & -i`. The compiler accepts it; the BIT silently returns wrong sums. Tests with a single update + single query usually catch it.

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **BIT beats segment tree in cache locality.** A BIT of size `n+1` fits in cache the same way the input does. A segment tree of size `4n` may push the original array out.

2. **Few branches.** The inner loop has one comparison and one arithmetic op. Modern CPUs pipeline this beautifully.

3. **Don't use a class with virtual methods.** In Java, mark the BIT class `final`. In C++, avoid virtual calls inside the hot loop.

4. **Inline the loop body.** For the hottest paths, write the six lines inline instead of calling `update`/`prefix`.

5. **Prefer O(n) build over n calls to update.** Saves a factor of `log n`. Important when `n = 10^6` and build happens many times.

6. **Use a `long`/`int64` BIT for safety.** The cost is one extra cache line per N values; the protection from overflow is worth it.

7. **For very small `n` (under ~32)**, just use a plain prefix-sum array and O(n) recomputation on each update. BIT's setup overhead dominates.

8. **In tight loops, use unsigned arithmetic if you can.** `i & -i` works on unsigned types too in Go via `int(uint(i) & uint(-i))`, but the signed form is fine on all modern hardware.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Always 1-indexed.** Document it in the class header.
- **Allocate `n + 1` cells.** Forgetting this is the most common BIT bug after off-by-one.
- **Wrap the 1-indexed core with a 0-indexed external interface** if callers expect 0-indexed input.
- **Use `int64` / `long`** unless you have *proven* the values fit in 32 bits.
- **Build in O(n) when you have a known initial array.** Don't call `update` n times unless you must.
- **Don't try to extend BIT to min/max.** Use a segment tree instead.
- **Unit-test against a brute-force O(n²) reference.** Generate random updates and queries; compare BIT output to a recomputed prefix-sum array.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Behavior |
|---|---|
| `prefix(0)` | Returns 0 (empty prefix). Loop exits immediately. |
| `update(i, 0)` | No-op effectively, but still touches O(log n) cells. Caller should skip 0 deltas if hot. |
| `rangeSum(l, l)` | Returns A[l]. Computes prefix(l) - prefix(l-1). |
| `rangeSum(l, r)` with `l > r` | Caller bug. Returns a misleading negative-ish value. Assert. |
| `update(n, delta)` | Touches only `BIT[n]` if n is a power of two; otherwise walks up to the next power-of-two ancestor. |
| `n = 0` | Empty BIT. Build returns the trivial structure. All queries return 0. |
| `n = 1` | Single cell. Update touches `BIT[1]` only. Prefix returns `BIT[1]`. |
| Negative deltas | Fully supported. Sum and XOR work for negative integers. |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Using 0-indexed input directly.** Causes infinite loop on `update(0, _)`. Shift by +1 or assert.
2. **Allocating `tree` of size `n` instead of `n + 1`.** Out-of-bounds on `update(n, _)`.
3. **Mixing up `+= lowbit` and `-= lowbit`.** Update walks up (+); query walks down (–).
4. **Using BIT for min/max.** Wrong answers because range query subtracts.
5. **Forgetting integer overflow.** Use 64-bit sums.
6. **Forgetting that `rangeSum(l, r) = prefix(r) - prefix(l-1)`**, not `prefix(r) - prefix(l)`. The latter excludes A[l].
7. **Calling the naive build n times** when O(n) build would do.
8. **Using a 0-indexed external interface but a 0-indexed internal BIT.** Causes silent wrong sums when the lowest bit shifts.
9. **Range-updating with a single point-update.** Range update requires either a difference BIT or the two-BIT trick (see `middle.md`).
10. **Querying inside the update loop.** Concurrency bug; the BIT is mid-update and inconsistent.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
ALLOCATE
    tree = array of size n+1, initialized to 0     # 1-indexed; ignore tree[0]

UPDATE(i, delta)         # 1 <= i <= n, O(log n)
    while i <= n:
        tree[i] += delta
        i += i & -i

PREFIX(i)                # 0 <= i <= n, O(log n)
    s = 0
    while i > 0:
        s += tree[i]
        i -= i & -i
    return s

RANGE_SUM(l, r)          # 1 <= l <= r <= n, O(log n)
    return prefix(r) - prefix(l - 1)

BUILD(arr[1..n])         # O(n) optimal
    tree = copy of arr (with tree[0] = 0)
    for i in 1..n:
        parent = i + (i & -i)
        if parent <= n:
            tree[parent] += tree[i]

COMPLEXITY
    update:  O(log n)
    prefix:  O(log n)
    range:   O(log n)
    space:   n + 1
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It renders the original 1-indexed array on top and the BIT cells `BIT[1..n]` on the bottom. For an `update(i, delta)` the animation highlights the propagation path `i, i + lowbit(i), i + lowbit(...) , ...` and shows the binary representation of each intermediate `i`. For a `prefix(i)` query it animates the descending path `i, i - lowbit(i), ...` and accumulates the running sum. A binary-representation tooltip displays `i` and `lowbit(i)` in bits, making the bit trick visible.

Walking the animation on `n = 16` and watching the responsibility ranges light up is the fastest way to internalize the structure.

---

<a name="summary"></a>
## 18. Summary

- A Fenwick tree (BIT) supports point update and prefix-sum query in O(log n) each on a single 1-indexed array of size `n+1`.
- The structure is implicit: `BIT[i]` stores the sum of the responsibility range `[i - lowbit(i) + 1, i]`, where `lowbit(i) = i & -i`.
- Update walks up: `i += i & -i`. Prefix walks down: `i -= i & -i`. Both terminate in O(log n) steps.
- Range sum is `prefix(r) - prefix(l - 1)`, valid only for invertible aggregates (sum, XOR, count). For min/max, use a segment tree.
- 1-indexed is non-negotiable because `lowbit(0) = 0` causes infinite loops. Shift external 0-indexed callers by +1.
- BIT uses roughly **half** the memory and **one-third** the code of a segment tree solving the same problem, and runs 2–3× faster in practice on the invertible-aggregate workload.
- Standard extensions in `middle.md`: range-update + point-query (difference BIT), range-update + range-query (two BITs), 2D BIT, inversion count, order-statistic BIT.

The BIT is one of those rare data structures that, once you have written it twice, becomes a default reach for any "prefix sum with updates" problem. Memorize the six-line update and six-line query.

---

<a name="further-reading"></a>
## 19. Further Reading

- **Fenwick, P. M.** (1994). *A New Data Structure for Cumulative Frequency Tables.* Software — Practice and Experience, 24(3), 327–336. The original paper. Short, readable, and worth reading once for the historical perspective.
- **CP-Algorithms** (cp-algorithms.com) — *Fenwick Tree* article. The clearest free reference, with all the standard variants and proofs.
- **Halim & Halim**, *Competitive Programming 4*, Section 2.4.4. Covers BIT alongside segment tree with side-by-side benchmarks.
- **Sedgewick & Wayne**, *Algorithms*, 4th ed. — covers prefix sums and range-update tricks though not Fenwick trees by name.
- **Codeforces EDU** — "Binary Indexed Tree" track. Hands-on exercises that gradually build to range update + range query and 2D variants.
- **LeetCode** — 307, 308, 315, 327, 493, 1395, 1409, 1505. Build the muscle memory.
- **TopCoder tutorial** — "Binary Indexed Trees" by Boris (now hard to find in original form, but mirrored widely). One of the most-cited intro tutorials.
- Continue with `middle.md` for range update, range query, 2D BIT, inversion count, order-statistic, and benchmarks vs segment tree.
