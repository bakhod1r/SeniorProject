# Fibonacci Heap — Interview Preparation

> **Honest framing.** Fibonacci heaps are primarily a *theory-of-algorithms* topic. They appear in graduate textbooks, in the analysis of Dijkstra and Prim, and in research papers on amortized complexity. They almost never appear in production code, and the number of interviews that actually require you to *implement* one is vanishingly small. The interview value of this topic is therefore in what it teaches you: amortized analysis, potential functions, lazy data structures, and the gap between asymptotic and real-world performance. Expect questions that test understanding, not coding speed.

---

## Quick-Reference Cheat Sheet

| Operation         | Amortized | Worst case  | Notes                                                  |
|-------------------|-----------|-------------|--------------------------------------------------------|
| `insert`          | O(1)      | O(1)        | Append to root list, update min pointer.               |
| `find-min`        | O(1)      | O(1)        | Min pointer is maintained.                             |
| `merge` / `union` | O(1)      | O(1)        | Concatenate two circular root lists.                   |
| `extract-min`     | O(log n)  | O(n)        | Triggers the consolidate phase.                        |
| `decrease-key`    | O(1)      | O(log n)    | Cut + cascading cut.                                   |
| `delete`          | O(log n)  | O(n)        | `decrease-key` to -inf, then `extract-min`.            |

**Structural invariants**

- A forest of min-heap-ordered trees in a circular doubly linked root list.
- Each node carries: `key`, `degree`, `mark`, `parent`, `child`, `left`, `right`.
- Maximum degree of any node `D(n) <= floor(log_phi(n))`, where `phi = (1+sqrt(5))/2`.
- Subtree of a node of degree `k` contains at least `F_{k+2}` nodes (Fibonacci number).
- Potential: `Phi(H) = t(H) + 2 * m(H)` where `t` = number of trees in the root list, `m` = number of marked non-root nodes.

**When you would actually reach for it**

- Theoretical analysis of Dijkstra / Prim on dense graphs (`O(E + V log V)`).
- Algorithms where `decrease-key` dominates and `n` is enormous.
- Almost never in real code: cache misses and constants kill the wins.

---

## Junior Questions (10 Q&A)

### J1. What is a Fibonacci heap, in one sentence?

A Fibonacci heap is a collection of min-heap-ordered trees, organized as a circular doubly linked root list, that supports `insert`, `find-min`, `merge`, and `decrease-key` in O(1) amortized time and `extract-min` / `delete` in O(log n) amortized. It defers most of its real work until `extract-min`, which is why most operations look cheap. The "Fibonacci" in the name comes from the proof: subtrees grow at least as fast as the Fibonacci sequence, bounding the maximum degree.

### J2. How does it differ from a binary heap?

A binary heap is a single complete binary tree stored in an array, while a Fibonacci heap is a forest of arbitrary-shape trees stored as a linked structure. The binary heap has O(log n) worst case for `insert` and `decrease-key`; the Fibonacci heap has O(1) amortized for both. The binary heap has excellent cache locality and tiny constants; the Fibonacci heap has terrible cache locality and large constants, which is why it almost always loses in practice.

### J3. What operations does it support?

`insert`, `find-min`, `extract-min`, `decrease-key`, `delete`, and `merge` (sometimes called `union`). The headline feature is that `insert`, `find-min`, `merge`, and `decrease-key` are O(1) amortized. `extract-min` and `delete` are O(log n) amortized. There is no efficient `search` for an arbitrary key, just like in a binary heap.

### J4. What does "amortized" mean here?

Amortized analysis bounds the *average* cost of operations over a worst-case sequence, not the cost of a single operation. A single `extract-min` can do O(n) actual work, but across any sequence of operations, the total work is bounded as if each cost only O(log n). This is acceptable when the application cares about total throughput, not the latency of any individual call.

### J5. What is the role of the `min` pointer?

The Fibonacci heap stores a direct pointer to the node with the minimum key, so `find-min` is O(1). The pointer is updated lazily: `insert` and `decrease-key` only update it when the new key is smaller, and `extract-min` rebuilds it as part of consolidation. The pointer is what makes `find-min` constant and is also why `merge` is O(1) (compare the two min pointers and keep the smaller).

### J6. Why are there *multiple* trees in the root list?

Because Fibonacci heaps are *lazy*. `insert` does not try to merge the new node into existing structure; it just drops a single-node tree into the root list. `merge` likewise just concatenates two root lists. The cleanup happens later, during `extract-min`, when the consolidate step merges trees of equal degree. This deferral is what lets the cheap operations be O(1).

### J7. What is a "marked" node, intuitively?

A node is marked when it has lost a child since the last time it became a child of someone. The mark is a flag that says "you have already lost one child; if you lose another, you will be cut from your parent too." This is the rule that limits how unbalanced a tree can get when `decrease-key` keeps cutting nodes out.

### J8. Why do roots never carry a mark?

Marks only mean something for non-root nodes, because the cascading-cut rule applies to children losing parents. When a node is cut and promoted to the root list, its mark is cleared. The potential function `Phi = t + 2m` only counts marks on non-root nodes for the same reason.

### J9. Is `extract-min` worst-case O(log n)?

No — worst case it is O(n). A long sequence of cheap inserts can build a root list of size n, and then a single `extract-min` has to consolidate all of them. The O(log n) bound is *amortized*: the prior inserts each paid extra credit, which funds the expensive consolidate. If you need worst-case guarantees per operation, Fibonacci heaps are the wrong tool.

### J10. Analysis: Why is `merge` O(1)?

Because both heaps already maintain the invariants (forest of min-heap-ordered trees, circular root lists, min pointer). To merge, you splice the two circular doubly linked lists together (constant pointer surgery) and keep whichever min pointer is smaller. No restructuring, no key comparisons across trees, no degree fixups. The pending work simply accumulates and is paid for at the next `extract-min`.

---

