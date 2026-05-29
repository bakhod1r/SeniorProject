# Segment Tree — Hands-On Tasks

> **Audience:** Anyone who has read `junior.md` and `middle.md` and wants to lock the patterns in via implementation. Reference solutions in Python (translate to Go/Java as practice).

Work through these in order; each builds on the previous. By the end you will have a personal segment-tree library covering every common variant.

---

## Table of Contents

1. [Recursive Sum Segment Tree](#t1)
2. [Recursive Min Segment Tree](#t2)
3. [Iterative Bottom-Up Sum Segment Tree](#t3)
4. [Lazy Propagation — Range Add](#t4)
5. [Lazy Propagation — Range Assign](#t5)
6. [Generic Monoid Segment Tree](#t6)
7. [2D Segment Tree — Rectangle Sum + Point Update](#t7)
8. [Persistent Segment Tree](#t8)
9. [Coordinate-Compressed Segment Tree](#t9)
10. [Merge-Sort Tree — Count Less-Than-K in Range](#t10)

---

<a name="t1"></a>
## Task 1 — Recursive Sum Segment Tree

**Goal.** Implement `build`, `update(idx, val)`, `query(l, r)` for range-sum. Verify against a brute-force O(n) on 1000 random inputs.

```python
import random

class SumSegTree:
    def __init__(self, arr):
        self.n = len(arr)
        self.t = [0] * (4 * max(self.n, 1))
        if self.n: self._build(1, 0, self.n - 1, arr)
    def _build(self, v, lo, hi, a):
        if lo == hi: self.t[v] = a[lo]; return
        m = (lo + hi) // 2
        self._build(2*v, lo, m, a); self._build(2*v+1, m+1, hi, a)
        self.t[v] = self.t[2*v] + self.t[2*v+1]
    def update(self, i, val):
        self._u(1, 0, self.n - 1, i, val)
    def _u(self, v, lo, hi, i, val):
        if lo == hi: self.t[v] = val; return
        m = (lo + hi) // 2
        if i <= m: self._u(2*v, lo, m, i, val)
        else:      self._u(2*v+1, m+1, hi, i, val)
        self.t[v] = self.t[2*v] + self.t[2*v+1]
    def query(self, l, r):
        return self._q(1, 0, self.n - 1, l, r)
    def _q(self, v, lo, hi, l, r):
        if r < lo or hi < l: return 0
        if l <= lo and hi <= r: return self.t[v]
        m = (lo + hi) // 2
        return self._q(2*v, lo, m, l, r) + self._q(2*v+1, m+1, hi, l, r)

# Stress test
arr = [random.randint(-100, 100) for _ in range(200)]
st = SumSegTree(arr)
for _ in range(1000):
    if random.random() < 0.5:
        i, v = random.randint(0, 199), random.randint(-100, 100)
        arr[i] = v; st.update(i, v)
    else:
        l, r = sorted(random.sample(range(200), 2))
        assert st.query(l, r) == sum(arr[l:r+1])
print("Task 1 passed")
```

---

<a name="t2"></a>
## Task 2 — Recursive Min Segment Tree

**Goal.** Replace combine with `min`, identity with `+inf`.

```python
INF = float("inf")

class MinSegTree:
    def __init__(self, arr):
        self.n = len(arr)
        self.t = [INF] * (4 * max(self.n, 1))
        if self.n: self._b(1, 0, self.n - 1, arr)
    def _b(self, v, lo, hi, a):
        if lo == hi: self.t[v] = a[lo]; return
        m = (lo + hi) // 2
        self._b(2*v, lo, m, a); self._b(2*v+1, m+1, hi, a)
        self.t[v] = min(self.t[2*v], self.t[2*v+1])
    def update(self, i, val):
        self._u(1, 0, self.n - 1, i, val)
    def _u(self, v, lo, hi, i, val):
        if lo == hi: self.t[v] = val; return
        m = (lo + hi) // 2
        if i <= m: self._u(2*v, lo, m, i, val)
        else:      self._u(2*v+1, m+1, hi, i, val)
        self.t[v] = min(self.t[2*v], self.t[2*v+1])
    def query(self, l, r):
        return self._q(1, 0, self.n - 1, l, r)
    def _q(self, v, lo, hi, l, r):
        if r < lo or hi < l: return INF
        if l <= lo and hi <= r: return self.t[v]
        m = (lo + hi) // 2
        return min(self._q(2*v, lo, m, l, r), self._q(2*v+1, m+1, hi, l, r))
```

The skeleton is identical to Task 1; only `combine` and `identity` change. This is the principal pedagogical point.

---

<a name="t3"></a>
## Task 3 — Iterative Bottom-Up Sum Segment Tree

**Goal.** Same API, but ~2× faster.

```python
class IterSeg:
    def __init__(self, arr):
        self.n = len(arr)
        self.t = [0] * (2 * self.n)
        for i, v in enumerate(arr): self.t[self.n + i] = v
        for i in range(self.n - 1, 0, -1):
            self.t[i] = self.t[2*i] + self.t[2*i + 1]
    def update(self, i, val):
        i += self.n
        self.t[i] = val
        i //= 2
        while i:
            self.t[i] = self.t[2*i] + self.t[2*i + 1]
            i //= 2
    def query(self, l, r):           # inclusive [l, r]
        res = 0
        l += self.n; r += self.n + 1
        while l < r:
            if l & 1: res += self.t[l]; l += 1
            if r & 1: r -= 1; res += self.t[r]
            l //= 2; r //= 2
        return res
```

Benchmark this against Task 1 on `n = 10⁵` with `10⁶` queries — you should see ~2× speedup.

---

<a name="t4"></a>
## Task 4 — Lazy Propagation: Range Add + Range Sum

```python
class RangeAddSum:
    def __init__(self, arr):
        self.n = len(arr)
        self.t = [0] * (4 * self.n)
        self.lz = [0] * (4 * self.n)
        self._b(1, 0, self.n - 1, arr)
    def _b(self, v, lo, hi, a):
        if lo == hi: self.t[v] = a[lo]; return
        m = (lo + hi) // 2
        self._b(2*v, lo, m, a); self._b(2*v+1, m+1, hi, a)
        self.t[v] = self.t[2*v] + self.t[2*v+1]
    def _apply(self, v, lo, hi, val):
        self.t[v] += val * (hi - lo + 1)
        self.lz[v] += val
    def _push(self, v, lo, hi):
        if self.lz[v]:
            m = (lo + hi) // 2
            self._apply(2*v, lo, m, self.lz[v])
            self._apply(2*v+1, m+1, hi, self.lz[v])
            self.lz[v] = 0
    def update(self, l, r, val):
        self._u(1, 0, self.n - 1, l, r, val)
    def _u(self, v, lo, hi, l, r, val):
        if r < lo or hi < l: return
        if l <= lo and hi <= r: self._apply(v, lo, hi, val); return
        self._push(v, lo, hi)
        m = (lo + hi) // 2
        self._u(2*v, lo, m, l, r, val); self._u(2*v+1, m+1, hi, l, r, val)
        self.t[v] = self.t[2*v] + self.t[2*v+1]
    def query(self, l, r):
        return self._q(1, 0, self.n - 1, l, r)
    def _q(self, v, lo, hi, l, r):
        if r < lo or hi < l: return 0
        if l <= lo and hi <= r: return self.t[v]
        self._push(v, lo, hi)
        m = (lo + hi) // 2
        return self._q(2*v, lo, m, l, r) + self._q(2*v+1, m+1, hi, l, r)
```

Stress-test by interleaving range-add updates with sum queries; verify against a brute-force `sum(arr[l:r+1])` after applying every update to the raw array.

---

<a name="t5"></a>
## Task 5 — Lazy Propagation: Range Assign (Set) + Range Sum

Range-assign means "overwrite every element in `[l, r]` with `val`". The tag composition is **assignment** — a new `assign` overrides any previous one. We use a sentinel (e.g., `None`) for "no pending assign".

```python
class RangeAssignSum:
    NONE = object()
    def __init__(self, arr):
        self.n = len(arr)
        self.t  = [0] * (4 * self.n)
        self.lz = [self.NONE] * (4 * self.n)
        self._b(1, 0, self.n - 1, arr)
    def _b(self, v, lo, hi, a):
        if lo == hi: self.t[v] = a[lo]; return
        m = (lo + hi) // 2
        self._b(2*v, lo, m, a); self._b(2*v+1, m+1, hi, a)
        self.t[v] = self.t[2*v] + self.t[2*v+1]
    def _apply(self, v, lo, hi, val):
        self.t[v] = val * (hi - lo + 1)
        self.lz[v] = val
    def _push(self, v, lo, hi):
        if self.lz[v] is not self.NONE:
            m = (lo + hi) // 2
            self._apply(2*v, lo, m, self.lz[v])
            self._apply(2*v+1, m+1, hi, self.lz[v])
            self.lz[v] = self.NONE
    def assign(self, l, r, val):
        self._u(1, 0, self.n - 1, l, r, val)
    def _u(self, v, lo, hi, l, r, val):
        if r < lo or hi < l: return
        if l <= lo and hi <= r: self._apply(v, lo, hi, val); return
        self._push(v, lo, hi)
        m = (lo + hi) // 2
        self._u(2*v, lo, m, l, r, val); self._u(2*v+1, m+1, hi, l, r, val)
        self.t[v] = self.t[2*v] + self.t[2*v+1]
    def query(self, l, r):
        return self._q(1, 0, self.n - 1, l, r)
    def _q(self, v, lo, hi, l, r):
        if r < lo or hi < l: return 0
        if l <= lo and hi <= r: return self.t[v]
        self._push(v, lo, hi)
        m = (lo + hi) // 2
        return self._q(2*v, lo, m, l, r) + self._q(2*v+1, m+1, hi, l, r)
```

Note: combining range-assign with range-add is doable but requires **two** lazy slots and careful composition — assign overrides add, add accumulates on top of assign. Try implementing that variant after finishing this task.

---

<a name="t6"></a>
## Task 6 — Generic Monoid Segment Tree

Refactor so combine and identity are passed in. Verify on sum, min, max, gcd, xor.

```python
from dataclasses import dataclass
from typing import Callable, Generic, TypeVar
import math

T = TypeVar("T")

@dataclass
class Monoid(Generic[T]):
    identity: T
    combine: Callable[[T, T], T]

class SegTree(Generic[T]):
    def __init__(self, arr, m: Monoid[T]):
        self.n, self.m = len(arr), m
        self.t = [m.identity] * (4 * max(self.n, 1))
        if self.n: self._b(1, 0, self.n - 1, arr)
    def _b(self, v, lo, hi, a):
        if lo == hi: self.t[v] = a[lo]; return
        mid = (lo + hi) // 2
        self._b(2*v, lo, mid, a); self._b(2*v+1, mid+1, hi, a)
        self.t[v] = self.m.combine(self.t[2*v], self.t[2*v+1])
    def update(self, i, val):
        self._u(1, 0, self.n - 1, i, val)
    def _u(self, v, lo, hi, i, val):
        if lo == hi: self.t[v] = val; return
        mid = (lo + hi) // 2
        if i <= mid: self._u(2*v, lo, mid, i, val)
        else:        self._u(2*v+1, mid+1, hi, i, val)
        self.t[v] = self.m.combine(self.t[2*v], self.t[2*v+1])
    def query(self, l, r):
        return self._q(1, 0, self.n - 1, l, r)
    def _q(self, v, lo, hi, l, r):
        if r < lo or hi < l: return self.m.identity
        if l <= lo and hi <= r: return self.t[v]
        mid = (lo + hi) // 2
        return self.m.combine(
            self._q(2*v, lo, mid, l, r),
            self._q(2*v+1, mid+1, hi, l, r))

SUM = Monoid(0,   lambda a, b: a + b)
MIN = Monoid(math.inf,  lambda a, b: min(a, b))
MAX = Monoid(-math.inf, lambda a, b: max(a, b))
GCD = Monoid(0,   math.gcd)
XOR = Monoid(0,   lambda a, b: a ^ b)
```

---

<a name="t7"></a>
## Task 7 — 2D Segment Tree

**Goal.** Rectangle sum + point update in O(log² n). Reference: LeetCode 308.

```python
class SegTree2D:
    def __init__(self, grid):
        self.R = len(grid); self.C = len(grid[0])
        self.t = [[0]*(4*self.C) for _ in range(4*self.R)]
        self._buildY(1, 0, self.R - 1, grid)
    def _buildY(self, vy, loY, hiY, g):
        if loY == hiY:
            self._buildX(vy, 1, 0, self.C - 1, g[loY]); return
        midY = (loY + hiY) // 2
        self._buildY(2*vy,   loY,    midY, g)
        self._buildY(2*vy+1, midY+1, hiY,  g)
        self._mergeX(vy, 1, 0, self.C - 1)
    def _buildX(self, vy, vx, loX, hiX, row):
        if loX == hiX:
            self.t[vy][vx] = row[loX]; return
        midX = (loX + hiX) // 2
        self._buildX(vy, 2*vx,   loX,    midX, row)
        self._buildX(vy, 2*vx+1, midX+1, hiX,  row)
        self.t[vy][vx] = self.t[vy][2*vx] + self.t[vy][2*vx+1]
    def _mergeX(self, vy, vx, loX, hiX):
        if loX == hiX:
            self.t[vy][vx] = self.t[2*vy][vx] + self.t[2*vy+1][vx]; return
        midX = (loX + hiX) // 2
        self._mergeX(vy, 2*vx,   loX,    midX)
        self._mergeX(vy, 2*vx+1, midX+1, hiX)
        self.t[vy][vx] = self.t[vy][2*vx] + self.t[vy][2*vx+1]
    def update(self, r, c, val):
        self._updY(1, 0, self.R - 1, r, c, val)
    def _updY(self, vy, loY, hiY, r, c, val):
        if loY != hiY:
            midY = (loY + hiY) // 2
            if r <= midY: self._updY(2*vy,   loY,    midY, r, c, val)
            else:         self._updY(2*vy+1, midY+1, hiY,  r, c, val)
        self._updX(vy, 1, 0, self.C - 1, loY, hiY, c, val)
    def _updX(self, vy, vx, loX, hiX, loY, hiY, c, val):
        if loX == hiX:
            if loY == hiY: self.t[vy][vx] = val
            else:          self.t[vy][vx] = self.t[2*vy][vx] + self.t[2*vy+1][vx]
            return
        midX = (loX + hiX) // 2
        if c <= midX: self._updX(vy, 2*vx,   loX,    midX, loY, hiY, c, val)
        else:         self._updX(vy, 2*vx+1, midX+1, hiX,  loY, hiY, c, val)
        self.t[vy][vx] = self.t[vy][2*vx] + self.t[vy][2*vx+1]
    def query(self, r1, c1, r2, c2):
        return self._qY(1, 0, self.R - 1, r1, c1, r2, c2)
    def _qY(self, vy, loY, hiY, r1, c1, r2, c2):
        if r2 < loY or hiY < r1: return 0
        if r1 <= loY and hiY <= r2:
            return self._qX(vy, 1, 0, self.C - 1, c1, c2)
        midY = (loY + hiY) // 2
        return (self._qY(2*vy,   loY,    midY, r1, c1, r2, c2)
              + self._qY(2*vy+1, midY+1, hiY,  r1, c1, r2, c2))
    def _qX(self, vy, vx, loX, hiX, c1, c2):
        if c2 < loX or hiX < c1: return 0
        if c1 <= loX and hiX <= c2: return self.t[vy][vx]
        midX = (loX + hiX) // 2
        return (self._qX(vy, 2*vx,   loX,    midX, c1, c2)
              + self._qX(vy, 2*vx+1, midX+1, hiX,  c1, c2))
```

Memory: O(R · C · log R). For R = C = 1000 you need ~40 MB.

---

<a name="t8"></a>
## Task 8 — Persistent Segment Tree

**Goal.** Each update returns a **new root** sharing unchanged subtrees with the previous version. Track all versions for time-travel queries.

```python
class PNode:
    __slots__ = ("left", "right", "val")
    def __init__(self, left=None, right=None, val=0):
        self.left, self.right, self.val = left, right, val

def pbuild(lo, hi, arr):
    if lo == hi: return PNode(val=arr[lo])
    m = (lo + hi) // 2
    L, R = pbuild(lo, m, arr), pbuild(m + 1, hi, arr)
    return PNode(L, R, L.val + R.val)

def pupdate(node, lo, hi, idx, val):
    if lo == hi: return PNode(val=val)
    m = (lo + hi) // 2
    if idx <= m:
        nl = pupdate(node.left, lo, m, idx, val)
        return PNode(nl, node.right, nl.val + node.right.val)
    nr = pupdate(node.right, m + 1, hi, idx, val)
    return PNode(node.left, nr, node.left.val + nr.val)

def pquery(node, lo, hi, l, r):
    if r < lo or hi < l: return 0
    if l <= lo and hi <= r: return node.val
    m = (lo + hi) // 2
    return pquery(node.left, lo, m, l, r) + pquery(node.right, m + 1, hi, l, r)

# Usage:
arr = [1, 2, 3, 4, 5]
versions = [pbuild(0, len(arr) - 1, arr)]
versions.append(pupdate(versions[-1], 0, 4, 2, 99))     # arr[2] := 99
versions.append(pupdate(versions[-1], 0, 4, 0, 0))      # arr[0] := 0
assert pquery(versions[0], 0, 4, 0, 4) == 15
assert pquery(versions[1], 0, 4, 0, 4) == 1 + 2 + 99 + 4 + 5
assert pquery(versions[2], 0, 4, 0, 4) == 0 + 2 + 99 + 4 + 5
```

Memory: O(initial + #updates · log n) nodes.

---

<a name="t9"></a>
## Task 9 — Coordinate-Compressed Segment Tree

**Goal.** Handle a range of 10⁹ with only 10⁵ distinct events.

```python
from bisect import bisect_left

class CompressedSeg:
    def __init__(self, coords):
        self.coords = sorted(set(coords))
        self.n = len(self.coords)
        self.t = [0] * (4 * max(self.n, 1))
    def _rank(self, x):
        i = bisect_left(self.coords, x)
        if i == len(self.coords) or self.coords[i] != x:
            raise ValueError(f"{x} not in coordinate set")
        return i
    def update(self, x, val):
        self._u(1, 0, self.n - 1, self._rank(x), val)
    def _u(self, v, lo, hi, i, val):
        if lo == hi: self.t[v] += val; return
        m = (lo + hi) // 2
        if i <= m: self._u(2*v, lo, m, i, val)
        else:      self._u(2*v+1, m+1, hi, i, val)
        self.t[v] = self.t[2*v] + self.t[2*v+1]
    def query(self, lx, rx):       # query original coordinate range
        l, r = bisect_left(self.coords, lx), bisect_left(self.coords, rx + 1) - 1
        if l > r: return 0
        return self._q(1, 0, self.n - 1, l, r)
    def _q(self, v, lo, hi, l, r):
        if r < lo or hi < l: return 0
        if l <= lo and hi <= r: return self.t[v]
        m = (lo + hi) // 2
        return self._q(2*v, lo, m, l, r) + self._q(2*v+1, m+1, hi, l, r)

# Demo
events = [10**9, 5, 7, 10**6]
cs = CompressedSeg(events)
cs.update(10**9, 1); cs.update(5, 2); cs.update(7, 3); cs.update(10**6, 4)
assert cs.query(0, 10**5) == 2 + 3
assert cs.query(0, 10**9) == 10
```

---

<a name="t10"></a>
## Task 10 — Merge-Sort Tree

**Goal.** Answer "how many elements in `arr[l..r]` are < k" in O(log² n).

```python
from bisect import bisect_left

class MergeSortTree:
    def __init__(self, arr):
        self.n = len(arr)
        self.t = [None] * (4 * max(self.n, 1))
        if self.n: self._b(1, 0, self.n - 1, arr)
    def _b(self, v, lo, hi, a):
        if lo == hi:
            self.t[v] = [a[lo]]; return
        m = (lo + hi) // 2
        self._b(2*v, lo, m, a); self._b(2*v+1, m+1, hi, a)
        # merge
        L, R = self.t[2*v], self.t[2*v+1]
        out, i, j = [], 0, 0
        while i < len(L) and j < len(R):
            if L[i] <= R[j]: out.append(L[i]); i += 1
            else:            out.append(R[j]); j += 1
        out.extend(L[i:]); out.extend(R[j:])
        self.t[v] = out
    def count_less(self, l, r, k):
        return self._cl(1, 0, self.n - 1, l, r, k)
    def _cl(self, v, lo, hi, l, r, k):
        if r < lo or hi < l: return 0
        if l <= lo and hi <= r: return bisect_left(self.t[v], k)
        m = (lo + hi) // 2
        return self._cl(2*v, lo, m, l, r, k) + self._cl(2*v+1, m+1, hi, l, r, k)

# Demo
arr = [5, 3, 8, 1, 9, 2, 7]
mst = MergeSortTree(arr)
assert mst.count_less(1, 5, 5) == 3   # arr[1..5] = [3,8,1,9,2] — three < 5
```

Memory: O(n log n). Time per query: O(log² n).

---

You now have a working library covering ten of the most useful segment-tree forms. Translate Tasks 1–6 into Go and Java for the language fluency that interviewers test. Tasks 7–10 are usually problem-specific and Python is enough.
