# Merge Sort Tree — Interview Preparation

> **Audience:** Engineers preparing for interviews where range-order queries (count ≤ k in a range, count in band, k-th smallest in a range) come up — and where the merge sort tree, or one of its alternatives, is the intended or fallback solution. Prerequisite: `junior.md` and `middle.md`.

This file has **50 tiered questions** with model-answer focus across four levels (junior, middle, senior, professional), several **deep-dive model answers** you can speak verbatim, a table of **common follow-ups and traps**, **two full coding challenges** (count-≤-k and k-th-smallest) in Go, Java, and Python, a **60-second whiteboard plan**, and a **pre-interview checklist**. Read the questions, answer them aloud first, then check the focus column — speaking the answers is the practice that matters, because interviews are spoken, not written.

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a merge sort tree in one sentence? | A segment tree where each node stores the sorted list of the elements in its range, built by merging children's sorted lists like merge sort. |
| 2 | What query does it primarily answer? | `countLE(l, r, k)`: how many indices `i ∈ [l, r]` have `A[i] ≤ k`. |
| 3 | What is the time complexity of `countLE`? | `O(log² n)` — `O(log n)` canonical nodes, each binary-searched in `O(log n)`. |
| 4 | What is the build time and space? | Both `O(n log n)`: each element appears once per level across `log n` levels. |
| 5 | How is each node's sorted list produced? | By merging its two children's sorted lists in linear time; leaves are single-element lists. |
| 6 | Why is it "like merge sort"? | It is merge sort with the intermediate sorted lists kept at each tree node instead of discarded. |
| 7 | What does `upperBound(S, k)` return and why use it for `countLE`? | The count of elements `≤ k` in sorted list `S`; it counts ties with `k`, which `≤` requires. |
| 8 | How do you count elements in a value band `[a, b]` within `[l, r]`? | `countLE(l, r, b) − countLE(l, r, a − 1)`. |
| 9 | Can you update an element efficiently? | No — the array is effectively static; one update can touch `O(n)` stored copies. |
| 10 | How many node slots should you allocate for the flat tree? | `4n`, due to the `2v / 2v+1` numbering on non-power-of-two sizes. |
| 11 | What are the three cases in the recursive query? | Disjoint (return 0), fully inside (binary-search this node), partial (recurse both children). |
| 12 | What does the root node's sorted list contain? | The entire array, sorted. |
| 13 | What goes wrong if you use `lowerBound` instead of `upperBound` for `countLE`? | It undercounts by the number of elements equal to `k` (counts `< k` instead of `≤ k`). |
| 14 | What's a quick way to test your implementation? | Compare against an `O(n)` brute-force scan on random inputs, including duplicate-heavy arrays. |

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 15 | How do you find the k-th smallest value in a range? | Binary search on the answer value `v`: smallest `v` with `countLE(l, r, v) ≥ k`. |
| 16 | What is the complexity of that k-th-smallest approach? | `O(log³ n)` (outer value search `× countLE`), or `O(log² n · log V)` before compression. |
| 17 | Why coordinate-compress values first? | Shrinks the value search to `O(log n)`, enables compact integer storage, avoids `O(log V)` overhead. |
| 18 | State the canonical-decomposition invariant. | Any `[l, r]` is tiled by `O(log n)` disjoint canonical nodes whose union is exactly `[l, r]`. |
| 19 | Why are there only `O(log n)` canonical nodes? | At most two partial nodes per level (straddling `l` and `r`); only partial nodes recurse. |
| 20 | When would you choose a wavelet tree over a merge sort tree? | When memory is tight (`O(n log V)` bits) or k-th smallest must be `O(log V)`. |
| 21 | When a persistent segment tree instead? | When k-th smallest is the headline query and you want clean `O(log n)`, online. |
| 22 | When Mo's algorithm + BIT instead? | When all queries are offline; lowest constant factor and `O(n)` memory. |
| 23 | When sqrt decomposition (sorted blocks) instead? | When the array mutates — it's the one alternative that supports updates. |
| 24 | What's the key axis distinguishing these structures? | Offline vs online, count vs k-th-smallest, static vs mutable, and memory budget. |
| 25 | What does "online query" mean and why does it matter here? | Each query answered before the next arrives (possibly answer-dependent); rules out Mo and BIT sweep. |
| 26 | Derive the build recurrence and solve it. | `T(n) = 2T(n/2) + Θ(n)` → `Θ(n log n)` by the Master Theorem. |
| 27 | Why does the query cost an extra `log n` over a sum segment tree? | Each canonical node needs a binary search (`O(log n)`) instead of reading a precomputed aggregate. |
| 28 | How would you answer "count strictly less than k"? | `lowerBound` on each node (count `< k`), or `countLE(l, r, k − 1)` for integers. |
| 29 | For a purely offline count workload, what beats the merge sort tree? | BIT offline sweep: sort queries by `k`, sweep a Fenwick keyed by index — `O((n+q) log n)`. |
| 30 | Why can't a Fenwick (sum) tree answer count ≤ k directly? | Count ≤ k over a range isn't an invertible aggregate of stored sums; you need order info per range. |

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 31 | What's the dominant production constraint of the merge sort tree? | `O(n log n)` memory, which scales super-linearly with data growth. |
| 32 | How do you handle the static limitation in a real append-mostly system? | Seal-and-build per immutable time partition; query a small mutable live tail separately. |
| 33 | Give two more rebuild strategies. | Periodic full rebuild + atomic pointer swap; MST base + delta log (LSM-style), compacted periodically. |
| 34 | At what `n` does the merge sort tree become a poor choice, and what replaces it? | Around `10^7`+ elements (~GBs); switch to a wavelet tree (bits) or on-disk columnar index. |
| 35 | What production pattern does the merge sort tree mirror? | Columnar zone maps / sealed sorted segments — precompute sorted summaries, decompose-and-binary-search. |
| 36 | Why are immutable merge sort trees operationally attractive? | Lock-free, trivially shareable across threads/replicas, zero read-path coordination. |
| 37 | When should you use a sketch (t-digest) instead of an exact structure? | When approximate quantiles over an unbounded stream are acceptable — far cheaper and update-friendly. |
| 38 | What two metrics matter most to instrument? | `resident_bytes` (memory is the killer) and `build_duration` (slow build stalls ingestion). |
| 39 | A team "added updates" by rebuilding per write and CPU spiked — what's the fix? | Batch changes into a delta buffer and rebuild on a schedule, or switch to sqrt decomposition. |
| 40 | How do you cut memory without changing structure? | Coordinate-compress to `int32`/`int16`; use primitive contiguous arrays; hybridize with block-scan to drop bottom levels. |

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 41 | Prove `countLE` correct. | Canonical-decomposition lemma: inside nodes partition `[l, r]`; count is additive over the partition → sum of per-node `upperBound`. |
| 42 | Prove the `Θ(n log n)` space bound. | Each level's node ranges partition `[0, n−1]`, so `Σ|S(v)|` per level `= n`; times `Θ(log n)` levels. |
| 43 | How do you reduce the query to `O(log n)`? | Fractional cascading (Chazelle–Guibas): one binary search at the top, `O(1)` bridge hops thereafter. |
| 44 | What are the relevant lower bounds? | Static range-order query is `Ω(log n)` (comparison model); dynamic is `Ω(log n / log log n)` (cell-probe); exact space is `Ω(n log V)` bits — merge sort tree uses `Θ(n log n)` words, so it's time-optimal-with-cascading but not space-optimal (wavelet tree is). |
| 45 | Why is the build provably `Ω(n log n)`? | The root payload is the whole array sorted; producing a sorted permutation is `Ω(n log n)` comparisons (decision-tree bound). |
| 46 | Can a potential function amortize updates to `o(n)`? | No; an adversary alternating min/max forces `Θ(n)` shifts per update, and the potential telescopes to a constant — can't fund it. |
| 47 | How does it generalize to 2D (orthogonal range counting)? | Outer merge sort tree over `x`, each node holding a `y`-sorted list; query `O(log² n)`, space `O(n log n)` — Chazelle's structure. |
| 48 | Why does cache behavior favor the build over the query? | Build is sequential merges (I/O-optimal); query does scattered binary searches across `log n` nodes (poor locality). |
| 49 | What's the difference between this and a "wavelet tree" in one sentence? | The merge sort tree partitions the *index* range with sorted-value payloads; the wavelet tree partitions the *value* range with bit-vectors — succinct, `O(log V)` query. |
| 50 | When is the offline BIT sweep strictly better? | When all queries are known up front and are count-style: it drops a `log` (`O((n+q) log n)`) and has a tiny constant — but it can't be online. |

