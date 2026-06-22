# 2-3-4 Tree — Middle Level

> **Audience:** Engineers who have read `junior.md` and can already do a 2-3-4 tree search and the **top-down insertion** that preemptively splits full 4-nodes on the way down. Prerequisite: `./junior.md`.

The junior level taught the elegant half of the story: **top-down insertion**. Because a 2-3-4 node may hold up to 3 keys, the only thing that can go wrong on insert is hitting a *full* node (a 4-node) that has no room for one more key. Top-down insertion makes that impossible *in advance* — on the way down, every full 4-node you pass through is split eagerly, so by the time you reach the target leaf there is always a free slot and the split never has to cascade back up.

This document gives the harder, symmetric half: **top-down deletion**. Where insertion proactively splits *full* nodes on the way down so an insert can never overflow, deletion proactively *fattens* thin nodes on the way down — it guarantees the node it is about to descend into has at least 2 keys (is not a bare 2-node) — so that when it reaches the key's leaf, removing it can never cause underflow. The repair always happens *above* where the problem would occur, exactly mirroring insertion. The reward is that, like top-down insertion, top-down deletion is a **single downward pass with no fix-up walk**.

We cover the full deletion algorithm with worked, ASCII-diagrammed cases (borrow-left, borrow-right, fuse, root collapse), complete and *traced* implementations of top-down insert + delete in Go and Java (Python optional), the complexity and invariant checklist, the edge cases that break naive code, the **red-black correspondence in action** (a 4-node split *is* a color flip), and a contrast with 2-3 tree deletion.

---

## Table of Contents

