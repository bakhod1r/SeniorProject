# Sparse Table & RMQ — Interview Problems

> **Audience:** Candidates preparing for FAANG and competitive-programming-style interviews where range queries appear. Prerequisites: `junior.md`, `middle.md`.

Below are ten problems with full Go, Java, and Python solutions. Each problem is annotated with where sparse table shines versus when another structure is preferable.

---

## Problem 1 — Implement Sparse Table for RMQ

**Statement.** Given a static array `arr` and `q` queries of the form `(l, r)`, return `min(arr[l..r])` for each. Constraints: `n, q <= 2·10^5`.

**Approach.** Standard sparse table. O(n log n) build, O(1) per query.

**Go:**
```go
package main

import "math/bits"

type ST struct{ st [][]int }

func NewST(a []int) *ST {
    n := len(a)
    if n == 0 { return &ST{} }
    K := bits.Len(uint(n))
    st := make([][]int, K)
    st[0] = append([]int(nil), a...)
    for k := 1; k < K; k++ {
        length := 1 << k
        if length > n { break }
        half := 1 << (k - 1)
        st[k] = make([]int, n-length+1)
        for i := 0; i+length <= n; i++ {
            st[k][i] = min(st[k-1][i], st[k-1][i+half])
        }
    }
    return &ST{st: st}
}
func (s *ST) Q(l, r int) int {
    k := bits.Len(uint(r-l+1)) - 1
    return min(s.st[k][l], s.st[k][r-(1<<k)+1])
}
func min(a, b int) int { if a < b { return a }; return b }
```

**Java:**
```java
class SparseTable {
    int[][] st; int n;
    SparseTable(int[] a) {
        n = a.length;
        int K = (n == 0) ? 1 : 32 - Integer.numberOfLeadingZeros(n);
        st = new int[K][];
        st[0] = a.clone();
        for (int k = 1; k < K; k++) {
            int len = 1 << k;
            if (len > n) break;
            int half = 1 << (k - 1);
            st[k] = new int[n - len + 1];
            for (int i = 0; i + len <= n; i++)
                st[k][i] = Math.min(st[k-1][i], st[k-1][i+half]);
        }
    }
    int query(int l, int r) {
        int k = 31 - Integer.numberOfLeadingZeros(r - l + 1);
        return Math.min(st[k][l], st[k][r - (1 << k) + 1]);
    }
}
```

**Python:**
```python
class SparseTable:
    def __init__(self, a):
        self.n = len(a)
        K = max(1, self.n.bit_length())
        self.st = [a[:]]
        for k in range(1, K):
            length, half = 1 << k, 1 << (k - 1)
            if length > self.n: break
            prev = self.st[-1]
            self.st.append([min(prev[i], prev[i+half]) for i in range(self.n - length + 1)])

    def query(self, l, r):
        k = (r - l + 1).bit_length() - 1
        return min(self.st[k][l], self.st[k][r - (1 << k) + 1])
```

---

## Problem 2 — Largest Rectangle in Histogram (LeetCode 84)

**Statement.** Given heights `h[0..n-1]`, find the largest rectangle that fits under the bars.

**Sparse-table approach (divide & conquer).** The largest rectangle in `[l, r]` either uses the minimum bar across its full width, or lies entirely on one side of that minimum. Use sparse table to find the **index of the min** in O(1), recurse on the two sides.

**Time complexity.** O(n log n) average via random-pivot-like behavior; worst case O(n²) on sorted input — so for adversarial inputs, the monotonic stack O(n) approach is strictly better. The sparse-table approach is included here because it demonstrates the **index-of-min** technique.

**Python:**
```python
def largest_rectangle(h):
    n = len(h)
    if not n: return 0
    # Sparse table storing the INDEX of the min, not the value.
    K = n.bit_length()
    st = [list(range(n))]
    log = [0] * (n + 1)
    for i in range(2, n + 1): log[i] = log[i // 2] + 1
    for k in range(1, K):
        length, half = 1 << k, 1 << (k - 1)
        if length > n: break
        prev = st[-1]
        row = []
        for i in range(n - length + 1):
            a, b = prev[i], prev[i + half]
            row.append(a if h[a] <= h[b] else b)
        st.append(row)
    def argmin(l, r):
        k = log[r - l + 1]
        a, b = st[k][l], st[k][r - (1 << k) + 1]
        return a if h[a] <= h[b] else b
    def solve(l, r):
        if l > r: return 0
        m = argmin(l, r)
        return max(h[m] * (r - l + 1), solve(l, m - 1), solve(m + 1, r))
    return solve(0, n - 1)
```

