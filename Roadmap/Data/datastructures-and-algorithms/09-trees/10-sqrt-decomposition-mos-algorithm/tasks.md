# Square Root Decomposition & Mo's Algorithm — Practice Tasks

> **Read time: ~50 minutes** · **Audience:** Anyone who wants to build a deep working knowledge by writing the code themselves. Each task has reference solutions in Go, Java, or Python (full code for hard tasks; sketches for easier ones).

Work each task without peeking. Compare your answer to the reference. If your code times out at scale, profile and iterate.

---

## Task index

1. [Sqrt-decomp for range sum + point update](#t1)
2. [Sqrt-decomp for range max — non-invertible aggregate](#t2)
3. [Range assign + range sum with lazy bucket tags](#t3)
4. [Mo's algorithm for count distinct](#t4)
5. [Mo's algorithm for mode frequency](#t5)
6. [Mo's algorithm with updates (3D Mo)](#t6)
7. [Tree-on-Mo via Euler tour](#t7)
8. [Hilbert-Mo ordering — implementation and benchmark](#t8)
9. [Benchmark: sqrt-decomp vs segment tree](#t9)
10. [Pick optimal B for a given workload](#t10)

---

<a name="t1"></a>
## Task 1 — Sqrt-decomposition for range sum + point updates

**Problem.** Implement a class supporting:
- `build(arr)` — `O(n)`.
- `update(i, v)` — `arr[i] = v`, `O(1)`.
- `query(l, r)` — `sum(arr[l..r])`, `O(√n)`.

**Test inputs**:
- Build on `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]`, query `(2, 7)` → expect `27`.
- Update index 5 to value `100`, query `(2, 7)` → expect `121`.

**Reference solution** is in `junior.md` Section 9.1 (Go/Java/Python full code). Verify it on the test inputs above.

---

<a name="t2"></a>
## Task 2 — Range max, non-invertible aggregate

**Problem.** Implement `RangeMax`: same interface as Task 1, but `query` returns the maximum in `arr[l..r]`. Updates cost `O(√n)`.

**Java (full code):**
```java
public final class RangeMax {
    private final int[] arr;
    private final int[] bmax;
    private final int B;

    public RangeMax(int[] a) {
        int n = a.length;
        this.B = Math.max(1, (int) Math.ceil(Math.sqrt(n)));
        this.arr = a.clone();
        int nb = (n + B - 1) / B;
        this.bmax = new int[nb];
        for (int b = 0; b < nb; b++) {
            int lo = b * B, hi = Math.min((b + 1) * B, n);
            int m = Integer.MIN_VALUE;
            for (int i = lo; i < hi; i++) m = Math.max(m, arr[i]);
            bmax[b] = m;
        }
    }

    public void update(int i, int v) {
        arr[i] = v;
        int b = i / B;
        int lo = b * B, hi = Math.min((b + 1) * B, arr.length);
        int m = Integer.MIN_VALUE;
        for (int j = lo; j < hi; j++) m = Math.max(m, arr[j]);
        bmax[b] = m;
    }

    public int query(int l, int r) {
        int bl = l / B, br = r / B;
        int m = Integer.MIN_VALUE;
        if (bl == br) {
            for (int i = l; i <= r; i++) m = Math.max(m, arr[i]);
            return m;
        }
        for (int i = l; i < (bl + 1) * B; i++) m = Math.max(m, arr[i]);
        for (int b = bl + 1; b < br; b++)     m = Math.max(m, bmax[b]);
        for (int i = br * B; i <= r; i++)     m = Math.max(m, arr[i]);
        return m;
    }
}
```

**Test it.** Build on `[3, 1, 4, 1, 5, 9, 2, 6, 5, 3]`, queries:
- `query(0, 9)` → 9
- `query(0, 3)` → 4
- `query(6, 9)` → 6
After `update(5, -10)`, `query(0, 9)` → 6.

---

<a name="t3"></a>
## Task 3 — Range assign + range sum with lazy bucket tags

**Problem.** Implement `SqrtAssignSum` (see `middle.md` Section 6 for theory):
- `assign(l, r, v)`: set every `arr[i] = v` for `i` in `[l, r]`.
- `sum(l, r)`: return `arr[l] + ... + arr[r]`.

Both must be `O(√n)`.

**Python reference** appears in `middle.md` Section 6.1.

**Go skeleton (you finish):**
```go
package sqrtlazy

import "math"

type SqrtAssignSum struct {
    arr   []int64
    bsum  []int64
    lazy  []*int64   // nil means no lazy
    B, n  int
}

func New(a []int64) *SqrtAssignSum {
    n := len(a)
    B := int(math.Sqrt(float64(n)))
    if B < 1 { B = 1 }
    nb := (n + B - 1) / B
    s := &SqrtAssignSum{
        arr:  append([]int64{}, a...),
        bsum: make([]int64, nb),
        lazy: make([]*int64, nb),
        B:    B,
        n:    n,
    }
    for i, v := range a { s.bsum[i/B] += v }
    return s
}

func (s *SqrtAssignSum) flush(b int) {
    if s.lazy[b] == nil { return }
    lo, hi := b*s.B, min((b+1)*s.B, s.n)
    for i := lo; i < hi; i++ { s.arr[i] = *s.lazy[b] }
    // bsum was already set correctly when lazy was applied
    s.lazy[b] = nil
}

// TODO: implement Assign(l, r int, v int64) and Sum(l, r int) int64.

func min(a, b int) int { if a < b { return a }; return b }
```

**Test cases:**
- Build on `[1, 2, 3, 4, 5]`, `sum(0,4)` → 15.
- `assign(1, 3, 7)`, `sum(0,4)` → 1 + 7+7+7 + 5 = 27.
- `sum(2, 3)` → 14.

---

<a name="t4"></a>
## Task 4 — Mo's algorithm for count distinct

**Problem.** Given array `arr` and `q` queries `(l, r)`, output the count of distinct values in each `arr[l..r]`.

**Reference solution** is in `interview.md` Section P4 (Python and Go).

**Java (full code):**
```java
import java.util.*;

public class MoDistinct {
    static int B;

    static class Query {
        int l, r, idx;
        Query(int l, int r, int idx) { this.l = l; this.r = r; this.idx = idx; }
    }

    public static int[] solve(int[] arr, int[][] queries) {
        int n = arr.length, q = queries.length;
        B = Math.max(1, (int) Math.sqrt(n));
        int maxV = 0;
        for (int v : arr) maxV = Math.max(maxV, v);
        Query[] qs = new Query[q];
        for (int i = 0; i < q; i++) qs[i] = new Query(queries[i][0], queries[i][1], i);
        Arrays.sort(qs, (a, b) -> {
            int ba = a.l / B, bb = b.l / B;
            if (ba != bb) return ba - bb;
            return (ba % 2 == 0) ? a.r - b.r : b.r - a.r;
        });
        int[] freq = new int[maxV + 2];
        int distinct = 0;
        int[] ans = new int[q];
        int curL = 0, curR = -1;
        for (Query qq : qs) {
            while (curR < qq.r) { curR++; if (freq[arr[curR]]++ == 0) distinct++; }
            while (curL > qq.l) { curL--; if (freq[arr[curL]]++ == 0) distinct++; }
            while (curR > qq.r) { if (--freq[arr[curR]] == 0) distinct--; curR--; }
            while (curL < qq.l) { if (--freq[arr[curL]] == 0) distinct--; curL++; }
            ans[qq.idx] = distinct;
        }
        return ans;
    }

    public static void main(String[] args) {
        int[] arr = {1, 2, 1, 3, 2, 1, 4, 3};
        int[][] qs = {{0, 4}, {2, 7}, {0, 7}, {3, 5}};
        int[] out = solve(arr, qs);
        System.out.println(Arrays.toString(out)); // expected [3, 4, 4, 3]
    }
}
```

**Verify on:** `arr = [1, 2, 1, 3, 2, 1, 4, 3]`, queries `[(0,4), (2,7), (0,7), (3,5)]` → answers `[3, 4, 4, 3]`.

---

<a name="t5"></a>
## Task 5 — Mo's algorithm for mode frequency

**Problem.** For each query `(l, r)`, return the **frequency of the mode** in `arr[l..r]` (i.e., the count of the most-common element).

**Sketch:** Mo with `freq[]` and a `count_of_freq[]` array. Maintain `max_freq`. On `add(v)`: decrement `count_of_freq[freq[v]]`, increment `freq[v]`, increment `count_of_freq[freq[v]]`, update `max_freq` if exceeded. On `remove`: symmetric, with the tricky part being that `max_freq` may need to decrease — but only when `count_of_freq[max_freq] == 0`. Then decrement `max_freq` until `count_of_freq[max_freq] > 0`. The amortized cost is `O(1)` per add/remove due to the staircase argument.

**Python reference:**
```python
import math

def mo_mode_freq(arr, queries):
    n, q = len(arr), len(queries)
    B = max(1, int(math.sqrt(n)))
    maxV = max(arr) if arr else 0
    indexed = sorted([(l, r, i) for i, (l, r) in enumerate(queries)],
                     key=lambda x: (x[0] // B, x[1] if (x[0]//B)%2==0 else -x[1]))
    freq = [0] * (maxV + 2)
    cnt_of_freq = [0] * (n + 2)
    cnt_of_freq[0] = maxV + 1  # all values start at frequency 0
    max_freq = 0
    answers = [0] * q
    curL, curR = 0, -1

    def add(v):
        nonlocal max_freq
        cnt_of_freq[freq[v]] -= 1
        freq[v] += 1
        cnt_of_freq[freq[v]] += 1
        if freq[v] > max_freq:
            max_freq = freq[v]

    def remove(v):
        nonlocal max_freq
        cnt_of_freq[freq[v]] -= 1
        if cnt_of_freq[max_freq] == 0 and freq[v] == max_freq:
            max_freq -= 1
        freq[v] -= 1
        cnt_of_freq[freq[v]] += 1

    for l, r, idx in indexed:
        while curR < r: curR += 1; add(arr[curR])
        while curL > l: curL -= 1; add(arr[curL])
        while curR > r: remove(arr[curR]); curR -= 1
        while curL < l: remove(arr[curL]); curL += 1
        answers[idx] = max_freq
    return answers
```

**Test on:** `arr = [1, 1, 2, 2, 2, 3, 3]`, query `(0, 6)` → 3; query `(0, 1)` → 2.

---

<a name="t6"></a>
## Task 6 — Mo's algorithm with updates (3D Mo)

**Problem.** Implement Mo with updates for distinct-count: input is a sequence of operations (`Q l r`) and (`U i v`); return the answer to each query at the time it occurs.

**Reference Python solution** is in `middle.md` Section 4.1.

**Verify on:**
```
arr = [1, 2, 3, 1, 2]
ops:
  Q 0 4   → 3   (distinct = {1,2,3})
  U 2 1
  Q 0 4   → 2   (now {1,2})
  U 4 4
  Q 0 4   → 3   (now {1,2,4})
```

---

<a name="t7"></a>
## Task 7 — Tree-on-Mo via Euler tour

**Problem.** Given a tree with `n` nodes (with values), and `q` queries `(u, v)` asking for the count of distinct values on the path from `u` to `v`, answer all queries offline.

**Approach.** Build Euler tour (each node recorded twice: at `in[v]` and `out[v]`). LCA precomputation (binary lifting). Translate each path query to an array range query as described in `middle.md` Section 5. Apply Mo with a `inWindow[v]` toggle (since each node is recorded twice in the Euler array, toggling on add gives correct "is this node currently in the path?" tracking).

This is a multi-page implementation. Outline:
1. DFS to compute `in[v]`, `out[v]`, and the Euler array `tour[]` of length `2n`.
2. Binary-lifting LCA (`up[k][v]`).
3. Express each query `(u, v)` as a range `[L, R]` in `tour[]`, plus possibly an extra "include LCA" flag.
4. Run Mo on the `2n`-length `tour[]` array, with `add` toggling membership.

**Hint:** see CP-Algorithms "Mo's algorithm on trees" for the complete walk-through.

---

<a name="t8"></a>
## Task 8 — Hilbert-Mo ordering — implementation and benchmark

**Problem.** Modify your Mo implementation from Task 4 to use Hilbert ordering instead of `(l/B, r)` sort. Benchmark both versions on `n = q = 10⁵` random inputs.

**Python:**
```python
def hilbert_d(x, y, order):
    rx = ry = 0; d = 0
    s = (1 << order) // 2
    while s > 0:
        rx = 1 if (x & s) > 0 else 0
        ry = 1 if (y & s) > 0 else 0
        d += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                x = s - 1 - x; y = s - 1 - y
            x, y = y, x
        s //= 2
    return d

# Replace sort key in Mo:
order = (n - 1).bit_length() + 1
indexed.sort(key=lambda q: hilbert_d(q[0], q[1], order))
```

**Expect:** Hilbert variant should run 1.5–2.5x faster on random Mo workloads, due to reduced pointer travel.

---

<a name="t9"></a>
## Task 9 — Benchmark: sqrt-decomp vs segment tree

**Problem.** Implement both:
- Sqrt-decomp range-sum + point update (Task 1).
- Standard segment tree range-sum + point update.

Time both at `n = 10⁴`, `10⁵`, `10⁶`. Use random queries (50% updates, 50% range-sum queries).

**Expected outcome:**
- `n = 10⁴`: sqrt-decomp ~1.5x faster.
- `n = 10⁵`: roughly tied.
- `n = 10⁶`: segment tree ~2x faster.

**Document the crossover** in a table and explain why (cache behavior, branch prediction, vectorizability).

---

<a name="t10"></a>
## Task 10 — Pick optimal `B` for a given workload

**Problem.** Given a workload with `n = 10⁵`, `q_queries = 1000`, and `u_updates = 10000` on a non-invertible aggregate (range min), find the block size `B` that minimizes total time `u·B + q·(B + n/B)`.

**Analytical answer.** Take derivative w.r.t. `B`:
```
d/dB (uB + qB + qn/B) = u + q - qn/B² = 0
B² = qn / (u + q)
B  = sqrt(q·n / (u + q))
   = sqrt(1000 · 10⁵ / 11000)
   = sqrt(9090.9)
   ≈ 95
```

So `B ≈ 95` (vs the default `√n ≈ 316`). With heavy updates we want **smaller** buckets — updates cost `O(B)`, so smaller `B` helps updates more than it hurts queries.

**Verify empirically.** Implement the structure parameterized by `B` (don't hard-code `√n`!). Time the workload at `B = 50, 95, 150, 316, 500, 1000`. The minimum should sit near 95.

**Reflect.** For balanced query+update workloads with **invertible** aggregates, updates are `O(1)` regardless of `B`, so plain `B = √n` is optimal. The workload-aware formula only matters for non-invertible aggregates.

---

## Bonus: bring your own problem

Find a Codeforces problem tagged "sqrt-decomposition" or "Mo's algorithm" and solve it. Suggested:

- **CF 86D** "Powerful array" — Mo with sum of `freq²`.
- **CF 375D** "Tree and Queries" — tree-on-Mo.
- **CF 617E** "XOR and Favorite Number" — Mo on prefix XOR, count pairs.
- **CF 940F** "Machine Learning" — Mo with updates.
- **SPOJ DQUERY** — distinct values (the textbook starter).
- **SPOJ KQUERY** — count `> k` in range; sqrt-decomp with sorted buckets.

Solving 2-3 of these end-to-end will lock in the patterns more than any reading.

---

## Self-check

After completing the tasks you should be able to:

- [ ] Implement sqrt-decomp range sum + point update from a blank file in under 5 minutes.
- [ ] Explain why `B = √n` minimizes work, citing AM-GM.
- [ ] State when sqrt-decomp beats segment tree in practice (small `n`, cache behavior).
- [ ] Write Mo's algorithm template; identify which problems require offline access.
- [ ] Derive the optimal `B` for arbitrary `(u, q)` workloads.
- [ ] Translate a tree path query into a 1D Mo query via Euler tour.
- [ ] Implement Hilbert ordering and explain the 2-3x speedup.

If any item is fuzzy, re-read the corresponding section of `junior.md` / `middle.md` and try the task again.
