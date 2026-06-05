# 2D Range Queries (2D BIT & 2D Segment Tree) — Practice Tasks

> All tasks should be solved in **Go**, **Java**, and **Python**. Each comes with a reference solution in at least one language; translations to the other two are mechanical. Tasks build from basic 2D BIT mechanics to advanced offline counting and persistent structures. Stress-test every solution against a brute-force O(n·m) (or O(n·q)) reference.

---

## Beginner Tasks

### Task 1 — Basic 2D BIT (point update + rectangle sum)

Implement a class `Fenwick2D(n, m)` with `update(r, c, delta)`, `prefix(r, c)`, and `rect(r1, c1, r2, c2)`, all 1-indexed, in O(log n · log m). Validate against a brute-force prefix-sum table on a random 8×8 grid with 200 mixed operations.

**Go reference:**
```go
package bit2d

type Fenwick2D struct {
    n, m int
    t    [][]int64
}

func New(n, m int) *Fenwick2D {
    t := make([][]int64, n+1)
    for i := range t {
        t[i] = make([]int64, m+1)
    }
    return &Fenwick2D{n, m, t}
}
func (f *Fenwick2D) Update(r, c int, d int64) {
    for i := r; i <= f.n; i += i & -i {
        for j := c; j <= f.m; j += j & -j {
            f.t[i][j] += d
        }
    }
}
func (f *Fenwick2D) Prefix(r, c int) int64 {
    var s int64
    for i := r; i > 0; i -= i & -i {
        for j := c; j > 0; j -= j & -j {
            s += f.t[i][j]
        }
    }
    return s
}
func (f *Fenwick2D) Rect(r1, c1, r2, c2 int) int64 {
    return f.Prefix(r2, c2) - f.Prefix(r1-1, c2) - f.Prefix(r2, c1-1) + f.Prefix(r1-1, c1-1)
}
```

- **Constraints:** 1-indexed; allocate `(n+1)×(m+1)`; use `int64`.
- **Expected:** every `rect` matches a brute-force double-loop sum.
- **Evaluation:** correctness, off-by-one in both dims, complexity.

---

### Task 2 — Build a 2D BIT from a given matrix

Given a 0-indexed `R×C` matrix, build a `Fenwick2D` so that `rect` answers rectangle sums immediately. Use the naive per-cell `update` build first; verify on a 5×5 matrix that `rect(0,0,R-1,C-1)` equals the total of all elements.

**Python reference:**
```python
def build_from_matrix(matrix):
    R, C = len(matrix), len(matrix[0])
    f = Fenwick2D(R, C)              # from Task 1, 1-indexed
    for i in range(R):
        for j in range(C):
            if matrix[i][j]:
                f.update(i + 1, j + 1, matrix[i][j])
    return f

# verify
m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
f = build_from_matrix(m)
assert f.rect(1, 1, 3, 3) == 45
assert f.rect(1, 1, 2, 2) == 1 + 2 + 4 + 5
```

- **Constraints:** translate 0-indexed input to the 1-indexed core.
- **Expected:** full-grid `rect` equals `sum of all cells`.

---

### Task 3 — Rectangle sum query wrapper (LeetCode 308 core)

Wrap a `Fenwick2D` in a `NumMatrix` that keeps the raw matrix so `update(r, c, val)` (set, not add) computes the correct delta `val − old`. Provide `sumRegion(r1, c1, r2, c2)` 0-indexed inclusive.

**Java reference:**
```java
public class NumMatrix {
    private final int n, m;
    private final int[][] mat;
    private final long[][] t;
    public NumMatrix(int[][] matrix) {
        n = matrix.length; m = n > 0 ? matrix[0].length : 0;
        mat = new int[n][m]; t = new long[n + 1][m + 1];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < m; j++) { add(i + 1, j + 1, matrix[i][j]); mat[i][j] = matrix[i][j]; }
    }
    private void add(int r, int c, long d) {
        for (int i = r; i <= n; i += i & -i) for (int j = c; j <= m; j += j & -j) t[i][j] += d;
    }
    private long pref(int r, int c) {
        long s = 0;
        for (int i = r; i > 0; i -= i & -i) for (int j = c; j > 0; j -= j & -j) s += t[i][j];
        return s;
    }
    public void update(int r, int c, int val) { add(r + 1, c + 1, val - mat[r][c]); mat[r][c] = val; }
    public int sumRegion(int r1, int c1, int r2, int c2) {
        return (int)(pref(r2 + 1, c2 + 1) - pref(r1, c2 + 1) - pref(r2 + 1, c1) + pref(r1, c1));
    }
}
```

