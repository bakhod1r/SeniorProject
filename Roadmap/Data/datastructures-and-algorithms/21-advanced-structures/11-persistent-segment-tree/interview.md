# Persistent Segment Tree — Interview Preparation

> **Format:** 45 tiered questions (Junior → Middle → Senior → Professional) with model-answer focus, followed by a full **coding challenge — range k-th smallest** in Go, Java, and Python.
> Cross-links: ordinary [segment tree](../../09-trees/06-segment-tree/interview.md), [Fenwick tree](../../09-trees/09-fenwick-tree/interview.md), [wavelet tree](../13-wavelet-tree/).

---

## How to Use This File

Each question lists the **answer focus** an interviewer wants to hear. Practice saying the answer out loud in 60–120 seconds. The coding challenge at the end is the canonical "k-th smallest in a range" problem (SPOJ MKTHNUM / Codeforces flavor) — the single most common way this structure is tested.

---

## Junior Questions (What & How)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a persistent data structure? | Keeps all past versions queryable after updates; old handles still work (unlike ephemeral). |
| 2 | What does a persistent segment tree add over an ordinary one? | Every update yields a **new version**; you can query any past version, each in O(log n). |
| 3 | What is path copying? | On update, clone only the O(log n) nodes on the root-to-leaf path; share all other subtrees by pointer. |
| 4 | How many new nodes does one update create? | Exactly `⌈log₂ n⌉ + 1` — the length of the root-to-leaf path. |
| 5 | Why must nodes be immutable? | If you mutate a shared node, every old version pointing at it is corrupted; immutability keeps history valid. |
| 6 | How do you address a version? | By its **root node**; `roots[t]` is version t. Switching versions is O(1). |
| 7 | Is the query algorithm different from an ordinary segment tree? | No — same three-way trichotomy; you just start from the chosen version's root. |
| 8 | What does each update return? | The **new root** of the new version (instead of mutating in place). |
| 9 | Why not just store a full copy of the tree per version? | O(n·m) memory — astronomically large; path copying is O(n + m·log n). |
| 10 | Where do versions get stored? | In a `roots` array; you append the new root after each update. |
| 11 | Give a one-line analogy. | Like Git commits sharing unchanged blobs, or ZFS copy-on-write snapshots. |
| 12 | What stays shared between two consecutive versions? | Every subtree *not* on the update path — typically all but ~log n nodes. |

**Sample full answer — Q3 (path copying):**
"When I update one leaf, only that leaf and its ancestors change their aggregate — everything hanging off the side of the path is untouched. So I clone just the nodes on the root-to-leaf path (about log n of them), point the cloned nodes' *off-path* child at the **old** subtree (sharing it), and return the new root. The old root still points at the old path, so the previous version is fully intact. Cost: O(log n) time and O(log n) new nodes per version."

---

## Middle Questions (Why & When)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 13 | Explain the k-th-smallest-in-a-range algorithm. | Compress values; `version[i]` = count histogram of `a[1..i]`; `version[r]−version[l−1]` isolates `a[l..r]`; descend value axis using left-count. |
| 14 | Why subtract `version[l−1]`, not `version[l]`? | `version[l−1]` excludes index `l`; subtracting it from `version[r]` leaves exactly `a[l..r]`. |
| 15 | What is the per-query cost of range k-th? | O(log n) — one descent walking two roots in lockstep. |
| 16 | Why build versions over the **value axis**, not positions? | So each node counts elements in a value bucket; the k-th descent uses left-half counts to choose a direction. |
| 17 | What is coordinate compression and why needed? | Map values to dense ranks `0..D−1` so the value-axis tree has ≤ n leaves, not 10^9. |
| 18 | Partial vs full persistence? | Partial: read any, write only latest (path copying suffices). Full: read & write any version, branching history (fat nodes). |
| 19 | Which does range k-th need? | Partial — versions form a linear chain (one per prefix). |
| 20 | Persistent segtree vs merge-sort tree? | Persistent: O(log n)/query. Merge-sort tree: O(log²n) but simpler code. |
| 21 | Persistent segtree vs wavelet tree? | Same asymptotics for k-th; wavelet tree uses less memory & better constants; persistent tree adds versioning and weighting. |
| 22 | Persistent segtree vs Mo's algorithm? | Mo's is offline O((n+q)√n); persistent is **online** O((n+q)log n). Use persistent for forced-online. |
| 23 | How do you handle "number of values ≤ x in a[l..r]"? | Same two-version walk, summing left counts where the value range is fully ≤ x; O(log n). |
| 24 | How are two versions kept "aligned" for subtraction? | Both built with the same `mid` splits, so corresponding nodes cover identical value ranges. |
| 25 | What's the build cost for all prefix versions? | O(n log n): one O(log n) update per element. |
| 26 | Can you do range **distinct count**? | Yes (offline-style): persistent tree over positions with ±1 at previous occurrences; query counts +1 positions in [l,r]. |

