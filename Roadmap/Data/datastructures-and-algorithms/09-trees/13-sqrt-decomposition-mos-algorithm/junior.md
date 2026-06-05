# Square Root Decomposition — Junior Level

> **Read time: ~40 minutes** · **Audience:** Students who already know arrays, prefix sums, and have at least heard of segment trees.

Square Root Decomposition (often abbreviated **sqrt-decomp** or **block decomposition**) is the **simplest non-trivial data-structure technique** for range queries you will ever learn. It is the algorithm you reach for when you need range sums, range mins, or range frequencies but you do *not* want to recurse, do *not* want to debug a segment tree, and do *not* mind an `O(√n)` factor instead of `O(log n)`.

The idea is gloriously simple: chop the array into roughly `√n` chunks (called **buckets** or **blocks**), each of size roughly `√n`. For every bucket, keep one precomputed summary (the sum of its elements, the min, the max, a frequency table — whatever you need). To answer a range query `[l, r]`, you walk the at-most-two **partial buckets** at the ends element by element, then combine the precomputed summaries of every **full bucket** strictly between them. The total work is `O(√n + √n + √n) = O(√n)` per query.

This document teaches you sqrt-decomposition so concretely that you can implement it from scratch in any language in under twenty lines, debug it without a recursion tree, and reach for it confidently whenever you see "n ≤ 10⁵, q ≤ 10⁵, range queries, point updates" on a problem statement. We will also introduce **Mo's algorithm** at a junior-friendly level — the offline-query reordering trick that turns naive `O(n)` per-query subroutines into amortized `O(√n)`.

Sqrt-decomposition is grouped under "trees" in this roadmap because it is the canonical, recursion-free **alternative** to segment trees. You will frequently choose between the two for the same class of problems.

---

## Table of Contents