- **Constraints:** `update` is *set*, not *add*; keep `mat` to find the delta.
- **Expected:** matches LeetCode 308 sample (sumRegion 8, then 10 after an update).

---

### Task 4 — XOR 2D BIT

Modify the 2D BIT to maintain XOR instead of sum: `update(r, c, v)` does `T[i][j] ^= v`, and `rectXor(r1,c1,r2,c2) = prefix(r2,c2) ^ prefix(r1-1,c2) ^ prefix(r2,c1-1) ^ prefix(r1-1,c1-1)` (XOR is its own inverse, so subtraction becomes XOR). Verify against a brute-force XOR over a random 6×6 grid.

**Python reference:**
```python
class XorBIT2D:
    def __init__(self, n, m):
        self.n, self.m = n, m
        self.t = [[0] * (m + 1) for _ in range(n + 1)]
    def update(self, r, c, v):
        i = r
        while i <= self.n:
            j = c
            while j <= self.m:
                self.t[i][j] ^= v
                j += j & -j
            i += i & -i
    def prefix(self, r, c):
        s, i = 0, r
        while i > 0:
            j = c
            while j > 0:
                s ^= self.t[i][j]
                j -= j & -j
            i -= i & -i
        return s
    def rect_xor(self, r1, c1, r2, c2):
        return (self.prefix(r2, c2) ^ self.prefix(r1 - 1, c2)
                ^ self.prefix(r2, c1 - 1) ^ self.prefix(r1 - 1, c1 - 1))
```

- **Constraints:** all four inclusion-exclusion terms combine with XOR, not +/−.
- **Expected:** matches brute-force XOR over arbitrary rectangles.

---

### Task 5 — Count cells touched per operation

Instrument the 2D BIT to count how many cells `update(r, c, _)` and `prefix(r, c)` touch. For a 16×16 grid, print the touch count for `update(15, 15, 1)`, `update(8, 8, 1)`, `prefix(16, 16)`, `prefix(15, 15)`. Confirm empirically that `update(r,c)` touches `(steps for r) × (steps for c)` cells and `prefix(r,c)` touches `popcount(r) × popcount(c)` cells.

**Go reference (sketch):**
```go
func touchUpdate(n, m, r, c int) int {
    cnt := 0
    for i := r; i <= n; i += i & -i {
        for j := c; j <= m; j += j & -j {
            cnt++
        }
    }
    return cnt
}
func touchPrefix(r, c int) int {
    cnt := 0
    for i := r; i > 0; i -= i & -i {
        for j := c; j > 0; j -= j & -j {
            cnt++
        }
    }
    return cnt
}
// prefix(15,15): popcount(15)=4, so 4*4 = 16 cells
// prefix(16,16): popcount(16)=1, so 1*1 = 1 cell
```

- **Constraints:** no functional change, just instrumentation.
- **Expected:** counts match the bit-count predictions.

---

## Intermediate Tasks

### Task 6 — Rectangle range-update + rectangle range-query (four 2D BITs)

Implement `RangeFenwick2D(n, m)` with `rectUpdate(r1, c1, r2, c2, v)` (add `v` to every cell in the rectangle) and `rectSum(r1, c1, r2, c2)`, both O(log n · log m). Use four 2D BITs with weights `1, (x−1), (y−1), (x−1)(y−1)`. Verify against a brute-force grid on n=m=12 with mixed rectangle updates and queries.

**Python reference:** see `middle.md` section 7.1 (`RangeFenwick2D`).

- **Constraints:** four corner deltas per update (signs `+,−,−,+`); exact weight formulas.
- **Expected:** matches brute-force after any sequence of rectangle updates.
- **Test:** `rectUpdate(2,2,5,5, 3)` then `rectSum(1,1,12,12)` == `3 * 16` (16 cells affected).

---

### Task 7 — Coordinate compression + 2D BIT

Given up to 2000 points with coordinates up to 10⁹ and up to 2000 rectangle-count queries, compress both axes, build a 2D BIT over the compressed grid, and answer each "how many points in `[x1,x2]×[y1,y2]`?" query. Verify against brute-force on a small instance.