**Sample full answer — Q13 (k-th):**
"I compress the values to ranks `0..D−1`. I build a count segment tree over the value axis where each node stores how many elements fall in its value range. Version `i` is version `i−1` plus one at the bucket of `a[i]`, so version `i` is the histogram of the first `i` elements. To answer `(l,r,k)`, I note the histogram of `a[l..r]` is `version[r] − version[l−1]` bucket by bucket. I descend: at each node `leftCount = version[r].left.cnt − version[l−1].left.cnt`. If `k ≤ leftCount` the answer is in the smaller-value half, recurse left; otherwise subtract `leftCount` from `k` and go right. At the leaf I have the rank; map back to the value. Each query is one O(log n) descent over two roots."

---

## Senior Questions (Scale & Systems)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 27 | What's the total memory for n versions? | O(n log n); with lazy-empty version 0 it's O(m log n). |
| 28 | How do you avoid GC pressure from millions of nodes? | Node arena: struct-of-arrays with `int32` child indices; one big allocation, no per-node objects. |
| 29 | Why are reads lock-free? | Versions are immutable; readers traverse frozen subtrees with no locks. |
| 30 | How does a writer publish a new version safely? | Build the whole new path, then **atomically** store/append the root — readers never see a half-built tree. |
| 31 | What real systems use this pattern? | MVCC (Postgres), COW filesystems (ZFS/Btrfs), LMDB COW B+tree, Git, Clojure/Scala persistent vectors. |
| 32 | How do you bound version growth in a service? | Snapshot-per-window + retention ring; prune old roots so exclusive nodes are reclaimed. |
| 33 | What's the lazy-empty optimization? | Share one sentinel for all-zero subtrees; only split on first insert → O(1) version 0, O(m log n) total. |
| 34 | Concurrency model in one phrase? | Single writer appends versions, many readers snapshot — textbook MVCC. |
| 35 | When would you NOT use it in production? | Cache/IO-bound or memory-tight read-only workloads → prefer wavelet tree; durable transactional → use a DB's MVCC. |
| 36 | How does persistence relate to functional languages? | Immutable nodes + structural sharing = the default in Haskell/Clojure; persistent vectors are higher-fan-out path copying. |
| 37 | How do you reclaim memory in an arena? | Can't free single indices cheaply; use windowed/generational arenas and compact live versions. |

**Sample full answer — Q28 (arena):**
"Heap-allocating one object per node is the killer: millions of tiny objects thrash the allocator and the GC has to scan every pointer. I switch to a node arena — three parallel arrays `cnt[]`, `lc[]`, `rc[]` where a node is an `int32` index and children are `int32` indices, with index 0 as the empty sentinel. Allocation is a bump (`free++`). The GC now sees one big pointer-free slice instead of millions of objects, so pause times drop dramatically, and the packed layout (~12 bytes/node) roughly halves memory versus heap pointers."

---

