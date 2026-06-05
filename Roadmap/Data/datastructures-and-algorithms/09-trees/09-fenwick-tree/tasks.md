# Fenwick Tree — Tasks

> **Audience:** Anyone who has read at least `junior.md` and `middle.md`. The tasks build sequentially from basic to advanced. Each comes with a full reference solution in Go, Java, or Python (whichever is most idiomatic for the task; translations are trivial).

---

## Task List

1. [Implement basic BIT (update, prefix, rangeSum)](#task1)
2. [Inversion count using BIT + coordinate compression](#task2)
3. [Range update + point query](#task3)
4. [Range update + range query using two BITs](#task4)
5. [2D BIT — point update + rectangle sum](#task5)
6. [Kth smallest using binary lifting on BIT — O(log n)](#task6)
7. [XOR-BIT](#task7)
8. [Offline range queries sorted by key](#task8)
9. [Online median maintenance with a BIT](#task9)
10. [Benchmark BIT vs segment tree at n = 10^6](#task10)

---

<a name="task1"></a>
## Task 1 — Basic BIT

**Goal.** Build the foundation. Implement a class `Fenwick` with `update(i, delta)`, `prefix(i)`, `rangeSum(l, r)`. 1-indexed. Cover with unit tests that compare against an O(n²) brute-force prefix recomputation on random arrays of length 100.

**Go reference solution:**
```go
package fenwick

type Fenwick struct {
    n    int
    tree []int64
}
func New(n int) *Fenwick { return &Fenwick{n: n, tree: make([]int64, n+1)} }
func (f *Fenwick) Update(i int, d int64) {
    for ; i <= f.n; i += i & -i { f.tree[i] += d }
}
func (f *Fenwick) Prefix(i int) int64 {
    var s int64
    for ; i > 0; i -= i & -i { s += f.tree[i] }
    return s
}
func (f *Fenwick) RangeSum(l, r int) int64 { return f.Prefix(r) - f.Prefix(l-1) }
```

**Test:**
```go
func TestFenwickAgainstBrute(t *testing.T) {
    rng := rand.New(rand.NewSource(1))
    n := 100
    arr := make([]int64, n+1)
    f := New(n)
    for trials := 0; trials < 5000; trials++ {
        op := rng.Intn(2)
        if op == 0 {
            i := rng.Intn(n) + 1
            d := rng.Int63n(200) - 100
            arr[i] += d
            f.Update(i, d)
        } else {
            l := rng.Intn(n) + 1
            r := l + rng.Intn(n-l+1)
            var brute int64
            for k := l; k <= r; k++ {
                brute += arr[k]
            }
            if got := f.RangeSum(l, r); got != brute {
                t.Fatalf("trial %d: got %d, brute %d", trials, got, brute)
            }
        }
    }
}
```

---

<a name="task2"></a>
## Task 2 — Inversion Count

**Goal.** Given `[5, 9, 1, 4, 6, 2]`, count pairs `(i, j)` with `i < j` and `A[i] > A[j]`. Expected answer: 9.

**Python reference solution:**
```python
def inversions(a):
    sorted_vals = sorted(set(a))
    rank = {v: i + 1 for i, v in enumerate(sorted_vals)}
    n = len(sorted_vals)
    tree = [0] * (n + 1)
    def upd(i):
        while i <= n:
            tree[i] += 1
            i += i & -i
    def pref(i):
        s = 0
        while i > 0:
            s += tree[i]
            i -= i & -i
        return s
    inv = 0
    seen = 0
    for v in a:
        r = rank[v]
        inv += seen - pref(r)
        upd(r)
        seen += 1
    return inv

assert inversions([5, 9, 1, 4, 6, 2]) == 9
```

**Verification.** Brute-force `O(n²)`: count pairs explicitly. Match.

---

<a name="task3"></a>
## Task 3 — Range Update + Point Query (Difference BIT)

**Goal.** Implement `rangeAdd(l, r, v)` and `point(i)`. Test that after `rangeAdd(2, 5, 7)` and `rangeAdd(4, 6, -3)`, `point(4) == 4` (7 - 3), `point(7) == 0`, `point(2) == 7`, `point(6) == -3` (the -3 added at 4..6 minus nothing because the +7 update only covers 2..5).

Wait, let me redo: initial all zeros.
- `rangeAdd(2, 5, 7)` → A[2..5] += 7.
- `rangeAdd(4, 6, -3)` → A[4..6] += -3.
- After both: A[1]=0, A[2]=7, A[3]=7, A[4]=4, A[5]=4, A[6]=-3, A[7]=0.

**Python solution:**
```python
class DiffBIT:
    def __init__(self, n):
        self.n = n + 1
        self.tree = [0] * (self.n + 1)
    def _upd(self, i, d):
        while i <= self.n:
            self.tree[i] += d
            i += i & -i
    def range_add(self, l, r, v):
        self._upd(l, v)
        self._upd(r + 1, -v)
    def point(self, i):
        s = 0
        while i > 0:
            s += self.tree[i]
            i -= i & -i
        return s

d = DiffBIT(10)
d.range_add(2, 5, 7)
d.range_add(4, 6, -3)
assert d.point(1) == 0
assert d.point(2) == 7
assert d.point(4) == 4
assert d.point(6) == -3
assert d.point(7) == 0
```

---

<a name="task4"></a>
## Task 4 — Range Update + Range Query

**Goal.** Implement `rangeUpdate(l, r, v)` and `rangeSum(l, r)` using two BITs. Verify on n=10 with sequence of mixed operations.

**Java solution** (see also `interview.md` task 10):
```java
public final class RangeBoth {
    private final int n;
    private final long[] b1, b2;
    public RangeBoth(int n) {
        this.n = n + 1;
        b1 = new long[this.n + 1];
        b2 = new long[this.n + 1];
    }
    private void upd(long[] t, int i, long d) {
        for (; i <= n; i += i & -i) t[i] += d;
    }
    private long pref(long[] t, int i) {
        long s = 0;
        for (; i > 0; i -= i & -i) s += t[i];
        return s;
    }
    public void rangeUpdate(int l, int r, long v) {
        upd(b1, l, v);            upd(b1, r + 1, -v);
        upd(b2, l, v * (l - 1));  upd(b2, r + 1, -v * r);
    }
    private long prefixSum(int i) {
        return (long) i * pref(b1, i) - pref(b2, i);
    }
    public long rangeSum(int l, int r) {
        return prefixSum(r) - prefixSum(l - 1);
    }
}
```

**Test:**
```
Initial A = [0]*10
rangeUpdate(2, 6, 3) → A[2..6] += 3
rangeUpdate(4, 8, 5) → A[4..8] += 5
expect rangeSum(1, 10) == 3*5 + 5*5 = 15 + 25 = 40
expect rangeSum(4, 6) == (3+5)*3 = 24
expect rangeSum(7, 8) == 5*2 = 10
```

---

<a name="task5"></a>
## Task 5 — 2D BIT

**Goal.** Implement `update(r, c, delta)` and `rect(r1, c1, r2, c2)`. Test on a 4×4 grid with 10 random updates.

**Python solution:**
```python
class BIT2D:
    def __init__(self, n, m):
        self.n, self.m = n, m
        self.t = [[0] * (m + 1) for _ in range(n + 1)]
    def update(self, r, c, d):
        i = r
        while i <= self.n:
            j = c
            while j <= self.m:
                self.t[i][j] += d
                j += j & -j
            i += i & -i
    def prefix(self, r, c):
        s = 0; i = r
        while i > 0:
            j = c
            while j > 0:
                s += self.t[i][j]
                j -= j & -j
            i -= i & -i
        return s
    def rect(self, r1, c1, r2, c2):
        return (self.prefix(r2, c2) - self.prefix(r1 - 1, c2)
              - self.prefix(r2, c1 - 1) + self.prefix(r1 - 1, c1 - 1))
```

**Test against brute-force 2D scan.**

---

<a name="task6"></a>
## Task 6 — Kth Smallest via Binary Lifting

**Goal.** Implement `insert(x)`, `remove(x)`, `kth(k)` on values in `[1, 10^6]`. Each operation O(log V). Verify `kth(1)` is min and `kth(size)` is max.

**Go solution:** see `interview.md` task 9.

**Stress test (Python sketch):**
```python
class Kth:
    def __init__(self, V):
        self.V = V
        self.log = 0
        while (1 << (self.log + 1)) <= V:
            self.log += 1
        self.tree = [0] * (V + 1)
    def update(self, x, d):
        while x <= self.V:
            self.tree[x] += d
            x += x & -x
    def kth(self, k):
        idx = 0
        for b in range(self.log, -1, -1):
            nxt = idx + (1 << b)
            if nxt <= self.V and self.tree[nxt] < k:
                idx = nxt
                k -= self.tree[nxt]
        return idx + 1

ks = Kth(100)
for v in [10, 30, 20, 15, 80, 50]:
    ks.update(v, 1)
assert ks.kth(1) == 10
assert ks.kth(3) == 20
assert ks.kth(6) == 80
ks.update(10, -1)
assert ks.kth(1) == 15
```

---

<a name="task7"></a>
## Task 7 — XOR-BIT

**Goal.** Support `update(i, v)` (XOR `v` into A[i]) and `rangeXor(l, r)`. Test on arr `[3, 5, 9, 2, 8, 4]` with several updates and verify against brute-force XOR over ranges.

**Python solution:**
```python
class XorBIT:
    def __init__(self, n):
        self.n = n
        self.tree = [0] * (n + 1)
    def update(self, i, v):
        while i <= self.n:
            self.tree[i] ^= v
            i += i & -i
    def prefix(self, i):
        s = 0
        while i > 0:
            s ^= self.tree[i]
            i -= i & -i
        return s
    def range_xor(self, l, r):
        return self.prefix(r) ^ self.prefix(l - 1)

arr = [3, 5, 9, 2, 8, 4]
n = len(arr)
b = XorBIT(n)
for i, v in enumerate(arr, 1):
    b.update(i, v)
# rangeXor(2, 5) = 5 ^ 9 ^ 2 ^ 8 = ?
expected = 0
for v in arr[1:5]:
    expected ^= v
assert b.range_xor(2, 5) == expected
```

---

<a name="task8"></a>
## Task 8 — Offline Range Queries Sorted by Key

**Goal.** Given an array `A[1..n]` and `q` queries each asking "how many elements in `A[l..r]` have value `<= V`?", answer all queries in O((n + q) log n).

**Approach.** Sort queries by `V`. Sort `(value, index)` pairs by value. Sweep through values in ascending order; insert each into a BIT keyed by index. When a query's `V` is reached, answer it as `bit.rangeSum(l, r)`.

**Python solution:**
```python
def offline_count_le(a, queries):
    # queries: list of (l, r, V). Return list of counts.
    n = len(a)
    tree = [0] * (n + 1)
    def upd(i, d):
        while i <= n: tree[i] += d; i += i & -i
    def pref(i):
        s = 0
        while i > 0: s += tree[i]; i -= i & -i
        return s
    indexed = sorted(range(n), key=lambda i: a[i])
    qs = sorted(range(len(queries)), key=lambda i: queries[i][2])
    out = [0] * len(queries)
    p = 0
    for qi in qs:
        l, r, V = queries[qi]
        while p < n and a[indexed[p]] <= V:
            upd(indexed[p] + 1, 1)
            p += 1
        out[qi] = pref(r + 1) - pref(l)
    return out
```

**Test** on small arrays and compare with brute-force.

---

<a name="task9"></a>
## Task 9 — Online Median Maintenance with a BIT

**Goal.** Support `insert(x)` and `median()` on a stream of integers, with values in a known range `[1, V]`. Each operation O(log V).

**Approach.** Maintain a BIT keyed by value. `insert(x)` does `update(x, +1)`. `median()` finds the kth smallest where `k = (count + 1) / 2` (lower median for even counts) via binary lifting (task 6).

**Python solution:**
```python
class Median:
    def __init__(self, V):
        self.V = V
        self.log = 0
        while (1 << (self.log + 1)) <= V:
            self.log += 1
        self.tree = [0] * (V + 1)
        self.count = 0
    def insert(self, x):
        self.count += 1
        while x <= self.V:
            self.tree[x] += 1
            x += x & -x
    def kth(self, k):
        idx = 0
        for b in range(self.log, -1, -1):
            nxt = idx + (1 << b)
            if nxt <= self.V and self.tree[nxt] < k:
                idx = nxt
                k -= self.tree[nxt]
        return idx + 1
    def median(self):
        if self.count == 0:
            return None
        return self.kth((self.count + 1) // 2)
```

**Test on a sequence of insertions** and compare with `statistics.median` on accumulated lists.

---

<a name="task10"></a>
## Task 10 — Benchmark BIT vs Segment Tree

**Goal.** At `n = 10^6` with 10 million mixed update + rangeSum operations, measure wall time for a BIT versus a segment tree. Both should support the same operations.

**Setup (Go):**
```go
func BenchmarkBIT(b *testing.B) {
    n := 1_000_000
    f := New(n)
    rng := rand.New(rand.NewSource(42))
    ops := make([][3]int, 10_000_000)
    for i := range ops {
        if rng.Intn(2) == 0 {
            ops[i] = [3]int{0, rng.Intn(n) + 1, rng.Intn(100)}
        } else {
            l := rng.Intn(n) + 1
            r := l + rng.Intn(n-l+1)
            ops[i] = [3]int{1, l, r}
        }
    }
    b.ResetTimer()
    var sink int64
    for _, op := range ops {
        if op[0] == 0 {
            f.Update(op[1], int64(op[2]))
        } else {
            sink += f.RangeSum(op[1], op[2])
        }
    }
    _ = sink
}
```

**Segment tree benchmark** is symmetric. Run both with `go test -bench .` and report the ratio. Expected: Fenwick is 2–3× faster (see `middle.md` section 8). Document your numbers as a comment in the source file.

---

## Wrap-up

After completing these ten tasks you should have:

- Internalized the 6-line update and 6-line prefix.
- Built and stress-tested every standard variant (1D, 2D, range-range, XOR).
- Implemented binary lifting on BIT for O(log n) order statistics.
- Personally measured why BITs beat segment trees on invertible-aggregate workloads.

That covers the full operational range of the Fenwick tree. Continue with `senior.md` and `professional.md` for application context and systems engineering.