---

## Problem 3 — Sliding Window Maximum (LeetCode 239)

**Statement.** Given `nums` and window size `k`, return the max of every length-`k` window.

**Standard approach.** Monotonic deque in O(n). The sparse-table alternative is O(n log n) build then O(n) queries — slightly slower but extremely simple to write.

**Go:**
```go
func maxSlidingWindow(nums []int, k int) []int {
    n := len(nums)
    if n == 0 { return nil }
    // Sparse table for max.
    K := bits.Len(uint(n))
    st := make([][]int, K)
    st[0] = append([]int(nil), nums...)
    for kk := 1; kk < K; kk++ {
        length, half := 1<<kk, 1<<(kk-1)
        if length > n { break }
        st[kk] = make([]int, n-length+1)
        for i := 0; i+length <= n; i++ {
            st[kk][i] = max(st[kk-1][i], st[kk-1][i+half])
        }
    }
    res := make([]int, 0, n-k+1)
    for l := 0; l+k <= n; l++ {
        r := l + k - 1
        kk := bits.Len(uint(r-l+1)) - 1
        res = append(res, max(st[kk][l], st[kk][r-(1<<kk)+1]))
    }
    return res
}
func max(a, b int) int { if a > b { return a }; return b }
```

---

## Problem 4 — Construct Cartesian Tree from Array in O(n)

**Statement.** Build a Cartesian tree (min-heap order on values, in-order traversal recovers the array) in O(n).

**Approach.** Stack-based linear-time construction (Gabow, Bentley, Tarjan 1984).

**Java:**
```java
int[] cartesianTreeParent(int[] arr) {
    int n = arr.length;
    int[] parent = new int[n];
    Arrays.fill(parent, -1);
    Deque<Integer> stack = new ArrayDeque<>();
    for (int i = 0; i < n; i++) {
        int last = -1;
        while (!stack.isEmpty() && arr[stack.peek()] > arr[i]) {
            last = stack.pop();
        }
        if (last != -1) parent[last] = i;
        if (!stack.isEmpty()) parent[i] = stack.peek();
        stack.push(i);
    }
    return parent;
}
```

**Python:**
```python
def cartesian_tree(arr):
    n = len(arr)
    parent = [-1] * n
    stack = []
    for i in range(n):
        last = -1
        while stack and arr[stack[-1]] > arr[i]:
            last = stack.pop()
        if last != -1: parent[last] = i
        if stack: parent[i] = stack[-1]
        stack.append(i)
    return parent
```

---

## Problem 5 — LCA of Binary Tree via Euler Tour + Sparse Table

**Statement.** Preprocess a tree so any LCA query is answered in O(1).

**Approach.** Euler tour → depth array → sparse table for index-of-min over the depth array. The LCA of `u` and `v` is the node at the minimum-depth position between their first occurrences in the Euler tour.

**Python:**
```python
class TreeLCA:
    def __init__(self, n, adj, root=0):
        self.n = n
        self.tour = []
        self.depth = []
        self.first = [-1] * n
        stack = [(root, 0, iter(adj[root]))]
        self.first[root] = 0
        self.tour.append(root)
        self.depth.append(0)
        while stack:
            u, d, it = stack[-1]
            v = next(it, None)
            if v is None:
                stack.pop()
                if stack:
                    p = stack[-1][0]
                    self.tour.append(p)
                    self.depth.append(stack[-1][1])
            else:
                self.first[v] = len(self.tour)
                self.tour.append(v)
                self.depth.append(d + 1)
                stack.append((v, d + 1, iter(adj[v])))
        # Build sparse table storing indices.
        m = len(self.tour)
        self.log = [0] * (m + 1)
        for i in range(2, m + 1): self.log[i] = self.log[i // 2] + 1
        K = self.log[m] + 1
        self.st = [list(range(m))]
        for k in range(1, K):
            length, half = 1 << k, 1 << (k - 1)
            if length > m: break
            prev = self.st[-1]
            row = []
            for i in range(m - length + 1):
                a, b = prev[i], prev[i + half]
                row.append(a if self.depth[a] <= self.depth[b] else b)
            self.st.append(row)

    def lca(self, u, v):
        l, r = self.first[u], self.first[v]
        if l > r: l, r = r, l
        k = self.log[r - l + 1]
        a = self.st[k][l]
        b = self.st[k][r - (1 << k) + 1]
        idx = a if self.depth[a] <= self.depth[b] else b
        return self.tour[idx]
```