## Professional Questions (Proofs & Theory)

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 38 | Prove an update allocates exactly `⌈log₂ n⌉+1` nodes. | Recurrence `N(w)=1+N(⌈w/2⌉)`, base `N(1)=1`; necessity: every path node's value changes, immutability forces re-alloc. |
| 39 | Derive total space after m updates. | `(2n−1) + m·(⌈log₂ n⌉+1) = Θ(n + m log n)`; lazy-empty drops the n term. |
| 40 | Prove the k-th descent is correct. | Loop invariant: k-th of `a[l..r]` with rank in `[lo,hi]` is the global k-th; left/right split by `leftCount`; induction + termination at leaf. |
| 41 | What is the fat-node method and its bound? | Each node stores (version,field,value) mods; O(1) amortized space per field write, O(log m) read overhead; enables full persistence. |
| 42 | Path copying vs fat nodes for a segment tree — which wins? | Both O(log n) space/update here; path copying gives O(log n) reads (no log m), so it wins for segment trees. |
| 43 | Why is the structure a `log n`-factor above the information-theoretic optimum? | It uses words/pointers, not bit-packing; wavelet trees hit Ω(n log σ) bits, persistent uses Θ(n log n) words. |
| 44 | Cache behavior of queries? | Θ(log n) misses (pointer hops across levels); persistence defeats clean vEB layout; wavelet wins on I/O. |
| 45 | Can immutable-node persistence beat Θ(log n) space per point update? | No — at least the changed-value path must be re-allocated; Θ(log n) is a lower bound for immutable nodes. |

**Sample full answer — Q38 (allocation count proof):**
"Let `N(w)` be allocations on a range of width `w`. Base: a leaf (`w=1`) allocates 1. Inductively, an internal node allocates itself (1) and recurses into exactly one child — the side containing the index — sharing the other. So `N(w)=1+N(w')` with `w'≤⌈w/2⌉`. The width halves each level, so the depth is `⌈log₂ n⌉`, giving `N(n)=⌈log₂ n⌉+1`. It's also necessary: every node on the path covers the updated index, so its aggregate changes, and since nodes are immutable we can't edit the old one — each must be freshly allocated. Hence exactly `⌈log₂ n⌉+1`."

---

## Extended Model Answers (Whiteboard-Ready)

These are the answers most likely to make or break a loop — practice delivering them with a small drawing.

**Q4 expanded — "Exactly how many new nodes per update, and why exactly that?"**
"Draw the tree. An update to index `i` walks one root-to-leaf path. At each internal node on the path I must create a *new* node because its aggregate (which covers `i`) changes, and the structure is immutable so I can't edit the old one. The off-path child pointer is copied verbatim — that's the sharing. The path has one node per level, and the height is `⌈log₂ n⌉`, so I create `⌈log₂ n⌉` internal nodes plus the leaf = `⌈log₂ n⌉ + 1`. Not fewer (each path node truly changes), not more (only one child is recursed into). For `n = 8` that's exactly 4, every time."

**Q14 expanded — "Convince me the `l−1` subtraction is correct, not just a trick."**
"Counts are linear in the version index: `version[i]` differs from `version[i−1]` by exactly `+1` at the bucket of `a[i]`. So for any node `u`, `cnt(u, r) − cnt(u, l−1)` telescopes to `Σ_{j=l}^{r} [rank(a_j) ∈ range(u)]` — the number of elements of `a[l..r]` in that node's value range. It holds for *every* node at once, so when I descend I can compute the left-child count of the sub-array as `right.left.cnt − left.left.cnt` at each level. Using `version[l]` instead would drop element `a[l]`."

**Q27 expanded — "Walk me through the memory math for a million versions."**
"Build version 0 is `~2n` nodes. Each update path-copies `⌈log₂ n⌉ + 1` nodes. After `m` updates: `2n + m·(log n + 1) = Θ(n + m log n)`. At `n = m = 10^6`, `log n ≈ 20`, so `~2·10^6 + 2·10^7 ≈ 2.2·10^7` nodes. In an arena at 12 bytes/node that's ~265 MB. The naive 'copy the whole tree each time' would be `m·2n = 2·10^12` nodes — about `n/log n ≈ 50,000×` more, completely infeasible. With lazy-empty version 0 the `2n` term vanishes and it's `Θ(m log n)`."