1. [Invariants and Top-Down Insertion Recap](#recap)
2. [Why Deletion Mirrors Insertion](#why-mirror)
3. [The Top-Down Deletion Invariant](#invariant)
4. [The Three Enrichment Moves: Borrow-Left, Borrow-Right, Fuse](#moves)
5. [Reducing an Internal Key to a Leaf](#internal)
6. [Worked Deletion Cases (ASCII)](#cases)
7. [Complete Implementation — Go](#go)
8. [Complete Implementation — Java](#java)
9. [Python (Optional, Compact)](#python)
10. [Bottom-Up Deletion — The Simpler Alternative](#bottom-up)
11. [Complexity and Invariant Checklist](#complexity)
12. [Edge Cases](#edge-cases)
13. [The Red-Black Correspondence in Action](#redblack)
14. [Contrast with 2-3 Tree Deletion](#two-three)
15. [Common Pitfalls](#pitfalls)
16. [Summary](#summary)

---

<a name="recap"></a>
## 1. Invariants and Top-Down Insertion Recap

A 2-3-4 tree is a **B-tree of order 4**. Every node is one of:

- **2-node:** 1 key, 2 children.
- **3-node:** 2 keys `a < b`, 3 children (`< a`, between, `> b`).
- **4-node:** 3 keys `a < b < c`, 4 children.

The invariants every operation must preserve:

1. **Key order.** Keys within a node are sorted; the BST ordering holds across children.
2. **Node arity.** Every node holds 1, 2, or 3 keys. A node with 0 keys (an *empty node* / hole) and a node with 4 keys (an *overfull* 5-node) are both transient states that must not survive a completed operation.
3. **Perfect balance.** **All leaves are at exactly the same depth.** This is the property that makes the tree `O(log n)` without per-node rotation bookkeeping. Insertion protects it by growing only at the root; deletion protects it by shrinking only at the root.
4. **Childcount = keycount + 1** for every internal node. Leaves have no children.

### Top-down insertion (recap)

Insertion descends from the root toward the target leaf. **At each node — including the root — if the node is a full 4-node, split it before descending into it.** Splitting a 4-node `[a|b|c]` promotes the median `b` into the parent (which is guaranteed to have room, because we already split it on the way down if it was full) and leaves two 2-nodes `[a]` and `[c]`:

```
       parent has room              parent absorbs b
   ┌─────────────────┐          ┌─────────────────────┐
        [ … ]                          [ … b … ]
          |                            /         \
      [a | b | c]          →        [a]           [c]
     /   |   |   \                 /  \           /  \
```

By the time the descent reaches the leaf, that leaf is **not full** (we just guaranteed it, or it was already a 2-/3-node), so the new key drops in with a simple in-place insert. No fix-up walk, no cascade. The only place height grows is splitting a full *root*, which raises a brand-new single-key root and pushes every leaf down by one level together.

Deletion is the mirror image of this idea, and it is what the rest of this file is about.

---

<a name="why-mirror"></a>
## 2. Why Deletion Mirrors Insertion

Top-down insertion works because of one guarantee: **never descend into a full node.** If the node below could be full, a split there might cascade upward — so we eliminate the possibility *before* descending. The split happens at a node that is guaranteed to have a non-full parent, so it resolves locally.

Top-down deletion is built on the symmetric guarantee: **never descend into a minimal node.** A *minimal* node is a 2-node (1 key) — the thinnest legal node. If we removed a key from inside a subtree rooted at a 2-node and it underflowed, the empty hole might cascade upward. So we eliminate the possibility *before* descending: on the way down, whenever we are about to step into a child that is a 2-node, we first **enrich** it to a 3-node or 4-node by borrowing a key from a sibling or fusing with one. Then it is safe to descend.

The payoff is identical to insertion. By the time the descent reaches the leaf holding the target key, that leaf has **at least 2 keys**, so removing one leaves it a legal node (≥1 key). No underflow, no upward cascade, no fix-up walk — one clean downward pass.

| | Top-down insertion | Top-down deletion |
|---|---|---|
| Forbidden state below | a **full** node (4-node) | a **minimal** node (2-node) |
| Preemptive move | **split** full nodes | **enrich** minimal nodes (borrow or fuse) |
| Guarantee at the leaf | leaf has a free slot | leaf has a key to spare |
| Height change | grows by splitting a full root | shrinks by emptying the root via a fuse |
| Pass count | single downward pass | single downward pass |

---

<a name="invariant"></a>
## 3. The Top-Down Deletion Invariant

State it precisely, because the whole algorithm is just enforcing it:

> **Invariant:** When deletion descends from a node `n` into its child `c`, `c` must have **at least 2 keys** (be a 3-node or 4-node), *unless* `c` is the root of the whole tree.

The root is exempt because it has no parent and no siblings to borrow from; a root that is a 2-node is perfectly legal. (We will handle the special root case explicitly below.)

To enforce the invariant at each step: before stepping into child `c` at index `i` of node `n`, check `c`'s key count. If `c` already has ≥ 2 keys, descend immediately. If `c` is a 2-node, **enrich it first** using one of three moves, then descend.

There is a subtlety with the node we will actually delete *from*. We must enforce the invariant for the child we descend into; but the key we are deleting may live in `n` itself (an internal hit) rather than below it. We handle that by reducing internal hits to leaf deletions (Section 5) — but crucially we do the reduction *as part of the same downward pass*, so the invariant still holds for whatever child we ultimately step into.

---

<a name="moves"></a>
## 4. The Three Enrichment Moves: Borrow-Left, Borrow-Right, Fuse

Suppose we are at parent `n` and about to descend into child `c = n.children[i]`, and `c` is a 2-node. Let `L = n.children[i-1]` and `R = n.children[i+1]` be `c`'s immediate siblings (when they exist). There are exactly three ways to give `c` more keys.

### Move 1 — Borrow from the right sibling (`R` has ≥ 2 keys)

Rotate one key counter-clockwise through the parent. The separator `n.keys[i]` (between `c` and `R`) moves **down** into `c` as a new largest key; `R`'s **smallest** key moves **up** to fill `n.keys[i]`; and `R`'s leftmost child (if internal) transfers to `c` as its new rightmost child.

```
        [ … s … ]                      [ … s' … ]
        /       \                       /        \
     [c]      [s'| … ]      →     [c | s]      [ … ]
```

After: `c` is a 3-node, `R` lost one key but is still ≥ a 2-node, `n`'s arity is unchanged.

### Move 2 — Borrow from the left sibling (`L` has ≥ 2 keys)

The mirror image. The separator `n.keys[i-1]` (between `L` and `c`) moves **down** into `c` as a new smallest key; `L`'s **largest** key moves **up** to fill `n.keys[i-1]`; and `L`'s rightmost child (if internal) transfers to `c` as its new leftmost child.

```
        [ … s … ]                      [ … s' … ]
        /       \                       /        \
   [ … |s']     [c]      →           [ … ]     [s | c]
```

### Move 3 — Fuse (both siblings are 2-nodes, or only one sibling exists and it is a 2-node)

If no immediate sibling has a spare key, we cannot rotate. Instead **fuse** `c` with one sibling and the separator between them into a single 4-node. Pick the left sibling if it exists, otherwise the right. Pull the separator `n.keys[j]` **down** and concatenate `L + separator + c` (or `c + separator + R`) into one node, absorbing both child lists.

```
        [ … s … ]                 [ … ]            (n loses key s and one child)
        /       \           →       |
     [p]        [c]              [p | s | c]       (a fresh 4-node)
```

Fusing pulls a key *out of the parent*, so it reduces the parent's key count by one. Because top-down deletion already guaranteed the parent (the node we are standing on) has ≥ 2 keys before we got here — except at the root — the parent survives the loss. **This is why the cascade never happens:** we only ever fuse out of a node we have already fattened.

The one place this reasoning bottoms out is the root.

### The root-collapse case (height shrinks)

If `n` is the **root**, it is allowed to be a 2-node. If we fuse its only two children around its only key, the root loses that key and becomes **empty**. We then **delete the empty root and promote the freshly fused 4-node as the new root.** This is the *only* place a 2-3-4 tree loses height — the exact mirror of insertion splitting a full root to gain height. All leaves rise by one level together, preserving perfect balance.

### Decision summary

```
about to descend into child c (a 2-node), parent n, siblings L,R:
    right sibling R has ≥ 2 keys? ──────────► BORROW-RIGHT, descend into c
    left  sibling L has ≥ 2 keys? ──────────► BORROW-LEFT,  descend into c
    both siblings are 2-nodes? ─────────────► FUSE c with a sibling
            n was the root with 1 key? ─────► fused node becomes new root, height−1
            otherwise (n had ≥ 2 keys) ─────► n survives; descend into the fused node
```

---

<a name="internal"></a>
## 5. Reducing an Internal Key to a Leaf

If the target key sits in an **internal** node, we cannot just remove it — an internal key is a *separator* between two children, and deleting it would leave a node with one too few separators for its children.

The fix is the same as in any B-tree. When we find the key at index `i` of an internal node `n`, replace it with its **in-order predecessor** (the largest key in the subtree `n.children[i]`) or **in-order successor** (the smallest key in `n.children[i+1]`), both of which live in a **leaf**, then recursively delete *that* key from the corresponding subtree. The recursive deletion will be a leaf deletion, and the top-down invariant ensures that subtree's root is already fat enough to descend into safely.

```
Delete 50, an internal separator:

        [30 | 50 | 80]
       /    |    |    \
   […]   […]  [60|70]  […]

In-order successor of 50 = 60 (smallest key right of 50).
Copy 60 up into the 50 slot, then delete 60 from the right subtree:

        [30 | 60 | 80]
       /    |    |    \
   […]   […]  [   70]  […]      <- delete 60 from this subtree (now a leaf op)
```

A clean implementation makes a uniform choice: before descending into the child that owns the predecessor/successor, enforce the top-down invariant on *that* child too, so the leaf we eventually strip from always has a key to spare.

---

<a name="cases"></a>
## 6. Worked Deletion Cases (ASCII)

Throughout: `[k]` is a 2-node, `[a|b]` a 3-node, `[a|b|c]` a 4-node, `[ ]` an empty node.

### Case A — Borrow from the right sibling

```
Delete 10. We descend toward the left leaf, which is a 2-node [10].
Its right sibling [50|70|90] has spare keys.

        [30]
       /    \
    [10]   [50|70|90]

Before descending into [10], enrich it: separator 30 rotates DOWN into [10];
the right sibling's smallest key 50 rotates UP into the parent slot.

        [50]
       /    \
   [10|30]  [70|90]

Now [10|30] has 2 keys — safe to enter — and we remove 10:

        [50]
       /    \
    [30]   [70|90]            DONE in one downward pass.
```

### Case B — Borrow from the left sibling

```
Delete 90. We descend toward the right leaf, a 2-node [90].
Its left sibling [20|40|60] has spare keys.

        [70]
       /    \
   [20|40|60]  [90]

Enrich [90]: separator 70 rotates DOWN into [90] as its smallest key;
the left sibling's largest key 60 rotates UP into the parent slot.

        [60]
       /    \
   [20|40]  [70|90]

Now remove 90 from the fat right leaf:

        [60]
       /    \
   [20|40]  [70]            DONE.
```

### Case C — Fuse, parent survives

```
Delete 10. The left leaf [10] is a 2-node; BOTH siblings are 2-nodes,
but the parent [30|70] has a spare key.

        [30 | 70]
       /    |    \
    [10]  [50]   [90]

No borrow possible. Fuse [10] with its right sibling [50] around separator 30:
pull 30 DOWN, build [10|30|50]. Parent [30|70] loses 30 and one child.

        [70]
       /    \
   [10|30|50]  [90]

Now descend into the fat fused node and remove 10:

        [70]
       /    \
   [30|50]  [90]            parent survived (it was a 3-node). DONE.
```

### Case D — Fuse at a 2-node root (height shrinks)

```
Delete 10. The root is a 2-node and so is the child we must enter.

           [30]
          /    \
       [20]    [50]
       /  \    /  \
    [10][25][40][60]

Descend toward [10]. First enforce the invariant on the root's child [20],
a 2-node. Its sibling [50] is also a 2-node, and the parent is the ROOT
with only 1 key → fuse [20] + 30 + [50] into a 4-node and collapse the root:

         [20 | 30 | 50]         <- new root, height dropped from 3 to 2
        /    |    |    \
    [10]  [25]  [40]   [60]

Continue the descent into [20|30|50]'s leftmost child [10], a 2-node.
Borrow / fuse as needed among its new siblings — here [25] is a 2-node and the
parent now has spare keys, so fuse [10]+20+[25]:

         [30 | 50]
        /    |    \
   [10|20|25][40] [60]

Now remove 10 from the fat leaf:

         [30 | 50]
        /    |    \
   [20|25]  [40]  [60]       all leaves at equal depth. DONE.
```

Case D is the canonical demonstration that **top-down deletion changes height only by collapsing the root**, and it does so *on the way down* — there is no separate fix-up pass.

---

<a name="go"></a>
## 7. Complete Implementation — Go

A node stores up to 3 keys and up to 4 children. We keep both top-down insert and top-down delete. The delete routine threads an explicit `(parent, indexInParent)` so it can enrich a 2-node child before descending.

```go
package twothreefour

// Node holds 1..3 keys (transiently 0 or 4) and keycount+1 children.
type Node struct {
	keys     []int
	children []*Node
}

type Tree struct {
	root *Node
}

func (n *Node) isLeaf() bool  { return len(n.children) == 0 }
func (n *Node) isFull() bool  { return len(n.keys) == 3 }
func (n *Node) isMinimal() bool { return len(n.keys) == 1 }

// ---------- SEARCH ----------

func (t *Tree) Contains(key int) bool {
	n := t.root
	for n != nil {
		i := 0
		for i < len(n.keys) && key > n.keys[i] {
			i++
		}
		if i < len(n.keys) && key == n.keys[i] {
			return true
		}
		if n.isLeaf() {
			return false
		}
		n = n.children[i]
	}
	return false
}

// ---------- TOP-DOWN INSERT ----------

func (t *Tree) Insert(key int) {
	if t.root == nil {
		t.root = &Node{keys: []int{key}}
		return
	}
	// Split a full root first so the descent always has a non-full parent.
	if t.root.isFull() {
		newRoot := &Node{children: []*Node{t.root}}
		splitChild(newRoot, 0)
		t.root = newRoot
	}
	insertNonFull(t.root, key)
}

// splitChild splits the full child at index i of n (n is guaranteed non-full).
// The median moves up into n; the child becomes two 2-nodes.
func splitChild(n *Node, i int) {
	full := n.children[i]
	median := full.keys[1]
	left := &Node{keys: []int{full.keys[0]}}
	right := &Node{keys: []int{full.keys[2]}}
	if !full.isLeaf() {
		left.children = []*Node{full.children[0], full.children[1]}
		right.children = []*Node{full.children[2], full.children[3]}
	}
	n.keys = insertIntAt(n.keys, i, median)
	n.children[i] = left
	n.children = insertNodeAt(n.children, i+1, right)
}

// insertNonFull assumes n is NOT full, so there is always room here.
func insertNonFull(n *Node, key int) {
	i := 0
	for i < len(n.keys) && key > n.keys[i] {
		i++
	}
	if i < len(n.keys) && key == n.keys[i] {
		return // duplicate
	}
	if n.isLeaf() {
		n.keys = insertIntAt(n.keys, i, key)
		return
	}
	if n.children[i].isFull() {
		splitChild(n, i)
		// The promoted median now sits at n.keys[i]; pick the correct side.
		if key > n.keys[i] {
			i++
		} else if key == n.keys[i] {
			return
		}
	}
	insertNonFull(n.children[i], key)
}

// ---------- TOP-DOWN DELETE ----------

func (t *Tree) Delete(key int) {
	if t.root == nil {
		return
	}
	del(t.root, key)
	// If the root was emptied by a fuse, promote its single child (or nil out).
	if len(t.root.keys) == 0 {
		if t.root.isLeaf() {
			t.root = nil
		} else {
			t.root = t.root.children[0]
		}
	}
}

// del removes key from the subtree rooted at n, assuming n already has ≥ 2 keys
// OR n is the root. Before descending into any child, del enriches that child to
// ≥ 2 keys, so underflow can never propagate upward.
func del(n *Node, key int) {
	i := 0
	for i < len(n.keys) && key > n.keys[i] {
		i++
	}
	found := i < len(n.keys) && key == n.keys[i]

	if n.isLeaf() {
		if found {
			n.keys = removeIntAt(n.keys, i) // n had ≥ 2 keys, so ≥ 1 remains
		}
		return
	}

	if found {
		// Internal hit: replace with in-order predecessor from the left subtree.
		// Make sure the left child is fat enough to give one up safely.
		ensureFat(n, i)
		// After ensureFat, the key may have moved or merged; re-resolve.
		if i < len(n.keys) && n.keys[i] == key {
			pred := maxNode(n.children[i])
			predKey := pred.keys[len(pred.keys)-1]
			n.keys[i] = predKey
			del(n.children[i], predKey)
		} else {
			// A fuse pulled keys[i] down into children[i]; delete from there.
			del(n.children[i], key)
		}
		return
	}

	// Not found here: enrich the child we are about to enter, then descend.
	// ensureFat may fuse, which can shift the target child index.
	idx := ensureFat(n, i)
	del(n.children[idx], key)
}

// maxNode walks to the rightmost leaf of a subtree.
func maxNode(n *Node) *Node {
	for !n.isLeaf() {
		n = n.children[len(n.children)-1]
	}
	return n
}

// ensureFat guarantees children[i] has ≥ 2 keys, by borrowing or fusing.
// It returns the index at which the (possibly fused) target child now lives.
func ensureFat(n *Node, i int) int {
	if len(n.children[i].keys) >= 2 {
		return i // already fat
	}
	// Borrow from RIGHT sibling if it has a spare key.
	if i < len(n.children)-1 && len(n.children[i+1].keys) >= 2 {
		child := n.children[i]
		right := n.children[i+1]
		child.keys = append(child.keys, n.keys[i]) // separator down
		n.keys[i] = right.keys[0]                   // sibling min up
		right.keys = right.keys[1:]
		if !right.isLeaf() {
			child.children = append(child.children, right.children[0])
			right.children = right.children[1:]
		}
		return i
	}
	// Borrow from LEFT sibling if it has a spare key.
	if i > 0 && len(n.children[i-1].keys) >= 2 {
		child := n.children[i]
		left := n.children[i-1]
		child.keys = append([]int{n.keys[i-1]}, child.keys...) // separator down
		last := len(left.keys) - 1
		n.keys[i-1] = left.keys[last] // sibling max up
		left.keys = left.keys[:last]
		if !left.isLeaf() {
			lc := len(left.children) - 1
			child.children = append([]*Node{left.children[lc]}, child.children...)
			left.children = left.children[:lc]
		}
		return i
	}
	// No spare sibling: FUSE. Prefer fusing with the left sibling.
	if i > 0 {
		fuse(n, i-1) // fuse children[i-1] and children[i] around keys[i-1]
		return i - 1
	}
	fuse(n, i) // leftmost child: fuse children[0] and children[1] around keys[0]
	return 0
}

// fuse merges children[i] and children[i+1] around separator keys[i] into one
// node (a 4-node when both inputs are 2-nodes). The parent loses one key.
func fuse(n *Node, i int) {
	left := n.children[i]
	right := n.children[i+1]
	left.keys = append(left.keys, n.keys[i])      // pull separator down
	left.keys = append(left.keys, right.keys...)  // absorb right's keys
	left.children = append(left.children, right.children...)
	n.keys = removeIntAt(n.keys, i)
	n.children = removeNodeAt(n.children, i+1)
}

// ---------- slice helpers ----------

func insertIntAt(s []int, i, v int) []int {
	s = append(s, 0)
	copy(s[i+1:], s[i:])
	s[i] = v
	return s
}
func removeIntAt(s []int, i int) []int { return append(s[:i], s[i+1:]...) }

func insertNodeAt(s []*Node, i int, v *Node) []*Node {
	s = append(s, nil)
	copy(s[i+1:], s[i:])
	s[i] = v
	return s
}
func removeNodeAt(s []*Node, i int) []*Node { return append(s[:i], s[i+1:]...) }
```

### Tracing the Go delete

Run **Case D** (`Delete(10)` on the all-2-node tree of height 3) against the code:

1. `del(root[30], 10)`: `10 < 30`, so `i = 0`. Not found here. Call `ensureFat(root, 0)`. Child `[20]` is a 2-node; its right sibling `[50]` is also a 2-node; `i == 0`, so `fuse(root, 0)`: pull `30` down, build `[20|30|50]`. The root loses its only key → becomes empty (transiently). `ensureFat` returns index `0`.
2. `del([20|30|50], 10)` (the fused node): `10 < 20`, `i = 0`. Not found. `ensureFat(node, 0)`: child `[10]` is a 2-node, right sibling `[25]` is a 2-node, `i == 0` → `fuse(node, 0)`: pull `20` down → `[10|20|25]`. Parent goes from `[20|30|50]` to `[30|50]` (still ≥ 2 keys, fine). Returns index `0`.
3. `del([10|20|25], 10)`: leaf, found at `i = 0`, `removeIntAt` → `[20|25]`. The leaf had 3 keys, so 2 remain. Return.
4. Back in `Delete`: `len(root.keys) == 0` (the root was emptied in step 1) and the root is internal → `t.root = root.children[0]` = the `[30|50]` node. Height is now 2.

Final tree:

```
         [30 | 50]
        /    |    \
   [20|25]  [40]  [60]
```

This matches the Case D diagram exactly. The crucial observation: the root collapsed **on the way down** (step 1), not in a fix-up pass.

---

<a name="java"></a>
## 8. Complete Implementation — Java

The same algorithm, idiomatic Java with `ArrayList`s.

```java
import java.util.ArrayList;
import java.util.List;

public class TwoThreeFourTree {

    static final class Node {
        List<Integer> keys = new ArrayList<>();   // 1..3 (0..4 transiently)
        List<Node> children = new ArrayList<>();  // keys.size()+1, empty for leaves
        boolean isLeaf()    { return children.isEmpty(); }
        boolean isFull()    { return keys.size() == 3; }
    }

    private Node root;

    // ---------- SEARCH ----------
    public boolean contains(int key) {
        Node n = root;
        while (n != null) {
            int i = 0;
            while (i < n.keys.size() && key > n.keys.get(i)) i++;
            if (i < n.keys.size() && key == n.keys.get(i)) return true;
            if (n.isLeaf()) return false;
            n = n.children.get(i);
        }
        return false;
    }

    // ---------- TOP-DOWN INSERT ----------
    public void insert(int key) {
        if (root == null) { root = leaf(key); return; }
        if (root.isFull()) {
            Node nr = new Node();
            nr.children.add(root);
            splitChild(nr, 0);
            root = nr;
        }
        insertNonFull(root, key);
    }

    private static Node leaf(int key) { Node n = new Node(); n.keys.add(key); return n; }

    private void splitChild(Node n, int i) {
        Node full = n.children.get(i);
        int median = full.keys.get(1);
        Node left = new Node();  left.keys.add(full.keys.get(0));
        Node right = new Node(); right.keys.add(full.keys.get(2));
        if (!full.isLeaf()) {
            left.children.add(full.children.get(0));
            left.children.add(full.children.get(1));
            right.children.add(full.children.get(2));
            right.children.add(full.children.get(3));
        }
        n.keys.add(i, median);
        n.children.set(i, left);
        n.children.add(i + 1, right);
    }

    private void insertNonFull(Node n, int key) {
        int i = 0;
        while (i < n.keys.size() && key > n.keys.get(i)) i++;
        if (i < n.keys.size() && key == n.keys.get(i)) return; // duplicate
        if (n.isLeaf()) { n.keys.add(i, key); return; }
        if (n.children.get(i).isFull()) {
            splitChild(n, i);
            if (key > n.keys.get(i)) i++;
            else if (key == n.keys.get(i)) return;
        }
        insertNonFull(n.children.get(i), key);
    }

    // ---------- TOP-DOWN DELETE ----------
    public void delete(int key) {
        if (root == null) return;
        del(root, key);
        if (root.keys.isEmpty()) {
            root = root.isLeaf() ? null : root.children.get(0);
        }
    }

    private void del(Node n, int key) {
        int i = 0;
        while (i < n.keys.size() && key > n.keys.get(i)) i++;
        boolean found = i < n.keys.size() && key == n.keys.get(i);

        if (n.isLeaf()) {
            if (found) n.keys.remove(i); // n had ≥ 2 keys, so ≥ 1 remains
            return;
        }

        if (found) {
            ensureFat(n, i);
            if (i < n.keys.size() && n.keys.get(i) == key) {
                Node pred = maxNode(n.children.get(i));
                int predKey = pred.keys.get(pred.keys.size() - 1);
                n.keys.set(i, predKey);
                del(n.children.get(i), predKey);
            } else {
                del(n.children.get(i), key); // a fuse pulled keys[i] down
            }
            return;
        }

        int idx = ensureFat(n, i);
        del(n.children.get(idx), key);
    }

    private Node maxNode(Node n) {
        while (!n.isLeaf()) n = n.children.get(n.children.size() - 1);
        return n;
    }

    // Guarantees children[i] has ≥ 2 keys; returns the (possibly shifted) index.
    private int ensureFat(Node n, int i) {
        if (n.children.get(i).keys.size() >= 2) return i;

        // Borrow from RIGHT.
        if (i < n.children.size() - 1 && n.children.get(i + 1).keys.size() >= 2) {
            Node child = n.children.get(i), right = n.children.get(i + 1);
            child.keys.add(n.keys.get(i));            // separator down
            n.keys.set(i, right.keys.remove(0));      // sibling min up
            if (!right.isLeaf()) child.children.add(right.children.remove(0));
            return i;
        }
        // Borrow from LEFT.
        if (i > 0 && n.children.get(i - 1).keys.size() >= 2) {
            Node child = n.children.get(i), left = n.children.get(i - 1);
            child.keys.add(0, n.keys.get(i - 1));     // separator down
            n.keys.set(i - 1, left.keys.remove(left.keys.size() - 1)); // sibling max up
            if (!left.isLeaf())
                child.children.add(0, left.children.remove(left.children.size() - 1));
            return i;
        }
        // Fuse.
        if (i > 0) { fuse(n, i - 1); return i - 1; }
        fuse(n, i); return 0;
    }

    private void fuse(Node n, int i) {
        Node left = n.children.get(i), right = n.children.get(i + 1);
        left.keys.add(n.keys.get(i));       // separator down
        left.keys.addAll(right.keys);
        left.children.addAll(right.children);
        n.keys.remove(i);
        n.children.remove(i + 1);
    }
}
```

The Go and Java versions are line-for-line equivalent; the only differences are the container API and Java's `splitChild`/`Split` shape standing in for Go's slice helpers. Both enforce the same invariant — *never descend into a 2-node* — by calling `ensureFat` before every descent.

---

<a name="python"></a>
## 9. Python (Optional, Compact)

```python
class Node:
    __slots__ = ("keys", "children")
    def __init__(self):
        self.keys = []        # 1..3 (0..4 transiently)
        self.children = []    # len(keys)+1, [] for leaves
    def is_leaf(self): return not self.children
    def is_full(self): return len(self.keys) == 3


class TwoThreeFourTree:
    def __init__(self):
        self.root = None

    # ---- search ----
    def contains(self, key):
        n = self.root
        while n:
            i = 0
            while i < len(n.keys) and key > n.keys[i]:
                i += 1
            if i < len(n.keys) and key == n.keys[i]:
                return True
            if n.is_leaf():
                return False
            n = n.children[i]
        return False

    # ---- top-down insert ----
    def insert(self, key):
        if self.root is None:
            self.root = Node(); self.root.keys = [key]; return
        if self.root.is_full():
            nr = Node(); nr.children = [self.root]
            self._split_child(nr, 0); self.root = nr
        self._insert_nonfull(self.root, key)

    def _split_child(self, n, i):
        full = n.children[i]
        median = full.keys[1]
        left = Node();  left.keys = [full.keys[0]]
        right = Node(); right.keys = [full.keys[2]]
        if not full.is_leaf():
            left.children  = full.children[0:2]
            right.children = full.children[2:4]
        n.keys.insert(i, median)
        n.children[i] = left
        n.children.insert(i + 1, right)

    def _insert_nonfull(self, n, key):
        i = 0
        while i < len(n.keys) and key > n.keys[i]:
            i += 1
        if i < len(n.keys) and key == n.keys[i]:
            return
        if n.is_leaf():
            n.keys.insert(i, key); return
        if n.children[i].is_full():
            self._split_child(n, i)
            if key > n.keys[i]:   i += 1
            elif key == n.keys[i]: return
        self._insert_nonfull(n.children[i], key)

    # ---- top-down delete ----
    def delete(self, key):
        if self.root is None:
            return
        self._del(self.root, key)
        if not self.root.keys:
            self.root = None if self.root.is_leaf() else self.root.children[0]

    def _del(self, n, key):
        i = 0
        while i < len(n.keys) and key > n.keys[i]:
            i += 1
        found = i < len(n.keys) and key == n.keys[i]

        if n.is_leaf():
            if found:
                n.keys.pop(i)
            return

        if found:
            self._ensure_fat(n, i)
            if i < len(n.keys) and n.keys[i] == key:
                pred = n.children[i]
                while not pred.is_leaf():
                    pred = pred.children[-1]
                pk = pred.keys[-1]
                n.keys[i] = pk
                self._del(n.children[i], pk)
            else:
                self._del(n.children[i], key)
            return

        idx = self._ensure_fat(n, i)
        self._del(n.children[idx], key)

    def _ensure_fat(self, n, i):
        if len(n.children[i].keys) >= 2:
            return i
        # borrow right
        if i < len(n.children) - 1 and len(n.children[i + 1].keys) >= 2:
            child, right = n.children[i], n.children[i + 1]
            child.keys.append(n.keys[i])
            n.keys[i] = right.keys.pop(0)
            if not right.is_leaf():
                child.children.append(right.children.pop(0))
            return i
        # borrow left
        if i > 0 and len(n.children[i - 1].keys) >= 2:
            child, left = n.children[i], n.children[i - 1]
            child.keys.insert(0, n.keys[i - 1])
            n.keys[i - 1] = left.keys.pop()
            if not left.is_leaf():
                child.children.insert(0, left.children.pop())
            return i
        # fuse
        j = i - 1 if i > 0 else i
        left, right = n.children[j], n.children[j + 1]
        left.keys.append(n.keys[j])
        left.keys.extend(right.keys)
        left.children.extend(right.children)
        n.keys.pop(j)
        n.children.pop(j + 1)
        return j
```

---

<a name="bottom-up"></a>
## 10. Bottom-Up Deletion — The Simpler Alternative

Top-down deletion's appeal is the single pass, but it is not the only correct approach. **Bottom-up deletion** is conceptually simpler and is exactly the 2-3 tree style: descend normally to the leaf (reducing an internal key to its predecessor/successor along the way), remove the key, and *if* the leaf underflows to 0 keys, repair the hole by borrowing or fusing **on the way back up**, letting the hole cascade if a fuse empties a parent.

```
bottom-up delete:
  descend to the leaf holding the (reduced) key
  remove it
  while the current node is empty and not the root:
      borrow from a sibling if one has a spare key  ──► stop
      else fuse with a sibling, pulling a separator down ──► hole moves up, continue
  if the root became empty: drop it, promote its child (height−1)
```

The trade-offs mirror the red-black / B-tree top-down-vs-bottom-up discussion:

- **Top-down**: one pass, no need to remember the path, friendlier to hand-over-hand locking, but it sometimes enriches nodes it never needed to touch (a borrow/fuse that the actual deletion would not have required). It can also, rarely, *grow* a node only to shrink it again.
- **Bottom-up**: only repairs nodes that actually underflow, so it does strictly fewer structural changes on average, but it needs the ancestor path (a parent stack or parent pointers) and a fix-up loop.

Both are `O(log n)`. The top-down version is the natural companion to top-down insertion and the one this file implements; the bottom-up version is identical to the 2-3 tree deletion in `../18-two-three-tree/middle.md` with one extra key slot per node.

---

<a name="complexity"></a>
## 11. Complexity and Invariant Checklist

### Complexity

| Operation | Time | Why |
|---|---|---|
| Search | `O(log n)` | Height is `Θ(log n)`; each node does `O(1)` comparisons. |
| Insert | `O(log n)` | One descent; at most one split per level on the way down. |
| Delete | `O(log n)` | One descent; at most one borrow-or-fuse per level on the way down. |
| Space | `O(n)` | Each key stored once; up to 3 keys + 4 child slots per node. |

Height bound: a 2-3-4 tree of `n` keys has height between `⌈log₄(n+1)⌉ − 1` (all 4-nodes, fullest) and `⌈log₂(n+1)⌉ − 1` (all 2-nodes, sparsest). Both are `Θ(log n)`. Because the 4-node packs three keys, a 2-3-4 tree is typically **shorter** than a 2-3 tree on the same data. Like the 2-3 tree, the cost is **worst-case, not amortized** — every single operation is guaranteed logarithmic.

### Invariant checklist (assert after every operation in tests)

- [ ] Every node has 1, 2, or 3 keys (no empty nodes, no 4-key/5-node states left behind).
- [ ] Every internal node has exactly `keycount + 1` children.
- [ ] Keys within a node are sorted, and the global BST ordering holds.
- [ ] **All leaves are at the same depth** (verify by a depth-collecting traversal — the invariant deletion is most likely to break).
- [ ] An in-order traversal yields keys in sorted order.
- [ ] The root may legally be a 2-node; nothing below the root is empty.

---

<a name="edge-cases"></a>
## 12. Edge Cases

These inputs expose bugs in a hastily written 2-3-4 delete:

1. **Deleting from an empty tree.** `Delete` must no-op when `root == nil`. The guard at the top handles it.
2. **Deleting a key not present.** The descent enriches nodes along the way (harmless) and ends at a leaf without `found`; nothing is removed. Note: top-down deletion may still restructure the tree even when the key is absent — correct, just slightly wasteful. (A pre-check `Contains` avoids the churn if absence is common.)
3. **Single-node tree, deleting its only key.** Root is a leaf 2-node `[k]`. After removal it is empty *and* a leaf → `Delete` sets `root = nil`. The tree becomes empty, not a zero-key node.
4. **Deleting one key of a multi-key root.** Root `[a|b|c]`, delete `b` (a leaf-root example). The root becomes `[a|c]`, still a legal node. No height change.
5. **Root collapse (height−1).** Case D: the root is a 2-node whose two children both get fused around its single key; the root empties and is replaced by its single child. The handler `root.children[0]` runs *only* when the root is internal — a leaf root collapses to `nil` (case 3).
6. **Internal hit whose target side is a 2-node.** When deleting an internal separator, `ensureFat` may fuse the separator *down* into the child instead of leaving it in place; the code rechecks `n.keys[i] == key` and, if the fuse swallowed it, deletes from the child. Forgetting this recheck is the classic top-down internal-delete bug.
7. **Borrow vs fuse boundary.** A sibling is *borrowable* when it has `keys.size() >= 2`. A sibling with exactly 1 key cannot lend. Using `>= 1` makes every sibling look borrowable and produces empty siblings — the single most common deletion bug.
8. **Index shift after a fuse.** A fuse with the *left* sibling removes a child to the left of the target, so the target child's index decreases by one. `ensureFat` returns the corrected index; using the stale `i` after a left-fuse descends into the wrong subtree.

A good test harness inserts a permutation of `1..N`, deletes them in another permutation, and asserts the full invariant checklist after each step.

---

<a name="redblack"></a>
## 13. The Red-Black Correspondence in Action

A **red-black tree** (`../04-red-black/middle.md`) is a *binary encoding* of a 2-3-4 tree — this is exactly why the two are described as **isomorphic**. Each 2-3-4 node maps to a small cluster of binary nodes joined by *red* links, with *black* links between distinct 2-3-4 nodes:

```
2-node   [A]          ⇄   A(black)

3-node   [A|B]        ⇄   B(black)            A(black)
                          /      \      OR    /      \
                        A(red)    …          …    B(red)

4-node   [A|B|C]       ⇄         B(black)
                                /        \
                            A(red)      C(red)
```

A red link means "this node is glued to its parent into one logical 2-3-4 node." Now watch the operations line up.

**A 4-node split IS a color flip.** In top-down insertion, splitting `[A|B|C]` promotes the median `B` and leaves two 2-nodes `[A]` and `[C]`. In the binary encoding, the 4-node is a black `B` with two **red** children `A` and `C`. Promoting `B` is exactly **flipping `B` to red** (so it joins the parent cluster) and **flipping `A` and `C` to black** (so they detach into their own 2-3-4 nodes):

```
   before split          flipColors           after split
        B(black)            B(red)            B promoted into parent
       /        \    →     /      \     ⇄     [ … B … ]
   A(red)    C(red)    A(black) C(black)      /   |   \
                                            [A]      [C]
```

That is precisely the red-black insert case usually written "the uncle is red: recolor and push the problem up." The "push up" is `B` becoming red and possibly colliding with a red parent — which the red-black fix-up then resolves with a rotation. So the upward propagation that top-down insertion eliminated by splitting *eagerly* is the same propagation red-black `flipColors` triggers; LLRB and CLRS just handle it with rotations instead of an extra 2-3-4 slot.

**A fuse IS a color change in the other direction.** Top-down deletion's `ensureFat` borrow/fuse moves correspond to the red-black delete fix-up's "sibling is black, recolor / rotate" cases. Fusing two 2-nodes with a separator into a 4-node is, in binary terms, taking two black-rooted clusters and recoloring one root red so the three keys glue into a single 4-node cluster — the `moveRedLeft` / `moveRedRight` step in Sedgewick's LLRB delete, or the "borrow / merge" cases in CLRS delete.

This is the cleanest way to *preview red-black rebalancing*: every rotation and recolor you will study in `../04-red-black/middle.md` is a 2-3-4 split, fuse, or rotation in disguise. When a red-black case feels arbitrary, redraw the corresponding 2-3-4 node and the colors fall out. Conversely, the 2-3-4 tree is the model that makes "why does red-black recolor here and rotate there?" answerable instead of memorized — which is why Bayer's 1972 red-black trees were *defined* as binary 2-3-4 trees.

---

<a name="two-three"></a>
## 14. Contrast with 2-3 Tree Deletion

The 2-3 tree (`../18-two-three-tree/middle.md`) is the order-3 sibling: nodes hold 1 or 2 keys only — there is **no stable 4-node**. That single difference reshapes both operations.

| | 2-3 tree (order 3) | 2-3-4 tree (order 4) |
|---|---|---|
| Max keys per node | 2 | 3 |
| Stable "fat" node | 3-node | 4-node |
| Natural insertion | **bottom-up** (split bubbles a median *up*) | **top-down** (split full 4-nodes on the way *down*) |
| Natural deletion | **bottom-up** (hole cascades *up*) | **top-down** (enrich thin nodes on the way *down*) |
| Binary encoding | LLRB (2-3 tree exactly) | classic red-black (CLRS / std::map) |

Why can 2-3-4 trees do insertion and deletion *top-down* while 2-3 trees naturally do them *bottom-up*? Because the order-4 node has a spare slot. Top-down insertion needs to split a full node into the parent *without overflowing the parent* — which requires the parent to have room, guaranteed only if we split full ancestors first; the order-4 split produces two 2-nodes and one promoted key, and a 2-3-4 parent that we have not yet filled can always absorb one more key. In a 2-3 tree there is less slack: a node has at most 2 keys, so the eager-split machinery is tighter and the classical treatment bubbles the median *up* instead. Symmetrically, top-down deletion needs every node it leaves behind after a fuse to still be legal; the order-4 tree gives the parent enough keys (≥ 2 after enrichment) that pulling one *down* in a fuse never empties it — except at the root.

The deletion *cases* themselves are identical in spirit — borrow from a sibling with a spare key, else fuse a separator down — but the 2-3 tree resolves them by letting underflow propagate up (a hole that bubbles to the root collapses the tree), while the 2-3-4 tree resolves them by preventing underflow from ever arising (enrich on the way down so the leaf can always spare a key). Same machinery, opposite direction of travel. If 2-3 tree deletion's "fix the hole on the way up" clicked, top-down 2-3-4 deletion is the same logic run *preemptively on the way down*.

---

<a name="pitfalls"></a>
## 15. Common Pitfalls

1. **Descending into a 2-node.** The entire correctness of top-down deletion rests on the invariant *never enter a 2-node child*. Skipping `ensureFat` before any descent — including the descent toward an internal key's predecessor leaf — reintroduces upward cascades the algorithm was designed to avoid.
2. **Off-by-one in the borrow test.** A borrowable sibling has `keys.size() >= 2`. Using `>= 1` treats a minimal 2-node as lendable and empties it.
3. **Forgetting the index shift after a left-fuse.** Fusing with the left sibling deletes a child to the left of the target, so the target's index drops by one. Always descend into the index `ensureFat` returns, never the original `i`.
4. **Mishandling the internal-hit-after-fuse case.** When deleting an internal separator, `ensureFat` may fuse that very separator down into a child. The code must recheck whether `n.keys[i]` is still the target; if not, delete from the child instead of swapping in a predecessor that no longer borders the gap.
5. **Not moving child pointers during borrow/fuse on internal nodes.** A rotated key must drag a child pointer with it, and a fuse must concatenate child lists. Omitting this breaks balance silently — the tree still *looks* valid until a later query falls off a missing child.
6. **Mishandling the empty leaf root.** When the root itself is an emptied leaf, the tree must become empty (`root = nil`), not be replaced by a nonexistent `children[0]`. Branch on `root.isLeaf()`.
7. **Losing the all-leaves-same-depth invariant.** Never "just delete" a child to fix a thin node — that shortens one path. Thinness is *always* resolved by borrow or by fuse-and-collapse-at-the-root, never by truncation.
8. **Restructuring on a missing key.** Top-down deletion enriches nodes even when the key turns out to be absent. This is correct but wasteful; if deletes of absent keys are common, gate `Delete` behind a `Contains` check.

---

<a name="summary"></a>
## 16. Summary

- A **2-3-4 tree** keeps all leaves at equal depth using 2-, 3-, and 4-nodes; it is precisely the **B-tree of order 4**, and the stable 4-node is what enables fully top-down operations.
- **Top-down insertion** prevents overflow by **splitting full 4-nodes on the way down**, so a split never cascades up; height grows only by splitting a full root.
- **Top-down deletion** is the exact mirror: it prevents underflow by **enriching minimal 2-nodes on the way down** — via **borrow-left**, **borrow-right**, or **fuse** — so the target leaf always has a key to spare. There is no fix-up pass; the only height change is the root collapsing when its two children fuse around its last key.
- An **internal-key deletion** is reduced to a leaf deletion by swapping with the in-order predecessor or successor, done as part of the same downward pass.
- The Go, Java, and Python implementations enforce one rule — *never descend into a 2-node* — through `ensureFat`, and trace cleanly through Case D's root collapse.
- A simpler **bottom-up deletion** (the 2-3 tree style with one extra slot) is an equally correct alternative that repairs only nodes that actually underflow, at the cost of needing the ancestor path.
- The **red-black correspondence in action**: a **4-node split is a color flip** (median to red, children to black), and a fuse is the reverse recolor; every red-black rotation/recolor you will meet in `../04-red-black/middle.md` is a 2-3-4 split, fuse, or rotation in disguise — this previews red-black rebalancing exactly.
- Versus the **2-3 tree** (`../18-two-three-tree/middle.md`): same borrow/fuse machinery, but the order-3 tree's tighter packing makes its natural insert and delete *bottom-up* (underflow propagates up), whereas the order-4 slack lets the 2-3-4 tree work *top-down* (underflow is prevented up front).

Continue with `./senior.md` for production considerations — why 2-3-4 trees are taught but deployed as red-black trees, in-memory cache behavior versus large-order B-trees, concurrency via the bounded top-down lock window, and how `std::map` / `TreeMap` realize this structure as colored binary nodes.