---

## Deep-Dive Model Answers

A few questions reward a fuller spoken answer. Here are model responses you can adapt.

**Q3 / Q27 — "Why `O(log² n)` and not `O(log n)`?"**
> "A range `[l, r]` decomposes into `O(log n)` canonical segment-tree nodes. A *sum* segment tree reads one precomputed number per node, so its query is `O(log n)`. A merge sort tree instead binary-searches each node's sorted list for 'how many ≤ k', costing `O(log n)` per node. So it's `O(log n)` nodes × `O(log n)` per search = `O(log² n)`. The extra `log` is the price of answering an *order* query instead of an additive one. With fractional cascading — one search at the root plus `O(1)` bridge hops down — it drops to `O(log n)`, but that's rarely worth the complexity versus just using a wavelet tree."

**Q9 / Q31 — "Why can't it take updates, and what do you use instead?"**
> "The root node stores the whole array sorted; changing one element can move it across the entire sorted order, forcing `Θ(n)` work — and no amortization fixes that because the contiguous-array layout requires `Θ(n)` shifts. It's static by design. If I need updates, I use sqrt decomposition with sorted blocks: a point update re-sorts just one `√n`-size block in `O(√n)`, and a count binary-searches each covered block. I trade the `O(log² n)` query for an `O(√n log)` query to get cheap updates."