**Q40 expanded — "Prove the k-th descent terminates with the right answer."**
"Invariant: at each call the k-th smallest of `a[l..r]` whose value-rank is in `[lo,hi]` equals the global k-th. Initially `[lo,hi]` is the whole axis so it trivially holds. At a node, `leftCount` = number of `a[l..r]` elements in the left value-half. If `k ≤ leftCount`, the k-th is among the smaller values → recurse left, same `k`. Else the first `leftCount` are all smaller, so skip them: recurse right with `k − leftCount`. Each step halves the value range, terminating at a leaf in `⌈log₂ D⌉` steps; the leaf's rank maps to the answer. Both `1 ≤ k ≤ count` preconditions are maintained, so we never run off the end."

---

## Scenario / Design Questions

| # | Scenario | What a strong answer covers |
|---|----------|------------------------------|
| S1 | "Design a 'your rank as of last season' feature for 2M players." | Score-axis count tree; one persistent version per season snapshot; `rank` = prefix count; lock-free historical reads; snapshot-per-window to bound versions. |
| S2 | "Queries are forced-online (XOR with last answer). Mo's is out — now what?" | Persistent segtree answers immediately; build prefix versions; decode each query online. |
| S3 | "Memory is blowing up after a day of one-version-per-event." | Add retention ring (keep last W versions); snapshot-per-window; lazy-empty v0; arena to cut per-node bytes; consider wavelet tree if read-only. |
| S4 | "The service restarts and loses all history." | Rebuild from durable event log (O(m log n)); or serialize the arena (index children = no pointer fixup); or checkpoint + tail. |
| S5 | "GC pauses spike under write load." | Replace per-node objects with a struct arena (`int32` children); GC scans one pointer-free slice instead of millions of objects. |
| S6 | "We also need range *updates*, not just point updates." | Basic persistence is point-only; lazy + persistence is advanced and memory-heavy; consider whether the problem truly needs it or can be reframed. |

**Sample full answer — S1:**
"I'd index a segment tree by compressed score buckets where each node counts players in its score range; `rank(X)` is a prefix-count query in O(log n). For 'as of last season,' I freeze one persistent version at each season boundary — that root is immutable, so historical-rank reads are lock-free and scale across replicas with zero coordination. To avoid millions of versions, I keep a mutable ephemeral tree for 'right now' and only materialize a persistent version per snapshot window. Memory is `O(n + S·log n)` for `S` retained snapshots — tiny. This is essentially MVCC: a single writer publishes new roots, readers snapshot."

---

## Common Wrong Answers (and the Fix)

| Wrong answer | Why it's wrong | Correct framing |
|---|---|---|
| "Persistence means I copy the tree each update." | That's O(n) per version, O(nm) total. | Path copy *only the path*: O(log n) per version. |
| "I update in place and keep old roots." | In-place mutation corrupts every old version sharing that node. | Nodes are immutable; allocate new ones, return a new root. |
| "k-th subtracts `version[l]` from `version[r]`." | Off-by-one drops `a[l]`. | Subtract `version[l−1]`. |
| "I store `[lo,hi]` in each node." | Doubles memory; it's derivable. | Pass `lo,hi` as recursion parameters. |
| "Persistent and wavelet trees are interchangeable." | Wavelet is static and compact; persistent adds versioning. | Choose by memory vs. versioning needs. |
| "Mo's algorithm also handles forced-online." | Mo's must sort queries → offline. | Persistent/wavelet answer online. |

---

## Rapid-Fire Conceptual Checks

| # | Prompt | Crisp answer |
|---|--------|--------------|
| R1 | One update touches how many *other* versions? | Zero — old versions are untouched. |
| R2 | Cost to "switch to version t"? | O(1) (pick `roots[t]`). |
| R3 | Does query mutate anything? | No — pure read. |
| R4 | k-th uses how many roots per query? | Two (`l−1` and `r`), one path. |
| R5 | Can you do range *update* with lazy + persistence in the basic form? | Not basic — it's advanced and memory-heavy. |
| R6 | Identity for a count tree? | 0 (counts), combine = sum. |
| R7 | What makes old versions thread-safe to read? | Immutability — no writer ever changes them. |
| R8 | Naive full-copy memory vs path copying? | Θ(nm) vs Θ(n + m log n). |

---

## Coding Challenge — Range K-th Smallest

