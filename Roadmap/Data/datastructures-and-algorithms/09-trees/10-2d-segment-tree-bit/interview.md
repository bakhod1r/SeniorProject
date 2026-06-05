# 2D Range Queries (2D BIT & 2D Segment Tree) — Interview Preparation

> **Audience:** Candidates preparing for interviews where 2D range structures are the intended solution (LeetCode 308, computational-geometry counting, FAANG system-design rounds). Prerequisite: `junior.md`, `middle.md`; helpful: `senior.md`, `professional.md`.

This file has **45 tiered questions and answers** across Junior, Middle, Senior, and Professional difficulty, followed by **one coding challenge** solved in Go, Java, and Python. Read the question, attempt an answer aloud, then check yourself against the focus column / answer.

---

## Table of Contents

1. [Junior Questions (Q1–Q14)](#junior)
2. [Middle Questions (Q15–Q28)](#middle)
3. [Senior Questions (Q29–Q38)](#senior)
4. [Professional Questions (Q39–Q45)](#professional)
5. [Coding Challenge — Dynamic Rectangle Sum (Go/Java/Python)](#challenge)
6. [Interview Tips](#tips)

---

<a name="junior"></a>
## 1. Junior Questions (Q1–Q14)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a 2D Fenwick tree (2D BIT)? | A 1-indexed 2D array supporting point update + top-left-prefix sum in O(log n · log m); a "BIT of BITs". |
| 2 | What two operations does the basic 2D BIT support? | `update(r,c,δ)` (add δ to one cell) and `prefix(r,c)` (sum of the top-left submatrix `A[1..r][1..c]`). |
| 3 | What is the time complexity of update and prefix? | Both O(log n · log m) — a nested pair of 1D `lowbit` loops. |
| 4 | How do you get a rectangle sum from prefixes? | Inclusion-exclusion: `prefix(r2,c2) − prefix(r1−1,c2) − prefix(r2,c1−1) + prefix(r1−1,c1−1)`. |
| 5 | Why is the 2D BIT 1-indexed in both dimensions? | `lowbit(0)=0` would make either loop spin forever; both axes must start at ≥ 1. |
| 6 | How much memory does a 2D BIT use? | `(n+1)(m+1)` cells — the same order as the matrix, O(n·m). |
| 7 | What does `T[i][j]` store? | The sum over the responsibility rectangle: rows `[i−lowbit(i)+1, i]` × cols `[j−lowbit(j)+1, j]`. |
| 8 | Which direction does update walk vs prefix? | Update walks **up** (`i += lowbit(i)`, `j += lowbit(j)`); prefix walks **down** (`i -= lowbit(i)`, `j -= lowbit(j)`). |
| 9 | What is `lowbit(i)` and how is it computed? | The lowest set bit of `i`, computed as `i & -i`. Used independently on row and column indices. |
| 10 | Can a 2D BIT answer rectangle minimum? | No. Min is not invertible; inclusion-exclusion subtraction is invalid. Use a 2D segment tree. |
| 11 | What aggregates *can* a 2D BIT handle? | Invertible ones: sum, XOR, count (anything forming a group). |
| 12 | What is the static alternative when there are no updates? | An integral image / summed-area table — O(1) rectangle query after O(n·m) preprocessing. |
| 13 | How many cells does updating `(r,c)` touch on a 4×4 grid? | At most `log₂4 · log₂4 = 2·2 = 4` cells. |
| 14 | What LeetCode problem is the canonical 2D BIT exercise? | LC 308, "Range Sum Query 2D — Mutable". |

**Selected long-form answers.**

**A4 (rectangle sum).** Draw the four overlapping top-left slabs. The big slab `prefix(r2,c2)` contains everything; subtract the top slab `prefix(r1−1,c2)` and the left slab `prefix(r2,c1−1)`; the corner `prefix(r1−1,c1−1)` was removed twice, so add it back once. The `+/−/−/+` pattern is the 2D analogue of the 1D `prefix(r) − prefix(l−1)`.

**A7 (responsibility rectangle).** Because the row index follows 1D BIT structure (range of length `lowbit(i)` ending at `i`) and independently the column index follows 1D BIT structure, the cell owns the Cartesian product: a `lowbit(i)`-tall, `lowbit(j)`-wide block whose bottom-right corner is `(i,j)`.

**A10 (no min).** The rectangle formula subtracts prefixes. There is no "un-min" operation, so you cannot reconstruct a rectangle's min from overlapping prefix mins. A segment-tree node, by contrast, combines children with `min(left, right)` directly — no subtraction — so 2D segment trees handle min/max.

**A8 (walk directions).** This is the most common detail interviewers probe. Update *adds* the lowest bit (`i += i & -i`), climbing to the cells whose responsibility rectangle covers the updated cell — those are the cells that must reflect the change. Prefix *subtracts* the lowest bit (`i -= i & -i`), peeling off disjoint responsibility ranges that tile `[1..i]`. The mnemonic: "to fix a value, climb to your bosses (update up); to total a prefix, collect from your subordinates (query down)." In 2D both axes do this independently and simultaneously.

**A13 (touch count).** Updating `(r,c)` touches `(number of row up-steps) × (number of column up-steps)`. On a 4×4 grid the worst case is `update(1,1)`: row walk `1→2→4` (3 steps), column walk `1→2→4` (3 steps) → 9 cells. But `update(4,4)` touches only `1×1 = 1` cell because both indices are the top power of two. So "at most ~4" is the *typical* count; the worst is `log·log` ≈ 9. Stating the exact dependence on bit structure impresses interviewers.

**A12 (static alternative).** If the grid never changes, do not pay `O(log·log)` per query — precompute `P[r][c] = sum of A[1..r][1..c]` once in `O(n·m)`, then every rectangle is the O(1) four-term inclusion-exclusion. This is the integral image / summed-area table. Mention it proactively: it signals you know that a BIT is *only* worth it when updates interleave with queries.

---

<a name="middle"></a>
## 2. Middle Questions (Q15–Q28)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 15 | When do you choose a 2D segment tree over a 2D BIT? | Non-invertible ops (min/max/gcd), or rectangle update + rectangle min/max with 2D lazy. |
| 16 | How do you support rectangle update + rectangle sum with BITs? | The four-BIT trick (2D version of the 1D two-BIT trick), weights `1, (x−1), (y−1), (x−1)(y−1)`. |
| 17 | What is coordinate compression and why is it needed? | Remap sparse/large coordinates to a dense `1..k` range so the grid stays small enough to allocate. |
| 18 | How much memory does a dense 2D segment tree use vs a 2D BIT? | ~16·n·m vs n·m — the BIT is ~16× lighter. |
| 19 | How do you count points in a rectangle for a static point set, cheaply? | Offline sweep on x + a single 1D BIT over compressed y — O((n+q) log n), O(n) memory. |
| 20 | What is a merge-sort tree? | A segment tree over x where each node stores the sorted y-list of its range; rectangle count in O(log² n). |
| 21 | Build and query complexity of a merge-sort tree? | Build O(n log n), query O(log² n), memory O(n log n). |
| 22 | Why prefer an offline sweep over a 2D BIT for static counting? | Memory: sweep + 1D BIT is O(n); a 2D BIT is O(n·m). |
| 23 | How do you map a query bound that falls between two compressed coordinates? | Lower bound rounds up, upper bound rounds down via `lower_bound`/`upper_bound` binary search. |
| 24 | Can the 2D BIT be built in O(n·m)? | Yes — run the 1D absorb once along columns (per row), then once along rows (per column). |
| 25 | What is the invariant a 2D BIT maintains? | `T[i][j] = sum of A over its responsibility rectangle`, restored after every operation. |
| 26 | How do you compute rectangle variance with BITs? | Keep two 2D BITs (sum of values, sum of squares); `Var = E[X²] − E[X]²` from two rect sums. |
| 27 | Why is "BIT of sorted lists" a thing? | A BIT over x where each cell holds the sorted y-list of its x-range; compact offline 2D counting. |
| 28 | What's the danger of reusing `i & -i` on the column index? | It steps the column by the row's lowbit → silent wrong sums. Use `j & -j` for columns. |

**Selected long-form answers.**

**A16 (four-BIT trick).** A rectangle update sets four corner deltas (signs `+,−,−,+`) in each of four 2D BITs. The four BITs maintain the four terms of the 2D linear-combination prefix formula: `prefix(r,c) = (r+1)(c+1)·B1 − (c+1)·B2 − (r+1)·B3 + B4`, where `B1..B4` are weighted by `1, (x−1), (y−1), (x−1)(y−1)`. Each op stays O(log n · log m) with a 4× constant. This is the practical ceiling of the BIT family; beyond it (rectangle update + rectangle min/max) you need a 2D segment tree.

**A19 (sweep).** Split each rectangle query into four prefix-count queries by inclusion-exclusion. Sort points by x and the prefix queries by their x-bound. Sweep x ascending: when a point's x passes the current bound, insert its compressed y into a 1D BIT. Answer each prefix query as `bit.prefix(rankY(Y))`. The second dimension is "consumed" by the sweep's time axis, so you only ever hold a 1D BIT — O(n) memory.

**A24 (O(n·m) build).** Copy `A` into `T`. First absorb along columns within each row (`T[i][j+lowbit(j)] += T[i][j]`), making each row 1D-correct along columns. Then absorb along rows within each column (`T[i+lowbit(i)][j] += T[i][j]`). Each phase is O(n·m); correctness follows from invoking the 1D absorb proof twice (once per axis).

**A15 (BIT vs segment tree).** Lead with invertibility. "Sum/xor/count are invertible, so I'd use a 2D BIT — n·m memory, ~8 lines, fast. If the operation were rectangle min/max/gcd, the inclusion-exclusion subtraction is invalid, so I'd switch to a 2D segment tree (segment tree of segment trees), accepting ~16× the memory and far more code. I'd only also need a segment tree for the BIT-able sum case if I needed rectangle update + rectangle min with 2D lazy propagation." Naming the 16× memory and the lazy-propagation caveat shows depth.

**A18 (memory gap).** A dense 2D segment tree has ~`4n` outer nodes, each holding an inner tree of ~`4m` nodes → ~`16·n·m` cells. The 2D BIT is exactly `n·m`. For a 4000×4000 int64 grid that is ~2 GB vs ~128 MB — often the difference between OOM and fitting. This is why dense 2D segment trees are usually built *dynamically* (inner nodes on demand).

**A22 (offline beats online on memory).** For a *static* point set with rectangle counts, an online 2D BIT wastes memory: it allocates O(n·m) cells. The offline sweep allocates one 1D BIT (O(n)). Since the queries are all known, sort them, sweep x, and the y-dimension is handled by a single 1D BIT that you reuse across the whole sweep. Memory drops by a factor of the grid's second dimension. The rule: *if you can batch, batch.*

**A26 (variance with two BITs).** Keep BIT₁ over values and BIT₂ over squared values. For a rectangle, `count = area`, `mean = rectSum₁ / count`, and `variance = rectSum₂ / count − mean²`. The subtlety: on a *set* update changing `A[r][c]` from `old` to `new`, update BIT₁ by `new − old` and BIT₂ by `new² − old²` (not `(new−old)²`). This generalizes to any additive moment.

---

<a name="senior"></a>
## 3. Senior Questions (Q29–Q38)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 29 | What dominates the design of a large 2D range system? | Memory (O(n·m)), not time. The goal is to avoid materializing a dense grid. |
| 30 | Design a live analytics heatmap with rectangle queries. | Small fixed grid → 2D BIT; or hot-window BIT + cold static SATs for time partitions. |
| 31 | How do you answer "POIs inside a bounding box" at global scale? | Bucket/compress coords + 2D BIT for axis-aligned counts; R-tree for arbitrary geometry; sweep for batch. |
| 32 | When does a "dynamic integral image" (2D BIT) beat a rebuild? | Only when frame-to-frame change is sparse; full-frame change prefers O(W·H) rebuild. |
| 33 | What is the hot-window / cold-partition pattern? | Mutable 2D BIT for the live window, immutable summed-area tables for sealed partitions; LSM-style. |
| 34 | How do you keep a 2D structure when operations are online but coordinates are knowable? | "Offline the coordinates": pre-scan the op stream, compress up front, run a fixed-size 2D BIT. |
| 35 | What's the failure mode of "a 2D BIT per category"? | O(n·m) per category multiplies memory; sparse categories must share or compress. |
| 36 | How do you detect a grid-blow-up problem in production? | Monitor `bit_2d_memory_bytes`, `compression_ratio`; alert as the grid grows unbounded. |
| 37 | Why might a dense 2D segment tree OOM where a BIT survives? | ~16× the memory; for large grids that gap is decisive. |
| 38 | Two 2D BITs solve what additive-statistics problem? | Rectangle mean and variance (one BIT for sums, one for squared sums). |

**Selected long-form answers.**

**A30 (heatmap design).** For a small fixed binning (e.g., 256×256 click buckets, or 24×7 time buckets), a dense 2D BIT is ideal: tiny memory, O(log·log) updates/queries. For large or time-unbounded binnings, seal historical partitions as static summed-area tables (O(1) queries, no updates) and keep only the current ingesting window in a 2D BIT. A query sums the relevant cold SATs (O(1) each) plus the live BIT (O(log·log)). On window roll-over, freeze the BIT into a SAT and start fresh — capping mutable memory at one window.

**A33 (hot/cold).** Cold partitions are immutable and stored as summed-area tables, queryable in O(1) and cheap to mmap. The hot window is a mutable 2D BIT. This mirrors LSM trees: immutable sorted runs (SATs) + a mutable memtable (BIT). It bounds mutable memory regardless of total data volume and keeps queries fast across both history and present.

**A34 (offline the coordinates).** Even with interleaved online operations, you can usually pre-scan the entire operation list to collect every coordinate that will ever appear, compress them once, and then run a fixed-size compressed 2D BIT. This converts a seemingly-needs-dynamic-grid problem into a fixed-grid one. It only fails in true streaming with no look-ahead.

---

<a name="professional"></a>
## 4. Professional Questions (Q39–Q45)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 39 | Prove `prefix(r,c)` is correct (the tiling theorem). | Row down-walk partitions `[1..r]`, column down-walk partitions `[1..c]`; their product partitions the rectangle; sum each responsibility rectangle exactly once. |
| 40 | Prove each operation is O(log n · log m). | Each walk is O(log) (one bit changed/added per step); nested → product. Tight at `r=c=2^k−1`. |
| 41 | Why does the BIT require a *group*, not just a monoid? | `rect` subtracts; subtraction needs an inverse. Max is a monoid (no inverse) → segment tree. |
| 42 | What is the space lower bound for dense 2D partial sums? | Ω(n·m·log|G|) bits to distinguish all matrices → Θ(n·m) cells is optimal; only sparsity beats it. |
| 43 | How does a persistent segment tree answer online rectangle counts? | Version over x; rectangle = difference of two versions' y-range counts; O(log m), O(n log m) memory. |
| 44 | Persistent vs merging segment trees — when each? | Persistent keeps history (k-th, versioned queries); merging is destructive (small-to-large subtree combines). |
| 45 | What is the lower bound for fully dynamic 2D range counting? | Ω(log n / log log n) per op (partial-sums extension); BIT-of-order-statistics O(log n · log m) is near-optimal in practice. |

**Selected long-form answers.**

**A39 (tiling proof).** By the 1D lemma, the down-walk over rows visits indices whose responsibility ranges are disjoint and union to `[1..r]`; likewise for columns and `[1..c]`. The nested loop sums `T[r_a][c_b]`, and by the invariant each equals the sum over `R(r_a) × R(c_b)`. Since `{R(r_a)}` partitions `[1..r]` and `{R(c_b)}` partitions `[1..c]`, the products `{R(r_a) × R(c_b)}` partition `[1..r] × [1..c]` — every cell counted exactly once — giving `Σ_{r'≤r} Σ_{c'≤c} A[r'][c']`.

**A41 (group vs monoid).** The rectangle formula is `+P −P −P +P`. Factor the per-cell multiplicity into `([r'≤r2]−[r'≤r1−1])·([c'≤c2]−[c'≤c1−1])`. The subtractions require an additive inverse in `G`. For `(G, max)` there is no inverse, so the indicator algebra does not collapse and `rect` is undefined. Hence max needs a structure (segment tree) that combines without subtracting.

**A43 (persistent rectangle count).** Sort points by x; build a persistent segment tree over compressed y, one version per x-prefix (each insert path-copies O(log m) nodes, total O(n log m) memory). "Count points with `x ≤ X`, `y ∈ [y1,y2]`" = query the version after all `x ≤ X` for that y-range. A rectangle `x ∈ [x1,x2]` is `query(v_{x2}) − query(v_{x1−1})` — valid because nodes store counts (a group). K-th-smallest-y descends both versions in lockstep.

---

<a name="challenge"></a>
## 5. Coding Challenge — Dynamic Rectangle Sum (Go/Java/Python)

> **Problem (LeetCode 308 style).** Implement `NumMatrix` over an initial `R×C` integer matrix supporting:
> - `update(row, col, val)`: set `matrix[row][col] = val`.
> - `sumRegion(r1, c1, r2, c2)`: return the sum of the rectangle `[r1..r2] × [c1..c2]` (0-indexed, inclusive).
>
> Both operations must run in O(log R · log C). Use a 2D BIT; maintain the raw matrix to compute the delta on update.

### Go

```go
package main

import "fmt"

type NumMatrix struct {
    n, m int
    mat  [][]int
    t    [][]int64
}

func Constructor(matrix [][]int) NumMatrix {
    n := len(matrix)
    m := 0
    if n > 0 {
        m = len(matrix[0])
    }
    nm := NumMatrix{n: n, m: m}
    nm.mat = make([][]int, n)
    nm.t = make([][]int64, n+1)
    for i := range nm.t {
        nm.t[i] = make([]int64, m+1)
    }
    for i := 0; i < n; i++ {
        nm.mat[i] = make([]int, m)
        for j := 0; j < m; j++ {
            nm.mat[i][j] = 0
            nm.add(i+1, j+1, int64(matrix[i][j]))
            nm.mat[i][j] = matrix[i][j]
        }
    }
    return nm
}

func (nm *NumMatrix) add(r, c int, delta int64) {
    for i := r; i <= nm.n; i += i & -i {
        for j := c; j <= nm.m; j += j & -j {
            nm.t[i][j] += delta
        }
    }
}

func (nm *NumMatrix) prefix(r, c int) int64 {
    var s int64
    for i := r; i > 0; i -= i & -i {
        for j := c; j > 0; j -= j & -j {
            s += nm.t[i][j]
        }
    }
    return s
}

func (nm *NumMatrix) Update(row, col, val int) {
    delta := int64(val - nm.mat[row][col])
    nm.mat[row][col] = val
    nm.add(row+1, col+1, delta)
}

func (nm *NumMatrix) SumRegion(r1, c1, r2, c2 int) int {
    return int(nm.prefix(r2+1, c2+1) - nm.prefix(r1, c2+1) -
        nm.prefix(r2+1, c1) + nm.prefix(r1, c1))
}

func main() {
    nm := Constructor([][]int{
        {3, 0, 1, 4, 2},
        {5, 6, 3, 2, 1},
        {1, 2, 0, 1, 5},
        {4, 1, 0, 1, 7},
        {1, 0, 3, 0, 5},
    })
    fmt.Println(nm.SumRegion(2, 1, 4, 3)) // 8
    nm.Update(3, 2, 2)
    fmt.Println(nm.SumRegion(2, 1, 4, 3)) // 10
}
```

### Java

```java
public class NumMatrix {
    private final int n, m;
    private final int[][] mat;
    private final long[][] t;

    public NumMatrix(int[][] matrix) {
        n = matrix.length;
        m = n > 0 ? matrix[0].length : 0;
        mat = new int[n][m];
        t = new long[n + 1][m + 1];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < m; j++) {
                add(i + 1, j + 1, matrix[i][j]);
                mat[i][j] = matrix[i][j];
            }
        }
    }

    private void add(int r, int c, long delta) {
        for (int i = r; i <= n; i += i & -i)
            for (int j = c; j <= m; j += j & -j)
                t[i][j] += delta;
    }

    private long prefix(int r, int c) {
        long s = 0;
        for (int i = r; i > 0; i -= i & -i)
            for (int j = c; j > 0; j -= j & -j)
                s += t[i][j];
        return s;
    }

    public void update(int row, int col, int val) {
        long delta = val - mat[row][col];
        mat[row][col] = val;
        add(row + 1, col + 1, delta);
    }

    public int sumRegion(int r1, int c1, int r2, int c2) {
        return (int) (prefix(r2 + 1, c2 + 1) - prefix(r1, c2 + 1)
                    - prefix(r2 + 1, c1) + prefix(r1, c1));
    }

    public static void main(String[] args) {
        NumMatrix nm = new NumMatrix(new int[][]{
            {3, 0, 1, 4, 2}, {5, 6, 3, 2, 1}, {1, 2, 0, 1, 5},
            {4, 1, 0, 1, 7}, {1, 0, 3, 0, 5}
        });
        System.out.println(nm.sumRegion(2, 1, 4, 3)); // 8
        nm.update(3, 2, 2);
        System.out.println(nm.sumRegion(2, 1, 4, 3)); // 10
    }
}
```

### Python

```python
class NumMatrix:
    def __init__(self, matrix):
        self.n = len(matrix)
        self.m = len(matrix[0]) if self.n else 0
        self.mat = [[0] * self.m for _ in range(self.n)]
        self.t = [[0] * (self.m + 1) for _ in range(self.n + 1)]
        for i in range(self.n):
            for j in range(self.m):
                self._add(i + 1, j + 1, matrix[i][j])
                self.mat[i][j] = matrix[i][j]

    def _add(self, r, c, delta):
        i = r
        while i <= self.n:
            j = c
            while j <= self.m:
                self.t[i][j] += delta
                j += j & -j
            i += i & -i

    def _prefix(self, r, c):
        s, i = 0, r
        while i > 0:
            j = c
            while j > 0:
                s += self.t[i][j]
                j -= j & -j
            i -= i & -i
        return s

    def update(self, row, col, val):
        delta = val - self.mat[row][col]
        self.mat[row][col] = val
        self._add(row + 1, col + 1, delta)

    def sumRegion(self, r1, c1, r2, c2):
        return (self._prefix(r2 + 1, c2 + 1) - self._prefix(r1, c2 + 1)
                - self._prefix(r2 + 1, c1) + self._prefix(r1, c1))


if __name__ == "__main__":
    nm = NumMatrix([
        [3, 0, 1, 4, 2],
        [5, 6, 3, 2, 1],
        [1, 2, 0, 1, 5],
        [4, 1, 0, 1, 7],
        [1, 0, 3, 0, 5],
    ])
    print(nm.sumRegion(2, 1, 4, 3))  # 8
    nm.update(3, 2, 2)
    print(nm.sumRegion(2, 1, 4, 3))  # 10
```

**Complexity.** Build O(R·C·log R·log C) (or O(R·C) with the absorb build). `update` and `sumRegion` each O(log R · log C). Memory O(R·C).

**Follow-ups the interviewer may ask:**
- *"What if the matrix is sparse / coordinates are huge?"* → coordinate-compress, or sweep offline with a 1D BIT.
- *"What if you needed rectangle minimum instead of sum?"* → min is non-invertible; use a 2D segment tree.
- *"What if updates were over whole rectangles?"* → the four-BIT trick.
- *"How would you cap memory for a streaming dashboard?"* → hot-window BIT + cold static summed-area tables.

---

## 5b. Bonus Challenge — Offline "Points in Rectangle" with a Single 1D BIT

> **Problem.** Given `n` points `(x, y)` and `q` queries `(x1, y1, x2, y2)`, return for each query the number of points strictly inside (inclusive). Coordinates up to `10⁹`. Must run in `O((n+q) log n)` and `O(n)` memory — so **no 2D grid**.
>
> **Approach.** Compress y. Split each query into four prefix-count events by inclusion-exclusion. Sort points by x and events by x-bound. Sweep x; insert each point's y-rank into a single 1D BIT as its x passes the bound; answer each event with a `prefix`.

### Python

```python
from bisect import bisect_left, bisect_right

def points_in_rectangles(points, queries):
    ys = sorted({y for _, y in points})
    Y = len(ys)
    tree = [0] * (Y + 1)
    def upd(i):
        while i <= Y:
            tree[i] += 1
            i += i & -i
    def pref(i):
        s = 0
        while i > 0:
            s += tree[i]
            i -= i & -i
        return s
    # events: (x_bound, kind, y_bound, sign, qid); kind 0 = point insert, 1 = query
    events = []
    for x, y in points:
        events.append((x, 0, y, 0, -1))
    for qid, (x1, y1, x2, y2) in enumerate(queries):
        events.append((x2,     1, y2,     +1, qid))
        events.append((x1 - 1, 1, y2,     -1, qid))
        events.append((x2,     1, y1 - 1, -1, qid))
        events.append((x1 - 1, 1, y1 - 1, +1, qid))
    # sort by x_bound; at equal x, process inserts (kind 0) before queries (kind 1)
    events.sort(key=lambda e: (e[0], e[1]))
    ans = [0] * len(queries)
    for xb, kind, yb, sign, qid in events:
        if kind == 0:
            upd(bisect_left(ys, yb) + 1)
        else:
            if yb >= ys[0] if ys else False:
                ans[qid] += sign * pref(bisect_right(ys, yb))
            elif yb >= 0:
                ans[qid] += sign * pref(bisect_right(ys, yb))
    return ans
```

### Go

```go
package main

import "sort"

func pointsInRectangles(points [][2]int, queries [][4]int) []int {
    // compress y
    ysSet := map[int]struct{}{}
    for _, p := range points {
        ysSet[p[1]] = struct{}{}
    }
    ys := make([]int, 0, len(ysSet))
    for y := range ysSet {
        ys = append(ys, y)
    }
    sort.Ints(ys)
    Y := len(ys)
    tree := make([]int, Y+1)
    upd := func(i int) {
        for ; i <= Y; i += i & -i {
            tree[i]++
        }
    }
    pref := func(i int) int {
        s := 0
        for ; i > 0; i -= i & -i {
            s += tree[i]
        }
        return s
    }
    rankUpper := func(v int) int { // count of ys <= v
        return sort.SearchInts(ys, v+1)
    }
    rankInsert := func(v int) int { // 1-indexed position of exact y
        return sort.SearchInts(ys, v) + 1
    }
    type ev struct{ x, kind, y, sign, qid int }
    evs := []ev{}
    for _, p := range points {
        evs = append(evs, ev{p[0], 0, p[1], 0, -1})
    }
    for qid, q := range queries {
        x1, y1, x2, y2 := q[0], q[1], q[2], q[3]
        evs = append(evs, ev{x2, 1, y2, 1, qid})
        evs = append(evs, ev{x1 - 1, 1, y2, -1, qid})
        evs = append(evs, ev{x2, 1, y1 - 1, -1, qid})
        evs = append(evs, ev{x1 - 1, 1, y1 - 1, 1, qid})
    }
    sort.Slice(evs, func(a, b int) bool {
        if evs[a].x != evs[b].x {
            return evs[a].x < evs[b].x
        }
        return evs[a].kind < evs[b].kind
    })
    ans := make([]int, len(queries))
    for _, e := range evs {
        if e.kind == 0 {
            upd(rankInsert(e.y))
        } else {
            ans[e.qid] += e.sign * pref(rankUpper(e.y))
        }
    }
    return ans
}
```

### Java

```java
import java.util.*;

public class OfflineCount {
    public static int[] pointsInRectangles(int[][] points, int[][] queries) {
        TreeSet<Integer> ySet = new TreeSet<>();
        for (int[] p : points) ySet.add(p[1]);
        int[] ys = ySet.stream().mapToInt(Integer::intValue).toArray();
        int Y = ys.length;
        int[] tree = new int[Y + 1];
        // event: {x, kind(0 insert,1 query), y, sign, qid}
        List<int[]> evs = new ArrayList<>();
        for (int[] p : points) evs.add(new int[]{p[0], 0, p[1], 0, -1});
        for (int qid = 0; qid < queries.length; qid++) {
            int x1 = queries[qid][0], y1 = queries[qid][1], x2 = queries[qid][2], y2 = queries[qid][3];
            evs.add(new int[]{x2, 1, y2, 1, qid});
            evs.add(new int[]{x1 - 1, 1, y2, -1, qid});
            evs.add(new int[]{x2, 1, y1 - 1, -1, qid});
            evs.add(new int[]{x1 - 1, 1, y1 - 1, 1, qid});
        }
        evs.sort((a, b) -> a[0] != b[0] ? a[0] - b[0] : a[1] - b[1]);
        int[] ans = new int[queries.length];
        for (int[] e : evs) {
            if (e[1] == 0) {
                int i = lowerBound(ys, e[2]) + 1;
                for (; i <= Y; i += i & -i) tree[i]++;
            } else {
                int idx = upperBound(ys, e[2]); // count ys <= e[2]
                int s = 0;
                for (int i = idx; i > 0; i -= i & -i) s += tree[i];
                ans[e[4]] += e[3] * s;
            }
        }
        return ans;
    }
    private static int lowerBound(int[] a, int v) {
        int lo = 0, hi = a.length;
        while (lo < hi) { int m = (lo + hi) >>> 1; if (a[m] < v) lo = m + 1; else hi = m; }
        return lo;
    }
    private static int upperBound(int[] a, int v) {
        int lo = 0, hi = a.length;
        while (lo < hi) { int m = (lo + hi) >>> 1; if (a[m] <= v) lo = m + 1; else hi = m; }
        return lo;
    }
}
```

**Why this is the senior-favored answer:** it uses `O(n)` memory (a single 1D BIT) instead of `O(n·m)` for a 2D BIT, and runs in `O((n+q) log n)`. Stating "I'd sweep one axis and keep a 1D BIT over the other" before reaching for a 2D structure is a strong senior signal.

---

<a name="tips"></a>
## 6. Interview Tips

- **State the 1-indexing aloud**, in *both* dimensions, when whiteboarding. It is the first thing interviewers check.
- **Write the rectangle inclusion-exclusion explicitly** (`+/−/−/+`) and explain the overlapping-corner intuition.
- **Lead with invertibility.** Say "sum is invertible, so a 2D BIT works; if this were min I'd need a 2D segment tree." It signals you know the boundary.
- **For static counting, propose the sweep + 1D BIT first** (O(n) memory) before a 2D structure. Demonstrates senior judgment about the memory wall.
- **Mention coordinate compression** whenever coordinates could be large or sparse — even if the given example is small.
- **Quote the complexity precisely:** O(log n · log m), and note it can be as low as `popcount(r)·popcount(c)`.
- **Keep `i & -i` (rows) and `j & -j` (columns) visibly separate** in your code; reusing one for the other is the classic silent bug.

**Next step:** [`tasks.md`](./tasks.md) — hands-on coding tasks (5 beginner, 5 intermediate, 5 advanced) in Go, Java, and Python.