**Python reference (sketch):**
```python
from bisect import bisect_left, bisect_right

def count_in_rects(points, queries):
    xs = sorted({x for x, _ in points})
    ys = sorted({y for _, y in points})
    X, Y = len(xs), len(ys)
    t = [[0] * (Y + 1) for _ in range(X + 1)]
    def upd(r, c):
        i = r
        while i <= X:
            j = c
            while j <= Y:
                t[i][j] += 1
                j += j & -j
            i += i & -i
    def pref(r, c):
        s, i = 0, r
        while i > 0:
            j = c
            while j > 0:
                s += t[i][j]; j -= j & -j
            i -= i & -i
        return s
    for x, y in points:
        upd(bisect_left(xs, x) + 1, bisect_left(ys, y) + 1)
    def rx(v): return bisect_right(xs, v)     # count of xs <= v
    def ry(v): return bisect_right(ys, v)
    out = []
    for x1, y1, x2, y2 in queries:
        a, b = rx(x2), ry(y2)
        c, d = rx(x1 - 1), ry(y1 - 1)
        out.append(pref(a, b) - pref(c, b) - pref(a, d) + pref(c, d))
    return out
```

- **Constraints:** query bounds map via `bisect_right` (count of compressed coords ≤ bound).
- **Expected:** matches brute-force point-in-rectangle counts.

---

### Task 8 — Offline 2D counting via sweep + 1D BIT

Re-solve Task 7's "count points in rectangle" for a *static* point set, but use the memory-frugal **offline sweep + single 1D BIT** (O(n) memory). Split each rectangle into four prefix queries, sort by x-bound, sweep, insert compressed y-ranks into a 1D BIT. Compare memory and timing with Task 7's 2D BIT.

**Python reference:** see `middle.md` section 7.2 (`count_points_in_rectangles`).

- **Constraints:** one 1D BIT only; events sorted by x-bound.
- **Expected:** identical answers to Task 7, with O(n) instead of O(X·Y) memory.
- **Discussion:** note the crossover where the sweep wins decisively (large compressed grids).

---

### Task 9 — Merge-sort tree (online rectangle counting)

Build a merge-sort tree over the x-sorted points (each node stores the sorted y-list of its x-range) and answer **online** "count points with x-index in `[xl,xr]` and y in `[yl,yr]`" in O(log² n). Verify against brute-force on n=200 points and 500 queries.

**Python reference:** see `middle.md` section 7.3 (`MergeSortTree`).

- **Constraints:** node lists must be sorted (built by merging children).
- **Expected:** matches brute-force; query is O(log² n).
- **Note:** here `xl,xr` are *positions* in x-sorted order; map raw x-ranges to positions via binary search.

---

### Task 10 — Rectangle mean and variance with two 2D BITs

Maintain two 2D BITs — one over values, one over squared values — to answer "mean and variance of the cells in `[r1..r2]×[c1..c2]`" under point updates. Use `Var = E[X²] − E[X]²`, where `E[X] = sumRect / count` and `E[X²] = sqSumRect / count`, with `count = (r2−r1+1)(c2−c1+1)`. Verify against brute-force statistics on a 10×10 grid.

**Go reference (sketch):**
```go
type Stats2D struct {
    sum  *Fenwick2D   // from Task 1
    sqr  *Fenwick2D
}
func NewStats(n, m int) *Stats2D { return &Stats2D{New(n, m), New(n, m)} }
func (s *Stats2D) Update(r, c int, delta int64) {
    // delta is the change in value; squared term must use old/new values
    // For a SET operation, pass (newVal-oldVal) for sum and (newVal^2-oldVal^2) for sqr.
}
func (s *Stats2D) MeanVar(r1, c1, r2, c2 int) (mean, variance float64) {
    cnt := float64((r2 - r1 + 1) * (c2 - c1 + 1))
    sm := float64(s.sum.Rect(r1, c1, r2, c2))
    sq := float64(s.sqr.Rect(r1, c1, r2, c2))
    mean = sm / cnt
    variance = sq/cnt - mean*mean
    return
}
```

- **Constraints:** the squared-value BIT must update with `newVal² − oldVal²`, not `delta²`.
- **Expected:** mean and variance match `numpy`-style brute force within float tolerance.

---

## Advanced Tasks

### Task 11 — 2D segment tree for rectangle maximum (point update)

Implement a segment-tree-of-segment-trees supporting `update(r, c, val)` (set) and `rectMax(r1, c1, r2, c2)` over an `n×m` grid, both O(log n · log m). Verify against brute-force max on n=m=16. This is the non-invertible case a BIT cannot handle.

**Approach.** Outer segment tree over rows; each outer node owns an inner segment tree over columns storing the max of its rows×columns block. Point update descends O(log n) outer nodes, updating each inner tree in O(log m) and recomputing internal-node merges along the path.