> **Problem.** Given a static array `a[1..n]` and `q` queries `(l, r, k)` (1-indexed, `1 ≤ k ≤ r−l+1`), return the **k-th smallest** value among `a[l..r]` for each query.
> **Approach.** Coordinate-compress values; build `n+1` prefix count-versions of a persistent segment tree over the value axis; answer each query by descending `version[r]` and `version[l−1]` in lockstep using the left-count, in O(log n).
> **Complexity.** Build O(n log n), each query O(log n), memory O(n log n).
>
> **Sample.** `a = [3, 1, 4, 1, 5]`, queries `(2,4,2) (1,5,3) (1,5,1) (3,5,2)` → `1 3 1 4`.

### Go

```go
package main

import (
	"bufio"
	"fmt"
	"os"
	"sort"
)

type Node struct {
	cnt         int
	left, right *Node
}

var D int

func build(lo, hi int) *Node {
	if lo == hi {
		return &Node{}
	}
	mid := (lo + hi) / 2
	return &Node{left: build(lo, mid), right: build(mid+1, hi)}
}

func insert(prev *Node, lo, hi, g int) *Node {
	if lo == hi {
		return &Node{cnt: prev.cnt + 1}
	}
	mid := (lo + hi) / 2
	if g <= mid {
		l := insert(prev.left, lo, mid, g)
		return &Node{cnt: l.cnt + prev.right.cnt, left: l, right: prev.right}
	}
	r := insert(prev.right, mid+1, hi, g)
	return &Node{cnt: prev.left.cnt + r.cnt, left: prev.left, right: r}
}

func kth(l, r *Node, lo, hi, k int) int {
	if lo == hi {
		return lo
	}
	mid := (lo + hi) / 2
	leftCnt := r.left.cnt - l.left.cnt
	if k <= leftCnt {
		return kth(l.left, r.left, lo, mid, k)
	}
	return kth(l.right, r.right, mid+1, hi, k-leftCnt)
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()

	a := []int{3, 1, 4, 1, 5} // (replace with input parsing in a judge)
	n := len(a)

	sorted := append([]int(nil), a...)
	sort.Ints(sorted)
	uniq := sorted[:0]
	for i, v := range sorted {
		if i == 0 || v != sorted[i-1] {
			uniq = append(uniq, v)
		}
	}
	D = len(uniq)
	rank := func(v int) int { return sort.SearchInts(uniq, v) }

	roots := make([]*Node, n+1)
	roots[0] = build(0, D-1)
	for i := 1; i <= n; i++ {
		roots[i] = insert(roots[i-1], 0, D-1, rank(a[i-1]))
	}

	queries := [][3]int{{2, 4, 2}, {1, 5, 3}, {1, 5, 1}, {3, 5, 2}}
	for _, q := range queries {
		l, r, k := q[0], q[1], q[2]
		g := kth(roots[l-1], roots[r], 0, D-1, k)
		fmt.Fprintf(writer, "%d\n", uniq[g])
	}
	// prints: 1 3 1 4
	_ = reader
}
```

### Java