Preprocessing O(n log n), query O(1). Used in compilers, Git ancestry, phylogenetic databases (see `senior.md`).

---

## Problem 6 — Range GCD

**Statement.** Static array, answer `gcd(arr[l..r])` for many queries.

**Approach.** Sparse table with `gcd` as the combiner. GCD is idempotent: `gcd(x, x) = x`. Note: each query operation is O(log(max value)) due to the gcd itself, so total query cost is O(log V) — but the sparse-table mechanism is still doing constant work.

**Go:**
```go
import "math/bits"

func gcd(a, b int) int { for b != 0 { a, b = b, a%b }; return a }

type GcdST struct{ st [][]int }
func NewGcdST(a []int) *GcdST {
    n := len(a); K := bits.Len(uint(n))
    st := make([][]int, K)
    st[0] = append([]int(nil), a...)
    for k := 1; k < K; k++ {
        length, half := 1<<k, 1<<(k-1)
        if length > n { break }
        st[k] = make([]int, n-length+1)
        for i := 0; i+length <= n; i++ {
            st[k][i] = gcd(st[k-1][i], st[k-1][i+half])
        }
    }
    return &GcdST{st: st}
}
func (s *GcdST) Q(l, r int) int {
    k := bits.Len(uint(r-l+1)) - 1
    return gcd(s.st[k][l], s.st[k][r-(1<<k)+1])
}
```

---

## Problem 7 — 2D Sparse Table for Rectangle Max

**Statement.** Given `n × m` grid, answer `max` queries on arbitrary rectangles.

**Approach.** 4-D sparse table. Build first across columns then across rows. Query reads four overlapping rectangles.

**Python:**
```python
class ST2D:
    def __init__(self, g):
        self.n, self.m = len(g), len(g[0])
        self.lg = [0] * (max(self.n, self.m) + 1)
        for i in range(2, len(self.lg)):
            self.lg[i] = self.lg[i // 2] + 1
        Kn = self.lg[self.n] + 1
        Km = self.lg[self.m] + 1
        # t[ka][kb] is the precomputed grid for rectangles 2^ka x 2^kb.
        self.t = [[None] * Km for _ in range(Kn)]
        self.t[0][0] = [row[:] for row in g]
        for kb in range(1, Km):
            half = 1 << (kb - 1)
            self.t[0][kb] = [
                [max(self.t[0][kb-1][i][j], self.t[0][kb-1][i][j+half])
                 for j in range(self.m - (1 << kb) + 1)]
                for i in range(self.n)
            ]
        for ka in range(1, Kn):
            half = 1 << (ka - 1)
            for kb in range(Km):
                width = self.m - (1 << kb) + 1
                self.t[ka][kb] = [
                    [max(self.t[ka-1][kb][i][j], self.t[ka-1][kb][i+half][j])
                     for j in range(width)]
                    for i in range(self.n - (1 << ka) + 1)
                ]

    def query(self, r1, c1, r2, c2):
        ka = self.lg[r2 - r1 + 1]; kb = self.lg[c2 - c1 + 1]
        t = self.t[ka][kb]
        a = t[r1][c1]; b = t[r1][c2 - (1 << kb) + 1]
        c = t[r2 - (1 << ka) + 1][c1]; d = t[r2 - (1 << ka) + 1][c2 - (1 << kb) + 1]
        return max(a, b, c, d)
```

---

## Problem 8 — Build LCP from Suffix Array (Kasai), then RMQ for Substring LCE

**Statement.** Given a string `S` and its suffix array `SA`, build the LCP array using Kasai's algorithm. Then preprocess for O(1) Longest Common Extension queries between any two suffixes.

**Kasai's algorithm (O(n)):**