**Python reference (sketch):**
```python
NEG = float('-inf')

class SegTree2D:
    def __init__(self, n, m):
        self.n, self.m = n, m
        self.tree = [[NEG] * (4 * m) for _ in range(4 * n)]
    def _upd_col(self, vr, lor, hir, vc, loc, hic, r, c, val, leafRow):
        if loc == hic:
            if leafRow:
                self.tree[vr][vc] = val
            else:
                self.tree[vr][vc] = max(self.tree[2 * vr][vc], self.tree[2 * vr + 1][vc])
            return
        mc = (loc + hic) // 2
        if c <= mc: self._upd_col(vr, lor, hir, 2 * vc, loc, mc, r, c, val, leafRow)
        else:       self._upd_col(vr, lor, hir, 2 * vc + 1, mc + 1, hic, r, c, val, leafRow)
        self.tree[vr][vc] = max(self.tree[vr][2 * vc], self.tree[vr][2 * vc + 1])
    def _upd_row(self, vr, lor, hir, r, c, val):
        if lor != hir:
            mr = (lor + hir) // 2
            if r <= mr: self._upd_row(2 * vr, lor, mr, r, c, val)
            else:       self._upd_row(2 * vr + 1, mr + 1, hir, r, c, val)
        self._upd_col(vr, lor, hir, 1, 0, self.m - 1, r, c, val, lor == hir)
    def update(self, r, c, val):
        self._upd_row(1, 0, self.n - 1, r, c, val)
    def _q_col(self, vr, vc, loc, hic, cl, cr):
        if cr < loc or hic < cl: return NEG
        if cl <= loc and hic <= cr: return self.tree[vr][vc]
        mc = (loc + hic) // 2
        return max(self._q_col(vr, 2 * vc, loc, mc, cl, cr),
                   self._q_col(vr, 2 * vc + 1, mc + 1, hic, cl, cr))
    def _q_row(self, vr, lor, hir, rl, rr, cl, cr):
        if rr < lor or hir < rl: return NEG
        if rl <= lor and hir <= rr: return self._q_col(vr, 1, 0, self.m - 1, cl, cr)
        mr = (lor + hir) // 2
        return max(self._q_row(2 * vr, lor, mr, rl, rr, cl, cr),
                   self._q_row(2 * vr + 1, mr + 1, hir, rl, rr, cl, cr))
    def rect_max(self, r1, c1, r2, c2):
        return self._q_row(1, 0, self.n - 1, r1, r2, c1, c2)
```

- **Constraints:** internal outer nodes' inner trees are the pointwise max-merge of children.
- **Expected:** matches brute-force rectangle max under updates.

---

### Task 12 — Persistent segment tree for online rectangle counts

Build a persistent segment tree over compressed y, versioned along x-sorted points. Answer "count points with `x ≤ X` and `y ∈ [y1,y2]`" online via a single version query, and "x ∈ [x1,x2]" via the difference of two versions. Memory O(n log m). Verify against brute-force on n=300.

**Approach.** Each insert path-copies O(log m) nodes (storing counts). `version[k]` = tree after first `k` points in x-order. Rectangle count = `query(version[x2], y1, y2) − query(version[x1−1], y1, y2)`.

- **Constraints:** nodes store counts (a group) so version subtraction is valid.
- **Expected:** matches brute-force; each query O(log m).
- **Bonus:** add "k-th smallest y among x ≤ X" by descending two versions in lockstep.

---

### Task 13 — Fully dynamic 2D dominance (BIT of order-statistics)

Support `insert(x, y)`, `remove(x, y)`, and `countDominated(x, y)` (= points with `x' ≤ x` and `y' ≤ y`) fully online, when all coordinates are known in advance (offline the coordinates, online the operations). Use a 1D BIT over compressed x where each cell holds an inner 1D BIT over compressed y. O(log n · log m) per op. Verify against brute-force.

**Approach.** Pre-scan all operations to collect coordinates; compress. Outer BIT over x; `T[i]` is an inner BIT over y. `insert(x,y)` walks the x-up-ladder; at each, walks the y-up-ladder incrementing. `countDominated` walks both down-ladders summing.

- **Constraints:** coordinates compressed up front from the full op stream.
- **Expected:** matches brute-force dominance counts under insert/remove.

---

### Task 14 — Hot-window BIT + cold static SAT

Simulate the production pattern: a stream of `(r, c, +1)` events partitioned into time windows. Keep the current window in a mutable 2D BIT; when a window seals, freeze it into a static summed-area table (O(1) query). A `rectSum(r1,c1,r2,c2)` over the last K windows sums K cold SATs (O(1) each) plus the live BIT (O(log·log)). Verify the combined total equals a brute-force over all events.

**Approach.** On roll-over: compute the SAT from the BIT's underlying matrix (or maintain the raw matrix alongside), store it immutably, reset the BIT. Query fans out to cold SATs + hot BIT.

- **Constraints:** mutable memory must stay bounded to one window.
- **Expected:** combined query equals brute-force over the full event history.

