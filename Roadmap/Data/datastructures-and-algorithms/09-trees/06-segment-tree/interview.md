# Segment Tree — Interview Problems

> **Audience:** Candidates preparing for LeetCode Hard, Codeforces Div. 1, and senior FAANG interviews. Solutions in Go, Java, Python with complexity analysis.

These ten problems exercise every segment tree skill from `junior.md` through `middle.md`: point/range updates, lazy propagation, coordinate compression, merge-sort trees, 2D, and sweep-line. Solve all ten and you will recognize the segment-tree shape of any new problem you encounter.

---

## Table of Contents

1. [LC 307 — Range Sum Query, Mutable](#lc-307)
2. [LC 308 — Range Sum Query 2D, Mutable](#lc-308)
3. [LC 315 — Count of Smaller Numbers After Self](#lc-315)
4. [LC 327 — Count of Range Sum](#lc-327)
5. [LC 493 — Reverse Pairs](#lc-493)
6. [LC 699 — Falling Squares](#lc-699)
7. [LC 715 — Range Module](#lc-715)
8. [LC 218 — Skyline (Segment Tree Solution)](#lc-218)
9. [LC 732 — My Calendar III](#lc-732)
10. [LC 850 — Rectangle Area II](#lc-850)

---

<a name="lc-307"></a>
## 1. LC 307 — Range Sum Query, Mutable

> Given an array `nums`, support `update(i, val)` and `sumRange(l, r)`.

The canonical introduction. Build a sum segment tree.

### Python
```python
class NumArray:
    def __init__(self, nums):
        self.n = len(nums)
        self.t = [0] * (4 * self.n)
        self._build(1, 0, self.n - 1, nums)
    def _build(self, v, lo, hi, a):
        if lo == hi: self.t[v] = a[lo]; return
        m = (lo + hi) // 2
        self._build(2*v, lo, m, a); self._build(2*v+1, m+1, hi, a)
        self.t[v] = self.t[2*v] + self.t[2*v+1]
    def update(self, i, val):
        self._upd(1, 0, self.n - 1, i, val)
    def _upd(self, v, lo, hi, i, val):
        if lo == hi: self.t[v] = val; return
        m = (lo + hi) // 2
        if i <= m: self._upd(2*v, lo, m, i, val)
        else:      self._upd(2*v+1, m+1, hi, i, val)
        self.t[v] = self.t[2*v] + self.t[2*v+1]
    def sumRange(self, l, r):
        return self._q(1, 0, self.n - 1, l, r)
    def _q(self, v, lo, hi, l, r):
        if r < lo or hi < l: return 0
        if l <= lo and hi <= r: return self.t[v]
        m = (lo + hi) // 2
        return self._q(2*v, lo, m, l, r) + self._q(2*v+1, m+1, hi, l, r)
```

### Go
```go
type NumArray struct{ n int; t []int }
func Constructor(nums []int) NumArray {
    n := len(nums); t := make([]int, 4*n)
    var build func(v, lo, hi int)
    build = func(v, lo, hi int) {
        if lo == hi { t[v] = nums[lo]; return }
        m := (lo + hi) / 2
        build(2*v, lo, m); build(2*v+1, m+1, hi)
        t[v] = t[2*v] + t[2*v+1]
    }
    if n > 0 { build(1, 0, n-1) }
    return NumArray{n, t}
}
func (na *NumArray) Update(i, val int) {
    var u func(v, lo, hi int)
    u = func(v, lo, hi int) {
        if lo == hi { na.t[v] = val; return }
        m := (lo + hi) / 2
        if i <= m { u(2*v, lo, m) } else { u(2*v+1, m+1, hi) }
        na.t[v] = na.t[2*v] + na.t[2*v+1]
    }
    u(1, 0, na.n-1)
}
func (na *NumArray) SumRange(l, r int) int {
    var q func(v, lo, hi int) int
    q = func(v, lo, hi int) int {
        if r < lo || hi < l { return 0 }
        if l <= lo && hi <= r { return na.t[v] }
        m := (lo + hi) / 2
        return q(2*v, lo, m) + q(2*v+1, m+1, hi)
    }
    return q(1, 0, na.n-1)
}
```

### Java
```java
class NumArray {
    int n; int[] t;
    public NumArray(int[] nums) {
        n = nums.length; t = new int[4 * n];
        if (n > 0) build(1, 0, n - 1, nums);
    }
    void build(int v, int lo, int hi, int[] a) {
        if (lo == hi) { t[v] = a[lo]; return; }
        int m = (lo + hi) >>> 1;
        build(2*v, lo, m, a); build(2*v+1, m+1, hi, a);
        t[v] = t[2*v] + t[2*v+1];
    }
    public void update(int i, int val) { upd(1, 0, n - 1, i, val); }
    void upd(int v, int lo, int hi, int i, int val) {
        if (lo == hi) { t[v] = val; return; }
        int m = (lo + hi) >>> 1;
        if (i <= m) upd(2*v, lo, m, i, val); else upd(2*v+1, m+1, hi, i, val);
        t[v] = t[2*v] + t[2*v+1];
    }
    public int sumRange(int l, int r) { return q(1, 0, n - 1, l, r); }
    int q(int v, int lo, int hi, int l, int r) {
        if (r < lo || hi < l) return 0;
        if (l <= lo && hi <= r) return t[v];
        int m = (lo + hi) >>> 1;
        return q(2*v, lo, m, l, r) + q(2*v+1, m+1, hi, l, r);
    }
}
```

**Complexity:** build O(n), update O(log n), query O(log n).

---

<a name="lc-308"></a>
## 2. LC 308 — Range Sum Query 2D, Mutable

Build a 2D segment tree (segment tree of segment trees). Query and update each in O(log² n).

### Python (compact 2D BIT — equivalent asymptotics, simpler)
```python
class NumMatrix:
    def __init__(self, matrix):
        self.R, self.C = len(matrix), len(matrix[0])
        self.bit  = [[0]*(self.C + 1) for _ in range(self.R + 1)]
        self.orig = [[0]*self.C       for _ in range(self.R)]
        for i in range(self.R):
            for j in range(self.C):
                self.update(i, j, matrix[i][j])
    def update(self, r, c, val):
        delta = val - self.orig[r][c]
        self.orig[r][c] = val
        i = r + 1
        while i <= self.R:
            j = c + 1
            while j <= self.C:
                self.bit[i][j] += delta
                j += j & -j
            i += i & -i
    def _pref(self, r, c):
        s, i = 0, r + 1
        while i > 0:
            j = c + 1
            while j > 0:
                s += self.bit[i][j]
                j -= j & -j
            i -= i & -i
        return s
    def sumRegion(self, r1, c1, r2, c2):
        return (self._pref(r2, c2) - self._pref(r1 - 1, c2)
              - self._pref(r2, c1 - 1) + self._pref(r1 - 1, c1 - 1))
```

A pure 2D segment tree in Go/Java is twice the code; the 2D BIT solution is canonical and matches the O(log² n) bound. See `tasks.md` task 7 for the full 2D segment tree.

**Complexity:** update O(log R · log C), query O(log R · log C), memory O(R · C).

---

<a name="lc-315"></a>
## 3. LC 315 — Count of Smaller Numbers After Self

> For each index `i`, count how many `j > i` have `nums[j] < nums[i]`.

Process from **right to left**. Maintain a segment tree indexed by **compressed** values; for each `nums[i]`, query `count_less(nums[i])`, then insert `nums[i]`.

### Python
```python
from bisect import bisect_left

class Solution:
    def countSmaller(self, nums):
        sorted_vals = sorted(set(nums))
        rank = {v: i + 1 for i, v in enumerate(sorted_vals)}  # 1-indexed
        n = len(sorted_vals)
        bit = [0] * (n + 1)
        def add(i, v=1):
            while i <= n: bit[i] += v; i += i & -i
        def pref(i):
            s = 0
            while i > 0: s += bit[i]; i -= i & -i
            return s
        out = []
        for x in reversed(nums):
            r = rank[x]
            out.append(pref(r - 1))
            add(r)
        return out[::-1]
```

A segment tree of counts works identically with `update(r, +1)` and `count_less = sumRange(0, r-1)`. Fenwick is shown for brevity.

### Java
```java
class Solution {
    int[] bit; int n;
    public List<Integer> countSmaller(int[] nums) {
        int[] sorted = Arrays.stream(nums).distinct().sorted().toArray();
        Map<Integer, Integer> rank = new HashMap<>();
        for (int i = 0; i < sorted.length; i++) rank.put(sorted[i], i + 1);
        n = sorted.length; bit = new int[n + 1];
        Integer[] out = new Integer[nums.length];
        for (int i = nums.length - 1; i >= 0; i--) {
            int r = rank.get(nums[i]);
            out[i] = pref(r - 1);
            add(r, 1);
        }
        return Arrays.asList(out);
    }
    void add(int i, int v) { while (i <= n) { bit[i] += v; i += i & -i; } }
    int pref(int i) { int s = 0; while (i > 0) { s += bit[i]; i -= i & -i; } return s; }
}
```

**Complexity:** O(n log n) time, O(n) memory.

---

<a name="lc-327"></a>
## 4. LC 327 — Count of Range Sum

> Count pairs `(i, j)` with `i ≤ j` such that `lower ≤ prefix[j+1] - prefix[i] ≤ upper`.

Build prefix sums; for each `prefix[j]` count how many earlier `prefix[i]` lie in `[prefix[j] - upper, prefix[j] - lower]`. A segment tree on compressed prefix values does it in O(n log n).

### Python
```python
from bisect import bisect_left

class Solution:
    def countRangeSum(self, nums, lower, upper):
        n = len(nums)
        pre = [0] * (n + 1)
        for i in range(n): pre[i+1] = pre[i] + nums[i]
        # all candidate values we'll insert/query
        vals = set(pre)
        for p in pre:
            vals.add(p - lower); vals.add(p - upper)
        sv = sorted(vals)
        rank = {v: i + 1 for i, v in enumerate(sv)}
        m = len(sv)
        bit = [0] * (m + 1)
        def add(i):
            while i <= m: bit[i] += 1; i += i & -i
        def pref(i):
            s = 0
            while i > 0: s += bit[i]; i -= i & -i
            return s
        cnt = 0
        for p in pre:
            lo = rank[p - upper]; hi = rank[p - lower]
            cnt += pref(hi) - pref(lo - 1)
            add(rank[p])
        return cnt
```

The segment tree variant uses `update(r, +1)` and `query(l, r)` directly.

**Complexity:** O(n log n).

---

<a name="lc-493"></a>
## 5. LC 493 — Reverse Pairs

> Count pairs `(i, j)` with `i < j` and `nums[i] > 2 * nums[j]`.

Sweep right to left. For each `nums[j]`, query count of `nums[i]` already seen with `i > j` and `nums[i] > 2 * nums[j]` — i.e., count of values **strictly greater than `2 * nums[j]`** in the segment tree. Then insert `nums[j]`.

### Python
```python
from bisect import bisect_left

class Solution:
    def reversePairs(self, nums):
        vals = set()
        for x in nums:
            vals.add(x); vals.add(2 * x + 1)   # 2x+1 separates "> 2x"
        sv = sorted(vals)
        rank = {v: i + 1 for i, v in enumerate(sv)}
        m = len(sv); bit = [0] * (m + 1)
        def add(i):
            while i <= m: bit[i] += 1; i += i & -i
        def pref(i):
            s = 0
            while i > 0: s += bit[i]; i -= i & -i
            return s
        cnt = 0
        for x in nums:
            # count of values > 2x already in the BIT
            r = rank[2 * x + 1]
            cnt += pref(m) - pref(r - 1)
            add(rank[x])
        return cnt
```

**Complexity:** O(n log n).

---

<a name="lc-699"></a>
## 6. LC 699 — Falling Squares

> Squares drop on a number line. After each square lands, report the max height anywhere.

Coordinate-compress all square endpoints. Use a segment tree with **range-assign** lazy (each square fully covers its footprint, setting heights to `base + side`). Maintain a running max.

### Python (skeleton)
```python
class Solution:
    def fallingSquares(self, pos):
        # coordinate compression
        xs = sorted({p for L, s in pos for p in (L, L + s - 1)})
        rank = {x: i for i, x in enumerate(xs)}
        n = len(xs)
        mx  = [0] * (4 * n)         # range max
        lz  = [0] * (4 * n)         # pending assign (0 = none)
        def apply(v, val):
            mx[v] = val; lz[v] = val
        def push(v):
            if lz[v]:
                apply(2*v, lz[v]); apply(2*v+1, lz[v]); lz[v] = 0
        def upd(v, lo, hi, l, r, val):
            if r < lo or hi < l: return
            if l <= lo and hi <= r: apply(v, val); return
            push(v)
            m = (lo + hi) // 2
            upd(2*v, lo, m, l, r, val); upd(2*v+1, m+1, hi, l, r, val)
            mx[v] = max(mx[2*v], mx[2*v+1])
        def qry(v, lo, hi, l, r):
            if r < lo or hi < l: return 0
            if l <= lo and hi <= r: return mx[v]
            push(v)
            m = (lo + hi) // 2
            return max(qry(2*v, lo, m, l, r), qry(2*v+1, m+1, hi, l, r))
        out, best = [], 0
        for L, s in pos:
            l, r = rank[L], rank[L + s - 1]
            cur = qry(1, 0, n - 1, l, r) + s
            upd(1, 0, n - 1, l, r, cur)
            best = max(best, cur); out.append(best)
        return out
```

**Complexity:** O(n log n).

---

<a name="lc-715"></a>
## 7. LC 715 — Range Module

> Track a set of half-open intervals; support `addRange`, `removeRange`, `queryRange`.

The canonical solution uses an **interval tree** (sorted `TreeMap` of `start -> end`) — simpler than a segment tree because intervals are sparse. Segment tree variant: coordinate-compress, then range-assign 0 (remove) or 1 (add); `queryRange(l, r) == (range min over [l, r-1]) == 1`.

```python
class RangeModule:
    def __init__(self):
        from sortedcontainers import SortedDict
        self.intervals = SortedDict()    # start -> end
    def addRange(self, left, right):
        i = self.intervals.bisect_left(left)
        if i > 0 and list(self.intervals.values())[i-1] >= left:
            i -= 1
        while i < len(self.intervals):
            s = list(self.intervals.keys())[i]
            e = list(self.intervals.values())[i]
            if s > right: break
            left, right = min(left, s), max(right, e)
            self.intervals.popitem(i)
        self.intervals[left] = right
    def queryRange(self, left, right):
        i = self.intervals.bisect_right(left) - 1
        return i >= 0 and list(self.intervals.values())[i] >= right
    def removeRange(self, left, right):
        i = self.intervals.bisect_left(left)
        if i > 0 and list(self.intervals.values())[i-1] > left:
            i -= 1
        while i < len(self.intervals):
            s = list(self.intervals.keys())[i]
            e = list(self.intervals.values())[i]
            if s >= right: break
            self.intervals.popitem(i)
            if s < left:  self.intervals[s] = left
            if e > right: self.intervals[right] = e
```

**Complexity:** amortized O(log n) per op; O(k) intervals tracked.

---

<a name="lc-218"></a>
## 8. LC 218 — Skyline (Segment Tree Solution)

> Output the silhouette of buildings.

Standard answer is a heap-based sweep, but a segment tree with **range-max lazy** also works: coordinate-compress all x-coordinates; for each building `(L, R, H)`, do `update(L, R-1, H)` taking max; then sweep and emit a point at each x where the max changes.

```python
class Solution:
    def getSkyline(self, buildings):
        xs = sorted({x for L, R, H in buildings for x in (L, R)})
        rank = {x: i for i, x in enumerate(xs)}
        n = len(xs)
        mx = [0] * (4 * n); lz = [0] * (4 * n)
        def apply(v, h):
            mx[v] = max(mx[v], h); lz[v] = max(lz[v], h)
        def push(v):
            if lz[v]:
                apply(2*v, lz[v]); apply(2*v+1, lz[v]); lz[v] = 0
        def upd(v, lo, hi, l, r, h):
            if r < lo or hi < l: return
            if l <= lo and hi <= r: apply(v, h); return
            push(v); m = (lo + hi) // 2
            upd(2*v, lo, m, l, r, h); upd(2*v+1, m+1, hi, l, r, h)
            mx[v] = max(mx[2*v], mx[2*v+1])
        def height_at(v, lo, hi, i):
            if lo == hi: return mx[v]
            push(v); m = (lo + hi) // 2
            return height_at(2*v, lo, m, i) if i <= m else height_at(2*v+1, m+1, hi, i)
        for L, R, H in buildings:
            upd(1, 0, n - 1, rank[L], rank[R] - 1, H)
        out, prev = [], 0
        for i, x in enumerate(xs):
            h = height_at(1, 0, n - 1, i) if i < n - 1 else 0
            if h != prev:
                out.append([x, h]); prev = h
        return out
```

**Complexity:** O(B log B) where B = number of buildings.

---

<a name="lc-732"></a>
## 9. LC 732 — My Calendar III

> Each `book(start, end)` adds an event; return the maximum number of concurrent events.

Sweep-line + segment tree with **range-add lazy + range-max query**.

```python
class MyCalendarThree:
    def __init__(self):
        self.delta = {}
    def book(self, start, end):
        self.delta[start] = self.delta.get(start, 0) + 1
        self.delta[end]   = self.delta.get(end,   0) - 1
        cur = best = 0
        for k in sorted(self.delta):
            cur += self.delta[k]
            best = max(best, cur)
        return best
```

The minimal solution above is O(n²); a segment tree with range-add + global-max yields O(log range) per book — needed if bookings exceed 10⁴.

**Complexity:** O(book_count · log range) with segment tree.

---

<a name="lc-850"></a>
## 10. LC 850 — Rectangle Area II

> Total covered area by overlapping rectangles, modulo 10⁹+7.

Sweep-line on x-coordinates: at each x-event, segment tree on y-coordinates tracks "covered y-length". Multiply by Δx and sum.

```python
MOD = 10**9 + 7
class Solution:
    def rectangleArea(self, rects):
        events = []
        ys = set()
        for x1, y1, x2, y2 in rects:
            events.append((x1, 1, y1, y2))
            events.append((x2, -1, y1, y2))
            ys.add(y1); ys.add(y2)
        events.sort()
        ys = sorted(ys)
        yi = {y: i for i, y in enumerate(ys)}
        m = len(ys) - 1            # m intervals between m+1 endpoints
        cnt = [0] * (4 * m)        # how many rects cover this y-segment
        ln  = [0] * (4 * m)        # covered length under this node
        def update(v, lo, hi, l, r, val):
            if r < lo or hi < l: return
            if l <= lo and hi <= r:
                cnt[v] += val
            else:
                m_ = (lo + hi) // 2
                update(2*v, lo, m_, l, r, val); update(2*v+1, m_+1, hi, l, r, val)
            if cnt[v] > 0:
                ln[v] = ys[hi + 1] - ys[lo]
            elif lo == hi:
                ln[v] = 0
            else:
                ln[v] = ln[2*v] + ln[2*v+1]
        area = 0; prev_x = events[0][0]
        for x, kind, y1, y2 in events:
            area = (area + ln[1] * (x - prev_x)) % MOD
            update(1, 0, m - 1, yi[y1], yi[y2] - 1, kind)
            prev_x = x
        return area
```

**Complexity:** O(n log n).

---

These ten problems span every segment-tree pattern you will encounter in interviews. Solve them once with hints, then again from a blank file. The third time through you will write a segment tree without looking at the skeleton.