## Middle Questions (12 Q&A)

### M1. Walk through `extract-min` step by step.

(1) Add each child of the min node to the root list and clear their parent pointers. (2) Remove the min node from the root list. (3) Consolidate: scan the root list, and for any two trees of the same degree, link the one with the larger root key under the one with the smaller. Repeat until all root degrees are distinct. (4) Walk the resulting root list once to find the new min and rebuild the `min` pointer. The consolidate phase is where the amortized O(log n) bound is paid out.

### M2. Why do we consolidate trees by degree?

To keep the number of trees in the root list small. After many lazy inserts, the root list can be huge, and `find-min` after extraction would have to scan all of it. By merging trees of equal degree (like binomial heaps do), we end up with at most `D(n) + 1` trees in the root list, where `D(n)` is the maximum possible degree, bounded by `log_phi(n)`. This caps the cost of all future scans.

### M3. Why is the maximum degree `D(n)` only O(log n)?

Because of the Fibonacci-bound lemma: the subtree rooted at a node of degree `k` contains at least `F_{k+2}` nodes. Since `F_{k+2}` grows like `phi^k`, having `n` nodes means `phi^k <= n`, so `k <= log_phi(n) ~ 1.44 log_2(n)`. The mark + cascading-cut rule is exactly what enforces this lemma: it prevents a node from losing too many children and still having a high degree.

### M4. Explain `decrease-key` in detail.

(1) Update the node's key. (2) If the heap order is now violated (the node's key is less than its parent's), cut the node out and add it to the root list with its mark cleared. (3) Apply *cascading cut* to the old parent: if the parent is unmarked and not a root, mark it; if it is already marked, cut it too and recurse upward. (4) Update the `min` pointer if the new key is smaller than the current min. The expensive part — the cascade — is exactly what gives the proof its potential-function slack.

### M5. What is a cascading cut and why is it necessary?

A cascading cut is the recursive cutting of a parent that has now lost two children. It is necessary to guarantee the Fibonacci-bound lemma. Without it, `decrease-key` could repeatedly hollow out a node's children, leaving a high-degree node with very few descendants — which would break the `O(log n)` bound on max degree, and therefore the `O(log n)` amortized cost of `extract-min`.

### M6. Analysis: Why is the bound on subtree size `F_{k+2}`?

If a node `x` has children in the order they were linked, the `i`-th child must have had degree at least `i - 2` at link time (because of the cascading-cut rule limiting how much that child could have shrunk afterward). Define `S_k` as the minimum size of a subtree rooted at a degree-`k` node. The recurrence `S_k = 2 + S_0 + S_1 + ... + S_{k-2}` collapses exactly to the Fibonacci recurrence, giving `S_k >= F_{k+2}`. This is the load-bearing combinatorial lemma of the whole structure.

### M7. What is the potential function and what does each term mean?

`Phi(H) = t(H) + 2 * m(H)`, where `t(H)` is the number of trees in the root list and `m(H)` is the number of marked non-root nodes. The `t` term pays for future consolidate work (each extra root costs O(1) to merge). The `2m` term pays for future cascading cuts: each cascade unmarks a node and adds it to the root list — `1` unit funds the new root, and the *other* unit funds the work of cutting. The `2x` coefficient is the cleanest way to make the amortized bound on `decrease-key` come out to O(1).

### M8. Analysis: Why does the potential function use `2x` for marked nodes?

Because each cascading cut does two units of constant work: (a) it cuts the node and adds it to the root list, and (b) it transitions a marked node back to an unmarked root. The `2` ensures both transitions are pre-paid. With a coefficient of `1`, the potential decrease from un-marking would not be enough to cover the actual cost of the cascade, and the amortized bound would slip from O(1) to O(log n) — which would defeat the whole point of the structure.

### M9. Compare amortized vs worst-case for the main operations.

| Op            | Amortized | Worst case | Why the gap                                         |
|---------------|-----------|------------|-----------------------------------------------------|
| insert        | O(1)      | O(1)       | No gap.                                             |
| extract-min   | O(log n)  | O(n)       | Root list can be huge before consolidation.         |
| decrease-key  | O(1)      | O(log n)   | Cascade may climb O(log n) levels.                  |
| delete        | O(log n)  | O(n)       | Inherits the extract-min worst case.                |

For interactive systems with hard per-operation latency budgets, the worst-case column matters more than the amortized one.

### M10. How is the root list usually implemented?

As a circular doubly linked list, so that splicing two lists, removing a node, and inserting a new root are all O(1) pointer operations. Each tree's children are stored as another circular doubly linked list rooted at the parent's `child` pointer. Circular lists are used (instead of singly linked or null-terminated lists) so that you do not have to handle a "first node" or "last node" boundary case during splicing.

### M11. When would you NOT use a Fibonacci heap?

Almost always. The constants are large, memory layout is pointer-chasing-heavy, cache behavior is poor, and the worst-case per-operation latency is high. For Dijkstra on real road networks, a binary heap or a pairing heap or even a `d`-ary heap beats it. The only times you reach for it are: (a) theoretical proofs that need O(1) amortized `decrease-key`, (b) graph algorithms on enormous very sparse graphs where every `decrease-key` matters, and (c) interviews about amortized analysis.

### M12. What is the relationship to binomial heaps?

A Fibonacci heap can be thought of as a "lazy binomial heap." Both consist of forests of trees of well-defined shapes. A binomial heap keeps its root list tidy after every operation — degrees are always distinct, and `union` already pays the consolidation cost up front. A Fibonacci heap defers all of that and adds the `mark` mechanism to support O(1) amortized `decrease-key`, which a binomial heap cannot do.

---

## Senior Questions (10 Q&A)

### S1. Prove the amortized cost of `insert` is O(1).

The actual work is `c1` (constant) — append a node to the root list and possibly update `min`. The potential change is `Delta Phi = +1` (one new tree, no new marks). The amortized cost is `c1 + 1 = O(1)`. This is the easy case; the credit `+1` is the funding that `extract-min` will later spend to consolidate this tree.