1. [Introduction — Why √n Buckets](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Three Pieces of Every Query](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons vs Segment Tree](#pros-and-cons)
8. [Step-by-Step Walkthrough](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — The Partial/Full/Partial Trichotomy](#patterns)
11. [Error Handling](#errors)
12. [Performance Tips — Choosing B](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — Why √n Buckets

Suppose you have an integer array of size `n = 1,000,000` and a stream of `q = 100,000` queries, each asking for the **sum of `arr[l..r]`** for arbitrary `l, r`. Three naive options:

1. **Brute force per query.** Loop from `l` to `r`. Worst case `O(n)` per query. Total `O(n · q) = 10¹¹` operations. Far too slow.
2. **Prefix sums.** Precompute `pref[i] = arr[0] + arr[1] + ... + arr[i-1]`. Each query is `pref[r+1] - pref[l]` in `O(1)`. Total `O(n + q)`. Beautiful — but if a single element of `arr` changes, you must rebuild the prefix array in `O(n)`. With both queries *and* updates, prefix sums collapse.
3. **Segment tree.** `O(log n)` per query and per update, `O(n)` space. Works perfectly. But: 60+ lines of recursive code, easy to get wrong, painful to debug if you've never written one.

Sqrt-decomposition is option 4 — the **middle ground**:

- Partition the array into `⌈n / B⌉` buckets, where the block size `B = ⌈√n⌉ ≈ 1000` for `n = 10⁶`.
- For each bucket, precompute its sum (or min, or whatever aggregate you need).
- A range query `[l, r]` is answered by walking the two partial end-buckets element by element and combining the precomputed sums of all full middle buckets. Cost: about `B + n/B + B = 2B + n/B` operations. This is minimized at `B = √n`, giving roughly `2√n ≈ 2000` ops per query.
- A point update `arr[i] = v` recomputes (or differentially updates) the affected bucket's aggregate in `O(B) = O(√n)`, or `O(1)` for invertible operations like sum.

For `n = 10⁶`, `q = 10⁵`, this is about `2 × 10⁵ × 10³ = 2 × 10⁸` operations total — fast enough to run in well under a second. And the implementation fits in twenty-five lines.

The single most important insight is the arithmetic: **the function `f(B) = B + n/B` is minimized at `B = √n`** by AM-GM inequality, with minimum value `2√n`. Any choice of bucket size other than around `√n` makes either the partial-end work or the full-middle work too expensive. This is why the name has "square root" in it.

Sqrt-decomposition does not stop at sums. The same partition powers:

- Range min / max / GCD with point updates.
- Range frequency counts and mode (with extra bookkeeping).
- Range distinct counts (via **Mo's algorithm**, covered in `middle.md`).
- Lazy range-assignment + range-sum hybrids that are notoriously simpler in sqrt-decomp than in segment trees (see `senior.md`).
- Even **2D** versions: tile a matrix into `√n × √n` blocks.

---

<a name="prerequisites"></a>
## 2. Prerequisites

Before diving in you should be comfortable with:

1. **Arrays and indexed access.** Random access to `arr[i]` in `O(1)`.
2. **Prefix sums.** Understanding why `pref[r+1] - pref[l]` works tells you exactly half of sqrt-decomp: it's a localized prefix sum *within* each bucket.
3. **Basic algebra of √n.** You should know that `√10⁶ = 10³`, `√10⁸ = 10⁴`, and that `B + n/B` is minimized at `B = √n`. We do *not* require calculus — the AM-GM inequality (`a + b ≥ 2√(ab)`) is enough.
4. **Loops and integer arithmetic.** Division, modulo, and `⌈x⌉` (ceiling) — sqrt-decomp leans heavily on `i / B` to compute "which bucket is index `i` in?".
5. **Optional but helpful:** know what a **segment tree** is (even superficially) so you can appreciate the tradeoff. We compare them in [Section 7](#pros-and-cons).

If you've never written a prefix sum array, do that first. The rest of this document will then feel like a natural generalization.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **Bucket / Block** | A contiguous chunk of `B` consecutive array elements. The array is partitioned into `⌈n / B⌉` non-overlapping buckets. |
| **Block size `B`** | The number of elements per bucket. The classic choice is `B = ⌈√n⌉`. Tunable for cache reasons. |
| **Bucket index** | For array index `i`, its bucket is `i / B` (integer division). |
| **Bucket aggregate** | A precomputed value per bucket: the sum, min, max, frequency map, count of distinct elements, etc. |
| **Partial bucket** | The two end-buckets in a range query `[l, r]` that are *not* entirely inside the range — only some of their elements are. We walk them element by element. |
| **Full bucket** | A bucket entirely contained in `[l, r]`. We read its precomputed aggregate in `O(1)` instead of touching its elements. |
| **Same-bucket query** | A query where `l` and `r` fall in the same bucket. Handled as one element-by-element pass; there are no "full middle" buckets. |
| **Point update** | Change the value at a single index `arr[i] = v`. Affects exactly one bucket's aggregate. |
| **Range update** | Change values across a range `[l, r]`. Naively `O(r - l + 1)`; with lazy bucket marks it can be `O(√n)`. |
| **Offline queries** | All queries are given in advance; you may permute the order in which you process them. Required for Mo's algorithm. |
| **Online queries** | Queries arrive one at a time and you must answer before seeing the next. Sqrt-decomp handles online; Mo's algorithm does not. |
| **Mo's algorithm** | A query-reordering trick (introduced in `middle.md`) that turns naive `O(n)` per-query update into amortized `O(√n)` over `q` queries, total `O((n+q)√n)`. |
| **Block-decomp** | Synonym for sqrt-decomposition. The word "block" is more common in Russian/Chinese competitive programming literature. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Three Pieces of Every Query

### 4.1 The partition

Given an array of size `n` and a block size `B` (let `B = ⌈√n⌉` by default), divide the array into buckets:

```
B = 4, n = 10
indices:  0  1  2  3  | 4  5  6  7  | 8  9
buckets:  bucket 0     bucket 1      bucket 2
```

Bucket `b` covers indices `[b·B, min((b+1)·B, n) - 1]`. The last bucket may be smaller.

For each bucket, precompute an aggregate. For sum:

```
bucketSum[b] = arr[b·B] + arr[b·B + 1] + ... + arr[min((b+1)·B, n) - 1]
```

### 4.2 The trichotomy of a range query

To answer `query(l, r)` (sum from index `l` to `r` inclusive):

- Let `bl = l / B`, `br = r / B`.
- **Case A — same bucket** (`bl == br`): just sum `arr[l..r]` element by element. Cost ≤ `B`.
- **Case B — different buckets** (`bl < br`):
  1. **Partial left**: sum `arr[l..(bl+1)·B - 1]` element by element.
  2. **Full middle**: for each bucket `b` from `bl+1` to `br-1`, add `bucketSum[b]`.
  3. **Partial right**: sum `arr[br·B..r]` element by element.

Total cost in Case B: at most `B` (left partial) + at most `n/B` (full middles) + at most `B` (right partial) = `O(B + n/B)`.

### 4.3 The point update

To set `arr[i] = v`:

1. Determine bucket `b = i / B`.
2. Update the aggregate. For invertible operations like sum: `bucketSum[b] += v - arr[i]; arr[i] = v`. Cost `O(1)`.
3. For non-invertible operations like min/max: recompute `bucketSum[b]` from scratch by scanning the whole bucket. Cost `O(B) = O(√n)`.

Notice the asymmetry: **sum is invertible** (you can subtract the old contribution), so updates are `O(1)`. **Min/max are not invertible** (removing the smallest element may force you to find the next smallest), so updates are `O(√n)`. This generalizes to *any* group-like operation: invertible → `O(1)` update; only monoid-like → `O(√n)` update.

### 4.4 Why `B = √n` minimizes work

The query cost is `B + n/B`. Treat `B` as a continuous variable; take the derivative:

```
d/dB (B + n/B) = 1 - n/B² = 0  ⇒  B² = n  ⇒  B = √n
```

The minimum value is `2√n`. Any other `B` is strictly worse. For example:

| B | Query cost B + n/B (n = 10⁶) |
|---|---|
| 100 | 100 + 10,000 = 10,100 |
| 500 | 500 + 2,000 = 2,500 |
| **1000 (= √n)** | **1000 + 1000 = 2,000** ← minimum |
| 2000 | 2,000 + 500 = 2,500 |
| 10,000 | 10,000 + 100 = 10,100 |

This is why `B = √n` is the canonical choice. We tune away from it only for cache reasons (see `professional.md`) or for workload reasons (heavy updates vs heavy queries — see `middle.md`).

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Operation | Sqrt-decomp | Segment tree | Fenwick tree |
|---|---|---|---|
| **Build** | `O(n)` | `O(n)` | `O(n)` |
| **Point update (invertible)** | `O(1)` | `O(log n)` | `O(log n)` |
| **Point update (non-invertible, e.g. min)** | `O(√n)` | `O(log n)` | not supported |
| **Range query (any monoid)** | `O(√n)` | `O(log n)` | `O(log n)` for sums only |
| **Range update + range query** | `O(√n)` with lazy buckets | `O(log n)` with lazy propagation | `O(log n)` with two BITs (sum only) |
| **Space** | `O(n + n/B) = O(n)` | `O(4n)` | `O(n)` |
| **Code size (idiomatic)** | ~25 lines | ~60 lines | ~15 lines |
| **Recursion?** | No | Yes | No |

Sqrt-decomp is **asymptotically slower** than segment trees but **smaller-constant and simpler-code** for `n ≤ 10⁵`. Past `n ≈ 10⁶`, segment trees pull ahead consistently.

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 City divided into neighborhoods

Imagine a city directory laid out as one big alphabetical list of `n = 10,000` residents. You're asked: "how many residents live between street #2,300 and street #7,800?"

The naive answer is to count one by one — `O(n)`. Instead, partition the directory into `100` neighborhoods of ~`100` residents each. For each neighborhood, precompute a "**summary card**" with its total resident count. Now your query:

- Walk the partial **first** neighborhood (street 2,300 falls inside neighborhood #23 — count the matching residents in its right tail).
- For every fully-contained middle neighborhood (#24 through #77) — just read the summary card. `54 × O(1)` work.
- Walk the partial **last** neighborhood (street 7,800 falls inside neighborhood #78 — count residents in its left head).

You touched at most `100 + 54 + 100 = 254` residents, not `5,500`.

### 6.2 Library shelves and index cards

Each shelf holds `√n` books. The librarian keeps an index card per shelf listing "how many books on this shelf are by a Russian author?" — a per-bucket aggregate. To answer "how many Russian-authored books are in shelves 5 to 27?", walk shelves 5 and 27 book by book (partial), then sum the index cards for shelves 6..26 (full middles).

### 6.3 Time-series log files rolled hourly

A web service logs requests, rolling to a new file every hour. Each hourly file is a "bucket". Per-bucket aggregates: total requests, error count, p99 latency. A range query "how many errors between 14:30 and 23:15?" reads the partial 14:30..14:59 file, sums the precomputed counts for 15:00..22:59, then reads the partial 23:00..23:15 file. This is sqrt-decomp in production, and you've probably used it without realizing.

### 6.4 BLAS GEMM tiles

Numerical linear algebra libraries like OpenBLAS partition matrices into tiles sized to fit the L1 cache, then compute matrix-matrix multiplication tile by tile. Each tile's contribution to the output is computed in cache-resident bursts — the same partition-then-aggregate idea, tuned for hardware.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons vs Segment Tree

### Pros of sqrt-decomp
- **Drastically simpler to code.** ~25 lines vs ~60. No recursion, no lazy propagation gymnastics.
- **No recursion stack.** Friendlier to tiny embedded targets and very deep arrays.
- **Better constants on small/medium n.** Tight inner loops vectorize well; segment-tree node traversal has worse cache behavior.
- **Supports non-invertible operations** naturally (rebuild a bucket in `O(√n)`). Min/max/GCD just work.
- **Supports arbitrary aggregates** including "weird" ones like "most frequent element in this bucket", which are awkward in segment trees because you need a special merge.
- **Easy to extend with lazy bucket marks.** Range assignment + range sum is famously cleaner in sqrt-decomp than in a segment tree.
- **Foundation for Mo's algorithm**, an entire family of offline-query techniques.

### Cons of sqrt-decomp
- **Asymptotically slower.** `O(√n)` vs `O(log n)`. At `n = 10⁹` segment tree is `~30` vs sqrt-decomp `~31,623`.
- **Harder to make persistent.** Segment trees admit clean path-copying for persistence; sqrt-decomp does not.
- **Doesn't generalize to arbitrary trees as smoothly.** Heavy-light decomposition needs segment trees; sqrt-on-tree is possible but trickier.
- **Block size B must be tuned** if you care about constant factors. Segment trees have no tuning knob.

### Rule of thumb

- `n ≤ 10⁵`, `q ≤ 10⁵`: sqrt-decomp is fine. Code in 10 minutes, submit.
- `n ≤ 10⁶` with simple queries: still sqrt-decomp territory; segment tree's `log` advantage is offset by code complexity and cache misses.
- `n > 10⁶` or extremely tight time limit: segment tree or Fenwick tree.
- Offline-only problem with "count distinct in `[l, r]`" or similar: Mo's algorithm on top of sqrt-decomp dominates.

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough

We work with `arr = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]` of size `n = 10`. Pick `B = ⌈√10⌉ = 4`.

### 8.1 Build phase

Partition:
```
Index:    0  1  2  3 | 4  5  6  7 | 8  9
Value:    3  1  4  1 | 5  9  2  6 | 5  3
Bucket:   0          | 1          | 2
```

Compute bucket sums:
- `bucketSum[0] = 3 + 1 + 4 + 1 = 9`
- `bucketSum[1] = 5 + 9 + 2 + 6 = 22`
- `bucketSum[2] = 5 + 3 = 8`

Total build cost: `O(n) = 10` additions.

### 8.2 Query `sum(2, 8)` (sum of `arr[2..8]` inclusive)

Compute `bl = 2 / 4 = 0`, `br = 8 / 4 = 2`. Different buckets, so trichotomy:

**Partial left**: walk `arr[2..3]` (indices in bucket 0 from `l=2` to `(0+1)·4 - 1 = 3`):
```
arr[2] = 4 → answer = 4
arr[3] = 1 → answer = 5
```

**Full middles**: buckets `bl+1 = 1` to `br - 1 = 1`. Just bucket 1.
```
answer += bucketSum[1] = 22 → answer = 27
```

**Partial right**: walk `arr[8..8]` (indices in bucket 2 from `br·B = 8` to `r = 8`):
```
arr[8] = 5 → answer = 32
```

**Verify**: `3+1+4+1+5+9+2+6+5+3` → take indices 2..8 → `4+1+5+9+2+6+5 = 32`. Correct.

Touched elements: 2 (left partial) + 1 (full middle aggregate) + 1 (right partial) = 4 reads, vs 7 for the naive scan. The savings grow with `n`.

### 8.3 Update `arr[5] = 100`

Bucket of index 5: `b = 5 / 4 = 1`. Old value `arr[5] = 9`.

Invertible (sum) update: `bucketSum[1] += 100 - 9 = 91`. So `bucketSum[1]` becomes `22 + 91 = 113`. Then `arr[5] = 100`. `O(1)`.

For a min/max aggregate we'd instead rescan bucket 1: `min(5, 100, 2, 6) = 2`. `O(B)`.

### 8.4 Same-bucket query `sum(5, 7)`

`bl = 5 / 4 = 1`, `br = 7 / 4 = 1`. Same bucket → element-by-element from `l=5` to `r=7`:
```
arr[5] = 100, arr[6] = 2, arr[7] = 6  →  sum = 108
```

No partial/full split needed when `bl == br`.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

### 9.1 Range sum + point update (invertible)

**Go:**
```go
package sqrtdecomp

import "math"

type SqrtSum struct {
    arr       []int64
    bucketSum []int64
    B         int
}

func NewSqrtSum(a []int64) *SqrtSum {
    n := len(a)
    B := int(math.Ceil(math.Sqrt(float64(n))))
    if B == 0 {
        B = 1
    }
    nb := (n + B - 1) / B
    sd := &SqrtSum{arr: append([]int64{}, a...), bucketSum: make([]int64, nb), B: B}
    for i, v := range a {
        sd.bucketSum[i/B] += v
    }
    return sd
}

// Update arr[i] = v in O(1).
func (s *SqrtSum) Update(i int, v int64) {
    b := i / s.B
    s.bucketSum[b] += v - s.arr[i]
    s.arr[i] = v
}

// Query returns sum of arr[l..r] inclusive in O(sqrt(n)).
func (s *SqrtSum) Query(l, r int) int64 {
    bl, br := l/s.B, r/s.B
    var ans int64
    if bl == br {
        for i := l; i <= r; i++ {
            ans += s.arr[i]
        }
        return ans
    }
    // partial left
    for i := l; i < (bl+1)*s.B; i++ {
        ans += s.arr[i]
    }
    // full middles
    for b := bl + 1; b < br; b++ {
        ans += s.bucketSum[b]
    }
    // partial right
    for i := br * s.B; i <= r; i++ {
        ans += s.arr[i]
    }
    return ans
}
```

**Java:**
```java
public final class SqrtSum {
    private final long[] arr;
    private final long[] bucketSum;
    private final int B;

    public SqrtSum(long[] a) {
        int n = a.length;
        this.B = Math.max(1, (int) Math.ceil(Math.sqrt(n)));
        int nb = (n + B - 1) / B;
        this.arr = a.clone();
        this.bucketSum = new long[nb];
        for (int i = 0; i < n; i++) bucketSum[i / B] += a[i];
    }

    /** O(1) point update. */
    public void update(int i, long v) {
        int b = i / B;
        bucketSum[b] += v - arr[i];
        arr[i] = v;
    }

    /** O(sqrt n) inclusive range sum. */
    public long query(int l, int r) {
        int bl = l / B, br = r / B;
        long ans = 0;
        if (bl == br) {
            for (int i = l; i <= r; i++) ans += arr[i];
            return ans;
        }
        for (int i = l; i < (bl + 1) * B; i++) ans += arr[i];
        for (int b = bl + 1; b < br; b++)     ans += bucketSum[b];
        for (int i = br * B; i <= r; i++)     ans += arr[i];
        return ans;
    }
}
```

**Python:**
```python
import math

class SqrtSum:
    """Range sum + point update in O(sqrt n)."""

    def __init__(self, a):
        self.arr = list(a)
        n = len(a)
        self.B = max(1, math.ceil(math.sqrt(n)))
        nb = (n + self.B - 1) // self.B
        self.bucket_sum = [0] * nb
        for i, v in enumerate(a):
            self.bucket_sum[i // self.B] += v

    def update(self, i, v):
        """arr[i] = v in O(1)."""
        b = i // self.B
        self.bucket_sum[b] += v - self.arr[i]
        self.arr[i] = v

    def query(self, l, r):
        """sum(arr[l..r]) inclusive, O(sqrt n)."""
        B = self.B
        bl, br = l // B, r // B
        if bl == br:
            return sum(self.arr[l:r + 1])
        ans = sum(self.arr[l:(bl + 1) * B])
        for b in range(bl + 1, br):
            ans += self.bucket_sum[b]
        ans += sum(self.arr[br * B:r + 1])
        return ans
```

### 9.2 Range min + point update (non-invertible)

The only change is the bucket aggregate (now `min` instead of `sum`) and the update path (rescan the bucket).

**Go:**
```go
package sqrtdecomp

import "math"

type SqrtMin struct {
    arr       []int
    bucketMin []int
    B         int
}

const INF = int(1<<62)

func NewSqrtMin(a []int) *SqrtMin {
    n := len(a)
    B := int(math.Ceil(math.Sqrt(float64(n))))
    if B == 0 {
        B = 1
    }
    nb := (n + B - 1) / B
    sd := &SqrtMin{arr: append([]int{}, a...), bucketMin: make([]int, nb), B: B}
    for b := range sd.bucketMin {
        sd.bucketMin[b] = INF
    }
    for i, v := range a {
        if v < sd.bucketMin[i/B] {
            sd.bucketMin[i/B] = v
        }
    }
    return sd
}

// Update is O(sqrt n) because min is not invertible.
func (s *SqrtMin) Update(i, v int) {
    s.arr[i] = v
    b := i / s.B
    m := INF
    for j := b * s.B; j < (b+1)*s.B && j < len(s.arr); j++ {
        if s.arr[j] < m {
            m = s.arr[j]
        }
    }
    s.bucketMin[b] = m
}

func (s *SqrtMin) Query(l, r int) int {
    bl, br := l/s.B, r/s.B
    ans := INF
    if bl == br {
        for i := l; i <= r; i++ {
            if s.arr[i] < ans {
                ans = s.arr[i]
            }
        }
        return ans
    }
    for i := l; i < (bl+1)*s.B; i++ {
        if s.arr[i] < ans {
            ans = s.arr[i]
        }
    }
    for b := bl + 1; b < br; b++ {
        if s.bucketMin[b] < ans {
            ans = s.bucketMin[b]
        }
    }
    for i := br * s.B; i <= r; i++ {
        if s.arr[i] < ans {
            ans = s.arr[i]
        }
    }
    return ans
}
```

**Java:** (analogous — see `tasks.md` solution 2 for a complete listing.)

**Python:**
```python
import math

class SqrtMin:
    def __init__(self, a):
        self.arr = list(a)
        n = len(a)
        self.B = max(1, math.ceil(math.sqrt(n)))
        nb = (n + self.B - 1) // self.B
        self.bmin = [min(a[b * self.B:(b + 1) * self.B], default=float('inf'))
                     for b in range(nb)]

    def update(self, i, v):
        self.arr[i] = v
        b = i // self.B
        lo, hi = b * self.B, min((b + 1) * self.B, len(self.arr))
        self.bmin[b] = min(self.arr[lo:hi])

    def query(self, l, r):
        B = self.B
        bl, br = l // B, r // B
        if bl == br:
            return min(self.arr[l:r + 1])
        best = min(self.arr[l:(bl + 1) * B])
        for b in range(bl + 1, br):
            if self.bmin[b] < best:
                best = self.bmin[b]
        right = min(self.arr[br * B:r + 1])
        return min(best, right)
```

---

<a name="patterns"></a>
## 10. Coding Patterns — The Partial/Full/Partial Trichotomy

Every sqrt-decomp query follows the same shape:

```
function query(l, r):
    bl, br = l // B, r // B
    if bl == br:
        # same bucket: scan arr[l..r] directly
        for i in l..r: combine(arr[i])
        return result
    # partial left
    for i in l..(bl+1)*B - 1: combine(arr[i])
    # full middles
    for b in (bl+1)..br - 1:  combine(bucketAggregate[b])
    # partial right
    for i in br*B..r:         combine(arr[i])
    return result
```

Memorize this skeleton. Then for any new problem, you only have to decide:

1. **What is the combine operation?** Add, min, max, XOR, multiply mod, count, frequency-map merge…
2. **What is the bucket aggregate?** Sum, min, max, sorted list of bucket values, frequency table, …
3. **Is the operation invertible?** Sum and XOR yes (`O(1)` updates). Min/max/GCD no (`O(√n)` updates).

Once you've internalized this template, sqrt-decomposition becomes a one-decision algorithm: pick the right aggregate, plug into the template, ship.

---

<a name="errors"></a>
## 11. Error Handling

| Error | Cause | Fix |
|---|---|---|
| `IndexOutOfBounds` on the last bucket | Used `(b+1) * B` without clamping to `n` | Clamp: `min((b+1)*B, n)` |
| Wrong aggregate after update | Updated `arr[i]` but forgot to recompute or differentially update bucket | Always pair `arr[i] = v` with bucket-aggregate maintenance |
| `B = 0` from `floor(sqrt(0))` on empty input | Empty array edge | Special-case `n == 0`; or use `B = max(1, ceil(sqrt(n)))` |
| Stale aggregate after many updates (floating point) | Repeated subtraction accumulates error | Periodically rebuild buckets from scratch every `n` updates |
| Off-by-one boundaries | `l..(bl+1)*B - 1` vs `l..(bl+1)*B` | Triple-check inclusive vs exclusive; write a unit test on a 10-element array |

---

<a name="performance-tips"></a>
## 12. Performance Tips — Choosing B

1. **Default `B = round(sqrt(n))`.** Don't use `floor` blindly — for `n = 100`, `floor(sqrt(100)) = 10` is fine, but for `n = 99`, both 9 and 10 work; pick the one that minimizes `B + n/B` numerically.

2. **For heavy updates and few queries**, smaller `B` is sometimes better — updates touch a bucket of size `B`, so smaller `B` makes updates faster. With `u` updates and `q` queries: minimize `u·B + q·(B + n/B)` w.r.t. `B`, giving `B = sqrt(q·n / (q+u))`.

3. **For non-invertible aggregates** (min/max), updates already cost `O(√n)` — `B = √n` is still optimal.

4. **For cache-locality**, tune `B` to make a bucket fit in L1: `B · sizeof(element) ≤ L1_size / 2` (leave half for the aggregate array). For 32 KB L1 and 8-byte ints, `B ≈ 2048` works well.

5. **Watch out for tiny `n`**. If `n ≤ 100`, `B ≈ 10` makes both partial and full passes near-equivalent to a linear scan. Don't over-engineer.

6. **B as a power of 2** can let you replace `i / B` with `i >> k` and `i % B` with `i & (B-1)` — small but consistent speedup in tight inner loops.

7. **Some problems prefer `B = n^(2/3)`** instead of `√n` (notably Mo's algorithm with updates, covered in `middle.md`).

---

<a name="best-practices"></a>
## 13. Best Practices

- **Always clamp the last bucket** to `min((b+1)*B, n)`. Off-by-one on the tail bucket is the #1 bug.
- **Pick `B` once, store it in the struct.** Recomputing `ceil(sqrt(n))` every query is wasteful.
- **Use 64-bit aggregates** when summing 32-bit values to avoid overflow.
- **For min/max**, store the actual minimum per bucket, not the index — simpler and resilient to swap-style updates.
- **Test on edge cases**: `n = 1`, `n = 2`, query at the very start/end, query within one bucket, query spanning all buckets.
- **For online vs offline**: sqrt-decomp is online; if the problem allows reading all queries up front, you can probably do better with Mo's algorithm.
- **Document the precondition** of any non-invertible aggregate update (it costs `O(√n)`, not `O(1)`) so future readers don't pessimize.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Behavior |
|---|---|
| Empty array (`n = 0`) | Set `B = 1`, allocate zero buckets. All queries should error or return identity. |
| `n = 1` | One bucket of size 1; query and update degenerate to direct array access. |
| Single bucket fits whole array (`B ≥ n`) | Every query is the "same-bucket" case; sqrt-decomp degrades to linear scan. |
| Query covers entire array (`l = 0, r = n - 1`) | All buckets are full middles (or the two partials are empty); sum the aggregates only. |
| Query `l == r` | Same-bucket fast path; returns `arr[l]`. |
| Updates on read-only aggregate | Throw a clear "operation not supported"; some bucket aggregates (e.g. precomputed sorted lists) cannot be updated cheaply. |
| Negative numbers in min aggregate | Use a true sentinel (`INT64_MAX`), not `0`. |
| Overflow in sum | Use `int64`/`long`; or moduli for problems that require it. |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Using `floor(sqrt(n))` blindly.** For `n = 99`, `floor(sqrt(99)) = 9`; `9 + 99/9 = 9 + 11 = 20`, while `B = 10` gives `10 + 9 = 19`. Use `round` or test both.
2. **Forgetting to clamp the last bucket.** Accessing `arr[(b+1)*B - 1]` when that index is beyond `n - 1`.
3. **Updating `arr[i]` without updating the bucket aggregate.** Aggregate becomes stale — silent wrong answers.
4. **Recomputing `bucketSum[b]` from scratch on every update.** Costs `O(√n)` instead of `O(1)` for invertible operations.
5. **Mixing inclusive/exclusive endpoints.** `(bl+1)*B - 1` is the inclusive last index of bucket `bl`. Many bugs come from writing `(bl+1)*B` and getting one element of the next bucket too.
6. **Using sqrt-decomp where prefix sums suffice.** If you have no updates, prefix sums are `O(1)` per query — strictly better.
7. **Using `O(√n)` when `O(log n)` is required by the problem's time limit.** `n = 10⁷` with `q = 10⁶` is borderline for sqrt-decomp; segment tree is safer.
8. **Trying to "lazy-propagate" naively in sqrt-decomp.** Lazy works, but the bookkeeping (`bucketLazy[b]` + flush on partial access) is its own pattern; see `middle.md` and `tasks.md` task 3.
9. **Allocating a new bucket array on every query.** Build once in the constructor.
10. **Confusing "block size" with "block count".** The block *size* is `B`. The number of blocks is `⌈n / B⌉`. These are reciprocals when `B = √n`.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
SETUP
    B  = ceil(sqrt(n))         (or round, or tune)
    nb = ceil(n / B)
    for i in 0..n-1:
        bucketAggregate[i / B] = combine(bucketAggregate[i / B], arr[i])

QUERY(l, r):
    bl, br = l // B, r // B
    if bl == br:
        for i in l..r:                    ans = combine(ans, arr[i])
    else:
        for i in l..(bl+1)*B - 1:         ans = combine(ans, arr[i])
        for b in bl+1..br-1:              ans = combine(ans, bucketAggregate[b])
        for i in br*B..r:                 ans = combine(ans, arr[i])
    return ans

UPDATE(i, v):
    if combine is invertible:
        bucketAggregate[i//B] -= arr[i]   # remove old contribution
        bucketAggregate[i//B] += v        # add new
        arr[i] = v                        # O(1)
    else:
        arr[i] = v
        rescan bucket i//B for fresh aggregate   # O(B) = O(sqrt n)

COMPLEXITY
    Query:  O(sqrt n)
    Update: O(1) invertible | O(sqrt n) otherwise
    Space:  O(n + n/B) = O(n)
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. The visualizer renders the array as horizontal cells colored by bucket (alternating shades), with each bucket's aggregate displayed above it. Enter a query `(l, r)`: yellow cells animate the partial-left scan, green tiles light up over fully-contained middle buckets to show their aggregate is being reused, then yellow cells animate the partial-right scan. The accumulated answer ticks up in the side panel. An update `(i, v)` recolors a single cell and triggers a recompute animation on its bucket. Stats show `n`, `B`, the number of buckets, the last query result, and the number of elements visited (proving the `2B + n/B = 2√n` bound empirically).

Walking through 3 or 4 queries on a 16-element array makes the trichotomy second nature.

---

<a name="summary"></a>
## 18. Summary

- **Sqrt-decomposition** partitions an array of size `n` into `√n` buckets of size `√n`, precomputing one aggregate per bucket. Range queries scan two partial buckets and read aggregates of all full buckets in between — `O(√n)` total. Point updates cost `O(1)` (invertible ops) or `O(√n)` (non-invertible).
- **Why `B = √n`?** The query cost `B + n/B` is minimized at `B = √n` with value `2√n` by AM-GM.
- **Compared to segment trees**: simpler code, no recursion, better small-`n` constants, but `O(√n)` not `O(log n)`. Pick sqrt-decomp for `n ≤ 10⁵`, segment trees for larger or tighter time limits.
- **The partial/full/partial trichotomy** is the universal query shape. Memorize it; change only the aggregate and the combine operation per problem.
- **Common pitfalls**: not clamping the last bucket, forgetting to maintain the aggregate on updates, using `floor(sqrt(n))` instead of `round`, and confusing inclusive with exclusive bucket boundaries.
- **Next steps**: `middle.md` introduces **Mo's algorithm** — the offline-query reordering technique that compounds the sqrt idea to solve "count distinct in range" and similar problems in `O((n + q)√n)`.

Once you've internalized sqrt-decomposition you'll see it in unexpected places: BLAS tiles, cache-conscious databases, time-series rollups, and competitive-programming solutions where the segment tree would have been over-engineering. It is the friendliest member of the "divide the array into chunks and summarize" family — and the gateway to Mo's algorithm.

---

<a name="further-reading"></a>
## 19. Further Reading

- **CP-Algorithms (e-maxx)** — *"Sqrt Decomposition"* article. The canonical English-language reference. Includes range-min, range-sum, and the lazy variant for range updates.
- **Antti Laaksonen**, *Competitive Programmer's Handbook*, Chapter 27 (*Square Root Algorithms*). Free PDF; clearest textbook treatment.
- **Codeforces EDU** — *ITMO Academy: Sqrt Decomposition*, free interactive course with judges and step-by-step problems.
- **Codeforces blog by mango_lassi** — "Mo's algorithm and related techniques". Excellent intro to the offline-queries variant.
- **Halim & Halim**, *Competitive Programming 4*, Section 9.21 covers sqrt-decomposition and Mo's algorithm with concrete contest problems.
- **Continue with**: `middle.md` for Mo's algorithm, Mo with updates, and Hilbert ordering; `senior.md` for production usage and cache-aware blocking; `professional.md` for SIMD-accelerated partials and adaptive block sizing.
