# Pairing Heap — Interview Preparation

This guide prepares you for interview discussions about pairing heaps — a self-adjusting heap structure that is simpler than Fibonacci heaps but often faster in practice. Expect questions on amortized analysis, comparison with binary and Fibonacci heaps, and the two-pass merge.

---

## Quick-Reference Cheat Sheet

```text
Pairing Heap — One-Page Summary
================================

Type:        Self-adjusting, multi-way heap-ordered tree
Invariant:   parent.key <= child.key (min-heap)
Structure:   Single root with arbitrary number of children
Storage:     left-child / right-sibling pointer pairs

Operations (n = number of nodes):
  find-min       O(1)       worst-case
  insert         O(1)       worst-case
  meld (union)   O(1)       worst-case
  delete-min     O(log n)   amortized (two-pass)
  decrease-key   o(log n)   amortized — exact bound open problem
  delete         O(log n)   amortized

Known bounds:
  decrease-key   O(log log n) lower bound (Fredman 1999)
                 O(log n) trivial upper bound
                 Best proven:   O(2^(2*sqrt(log log n)))
  delete-min     exactly Θ(log n) amortized

Key idea:
  Lazy structure — do almost nothing on insert/meld,
  pay all the cost during delete-min via two-pass merge.

Two-pass merge (delete-min):
  Pass 1 (left-to-right): pair adjacent siblings, meld each pair
  Pass 2 (right-to-left): meld results back-to-front into one tree

When to use:
  - Dijkstra / Prim where decrease-key is hot
  - When you want Fibonacci-heap-like amortized cost
    without Fibonacci's constant-factor overhead
  - Practical implementation of priority queues in graph algorithms
```

---

## Junior Questions (10 Q&A)

### J1. What is a pairing heap?

A pairing heap is a heap-ordered multi-way tree where the root holds the minimum element and every node may have an arbitrary number of children. It is "self-adjusting" — there are no balance invariants like in AVL or red-black trees. The structure pays for its simplicity by amortizing work across operations: insert and meld are constant-time, while delete-min restructures the tree using a two-pass pairing merge. It is named after this pairing step.

### J2. How is heap-order maintained?

Every node's key is less than or equal to the keys of all its children (for a min-heap). The order is preserved by the meld operation: when two heaps are merged, the root with the smaller key becomes the new root, and the other heap's root becomes its leftmost child. Insertion is implemented as a meld of the existing heap with a one-node heap, so heap order is preserved trivially.

### J3. What is the meld (union) operation?

Meld combines two pairing heaps into one in O(1) worst-case time. Given two roots `a` and `b`, compare their keys: the smaller becomes the new root, and the larger is added as the new leftmost child of the smaller. No further work is done — the tree may be wide and shallow, or tall and thin, depending on history. All operations except delete-min reduce to meld.

### J4. How does insert work?

Insertion creates a single-node heap and melds it with the existing heap. Because meld is O(1), insertion is also O(1) worst-case. There is no rebalancing — the new node simply becomes a child of the root (or the root itself if it has a smaller key). This is why pairing heaps are fast in practice for insert-heavy workloads.

### J5. How does find-min work?

Find-min returns the root in O(1) time. The heap-order invariant guarantees that the root holds the minimum element. There is no traversal needed.

### J6. How does delete-min work in high-level terms?

