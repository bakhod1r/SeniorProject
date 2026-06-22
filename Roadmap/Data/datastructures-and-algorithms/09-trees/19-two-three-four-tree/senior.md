# 2-3-4 Tree — Senior Level

> **Audience:** Engineers who already understand 2-3-4 tree mechanics (`junior.md`, `middle.md`) and want the theory that places it inside the balanced-tree landscape: its exact, rigorous equivalence to the standard (CLRS) red-black tree, the height proofs that bound both, the single-pass top-down algorithms, and an honest account of why production code ships the red-black *encoding* rather than the multiway tree itself. Prerequisite: `middle.md`.

The 2-3-4 tree is a B-tree of order 4: every node holds one, two, or three keys (a 2-node, 3-node, or 4-node), every internal node has one more child than it has keys, and every leaf sits at the same depth. That perfect balance is the whole point. But the 2-3-4 tree's deepest significance is not as a structure you deploy — it is the **clean conceptual model whose efficient binary realization is the standard red-black tree**. The red-black trees in `std::map`, Java's `TreeMap`, and the Linux kernel ([`../04-red-black/senior.md`](../04-red-black/senior.md)) are not merely *similar* to 2-3-4 trees; they are isomorphic to them, edge for edge and operation for operation. This file makes that isomorphism rigorous, derives the red-black height bound straight from the 2-3-4 black-height, presents single-pass top-down insert and delete with a reference implementation, and gives an honest framework for choosing between 2-3-4/red-black, B-tree, AVL, and the 2-3 tree.

---

## Table of Contents

