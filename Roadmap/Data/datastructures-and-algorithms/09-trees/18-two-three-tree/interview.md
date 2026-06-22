# 2-3 Tree — Interview Questions

> **Audience:** Candidates preparing for SDE/SDE-II/senior interviews where balanced-search-tree internals come up — and especially for anyone who has been asked "explain how red-black trees *really* work." The 2-3 tree is the cleanest mental model of a balanced BST, so it shows up as a teaching device, a warm-up, and occasionally as a full implementation problem. Prerequisite: `junior.md` for the split-on-overflow insert; `middle.md` for delete and the LLRB equivalence.

The 2-3 tree is a B-tree of order 3: every node is either a **2-node** (one key, two children) or a **3-node** (two keys, three children), and *every leaf sits at exactly the same depth*. That single equal-depth invariant is what makes the tree self-balancing without any rotation bookkeeping or color bits. Understanding it well is the fastest route to understanding red-black, AA, and B-trees all at once.

This file walks through graded questions — Conceptual, Mechanics, Coding, and Comparison — with strong model answers, Go and Python reference code, and difficulty tags. Trace the code; every line is meant to run.

---

## Table of Contents

**Conceptual**
1. [What is a 2-3 tree? (Easy)](#q1)
2. [The equal-depth invariant and why it forces balance (Easy)](#q2)
3. [Height bounds (Medium)](#q3)
4. [How does a 2-3 tree relate to B-trees, red-black, and AA trees? (Medium)](#q4)

**Mechanics**
5. [Walk an insertion with a cascading split that grows the root (Medium)](#q5)
6. [Why does the tree grow and shrink only at the root? (Medium)](#q6)
7. [Walk a deletion: swap-with-predecessor, borrow, merge, collapse (Hard)](#q7)

**Coding**
8. [Implement search and insert (Easy–Medium)](#q8)
9. [Implement delete (Hard)](#q9)
10. [Write an invariant checker (Medium)](#q10)

**Comparison & Trade-offs**
11. [2-3 vs AVL vs red-black vs B-tree (Medium)](#q11)
12. [Why is a red-black tree "really" a 2-3-4 tree? (Hard)](#q12)

**Wrap-up**
13. [Edge cases & gotchas](#edge)
14. [Rapid-fire Q&A](#rapid)
15. [Common mistakes](#mistakes)
16. [Tips & summary](#tips)

---

<a name="q1"></a>
## 1. What is a 2-3 tree? — *Easy*

**Model answer.**

A 2-3 tree is a perfectly height-balanced search tree built from two kinds of internal nodes:

- A **2-node** holds **one key** and has **two children** — the standard BST node. Everything in the left subtree is less than the key; everything in the right subtree is greater.
- A **3-node** holds **two keys** `a < b` and has **three children**. The left subtree holds keys `< a`, the middle subtree holds keys in `(a, b)`, and the right subtree holds keys `> b`.

The defining invariant is that **all leaves are at the same depth**. There are no null-child shortcuts and no "tall and stringy" paths: every root-to-leaf path has identical length. Because the tree can never get lopsided, search, insert, and delete are all O(log n) in the worst case — no rotations, no balance factors, no color bits.

The trick is that the tree achieves balance not by rotating, but by *changing node arity*. When a node would overflow, it splits and pushes a key up; when a node would underflow, it borrows or merges. Both operations preserve the equal-depth invariant for free.

**Follow-up — "Why not allow 1-nodes or 4-nodes?"** A "1-node" with a single child carries no key and just adds a level — pointless. A 4-node (three keys, four children) is allowed in a 2-3-**4** tree (see [Q12](#q12) and `../19-two-three-four-tree/interview.md`); the 2-3 tree caps at 3-nodes and splits eagerly to keep the node logic minimal.

---

<a name="q2"></a>
## 2. The equal-depth invariant and why it forces balance — *Easy*

**Model answer.**

Define the invariant precisely:

> Every path from the root to any leaf passes through exactly the same number of nodes.

A plain BST has no such constraint, which is why inserting sorted data degrades it to a linked list of height `n`. The 2-3 tree *cannot* degrade, because insertion never lengthens a single path in isolation. New keys are absorbed into existing leaf nodes (a 2-node becomes a 3-node, no new level), and the tree only gets taller when the **root itself splits** — which lifts *every* leaf down by one level simultaneously. Symmetrically, the tree only gets shorter when the root collapses, lifting every leaf up by one.

So the equal-depth property is not something you have to *restore* after each operation, the way you restore AVL balance factors or red-black coloring. It is *structurally preserved* by the insert and delete algorithms. That is the conceptual payoff of the 2-3 tree: balance is a consequence of the growth rule, not a separate maintenance task.

**Why this matters in an interview.** If you can articulate "the tree grows only at the root, so all leaves stay level," you have explained self-balancing more cleanly than most candidates manage with red-black colors. Interviewers use the 2-3 tree precisely because the explanation is airtight.

---

<a name="q3"></a>
## 3. Height bounds — *Medium*

**Model answer.**

Let `h` be the height (number of edges on a root-to-leaf path) and `n` the number of keys.

**Maximum height (sparsest tree).** The tree is tallest when every node is a 2-node — it degenerates to a perfect binary tree. A perfect binary tree of height `h` holds `2^(h+1) - 1` nodes, each carrying one key, so `n = 2^(h+1) - 1`. Solving: `h ≤ log₂(n + 1) - 1`, i.e. `h ≤ log₂ n`. This is the worst case.

**Minimum height (densest tree).** The tree is shortest when every node is a 3-node, carrying two keys with three children. A complete ternary tree of height `h` has `(3^(h+1) - 1)/2` nodes, each with 2 keys, so `n = 3^(h+1) - 1`. Solving: `h ≥ log₃(n + 1) - 1`, i.e. `h ≥ log₃ n`.

**Putting it together:**

```
log₃ n  ≤  h  ≤  log₂ n
```

Both bounds are Θ(log n), so every operation — search, insert, delete — is O(log n) worst case. The constant is excellent: even the *tallest* legal 2-3 tree is no worse than a perfectly balanced binary tree, and a typical one is shorter because 3-nodes pack more keys per level.

**Follow-up — "How many comparisons per node?"** At most 2 (compare against both keys of a 3-node), so total work is `O(h)` comparisons = `O(log n)`. Constant per level.

---

<a name="q4"></a>
## 4. How does a 2-3 tree relate to B-trees, red-black, and AA trees? — *Medium*

**Model answer.**

The 2-3 tree is the smallest interesting member of a whole family.

- **B-tree of order 3.** A B-tree with minimum degree `t = 2` permits each node to hold between `t-1 = 1` and `2t-1 = 3` keys. A 2-3 tree caps at 2 keys (3 children) instead of 3, so it is the variant that splits one step earlier — effectively a B-tree of order 3. The insert (split-and-push-up) and delete (borrow/merge) protocols are *identical in spirit* to the general B-tree; the 2-3 tree is just the n=small, in-memory case. See `../11-b-tree/interview.md`.

- **Red-black tree.** A red-black tree is an *isometry* of a 2-3-4 tree (or, with a specific convention, a 2-3 tree): each 2-3-4 node maps to a small cluster of binary nodes joined by red edges, and the black edges form the 2-3-4 skeleton. The "no red node has a red child" rule is exactly "no node has more than 3 keys"; "equal black-height" is exactly "all leaves at equal depth." See [Q12](#q12) and `../04-red-black/interview.md`.

- **Left-leaning red-black (LLRB).** Sedgewick's LLRB tree is a red-black tree constrained so that red links always lean left. That constraint makes it a *direct, one-to-one* binary encoding of a **2-3 tree** specifically: a left-leaning red link represents the "glue" inside a 3-node. The LLRB insert/delete code mirrors the 2-3 split/merge exactly.

- **AA tree.** An AA tree is another simplified red-black variant (Arne Andersson) that, like LLRB, encodes a 2-3 tree — it forbids right-leaning horizontal links and replaces colors with integer `level` fields. Its `skew` and `split` operations correspond to the 2-3 tree's rebalancing.

**One-line summary for the interviewer:** "A 2-3 tree is the conceptual core; LLRB and AA trees are its two clean binary encodings; red-black is the 2-3-4 encoding; and the general B-tree is the disk-oriented generalization."

---

<a name="q5"></a>
## 5. Walk an insertion with a cascading split that grows the root — *Medium*

**Model answer.**

Insertion always begins by descending to the **leaf** where the key belongs, then inserting it there. The leaf either has room (becomes a 3-node) or overflows and splits, pushing its middle key up — and the split can cascade.

**The rule for a temporary overflow.** Pretend a node briefly holds three keys `a < b < c` (a "4-node"). Split it: `b` moves up to the parent, `a` becomes a 2-node on the left, `c` becomes a 2-node on the right. The parent absorbs `b`; if the parent overflows, repeat. If the *root* overflows, the pushed-up key becomes a brand-new root — **and the tree's height increases by one.**

**Concrete trace.** Begin with this 2-3 tree:

```
                 [30]
                /    \
          [10 | 20]  [50 | 70]
```

All leaves at depth 1. Insert **`60`**: it belongs in the right leaf `[50 | 70]`, between 50 and 70. That leaf becomes the temporary 4-node `[50 | 60 | 70]` — overflow. Split it: middle key `60` rises to the parent `[30]`, which becomes `[30 | 60]`; the leaf splits into `[50]` and `[70]`:

```
              [30 | 60]
             /    |    \
        [10|20] [50]  [70]
```

Now insert **`80`**: goes into the right leaf `[70]`, making `[70 | 80]` — a 3-node, room to spare. Insert **`90`**: that leaf becomes `[70 | 80 | 90]`, overflow. Split: `80` rises to `[30 | 60]`, making it the temporary 4-node `[30 | 60 | 80]` — **overflow at the root!** Split the root: middle key `60` becomes a new root; `30` and `80` become its two children:

```
                    [60]
                   /    \
              [30]      [80]
             /    \    /    \
        [10|20] [50] [70]  [90]
```

The tree just grew from height 1 to height 2 — and notice **all four leaves are still at the same depth**. The cascade pushed the split all the way up; the new root is the only way height ever increases.

**Talking points:** "I split eagerly on overflow, middle key rises, and a root split is the *only* operation that increases height — which is exactly why every leaf stays level."

---

<a name="q6"></a>
## 6. Why does the tree grow and shrink only at the root? — *Medium*

**Model answer.**

This is the heart of the data structure, so be ready to defend it.

**Growth.** Every insert lands a key in a leaf. If the leaf has room it just widens (2-node → 3-node) — no height change. If it overflows, the split pushes one key *up* to the parent and replaces one node with two nodes *at the same level*. The local height does not change: the children of the split node are now one level lower than... no — they stay where they are, because the split node was a leaf and the split keeps its replacements at the leaf level. The only thing that moves up is a single key. So the path length stays constant *unless* the push-up reaches the root and the root itself must split. A root split manufactures a new top level, lengthening **every** root-to-leaf path by exactly one — uniformly. There is no way to lengthen one path without lengthening all of them.

**Shrinking.** Deletion can leave a node empty (after a merge). An empty internal root with a single child is pointless, so we **collapse** it: the child becomes the new root and the tree loses one level — again, uniformly across all paths.

**The invariant this protects.** Because both height changes happen *only at the root and apply to all paths at once*, the equal-depth property is automatically preserved. Compare this with an AVL tree, where a rotation changes the height of a *local* subtree and you must propagate balance-factor fixes; in a 2-3 tree, the structural rule *is* the balance rule.

---

<a name="q7"></a>
## 7. Walk a deletion: swap-with-predecessor, borrow, merge, collapse — *Hard*

**Model answer.**

Deletion is the hard direction (true of every balanced tree). The strategy mirrors B-tree delete:

**Step 1 — Reduce to a leaf deletion.** If the key lives in an internal node, swap it with its **in-order predecessor** (the largest key in the left subtree, found by going left once then right to the bottom) or successor. The predecessor always lives in a leaf. Now we only ever physically remove a key from a leaf.

**Step 2 — Remove from the leaf.**
- If the leaf was a **3-node**, removing one key leaves a 2-node. Done — no rebalancing needed.
- If the leaf was a **2-node**, removing its key leaves an **empty node** (a "hole"). We must fix the underflow.

**Step 3 — Fix the underflow (hole).** Two cases for the empty node's situation:
- **Borrow (rotate)** — if an *adjacent sibling* is a 3-node (has a spare key): rotate a key through the parent. The parent's separating key drops down into the empty node; the sibling's adjacent key moves up to replace it. The hole is filled, all depths preserved.
- **Merge (fuse)** — if every adjacent sibling is a 2-node (no spare): pull the parent's separating key *down* and fuse the empty node with a sibling into a single 3-node. This removes a key from the parent, which may now itself underflow — so the hole propagates **upward**. Recurse.

**Step 4 — Root collapse.** If the merge propagates all the way up and empties the root, delete the root and promote its only child. The tree loses a level.

**Concrete trace.** Take the tree from [Q5](#q5):

```
                    [60]
                   /    \
              [30]      [80]
             /    \    /    \
        [10|20] [50] [70]  [90]
```

Delete **`70`**. It is in leaf `[70]`, a 2-node — removing it leaves a hole under parent `[80]`. The hole's sibling is `[90]`, also a 2-node (no spare to borrow). So **merge**: pull parent key `80` down and fuse the hole with `[90]` → leaf `[80 | 90]`. But that empties parent `[80]`, creating a hole one level up under root `[60]`:

```
                    [60]
                   /    \
              [30]     (hole)
             /    \       \
        [10|20] [50]   [80|90]
```

The hole's sibling at this level is `[30]`, a 2-node — again no spare. **Merge** again: pull root key `60` down and fuse `[30]` with the hole into `[30 | 60]`. That empties the **root** → **collapse**: promote the merged node:

```
              [30 | 60]
             /    |    \
        [10|20] [50]  [80|90]
```

Height dropped from 2 to 1, every leaf still level. That is a full borrow-fails → merge → cascade → root-collapse path.

**Contrast — a borrow case.** From the *original* tree, delete `50` instead. Leaf `[50]` is a 2-node → hole under `[60]`... actually `[50]`'s parent is `[30]`. Sibling `[10|20]` is a 3-node — it has a spare! **Borrow**: parent key `30` drops into the hole, sibling's largest key `20` rises to become the new parent key:

```
                    [60]
                   /    \
              [20]      [80]
             /    \    /    \
          [10]  [30] [70]  [90]
```

No cascade, no height change. Borrow is the cheap case; merge is the expensive one that can ripple to the root.

---

<a name="q8"></a>
## 8. Implement search and insert — *Easy–Medium*

**Model answer.**

We represent a node with up to two keys and up to three children. Search is a straightforward multi-way descent. Insert recurses to a leaf and returns a "split result" (a promoted key + two new subtrees) when an overflow needs to propagate upward — this bottom-up bubbling is the cleanest way to handle cascades.

**Python:**
```python
class Node:
    def __init__(self, keys=None, children=None):
        self.keys = keys or []          # 1 or 2 keys, sorted
        self.children = children or []  # 0 (leaf), 2, or 3 children

    def is_leaf(self):
        return not self.children


class TwoThreeTree:
    def __init__(self):
        self.root = None

    def search(self, key):
        node = self.root
        while node is not None:
            if key in node.keys:
                return True
            if node.is_leaf():
                return False
            # pick the child whose range contains key
            if key < node.keys[0]:
                node = node.children[0]
            elif len(node.keys) == 1 or key < node.keys[1]:
                node = node.children[1]
            else:
                node = node.children[2]
        return False

    def insert(self, key):
        if self.root is None:
            self.root = Node(keys=[key])
            return
        split = self._insert(self.root, key)
        if split is not None:                 # root split → new root, height + 1
            mid, left, right = split
            self.root = Node(keys=[mid], children=[left, right])

    def _insert(self, node, key):
        if key in node.keys:
            return None                       # ignore duplicates
        if node.is_leaf():
            node.keys = sorted(node.keys + [key])
        else:
            # descend into the correct child
            if key < node.keys[0]:
                i = 0
            elif len(node.keys) == 1 or key < node.keys[1]:
                i = 1
            else:
                i = 2
            split = self._insert(node.children[i], key)
            if split is None:
                return None
            mid, left, right = split          # absorb child's promoted key
            node.keys.append(mid)
            node.keys.sort()
            node.children[i:i+1] = [left, right]
        # did THIS node overflow to 3 keys?
        if len(node.keys) == 3:
            return self._split(node)
        return None

    def _split(self, node):
        """Split an over-full node [a|b|c] → promote b, return (b, left, right)."""
        a, b, c = node.keys
        if node.is_leaf():
            left = Node(keys=[a])
            right = Node(keys=[c])
        else:
            ch = node.children
            left = Node(keys=[a], children=ch[0:2])
            right = Node(keys=[c], children=ch[2:4])
        return (b, left, right)
```

**Go:**
```go
type Node struct {
    keys     []int
    children []*Node
}

func (n *Node) isLeaf() bool { return len(n.children) == 0 }

type Tree struct{ root *Node }

func (t *Tree) Search(key int) bool {
    n := t.root
    for n != nil {
        for _, k := range n.keys {
            if k == key {
                return true
            }
        }
        if n.isLeaf() {
            return false
        }
        switch {
        case key < n.keys[0]:
            n = n.children[0]
        case len(n.keys) == 1 || key < n.keys[1]:
            n = n.children[1]
        default:
            n = n.children[2]
        }
    }
    return false
}

// split result bubbled up from a recursive insert
type split struct {
    mid         int
    left, right *Node
}

func (t *Tree) Insert(key int) {
    if t.root == nil {
        t.root = &Node{keys: []int{key}}
        return
    }
    if s := t.insert(t.root, key); s != nil {
        t.root = &Node{keys: []int{s.mid}, children: []*Node{s.left, s.right}}
    }
}

func (t *Tree) insert(n *Node, key int) *split {
    for _, k := range n.keys {
        if k == key {
            return nil // duplicate
        }
    }
    if n.isLeaf() {
        n.keys = insertSorted(n.keys, key)
    } else {
        i := childIndex(n, key)
        s := t.insert(n.children[i], key)
        if s == nil {
            return nil
        }
        n.keys = insertSorted(n.keys, s.mid)
        // replace children[i] with {s.left, s.right}
        nc := make([]*Node, 0, len(n.children)+1)
        nc = append(nc, n.children[:i]...)
        nc = append(nc, s.left, s.right)
        nc = append(nc, n.children[i+1:]...)
        n.children = nc
    }
    if len(n.keys) == 3 {
        return splitNode(n)
    }
    return nil
}

func childIndex(n *Node, key int) int {
    switch {
    case key < n.keys[0]:
        return 0
    case len(n.keys) == 1 || key < n.keys[1]:
        return 1
    default:
        return 2
    }
}

func splitNode(n *Node) *split {
    a, b, c := n.keys[0], n.keys[1], n.keys[2]
    var left, right *Node
    if n.isLeaf() {
        left = &Node{keys: []int{a}}
        right = &Node{keys: []int{c}}
    } else {
        left = &Node{keys: []int{a}, children: n.children[0:2]}
        right = &Node{keys: []int{c}, children: n.children[2:4]}
    }
    return &split{mid: b, left: left, right: right}
}

func insertSorted(s []int, x int) []int {
    s = append(s, x)
    for i := len(s) - 1; i > 0 && s[i-1] > s[i]; i-- {
        s[i-1], s[i] = s[i], s[i-1]
    }
    return s
}
```

**Time:** O(log n) for both — one root-to-leaf descent plus O(1) work per level. **Space:** O(log n) recursion depth for insert.

> Note: the Python version appends the promoted `mid` and re-sorts the (at most three) keys — trivially cheap and obviously correct. The Go version inserts in sorted position directly via `insertSorted`. Trace both on the [Q5](#q5) example to confirm the cascade.

---

<a name="q9"></a>
## 9. Implement delete — *Hard*

**Model answer.**

Delete is the canonical "can you handle the underflow cases" question. The cleanest formulation represents a hole as a node carrying an empty key list and propagates it upward. Here is a compact reference using a "deficient subtree" signal: each recursive call returns whether the child it descended into is now *deficient* (an empty leaf, or an internal node that lost its only key), and the parent repairs it before returning.

**Python:**
```python
def delete(self, key):
    if self.root is None:
        return
    self._delete(self.root, key)
    # root collapse: an internal root with no keys promotes its single child
    if not self.root.keys:
        self.root = self.root.children[0] if self.root.children else None

def _delete(self, node, key):
    # 1. Find key, or descend.
    if key in node.keys:
        ki = node.keys.index(key)
        if node.is_leaf():
            node.keys.pop(ki)               # may leave [] → caller repairs
            return
        # internal: swap with in-order predecessor (max of left subtree of this key)
        pred_child = node.children[ki]
        pred = self._max_node(pred_child)
        node.keys[ki] = pred.keys[-1]
        self._delete(pred_child, pred.keys[-1])
        ci = ki
    else:
        if node.is_leaf():
            return                          # key not present
        ci = self._child_index(node, key)
        self._delete(node.children[ci], key)
    # 2. Repair the child we recursed into if it underflowed.
    if not node.is_leaf() and not node.children[ci].keys:
        self._fix(node, ci)

def _max_node(self, node):
    while not node.is_leaf():
        node = node.children[-1]
    return node

def _child_index(self, node, key):
    if key < node.keys[0]:
        return 0
    if len(node.keys) == 1 or key < node.keys[1]:
        return 1
    return 2

def _fix(self, parent, ci):
    """child[ci] is empty (no keys). Borrow from a sibling or merge."""
    # try borrow from left sibling (a 3-node)
    if ci > 0 and len(parent.children[ci - 1].keys) == 2:
        left = parent.children[ci - 1]
        hole = parent.children[ci]
        hole.keys.insert(0, parent.keys[ci - 1])        # parent sep drops in
        parent.keys[ci - 1] = left.keys.pop()           # sibling max rises
        if not hole.is_leaf():                          # move the orphaned child
            hole.children.insert(0, left.children.pop())
        return
    # try borrow from right sibling (a 3-node)
    if ci < len(parent.children) - 1 and len(parent.children[ci + 1].keys) == 2:
        right = parent.children[ci + 1]
        hole = parent.children[ci]
        hole.keys.append(parent.keys[ci])               # parent sep drops in
        parent.keys[ci] = right.keys.pop(0)             # sibling min rises
        if not hole.is_leaf():
            hole.children.append(right.children.pop(0))
        return
    # merge: no 3-node sibling. Fuse hole with an adjacent sibling + parent sep.
    if ci > 0:
        left = parent.children[ci - 1]
        hole = parent.children[ci]
        left.keys.append(parent.keys.pop(ci - 1))       # parent sep pulled down
        left.children.extend(hole.children)             # adopt hole's children
        parent.children.pop(ci)                         # remove the hole
    else:
        hole = parent.children[ci]
        right = parent.children[ci + 1]
        right.keys.insert(0, parent.keys.pop(ci))       # parent sep pulled down
        right.children[:0] = hole.children
        parent.children.pop(ci)
    # parent may now be empty → its own caller repairs it (or root collapses)
```

**Walk-through against [Q7](#q7).** Deleting `70` empties leaf `[70]` (ci under `[80]`); right sibling `[90]` is a 2-node so no borrow; merge pulls `80` down and removes the hole, emptying `[80]`'s parent slot → propagates up; another merge pulls `60` down, empties the root → `delete` promotes the single child. Deleting `50` instead: left sibling `[10|20]` is a 3-node → borrow, no cascade. Both match the hand traces exactly.

**Time:** O(log n) — one descent down and at most one repair per level on the way back up. **Space:** O(log n) recursion.

The Go version is a mechanical translation of the same five branches (`borrow-left`, `borrow-right`, `merge-left`, `merge-right`, `root-collapse`); flesh it out from the Python. The single most error-prone part is **moving the orphaned child pointer** during a borrow on internal nodes — forget it and you corrupt the subtree silently. Always run the [invariant checker](#q10) after a fuzz sequence of deletes.

---

<a name="q10"></a>
## 10. Write an invariant checker — *Medium*

**Model answer.**

A 2-3 tree is valid iff:

1. Every node has exactly 1 or 2 keys.
2. Every internal node has exactly `len(keys) + 1` children (2 or 3); leaves have 0.
3. Keys within a node are strictly sorted.
4. The search-tree ordering holds across every separator (each child's keys fall in the correct gap).
5. **All leaves are at the same depth** — the invariant that *is* the balance guarantee.

The cleanest checker returns the leaf depth of each subtree (or `-1` for invalid) and verifies all subtrees of a node agree.

**Python:**
```python
def is_valid(self):
    if self.root is None:
        return True
    return self._check(self.root, lo=None, hi=None) != -1

def _check(self, node, lo, hi):
    """Return uniform leaf depth of this subtree, or -1 if any invariant fails."""
    k = len(node.keys)
    if k not in (1, 2):
        return -1                                   # invariant 1
    for i in range(1, k):
        if node.keys[i - 1] >= node.keys[i]:
            return -1                               # invariant 3 (strict sort)
    if (lo is not None and node.keys[0] <= lo) or \
       (hi is not None and node.keys[-1] >= hi):
        return -1                                   # invariant 4 (range bound)
    if node.is_leaf():
        return 0
    if len(node.children) != k + 1:
        return -1                                   # invariant 2
    depths = set()
    for i, child in enumerate(node.children):
        clo = lo if i == 0 else node.keys[i - 1]
        chi = hi if i == k else node.keys[i]
        d = self._check(child, clo, chi)
        if d == -1:
            return -1
        depths.add(d)
        if len(depths) > 1:
            return -1                               # invariant 5 (equal depth)
    return depths.pop() + 1
```

**Go:**
```go
func (t *Tree) IsValid() bool {
    if t.root == nil {
        return true
    }
    return check(t.root, nil, nil) != -1
}

// lo/hi are *int so nil means "unbounded".
func check(n *Node, lo, hi *int) int {
    k := len(n.keys)
    if k != 1 && k != 2 {
        return -1
    }
    for i := 1; i < k; i++ {
        if n.keys[i-1] >= n.keys[i] {
            return -1
        }
    }
    if (lo != nil && n.keys[0] <= *lo) || (hi != nil && n.keys[k-1] >= *hi) {
        return -1
    }
    if n.isLeaf() {
        return 0
    }
    if len(n.children) != k+1 {
        return -1
    }
    depth := -1
    for i, c := range n.children {
        clo, chi := lo, hi
        if i > 0 {
            clo = &n.keys[i-1]
        }
        if i < k {
            chi = &n.keys[i]
        }
        d := check(c, clo, chi)
        if d == -1 {
            return -1
        }
        if depth == -1 {
            depth = d
        } else if depth != d {
            return -1
        }
    }
    return depth + 1
}
```

**Time:** O(n) — visits every node once. **Space:** O(log n) recursion. Run it after every operation in a randomized stress test; it catches the subtle "forgot to move the orphaned child" bug immediately by reporting an unequal-depth or range violation.

---

<a name="q11"></a>
## 11. 2-3 vs AVL vs red-black vs B-tree — when does each win? — *Medium*

**Model answer.**

| Property | 2-3 tree | AVL | Red-black | B-tree (order ≫ 3) |
|---|---|---|---|---|
| Worst-case height | `log₂ n` | `1.44 log₂ n` | `2 log₂ n` | `log_t n` (very shallow) |
| Balance mechanism | split / merge nodes | rotations + balance factor | rotations + recolor | split / merge nodes |
| Lookups | fast, shallow | **fastest** (tightest height) | good | fastest on disk |
| Inserts/deletes | few structural ops, but variable-arity nodes | up to O(log n) rotations | ≤ 2–3 rotations | few, batched |
| Implementation effort | conceptually simplest; awkward variable-arity node | moderate | hard (delete is famously fiddly) | hard but well-trodden |
| Cache / disk fit | poor (small nodes, pointer chasing) | poor | poor | **excellent** (wide nodes = one I/O per level) |

**When each wins:**

- **AVL** — read-heavy in-memory workloads where lookups dominate. Its strict balance (`1.44 log n`) gives the shortest trees and therefore the fastest searches. Pays for it with more rotations on writes.
- **Red-black** — write-mixed in-memory workloads and the default for standard libraries (`std::map`, Java `TreeMap`, the Linux kernel CFS scheduler). Looser balance means fewer rotations per update; O(1) amortized recolorings. See `../04-red-black/interview.md`.
- **2-3 tree** — almost never the production choice directly; its value is **pedagogical and as the spec** behind LLRB and AA trees. If you implement an LLRB tree, you are implementing a 2-3 tree.
- **B-tree / B+ tree** — anything backed by disk or large enough that cache misses dominate (databases, filesystems). Wide nodes amortize the cost of each pointer dereference (= page read) across hundreds of keys. See `../11-b-tree/interview.md`.

**The crisp summary:** "In memory, pick AVL for read-heavy and red-black for write-heavy; on disk, pick a B-tree; the 2-3 tree is the clean model that explains why the binary balanced trees work." See also `../03-avl/interview.md`.

---

<a name="q12"></a>
## 12. Why is a red-black tree "really" a 2-3-4 tree? — *Hard*

**Model answer.**

This is the classic senior-level "do you actually understand red-black" question. The answer: red-black trees are a **binary encoding of a 2-3-4 tree**, where red links are the "internal glue" of a multi-key node and black links are the real tree edges.

**The mapping.** Take a 2-3-4 node and represent it as a tiny cluster of binary nodes connected by **red** links; the links *leaving* the cluster are **black**:

- A **2-node** (1 key) → a single black node. No red links.
- A **3-node** (2 keys `a < b`) → two binary nodes joined by one red link: `b` black with a red left child `a` (or the mirror). Three black links leave the cluster — its three children.
- A **4-node** (3 keys `a < b < c`) → `b` black with **two** red children `a` and `c`. Four black links leave — its four children.

Now translate the red-black properties:

- **"No red node has a red child."** A red-red chain would mean a cluster of three keys glued together = a 5-node, which a 2-3-4 tree forbids. So this property is exactly "no node has more than 3 keys."
- **"Every root-to-leaf path has the same number of black nodes" (black-height).** Black links *are* the 2-3-4 tree edges, so equal black-height is exactly "all leaves at equal depth in the 2-3-4 tree."

So a red-black tree's two structural invariants are literally the 2-3-4 tree's two invariants, viewed through the encoding. A red-black **insert** that recolors and rotates is performing a 2-3-4 **node split**; the color flip on a full (two-red-children) node is the moment a 4-node splits and pushes its middle key up.

**Where the 2-3 tree fits.** If you forbid 4-nodes — i.e. forbid a black node from having *two* red children, allowing only *left*-leaning red links — you get the **left-leaning red-black (LLRB)** tree, which encodes a **2-3 tree** specifically (no 4-nodes). That extra constraint is exactly what makes LLRB code shorter than full red-black: there are fewer cases because there are fewer node shapes.

**One-sentence delivery:** "Red links glue keys into a multi-key B-tree node; black links form the B-tree skeleton; full red-black encodes a 2-3-4 tree, and left-leaning red-black encodes a 2-3 tree." See `../04-red-black/interview.md` and `../19-two-three-four-tree/interview.md`.

---

<a name="edge"></a>
## 13. Edge cases & gotchas

- **Empty tree.** `search` returns false, `delete` is a no-op, first `insert` creates a single-key root. Handle `root is None` explicitly.
- **Single-node tree.** A root that is a leaf 2-node: deleting its key must set the tree empty (`root = None`), not leave a dangling empty node.
- **Duplicate insert.** Decide the policy up front (ignore, count, or overwrite a value). The reference code *ignores* duplicates by checking `key in node.keys` before inserting. State your choice to the interviewer.
- **Deleting a key in an internal node.** You cannot remove it directly — you must swap with the in-order predecessor (or successor), which is always a leaf, *then* delete from the leaf. Forgetting this is the single most common bug.
- **Borrow on internal nodes drops a child.** When you rotate a key through the parent during a borrow, the donating sibling also gives up a *child pointer* that must move to the formerly-empty node. Forgetting it corrupts the subtree without an immediate crash — only the invariant checker catches it.
- **Root collapse.** After a merge cascade empties the root, you must promote its single child and shrink the tree. Skipping this leaves a useless keyless root.
- **3-node child selection.** When descending a 3-node, there are *three* ranges to test (`< a`, `(a,b)`, `> b`). Off-by-one here sends keys to the wrong subtree.

---

<a name="rapid"></a>
## 14. Rapid-fire Q&A

**Q: Where do new keys always get inserted?** A: Into a leaf, after descending; overflow then bubbles up.

**Q: When does the height increase?** A: Only when a split cascades to and splits the root.

**Q: When does the height decrease?** A: Only when a merge cascade empties the root and it collapses.

**Q: Maximum keys in a node?** A: Two (a 3-node). A transient third key triggers an immediate split.

**Q: Are rotations used?** A: No. Balance comes from split/merge, not rotation — that is the 2-3 tree's whole appeal.

**Q: Height range?** A: `log₃ n ≤ h ≤ log₂ n`, so Θ(log n).

**Q: Which binary tree directly encodes a 2-3 tree?** A: The left-leaning red-black (LLRB) tree, and equivalently the AA tree.

**Q: Which binary tree encodes a 2-3-**4** tree?** A: The standard (non-left-leaning) red-black tree.

**Q: B-tree order of a 2-3 tree?** A: Order 3 (minimum degree `t = 2`).

**Q: Predecessor of an internal key — where is it?** A: The rightmost key of the leftmost-descending path from that key's left child; always in a leaf.

**Q: Worst-case search comparisons per level?** A: Two (both keys of a 3-node).

---

<a name="mistakes"></a>
## 15. Common mistakes

1. **Splitting *after* the key reaches an over-full leaf but forgetting to bubble the median up.** The split must return a `(mid, left, right)` triple that the parent absorbs; dropping `mid` loses a key.
2. **Promoting the wrong key on split.** Always the **middle** key (`b` of `a<b<c`) rises; promoting `a` or `c` breaks the ordering.
3. **Deleting an internal key directly.** You must swap with a leaf predecessor/successor first.
4. **Borrow vs merge confusion.** Borrow only when an *adjacent* sibling is a 3-node; otherwise merge. Checking a non-adjacent sibling, or borrowing from a 2-node, both corrupt the structure.
5. **Losing the orphaned child pointer** during borrow/merge on internal nodes.
6. **Forgetting the root collapse** after a delete cascade, leaving a keyless root.
7. **Treating it like an AVL tree** and reaching for rotations — there are none in a 2-3 tree.
8. **Confusing 2-3 with 2-3-4.** A 2-3 tree caps at 3-nodes; allowing 4-nodes is a different structure (`../19-two-three-four-tree/interview.md`).

---

<a name="tips"></a>
## 16. Tips & summary

**How interviewers actually use the 2-3 tree:**

- As a **warm-up / teaching device**: "Explain how a self-balancing tree stays balanced" — the 2-3 tree gives the cleanest answer (grows only at the root).
- As the **lens on red-black trees**: "Why is a red-black tree balanced?" → because it encodes a 2-3-4 tree. This is the highest-leverage thing to know ([Q12](#q12)).
- Occasionally as a **full implementation** problem at companies that build their own ordered containers or storage engines — usually search + insert ([Q8](#q8)), rarely delete ([Q9](#q9)).

**The three things to nail:**

1. **The equal-depth invariant and root-only growth** — this *is* the explanation of self-balancing. Deliver it crisply ([Q2](#q2), [Q6](#q6)).
2. **The split (insert) and borrow/merge/collapse (delete) protocols** — be able to hand-trace a cascade in both directions ([Q5](#q5), [Q7](#q7)).
3. **The family relationships** — B-tree of order 3, LLRB/AA encode 2-3, red-black encodes 2-3-4 ([Q4](#q4), [Q12](#q12)).

If you can draw the [Q5](#q5) root-split and the [Q7](#q7) merge-and-collapse on a whiteboard from memory, and explain why red-black is "really" a 2-3-4 tree, you have covered everything a 2-3-tree interview question is likely to probe.

**Cross-references:**
- B-tree (the disk-oriented generalization): `../11-b-tree/interview.md`
- Red-black (the 2-3-4 binary encoding): `../04-red-black/interview.md`
- AVL (the strict-balance alternative): `../03-avl/interview.md`
- 2-3-4 tree (allow 4-nodes; red-black's direct model): `../19-two-three-four-tree/interview.md`