**Q15 / Q43 — "k-th smallest, and how to make it fast."**
> "Binary-search the answer value: the k-th smallest is the smallest value `v` with `countLE(l, r, v) ≥ k`, valid because `countLE` is monotonic in `v`. Coordinate-compress so the outer search is `O(log n)` probes, each an `O(log² n)` `countLE`, giving `O(log³ n)`. If k-th smallest is the headline query, I'd switch to a persistent segment tree or wavelet tree for clean `O(log n)` rather than living with the extra `log` factors."

**Q41 — "Sketch the correctness proof."**
> "By the canonical-decomposition invariant, the 'fully inside' nodes the recursion stops at have pairwise-disjoint ranges whose union is exactly `[l, r]` — at most two 'partial' nodes per level straddle the endpoints, everything else is inside or disjoint. Counting is additive over a disjoint partition, so the total count equals the sum of per-node `upperBound(S(v), k)` results. Each `S(v)` is exactly the sorted multiset of the array over that node's range, so each term is exact, and the sum is exact."

**Q42 — "Why is the space `Θ(n log n)`, exactly?"**
> "Look at it level by level. The nodes on any one level have disjoint ranges that together cover the whole array, so the sorted lists on that level hold all `n` elements once — `n` stored values per level. There are `⌈log₂ n⌉ + 1` levels, so the total is `n · (⌈log₂ n⌉ + 1) = Θ(n log n)`. The constant is exactly the number of levels — no hidden multiplier — which is why coordinate-compressing to a smaller integer type translates almost perfectly into memory saved."

**Q19 — "Why only `O(log n)` canonical nodes?"**
> "On each level, only the nodes straddling the two endpoints `l` and `r` are 'partial' and keep recursing — at most two per level. A range entirely inside `[l, r]` terminates as a canonical node; one entirely outside is pruned. So the recursion produces at most two new canonical nodes per level across `O(log n)` levels: `O(log n)` canonical nodes total."

**Q23 — "I have updates — walk me through the substitute."**
> "Sqrt decomposition with sorted blocks. Split the array into about `√n` blocks and keep a sorted copy of each. A point update re-sorts just the one block that changed — `O(√n)` or `O(√n log √n)`. A `countLE` binary-searches each fully-covered block (`O(√n)` blocks × `O(log √n)`) and linearly scans the partial end blocks. So I trade the merge sort tree's `O(log² n)` query for `O(√n log)` in exchange for cheap updates — the right call whenever the data isn't static."

---

## Interview Tips

- **Lead with the one-sentence definition** ("a segment tree whose nodes store sorted lists, built like merge sort") — it signals you know the structure precisely.
- **Always state the static limitation aloud.** Interviewers probe whether you know it can't take updates; volunteering it shows maturity.
- **Name the alternatives and the axis** (offline/online, count/k-th, static/mutable, memory). Knowing *when not* to use the merge sort tree is what separates middle from senior.
- **For k-th smallest, say "binary search on the answer"** and mention coordinate compression in the same breath.
- **Mention `upperBound` vs `lowerBound` deliberately** when discussing ties — it's the most common implementation bug.
- **If asked about memory, quote `n · log n`** and immediately offer coordinate compression and the wavelet-tree fallback.
- **Walk a tiny example by hand** (`n = 6`) before coding; it catches off-by-one and convention bugs early.

