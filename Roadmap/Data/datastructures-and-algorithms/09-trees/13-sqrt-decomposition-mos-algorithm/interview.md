# Square Root Decomposition & Mo's Algorithm — Interview Problems

> **Read time: ~45 minutes** · **Audience:** Candidates preparing for top-tier interviews where sqrt-decomp or Mo is the elegant answer to a tricky range-query problem.

These problems span easy "implement range sum" warmups to medium-hard offline-query puzzles that justify Mo's algorithm. Each has Go, Java, and Python solutions.

---

## Table of Contents

1. [P1: Range Sum with Point Updates — Sqrt Style (LC 307)](#p1)
2. [P2: Range Maximum Query (Static or with Updates)](#p2)
3. [P3: Range Sum 2D (LC 308)](#p3)
4. [P4: Count Distinct in Range (SPOJ DQUERY)](#p4)
5. [P5: K-th Most Frequent in Range](#p5)
6. [P6: Range Mode Query](#p6)
7. [P7: Subarray XOR Equals K (Mo over prefix XORs)](#p7)
8. [P8: Range Frequency of Value (sqrt-decomp baseline)](#p8)
9. [P9: Range Assign + Range Sum](#p9)
10. [P10: Number of Inversions in `arr[l..r]` (offline Mo)](#p10)

---

<a name="p1"></a>
## P1: Range Sum with Point Updates — Sqrt Style (LC 307)

**Problem.** Implement `NumArray` supporting `update(i, val)` and `sumRange(l, r)`. (LeetCode 307.) The accepted O(log n) solutions use BITs or segment trees; here we present the sqrt-decomp alternative.

**Approach.** Bucket size `B = ⌈√n⌉`. Maintain `bucketSum[]`. Update is `O(1)`; query is `O(√n)`.

**Python:**
```python
import math

class NumArray:
    def __init__(self, nums):
        self.arr = list(nums)
        n = len(nums)
        self.B = max(1, math.ceil(math.sqrt(n)))
        self.bsum = [0] * ((n + self.B - 1) // self.B)
        for i, v in enumerate(nums):
            self.bsum[i // self.B] += v

    def update(self, i, val):
        self.bsum[i // self.B] += val - self.arr[i]
        self.arr[i] = val

    def sumRange(self, l, r):
        B = self.B
        bl, br = l // B, r // B
        if bl == br:
            return sum(self.arr[l:r + 1])
        ans = sum(self.arr[l:(bl + 1) * B])
        for b in range(bl + 1, br):
            ans += self.bsum[b]
        ans += sum(self.arr[br * B:r + 1])
        return ans
```

**Go:**
```go
type NumArray struct {
    arr  []int
    bsum []int
    B    int
}

func Constructor(nums []int) NumArray {
    n := len(nums)
    B := 1
    for B*B < n { B++ }
    nb := (n + B - 1) / B
    na := NumArray{arr: append([]int{}, nums...), bsum: make([]int, nb), B: B}
    for i, v := range nums { na.bsum[i/B] += v }
    return na
}

func (n *NumArray) Update(i, val int) {
    n.bsum[i/n.B] += val - n.arr[i]
    n.arr[i] = val
}

func (n *NumArray) SumRange(l, r int) int {
    bl, br := l/n.B, r/n.B
    ans := 0
    if bl == br {
        for i := l; i <= r; i++ { ans += n.arr[i] }
        return ans
    }
    for i := l; i < (bl+1)*n.B; i++ { ans += n.arr[i] }
    for b := bl + 1; b < br; b++ { ans += n.bsum[b] }
    for i := br * n.B; i <= r; i++ { ans += n.arr[i] }
    return ans
}
```

**Java:**
```java
class NumArray {
    int[] arr; long[] bsum; int B;
    public NumArray(int[] nums) {
        int n = nums.length;
        this.B = Math.max(1, (int)Math.ceil(Math.sqrt(n)));
        this.arr = nums.clone();
        this.bsum = new long[(n + B - 1) / B];
        for (int i = 0; i < n; i++) bsum[i / B] += nums[i];
    }
    public void update(int i, int val) {
        bsum[i / B] += val - arr[i];
        arr[i] = val;
    }
    public int sumRange(int l, int r) {
        int bl = l / B, br = r / B;
        long ans = 0;
        if (bl == br) { for (int i = l; i <= r; i++) ans += arr[i]; return (int)ans; }
        for (int i = l; i < (bl + 1) * B; i++) ans += arr[i];
        for (int b = bl + 1; b < br; b++)     ans += bsum[b];
        for (int i = br * B; i <= r; i++)     ans += arr[i];
        return (int)ans;
    }
}
```

**Complexity.** `O(1)` update, `O(√n)` query, `O(n)` space.

---

<a name="p2"></a>
## P2: Range Maximum Query (Static or with Updates)

**Problem.** Given `arr` of size `n`, answer `q` queries `max(arr[l..r])` with possible point updates.

**Approach.** Bucket max + rescan on update.

**Python:**
```python
import math

class RangeMax:
    def __init__(self, a):
        self.arr = list(a); n = len(a)
        self.B = max(1, math.ceil(math.sqrt(n)))
        self.bmax = [max(self.arr[b*self.B:(b+1)*self.B], default=-(1<<62))
                     for b in range((n + self.B - 1)//self.B)]
    def update(self, i, v):
        self.arr[i] = v
        b = i // self.B
        lo, hi = b*self.B, min((b+1)*self.B, len(self.arr))
        self.bmax[b] = max(self.arr[lo:hi])
    def query(self, l, r):
        B = self.B; bl, br = l//B, r//B
        if bl == br: return max(self.arr[l:r+1])
        m = max(self.arr[l:(bl+1)*B])
        for b in range(bl+1, br): m = max(m, self.bmax[b])
        return max(m, max(self.arr[br*B:r+1]))
```

(Go/Java are direct translations.)

**Complexity.** `O(√n)` query and update. (For *static* range max use a Sparse Table — `senior.md` of `09-sparse-table-rmq` — `O(1)` query.)

---

<a name="p3"></a>
## P3: Range Sum 2D — LC 308 (Mutable 2D)

**Problem.** `NumMatrix` supporting `update(r, c, val)` and `sumRegion(r1, c1, r2, c2)` on an `n × m` matrix.

**Approach.** Block columns into `B = ⌈√m⌉` chunks. For each row, maintain row-bucket sums. Query: sum over rows `r1..r2`, each row contributing `O(√m)` work → total `O(n · √m)`. For dense queries on `n × m` ~ 200 × 200 this is fast enough.

(A 2D segment tree gives `O(log n · log m)` but is far more code; sqrt-decomp here is the *interview-friendly* answer.)

**Python sketch:**
```python
import math

class NumMatrix:
    def __init__(self, mat):
        self.mat = [row[:] for row in mat]
        self.n = len(mat); self.m = len(mat[0]) if mat else 0
        self.B = max(1, math.ceil(math.sqrt(self.m)))
        self.bsum = [[0]*((self.m + self.B - 1)//self.B) for _ in range(self.n)]
        for r in range(self.n):
            for c, v in enumerate(self.mat[r]):
                self.bsum[r][c // self.B] += v

    def update(self, r, c, v):
        self.bsum[r][c // self.B] += v - self.mat[r][c]
        self.mat[r][c] = v

    def sumRegion(self, r1, c1, r2, c2):
        total = 0
        for r in range(r1, r2 + 1):
            bl, br = c1 // self.B, c2 // self.B
            if bl == br:
                total += sum(self.mat[r][c1:c2+1])
            else:
                total += sum(self.mat[r][c1:(bl+1)*self.B])
                for b in range(bl+1, br): total += self.bsum[r][b]
                total += sum(self.mat[r][br*self.B:c2+1])
        return total
```

**Complexity.** `O(n √m)` per query, `O(1)` per update, `O(n·m)` space.

---

<a name="p4"></a>
## P4: Count Distinct in Range (SPOJ DQUERY)

**Problem.** Given array `arr` and `q` offline queries `(l, r)`, for each query return the count of distinct values in `arr[l..r]`.

**Approach.** Mo's algorithm with `add`/`remove` updating a frequency table and a distinct counter. `O((n+q)√n)`.

**Python (full solution):**
```python
import sys
from math import isqrt

def solve():
    data = sys.stdin.read().split()
    p = 0
    n = int(data[p]); p += 1
    arr = [int(x) for x in data[p:p+n]]; p += n
    q = int(data[p]); p += 1
    queries = []
    for i in range(q):
        l, r = int(data[p]) - 1, int(data[p+1]) - 1
        queries.append((l, r, i)); p += 2

    B = max(1, isqrt(n))
    queries.sort(key=lambda x: (x[0] // B,
                                 x[1] if (x[0] // B) % 2 == 0 else -x[1]))

    freq = [0] * (max(arr) + 2)
    distinct = 0
    answers = [0] * q
    curL, curR = 0, -1

    for l, r, idx in queries:
        while curR < r:
            curR += 1
            if freq[arr[curR]] == 0: distinct += 1
            freq[arr[curR]] += 1
        while curL > l:
            curL -= 1
            if freq[arr[curL]] == 0: distinct += 1
            freq[arr[curL]] += 1
        while curR > r:
            freq[arr[curR]] -= 1
            if freq[arr[curR]] == 0: distinct -= 1
            curR -= 1
        while curL < l:
            freq[arr[curL]] -= 1
            if freq[arr[curL]] == 0: distinct -= 1
            curL += 1
        answers[idx] = distinct
    sys.stdout.write("\n".join(map(str, answers)) + "\n")
```

**Go (function form):**
```go
package mo

import (
    "math"
    "sort"
)

func CountDistinct(arr []int, queries [][2]int) []int {
    n, q := len(arr), len(queries)
    B := int(math.Sqrt(float64(n)))
    if B < 1 { B = 1 }
    maxV := 0
    for _, v := range arr { if v > maxV { maxV = v } }
    type qt struct{ l, r, i int }
    qs := make([]qt, q)
    for i, lr := range queries { qs[i] = qt{lr[0], lr[1], i} }
    sort.Slice(qs, func(i, j int) bool {
        bi, bj := qs[i].l/B, qs[j].l/B
        if bi != bj { return bi < bj }
        if bi%2 == 0 { return qs[i].r < qs[j].r }
        return qs[i].r > qs[j].r
    })
    freq := make([]int, maxV+2)
    distinct := 0
    ans := make([]int, q)
    curL, curR := 0, -1
    for _, qq := range qs {
        for curR < qq.r {
            curR++
            if freq[arr[curR]] == 0 { distinct++ }
            freq[arr[curR]]++
        }
        for curL > qq.l {
            curL--
            if freq[arr[curL]] == 0 { distinct++ }
            freq[arr[curL]]++
        }
        for curR > qq.r {
            freq[arr[curR]]--
            if freq[arr[curR]] == 0 { distinct-- }
            curR--
        }
        for curL < qq.l {
            freq[arr[curL]]--
            if freq[arr[curL]] == 0 { distinct-- }
            curL++
        }
        ans[qq.i] = distinct
    }
    return ans
}
```

**Java:** structurally identical; omitted for brevity (see `tasks.md` for the verbose listing).

**Complexity.** `O((n+q)√n)`.

---

<a name="p5"></a>
## P5: K-th Most Frequent in Range

**Problem.** For each offline query `(l, r, k)`, return the k-th most frequent value in `arr[l..r]`.

**Approach.** Mo's algorithm maintaining `freq[]` and an additional `count_of_freq[]` array where `count_of_freq[f]` = how many distinct values have frequency exactly `f` in the current window. On `add(v)`, decrement `count_of_freq[old_freq]`, increment `count_of_freq[old_freq + 1]`.

Query response: iterate `f = max_freq` downward, counting `k` distinct values. `O(max_freq)` per query in the worst case. Typically `max_freq ≤ √n` for Mo-compatible inputs (otherwise total work would exceed `n·q`), keeping the total within `O((n+q)·√n)`.

(For a more advanced bound, use `O(1)` query via additional data structures; the simple version suffices for interviews.)

---

<a name="p6"></a>
## P6: Range Mode Query

**Problem.** Find the value that appears most often in `arr[l..r]`. If ties, return the smallest index.

**Approach.** Mo's algorithm with `freq[]`, `max_freq`, and a tie-tracker. Add increments freq, possibly increases max_freq. Remove decrements freq; recomputing max_freq cheaply on decrement is the hard part — the standard trick is **not** to track max_freq accurately on remove (since Mo's pointers move both directions, it'd cost too much) but rather to maintain `which_value_at_freq[f]` as a set; when freq[v] increases from f to f+1, update both structures.

For interview brevity, accept `O((n+q)·√n)` with reasonable constants and a careful Mo skeleton.

---

<a name="p7"></a>
## P7: Subarray XOR Equals K (Mo over prefix XORs)

**Problem.** For each offline query `(l, r)`, count subarrays `[i, j]` of `arr[l..r]` with `arr[i] xor arr[i+1] xor ... xor arr[j] = k`.

**Approach.** Define `pref[i] = arr[0] xor ... xor arr[i-1]`. Then `xor(arr[i..j]) = pref[j+1] xor pref[i] = k` iff `pref[i] = pref[j+1] xor k`. The problem reduces to "count pairs of prefix-XOR values `(a, b)` in some range such that `a xor b = k`".

Run Mo on the prefix-XOR array. `add(v)`: increment count of pairs by `freq[v xor k]`, then `freq[v]++`. `remove(v)`: `freq[v]--`, then decrement pair count by `freq[v xor k]`.

`O((n+q)·√n)`.

(Note: this technique generalizes to many "count pairs `(i, j)` in `[l, r]` with some predicate" problems.)

---

<a name="p8"></a>
## P8: Range Frequency of Value (sqrt-decomp baseline)

**Problem.** Given array `arr` and queries `(l, r, v)`, count how many times `v` appears in `arr[l..r]`.

**Approach 1 (preprocessing).** Group indices by value: `pos[v] = sorted list of indices where arr[i] == v`. Query: binary-search `pos[v]` for the count in `[l, r]`. `O(log n)` per query. **This beats sqrt-decomp.**

**Approach 2 (sqrt-decomp baseline).** Per bucket, store a hashmap `freq_in_bucket[b][v] = count of v in bucket b`. Query: walk partial buckets element-by-element, sum `freq_in_bucket[b][v]` for full middles. `O(√n)` query, `O(n)` space.

The takeaway for interviews: **always ask if there's a smarter precomputation**. Sqrt-decomp is a fallback when no smart structure exists.

---

<a name="p9"></a>
## P9: Range Assign + Range Sum

**Problem.** Support: `assign(l, r, v)` (set every `arr[i] = v` for `i ∈ [l, r]`) and `sum(l, r)`.

**Approach.** Sqrt-decomp with lazy bucket tags (see `middle.md` Section 6 for full code). For each bucket maintain `bucketSum[b]` and an optional `bucketLazy[b] = v` meaning "every element in this bucket is conceptually v". Flush lazy when partial access is needed.

**Complexity.** `O(√n)` per op.

For interviews: this is the cleanest problem to demonstrate the lazy-bucket pattern; segment-tree lazy propagation is the standard alternative but is 2x the code.

---

<a name="p10"></a>
## P10: Number of Inversions in `arr[l..r]` (offline Mo)

**Problem.** For each offline query `(l, r)`, count the number of inversions in `arr[l..r]` (pairs `i < j` with `arr[i] > arr[j]`).

**Approach.** Mo's algorithm. `add(x)` extends the window; we need to count how many elements in the current window are `> x` (if extending right) or `< x` (if extending left).

Maintain a **Fenwick tree (BIT)** over coordinate-compressed values, supporting "count elements `> x`" in `O(log n)`. Each `add`/`remove` triggers an `O(log n)` BIT query plus a BIT update.

Total: `O((n+q) · √n · log n)`. For `n = q = 10⁵`, about `10⁸` ops — fits in 2-3 seconds.

Note: this combines sqrt-decomp (Mo) with a BIT, illustrating that Mo composes with other structures cleanly.

---

## Summary table

| Problem | Technique | Complexity |
|---|---|---|
| Range sum + point updates | Sqrt-decomp invertible | `O(1)` upd, `O(√n)` qry |
| Range max + point updates | Sqrt-decomp non-invertible | `O(√n)` upd & qry |
| 2D mutable range sum | Per-row sqrt-decomp | `O(n√m)` qry |
| Count distinct (offline) | Mo's algorithm | `O((n+q)√n)` |
| K-th most frequent | Mo + count_of_freq | `O((n+q)√n)` |
| Range mode | Mo with tie-tracker | `O((n+q)√n)` |
| Subarray XOR = k | Mo on prefix XORs | `O((n+q)√n)` |
| Range freq of value | Sorted positions + binsearch | `O(log n)` qry — beats Mo |
| Range assign + range sum | Sqrt-decomp with lazy tags | `O(√n)` per op |
| Inversions in range | Mo + Fenwick | `O((n+q)√n log n)` |

## Tips for the interview

- **Always state the offline requirement** when proposing Mo. Interviewers sometimes test whether you noticed.
- **Mention the `B = √n` choice and the AM-GM justification.** Shows you understand why, not just how.
- **Discuss Hilbert/2-block Mo as a constant-factor optimization** if pressed on performance.
- **Compare to segment trees** explicitly. Sqrt-decomp is easier to code; segment trees are asymptotically faster.
- **Code the template once**, then for each new problem only change `add`, `remove`, and the answer-extraction step. This pattern-driven approach impresses interviewers.

---

## Further Reading
- LeetCode 307, 308 (sqrt-decomp friendly).
- SPOJ DQUERY (count distinct), GIVEAWAY (range geq k).
- Codeforces 86D (Powerful array — mode/sum-of-freq-squared), 375D (Tree and Queries — tree-on-Mo).
- Continue with `tasks.md` for hands-on practice.
