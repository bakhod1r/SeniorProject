# Square Root Decomposition & Mo's Algorithm — Middle Level

> **Read time: ~30 minutes** · **Audience:** Engineers comfortable with sqrt-decomp basics, ready for offline-query magic, lazy bucket marks, and tree-flattening tricks.

`junior.md` covered the partition skeleton and `O(√n)` range queries with point updates. At the middle level we add:

1. **Mo's algorithm** — the offline-query reordering technique that achieves `O((n + q)√n)` for problems where no simple monoid aggregate exists (counting distinct elements, finding the mode, etc.).
2. **Mo with updates** — a 3D extension that handles a mix of queries and updates by sorting on `(l/B, r/B, t)` with `B = n^(2/3)`.
3. **Hilbert / 2-block Mo** — practical constant-factor improvements.
4. **Tree-on-Mo** — flattening tree paths into arrays via Euler tour so that path queries become array Mo.
5. **Heavy sqrt-decomp**: lazy range-assign + range-sum, range-add + range-min — the bucket-with-tag pattern.

---

## Table of Contents

1. [Mo's Algorithm — Offline Range Queries](#mo)
2. [Mo's Correctness and Complexity Proof](#mo-proof)
3. [Hilbert-Curve and 2-Block Mo](#hilbert)
4. [Mo's Algorithm with Updates](#mo-updates)
5. [Tree on Mo's — DFS Euler Tour + Mo](#tree-mo)
6. [Lazy Bucket Tags — Range Assign + Range Sum](#lazy)
7. [Heavy Sqrt-Decomp Patterns](#heavy)
8. [Practical Considerations](#practical)
9. [Summary](#summary)
10. [Further Reading](#further-reading)

---

<a name="mo"></a>
## 1. Mo's Algorithm — Offline Range Queries

Mo's algorithm (named after Chinese OI competitor **Mo Tao**, popularized in 2010s Codeforces blogs) solves the following:

> Given an array `arr` of size `n` and `q` queries of the form "answer some function `f(arr[l..r])`", and assuming **all queries are known up front**, answer all queries in total time `O((n + q)·√n · cost_of_add_remove)`.

The function `f` only needs to support two **incremental** operations:
- `add(x)` — extend the current window by including element `x`.
- `remove(x)` — shrink the current window by excluding element `x`.

Examples of valid `f`:
- Number of **distinct** elements in `[l, r]`.
- Sum of `arr[l..r]` (trivial, but Mo handles it).
- Number of pairs `(i, j)` with `arr[i] == arr[j]` in `[l, r]`.
- Mode (most frequent value) — with care.
- XOR of pairwise sums.

### 1.1 The naive approach

Maintain a current window `[curL, curR]` and an associated answer plus a frequency table `freq[v] = count of v in current window`. To answer a new query `(l, r)`:

```
while curL > l: curL--; add(arr[curL])
while curR < r: curR++; add(arr[curR])
while curL < l: remove(arr[curL]); curL++
while curR > r: remove(arr[curR]); curR--
record answer
```

Each `add` / `remove` is `O(1)` for the distinct-count case (`freq[x]++`; if it went `0→1`, distinct++). Total work to process all queries naively can be `O(n·q)` in the worst case — e.g., alternating queries `[0, 0]` and `[n-1, n-1]` force the pointers to scan the whole array every time.

### 1.2 Mo's trick — reorder the queries

Sort the queries by `(blockOf(l), r)` where `blockOf(l) = l / B` and `B = ⌈√n⌉`. Then process them in that order. Magic happens:

- Within a single block of `l`, queries are sorted by `r`, so `r` moves monotonically. Total motion of `r` per block: `O(n)`. Total over all `√n` blocks: `O(n·√n)`.
- `l` jumps inside its block but never further than `B`, so each query incurs `O(B) = O(√n)` motion of `l`. Total: `O(q·√n)`.

Adding: `O((n + q)·√n)` `add`/`remove` operations. For `n = q = 10⁵`, that's about `6·10⁷` — fast.

### 1.3 Reference implementation (distinct count)

**Python:**
```python
import math

def mo_distinct(arr, queries):
    """For each query (l, r), count distinct elements in arr[l..r].
       queries: list of (l, r). Returns answers in original order."""
    n, q = len(arr), len(queries)
    B = max(1, int(math.sqrt(n)))
    # Pair each query with its original index.
    indexed = [(l, r, i) for i, (l, r) in enumerate(queries)]
    indexed.sort(key=lambda x: (x[0] // B, x[1]))

    freq = {}
    distinct = 0
    answers = [0] * q
    curL, curR = 0, -1

    def add(x):
        nonlocal distinct
        if freq.get(x, 0) == 0:
            distinct += 1
        freq[x] = freq.get(x, 0) + 1

    def remove(x):
        nonlocal distinct
        freq[x] -= 1
        if freq[x] == 0:
            distinct -= 1

    for l, r, idx in indexed:
        while curR < r:
            curR += 1
            add(arr[curR])
        while curL > l:
            curL -= 1
            add(arr[curL])
        while curR > r:
            remove(arr[curR])
            curR -= 1
        while curL < l:
            remove(arr[curL])
            curL += 1
        answers[idx] = distinct
    return answers
```

**Go:**
```go
package mo

import (
    "math"
    "sort"
)

type query struct{ l, r, idx int }

func MoDistinct(arr []int, queries [][2]int) []int {
    n, q := len(arr), len(queries)
    B := int(math.Sqrt(float64(n)))
    if B < 1 {
        B = 1
    }
    qs := make([]query, q)
    for i, lr := range queries {
        qs[i] = query{lr[0], lr[1], i}
    }
    sort.Slice(qs, func(i, j int) bool {
        if qs[i].l/B != qs[j].l/B {
            return qs[i].l/B < qs[j].l/B
        }
        return qs[i].r < qs[j].r
    })
    freq := map[int]int{}
    distinct := 0
    add := func(x int) {
        if freq[x] == 0 {
            distinct++
        }
        freq[x]++
    }
    remove := func(x int) {
        freq[x]--
        if freq[x] == 0 {
            distinct--
        }
    }
    ans := make([]int, q)
    curL, curR := 0, -1
    for _, qq := range qs {
        for curR < qq.r {
            curR++
            add(arr[curR])
        }
        for curL > qq.l {
            curL--
            add(arr[curL])
        }
        for curR > qq.r {
            remove(arr[curR])
            curR--
        }
        for curL < qq.l {
            remove(arr[curL])
            curL++
        }
        ans[qq.idx] = distinct
    }
    return ans
}
```

**Java:** (sketch — analogous, see `tasks.md` task 4 for the full file).

### 1.4 Restriction: offline only

Mo's algorithm requires you to **see all queries before answering any**. It cannot stream answers. If the problem says "process queries as they arrive", you cannot use Mo unless you batch.

---

<a name="mo-proof"></a>
## 2. Mo's Correctness and Complexity Proof

### 2.1 Correctness

The window pointers `(curL, curR)` are updated *exactly* to match `(l, r)` before recording the answer. The aggregate (e.g., distinct count) is maintained by `add` and `remove`, both `O(1)`. So as long as `f` is fully determined by the multiset of elements currently in the window, the answer is correct regardless of query order. Reordering is just a performance optimization.

### 2.2 Complexity

Split the total motion of `curL` and `curR` separately.

**Motion of `curR`** (right pointer):
- Within one block of `l`, queries are sorted by `r`, so `r` is **monotonically non-decreasing**. `curR` moves only right; total motion ≤ `n` per block.
- Number of blocks: `n / B + 1`.
- Total motion: `(n / B + 1) · n = O(n²/B + n)`.

**Motion of `curL`** (left pointer):
- Each query can move `curL` by up to `B` (one block worth) since `l` only varies within its block.
- Total motion: `O(q · B)`.

**Total `add`/`remove` operations**: `O(n²/B + qB)`.

Minimize over `B`: take derivative, set to zero → `B = n/√q`. For `n ≈ q`, this gives `B ≈ √n`, the standard choice, with total work `O(n·√n)`.

For general `n, q`, `B = n/√q` yields `O(n·√q)` — sometimes denoted `O((n+q)√n)` after simplification.

### 2.3 The `add`/`remove` cost

The bound above assumes `add` and `remove` are `O(1)`. If they cost `O(log n)` (e.g., using a balanced BST to maintain ordered elements), the total becomes `O(n·√q · log n)` — still vastly better than `O(n·q)`.

---

<a name="hilbert"></a>
## 3. Hilbert-Curve and 2-Block Mo

The standard sort by `(l/B, r)` has a subtle constant-factor problem: when transitioning from one block of `l` to the next, `r` may jump from "near the right end of the array" back to "near the left", forcing `curR` to scan all the way back.

**Trick 1 — alternate `r`-sort direction per block.** If `(l/B)` is even, sort by `r` ascending; if odd, descending. This way `r` ends one block roughly where it begins the next. Saves about half the pointer motion in practice — typical 1.5–2x speedup.

**Python snippet:**
```python
indexed.sort(key=lambda x: (x[0] // B,
                            x[1] if (x[0] // B) % 2 == 0 else -x[1]))
```

**Trick 2 — Hilbert curve ordering.** Order queries by the position of `(l, r)` along a space-filling **Hilbert curve** over the `[0, n] × [0, n]` plane. This globally minimizes total pointer motion. In practice 2–3x faster than the standard sort. The Hilbert order has a fast closed-form computation via bit manipulation; see `professional.md` for the formula and `tasks.md` task 8 for an implementation.

The asymptotic bound is the same (`O((n+q)√n)`), but the constant is smaller, and importantly, the **cache behavior** is better because consecutive queries touch nearby memory regions.

---

<a name="mo-updates"></a>
## 4. Mo's Algorithm with Updates

Vanilla Mo handles only queries. To handle a mixed stream of **updates and queries**, lift to 3 dimensions: include a *time* axis.

- Number every event (query or update) by its arrival index `t`.
- For a query at time `t`, its "state" is `(l, r, t)` where `t` indexes how many updates have been applied.
- Sort queries by `(l / B, r / B, t)` with `B = n^(2/3)` (yes, two-thirds, not one-half).
- Maintain `curL`, `curR`, `curT`. To process a query, move `curT` forward/backward applying/un-applying the updates that lie between the current and target time.

Block size analysis:
- Motion of `curL`: each query moves `O(B)` within its block → total `O(q·B)`.
- Motion of `curR`: for fixed `l`-block and varying `t`-block, `r` moves monotonically → total `O(n²/B) · (n/B)` = `O(n³/B²)`.
- Motion of `curT`: total `O(n³/B²)`.

Minimizing `q·B + n³/B²` → `B = n^(2/3)`, total work `O(n^(5/3))`. Still fast for `n ≤ 10⁵`.

### 4.1 Sketch

```python
def mo_with_updates(arr, ops):
    """ops: list of ('Q', l, r) or ('U', i, v).
       Returns answers for queries in original order."""
    n = len(arr)
    B = max(1, round(n ** (2/3)))
    queries = []  # (l, r, t, idx)
    updates = []  # (i, oldVal, newVal)
    cur_arr = list(arr)
    qcount = 0
    for op in ops:
        if op[0] == 'Q':
            _, l, r = op
            queries.append((l, r, len(updates), qcount))
            qcount += 1
        else:
            _, i, v = op
            updates.append((i, cur_arr[i], v))
            cur_arr[i] = v
    queries.sort(key=lambda x: (x[0] // B, x[1] // B, x[2]))
    cur_arr = list(arr)
    curL, curR, curT = 0, -1, 0
    answers = [0] * qcount
    freq, distinct = {}, 0
    def add(x):
        nonlocal distinct
        if freq.get(x, 0) == 0: distinct += 1
        freq[x] = freq.get(x, 0) + 1
    def remove(x):
        nonlocal distinct
        freq[x] -= 1
        if freq[x] == 0: distinct -= 1
    def apply_update(k, fwd):
        i, old, new = updates[k]
        # Active value depends on direction
        target = new if fwd else old
        # If position i is inside [curL, curR], we must update freq.
        if curL <= i <= curR:
            remove(cur_arr[i])
            add(target)
        cur_arr[i] = target
    for l, r, t, idx in queries:
        while curT < t:
            apply_update(curT, True);  curT += 1
        while curT > t:
            curT -= 1; apply_update(curT, False)
        while curR < r: curR += 1; add(cur_arr[curR])
        while curL > l: curL -= 1; add(cur_arr[curL])
        while curR > r: remove(cur_arr[curR]); curR -= 1
        while curL < l: remove(cur_arr[curL]); curL += 1
        answers[idx] = distinct
    return answers
```

This is the canonical solution to problems like Codeforces 940F ("Machine Learning") and SPOJ "DQUERY" with updates.

---

<a name="tree-mo"></a>
## 5. Tree on Mo's — DFS Euler Tour + Mo

Mo's algorithm works on arrays. To apply it to **tree path queries** ("for each query `(u, v)`, count distinct values on the path from `u` to `v`"), first flatten the tree.

### 5.1 Euler tour for subtree queries

A DFS that records `in[v]` (time entering `v`) and `out[v]` (time leaving `v`) gives the property:

```
subtree of v = arr[in[v]..out[v]]
```

so subtree queries become array range queries. Apply Mo directly.

### 5.2 Path queries via the bracket sequence

For path queries, use the **bracket sequence**: record each node twice in the Euler tour, at `in[v]` and at `out[v]`. The path from `u` to `v` corresponds to a specific subrange of this 2n-length sequence, with the constraint that nodes appearing an odd number of times in the subrange are exactly the path nodes (with a special case for the LCA).

The exact construction (often called "Euler tour with LCA" Mo):
- Let `ST[v] = in[v]`, `EN[v] = out[v]`.
- For query `(u, v)` with `ST[u] ≤ ST[v]`:
  - If `u` is an ancestor of `v` (i.e., `EN[u] ≥ EN[v]`): query range `[ST[u], ST[v]]` (LCA = u, no extra).
  - Otherwise: query range `[EN[u], ST[v]]` plus include LCA(u,v) separately.

Once a tree query becomes a range query on the Euler array, plug into Mo's algorithm. With `add(node)` toggling node membership (since each node appears twice, toggling correctly tracks "is this node in the current path?"), you can answer "distinct values on path" or "sum of values on path" with the same complexity bound.

This technique is the canonical solution to Codeforces 375D ("Tree and Queries") and similar problems.

---

<a name="lazy"></a>
## 6. Lazy Bucket Tags — Range Assign + Range Sum

For sqrt-decomp **with range updates**, attach a lazy tag per bucket.

### 6.1 Range-assign + range-sum

For each bucket maintain:
- `bucketSum[b]` — current sum of bucket b.
- `bucketLazy[b]` — if non-null, every element of bucket b is conceptually equal to this value. Element `arr[i]` for `i` in bucket `b` is *not* updated until needed.

**Range assign `[l, r] = v`**:
- Walk the partial buckets element by element. Before reading/writing partial-bucket cells, **flush** the lazy tag: if `bucketLazy[b]` is set, set every `arr[i]` in bucket `b` to `bucketLazy[b]`, recompute `bucketSum[b]`, clear the lazy tag.
- For full middles: set `bucketLazy[b] = v` and `bucketSum[b] = v · (bucket size)`. No element-level write needed.

**Range sum `[l, r]`**:
- For partial buckets: walk element by element, but if `bucketLazy[b]` is set, the effective value of each element in this bucket is `bucketLazy[b]`. So the partial contribution is `count_in_partial · bucketLazy[b]`.
- For full middles: add `bucketSum[b]`.

Both operations: `O(√n)`.

**Python sketch:**
```python
class SqrtAssignSum:
    def __init__(self, a):
        n = len(a)
        self.B = max(1, int(n ** 0.5))
        self.arr = list(a)
        nb = (n + self.B - 1) // self.B
        self.bsum = [sum(self.arr[b*self.B:(b+1)*self.B]) for b in range(nb)]
        self.lazy = [None] * nb
        self.n = n

    def _flush(self, b):
        if self.lazy[b] is None: return
        lo, hi = b * self.B, min((b + 1) * self.B, self.n)
        for i in range(lo, hi):
            self.arr[i] = self.lazy[b]
        self.bsum[b] = self.lazy[b] * (hi - lo)
        self.lazy[b] = None

    def range_assign(self, l, r, v):
        B = self.B
        bl, br = l // B, r // B
        if bl == br:
            self._flush(bl)
            for i in range(l, r + 1):
                self.bsum[bl] += v - self.arr[i]
                self.arr[i] = v
            return
        self._flush(bl)
        for i in range(l, (bl + 1) * B):
            self.bsum[bl] += v - self.arr[i]; self.arr[i] = v
        for b in range(bl + 1, br):
            self.lazy[b] = v
            lo, hi = b * B, min((b + 1) * B, self.n)
            self.bsum[b] = v * (hi - lo)
        self._flush(br)
        for i in range(br * B, r + 1):
            self.bsum[br] += v - self.arr[i]; self.arr[i] = v

    def range_sum(self, l, r):
        B = self.B
        bl, br = l // B, r // B
        ans = 0
        def bucket_val(b, i):
            return self.lazy[b] if self.lazy[b] is not None else self.arr[i]
        if bl == br:
            for i in range(l, r + 1): ans += bucket_val(bl, i)
            return ans
        for i in range(l, (bl + 1) * B): ans += bucket_val(bl, i)
        for b in range(bl + 1, br):      ans += self.bsum[b]
        for i in range(br * B, r + 1):   ans += bucket_val(br, i)
        return ans
```

### 6.2 Why is this simpler than segment-tree lazy propagation?

In a segment tree, lazy propagation forces you to define a *composition* of two lazy tags (`tag1 ∘ tag2`) and push tags down during traversal. The recursion makes it easy to forget to push.

In sqrt-decomp, the lazy tag lives on *one bucket*, never composes across levels, and is flushed only when partial access is needed. The code is linear and easy to debug.

For `add` (range increment) the same approach: `bucketAdd[b]` accumulates pending additions; flush before partial access.

---

<a name="heavy"></a>
## 7. Heavy Sqrt-Decomp Patterns

### 7.1 Per-bucket sorted list (range less-than-k count)

Maintain each bucket as a sorted copy of its elements. Query "how many elements `< k` in `arr[l..r]`?" walks partial buckets linearly and binary-searches each full bucket (`O(log B)` per bucket). Total `O(√n · log √n + √n) = O(√n log n)`. Point updates: replace the element in the sorted bucket (`O(B)` linear, or `O(log B)` with a sorted container).

### 7.2 Per-bucket frequency map (range mode hard problem)

For "what is the mode of `arr[l..r]`?", maintain per-bucket frequency tables and a precomputed `mode[i][j]` = mode of buckets `i..j`. The answer is mode of full-middle slab combined with potential modes from partials. This is a classic problem with multiple solutions; sqrt-decomp with `O(n√n)` preprocessing and `O(√n)` query is one of the cleanest.

### 7.3 Per-bucket smaller structure for heavy operations

For operations like "rotate `arr[l..r]` by `k`" or "reverse a range" — segment trees struggle, but sqrt-decomp can keep each bucket as a deque. Rotation translates to splicing.

### 7.4 Sqrt-decomp on a doubly-linked list

For dynamic insertions/deletions in the middle of a sequence (where you need O(√n) for both query and update including insert/delete), maintain a doubly-linked list of buckets, each bucket itself a deque. Periodically rebalance when a bucket exceeds 2√n or falls below √n / 2. Achieves O(√n) amortized for all operations.

---

<a name="practical"></a>
## 8. Practical Considerations

- **`B = n^(2/3)` vs `√n` cheat sheet.** Vanilla Mo: `√n`. Mo with updates: `n^(2/3)`. Sqrt-decomp with range-assign + range-sum: `√n`.
- **Hash maps in Mo's `add/remove`** are slower than arrays. If values fit in `[0, V]` with small `V`, use `freq = [0] * (V + 1)`. Otherwise **coordinate compress** values to `[0, n)` first.
- **Output buffering.** For large `q`, use buffered output; raw `print` per query in Python can be the bottleneck.
- **Use `sys.stdin.read()` in Python** for competitive contexts; `input()` is too slow.
- **Mo's sort stability.** Use a stable sort so queries with identical `(l/B, r)` keep their original order; otherwise multiple queries on the same range may answer in the wrong slot.
- **Test framework**: write a brute-force comparator on `n ≤ 100`. Mo's algorithm bugs are silent — answers are wrong for *some* queries, not all.

---

<a name="summary"></a>
## 9. Summary

- **Mo's algorithm** turns offline range queries into `O((n+q)√n)` by sorting on `(l/B, r)` and incrementally maintaining a window aggregate via `add`/`remove`.
- **Mo with updates** adds a time axis; sort on `(l/B, r/B, t)` with `B = n^(2/3)` for total `O(n^(5/3))`.
- **Hilbert-curve ordering** is a constant-factor optimization that preserves asymptotic bounds but improves cache behavior 2–3x in practice.
- **Tree-on-Mo** flattens trees via Euler tour, reducing path queries to array Mo with a special handling of the LCA.
- **Lazy bucket tags** make sqrt-decomp handle range updates (assign, add) in `O(√n)` with cleaner code than segment-tree lazy propagation.
- Heavy sqrt-decomp variants exploit per-bucket structures (sorted lists, frequency maps, deques) to answer queries that segment trees handle poorly.

---

<a name="further-reading"></a>
## 10. Further Reading

- **Codeforces blog by louiehoung**, "An alternative sorting method for Mo's algorithm" — Hilbert ordering.
- **CP-Algorithms** — "Mo's algorithm" and "Mo's algorithm on trees" articles.
- **Codeforces Round 942F — Machine Learning** — classic Mo with updates problem.
- **SPOJ DQUERY** — distinct values in range, the textbook Mo problem.
- **Continue with**: `senior.md` for production usage and tradeoffs, `professional.md` for SIMD partials and cache tuning.