```python
def kasai_lcp(s, sa):
    n = len(s)
    rank = [0] * n
    for i, p in enumerate(sa): rank[p] = i
    lcp = [0] * (n - 1)
    h = 0
    for i in range(n):
        if rank[i] > 0:
            j = sa[rank[i] - 1]
            while i + h < n and j + h < n and s[i + h] == s[j + h]:
                h += 1
            lcp[rank[i] - 1] = h
            if h > 0: h -= 1
    return lcp

def lce_preprocess(s, sa):
    lcp = kasai_lcp(s, sa)
    rank = [0] * len(s)
    for i, p in enumerate(sa): rank[p] = i
    st = SparseTable(lcp)  # min-sparse-table over LCP
    return rank, st

def lce(rank, st, i, j):
    """Longest common prefix of suffixes starting at i and j."""
    if i == j: return float('inf')  # or len - i
    a, b = sorted([rank[i], rank[j]])
    return st.query(a, b - 1)
```

This is exactly the technique used in **bowtie2**, **BWA**, and **sdsl-lite**'s enhanced suffix array.

---

## Problem 9 — LeetCode 1206 (Skip List) — Sparse-Table Parallel

**Statement.** Implement a skip list. (Not directly RMQ but worth comparing.)

**Discussion.** A **skip list** maintains `O(log n)` levels of forward pointers; each higher level skips over more elements. Conceptually similar to a sparse table — both rely on the "double the stride at each level" idea. Differences:
- Skip list is randomized; sparse table is deterministic.
- Skip list supports insert/delete in O(log n); sparse table is static.
- Skip list answers "find an element" in O(log n); sparse table answers RMQ in O(1).

The shared lesson: **doubling structures** give O(log n) levels and powerful queries. When you see "geometric series of strides", you are probably looking at a doubling table in disguise.

---

## Problem 10 — Disjoint Sparse Table for Range Sum (O(1) Query, Static)

**Statement.** Given a static array, answer `sum(arr[l..r])` in O(1).

**Why not prefix sums?** A prefix-sum array also gives O(1) range sum in O(n) space — for integers it is strictly better. The disjoint sparse table is included here because it generalizes to **any associative op** (e.g., string concatenation, matrix product), whereas prefix sums require an invertible group.

**Approach.** Build a multi-level structure where each level has prefix/suffix sums within virtual blocks of size `2^k`. For query, find the highest bit where `l` and `r` differ — they lie in adjacent blocks at that level, and the answer is the suffix of `l`'s block combined with the prefix of `r`'s block.

**Python:**
```python
class DisjointSparseSum:
    def __init__(self, a):
        n = len(a)
        self.n = n
        if n == 0:
            self.t = []
            return
        levels = max(1, (n - 1).bit_length())
        self.t = [a[:]]
        for k in range(1, levels + 1):
            size = 1 << k
            half = size >> 1
            row = a[:]
            for bs in range(0, n, size):
                mid = bs + half
                if mid - 1 >= bs and mid - 1 < n:
                    row[mid - 1] = a[mid - 1]
                    for i in range(mid - 2, bs - 1, -1):
                        row[i] = row[i + 1] + a[i]
                if mid < n:
                    row[mid] = a[mid]
                    end = min(bs + size, n)
                    for i in range(mid + 1, end):
                        row[i] = row[i - 1] + a[i]
            self.t.append(row)

    def query(self, l, r):
        if l == r: return self.t[0][l]
        k = (l ^ r).bit_length()
        return self.t[k][l] + self.t[k][r]
```

In an interview this lets you say *"with disjoint sparse table you get O(1) range sum even on non-invertible monoids, without giving up the static-build constraint"* — a strong signal of depth.

---

## Quick Reference Card

| Problem | Best structure | Why |
|---|---|---|
| Static range min | Sparse table | O(1) query, idempotent |
| Static range max | Sparse table | Same |
| Static range gcd | Sparse table | gcd idempotent |
| Static range sum | Prefix sum (or disjoint ST) | Invertible group |
| Dynamic range min | Segment tree | Updates needed |
| Sliding-window max | Monotonic deque (or sparse table) | Deque is O(n), ST is O(n log n) build |
| LCE on string | SA + LCP + ST | O(1) per query |
| LCA on tree | Euler tour + ST | O(1) per query after O(n log n) |
| Largest histogram rect | Monotonic stack | O(n); ST works but is O(n log n) avg |
| 2D rectangle min | 2D sparse table or 2D segment tree | ST is O(1) query, O(nm log n log m) build |

Master these and you can answer almost any "range query" interview question with the right tool.