---

## Common Follow-Ups and Traps

Interviewers steer merge sort tree problems with predictable follow-ups. Be ready for these.

| Follow-up | The trap | The strong answer |
|---|---|---|
| "Now support point updates." | Trying to update the tree in place. | "The tree is static — an update is `Θ(n)`. Switch to sqrt decomposition (sorted blocks) for `O(√n)` updates, or rebuild on a schedule if updates are rare." |
| "Make the query `O(log n)`." | Claiming the plain query is already `O(log n)`. | "Plain is `O(log² n)`; fractional cascading gets `O(log n)`, or a wavelet tree / persistent segtree does it more simply." |
| "Values can be `10^9` or negative." | Indexing arrays by raw value → OOM. | "Coordinate-compress to ranks first; comparisons still work, and storage shrinks to `int32`." |
| "Queries are XOR-encoded with the last answer." | Reaching for an offline BIT sweep. | "That forces *online* — drop Mo and the BIT sweep; the merge sort tree (or wavelet/persistent) handles online." |
| "Count values in `[a, b]` in the range." | Computing `countLE(b) − countLE(a)`. | "`countLE(l,r,b) − countLE(l,r,a−1)` — the `a−1` is essential to keep values equal to `a`." |
| "It's all offline and you want it fast." | Insisting on the merge sort tree. | "Then a BIT offline sweep is `O((n+q) log n)` with a tiny constant — usually faster than `q · log² n`." |
| "Memory is tight (tens of millions of elements)." | Shipping the merge sort tree anyway. | "Above ~10⁷ the `n log n` words hurt; a wavelet tree stores `O(n log V)` *bits* — often 10–60× smaller." |

The meta-skill these probe is the same: knowing the **boundary** of the merge sort tree and the specific neighbor that escapes each limitation. Volunteer the boundary before being pushed to it.

---

## Coding Challenge (3 Languages)

### Challenge: K-Query — Count Elements ≤ k in a Range (static array)

> **Problem.** You are given a static array `A` of `n` integers and `q` queries. Each query is `(l, r, k)` (0-indexed, inclusive `[l, r]`). For each query, output the number of indices `i ∈ [l, r]` with `A[i] ≤ k`. Use a merge sort tree so each query is `O(log² n)`. (This is the classic SPOJ `KQUERY`-style problem.)
>
> Solve in all 3 languages. Each solution must pass the sample and your own brute-force cross-check.

**Sample.**
```
A = [2, 6, 4, 1, 9, 3]
queries:
  (1, 4, 5) -> 2     # [6,4,1,9] -> 4,1
  (0, 5, 6) -> 5     # 2,6,4,1,3  (all but 9)
  (2, 2, 3) -> 0     # [4] -> none ≤ 3
  (0, 5, 0) -> 0     # none ≤ 0
  (0, 5, 9) -> 6     # all
```

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type MergeSortTree struct {
	n    int
	tree [][]int
}

func Build(a []int) *MergeSortTree {
	n := len(a)
	t := &MergeSortTree{n: n, tree: make([][]int, 4*max(1, n))}
	if n > 0 {
		t.build(1, 0, n-1, a)
	}
	return t
}

func (t *MergeSortTree) build(v, lo, hi int, a []int) {
	if lo == hi {
		t.tree[v] = []int{a[lo]}
		return
	}
	mid := (lo + hi) / 2
	t.build(2*v, lo, mid, a)
	t.build(2*v+1, mid+1, hi, a)
	t.tree[v] = mergeSorted(t.tree[2*v], t.tree[2*v+1])
}

func mergeSorted(x, y []int) []int {
	out := make([]int, 0, len(x)+len(y))
	i, j := 0, 0
	for i < len(x) && j < len(y) {
		if x[i] <= y[j] {
			out = append(out, x[i])
			i++
		} else {
			out = append(out, y[j])
			j++
		}
	}
	out = append(out, x[i:]...)
	out = append(out, y[j:]...)
	return out
}

func upperBound(s []int, k int) int {
	return sort.Search(len(s), func(i int) bool { return s[i] > k })
}

