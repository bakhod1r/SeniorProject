# 2-3 Tree — Senior Level

> **Audience:** Engineers who already understand 2-3 tree mechanics (`junior.md`, `middle.md`) and want the theory that places it inside the balanced-tree landscape: its exact equivalence to red-black variants, its height proofs, why it is mostly a teaching device, and where its immutable cousin earns a place in production. Prerequisite: `middle.md`.

The 2-3 tree is the smallest non-trivial B-tree — a B-tree of order 3, every node holding one or two keys, every leaf at the same depth. That makes it the perfect lens for two purposes: it is the cleanest model of *why* balanced search works, and it is the structure that red-black trees were designed to *encode in binary form*. This file argues both: that the 2-3 tree is the conceptual parent of the entire red-black family, and that — precisely because the binary encoding is so much cheaper — you almost never want the 2-3 tree itself in memory. The exception, immutable 2-3 trees inside functional sequence libraries, is treated honestly at the end.

---

## Table of Contents

1. [The Deep Equivalence: 2-3 ↔ LLRB ↔ AA](#equiv)
2. [How a 2-3 Split Maps to LLRB Color Flips and Rotations](#split-map)
3. [Contrast: 2-3-4 ↔ Standard Red-Black](#contrast234)
4. [Height Bounds and Proofs](#height)
5. [Occupancy, Comparison Counts, Amortized Split/Merge Cost](#cost)
6. [Why 2-3 Trees Are a Teaching Model, Not a Production Structure](#teaching)
7. [Bulk Loading, Immutable 2-3 Trees, and 2-3 Finger Trees](#immutable)
8. [Concurrency Considerations](#concurrency)
9. [Reference Implementation in Go (search + insert + delete + invariant checker)](#go)
10. [A Second Core in Haskell](#haskell)
11. [When to Reach for 2-3 vs B-tree vs Red-Black vs AVL](#decision)
12. [Reading List](#reading)

---

<a name="equiv"></a>
## 1. The Deep Equivalence: 2-3 ↔ LLRB ↔ AA

The single most important fact at this level: **a 2-3 tree and a left-leaning red-black (LLRB) tree are the same structure viewed two ways.** Sedgewick made this explicit in his 2008 LLRB construction, but the underlying isomorphism dates to Guibas and Sedgewick (1978), who introduced red-black trees precisely as a binary *encoding* of multiway balanced trees.

The mapping rule is mechanical:

- A **2-node** (one key, two children) ↔ a single black node with two black-rooted subtrees.
- A **3-node** (two keys `a < b`, three children) ↔ **two binary nodes joined by one red link**, with the red link **leaning left**: the smaller key `a` becomes a red node hanging off the left of the larger key `b`.

Diagrammatically, the 3-node

```
        ( a , b )
       /    |    \
      L     M     R
```

becomes the binary fragment

```
            b (black)
           / \
   a (red)    R
   /   \
  L     M
```

Read the binary fragment in-order — `L, a, M, b, R` — and you recover exactly the multiway node's key order and child order. The red link is not a "real" edge in the 2-3 view; it is *internal glue* binding the two keys of one 3-node. Color it red, and the LLRB invariants fall out of the 2-3 invariants:

- **No two red links in a row** ⟺ a 2-3 node holds at most two keys (a 3-node, never a "4-node" with three keys).
- **Red links lean left** ⟺ the canonical encoding above; forbidding right-leaning red links removes the second way to encode a 3-node, making the encoding *unique*.
- **Perfect black balance** (every root-to-null path has the same number of black links) ⟺ all 2-3 leaves are at equal depth. Black links correspond exactly to 2-3 tree edges; red links correspond to within-node glue, so counting black links *is* counting 2-3 levels.

**AA-trees** (Arne Andersson, 1993) are the same idea with a different bookkeeping device. Instead of a color bit, each node stores a `level` (its black-height). A 3-node is encoded as a node and its right child *at the same level* — AA-trees lean **right** by convention and forbid left horizontal links, the mirror image of LLRB. Andersson's `skew` (fix a left horizontal link by right rotation) and `split` (fix two consecutive right horizontal links by left rotation, raising the level) are exactly the LLRB `rotateRight` / `rotateLeft` + `flipColors` operations under a level-based name. AA, LLRB, and 2-3 are three notations for one tree.

Why care? Because it collapses three "different" balanced trees into one mental model. If you understand 2-3 splits, you understand LLRB rotations and AA skew/split for free — they are the same algorithm projected onto a binary representation.

---

<a name="split-map"></a>
## 2. How a 2-3 Split Maps to LLRB Color Flips and Rotations

Insertion makes the correspondence operational. In a 2-3 tree you always insert into a leaf, then split overflowing 4-nodes upward. In LLRB you insert a red node at the bottom, then fix violations on the way up. These are the *same* events:

**Inserting into a 2-node → 3-node** (2-3 view) ⟺ **attaching a red link** (LLRB view). A new key joining a single-key node just adds a left-leaning red link. If the new key is larger, it arrives as a right-leaning red link and a single `rotateLeft` makes it lean left. No black-height change. Cheap, local.

**Inserting into a 3-node → transient 4-node, then split** (2-3 view) ⟺ **two reds in a row, then `flipColors`** (LLRB view). A 3-node that gains a third key is a momentary 4-node — in LLRB this shows up as a node with two red children (after at most one `rotateRight` to balance them). The LLRB response is `flipColors`: turn both child links black and the link to *this* node red. That is precisely the 2-3 split: the middle key is promoted, the node divides into two 2-nodes, and the promotion propagates upward as a new red link into the parent.

So the LLRB triple — **`rotateLeft` (lean a right red left), `rotateRight` (balance two left reds), `flipColors` (split a 4-node)** — is a line-for-line transcription of "split the 4-node and push the middle key up." A red link reaching the root corresponds to the 2-3 root splitting and the tree growing one level taller; LLRB handles it by coloring the root black, which increments black-height by one for every path at once.

This is why LLRB insertion is so short (Sedgewick's canonical version is about a dozen lines): it is just 2-3 insertion with the split made implicit through three rotations. The cost, paid in delete, is discussed in §6.

---

<a name="contrast234"></a>
## 3. Contrast: 2-3-4 ↔ Standard Red-Black

The 2-3 tree's sibling, the **2-3-4 tree** (B-tree of order 4, nodes holding 1–3 keys; see [`../19-two-three-four-tree/senior.md`](../19-two-three-four-tree/senior.md)), maps onto the *standard* CLRS red-black tree — the one in `std::map`, `TreeMap`, and the Linux kernel ([`../04-red-black/senior.md`](../04-red-black/senior.md)). The correspondence:

- **2-node** ↔ black node.
- **3-node** ↔ black node with **one** red child (which may lean either way — standard RB does not enforce left-leaning).
- **4-node** ↔ black node with **two** red children.

Because the standard red-black tree permits a 4-node encoding (two red children) and lets a 3-node lean either direction, it represents 2-3-4 trees, not 2-3 trees. This is the cleaner mental model for *standard* red-black: top-down 2-3-4 insertion (split 4-nodes on the way down so the parent always has room) is exactly the classic single-pass red-black insertion of Guibas-Sedgewick.

The 2-3 ↔ LLRB pairing and the 2-3-4 ↔ standard-RB pairing are the two canonical bridges between multiway and binary balanced trees. Knowing which B-tree order a given red-black variant encodes tells you immediately how many red children a black node may have, and why.

| Multiway tree | Binary encoding | Red children per black node | Red link direction |
|---|---|---|---|
| 2-3 | LLRB / AA | exactly 0 or 1 | left only (LLRB) / right only (AA) |
| 2-3-4 | standard red-black | 0, 1, or 2 | either |

---

<a name="height"></a>
## 4. Height Bounds and Proofs

Let `n` be the number of keys and `h` the height (number of edges on a root-to-leaf path; all leaves are at depth `h` by the perfect-balance invariant).

**Lower bound on density — minimum keys for a given height.** The sparsest 2-3 tree of height `h` is all 2-nodes: a complete binary tree. It has `2^(h+1) − 1` nodes, each holding 1 key, so

```
n ≥ 2^(h+1) − 1   ⟹   h ≤ log₂(n + 1) − 1.
```

**Upper bound on density — maximum keys for a given height.** The densest 2-3 tree of height `h` is all 3-nodes: each node has 3 children and 2 keys. The number of nodes is `(3^(h+1) − 1)/2`, with 2 keys each, so

```
n ≤ 2 · (3^(h+1) − 1)/2 = 3^(h+1) − 1   ⟹   h ≥ log₃(n + 1) − 1.
```

Combining,

```
log₃(n + 1) − 1   ≤   h   ≤   log₂(n + 1) − 1.
```

The height is `Θ(log n)` with a tight band: between `log₃ n ≈ 0.63 log₂ n` and `log₂ n`. A 2-3 tree is therefore **never more than ~1.58× taller** than a perfectly packed all-3-node tree, and **at most about 0.63× shorter** than the sparsest all-2-node tree. Compare to AVL ([`../03-avl/senior.md`](../03-avl/senior.md)), whose height is bounded by `1.44 log₂(n+2)` — slightly looser at the top than the 2-3 all-2-node case, but in the same constant-factor neighborhood. The key qualitative point: 2-3 trees achieve *perfect* balance (all leaves at identical depth), which AVL and red-black do not — they only bound the *imbalance*.

**Equivalence of the height proof to the LLRB black-height proof.** The black-height of the LLRB encoding equals `h + 1` (each 2-3 edge is a black link). The red links only add at most one extra level between consecutive black links, so the LLRB *total* height is at most `2(h+1)` — the familiar "red-black height ≤ 2 log n" bound, derived here straight from the 2-3 height bound. The 2-3 proof is the *reason* the red-black bound holds.

---

<a name="cost"></a>
## 5. Occupancy, Comparison Counts, Amortized Split/Merge Cost

**Expected occupancy.** Under random insertions a 2-3 tree settles to a mix of 2- and 3-nodes; empirically and analytically, the average node holds roughly **1.5–1.7 keys**, so a tree of `n` keys has on the order of `0.6n–0.7n` internal nodes. This is the same occupancy story as any B-tree of small order: nodes run a bit over half full on average between splits.

**Comparisons per operation.** Search visits `h+1` nodes; within each node it does 1 comparison (2-node) or up to 2 comparisons (3-node) to choose the child. Total key comparisons per search are therefore between `log₃ n` and `2 log₂ n`, with the average close to `~1.5 · h`. This is the crucial *constant-factor* observation: a 2-3 tree does **more comparisons per level** than a binary BST does per node, but it has **fewer levels**. In RAM, where each comparison is a register operation and each pointer-chase is a potential cache miss, the binary encoding (LLRB/AVL) usually wins because it converts the in-node comparisons into ordinary node visits that the branch predictor and cache handle well, and it avoids the variable-arity node layout. On disk, where a level *is* a page fetch, the multiway form wins decisively — which is the entire reason B-trees exist ([`../11-b-tree/senior.md`](../11-b-tree/senior.md)).

**Amortized split/merge cost.** A single insertion can trigger splits cascading from leaf to root: `O(log n)` worst case. But the amortized number of splits per insertion is **`O(1)`** — bounded by a constant under the standard accounting/potential argument (each split consumes the "credit" deposited when a node became a 3-node; the total number of splits over `m` insertions into an initially empty tree is `< m`). The same `O(1)` amortized bound holds for merges/borrows during deletion. This matches the red-black guarantee of `O(1)` amortized rotations per update and is why both structures give predictable update latency.

---

<a name="teaching"></a>
## 6. Why 2-3 Trees Are a Teaching Model, Not a Production Structure

Be precise about this, because it is the senior-level takeaway: **almost no production in-memory system stores a literal 2-3 tree.** The reasons are concrete.

1. **Variable-arity nodes are awkward and waste memory.** A 2-3 node must hold space for two keys and three child pointers even when it is currently a 2-node, or it must be a tagged union that is reshaped on every split/merge. Either way you pay branchy code (`if 2-node … else 3-node …`) on the hottest path. The binary encoding has one uniform node shape and one color bit, which the compiler and CPU handle far better.

2. **Worse constant factors than the binary encoding.** As §5 showed, the comparison count per *level* is higher, the node layout is irregular, and the split/merge logic mutates more pointers per event than a red-black rotation. The LLRB / AA encoding delivers the *identical* asymptotics and the *identical* perfect-black-balance guarantee with a leaner node and simpler hot path. If you want a 2-3 tree's behavior in RAM, you ship its binary encoding — that is exactly what `std::map` and `TreeMap` (2-3-4 ↔ standard RB) and Sedgewick's LLRB (2-3 ↔ LLRB) actually do.

3. **The generalization, not the order-3 special case, is what matters on disk.** When data lives on disk or SSD, you do not pick order 3 — you pick the order that makes a node fill a page (hundreds to thousands of keys). The B-tree/B+ tree *is* the 2-3 tree's idea taken to its useful extreme. So in production the 2-3 tree is dominated from both sides: in RAM by its binary encoding, on disk by its high-order generalization.

The honest framing: the 2-3 tree's value is **pedagogical and theoretical**. It is the cleanest possible explanation of (a) how multiway balancing keeps all leaves level, (b) why red-black trees have the invariants they do, and (c) the unifying bridge between binary balanced BSTs and B-trees. It earns its place in every algorithms course for exactly these reasons — and it is also why Sedgewick teaches LLRB *via* 2-3 trees rather than via the CLRS case analysis. The one genuine production niche is immutable/persistent variants, next.

---

<a name="immutable"></a>
## 7. Bulk Loading, Immutable 2-3 Trees, and 2-3 Finger Trees

**Bulk loading.** To build a 2-3 tree from `n` sorted keys, do **not** insert one at a time (`O(n log n)` with churn). Build bottom-up: pack the sorted keys into leaf nodes (2 or 3 keys each), then repeatedly build the next level by grouping the just-built nodes into parents of arity 2 or 3, choosing the grouping so no level is left with a single orphan. This is `O(n)`, produces a maximally-packed tree, and is identical in spirit to B-tree bulk loading. It is the right way to seed an immutable structure or to rebuild after a mass import.

**Persistent / immutable 2-3 trees.** Here the 2-3 tree genuinely shines. Because every node has bounded arity, **path copying** an update touches only `O(log n)` nodes — copy the root-to-leaf path, splice in the new subtrees, share everything else. The bounded arity keeps the copied nodes small and the fan-out predictable, which is friendlier to a persistent setting than copying a B-tree's wide pages. Several functional languages use balanced trees of exactly this flavor as the backbone of their immutable ordered maps and sets.

**2-3 finger trees.** The most important real use is Hinze and Paterson's **2-3 finger tree** (2006), the data structure behind Haskell's `Data.Sequence` and Scala/Clojure-adjacent immutable sequence libraries. A finger tree is a 2-3 tree turned on its side: it keeps "fingers" (fast-access caches) at both ends, giving **amortized `O(1)`** access, `push`/`pop`, and `cons`/`snoc` at either end, and `O(log n)` `concat` and `split`. The 2-3 structure is what makes the amortized analysis work — the bounded node arity (the "digits" hold 1–4 elements, the spine is a 2-3 tree of measured nodes) gives exactly the right credit invariant for the banker's-method analysis. Annotate the nodes with a monoid (size, max, priority) and the same skeleton yields random-access sequences, priority queues, interval maps, and ropes from one generic structure. This is the 2-3 tree's most consequential appearance in shipping software — not as a search tree, but as the spine of a purely-functional sequence.

---

<a name="concurrency"></a>
## 8. Concurrency Considerations

A mutable 2-3 tree is **hostile to concurrency** for the same reason any balanced BST is: a split or merge can cascade from leaf to root, so a writer may need to hold locks (or a tree-wide latch) along a long path, and the set of nodes affected is not known until the cascade resolves. The disk world solved this for B-trees with **Lehman-Yao right-links and latch-coupling** (see [`../11-b-tree/senior.md`](../11-b-tree/senior.md)), which let searches proceed without locking the descent path; those techniques port to a 2-3 tree but buy you little, because in RAM you would not choose a 2-3 tree anyway.

The pragmatic answers used in practice are two:

- **Immutability.** The persistent 2-3 trees and finger trees of §7 sidestep locking entirely: readers traverse an immutable snapshot, writers produce a new root via path copying, and a single atomic pointer swap publishes the new version. This is the dominant approach in functional runtimes and is the cleanest reason to use a 2-3 structure under concurrency.
- **Pick a different structure.** For a *mutable* concurrent ordered map, the field has standardized on **skip lists** (`ConcurrentSkipListMap`) and lock-free tries (CTrie), which are far easier to make correct than any rebalancing tree. The same advice from the red-black file applies verbatim to 2-3 trees.

---

<a name="go"></a>
## 9. Reference Implementation in Go (search + insert + delete + invariant checker)

A clean, idiomatic mutable 2-3 tree for `int` keys. Insertion uses the "push a split up the recursion" pattern; deletion uses the "underflow propagates up; fix by borrow or merge" pattern. The invariant checker is the real value here — it verifies the three properties that *define* a 2-3 tree and is what you would run in tests.

```go
package twothree

import "fmt"

// node holds 1 or 2 keys (a 2-node or a 3-node).
// children: 2 children for a 2-node, 3 for a 3-node; nil for leaves.
type node struct {
	keys     []int   // len 1 (2-node) or 2 (3-node)
	children []*node // len 0 (leaf), or len(keys)+1 (internal)
}

type Tree struct{ root *node }

func (n *node) leaf() bool { return len(n.children) == 0 }

// ---------- Search ----------

func (t *Tree) Contains(k int) bool { return search(t.root, k) }

func search(n *node, k int) bool {
	if n == nil {
		return false
	}
	for i, key := range n.keys {
		if k == key {
			return true
		}
		if k < key {
			if n.leaf() {
				return false
			}
			return search(n.children[i], k)
		}
	}
	if n.leaf() {
		return false
	}
	return search(n.children[len(n.keys)], k) // greater than all keys
}

// ---------- Insert ----------

// insert returns a split as (promoted key, right sibling) when the subtree
// overflowed into a transient 4-node; (_, nil) means "absorbed, no split".
func (t *Tree) Insert(k int) {
	if t.root == nil {
		t.root = &node{keys: []int{k}}
		return
	}
	promoted, right, grew := insert(t.root, k)
	if grew { // root split: build a new 2-node root one level taller
		t.root = &node{keys: []int{promoted}, children: []*node{t.root, right}}
	}
}

func insert(n *node, k int) (int, *node, bool) {
	// locate child index / detect duplicate
	i := 0
	for i < len(n.keys) {
		if k == n.keys[i] {
			return 0, nil, false // already present
		}
		if k < n.keys[i] {
			break
		}
		i++
	}
	if n.leaf() {
		n.keys = insertKeyAt(n.keys, i, k)
	} else {
		pk, right, grew := insert(n.children[i], k)
		if !grew {
			return 0, nil, false
		}
		n.keys = insertKeyAt(n.keys, i, pk)
		n.children = insertChildAt(n.children, i+1, right)
	}
	if len(n.keys) <= 2 {
		return 0, nil, false // still a valid 2- or 3-node
	}
	return splitFour(n) // transient 4-node -> promote middle, return right half
}

// splitFour turns an overflowed node (3 keys, optionally 4 children) into a
// left 2-node, a promoted middle key, and a right 2-node.
func splitFour(n *node) (int, *node, bool) {
	mid := n.keys[1]
	left := &node{keys: []int{n.keys[0]}}
	right := &node{keys: []int{n.keys[2]}}
	if !n.leaf() {
		left.children = []*node{n.children[0], n.children[1]}
		right.children = []*node{n.children[2], n.children[3]}
	}
	*n = *left // n becomes the left half in place
	return mid, right, true
}

// ---------- Delete ----------

func (t *Tree) Delete(k int) {
	if t.root == nil {
		return
	}
	del(t.root, k)
	// shrink height: a non-leaf root with no keys hands its only child up.
	if len(t.root.keys) == 0 {
		if t.root.leaf() {
			t.root = nil
		} else {
			t.root = t.root.children[0]
		}
	}
}

// del removes k from the subtree at n; underflow (a node left with 0 keys)
// is repaired by the parent via fixUnderflow after the recursive call.
func del(n *node, k int) {
	i := 0
	for i < len(n.keys) && k > n.keys[i] {
		i++
	}
	switch {
	case i < len(n.keys) && n.keys[i] == k && n.leaf():
		n.keys = removeKeyAt(n.keys, i) // simple leaf removal
	case i < len(n.keys) && n.keys[i] == k:
		// internal: replace with in-order predecessor, then delete that
		pred := maxKey(n.children[i])
		n.keys[i] = pred
		del(n.children[i], pred)
		fixUnderflow(n, i)
	case !n.leaf():
		del(n.children[i], k)
		fixUnderflow(n, i)
	}
}

func maxKey(n *node) int {
	for !n.leaf() {
		n = n.children[len(n.children)-1]
	}
	return n.keys[len(n.keys)-1]
}

// fixUnderflow repairs child c=children[i] if it has 0 keys, by borrowing
// from a 3-node sibling (rotation) or merging with a 2-node sibling.
func fixUnderflow(n *node, i int) {
	c := n.children[i]
	if len(c.keys) > 0 {
		return
	}
	// try borrow from left sibling
	if i > 0 && len(n.children[i-1].keys) == 2 {
		l := n.children[i-1]
		c.keys = []int{n.keys[i-1]}
		n.keys[i-1] = l.keys[1]
		l.keys = l.keys[:1]
		if !l.leaf() {
			c.children = append([]*node{l.children[2]}, c.children...)
			l.children = l.children[:2]
		}
		return
	}
	// try borrow from right sibling
	if i < len(n.keys) && len(n.children[i+1].keys) == 2 {
		r := n.children[i+1]
		c.keys = []int{n.keys[i]}
		n.keys[i] = r.keys[0]
		r.keys = r.keys[1:]
		if !r.leaf() {
			c.children = append(c.children, r.children[0])
			r.children = r.children[1:]
		}
		return
	}
	// merge with a sibling (both are 2-nodes-becoming-empty -> pull parent key down)
	if i > 0 {
		merge(n, i-1)
	} else {
		merge(n, i)
	}
}

// merge fuses children[i] and children[i+1] around separator keys[i].
func merge(n *node, i int) {
	l, r := n.children[i], n.children[i+1]
	l.keys = append(l.keys, n.keys[i])
	l.keys = append(l.keys, r.keys...)
	l.children = append(l.children, r.children...)
	n.keys = removeKeyAt(n.keys, i)
	n.children = append(n.children[:i+1], n.children[i+2:]...)
}

// ---------- Invariant checker (the heart of any test suite) ----------

// Check verifies: (1) key counts ∈ {1,2}; (2) child count == keys+1 for
// internal nodes; (3) keys sorted and respecting child key ranges;
// (4) all leaves at equal depth. Returns an error describing the first
// violation, or nil.
func (t *Tree) Check() error {
	if t.root == nil {
		return nil
	}
	_, err := checkNode(t.root, nil, nil)
	return err
}

func checkNode(n *node, lo, hi *int) (depth int, err error) {
	if len(n.keys) < 1 || len(n.keys) > 2 {
		return 0, fmt.Errorf("node has %d keys (must be 1 or 2)", len(n.keys))
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
		return 0, fmt.Errorf("internal node has %d keys but %d children",
			len(n.keys), len(n.children))
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

**Correctness argument.** Insertion preserves the invariant by structural induction: a key is only ever added to a leaf, and the only way a node can grow to three keys is the transient 4-node, which `splitFour` immediately decomposes into two valid 2-nodes plus a promoted key. The promotion is the *only* event that can increase height, and it does so uniformly by lifting through a brand-new root — so all leaves stay at equal depth. Deletion preserves the invariant symmetrically: a deleted internal key is swapped for its leaf predecessor so the actual removal always happens at a leaf; the only invariant-breaking outcome is a node left with zero keys, which `fixUnderflow` resolves by borrowing (a rotation that moves one key through the parent, leaving both nodes valid) or merging (pulling the parent separator down, which may itself underflow the parent and propagate the repair upward). Height decreases only when the root is emptied and hands its single child up — again uniformly. Every public operation is `O(log n)` worst case and `O(1)` amortized in splits/merges (§5). Run `Check()` after every operation in a randomized/property test (`../03-avl/` style) and the structure is self-verifying.

---

<a name="haskell"></a>
## 10. A Second Core in Haskell

The immutable view is most natural in a functional language. This insert returns either a node that absorbed the key or a split to be handled one level up — the same `(promoted, right)` protocol as the Go version, expressed as an algebraic type. It is purely persistent: every `insert` shares all untouched subtrees.

```haskell
data Tree a = Nil
            | Two   (Tree a) a (Tree a)
            | Three (Tree a) a (Tree a) a (Tree a)

-- A subtree either grew in place, or split into (left, midKey, right).
data Grown a = Stay (Tree a) | Split (Tree a) a (Tree a)

insert :: Ord a => a -> Tree a -> Tree a
insert x t = case ins x t of
  Stay t'        -> t'
  Split l m r    -> Two l m r           -- root split: new level

ins :: Ord a => a -> Tree a -> Grown a
ins x Nil = Split Nil x Nil              -- handled by parent into a 2-/3-node
ins x t@(Two l a r)
  | x == a    = Stay t
  | x <  a    = up (ins x l) (\l' -> Two l' a r) (\ll m lr -> Three ll m lr a r)
  | otherwise = up (ins x r) (\r' -> Two l a r') (\rl m rr -> Three l a rl m rr)
ins x t@(Three l a m b r)
  | x == a || x == b = Stay t
  | x <  a = up (ins x l)
               (\l' -> Three l' a m b r)
               (\ll k lr -> Split (Two ll k lr) a (Two m b r))
  | x <  b = up (ins x m)
               (\m' -> Three l a m' b r)
               (\ml k mr -> Split (Two l a ml) k (Two mr b r))
  | otherwise = up (ins x r)
               (\r' -> Three l a m b r')
               (\rl k rr -> Split (Two l a m) b (Two rl k rr))

-- 'up' threads a child's Grown result: either rebuild in place, or absorb its split.
up :: Grown a -> (Tree a -> Tree a) -> (Tree a -> a -> Tree a -> Grown a) -> Grown a
up (Stay t)        keep _       = Stay (keep t)
up (Split l m r)   _    absorb  = absorb l m r
```

The `Three`-node-with-split branches *are* the 2-3 split rule written as pattern matches, and the `Two`/`Three` constructors make the at-most-two-keys invariant unrepresentable-by-construction — a benefit the type system gives you that the Go version must enforce at runtime via `Check()`. This skeleton, annotated with a monoid on the keys, is the same shape that grows into a finger tree (§7).

---

<a name="decision"></a>
## 11. When to Reach for 2-3 vs B-tree vs Red-Black vs AVL

A practical decision framework. The honest top-line answer is that you rarely reach for a *literal mutable 2-3 tree*; you reach for one of its relatives.

- **Data on disk or SSD, or much larger than cache?** → **B-tree / B+ tree.** The 2-3 tree is just the order-3 special case; in storage you want the order that fills a page. Everything in [`../11-b-tree/senior.md`](../11-b-tree/senior.md) applies. Do not use order 3.
- **Mutable in-memory ordered map/set, general purpose?** → **Red-black tree** (standard, i.e. 2-3-4 encoding) — the library default in `std::map`, `TreeMap`, the Linux kernel. Best "good at everything" balance of update and lookup cost. See [`../04-red-black/senior.md`](../04-red-black/senior.md).
- **In-memory, read-heavy, lookups dominate updates?** → **AVL.** Its tighter height (`≤ 1.44 log n`) saves a comparison or two per search at the cost of more rotations on update. See [`../03-avl/senior.md`](../03-avl/senior.md).
- **You want a red-black tree but with the *simplest possible code*?** → **LLRB or AA** — i.e., the 2-3 tree *encoded* in binary. Choose this when implementation clarity and provable correctness matter more than shaving the last few percent (Sedgewick's argument for teaching and for many production uses). Note LLRB delete is famously fiddly; weigh that.
- **Immutable / persistent ordered collection, or a functional sequence with fast ends + split/concat?** → **2-3 tree / 2-3 finger tree.** This is the one place the literal 2-3 structure is the *right production choice*: bounded arity makes path copying cheap and the finger-tree amortized analysis clean (Haskell `Data.Sequence`, functional `Map`/`Set` libraries).
- **You need to *teach or reason about* why balanced search works, or derive red-black invariants from first principles?** → **The 2-3 tree itself.** This is its highest-value role: the conceptual parent of the entire red-black family and the bridge to B-trees.
- **Concurrent mutable ordered map?** → **Not a 2-3 tree.** Use a skip list or lock-free trie; or go immutable and publish new roots by atomic swap (§8).

The unifying thought: the 2-3 tree is less a structure you deploy than the *idea* that explains the structures you do deploy. Red-black is its binary projection for RAM; the B-tree is its high-order generalization for disk; the finger tree is its immutable sideways form for sequences. Understanding the 2-3 tree deeply is what lets you see those three as one family.

---

<a name="reading"></a>
## 12. Reading List

- **Sedgewick, R.** (2008). *Left-Leaning Red-Black Trees.* The paper that makes the 2-3 ↔ LLRB correspondence explicit; pairs with the *Algorithms, 4th ed.* (Sedgewick & Wayne) chapter on balanced search trees.
- **Guibas, L. J., & Sedgewick, R.** (1978). *A Dichromatic Framework for Balanced Trees.* FOCS. The original red-black paper — red-black trees introduced precisely as a binary encoding of 2-3 and 2-3-4 trees.
- **Andersson, A.** (1993). *Balanced Search Trees Made Simple.* WADS. The AA-tree: 2-3 trees via `level`, `skew`, and `split`.
- **Aho, Hopcroft, & Ullman.** *The Design and Analysis of Computer Algorithms.* The classic textbook treatment of 2-3 trees and their `O(log n)` operations.
- **Hinze, R., & Paterson, R.** (2006). *Finger Trees: A Simple General-Purpose Data Structure.* JFP. The 2-3 finger tree behind Haskell's `Data.Sequence` — the structure's most consequential production appearance.
- **Okasaki, C.** *Purely Functional Data Structures.* Persistent balanced trees and the path-copying technique that makes immutable 2-3 trees practical.
- **Cormen, Leiserson, Rivest, & Stein.** *Introduction to Algorithms*, 3rd/4th ed. The red-black and B-tree chapters; read alongside this file to see the 2-3-4 ↔ standard-RB bridge of §3.
```