```java
import java.util.*;

public class KthInRange {
    static final class Node {
        int cnt; Node left, right;
        Node() {}
        Node(int cnt, Node l, Node r) { this.cnt = cnt; this.left = l; this.right = r; }
    }
    static int D;

    static Node build(int lo, int hi) {
        if (lo == hi) return new Node();
        int mid = (lo + hi) >>> 1;
        return new Node(0, build(lo, mid), build(mid + 1, hi));
    }

    static Node insert(Node p, int lo, int hi, int g) {
        if (lo == hi) return new Node(p.cnt + 1, null, null);
        int mid = (lo + hi) >>> 1;
        if (g <= mid) {
            Node l = insert(p.left, lo, mid, g);
            return new Node(l.cnt + p.right.cnt, l, p.right);
        } else {
            Node r = insert(p.right, mid + 1, hi, g);
            return new Node(p.left.cnt + r.cnt, p.left, r);
        }
    }

    static int kth(Node l, Node r, int lo, int hi, int k) {
        if (lo == hi) return lo;
        int mid = (lo + hi) >>> 1;
        int leftCnt = r.left.cnt - l.left.cnt;
        if (k <= leftCnt) return kth(l.left, r.left, lo, mid, k);
        return kth(l.right, r.right, mid + 1, hi, k - leftCnt);
    }

    static int lowerBound(int[] arr, int v) {
        int lo = 0, hi = arr.length;
        while (lo < hi) { int m = (lo + hi) >>> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
        return lo;
    }

    public static void main(String[] args) {
        int[] a = {3, 1, 4, 1, 5};
        int n = a.length;

        int[] sorted = a.clone();
        Arrays.sort(sorted);
        int[] uniq = Arrays.stream(sorted).distinct().toArray();
        D = uniq.length;

        Node[] roots = new Node[n + 1];
        roots[0] = build(0, D - 1);
        for (int i = 1; i <= n; i++) {
            roots[i] = insert(roots[i - 1], 0, D - 1, lowerBound(uniq, a[i - 1]));
        }

        int[][] queries = {{2, 4, 2}, {1, 5, 3}, {1, 5, 1}, {3, 5, 2}};
        StringBuilder sb = new StringBuilder();
        for (int[] q : queries) {
            int g = kth(roots[q[0] - 1], roots[q[1]], 0, D - 1, q[2]);
            sb.append(uniq[g]).append('\n');
        }
        System.out.print(sb); // 1 3 1 4
    }
}
```

### Python

```python
import sys, bisect
input = sys.stdin.readline
sys.setrecursionlimit(1 << 20)


class Node:
    __slots__ = ("cnt", "left", "right")

    def __init__(self, cnt=0, left=None, right=None):
        self.cnt, self.left, self.right = cnt, left, right


def build(lo, hi):
    if lo == hi:
        return Node()
    mid = (lo + hi) // 2
    return Node(0, build(lo, mid), build(mid + 1, hi))


def insert(p, lo, hi, g):
    if lo == hi:
        return Node(p.cnt + 1)
    mid = (lo + hi) // 2
    if g <= mid:
        l = insert(p.left, lo, mid, g)
        return Node(l.cnt + p.right.cnt, l, p.right)
    r = insert(p.right, mid + 1, hi, g)
    return Node(p.left.cnt + r.cnt, p.left, r)


def kth(l, r, lo, hi, k):
    if lo == hi:
        return lo
    mid = (lo + hi) // 2
    left_cnt = r.left.cnt - l.left.cnt
    if k <= left_cnt:
        return kth(l.left, r.left, lo, mid, k)
    return kth(l.right, r.right, mid + 1, hi, k - left_cnt)


def solve(a, queries):
    n = len(a)
    uniq = sorted(set(a))
    D = len(uniq)
    roots = [build(0, D - 1)]
    for v in a:
        roots.append(insert(roots[-1], 0, D - 1, bisect.bisect_left(uniq, v)))
    out = []
    for (l, r, k) in queries:
        g = kth(roots[l - 1], roots[r], 0, D - 1, k)
        out.append(uniq[g])
    return out


if __name__ == "__main__":
    a = [3, 1, 4, 1, 5]
    qs = [(2, 4, 2), (1, 5, 3), (1, 5, 1), (3, 5, 2)]
    print(*solve(a, qs))  # 1 3 1 4
```

### Follow-up extensions an interviewer may ask

1. **Number of elements ≤ x in `a[l..r]`.** Descend by value; sum left counts (`version[r]−version[l−1]`) where the node's value range ⊆ `(-∞, x]`. O(log n).
2. **Count of values in `[x, y]` for `a[l..r]`.** A range query on the *difference* of the two versions. O(log n).
3. **Forced-online queries** (each `(l,r,k)` XORed with the previous answer). Persistent segtree handles it directly; Mo's cannot.
4. **Memory under pressure.** Move to an arena (`int32` children) + lazy-empty version 0 → O(m log n) memory; or switch to a wavelet tree for half the memory.
5. **K-th with updates.** Combine with a BIT of persistent trees, or use a merge-sort-tree-on-BIT — discuss the O(log²n) cost.

---

## Mock Interview Walkthrough — "Range K-th, 45 Minutes"

A realistic end-to-end flow showing how to drive the problem from clarification to optimized code.

