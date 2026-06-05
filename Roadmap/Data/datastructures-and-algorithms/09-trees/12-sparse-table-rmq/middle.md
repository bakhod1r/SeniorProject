# Sparse Table & RMQ — Middle Level

> **Audience:** Engineers comfortable with the basic sparse table who want the connections to Cartesian trees, LCA, and the modern O(n)-space algorithms used in real string-processing libraries. Prerequisite: `junior.md`.

This document covers the **theoretical scaffolding** around static RMQ: the Cartesian-tree bijection that makes RMQ on an array equivalent to LCA on a tree, the Euler-tour reduction from LCA back to a special ±1-RMQ, the **Fischer-Heun (2007)** O(n)-bit succinct structure that is the modern theoretical optimum, the **2D sparse table** for rectangle queries, the **disjoint sparse table** that supports non-idempotent operations like sum at O(1) query, and a clear-eyed comparison with segment tree, Fenwick tree, and √n-decomposition.

---

## Table of Contents

1. [Cartesian Trees and the RMQ ↔ LCA Bijection](#cartesian)
2. [LCA → ±1-RMQ via Euler Tour](#euler-tour)
3. [Fischer-Heun: O(n) Preprocessing, O(1) Query](#fischer-heun)
4. [2D Sparse Table](#2d)
5. [Disjoint Sparse Table — Non-Idempotent Ops in O(1)](#disjoint)
6. [Sparse Table vs Segment Tree vs Fenwick vs √n-Decomposition](#comparison)
7. [Why Sparse Table is THE Answer for Static RMQ in Competitive Programming](#why)

---

<a name="cartesian"></a>
## 1. Cartesian Trees and the RMQ ↔ LCA Bijection

### 1.1 Definition

A **Cartesian tree** of an array `arr` (assuming distinct values; ties broken by index) is a binary tree built as follows:

- The root is the position of the global minimum in `arr`.
- The left subtree is the Cartesian tree of `arr[0..min_pos - 1]`.
- The right subtree is the Cartesian tree of `arr[min_pos + 1..n - 1]`.

The construction is recursive but a **stack-based linear-time algorithm** exists, due to Gabow, Bentley, and Tarjan (1984). Walk left to right; maintain a stack of "right spine" nodes. For each new value, pop nodes greater than the current value, set the last-popped node as the left child of the current, push the current onto the stack as the right child of whatever remains on top.

```python
def cartesian_tree(arr):
    n = len(arr)
    parent = [-1] * n
    stack = []
    for i in range(n):
        last = -1
        while stack and arr[stack[-1]] > arr[i]:
            last = stack.pop()
        if last != -1:
            parent[last] = i
        if stack:
            parent[i] = stack[-1]
        stack.append(i)
    return parent  # parent[root] == -1
```

Time: each index pushed and popped at most once → O(n).

### 1.2 The RMQ ↔ LCA bijection

**Theorem (Gabow-Bentley-Tarjan 1984).** Let `T` be the Cartesian tree of `arr`. For any `l <= r`, the minimum of `arr[l..r]` is located at position `LCA_T(l, r)` — the lowest common ancestor of nodes `l` and `r` in `T`.

**Intuition.** The root of `T` is the index of the global min. Any range `[l, r]` either spans the root (in which case the root is the LCA and is the min — both true) or is entirely in the left or right subtree, in which case we recurse. The recursion tree of "find the min in `[l, r]`" mirrors the LCA computation on the Cartesian tree.

This means:

> Solving RMQ on `arr` is **exactly** solving LCA on the Cartesian tree of `arr`.

And conversely, given any tree `T`, we can build an array whose Cartesian tree has the same shape as `T` — so any LCA algorithm gives an RMQ algorithm and vice versa. **Bender & Farach-Colton (2000)** crystallized this two-way reduction in their paper "The LCA Problem Revisited", which is the foundation of every modern O(n)-O(1) RMQ algorithm.

### 1.3 Applications of the bijection

- A fast LCA algorithm immediately yields a fast RMQ algorithm (and vice versa). The progress on either translates to the other.
- The Cartesian tree itself is useful: histogram problems (largest rectangle), range k-th element via persistent structures, RMQ on a dynamic array via splay-tree-based Cartesian trees.
- The bijection is heavily used in **suffix-tree** and **suffix-array** implementations — the LCP array's RMQ gives substring LCE in O(1).

---

<a name="euler-tour"></a>
## 2. LCA → ±1-RMQ via Euler Tour

Given the bijection, we can reduce **general RMQ → LCA → special RMQ (±1-RMQ)**, where consecutive elements differ by exactly ±1. This special version admits O(n) preprocessing with O(1) query — the basis of the optimal algorithm.

### 2.1 The Euler tour

An **Euler tour** of a tree `T` is the sequence of nodes visited by a DFS, recording every entry and every return-up. For a tree with `n` nodes, the tour has `2n - 1` entries. Alongside, record the depth of each visited node:

```
nodes:  [a, b, d, b, e, b, a, c, f, c, a]
depths: [0, 1, 2, 1, 2, 1, 0, 1, 2, 1, 0]
```

Consecutive depths differ by exactly +1 (going down) or -1 (going up) — hence "±1 array".

### 2.2 LCA via RMQ on the depth array

For any two nodes `u, v`, record their **first occurrence** in the tour as `first[u]` and `first[v]`. Then:

> `LCA(u, v) = nodes[ argmin( depths[first[u] .. first[v]] ) ]`

The lowest-depth node visited between the two first-occurrences is the LCA. So LCA on `T` reduces to RMQ on the `depths` array of length `2n - 1`.

### 2.3 Why this matters

The `depths` array is a **±1 array** — consecutive entries differ by exactly ±1. This restricted version of RMQ admits a clever block-decomposition algorithm with **O(n) preprocessing** and **O(1) query** — the classic result of Bender & Farach-Colton 2000. Combined with the bijection, we get:

> **General RMQ in O(n) preprocessing and O(1) query** — via Cartesian tree → Euler tour → ±1-RMQ.

The constants are large (a 4-level recursion of block decompositions), so in practice the plain O(n log n) sparse table is faster for `n <= 10^7` or so. But theoretically it is optimal.

---

<a name="fischer-heun"></a>
## 3. Fischer-Heun: O(n) Preprocessing, O(1) Query

The **Fischer-Heun (2007)** algorithm gives **O(n) preprocessing, O(1) query, and only O(n) bits of extra space** — succinct. It is the modern practical winner among optimal RMQ algorithms and powers libraries like **sdsl-lite**.

### 3.1 The high-level idea

1. Split the array into blocks of size `b = (log n) / 2`.
2. Compute the minimum of each block → array `B` of length `n / b`.
3. Build a sparse table over `B` — this costs O((n/b) · log(n/b)) = O(n) time and space.
4. To answer a query `[l, r]` that spans multiple blocks: take the min of the block-level sparse-table answer for the **whole blocks** between `l` and `r`, plus a **prefix lookup** for the partial block at the start and a **suffix lookup** for the partial block at the end.
5. The trick: precompute the answer for every possible "shape" of a length-`b` block. There are only `4^b` shapes (each consecutive difference is +1 or -1, so `2^b` shapes; the Cartesian-tree-signature trick brings it down to a Catalan number's worth).

The total space for block-level lookups is `O(2^b · b · log b)` bits = `O(sqrt(n) · log n · log log n)` bits = `o(n)` bits. Plus the O(n)-cell sparse table on block minima. Total: O(n) words.

### 3.2 The succinct version

Fischer-Heun further showed how to store the RMQ data structure in only **2n + o(n) bits** — independent of the values in the array — by exploiting the fact that the *answer* to any RMQ only depends on the **shape of the Cartesian tree**, not the actual values. They encode the Cartesian tree as a 2n-bit balanced-parenthesis string and answer RMQ via standard succinct-tree LCA techniques.

This is the basis of **enhanced suffix arrays** and the **FM-index** in compressed text indexing.

### 3.3 When to actually use it

In practice:
- Up to `n = 10^7` and queries in the millions, **plain sparse table wins** — better constants, simpler code.
- For `n > 10^8` or where memory is the bottleneck, Fischer-Heun is the right answer.
- For string-processing libraries that need RMQ on the LCP array and have memory-conscious users (genome data, compressed full-text indexes), Fischer-Heun is standard.

---

<a name="2d"></a>
## 4. 2D Sparse Table

For a static 2D grid `g[0..n-1][0..m-1]`, the **rectangle minimum query** asks: given `(r1, c1, r2, c2)`, find `min(g[r][c])` for `r1 <= r <= r2`, `c1 <= c <= c2`.

### 4.1 The 4-D table

Define:

```
st[ka][kb][i][j] = min of the rectangle starting at (i, j) of size 2^ka × 2^kb
```

Build by analogy with the 1-D case: first build over rows for each fixed `kb = 0`, then double across columns.

```python
def build_2d(g):
    n, m = len(g), len(g[0])
    Kn = max(1, n).bit_length()
    Km = max(1, m).bit_length()
    # st[ka][kb] is an (n - 2^ka + 1) x (m - 2^kb + 1) grid.
    st = [[None] * Km for _ in range(Kn)]
    st[0][0] = [row[:] for row in g]
    # Double across columns first.
    for kb in range(1, Km):
        half = 1 << (kb - 1)
        st[0][kb] = [
            [min(st[0][kb-1][i][j], st[0][kb-1][i][j + half])
             for j in range(m - (1 << kb) + 1)]
            for i in range(n)
        ]
    # Then across rows.
    for ka in range(1, Kn):
        half = 1 << (ka - 1)
        for kb in range(Km):
            st[ka][kb] = [
                [min(st[ka-1][kb][i][j], st[ka-1][kb][i + half][j])
                 for j in range(len(st[ka-1][kb][0]))]
                for i in range(n - (1 << ka) + 1)
            ]
    return st
```

### 4.2 Complexity

- Preprocessing: **O(n · m · log n · log m)** time and space. For `n = m = 1000`, that is `1000 · 1000 · 10 · 10 = 10^8` cells — feasible but heavy. For `n = m = 5000` it becomes prohibitive.
- Query: **O(1)** — the answer is the min of **four** overlapping `2^ka × 2^kb` rectangles. With `ka = floor(log2(r2-r1+1))` and `kb = floor(log2(c2-c1+1))`:

```python
def query(st, log, r1, c1, r2, c2):
    ka = log[r2 - r1 + 1]
    kb = log[c2 - c1 + 1]
    sub = [
        st[ka][kb][r1][c1],
        st[ka][kb][r1][c2 - (1 << kb) + 1],
        st[ka][kb][r2 - (1 << ka) + 1][c1],
        st[ka][kb][r2 - (1 << ka) + 1][c2 - (1 << kb) + 1],
    ]
    return min(sub)
```

Four overlapping rectangles cover the query rectangle and combine via idempotent min.

### 4.3 Use cases

- **Geographic Information Systems** — "lowest elevation in this rectangle".
- **Image processing** — local-min filters for blob detection (when the kernel is rectangular and arbitrary-size).
- **Tournament scheduling** — fastest team in a rectangular sub-tournament.

For tighter memory, **2D sqrt-decomposition** or **2D segment tree** trade query time for space.

---

<a name="disjoint"></a>
## 5. Disjoint Sparse Table — Non-Idempotent Ops in O(1)

The plain sparse table only works for idempotent ops because the two answering windows **overlap**. A **disjoint sparse table** rearranges the query so that the two answering windows are **disjoint** — at the cost of O(n log n) memory but with the benefit of supporting **any associative op**, including sum, xor, product.

### 5.1 The construction

For each level `k`, virtually split the array into blocks of size `2^k`. Inside each block, precompute:
- a **prefix array**: `prefix[i] = op(arr[block_start], ..., arr[i])`
- a **suffix array**: `suffix[i] = op(arr[i], ..., arr[block_end])`

There are `log n` levels.

### 5.2 The query

Given `[l, r]`, find the **highest bit position** where `l` and `r` differ, call it `k`. Then:
- `l` and `r` lie in two adjacent blocks of size `2^k` at level `k`.
- The answer is `op(suffix_at_level_k[l], prefix_at_level_k[r])`.
- These two pieces are **disjoint** — perfect for non-idempotent ops.

```python
class DisjointSparseTable:
    def __init__(self, arr, op):
        self.op = op
        n = len(arr)
        levels = max(1, (n - 1).bit_length())
        self.table = [arr[:]]  # level 0 ~ raw values (not used directly)
        # For each level k > 0, table[k][i] holds either prefix or suffix
        # within the block of size 2^k that contains i.
        for k in range(1, levels + 1):
            size = 1 << k
            half = 1 << (k - 1)
            row = arr[:]
            for block_start in range(0, n, size):
                mid = block_start + half
                # Prefix from mid going left.
                if mid < n:
                    row[mid - 1] = arr[mid - 1]
                    for i in range(mid - 2, block_start - 1, -1):
                        row[i] = op(arr[i], row[i + 1])
                # Suffix from mid going right.
                if mid < n:
                    row[mid] = arr[mid]
                    end = min(block_start + size, n)
                    for i in range(mid + 1, end):
                        row[i] = op(row[i - 1], arr[i])
            self.table.append(row)

    def query(self, l, r):
        if l == r: return self.table[0][l]
        k = (l ^ r).bit_length()
        return self.op(self.table[k][l], self.table[k][r])
```

The highest differing bit of `l xor r` tells you the level at which `l` and `r` land in adjacent half-blocks. The two-piece answer is disjoint, so any associative op works.

### 5.3 Trade-off summary

| Structure | Op requirement | Build | Query | Space |
|---|---|---|---|---|
| Sparse table | idempotent | O(n log n) | O(1) | O(n log n) |
| Disjoint sparse table | associative | O(n log n) | O(1) | O(n log n) |
| Prefix-sum array | invertible group (`+`) | O(n) | O(1) | O(n) |
| Fenwick tree | invertible group | O(n) | O(log n) | O(n) |
| Segment tree | associative | O(n) | O(log n) | O(n) |

Disjoint sparse table is the **only** static structure giving O(1) range sum / xor / product without requiring invertibility (a prefix-sum trick needs invertibility — fails for xor on monoids without inverse, fine for ordinary sum).

---

<a name="comparison"></a>
## 6. Sparse Table vs Segment Tree vs Fenwick vs √n-Decomposition

| Feature | Sparse Table | Segment Tree | Fenwick (BIT) | √n-Decomposition |
|---|---|---|---|---|
| Build time | O(n log n) | O(n) | O(n) | O(n) |
| Query time | O(1) | O(log n) | O(log n) | O(√n) |
| Update time | not supported | O(log n) | O(log n) | O(√n) or O(1) |
| Space | O(n log n) | O(n) | O(n) | O(n) |
| Op requirement | idempotent (or disjoint variant) | associative | invertible group | associative |
| Lazy propagation | no | yes | no | yes (with care) |
| Persistent variant | n/a | yes | no | no |
| Code length | tiny | medium | tiny | small |

**When to pick each:**
- **Static array, idempotent op, query-heavy** → sparse table.
- **Dynamic array, any op, balanced read/write** → segment tree.
- **Dynamic prefix sums, simple op** → Fenwick.
- **Dynamic array, you don't want to write a segment tree** → √n-decomposition. Commonly used for **Mo's algorithm**.
- **Static, non-idempotent op, O(1) query needed** → disjoint sparse table.

---

<a name="why"></a>
## 7. Why Sparse Table is THE Answer for Static RMQ in Competitive Programming

In a typical Codeforces or ICPC problem, you see "the array is given once, then `q` range-min queries follow with no updates". The decision tree:

1. Is it static and idempotent? → **Sparse table**. ~25 lines, O(1) per query.
2. Static but non-idempotent (sum, xor)? → **prefix-sum array** if the op is invertible (sum is); otherwise disjoint sparse table.
3. Updates? → **segment tree** (or Fenwick for sum).
4. Range updates + range queries? → **segment tree with lazy propagation**.

Sparse table wins competitive contests because:
- **Tiny code.** You can paste a template in under 60 seconds.
- **Fast queries.** Two reads and a min. With `n = 10^5` and `q = 10^6`, sparse table runs in well under a second.
- **No tricky updates.** No off-by-one in lazy propagation, no node-merge logic. If the problem says "static array", sparse table is the answer.
- **Trivially adaptable** to max, gcd, AND, OR.

This is why, in a typical 5-hour ICPC problem set with one "static RMQ" problem, the experienced team types the sparse table from memory in 90 seconds and moves on.

---

## Further Reading

- **Bender, M. A. & Farach-Colton, M.** "The LCA Problem Revisited." *LATIN 2000*. The RMQ ↔ LCA bijection paper.
- **Fischer, J. & Heun, V.** "A New Succinct Representation of RMQ-Information and Improvements in the Enhanced Suffix Array." *ESCAPE 2007*. The 2n + o(n) bit succinct RMQ.
- **Gabow, H. N., Bentley, J. L. & Tarjan, R. E.** "Scaling and related techniques for geometry problems." *STOC 1984*. The first proof of the RMQ ↔ Cartesian-tree-LCA bijection.
- **Berkman, O. & Vishkin, U.** "Recursive star-tree parallel data structure." *SIAM J. Comput.* 22(2), 1993. The first O(n)-O(1) RMQ — theoretical only due to huge constants.
- **Gog, S. et al.** **sdsl-lite** library. Practical implementations of succinct RMQ and related structures.
- **CP-Algorithms** — *Sparse Table* and *Disjoint Sparse Table* articles.
- Continue with `senior.md` for production usage in suffix arrays, LCP, and tree-LCA in compilers and Git.