### S2. Prove the amortized cost of `extract-min` is O(log n).

Let `t` be the root-list size before the operation and `t'` after. The actual work is `O(t + D(n))`: moving min's children into the root list (`O(D(n))`) plus the consolidate scan (`O(t + D(n))`). After consolidation, `t' <= D(n) + 1`. So `Delta Phi <= (D(n) + 1) - t` and the amortized cost is `O(t + D(n)) + (D(n) + 1 - t) = O(D(n)) = O(log n)`. The pre-paid potential from many cheap inserts is exactly what funds the bursty consolidate.

### S3. Prove the amortized cost of `decrease-key` is O(1).

Let `c` be the number of cascading cuts performed. Actual work is `O(c)`. Each cascade promotes a marked node to the root list (so `t` grows by `c`) and clears its mark (so `m` drops by `c`). Plus the node being decreased itself becomes a root, so `t` grows by `1`. At most one previously unmarked non-root becomes marked at the top of the cascade, so `m` may rise by `1`. Potential change: `Delta Phi <= (c + 1) + 2 * (-c + 1) = -c + 3`. Amortized cost is `O(c) + (-c + 3) = O(1)`.

### S4. Why exactly Fibonacci numbers, and not some other recurrence?

Because the cascading-cut rule produces exactly the Fibonacci recurrence on subtree sizes. The lemma `S_k = S_{k-1} + S_{k-2}` falls out of the structural rule "you may lose at most one child before being cut yourself." Any rule "you may lose at most `r-1` children" would produce a different recurrence and a different growth rate. The choice of `r = 2` is the smallest one that still gives a logarithmic max degree while keeping `decrease-key` cheap.

### S5. Analysis: Why `F_{k+2}` specifically (and not `F_k` or `F_{k+1}`)?

Because of the base cases of the size recurrence. A node of degree `0` has size `1`, and a node of degree `1` has size at least `2`. With `F_0 = 0, F_1 = 1, F_2 = 1, F_3 = 2`, the alignment `S_k >= F_{k+2}` matches: `S_0 >= 1 = F_2`, `S_1 >= 2 = F_3`. The "+2" is just an indexing artifact of how the Fibonacci sequence is conventionally numbered.

### S6. How does the Fibonacci heap help Dijkstra's algorithm?

Dijkstra does `V` `extract-min` operations and up to `E` `decrease-key` operations. With a binary heap: `O((V + E) log V)`. With a Fibonacci heap: `V` extracts at O(log V) amortized = `O(V log V)`, and `E` decrease-keys at O(1) amortized = `O(E)`, total `O(E + V log V)`. This is asymptotically faster on dense graphs (when `E = Theta(V^2)`), where binary heap gives `O(V^2 log V)` and Fibonacci gives `O(V^2)`. On sparse graphs the difference vanishes.

### S7. How does it help Prim's MST?

Same asymptotic story as Dijkstra. Prim also does `V` extracts and at most `E` decrease-keys. Theoretical bound improves to `O(E + V log V)`. The catch is the same: real implementations of Prim and Dijkstra almost always use a binary heap or a pairing heap, because the practical constant on Fibonacci heaps is bad enough that the asymptotic win does not materialize until graphs are absurdly large.

### S8. Analysis: When would you NOT use a Fibonacci heap?

When per-operation worst case matters (real-time systems, latency-sensitive paths). When `n` is small (cache-friendly arrays win). When the graph is sparse and `E = O(V)` (no asymptotic gain). When the implementation budget is tight (writing a correct Fibonacci heap with cascading cuts is finicky). And almost always in production: pairing heaps and `d`-ary heaps tend to outperform on real workloads despite worse theory.

### S9. What is a pairing heap and how does it compare?

A pairing heap is a much simpler self-adjusting heap that achieves O(1) actual for `insert` and `merge` and is conjectured to achieve O(1) amortized for `decrease-key` (the exact bound is still an open problem; it is known to be at most `O(log n / log log n)`). In practice, pairing heaps usually beat Fibonacci heaps on every operation because of vastly better cache behavior and shorter pointer chains, while being one-third the code.

### S10. Are there variants that fix Fibonacci heap's weaknesses?

Yes. *Relaxed heaps* and *rank-pairing heaps* aim for similar theoretical bounds with simpler implementations. *Strict Fibonacci heaps* (Brodal/Lagogiannis/Tarjan) achieve the same bounds *worst case*, not just amortized — solving the worst-case problem. *Quake heaps* and *violation heaps* are alternative attempts. None has displaced binary/pairing heaps in practice; they remain mostly theoretical contributions.

---

## Professional Questions (8 Q&A)

### P1. Production case: where have Fibonacci heaps actually shipped?

Realistically: nearly nowhere in mainstream production systems. Library implementations exist (e.g. in Boost Graph, in some academic algorithm packages, in Apache Commons Collections experiments), but most production graph code uses binary heaps, pairing heaps, or `d`-ary heaps. The honest professional answer is "I have read about them, I understand the analysis, and I would push back if a teammate proposed using one in production without a benchmark proving they win." The right tool for fast Dijkstra in practice is usually a 4-ary or 8-ary heap.

### P2. Analysis: How does CPU cache behavior compare with binary heaps?

A binary heap is laid out in a contiguous array; parent/child arithmetic is `i/2` and `2i / 2i+1`, which produces excellent prefetcher behavior and L1-friendly access. A Fibonacci heap is a graph of nodes connected by four or five pointers each; every operation jumps through cache lines. On modern hardware, a cache miss costs hundreds of cycles, so a binary heap doing "more work" in cycles often beats a Fibonacci heap doing "less work" in operations. This is the single biggest reason the theory does not translate.

### P3. How would you implement `decrease-key` if your heap nodes are not externally referenced?

You cannot. `decrease-key` requires a handle to the node, because there is no way to *find* a node by key in a heap. Practical implementations return an opaque handle from `insert` and require the caller to store it. In Dijkstra, the handle is stored in a `node -> handle` map; in Prim, same. If you cannot keep handles, you have to fall back to a lazy "insert duplicate, skip stale on extract" pattern that gives up the asymptotic advantage anyway.

### P4. How do you benchmark a Fibonacci heap honestly?

Pick a real workload (e.g. Dijkstra on a published road network like OSM extracts, or on Erdős-Rényi graphs at several densities). Implement the same algorithm with binary heap, 4-ary heap, pairing heap, and Fibonacci heap. Warm caches, run multiple trials, report median wall time and a count of cache misses (perf stat or equivalent). Be honest about what you find: in almost every published comparison the binary or 4-ary heap wins until graphs are tens of millions of vertices and densities are unusual.

### P5. What goes wrong if you forget the `mark` mechanism?

`decrease-key` would still produce a correct heap order, but it would no longer be possible to prove `D(n) = O(log n)`. A sequence of carefully chosen `decrease-key` calls could shrink subtrees beneath high-degree nodes, leaving roots with many children but tiny subtrees. The Fibonacci-bound lemma fails, `extract-min` consolidate scans degree slots up to `n - 1`, and the amortized bound degrades from O(log n) to O(n). The mark is structural, not cosmetic.

### P6. What goes wrong if you make the cut-threshold 3 instead of 2?

(One lost child unmarked, two lost children marked, three lost children cut.) The structural lemma changes: instead of `S_k = 2 + sum_{i=0}^{k-2} S_i` (Fibonacci-like), you get a recurrence like `S_k = 3 + sum_{i=0}^{k-3} S_i`, which still grows exponentially but with a smaller base. Max degree stays O(log n), but the constants change. `decrease-key` becomes cheaper in actual work but the potential function needs more credit per mark. The Fibonacci heap is the simplest, most natural choice at threshold `2`; other thresholds work but bring no advantage.

### P7. Analysis: Why does the standard binary heap usually still win on Dijkstra?

Because real graphs are sparse (`E = O(V)`), so the binary heap's `(V + E) log V = O(V log V)` matches the Fibonacci heap's `O(E + V log V) = O(V log V)` asymptotically — but the binary heap has tiny constants, contiguous memory, and predictable branches. The asymptotic break-even between binary and Fibonacci heap requires `E` to be a substantial fraction of `V^2`, which is exotic. Pairing heaps and 4-ary heaps sit in a middle ground that beats both for most workloads.

### P8. How do you explain a Fibonacci heap to a junior teammate?

"Imagine a heap that says 'I'll insert this node now and clean up later.' Inserts and merges are just pointer surgery, almost free. The cleanup happens once, when you ask for the minimum, and it's bounded because of a clever rule: a node can lose at most one child before getting promoted to the top. That rule forces every tree to grow at least as fast as Fibonacci numbers, which is why no tree gets very deep. Cool theory, slow in practice — we use binary heaps."

---

## Behavioral / System-Design Questions (5)

### B1. A teammate proposes using a Fibonacci heap for the shortest-path service. How do you respond?

Ask three questions. First: what is the graph size and density? If it is sparse (most real graphs), Fibonacci wins nothing asymptotically. Second: did they benchmark against a binary or 4-ary heap on representative data? If not, that is the next step. Third: what is the per-operation latency requirement? Fibonacci has bad worst case. If the answers do not justify the complexity, push back politely and propose a benchmark.

### B2. You inherit a system that uses a Fibonacci heap and it is slow. How do you investigate?

Profile first. Likely culprits: cache misses from pointer chasing, mark/unmark bookkeeping under heavy `decrease-key`, and degree-array scans during consolidate. Compare against a baseline binary heap implementation on the same workload — if binary heap wins, the Fibonacci heap was the wrong tool. If Fibonacci heap is genuinely justified, look for implementation bugs first (wrong cascade, missing mark clears, root-list duplicates) before tuning.

### B3. Walk a non-technical product manager through the trade-off.

"There is a textbook data structure with great theoretical properties for shortest paths. It promises that some updates are basically free. The catch is that 'free' in theory means lots of pointer hops in practice, and modern CPUs hate pointer hops. So even though it looks faster on paper, simpler approaches are usually faster on real hardware. Until our problem grows by 100x and changes shape, we should stick with the simple approach."

### B4. Design a graph-routing service that does need to scale. Where would Fibonacci heap fit?

It probably would not. The scaling story for routing services is dominated by graph preprocessing (Contraction Hierarchies, Hub Labels, A* with landmarks), not heap choice. Once preprocessing is in place, the inner loop is tight enough that a simple binary or 4-ary heap is faster than any Fibonacci variant. The right architecture would be: preprocessed graph index, sharded across servers, with a small in-memory binary heap per query. Fibonacci heap does not appear in this design.

### B5. How do you decide when "interesting algorithmic theory" should ship?

Three criteria. (1) Does it solve a real bottleneck shown by profiling? (2) Does a benchmark on production-shaped data show a meaningful win over the simple baseline? (3) Is the implementation complexity worth the operational cost (debugging, on-call, training new hires)? Fibonacci heap fails all three for almost every production workload, which is why a senior engineer's job is often *resisting* clever theoretical structures in favor of simple ones that benchmark better.

---

## Coding Challenges (2 challenges)

> Coding interviews for Fibonacci heaps are rare. These two are illustrative — the first is conceptual (use the heap to solve a real problem), the second is structural (prove the structure works).

### Challenge 1 — Dijkstra with Fibonacci Heap vs Lazy Binary Heap, Benchmarked

**Problem.** Implement single-source shortest paths on a directed weighted graph with non-negative edge weights. Provide two implementations: one using a Fibonacci heap with `decrease-key`, one using a lazy binary heap (insert duplicates, skip stale entries on pop). Run both on a sparse random graph (`V = 50_000, E = 200_000`, weights uniform `[1, 100]`) and report wall time for each. Conclude which wins and why.

**Discussion before the code.** On a sparse graph the asymptotic gap between Fibonacci and lazy binary heap is small: Fibonacci is `O(E + V log V)`, lazy binary is `O((V + E) log V)`. With `E = 4V` and `V = 50_000`, both are about a million log-V operations. The binary heap has contiguous memory and ~5x smaller per-operation constant. In every published comparison I have seen, the lazy binary heap wins on this size of graph — by a factor of 3 to 10x in wall time. The honest expected result of running this code: the binary heap wins. The educational point of the exercise is *demonstrating* that the theoretical advantage does not materialize on real hardware, not "proving Fibonacci wins."

#### Go solution

```go
package main