---

### Task 15 — Benchmark: 2D BIT vs dense 2D segment tree vs sweep

At `n = m = 2000` (int64), benchmark: (a) 2D BIT point-update + rect-sum; (b) dense 2D segment tree sum; (c) the offline sweep + 1D BIT equivalent for a static counting workload. Report wall time and peak memory for each. Confirm the expected ranking: sweep cheapest memory, BIT ~16× lighter than the dense segment tree, segment tree slowest.

**Go benchmark (sketch):**
```go
func BenchmarkBIT2D(b *testing.B) {
    n, m := 2000, 2000
    f := New(n, m)
    rng := rand.New(rand.NewSource(1))
    b.ResetTimer()
    var sink int64
    for i := 0; i < 1_000_000; i++ {
        if rng.Intn(2) == 0 {
            f.Update(rng.Intn(n)+1, rng.Intn(m)+1, int64(rng.Intn(100)))
        } else {
            r1, c1 := rng.Intn(n)+1, rng.Intn(m)+1
            sink += f.Rect(r1, c1, n, m)
        }
    }
    _ = sink
}
```

- **Constraints:** identical workloads; measure memory with `runtime.ReadMemStats` / `-Xlog:gc` / `tracemalloc`.
- **Expected:** memory: sweep ≪ BIT ≪ dense segment tree (~16×); BIT fastest among online structures.
- **Deliverable:** a short table of your measured numbers as a comment in the source.

---

## Benchmark Task

> Compare a 2D BIT's point-update + rectangle-sum throughput across all three languages at `n = m = 1000`.

#### Go
```go
package main

import (
    "fmt"
    "math/rand"
    "time"
)

func main() {
    n, m := 1000, 1000
    f := New(n, m) // from Task 1
    rng := rand.New(rand.NewSource(42))
    ops := 2_000_000
    start := time.Now()
    var sink int64
    for i := 0; i < ops; i++ {
        if i&1 == 0 {
            f.Update(rng.Intn(n)+1, rng.Intn(m)+1, int64(rng.Intn(100)))
        } else {
            sink += f.Rect(rng.Intn(n)+1, rng.Intn(m)+1, n, m)
        }
    }
    fmt.Printf("Go: %d ops in %v (sink=%d)\n", ops, time.Since(start), sink)
}
```

#### Java
```java
import java.util.Random;

public class Bench2D {
    public static void main(String[] args) {
        int n = 1000, m = 1000, ops = 2_000_000;
        Fenwick2D f = new Fenwick2D(n, m); // from Task 1
        Random rng = new Random(42);
        long start = System.nanoTime(), sink = 0;
        for (int i = 0; i < ops; i++) {
            if ((i & 1) == 0)
                f.update(rng.nextInt(n) + 1, rng.nextInt(m) + 1, rng.nextInt(100));
            else
                sink += f.rect(rng.nextInt(n) + 1, rng.nextInt(m) + 1, n, m);
        }
        System.out.printf("Java: %d ops in %.3f ms (sink=%d)%n",
            ops, (System.nanoTime() - start) / 1e6, sink);
    }
}
```

#### Python
```python
import random, time

def main():
    n, m, ops = 1000, 1000, 200_000   # fewer ops — Python is slower
    f = Fenwick2D(n, m)               # from Task 1
    random.seed(42)
    start = time.perf_counter()
    sink = 0
    for i in range(ops):
        if i & 1 == 0:
            f.update(random.randint(1, n), random.randint(1, m), random.randint(0, 99))
        else:
            sink += f.rect(random.randint(1, n), random.randint(1, m), n, m)
    print(f"Python: {ops} ops in {time.perf_counter() - start:.3f}s (sink={sink})")

if __name__ == "__main__":
    main()
```

Run all three, normalize by op count, and report the per-op cost. Expect Go and Java within a small factor; Python an order of magnitude slower (interpreter overhead on the nested loop). Document your numbers as comments.

---

## Wrap-up

After these fifteen tasks you should have:

- A correct, tested 2D BIT (sum and XOR), built naively and from a matrix.
- The four-BIT rectangle range-update / range-query trick.
- Coordinate compression and the memory-frugal offline sweep + 1D BIT.
- A merge-sort tree and a persistent segment tree for online 2D counting.
- The non-invertible case (2D segment tree for rectangle max) the BIT cannot do.
- The fully dynamic dominance structure and the production hot/cold pattern.
- Measured evidence of the memory hierarchy: sweep ≪ BIT ≪ dense 2D segment tree.

That covers the full operational range of 2D range structures. Revisit `senior.md` and `professional.md` for the system-design and proof context behind these implementations.