Delete-min removes the root and is left with a list of orphan subtrees (the root's former children). It must combine these orphans back into a single heap. The standard algorithm is the "two-pass merge": pair adjacent orphans left-to-right and meld each pair, then meld the resulting list right-to-left into the final heap. This restructures the tree and is the only expensive operation.

### J7. What is decrease-key?

Decrease-key reduces a node's key and restores heap order. If the node is the root, it is updated in place. Otherwise, the node is detached from its parent (along with its subtree), its key is updated, and it is melded back with the root. Detachment requires sibling-pointer manipulation but is O(1) once you have the node reference.

### J8. What is the space complexity of a pairing heap?

A pairing heap uses O(n) space for n elements. Each node stores its key, a pointer to its leftmost child, and a pointer to its next sibling (and usually a back-pointer to its previous sibling or parent for decrease-key). This is more memory per node than a binary heap (which is an array), but less per-node overhead than a Fibonacci heap (which also tracks mark bits and degrees).

### J9. Is a pairing heap stable?

No. When two equal keys are present, the one that becomes the root is determined by the order of meld calls, not by insertion time. For a stable priority queue, augment each node with an insertion counter and use it as a tiebreaker in comparisons.

### J10. Why is it called "pairing"?

The name comes from the delete-min algorithm, which combines the orphan children in two passes — the first pass pairs them up (groups them in twos and melds each pair). This pairing step is the source of the amortized O(log n) bound and is the structural signature of the data structure.

---

## Middle Questions (12 Q&A)

### M1. Walk through the two-pass merge in detail.

After removing the root, you have a singly-linked list of orphan children: `c1 -> c2 -> c3 -> ... -> ck`. **Pass 1** (left-to-right): meld c1 with c2, c3 with c4, and so on, producing a list of `ceil(k/2)` melded pairs. **Pass 2** (right-to-left): take the last pair, meld it with the second-to-last, meld the result with the third-to-last, and continue until one tree remains. That tree's root is the new heap root. The two-pass structure is essential for the O(log n) amortized bound — a single left-to-right merge degenerates to O(n) per operation.

### M2. Why two passes and not one?

A single left-to-right multipass — folding all orphans into one accumulator — leads to a degenerate left-leaning tree and gives Ω(n) amortized cost per delete-min. The pairing step (pass 1) ensures that after the first sweep, the list has length at most ceil(k/2), and each subtree has bounded depth. Pass 2 then combines them in a balanced manner. Empirically, two-pass also beats variants like "multipass" (repeated pairing until one tree remains) on most workloads.

### M3. What is the amortized time of delete-min?

Delete-min is O(log n) amortized. The proof uses a potential function based on the number of nodes and the tree's structure (typically `Φ = sum over nodes of log(subtree_size)`). Each delete-min reduces potential proportionally to the work done. Insert and meld can only increase potential by O(1), so they remain amortized O(1).

### M4. How does decrease-key work?

Locate the node (the caller must hold a reference — the heap does not search). If it is the root, just update the key. Otherwise: detach the node from its parent (splice it out of its parent's child list), update the key, and meld the detached subtree with the root. The detachment requires either a parent pointer or a doubly-linked sibling list. After meld, the node becomes a child of the root or the new root, and heap order is restored locally.

### M5. What is the amortized cost of decrease-key in a pairing heap?

The exact amortized cost is an open problem. It is known to be Ω(log log n) (Fredman, 1999) and trivially O(log n). The tightest proven upper bound is O(2^(2*sqrt(log log n))), which is faster than O(log n) but slower than the O(1) that Fibonacci heaps achieve. In practice it behaves very close to O(1), which is why pairing heaps often outperform Fibonacci heaps despite the theoretical gap.

### M6. How is a pairing heap typically represented in memory?

Each node has three pointers: `child` (leftmost child), `sibling` (next sibling to the right), and `prev` (either previous sibling or parent if leftmost). The children of a node form a singly-linked list, threaded via `sibling`. The `prev` pointer makes detachment for decrease-key O(1). The root has no parent and no sibling. This layout avoids the storage cost of full parent pointers while still supporting decrease-key.

### M7. Compare pairing heap to binary heap.

Binary heap is array-based, O(log n) for insert and delete-min, O(1) find-min, but has no efficient decrease-key (O(n) to locate the node unless you keep a side index). Pairing heap is pointer-based, O(1) insert and meld, O(log n) amortized delete-min, and supports near-O(1) decrease-key when you have a node reference. Binary heap wins on cache locality and constant factors when decrease-key is not needed; pairing heap wins on graph algorithms.

### M8. Compare pairing heap to Fibonacci heap.

Both are designed for graph algorithms. Fibonacci heap achieves O(1) amortized decrease-key and O(log n) delete-min, beating pairing heap asymptotically. But Fibonacci heap has higher constant factors due to its mark bits, cascading cuts, and consolidation step. Pairing heap is simpler to implement and typically faster in practice for moderate inputs (millions of nodes). Most production graph libraries use pairing heaps or d-ary heaps instead of Fibonacci heaps.

### M9. Can you build a heap from n elements faster than n inserts?

Yes — meld each element pairwise in a binary-tournament fashion. This achieves O(n) build time, the same as binary-heap build-heap. A naive sequence of n inserts is also O(n) amortized because each insert is O(1). So build-from-array is not asymptotically faster, but pairwise melding produces a more balanced initial tree, reducing the cost of the first delete-min.

### M10. How does pairing heap handle duplicates?

Duplicates are allowed — the heap order is `<=`, not `<`. When two keys are equal, the meld operation picks one as parent arbitrarily (typically the first argument). If you need stable ordering, store an insertion counter alongside the key and compare lexicographically. Many real applications (e.g., Dijkstra with tie-breaking on node id) already need this.

### M11. What happens if you implement delete-min with a multipass merge?

Multipass merge repeatedly pairs adjacent children until one tree remains: pass 1 reduces k to ceil(k/2), pass 2 to ceil(k/4), and so on. It is also O(log n) amortized but typically slower than two-pass in practice due to more pointer rewrites. Two-pass uses exactly one pairing sweep plus one right-to-left meld, while multipass requires O(log k) sweeps. Empirical benchmarks consistently favor two-pass.

### M12. How would you implement an "increase-key" operation?

Increase-key is not directly supported in the standard pairing heap. The straightforward approach: delete the node (using delete = decrease-key to -infinity, then delete-min) and re-insert with the new key. Delete is O(log n) amortized. For applications that frequently increase keys (e.g., shortest-path with updates), a different structure like a binary heap with side-indexed positions or a quake heap may be preferable.

---

## Senior Questions (10 Q&A)

### S1. Outline the amortized analysis of two-pass delete-min.

Use the potential function `Φ = sum over each non-root node v of log(s(v))`, where `s(v)` is the size of the subtree rooted at v. Each pairing in pass 1 takes O(1) actual work and reduces the potential by at least log of something proportional to the subtree sizes involved. The right-to-left pass 2 similarly reduces potential. Summing over all pairings, the amortized cost is O(log n). The full proof (Iacono, 2000; Pettie, 2005) is involved; the intuition is that nodes with large subtrees contribute most of the potential and pay most of the work.

### S2. Why is decrease-key not provably O(1) in pairing heaps?

Fibonacci heaps achieve O(1) decrease-key by using mark bits and cascading cuts: when a node loses a second child, it cuts itself loose from its parent. This bounds the rank of any tree to O(log n). Pairing heaps do no such bookkeeping — after a cut, the detached subtree just gets melded back, and no rank invariant is maintained. The lack of structural constraints means the amortized argument cannot match Fibonacci's. Fredman (1999) showed Ω(log log n) is unavoidable for a wide class of self-adjusting heaps including pairing heaps.

### S3. When does Fibonacci heap actually beat pairing heap in practice?

Almost never in mainstream uses. Fibonacci heap's O(1) decrease-key only matters asymptotically when decrease-key dominates (e.g., dense-graph Dijkstra with billions of edges). Even then, constant factors and memory overhead (mark bits, parent pointers, doubly-linked sibling lists, degree tracking) usually make pairing heap faster up to very large inputs. Quake heaps and rank-pairing heaps offer better worst-case guarantees with smaller constants, and are sometimes used in research settings.

### S4. How would you make a pairing heap persistent (functional)?

Pairing heap is naturally amenable to a functional implementation because meld is O(1) and just creates a new node with shared subtrees. Insert is meld with a singleton — also functional-friendly. Delete-min is the expensive part: you must rebuild the spine of the affected subtrees. Okasaki's "Purely Functional Data Structures" gives a lazy pairing heap with O(log n) amortized delete-min. The trick is to delay the two-pass merge using lazy thunks, paying for it during forced evaluation.

### S5. Discuss the cache behavior of pairing heaps.

Pairing heaps are pointer-based and allocate nodes individually, so they suffer cache misses on every traversal. The two-pass merge walks a linked list of orphans, causing scattered memory access. Compared to binary heaps (contiguous array, excellent locality), pairing heaps lose significantly on small-to-medium inputs. Mitigations: pool-allocate nodes, use 16/32-byte-aligned structs, or prefetch sibling pointers. For massive heaps where decrease-key matters, the asymptotic advantage usually compensates.

### S6. How do you implement decrease-key safely from outside the heap?

The user must hold a stable handle (a pointer to the heap node) and the heap exposes a `decrease_key(handle, new_key)` method. Critical issue: the handle must remain valid across operations. Pairing heap supports this — meld and delete-min never relocate nodes, only adjust pointers. Contrast with binary heap, where insertions can swap nodes around and invalidate index-based handles unless the user maintains a position map.

### S7. How would you adapt a pairing heap for Dijkstra on a large graph?

Allocate one node per vertex up front, store the handle in a vertex->handle array. Initialize all distances to infinity, insert all vertices into the heap, then repeatedly extract-min and relax outgoing edges via decrease-key. Memory: roughly 4 pointers per vertex plus the key (typically a 64-bit distance and 32-bit id). For very sparse graphs, lazy Dijkstra with a binary heap and "stale entry" check is often simpler and competitive. For dense graphs, pairing heap usually wins.

### S8. What is the cascading-cut analogue in pairing heaps?

There is none — that's the design choice. Cascading cuts in Fibonacci heaps are what bound the rank of trees and enable O(1) decrease-key. Pairing heap deliberately skips them to stay simple, accepting a worse theoretical decrease-key bound. The "auxiliary two-pass pairing heap" variant introduces an auxiliary queue of recently-decreased nodes that get re-pairwise-melded during delete-min, achieving slightly better practical performance on decrease-key-heavy workloads.

### S9. Compare two-pass, multipass, and "front-to-back" merges.

Two-pass: pair left-to-right, meld right-to-left — O(log n) amortized, fast in practice. Multipass: repeatedly pair adjacent children — O(log n) amortized but slower than two-pass empirically. Front-to-back (linear single-pass meld accumulator): O(n) amortized — pathological, do not use. The two-pass merge is uniquely good because pass 1 balances subtree sizes and pass 2 builds a long path of right-spine ancestors that absorbs subsequent decrease-key cuts cheaply.

### S10. Are there variants with better theoretical bounds?

Yes. Smooth pairing heap (Iacono and Yagnatinsky, 2014) achieves O(log n) delete-min and O(log log n) decrease-key amortized — matching Fredman's lower bound. Rank-pairing heap (Haeupler, Sen, Tarjan, 2009) achieves O(1) decrease-key and O(log n) delete-min, like Fibonacci heap, but with simpler structure. Quake heap is another simple alternative with Fibonacci-heap-like bounds. None of these have replaced pairing heap in practice because the constant factors negate the asymptotic gain for typical input sizes.

---

## Professional Questions (6 Q&A)

### P1. How would you design a production-grade pairing heap library?

Provide a generic node type parameterized by key and value. Expose: `insert(key, value) -> handle`, `find_min() -> handle`, `delete_min() -> (key, value)`, `decrease_key(handle, new_key)`, `meld(other_heap)`, `size()`. Use intrusive nodes (caller embeds the heap node) for zero-allocation hot paths. Document handle invalidation rules: handles survive insert, meld, and decrease-key, but are invalidated by delete-min if they reference the removed node. Add an iterator (heap-walk traversal, not sorted) for debugging. Benchmark against `std::priority_queue` and report.

### P2. How do you parallelize pairing heap operations?

Pairing heap is inherently sequential — the root and pointers are shared mutable state. Coarse-grained parallelism uses one heap per thread plus a periodic meld step (cheap because meld is O(1)). Fine-grained: the two-pass merge can be parallelized — pass 1 pairs are independent and can be done in parallel, then pass 2 is a sequential reduction. This is rarely worthwhile unless the heap is enormous. Lock-free pairing heaps exist but are complex and rarely faster than a single-thread heap with batched updates.

### P3. Discuss memory management and ownership.

Each node is allocated independently in the basic implementation, leading to allocator pressure. Use a slab allocator or arena to amortize allocation cost. Deletion of a node returns its memory to the pool. For C++ or Rust, prefer intrusive nodes — the heap stores pointers to caller-owned nodes, and the caller manages lifetime. This avoids double-allocation when the value is large (e.g., a graph vertex). Be careful with handle lifetimes: a handle whose node has been popped via delete-min is dangling.

### P4. How do you test a pairing heap implementation?

Property-based testing: against a reference implementation (e.g., `std::set`), run random sequences of insert, delete-min, decrease-key, meld and assert results match. Stress tests: insert 10 million random elements, then extract-min, verify the output is sorted. Adversarial inputs: monotonic sequences (all decreasing), reverse-sorted, identical keys. Crash tests: decrease-key on a value larger than the current key (should be a no-op or error). Benchmark suite: compare against binary heap and Fibonacci heap on Dijkstra over standard graphs (DIMACS, Stanford SNAP).

### P5. How would you persist or serialize a pairing heap to disk?

Linearize the tree by emitting a preorder traversal: for each node, emit its key, value, number of children, then recursively emit each child. To reconstruct, parse the same traversal and rebuild the tree structure. This preserves heap order but loses any handle references the caller held. For a transactional or recoverable heap, log every operation (insert, delete-min, decrease-key) to a write-ahead log and replay on recovery. Snapshots can be taken periodically by linearization.

### P6. What instrumentation would you add for diagnosing performance issues?

Track per-operation latency histograms — delete-min latency is the most variable and worth monitoring. Count total comparisons per operation (a proxy for work). Track maximum tree depth (a degenerate heap signals a workload mismatch). For decrease-key, measure the depth at which the affected node sits before the cut (helps identify path-length blowups). Expose all of this via a debug-mode hook that calls a user callback on every operation. In production, sample at low rate to avoid overhead.

---

## Behavioral / System-Design Questions (5)

### B1. You replaced a binary heap with a pairing heap in a graph algorithm and performance got worse. What do you investigate?

First, confirm the workload actually benefits from decrease-key — for sparse graphs with few edge relaxations, binary heap with lazy "stale entry" semantics is often faster due to better cache behavior. Profile to confirm pairing heap is the bottleneck, not graph traversal. Check allocator pressure — each pairing-heap node may be malloced individually. Switch to slab allocation. Verify the two-pass merge is implemented correctly (a buggy single-pass merge gives O(n) per delete-min). Compare against d-ary heap (e.g., 4-ary) which often beats both.

### B2. How would you teach pairing heap to a new engineer?

Start with the heap-order invariant — the same as in binary heap. Then show meld: two heaps, pick the smaller root, the other becomes a child. Stress that insert and meld are both O(1) and that all the "work" is deferred to delete-min. Demonstrate the two-pass merge on a small example (8 orphans), drawing each pairing step. Finally, explain decrease-key as detach + meld. Avoid mentioning Fibonacci heaps in the first session — they confuse the simplicity of pairing heap.

### B3. You're designing a priority queue for a real-time scheduler. Is pairing heap a good fit?

Probably not as-is. Pairing heap has good amortized bounds but poor worst-case: a single delete-min can take O(n) time after many cheap operations have built up potential. Real-time systems need predictable worst-case latency, not amortized. Use a binary heap or a calendar queue instead. If you must use pairing heap, pre-amortize by periodically forcing delete-min cycles to flatten the structure, or switch to a worst-case heap like a leftist heap.

### B4. Your team is choosing between Fibonacci heap and pairing heap for production. How do you decide?

Run a benchmark on representative workloads — usually pairing heap wins by 1.5-3x due to lower constants. Consider implementation complexity: pairing heap is ~200 lines, Fibonacci heap is ~600 lines with subtle invariants (mark bits, consolidation). Maintainability favors pairing heap. If you need a formal worst-case bound for an SLA, neither is great (both are amortized); consider a deterministic heap like d-ary. If asymptotic decrease-key matters (e.g., research code on extreme inputs), Fibonacci or rank-pairing heap is correct.

### B5. Describe a real system where pairing heap is used in production.

LEDA (the Library of Efficient Data Structures and Algorithms) uses pairing heap as a default priority queue for graph algorithms. OpenJDK's `java.util.PriorityQueue` uses a binary heap, but Apache Lucene's scoring uses pairing-heap-like structures for top-K queries. Many academic graph libraries (Boost Graph Library, igraph) ship pairing heaps as the recommended Dijkstra priority queue. The choice is usually justified by benchmark wins over Fibonacci heaps on real graphs.

---

## Coding Challenges (2)

### Challenge 1: Implement a pairing heap from scratch and benchmark against binary heap on Dijkstra.

The pairing heap must support insert, find-min, delete-min, decrease-key, and meld with handles. The Dijkstra benchmark should report total time and total comparisons for a random sparse graph (V = 10000, E = 50000).

#### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"math/rand"
	"time"
)

// ===== Pairing Heap =====

type pNode struct {
	key       int
	value     int
	child     *pNode
	sibling   *pNode
	prev      *pNode // previous sibling or parent if leftmost
}

type PairingHeap struct {
	root *pNode
	size int
}

func (h *PairingHeap) Insert(key, value int) *pNode {
	n := &pNode{key: key, value: value}
	h.root = meld(h.root, n)
	h.size++
	return n
}

func (h *PairingHeap) FindMin() (int, int, bool) {
	if h.root == nil {
		return 0, 0, false
	}
	return h.root.key, h.root.value, true
}

func (h *PairingHeap) DeleteMin() (int, int, bool) {
	if h.root == nil {
		return 0, 0, false
	}
	k, v := h.root.key, h.root.value
	h.root = twoPassMerge(h.root.child)
	if h.root != nil {
		h.root.prev = nil
	}
	h.size--
	return k, v, true
}

func (h *PairingHeap) DecreaseKey(n *pNode, newKey int) {
	if newKey > n.key {
		return
	}
	n.key = newKey
	if n == h.root {
		return
	}
	// detach n
	if n.prev.child == n {
		n.prev.child = n.sibling
	} else {
		n.prev.sibling = n.sibling
	}
	if n.sibling != nil {
		n.sibling.prev = n.prev
	}
	n.sibling = nil
	n.prev = nil
	h.root = meld(h.root, n)
}

func meld(a, b *pNode) *pNode {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if a.key <= b.key {
		// b becomes leftmost child of a
		b.sibling = a.child
		if a.child != nil {
			a.child.prev = b
		}
		b.prev = a
		a.child = b
		return a
	}
	a.sibling = b.child
	if b.child != nil {
		b.child.prev = a
	}
	a.prev = b
	b.child = a
	return b
}

func twoPassMerge(first *pNode) *pNode {
	if first == nil || first.sibling == nil {
		if first != nil {
			first.prev = nil
		}
		return first
	}
	// Pass 1: pair adjacent siblings left-to-right
	var pairs []*pNode
	cur := first
	for cur != nil {
		a := cur
		b := cur.sibling
		var next *pNode
		if b != nil {
			next = b.sibling
		}
		a.sibling = nil
		a.prev = nil
		if b != nil {
			b.sibling = nil
			b.prev = nil
		}
		pairs = append(pairs, meld(a, b))
		cur = next
	}
	// Pass 2: meld right-to-left
	result := pairs[len(pairs)-1]
	for i := len(pairs) - 2; i >= 0; i-- {
		result = meld(result, pairs[i])
	}
	return result
}

// ===== Binary Heap (for benchmark) =====

type bItem struct {
	key, value, idx int
}

type binHeap []*bItem

func (h binHeap) Len() int            { return len(h) }
func (h binHeap) Less(i, j int) bool  { return h[i].key < h[j].key }
func (h binHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i]; h[i].idx = i; h[j].idx = j }
func (h *binHeap) Push(x interface{}) { it := x.(*bItem); it.idx = len(*h); *h = append(*h, it) }
func (h *binHeap) Pop() interface{}   { old := *h; n := len(old); x := old[n-1]; *h = old[:n-1]; return x }