1. [The Red-Black Isomorphism, Rigorously](#iso)
2. [Why Red-Black Trees Are Not Unique but 2-3-4 Trees Are](#nonunique)
3. [Splits ↔ Color Flips, Borrow/Fuse ↔ Rotations](#ops-map)
4. [Why Red-Black Is the Production-Preferred Encoding](#why-rb)
5. [Height Bounds and Proofs](#height)
6. [Top-Down vs Bottom-Up Insertion and Deletion](#topdown)
7. [Reference Implementation in Go (top-down insert + delete + checker)](#go)
8. [A Second Core in Rust](#rust)
9. [Decision Framework: 2-3-4 / Red-Black vs B-tree vs AVL vs 2-3](#decision)
10. [Reading List](#reading)

---

<a name="iso"></a>
## 1. The Red-Black Isomorphism, Rigorously

The marquee fact at this level: **a 2-3-4 tree and a standard red-black tree are the same object viewed two ways.** Red-black trees were introduced by Guibas and Sedgewick (1978) precisely as a binary *encoding* of multiway balanced trees, and the order-4 case is the canonical one — it is the encoding that the CLRS red-black tree (and therefore `std::map`, `TreeMap`, and `rbtree.h`) implements.

The mapping is mechanical. Each multiway node is encoded as a small cluster of binary nodes joined by **red links**, where the cluster's top node is **black**:

- A **2-node** (one key `a`, two children) ↔ a single **black** node with two black-rooted subtrees.

  ```
      (a)              a (black)
     /   \      ↔     / \
    L     R          L   R
  ```

- A **3-node** (keys `a < b`, three children) ↔ a **black** node with **one red child**.

  ```
     ( a , b )                b (black)              a (black)
    /    |    \      ↔       / \           OR       / \
   L     M     R    a(red)─►a   R           L  (red)b
                          / \                        / \
                         L   M                      M   R
  ```

  Both encodings are valid: the red link may lean left (smaller key red, hanging under the larger) or lean right (larger key red, hanging under the smaller). Read either fragment in-order — `L, a, M, b, R` — and you recover the 3-node's key and child order exactly. This two-way choice is the source of red-black non-uniqueness (§2).

- A **4-node** (keys `a < b < c`, four children) ↔ a **black** node with **two red children**.

  ```
      ( a , b , c )                  b (black)
     /   |    |   \      ↔          /   \
    L    M1   M2   R         a(red)      c(red)
                            /   \        /   \
                           L    M1      M2    R
  ```

  This encoding is **unique**: the middle key `b` is forced to be the black top, with `a` and `c` as its two red children. There is no other balanced binary arrangement of three keys that keeps both red links one level deep.

The red-black invariants are not arbitrary rules to memorize — they are exactly the 2-3-4 invariants re-expressed in the binary encoding:

- **Root is black; every leaf (NIL) is black** — bookkeeping for the encoding.
- **A red node never has a red child** ⟺ a multiway node holds at most **three** keys (a 4-node, never a "5-node"). Two reds in a row would encode a fourth key into one cluster.
- **Every root-to-NIL path has the same number of black nodes** (the *black-height*) ⟺ every 2-3-4 leaf is at the same depth. **Black links correspond exactly to 2-3-4 tree edges; red links correspond to within-node glue.** So counting black nodes on a path *is* counting 2-3-4 levels. This single correspondence is why the black-height invariant exists and why it is the load-bearing property of the whole structure.

This isomorphism is the cleanest possible explanation of why red-black trees have the invariants they do. The companion 2-3 ↔ left-leaning-red-black pairing is treated in [`../18-two-three-tree/senior.md`](../18-two-three-tree/senior.md); the difference is purely the B-tree order (3 vs 4), which fixes how many red children a black node may have (one vs up to two).

| Multiway tree | Binary encoding | Red children per black node | Red link direction |
|---|---|---|---|
| 2-3 | LLRB / AA | exactly 0 or 1 | left only (LLRB) / right only (AA) |
| 2-3-4 | standard (CLRS) red-black | 0, 1, or 2 | either |

---

<a name="nonunique"></a>
## 2. Why Red-Black Trees Are Not Unique but 2-3-4 Trees Are

This is the subtle, senior-level consequence of the 3-node having **two** valid encodings.

A 2-3-4 tree over a given set of keys, built by the standard rules, is **canonical**: there is exactly one 2-3-4 tree shape for a given sequence of insertions, and (for many key sets) the perfectly-balanced shape is unique up to how 4-nodes are split. The multiway node *itself* is unordered-internally only in the trivial sense; its keys and children have one layout.

The **standard red-black tree is not unique**, and the §1 mapping shows precisely why. Every 3-node admits *two* binary encodings — red-leaning-left or red-leaning-right. So a 2-3-4 tree containing `k` three-nodes maps to as many as `2^k` distinct legal red-black trees, all encoding the *same* 2-3-4 tree, all satisfying the red-black invariants. Which one you get depends on the order of insertions and the exact rotation choices in the fixup code; two different red-black implementations can store the same keys in differently-shaped (but equally valid) trees.

The **left-leaning red-black (LLRB)** variant exists to recover uniqueness for the order-3 case: by forbidding right-leaning red links, it removes the second encoding of a 3-node, making the binary tree canonical again — at the cost of being able to represent only 2-3 trees, not 2-3-4 trees (see [`../18-two-three-tree/senior.md`](../18-two-three-tree/senior.md)). Standard red-black deliberately keeps both encodings because the freedom makes the fixup logic shorter and the 4-node representation natural.

The practical upshot: never assert that "the red-black tree" of a key set has a specific shape. The 2-3-4 tree is the unique normal form; the red-black tree is one of exponentially many faithful binary projections of it.

---

<a name="ops-map"></a>
## 3. Splits ↔ Color Flips, Borrow/Fuse ↔ Rotations

The isomorphism is not static — it is *operational*. Every 2-3-4 restructuring step has an exact red-black counterpart, and this is what makes the red-black tree a true realization rather than a mere analogy.

### Splitting a 4-node ⟺ a color flip

In top-down insertion (§6) you split every 4-node you meet on the way down, so the parent always has room. Splitting the 4-node `(a, b, c)` promotes the middle key `b` into the parent and leaves two 2-nodes `(a)` and `(c)`:

```
  parent has room                 b joins parent
        ...                          ...
         |               split        |    \
   ( a , b , c )       ───────►      (a)    (c)
```

In the red-black encoding, the 4-node is a black node `b` with two red children `a` and `c`. Splitting it is **literally a color flip**: recolor `a` and `c` to **black**, and recolor `b` to **red** so it floats up to join the parent's cluster.

```
        b (black)                      b (red)        ← b now red, promotes into parent
       /   \           flipColors      /   \
 a(red)     c(red)    ──────────►  a(black) c(black)
```

That is the entire split. No pointers move — only three color bits change. This is `O(1)` and is why top-down red-black insertion never needs to walk back up: each 4-node it encounters is flattened with a flip in passing. The only follow-up is that turning `b` red may create a red-red violation with the parent's existing red link, fixed by **at most one rotation** — the binary echo of "the promoted key landed in a parent that was already a 3-node, which now becomes a 4-node" (handled on the next iteration of the descent, never as an upward cascade).

### Borrow ⟺ rotation, fuse ⟺ rotation + recolor

Deletion's two repairs map just as cleanly:

- **Borrow (transfer)** — an underflowing node takes a key from a sibling that has a spare, rotating it through the parent separator. In the binary encoding this is a **rotation** at the parent that moves the donated key across, plus a recolor. One key rotates through; both nodes end valid.

- **Fuse (merge)** — an underflowing node merges with a sibling and pulls the parent separator down between them, forming one larger node. In the binary encoding a fuse is a **recolor** (the pulled-down separator becomes red, binding the two former 2-nodes into one 3- or 4-node cluster) sometimes combined with a **rotation** to seat the merged cluster correctly. If the parent underflows as a result, the repair continues — in top-down deletion (§6) this is pre-empted by ensuring every node on the descent already has a spare key.

So the complete red-black update vocabulary — **rotateLeft, rotateRight, flipColors** — is a line-for-line transcription of **split, borrow, fuse**. A red link reaching the root and being recolored black is the binary image of the 2-3-4 root splitting and the tree growing one level taller, which increments every path's black-height at once. This operational correspondence, not the static node mapping, is what earns the red-black tree the title of the 2-3-4 tree's *realization*.

---

<a name="why-rb"></a>
## 4. Why Red-Black Is the Production-Preferred Encoding

Be precise and honest about the model-vs-realization split: **almost no production in-memory system stores a literal 2-3-4 tree.** It stores the red-black encoding. The reasons are concrete, and they all favor the binary form in RAM.

1. **`O(1)` restructuring per update vs multiway node surgery.** A red-black insert does at most **two rotations**; a delete does at most **three** — each a constant-pointer operation — plus `O(log n)` color flips that touch only bits. The literal 2-3-4 tree, by contrast, reshapes variable-arity nodes: a split allocates and repacks two nodes and shuffles up to four child pointers; a borrow/fuse repacks key and child arrays. Same asymptotics, heavier constant.

2. **Uniform node shape and cache/pointer behavior.** A 2-3-4 node must reserve room for three keys and four child pointers even when it is currently a 2-node, or be a tagged union reshaped on every split/merge — either way the hot path carries `if 2-node … else if 3-node … else …` branches over an irregular layout. The red-black node is one fixed shape: a key, a value, left/right (and usually parent) pointers, and a single color bit. The kernel even packs the color into the low bit of the parent pointer (`__rb_parent_color`), so a node is three pointers and nothing more. Uniform layout means predictable branches and cache lines, which the CPU handles far better than variable-arity dispatch.

3. **It is what the standard libraries actually ship.** `std::map`/`std::set` (libstdc++ `_Rb_tree`), Java `TreeMap`/`TreeSet`, and the Linux kernel's `rbtree.h` — used by the CFS/EEVDF scheduler runqueue, the (pre-6.1) VMA index, `epoll`'s interest set, and cgroups — are all red-black trees, i.e. the binary realization of the 2-3-4 tree. See [`../04-red-black/senior.md`](../04-red-black/senior.md) for the production tour.

The honest framing: the **2-3-4 tree is the clean conceptual model; the red-black tree is its efficient realization.** You reason in 2-3-4 (splits, borrows, fuses, perfect balance) because that model is simple and its invariants are self-evident; you *ship* red-black because the binary encoding delivers the identical guarantees with `O(1)` rotations, a uniform node, and a one-bit tag. The 2-3-4 tree earns its place by *explaining* the structure you deploy, not by being deployed. The one setting where the multiway form itself wins is disk, and there you do not pick order 4 — you pick the order that fills a page, which is the B-tree ([`../11-b-tree/senior.md`](../11-b-tree/senior.md)).

---

<a name="height"></a>
## 5. Height Bounds and Proofs

Let `n` be the number of keys and `h` the 2-3-4 height (edges on a root-to-leaf path; all leaves are at depth `h`).

**Upper bound on height — sparsest tree.** The sparsest 2-3-4 tree of height `h` is all 2-nodes: a complete binary tree with `2^(h+1) − 1` nodes, one key each. So

```
n ≥ 2^(h+1) − 1   ⟹   h ≤ log₂(n + 1) − 1.
```

That is the headline bound: **a 2-3-4 tree has height ≤ log₂(n + 1) − 1**, hence `h < log₂(n + 1)`.

**Lower bound on height — densest tree.** The densest 2-3-4 tree of height `h` is all 4-nodes: each has 4 children and 3 keys, giving `(4^(h+1) − 1)/3` nodes with 3 keys each, so

```
n ≤ 3 · (4^(h+1) − 1)/3 = 4^(h+1) − 1   ⟹   h ≥ log₄(n + 1) − 1.
```

Combining,

```
log₄(n + 1) − 1   ≤   h   ≤   log₂(n + 1) − 1.
```

Since `log₄ x = ½ log₂ x`, the height lives in a tight band between `0.5 log₂ n` and `log₂ n`: a 2-3-4 tree is never more than `2×` taller than its perfectly-packed all-4-node form. Like the 2-3 tree, it achieves **perfect** balance (all leaves at identical depth), which AVL and red-black only approximate.

**The red-black height bound follows directly.** The red-black encoding of a 2-3-4 tree of height `h` has black-height exactly `h + 1`: every 2-3-4 edge is a black link, and the path from root to NIL crosses `h + 1` black nodes. Red links only ever appear *between* black nodes, and the no-two-reds-in-a-row invariant means at most one red node sits on any black-to-black step. Therefore the red-black *total* height is at most **twice** the black-height:

```
red-black height ≤ 2 · (h + 1) ≤ 2 · log₂(n + 1).
```

This is the familiar "red-black height ≤ 2 log₂(n+1)" bound — and here it is **derived as a corollary of the 2-3-4 height proof**, not asserted. The factor of 2 is exactly the cost of representing a 4-node (one black + two reds = up to 2 levels) as a binary cluster.

**Comparison with neighbors.**

| Tree | Height bound | Balance kind |
|---|---|---|
| 2-3-4 | `≤ log₂(n+1) − 1` | perfect (all leaves level) |
| 2-3 | `≤ log₂(n+1) − 1`, `≥ log₃(n+1) − 1` | perfect |
| Red-black (2-3-4 encoding) | `≤ 2·log₂(n+1)` | imbalance-bounded |
| AVL ([`../03-avl/senior.md`](../03-avl/senior.md)) | `≤ 1.44·log₂(n+2)` | imbalance-bounded, tightest |

AVL is the shortest of the imbalance-bounded trees — about `1.44 log n` versus red-black's `2 log n` — which is why AVL wins a comparison or two per lookup on read-heavy workloads, at the cost of more rotations on update. The 2-3-4/2-3 trees, being perfectly balanced, are shorter still in the multiway count, but that count is not directly comparable to binary height; what matters is their *encoded* red-black height, which is the `2 log n` row.

---

<a name="topdown"></a>
## 6. Top-Down vs Bottom-Up Insertion and Deletion

The 2-3-4 tree's signature algorithmic property is the **single-pass, top-down** update — the original reason Guibas and Sedgewick favored the order-4 encoding.

**Bottom-up (the 2-3 / B-tree style).** Descend to a leaf, insert, then walk *back up* splitting any overflowed node and propagating the promoted key. Deletion mirrors it: remove, then walk back up borrowing/fusing to repair underflow. This requires either recursion (an implicit `O(log n)` stack) or parent pointers, because the repair direction is leaf-to-root.

**Top-down (the 2-3-4 advantage).** On the way *down*, pre-emptively restructure so the node you are about to descend into can always absorb a change:

- **Insertion:** every time you encounter a **4-node** during the descent, **split it immediately** (a color flip in the encoding) and push its middle key into the parent. Because you split on the way down, the parent you just came from is guaranteed not to be a 4-node (you would have split it already), so it always has room for the promoted key. By the time you reach the leaf, inserting cannot overflow anything above you — **no upward pass, no recursion stack, no parent pointers.**

- **Deletion:** on the way down, ensure the child you are about to enter has **at least two keys** (is not a 2-node); if it is a 2-node, fix it *first* by borrowing from a sibling or fusing with one (pulling a key down from the current node, which is safe because you already guaranteed *it* had a spare). By the time you reach the key to delete, its node has a spare and removal cannot cause underflow above — again a single downward pass.

**Why this matters at senior level.** The single-pass property is not just elegance:

1. **No auxiliary stack or parent pointers.** The algorithm is iterative with `O(1)` extra space. This shrinks the node (no parent pointer needed) and simplifies the code.
2. **Concurrency-friendly descent.** Because repair flows strictly downward and each step touches only a node and its immediate children, you can use **latch-coupling** (hold a lock on the current node and its child, release the grandparent) without ever needing to re-acquire ancestor locks for an upward fixup. A writer never has to hold a lock on a node it has already passed. Bottom-up schemes, whose repairs may cascade back to the root, cannot make that guarantee. This is the same insight that makes B-link trees concurrency-friendly ([`../11-b-tree/senior.md`](../11-b-tree/senior.md)), specialized to order 4.
3. **Amortized `O(1)` restructuring.** A single insert can split `O(log n)` 4-nodes in the worst case, but the **amortized** number of splits per insert is `O(1)` (standard potential argument: each split consumes credit deposited when a node became a 4-node; total splits over `m` inserts `< m`). The same `O(1)` amortized bound holds for borrows/fuses on delete. This matches the red-black guarantee of `O(1)` amortized rotations and is why both give predictable update latency.

The cost of pre-emptive top-down splitting is that it sometimes splits a 4-node that a later step would not have needed to touch — slightly more restructuring on average than the lazy bottom-up approach, traded for the single-pass simplicity and the concurrency story.

---

<a name="go"></a>
## 7. Reference Implementation in Go (top-down insert + delete + checker)

A clean, idiomatic mutable 2-3-4 tree for `int` keys. Insertion is **top-down**: split every 4-node encountered during the descent, so the leaf insert never overflows above. Deletion is **top-down**: ensure each node descended into has a spare key. The invariant checker is the real asset — it verifies the four defining properties and is what you run in property tests.

```go
package twothreefour

import "fmt"

// node holds 1..3 keys (2-node, 3-node, or 4-node).
// children: len(keys)+1 for internal nodes; 0 for leaves.
type node struct {
	keys     []int
	children []*node
}

type Tree struct{ root *node }

func (n *node) leaf() bool   { return len(n.children) == 0 }
func (n *node) isFour() bool { return len(n.keys) == 3 }

// ---------- Search ----------

func (t *Tree) Contains(k int) bool {
	n := t.root
	for n != nil {
		i := 0
		for i < len(n.keys) && k > n.keys[i] {
			i++
		}
		if i < len(n.keys) && n.keys[i] == k {
			return true
		}
		if n.leaf() {
			return false
		}
		n = n.children[i]
	}
	return false
}

// ---------- Top-down Insert ----------

func (t *Tree) Insert(k int) {
	if t.root == nil {
		t.root = &node{keys: []int{k}}
		return
	}
	// Split the root up front if it is a 4-node, so the tree can grow.
	if t.root.isFour() {
		t.root = splitChildOf(&node{children: []*node{t.root}}, 0)
	}
	insertNonFull(t.root, k)
}

// splitChildOf splits parent.children[i] (a 4-node) into two 2-nodes and
// lifts its middle key into parent. Returns parent (for the root case).
func splitChildOf(parent *node, i int) *node {
	full := parent.children[i]
	mid := full.keys[1]
	left := &node{keys: []int{full.keys[0]}}
	right := &node{keys: []int{full.keys[2]}}
	if !full.leaf() {
		left.children = []*node{full.children[0], full.children[1]}
		right.children = []*node{full.children[2], full.children[3]}
	}
	parent.keys = insertKeyAt(parent.keys, i, mid)
	parent.children[i] = left
	parent.children = insertChildAt(parent.children, i+1, right)
	return parent
}

// insertNonFull inserts into a node guaranteed not to be a 4-node.
func insertNonFull(n *node, k int) {
	i := 0
	for i < len(n.keys) && k > n.keys[i] {
		i++
	}
	if i < len(n.keys) && n.keys[i] == k {
		return // already present
	}
	if n.leaf() {
		n.keys = insertKeyAt(n.keys, i, k)
		return
	}
	if n.children[i].isFour() { // split on the way down
		splitChildOf(n, i)
		if k > n.keys[i] {
			i++
		} else if k == n.keys[i] {
			return
		}
	}
	insertNonFull(n.children[i], k)
}

// ---------- Top-down Delete ----------

func (t *Tree) Delete(k int) {
	if t.root == nil {
		return
	}
	del(t.root, k)
	if len(t.root.keys) == 0 { // root emptied: shrink height
		if t.root.leaf() {
			t.root = nil
		} else {
			t.root = t.root.children[0]
		}
	}
}

// del removes k from the subtree at n, which is guaranteed to have a spare
// key (>= 2 keys) unless it is the root. It restores that guarantee for any
// child before descending into it.
func del(n *node, k int) {
	i := 0
	for i < len(n.keys) && k > n.keys[i] {
		i++
	}
	if i < len(n.keys) && n.keys[i] == k {
		if n.leaf() {
			n.keys = removeKeyAt(n.keys, i) // safe: n has a spare
			return
		}
		// internal: replace with in-order predecessor, then delete it below
		ensureSpare(n, i) // make children[i] have >= 2 keys
		// indices may have shifted if a fuse occurred at i
		i = 0
		for i < len(n.keys) && k > n.keys[i] {
			i++
		}
		if i < len(n.keys) && n.keys[i] == k {
			pred := maxKey(n.children[i])
			n.keys[i] = pred
			del(n.children[i], pred)
		} else {
			del(n.children[i], k) // key migrated into a fused child
		}
		return
	}
	if n.leaf() {
		return // not found
	}
	ensureSpare(n, i)
	// recompute the child index after a possible fuse
	i = 0
	for i < len(n.keys) && k > n.keys[i] {
		i++
	}
	del(n.children[i], k)
}

// ensureSpare guarantees children[i] has >= 2 keys by borrowing from a
// sibling (rotation) or fusing with one (merge). May shift n's keys/children.
func ensureSpare(n *node, i int) {
	c := n.children[i]
	if len(c.keys) >= 2 {
		return
	}
	// borrow from left sibling
	if i > 0 && len(n.children[i-1].keys) >= 2 {
		l := n.children[i-1]
		c.keys = insertKeyAt(c.keys, 0, n.keys[i-1])
		n.keys[i-1] = l.keys[len(l.keys)-1]
		l.keys = l.keys[:len(l.keys)-1]
		if !l.leaf() {
			c.children = insertChildAt(c.children, 0, l.children[len(l.children)-1])
			l.children = l.children[:len(l.children)-1]
		}
		return
	}
	// borrow from right sibling
	if i < len(n.keys) && len(n.children[i+1].keys) >= 2 {
		r := n.children[i+1]
		c.keys = append(c.keys, n.keys[i])
		n.keys[i] = r.keys[0]
		r.keys = r.keys[1:]
		if !r.leaf() {
			c.children = append(c.children, r.children[0])
			r.children = r.children[1:]
		}
		return
	}
	// fuse with a sibling (both are minimal): pull a separator down
	if i > 0 {
		fuse(n, i-1)
	} else {
		fuse(n, i)
	}
}

// fuse merges children[i] and children[i+1] around separator keys[i].
func fuse(n *node, i int) {
	l, r := n.children[i], n.children[i+1]
	l.keys = append(l.keys, n.keys[i])
	l.keys = append(l.keys, r.keys...)
	l.children = append(l.children, r.children...)
	n.keys = removeKeyAt(n.keys, i)
	n.children = append(n.children[:i+1], n.children[i+2:]...)
}

func maxKey(n *node) int {
	for !n.leaf() {
		n = n.children[len(n.children)-1]
	}
	return n.keys[len(n.keys)-1]
}

// ---------- Invariant checker (the heart of any test suite) ----------

// Check verifies: (1) key counts in {1,2,3}; (2) child count == keys+1 for
// internal nodes; (3) keys sorted and respecting child key ranges;
// (4) all leaves at equal depth. Returns the first violation, or nil.
func (t *Tree) Check() error {
	if t.root == nil {
		return nil
	}
	_, err := checkNode(t.root, nil, nil)
	return err
}

func checkNode(n *node, lo, hi *int) (depth int, err error) {
	if len(n.keys) < 1 || len(n.keys) > 3 {
		return 0, fmt.Errorf("node has %d keys (must be 1..3)", len(n.keys))
	}
	for i := 1; i < len(n.keys); i++ {
		if n.keys[i-1] >= n.keys[i] {
			return 0, fmt.Errorf("keys not strictly sorted: %v", n.keys)
		}
	}
	if lo != nil && n.keys[0] <= *lo {
		return 0, fmt.Errorf("key %d violates lower bound %d", n.keys[0], *lo)
	}
	if hi != nil && n.keys[len(n.keys)-1] >= *hi {
		return 0, fmt.Errorf("key %d violates upper bound %d", n.keys[len(n.keys)-1], *hi)
	}
	if n.leaf() {
		return 0, nil
	}
	if len(n.children) != len(n.keys)+1 {
		return 0, fmt.Errorf("internal node: %d keys but %d children", len(n.keys), len(n.children))
	}
	depths := make([]int, len(n.children))
	for i := range n.children {
		childLo, childHi := lo, hi
		if i > 0 {
			childLo = &n.keys[i-1]
		}
		if i < len(n.keys) {
			childHi = &n.keys[i]
		}
		d, e := checkNode(n.children[i], childLo, childHi)
		if e != nil {
			return 0, e
		}
		depths[i] = d
	}
	for i := 1; i < len(depths); i++ {
		if depths[i] != depths[0] {
			return 0, fmt.Errorf("unequal leaf depth: %v", depths)
		}
	}
	return depths[0] + 1, nil
}

// ---------- small slice helpers ----------

func insertKeyAt(s []int, i, v int) []int {
	s = append(s, 0)
	copy(s[i+1:], s[i:])
	s[i] = v
	return s
}
func insertChildAt(s []*node, i int, v *node) []*node {
	s = append(s, nil)
	copy(s[i+1:], s[i:])
	s[i] = v
	return s
}
func removeKeyAt(s []int, i int) []int { return append(s[:i], s[i+1:]...) }
```

**Complexity.** Search, insert, and delete are each `O(log n)` worst case — one downward pass touching `h ≤ log₂(n+1)` nodes. Insert does `O(1)` work per level (at most one split per descended node) and `O(1)` amortized splits per call; delete does `O(1)` work per level and `O(1)` amortized borrow/fuse per call (§6). Extra space is `O(log n)` only because of recursion in `del`/`insertNonFull`; both can be rewritten iteratively for `O(1)` space, which is the whole point of the top-down design.

**Correctness argument.** *Insert* maintains the invariant by a descent precondition: `insertNonFull` is only ever called on a non-4-node, and before descending it splits any 4-node child (`splitChildOf`), which by §3 promotes the middle key into the current node — safe because the current node is not full. The root is split up front so the tree can grow uniformly through a brand-new root, keeping all leaves level. A new key is only ever added to a leaf, so depth changes only via root splits. *Delete* maintains a symmetric precondition: `del` is only entered on a node with a spare key (or the root), and `ensureSpare` restores that for any child before descent, via a borrow (a rotation moving one key through the parent, leaving both nodes valid) or a fuse (pulling a separator down, which is safe precisely because the parent had a spare). An internal key is swapped for its leaf predecessor so the actual removal always lands at a leaf with a spare; height shrinks only when the root empties and hands its single child up. Running `Check()` after every operation in a randomized/property test makes the structure self-verifying.

---

<a name="rust"></a>
## 8. A Second Core in Rust

The top-down insert expressed with Rust's ownership model. `Box`-owned children give a clean single-owner tree; the split-on-descent logic is identical, and the borrow checker forces the index recomputation after a split to be explicit.

```rust
pub struct Node {
    keys: Vec<i32>,
    children: Vec<Box<Node>>, // empty for leaves; else keys.len()+1
}

impl Node {
    fn leaf(&self) -> bool { self.children.is_empty() }
    fn is_four(&self) -> bool { self.keys.len() == 3 }

    // Split self.children[i] (a 4-node) into two 2-nodes, lifting its
    // middle key into self. self must not be full.
    fn split_child(&mut self, i: usize) {
        let full = &mut self.children[i];
        let mid = full.keys[1];
        let right_keys = vec![full.keys[2]];
        let right_children: Vec<Box<Node>> = if full.leaf() {
            Vec::new()
        } else {
            full.children.drain(2..4).collect()
        };
        full.keys.truncate(1); // left half keeps keys[0]
        let right = Box::new(Node { keys: right_keys, children: right_children });
        self.keys.insert(i, mid);
        self.children.insert(i + 1, right);
    }

    // Insert into a node guaranteed not to be a 4-node.
    fn insert_nonfull(&mut self, k: i32) {
        let mut i = self.keys.partition_point(|&x| x < k);
        if i < self.keys.len() && self.keys[i] == k {
            return; // already present
        }
        if self.leaf() {
            self.keys.insert(i, k);
            return;
        }
        if self.children[i].is_four() {
            self.split_child(i);
            if k > self.keys[i] {
                i += 1;
            } else if k == self.keys[i] {
                return;
            }
        }
        self.children[i].insert_nonfull(k);
    }
}

pub struct Tree {
    root: Option<Box<Node>>,
}

impl Tree {
    pub fn new() -> Self { Tree { root: None } }

    pub fn insert(&mut self, k: i32) {
        match self.root.take() {
            None => {
                self.root = Some(Box::new(Node { keys: vec![k], children: vec![] }));
            }
            Some(mut root) => {
                if root.is_four() {
                    // grow: new root adopts the old root, then splits it
                    let mut new_root = Node { keys: vec![], children: vec![root] };
                    new_root.split_child(0);
                    new_root.insert_nonfull(k);
                    self.root = Some(Box::new(new_root));
                } else {
                    root.insert_nonfull(k);
                    self.root = Some(root);
                }
            }
        }
    }
}
```

`Vec::partition_point` is binary search for the child index; `drain(2..4)` cleanly transfers the right half's children to the new sibling. The shape mirrors the Go version exactly — split on the way down, recompute the index after a split, descend — which is the point: the top-down algorithm is language-independent, and the 4-node split is the same color-flip event (§3) whatever the host type system.

---

<a name="decision"></a>
## 9. Decision Framework: 2-3-4 / Red-Black vs B-tree vs AVL vs 2-3

A practical framework. The honest top line: you rarely deploy a *literal mutable 2-3-4 tree*; you deploy its red-black realization or one of its relatives.

- **Mutable in-memory ordered map/set, general purpose?** → **Red-black tree** (the 2-3-4 encoding). The library default in `std::map`, Java `TreeMap`, and the Linux kernel. Best "good at everything" balance of update and lookup cost: `O(1)` rotations per update, a uniform 3-pointer-plus-1-bit node, predictable worst-case latency. Reason in 2-3-4, ship red-black. See [`../04-red-black/senior.md`](../04-red-black/senior.md).

- **You specifically want the simplest correct code, and order-3 behavior suffices?** → **2-3 tree's encoding (LLRB / AA).** The left-leaning variant is canonical and short to implement, at the cost of representing only 2-3 trees and a famously fiddly delete. See [`../18-two-three-tree/senior.md`](../18-two-three-tree/senior.md).

- **In-memory, read-heavy, lookups dominate updates?** → **AVL.** Its tighter height (`≤ 1.44 log n` vs red-black's `2 log n`) saves a comparison or two per search, paid for with more rotations per update. See [`../03-avl/senior.md`](../03-avl/senior.md).

- **Data on disk or SSD, or much larger than cache?** → **B-tree / B+ tree.** The 2-3-4 tree is just the order-4 special case; in storage you pick the order that fills a page (hundreds to thousands of keys), turning each level into one page fetch. The top-down split-on-descent and concurrency story of §6 generalize directly (B-link trees). See [`../11-b-tree/senior.md`](../11-b-tree/senior.md).

- **Concurrent mutable ordered map?** → **Usually not a balanced tree at all** — a skip list (`ConcurrentSkipListMap`) or lock-free trie is far easier to make correct. *But* the 2-3-4 top-down design is the most concurrency-amenable of the rebalancing trees: its strictly-downward repair enables latch-coupling without upward re-locking (§6), the same property that makes B-link trees viable under contention.

- **You need to teach, reason about, or derive red-black invariants from first principles?** → **The 2-3-4 tree itself.** This is its highest-value role: the unique normal form whose binary projection is the standard red-black tree, the explanation for why the black-height invariant exists, and the reason `O(1)`-rotation rebalancing is possible at all.

The unifying thought, repeated honestly: the 2-3-4 tree is less a structure you deploy than the **model that explains the structure you do deploy**. Standard red-black is its efficient binary realization for RAM; the B-tree is its high-order generalization for disk; the 2-3 tree is its order-3 sibling for the simplest possible binary encoding. Understanding the 2-3-4 ↔ red-black isomorphism deeply is what lets you see all of them as one family.

---

<a name="reading"></a>
## 10. Reading List

- **Guibas, L. J., & Sedgewick, R.** (1978). *A Dichromatic Framework for Balanced Trees.* FOCS. The original red-black paper — red-black trees introduced precisely as the binary encoding of 2-3-4 trees; the source of the top-down single-pass insertion.
- **Cormen, Leiserson, Rivest, & Stein.** *Introduction to Algorithms*, 3rd/4th ed. The canonical red-black chapter implements the 2-3-4 encoding; read its rotation/recolor case analysis alongside §1–§3 to see the isomorphism in code.
- **Bayer, R.** (1972). *Symmetric Binary B-Trees: Data Structure and Maintenance Algorithms.* Acta Informatica. The "symmetric binary B-tree" is the red-black tree by another name — the order-4 B-tree's binary form.
- **Sedgewick, R.** (2008). *Left-Leaning Red-Black Trees.* The companion construction for the order-3 case; clarifies why standard red-black (2-3-4) is non-unique and LLRB (2-3) is canonical.
- **Sedgewick, R., & Wayne, K.** *Algorithms, 4th ed.* The balanced-search-trees chapter; the clearest narrative of the multiway ↔ binary correspondence.
- **Aho, Hopcroft, & Ullman.** *The Design and Analysis of Computer Algorithms.* Classic textbook treatment of 2-3 and 2-3-4 trees and their `O(log n)` operations.