import (
	"container/heap"
	"fmt"
	"math"
	"math/rand"
	"time"
)

type Edge struct {
	to     int
	weight int
}

// ------- lazy binary heap -------

type item struct {
	node int
	dist int
}
type pq []item

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(item)) }
func (p *pq) Pop() interface{} {
	old := *p
	n := len(old)
	x := old[n-1]
	*p = old[:n-1]
	return x
}

func dijkstraBinary(n int, adj [][]Edge, src int) []int {
	dist := make([]int, n)
	for i := range dist {
		dist[i] = math.MaxInt32
	}
	dist[src] = 0
	q := &pq{}
	heap.Push(q, item{src, 0})
	for q.Len() > 0 {
		it := heap.Pop(q).(item)
		if it.dist > dist[it.node] {
			continue
		}
		for _, e := range adj[it.node] {
			nd := it.dist + e.weight
			if nd < dist[e.to] {
				dist[e.to] = nd
				heap.Push(q, item{e.to, nd})
			}
		}
	}
	return dist
}

// ------- Fibonacci heap -------

type fibNode struct {
	key                       int
	value                     int
	degree                    int
	mark                      bool
	parent, child             *fibNode
	left, right               *fibNode
}

type fibHeap struct {
	min *fibNode
	n   int
}

func (h *fibHeap) insert(key, value int) *fibNode {
	x := &fibNode{key: key, value: value}
	x.left, x.right = x, x
	h.mergeRoot(x)
	h.n++
	return x
}