// ===== Dijkstra with pairing heap =====

type edge struct{ to, w int }

func dijkstraPairing(graph [][]edge, src int) []int {
	n := len(graph)
	dist := make([]int, n)
	handles := make([]*pNode, n)
	const INF = 1 << 30
	h := &PairingHeap{}
	for i := 0; i < n; i++ {
		dist[i] = INF
	}
	dist[src] = 0
	handles[src] = h.Insert(0, src)
	for h.size > 0 {
		_, u, _ := h.DeleteMin()
		for _, e := range graph[u] {
			nd := dist[u] + e.w
			if nd < dist[e.to] {
				dist[e.to] = nd
				if handles[e.to] == nil {
					handles[e.to] = h.Insert(nd, e.to)
				} else {
					h.DecreaseKey(handles[e.to], nd)
				}
			}
		}
	}
	return dist
}

func dijkstraBinary(graph [][]edge, src int) []int {
	n := len(graph)
	dist := make([]int, n)
	const INF = 1 << 30
	for i := 0; i < n; i++ {
		dist[i] = INF
	}
	dist[src] = 0
	pq := &binHeap{}
	heap.Push(pq, &bItem{key: 0, value: src})
	for pq.Len() > 0 {
		it := heap.Pop(pq).(*bItem)
		if it.key > dist[it.value] {
			continue
		}
		for _, e := range graph[it.value] {
			nd := dist[it.value] + e.w
			if nd < dist[e.to] {
				dist[e.to] = nd
				heap.Push(pq, &bItem{key: nd, value: e.to})
			}
		}
	}
	return dist
}