func (t *MergeSortTree) CountLE(l, r, k int) int {
	if l > r || t.n == 0 {
		return 0
	}
	return t.query(1, 0, t.n-1, l, r, k)
}

func (t *MergeSortTree) query(v, lo, hi, l, r, k int) int {
	if r < lo || hi < l {
		return 0
	}
	if l <= lo && hi <= r {
		return upperBound(t.tree[v], k)
	}
	mid := (lo + hi) / 2
	return t.query(2*v, lo, mid, l, r, k) + t.query(2*v+1, mid+1, hi, l, r, k)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func main() {
	a := []int{2, 6, 4, 1, 9, 3}
	t := Build(a)
	fmt.Println(t.CountLE(1, 4, 5)) // 2
	fmt.Println(t.CountLE(0, 5, 6)) // 5
	fmt.Println(t.CountLE(2, 2, 3)) // 0
	fmt.Println(t.CountLE(0, 5, 0)) // 0
	fmt.Println(t.CountLE(0, 5, 9)) // 6
}
```

#### Java

```java
import java.util.*;

public class Solution {
    private final int n;
    private final int[][] tree;

    public Solution(int[] a) {
        this.n = a.length;
        this.tree = new int[4 * Math.max(1, n)][];
        if (n > 0) build(1, 0, n - 1, a);
    }

    private void build(int v, int lo, int hi, int[] a) {
        if (lo == hi) { tree[v] = new int[]{ a[lo] }; return; }
        int mid = (lo + hi) >>> 1;
        build(2 * v, lo, mid, a);
        build(2 * v + 1, mid + 1, hi, a);
        tree[v] = merge(tree[2 * v], tree[2 * v + 1]);
    }

    private static int[] merge(int[] x, int[] y) {
        int[] out = new int[x.length + y.length];
        int i = 0, j = 0, p = 0;
        while (i < x.length && j < y.length)
            out[p++] = (x[i] <= y[j]) ? x[i++] : y[j++];
        while (i < x.length) out[p++] = x[i++];
        while (j < y.length) out[p++] = y[j++];
        return out;
    }

    private static int upperBound(int[] s, int k) {
        int lo = 0, hi = s.length;
        while (lo < hi) {
            int m = (lo + hi) >>> 1;
            if (s[m] <= k) lo = m + 1; else hi = m;
        }
        return lo;
    }

    public int countLE(int l, int r, int k) {
        if (l > r || n == 0) return 0;
        return query(1, 0, n - 1, l, r, k);
    }

    private int query(int v, int lo, int hi, int l, int r, int k) {
        if (r < lo || hi < l) return 0;
        if (l <= lo && hi <= r) return upperBound(tree[v], k);
        int mid = (lo + hi) >>> 1;
        return query(2 * v, lo, mid, l, r, k)
             + query(2 * v + 1, mid + 1, hi, l, r, k);
    }

    public static void main(String[] args) {
        Solution s = new Solution(new int[]{2, 6, 4, 1, 9, 3});
        System.out.println(s.countLE(1, 4, 5)); // 2
        System.out.println(s.countLE(0, 5, 6)); // 5
        System.out.println(s.countLE(2, 2, 3)); // 0
        System.out.println(s.countLE(0, 5, 0)); // 0
        System.out.println(s.countLE(0, 5, 9)); // 6
    }
}
```

#### Python

```python
import bisect


class MergeSortTree:
    def __init__(self, a):
        self.n = len(a)
        self.tree = [None] * (4 * max(1, self.n))
        if self.n:
            self._build(1, 0, self.n - 1, a)

    def _build(self, v, lo, hi, a):
        if lo == hi:
            self.tree[v] = [a[lo]]
            return
        mid = (lo + hi) // 2
        self._build(2 * v, lo, mid, a)
        self._build(2 * v + 1, mid + 1, hi, a)
        self.tree[v] = self._merge(self.tree[2 * v], self.tree[2 * v + 1])

    @staticmethod
    def _merge(x, y):
        out, i, j = [], 0, 0
        while i < len(x) and j < len(y):
            if x[i] <= y[j]:
                out.append(x[i]); i += 1
            else:
                out.append(y[j]); j += 1
        out.extend(x[i:]); out.extend(y[j:])
        return out

    def count_le(self, l, r, k):
        if l > r or self.n == 0:
            return 0
        return self._query(1, 0, self.n - 1, l, r, k)

    def _query(self, v, lo, hi, l, r, k):
        if r < lo or hi < l:
            return 0
        if l <= lo and hi <= r:
            return bisect.bisect_right(self.tree[v], k)
        mid = (lo + hi) // 2
        return (self._query(2 * v, lo, mid, l, r, k)
                + self._query(2 * v + 1, mid + 1, hi, l, r, k))


if __name__ == "__main__":
    t = MergeSortTree([2, 6, 4, 1, 9, 3])
    print(t.count_le(1, 4, 5))  # 2
    print(t.count_le(0, 5, 6))  # 5
    print(t.count_le(2, 2, 3))  # 0
    print(t.count_le(0, 5, 0))  # 0
    print(t.count_le(0, 5, 9))  # 6
```

**Follow-up the interviewer may ask:** "Now return the k-th smallest in `[l, r]`." Answer: binary-search the answer value (smallest `v` with `count_le(l, r, v) ≥ k`) over the coordinate-compressed distinct values — `O(log³ n)` per query, or switch to a persistent segment tree / wavelet tree for `O(log n)`.

---

## Second Coding Challenge — K-th Smallest in a Range

> **Problem.** Given a static array `A` of `n` integers and `q` queries `(l, r, k)` (0-indexed, inclusive, 1-indexed `k`), return the `k`-th smallest value in `A[l..r]`. Build a merge sort tree and binary-search the answer over the compressed distinct values; each query is `O(log³ n)`.
>
> Reuse the `MergeSortTree` from the first challenge — only the `kthSmallest` wrapper is new.

**Sample.**
```
A = [2, 6, 4, 1, 9, 3]
queries:
  (0, 5, 1) -> 1     # whole array sorted [1,2,3,4,6,9], 1st = 1
  (0, 5, 4) -> 4     # 4th = 4
  (1, 4, 2) -> 4     # [6,4,1,9] sorted [1,4,6,9], 2nd = 4
  (2, 2, 1) -> 4     # [4], 1st = 4
```

#### Go

```go
import "sort"

// distinct returns the sorted distinct values (coordinate compression target).
func distinct(a []int) []int {
	c := append([]int(nil), a...)
	sort.Ints(c)
	out := c[:0]
	for i, v := range c {
		if i == 0 || v != c[i-1] {
			out = append(out, v)
		}
	}
	return out
}

// KthSmallest returns the k-th smallest value in a[l..r], 1-indexed k. O(log^3 n).
func (t *MergeSortTree) KthSmallest(l, r, k int, vals []int) int {
	lo, hi := 0, len(vals)-1
	for lo < hi {
		mid := (lo + hi) / 2
		if t.CountLE(l, r, vals[mid]) >= k {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	return vals[lo]
}
```

#### Java

```java
import java.util.*;

static int[] distinct(int[] a) {
    int[] c = a.clone();
    Arrays.sort(c);
    int m = 0;
    for (int i = 0; i < c.length; i++)
        if (i == 0 || c[i] != c[i - 1]) c[m++] = c[i];
    return Arrays.copyOf(c, m);
}

/** k-th smallest in a[l..r], 1-indexed k. O(log^3 n). */
public int kthSmallest(int l, int r, int k, int[] vals) {
    int lo = 0, hi = vals.length - 1;
    while (lo < hi) {
        int mid = (lo + hi) >>> 1;
        if (countLE(l, r, vals[mid]) >= k) hi = mid;
        else lo = mid + 1;
    }
    return vals[lo];
}
```

#### Python

```python
    def kth_smallest(self, l, r, k, vals):
        """k-th smallest in a[l..r], 1-indexed k. vals = sorted distinct. O(log^3 n)."""
        lo, hi = 0, len(vals) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if self.count_le(l, r, vals[mid]) >= k:
                hi = mid
            else:
                lo = mid + 1
        return vals[lo]


if __name__ == "__main__":
    a = [2, 6, 4, 1, 9, 3]
    t = MergeSortTree(a)
    vals = sorted(set(a))
    assert t.kth_smallest(0, 5, 1, vals) == 1
    assert t.kth_smallest(0, 5, 4, vals) == 4
    assert t.kth_smallest(1, 4, 2, vals) == 4
    assert t.kth_smallest(2, 2, 1, vals) == 4
    print("kth ok")
```

**Whiteboard walkthrough to narrate.** For `(1, 4, 2)` on `vals = [1,2,3,4,6,9]`: probe `vals[2]=3` → `countLE(1,4,3)=1 < 2` → go right; probe `vals[4]=6` → `countLE(1,4,6)=3 ≥ 2` → go left; probe `vals[3]=4` → `countLE(1,4,4)=2 ≥ 2` → converge on `4`. Saying this trace aloud demonstrates you understand *why* the monotonic `countLE` makes binary-search-on-answer valid — exactly what an interviewer is checking.

---

## A 60-Second Whiteboard Plan

When a merge sort tree problem appears, structure your answer like this:

1. **Recognize the signal** (range + order condition: "count ≤ k in `[l,r]`", "k-th smallest in range") and say "this is a merge sort tree, or one of its cousins."
2. **State the static assumption** and ask if there are updates. If yes, pivot to sqrt decomposition.
3. **Describe the structure** in one sentence: segment tree, each node holds its range sorted, built like merge sort.
4. **Give the query**: decompose into `O(log n)` canonical nodes, binary-search each → `O(log² n)`.
5. **State build cost** `O(n log n)` time and space, and mention coordinate compression if values are large.
6. **Code the build + `countLE`**, then the requested query (band = two `countLE`s; k-th = binary search on the answer).
7. **Close with trade-offs**: name the wavelet tree (memory), persistent segment tree (`O(log n)` k-th), and BIT offline sweep (if offline).

Hitting these seven beats in order shows breadth (you know the family) and depth (you can implement and analyze the specific structure) — the combination interviewers reward.

---

## Pre-Interview Checklist

Run through this the night before; if you can do each from memory, you are ready for any merge sort tree question.

- [ ] Write `Build`, `merge`, `upperBound`, and the recursive `countLE` from scratch in your strongest language, in under 5 minutes.
- [ ] Explain the `O(log² n)` query and `O(n log n)` build/space without notes.
- [ ] State the canonical-decomposition invariant and why there are `O(log n)` canonical nodes.
- [ ] Implement `countInBand` (`countLE(b) − countLE(a−1)`) and `kthSmallest` (binary search on the answer).
- [ ] Recite the four alternatives and the axis that selects each: wavelet (memory), persistent segtree (`O(log n)` k-th), Mo+BIT (offline), sqrt (updates).
- [ ] Explain the static limitation as a `Θ(n)`-update fact, and name sqrt decomposition as the updatable substitute.
- [ ] Get `upperBound` vs `lowerBound` right on a duplicate-heavy example.
- [ ] Coordinate-compress when values are large or negative, and say why.

The single most common reason candidates stumble on these problems is **not recognizing the signal** — a "range + order" question dressed up in domain language. Train yourself to hear "count ≤ k in `[l, r]`" or "k-th smallest in a window" and immediately think *merge sort tree or one of its cousins*. Everything else follows from the seven-beat plan above.

One last rehearsal tip: practice the **failure-to-success pivot** out loud. When the interviewer adds a twist that breaks the merge sort tree (updates, tight memory, forced online with offline tools on the table), the strong move is to *name the breakage and the substitute in the same breath* — "that makes it dynamic, so the merge sort tree is out; I'd use sqrt decomposition with sorted blocks for `O(√n)` updates." Candidates who freeze when their first structure is invalidated lose points; candidates who pivot smoothly to the right neighbor demonstrate exactly the structural-judgment the question is designed to test.

---

## Summary of What to Memorize

If you remember only a handful of facts walking in, make them these:

- **Definition:** segment tree, each node stores its range sorted, built like merge sort.
- **Query:** `countLE(l,r,k)` = decompose into `O(log n)` canonical nodes, binary-search each → `O(log² n)`.
- **Build/space:** `O(n log n)` both, constant = number of levels.
- **Static:** updates are `Θ(n)`; use sqrt decomposition if the data mutates.
- **k-th smallest:** binary search the answer value (`O(log³ n)`), or switch to persistent segtree / wavelet for `O(log n)`.
- **Alternatives by axis:** wavelet (memory), persistent segtree (k-th), Mo+BIT (offline), sqrt (updates).

These six lines, plus the ability to code the build and `countLE` cleanly, cover the overwhelming majority of what any interviewer will ask about merge sort trees.

Continue with [`tasks.md`](./tasks.md) for graded hands-on exercises with reference solutions.
