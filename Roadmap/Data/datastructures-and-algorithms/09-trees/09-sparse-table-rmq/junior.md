# Sparse Table & Range Minimum Query — Junior Level

> **Read time: ~35 minutes** · **Audience:** Engineers comfortable with arrays, loops, and basic logarithms who want the standard answer to "static range minimum query (RMQ)".

The **Range Minimum Query (RMQ)** problem asks: given a fixed array of `n` numbers, answer many queries of the form *"what is the minimum in `arr[l..r]`?"*. A segment tree solves this in **O(log n) per query** after **O(n) preprocessing**. A **Sparse Table** does better when the array is **static** (no updates): **O(1) per query** after **O(n log n) preprocessing**. There is no faster way to answer RMQ in the comparison model — sparse table is, in practice, the answer used by every competitive programmer for static RMQ.

The catch is that sparse table only works if the combining operation is **idempotent** — `op(x, x) = x` so overlapping windows don't double-count. Min, max, gcd, bitwise AND, bitwise OR all qualify. Sum, xor, product do **not** — for those, use a Fenwick tree or segment tree (or the disjoint sparse table covered in `middle.md`).

This document teaches you the data structure end-to-end: the doubling-table idea, how two overlapping power-of-two windows cover any range in O(1), how to precompute a log table for the answer-extraction step, and the three implementations (Go, Java, Python) you can paste into a contest at 3 a.m.

---

## Table of Contents