func main() {
	rand.Seed(42)
	V, E := 10000, 50000
	graph := make([][]edge, V)
	for i := 0; i < E; i++ {
		u, v, w := rand.Intn(V), rand.Intn(V), rand.Intn(100)+1
		graph[u] = append(graph[u], edge{v, w})
		graph[v] = append(graph[v], edge{u, w})
	}

	t0 := time.Now()
	d1 := dijkstraPairing(graph, 0)
	t1 := time.Since(t0)

	t0 = time.Now()
	d2 := dijkstraBinary(graph, 0)
	t2 := time.Since(t0)

	mismatch := 0
	for i := 0; i < V; i++ {
		if d1[i] != d2[i] {
			mismatch++
		}
	}
	fmt.Printf("Pairing: %v\nBinary:  %v\nMismatches: %d\n", t1, t2, mismatch)
}
```

#### Java

```java
import java.util.*;

public class PairingHeapBenchmark {
    static class PNode {
        int key, value;
        PNode child, sibling, prev;
        PNode(int k, int v) { key = k; value = v; }
    }

    static class PairingHeap {
        PNode root;
        int size;

        PNode insert(int key, int value) {
            PNode n = new PNode(key, value);
            root = meld(root, n);
            size++;
            return n;
        }

        int[] deleteMin() {
            int[] r = {root.key, root.value};
            root = twoPass(root.child);
            if (root != null) root.prev = null;
            size--;
            return r;
        }