func (h *fibHeap) mergeRoot(x *fibNode) {
	if h.min == nil {
		h.min = x
		return
	}
	x.left = h.min
	x.right = h.min.right
	h.min.right.left = x
	h.min.right = x
	if x.key < h.min.key {
		h.min = x
	}
}

func (h *fibHeap) extractMin() *fibNode {
	z := h.min
	if z == nil {
		return nil
	}
	if z.child != nil {
		c := z.child
		for {
			next := c.right
			c.left, c.right = c, c
			c.parent = nil
			h.mergeRoot(c)
			if next == z.child {
				break
			}
			c = next
		}
	}
	z.left.right = z.right
	z.right.left = z.left
	if z == z.right {
		h.min = nil
	} else {
		h.min = z.right
		h.consolidate()
	}
	h.n--
	return z
}

func (h *fibHeap) consolidate() {
	A := make([]*fibNode, 64)
	roots := []*fibNode{}
	x := h.min
	for {
		roots = append(roots, x)
		x = x.right
		if x == h.min {
			break
		}
	}
	for _, w := range roots {
		x := w
		d := x.degree
		for A[d] != nil {
			y := A[d]
			if x.key > y.key {
				x, y = y, x
			}
			h.link(y, x)
			A[d] = nil
			d++
		}
		A[d] = x
	}
	h.min = nil
	for _, a := range A {
		if a != nil {
			a.left, a.right = a, a
			h.mergeRoot(a)
		}
	}
}

func (h *fibHeap) link(y, x *fibNode) {
	y.left.right = y.right
	y.right.left = y.left
	y.parent = x
	if x.child == nil {
		x.child = y
		y.left, y.right = y, y
	} else {
		y.left = x.child
		y.right = x.child.right
		x.child.right.left = y
		x.child.right = y
	}
	x.degree++
	y.mark = false
}

func (h *fibHeap) decreaseKey(x *fibNode, k int) {
	if k > x.key {
		return
	}
	x.key = k
	y := x.parent
	if y != nil && x.key < y.key {
		h.cut(x, y)
		h.cascadingCut(y)
	}
	if x.key < h.min.key {
		h.min = x
	}
}

func (h *fibHeap) cut(x, y *fibNode) {
	if x.right == x {
		y.child = nil
	} else {
		x.left.right = x.right
		x.right.left = x.left
		if y.child == x {
			y.child = x.right
		}
	}
	y.degree--
	x.left, x.right = x, x
	x.parent = nil
	x.mark = false
	h.mergeRoot(x)
}

func (h *fibHeap) cascadingCut(y *fibNode) {
	if z := y.parent; z != nil {
		if !y.mark {
			y.mark = true
		} else {
			h.cut(y, z)
			h.cascadingCut(z)
		}
	}
}

func dijkstraFib(n int, adj [][]Edge, src int) []int {
	dist := make([]int, n)
	handles := make([]*fibNode, n)
	for i := range dist {
		dist[i] = math.MaxInt32
	}
	dist[src] = 0
	h := &fibHeap{}
	handles[src] = h.insert(0, src)
	for h.min != nil {
		z := h.extractMin()
		u := z.value
		for _, e := range adj[u] {
			nd := dist[u] + e.weight
			if nd < dist[e.to] {
				dist[e.to] = nd
				if handles[e.to] == nil {
					handles[e.to] = h.insert(nd, e.to)
				} else {
					h.decreaseKey(handles[e.to], nd)
				}
			}
		}
	}
	return dist
}