1. [Introduction — Static RMQ in O(1)](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Doubling Table + Two-Window Trick](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons vs Segment Tree](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns](#patterns)
11. [Error Handling](#errors)
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
## 1. Introduction — Static RMQ in O(1)

You are given an array of one million sensor readings recorded once and never modified. Throughout the day, your service receives ten million queries of the form *"what is the smallest reading between minute `l` and minute `r`?"*. A naive loop over `[l..r]` per query is O(n·q) = 10¹³ operations — far too slow. A segment tree drops this to O(q log n) ≈ 2·10⁸ — fast, but every query still touches log n nodes.

**Sparse Table** answers the same query in **two array lookups**, regardless of `n` — total 2·10⁷ memory accesses for the same workload, ~10× faster than the segment tree. The price is O(n log n) memory and a one-time O(n log n) preprocessing. Since the array never changes, you pay this cost once.

The data structure was popularized by **Bender and Farach-Colton (2000)** in *"The LCA Problem Revisited"*, where they showed how RMQ and Lowest Common Ancestor (LCA) on trees reduce to each other. The sparse-table technique itself is older — it is the standard "doubling table" idea (precompute answers for windows of length `2^k`) that appears in dozens of contexts in computer science.

### When sparse table applies

Sparse table answers `op(arr[l], arr[l+1], ..., arr[r])` in O(1) **if and only if** `op` is **idempotent**, meaning `op(x, x) = x`:

| Operation | Idempotent? | Use sparse table? |
|---|---|---|
| min        | yes   | yes |
| max        | yes   | yes |
| gcd        | yes (`gcd(x,x)=x`) | yes |
| bitwise AND | yes (`x AND x = x`) | yes |
| bitwise OR  | yes (`x OR x = x`)  | yes |
| sum         | **no** (`x + x ≠ x` in general) | no — use Fenwick / segment tree / disjoint sparse table |
| xor         | **no** (`x XOR x = 0`) | no |
| product     | **no** | no |

The idempotence requirement is what allows two **overlapping** windows of length `2^k` to combine into the answer without double-counting. We will see why in section 4.

### When NOT to use sparse table

- The array changes (updates). Sparse table is fully static — any change costs O(n log n) to rebuild. Use a segment tree.
- The operation is not idempotent (sum, xor, product, count). Use Fenwick / segment tree.
- Memory is tight: O(n log n) cells. For `n = 10⁶`, that is ~20 million 8-byte ints = 160 MB. Segment tree uses ~16 MB.

---

<a name="prerequisites"></a>
## 2. Prerequisites

Before sparse table makes sense, you should know:

1. **Arrays and indexing.** Random-access reads in O(1).
2. **Powers of two and bit shifts.** `1 << k` means `2^k`. `x >> 1` means `x / 2`.
3. **Floor of base-2 logarithm.** `floor(log2(x))` is the largest `k` such that `2^k <= x`. For `x = 10`, `floor(log2(10)) = 3` because `2^3 = 8 <= 10 < 16 = 2^4`.
4. **What "static" means.** The input array is set once and never modified after preprocessing finishes. If your code ever does `arr[i] = ...` after the build phase, sparse table is the wrong tool.
5. **What "min query" means.** `query(l, r)` returns the minimum of `arr[l], arr[l+1], ..., arr[r]` inclusive. Conventions vary — some libraries use half-open `[l, r)`. Pick one and document it.

If you don't yet know segment trees, that is fine — sparse table is conceptually simpler and is a great gateway into "range data structures". Once you know both, you will reach for sparse table whenever updates aren't needed.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **RMQ** | Range Minimum Query — given `(l, r)`, return `min(arr[l..r])`. By symmetry "range max" is the same problem with `<` reversed. |
| **Static array** | An array that is built once and never modified afterward. |
| **Idempotent operation** | A binary operation `op` where `op(x, x) = x`. Allows overlapping windows to combine without double-counting. |
| **Sparse table** | A 2D array `st[k][i]` storing the answer for the window starting at index `i` with length `2^k`. |
| **Doubling table** | Synonym for sparse table — each row doubles the window size of the previous row. |
| **k-th column** (sloppy) / **k-th row** (precise) | Row `k` of the sparse table holds answers over windows of length `2^k`. We use "row k" throughout. |
| **Log table** | A precomputed array `log[i]` storing `floor(log2(i))` for fast O(1) lookup during queries. |
| **Two-window trick** | The query algorithm: cover `[l, r]` by two overlapping windows of length `2^k` where `k = floor(log2(r-l+1))`. |
| **Preprocessing** | The O(n log n) build phase that fills the sparse table from the input array. |
| **LCA** | Lowest Common Ancestor — the deepest node that is an ancestor of two given nodes in a tree. Equivalent to RMQ on a specific array; see `middle.md`. |
| **Cartesian tree** | A binary tree built from an array where the root is the index of the minimum, recursively. RMQ on the array equals LCA on the Cartesian tree. See `middle.md`. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Doubling Table + Two-Window Trick

### 4.1 The table `st[k][i]`

Define a 2D table:

```
st[k][i] = min(arr[i], arr[i+1], ..., arr[i + 2^k - 1])
```

Row `k = 0`: window length `2^0 = 1`. So `st[0][i] = arr[i]` for every `i`.
Row `k = 1`: window length `2^1 = 2`. So `st[1][i] = min(arr[i], arr[i+1])`.
Row `k = 2`: window length `2^2 = 4`. So `st[2][i] = min(arr[i], arr[i+1], arr[i+2], arr[i+3])`.
Row `k = K`: window length `2^K = n`. The single cell `st[K][0]` is the min of the whole array.

The table has `K + 1 = floor(log2(n)) + 1` rows. Each row has up to `n` columns, but only the first `n - 2^k + 1` columns are valid (a window of length `2^k` starting at `i` needs `i + 2^k - 1 < n`). Total cells: roughly `n · log n`.

### 4.2 Building the table — overlapping halves

Row 0 is just a copy of the input. For `k >= 1`, we compute each cell from two cells of the previous row:

```
st[k][i] = min(st[k-1][i], st[k-1][i + 2^(k-1)])
```

**Why this works.** A window of length `2^k` starting at `i` is the union of two windows of length `2^(k-1)`:

```
[ i .................. i + 2^k - 1 ]
=
[ i .. i + 2^(k-1) - 1 ]  ∪  [ i + 2^(k-1) .. i + 2^k - 1 ]
```

These two halves are disjoint and exactly cover the full window. The min of the full window is the min of the two halves. Constant work per cell, `O(n log n)` cells total → **O(n log n) preprocessing**.

### 4.3 Querying `query(l, r)` — two overlapping windows

Here is the cleverness. Given query range `[l, r]` of length `L = r - l + 1`, find:

```
k = floor(log2(L))
```

This `k` is the largest integer with `2^k <= L`. Now consider **two** overlapping windows of length `2^k`:

```
window A:  [l        ..  l + 2^k - 1]
window B:  [r - 2^k + 1 ..  r       ]
```

These two windows **together cover all of `[l, r]`**:
- Window A covers from `l` up to `l + 2^k - 1`.
- Window B covers from `r - 2^k + 1` up to `r`.
- Since `2 · 2^k >= L`, the two windows together span at least `L` positions, so they cover `[l, r]`.
- They may **overlap** in the middle — that is fine, because **min is idempotent**: `min(min(A), min(B)) = min(A ∪ B)`. Counting the overlap twice doesn't change the answer.

Therefore:

```
query(l, r) = min(st[k][l], st[k][r - 2^k + 1])
```

Two array lookups, one `min`. **O(1) per query.**

### 4.4 Why we need idempotence

If we tried this with `sum` instead of `min`, the overlapping region would be counted twice. `sum(A) + sum(B) ≠ sum(A ∪ B)` when A and B overlap. That is why sum needs either a prefix-sum array (O(n) build, O(1) query) or a disjoint sparse table (different design, see `middle.md`).

`gcd(x, x) = x` — idempotent. `gcd(A) and gcd(B)` cover the union exactly even when overlapping. Same for `min`, `max`, `bitwise AND`, `bitwise OR`.

### 4.5 The log table

In the query we need `k = floor(log2(L))`. Computing `log2` via `math.log` involves floating-point arithmetic and can be wrong at boundary values due to rounding (`log2(8)` might compute as `2.9999999...` whose floor is 2, not 3). Two safe alternatives:

**Option A — Precompute a log table:**

```
log[1] = 0
for i = 2..n: log[i] = log[i/2] + 1
```

After this, `log[L]` is `floor(log2(L))` exactly. O(1) query, O(n) extra memory, no floating point.

**Option B — Use the hardware bit-count intrinsic.** `floor(log2(x))` equals `63 - count_leading_zeros(x)` for a 64-bit value. Go: `bits.Len(x) - 1`. Java: `31 - Integer.numberOfLeadingZeros(x)`. C/C++: `__builtin_clz(x) ^ 31`. One CPU instruction. We cover this in `professional.md`.

For pedagogical clarity, we use the log table in this document.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Aspect | Complexity |
|---|---|
| **Preprocessing time** | O(n log n) |
| **Preprocessing space** | O(n log n) |
| **Query time** | O(1) — two table lookups |
| **Update time** | not supported (static) — O(n log n) rebuild |
| **Operation requirement** | idempotent (`op(x, x) = x`) |

For `n = 10⁶`: ~20 million table cells, ~20 million build operations, ~160 MB if 8-byte ints. Each query: 2 memory reads.

Compared to a segment tree on the same data: segment tree builds in O(n) and queries in O(log n) ≈ 20 reads per query. For ten million queries, sparse table executes 2·10⁷ reads vs segment tree 2·10⁸ — a 10× speedup, at the cost of 10× more memory.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 The lookup table in code golf

When solving puzzles by hand you sometimes precompute every interesting answer into a printed cheat sheet, then read off answers in O(1). Sparse table is the algorithmic version: precompute the min of every power-of-two window, then read off any range query as the min of two precomputed windows.

### 6.2 The road-trip distance chart

Old paper maps had a triangular distance table: enter "city A" on the row and "city B" on the column and read the distance directly. The table cost work to build, but each lookup was instant. Sparse table is the same: trade O(n log n) build for O(1) per query.

### 6.3 Tournament brackets

A single-elimination tournament for `n = 2^k` players has `k` rounds. After round `r`, you know the winner of every group of size `2^r`. Sparse table is the "every starting position" version: row `r` of the table is the winner (minimum) of every contiguous group of size `2^r`, including overlapping groups.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons vs Segment Tree

### Pros
- **O(1) query** — the fastest possible RMQ in the comparison model.
- **Constant factor is tiny.** Two array reads plus one `min`. No recursion, no pointer chasing.
- **Cache-friendly queries.** Both reads come from the same row of the table — same cache line for small `k`.
- **Simple implementation.** ~25 lines of code. Easy to write correctly under time pressure.
- **Easy to extend** to max, gcd, AND, OR by swapping the combine function.

### Cons
- **O(n log n) memory.** For `n = 10⁶` and 8-byte ints, ~160 MB. Segment tree: ~16 MB.
- **No updates.** Any modification to the array invalidates the entire table; O(n log n) rebuild.
- **Only idempotent operations.** Sum, xor, product, count require a different structure.
- **Build is slower than segment tree** — O(n log n) vs O(n).
- **Cold cache on large `n`.** For `n = 10⁸`, the table is gigabytes and queries miss L3.

**Decision rule:** Static input, idempotent op, query-dominant workload → sparse table. Updates or non-idempotent op → segment tree / Fenwick.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

Array: `[3, 1, 4, 1, 5, 9, 2, 6]`, `n = 8`. We compute the sparse table for min.

**Row 0** (windows of length 1) — copy of input:

| i | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| st[0][i] | 3 | 1 | 4 | 1 | 5 | 9 | 2 | 6 |

**Row 1** (windows of length 2) — `st[1][i] = min(st[0][i], st[0][i+1])`:

| i | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| st[1][i] | min(3,1)=1 | min(1,4)=1 | min(4,1)=1 | min(1,5)=1 | min(5,9)=5 | min(9,2)=2 | min(2,6)=2 |

**Row 2** (windows of length 4) — `st[2][i] = min(st[1][i], st[1][i+2])`:

| i | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| st[2][i] | min(1,1)=1 | min(1,1)=1 | min(1,5)=1 | min(1,2)=1 | min(5,2)=2 |

**Row 3** (windows of length 8) — `st[3][i] = min(st[2][i], st[2][i+4])`:

| i | 0 |
|---|---|
| st[3][i] | min(1,2)=1 |

The whole-array min is 1. Correct.

### Query: `min(arr[2..6])`

Range `[2, 6]`, length `L = 6 - 2 + 1 = 5`. `k = floor(log2(5)) = 2`. Two windows of length `2^2 = 4`:

- Window A: starting at `l = 2`, covers indices `[2, 3, 4, 5]`. Answer: `st[2][2] = 1`.
- Window B: starting at `r - 2^k + 1 = 6 - 4 + 1 = 3`, covers `[3, 4, 5, 6]`. Answer: `st[2][3] = 1`.

`min(1, 1) = 1`. Verify by direct min: `min(4, 1, 5, 9, 2) = 1`. Correct.

Notice that windows A and B overlap on indices `[3, 4, 5]` — but because `min` is idempotent, the overlap doesn't matter.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Go

```go
package sparsetable

import "math/bits"

// SparseTable answers range-min queries on a static integer slice in O(1).
type SparseTable struct {
    st  [][]int
    log []int
}

// Build precomputes the table from arr. O(n log n) time and space.
func Build(arr []int) *SparseTable {
    n := len(arr)
    if n == 0 {
        return &SparseTable{}
    }
    // Precomputed log table: log[i] = floor(log2(i)) for i >= 1.
    logT := make([]int, n+1)
    for i := 2; i <= n; i++ {
        logT[i] = logT[i/2] + 1
    }
    K := logT[n] + 1
    st := make([][]int, K)
    st[0] = append(st[0], arr...) // row 0 is a copy of arr
    for k := 1; k < K; k++ {
        length := 1 << k
        st[k] = make([]int, n-length+1)
        half := 1 << (k - 1)
        for i := 0; i+length-1 < n; i++ {
            st[k][i] = min(st[k-1][i], st[k-1][i+half])
        }
    }
    return &SparseTable{st: st, log: logT}
}

// Query returns min(arr[l..r]) inclusive. Caller must ensure 0 <= l <= r < n.
func (s *SparseTable) Query(l, r int) int {
    k := s.log[r-l+1]
    return min(s.st[k][l], s.st[k][r-(1<<k)+1])
}

func min(a, b int) int {
    if a < b {
        return a
    }
    return b
}

// Alternative: use bits.Len for O(1) log without a precomputed table.
func log2Floor(x int) int { return bits.Len(uint(x)) - 1 }
```

### 9.2 Java

```java
public final class SparseTable {
    private final int[][] st;
    private final int[] log;
    private final int n;

    public SparseTable(int[] arr) {
        this.n = arr.length;
        this.log = new int[n + 1];
        for (int i = 2; i <= n; i++) log[i] = log[i / 2] + 1;
        int K = (n == 0) ? 1 : log[n] + 1;
        this.st = new int[K][];
        st[0] = arr.clone();
        for (int k = 1; k < K; k++) {
            int length = 1 << k;
            int rowLen = n - length + 1;
            if (rowLen <= 0) break;
            st[k] = new int[rowLen];
            int half = 1 << (k - 1);
            for (int i = 0; i < rowLen; i++) {
                st[k][i] = Math.min(st[k - 1][i], st[k - 1][i + half]);
            }
        }
    }

    /** Returns min(arr[l..r]) inclusive. Requires 0 <= l <= r < n. */
    public int query(int l, int r) {
        int k = log[r - l + 1];
        return Math.min(st[k][l], st[k][r - (1 << k) + 1]);
    }
}
```

### 9.3 Python

```python
class SparseTable:
    """Range-min sparse table over a static list of ints. O(1) query."""

    def __init__(self, arr):
        self.n = len(arr)
        self.log = [0] * (self.n + 1)
        for i in range(2, self.n + 1):
            self.log[i] = self.log[i // 2] + 1
        K = self.log[self.n] + 1 if self.n else 1
        self.st = [arr[:]]  # row 0
        for k in range(1, K):
            length = 1 << k
            half = 1 << (k - 1)
            row_len = self.n - length + 1
            if row_len <= 0:
                break
            prev = self.st[k - 1]
            self.st.append([min(prev[i], prev[i + half]) for i in range(row_len)])

    def query(self, l, r):
        """Returns min(arr[l..r]) inclusive."""
        k = self.log[r - l + 1]
        return min(self.st[k][l], self.st[k][r - (1 << k) + 1])
```

### 9.4 Quick sanity test

```python
arr = [3, 1, 4, 1, 5, 9, 2, 6]
st = SparseTable(arr)
assert st.query(0, 7) == 1
assert st.query(2, 6) == 1
assert st.query(4, 5) == 5
assert st.query(6, 7) == 2
assert st.query(0, 0) == 3
```

---

<a name="patterns"></a>
## 10. Coding Patterns

### 10.1 Generic combiner

Swap `min` for any idempotent op to get range-max, range-gcd, range-AND, range-OR. The structure is identical:

```python
class SparseTableOp:
    def __init__(self, arr, op):
        self.op = op
        self.n = len(arr)
        self.log = [0] * (self.n + 1)
        for i in range(2, self.n + 1):
            self.log[i] = self.log[i // 2] + 1
        K = self.log[self.n] + 1 if self.n else 1
        self.st = [arr[:]]
        for k in range(1, K):
            half = 1 << (k - 1)
            row_len = self.n - (1 << k) + 1
            if row_len <= 0: break
            prev = self.st[k - 1]
            self.st.append([op(prev[i], prev[i + half]) for i in range(row_len)])

    def query(self, l, r):
        k = self.log[r - l + 1]
        return self.op(self.st[k][l], self.st[k][r - (1 << k) + 1])

# Range max:
import operator
st_max = SparseTableOp(arr, max)
# Range gcd:
from math import gcd
st_gcd = SparseTableOp(arr, gcd)
# Range bitwise AND:
st_and = SparseTableOp(arr, operator.and_)
```

### 10.2 "Min of every length-k window" (LeetCode 239 style)

For a fixed window length `k`, the answers over a sliding window are just `st.query(i, i + k - 1)` for `i = 0..n-k`. With sparse table this is O(n) total — same as the monotonic-deque approach but simpler to write.

### 10.3 "Index of min" instead of value

If you need the **index** of the min (not just the value), store indices in the table and define `op(i, j) = i if arr[i] <= arr[j] else j`. The query returns an index.

---

<a name="errors"></a>
## 11. Error Handling

| Case | Behavior | Mitigation |
|---|---|---|
| Empty array | `query` on empty undefined | Check `n > 0` before any query |
| `log[0]` accessed | `floor(log2(0))` undefined | Never query with `l > r`; assert `l <= r` |
| `r < l` | Underflow on `r - l + 1` | Validate caller input |
| Index out of bounds | `arr[r]` when `r >= n` | Validate `0 <= l <= r < n` |
| Wrong operation | sum / xor returns wrong answer silently | Document that `op` must satisfy `op(x, x) = x` |

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Precompute the log table.** Avoid floating-point `log2` in the hot path; it is slow and can return the wrong floor at boundary values.
2. **Use a flat 1-D backing array** for the sparse table — `st[k*n + i]` — to improve cache locality vs a slice-of-slices.
3. **Branchless min**: `b ^ ((a ^ b) & -(a < b))` is sometimes faster than `if a < b`, though modern compilers usually emit `cmov` automatically.
4. **For huge `n`** (`> 10⁸`), use **block decomposition** or the Fischer-Heun O(n)-space variant covered in `middle.md`.
5. **Allocate the table contiguously** rather than row-by-row to reduce TLB misses.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Document the inclusive/exclusive convention.** Mixing `[l, r]` (inclusive) and `[l, r)` (half-open) is the #1 bug.
- **Assert idempotence in tests.** A random test: query a range, compare to brute force. If you accidentally pass `sum` to a min-style sparse table, this catches it immediately.
- **Build once, query many.** If your code rebuilds the table on every query, you have lost the point. Build at startup.
- **Don't store the table inside hot data structures** unless you query it. The memory cost is real.
- **Prefer sparse table for offline / batch workloads**, segment tree for online / mutable workloads.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Input | Expected |
|---|---|---|
| Single element | `[7]`, query `(0, 0)` | `7` |
| Full range | `[3,1,4]`, query `(0, 2)` | `1` |
| `l == r` | `[3,1,4]`, query `(2, 2)` | `4` |
| Length exact power of 2 | `[1,2,3,4]`, query `(0, 3)` | `1` (k=2, one window covers everything) |
| Length one less than power of 2 | `[5,4,3]`, query `(0, 2)` | `3` (k=1, two overlapping windows of length 2) |
| All equal | `[5,5,5,5]`, query `(1, 3)` | `5` |
| Negative numbers | `[-3,-1,-9]`, query `(0, 2)` | `-9` |
| Empty array | `[]` | Don't query; structure has no rows |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Confusing `2^k` with `2^k - 1`.** A window of length `2^k` starting at `i` covers `[i, i + 2^k - 1]`. Off-by-one here breaks everything.
2. **Using sum.** Sum is not idempotent. The two overlapping windows double-count. Use a prefix-sum array.
3. **Computing `log2` with floating point.** `math.log2(8)` may return `2.9999...`, floor gives 2 instead of 3. Use the precomputed log table or `bits.Len`.
4. **Mixing inclusive and half-open conventions** between build and query.
5. **Forgetting to clone the input for row 0.** If you store `arr` directly and the caller later mutates it, your "static" table silently goes stale.
6. **Allocating `st[k]` for all rows of length `n`** — wasteful. The valid columns shrink with `k`.
7. **Querying with `l > r`.** Either reject up front or return identity (`+∞` for min).
8. **Trying to support updates.** Don't. Use a segment tree.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
BUILD                                  O(n log n)
    K = floor(log2(n)) + 1
    st[0][i] = arr[i]
    for k in 1..K-1:
        for i in 0..n - 2^k:
            st[k][i] = min(st[k-1][i], st[k-1][i + 2^(k-1)])

LOG TABLE                              O(n)
    log[1] = 0
    for i in 2..n:
        log[i] = log[i/2] + 1

QUERY(l, r)                            O(1)
    k = log[r - l + 1]
    return min(st[k][l], st[k][r - 2^k + 1])

REQUIREMENTS
    op must satisfy op(x, x) = x  (idempotent)
    arr is STATIC — no updates after build
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It renders the input array as a horizontal row, then renders the sparse table as a 2-D grid below it: rows = `k` (window length `2^k`), columns = `i` (starting index). Each cell shows the min of its window. The "build" animation fills the table row by row, showing each cell being computed as the min of two cells in the row above. The "query" animation accepts an `(l, r)` pair, computes `k = floor(log2(r-l+1))`, and highlights the two overlapping cells `st[k][l]` and `st[k][r - 2^k + 1]` that combine to give the answer.

The visual makes the **two-window trick** click in a way that the algebra cannot.

---

<a name="summary"></a>
## 18. Summary

- **Sparse table** answers static RMQ in **O(1) per query** after **O(n log n) preprocessing**, provided the combining op is **idempotent** (min, max, gcd, AND, OR).
- The table `st[k][i]` stores the answer over the window starting at `i` of length `2^k`. Build with `st[k][i] = min(st[k-1][i], st[k-1][i + 2^(k-1)])`.
- A query on `[l, r]` is answered by **two overlapping windows of length `2^k`** where `k = floor(log2(r - l + 1))`: `min(st[k][l], st[k][r - 2^k + 1])`. Overlap is fine because idempotent ops don't double-count.
- Precompute a **log table** to avoid floating-point `log2` in the query path.
- Use sparse table when the array is static and queries dominate; use segment tree when updates are needed; use Fenwick tree for sum-style aggregates.
- Bender & Farach-Colton (2000) showed that RMQ and LCA are equivalent — sparse table is therefore at the heart of fast LCA algorithms, suffix-array LCE queries, and many string-processing libraries. `middle.md` covers the LCA reduction and the O(n) succinct variant by Fischer & Heun (2007).

---

<a name="further-reading"></a>
## 19. Further Reading

- **Bender, M. A. & Farach-Colton, M.** "The LCA Problem Revisited." *LATIN 2000*. The paper that made the sparse-table-for-RMQ approach standard and proved the RMQ ↔ LCA equivalence.
- **Fischer, J. & Heun, V.** "A New Succinct Representation of RMQ-Information and Improvements in the Enhanced Suffix Array." *ESCAPE 2007*. O(n)-space, O(1)-query RMQ — the modern theoretical optimum.
- **Gabow, H. N., Bentley, J. L. & Tarjan, R. E.** "Scaling and related techniques for geometry problems." *STOC 1984*. Early use of RMQ reductions.
- **CP-Algorithms** — *Sparse Table* (cp-algorithms.com/data_structures/sparse-table.html). The canonical online tutorial.
- **Laaksonen, A.** *Competitive Programmer's Handbook*, chapter on range queries. Free PDF, very approachable.
- **Sedgewick & Wayne** *Algorithms* — for the segment-tree comparison point.
- Continue with `middle.md` for the Cartesian-tree connection, the LCA reduction, and the O(n) Fischer-Heun variant.