        void decreaseKey(PNode n, int newKey) {
            if (newKey > n.key) return;
            n.key = newKey;
            if (n == root) return;
            if (n.prev.child == n) n.prev.child = n.sibling;
            else n.prev.sibling = n.sibling;
            if (n.sibling != null) n.sibling.prev = n.prev;
            n.sibling = null; n.prev = null;
            root = meld(root, n);
        }

        PNode meld(PNode a, PNode b) {
            if (a == null) return b;
            if (b == null) return a;
            if (a.key <= b.key) {
                b.sibling = a.child;
                if (a.child != null) a.child.prev = b;
                b.prev = a;
                a.child = b;
                return a;
            }
            a.sibling = b.child;
            if (b.child != null) b.child.prev = a;
            a.prev = b;
            b.child = a;
            return b;
        }

        PNode twoPass(PNode first) {
            if (first == null || first.sibling == null) {
                if (first != null) first.prev = null;
                return first;
            }
            List<PNode> pairs = new ArrayList<>();
            PNode cur = first;
            while (cur != null) {
                PNode a = cur, b = cur.sibling, next = (b != null) ? b.sibling : null;
                a.sibling = null; a.prev = null;
                if (b != null) { b.sibling = null; b.prev = null; }
                pairs.add(meld(a, b));
                cur = next;
            }
            PNode result = pairs.get(pairs.size() - 1);
            for (int i = pairs.size() - 2; i >= 0; i--) result = meld(result, pairs.get(i));
            return result;
        }
    }

