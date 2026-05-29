# Fenwick Tree — Interview Problems

> **Audience:** Engineers preparing for technical interviews where the Fenwick tree is the intended solution. Prerequisite: `junior.md` and `middle.md`.

Below are 10 classic problems whose canonical solution is a Fenwick tree. For each: problem statement, the BIT-based approach, complexity, and full Go / Java / Python implementations. Use a single reference `Fenwick` class (from `junior.md`) throughout; it is repeated in the first problem's Go solution for convenience and omitted thereafter to save space.

---

## Table of Contents

1. [LC 307 — Range Sum Query — Mutable](#lc307)
2. [LC 308 — Range Sum Query 2D — Mutable](#lc308)
3. [LC 315 — Count of Smaller Numbers After Self](#lc315)
4. [LC 327 — Count of Range Sum](#lc327)
5. [LC 493 — Reverse Pairs](#lc493)
6. [LC 1395 — Count Number of Teams](#lc1395)
7. [LC 1409 — Queries on a Permutation With Key](#lc1409)
8. [LC 1505 — Minimum Possible Integer After K Adjacent Swaps](#lc1505)
9. [Order-Statistic BIT — Kth Smallest with Insertions](#kth)
10. [Range Update + Range Sum via Two BITs](#range-range)

---

<a name="lc307"></a>
## 1. LC 307 — Range Sum Query — Mutable

**Problem.** Implement a class `NumArray` supporting `update(i, val)` (set A[i] = val) and `sumRange(l, r)` (sum A[l..r]). Both operations should be O(log n).

**Approach.** Wrap a Fenwick tree. Maintain the original array `A` to compute the delta `val - A[i]` on update.

### Go (with full Fenwick definition for reference):
```go
type Fenwick struct {
    n    int
    tree []int64
}
func NewF(n int) *Fenwick { return &Fenwick{n: n, tree: make([]int64, n+1)} }
func (f *Fenwick) Update(i int, d int64) { for ; i <= f.n; i += i & -i { f.tree[i] += d } }
func (f *Fenwick) Prefix(i int) int64 {
    var s int64
    for ; i > 0; i -= i & -i { s += f.tree[i] }
    return s
}

type NumArray struct {
    arr []int
    f   *Fenwick
}

func Constructor(nums []int) NumArray {
    f := NewF(len(nums))
    for i, v := range nums {
        f.Update(i+1, int64(v))
    }
    return NumArray{arr: append([]int(nil), nums...), f: f}
}
func (a *NumArray) Update(i, val int) {
    a.f.Update(i+1, int64(val-a.arr[i]))
    a.arr[i] = val
}
func (a *NumArray) SumRange(l, r int) int {
    return int(a.f.Prefix(r+1) - a.f.Prefix(l))
}
```

### Java:
```java
class NumArray {
    private final int n;
    private final long[] tree;
    private final int[]  arr;
    public NumArray(int[] nums) {
        n = nums.length;
        tree = new long[n + 1];
        arr = nums.clone();
        for (int i = 0; i < n; i++) bitUpdate(i + 1, nums[i]);
    }
    public void update(int i, int val) {
        bitUpdate(i + 1, val - arr[i]);
        arr[i] = val;
    }
    public int sumRange(int l, int r) {
        return (int) (prefix(r + 1) - prefix(l));
    }
    private void bitUpdate(int i, long d) { for (; i <= n; i += i & -i) tree[i] += d; }
    private long prefix(int i) { long s=0; for (; i>0; i-=i & -i) s+=tree[i]; return s; }
}
```

### Python:
```python
class NumArray:
    def __init__(self, nums):
        self.n = len(nums)
        self.tree = [0] * (self.n + 1)
        self.arr = nums[:]
        for i, v in enumerate(nums):
            self._upd(i + 1, v)
    def update(self, i, val):
        self._upd(i + 1, val - self.arr[i])
        self.arr[i] = val
    def sumRange(self, l, r):
        return self._pref(r + 1) - self._pref(l)
    def _upd(self, i, d):
        while i <= self.n:
            self.tree[i] += d
            i += i & -i
    def _pref(self, i):
        s = 0
        while i > 0:
            s += self.tree[i]
            i -= i & -i
        return s
```

**Complexity.** Build O(n log n) (O(n) with the absorbing build). Each `update` and `sumRange` O(log n). Memory O(n).

---

<a name="lc308"></a>
## 2. LC 308 — Range Sum Query 2D — Mutable

**Problem.** Same as LC 307 in 2D. `update(r, c, val)` and `sumRegion(r1, c1, r2, c2)`.

**Approach.** 2D BIT. See `middle.md` section 3 for the operations. Build O(nm log n log m); query O(log n · log m).

### Python:
```python
class NumMatrix:
    def __init__(self, matrix):
        if not matrix or not matrix[0]:
            self.n = self.m = 0; return
        self.n, self.m = len(matrix), len(matrix[0])
        self.tree = [[0] * (self.m + 1) for _ in range(self.n + 1)]
        self.mat  = [row[:] for row in matrix]
        for i in range(self.n):
            for j in range(self.m):
                self._upd(i + 1, j + 1, matrix[i][j])
    def update(self, r, c, val):
        delta = val - self.mat[r][c]
        self.mat[r][c] = val
        self._upd(r + 1, c + 1, delta)
    def sumRegion(self, r1, c1, r2, c2):
        return (self._pref(r2+1, c2+1) - self._pref(r1, c2+1)
              - self._pref(r2+1, c1)   + self._pref(r1, c1))
    def _upd(self, r, c, d):
        i = r
        while i <= self.n:
            j = c
            while j <= self.m:
                self.tree[i][j] += d
                j += j & -j
            i += i & -i
    def _pref(self, r, c):
        s = 0; i = r
        while i > 0:
            j = c
            while j > 0:
                s += self.tree[i][j]
                j -= j & -j
            i -= i & -i
        return s
```

Go and Java translations are mechanical replicas. **Complexity.** Build O(nm log n log m). Update O(log n · log m). Query O(log n · log m).

---

<a name="lc315"></a>
## 3. LC 315 — Count of Smaller Numbers After Self

**Problem.** Given `nums`, return an array `counts` where `counts[i]` is the number of `nums[j]` with `j > i` and `nums[j] < nums[i]`.

**Approach.** Walk **right to left**. Maintain a BIT keyed by rank of value seen. For each `nums[i]`, query `bit.prefix(rank(nums[i]) - 1)` — that is the count of already-seen values strictly less. Then insert `nums[i]` into the BIT.

### Python:
```python
class Solution:
    def countSmaller(self, nums):
        sorted_vals = sorted(set(nums))
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
        out = [0] * len(nums)
        for i in range(len(nums) - 1, -1, -1):
            r = rank[nums[i]]
            out[i] = pref(r - 1)
            upd(r)
        return out
```

### Go:
```go
func countSmaller(nums []int) []int {
    sorted := append([]int(nil), nums...)
    sort.Ints(sorted)
    sorted = uniq(sorted)
    rank := map[int]int{}
    for i, v := range sorted {
        rank[v] = i + 1
    }
    n := len(sorted)
    tree := make([]int, n+1)
    upd := func(i int) { for ; i <= n; i += i & -i { tree[i]++ } }
    pref := func(i int) int {
        s := 0
        for ; i > 0; i -= i & -i { s += tree[i] }
        return s
    }
    out := make([]int, len(nums))
    for i := len(nums) - 1; i >= 0; i-- {
        r := rank[nums[i]]
        out[i] = pref(r - 1)
        upd(r)
    }
    return out
}
```

### Java:
```java
public List<Integer> countSmaller(int[] nums) {
    int n = nums.length;
    int[] sorted = nums.clone();
    Arrays.sort(sorted);
    int k = 0;
    for (int i = 0; i < n; i++) {
        if (i == 0 || sorted[i] != sorted[i - 1]) sorted[k++] = sorted[i];
    }
    int[] tree = new int[k + 1];
    Integer[] out = new Integer[n];
    for (int i = n - 1; i >= 0; i--) {
        int r = Arrays.binarySearch(sorted, 0, k, nums[i]) + 1;
        int s = 0;
        for (int j = r - 1; j > 0; j -= j & -j) s += tree[j];
        out[i] = s;
        for (int j = r; j <= k; j += j & -j) tree[j]++;
    }
    return Arrays.asList(out);
}
```

**Complexity.** O(n log n) time, O(n) space.

---

<a name="lc327"></a>
## 4. LC 327 — Count of Range Sum

**Problem.** Given `nums` and bounds `lower, upper`, count the number of range sums `S(i, j) = sum(nums[i..j])` such that `lower <= S(i, j) <= upper`.

**Approach.** Compute prefix sums `P[0..n]`. The condition becomes `lower <= P[j] - P[i] <= upper` for `i < j`. For each `j`, count valid `i < j`: the number of previously seen prefix sums in `[P[j] - upper, P[j] - lower]`. Coordinate-compress all candidate values (`P[j], P[j] - lower, P[j] - upper`), then use a BIT.

### Python:
```python
class Solution:
    def countRangeSum(self, nums, lower, upper):
        prefix = [0]
        for v in nums:
            prefix.append(prefix[-1] + v)
        candidates = set()
        for p in prefix:
            candidates.add(p)
            candidates.add(p - lower)
            candidates.add(p - upper)
        sorted_c = sorted(candidates)
        rank = {v: i + 1 for i, v in enumerate(sorted_c)}
        n = len(sorted_c)
        tree = [0] * (n + 1)
        def upd(i):
            while i <= n:
                tree[i] += 1; i += i & -i
        def pref(i):
            s = 0
            while i > 0:
                s += tree[i]; i -= i & -i
            return s
        ans = 0
        for p in prefix:
            lo, hi = rank[p - upper], rank[p - lower]
            ans += pref(hi) - pref(lo - 1)
            upd(rank[p])
        return ans
```

Go and Java analogs follow the same pattern (sort + dedupe + BIT). **Complexity.** O(n log n) time and space.

---

<a name="lc493"></a>
## 5. LC 493 — Reverse Pairs

**Problem.** Count pairs `(i, j)` with `i < j` and `nums[i] > 2 * nums[j]`.

**Approach.** Walk left to right. For each `nums[i]`, the contribution is the count of previously inserted values `v` with `v > 2 * nums[i]`. Coordinate-compress over `nums[i]` and `2 * nums[i] + 1` (a careful trick to handle the strict-greater) and use a BIT.

### Python:
```python
class Solution:
    def reversePairs(self, nums):
        cands = set()
        for v in nums:
            cands.add(v); cands.add(2 * v)
        sorted_c = sorted(cands)
        rank = {v: i + 1 for i, v in enumerate(sorted_c)}
        n = len(sorted_c)
        tree = [0] * (n + 1)
        def upd(i):
            while i <= n: tree[i] += 1; i += i & -i
        def pref(i):
            s = 0
            while i > 0: s += tree[i]; i -= i & -i
            return s
        ans = 0
        for v in nums:
            # number of previously inserted values > 2v
            threshold = rank[2 * v]                  # boundary
            ans += pref(n) - pref(threshold)
            upd(rank[v])
        return ans
```

Note the careful use of `pref(n) - pref(threshold)` to get the strict-greater count. **Complexity.** O(n log n).

---

<a name="lc1395"></a>
## 6. LC 1395 — Count Number of Teams

**Problem.** Given a permutation `rating[0..n-1]` of distinct integers, count triplets `(i, j, k)` with `i < j < k` such that either `rating[i] < rating[j] < rating[k]` or `rating[i] > rating[j] > rating[k]`.

**Approach.** For each middle index `j`, count:
- `lessLeft(j)` = number of `i < j` with `rating[i] < rating[j]`.
- `lessRight(j)` = number of `k > j` with `rating[k] < rating[j]`.
- Symmetric for greater.

The triplet count is `Σ_j (lessLeft(j) · greaterRight(j) + greaterLeft(j) · lessRight(j))`.

Compute prefix counts with one BIT pass left-to-right, suffix counts with another. Coordinate-compress as needed (values may be up to 10^5).

### Python:
```python
class Solution:
    def numTeams(self, rating):
        n_val = max(rating) + 1
        tree = [0] * (n_val + 1)
        def upd(i):
            while i <= n_val: tree[i] += 1; i += i & -i
        def pref(i):
            s = 0
            while i > 0: s += tree[i]; i -= i & -i
            return s
        n = len(rating)
        less_left = [0] * n
        for j in range(n):
            less_left[j] = pref(rating[j] - 1)
            upd(rating[j])
        # reset for the right pass
        tree = [0] * (n_val + 1)
        less_right = [0] * n
        for j in range(n - 1, -1, -1):
            less_right[j] = pref(rating[j] - 1)
            upd(rating[j])
        ans = 0
        for j in range(n):
            greater_left  = j - less_left[j]
            greater_right = (n - 1 - j) - less_right[j]
            ans += less_left[j] * greater_right + greater_left * less_right[j]
        return ans
```

Go/Java translations mirror this. **Complexity.** O(n log V).

---

<a name="lc1409"></a>
## 7. LC 1409 — Queries on a Permutation With Key

**Problem.** You have a permutation `P = [1, 2, ..., m]`. For each `query`, return the current index of `query` in `P` and then move `query` to the front.

**Approach.** Use a BIT of size `m + len(queries)` indexed by "virtual position". Initially place each value `v` at virtual position `len(queries) + v`. Front positions are reserved for newly moved values.

Maintain `pos[v]` = current virtual position. For each query: report `bit.prefix(pos[query]) - 1` (count of present elements strictly before it). Mark the old position dead (`bit.update(pos[query], -1)`). Assign a new virtual position at the head of the reserved area (decrement the head pointer) and `bit.update(newPos, +1)`. Update `pos[query] = newPos`.

### Python:
```python
class Solution:
    def processQueries(self, queries, m):
        size = m + len(queries)
        tree = [0] * (size + 1)
        def upd(i, d):
            while i <= size:
                tree[i] += d; i += i & -i
        def pref(i):
            s = 0
            while i > 0:
                s += tree[i]; i -= i & -i
            return s
        pos = [0] * (m + 1)
        head = len(queries)
        for v in range(1, m + 1):
            pos[v] = head + v
            upd(pos[v], 1)
        out = []
        for q in queries:
            out.append(pref(pos[q]) - 1)
            upd(pos[q], -1)
            pos[q] = head
            upd(head, 1)
            head -= 1
        return out
```

**Complexity.** O((m + Q) log(m + Q)).

---

<a name="lc1505"></a>
## 8. LC 1505 — Minimum Possible Integer After K Adjacent Swaps

**Problem.** Given a numeric string and integer `k`, perform at most `k` swaps of adjacent digits to make the string as small as possible.

**Approach.** Greedy: for each output position, find the smallest digit reachable within `k` swaps (i.e., within positions whose *current* distance to the head, accounting for already-removed digits, is ≤ k). Use a BIT to track "is this index still present?" so that we can compute the actual number of swaps needed to bring an indexed digit to the front efficiently.

For each digit 0..9, keep a queue of original indices. For each output position, scan digits from 0 upward; the front of digit `d`'s queue is the earliest unused occurrence of `d`. Compute swap cost = `prefix(originalIdx) - removed_count_so_far_before_originalIdx`, which we get from the BIT.

### Python:
```python
class Solution:
    def minInteger(self, num, k):
        n = len(num)
        # buckets of original indices per digit
        buckets = [[] for _ in range(10)]
        for i, c in enumerate(num):
            buckets[int(c)].append(i)
        # BIT[i] = 1 if index i still present
        tree = [0] * (n + 1)
        def upd(i, d):
            while i <= n:
                tree[i] += d; i += i & -i
        def pref(i):
            s = 0
            while i > 0:
                s += tree[i]; i -= i & -i
            return s
        for i in range(1, n + 1):
            upd(i, 1)
        used = [False] * n
        out = []
        for _ in range(n):
            for d in range(10):
                if not buckets[d]:
                    continue
                idx = buckets[d][0]
                # cost = number of still-present elements before idx (excluding idx itself)
                cost = pref(idx)        # 0-indexed idx maps to BIT[idx+1]; prefix(idx) = present elements at positions 1..idx (i.e. 0..idx-1 0-indexed)
                if cost <= k:
                    out.append(str(d))
                    k -= cost
                    buckets[d].pop(0)
                    upd(idx + 1, -1)
                    break
        return ''.join(out)
```

Note: this Python list-pop-from-front is O(1) only with `collections.deque`; use that in production. **Complexity.** O(n · 10 · log n) which is O(n log n).

---

<a name="kth"></a>
## 9. Order-Statistic BIT — Kth Smallest with Insertions

**Problem.** Support `insert(x)` and `kthSmallest(k)` on a multiset of integers in range `[1, V]`.

**Approach.** A BIT of size `V` storing frequencies. `insert` = `update(x, +1)`. `kthSmallest` = binary lifting on BIT (see `middle.md` section 6). Both O(log V).

### Go:
```go
type OrderStat struct {
    n, log int
    tree   []int64
}

func NewOrderStat(V int) *OrderStat {
    log := 0
    for 1<<(log+1) <= V {
        log++
    }
    return &OrderStat{n: V, log: log, tree: make([]int64, V+1)}
}

func (o *OrderStat) Insert(x int) {
    for ; x <= o.n; x += x & -x {
        o.tree[x]++
    }
}

func (o *OrderStat) Remove(x int) {
    for ; x <= o.n; x += x & -x {
        o.tree[x]--
    }
}

func (o *OrderStat) Kth(k int64) int {
    idx := 0
    for b := o.log; b >= 0; b-- {
        next := idx + (1 << b)
        if next <= o.n && o.tree[next] < k {
            idx = next
            k -= o.tree[next]
        }
    }
    return idx + 1
}
```

Java and Python translations follow. **Complexity.** O(log V) per operation.

---

<a name="range-range"></a>
## 10. Range Update + Range Sum via Two BITs

**Problem.** Implement `rangeUpdate(l, r, v)` (add `v` to A[l..r]) and `rangeSum(l, r)` (sum A[l..r]), both O(log n).

**Approach.** The two-BIT trick from `middle.md` section 2.

### Java:
```java
public final class RangeBoth {
    private final int n;
    private final long[] b1, b2;

    public RangeBoth(int n) {
        this.n = n + 1;
        this.b1 = new long[this.n + 1];
        this.b2 = new long[this.n + 1];
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
        upd(b1, l, v);     upd(b1, r + 1, -v);
        upd(b2, l, v * (l - 1));   upd(b2, r + 1, -v * r);
    }
    private long prefixSum(int i) {
        return (long) i * pref(b1, i) - pref(b2, i);
    }
    public long rangeSum(int l, int r) {
        return prefixSum(r) - prefixSum(l - 1);
    }
}
```

Go and Python analogs were given in `middle.md`. **Complexity.** All operations O(log n). Memory O(n).

---

## Interview Tips

- **Always mention 1-indexing aloud** when whiteboarding. Interviewers expect it.
- **Coordinate-compress before BIT** whenever values may be large or negative. Mention this even if the problem doesn't require it; it shows seasoned thinking.
- **Distinguish point update vs range update** clearly in your verbal walkthrough. Mixing up which variant applies is a common pitfall.
- **Mention segment tree as the fallback** for min/max range queries. Demonstrates you know the limits of the BIT.
- **For LC 315/327/493** (inversion-style), explicitly walk through one small example with the interviewer before coding.

Continue with `tasks.md` for hands-on coding exercises with full reference solutions.
