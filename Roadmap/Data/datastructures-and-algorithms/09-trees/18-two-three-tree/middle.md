# 2-3 Tree — Middle Level

> **Audience:** Engineers who have read `junior.md` and can already do a 2-3 tree search and insert (with the bottom-up split that bubbles a median key upward). Prerequisite: `junior.md`.

The junior level deferred the genuinely hard operation: **deletion**. Inserting into a 2-3 tree only ever has to deal with *overflow* — a node that grew a third key — and overflow resolves cleanly by splitting and pushing the median up. Deletion is the mirror image: it produces *underflow* — a node that lost its only key and now has no separator — and there is no single clean rule that fixes it. You have to borrow, or merge, and merging can cascade all the way to the root, shrinking the whole tree by one level.

This document gives the full deletion algorithm with worked, ASCII-diagrammed cases, then complete and *traced* implementations of insert + delete in Go and Java (Python optional), the complexity and invariant checklist, the edge cases that break naive implementations, and the bridge to B-trees of order 3, 2-3-4 trees, and red-black trees.

---

## Table of Contents

1. [Invariants Recap](#invariants)
2. [Why Deletion Is the Hard Part](#why-hard)
3. [Step 1 — Reduce to Deleting at a Leaf](#reduce)
4. [Step 2 — Resolving Underflow](#underflow)
5. [Worked Deletion Cases (ASCII)](#cases)
6. [Complete Implementation — Go](#go)
7. [Complete Implementation — Java](#java)
8. [Python (Optional, Compact)](#python)
9. [Complexity and Invariant Checklist](#complexity)
10. [Edge Cases](#edge-cases)
11. [Relationship to B-Trees, 2-3-4 Trees, and Red-Black Trees](#relationships)
12. [Common Pitfalls in Deletion](#pitfalls)
13. [Summary](#summary)

---

<a name="invariants"></a>
## 1. Invariants Recap

A 2-3 tree is a balanced search tree whose every node is one of:

- **2-node:** holds **1 key** and has **2 children** (subtrees of keys `< key` and `> key`).
- **3-node:** holds **2 keys** `a < b` and has **3 children** (`< a`, between `a` and `b`, `> b`).

The four invariants every operation must preserve:

1. **Key order.** Within a node keys are sorted; the standard BST ordering holds across children.
2. **Node arity.** Every internal node is a 2-node or a 3-node — never a 1-node (no keys) and never a 4-node (three keys). A 4-node is a *transient* insertion state; a 1-node (empty node) is a *transient* deletion state. Neither survives a completed operation.
3. **Perfect balance.** **All leaves are at exactly the same depth.** This is the property that makes the tree O(log n) without any rotation bookkeeping — and it is precisely what insertion's "grow at the root" and deletion's "shrink at the root" rules protect.
4. **Childcount = keycount + 1** for every internal node (2 children for 1 key, 3 children for 2 keys). Leaves have no children.

Insertion never lengthens a single branch; it grows the tree only by raising a new root, keeping all leaves level. Deletion is held to the same standard: it shrinks the tree only by *removing* the root, never by shortening one branch.

---

<a name="why-hard"></a>
## 2. Why Deletion Is the Hard Part

Insertion has a comforting property: the place you add a key is always a **leaf**, and the only thing that can go wrong is one node becoming a 4-node, which splits locally with a clean median.

Deletion is harder for two compounding reasons:

1. **The key you want to delete may be in an internal node.** You cannot just remove it — an internal node's keys are *separators* between children. Removing one would leave a node with two keys' worth of children but only one separator, violating invariant 4.
2. **Removing a key from a leaf can empty it.** A 2-node leaf has exactly one key; delete it and the leaf has zero keys — an illegal **empty node** (sometimes called a *hole*). Fixing the hole may require pulling a key down from the parent, which can empty the parent in turn, and so on up the tree.

The algorithm tames this with a two-phase strategy:

- **Phase A — Reduce to a leaf.** If the target key is internal, swap it with its in-order predecessor or successor (both live in a leaf), so the actual removal always happens at a leaf.
- **Phase B — Fix underflow upward.** Remove the key from the leaf. If the leaf is now empty, repair it by *borrowing* from a sibling or *merging* with one, propagating the repair toward the root as needed.

---

<a name="reduce"></a>
## 3. Step 1 — Reduce to Deleting at a Leaf

Find the node containing the key. Two situations:

**(a) The key is already in a leaf.** Skip ahead — remove it directly and handle underflow.

**(b) The key is in an internal node.** It sits between two children. Replace it with its **in-order predecessor** (the largest key in the left-of-it subtree) or its **in-order successor** (the smallest key in the right-of-it subtree). Both of these always live in a **leaf**, because to find a predecessor you walk down-right until you can't, and to find a successor you walk down-left until you can't — and "can't go further" means a leaf.

After the swap, the key to physically delete is now in a leaf, and we have reduced case (b) to case (a).

```
Delete 50, an internal separator:

        [50 | 80]
       /    |    \
   [20]  [60|70]  [90]

In-order predecessor of 50 = 20 (largest key left of 50).
Copy 20 up into the 50 slot, then delete 20 from its leaf:

        [20 | 80]
       /    |    \
   [ ]   [60|70]  [90]      <- leaf underflow, fix in Phase B
```

(Using the *successor* 60 instead is equally valid; pick one convention and stick to it. Borrowing from a 3-node leaf — see below — can avoid the underflow entirely if you choose the side that has a 3-node, an optimization many textbooks skip.)

---

<a name="underflow"></a>
## 4. Step 2 — Resolving Underflow

After removing the key from the leaf, two outcomes:

- **The leaf was a 3-node** → it is now a 2-node. **Done.** No underflow. A 3-node has a key to spare.
- **The leaf was a 2-node** → it is now an **empty node** (a hole). We must repair.

To repair an empty node `X` with parent `P` and adjacent sibling `S`, there are exactly two moves:

### Move 1 — Borrow (rotate) from a 3-node sibling

If an **immediate sibling `S` is a 3-node** (has a key to spare), rotate one key around the parent: the separator in `P` between `X` and `S` moves **down** into `X`, and the adjacent key from `S` moves **up** into `P`'s vacated slot. If `X` and `S` are internal, the corresponding child of `S` is transferred to `X` as well, preserving balance and child counts.

This is a key going **up-and-over** through the parent. It fills the hole and leaves every node legal. **The repair stops here** — borrowing never empties the sibling (it was a 3-node, now a 2-node) and never touches the parent's arity (the parent gave one key and got one back).

### Move 2 — Merge (fuse) with a 2-node sibling

If **no adjacent sibling is a 3-node** — every neighbor is a 2-node with nothing to spare — we cannot borrow. Instead **merge**: pull the separator key in `P` (the one between `X` and `S`) **down** and fuse it with sibling `S` into a single 3-node, absorbing `X`'s child (if any). The empty node `X` disappears.

Pulling a key *down* out of `P` reduces `P`'s key count by one.

- If `P` was a **3-node**, it becomes a 2-node. **Done.**
- If `P` was a **2-node**, it becomes **empty** — the hole has moved **up one level**. Recurse: repair `P` with *its* parent and sibling.

This is how underflow **cascades**. In the worst case it propagates from a leaf all the way to the root.

### The root case (height shrinks)

If the cascade reaches the **root** and the root becomes empty, simply **delete the root** and make its single remaining child the new root. **This is the only place a 2-3 tree loses height** — the symmetric counterpart of insertion's "split the root to gain height." All leaves drop by exactly one level together, so perfect balance is preserved.

### Decision summary

```
delete key from leaf
  leaf still non-empty (was a 3-node)? ─────────► DONE
  leaf empty (was a 2-node)?
        some adjacent sibling is a 3-node? ──────► BORROW, DONE
        all adjacent siblings are 2-nodes? ──────► MERGE
              parent was a 3-node? ──────────────► DONE
              parent was a 2-node? ──────────────► parent now empty, RECURSE upward
                    reached an empty root? ──────► drop root, height−1, DONE
```

---

<a name="cases"></a>
## 5. Worked Deletion Cases (ASCII)

Throughout, `[k]` is a 2-node, `[a|b]` is a 3-node, and `[ ]` is an empty node (a hole).

### Case A — Borrow from the right sibling (3-node)

```
Delete 10.

        [30]
       /    \
    [10]   [50|70]            (right sibling of the hole is a 3-node)

Remove 10  →  left child becomes [ ] (a hole).

        [30]
       /    \
    [ ]    [50|70]

Borrow: 30 (separator) rotates DOWN into the hole; 50 (sibling's
smallest) rotates UP into 30's slot; sibling's leftmost child goes to X.

        [50]
       /    \
    [30]    [70]             balanced, all legal. DONE.
```

### Case B — Borrow from the left sibling (3-node)

```
Delete 90.

        [60]
       /    \
   [20|40]  [90]            (left sibling of the hole is a 3-node)

Remove 90  →  right child becomes [ ].

        [60]
       /    \
   [20|40]  [ ]

Borrow: 60 rotates DOWN into the hole; 40 (sibling's largest) rotates
UP into 60's slot.

        [40]
       /    \
    [20]    [60]            DONE.
```

### Case C — Merge with a sibling (no 3-node available), parent survives

```
Delete 10. The parent is a 3-node, both leaf siblings are 2-nodes.

        [30 | 70]
       /    |    \
    [10]  [50]   [90]

Remove 10  →  left child [ ]. No sibling is a 3-node, so merge with [50]:
pull separator 30 DOWN, fuse 30+50 into a 3-node.

        [70]
       /    \
   [30|50]  [90]            parent was a 3-node → now a 2-node. DONE.
```

### Case D — Cascading merge that lowers the root

```
Delete 10. Every node on the path is a 2-node — the sparsest legal tree.

           [30]
          /    \
       [20]    [50]
       /  \    /  \
    [10][25][40][60]

Remove 10  →  the [10] leaf is empty.

           [30]
          /    \
       [20]    [50]
       /  \    /  \
     [ ][25][40][60]

Sibling [25] is a 2-node → cannot borrow. Merge: pull 20 DOWN, fuse 20+25.

           [30]
          /    \
        [ ]    [50]         <- the parent of the merged leaf is now empty
        / \    /  \
   [20|25] [40][60]
        (one child)

The hole moved up. The empty internal node's sibling is [50] (a 2-node) →
cannot borrow. Merge again: pull 30 DOWN, fuse 30+50, absorb children.

              [ ]            <- root is now empty
               |
           [30|50]
          /   |    \
   [20|25] [40]   [60]

Root is empty → drop it, promote its single child. Height drops from 3 to 2.

           [30 | 50]
          /    |    \
   [20|25]   [40]   [60]     all leaves at the same depth. DONE.
```

Case D is the canonical demonstration that **2-3 tree deletion can change the height**, and that it does so *only* by removing the root, keeping all leaves level.

---

<a name="go"></a>
## 6. Complete Implementation — Go

A node stores up to two keys and up to three children. We use `n` to denote the live key count (1 or 2; transiently 0 or 3 during an operation).

```go
package twothree

// Node holds 1 or 2 keys (transiently 0 or 3) and n+1 children.
type Node struct {
	keys     []int   // length 1..2 (0..3 transiently)
	children []*Node // length len(keys)+1, or empty for leaves
}

type Tree struct {
	root *Node
}

func (n *Node) isLeaf() bool { return len(n.children) == 0 }

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

// ---------- INSERT ----------
// Bottom-up: descend to a leaf, insert, split any overflowing (3-key) node,
// promoting the median. A returned (promoted) signals a split to the parent.

func (t *Tree) Insert(key int) {
	if t.root == nil {
		t.root = &Node{keys: []int{key}}
		return
	}
	mid, left, right, split := insert(t.root, key)
	if split {
		t.root = &Node{keys: []int{mid}, children: []*Node{left, right}}
	}
}

// insert returns (median, leftChild, rightChild, didSplit).
func insert(n *Node, key int) (int, *Node, *Node, bool) {
	// Find slot / detect duplicate.
	i := 0
	for i < len(n.keys) && key > n.keys[i] {
		i++
	}
	if i < len(n.keys) && key == n.keys[i] {
		return 0, nil, nil, false // already present
	}

	if n.isLeaf() {
		n.keys = insertIntAt(n.keys, i, key)
	} else {
		mid, left, right, split := insert(n.children[i], key)
		if !split {
			return 0, nil, nil, false
		}
		// Absorb the promoted median and the two split children.
		n.keys = insertIntAt(n.keys, i, mid)
		n.children[i] = left
		n.children = insertNodeAt(n.children, i+1, right)
	}

	if len(n.keys) <= 2 {
		return 0, nil, nil, false // no overflow
	}
	// Overflow: 3 keys -> split. Median is keys[1].
	median := n.keys[1]
	left := &Node{keys: []int{n.keys[0]}}
	right := &Node{keys: []int{n.keys[2]}}
	if !n.isLeaf() {
		left.children = []*Node{n.children[0], n.children[1]}
		right.children = []*Node{n.children[2], n.children[3]}
	}
	return median, left, right, true
}

// ---------- DELETE ----------

func (t *Tree) Delete(key int) {
	if t.root == nil {
		return
	}
	del(t.root, key)
	// If the root became empty (underflow cascaded to the top), drop it.
	if len(t.root.keys) == 0 {
		if t.root.isLeaf() {
			t.root = nil // tree is now empty
		} else {
			t.root = t.root.children[0]
		}
	}
}

// del removes key from the subtree rooted at n. After it returns, n may be
// empty (len(keys)==0); the *caller* is responsible for fixing that hole via
// fixChild. This keeps the underflow repair one level above where it occurs,
// which is exactly where borrow/merge needs access to siblings.
func del(n *Node, key int) {
	i := 0
	for i < len(n.keys) && key > n.keys[i] {
		i++
	}
	found := i < len(n.keys) && key == n.keys[i]

	if n.isLeaf() {
		if found {
			n.keys = removeIntAt(n.keys, i) // may leave 0 keys -> caller fixes
		}
		return
	}

	if found {
		// Internal hit: swap with in-order predecessor (largest key in
		// children[i]'s subtree), which lives in a leaf.
		pred := maxNode(n.children[i])
		predKey := pred.keys[len(pred.keys)-1]
		n.keys[i] = predKey
		del(n.children[i], predKey) // delete that key from the left subtree
		if len(n.children[i].keys) == 0 {
			fixChild(n, i)
		}
		return
	}

	// Not found here: recurse into the correct child, then repair if it underflowed.
	del(n.children[i], key)
	if len(n.children[i].keys) == 0 {
		fixChild(n, i)
	}
}

func maxNode(n *Node) *Node {
	for !n.isLeaf() {
		n = n.children[len(n.children)-1]
	}
	return n
}

// fixChild repairs an empty child at index i of parent n, by borrowing from a
// 3-node sibling if possible, otherwise merging. After a merge, n itself may
// become empty; its caller (one level up) detects and fixes that.
func fixChild(n *Node, i int) {
	child := n.children[i]

	// Try borrow from LEFT sibling (a 3-node).
	if i > 0 && len(n.children[i-1].keys) == 2 {
		left := n.children[i-1]
		// Parent separator (keys[i-1]) rotates DOWN into child (front).
		child.keys = append([]int{n.keys[i-1]}, child.keys...)
		// Left sibling's largest key rotates UP into the parent slot.
		n.keys[i-1] = left.keys[1]
		left.keys = left.keys[:1]
		// Move left sibling's rightmost child over to child's front.
		if !left.isLeaf() {
			child.children = append([]*Node{left.children[2]}, child.children...)
			left.children = left.children[:2]
		}
		return
	}

	// Try borrow from RIGHT sibling (a 3-node).
	if i < len(n.children)-1 && len(n.children[i+1].keys) == 2 {
		right := n.children[i+1]
		// Parent separator (keys[i]) rotates DOWN into child (end).
		child.keys = append(child.keys, n.keys[i])
		// Right sibling's smallest key rotates UP into the parent slot.
		n.keys[i] = right.keys[0]
		right.keys = right.keys[1:]
		// Move right sibling's leftmost child over to child's end.
		if !right.isLeaf() {
			child.children = append(child.children, right.children[0])
			right.children = right.children[1:]
		}
		return
	}

	// No 3-node sibling: MERGE. Prefer merging with the left sibling.
	if i > 0 {
		mergeChildren(n, i-1) // merge child[i-1] and child[i] around keys[i-1]
	} else {
		mergeChildren(n, i) // merge child[0] and child[1] around keys[0]
	}
}

// mergeChildren fuses children[i] and children[i+1] around separator keys[i].
// The separator is pulled DOWN; the right child is absorbed into the left.
func mergeChildren(n *Node, i int) {
	left := n.children[i]
	right := n.children[i+1]

	left.keys = append(left.keys, n.keys[i])        // pull separator down
	left.keys = append(left.keys, right.keys...)    // absorb right's keys
	left.children = append(left.children, right.children...)

	// Remove the separator and the now-absorbed right child from the parent.
	n.keys = removeIntAt(n.keys, i)
	n.children = removeNodeAt(n.children, i+1)
	// n may now have 0 keys; the caller one level up will fix it.
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

Run Case D (`Delete(10)` on the all-2-node tree of height 3) mentally against the code:

1. `del(root[30], 10)`: `10 < 30`, recurse into `children[0]` (the `[20]` subtree).
2. `del([20], 10)`: `10 < 20`, recurse into `[20].children[0]` = leaf `[10]`.
3. `del([10], 10)`: leaf, found, `removeIntAt` → leaf becomes `[]` (0 keys). Return.
4. Back in step 2, `children[0]` has 0 keys → `fixChild([20], 0)`. Sibling `[25]` is a 2-node, no borrow; `i==0` so `mergeChildren([20], 0)`: pull `20` down, fuse with `[25]` → `[20|25]`; parent `[20]` loses its only key → becomes `[]`. Return.
5. Back in step 1, `children[0]` has 0 keys → `fixChild(root[30], 0)`. Sibling `[50]` is a 2-node, no borrow; merge around `30` → `[30|50]` with children `{[20|25],[40],[60]}`; root `[30]` becomes `[]`. Return.
6. In `Delete`, `len(root.keys)==0` and root is internal → `t.root = root.children[0]` = `[30|50]`. Height is now 2.

Result matches the diagram exactly.

---

<a name="java"></a>
## 7. Complete Implementation — Java

Same algorithm, idiomatic Java with `ArrayList`s for the variable-length key and child lists.

```java
import java.util.ArrayList;
import java.util.List;

public class TwoThreeTree {

    static final class Node {
        List<Integer> keys = new ArrayList<>();   // 1..2 (0..3 transiently)
        List<Node> children = new ArrayList<>();  // keys.size()+1, empty for leaves
        boolean isLeaf() { return children.isEmpty(); }
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

    // ---------- INSERT ----------
    // A split is signalled by returning a non-null Split; the parent absorbs it.
    private static final class Split { int mid; Node left, right; }

    public void insert(int key) {
        if (root == null) { root = leaf(key); return; }
        Split s = insert(root, key);
        if (s != null) {
            Node nr = new Node();
            nr.keys.add(s.mid);
            nr.children.add(s.left);
            nr.children.add(s.right);
            root = nr;
        }
    }

    private static Node leaf(int key) { Node n = new Node(); n.keys.add(key); return n; }

    private Split insert(Node n, int key) {
        int i = 0;
        while (i < n.keys.size() && key > n.keys.get(i)) i++;
        if (i < n.keys.size() && key == n.keys.get(i)) return null; // duplicate

        if (n.isLeaf()) {
            n.keys.add(i, key);
        } else {
            Split s = insert(n.children.get(i), key);
            if (s == null) return null;
            n.keys.add(i, s.mid);
            n.children.set(i, s.left);
            n.children.add(i + 1, s.right);
        }

        if (n.keys.size() <= 2) return null; // no overflow

        // Overflow: split around the median keys[1].
        Split out = new Split();
        out.mid = n.keys.get(1);
        out.left = new Node();
        out.right = new Node();
        out.left.keys.add(n.keys.get(0));
        out.right.keys.add(n.keys.get(2));
        if (!n.isLeaf()) {
            out.left.children.add(n.children.get(0));
            out.left.children.add(n.children.get(1));
            out.right.children.add(n.children.get(2));
            out.right.children.add(n.children.get(3));
        }
        return out;
    }

    // ---------- DELETE ----------
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
            if (found) n.keys.remove(i); // may empty the leaf; caller repairs
            return;
        }

        if (found) {
            // Swap with in-order predecessor (lives in a leaf), then delete it.
            Node pred = maxNode(n.children.get(i));
            int predKey = pred.keys.get(pred.keys.size() - 1);
            n.keys.set(i, predKey);
            del(n.children.get(i), predKey);
            if (n.children.get(i).keys.isEmpty()) fixChild(n, i);
            return;
        }

        del(n.children.get(i), key);
        if (n.children.get(i).keys.isEmpty()) fixChild(n, i);
    }

    private Node maxNode(Node n) {
        while (!n.isLeaf()) n = n.children.get(n.children.size() - 1);
        return n;
    }

    private void fixChild(Node n, int i) {
        Node child = n.children.get(i);

        // Borrow from LEFT sibling (3-node).
        if (i > 0 && n.children.get(i - 1).keys.size() == 2) {
            Node left = n.children.get(i - 1);
            child.keys.add(0, n.keys.get(i - 1));            // separator down
            n.keys.set(i - 1, left.keys.remove(1));          // sibling max up
            if (!left.isLeaf()) child.children.add(0, left.children.remove(2));
            return;
        }
        // Borrow from RIGHT sibling (3-node).
        if (i < n.children.size() - 1 && n.children.get(i + 1).keys.size() == 2) {
            Node right = n.children.get(i + 1);
            child.keys.add(n.keys.get(i));                   // separator down
            n.keys.set(i, right.keys.remove(0));             // sibling min up
            if (!right.isLeaf()) child.children.add(right.children.remove(0));
            return;
        }
        // No 3-node sibling: merge.
        if (i > 0) merge(n, i - 1);
        else       merge(n, i);
    }

    private void merge(Node n, int i) {
        Node left = n.children.get(i);
        Node right = n.children.get(i + 1);
        left.keys.add(n.keys.get(i));        // separator down
        left.keys.addAll(right.keys);
        left.children.addAll(right.children);
        n.keys.remove(i);
        n.children.remove(i + 1);            // n may now be empty; caller repairs
    }
}
```

The Java and Go versions are line-for-line equivalent; the only differences are the container API and the `Split` class standing in for Go's multiple return values. Both delegate the "I became empty" decision to the caller, which is the cleanest way to keep sibling access in scope during repair.

---

<a name="python"></a>
## 8. Python (Optional, Compact)

```python
class Node:
    __slots__ = ("keys", "children")
    def __init__(self):
        self.keys = []        # 1..2 (0..3 transiently)
        self.children = []    # len(keys)+1, [] for leaves
    def is_leaf(self):
        return not self.children


class TwoThreeTree:
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

    # ---- insert ----
    def insert(self, key):
        if self.root is None:
            self.root = Node(); self.root.keys = [key]; return
        res = self._insert(self.root, key)
        if res:
            mid, left, right = res
            r = Node(); r.keys = [mid]; r.children = [left, right]
            self.root = r

    def _insert(self, n, key):
        i = 0
        while i < len(n.keys) and key > n.keys[i]:
            i += 1
        if i < len(n.keys) and key == n.keys[i]:
            return None
        if n.is_leaf():
            n.keys.insert(i, key)
        else:
            res = self._insert(n.children[i], key)
            if not res:
                return None
            mid, left, right = res
            n.keys.insert(i, mid)
            n.children[i] = left
            n.children.insert(i + 1, right)
        if len(n.keys) <= 2:
            return None
        median = n.keys[1]
        left = Node(); left.keys = [n.keys[0]]
        right = Node(); right.keys = [n.keys[2]]
        if not n.is_leaf():
            left.children = n.children[0:2]
            right.children = n.children[2:4]
        return median, left, right

    # ---- delete ----
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
            pred = n.children[i]
            while not pred.is_leaf():
                pred = pred.children[-1]
            pk = pred.keys[-1]
            n.keys[i] = pk
            self._del(n.children[i], pk)
            if not n.children[i].keys:
                self._fix(n, i)
            return
        self._del(n.children[i], key)
        if not n.children[i].keys:
            self._fix(n, i)

    def _fix(self, n, i):
        child = n.children[i]
        if i > 0 and len(n.children[i - 1].keys) == 2:
            left = n.children[i - 1]
            child.keys.insert(0, n.keys[i - 1])
            n.keys[i - 1] = left.keys.pop()
            if not left.is_leaf():
                child.children.insert(0, left.children.pop())
            return
        if i < len(n.children) - 1 and len(n.children[i + 1].keys) == 2:
            right = n.children[i + 1]
            child.keys.append(n.keys[i])
            n.keys[i] = right.keys.pop(0)
            if not right.is_leaf():
                child.children.append(right.children.pop(0))
            return
        j = i - 1 if i > 0 else i
        left, right = n.children[j], n.children[j + 1]
        left.keys.append(n.keys[j])
        left.keys.extend(right.keys)
        left.children.extend(right.children)
        n.keys.pop(j)
        n.children.pop(j + 1)
```

---

<a name="complexity"></a>
## 9. Complexity and Invariant Checklist

### Complexity

| Operation | Time | Why |
|---|---|---|
| Search | O(log n) | Height is `Θ(log n)`; each node does O(1) comparisons. |
| Insert | O(log n) | One descent; at most one split per level on the way up. |
| Delete | O(log n) | One descent + at most one borrow-or-merge per level back up. |
| Space | O(n) | Each key stored once; child slots are O(1) per node. |

Height bound: a 2-3 tree of `n` keys has height between `⌈log₃(n+1)⌉ − 1` (all 3-nodes, fullest) and `⌈log₂(n+1)⌉ − 1` (all 2-nodes, sparsest). Both are `Θ(log n)`, so every operation is logarithmic with a small constant. Crucially, **the cost is worst-case, not amortized** — unlike splay trees, every single operation is guaranteed O(log n).

### Invariant checklist (assert these after every operation in tests)

- [ ] Every node has 1 or 2 keys (no empty nodes, no 4-nodes left behind).
- [ ] Every internal node has exactly `keycount + 1` children.
- [ ] Keys within a node are sorted, and the global BST ordering holds.
- [ ] **All leaves are at the same depth** (verify by a depth-collecting traversal — this is the invariant deletion is most likely to break).
- [ ] An in-order traversal yields keys in sorted order.
- [ ] The root is the only node permitted to be a (transient) 2-node-or-better after collapse; nothing below it is empty.

---

<a name="edge-cases"></a>
## 10. Edge Cases

These are the inputs that expose bugs in a hastily written delete:

1. **Deleting from an empty tree.** `Delete` must no-op when `root == nil`. The guard at the top of `Delete` handles it.
2. **Deleting a key that is not present.** The descent ends at a leaf without `found`; nothing is removed and no underflow occurs. Make sure the "not found in a leaf" path returns cleanly.
3. **Single-node tree, deleting its only key.** Root is a leaf 2-node. After removal it is empty *and* a leaf → `Delete` sets `root = nil`. The tree becomes empty, not a node with zero keys.
4. **Deleting one key of a root 3-node.** Root `[a|b]`, delete `a`. Root becomes `[b]`, still a legal 2-node root. No height change.
5. **Root collapse (height−1).** The cascading-merge case from Case D: the root becomes empty and is replaced by its single child. The handler `root.children[0]` must run *only* when the root is internal — a leaf root collapses to `nil` instead (case 3).
6. **Deleting an internal separator whose predecessor leaf is a 2-node.** The predecessor swap empties that leaf and triggers underflow up a *different* branch than the one the key lived in. The recursive `del` + `fixChild` pattern handles it because the repair always happens at the parent of whatever underflowed.
7. **Borrow vs merge boundary.** A sibling with exactly 2 keys is a 3-node (borrowable); a sibling with 1 key is a 2-node (must merge). Off-by-one here (`>= 2` vs `> 2`) is the single most common deletion bug.

A good test harness inserts a permutation of `1..N`, deletes them in another permutation, and asserts the full invariant checklist after each step.

---

<a name="relationships"></a>
## 11. Relationship to B-Trees, 2-3-4 Trees, and Red-Black Trees

### A 2-3 tree IS a B-tree of order 3

A B-tree of order `m` allows up to `m` children (and `m−1` keys) per node, with a minimum fill of `⌈m/2⌉` children. Plug in `m = 3`: each node has at most 3 children and 2 keys, and at least `⌈3/2⌉ = 2` children — i.e. nodes are 2-nodes or 3-nodes. **That is exactly a 2-3 tree.** In Knuth's order convention, a 2-3 tree is the order-3 B-tree, with minimum degree `t = 2` only at the leaf-arity boundary. Everything you learned about B-tree splits and merges (`../11-b-tree/middle.md`) specializes to the cases above: the B-tree's "split a full node, promote the median" is the 2-3 insert, and the B-tree's "borrow from a sibling or merge and pull a separator down" is exactly the deletion algorithm here, just with `m` fixed at 3. If 2-3 deletion clicks, B-tree deletion for any order is the same logic with longer key arrays.

### 2-3-4 trees add a stable 4-node

A **2-3-4 tree** (`../19-two-three-four-tree/middle.md`) is the order-4 B-tree: nodes may hold **1, 2, or 3 keys** (2, 3, or 4 children). The extra slot makes the 4-node a *permanent* state rather than a transient overflow, which enables a fully **top-down** insertion (proactively split every 4-node you descend through, so a split never has to propagate back up) and a top-down deletion (proactively ensure every node you enter has at least 2 keys, so a borrow/merge never has to propagate up). The price is slightly looser packing. The 2-3 tree is the minimal version that still teaches the entire split/merge machinery; the 2-3-4 tree is the version that maps cleanly onto a binary representation.

### Red-black trees are 2-3-4 trees in disguise

A **red-black tree** (`../04-red-black/middle.md`) is a *binary encoding* of a 2-3-4 tree. Each 2-3-4 node is represented by a small cluster of binary nodes: a 2-node is one black node; a 3-node is a black node with one red child; a 4-node is a black node with two red children. Under this bijection, a red-black rotation/recolor *is* a 2-3-4 split or merge, and the red-black "black height" equals the 2-3-4 tree's height. So when `TreeMap.put`/`remove` (Java) or `std::map` operations (C++) run, they are executing 2-3-4 B-tree inserts and deletes disguised as colored binary rotations. There is also a direct binary encoding of the *2-3* tree specifically — Sedgewick's **left-leaning red-black tree (LLRB)** — which canonicalizes red links to lean left so the correspondence with 2-3 nodes is one-to-one. If you found the borrow/merge cases above fiddly, the LLRB is the cleanest code path to the same guarantees.

---

<a name="pitfalls"></a>
## 12. Common Pitfalls in Deletion

1. **Forgetting to reduce to a leaf.** Trying to delete an internal key in place corrupts the separator/child invariant. Always swap with predecessor or successor first.
2. **Off-by-one in the borrow test.** A 3-node has 2 keys; a borrowable sibling is the one with `keys.size() == 2`. Using `>= 1` makes every sibling look borrowable and produces empty siblings.
3. **Not moving children during borrow/merge on internal nodes.** When `child` and its sibling are internal, the rotated key must drag a child pointer with it, and a merge must concatenate child lists. Omitting this breaks balance silently — the tree still "looks" valid until a later query falls off a missing child.
4. **Fixing underflow at the wrong level.** Borrow/merge needs the *parent* in scope, because the separator lives in the parent. The clean pattern is: child mutation may empty the child; the parent checks `child.keys.isEmpty()` and calls `fixChild`. Trying to self-heal inside the child has no access to siblings.
5. **Mishandling the empty leaf root.** When the root itself is an emptied leaf, the tree must become empty (`root = nil`), *not* be replaced by a nonexistent `children[0]`. Branch on `root.isLeaf()`.
6. **Losing the all-leaves-same-depth invariant by shortening a branch.** Never "just delete" a child to fix underflow — that shortens one path and breaks perfect balance. Underflow is *always* resolved by borrow or by merge-and-collapse-at-the-root, never by truncation.
7. **Choosing the merge side blindly.** When the empty child is the leftmost (`i == 0`), you must merge with the *right* sibling around `keys[0]`; when it is not, merging with the left sibling around `keys[i-1]` is simplest. A single merge helper indexed by the *left* of the two merged children avoids the confusion.

---

<a name="summary"></a>
## 13. Summary

- A **2-3 tree** keeps all leaves at equal depth using only 2-nodes and 3-nodes; it is precisely the **B-tree of order 3**.
- **Insertion** handles *overflow* by splitting a transient 4-node and promoting the median, growing height only at the root.
- **Deletion** is the mirror image and the harder operation. **Phase A** reduces every deletion to a leaf by swapping an internal key with its in-order predecessor or successor. **Phase B** repairs the resulting *underflow* (an empty node) by **borrowing** a key up-and-over from a 3-node sibling, or **merging** with a 2-node sibling by pulling a separator down — which can **cascade** upward and, at the root, **lower the tree's height by one**, the only place a 2-3 tree shrinks.
- The Go and Java implementations above resolve underflow one level above where it occurs (`fixChild` in the parent), which is the cleanest correct structure; trace Case D through the code to convince yourself.
- The hard edge cases are the empty tree, the single-node tree, the root collapse, and the borrow-vs-merge boundary (`keys.size() == 2`).
- The 2-3 tree is the doorway to the rest of the balanced-tree family: it generalizes to **B-trees of any order** (`../11-b-tree/middle.md`), extends to **2-3-4 trees** (`../19-two-three-four-tree/middle.md`) with a stable 4-node enabling top-down operations, and is binary-encoded by **red-black / left-leaning red-black trees** (`../04-red-black/middle.md`).

Continue with `./senior.md` for production considerations — why 2-3 trees are taught but rarely deployed directly, the relationship to functional/persistent variants, and how real systems pick the order-3 vs order-4 vs large-order B-tree trade-off.