    static int[] dijkstraPairing(List<int[]>[] g, int src) {
        int n = g.length, INF = Integer.MAX_VALUE / 2;
        int[] dist = new int[n];
        PNode[] handle = new PNode[n];
        Arrays.fill(dist, INF);
        dist[src] = 0;
        PairingHeap h = new PairingHeap();
        handle[src] = h.insert(0, src);
        while (h.size > 0) {
            int u = h.deleteMin()[1];
            for (int[] e : g[u]) {
                int nd = dist[u] + e[1];
                if (nd < dist[e[0]]) {
                    dist[e[0]] = nd;
                    if (handle[e[0]] == null) handle[e[0]] = h.insert(nd, e[0]);
                    else h.decreaseKey(handle[e[0]], nd);
                }
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        int V = 10000, E = 50000;
        Random rng = new Random(42);
        List<int[]>[] g = new List[V];
        for (int i = 0; i < V; i++) g[i] = new ArrayList<>();
        for (int i = 0; i < E; i++) {
            int u = rng.nextInt(V), v = rng.nextInt(V), w = rng.nextInt(100) + 1;
            g[u].add(new int[]{v, w});
            g[v].add(new int[]{u, w});
        }
        long t0 = System.nanoTime();
        int[] d = dijkstraPairing(g, 0);
        long t1 = System.nanoTime();
        System.out.printf("Pairing-heap Dijkstra: %.3f ms, dist[1]=%d%n", (t1 - t0) / 1e6, d[1]);
    }
}
```

#### Python

```python
import random, time

class PNode:
    __slots__ = ('key', 'value', 'child', 'sibling', 'prev')
    def __init__(self, key, value):
        self.key = key; self.value = value
        self.child = None; self.sibling = None; self.prev = None

class PairingHeap:
    def __init__(self):
        self.root = None
        self.size = 0

    def insert(self, key, value):
        n = PNode(key, value)
        self.root = self._meld(self.root, n)
        self.size += 1
        return n

    def delete_min(self):
        r = self.root
        self.root = self._two_pass(r.child)
        if self.root: self.root.prev = None
        self.size -= 1
        return r.key, r.value

    def decrease_key(self, n, new_key):
        if new_key > n.key: return
        n.key = new_key
        if n is self.root: return
        if n.prev.child is n: n.prev.child = n.sibling
        else: n.prev.sibling = n.sibling
        if n.sibling: n.sibling.prev = n.prev
        n.sibling = None; n.prev = None
        self.root = self._meld(self.root, n)

    def _meld(self, a, b):
        if a is None: return b
        if b is None: return a
        if a.key <= b.key:
            b.sibling = a.child
            if a.child: a.child.prev = b
            b.prev = a; a.child = b
            return a
        a.sibling = b.child
        if b.child: b.child.prev = a
        a.prev = b; b.child = a
        return b

    def _two_pass(self, first):
        if first is None or first.sibling is None:
            if first: first.prev = None
            return first
        pairs = []
        cur = first
        while cur:
            a = cur; b = cur.sibling
            nxt = b.sibling if b else None
            a.sibling = None; a.prev = None
            if b: b.sibling = None; b.prev = None
            pairs.append(self._meld(a, b))
            cur = nxt
        result = pairs[-1]
        for i in range(len(pairs) - 2, -1, -1):
            result = self._meld(result, pairs[i])
        return result

def dijkstra_pairing(graph, src):
    n = len(graph)
    INF = float('inf')
    dist = [INF] * n
    handle = [None] * n
    dist[src] = 0
    h = PairingHeap()
    handle[src] = h.insert(0, src)
    while h.size:
        _, u = h.delete_min()
        for v, w in graph[u]:
            nd = dist[u] + w
            if nd < dist[v]:
                dist[v] = nd
                if handle[v] is None:
                    handle[v] = h.insert(nd, v)
                else:
                    h.decrease_key(handle[v], nd)
    return dist

if __name__ == '__main__':
    random.seed(42)
    V, E = 10000, 50000
    graph = [[] for _ in range(V)]
    for _ in range(E):
        u, v, w = random.randrange(V), random.randrange(V), random.randint(1, 100)
        graph[u].append((v, w)); graph[v].append((u, w))
    t0 = time.time()
    d = dijkstra_pairing(graph, 0)
    print(f'Dijkstra (pairing heap): {(time.time()-t0)*1000:.1f} ms, dist[1]={d[1]}')
```

---

### Challenge 2: Verify decrease-key correctness on a 1000-node tree.

Build a heap of 1000 random elements, randomly decrease keys 500 times, then drain via delete-min and assert the output is sorted. This tests cut + meld interaction.

#### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"sort"
)

// Reuse PairingHeap from Challenge 1
func verifyDecreaseKey() {
	h := &PairingHeap{}
	handles := make([]*pNode, 1000)
	keys := make([]int, 1000)
	for i := 0; i < 1000; i++ {
		keys[i] = rand.Intn(1000000)
		handles[i] = h.Insert(keys[i], i)
	}
	for i := 0; i < 500; i++ {
		idx := rand.Intn(1000)
		newKey := rand.Intn(keys[idx] + 1)
		h.DecreaseKey(handles[idx], newKey)
		keys[idx] = newKey
	}
	// drain
	var out []int
	for h.size > 0 {
		k, _, _ := h.DeleteMin()
		out = append(out, k)
	}
	sortedKeys := make([]int, len(keys))
	copy(sortedKeys, keys)
	sort.Ints(sortedKeys)
	for i := range out {
		if out[i] != sortedKeys[i] {
			fmt.Printf("MISMATCH at %d: got %d, expected %d\n", i, out[i], sortedKeys[i])
			return
		}
	}
	fmt.Println("Decrease-key verification PASSED on 1000 nodes")
}

func main() {
	rand.Seed(7)
	verifyDecreaseKey()
}
```

#### Java

```java
import java.util.*;

public class DecreaseKeyVerify {
    public static void main(String[] args) {
        Random rng = new Random(7);
        PairingHeapBenchmark.PairingHeap h = new PairingHeapBenchmark.PairingHeap();
        PairingHeapBenchmark.PNode[] handles = new PairingHeapBenchmark.PNode[1000];
        int[] keys = new int[1000];
        for (int i = 0; i < 1000; i++) {
            keys[i] = rng.nextInt(1_000_000);
            handles[i] = h.insert(keys[i], i);
        }
        for (int i = 0; i < 500; i++) {
            int idx = rng.nextInt(1000);
            int nk = rng.nextInt(keys[idx] + 1);
            h.decreaseKey(handles[idx], nk);
            keys[idx] = nk;
        }
        int[] out = new int[1000];
        for (int i = 0; i < 1000; i++) out[i] = h.deleteMin()[0];
        int[] sorted = keys.clone();
        Arrays.sort(sorted);
        for (int i = 0; i < 1000; i++) {
            if (out[i] != sorted[i]) {
                System.out.printf("MISMATCH at %d: got %d, expected %d%n", i, out[i], sorted[i]);
                return;
            }
        }
        System.out.println("Decrease-key verification PASSED on 1000 nodes");
    }
}
```

#### Python

```python
import random
# Reuse PairingHeap from Challenge 1

def verify_decrease_key():
    random.seed(7)
    h = PairingHeap()
    handles = [None] * 1000
    keys = [0] * 1000
    for i in range(1000):
        keys[i] = random.randint(0, 999_999)
        handles[i] = h.insert(keys[i], i)
    for _ in range(500):
        idx = random.randrange(1000)
        nk = random.randint(0, keys[idx])
        h.decrease_key(handles[idx], nk)
        keys[idx] = nk
    out = []
    while h.size:
        k, _ = h.delete_min()
        out.append(k)
    expected = sorted(keys)
    for i, (got, exp) in enumerate(zip(out, expected)):
        if got != exp:
            print(f'MISMATCH at {i}: got {got}, expected {exp}')
            return
    print('Decrease-key verification PASSED on 1000 nodes')

if __name__ == '__main__':
    verify_decrease_key()
```

---

## Common Pitfalls in Interviews

1. **Implementing single-pass merge by mistake.** A common bug is to fold all orphans left-to-right into one accumulator. This gives O(n) per delete-min and breaks the amortized bound. Always implement two passes.
2. **Forgetting to nullify `prev` and `sibling` on detach.** After decrease-key cuts a node, stale pointers cause the meld to incorrectly thread the node into the wrong list. Always set `prev = nil` and `sibling = nil` after detachment.
3. **Confusing pairing heap with Fibonacci heap.** Candidates often claim O(1) decrease-key for pairing heap. The correct answer is o(log n) amortized — sublogarithmic but with an open exact bound.
4. **Forgetting that handles are stable.** Pairing heap handles survive insert and meld; this is the whole reason it works for Dijkstra. Some candidates re-search the heap on every decrease-key, which defeats the purpose.
5. **Treating it as a balanced tree.** Pairing heap has no balance invariant — trees can be arbitrarily deep or wide. The amortized analysis is what saves you, not structural balance.
6. **Allocating nodes individually in a tight loop.** Per-node malloc dominates runtime for small workloads. Always pool-allocate or use arenas in production.

---

## What Interviewers Are Really Testing

- **Amortized analysis fluency** — can you reason about potential functions and amortized costs, or do you only know worst-case?
- **Trade-off awareness** — do you understand that asymptotic optimality (Fibonacci heap) does not always win in practice?
- **Implementation discipline** — can you correctly implement pointer manipulation in detach + meld without leaks or stale pointers?
- **Comfort with open problems** — do you know that decrease-key in pairing heap has unresolved bounds, and can you reason about it intelligently?
- **Application thinking** — given Dijkstra or Prim, can you justify pairing heap as a sensible default and compare it to alternatives?
- **Code quality under abstraction** — pairing heap is a chance to demonstrate clean APIs around node handles and lifetime management.