**Minute 0–3 — Clarify.**
- "Is the array static or do values change?" → *static* (if dynamic, flag the O(log²n) variant).
- "Are queries online (one at a time, possibly dependent) or can I batch them?" → if forced-online, persistent/wavelet; if offline, mention Mo's as an alternative.
- "Value range?" → if huge, I'll coordinate-compress.
- "Constraints on n, q?" → sets the target: `n, q ≤ 2·10^5` ⇒ need O((n+q)log n), so O(log n)/query.

**Minute 3–8 — State the approach out loud.**
"I'll build a persistent segment tree over the compressed value axis. Version i is the histogram of the first i elements. For a query (l,r,k) I subtract version[l−1] from version[r] node-by-node while descending, using the left-half count to choose a direction. Build O(n log n), query O(log n), memory O(n log n)."

**Minute 8–12 — Draw the small example.** Use `a=[3,1,4,1,5]`, show the prefix histograms table, walk the `(2,4,2)→1` descent. This proves you understand it before coding.

**Minute 12–30 — Code it.** Write `build`, `insert` (path copy), `kth` (two-version descent), and the compression + driver. Use the language you're strongest in; the Go/Java/Python solutions in this file are the reference.

**Minute 30–38 — Test.** Run the sample, then call out edge cases: `k=1` (min), `k=r−l+1` (max), `l=r` (single element), duplicate values, value below/above all.

**Minute 38–45 — Optimize / discuss.** Mention the arena for memory/GC, lazy-empty version 0, lock-free reads, and the wavelet-tree alternative if memory is tight. If asked for follow-ups, do "count ≤ x in range" (one more descent variant).

### What separates a hire from a no-hire here

| Signal | Hire | No-hire |
|---|---|---|
| Path copying | Explains O(log n) nodes + sharing precisely | "Copy the tree each time" |
| Subtraction | Justifies `version[l−1]` with linearity | Off-by-one, can't explain why |
| Coordinate compression | Applies it unprompted | Builds over raw 10^9 axis |
| Complexity | States build/query/memory correctly | Hand-waves "it's log" |
| Alternatives | Compares wavelet/merge-sort/Mo's with trade-offs | Knows only one structure |
| Edge cases | Tests k=1, k=max, l=r, dups | Submits without testing |

---

## Implementation Pitfalls Deep-Dive

Interviewers love to probe whether you've *actually written* this. Be ready for these.

**1. "Your old version's query changed after an update — what happened?"**
You mutated a shared node. The classic slip is writing `node.cnt += 1` on the recursion's input node instead of allocating a fresh one. Fix: every recursion level *constructs* a new node; never assign into a field of the argument.

**2. "Your k-th returns the wrong value off-by-one."**
Two usual causes: (a) using `version[l]` instead of `version[l−1]`; (b) `k` indexing — the algorithm is 1-based (`k=1` is the minimum), so `if k <= leftCount` (not `<`). Walk the boundary `k=leftCount` to confirm.

**3. "Out of memory at n=10^6."**
You used heap objects (24 B + header) or forgot lazy-empty. Switch to an arena (`int32` children, ~12 B) and make version 0 a sentinel so total is `O(m log n)`, not `O(n + m log n)`.

**4. "Stack overflow on the judge."**
Deep recursion. In Python `sys.setrecursionlimit(1<<20)`; in any language consider an iterative descent for `kth` (a simple while-loop, since it never branches).

**5. "It's correct but TLE."**
Function-call overhead and pointer chasing. Inline the descent, use the arena (contiguous memory → fewer cache misses), and avoid recomputing `rank` inside the hot loop (precompute compressed values once).

**6. "How do you test it without a judge?"**
Brute force: for random arrays and random `(l,r,k)`, sort `a[l..r]` and compare the `k`-th. Also a *persistence* test: snapshot results, run more updates, re-query old versions, assert unchanged.

---

## Additional Tiered Questions (Bank B)