func main() {
	rand.Seed(1)
	V := 50_000
	E := 200_000
	adj := make([][]Edge, V)
	for i := 0; i < E; i++ {
		u := rand.Intn(V)
		v := rand.Intn(V)
		w := rand.Intn(100) + 1
		adj[u] = append(adj[u], Edge{v, w})
	}
	t0 := time.Now()
	d1 := dijkstraBinary(V, adj, 0)
	tBinary := time.Since(t0)
	t0 = time.Now()
	d2 := dijkstraFib(V, adj, 0)
	tFib := time.Since(t0)
	mismatches := 0
	for i := range d1 {
		if d1[i] != d2[i] {
			mismatches++
		}
	}
	fmt.Printf("binary: %v   fib: %v   mismatches: %d\n", tBinary, tFib, mismatches)
}
```

#### Java solution (sketch — same shape, omitted for brevity in this challenge)

```java
// See challenge 2 for a full Java Fibonacci heap.
// To benchmark Dijkstra: build adjacency lists, run both PriorityQueue-based
// and Fibonacci-heap-based Dijkstra, compare System.nanoTime() deltas.
// Expected result: PriorityQueue wins on a sparse graph by a wide margin.
```

#### Python solution

```python
import heapq, random, time, math

def dijkstra_binary(n, adj, src):
    dist = [math.inf] * n
    dist[src] = 0
    pq = [(0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist

class FibNode:
    __slots__ = ("key", "value", "degree", "mark", "parent", "child", "left", "right")
    def __init__(self, key, value):
        self.key = key
        self.value = value
        self.degree = 0
        self.mark = False
        self.parent = None
        self.child = None
        self.left = self
        self.right = self

class FibHeap:
    def __init__(self):
        self.min = None
        self.n = 0

    def insert(self, key, value):
        x = FibNode(key, value)
        self._merge_root(x)
        self.n += 1
        return x

    def _merge_root(self, x):
        if self.min is None:
            self.min = x
            return
        x.left = self.min
        x.right = self.min.right
        self.min.right.left = x
        self.min.right = x
        if x.key < self.min.key:
            self.min = x

    def extract_min(self):
        z = self.min
        if z is None:
            return None
        if z.child:
            c = z.child
            children = []
            while True:
                children.append(c)
                c = c.right
                if c is z.child:
                    break
            for c in children:
                c.left = c.right = c
                c.parent = None
                self._merge_root(c)
        z.left.right = z.right
        z.right.left = z.left
        if z is z.right:
            self.min = None
        else:
            self.min = z.right
            self._consolidate()
        self.n -= 1
        return z

    def _consolidate(self):
        A = [None] * 64
        roots = []
        x = self.min
        while True:
            roots.append(x)
            x = x.right
            if x is self.min:
                break
        for w in roots:
            x = w
            d = x.degree
            while A[d] is not None:
                y = A[d]
                if x.key > y.key:
                    x, y = y, x
                self._link(y, x)
                A[d] = None
                d += 1
            A[d] = x
        self.min = None
        for a in A:
            if a is not None:
                a.left = a.right = a
                self._merge_root(a)

    def _link(self, y, x):
        y.left.right = y.right
        y.right.left = y.left
        y.parent = x
        if x.child is None:
            x.child = y
            y.left = y.right = y
        else:
            y.left = x.child
            y.right = x.child.right
            x.child.right.left = y
            x.child.right = y
        x.degree += 1
        y.mark = False

    def decrease_key(self, x, k):
        if k > x.key:
            return
        x.key = k
        y = x.parent
        if y is not None and x.key < y.key:
            self._cut(x, y)
            self._cascading_cut(y)
        if x.key < self.min.key:
            self.min = x

    def _cut(self, x, y):
        if x.right is x:
            y.child = None
        else:
            x.left.right = x.right
            x.right.left = x.left
            if y.child is x:
                y.child = x.right
        y.degree -= 1
        x.left = x.right = x
        x.parent = None
        x.mark = False
        self._merge_root(x)

    def _cascading_cut(self, y):
        z = y.parent
        if z is not None:
            if not y.mark:
                y.mark = True
            else:
                self._cut(y, z)
                self._cascading_cut(z)

def dijkstra_fib(n, adj, src):
    dist = [math.inf] * n
    handles = [None] * n
    dist[src] = 0
    h = FibHeap()
    handles[src] = h.insert(0, src)
    while h.min is not None:
        z = h.extract_min()
        u = z.value
        for v, w in adj[u]:
            nd = dist[u] + w
            if nd < dist[v]:
                dist[v] = nd
                if handles[v] is None:
                    handles[v] = h.insert(nd, v)
                else:
                    h.decrease_key(handles[v], nd)
    return dist

if __name__ == "__main__":
    random.seed(1)
    V, E = 50_000, 200_000
    adj = [[] for _ in range(V)]
    for _ in range(E):
        u, v = random.randrange(V), random.randrange(V)
        w = random.randint(1, 100)
        adj[u].append((v, w))
    t0 = time.perf_counter()
    d1 = dijkstra_binary(V, adj, 0)
    t_bin = time.perf_counter() - t0
    t0 = time.perf_counter()
    d2 = dijkstra_fib(V, adj, 0)
    t_fib = time.perf_counter() - t0
    print(f"binary: {t_bin:.3f}s   fib: {t_fib:.3f}s")
```

**Why the binary heap wins.** Pointer chasing in the Fibonacci heap blows the cache; the binary heap stays in contiguous memory. Constants on every operation are larger for Fibonacci (4-5 pointer updates per cut, recursive cascade, consolidate over 64 slots). The asymptotic gain `O(E + V log V)` vs `O((V + E) log V)` is invisible until `E` is a substantial fraction of `V^2`. On a random sparse graph the binary version is typically 3-10x faster in wall time. This is the lesson, not the punchline.

---

### Challenge 2 — `decrease-key` with Cascading Cuts and the Potential Invariant

**Problem.** Implement a Fibonacci heap supporting `insert`, `extract-min`, and `decrease-key`. After every operation, verify the potential `Phi = t + 2m` (number of root-list trees plus twice the number of marked non-root nodes) and assert that the amortized cost bookkeeping holds: the actual work done plus the change in potential should be within a small constant for `insert` and `decrease-key`, and O(log n) for `extract-min`. Run a small randomized workload and print the running tally.

**What this exercise teaches.** The point is to *see* the potential function move. Each `insert` pushes potential up by 1. Each cascading cut pushes potential down (by `2m - c` where `c` is the cascade length). Each `extract-min` collapses many trees, dropping `t` sharply. Watching the tally makes the proof tangible.

#### Go solution

```go
package main

import (
	"fmt"
	"math/rand"
)

// Reuse the fibHeap type from Challenge 1 above.
// (omitted for brevity; assume the same type and methods are in scope.)

func countMarked(h *fibHeap) int {
	if h.min == nil {
		return 0
	}
	count := 0
	var walk func(x *fibNode, inRoot bool)
	walk = func(x *fibNode, inRoot bool) {
		if x == nil {
			return
		}
		start := x
		for {
			if !inRoot && x.mark {
				count++
			}
			if x.child != nil {
				walk(x.child, false)
			}
			x = x.right
			if x == start {
				break
			}
		}
	}
	walk(h.min, true)
	return count
}

func countRoots(h *fibHeap) int {
	if h.min == nil {
		return 0
	}
	c, x := 0, h.min
	for {
		c++
		x = x.right
		if x == h.min {
			break
		}
	}
	return c
}

func potential(h *fibHeap) int {
	return countRoots(h) + 2*countMarked(h)
}

func main() {
	rand.Seed(42)
	h := &fibHeap{}
	handles := []*fibNode{}
	prevPhi, work := 0, 0
	for step := 0; step < 200; step++ {
		op := rand.Intn(3)
		switch {
		case op == 0 || len(handles) < 5:
			n := h.insert(rand.Intn(10_000), step)
			handles = append(handles, n)
			work = 1
		case op == 1 && len(handles) > 1:
			i := rand.Intn(len(handles))
			h.decreaseKey(handles[i], handles[i].key-rand.Intn(50)-1)
			work = 1
		default:
			z := h.extractMin()
			if z != nil {
				for i, n := range handles {
					if n == z {
						handles = append(handles[:i], handles[i+1:]...)
						break
					}
				}
			}
			work = 32 // upper bound stand-in for log n consolidate work
		}
		phi := potential(h)
		amortized := work + (phi - prevPhi)
		fmt.Printf("step=%3d op=%d t=%d m=%d Phi=%d amortized=%d\n",
			step, op, countRoots(h), countMarked(h), phi, amortized)
		prevPhi = phi
	}
}
```

#### Java solution

```java
import java.util.*;

public class FibHeapInvariant {

    static class Node {
        int key, value, degree;
        boolean mark;
        Node parent, child, left, right;
        Node(int k, int v) { key = k; value = v; left = right = this; }
    }

    Node min;
    int n;

    Node insert(int key, int value) {
        Node x = new Node(key, value);
        mergeRoot(x);
        n++;
        return x;
    }

    void mergeRoot(Node x) {
        if (min == null) { min = x; return; }
        x.left = min;
        x.right = min.right;
        min.right.left = x;
        min.right = x;
        if (x.key < min.key) min = x;
    }

    Node extractMin() {
        Node z = min;
        if (z == null) return null;
        if (z.child != null) {
            Node c = z.child;
            List<Node> kids = new ArrayList<>();
            do { kids.add(c); c = c.right; } while (c != z.child);
            for (Node k : kids) {
                k.left = k.right = k;
                k.parent = null;
                mergeRoot(k);
            }
        }
        z.left.right = z.right;
        z.right.left = z.left;
        if (z == z.right) min = null;
        else { min = z.right; consolidate(); }
        n--;
        return z;
    }

    void consolidate() {
        Node[] A = new Node[64];
        List<Node> roots = new ArrayList<>();
        Node x = min;
        do { roots.add(x); x = x.right; } while (x != min);
        for (Node w : roots) {
            Node y = w;
            int d = y.degree;
            while (A[d] != null) {
                Node z = A[d];
                if (y.key > z.key) { Node t = y; y = z; z = t; }
                link(z, y);
                A[d] = null;
                d++;
            }
            A[d] = y;
        }
        min = null;
        for (Node a : A) if (a != null) {
            a.left = a.right = a;
            mergeRoot(a);
        }
    }

    void link(Node y, Node x) {
        y.left.right = y.right;
        y.right.left = y.left;
        y.parent = x;
        if (x.child == null) { x.child = y; y.left = y.right = y; }
        else {
            y.left = x.child;
            y.right = x.child.right;
            x.child.right.left = y;
            x.child.right = y;
        }
        x.degree++;
        y.mark = false;
    }

    void decreaseKey(Node x, int k) {
        if (k > x.key) return;
        x.key = k;
        Node y = x.parent;
        if (y != null && x.key < y.key) { cut(x, y); cascadingCut(y); }
        if (x.key < min.key) min = x;
    }

    void cut(Node x, Node y) {
        if (x.right == x) y.child = null;
        else {
            x.left.right = x.right;
            x.right.left = x.left;
            if (y.child == x) y.child = x.right;
        }
        y.degree--;
        x.left = x.right = x;
        x.parent = null;
        x.mark = false;
        mergeRoot(x);
    }

    void cascadingCut(Node y) {
        Node z = y.parent;
        if (z != null) {
            if (!y.mark) y.mark = true;
            else { cut(y, z); cascadingCut(z); }
        }
    }

    int countRoots() {
        if (min == null) return 0;
        int c = 0; Node x = min;
        do { c++; x = x.right; } while (x != min);
        return c;
    }

    int countMarked() {
        if (min == null) return 0;
        int[] count = {0};
        countMarkedRec(min, true, count);
        return count[0];
    }

    void countMarkedRec(Node start, boolean isRoot, int[] count) {
        Node x = start;
        do {
            if (!isRoot && x.mark) count[0]++;
            if (x.child != null) countMarkedRec(x.child, false, count);
            x = x.right;
        } while (x != start);
    }

    int potential() { return countRoots() + 2 * countMarked(); }

    public static void main(String[] args) {
        FibHeapInvariant h = new FibHeapInvariant();
        Random r = new Random(42);
        List<Node> handles = new ArrayList<>();
        int prevPhi = 0;
        for (int step = 0; step < 200; step++) {
            int op = r.nextInt(3);
            int work;
            if (op == 0 || handles.size() < 5) {
                handles.add(h.insert(r.nextInt(10000), step));
                work = 1;
            } else if (op == 1 && handles.size() > 1) {
                Node x = handles.get(r.nextInt(handles.size()));
                h.decreaseKey(x, x.key - r.nextInt(50) - 1);
                work = 1;
            } else {
                Node z = h.extractMin();
                if (z != null) handles.remove(z);
                work = 32;
            }
            int phi = h.potential();
            int amortized = work + (phi - prevPhi);
            System.out.printf("step=%3d op=%d t=%d m=%d Phi=%d amortized=%d%n",
                    step, op, h.countRoots(), h.countMarked(), phi, amortized);
            prevPhi = phi;
        }
    }
}
```

#### Python solution

```python
# Reuse the FibHeap / FibNode classes from Challenge 1.
import random

def count_roots(h):
    if h.min is None:
        return 0
    c, x = 0, h.min
    while True:
        c += 1
        x = x.right
        if x is h.min:
            break
    return c

def count_marked(h):
    if h.min is None:
        return 0
    count = [0]
    def walk(start, in_root):
        x = start
        while True:
            if not in_root and x.mark:
                count[0] += 1
            if x.child is not None:
                walk(x.child, False)
            x = x.right
            if x is start:
                break
    walk(h.min, True)
    return count[0]

def potential(h):
    return count_roots(h) + 2 * count_marked(h)

if __name__ == "__main__":
    random.seed(42)
    h = FibHeap()
    handles = []
    prev_phi = 0
    for step in range(200):
        op = random.randint(0, 2)
        if op == 0 or len(handles) < 5:
            handles.append(h.insert(random.randint(0, 10_000), step))
            work = 1
        elif op == 1 and len(handles) > 1:
            x = random.choice(handles)
            h.decrease_key(x, x.key - random.randint(1, 50))
            work = 1
        else:
            z = h.extract_min()
            if z is not None and z in handles:
                handles.remove(z)
            work = 32
        phi = potential(h)
        amortized = work + (phi - prev_phi)
        print(f"step={step:3d} op={op} t={count_roots(h)} m={count_marked(h)} "
              f"Phi={phi} amortized={amortized}")
        prev_phi = phi
```

```text
sample output (Python, truncated):
step=  0 op=0 t=1 m=0 Phi=1 amortized=2
step=  1 op=0 t=2 m=0 Phi=2 amortized=2
step=  2 op=0 t=3 m=0 Phi=3 amortized=2
...
step= 17 op=2 t=2 m=0 Phi=2 amortized=18    <-- extract-min collapses many trees
step= 18 op=1 t=3 m=0 Phi=3 amortized=2
step= 19 op=1 t=3 m=1 Phi=5 amortized=3     <-- a node became marked
step= 20 op=1 t=4 m=0 Phi=4 amortized=0     <-- cascading cut, mark cleared
```

**Reading the tally.** `amortized = work + (Phi_after - Phi_before)`. Inserts come out near 2 (constant). Decrease-keys hover around 0-3 (constant on average; sometimes negative when a cascade unmarks). Extract-mins are larger but bounded by `O(log n)`. Watching the column makes it clear that the potential function is real-paying-for-work, not just notation.

---

## Common Pitfalls in Interviews

- Quoting the wrong complexity. `decrease-key` is O(1) *amortized*, O(log n) *worst case*. Be precise.
- Forgetting that the worst case of `extract-min` is O(n), not O(log n).
- Confusing Fibonacci heap with binomial heap. Binomial heaps have O(log n) `insert` and cannot do O(1) `decrease-key`.
- Believing the asymptotic win translates to wall-time. It almost never does on real graphs.
- Trying to implement one in 45 minutes. Don't. You will run out of time. Explain the structure and the key proofs instead.
- Forgetting that the `mark` mechanism is what enforces the Fibonacci subtree-size lemma. Without it, the bound on max degree falls.
- Mishandling the circular root list during cut and merge. Off-by-one pointer bugs are the most common implementation error.
- Saying "Fibonacci heaps are used in Dijkstra." Be honest: they could be, but production Dijkstra uses binary or 4-ary heaps.

---

## What Interviewers Are Really Testing

- **Amortized analysis.** Can you state the potential method, identify the credit invariant, and reason about why the bookkeeping balances? This is the core skill the topic teaches.
- **Theory vs practice judgment.** Can you discuss why an asymptotically faster structure can lose in wall time? This is the senior-engineer skill.
- **Structural reasoning.** Can you explain why the cascading-cut rule produces Fibonacci-bounded subtree sizes? This tests algorithmic maturity, not memorization.
- **Honesty about trade-offs.** Can you say "in production I would use a binary heap" without flinching? Interviewers reward this.
- **Communication.** Can you describe `decrease-key` and cascading cuts clearly enough that a teammate can implement them from your description? This is what senior interviews care about.
- **Resistance to over-engineering.** When given a system-design problem, do you reach for theoretically optimal structures or for pragmatic ones? The right answer is almost always pragmatic.

The Fibonacci heap is interview material because it is a *concentrated case study* in these skills, not because anyone expects you to ship one.