| # | Tier | Question | Answer focus |
|---|------|----------|--------------|
| B1 | J | What is structural sharing? | Two versions referencing the same physical subtree node because it didn't change. |
| B2 | J | Does querying ever allocate? | No — pure reads follow pointers. |
| B3 | J | What's the identity for the count tree? | 0; combine = sum. |
| B4 | M | Why build over the value axis for k-th? | So nodes count elements per value bucket; left-count drives the descent. |
| B5 | M | What is the lazy-empty version 0? | Share one sentinel for all-zero subtrees; split on first insert; O(1) v0. |
| B6 | M | Could you answer "median of a[l..r]"? | Yes — it's k-th with k = ⌈(r−l+1)/2⌉. |
| B7 | S | Why does an arena help GC? | One pointer-free slice vs. millions of objects; GC scans almost nothing. |
| B8 | S | How do you make versions durable cheaply? | Replay a durable event log on startup, or serialize the arena (index children, no pointer fixup). |
| B9 | S | What caps version count in a stream? | Snapshot-per-window + retention ring. |
| B10 | P | Why can min/max not use the subtraction trick? | Min is a monoid but not a group — non-invertible, so you can't subtract two minima. |
| B11 | P | Build cost of T_0 by Master theorem? | `B(n)=2B(n/2)+O(1)` → Case 1 → Θ(n). |
| B12 | P | Fat-node read cost and why path copying avoids it? | O(log m) binary search per node; path copying's root already points at the right node → O(1) per node. |

**Sample full answer — B10 (group vs monoid):**
"The k-th subtraction relies on `version[r] − version[l−1]` giving the sub-range's per-bucket value. Subtraction requires an inverse — counts live in the group `(ℤ, +, 0)`, so it works. Min and max form a monoid (associative with identity ±∞) but have *no* inverse: knowing `min(a[1..r])` and `min(a[1..l−1])` doesn't recover `min(a[l..r])`. So persistence still lets you do a range-min query on any single version, but the prefix-difference k-th trick is specific to additive (group) aggregates."

---

## Quick Self-Test (cover the answers)

1. How many nodes does one update allocate, for `n = 16`? → **5** (`log₂16 + 1`).
2. Total memory for `m = 10^5` versions, `n = 10^5`? → **O(n log n) ≈ 1.9·10^6 nodes**.
3. Which version do you subtract for `a[l..r]`? → **`version[l−1]`**.
4. Is the k-th query online-capable? → **Yes**.
5. Partial or full persistence for k-th? → **Partial** (linear version chain).
6. One-sentence reason reads are lock-free? → **Nodes are immutable, so readers never race a writer.**
7. Cheapest way to cut memory in half vs. persistent tree? → **Use a wavelet tree** (loses versioning).
8. What real system is this pattern? → **MVCC / COW filesystems / Git / functional vectors.**

---

## Closing Checklist

- [ ] Can explain path copying and the `⌈log₂ n⌉+1` allocation count.
- [ ] Can derive O(n + m log n) space and contrast with naive O(nm).
- [ ] Can build prefix versions and answer range k-th in O(log n), live, in one language.
- [ ] Can state partial vs full persistence and which the k-th needs.
- [ ] Can compare against merge-sort tree, wavelet tree, and Mo's, and justify the choice.
- [ ] Can discuss arenas, lock-free reads, and MVCC analogy for a systems round.

---

## One-Liners to Memorize

- **Persistence** = keep every version queryable after updates.
- **Path copying** = clone only the `⌈log₂ n⌉+1` nodes on the update path; share the rest.
- **Nodes are immutable** — that's what keeps old versions correct and reads lock-free.
- **k-th in `a[l..r]`** = walk `version[r]` and `version[l−1]` down the value axis using `leftCount = right.left.cnt − left.left.cnt`.
- **Subtract `version[l−1]`**, not `version[l]`.
- **Memory** = `O(n + m log n)`; lazy-empty makes it `O(m log n)`; naive copy is `O(nm)`.
- **Partial persistence** (read any, write latest) is all k-th needs.
- **Online**: persistent/wavelet yes, Mo's no.
- **Same pattern as** MVCC, ZFS/Btrfs snapshots, Git, functional vectors.
- **Memory-tight read-only?** Prefer a wavelet tree.

---

**Next step:** Drill the graded exercises in [`tasks.md`](./tasks.md) — build, query, k-th, count-≤-x, and a persistence-immutability stress test, all in Go, Java, and Python.
